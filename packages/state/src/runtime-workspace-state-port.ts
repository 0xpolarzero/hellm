import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeWorkspaceStatePort, type RuntimeWorkspaceStatePortService } from "@svvy/core";
import {
  dedupeInvalidations,
  mutationResult,
  sessionNavigationInvalidation,
  workspaceChromeLayoutInvalidation,
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
    acquireWorkspace: (input) =>
      state
        .acquireWorkspace(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result,
              dedupeInvalidations([
                sessionNavigationInvalidation(result.workspaceId),
                workspaceChromeLayoutInvalidation(result.workspaceId),
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
                workspaceChromeLayoutInvalidation(result.workspaceId),
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
                workspaceChromeLayoutInvalidation(result.workspaceId),
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
