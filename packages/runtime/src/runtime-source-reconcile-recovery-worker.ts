import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  RuntimeContractError,
  RuntimeRecoveryStatePort,
  RuntimeSourceStatePort,
  decodeUnknownSourceReconcileRecoveryPayloadEffect,
  type ClaimNextRuntimeRecoveryWorkInput,
  type FailOrRetryRuntimeRecoveryWorkInput,
  type RuntimeOwnerId,
  type RuntimeRecoveryWorkRecord,
  type SourceReconcileRecoveryPayload,
  type StateMutationResult,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeLayerConfigService, type RuntimeLayerConfig } from "./runtime-layer-config";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";

export interface RuntimeSourceReconcileRecoveryWorkerService {
  wake(): Effect.Effect<void>;
}

export class RuntimeSourceReconcileRecoveryWorker extends Context.Service<
  RuntimeSourceReconcileRecoveryWorker,
  RuntimeSourceReconcileRecoveryWorkerService
>()("@svvy/runtime/RuntimeSourceReconcileRecoveryWorker") {}

export interface RuntimeSourceReconcileRecoveryWorkerOptions {
  readonly claimedBy?: RuntimeOwnerId;
}

export const makeRuntimeSourceReconcileRecoveryWorker = Effect.fn(
  "@svvy/runtime/makeRuntimeSourceReconcileRecoveryWorker",
)(function* (options: RuntimeSourceReconcileRecoveryWorkerOptions = {}) {
  const config = yield* RuntimeLayerConfigService;
  const recoveryState = yield* RuntimeRecoveryStatePort;
  const sourceState = yield* RuntimeSourceStatePort;
  const sourceInvalidation = yield* RuntimeSourceInvalidationService;
  const eventBus = yield* RuntimeEventBus;
  let claimedBy = options.claimedBy;
  if (!claimedBy) {
    const crypto = yield* Crypto.Crypto;
    const ownerId = yield* crypto.randomUUIDv4.pipe(Effect.catch((cause) => Effect.die(cause)));
    claimedBy = `runtime-source-reconcile-recovery-${ownerId}` as RuntimeOwnerId;
  }
  const parentScope = yield* Scope.Scope;
  const workerScope = yield* Scope.fork(parentScope, "sequential");
  const wakes = yield* Queue.dropping<void>(1);
  const wake = () => Queue.offer(wakes, undefined).pipe(Effect.asVoid, Effect.ignore);
  let currentClaim: RuntimeRecoveryWorkRecord | null = null;

  yield* Effect.addFinalizer(() =>
    Queue.shutdown(wakes).pipe(Effect.andThen(Scope.close(workerScope, Exit.void))),
  );

  const publishMutation = <A>(mutation: StateMutationResult<A>) =>
    eventBus.publishStateInvalidations({ afterCommit: mutation.afterCommit }).pipe(Effect.asVoid);

  const publishRecoveryStatus = (work: RuntimeRecoveryWorkRecord) =>
    eventBus
      .publishLive({
        event: {
          type: "runtime.recovery",
          scope: "app",
          workId: work.id,
          status: work.status,
        },
      })
      .pipe(Effect.asVoid);

  const scheduleRetryWake = (availableAt: string) =>
    Effect.gen(function* () {
      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      const delayMs = Math.max(0, Date.parse(availableAt) - now);
      yield* Effect.sleep(delayMs);
      yield* wake();
    }).pipe(Effect.forkIn(workerScope), Effect.asVoid);

  const retryAvailableAtFor = (work: RuntimeRecoveryWorkRecord) =>
    Effect.map(
      DateTime.now,
      (now) =>
        DateTime.formatIso(
          DateTime.addDuration(now, recoveryRetryDelayMs(work.attempts, config)),
        ) as NonNullable<FailOrRetryRuntimeRecoveryWorkInput["retryAvailableAt"]>,
    );

  const failClaim = (work: RuntimeRecoveryWorkRecord, error: string, scheduleRetry: boolean) =>
    Effect.gen(function* () {
      const retryAvailableAt = yield* retryAvailableAtFor(work);
      const mutation = yield* recoveryState.failOrRetryRecoveryWork({
        id: work.id,
        error,
        claimedBy,
        leaseVersion: work.leaseVersion,
        retryAvailableAt,
      });
      if (currentClaim?.id === work.id) {
        currentClaim = null;
      }
      if (scheduleRetry && mutation.value.status === "pending") {
        yield* scheduleRetryWake(mutation.value.availableAt);
      }
      yield* publishMutation(mutation);
      yield* publishRecoveryStatus(mutation.value);
    });

  const releaseClaim = (work: RuntimeRecoveryWorkRecord) =>
    Effect.gen(function* () {
      const retryAvailableAt = yield* retryAvailableAtFor(work);
      yield* recoveryState.failOrRetryRecoveryWork({
        id: work.id,
        error: "Runtime source reconcile recovery was interrupted.",
        claimedBy,
        leaseVersion: work.leaseVersion,
        retryAvailableAt,
      });
    });

  const replayClaim = (work: RuntimeRecoveryWorkRecord) =>
    Effect.gen(function* () {
      yield* publishRecoveryStatus(work);
      const payload = yield* decodeUnknownSourceReconcileRecoveryPayloadEffect(work.payloadJson);
      yield* validateClaimedSourceReconcileWork(work, payload);
      if (payload.retry.record.sourceKind === "workflow-agent") {
        const sourceCommandId = payload.retry.record.sourceCommandId;
        const refresh = yield* sourceInvalidation
          .refreshGeneratedPackages({
            scope: "app-global",
            packages: ["@svvyx/workflows"],
            reason: "source-changed",
            recoveryWorkId: work.id,
            ...(sourceCommandId ? { sourceCommandId } : {}),
          })
          .pipe(
            Effect.timeoutOrElse({
              duration: Duration.millis(sourceReconcileTimeoutMs(config)),
              orElse: () =>
                Effect.fail(
                  new RuntimeContractError({
                    operation: "runtime.sourceReconcileRecovery.reconcile",
                    reason: "dependency-not-ready",
                    message:
                      "Workflow-agent source reconcile recovery exceeded its configured processing timeout.",
                  }),
                ),
            }),
          );
        if (
          refresh.packages.some(
            (status) => status.packageName === "@svvyx/workflows" && status.action === "failed",
          )
        ) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.sourceReconcileRecovery.reconcile",
              reason: "dependency-not-ready",
              message:
                "Workflow-agent source reconcile recovery could not refresh the generated Workflows package.",
            }),
          );
        }
        return;
      }
      const sourceMutation =
        payload.retry.operation === "record-save"
          ? yield* sourceState.recordSourceSave(payload.retry.record)
          : yield* sourceState.recordSourceDelete(payload.retry.record);
      yield* publishMutation(sourceMutation);
      yield* sourceInvalidation.reconcile(payload.request).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(sourceReconcileTimeoutMs(config)),
          orElse: () =>
            Effect.fail(
              new RuntimeContractError({
                operation: "runtime.sourceReconcileRecovery.reconcile",
                reason: "dependency-not-ready",
                message: "Source reconcile recovery exceeded its configured processing timeout.",
              }),
            ),
        }),
      );
    });

  const processClaim = (claim: StateMutationResult<RuntimeRecoveryWorkRecord>) => {
    const work = claim.value;
    return Effect.gen(function* () {
      currentClaim = work;
      const replayed = yield* publishMutation(claim).pipe(
        Effect.andThen(replayClaim(work)),
        Effect.as(true),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : failClaim(work, recoveryFailureMessage(cause), true).pipe(Effect.as(false)),
        ),
      );
      if (!replayed) {
        return;
      }
      const completed = yield* recoveryState
        .completeRecoveryWork({
          id: work.id,
          claimedBy,
          leaseVersion: work.leaseVersion,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : failClaim(work, recoveryFailureMessage(cause), true).pipe(Effect.as(null)),
          ),
        );
      if (!completed) {
        return;
      }
      currentClaim = null;
      yield* publishMutation(completed);
      yield* publishRecoveryStatus(completed.value);
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() => {
          if (currentClaim?.id !== work.id) {
            return Effect.void;
          }
          return releaseClaim(work).pipe(
            Effect.ignore,
            Effect.ensuring(Effect.sync(() => (currentClaim = null))),
          );
        }),
      ),
    );
  };

  const drainAvailable = Effect.gen(function* () {
    while (true) {
      const claim = yield* recoveryState.claimNextRecoveryWork({
        claimedBy,
        scope: { kind: "app" },
        kinds: ["source_reconcile"],
        leaseMs: sourceReconcileClaimLeaseMs(config),
      });
      if (!claim.value) {
        yield* publishMutation(claim);
        return;
      }
      yield* processClaim(claim as StateMutationResult<RuntimeRecoveryWorkRecord>);
    }
  });

  const scheduleWorkerRetry = Effect.sleep(config.recoveryRetryInitialDelayMs).pipe(
    Effect.andThen(wake()),
    Effect.forkIn(workerScope),
    Effect.asVoid,
  );
  const worker = Stream.fromQueue(wakes).pipe(
    Stream.runForEach(() =>
      drainAvailable.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : scheduleWorkerRetry,
        ),
      ),
    ),
  );
  const periodicWake = Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(config.recoveryScanIntervalMs);
      yield* wake();
    }
  });

  yield* drainAvailable.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause as Cause.Cause<never>)
        : Effect.die(Cause.squash(cause)),
    ),
  );
  yield* worker.pipe(Effect.forkIn(workerScope), Effect.asVoid);
  yield* periodicWake.pipe(Effect.forkIn(workerScope), Effect.asVoid);

  return RuntimeSourceReconcileRecoveryWorker.of({ wake });
});

export const layerRuntimeSourceReconcileRecoveryWorker = Layer.effect(
  RuntimeSourceReconcileRecoveryWorker,
  makeRuntimeSourceReconcileRecoveryWorker(),
);

function validateClaimedSourceReconcileWork(
  work: RuntimeRecoveryWorkRecord,
  payload: SourceReconcileRecoveryPayload,
): Effect.Effect<void, RuntimeContractError> {
  const record = payload.retry.record;
  if (
    work.scope.kind !== "app" ||
    work.kind !== "source_reconcile" ||
    work.ownerScope.kind !== "source" ||
    work.ownerScope.sourceKind !== record.sourceKind ||
    work.ownerScope.sourceId !== record.sourceId ||
    record.scope.kind !== "app-global" ||
    payload.request.scope.kind !== "app-global"
  ) {
    return Effect.fail(
      new RuntimeContractError({
        operation: "runtime.sourceReconcileRecovery.validate",
        reason: "schema-error",
        message:
          "Claimed source reconcile recovery work does not match its app-global source payload.",
      }),
    );
  }
  return Effect.void;
}

function recoveryRetryDelayMs(attempts: number, config: RuntimeLayerConfig): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(
    config.recoveryRetryInitialDelayMs * 2 ** exponent,
    config.recoveryRetryMaxDelayMs,
  );
}

function sourceReconcileClaimLeaseMs(
  config: RuntimeLayerConfig,
): NonNullable<ClaimNextRuntimeRecoveryWorkInput["leaseMs"]> {
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(
      config.recoveryClaimLeaseMs,
      sourceReconcileTimeoutMs(config) + config.recoveryRetryMaxDelayMs,
    ),
  ) as NonNullable<ClaimNextRuntimeRecoveryWorkInput["leaseMs"]>;
}

function sourceReconcileTimeoutMs(config: RuntimeLayerConfig): number {
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    config.generatedPackageBuildTimeoutMs + config.generatedPackageLinkRepairTimeoutMs,
  );
}

function recoveryFailureMessage(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Runtime source reconcile recovery failed.";
}
