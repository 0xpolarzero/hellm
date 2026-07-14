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
    const e2eBuildSource = readProjectFile("scripts/build-e2e-app.ts");
    const embeddedBunSource = readProjectFile("scripts/e2e-embedded-bun.ts");
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(configSource).toContain('buildCommand: ["bun", "scripts/build-e2e-app.ts"]');
    expect(e2eBuildSource).toContain('"run", "build:dev"');
    expect(e2eBuildSource).toContain("E2E_EMBEDDED_BUN_PATH_ENV");
    expect(embeddedBunSource).toContain('"SVVY_E2E_EMBEDDED_BUN_PATH"');
    expect(packageJson.scripts.build).not.toContain("SVVY_E2E_EMBEDDED_BUN_PATH");
    expect(packageJson.scripts["build:dev"]).not.toContain("SVVY_E2E_EMBEDDED_BUN_PATH");
    expect(packageJson.scripts["build:check"]).not.toContain("SVVY_E2E_EMBEDDED_BUN_PATH");
  });

  test("production startup does not statically import or mount browser tools", () => {
    const indexSource = readProjectFile("src/bun/index.ts");

    expect(indexSource).not.toMatch(/import\s+.*["']\.\/dev-browser-tools-bridge["']/);
    expect(indexSource).not.toContain("electrobun-browser-tools/bridge");
    expect(indexSource).not.toContain("mountElectrobunToolBridge");
    expect(indexSource).not.toContain("tool-bridge");
    const mountFunctionStart = indexSource.indexOf("const mountDevBrowserToolsForMainWindow");
    const devOnlyReturn = indexSource.indexOf(
      '(await appChannelPromise) !== "dev"',
      mountFunctionStart,
    );
    const dynamicImport = indexSource.indexOf('await import("./dev-browser-tools-bridge")');
    expect(mountFunctionStart).toBeGreaterThanOrEqual(0);
    expect(devOnlyReturn).toBeGreaterThan(mountFunctionStart);
    expect(devOnlyReturn).toBeLessThan(dynamicImport);
    expect(dynamicImport).toBeGreaterThan(mountFunctionStart);
  });

  test("dev browser tools mount after renderer readiness and before app.ready", () => {
    const indexSource = readProjectFile("src/bun/index.ts");

    expect(indexSource).not.toContain("prepareMainWindow:");
    const desktopStarted = indexSource.indexOf("await desktopApp.start();");
    const mainWindowResolved = indexSource.indexOf("const mainWindow = host.getMainWindow();");
    const browserToolsMounted = indexSource.indexOf(
      "await mountDevBrowserToolsForMainWindow(mainWindow);",
    );
    const appReadyRecorded = indexSource.indexOf('recordDevBrowserToolsEvent("app.ready"');
    const bridgeMetadataPrinted = indexSource.indexOf("svvy bridge:");

    expect(desktopStarted).toBeGreaterThanOrEqual(0);
    expect(mainWindowResolved).toBeGreaterThan(desktopStarted);
    expect(browserToolsMounted).toBeGreaterThan(mainWindowResolved);
    expect(appReadyRecorded).toBeGreaterThan(browserToolsMounted);
    expect(bridgeMetadataPrinted).toBeGreaterThan(appReadyRecorded);
  });

  test("stable bundle package copy list excludes browser-tools bridge runtime", () => {
    const postbuildSource = readProjectFile("scripts/postbuild.ts");

    expect(postbuildSource).not.toContain("electrobun-browser-tools");
  });
});
