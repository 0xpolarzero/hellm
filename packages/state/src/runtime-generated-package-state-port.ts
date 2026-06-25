import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeGeneratedPackageStatePort,
  type RuntimeGeneratedPackageFactRecord,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeGeneratedPackageWorkspaceLinkRecord,
  type StateInvalidationDescriptor,
  type StateMutationResult,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

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
