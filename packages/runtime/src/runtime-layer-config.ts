import * as Config from "effect/Config";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import {
  PositiveDurationMsSchema,
  RecoveryWorkId,
  RuntimeApprovalStatePort,
  RuntimeRecoveryStatePort,
  RuntimeTurnStatePort,
  strictBoundaryParseOptions,
  type IsoDateTimeString,
  type RuntimeOwnerId,
  type RuntimeRecoveryStatePortService,
  type RuntimeTurnStatePortService,
} from "@svvy/core";
import {
  RuntimeRequestInputWaitService,
  type RuntimeRequestInputWaitServiceService,
} from "./runtime-request-input-wait-service";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { cancelAllRuntimeApprovalRequests } from "./runtime-approval-cancellation";
import { RuntimeSurfaceScopeService } from "./surface-runtime-scope-service";
import {
  RuntimeWorkflowAgentSourceIndex,
  type RuntimeWorkflowAgentSourceIndexService,
} from "./runtime-workflow-agent-source-index";
import { RuntimeShutdownAdmission } from "./runtime-shutdown-admission";
import { RuntimeLayerCommandControlPort } from "./runtime-command-host-ports";
import {
  RuntimeExtensionStartupReconcileService,
  type RuntimeExtensionStartupReconcileServiceService,
} from "./runtime-extension-startup-reconcile-service";

const PositiveSafeIntegerSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

const NonNegativeSafeIntegerSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

const taggedErrorBoundaryEncodeOptions = {
  errors: "all",
} as const;

const makeStrictBoundaryTaggedErrorEncodeExit = <
  S extends Schema.Codec<Readonly<{ _tag: string }>, unknown, never, never>,
>(
  schema: S,
) => {
  const encode = Schema.encodeExit(schema, taggedErrorBoundaryEncodeOptions);
  const validateEncoded = Schema.decodeUnknownExit(schema, strictBoundaryParseOptions);
  return (error: S["Type"]) => {
    const encoded = encode(error);
    if (Exit.isFailure(encoded)) {
      return encoded;
    }

    const validated = validateEncoded(encoded.value);
    return Exit.isFailure(validated) ? validated : Exit.succeed(encoded.value);
  };
};

const makeStrictBoundaryTaggedErrorEncodeEffect = <
  S extends Schema.Codec<Readonly<{ _tag: string }>, unknown, never, never>,
>(
  schema: S,
) => {
  const encode = Schema.encodeEffect(schema, taggedErrorBoundaryEncodeOptions);
  const validateEncoded = Schema.decodeUnknownEffect(schema, strictBoundaryParseOptions);
  return (error: S["Type"]) =>
    Effect.flatMap(encode(error), (encoded) => Effect.as(validateEncoded(encoded), encoded));
};

const ByteCountSchema = PositiveSafeIntegerSchema;

const defaultRuntimeLayerConfigInput = {
  queueWakeupCapacity: 1024,
  eventReplayCapacity: 100,
  eventSubscriberBufferCapacity: 256,
  sourceHintQueueCapacity: 1024,
  runtimeStartupWorkspaceAdmissionCapacity: 64,
  workspaceRuntimeIdleTtlMs: 600_000,
  surfaceRuntimeIdleTtlMs: 600_000,
  workflowTaskAttemptRuntimeIdleTtlMs: 600_000,
  runtimeStartupReadinessTimeoutMs: 30_000,
  workerRestartInitialDelayMs: 250,
  workerRestartMaxDelayMs: 10_000,
  workerRestartMaxAttempts: 5,
  queueRetryInitialDelayMs: 500,
  queueRetryMaxDelayMs: 10_000,
  queueRetryMaxAttempts: 3,
  queueClaimLeaseMs: 30_000,
  queueClaimLeaseRefreshIntervalMs: 10_000,
  requestInputAnswerDeliveryLeaseMs: 30_000,
  sourceDebounceMs: 250,
  sourceMaxCoalescingLatencyMs: 2_000,
  appSourceReconcileIntervalMs: 60_000,
  workspaceSourceReconcileIntervalMs: 60_000,
  sourceRetryInitialDelayMs: 500,
  sourceRetryMaxDelayMs: 10_000,
  sourceRetryMaxAttempts: 5,
  recoveryRetryInitialDelayMs: 500,
  recoveryRetryMaxDelayMs: 10_000,
  recoveryRetryMaxAttempts: 5,
  recoveryScanIntervalMs: 10_000,
  recoveryClaimLeaseMs: 60_000,
  generatedPackageWorkspaceLinkRepairConcurrency: 2,
  generatedPackageBuildTimeoutMs: 120_000,
  generatedPackageLinkRepairTimeoutMs: 30_000,
  titleJobScanIntervalMs: 5_000,
  titleJobClaimLeaseMs: 30_000,
  requestInputTimeoutScanIntervalMs: 1_000,
  commandStdinQueueCapacity: 64,
  commandOutputBatchMaxChunks: 32,
  commandOutputBatchMaxLatencyMs: 50,
  commandOutputBatchMaxBytes: 65_536,
  commandOutputArtifactThresholdBytes: 1_048_576,
  commandGracefulShutdownMs: 5_000,
  commandForceKillGraceMs: 2_000,
  workflowTaskAgentBridgeRequestTimeoutMs: 300_000,
  workflowTaskAgentBridgeMaxRequestBytes: 1_048_576,
  workflowTaskAgentBridgeMaxResponseBytes: 1_048_576,
  runtimeShutdownDrainTimeoutMs: 5_000,
} as const;

const RuntimeLayerConfigFields = {
  queueWakeupCapacity: PositiveSafeIntegerSchema,
  eventReplayCapacity: PositiveSafeIntegerSchema,
  eventSubscriberBufferCapacity: PositiveSafeIntegerSchema,
  sourceHintQueueCapacity: PositiveSafeIntegerSchema,
  runtimeStartupWorkspaceAdmissionCapacity: PositiveSafeIntegerSchema,
  workspaceRuntimeIdleTtlMs: PositiveDurationMsSchema,
  surfaceRuntimeIdleTtlMs: PositiveDurationMsSchema,
  workflowTaskAttemptRuntimeIdleTtlMs: PositiveDurationMsSchema,
  runtimeStartupReadinessTimeoutMs: PositiveDurationMsSchema,
  workerRestartInitialDelayMs: PositiveDurationMsSchema,
  workerRestartMaxDelayMs: PositiveDurationMsSchema,
  workerRestartMaxAttempts: NonNegativeSafeIntegerSchema,
  queueRetryInitialDelayMs: PositiveDurationMsSchema,
  queueRetryMaxDelayMs: PositiveDurationMsSchema,
  queueRetryMaxAttempts: NonNegativeSafeIntegerSchema,
  queueClaimLeaseMs: PositiveDurationMsSchema,
  queueClaimLeaseRefreshIntervalMs: PositiveDurationMsSchema,
  requestInputAnswerDeliveryLeaseMs: PositiveDurationMsSchema,
  sourceDebounceMs: PositiveDurationMsSchema,
  sourceMaxCoalescingLatencyMs: PositiveDurationMsSchema,
  appSourceReconcileIntervalMs: PositiveDurationMsSchema,
  workspaceSourceReconcileIntervalMs: PositiveDurationMsSchema,
  sourceRetryInitialDelayMs: PositiveDurationMsSchema,
  sourceRetryMaxDelayMs: PositiveDurationMsSchema,
  sourceRetryMaxAttempts: NonNegativeSafeIntegerSchema,
  recoveryRetryInitialDelayMs: PositiveDurationMsSchema,
  recoveryRetryMaxDelayMs: PositiveDurationMsSchema,
  recoveryRetryMaxAttempts: NonNegativeSafeIntegerSchema,
  recoveryScanIntervalMs: PositiveDurationMsSchema,
  recoveryClaimLeaseMs: PositiveDurationMsSchema,
  generatedPackageWorkspaceLinkRepairConcurrency: PositiveSafeIntegerSchema,
  generatedPackageBuildTimeoutMs: PositiveDurationMsSchema,
  generatedPackageLinkRepairTimeoutMs: PositiveDurationMsSchema,
  titleJobScanIntervalMs: PositiveDurationMsSchema,
  titleJobClaimLeaseMs: PositiveDurationMsSchema,
  requestInputTimeoutScanIntervalMs: PositiveDurationMsSchema,
  commandStdinQueueCapacity: PositiveSafeIntegerSchema,
  commandOutputBatchMaxChunks: PositiveSafeIntegerSchema,
  commandOutputBatchMaxLatencyMs: PositiveDurationMsSchema,
  commandOutputBatchMaxBytes: ByteCountSchema,
  commandOutputArtifactThresholdBytes: ByteCountSchema,
  commandGracefulShutdownMs: PositiveDurationMsSchema,
  commandForceKillGraceMs: PositiveDurationMsSchema,
  workflowTaskAgentBridgeRequestTimeoutMs: PositiveDurationMsSchema,
  workflowTaskAgentBridgeMaxRequestBytes: ByteCountSchema,
  workflowTaskAgentBridgeMaxResponseBytes: ByteCountSchema,
  runtimeShutdownDrainTimeoutMs: PositiveDurationMsSchema,
} as const;

type RuntimeLayerConfigKey = keyof typeof RuntimeLayerConfigFields;
type RuntimeLayerConfigShape = {
  readonly [K in RuntimeLayerConfigKey]: number;
};

const RuntimeLayerConfigInvariant = Schema.makeFilter(
  (config: RuntimeLayerConfigShape) => {
    const issue = runtimeLayerConfigIssue(config);
    return issue === null ? true : { path: [], issue };
  },
  { expected: "a valid runtime layer configuration" },
);

export const RuntimeLayerConfigSchema = Schema.Struct(RuntimeLayerConfigFields).pipe(
  Schema.check(RuntimeLayerConfigInvariant),
);
export type RuntimeLayerConfig = typeof RuntimeLayerConfigSchema.Type;
const decodeUnknownRuntimeLayerConfigSync = Schema.decodeUnknownSync(RuntimeLayerConfigSchema);
const decodeUnknownRuntimeLayerConfigEffect = Schema.decodeUnknownEffect(RuntimeLayerConfigSchema);

export const defaultRuntimeLayerConfig = decodeUnknownRuntimeLayerConfigSync(
  defaultRuntimeLayerConfigInput,
);

export const RuntimeLayerConfigInputSchema = Schema.Struct(
  Object.fromEntries(
    Object.entries(RuntimeLayerConfigFields).map(([key, schema]) => [
      key,
      schema.pipe(
        Schema.withDecodingDefaultKey(
          Effect.succeed(defaultRuntimeLayerConfig[key as RuntimeLayerConfigKey]),
        ),
      ),
    ]),
  ) as RuntimeLayerConfigInputFields,
).pipe(Schema.check(RuntimeLayerConfigInvariant));

type RuntimeLayerConfigInputFields = {
  readonly [K in RuntimeLayerConfigKey]: Schema.withDecodingDefaultKey<
    (typeof RuntimeLayerConfigFields)[K]
  >;
};

export class RuntimeLayerConfigService extends Context.Service<
  RuntimeLayerConfigService,
  RuntimeLayerConfig
>()("@svvy/runtime/RuntimeLayerConfigService") {}

export const createRuntimeLayerConfigLayer = (
  config: RuntimeLayerConfig,
): Layer.Layer<RuntimeLayerConfigService> => Layer.succeed(RuntimeLayerConfigService, config);

const configInt = <K extends RuntimeLayerConfigKey>(key: K) =>
  Config.int(`SVVY_RUNTIME_${toEnvKey(key)}`).pipe(
    Config.withDefault(defaultRuntimeLayerConfig[key]),
  );

export const RuntimeLayerConfigFromEnv: Config.Config<RuntimeLayerConfig> = Config.all({
  queueWakeupCapacity: configInt("queueWakeupCapacity"),
  eventReplayCapacity: configInt("eventReplayCapacity"),
  eventSubscriberBufferCapacity: configInt("eventSubscriberBufferCapacity"),
  sourceHintQueueCapacity: configInt("sourceHintQueueCapacity"),
  runtimeStartupWorkspaceAdmissionCapacity: configInt("runtimeStartupWorkspaceAdmissionCapacity"),
  workspaceRuntimeIdleTtlMs: configInt("workspaceRuntimeIdleTtlMs"),
  surfaceRuntimeIdleTtlMs: configInt("surfaceRuntimeIdleTtlMs"),
  workflowTaskAttemptRuntimeIdleTtlMs: configInt("workflowTaskAttemptRuntimeIdleTtlMs"),
  runtimeStartupReadinessTimeoutMs: configInt("runtimeStartupReadinessTimeoutMs"),
  workerRestartInitialDelayMs: configInt("workerRestartInitialDelayMs"),
  workerRestartMaxDelayMs: configInt("workerRestartMaxDelayMs"),
  workerRestartMaxAttempts: configInt("workerRestartMaxAttempts"),
  queueRetryInitialDelayMs: configInt("queueRetryInitialDelayMs"),
  queueRetryMaxDelayMs: configInt("queueRetryMaxDelayMs"),
  queueRetryMaxAttempts: configInt("queueRetryMaxAttempts"),
  queueClaimLeaseMs: configInt("queueClaimLeaseMs"),
  queueClaimLeaseRefreshIntervalMs: configInt("queueClaimLeaseRefreshIntervalMs"),
  requestInputAnswerDeliveryLeaseMs: configInt("requestInputAnswerDeliveryLeaseMs"),
  sourceDebounceMs: configInt("sourceDebounceMs"),
  sourceMaxCoalescingLatencyMs: configInt("sourceMaxCoalescingLatencyMs"),
  appSourceReconcileIntervalMs: configInt("appSourceReconcileIntervalMs"),
  workspaceSourceReconcileIntervalMs: configInt("workspaceSourceReconcileIntervalMs"),
  sourceRetryInitialDelayMs: configInt("sourceRetryInitialDelayMs"),
  sourceRetryMaxDelayMs: configInt("sourceRetryMaxDelayMs"),
  sourceRetryMaxAttempts: configInt("sourceRetryMaxAttempts"),
  recoveryRetryInitialDelayMs: configInt("recoveryRetryInitialDelayMs"),
  recoveryRetryMaxDelayMs: configInt("recoveryRetryMaxDelayMs"),
  recoveryRetryMaxAttempts: configInt("recoveryRetryMaxAttempts"),
  recoveryScanIntervalMs: configInt("recoveryScanIntervalMs"),
  recoveryClaimLeaseMs: configInt("recoveryClaimLeaseMs"),
  generatedPackageWorkspaceLinkRepairConcurrency: configInt(
    "generatedPackageWorkspaceLinkRepairConcurrency",
  ),
  generatedPackageBuildTimeoutMs: configInt("generatedPackageBuildTimeoutMs"),
  generatedPackageLinkRepairTimeoutMs: configInt("generatedPackageLinkRepairTimeoutMs"),
  titleJobScanIntervalMs: configInt("titleJobScanIntervalMs"),
  titleJobClaimLeaseMs: configInt("titleJobClaimLeaseMs"),
  requestInputTimeoutScanIntervalMs: configInt("requestInputTimeoutScanIntervalMs"),
  commandStdinQueueCapacity: configInt("commandStdinQueueCapacity"),
  commandOutputBatchMaxChunks: configInt("commandOutputBatchMaxChunks"),
  commandOutputBatchMaxLatencyMs: configInt("commandOutputBatchMaxLatencyMs"),
  commandOutputBatchMaxBytes: configInt("commandOutputBatchMaxBytes"),
  commandOutputArtifactThresholdBytes: configInt("commandOutputArtifactThresholdBytes"),
  commandGracefulShutdownMs: configInt("commandGracefulShutdownMs"),
  commandForceKillGraceMs: configInt("commandForceKillGraceMs"),
  workflowTaskAgentBridgeRequestTimeoutMs: configInt("workflowTaskAgentBridgeRequestTimeoutMs"),
  workflowTaskAgentBridgeMaxRequestBytes: configInt("workflowTaskAgentBridgeMaxRequestBytes"),
  workflowTaskAgentBridgeMaxResponseBytes: configInt("workflowTaskAgentBridgeMaxResponseBytes"),
  runtimeShutdownDrainTimeoutMs: configInt("runtimeShutdownDrainTimeoutMs"),
}).pipe(Config.mapOrFail(validateRuntimeLayerConfigFromConfig));

export class RuntimeLayerError extends Schema.TaggedErrorClass<RuntimeLayerError>()(
  "RuntimeLayerError",
  {
    operation: Schema.String,
    reason: Schema.Literals(["startup-not-ready", "shutdown-failed"]),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export const RuntimeLayerErrorSchema = RuntimeLayerError;
export const decodeUnknownRuntimeLayerErrorEffect = Schema.decodeUnknownEffect(
  RuntimeLayerErrorSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeLayerErrorExit = Schema.decodeUnknownExit(
  RuntimeLayerErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeRuntimeLayerErrorEffect =
  makeStrictBoundaryTaggedErrorEncodeEffect(RuntimeLayerErrorSchema);
export const encodeRuntimeLayerErrorExit =
  makeStrictBoundaryTaggedErrorEncodeExit(RuntimeLayerErrorSchema);

export const RuntimeStartupPhase = Schema.Literals([
  "layer-acquisition",
  "app-source-reconcile",
  "generated-package-reconcile",
  "recovery-startup-scan",
  "event-bus",
]);
export type RuntimeStartupPhase = typeof RuntimeStartupPhase.Type;

export type RuntimeStartupDegradedPhase = {
  readonly phase: RuntimeStartupPhase;
  readonly diagnosticEventId?: string;
  readonly recoveryWorkId?: RecoveryWorkId;
  readonly disabledApiGroups: readonly string[];
  readonly staleReadModels: readonly string[];
  readonly message: string;
};

export type RuntimeStartupReadinessReceipt = {
  readonly status: "ready" | "degraded-ready";
  readonly readyAt: IsoDateTimeString;
  readonly completedPhases: readonly RuntimeStartupPhase[];
  readonly degradedPhases: readonly RuntimeStartupDegradedPhase[];
};

export class RuntimeStartupError extends Schema.TaggedErrorClass<RuntimeStartupError>()(
  "RuntimeStartupError",
  {
    operation: Schema.String,
    phase: RuntimeStartupPhase,
    reason: Schema.Literals([
      "config-invalid",
      "layer-acquisition-failed",
      "readiness-timeout",
      "required-startup-check-failed",
      "runtime-shutdown",
      "runtime-disposed",
    ]),
    message: Schema.String,
    diagnosticEventId: Schema.optionalKey(Schema.String),
    recoveryWorkId: Schema.optionalKey(RecoveryWorkId),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export const RuntimeStartupErrorSchema = RuntimeStartupError;

export type RuntimePrepareShutdownReason = "app-shutdown" | "runtime-restart" | "startup-failure";

export type RuntimePrepareShutdownRequest = {
  readonly reason: RuntimePrepareShutdownReason;
  readonly drainTimeoutMs?: number;
};

export type RuntimePrepareShutdownInput = {
  readonly reason: RuntimePrepareShutdownReason;
  readonly requestedAt: string;
  readonly drainTimeoutMs: number;
};

export type RuntimePrepareShutdownResult = {
  readonly status: "drained" | "forced";
  readonly interruptedTurns: number;
  readonly interruptedCommands: number;
  readonly releasedQueueClaims: number;
  readonly recoveryRowsScheduled: number;
};

export class RuntimeStartupReadiness extends Context.Service<
  RuntimeStartupReadiness,
  {
    readonly awaitReady: Effect.Effect<RuntimeStartupReadinessReceipt, RuntimeStartupError>;
  }
>()("@svvy/runtime/RuntimeStartupReadiness") {}

export class RuntimeShutdownPreparation extends Context.Service<
  RuntimeShutdownPreparation,
  {
    readonly prepareShutdown: (
      input: RuntimePrepareShutdownInput,
    ) => Effect.Effect<RuntimePrepareShutdownResult, RuntimeLayerError>;
  }
>()("@svvy/runtime/RuntimeShutdownPreparation") {}

export const layerRuntimeStartupReadiness = Layer.effect(
  RuntimeStartupReadiness,
  Effect.gen(function* () {
    const runtimeConfig = yield* RuntimeLayerConfigService;
    const requestInputWaitService = yield* RuntimeRequestInputWaitService;
    const extensionStartupReconcile = yield* RuntimeExtensionStartupReconcileService;
    const workflowAgentSources = yield* RuntimeWorkflowAgentSourceIndex;
    const recoveryState = yield* RuntimeRecoveryStatePort;
    const turnState = yield* RuntimeTurnStatePort;
    const eventBus = yield* RuntimeEventBus;
    return RuntimeStartupReadiness.of({
      awaitReady: makeRuntimeStartupReadinessEffect(
        runtimeConfig,
        requestInputWaitService,
        extensionStartupReconcile,
        workflowAgentSources,
        recoveryState,
        turnState,
        eventBus,
      ).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(runtimeConfig.runtimeStartupReadinessTimeoutMs),
          orElse: () =>
            Effect.fail(
              new RuntimeStartupError({
                operation: "runtime.startup.awaitReadiness",
                phase: "layer-acquisition",
                reason: "readiness-timeout",
                message: `Runtime startup readiness did not complete within ${runtimeConfig.runtimeStartupReadinessTimeoutMs}ms.`,
              }),
            ),
        }),
      ),
    });
  }),
);

export const layerRuntimeShutdownPreparation = Layer.effect(
  RuntimeShutdownPreparation,
  Effect.gen(function* () {
    yield* RuntimeLayerConfigService;
    const approvalState = yield* RuntimeApprovalStatePort;
    const commandControl = yield* RuntimeLayerCommandControlPort;
    const turnState = yield* RuntimeTurnStatePort;
    const eventBus = yield* RuntimeEventBus;
    const approvalWaitService = yield* RuntimeApprovalWaitService;
    const requestInputWaitService = yield* RuntimeRequestInputWaitService;
    const surfaceScopes = yield* RuntimeSurfaceScopeService;
    const shutdownAdmission = yield* RuntimeShutdownAdmission;
    return RuntimeShutdownPreparation.of({
      prepareShutdown: (input) =>
        shutdownAdmission.runShutdown(
          Effect.gen(function* () {
            const reason = `Runtime shutdown: ${input.reason}.`;
            const activeAtStart = (yield* surfaceScopes.snapshot()).filter(
              (entry) => entry.activeTurnId !== null,
            );
            yield* Effect.forEach(
              activeAtStart,
              (entry) =>
                requestInputWaitService.cancelBlockingRequestsForSurface({
                  surfacePiSessionId: entry.surfacePiSessionId,
                  reason,
                }),
              { discard: true },
            );
            yield* cancelAllRuntimeApprovalRequests({ reason }).pipe(
              Effect.provideService(RuntimeApprovalStatePort, approvalState),
              Effect.provideService(RuntimeEventBus, eventBus),
              Effect.provideService(RuntimeApprovalWaitService, approvalWaitService),
            );
            yield* Effect.forEach(
              activeAtStart,
              (entry) =>
                surfaceScopes.interrupt({
                  surfacePiSessionId: entry.surfacePiSessionId,
                  turnId: entry.activeTurnId,
                  reason: "runtime-shutdown",
                }),
              { discard: true },
            );

            let timedOut = false;
            yield* Effect.gen(function* () {
              while (
                (yield* surfaceScopes.snapshot()).some((entry) => entry.activeTurnId !== null)
              ) {
                yield* Effect.sleep(Duration.millis(10));
              }
            }).pipe(
              Effect.timeoutOrElse({
                duration: Duration.millis(input.drainTimeoutMs),
                orElse: () =>
                  Effect.sync(() => {
                    timedOut = true;
                  }),
              }),
            );

            const stillActive = timedOut
              ? (yield* surfaceScopes.snapshot()).filter((entry) => entry.activeTurnId !== null)
              : [];
            let interruptedCommands = 0;
            let releasedQueueClaims = 0;
            for (const entry of stillActive) {
              yield* surfaceScopes.interrupt({
                surfacePiSessionId: entry.surfacePiSessionId,
                turnId: entry.activeTurnId,
                reason: "runtime-shutdown",
                force: true,
              });
              const recovered = yield* turnState.recoverInterruptedTurn({
                turnId: entry.activeTurnId! as never,
                terminalStatus: "cancelled",
                reason,
              });
              interruptedCommands += recovered.value.terminalizedCommandIds.length;
              releasedQueueClaims += recovered.value.settledQueueItemId ? 1 : 0;
              yield* Effect.forEach(
                recovered.value.terminalizedCommandIds,
                (commandId) =>
                  commandControl
                    .cancel({ commandId, reason })
                    .pipe(Effect.catch(() => Effect.void)),
                { discard: true },
              );
              yield* eventBus.publishStateInvalidations({ afterCommit: recovered.afterCommit });
            }

            return {
              status: stillActive.length > 0 ? ("forced" as const) : ("drained" as const),
              interruptedTurns: activeAtStart.length,
              interruptedCommands,
              releasedQueueClaims,
              recoveryRowsScheduled: 0,
            };
          }).pipe(
            Effect.mapError(
              (cause) =>
                new RuntimeLayerError({
                  operation: "runtime.shutdown.prepare",
                  reason: "shutdown-failed",
                  message: "Runtime shutdown preparation failed while settling active work.",
                  cause,
                }),
            ),
          ),
        ),
    });
  }),
);

export function awaitRuntimeStartupReadiness(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeStartupReadiness, unknown>,
): Promise<RuntimeStartupReadinessReceipt> {
  return managedRuntime.runPromiseExit(awaitRuntimeStartupReadinessEffect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    throw runtimeStartupErrorFromCause("runtime.startup.awaitReadiness", exit.cause);
  });
}

export function prepareRuntimeShutdown(
  managedRuntime: ManagedRuntime.ManagedRuntime<
    RuntimeShutdownPreparation | RuntimeLayerConfigService,
    unknown
  >,
  request: RuntimePrepareShutdownRequest,
): Promise<RuntimePrepareShutdownResult> {
  return managedRuntime.runPromise(prepareRuntimeShutdownEffect(request));
}

const awaitRuntimeStartupReadinessEffect = Effect.gen(function* () {
  const readiness = yield* RuntimeStartupReadiness;
  return yield* readiness.awaitReady;
});

function makeRuntimeStartupReadinessEffect(
  _runtimeConfig: RuntimeLayerConfig,
  requestInputWaitService: RuntimeRequestInputWaitServiceService,
  extensionStartupReconcile: RuntimeExtensionStartupReconcileServiceService,
  workflowAgentSources: RuntimeWorkflowAgentSourceIndexService,
  recoveryState: RuntimeRecoveryStatePortService,
  turnState: RuntimeTurnStatePortService,
  eventBus: RuntimeEventBus["Service"],
): Effect.Effect<RuntimeStartupReadinessReceipt, RuntimeStartupError> {
  return Effect.gen(function* () {
    yield* extensionStartupReconcile.reconcile.pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeStartupError({
            operation: "runtime.startup.awaitReadiness",
            phase: "app-source-reconcile",
            reason: "required-startup-check-failed",
            message: `Runtime startup could not scaffold and build required builtin extensions. ${cause.message}`,
            cause,
          }),
      ),
    );
    yield* workflowAgentSources.scaffoldAndReconcile.pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeStartupError({
            operation: "runtime.startup.awaitReadiness",
            phase: "app-source-reconcile",
            reason: "required-startup-check-failed",
            message: "Runtime startup could not scaffold and reconcile workflow-agent sources.",
            cause,
          }),
      ),
    );
    const recoveryFailure = (message: string, cause: unknown) =>
      new RuntimeStartupError({
        operation: "runtime.startup.awaitReadiness",
        phase: "recovery-startup-scan",
        reason: "required-startup-check-failed",
        message,
        cause,
      });
    const snapshots = yield* recoveryState
      .listWorkspaceRecoveryStartupSnapshots()
      .pipe(
        Effect.mapError((cause) =>
          recoveryFailure(
            "Runtime startup could not inspect durable workspace recovery state.",
            cause,
          ),
        ),
      );
    for (const snapshot of snapshots) {
      for (const turn of snapshot.turns) {
        if (turn.status !== "running" && turn.status !== "waiting") {
          continue;
        }
        const recovered = yield* turnState
          .recoverInterruptedTurn({
            turnId: turn.id,
            terminalStatus: "cancelled",
            reason: "Runtime restarted before the active turn committed terminal facts.",
          })
          .pipe(
            Effect.mapError((cause) =>
              recoveryFailure(`Runtime startup could not recover turn ${turn.id}.`, cause),
            ),
          );
        yield* eventBus
          .publishStateInvalidations({ afterCommit: recovered.afterCommit })
          .pipe(
            Effect.mapError((cause) =>
              recoveryFailure(
                `Runtime startup could not publish recovery facts for turn ${turn.id}.`,
                cause,
              ),
            ),
          );
      }
    }
    const normalized = yield* recoveryState
      .normalizeWorkspaceRecoveryState({
        claimedBy: "runtime-startup-recovery" as RuntimeOwnerId,
      })
      .pipe(
        Effect.mapError((cause) =>
          recoveryFailure("Runtime startup could not normalize stale recovery claims.", cause),
        ),
      );
    yield* eventBus
      .publishStateInvalidations({ afterCommit: normalized.afterCommit })
      .pipe(
        Effect.mapError((cause) =>
          recoveryFailure("Runtime startup could not publish normalized recovery state.", cause),
        ),
      );
    yield* requestInputWaitService.restoreOpenBlockingRequests().pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeStartupError({
            operation: "runtime.startup.awaitReadiness",
            phase: "recovery-startup-scan",
            reason: "required-startup-check-failed",
            message: "Runtime startup could not restore open blocking request-input waits.",
            cause,
          }),
      ),
    );
    const now = yield* DateTime.now;
    return {
      status: "ready",
      readyAt: DateTime.formatIso(now),
      completedPhases: [
        "layer-acquisition",
        "app-source-reconcile",
        "recovery-startup-scan",
        "event-bus",
      ],
      degradedPhases: [],
    };
  });
}

function runtimeStartupErrorFromCause(
  operation: string,
  cause: Cause.Cause<unknown>,
): RuntimeStartupError {
  const failure = cause.reasons.find(Cause.isFailReason);
  if (failure?.error instanceof RuntimeStartupError) {
    return failure.error;
  }

  const defect = cause.reasons.find(Cause.isDieReason);
  if (defect) {
    return new RuntimeStartupError({
      operation,
      phase: "layer-acquisition",
      reason: "layer-acquisition-failed",
      message: defectMessage(defect.defect),
      cause: defect.defect,
    });
  }

  if (Cause.hasInterruptsOnly(cause) || cause.reasons.some(Cause.isInterruptReason)) {
    return new RuntimeStartupError({
      operation,
      phase: "layer-acquisition",
      reason: "runtime-shutdown",
      message: "Runtime startup readiness was interrupted.",
    });
  }

  return new RuntimeStartupError({
    operation,
    phase: "layer-acquisition",
    reason: "layer-acquisition-failed",
    message: defectMessage(Cause.squash(cause)),
    cause: Cause.squash(cause),
  });
}

function defectMessage(defect: unknown): string {
  if (defect instanceof Error && defect.message.trim().length > 0) {
    return defect.message;
  }
  if (typeof defect === "string" && defect.trim().length > 0) {
    return defect;
  }
  return "Runtime startup readiness failed.";
}

const prepareRuntimeShutdownEffect = Effect.fn("@svvy/runtime/bootstrap.prepareRuntimeShutdown")(
  function* (request: RuntimePrepareShutdownRequest) {
    const runtimeConfig = yield* RuntimeLayerConfigService;
    const now = yield* DateTime.now;
    const input: RuntimePrepareShutdownInput = {
      reason: request.reason,
      requestedAt: DateTime.formatIso(now),
      drainTimeoutMs: request.drainTimeoutMs ?? runtimeConfig.runtimeShutdownDrainTimeoutMs,
    };

    const shutdown = yield* RuntimeShutdownPreparation;
    return yield* shutdown.prepareShutdown(input);
  },
);

function toEnvKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

function validateRuntimeLayerConfigFromConfig(
  config: RuntimeLayerConfigShape,
): Effect.Effect<RuntimeLayerConfig, Config.ConfigError> {
  return decodeUnknownRuntimeLayerConfigEffect(config).pipe(
    Effect.mapError(
      (error) =>
        new Config.ConfigError(
          new Schema.SchemaError(
            new SchemaIssue.InvalidValue(Option.some(config), { message: error.message }),
          ),
        ),
    ),
  );
}

function runtimeLayerConfigIssue(config: RuntimeLayerConfigShape): string | null {
  if (config.workerRestartInitialDelayMs > config.workerRestartMaxDelayMs) {
    return "workerRestartInitialDelayMs must be less than or equal to workerRestartMaxDelayMs";
  }
  if (config.queueRetryInitialDelayMs > config.queueRetryMaxDelayMs) {
    return "queueRetryInitialDelayMs must be less than or equal to queueRetryMaxDelayMs";
  }
  if (config.sourceDebounceMs > config.sourceMaxCoalescingLatencyMs) {
    return "sourceDebounceMs must be less than or equal to sourceMaxCoalescingLatencyMs";
  }
  if (config.sourceRetryInitialDelayMs > config.sourceRetryMaxDelayMs) {
    return "sourceRetryInitialDelayMs must be less than or equal to sourceRetryMaxDelayMs";
  }
  if (config.recoveryRetryInitialDelayMs > config.recoveryRetryMaxDelayMs) {
    return "recoveryRetryInitialDelayMs must be less than or equal to recoveryRetryMaxDelayMs";
  }
  return null;
}
