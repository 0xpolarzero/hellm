import { afterEach, describe, expect, it } from "bun:test";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

const WORKSPACE = {
  id: "/repo/svvy",
  label: "svvy",
  cwd: "/repo/svvy",
} as const;

function createDeterministicClock(start = "2026-04-14T09:00:00.000Z") {
  let cursor = Date.parse(start);
  return () => {
    const next = new Date(cursor).toISOString();
    cursor += 1_000;
    return next;
  };
}

function seedSession(store: StructuredSessionStateStore, sessionId = "session-001") {
  store.upsertPiSession({
    sessionId,
    title: "Structured session smoke",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: 3,
    status: "idle",
    createdAt: "2026-04-14T08:55:00.000Z",
    updatedAt: "2026-04-14T08:56:00.000Z",
  });
}

describe("structured session state write API", () => {
  const stores: StructuredSessionStateStore[] = [];

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop()?.close();
    }
  });

  function createStore() {
    const store = createStructuredSessionStateStore({
      workspace: WORKSPACE,
      now: createDeterministicClock(),
    });
    stores.push(store);
    return store;
  }

  it("mirrors workspace and pi metadata into the structured overlay", () => {
    const store = createStore();
    seedSession(store, "session-metadata");

    const session = store.getSessionState("session-metadata");
    expect(session.workspace).toEqual(WORKSPACE);
    expect(session.pi).toEqual({
      sessionId: "session-metadata",
      title: "Structured session smoke",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      messageCount: 3,
      status: "idle",
      createdAt: "2026-04-14T08:55:00.000Z",
      updatedAt: "2026-04-14T08:56:00.000Z",
    });
  });

  it("keeps mirrored pi.status unchanged while thread, workflow, and waiting writes evolve", () => {
    const store = createStore();
    seedSession(store, "session-pi-status");

    const thread = store.startThread({
      sessionId: "session-pi-status",
      kind: "workflow",
      objective: "Mirror pi status without mutating it from derived thread state",
    });
    store.updateThread({
      threadId: thread.id,
      status: "waiting",
      blockedReason: "Need clarification",
      blockedOn: {
        kind: "external",
        reason: "Need clarification",
        resumeWhen: "Resume when clarification arrives",
        since: "2026-04-14T09:00:01.000Z",
      },
    });
    store.setWaitingState({
      sessionId: "session-pi-status",
      threadId: thread.id,
      kind: "user",
      reason: "Need clarification",
      resumeWhen: "Resume when clarified",
    });

    store.upsertPiSession({
      sessionId: "session-pi-status",
      title: "Structured session smoke",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      messageCount: 7,
      status: "running",
      createdAt: "2026-04-14T08:55:00.000Z",
      updatedAt: "2026-04-14T09:30:00.000Z",
    });

    store.updateThread({
      threadId: thread.id,
      status: "completed",
    });

    const session = store.getSessionState("session-pi-status");
    const [sessionThread] = session.threads;
    expect(sessionThread).toBeDefined();
    expect(session.pi.status).toBe("running");
    expect(sessionThread!.blockedOn).toBeNull();
  });

  it("starts and updates direct, verification, and workflow threads with lifecycle timestamps", () => {
    const store = createStore();
    seedSession(store, "session-threads");

    const direct = store.startThread({
      sessionId: "session-threads",
      kind: "direct",
      objective: "Analyze architecture drift",
    });
    const verification = store.startThread({
      sessionId: "session-threads",
      kind: "verification",
      objective: "Run build and tests after changes",
    });
    const workflow = store.startThread({
      sessionId: "session-threads",
      kind: "workflow",
      objective: "Delegate a bounded Smithers flow",
    });

    expect(direct.status).toBe("running");
    expect(verification.status).toBe("running");
    expect(workflow.status).toBe("running");
    expect(direct.finishedAt).toBeNull();

    const completedDirect = store.updateThread({
      threadId: direct.id,
      status: "completed",
    });
    const failedVerification = store.updateThread({
      threadId: verification.id,
      status: "failed",
      blockedReason: "Test suite is red on main path.",
    });
    const waitingWorkflow = store.updateThread({
      threadId: workflow.id,
      status: "waiting",
      blockedReason: "Need user clarification about rollout strategy.",
      blockedOn: {
        kind: "threads",
        threadIds: [direct.id, verification.id],
        waitPolicy: "all",
        reason: "Need user clarification about rollout strategy.",
        since: "2026-04-14T09:00:02.000Z",
      },
    });
    const resumedWorkflow = store.updateThread({
      threadId: workflow.id,
      status: "completed",
    });

    expect(completedDirect.finishedAt).toBeTruthy();
    expect(failedVerification.status).toBe("failed");
    expect(failedVerification.blockedReason).toBe("Test suite is red on main path.");
    expect(waitingWorkflow.blockedOn).toEqual({
      kind: "threads",
      threadIds: [direct.id, verification.id],
      waitPolicy: "all",
      reason: "Need user clarification about rollout strategy.",
      since: "2026-04-14T09:00:02.000Z",
    });
    expect(waitingWorkflow.status).toBe("waiting");
    expect(waitingWorkflow.blockedReason).toBe("Need user clarification about rollout strategy.");
    expect(resumedWorkflow.blockedOn).toBeNull();
  });

  it("enforces one durable result per thread", () => {
    const store = createStore();
    seedSession(store, "session-results");

    const thread = store.startThread({
      sessionId: "session-results",
      kind: "direct",
      objective: "Publish one durable result",
    });

    const first = store.setThreadResult({
      threadId: thread.id,
      kind: "analysis-summary",
      summary: "Thread result persisted.",
      body: "The direct thread produced one durable result object.",
    });

    expect(first.kind).toBe("analysis-summary");
    expect(first.summary).toContain("persisted");

    expect(() =>
      store.setThreadResult({
        threadId: thread.id,
        kind: "change-summary",
        summary: "Second result should be rejected.",
        body: "This write must fail because one thread gets one durable result.",
      }),
    ).toThrow(/already has a result/i);
  });

  it("records verifications and keeps them linked to the parent thread", () => {
    const store = createStore();
    seedSession(store, "session-verifications");

    const thread = store.startThread({
      sessionId: "session-verifications",
      kind: "verification",
      objective: "Treat verification as first-class state",
    });

    const failed = store.recordVerification({
      threadId: thread.id,
      kind: "test",
      status: "failed",
      summary: "Unit tests failed in session-state projections.",
      command: "bun test src/bun/structured-session-selectors.test.ts",
    });
    const cancelled = store.recordVerification({
      threadId: thread.id,
      kind: "manual",
      status: "cancelled",
      summary: "Manual verification cancelled by operator.",
    });

    expect(failed.threadId).toBe(thread.id);
    expect(failed.command).toContain("bun test");
    expect(cancelled.status).toBe("cancelled");

    const detail = store.getThreadDetail(thread.id);
    expect(detail.verifications.map((entry) => entry.id)).toEqual([failed.id, cancelled.id]);
  });

  it("preserves thread dependency blocking without turning the session into waiting", () => {
    const store = createStore();
    seedSession(store, "session-blocked-on");

    const thread = store.startThread({
      sessionId: "session-blocked-on",
      kind: "workflow",
      objective: "Wait on peer work without pausing the whole session",
    });

    const blocked = store.updateThread({
      threadId: thread.id,
      status: "waiting",
      blockedReason: "Waiting on parallel peer threads.",
      blockedOn: {
        kind: "threads",
        threadIds: ["thread-010", "thread-011"],
        waitPolicy: "all",
        reason: "Waiting on parallel peer threads.",
        since: "2026-04-14T09:00:03.000Z",
      },
    });

    expect(blocked.blockedOn).toEqual({
      kind: "threads",
      threadIds: ["thread-010", "thread-011"],
      waitPolicy: "all",
      reason: "Waiting on parallel peer threads.",
      since: "2026-04-14T09:00:03.000Z",
    });

    const session = store.getSessionState("session-blocked-on");
    const [blockedThread] = session.threads;
    expect(blockedThread).toBeDefined();
    expect(session.session.waitingOn).toBeNull();
    expect(blockedThread!.blockedOn).toEqual(blocked.blockedOn);

    const completed = store.updateThread({
      threadId: thread.id,
      status: "completed",
    });

    expect(completed.blockedOn).toBeNull();
  });

  it("enforces one workflow projection per workflow thread and updates projected status", () => {
    const store = createStore();
    seedSession(store, "session-workflow");

    const thread = store.startThread({
      sessionId: "session-workflow",
      kind: "workflow",
      objective: "Project delegated workflow status in session state",
    });

    const projection = store.startWorkflow({
      threadId: thread.id,
      smithersRunId: "smithers-run-4021",
      workflowName: "workflow-resume-poc",
      summary: "Delegated workflow started.",
    });

    expect(projection.status).toBe("running");
    expect(projection.threadId).toBe(thread.id);

    const waiting = store.updateWorkflow({
      workflowId: projection.id,
      status: "waiting",
      summary: "Workflow paused for clarification.",
    });
    expect(waiting.status).toBe("waiting");
    expect(waiting.finishedAt).toBeNull();

    expect(() =>
      store.startWorkflow({
        threadId: thread.id,
        smithersRunId: "smithers-run-9999",
        workflowName: "workflow-duplicate",
        summary: "Should fail because one workflow projection per thread.",
      }),
    ).toThrow(/already has a workflow/i);
  });

  it("rejects workflow projections on non-workflow threads", () => {
    const store = createStore();
    seedSession(store, "session-non-workflow");

    const thread = store.startThread({
      sessionId: "session-non-workflow",
      kind: "verification",
      objective: "Verification threads cannot own workflow projections",
    });

    expect(() =>
      store.startWorkflow({
        threadId: thread.id,
        smithersRunId: "smithers-run-non-workflow",
        workflowName: "invalid-workflow-owner",
        summary: "Should fail because only workflow threads can own workflow projections.",
      }),
    ).toThrow(/workflow threads/i);
  });

  it("tracks session waiting ownership and clears waiting when the owning thread leaves waiting", () => {
    const store = createStore();
    seedSession(store, "session-waiting");

    const workflowThread = store.startThread({
      sessionId: "session-waiting",
      kind: "workflow",
      objective: "Pause and resume cleanly",
    });

    store.updateThread({
      threadId: workflowThread.id,
      status: "waiting",
      blockedReason: "Need user confirmation before resume.",
      blockedOn: {
        kind: "user",
        reason: "Need user confirmation before resume.",
        resumeWhen: "Resume when the user confirms the migration strategy.",
        since: "2026-04-14T09:00:04.000Z",
      },
    });

    const waitingOn = store.setWaitingState({
      sessionId: "session-waiting",
      threadId: workflowThread.id,
      kind: "user",
      reason: "Need user confirmation before resume.",
      resumeWhen: "Resume when user answers the migration strategy question.",
    });
    expect(waitingOn.threadId).toBe(workflowThread.id);
    expect(waitingOn.resumeWhen).toContain("Resume when user");
    const waitingSession = store.getSessionState("session-waiting");
    const [waitingThread] = waitingSession.threads;
    expect(waitingThread).toBeDefined();
    expect(waitingThread!.blockedOn).toEqual({
      kind: "user",
      reason: "Need user confirmation before resume.",
      resumeWhen: "Resume when user answers the migration strategy question.",
      since: "2026-04-14T09:00:02.000Z",
    });

    store.updateThread({
      threadId: workflowThread.id,
      status: "completed",
    });

    expect(store.getSessionState("session-waiting").session.waitingOn).toBeNull();
    const completedSession = store.getSessionState("session-waiting");
    const [completedThread] = completedSession.threads;
    expect(completedThread).toBeDefined();
    expect(completedThread!.blockedOn).toBeNull();
  });

  it("emits append-only lifecycle events for thread, verification, workflow, and waiting transitions", () => {
    const store = createStore();
    seedSession(store, "session-events");

    const thread = store.startThread({
      sessionId: "session-events",
      kind: "workflow",
      objective: "Ensure events track all meaningful transitions",
    });
    store.updateThread({
      threadId: thread.id,
      status: "waiting",
      blockedReason: "Needs clarification",
      blockedOn: {
        kind: "external",
        reason: "Needs clarification",
        resumeWhen: "Resume when the reviewer answers.",
        since: "2026-04-14T09:00:06.000Z",
      },
    });
    store.setThreadResult({
      threadId: thread.id,
      kind: "workflow-summary",
      summary: "Workflow thread captured one durable result.",
      body: "Result body",
    });
    store.recordVerification({
      threadId: thread.id,
      kind: "test",
      status: "failed",
      summary: "One suite failed",
    });
    const workflow = store.startWorkflow({
      threadId: thread.id,
      smithersRunId: "smithers-run-events",
      workflowName: "events-check",
      summary: "Workflow projection started",
    });
    store.updateWorkflow({
      workflowId: workflow.id,
      status: "failed",
      summary: "Workflow failed",
    });
    store.setWaitingState({
      sessionId: "session-events",
      threadId: thread.id,
      kind: "external",
      reason: "Need clarification",
      resumeWhen: "Resume after answer",
    });
    store.updateThread({
      threadId: thread.id,
      status: "failed",
      blockedReason: "Clarification timed out",
    });

    const events = store.getSessionState("session-events").events;
    expect(events.map((event) => event.kind)).toEqual([
      "thread-started",
      "thread-status-changed",
      "thread-result-created",
      "verification-finished",
      "workflow-started",
      "workflow-status-changed",
      "thread-status-changed",
      "session-waiting-started",
      "session-waiting-ended",
      "thread-status-changed",
    ]);
    expect(events.map((event) => event.id)).toEqual([
      "event-001",
      "event-002",
      "event-003",
      "event-004",
      "event-005",
      "event-006",
      "event-007",
      "event-008",
      "event-009",
      "event-010",
    ]);
  });
});
