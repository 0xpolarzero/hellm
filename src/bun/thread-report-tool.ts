import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type {
  StructuredEpisodeRecord,
  StructuredSessionStateStore,
} from "./structured-session-state";

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
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]> & { surfaceThreadId: string };
  commandId: string;
  episode: StructuredEpisodeRecord;
  outcome: "succeeded" | "failed" | "cancelled" | null;
}

const THREAD_REPORT_DESCRIPTION = [
  "Emit a durable handler-thread update or conclusion episode.",
  "Use without outcome for an intermediate update.",
  "Use with outcome to conclude the current handler objective and notify the orchestrator.",
].join(" ");

export function createThreadReportTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  queueThreadReportNotification: (request: ThreadReportNotificationRequest) => Promise<void>;
}): AgentTool<typeof threadReportParamsSchema, Record<string, unknown>> {
  return {
    label: "Thread Report",
    name: THREAD_REPORT_TOOL_NAME,
    description: THREAD_REPORT_DESCRIPTION,
    parameters: threadReportParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = requireActiveHandlerRuntime(options.runtime);
      const threadId = runtime.surfaceThreadId;
      const summary = params.summary.trim();
      const details = params.details?.trim() || summary;
      const command = options.store.createCommand({
        turnId: runtime.turnId,
        surfacePiSessionId: runtime.surfacePiSessionId,
        threadId,
        toolName: THREAD_REPORT_TOOL_NAME,
        executor: "handler",
        visibility: "surface",
        title: params.outcome ? `Conclude thread: ${summary}` : `Report thread update: ${summary}`,
        summary,
        arguments: {
          summary,
          details,
          ...(params.outcome ? { outcome: params.outcome } : {}),
          relatedArtifactIds: params.relatedArtifactIds ?? [],
          relatedCommandIds: params.relatedCommandIds ?? [],
        },
      });
      options.store.startCommand(command.id);
      if (!summary) {
        const message = `${THREAD_REPORT_TOOL_NAME} requires a non-empty summary.`;
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: message,
          error: message,
        });
        throw new Error(message);
      }
      try {
        validateRelatedReferences(options.store, runtime.sessionId, {
          relatedArtifactIds: params.relatedArtifactIds ?? [],
          relatedCommandIds: params.relatedCommandIds ?? [],
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to validate related references.";
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: message,
          error: message,
        });
        throw error;
      }

      try {
        const episode = options.store.createEpisode({
          threadId,
          sourceCommandId: command.id,
          kind: runtime.rootEpisodeKind,
          title: summary,
          summary,
          body: details,
        });

        if (params.outcome) {
          options.store.updateThread({
            threadId,
            objectiveState: "concluded",
            status: "completed",
            wait: null,
          });
        }

        options.store.setTurnDecision({
          turnId: runtime.turnId,
          decision: "thread_report",
        });

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

        options.store.finishCommand({
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
        });

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
                commandId: command.id,
                error: message,
              }),
            },
          ],
          details: {
            commandId: command.id,
            error: message,
          },
        };
      }
    },
  };
}

function validateRelatedReferences(
  store: StructuredSessionStateStore,
  sessionId: string,
  input: { relatedArtifactIds: string[]; relatedCommandIds: string[] },
): void {
  const snapshot = store.getSessionState(sessionId);
  const commandIds = new Set(snapshot.commands.map((command) => command.id));
  const artifactIds = new Set(snapshot.artifacts.map((artifact) => artifact.id));
  for (const commandId of input.relatedCommandIds) {
    if (!commandIds.has(commandId)) {
      throw new Error(`thread_report related command is not durable or inspectable: ${commandId}`);
    }
  }
  for (const artifactId of input.relatedArtifactIds) {
    if (!artifactIds.has(artifactId)) {
      throw new Error(
        `thread_report related artifact is not durable or inspectable: ${artifactId}`,
      );
    }
  }
}

function requireActiveHandlerRuntime(
  runtimeHandle: PromptExecutionRuntimeHandle,
): NonNullable<PromptExecutionRuntimeHandle["current"]> & { surfaceThreadId: string } {
  const runtime = runtimeHandle.current;
  if (!runtime) {
    throw new Error(`${THREAD_REPORT_TOOL_NAME} can only run during an active prompt.`);
  }
  if (runtime.surfaceKind !== "handler" || !runtime.surfaceThreadId) {
    throw new Error(`${THREAD_REPORT_TOOL_NAME} can only run from a handler thread.`);
  }
  return runtime as NonNullable<PromptExecutionRuntimeHandle["current"]> & {
    surfaceThreadId: string;
  };
}
