import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { PromptExecutionContext } from "./prompt-execution-context";
import type {
  StructuredCommandStatus,
  StructuredCommandVisibility,
  StructuredSessionStateStore,
} from "./structured-session-state";

const ARG_SNAPSHOT_MIN_BYTES = 64;
const ARG_SNAPSHOT_MIN_INTERVAL_MS = 200;
const SPECIALIZED_TOOL_NAMES = new Set([
  "execute_typescript",
  "list_extensions",
  "load_extension",
  "thread_start",
  "thread_followup",
  "thread_request_report",
  "thread_current",
  "thread_list",
  "thread_episodes",
  "thread_group",
  "thread_report",
  "request_user_input",
]);

export interface StreamingCommandTracker {
  handleToolcallStart(input: {
    contentIndex: number;
    toolCallId: string;
    toolName: string;
    partialArguments: Record<string, unknown>;
    partial: AssistantMessage;
  }): void;
  handleToolcallDelta(input: {
    contentIndex: number;
    toolCallId: string;
    toolName: string;
    delta: string;
    partialArguments: Record<string, unknown>;
    partial: AssistantMessage;
  }): void;
  handleToolcallEnd(input: {
    contentIndex: number;
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    partial: AssistantMessage;
  }): void;
  releaseToolCall(toolCallId: string): void;
  finishDanglingStreamingCommands(input: {
    status: Extract<StructuredCommandStatus, "failed" | "cancelled">;
    error: string;
  }): void;
}

export function createStreamingCommandTracker(options: {
  store: StructuredSessionStateStore;
  promptContext: PromptExecutionContext;
}): StreamingCommandTracker {
  const commandIdByToolCallId = new Map<string, string>();
  const lastSnapshotBytesByCommandId = new Map<string, number>();
  const lastSnapshotTimeByCommandId = new Map<string, number>();

  return {
    handleToolcallStart(input) {
      if (commandIdByToolCallId.has(input.toolCallId)) {
        return;
      }

      const isSpecialized = SPECIALIZED_TOOL_NAMES.has(input.toolName);
      const command = options.store.createCommand({
        turnId: options.promptContext.turnId,
        workflowTaskAttemptId: options.promptContext.workflowTaskAttemptId,
        threadId: options.promptContext.surfaceThreadId ?? options.promptContext.rootThreadId,
        workflowRunId: options.promptContext.workflowRunId,
        toolName: input.toolName,
        executor: inferExecutor(options.promptContext.surfaceKind),
        visibility: isSpecialized ? "surface" : inferVisibility(input.toolName),
        title: `Run ${input.toolName}`,
        summary: summarizeArguments(input.partialArguments),
        arguments: input.partialArguments,
        facts: { toolCallId: input.toolCallId },
        status: "streaming",
      });
      commandIdByToolCallId.set(input.toolCallId, command.id);

      if (!isSpecialized) {
        options.store.recordLifecycleEvent({
          sessionId: options.promptContext.sessionId,
          kind: "command.arg_snapshot",
          subjectKind: "command",
          subjectId: command.id,
          data: {
            source: "streaming",
            arguments: input.partialArguments,
          },
        });
      }

      const serialized = JSON.stringify(input.partialArguments);
      lastSnapshotBytesByCommandId.set(command.id, serialized.length);
      lastSnapshotTimeByCommandId.set(command.id, Date.now());
    },

    handleToolcallDelta(input) {
      const commandId = commandIdByToolCallId.get(input.toolCallId);
      if (!commandId) return;

      const isSpecialized = SPECIALIZED_TOOL_NAMES.has(input.toolName);
      if (isSpecialized) return;

      const serialized = JSON.stringify(input.partialArguments);
      const prevBytes = lastSnapshotBytesByCommandId.get(commandId) ?? 0;
      const prevTime = lastSnapshotTimeByCommandId.get(commandId) ?? 0;
      const byteGrowth = serialized.length - prevBytes;
      const elapsed = Date.now() - prevTime;

      if (byteGrowth < ARG_SNAPSHOT_MIN_BYTES && elapsed < ARG_SNAPSHOT_MIN_INTERVAL_MS) {
        return;
      }

      options.store.recordLifecycleEvent({
        sessionId: options.promptContext.sessionId,
        kind: "command.arg_snapshot",
        subjectKind: "command",
        subjectId: commandId,
        data: {
          source: "streaming",
          arguments: input.partialArguments,
        },
      });

      lastSnapshotBytesByCommandId.set(commandId, serialized.length);
      lastSnapshotTimeByCommandId.set(commandId, Date.now());
    },

    handleToolcallEnd(input) {
      const commandId = commandIdByToolCallId.get(input.toolCallId);
      if (!commandId) return;

      const isSpecialized = SPECIALIZED_TOOL_NAMES.has(input.toolName);

      options.store.updateCommandArguments(commandId, input.arguments);

      if (!isSpecialized) {
        options.store.recordLifecycleEvent({
          sessionId: options.promptContext.sessionId,
          kind: "command.arg_snapshot",
          subjectKind: "command",
          subjectId: commandId,
          data: {
            source: "streaming-final",
            arguments: input.arguments,
          },
        });
      }

      // Keep the command in the dangling set. If the prompt ends before
      // runtime execution starts, finishDanglingStreamingCommands will
      // cancel it. Once execution starts, releaseToolCall removes it.
    },

    releaseToolCall(toolCallId: string) {
      const commandId = commandIdByToolCallId.get(toolCallId);
      if (!commandId) return;
      commandIdByToolCallId.delete(toolCallId);
      lastSnapshotBytesByCommandId.delete(commandId);
      lastSnapshotTimeByCommandId.delete(commandId);
    },

    finishDanglingStreamingCommands(input) {
      for (const commandId of commandIdByToolCallId.values()) {
        options.store.finishCommand({
          commandId,
          status: input.status,
          summary: input.error,
          error: input.error,
        });
      }
      commandIdByToolCallId.clear();
      lastSnapshotBytesByCommandId.clear();
      lastSnapshotTimeByCommandId.clear();
    },
  };
}

function inferVisibility(toolName: string): StructuredCommandVisibility {
  if (["read", "grep", "find", "ls"].includes(toolName)) {
    return "trace";
  }
  return "summary";
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
