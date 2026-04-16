import type {
  StructuredEpisodeRecord,
  StructuredSessionSnapshot,
  StructuredSessionStatus,
  StructuredThreadRecord,
  StructuredThreadStatus,
  StructuredTurnRecord,
  StructuredWorkflowRecord,
} from "./structured-session-state";

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
}

export interface StructuredSessionSummaryProjection {
  sessionId: string;
  title: string;
  preview: string;
  status: StructuredSessionStatus;
  updatedAt: string;
  counts: StructuredSessionView["counts"];
  wait: StructuredSessionSnapshot["session"]["wait"];
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

function getMostRecentWorkflow(
  session: StructuredSessionSnapshot,
): StructuredWorkflowRecord | null {
  return (
    session.workflows.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null
  );
}

function getMostRecentActiveWorkflow(
  session: StructuredSessionSnapshot,
): StructuredWorkflowRecord | null {
  return (
    session.workflows
      .filter((workflow) => workflow.status === "running" || workflow.status === "waiting")
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

function getMostRecentThread(session: StructuredSessionSnapshot): StructuredThreadRecord | null {
  return (
    session.threads.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null
  );
}

function describeWaitingThread(thread: StructuredThreadRecord): string {
  if (thread.wait) {
    return `Waiting: ${thread.wait.reason}`;
  }

  if (thread.dependsOnThreadIds.length > 0) {
    return `Waiting on dependencies: ${thread.title}`;
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

function derivePreview(session: StructuredSessionSnapshot): string {
  if (session.session.wait) {
    return `Waiting: ${session.session.wait.reason}`;
  }

  const activeWorkflow = getMostRecentActiveWorkflow(session);
  if (activeWorkflow) {
    return `Workflow: ${activeWorkflow.summary}`;
  }

  const latestEpisode = getMostRecentEpisode(session);
  if (latestEpisode) {
    return formatEpisodePreview(latestEpisode);
  }

  const latestVerificationSummary = getMostRecentVerificationSummary(session);
  if (latestVerificationSummary) {
    return `Verification: ${latestVerificationSummary}`;
  }

  const latestThread = getMostRecentThread(session);
  if (latestThread?.status === "waiting") {
    return describeWaitingThread(latestThread);
  }

  const latestWorkflow = getMostRecentWorkflow(session);
  if (latestWorkflow) {
    return `Workflow: ${latestWorkflow.summary}`;
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
    ...session.workflows.map((workflow) => Date.parse(workflow.updatedAt)),
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
  threads: Pick<StructuredThreadRecord, "status" | "updatedAt" | "dependsOnThreadIds">[];
}): StructuredSessionStatus {
  if (input.wait) {
    return "waiting";
  }

  if (input.threads.some((thread) => thread.status === "running")) {
    return "running";
  }

  if (
    input.threads.some(
      (thread) => thread.status === "waiting" && thread.dependsOnThreadIds.length > 0,
    )
  ) {
    return "running";
  }

  const latestFailure = [
    ...input.turns.filter((turn) => turn.status === "failed").map((turn) => getUpdatedAt(turn)),
    ...input.threads
      .filter((thread) => thread.status === "failed")
      .map((thread) => getUpdatedAt(thread)),
  ]
    .filter((value) => Number.isFinite(value))
    .toSorted((left, right) => right - left)[0];

  if (typeof latestFailure === "number") {
    return "error";
  }

  return "idle";
}

export function buildStructuredSessionView(
  session: StructuredSessionSnapshot,
): StructuredSessionView {
  const grouped = groupThreadIdsByStatus(session.threads);

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
        dependsOnThreadIds: thread.dependsOnThreadIds,
      })),
    }),
    wait: structuredClone(session.session.wait),
    counts: {
      turns: session.turns.length,
      threads: session.threads.length,
      commands: session.commands.length,
      episodes: session.episodes.length,
      verifications: session.verifications.length,
      workflows: session.workflows.length,
      artifacts: session.artifacts.length,
      events: session.events.length,
    },
    threadIdsByStatus: grouped,
  };
}

export function buildStructuredSessionSummaryProjection(
  session: StructuredSessionSnapshot,
): StructuredSessionSummaryProjection {
  const view = buildStructuredSessionView(session);

  return {
    sessionId: session.pi.sessionId,
    title: view.title,
    preview: derivePreview(session),
    status: view.sessionStatus,
    updatedAt: deriveUpdatedAt(session),
    counts: view.counts,
    wait: view.wait,
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
    session.commands.length > 0 ||
    session.episodes.length > 0 ||
    session.verifications.length > 0 ||
    session.workflows.length > 0 ||
    session.artifacts.length > 0 ||
    session.events.length > 0
  );
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
