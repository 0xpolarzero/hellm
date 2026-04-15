import { describe, expect, it } from "bun:test";
import type {
  StructuredSessionSnapshot,
  StructuredThreadRecord,
} from "./structured-session-state";
import {
  buildStructuredSessionSummaryProjection,
  buildStructuredSessionView,
  deriveStructuredSessionStatus,
  groupThreadIdsByStatus,
} from "./structured-session-selectors";

type StructuredThreadFixture = Omit<StructuredThreadRecord, "blockedOn" | "blockedReason" | "result"> & {
  blockedOn?: StructuredThreadRecord["blockedOn"];
  blockedReason?: string | null;
  result?: StructuredThreadRecord["result"] | null;
};

type StructuredSessionSnapshotFixture = Omit<Partial<StructuredSessionSnapshot>, "threads"> & {
  threads?: StructuredThreadFixture[];
};

function createSessionSnapshot(
  overrides: StructuredSessionSnapshotFixture = {},
): StructuredSessionSnapshot {
  const { threads: overrideThreads, ...rest } = overrides;

  return {
    workspace: {
      id: "/repo/svvy",
      label: "svvy",
      cwd: "/repo/svvy",
    },
    pi: {
      sessionId: "session-selectors",
      title: "Selector Session",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      messageCount: 7,
      status: "idle",
      createdAt: "2026-04-14T07:00:00.000Z",
      updatedAt: "2026-04-14T07:10:00.000Z",
    },
    session: {
      waitingOn: null,
    },
    verifications: [],
    workflows: [],
    events: [],
    ...rest,
    threads: overrideThreads?.map((thread) => ({
      blockedOn: null,
      blockedReason: null,
      result: null,
      ...thread,
    })) ?? [],
  };
}

describe("structured session selectors", () => {
  it("derives session status from waiting ownership first, then running or dependency-blocked threads, then latest failure, else idle", () => {
    expect(
      deriveStructuredSessionStatus({
        waitingOn: {
          threadId: "thread-001",
          reason: "Need clarification",
          resumeWhen: "Resume on answer",
          since: "2026-04-14T10:00:00.000Z",
        },
        threads: [
          {
            status: "running",
            updatedAt: "2026-04-14T10:05:00.000Z",
            blockedOn: null,
          },
        ],
      }),
    ).toBe("waiting");

    expect(
      deriveStructuredSessionStatus({
        waitingOn: null,
        threads: [
          {
            status: "running",
            updatedAt: "2026-04-14T10:05:00.000Z",
            blockedOn: null,
          },
        ],
      }),
    ).toBe("running");

    expect(
      deriveStructuredSessionStatus({
        waitingOn: null,
        threads: [
          {
            status: "waiting",
            updatedAt: "2026-04-14T10:04:00.000Z",
            blockedOn: {
              kind: "threads",
              threadIds: ["thread-002"],
              waitPolicy: "all",
              reason: "Waiting on dependency thread completion",
              since: "2026-04-14T10:03:30.000Z",
            },
          },
        ],
      }),
    ).toBe("running");

    expect(
      deriveStructuredSessionStatus({
        waitingOn: null,
        threads: [
          {
            status: "completed",
            updatedAt: "2026-04-14T10:00:00.000Z",
            blockedOn: null,
          },
          {
            status: "failed",
            updatedAt: "2026-04-14T10:05:00.000Z",
            blockedOn: null,
          },
        ],
      }),
    ).toBe("error");

    expect(
      deriveStructuredSessionStatus({
        waitingOn: null,
        threads: [
          {
            status: "completed",
            updatedAt: "2026-04-14T10:05:00.000Z",
            blockedOn: null,
          },
        ],
      }),
    ).toBe("idle");
  });

  it("builds a session view with derived counts and status buckets", () => {
    const snapshot = createSessionSnapshot({
      session: {
        waitingOn: {
          threadId: "thread-003",
          reason: "Need workflow ownership decision",
          resumeWhen: "Resume when user decides ownership model.",
          since: "2026-04-14T10:03:00.000Z",
        },
      },
      threads: [
        {
          id: "thread-001",
          sessionId: "session-selectors",
          kind: "direct",
          objective: "Direct objective",
          status: "completed",
          result: {
            kind: "analysis-summary",
            summary: "Direct summary",
            body: "Direct body",
            createdAt: "2026-04-14T10:01:00.000Z",
          },
          blockedReason: null,
          startedAt: "2026-04-14T10:00:00.000Z",
          updatedAt: "2026-04-14T10:01:00.000Z",
          finishedAt: "2026-04-14T10:01:00.000Z",
        },
        {
          id: "thread-002",
          sessionId: "session-selectors",
          kind: "verification",
          objective: "Verification objective",
          status: "failed",
          result: {
            kind: "verification-summary",
            summary: "Verification failed",
            body: "Verification body",
            createdAt: "2026-04-14T10:02:00.000Z",
          },
          blockedReason: "Test suite failed",
          startedAt: "2026-04-14T10:01:30.000Z",
          updatedAt: "2026-04-14T10:02:00.000Z",
          finishedAt: "2026-04-14T10:02:00.000Z",
        },
        {
          id: "thread-003",
          sessionId: "session-selectors",
          kind: "workflow",
          objective: "Workflow objective",
          status: "waiting",
          result: null,
          blockedReason: "Need clarification",
          startedAt: "2026-04-14T10:02:30.000Z",
          updatedAt: "2026-04-14T10:03:00.000Z",
          finishedAt: null,
        },
      ],
      verifications: [
        {
          id: "verification-001",
          sessionId: "session-selectors",
          threadId: "thread-002",
          kind: "test",
          status: "failed",
          summary: "Selector suite failed",
          command: "bun test src/bun/structured-session-selectors.test.ts",
          startedAt: "2026-04-14T10:01:45.000Z",
          finishedAt: "2026-04-14T10:02:00.000Z",
        },
      ],
      workflows: [
        {
          id: "workflow-001",
          sessionId: "session-selectors",
          threadId: "thread-003",
          smithersRunId: "smithers-run-3001",
          workflowName: "selector-workflow",
          status: "waiting",
          summary: "Workflow waiting for clarification",
          startedAt: "2026-04-14T10:02:30.000Z",
          updatedAt: "2026-04-14T10:03:00.000Z",
          finishedAt: null,
        },
      ],
      events: [
        {
          id: "event-001",
          sessionId: "session-selectors",
          at: "2026-04-14T10:00:00.000Z",
          kind: "thread-started",
          threadId: "thread-001",
        },
      ],
    });

    const view = buildStructuredSessionView(snapshot);
    expect(view).toEqual({
      title: "Selector Session",
      sessionStatus: "waiting",
      waitingOn: snapshot.session.waitingOn,
      counts: {
        threads: 3,
        results: 2,
        verifications: 1,
        workflows: 1,
        events: 1,
      },
      threadIdsByStatus: {
        running: [],
        waiting: ["thread-003"],
        failed: ["thread-002"],
      },
    });
  });

  it("builds metadata-first session summary projections for sidebar and list rows", () => {
    const snapshot = createSessionSnapshot({
      pi: {
        sessionId: "session-summary",
        title: "Summary Session",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "high",
        messageCount: 12,
        status: "idle",
        createdAt: "2026-04-14T10:00:00.000Z",
        updatedAt: "2026-04-14T10:08:00.000Z",
      },
      threads: [
        {
          id: "thread-010",
          sessionId: "session-summary",
          kind: "verification",
          objective: "Verification objective",
          status: "failed",
          result: {
            kind: "verification-summary",
            summary: "Verification failed due to one broken suite.",
            body: "Failure details",
            createdAt: "2026-04-14T10:08:00.000Z",
          },
          blockedReason: "Verification failed",
          startedAt: "2026-04-14T10:05:00.000Z",
          updatedAt: "2026-04-14T10:08:00.000Z",
          finishedAt: "2026-04-14T10:08:00.000Z",
        },
      ],
    });

    const summary = buildStructuredSessionSummaryProjection(snapshot);
    expect(summary).toEqual({
      sessionId: "session-summary",
      title: "Summary Session",
      preview: "Verification: Verification failed due to one broken suite.",
      status: "error",
      updatedAt: "2026-04-14T10:08:00.000Z",
      counts: {
        threads: 1,
        results: 1,
        verifications: 0,
        workflows: 0,
        events: 0,
      },
      waitingOn: null,
    });
  });

  it("switches sidebar preview from waiting reason to workflow completion summary after resume", () => {
    const waitingSnapshot = createSessionSnapshot({
      pi: {
        sessionId: "session-workflow-preview",
        title: "Workflow Preview Session",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "high",
        messageCount: 8,
        status: "idle",
        createdAt: "2026-04-14T10:00:00.000Z",
        updatedAt: "2026-04-14T10:04:00.000Z",
      },
      session: {
        waitingOn: {
          threadId: "thread-300",
          reason: "Need clarification before workflow resume.",
          resumeWhen: "Resume when the rollout owner is confirmed.",
          since: "2026-04-14T10:03:00.000Z",
        },
      },
      threads: [
        {
          id: "thread-300",
          sessionId: "session-workflow-preview",
          kind: "workflow",
          objective: "Workflow objective",
          status: "waiting",
          result: null,
          blockedReason: "Need clarification before workflow resume.",
          startedAt: "2026-04-14T10:02:00.000Z",
          updatedAt: "2026-04-14T10:03:00.000Z",
          finishedAt: null,
        },
      ],
      workflows: [
        {
          id: "workflow-300",
          sessionId: "session-workflow-preview",
          threadId: "thread-300",
          smithersRunId: "smithers-run-300",
          workflowName: "delegated-workflow",
          status: "waiting",
          summary: "Workflow waiting for clarification.",
          startedAt: "2026-04-14T10:02:00.000Z",
          updatedAt: "2026-04-14T10:03:00.000Z",
          finishedAt: null,
        },
      ],
    });
    const waitingSummary = buildStructuredSessionSummaryProjection(waitingSnapshot);
    expect(waitingSummary.preview).toBe("Blocked: Need clarification before workflow resume.");
    expect(waitingSummary.status).toBe("waiting");

    const completedSnapshot = createSessionSnapshot({
      ...waitingSnapshot,
      session: { waitingOn: null },
      threads: [
        {
          ...waitingSnapshot.threads[0]!,
          status: "completed",
          blockedReason: null,
          result: {
            kind: "workflow-summary",
            summary: "Workflow resumed and completed after clarification.",
            body: "Workflow resumed and completed after clarification.",
            createdAt: "2026-04-14T10:04:00.000Z",
          },
          updatedAt: "2026-04-14T10:04:00.000Z",
          finishedAt: "2026-04-14T10:04:00.000Z",
        },
      ],
      workflows: [
        {
          ...waitingSnapshot.workflows[0]!,
          status: "completed",
          summary: "Workflow resumed and completed after clarification.",
          updatedAt: "2026-04-14T10:04:00.000Z",
          finishedAt: "2026-04-14T10:04:00.000Z",
        },
      ],
    });
    const completedSummary = buildStructuredSessionSummaryProjection(completedSnapshot);
    expect(completedSummary.preview).toBe(
      "Workflow: Workflow resumed and completed after clarification.",
    );
    expect(completedSummary.status).toBe("idle");

    const completedSummaryAfterRestart =
      buildStructuredSessionSummaryProjection(completedSnapshot);
    expect(completedSummaryAfterRestart.preview).toBe(
      "Workflow: Workflow resumed and completed after clarification.",
    );
  });

  it("groups thread ids by status buckets for compact sidebar projection", () => {
    const grouped = groupThreadIdsByStatus([
      { id: "thread-001", status: "running" },
      { id: "thread-002", status: "waiting" },
      { id: "thread-003", status: "failed" },
      { id: "thread-004", status: "completed" },
    ]);

    expect(grouped).toEqual({
      running: ["thread-001"],
      waiting: ["thread-002"],
      failed: ["thread-003"],
      completed: ["thread-004"],
    });
  });

  it("supports restart hydration from metadata-only summaries without replaying transcript payloads", () => {
    const beforeRestart = createSessionSnapshot({
      pi: {
        sessionId: "session-restart",
        title: "Restart Session",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "high",
        messageCount: 20,
        status: "idle",
        createdAt: "2026-04-14T09:00:00.000Z",
        updatedAt: "2026-04-14T10:00:00.000Z",
      },
      threads: [
        {
          id: "thread-100",
          sessionId: "session-restart",
          kind: "workflow",
          objective: "Resume workflow from durable state",
          status: "waiting",
          result: null,
          blockedReason: "Need user answer",
          startedAt: "2026-04-14T09:30:00.000Z",
          updatedAt: "2026-04-14T10:00:00.000Z",
          finishedAt: null,
        },
      ],
      session: {
        waitingOn: {
          threadId: "thread-100",
          reason: "Need user answer",
          resumeWhen: "Resume after product choice arrives",
          since: "2026-04-14T10:00:00.000Z",
        },
      },
    });

    const summaryBeforeRestart = buildStructuredSessionSummaryProjection(beforeRestart);
    const summaryAfterRestart = buildStructuredSessionSummaryProjection(beforeRestart);

    expect(summaryAfterRestart).toEqual(summaryBeforeRestart);
    expect(summaryAfterRestart.status).toBe("waiting");
    expect(summaryAfterRestart.waitingOn?.threadId).toBe("thread-100");
  });
});
