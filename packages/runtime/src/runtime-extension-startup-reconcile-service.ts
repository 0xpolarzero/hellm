import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type BuildRuntimeExtensionInput,
  type ExtensionError,
  type ExtensionId,
  type ExtensionRegistryObservationResult,
  type ExtensionSourceBuildObservation,
  type ReconcileExtensionDependencyReadinessInput,
  type ReconcileExtensionSourceBuildEvidenceInput,
  RuntimeContractError,
  RuntimeExtensionStatePort,
  type StateContractError,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { Extensions, type ScaffoldMissingBuiltinSourcesResult } from "@svvy/extensions";

import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeExtensionBuildService } from "./runtime-extension-build-service";

export interface RuntimeExtensionStartupReconcileReceipt {
  readonly scaffold: ScaffoldMissingBuiltinSourcesResult;
  readonly builtExtensionIds: readonly ExtensionId[];
  readonly readyExtensionIds: readonly ExtensionId[];
}

export interface RuntimeExtensionStartupReconcileServiceService {
  readonly reconcile: Effect.Effect<RuntimeExtensionStartupReconcileReceipt, RuntimeContractError>;
}

export class RuntimeExtensionStartupReconcileService extends Context.Service<
  RuntimeExtensionStartupReconcileService,
  RuntimeExtensionStartupReconcileServiceService
>()("@svvy/runtime/RuntimeExtensionStartupReconcileService") {}

export const makeRuntimeExtensionStartupReconcileService = Effect.fn(
  "@svvy/runtime/makeRuntimeExtensionStartupReconcileService",
)(function* () {
  const extensions = yield* Extensions;
  const extensionState = yield* RuntimeExtensionStatePort;
  const extensionBuild = yield* RuntimeExtensionBuildService;
  const eventBus = yield* RuntimeEventBus;

  const publish = (
    operation: string,
    afterCommit: readonly StateInvalidationDescriptor[],
  ): Effect.Effect<void, RuntimeContractError> =>
    afterCommit.length === 0
      ? Effect.void
      : eventBus.publishStateInvalidations({ afterCommit }).pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation,
                reason: "stream-failed",
                message: "Extension startup reconciliation invalidation publication failed.",
                cause,
              }),
          ),
        );

  const observeAndCommitRegistryAndBuilds = (phase: "initial" | "final") =>
    Effect.gen(function* () {
      const registryObservation = yield* extensions.registry
        .observe()
        .pipe(
          Effect.mapError((cause) =>
            extensionFailure(`runtime.extensions.startupReconcile.${phase}.observeRegistry`, cause),
          ),
        );
      const observedAt = DateTime.formatIso(yield* DateTime.now);
      const registryMutation = yield* extensionState
        .reconcileRegistryObservation({ observation: registryObservation, observedAt })
        .pipe(
          Effect.mapError((cause) =>
            stateFailure(`runtime.extensions.startupReconcile.${phase}.commitRegistry`, cause),
          ),
        );
      yield* publish(
        `runtime.extensions.startupReconcile.${phase}.publishRegistry`,
        registryMutation.afterCommit,
      );

      const buildObservation = yield* extensions.builds
        .observeCurrent({ registryObservation })
        .pipe(
          Effect.mapError((cause) =>
            extensionFailure(`runtime.extensions.startupReconcile.${phase}.observeBuilds`, cause),
          ),
        );
      const buildObservedAt = DateTime.formatIso(
        yield* DateTime.now,
      ) as ReconcileExtensionSourceBuildEvidenceInput["observedAt"];
      const buildMutation = yield* extensionState
        .reconcileBuildEvidence({ ...buildObservation, observedAt: buildObservedAt })
        .pipe(
          Effect.mapError((cause) =>
            stateFailure(`runtime.extensions.startupReconcile.${phase}.commitBuilds`, cause),
          ),
        );
      yield* publish(
        `runtime.extensions.startupReconcile.${phase}.publishBuilds`,
        buildMutation.afterCommit,
      );

      return { registryObservation, buildObservation };
    });

  const reconcile = Effect.gen(function* () {
    const scaffold = yield* extensions.builtin
      .scaffoldMissing()
      .pipe(
        Effect.mapError((cause) =>
          extensionFailure("runtime.extensions.startupReconcile.scaffoldMissing", cause),
        ),
      );
    const initial = yield* observeAndCommitRegistryAndBuilds("initial");
    const initialBuilds = new Map(
      initial.buildObservation.observations.map((observation) => [
        observation.extensionId,
        observation,
      ]),
    );
    const buildCandidates = pristineRequiredBuiltinRecords(initial.registryObservation)
      .map((registry) => ({ registry, build: initialBuilds.get(registry.extensionId) }))
      .filter(
        (
          candidate,
        ): candidate is {
          readonly registry: ExtensionRegistryObservationResult["observations"][number];
          readonly build: ExtensionSourceBuildObservation;
        } =>
          candidate.build?.currentBuildStatus === "missing" ||
          candidate.build?.currentBuildStatus === "stale",
      );

    yield* Effect.forEach(
      buildCandidates,
      ({ registry, build }) =>
        build.sourceFingerprint === null
          ? Effect.fail(
              new RuntimeContractError({
                operation: "runtime.extensions.startupReconcile.build",
                reason: "target-not-ready",
                message: `Required packaged builtin source is not ready to build: ${registry.extensionId}.`,
              }),
            )
          : extensionBuild
              .build({
                extensionId: registry.extensionId,
                clientRequestId:
                  `runtime-client:extension-startup:${initial.registryObservation.aggregateFingerprint}:${registry.extensionId}:${build.sourceFingerprint}` as BuildRuntimeExtensionInput["clientRequestId"],
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new RuntimeContractError({
                      operation: "runtime.extensions.startupReconcile.build",
                      reason: cause.reason,
                      message: `Required packaged builtin build failed: ${registry.extensionId}. ${cause.message}`,
                      cause,
                    }),
                ),
              ),
      { concurrency: 1, discard: true },
    );

    const final = yield* observeAndCommitRegistryAndBuilds("final");
    const readiness = yield* extensions.dependencies
      .refreshReadiness({ registryObservation: final.registryObservation })
      .pipe(
        Effect.mapError((cause) =>
          extensionFailure("runtime.extensions.startupReconcile.final.probeReadiness", cause),
        ),
      );
    const checkedAt = DateTime.formatIso(
      yield* DateTime.now,
    ) as ReconcileExtensionDependencyReadinessInput["recordedAt"];
    const readinessMutation = yield* extensionState
      .reconcileDependencyReadiness({
        registryAggregateFingerprint: readiness.registryAggregateFingerprint,
        readiness: readiness.readiness.map((entry) => ({ ...entry, checkedAt })),
        recordedAt: checkedAt,
      })
      .pipe(
        Effect.mapError((cause) =>
          stateFailure("runtime.extensions.startupReconcile.final.commitReadiness", cause),
        ),
      );
    yield* publish(
      "runtime.extensions.startupReconcile.final.publishReadiness",
      readinessMutation.afterCommit,
    );

    const requiredBuiltins = pristineRequiredBuiltinRecords(final.registryObservation);
    const finalBuilds = new Map(
      final.buildObservation.observations.map((observation) => [
        observation.extensionId,
        observation,
      ]),
    );
    const notReady = requiredBuiltins.filter(
      (registry) =>
        !isCurrentContextReadyBuild(registry.extensionId, finalBuilds.get(registry.extensionId)),
    );
    if (notReady.length > 0) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation: "runtime.extensions.startupReconcile.final.assertReady",
          reason: "target-not-ready",
          message: `Required packaged builtin extension builds are not current and context-ready: ${notReady
            .map((record) => record.extensionId)
            .join(", ")}.`,
        }),
      );
    }

    return {
      scaffold,
      builtExtensionIds: buildCandidates.map((candidate) => candidate.registry.extensionId),
      readyExtensionIds: requiredBuiltins.map((record) => record.extensionId),
    } satisfies RuntimeExtensionStartupReconcileReceipt;
  });

  return RuntimeExtensionStartupReconcileService.of({ reconcile });
});

export const layerRuntimeExtensionStartupReconcileService = Layer.effect(
  RuntimeExtensionStartupReconcileService,
  makeRuntimeExtensionStartupReconcileService(),
);

function pristineRequiredBuiltinRecords(observation: ExtensionRegistryObservationResult) {
  return observation.observations
    .filter(
      (record) =>
        record.category === "builtin" &&
        record.buildRequirement === "required" &&
        record.customized === false,
    )
    .toSorted((left, right) => left.extensionId.localeCompare(right.extensionId));
}

function isCurrentContextReadyBuild(
  extensionId: ExtensionId,
  observation: ExtensionSourceBuildObservation | undefined,
): boolean {
  return (
    observation?.sourceStatus === "materialized" &&
    observation.currentBuildStatus === "current" &&
    observation.currentBuild !== null &&
    observation.currentBuild.contextReady === true &&
    observation.currentBuild.extensionId === extensionId &&
    observation.sourceFingerprint !== null &&
    observation.currentBuild.sourceFingerprint === observation.sourceFingerprint
  );
}

function extensionFailure(operation: string, cause: ExtensionError): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason:
      cause.reason === "invalid-input" || cause.reason === "output-invalid"
        ? "invalid-input"
        : cause.reason === "not-found"
          ? "target-not-found"
          : cause.reason === "dependency-not-ready"
            ? "dependency-not-ready"
            : cause.reason === "unsupported-operation"
              ? "unsupported-operation"
              : cause.reason === "read-only-source"
                ? "read-only-source"
                : "state-conflict",
    message: cause.message,
    cause,
  });
}

function stateFailure(operation: string, cause: StateContractError): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: "state-conflict",
    message: cause.message,
    cause,
  });
}
