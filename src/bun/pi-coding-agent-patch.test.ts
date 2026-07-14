import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("the pinned pi runtime lazy-loads its optional native clipboard addon", async () => {
  const entrypoint = import.meta.resolve("@mariozechner/pi-coding-agent");
  const nativeSource = await readFile(new URL("./utils/clipboard-native.js", entrypoint), "utf8");
  const textSource = await readFile(new URL("./utils/clipboard.js", entrypoint), "utf8");
  const imageSource = await readFile(new URL("./utils/clipboard-image.js", entrypoint), "utf8");

  expect(nativeSource).toContain("function getClipboard()");
  expect(nativeSource.indexOf('require("@mariozechner/clipboard")')).toBeGreaterThan(
    nativeSource.indexOf("function getClipboard()"),
  );
  expect(nativeSource).toContain("if (!resolved)");
  expect(textSource).toContain("const clipboard = getClipboard()");
  expect(imageSource).toContain("const clipboard = getClipboard()");
});
