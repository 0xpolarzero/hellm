import { afterEach, describe, expect, it } from "bun:test";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import { createWaitTool } from "./wait-tool";

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
    sessionId: "session-wait-tool",
    title: "Wait Tool Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-15T09:00:00.000Z",
    updatedAt: "2026-04-15T09:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createRuntime(store: StructuredSessionStateStore): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: "session-wait-tool",
    surfacePiSessionId: "session-wait-tool",
    requestSummary: "Wait for user input",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    title: "Clarify rollout",
    objective: "Pause until the user clarifies the rollout strategy.",
  });

  return {
    current: {
      sessionId: "session-wait-tool",
      turnId: turn.id,
      surfacePiSessionId: "session-wait-tool",
      surfaceThreadId: rootThread.id,
      surfaceKind: "orchestrator",
      defaultEpisodeKind: "clarification",
      rootThreadId: rootThread.id,
      promptText: "Wait for user input",
      rootEpisodeKind: "clarification",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
    },
  };
}

describe("wait tool", () => {
  it("requires an active prompt runtime", async () => {
    const tool = createWaitTool({
      runtime: { current: null },
      store: createStore(),
    });

    await expect(
      tool.execute("tool-call-1", {
        reason: "Need clarification",
        resumeWhen: "Resume when clarified",
      }),
    ).rejects.toThrow("wait can only run during an active prompt.");
  });

  it("records command, thread wait, and session wait state", async () => {
    const store = createStore();
    const runtime = createRuntime(store);
    const tool = createWaitTool({
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-2", {
      kind: "user",
      reason: "Need clarification about rollout.",
      resumeWhen: "Resume when the user answers the rollout question.",
    });

    expect(result.details).toMatchObject({
      ok: true,
      sessionWaitApplied: true,
      kind: "user",
    });
    expect(runtime.current?.sessionWaitApplied).toBe(true);

    const snapshot = store.getSessionState("session-wait-tool");
    expect(snapshot.turns[0]?.turnDecision).toBe("clarify");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "wait",
        executor: "runtime",
        visibility: "surface",
        status: "waiting",
      }),
    ]);
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]).toMatchObject({
      status: "waiting",
      wait: {
        kind: "user",
        reason: "Need clarification about rollout.",
        resumeWhen: "Resume when the user answers the rollout question.",
      },
    });
    expect(snapshot.session.wait).toMatchObject({
      owner: { kind: "thread", threadId: snapshot.threads[0]!.id },
      kind: "user",
      reason: "Need clarification about rollout.",
      resumeWhen: "Resume when the user answers the rollout question.",
    });
  });
});
