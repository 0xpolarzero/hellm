import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type {
  StructuredEpisodeKind,
  StructuredSessionStateStore,
  StructuredWorkflowRunRecord,
} from "./structured-session-state";

export const THREAD_HANDOFF_TOOL_NAME = "thread.handoff";

const handoffKindSchema = Type.Union([
  Type.Literal("analysis"),
  Type.Literal("change"),
  Type.Literal("workflow"),
  Type.Literal("clarification"),
]);

export const threadHandoffParamsSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1 }),
    body: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String({ minLength: 1 })),
    kind: Type.Optional(handoffKindSchema),
  },
  { additionalProperties: false },
);

export type ThreadHandoffParams = Static<typeof threadHandoffParamsSchema>;

const THREAD_HANDOFF_DESCRIPTION = [
  "Emit a durable handoff episode for the current handler-thread objective and mark that objective completed.",
  "Do not use this while the thread still owns a running or waiting workflow run; workflow waits stay inside the handler thread until they are resolved or cancelled.",
  "The thread surface stays interactive after handoff and may receive later follow-up turns.",
].join(" ");

export function createThreadHandoffTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof threadHandoffParamsSchema, Record<string, unknown>> {
  return {
    label: "Thread Handoff",
    name: THREAD_HANDOFF_TOOL_NAME,
    description: THREAD_HANDOFF_DESCRIPTION,
    parameters: threadHandoffParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = requireActiveHandlerRuntime(options.runtime);
      const threadId = runtime.surfaceThreadId;
      const summary = params.summary.trim();
      const body = params.body.trim();
      const title = params.title?.trim() || summary;
      if (!summary || !body) {
        throw new Error(`${THREAD_HANDOFF_TOOL_NAME} requires non-empty summary and body.`);
      }

      const command = options.store.createCommand({
        turnId: runtime.turnId,
        surfacePiSessionId: runtime.surfacePiSessionId,
        threadId,
        toolName: THREAD_HANDOFF_TOOL_NAME,
        executor: "handler",
        visibility: "surface",
        title: `Hand off thread: ${title}`,
        summary,
      });
      options.store.startCommand(command.id);

      try {
        assertNoActiveWorkflowRuns(options.store, runtime.sessionId, threadId);

        options.store.updateThread({
          threadId,
          status: "completed",
          wait: null,
        });

        const episode = options.store.createEpisode({
          threadId,
          sourceCommandId: command.id,
          kind: normalizeEpisodeKind(params.kind, runtime.rootEpisodeKind),
          title,
          summary,
          body,
        });

        options.store.setTurnDecision({
          turnId: runtime.turnId,
          decision: "thread.handoff",
        });

        options.store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary,
          facts: {
            threadId,
            episodeId: episode.id,
            kind: episode.kind,
            title: episode.title,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                threadId,
                commandId: command.id,
                episodeId: episode.id,
                kind: episode.kind,
                title: episode.title,
                summary: episode.summary,
              }),
            },
          ],
          details: {
            ok: true,
            threadId,
            commandId: command.id,
            episodeId: episode.id,
            kind: episode.kind,
            title: episode.title,
            summary: episode.summary,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to hand control back from the thread.";
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: message,
          error: message,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                commandId: command.id,
                error: message,
              }),
            },
          ],
          details: {
            ok: false,
            commandId: command.id,
            error: message,
          },
        };
      }
    },
  };
}

function requireActiveHandlerRuntime(
  runtimeHandle: PromptExecutionRuntimeHandle,
): NonNullable<PromptExecutionRuntimeHandle["current"]> & { surfaceThreadId: string } {
  const runtime = runtimeHandle.current;
  if (!runtime) {
    throw new Error(`${THREAD_HANDOFF_TOOL_NAME} can only run during an active prompt.`);
  }

  if (runtime.surfaceKind !== "handler" || !runtime.surfaceThreadId) {
    throw new Error(`${THREAD_HANDOFF_TOOL_NAME} can only run from a handler thread.`);
  }

  return runtime as NonNullable<PromptExecutionRuntimeHandle["current"]> & {
    surfaceThreadId: string;
  };
}

function normalizeEpisodeKind(
  kind: StructuredEpisodeKind | undefined,
  fallback: StructuredEpisodeKind,
): StructuredEpisodeKind {
  return kind ?? fallback;
}

function assertNoActiveWorkflowRuns(
  store: StructuredSessionStateStore,
  sessionId: string,
  threadId: string,
): void {
  const activeWorkflowRuns = store
    .getSessionState(sessionId)
    .workflowRuns.filter(
      (workflowRun) =>
        workflowRun.threadId === threadId &&
        (workflowRun.status === "running" || workflowRun.status === "waiting"),
    );
  if (activeWorkflowRuns.length === 0) {
    return;
  }

  throw new Error(buildActiveWorkflowHandoffError(activeWorkflowRuns));
}

function buildActiveWorkflowHandoffError(workflowRuns: StructuredWorkflowRunRecord[]): string {
  const details = workflowRuns
    .map(
      (workflowRun) =>
        `${workflowRun.savedEntryId ?? workflowRun.workflowName} (${workflowRun.smithersRunId}, ${workflowRun.status})`,
    )
    .join(", ");
  return `thread.handoff cannot complete the current objective span while unresolved workflow runs still exist: ${details}. The handler keeps ownership until those runs are resolved inside the thread. Resume, repair, cancel, or explicitly close the workflow state before handing control back.`;
}
