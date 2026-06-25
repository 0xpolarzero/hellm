import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeSurfaceLifecycleStatePort,
  type RuntimeSurfaceLifecycleStatePortService,
} from "@svvy/core";
import { mutationResult, surfaceAndSessionNavigationInvalidations } from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

export function runtimeSurfaceLifecycleStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeSurfaceLifecycleStatePortService {
  return {
    createOrchestratorSurface: (input) =>
      state
        .createOrchestratorSurface(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result,
              surfaceAndSessionNavigationInvalidations(
                state.workspaceId,
                result.surfacePiSessionId,
              ),
            ),
          ),
        ),
    openSurface: (input) =>
      state
        .openSurface(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result,
              surfaceAndSessionNavigationInvalidations(
                state.workspaceId,
                result.surfacePiSessionId,
              ),
            ),
          ),
        ),
    closeSurface: (input) =>
      state
        .closeSurface(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result,
              surfaceAndSessionNavigationInvalidations(
                state.workspaceId,
                result.target.surfacePiSessionId,
              ),
            ),
          ),
        ),
  };
}

export function runtimeSurfaceLifecycleStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeSurfaceLifecycleStatePortService {
  return runtimeSurfaceLifecycleStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeSurfaceLifecycleStatePort = Effect.fn(
  "@svvy/state/makeRuntimeSurfaceLifecycleStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeSurfaceLifecycleStatePortFromStructuredSessionState(state);
});

export const layerRuntimeSurfaceLifecycleStatePort = Layer.effect(
  RuntimeSurfaceLifecycleStatePort,
  makeRuntimeSurfaceLifecycleStatePort(),
);
