import { afterEach, describe, expect, it, mock, setDefaultTimeout, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import React from "react";
import * as PiCodingAgent from "@mariozechner/pi-coding-agent";
import { createStructuredSessionStateStore } from "../structured-session-state";
import { SmithersRuntimeManager } from "./manager";
import type { BundledWorkflowDefinition } from "./registry";
import {
  bundledWorkflowRuntimeStoredInputSchema,
  readBundledWorkflowLaunchInput,
} from "./runtime-input";
import { WaitForEvent, createSmithers } from "smithers-orchestrator";
import { z } from "zod";

const tempDirs: string[] = [];
const stores: Array<ReturnType<typeof createStructuredSessionStateStore>> = [];
const managers: SmithersRuntimeManager[] = [];
type TestStore = ReturnType<typeof createStructuredSessionStateStore>;
type HandlerAttentionEvent = {
  sessionId: string;
  threadId: string;
  workflowRunId: string;
  smithersRunId: string;
  workflowId: string;
  summary: string;
  reason: string;
};

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

function createManagerHarness(input: {
  cwd: string;
  agentDir: string;
  store: TestStore;
  structuredStateChanges: string[];
  handlerAttentions: HandlerAttentionEvent[];
  onHandlerAttention?: (event: HandlerAttentionEvent) => boolean | Promise<boolean>;
}): SmithersRuntimeManager {
  const manager = new SmithersRuntimeManager({
    cwd: input.cwd,
    agentDir: input.agentDir,
    store: input.store,
    getTaskAgentDefaults: () => ({
      provider: "openai",
      model: "gpt-5.4",
      thinkingLevel: "medium",
    }),
    onStructuredStateChanged: async (nextSessionId) => {
      input.structuredStateChanges.push(nextSessionId);
    },
    onHandlerAttention: async (event) => {
      input.handlerAttentions.push(event);
      return (await input.onHandlerAttention?.(event)) ?? false;
    },
  });
  managers.push(manager);
  return manager;
}

function createWorkspaceFixture(options: {
  onHandlerAttention?: (event: HandlerAttentionEvent) => boolean | Promise<boolean>;
} = {}) {
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
  const handlerAttentions: HandlerAttentionEvent[] = [];
  const manager = createManagerHarness({
    cwd,
    agentDir,
    store,
    structuredStateChanges,
    handlerAttentions,
    onHandlerAttention: options.onHandlerAttention,
  });

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

function createWorkflowCommand(input: {
  store: ReturnType<typeof createStructuredSessionStateStore>;
  sessionId: string;
  threadId: string;
  surfacePiSessionId: string;
  requestSummary: string;
  toolName?: `smithers.run_workflow.${string}`;
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
    toolName: input.toolName ?? "smithers.run_workflow.hello_world",
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
    description: "Waits for an approval decision and finishes after the run is resumed.",
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

function createContinueAsNewWorkflowDefinition(dbPath: string): BundledWorkflowDefinition {
  const launchSchema = z.object({}).passthrough();
  const smithersApi = createSmithers(
    {
      input: bundledWorkflowRuntimeStoredInputSchema,
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
    launchSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
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

function createSignalWorkflowDefinition(dbPath: string): BundledWorkflowDefinition {
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
    description: "Waits on a durable Smithers signal and records the delivered payload.",
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

function createTranscriptWorkflowDefinition(dbPath: string): BundledWorkflowDefinition {
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
    description: "Runs a deterministic agent task so transcript inspection can read real attempt history.",
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

describe("SmithersRuntimeManager", () => {
  it("publishes compiled launch contracts with input-side defaults and updates the tool-surface version when workflows change", () => {
    const { cwd, manager } = createWorkspaceFixture();

    const initialVersion = manager.getWorkflowToolSurfaceVersion();
    const helloWorldWorkflow = manager
      .listWorkflows()
      .find((workflow) => workflow.id === "hello_world");

    expect(helloWorldWorkflow).toMatchObject({
      id: "hello_world",
      workflowName: "svvy-hello-world",
      launchToolName: "smithers.run_workflow.hello_world",
      semanticToolName: "smithers.run_workflow",
      resumeRunIdField: "resumeRunId",
      contractHash: expect.any(String),
      launchInputSchema: {
        type: "object",
        properties: {
          message: {
            default: "hello world",
            type: "string",
            minLength: 1,
          },
        },
      },
      launchToolSchema: {
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
      },
    });

    registerWorkflow(manager, createApprovalWorkflowDefinition(smithersDbPath(cwd)));
    const nextVersion = manager.getWorkflowToolSurfaceVersion();

    expect(nextVersion).not.toBe(initialVersion);
    expect(manager.listWorkflows().map((workflow) => workflow.id)).toEqual(
      expect.arrayContaining(["approval_gate"]),
    );
  });

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
      toolName: "smithers.run_workflow.hello_world",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "hello_world",
      launchInput: { message: "bonjour smithers" },
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
      sessionId,
      threadId,
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
    expect(explanation.summary).toContain("finished");
    expect(explanation.diagnosis).toMatchObject({
      runId: launched.runId,
      status: "finished",
    });

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

  it("lists workspace-global runs with svvy session and thread ownership metadata", async () => {
    const {
      manager,
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
    } = createWorkspaceFixture();

    const secondarySessionId = "session-smithers-runtime-secondary";
    store.upsertPiSession({
      sessionId: secondarySessionId,
      title: "Secondary Smithers Runtime Session",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-04-20T08:05:00.000Z",
      updatedAt: "2026-04-20T08:05:00.000Z",
    });
    const secondarySeedTurn = store.startTurn({
      sessionId: secondarySessionId,
      surfacePiSessionId: secondarySessionId,
      requestSummary: "Open a second handler thread for workflow supervision",
    });
    const secondaryHandlerThread = store.createThread({
      turnId: secondarySeedTurn.id,
      surfacePiSessionId: "pi-thread-smithers-runtime-secondary",
      title: "Secondary workflow supervisor",
      objective: "Supervise additional bundled Smithers workflows.",
    });
    store.finishTurn({
      turnId: secondarySeedTurn.id,
      status: "completed",
    });

    const firstLaunchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch primary hello world",
      title: "Run primary hello_world",
      summary: "Launch the primary hello_world workflow.",
      toolName: "smithers.run_workflow.hello_world",
    });
    const secondLaunchCommand = createWorkflowCommand({
      store,
      sessionId: secondarySessionId,
      threadId: secondaryHandlerThread.id,
      surfacePiSessionId: secondaryHandlerThread.surfacePiSessionId,
      requestSummary: "Launch secondary hello world",
      title: "Run secondary hello_world",
      summary: "Launch the secondary hello_world workflow.",
      toolName: "smithers.run_workflow.hello_world",
    });

    const primaryLaunch = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "hello_world",
      launchInput: { message: "primary ownership" },
      commandId: firstLaunchCommand.commandId,
    });
    const secondaryLaunch = await manager.launchWorkflow({
      sessionId: secondarySessionId,
      threadId: secondaryHandlerThread.id,
      workflowId: "hello_world",
      launchInput: { message: "secondary ownership" },
      commandId: secondLaunchCommand.commandId,
    });

    await waitFor("workspace-global hello_world completion", async () => {
      try {
        const [primaryRun, secondaryRun] = await Promise.all([
          manager.getRun(primaryLaunch.runId),
          manager.getRun(secondaryLaunch.runId),
        ]);
        return primaryRun.status === "finished" && secondaryRun.status === "finished";
      } catch {
        return false;
      }
    });

    const runs = await manager.listRuns({ workflowId: "hello_world" });
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: primaryLaunch.runId,
          workflowName: "svvy-hello-world",
          status: "finished",
          sessionId,
          threadId,
        }),
        expect.objectContaining({
          runId: secondaryLaunch.runId,
          workflowName: "svvy-hello-world",
          status: "finished",
          sessionId: secondarySessionId,
          threadId: secondaryHandlerThread.id,
        }),
      ]),
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
      toolName: "smithers.run_workflow.hello_world",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "hello_world",
      launchInput: { message: "bonjour smithers" },
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

  it("keeps handler attention pending until an explicit delivery succeeds", async () => {
    let shouldDeliverAttention = false;
    const { store, manager, sessionId, threadId, surfacePiSessionId, handlerAttentions } =
      createWorkspaceFixture({
        onHandlerAttention: async () => shouldDeliverAttention,
      });

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch hello world",
      title: "Run hello_world",
      summary: "Launch the hello_world workflow.",
      toolName: "smithers.run_workflow.hello_world",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "hello_world",
      launchInput: { message: "leave attention pending" },
      commandId: launchCommand.commandId,
    });

    await waitFor("hello_world completion with pending attention", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "finished" && run.pendingAttentionSeq !== null;
      } catch {
        return false;
      }
    });
    await waitFor("first undelivered attention attempt", () => handlerAttentions.length === 1);

    let snapshot = store.getSessionState(sessionId);
    let workflowRun = snapshot.workflowRuns.find((entry) => entry.smithersRunId === launched.runId);
    expect(workflowRun).toMatchObject({
      status: "completed",
      pendingAttentionSeq: expect.any(Number),
      lastAttentionSeq: null,
    });

    shouldDeliverAttention = true;
    await manager.deliverPendingHandlerAttention(sessionId, threadId);

    snapshot = store.getSessionState(sessionId);
    workflowRun = snapshot.workflowRuns.find((entry) => entry.smithersRunId === launched.runId);
    expect(handlerAttentions).toHaveLength(2);
    expect(workflowRun).toMatchObject({
      pendingAttentionSeq: null,
      lastAttentionSeq: expect.any(Number),
    });

    const run = await manager.getRun(launched.runId);
    expect(run).toMatchObject({
      pendingAttentionSeq: null,
      lastAttentionSeq: workflowRun?.lastAttentionSeq,
      structuredWorkflowRunId: workflowRun?.id,
    });
  });

  it("restores pending workflow supervision from durable state after recreating the manager", async () => {
    let shouldDeliverAttention = false;
    const {
      cwd,
      agentDir,
      store,
      manager,
      sessionId,
      threadId,
      surfacePiSessionId,
      structuredStateChanges,
    } = createWorkspaceFixture({
      onHandlerAttention: async () => shouldDeliverAttention,
    });

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch hello world",
      title: "Run hello_world",
      summary: "Launch the hello_world workflow.",
      toolName: "smithers.run_workflow.hello_world",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "hello_world",
      launchInput: { message: "recover pending attention" },
      commandId: launchCommand.commandId,
    });

    await waitFor("hello_world completion before manager restart", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "finished" && run.pendingAttentionSeq !== null;
      } catch {
        return false;
      }
    });

    const beforeRestart = store
      .getSessionState(sessionId)
      .workflowRuns.find((entry) => entry.smithersRunId === launched.runId);
    expect(beforeRestart).toMatchObject({
      pendingAttentionSeq: expect.any(Number),
      lastAttentionSeq: null,
    });

    await manager.close();
    managers.splice(managers.indexOf(manager), 1);

    shouldDeliverAttention = true;
    const restoredStructuredStateChanges: string[] = [];
    const restoredHandlerAttentions: HandlerAttentionEvent[] = [];
    const restoredManager = createManagerHarness({
      cwd,
      agentDir,
      store,
      structuredStateChanges: restoredStructuredStateChanges,
      handlerAttentions: restoredHandlerAttentions,
      onHandlerAttention: async () => shouldDeliverAttention,
    });

    await restoredManager.restoreSessionSupervision(sessionId);

    const afterRestore = store
      .getSessionState(sessionId)
      .workflowRuns.find((entry) => entry.smithersRunId === launched.runId);
    expect(restoredHandlerAttentions).toHaveLength(1);
    expect(afterRestore).toMatchObject({
      id: beforeRestart?.id,
      pendingAttentionSeq: null,
      lastAttentionSeq: beforeRestart?.pendingAttentionSeq,
    });
    expect(restoredStructuredStateChanges).toContain(sessionId);
    expect(structuredStateChanges).toContain(sessionId);

    const restoredRun = await restoredManager.getRun(launched.runId);
    expect(restoredRun).toMatchObject({
      runId: launched.runId,
      structuredWorkflowRunId: beforeRestart?.id,
      threadId,
      pendingAttentionSeq: null,
      lastAttentionSeq: beforeRestart?.pendingAttentionSeq,
    });
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
      toolName: "smithers.run_workflow.approval_gate",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "approval_gate",
      launchInput: { title: "Approve the release?" },
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
    expect(explanation.summary).toContain("waiting-approval");
    expect(explanation.diagnosis.blockers.length).toBeGreaterThan(0);

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
      toolName: "smithers.run_workflow.approval_gate",
    });
    const resumed = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "approval_gate",
      launchInput: { title: "Approve the release?" },
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
      toolName: "smithers.run_workflow.continue_once",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "continue_once",
      launchInput: {},
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

  it("diagnoses signal waits and exposes real frame plus DevTools inspection for bundled runs", async () => {
    const { cwd, store, manager, sessionId, threadId, surfacePiSessionId } =
      createWorkspaceFixture();
    registerWorkflow(manager, createSignalWorkflowDefinition(smithersDbPath(cwd)));

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch signal workflow",
      title: "Run wait_for_signal",
      summary: "Launch the wait_for_signal workflow.",
      toolName: "smithers.run_workflow.wait_for_signal",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "wait_for_signal",
      launchInput: { signalName: "deploy.completed" },
      commandId: launchCommand.commandId,
    });

    await waitFor("signal wait state", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "waiting-event" && run.waitKind === "signal";
      } catch {
        return false;
      }
    });

    let snapshot = store.getSessionState(sessionId);
    expect(snapshot.workflowRuns.find((entry) => entry.smithersRunId === launched.runId)).toMatchObject({
      status: "waiting",
      smithersStatus: "waiting-event",
      waitKind: "signal",
    });
    expect(snapshot.threads.find((thread) => thread.id === threadId)).toMatchObject({
      id: threadId,
      status: "waiting",
      wait: expect.objectContaining({
        owner: "workflow",
        kind: "signal",
      }),
    });
    expect(snapshot.session.wait).toMatchObject({
      owner: { kind: "thread", threadId },
      kind: "signal",
    });

    const watch = await manager.watchRun({
      runId: launched.runId,
      timeoutMs: 0,
    });
    expect(watch).toMatchObject({
      runId: launched.runId,
      reachedTerminal: false,
      timedOut: true,
      finalRun: {
        status: "waiting-event",
        waitKind: "signal",
      },
    });

    const explanation = await manager.explainRun(launched.runId);
    expect(explanation.summary).toContain("waiting-event");
    expect(explanation.diagnosis).toMatchObject({
      runId: launched.runId,
      status: "waiting-event",
    });
    expect(
      explanation.diagnosis.blockers.some(
        (blocker: { signalName?: string | null }) => blocker.signalName === "deploy.completed",
      ),
    ).toBe(true);

    const delivered = await manager.sendSignal({
      runId: launched.runId,
      signalName: "deploy.completed",
      data: {
        environment: "production",
        sha: "abc123",
        status: "success",
      },
    });
    expect(delivered).toMatchObject({
      ok: true,
      runId: launched.runId,
      signalName: "deploy.completed",
    });

    const resumeCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Resume signal workflow",
      title: "Resume wait_for_signal",
      summary: "Resume the wait_for_signal workflow.",
      toolName: "smithers.run_workflow.wait_for_signal",
    });
    await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "wait_for_signal",
      launchInput: { signalName: "deploy.completed" },
      commandId: resumeCommand.commandId,
      runId: launched.runId,
    });

    await waitFor("signal workflow completion", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "finished";
      } catch {
        return false;
      }
    });

    const filteredEvents = await manager.getRunEvents({
      runId: launched.runId,
      types: ["RunFinished"],
    });
    expect(filteredEvents).toHaveLength(1);
    expect(filteredEvents[0]).toMatchObject({
      type: "RunFinished",
    });

    const frames = await manager.listFrames({
      runId: launched.runId,
      limit: 20,
    });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toMatchObject({
      runId: launched.runId,
      frameNo: expect.any(Number),
      xml: expect.anything(),
    });

    const devToolsSnapshot = await manager.getDevToolsSnapshot({
      runId: launched.runId,
    });
    expect(devToolsSnapshot).toMatchObject({
      version: 1,
      runId: launched.runId,
      frameNo: expect.any(Number),
      root: expect.any(Object),
    });

    const devToolsStream = await manager.streamDevTools({
      runId: launched.runId,
      fromSeq: 0,
      timeoutMs: 150,
      maxEvents: 10,
    });
    expect(devToolsStream.events.length).toBeGreaterThan(0);
    expect(devToolsStream.events[0]).toMatchObject({
      kind: "snapshot",
    });

    const signalLogPath = smithersLogPath(cwd, launched.runId);
    await waitFor("signal workflow execution log", () =>
      fileContains(signalLogPath, '"type":"RunFinished"'),
    );
    expect(readFileSync(signalLogPath, "utf8")).toContain('"type":"RunFinished"');

    snapshot = store.getSessionState(sessionId);
    expect(snapshot.threads.find((thread) => thread.id === threadId)).toMatchObject({
      id: threadId,
      status: "running-handler",
      wait: null,
    });
    expect(snapshot.session.wait).toBeNull();
  });

  it("replays workflow history across multiple Smithers event batches", async () => {
    const { store, manager, sessionId, threadId, surfacePiSessionId } = createWorkspaceFixture();

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch hello world",
      title: "Run hello_world",
      summary: "Launch the hello_world workflow.",
      toolName: "smithers.run_workflow.hello_world",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "hello_world",
      launchInput: { message: "drain every event batch" },
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

    const before = await manager.getRun(launched.runId);
    const db = (manager as any).db as {
      insertEventWithNextSeq(input: {
        runId: string;
        timestampMs: number;
        type: string;
        payloadJson: string;
      }): Promise<number>;
    };
    let lastInsertedSeq = before.lastEventSeq;
    for (let index = 0; index < 401; index += 1) {
      lastInsertedSeq = await db.insertEventWithNextSeq({
        runId: launched.runId,
        timestampMs: Date.now() + index,
        type: "SyntheticEvent",
        payloadJson: JSON.stringify({
          type: "SyntheticEvent",
          index,
        }),
      });
    }

    await (manager as any).flushRunEvents(launched.runId, {
      emitAttention: false,
      source: "bootstrap",
    });

    const after = await manager.getRun(launched.runId);
    expect(after.lastEventSeq).toBe(lastInsertedSeq);
    expect(after.lastEventSeq).toBeGreaterThan(before.lastEventSeq + 200);
  });

  it("returns grouped transcript messages for a deterministic real Smithers agent task", async () => {
    const { cwd, store, manager, sessionId, threadId, surfacePiSessionId } =
      createWorkspaceFixture();
    registerWorkflow(manager, createTranscriptWorkflowDefinition(smithersDbPath(cwd)));

    const launchCommand = createWorkflowCommand({
      store,
      sessionId,
      threadId,
      surfacePiSessionId,
      requestSummary: "Launch transcript workflow",
      title: "Run chat_transcript_probe",
      summary: "Launch the chat_transcript_probe workflow.",
      toolName: "smithers.run_workflow.chat_transcript_probe",
    });
    const launched = await manager.launchWorkflow({
      sessionId,
      threadId,
      workflowId: "chat_transcript_probe",
      launchInput: { prompt: "Summarize the transcript probe." },
      commandId: launchCommand.commandId,
    });

    await waitFor("transcript workflow completion", async () => {
      try {
        const run = await manager.getRun(launched.runId);
        return run.status === "finished";
      } catch {
        return false;
      }
    });

    const transcript = await manager.getChatTranscript({
      runId: launched.runId,
      all: true,
    });
    expect(transcript.attempts).toHaveLength(1);
    expect(transcript.messages.map((message) => message.role)).toEqual(
      expect.arrayContaining(["user", "assistant"]),
    );
    expect(
      transcript.messages.some((message) =>
        String(message.text).includes("Summarize the transcript probe."),
      ),
    ).toBe(true);
    expect(
      transcript.messages.some((message) => String(message.text).includes("Handled:")),
    ).toBe(true);

    const assistantDetail = await manager.getNodeDetail({
      runId: launched.runId,
      nodeId: "assistant",
    });
    expect(assistantDetail.attempts.length).toBeGreaterThan(0);
    expect(assistantDetail.node.outputTable).toBeTruthy();
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
        return false;
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
      toolName: "smithers.run_workflow.execute_typescript_task",
    });
    try {
      const launched = await manager.launchWorkflow({
        sessionId,
        threadId: handlerThread.id,
        workflowId: "execute_typescript_task",
        launchInput: {
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
