import { describe, expect, test } from "bun:test";
import {
  buildResults,
  fileName,
  fuzzyMatch,
  fuzzyScore,
  modeLabel,
  PALETTE_COMMANDS,
  parseQuery,
  PROJECTS,
  RECENT_PATHS,
  rankFiles,
  recentFiles,
  sections,
  sigilForMode,
  SLASH_COMMANDS,
  WORKSPACE_FILES,
  type FileEntry,
  type ResultInputs,
} from "./palette";

/**
 * Pure domain tests for the command palette. The fuzzy scorer and the query
 * parser are the load-bearing pieces (ranking + mode selection), so they are
 * exercised exhaustively. No DOM, no store, no gateway.
 */

describe("parseQuery", () => {
  test("no sigil is open-anything with the whole string as search text", () => {
    expect(parseQuery("canvas")).toEqual({ mode: "open", sigil: "", searchText: "canvas" });
  });

  test("each sigil maps to its mode and strips itself from the search text", () => {
    expect(parseQuery("@vcs")).toEqual({ mode: "files", sigil: "@", searchText: "vcs" });
    expect(parseQuery(">new")).toEqual({ mode: "commands", sigil: ">", searchText: "new" });
    expect(parseQuery("/diff")).toEqual({ mode: "slash", sigil: "/", searchText: "diff" });
    expect(parseQuery("?why")).toEqual({ mode: "ask", sigil: "?", searchText: "why" });
    expect(parseQuery("#42")).toEqual({ mode: "work", sigil: "#", searchText: "42" });
  });

  test("strips leading whitespace before reading the sigil", () => {
    expect(parseQuery("   @  store ")).toEqual({ mode: "files", sigil: "@", searchText: "store" });
  });

  test("a bare sigil yields an empty search text", () => {
    expect(parseQuery("@")).toEqual({ mode: "files", sigil: "@", searchText: "" });
    expect(parseQuery("?")).toEqual({ mode: "ask", sigil: "?", searchText: "" });
  });

  test("an empty query is open-anything with no search text", () => {
    expect(parseQuery("")).toEqual({ mode: "open", sigil: "", searchText: "" });
  });

  test("sigilForMode and modeLabel round-trip every mode", () => {
    expect(sigilForMode("files")).toBe("@");
    expect(sigilForMode("commands")).toBe(">");
    expect(sigilForMode("slash")).toBe("/");
    expect(sigilForMode("ask")).toBe("?");
    expect(sigilForMode("work")).toBe("#");
    expect(sigilForMode("open")).toBe("");
    expect(modeLabel("open")).toBe("Open Anything");
    expect(modeLabel("files")).toBe("Files");
  });
});

describe("fuzzyScore — the load-bearing ranker", () => {
  test("returns -1 when not every query char is present in order", () => {
    expect(fuzzyScore("xyz", "abc")).toBe(-1);
    // Right chars, wrong order: 'b' before 'a' is not a subsequence.
    expect(fuzzyScore("ba", "abc")).toBe(-1);
  });

  test("an empty query is a trivial match at score 0", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyMatch("", "anything").matches).toEqual([]);
  });

  test("consecutive matches (+3 each) beat scattered ones", () => {
    // 'ab' is consecutive at the start of 'abxy' but scattered in 'axby'.
    expect(fuzzyScore("ab", "abxy")).toBeGreaterThan(fuzzyScore("ab", "axxxxxxxxxxb"));
  });

  test("word-boundary matches (+2) beat mid-word matches (+1)", () => {
    // 's' after '/' is a boundary in 'a/store'; mid-word in 'asstore'.
    const boundary = fuzzyScore("s", "a/store");
    const midword = fuzzyScore("s", "axstore");
    expect(boundary).toBeGreaterThan(midword);
  });

  test("dot, underscore and dash all count as word boundaries", () => {
    expect(fuzzyScore("t", "a.ts")).toBeGreaterThan(fuzzyScore("t", "axts"));
    expect(fuzzyScore("n", "a_name")).toBeGreaterThan(fuzzyScore("n", "axname"));
    expect(fuzzyScore("p", "a-path")).toBeGreaterThan(fuzzyScore("p", "axpath"));
  });

  test("a match at index 0 counts as a boundary", () => {
    // Leading char is always a boundary (+2), so 'a' in 'abc' scores above a
    // bare mid-word hit would; just assert it exceeds the plain +1 case.
    expect(fuzzyScore("a", "abc")).toBeGreaterThan(fuzzyScore("a", "xax"));
  });

  test("matching is case-insensitive", () => {
    expect(fuzzyScore("CANVAS", "VcsCanvas.tsx")).toBeGreaterThan(-1);
    expect(fuzzyScore("canvas", "VcsCanvas.tsx")).toBe(fuzzyScore("CANVAS", "vcscanvas.tsx"));
  });

  test("shorter targets get a tie-breaking bonus for the same matches", () => {
    expect(fuzzyScore("ab", "ab")).toBeGreaterThan(fuzzyScore("ab", "ab-with-a-long-suffix-here"));
  });

  test("returns the matched target indices for highlighting", () => {
    const { matches } = fuzzyMatch("vcs", "VcsCanvas.tsx");
    expect(matches).toEqual([0, 1, 2]);
  });
});

describe("fileName", () => {
  test("returns the last path component", () => {
    expect(fileName("apps/smithers/src/vcs/VcsCanvas.tsx")).toBe("VcsCanvas.tsx");
    expect(fileName("README.md")).toBe("README.md");
  });
});

describe("rankFiles", () => {
  test("sorts by descending score and excludes non-matches", () => {
    const ranked = rankFiles("vcs", WORKSPACE_FILES, 20);
    expect(ranked.length).toBeGreaterThan(0);
    // every result actually contains the query subsequence
    for (const item of ranked) {
      expect(fuzzyScore("vcs", item.value) >= 0 || fuzzyScore("vcs", item.title) >= 0).toBe(true);
    }
    // VcsCanvas / vcsStore / vcs.ts should outrank an unrelated path; the top hit
    // is one of the vcs files.
    expect(ranked[0].value.includes("vcs")).toBe(true);
  });

  test("respects the limit", () => {
    const files: FileEntry[] = Array.from({ length: 50 }, (_, i) => ({ path: `a/file${i}.ts` }));
    expect(rankFiles("file", files, 20)).toHaveLength(20);
  });

  test("ties break by shorter path then lexicographic", () => {
    // 'a.ts' and 'b.ts' share a length, so 'a' precedes 'b' lexicographically;
    // the longer path sinks below both via the shorter-target bonus.
    const files: FileEntry[] = [{ path: "zzz/longer.ts" }, { path: "b.ts" }, { path: "a.ts" }];
    const ranked = rankFiles("ts", files, 20);
    expect(ranked.map((r) => r.value)).toEqual(["a.ts", "b.ts", "zzz/longer.ts"]);
  });

  test("carries title and subtitle match positions", () => {
    const [top] = rankFiles("vcsstore", WORKSPACE_FILES, 20);
    expect(top.value).toBe("apps/smithers/src/vcs/vcsStore.ts");
    expect(top.subtitleMatches.length).toBeGreaterThan(0);
  });
});

describe("recentFiles", () => {
  test("returns the seeded recency order, filtered to known files", () => {
    const items = recentFiles(RECENT_PATHS, WORKSPACE_FILES);
    expect(items.map((i) => i.value)).toEqual(RECENT_PATHS);
    expect(items.every((i) => i.section === "recent")).toBe(true);
  });

  test("drops paths not present in the file list", () => {
    const items = recentFiles(["does/not/exist.ts", "README.md"], WORKSPACE_FILES);
    expect(items.map((i) => i.value)).toEqual(["README.md"]);
  });
});

function inputs(): ResultInputs {
  return {
    files: WORKSPACE_FILES,
    recentPaths: RECENT_PATHS,
    workspaces: PROJECTS,
    commands: PALETTE_COMMANDS,
    slashCommands: SLASH_COMMANDS,
  };
}

describe("buildResults", () => {
  test("files mode with no query shows the recent list", () => {
    const items = buildResults(parseQuery("@"), inputs());
    expect(items.map((i) => i.value)).toEqual(RECENT_PATHS);
    expect(items.every((i) => i.section === "recent")).toBe(true);
  });

  test("files mode with a query fuzzy-ranks files in the files section", () => {
    const items = buildResults(parseQuery("@canvas"), inputs());
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.section === "files" && i.kind === "file")).toBe(true);
  });

  test("slash mode fuzzy-filters the known slash commands", () => {
    const items = buildResults(parseQuery("/dif"), inputs());
    expect(items.some((i) => i.value === "diff")).toBe(true);
    expect(items.every((i) => i.kind === "slash")).toBe(true);
  });

  test("commands mode substring-filters the catalog", () => {
    const items = buildResults(parseQuery(">search"), inputs());
    expect(items.map((i) => i.value)).toContain("global-search");
  });

  test("ask mode always yields a single ask row, disabled when empty", () => {
    expect(buildResults(parseQuery("?"), inputs())).toEqual([
      expect.objectContaining({ kind: "ask", disabled: true }),
    ]);
    const [row] = buildResults(parseQuery("?why is it slow"), inputs());
    expect(row.kind).toBe("ask");
    expect(row.disabled).toBe(false);
    expect(row.value).toBe("why is it slow");
  });

  test("open-anything blends files, workspaces, and commands", () => {
    const items = buildResults(parseQuery(""), inputs());
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has("file")).toBe(true);
    expect(kinds.has("workspace")).toBe(true);
    expect(kinds.has("command")).toBe(true);
  });

  test("the active workspace is rendered disabled", () => {
    const items = buildResults(parseQuery(""), inputs());
    const active = items.find((i) => i.kind === "workspace" && i.value === "Smithers Web");
    expect(active?.disabled).toBe(true);
    const other = items.find((i) => i.kind === "workspace" && i.value === "Personal");
    expect(other?.disabled).toBe(false);
  });
});

describe("sections grouper", () => {
  test("emits a header only when the section changes", () => {
    const items = buildResults(parseQuery(""), inputs());
    const grouped = sections(items);
    // headers are unique and in first-seen order
    const labels = grouped.map((g) => g.section);
    expect(new Set(labels).size).toBe(labels.length);
    // the flat index is preserved across groups
    const flat = grouped.flatMap((g) => g.items.map((entry) => entry.index));
    expect(flat).toEqual(items.map((_, i) => i));
  });

  test("an empty list groups to nothing", () => {
    expect(sections([])).toEqual([]);
  });
});
