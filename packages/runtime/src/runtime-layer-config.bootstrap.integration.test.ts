import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import {
  RuntimeStartupError,
  RuntimeShutdownPreparation,
  RuntimeStartupReadiness,
  awaitRuntimeStartupReadiness,
  createRuntimeLayerConfigLayer,
  defaultRuntimeLayerConfig,
  prepareRuntimeShutdown,
} from "./bootstrap";
import type { RuntimePrepareShutdownInput } from "./runtime-layer-config";
import type { RuntimeStartupReadinessReceipt } from "./runtime-layer-config";

describe("@svvy/runtime bootstrap lifecycle gates", () => {
  it("awaits startup readiness through the runtime-owned service", async () => {
    let readyCalls = 0;
    const receipt: RuntimeStartupReadinessReceipt = {
      status: "ready" as const,
      readyAt: "2026-06-21T12:34:56.789Z",
      completedPhases: ["layer-acquisition", "event-bus"] as const,
      degradedPhases: [],
    };

    const managedRuntime = ManagedRuntime.make(
      Layer.succeed(
        RuntimeStartupReadiness,
        RuntimeStartupReadiness.of({
          awaitReady: Effect.sync(() => {
            readyCalls += 1;
            return receipt;
          }),
        }),
      ),
    );

    try {
      await expect(awaitRuntimeStartupReadiness(managedRuntime)).resolves.toEqual(receipt);
      expect(readyCalls).toBe(1);
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("rejects startup readiness with the typed runtime startup error", async () => {
    const startupError = new RuntimeStartupError({
      operation: "runtime.startup.awaitReadiness",
      phase: "app-source-reconcile",
      reason: "required-startup-check-failed",
      message: "App source reconcile failed.",
    });

    const managedRuntime = ManagedRuntime.make(
      Layer.succeed(
        RuntimeStartupReadiness,
        RuntimeStartupReadiness.of({
          awaitReady: Effect.fail(startupError),
        }),
      ),
    );

    try {
      await expect(awaitRuntimeStartupReadiness(managedRuntime)).rejects.toBe(startupError);
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("prepares shutdown through the runtime-owned service", async () => {
    const capturedInputs: RuntimePrepareShutdownInput[] = [];

    const managedRuntime = ManagedRuntime.make(
      Layer.mergeAll(
        createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig),
        Layer.succeed(
          RuntimeShutdownPreparation,
          RuntimeShutdownPreparation.of({
            prepareShutdown: (input) =>
              Effect.sync(() => {
                capturedInputs.push(input);
                return {
                  status: "drained" as const,
                  interruptedTurns: 1,
                  interruptedCommands: 2,
                  releasedQueueClaims: 3,
                  recoveryRowsScheduled: 4,
                };
              }),
          }),
        ),
      ),
    );

    try {
      const result = await prepareRuntimeShutdown(managedRuntime, { reason: "startup-failure" });

      expect(result).toEqual({
        status: "drained",
        interruptedTurns: 1,
        interruptedCommands: 2,
        releasedQueueClaims: 3,
        recoveryRowsScheduled: 4,
      });
      expect(capturedInputs).toEqual([
        expect.objectContaining({
          reason: "startup-failure",
          drainTimeoutMs: defaultRuntimeLayerConfig.runtimeShutdownDrainTimeoutMs,
        }),
      ]);
      const capturedInput = capturedInputs[0];
      expect(capturedInput).toBeDefined();
      expect(capturedInput?.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      await managedRuntime.dispose();
    }
  });
});
