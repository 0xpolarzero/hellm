import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExtensionUsageStatePort, type ExtensionUsageStatePortService } from "@svvy/core";

import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult } from "./state-mutation-result";

const invalidations = [{ scope: "app" as const, invalidation: { model: "agents" as const } }];

export function extensionUsageStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): ExtensionUsageStatePortService {
  return {
    readNetworkAccess: () =>
      state.readAppPreferences().pipe(Effect.map((value) => value.networkAccess)),
    resolveTarget: (agentProfile) => state.resolveExtensionUsageTarget(agentProfile),
    read: (changeId) => state.readExtensionUsageChange(changeId),
    set: (input) =>
      state
        .setExtensionUsage(input)
        .pipe(Effect.map((value) => mutationResult(value, invalidations))),
    revert: (input) =>
      state
        .revertExtensionUsage(input)
        .pipe(Effect.map((value) => mutationResult(value, invalidations))),
  };
}

export function extensionUsageStatePortFromStore(
  store: StructuredSessionStateStore,
): ExtensionUsageStatePortService {
  return extensionUsageStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const layerExtensionUsageStatePort = Layer.effect(
  ExtensionUsageStatePort,
  Effect.gen(function* () {
    return extensionUsageStatePortFromStructuredSessionState(yield* StructuredSessionState);
  }),
);
