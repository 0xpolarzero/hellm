import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import {
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  RuntimeExternalInstructionStatePort,
  RuntimeExtensionStatePort,
  RuntimeSourceStatePort,
  RuntimeContractError,
  RuntimeEventStreamError,
  type AbsolutePath,
  type GeneratedPackageName,
  type GeneratedPackagesRefreshResult,
  type InternalRefreshGeneratedPackagesRequest,
  type RefreshGeneratedContextRequest,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type StateInvalidationDescriptor,
  type WorkspaceId,
  type ExternalInstructionScanInput,
  type ExternalInstructionScanResult,
  type ExternalInstructionObservationProjection,
  type ExtensionRegistryObservationResult,
  type RuntimeSourceStatePortService,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
import { RuntimeGeneratedPackageRefreshService } from "./runtime-generated-package-refresh-service";
import {
  RuntimeSourceInvalidationScanPort,
  RuntimeExternalInstructionScanInputPort,
  RuntimeSourceInvalidationService,
  layerRuntimeSourceInvalidationService,
} from "./runtime-source-invalidation-service";
import type { SourceInvalidationEvent } from "./source-invalidation-coordinator";
import { layerRuntimeShutdownAdmission } from "./runtime-shutdown-admission";
import { RuntimeShutdownAdmission } from "./runtime-shutdown-admission";

const workspaceOne = "workspace_runtime_source_service_01" as WorkspaceId;
const workspaceTwo = "workspace_runtime_source_service_02" as WorkspaceId;

const extensionHint = {
  scope: { kind: "app-global" },
  domain: "extensions",
  path: "/tmp/svvy/extensions/sources/user/web/index.ts" as AbsolutePath,
  observedAt: "2026-06-19T08:00:00.000Z" as NonNullable<SourceInvalidationHint["observedAt"]>,
} satisfies SourceInvalidationHint;

describe("runtime source invalidation service", () => {
  it.effect("classifies public hints before scheduling source scans", () => {
    const scheduledScans: SourceReconcileRequest[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      yield* service.hint(extensionHint);

      assert.deepStrictEqual(scheduledScans, [
        {
          scope: { kind: "app-global" },
          domains: ["extensions"],
          reason: "watcher-debounce",
        },
      ]);
    }).pipe(Effect.provide(testLayer({ scheduledScans })));
  });

  it.effect("schedules parent source domains for in-root generated or temporary hint paths", () => {
    const scheduledScans: SourceReconcileRequest[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      yield* service.hint(extensionHint);

      assert.deepStrictEqual(scheduledScans, [
        {
          scope: { kind: "app-global" },
          domains: ["extensions"],
          reason: "ignored-path-parent-domain-scan",
        },
      ]);
    }).pipe(Effect.provide(testLayer({ classification: "scan-parent-domain", scheduledScans })));
  });

  it.effect("fails public hints classified outside allowed roots as typed runtime errors", () =>
    Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      const exit = yield* service.hint(extensionHint).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
        assert.instanceOf(failure, RuntimeContractError);
        assert.strictEqual(failure.reason, "invalid-input");
      }
    }).pipe(Effect.provide(testLayer({ classification: "fail" }))),
  );

  it.effect("rejects source work after the shared runtime shutdown marker", () => {
    const scheduledScans: SourceReconcileRequest[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;
      const shutdown = yield* RuntimeShutdownAdmission;
      yield* shutdown.runShutdown(
        Effect.succeed({
          status: "drained",
          interruptedTurns: 0,
          interruptedCommands: 0,
          releasedQueueClaims: 0,
          recoveryRowsScheduled: 0,
        }),
      );

      const error = yield* service.hint(extensionHint).pipe(Effect.flip);

      assert.strictEqual(error.reason, "runtime-shutdown");
      assert.deepStrictEqual(scheduledScans, []);
    }).pipe(Effect.provide(testLayer({ scheduledScans })));
  });

  it.effect("runs app-global source reactions through runtime refresh services", () => {
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      const result = yield* service.reconcile({
        scope: { kind: "app-global" },
        domains: ["extensions"],
        reason: "watcher-debounce",
      });

      assert.deepStrictEqual(packageRefreshes, [
        {
          scope: "app-global",
          packages: ["@svvyx/extensions", "@svvyx/workflows"],
          reason: "source-changed",
        },
      ]);
      assert.deepStrictEqual(contextRefreshes, [
        {
          scope: "workspace",
          workspaceId: workspaceOne,
          reason: "extension-source-changed",
        },
        {
          scope: "workspace",
          workspaceId: workspaceTwo,
          reason: "extension-source-changed",
        },
      ]);
      assert.deepStrictEqual(publishedInvalidations, [
        {
          scope: "app",
          invalidation: { model: "extensions" },
        },
      ]);
      assert.deepStrictEqual(result, {
        changedReadModelCount: 1,
        generatedPackageRefreshes: [
          generatedPackageRefresh(["@svvyx/extensions", "@svvyx/workflows"]),
        ],
        recoveryWorkIds: [],
      });
    }).pipe(
      Effect.provide(
        testLayer({
          acquiredWorkspaceIds: [workspaceOne, workspaceTwo],
          contextRefreshes,
          packageRefreshes,
          publishedInvalidations,
          reconcileEvent: sourceEvent(["extensions"]),
        }),
      ),
    );
  });

  it.effect(
    "applies committed source invalidation events through publication and reactions",
    () => {
      const contextRefreshes: RefreshGeneratedContextRequest[] = [];
      const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
      const publishedInvalidations: StateInvalidationDescriptor[] = [];
      const reconciliations: SourceReconcileRequest[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeSourceInvalidationService;

        const result = yield* service.applyCommittedScanEvent({
          scope: { kind: "app-global" },
          event: sourceEvent(["extensions"]),
        });

        assert.deepStrictEqual(reconciliations, []);
        assert.deepStrictEqual(packageRefreshes, [
          {
            scope: "app-global",
            packages: ["@svvyx/extensions", "@svvyx/workflows"],
            reason: "source-changed",
          },
        ]);
        assert.deepStrictEqual(contextRefreshes, [
          {
            scope: "workspace",
            workspaceId: workspaceOne,
            reason: "extension-source-changed",
          },
        ]);
        assert.deepStrictEqual(publishedInvalidations, [
          {
            scope: "app",
            invalidation: { model: "extensions" },
          },
        ]);
        assert.deepStrictEqual(result, {
          changedReadModelCount: 1,
          generatedPackageRefreshes: [
            generatedPackageRefresh(["@svvyx/extensions", "@svvyx/workflows"]),
          ],
          recoveryWorkIds: [],
        });
      }).pipe(
        Effect.provide(
          testLayer({
            acquiredWorkspaceIds: [workspaceOne],
            contextRefreshes,
            packageRefreshes,
            publishedInvalidations,
            reconciliations,
          }),
        ),
      );
    },
  );

  it.effect("commits extension registry observations before publishing exact invalidations", () => {
    const operationOrder: string[] = [];
    const lifecycleRecoveries: string[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      yield* service.applyCommittedScanEvent({
        scope: { kind: "app-global" },
        event: sourceEvent(["extensions"]),
      });

      assert.deepStrictEqual(operationOrder, [
        "registry-observe",
        "registry-commit",
        "build-observe",
        "build-commit",
        "readiness-probe",
        "readiness-commit",
        "publish",
      ]);
      assert.deepStrictEqual(lifecycleRecoveries, ["recover"]);
      assert.deepStrictEqual(publishedInvalidations, [
        { scope: "app", invalidation: { model: "extensions" } },
      ]);
    }).pipe(
      Effect.provide(testLayer({ operationOrder, lifecycleRecoveries, publishedInvalidations })),
    );
  });

  it.effect("emits nothing when an unchanged manual extension registry scan reconciles", () => {
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      const result = yield* service.reconcile({
        scope: { kind: "app-global" },
        domains: ["extensions"],
        reason: "manual",
      });

      assert.deepStrictEqual(result, {
        changedReadModelCount: 0,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      });
      assert.deepStrictEqual(contextRefreshes, []);
      assert.deepStrictEqual(packageRefreshes, []);
      assert.deepStrictEqual(publishedInvalidations, []);
    }).pipe(
      Effect.provide(
        testLayer({
          contextRefreshes,
          extensionBuildEvidenceChanged: false,
          extensionRegistryChanged: false,
          extensionReadinessChanged: false,
          packageRefreshes,
          publishedInvalidations,
        }),
      ),
    );
  });

  it.effect("retries an identical extension registry scan after projection commit failure", () => {
    const failExtensionRegistryCommit = { current: true };
    const extensionRegistryObservations: ExtensionRegistryObservationResult[] = [];
    const extensionRegistryCommits: string[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;
      const first = yield* service
        .applyCommittedScanEvent({
          scope: { kind: "app-global" },
          event: { ...sourceEvent(["extensions"]), afterCommit: [] },
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(first));

      failExtensionRegistryCommit.current = false;
      const retry = yield* service.reconcile({
        scope: { kind: "app-global" },
        domains: ["extensions"],
        reason: "periodic",
      });

      assert.strictEqual(extensionRegistryObservations.length, 2);
      assert.strictEqual(extensionRegistryCommits.length, 1);
      assert.strictEqual(retry.changedReadModelCount, 1);
      assert.deepStrictEqual(publishedInvalidations.at(-1), {
        scope: "app",
        invalidation: { model: "extensions" },
      });
    }).pipe(
      Effect.provide(
        testLayer({
          extensionRegistryCommits,
          extensionRegistryObservations,
          failExtensionRegistryCommit,
          publishedInvalidations,
        }),
      ),
    );
  });

  it.effect(
    "fails committed source invalidation event application before reactions when publication fails",
    () => {
      const contextRefreshes: RefreshGeneratedContextRequest[] = [];
      const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeSourceInvalidationService;

        const exit = yield* service
          .applyCommittedScanEvent({
            scope: { kind: "app-global" },
            event: sourceEvent(["extensions"]),
          })
          .pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
          assert.instanceOf(failure, RuntimeContractError);
          assert.strictEqual(
            failure.operation,
            "runtime.sourceInvalidation.applyCommittedScanEvent.publish",
          );
        }
        assert.deepStrictEqual(packageRefreshes, []);
        assert.deepStrictEqual(contextRefreshes, []);
      }).pipe(
        Effect.provide(
          testLayer({
            contextRefreshes,
            packageRefreshes,
            publishStateInvalidationsFailure: true,
          }),
        ),
      );
    },
  );

  it.effect("runs workspace source reactions through runtime context refresh service", () => {
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      const result = yield* service.reconcile({
        scope: { kind: "workspace", workspaceId: workspaceOne },
        domains: ["external_instructions"],
        reason: "watcher-debounce",
      });

      assert.deepStrictEqual(packageRefreshes, []);
      assert.deepStrictEqual(contextRefreshes, [
        {
          scope: "workspace",
          workspaceId: workspaceOne,
          reason: "external-instruction-changed",
        },
      ]);
      assert.deepStrictEqual(publishedInvalidations, [
        {
          scope: "app",
          invalidation: { model: "extensions" },
        },
        {
          scope: "workspace",
          workspaceId: workspaceOne,
          invalidation: { model: "externalInstructions" },
        },
      ]);
      assert.deepStrictEqual(result, {
        changedReadModelCount: 2,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      });
    }).pipe(
      Effect.provide(
        testLayer({
          contextRefreshes,
          packageRefreshes,
          publishedInvalidations,
          reconcileEvent: sourceEvent(["external_instructions"]),
        }),
      ),
    );
  });

  it.effect(
    "commits external instruction observations before publishing exact invalidations",
    () => {
      const operationOrder: string[] = [];
      const publishedInvalidations: StateInvalidationDescriptor[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeSourceInvalidationService;

        yield* service.applyCommittedScanEvent({
          scope: { kind: "workspace", workspaceId: workspaceOne },
          event: { ...sourceEvent(["external_instructions"]), afterCommit: [] },
        });

        assert.deepStrictEqual(operationOrder, ["scan", "commit", "publish"]);
        assert.deepStrictEqual(publishedInvalidations, [
          {
            scope: "workspace",
            workspaceId: workspaceOne,
            invalidation: { model: "externalInstructions" },
          },
        ]);
      }).pipe(Effect.provide(testLayer({ operationOrder, publishedInvalidations })));
    },
  );

  it.effect("emits nothing when an unchanged manual external instruction scan reconciles", () => {
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      const result = yield* service.reconcile({
        scope: { kind: "workspace", workspaceId: workspaceOne },
        domains: ["external_instructions"],
        reason: "manual",
      });

      assert.deepStrictEqual(result, {
        changedReadModelCount: 0,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      });
      assert.deepStrictEqual(contextRefreshes, []);
      assert.deepStrictEqual(publishedInvalidations, []);
    }).pipe(
      Effect.provide(
        testLayer({
          contextRefreshes,
          externalInstructionsChanged: false,
          publishedInvalidations,
        }),
      ),
    );
  });

  it.effect(
    "retries an identical external instruction scan after projection commit failure",
    () => {
      const failExternalInstructionCommit = { current: true };
      const externalInstructionScans: ExternalInstructionScanInput[] = [];
      const externalInstructionCommits: string[] = [];
      const publishedInvalidations: StateInvalidationDescriptor[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeSourceInvalidationService;
        const first = yield* service
          .applyCommittedScanEvent({
            scope: { kind: "workspace", workspaceId: workspaceOne },
            event: { ...sourceEvent(["external_instructions"]), afterCommit: [] },
          })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(first));

        failExternalInstructionCommit.current = false;
        const retry = yield* service.reconcile({
          scope: { kind: "workspace", workspaceId: workspaceOne },
          domains: ["external_instructions"],
          reason: "periodic",
        });

        assert.strictEqual(externalInstructionScans.length, 2);
        assert.deepStrictEqual(externalInstructionCommits, [workspaceOne]);
        assert.strictEqual(retry.changedReadModelCount, 1);
        assert.deepStrictEqual(publishedInvalidations.at(-1), {
          scope: "workspace",
          workspaceId: workspaceOne,
          invalidation: { model: "externalInstructions" },
        });
      }).pipe(
        Effect.provide(
          testLayer({
            externalInstructionCommits,
            externalInstructionScans,
            failExternalInstructionCommit,
            publishedInvalidations,
          }),
        ),
      );
    },
  );
});

function testLayer(input: {
  readonly acquiredWorkspaceIds?: readonly WorkspaceId[];
  readonly classification?: "scan" | "scan-parent-domain" | "ignore" | "fail";
  readonly contextRefreshes?: RefreshGeneratedContextRequest[];
  readonly packageRefreshes?: InternalRefreshGeneratedPackagesRequest[];
  readonly publishedInvalidations?: StateInvalidationDescriptor[];
  readonly publishStateInvalidationsFailure?: boolean;
  readonly reconcileEvent?: SourceInvalidationEvent | null;
  readonly reconciliations?: SourceReconcileRequest[];
  readonly scheduledScans?: SourceReconcileRequest[];
  readonly externalInstructionScans?: ExternalInstructionScanInput[];
  readonly externalInstructionCommits?: string[];
  readonly failExternalInstructionCommit?: { current: boolean };
  readonly externalInstructionsChanged?: boolean;
  readonly extensionRegistryChanged?: boolean;
  readonly extensionBuildEvidenceChanged?: boolean;
  readonly extensionReadinessChanged?: boolean;
  readonly extensionRegistryObservations?: ExtensionRegistryObservationResult[];
  readonly extensionRegistryCommits?: string[];
  readonly failExtensionRegistryCommit?: { current: boolean };
  readonly operationOrder?: string[];
  readonly lifecycleRecoveries?: string[];
}) {
  const reconciliations = input.reconciliations ?? [];
  const scheduledScans = input.scheduledScans ?? [];
  return layerRuntimeSourceInvalidationService.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RuntimeGeneratedContextRefreshService, {
          refresh: (request) =>
            Effect.sync(() => {
              input.contextRefreshes?.push(request);
            }),
        }),
        Layer.succeed(RuntimeGeneratedPackageRefreshService, {
          refresh: (request) =>
            Effect.sync(() => {
              input.packageRefreshes?.push(request);
              return generatedPackageRefresh(request.packages);
            }),
        }),
        Layer.succeed(
          RuntimeEventBus,
          RuntimeEventBus.of({
            publishLive: () =>
              Effect.die("runtime source invalidation service test does not publish live events"),
            publishStateInvalidations: ({ afterCommit }) =>
              input.publishStateInvalidationsFailure
                ? Effect.fail(
                    new RuntimeEventStreamError({
                      operation: "runtime.events.publishStateInvalidations",
                      reason: "stream-failed",
                      message: "Publication failed.",
                    }),
                  )
                : Effect.sync(() => {
                    input.operationOrder?.push("publish");
                    input.publishedInvalidations?.push(...afterCommit);
                    return [];
                  }),
            subscribe: () => Effect.die("runtime source invalidation service test does not stream"),
          }),
        ),
        Layer.succeed(RuntimeSourceInvalidationScanPort, {
          classifyHint: () =>
            input.classification === "fail"
              ? Effect.fail(
                  new RuntimeContractError({
                    operation: "runtime.sourceInvalidation.hint",
                    reason: "invalid-input",
                    message: "Source invalidation hint path is outside configured source roots.",
                  }),
                )
              : Effect.succeed(input.classification ?? "scan"),
          listAcquiredWorkspaceIds: () => Effect.succeed(input.acquiredWorkspaceIds ?? []),
          requestScan: (request) =>
            Effect.sync(() => {
              scheduledScans.push(request);
            }),
          reconcile: (request) =>
            Effect.sync(() => {
              reconciliations.push(request);
              return input.reconcileEvent ?? null;
            }),
        }),
        Layer.succeed(RuntimeExternalInstructionScanInputPort, {
          resolve: (workspaceId) =>
            Effect.succeed({
              workspaceId,
              workspaceRoot: "/tmp/svvy/workspace" as AbsolutePath,
              cwd: "/tmp/svvy/workspace" as AbsolutePath,
              homeDirectory: "/tmp/svvy/home" as AbsolutePath,
              settings: DEFAULT_EXTERNAL_INSTRUCTIONS,
            }),
        }),
        Layer.succeed(Extensions, {
          sources: {
            recoverMutations: () =>
              Effect.sync(() => {
                input.lifecycleRecoveries?.push("recover");
              }),
          },
          registry: {
            observe: () =>
              Effect.sync(() => {
                input.operationOrder?.push("registry-observe");
                const observation = emptyExtensionRegistryObservation();
                input.extensionRegistryObservations?.push(observation);
                return observation;
              }),
          },
          builds: {
            observeCurrent: ({
              registryObservation,
            }: Parameters<Extensions["Service"]["builds"]["observeCurrent"]>[0]) =>
              Effect.sync(() => {
                input.operationOrder?.push("build-observe");
                return {
                  registryAggregateFingerprint: registryObservation.aggregateFingerprint,
                  observations: [],
                };
              }),
          },
          dependencies: {
            refreshReadiness: ({
              registryObservation,
            }: Parameters<Extensions["Service"]["dependencies"]["refreshReadiness"]>[0]) =>
              Effect.sync(() => {
                input.operationOrder?.push("readiness-probe");
                return {
                  registryAggregateFingerprint: registryObservation.aggregateFingerprint,
                  readiness: [],
                };
              }),
          },
          externalInstructions: {
            scan: (request: ExternalInstructionScanInput) =>
              Effect.sync(() => {
                input.operationOrder?.push("scan");
                input.externalInstructionScans?.push(request);
                return emptyExternalInstructionScan();
              }),
          },
        } as unknown as Extensions["Service"]),
        Layer.succeed(RuntimeExtensionStatePort, {
          readBuildAttemptByClientRequestId: () => Effect.succeed(null),
          reconcileRegistryObservation: ({ observation }) =>
            input.failExtensionRegistryCommit?.current
              ? Effect.fail(
                  new RuntimeContractError({
                    operation: "test.extensions.commit",
                    reason: "state-conflict",
                    message: "extension registry commit failed",
                  }) as never,
                )
              : Effect.sync(() => {
                  input.operationOrder?.push("registry-commit");
                  input.extensionRegistryCommits?.push(observation.aggregateFingerprint);
                  const changed = input.extensionRegistryChanged ?? true;
                  return {
                    value: {
                      observation,
                      observedAt: "2026-07-12T03:00:00.000Z",
                    },
                    afterCommit: changed
                      ? [{ scope: "app" as const, invalidation: { model: "extensions" as const } }]
                      : [],
                  };
                }),
          reconcileBuildEvidence: () =>
            Effect.sync(() => {
              input.operationOrder?.push("build-commit");
              const changed = input.extensionBuildEvidenceChanged ?? true;
              return {
                value: { changed, changedExtensionIds: [] },
                afterCommit: changed
                  ? [{ scope: "app" as const, invalidation: { model: "extensions" as const } }]
                  : [],
              };
            }),
          startBuildAttempt: () => Effect.die("unused extension build attempt start"),
          recordBuildSuccess: () => Effect.die("unused extension build success"),
          recordBuildFailure: () => Effect.die("unused extension build failure"),
          reconcileDependencyReadiness: ({ readiness }) =>
            Effect.sync(() => {
              input.operationOrder?.push("readiness-commit");
              const changed = input.extensionReadinessChanged ?? true;
              return {
                value: { changed, readiness },
                afterCommit: changed
                  ? [{ scope: "app" as const, invalidation: { model: "extensions" as const } }]
                  : [],
              };
            }),
          recordDependencyApproval: () => Effect.die("unused dependency approval"),
          recordDependencyReadiness: () => Effect.die("unused dependency readiness"),
        }),
        Layer.succeed(RuntimeExternalInstructionStatePort, {
          reconcileExternalInstructions: ({ workspaceId }) =>
            input.failExternalInstructionCommit?.current
              ? Effect.fail(
                  new RuntimeContractError({
                    operation: "test.externalInstructions.commit",
                    reason: "state-conflict",
                    message: "external instruction commit failed",
                  }) as never,
                )
              : Effect.sync(() => {
                  input.operationOrder?.push("commit");
                  input.externalInstructionCommits?.push(workspaceId);
                  const changed = input.externalInstructionsChanged ?? true;
                  return {
                    value: { changed, projection: emptyExternalInstructionProjection(workspaceId) },
                    afterCommit: changed
                      ? [
                          {
                            scope: "workspace" as const,
                            workspaceId,
                            invalidation: { model: "externalInstructions" as const },
                          },
                        ]
                      : [],
                  };
                }),
          readExternalInstructions: ({ workspaceId }) =>
            Effect.succeed({
              ...emptyExternalInstructionProjection(workspaceId),
              actorUsage: [],
            }),
        }),
        Layer.succeed(RuntimeSourceStatePort, {
          recordSourceDiagnostic: () =>
            Effect.succeed({
              value: {} as never,
              afterCommit: [{ scope: "app", invalidation: { model: "extensions" } }],
            }),
        } as unknown as RuntimeSourceStatePortService),
      ),
    ),
    Layer.provideMerge(layerRuntimeShutdownAdmission),
  );
}

function emptyExternalInstructionScan(): ExternalInstructionScanResult {
  return { sources: [], contents: [], diagnostics: [] };
}

function emptyExtensionRegistryObservation(): ExtensionRegistryObservationResult {
  return {
    aggregateFingerprint: "extension_registry_fingerprint",
    observations: [],
    diagnostics: [],
  };
}

function emptyExternalInstructionProjection(
  workspaceId: WorkspaceId,
): ExternalInstructionObservationProjection {
  return {
    workspaceId,
    sources: [],
    diagnostics: [],
    observedAt: null,
    revision: 0 as ExternalInstructionObservationProjection["revision"],
  };
}

function sourceEvent(domains: SourceInvalidationEvent["domains"]): SourceInvalidationEvent {
  return {
    domains: [...domains],
    reason: "test",
    sourceFingerprints: {
      extensions: "extensions_fingerprint",
      external_instructions: "external_instructions_fingerprint",
      host_snippets: "host_snippets_fingerprint",
      workflows: "workflows_fingerprint",
    },
    afterCommit: [
      {
        scope: "app",
        invalidation: { model: "extensions" },
      },
    ],
  };
}

function generatedPackageRefresh(
  packages: readonly GeneratedPackageName[],
): GeneratedPackagesRefreshResult {
  return {
    scope: "app-global",
    packages: packages.map((packageName) => ({
      packageName,
      action: "written",
    })),
    workspaceLinks: [],
    recoveryWorkIds: [],
  };
}
