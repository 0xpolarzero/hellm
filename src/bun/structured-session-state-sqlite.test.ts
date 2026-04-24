import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function createDeterministicClock(start = "2026-04-18T12:00:00.000Z") {
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
    createdAt: "2026-04-18T11:55:00.000Z",
    updatedAt: "2026-04-18T11:55:00.000Z",
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

  function createSqliteStore(options: { databasePath?: string; nowStart?: string } = {}) {
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
      now: createDeterministicClock(options.nowStart ?? "2026-04-18T12:00:00.000Z"),
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

  it("persists handler-thread state with many workflow runs and one terminal episode across restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-persist",
      title: "Persist me",
      messageCount: 6,
    });

    const orchestratorTurn = first.store.startTurn({
      sessionId: "session-persist",
      surfacePiSessionId: "session-persist",
      requestSummary: "Delegate the design task",
    });
    const handlerThread = first.store.createThread({
      turnId: orchestratorTurn.id,
      surfacePiSessionId: "pi-thread-persist",
      title: "Persisted handler thread",
      objective: "Own the delegated task and supervise workflow runs.",
    });
    const context = first.store.loadThreadContext({
      threadId: handlerThread.id,
      contextKey: "ci",
      contextVersion: "2026-04-24",
    });
    first.store.finishTurn({
      turnId: orchestratorTurn.id,
      status: "completed",
    });

    const handlerTurn = first.store.startTurn({
      sessionId: "session-persist",
      surfacePiSessionId: handlerThread.surfacePiSessionId,
      threadId: handlerThread.id,
      requestSummary: "Run the workflow twice and emit the final episode",
    });
    const firstCommand = first.store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      toolName: "workflow.start",
      executor: "smithers",
      visibility: "surface",
      title: "Start workflow",
      summary: "Start the first workflow run.",
    });
    const runOne = first.store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: firstCommand.id,
      smithersRunId: "smithers-run-alpha",
      workflowName: "persist-alpha",
      workflowSource: "artifact",
      entryPath: ".svvy/artifacts/workflows/persist-alpha/entries/workflow.tsx",
      savedEntryId: null,
      status: "waiting",
      summary: "The first workflow run is waiting on clarification.",
    });
    const secondCommand = first.store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      toolName: "workflow.resume",
      executor: "smithers",
      visibility: "surface",
      title: "Resume workflow",
      summary: "Resume with a repaired workflow run.",
    });
    const runTwo = first.store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: secondCommand.id,
      smithersRunId: "smithers-run-beta",
      workflowName: "persist-beta",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/persist-beta.tsx",
      savedEntryId: "persist_beta",
      status: "completed",
      summary: "The repaired workflow run completed.",
    });
    const projectCi = first.store.recordProjectCiResult({
      workflowRunId: runTwo.id,
      workflowId: "persist_project_ci",
      entryPath: ".svvy/workflows/entries/persist-project-ci.tsx",
      status: "passed",
      summary: "Project CI passed on the second run.",
      checks: [
        {
          checkId: "unit_tests",
          label: "Unit tests",
          kind: "test",
          status: "passed",
          required: true,
          command: ["bun", "test"],
          exitCode: 0,
          summary: "Unit tests passed.",
        },
      ],
    });
    const artifact = first.store.createArtifact({
      workflowRunId: runTwo.id,
      sourceCommandId: secondCommand.id,
      kind: "text",
      name: "notes.md",
      content: "# Durable notes\n",
    });
    first.store.updateThread({
      threadId: handlerThread.id,
      status: "completed",
    });
    const episode = first.store.createEpisode({
      threadId: handlerThread.id,
      sourceCommandId: secondCommand.id,
      kind: "workflow",
      title: "Final episode",
      summary: "The handler thread completed.",
      body: "The handler thread completed after two workflow runs.",
    });
    first.store.finishTurn({
      turnId: handlerTurn.id,
      status: "completed",
    });

    const beforeReload = first.store.getSessionState("session-persist");
    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-18T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-persist");
    const detail = second.store.getThreadDetail(handlerThread.id);

    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.session.orchestratorPiSessionId).toBe("session-persist");
    expect(afterReload.workflowRuns.map((workflowRun) => workflowRun.id)).toEqual([
      runOne.id,
      runTwo.id,
    ]);
    expect(afterReload.threadContexts).toEqual([
      expect.objectContaining({
        id: context.id,
        threadId: handlerThread.id,
        contextKey: "ci",
      }),
    ]);
    expect(afterReload.ciRuns).toEqual([
      expect.objectContaining({
        id: projectCi.ciRun.id,
        workflowRunId: runTwo.id,
        workflowId: "persist_project_ci",
        status: "passed",
      }),
    ]);
    expect(afterReload.ciCheckResults).toEqual([
      expect.objectContaining({
        id: projectCi.checkResults[0]?.id,
        ciRunId: projectCi.ciRun.id,
        workflowRunId: runTwo.id,
        checkId: "unit_tests",
        status: "passed",
      }),
    ]);
    expect(afterReload.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        threadId: handlerThread.id,
        workflowRunId: runTwo.id,
        sourceCommandId: secondCommand.id,
      }),
    ]);
    expect(afterReload.episodes).toEqual([
      expect.objectContaining({
        id: episode.id,
        threadId: handlerThread.id,
      }),
    ]);
    expect(detail.workflowRuns.map((workflowRun) => workflowRun.id)).toEqual([
      runOne.id,
      runTwo.id,
    ]);
    expect(detail.latestWorkflowRun?.id).toBe(runTwo.id);
    expect(detail.thread.loadedContextKeys).toEqual(["ci"]);
  });

  it("writes artifacts into the workspace-scoped artifact directory with persisted ownership metadata", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-artifact-files",
      title: "Artifact Files",
    });

    const turn = store.startTurn({
      sessionId: "session-artifact-files",
      surfacePiSessionId: "session-artifact-files",
      requestSummary: "Persist file-backed artifacts",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-artifact-files",
      title: "Persist file-backed artifacts",
      objective: "Keep artifact payloads on disk instead of only in SQLite.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-artifact-files",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Persist a file-backed artifact from the handler surface",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Persist snippet",
      summary: "Persist a snippet artifact before execution.",
    });
    const artifact = store.createArtifact({
      threadId: thread.id,
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
        threadId: thread.id,
        sourceCommandId: command.id,
        path: artifact.path,
      }),
    ]);
    expect(existsSync(artifact.path!)).toBe(true);
    expect(readFileSync(artifact.path!, "utf8")).toBe('console.log("hello from artifact");\n');
  });

  it("persists thread-owned session wait and clears it when the thread resumes", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-waiting-persist",
      title: "Waiting Persist",
    });

    const turn = first.store.startTurn({
      sessionId: "session-waiting-persist",
      surfacePiSessionId: "session-waiting-persist",
      requestSummary: "Persist session wait",
    });
    const thread = first.store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-waiting",
      title: "Waiting handler thread",
      objective: "Persist session wait details.",
    });
    const wait = {
      owner: "workflow" as const,
      kind: "external" as const,
      reason: "Waiting on a Smithers milestone completion.",
      resumeWhen: "Resume when the milestone gate passes.",
      since: "2026-04-18T12:00:02.000Z",
    };
    first.store.updateThread({
      threadId: thread.id,
      status: "waiting",
      wait,
    });
    const waitingOn = first.store.setSessionWait({
      sessionId: "session-waiting-persist",
      owner: { kind: "thread", threadId: thread.id },
      kind: wait.kind,
      reason: wait.reason,
      resumeWhen: wait.resumeWhen,
    });

    const beforeReload = first.store.getSessionState("session-waiting-persist");
    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-18T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-waiting-persist");
    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.session.wait).toEqual(waitingOn);
    expect(afterReload.threads[0]?.wait).toEqual(wait);

    second.store.updateThread({
      threadId: thread.id,
      status: "running-handler",
    });

    const resumed = second.store.getSessionState("session-waiting-persist");
    expect(resumed.session.wait).toBeNull();
    expect(resumed.threads[0]?.wait).toBeNull();
  });

  it("lists session states with workflow-run-centric counts and summary facts", () => {
    const { store } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-alpha",
      title: "Alpha Session",
    });
    seedSession(store, {
      sessionId: "session-beta",
      title: "Beta Session",
    });

    const alphaTurn = store.startTurn({
      sessionId: "session-alpha",
      surfacePiSessionId: "session-alpha",
      requestSummary: "Alpha work",
    });
    const alphaThread = store.createThread({
      turnId: alphaTurn.id,
      surfacePiSessionId: "pi-thread-alpha",
      title: "Alpha handler",
      objective: "Handle alpha.",
    });
    const alphaHandlerTurn = store.startTurn({
      sessionId: "session-alpha",
      surfacePiSessionId: alphaThread.surfacePiSessionId,
      threadId: alphaThread.id,
      requestSummary: "Handle alpha on the thread surface",
    });
    const alphaCommand = store.createCommand({
      turnId: alphaHandlerTurn.id,
      threadId: alphaThread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Alpha command",
      summary: "Alpha summary.",
    });
    store.updateThread({
      threadId: alphaThread.id,
      status: "completed",
    });
    store.createEpisode({
      threadId: alphaThread.id,
      sourceCommandId: alphaCommand.id,
      title: "Alpha episode",
      summary: "Alpha done.",
      body: "Alpha done.",
    });

    const betaTurn = store.startTurn({
      sessionId: "session-beta",
      surfacePiSessionId: "session-beta",
      requestSummary: "Beta work",
    });
    const betaThread = store.createThread({
      turnId: betaTurn.id,
      surfacePiSessionId: "pi-thread-beta",
      title: "Beta handler",
      objective: "Handle beta.",
    });
    const betaHandlerTurn = store.startTurn({
      sessionId: "session-beta",
      surfacePiSessionId: betaThread.surfacePiSessionId,
      threadId: betaThread.id,
      requestSummary: "Handle beta on the thread surface",
    });
    const betaCommand = store.createCommand({
      turnId: betaHandlerTurn.id,
      threadId: betaThread.id,
      toolName: "workflow.start",
      executor: "smithers",
      visibility: "surface",
      title: "Start beta workflow",
      summary: "Start beta workflow.",
    });
    store.recordWorkflow({
      threadId: betaThread.id,
      commandId: betaCommand.id,
      smithersRunId: "smithers-run-beta-list",
      workflowName: "beta-workflow",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/beta-workflow.tsx",
      savedEntryId: "beta_workflow",
      status: "running",
      summary: "Beta workflow is running.",
    });

    const states = store.listSessionStates();
    const alpha = states.find((state) => state.session.id === "session-alpha")!;
    const beta = states.find((state) => state.session.id === "session-beta")!;

    expect(alpha.workflowRuns).toHaveLength(0);
    expect(alpha.episodes).toHaveLength(1);
    expect(beta.workflowRuns).toHaveLength(1);
    expect(beta.threads[0]?.status).toBe("running-handler");
  });
});
