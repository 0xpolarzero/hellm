import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";

import {
  RuntimeLayerConfigInputSchema,
  RuntimeLayerError,
  RuntimeLayerErrorSchema,
  encodeRuntimeLayerErrorExit,
} from "./bootstrap";

describe("@svvy/runtime bootstrap config", () => {
  it("decodes partial config input by filling defaults", () => {
    const decoded = Schema.decodeUnknownSync(RuntimeLayerConfigInputSchema)({
      queueWakeupCapacity: 128,
      eventReplayCapacity: 256,
      eventSubscriberBufferCapacity: 2048,
      sourceHintQueueCapacity: 512,
      sourceMaxCoalescingLatencyMs: 2_500,
    });

    expect(decoded.queueWakeupCapacity).toBe(128);
    expect(decoded.eventReplayCapacity).toBe(256);
    expect(decoded.eventSubscriberBufferCapacity).toBe(2048);
    expect(decoded.sourceHintQueueCapacity).toBe(512);
    expect(Number(decoded.sourceMaxCoalescingLatencyMs)).toBe(2_500);
    expect(decoded.runtimeStartupWorkspaceAdmissionCapacity).toBe(64);
    expect(Number(decoded.queueClaimLeaseRefreshIntervalMs)).toBe(10_000);
    expect(Number(decoded.workflowTaskAgentBridgeRequestTimeoutMs)).toBe(300_000);
    expect(decoded.workflowTaskAgentBridgeMaxRequestBytes).toBe(1_048_576);
    expect(decoded.workflowTaskAgentBridgeMaxResponseBytes).toBe(1_048_576);
  });

  it("rejects inconsistent completed config input", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeLayerConfigInputSchema)({
        workerRestartInitialDelayMs: 10,
        workerRestartMaxDelayMs: 9,
      }),
    ).toThrow("workerRestartInitialDelayMs must be less than or equal to workerRestartMaxDelayMs");
  });

  it("rejects source debounce settings that exceed max coalescing latency", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeLayerConfigInputSchema)({
        sourceDebounceMs: 2_001,
        sourceMaxCoalescingLatencyMs: 2_000,
      }),
    ).toThrow("sourceDebounceMs must be less than or equal to sourceMaxCoalescingLatencyMs");
  });

  it("decodes and encodes runtime layer errors at bootstrap boundaries", async () => {
    const decoded = Schema.decodeUnknownSync(RuntimeLayerErrorSchema)({
      _tag: "RuntimeLayerError",
      operation: "runtime.shutdown",
      reason: "shutdown-failed",
      message: "Runtime shutdown did not drain.",
    });

    expect(decoded).toBeInstanceOf(RuntimeLayerError);
    expect(decoded.reason).toBe("shutdown-failed");

    expect(() =>
      Schema.decodeUnknownSync(RuntimeLayerErrorSchema)({
        _tag: "RuntimeLayerError",
        operation: "runtime.shutdown",
        reason: "other",
        message: "Invalid reason.",
      }),
    ).toThrow('Expected "startup-not-ready" | "shutdown-failed"');

    const encodedExit = encodeRuntimeLayerErrorExit(
      new RuntimeLayerError({
        operation: "runtime.startup",
        reason: "startup-not-ready",
        message: "Runtime startup readiness has not completed.",
      }),
    );
    expect(encodedExit._tag).toBe("Success");
    if (encodedExit._tag !== "Success") {
      throw new Error("Expected runtime layer error encoding to succeed.");
    }

    expect(encodedExit.value).toEqual({
      _tag: "RuntimeLayerError",
      operation: "runtime.startup",
      reason: "startup-not-ready",
      message: "Runtime startup readiness has not completed.",
    });
  });
});
