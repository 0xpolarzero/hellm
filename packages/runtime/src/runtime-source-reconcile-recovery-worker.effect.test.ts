import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import {
  RuntimeRecoveryStatePort,
  RuntimeSourceStatePort,
  StateContractError,
  type AbsolutePath,
  type ClaimNextRuntimeRecoveryWorkInput,
  type RecordRuntimeSourceSaveInput,
  type RuntimeEvent,
  type RuntimeEventGenerationId,
  type RuntimeEventSequence,
  type RuntimeOwnerId,
  type RuntimeRecoveryStatePortService,
  type RuntimeRecoveryWorkRecord,
  type RuntimeSourceFactRecord,
  type RuntimeSourceStatePortService,
  type StateInvalidationDescriptor,
  type StateMutationResult,
} from "@svvy/core";
import { RuntimeEventBus, type RuntimeEventBusService } from "./runtime-event-bus";
import {
  layerRuntimeExtensionSourceCoordinator,
  RuntimeExtensionSourceCoordinator,
  type RuntimeExtensionSourceCoordinatorService,
} from "./runtime-extension-source-coordinator";
import { createRuntimeLayerConfigLayer, defaultRuntimeLayerConfig } from "./runtime-layer-config";
import {
  RuntimeSourceInvalidationService,
  type RuntimeSourceInvalidationServiceService,
} from "./runtime-source-invalidation-service";
import {
  RuntimeSourceReconcileRecoveryWorker,
  makeRuntimeSourceReconcileRecoveryWorker,
} from "./runtime-source-reconcile-recovery-worker";

const claimedBy = "runtime_source_recovery_test" as RuntimeOwnerId;
const sourceInvalidation = {
  scope: "app",
  invalidation: { model: "agents" },
} satisfies StateInvalidationDescriptor;
const saveRecord = {
  scope: { kind: "app-global" },
  sourceKind: "user-extension",
  sourceId: "custom-tools",
  path: "/tmp/svvy/extensions/custom-tools/index.ts" as AbsolutePath,
  previousSourceVersion: "version-1",
  sourceVersion: "version-2",
  fingerprint: "fingerprint-2",
  diagnostics: [],
  savedAt: "1970-01-01T00:00:00.000Z" as RecordRuntimeSourceSaveInput["savedAt"],
} satisfies RecordRuntimeSourceSaveInput;
const workflowAgentSaveRecord = {
  ...saveRecord,
  sourceKind: "workflow-agent",
  sourceId: "reviewerAgent",
  path: "/tmp/svvy/workflows/reviewerAgent.agent.json" as AbsolutePath,
} satisfies RecordRuntimeSourceSaveInput;
const sourceFact = {
  scope: saveRecord.scope,
  scopeKey: "app",
  sourceKind: saveRecord.sourceKind,
  sourceId: saveRecord.sourceId,
  path: saveRecord.path,
  sourceVersion: saveRecord.sourceVersion,
  fingerprint: saveRecord.fingerprint,
  diagnostics: saveRecord.diagnostics,
  sourceCommandId: null,
  createdAt: saveRecord.savedAt,
  updatedAt: saveRecord.savedAt,
  deletedAt: null,
} satisfies RuntimeSourceFactRecord;

describe("runtime source reconcile recovery worker", () => {
  it.effect("replays app source facts, publishes invalidations, reconciles, and completes", () =>
    Effect.gen(function* () {
      const completed = yield* Deferred.make<void>();
      const drained = yield* Deferred.make<void>();
      const actions: string[] = [];
      const claimInputs: ClaimNextRuntimeRecoveryWorkInput[] = [];
      const claimed = recoveryWork({ status: "claimed", claimedBy, leaseVersion: 1, attempts: 1 });
      let claimCalls = 0;
      const recoveryState = recoveryStatePort({
        claim: (input) => {
          claimInputs.push(input);
          claimCalls += 1;
          return claimCalls === 1
            ? Effect.succeed(mutation(claimed))
            : Deferred.succeed(drained, undefined).pipe(Effect.as(mutation(null)));
        },
        complete: () => {
          actions.push("complete");
          return Effect.succeed(mutation({ ...claimed, status: "completed" as const }));
        },
      });
      const sourceState = sourceStatePort({
        save: () => {
          actions.push("record-save");
          return Effect.succeed(mutation(sourceFact, [sourceInvalidation]));
        },
      });
      const sourceService = sourceInvalidationService(() => {
        actions.push("reconcile");
        return Effect.void;
      });
      const eventBus = eventBusService({
        onInvalidations: (descriptors) =>
          Effect.sync(() => {
            if (descriptors.length > 0) actions.push("publish-source-invalidations");
          }),
        onRecoveryStatus: (status) =>
          Effect.sync(() => actions.push(`status:${status}`)).pipe(
            Effect.andThen(
              status === "completed" ? Deferred.succeed(completed, undefined) : Effect.void,
            ),
          ),
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* RuntimeSourceReconcileRecoveryWorker;
          yield* Deferred.await(completed);
          yield* Deferred.await(drained);
        }).pipe(
          Effect.provide(
            workerLayer({
              recoveryState,
              sourceState,
              sourceService,
              eventBus,
              extensionSourceCoordinator: {
                serialized: (effect) =>
                  Effect.sync(() => actions.push("source-lane-enter")).pipe(
                    Effect.andThen(effect),
                    Effect.ensuring(Effect.sync(() => actions.push("source-lane-release"))),
                  ),
              },
            }),
          ),
        ),
      );

      assert.deepStrictEqual(actions, [
        "status:claimed",
        "source-lane-enter",
        "record-save",
        "publish-source-invalidations",
        "reconcile",
        "source-lane-release",
        "complete",
        "status:completed",
      ]);
      assert.strictEqual(claimCalls, 2);
      assert.strictEqual(claimInputs[0]?.claimedBy, claimedBy);
      assert.deepStrictEqual(claimInputs[0]?.scope, { kind: "app" });
      assert.deepStrictEqual(claimInputs[0]?.kinds, ["source_reconcile"]);
      assert.strictEqual(
        claimInputs[0]?.leaseMs as number,
        Math.max(
          defaultRuntimeLayerConfig.recoveryClaimLeaseMs,
          defaultRuntimeLayerConfig.generatedPackageBuildTimeoutMs +
            defaultRuntimeLayerConfig.generatedPackageLinkRepairTimeoutMs +
            defaultRuntimeLayerConfig.recoveryRetryMaxDelayMs,
        ),
      );
    }),
  );

  it.effect(
    "recovers workflow-agent mutations through the latest source scan and package refresh without generic fact replay",
    () =>
      Effect.gen(function* () {
        const completed = yield* Deferred.make<void>();
        const drained = yield* Deferred.make<void>();
        const refreshes: Array<
          Parameters<RuntimeSourceInvalidationServiceService["refreshGeneratedPackages"]>[0]
        > = [];
        let genericReplayCalls = 0;
        const claimed = workflowAgentRecoveryWork({
          status: "claimed",
          claimedBy,
          leaseVersion: 1,
          attempts: 1,
        });
        let claimCalls = 0;
        const recoveryState = recoveryStatePort({
          claim: () => {
            claimCalls += 1;
            return claimCalls === 1
              ? Effect.succeed(mutation(claimed))
              : Deferred.succeed(drained, undefined).pipe(Effect.as(mutation(null)));
          },
          complete: () =>
            Deferred.succeed(completed, undefined).pipe(
              Effect.as(mutation({ ...claimed, status: "completed" as const })),
            ),
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* RuntimeSourceReconcileRecoveryWorker;
            yield* Deferred.await(completed);
            yield* Deferred.await(drained);
          }).pipe(
            Effect.provide(
              workerLayer({
                recoveryState,
                sourceState: sourceStatePort({
                  save: () => {
                    genericReplayCalls += 1;
                    return Effect.die("Workflow-agent recovery must not replay a generic save.");
                  },
                }),
                sourceService: sourceInvalidationService(
                  () => Effect.die("Workflow-agent recovery must not use generic reconcile."),
                  (input) => {
                    refreshes.push(input);
                    return Effect.succeed({
                      scope: "app-global" as const,
                      packages: [
                        {
                          packageName: "@svvyx/workflows" as const,
                          action: "unchanged" as const,
                        },
                      ],
                      workspaceLinks: [],
                      recoveryWorkIds: [],
                    });
                  },
                ),
                eventBus: eventBusService(),
              }),
            ),
          ),
        );

        assert.strictEqual(genericReplayCalls, 0);
        assert.deepStrictEqual(refreshes, [
          {
            scope: "app-global",
            packages: ["@svvyx/workflows"],
            reason: "source-changed",
            recoveryWorkId: claimed.id,
          },
        ]);
      }),
  );

  it.effect(
    "retries workflow-agent recovery when the generated Workflows package refresh fails",
    () =>
      Effect.gen(function* () {
        const failed = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<void>();
        const first = workflowAgentRecoveryWork({
          status: "claimed",
          claimedBy,
          leaseVersion: 1,
          attempts: 1,
          maxAttempts: 3,
        });
        const second = workflowAgentRecoveryWork({
          status: "claimed",
          claimedBy,
          leaseVersion: 2,
          attempts: 2,
          maxAttempts: 3,
        });
        const claims: Array<RuntimeRecoveryWorkRecord | null> = [first, null, second, null];
        const retryTimes: string[] = [];
        let refreshAttempts = 0;
        let completionAttempts = 0;
        const recoveryState = recoveryStatePort({
          claim: () => Effect.succeed(mutation(claims.shift() ?? null)),
          fail: (input) => {
            assert.match(input.error, /could not refresh the generated Workflows package/);
            retryTimes.push(input.retryAvailableAt ?? "missing");
            return Deferred.succeed(failed, undefined).pipe(
              Effect.as(
                mutation({
                  ...first,
                  status: "pending" as const,
                  claimedBy: null,
                  availableAt: input.retryAvailableAt!,
                }),
              ),
            );
          },
          complete: () => {
            completionAttempts += 1;
            return Deferred.succeed(completed, undefined).pipe(
              Effect.as(mutation({ ...second, status: "completed" as const })),
            );
          },
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* RuntimeSourceReconcileRecoveryWorker;
            yield* Deferred.await(failed);
            assert.strictEqual(refreshAttempts, 1);
            assert.strictEqual(completionAttempts, 0);
            yield* TestClock.adjust(499);
            assert.strictEqual(refreshAttempts, 1);
            yield* TestClock.adjust(1);
            yield* Deferred.await(completed);
          }).pipe(
            Effect.provide(
              workerLayer({
                recoveryState,
                sourceState: sourceStatePort({
                  save: () => Effect.die("Workflow-agent recovery must not replay a generic save."),
                }),
                sourceService: sourceInvalidationService(
                  () => Effect.die("Workflow-agent recovery must not use generic reconcile."),
                  () => {
                    refreshAttempts += 1;
                    return Effect.succeed({
                      scope: "app-global" as const,
                      packages: [
                        refreshAttempts === 1
                          ? {
                              packageName: "@svvyx/workflows" as const,
                              action: "failed" as const,
                              diagnostics: ["Transient Workflows build failure."],
                            }
                          : {
                              packageName: "@svvyx/workflows" as const,
                              action: "unchanged" as const,
                            },
                      ],
                      workspaceLinks: [],
                      recoveryWorkIds: [],
                    });
                  },
                ),
                eventBus: eventBusService(),
                config: {
                  recoveryRetryInitialDelayMs: 500 as never,
                  recoveryScanIntervalMs: 60_000 as never,
                },
              }),
            ),
          ),
        );

        assert.deepStrictEqual(retryTimes, ["1970-01-01T00:00:00.500Z"]);
        assert.strictEqual(refreshAttempts, 2);
        assert.strictEqual(completionAttempts, 1);
      }),
  );

  it.effect(
    "uses configured Effect-clock retry delay and resumes only after durable availability",
    () =>
      Effect.gen(function* () {
        const failed = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<void>();
        const first = recoveryWork({ status: "claimed", claimedBy, leaseVersion: 1, attempts: 1 });
        const second = recoveryWork({ status: "claimed", claimedBy, leaseVersion: 2, attempts: 2 });
        const claims: Array<RuntimeRecoveryWorkRecord | null> = [first, null, second, null];
        const retryTimes: string[] = [];
        let recordAttempts = 0;
        const recoveryState = recoveryStatePort({
          claim: () => Effect.succeed(mutation(claims.shift() ?? null)),
          fail: (input) => {
            retryTimes.push(input.retryAvailableAt ?? "missing");
            return Deferred.succeed(failed, undefined).pipe(
              Effect.as(
                mutation({
                  ...first,
                  status: "pending" as const,
                  claimedBy: null,
                  availableAt: input.retryAvailableAt!,
                }),
              ),
            );
          },
          complete: () =>
            Deferred.succeed(completed, undefined).pipe(
              Effect.as(mutation({ ...second, status: "completed" as const })),
            ),
        });
        const sourceState = sourceStatePort({
          save: () => {
            recordAttempts += 1;
            return recordAttempts === 1
              ? Effect.fail(
                  new StateContractError({
                    operation: "test.source-recovery.record-save",
                    reason: "transaction-failed",
                    message: "Retry source recording.",
                  }),
                )
              : Effect.succeed(mutation(sourceFact));
          },
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* RuntimeSourceReconcileRecoveryWorker;
            yield* Deferred.await(failed);
            yield* TestClock.adjust(499);
            assert.strictEqual(recordAttempts, 1);
            yield* TestClock.adjust(1);
            yield* Deferred.await(completed);
          }).pipe(
            Effect.provide(
              workerLayer({
                recoveryState,
                sourceState,
                sourceService: sourceInvalidationService(() => Effect.void),
                eventBus: eventBusService(),
                config: {
                  recoveryRetryInitialDelayMs: 500 as never,
                  recoveryScanIntervalMs: 60_000 as never,
                },
              }),
            ),
          ),
        );

        assert.deepStrictEqual(retryTimes, ["1970-01-01T00:00:00.500Z"]);
        assert.strictEqual(recordAttempts, 2);
      }),
  );

  it.effect(
    "fails mismatched source ownership without touching source state or reconciliation",
    () =>
      Effect.gen(function* () {
        const failed = yield* Deferred.make<void>();
        const statuses: string[] = [];
        const claimed = recoveryWork({
          status: "claimed",
          claimedBy,
          leaseVersion: 1,
          attempts: 1,
          maxAttempts: 1,
          ownerScope: {
            kind: "source",
            sourceKind: "workflow-agent",
            sourceId: "differentAgent",
          },
        });
        let sourceCalls = 0;
        let reconcileCalls = 0;
        const recoveryState = recoveryStatePort({
          claim: (() => {
            let claimedOnce = false;
            return () =>
              Effect.succeed(mutation(claimedOnce ? null : ((claimedOnce = true), claimed)));
          })(),
          fail: () => Effect.succeed(mutation({ ...claimed, status: "failed" as const })),
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* RuntimeSourceReconcileRecoveryWorker;
            yield* Deferred.await(failed);
          }).pipe(
            Effect.provide(
              workerLayer({
                recoveryState,
                sourceState: sourceStatePort({
                  save: () => ((sourceCalls += 1), Effect.die("no")),
                }),
                sourceService: sourceInvalidationService(() => {
                  reconcileCalls += 1;
                  return Effect.die("no");
                }),
                eventBus: eventBusService({
                  onRecoveryStatus: (status) =>
                    Effect.sync(() => {
                      statuses.push(status);
                    }).pipe(
                      Effect.andThen(
                        status === "failed" ? Deferred.succeed(failed, undefined) : Effect.void,
                      ),
                    ),
                }),
              }),
            ),
          ),
        );

        assert.strictEqual(sourceCalls, 0);
        assert.strictEqual(reconcileCalls, 0);
        assert.deepStrictEqual(statuses, ["claimed", "failed"]);
      }),
  );

  it.effect("returns an interrupted claim when the worker scope closes", () =>
    Effect.gen(function* () {
      const reconcileEntered = yield* Deferred.make<void>();
      const keepReconciling = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const claimed = recoveryWork({ status: "claimed", claimedBy, leaseVersion: 7, attempts: 1 });
      let claimCalls = 0;
      const recoveryState = recoveryStatePort({
        claim: () => {
          claimCalls += 1;
          return Effect.succeed(mutation(claimCalls === 1 ? null : claimed));
        },
        fail: (input) => {
          assert.strictEqual(input.claimedBy, claimedBy);
          assert.strictEqual(input.leaseVersion, 7);
          return Deferred.succeed(released, undefined).pipe(
            Effect.as(mutation({ ...claimed, status: "pending" as const })),
          );
        },
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const worker = yield* RuntimeSourceReconcileRecoveryWorker;
          yield* worker.wake();
          yield* Deferred.await(reconcileEntered);
        }).pipe(
          Effect.provide(
            workerLayer({
              recoveryState,
              sourceState: sourceStatePort({
                save: () => Effect.succeed(mutation(sourceFact)),
              }),
              sourceService: sourceInvalidationService(() =>
                Deferred.succeed(reconcileEntered, undefined).pipe(
                  Effect.andThen(Deferred.await(keepReconciling)),
                ),
              ),
              eventBus: eventBusService(),
            }),
          ),
        ),
      );
      yield* Deferred.await(released);
    }),
  );
});

function workerLayer(input: {
  readonly recoveryState: RuntimeRecoveryStatePortService;
  readonly sourceState: RuntimeSourceStatePortService;
  readonly sourceService: RuntimeSourceInvalidationServiceService;
  readonly eventBus: RuntimeEventBusService;
  readonly config?: Partial<typeof defaultRuntimeLayerConfig>;
  readonly extensionSourceCoordinator?: RuntimeExtensionSourceCoordinatorService;
}) {
  return Layer.effect(
    RuntimeSourceReconcileRecoveryWorker,
    makeRuntimeSourceReconcileRecoveryWorker({ claimedBy }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        createRuntimeLayerConfigLayer({ ...defaultRuntimeLayerConfig, ...input.config }),
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size),
            digest: (_algorithm, data) => Effect.succeed(data),
          }),
        ),
        Layer.succeed(RuntimeRecoveryStatePort, input.recoveryState),
        Layer.succeed(RuntimeSourceStatePort, input.sourceState),
        Layer.succeed(RuntimeSourceInvalidationService, input.sourceService),
        input.extensionSourceCoordinator
          ? Layer.succeed(RuntimeExtensionSourceCoordinator, input.extensionSourceCoordinator)
          : layerRuntimeExtensionSourceCoordinator,
        Layer.succeed(RuntimeEventBus, input.eventBus),
      ),
    ),
  );
}

function recoveryWork(overrides: Partial<RuntimeRecoveryWorkRecord>): RuntimeRecoveryWorkRecord {
  return {
    id: "recovery_source_reconcile_worker_test" as RuntimeRecoveryWorkRecord["id"],
    scope: { kind: "app" },
    kind: "source_reconcile",
    status: "pending",
    ownerScope: {
      kind: "source",
      sourceKind: "user-extension",
      sourceId: "custom-tools",
    },
    idempotencyKey: "source_reconcile:user-extension:custom-tools:version-2",
    orderingKey: "source:user-extension:custom-tools",
    orderingSeq: 0,
    priority: 10,
    availableAt: "1970-01-01T00:00:00.000Z",
    attempts: 0,
    maxAttempts: 5,
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
    leaseVersion: 0,
    payloadJson: {
      request: {
        scope: { kind: "app-global" },
        domains: ["extensions"],
        reason: "recovery",
      },
      retry: { operation: "record-save", record: saveRecord },
    },
    lastError: null,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function workflowAgentRecoveryWork(
  overrides: Partial<RuntimeRecoveryWorkRecord>,
): RuntimeRecoveryWorkRecord {
  return recoveryWork({
    ownerScope: {
      kind: "source",
      sourceKind: "workflow-agent",
      sourceId: workflowAgentSaveRecord.sourceId,
    },
    idempotencyKey: "source_reconcile:workflow-agent:reviewerAgent:version-2",
    orderingKey: "source:workflow-agent:reviewerAgent",
    payloadJson: {
      request: {
        scope: { kind: "app-global" },
        domains: ["workflows"],
        reason: "recovery",
      },
      retry: { operation: "record-save", record: workflowAgentSaveRecord },
    },
    ...overrides,
  });
}

function mutation<A>(
  value: A,
  afterCommit: readonly StateInvalidationDescriptor[] = [],
): StateMutationResult<A> {
  return { value, afterCommit };
}

function recoveryStatePort(input: {
  readonly claim: RuntimeRecoveryStatePortService["claimNextRecoveryWork"] extends (
    ...args: infer _Args
  ) => infer _Result
    ? (
        input: Parameters<RuntimeRecoveryStatePortService["claimNextRecoveryWork"]>[0],
      ) => Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord | null>>
    : never;
  readonly complete?: (
    input: Parameters<RuntimeRecoveryStatePortService["completeRecoveryWork"]>[0],
  ) => Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord>>;
  readonly fail?: (
    input: Parameters<RuntimeRecoveryStatePortService["failOrRetryRecoveryWork"]>[0],
  ) => Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord>>;
}): RuntimeRecoveryStatePortService {
  return {
    normalizeWorkspaceRecoveryState: () => Effect.die("unused"),
    listWorkspaceRecoveryStartupSnapshots: () => Effect.die("unused"),
    ensureRecoveryWork: () => Effect.die("unused"),
    claimNextRecoveryWork: input.claim,
    completeRecoveryWork: input.complete ?? (() => Effect.die("Unexpected completion.")),
    failOrRetryRecoveryWork: input.fail ?? (() => Effect.die("Unexpected failure.")),
  };
}

function sourceStatePort(input: {
  readonly save: RuntimeSourceStatePortService["recordSourceSave"];
}): RuntimeSourceStatePortService {
  return {
    readSourceVersion: () => Effect.die("unused"),
    recordSourceSave: input.save,
    recordSourceDelete: () => Effect.die("Unexpected delete replay."),
    recordWorkflowAgentSourceSave: () => Effect.die("Unexpected atomic save replay."),
    recordWorkflowAgentSourceDelete: () => Effect.die("Unexpected atomic delete replay."),
    reconcileWorkflowAgentSources: () => Effect.die("Unexpected direct index reconcile."),
    recordSourceScan: () => Effect.die("unused"),
    reconcileDiscoveredHostSnippets: () => Effect.die("unused"),
    recordObservedSourceDeletion: () => Effect.die("unused"),
    recordSourceDiagnostic: () => Effect.die("unused"),
  };
}

function sourceInvalidationService(
  reconcile: () => Effect.Effect<void>,
  refreshGeneratedPackages: RuntimeSourceInvalidationServiceService["refreshGeneratedPackages"] = () =>
    Effect.die("unused"),
): RuntimeSourceInvalidationServiceService {
  return {
    hint: () => Effect.die("unused"),
    reconcile: () =>
      reconcile().pipe(
        Effect.as({
          changedReadModelCount: 0,
          generatedPackageRefreshes: [],
          recoveryWorkIds: [],
        }),
      ),
    applyCommittedScanEvent: () => Effect.die("unused"),
    refreshGeneratedContext: () => Effect.die("unused"),
    refreshGeneratedPackages,
  };
}

function eventBusService(
  input: {
    readonly onInvalidations?: (
      descriptors: readonly StateInvalidationDescriptor[],
    ) => Effect.Effect<void>;
    readonly onRecoveryStatus?: (
      status: RuntimeRecoveryWorkRecord["status"],
    ) => Effect.Effect<void>;
  } = {},
): RuntimeEventBusService {
  let sequence = 0;
  return {
    publishStateInvalidations: ({ afterCommit }) =>
      (input.onInvalidations?.(afterCommit) ?? Effect.void).pipe(Effect.as([])),
    publishLive: ({ event }) =>
      (event.type === "runtime.recovery"
        ? (input.onRecoveryStatus?.(event.status) ?? Effect.void)
        : Effect.void
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            sequence += 1;
            return {
              ...event,
              eventGenerationId:
                "runtime_source_recovery_test_generation" as RuntimeEventGenerationId,
              sequence: sequence as RuntimeEventSequence,
            } as RuntimeEvent;
          }),
        ),
      ),
    subscribe: () => Effect.die("unused"),
  };
}
