import { existsSync } from "node:fs";
import type {
  StructuredArtifactRecord,
  StructuredCommandRecord,
  StructuredEpisodeRecord,
  StructuredLifecycleEventRecord,
  StructuredSessionSnapshot,
  StructuredSessionStatus,
  StructuredThreadRecord,
  StructuredTurnRecord,
  StructuredWorkflowRunRecord,
} from "./structured-session-state";
import { readContextBudgetFromMeta, type ContextBudget } from "../shared/context-budget";

export interface StructuredCommandRollupChild {
  commandId: string;
  toolName: string;
  status: StructuredCommandRecord["status"];
  title: string;
  summary: string;
  error: string | null;
}

export interface StructuredCommandRollup {
  commandId: string;
  threadId: string | null;
  workflowRunId?: string | null;
  workflowTaskAttemptId?: string | null;
  toolName: string;
  visibility: "summary" | "surface";
  status: StructuredCommandRecord["status"];
  title: string;
  summary: string;
  arguments?: unknown | null;
  facts?: Record<string, unknown> | null;
  error?: string | null;
  artifacts?: StructuredCommandArtifactLink[];
  outputEvents?: StructuredCommandOutputEvent[];
  argumentSnapshots?: StructuredCommandArgumentSnapshot[];
  progressEvents?: StructuredCommandProgressEvent[];
  patchSnapshots?: StructuredCommandPatchSnapshot[];
  diagnostics?: StructuredCommandDiagnosticSnapshot[];
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: StructuredCommandRollupChild[];
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredCommandArtifactLink {
  artifactId: string;
  kind: StructuredArtifactRecord["kind"];
  name: string;
  path?: string;
  createdAt: string;
  sourceCommandId?: string;
  workflowRunId?: string;
  workflowName?: string;
  producerLabel?: string;
  missingFile?: boolean;
}

export interface StructuredCommandOutputEvent {
  eventId: string;
  at: string;
  stream: "stdout" | "stderr";
  source: string;
  text: string;
}

export interface StructuredCommandProgressEvent {
  eventId: string;
  at: string;
  source: string;
  phase?: string;
  family?: string;
  command?: string;
  message?: string;
  progress?: number;
  facts?: Record<string, unknown>;
}

export interface StructuredCommandArgumentSnapshot {
  eventId: string;
  at: string;
  source: string;
  arguments: unknown;
}

export interface StructuredCommandPatchSnapshot {
  eventId: string;
  at: string;
  source: string;
  files: StructuredCommandPatchFile[];
}

export interface StructuredCommandPatchFile {
  path: string;
  changeType: "created" | "deleted" | "modified";
  additions: number;
  deletions: number;
}

export interface StructuredCommandDiagnosticSnapshot {
  eventId: string;
  at: string;
  source: string;
  stage?: "compile" | "typecheck" | "runtime" | string;
  diagnostics: StructuredCommandDiagnostic[];
}

export interface StructuredCommandDiagnostic {
  severity?: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface StructuredProductEvent {
  eventId: string;
  at: string;
  title: string;
  summary: string;
  subject: {
    kind: "session" | "thread";
    id: string;
  };
  details?: Record<string, unknown>;
}

export interface StructuredCommandInspectorChild extends StructuredCommandRollupChild {
  visibility: StructuredCommandRecord["visibility"];
  facts: Record<string, unknown> | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  artifacts: StructuredCommandArtifactLink[];
  outputEvents: StructuredCommandOutputEvent[];
  argumentSnapshots: StructuredCommandArgumentSnapshot[];
  progressEvents?: StructuredCommandProgressEvent[];
  patchSnapshots: StructuredCommandPatchSnapshot[];
  diagnostics: StructuredCommandDiagnosticSnapshot[];
}

export interface StructuredCommandInspector {
  commandId: string;
  threadId: string | null;
  workflowRunId?: string | null;
  workflowTaskAttemptId?: string | null;
  toolName: string;
  visibility: StructuredCommandRecord["visibility"];
  status: StructuredCommandRecord["status"];
  title: string;
  summary: string;
  facts: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  artifacts: StructuredCommandArtifactLink[];
  outputEvents: StructuredCommandOutputEvent[];
  argumentSnapshots: StructuredCommandArgumentSnapshot[];
  progressEvents?: StructuredCommandProgressEvent[];
  patchSnapshots: StructuredCommandPatchSnapshot[];
  diagnostics: StructuredCommandDiagnosticSnapshot[];
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: StructuredCommandInspectorChild[];
  traceChildren: StructuredCommandInspectorChild[];
}

export interface StructuredHandlerThreadWorkflowSummary {
  workflowRunId: string;
  workflowName: string;
  status: StructuredWorkflowRunRecord["status"];
  summary: string;
  updatedAt: string;
  artifacts: StructuredCommandArtifactLink[];
}

export interface StructuredHandlerThreadEpisodeSummary {
  episodeId: string;
  kind: StructuredEpisodeRecord["kind"];
  title: string;
  summary: string;
  createdAt: string;
}

export interface StructuredWorkflowTaskAttemptTranscriptMessage {
  messageId: string;
  role: StructuredSessionSnapshot["workflowTaskMessages"][number]["role"];
  source: StructuredSessionSnapshot["workflowTaskMessages"][number]["source"];
  text: string;
  createdAt: string;
}

export interface StructuredWorkflowTaskAttemptSummary {
  workflowTaskAttemptId: string;
  workflowRunId: string;
  smithersRunId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  title: string;
  kind: StructuredSessionSnapshot["workflowTaskAttempts"][number]["kind"];
  status: StructuredSessionSnapshot["workflowTaskAttempts"][number]["status"];
  summary: string;
  updatedAt: string;
  commandCount: number;
  artifactCount: number;
  transcriptMessageCount: number;
  contextBudget: ContextBudget | null;
}

export interface StructuredWorkflowTaskAttemptInspector extends StructuredWorkflowTaskAttemptSummary {
  surfacePiSessionId: string | null;
  smithersState: string;
  prompt: string | null;
  responseText: string | null;
  error: string | null;
  cached: boolean;
  jjPointer: string | null;
  jjCwd: string | null;
  heartbeatAt: string | null;
  agentId: string | null;
  agentModel: string | null;
  agentEngine: string | null;
  agentResume: string | null;
  generatedAgentContextFingerprint: string | null;
  generatedAgentContextBinding: {
    systemPrompt: string;
    generatedAgentContextRevision: number;
    loadedExtensionIds: string[];
    availableExtensionIds: string[];
    externalSourceHashes: string[];
  } | null;
  meta: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
  transcript: StructuredWorkflowTaskAttemptTranscriptMessage[];
  commandRollups: StructuredCommandRollup[];
  artifacts: StructuredCommandArtifactLink[];
}

export interface StructuredHandlerThreadSummary {
  threadId: string;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  objectiveState: StructuredThreadRecord["objectiveState"];
  historyMode: StructuredThreadRecord["historyMode"];
  status: StructuredThreadRecord["status"];
  wait: StructuredThreadRecord["wait"];
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  commandCount: number;
  workflowRunCount: number;
  workflowTaskAttemptCount: number;
  episodeCount: number;
  artifactCount: number;
  latestCommandRollup: StructuredCommandRollup | null;
  latestWorkflowRun: StructuredHandlerThreadWorkflowSummary | null;
  latestEpisode: StructuredHandlerThreadEpisodeSummary | null;
  workflowTaskAttempts?: StructuredWorkflowTaskAttemptSummary[];
}

export interface StructuredHandlerThreadInspector extends StructuredHandlerThreadSummary {
  commandRollups: StructuredCommandRollup[];
  workflowRuns: StructuredHandlerThreadWorkflowSummary[];
  workflowTaskAttempts: StructuredWorkflowTaskAttemptSummary[];
  episodes: StructuredHandlerThreadEpisodeSummary[];
  artifacts: StructuredCommandArtifactLink[];
}

export interface StructuredSidebarRowSubtitle {
  badge: "waiting" | "error" | "workflow" | "text";
  text: string;
  tone: "muted" | "waiting" | "error";
}

export interface StructuredSidebarWorkflowRow {
  workflowRunId: string;
  workflowName: string;
  status: StructuredWorkflowRunRecord["status"];
  subtitle: StructuredSidebarRowSubtitle | null;
  updatedAt: string;
}

export interface StructuredSidebarHandlerThreadRow {
  threadId: string;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  status: StructuredThreadRecord["status"];
  subtitle: StructuredSidebarRowSubtitle | null;
  latestCommandRollup: StructuredCommandRollup | null;
  updatedAt: string;
  workflows: StructuredSidebarWorkflowRow[];
}

export interface StructuredSessionView {
  title: string;
  sessionStatus: StructuredSessionStatus;
  wait: StructuredSessionSnapshot["session"]["wait"];
  counts: {
    turns: number;
    threads: number;
    commands: number;
    episodes: number;
    workflows: number;
    artifacts: number;
    events: number;
  };
  threadIdsByStatus: {
    runningHandler: string[];
    runningWorkflow: string[];
    waiting: string[];
    troubleshooting: string[];
  };
  threadIds: string[];
  latestEpisodePreview?: string | null;
  latestWorkflowRunSummary?: string | null;
  sidebarThreads: StructuredSidebarHandlerThreadRow[];
  commandRollups: StructuredCommandRollup[];
  productEvents: StructuredProductEvent[];
}

export interface StructuredSessionSummaryProjection {
  sessionId: string;
  title: string;
  sessionStatus?: StructuredSessionStatus;
  status: StructuredSessionStatus;
  preview: string;
  updatedAt: string;
  isPinned: boolean;
  pinnedAt: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  counts: StructuredSessionView["counts"];
  wait: StructuredSessionSnapshot["session"]["wait"];
  threadIds: StructuredSessionView["threadIds"];
  latestEpisodePreview?: string | null;
  latestWorkflowRunSummary?: string | null;
}

function getUpdatedAt(
  record: Pick<StructuredThreadRecord | StructuredTurnRecord, "updatedAt">,
): number {
  return Date.parse(record.updatedAt);
}

function getMostRecentWorkflowRun(
  session: StructuredSessionSnapshot,
): StructuredWorkflowRunRecord | null {
  return (
    session.workflowRuns.toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0] ?? null
  );
}

function getMostRecentOrchestratorTurnRequestSummary(
  session: StructuredSessionSnapshot,
): string | null {
  const latestTurn = session.turns
    .filter((turn) => turn.threadId === null && turn.requestSummary.trim().length > 0)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return latestTurn?.requestSummary ?? null;
}

function isCommandRollupSource(
  command: StructuredCommandRecord,
): command is StructuredCommandRecord & {
  parentCommandId: null;
  visibility: "summary" | "surface";
} {
  return (
    command.workflowTaskAttemptId === null &&
    command.parentCommandId === null &&
    (command.visibility === "summary" || command.visibility === "surface")
  );
}

function isWorkflowTaskAttemptCommandRollupSource(
  command: StructuredCommandRecord,
): command is StructuredCommandRecord & {
  parentCommandId: null;
  visibility: "summary" | "surface";
  workflowTaskAttemptId: string;
} {
  return (
    command.workflowTaskAttemptId !== null &&
    command.parentCommandId === null &&
    (command.visibility === "summary" || command.visibility === "surface")
  );
}

function compareCommandChronology(
  left: Pick<StructuredCommandRecord, "startedAt" | "updatedAt">,
  right: Pick<StructuredCommandRecord, "startedAt" | "updatedAt">,
): number {
  const startedAtComparison = left.startedAt.localeCompare(right.startedAt);
  if (startedAtComparison !== 0) {
    return startedAtComparison;
  }

  return left.updatedAt.localeCompare(right.updatedAt);
}

function getChildCommands(
  commands: StructuredSessionSnapshot["commands"],
  parentCommandId: string,
): StructuredCommandRecord[] {
  return commands
    .filter((candidate) => candidate.parentCommandId === parentCommandId)
    .toSorted(compareCommandChronology);
}

function buildCommandRollupChild(command: StructuredCommandRecord): StructuredCommandRollupChild {
  return {
    commandId: command.id,
    toolName: command.toolName,
    status: command.status,
    title: command.title,
    summary: command.summary,
    error: command.error,
  };
}

function getArtifactProducer(
  session: Pick<StructuredSessionSnapshot, "commands" | "workflowRuns" | "workflowTaskAttempts">,
  artifact: StructuredArtifactRecord,
): {
  workflowRunId?: string;
  workflowName?: string;
  sourceCommandId?: string;
  producerLabel?: string;
} {
  const workflowRun =
    (artifact.workflowRunId
      ? session.workflowRuns.find((candidate) => candidate.id === artifact.workflowRunId)
      : null) ??
    (artifact.sourceCommandId
      ? (session.commands
          .map((command) => {
            if (command.id === artifact.sourceCommandId) {
              return command.workflowRunId
                ? (session.workflowRuns.find(
                    (candidate) => candidate.id === command.workflowRunId,
                  ) ?? null)
                : null;
            }
            return null;
          })
          .find((candidate) => candidate !== null) ?? null)
      : null);
  const sourceCommand = artifact.sourceCommandId
    ? session.commands.find((candidate) => candidate.id === artifact.sourceCommandId)
    : null;
  const workflowTaskAttempt = artifact.workflowTaskAttemptId
    ? session.workflowTaskAttempts.find(
        (candidate) => candidate.id === artifact.workflowTaskAttemptId,
      )
    : null;
  const producerLabel =
    workflowRun?.workflowName ??
    sourceCommand?.title ??
    sourceCommand?.toolName ??
    workflowTaskAttempt?.title;

  return {
    ...(workflowRun
      ? { workflowRunId: workflowRun.id, workflowName: workflowRun.workflowName }
      : {}),
    ...(sourceCommand ? { sourceCommandId: sourceCommand.id } : {}),
    ...(producerLabel ? { producerLabel } : {}),
  };
}

export function buildStructuredArtifactLink(
  session: Pick<StructuredSessionSnapshot, "commands" | "workflowRuns" | "workflowTaskAttempts">,
  artifact: StructuredArtifactRecord,
): StructuredCommandArtifactLink {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    name: artifact.name,
    ...(artifact.path ? { path: artifact.path } : {}),
    createdAt: artifact.createdAt,
    ...getArtifactProducer(session, artifact),
    ...(artifact.path && !existsSync(artifact.path) ? { missingFile: true } : {}),
  };
}

function buildCommandArtifactLinks(
  session: Pick<
    StructuredSessionSnapshot,
    "artifacts" | "commands" | "workflowRuns" | "workflowTaskAttempts"
  >,
  commandId: string,
): StructuredCommandArtifactLink[] {
  return session.artifacts
    .filter((artifact) => artifact.sourceCommandId === commandId)
    .map((artifact) => buildStructuredArtifactLink(session, artifact))
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function buildCommandOutputEvents(
  session: Pick<StructuredSessionSnapshot, "events">,
  commandId: string,
): StructuredCommandOutputEvent[] {
  return session.events.flatMap((event) => {
    if (
      event.kind !== "command.output" ||
      event.subject.kind !== "command" ||
      event.subject.id !== commandId
    ) {
      return [];
    }
    const outputEvent = parseCommandOutputEvent(event);
    return outputEvent ? [outputEvent] : [];
  });
}

function parseCommandOutputEvent(
  event: StructuredLifecycleEventRecord,
): StructuredCommandOutputEvent | null {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return null;
  }
  const stream = (data as { stream?: unknown }).stream;
  const text = (data as { text?: unknown }).text;
  const source = (data as { source?: unknown }).source;
  if ((stream !== "stdout" && stream !== "stderr") || typeof text !== "string") {
    return null;
  }
  return {
    eventId: event.id,
    at: event.at,
    stream,
    source: typeof source === "string" && source.trim() ? source : "unknown",
    text,
  };
}

function buildCommandProgressEvents(
  session: Pick<StructuredSessionSnapshot, "events">,
  commandId: string,
): StructuredCommandProgressEvent[] {
  return session.events
    .flatMap((event) => {
      if (
        event.kind !== "command.progress" ||
        event.subject.kind !== "command" ||
        event.subject.id !== commandId
      ) {
        return [];
      }
      const progressEvent = parseCommandProgressEvent(event);
      return progressEvent ? [progressEvent] : [];
    })
    .toSorted((left, right) => left.at.localeCompare(right.at));
}

function parseCommandProgressEvent(
  event: StructuredLifecycleEventRecord,
): StructuredCommandProgressEvent | null {
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const source = (data as { source?: unknown }).source;
  const phase = (data as { phase?: unknown }).phase;
  const family = (data as { family?: unknown }).family;
  const command = (data as { command?: unknown }).command;
  const message = (data as { message?: unknown }).message;
  const progress = (data as { progress?: unknown }).progress;
  const facts = (data as { facts?: unknown }).facts;

  const parsed: StructuredCommandProgressEvent = {
    eventId: event.id,
    at: event.at,
    source: typeof source === "string" && source.trim() ? source : "unknown",
  };
  if (typeof phase === "string" && phase.trim()) {
    parsed.phase = phase;
  }
  if (typeof family === "string" && family.trim()) {
    parsed.family = family;
  }
  if (typeof command === "string" && command.trim()) {
    parsed.command = command;
  }
  if (typeof message === "string" && message.trim()) {
    parsed.message = message;
  }
  if (typeof progress === "number" && Number.isFinite(progress)) {
    parsed.progress = Math.max(0, Math.min(1, progress));
  }
  if (facts && typeof facts === "object" && !Array.isArray(facts)) {
    parsed.facts = facts as Record<string, unknown>;
  }
  return parsed;
}

function buildCommandArgumentSnapshots(
  session: Pick<StructuredSessionSnapshot, "events">,
  commandId: string,
): StructuredCommandArgumentSnapshot[] {
  return session.events
    .flatMap((event) => {
      if (
        event.kind !== "command.arg_snapshot" ||
        event.subject.kind !== "command" ||
        event.subject.id !== commandId
      ) {
        return [];
      }
      const snapshot = parseCommandArgumentSnapshot(event);
      return snapshot ? [snapshot] : [];
    })
    .toSorted((left, right) => left.at.localeCompare(right.at));
}

function parseCommandArgumentSnapshot(
  event: StructuredLifecycleEventRecord,
): StructuredCommandArgumentSnapshot | null {
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || !("arguments" in data)) {
    return null;
  }
  const source = (data as { source?: unknown }).source;
  return {
    eventId: event.id,
    at: event.at,
    source: typeof source === "string" && source.trim() ? source : "unknown",
    arguments: (data as { arguments: unknown }).arguments,
  };
}

function buildCommandPatchSnapshots(
  session: Pick<StructuredSessionSnapshot, "events">,
  commandId: string,
): StructuredCommandPatchSnapshot[] {
  return session.events
    .flatMap((event) => {
      if (
        event.kind !== "command.patch_snapshot" ||
        event.subject.kind !== "command" ||
        event.subject.id !== commandId
      ) {
        return [];
      }
      const snapshot = parseCommandPatchSnapshot(event);
      return snapshot ? [snapshot] : [];
    })
    .toSorted((left, right) => left.at.localeCompare(right.at));
}

function parseCommandPatchSnapshot(
  event: StructuredLifecycleEventRecord,
): StructuredCommandPatchSnapshot | null {
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const files = (data as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    return null;
  }
  const parsedFiles = files.flatMap((file): StructuredCommandPatchFile[] => {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      return [];
    }
    const path = (file as { path?: unknown }).path;
    const changeType = (file as { changeType?: unknown }).changeType;
    const additions = (file as { additions?: unknown }).additions;
    const deletions = (file as { deletions?: unknown }).deletions;
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      (changeType !== "created" && changeType !== "deleted" && changeType !== "modified") ||
      typeof additions !== "number" ||
      typeof deletions !== "number"
    ) {
      return [];
    }
    return [{ path, changeType, additions, deletions }];
  });
  if (parsedFiles.length === 0) {
    return null;
  }
  const source = (data as { source?: unknown }).source;
  return {
    eventId: event.id,
    at: event.at,
    source: typeof source === "string" && source.trim() ? source : "unknown",
    files: parsedFiles,
  };
}

function buildCommandDiagnostics(
  session: Pick<StructuredSessionSnapshot, "events">,
  commandId: string,
): StructuredCommandDiagnosticSnapshot[] {
  return session.events
    .flatMap((event) => {
      if (
        event.kind !== "command.diagnostics" ||
        event.subject.kind !== "command" ||
        event.subject.id !== commandId
      ) {
        return [];
      }
      const snapshot = parseCommandDiagnosticSnapshot(event);
      return snapshot ? [snapshot] : [];
    })
    .toSorted((left, right) => left.at.localeCompare(right.at));
}

function parseCommandDiagnosticSnapshot(
  event: StructuredLifecycleEventRecord,
): StructuredCommandDiagnosticSnapshot | null {
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const diagnostics = (data as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) {
    return null;
  }
  const parsedDiagnostics = diagnostics.flatMap((diagnostic): StructuredCommandDiagnostic[] => {
    if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
      return [];
    }
    const message = (diagnostic as { message?: unknown }).message;
    if (typeof message !== "string" || message.length === 0) {
      return [];
    }
    const severity = (diagnostic as { severity?: unknown }).severity;
    const file = (diagnostic as { file?: unknown }).file;
    const line = (diagnostic as { line?: unknown }).line;
    const column = (diagnostic as { column?: unknown }).column;
    const code = (diagnostic as { code?: unknown }).code;
    return [
      {
        ...(typeof severity === "string" && severity.trim() ? { severity } : {}),
        message,
        ...(typeof file === "string" && file.trim() ? { file } : {}),
        ...(typeof line === "number" ? { line } : {}),
        ...(typeof column === "number" ? { column } : {}),
        ...(typeof code === "string" && code.trim() ? { code } : {}),
      },
    ];
  });
  if (parsedDiagnostics.length === 0) {
    return null;
  }
  const source = (data as { source?: unknown }).source;
  const stage = (data as { stage?: unknown }).stage;
  return {
    eventId: event.id,
    at: event.at,
    source: typeof source === "string" && source.trim() ? source : "unknown",
    ...(typeof stage === "string" && stage.trim() ? { stage } : {}),
    diagnostics: parsedDiagnostics,
  };
}

function buildProductEvents(
  session: Pick<StructuredSessionSnapshot, "events">,
): StructuredProductEvent[] {
  return session.events
    .flatMap((event): StructuredProductEvent[] => {
      if (event.kind !== "Extension change reverted") {
        return [];
      }
      const data = event.data ?? {};
      const fallbackTitle = "Extension change reverted";
      const fallbackSummary = "A user reverted an extension change from the Extensions pane.";
      const title =
        typeof data.title === "string" && data.title.trim() ? data.title : fallbackTitle;
      const summary =
        typeof data.summary === "string" && data.summary.trim() ? data.summary : fallbackSummary;
      const subjectKind = event.subject.kind === "thread" ? "thread" : "session";
      return [
        {
          eventId: event.id,
          at: event.at,
          title,
          summary,
          subject: {
            kind: subjectKind,
            id: event.subject.id,
          },
          details: { ...data },
        },
      ];
    })
    .toSorted((left, right) => left.at.localeCompare(right.at));
}

function buildThreadArtifactLinks(
  session: StructuredSessionSnapshot,
  threadId: string,
): StructuredCommandArtifactLink[] {
  const workflowRunIds = new Set(
    session.workflowRuns
      .filter((workflowRun) => workflowRun.threadId === threadId)
      .map((workflowRun) => workflowRun.id),
  );
  const artifactLinksById = new Map<string, StructuredCommandArtifactLink>();

  for (const artifact of session.artifacts) {
    if (
      artifact.threadId === threadId ||
      (artifact.workflowRunId && workflowRunIds.has(artifact.workflowRunId))
    ) {
      artifactLinksById.set(artifact.id, buildStructuredArtifactLink(session, artifact));
    }
  }

  return Array.from(artifactLinksById.values()).toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function buildWorkflowRunArtifactLinks(
  session: StructuredSessionSnapshot,
  workflowRunId: string,
): StructuredCommandArtifactLink[] {
  return session.artifacts
    .filter((artifact) => artifact.workflowRunId === workflowRunId)
    .map((artifact) => buildStructuredArtifactLink(session, artifact))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function buildCommandInspectorChild(
  command: StructuredCommandRecord,
  session: StructuredSessionSnapshot,
): StructuredCommandInspectorChild {
  const progressEvents = buildCommandProgressEvents(session, command.id);
  return {
    ...buildCommandRollupChild(command),
    visibility: command.visibility,
    facts: command.facts,
    startedAt: command.startedAt,
    updatedAt: command.updatedAt,
    finishedAt: command.finishedAt,
    artifacts: buildCommandArtifactLinks(session, command.id),
    outputEvents: buildCommandOutputEvents(session, command.id),
    argumentSnapshots: buildCommandArgumentSnapshots(session, command.id),
    ...(progressEvents.length > 0 ? { progressEvents } : {}),
    patchSnapshots: buildCommandPatchSnapshots(session, command.id),
    diagnostics: buildCommandDiagnostics(session, command.id),
  };
}

function buildCommandRollups(
  session: Pick<StructuredSessionSnapshot, "commands"> &
    Partial<
      Pick<
        StructuredSessionSnapshot,
        "artifacts" | "events" | "workflowRuns" | "workflowTaskAttempts"
      >
    >,
  options: {
    includeWorkflowTaskAttemptCommands?: boolean;
  } = {},
): StructuredCommandRollup[] {
  const rollupSources = options.includeWorkflowTaskAttemptCommands
    ? session.commands.filter(isWorkflowTaskAttemptCommandRollupSource)
    : session.commands.filter(isCommandRollupSource);

  return rollupSources
    .map((command) => {
      const childCommands = getChildCommands(session.commands, command.id);
      const summaryChildren = childCommands
        .filter((childCommand) => childCommand.visibility !== "trace")
        .map((childCommand) => buildCommandRollupChild(childCommand));
      const traceChildCount = childCommands.filter(
        (childCommand) => childCommand.visibility === "trace",
      ).length;

      const progressEvents = session.events
        ? buildCommandProgressEvents({ events: session.events }, command.id)
        : [];
      return {
        commandId: command.id,
        threadId: command.threadId ?? null,
        workflowRunId: command.workflowRunId ?? null,
        workflowTaskAttemptId: command.workflowTaskAttemptId ?? null,
        toolName: command.toolName,
        visibility: command.visibility,
        status: command.status,
        title: command.title,
        summary: command.summary,
        arguments: command.arguments,
        facts: command.facts,
        error: command.error,
        artifacts: hasCommandArtifactContext(session)
          ? buildCommandArtifactLinks(session, command.id)
          : [],
        outputEvents: session.events
          ? buildCommandOutputEvents({ events: session.events }, command.id)
          : [],
        argumentSnapshots: session.events
          ? buildCommandArgumentSnapshots({ events: session.events }, command.id)
          : [],
        ...(progressEvents.length > 0 ? { progressEvents } : {}),
        patchSnapshots: session.events
          ? buildCommandPatchSnapshots({ events: session.events }, command.id)
          : [],
        diagnostics: session.events
          ? buildCommandDiagnostics({ events: session.events }, command.id)
          : [],
        childCount: childCommands.length,
        summaryChildCount: summaryChildren.length,
        traceChildCount,
        summaryChildren,
        startedAt: command.startedAt,
        updatedAt: command.updatedAt,
        finishedAt: command.finishedAt,
      };
    })
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function hasCommandArtifactContext(
  session: Pick<StructuredSessionSnapshot, "commands"> &
    Partial<Pick<StructuredSessionSnapshot, "artifacts" | "workflowRuns" | "workflowTaskAttempts">>,
): session is Pick<
  StructuredSessionSnapshot,
  "commands" | "artifacts" | "workflowRuns" | "workflowTaskAttempts"
> {
  return Boolean(session.artifacts && session.workflowRuns && session.workflowTaskAttempts);
}

function isDelegatedHandlerThread(
  session: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
): boolean {
  return thread.surfacePiSessionId !== session.session.orchestratorPiSessionId;
}

function buildThreadWorkflowSummary(
  session: StructuredSessionSnapshot,
  workflowRun: StructuredWorkflowRunRecord,
): StructuredHandlerThreadWorkflowSummary {
  return {
    workflowRunId: workflowRun.id,
    workflowName: workflowRun.workflowName,
    status: workflowRun.status,
    summary: workflowRun.summary,
    updatedAt: workflowRun.updatedAt,
    artifacts: buildWorkflowRunArtifactLinks(session, workflowRun.id),
  };
}

function buildWorkflowSidebarSubtitle(
  workflowRun: StructuredWorkflowRunRecord,
): StructuredSidebarRowSubtitle | null {
  switch (workflowRun.status) {
    case "running":
      return { badge: "workflow", text: workflowRun.summary, tone: "muted" };
    case "waiting":
      return { badge: "waiting", text: workflowRun.summary, tone: "waiting" };
    case "continued":
    case "failed":
    case "cancelled":
      return { badge: "workflow", text: "troubleshooting", tone: "muted" };
    default:
      return null;
  }
}

function buildHandlerSidebarSubtitle(
  thread: StructuredThreadRecord,
  latestWorkflowRun: StructuredWorkflowRunRecord | null,
  latestEpisode: StructuredEpisodeRecord | null,
): StructuredSidebarRowSubtitle | null {
  if (thread.wait) {
    return { badge: "waiting", text: thread.wait.reason, tone: "waiting" };
  }

  if (thread.status === "troubleshooting") {
    return { badge: "workflow", text: "troubleshooting", tone: "muted" };
  }

  if (
    latestWorkflowRun &&
    (thread.status === "running-workflow" ||
      latestWorkflowRun.status === "running" ||
      latestWorkflowRun.status === "waiting")
  ) {
    return { badge: "workflow", text: latestWorkflowRun.summary, tone: "muted" };
  }

  if (latestEpisode) {
    return { badge: "text", text: latestEpisode.summary, tone: "muted" };
  }

  return null;
}

function buildSidebarWorkflowRow(
  workflowRun: StructuredWorkflowRunRecord,
): StructuredSidebarWorkflowRow {
  return {
    workflowRunId: workflowRun.id,
    workflowName: workflowRun.workflowName,
    status: workflowRun.status,
    subtitle: buildWorkflowSidebarSubtitle(workflowRun),
    updatedAt: workflowRun.updatedAt,
  };
}

function buildSidebarThreadRow(
  session: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
): StructuredSidebarHandlerThreadRow {
  const workflowRuns = session.workflowRuns
    .filter((workflowRun) => workflowRun.threadId === thread.id)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const latestWorkflowRun = workflowRuns[0] ?? null;
  const latestEpisode = getThreadLatestEpisode(session, thread.id);

  return {
    threadId: thread.id,
    surfacePiSessionId: thread.surfacePiSessionId,
    title: thread.title || thread.objective,
    objective: thread.objective,
    status: thread.status,
    subtitle: buildHandlerSidebarSubtitle(thread, latestWorkflowRun, latestEpisode),
    latestCommandRollup: getThreadLatestCommandRollup(session, thread.id),
    updatedAt: thread.updatedAt,
    workflows: workflowRuns.map((workflowRun) => buildSidebarWorkflowRow(workflowRun)),
  };
}

export function buildStructuredSidebarThreadRows(
  session: StructuredSessionSnapshot,
): StructuredSidebarHandlerThreadRow[] {
  return session.threads
    .filter((thread) => isDelegatedHandlerThread(session, thread))
    .toSorted((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .map((thread) => buildSidebarThreadRow(session, thread));
}

function buildThreadEpisodeSummary(
  episode: StructuredEpisodeRecord,
): StructuredHandlerThreadEpisodeSummary {
  return {
    episodeId: episode.id,
    kind: episode.kind,
    title: episode.title,
    summary: episode.summary,
    createdAt: episode.createdAt,
  };
}

function getThreadLatestWorkflowRun(
  session: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
): StructuredWorkflowRunRecord | null {
  const workflowRuns = session.workflowRuns.filter(
    (workflowRun) => workflowRun.threadId === thread.id,
  );
  if (workflowRuns.length === 0) {
    return null;
  }

  const workflowRunsById = new Map(
    workflowRuns.map((workflowRun) => [workflowRun.id, workflowRun]),
  );
  const mostRecent =
    workflowRuns.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null;
  if (!mostRecent) {
    return null;
  }

  let current = mostRecent;
  while (current.status === "continued" && current.activeDescendantRunId) {
    const descendant = workflowRunsById.get(current.activeDescendantRunId);
    if (!descendant) {
      break;
    }
    current = descendant;
  }

  return current;
}

function getThreadLatestEpisode(
  session: StructuredSessionSnapshot,
  threadId: string,
): StructuredEpisodeRecord | null {
  return (
    session.episodes
      .filter((episode) => episode.threadId === threadId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  );
}

function buildThreadCommandRollups(
  session: StructuredSessionSnapshot,
  threadId: string,
): StructuredCommandRollup[] {
  return buildCommandRollups({
    ...session,
    commands: session.commands.filter(
      (command) => command.threadId === threadId && command.workflowTaskAttemptId === null,
    ),
  });
}

function getThreadLatestCommandRollup(
  session: StructuredSessionSnapshot,
  threadId: string,
): StructuredCommandRollup | null {
  const rollups = buildThreadCommandRollups(session, threadId);
  return (
    rollups.find(
      (rollup) =>
        rollup.status === "requested" || rollup.status === "running" || rollup.status === "waiting",
    ) ??
    rollups[0] ??
    null
  );
}

function buildWorkflowTaskAttemptSummary(
  session: StructuredSessionSnapshot,
  workflowTaskAttempt: StructuredSessionSnapshot["workflowTaskAttempts"][number],
): StructuredWorkflowTaskAttemptSummary {
  return {
    workflowTaskAttemptId: workflowTaskAttempt.id,
    workflowRunId: workflowTaskAttempt.workflowRunId,
    smithersRunId: workflowTaskAttempt.smithersRunId,
    nodeId: workflowTaskAttempt.nodeId,
    iteration: workflowTaskAttempt.iteration,
    attempt: workflowTaskAttempt.attempt,
    title: workflowTaskAttempt.title,
    kind: workflowTaskAttempt.kind,
    status: workflowTaskAttempt.status,
    summary: workflowTaskAttempt.summary,
    updatedAt: workflowTaskAttempt.updatedAt,
    commandCount: session.commands.filter(
      (command) => command.workflowTaskAttemptId === workflowTaskAttempt.id,
    ).length,
    artifactCount: session.artifacts.filter(
      (artifact) => artifact.workflowTaskAttemptId === workflowTaskAttempt.id,
    ).length,
    transcriptMessageCount: session.workflowTaskMessages.filter(
      (message) => message.workflowTaskAttemptId === workflowTaskAttempt.id,
    ).length,
    contextBudget: readContextBudgetFromMeta(workflowTaskAttempt.meta),
  };
}

function buildHandlerThreadSummary(
  session: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
): StructuredHandlerThreadSummary {
  const workflowRuns = session.workflowRuns.filter(
    (workflowRun) => workflowRun.threadId === thread.id,
  );
  const workflowTaskAttempts = session.workflowTaskAttempts.filter(
    (workflowTaskAttempt) => workflowTaskAttempt.threadId === thread.id,
  );
  const episodes = session.episodes.filter((episode) => episode.threadId === thread.id);
  const artifacts = session.artifacts.filter((artifact) => artifact.threadId === thread.id);
  const latestWorkflowRun = getThreadLatestWorkflowRun(session, thread);
  const latestEpisode = getThreadLatestEpisode(session, thread.id);

  const summary: StructuredHandlerThreadSummary = {
    threadId: thread.id,
    surfacePiSessionId: thread.surfacePiSessionId,
    title: thread.title,
    objective: thread.objective,
    objectiveState: thread.objectiveState,
    historyMode: thread.historyMode,
    status: thread.status,
    wait: structuredClone(thread.wait),
    startedAt: thread.startedAt,
    updatedAt: thread.updatedAt,
    finishedAt: thread.finishedAt,
    commandCount: session.commands.filter(
      (command) => command.threadId === thread.id && command.workflowTaskAttemptId === null,
    ).length,
    workflowRunCount: workflowRuns.length,
    workflowTaskAttemptCount: workflowTaskAttempts.length,
    episodeCount: episodes.length,
    artifactCount: artifacts.length,
    latestCommandRollup: getThreadLatestCommandRollup(session, thread.id),
    latestWorkflowRun: latestWorkflowRun
      ? buildThreadWorkflowSummary(session, latestWorkflowRun)
      : null,
    latestEpisode: latestEpisode ? buildThreadEpisodeSummary(latestEpisode) : null,
  };
  if (workflowTaskAttempts.length > 0) {
    summary.workflowTaskAttempts = workflowTaskAttempts
      .map((workflowTaskAttempt) => buildWorkflowTaskAttemptSummary(session, workflowTaskAttempt))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  return summary;
}

function deriveThreadIds(threads: StructuredThreadRecord[]): string[] {
  return threads
    .toSorted((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .map((thread) => thread.id);
}

function deriveLatestEpisodePreview(session: StructuredSessionSnapshot): string | null {
  return (
    session.episodes.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      ?.summary ?? null
  );
}

function deriveLatestWorkflowRunSummary(session: StructuredSessionSnapshot): string | null {
  return getMostRecentWorkflowRun(session)?.summary ?? null;
}

function isOrchestratorOwnedWait(
  wait: StructuredSessionSnapshot["session"]["wait"],
): wait is NonNullable<StructuredSessionSnapshot["session"]["wait"]> & {
  owner: { kind: "orchestrator" };
} {
  return wait?.owner.kind === "orchestrator";
}

function derivePreview(session: StructuredSessionSnapshot): string {
  const wait = session.session.wait;
  if (isOrchestratorOwnedWait(wait)) {
    return wait.reason;
  }

  const commandRollups = buildCommandRollups({
    commands: session.commands.filter((command) => command.threadId === null),
  });
  const latestCommandRollup = commandRollups[0] ?? null;
  if (latestCommandRollup) {
    return latestCommandRollup.summary;
  }

  return getMostRecentOrchestratorTurnRequestSummary(session) ?? "";
}

function deriveUpdatedAt(session: StructuredSessionSnapshot): string {
  const wait = session.session.wait;
  const timestamps = [
    Date.parse(session.pi.updatedAt),
    ...session.turns
      .filter((turn) => turn.threadId === null)
      .map((turn) => Date.parse(turn.updatedAt)),
    ...session.commands
      .filter((command) => command.threadId === null)
      .map((command) => Date.parse(command.updatedAt)),
    ...session.episodes.map((episode) => Date.parse(episode.createdAt)),
    ...(isOrchestratorOwnedWait(wait) ? [Date.parse(wait.since)] : []),
  ].filter((value) => Number.isFinite(value));

  const latest = timestamps.length > 0 ? Math.max(...timestamps) : Date.parse(session.pi.updatedAt);
  return new Date(latest).toISOString();
}

function getLatestFailureTimestamp(session: StructuredSessionSnapshot): number | null {
  const failures = [
    ...session.turns.filter((turn) => turn.status === "failed").map((turn) => getUpdatedAt(turn)),
    ...session.threads
      .filter((thread) => thread.status === "troubleshooting")
      .map((thread) => getUpdatedAt(thread)),
  ].filter((value) => Number.isFinite(value));

  return failures.length > 0 ? Math.max(...failures) : null;
}

export function deriveStructuredSessionStatus(input: {
  wait: StructuredSessionSnapshot["session"]["wait"];
  turns?: Array<Pick<StructuredTurnRecord, "threadId" | "status" | "updatedAt">>;
}): StructuredSessionStatus {
  if (isOrchestratorOwnedWait(input.wait)) {
    return "waiting";
  }

  const orchestratorTurns = input.turns?.filter((turn) => turn.threadId === null) ?? [];
  if (orchestratorTurns.some((turn) => turn.status === "failed")) {
    return "error";
  }

  if (orchestratorTurns.some((turn) => turn.status === "waiting")) {
    return "waiting";
  }

  if (orchestratorTurns.some((turn) => turn.status === "running")) {
    return "running";
  }

  return "idle";
}

export function buildStructuredSessionView(
  session: StructuredSessionSnapshot,
): StructuredSessionView {
  const delegatedThreads = session.threads.filter((thread) =>
    isDelegatedHandlerThread(session, thread),
  );
  const grouped = groupThreadIdsByStatus(delegatedThreads);
  const commandRollups = buildCommandRollups(session);
  const productEvents = buildProductEvents(session);
  const latestEpisodePreview = deriveLatestEpisodePreview(session);
  const latestWorkflowRunSummary = deriveLatestWorkflowRunSummary(session);

  return {
    title: session.pi.title,
    sessionStatus: deriveStructuredSessionStatus({
      wait: session.session.wait,
      turns: session.turns.map((turn) => ({
        threadId: turn.threadId,
        status: turn.status,
        updatedAt: turn.updatedAt,
      })),
    }),
    wait: structuredClone(session.session.wait),
    counts: {
      turns: session.turns.length,
      threads: delegatedThreads.length,
      commands: session.commands.length,
      episodes: session.episodes.length,
      workflows: session.workflowRuns.length,
      artifacts: session.artifacts.length,
      events: session.events.length,
    },
    threadIdsByStatus: grouped,
    threadIds: deriveThreadIds(delegatedThreads),
    latestEpisodePreview,
    latestWorkflowRunSummary,
    sidebarThreads: buildStructuredSidebarThreadRows(session),
    commandRollups,
    productEvents,
  };
}

export function buildStructuredSessionSummaryProjection(
  session: StructuredSessionSnapshot,
): StructuredSessionSummaryProjection {
  const view = buildStructuredSessionView(session);

  return {
    sessionId: session.pi.sessionId,
    title: view.title,
    sessionStatus: view.sessionStatus,
    status: view.sessionStatus,
    preview: derivePreview(session),
    updatedAt: deriveUpdatedAt(session),
    isPinned: session.session.pinnedAt !== null,
    pinnedAt: session.session.pinnedAt,
    isArchived: session.session.archivedAt !== null,
    archivedAt: session.session.archivedAt,
    counts: view.counts,
    wait: view.wait,
    threadIds: view.threadIds,
    latestEpisodePreview: view.latestEpisodePreview,
    latestWorkflowRunSummary: view.latestWorkflowRunSummary,
  };
}

export function groupThreadIdsByStatus(
  threads: Pick<StructuredThreadRecord, "id" | "status">[],
): StructuredSessionView["threadIdsByStatus"] {
  const grouped: StructuredSessionView["threadIdsByStatus"] = {
    runningHandler: [] as string[],
    runningWorkflow: [] as string[],
    waiting: [] as string[],
    troubleshooting: [] as string[],
  };

  for (const thread of threads) {
    switch (thread.status) {
      case "running-handler":
        grouped.runningHandler.push(thread.id);
        break;
      case "running-workflow":
        grouped.runningWorkflow.push(thread.id);
        break;
      case "waiting":
        grouped.waiting.push(thread.id);
        break;
      case "troubleshooting":
        grouped.troubleshooting.push(thread.id);
        break;
    }
  }

  return grouped;
}

export function hasStructuredSessionFacts(session: StructuredSessionSnapshot): boolean {
  return (
    session.session.wait !== null ||
    session.turns.length > 0 ||
    session.threads.length > 0 ||
    buildCommandRollups(session).length > 0 ||
    session.episodes.length > 0 ||
    session.workflowRuns.length > 0 ||
    session.workflowTaskAttempts.length > 0 ||
    session.workflowTaskMessages.length > 0 ||
    session.artifacts.length > 0 ||
    session.events.length > 0
  );
}

export function buildStructuredCommandInspector(
  session: StructuredSessionSnapshot,
  commandId: string,
): StructuredCommandInspector | null {
  const commandsById = new Map(session.commands.map((command) => [command.id, command]));
  let parentCommand = commandsById.get(commandId) ?? null;
  while (parentCommand?.parentCommandId) {
    parentCommand = commandsById.get(parentCommand.parentCommandId) ?? null;
  }

  if (!parentCommand) {
    return null;
  }

  const childCommands = getChildCommands(session.commands, parentCommand.id);
  const summaryChildren = childCommands
    .filter((childCommand) => childCommand.visibility !== "trace")
    .map((childCommand) => buildCommandInspectorChild(childCommand, session));
  const traceChildren = childCommands
    .filter((childCommand) => childCommand.visibility === "trace")
    .map((childCommand) => buildCommandInspectorChild(childCommand, session));
  const progressEvents = buildCommandProgressEvents(session, parentCommand.id);

  return {
    commandId: parentCommand.id,
    threadId: parentCommand.threadId ?? null,
    workflowRunId: parentCommand.workflowRunId ?? null,
    workflowTaskAttemptId: parentCommand.workflowTaskAttemptId ?? null,
    toolName: parentCommand.toolName,
    visibility: parentCommand.visibility,
    status: parentCommand.status,
    title: parentCommand.title,
    summary: parentCommand.summary,
    facts: parentCommand.facts,
    error: parentCommand.error,
    startedAt: parentCommand.startedAt,
    updatedAt: parentCommand.updatedAt,
    finishedAt: parentCommand.finishedAt,
    artifacts: buildCommandArtifactLinks(session, parentCommand.id),
    outputEvents: buildCommandOutputEvents(session, parentCommand.id),
    argumentSnapshots: buildCommandArgumentSnapshots(session, parentCommand.id),
    ...(progressEvents.length > 0 ? { progressEvents } : {}),
    patchSnapshots: buildCommandPatchSnapshots(session, parentCommand.id),
    diagnostics: buildCommandDiagnostics(session, parentCommand.id),
    childCount: childCommands.length,
    summaryChildCount: summaryChildren.length,
    traceChildCount: traceChildren.length,
    summaryChildren,
    traceChildren,
  };
}

export function buildStructuredWorkflowTaskAttemptInspector(
  session: StructuredSessionSnapshot,
  workflowTaskAttemptId: string,
): StructuredWorkflowTaskAttemptInspector | null {
  const workflowTaskAttempt =
    session.workflowTaskAttempts.find((candidate) => candidate.id === workflowTaskAttemptId) ??
    null;
  if (!workflowTaskAttempt) {
    return null;
  }

  const commands = session.commands.filter(
    (command) => command.workflowTaskAttemptId === workflowTaskAttemptId,
  );
  const commandRollups = buildCommandRollups(
    { commands },
    { includeWorkflowTaskAttemptCommands: true },
  );
  const artifacts = session.artifacts
    .filter((artifact) => artifact.workflowTaskAttemptId === workflowTaskAttemptId)
    .map((artifact) => buildStructuredArtifactLink(session, artifact))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const transcript = session.workflowTaskMessages
    .filter((message) => message.workflowTaskAttemptId === workflowTaskAttemptId)
    .map((message) => ({
      messageId: message.id,
      role: message.role,
      source: message.source,
      text: message.text,
      createdAt: message.createdAt,
    }))
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  const generatedAgentContextBinding =
    workflowTaskAttempt.surfacePiSessionId && workflowTaskAttempt.generatedAgentContextFingerprint
      ? (session.generatedAgentContextBindings.find(
          (binding) =>
            binding.ownerKind === "workflow-task-attempt" &&
            binding.ownerId === workflowTaskAttempt.id &&
            binding.surfacePiSessionId === workflowTaskAttempt.surfacePiSessionId &&
            binding.generatedAgentContextFingerprint ===
              workflowTaskAttempt.generatedAgentContextFingerprint,
        ) ?? null)
      : null;

  return {
    ...buildWorkflowTaskAttemptSummary(session, workflowTaskAttempt),
    surfacePiSessionId: workflowTaskAttempt.surfacePiSessionId,
    smithersState: workflowTaskAttempt.smithersState,
    prompt: workflowTaskAttempt.prompt,
    responseText: workflowTaskAttempt.responseText,
    error: workflowTaskAttempt.error,
    cached: workflowTaskAttempt.cached,
    jjPointer: workflowTaskAttempt.jjPointer,
    jjCwd: workflowTaskAttempt.jjCwd,
    heartbeatAt: workflowTaskAttempt.heartbeatAt,
    agentId: workflowTaskAttempt.agentId,
    agentModel: workflowTaskAttempt.agentModel,
    agentEngine: workflowTaskAttempt.agentEngine,
    agentResume: workflowTaskAttempt.agentResume,
    generatedAgentContextFingerprint: workflowTaskAttempt.generatedAgentContextFingerprint,
    generatedAgentContextBinding: generatedAgentContextBinding
      ? {
          systemPrompt: generatedAgentContextBinding.systemPrompt,
          generatedAgentContextRevision: generatedAgentContextBinding.generatedAgentContextRevision,
          loadedExtensionIds: generatedAgentContextBinding.loadedExtensionIds,
          availableExtensionIds: generatedAgentContextBinding.availableExtensionIds,
          externalSourceHashes: generatedAgentContextBinding.externalSourceHashes,
        }
      : null,
    meta: workflowTaskAttempt.meta,
    startedAt: workflowTaskAttempt.startedAt,
    finishedAt: workflowTaskAttempt.finishedAt,
    transcript,
    commandRollups,
    artifacts,
  };
}

export function buildStructuredHandlerThreadSummaries(
  session: StructuredSessionSnapshot,
): StructuredHandlerThreadSummary[] {
  return session.threads
    .filter((thread) => isDelegatedHandlerThread(session, thread))
    .map((thread) => buildHandlerThreadSummary(session, thread))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function buildStructuredHandlerThreadInspector(
  session: StructuredSessionSnapshot,
  threadId: string,
): StructuredHandlerThreadInspector | null {
  const thread = session.threads.find((candidate) => candidate.id === threadId) ?? null;
  if (!thread || !isDelegatedHandlerThread(session, thread)) {
    return null;
  }

  const workflowRuns = session.workflowRuns
    .filter((workflowRun) => workflowRun.threadId === threadId)
    .map((workflowRun) => buildThreadWorkflowSummary(session, workflowRun))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const episodes = session.episodes
    .filter((episode) => episode.threadId === threadId)
    .map((episode) => buildThreadEpisodeSummary(episode))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    ...buildHandlerThreadSummary(session, thread),
    commandRollups: buildThreadCommandRollups(session, threadId),
    workflowRuns,
    workflowTaskAttempts: session.workflowTaskAttempts
      .filter((workflowTaskAttempt) => workflowTaskAttempt.threadId === threadId)
      .map((workflowTaskAttempt) => buildWorkflowTaskAttemptSummary(session, workflowTaskAttempt))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    episodes,
    artifacts: buildThreadArtifactLinks(session, threadId),
  };
}

export function getLatestFailureContext(session: StructuredSessionSnapshot): string | null {
  const latestFailureTimestamp = getLatestFailureTimestamp(session);
  if (latestFailureTimestamp === null) {
    return null;
  }

  const failingThread = session.threads
    .filter((thread) => thread.status === "troubleshooting")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (failingThread) {
    return failingThread.title || failingThread.objective;
  }

  const failingTurn = session.turns
    .filter((turn) => turn.status === "failed")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return failingTurn?.requestSummary ?? null;
}
