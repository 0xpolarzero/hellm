import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import React from "react";
import { z } from "zod";
import {
  createPromptExecutionContext,
  type PromptExecutionRuntimeHandle,
} from "./prompt-execution-context";
import { createSmithersTools } from "./smithers-tools";
import { createStructuredSessionStateStore } from "./structured-session-state";
import { SmithersRuntimeManager } from "./smithers-runtime/manager";
import type { BundledWorkflowDefinition } from "./smithers-runtime/registry";
import {
  bundledWorkflowRuntimeStoredInputSchema,
  readBundledWorkflowLaunchInput,
} from "./smithers-runtime/runtime-input";
import { createSmithers } from "smithers-orchestrator";

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

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "svvy-smithers-tools-"));
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

  const sessionId = "session-smithers-tools";
  store.upsertPiSession({
    sessionId,
    title: "Smithers Tools Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-20T10:00:00.000Z",
  });

  const seedTurn = store.startTurn({
    sessionId,
    surfacePiSessionId: sessionId,
    requestSummary: "Open a handler thread for smithers.* tools",
  });
  const handlerThread = store.createThread({
    turnId: seedTurn.id,
    surfacePiSessionId: "pi-thread-smithers-tools",
    title: "Smithers tools handler",
    objective: "Supervise workflows through smithers.* tools.",
  });
  store.finishTurn({
    turnId: seedTurn.id,
    status: "completed",
  });

  const manager = new SmithersRuntimeManager({
    cwd,
    agentDir,
    store,
    getTaskAgentDefaults: () => ({
      provider: "openai",
      model: "gpt-5.4",
      thinkingLevel: "medium",
    }),
  });
  managers.push(manager);

  const handlerTurn = store.startTurn({
    sessionId,
    surfacePiSessionId: handlerThread.surfacePiSessionId,
    threadId: handlerThread.id,
    requestSummary: "Supervise a workflow with smithers.* tools",
  });
  const runtime: PromptExecutionRuntimeHandle = {
    current: createPromptExecutionContext({
      sessionId,
      turnId: handlerTurn.id,
      surfacePiSessionId: handlerThread.surfacePiSessionId,
      surfaceThreadId: handlerThread.id,
      surfaceKind: "handler",
      promptText: "Supervise a workflow with smithers.* tools",
      rootEpisodeKind: "workflow",
    }),
  };

  return {
    cwd,
    store,
    manager,
    sessionId,
    threadId: handlerThread.id,
    turnId: handlerTurn.id,
    runtime,
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
  manager.upsertBundledWorkflow(definition);
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

function createApprovalWorkflowDefinition(dbPath: string): BundledWorkflowDefinition {
  const launchSchema = z.object({
    title: z.string().min(1).default("Approve release?"),
  });
  const smithersApi = createSmithers(
    {
      input: bundledWorkflowRuntimeStoredInputSchema,
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
    description: "Waits for approval and then records the result.",
    workflowName: "svvy-approval-gate",
    launchSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
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

function getTool(tools: ReturnType<typeof createSmithersTools>, name: string) {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Expected smithers tool ${name} to exist.`);
  }
  return tool as any;
}

describe("smithers.* tools", () => {
  it("launches, inspects, resolves, resumes, and reads a real approval workflow through the handler-thread tool surface", async () => {
    const { cwd, store, manager, runtime, sessionId, threadId, turnId } = createHarness();
    registerWorkflow(manager, createApprovalWorkflowDefinition(smithersDbPath(cwd)));

    const tools = createSmithersTools({
      runtime,
      store,
      manager,
    });

    const listWorkflows = getTool(tools, "smithers.list_workflows");
    const runApprovalWorkflow = getTool(tools, "smithers.run_workflow.approval_gate");
    const listRuns = getTool(tools, "smithers.list_runs");
    const getRun = getTool(tools, "smithers.get_run");
    const listPendingApprovals = getTool(tools, "smithers.list_pending_approvals");
    const resolveApproval = getTool(tools, "smithers.resolve_approval");
    const getNodeDetail = getTool(tools, "smithers.get_node_detail");
    const listArtifacts = getTool(tools, "smithers.list_artifacts");
    const getRunEvents = getTool(tools, "smithers.get_run_events");

    const workflows = await listWorkflows.execute("tool-list-workflows", {});
    expect(workflows.details.workflows.map((entry: { id: string }) => entry.id)).toEqual(
      expect.arrayContaining(["hello_world", "execute_typescript_task", "approval_gate"]),
    );
    expect(workflows.details.workflowToolSurfaceVersion).toBe(
      manager.getWorkflowToolSurfaceVersion(),
    );
    expect(
      workflows.details.workflows.find((entry: { id: string }) => entry.id === "approval_gate"),
    ).toMatchObject({
      launchToolName: "smithers.run_workflow.approval_gate",
      semanticToolName: "smithers.run_workflow",
      resumeRunIdField: "resumeRunId",
      contractHash: expect.any(String),
      launchInputSchema: {
        type: "object",
        properties: {
          title: {
            default: "Approve release?",
            type: "string",
            minLength: 1,
          },
        },
      },
    });

    const launched = await runApprovalWorkflow.execute("tool-run-workflow", {
      title: "Approve the release?",
    });

    expect(launched.details).toMatchObject({
      workflowId: "approval_gate",
      launchToolName: "smithers.run_workflow.approval_gate",
      semanticToolName: "smithers.run_workflow",
      status: "running",
      smithersStatus: "running",
      launchInput: {
        title: "Approve the release?",
      },
    });
    const runId = launched.details.runId as string;

    await waitFor("approval tool wait state", async () => {
      try {
        const run = await manager.getRun(runId);
        return run.status === "waiting-approval";
      } catch {
        return false;
      }
    });

    let snapshot = store.getSessionState(sessionId);
    expect(snapshot.turns.find((entry) => entry.id === turnId)?.turnDecision).toBe(
      "smithers.list_workflows",
    );
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

    const pending = await listPendingApprovals.execute("tool-list-approvals", { runId });
    expect(pending.details.approvals).toHaveLength(1);
    expect(pending.details.approvals[0]).toMatchObject({
      runId,
      nodeId: "publish-gate",
      status: "requested",
    });

    const waitingRun = await getRun.execute("tool-get-run", { runId });
    expect(waitingRun.details).toMatchObject({
      runId,
      workflowName: "svvy-approval-gate",
      status: "waiting-approval",
      waitKind: "approval",
    });

    const approved = await resolveApproval.execute("tool-resolve-approval", {
      runId,
      nodeId: "publish-gate",
      decision: "approve",
      note: "Ship it.",
    });
    expect(approved.details).toMatchObject({
      ok: true,
      decision: "approve",
      runId,
      nodeId: "publish-gate",
    });

    await waitFor("post-approval waiting-event status", async () => {
      try {
        const run = await manager.getRun(runId);
        return run.status === "waiting-event";
      } catch {
        return false;
      }
    });

    const resumed = await runApprovalWorkflow.execute("tool-resume-workflow", {
      title: "Approve the release?",
      resumeRunId: runId,
    });
    expect(resumed.details).toMatchObject({
      workflowId: "approval_gate",
      runId,
      smithersStatus: "running",
    });

    await waitFor("approval tool completion", async () => {
      try {
        const run = await manager.getRun(runId);
        return run.status === "finished";
      } catch {
        return false;
      }
    });

    const runs = await listRuns.execute("tool-list-runs", {
      workflowId: "approval_gate",
    });
    expect(runs.details.runs).toHaveLength(1);
    expect(runs.details.runs[0]).toMatchObject({
      runId,
      workflowName: "svvy-approval-gate",
      status: "finished",
    });

    const completedRun = await getRun.execute("tool-get-run-completed", { runId });
    expect(completedRun.details).toMatchObject({
      runId,
      status: "finished",
      waitKind: null,
    });

    const detail = await getNodeDetail.execute("tool-node-detail", {
      runId,
      nodeId: "record-decision",
    });
    expect(detail.details.node.nodeId).toBe("record-decision");
    expect(detail.details.node.outputTable).toBeTruthy();
    expect(detail.details.attempts.length).toBeGreaterThan(0);

    const artifacts = await listArtifacts.execute("tool-list-artifacts", {
      runId,
      limit: 10,
    });
    expect(artifacts.details.outputs.map((entry: { nodeId: string }) => entry.nodeId)).toEqual(
      expect.arrayContaining(["record-decision"]),
    );

    const events = await getRunEvents.execute("tool-get-run-events", {
      runId,
      limit: 200,
    });
    expect(events.details.events.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining(["ApprovalRequested", "ApprovalGranted", "RunFinished"]),
    );

    const logPath = smithersLogPath(cwd, runId);
    await waitFor("approval workflow execution log", () =>
      fileContains(logPath, '"type":"RunFinished"'),
    );
    expect(readFileSync(logPath, "utf8")).toContain('"type":"RunFinished"');

    snapshot = store.getSessionState(sessionId);
    expect(snapshot.threads.find((thread) => thread.id === threadId)).toMatchObject({
      id: threadId,
      status: "running-handler",
      wait: null,
    });
    expect(snapshot.session.wait).toBeNull();

    const commandToolNames = snapshot.commands.map((command) => command.toolName);
    expect(commandToolNames).toEqual(
      expect.arrayContaining([
        "smithers.list_workflows",
        "smithers.run_workflow.approval_gate",
        "smithers.list_pending_approvals",
        "smithers.get_run",
        "smithers.resolve_approval",
        "smithers.get_node_detail",
        "smithers.list_artifacts",
        "smithers.get_run_events",
        "smithers.list_runs",
      ]),
    );

    const runWorkflowCommands = snapshot.commands.filter(
      (command) => command.toolName === "smithers.run_workflow.approval_gate",
    );
    expect(runWorkflowCommands).toHaveLength(2);
    expect(runWorkflowCommands[0]?.facts).toMatchObject({
      smithersToolName: "smithers.run_workflow.approval_gate",
      semanticSmithersToolName: "smithers.run_workflow",
      launchToolName: "smithers.run_workflow.approval_gate",
      workflowId: "approval_gate",
      launchInput: {
        title: "Approve the release?",
      },
      transport: "bundled-runtime",
      runId,
      postStatus: "running",
    });
    expect(runWorkflowCommands[1]?.facts).toMatchObject({
      smithersToolName: "smithers.run_workflow.approval_gate",
      semanticSmithersToolName: "smithers.run_workflow",
      launchToolName: "smithers.run_workflow.approval_gate",
      workflowId: "approval_gate",
      launchInput: {
        title: "Approve the release?",
      },
      transport: "bundled-runtime",
      runId,
      preStatus: "waiting-event",
      postStatus: "running",
    });

    const resolveApprovalCommand = snapshot.commands.find(
      (command) => command.toolName === "smithers.resolve_approval",
    );
    expect(resolveApprovalCommand?.facts).toMatchObject({
      smithersToolName: "smithers.resolve_approval",
      transport: "bundled-runtime",
      runId,
      nodeId: "publish-gate",
      decision: "approve",
      postStatus: "approval-updated",
    });
  });

  it("generates per-workflow launch tools from the compiled launch contracts and removes the generic launcher", () => {
    const { manager, runtime, store } = createHarness();

    const tools = createSmithersTools({
      runtime,
      store,
      manager,
    });

    expect(tools.find((tool) => tool.name === "smithers.run_workflow")).toBeUndefined();

    const helloWorldTool = getTool(tools, "smithers.run_workflow.hello_world");
    expect(helloWorldTool.parameters).toMatchObject({
      type: "object",
      properties: {
        message: {
          default: "hello world",
          type: "string",
          minLength: 1,
        },
        resumeRunId: {
          type: "string",
          minLength: 1,
        },
      },
      required: [],
      additionalProperties: false,
    });

    const executeTaskTool = getTool(tools, "smithers.run_workflow.execute_typescript_task");
    expect(executeTaskTool.parameters).toMatchObject({
      type: "object",
      properties: {
        objective: {
          type: "string",
          minLength: 1,
        },
        successCriteria: {
          default: [],
          type: "array",
        },
        validationCommands: {
          default: [],
          type: "array",
        },
        resumeRunId: {
          type: "string",
          minLength: 1,
        },
      },
      required: ["objective"],
      additionalProperties: false,
    });
  });
});
