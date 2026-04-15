import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type AssistantMessage } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import type {
  StructuredSessionStateStore,
  StructuredThreadBlockedOn,
  StructuredThreadKind,
  StructuredThreadResultKind,
  StructuredThreadStatus,
  StructuredVerificationStatus,
  StructuredWorkflowStatus,
} from "./structured-session-state";

export const STRUCTURED_SESSION_STATE_TOOL_NAME = "structured-session-state";

const threadKindSchema = Type.Union([
  Type.Literal("direct"),
  Type.Literal("verification"),
  Type.Literal("workflow"),
]);

const threadStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("waiting"),
]);

const resultKindSchema = Type.Union([
  Type.Literal("analysis-summary"),
  Type.Literal("change-summary"),
  Type.Literal("verification-summary"),
  Type.Literal("workflow-summary"),
  Type.Literal("clarification-summary"),
]);

const verificationStatusSchema = Type.Union([
  Type.Literal("passed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

const workflowStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("waiting"),
]);

const waitingKindSchema = Type.Union([Type.Literal("user"), Type.Literal("external")]);

const blockedOnSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("threads"),
      threadIds: Type.Array(Type.String()),
      waitPolicy: Type.Union([Type.Literal("all"), Type.Literal("any")]),
      reason: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: waitingKindSchema,
      reason: Type.String(),
      resumeWhen: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

export const structuredSessionStateParamsSchema = Type.Object(
  {
    command: Type.Optional(Type.String()),
    operation: Type.Optional(
      Type.Union([
        Type.Literal("startThread"),
        Type.Literal("updateThread"),
        Type.Literal("setThreadResult"),
        Type.Literal("recordVerification"),
        Type.Literal("startWorkflow"),
        Type.Literal("updateWorkflow"),
        Type.Literal("setWaitingState"),
      ]),
    ),
    threadAlias: Type.Optional(Type.String()),
    threadId: Type.Optional(Type.String()),
    kind: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    threadKind: Type.Optional(threadKindSchema),
    threadStatus: Type.Optional(threadStatusSchema),
    resultKind: Type.Optional(resultKindSchema),
    verificationKind: Type.Optional(Type.String()),
    verificationStatus: Type.Optional(verificationStatusSchema),
    workflowAlias: Type.Optional(Type.String()),
    workflowId: Type.Optional(Type.String()),
    workflowName: Type.Optional(Type.String()),
    workflowStatus: Type.Optional(workflowStatusSchema),
    objective: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    blockedReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    blockedOn: Type.Optional(blockedOnSchema),
    waitingKind: Type.Optional(waitingKindSchema),
    reason: Type.Optional(Type.String()),
    resumeWhen: Type.Optional(Type.String()),
    smithersRunId: Type.Optional(Type.String()),
    commandText: Type.Optional(Type.String()),
    waitingWorkflow: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type StructuredSessionStateToolParams = Static<typeof structuredSessionStateParamsSchema>;

export interface StructuredSessionToolRuntimeContext {
  sessionId: string;
  promptText: string;
  threadAliases: Map<string, string>;
  workflowAliases: Map<string, string>;
  processedToolCallIds: Set<string>;
  structuredWriteCount: number;
  latestThreadId: string | null;
  latestWorkflowId: string | null;
}

export interface StructuredSessionToolRuntimeHandle {
  current: StructuredSessionToolRuntimeContext | null;
}

const STRUCTURED_SESSION_STATE_TOOL_DESCRIPTION = [
  "Write durable top-level session lifecycle facts.",
  "Call this whenever you intentionally start or update direct work, verification work, delegated workflows, dependency-blocked joins, or durable user or external waiting.",
  "Ordinary words about tests, workflows, resume, or waiting do not change structured state unless this tool is called.",
  "Use a real Smithers run id for start_workflow, use blockedOn.kind=threads for internal dependency joins, and use set_waiting_state only when the whole session is durably waiting on user or external input.",
].join(" ");

export function createStructuredSessionToolRuntimeContext(
  sessionId: string,
  promptText: string,
): StructuredSessionToolRuntimeContext {
  return {
    sessionId,
    promptText,
    threadAliases: new Map(),
    workflowAliases: new Map(),
    processedToolCallIds: new Set(),
    structuredWriteCount: 0,
    latestThreadId: null,
    latestWorkflowId: null,
  };
}

export function createStructuredSessionStateTool(options: {
  runtime: StructuredSessionToolRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof structuredSessionStateParamsSchema, Record<string, unknown>> {
  return {
    label: "Structured Session State",
    name: STRUCTURED_SESSION_STATE_TOOL_NAME,
    description: STRUCTURED_SESSION_STATE_TOOL_DESCRIPTION,
    parameters: structuredSessionStateParamsSchema,
    execute: async (toolCallId, params) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(
          "structured_session_state can only run during an active prompt lifecycle.",
        );
      }

      const result = executeStructuredSessionStateCommand({
        params,
        runtime,
        store: options.store,
        toolCallId,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}

export function replayStructuredSessionStateToolCalls(options: {
  assistantMessage: AssistantMessage;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): void {
  for (const block of options.assistantMessage.content) {
    if (
      block.type !== "toolCall" ||
      ![STRUCTURED_SESSION_STATE_TOOL_NAME, "structured_session_state"].includes(block.name)
    ) {
      continue;
    }

    executeStructuredSessionStateCommand({
      params: block.arguments as StructuredSessionStateToolParams,
      runtime: options.runtime,
      store: options.store,
      toolCallId: block.id,
    });
  }
}

function executeStructuredSessionStateCommand(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
  toolCallId: string;
}): Record<string, unknown> {
  const normalizedParams = normalizeParams(input.params);

  if (input.runtime.processedToolCallIds.has(input.toolCallId)) {
    return {
      command: normalizedParams.command,
      deduplicated: true,
      ok: true,
    };
  }

  const result = executeCommand({
    ...input,
    params: normalizedParams,
  });
  input.runtime.processedToolCallIds.add(input.toolCallId);
  input.runtime.structuredWriteCount += 1;
  return {
    ok: true,
    command: normalizedParams.command,
    ...result,
  };
}

function executeCommand(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): Record<string, unknown> {
  switch (input.params.command) {
    case "start_thread":
      return executeStartThread(input);
    case "update_thread":
      return executeUpdateThread(input);
    case "set_thread_result":
      return executeSetThreadResult(input);
    case "record_verification":
      return executeRecordVerification(input);
    case "start_workflow":
      return executeStartWorkflow(input);
    case "update_workflow":
      return executeUpdateWorkflow(input);
    case "set_waiting_state":
      return executeSetWaitingState(input);
  }

  throw new Error(`Unsupported structured session command: ${input.params.command}`);
}

function executeStartThread(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): Record<string, unknown> {
  const thread = input.store.startThread({
    sessionId: input.runtime.sessionId,
    kind: requireField(
      input.params.threadKind,
      "threadKind is required for start_thread.",
    ) as StructuredThreadKind,
    objective: normalizeOptionalText(input.params.objective) ?? input.runtime.promptText,
  });

  if (input.params.threadAlias) {
    input.runtime.threadAliases.set(input.params.threadAlias, thread.id);
  }
  input.runtime.latestThreadId = thread.id;

  return {
    threadAlias: input.params.threadAlias ?? null,
    threadId: thread.id,
  };
}

function executeUpdateThread(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): Record<string, unknown> {
  const threadStatus = requireField(
    input.params.threadStatus,
    "threadStatus is required for update_thread.",
  ) as StructuredThreadStatus;

  if (threadStatus === "waiting" && !input.params.blockedOn) {
    throw new Error("update_thread requires blockedOn when threadStatus is waiting.");
  }

  if (threadStatus !== "waiting" && input.params.blockedOn) {
    throw new Error("update_thread only accepts blockedOn while threadStatus is waiting.");
  }

  const blockedOn = input.params.blockedOn
    ? materializeBlockedOn(input.params.blockedOn)
    : undefined;
  const blockedReason =
    input.params.blockedReason === null
      ? null
      : normalizeOptionalText(input.params.blockedReason) ??
        (blockedOn ? blockedOn.reason : undefined);
  const threadId = resolveThreadId(input.store, input.runtime, input.params);
  const thread = input.store.updateThread({
    threadId,
    status: threadStatus,
    blockedOn,
    blockedReason,
  });

  return {
    threadId: thread.id,
    threadStatus: thread.status,
  };
}

function executeSetThreadResult(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): Record<string, unknown> {
  const threadId = resolveThreadId(input.store, input.runtime, input.params);
  const result = input.store.setThreadResult({
    threadId,
    kind: requireField(
      input.params.resultKind,
      "resultKind is required for set_thread_result.",
    ) as StructuredThreadResultKind,
    summary: requireText(input.params.summary, "summary is required for set_thread_result."),
    body: requireText(input.params.body, "body is required for set_thread_result."),
  });

  return {
    resultKind: result.kind,
    threadId,
  };
}

function executeRecordVerification(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): Record<string, unknown> {
  const threadId = resolveThreadId(input.store, input.runtime, input.params);
  const verification = input.store.recordVerification({
    threadId,
    kind: requireText(
      input.params.verificationKind,
      "verificationKind is required for record_verification.",
    ),
    status: requireField(
      input.params.verificationStatus,
      "verificationStatus is required for record_verification.",
    ) as StructuredVerificationStatus,
    summary: requireText(
      input.params.summary,
      "summary is required for record_verification.",
    ),
    command: normalizeOptionalText(input.params.commandText) ?? undefined,
  });

  return {
    threadId,
    verificationId: verification.id,
  };
}

function executeStartWorkflow(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): Record<string, unknown> {
  const threadId = resolveThreadId(input.store, input.runtime, input.params);
  const workflow = input.store.startWorkflow({
    threadId,
    smithersRunId: requireText(
      input.params.smithersRunId,
      "smithersRunId is required for start_workflow.",
    ),
    workflowName: requireText(
      input.params.workflowName,
      "workflowName is required for start_workflow.",
    ),
    summary: requireText(input.params.summary, "summary is required for start_workflow."),
  });

  if (input.params.workflowAlias) {
    input.runtime.workflowAliases.set(input.params.workflowAlias, workflow.id);
  }
  input.runtime.latestThreadId = threadId;
  input.runtime.latestWorkflowId = workflow.id;

  return {
    threadId,
    workflowAlias: input.params.workflowAlias ?? null,
    workflowId: workflow.id,
  };
}

function executeUpdateWorkflow(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): Record<string, unknown> {
  const workflowId = resolveWorkflowId(input.store, input.runtime, input.params);
  const workflow = input.store.updateWorkflow({
    workflowId,
    status: requireField(
      input.params.workflowStatus,
      "workflowStatus is required for update_workflow.",
    ) as StructuredWorkflowStatus,
    summary: requireText(input.params.summary, "summary is required for update_workflow."),
  });

  return {
    workflowId: workflow.id,
    workflowStatus: workflow.status,
  };
}

function executeSetWaitingState(input: {
  params: StructuredSessionStateToolParams;
  runtime: StructuredSessionToolRuntimeContext;
  store: StructuredSessionStateStore;
}): Record<string, unknown> {
  const threadId = resolveThreadId(input.store, input.runtime, input.params);
  const waitingState = input.store.setWaitingState({
    sessionId: input.runtime.sessionId,
    threadId,
    kind: requireField(
      input.params.waitingKind,
      "waitingKind is required for set_waiting_state.",
    ) as "user" | "external",
    reason: requireText(input.params.reason, "reason is required for set_waiting_state."),
    resumeWhen: requireText(
      input.params.resumeWhen,
      "resumeWhen is required for set_waiting_state.",
    ),
  });

  return {
    threadId,
    waitingSince: waitingState.since,
  };
}

function resolveThreadId(
  store: StructuredSessionStateStore,
  runtime: StructuredSessionToolRuntimeContext,
  params: StructuredSessionStateToolParams,
): string {
  const threadId = normalizeOptionalText(params.threadId);
  if (threadId) {
    return threadId;
  }

  const threadAlias = normalizeOptionalText(params.threadAlias);
  if (threadAlias) {
    const resolved = runtime.threadAliases.get(threadAlias);
    if (!resolved) {
      throw new Error(`Unknown threadAlias: ${threadAlias}`);
    }
    return resolved;
  }

  if (params.waitingWorkflow) {
    const waitingWorkflow = findWaitingWorkflow(store, runtime.sessionId);
    if (!waitingWorkflow) {
      throw new Error(`No waiting workflow thread for session ${runtime.sessionId}.`);
    }
    return waitingWorkflow.threadId;
  }

  if (runtime.latestThreadId) {
    return runtime.latestThreadId;
  }

  const waitingWorkflow = findWaitingWorkflow(store, runtime.sessionId);
  if (waitingWorkflow) {
    return waitingWorkflow.threadId;
  }

  throw new Error("A threadId, threadAlias, or waitingWorkflow=true reference is required.");
}

function resolveWorkflowId(
  store: StructuredSessionStateStore,
  runtime: StructuredSessionToolRuntimeContext,
  params: StructuredSessionStateToolParams,
): string {
  const workflowId = normalizeOptionalText(params.workflowId);
  if (workflowId) {
    return workflowId;
  }

  const workflowAlias = normalizeOptionalText(params.workflowAlias);
  if (workflowAlias) {
    const resolved = runtime.workflowAliases.get(workflowAlias);
    if (!resolved) {
      throw new Error(`Unknown workflowAlias: ${workflowAlias}`);
    }
    return resolved;
  }

  if (params.waitingWorkflow) {
    const waitingWorkflow = findWaitingWorkflow(store, runtime.sessionId);
    if (!waitingWorkflow?.workflowId) {
      throw new Error(`No waiting workflow projection for session ${runtime.sessionId}.`);
    }
    return waitingWorkflow.workflowId;
  }

  if (runtime.latestWorkflowId) {
    return runtime.latestWorkflowId;
  }

  const waitingWorkflow = findWaitingWorkflow(store, runtime.sessionId);
  if (waitingWorkflow?.workflowId) {
    return waitingWorkflow.workflowId;
  }

  const threadId =
    normalizeOptionalText(params.threadId) ||
    (normalizeOptionalText(params.threadAlias) ? resolveThreadId(store, runtime, params) : null);
  if (threadId) {
    const detail = store.getThreadDetail(threadId);
    if (!detail.workflow) {
      throw new Error(`Thread ${threadId} does not have a workflow projection.`);
    }
    return detail.workflow.id;
  }

  throw new Error(
    "A workflowId, workflowAlias, thread reference, or waitingWorkflow=true reference is required.",
  );
}

function findWaitingWorkflow(
  store: StructuredSessionStateStore,
  sessionId: string,
): { threadId: string; workflowId: string | null } | null {
  const snapshot = store.getSessionState(sessionId);
  const waitingOwnerId = snapshot.session.waitingOn?.threadId;
  if (waitingOwnerId) {
    const waitingOwner = snapshot.threads.find(
      (thread) => thread.id === waitingOwnerId && thread.kind === "workflow",
    );
    if (waitingOwner) {
      const workflow = snapshot.workflows.find((candidate) => candidate.threadId === waitingOwner.id);
      return {
        threadId: waitingOwner.id,
        workflowId: workflow?.id ?? null,
      };
    }
  }

  const waitingThread = snapshot.threads
    .filter((thread) => thread.kind === "workflow" && thread.status === "waiting")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!waitingThread) {
    return null;
  }

  const workflow = snapshot.workflows.find((candidate) => candidate.threadId === waitingThread.id);
  return {
    threadId: waitingThread.id,
    workflowId: workflow?.id ?? null,
  };
}

function materializeBlockedOn(
  blockedOn: StructuredSessionStateToolParams["blockedOn"],
): StructuredThreadBlockedOn {
  if (!blockedOn) {
    throw new Error("blockedOn is required.");
  }

  const since = new Date().toISOString();
  if (blockedOn.kind === "threads") {
    if (blockedOn.threadIds.length === 0) {
      throw new Error("blockedOn.threadIds must not be empty.");
    }

    return {
      kind: "threads",
      threadIds: blockedOn.threadIds,
      waitPolicy: blockedOn.waitPolicy,
      reason: blockedOn.reason,
      since,
    };
  }

  return {
    kind: blockedOn.kind,
    reason: blockedOn.reason,
    resumeWhen: blockedOn.resumeWhen,
    since,
  };
}

function normalizeParams(
  params: StructuredSessionStateToolParams,
): StructuredSessionStateToolParams & {
  command:
    | "start_thread"
    | "update_thread"
    | "set_thread_result"
    | "record_verification"
    | "start_workflow"
    | "update_workflow"
    | "set_waiting_state";
} {
  const command = normalizeCommand(params);
  return {
    ...params,
    command,
    threadKind:
      params.threadKind ??
      (command === "start_thread" ? (normalizeThreadKind(params.kind) ?? undefined) : undefined),
    threadStatus:
      params.threadStatus ??
      (command === "update_thread"
        ? (normalizeThreadStatus(params.status) ?? undefined)
        : undefined),
    resultKind:
      params.resultKind ??
      (command === "set_thread_result"
        ? (normalizeResultKind(params.kind) ?? undefined)
        : undefined),
    verificationKind:
      params.verificationKind ??
      (command === "record_verification" ? normalizeOptionalText(params.kind) ?? undefined : undefined),
    verificationStatus:
      params.verificationStatus ??
      (command === "record_verification"
        ? (normalizeVerificationStatus(params.status) ?? undefined)
        : undefined),
    workflowStatus:
      params.workflowStatus ??
      (command === "update_workflow"
        ? (normalizeWorkflowStatus(params.status) ?? undefined)
        : undefined),
    waitingKind:
      params.waitingKind ??
      (command === "set_waiting_state"
        ? (normalizeWaitingKind(params.kind) ?? undefined)
        : undefined),
    commandText:
      params.commandText ??
      (command === "record_verification" && params.operation
        ? normalizeOptionalText(params.command) ?? undefined
        : undefined),
  };
}

function normalizeCommand(
  params: StructuredSessionStateToolParams,
):
  | "start_thread"
  | "update_thread"
  | "set_thread_result"
  | "record_verification"
  | "start_workflow"
  | "update_workflow"
  | "set_waiting_state" {
  switch (params.operation) {
    case "startThread":
      return "start_thread";
    case "updateThread":
      return "update_thread";
    case "setThreadResult":
      return "set_thread_result";
    case "recordVerification":
      return "record_verification";
    case "startWorkflow":
      return "start_workflow";
    case "updateWorkflow":
      return "update_workflow";
    case "setWaitingState":
      return "set_waiting_state";
  }

  switch (params.command) {
    case "start_thread":
    case "update_thread":
    case "set_thread_result":
    case "record_verification":
    case "start_workflow":
    case "update_workflow":
    case "set_waiting_state":
      return params.command;
  }

  throw new Error("structured session lifecycle calls require a command or operation.");
}

function normalizeThreadKind(value: string | undefined): StructuredThreadKind | null {
  return value === "direct" || value === "verification" || value === "workflow" ? value : null;
}

function normalizeThreadStatus(value: string | undefined): StructuredThreadStatus | null {
  return value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "waiting"
    ? value
    : null;
}

function normalizeResultKind(value: string | undefined): StructuredThreadResultKind | null {
  return value === "analysis-summary" ||
    value === "change-summary" ||
    value === "verification-summary" ||
    value === "workflow-summary" ||
    value === "clarification-summary"
    ? value
    : null;
}

function normalizeVerificationStatus(
  value: string | undefined,
): StructuredVerificationStatus | null {
  return value === "passed" || value === "failed" || value === "cancelled" ? value : null;
}

function normalizeWorkflowStatus(value: string | undefined): StructuredWorkflowStatus | null {
  return value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "waiting"
    ? value
    : null;
}

function normalizeWaitingKind(value: string | undefined): "user" | "external" | null {
  return value === "user" || value === "external" ? value : null;
}

function requireField<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function requireText(value: string | undefined, message: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
