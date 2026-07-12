import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExtensionSnapshotStatePort, type ExtensionSnapshotStatePortService } from "@svvy/core";

import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult } from "./state-mutation-result";

const invalidations = [{ scope: "app" as const, invalidation: { model: "extensions" as const } }];

export function extensionSnapshotStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): ExtensionSnapshotStatePortService {
  return {
    list: () => state.listExtensionSnapshots(),
    read: (snapshotId) => state.readExtensionSnapshot(snapshotId),
    save: (input) =>
      state
        .saveExtensionSnapshot(input)
        .pipe(Effect.map((value) => mutationResult(value, invalidations))),
    rename: (input) =>
      state
        .renameExtensionSnapshot(input)
        .pipe(Effect.map((value) => mutationResult(value, invalidations))),
    delete: (input) =>
      state
        .deleteExtensionSnapshot(input)
        .pipe(Effect.map((value) => mutationResult(value, invalidations))),
    load: (input) =>
      state
        .loadExtensionSnapshot(input)
        .pipe(Effect.map((value) => mutationResult(value, invalidations))),
    readRestoreAttempt: (attemptId) => state.readExtensionSnapshotRestoreAttempt(attemptId),
    listPendingRestoreAttempts: () => state.listPendingExtensionSnapshotRestoreAttempts(),
    advanceRestoreAttempt: (input) =>
      state
        .advanceExtensionSnapshotRestoreAttempt(input)
        .pipe(Effect.map((value) => mutationResult(value, invalidations))),
    listPendingCleanup: () => state.listPendingExtensionSnapshotCleanup(),
    completeCleanup: (input) =>
      state
        .completeExtensionSnapshotCleanup(input)
        .pipe(Effect.map((value) => mutationResult(value, invalidations))),
  };
}

export function extensionSnapshotStatePortFromStore(
  store: StructuredSessionStateStore,
): ExtensionSnapshotStatePortService {
  return extensionSnapshotStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeExtensionSnapshotStatePort = Effect.fn(
  "@svvy/state/makeExtensionSnapshotStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return extensionSnapshotStatePortFromStructuredSessionState(state);
});

export const layerExtensionSnapshotStatePort = Layer.effect(
  ExtensionSnapshotStatePort,
  makeExtensionSnapshotStatePort(),
);
