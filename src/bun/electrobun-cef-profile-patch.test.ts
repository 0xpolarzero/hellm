import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import electrobunConfig from "../../electrobun.config";

test("the pinned Linux renderer default uses Electrobun's empty ephemeral partition", async () => {
  const packageJson = import.meta.resolve("electrobun/package.json");
  const nativeSource = await readFile(
    new URL("./dist/api/bun/proc/native.ts", packageJson),
    "utf8",
  );
  const webviewInit = nativeSource.slice(
    nativeSource.indexOf("const webviewPtr = native_.symbols.initWebview("),
    nativeSource.indexOf("if (!webviewPtr)", nativeSource.indexOf("const webviewPtr")),
  );

  expect(webviewInit).toContain('process.platform === "linux"');
  expect(webviewInit).toContain('? (partition ?? "")');
  expect(webviewInit).not.toContain('renderer === "cef"');
  expect(webviewInit).not.toContain('"ephemeral"');
  expect(webviewInit).not.toContain('toCString(partition || "persist:default")');
  expect(webviewInit.match(/toCString\(\s*process\.platform/g)).toHaveLength(1);
});

test("the bundled Linux renderer metadata truthfully selects CEF", () => {
  expect(electrobunConfig.build.linux?.bundleCEF).toBe(true);
  expect(electrobunConfig.build.linux?.defaultRenderer).toBe("cef");
});

test("the app worker uses a Bun runtime carrying the threadsafe FFI fix", () => {
  expect(electrobunConfig.build.bunVersion).toBe("canary");
});

test("the pinned Electrobun downloader supports Bun's official canary tag", async () => {
  const packageJson = import.meta.resolve("electrobun/package.json");
  const [cliSource, launcherSource] = await Promise.all([
    readFile(new URL("./src/cli/index.ts", packageJson), "utf8"),
    readFile(new URL("./bin/electrobun.cjs", packageJson), "utf8"),
  ]);

  expect(cliSource).toContain('bunVersion === "canary" ? "canary" : `bun-v${bunVersion}`');
  expect(cliSource).toContain("releases/download/${releaseTag}/${bunUrlSegment}");
  expect(launcherSource).toContain("async function ensureCanaryBunOverride()");
  expect(launcherSource).toContain("releases/download/canary/${asset}.zip");
  expect(launcherSource).toContain("isFixedCanaryBun(process.execPath)");
  expect(launcherSource).toContain("await ensureCanaryBunOverride()");
});

test("the pinned Linux CEF quit path exits only after app-owned shutdown", async () => {
  const packageJson = import.meta.resolve("electrobun/package.json");
  const utilsSource = await readFile(new URL("./dist/api/bun/core/Utils.ts", packageJson), "utf8");
  const nativeQuit = utilsSource.slice(
    utilsSource.indexOf("if (native)"),
    utilsSource.indexOf("} else {", utilsSource.indexOf("if (native)")),
  );

  expect(nativeQuit).toContain('process.platform === "linux"');
  expect(nativeQuit).toContain("native.symbols.forceExit(0)");
  expect(nativeQuit.indexOf('process.platform === "linux"')).toBeLessThan(
    nativeQuit.indexOf("native.symbols.stopEventLoop()"),
  );
});
