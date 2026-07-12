import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeQueueStatePort,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import {
  dedupeInvalidations,
  mutationResult,
  promptHistoryInvalidation,
  surfaceAndSessionNavigationInvalidations,
  surfaceInvalidation,
} from "./state-mutation-result";

function queueInvalidations(
  workspaceId: string,
  record: RuntimeSurfaceMessageRecord | null,
): readonly StateInvalidationDescriptor[] {
  return record ? [surfaceInvalidation(workspaceId, record.surfacePiSessionId)] : [];
}

function queueManyInvalidations(
  workspaceId: string,
  records: readonly RuntimeSurfaceMessageRecord[],
): readonly StateInvalidationDescriptor[] {
  return dedupeInvalidations(
    records.map((record) => surfaceInvalidation(workspaceId, record.surfacePiSessionId)),
  );
}

export function runtimeQueueStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeQueueStatePortService {
  return {
    acceptSubmittedSurfaceMessage: (input) =>
      state
        .acceptSubmittedSurfaceMessage(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result.queuedMessage,
              result.accepted === "existing"
                ? []
                : [
                    ...surfaceAndSessionNavigationInvalidations(
                      state.workspaceId,
                      result.queuedMessage.surfacePiSessionId,
                    ),
                    ...(result.promptHistoryRecorded
                      ? [promptHistoryInvalidation(state.workspaceId)]
                      : []),
                  ],
            ),
          ),
        ),
    enqueueSurfaceMessage: (input) =>
      state
        .enqueueSurfaceMessage(input)
        .pipe(
          Effect.map((record) =>
            mutationResult(record, queueInvalidations(state.workspaceId, record)),
          ),
        ),
    getSurfaceQueuedMessage: state.getSurfaceQueuedMessage,
    claimNextQueuedSurfaceMessage: (input) =>
      state
        .claimNextQueuedSurfaceMessage(input)
        .pipe(
          Effect.map((record) =>
            mutationResult(record, queueInvalidations(state.workspaceId, record)),
          ),
        ),
    releaseExpiredSurfaceMessageClaims: (input) =>
      state
        .releaseExpiredSurfaceMessageClaims(input)
        .pipe(
          Effect.map((records) =>
            mutationResult(records, queueManyInvalidations(state.workspaceId, records)),
          ),
        ),
    markSurfaceMessageSteering: (input) =>
      state
        .markSurfaceMessageSteering(input)
        .pipe(
          Effect.map((record) =>
            mutationResult(record, queueInvalidations(state.workspaceId, record)),
          ),
        ),
    markSurfaceMessageQueued: (input) =>
      state
        .markSurfaceMessageQueued(input)
        .pipe(
          Effect.map((record) =>
            mutationResult(record, queueInvalidations(state.workspaceId, record)),
          ),
        ),
    markSurfaceMessageDelivered: (input) =>
      state
        .markSurfaceMessageDelivered(input)
        .pipe(
          Effect.map((record) =>
            mutationResult(record, queueInvalidations(state.workspaceId, record)),
          ),
        ),
    markSurfaceMessageFailed: (input) =>
      state
        .markSurfaceMessageFailed(input)
        .pipe(
          Effect.map((record) =>
            mutationResult(record, queueInvalidations(state.workspaceId, record)),
          ),
        ),
    cancelSurfaceMessage: (input) =>
      state
        .cancelSurfaceMessage(input)
        .pipe(
          Effect.map((record) =>
            mutationResult(record, queueInvalidations(state.workspaceId, record)),
          ),
        ),
  };
}

export function runtimeQueueStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeQueueStatePortService {
  return runtimeQueueStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeQueueStatePort = Effect.fn("@svvy/state/makeRuntimeQueueStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeQueueStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeQueueStatePort = Layer.effect(
  RuntimeQueueStatePort,
  makeRuntimeQueueStatePort(),
);
