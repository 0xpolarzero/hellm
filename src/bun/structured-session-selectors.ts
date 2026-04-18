import type {
  StructuredArtifactRecord,
  StructuredCommandRecord,
  StructuredEpisodeRecord,
  StructuredSessionSnapshot,
  StructuredSessionStatus,
  StructuredThreadRecord,
  StructuredThreadStatus,
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
}

export interface StructuredHandlerThreadEpisodeSummary {
  episodeId: string;
  kind: StructuredEpisodeRecord["kind"];
  title: string;
  summary: string;
  createdAt: string;
}

export interface StructuredHandlerThreadSummary {
  threadId: string;
  surfaceSessionId: string;
  title: string;
  objective: string;
  status: StructuredThreadRecord["status"];
  wait: StructuredThreadRecord["wait"];
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  commandCount: number;
  workflowRunCount: number;
  episodeCount: number;
  artifactCount: number;
  verificationCount: number;
  latestWorkflowRun: StructuredHandlerThreadWorkflowSummary | null;
  latestEpisode: StructuredHandlerThreadEpisodeSummary | null;
}

export interface StructuredHandlerThreadInspector extends StructuredHandlerThreadSummary {
  commandRollups: StructuredCommandRollup[];
  workflowRuns: StructuredHandlerThreadWorkflowSummary[];
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
    verifications: number;
    workflows: number;
    artifacts: number;
    events: number;
  };
  threadIdsByStatus: {
    running: string[];
    waiting: string[];
    failed: string[];
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

function getMostRecentVerificationSummary(session: StructuredSessionSnapshot): string | null {
  return (
    session.verifications.toSorted((left, right) =>
      right.finishedAt.localeCompare(left.finishedAt),
    )[0]?.summary ?? null
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

function buildCommandArtifactLinks(
  artifacts: StructuredSessionSnapshot["artifacts"],
  commandId: string,
): StructuredCommandArtifactLink[] {
  return artifacts
    .filter((artifact) => artifact.sourceCommandId === commandId)
    .map((artifact) => ({
      artifactId: artifact.id,
      kind: artifact.kind,
      name: artifact.name,
      path: artifact.path,
      createdAt: artifact.createdAt,
    }))
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function buildThreadArtifactLinks(
  artifacts: StructuredSessionSnapshot["artifacts"],
  threadId: string,
): StructuredCommandArtifactLink[] {
  return artifacts
    .filter((artifact) => artifact.threadId === threadId)
    .map((artifact) => ({
      artifactId: artifact.id,
      kind: artifact.kind,
      name: artifact.name,
      path: artifact.path,
      createdAt: artifact.createdAt,
    }))
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function buildCommandInspectorChild(
  command: StructuredCommandRecord,
  artifacts: StructuredSessionSnapshot["artifacts"],
): StructuredCommandInspectorChild {
  return {
    ...buildCommandRollupChild(command),
    visibility: command.visibility,
    facts: command.facts,
    startedAt: command.startedAt,
    updatedAt: command.updatedAt,
    finishedAt: command.finishedAt,
    artifacts: buildCommandArtifactLinks(artifacts, command.id),
  };
}

function buildCommandRollups(
  session: Pick<StructuredSessionSnapshot, "commands">,
): StructuredCommandRollup[] {
  return session.commands
    .filter(isCommandRollupSource)
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
  workflowRun: StructuredWorkflowRunRecord,
): StructuredHandlerThreadWorkflowSummary {
  return {
    workflowRunId: workflowRun.id,
    workflowName: workflowRun.workflowName,
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

  return (
    workflowRuns.find((workflowRun) => workflowRun.id === thread.latestWorkflowRunId) ??
    workflowRuns.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null
  );
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
    commands: session.commands.filter((command) => command.threadId === threadId),
  });
}

function buildHandlerThreadSummary(
  session: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
): StructuredHandlerThreadSummary {
  const workflowRuns = session.workflowRuns.filter(
    (workflowRun) => workflowRun.threadId === thread.id,
  );
  const episodes = session.episodes.filter((episode) => episode.threadId === thread.id);
  const artifacts = session.artifacts.filter((artifact) => artifact.threadId === thread.id);
  const verifications = session.verifications.filter(
    (verification) => verification.threadId === thread.id,
  );
  const latestWorkflowRun = getThreadLatestWorkflowRun(session, thread);
  const latestEpisode = getThreadLatestEpisode(session, thread.id);

  return {
    threadId: thread.id,
    surfaceSessionId: thread.surfacePiSessionId,
    title: thread.title,
    objective: thread.objective,
    status: thread.status,
    wait: structuredClone(thread.wait),
    startedAt: thread.startedAt,
    updatedAt: thread.updatedAt,
    finishedAt: thread.finishedAt,
    commandCount: session.commands.filter((command) => command.threadId === thread.id).length,
    workflowRunCount: workflowRuns.length,
    episodeCount: episodes.length,
    artifactCount: artifacts.length,
    verificationCount: verifications.length,
    latestWorkflowRun: latestWorkflowRun ? buildThreadWorkflowSummary(latestWorkflowRun) : null,
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

function formatEpisodePreview(episode: StructuredEpisodeRecord): string {
  switch (episode.kind) {
    case "workflow":
      return `Workflow: ${episode.summary}`;
    case "verification":
      return `Verification: ${episode.summary}`;
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

  const latestVerificationSummary = getMostRecentVerificationSummary(session);
  if (latestVerificationSummary) {
    return `Verification: ${latestVerificationSummary}`;
  }

  const latestWorkflowRun = getMostRecentWorkflowRun(session);
  if (latestWorkflowRun) {
    return `Workflow: ${latestWorkflowRun.summary}`;
  }

  const latestThread = getMostRecentThread(session);
  if (latestThread?.status === "waiting") {
    return describeWaitingThread(latestThread);
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
    ...session.verifications.map((verification) => Date.parse(verification.finishedAt)),
    ...session.workflowRuns.map((workflowRun) => Date.parse(workflowRun.updatedAt)),
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
      .filter((thread) => thread.status === "failed")
      .map((thread) => getUpdatedAt(thread)),
  ].filter((value) => Number.isFinite(value));

  return failures.length > 0 ? Math.max(...failures) : null;
}

export function deriveStructuredSessionStatus(input: {
  wait: StructuredSessionSnapshot["session"]["wait"];
  turns: Pick<StructuredTurnRecord, "status" | "updatedAt">[];
  threads: Array<Pick<StructuredThreadRecord, "status" | "updatedAt">>;
}): StructuredSessionStatus {
  if (input.wait) {
    return "waiting";
  }

  if (input.threads.some((thread) => thread.status === "running")) {
    return "running";
  }

  const latestThread = input.threads.toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];
  if (latestThread?.status === "failed") {
    return "error";
  }

  return "idle";
}

export function buildStructuredSessionView(
  session: StructuredSessionSnapshot,
): StructuredSessionView {
  const grouped = groupThreadIdsByStatus(session.threads);
  const commandRollups = buildCommandRollups(session);
  const latestEpisodePreview = deriveLatestEpisodePreview(session);
  const latestWorkflowRunSummary = deriveLatestWorkflowRunSummary(session);

  return {
    title: session.pi.title,
    sessionStatus: deriveStructuredSessionStatus({
      wait: session.session.wait,
      turns: session.turns.map((turn) => ({
        status: turn.status,
        updatedAt: turn.updatedAt,
      })),
      threads: session.threads.map((thread) => ({
        status: thread.status,
        updatedAt: thread.updatedAt,
      })),
    }),
    wait: structuredClone(session.session.wait),
    counts: {
      turns: session.turns.length,
      threads: session.threads.length,
      commands: session.commands.length,
      episodes: session.episodes.length,
      verifications: session.verifications.length,
      workflows: session.workflowRuns.length,
      artifacts: session.artifacts.length,
      events: session.events.length,
    },
    threadIdsByStatus: grouped,
    threadIds: deriveThreadIds(session.threads),
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
    counts: view.counts,
    wait: view.wait,
    threadIds: view.threadIds,
    latestEpisodePreview: view.latestEpisodePreview,
    latestWorkflowRunSummary: view.latestWorkflowRunSummary,
  };
}

export function groupThreadIdsByStatus(
  threads: Pick<StructuredThreadRecord, "id" | "status">[],
): Record<Extract<StructuredThreadStatus, "running" | "waiting" | "failed">, string[]> {
  const grouped = {
    running: [] as string[],
    waiting: [] as string[],
    failed: [] as string[],
  };

  for (const thread of threads) {
    if (thread.status === "running" || thread.status === "waiting" || thread.status === "failed") {
      grouped[thread.status].push(thread.id);
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
    session.verifications.length > 0 ||
    session.workflowRuns.length > 0 ||
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
    .map((childCommand) => buildCommandInspectorChild(childCommand, session.artifacts));
  const traceChildren = childCommands
    .filter((childCommand) => childCommand.visibility === "trace")
    .map((childCommand) => buildCommandInspectorChild(childCommand, session.artifacts));

  return {
    commandId: parentCommand.id,
    threadId: parentCommand.threadId ?? null,
    workflowRunId: parentCommand.workflowRunId ?? null,
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
    artifacts: buildCommandArtifactLinks(session.artifacts, parentCommand.id),
    childCount: childCommands.length,
    summaryChildCount: summaryChildren.length,
    traceChildCount: traceChildren.length,
    summaryChildren,
    traceChildren,
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
    .map((workflowRun) => buildThreadWorkflowSummary(workflowRun))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const episodes = session.episodes
    .filter((episode) => episode.threadId === threadId)
    .map((episode) => buildThreadEpisodeSummary(episode))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    ...buildHandlerThreadSummary(session, thread),
    commandRollups: buildThreadCommandRollups(session, threadId),
    workflowRuns,
    episodes,
    artifacts: buildThreadArtifactLinks(session.artifacts, threadId),
  };
}

export function getLatestFailureContext(session: StructuredSessionSnapshot): string | null {
  const latestFailureTimestamp = getLatestFailureTimestamp(session);
  if (latestFailureTimestamp === null) {
    return null;
  }

  const failingThread = session.threads
    .filter((thread) => thread.status === "failed")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (failingThread) {
    return failingThread.title || failingThread.objective;
  }

  const failingTurn = session.turns
    .filter((turn) => turn.status === "failed")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return failingTurn?.requestSummary ?? null;
}
