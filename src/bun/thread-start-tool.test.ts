import { afterEach, describe, expect, it } from "bun:test";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import { createStartThreadTool } from "./thread-start-tool";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import type { HandlerContextKey } from "./handler-context-packs";

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
    sessionId: "session-thread-start-tool",
    title: "Thread Start Tool Session",
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

function createOrchestratorRuntime(
  store: StructuredSessionStateStore,
): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: "session-thread-start-tool",
    surfacePiSessionId: "session-thread-start-tool",
    requestSummary: "Delegate Project CI context work",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: "session-thread-start-tool",
    title: "Delegate Project CI context work",
    objective: "Open a handler thread.",
  });

  return {
    current: {
      sessionId: "session-thread-start-tool",
      turnId: turn.id,
      surfacePiSessionId: "session-thread-start-tool",
      surfaceThreadId: rootThread.id,
      surfaceKind: "orchestrator",
      defaultEpisodeKind: "analysis",
      rootThreadId: rootThread.id,
      promptText: "Delegate Project CI context work",
      rootEpisodeKind: "analysis",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
    },
  };
}

describe("thread.start tool", () => {
  it("passes typed context packs through to handler-thread creation", async () => {
    const store = createStore();
    const runtime = createOrchestratorRuntime(store);
    let observedContextKeys: HandlerContextKey[] | null = null;
    let observedLoadedByCommandId: string | null = null;

    const tool = createStartThreadTool({
      runtime,
      store,
      bridge: {
        async createHandlerThread(input) {
          observedContextKeys = input.contextKeys;
          observedLoadedByCommandId = input.loadedByCommandId;
          const thread = store.createThread({
            turnId: input.turnId,
            parentThreadId: input.parentThreadId,
            surfacePiSessionId: "pi-thread-project-ci",
            title: input.objective,
            objective: input.objective,
          });
          for (const key of input.contextKeys) {
            store.loadThreadContext({
              threadId: thread.id,
              contextKey: key,
              contextVersion: "2026-04-24",
              loadedByCommandId: input.loadedByCommandId,
            });
          }
          return store.getThreadDetail(thread.id).thread;
        },
      },
    });

    const result = await tool.execute("tool-call-thread-start", {
      objective: "Create or update the Project CI saved workflow when requested.",
      context: ["ci"],
    });

    const snapshot = store.getSessionState("session-thread-start-tool");
    const command = snapshot.commands.find((entry) => entry.toolName === "thread.start");

    expect(observedContextKeys as unknown).toEqual(["ci"]);
    expect(observedLoadedByCommandId as unknown).toBe(command?.id);
    expect(result.details).toMatchObject({
      ok: true,
      loadedContextKeys: ["ci"],
    });
    expect(command).toMatchObject({
      status: "succeeded",
      facts: expect.objectContaining({
        contextKeys: ["ci"],
      }),
    });
    expect(snapshot.threadContexts).toEqual([
      expect.objectContaining({
        contextKey: "ci",
        loadedByCommandId: command?.id,
      }),
    ]);
  });
});
