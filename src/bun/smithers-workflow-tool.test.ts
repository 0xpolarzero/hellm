import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import * as realSmithersWorkflowBridge from "./smithers-workflow-bridge";

const actualSmithersWorkflowBridge = { ...realSmithersWorkflowBridge };

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
  mock.module("./smithers-workflow-bridge", () => actualSmithersWorkflowBridge);
  mock.restore();
  mock.clearAllMocks();
});

function createStore() {
  const store = createStructuredSessionStateStore({
    workspace: WORKSPACE,
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

function createRuntime(store: StructuredSessionStateStore): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: "session-smithers-tool",
    requestSummary: "Delegate the implement-feature workflow.",
  });
  const rootThread = store.createThread({
    turnId: turn.id,
    kind: "task",
    title: "Delegate the implement-feature workflow.",
    objective: "Use workflow.start from the prompt execution context.",
  });

  return {
    current: {
      sessionId: "session-smithers-tool",
      turnId: turn.id,
      rootThreadId: rootThread.id,
      promptText: "Delegate the implement-feature workflow.",
      rootEpisodeKind: "change",
      sessionWaitApplied: false,
    },
  };
}

async function importToolModule() {
  return await import("./smithers-workflow-tool");
}

describe("smithers workflow tool", () => {
  it("requires an active prompt runtime", async () => {
    const { createStartWorkflowTool } = await importToolModule();
    const tool = createStartWorkflowTool({
      runtime: { current: null },
      store: createStore(),
    });

    await expect(
      tool.execute("tool-call-1", {
        specPath: "docs/specs/structured-session-state.spec.md",
        pocPath: "docs/pocs/structured-session-state.poc.ts",
      }),
    ).rejects.toThrow("workflow.start can only run during an active prompt.");
  });

  it("records dependency waiting on the parent thread and promotes the session into wait when the workflow is externally blocked", async () => {
    const startImplementFeatureWorkflow = mock(async () => ({
      runId: "run-123",
      stdout: "workflow started",
      stderr: "",
    }));
    const readSmithersWorkflowProjectionInput = mock(() => ({
      status: "waiting" as const,
      summary: "Need approval before the workflow can continue.",
    }));
    mock.module("./smithers-workflow-bridge", () => ({
      startImplementFeatureWorkflow,
      readSmithersWorkflowProjectionInput,
    }));

    const { createStartWorkflowTool } = await importToolModule();
    const store = createStore();
    const runtime = createRuntime(store);
    const tool = createStartWorkflowTool({
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-2", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });

    expect(startImplementFeatureWorkflow).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      ok: true,
      runId: "run-123",
      status: "waiting",
      summary: "Need approval before the workflow can continue.",
    });

    const snapshot = store.getSessionState("session-smithers-tool");
    const [rootThread, workflowThread] = snapshot.threads;

    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.threads).toHaveLength(2);
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.workflows).toHaveLength(1);
    expect(snapshot.episodes).toHaveLength(0);
    expect(rootThread?.status).toBe("waiting");
    expect(rootThread?.dependsOnThreadIds).toEqual([workflowThread?.id ?? ""]);
    expect(workflowThread?.kind).toBe("workflow");
    expect(workflowThread?.status).toBe("waiting");
    expect(workflowThread?.wait).toMatchObject({
      kind: "external",
      reason: "Need approval before the workflow can continue.",
      resumeWhen: "Resume when the delegated workflow reports new progress.",
    });
    expect(typeof workflowThread?.wait?.since).toBe("string");
    expect(snapshot.session.wait).toMatchObject({
      threadId: workflowThread?.id,
      kind: "external",
      reason: "Need approval before the workflow can continue.",
      resumeWhen: "Resume when the delegated workflow reports new progress.",
    });
    expect(runtime.current?.sessionWaitApplied).toBe(true);
    expect(snapshot.commands[0]?.threadId).toBe(workflowThread?.id);
    expect(snapshot.workflows[0]?.threadId).toBe(workflowThread?.id);
    expect(snapshot.workflows[0]?.status).toBe("waiting");
    expect(
      snapshot.events.filter(
        (event) => event.subject.kind === "thread" && event.subject.id === rootThread?.id,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "thread.created",
      }),
      expect.objectContaining({
        kind: "thread.updated",
        data: {
          status: "waiting",
          dependsOnThreadIds: [workflowThread?.id],
          wait: null,
        },
      }),
    ]);
  });

  it("releases the parent dependency wait when the workflow is already terminal at tool return", async () => {
    const startImplementFeatureWorkflow = mock(async () => ({
      runId: "run-456",
      stdout: "workflow started",
      stderr: "",
    }));
    const readSmithersWorkflowProjectionInput = mock(() => ({
      status: "completed" as const,
      summary: "Workflow completed successfully.",
    }));
    mock.module("./smithers-workflow-bridge", () => ({
      startImplementFeatureWorkflow,
      readSmithersWorkflowProjectionInput,
    }));

    const { createStartWorkflowTool } = await importToolModule();
    const store = createStore();
    const runtime = createRuntime(store);
    const tool = createStartWorkflowTool({
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-3", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });

    expect(result.details).toMatchObject({
      ok: true,
      runId: "run-456",
      status: "completed",
      summary: "Workflow completed successfully.",
    });

    const snapshot = store.getSessionState("session-smithers-tool");
    const [rootThread, workflowThread] = snapshot.threads;

    expect(rootThread?.status).toBe("running");
    expect(rootThread?.dependsOnThreadIds).toEqual([]);
    expect(workflowThread?.status).toBe("completed");
    expect(snapshot.session.wait).toBeNull();
    expect(snapshot.episodes).toEqual([
      expect.objectContaining({
        threadId: workflowThread?.id,
        sourceCommandId: snapshot.commands[0]?.id,
        kind: "workflow",
      }),
    ]);
  });

  it("fails the workflow command cleanly when the Smithers bridge throws", async () => {
    const startImplementFeatureWorkflow = mock(async () => {
      throw new Error("smithers up failed");
    });
    const readSmithersWorkflowProjectionInput = mock(() => null);
    mock.module("./smithers-workflow-bridge", () => ({
      startImplementFeatureWorkflow,
      readSmithersWorkflowProjectionInput,
    }));

    const { createStartWorkflowTool } = await importToolModule();
    const store = createStore();
    const tool = createStartWorkflowTool({
      runtime: createRuntime(store),
      store,
    });

    const result = await tool.execute("tool-call-4", {
      specPath: "docs/specs/structured-session-state.spec.md",
      pocPath: "docs/pocs/structured-session-state.poc.ts",
    });

    expect(startImplementFeatureWorkflow).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      ok: false,
      error: "smithers up failed",
    });

    const snapshot = store.getSessionState("session-smithers-tool");
    const [rootThread] = snapshot.threads;
    expect(snapshot.threads).toHaveLength(2);
    expect(snapshot.commands).toHaveLength(1);
    expect(snapshot.workflows).toHaveLength(0);
    expect(rootThread?.status).toBe("running");
    expect(rootThread?.dependsOnThreadIds).toEqual([]);
    expect(snapshot.threads[1]?.kind).toBe("workflow");
    expect(snapshot.threads[1]?.status).toBe("failed");
    expect(snapshot.commands[0]?.status).toBe("failed");
  });
});
