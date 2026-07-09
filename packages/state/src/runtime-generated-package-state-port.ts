import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeGeneratedPackageStatePort,
  type MarkWorkspaceGeneratedPackageLinksRepairNeededInput,
  type RecordGeneratedPackageWorkspaceLinkInput,
  type RuntimeGeneratedPackageFactRecord,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeGeneratedPackageWorkspaceLinkRecord,
  type StateInvalidationDescriptor,
  type StateMutationResult,
} from "@svvy/core";
import {
  StructuredSessionState,
  createStructuredSessionStateStore,
  structuredSessionStateFromStore,
  type CreateStructuredSessionStateStoreOptions,
  type StructuredSessionStateStore,
} from "./structured-session-state";

export type MarkPersistedWorkspaceGeneratedPackageLinksRepairNeededInput = {
  readonly store: CreateStructuredSessionStateStoreOptions;
  readonly request: MarkWorkspaceGeneratedPackageLinksRepairNeededInput;
};

export type RecordPersistedWorkspaceGeneratedPackageLinkStatusInput = {
  readonly store: CreateStructuredSessionStateStoreOptions;
  readonly request: RecordGeneratedPackageWorkspaceLinkInput;
};

function generatedPackageInvalidationsForPackage(
  packageName: string,
): readonly StateInvalidationDescriptor[] {
  if (packageName === "@svvyx/workflows") {
    return [{ scope: "app", invalidation: { model: "workflowsGenerated" } }];
  }
  if (packageName === "@svvyx/extensions") {
    return [{ scope: "app", invalidation: { model: "extensions" } }];
  }
  return [];
}

function generatedPackageInvalidations(
  fact: RuntimeGeneratedPackageFactRecord,
): readonly StateInvalidationDescriptor[] {
  return generatedPackageInvalidationsForPackage(fact.packageName);
}

function mutationResult<T>(
  value: T,
  afterCommit: readonly StateInvalidationDescriptor[] = [],
): StateMutationResult<T> {
  return { value, afterCommit };
}

export function runtimeGeneratedPackageStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeGeneratedPackageStatePortService {
  return {
    recordGeneratedPackageBuild: (input) =>
      state
        .recordGeneratedPackageBuild(input)
        .pipe(Effect.map((fact) => mutationResult(fact, generatedPackageInvalidations(fact)))),
    recordGeneratedPackageFailure: (input) =>
      state
        .recordGeneratedPackageFailure(input)
        .pipe(Effect.map((fact) => mutationResult(fact, generatedPackageInvalidations(fact)))),
    recordWorkspaceLinkStatus: (input) =>
      state
        .recordWorkspaceLinkStatus(input)
        .pipe(
          Effect.map((link: RuntimeGeneratedPackageWorkspaceLinkRecord) =>
            mutationResult(link, generatedPackageInvalidationsForPackage(link.packageName)),
          ),
        ),
    markWorkspaceLinksRepairNeeded: (input) =>
      state.markWorkspaceLinksRepairNeeded(input).pipe(
        Effect.map((result) =>
          mutationResult(
            result,
            result.links.flatMap((link) =>
              generatedPackageInvalidationsForPackage(link.packageName),
            ),
          ),
        ),
      ),
    readLinksNeedingRepair: state.readLinksNeedingRepair,
    readGeneratedPackageFacts: state.readGeneratedPackageFacts,
    reconcileGeneratedPackageManifest: (input) =>
      state
        .reconcileGeneratedPackageManifest(input)
        .pipe(Effect.map((fact) => mutationResult(fact, generatedPackageInvalidations(fact)))),
    markGeneratedPackageRefreshNeeded: (input) =>
      state
        .markGeneratedPackageRefreshNeeded(input)
        .pipe(Effect.map((fact) => mutationResult(fact, generatedPackageInvalidations(fact)))),
  };
}

export function runtimeGeneratedPackageStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeGeneratedPackageStatePortService {
  return runtimeGeneratedPackageStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const markPersistedWorkspaceGeneratedPackageLinksRepairNeeded = Effect.fn(
  "@svvy/state/markPersistedWorkspaceGeneratedPackageLinksRepairNeeded",
)(function* (input: MarkPersistedWorkspaceGeneratedPackageLinksRepairNeededInput) {
  const store = createStructuredSessionStateStore(input.store);
  try {
    return yield* runtimeGeneratedPackageStatePortFromStore(store).markWorkspaceLinksRepairNeeded(
      input.request,
    );
  } finally {
    store.close();
  }
});

export const recordPersistedWorkspaceGeneratedPackageLinkStatus = Effect.fn(
  "@svvy/state/recordPersistedWorkspaceGeneratedPackageLinkStatus",
)(function* (input: RecordPersistedWorkspaceGeneratedPackageLinkStatusInput) {
  const store = createStructuredSessionStateStore(input.store);
  try {
    return yield* runtimeGeneratedPackageStatePortFromStore(store).recordWorkspaceLinkStatus(
      input.request,
    );
  } finally {
    store.close();
  }
});

export const makeRuntimeGeneratedPackageStatePort = Effect.fn(
  "@svvy/state/makeRuntimeGeneratedPackageStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeGeneratedPackageStatePortFromStructuredSessionState(state);
});

export const layerRuntimeGeneratedPackageStatePort = Layer.effect(
  RuntimeGeneratedPackageStatePort,
  makeRuntimeGeneratedPackageStatePort(),
);
