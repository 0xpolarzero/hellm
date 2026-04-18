import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type {
  StructuredSessionSnapshot,
  StructuredSessionStateStore,
  StructuredWaitState,
  StructuredWorkflowStatus,
} from "./structured-session-state";
import {
  readSmithersWorkflowProjectionInput,
  startImplementFeatureWorkflow,
  type SmithersWorkflowProjectionInput,
  type StartImplementFeatureWorkflowOptions,
  type StartSmithersWorkflowResult,
} from "./smithers-workflow-bridge";

export const START_WORKFLOW_TOOL_NAME = "workflow.start";
export const RESUME_WORKFLOW_TOOL_NAME = "workflow.resume";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_WORKFLOWS_DIR = resolve(REPO_ROOT, "workflows");
const DEFAULT_SMITHERS_BIN = resolve(DEFAULT_WORKFLOWS_DIR, "node_modules/.bin/smithers");
const IMPLEMENT_FEATURE_WORKFLOW = "definitions/implement-feature.tsx";

const onMaxReachedSchema = Type.Union([Type.Literal("return-last"), Type.Literal("fail")]);

export const startWorkflowParamsSchema = Type.Object(
  {
    workflowName: Type.Optional(Type.Literal("implement-feature")),
    specPath: Type.String(),
    pocPath: Type.String(),
    slug: Type.Optional(Type.String()),
    worktreeRoot: Type.Optional(Type.String()),
    branchPrefix: Type.Optional(Type.String()),
    baseBranch: Type.Optional(Type.String()),
    maxIterations: Type.Optional(Type.Integer({ minimum: 1 })),
    onMaxReached: Type.Optional(onMaxReachedSchema),
  },
  { additionalProperties: false },
);

export const resumeWorkflowParamsSchema = Type.Object(
  {
    workflowName: Type.Optional(Type.Literal("implement-feature")),
    runId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type StartWorkflowParams = Static<typeof startWorkflowParamsSchema>;
export type ResumeWorkflowParams = Static<typeof resumeWorkflowParamsSchema>;

type ResumeImplementFeatureWorkflowOptions = {
  repoRoot?: string;
  smithersBin?: string;
  smithersCwd?: string;
  runId: string;
};

export interface WorkflowToolBridge {
  startImplementFeatureWorkflow(
    options: StartImplementFeatureWorkflowOptions,
  ): Promise<StartSmithersWorkflowResult>;
  resumeImplementFeatureWorkflow(
    options: ResumeImplementFeatureWorkflowOptions,
  ): Promise<StartSmithersWorkflowResult>;
  readSmithersWorkflowProjectionInput(input: { runId: string }): SmithersWorkflowProjectionInput | null;
}

type StartWorkflowToolOptions = {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  bridge?: WorkflowToolBridge;
};

type ResumeWorkflowToolOptions = StartWorkflowToolOptions;

type WorkflowExecutionMode = "start" | "resume";

type WorkflowRunRecord = {
  id: string;
  threadId: string;
  commandId: string;
  smithersRunId: string;
  workflowName: string;
  status: StructuredWorkflowStatus;
  summary: string;
};

type WorkflowToolResultDetails = {
  ok: boolean;
  resumed: boolean;
  runId?: string;
  handlerThreadId: string;
  commandId: string;
  workflowRunId?: string | null;
  workflowId?: string | null;
  status?: StructuredWorkflowStatus;
  summary?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  sessionWaitApplied: boolean;
  persisted: boolean;
};

type WorkflowThreadContext = {
  handlerThreadId: string;
  workflowRun: WorkflowRunRecord | null;
};

type WorkflowStoreCompat = StructuredSessionStateStore & {
  createCommand(input: Record<string, unknown>): { id: string };
  createArtifact(input: Record<string, unknown>): unknown;
  recordWorkflow(input: Record<string, unknown>): WorkflowRunRecord;
  updateWorkflow(input: Record<string, unknown>): WorkflowRunRecord;
  setSessionWait(input: Record<string, unknown>): unknown;
};

type ThreadOwnedWait = {
  owner?: {
    kind: "thread";
    threadId: string;
  } | {
    kind: "orchestrator";
  };
  threadId?: string | null;
};

type WorkflowSnapshot = StructuredSessionSnapshot & {
  workflowRuns?: WorkflowRunRecord[];
  workflows: WorkflowRunRecord[];
  session: StructuredSessionSnapshot["session"] & {
    wait: (StructuredSessionSnapshot["session"]["wait"] & ThreadOwnedWait) | null;
  };
};

const START_WORKFLOW_DESCRIPTION = [
  "Start a real delegated Smithers workflow under the current surface.",
  "This tool should normally be used from a handler thread, not directly from the orchestrator surface.",
].join(" ");

const RESUME_WORKFLOW_DESCRIPTION = [
  "Resume an existing delegated Smithers workflow under the current surface.",
  "Use the original Smithers run id so the handler thread can continue supervising the same delegated workflow.",
].join(" ");

const DEFAULT_WORKFLOW_BRIDGE: WorkflowToolBridge = {
  startImplementFeatureWorkflow,
  resumeImplementFeatureWorkflow,
  readSmithersWorkflowProjectionInput,
};

export function createStartWorkflowTool(
  options: StartWorkflowToolOptions,
): AgentTool<typeof startWorkflowParamsSchema, Record<string, unknown>> {
  return {
    label: "Workflow",
    name: START_WORKFLOW_TOOL_NAME,
    description: START_WORKFLOW_DESCRIPTION,
    parameters: startWorkflowParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = requireActiveRuntime(options.runtime, START_WORKFLOW_TOOL_NAME);
      const bridge = options.bridge ?? DEFAULT_WORKFLOW_BRIDGE;
      const normalized = normalizeStartParams(params);
      const context = resolveWorkflowThreadContext({
        store: options.store,
        sessionId: runtime.sessionId,
        surfaceThreadId: runtime.surfaceThreadId ?? runtime.rootThreadId,
      });

      return await executeWorkflowCommand({
        mode: "start",
        runtime,
        store: options.store,
        bridge,
        context,
        commandTitle: "Start delegated workflow",
        commandSummary: "Launch the delegated workflow in Smithers.",
        startRun: () => bridge.startImplementFeatureWorkflow(normalized),
      });
    },
  };
}

export function createResumeWorkflowTool(
  options: ResumeWorkflowToolOptions,
): AgentTool<typeof resumeWorkflowParamsSchema, Record<string, unknown>> {
  return {
    label: "Workflow Resume",
    name: RESUME_WORKFLOW_TOOL_NAME,
    description: RESUME_WORKFLOW_DESCRIPTION,
    parameters: resumeWorkflowParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = requireActiveRuntime(options.runtime, RESUME_WORKFLOW_TOOL_NAME);
      const bridge = options.bridge ?? DEFAULT_WORKFLOW_BRIDGE;
      const normalized = normalizeResumeParams(params);
      const context = resolveWorkflowThreadContext({
        store: options.store,
        sessionId: runtime.sessionId,
        surfaceThreadId: runtime.surfaceThreadId ?? runtime.rootThreadId,
        runId: normalized.runId,
      });

      return await executeWorkflowCommand({
        mode: "resume",
        runtime,
        store: options.store,
        bridge,
        context,
        commandTitle: "Resume delegated workflow",
        commandSummary: `Resume delegated workflow run ${normalized.runId}.`,
        startRun: () =>
          bridge.resumeImplementFeatureWorkflow({
            runId: normalized.runId,
          }),
      });
    },
  };
}

function requireActiveRuntime(
  runtimeHandle: PromptExecutionRuntimeHandle,
  toolName: string,
) {
  const runtime = runtimeHandle.current;
  if (!runtime) {
    throw new Error(`${toolName} can only run during an active prompt.`);
  }
  return runtime;
}

function normalizeStartParams(params: StartWorkflowParams): StartImplementFeatureWorkflowOptions {
  return {
    specPath: params.specPath.trim(),
    pocPath: params.pocPath.trim(),
    ...(params.slug?.trim() ? { slug: params.slug.trim() } : {}),
    ...(params.worktreeRoot?.trim() ? { worktreeRoot: params.worktreeRoot.trim() } : {}),
    ...(params.branchPrefix?.trim() ? { branchPrefix: params.branchPrefix.trim() } : {}),
    ...(params.baseBranch?.trim() ? { baseBranch: params.baseBranch.trim() } : {}),
    ...(typeof params.maxIterations === "number" ? { maxIterations: params.maxIterations } : {}),
    ...(params.onMaxReached ? { onMaxReached: params.onMaxReached } : {}),
  };
}

function normalizeResumeParams(params: ResumeWorkflowParams): ResumeWorkflowParams {
  return {
    workflowName: params.workflowName,
    runId: params.runId.trim(),
  };
}

function resolveWorkflowThreadContext(input: {
  store: StructuredSessionStateStore;
  sessionId: string;
  surfaceThreadId: string;
  runId?: string;
}): WorkflowThreadContext {
  const snapshot = getWorkflowSnapshot(input.store, input.sessionId);
  mustFindThread(snapshot, input.surfaceThreadId);

  return {
    handlerThreadId: input.surfaceThreadId,
    workflowRun: input.runId
      ? findWorkflowRunForHandler(snapshot, input.surfaceThreadId, input.runId)
      : null,
  };
}

async function executeWorkflowCommand(input: {
  mode: WorkflowExecutionMode;
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
  store: StructuredSessionStateStore;
  bridge: WorkflowToolBridge;
  context: WorkflowThreadContext;
  commandTitle: string;
  commandSummary: string;
  startRun: () => Promise<StartSmithersWorkflowResult>;
}): Promise<{ content: Array<{ type: "text"; text: string }>; details: WorkflowToolResultDetails }> {
  input.runtime.sessionWaitApplied = false;
  const compatStore = input.store as WorkflowStoreCompat;
  const command = compatStore.createCommand({
    turnId: input.runtime.turnId,
    surfacePiSessionId: input.runtime.surfacePiSessionId,
    threadId: input.context.handlerThreadId,
    workflowRunId: input.context.workflowRun?.id ?? null,
    toolName: input.mode === "start" ? START_WORKFLOW_TOOL_NAME : RESUME_WORKFLOW_TOOL_NAME,
    executor: "smithers",
    visibility: "surface",
    title: input.commandTitle,
    summary: input.commandSummary,
  });
  input.store.startCommand(command.id);

  try {
    const started = await input.startRun();
    const projection =
      (await waitForProjectionInput(started.runId, input.bridge.readSmithersWorkflowProjectionInput)) ??
      {
        status: "running" satisfies StructuredWorkflowStatus,
        summary:
          input.mode === "resume"
            ? `implement-feature run ${started.runId} resumed.`
            : `implement-feature run ${started.runId} started.`,
      };

    const workflowRun =
      persistWorkflowRun({
        store: input.store,
        existingWorkflowRun:
          input.context.workflowRun ??
          findWorkflowRunForHandler(
            getWorkflowSnapshot(input.store, input.runtime.sessionId),
            input.context.handlerThreadId,
            started.runId,
          ),
        handlerThreadId: input.context.handlerThreadId,
        commandId: command.id,
        runId: started.runId,
        workflowName: "implement-feature",
        status: projection.status,
        summary: projection.summary,
      }) ?? null;

    reconcileHandlerThreadState({
      store: input.store,
      runtime: input.runtime,
      handlerThreadId: input.context.handlerThreadId,
      workflowStatus: projection.status,
      summary: projection.summary,
    });

    recordWorkflowArtifacts({
      store: input.store,
      threadId: input.context.handlerThreadId,
      workflowRunId: workflowRun?.id ?? null,
      commandId: command.id,
      workflowName: "implement-feature",
      runId: started.runId,
      status: projection.status,
      summary: projection.summary,
      stdout: started.stdout,
      stderr: started.stderr,
    });
    input.store.finishCommand({
      commandId: command.id,
      status: "succeeded",
      summary: projection.summary,
      facts: {
        runId: started.runId,
        workflowRunId: workflowRun?.id ?? null,
        status: projection.status,
        persisted: workflowRun !== null,
      },
    });

    return toToolResponse({
      ok: true,
      resumed: input.mode === "resume",
      runId: started.runId,
      handlerThreadId: input.context.handlerThreadId,
      commandId: command.id,
      workflowRunId: workflowRun?.id ?? null,
      workflowId: workflowRun?.id ?? null,
      status: workflowRun?.status ?? projection.status,
      summary: workflowRun?.summary ?? projection.summary,
      stdout: started.stdout,
      stderr: started.stderr,
      sessionWaitApplied: input.runtime.sessionWaitApplied,
      persisted: workflowRun !== null,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : input.mode === "resume"
          ? "Failed to resume delegated workflow."
          : "Failed to start delegated workflow.";

    clearThreadOwnedSessionWait(input.store, input.runtime.sessionId, input.context.handlerThreadId);
    input.store.updateThread({
      threadId: input.context.handlerThreadId,
      status: "running",
    });
    input.store.createArtifact({
      threadId: input.context.handlerThreadId,
      workflowRunId: input.context.workflowRun?.id ?? null,
      sourceCommandId: command.id,
      kind: "text",
      name: "implement-feature-workflow.error.txt",
      content: message,
    });
    input.store.finishCommand({
      commandId: command.id,
      status: "failed",
      summary: message,
      error: message,
      facts: {
        workflowRunId: input.context.workflowRun?.id ?? null,
        persisted: false,
      },
    });

    return toToolResponse({
      ok: false,
      resumed: input.mode === "resume",
      handlerThreadId: input.context.handlerThreadId,
      commandId: command.id,
      workflowRunId: input.context.workflowRun?.id ?? null,
      workflowId: input.context.workflowRun?.id ?? null,
      error: message,
      sessionWaitApplied: input.runtime.sessionWaitApplied,
      persisted: false,
    });
  }
}

function reconcileHandlerThreadState(input: {
  store: StructuredSessionStateStore;
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
  handlerThreadId: string;
  workflowStatus: StructuredWorkflowStatus;
  summary: string;
}): void {
  if (input.workflowStatus === "waiting") {
    const wait = buildWorkflowWaitState(input.summary);
    input.store.updateThread({
      threadId: input.handlerThreadId,
      status: "waiting",
      wait,
    });
    if (canSessionWait(input.store, input.runtime.sessionId, input.handlerThreadId)) {
      (input.store as WorkflowStoreCompat).setSessionWait({
        sessionId: input.runtime.sessionId,
        owner: {
          kind: "thread",
          threadId: input.handlerThreadId,
        },
        threadId: input.handlerThreadId,
        kind: wait.kind,
        reason: wait.reason,
        resumeWhen: wait.resumeWhen,
      });
      input.runtime.sessionWaitApplied = true;
      return;
    }

    clearThreadOwnedSessionWait(input.store, input.runtime.sessionId, input.handlerThreadId);
    input.runtime.sessionWaitApplied = false;
    return;
  }

  clearThreadOwnedSessionWait(input.store, input.runtime.sessionId, input.handlerThreadId);
  input.store.updateThread({
    threadId: input.handlerThreadId,
    status: "running",
  });
  input.runtime.sessionWaitApplied = false;
}

function toToolResponse(details: WorkflowToolResultDetails) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(details),
      },
    ],
    details,
  };
}

function persistWorkflowRun(input: {
  store: StructuredSessionStateStore;
  existingWorkflowRun: WorkflowRunRecord | null;
  handlerThreadId: string;
  commandId: string;
  runId: string;
  workflowName: string;
  status: StructuredWorkflowStatus;
  summary: string;
}): WorkflowRunRecord | null {
  const compatStore = input.store as WorkflowStoreCompat;
  try {
    if (input.existingWorkflowRun) {
      return compatStore.updateWorkflow({
        workflowId: input.existingWorkflowRun.id,
        commandId: input.commandId,
        status: input.status,
        summary: input.summary,
      }) as WorkflowRunRecord;
    }

    return compatStore.recordWorkflow({
      threadId: input.handlerThreadId,
      commandId: input.commandId,
      smithersRunId: input.runId,
      workflowName: input.workflowName,
      status: input.status,
      summary: input.summary,
    }) as WorkflowRunRecord;
  } catch (error) {
    if (isLegacyWorkflowThreadConstraintError(error)) {
      return null;
    }
    throw error;
  }
}

function mustFindThread(snapshot: WorkflowSnapshot, threadId: string) {
  const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
  if (!thread) {
    throw new Error(`Structured thread not found for prompt surface: ${threadId}`);
  }
  return thread;
}

function getWorkflowSnapshot(
  store: StructuredSessionStateStore,
  sessionId: string,
): WorkflowSnapshot {
  return store.getSessionState(sessionId) as WorkflowSnapshot;
}

function getWorkflowRuns(snapshot: WorkflowSnapshot): WorkflowRunRecord[] {
  return (snapshot.workflowRuns ?? snapshot.workflows ?? []) as WorkflowRunRecord[];
}

function findWorkflowRunForHandler(
  snapshot: WorkflowSnapshot,
  handlerThreadId: string,
  runId: string,
): WorkflowRunRecord | null {
  return (
    getWorkflowRuns(snapshot).find(
      (workflowRun) =>
        workflowRun.threadId === handlerThreadId && workflowRun.smithersRunId === runId,
    ) ?? null
  );
}

function buildWorkflowWaitState(summary: string): StructuredWaitState {
  return {
    kind: "external",
    reason: summary,
    resumeWhen: "Resume when the delegated workflow reports new progress.",
    since: new Date().toISOString(),
  };
}

function canSessionWait(
  store: StructuredSessionStateStore,
  sessionId: string,
  threadId: string,
): boolean {
  const snapshot = getWorkflowSnapshot(store, sessionId);
  return snapshot.threads.every((thread) => thread.id === threadId || thread.status !== "running");
}

function clearThreadOwnedSessionWait(
  store: StructuredSessionStateStore,
  sessionId: string,
  handlerThreadId: string,
): void {
  const wait = getWorkflowSnapshot(store, sessionId).session.wait;
  if (getWaitOwnerThreadId(wait) !== handlerThreadId) {
    return;
  }

  store.clearSessionWait({
    sessionId,
  });
}

function getWaitOwnerThreadId(wait: WorkflowSnapshot["session"]["wait"]): string | null {
  if (!wait) {
    return null;
  }
  if (wait.owner?.kind === "thread") {
    return wait.owner.threadId;
  }
  return wait.threadId ?? null;
}

function isLegacyWorkflowThreadConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /workflow records require workflow threads|does not belong to workflow thread/i.test(
    message,
  );
}

async function waitForProjectionInput(
  runId: string,
  readProjectionInput: WorkflowToolBridge["readSmithersWorkflowProjectionInput"],
  timeoutMs = 5_000,
): Promise<ReturnType<WorkflowToolBridge["readSmithersWorkflowProjectionInput"]>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const projection = readProjectionInput({ runId });
    if (projection) {
      return projection;
    }
    await Bun.sleep(100);
  }

  return null;
}

function recordWorkflowArtifacts(input: {
  store: StructuredSessionStateStore;
  threadId: string;
  workflowRunId: string | null;
  commandId: string;
  workflowName: string;
  runId: string;
  status: StructuredWorkflowStatus;
  summary: string;
  stdout: string;
  stderr: string;
}): void {
  const compatStore = input.store as WorkflowStoreCompat;

  compatStore.createArtifact({
    threadId: input.threadId,
    workflowRunId: input.workflowRunId,
    sourceCommandId: input.commandId,
    kind: "json",
    name: `${input.workflowName}-workflow.result.json`,
    content: JSON.stringify(
      {
        workflowName: input.workflowName,
        runId: input.runId,
        status: input.status,
        summary: input.summary,
      },
      null,
      2,
    ),
  });

  if (input.stdout.trim()) {
    compatStore.createArtifact({
      threadId: input.threadId,
      workflowRunId: input.workflowRunId,
      sourceCommandId: input.commandId,
      kind: "log",
      name: `${input.workflowName}-workflow.stdout.log`,
      content: input.stdout,
    });
  }

  if (input.stderr.trim()) {
    compatStore.createArtifact({
      threadId: input.threadId,
      workflowRunId: input.workflowRunId,
      sourceCommandId: input.commandId,
      kind: "log",
      name: `${input.workflowName}-workflow.stderr.log`,
      content: input.stderr,
    });
  }
}

async function resumeImplementFeatureWorkflow(
  options: ResumeImplementFeatureWorkflowOptions,
): Promise<StartSmithersWorkflowResult> {
  const smithersBin = options.smithersBin ?? DEFAULT_SMITHERS_BIN;
  const smithersCwd = options.smithersCwd ?? DEFAULT_WORKFLOWS_DIR;
  const repoRoot = options.repoRoot ?? REPO_ROOT;

  if (!existsSync(smithersBin)) {
    throw new Error(`Smithers binary not found at ${smithersBin}`);
  }

  const proc = Bun.spawn(
    [
      smithersBin,
      "up",
      IMPLEMENT_FEATURE_WORKFLOW,
      "--detach",
      "true",
      "--resume",
      "true",
      "--run-id",
      options.runId,
      "--root",
      repoRoot,
    ],
    {
      cwd: smithersCwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  const cleanStdout = stripAnsi(stdout);
  const cleanStderr = stripAnsi(stderr);
  if (exitCode !== 0) {
    throw new Error(cleanStderr || cleanStdout || "Failed to resume Smithers workflow.");
  }

  return {
    runId: options.runId,
    stdout: cleanStdout,
    stderr: cleanStderr,
  };
}

function stripAnsi(value: string) {
  const escape = String.fromCharCode(0x1b);
  return value.replace(new RegExp(`${escape}\\[[0-9;]*[A-Za-z]`, "g"), "");
}
