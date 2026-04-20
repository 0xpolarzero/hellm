import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function createDeterministicClock(start = "2026-04-18T09:00:00.000Z") {
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
    createdAt: "2026-04-18T08:55:00.000Z",
    updatedAt: "2026-04-18T08:56:00.000Z",
  });
}

describe("structured session state write API", () => {
  const stores: StructuredSessionStateStore[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  function createStore() {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-structured-store-"));
    tempDirs.push(workspaceCwd);
    const store = createStructuredSessionStateStore({
      workspace: {
        id: workspaceCwd,
        label: "svvy",
        cwd: workspaceCwd,
      },
      now: createDeterministicClock(),
    });
    stores.push(store);
    return store;
  }

  it("persists explicit per-turn decisions", () => {
    const store = createStore();
    seedSession(store, "session-turn-decisions");

    const turn = store.startTurn({
      sessionId: "session-turn-decisions",
      surfacePiSessionId: "session-turn-decisions",
      requestSummary: "Route a turn through execute_typescript",
    });
    expect(store.getSessionState("session-turn-decisions").turns[0]?.turnDecision).toBe("pending");

    store.setTurnDecision({
      turnId: turn.id,
      decision: "execute_typescript",
      onlyIfPending: true,
    });
    store.finishTurn({
      turnId: turn.id,
      status: "completed",
    });

    expect(store.getSessionState("session-turn-decisions").turns).toEqual([
      expect.objectContaining({
        id: turn.id,
        turnDecision: "execute_typescript",
        status: "completed",
      }),
    ]);
  });

  it("writes surface-aware turns, handler threads, multiple workflow runs, and a single terminal episode", () => {
    const store = createStore();
    seedSession(store, "session-model");

    const orchestratorTurn = store.startTurn({
      sessionId: "session-model",
      surfacePiSessionId: "session-model",
      requestSummary: "Delegate workflow execution design",
    });
    const handlerThread = store.createThread({
      turnId: orchestratorTurn.id,
      surfacePiSessionId: "pi-thread-001",
      title: "Workflow Execution Design",
      objective: "Own the delegated design task and supervise workflow runs.",
    });
    store.finishTurn({
      turnId: orchestratorTurn.id,
      status: "completed",
    });

    const handlerTurn = store.startTurn({
      sessionId: "session-model",
      surfacePiSessionId: handlerThread.surfacePiSessionId,
      threadId: handlerThread.id,
      requestSummary: "Reuse or author the workflow for the delegated task",
    });

    const startWorkflow = store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      toolName: "workflow.start",
      executor: "smithers",
      visibility: "surface",
      title: "Start workflow",
      summary: "Start the first workflow run.",
    });
    store.startCommand(startWorkflow.id);
    store.finishCommand({
      commandId: startWorkflow.id,
      status: "succeeded",
      summary: "The first workflow run was launched.",
    });

    const runOne = store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: startWorkflow.id,
      smithersRunId: "smithers-run-001",
      workflowName: "design-workflow",
      templateId: "single_task",
      status: "waiting",
      summary: "Paused for clarification about workflow resume ownership.",
    });

    const verification = store.recordVerification({
      workflowRunId: runOne.id,
      commandId: startWorkflow.id,
      kind: "test",
      status: "failed",
      summary: "The first validation pass failed.",
      command: "bun test",
    });

    const workflowArtifact = store.createArtifact({
      workflowRunId: runOne.id,
      sourceCommandId: startWorkflow.id,
      kind: "json",
      name: "run-one.json",
      content: '{"status":"waiting"}',
    });

    store.updateThread({
      threadId: handlerThread.id,
      status: "running-handler",
    });

    const resumeWorkflow = store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      toolName: "workflow.resume",
      executor: "smithers",
      visibility: "surface",
      title: "Resume workflow",
      summary: "Resume the workflow after clarification.",
    });
    const runTwo = store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: resumeWorkflow.id,
      smithersRunId: "smithers-run-002",
      workflowName: "design-workflow-v2",
      templateId: "single_task",
      presetId: "design-review",
      status: "completed",
      summary: "Completed after clarification and repair.",
    });

    const reviewCommand = store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      workflowRunId: runTwo.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Inspect workflow outputs",
      summary: "Inspect the final workflow artifacts before emitting the episode.",
      facts: {
        outputCount: 2,
      },
    });
    store.finishCommand({
      commandId: reviewCommand.id,
      status: "succeeded",
      summary: "Inspection completed.",
    });

    store.updateThread({
      threadId: handlerThread.id,
      status: "completed",
    });
    const episode = store.createEpisode({
      threadId: handlerThread.id,
      sourceCommandId: reviewCommand.id,
      kind: "workflow",
      title: "Handler episode",
      summary: "Delegated objective completed.",
      body: "The handler thread finished after supervising two workflow runs.",
    });
    store.finishTurn({
      turnId: handlerTurn.id,
      status: "completed",
    });

    const snapshot = store.getSessionState("session-model");
    const detail = store.getThreadDetail(handlerThread.id);

    expect(snapshot.session).toEqual({
      id: "session-model",
      orchestratorPiSessionId: "session-model",
      wait: null,
    });
    expect(snapshot.turns).toEqual([
      expect.objectContaining({
        id: orchestratorTurn.id,
        surfacePiSessionId: "session-model",
        threadId: null,
        status: "completed",
      }),
      expect.objectContaining({
        id: handlerTurn.id,
        surfacePiSessionId: "pi-thread-001",
        threadId: handlerThread.id,
        status: "completed",
      }),
    ]);
    expect(snapshot.threads).toEqual([
      expect.objectContaining({
        id: handlerThread.id,
        surfacePiSessionId: "pi-thread-001",
        status: "completed",
      }),
    ]);
    expect("kind" in snapshot.threads[0]!).toBe(false);
    expect("dependsOnThreadIds" in snapshot.threads[0]!).toBe(false);

    expect(snapshot.commands).toContainEqual(
      expect.objectContaining({
        id: reviewCommand.id,
        surfacePiSessionId: "pi-thread-001",
        threadId: handlerThread.id,
        workflowRunId: runTwo.id,
        executor: "handler",
        facts: {
          outputCount: 2,
        },
      }),
    );
    expect((snapshot.workflowRuns ?? []).map((workflowRun) => workflowRun.id)).toEqual([
      runOne.id,
      runTwo.id,
    ]);
    expect(snapshot.verifications).toEqual([
      expect.objectContaining({
        id: verification.id,
        threadId: handlerThread.id,
        workflowRunId: runOne.id,
        commandId: startWorkflow.id,
      }),
    ]);
    expect(snapshot.episodes).toEqual([
      expect.objectContaining({
        id: episode.id,
        threadId: handlerThread.id,
        sourceCommandId: reviewCommand.id,
        summary: "Delegated objective completed.",
      }),
    ]);
    expect("artifactIds" in snapshot.episodes[0]!).toBe(false);
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        id: workflowArtifact.id,
        threadId: handlerThread.id,
        workflowRunId: runOne.id,
        sourceCommandId: startWorkflow.id,
      }),
    ]);
    expect("episodeId" in snapshot.artifacts[0]!).toBe(false);

    expect(detail.commands.map((entry) => entry.id)).toEqual([
      startWorkflow.id,
      resumeWorkflow.id,
      reviewCommand.id,
    ]);
    expect(detail.workflowRuns.map((entry) => entry.id)).toEqual([runOne.id, runTwo.id]);
    expect(detail.latestWorkflowRun?.id).toBe(runTwo.id);
    expect(detail.episodes.map((entry) => entry.id)).toEqual([episode.id]);
    expect(detail.artifacts.map((entry) => entry.id)).toEqual([workflowArtifact.id]);
    expect(snapshot.events.map((event) => event.kind)).toEqual([
      "turn.started",
      "thread.created",
      "turn.completed",
      "turn.started",
      "command.requested",
      "command.started",
      "command.finished",
      "workflowRun.created",
      "verification.recorded",
      "artifact.created",
      "thread.updated",
      "command.requested",
      "workflowRun.created",
      "command.requested",
      "command.finished",
      "thread.finished",
      "episode.created",
      "turn.completed",
    ]);
  });

  it("enforces terminal episodes and preserves ordered handoff history per thread", () => {
    const store = createStore();
    seedSession(store, "session-episodes");

    const turn = store.startTurn({
      sessionId: "session-episodes",
      surfacePiSessionId: "session-episodes",
      requestSummary: "Complete a delegated thread",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-episodes",
      title: "Episode thread",
      objective: "Emit exactly one final episode.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-episodes",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Prepare the final handler episode",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Draft episode",
      summary: "Prepare the final episode.",
    });

    expect(() =>
      store.createEpisode({
        threadId: thread.id,
        sourceCommandId: command.id,
        title: "Too early",
        summary: "This should fail.",
        body: "The thread is still running.",
      }),
    ).toThrow(/terminal/i);

    store.updateThread({
      threadId: thread.id,
      status: "completed",
    });
    const episode = store.createEpisode({
      threadId: thread.id,
      sourceCommandId: command.id,
      title: "Final episode",
      summary: "The thread completed.",
      body: "The thread completed.",
    });
    const secondEpisode = store.createEpisode({
      threadId: thread.id,
      title: "Follow-up episode",
      summary: "The thread returned control again.",
      body: "A later handoff should preserve the earlier handoff history.",
    });
    expect(episode.threadId).toBe(thread.id);
    expect(store.getThreadDetail(thread.id).episodes.map((entry) => entry.id)).toEqual([
      episode.id,
      secondEpisode.id,
    ]);
  });

  it("tracks thread-owned session wait and clears it when runnable work exists again", () => {
    const store = createStore();
    seedSession(store, "session-thread-wait");

    const turn = store.startTurn({
      sessionId: "session-thread-wait",
      surfacePiSessionId: "session-thread-wait",
      requestSummary: "Pause a handler thread",
    });
    const waitingThread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-wait",
      title: "Need clarification",
      objective: "Pause until the user answers.",
    });
    const wait = {
      owner: "handler" as const,
      kind: "user" as const,
      reason: "Need clarification on rollout scope",
      resumeWhen: "Resume when the user confirms the rollout scope.",
      since: "2026-04-18T09:00:03.000Z",
    };
    store.updateThread({
      threadId: waitingThread.id,
      status: "waiting",
      wait,
    });
    const sessionWait = store.setSessionWait({
      sessionId: "session-thread-wait",
      owner: { kind: "thread", threadId: waitingThread.id },
      kind: wait.kind,
      reason: wait.reason,
      resumeWhen: wait.resumeWhen,
    });

    expect(sessionWait).toEqual({
      owner: { kind: "thread", threadId: waitingThread.id },
      kind: wait.kind,
      reason: wait.reason,
      resumeWhen: wait.resumeWhen,
      since: expect.any(String),
    });

    const runnableThread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-runnable",
      title: "Parallel implementation",
      objective: "Continue independent runnable work.",
    });
    const snapshot = store.getSessionState("session-thread-wait");

    expect(runnableThread.status).toBe("running-handler");
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.threads.find((thread) => thread.id === waitingThread.id)?.wait).toEqual(wait);
  });

  it("supports orchestrator-owned session wait and clears it when a handler thread starts", () => {
    const store = createStore();
    seedSession(store, "session-orchestrator-wait");

    const turn = store.startTurn({
      sessionId: "session-orchestrator-wait",
      surfacePiSessionId: "session-orchestrator-wait",
      requestSummary: "Wait at the orchestrator level",
    });
    const waitingOn = store.setSessionWait({
      sessionId: "session-orchestrator-wait",
      owner: { kind: "orchestrator" },
      kind: "user",
      reason: "Need the user to choose the execution mode",
      resumeWhen: "Resume when the user chooses the execution mode.",
    });

    expect(waitingOn).toEqual({
      owner: { kind: "orchestrator" },
      kind: "user",
      reason: "Need the user to choose the execution mode",
      resumeWhen: "Resume when the user chooses the execution mode.",
      since: expect.any(String),
    });

    store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-handler",
      title: "Resume work",
      objective: "Resume with a runnable handler thread.",
    });

    expect(store.getSessionState("session-orchestrator-wait").session.wait).toBeNull();
  });

  it("records verification against the latest workflow run on a thread when workflowRunId is omitted", () => {
    const store = createStore();
    seedSession(store, "session-verification");

    const orchestratorTurn = store.startTurn({
      sessionId: "session-verification",
      surfacePiSessionId: "session-verification",
      requestSummary: "Start a handler thread",
    });
    const thread = store.createThread({
      turnId: orchestratorTurn.id,
      surfacePiSessionId: "pi-thread-verification",
      title: "Verification thread",
      objective: "Run verification against the latest workflow run.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-verification",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Run workflow and verification",
    });
    const workflowCommand = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "workflow.start",
      executor: "smithers",
      visibility: "surface",
      title: "Start workflow",
      summary: "Start the workflow run.",
    });
    const workflowRun = store.recordWorkflow({
      threadId: thread.id,
      commandId: workflowCommand.id,
      smithersRunId: "smithers-run-verification",
      workflowName: "verification-run",
      status: "running",
      summary: "Workflow is running verification.",
    });
    const verificationCommand = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Interpret workflow output",
      summary: "Interpret the workflow output and record verification.",
    });

    const verification = store.recordVerification({
      threadId: thread.id,
      commandId: verificationCommand.id,
      kind: "test",
      status: "passed",
      summary: "Verification passed.",
      command: "bun test",
    });

    expect(verification.threadId).toBe(thread.id);
    expect(verification.workflowRunId).toBe(workflowRun.id);
    expect(verification.commandId).toBe(verificationCommand.id);
  });

  it("keeps artifact ownership thread-based after an episode exists", () => {
    const store = createStore();
    seedSession(store, "session-artifacts");

    const turn = store.startTurn({
      sessionId: "session-artifacts",
      surfacePiSessionId: "session-artifacts",
      requestSummary: "Write artifacts after the thread completes",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-artifacts",
      title: "Artifact thread",
      objective: "Create artifacts after terminal episode creation.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-artifacts",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Write the terminal handler episode and artifact",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Draft artifact",
      summary: "Draft an artifact.",
    });
    store.updateThread({
      threadId: thread.id,
      status: "completed",
    });
    store.createEpisode({
      threadId: thread.id,
      sourceCommandId: command.id,
      title: "Final episode",
      summary: "Thread completed.",
      body: "Thread completed.",
    });
    const artifact = store.createArtifact({
      threadId: thread.id,
      sourceCommandId: command.id,
      kind: "text",
      name: "notes.md",
      content: "# Notes\nArtifact ownership now hangs off the thread.\n",
    });

    expect(artifact.threadId).toBe(thread.id);
    expect(artifact.workflowRunId).toBeNull();
    expect(artifact.sourceCommandId).toBe(command.id);
    expect(store.getThreadDetail(thread.id).artifacts.map((entry) => entry.id)).toEqual([
      artifact.id,
    ]);
  });
});
