import type { PromptExecutionContext } from "./prompt-execution-context";
import type { AppLoggerEvent } from "./app-logger";
import type { AppLogSource } from "../shared/workspace-contract";
import type {
  StructuredCommandExecutor,
  StructuredCommandStatus,
  StructuredCommandVisibility,
  StructuredSessionStateStore,
  StructuredTurnDecision,
} from "./structured-session-state";
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
  onAppLog?: (event: AppLoggerEvent) => void;
  onReusedStreamingToolCall?: (toolCallId: string) => void;
}): ToolExecutionCommandTracker {
  const commandIdByToolCallId = new Map<string, string>();
  const toolNameByCommandId = new Map<string, string>();
  const logSourceByCommandId = new Map<string, AppLogSource>();

  return {
    handleToolExecutionStart(input) {
      const toolName = input.toolName;
      const args = input.args;
      if (SPECIALIZED_TOOL_NAMES.has(toolName) || commandIdByToolCallId.has(input.toolCallId)) {
        return;
      }

      const turnDecision = turnDecisionForTool(toolName);
      if (turnDecision) {
        options.store.setTurnDecision({
          turnId: options.promptContext.turnId,
          decision: turnDecision,
          onlyIfPending: true,
        });
      }

      let commandId: string;
      const existingStreaming = options.store.findCommandByToolCallId(input.toolCallId);
      if (existingStreaming) {
        commandId = existingStreaming.id;
        options.store.updateCommandArguments(commandId, args);
        options.onReusedStreamingToolCall?.(input.toolCallId);
      } else {
        const command = options.store.createCommand({
          turnId: options.promptContext.turnId,
          threadId: options.promptContext.surfaceThreadId ?? options.promptContext.rootThreadId,
          toolName,
          executor: inferExecutor(toolName, options.promptContext),
          visibility: inferVisibility(toolName),
          title: inferTitle(toolName),
          summary: summarizeToolArguments(toolName, args),
          arguments: args,
          facts: { toolCallId: input.toolCallId },
        });
        commandId = command.id;
      }
      options.store.startCommand(commandId);
      recordCommandStartEvents({
        args,
        commandId,
        sessionId: options.promptContext.sessionId,
        store: options.store,
        toolName,
      });
      commandIdByToolCallId.set(input.toolCallId, commandId);
      toolNameByCommandId.set(commandId, toolName);
      const source = directToolLogSource(toolName, args);
      logSourceByCommandId.set(commandId, source);
      options.onAppLog?.({
        level: "info",
        source,
        message: directToolLogMessage(source, "started"),
        details: directToolLogDetails(options.promptContext, commandId, toolName),
      });
    },

    handleToolExecutionEnd(input) {
      const toolName = input.toolName;
      const commandId = commandIdByToolCallId.get(input.toolCallId);
      if (!commandId) {
        return;
      }

      const resultText = summarizeToolResult(input.result);
      const status = inferCommandFinalStatus(input);
      const summary =
        resultText ??
        (status === "failed" ? `${input.toolName} failed.` : `${toolName} completed successfully.`);
      recordCommandResultEvents({
        store: options.store,
        sessionId: options.promptContext.sessionId,
        commandId,
        toolName,
        result: input.result,
      });
      options.store.finishCommand({
        commandId,
        status,
        summary,
        facts: readCommandFacts(input.result),
        error: status === "failed" ? summary : null,
      });
      options.onAppLog?.({
        level: status === "failed" ? "warning" : "info",
        source: logSourceByCommandId.get(commandId) ?? "direct-tool",
        message: directToolLogMessage(
          logSourceByCommandId.get(commandId) ?? "direct-tool",
          status === "failed" ? "failed" : "finished",
        ),
        details: {
          ...directToolLogDetails(options.promptContext, commandId, toolName),
          ...(status === "failed" ? { errorMessage: summary } : {}),
        },
      });
      commandIdByToolCallId.delete(input.toolCallId);
      toolNameByCommandId.delete(commandId);
      logSourceByCommandId.delete(commandId);
    },

    finishDanglingCommands(input) {
      for (const commandId of commandIdByToolCallId.values()) {
        const toolName = toolNameByCommandId.get(commandId) ?? "unknown";
        options.store.finishCommand({
          commandId,
          status: input.status,
          summary: input.error,
          error: input.error,
        });
        options.onAppLog?.({
          level: "warning",
          source: logSourceByCommandId.get(commandId) ?? "direct-tool",
          message: directToolLogMessage(
            logSourceByCommandId.get(commandId) ?? "direct-tool",
            input.status === "cancelled" ? "cancelled" : "failed",
          ),
          details: {
            ...directToolLogDetails(options.promptContext, commandId, toolName),
            errorMessage: input.error,
          },
        });
      }
      commandIdByToolCallId.clear();
      toolNameByCommandId.clear();
      logSourceByCommandId.clear();
    },
  };
}

function recordCommandStartEvents(input: {
  args: unknown;
  commandId: string;
  sessionId: string;
  store: StructuredSessionStateStore;
  toolName: string;
}): void {
  if (input.toolName !== "apply_patch") {
    return;
  }
  const patch = readPatchArgument(input.args);
  if (!patch) {
    return;
  }
  const files = parsePatchSnapshotFiles(patch);
  if (files.length === 0) {
    return;
  }
  input.store.recordLifecycleEvent({
    sessionId: input.sessionId,
    kind: "command.patch_snapshot",
    subjectKind: "command",
    subjectId: input.commandId,
    data: {
      source: "accepted-arguments",
      files,
    },
  });
}

function directToolLogSource(toolName: string, args: unknown): AppLogSource {
  if (toolName === "exec_command" && readsSmithersCommand(args)) {
    return "smithers";
  }
  return "direct-tool";
}

function directToolLogMessage(
  source: AppLogSource,
  status: "started" | "finished" | "failed" | "cancelled",
): string {
  if (source === "smithers") {
    return `Smithers CLI command ${status}.`;
  }
  return `Direct tool ${status}.`;
}

function readsSmithersCommand(args: unknown): boolean {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }
  const command = (args as { cmd?: unknown; command?: unknown }).cmd;
  const commandText =
    typeof command === "string"
      ? command
      : typeof (args as { command?: unknown }).command === "string"
        ? (args as { command: string }).command
        : "";
  return /(?:^|[;&|]\s*)smithers(?:\s|$)/.test(commandText.trim());
}

function directToolLogDetails(
  promptContext: PromptExecutionContext,
  commandId: string,
  toolName: string,
): Record<string, unknown> & {
  workspaceSessionId: string;
  surfacePiSessionId: string;
  threadId?: string;
  commandId: string;
} {
  const threadId = promptContext.surfaceThreadId ?? promptContext.rootThreadId ?? undefined;
  return {
    workspaceSessionId: promptContext.sessionId,
    surfacePiSessionId: promptContext.surfacePiSessionId,
    ...(threadId ? { threadId } : {}),
    commandId,
    toolName,
  };
}

function turnDecisionForTool(toolName: string): Exclude<StructuredTurnDecision, "pending"> | null {
  if (
    toolName === "reply" ||
    toolName === "exec_command" ||
    toolName === "write_stdin" ||
    toolName === "apply_patch" ||
    toolName === "execute_typescript" ||
    toolName === "list_extensions" ||
    toolName === "load_extension" ||
    toolName === "thread_start" ||
    toolName === "thread_followup" ||
    toolName === "thread_request_report" ||
    toolName === "thread_group" ||
    toolName === "thread_report" ||
    toolName === "thread_episodes" ||
    toolName === "request_user_input"
  ) {
    return toolName;
  }
  return null;
}

function inferExecutor(
  _toolName: string,
  promptContext: Pick<PromptExecutionContext, "surfaceKind">,
): StructuredCommandExecutor {
  return promptContext.surfaceKind === "handler" ? "handler" : "orchestrator";
}

function inferVisibility(toolName: string): StructuredCommandVisibility {
  if (["read", "grep", "find", "ls"].includes(toolName)) {
    return "trace";
  }

  return "summary";
}

function inferTitle(toolName: string): string {
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

function inferCommandFinalStatus(input: {
  result: unknown;
  isError: boolean;
}): Extract<StructuredCommandStatus, "succeeded" | "failed"> {
  if (input.isError) {
    return "failed";
  }
  const payload = readResultPayload(input.result);
  return payload && (payload as { ok?: unknown }).ok === false ? "failed" : "succeeded";
}

function recordCommandResultEvents(input: {
  store: StructuredSessionStateStore;
  sessionId: string;
  commandId: string;
  toolName: string;
  result: unknown;
}): void {
  if (input.toolName !== "exec_command") {
    return;
  }

  const payload = readResultPayload(input.result);
  const stdout = readStringProperty(payload, "stdout");
  const stderr = readStringProperty(payload, "stderr");
  const hasLiveStdout = hasLiveCommandOutputEvent(
    input.store,
    input.sessionId,
    input.commandId,
    "stdout",
  );
  const hasLiveStderr = hasLiveCommandOutputEvent(
    input.store,
    input.sessionId,
    input.commandId,
    "stderr",
  );
  if (stdout && !hasLiveStdout) {
    input.store.recordLifecycleEvent({
      sessionId: input.sessionId,
      kind: "command.output",
      subjectKind: "command",
      subjectId: input.commandId,
      data: {
        stream: "stdout",
        source: "final-result",
        text: stdout,
      },
    });
  }
  if (stderr && !hasLiveStderr) {
    input.store.recordLifecycleEvent({
      sessionId: input.sessionId,
      kind: "command.output",
      subjectKind: "command",
      subjectId: input.commandId,
      data: {
        stream: "stderr",
        source: "final-result",
        text: stderr,
      },
    });
  }
  if (stdout || stderr) {
    return;
  }
  if (hasAnyLiveCommandOutputEvent(input.store, input.sessionId, input.commandId)) {
    return;
  }

  const resultText = summarizeToolResult(input.result);
  if (!resultText) {
    return;
  }
  input.store.recordLifecycleEvent({
    sessionId: input.sessionId,
    kind: "command.output",
    subjectKind: "command",
    subjectId: input.commandId,
    data: {
      stream: "stdout",
      source: "final-result",
      text: resultText,
    },
  });
}

function hasLiveCommandOutputEvent(
  store: StructuredSessionStateStore,
  sessionId: string,
  commandId: string,
  stream: "stdout" | "stderr",
): boolean {
  return store
    .getSessionState(sessionId)
    .events.some(
      (event) =>
        event.kind === "command.output" &&
        event.subject.kind === "command" &&
        event.subject.id === commandId &&
        event.data?.stream === stream &&
        event.data?.source === "live-stream",
    );
}

function hasAnyLiveCommandOutputEvent(
  store: StructuredSessionStateStore,
  sessionId: string,
  commandId: string,
): boolean {
  return store
    .getSessionState(sessionId)
    .events.some(
      (event) =>
        event.kind === "command.output" &&
        event.subject.kind === "command" &&
        event.subject.id === commandId &&
        event.data?.source === "live-stream",
    );
}

function readPatchArgument(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return null;
  }
  const patch = (args as { patch?: unknown }).patch;
  return typeof patch === "string" && patch.length > 0 ? patch : null;
}

function parsePatchSnapshotFiles(patch: string): {
  path: string;
  changeType: "created" | "deleted" | "modified";
  additions: number;
  deletions: number;
}[] {
  const applyPatchFiles = parseApplyPatchEnvelopeFiles(patch);
  if (applyPatchFiles.length > 0) {
    return applyPatchFiles;
  }
  return parseUnifiedDiffFiles(patch);
}

function parseApplyPatchEnvelopeFiles(patch: string): {
  path: string;
  changeType: "created" | "deleted" | "modified";
  additions: number;
  deletions: number;
}[] {
  const files: {
    path: string;
    changeType: "created" | "deleted" | "modified";
    additions: number;
    deletions: number;
  }[] = [];
  let current: (typeof files)[number] | null = null;

  for (const line of patch.split(/\r?\n/)) {
    const header = parseApplyPatchFileHeader(line);
    if (header) {
      current = header;
      files.push(current);
      continue;
    }
    if (!current || line.startsWith("***")) {
      continue;
    }
    if (line.startsWith("+")) {
      current.additions += 1;
    } else if (line.startsWith("-")) {
      current.deletions += 1;
    }
  }

  return files;
}

function parseApplyPatchFileHeader(line: string): {
  path: string;
  changeType: "created" | "deleted" | "modified";
  additions: number;
  deletions: number;
} | null {
  for (const [prefix, changeType] of [
    ["*** Add File: ", "created"],
    ["*** Delete File: ", "deleted"],
    ["*** Update File: ", "modified"],
  ] as const) {
    if (line.startsWith(prefix)) {
      const path = line.slice(prefix.length).trim();
      return path ? { path, changeType, additions: 0, deletions: 0 } : null;
    }
  }
  return null;
}

function parseUnifiedDiffFiles(patch: string): {
  path: string;
  changeType: "created" | "deleted" | "modified";
  additions: number;
  deletions: number;
}[] {
  const files: {
    path: string;
    changeType: "created" | "deleted" | "modified";
    additions: number;
    deletions: number;
  }[] = [];
  let current: (typeof files)[number] | null = null;
  const lines = patch.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const oldPath = parseUnifiedDiffPath(lines[index], "--- ");
    if (oldPath !== undefined) {
      const newPath = parseUnifiedDiffPath(lines[index + 1], "+++ ");
      if (newPath !== undefined) {
        current = {
          path: newPath ?? oldPath ?? "",
          changeType: oldPath === null ? "created" : newPath === null ? "deleted" : "modified",
          additions: 0,
          deletions: 0,
        };
        if (current.path) {
          files.push(current);
        }
        index += 1;
      }
      continue;
    }
    if (!current || lines[index]?.startsWith("@@")) {
      continue;
    }
    const line = lines[index] ?? "";
    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      current.additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("--- ")) {
      current.deletions += 1;
    }
  }

  return files;
}

function parseUnifiedDiffPath(
  line: string | undefined,
  prefix: "--- " | "+++ ",
): string | null | undefined {
  if (!line?.startsWith(prefix)) {
    return undefined;
  }
  const rawPath = line.slice(prefix.length).split(/\t| /, 1)[0]?.trim();
  if (!rawPath) {
    return undefined;
  }
  if (rawPath === "/dev/null") {
    return null;
  }
  return rawPath.startsWith("a/") || rawPath.startsWith("b/") ? rawPath.slice(2) : rawPath;
}

function readStringProperty(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readCommandFacts(result: unknown): Record<string, unknown> | null {
  const errorPayload = readErrorPayload(result);
  if (errorPayload) {
    return readPayloadCommandFacts(errorPayload);
  }
  if (!result || typeof result !== "object" || !("details" in result)) {
    return null;
  }
  const details = (result as { details?: unknown }).details;
  return readPayloadCommandFacts(details);
}

function readResultPayload(result: unknown): unknown | null {
  const errorPayload = readErrorPayload(result);
  if (errorPayload) {
    return errorPayload;
  }
  if (!result || typeof result !== "object" || !("details" in result)) {
    return null;
  }
  return (result as { details?: unknown }).details;
}

function readPayloadCommandFacts(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const facts = (payload as { commandFacts?: unknown }).commandFacts;
  if (facts && typeof facts === "object" && !Array.isArray(facts)) {
    return facts as Record<string, unknown>;
  }
  return payload as Record<string, unknown>;
}

function readErrorPayload(result: unknown): unknown | null {
  if (!(result instanceof Error)) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.message);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
