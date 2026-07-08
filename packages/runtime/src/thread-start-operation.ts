import * as Effect from "effect/Effect";
import {
  RuntimeCommandStatePort,
  RuntimeContractError,
  decodeUnknownCommandResultEnvelopeEffect,
  type CommandFactsPayload,
  type CommandId,
  type NativeToolContent,
  type NativeToolResult,
  type PromptExecutionContext,
  type PromptTarget,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
} from "@svvy/core";
import {
  threadStartHandler,
  type ActorExtensionBinding,
  type ThreadStartHandlerInvocation,
  type ThreadStartInput,
} from "@svvy/extensions";
import {
  applyHandlerThreadStartRuntimeEffectRequest,
  type AppliedRuntimeEffectRequest,
  type StartedHandlerThreadsResult,
} from "./runtime-effect-requests";

export type RuntimeThreadStartCommandContext = {
  commandId: CommandId;
  target: Extract<PromptTarget, { surface: "orchestrator" }>;
  turnId: TurnId;
  approvalMode: "auto-review" | "user" | "full-access";
  approvalFacts?: Readonly<Record<string, unknown>>;
  sandbox: {
    snapshot: Readonly<Record<string, unknown>>;
    launchPolicy?: Readonly<Record<string, unknown>>;
  };
  cwd: string;
  baseEnv: Readonly<Record<string, string>>;
};

export type RunAcceptedThreadStartToolCallInput = {
  toolCallId: ToolCallId;
  toolItemId: ToolItemId;
  arguments: ThreadStartInput;
  context: PromptExecutionContext;
  actorBinding: ActorExtensionBinding;
  command: RuntimeThreadStartCommandContext;
};

export type RunAcceptedThreadStartToolCallResult = {
  toolResult: NativeToolResult;
  appliedEffects: readonly AppliedRuntimeEffectRequest[];
  result: StartedHandlerThreadsResult;
};

function runtimeError(input: {
  reason: ConstructorParameters<typeof RuntimeContractError>[0]["reason"];
  message: string;
  issues?: RuntimeContractError["issues"];
  cause?: unknown;
}): RuntimeContractError {
  return new RuntimeContractError({
    operation: "runtime.thread-start.run",
    reason: input.reason,
    message: input.message,
    ...(input.issues ? { issues: input.issues } : {}),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function buildHandlerInvocation(
  input: RunAcceptedThreadStartToolCallInput,
): ThreadStartHandlerInvocation {
  return {
    toolCallId: input.toolCallId,
    toolName: "thread_start",
    arguments: {
      schemaId: "thread_start.input",
      value: input.arguments,
    },
    context: input.context,
    actorBinding: input.actorBinding,
    command: input.command,
  };
}

function normalizeNativeToolContent(content: readonly unknown[] | undefined): NativeToolContent[] {
  if (!content) {
    return [];
  }
  return content.map((item) => {
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      (item as { type?: unknown }).type === "text" &&
      "text" in item &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      const textItem = item as unknown as { text: string; textSignature?: string | undefined };
      return {
        type: "text",
        text: textItem.text,
        ...(textItem.textSignature === undefined ? {} : { textSignature: textItem.textSignature }),
      };
    }
    const imageItem = item as { data: string; mimeType: string };
    return {
      type: "image",
      data: imageItem.data,
      mimeType: imageItem.mimeType,
    };
  });
}

function startedSummary(result: StartedHandlerThreadsResult): string {
  return result.threads.length === 1
    ? `Started 1 handler thread in group ${result.threadGroupId}.`
    : `Started ${result.threads.length} handler threads in group ${result.threadGroupId}.`;
}

function commandFactsForStartedThreads(result: StartedHandlerThreadsResult): CommandFactsPayload {
  return {
    kind: "thread_start",
    accepted: true,
    threadGroupId: result.threadGroupId,
    startedThreadCount: result.threads.length,
    threads: result.threads.map((thread) => ({
      threadId: thread.threadId,
      threadGroupId: thread.threadGroupId,
      surfacePiSessionId: thread.surfacePiSessionId,
      parentThreadId: thread.parentThreadId,
      objective: thread.objective,
      objectiveState: thread.objectiveState,
      queuedMessageId: thread.queuedMessageId,
    })),
  };
}

export const runAcceptedThreadStartToolCall = Effect.fn("@svvy/runtime/thread-start.runAccepted")(
  function* (input: RunAcceptedThreadStartToolCallInput) {
    const handlerResult = yield* threadStartHandler.invoke(buildHandlerInvocation(input)).pipe(
      Effect.mapError((cause) =>
        runtimeError({
          reason: "invalid-input",
          message: cause.message,
          ...(cause.issues ? { issues: cause.issues } : {}),
          cause,
        }),
      ),
    );

    const appliedEffects: AppliedRuntimeEffectRequest[] = [];
    for (const operation of handlerResult.operations ?? []) {
      if (
        operation.kind !== "runtime_effect" ||
        operation.request.type !== "handler_thread.start"
      ) {
        return yield* Effect.fail(
          runtimeError({
            reason: "invalid-input",
            message: "thread_start handler returned an unsupported runtime operation.",
          }),
        );
      }
      appliedEffects.push(
        yield* applyHandlerThreadStartRuntimeEffectRequest(
          {
            target: input.command.target,
            turnId: input.command.turnId,
            toolItemId: input.toolItemId,
            commandId: input.command.commandId,
          },
          operation.request,
        ),
      );
    }

    const threadStartEffect = appliedEffects.find(
      (effect) => effect.type === "handler_thread.start",
    );
    if (threadStartEffect?.type !== "handler_thread.start") {
      return yield* Effect.fail(
        runtimeError({
          reason: "invalid-input",
          message: "thread_start handler did not start handler threads.",
        }),
      );
    }

    const details = yield* decodeUnknownCommandResultEnvelopeEffect(
      handlerResult.result.details,
    ).pipe(
      Effect.mapError((cause) =>
        runtimeError({
          reason: "invalid-input",
          message: "thread_start handler returned invalid command details.",
          cause,
        }),
      ),
    );

    const commandState = yield* RuntimeCommandStatePort;
    const facts = commandFactsForStartedThreads(threadStartEffect.result);
    const summary = startedSummary(threadStartEffect.result);
    yield* commandState
      .finishCommand({
        commandId: input.command.commandId,
        status: "succeeded",
        summary,
        facts,
      })
      .pipe(
        Effect.mapError((cause) =>
          runtimeError({
            reason: "stale-state",
            message: "Failed to finish thread_start command.",
            cause,
          }),
        ),
      );

    return {
      toolResult: {
        content: [
          ...normalizeNativeToolContent(handlerResult.result.content),
          {
            type: "text",
            text: JSON.stringify(threadStartEffect.result),
          },
        ],
        details: {
          ...details,
          status: "succeeded",
          summary,
          commandFacts: facts,
        },
      },
      appliedEffects,
      result: threadStartEffect.result,
    } satisfies RunAcceptedThreadStartToolCallResult;
  },
);
