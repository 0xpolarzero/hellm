import type { PromptExecutionContext } from "./prompt-execution-context";
import type {
  StructuredCommandExecutor,
  StructuredCommandStatus,
  StructuredCommandVisibility,
  StructuredSessionStateStore,
} from "./structured-session-state";
import {
  THREAD_CURRENT_TOOL_NAME,
  THREAD_HANDOFFS_TOOL_NAME,
  THREAD_LIST_TOOL_NAME,
} from "./runtime-state-tools";

const SPECIALIZED_TOOL_NAMES = new Set([
  "execute_typescript",
  "thread_start",
  "thread_resume",
  "request_context",
  "thread_handoff",
  "wait",
  THREAD_CURRENT_TOOL_NAME,
  THREAD_LIST_TOOL_NAME,
  THREAD_HANDOFFS_TOOL_NAME,
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
        input.toolName.startsWith("smithers_") ||
        commandIdByToolCallId.has(input.toolCallId)
      ) {
        return;
      }

      options.store.setTurnDecision({
        turnId: options.promptContext.turnId,
        decision: input.toolName as never,
        onlyIfPending: true,
      });
      const command = options.store.createCommand({
        turnId: options.promptContext.turnId,
        threadId: options.promptContext.surfaceThreadId ?? options.promptContext.rootThreadId,
        toolName: input.toolName,
        executor: inferExecutor(input.toolName, options.promptContext),
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
        facts: readCommandFacts(input.result),
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

function inferExecutor(
  toolName: string,
  promptContext: Pick<PromptExecutionContext, "surfaceKind">,
): StructuredCommandExecutor {
  if (toolName.startsWith("api.")) {
    return "execute_typescript";
  }

  return promptContext.surfaceKind === "handler" ? "handler" : "orchestrator";
}

function inferVisibility(toolName: string): StructuredCommandVisibility {
  if (toolName.startsWith("api.")) {
    return "trace";
  }
  if (
    [
      "read",
      "grep",
      "find",
      "ls",
      "workflow_list_assets",
      "workflow_list_models",
      "web_search",
    ].includes(toolName)
  ) {
    return "trace";
  }
  if (
    [
      "cx_overview",
      "cx_symbols",
      "cx_definition",
      "cx_references",
      "cx_lang_list",
      "cx_cache_path",
    ].includes(toolName)
  ) {
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

function readCommandFacts(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object" || !("details" in result)) {
    return null;
  }
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const facts = (details as { commandFacts?: unknown }).commandFacts;
  if (facts && typeof facts === "object" && !Array.isArray(facts)) {
    return facts as Record<string, unknown>;
  }
  return details as Record<string, unknown>;
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
