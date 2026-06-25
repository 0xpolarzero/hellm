import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import {
  RuntimeLayerConfigFromEnv,
  RuntimeLayerConfigService,
  createRuntimeLayerConfigLayer,
  defaultRuntimeLayerConfig,
} from "./bootstrap";

describe("@svvy/runtime Effect runtime-layer config", () => {
  it.effect("parses environment overrides through the Effect config service", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromEnv({
        env: {
          SVVY_RUNTIME_QUEUE_WAKEUP_CAPACITY: "128",
          SVVY_RUNTIME_EVENT_REPLAY_CAPACITY: "512",
          SVVY_RUNTIME_EVENT_SUBSCRIBER_BUFFER_CAPACITY: "4096",
          SVVY_RUNTIME_SOURCE_HINT_QUEUE_CAPACITY: "256",
        },
      });

      const config = yield* RuntimeLayerConfigFromEnv.parse(provider);

      assert.deepStrictEqual(config, {
        ...defaultRuntimeLayerConfig,
        queueWakeupCapacity: 128,
        eventReplayCapacity: 512,
        eventSubscriberBufferCapacity: 4096,
        sourceHintQueueCapacity: 256,
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

  it.effect("provides runtime layer config through an Effect service layer", () =>
    Effect.gen(function* () {
      const config = yield* RuntimeLayerConfigService;

      assert.strictEqual(config, defaultRuntimeLayerConfig);
    }).pipe(Effect.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig))),
  );
});
