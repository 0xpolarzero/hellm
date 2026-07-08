import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeRequestStatePort,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type PromptTarget,
  type SetRequestInputTimerPausedInput,
  type SetRequestInputTimerPausedResult,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";

export type RuntimeRequestInputAnswerCommittedInput = {
  readonly surfacePiSessionId: AnswerRequestInputInput["surfacePiSessionId"];
  readonly requestId: AnswerRequestInputInput["requestId"];
  readonly delivery: AnswerRequestInputResult["delivery"];
  readonly target: PromptTarget;
};

export type RuntimeRequestInputTimerPausedCommittedInput = {
  readonly requestId: SetRequestInputTimerPausedResult["requestId"];
};

function mapRequestStateError(
  operation: string,
  cause: { reason: string; message: string; issues?: RuntimeContractError["issues"] },
): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason:
      cause.reason === "not-found"
        ? "target-not-found"
        : cause.reason === "invalid-input"
          ? "invalid-input"
          : "stale-state",
    message: cause.message,
    ...(cause.issues ? { issues: cause.issues } : {}),
    cause,
  });
}

export function answerRuntimeRequestInput(
  input: AnswerRequestInputInput,
): Effect.Effect<
  AnswerRequestInputResult,
  RuntimeContractError,
  RuntimeEventBus | RuntimeRequestStatePort | RuntimeRequestInputWaitService
> {
  return Effect.gen(function* () {
    const requestState = yield* RuntimeRequestStatePort;
    const eventBus = yield* RuntimeEventBus;
    const waitService = yield* RuntimeRequestInputWaitService;
    const answerResult = yield* requestState
      .answerRequestInput(input)
      .pipe(Effect.mapError((cause) => mapRequestStateError("runtime.requestInput.answer", cause)));
    yield* eventBus.publishStateInvalidations({ afterCommit: answerResult.afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: "runtime.requestInput.answer",
            reason: "stale-state",
            message: "Runtime event bus did not accept request-input answer notifications.",
            cause,
          }),
      ),
    );
    const result = answerResult.value.answer;
    yield* waitService.afterAnswerCommitted({
      surfacePiSessionId: input.surfacePiSessionId,
      requestId: input.requestId,
      delivery: result.delivery,
      target: answerResult.value.target,
    });
    return result;
  });
}

export function setRuntimeRequestInputTimerPaused(
  input: SetRequestInputTimerPausedInput,
): Effect.Effect<
  SetRequestInputTimerPausedResult,
  RuntimeContractError,
  RuntimeEventBus | RuntimeRequestStatePort | RuntimeRequestInputWaitService
> {
  return Effect.gen(function* () {
    const requestState = yield* RuntimeRequestStatePort;
    const eventBus = yield* RuntimeEventBus;
    const waitService = yield* RuntimeRequestInputWaitService;
    const result = yield* requestState
      .setRequestInputTimerPaused(input)
      .pipe(
        Effect.mapError((cause) =>
          mapRequestStateError("runtime.requestInput.setTimerPaused", cause),
        ),
      );
    yield* eventBus.publishStateInvalidations({ afterCommit: result.afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: "runtime.requestInput.setTimerPaused",
            reason: "stale-state",
            message: "Runtime event bus did not accept request-input timer notifications.",
            cause,
          }),
      ),
    );
    yield* waitService.afterTimerPausedCommitted({ requestId: result.value.requestId });
    return { requestId: result.value.requestId };
  });
}
