import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { AbsolutePath } from "@svvy/core";
import {
  createNodeSourceInvalidationHost,
  createPackagedSandboxHostSupportServices,
  parseNativeSandboxHelperMetadata,
} from "./runtime-service-adapter";

describe("runtime service adapter glue", () => {
  it("does not construct production Effect managed runtimes", () => {
    const source = readFileSync(join(import.meta.dir, "runtime-service-adapter.ts"), "utf8");

    expect(source).not.toContain("ManagedRuntime.make");
    expect(source).not.toContain("createRuntimeFacade");
    expect(source).not.toContain("createCatalogBackedRuntime");
  });

  it("builds packaged sandbox host support from helper metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-runtime-service-adapter-"));
    try {
      writeFileSync(
        join(root, "svvy-sandbox-helper.metadata.json"),
        JSON.stringify({
          schemaVersion: 1,
          artifact: "svvy-sandbox-helper",
          platform: "darwin",
          arch: "arm64",
          digest: { algorithm: "sha256", hex: "a".repeat(64) },
        }),
      );

      const support = createPackagedSandboxHostSupportServices({
        executablePath: join(root, "svvy"),
        appSupportRoot: join(root, "support"),
        tempRoot: join(root, "tmp"),
        platform: "darwin",
        arch: "arm64",
      });

      expect(Effect.runSync(support.helperCandidates.getSnapshot())).toEqual({
        candidates: [
          {
            path: join(root, "svvy-sandbox-helper") as AbsolutePath,
            platform: "darwin",
            arch: "arm64",
            expectedDigest: "a".repeat(64),
          },
        ],
        allowedRoots: [root as AbsolutePath],
      });
      expect(Effect.runSync(support.hostProcess.getSnapshot())).toEqual({
        platform: "darwin",
        arch: "arm64",
        appBundleRoot: join(root, "..", "..") as AbsolutePath,
        appSupportRoot: join(root, "support") as AbsolutePath,
        tempRoot: join(root, "tmp") as AbsolutePath,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects invalid native sandbox helper metadata", () => {
    expect(() =>
      parseNativeSandboxHelperMetadata(
        JSON.stringify({
          schemaVersion: 1,
          artifact: "svvy-sandbox-helper",
          platform: "darwin",
          arch: "arm64",
          digest: { algorithm: "sha256", hex: "not-a-digest" },
        }),
      ),
    ).toThrow("digest hex");
  });

  it("exposes a Node source invalidation host with filesystem and hashing primitives", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-source-host-")) as AbsolutePath;
    try {
      writeFileSync(join(root, "input.txt"), "source input");
      const host = createNodeSourceInvalidationHost();

      expect(host.fileSystem.exists(join(root, "input.txt"))).toBeTrue();
      expect(host.fileSystem.isFile(join(root, "input.txt"))).toBeTrue();
      expect(host.fileSystem.readFileString(join(root, "input.txt"))).toBe("source input");
      expect(host.hashStrings(["a", "b"])).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
