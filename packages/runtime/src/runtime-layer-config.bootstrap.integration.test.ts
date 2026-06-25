import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import {
  RuntimeShutdownPreparation,
  RuntimeStartupReadiness,
  awaitRuntimeStartupReadiness,
  createRuntimeLayerConfigLayer,
  defaultRuntimeLayerConfig,
  prepareRuntimeShutdown,
} from "./bootstrap";
import type { RuntimePrepareShutdownInput } from "./bootstrap";

describe("@svvy/runtime bootstrap lifecycle gates", () => {
  it("awaits startup readiness through the runtime-owned service", async () => {
    let readyCalls = 0;

    const managedRuntime = ManagedRuntime.make(
      Layer.succeed(
        RuntimeStartupReadiness,
        RuntimeStartupReadiness.of({
          awaitReady: Effect.sync(() => {
            readyCalls += 1;
          }),
        }),
      ),
    );

    try {
      await awaitRuntimeStartupReadiness(managedRuntime);
      expect(readyCalls).toBe(1);
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
