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
    readBuildAttemptByClientRequestId: (clientRequestId) =>
      state.readExtensionBuildAttemptByClientRequestId(clientRequestId),
    reconcileRegistryObservation: (input) =>
      state
        .reconcileExtensionRegistryObservation(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result.record,
              result.outcome === "committed" ? extensionInvalidations : [],
            ),
          ),
        ),
    reconcileBuildEvidence: (input) =>
      state.reconcileExtensionSourceBuildEvidence(input).pipe(
        Effect.map((result) =>
          mutationResult(
            {
              changed: result.changed,
              changedExtensionIds: result.changedExtensionIds,
            },
            result.changed
              ? [
                  {
                    scope: "app" as const,
                    invalidation: {
                      model: "extensions" as const,
                      ids: result.changedExtensionIds,
                    },
                  },
                ]
              : [],
          ),
        ),
      ),
    startBuildAttempt: (input) =>
      state.startExtensionBuildAttempt(input).pipe(
        Effect.map((result) =>
          mutationResult(
            result.record,
            result.outcome === "committed"
              ? [
                  {
                    scope: "app" as const,
                    invalidation: { model: "extensions" as const, ids: [input.extensionId] },
                  },
                ]
              : [],
          ),
        ),
      ),
    recordBuildSuccess: (input) =>
      state.recordExtensionBuildSuccess(input).pipe(
        Effect.map((result) =>
          mutationResult(
            result.record,
            result.outcome === "committed"
              ? [
                  {
                    scope: "app" as const,
                    invalidation: { model: "extensions" as const, ids: [input.extensionId] },
                  },
                ]
              : [],
          ),
        ),
      ),
    recordBuildFailure: (input) =>
      state.recordExtensionBuildFailure(input).pipe(
        Effect.map((result) =>
          mutationResult(
            result.record,
            result.outcome === "committed"
              ? [
                  {
                    scope: "app" as const,
                    invalidation: { model: "extensions" as const, ids: [input.extensionId] },
                  },
                ]
              : [],
          ),
        ),
      ),
    recordDependencyApproval: (input) =>
      state
        .recordExtensionDependencyApproval(input)
        .pipe(Effect.map(() => mutationResult(undefined, extensionInvalidations))),
    recordDependencyReadiness: (input) =>
      state
        .recordExtensionDependencyReadiness(input)
        .pipe(Effect.map((readiness) => mutationResult(readiness, extensionInvalidations))),
    reconcileDependencyReadiness: (input) =>
      state
        .reconcileExtensionDependencyReadiness(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              { changed: result.changed, readiness: result.readiness },
              result.changed ? extensionInvalidations : [],
            ),
          ),
        ),
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
