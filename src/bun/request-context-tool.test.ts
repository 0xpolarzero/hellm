import { afterEach, describe, expect, it } from "bun:test";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import { createRequestContextTool } from "./request-context-tool";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

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
    sessionId: "session-request-context-tool",
    title: "Request Context Tool Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createHandlerRuntime(store: StructuredSessionStateStore): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: "session-request-context-tool",
    surfacePiSessionId: "session-request-context-tool",
    requestSummary: "Load CI context",
  });
  const thread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: "pi-thread-request-context",
    title: "Project CI thread",
    objective: "Load CI context for a handler thread.",
  });

  return {
    current: {
      sessionId: "session-request-context-tool",
      turnId: turn.id,
      surfacePiSessionId: thread.surfacePiSessionId,
      surfaceThreadId: thread.id,
      surfaceKind: "handler",
      defaultEpisodeKind: "change",
      rootThreadId: thread.id,
      promptText: "Load CI context",
      rootEpisodeKind: "change",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
    },
  };
}

describe("request_context tool", () => {
  it("requires an active handler-thread runtime", async () => {
    const store = createStore();

    await expect(
      createRequestContextTool({
        runtime: { current: null },
        store,
      }).execute("tool-call-1", { keys: ["ci"] }),
    ).rejects.toThrow("request_context can only run during an active prompt.");

    const runtime = createHandlerRuntime(store);
    runtime.current!.surfaceKind = "orchestrator";
    runtime.current!.surfaceThreadId = null;

    await expect(
      createRequestContextTool({
        runtime,
        store,
      }).execute("tool-call-2", { keys: ["ci"] }),
    ).rejects.toThrow("request_context can only run from a handler thread surface.");
  });

  it("loads typed context packs idempotently on the current handler thread", async () => {
    const store = createStore();
    const runtime = createHandlerRuntime(store);
    const tool = createRequestContextTool({
      runtime,
      store,
    });

    const first = await tool.execute("tool-call-3", { keys: ["ci"] });
    const second = await tool.execute("tool-call-4", { keys: ["ci"] });

    expect(first.details).toEqual({
      ok: true,
      loadedContextKeys: ["ci"],
    });
    expect(second.details).toEqual({
      ok: true,
      loadedContextKeys: ["ci"],
    });

    const snapshot = store.getSessionState("session-request-context-tool");
    expect(snapshot.turns[0]).toMatchObject({
      turnDecision: "request_context",
    });
    expect(snapshot.threadContexts).toEqual([
      expect.objectContaining({
        threadId: runtime.current!.surfaceThreadId,
        contextKey: "ci",
      }),
    ]);
    expect(snapshot.threads[0]).toMatchObject({
      loadedContextKeys: ["ci"],
    });
    expect(snapshot.commands.filter((command) => command.toolName === "request_context")).toEqual([
      expect.objectContaining({
        status: "succeeded",
        visibility: "surface",
        facts: expect.objectContaining({
          contextKeys: ["ci"],
        }),
      }),
      expect.objectContaining({
        status: "succeeded",
      }),
    ]);
  });
});
