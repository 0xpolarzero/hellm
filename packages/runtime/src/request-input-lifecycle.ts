import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeRequestStatePort,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type PromptTarget,
  type SetRequestInputBlockingTimeoutInput,
  type SetRequestInputBlockingTimeoutResult,
  type SetRequestInputTimerPausedInput,
  type SetRequestInputTimerPausedResult,
  type SetRequestInputVariantInput,
  type SetRequestInputVariantResult,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import type { RuntimeQueueWakeServiceService } from "./runtime-queue-wake-port";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import { RuntimeWorkspaceScopeService } from "./workspace-runtime-scope-service";

export type RuntimeRequestInputAnswerCommittedInput = {
  readonly surfacePiSessionId: AnswerRequestInputInput["surfacePiSessionId"];
  readonly requestId: AnswerRequestInputInput["requestId"];
  readonly delivery: AnswerRequestInputResult["delivery"];
  readonly target: PromptTarget;
};

export type RuntimeRequestInputTimerPausedCommittedInput = {
  readonly requestId: SetRequestInputTimerPausedResult["requestId"];
};

export function setRuntimeRequestInputVariant(
  input: SetRequestInputVariantInput,
): Effect.Effect<
  SetRequestInputVariantResult,
  RuntimeContractError,
  | RuntimeEventBus
  | RuntimeRequestStatePort
  | RuntimeSourceInvalidationService
  | RuntimeWorkspaceScopeService
> {
  return Effect.gen(function* () {
    const requestState = yield* RuntimeRequestStatePort;
    const eventBus = yield* RuntimeEventBus;
    const sourceInvalidation = yield* RuntimeSourceInvalidationService;
    const workspaceScopes = yield* RuntimeWorkspaceScopeService;
    const result = yield* requestState
      .setRequestInputVariant(input)
      .pipe(
        Effect.mapError((cause) => mapRequestStateError("runtime.requestInput.setVariant", cause)),
      );
    yield* eventBus.publishStateInvalidations({ afterCommit: result.afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: "runtime.requestInput.setVariant",
            reason: "stale-state",
            message: "Runtime event bus did not accept request-input variant notifications.",
            cause,
          }),
      ),
    );
    const acquired = yield* workspaceScopes.snapshot();
    yield* Effect.forEach(
      acquired.toSorted((left, right) => left.workspaceId.localeCompare(right.workspaceId)),
      ({ workspaceId }) =>
        sourceInvalidation.refreshGeneratedContext({
          scope: "workspace",
          workspaceId,
          reason: "profile-settings-changed",
        }),
      { discard: true },
    );
    return result.value;
  });
}

export function setRuntimeRequestInputBlockingTimeout(
  input: SetRequestInputBlockingTimeoutInput,
): Effect.Effect<
  SetRequestInputBlockingTimeoutResult,
  RuntimeContractError,
  RuntimeEventBus | RuntimeRequestStatePort
> {
  return Effect.gen(function* () {
    const requestState = yield* RuntimeRequestStatePort;
    const eventBus = yield* RuntimeEventBus;
    const result = yield* requestState
      .setRequestInputBlockingTimeout(input)
      .pipe(
        Effect.mapError((cause) =>
          mapRequestStateError("runtime.requestInput.setBlockingTimeout", cause),
        ),
      );
    yield* eventBus.publishStateInvalidations({ afterCommit: result.afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: "runtime.requestInput.setBlockingTimeout",
            reason: "stale-state",
            message: "Runtime event bus did not accept request-input timeout notifications.",
            cause,
          }),
      ),
    );
    return result.value;
  });
}

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
  wakeSurface: RuntimeQueueWakeServiceService["wakeSurface"] = () => Effect.void,
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
    if (
      result.status !== "duplicate" ||
      result.delivery.kind === "blocking-resolved" ||
      result.delivery.kind === "blocking-open"
    ) {
      yield* waitService.afterAnswerCommitted({
        surfacePiSessionId: input.surfacePiSessionId,
        requestId: input.requestId,
        delivery: result.delivery,
        target: answerResult.value.target,
        wakeSurface,
      });
    }
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
