import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ExtensionSnapshotPayloadStorePort,
  ExtensionSnapshotSecretStorePort,
  ExtensionSnapshotSecretValuesPort,
  ExtensionSnapshotSettingsStatePort,
  ExtensionSnapshotStatePort,
  RuntimeExtensionContextImpactStatePort,
  type AdvanceExtensionSnapshotRestoreAttemptCommand,
  type ApplyExtensionSnapshotSourceRestoreInput,
  type ExtensionSnapshotStatePortService,
  type ExtensionSnapshotRestoreAttempt,
  type FinalizeExtensionSnapshotSourceRestoreInput,
  type PrepareExtensionSnapshotSourceRestoreInput,
  type RuntimeLoadExtensionSnapshotResult,
} from "@svvy/core";
import { Extensions, type ExtensionsService } from "@svvy/extensions";

import { layerRuntimeBunPlatform } from "./bun-platform";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeExtensionBuildService } from "./runtime-extension-build-service";
import { RuntimeExtensionSourceCoordinator } from "./runtime-extension-source-coordinator";
import {
  layerRuntimeExtensionSnapshotService,
  RuntimeExtensionSnapshotService,
} from "./runtime-extension-snapshot-service";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";

const payload = {
  schemaVersion: 1 as const,
  capturedAt: "2026-07-12T10:00:00.000Z" as never,
  sources: [],
  packageFiles: [],
  actorSettings: [],
  profileSettings: [],
  nonSecretEnvOverrideScopes: [],
  nonSecretEnvOverrides: [],
  secretTargets: [],
};
const bytes = new TextEncoder().encode(JSON.stringify(payload));
const payloadRef = {
  schemaVersion: 1 as const,
  algorithm: "sha256" as const,
  digest: `sha256:${"a".repeat(64)}` as const,
  byteSize: bytes.byteLength,
  codec: "svvy-extension-snapshot-json-v1" as const,
};

describe("runtime extension snapshot recovery", () => {
  for (const { initialStatus, sourceDrifted } of [
    { initialStatus: "prepared", sourceDrifted: false },
    { initialStatus: "payload-applied", sourceDrifted: false },
    { initialStatus: "state-committed", sourceDrifted: false },
    { initialStatus: "building", sourceDrifted: false },
    { initialStatus: "building", sourceDrifted: true },
  ] as const) {
    it.effect(
      `${sourceDrifted ? "fails" : "resumes"} a ${sourceDrifted ? "drifted " : ""}${initialStatus} attempt`,
      () => {
        const calls: string[] = [];
        const serialization: string[] = [];
        let attempt: ExtensionSnapshotRestoreAttempt = {
          attemptId: `extension-snapshot-restore:${initialStatus}` as never,
          snapshotId: "extension-snapshot:test" as never,
          clientRequestId: `runtime-client:snapshot-${initialStatus}` as never,
          snapshotRevision: 1,
          payloadRef,
          secretPayloadRef: null,
          status: initialStatus,
          startedAt: "2026-07-12T10:00:00.000Z" as never,
          updatedAt: "2026-07-12T10:00:00.000Z" as never,
          finishedAt: null,
          failureReason: null,
          affectedSurfaces:
            initialStatus === "state-committed" || initialStatus === "building"
              ? [
                  {
                    surfacePiSessionId: "surface-durable" as never,
                    kind: "extension_context_changed",
                    label: "Extensions changed",
                    reason: "snapshot_loaded",
                  },
                ]
              : [],
        };
        const state = {
          list: () => Effect.succeed({ revision: 0 as never, snapshots: [] }),
          read: () => Effect.succeed(null),
          save: () => Effect.die("unused"),
          rename: () => Effect.die("unused"),
          delete: () => Effect.die("unused"),
          load: (input) =>
            Effect.succeed({
              value: { receipt: receipt(input.clientRequestId), attempt },
              afterCommit: [],
            }),
          readRestoreAttempt: () => Effect.succeed(attempt),
          listPendingRestoreAttempts: () => Effect.succeed([attempt]),
          advanceRestoreAttempt: (input: AdvanceExtensionSnapshotRestoreAttemptCommand) =>
            Effect.sync(() => {
              calls.push(`advance:${input.expectedStatus}:${input.status}`);
              attempt = {
                ...attempt,
                status: input.status,
                updatedAt: input.updatedAt,
                finishedAt:
                  input.status === "completed" || input.status === "failed"
                    ? input.updatedAt
                    : null,
                failureReason: input.failureReason,
                affectedSurfaces: input.affectedSurfaces,
              };
              return {
                value: { receipt: receipt(input.clientRequestId), attempt },
                afterCommit: [],
              };
            }),
          listPendingCleanup: () => Effect.succeed([]),
          completeCleanup: () => Effect.die("unused"),
        } satisfies ExtensionSnapshotStatePortService;
        const extensions = Extensions.of({
          snapshots: {
            captureSourcePayload: () =>
              Effect.succeed(
                sourceDrifted
                  ? {
                      ...payload,
                      packageFiles: [
                        {
                          relativePath: "package.json",
                          contentBase64: "e30K",
                          contentHash: `sha256:${"c".repeat(64)}` as const,
                          byteSize: 3,
                        },
                      ],
                    }
                  : payload,
              ),
            prepareSourceRestore: (input: PrepareExtensionSnapshotSourceRestoreInput) =>
              Effect.sync(() => {
                calls.push("prepare");
                return {
                  schemaVersion: 1,
                  planId: input.planId,
                  snapshotId: input.snapshotId,
                  payloadDigest: `sha256:${"b".repeat(64)}` as const,
                  sourceCount: 0,
                  fileCount: 0,
                };
              }),
            applySourceRestore: ({ plan }: ApplyExtensionSnapshotSourceRestoreInput) =>
              Effect.sync(() => {
                calls.push("apply");
                return {
                  planId: plan.planId,
                  outcome: "recovered" as const,
                  sourceCount: 0,
                  fileCount: 0,
                  removedUserExtensionIds: [],
                };
              }),
            finalizeSourceRestore: ({ planId }: FinalizeExtensionSnapshotSourceRestoreInput) =>
              Effect.succeed({ planId, outcome: "removed" as const }),
          },
          registry: {
            observe: () =>
              Effect.succeed({
                aggregateFingerprint: "registry",
                observations: [],
                diagnostics: [],
              }),
          },
        } as unknown as ExtensionsService);
        return Effect.gen(function* () {
          const service = yield* RuntimeExtensionSnapshotService;
          let result: RuntimeLoadExtensionSnapshotResult | null = null;
          if (initialStatus === "prepared") {
            result = yield* service.load({
              clientRequestId: attempt.clientRequestId,
              snapshotId: attempt.snapshotId,
              expectedRevision: attempt.snapshotRevision,
              attemptId: attempt.attemptId,
              startedAt: attempt.startedAt,
            });
          } else {
            yield* service.recover();
          }
          assert.strictEqual(attempt.status, sourceDrifted ? "failed" : "completed");
          assert.strictEqual(
            calls.includes("apply"),
            initialStatus === "prepared" || initialStatus === "payload-applied",
          );
          if (result) {
            assert.deepStrictEqual(result.affectedSurfaces, [
              {
                surfacePiSessionId: "surface-snapshot" as never,
                kind: "extension_context_changed",
                label: "Extensions changed",
                reason: "snapshot_loaded",
              },
            ]);
          }
          assert.deepStrictEqual(
            attempt.affectedSurfaces,
            initialStatus === "state-committed" || initialStatus === "building"
              ? [
                  {
                    surfacePiSessionId: "surface-durable" as never,
                    kind: "extension_context_changed",
                    label: "Extensions changed",
                    reason: "snapshot_loaded",
                  },
                ]
              : [
                  {
                    surfacePiSessionId: "surface-snapshot" as never,
                    kind: "extension_context_changed",
                    label: "Extensions changed",
                    reason: "snapshot_loaded",
                  },
                ],
          );
          assert.deepStrictEqual(serialization, ["entered", "released"]);
          if (sourceDrifted) {
            assert.strictEqual(calls.includes("advance:building:failed"), true);
          }
        }).pipe(
          Effect.provide(
            layerRuntimeExtensionSnapshotService.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(RuntimeExtensionSourceCoordinator, {
                    serialized: (effect) =>
                      Effect.sync(() => serialization.push("entered")).pipe(
                        Effect.andThen(effect),
                        Effect.ensuring(Effect.sync(() => serialization.push("released"))),
                      ),
                  }),
                  layerRuntimeBunPlatform,
                  Layer.succeed(ExtensionSnapshotStatePort, state),
                  Layer.succeed(ExtensionSnapshotSettingsStatePort, {
                    readCaptureFacts: () => Effect.die("unused"),
                    applyCapturedSettings: (input) =>
                      Effect.succeed({
                        value: {
                          receipt: receipt(input.clientRequestId),
                          appliedActorCount: 0,
                          appliedProfileCount: 0,
                          skippedProfileIds: [],
                          appliedOverrideCount: 0,
                          deferredSecretTargetCount: 0,
                        },
                        afterCommit: [],
                      }),
                  }),
                  Layer.succeed(ExtensionSnapshotPayloadStorePort, {
                    put: () => Effect.die("unused"),
                    read: ({ ref }) => Effect.succeed({ ref, bytes }),
                    cleanup: () => Effect.die("unused"),
                  }),
                  Layer.succeed(ExtensionSnapshotSecretStorePort, {
                    put: () => Effect.die("unused"),
                    read: () => Effect.die("unused"),
                    cleanup: () => Effect.die("unused"),
                  }),
                  Layer.succeed(ExtensionSnapshotSecretValuesPort, {
                    capture: () => Effect.die("unused"),
                    restore: () => Effect.succeed({ restoredTargetCount: 0 }),
                  }),
                  Layer.succeed(RuntimeExtensionContextImpactStatePort, {
                    listUsageContextAffectedSurfaces: () => Effect.succeed([]),
                    applySnapshotContextImpact: () =>
                      Effect.succeed({
                        value: [
                          {
                            surfacePiSessionId: "surface-snapshot" as never,
                            kind: "extension_context_changed",
                            label: "Extensions changed",
                            reason: "snapshot_loaded",
                          },
                        ],
                        afterCommit: [],
                      }),
                  }),
                  Layer.succeed(Extensions, extensions),
                  Layer.succeed(RuntimeSourceInvalidationService, {
                    hint: () => Effect.die("unused"),
                    reconcile: () =>
                      Effect.succeed({
                        changedReadModelCount: 0,
                        generatedPackageRefreshes: [],
                        recoveryWorkIds: [],
                      }),
                    applyCommittedScanEvent: () => Effect.die("unused"),
                    refreshGeneratedContext: () => Effect.die("unused"),
                    refreshGeneratedPackages: () => Effect.die("unused"),
                  }),
                  Layer.succeed(RuntimeExtensionBuildService, {
                    build: () => Effect.die("unused"),
                    buildOutcome: () => Effect.die("unused"),
                  }),
                  Layer.succeed(RuntimeEventBus, {
                    publishLive: () => Effect.die("unused"),
                    publishStateInvalidations: () => Effect.succeed([]),
                    subscribe: () => Effect.die("unused"),
                  }),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
});

function receipt(clientRequestId: string) {
  return {
    clientRequestId: clientRequestId as never,
    outcome: "applied" as const,
    committedAt: "2026-07-12T10:00:00.000Z" as never,
    stateRevision: 1 as never,
  };
}
