import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureFreshElectrobunBuild } from "../../e2e/harness";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function createFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "svvy-e2e-build-freshness-"));
  fixtureRoots.push(projectRoot);
  const inputPath = join(projectRoot, "src", "input.ts");
  const buildRoot = join(projectRoot, "build");
  const buildTargetPath = join(buildRoot, "dev-linux-x64");
  const launcherPath = join(buildTargetPath, "svvy-dev", "bin", "launcher");
  const distPath = join(projectRoot, "dist");
  const distIndexPath = join(distPath, "index.html");
  const buildFingerprintPath = join(buildRoot, ".svvy-e2e-build-fingerprint.json");
  const runnerBuildStampPath = join(buildRoot, ".electrobun-e2e-build-stamp");
  const logs: string[] = [];
  let buildCalls = 0;

  const writeRequiredArtifacts = async () => {
    await Promise.all([
      mkdir(dirname(launcherPath), { recursive: true }),
      mkdir(distPath, { recursive: true }),
    ]);
    await Promise.all([writeFile(launcherPath, "launcher"), writeFile(distIndexPath, "index")]);
  };

  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(inputPath, 'export const value = "one";\n');

  const options = {
    build: async () => {
      buildCalls += 1;
      await writeRequiredArtifacts();
    },
    buildFingerprintPath,
    buildInputPaths: ["src/input.ts"],
    cleanOutputPaths: [buildRoot, distPath],
    log: (message: string) => logs.push(message),
    projectRoot,
    requiredArtifactPaths: [launcherPath, distIndexPath],
    runnerBuildStampPath,
  };

  return {
    buildFingerprintPath,
    buildTargetPath,
    distIndexPath,
    distPath,
    getBuildCalls: () => buildCalls,
    inputPath,
    launcherPath,
    logs,
    options,
    runnerBuildStampPath,
    writeRequiredArtifacts,
  };
}

describe("e2e build freshness", () => {
  test("builds once, records the input content, and skips an unchanged bundle", async () => {
    const fixture = await createFixture();

    expect(await ensureFreshElectrobunBuild(fixture.options)).toBe("rebuilt");
    expect(await ensureFreshElectrobunBuild(fixture.options)).toBe("fresh");
    expect(fixture.getBuildCalls()).toBe(1);
    expect(fixture.logs).toContain(
      "E2E app bundle is stale (required build artifacts are missing); rebuilding before launch.",
    );
    expect(fixture.logs.at(-1)).toBe(
      "E2E app bundle is fresh; build inputs match the verified bundle fingerprint.",
    );
  });

  test("rebuilds when content changes even if the source mtime is preserved", async () => {
    const fixture = await createFixture();
    await ensureFreshElectrobunBuild(fixture.options);
    const originalTimes = await stat(fixture.inputPath);

    await writeFile(fixture.inputPath, 'export const value = "two";\n');
    await utimes(fixture.inputPath, originalTimes.atime, originalTimes.mtime);

    expect(await ensureFreshElectrobunBuild(fixture.options)).toBe("rebuilt");
    expect(fixture.getBuildCalls()).toBe(2);
    expect(fixture.logs).toContain(
      "E2E app bundle is stale (build inputs changed); rebuilding before launch.",
    );
  });

  test("adopts a complete OrbStack runner build without rebuilding it twice", async () => {
    const fixture = await createFixture();
    await fixture.writeRequiredArtifacts();
    await writeFile(fixture.runnerBuildStampPath, "");
    const input = await stat(fixture.inputPath);
    const afterInput = new Date(input.mtimeMs + 5_000);
    await utimes(fixture.runnerBuildStampPath, afterInput, afterInput);

    expect(await ensureFreshElectrobunBuild(fixture.options)).toBe("adopted-runner-build");
    expect(await ensureFreshElectrobunBuild(fixture.options)).toBe("fresh");
    expect(fixture.getBuildCalls()).toBe(0);
    expect(fixture.logs[0]).toContain("adopted the OrbStack runner build");
  });

  test("does not trust a matching fingerprint when a required artifact disappears", async () => {
    const fixture = await createFixture();
    await ensureFreshElectrobunBuild(fixture.options);
    await rm(fixture.distPath, { recursive: true });

    expect(await ensureFreshElectrobunBuild(fixture.options)).toBe("rebuilt");
    expect(fixture.getBuildCalls()).toBe(2);
  });

  test("rebuilds when a required child artifact is deleted but output directories remain", async () => {
    const fixture = await createFixture();
    await ensureFreshElectrobunBuild(fixture.options);
    await rm(fixture.launcherPath);

    expect((await stat(fixture.buildTargetPath)).isDirectory()).toBe(true);
    expect((await stat(fixture.distPath)).isDirectory()).toBe(true);
    expect(await ensureFreshElectrobunBuild(fixture.options)).toBe("rebuilt");
    expect(fixture.getBuildCalls()).toBe(2);
  });

  test("fails clearly when the build command does not produce every required artifact", async () => {
    const fixture = await createFixture();
    fixture.options.build = async () => {
      await mkdir(dirname(fixture.launcherPath), { recursive: true });
      await writeFile(fixture.launcherPath, "launcher");
    };

    await expect(ensureFreshElectrobunBuild(fixture.options)).rejects.toThrow(
      `E2E build completed without all required artifact files: ${fixture.launcherPath}, ${fixture.distIndexPath}`,
    );
  });
});
