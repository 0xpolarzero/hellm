import { afterEach, describe, expect, it, mock, setDefaultTimeout, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import React from "react";
import * as PiCodingAgent from "@mariozechner/pi-coding-agent";
import { createStructuredSessionStateStore } from "../structured-session-state";
import { SmithersRuntimeManager } from "./manager";
import type { BundledWorkflowDefinition } from "./registry";
import { readSmithersWorkflowInput, smithersRuntimeInputSchema } from "./runtime-input";
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod";

const tempDirs: string[] = [];
const stores: Array<ReturnType<typeof createStructuredSessionStateStore>> = [];
const managers: SmithersRuntimeManager[] = [];

setDefaultTimeout(30_000);

afterEach(async () => {
  while (managers.length > 0) {
    await managers.pop()?.close();
  }
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

function createWorkspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), "svvy-smithers-runtime-"));
  tempDirs.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, ".smithers", "executions"), { recursive: true });
  const databasePath = join(root, "structured-session-state.sqlite");
  const store = createStructuredSessionStateStore({
    workspace: {
      id: cwd,
      label: "svvy",
      cwd,
    },
    databasePath,
  });
  stores.push(store);

  const sessionId = "session-smithers-runtime";
  store.upsertPiSession({
    sessionId,
    title: "Smithers Runtime Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-20T08:00:00.000Z",
    updatedAt: "2026-04-20T08:00:00.000Z",
  });

  const seedTurn = store.startTurn({
    sessionId,
    surfacePiSessionId: sessionId,
    requestSummary: "Open a handler thread for workflow supervision",
  });
  const handlerThread = store.createThread({
    turnId: seedTurn.id,
    surfacePiSessionId: "pi-thread-smithers-runtime",
    title: "Workflow supervisor",
    objective: "Supervise bundled Smithers workflows.",
  });
  store.finishTurn({
    turnId: seedTurn.id,
    status: "completed",
  });

  const structuredStateChanges: string[] = [];
  const handlerAttentions: Array<{
    sessionId: string;
    threadId: string;
    workflowRunId: string;
    smithersRunId: string;
    workflowId: string;
    summary: string;
    reason: string;
  }> = [];
  const manager = new SmithersRuntimeManager({
    cwd,
    agentDir,
    store,
    getTaskAgentDefaults: () => ({
      provider: "openai",
      model: "gpt-5.4",
      thinkingLevel: "medium",
    }),
    onStructuredStateChanged: async (nextSessionId) => {
      structuredStateChanges.push(nextSessionId);
    },
    onHandlerAttention: async (event) => {
      handlerAttentions.push(event);
    },
  });
  managers.push(manager);

  return {
    cwd,
    agentDir,
    store,
    manager,
    sessionId,
    threadId: handlerThread.id,
    surfacePiSessionId: handlerThread.surfacePiSessionId,
    structuredStateChanges,
    handlerAttentions,
  };
}

async function waitFor(
  description: string,
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await Bun.sleep(25);
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

function smithersDbPath(cwd: string): string {
  return join(cwd, ".svvy", "smithers-runtime", "smithers.db");
}

function taskAgentArtifactDir(cwd: string): string {
  return join(cwd, ".svvy", "smithers-runtime", "artifacts", "task-agent");
}

function smithersLogPath(cwd: string, runId: string): string {
  return join(cwd, ".smithers", "executions", runId, "logs", "stream.ndjson");
}

function fileContains(path: string, needle: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, "utf8").includes(needle);
  } catch {
    return false;
  }
}

function registerWorkflow(
  manager: SmithersRuntimeManager,
  definition: BundledWorkflowDefinition,
): void {
  const registry = (manager as unknown as { registry: BundledWorkflowDefinition[] }).registry;
  const workflowsById = (
    manager as unknown as { workflowsById: Map<string, BundledWorkflowDefinition> }
  ).workflowsById;
  registry.push(definition);
  workflowsById.set(definition.id, definition);
}

function latestEntry<T>(entries: T[] | undefined): T | null {
  return entries && entries.length > 0 ? (entries[entries.length - 1] ?? null) : null;
}

type ApprovalDecision = {
  approved: boolean;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

function createWorkflowCommand(input: {
  store: ReturnType<typeof createStructuredSessionStateStore>;
  sessionId: string;
  threadId: string;
  surfacePiSessionId: string;
  requestSummary: string;
  title: string;
  summary: string;
}): { turnId: string; commandId: string } {
  const turn = input.store.startTurn({
    sessionId: input.sessionId,
    surfacePiSessionId: input.surfacePiSessionId,
    threadId: input.threadId,
    requestSummary: input.requestSummary,
  });
  const command = input.store.createCommand({
    turnId: turn.id,
    surfacePiSessionId: input.surfacePiSessionId,
    threadId: input.threadId,
    toolName: "smithers.run_workflow",
    executor: "smithers",
    visibility: "surface",
    title: input.title,
    summary: input.summary,
  });
  input.store.startCommand(command.id);
  return {
    turnId: turn.id,
    commandId: command.id,
  };
}

function createApprovalWorkflowDefinition(dbPath: string): BundledWorkflowDefinition {
  const inputSchema = z.object({
    title: z.string().min(1).default("Approve release?"),
  });
  const smithersApi = createSmithers(
    {
      input: smithersRuntimeInputSchema,
      approval: z.object({
        approved: z.boolean(),
        note: z.string().nullable(),
        decidedBy: z.string().nullable(),
        decidedAt: z.string().nullable(),
      }),
      approvalResult: z.object({
        approved: z.boolean(),
        note: z.string().nullable(),
      }),
    },
    { dbPath },
  );

  return {
    id: "approval_gate",
    label: "Approval Gate",
    description: "Waits for an approval decision and finishes after the run is resumed.",
    workflowName: "svvy-approval-gate",
    inputSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readSmithersWorkflowInput(inputSchema, ctx.input);
      const decision = latestEntry<ApprovalDecision>(ctx.outputs.approval);
      return React.createElement(
        smithersApi.Workflow,
        { name: "svvy-approval-gate" },
        React.createElement(
          smithersApi.Sequence,
          null,
          React.createElement(smithersApi.Approval, {
            id: "publish-gate",
            output: smithersApi.outputs.approval,
            request: {
              title: workflowInput.title,
              summary: "The workflow is blocked on explicit handler approval.",
            },
            onDeny: "continue",
          }),
          decision
            ? React.createElement(smithersApi.Task, {
                id: "record-decision",
                output: smithersApi.outputs.approvalResult,
                children: {
                  approved: Boolean(decision.approved),
                  note: decision.note ?? null,
                },
              })
            : null,
        ),
      );
    }),
  };
}

function createContinueAsNewWorkflowDefinition(dbPath: string): BundledWorkflowDefinition {
  const inputSchema = z.object({}).passthrough();
  const smithersApi = createSmithers(
    {
      input: smithersRuntimeInputSchema,
      continueResult: z.object({
        cursor: z.string().nullable(),
        seenPayload: z.boolean(),
      }),
    },
    { dbPath },
  );

  return {
    id: "continue_once",
    label: "Continue Once",
    description: "Continues as new exactly once and then produces a result.",
    workflowName: "svvy-continue-once",
    inputSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readSmithersWorkflowInput(inputSchema, ctx.input);
      const continuation = getSmithersContinuation(workflowInput.__smithersContinuation);
      const shouldContinue = !continuation?.payload;

      return React.createElement(
        smithersApi.Workflow,
        { name: "svvy-continue-once" },
        React.createElement(
          smithersApi.Sequence,
          null,
          shouldContinue
            ? React.createElement(smithersApi.ContinueAsNew, {
                state: { cursor: "cursor-after-continue" },
              })
            : null,
          React.createElement(smithersApi.Task, {
            id: "result",
            output: smithersApi.outputs.continueResult,
            children: {
              cursor: continuation?.payload?.cursor ?? null,
              seenPayload: Boolean(continuation?.payload),
            },
          }),
        ),
      );
    }),
  };
}

function getSmithersContinuation(value: unknown): { payload?: { cursor?: string } } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as { payload?: { cursor?: string } };
}

describe("SmithersRuntimeManager", () => {
  it("runs the bundled hello_world workflow through the real Smithers runtime and projects completion back to the handler thread", async () => {
    const {
      cwd,
      store,
      manager,
      sessionId,
      threadId,
      surfacePiSessionId,
      structuredStateChanges,
      handlerAttentions,
    } = createWorkspaceFixture();

    expect(manager.listWorkflows().map((workflow) => workflow.id)).toEqual(
      expect.arrayContaining(["hello_world", "execute_typescript_task"]),
    );

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch hello world",
      title: "Run hello_world",
      summary: "Launch the hello_world workflow.",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "hello_world",
      input: { message: "bonjour smithers" },
      commandId: launchCommand.commandId,
    });

    expect(launched).toMatchObject({
      workflowId: "hello_world",
      status: "running",
      smithersStatus: "running",
    });
    expect(launched.runId).toMatch(/^smithers-/);
    expect(existsSync(smithersDbPath(cwd))).toBe(true);
    expect(
      store.getSessionState(sessionId).threads.find((thread) => thread.id === threadId)?.status,
    ).toBe("running-workflow");

    await waitFor("hello_world completion", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "finished";
      } catch {
        return false;
      }
    });
    await waitFor("hello_world handler attention", () =>
      handlerAttentions.some((event) =>
        event.reason.includes("finished and the handler must reconcile"),
      ),
    );

    const snapshot = store.getSessionState(sessionId);
    const workflowRun = snapshot.workflowRuns.find(
      (entry) => entry.smithersRunId === launched.runId,
    );
    expect(workflowRun).toMatchObject({
      threadId,
      workflowName: "svvy-hello-world",
      templateId: "hello_world",
      status: "completed",
      smithersStatus: "finished",
      waitKind: null,
    });
    expect(workflowRun?.summary).toContain("svvy-hello-world is completed");
    expect(snapshot.threads.find((thread) => thread.id === threadId)).toMatchObject({
      id: threadId,
      status: "running-handler",
      wait: null,
    });
    expect(snapshot.session.wait).toBeNull();
    expect(structuredStateChanges).toContain(sessionId);
    expect(
      handlerAttentions.some((event) =>
        event.reason.includes("finished and the handler must reconcile"),
      ),
    ).toBe(true);

    const runs = await manager.listRuns({ workflowId: "hello_world" });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: launched.runId,
      workflowName: "svvy-hello-world",
      status: "finished",
    });

    const run = await manager.getRun(launched.runId);
    expect(run).toMatchObject({
      runId: launched.runId,
      workflowName: "svvy-hello-world",
      status: "finished",
      structuredWorkflowRunId: workflowRun?.id,
      threadId,
      waitKind: null,
    });

    const explanation = await manager.explainRun(launched.runId);
    expect(explanation.explanation).toBe("The workflow finished successfully.");

    const events = await manager.getRunEvents({ runId: launched.runId });
    expect(events.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining(["RunStarted", "RunFinished"]),
    );

    const helloWorldLogPath = smithersLogPath(cwd, launched.runId);
    await waitFor("hello_world execution log", () =>
      fileContains(helloWorldLogPath, '"type":"RunFinished"'),
    );
    expect(readFileSync(helloWorldLogPath, "utf8")).toContain('"type":"RunFinished"');

    const nodeDetail = await manager.getNodeDetail({
      runId: launched.runId,
      nodeId: "result",
    });
    expect(nodeDetail.node.nodeId).toBe("result");
    expect(nodeDetail.node.outputTable).toBeTruthy();
    expect(nodeDetail.attempts.length).toBeGreaterThan(0);

    const artifacts = await manager.listArtifacts({ runId: launched.runId, limit: 10 });
    expect(artifacts.outputs.map((entry: { nodeId: string }) => entry.nodeId)).toEqual(
      expect.arrayContaining(["greeting", "result"]),
    );
  });

  it("treats a replayed terminal workflow projection as a no-op after the handler already handed off", async () => {
    const { store, manager, sessionId, threadId, surfacePiSessionId, handlerAttentions } =
      createWorkspaceFixture();

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch hello world",
      title: "Run hello_world",
      summary: "Launch the hello_world workflow.",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "hello_world",
      input: { message: "bonjour smithers" },
      commandId: launchCommand.commandId,
    });

    await waitFor("hello_world completion", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "finished";
      } catch {
        return false;
      }
    });
    await waitFor("hello_world handler attention", () =>
      handlerAttentions.some((event) =>
        event.reason.includes("finished and the handler must reconcile"),
      ),
    );

    store.updateThread({
      threadId,
      status: "completed",
      wait: null,
    });
    const priorAttentionCount = handlerAttentions.length;

    await (manager as any).flushRunEvents(launched.runId);

    const snapshot = store.getSessionState(sessionId);
    expect(snapshot.threads.find((thread) => thread.id === threadId)).toMatchObject({
      status: "completed",
      wait: null,
    });
    expect(snapshot.session.wait).toBeNull();
    expect(handlerAttentions).toHaveLength(priorAttentionCount);
  });

  it("waits on approval, resumes the same run after approval, and finishes with the real Smithers monitor path", async () => {
    const { cwd, store, manager, sessionId, threadId, surfacePiSessionId, handlerAttentions } =
      createWorkspaceFixture();
    registerWorkflow(manager, createApprovalWorkflowDefinition(smithersDbPath(cwd)));

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch approval workflow",
      title: "Run approval_gate",
      summary: "Launch the approval_gate workflow.",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "approval_gate",
      input: { title: "Approve the release?" },
      commandId: launchCommand.commandId,
    });

    await waitFor("approval wait state", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "waiting-approval";
      } catch {
        return false;
      }
    });

    let snapshot = store.getSessionState(sessionId);
    let workflowRun = snapshot.workflowRuns.find((entry) => entry.smithersRunId === launched.runId);
    expect(workflowRun).toMatchObject({
      status: "waiting",
      smithersStatus: "waiting-approval",
      waitKind: "approval",
    });
    expect(snapshot.threads.find((thread) => thread.id === threadId)).toMatchObject({
      id: threadId,
      status: "waiting",
      wait: expect.objectContaining({
        owner: "workflow",
        kind: "approval",
      }),
    });
    expect(snapshot.session.wait).toMatchObject({
      owner: { kind: "thread", threadId },
      kind: "approval",
    });

    const approvals = await manager.listPendingApprovals({ runId: launched.runId });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      runId: launched.runId,
      nodeId: "publish-gate",
      status: "requested",
    });

    const explanation = await manager.explainRun(launched.runId);
    expect(explanation.explanation).toContain("Waiting for 1 approval request");

    await manager.resolveApproval({
      runId: launched.runId,
      nodeId: "publish-gate",
      decision: "approve",
      note: "Ship it.",
    });

    await waitFor("post-approval run status", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "waiting-event";
      } catch {
        return false;
      }
    });

    const resumeCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Resume approval workflow",
      title: "Resume approval_gate",
      summary: "Resume the approval_gate workflow.",
    });
    const resumed = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "approval_gate",
      input: { title: "Approve the release?" },
      commandId: resumeCommand.commandId,
      runId: launched.runId,
    });

    expect(resumed.structuredWorkflowRunId).toBe(launched.structuredWorkflowRunId);

    await waitFor("approval workflow completion", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "finished";
      } catch {
        return false;
      }
    });
    await waitFor("approval workflow final attention", () =>
      handlerAttentions.some((event) =>
        event.reason.includes("finished and the handler must reconcile"),
      ),
    );

    snapshot = store.getSessionState(sessionId);
    workflowRun = snapshot.workflowRuns.find((entry) => entry.smithersRunId === launched.runId);
    expect(workflowRun).toMatchObject({
      status: "completed",
      smithersStatus: "finished",
      waitKind: null,
    });
    expect(snapshot.threads.find((thread) => thread.id === threadId)).toMatchObject({
      id: threadId,
      status: "running-handler",
      wait: null,
    });
    expect(snapshot.session.wait).toBeNull();

    const run = await manager.getRun(launched.runId);
    expect(run.status).toBe("finished");

    const events = await manager.getRunEvents({ runId: launched.runId });
    expect(events.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining(["ApprovalRequested", "ApprovalGranted", "RunFinished"]),
    );

    const approvalLogPath = smithersLogPath(cwd, launched.runId);
    await waitFor("approval execution log", () =>
      fileContains(approvalLogPath, '"type":"RunFinished"'),
    );
    expect(readFileSync(approvalLogPath, "utf8")).toContain('"type":"RunFinished"');

    const detail = await manager.getNodeDetail({
      runId: launched.runId,
      nodeId: "record-decision",
    });
    expect(detail.node.nodeId).toBe("record-decision");
    expect(detail.node.outputTable).toBeTruthy();
    expect(detail.attempts.length).toBeGreaterThan(0);

    expect(handlerAttentions.some((event) => event.reason.includes("waiting on approval"))).toBe(
      true,
    );
    expect(
      handlerAttentions.some((event) =>
        event.reason.includes("finished and the handler must reconcile"),
      ),
    ).toBe(true);
  });

  it("tracks continue-as-new lineage with parent and descendant structured workflow runs", async () => {
    const { cwd, store, manager, sessionId, threadId, surfacePiSessionId, handlerAttentions } =
      createWorkspaceFixture();
    registerWorkflow(manager, createContinueAsNewWorkflowDefinition(smithersDbPath(cwd)));

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch continue-as-new workflow",
      title: "Run continue_once",
      summary: "Launch the continue_once workflow.",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "continue_once",
      input: {},
      commandId: launchCommand.commandId,
    });

    await waitFor("continued child run and final completion", () => {
      const runs = store
        .getSessionState(sessionId)
        .workflowRuns.filter((entry) => entry.templateId === "continue_once");
      return runs.length === 2 && runs.some((entry) => entry.status === "completed");
    });

    const snapshot = store.getSessionState(sessionId);
    const runs = snapshot.workflowRuns.filter((entry) => entry.templateId === "continue_once");
    expect(runs).toHaveLength(2);
    const parent = runs.find((entry) => entry.status === "continued");
    const child = runs.find((entry) => entry.status === "completed");
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(parent?.activeDescendantRunId).toBe(child?.id);
    expect(child?.continuedFromRunIds).toEqual([parent!.id]);
    expect(snapshot.threads.find((thread) => thread.id === threadId)).toMatchObject({
      id: threadId,
      status: "running-handler",
      wait: null,
    });

    const listed = await manager.listRuns({ workflowId: "continue_once" });
    expect(listed).toHaveLength(2);
    expect(listed.map((entry: { status: string }) => entry.status)).toEqual(
      expect.arrayContaining(["continued", "finished"]),
    );

    const parentEvents = await manager.getRunEvents({ runId: parent!.smithersRunId });
    expect(parentEvents.map((event: { type: string }) => event.type)).toContain(
      "RunContinuedAsNew",
    );
    await waitFor("continue-as-new final attention", () =>
      handlerAttentions.some((event) =>
        event.reason.includes("finished and the handler must reconcile"),
      ),
    );

    const childRun = await manager.getRun(child!.smithersRunId);
    expect(childRun).toMatchObject({
      runId: child!.smithersRunId,
      status: "finished",
      structuredWorkflowRunId: child!.id,
      continuedFromRunIds: [parent!.id],
    });

    const childLogPath = smithersLogPath(cwd, child!.smithersRunId);
    await waitFor("continue-as-new child execution log", () =>
      fileContains(childLogPath, '"type":"RunFinished"'),
    );
    expect(readFileSync(childLogPath, "utf8")).toContain('"type":"RunFinished"');

    expect(
      handlerAttentions.some((event) =>
        event.reason.includes("continued the workflow as a new run"),
      ),
    ).toBe(true);
    expect(
      handlerAttentions.some((event) =>
        event.reason.includes("finished and the handler must reconcile"),
      ),
    ).toBe(true);
    const parentSmithersRunId = parent?.smithersRunId;
    expect(parentSmithersRunId).toBeTruthy();
    expect(launched.runId).toBe(parentSmithersRunId!);
  });

  it("runs the execute_typescript_task workflow through the real task-agent path with execute_typescript as the only product tool", async () => {
    const createAgentSessionSpy = spyOn(PiCodingAgent, "createAgentSession");
    const runCommand = mock(async () => ({
      exitCode: 0,
      stdout: "workflow-validated\n",
      stderr: "",
    }));

    const root = mkdtempSync(join(tmpdir(), "svvy-smithers-runtime-task-agent-"));
    tempDirs.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(cwd, ".smithers", "executions"), { recursive: true });
    const databasePath = join(root, "structured-session-state.sqlite");
    const store = createStructuredSessionStateStore({
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
      },
      databasePath,
    });
    stores.push(store);

    const sessionId = "session-task-agent";
    store.upsertPiSession({
      sessionId,
      title: "Task Agent Session",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-04-20T09:00:00.000Z",
      updatedAt: "2026-04-20T09:00:00.000Z",
    });
    const seedTurn = store.startTurn({
      sessionId,
      surfacePiSessionId: sessionId,
      requestSummary: "Open a workflow task agent thread",
    });
    const handlerThread = store.createThread({
      turnId: seedTurn.id,
      surfacePiSessionId: "pi-thread-task-agent",
      title: "Workflow task agent thread",
      objective: "Run a task-agent workflow.",
    });
    store.finishTurn({
      turnId: seedTurn.id,
      status: "completed",
    });

    const handlerAttentions: string[] = [];
    const manager = new SmithersRuntimeManager({
      cwd,
      agentDir,
      store,
      getTaskAgentDefaults: () => ({
        provider: "openai",
        model: "gpt-5.4",
        thinkingLevel: "medium",
      }),
      onHandlerAttention: async (event) => {
        handlerAttentions.push(event.reason);
      },
      runCommand,
    });
    managers.push(manager);

    createAgentSessionSpy.mockImplementation(async (options: any) => {
      const subscribers = new Set<(event: Record<string, unknown>) => void>();
      const messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [];

      return {
        session: {
          agent: {
            state: {
              messages,
            },
          },
          subscribe(callback: (event: Record<string, unknown>) => void) {
            subscribers.add(callback);
            return () => {
              subscribers.delete(callback);
            };
          },
          async prompt(promptText: string) {
            messages.push({
              role: "user",
              content: [{ type: "text", text: promptText }],
            });

            const executeTypescript = options.customTools.find(
              (tool: { name: string }) => tool.name === "execute_typescript",
            );
            if (!executeTypescript) {
              throw new Error("Expected execute_typescript to be the only custom tool.");
            }

            subscribers.forEach((callback) =>
              callback({
                type: "tool_execution_start",
                toolCallId: "tool-call-workflow-task",
                toolName: "execute_typescript",
              }),
            );

            const toolResult = await executeTypescript.execute(
              "tool-call-workflow-task",
              {
                typescriptCode: [
                  'const validation = await api.exec.run({ command: "echo", args: ["workflow-validated"] });',
                  'await api.repo.writeFile({ path: "workflow-task-output.txt", text: validation.stdout.trim() });',
                  "return {",
                  '  summary: "Completed the workflow task and wrote the output file.",',
                  '  filesChanged: ["workflow-task-output.txt"],',
                  '  validationRan: ["echo workflow-validated"],',
                  "  unresolvedIssues: [],",
                  "};",
                ].join("\n"),
              },
              undefined,
              undefined,
            );

            subscribers.forEach((callback) =>
              callback({
                type: "tool_execution_end",
                toolCallId: "tool-call-workflow-task",
                toolName: "execute_typescript",
                isError: false,
                result: toolResult,
              }),
            );

            const taskResult = (toolResult.details as any).result as {
              summary: string;
              filesChanged: string[];
              validationRan: string[];
              unresolvedIssues: string[];
            };
            messages.push({
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "completed",
                    summary: taskResult.summary,
                    filesChanged: taskResult.filesChanged,
                    validationRan: taskResult.validationRan,
                    unresolvedIssues: taskResult.unresolvedIssues,
                  }),
                },
              ],
            });
          },
          async abort() {},
          dispose() {},
        },
      } as any;
    });

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId: handlerThread.id,
      surfacePiSessionId: handlerThread.surfacePiSessionId,
      requestSummary: "Launch execute_typescript_task",
      title: "Run execute_typescript_task",
      summary: "Launch the execute_typescript_task workflow.",
    });
    try {
      const launched = await manager.launchWorkflow({
        sessionId,
        threadId: handlerThread.id,
        workflowId: "execute_typescript_task",
        input: {
          objective: "Write a file through execute_typescript and report the result.",
          successCriteria: ["Create workflow-task-output.txt with the validation output."],
          validationCommands: ["echo workflow-validated"],
        },
        commandId: launchCommand.commandId,
      });

      await waitFor("workflow task completion", async () => {
        try {
          const run = await manager.getRun(launched.runId);
          return run.status === "finished";
        } catch {
          return false;
        }
      });
      await waitFor("workflow task handler attention", () =>
        handlerAttentions.some((reason) =>
          reason.includes("finished and the handler must reconcile"),
        ),
      );

      const taskAgentLogPath = smithersLogPath(cwd, launched.runId);
      await waitFor("workflow task execution log", () =>
        fileContains(taskAgentLogPath, '"type":"RunFinished"'),
      );
      expect(readFileSync(taskAgentLogPath, "utf8")).toContain('"type":"RunFinished"');

      const outputPath = join(cwd, "workflow-task-output.txt");
      expect(existsSync(outputPath)).toBe(true);
      expect(readFileSync(outputPath, "utf8")).toBe("workflow-validated");
      expect(runCommand).toHaveBeenCalledTimes(1);
      expect(runCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "echo",
          args: ["workflow-validated"],
        }),
      );

      const [createAgentSessionOptions] = createAgentSessionSpy.mock.calls[0] ?? [];
      expect(createAgentSessionOptions?.tools).toEqual([]);
      expect(
        createAgentSessionOptions?.customTools?.map((tool: { name: string }) => tool.name),
      ).toEqual(["execute_typescript"]);

      const snapshot = store.getSessionState(sessionId);
      const workflowRun = snapshot.workflowRuns.find(
        (entry) => entry.smithersRunId === launched.runId,
      );
      expect(workflowRun).toMatchObject({
        workflowName: "svvy-execute-typescript-task",
        templateId: "execute_typescript_task",
        status: "completed",
        smithersStatus: "finished",
      });
      expect(snapshot.threads.find((thread) => thread.id === handlerThread.id)).toMatchObject({
        id: handlerThread.id,
        status: "running-handler",
        wait: null,
      });

      const taskNodeDetail = await manager.getNodeDetail({
        runId: launched.runId,
        nodeId: "task",
      });
      expect(taskNodeDetail.node.nodeId).toBe("task");
      expect(taskNodeDetail.attempts.length).toBeGreaterThan(0);
      expect(taskNodeDetail.node.outputTable).toBeTruthy();

      const artifactFiles = readdirSync(taskAgentArtifactDir(cwd));
      expect(artifactFiles.length).toBeGreaterThan(0);
      expect(
        handlerAttentions.some((reason) =>
          reason.includes("finished and the handler must reconcile"),
        ),
      ).toBe(true);
    } finally {
      createAgentSessionSpy.mockRestore();
    }
  });
});
