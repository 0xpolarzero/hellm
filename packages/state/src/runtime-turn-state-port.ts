import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeTurnStatePort, type RuntimeTurnStatePortService } from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult, surfaceAndSessionNavigationInvalidations } from "./state-mutation-result";

export function runtimeTurnStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeTurnStatePortService {
  return {
    startTurn: (input) =>
      Effect.map(state.startTurn(input), (record) =>
        mutationResult(
          record,
          surfaceAndSessionNavigationInvalidations(state.workspaceId, record.surfacePiSessionId),
        ),
      ),
    queueTopLevelTitleGeneration: (input) =>
      state.queueTitleGeneration(input.sessionId).pipe(
        Effect.map((queued) =>
          mutationResult(
            {
              queued: queued !== null,
              sessionId: input.sessionId,
              surfacePiSessionId: input.surfacePiSessionId,
              title: queued?.title ?? "",
            },
            queued
              ? surfaceAndSessionNavigationInvalidations(
                  state.workspaceId,
                  input.surfacePiSessionId,
                )
              : [],
          ),
        ),
      ),
    setTurnDecision: (input) =>
      Effect.map(state.setTurnDecision(input), (record) =>
        mutationResult(
          record,
          surfaceAndSessionNavigationInvalidations(state.workspaceId, record.surfacePiSessionId),
        ),
      ),
    finishTurn: (input) =>
      Effect.map(state.finishTurn(input), (record) =>
        mutationResult(
          record,
          surfaceAndSessionNavigationInvalidations(state.workspaceId, record.surfacePiSessionId),
        ),
      ),
  };
}

export function runtimeTurnStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeTurnStatePortService {
  return runtimeTurnStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeTurnStatePort = Effect.fn("@svvy/state/makeRuntimeTurnStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeTurnStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeTurnStatePort = Layer.effect(
  RuntimeTurnStatePort,
  makeRuntimeTurnStatePort(),
);
