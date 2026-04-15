import type {
  StructuredSessionSnapshot,
  StructuredSessionStatus,
  StructuredThreadRecord,
  StructuredThreadStatus,
} from "./structured-session-state";

export interface StructuredSessionView {
  title: string;
  sessionStatus: StructuredSessionStatus;
  waitingOn: StructuredSessionSnapshot["session"]["waitingOn"];
  counts: {
    threads: number;
    results: number;
    verifications: number;
    workflows: number;
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
  waitingOn: StructuredSessionSnapshot["session"]["waitingOn"];
}

function getThreadUpdatedAt(thread: Pick<StructuredThreadRecord, "updatedAt">): number {
  return new Date(thread.updatedAt).getTime();
}

function getMostRecentResultSummary(session: StructuredSessionSnapshot): string | null {
  const threadsWithResults = session.threads
    .filter((thread): thread is StructuredThreadRecord & { result: NonNullable<StructuredThreadRecord["result"]> } => thread.result !== null)
    .toSorted((left, right) => right.result.createdAt.localeCompare(left.result.createdAt));
  return threadsWithResults[0]?.result.summary ?? null;
}

function getMostRecentVerificationSummary(session: StructuredSessionSnapshot): string | null {
  const sortedVerifications = session.verifications.toSorted((left, right) =>
    right.finishedAt.localeCompare(left.finishedAt),
  );
  return sortedVerifications[0]?.summary ?? null;
}

function getMostRecentWorkflowSummary(session: StructuredSessionSnapshot): string | null {
  const sortedWorkflows = session.workflows.toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  return sortedWorkflows[0]?.summary ?? null;
}

function getMostRecentActiveWorkflowSummary(session: StructuredSessionSnapshot): string | null {
  const sortedWorkflows = session.workflows
    .filter((workflow) => workflow.status === "running" || workflow.status === "waiting")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return sortedWorkflows[0]?.summary ?? null;
}

function formatThreadSummaryPrefix(thread: Pick<StructuredThreadRecord, "kind" | "result">): string {
  if (!thread.result?.summary) {
    return "";
  }

  switch (thread.kind) {
    case "verification":
      return `Verification: ${thread.result.summary}`;
    case "workflow":
      return `Workflow: ${thread.result.summary}`;
    default:
      return thread.result.summary;
  }
}

function formatDependencyBlockedPreview(
  thread: Pick<StructuredThreadRecord, "blockedOn" | "blockedReason" | "objective">,
): string {
  if (thread.blockedOn?.kind === "threads") {
    return `Blocked on dependencies: ${thread.blockedReason ?? thread.objective}`;
  }

  return `Blocked: ${thread.blockedReason ?? thread.objective}`;
}

function derivePreview(session: StructuredSessionSnapshot): string {
  if (session.session.waitingOn) {
    return `Blocked: ${session.session.waitingOn.reason}`;
  }

  const latestWorkflowSummary = getMostRecentActiveWorkflowSummary(session);
  if (latestWorkflowSummary) {
    return `Workflow: ${latestWorkflowSummary}`;
  }

  const latestThread = session.threads.toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];
  if (latestThread) {
    if (latestThread.status === "waiting" && latestThread.blockedOn?.kind === "threads") {
      return formatDependencyBlockedPreview(latestThread);
    }

    if (latestThread.result?.summary) {
      return formatThreadSummaryPrefix(latestThread);
    }
    if (latestThread.status === "failed" || latestThread.status === "waiting") {
      if (latestThread.blockedReason) {
        return `Blocked: ${latestThread.blockedReason}`;
      }
    }
  }

  const mostRecentResultSummary = getMostRecentResultSummary(session);
  if (mostRecentResultSummary) {
    return mostRecentResultSummary;
  }

  const mostRecentVerificationSummary = getMostRecentVerificationSummary(session);
  if (mostRecentVerificationSummary) {
    return `Verification: ${mostRecentVerificationSummary}`;
  }

  const mostRecentWorkflowSummary = getMostRecentWorkflowSummary(session);
  if (mostRecentWorkflowSummary) {
    return `Workflow: ${mostRecentWorkflowSummary}`;
  }

  return session.pi.title;
}

function deriveUpdatedAt(session: StructuredSessionSnapshot): string {
  const timestamps = [
    Date.parse(session.pi.updatedAt),
    ...session.threads.map((thread) => Date.parse(thread.updatedAt)),
    ...session.verifications.map((verification) => Date.parse(verification.finishedAt)),
    ...session.workflows.map((workflow) => Date.parse(workflow.updatedAt)),
    ...session.events.map((event) => Date.parse(event.at)),
    ...(session.session.waitingOn ? [Date.parse(session.session.waitingOn.since)] : []),
  ].filter((value) => Number.isFinite(value));

  const latest = timestamps.length > 0 ? Math.max(...timestamps) : Date.parse(session.pi.updatedAt);
  return new Date(latest).toISOString();
}

export function deriveStructuredSessionStatus(input: {
  waitingOn: StructuredSessionSnapshot["session"]["waitingOn"];
  threads: Pick<StructuredThreadRecord, "status" | "updatedAt" | "blockedOn">[];
}): StructuredSessionStatus {
  if (input.waitingOn) {
    return "waiting";
  }

  if (
    input.threads.some(
      (thread) =>
        thread.status === "running" ||
        (thread.status === "waiting" && thread.blockedOn?.kind === "threads"),
    )
  ) {
    return "running";
  }

  const latestUpdatedThread = input.threads.toSorted(
    (left, right) => getThreadUpdatedAt(right) - getThreadUpdatedAt(left),
  )[0];
  if (latestUpdatedThread?.status === "failed") {
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
      waitingOn: session.session.waitingOn,
      threads: session.threads.map((thread) => ({
        status: thread.status,
        updatedAt: thread.updatedAt,
        blockedOn: thread.blockedOn,
      })),
    }),
    waitingOn: structuredClone(session.session.waitingOn),
    counts: {
      threads: session.threads.length,
      results: session.threads.filter((thread) => thread.result !== null).length,
      verifications: session.verifications.length,
      workflows: session.workflows.length,
      events: session.events.length,
    },
    threadIdsByStatus: {
      running: grouped.running,
      waiting: grouped.waiting,
      failed: grouped.failed,
    },
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
    waitingOn: view.waitingOn,
  };
}

export function groupThreadIdsByStatus(
  threads: Pick<StructuredThreadRecord, "id" | "status">[],
): Record<StructuredThreadStatus, string[]> {
  const grouped: Record<StructuredThreadStatus, string[]> = {
    running: [],
    waiting: [],
    failed: [],
    completed: [],
  };

  for (const thread of threads) {
    grouped[thread.status].push(thread.id);
  }

  return grouped;
}
