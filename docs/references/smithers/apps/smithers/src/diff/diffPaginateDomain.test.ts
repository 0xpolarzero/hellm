import { describe, expect, test } from "bun:test";
import type { Diff, DiffFile } from "./Diff";
import { AUTH_REFACTOR_DIFF } from "./authRefactorDiff";
import {
  binaryBodyLabel,
  byteCountString,
  detectBinary,
  diffTotals,
  fileLineCount,
  fileStatus,
  groupHunks,
  initialExpanded,
  isLargeDiff,
  LARGE_BYTE_LIMIT,
  paginateHunks,
  PAGINATE_THRESHOLD,
  PAGINATE_VISIBLE,
  statusLetter,
  totalBytes,
} from "./diffPaginate";

/**
 * Pure domain tests for the diff pagination / binary / hunk-grouping helpers and
 * the rebuilt multi-file seed bundle. No DOM, no gateway — every function here
 * is deterministic and the AUTH_REFACTOR_DIFF the canvas renders is the fixture.
 */

const byPath = (path: string): DiffFile =>
  AUTH_REFACTOR_DIFF.files.find((file) => file.path === path)!;

describe("byteCountString", () => {
  test("bytes under 1KiB render with a B suffix", () => {
    expect(byteCountString(0)).toBe("0 B");
    expect(byteCountString(512)).toBe("512 B");
    expect(byteCountString(1023)).toBe("1023 B");
  });

  test("KiB range renders one decimal", () => {
    expect(byteCountString(1024)).toBe("1.0 KB");
    expect(byteCountString(18_944)).toBe("18.5 KB");
  });

  test("MiB range renders one decimal", () => {
    expect(byteCountString(1024 * 1024)).toBe("1.0 MB");
    expect(byteCountString(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("detectBinary", () => {
  test("an explicit isBinary flag wins", () => {
    const file: DiffFile = { path: "a.png", add: 0, del: 0, lines: [], isBinary: true };
    expect(detectBinary(file)).toBe(true);
  });

  test("a 'Binary files …' marker line is detected", () => {
    const file: DiffFile = {
      path: "a.png",
      add: 0,
      del: 0,
      lines: [{ kind: "context", text: "Binary files a/a.png and b/a.png differ" }],
    };
    expect(detectBinary(file)).toBe(true);
  });

  test("a 'GIT binary patch' marker line is detected", () => {
    const file: DiffFile = {
      path: "a.bin",
      add: 0,
      del: 0,
      lines: [{ kind: "context", text: "GIT binary patch" }],
    };
    expect(detectBinary(file)).toBe(true);
  });

  test("a normal text file is not binary", () => {
    expect(detectBinary(byPath("auth/session.ts"))).toBe(false);
  });

  test("the seeded png blob is detected as binary", () => {
    expect(detectBinary(byPath("auth/assets/avatar-default.png"))).toBe(true);
  });
});

describe("binaryBodyLabel", () => {
  test("includes the human size when known", () => {
    expect(binaryBodyLabel(byPath("auth/assets/avatar-default.png"))).toBe("Binary file (18.5 KB)");
  });

  test("falls back to a plain label when size is unknown", () => {
    const file: DiffFile = { path: "a.bin", add: 0, del: 0, lines: [], isBinary: true };
    expect(binaryBodyLabel(file)).toBe("Binary file");
  });
});

describe("groupHunks", () => {
  test("splits the session file into its two @@-headed hunks", () => {
    const hunks = groupHunks(byPath("auth/session.ts"));
    expect(hunks.length).toBe(2);
    expect(hunks[0]!.header.startsWith("@@ -41,5 +41,6 @@")).toBe(true);
    expect(hunks[1]!.header.startsWith("@@ -88,4 +89,5 @@")).toBe(true);
  });

  test("the header line itself is not counted among the hunk's lines", () => {
    const hunks = groupHunks(byPath("auth/token.ts"));
    expect(hunks.length).toBe(1);
    for (const line of hunks[0]!.lines) {
      expect(line.text.startsWith("@@")).toBe(false);
    }
  });

  test("lines before any header land in a synthetic empty-header hunk", () => {
    const file: DiffFile = {
      path: "x.ts",
      add: 1,
      del: 0,
      lines: [
        { kind: "context", ln: 1, lnOld: 1, text: "preamble" },
        { kind: "context", text: "@@ -2,1 +2,1 @@" },
        { kind: "add", ln: 2, text: "added" },
      ],
    };
    const hunks = groupHunks(file);
    expect(hunks.length).toBe(2);
    expect(hunks[0]!.header).toBe("");
    expect(hunks[0]!.lines.length).toBe(1);
    expect(hunks[1]!.header).toBe("@@ -2,1 +2,1 @@");
  });

  test("fileLineCount counts only the lines inside hunks, not headers", () => {
    // session.ts has 2 @@ headers and 11 non-header lines across both hunks.
    expect(fileLineCount(byPath("auth/session.ts"))).toBe(11);
  });
});

describe("paginateHunks", () => {
  // A 6-line synthetic file across two hunks to exercise the trim boundary.
  const file: DiffFile = {
    path: "big.ts",
    add: 3,
    del: 0,
    lines: [
      { kind: "context", text: "@@ -1,3 +1,3 @@" },
      { kind: "context", ln: 1, lnOld: 1, text: "a" },
      { kind: "context", ln: 2, lnOld: 2, text: "b" },
      { kind: "add", ln: 3, text: "c" },
      { kind: "context", text: "@@ -10,3 +10,3 @@" },
      { kind: "context", ln: 10, lnOld: 10, text: "d" },
      { kind: "add", ln: 11, text: "e" },
      { kind: "add", ln: 12, text: "f" },
    ],
  };

  test("returns every hunk and zero hidden when budget covers all lines", () => {
    const { hunks, hidden } = paginateHunks(file, 100);
    expect(hidden).toBe(0);
    expect(hunks.length).toBe(2);
  });

  test("drops whole trailing hunks past the budget", () => {
    // 3 lines = exactly the first hunk; the second is dropped whole.
    const { hunks, hidden } = paginateHunks(file, 3);
    expect(hunks.length).toBe(1);
    expect(hunks[0]!.lines.length).toBe(3);
    expect(hidden).toBe(3);
  });

  test("partially trims the boundary hunk", () => {
    // 4 lines = first hunk (3) + 1 line of the second.
    const { hunks, hidden } = paginateHunks(file, 4);
    expect(hunks.length).toBe(2);
    expect(hunks[1]!.lines.length).toBe(1);
    expect(hidden).toBe(2);
  });

  test("the kept-plus-hidden line totals always equal the full file", () => {
    const total = fileLineCount(file);
    for (const budget of [0, 1, 3, 4, 5, 6]) {
      const { hunks, hidden } = paginateHunks(file, budget);
      const kept = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
      expect(kept + hidden).toBe(total);
    }
  });
});

describe("status helpers", () => {
  test("fileStatus defaults to modified when unset", () => {
    const file: DiffFile = { path: "x.ts", add: 1, del: 1, lines: [] };
    expect(fileStatus(file)).toBe("modified");
  });

  test("statusLetter maps each status to its git letter", () => {
    expect(statusLetter(byPath("auth/session.ts"))).toBe("M");
    expect(statusLetter(byPath("auth/index.ts"))).toBe("A");
    expect(statusLetter(byPath("auth/legacy-session.ts"))).toBe("D");
    expect(statusLetter(byPath("auth/middleware.ts"))).toBe("R");
    expect(statusLetter({ path: "x", add: 0, del: 0, lines: [], status: "unknown" })).toBe("?");
  });
});

describe("isLargeDiff / initialExpanded", () => {
  test("the seed bundle is not a large diff", () => {
    expect(isLargeDiff(AUTH_REFACTOR_DIFF)).toBe(false);
    expect(totalBytes(AUTH_REFACTOR_DIFF)).toBeLessThan(LARGE_BYTE_LIMIT);
  });

  test("a >1MB bundle is large and seeds nothing expanded", () => {
    const big: Diff = {
      id: "big",
      title: "big",
      totalAdd: 0,
      totalDel: 0,
      files: [{ path: "blob", add: 0, del: 0, lines: [], sizeBytes: LARGE_BYTE_LIMIT + 1 }],
    };
    expect(isLargeDiff(big)).toBe(true);
    expect(initialExpanded(big)).toEqual([]);
  });

  test("a >50-file bundle is large", () => {
    const files: DiffFile[] = [];
    for (let i = 0; i < 51; i += 1) files.push({ path: `f${i}.ts`, add: 1, del: 0, lines: [] });
    const many: Diff = { id: "m", title: "m", totalAdd: 51, totalDel: 0, files };
    expect(isLargeDiff(many)).toBe(true);
  });

  test("expands the first 3 files of a 6-file bundle, collapses the rest", () => {
    expect(initialExpanded(AUTH_REFACTOR_DIFF)).toEqual([
      "auth/session.ts",
      "auth/token.ts",
      "auth/index.ts",
    ]);
  });

  test("expands every file when there are 3 or fewer", () => {
    const small: Diff = {
      id: "s",
      title: "s",
      totalAdd: 0,
      totalDel: 0,
      files: [
        { path: "a.ts", add: 1, del: 0, lines: [] },
        { path: "b.ts", add: 1, del: 0, lines: [] },
      ],
    };
    expect(initialExpanded(small)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("diffTotals", () => {
  test("sums add/del/file counts from the files (never hardcoded)", () => {
    const totals = diffTotals(AUTH_REFACTOR_DIFF);
    expect(totals.files).toBe(6);
    // 22+31+6+0+8+0 added, 8+9+2+212+3+0 deleted.
    expect(totals.add).toBe(67);
    expect(totals.del).toBe(234);
  });
});

describe("AUTH_REFACTOR_DIFF seed bundle", () => {
  test("exercises every status the rail renders", () => {
    const statuses = new Set(AUTH_REFACTOR_DIFF.files.map((file) => fileStatus(file)));
    expect(statuses.has("modified")).toBe(true);
    expect(statuses.has("added")).toBe(true);
    expect(statuses.has("deleted")).toBe(true);
    expect(statuses.has("renamed")).toBe(true);
  });

  test("includes a binary file and a renamed file with an oldPath + mode change", () => {
    const binary = AUTH_REFACTOR_DIFF.files.find((file) => detectBinary(file));
    expect(binary).toBeDefined();
    const renamed = byPath("auth/middleware.ts");
    expect(renamed.oldPath).toBe("auth/auth-mw.ts");
    expect(renamed.modeChanges?.length).toBeGreaterThan(0);
  });

  test("file paths are unique so the rail/tabs key cleanly", () => {
    const paths = AUTH_REFACTOR_DIFF.files.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("add lines carry a new-line number, del lines carry an old-line number", () => {
    for (const file of AUTH_REFACTOR_DIFF.files) {
      if (detectBinary(file)) continue;
      for (const line of file.lines) {
        if (line.text.startsWith("@@")) continue;
        if (line.kind === "add") {
          expect(typeof line.ln).toBe("number");
          expect(line.lnOld).toBeUndefined();
        }
        if (line.kind === "del") {
          expect(typeof line.lnOld).toBe("number");
          expect(line.ln).toBeUndefined();
        }
      }
    }
  });

  test("pagination constants match the Swift render budget", () => {
    expect(PAGINATE_THRESHOLD).toBe(2000);
    expect(PAGINATE_VISIBLE).toBe(1000);
  });
});
