import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import {
  ExtensionSnapshotPayloadCodecs,
  ExtensionSnapshotPayloadStorePort,
  ExtensionSnapshotSecretStorePort,
  ExtensionSnapshotSecretValuesPort,
  ExtensionSnapshotSettingsStatePort,
  ExtensionSnapshotStatePort,
  RuntimeContractError,
  RuntimeExtensionContextImpactStatePort,
  type ExtensionId,
  type ExtensionSnapshotRestoreAttempt,
  type ExtensionSnapshotRestoreFailureReason,
  type ExtensionSnapshotSummary,
  type ExtensionSnapshotSourceRestorePlanId,
  type RuntimeExtensionContextChangedSurface,
  type ExtensionSnapshotsReadModel,
  type RuntimeDeleteExtensionSnapshotInput,
  type RuntimeEnsureInitialExtensionSnapshotResult,
  type RuntimeListExtensionSnapshotsInput,
  type RuntimeLoadExtensionSnapshotInput,
  type RuntimeLoadExtensionSnapshotResult,
  type RuntimeRenameExtensionSnapshotInput,
  type RuntimeSaveExtensionSnapshotInput,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";

import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeExtensionBuildService } from "./runtime-extension-build-service";
import { RuntimeExtensionSourceCoordinator } from "./runtime-extension-source-coordinator";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";

export interface RuntimeExtensionSnapshotServiceService {
  list(
    input: RuntimeListExtensionSnapshotsInput,
  ): Effect.Effect<ExtensionSnapshotsReadModel, RuntimeContractError>;
  save(
    input: RuntimeSaveExtensionSnapshotInput,
  ): Effect.Effect<ExtensionSnapshotSummary, RuntimeContractError>;
  rename(
    input: RuntimeRenameExtensionSnapshotInput,
  ): Effect.Effect<ExtensionSnapshotSummary, RuntimeContractError>;
  delete(input: RuntimeDeleteExtensionSnapshotInput): Effect.Effect<
    {
      readonly snapshotId: RuntimeDeleteExtensionSnapshotInput["snapshotId"];
      readonly deleted: true;
    },
    RuntimeContractError
  >;
  load(
    input: RuntimeLoadExtensionSnapshotInput,
  ): Effect.Effect<RuntimeLoadExtensionSnapshotResult, RuntimeContractError>;
  ensureInitial(): Effect.Effect<RuntimeEnsureInitialExtensionSnapshotResult, RuntimeContractError>;
  recover(): Effect.Effect<void, RuntimeContractError>;
  processCleanup(): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeExtensionSnapshotService extends Context.Service<
  RuntimeExtensionSnapshotService,
  RuntimeExtensionSnapshotServiceService
>()("@svvy/runtime/RuntimeExtensionSnapshotService") {}

export const layerRuntimeExtensionSnapshotService = Layer.effect(
  RuntimeExtensionSnapshotService,
  Effect.gen(function* () {
    const state = yield* ExtensionSnapshotStatePort;
    const settings = yield* ExtensionSnapshotSettingsStatePort;
    const payloadStore = yield* ExtensionSnapshotPayloadStorePort;
    const secretStore = yield* ExtensionSnapshotSecretStorePort;
    const secretValues = yield* ExtensionSnapshotSecretValuesPort;
    const contextImpact = yield* RuntimeExtensionContextImpactStatePort;
    const extensions = yield* Extensions;
    const sourceInvalidation = yield* RuntimeSourceInvalidationService;
    const sourceCoordinator = yield* RuntimeExtensionSourceCoordinator;
    const builds = yield* RuntimeExtensionBuildService;
    const events = yield* RuntimeEventBus;
    const crypto = yield* Crypto.Crypto;
    const lane = yield* Semaphore.make(1);

    const publish = (afterCommit: readonly StateInvalidationDescriptor[]) =>
      events.publishStateInvalidations({ afterCommit }).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => runtimeFailure("publish", cause)),
      );
    const now = () => DateTime.now.pipe(Effect.map((value) => DateTime.formatIso(value) as never));

    const save = (input: RuntimeSaveExtensionSnapshotInput) =>
      lane.withPermit(
        sourceCoordinator.serialized(
          Effect.gen(function* () {
            const captureFacts = yield* settings
              .readCaptureFacts()
              .pipe(Effect.mapError((cause) => runtimeFailure("save.read-settings", cause)));
            const payload = yield* extensions.snapshots
              .captureSourcePayload({ capturedAt: input.capturedAt, ...captureFacts })
              .pipe(Effect.mapError((cause) => runtimeFailure("save.capture-source", cause)));
            const bytes = new TextEncoder().encode(JSON.stringify(payload));
            const digestBytes = yield* crypto
              .digest("SHA-256", bytes)
              .pipe(Effect.mapError((cause) => runtimeFailure("save.hash", cause)));
            const payloadRef = {
              schemaVersion: 1 as const,
              algorithm: "sha256" as const,
              digest:
                `sha256:${Array.from(digestBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}` as const,
              byteSize: bytes.byteLength,
              codec: "svvy-extension-snapshot-json-v1" as const,
            };
            yield* payloadStore
              .put({ ref: payloadRef, bytes })
              .pipe(Effect.mapError((cause) => runtimeFailure("save.store-payload", cause)));
            const capturedSecrets = yield* secretValues.capture(payload.secretTargets).pipe(
              Effect.mapError((cause) => runtimeFailure("save.capture-secrets", cause)),
              Effect.catch((cause) =>
                payloadStore.cleanup({ ref: payloadRef }).pipe(
                  Effect.catch(() => Effect.void),
                  Effect.andThen(Effect.fail(cause)),
                ),
              ),
            );
            const secretPayloadRef = capturedSecrets.bytes
              ? (yield* secretStore
                  .put({ snapshotId: input.snapshotId, bytes: capturedSecrets.bytes })
                  .pipe(Effect.mapError((cause) => runtimeFailure("save.store-secrets", cause))))
                  .ref
              : null;
            const mutation = yield* state
              .save({
                ...input,
                payloadRef,
                secretPayloadRef,
                extensionCount: payload.sources.length,
              })
              .pipe(
                Effect.mapError((cause) => runtimeFailure("save.commit", cause)),
                Effect.catch((cause) =>
                  payloadStore.cleanup({ ref: payloadRef }).pipe(
                    Effect.andThen(
                      secretPayloadRef
                        ? secretStore.cleanup({ ref: secretPayloadRef }).pipe(Effect.asVoid)
                        : Effect.void,
                    ),
                    Effect.catch(() => Effect.void),
                    Effect.andThen(Effect.fail(cause)),
                  ),
                ),
              );
            yield* publish(mutation.afterCommit);
            return mutation.value.snapshot;
          }),
        ),
      );

    const rename = (input: RuntimeRenameExtensionSnapshotInput) =>
      lane.withPermit(
        state.rename(input).pipe(
          Effect.tap((mutation) => publish(mutation.afterCommit)),
          Effect.map((mutation) => mutation.value.snapshot),
          Effect.mapError((cause) => runtimeFailure("rename", cause)),
        ),
      );

    const processCleanup = () =>
      lane.withPermit(
        Effect.gen(function* () {
          const pending = yield* state
            .listPendingCleanup()
            .pipe(Effect.mapError((cause) => runtimeFailure("cleanup.list", cause)));
          yield* Effect.forEach(
            pending,
            (cleanup) =>
              Effect.gen(function* () {
                yield* payloadStore
                  .cleanup({ ref: cleanup.payloadRef })
                  .pipe(Effect.mapError((cause) => runtimeFailure("cleanup.payload", cause)));
                if (cleanup.secretPayloadRef) {
                  yield* secretStore
                    .cleanup({ ref: cleanup.secretPayloadRef })
                    .pipe(Effect.mapError((cause) => runtimeFailure("cleanup.secret", cause)));
                }
                const completedAt = yield* now();
                const mutation = yield* state
                  .completeCleanup({
                    clientRequestId:
                      `runtime-client:snapshot-cleanup-${String(cleanup.cleanupId).replaceAll(":", "-")}` as never,
                    cleanupId: cleanup.cleanupId,
                    completedAt,
                  })
                  .pipe(Effect.mapError((cause) => runtimeFailure("cleanup.commit", cause)));
                yield* publish(mutation.afterCommit);
              }),
            { concurrency: 1, discard: true },
          );
        }),
      );

    const remove = (input: RuntimeDeleteExtensionSnapshotInput) =>
      state.delete(input).pipe(
        Effect.tap((mutation) => publish(mutation.afterCommit)),
        Effect.tap(() => processCleanup()),
        Effect.map((mutation) => ({
          snapshotId: mutation.value.snapshotId,
          deleted: true as const,
        })),
        Effect.mapError((cause) => runtimeFailure("delete", cause)),
      );

    const runAttempt = (attempt: ExtensionSnapshotRestoreAttempt) =>
      Effect.gen(function* () {
        const payloadRead = yield* payloadStore
          .read({ ref: attempt.payloadRef })
          .pipe(Effect.mapError((cause) => runtimeFailure("load.read-payload", cause)));
        const payload = yield* ExtensionSnapshotPayloadCodecs.decodeEffect(
          JSON.parse(new TextDecoder().decode(payloadRead.bytes)),
        ).pipe(Effect.mapError((cause) => runtimeFailure("load.decode-payload", cause)));
        const secretBytes = attempt.secretPayloadRef
          ? (yield* secretStore
              .read({ ref: attempt.secretPayloadRef })
              .pipe(Effect.mapError((cause) => runtimeFailure("load.read-secrets", cause)))).bytes
          : null;
        const planId = planIdFor(attempt);
        let status = attempt.status;
        let removedUserExtensionIds: readonly ExtensionId[] = [];
        let affectedSurfaces: readonly RuntimeExtensionContextChangedSurface[] =
          attempt.affectedSurfaces;
        if (status === "prepared" || status === "payload-applied") {
          const plan = yield* extensions.snapshots
            .prepareSourceRestore({
              planId,
              snapshotId: attempt.snapshotId,
              payload,
            })
            .pipe(Effect.mapError((cause) => runtimeFailure("load.prepare-source", cause)));
          const sourceReceipt = yield* extensions.snapshots
            .applySourceRestore({ plan })
            .pipe(Effect.mapError((cause) => runtimeFailure("load.apply-source", cause)));
          removedUserExtensionIds = sourceReceipt.removedUserExtensionIds;
          if (status === "prepared") {
            const advanced = yield* advance(
              attempt,
              "prepared",
              "payload-applied",
              null,
              affectedSurfaces,
            );
            status = advanced.status;
          }
        }
        if (status === "payload-applied") {
          // Registry/readiness becomes fail-closed before any restored settings can be used.
          yield* sourceInvalidation
            .reconcile({
              scope: { kind: "app-global" },
              domains: ["extensions"],
              reason: "manual",
            })
            .pipe(Effect.mapError((cause) => runtimeFailure("load.reconcile-source", cause)));
          const appliedAt = yield* now();
          const settingsMutation = yield* settings
            .applyCapturedSettings({
              clientRequestId: `${attempt.clientRequestId}:settings` as never,
              payload,
              appliedAt,
            })
            .pipe(Effect.mapError((cause) => runtimeFailure("load.apply-settings", cause)));
          yield* publish(settingsMutation.afterCommit);
          yield* secretValues
            .restore({
              targets: payload.secretTargets,
              bytes: secretBytes,
              clientRequestId: `${attempt.clientRequestId}:secrets` as never,
            })
            .pipe(Effect.mapError((cause) => runtimeFailure("load.restore-secrets", cause)));
          const impact = yield* contextImpact
            .applySnapshotContextImpact({
              affectedExtensionIds: payload.sources.map((source) => source.extensionId),
              affectedUsageProfiles: payload.profileSettings.map((profile) =>
                profile.actor === "handler"
                  ? ("handler:threadHandler" as const)
                  : (`orchestrator:${profile.profileId}` as const),
              ),
              removedUserExtensionIds,
            })
            .pipe(Effect.mapError((cause) => runtimeFailure("load.context-impact", cause)));
          affectedSurfaces = impact.value;
          yield* publish(impact.afterCommit);
          const advanced = yield* advance(
            attempt,
            "payload-applied",
            "state-committed",
            null,
            affectedSurfaces,
          );
          status = advanced.status;
        }
        if (status === "state-committed") {
          const advanced = yield* advance(
            attempt,
            "state-committed",
            "building",
            null,
            affectedSurfaces,
          );
          status = advanced.status;
        }
        const buildResults: Array<{
          extensionId: ExtensionId;
          status: "succeeded" | "failed" | "blocked";
        }> = [];
        if (status === "building") {
          const currentSourcePayload = yield* extensions.snapshots
            .captureSourcePayload({
              capturedAt: payload.capturedAt,
              actorSettings: payload.actorSettings,
              profileSettings: payload.profileSettings,
              nonSecretEnvOverrideScopes: payload.nonSecretEnvOverrideScopes,
              nonSecretEnvOverrides: payload.nonSecretEnvOverrides,
              secretTargets: payload.secretTargets,
            })
            .pipe(Effect.mapError((cause) => runtimeFailure("load.verify-source", cause)));
          if (
            JSON.stringify(currentSourcePayload.sources) !== JSON.stringify(payload.sources) ||
            JSON.stringify(currentSourcePayload.packageFiles) !==
              JSON.stringify(payload.packageFiles)
          ) {
            yield* advance(attempt, "building", "failed", "state-conflict", affectedSurfaces);
            yield* extensions.snapshots
              .finalizeSourceRestore({ planId })
              .pipe(Effect.mapError((cause) => runtimeFailure("load.finalize-source", cause)));
            return {
              snapshotId: attempt.snapshotId,
              attemptId: attempt.attemptId,
              status: "failed" as const,
              builds: buildResults,
              affectedSurfaces,
            };
          }
          const registry = yield* extensions.registry
            .observe()
            .pipe(Effect.mapError((cause) => runtimeFailure("load.observe-builds", cause)));
          for (const observation of registry.observations.filter(
            (entry) => entry.buildRequirement === "required",
          )) {
            const outcome = yield* builds.buildOutcome({
              extensionId: observation.extensionId,
              clientRequestId:
                `${attempt.clientRequestId}:build:${observation.extensionId}` as never,
            });
            buildResults.push({
              extensionId: observation.extensionId,
              status:
                outcome.status === "succeeded"
                  ? "succeeded"
                  : outcome.status === "blocked"
                    ? "blocked"
                    : "failed",
            });
          }
          if (buildResults.some((entry) => entry.status === "blocked")) {
            return {
              snapshotId: attempt.snapshotId,
              attemptId: attempt.attemptId,
              status: "blocked" as const,
              builds: buildResults,
              affectedSurfaces,
            };
          }
          const failed = buildResults.some((entry) => entry.status === "failed");
          yield* advance(
            attempt,
            "building",
            failed ? "failed" : "completed",
            failed ? "build-failed" : null,
            affectedSurfaces,
          );
          yield* extensions.snapshots
            .finalizeSourceRestore({ planId })
            .pipe(Effect.mapError((cause) => runtimeFailure("load.finalize-source", cause)));
          return {
            snapshotId: attempt.snapshotId,
            attemptId: attempt.attemptId,
            status: failed ? ("failed" as const) : ("completed" as const),
            builds: buildResults,
            affectedSurfaces,
          };
        }
        return {
          snapshotId: attempt.snapshotId,
          attemptId: attempt.attemptId,
          status: "completed" as const,
          builds: buildResults,
          affectedSurfaces,
        };
      }).pipe(
        Effect.catch((cause: RuntimeContractError) =>
          failAttempt(attempt, failureReason(cause)).pipe(
            Effect.andThen(
              extensions.snapshots
                .finalizeSourceRestore({ planId: planIdFor(attempt) })
                .pipe(Effect.catch(() => Effect.void)),
            ),
            Effect.andThen(Effect.fail(cause)),
          ),
        ),
      );

    const advance = (
      attempt: ExtensionSnapshotRestoreAttempt,
      expectedStatus: ExtensionSnapshotRestoreAttempt["status"],
      status: ExtensionSnapshotRestoreAttempt["status"],
      reason: ExtensionSnapshotRestoreFailureReason | null,
      affectedSurfaces: readonly RuntimeExtensionContextChangedSurface[],
    ) =>
      Effect.gen(function* () {
        const updatedAt = yield* now();
        const mutation = yield* state
          .advanceRestoreAttempt({
            clientRequestId:
              `${attempt.clientRequestId}:advance:${expectedStatus}:${status}` as never,
            attemptId: attempt.attemptId,
            expectedStatus,
            status,
            updatedAt,
            failureReason: reason,
            affectedSurfaces,
          })
          .pipe(Effect.mapError((cause) => runtimeFailure("load.advance", cause)));
        yield* publish(mutation.afterCommit);
        return mutation.value.attempt;
      });

    const failAttempt = (
      attempt: ExtensionSnapshotRestoreAttempt,
      reason: ExtensionSnapshotRestoreFailureReason,
    ) =>
      state.readRestoreAttempt(attempt.attemptId).pipe(
        Effect.flatMap((current) =>
          !current || current.status === "completed" || current.status === "failed"
            ? Effect.void
            : advance(attempt, current.status, "failed", reason, current.affectedSurfaces).pipe(
                Effect.asVoid,
              ),
        ),
        Effect.catch(() => Effect.void),
      );

    const load = (input: RuntimeLoadExtensionSnapshotInput) =>
      lane.withPermit(
        sourceCoordinator.serialized(
          Effect.gen(function* () {
            const mutation = yield* state
              .load(input)
              .pipe(Effect.mapError((cause) => runtimeFailure("load.start", cause)));
            yield* publish(mutation.afterCommit);
            return yield* runAttempt(mutation.value.attempt);
          }),
        ),
      );

    const recover = () =>
      state.listPendingRestoreAttempts().pipe(
        Effect.mapError((cause) => runtimeFailure("recover.list", cause)),
        Effect.flatMap((attempts) =>
          Effect.forEach(
            attempts,
            (attempt) => lane.withPermit(sourceCoordinator.serialized(runAttempt(attempt))),
            {
              concurrency: 1,
              discard: true,
            },
          ),
        ),
        Effect.andThen(processCleanup()),
      );

    const ensureInitial = () =>
      Effect.gen(function* () {
        const listed = yield* state
          .list()
          .pipe(Effect.mapError((cause) => runtimeFailure("initial.list", cause)));
        const existing = listed.snapshots.find(
          (snapshot) => snapshot.snapshotId === "extension-snapshot:initial",
        );
        if (existing) return { outcome: "existing" as const, snapshot: existing };
        if (listed.snapshots.length > 0) {
          return { outcome: "skipped-nonempty" as const, snapshot: null };
        }
        const capturedAt = yield* now();
        const snapshot = yield* save({
          clientRequestId: "runtime-client:extension-snapshot-initial-v1" as never,
          snapshotId: "extension-snapshot:initial" as never,
          name: "Initial",
          capturedAt,
        });
        return { outcome: "created" as const, snapshot };
      });

    return RuntimeExtensionSnapshotService.of({
      list: () => state.list().pipe(Effect.mapError((cause) => runtimeFailure("list", cause))),
      save,
      rename,
      delete: remove,
      load,
      ensureInitial,
      recover,
      processCleanup,
    });
  }),
);

function planIdFor(attempt: ExtensionSnapshotRestoreAttempt): ExtensionSnapshotSourceRestorePlanId {
  return `extension-snapshot-source-restore:${String(attempt.attemptId).replace(/[^a-z0-9-]/g, "-")}` as ExtensionSnapshotSourceRestorePlanId;
}

function failureReason(cause: RuntimeContractError): ExtensionSnapshotRestoreFailureReason {
  if (cause.operation.includes("payload"))
    return cause.message.includes("not found") ? "payload-missing" : "payload-corrupt";
  if (cause.operation.includes("secret")) return "secret-unavailable";
  if (cause.operation.includes("source")) return "apply-failed";
  if (cause.operation.includes("build")) return "build-failed";
  if (cause.reason === "stale-state" || cause.reason === "state-conflict") return "state-conflict";
  return "unknown";
}

function runtimeFailure(
  operation: string,
  cause: { readonly message?: string },
): RuntimeContractError {
  return cause instanceof RuntimeContractError
    ? cause
    : new RuntimeContractError({
        operation: `runtime.extensions.snapshots.${operation}`,
        reason: "state-conflict",
        message: cause.message ?? "Extension snapshot operation failed.",
        cause,
      });
}
