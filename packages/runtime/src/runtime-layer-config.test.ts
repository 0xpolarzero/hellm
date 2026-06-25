import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";

import { RuntimeLayerConfigInputSchema, defaultRuntimeLayerConfig } from "./bootstrap";

describe("@svvy/runtime bootstrap config", () => {
  it("decodes partial config input by filling defaults", () => {
    const decoded = Schema.decodeUnknownSync(RuntimeLayerConfigInputSchema)({
      queueWakeupCapacity: 128,
      eventReplayCapacity: 256,
      eventSubscriberBufferCapacity: 2048,
      sourceHintQueueCapacity: 512,
    });

    expect(decoded).toEqual({
      ...defaultRuntimeLayerConfig,
      queueWakeupCapacity: 128,
      eventReplayCapacity: 256,
      eventSubscriberBufferCapacity: 2048,
      sourceHintQueueCapacity: 512,
    });
  });

  it("rejects inconsistent completed config input", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeLayerConfigInputSchema)({
        workerRestartInitialDelayMs: 10,
        workerRestartMaxDelayMs: 9,
      }),
    ).toThrow("workerRestartInitialDelayMs must be less than or equal to workerRestartMaxDelayMs");
  });
});
