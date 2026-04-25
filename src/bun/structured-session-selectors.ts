import { existsSync } from "node:fs";
import type {
  StructuredArtifactRecord,
  StructuredCommandRecord,
  StructuredEpisodeRecord,
  StructuredSessionSnapshot,
  StructuredSessionStatus,
  StructuredThreadRecord,
  StructuredTurnRecord,
  StructuredWorkflowRunRecord,
} from "./structured-session-state";

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
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: StructuredCommandRollupChild[];
  updatedAt: string;
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

export interface StructuredCommandInspectorChild extends StructuredCommandRollupChild {
  visibility: StructuredCommandRecord["visibility"];
  facts: Record<string, unknown> | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  artifacts: StructuredCommandArtifactLink[];
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

export interface StructuredProjectCiRunSummary {
  ciRunId: string;
  workflowRunId: string;
  workflowId: string;
  status: StructuredSessionSnapshot["ciRuns"][number]["status"];
  summary: string;
  updatedAt: string;
}

export type StructuredProjectCiPanelStatus =
  | "not-configured"
  | "configured"
  | "running"
  | StructuredSessionSnapshot["ciRuns"][number]["status"];

export interface StructuredProjectCiEntrySummary {
  workflowId: string;
  label: string;
  summary: string;
  sourceScope: StructuredWorkflowRunRecord["workflowSource"];
  entryPath: string;
}

export interface StructuredProjectCiActiveWorkflowSummary {
  workflowRunId: string;
  workflowId: string;
  entryPath: string | null;
  threadId: string;
  threadTitle: string;
  status: Extract<StructuredWorkflowRunRecord["status"], "running" | "waiting">;
  summary: string;
  updatedAt: string;
}

export interface StructuredProjectCiCheckSummary {
  checkResultId: string;
  checkId: string;
  label: string;
  kind: string;
  status: StructuredSessionSnapshot["ciCheckResults"][number]["status"];
  required: boolean;
  command: string[] | null;
  exitCode: number | null;
  summary: string;
  artifactIds: string[];
  artifacts: StructuredCommandArtifactLink[];
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface StructuredProjectCiRunDetail extends StructuredProjectCiRunSummary {
  threadId: string;
  threadTitle: string;
  smithersRunId: string;
  entryPath: string;
  startedAt: string;
  finishedAt: string;
}

export interface StructuredProjectCiStatusPanel {
  status: StructuredProjectCiPanelStatus;
  summary: string;
  entries: StructuredProjectCiEntrySummary[];
  activeWorkflowRun: StructuredProjectCiActiveWorkflowSummary | null;
  latestRun: StructuredProjectCiRunDetail | null;
  checks: StructuredProjectCiCheckSummary[];
  checkCounts: Record<StructuredSessionSnapshot["ciCheckResults"][number]["status"], number> & {
    total: number;
  };
  updatedAt: string | null;
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
  ciRunCount: number;
  loadedContextKeys: string[];
  latestWorkflowRun: StructuredHandlerThreadWorkflowSummary | null;
  latestCiRun: StructuredProjectCiRunSummary | null;
  latestEpisode: StructuredHandlerThreadEpisodeSummary | null;
}

export interface StructuredHandlerThreadInspector extends StructuredHandlerThreadSummary {
  commandRollups: StructuredCommandRollup[];
  workflowRuns: StructuredHandlerThreadWorkflowSummary[];
  workflowTaskAttempts: StructuredWorkflowTaskAttemptSummary[];
  episodes: StructuredHandlerThreadEpisodeSummary[];
  artifacts: StructuredCommandArtifactLink[];
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
    ciRuns: number;
    ciChecks: number;
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
  commandRollups: StructuredCommandRollup[];
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

function getMostRecentEpisode(session: StructuredSessionSnapshot): StructuredEpisodeRecord | null {
  return (
    session.episodes.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ??
    null
  );
}

function getMostRecentProjectCiRun(session: StructuredSessionSnapshot) {
  return (
    session.ciRuns.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null
  );
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

function getMostRecentActiveWorkflowRun(
  session: StructuredSessionSnapshot,
): StructuredWorkflowRunRecord | null {
  return (
    session.workflowRuns
      .filter((workflowRun) => workflowRun.status === "running" || workflowRun.status === "waiting")
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

function getMostRecentThread(session: StructuredSessionSnapshot): StructuredThreadRecord | null {
  return (
    session.threads.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null
  );
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
  session: StructuredSessionSnapshot,
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
      ? session.commands
          .map((command) => {
            if (command.id === artifact.sourceCommandId) {
              return command.workflowRunId
                ? session.workflowRuns.find(
                    (candidate) => candidate.id === command.workflowRunId,
                  ) ?? null
                : null;
            }
            return null;
          })
          .find((candidate) => candidate !== null) ?? null
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
    ...(workflowRun ? { workflowRunId: workflowRun.id, workflowName: workflowRun.workflowName } : {}),
    ...(sourceCommand ? { sourceCommandId: sourceCommand.id } : {}),
    ...(producerLabel ? { producerLabel } : {}),
  };
}

export function buildStructuredArtifactLink(
  session: StructuredSessionSnapshot,
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
  session: StructuredSessionSnapshot,
  commandId: string,
): StructuredCommandArtifactLink[] {
  return session.artifacts
    .filter((artifact) => artifact.sourceCommandId === commandId)
    .map((artifact) => buildStructuredArtifactLink(session, artifact))
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
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
    if (artifact.threadId === threadId || (artifact.workflowRunId && workflowRunIds.has(artifact.workflowRunId))) {
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
  return {
    ...buildCommandRollupChild(command),
    visibility: command.visibility,
    facts: command.facts,
    startedAt: command.startedAt,
    updatedAt: command.updatedAt,
    finishedAt: command.finishedAt,
    artifacts: buildCommandArtifactLinks(session, command.id),
  };
}

function buildCommandRollups(
  session: Pick<StructuredSessionSnapshot, "commands">,
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
        childCount: childCommands.length,
        summaryChildCount: summaryChildren.length,
        traceChildCount,
        summaryChildren,
        updatedAt: command.updatedAt,
      };
    })
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

function buildProjectCiRunSummary(
  ciRun: StructuredSessionSnapshot["ciRuns"][number],
): StructuredProjectCiRunSummary {
  return {
    ciRunId: ciRun.id,
    workflowRunId: ciRun.workflowRunId,
    workflowId: ciRun.workflowId,
    status: ciRun.status,
    summary: ciRun.summary,
    updatedAt: ciRun.updatedAt,
  };
}

function findProjectCiEntryForWorkflowRun(
  entries: readonly StructuredProjectCiEntrySummary[],
  workflowRun: StructuredWorkflowRunRecord,
): StructuredProjectCiEntrySummary | null {
  if (!workflowRun.entryPath) {
    return null;
  }

  return entries.find((entry) => workflowRun.entryPath === entry.entryPath) ?? null;
}

function projectCiEntryMatchesWorkflowRun(
  entries: readonly StructuredProjectCiEntrySummary[],
  workflowRun: StructuredWorkflowRunRecord,
): boolean {
  return findProjectCiEntryForWorkflowRun(entries, workflowRun) !== null;
}

function projectCiEntryMatchesCiRun(
  entries: readonly StructuredProjectCiEntrySummary[],
  ciRun: StructuredSessionSnapshot["ciRuns"][number],
): boolean {
  return entries.some((entry) => ciRun.entryPath === entry.entryPath);
}

function getThreadTitle(session: StructuredSessionSnapshot, threadId: string): string {
  const thread = session.threads.find((candidate) => candidate.id === threadId);
  return thread?.title || thread?.objective || threadId;
}

function buildProjectCiRunDetail(
  session: StructuredSessionSnapshot,
  ciRun: StructuredSessionSnapshot["ciRuns"][number],
): StructuredProjectCiRunDetail {
  return {
    ...buildProjectCiRunSummary(ciRun),
    threadId: ciRun.threadId,
    threadTitle: getThreadTitle(session, ciRun.threadId),
    smithersRunId: ciRun.smithersRunId,
    entryPath: ciRun.entryPath,
    startedAt: ciRun.startedAt,
    finishedAt: ciRun.finishedAt,
  };
}

function buildProjectCiCheckSummary(
  session: StructuredSessionSnapshot,
  checkResult: StructuredSessionSnapshot["ciCheckResults"][number],
): StructuredProjectCiCheckSummary {
  const artifactsById = new Map(session.artifacts.map((artifact) => [artifact.id, artifact]));
  return {
    checkResultId: checkResult.id,
    checkId: checkResult.checkId,
    label: checkResult.label,
    kind: checkResult.kind,
    status: checkResult.status,
    required: checkResult.required,
    command: checkResult.command ? checkResult.command.slice() : null,
    exitCode: checkResult.exitCode,
    summary: checkResult.summary,
    artifactIds: checkResult.artifactIds.slice(),
    artifacts: checkResult.artifactIds
      .map((artifactId) => artifactsById.get(artifactId) ?? null)
      .filter((artifact): artifact is StructuredArtifactRecord => artifact !== null)
      .map((artifact) => buildStructuredArtifactLink(session, artifact))
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
    startedAt: checkResult.startedAt,
    finishedAt: checkResult.finishedAt,
    updatedAt: checkResult.updatedAt,
  };
}

function createProjectCiCheckCounts(
  checks: StructuredProjectCiCheckSummary[] = [],
): StructuredProjectCiStatusPanel["checkCounts"] {
  const counts = {
    passed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    blocked: 0,
    total: checks.length,
  };
  for (const check of checks) {
    counts[check.status] += 1;
  }
  return counts;
}

function buildProjectCiActiveWorkflowSummary(
  session: StructuredSessionSnapshot,
  workflowRun: StructuredWorkflowRunRecord & { status: "running" | "waiting" },
  entry: StructuredProjectCiEntrySummary,
): StructuredProjectCiActiveWorkflowSummary {
  return {
    workflowRunId: workflowRun.id,
    workflowId: entry.workflowId,
    entryPath: entry.entryPath,
    threadId: workflowRun.threadId,
    threadTitle: getThreadTitle(session, workflowRun.threadId),
    status: workflowRun.status,
    summary: workflowRun.summary,
    updatedAt: workflowRun.updatedAt,
  };
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
    commands: session.commands.filter(
      (command) => command.threadId === threadId && command.workflowTaskAttemptId === null,
    ),
  });
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
  const artifacts = session.artifacts.filter(
    (artifact) => artifact.threadId === thread.id,
  );
  const ciRuns = session.ciRuns.filter((ciRun) => ciRun.threadId === thread.id);
  const latestWorkflowRun = getThreadLatestWorkflowRun(session, thread);
  const latestCiRun =
    ciRuns.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const latestEpisode = getThreadLatestEpisode(session, thread.id);

  return {
    threadId: thread.id,
    surfacePiSessionId: thread.surfacePiSessionId,
    title: thread.title,
    objective: thread.objective,
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
    ciRunCount: ciRuns.length,
    loadedContextKeys: thread.loadedContextKeys.slice(),
    latestWorkflowRun: latestWorkflowRun ? buildThreadWorkflowSummary(session, latestWorkflowRun) : null,
    latestCiRun: latestCiRun ? buildProjectCiRunSummary(latestCiRun) : null,
    latestEpisode: latestEpisode ? buildThreadEpisodeSummary(latestEpisode) : null,
  };
}

function deriveThreadIds(threads: StructuredThreadRecord[]): string[] {
  return threads
    .toSorted((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .map((thread) => thread.id);
}

function describeWaitingThread(thread: StructuredThreadRecord): string {
  if (thread.wait) {
    return `Waiting: ${thread.wait.reason}`;
  }

  return `Waiting: ${thread.title}`;
}

function describeTroubleshootingThread(thread: StructuredThreadRecord): string {
  if (thread.wait) {
    return `Troubleshooting: ${thread.wait.reason}`;
  }

  return `Troubleshooting: ${thread.title || thread.objective}`;
}

function formatEpisodePreview(episode: StructuredEpisodeRecord): string {
  switch (episode.kind) {
    case "workflow":
      return `Workflow: ${episode.summary}`;
    case "clarification":
      return `Waiting: ${episode.summary}`;
    default:
      return episode.summary;
  }
}

function deriveLatestEpisodePreview(session: StructuredSessionSnapshot): string | null {
  return getMostRecentEpisode(session)?.summary ?? null;
}

function deriveLatestWorkflowRunSummary(session: StructuredSessionSnapshot): string | null {
  return getMostRecentWorkflowRun(session)?.summary ?? null;
}

function derivePreview(session: StructuredSessionSnapshot): string {
  const commandRollups = buildCommandRollups(session);
  if (session.session.wait) {
    return `Waiting: ${session.session.wait.reason}`;
  }

  const activeWorkflowRun = getMostRecentActiveWorkflowRun(session);
  if (activeWorkflowRun) {
    return `Workflow: ${activeWorkflowRun.summary}`;
  }

  const latestEpisode = getMostRecentEpisode(session);
  if (latestEpisode) {
    return formatEpisodePreview(latestEpisode);
  }

  const latestCommandRollup = commandRollups[0];
  if (latestCommandRollup) {
    return latestCommandRollup.summary;
  }

  const latestProjectCiRun = getMostRecentProjectCiRun(session);
  if (latestProjectCiRun) {
    return `Project CI: ${latestProjectCiRun.summary}`;
  }

  const latestWorkflowRun = getMostRecentWorkflowRun(session);
  if (latestWorkflowRun) {
    return `Workflow: ${latestWorkflowRun.summary}`;
  }

  const latestThread = getMostRecentThread(session);
  if (latestThread?.status === "waiting") {
    return describeWaitingThread(latestThread);
  }

  if (latestThread?.status === "troubleshooting") {
    return describeTroubleshootingThread(latestThread);
  }

  if (latestThread) {
    return latestThread.title || latestThread.objective;
  }

  return session.pi.title;
}

function deriveUpdatedAt(session: StructuredSessionSnapshot): string {
  const timestamps = [
    Date.parse(session.pi.updatedAt),
    ...session.turns.map((turn) => Date.parse(turn.updatedAt)),
    ...session.threads.map((thread) => Date.parse(thread.updatedAt)),
    ...session.commands.map((command) => Date.parse(command.updatedAt)),
    ...session.episodes.map((episode) => Date.parse(episode.createdAt)),
    ...session.ciRuns.map((ciRun) => Date.parse(ciRun.updatedAt)),
    ...session.ciCheckResults.map((checkResult) => Date.parse(checkResult.updatedAt)),
    ...session.workflowRuns.map((workflowRun) => Date.parse(workflowRun.updatedAt)),
    ...session.workflowTaskAttempts.map((workflowTaskAttempt) =>
      Date.parse(workflowTaskAttempt.updatedAt),
    ),
    ...session.workflowTaskMessages.map((message) => Date.parse(message.createdAt)),
    ...session.artifacts.map((artifact) => Date.parse(artifact.createdAt)),
    ...session.events.map((event) => Date.parse(event.at)),
    ...(session.session.wait ? [Date.parse(session.session.wait.since)] : []),
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
  threads: Array<Pick<StructuredThreadRecord, "status" | "updatedAt">>;
}): StructuredSessionStatus {
  if (input.wait) {
    return "waiting";
  }

  if (
    input.threads.some((thread) => thread.status === "troubleshooting")
  ) {
    return "error";
  }

  if (
    input.threads.some(
      (thread) => thread.status === "running-handler" || thread.status === "running-workflow",
    )
  ) {
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
  const latestEpisodePreview = deriveLatestEpisodePreview(session);
  const latestWorkflowRunSummary = deriveLatestWorkflowRunSummary(session);

  return {
    title: session.pi.title,
    sessionStatus: deriveStructuredSessionStatus({
      wait: session.session.wait,
      threads: session.threads.map((thread) => ({
        status: thread.status,
        updatedAt: thread.updatedAt,
      })),
    }),
    wait: structuredClone(session.session.wait),
    counts: {
      turns: session.turns.length,
      threads: delegatedThreads.length,
      commands: session.commands.length,
      episodes: session.episodes.length,
      ciRuns: session.ciRuns.length,
      ciChecks: session.ciCheckResults.length,
      workflows: session.workflowRuns.length,
      artifacts: session.artifacts.length,
      events: session.events.length,
    },
    threadIdsByStatus: grouped,
    threadIds: deriveThreadIds(delegatedThreads),
    latestEpisodePreview,
    latestWorkflowRunSummary,
    commandRollups,
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
    session.threadContexts.length > 0 ||
    buildCommandRollups(session).length > 0 ||
    session.episodes.length > 0 ||
    session.ciRuns.length > 0 ||
    session.ciCheckResults.length > 0 ||
    session.workflowRuns.length > 0 ||
    session.workflowTaskAttempts.length > 0 ||
    session.workflowTaskMessages.length > 0 ||
    session.artifacts.length > 0 ||
    session.events.length > 0
  );
}

export function buildStructuredProjectCiStatusPanel(input: {
  session: StructuredSessionSnapshot | null;
  entries: readonly StructuredProjectCiEntrySummary[];
}): StructuredProjectCiStatusPanel {
  const entries = input.entries.map((entry) => ({
    workflowId: entry.workflowId,
    label: entry.label,
    summary: entry.summary,
    sourceScope: entry.sourceScope,
    entryPath: entry.entryPath,
  }));

  if (entries.length === 0) {
    return {
      status: "not-configured",
      summary: "No Project CI entry has been configured.",
      entries,
      activeWorkflowRun: null,
      latestRun: null,
      checks: [],
      checkCounts: createProjectCiCheckCounts(),
      updatedAt: null,
    };
  }

  const session = input.session;
  if (!session) {
    return {
      status: "configured",
      summary: "Ready to run Project CI.",
      entries,
      activeWorkflowRun: null,
      latestRun: null,
      checks: [],
      checkCounts: createProjectCiCheckCounts(),
      updatedAt: null,
    };
  }

  const activeWorkflowRun =
    session.workflowRuns
      .filter(
        (
          workflowRun,
        ): workflowRun is StructuredWorkflowRunRecord & {
          status: "running" | "waiting";
        } => workflowRun.status === "running" || workflowRun.status === "waiting",
      )
      .filter((workflowRun) => projectCiEntryMatchesWorkflowRun(entries, workflowRun))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;

  if (activeWorkflowRun) {
    const activeEntry = findProjectCiEntryForWorkflowRun(entries, activeWorkflowRun);
    if (!activeEntry) {
      throw new Error(
        `Matched Project CI workflow run ${activeWorkflowRun.id} without a declared entry path.`,
      );
    }
    const activeSummary = buildProjectCiActiveWorkflowSummary(
      session,
      activeWorkflowRun,
      activeEntry,
    );
    return {
      status: activeWorkflowRun.status === "waiting" ? "blocked" : "running",
      summary: activeSummary.summary,
      entries,
      activeWorkflowRun: activeSummary,
      latestRun: null,
      checks: [],
      checkCounts: createProjectCiCheckCounts(),
      updatedAt: activeSummary.updatedAt,
    };
  }

  const latestCiRun =
    session.ciRuns
      .filter((ciRun) => projectCiEntryMatchesCiRun(entries, ciRun))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;

  if (!latestCiRun) {
    return {
      status: "configured",
      summary: "Ready to run Project CI.",
      entries,
      activeWorkflowRun: null,
      latestRun: null,
      checks: [],
      checkCounts: createProjectCiCheckCounts(),
      updatedAt: null,
    };
  }

  const checks = session.ciCheckResults
    .filter((checkResult) => checkResult.ciRunId === latestCiRun.id)
    .map((checkResult) => buildProjectCiCheckSummary(session, checkResult))
    .toSorted((left, right) => left.checkId.localeCompare(right.checkId));

  return {
    status: latestCiRun.status,
    summary: latestCiRun.summary,
    entries,
    activeWorkflowRun: null,
    latestRun: buildProjectCiRunDetail(session, latestCiRun),
    checks,
    checkCounts: createProjectCiCheckCounts(checks),
    updatedAt: latestCiRun.updatedAt,
  };
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
