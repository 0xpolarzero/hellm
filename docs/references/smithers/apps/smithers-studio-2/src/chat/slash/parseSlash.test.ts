import { describe, expect, test } from "bun:test";
import { parseSlash } from "./parseSlash";

describe("parseSlash", () => {
  test("returns null for non-slash input", () => {
    expect(parseSlash("hello there")).toBeNull();
    expect(parseSlash("")).toBeNull();
  });

  test("parses a bare command", () => {
    expect(parseSlash("/runs")).toEqual({ name: "runs", args: "" });
  });

  test("lowercases the command and keeps args verbatim", () => {
    expect(parseSlash("/PR 42")).toEqual({ name: "pr", args: "42" });
    expect(parseSlash("/web https://Example.com/Path")).toEqual({
      name: "web",
      args: "https://Example.com/Path",
    });
  });

  test("trims leading whitespace and arg whitespace", () => {
    expect(parseSlash("   /workflow   deploy app  ")).toEqual({ name: "workflow", args: "deploy app" });
  });

  test("bare slash is an empty name (matches everything in autocomplete)", () => {
    expect(parseSlash("/")).toEqual({ name: "", args: "" });
  });
});
