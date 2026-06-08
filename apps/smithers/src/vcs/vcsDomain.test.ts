import { describe, expect, test } from "bun:test";
import {
  applyCommit,
  parseGitStatus,
  SEEDED_GIT_TREE,
  shortHash,
  stageAll,
  summarize,
  toggleStaged,
  unstageAll,
  type WorkingTree,
} from "./vcs";

/**
 * Pure domain tests for the VCS surface: the porcelain parser and the
 * staging/commit reducers the card and canvas lean on. No DOM, no gateway.
 */

describe("parseGitStatus", () => {
  test("maps porcelain XY codes to staged/unstaged changes", () => {
    const porcelain = ["A  src/new.ts", " M src/edit.ts", "?? src/scratch.md", "D  src/gone.ts"].join("\n");
    const changes = parseGitStatus(porcelain);
    expect(changes).toEqual([
      { path: "src/new.ts", status: "added", staged: true, add: 0, del: 0 },
      { path: "src/edit.ts", status: "modified", staged: false, add: 0, del: 0 },
      { path: "src/scratch.md", status: "untracked", staged: false, add: 0, del: 0 },
      { path: "src/gone.ts", status: "deleted", staged: true, add: 0, del: 0 },
    ]);
  });

  test("uses the post-arrow path for renames", () => {
    const [rename] = parseGitStatus("R  old/name.ts -> new/name.ts");
    expect(rename.status).toBe("renamed");
    expect(rename.path).toBe("new/name.ts");
    expect(rename.staged).toBe(true);
  });

  test("skips blank and truncated lines", () => {
    expect(parseGitStatus("\n\nx")).toEqual([]);
  });
});

describe("summarize", () => {
  test("counts staged, unstaged, untracked and line deltas", () => {
    const s = summarize(SEEDED_GIT_TREE);
    expect(s.total).toBe(SEEDED_GIT_TREE.changes.length);
    expect(s.staged + s.unstaged + s.untracked).toBe(s.total);
    expect(s.untracked).toBe(1);
    expect(s.add).toBeGreaterThan(0);
  });
});

describe("staging reducers", () => {
  test("toggleStaged flips exactly one path and is immutable", () => {
    const target = SEEDED_GIT_TREE.changes.find((c) => !c.staged)!;
    const next = toggleStaged(SEEDED_GIT_TREE, target.path);
    expect(next).not.toBe(SEEDED_GIT_TREE);
    expect(next.changes.find((c) => c.path === target.path)!.staged).toBe(true);
    const others = next.changes.filter((c) => c.path !== target.path);
    for (const c of others) {
      expect(c.staged).toBe(SEEDED_GIT_TREE.changes.find((o) => o.path === c.path)!.staged);
    }
  });

  test("stageAll then unstageAll round-trips the staged flags", () => {
    expect(stageAll(SEEDED_GIT_TREE).changes.every((c) => c.staged)).toBe(true);
    expect(unstageAll(SEEDED_GIT_TREE).changes.every((c) => !c.staged)).toBe(true);
  });
});

describe("applyCommit", () => {
  test("drops staged tracked changes and advances head + current bookmark", () => {
    const before = summarize(SEEDED_GIT_TREE);
    const after = applyCommit(SEEDED_GIT_TREE);
    const afterSummary = summarize(after);
    expect(afterSummary.staged).toBe(0);
    expect(afterSummary.total).toBe(before.total - before.staged);
    expect(after.head).not.toBe(SEEDED_GIT_TREE.head);
    expect(after.head).toHaveLength(8);
    const current = after.bookmarks.find((b) => b.current)!;
    const wasCurrent = SEEDED_GIT_TREE.bookmarks.find((b) => b.current)!;
    expect(current.ahead).toBe(wasCurrent.ahead + 1);
    expect(current.ref).toBe(after.head);
  });

  test("keeps untracked files and is a no-op with nothing staged", () => {
    const after = applyCommit(SEEDED_GIT_TREE);
    expect(after.changes.some((c) => c.status === "untracked")).toBe(true);
    const clean: WorkingTree = { ...SEEDED_GIT_TREE, changes: unstageAll(SEEDED_GIT_TREE).changes };
    expect(applyCommit(clean)).toBe(clean);
  });

  test("head id is deterministic for the same tree", () => {
    expect(applyCommit(SEEDED_GIT_TREE).head).toBe(applyCommit(SEEDED_GIT_TREE).head);
  });
});

describe("shortHash", () => {
  test("is stable and hex", () => {
    expect(shortHash("vcs")).toBe(shortHash("vcs"));
    expect(shortHash("a")).not.toBe(shortHash("b"));
    expect(shortHash("anything")).toMatch(/^[0-9a-f]{8}$/);
  });
});
