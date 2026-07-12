import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ExtensionSnapshotSettingsStatePort,
  type ExtensionSnapshotSettingsStatePortService,
} from "@svvy/core";

import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import {
  agentsInvalidation,
  extensionsInvalidation,
  mutationResult,
} from "./state-mutation-result";

export function extensionSnapshotSettingsStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): ExtensionSnapshotSettingsStatePortService {
  return {
    readCaptureFacts: () => state.readExtensionSnapshotSettingsCaptureFacts(),
    applyCapturedSettings: (input) =>
      state
        .applyExtensionSnapshotSettings(input)
        .pipe(
          Effect.map((value) =>
            mutationResult(
              value,
              value.receipt.outcome === "applied"
                ? [extensionsInvalidation(), agentsInvalidation()]
                : [],
            ),
          ),
        ),
  };
}

export function extensionSnapshotSettingsStatePortFromStore(
  store: StructuredSessionStateStore,
): ExtensionSnapshotSettingsStatePortService {
  return extensionSnapshotSettingsStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeExtensionSnapshotSettingsStatePort = Effect.fn(
  "@svvy/state/makeExtensionSnapshotSettingsStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return extensionSnapshotSettingsStatePortFromStructuredSessionState(state);
});

export const layerExtensionSnapshotSettingsStatePort = Layer.effect(
  ExtensionSnapshotSettingsStatePort,
  makeExtensionSnapshotSettingsStatePort(),
);
