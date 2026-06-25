import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { nativeToolCommandMetadata } from "@svvy/extensions";
import { createPromptExecutionContext } from "@svvy/core";
import type { AppLoggerEvent } from "./app-logger";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "@svvy/state/structured-session-state";
import { runtimeCommandStatePortFromStore, runtimeTurnStatePortFromStore } from "@svvy/state";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";
import type { RuntimeStateWriteLane } from "./ordered-runtime-state-write-lane";

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
    surfacePiSessionId: "session-tool-tracker",
    requestSummary: "Track tool commands",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    title: "Track tool commands",
    objective: "Persist prompt tool executions through the shared command seam.",
  });

  return createPromptExecutionContext({
    workspaceSessionId: "session-tool-tracker",
    turnId: turn.id,
    surfacePiSessionId: "session-tool-tracker",
    threadId: rootThread.id,
    generatedAgentContextFingerprint: "generated_context_fingerprint_test",
    generatedAgentContextRevision: "generated_context_revision_test",
  });
}

function createHandlerPromptContext(store: StructuredSessionStateStore) {
  const turn = store.startTurn({
    sessionId: "session-tool-tracker",
    surfacePiSessionId: "session-tool-tracker",
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
      workspaceSessionId: "session-tool-tracker",
      turnId: turn.id,
      surfacePiSessionId: handlerThread.surfacePiSessionId,
      threadId: handlerThread.id,
      surfaceKind: "handler",
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    }),
  };
}

function createTracker(
  store: StructuredSessionStateStore,
  options: Omit<
    Parameters<typeof createToolExecutionCommandTracker>[0],
    "commandState" | "stateWrites" | "turnState"
  >,
) {
  return createToolExecutionCommandTracker({
    ...options,
    commandState: runtimeCommandStatePortFromStore(store),
    stateWrites: createImmediateRuntimeStateWriteLane(),
    turnState: runtimeTurnStatePortFromStore(store),
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

describe("tool execution command tracker", () => {
  it("creates a running command record at tool start before any result arrives", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-running",
      toolName: "exec_command",
      args: { cmd: "bun test" },
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "exec_command",
        status: "running",
        summary: 'exec_command({"cmd":"bun test"})',
        arguments: { cmd: "bun test" },
        facts: { toolCallId: "tool-call-running" },
        finishedAt: null,
      }),
    ]);
    expect(snapshot.turns[0]?.turnDecision).toBe("exec_command");
  });

  it("records generic tool executions as structured commands", () => {
    const store = createStore();
    const appLogEvents: AppLoggerEvent[] = [];
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
      onAppLog: (event) => appLogEvents.push(event),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-1",
      toolName: "exec_command",
      args: { cmd: "git status --short" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-1",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "M src/bun/session-catalog.ts" }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        status: "succeeded",
        summary: "M src/bun/session-catalog.ts",
      }),
    ]);
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        kind: "command.output",
        subject: {
          kind: "command",
          id: snapshot.commands[0]!.id,
        },
        data: {
          stream: "stdout",
          source: "final-result",
          text: "M src/bun/session-catalog.ts",
        },
      }),
    );
    expect(snapshot.turns[0]?.turnDecision).toBe("exec_command");
    expect(appLogEvents).toEqual([
      expect.objectContaining({
        level: "info",
        source: "direct-tool",
        message: "Direct tool started.",
        details: expect.objectContaining({
          workspaceSessionId: "session-tool-tracker",
          surfacePiSessionId: "session-tool-tracker",
          commandId: snapshot.commands[0]!.id,
          toolName: "exec_command",
        }),
      }),
      expect.objectContaining({
        level: "info",
        source: "direct-tool",
        message: "Direct tool finished.",
        details: expect.objectContaining({
          workspaceSessionId: "session-tool-tracker",
          surfacePiSessionId: "session-tool-tracker",
          commandId: snapshot.commands[0]!.id,
          toolName: "exec_command",
        }),
      }),
    ]);
  });

  it("settles apply_patch command records from authoritative final command facts", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-patch",
      toolName: "apply_patch",
      args: {
        patch: [
          "*** Begin Patch",
          "*** Update File: src/mainview/ChatWorkspace.svelte",
          "@@",
          "-  <WorkflowInspector />",
          "+  <WorkflowsPane />",
          "*** End Patch",
        ].join("\n"),
      },
    });
    expect(store.getSessionState("session-tool-tracker").commands[0]).toMatchObject({
      toolName: "apply_patch",
      status: "running",
      summary: expect.stringContaining("src/mainview/ChatWorkspace.svelte"),
      finishedAt: null,
    });

    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-patch",
      toolName: "apply_patch",
      result: {
        content: [{ type: "text", text: "Patch applied successfully." }],
        details: {
          commandFacts: {
            changedFiles: ["src/mainview/ChatWorkspace.svelte"],
            createdFiles: [],
            deletedFiles: [],
            errors: [],
          },
        },
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "apply_patch",
        visibility: "summary",
        status: "succeeded",
        summary: "Patch applied successfully.",
        facts: {
          changedFiles: ["src/mainview/ChatWorkspace.svelte"],
          createdFiles: [],
          deletedFiles: [],
          errors: [],
        },
      }),
    ]);
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        kind: "command.patch_snapshot",
        subject: {
          kind: "command",
          id: snapshot.commands[0]!.id,
        },
        data: {
          source: "accepted-arguments",
          files: [
            {
              path: "src/mainview/ChatWorkspace.svelte",
              changeType: "modified",
              additions: 1,
              deletions: 1,
            },
          ],
        },
      }),
    );
    expect(snapshot.turns[0]?.turnDecision).toBe("apply_patch");
  });

  it("persists failed apply_patch command facts with errors", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });
    const patch = [
      "--- src/mainview/Missing.svelte",
      "+++ src/mainview/Missing.svelte",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-patch-failed",
      toolName: "apply_patch",
      args: { patch },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-patch-failed",
      toolName: "apply_patch",
      result: new Error(
        JSON.stringify({
          error: {
            code: "apply_patch_failed",
            message: "File to patch was not found.",
          },
          commandFacts: {
            changedFiles: ["src/mainview/Missing.svelte"],
            createdFiles: [],
            deletedFiles: [],
            errors: ["File to patch was not found."],
          },
        }),
      ),
      isError: true,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands[0]).toMatchObject({
      toolName: "apply_patch",
      status: "failed",
      facts: {
        changedFiles: ["src/mainview/Missing.svelte"],
        createdFiles: [],
        deletedFiles: [],
        errors: ["File to patch was not found."],
      },
      error: "apply_patch failed.",
    });
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        kind: "command.patch_snapshot",
        subject: {
          kind: "command",
          id: snapshot.commands[0]!.id,
        },
        data: {
          source: "accepted-arguments",
          files: [
            {
              path: "src/mainview/Missing.svelte",
              changeType: "modified",
              additions: 1,
              deletions: 1,
            },
          ],
        },
      }),
    );
  });

  it("does not create command records for unregistered native tools", () => {
    const store = createStore();
    const { promptContext } = createHandlerPromptContext(store);
    const tracker = createTracker(store, {
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
    expect(snapshot.commands).toEqual([]);
    expect(snapshot.turns[0]?.turnDecision).toBe("pending");
  });

  it("records shell-routed CLI command surfaces as ordinary summary commands", () => {
    const store = createStore();
    const appLogEvents: AppLoggerEvent[] = [];
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
      onAppLog: (event) => appLogEvents.push(event),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-smithers-cli",
      toolName: "exec_command",
      args: { cmd: "bunx smithers-orchestrator ps" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-smithers-cli",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "No running workflows." }],
      },
      isError: false,
    });
    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-cx-cli",
      toolName: "exec_command",
      args: { cmd: "cx overview src" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-cx-cli",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "src/index.ts" }],
      },
      isError: false,
    });
    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-tinyfish-cli",
      toolName: "exec_command",
      args: { cmd: "tinyfish search query --q svvy --json" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-tinyfish-cli",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: '{"results":[]}' }],
      },
      isError: false,
    });
    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-smithers-shell-segment",
      toolName: "exec_command",
      args: { cmd: "cd .smithers && bunx smithers-orchestrator ps" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-smithers-shell-segment",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "No workflows." }],
      },
      isError: false,
    });
    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-workflows-cli",
      toolName: "exec_command",
      args: { cmd: "svvyx workflows list --json" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-workflows-cli",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: '{"workflows":[]}' }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        status: "succeeded",
      }),
      expect.objectContaining({
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        status: "succeeded",
      }),
      expect.objectContaining({
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        status: "succeeded",
      }),
      expect.objectContaining({
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        status: "succeeded",
      }),
      expect.objectContaining({
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        status: "succeeded",
      }),
    ]);
    expect(snapshot.turns[0]?.turnDecision).toBe("exec_command");
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "info",
        source: "smithers",
        message: "Smithers CLI command started.",
        details: expect.objectContaining({
          commandId: snapshot.commands[0]!.id,
          toolName: "exec_command",
        }),
      }),
    );
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "info",
        source: "smithers",
        message: "Smithers CLI command finished.",
        details: expect.objectContaining({
          commandId: snapshot.commands[0]!.id,
          toolName: "exec_command",
        }),
      }),
    );
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "info",
        source: "smithers",
        message: "Smithers CLI command started.",
        details: expect.objectContaining({
          commandId: snapshot.commands[3]!.id,
          toolName: "exec_command",
        }),
      }),
    );
  });

  it("records exec_command stdout and stderr as durable command output events", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-output",
      toolName: "exec_command",
      args: { cmd: "bun test" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-output",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "stdout\nstderr\nExit code: 1" }],
        details: {
          stdout: "1 pass\n",
          stderr: "1 fail\n",
          exitCode: 1,
          exitSignal: null,
        },
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    const command = snapshot.commands[0]!;
    expect(snapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "command.output",
          subject: {
            kind: "command",
            id: command.id,
          },
          data: {
            stream: "stdout",
            source: "final-result",
            text: "1 pass\n",
          },
        }),
        expect.objectContaining({
          kind: "command.output",
          subject: {
            kind: "command",
            id: command.id,
          },
          data: {
            stream: "stderr",
            source: "final-result",
            text: "1 fail\n",
          },
        }),
      ]),
    );
  });

  it("does not duplicate exec_command streams already recorded from live output", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-live-output",
      toolName: "exec_command",
      args: { cmd: "bun test" },
    });
    const command = store.getSessionState("session-tool-tracker").commands[0]!;
    store.recordLifecycleEvent({
      sessionId: "session-tool-tracker",
      kind: "command.output",
      subjectKind: "command",
      subjectId: command.id,
      data: {
        stream: "stdout",
        source: "live-stream",
        text: "1 pass\n",
      },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-live-output",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "1 pass\nexit code: 0" }],
        details: {
          stdout: "1 pass\n",
          stderr: "",
          exitCode: 0,
          exitSignal: null,
        },
      },
      isError: false,
    });

    const outputEvents = store
      .getSessionState("session-tool-tracker")
      .events.filter((event) => event.kind === "command.output" && event.subject.id === command.id);
    expect(outputEvents).toEqual([
      expect.objectContaining({
        data: {
          stream: "stdout",
          source: "live-stream",
          text: "1 pass\n",
        },
      }),
    ]);
  });

  it("does not add final-result text when intercepted commands already recorded live output", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-live-svvyx",
      toolName: "exec_command",
      args: { cmd: "svvyx workflows list --json" },
    });
    const command = store.getSessionState("session-tool-tracker").commands[0]!;
    store.recordLifecycleEvent({
      sessionId: "session-tool-tracker",
      kind: "command.output",
      subjectKind: "command",
      subjectId: command.id,
      data: {
        stream: "stdout",
        source: "live-stream",
        text: '{\n  "items": []\n}',
      },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-live-svvyx",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: '{\n  "items": []\n}' }],
        details: {
          items: [],
          commandFacts: {
            workflowExportCount: 0,
          },
        },
      },
      isError: false,
    });

    const outputEvents = store
      .getSessionState("session-tool-tracker")
      .events.filter((event) => event.kind === "command.output" && event.subject.id === command.id);
    expect(outputEvents).toEqual([
      expect.objectContaining({
        data: {
          stream: "stdout",
          source: "live-stream",
          text: '{\n  "items": []\n}',
        },
      }),
    ]);
  });

  it("emits Smithers app logs for shell-routed Smithers command failures", () => {
    const store = createStore();
    const appLogEvents: AppLoggerEvent[] = [];
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
      onAppLog: (event) => appLogEvents.push(event),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-smithers-failed",
      toolName: "exec_command",
      args: { cmd: "bunx smithers-orchestrator inspect run-missing" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-smithers-failed",
      toolName: "exec_command",
      result: {
        content: [{ type: "text", text: "run not found" }],
      },
      isError: true,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands[0]).toMatchObject({
      toolName: "exec_command",
      status: "failed",
      error: "run not found",
    });
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "warning",
        source: "smithers",
        message: "Smithers CLI command failed.",
        details: expect.objectContaining({
          workspaceSessionId: "session-tool-tracker",
          surfacePiSessionId: "session-tool-tracker",
          commandId: snapshot.commands[0]!.id,
          toolName: "exec_command",
          errorMessage: "run not found",
        }),
      }),
    );
  });

  it("records command facts from failed svvyx exec_command error payloads", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-svvyx-workflows-failed",
      toolName: "exec_command",
      args: { cmd: "svvyx workflows build --json" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-svvyx-workflows-failed",
      toolName: "exec_command",
      result: new Error(
        JSON.stringify({
          error: {
            code: "build_failed",
            message: "Workflows build failed.",
          },
          commandFacts: {
            svvyxDispatch: true,
            extensionId: "workflows",
            extensionArgv: ["build", "--json"],
            workflowCommand: "build",
            workflowBuildOk: false,
            errorCode: "build_failed",
            workflowDiagnosticCount: 2,
          },
        }),
      ),
      isError: true,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands[0]).toMatchObject({
      toolName: "exec_command",
      status: "failed",
      facts: {
        svvyxDispatch: true,
        extensionId: "workflows",
        extensionArgv: ["build", "--json"],
        workflowCommand: "build",
        workflowBuildOk: false,
        errorCode: "build_failed",
        workflowDiagnosticCount: 2,
      },
    });
  });

  it("marks structured svvyx ok:false exec_command results as failed command records", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-svvyx-runtime-failed",
      toolName: "exec_command",
      args: { cmd: "svvyx user-extension run command --json" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-svvyx-runtime-failed",
      toolName: "exec_command",
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: {
                code: "runtime_not_ready",
                message: "Extension runtime is not ready.",
              },
            }),
          },
        ],
        details: {
          ok: false,
          error: {
            code: "runtime_not_ready",
            message: "Extension runtime is not ready.",
          },
          commandFacts: {
            svvyxDispatch: true,
            extensionId: "user-extension",
            runtimeReady: false,
            errorCode: "runtime_not_ready",
          },
        },
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands[0]).toMatchObject({
      toolName: "exec_command",
      status: "failed",
      error: JSON.stringify({
        ok: false,
        error: {
          code: "runtime_not_ready",
          message: "Extension runtime is not ready.",
        },
      }),
      facts: {
        svvyxDispatch: true,
        extensionId: "user-extension",
        runtimeReady: false,
        errorCode: "runtime_not_ready",
      },
    });
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        kind: "command.output",
        subject: {
          kind: "command",
          id: snapshot.commands[0]!.id,
        },
        data: {
          stream: "stdout",
          source: "final-result",
          text: JSON.stringify({
            ok: false,
            error: {
              code: "runtime_not_ready",
              message: "Extension runtime is not ready.",
            },
          }),
        },
      }),
    );
  });

  it("does not normalize removed bash tool calls into exec_command", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    tracker.handleToolExecutionStart({
      toolCallId: "tool-call-old-bash",
      toolName: "bash",
      args: { command: "git status --short" },
    });
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-call-old-bash",
      toolName: "bash",
      result: {
        content: [{ type: "text", text: "legacy command surface" }],
      },
      isError: false,
    });

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toEqual([]);
    expect(snapshot.turns[0]?.turnDecision).toBe("pending");
  });

  it("ignores native control tools that already own structured command writes", () => {
    const store = createStore();
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
    });

    const toolNames = nativeToolCommandMetadata
      .filter((metadata) => metadata.executionCommand === "self-recorded-command")
      .map((metadata) => metadata.toolName);

    expect(toolNames).toContain("execute_typescript");
    expect(toolNames).toContain("thread_start");

    for (const toolName of toolNames) {
      tracker.handleToolExecutionStart({
        toolCallId: `tool-call-${toolName}`,
        toolName,
        args: { objective: "Inspect the workspace" },
      });
      tracker.handleToolExecutionEnd({
        toolCallId: `tool-call-${toolName}`,
        toolName,
        result: {
          content: [{ type: "text", text: '{"threadId":"thread-2"}' }],
        },
        isError: false,
      });
    }

    const snapshot = store.getSessionState("session-tool-tracker");
    expect(snapshot.commands).toHaveLength(0);
  });

  it("ignores execute_typescript because the runtime records its own parent and child commands", () => {
    const store = createStore();
    const tracker = createTracker(store, {
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

  it("does not mark dangling commands for unregistered native tools", () => {
    const store = createStore();
    const appLogEvents: AppLoggerEvent[] = [];
    const tracker = createTracker(store, {
      promptContext: createPromptContext(store),
      onAppLog: (event) => appLogEvents.push(event),
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
    expect(snapshot.commands).toEqual([]);
    expect(appLogEvents).toEqual([]);
  });
});
