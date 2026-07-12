import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeWorkspaceStatePort,
  type RuntimeWorkspaceStatePortService,
  type WorkspaceId,
} from "@svvy/core";
import {
  dedupeInvalidations,
  mutationResult,
  sessionNavigationInvalidation,
  workspaceLayoutInvalidation,
} from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

export function runtimeWorkspaceStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeWorkspaceStatePortService {
  return {
    resolvePromptTargetWorkspaceId: ({ target }) =>
      state
        .getSessionState(target.workspaceSessionId)
        .pipe(Effect.as(state.workspaceId as WorkspaceId)),
    acquireWorkspace: (input) =>
      state
        .acquireWorkspace(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result,
              dedupeInvalidations([
                sessionNavigationInvalidation(result.workspaceId),
                workspaceLayoutInvalidation(result.workspaceId, ["A", "B", "C"]),
              ]),
            ),
          ),
        ),
    acquireDefaultWorkspace: (input) =>
      state
        .acquireDefaultWorkspace(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result,
              dedupeInvalidations([
                sessionNavigationInvalidation(result.workspaceId),
                workspaceLayoutInvalidation(result.workspaceId, ["A", "B", "C"]),
              ]),
            ),
          ),
        ),
    releaseWorkspace: (input) =>
      state
        .releaseWorkspace(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result,
              dedupeInvalidations([
                sessionNavigationInvalidation(result.workspaceId),
                workspaceLayoutInvalidation(result.workspaceId, ["A", "B", "C"]),
              ]),
            ),
          ),
        ),
  };
}

export function runtimeWorkspaceStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeWorkspaceStatePortService {
  return runtimeWorkspaceStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeWorkspaceStatePort = Effect.fn("@svvy/state/makeRuntimeWorkspaceStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeWorkspaceStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeWorkspaceStatePort = Layer.effect(
  RuntimeWorkspaceStatePort,
  makeRuntimeWorkspaceStatePort(),
);
