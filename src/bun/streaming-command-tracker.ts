import type { AssistantMessage } from "@mariozechner/pi-ai";
import { getNativeToolCommandMetadata } from "@svvy/extensions";
import * as Effect from "effect/Effect";
import type {
  JsonValue,
  PromptExecutionContext,
  RuntimeCommandStatePortService,
  RuntimeCommandStatus,
} from "@svvy/core";
import type { RuntimeStateWriteLane } from "./ordered-runtime-state-write-lane";

const ARG_SNAPSHOT_MIN_BYTES = 64;
const ARG_SNAPSHOT_MIN_INTERVAL_MS = 200;

export interface StreamingCommandTracker {
  handleToolcallStart(input: {
    contentIndex: number;
    toolCallId: string;
    toolName: string;
    partialArguments: Record<string, JsonValue>;
    partial: AssistantMessage;
  }): void;
  handleToolcallDelta(input: {
    contentIndex: number;
    toolCallId: string;
    toolName: string;
    delta: string;
    partialArguments: Record<string, JsonValue>;
    partial: AssistantMessage;
  }): void;
  handleToolcallEnd(input: {
    contentIndex: number;
    toolCallId: string;
    toolName: string;
    arguments: Record<string, JsonValue>;
    partial: AssistantMessage;
  }): void;
  releaseToolCall(toolCallId: string): void;
  finishDanglingStreamingCommands(input: {
    status: Extract<RuntimeCommandStatus, "failed" | "cancelled">;
    error: string;
  }): void;
}

export function createStreamingCommandTracker(options: {
  commandState: RuntimeCommandStatePortService;
  promptContext: PromptExecutionContext;
  stateWrites: RuntimeStateWriteLane;
}): StreamingCommandTracker {
  const trackedToolCallIds = new Set<string>();
  const commandIdByToolCallId = new Map<string, string>();
  const lastSnapshotBytesByCommandId = new Map<string, number>();
  const lastSnapshotTimeByCommandId = new Map<string, number>();

  return {
    handleToolcallStart(input) {
      if (trackedToolCallIds.has(input.toolCallId)) {
        return;
      }

      const metadata = getNativeToolCommandMetadata(input.toolName);
      if (!metadata) {
        return;
      }
      trackedToolCallIds.add(input.toolCallId);
      void options.stateWrites
        .enqueue(
          "streaming-command.start",
          Effect.gen(function* () {
            const command = yield* options.commandState.createCommand({
              turnId: options.promptContext.turnId,
              workflowTaskAttemptId: options.promptContext.workflowTaskAttemptId,
              threadId: options.promptContext.threadId ?? options.promptContext.rootThreadId,
              workflowRunId: options.promptContext.workflowRunId,
              toolName: input.toolName,
              executor: inferExecutor(options.promptContext.surfaceKind),
              visibility: metadata.visibility,
              title: `Run ${input.toolName}`,
              summary: summarizeArguments(input.partialArguments),
              arguments: input.partialArguments,
              facts: { toolCallId: input.toolCallId },
              status: "streaming",
            });
            commandIdByToolCallId.set(input.toolCallId, command.value.id);

            if (metadata.streamingArguments === "record") {
              yield* options.commandState.recordCommandEvent({
                sessionId: options.promptContext.workspaceSessionId,
                commandId: command.value.id,
                kind: "command.arg_snapshot",
                data: {
                  source: "streaming",
                  arguments: input.partialArguments,
                },
              });
            }

            const serialized = JSON.stringify(input.partialArguments);
            lastSnapshotBytesByCommandId.set(command.value.id, serialized.length);
            lastSnapshotTimeByCommandId.set(command.value.id, Date.now());
          }),
        )
        .catch(() => undefined);
    },

    handleToolcallDelta(input) {
      const metadata = getNativeToolCommandMetadata(input.toolName);
      if (!metadata) {
        return;
      }
      if (metadata.streamingArguments === "skip") return;

      void options.stateWrites
        .enqueue(
          "streaming-command.delta",
          Effect.gen(function* () {
            const commandId = commandIdByToolCallId.get(input.toolCallId);
            if (!commandId) return;

            const serialized = JSON.stringify(input.partialArguments);
            const prevBytes = lastSnapshotBytesByCommandId.get(commandId) ?? 0;
            const prevTime = lastSnapshotTimeByCommandId.get(commandId) ?? 0;
            const byteGrowth = serialized.length - prevBytes;
            const elapsed = Date.now() - prevTime;

            if (byteGrowth < ARG_SNAPSHOT_MIN_BYTES && elapsed < ARG_SNAPSHOT_MIN_INTERVAL_MS) {
              return;
            }

            yield* options.commandState.recordCommandEvent({
              sessionId: options.promptContext.workspaceSessionId,
              commandId,
              kind: "command.arg_snapshot",
              data: {
                source: "streaming",
                arguments: input.partialArguments,
              },
            });

            lastSnapshotBytesByCommandId.set(commandId, serialized.length);
            lastSnapshotTimeByCommandId.set(commandId, Date.now());
          }),
        )
        .catch(() => undefined);
    },

    handleToolcallEnd(input) {
      const metadata = getNativeToolCommandMetadata(input.toolName);
      if (!metadata) {
        return;
      }

      void options.stateWrites
        .enqueue(
          "streaming-command.end",
          Effect.gen(function* () {
            const commandId = commandIdByToolCallId.get(input.toolCallId);
            if (!commandId) return;

            yield* options.commandState.updateCommandArguments({
              commandId,
              arguments: input.arguments,
            });

            if (metadata.streamingArguments === "record") {
              yield* options.commandState.recordCommandEvent({
                sessionId: options.promptContext.workspaceSessionId,
                commandId,
                kind: "command.arg_snapshot",
                data: {
                  source: "streaming-final",
                  arguments: input.arguments,
                },
              });
            }
          }),
        )
        .catch(() => undefined);

      // Keep the command in the dangling set. If the prompt ends before
      // runtime execution starts, finishDanglingStreamingCommands will
      // cancel it. Once execution starts, releaseToolCall removes it.
    },

    releaseToolCall(toolCallId: string) {
      const commandId = commandIdByToolCallId.get(toolCallId);
      if (!commandId) return;
      commandIdByToolCallId.delete(toolCallId);
      trackedToolCallIds.delete(toolCallId);
      lastSnapshotBytesByCommandId.delete(commandId);
      lastSnapshotTimeByCommandId.delete(commandId);
    },

    finishDanglingStreamingCommands(input) {
      void options.stateWrites
        .enqueue(
          "streaming-command.finish-dangling",
          Effect.gen(function* () {
            for (const commandId of commandIdByToolCallId.values()) {
              yield* options.commandState.finishCommand({
                commandId,
                status: input.status,
                summary: input.error,
                error: input.error,
              });
            }
            commandIdByToolCallId.clear();
            trackedToolCallIds.clear();
            lastSnapshotBytesByCommandId.clear();
            lastSnapshotTimeByCommandId.clear();
          }),
        )
        .catch(() => undefined);
    },
  };
}

function inferExecutor(surfaceKind: PromptExecutionContext["surfaceKind"]) {
  if (surfaceKind === "workflow-task") {
    return "workflow-task-agent" as const;
  }
  return surfaceKind === "handler" ? "handler" : "orchestrator";
}

function summarizeArguments(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  try {
    const serialized = JSON.stringify(args);
    return serialized.length > 160 ? `${serialized.slice(0, 159).trimEnd()}…` : serialized;
  } catch {
    return "";
  }
}
