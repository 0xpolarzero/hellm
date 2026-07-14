import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("the pinned Electrobun launcher provisions core assets before its older native runtime", async () => {
  const packageJson = import.meta.resolve("electrobun/package.json");
  const launcher = await readFile(new URL("./bin/electrobun.cjs", packageJson), "utf8");

  expect(launcher).toContain("async function ensureCoreDependencies()");
  expect(launcher).toContain("await ensureCoreDependencies();");
  expect(launcher.indexOf("await ensureCoreDependencies();")).toBeLessThan(
    launcher.indexOf("const cliPath = await ensureCliBinary();"),
  );
  expect(launcher).toContain("[301, 302, 307, 308]");
  expect(launcher).toContain("request.setTimeout(120_000");
  expect(launcher).toContain("mkdtempSync");
  expect(launcher).toContain("Electrobun core archive is incomplete");
  for (const requiredFile of [
    "bun",
    "bsdiff",
    "bspatch",
    "zig-zstd",
    "launcher",
    "libNativeWrapper.dylib",
  ]) {
    expect(launcher).toContain(`'${requiredFile}'`);
  }
});
