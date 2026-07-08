import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeExtensionContextImpactStatePort,
  type ListRuntimeExtensionUsageContextAffectedSurfacesInput,
  type RuntimeExtensionContextChangedSurface,
  type RuntimeExtensionContextImpactStateFacade,
  type RuntimeExtensionContextImpactStatePortService,
  type SurfacePiSessionId,
} from "@svvy/core";
import {
  StructuredSessionState,
  type StructuredSessionSnapshot,
  type StructuredSessionStateStore,
  structuredSessionStateFromStore,
} from "./structured-session-state";
import {
  dedupeInvalidations,
  mutationResult,
  sessionNavigationInvalidation,
  surfaceInvalidation,
} from "./state-mutation-result";

export function runtimeExtensionContextImpactStateFacadeFromStore(
  store: StructuredSessionStateStore,
): RuntimeExtensionContextImpactStateFacade {
  return {
    listUsageContextAffectedSurfaces: (input) =>
      listUsageContextAffectedSurfacesFromSnapshots(store.listSessionStates(), input),
    applySnapshotContextImpact: (input) => store.applySnapshotContextImpact(input),
  };
}

export function runtimeExtensionContextImpactStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeExtensionContextImpactStatePortService {
  return {
    listUsageContextAffectedSurfaces: (input) =>
      state
        .listSessionStates()
        .pipe(
          Effect.map((snapshots) =>
            listUsageContextAffectedSurfacesFromSnapshots(snapshots, input),
          ),
        ),
    applySnapshotContextImpact: (input) =>
      state
        .applySnapshotContextImpact(input)
        .pipe(
          Effect.map((affected) =>
            mutationResult(
              affected,
              extensionContextChangedInvalidations(state.workspaceId, affected),
            ),
          ),
        ),
  };
}

export function runtimeExtensionContextImpactStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeExtensionContextImpactStatePortService {
  return runtimeExtensionContextImpactStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeExtensionContextImpactStatePort = Effect.fn(
  "@svvy/state/makeRuntimeExtensionContextImpactStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeExtensionContextImpactStatePortFromStructuredSessionState(state);
});

export const layerRuntimeExtensionContextImpactStatePort = Layer.effect(
  RuntimeExtensionContextImpactStatePort,
  makeRuntimeExtensionContextImpactStatePort(),
);

function listUsageContextAffectedSurfacesFromSnapshots(
  snapshots: readonly StructuredSessionSnapshot[],
  input: ListRuntimeExtensionUsageContextAffectedSurfacesInput,
): readonly RuntimeExtensionContextChangedSurface[] {
  const affected: RuntimeExtensionContextChangedSurface[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.pi.orchestratorAgentProfileId === input.profileId) {
      affected.push(
        extensionContextChangedSurface(snapshot.pi.sessionId, "extension_usage_changed"),
      );
    }
    if (input.agentProfile === "threadHandler") {
      for (const thread of snapshot.threads) {
        affected.push(
          extensionContextChangedSurface(thread.surfacePiSessionId, "extension_usage_changed"),
        );
      }
    }
  }
  return affected;
}

function extensionContextChangedInvalidations(
  workspaceId: string,
  surfaces: readonly RuntimeExtensionContextChangedSurface[],
) {
  return dedupeInvalidations(
    surfaces.flatMap((surface) => [
      surfaceInvalidation(workspaceId, surface.surfacePiSessionId),
      sessionNavigationInvalidation(workspaceId),
    ]),
  );
}

function extensionContextChangedSurface(
  surfacePiSessionId: string,
  reason: RuntimeExtensionContextChangedSurface["reason"],
): RuntimeExtensionContextChangedSurface {
  return {
    surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
    kind: "extension_context_changed",
    label: "Extensions changed",
    reason,
  };
}
