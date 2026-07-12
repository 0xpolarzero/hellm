import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import {
  RuntimeContractError,
  RuntimeExtensionStatePort,
  type BuildRuntimeExtensionInput,
  type BuildRuntimeExtensionResult,
  type BuildExtensionInput,
  type ExtensionBuildAttemptId,
  type ExtensionBuildFailureReason,
  type ExtensionError,
  type ReconcileExtensionSourceBuildEvidenceInput,
  type RecordExtensionBuildFailureInput,
  type RecordExtensionBuildSuccessInput,
  type StartExtensionBuildAttemptInput,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";

import { RuntimeEventBus } from "./runtime-event-bus";

export type RuntimeExtensionBuildOutcome =
  | { readonly status: "succeeded"; readonly result: BuildRuntimeExtensionResult }
  | {
      readonly status: "failed";
      readonly attemptId: ExtensionBuildAttemptId;
      readonly failureReason: ExtensionBuildFailureReason;
    }
  | { readonly status: "not-started"; readonly failureReason: ExtensionBuildFailureReason }
  | {
      readonly status: "blocked";
      readonly reason: "dependency-not-ready";
      readonly failureReason: "unknown";
    };

export interface RuntimeExtensionBuildServiceService {
  build(
    input: BuildRuntimeExtensionInput,
  ): Effect.Effect<BuildRuntimeExtensionResult, RuntimeContractError>;
  buildOutcome(input: BuildRuntimeExtensionInput): Effect.Effect<RuntimeExtensionBuildOutcome>;
}

class BuildAttemptFailureEvidence {
  constructor(
    readonly attemptId: ExtensionBuildAttemptId,
    readonly failureReason: ExtensionBuildFailureReason,
    readonly original: RuntimeContractError,
  ) {}
}

export class RuntimeExtensionBuildService extends Context.Service<
  RuntimeExtensionBuildService,
  RuntimeExtensionBuildServiceService
>()("@svvy/runtime/RuntimeExtensionBuildService") {}

export const layerRuntimeExtensionBuildService = Layer.effect(
  RuntimeExtensionBuildService,
  Effect.gen(function* () {
    const extensions = yield* Extensions;
    const state = yield* RuntimeExtensionStatePort;
    const events = yield* RuntimeEventBus;
    const crypto = yield* Crypto.Crypto;
    const laneRegistry = yield* Semaphore.make(1);
    const lanes = new Map<string, Semaphore.Semaphore>();

    const publish = (
      afterCommit: Parameters<typeof events.publishStateInvalidations>[0]["afterCommit"],
    ) =>
      events.publishStateInvalidations({ afterCommit }).pipe(
        Effect.asVoid,
        Effect.mapError(
          (cause) =>
            new RuntimeContractError({
              operation: "runtime.extensions.build.publish",
              reason: "stream-failed",
              message: cause.message,
              cause,
            }),
        ),
      );

    const build = Effect.fn("@svvy/runtime/RuntimeExtensionBuildService.build")(function* (
      input: BuildRuntimeExtensionInput,
    ) {
      const lane = yield* laneRegistry.withPermit(
        Effect.gen(function* () {
          const existing = lanes.get(input.extensionId);
          if (existing) return existing;
          const created = yield* Semaphore.make(1);
          lanes.set(input.extensionId, created);
          return created;
        }),
      );

      return yield* lane.withPermit(
        Effect.gen(function* () {
          const replay = yield* state
            .readBuildAttemptByClientRequestId(input.clientRequestId)
            .pipe(Effect.mapError((cause) => stateFailure("read-request-attempt", cause)));
          if (replay && replay.extensionId !== input.extensionId) {
            return yield* Effect.fail(
              new RuntimeContractError({
                operation: "runtime.extensions.build.replay",
                reason: "state-conflict",
                message: "Extension build client request id was reused for another extension.",
              }),
            );
          }
          if (replay?.status === "failed") {
            const failure = new RuntimeContractError({
              operation: "runtime.extensions.build.replay",
              reason: runtimeReasonForStoredFailure(replay.failureReason!),
              message: `Extension build request previously failed: ${replay.failureReason}.`,
            });
            return yield* Effect.fail(
              new RuntimeContractError({
                operation: failure.operation,
                reason: failure.reason,
                message: failure.message,
                cause: new BuildAttemptFailureEvidence(
                  replay.attemptId,
                  replay.failureReason!,
                  failure,
                ),
              }),
            );
          }
          const registryObservation = yield* extensions.registry
            .observe()
            .pipe(Effect.mapError((cause) => extensionFailure("observe-registry", cause)));
          const observedAt = DateTime.formatIso(yield* DateTime.now);
          const registryMutation = yield* state
            .reconcileRegistryObservation({ observation: registryObservation, observedAt })
            .pipe(Effect.mapError((cause) => stateFailure("commit-registry", cause)));
          yield* publish(registryMutation.afterCommit);

          const sourceBuildObservation = yield* extensions.builds
            .observeCurrent({ registryObservation })
            .pipe(Effect.mapError((cause) => extensionFailure("observe-current", cause)));
          const buildObservedAt = DateTime.formatIso(
            yield* DateTime.now,
          ) as ReconcileExtensionSourceBuildEvidenceInput["observedAt"];
          const evidenceMutation = yield* state
            .reconcileBuildEvidence({ ...sourceBuildObservation, observedAt: buildObservedAt })
            .pipe(Effect.mapError((cause) => stateFailure("commit-current", cause)));
          yield* publish(evidenceMutation.afterCommit);

          const sourceObservation = sourceBuildObservation.observations.find(
            (observation) => observation.extensionId === input.extensionId,
          );
          if (!sourceObservation || sourceObservation.sourceFingerprint === null) {
            return yield* Effect.fail(
              new RuntimeContractError({
                operation: "runtime.extensions.build",
                reason: sourceObservation ? "target-not-ready" : "target-not-found",
                message: sourceObservation
                  ? `Extension source is not materialized: ${input.extensionId}`
                  : `Extension does not exist: ${input.extensionId}`,
              }),
            );
          }
          const sourceFingerprint = sourceObservation.sourceFingerprint;

          if (replay) {
            if (
              replay.registryAggregateFingerprint !== registryObservation.aggregateFingerprint ||
              replay.sourceFingerprint !== sourceFingerprint
            ) {
              return yield* Effect.fail(
                new RuntimeContractError({
                  operation: "runtime.extensions.build.replay",
                  reason: "state-conflict",
                  message:
                    "Extension build request no longer matches its recorded source identity.",
                }),
              );
            }
            if (replay.status === "succeeded") {
              if (
                sourceObservation.currentBuildStatus !== "current" ||
                sourceObservation.currentBuild === null ||
                sourceObservation.currentBuild.buildId !== replay.successfulBuildId
              ) {
                return yield* Effect.fail(
                  new RuntimeContractError({
                    operation: "runtime.extensions.build.replay",
                    reason: "stale-state",
                    message: "Recorded build success is not the matching current manifest.",
                  }),
                );
              }
              return {
                attemptId: replay.attemptId,
                registryAggregateFingerprint: replay.registryAggregateFingerprint,
                manifest: sourceObservation.currentBuild,
              } satisfies BuildRuntimeExtensionResult;
            }
          }

          const attemptBytes = replay
            ? null
            : yield* crypto.randomBytes(32).pipe(
                Effect.mapError(
                  (cause) =>
                    new RuntimeContractError({
                      operation: "runtime.extensions.build.allocate-attempt",
                      reason: "state-conflict",
                      message: "Failed to allocate an extension build attempt id.",
                      cause,
                    }),
                ),
              );
          const attemptId =
            replay?.attemptId ??
            (`extension-build-attempt:${input.extensionId}:${Array.from(attemptBytes!, (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("")}` as ExtensionBuildAttemptId);
          const startedAt =
            replay?.startedAt ??
            (DateTime.formatIso(
              yield* DateTime.now,
            ) as StartExtensionBuildAttemptInput["startedAt"]);
          const attemptMutation = yield* state
            .startBuildAttempt({
              attemptId,
              clientRequestId: input.clientRequestId,
              extensionId: input.extensionId,
              registryAggregateFingerprint: registryObservation.aggregateFingerprint,
              sourceFingerprint,
              startedAt,
            })
            .pipe(Effect.mapError((cause) => stateFailure("start-attempt", cause)));

          let terminalCommitted = false;
          let terminalFailureReason: ExtensionBuildFailureReason | null = null;
          const recordFailure = (failureReason: ExtensionBuildFailureReason) =>
            Effect.gen(function* () {
              terminalFailureReason = failureReason;
              const finishedAt = DateTime.formatIso(
                yield* DateTime.now,
              ) as RecordExtensionBuildFailureInput["finishedAt"];
              const failureMutation = yield* state
                .recordBuildFailure({
                  attemptId,
                  clientRequestId: input.clientRequestId,
                  extensionId: input.extensionId,
                  registryAggregateFingerprint: registryObservation.aggregateFingerprint,
                  sourceFingerprint,
                  failureReason,
                  finishedAt,
                })
                .pipe(Effect.mapError((cause) => stateFailure("record-failure", cause)));
              terminalCommitted = true;
              yield* publish(failureMutation.afterCommit);
            });

          return yield* Effect.gen(function* () {
            yield* publish(attemptMutation.afterCommit);
            const builtAt = DateTime.formatIso(
              yield* DateTime.now,
            ) as BuildExtensionInput["builtAt"];
            const result = yield* extensions.builds.build({
              extensionId: input.extensionId,
              registryObservation,
              sourceObservation,
              builtAt,
            });

            const finishedAt = DateTime.formatIso(
              yield* DateTime.now,
            ) as RecordExtensionBuildSuccessInput["finishedAt"];
            const successMutation = yield* state
              .recordBuildSuccess({
                attemptId,
                clientRequestId: input.clientRequestId,
                extensionId: input.extensionId,
                registryAggregateFingerprint: registryObservation.aggregateFingerprint,
                sourceFingerprint,
                manifest: result.manifest,
                finishedAt,
              })
              .pipe(Effect.mapError((cause) => stateFailure("record-success", cause)));
            terminalCommitted = true;
            yield* publish(successMutation.afterCommit);
            return { attemptId, ...result } satisfies BuildRuntimeExtensionResult;
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit) && !terminalCommitted
                ? recordFailure(classifyFailure(exit.cause))
                : Effect.void,
            ),
            Effect.mapError((cause) => {
              const mapped =
                cause._tag === "RuntimeContractError" ? cause : extensionFailure("execute", cause);
              return terminalFailureReason
                ? new RuntimeContractError({
                    operation: mapped.operation,
                    reason: mapped.reason,
                    message: mapped.message,
                    cause: new BuildAttemptFailureEvidence(
                      attemptId,
                      terminalFailureReason,
                      mapped,
                    ),
                  })
                : mapped;
            }),
          );
        }),
      );
    });

    const buildOutcome: RuntimeExtensionBuildServiceService["buildOutcome"] = (input) =>
      build(input).pipe(
        Effect.map(
          (result): RuntimeExtensionBuildOutcome => ({ status: "succeeded" as const, result }),
        ),
        Effect.catch((cause): Effect.Effect<RuntimeExtensionBuildOutcome> => {
          if (cause.reason === "dependency-not-ready") {
            const outcome: RuntimeExtensionBuildOutcome = {
              status: "blocked" as const,
              reason: cause.reason,
              failureReason: "unknown" as const,
            };
            return Effect.succeed(outcome);
          }
          const evidence = cause.cause instanceof BuildAttemptFailureEvidence ? cause.cause : null;
          const outcome: RuntimeExtensionBuildOutcome = evidence
            ? {
                status: "failed" as const,
                attemptId: evidence.attemptId,
                failureReason: evidence.failureReason,
              }
            : {
                status: "not-started" as const,
                failureReason: classifyRuntimeFailureBeforeAttempt(cause),
              };
          return Effect.succeed(outcome);
        }),
      );

    return RuntimeExtensionBuildService.of({ build, buildOutcome });
  }),
);

function classifyRuntimeFailureBeforeAttempt(
  cause: RuntimeContractError,
): ExtensionBuildFailureReason {
  if (cause.reason === "stale-state" || cause.reason === "state-conflict") return "stale-state";
  if (cause.reason === "invalid-input" || cause.reason === "schema-error") return "validation";
  return "unknown";
}

function runtimeReasonForStoredFailure(
  reason: ExtensionBuildFailureReason,
): RuntimeContractError["reason"] {
  if (reason === "validation") return "invalid-input";
  if (reason === "stale-state") return "stale-state";
  return "state-conflict";
}

function classifyFailure(
  cause: Cause.Cause<ExtensionError | RuntimeContractError>,
): ExtensionBuildFailureReason {
  if (Cause.hasInterruptsOnly(cause)) return "cancelled";
  const failure = Cause.findErrorOption(cause);
  if (Option.isNone(failure)) return "unknown";
  if (failure.value._tag === "RuntimeContractError") {
    return failure.value.reason === "stale-state" || failure.value.reason === "state-conflict"
      ? "stale-state"
      : "unknown";
  }
  if (failure.value.reason === "invalid-input") return "validation";
  if (failure.value.reason === "timed-out") return "timed-out";
  if (failure.value.reason === "process-failed") return "process-failed";
  if (failure.value.reason === "output-invalid") return "output-invalid";
  if (failure.value.reason === "execution-failed") return "process-failed";
  return "unknown";
}

function extensionFailure(operation: string, cause: ExtensionError): RuntimeContractError {
  return new RuntimeContractError({
    operation: `runtime.extensions.build.${operation}`,
    reason:
      cause.reason === "not-found"
        ? "target-not-found"
        : cause.reason === "dependency-not-ready"
          ? "dependency-not-ready"
          : cause.reason === "invalid-input"
            ? "invalid-input"
            : "state-conflict",
    message: cause.message,
    cause,
  });
}

function stateFailure(
  operation: string,
  cause: { readonly message: string },
): RuntimeContractError {
  return new RuntimeContractError({
    operation: `runtime.extensions.build.${operation}`,
    reason: "state-conflict",
    message: cause.message,
    cause,
  });
}
