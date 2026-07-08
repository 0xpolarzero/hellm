import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ExtensionStatePort,
  type ExtensionStatePortService,
  type StateContractError,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

export function extensionStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): ExtensionStatePortService {
  return {
    records: {
      readSourceFingerprint: (input) =>
        state.readRuntimeSourceRootFingerprint(input).pipe(
          Effect.map((record) => record?.rootFingerprint ?? null),
          Effect.mapError((cause): StateContractError => cause),
        ),
    },
    dependencies: {
      isApproved: (input) =>
        state
          .readExtensionDependencyApproval(input)
          .pipe(Effect.mapError((cause): StateContractError => cause)),
      readReadiness: (input) =>
        state
          .readExtensionDependencyReadiness(input)
          .pipe(Effect.mapError((cause): StateContractError => cause)),
    },
  };
}

export function extensionStatePortFromStore(
  store: StructuredSessionStateStore,
): ExtensionStatePortService {
  return extensionStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeExtensionStatePort = Effect.fn("@svvy/state/makeExtensionStatePort")(function* () {
  const state = yield* StructuredSessionState;
  return extensionStatePortFromStructuredSessionState(state);
});

export const layerExtensionStatePort = Layer.effect(ExtensionStatePort, makeExtensionStatePort());
