import { describe, expect, test } from "bun:test";
import { syncKeyFingerprint, syncKeyMatches, type SyncKey } from "../../src/sync/SyncKey.ts";

/**
 * Fingerprint canonicalization is a load-bearing invariant — if `{a:1,b:2}`
 * and `{b:2,a:1}` fingerprint differently, every cache hit becomes a miss and
 * the SDK silently degrades to per-component requests. Tests pin the
 * canonicalization rules so future changes can't regress them by accident.
 */

describe("syncKeyFingerprint", () => {
  test("normalizes object key order", () => {
    const a: SyncKey = ["scope", { a: 1, b: 2 }];
    const b: SyncKey = ["scope", { b: 2, a: 1 }];
    expect(syncKeyFingerprint(a)).toBe(syncKeyFingerprint(b));
  });

  test("drops undefined fields so optional params don't fragment cache", () => {
    const a: SyncKey = ["scope", { a: 1, b: undefined }];
    const b: SyncKey = ["scope", { a: 1 }];
    expect(syncKeyFingerprint(a)).toBe(syncKeyFingerprint(b));
  });

  test("preserves array order (positional args)", () => {
    const a: SyncKey = ["scope", [1, 2]];
    const b: SyncKey = ["scope", [2, 1]];
    expect(syncKeyFingerprint(a)).not.toBe(syncKeyFingerprint(b));
  });

  test("distinguishes scopes", () => {
    expect(syncKeyFingerprint(["a"])).not.toBe(syncKeyFingerprint(["b"]));
  });
});

describe("syncKeyMatches", () => {
  test("matches identical keys", () => {
    expect(syncKeyMatches(["gateway:listRuns", {}], ["gateway:listRuns", {}])).toBe(true);
  });

  test("matches scope prefixes", () => {
    expect(syncKeyMatches(["gateway:listRuns", { x: 1 }], ["gateway:listRuns"])).toBe(true);
  });

  test("rejects non-matching prefixes", () => {
    expect(syncKeyMatches(["gateway:listRuns"], ["gateway:listWorkflows"])).toBe(false);
  });
});
