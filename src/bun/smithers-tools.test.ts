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
import { SmithersRuntimeManager, type TestWorkflowDefinition } from "./smithers-runtime/manager";
import {
  bundledWorkflowRuntimeStoredInputSchema,
  readBundledWorkflowLaunchInput,
} from "./smithers-runtime/runtime-input";
import {
  createExecuteTypescriptTaskTestWorkflow,
  createHelloWorldTestWorkflow,
} from "./smithers-runtime/test-workflows";
import { WaitForEvent, createSmithers } from "smithers-orchestrator";

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
  registerWorkflow(manager, createHelloWorldTestWorkflow(smithersDbPath(cwd)));
  registerWorkflow(
    manager,
    createExecuteTypescriptTaskTestWorkflow({
      dbPath: smithersDbPath(cwd),
      cwd,
      agentDir,
      artifactDir: join(cwd, ".svvy", "smithers-runtime", "artifacts", "task-agent"),
      provider: "openai",
      model: "gpt-5.4",
      thinkingLevel: "medium",
    }),
  );

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
  definition: TestWorkflowDefinition,
): void {
  manager.registerTestWorkflow(definition);
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

function createApprovalWorkflowDefinition(dbPath: string): TestWorkflowDefinition {
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
    summary: "Waits for approval and then records the result.",
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

function createSignalWorkflowDefinition(dbPath: string): TestWorkflowDefinition {
  const launchSchema = z.object({
    signalName: z.string().min(1).default("deploy.completed"),
  });
  const signalPayloadSchema = z.object({
    environment: z.string(),
    sha: z.string(),
    status: z.enum(["success", "failure"]),
  });
  const resultSchema = z.object({
    summary: z.string(),
    environment: z.string(),
    status: z.enum(["success", "failure"]),
  });
  const smithersApi = createSmithers(
    {
      input: bundledWorkflowRuntimeStoredInputSchema,
      signalPayload: signalPayloadSchema,
      signalResult: resultSchema,
    },
    { dbPath },
  );

  return {
    id: "wait_for_signal",
    label: "Wait For Signal",
    summary: "Waits on a durable Smithers signal and records the delivered payload.",
    workflowName: "svvy-wait-for-signal",
    launchSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
      const payload = latestEntry<z.infer<typeof signalPayloadSchema>>(ctx.outputs.signalPayload);
      return React.createElement(
        smithersApi.Workflow,
        { name: "svvy-wait-for-signal" },
        React.createElement(
          smithersApi.Sequence,
          null,
          React.createElement(WaitForEvent, {
            id: "wait-signal",
            event: workflowInput.signalName,
            output: smithersApi.outputs.signalPayload,
            outputSchema: signalPayloadSchema,
            label: `wait:${workflowInput.signalName}`,
          }),
          payload
            ? React.createElement(smithersApi.Task, {
                id: "result",
                output: smithersApi.outputs.signalResult,
                children: {
                  summary: `Received ${workflowInput.signalName} for ${payload.environment}.`,
                  environment: payload.environment,
                  status: payload.status,
                },
              })
            : null,
        ),
      );
    }),
  };
}

function createTranscriptWorkflowDefinition(dbPath: string): TestWorkflowDefinition {
  const launchSchema = z.object({
    prompt: z.string().min(1).default("Summarize the latest transcript probe."),
  });
  const transcriptReplySchema = z.object({
    reply: z.string(),
    promptEcho: z.string(),
  });
  const resultSchema = z.object({
    summary: z.string(),
    reply: z.string(),
  });
  const smithersApi = createSmithers(
    {
      input: bundledWorkflowRuntimeStoredInputSchema,
      transcriptReply: transcriptReplySchema,
      transcriptResult: resultSchema,
    },
    { dbPath },
  );
  const transcriptAgent = {
    id: "svvy-deterministic-transcript-agent",
    async generate(rawArgs: unknown) {
      const args = rawArgs as {
        prompt?: string;
        onStdout?: (chunk: string) => void;
        onStepFinish?: (step: {
          response: { messages: Array<{ role: string; content: string }> };
        }) => void;
      };
      const promptText =
        typeof args.prompt === "string" && args.prompt.trim().length > 0
          ? args.prompt.trim()
          : "No prompt provided.";
      const response = {
        reply: `Handled: ${promptText}`,
        promptEcho: promptText,
      };
      const responseText = JSON.stringify(response);
      args.onStdout?.(responseText);
      args.onStepFinish?.({
        response: {
          messages: [{ role: "assistant", content: responseText }],
        },
      });
      return {
        text: responseText,
        output: response,
        response: {
          messages: [{ role: "assistant", content: responseText }],
        },
      };
    },
  };

  return {
    id: "chat_transcript_probe",
    label: "Chat Transcript Probe",
    summary:
      "Runs a deterministic agent task so transcript inspection can read real attempt history.",
    workflowName: "svvy-chat-transcript-probe",
    launchSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
      const reply = latestEntry<z.infer<typeof transcriptReplySchema>>(ctx.outputs.transcriptReply);
      return React.createElement(
        smithersApi.Workflow,
        { name: "svvy-chat-transcript-probe" },
        React.createElement(
          smithersApi.Sequence,
          null,
          React.createElement(
            smithersApi.Task,
            {
              id: "assistant",
              output: smithersApi.outputs.transcriptReply,
              agent: transcriptAgent as any,
            },
            workflowInput.prompt,
          ),
          reply
            ? React.createElement(smithersApi.Task, {
                id: "result",
                output: smithersApi.outputs.transcriptResult,
                children: {
                  summary: `Captured transcript reply for prompt "${reply.promptEcho}".`,
                  reply: reply.reply,
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
      id: "approval_gate",
      sourceScope: "saved",
      entryPath: ".svvy/workflows/entries/approval-gate.tsx",
      launchToolName: "smithers.run_workflow.approval_gate",
      semanticToolName: "smithers.run_workflow",
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
      workflowName: "approval_gate",
      workflowId: "approval_gate",
      workflowSource: "saved",
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
      workflowName: "approval_gate",
      workflowId: "approval_gate",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/approval-gate.tsx",
      status: "finished",
      sessionId,
      threadId,
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
      rawSmithersOperationName: "run_workflow.approval_gate",
      launchToolName: "smithers.run_workflow.approval_gate",
      workflowId: "approval_gate",
      sourceScope: "saved",
      entryPath: ".svvy/workflows/entries/approval-gate.tsx",
      launchInput: {
        title: "Approve the release?",
      },
      transport: "embedded-runtime",
      runId,
      resumedRunId: null,
      postStatus: "running",
    });
    expect(runWorkflowCommands[1]?.facts).toMatchObject({
      smithersToolName: "smithers.run_workflow.approval_gate",
      semanticSmithersToolName: "smithers.run_workflow",
      rawSmithersOperationName: "run_workflow.approval_gate",
      launchToolName: "smithers.run_workflow.approval_gate",
      workflowId: "approval_gate",
      sourceScope: "saved",
      entryPath: ".svvy/workflows/entries/approval-gate.tsx",
      launchInput: {
        title: "Approve the release?",
      },
      transport: "embedded-runtime",
      runId,
      resumedRunId: runId,
      preStatus: null,
      postStatus: "running",
    });

    const resolveApprovalCommand = snapshot.commands.find(
      (command) => command.toolName === "smithers.resolve_approval",
    );
    expect(resolveApprovalCommand?.facts).toMatchObject({
      smithersToolName: "smithers.resolve_approval",
      semanticSmithersToolName: "smithers.resolve_approval",
      rawSmithersOperationName: "resolve_approval",
      transport: "embedded-runtime",
      runId,
      nodeId: "publish-gate",
      decision: "approve",
      postStatus: "approval-updated",
    });
  });

  it("lists workspace-global runs with session and thread ownership so a handler can identify its own workflows", async () => {
    const { store, manager, runtime, sessionId, threadId } = createHarness();

    const tools = createSmithersTools({
      runtime,
      store,
      manager,
    });
    const listRuns = getTool(tools, "smithers.list_runs");
    const runHelloWorld = getTool(tools, "smithers.run_workflow.hello_world");

    const ownLaunch = await runHelloWorld.execute("tool-run-own-hello-world", {
      message: "own run",
    });

    const secondarySessionId = "session-smithers-tools-secondary";
    store.upsertPiSession({
      sessionId: secondarySessionId,
      title: "Secondary Smithers Tools Session",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-04-20T10:05:00.000Z",
      updatedAt: "2026-04-20T10:05:00.000Z",
    });
    const secondarySeedTurn = store.startTurn({
      sessionId: secondarySessionId,
      surfacePiSessionId: secondarySessionId,
      requestSummary: "Open a second handler thread for smithers.* tools",
    });
    const secondaryHandlerThread = store.createThread({
      turnId: secondarySeedTurn.id,
      surfacePiSessionId: "pi-thread-smithers-tools-secondary",
      title: "Secondary Smithers tools handler",
      objective: "Supervise workflows through smithers.* tools from another thread.",
    });
    store.finishTurn({
      turnId: secondarySeedTurn.id,
      status: "completed",
    });

    const secondaryTurn = store.startTurn({
      sessionId: secondarySessionId,
      surfacePiSessionId: secondaryHandlerThread.surfacePiSessionId,
      threadId: secondaryHandlerThread.id,
      requestSummary: "Supervise a second hello world workflow with smithers.* tools",
    });
    const secondaryRuntime: PromptExecutionRuntimeHandle = {
      current: createPromptExecutionContext({
        sessionId: secondarySessionId,
        turnId: secondaryTurn.id,
        surfacePiSessionId: secondaryHandlerThread.surfacePiSessionId,
        surfaceThreadId: secondaryHandlerThread.id,
        surfaceKind: "handler",
        promptText: "Supervise a second hello world workflow with smithers.* tools",
        rootEpisodeKind: "workflow",
      }),
    };
    const secondaryTools = createSmithersTools({
      runtime: secondaryRuntime,
      store,
      manager,
    });
    const foreignRunHelloWorld = getTool(secondaryTools, "smithers.run_workflow.hello_world");
    const foreignLaunch = await foreignRunHelloWorld.execute("tool-run-foreign-hello-world", {
      message: "foreign run",
    });

    await waitFor("hello_world runs finish for list_runs ownership test", async () => {
      try {
        const [ownRun, foreignRun] = await Promise.all([
          manager.getRun(ownLaunch.details.runId as string),
          manager.getRun(foreignLaunch.details.runId as string),
        ]);
        return ownRun.status === "finished" && foreignRun.status === "finished";
      } catch {
        return false;
      }
    });

    const runs = await listRuns.execute("tool-list-runs-ownership", {
      workflowId: "hello_world",
    });
    expect(runs.details.runs).toHaveLength(2);
    expect(runs.details.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: ownLaunch.details.runId,
          workflowName: "hello_world",
          workflowId: "hello_world",
          workflowSource: "saved",
          status: "finished",
          sessionId,
          threadId,
        }),
        expect.objectContaining({
          runId: foreignLaunch.details.runId,
          workflowName: "hello_world",
          workflowId: "hello_world",
          workflowSource: "saved",
          status: "finished",
          sessionId: secondarySessionId,
          threadId: secondaryHandlerThread.id,
        }),
      ]),
    );
  });

  it("delivers signals, diagnoses blockers, and inspects frames plus DevTools through the handler-thread smithers.* surface", async () => {
    const { cwd, store, manager, runtime, sessionId, threadId } = createHarness();
    registerWorkflow(manager, createSignalWorkflowDefinition(smithersDbPath(cwd)));

    const tools = createSmithersTools({
      runtime,
      store,
      manager,
    });

    const runSignalWorkflow = getTool(tools, "smithers.run_workflow.wait_for_signal");
    const getRun = getTool(tools, "smithers.get_run");
    const watchRun = getTool(tools, "smithers.watch_run");
    const explainRun = getTool(tools, "smithers.explain_run");
    const sendSignal = getTool(tools, "smithers.signals.send");
    const listFrames = getTool(tools, "smithers.frames.list");
    const getDevToolsSnapshot = getTool(tools, "smithers.getDevToolsSnapshot");
    const streamDevTools = getTool(tools, "smithers.streamDevTools");
    const getRunEvents = getTool(tools, "smithers.get_run_events");

    const launched = await runSignalWorkflow.execute("tool-run-signal-workflow", {
      signalName: "deploy.completed",
    });
    const runId = launched.details.runId as string;

    await waitFor("signal tool wait state", async () => {
      try {
        const run = await manager.getRun(runId);
        return run.status === "waiting-event" && run.waitKind === "event";
      } catch {
        return false;
      }
    });

    const waitingRun = await getRun.execute("tool-get-signal-run", { runId });
    expect(waitingRun.details).toMatchObject({
      runId,
      status: "waiting-event",
      waitKind: "event",
    });

    const watched = await watchRun.execute("tool-watch-signal-run", {
      runId,
      timeoutMs: 0,
    });
    expect(watched.details).toMatchObject({
      runId,
      reachedTerminal: false,
      timedOut: true,
      finalRun: {
        status: "waiting-event",
        waitKind: "event",
      },
    });

    const diagnosis = await explainRun.execute("tool-explain-signal-run", { runId });
    expect(diagnosis.details.diagnosis).toMatchObject({
      runId,
      status: "waiting-event",
    });
    expect(
      diagnosis.details.diagnosis.blockers.some(
        (blocker: { signalName?: string | null }) => blocker.signalName === "deploy.completed",
      ),
    ).toBe(true);

    const delivered = await sendSignal.execute("tool-send-signal", {
      runId,
      signalName: "deploy.completed",
      data: {
        environment: "production",
        sha: "abc123",
        status: "success",
      },
    });
    expect(delivered.details).toMatchObject({
      ok: true,
      runId,
      signalName: "deploy.completed",
    });

    await runSignalWorkflow.execute("tool-resume-signal-workflow", {
      signalName: "deploy.completed",
    });

    await waitFor("signal tool completion", async () => {
      try {
        const run = await manager.getRun(runId);
        return run.status === "finished";
      } catch {
        return false;
      }
    });

    const frames = await listFrames.execute("tool-list-frames", {
      runId,
      limit: 20,
    });
    expect(frames.details.frames.length).toBeGreaterThan(0);
    expect(frames.details.frames[0]).toMatchObject({
      runId,
      frameNo: expect.any(Number),
      xml: expect.anything(),
    });

    const snapshot = await getDevToolsSnapshot.execute("tool-get-devtools-snapshot", { runId });
    expect(snapshot.details).toMatchObject({
      version: 1,
      runId,
      frameNo: expect.any(Number),
      root: expect.any(Object),
    });

    const stream = await streamDevTools.execute("tool-stream-devtools", {
      runId,
      fromSeq: 0,
      timeoutMs: 150,
      maxEvents: 10,
    });
    expect(stream.details.events.length).toBeGreaterThan(0);
    expect(stream.details.events[0]).toMatchObject({
      kind: "snapshot",
    });

    const filteredEvents = await getRunEvents.execute("tool-get-filtered-events", {
      runId,
      types: ["RunFinished"],
    });
    expect(filteredEvents.details).toMatchObject({
      runId,
    });
    expect(filteredEvents.details.events).toHaveLength(1);
    expect(filteredEvents.details.events[0]).toMatchObject({
      type: "RunFinished",
    });

    const signalLogPath = smithersLogPath(cwd, runId);
    await waitFor("signal workflow execution log", () =>
      fileContains(signalLogPath, '"type":"RunFinished"'),
    );
    expect(readFileSync(signalLogPath, "utf8")).toContain('"type":"RunFinished"');

    const snapshotState = store.getSessionState(sessionId);
    expect(snapshotState.threads.find((thread) => thread.id === threadId)).toMatchObject({
      id: threadId,
      status: "running-handler",
      wait: null,
    });
    expect(snapshotState.session.wait).toBeNull();

    const sendSignalCommand = snapshotState.commands.find(
      (command) => command.toolName === "smithers.signals.send",
    );
    expect(sendSignalCommand?.facts).toMatchObject({
      smithersToolName: "smithers.signals.send",
      semanticSmithersToolName: "smithers.signals.send",
      rawSmithersOperationName: "signals.send",
      transport: "embedded-runtime",
      runId,
      signalName: "deploy.completed",
      preStatus: "waiting-event",
    });
  });

  it("reads a real grouped transcript through smithers.get_chat_transcript", async () => {
    const { cwd, store, manager, runtime } = createHarness();
    registerWorkflow(manager, createTranscriptWorkflowDefinition(smithersDbPath(cwd)));

    const tools = createSmithersTools({
      runtime,
      store,
      manager,
    });

    const runTranscriptWorkflow = getTool(tools, "smithers.run_workflow.chat_transcript_probe");
    const getChatTranscript = getTool(tools, "smithers.get_chat_transcript");

    const launched = await runTranscriptWorkflow.execute("tool-run-transcript-workflow", {
      prompt: "Summarize the transcript probe.",
    });
    const runId = launched.details.runId as string;

    await waitFor("transcript probe completion", async () => {
      try {
        const run = await manager.getRun(runId);
        return run.status === "finished";
      } catch {
        return false;
      }
    });

    const transcript = await getChatTranscript.execute("tool-get-chat-transcript", {
      runId,
      all: true,
    });
    expect(transcript.details.attempts).toHaveLength(1);
    expect(transcript.details.messages.map((message: { role: string }) => message.role)).toEqual(
      expect.arrayContaining(["user", "assistant"]),
    );
    expect(
      transcript.details.messages.some((message: { text: string }) =>
        message.text.includes("Summarize the transcript probe."),
      ),
    ).toBe(true);
    expect(
      transcript.details.messages.some((message: { text: string }) =>
        message.text.includes("Handled:"),
      ),
    ).toBe(true);
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
    expect((helloWorldTool.parameters as Record<string, unknown>).type).toBe("object");
    expect(
      (helloWorldTool.parameters as { properties?: Record<string, unknown> }).properties?.message,
    ).toMatchObject({
      default: "hello world",
      type: "string",
      minLength: 1,
    });
    expect(
      (helloWorldTool.parameters as { properties?: Record<string, unknown> }).properties
        ?.resumeRunId,
    ).toBeUndefined();

    const executeTaskTool = getTool(tools, "smithers.run_workflow.execute_typescript_task");
    expect((executeTaskTool.parameters as Record<string, unknown>).type).toBe("object");
    expect(
      (executeTaskTool.parameters as { properties?: Record<string, unknown> }).properties
        ?.objective,
    ).toMatchObject({
      type: "string",
      minLength: 1,
    });
    expect(
      (executeTaskTool.parameters as { properties?: Record<string, unknown> }).properties
        ?.successCriteria,
    ).toMatchObject({
      default: [],
      type: "array",
    });
    expect(
      (executeTaskTool.parameters as { properties?: Record<string, unknown> }).properties
        ?.validationCommands,
    ).toMatchObject({
      default: [],
      type: "array",
    });
    expect(
      (executeTaskTool.parameters as { properties?: Record<string, unknown> }).properties
        ?.resumeRunId,
    ).toBeUndefined();
  });
});
