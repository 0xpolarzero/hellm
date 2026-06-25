import type {
  GetCurrentRuntimeThreadInput,
  GetRuntimeThreadGroupInput,
  ListRuntimeThreadsInput,
  NativeToolResult,
  ReadRuntimeThreadEpisodesInput,
  RuntimeThreadCurrentReadModel,
  RuntimeThreadEpisodesReadModel,
  RuntimeThreadGroupReadModel,
  RuntimeThreadListReadModel,
  RuntimeCommandStatePortService,
  RuntimeReadModelStatePortService,
  RuntimeTurnStatePortService,
  StateContractError,
  CommandFactsPayload,
  JsonValue,
} from "@svvy/core";
import type { NativeToolDefinition } from "@svvy/extensions";
import { Type, type Static } from "typebox";
import type { PromptExecutionRuntimeHandle } from "@svvy/core";
import type * as Effect from "effect/Effect";

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

export interface ThreadStateToolServices {
  commandState: RuntimeCommandStatePortService;
  readModelState: RuntimeReadModelStatePortService;
  turnState: RuntimeTurnStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
}

export function createThreadCurrentTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: ThreadStateToolServices;
}): NativeToolDefinition<EmptyParams, RuntimeThreadCurrentReadModel> {
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
          state: options.state,
          runtime,
          toolCallId: _toolCallId,
          toolName: THREAD_CURRENT_TOOL_NAME,
          title: "Inspect current handler thread",
          summary: "Inspect current handler thread.",
          arguments: {},
          turnDecision: "thread_current",
          details: () => {
            if (runtime.surfaceKind !== "handler" || !runtime.threadId) {
              throw new Error(`${THREAD_CURRENT_TOOL_NAME} can only run from a handler thread.`);
            }
            return options.state.runState(
              options.state.readModelState.getCurrentThread({
                workspaceSessionId:
                  runtime.workspaceSessionId as GetCurrentRuntimeThreadInput["workspaceSessionId"],
                threadId: runtime.threadId as GetCurrentRuntimeThreadInput["threadId"],
              }),
            );
          },
        }),
      );
    },
  };
}

export function createThreadListTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: ThreadStateToolServices;
}): NativeToolDefinition<ThreadListParams, RuntimeThreadListReadModel> {
  return {
    label: "Thread List",
    name: THREAD_LIST_TOOL_NAME,
    description:
      "List delegated handler threads that may need attention, with compact objective, status, wait, and latest episode metadata.",
    parameters: threadListParamsSchema,
    async execute(_toolCallId, params: ThreadListParams) {
      const runtime = requireActiveRuntime(options.runtime, THREAD_LIST_TOOL_NAME);
      const threadGroupId = params.threadGroupId?.trim() || null;
      const limit = clampLimit(params.limit, 20, 100);
      const details = options.state.runState(
        options.state.readModelState.listThreads({
          workspaceSessionId:
            runtime.workspaceSessionId as ListRuntimeThreadsInput["workspaceSessionId"],
          status: params.status,
          threadGroupId: threadGroupId as ListRuntimeThreadsInput["threadGroupId"],
          limit,
        }),
      );
      return jsonToolResult(
        recordReadOnlyToolCommand({
          state: options.state,
          runtime,
          toolCallId: _toolCallId,
          toolName: THREAD_LIST_TOOL_NAME,
          title: "List handler threads",
          summary: `List ${details.threads.length} handler threads.`,
          arguments: {
            ...(params.status ? { status: params.status } : {}),
            ...(threadGroupId ? { threadGroupId } : {}),
            limit,
          },
          turnDecision: "thread_list",
          details: () => details,
        }),
      );
    },
  };
}

export function createThreadEpisodesTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: ThreadStateToolServices;
}): NativeToolDefinition<ThreadEpisodesParams, RuntimeThreadEpisodesReadModel> {
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
          state: options.state,
          runtime,
          toolCallId: _toolCallId,
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
            if (threadId && threadGroupId) {
              throw new Error(
                `${THREAD_EPISODES_TOOL_NAME} accepts threadId or threadGroupId, not both.`,
              );
            }
            const resolvedThreadId =
              threadId ??
              (!threadGroupId && runtime.surfaceKind === "handler" ? runtime.threadId : null);
            if (!resolvedThreadId && !threadGroupId) {
              throw new Error(
                `${THREAD_EPISODES_TOOL_NAME} requires threadId or threadGroupId outside a handler thread.`,
              );
            }
            return options.state.runState(
              options.state.readModelState.readThreadEpisodes({
                workspaceSessionId:
                  runtime.workspaceSessionId as ReadRuntimeThreadEpisodesInput["workspaceSessionId"],
                threadId: resolvedThreadId as ReadRuntimeThreadEpisodesInput["threadId"],
                threadGroupId: threadGroupId as ReadRuntimeThreadEpisodesInput["threadGroupId"],
                limit,
              }),
            );
          },
        }),
      );
    },
  };
}

export function createThreadGroupTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: ThreadStateToolServices;
}): NativeToolDefinition<EmptyParams, RuntimeThreadGroupReadModel> {
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
          state: options.state,
          runtime,
          toolCallId: _toolCallId,
          toolName: THREAD_GROUP_TOOL_NAME,
          title: "Inspect handler thread group",
          summary: "Inspect handler thread group.",
          arguments: {},
          turnDecision: "thread_group",
          details: () => {
            if (runtime.surfaceKind !== "handler" || !runtime.threadId) {
              throw new Error(`${THREAD_GROUP_TOOL_NAME} can only run from a handler thread.`);
            }
            return options.state.runState(
              options.state.readModelState.getThreadGroup({
                workspaceSessionId:
                  runtime.workspaceSessionId as GetRuntimeThreadGroupInput["workspaceSessionId"],
                currentThreadId: runtime.threadId as GetRuntimeThreadGroupInput["currentThreadId"],
              }),
            );
          },
        }),
      );
    },
  };
}

function recordReadOnlyToolCommand<TDetails extends object>(input: {
  state: ThreadStateToolServices;
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
  toolCallId: string;
  toolName: string;
  title: string;
  summary: string;
  arguments: JsonValue;
  turnDecision?: "thread_current" | "thread_list" | "thread_episodes" | "thread_group";
  details: () => TDetails;
}): TDetails {
  if (input.turnDecision) {
    input.state.runState(
      input.state.turnState.setTurnDecision({
        turnId: input.runtime.turnId!,
        decision: input.turnDecision,
        onlyIfPending: true,
      }),
    );
  }
  const command = input.state.runState(
    input.state.commandState.createOrReuseStreamingCommand({
      toolCallId: input.toolCallId,
      turnId: input.runtime.turnId,
      surfacePiSessionId: input.runtime.surfacePiSessionId,
      threadId: input.runtime.surfaceKind === "handler" ? input.runtime.threadId : null,
      toolName: input.toolName,
      executor: input.runtime.surfaceKind === "handler" ? "handler" : "orchestrator",
      visibility: "surface",
      title: input.title,
      summary: input.summary,
      arguments: input.arguments,
    }),
  ).value;
  input.state.runState(input.state.commandState.startCommand({ commandId: command.id }));
  try {
    const details = input.details();
    input.state.runState(
      input.state.commandState.finishCommand({
        commandId: command.id,
        status: "succeeded",
        summary: input.summary,
        facts: details as CommandFactsPayload,
      }),
    );
    return details;
  } catch (error) {
    const message = error instanceof Error ? error.message : `${input.toolName} failed.`;
    input.state.runState(
      input.state.commandState.finishCommand({
        commandId: command.id,
        status: "failed",
        summary: message,
        error: message,
      }),
    );
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

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value ?? NaN)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.trunc(value!)));
}

function jsonToolResult<TDetails>(details: TDetails): NativeToolResult<TDetails> {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}
