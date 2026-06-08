import { describe, expect, test } from "bun:test";
import { syncBackoffDelay } from "../../src/sync/SyncBackoff.ts";

describe("syncBackoffDelay", () => {
  test("respects the cap and the jitter band", () => {
    // With random=0.5 the result is floor(upper / 2).
    expect(syncBackoffDelay(0, { baseMs: 100, maxMs: 10_000, random: () => 0.5 })).toBe(50);
    expect(syncBackoffDelay(3, { baseMs: 100, maxMs: 10_000, random: () => 0.5 })).toBe(400);
    expect(syncBackoffDelay(20, { baseMs: 100, maxMs: 10_000, random: () => 0.5 })).toBe(5_000);
  });

  test("never returns a negative delay", () => {
    expect(syncBackoffDelay(-5, { random: () => 0 })).toBe(0);
  });
});
