import { afterEach, describe, expect, it } from "bun:test";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import {
  createThreadFollowupTool,
  createThreadRequestReportTool,
  type ThreadOrchestrationBridge,
} from "./thread-orchestration-tools";

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
    sessionId: "session-thread-orchestration",
    title: "Thread Orchestration Tool Session",
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
    sessionId: "session-thread-orchestration",
    surfacePiSessionId: "session-thread-orchestration",
    requestSummary: "Coordinate handler work",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: "session-thread-orchestration",
    title: "Coordinate handler work",
    objective: "Coordinate handler work.",
  });

  return {
    current: {
      sessionId: "session-thread-orchestration",
      turnId: turn.id,
      surfacePiSessionId: "session-thread-orchestration",
      surfaceThreadId: rootThread.id,
      surfaceKind: "orchestrator",
      defaultEpisodeKind: "analysis",
      rootThreadId: rootThread.id,
      promptText: "Coordinate handler work",
      rootEpisodeKind: "analysis",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
    },
  };
}

function createHandlerRuntime(store: StructuredSessionStateStore): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: "session-thread-orchestration",
    surfacePiSessionId: "handler-thread",
    requestSummary: "Handle delegated work",
  });
  return {
    current: {
      sessionId: "session-thread-orchestration",
      turnId: turn.id,
      surfacePiSessionId: "handler-thread",
      surfaceThreadId: "thread-handler",
      surfaceKind: "handler",
      defaultEpisodeKind: "change",
      rootThreadId: "thread-handler",
      promptText: "Handle delegated work",
      rootEpisodeKind: "change",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
    },
  };
}

describe("thread orchestration tools", () => {
  it("queues group followups with activation and records command facts", async () => {
    const store = createStore();
    const runtime = createOrchestratorRuntime(store);
    const bridgeCalls: Parameters<ThreadOrchestrationBridge["queueThreadFollowup"]>[0][] = [];
    const tool = createThreadFollowupTool({
      runtime,
      store,
      bridge: {
        async queueThreadFollowup(input) {
          bridgeCalls.push(input);
          return {
            threadGroupId: input.threadGroupId,
            threads: [
              {
                threadId: "thread-a",
                surfacePiSessionId: "surface-thread-a",
                objectiveState: "active",
                queuedMessageId: "queued-followup-a",
              },
            ],
          };
        },
        async queueThreadReportRequest() {
          throw new Error("unexpected report request");
        },
      },
    });

    const result = await tool.execute("tool-call-followup", {
      threadGroupId: "group-a",
      message: "Inspect the failing parser again.",
      activate: true,
    });

    const snapshot = store.getSessionState("session-thread-orchestration");
    const command = snapshot.commands.find((entry) => entry.toolName === "thread_followup");
    expect(bridgeCalls).toEqual([
      expect.objectContaining({
        commandId: command?.id,
        threadIds: null,
        threadGroupId: "group-a",
        message: "Inspect the failing parser again.",
        activate: true,
      }),
    ]);
    expect(snapshot.turns[0]?.turnDecision).toBe("thread_followup");
    expect(command).toMatchObject({
      status: "succeeded",
      visibility: "surface",
      summary: "Inspect the failing parser again.",
      arguments: {
        threadGroupId: "group-a",
        message: "Inspect the failing parser again.",
        activate: true,
      },
      facts: result.details,
    });
    expect(result.details).toEqual({
      threadGroupId: "group-a",
      threads: [
        {
          threadId: "thread-a",
          surfacePiSessionId: "surface-thread-a",
          objectiveState: "active",
          queuedMessageId: "queued-followup-a",
        },
      ],
    });
  });

  it("records failed command facts for invalid followup addressing", async () => {
    const store = createStore();
    const tool = createThreadFollowupTool({
      runtime: createOrchestratorRuntime(store),
      store,
      bridge: {
        async queueThreadFollowup() {
          throw new Error("unexpected followup");
        },
        async queueThreadReportRequest() {
          throw new Error("unexpected report request");
        },
      },
    });

    await expect(
      tool.execute("tool-call-followup-invalid", {
        threadIds: ["thread-a"],
        threadGroupId: "group-a",
        message: "Ambiguous target.",
      }),
    ).rejects.toThrow("thread_followup accepts threadIds or threadGroupId, not both.");
    expect(store.getSessionState("session-thread-orchestration").commands).toEqual([
      expect.objectContaining({
        toolName: "thread_followup",
        status: "failed",
        arguments: {
          threadIds: ["thread-a"],
          threadGroupId: "group-a",
          message: "Ambiguous target.",
          activate: false,
        },
        error: "thread_followup accepts threadIds or threadGroupId, not both.",
      }),
    ]);
  });

  it("queues report requests without changing handler objectives", async () => {
    const store = createStore();
    const runtime = createOrchestratorRuntime(store);
    const bridgeCalls: Parameters<ThreadOrchestrationBridge["queueThreadReportRequest"]>[0][] = [];
    const tool = createThreadRequestReportTool({
      runtime,
      store,
      bridge: {
        async queueThreadFollowup() {
          throw new Error("unexpected followup");
        },
        async queueThreadReportRequest(input) {
          bridgeCalls.push(input);
          return {
            threadId: input.threadId,
            surfacePiSessionId: "surface-thread-a",
            queuedMessageId: "queued-report-request-a",
          };
        },
      },
    });

    const result = await tool.execute("tool-call-request-report", {
      threadId: "thread-a",
      request: "Send a concise status update.",
    });

    const snapshot = store.getSessionState("session-thread-orchestration");
    const command = snapshot.commands.find((entry) => entry.toolName === "thread_request_report");
    expect(bridgeCalls).toEqual([
      expect.objectContaining({
        commandId: command?.id,
        threadId: "thread-a",
        request: "Send a concise status update.",
      }),
    ]);
    expect(snapshot.turns[0]?.turnDecision).toBe("thread_request_report");
    expect(command).toMatchObject({
      status: "succeeded",
      visibility: "surface",
      summary: "Send a concise status update.",
      arguments: {
        threadId: "thread-a",
        request: "Send a concise status update.",
      },
      facts: result.details,
    });
    expect(result.details).toEqual({
      threadId: "thread-a",
      surfacePiSessionId: "surface-thread-a",
      queuedMessageId: "queued-report-request-a",
    });
  });

  it("keeps orchestrator-only thread orchestration tools out of handler surfaces", async () => {
    const store = createStore();
    const handlerRuntime = createHandlerRuntime(store);
    const bridge: ThreadOrchestrationBridge = {
      async queueThreadFollowup() {
        throw new Error("unexpected followup");
      },
      async queueThreadReportRequest() {
        throw new Error("unexpected report request");
      },
    };

    await expect(
      createThreadFollowupTool({ runtime: handlerRuntime, store, bridge }).execute(
        "tool-call-handler-followup",
        {
          threadIds: ["thread-a"],
          message: "Handlers cannot orchestrate followups.",
        },
      ),
    ).rejects.toThrow("thread_followup can only run from the orchestrator.");
    await expect(
      createThreadRequestReportTool({ runtime: handlerRuntime, store, bridge }).execute(
        "tool-call-handler-report-request",
        {
          threadId: "thread-a",
        },
      ),
    ).rejects.toThrow("thread_request_report can only run from the orchestrator.");
  });
});
