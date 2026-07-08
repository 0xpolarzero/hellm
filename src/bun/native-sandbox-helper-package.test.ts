import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { AbsolutePath } from "@svvy/core";
import { createPackagedSandboxHostSupportServices } from "./runtime-service-adapter";

const projectRoot = join(import.meta.dir, "..", "..");

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), "utf8");
}

describe("native sandbox helper package metadata", () => {
  test("app bootstrap derives sandbox helper candidates from packaged metadata", async () => {
    const macOsDir = mkdtempSync(join(tmpdir(), "svvy-sandbox-helper-package-"));
    try {
      writeFileSync(
        join(macOsDir, "svvy-sandbox-helper.metadata.json"),
        JSON.stringify({
          schemaVersion: 1,
          artifact: "svvy-sandbox-helper",
          platform: "darwin",
          arch: "arm64",
          digest: {
            algorithm: "sha256",
            hex: "a".repeat(64),
          },
        }),
      );

      const services = createPackagedSandboxHostSupportServices({
        executablePath: join(macOsDir, "svvy"),
        appSupportRoot: "/tmp/svvy-app-support",
        tempRoot: "/tmp",
        platform: "darwin",
        arch: "arm64",
      });

      await expect(Effect.runPromise(services.helperCandidates.getSnapshot())).resolves.toEqual({
        candidates: [
          {
            path: join(macOsDir, "svvy-sandbox-helper") as AbsolutePath,
            platform: "darwin",
            arch: "arm64",
            expectedDigest: "a".repeat(64),
          },
        ],
        allowedRoots: [macOsDir as AbsolutePath],
      });
      await expect(Effect.runPromise(services.hostProcess.getSnapshot())).resolves.toEqual({
        platform: "darwin",
        arch: "arm64",
        appBundleRoot: join(macOsDir, "..", "..") as AbsolutePath,
        appSupportRoot: "/tmp/svvy-app-support" as AbsolutePath,
        tempRoot: "/tmp" as AbsolutePath,
      });
    } finally {
      rmSync(macOsDir, { recursive: true, force: true });
    }
  });

  test("app bootstrap rejects malformed sandbox helper metadata as helper-unavailable", async () => {
    const macOsDir = mkdtempSync(join(tmpdir(), "svvy-sandbox-helper-package-"));
    try {
      writeFileSync(
        join(macOsDir, "svvy-sandbox-helper.metadata.json"),
        JSON.stringify({
          schemaVersion: 1,
          artifact: "svvy-sandbox-helper",
          platform: "darwin",
          arch: "arm64",
          digest: {
            algorithm: "sha256",
            hex: "not-a-sha",
          },
        }),
      );

      expect(() =>
        createPackagedSandboxHostSupportServices({
          executablePath: join(macOsDir, "svvy"),
          platform: "darwin",
          arch: "arm64",
        }),
      ).toThrow(
        expect.objectContaining({
          reason: "helper-unavailable",
        }),
      );
    } finally {
      rmSync(macOsDir, { recursive: true, force: true });
    }
  });

  test("build script writes digest metadata for the copied helper artifact", () => {
    const source = readProjectFile("scripts/build-native-sandbox-helper.ts");

    expect(source).toContain('"svvy-sandbox-helper.metadata.json"');
    expect(source).toContain("schemaVersion: 1");
    expect(source).toContain('artifact: "svvy-sandbox-helper"');
    expect(source).toContain('algorithm: "sha256"');
    expect(source).toContain('createHash("sha256").update(readFileSync(path)).digest("hex")');
    expect(source).toContain('process.arch === "arm64" || process.arch === "x64"');
    expect(source).toContain("writeFileSync(");
    expect(source).toContain("metadataPath,");
  });

  test("postbuild requires and copies helper metadata beside the packaged helper", () => {
    const source = readProjectFile("scripts/postbuild.ts");

    expect(source).toContain("const nativeSandboxHelperMetadata = join(");
    expect(source).toContain('"svvy-sandbox-helper.metadata.json"');
    expect(source).toContain("missing native sandbox helper metadata");
    expect(source).toContain(
      'cpSync(nativeSandboxHelperMetadata, join(macOsDir, "svvy-sandbox-helper.metadata.json"))',
    );
  });
});
