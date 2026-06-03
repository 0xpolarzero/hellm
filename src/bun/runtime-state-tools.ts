import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type {
  StructuredEpisodeRecord,
  StructuredSessionSnapshot,
  StructuredSessionStateStore,
  StructuredThreadRecord,
  StructuredThreadStatus,
  StructuredWaitState,
  StructuredWorkflowRunRecord,
} from "./structured-session-state";

export const THREAD_CURRENT_TOOL_NAME = "thread_current";
export const THREAD_LIST_TOOL_NAME = "thread_list";
export const THREAD_HANDOFFS_TOOL_NAME = "thread_handoffs";

const emptyParamsSchema = Type.Object({}, { additionalProperties: false });

const threadStatusSchema = Type.Union([
  Type.Literal("running-handler"),
  Type.Literal("running-workflow"),
  Type.Literal("waiting"),
  Type.Literal("idle"),
  Type.Literal("troubleshooting"),
  Type.Literal("completed"),
]);

const threadListParamsSchema = Type.Object(
  {
    status: Type.Optional(Type.Array(threadStatusSchema)),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const threadHandoffsParamsSchema = Type.Object(
  {
    threadId: Type.Optional(Type.String({ minLength: 1 })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);

type EmptyParams = Static<typeof emptyParamsSchema>;
type ThreadListParams = Static<typeof threadListParamsSchema>;
type ThreadHandoffsParams = Static<typeof threadHandoffsParamsSchema>;

type ToolWait = {
  kind: "user" | "external";
  reason: string;
  resumeWhen: string;
};

type ToolHandoffSummary = {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
};

type ToolThreadRow = {
  id: string;
  title: string;
  objective: string;
  status: StructuredThreadStatus;
  wait: ToolWait | null;
  activeWorkflowRunIds: string[];
  latestHandoff: ToolHandoffSummary | null;
};

type ListUnresolvedWorkflowRuns = (input: {
  sessionId: string;
  threadId: string;
}) => Promise<Array<{ smithersRunId: string }>>;

type ThreadCurrentDetails = ToolThreadRow & {
  loadedContextKeys: string[];
};

type ThreadListDetails = {
  threads: ToolThreadRow[];
};

type ThreadHandoffsDetails = {
  handoffs: Array<{
    id: string;
    threadId: string;
    title: string;
    summary: string;
    body: string;
    createdAt: string;
  }>;
};

export function createThreadCurrentTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  listUnresolvedWorkflowRuns?: ListUnresolvedWorkflowRuns;
}): AgentTool<typeof emptyParamsSchema, ThreadCurrentDetails> {
  return {
    label: "Thread Current",
    name: THREAD_CURRENT_TOOL_NAME,
    description:
      "Return the current handler thread objective, state, wait, loaded context keys, active workflow run ids, and latest handoff.",
    parameters: emptyParamsSchema,
    async execute(_toolCallId, _params: EmptyParams) {
      const runtime = requireActiveRuntime(options.runtime, THREAD_CURRENT_TOOL_NAME);
      if (runtime.surfaceKind !== "handler" || !runtime.surfaceThreadId) {
        throw new Error(`${THREAD_CURRENT_TOOL_NAME} can only run from a handler thread.`);
      }

      const snapshot = options.store.getSessionState(runtime.sessionId);
      const thread = findThread(snapshot, runtime.surfaceThreadId, THREAD_CURRENT_TOOL_NAME);
      return jsonToolResult(
        await buildThreadCurrentDetails(snapshot, thread, options.listUnresolvedWorkflowRuns),
      );
    },
  };
}

export function createThreadListTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  listUnresolvedWorkflowRuns?: ListUnresolvedWorkflowRuns;
}): AgentTool<typeof threadListParamsSchema, ThreadListDetails> {
  return {
    label: "Thread List",
    name: THREAD_LIST_TOOL_NAME,
    description:
      "List delegated handler threads that may need attention, with compact objective, status, wait, active workflow run ids, and latest handoff metadata.",
    parameters: threadListParamsSchema,
    async execute(_toolCallId, params: ThreadListParams) {
      const runtime = requireActiveRuntime(options.runtime, THREAD_LIST_TOOL_NAME);
      const snapshot = options.store.getSessionState(runtime.sessionId);
      const statusFilter = params.status ? new Set(params.status) : null;
      const limit = clampLimit(params.limit, 20, 100);
      const threads = await Promise.all(
        snapshot.threads
          .filter((thread) => !statusFilter || statusFilter.has(thread.status))
          .toSorted(compareThreadsByAttention)
          .slice(0, limit)
          .map((thread) => buildThreadRow(snapshot, thread, options.listUnresolvedWorkflowRuns)),
      );
      return jsonToolResult({ threads });
    },
  };
}

export function createThreadHandoffsTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof threadHandoffsParamsSchema, ThreadHandoffsDetails> {
  return {
    label: "Thread Handoffs",
    name: THREAD_HANDOFFS_TOOL_NAME,
    description: "Read durable handler-thread handoff episodes when exact handoff content matters.",
    parameters: threadHandoffsParamsSchema,
    async execute(_toolCallId, params: ThreadHandoffsParams) {
      const runtime = requireActiveRuntime(options.runtime, THREAD_HANDOFFS_TOOL_NAME);
      const snapshot = options.store.getSessionState(runtime.sessionId);
      const limit = clampLimit(params.limit, 10, 50);
      const threadId = params.threadId?.trim() || null;
      const resolvedThreadId =
        threadId ?? (runtime.surfaceKind === "handler" ? runtime.surfaceThreadId : null);
      if (threadId) {
        findThread(snapshot, threadId, THREAD_HANDOFFS_TOOL_NAME);
      }

      const handoffs = snapshot.episodes
        .filter((episode) => !resolvedThreadId || episode.threadId === resolvedThreadId)
        .toSorted((left, right) => compareTimestampDesc(left.createdAt, right.createdAt))
        .slice(0, limit)
        .map((episode) => ({
          id: episode.id,
          threadId: episode.threadId,
          title: episode.title,
          summary: episode.summary,
          body: episode.body,
          createdAt: episode.createdAt,
        }));
      return jsonToolResult({ handoffs });
    },
  };
}

function requireActiveRuntime(
  runtimeHandle: PromptExecutionRuntimeHandle,
  toolName: string,
): NonNullable<PromptExecutionRuntimeHandle["current"]> {
  const runtime = runtimeHandle.current;
  if (!runtime) {
    throw new Error(`${toolName} can only run during an active prompt.`);
  }
  return runtime;
}

function findThread(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
  toolName: string,
): StructuredThreadRecord {
  const thread = snapshot.threads.find((entry) => entry.id === threadId) ?? null;
  if (!thread) {
    throw new Error(`${toolName} could not find thread ${threadId}.`);
  }
  return thread;
}

async function buildThreadCurrentDetails(
  snapshot: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
  listUnresolvedWorkflowRuns?: ListUnresolvedWorkflowRuns,
): Promise<ThreadCurrentDetails> {
  return {
    ...(await buildThreadRow(snapshot, thread, listUnresolvedWorkflowRuns)),
    loadedContextKeys: thread.loadedContextKeys.slice(),
  };
}

async function buildThreadRow(
  snapshot: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
  listUnresolvedWorkflowRuns?: ListUnresolvedWorkflowRuns,
): Promise<ToolThreadRow> {
  return {
    id: thread.id,
    title: thread.title,
    objective: thread.objective,
    status: thread.status,
    wait: normalizeWait(thread.wait),
    activeWorkflowRunIds: await getActiveWorkflowRunIds(
      snapshot,
      thread.id,
      listUnresolvedWorkflowRuns,
    ),
    latestHandoff: buildLatestHandoffSummary(snapshot, thread.id),
  };
}

function normalizeWait(wait: StructuredWaitState | null): ToolWait | null {
  if (!wait) {
    return null;
  }
  return {
    kind: wait.kind === "user" ? "user" : "external",
    reason: wait.reason,
    resumeWhen: wait.resumeWhen,
  };
}

async function getActiveWorkflowRunIds(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
  listUnresolvedWorkflowRuns?: ListUnresolvedWorkflowRuns,
): Promise<string[]> {
  if (listUnresolvedWorkflowRuns) {
    return (
      await listUnresolvedWorkflowRuns({
        sessionId: snapshot.session.id,
        threadId,
      })
    ).map((run) => run.smithersRunId);
  }

  return snapshot.workflowRuns
    .filter((run) => run.threadId === threadId)
    .filter((run) => run.status === "running" || run.status === "waiting")
    .toSorted(compareWorkflowRunsByRecency)
    .map((run) => run.smithersRunId);
}

function buildLatestHandoffSummary(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
): ToolHandoffSummary | null {
  const episode = getLatestHandoff(snapshot, threadId);
  if (!episode) {
    return null;
  }
  return {
    id: episode.id,
    title: episode.title,
    summary: episode.summary,
    createdAt: episode.createdAt,
  };
}

function getLatestHandoff(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
): StructuredEpisodeRecord | null {
  return (
    snapshot.episodes
      .filter((episode) => episode.threadId === threadId)
      .toSorted((left, right) => compareTimestampDesc(left.createdAt, right.createdAt))[0] ?? null
  );
}

function compareThreadsByAttention(
  left: StructuredThreadRecord,
  right: StructuredThreadRecord,
): number {
  const statusDelta = threadStatusPriority(left.status) - threadStatusPriority(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  const timestampDelta = compareTimestampDesc(left.updatedAt, right.updatedAt);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return left.id.localeCompare(right.id);
}

function threadStatusPriority(status: StructuredThreadStatus): number {
  switch (status) {
    case "waiting":
      return 0;
    case "troubleshooting":
      return 1;
    case "running-handler":
      return 2;
    case "running-workflow":
      return 3;
    case "idle":
      return 4;
    case "completed":
      return 5;
  }
}

function compareWorkflowRunsByRecency(
  left: StructuredWorkflowRunRecord,
  right: StructuredWorkflowRunRecord,
): number {
  const timestampDelta = compareTimestampDesc(left.updatedAt, right.updatedAt);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return left.smithersRunId.localeCompare(right.smithersRunId);
}

function compareTimestampDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(value!)));
}

function jsonToolResult<TDetails>(details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}
