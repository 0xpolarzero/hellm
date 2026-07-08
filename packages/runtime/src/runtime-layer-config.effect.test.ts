import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeSessionWaitStatePort,
} from "@svvy/core";

import {
  RuntimeLayerConfigFromEnv,
  RuntimeLayerConfigService,
  createRuntimeLayerConfigLayer,
  defaultRuntimeLayerConfig,
  layerRuntimeShutdownPreparation,
  layerRuntimeStartupReadiness,
} from "./bootstrap";
import { RuntimeShutdownPreparation, RuntimeStartupReadiness } from "./runtime-layer-config";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";

describe("@svvy/runtime Effect runtime-layer config", () => {
  it.effect("parses environment overrides through the Effect config service", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromEnv({
        env: {
          SVVY_RUNTIME_QUEUE_WAKEUP_CAPACITY: "128",
          SVVY_RUNTIME_EVENT_REPLAY_CAPACITY: "512",
          SVVY_RUNTIME_EVENT_SUBSCRIBER_BUFFER_CAPACITY: "4096",
          SVVY_RUNTIME_SOURCE_HINT_QUEUE_CAPACITY: "256",
          SVVY_RUNTIME_RUNTIME_STARTUP_WORKSPACE_ADMISSION_CAPACITY: "7",
          SVVY_RUNTIME_QUEUE_CLAIM_LEASE_REFRESH_INTERVAL_MS: "3333",
          SVVY_RUNTIME_SOURCE_MAX_COALESCING_LATENCY_MS: "3000",
          SVVY_RUNTIME_WORKFLOW_TASK_AGENT_BRIDGE_REQUEST_TIMEOUT_MS: "120000",
          SVVY_RUNTIME_WORKFLOW_TASK_AGENT_BRIDGE_MAX_REQUEST_BYTES: "2048",
          SVVY_RUNTIME_WORKFLOW_TASK_AGENT_BRIDGE_MAX_RESPONSE_BYTES: "4096",
        },
      });

      const config = yield* RuntimeLayerConfigFromEnv.parse(provider);

      assert.deepStrictEqual(config, {
        ...defaultRuntimeLayerConfig,
        queueWakeupCapacity: 128,
        eventReplayCapacity: 512,
        eventSubscriberBufferCapacity: 4096,
        sourceHintQueueCapacity: 256,
        runtimeStartupWorkspaceAdmissionCapacity: 7,
        queueClaimLeaseRefreshIntervalMs: 3333,
        sourceMaxCoalescingLatencyMs: 3000,
        workflowTaskAgentBridgeRequestTimeoutMs: 120_000,
        workflowTaskAgentBridgeMaxRequestBytes: 2_048,
        workflowTaskAgentBridgeMaxResponseBytes: 4_096,
      });
    }),
  );

  it.effect("fails environment parsing through ConfigError for invalid cross-field values", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromEnv({
        env: {
          SVVY_RUNTIME_WORKER_RESTART_INITIAL_DELAY_MS: "8",
          SVVY_RUNTIME_WORKER_RESTART_MAX_DELAY_MS: "7",
        },
      });

      const exit = yield* RuntimeLayerConfigFromEnv.parse(provider).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.match(
          Cause.pretty(exit.cause),
          /workerRestartInitialDelayMs must be less than or equal to workerRestartMaxDelayMs/,
        );
      }
    }),
  );

  it.effect("fails environment parsing through ConfigError for non-positive durations", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromEnv({
        env: {
          SVVY_RUNTIME_QUEUE_CLAIM_LEASE_MS: "0",
        },
      });

      const exit = yield* RuntimeLayerConfigFromEnv.parse(provider).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.match(Cause.pretty(exit.cause), /queueClaimLeaseMs|greater than 0/);
      }
    }),
  );

  it.effect("fails environment parsing when source debounce exceeds max coalescing latency", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromEnv({
        env: {
          SVVY_RUNTIME_SOURCE_DEBOUNCE_MS: "2501",
          SVVY_RUNTIME_SOURCE_MAX_COALESCING_LATENCY_MS: "2500",
        },
      });

      const exit = yield* RuntimeLayerConfigFromEnv.parse(provider).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.match(
          Cause.pretty(exit.cause),
          /sourceDebounceMs must be less than or equal to sourceMaxCoalescingLatencyMs/,
        );
      }
    }),
  );

  it.effect("provides runtime layer config through an Effect service layer", () =>
    Effect.gen(function* () {
      const config = yield* RuntimeLayerConfigService;

      assert.strictEqual(config, defaultRuntimeLayerConfig);
    }).pipe(Effect.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig))),
  );

  it.effect("provides startup readiness through the promoted Effect service layer", () =>
    Effect.gen(function* () {
      const readiness = yield* RuntimeStartupReadiness;
      const receipt = yield* readiness.awaitReady;

      assert.strictEqual(receipt.status, "ready");
      assert.deepStrictEqual(receipt.completedPhases, [
        "layer-acquisition",
        "recovery-startup-scan",
        "event-bus",
      ]);
      assert.deepStrictEqual(receipt.degradedPhases, []);
      assert.match(receipt.readyAt, /^\d{4}-\d{2}-\d{2}T/);
    }).pipe(
      Effect.provide(
        layerRuntimeStartupReadiness.pipe(
          Layer.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig)),
          Layer.provide(Layer.succeed(RuntimeRequestInputWaitService, noRequestInputWaitService())),
        ),
      ),
    ),
  );

  it.effect("provides shutdown preparation through the promoted Effect service layer", () =>
    Effect.gen(function* () {
      const shutdown = yield* RuntimeShutdownPreparation;
      const result = yield* shutdown.prepareShutdown({
        reason: "app-shutdown",
        requestedAt: "2026-06-29T00:00:00.000Z",
        drainTimeoutMs: 123,
      });

      assert.deepStrictEqual(result, {
        status: "drained",
        interruptedTurns: 0,
        interruptedCommands: 0,
        releasedQueueClaims: 0,
        recoveryRowsScheduled: 0,
      });
    }).pipe(
      Effect.provide(
        layerRuntimeShutdownPreparation.pipe(
          Layer.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig)),
          Layer.provide(Layer.succeed(RuntimeApprovalStatePort, emptyApprovalStatePort())),
          Layer.provide(
            Layer.succeed(RuntimeCommandStatePort, unusedPort("RuntimeCommandStatePort")),
          ),
          Layer.provide(
            Layer.succeed(RuntimeSessionWaitStatePort, unusedPort("RuntimeSessionWaitStatePort")),
          ),
          Layer.provide(Layer.succeed(RuntimeEventBus, noRuntimeEventBus())),
          Layer.provide(Layer.succeed(RuntimeApprovalWaitService, noApprovalWaitService())),
        ),
      ),
    ),
  );
});

function noRequestInputWaitService(): RuntimeRequestInputWaitService["Service"] {
  return RuntimeRequestInputWaitService.of({
    waitForBlockingRequest: () => Effect.die("Unexpected request-input blocking wait."),
    afterAnswerCommitted: () => Effect.die("Unexpected request-input answer post-commit."),
    afterTimerPausedCommitted: () => Effect.die("Unexpected request-input timer post-commit."),
    restoreOpenBlockingRequests: () => Effect.void,
    cancelBlockingRequestsForSurface: () => Effect.void,
  });
}

function emptyApprovalStatePort() {
  return {
    listOpenApprovalRequests: () => Effect.succeed([]),
  } as never;
}

function noRuntimeEventBus(): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected runtime live event."),
    publishStateInvalidations: () => Effect.succeed([]),
    subscribe: () => Effect.die("Unexpected runtime event subscription."),
  });
}

function noApprovalWaitService(): RuntimeApprovalWaitService["Service"] {
  return RuntimeApprovalWaitService.of({
    waitForApproval: () => Effect.die("Unexpected approval wait."),
    afterApprovalCommitted: () => Effect.die("Unexpected approval commit wake."),
    cancelApprovalWait: () => Effect.die("Unexpected approval cancellation wake."),
    cancelAllApprovalWaits: () => Effect.void,
  });
}

function unusedPort(label: string): never {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`${label} is unused by this test.`);
      },
    },
  ) as never;
}
