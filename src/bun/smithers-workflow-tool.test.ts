import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
  type StructuredWaitKind,
  type StructuredWorkflowStatus,
} from "./structured-session-state";
import {
  createResumeWorkflowTool,
  createStartWorkflowTool,
  type WorkflowToolBridge,
} from "./smithers-workflow-tool";
import {
  createPromptExecutionContext,
  type PromptExecutionRuntimeHandle,
} from "./prompt-execution-context";

const stores: StructuredSessionStateStore[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
  mock.restore();
  mock.clearAllMocks();
});

type TestThreadStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";
type TestCommandStatus = "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";

type TestWaitState = {
  kind: StructuredWaitKind;
  reason: string;
  resumeWhen: string;
  since: string;
};

type TestSessionWait = TestWaitState & {
  owner:
    | {
        kind: "thread";
        threadId: string;
      }
    | {
        kind: "orchestrator";
      };
};

type TestTurn = {
  id: string;
  sessionId: string;
  threadId: string | null;
  surfacePiSessionId: string;
  requestSummary: string;
  turnDecision:
    | "pending"
    | "reply"
    | "execute_typescript"
    | "clarify"
    | "thread.start"
    | "workflow.start"
    | "workflow.resume"
    | "handoff";
  status: "running" | "waiting" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type TestThread = {
  id: string;
  sessionId: string;
  turnId: string;
  parentThreadId: string | null;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  status: TestThreadStatus;
  wait: TestWaitState | null;
  latestWorkflowRunId: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type TestCommand = {
  id: string;
  sessionId: string;
  turnId: string;
  surfacePiSessionId: string;
  threadId: string;
  workflowRunId: string | null;
  parentCommandId: string | null;
  toolName: string;
  executor: string;
  visibility: string;
  status: TestCommandStatus;
  attempts: number;
  title: string;
  summary: string;
  facts: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type TestWorkflowRun = {
  id: string;
  sessionId: string;
  threadId: string;
  commandId: string;
  smithersRunId: string;
  workflowName: string;
  status: StructuredWorkflowStatus;
  summary: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type TestArtifact = {
  id: string;
  sessionId: string;
  threadId: string | null;
  workflowRunId: string | null;
  sourceCommandId: string | null;
  kind: string;
  name: string;
  path?: string;
  content?: string;
  createdAt: string;
};

type ToolHarness = {
  store: StructuredSessionStateStore;
  runtime: PromptExecutionRuntimeHandle;
  handlerThreadId: string;
  getSnapshot: () => {
    session: {
      id: string;
      orchestratorPiSessionId: string;
      wait: TestSessionWait | null;
    };
    turns: TestTurn[];
    threads: TestThread[];
    commands: TestCommand[];
    workflowRuns: TestWorkflowRun[];
    episodes: unknown[];
    artifacts: TestArtifact[];
  };
};

function createWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "svvy-smithers-tool-"));
  tempDirs.push(root);
  return root;
}

function createStore(workspaceCwd: string) {
  const store = createStructuredSessionStateStore({
    workspace: {
      id: workspaceCwd,
      label: "svvy",
      cwd: workspaceCwd,
    },
  });
  store.upsertPiSession({
    sessionId: "session-smithers-tool",
    title: "Smithers Tool Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-15T09:30:00.000Z",
    updatedAt: "2026-04-15T09:30:00.000Z",
  });
  stores.push(store);
  return store;
}

function createBridge(overrides?: Partial<WorkflowToolBridge>): WorkflowToolBridge {
  return {
    startImplementFeatureWorkflow:
      overrides?.startImplementFeatureWorkflow ??
      (async () => ({
        runId: "run-default",
        stdout: "workflow started",
        stderr: "",
      })),
    resumeImplementFeatureWorkflow:
      overrides?.resumeImplementFeatureWorkflow ??
      (async ({ runId }) => ({
        runId,
        stdout: "workflow resumed",
        stderr: "",
      })),
    readSmithersWorkflowProjectionInput:
      overrides?.readSmithersWorkflowProjectionInput ??
      (() => ({
        status: "running",
        summary: "Workflow is still running.",
      })),
  };
}

function createHarness(): ToolHarness {
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++counter).padStart(3, "0")}`;
  const nextTimestamp = () => `2026-04-18T09:00:${String(counter).padStart(2, "0")}.000Z`;

  const turns: TestTurn[] = [
    {
      id: "turn-001",
      sessionId: "session-smithers-tool",
      threadId: "thread-handler-001",
      surfacePiSessionId: "pi-thread-smithers-tool",
      requestSummary: "Supervise the Smithers workflow from the handler thread.",
      turnDecision: "pending",
      status: "running",
      startedAt: nextTimestamp(),
      updatedAt: nextTimestamp(),
      finishedAt: null,
    },
  ];
  const threads: TestThread[] = [
    {
      id: "thread-handler-001",
      sessionId: "session-smithers-tool",
      turnId: turns[0]!.id,
      parentThreadId: null,
      surfacePiSessionId: "pi-thread-smithers-tool",
      title: "Supervise delegated workflow",
      objective: "Own the workflow lifecycle from the handler thread.",
      status: "running",
      wait: null,
      latestWorkflowRunId: null,
      startedAt: nextTimestamp(),
      updatedAt: nextTimestamp(),
      finishedAt: null,
    },
  ];
  const commands: TestCommand[] = [];
  const workflowRuns: TestWorkflowRun[] = [];
  const artifacts: TestArtifact[] = [];
  let sessionWait: TestSessionWait | null = null;

  const store = {
    createCommand(input: {
      turnId: string;
      surfacePiSessionId?: string;
      threadId: string;
      workflowRunId?: string | null;
      toolName: string;
      executor: string;
      visibility: string;
      title: string;
      summary: string;
      facts?: Record<string, unknown> | null;
    }) {
      const command: TestCommand = {
        id: nextId("command"),
        sessionId: "session-smithers-tool",
        turnId: input.turnId,
        surfacePiSessionId: input.surfacePiSessionId ?? "pi-thread-smithers-tool",
        threadId: input.threadId,
        workflowRunId: input.workflowRunId ?? null,
        parentCommandId: null,
        toolName: input.toolName,
        executor: input.executor,
        visibility: input.visibility,
        status: "requested",
        attempts: 1,
        title: input.title,
        summary: input.summary,
        facts: input.facts ?? null,
        error: null,
        startedAt: nextTimestamp(),
        updatedAt: nextTimestamp(),
        finishedAt: null,
      };
      commands.push(command);
      return command;
    },
    setTurnDecision(input: {
      turnId: string;
      decision: TestTurn["turnDecision"];
      onlyIfPending?: boolean;
    }) {
      const turn = turns.find((entry) => entry.id === input.turnId);
      if (!turn) {
        throw new Error(`Unknown turn: ${input.turnId}`);
      }
      if (input.onlyIfPending && turn.turnDecision !== "pending") {
        return turn;
      }
      turn.turnDecision = input.decision;
      turn.updatedAt = nextTimestamp();
      return turn;
    },
    startCommand(commandId: string) {
      const command = commands.find((entry) => entry.id === commandId);
      if (!command) {
        throw new Error(`Unknown command: ${commandId}`);
      }
      command.status = "running";
      command.updatedAt = nextTimestamp();
      return command;
    },
    finishCommand(input: {
      commandId: string;
      status: TestCommandStatus;
      summary?: string;
      facts?: Record<string, unknown> | null;
      error?: string | null;
    }) {
      const command = commands.find((entry) => entry.id === input.commandId);
      if (!command) {
        throw new Error(`Unknown command: ${input.commandId}`);
      }
      command.status = input.status;
      command.summary = input.summary ?? command.summary;
      command.facts = input.facts === undefined ? command.facts : input.facts;
      command.error = input.error ?? null;
      command.updatedAt = nextTimestamp();
      command.finishedAt = input.status === "waiting" ? null : nextTimestamp();
      return command;
    },
    updateThread(input: {
      threadId: string;
      status?: TestThreadStatus;
      wait?: TestWaitState | null;
    }) {
      const thread = threads.find((entry) => entry.id === input.threadId);
      if (!thread) {
        throw new Error(`Unknown thread: ${input.threadId}`);
      }
      thread.status = input.status ?? thread.status;
      thread.wait = thread.status === "waiting" ? (input.wait ?? thread.wait) : null;
      thread.updatedAt = nextTimestamp();
      thread.finishedAt =
        thread.status === "completed" || thread.status === "failed" || thread.status === "cancelled"
          ? nextTimestamp()
          : null;
      if (
        thread.status !== "waiting" &&
        sessionWait?.owner.kind === "thread" &&
        sessionWait.owner.threadId === thread.id
      ) {
        sessionWait = null;
      }
      return thread;
    },
    setSessionWait(input: {
      sessionId: string;
      owner: TestSessionWait["owner"];
      kind: StructuredWaitKind;
      reason: string;
      resumeWhen: string;
    }) {
      void input.sessionId;
      const owner = input.owner;
      sessionWait = {
        owner,
        kind: input.kind,
        reason: input.reason,
        resumeWhen: input.resumeWhen,
        since: nextTimestamp(),
      };
      return sessionWait;
    },
    clearSessionWait() {
      sessionWait = null;
    },
    createArtifact(input: {
      threadId?: string | null;
      workflowRunId?: string | null;
      sourceCommandId?: string | null;
      kind: string;
      name: string;
      path?: string;
      content?: string;
    }) {
      const command = input.sourceCommandId
        ? (commands.find((entry) => entry.id === input.sourceCommandId) ?? null)
        : null;
      const workflowRun = input.workflowRunId
        ? (workflowRuns.find((entry) => entry.id === input.workflowRunId) ?? null)
        : null;
      const artifact: TestArtifact = {
        id: nextId("artifact"),
        sessionId: "session-smithers-tool",
        threadId: input.threadId ?? workflowRun?.threadId ?? command?.threadId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        sourceCommandId: input.sourceCommandId ?? null,
        kind: input.kind,
        name: input.name,
        ...(input.path ? { path: input.path } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        createdAt: nextTimestamp(),
      };
      artifacts.push(artifact);
      return artifact;
    },
    recordWorkflow(input: {
      threadId: string;
      commandId: string;
      smithersRunId: string;
      workflowName: string;
      status: StructuredWorkflowStatus;
      summary: string;
    }) {
      const workflowRun: TestWorkflowRun = {
        id: nextId("workflow"),
        sessionId: "session-smithers-tool",
        threadId: input.threadId,
        commandId: input.commandId,
        smithersRunId: input.smithersRunId,
        workflowName: input.workflowName,
        status: input.status,
        summary: input.summary,
        startedAt: nextTimestamp(),
        updatedAt: nextTimestamp(),
        finishedAt:
          input.status === "completed" || input.status === "failed" || input.status === "cancelled"
            ? nextTimestamp()
            : null,
      };
      workflowRuns.push(workflowRun);
      const thread = threads.find((entry) => entry.id === input.threadId);
      if (thread) {
        thread.latestWorkflowRunId = workflowRun.id;
        thread.updatedAt = nextTimestamp();
      }
      return workflowRun;
    },
    updateWorkflow(input: {
      workflowId: string;
      commandId?: string;
      status: StructuredWorkflowStatus;
      summary: string;
    }) {
      const workflowRun = workflowRuns.find((entry) => entry.id === input.workflowId);
      if (!workflowRun) {
        throw new Error(`Unknown workflow run: ${input.workflowId}`);
      }
      workflowRun.commandId = input.commandId ?? workflowRun.commandId;
      workflowRun.status = input.status;
      workflowRun.summary = input.summary;
      workflowRun.updatedAt = nextTimestamp();
      workflowRun.finishedAt =
        input.status === "completed" || input.status === "failed" || input.status === "cancelled"
          ? nextTimestamp()
          : null;
      const thread = threads.find((entry) => entry.id === workflowRun.threadId);
      if (thread) {
        thread.latestWorkflowRunId = workflowRun.id;
        thread.updatedAt = nextTimestamp();
      }
      return workflowRun;
    },
    getSessionState() {
      return {
        workspace: {
          id: "/repo/svvy",
          label: "svvy",
          cwd: "/repo/svvy",
          artifactDir: "/repo/svvy/.artifacts",
        },
        pi: {
          sessionId: "session-smithers-tool",
          title: "Smithers Tool Session",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "high",
          messageCount: 1,
          status: "running",
          createdAt: "2026-04-18T09:00:00.000Z",
          updatedAt: nextTimestamp(),
        },
        session: {
          id: "session-smithers-tool",
          orchestratorPiSessionId: "session-smithers-tool",
          wait: sessionWait,
        },
        turns: turns.map((entry) => ({ ...entry })),
        threads: threads.map((entry) => ({ ...entry })),
        commands: commands.map((entry) => ({ ...entry })),
        episodes: [],
        verifications: [],
        workflowRuns: workflowRuns.map((entry) => ({ ...entry })),
        artifacts: artifacts.map((entry) => ({ ...entry })),
        events: [],
      };
    },
    close() {},
  } as unknown as StructuredSessionStateStore;

  return {
    store,
    runtime: {
      current: createPromptExecutionContext({
        sessionId: "session-smithers-tool",
        turnId: turns[0]!.id,
        surfacePiSessionId: "pi-thread-smithers-tool",
        surfaceThreadId: threads[0]!.id,
        surfaceKind: "handler",
        promptText: "Delegate the implement-feature workflow.",
        defaultEpisodeKind: "change",
      }),
    },
    handlerThreadId: threads[0]!.id,
    getSnapshot: () =>
      store.getSessionState("session-smithers-tool") as ReturnType<ToolHarness["getSnapshot"]>,
  };
}

describe("smithers workflow tool", () => {
  it("requires an active prompt runtime", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const tool = createStartWorkflowTool({
      runtime: { current: null },
      store: createStore(workspaceCwd),
    });

    await expect(
      tool.execute("tool-call-1", {
        specPath: "docs/specs/structured-session-state.spec.md",
        pocPath: "docs/pocs/structured-session-state.poc.ts",
      }),
    ).rejects.toThrow("workflow.start can only run during an active prompt.");
  });

  it("does not poll for an initial Smithers projection and falls back to a running workflow", async () => {
    const readSmithersWorkflowProjectionInput = mock(() => null);
    const bridge = createBridge({
      startImplementFeatureWorkflow: mock(async () => ({
        runId: "run-no-projection",
        stdout: "workflow started",
        stderr: "",
      })),
      readSmithersWorkflowProjectionInput,
    });
    const harness = createHarness();
    const tool = createStartWorkflowTool({
      runtime: harness.runtime,
      store: harness.store,
      bridge,
    });

    const result = await tool.execute("tool-call-no-projection", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });

    expect(readSmithersWorkflowProjectionInput).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      ok: true,
      resumed: false,
      runId: "run-no-projection",
      handlerThreadId: harness.handlerThreadId,
      status: "running",
      summary: "implement-feature run run-no-projection started.",
      sessionWaitApplied: false,
      persisted: true,
    });

    const snapshot = harness.getSnapshot();
    expect(snapshot.workflowRuns).toEqual([
      expect.objectContaining({
        threadId: harness.handlerThreadId,
        smithersRunId: "run-no-projection",
        status: "running",
        summary: "implement-feature run run-no-projection started.",
      }),
    ]);
    expect(snapshot.threads[0]).toMatchObject({
      id: harness.handlerThreadId,
      status: "running",
      wait: null,
      latestWorkflowRunId: snapshot.workflowRuns[0]?.id,
    });
    expect(snapshot.session.wait).toBeNull();
  });

  it("records workflow.start directly on the handler thread and applies handler-owned wait", async () => {
    const bridge = createBridge({
      startImplementFeatureWorkflow: mock(async () => ({
        runId: "run-123",
        stdout: "workflow started",
        stderr: "",
      })),
      readSmithersWorkflowProjectionInput: mock(() => ({
        status: "waiting" as const,
        summary: "Need approval before the workflow can continue.",
      })),
    });
    const harness = createHarness();
    const tool = createStartWorkflowTool({
      runtime: harness.runtime,
      store: harness.store,
      bridge,
    });

    const result = await tool.execute("tool-call-2", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });

    expect(bridge.startImplementFeatureWorkflow).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      ok: true,
      resumed: false,
      runId: "run-123",
      handlerThreadId: harness.handlerThreadId,
      status: "waiting",
      summary: "Need approval before the workflow can continue.",
      sessionWaitApplied: true,
      persisted: true,
    });
    expect(harness.runtime.current?.sessionWaitApplied).toBe(true);

    const snapshot = harness.getSnapshot();
    expect(snapshot.turns[0]?.turnDecision).toBe("workflow.start");
    expect(snapshot.threads).toHaveLength(1);
    expect("kind" in snapshot.threads[0]!).toBe(false);
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "workflow.start",
        threadId: harness.handlerThreadId,
        status: "succeeded",
      }),
    ]);
    expect(snapshot.workflowRuns).toEqual([
      expect.objectContaining({
        threadId: harness.handlerThreadId,
        smithersRunId: "run-123",
        status: "waiting",
      }),
    ]);
    expect(snapshot.threads[0]).toMatchObject({
      id: harness.handlerThreadId,
      status: "waiting",
      latestWorkflowRunId: snapshot.workflowRuns[0]?.id,
      wait: {
        kind: "external",
        reason: "Need approval before the workflow can continue.",
      },
    });
    expect(snapshot.session.wait).toMatchObject({
      owner: { kind: "thread", threadId: harness.handlerThreadId },
      kind: "external",
      reason: "Need approval before the workflow can continue.",
    });
    expect(snapshot.episodes).toHaveLength(0);
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        threadId: harness.handlerThreadId,
        workflowRunId: snapshot.workflowRuns[0]?.id,
        sourceCommandId: snapshot.commands[0]?.id,
      }),
      expect.objectContaining({
        threadId: harness.handlerThreadId,
        workflowRunId: snapshot.workflowRuns[0]?.id,
        sourceCommandId: snapshot.commands[0]?.id,
      }),
    ]);
  });

  it("keeps the handler thread running when a workflow run is terminal and does not emit a workflow episode", async () => {
    const bridge = createBridge({
      startImplementFeatureWorkflow: mock(async () => ({
        runId: "run-456",
        stdout: "workflow started",
        stderr: "",
      })),
      readSmithersWorkflowProjectionInput: mock(() => ({
        status: "completed" as const,
        summary: "Workflow completed successfully.",
      })),
    });
    const harness = createHarness();
    const tool = createStartWorkflowTool({
      runtime: harness.runtime,
      store: harness.store,
      bridge,
    });

    const result = await tool.execute("tool-call-3", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });

    expect(result.details).toMatchObject({
      ok: true,
      resumed: false,
      runId: "run-456",
      handlerThreadId: harness.handlerThreadId,
      status: "completed",
      summary: "Workflow completed successfully.",
      sessionWaitApplied: false,
      persisted: true,
    });

    const snapshot = harness.getSnapshot();
    expect(snapshot.turns[0]?.turnDecision).toBe("workflow.start");
    expect(snapshot.threads[0]).toMatchObject({
      status: "running",
      wait: null,
      latestWorkflowRunId: snapshot.workflowRuns[0]?.id,
    });
    expect(snapshot.workflowRuns[0]).toMatchObject({
      threadId: harness.handlerThreadId,
      status: "completed",
    });
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.episodes).toHaveLength(0);
  });

  it("workflow.resume updates the matching handler-owned workflow run instead of creating a child-thread replacement", async () => {
    const harness = createHarness();
    const startTool = createStartWorkflowTool({
      runtime: harness.runtime,
      store: harness.store,
      bridge: createBridge({
        startImplementFeatureWorkflow: mock(async () => ({
          runId: "run-789",
          stdout: "workflow started",
          stderr: "",
        })),
        readSmithersWorkflowProjectionInput: mock(() => ({
          status: "waiting" as const,
          summary: "Need clarification before continuing.",
        })),
      }),
    });

    const first = await startTool.execute("tool-call-4", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });

    const resumeTool = createResumeWorkflowTool({
      runtime: harness.runtime,
      store: harness.store,
      bridge: createBridge({
        resumeImplementFeatureWorkflow: mock(async ({ runId }) => ({
          runId,
          stdout: "workflow resumed",
          stderr: "",
        })),
        readSmithersWorkflowProjectionInput: mock(() => ({
          status: "completed" as const,
          summary: "Workflow resumed and completed successfully.",
        })),
      }),
    });

    const resumed = await resumeTool.execute("tool-call-5", {
      runId: "run-789",
    });

    expect(resumed.details).toMatchObject({
      ok: true,
      resumed: true,
      runId: "run-789",
      handlerThreadId: harness.handlerThreadId,
      workflowRunId: first.details.workflowRunId,
      workflowId: first.details.workflowRunId,
      status: "completed",
      summary: "Workflow resumed and completed successfully.",
      persisted: true,
    });

    const snapshot = harness.getSnapshot();
    expect(snapshot.turns[0]?.turnDecision).toBe("workflow.start");
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.workflowRuns).toHaveLength(1);
    expect(snapshot.workflowRuns[0]).toMatchObject({
      id: first.details.workflowRunId,
      threadId: harness.handlerThreadId,
      commandId: snapshot.commands[1]?.id,
      smithersRunId: "run-789",
      status: "completed",
      summary: "Workflow resumed and completed successfully.",
    });
    expect(snapshot.commands).toHaveLength(2);
    expect(snapshot.commands.every((command) => command.threadId === harness.handlerThreadId)).toBe(
      true,
    );
    expect(snapshot.threads[0]?.latestWorkflowRunId).toBe(snapshot.workflowRuns[0]?.id);
    expect(snapshot.threads[0]?.status).toBe("running");
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.episodes).toHaveLength(0);
  });

  it("supports multiple workflow runs over time on the same handler thread", async () => {
    const harness = createHarness();
    const tool = createStartWorkflowTool({
      runtime: harness.runtime,
      store: harness.store,
      bridge: createBridge({
        startImplementFeatureWorkflow: mock(async () => ({
          runId: `run-${harness.getSnapshot().workflowRuns.length + 1}`,
          stdout: "workflow started",
          stderr: "",
        })),
        readSmithersWorkflowProjectionInput: mock(() => ({
          status: "completed" as const,
          summary: "Workflow completed successfully.",
        })),
      }),
    });

    await tool.execute("tool-call-6", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });
    await tool.execute("tool-call-7", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });

    const snapshot = harness.getSnapshot();
    expect(snapshot.workflowRuns.map((workflowRun) => workflowRun.smithersRunId)).toEqual([
      "run-1",
      "run-2",
    ]);
    expect(
      snapshot.workflowRuns.every(
        (workflowRun) => workflowRun.threadId === harness.handlerThreadId,
      ),
    ).toBe(true);
    expect(snapshot.threads[0]?.latestWorkflowRunId).toBe(snapshot.workflowRuns[1]?.id);
    expect(snapshot.episodes).toHaveLength(0);
  });
});
