import { describe, expect, test } from "bun:test";
import { parseQuery } from "./parseQuery";

/**
 * Real unit tests for the palette query parser — pure function, real inputs.
 * Covers prefix -> mode/title mapping for > / @ ?, leading-whitespace trimming,
 * residual searchText extraction, and the no-prefix default.
 */

describe("parseQuery prefixes", () => {
  test("'>' selects command mode", () => {
    expect(parseQuery(">open")).toEqual({
      prefix: ">",
      mode: "command",
      modeTitle: "Commands",
      searchText: "open",
    });
  });

  test("'/' selects workflow mode", () => {
    expect(parseQuery("/ship")).toEqual({
      prefix: "/",
      mode: "workflow",
      modeTitle: "Run workflow",
      searchText: "ship",
    });
  });

  test("'@' selects file mode", () => {
    expect(parseQuery("@readme")).toEqual({
      prefix: "@",
      mode: "file",
      modeTitle: "Open file",
      searchText: "readme",
    });
  });

  test("'?' selects ask mode", () => {
    expect(parseQuery("?why is it broken")).toEqual({
      prefix: "?",
      mode: "ask",
      modeTitle: "Ask AI",
      searchText: "why is it broken",
    });
  });
});

describe("parseQuery default + whitespace", () => {
  test("no prefix -> default mode with whole string as searchText", () => {
    expect(parseQuery("runs")).toEqual({
      prefix: null,
      mode: "default",
      modeTitle: null,
      searchText: "runs",
    });
  });

  test("leading whitespace is trimmed before detecting the prefix", () => {
    const parsed = parseQuery("   >deploy");
    expect(parsed.prefix).toBe(">");
    expect(parsed.mode).toBe("command");
    expect(parsed.searchText).toBe("deploy");
  });

  test("residual searchText after the prefix is trimmed", () => {
    expect(parseQuery(">   approve  ").searchText).toBe("approve");
  });

  test("a bare prefix yields an empty searchText", () => {
    expect(parseQuery(">").searchText).toBe("");
    expect(parseQuery(">").mode).toBe("command");
  });

  test("empty input is default mode with empty searchText", () => {
    expect(parseQuery("")).toEqual({
      prefix: null,
      mode: "default",
      modeTitle: null,
      searchText: "",
    });
  });
});
