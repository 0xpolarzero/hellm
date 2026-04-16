import type { PromptExecutionContext } from "./prompt-execution-context";
import type {
  StructuredCommandExecutor,
  StructuredCommandStatus,
  StructuredCommandVisibility,
  StructuredSessionStateStore,
} from "./structured-session-state";

const SPECIALIZED_TOOL_NAMES = new Set([
  "execute_typescript",
  "verification.run",
  "workflow.start",
  "workflow.resume",
  "wait",
]);

export interface ToolExecutionCommandTracker {
  handleToolExecutionStart(input: { toolCallId: string; toolName: string; args: unknown }): void;
  handleToolExecutionEnd(input: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
  }): void;
  finishDanglingCommands(input: {
    status: Extract<StructuredCommandStatus, "failed" | "cancelled">;
    error: string;
  }): void;
}

export function createToolExecutionCommandTracker(options: {
  store: StructuredSessionStateStore;
  promptContext: PromptExecutionContext;
}): ToolExecutionCommandTracker {
  const commandIdByToolCallId = new Map<string, string>();

  return {
    handleToolExecutionStart(input) {
      if (
        SPECIALIZED_TOOL_NAMES.has(input.toolName) ||
        commandIdByToolCallId.has(input.toolCallId)
      ) {
        return;
      }

      const command = options.store.createCommand({
        turnId: options.promptContext.turnId,
        threadId: options.promptContext.rootThreadId,
        toolName: input.toolName,
        executor: inferExecutor(input.toolName),
        visibility: inferVisibility(input.toolName),
        title: inferTitle(input.toolName),
        summary: summarizeToolArguments(input.toolName, input.args),
      });
      options.store.startCommand(command.id);
      commandIdByToolCallId.set(input.toolCallId, command.id);
    },

    handleToolExecutionEnd(input) {
      const commandId = commandIdByToolCallId.get(input.toolCallId);
      if (!commandId) {
        return;
      }

      const resultText = summarizeToolResult(input.result);
      options.store.finishCommand({
        commandId,
        status: input.isError ? "failed" : "succeeded",
        summary:
          resultText ??
          (input.isError
            ? `${input.toolName} failed.`
            : `${input.toolName} completed successfully.`),
        error: input.isError ? (resultText ?? `${input.toolName} failed.`) : null,
      });
      commandIdByToolCallId.delete(input.toolCallId);
    },

    finishDanglingCommands(input) {
      for (const commandId of commandIdByToolCallId.values()) {
        options.store.finishCommand({
          commandId,
          status: input.status,
          summary: input.error,
          error: input.error,
        });
      }
      commandIdByToolCallId.clear();
    },
  };
}

function inferExecutor(toolName: string): StructuredCommandExecutor {
  if (toolName.startsWith("api.")) {
    return "execute_typescript";
  }

  return "orchestrator";
}

function inferVisibility(toolName: string): StructuredCommandVisibility {
  if (toolName.startsWith("api.")) {
    return "trace";
  }

  return "summary";
}

function inferTitle(toolName: string): string {
  if (toolName.startsWith("api.")) {
    return `Call ${toolName}`;
  }

  return `Run ${toolName}`;
}

function summarizeToolArguments(toolName: string, args: unknown): string {
  const preview = safePreview(args);
  return preview ? `${toolName}(${preview})` : `Call ${toolName}.`;
}

function summarizeToolResult(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return typeof result === "string" && result.trim() ? result.trim() : null;
  }

  const content = "content" in result ? (result as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .flatMap((block) => {
      if (!block || typeof block !== "object" || !("type" in block)) {
        return [];
      }

      if (
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return [(block as { text: string }).text];
      }

      return [];
    })
    .join("\n")
    .trim();

  return text || null;
}

function safePreview(value: unknown, limit = 160): string {
  if (value === undefined) {
    return "";
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return "";
    }
    if (serialized.length <= limit) {
      return serialized;
    }
    return `${serialized.slice(0, limit - 1).trimEnd()}…`;
  } catch {
    return "";
  }
}
