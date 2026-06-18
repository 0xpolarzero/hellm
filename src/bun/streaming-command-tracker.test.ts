import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { createPromptExecutionContext } from "./prompt-execution-context";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { createStreamingCommandTracker } from "./streaming-command-tracker";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";

const WORKSPACE = {
  id: "/repo/svvy",
  label: "svvy",
  cwd: "/repo/svvy",
} as const;

const stores: StructuredSessionStateStore[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { force: true, recursive: true });
  }
});

function createStore(): StructuredSessionStateStore {
  const store = createStructuredSessionStateStore({ workspace: WORKSPACE });
  store.upsertPiSession({
    sessionId: "session-streaming",
    title: "Streaming tracker",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-06-10T09:00:00.000Z",
    updatedAt: "2026-06-10T09:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createFileStore() {
  const root = mkdtempSync(join(tmpdir(), "svvy-streaming-test-"));
  tempDirs.push(root);
  const databasePath = join(root, "state.sqlite");
  const store = createStructuredSessionStateStore({
    workspace: { id: root, label: "svvy", cwd: root },
    databasePath,
  });
  store.upsertPiSession({
    sessionId: "session-streaming",
    title: "Streaming tracker",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-06-10T09:00:00.000Z",
    updatedAt: "2026-06-10T09:00:00.000Z",
  });
  stores.push(store);
  return { databasePath, store };
}

function createPromptContext(store: StructuredSessionStateStore) {
  const turn = store.startTurn({
    sessionId: "session-streaming",
    surfacePiSessionId: "session-streaming",
    requestSummary: "Test streaming tool commands",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    title: "Streaming test",
    objective: "Test incremental tool-call argument streaming.",
  });
  return createPromptExecutionContext({
    sessionId: "session-streaming",
    turnId: turn.id,
    surfacePiSessionId: "session-streaming",
    surfaceThreadId: rootThread.id,
    promptText: "Test streaming",
  });
}

function makePartial(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: [],
    stopReason: null,
    provider: "openai",
    model: "gpt-5.4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...overrides,
  } as AssistantMessage;
}

describe("StreamingCommandTracker", () => {
  it("creates a streaming command on toolcall_start", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingCommandTracker({ store, promptContext: ctx });

    tracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-1",
      toolName: "exec_command",
      partialArguments: { cmd: "" },
      partial: makePartial(),
    });

    const snapshot = store.getSessionState("session-streaming");
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.commands[0]!.status).toBe("streaming");
    expect(snapshot.commands[0]!.toolName).toBe("exec_command");
    expect(snapshot.commands[0]!.facts).toEqual({ toolCallId: "tc-1" });
  });

  it("records incremental arg_snapshot events on toolcall_delta", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingCommandTracker({ store, promptContext: ctx });

    tracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-2",
      toolName: "exec_command",
      partialArguments: { cmd: "echo" },
      partial: makePartial(),
    });

    tracker.handleToolcallDelta({
      contentIndex: 0,
      toolCallId: "tc-2",
      toolName: "exec_command",
      delta: " hello world this is a longer command argument to exceed threshold",
      partialArguments: {
        cmd: "echo hello world this is a longer command argument to exceed threshold",
      },
      partial: makePartial(),
    });

    const snapshot = store.getSessionState("session-streaming");
    const argSnapshots = snapshot.events.filter((e) => e.kind === "command.arg_snapshot");
    expect(argSnapshots.length).toBeGreaterThanOrEqual(1);
    expect(argSnapshots[0]!.data!.source).toBe("streaming");
    expect(
      argSnapshots.some((event) => {
        return (
          event.data?.source === "streaming" &&
          JSON.stringify(event.data.arguments) ===
            JSON.stringify({
              cmd: "echo hello world this is a longer command argument to exceed threshold",
            })
        );
      }),
    ).toBe(true);
    expect(argSnapshots.map((event) => event.at)).toEqual(
      argSnapshots.map((event) => event.at).toSorted(),
    );
  });

  it("records a streaming-final snapshot on toolcall_end", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingCommandTracker({ store, promptContext: ctx });

    tracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-3",
      toolName: "apply_patch",
      partialArguments: {},
      partial: makePartial(),
    });

    tracker.handleToolcallEnd({
      contentIndex: 0,
      toolCallId: "tc-3",
      toolName: "apply_patch",
      arguments: { patch: "*** Update File: foo.ts\n+hello" },
      partial: makePartial(),
    });

    const snapshot = store.getSessionState("session-streaming");
    const finalSnapshots = snapshot.events.filter(
      (e) => e.kind === "command.arg_snapshot" && e.data?.source === "streaming-final",
    );
    expect(finalSnapshots).toHaveLength(1);
    expect(finalSnapshots[0]!.data!.arguments).toEqual({
      patch: "*** Update File: foo.ts\n+hello",
    });

    expect(snapshot.commands[0]!.arguments).toEqual({
      patch: "*** Update File: foo.ts\n+hello",
    });
  });

  it("skips arg_snapshot events for specialized tools on delta", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingCommandTracker({ store, promptContext: ctx });

    tracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-spec",
      toolName: "execute_typescript",
      partialArguments: { typescriptCode: "" },
      partial: makePartial(),
    });

    tracker.handleToolcallDelta({
      contentIndex: 0,
      toolCallId: "tc-spec",
      toolName: "execute_typescript",
      delta: "// some code".repeat(20),
      partialArguments: { typescriptCode: "// some code".repeat(20) },
      partial: makePartial(),
    });

    const snapshot = store.getSessionState("session-streaming");
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.commands[0]!.toolName).toBe("execute_typescript");
    expect(snapshot.commands[0]!.status).toBe("streaming");

    const argSnapshots = snapshot.events.filter((e) => e.kind === "command.arg_snapshot");
    expect(argSnapshots).toHaveLength(0);
  });

  it("finishes dangling streaming commands", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingCommandTracker({ store, promptContext: ctx });

    tracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-dangle",
      toolName: "exec_command",
      partialArguments: { cmd: "echo" },
      partial: makePartial(),
    });

    tracker.finishDanglingStreamingCommands({
      status: "cancelled",
      error: "Turn ended before execution.",
    });

    const snapshot = store.getSessionState("session-streaming");
    expect(snapshot.commands[0]!.status).toBe("cancelled");
  });

  it("persists incremental events durably across reload", () => {
    const first = createFileStore();
    const ctx = createPromptContext(first.store);
    const tracker = createStreamingCommandTracker({ store: first.store, promptContext: ctx });

    tracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-reload",
      toolName: "exec_command",
      partialArguments: { cmd: "echo hi" },
      partial: makePartial(),
    });

    tracker.handleToolcallEnd({
      contentIndex: 0,
      toolCallId: "tc-reload",
      toolName: "exec_command",
      arguments: { cmd: "echo hello world" },
      partial: makePartial(),
    });

    first.store.close();
    stores.splice(stores.indexOf(first.store), 1);

    const secondStore = createStructuredSessionStateStore({
      workspace: { id: WORKSPACE.id, label: WORKSPACE.label, cwd: WORKSPACE.cwd },
      databasePath: first.databasePath,
    });
    stores.push(secondStore);

    const snapshot = secondStore.getSessionState("session-streaming");
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.commands[0]!.toolName).toBe("exec_command");
    expect(snapshot.commands[0]!.arguments).toEqual({ cmd: "echo hello world" });
    expect(snapshot.commands[0]!.status).toBe("streaming");

    const argSnapshots = snapshot.events.filter((e) => e.kind === "command.arg_snapshot");
    expect(argSnapshots.length).toBeGreaterThanOrEqual(2);
  });

  it("execution tracker reuses streaming command on tool_execution_start", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const streamingTracker = createStreamingCommandTracker({ store, promptContext: ctx });
    const executionTracker = createToolExecutionCommandTracker({
      store,
      promptContext: ctx,
    });

    streamingTracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-bridge",
      toolName: "exec_command",
      partialArguments: { cmd: "echo" },
      partial: makePartial(),
    });

    const snapshotBefore = store.getSessionState("session-streaming");
    expect(snapshotBefore.commands).toHaveLength(1);
    expect(snapshotBefore.commands[0]!.status).toBe("streaming");
    const commandId = snapshotBefore.commands[0]!.id;

    executionTracker.handleToolExecutionStart({
      toolCallId: "tc-bridge",
      toolName: "exec_command",
      args: { cmd: "echo hello" },
    });

    const snapshotAfter = store.getSessionState("session-streaming");
    expect(snapshotAfter.commands).toHaveLength(1);
    expect(snapshotAfter.commands[0]!.id).toBe(commandId);
    expect(snapshotAfter.commands[0]!.status).toBe("running");
    expect(snapshotAfter.commands[0]!.arguments).toEqual({ cmd: "echo hello" });
  });

  it("orders incremental snapshots before execution events", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const streamingTracker = createStreamingCommandTracker({ store, promptContext: ctx });
    const executionTracker = createToolExecutionCommandTracker({
      store,
      promptContext: ctx,
    });

    streamingTracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-order",
      toolName: "exec_command",
      partialArguments: { cmd: "" },
      partial: makePartial(),
    });

    streamingTracker.handleToolcallEnd({
      contentIndex: 0,
      toolCallId: "tc-order",
      toolName: "exec_command",
      arguments: { cmd: "echo done" },
      partial: makePartial(),
    });

    executionTracker.handleToolExecutionStart({
      toolCallId: "tc-order",
      toolName: "exec_command",
      args: { cmd: "echo done" },
    });

    executionTracker.handleToolExecutionEnd({
      toolCallId: "tc-order",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "done" }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-streaming");
    const events = snapshot.events;
    const argSnapshotIndex = events.findIndex((e) => e.kind === "command.arg_snapshot");
    const startedIndex = events.findIndex((e) => e.kind === "command.started");
    const outputIndex = events.findIndex((e) => e.kind === "command.output");

    expect(argSnapshotIndex).toBeGreaterThan(-1);
    expect(startedIndex).toBeGreaterThan(argSnapshotIndex);
    expect(outputIndex).toBeGreaterThan(startedIndex);
  });

  it("covers large freeform args, execute_typescript source, and apply_patch patch preview", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingCommandTracker({ store, promptContext: ctx });

    // exec_command with large args
    tracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-exec",
      toolName: "exec_command",
      partialArguments: { cmd: "" },
      partial: makePartial(),
    });
    const longArg = "a".repeat(200);
    tracker.handleToolcallDelta({
      contentIndex: 0,
      toolCallId: "tc-exec",
      toolName: "exec_command",
      delta: longArg,
      partialArguments: { cmd: longArg },
      partial: makePartial(),
    });

    // apply_patch with patch preview
    tracker.handleToolcallStart({
      contentIndex: 1,
      toolCallId: "tc-patch",
      toolName: "apply_patch",
      partialArguments: {},
      partial: makePartial(),
    });
    tracker.handleToolcallEnd({
      contentIndex: 1,
      toolCallId: "tc-patch",
      toolName: "apply_patch",
      arguments: { patch: "*** Update File: src/app.ts\n+new line\n-old line" },
      partial: makePartial(),
    });

    // execute_typescript with source
    tracker.handleToolcallStart({
      contentIndex: 2,
      toolCallId: "tc-ts",
      toolName: "execute_typescript",
      partialArguments: { typescriptCode: "" },
      partial: makePartial(),
    });
    tracker.handleToolcallEnd({
      contentIndex: 2,
      toolCallId: "tc-ts",
      toolName: "execute_typescript",
      arguments: { typescriptCode: "console.log('hello')" },
      partial: makePartial(),
    });

    const snapshot = store.getSessionState("session-streaming");
    expect(snapshot.commands).toHaveLength(3);

    const execCmd = snapshot.commands.find((c) => c.toolName === "exec_command");
    expect(execCmd).toBeDefined();
    expect(execCmd!.status).toBe("streaming");

    const patchCmd = snapshot.commands.find((c) => c.toolName === "apply_patch");
    expect(patchCmd).toBeDefined();
    expect(patchCmd!.arguments).toEqual({
      patch: "*** Update File: src/app.ts\n+new line\n-old line",
    });

    const tsCmd = snapshot.commands.find((c) => c.toolName === "execute_typescript");
    expect(tsCmd).toBeDefined();
    expect(tsCmd!.arguments).toEqual({ typescriptCode: "console.log('hello')" });
  });

  it("succeeded commands survive prompt cleanup after full stream+execution lifecycle", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const streamingTracker = createStreamingCommandTracker({ store, promptContext: ctx });
    const executionTracker = createToolExecutionCommandTracker({
      store,
      promptContext: ctx,
      onReusedStreamingToolCall: (toolCallId) => streamingTracker.releaseToolCall(toolCallId),
    });

    // Model starts producing tool arguments
    streamingTracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-lifecycle",
      toolName: "exec_command",
      partialArguments: { cmd: "" },
      partial: makePartial(),
    });

    streamingTracker.handleToolcallDelta({
      contentIndex: 0,
      toolCallId: "tc-lifecycle",
      toolName: "exec_command",
      delta: "echo hello",
      partialArguments: { cmd: "echo hello" },
      partial: makePartial(),
    });

    // Model finishes arguments
    streamingTracker.handleToolcallEnd({
      contentIndex: 0,
      toolCallId: "tc-lifecycle",
      toolName: "exec_command",
      arguments: { cmd: "echo hello" },
      partial: makePartial(),
    });

    // Runtime execution starts
    executionTracker.handleToolExecutionStart({
      toolCallId: "tc-lifecycle",
      toolName: "exec_command",
      args: { cmd: "echo hello" },
    });

    // Runtime execution finishes successfully
    executionTracker.handleToolExecutionEnd({
      toolCallId: "tc-lifecycle",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "hello" }],
      },
      isError: false,
    });

    // Simulate prompt cleanup (finally block)
    streamingTracker.finishDanglingStreamingCommands({
      status: "cancelled",
      error: "Prompt execution ended before the tool run finished.",
    });
    executionTracker.finishDanglingCommands({
      status: "cancelled",
      error: "Prompt execution ended before the tool run finished.",
    });

    // The command should be succeeded, NOT cancelled
    const snapshot = store.getSessionState("session-streaming");
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.commands[0]!.status).toBe("succeeded");
    expect(snapshot.commands[0]!.toolName).toBe("exec_command");
  });

  it("cancels commands that reach toolcall_end but never reach runtime execution", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const streamingTracker = createStreamingCommandTracker({ store, promptContext: ctx });

    // Model starts producing tool arguments
    streamingTracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-gap",
      toolName: "exec_command",
      partialArguments: { cmd: "" },
      partial: makePartial(),
    });

    // Model finishes arguments (toolcall_end), but runtime never starts
    streamingTracker.handleToolcallEnd({
      contentIndex: 0,
      toolCallId: "tc-gap",
      toolName: "exec_command",
      arguments: { cmd: "echo gap" },
      partial: makePartial(),
    });

    // Prompt ends before tool_execution_start fires
    streamingTracker.finishDanglingStreamingCommands({
      status: "cancelled",
      error: "Prompt execution ended before the tool run finished.",
    });

    const snapshot = store.getSessionState("session-streaming");
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.commands[0]!.status).toBe("cancelled");
    expect(snapshot.commands[0]!.toolName).toBe("exec_command");
  });
});
