import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..", "..");

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), "utf8");
}

describe("dev browser tools production boundary", () => {
  test("production build uses the stable Electrobun channel", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toContain("electrobun build --env=stable");
    expect(packageJson.scripts.build).toContain("SVVY_SKIP_DMG=1");
    expect(packageJson.scripts["build:dmg"]).toContain("SVVY_CREATE_DMG=1");
    expect(packageJson.scripts["build:dev"]).toContain("electrobun build --env=dev");
  });

  test("e2e builds the dev channel so browser-tools inspection stays dev-only", () => {
    const configSource = readProjectFile("electrobun-e2e.config.ts");

    expect(configSource).toContain('buildCommand: ["bun", "run", "build:dev"]');
  });

  test("production startup does not statically import or mount browser tools", () => {
    const indexSource = readProjectFile("src/bun/index.ts");

    expect(indexSource).not.toMatch(/import\s+.*["']\.\/dev-browser-tools-bridge["']/);
    expect(indexSource).not.toContain("electrobun-browser-tools/bridge");
    expect(indexSource).not.toContain("mountElectrobunToolBridge");
    expect(indexSource).not.toContain("tool-bridge");
    const prepareStart = indexSource.indexOf("prepareMainWindow:");
    const devOnlyReturn = indexSource.indexOf('(await appChannelPromise) !== "dev"', prepareStart);
    const dynamicImport = indexSource.indexOf('await import("./dev-browser-tools-bridge")');
    expect(prepareStart).toBeGreaterThanOrEqual(0);
    expect(devOnlyReturn).toBeGreaterThan(prepareStart);
    expect(devOnlyReturn).toBeLessThan(dynamicImport);
    expect(dynamicImport).toBeGreaterThan(prepareStart);
  });

  test("stable bundle package copy list excludes browser-tools bridge runtime", () => {
    const postbuildSource = readProjectFile("scripts/postbuild.ts");

    expect(postbuildSource).not.toContain("electrobun-browser-tools");
  });
});
