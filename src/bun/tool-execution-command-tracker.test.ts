import { afterEach, describe, expect, it } from "bun:test";
import { createPromptExecutionContext } from "./prompt-execution-context";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";

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
    sessionId: "session-tool-tracker",
    title: "Tool tracker",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-16T09:00:00.000Z",
    updatedAt: "2026-04-16T09:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createPromptContext(store: StructuredSessionStateStore) {
  const turn = store.startTurn({
    sessionId: "session-tool-tracker",
    requestSummary: "Track tool commands",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    title: "Track tool commands",
    objective: "Persist prompt tool executions through the shared command seam.",
  });

  return createPromptExecutionContext({
    sessionId: "session-tool-tracker",
    turnId: turn.id,
    surfaceThreadId: rootThread.id,
    promptText: "Track tool commands",
  });
}

function createHandlerPromptContext(store: StructuredSessionStateStore) {
  const turn = store.startTurn({
    sessionId: "session-tool-tracker",
    requestSummary: "Track handler-thread tool commands",
  });
  const orchestratorThread = store.createThread({
    turnId: turn.id,
    title: "Plan follow-up work",
    objective: "Delegate and supervise work through a handler thread.",
  });
  const handlerThread = store.createThread({
    turnId: turn.id,
    parentThreadId: orchestratorThread.id,
    title: "Inspect the workspace",
    objective: "Run delegated commands from the handler thread surface.",
  });

  return {
    orchestratorThreadId: orchestratorThread.id,
    handlerThreadId: handlerThread.id,
    promptContext: createPromptExecutionContext({
      sessionId: "session-tool-tracker",
      turnId: turn.id,
      surfaceThreadId: handlerThread.id,
      surfaceKind: "handler",
      promptText: "Inspect the workspace",
    }),
  };
}

describe("tool execution command tracker", () => {
  it("records generic tool executions as structured commands", () => {
    const store = createStore();
    const tracker = createToolExecutionCommandTracker({
      store,
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-1",
      toolName: "bash",
      args: { command: "git status --short" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-1",
      toolName: "bash",
      result: {
        content: [{ type: "text", text: "M src/bun/session-catalog.ts" }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "bash",
        executor: "orchestrator",
        visibility: "summary",
        status: "succeeded",
        summary: "M src/bun/session-catalog.ts",
      }),
    ]);
  });

  it("records generic tool executions against the active surface thread", () => {
    const store = createStore();
    const { handlerThreadId, promptContext } = createHandlerPromptContext(store);
    const tracker = createToolExecutionCommandTracker({
      store,
      promptContext,
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-surface",
      toolName: "read",
      args: { filePath: "docs/prd.md" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-surface",
      toolName: "read",
      result: {
        content: [{ type: "text", text: "Loaded docs/prd.md" }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "read",
        threadId: handlerThreadId,
        summary: "Loaded docs/prd.md",
      }),
    ]);
  });

  it("treats api.* calls as execute_typescript trace commands", () => {
    const store = createStore();
    const tracker = createToolExecutionCommandTracker({
      store,
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-2",
      toolName: "api.repo.readFile",
      args: { path: "docs/prd.md" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-2",
      toolName: "api.repo.readFile",
      result: {
        content: [{ type: "text", text: "Loaded docs/prd.md" }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "api.repo.readFile",
        executor: "execute_typescript",
        visibility: "trace",
        status: "succeeded",
      }),
    ]);
  });

  it("ignores native control tools that already own structured command writes", () => {
    const store = createStore();
    const tracker = createToolExecutionCommandTracker({
      store,
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-3",
      toolName: "thread.start",
      args: { objective: "Inspect the workspace" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-3",
      toolName: "thread.start",
      result: {
        content: [{ type: "text", text: '{"threadId":"thread-2"}' }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toHaveLength(0);
  });

  it("ignores thread.handoff because the handler-thread tool owns its structured writes", () => {
    const store = createStore();
    const { promptContext } = createHandlerPromptContext(store);
    const tracker = createToolExecutionCommandTracker({
      store,
      promptContext,
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-handoff",
      toolName: "thread.handoff",
      args: {
        summary: "Delivered the delegated result.",
        body: "Delivered the delegated result and handed control back.",
      },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-handoff",
      toolName: "thread.handoff",
      result: {
        content: [{ type: "text", text: '{"episodeId":"episode-2"}' }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toHaveLength(0);
  });

  it("ignores execute_typescript because the runtime records its own parent and child commands", () => {
    const store = createStore();
    const tracker = createToolExecutionCommandTracker({
      store,
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-4",
      toolName: "execute_typescript",
      args: { typescriptCode: "return { ok: true };" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-4",
      toolName: "execute_typescript",
      result: {
        content: [{ type: "text", text: '{"success":true}' }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toHaveLength(0);
  });

  it("marks dangling tracked commands as failed or cancelled", () => {
    const store = createStore();
    const tracker = createToolExecutionCommandTracker({
      store,
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-5",
      toolName: "read",
      args: { filePath: "README.md" },
    });
    tracker.finishDanglingCommands({
      status: "cancelled",
      error: "Prompt execution ended before the tool run finished.",
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "read",
        status: "cancelled",
        error: "Prompt execution ended before the tool run finished.",
      }),
    ]);
  });
});
