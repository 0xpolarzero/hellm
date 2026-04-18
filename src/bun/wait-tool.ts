import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { StructuredSessionStateStore, StructuredWaitKind } from "./structured-session-state";

export const WAIT_TOOL_NAME = "wait";

const waitKindSchema = Type.Union([Type.Literal("user"), Type.Literal("external")]);

export const waitParamsSchema = Type.Object(
  {
    reason: Type.String({ minLength: 1 }),
    resumeWhen: Type.String({ minLength: 1 }),
    kind: Type.Optional(waitKindSchema),
  },
  { additionalProperties: false },
);

export type WaitParams = Static<typeof waitParamsSchema>;

const WAIT_TOOL_DESCRIPTION = [
  "Mark the current work as waiting on user or external input.",
  "This updates the current root thread and promotes the session into wait state when no other runnable work remains.",
].join(" ");

export function createWaitTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof waitParamsSchema, Record<string, unknown>> {
  return {
    label: "Wait",
    name: WAIT_TOOL_NAME,
    description: WAIT_TOOL_DESCRIPTION,
    parameters: waitParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${WAIT_TOOL_NAME} can only run during an active prompt.`);
      }

      const kind = normalizeWaitKind(params.kind);
      options.store.setTurnDecision({
        turnId: runtime.turnId,
        decision: kind === "user" ? "clarify" : "reply",
        onlyIfPending: true,
      });
      ensureRunnableSurfaceThread(options.store, runtime.sessionId, runtime.rootThreadId);
      const reason = params.reason.trim();
      const resumeWhen = params.resumeWhen.trim();
      const command = options.store.createCommand({
        turnId: runtime.turnId,
        threadId: runtime.rootThreadId,
        toolName: WAIT_TOOL_NAME,
        executor: "runtime",
        visibility: "surface",
        title: "Enter wait state",
        summary: reason,
      });
      options.store.startCommand(command.id);
      const wait = {
        kind,
        reason,
        resumeWhen,
        since: new Date().toISOString(),
      } as const;

      options.store.updateThread({
        threadId: runtime.rootThreadId,
        status: "waiting",
        wait,
      });

      let sessionWaitApplied = false;
      try {
        options.store.setSessionWait({
          sessionId: runtime.sessionId,
          owner: {
            kind: "thread",
            threadId: runtime.rootThreadId,
          },
          kind,
          reason,
          resumeWhen,
        });
        sessionWaitApplied = true;
        runtime.sessionWaitApplied = true;
      } catch (error) {
        const snapshot = options.store.getSessionState(runtime.sessionId);
        const hasOtherRunningWork = snapshot.threads.some(
          (thread) => thread.id !== runtime.rootThreadId && thread.status === "running",
        );
        if (!hasOtherRunningWork) {
          throw error;
        }
      }

      options.store.finishCommand({
        commandId: command.id,
        status: "waiting",
        summary: sessionWaitApplied
          ? reason
          : `Waiting without pausing the whole session: ${reason}`,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              threadId: runtime.rootThreadId,
              commandId: command.id,
              sessionWaitApplied,
              kind,
              reason,
              resumeWhen,
            }),
          },
        ],
        details: {
          ok: true,
          threadId: runtime.rootThreadId,
          commandId: command.id,
          sessionWaitApplied,
          kind,
          reason,
          resumeWhen,
        },
      };
    },
  };
}

function ensureRunnableSurfaceThread(
  store: StructuredSessionStateStore,
  sessionId: string,
  threadId: string,
): void {
  const thread = store.getSessionState(sessionId).threads.find((entry) => entry.id === threadId);
  if (!thread) {
    return;
  }

  if (thread.status === "running" && thread.wait === null) {
    return;
  }

  store.updateThread({
    threadId,
    status: "running",
    wait: null,
  });
}

function normalizeWaitKind(kind: StructuredWaitKind | undefined): StructuredWaitKind {
  return kind ?? "user";
}
