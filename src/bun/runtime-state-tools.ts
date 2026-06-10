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
  StructuredTurnDecision,
  StructuredWaitState,
} from "./structured-session-state";

export const THREAD_CURRENT_TOOL_NAME = "thread_current";
export const THREAD_LIST_TOOL_NAME = "thread_list";
export const THREAD_EPISODES_TOOL_NAME = "thread_episodes";
export const THREAD_GROUP_TOOL_NAME = "thread_group";

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
    threadGroupId: Type.Optional(Type.String({ minLength: 1 })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const threadEpisodesParamsSchema = Type.Object(
  {
    threadId: Type.Optional(Type.String({ minLength: 1 })),
    threadGroupId: Type.Optional(Type.String({ minLength: 1 })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);

type EmptyParams = Static<typeof emptyParamsSchema>;
type ThreadListParams = Static<typeof threadListParamsSchema>;
type ThreadEpisodesParams = Static<typeof threadEpisodesParamsSchema>;

type ToolWait = {
  kind: "user" | "external";
  reason: string;
  resumeWhen: string;
};

type ToolEpisodeSummary = {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
};

type ToolThreadRow = {
  threadId: string;
  threadGroupId: string;
  workspaceSessionId: string;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  objectiveState: "active" | "concluded";
  status: StructuredThreadStatus;
  wait: ToolWait | null;
  latestEpisode: ToolEpisodeSummary | null;
};

type ThreadCurrentDetails = ToolThreadRow & {
  pendingReportRequests: ToolPendingReportRequest[];
  loadedExtensionIds: string[];
  availableExtensionIds: string[];
};

type ThreadListDetails = {
  threads: ToolThreadRow[];
};

type ThreadEpisodesDetails = {
  episodes: Array<{
    id: string;
    threadId: string;
    title: string;
    summary: string;
    body: string;
    createdAt: string;
  }>;
};

type ToolPendingReportRequest = {
  queuedMessageId: string;
  request: string;
  createdAt: string;
};

type ThreadGroupDetails = {
  threadGroupId: string;
  currentThreadId: string;
  threads: ToolThreadRow[];
};

export function createThreadCurrentTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof emptyParamsSchema, ThreadCurrentDetails> {
  return {
    label: "Thread Current",
    name: THREAD_CURRENT_TOOL_NAME,
    description:
      "Return the current handler thread identity, objective state, extension ids, report requests, and latest episode.",
    parameters: emptyParamsSchema,
    async execute(_toolCallId, _params: EmptyParams) {
      const runtime = requireActiveRuntime(options.runtime, THREAD_CURRENT_TOOL_NAME);
      return jsonToolResult(
        recordReadOnlyToolCommand({
          store: options.store,
          runtime,
          toolName: THREAD_CURRENT_TOOL_NAME,
          title: "Inspect current handler thread",
          summary: "Inspect current handler thread.",
          arguments: {},
          details: () => {
            if (runtime.surfaceKind !== "handler" || !runtime.surfaceThreadId) {
              throw new Error(`${THREAD_CURRENT_TOOL_NAME} can only run from a handler thread.`);
            }
            const snapshot = options.store.getSessionState(runtime.sessionId);
            const thread = findThread(snapshot, runtime.surfaceThreadId, THREAD_CURRENT_TOOL_NAME);
            return buildThreadCurrentDetails(snapshot, thread);
          },
        }),
      );
    },
  };
}

export function createThreadListTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof threadListParamsSchema, ThreadListDetails> {
  return {
    label: "Thread List",
    name: THREAD_LIST_TOOL_NAME,
    description:
      "List delegated handler threads that may need attention, with compact objective, status, wait, and latest episode metadata.",
    parameters: threadListParamsSchema,
    async execute(_toolCallId, params: ThreadListParams) {
      const runtime = requireActiveRuntime(options.runtime, THREAD_LIST_TOOL_NAME);
      const snapshot = options.store.getSessionState(runtime.sessionId);
      const statusFilter = params.status ? new Set(params.status) : null;
      const threadGroupId = params.threadGroupId?.trim() || null;
      const limit = clampLimit(params.limit, 20, 100);
      const threads = snapshot.threads
        .filter(
          (thread) =>
            (!statusFilter || statusFilter.has(thread.status)) &&
            (!threadGroupId || thread.threadGroupId === threadGroupId),
        )
        .toSorted(compareThreadsByAttention)
        .slice(0, limit)
        .map((thread) => buildThreadRow(snapshot, thread));
      return jsonToolResult(
        recordReadOnlyToolCommand({
          store: options.store,
          runtime,
          toolName: THREAD_LIST_TOOL_NAME,
          title: "List handler threads",
          summary: `List ${threads.length} handler threads.`,
          arguments: {
            ...(params.status ? { status: params.status } : {}),
            ...(threadGroupId ? { threadGroupId } : {}),
            limit,
          },
          details: () => ({ threads }),
        }),
      );
    },
  };
}

export function createThreadEpisodesTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof threadEpisodesParamsSchema, ThreadEpisodesDetails> {
  return {
    label: "Thread Episodes",
    name: THREAD_EPISODES_TOOL_NAME,
    description: "Read durable handler-thread episodes when exact episode content matters.",
    parameters: threadEpisodesParamsSchema,
    async execute(_toolCallId, params: ThreadEpisodesParams) {
      const runtime = requireActiveRuntime(options.runtime, THREAD_EPISODES_TOOL_NAME);
      const limit = clampLimit(params.limit, 10, 50);
      const threadId = params.threadId?.trim() || null;
      const threadGroupId = params.threadGroupId?.trim() || null;
      return jsonToolResult(
        recordReadOnlyToolCommand({
          store: options.store,
          runtime,
          toolName: THREAD_EPISODES_TOOL_NAME,
          title: "Read thread episodes",
          summary: "Read thread episodes.",
          arguments: {
            ...(threadId ? { threadId } : {}),
            ...(threadGroupId ? { threadGroupId } : {}),
            limit,
          },
          turnDecision: "thread_episodes",
          details: () => {
            const snapshot = options.store.getSessionState(runtime.sessionId);
            if (threadId && threadGroupId) {
              throw new Error(
                `${THREAD_EPISODES_TOOL_NAME} accepts threadId or threadGroupId, not both.`,
              );
            }
            const resolvedThreadId =
              threadId ??
              (!threadGroupId && runtime.surfaceKind === "handler"
                ? runtime.surfaceThreadId
                : null);
            if (threadId) {
              findThread(snapshot, threadId, THREAD_EPISODES_TOOL_NAME);
            }
            if (
              threadGroupId &&
              !snapshot.threads.some((thread) => thread.threadGroupId === threadGroupId)
            ) {
              throw new Error(
                `${THREAD_EPISODES_TOOL_NAME} could not find thread group ${threadGroupId}.`,
              );
            }

            const episodes = snapshot.episodes
              .filter((episode) => {
                if (resolvedThreadId) {
                  return episode.threadId === resolvedThreadId;
                }
                if (!threadGroupId) {
                  return true;
                }
                const thread =
                  snapshot.threads.find((entry) => entry.id === episode.threadId) ?? null;
                return thread?.threadGroupId === threadGroupId;
              })
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
            return { episodes };
          },
        }),
      );
    },
  };
}

export function createThreadGroupTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof emptyParamsSchema, ThreadGroupDetails> {
  return {
    label: "Thread Group",
    name: THREAD_GROUP_TOOL_NAME,
    description:
      "Return the current handler thread group topology and sibling objective summaries.",
    parameters: emptyParamsSchema,
    async execute(_toolCallId, _params: EmptyParams) {
      const runtime = requireActiveRuntime(options.runtime, THREAD_GROUP_TOOL_NAME);
      return jsonToolResult(
        recordReadOnlyToolCommand({
          store: options.store,
          runtime,
          toolName: THREAD_GROUP_TOOL_NAME,
          title: "Inspect handler thread group",
          summary: "Inspect handler thread group.",
          arguments: {},
          turnDecision: "thread_group",
          details: () => {
            if (runtime.surfaceKind !== "handler" || !runtime.surfaceThreadId) {
              throw new Error(`${THREAD_GROUP_TOOL_NAME} can only run from a handler thread.`);
            }
            const snapshot = options.store.getSessionState(runtime.sessionId);
            const currentThread = findThread(
              snapshot,
              runtime.surfaceThreadId,
              THREAD_GROUP_TOOL_NAME,
            );
            const threads = snapshot.threads
              .filter((thread) => thread.threadGroupId === currentThread.threadGroupId)
              .toSorted(compareThreadsByAttention)
              .map((thread) => buildThreadRow(snapshot, thread));
            return {
              threadGroupId: currentThread.threadGroupId,
              currentThreadId: currentThread.id,
              threads,
            };
          },
        }),
      );
    },
  };
}

function recordReadOnlyToolCommand<T extends Record<string, unknown>>(input: {
  store: StructuredSessionStateStore;
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
  toolName: string;
  title: string;
  summary: string;
  arguments: unknown;
  turnDecision?: Extract<StructuredTurnDecision, "thread_episodes" | "thread_group">;
  details: () => T;
}): T {
  if (input.turnDecision) {
    input.store.setTurnDecision({
      turnId: input.runtime.turnId,
      decision: input.turnDecision,
      onlyIfPending: true,
    });
  }
  const command = input.store.createCommand({
    turnId: input.runtime.turnId,
    surfacePiSessionId: input.runtime.surfacePiSessionId,
    threadId: input.runtime.surfaceKind === "handler" ? input.runtime.surfaceThreadId : null,
    toolName: input.toolName,
    executor: input.runtime.surfaceKind === "handler" ? "handler" : "orchestrator",
    visibility: "surface",
    title: input.title,
    summary: input.summary,
    arguments: input.arguments,
  });
  input.store.startCommand(command.id);
  try {
    const details = input.details();
    input.store.finishCommand({
      commandId: command.id,
      status: "succeeded",
      summary: input.summary,
      facts: details,
    });
    return details;
  } catch (error) {
    const message = error instanceof Error ? error.message : `${input.toolName} failed.`;
    input.store.finishCommand({
      commandId: command.id,
      status: "failed",
      summary: message,
      error: message,
    });
    throw error;
  }
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

function buildThreadCurrentDetails(
  snapshot: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
): ThreadCurrentDetails {
  return {
    ...buildThreadRow(snapshot, thread),
    pendingReportRequests: buildPendingReportRequests(snapshot, thread.id),
    loadedExtensionIds: thread.loadedExtensionIds.slice(),
    availableExtensionIds: thread.availableExtensionIds.slice(),
  };
}

function buildThreadRow(
  snapshot: StructuredSessionSnapshot,
  thread: StructuredThreadRecord,
): ToolThreadRow {
  return {
    threadId: thread.id,
    threadGroupId: thread.threadGroupId,
    workspaceSessionId: thread.sessionId,
    surfacePiSessionId: thread.surfacePiSessionId,
    title: thread.title,
    objective: thread.objective,
    objectiveState: thread.objectiveState,
    status: thread.status,
    wait: normalizeWait(thread.wait),
    latestEpisode: buildLatestEpisodeSummary(snapshot, thread.id),
  };
}

function buildPendingReportRequests(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
): ToolPendingReportRequest[] {
  return (snapshot.queuedMessages ?? [])
    .filter((message) => message.kind === "report_request" && message.threadId === threadId)
    .map((message) => ({
      queuedMessageId: message.id,
      request: getQueuedPayloadRequest(message.payloadJson) ?? message.requestSummary,
      createdAt: message.createdAt,
    }));
}

function getQueuedPayloadRequest(payloadJson: string | null): string | null {
  if (!payloadJson) {
    return null;
  }
  try {
    const payload = JSON.parse(payloadJson) as { request?: unknown };
    return typeof payload.request === "string" ? payload.request : null;
  } catch {
    return null;
  }
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

function buildLatestEpisodeSummary(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
): ToolEpisodeSummary | null {
  const episode = getLatestEpisode(snapshot, threadId);
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

function getLatestEpisode(
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
