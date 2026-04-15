import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

const WORKSPACE = {
  id: "/repo/svvy",
  label: "svvy",
  cwd: "/repo/svvy",
} as const;

function createDeterministicClock(start = "2026-04-14T12:00:00.000Z") {
  let cursor = Date.parse(start);
  return () => {
    const next = new Date(cursor).toISOString();
    cursor += 1_000;
    return next;
  };
}

function seedSession(
  store: StructuredSessionStateStore,
  input: { sessionId: string; title: string; messageCount?: number },
) {
  store.upsertPiSession({
    sessionId: input.sessionId,
    title: input.title,
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: input.messageCount ?? 0,
    status: "idle",
    createdAt: "2026-04-14T11:55:00.000Z",
    updatedAt: "2026-04-14T11:55:00.000Z",
  });
}

describe("structured session state SQLite persistence", () => {
  const tempDirs: string[] = [];
  const openStores: StructuredSessionStateStore[] = [];

  afterEach(() => {
    while (openStores.length > 0) {
      openStores.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  function createSqliteStore(
    options: { databasePath?: string; nowStart?: string } = {},
  ): { databasePath: string; store: StructuredSessionStateStore } {
    const root = mkdtempSync(join(tmpdir(), "svvy-structured-sqlite-"));
    tempDirs.push(root);
    const databasePath = options.databasePath ?? join(root, "structured-session-state.sqlite");
    const store = createStructuredSessionStateStore({
      workspace: WORKSPACE,
      databasePath,
      now: createDeterministicClock(options.nowStart ?? "2026-04-14T12:00:00.000Z"),
    });
    openStores.push(store);
    return { databasePath, store };
  }

  it("persists overlay writes and reloads the same session state without transcript replay", () => {
    const first = createSqliteStore();
    seedSession(first.store, { sessionId: "session-persist", title: "Persist me", messageCount: 6 });

    const direct = first.store.startThread({
      sessionId: "session-persist",
      kind: "direct",
      objective: "Persist direct thread",
    });
    first.store.setThreadResult({
      threadId: direct.id,
      kind: "change-summary",
      summary: "Persisted result summary",
      body: "Persisted result body",
    });
    first.store.updateThread({
      threadId: direct.id,
      status: "completed",
    });

    const verification = first.store.startThread({
      sessionId: "session-persist",
      kind: "verification",
      objective: "Persist verification state",
    });
    first.store.recordVerification({
      threadId: verification.id,
      kind: "test",
      status: "failed",
      summary: "Integration suite failed on restart path.",
      command: "bun test src/bun/structured-session-state-sqlite.test.ts",
    });
    first.store.updateThread({
      threadId: verification.id,
      status: "failed",
      blockedReason: "Verification is red.",
    });

    const workflow = first.store.startThread({
      sessionId: "session-persist",
      kind: "workflow",
      objective: "Persist blockedOn dependency state",
    });
    first.store.updateThread({
      threadId: workflow.id,
      status: "waiting",
      blockedReason: "Waiting on peer threads before resume.",
      blockedOn: {
        kind: "threads",
        threadIds: [direct.id, verification.id],
        waitPolicy: "all",
        reason: "Waiting on peer threads before resume.",
        since: "2026-04-14T12:00:03.000Z",
      },
    });

    const beforeReload = first.store.getSessionState("session-persist");
    first.store.close();

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-persist");

    expect(afterReload).toEqual(beforeReload);
  });

  it("persists session waiting ownership and the thread-level waiting cause across restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, { sessionId: "session-waiting-persist", title: "Waiting Persist" });

    const thread = first.store.startThread({
      sessionId: "session-waiting-persist",
      kind: "workflow",
      objective: "Persist waiting ownership",
    });

    const waitingOn = first.store.setWaitingState({
      sessionId: "session-waiting-persist",
      threadId: thread.id,
      kind: "external",
      reason: "Waiting on Smithers milestone completion.",
      resumeWhen: "Resume when the milestone gate passes.",
    });

    const beforeReload = first.store.getSessionState("session-waiting-persist");
    first.store.close();

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-waiting-persist");
    const [reloadedThread] = afterReload.threads;

    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.session.waitingOn).toEqual(waitingOn);
    expect(reloadedThread).toBeDefined();
    expect(reloadedThread!.blockedOn).toEqual({
      kind: "external",
      reason: "Waiting on Smithers milestone completion.",
      resumeWhen: "Resume when the milestone gate passes.",
      since: waitingOn.since,
    });
  });

  it("scopes records by session id when multiple sessions share one workspace database", () => {
    const { store } = createSqliteStore();
    seedSession(store, { sessionId: "session-alpha", title: "Alpha" });
    seedSession(store, { sessionId: "session-beta", title: "Beta" });

    const alphaThread = store.startThread({
      sessionId: "session-alpha",
      kind: "direct",
      objective: "Alpha objective",
    });
    const betaThread = store.startThread({
      sessionId: "session-beta",
      kind: "workflow",
      objective: "Beta objective",
    });

    store.recordVerification({
      threadId: alphaThread.id,
      kind: "lint",
      status: "passed",
      summary: "Alpha lint passed",
    });
    const betaWorkflow = store.startWorkflow({
      threadId: betaThread.id,
      smithersRunId: "smithers-run-beta",
      workflowName: "beta-workflow",
      summary: "Beta workflow started",
    });
    store.updateWorkflow({
      workflowId: betaWorkflow.id,
      status: "waiting",
      summary: "Beta workflow waiting",
    });

    const alphaState = store.getSessionState("session-alpha");
    const betaState = store.getSessionState("session-beta");

    expect(alphaState.threads.map((thread) => thread.id)).toEqual([alphaThread.id]);
    expect(alphaState.workflows).toHaveLength(0);
    expect(alphaState.verifications).toHaveLength(1);

    expect(betaState.threads.map((thread) => thread.id)).toEqual([betaThread.id]);
    expect(betaState.workflows).toHaveLength(1);
    expect(betaState.verifications).toHaveLength(0);
  });

  it("enforces one workflow projection per thread at the database boundary", () => {
    const { store } = createSqliteStore();
    seedSession(store, { sessionId: "session-unique-workflow", title: "Unique Workflow" });

    const thread = store.startThread({
      sessionId: "session-unique-workflow",
      kind: "workflow",
      objective: "Only one workflow row allowed",
    });

    store.startWorkflow({
      threadId: thread.id,
      smithersRunId: "smithers-run-1",
      workflowName: "workflow-1",
      summary: "First workflow projection",
    });

    expect(() =>
      store.startWorkflow({
        threadId: thread.id,
        smithersRunId: "smithers-run-2",
        workflowName: "workflow-2",
        summary: "Second workflow projection should fail",
      }),
    ).toThrow(/workflow/i);
  });

  it("rejects workflow projections on non-workflow threads at the database boundary", () => {
    const { store } = createSqliteStore();
    seedSession(store, { sessionId: "session-invalid-owner", title: "Invalid Owner" });

    const thread = store.startThread({
      sessionId: "session-invalid-owner",
      kind: "direct",
      objective: "Direct threads cannot own workflow projections",
    });

    expect(() =>
      store.startWorkflow({
        threadId: thread.id,
        smithersRunId: "smithers-run-invalid-owner",
        workflowName: "invalid-owner",
        summary: "Should fail because only workflow threads can own projections",
      }),
    ).toThrow(/workflow threads/i);
  });

  it("continues deterministic thread, verification, and workflow ids after restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, { sessionId: "session-id-sequence", title: "ID Sequence" });

    const directThread = first.store.startThread({
      sessionId: "session-id-sequence",
      kind: "direct",
      objective: "First thread before restart",
    });
    const firstVerification = first.store.recordVerification({
      threadId: directThread.id,
      kind: "test",
      status: "passed",
      summary: "First verification",
    });

    const workflowThread = first.store.startThread({
      sessionId: "session-id-sequence",
      kind: "workflow",
      objective: "First workflow thread before restart",
    });
    const firstWorkflow = first.store.startWorkflow({
      threadId: workflowThread.id,
      smithersRunId: "smithers-run-sequence-1",
      workflowName: "id-sequence-1",
      summary: "First workflow projection",
    });

    expect(directThread.id).toBe("thread-001");
    expect(workflowThread.id).toBe("thread-002");
    expect(firstVerification.id).toBe("verification-001");
    expect(firstWorkflow.id).toBe("workflow-001");
    first.store.close();

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });

    const resumedThread = second.store.startThread({
      sessionId: "session-id-sequence",
      kind: "direct",
      objective: "Thread after restart",
    });
    const resumedVerification = second.store.recordVerification({
      threadId: resumedThread.id,
      kind: "lint",
      status: "passed",
      summary: "Verification after restart",
    });
    const resumedWorkflowThread = second.store.startThread({
      sessionId: "session-id-sequence",
      kind: "workflow",
      objective: "Workflow thread after restart",
    });
    const resumedWorkflow = second.store.startWorkflow({
      threadId: resumedWorkflowThread.id,
      smithersRunId: "smithers-run-sequence-2",
      workflowName: "id-sequence-2",
      summary: "Workflow projection after restart",
    });

    expect(resumedThread.id).toBe("thread-003");
    expect(resumedWorkflowThread.id).toBe("thread-004");
    expect(resumedVerification.id).toBe("verification-002");
    expect(resumedWorkflow.id).toBe("workflow-002");
  });

  it("keeps the lifecycle event log append-only across restart boundaries", () => {
    const first = createSqliteStore();
    seedSession(first.store, { sessionId: "session-events", title: "Events" });
    const thread = first.store.startThread({
      sessionId: "session-events",
      kind: "workflow",
      objective: "Track lifecycle events",
    });

    first.store.updateThread({
      threadId: thread.id,
      status: "waiting",
      blockedReason: "Need clarification",
      blockedOn: {
        kind: "user",
        reason: "Need clarification",
        resumeWhen: "Resume when the user answers the migration strategy question.",
        since: "2026-04-14T12:00:01.000Z",
      },
    });
    first.store.setWaitingState({
      sessionId: "session-events",
      threadId: thread.id,
      kind: "user",
      reason: "Need clarification",
      resumeWhen: "Resume after user answer",
    });

    const workflow = first.store.startWorkflow({
      threadId: thread.id,
      smithersRunId: "smithers-run-events",
      workflowName: "events-flow",
      summary: "Workflow started",
    });
    first.store.updateWorkflow({
      workflowId: workflow.id,
      status: "completed",
      summary: "Workflow completed",
    });
    first.store.updateThread({
      threadId: thread.id,
      status: "completed",
    });

    const initialKinds = first.store.getSessionState("session-events").events.map((event) => event.kind);
    first.store.close();

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    second.store.recordVerification({
      threadId: thread.id,
      kind: "manual",
      status: "passed",
      summary: "Post-restart manual verification passed",
    });

    const afterRestartKinds = second.store
      .getSessionState("session-events")
      .events.map((event) => event.kind);

    expect(afterRestartKinds).toEqual([...initialKinds, "verification-finished"]);
  });
});
