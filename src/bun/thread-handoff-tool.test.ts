import { afterEach, describe, expect, it } from "bun:test";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import { createThreadHandoffTool } from "./thread-handoff-tool";

const WORKSPACE = {
  id: "/repo/svvy",
  label: "svvy",
  cwd: "/repo/svvy",
} as const;

const stores: StructuredSessionStateStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
});

function createStore() {
  const store = createStructuredSessionStateStore({
    workspace: WORKSPACE,
  });
  store.upsertPiSession({
    sessionId: "session-thread-handoff-tool",
    title: "Thread Handoff Tool Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-19T09:00:00.000Z",
    updatedAt: "2026-04-19T09:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createHandlerRuntime(store: StructuredSessionStateStore): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: "session-thread-handoff-tool",
    requestSummary: "Hand control back from the thread",
  });
  const orchestratorThread = store.createThread({
    turnId: turn.id,
    title: "Delegate work",
    objective: "Delegate the objective into a handler thread.",
  });
  const handlerThread = store.createThread({
    turnId: turn.id,
    parentThreadId: orchestratorThread.id,
    surfacePiSessionId: "pi-thread-handoff-001",
    title: "Parser fix thread",
    objective: "Patch the parser bug and hand the result back.",
  });
  store.updateThread({
    threadId: orchestratorThread.id,
    status: "completed",
  });
  store.updateThread({
    threadId: handlerThread.id,
    status: "waiting",
    wait: {
      kind: "user",
      reason: "Need confirmation before finishing.",
      resumeWhen: "Resume when the user confirms the final parser change.",
      since: "2026-04-19T09:01:00.000Z",
    },
  });
  store.setSessionWait({
    sessionId: "session-thread-handoff-tool",
    owner: { kind: "thread", threadId: handlerThread.id },
    kind: "user",
    reason: "Need confirmation before finishing.",
    resumeWhen: "Resume when the user confirms the final parser change.",
  });

  return {
    current: {
      sessionId: "session-thread-handoff-tool",
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-handoff-001",
      surfaceThreadId: handlerThread.id,
      surfaceKind: "handler",
      rootThreadId: handlerThread.id,
      promptText: "Hand control back from the thread",
      rootEpisodeKind: "change",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
    },
  };
}

describe("thread handoff tool", () => {
  it("requires an active prompt runtime", async () => {
    const tool = createThreadHandoffTool({
      runtime: { current: null },
      store: createStore(),
    });

    await expect(
      tool.execute("tool-call-1", {
        summary: "Finished the delegated work.",
        body: "Finished the delegated work and handed it back.",
      }),
    ).rejects.toThrow("thread.handoff can only run during an active prompt.");
  });

  it("records a handoff command, creates an episode, completes the thread, and clears thread wait", async () => {
    const store = createStore();
    const runtime = createHandlerRuntime(store);
    const tool = createThreadHandoffTool({
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-2", {
      title: "Parser fix handoff",
      summary: "Patched the parser bug and added coverage.",
      body: "Patched the parser bug, added regression coverage, and handed the delegated objective back to the orchestrator.",
      kind: "change",
    });

    expect(result.details).toMatchObject({
      ok: true,
      title: "Parser fix handoff",
      kind: "change",
      summary: "Patched the parser bug and added coverage.",
    });

    const snapshot = store.getSessionState("session-thread-handoff-tool");
    expect(snapshot.turns[0]).toMatchObject({
      turnDecision: "handoff",
    });
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "thread.handoff",
        executor: "handler",
        visibility: "surface",
        status: "succeeded",
        summary: "Patched the parser bug and added coverage.",
      }),
    ]);
    expect(snapshot.threads.find((thread) => thread.surfacePiSessionId === "pi-thread-handoff-001"))
      .toMatchObject({
        status: "completed",
        wait: null,
      });
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.episodes).toEqual([
      expect.objectContaining({
        title: "Parser fix handoff",
        summary: "Patched the parser bug and added coverage.",
        sourceCommandId: snapshot.commands[0]?.id,
      }),
    ]);
  });
});
