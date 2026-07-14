import { describe, expect, test } from "bun:test";
import { APP_BUN_RUNTIME, assertAppBunRuntimeVersion } from "../../scripts/bun-runtime-contract";

describe("app Bun runtime contract", () => {
  test("pins the rolling release carrying the upstream threadsafe FFI fix", () => {
    expect(APP_BUN_RUNTIME).toEqual({
      releaseTag: "canary",
      minimumVersion: "1.4.0",
      requiredFixCommit: "9e6a19ba2e3c43f0782c9c9fa24a608f9824bb06",
    });
  });

  test("accepts the minimum and later runtimes", () => {
    expect(() => assertAppBunRuntimeVersion("1.4.0")).not.toThrow();
    expect(() => assertAppBunRuntimeVersion("1.4.1-canary.2")).not.toThrow();
    expect(() => assertAppBunRuntimeVersion("2.0.0")).not.toThrow();
  });

  test("rejects the affected stable runtime and malformed versions", () => {
    expect(() => assertAppBunRuntimeVersion("1.3.14")).toThrow(
      "required threadsafe FFI fix 9e6a19ba",
    );
    expect(() => assertAppBunRuntimeVersion("canary")).toThrow("Could not parse Bun version");
  });
});
