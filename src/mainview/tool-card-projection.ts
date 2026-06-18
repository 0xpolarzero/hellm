import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  WorkspaceCommandDiagnosticSnapshot,
  WorkspaceCommandOutputEvent,
  WorkspaceCommandPatchSnapshot,
  WorkspaceCommandRollup,
  WorkspaceCommandRollupChild,
} from "../shared/workspace-contract";
import type {
  TranscriptStatus,
  TranscriptToolCall,
  TranscriptToolMetric,
  TranscriptToolSection,
} from "./transcript-tool-card-model";

const TRANSCRIPT_SECTION_LIMIT = 8000;

type RawToolProjectionInput = {
  id: string;
  name: string;
  argumentsValue?: unknown;
  result?: string | null;
  status: TranscriptStatus;
  isError?: boolean;
  attempt?: number;
  totalAttempts?: number;
};

export function projectCommandToolCall(command: WorkspaceCommandRollup): TranscriptToolCall {
  const sections = commandSections(command);
  const patchStats = summarizePatchStats(command.patchSnapshots ?? []);
  const diagnostics = (command.diagnostics ?? []).flatMap((snapshot) => snapshot.diagnostics);
  const outputEvents = command.outputEvents ?? [];
  const lifecycle = [
    { label: "Started", value: formatTimestampShort(command.startedAt) },
    ...(command.finishedAt
      ? [{ label: "Finished", value: formatTimestampShort(command.finishedAt) }]
      : []),
    ...(command.argumentSnapshots?.length
      ? [{ label: "Args", value: `${command.argumentSnapshots.length} snapshots` }]
      : []),
    ...(command.progressEvents?.length
      ? [{ label: "Progress", value: `${command.progressEvents.length} events` }]
      : []),
  ];
  const metrics = compactMetrics([
    metric("Duration", formatDuration(command.startedAt, command.finishedAt ?? command.updatedAt)),
    patchStats.fileCount > 0 ? metric("Files", String(patchStats.fileCount)) : null,
    patchStats.fileCount > 0
      ? metric("Diff", `+${patchStats.additions} / -${patchStats.deletions}`)
      : null,
    diagnostics.length > 0
      ? metric("Diagnostics", String(diagnostics.length), worstDiagnosticTone(diagnostics))
      : null,
    outputEvents.length > 0 ? metric("Output", `${outputEvents.length} chunks`) : null,
    command.summaryChildCount > 0 ? metric("Children", `${command.summaryChildCount} shown`) : null,
    command.artifacts?.length ? metric("Artifacts", String(command.artifacts.length)) : null,
    exitCodeMetric(command),
  ]);

  return {
    id: command.commandId,
    name: command.toolName,
    title: command.title,
    target: commandTarget(command),
    commandId: command.commandId,
    status: commandTranscriptStatus(command.status),
    summary: command.summary,
    outcome: commandOutcome(command),
    duration: formatDuration(command.startedAt, command.finishedAt ?? command.updatedAt),
    isError: command.status === "failed",
    lifecycle,
    metrics,
    sections,
    children: command.summaryChildren.map(commandChild),
    artifacts: command.artifacts?.map((artifact) => ({
      id: artifact.artifactId,
      name: artifact.name,
      path: artifact.path,
    })),
  };
}

export function projectRawToolCall(input: RawToolProjectionInput): TranscriptToolCall {
  const body = toolInputBody(input.name, input.argumentsValue);
  const sections: TranscriptToolSection[] = [
    ...(body ? [{ id: "arguments", title: "Arguments", content: truncateSection(body) }] : []),
    ...(input.result
      ? [
          {
            id: input.isError ? "error-output" : "output",
            title: input.isError ? "Error output" : "Output",
            content: truncateSection(input.result),
            tone: input.isError ? "failed" : undefined,
          } satisfies TranscriptToolSection,
        ]
      : []),
  ];
  return {
    id: input.id,
    name: input.name,
    title: `Run ${input.name}`,
    target: commandTargetFromArgs(input.name, input.argumentsValue),
    status: input.status,
    outcome: input.result ? firstUsefulLine(input.result) : null,
    body,
    result: input.result,
    isError: input.isError,
    attempt: input.attempt,
    totalAttempts: input.totalAttempts,
    sections,
  };
}

export function toolInputBody(toolName: string, argumentsValue: unknown): string | null {
  const executeBody = executeTypescriptBody(toolName, argumentsValue);
  if (executeBody) return executeBody;
  if (typeof argumentsValue === "undefined" || argumentsValue === null || argumentsValue === "") {
    return null;
  }
  if (typeof argumentsValue === "string") return argumentsValue;
  try {
    return JSON.stringify(argumentsValue, null, 2);
  } catch {
    return String(argumentsValue);
  }
}

function commandSections(command: WorkspaceCommandRollup): TranscriptToolSection[] {
  const sections: TranscriptToolSection[] = [];
  const commandDetails = commandDetailsText(command);
  if (commandDetails) {
    sections.push({
      id: "command",
      title: commandSectionTitle(command),
      content: truncateSection(commandDetails),
    });
  }

  const latestArgs = command.argumentSnapshots?.at(-1)?.arguments ?? command.arguments;
  const argumentBody = toolInputBody(command.toolName, latestArgs);
  if (argumentBody && argumentBody !== commandDetails) {
    sections.push({
      id: "arguments",
      title: command.argumentSnapshots?.length ? "Latest accepted arguments" : "Arguments",
      content: truncateSection(argumentBody),
    });
  }

  const patchPreview = patchPreviewText(command.patchSnapshots ?? []);
  if (patchPreview) {
    sections.push({ id: "patch", title: "File changes", content: truncateSection(patchPreview) });
  }

  const diagnostics = diagnosticText(command.diagnostics ?? []);
  if (diagnostics) {
    sections.push({
      id: "diagnostics",
      title: "Diagnostics",
      content: truncateSection(diagnostics),
      tone: diagnostics.includes("error:") ? "failed" : "waiting",
      defaultOpen: command.status === "failed",
    });
  }

  const progress = progressText(command);
  if (progress) {
    sections.push({ id: "progress", title: "Progress", content: truncateSection(progress) });
  }

  const stdout = outputText(command.outputEvents ?? [], "stdout");
  if (stdout) {
    sections.push({ id: "stdout", title: "Stdout", content: truncateSection(stdout) });
  }

  const stderr = outputText(command.outputEvents ?? [], "stderr");
  if (stderr) {
    sections.push({
      id: "stderr",
      title: "Stderr",
      content: truncateSection(stderr),
      tone: command.status === "failed" ? "failed" : "waiting",
      defaultOpen: command.status === "failed",
    });
  }

  if (!sections.length && command.error) {
    sections.push({
      id: "error",
      title: "Error",
      content: truncateSection(command.error),
      tone: "failed",
    });
  }
  return sections;
}

function truncateSection(text: string): string {
  if (text.length <= TRANSCRIPT_SECTION_LIMIT) return text;
  return `${text.slice(0, TRANSCRIPT_SECTION_LIMIT).trimEnd()}\n\n[${text.length - TRANSCRIPT_SECTION_LIMIT} characters omitted. Inspect the command for full output.]`;
}

function commandDetailsText(command: WorkspaceCommandRollup): string | null {
  const args = objectRecord(command.argumentSnapshots?.at(-1)?.arguments ?? command.arguments);
  const facts = objectRecord(command.facts);
  const lines: string[] = [];
  const commandText = firstString(args, facts, ["cmd", "command", "shellCommand"]);
  const cwd = firstString(args, facts, ["cwd", "workdir", "workingDirectory"]);
  const approval = firstString(args, facts, [
    "approvalMode",
    "approval_mode",
    "sandbox_permissions",
  ]);
  const network = firstString(args, facts, ["networkAccess", "network_access"]);
  if (commandText) lines.push(`command: ${commandText}`);
  if (cwd) lines.push(`cwd: ${cwd}`);
  if (approval) lines.push(`approval: ${approval}`);
  if (network) lines.push(`network: ${network}`);
  return lines.length ? lines.join("\n") : null;
}

function commandSectionTitle(command: WorkspaceCommandRollup): string {
  if (command.toolName === "exec_command" || command.toolName === "write_stdin") return "Command";
  if (command.toolName === "apply_patch") return "Patch request";
  if (command.toolName === "execute_typescript") return "TypeScript source";
  if (command.toolName.startsWith("thread_")) return "Thread control";
  if (command.toolName === "request_user_input") return "User input request";
  return "Execution";
}

function commandTarget(command: WorkspaceCommandRollup): string | null {
  const target = commandTargetFromArgs(
    command.toolName,
    command.argumentSnapshots?.at(-1)?.arguments ?? command.arguments,
  );
  if (target) return target;
  const patchStats = summarizePatchStats(command.patchSnapshots ?? []);
  if (patchStats.fileCount > 0) return `${patchStats.fileCount} files`;
  return null;
}

function commandTargetFromArgs(toolName: string, argumentsValue: unknown): string | null {
  const args = objectRecord(argumentsValue);
  if (!args) return null;
  if (toolName === "exec_command" || toolName === "write_stdin") {
    return firstString(args, null, ["cmd", "command", "chars"]);
  }
  if (toolName === "execute_typescript") return "TypeScript snippet";
  if (toolName === "apply_patch") return "Workspace patch";
  if (toolName === "request_user_input") return firstString(args, null, ["title", "prompt"]);
  if (toolName.startsWith("thread_")) {
    const threadObjective = firstThreadObjective(args);
    if (threadObjective) return threadObjective;
    return firstString(args, null, ["objective", "threadId", "threadGroupId"]);
  }
  return firstString(args, null, ["path", "filename", "command", "name", "id"]);
}

function firstThreadObjective(args: Record<string, unknown>): string | null {
  const threads = args.threads;
  if (!Array.isArray(threads)) return null;
  for (const thread of threads) {
    const objective = objectRecord(thread)?.objective;
    if (typeof objective === "string" && objective.trim()) return objective.trim();
  }
  return null;
}

function commandOutcome(command: WorkspaceCommandRollup): string | null {
  if (command.status === "failed") {
    return (
      command.error ||
      firstDiagnosticMessage(command.diagnostics ?? []) ||
      firstStderrLine(command.outputEvents ?? []) ||
      command.summary
    );
  }
  const patchStats = summarizePatchStats(command.patchSnapshots ?? []);
  if (patchStats.fileCount > 0) {
    return `Changed ${patchStats.fileCount} ${patchStats.fileCount === 1 ? "file" : "files"} (+${patchStats.additions} / -${patchStats.deletions}).`;
  }
  if (command.artifacts?.length) {
    return `${command.summary} ${command.artifacts.length} artifact${command.artifacts.length === 1 ? "" : "s"} linked.`;
  }
  return command.summary || firstOutputLine(command.outputEvents ?? []) || null;
}

function commandChild(child: WorkspaceCommandRollupChild) {
  return {
    id: child.commandId,
    title: child.title,
    summary: child.summary,
    status: commandTranscriptStatus(child.status),
  };
}

function executeTypescriptBody(toolName: string, argumentsValue: unknown): string | null {
  if (toolName !== "execute_typescript") return null;
  const args = objectRecord(argumentsValue);
  const body = args?.typescriptCode;
  return typeof body === "string" && body.length > 0 ? body : null;
}

function patchPreviewText(snapshots: WorkspaceCommandPatchSnapshot[]): string | null {
  const latest = snapshots.at(-1);
  if (!latest?.files.length) return null;
  return latest.files
    .map((file) => `${file.changeType}: ${file.path} (+${file.additions} / -${file.deletions})`)
    .join("\n");
}

function diagnosticText(snapshots: WorkspaceCommandDiagnosticSnapshot[]): string | null {
  const lines = snapshots.flatMap((snapshot) =>
    snapshot.diagnostics.map((diagnostic) => {
      const location = diagnostic.file
        ? ` (${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}${diagnostic.column ? `:${diagnostic.column}` : ""})`
        : "";
      return `${diagnostic.severity ?? "diagnostic"}: ${diagnostic.message}${location}`;
    }),
  );
  return lines.length ? lines.join("\n") : null;
}

function progressText(command: WorkspaceCommandRollup): string | null {
  const lines = command.progressEvents?.map((event) =>
    [
      event.phase ? `[${event.phase}]` : "[progress]",
      event.message || [event.family, event.command].filter(Boolean).join(" · "),
      typeof event.progress === "number" ? `${Math.round(event.progress * 100)}%` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  return lines?.length ? lines.join("\n") : null;
}

function outputText(
  events: WorkspaceCommandOutputEvent[],
  stream: "stdout" | "stderr",
): string | null {
  let text = "";
  let totalLength = 0;
  for (const event of events) {
    if (event.stream !== stream) continue;
    totalLength += event.text.length;
    if (text.length < TRANSCRIPT_SECTION_LIMIT) {
      text += event.text.slice(0, TRANSCRIPT_SECTION_LIMIT - text.length);
    }
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (totalLength <= TRANSCRIPT_SECTION_LIMIT) return trimmed;
  return `${trimmed}\n\n[${totalLength - TRANSCRIPT_SECTION_LIMIT} characters omitted. Inspect the command for full output.]`;
}

function summarizePatchStats(snapshots: WorkspaceCommandPatchSnapshot[]) {
  const latest = snapshots.at(-1);
  return {
    fileCount: latest?.files.length ?? 0,
    additions: latest?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0,
    deletions: latest?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0,
  };
}

function firstDiagnosticMessage(snapshots: WorkspaceCommandDiagnosticSnapshot[]): string | null {
  const diagnostic = snapshots.flatMap((snapshot) => snapshot.diagnostics).find(Boolean);
  return diagnostic ? `${diagnostic.severity ?? "diagnostic"}: ${diagnostic.message}` : null;
}

function firstStderrLine(events: WorkspaceCommandOutputEvent[]): string | null {
  const stderr = outputText(events, "stderr");
  return stderr ? firstUsefulLine(stderr) : null;
}

function firstOutputLine(events: WorkspaceCommandOutputEvent[]): string | null {
  const output = outputText(events, "stdout") || outputText(events, "stderr");
  return output ? firstUsefulLine(output) : null;
}

function firstUsefulLine(text: string): string | null {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function compactMetrics(metrics: Array<TranscriptToolMetric | null>): TranscriptToolMetric[] {
  return metrics.filter((item): item is TranscriptToolMetric => Boolean(item)).slice(0, 6);
}

function metric(
  label: string,
  value: string | null,
  tone?: TranscriptStatus,
): TranscriptToolMetric | null {
  return value ? { label, value, tone } : null;
}

function exitCodeMetric(command: WorkspaceCommandRollup): TranscriptToolMetric | null {
  const exitCode = objectRecord(command.facts)?.exitCode;
  if (typeof exitCode !== "number" && typeof exitCode !== "string") return null;
  return {
    label: "Exit",
    value: String(exitCode),
    tone: String(exitCode) === "0" ? "done" : "failed",
  };
}

function worstDiagnosticTone(diagnostics: Array<{ severity?: string }>): TranscriptStatus {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "failed" : "waiting";
}

function commandTranscriptStatus(status: string): TranscriptStatus {
  if (status === "succeeded" || status === "completed" || status === "passed") return "done";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "blocked" || status === "troubleshooting") return "blocked";
  if (status === "waiting" || status === "requested") return "waiting";
  if (
    status === "streaming" ||
    status === "running" ||
    status === "running-handler" ||
    status === "running-workflow" ||
    status === "continued"
  ) {
    return "running";
  }
  return "idle";
}

function formatDuration(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): string | null {
  if (!startedAt || !finishedAt) return null;
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  const elapsedMs = finished - started;
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  if (elapsedMs < 60_000) return `${(elapsedMs / 1000).toFixed(elapsedMs < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.round((elapsedMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTimestampShort(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function firstString(
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = primary?.[key] ?? secondary?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function toolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
