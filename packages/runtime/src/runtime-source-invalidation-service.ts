import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeExternalInstructionStatePort,
  RuntimeExtensionStatePort,
  RuntimeContractError,
  RuntimeSourceStatePort,
  type ApplyCommittedSourceInvalidationEventInput,
  type GeneratedPackagesRefreshResult,
  type RefreshGeneratedContextRequest,
  type InternalRefreshGeneratedPackagesRequest,
  type ReconcileExtensionSourceBuildEvidenceInput,
  type ReconcileExtensionDependencyReadinessInput,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type SourceReconcileResult,
  type WorkspaceId,
  type ExternalInstructionScanInput,
  type RecordRuntimeSourceDiagnosticInput,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";
import { RuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
import { RuntimeGeneratedPackageRefreshService } from "./runtime-generated-package-refresh-service";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  reactToRuntimeSourceInvalidationEvent,
  type RuntimeSourceInvalidationReactionInput,
} from "./source-invalidation-reactions";
import type {
  SourceInvalidationEvent,
  SourceInvalidationHintClassification,
} from "./source-invalidation-coordinator";
import { RuntimeShutdownAdmission } from "./runtime-shutdown-admission";

export interface RuntimeSourceInvalidationScanPortService {
  classifyHint(
    input: SourceInvalidationHint,
  ): Effect.Effect<SourceInvalidationHintClassification, RuntimeContractError>;
  listAcquiredWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  requestScan(input: SourceReconcileRequest): Effect.Effect<void, RuntimeContractError>;
  reconcile(
    input: SourceReconcileRequest,
  ): Effect.Effect<SourceInvalidationEvent | null, RuntimeContractError>;
}

export interface RuntimeSourceInvalidationScanPort {
  readonly _tag: "RuntimeSourceInvalidationScanPort";
}

export const RuntimeSourceInvalidationScanPort = Context.Service<
  RuntimeSourceInvalidationScanPort,
  RuntimeSourceInvalidationScanPortService
>("@svvy/runtime/RuntimeSourceInvalidationScanPort");

export interface RuntimeExternalInstructionScanInputPortService {
  resolve(
    workspaceId: WorkspaceId,
  ): Effect.Effect<ExternalInstructionScanInput, RuntimeContractError>;
}

export interface RuntimeExternalInstructionScanInputPort {
  readonly _tag: "RuntimeExternalInstructionScanInputPort";
}

export const RuntimeExternalInstructionScanInputPort = Context.Service<
  RuntimeExternalInstructionScanInputPort,
  RuntimeExternalInstructionScanInputPortService
>("@svvy/runtime/RuntimeExternalInstructionScanInputPort");

export interface RuntimeSourceInvalidationServiceService {
  hint(input: SourceInvalidationHint): Effect.Effect<void, RuntimeContractError>;
  reconcile(
    input: SourceReconcileRequest,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  applyCommittedScanEvent(
    input: ApplyCommittedSourceInvalidationEventInput,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  refreshGeneratedContext(
    input: RefreshGeneratedContextRequest,
  ): Effect.Effect<void, RuntimeContractError>;
  refreshGeneratedPackages(
    input: InternalRefreshGeneratedPackagesRequest,
  ): Effect.Effect<GeneratedPackagesRefreshResult, RuntimeContractError>;
}

export class RuntimeSourceInvalidationService extends Context.Service<
  RuntimeSourceInvalidationService,
  RuntimeSourceInvalidationServiceService
>()("@svvy/runtime/RuntimeSourceInvalidationService") {}

export const layerRuntimeSourceInvalidationService = Layer.effect(
  RuntimeSourceInvalidationService,
  Effect.gen(function* () {
    const generatedContextRefresh = yield* RuntimeGeneratedContextRefreshService;
    const generatedPackageRefresh = yield* RuntimeGeneratedPackageRefreshService;
    const sourceScanner = yield* RuntimeSourceInvalidationScanPort;
    const externalInstructionScanInput = yield* RuntimeExternalInstructionScanInputPort;
    const externalInstructionState = yield* RuntimeExternalInstructionStatePort;
    const extensionState = yield* RuntimeExtensionStatePort;
    const sourceState = yield* RuntimeSourceStatePort;
    const extensions = yield* Extensions;
    const eventBus = yield* RuntimeEventBus;
    const shutdownAdmission = yield* RuntimeShutdownAdmission;

    const admit = <A>(
      operation: string,
      effect: Effect.Effect<A, RuntimeContractError>,
    ): Effect.Effect<A, RuntimeContractError> =>
      shutdownAdmission.assertAccepting(operation).pipe(Effect.andThen(effect));

    const reactToScan = (input: RuntimeSourceInvalidationReactionInput) =>
      reactToRuntimeSourceInvalidationEvent(input, {
        listAcquiredWorkspaceIds: () => sourceScanner.listAcquiredWorkspaceIds(),
        refreshGeneratedContext: (request) => generatedContextRefresh.refresh(request),
        refreshGeneratedPackages: (request) => generatedPackageRefresh.refresh(request),
      });

    const reconcileExtensionRegistry = (input: ApplyCommittedSourceInvalidationEventInput) =>
      Effect.gen(function* () {
        if (input.scope.kind !== "app-global" || !input.event.domains.includes("extensions")) {
          return input.event;
        }
        yield* extensions.sources.recoverMutations().pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.sourceInvalidation.extensions.recover",
                reason: "state-conflict",
                message: cause.message,
                cause,
              }),
          ),
        );
        const observation = yield* extensions.registry.observe().pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.sourceInvalidation.extensions.observe",
                reason: "state-conflict",
                message: cause.message,
                cause,
              }),
          ),
        );
        const observedAt = DateTime.formatIso(yield* DateTime.now);
        const registryMutation = yield* extensionState
          .reconcileRegistryObservation({ observation, observedAt })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RuntimeContractError({
                  operation: "runtime.sourceInvalidation.extensions.commit",
                  reason: "state-conflict",
                  message: cause.message,
                  cause,
                }),
            ),
          );
        const buildEvidence = yield* extensions.builds
          .observeCurrent({ registryObservation: observation })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RuntimeContractError({
                  operation: "runtime.sourceInvalidation.extensions.observe-builds",
                  reason: "state-conflict",
                  message: cause.message,
                  cause,
                }),
            ),
          );
        const buildObservedAt = DateTime.formatIso(
          yield* DateTime.now,
        ) as ReconcileExtensionSourceBuildEvidenceInput["observedAt"];
        const buildMutation = yield* extensionState
          .reconcileBuildEvidence({ ...buildEvidence, observedAt: buildObservedAt })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RuntimeContractError({
                  operation: "runtime.sourceInvalidation.extensions.commit-builds",
                  reason: "state-conflict",
                  message: cause.message,
                  cause,
                }),
            ),
          );
        const readiness = yield* extensions.dependencies
          .refreshReadiness({ registryObservation: observation })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RuntimeContractError({
                  operation: "runtime.sourceInvalidation.extensions.probe-readiness",
                  reason: "state-conflict",
                  message: cause.message,
                  cause,
                }),
            ),
          );
        const checkedAt = DateTime.formatIso(
          yield* DateTime.now,
        ) as ReconcileExtensionDependencyReadinessInput["recordedAt"];
        const readinessRecords: ReconcileExtensionDependencyReadinessInput["readiness"] =
          readiness.readiness.map((entry) => ({ ...entry, checkedAt }));
        const readinessMutation = yield* extensionState
          .reconcileDependencyReadiness({
            registryAggregateFingerprint: readiness.registryAggregateFingerprint,
            readiness: readinessRecords,
            recordedAt: checkedAt,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RuntimeContractError({
                  operation: "runtime.sourceInvalidation.extensions.commit-readiness",
                  reason: "state-conflict",
                  message: cause.message,
                  cause,
                }),
            ),
          );
        const afterCommitWithoutCoarseExtensionInvalidation = input.event.afterCommit.filter(
          (descriptor) =>
            !(descriptor.scope === "app" && descriptor.invalidation.model === "extensions"),
        );
        const afterCommit = [
          ...afterCommitWithoutCoarseExtensionInvalidation,
          ...registryMutation.afterCommit,
          ...buildMutation.afterCommit,
          ...readinessMutation.afterCommit,
        ].filter(
          (descriptor, index, descriptors) =>
            descriptors.findIndex(
              (candidate) => JSON.stringify(candidate) === JSON.stringify(descriptor),
            ) === index,
        );
        if (registryMutation.afterCommit.length === 0) {
          return {
            ...input.event,
            domains: input.event.domains.filter((domain) => domain !== "extensions"),
            afterCommit,
          } satisfies SourceInvalidationEvent;
        }
        return {
          ...input.event,
          afterCommit,
        } satisfies SourceInvalidationEvent;
      }).pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            const observedAt = DateTime.formatIso(yield* DateTime.now);
            const diagnostic = yield* sourceState
              .recordSourceDiagnostic({
                scope: input.scope,
                domain: "extensions",
                ...(input.event.sourceFingerprints.extensions
                  ? { sourceFingerprint: input.event.sourceFingerprints.extensions }
                  : {}),
                diagnostic: {
                  severity: "error",
                  code: "EXTENSION_PROJECTION_RECONCILE_FAILED",
                  message: "Extension source projection reconciliation failed.",
                },
                observedAt: observedAt as RecordRuntimeSourceDiagnosticInput["observedAt"],
              })
              .pipe(Effect.catch(() => Effect.succeed(null)));
            if (diagnostic) {
              yield* eventBus
                .publishStateInvalidations({ afterCommit: diagnostic.afterCommit })
                .pipe(Effect.ignore);
            }
            return yield* Effect.fail(cause);
          }),
        ),
      );

    const reconcileExternalInstructions = (input: ApplyCommittedSourceInvalidationEventInput) =>
      Effect.gen(function* () {
        if (
          input.scope.kind !== "workspace" ||
          !input.event.domains.includes("external_instructions")
        ) {
          return input.event;
        }
        const workspaceId = input.scope.workspaceId;
        const scanInput = yield* externalInstructionScanInput.resolve(workspaceId);
        const scan = yield* extensions.externalInstructions.scan(scanInput).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.sourceInvalidation.externalInstructions.scan",
                reason: "state-conflict",
                message: cause.message,
                cause,
              }),
          ),
        );
        const mutation = yield* externalInstructionState
          .reconcileExternalInstructions({ workspaceId, scan })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RuntimeContractError({
                  operation: "runtime.sourceInvalidation.externalInstructions.commit",
                  reason: "state-conflict",
                  message: cause.message,
                  cause,
                }),
            ),
          );
        if (!mutation.value.changed) {
          return {
            ...input.event,
            domains: input.event.domains.filter((domain) => domain !== "external_instructions"),
          } satisfies SourceInvalidationEvent;
        }
        return {
          ...input.event,
          afterCommit: [...input.event.afterCommit, ...mutation.afterCommit],
        } satisfies SourceInvalidationEvent;
      }).pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            const observedAt = DateTime.formatIso(yield* DateTime.now);
            const diagnostic = yield* sourceState
              .recordSourceDiagnostic({
                scope: input.scope,
                domain: "external_instructions",
                ...(input.event.sourceFingerprints.external_instructions
                  ? {
                      sourceFingerprint: input.event.sourceFingerprints.external_instructions,
                    }
                  : {}),
                diagnostic: {
                  severity: "error",
                  code: "EXTERNAL_INSTRUCTION_RECONCILE_FAILED",
                  message: "External instruction observation reconciliation failed.",
                },
                observedAt: observedAt as RecordRuntimeSourceDiagnosticInput["observedAt"],
              })
              .pipe(Effect.catch(() => Effect.succeed(null)));
            if (diagnostic) {
              yield* eventBus
                .publishStateInvalidations({ afterCommit: diagnostic.afterCommit })
                .pipe(Effect.ignore);
            }
            return yield* Effect.fail(cause);
          }),
        ),
      );

    const applyCommittedScanEvent = (input: ApplyCommittedSourceInvalidationEventInput) =>
      Effect.gen(function* () {
        const extensionEvent = yield* reconcileExtensionRegistry(input);
        const event = yield* reconcileExternalInstructions({ ...input, event: extensionEvent });
        yield* eventBus.publishStateInvalidations({ afterCommit: event.afterCommit }).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.sourceInvalidation.applyCommittedScanEvent.publish",
                reason: "state-conflict",
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Runtime source invalidation publication failed.",
                cause,
              }),
          ),
          Effect.asVoid,
        );
        const reaction =
          input.scope.kind === "app-global"
            ? yield* reactToScan({ scope: { kind: "app-global" }, event })
            : yield* reactToScan({ scope: input.scope, event });
        const generatedPackageRefreshes = reaction.generatedPackageRefresh
          ? [reaction.generatedPackageRefresh]
          : [];
        return {
          changedReadModelCount: event.afterCommit.length,
          generatedPackageRefreshes,
          recoveryWorkIds: generatedPackageRefreshes.flatMap((refresh) => refresh.recoveryWorkIds),
        } satisfies SourceReconcileResult;
      });

    const reconcileSourceInputs = (input: SourceReconcileRequest) =>
      Effect.gen(function* () {
        const event = yield* sourceScanner.reconcile(input);
        if (!event) {
          if (
            input.scope.kind === "app-global" &&
            (!input.domains || input.domains.includes("extensions"))
          ) {
            return yield* applyCommittedScanEvent({
              scope: input.scope,
              event: {
                domains: ["extensions"],
                reason: input.reason,
                sourceFingerprints: {
                  extensions: "",
                  external_instructions: "",
                  host_snippets: "",
                  workflows: "",
                },
                afterCommit: [],
              },
            });
          }
          if (
            input.scope.kind === "workspace" &&
            (!input.domains || input.domains.includes("external_instructions"))
          ) {
            return yield* applyCommittedScanEvent({
              scope: input.scope,
              event: {
                domains: ["external_instructions"],
                reason: input.reason,
                sourceFingerprints: {
                  extensions: "",
                  external_instructions: "",
                  host_snippets: "",
                  workflows: "",
                },
                afterCommit: [],
              },
            });
          }
          return {
            changedReadModelCount: 0,
            generatedPackageRefreshes: [],
            recoveryWorkIds: [],
          } satisfies SourceReconcileResult;
        }
        return yield* applyCommittedScanEvent({ scope: input.scope, event });
      });

    return RuntimeSourceInvalidationService.of({
      hint: (input) =>
        admit(
          "runtime.sourceInvalidation.hint",
          Effect.gen(function* () {
            const classification = yield* sourceScanner.classifyHint(input);
            if (classification === "ignore") {
              return;
            }
            yield* sourceScanner.requestScan({
              scope: input.scope,
              domains: [input.domain],
              reason:
                classification === "scan-parent-domain"
                  ? "ignored-path-parent-domain-scan"
                  : "watcher-debounce",
            });
          }),
        ),
      reconcile: (input) =>
        admit("runtime.sourceInvalidation.reconcile", reconcileSourceInputs(input)),
      applyCommittedScanEvent: (input) =>
        admit("runtime.sourceInvalidation.applyCommittedScanEvent", applyCommittedScanEvent(input)),
      refreshGeneratedContext: (input) =>
        admit(
          "runtime.sourceInvalidation.refreshGeneratedContext",
          generatedContextRefresh.refresh(input),
        ),
      refreshGeneratedPackages: (input) =>
        admit(
          "runtime.sourceInvalidation.refreshGeneratedPackages",
          generatedPackageRefresh.refresh(input),
        ),
    });
  }),
);
