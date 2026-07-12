import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeRecoveryStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeTurnStatePort,
  type RecoverInterruptedRuntimeTurnInput,
} from "@svvy/core";

import {
  RuntimeLayerConfigFromEnv,
  RuntimeLayerConfigService,
  createRuntimeLayerConfigLayer,
  defaultRuntimeLayerConfig,
  layerRuntimeShutdownPreparation,
  layerRuntimeStartupReadiness,
  RuntimeLayerCommandControlPort,
} from "./bootstrap";
import { RuntimeShutdownPreparation, RuntimeStartupReadiness } from "./runtime-layer-config";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import {
  RuntimeSurfaceScopeService,
  type RuntimeSurfaceScopeServiceService,
} from "./surface-runtime-scope-service";
import { RuntimeWorkflowAgentSourceIndex } from "./runtime-workflow-agent-source-index";
import { layerRuntimeShutdownAdmission } from "./runtime-shutdown-admission";

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

  it.effect("recovers active turns before normalizing queues and restoring blocking waits", () => {
    const calls: string[] = [];
    return Effect.gen(function* () {
      const readiness = yield* RuntimeStartupReadiness;
      const receipt = yield* readiness.awaitReady;

      assert.deepStrictEqual(calls, [
        "sources",
        "snapshots",
        "recover:turn_startup_recovery",
        "publish",
        "normalize",
        "publish",
        "restore-request-input",
      ]);
      assert.strictEqual(receipt.status, "ready");
      assert.deepStrictEqual(receipt.completedPhases, [
        "layer-acquisition",
        "app-source-reconcile",
        "recovery-startup-scan",
        "event-bus",
      ]);
      assert.deepStrictEqual(receipt.degradedPhases, []);
      assert.match(receipt.readyAt, /^\d{4}-\d{2}-\d{2}T/);
    }).pipe(
      Effect.provide(
        layerRuntimeStartupReadiness.pipe(
          Layer.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig)),
          Layer.provide(
            Layer.succeed(RuntimeRequestInputWaitService, {
              ...noRequestInputWaitService(),
              restoreOpenBlockingRequests: () =>
                Effect.sync(() => calls.push("restore-request-input")),
            }),
          ),
          Layer.provide(
            Layer.succeed(RuntimeWorkflowAgentSourceIndex, {
              ...noWorkflowAgentSourceIndex(),
              scaffoldAndReconcile: Effect.sync(() => {
                calls.push("sources");
                return {
                  sourceFingerprint: "startup-recovery-workflow-agent-sources",
                  observations: [],
                  diagnostics: [],
                  scannedAt: "2026-06-29T00:00:00.000Z" as never,
                };
              }),
            }),
          ),
          Layer.provide(
            Layer.succeed(RuntimeRecoveryStatePort, {
              listWorkspaceRecoveryStartupSnapshots: () =>
                Effect.sync(() => {
                  calls.push("snapshots");
                  return [
                    {
                      session: {
                        id: "session_startup_recovery",
                        orchestratorPiSessionId: "surface_startup_recovery",
                      },
                      pi: { titleGenerationStatus: "not-started" },
                      turns: [
                        {
                          id: "turn_startup_recovery",
                          status: "running",
                          surfacePiSessionId: "surface_startup_recovery",
                          threadId: null,
                        },
                      ],
                      queuedMessages: [],
                      threads: [],
                    },
                  ] as never;
                }),
              normalizeWorkspaceRecoveryState: () =>
                Effect.sync(() => {
                  calls.push("normalize");
                  return { value: undefined, afterCommit: [] };
                }),
            } as never),
          ),
          Layer.provide(
            Layer.succeed(RuntimeTurnStatePort, {
              recoverInterruptedTurn: ({ turnId }: RecoverInterruptedRuntimeTurnInput) =>
                Effect.sync(() => {
                  calls.push(`recover:${turnId}`);
                  return {
                    value: {
                      changed: true,
                      turn: {
                        id: turnId,
                        sessionId: "session_startup_recovery",
                        surfacePiSessionId: "surface_startup_recovery",
                        threadId: null,
                        requestSummary: "Recover startup turn",
                        turnDecision: "pending",
                        status: "cancelled",
                        assistantMessageId: null,
                        assistantText: null,
                        startedAt: "2026-06-29T00:00:00.000Z",
                        updatedAt: "2026-06-29T00:00:01.000Z",
                        finishedAt: "2026-06-29T00:00:01.000Z",
                      },
                      terminalizedAssistantMessageId: null,
                      terminalizedCommandIds: [],
                      settledQueueItemId: null,
                      cancelledRequestInputIds: [],
                      cancelledApprovalIds: [],
                      sessionWaitCleared: false,
                    },
                    afterCommit: [],
                  } as never;
                }),
            } as never),
          ),
          Layer.provide(
            Layer.succeed(RuntimeEventBus, {
              ...noRuntimeEventBus(),
              publishStateInvalidations: () =>
                Effect.sync(() => {
                  calls.push("publish");
                  return [];
                }),
            }),
          ),
        ),
      ),
    );
  });

  it.effect(
    "provides one idempotent shutdown preparation through the promoted Effect layer",
    () => {
      let snapshots = 0;
      return Effect.gen(function* () {
        const shutdown = yield* RuntimeShutdownPreparation;
        const result = yield* shutdown.prepareShutdown({
          reason: "app-shutdown",
          requestedAt: "2026-06-29T00:00:00.000Z",
          drainTimeoutMs: 123,
        });
        const repeated = yield* shutdown.prepareShutdown({
          reason: "runtime-restart",
          requestedAt: "2026-06-29T00:00:01.000Z",
          drainTimeoutMs: 1,
        });

        assert.deepStrictEqual(result, {
          status: "drained",
          interruptedTurns: 0,
          interruptedCommands: 0,
          releasedQueueClaims: 0,
          recoveryRowsScheduled: 0,
        });
        assert.strictEqual(repeated, result);
        assert.strictEqual(snapshots, 2);
      }).pipe(
        Effect.provide(
          layerRuntimeShutdownPreparation.pipe(
            Layer.provide(layerRuntimeShutdownAdmission),
            Layer.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig)),
            Layer.provide(Layer.succeed(RuntimeApprovalStatePort, emptyApprovalStatePort())),
            Layer.provide(
              Layer.succeed(RuntimeCommandStatePort, unusedPort("RuntimeCommandStatePort")),
            ),
            Layer.provide(
              Layer.succeed(RuntimeLayerCommandControlPort, {
                cancel: () => Effect.die("Unexpected live command cancellation."),
              }),
            ),
            Layer.provide(
              Layer.succeed(RuntimeSessionWaitStatePort, unusedPort("RuntimeSessionWaitStatePort")),
            ),
            Layer.provide(Layer.succeed(RuntimeEventBus, noRuntimeEventBus())),
            Layer.provide(Layer.succeed(RuntimeApprovalWaitService, noApprovalWaitService())),
            Layer.provide(
              Layer.succeed(RuntimeRequestInputWaitService, noRequestInputWaitService()),
            ),
            Layer.provide(Layer.succeed(RuntimeTurnStatePort, unusedPort("RuntimeTurnStatePort"))),
            Layer.provide(
              Layer.succeed(RuntimeSurfaceScopeService, {
                snapshot: () =>
                  Effect.sync(() => {
                    snapshots += 1;
                    return [];
                  }),
              } as never),
            ),
          ),
        ),
      );
    },
  );

  it.effect(
    "force-terminalizes durable active-turn facts after the shutdown drain deadline",
    () => {
      const calls: string[] = [];
      const activeTurnId = "turn_shutdown_forced" as never;
      let forceInterruptEntered: Deferred.Deferred<void>;
      let allowForceInterrupt: Deferred.Deferred<void>;
      return Effect.scoped(
        Effect.gen(function* () {
          forceInterruptEntered = yield* Deferred.make<void>();
          allowForceInterrupt = yield* Deferred.make<void>();
          const shutdown = yield* RuntimeShutdownPreparation;
          const shutdownFiber = yield* shutdown
            .prepareShutdown({
              reason: "runtime-restart",
              requestedAt: "2026-06-29T00:00:00.000Z",
              drainTimeoutMs: 0,
            })
            .pipe(Effect.forkScoped);

          yield* Deferred.await(forceInterruptEntered);
          assert.notInclude(calls, "recover:turn_shutdown_forced:cancelled");
          yield* Deferred.succeed(allowForceInterrupt, undefined);
          const result = yield* Fiber.join(shutdownFiber);

          assert.deepStrictEqual(result, {
            status: "forced",
            interruptedTurns: 1,
            interruptedCommands: 2,
            releasedQueueClaims: 1,
            recoveryRowsScheduled: 0,
          });
          assert.deepStrictEqual(calls, [
            "request-input:surface_shutdown_forced",
            "interrupt:surface_shutdown_forced:turn_shutdown_forced",
            "force-interrupt:surface_shutdown_forced:turn_shutdown_forced",
            "recover:turn_shutdown_forced:cancelled",
            "cancel-command:command_shutdown_1",
            "cancel-command:command_shutdown_2",
          ]);
        }),
      ).pipe(
        Effect.provide(
          layerRuntimeShutdownPreparation.pipe(
            Layer.provide(layerRuntimeShutdownAdmission),
            Layer.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig)),
            Layer.provide(Layer.succeed(RuntimeApprovalStatePort, emptyApprovalStatePort())),
            Layer.provide(
              Layer.succeed(RuntimeCommandStatePort, unusedPort("RuntimeCommandStatePort")),
            ),
            Layer.provide(
              Layer.succeed(RuntimeLayerCommandControlPort, {
                cancel: ({ commandId }) =>
                  Effect.sync(() => {
                    calls.push(`cancel-command:${commandId}`);
                    return { commandId, status: "cancelled" as const };
                  }),
              }),
            ),
            Layer.provide(
              Layer.succeed(RuntimeSessionWaitStatePort, unusedPort("RuntimeSessionWaitStatePort")),
            ),
            Layer.provide(Layer.succeed(RuntimeEventBus, noRuntimeEventBus())),
            Layer.provide(Layer.succeed(RuntimeApprovalWaitService, noApprovalWaitService())),
            Layer.provide(
              Layer.succeed(
                RuntimeRequestInputWaitService,
                RuntimeRequestInputWaitService.of({
                  ...noRequestInputWaitService(),
                  cancelBlockingRequestsForSurface: ({ surfacePiSessionId }) =>
                    Effect.sync(() => calls.push(`request-input:${surfacePiSessionId}`)),
                }),
              ),
            ),
            Layer.provide(
              Layer.succeed(RuntimeTurnStatePort, {
                recoverInterruptedTurn: ({
                  turnId,
                  terminalStatus,
                }: RecoverInterruptedRuntimeTurnInput) =>
                  Effect.sync(() => {
                    calls.push(`recover:${turnId}:${terminalStatus}`);
                    return {
                      value: {
                        changed: true,
                        turn: {
                          id: turnId,
                          sessionId: "session_shutdown_forced",
                          surfacePiSessionId: "surface_shutdown_forced",
                          threadId: null,
                          requestSummary: "Interrupted shutdown turn",
                          turnDecision: "pending",
                          status: "failed",
                          assistantMessageId: null,
                          assistantText: null,
                          startedAt: "2026-06-29T00:00:00.000Z",
                          updatedAt: "2026-06-29T00:00:01.000Z",
                          finishedAt: "2026-06-29T00:00:01.000Z",
                        },
                        terminalizedAssistantMessageId: "message_shutdown_forced",
                        terminalizedCommandIds: ["command_shutdown_1", "command_shutdown_2"],
                        settledQueueItemId: "queue_shutdown_forced",
                        cancelledRequestInputIds: [],
                        cancelledApprovalIds: [],
                        sessionWaitCleared: false,
                      },
                      afterCommit: [],
                    } as never;
                  }),
              } as never),
            ),
            Layer.provide(
              Layer.succeed(RuntimeSurfaceScopeService, {
                snapshot: () =>
                  Effect.succeed([
                    {
                      surfacePiSessionId: "surface_shutdown_forced",
                      retainCount: 1,
                      activeTurnId,
                    },
                  ] as never),
                interrupt: ({
                  surfacePiSessionId,
                  turnId,
                  force,
                }: Parameters<RuntimeSurfaceScopeServiceService["interrupt"]>[0]) =>
                  Effect.gen(function* () {
                    calls.push(
                      `${force ? "force-interrupt" : "interrupt"}:${surfacePiSessionId}:${turnId}`,
                    );
                    if (force) {
                      yield* Deferred.succeed(forceInterruptEntered, undefined);
                      yield* Deferred.await(allowForceInterrupt);
                    }
                  }),
              } as never),
            ),
          ),
        ),
      );
    },
  );
});

function noWorkflowAgentSourceIndex(): RuntimeWorkflowAgentSourceIndex["Service"] {
  const reconcile = Effect.succeed({
    sourceFingerprint: "empty-workflow-agent-sources",
    observations: [],
    diagnostics: [],
    scannedAt: "2026-06-29T00:00:00.000Z" as never,
  });
  return { scaffoldAndReconcile: reconcile, reconcile };
}

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
