import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

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

const PositiveDurationMsSchema = PositiveSafeIntegerSchema;

const ByteCountSchema = PositiveSafeIntegerSchema;

export const defaultRuntimeLayerConfig = {
  queueWakeupCapacity: 1024,
  eventReplayCapacity: 100,
  eventSubscriberBufferCapacity: 256,
  sourceHintQueueCapacity: 1024,
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
  requestInputAnswerDeliveryLeaseMs: 30_000,
  sourceDebounceMs: 250,
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
  generatedPackageBuildConcurrency: 1,
  generatedPackageWorkspaceLinkRepairConcurrency: 2,
  generatedPackageGlobalLinkRepairConcurrency: 1,
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
  runtimeShutdownDrainTimeoutMs: 5_000,
} as const;

const RuntimeLayerConfigFields = {
  queueWakeupCapacity: PositiveSafeIntegerSchema,
  eventReplayCapacity: PositiveSafeIntegerSchema,
  eventSubscriberBufferCapacity: PositiveSafeIntegerSchema,
  sourceHintQueueCapacity: PositiveSafeIntegerSchema,
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
  requestInputAnswerDeliveryLeaseMs: PositiveDurationMsSchema,
  sourceDebounceMs: PositiveDurationMsSchema,
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
  generatedPackageBuildConcurrency: PositiveSafeIntegerSchema,
  generatedPackageWorkspaceLinkRepairConcurrency: PositiveSafeIntegerSchema,
  generatedPackageGlobalLinkRepairConcurrency: PositiveSafeIntegerSchema,
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
  requestInputAnswerDeliveryLeaseMs: configInt("requestInputAnswerDeliveryLeaseMs"),
  sourceDebounceMs: configInt("sourceDebounceMs"),
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
  generatedPackageBuildConcurrency: configInt("generatedPackageBuildConcurrency"),
  generatedPackageWorkspaceLinkRepairConcurrency: configInt(
    "generatedPackageWorkspaceLinkRepairConcurrency",
  ),
  generatedPackageGlobalLinkRepairConcurrency: configInt(
    "generatedPackageGlobalLinkRepairConcurrency",
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
    readonly awaitReady: Effect.Effect<void, RuntimeLayerError>;
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

export function awaitRuntimeStartupReadiness(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeStartupReadiness, unknown>,
): Promise<void> {
  return managedRuntime.runPromise(awaitRuntimeStartupReadinessEffect);
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
  yield* readiness.awaitReady;
});

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
  config: RuntimeLayerConfig,
): Effect.Effect<RuntimeLayerConfig, Config.ConfigError> {
  const issue = runtimeLayerConfigIssue(config);
  return issue === null
    ? Effect.succeed(config)
    : Effect.fail(
        new Config.ConfigError(
          new Schema.SchemaError(
            new SchemaIssue.InvalidValue(Option.some(config), {
              message: issue,
            }),
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
  if (config.sourceRetryInitialDelayMs > config.sourceRetryMaxDelayMs) {
    return "sourceRetryInitialDelayMs must be less than or equal to sourceRetryMaxDelayMs";
  }
  if (config.recoveryRetryInitialDelayMs > config.recoveryRetryMaxDelayMs) {
    return "recoveryRetryInitialDelayMs must be less than or equal to recoveryRetryMaxDelayMs";
  }
  return null;
}
