import { afterEach, describe, expect, it } from "bun:test";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { AppLoggerEvent } from "./app-logger";
import { createStartThreadTool } from "./thread-start-tool";
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
    requestSummary: "Delegate workflow context work",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: "session-thread-start-tool",
    title: "Delegate workflow context work",
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
      promptText: "Delegate workflow context work",
      rootEpisodeKind: "analysis",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
    },
  };
}

describe("thread_start tool", () => {
  it("describes the conservative forked-history policy in the tool schema", () => {
    const tool = createStartThreadTool({
      runtime: { current: null },
      store: createStore(),
      bridge: {
        async createHandlerThread() {
          throw new Error("not used");
        },
      },
    });
    const schema = tool.parameters as {
      properties?: {
        threads?: {
          description?: string;
          items?: {
            properties?: {
              objective?: { description?: string };
              history?: { description?: string };
            };
          };
        };
      };
    };

    const threadsDescription = schema.properties?.threads?.description;
    expect(threadsDescription).toContain("Required and normally one item");
    expect(threadsDescription).toContain(
      "Use multiple items only for separate user-visible handler conversations",
    );
    expect(threadsDescription).toContain(
      "do not use multiple items for ordinary internal parallelism",
    );

    const itemProperties = schema.properties?.threads?.items?.properties;
    expect(itemProperties?.objective?.description).toContain("Compact task packet");
    expect(itemProperties?.history?.description).toContain("Defaults to isolated");
    expect(itemProperties?.history?.description).toContain(
      "Use forked only when explicit conversational continuity is requested",
    );
    expect(itemProperties?.history?.description).toContain(
      "do not use forked for ordinary implementation",
    );
  });

  it("creates one durable thread group from required threads input", async () => {
    const store = createStore();
    const runtime = createOrchestratorRuntime(store);
    const observedHistoryModes: string[] = [];
    const observedExtensions: Array<Record<
      string,
      "default_loaded" | "available" | "unavailable"
    > | null> = [];
    let observedLoadedByCommandId: string | null = null;
    const appLogEvents: AppLoggerEvent[] = [];

    const tool = createStartThreadTool({
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
      bridge: {
        async createHandlerThread(input) {
          observedHistoryModes.push(input.historyMode);
          observedExtensions.push(input.extensions);
          observedLoadedByCommandId = input.loadedByCommandId;
          const thread = store.createThread({
            turnId: input.turnId,
            parentThreadId: input.parentThreadId,
            threadGroupId: input.threadGroupId,
            surfacePiSessionId: "pi-thread-workflow",
            title: input.objective,
            objective: input.objective,
            historyMode: input.historyMode,
          });
          return store.getThreadDetail(thread.id).thread;
        },
      },
    });

    const result = await tool.execute("tool-call-thread-start", {
      threads: [
        {
          objective: "Create or update the reusable workflow when requested.",
          history: "forked",
          extensions: {
            smithers: "available",
            workflows: "unavailable",
          },
        },
      ],
    });

    const snapshot = store.getSessionState("session-thread-start-tool");
    const command = snapshot.commands.find((entry) => entry.toolName === "thread_start");
    const createdThread = snapshot.threads.find(
      (thread) => thread.surfacePiSessionId === "pi-thread-workflow",
    );

    expect(observedHistoryModes).toEqual(["forked"]);
    expect(observedExtensions).toEqual([
      {
        smithers: "available",
        workflows: "unavailable",
      },
    ]);
    expect(observedLoadedByCommandId as unknown).toBe(command?.id);
    expect(result.details).toMatchObject({
      threadGroupId: createdThread?.threadGroupId,
      threads: [
        {
          threadId: createdThread?.id,
          surfacePiSessionId: "pi-thread-workflow",
          objective: "Create or update the reusable workflow when requested.",
          objectiveState: "active",
        },
      ],
    });
    expect(command).toMatchObject({
      status: "succeeded",
      arguments: {
        threads: [
          {
            objective: "Create or update the reusable workflow when requested.",
            historyMode: "forked",
            extensions: {
              smithers: "available",
              workflows: "unavailable",
            },
          },
        ],
      },
      facts: expect.objectContaining({
        threadGroupId: createdThread?.threadGroupId,
      }),
    });
    expect(snapshot.threadContexts).toEqual([]);
    expect(appLogEvents).toEqual([
      expect.objectContaining({
        level: "info",
        source: "thread",
        message: "Handler thread created.",
        details: expect.objectContaining({
          workspaceSessionId: "session-thread-start-tool",
          surfacePiSessionId: "session-thread-start-tool",
          threadId: runtime.current!.rootThreadId,
          commandId: command!.id,
          threadGroupId: createdThread!.threadGroupId,
          threadIds: [createdThread!.id],
          threadCount: 1,
        }),
      }),
    ]);
  });

  it("emits a handler-thread app log when thread creation fails", async () => {
    const store = createStore();
    const runtime = createOrchestratorRuntime(store);
    const appLogEvents: AppLoggerEvent[] = [];
    const tool = createStartThreadTool({
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
      bridge: {
        async createHandlerThread() {
          throw new Error("handler backend unavailable");
        },
      },
    });

    const result = await tool.execute("tool-call-thread-start-failed", {
      threads: [{ objective: "Inspect the workspace" }],
    });

    const snapshot = store.getSessionState("session-thread-start-tool");
    const command = snapshot.commands.find((entry) => entry.toolName === "thread_start");
    expect(result.details).toMatchObject({
      ok: false,
      commandId: command?.id,
      error: "handler backend unavailable",
    });
    expect(command).toMatchObject({
      status: "failed",
      error: "handler backend unavailable",
    });
    expect(appLogEvents).toEqual([
      expect.objectContaining({
        level: "warning",
        source: "thread",
        message: "Handler thread creation failed.",
        details: expect.objectContaining({
          workspaceSessionId: "session-thread-start-tool",
          surfacePiSessionId: "session-thread-start-tool",
          threadId: runtime.current!.rootThreadId,
          commandId: command!.id,
          errorMessage: "handler backend unavailable",
        }),
      }),
    ]);
  });

  it("opens multiple requested threads as separate rows in one thread group", async () => {
    const store = createStore();
    const runtime = createOrchestratorRuntime(store);
    const observedThreadGroupInputs: Array<string | null> = [];

    const tool = createStartThreadTool({
      runtime,
      store,
      bridge: {
        async createHandlerThread(input) {
          observedThreadGroupInputs.push(input.threadGroupId);
          const index = observedThreadGroupInputs.length;
          const thread = store.createThread({
            turnId: input.turnId,
            parentThreadId: input.parentThreadId,
            threadGroupId: input.threadGroupId,
            surfacePiSessionId: `pi-thread-workstream-${index}`,
            title: input.objective,
            objective: input.objective,
            historyMode: input.historyMode,
          });
          return store.getThreadDetail(thread.id).thread;
        },
      },
    });

    const result = await tool.execute("tool-call-thread-start-multiple", {
      threads: [
        {
          objective: "Inspect the renderer surface contract and report exact gaps.",
        },
        {
          objective: "Inspect the Bun-side thread state contract and report exact gaps.",
        },
      ],
    });

    const snapshot = store.getSessionState("session-thread-start-tool");
    const command = snapshot.commands.find((entry) => entry.toolName === "thread_start");
    const resultDetails = result.details as {
      threadGroupId: string;
      threads: Array<Record<string, unknown>>;
    };

    expect(resultDetails.threads).toHaveLength(2);
    expect(resultDetails.threads[0]?.threadId).not.toBe(resultDetails.threads[1]?.threadId);
    expect(resultDetails.threads.map((thread) => thread.surfacePiSessionId)).toEqual([
      "pi-thread-workstream-1",
      "pi-thread-workstream-2",
    ]);
    expect(resultDetails.threads.map((thread) => thread.objective)).toEqual([
      "Inspect the renderer surface contract and report exact gaps.",
      "Inspect the Bun-side thread state contract and report exact gaps.",
    ]);
    expect(resultDetails.threads.every((thread) => !("threadGroupId" in thread))).toBe(true);

    expect(observedThreadGroupInputs).toEqual([null, resultDetails.threadGroupId]);
    expect(command).toMatchObject({
      title: "Start 2 handler threads",
      status: "succeeded",
      facts: {
        threadGroupId: resultDetails.threadGroupId,
        threads: resultDetails.threads,
      },
    });

    const createdThreads = snapshot.threads.filter((thread) =>
      thread.surfacePiSessionId.startsWith("pi-thread-workstream-"),
    );
    expect(createdThreads).toHaveLength(2);
    expect(new Set(createdThreads.map((thread) => thread.threadGroupId))).toEqual(
      new Set([resultDetails.threadGroupId]),
    );
  });
});
