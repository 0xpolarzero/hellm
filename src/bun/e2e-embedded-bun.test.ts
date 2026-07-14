import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_EMBEDDED_BUN_PATH_ENV, installE2EEmbeddedBun } from "../../scripts/e2e-embedded-bun";

const expectedVersion = "1.3.10";

async function withFixture(
  run: (fixture: {
    appName: string;
    buildDir: string;
    destination: string;
    source: string;
  }) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "svvy-e2e-bun-"));
  const appName = "svvy-dev";
  const buildDir = join(root, "build", "dev-linux-x64");
  const destination = join(buildDir, appName, "bin", "bun");
  const source = join(root, "runner-bun");
  try {
    await mkdir(join(buildDir, appName, "bin"), { recursive: true });
    await writeFile(source, "cpu-compatible-runner");
    await chmod(source, 0o751);
    await writeFile(destination, "electrobun-default");
    await run({ appName, buildDir, destination, source });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("E2E embedded Bun policy", () => {
  test("is a complete no-op outside the E2E build", async () => {
    expect(
      await installE2EEmbeddedBun({
        expectedVersion,
        sourcePath: undefined,
      }),
    ).toBeNull();
  });

  test("rejects stable and non-linux-x64 targets before copying", async () => {
    await withFixture(async ({ appName, buildDir, destination, source }) => {
      for (const context of [
        { buildEnv: "stable", targetOS: "linux", targetArch: "x64" },
        { buildEnv: "dev", targetOS: "macos", targetArch: "x64" },
        { buildEnv: "dev", targetOS: "linux", targetArch: "arm64" },
      ]) {
        await expect(
          installE2EEmbeddedBun({
            ...context,
            appName,
            buildDir,
            expectedVersion,
            sourcePath: source,
          }),
        ).rejects.toThrow(E2E_EMBEDDED_BUN_PATH_ENV);
      }
      expect(await readFile(destination, "utf8")).toBe("electrobun-default");
    });
  });

  test("rejects a runner version mismatch before copying", async () => {
    await withFixture(async ({ appName, buildDir, destination, source }) => {
      await expect(
        installE2EEmbeddedBun(
          {
            appName,
            buildDir,
            buildEnv: "dev",
            expectedVersion,
            sourcePath: source,
            targetArch: "x64",
            targetOS: "linux",
          },
          {
            readRevision: async () => "1.3.9+fixture",
            readVersion: async () => "1.3.9",
          },
        ),
      ).rejects.toThrow("does not match Electrobun build.bunVersion");
      expect(await readFile(destination, "utf8")).toBe("electrobun-default");
    });
  });

  test("copies the runner byte-for-byte, preserves its executable mode, and receipts it", async () => {
    await withFixture(async ({ appName, buildDir, destination, source }) => {
      const receipt = await installE2EEmbeddedBun(
        {
          appName,
          buildDir,
          buildEnv: "dev",
          expectedVersion,
          sourcePath: source,
          targetArch: "x64",
          targetOS: "linux",
        },
        {
          readRevision: async () => `${expectedVersion}+fixture`,
          readVersion: async () => expectedVersion,
        },
      );

      expect(receipt).toMatchObject({
        destinationPath: destination,
        revision: `${expectedVersion}+fixture`,
        sourcePath: source,
        version: expectedVersion,
      });
      expect(receipt?.sha256).toBe(receipt?.sourceSha256);
      expect(await readFile(destination, "utf8")).toBe("cpu-compatible-runner");
      expect((await stat(destination)).mode & 0o777).toBe(0o751);
    });
  });
});
