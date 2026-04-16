import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

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

  function createSqliteStore(options: { databasePath?: string; nowStart?: string } = {}): {
    databasePath: string;
    store: StructuredSessionStateStore;
    workspaceCwd: string;
  } {
    const root = mkdtempSync(join(tmpdir(), "svvy-structured-sqlite-"));
    tempDirs.push(root);
    const databasePath = options.databasePath ?? join(root, "structured-session-state.sqlite");
    const workspaceCwd = root;
    const store = createStructuredSessionStateStore({
      workspace: {
        id: workspaceCwd,
        label: "svvy",
        cwd: workspaceCwd,
      },
      databasePath,
      now: createDeterministicClock(options.nowStart ?? "2026-04-14T12:00:00.000Z"),
    });
    openStores.push(store);
    return { databasePath, store, workspaceCwd };
  }

  function closeTrackedStore(store: StructuredSessionStateStore) {
    const index = openStores.indexOf(store);
    if (index >= 0) {
      openStores.splice(index, 1);
    }
    store.close();
  }

  it("persists structured turn, thread, command, episode, artifact, verification, and workflow state across restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-persist",
      title: "Persist me",
      messageCount: 6,
    });

    const turn = first.store.startTurn({
      sessionId: "session-persist",
      requestSummary: "Persist the structured command model",
    });
    const rootThread = first.store.createThread({
      turnId: turn.id,
      kind: "task",
      title: "Persist the structured command model",
      objective: "Keep turn, command, and episode rows durable.",
    });
    const command = first.store.createCommand({
      turnId: turn.id,
      threadId: rootThread.id,
      toolName: "execute_typescript",
      executor: "execute_typescript",
      visibility: "trace",
      title: "Inspect session",
      summary: "Inspect the structured session state rows.",
    });
    first.store.startCommand(command.id);
    first.store.finishCommand({
      commandId: command.id,
      status: "succeeded",
      summary: "Inspection completed.",
      facts: {
        repoReads: 3,
        childCommandCount: 4,
      },
    });
    const episode = first.store.createEpisode({
      threadId: rootThread.id,
      sourceCommandId: command.id,
      kind: "analysis",
      title: "Persistence notes",
      summary: "The row set is durable.",
      body: "The row set is durable.",
    });
    const artifact = first.store.createArtifact({
      episodeId: episode.id,
      sourceCommandId: command.id,
      kind: "text",
      name: "notes.md",
      content: "# Durable notes\n",
    });
    const verificationThread = first.store.createThread({
      turnId: turn.id,
      kind: "verification",
      title: "Run verification",
      objective: "Persist verification records.",
    });
    const verificationCommand = first.store.createCommand({
      turnId: turn.id,
      threadId: verificationThread.id,
      toolName: "verification.run",
      executor: "verification",
      visibility: "surface",
      title: "Run verification",
      summary: "Persist verification command rows.",
    });
    const verification = first.store.recordVerification({
      threadId: verificationThread.id,
      commandId: verificationCommand.id,
      kind: "test",
      status: "failed",
      summary: "Integration suite failed.",
      command: "bun run test:e2e",
    });
    const workflowThread = first.store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Run workflow",
      objective: "Persist workflow records.",
    });
    const workflowCommand = first.store.createCommand({
      turnId: turn.id,
      threadId: workflowThread.id,
      toolName: "workflow.start",
      executor: "smithers",
      visibility: "surface",
      title: "Start workflow",
      summary: "Persist workflow command rows.",
    });
    const workflow = first.store.recordWorkflow({
      threadId: workflowThread.id,
      commandId: workflowCommand.id,
      smithersRunId: "smithers-run-beta",
      workflowName: "beta-workflow",
      status: "running",
      summary: "Workflow is still running.",
    });
    first.store.updateWorkflow({
      workflowId: workflow.id,
      status: "completed",
      summary: "Workflow completed.",
    });
    first.store.updateThread({
      threadId: workflowThread.id,
      status: "completed",
    });
    first.store.updateThread({
      threadId: rootThread.id,
      status: "completed",
    });
    first.store.finishTurn({
      turnId: turn.id,
      status: "completed",
    });

    const beforeReload = first.store.getSessionState("session-persist");
    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-persist");

    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.threads.map((thread) => thread.id)).toEqual([
      rootThread.id,
      verificationThread.id,
      workflowThread.id,
    ]);
    expect(afterReload.commands.map((commandRow) => commandRow.id)).toEqual([
      command.id,
      verificationCommand.id,
      workflowCommand.id,
    ]);
    expect(afterReload.commands).toContainEqual(
      expect.objectContaining({
        id: command.id,
        facts: {
          repoReads: 3,
          childCommandCount: 4,
        },
      }),
    );
    expect(afterReload.episodes).toEqual([
      expect.objectContaining({
        id: episode.id,
        artifactIds: [artifact.id],
      }),
    ]);
    expect(afterReload.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        episodeId: episode.id,
        sourceCommandId: command.id,
      }),
    ]);
    expect(afterReload.verifications).toEqual([
      expect.objectContaining({
        id: verification.id,
        commandId: verificationCommand.id,
      }),
    ]);
  });

  it("writes artifacts into the workspace-scoped artifact directory with persisted path metadata", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-artifact-files",
      title: "Artifact Files",
    });

    const turn = store.startTurn({
      sessionId: "session-artifact-files",
      requestSummary: "Persist file-backed artifacts",
    });
    const thread = store.createThread({
      turnId: turn.id,
      kind: "task",
      title: "Persist file-backed artifacts",
      objective: "Keep artifact payloads on disk instead of only in SQLite.",
    });
    const command = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "orchestrator",
      visibility: "summary",
      title: "Persist snippet",
      summary: "Persist a snippet artifact before execution.",
    });
    const artifact = store.createArtifact({
      sourceCommandId: command.id,
      kind: "text",
      name: "snippet.ts",
      content: 'console.log("hello from artifact");\n',
    });

    const snapshot = store.getSessionState("session-artifact-files");
    const expectedArtifactRoot = join(workspaceCwd, ".svvy", "artifacts");
    const expectedArtifactDir = join(expectedArtifactRoot, "session-artifact-files");

    expect(snapshot.workspace).toEqual(
      expect.objectContaining({
        artifactDir: expectedArtifactRoot,
      }),
    );
    expect(artifact.path).toBe(join(expectedArtifactDir, `${artifact.id}-snippet.ts`));
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        sourceCommandId: command.id,
        path: artifact.path,
      }),
    ]);
    expect(existsSync(artifact.path!)).toBe(true);
    expect(readFileSync(artifact.path!, "utf8")).toBe('console.log("hello from artifact");\n');
  });

  it("persists session wait and clears it when the owning thread resumes", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-waiting-persist",
      title: "Waiting Persist",
    });

    const turn = first.store.startTurn({
      sessionId: "session-waiting-persist",
      requestSummary: "Persist session wait",
    });
    const thread = first.store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Waiting workflow",
      objective: "Persist session wait details.",
    });
    const wait = {
      kind: "external" as const,
      reason: "Waiting on Smithers milestone completion.",
      resumeWhen: "Resume when the milestone gate passes.",
      since: "2026-04-14T12:00:02.000Z",
    };
    first.store.updateThread({
      threadId: thread.id,
      status: "waiting",
      wait,
    });
    const waitingOn = first.store.setSessionWait({
      sessionId: "session-waiting-persist",
      threadId: thread.id,
      ...wait,
    });

    const beforeReload = first.store.getSessionState("session-waiting-persist");
    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-waiting-persist");
    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.session.wait).toEqual(waitingOn);
    expect(afterReload.threads[0]?.wait).toEqual(wait);

    second.store.updateThread({
      threadId: thread.id,
      status: "completed",
    });

    const resumed = second.store.getSessionState("session-waiting-persist");
    expect(resumed.session.wait).toBeNull();
    expect(resumed.threads[0]?.wait).toBeNull();

    closeTrackedStore(second.store);

    const third = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T14:00:00.000Z",
    });
    const afterClearedReload = third.store.getSessionState("session-waiting-persist");
    expect(afterClearedReload.session.wait).toBeNull();
    expect(afterClearedReload.threads[0]?.wait).toBeNull();
  });

  it("persists session wait clearing when new runnable thread is created", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-wait-cleared-by-create",
      title: "Waiting Create Clear Persist",
    });

    const turn = first.store.startTurn({
      sessionId: "session-wait-cleared-by-create",
      requestSummary: "Clear wait when runnable thread appears",
    });
    const waitingThread = first.store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Need input",
      objective: "Pause until input arrives.",
    });
    const wait = {
      kind: "user" as const,
      reason: "Need missing launch details",
      resumeWhen: "Resume when launch details arrive.",
      since: "2026-04-14T12:00:02.000Z",
    };
    first.store.updateThread({
      threadId: waitingThread.id,
      status: "waiting",
      wait,
    });
    first.store.setSessionWait({
      sessionId: "session-wait-cleared-by-create",
      threadId: waitingThread.id,
      ...wait,
    });

    const runnableThread = first.store.createThread({
      turnId: turn.id,
      kind: "task",
      title: "Continue implementation",
      objective: "Resume runnable work now that there is new scope.",
    });
    const beforeReload = first.store.getSessionState("session-wait-cleared-by-create");
    expect(runnableThread.status).toBe("running");
    expect(beforeReload.session.wait).toBeNull();

    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-wait-cleared-by-create");

    expect(afterReload.session.wait).toBeNull();
    expect(afterReload.threads.find((thread) => thread.id === runnableThread.id)?.status).toBe(
      "running",
    );
  });

  it("reconciles stale persisted session wait when runnable work exists after restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-wait-reconcile-on-restart",
      title: "Waiting Reconcile Persist",
    });

    const turn = first.store.startTurn({
      sessionId: "session-wait-reconcile-on-restart",
      requestSummary: "Create initial wait state",
    });
    const waitingThread = first.store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Wait thread",
      objective: "Populate wait state before restart reconciliation.",
    });
    const wait = {
      kind: "external" as const,
      reason: "Waiting on external system",
      resumeWhen: "Resume when external system responds.",
      since: "2026-04-14T12:00:02.000Z",
    };
    first.store.updateThread({
      threadId: waitingThread.id,
      status: "waiting",
      wait,
    });
    first.store.setSessionWait({
      sessionId: "session-wait-reconcile-on-restart",
      threadId: waitingThread.id,
      ...wait,
    });
    closeTrackedStore(first.store);

    const rawDb = new Database(first.databasePath);
    rawDb
      .query(
        `UPDATE thread
         SET
           status = 'running',
           depends_on_thread_ids = '[]',
           wait_kind = NULL,
           wait_reason = NULL,
           wait_resume_when = NULL,
           wait_since = NULL
         WHERE id = ?`,
      )
      .run(waitingThread.id);
    rawDb.close();

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const snapshot = second.store.getSessionState("session-wait-reconcile-on-restart");

    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.threads[0]?.status).toBe("running");
    expect(snapshot.threads[0]?.wait).toBeNull();
    expect(snapshot.events.map((event) => event.kind)).toContain("session.wait.cleared");
  });

  it("reconciles stale persisted session wait when the owning thread is no longer waiting", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-wait-owner-not-waiting",
      title: "Waiting Owner Not Waiting",
    });

    const turn = first.store.startTurn({
      sessionId: "session-wait-owner-not-waiting",
      requestSummary: "Create wait state before invalid owner restart",
    });
    const waitingThread = first.store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Wait owner",
      objective: "Own session wait before becoming stale.",
    });
    const wait = {
      kind: "user" as const,
      reason: "Need final approval",
      resumeWhen: "Resume when final approval arrives.",
      since: "2026-04-14T12:00:02.000Z",
    };
    first.store.updateThread({
      threadId: waitingThread.id,
      status: "waiting",
      wait,
    });
    first.store.setSessionWait({
      sessionId: "session-wait-owner-not-waiting",
      threadId: waitingThread.id,
      ...wait,
    });
    closeTrackedStore(first.store);

    const rawDb = new Database(first.databasePath);
    rawDb
      .query(
        `UPDATE thread
         SET
           status = 'completed',
           wait_kind = NULL,
           wait_reason = NULL,
           wait_resume_when = NULL,
           wait_since = NULL,
           finished_at = ?
         WHERE id = ?`,
      )
      .run("2026-04-14T12:10:00.000Z", waitingThread.id);
    rawDb.close();

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const snapshot = second.store.getSessionState("session-wait-owner-not-waiting");

    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.threads[0]).toMatchObject({
      id: waitingThread.id,
      status: "completed",
      wait: null,
    });
    expect(snapshot.events.map((event) => event.kind)).toContain("session.wait.cleared");
  });

  it("continues deterministic ids after restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, { sessionId: "session-id-sequence", title: "ID Sequence" });

    const firstTurn = first.store.startTurn({
      sessionId: "session-id-sequence",
      requestSummary: "First turn",
    });
    const firstThread = first.store.createThread({
      turnId: firstTurn.id,
      kind: "verification",
      title: "First verification thread",
      objective: "Allocate the first verification ids.",
    });
    const firstCommand = first.store.createCommand({
      turnId: firstTurn.id,
      threadId: firstThread.id,
      toolName: "verification.run",
      executor: "verification",
      visibility: "surface",
      title: "Run verification",
      summary: "Allocate command ids.",
    });
    const firstEpisode = first.store.createEpisode({
      threadId: firstThread.id,
      sourceCommandId: firstCommand.id,
      kind: "verification",
      title: "Verification results",
      summary: "First verification",
      body: "First verification",
    });
    const firstArtifact = first.store.createArtifact({
      episodeId: firstEpisode.id,
      sourceCommandId: firstCommand.id,
      kind: "text",
      name: "verification.txt",
      content: "First verification",
    });
    first.store.recordVerification({
      threadId: firstThread.id,
      commandId: firstCommand.id,
      kind: "test",
      status: "passed",
      summary: "First verification",
      command: "bun run test",
    });

    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const resumedTurn = second.store.startTurn({
      sessionId: "session-id-sequence",
      requestSummary: "Second turn",
    });
    const resumedThread = second.store.createThread({
      turnId: resumedTurn.id,
      kind: "workflow",
      title: "Second workflow thread",
      objective: "Allocate the next ids.",
    });
    const resumedCommand = second.store.createCommand({
      turnId: resumedTurn.id,
      threadId: resumedThread.id,
      toolName: "workflow.start",
      executor: "smithers",
      visibility: "surface",
      title: "Start workflow",
      summary: "Allocate workflow command ids.",
    });
    const resumedEpisode = second.store.createEpisode({
      threadId: resumedThread.id,
      sourceCommandId: resumedCommand.id,
      kind: "workflow",
      title: "Workflow results",
      summary: "Second workflow",
      body: "Second workflow",
    });
    second.store.createArtifact({
      episodeId: resumedEpisode.id,
      sourceCommandId: resumedCommand.id,
      kind: "text",
      name: "workflow.txt",
      content: "Second workflow",
    });

    expect(firstTurn.id).toBe("turn-1");
    expect(firstThread.id).toBe("thread-1");
    expect(firstCommand.id).toBe("command-1");
    expect(firstEpisode.id).toBe("episode-1");
    expect(firstArtifact.id).toBe("artifact-1");
    expect(resumedTurn.id).toBe("turn-2");
    expect(resumedThread.id).toBe("thread-2");
    expect(resumedCommand.id).toBe("command-2");
    expect(resumedEpisode.id).toBe("episode-2");
  });

  it("persists command-scoped artifacts without an episode across restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-command-artifacts",
      title: "Command Artifacts",
    });

    const turn = first.store.startTurn({
      sessionId: "session-command-artifacts",
      requestSummary: "Persist command-scoped artifacts",
    });
    const thread = first.store.createThread({
      turnId: turn.id,
      kind: "task",
      title: "Persist command artifacts",
      objective: "Keep command artifacts durable across restart.",
    });
    const command = first.store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "execute_typescript",
      visibility: "summary",
      title: "Persist command artifacts",
      summary: "Persist command-scoped artifacts.",
    });
    const artifact = first.store.createArtifact({
      sourceCommandId: command.id,
      kind: "json",
      name: "snippet.json",
      content: '{"ok":true}',
    });

    const beforeReload = first.store.getSessionState("session-command-artifacts");
    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-14T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-command-artifacts");
    const detail = second.store.getThreadDetail(thread.id);

    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        episodeId: null,
        sourceCommandId: command.id,
      }),
    ]);
    expect(detail.artifacts.map((entry) => entry.id)).toEqual([artifact.id]);
  });

  it("scopes records by session id when multiple sessions share one workspace database", () => {
    const { store } = createSqliteStore();
    seedSession(store, { sessionId: "session-alpha", title: "Alpha" });
    seedSession(store, { sessionId: "session-beta", title: "Beta" });

    const alphaTurn = store.startTurn({
      sessionId: "session-alpha",
      requestSummary: "Alpha turn",
    });
    const alphaThread = store.createThread({
      turnId: alphaTurn.id,
      kind: "verification",
      title: "Alpha verification",
      objective: "Alpha verification objective",
    });
    const alphaCommand = store.createCommand({
      turnId: alphaTurn.id,
      threadId: alphaThread.id,
      toolName: "verification.run",
      executor: "verification",
      visibility: "surface",
      title: "Alpha verification",
      summary: "Alpha command",
    });
    store.recordVerification({
      threadId: alphaThread.id,
      commandId: alphaCommand.id,
      kind: "lint",
      status: "passed",
      summary: "Alpha lint passed",
    });

    const betaTurn = store.startTurn({
      sessionId: "session-beta",
      requestSummary: "Beta turn",
    });
    const betaThread = store.createThread({
      turnId: betaTurn.id,
      kind: "workflow",
      title: "Beta workflow",
      objective: "Beta objective",
    });
    const betaCommand = store.createCommand({
      turnId: betaTurn.id,
      threadId: betaThread.id,
      toolName: "workflow.start",
      executor: "smithers",
      visibility: "surface",
      title: "Beta workflow",
      summary: "Beta command",
    });
    const betaWorkflow = store.recordWorkflow({
      threadId: betaThread.id,
      commandId: betaCommand.id,
      smithersRunId: "smithers-run-beta",
      workflowName: "beta-workflow",
      status: "running",
      summary: "Beta workflow started",
    });
    store.updateWorkflow({
      workflowId: betaWorkflow.id,
      status: "running",
      summary: "Beta workflow still running",
    });

    const alphaState = store.getSessionState("session-alpha");
    const betaState = store.getSessionState("session-beta");

    expect(alphaState.threads.map((thread) => thread.id)).toEqual([alphaThread.id]);
    expect(alphaState.workflows).toHaveLength(0);
    expect(alphaState.verifications).toHaveLength(1);
    expect(alphaState.commands.map((entry) => entry.id)).toEqual([alphaCommand.id]);
    expect(betaState.threads.map((thread) => thread.id)).toEqual([betaThread.id]);
    expect(betaState.workflows).toHaveLength(1);
    expect(betaState.verifications).toHaveLength(0);
    expect(betaState.commands.map((entry) => entry.id)).toEqual([betaCommand.id]);
  });
});
