import type { NativeToolDefinition } from "@svvy/extensions";
import { Type, type Static } from "typebox";
import type { PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import { nativeToolParameters } from "./native-tool-parameters";
import type {
  CommandFactsPayload,
  RuntimeCommandStatePortService,
  RuntimeTurnStatePortService,
  StateContractError,
} from "@svvy/core";
import type * as Effect from "effect/Effect";

export const THREAD_FOLLOWUP_TOOL_NAME = "thread_followup";
export const THREAD_REQUEST_REPORT_TOOL_NAME = "thread_request_report";

export const threadFollowupParamsSchema = Type.Object(
  {
    threadIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
    threadGroupId: Type.Optional(Type.String({ minLength: 1 })),
    message: Type.String({ minLength: 1 }),
    activate: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const threadRequestReportParamsSchema = Type.Object(
  {
    threadId: Type.String({ minLength: 1 }),
    request: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type ThreadFollowupParams = Static<typeof threadFollowupParamsSchema>;
export type ThreadRequestReportParams = Static<typeof threadRequestReportParamsSchema>;

export interface ThreadFollowupQueueResult {
  [key: string]: unknown;
  threadGroupId: string | null;
  threads: Array<{
    threadId: string;
    surfacePiSessionId: string;
    objectiveState: "active" | "concluded";
    queuedMessageId: string;
  }>;
}

export interface ThreadRequestReportQueueResult {
  [key: string]: unknown;
  threadId: string;
  surfacePiSessionId: string;
  queuedMessageId: string;
}

export interface ThreadOrchestrationBridge {
  queueThreadFollowup(input: {
    runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
    commandId: string;
    threadIds: string[] | null;
    threadGroupId: string | null;
    message: string;
    activate: boolean;
  }): Promise<ThreadFollowupQueueResult>;
  queueThreadReportRequest(input: {
    runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
    commandId: string;
    threadId: string;
    request: string | null;
  }): Promise<ThreadRequestReportQueueResult>;
}

export function createThreadFollowupTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  commandState: RuntimeCommandStatePortService;
  turnState: RuntimeTurnStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  bridge: ThreadOrchestrationBridge;
}): NativeToolDefinition<ThreadFollowupParams> {
  return {
    label: "Thread Followup",
    name: THREAD_FOLLOWUP_TOOL_NAME,
    description:
      "Queue corrections, clarifications, or later instructions to exact handler threads or one thread group.",
    parameters: nativeToolParameters(threadFollowupParamsSchema),
    execute: async (_toolCallId, params) => {
      const runtime = requireActiveOrchestratorRuntime(options.runtime, THREAD_FOLLOWUP_TOOL_NAME);
      const message = params.message.trim();
      const threadIds =
        params.threadIds?.map((threadId) => threadId.trim()).filter(Boolean) ?? null;
      const threadGroupId = params.threadGroupId?.trim() || null;

      options.runState(
        options.turnState.setTurnDecision({
          turnId: runtime.turnId!,
          decision: "thread_followup",
          onlyIfPending: true,
        }),
      );
      const command = options.runState(
        options.commandState.createOrReuseStreamingCommand({
          toolCallId: _toolCallId,
          turnId: runtime.turnId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId: runtime.rootThreadId ?? null,
          toolName: THREAD_FOLLOWUP_TOOL_NAME,
          executor: "orchestrator",
          visibility: "surface",
          title: "Queue thread follow-up",
          summary: message,
          arguments: {
            ...(threadIds ? { threadIds } : {}),
            ...(threadGroupId ? { threadGroupId } : {}),
            message,
            activate: params.activate ?? false,
          },
        }),
      ).value;
      options.runState(options.commandState.startCommand({ commandId: command.id }));
      const validationError = !message
        ? `${THREAD_FOLLOWUP_TOOL_NAME} requires a non-empty message.`
        : (threadIds?.length ?? 0) === 0 && !threadGroupId
          ? `${THREAD_FOLLOWUP_TOOL_NAME} requires threadIds or threadGroupId.`
          : (threadIds?.length ?? 0) > 0 && threadGroupId
            ? `${THREAD_FOLLOWUP_TOOL_NAME} accepts threadIds or threadGroupId, not both.`
            : null;
      if (validationError) {
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: validationError,
            error: validationError,
          }),
        );
        throw new Error(validationError);
      }

      try {
        const details = await options.bridge.queueThreadFollowup({
          runtime,
          commandId: command.id,
          threadIds,
          threadGroupId,
          message,
          activate: params.activate ?? false,
        });
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "succeeded",
            summary: message,
            facts: details as CommandFactsPayload,
          }),
        );
        return jsonToolResult(details);
      } catch (error) {
        const failure =
          error instanceof Error ? error.message : "Failed to queue handler thread follow-up.";
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: failure,
            error: failure,
          }),
        );
        return jsonToolResult({
          threadGroupId,
          threads: [],
          error: failure,
        });
      }
    },
  };
}

export function createThreadRequestReportTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  commandState: RuntimeCommandStatePortService;
  turnState: RuntimeTurnStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  bridge: ThreadOrchestrationBridge;
}): NativeToolDefinition<ThreadRequestReportParams> {
  return {
    label: "Thread Request Report",
    name: THREAD_REQUEST_REPORT_TOOL_NAME,
    description:
      "Ask one handler thread for an explicit thread_report update without changing its objective.",
    parameters: nativeToolParameters(threadRequestReportParamsSchema),
    execute: async (_toolCallId, params) => {
      const runtime = requireActiveOrchestratorRuntime(
        options.runtime,
        THREAD_REQUEST_REPORT_TOOL_NAME,
      );
      const threadId = params.threadId.trim();
      const request = params.request?.trim() || null;
      options.runState(
        options.turnState.setTurnDecision({
          turnId: runtime.turnId!,
          decision: "thread_request_report",
          onlyIfPending: true,
        }),
      );
      const command = options.runState(
        options.commandState.createOrReuseStreamingCommand({
          toolCallId: _toolCallId,
          turnId: runtime.turnId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId: runtime.rootThreadId ?? null,
          toolName: THREAD_REQUEST_REPORT_TOOL_NAME,
          executor: "orchestrator",
          visibility: "surface",
          title: "Request thread report",
          summary: request ?? `Request report from ${threadId}`,
          arguments: {
            threadId,
            ...(request ? { request } : {}),
          },
        }),
      ).value;
      options.runState(options.commandState.startCommand({ commandId: command.id }));

      try {
        const details = await options.bridge.queueThreadReportRequest({
          runtime,
          commandId: command.id,
          threadId,
          request,
        });
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "succeeded",
            summary: request ?? `Requested report from ${threadId}.`,
            facts: details as CommandFactsPayload,
          }),
        );
        return jsonToolResult(details);
      } catch (error) {
        const failure =
          error instanceof Error ? error.message : "Failed to request a handler thread report.";
        options.runState(
          options.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: failure,
            error: failure,
          }),
        );
        return jsonToolResult({
          threadId,
          surfacePiSessionId: "",
          queuedMessageId: "",
          error: failure,
        });
      }
    },
  };
}

function requireActiveOrchestratorRuntime(
  runtimeHandle: PromptExecutionRuntimeHandle,
  toolName: string,
): NonNullable<PromptExecutionRuntimeHandle["current"]> {
  const runtime = runtimeHandle.current;
  if (!runtime) {
    throw new Error(`${toolName} can only run during an active prompt.`);
  }
  if (runtime.surfaceKind !== "orchestrator") {
    throw new Error(`${toolName} can only run from the orchestrator.`);
  }
  return runtime;
}

function jsonToolResult<T>(details: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(details),
      },
    ],
    details: { commandFacts: details as CommandFactsPayload },
  };
}
