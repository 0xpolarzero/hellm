import type { NativeToolDefinition } from "@svvy/extensions";
import { Type, type Static } from "typebox";
import type { PromptExecutionRuntimeHandle } from "@svvy/core";
import type {
  RuntimeCommandStatePortService,
  RuntimeEpisodeRecord,
  RuntimeEpisodeStatePortService,
  RuntimeReadModelStatePortService,
  RuntimeTurnStatePortService,
  StateContractError,
  ArtifactId,
  CommandId,
  RuntimeEpisodeKind,
  ThreadGroupId,
  ThreadId,
  WorkspaceSessionId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";

export const THREAD_REPORT_TOOL_NAME = "thread_report";

const threadReportOutcomeSchema = Type.Union([
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const threadReportParamsSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1 }),
    details: Type.Optional(Type.String({ minLength: 1 })),
    outcome: Type.Optional(threadReportOutcomeSchema),
    relatedArtifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    relatedCommandIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

export type ThreadReportParams = Static<typeof threadReportParamsSchema>;

export interface ThreadReportNotificationRequest {
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]> & { threadId: string };
  commandId: string;
  episode: RuntimeEpisodeRecord;
  outcome: "succeeded" | "failed" | "cancelled" | null;
}

const THREAD_REPORT_DESCRIPTION = [
  "Emit a durable handler-thread update or conclusion episode.",
  "Use without outcome for an intermediate update.",
  "Use with outcome to conclude the current handler objective and notify the orchestrator.",
].join(" ");

export function createThreadReportTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  commandState: RuntimeCommandStatePortService;
  episodeState: RuntimeEpisodeStatePortService;
  readModelState: RuntimeReadModelStatePortService;
  turnState: RuntimeTurnStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  queueThreadReportNotification: (request: ThreadReportNotificationRequest) => Promise<void>;
}): NativeToolDefinition<ThreadReportParams, Record<string, unknown>> {
  return {
    label: "Thread Report",
    name: THREAD_REPORT_TOOL_NAME,
    description: THREAD_REPORT_DESCRIPTION,
    parameters: threadReportParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = requireActiveHandlerRuntime(options.runtime);
      const threadId = runtime.threadId;
      const summary = params.summary.trim();
      const details = params.details?.trim() || summary;
      const command = options.runState(
        options.commandState.createOrReuseStreamingCommand({
          toolCallId: _toolCallId,
          turnId: runtime.turnId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId,
          toolName: THREAD_REPORT_TOOL_NAME,
          executor: "handler",
          visibility: "surface",
          title: params.outcome
            ? `Conclude thread: ${summary}`
            : `Report thread update: ${summary}`,
          summary,
          arguments: {
            summary,
            details,
            ...(params.outcome ? { outcome: params.outcome } : {}),
            relatedArtifactIds: params.relatedArtifactIds ?? [],
            relatedCommandIds: params.relatedCommandIds ?? [],
          },
        }),
      ).value;
      options.runState(options.commandState.startCommand({ commandId: command.id }));
      if (!summary) {
        const message = `${THREAD_REPORT_TOOL_NAME} requires a non-empty summary.`;
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: message,
            error: message,
          }),
        );
        throw new Error(message);
      }

      let threadGroupId: string;
      try {
        const thread = options.runState(
          options.readModelState.getCurrentThread({
            workspaceSessionId: runtime.workspaceSessionId as WorkspaceSessionId,
            threadId: threadId as ThreadId,
          }),
        );
        threadGroupId = thread.threadGroupId;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load handler thread.";
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: message,
            error: message,
          }),
        );
        throw error;
      }

      try {
        const episodeResult = options.runState(
          options.episodeState.recordHandlerThreadEpisode({
            scope: "handler-thread",
            workspaceSessionId: runtime.workspaceSessionId as WorkspaceSessionId,
            threadId: threadId as ThreadId,
            threadGroupId: threadGroupId as ThreadGroupId,
            sourceCommandId: command.id as CommandId,
            kind: params.outcome ? "conclusion" : toHandlerEpisodeKind(runtime.rootEpisodeKind),
            summary,
            body: details,
            ...(params.outcome
              ? {
                  outcome: params.outcome === "succeeded" ? "completed" : params.outcome,
                  notifyOrchestrator: true,
                }
              : {}),
            relatedArtifactIds: (params.relatedArtifactIds ?? []) as ArtifactId[],
            relatedCommandIds: (params.relatedCommandIds ?? []) as CommandId[],
          }),
        );
        const episode = episodeResult.value;

        options.runState(
          options.turnState.setTurnDecision({
            turnId: runtime.turnId!,
            decision: "thread_report",
          }),
        );

        let notificationQueued = true;
        let notificationError: string | null = null;
        try {
          await options.queueThreadReportNotification({
            runtime,
            commandId: command.id,
            episode,
            outcome: params.outcome ?? null,
          });
        } catch (error) {
          notificationQueued = false;
          notificationError =
            error instanceof Error ? error.message : "Failed to queue thread report notification.";
        }

        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "succeeded",
            summary,
            facts: {
              threadId,
              episodeId: episode.id,
              outcome: params.outcome ?? null,
              relatedArtifactIds: params.relatedArtifactIds ?? [],
              relatedCommandIds: params.relatedCommandIds ?? [],
              notificationQueued,
              notificationError,
            },
          }),
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                threadId,
                episodeId: episode.id,
                objectiveState: params.outcome ? "concluded" : "active",
                notificationQueued,
                notificationError,
              }),
            },
          ],
          details: {
            threadId,
            episodeId: episode.id,
            objectiveState: params.outcome ? "concluded" : "active",
            notificationQueued,
            notificationError,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to record handler thread report.";
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: message,
            error: message,
          }),
        );
        throw error;
      }
    },
  };
}

function toHandlerEpisodeKind(kind: string): RuntimeEpisodeKind {
  return kind === "change" ||
    kind === "clarification" ||
    kind === "report" ||
    kind === "handoff" ||
    kind === "conclusion"
    ? kind
    : "report";
}

function requireActiveHandlerRuntime(
  runtimeHandle: PromptExecutionRuntimeHandle,
): NonNullable<PromptExecutionRuntimeHandle["current"]> & { threadId: string } {
  const runtime = runtimeHandle.current;
  if (!runtime) {
    throw new Error(`${THREAD_REPORT_TOOL_NAME} can only run during an active prompt.`);
  }
  if (runtime.surfaceKind !== "handler" || !runtime.threadId) {
    throw new Error(`${THREAD_REPORT_TOOL_NAME} can only run from a handler thread.`);
  }
  return runtime as NonNullable<PromptExecutionRuntimeHandle["current"]> & { threadId: string };
}
