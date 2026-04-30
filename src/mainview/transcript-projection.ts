import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  WorkspaceCommandRollup,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
} from "../shared/workspace-contract";

export interface ExecuteTypescriptResultSummary {
  success: boolean | null;
  resultPreview: string | null;
  logs: string[];
  diagnostics: Array<{
    severity?: string;
    message: string;
    file?: string;
    line?: number;
    column?: number;
    code?: string;
  }>;
  error: {
    message: string;
    name?: string;
    stage?: string;
    line?: number;
  } | null;
}

export type TranscriptSemanticBlock =
  | {
      kind: "wait";
      key: string;
      tone: "warning";
      title: string;
      summary: string;
      reason: string;
      resumeWhen: string;
      since: string;
      threadId?: string;
    }
  | {
      kind: "failure";
      key: string;
      tone: "danger";
      title: string;
      summary: string;
    }
  | {
      kind: "command-rollup";
      key: string;
      command: WorkspaceCommandRollup;
    }
  | {
      kind: "thread";
      key: string;
      thread: WorkspaceHandlerThreadSummary;
    }
  | {
      kind: "handoff-episode";
      key: string;
      thread: Pick<WorkspaceHandlerThreadSummary, "threadId" | "title">;
      episode: NonNullable<WorkspaceHandlerThreadSummary["latestEpisode"]>;
    };

export interface BuildTranscriptSemanticBlocksInput {
  session?: WorkspaceSessionSummary | null;
  errorMessage?: string | null;
  commandRollups?: WorkspaceCommandRollup[];
  handlerThreads?: WorkspaceHandlerThreadSummary[];
}

export function buildTranscriptSemanticBlocks(
  input: BuildTranscriptSemanticBlocksInput,
): TranscriptSemanticBlock[] {
  const blocks: TranscriptSemanticBlock[] = [];
  const wait = input.session?.wait;

  if (wait) {
    blocks.push({
      kind: "wait",
      key: `wait:${input.session?.id ?? "session"}:${wait.since}`,
      tone: "warning",
      title: `Waiting for ${wait.kind}`,
      summary: wait.threadId ? `Handler thread ${wait.threadId}` : "Current surface",
      reason: wait.reason,
      resumeWhen: wait.resumeWhen,
      since: wait.since,
      threadId: wait.threadId,
    });
  }

  const failureSummary =
    input.errorMessage?.trim() ||
    (input.session?.status === "error" ? input.session.preview.trim() : "");
  if (failureSummary) {
    blocks.push({
      kind: "failure",
      key: `failure:${input.session?.id ?? "session"}:${failureSummary}`,
      tone: "danger",
      title: "Turn failed",
      summary: failureSummary,
    });
  }

  for (const command of input.commandRollups ?? []) {
    if (command.visibility === "surface") continue;
    blocks.push({
      kind: "command-rollup",
      key: `command:${command.commandId}`,
      command,
    });
  }

  for (const thread of input.handlerThreads ?? []) {
    blocks.push({
      kind: "thread",
      key: `thread:${thread.threadId}`,
      thread,
    });

    if (thread.latestEpisode) {
      blocks.push({
        kind: "handoff-episode",
        key: `episode:${thread.threadId}:${thread.latestEpisode.episodeId}`,
        thread: {
          threadId: thread.threadId,
          title: thread.title,
        },
        episode: thread.latestEpisode,
      });
    }
  }

  return blocks;
}

export function summarizeExecuteTypescriptResult(
  message: ToolResultMessage,
): ExecuteTypescriptResultSummary | null {
  if (message.toolName !== "execute_typescript") return null;
  const rawText = message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  const parsed = parseJsonObject(rawText) ?? parseJsonObject(message.details);
  if (!parsed) {
    return {
      success: message.isError ? false : null,
      resultPreview: rawText || null,
      logs: [],
      diagnostics: [],
      error: message.isError && rawText ? { message: rawText } : null,
    };
  }

  const error = parseError(parsed.error);
  const diagnostics = parseDiagnostics(error?.diagnostics);

  return {
    success: typeof parsed.success === "boolean" ? parsed.success : message.isError ? false : null,
    resultPreview: typeof parsed.result === "undefined" ? null : previewValue(parsed.result, 360),
    logs: Array.isArray(parsed.logs)
      ? parsed.logs.filter((line): line is string => typeof line === "string")
      : [],
    diagnostics,
    error: error
      ? {
          message: error.message,
          name: error.name,
          stage: error.stage,
          line: error.line,
        }
      : null,
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseError(value: unknown): {
  message: string;
  name?: string;
  stage?: string;
  diagnostics?: unknown;
  line?: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string") return null;
  return {
    message: record.message,
    name: typeof record.name === "string" ? record.name : undefined,
    stage: typeof record.stage === "string" ? record.stage : undefined,
    diagnostics: record.diagnostics,
    line: typeof record.line === "number" ? record.line : undefined,
  };
}

function parseDiagnostics(value: unknown): ExecuteTypescriptResultSummary["diagnostics"] {
  if (!Array.isArray(value)) return [];
  const diagnostics: ExecuteTypescriptResultSummary["diagnostics"] = [];
  for (const diagnostic of value) {
    if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) continue;
    const record = diagnostic as Record<string, unknown>;
    if (typeof record.message !== "string") continue;
    diagnostics.push({
      severity: typeof record.severity === "string" ? record.severity : undefined,
      message: record.message,
      file: typeof record.file === "string" ? record.file : undefined,
      line: typeof record.line === "number" ? record.line : undefined,
      column: typeof record.column === "number" ? record.column : undefined,
      code: typeof record.code === "string" ? record.code : undefined,
    });
  }
  return diagnostics;
}

function previewValue(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
