import * as Effect from "effect/Effect";
import {
  RuntimeCommandStatePort,
  RuntimeContractError,
  decodeCommandResultEnvelopeEffect,
  type CommandResultEnvelope,
  type CommandId,
  type NativeToolResult,
  type PromptExecutionContext,
  type PromptTarget,
  type RequestInputRequestId,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
} from "@svvy/core";
import {
  decodeRequestUserInputResultEffect,
  requestUserInputHandler,
  type ActorExtensionBinding,
  type RequestUserInputHandlerInvocation,
  type RequestUserInputInput,
  type RequestUserInputResult,
} from "@svvy/extensions";
import { applyRequestInputCreateRuntimeEffectRequest } from "./runtime-effect-requests";

export type RuntimeRequestUserInputCommandContext = {
  commandId: CommandId;
  target: PromptTarget;
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

export type RunAcceptedRequestUserInputToolCallInput = {
  toolCallId: ToolCallId;
  toolItemId: ToolItemId;
  arguments: RequestUserInputInput;
  context: PromptExecutionContext;
  actorBinding: ActorExtensionBinding;
  command: RuntimeRequestUserInputCommandContext;
};

export type RunAcceptedRequestUserInputToolCallResult = {
  toolResult: NativeToolResult<CommandResultEnvelope>;
  result: RequestUserInputResult;
};

function runtimeError(input: {
  reason: ConstructorParameters<typeof RuntimeContractError>[0]["reason"];
  message: string;
  issues?: RuntimeContractError["issues"];
  cause?: unknown;
}): RuntimeContractError {
  return new RuntimeContractError({
    operation: "runtime.request-user-input.run",
    reason: input.reason,
    message: input.message,
    ...(input.issues ? { issues: input.issues } : {}),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function buildHandlerInvocation(
  input: RunAcceptedRequestUserInputToolCallInput,
): RequestUserInputHandlerInvocation {
  return {
    toolCallId: input.toolCallId,
    toolName: "request_user_input",
    arguments: {
      schemaId: "request_user_input.input",
      value: input.arguments,
    },
    context: input.context,
    actorBinding: input.actorBinding,
    command: input.command,
  };
}

function defaultedRequestInputSummary(questionCount: number): string {
  return questionCount === 1
    ? "Defaulted answer for 1 question."
    : `Defaulted answers for ${questionCount} questions.`;
}

export const runAcceptedRequestUserInputToolCall = Effect.fn(
  "@svvy/runtime/request-user-input.runAccepted",
)(function* (input: RunAcceptedRequestUserInputToolCallInput) {
  const handlerResult = yield* requestUserInputHandler.invoke(buildHandlerInvocation(input)).pipe(
    Effect.mapError((cause) =>
      runtimeError({
        reason: "invalid-input",
        message: cause.message,
        ...(cause.issues ? { issues: cause.issues } : {}),
        cause,
      }),
    ),
  );

  const appliedEffects = [];
  for (const operation of handlerResult.operations ?? []) {
    if (operation.kind !== "runtime_effect" || operation.request.type !== "request_input.create") {
      return yield* Effect.fail(
        runtimeError({
          reason: "invalid-input",
          message: "request_user_input handler returned an unsupported runtime operation.",
        }),
      );
    }
    appliedEffects.push(
      yield* applyRequestInputCreateRuntimeEffectRequest(
        {
          target: input.command.target,
          turnId: input.command.turnId,
          toolItemId: input.toolItemId,
        },
        operation.request,
      ),
    );
  }

  const requestInputEffect = appliedEffects.find(
    (effect) => effect.type === "request_input.create",
  );
  if (requestInputEffect?.type !== "request_input.create") {
    return yield* Effect.fail(
      runtimeError({
        reason: "invalid-input",
        message: "request_user_input handler did not create a request input record.",
      }),
    );
  }

  const details = yield* decodeCommandResultEnvelopeEffect(handlerResult.result.details).pipe(
    Effect.mapError((cause) =>
      runtimeError({
        reason: "invalid-input",
        message: "request_user_input handler returned invalid command details.",
        cause,
      }),
    ),
  );

  const facts = details.commandFacts as
    | { result?: unknown; questionCount?: unknown; answeredBy?: unknown }
    | undefined;

  const result = yield* decodeRequestUserInputResultEffect(facts?.result).pipe(
    Effect.mapError((cause) =>
      runtimeError({
        reason: "invalid-input",
        message: "request_user_input handler returned invalid command facts.",
        cause,
      }),
    ),
  );

  const questionCount =
    typeof facts?.questionCount === "number" ? facts.questionCount : result.answers.length;
  const commandFacts = {
    questionCount,
    answeredBy: "default" as const,
    result,
  };

  const commandState = yield* RuntimeCommandStatePort;
  yield* commandState
    .recordCommandEvent({
      sessionId: input.command.target.workspaceSessionId,
      commandId: input.command.commandId,
      kind: "command.progress",
      data: {
        source: "request_user_input",
        phase: "created",
        message: `Created ${questionCount} user-input ${
          questionCount === 1 ? "question" : "questions"
        }.`,
        facts: {
          requestId: requestInputEffect.request.requestId as RequestInputRequestId,
          variant: "nonblocking",
          questionCount,
        },
      },
    })
    .pipe(
      Effect.mapError((cause) =>
        runtimeError({
          reason: "stale-state",
          message: "Failed to record request_user_input command progress.",
          cause,
        }),
      ),
    );
  yield* commandState
    .finishCommand({
      commandId: input.command.commandId,
      status: "succeeded",
      summary: details.summary ?? defaultedRequestInputSummary(questionCount),
      facts: commandFacts,
    })
    .pipe(
      Effect.mapError((cause) =>
        runtimeError({
          reason: "stale-state",
          message: "Failed to finish request_user_input command.",
          cause,
        }),
      ),
    );

  return {
    toolResult: {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
      details,
    },
    result,
  } satisfies RunAcceptedRequestUserInputToolCallResult;
});
