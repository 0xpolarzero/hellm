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

type ExtensionStatePortHostOverrides = {
  readonly records: ExtensionStatePortService["records"];
  readonly dependencies: Pick<ExtensionStatePortService["dependencies"], "isApproved">;
};

export function extensionStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
  overrides: ExtensionStatePortHostOverrides,
): ExtensionStatePortService {
  return {
    records: overrides.records,
    dependencies: {
      isApproved: overrides.dependencies.isApproved,
      readReadiness: (input) =>
        state
          .readExtensionDependencyReadiness(input)
          .pipe(Effect.mapError((cause): StateContractError => cause)),
    },
  };
}

export function extensionStatePortFromStore(
  store: StructuredSessionStateStore,
  overrides: ExtensionStatePortHostOverrides,
): ExtensionStatePortService {
  return extensionStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
    overrides,
  );
}

export const makeExtensionStatePort = Effect.fn("@svvy/state/makeExtensionStatePort")(function* (
  overrides: ExtensionStatePortHostOverrides,
) {
  const state = yield* StructuredSessionState;
  return extensionStatePortFromStructuredSessionState(state, overrides);
});

export const layerExtensionStatePort = (overrides: ExtensionStatePortHostOverrides) =>
  Layer.effect(ExtensionStatePort, makeExtensionStatePort(overrides));
