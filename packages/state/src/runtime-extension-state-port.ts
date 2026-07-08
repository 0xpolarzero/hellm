import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeExtensionStatePort,
  type RuntimeExtensionStatePortService,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult } from "./state-mutation-result";

const extensionInvalidations: readonly StateInvalidationDescriptor[] = [
  { scope: "app", invalidation: { model: "extensions" } },
];

export function runtimeExtensionStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeExtensionStatePortService {
  return {
    recordDependencyApproval: (input) =>
      state
        .recordExtensionDependencyApproval(input)
        .pipe(Effect.map(() => mutationResult(undefined, extensionInvalidations))),
    recordDependencyReadiness: (input) =>
      state
        .recordExtensionDependencyReadiness(input)
        .pipe(Effect.map((readiness) => mutationResult(readiness, extensionInvalidations))),
  };
}

export function runtimeExtensionStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeExtensionStatePortService {
  return runtimeExtensionStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeExtensionStatePort = Effect.fn("@svvy/state/makeRuntimeExtensionStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeExtensionStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeExtensionStatePort = Layer.effect(
  RuntimeExtensionStatePort,
  makeRuntimeExtensionStatePort(),
);
