import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type AnswerRequestInputResult,
  type PromptTarget,
  type RequestInputRequestId,
  type RuntimeCommandRecord,
  RuntimeCommandStatePort,
  type RuntimeCommandStatePortService,
  RuntimeContractError,
  type RuntimeRequestInputDetailsRecord,
  RuntimeRequestStatePort,
  type RuntimeRequestStatePortService,
  RuntimeSessionWaitStatePort,
  type RuntimeSessionWaitStatePortService,
  type SurfacePiSessionId,
} from "@svvy/core";
import type { RequestUserInputResult } from "@svvy/extensions";
import {
  makeRuntimeBlockingRequestInputWaitRegistry,
  type RuntimeBlockingRequestInputEffectState,
  type RuntimeBlockingRequestInputWaitRegistry,
} from "./request-input-blocking-controller";
import { RuntimeEventBus, type RuntimeEventBusService } from "./runtime-event-bus";
import type { RuntimeQueueWakeServiceService } from "./runtime-queue-wake-port";

export interface RuntimeRequestInputWaitServiceService {
  waitForBlockingRequest(input: {
    readonly request: RuntimeRequestInputDetailsRecord;
    readonly command: RuntimeCommandRecord;
  }): Effect.Effect<RequestUserInputResult, RuntimeContractError>;
  afterAnswerCommitted(input: {
    readonly surfacePiSessionId: string;
    readonly requestId: RequestInputRequestId;
    readonly delivery: AnswerRequestInputResult["delivery"];
    readonly target: PromptTarget;
    readonly wakeSurface: RuntimeQueueWakeServiceService["wakeSurface"];
  }): Effect.Effect<void, RuntimeContractError>;
  afterTimerPausedCommitted(input: {
    readonly requestId: string;
  }): Effect.Effect<void, RuntimeContractError>;
  restoreOpenBlockingRequests(): Effect.Effect<void, RuntimeContractError>;
  cancelBlockingRequestsForSurface(input: {
    readonly surfacePiSessionId: SurfacePiSessionId;
    readonly reason?: string;
  }): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeRequestInputWaitService extends Context.Service<
  RuntimeRequestInputWaitService,
  RuntimeRequestInputWaitServiceService
>()("@svvy/runtime/RuntimeRequestInputWaitService") {}

function mapWaitServiceError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  return new RuntimeContractError({
    operation,
    reason: "stale-state",
    message: cause instanceof Error ? cause.message : "Runtime request-input wait service failed.",
    cause,
  });
}

function makeState(input: {
  readonly commandState: RuntimeCommandStatePortService;
  readonly requestState: RuntimeRequestStatePortService;
  readonly sessionWaitState: RuntimeSessionWaitStatePortService;
  readonly eventBus: RuntimeEventBusService;
}): RuntimeBlockingRequestInputEffectState {
  return {
    commandState: input.commandState,
    requestState: input.requestState,
    sessionWaitState: input.sessionWaitState,
    publishStateInvalidations: (afterCommit) =>
      afterCommit.length === 0
        ? Effect.void
        : input.eventBus.publishStateInvalidations({ afterCommit }).pipe(
            Effect.asVoid,
            Effect.mapError((cause) =>
              mapWaitServiceError("runtime.requestInput.publishStateInvalidations", cause),
            ),
          ),
  };
}

function makeRuntimeRequestInputWaitService(input: {
  readonly registry: RuntimeBlockingRequestInputWaitRegistry;
  readonly commandState: RuntimeCommandStatePortService;
  readonly requestState: RuntimeRequestStatePortService;
  readonly sessionWaitState: RuntimeSessionWaitStatePortService;
  readonly eventBus: RuntimeEventBusService;
}): RuntimeRequestInputWaitServiceService {
  const state = makeState(input);
  return RuntimeRequestInputWaitService.of({
    waitForBlockingRequest: ({ request, command }) =>
      input.registry
        .waitForBlockingRequest({
          state,
          request,
          command,
        })
        .pipe(
          Effect.mapError((cause) =>
            mapWaitServiceError("runtime.requestInput.waitForBlockingRequest", cause),
          ),
        ),
    afterAnswerCommitted: ({ requestId, delivery, target, wakeSurface }) => {
      if (delivery.kind !== "blocking-resolved") {
        if (delivery.kind !== "nonblocking-queued") {
          return Effect.void;
        }
        return wakeSurface({
          target,
          reason: "request-input-answer-queued",
        }).pipe(
          Effect.mapError((cause) =>
            mapWaitServiceError("runtime.requestInput.answer.afterCommit", cause),
          ),
        );
      }
      return input.registry.resolveBlockingRequest(state, requestId).pipe(
        Effect.asVoid,
        Effect.mapError((cause) =>
          mapWaitServiceError("runtime.requestInput.answer.afterCommit", cause),
        ),
      );
    },
    afterTimerPausedCommitted: ({ requestId }) =>
      input.registry
        .rescheduleBlockingTimeout(state, requestId)
        .pipe(
          Effect.mapError((cause) =>
            mapWaitServiceError("runtime.requestInput.setTimerPaused.afterCommit", cause),
          ),
        ),
    restoreOpenBlockingRequests: () =>
      input.registry
        .restoreOpenBlockingRequests(state)
        .pipe(
          Effect.mapError((cause) =>
            mapWaitServiceError("runtime.requestInput.restoreOpenBlockingRequests", cause),
          ),
        ),
    cancelBlockingRequestsForSurface: ({ surfacePiSessionId, reason }) =>
      input.registry
        .cancelBlockingRequestsForSurface(state, surfacePiSessionId, reason)
        .pipe(
          Effect.mapError((cause) =>
            mapWaitServiceError("runtime.requestInput.cancelBlockingRequestsForSurface", cause),
          ),
        ),
  });
}

export const layerRuntimeRequestInputWaitService = Layer.effect(
  RuntimeRequestInputWaitService,
  Effect.gen(function* () {
    const commandState = yield* RuntimeCommandStatePort;
    const requestState = yield* RuntimeRequestStatePort;
    const sessionWaitState = yield* RuntimeSessionWaitStatePort;
    const eventBus = yield* RuntimeEventBus;
    const registry = yield* makeRuntimeBlockingRequestInputWaitRegistry();
    return makeRuntimeRequestInputWaitService({
      registry,
      commandState,
      requestState,
      sessionWaitState,
      eventBus,
    });
  }),
);
