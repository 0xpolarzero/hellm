import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import electrobunE2EConfig from "../../electrobun-e2e.config";
import { fingerprintBuildInputs, prepareE2EBuildInputs } from "../../scripts/e2e-build-prepare";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function createFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "svvy-e2e-build-prepare-"));
  fixtureRoots.push(projectRoot);
  const inputPath = join(projectRoot, "src", "ChatTranscript.svelte");
  const fingerprintPath = join(projectRoot, ".svvy-e2e-build-inputs.sha256");
  const runnerBuildStampPath = join(projectRoot, "build", ".electrobun-e2e-build-stamp");

  await mkdir(dirname(inputPath), { recursive: true });
  await writeFile(inputPath, "<p>before</p>\n");
  await mkdir(dirname(runnerBuildStampPath), { recursive: true });
  await writeFile(runnerBuildStampPath, "runner build");

  return { fingerprintPath, inputPath, projectRoot, runnerBuildStampPath };
}

describe("OrbStack e2e build input preparation", () => {
  test("configures the remote runner to use the digest hook and preserve only its marker", () => {
    expect(electrobunE2EConfig.installCommand).toEqual(["bun", "scripts/e2e-build-prepare.ts"]);
    expect(electrobunE2EConfig.syncExcludes).toContain("/e2e-results");
    expect(electrobunE2EConfig.syncExcludes).not.toContain("e2e-results");
    expect(electrobunE2EConfig.syncExcludes).toContain(".svvy-e2e-build-inputs.sha256");
  });

  test("changes the digest for same-mtime source edits and invalidates the runner stamp", async () => {
    const fixture = await createFixture();
    const before = await stat(fixture.inputPath);
    const originalFingerprint = await fingerprintBuildInputs(fixture.projectRoot, ["src"]);
    await prepareE2EBuildInputs({
      buildInputPaths: ["src"],
      fingerprintPath: fixture.fingerprintPath,
      projectRoot: fixture.projectRoot,
      runnerBuildStampPath: fixture.runnerBuildStampPath,
    });
    await mkdir(dirname(fixture.runnerBuildStampPath), { recursive: true });
    await writeFile(fixture.runnerBuildStampPath, "runner build");

    await writeFile(fixture.inputPath, "<p>after</p>\n");
    await utimes(fixture.inputPath, before.atime, before.mtime);
    const changedFingerprint = await fingerprintBuildInputs(fixture.projectRoot, ["src"]);

    expect(changedFingerprint).not.toBe(originalFingerprint);
    expect(
      await prepareE2EBuildInputs({
        buildInputPaths: ["src"],
        fingerprintPath: fixture.fingerprintPath,
        projectRoot: fixture.projectRoot,
        runnerBuildStampPath: fixture.runnerBuildStampPath,
      }),
    ).toBe("changed");
    await expect(stat(fixture.runnerBuildStampPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(fixture.fingerprintPath, "utf8")).toBe(`${changedFingerprint}\n`);
  });

  test("keeps the runner stamp when the synced input content is unchanged", async () => {
    const fixture = await createFixture();
    const first = await prepareE2EBuildInputs({
      buildInputPaths: ["src"],
      fingerprintPath: fixture.fingerprintPath,
      projectRoot: fixture.projectRoot,
      runnerBuildStampPath: fixture.runnerBuildStampPath,
    });

    await writeFile(fixture.runnerBuildStampPath, "runner build");
    const second = await prepareE2EBuildInputs({
      buildInputPaths: ["src"],
      fingerprintPath: fixture.fingerprintPath,
      projectRoot: fixture.projectRoot,
      runnerBuildStampPath: fixture.runnerBuildStampPath,
    });

    expect(first).toBe("changed");
    expect(second).toBe("unchanged");
    expect((await stat(fixture.runnerBuildStampPath)).isFile()).toBe(true);
  });
});
