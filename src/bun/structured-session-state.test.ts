import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

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

  it("writes turns, commands, episodes, artifacts, and lifecycle events", () => {
    const store = createStore();
    seedSession(store, "session-model");

    const turn = store.startTurn({
      sessionId: "session-model",
      requestSummary: "Refactor the structured command model",
    });
    const rootThread = store.createThread({
      turnId: turn.id,
      kind: "task",
      title: "Refactor structured state",
      objective: "Rebuild the store around turns, commands, and episodes.",
    });
    const childThread = store.createThread({
      turnId: turn.id,
      parentThreadId: rootThread.id,
      kind: "workflow",
      title: "Delegate workflow",
      objective: "Run the delegated workflow separately from direct work.",
    });
    const command = store.createCommand({
      turnId: turn.id,
      threadId: rootThread.id,
      toolName: "execute_typescript",
      executor: "execute_typescript",
      visibility: "trace",
      title: "Inspect store",
      summary: "Read the structured session state store.",
    });

    store.startCommand(command.id);
    store.bumpCommandAttempt(command.id);
    const finishedCommand = store.finishCommand({
      commandId: command.id,
      status: "succeeded",
      summary: "Store inspection complete.",
      facts: {
        repoReads: 2,
        artifactIds: ["artifact-123"],
      },
    });
    const episode = store.createEpisode({
      threadId: rootThread.id,
      sourceCommandId: command.id,
      kind: "analysis",
      title: "Command results",
      summary: "Refactor notes",
      body: "The store now records command, episode, and artifact rows.",
    });
    const artifact = store.createArtifact({
      episodeId: episode.id,
      sourceCommandId: command.id,
      kind: "text",
      name: "notes.md",
      content: "# Notes\nThe new model is command centered.\n",
    });
    const commandArtifact = store.createArtifact({
      sourceCommandId: command.id,
      kind: "json",
      name: "inspect-store.json",
      content: '{"ok":true}',
    });
    const completedThread = store.updateThread({
      threadId: rootThread.id,
      status: "completed",
    });
    const completedTurn = store.finishTurn({
      turnId: turn.id,
      status: "completed",
    });

    const snapshot = store.getSessionState("session-model");
    const detail = store.getThreadDetail(rootThread.id);

    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.turns).toEqual([
      expect.objectContaining({
        id: turn.id,
        sessionId: "session-model",
        requestSummary: "Refactor the structured command model",
        status: "completed",
      }),
    ]);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual([rootThread.id, childThread.id]);
    expect(snapshot.commands).toContainEqual(
      expect.objectContaining({
        id: command.id,
        threadId: rootThread.id,
        toolName: "execute_typescript",
        executor: "execute_typescript",
        visibility: "trace",
        status: "succeeded",
        attempts: 2,
        facts: {
          repoReads: 2,
          artifactIds: ["artifact-123"],
        },
      }),
    );
    expect(snapshot.episodes).toEqual([
      expect.objectContaining({
        id: episode.id,
        threadId: rootThread.id,
        sourceCommandId: command.id,
        kind: "analysis",
        artifactIds: [artifact.id],
      }),
    ]);
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        episodeId: episode.id,
        sourceCommandId: command.id,
        kind: "text",
        name: "notes.md",
      }),
      expect.objectContaining({
        id: commandArtifact.id,
        episodeId: null,
        sourceCommandId: command.id,
        kind: "json",
        name: "inspect-store.json",
      }),
    ]);
    expect(snapshot.events.map((event) => event.kind)).toEqual([
      "turn.started",
      "thread.created",
      "thread.created",
      "command.requested",
      "command.started",
      "command.retry",
      "command.finished",
      "episode.created",
      "artifact.created",
      "artifact.created",
      "thread.finished",
      "turn.completed",
    ]);
    expect(detail.childThreads.map((thread) => thread.id)).toEqual([childThread.id]);
    expect(detail.commands.map((entry) => entry.id)).toEqual([command.id]);
    expect(detail.episodes.map((entry) => entry.id)).toEqual([episode.id]);
    expect(detail.artifacts.map((entry) => entry.id)).toEqual([artifact.id, commandArtifact.id]);
    expect(detail.verifications).toHaveLength(0);
    expect(detail.workflow).toBeNull();
    expect(finishedCommand.status).toBe("succeeded");
    expect(finishedCommand.facts).toEqual({
      repoReads: 2,
      artifactIds: ["artifact-123"],
    });
    expect(completedThread.status).toBe("completed");
    expect(completedTurn.status).toBe("completed");
  });

  it("tracks thread waits and session waits independently", () => {
    const store = createStore();
    seedSession(store, "session-wait");

    const turn = store.startTurn({
      sessionId: "session-wait",
      requestSummary: "Wait on the user",
    });
    const thread = store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Pause for input",
      objective: "Pause the session until the user answers.",
    });

    const threadWait = {
      kind: "user" as const,
      reason: "Need clarification",
      resumeWhen: "Resume when the user answers the rollout question.",
      since: "2026-04-14T09:00:02.000Z",
    };
    const waitingThread = store.updateThread({
      threadId: thread.id,
      status: "waiting",
      wait: threadWait,
    });
    const sessionWait = store.setSessionWait({
      sessionId: "session-wait",
      threadId: thread.id,
      ...threadWait,
    });

    expect(waitingThread.wait).toEqual(threadWait);
    expect(sessionWait).toMatchObject({
      threadId: thread.id,
      kind: threadWait.kind,
      reason: threadWait.reason,
      resumeWhen: threadWait.resumeWhen,
    });
    expect(typeof sessionWait.since).toBe("string");

    const snapshot = store.getSessionState("session-wait");
    expect(snapshot.session.wait).toEqual(sessionWait);
    expect(snapshot.threads[0]?.wait).toEqual(threadWait);
    expect(snapshot.session.id).toBe("session-wait");

    const resumedThread = store.updateThread({
      threadId: thread.id,
      status: "completed",
    });
    const resumedSnapshot = store.getSessionState("session-wait");

    expect(resumedThread.wait).toBeNull();
    expect(resumedSnapshot.session.wait).toBeNull();
    expect(resumedSnapshot.threads[0]?.wait).toBeNull();
  });

  it("clears session wait when a new runnable thread is created", () => {
    const store = createStore();
    seedSession(store, "session-wait-cleared-on-create");

    const turn = store.startTurn({
      sessionId: "session-wait-cleared-on-create",
      requestSummary: "Wait and then resume with new runnable work",
    });
    const waitingThread = store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Need user input",
      objective: "Block until the user provides missing rollout details.",
    });
    const wait = {
      kind: "user" as const,
      reason: "Need rollout scope confirmation",
      resumeWhen: "Resume when the user confirms rollout scope.",
      since: "2026-04-14T09:00:02.000Z",
    };
    store.updateThread({
      threadId: waitingThread.id,
      status: "waiting",
      wait,
    });
    store.setSessionWait({
      sessionId: "session-wait-cleared-on-create",
      threadId: waitingThread.id,
      ...wait,
    });

    const runnableThread = store.createThread({
      turnId: turn.id,
      kind: "task",
      title: "Continue parallel implementation",
      objective: "Resume progress on runnable thread work.",
    });
    const snapshot = store.getSessionState("session-wait-cleared-on-create");

    expect(runnableThread.status).toBe("running");
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.threads.find((thread) => thread.id === waitingThread.id)?.wait).toEqual(wait);
  });

  it("clears session wait when another thread becomes runnable", () => {
    const store = createStore();
    seedSession(store, "session-wait-cleared-on-update");

    const turn = store.startTurn({
      sessionId: "session-wait-cleared-on-update",
      requestSummary: "Resume work from dependency wait",
    });
    const blockingThread = store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Waiting on user",
      objective: "Pause for user action.",
    });
    const dependencyThread = store.createThread({
      turnId: turn.id,
      kind: "task",
      title: "Dependency thread",
      objective: "Will transition back to runnable.",
    });

    store.updateThread({
      threadId: dependencyThread.id,
      status: "waiting",
      dependsOnThreadIds: [blockingThread.id],
    });

    const wait = {
      kind: "external" as const,
      reason: "Waiting on external approval",
      resumeWhen: "Resume when external approval arrives.",
      since: "2026-04-14T09:00:04.000Z",
    };
    store.updateThread({
      threadId: blockingThread.id,
      status: "waiting",
      wait,
    });
    store.setSessionWait({
      sessionId: "session-wait-cleared-on-update",
      threadId: blockingThread.id,
      ...wait,
    });

    const resumedDependency = store.updateThread({
      threadId: dependencyThread.id,
      status: "running",
    });
    const snapshot = store.getSessionState("session-wait-cleared-on-update");

    expect(resumedDependency.status).toBe("running");
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.threads.find((thread) => thread.id === blockingThread.id)?.wait).toEqual(wait);
  });

  it("records verifications and workflows against command/thread ownership", () => {
    const store = createStore();
    seedSession(store, "session-routed");

    const turn = store.startTurn({
      sessionId: "session-routed",
      requestSummary: "Route verification and workflow records",
    });
    const verificationThread = store.createThread({
      turnId: turn.id,
      kind: "verification",
      title: "Run tests",
      objective: "Capture verification results as structured records.",
    });
    const verificationCommand = store.createCommand({
      turnId: turn.id,
      threadId: verificationThread.id,
      toolName: "verification.run",
      executor: "verification",
      visibility: "surface",
      title: "Run tests",
      summary: "Run the verification command against the workspace.",
    });
    const verification = store.recordVerification({
      threadId: verificationThread.id,
      commandId: verificationCommand.id,
      kind: "test",
      status: "passed",
      summary: "Test suite passed.",
      command: "bun run test",
    });
    const workflowThread = store.createThread({
      turnId: turn.id,
      kind: "workflow",
      title: "Delegate workflow",
      objective: "Capture Smithers workflow progress.",
    });
    const workflowCommand = store.createCommand({
      turnId: turn.id,
      threadId: workflowThread.id,
      toolName: "workflow.start",
      executor: "smithers",
      visibility: "surface",
      title: "Start workflow",
      summary: "Start the delegated workflow.",
    });
    const workflow = store.recordWorkflow({
      threadId: workflowThread.id,
      commandId: workflowCommand.id,
      smithersRunId: "smithers-run-4021",
      workflowName: "implement-feature",
      status: "waiting",
      summary: "Waiting for the delegated workflow to advance.",
    });
    const updatedWorkflow = store.updateWorkflow({
      workflowId: workflow.id,
      status: "completed",
      summary: "Workflow completed.",
    });

    expect(verification.threadId).toBe(verificationThread.id);
    expect(verification.commandId).toBe(verificationCommand.id);
    expect(workflow.threadId).toBe(workflowThread.id);
    expect(workflow.commandId).toBe(workflowCommand.id);
    expect(updatedWorkflow.status).toBe("completed");
    expect(updatedWorkflow.finishedAt).toBeTruthy();

    expect(() =>
      store.recordVerification({
        threadId: workflowThread.id,
        commandId: workflowCommand.id,
        kind: "test",
        status: "failed",
        summary: "This should fail.",
      }),
    ).toThrow(/verification threads/i);

    expect(() =>
      store.recordWorkflow({
        threadId: verificationThread.id,
        commandId: verificationCommand.id,
        smithersRunId: "smithers-run-invalid",
        workflowName: "invalid-workflow",
        status: "running",
        summary: "This should fail.",
      }),
    ).toThrow(/workflow threads/i);

    const verificationDetail = store.getThreadDetail(verificationThread.id);
    const workflowDetail = store.getThreadDetail(workflowThread.id);

    expect(verificationDetail.verifications.map((entry) => entry.id)).toEqual([verification.id]);
    expect(workflowDetail.workflow?.id).toBe(workflow.id);
  });

  it("rejects artifacts without an episode or source command and scopes command artifacts to thread detail", () => {
    const store = createStore();
    seedSession(store, "session-command-artifacts");

    const turn = store.startTurn({
      sessionId: "session-command-artifacts",
      requestSummary: "Persist command artifacts",
    });
    const thread = store.createThread({
      turnId: turn.id,
      kind: "task",
      title: "Persist command artifacts",
      objective: "Keep command-scoped artifacts visible without transcript replay.",
    });
    const command = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "execute_typescript",
      visibility: "summary",
      title: "Persist command artifacts",
      summary: "Persist command-scoped artifacts.",
    });

    expect(() =>
      store.createArtifact({
        kind: "text",
        name: "invalid.txt",
        content: "missing links",
      }),
    ).toThrow(/episode, a source command, or both/i);

    const artifact = store.createArtifact({
      sourceCommandId: command.id,
      kind: "text",
      name: "command-only.txt",
      content: "command scoped",
    });

    const snapshot = store.getSessionState("session-command-artifacts");
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        episodeId: null,
        sourceCommandId: command.id,
      }),
    ]);
    expect(store.getThreadDetail(thread.id).artifacts.map((entry) => entry.id)).toEqual([
      artifact.id,
    ]);
  });
});
