import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeExtensionContextImpactStatePort,
  type ApplyRuntimeExtensionSnapshotContextImpactInput,
  type ExtensionId,
  type ListRuntimeExtensionUsageContextAffectedSurfacesInput,
  type RuntimeExtensionContextChangedSurface,
  type RuntimeExtensionContextImpactStateFacade,
  type RuntimeExtensionContextImpactStatePortService,
  type RuntimeExtensionUsageProfileKey,
  type SurfacePiSessionId,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionSnapshot,
  type StructuredSessionStateStore,
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
    applySnapshotContextImpact: (input) => applySnapshotContextImpactToStore(store, input),
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
      Effect.gen(function* () {
        const snapshots = yield* state.listSessionStates();
        const affected = yield* applySnapshotContextImpactToState(state, snapshots, input);
        return mutationResult(
          affected,
          extensionContextChangedInvalidations(state.workspaceId, affected),
        );
      }),
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

function applySnapshotContextImpactToStore(
  store: StructuredSessionStateStore,
  input: ApplyRuntimeExtensionSnapshotContextImpactInput,
): readonly RuntimeExtensionContextChangedSurface[] {
  const affectedExtensionIds = new Set(input.affectedExtensionIds);
  const affectedUsageProfiles = new Set<RuntimeExtensionUsageProfileKey>(
    input.affectedUsageProfiles,
  );
  const removedUserExtensionIds = new Set(input.removedUserExtensionIds);
  if (
    affectedExtensionIds.size === 0 &&
    affectedUsageProfiles.size === 0 &&
    removedUserExtensionIds.size === 0
  ) {
    return [];
  }

  const affected: RuntimeExtensionContextChangedSurface[] = [];
  for (const snapshot of store.listSessionStates()) {
    const piLoaded = snapshot.pi.loadedExtensionIds ?? [];
    const piAvailable = snapshot.pi.availableExtensionIds ?? [];
    const orchestratorProfileId = snapshot.pi.orchestratorAgentProfileId;
    if (
      extensionListsIntersect([piLoaded, piAvailable], affectedExtensionIds) ||
      (orchestratorProfileId !== undefined &&
        affectedUsageProfiles.has(orchestratorUsageProfileKey(orchestratorProfileId)))
    ) {
      const updated = store.updatePiSessionExtensionState({
        sessionId: snapshot.pi.sessionId,
        loadedExtensionIds: dropExtensionIds(piLoaded, removedUserExtensionIds),
        availableExtensionIds: dropExtensionIds(piAvailable, removedUserExtensionIds),
      });
      affected.push(extensionContextChangedSurface(updated.sessionId, "snapshot_loaded"));
    }

    for (const thread of snapshot.threads) {
      if (
        !extensionListsIntersect(
          [thread.loadedExtensionIds, thread.availableExtensionIds],
          affectedExtensionIds,
        ) &&
        !affectedUsageProfiles.has("handler:threadHandler")
      ) {
        continue;
      }
      const updated = store.updateThread({
        threadId: thread.id,
        loadedExtensionIds: dropExtensionIds(thread.loadedExtensionIds, removedUserExtensionIds),
        availableExtensionIds: dropExtensionIds(
          thread.availableExtensionIds,
          removedUserExtensionIds,
        ),
      });
      affected.push(extensionContextChangedSurface(updated.surfacePiSessionId, "snapshot_loaded"));
    }
  }
  return affected;
}

function applySnapshotContextImpactToState(
  state: StructuredSessionState["Service"],
  snapshots: readonly StructuredSessionSnapshot[],
  input: ApplyRuntimeExtensionSnapshotContextImpactInput,
) {
  const affectedExtensionIds = new Set(input.affectedExtensionIds);
  const affectedUsageProfiles = new Set<RuntimeExtensionUsageProfileKey>(
    input.affectedUsageProfiles,
  );
  const removedUserExtensionIds = new Set(input.removedUserExtensionIds);
  if (
    affectedExtensionIds.size === 0 &&
    affectedUsageProfiles.size === 0 &&
    removedUserExtensionIds.size === 0
  ) {
    return Effect.succeed([]);
  }

  return Effect.gen(function* () {
    const affected: RuntimeExtensionContextChangedSurface[] = [];
    for (const snapshot of snapshots) {
      const piLoaded = snapshot.pi.loadedExtensionIds ?? [];
      const piAvailable = snapshot.pi.availableExtensionIds ?? [];
      const orchestratorProfileId = snapshot.pi.orchestratorAgentProfileId;
      if (
        extensionListsIntersect([piLoaded, piAvailable], affectedExtensionIds) ||
        (orchestratorProfileId !== undefined &&
          affectedUsageProfiles.has(orchestratorUsageProfileKey(orchestratorProfileId)))
      ) {
        const updated = yield* state.updatePiSessionExtensionState({
          sessionId: snapshot.pi.sessionId,
          loadedExtensionIds: dropExtensionIds(piLoaded, removedUserExtensionIds),
          availableExtensionIds: dropExtensionIds(piAvailable, removedUserExtensionIds),
        });
        affected.push(extensionContextChangedSurface(updated.sessionId, "snapshot_loaded"));
      }

      for (const thread of snapshot.threads) {
        if (
          !extensionListsIntersect(
            [thread.loadedExtensionIds, thread.availableExtensionIds],
            affectedExtensionIds,
          ) &&
          !affectedUsageProfiles.has("handler:threadHandler")
        ) {
          continue;
        }
        const updated = yield* state.updateThread({
          threadId: thread.id,
          loadedExtensionIds: dropExtensionIds(thread.loadedExtensionIds, removedUserExtensionIds),
          availableExtensionIds: dropExtensionIds(
            thread.availableExtensionIds,
            removedUserExtensionIds,
          ),
        });
        affected.push(
          extensionContextChangedSurface(updated.surfacePiSessionId, "snapshot_loaded"),
        );
      }
    }
    return affected;
  });
}

function extensionListsIntersect(
  lists: readonly (readonly string[] | undefined)[],
  ids: ReadonlySet<ExtensionId>,
): boolean {
  if (ids.size === 0) return false;
  return lists.some((list) => (list ?? []).some((id) => ids.has(id as ExtensionId)));
}

function dropExtensionIds(
  values: readonly string[] | undefined,
  removed: ReadonlySet<ExtensionId>,
): string[] {
  if (!values || removed.size === 0) return values ? [...values] : [];
  return values.filter((id) => !removed.has(id as ExtensionId));
}

function orchestratorUsageProfileKey(profileId: string): RuntimeExtensionUsageProfileKey {
  return `orchestrator:${profileId}`;
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
