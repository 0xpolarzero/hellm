import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import * as Effect from "effect/Effect";
import { nativeToolCommandMetadata } from "@svvy/extensions";
import { createPromptExecutionContext } from "@svvy/core";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "@svvy/state/structured-session-state";
import { runtimeCommandStatePortFromStore, runtimeTurnStatePortFromStore } from "@svvy/state";
import { createStreamingCommandTracker } from "./streaming-command-tracker";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";
import type { RuntimeStateWriteLane } from "./ordered-runtime-state-write-lane";

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
    workspaceSessionId: "session-streaming",
    turnId: turn.id,
    surfacePiSessionId: "session-streaming",
    threadId: rootThread.id,
    generatedAgentContextFingerprint: "generated_context_fingerprint_test",
    generatedAgentContextRevision: "generated_context_revision_test",
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

function createStreamingTracker(
  store: StructuredSessionStateStore,
  ctx: ReturnType<typeof createPromptContext>,
) {
  return createStreamingCommandTracker({
    commandState: runtimeCommandStatePortFromStore(store),
    promptContext: ctx,
    stateWrites: createImmediateRuntimeStateWriteLane(),
  });
}

function createExecutionTracker(
  store: StructuredSessionStateStore,
  ctx: ReturnType<typeof createPromptContext>,
  onReusedStreamingToolCall?: (toolCallId: string) => void,
) {
  return createToolExecutionCommandTracker({
    commandState: runtimeCommandStatePortFromStore(store),
    turnState: runtimeTurnStatePortFromStore(store),
    promptContext: ctx,
    stateWrites: createImmediateRuntimeStateWriteLane(),
    ...(onReusedStreamingToolCall ? { onReusedStreamingToolCall } : {}),
  });
}

function createImmediateRuntimeStateWriteLane(): RuntimeStateWriteLane {
  return {
    run(effect) {
      return Promise.resolve(Effect.runSync(effect));
    },
    enqueue(_label, effect) {
      return Promise.resolve(Effect.runSync(effect));
    },
    drain() {
      return Promise.resolve();
    },
    close() {
      return Promise.resolve();
    },
  };
}

function createDeferredRuntimeStateWriteLane(): RuntimeStateWriteLane {
  let tail: Promise<void> = Promise.resolve();
  return {
    run(effect) {
      return this.enqueue("test", effect);
    },
    enqueue(_label, effect) {
      const task = tail.then(() => Promise.resolve().then(() => Effect.runSync(effect)));
      tail = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    async drain() {
      await tail;
    },
    async close() {
      await tail;
    },
  };
}

function createStreamingTrackerWithLane(
  store: StructuredSessionStateStore,
  ctx: ReturnType<typeof createPromptContext>,
  lane: RuntimeStateWriteLane,
) {
  return createStreamingCommandTracker({
    commandState: runtimeCommandStatePortFromStore(store),
    promptContext: ctx,
    stateWrites: lane,
  });
}

function createExecutionTrackerWithLane(
  store: StructuredSessionStateStore,
  ctx: ReturnType<typeof createPromptContext>,
  lane: RuntimeStateWriteLane,
  onReusedStreamingToolCall?: (toolCallId: string) => void,
) {
  return createToolExecutionCommandTracker({
    commandState: runtimeCommandStatePortFromStore(store),
    turnState: runtimeTurnStatePortFromStore(store),
    promptContext: ctx,
    stateWrites: lane,
    ...(onReusedStreamingToolCall ? { onReusedStreamingToolCall } : {}),
  });
}

describe("StreamingCommandTracker", () => {
  it("creates a streaming command on toolcall_start", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingTracker(store, ctx);

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
    const tracker = createStreamingTracker(store, ctx);

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
    const tracker = createStreamingTracker(store, ctx);

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

  it("uses extension-owned metadata to skip snapshots for self-recorded-command tools", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingTracker(store, ctx);
    const toolName = nativeToolCommandMetadata.find(
      (metadata) => metadata.toolName === "execute_typescript",
    )!.toolName;

    tracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-spec",
      toolName,
      partialArguments: { typescriptCode: "" },
      partial: makePartial(),
    });

    tracker.handleToolcallDelta({
      contentIndex: 0,
      toolCallId: "tc-spec",
      toolName,
      delta: "// some code".repeat(20),
      partialArguments: { typescriptCode: "// some code".repeat(20) },
      partial: makePartial(),
    });

    const snapshot = store.getSessionState("session-streaming");
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.commands[0]!.toolName).toBe(toolName);
    expect(snapshot.commands[0]!.visibility).toBe("surface");
    expect(snapshot.commands[0]!.status).toBe("streaming");

    const argSnapshots = snapshot.events.filter((e) => e.kind === "command.arg_snapshot");
    expect(argSnapshots).toHaveLength(0);
  });

  it("finishes dangling streaming commands", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const tracker = createStreamingTracker(store, ctx);

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
    const tracker = createStreamingTracker(first.store, ctx);

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
    const streamingTracker = createStreamingTracker(store, ctx);
    const executionTracker = createExecutionTracker(store, ctx);

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
    const streamingTracker = createStreamingTracker(store, ctx);
    const executionTracker = createExecutionTracker(store, ctx);

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
    const tracker = createStreamingTracker(store, ctx);

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
    const streamingTracker = createStreamingTracker(store, ctx);
    const executionTracker = createExecutionTracker(store, ctx, (toolCallId) =>
      streamingTracker.releaseToolCall(toolCallId),
    );

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

  it("keeps streamed command reuse ordered when pi callbacks arrive before async state writes drain", async () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const lane = createDeferredRuntimeStateWriteLane();
    const streamingTracker = createStreamingTrackerWithLane(store, ctx, lane);
    const executionTracker = createExecutionTrackerWithLane(store, ctx, lane, (toolCallId) =>
      streamingTracker.releaseToolCall(toolCallId),
    );

    streamingTracker.handleToolcallStart({
      contentIndex: 0,
      toolCallId: "tc-ordered",
      toolName: "exec_command",
      partialArguments: { cmd: "" },
      partial: makePartial(),
    });
    streamingTracker.handleToolcallEnd({
      contentIndex: 0,
      toolCallId: "tc-ordered",
      toolName: "exec_command",
      arguments: { cmd: "echo ordered" },
      partial: makePartial(),
    });
    executionTracker.handleToolExecutionStart({
      toolCallId: "tc-ordered",
      toolName: "exec_command",
      args: { cmd: "echo ordered" },
    });
    executionTracker.handleToolExecutionEnd({
      toolCallId: "tc-ordered",
      toolName: "exec_command",
      result: { content: [{ type: "text", text: "ordered" }] },
      isError: false,
    });
    streamingTracker.finishDanglingStreamingCommands({
      status: "cancelled",
      error: "Prompt execution ended before the tool run finished.",
    });
    executionTracker.finishDanglingCommands({
      status: "cancelled",
      error: "Prompt execution ended before the tool run finished.",
    });

    await lane.drain();

    const snapshot = store.getSessionState("session-streaming");
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.commands[0]!).toEqual(
      expect.objectContaining({
        toolName: "exec_command",
        status: "succeeded",
        arguments: { cmd: "echo ordered" },
      }),
    );
  });

  it("cancels commands that reach toolcall_end but never reach runtime execution", () => {
    const store = createStore();
    const ctx = createPromptContext(store);
    const streamingTracker = createStreamingTracker(store, ctx);

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
