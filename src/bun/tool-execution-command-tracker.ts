import { getNativeToolCommandMetadata } from "@svvy/extensions";
import * as Effect from "effect/Effect";
import type { AppLoggerEvent } from "./app-logger";
import type { AppLogSource } from "../shared/workspace-contract";
import type { RuntimeStateWriteLane } from "./ordered-runtime-state-write-lane";
import type {
  CommandFactsPayload,
  JsonValue,
  PromptExecutionContext,
  RuntimeCommandExecutor,
  RuntimeCommandStatePortService,
  RuntimeCommandStatus,
  RuntimeTurnStatePortService,
  SurfacePiSessionId,
} from "@svvy/core";

export interface ToolExecutionCommandTracker {
  handleToolExecutionStart(input: { toolCallId: string; toolName: string; args: unknown }): void;
  handleToolExecutionEnd(input: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
  }): void;
  finishDanglingCommands(input: {
    status: Extract<RuntimeCommandStatus, "failed" | "cancelled">;
    error: string;
  }): void;
}

export function createToolExecutionCommandTracker(options: {
  commandState: RuntimeCommandStatePortService;
  promptContext: PromptExecutionContext;
  stateWrites: RuntimeStateWriteLane;
  turnState?: RuntimeTurnStatePortService;
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
      const metadata = getNativeToolCommandMetadata(toolName);
      if (!metadata) {
        return;
      }
      if (
        metadata.executionCommand === "self-recorded-command" ||
        commandIdByToolCallId.has(input.toolCallId)
      ) {
        return;
      }

      const turnDecision = metadata.turnDecision;
      void options.stateWrites
        .enqueue(
          "tool-command.start",
          Effect.gen(function* () {
            if (turnDecision && options.promptContext.turnId && options.turnState) {
              yield* options.turnState.setTurnDecision({
                turnId: options.promptContext.turnId,
                decision: turnDecision,
                onlyIfPending: true,
              });
            }

            let commandId: string;
            const existingStreaming = yield* options.commandState.findCommandByToolCallId({
              toolCallId: input.toolCallId,
              surfacePiSessionId: options.promptContext.surfacePiSessionId as SurfacePiSessionId,
            });
            if (existingStreaming) {
              commandId = existingStreaming.id;
              yield* options.commandState.updateCommandArguments({
                commandId,
                arguments: toJsonValue(args),
              });
              yield* Effect.sync(() => options.onReusedStreamingToolCall?.(input.toolCallId));
            } else {
              const command = yield* options.commandState.createCommand({
                turnId: options.promptContext.turnId,
                workflowTaskAttemptId: options.promptContext.workflowTaskAttemptId,
                threadId: options.promptContext.threadId ?? options.promptContext.rootThreadId,
                workflowRunId: options.promptContext.workflowRunId,
                toolName,
                executor: inferExecutor(toolName, options.promptContext),
                visibility: metadata.visibility,
                title: inferTitle(toolName),
                summary: summarizeToolArguments(toolName, args),
                arguments: toJsonValue(args),
                facts: { toolCallId: input.toolCallId },
              });
              commandId = command.value.id;
            }
            yield* options.commandState.startCommand({ commandId });
            yield* recordCommandStartEvents({
              args,
              commandId,
              commandState: options.commandState,
              sessionId: options.promptContext.workspaceSessionId,
              toolName,
            });
            commandIdByToolCallId.set(input.toolCallId, commandId);
            toolNameByCommandId.set(commandId, toolName);
            const source = directToolLogSource(toolName, args);
            logSourceByCommandId.set(commandId, source);
            yield* Effect.sync(() =>
              options.onAppLog?.({
                level: "info",
                source,
                message: directToolLogMessage(source, "started"),
                details: directToolLogDetails(options.promptContext, commandId, toolName),
              }),
            );
          }),
        )
        .catch(() => undefined);
    },

    handleToolExecutionEnd(input) {
      const toolName = input.toolName;
      const resultText = summarizeToolResult(input.result);
      const status = inferCommandFinalStatus(input);
      const summary =
        resultText ??
        (status === "failed" ? `${input.toolName} failed.` : `${toolName} completed successfully.`);
      void options.stateWrites
        .enqueue(
          "tool-command.end",
          Effect.gen(function* () {
            const commandId = commandIdByToolCallId.get(input.toolCallId);
            if (!commandId) {
              return;
            }

            yield* recordCommandResultEvents({
              commandState: options.commandState,
              sessionId: options.promptContext.workspaceSessionId,
              commandId,
              toolName,
              result: input.result,
            });
            yield* options.commandState.finishCommand({
              commandId,
              status,
              summary,
              facts: readCommandFacts(input.result),
              error: status === "failed" ? summary : null,
            });
            yield* Effect.sync(() =>
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
              }),
            );
            commandIdByToolCallId.delete(input.toolCallId);
            toolNameByCommandId.delete(commandId);
            logSourceByCommandId.delete(commandId);
          }),
        )
        .catch(() => undefined);
    },

    finishDanglingCommands(input) {
      void options.stateWrites
        .enqueue(
          "tool-command.finish-dangling",
          Effect.gen(function* () {
            for (const commandId of commandIdByToolCallId.values()) {
              const toolName = toolNameByCommandId.get(commandId) ?? "unknown";
              yield* options.commandState.finishCommand({
                commandId,
                status: input.status,
                summary: input.error,
                error: input.error,
              });
              yield* Effect.sync(() =>
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
                }),
              );
            }
            commandIdByToolCallId.clear();
            toolNameByCommandId.clear();
            logSourceByCommandId.clear();
          }),
        )
        .catch(() => undefined);
    },
  };
}

function recordCommandStartEvents(input: {
  args: unknown;
  commandId: string;
  commandState: RuntimeCommandStatePortService;
  sessionId: string;
  toolName: string;
}) {
  if (input.toolName !== "apply_patch") {
    return Effect.succeed(undefined);
  }
  const patch = readPatchArgument(input.args);
  if (!patch) {
    return Effect.succeed(undefined);
  }
  const files = parsePatchSnapshotFiles(patch);
  if (files.length === 0) {
    return Effect.succeed(undefined);
  }
  return input.commandState.recordCommandEvent({
    sessionId: input.sessionId,
    commandId: input.commandId,
    kind: "command.patch_snapshot",
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
  return /(?:^|[;&|]\s*)bunx\s+smthrs(?:\s|$)/.test(commandText.trim());
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
  const threadId = promptContext.threadId ?? promptContext.rootThreadId ?? undefined;
  return {
    workspaceSessionId: promptContext.workspaceSessionId,
    surfacePiSessionId: promptContext.surfacePiSessionId,
    ...(promptContext.workflowRunId ? { workflowRunId: promptContext.workflowRunId } : {}),
    ...(promptContext.workflowTaskAttemptId
      ? { workflowTaskAttemptId: promptContext.workflowTaskAttemptId }
      : {}),
    ...(threadId ? { threadId } : {}),
    commandId,
    toolName,
  };
}

function inferExecutor(
  _toolName: string,
  promptContext: Pick<PromptExecutionContext, "surfaceKind">,
): RuntimeCommandExecutor {
  if (promptContext.surfaceKind === "workflow-task") {
    return "workflow-task-agent";
  }
  return promptContext.surfaceKind === "handler" ? "handler" : "orchestrator";
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
}): Extract<RuntimeCommandStatus, "succeeded" | "failed"> {
  if (input.isError) {
    return "failed";
  }
  const payload = readResultPayload(input.result);
  return payload && (payload as { ok?: unknown }).ok === false ? "failed" : "succeeded";
}

function recordCommandResultEvents(input: {
  commandState: RuntimeCommandStatePortService;
  sessionId: string;
  commandId: string;
  toolName: string;
  result: unknown;
}) {
  if (input.toolName !== "exec_command") {
    return Effect.succeed(undefined);
  }

  const payload = readResultPayload(input.result);
  const stdout = readStringProperty(payload, "stdout");
  const stderr = readStringProperty(payload, "stderr");
  return Effect.gen(function* () {
    const hasLiveStdout = yield* input.commandState.hasCommandOutputEvent({
      sessionId: input.sessionId,
      commandId: input.commandId,
      stream: "stdout",
      source: "live-stream",
    });
    const hasLiveStderr = yield* input.commandState.hasCommandOutputEvent({
      sessionId: input.sessionId,
      commandId: input.commandId,
      stream: "stderr",
      source: "live-stream",
    });
    if (stdout && !hasLiveStdout) {
      yield* input.commandState.recordCommandEvent({
        sessionId: input.sessionId,
        commandId: input.commandId,
        kind: "command.output",
        data: {
          stream: "stdout",
          source: "final-result",
          text: stdout,
        },
      });
    }
    if (stderr && !hasLiveStderr) {
      yield* input.commandState.recordCommandEvent({
        sessionId: input.sessionId,
        commandId: input.commandId,
        kind: "command.output",
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
    const hasLiveOutput = yield* input.commandState.hasCommandOutputEvent({
      sessionId: input.sessionId,
      commandId: input.commandId,
      source: "live-stream",
    });
    if (hasLiveOutput) {
      return;
    }

    const resultText = summarizeToolResult(input.result);
    if (!resultText) {
      return;
    }
    yield* input.commandState.recordCommandEvent({
      sessionId: input.sessionId,
      commandId: input.commandId,
      kind: "command.output",
      data: {
        stream: "stdout",
        source: "final-result",
        text: resultText,
      },
    });
  });
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

function readCommandFacts(result: unknown): CommandFactsPayload | null {
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

function readPayloadCommandFacts(payload: unknown): CommandFactsPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const facts = (payload as { commandFacts?: unknown }).commandFacts;
  if (facts && typeof facts === "object" && !Array.isArray(facts)) {
    return toJsonObject(facts);
  }
  return toJsonObject(payload);
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

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return null;
  }
}

function toJsonObject(value: unknown): CommandFactsPayload | null {
  const json = toJsonValue(value);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }
  return json as CommandFactsPayload;
}
