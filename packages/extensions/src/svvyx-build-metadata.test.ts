import { describe, expect, it } from "bun:test";

import { APP_NATIVE_SVVYX_METADATA } from "./svvyx-build-metadata";

describe("app-native svvyx metadata", () => {
  it("advertises the supported Extension Managing command surface only", () => {
    const commands = APP_NATIVE_SVVYX_METADATA.get(
      "extension-managing",
    )!.commandManifest.commands.map(({ name }) => name);
    expect(commands).toContain("set-usage");
    expect(commands).not.toContain("defaults");
  });
});
