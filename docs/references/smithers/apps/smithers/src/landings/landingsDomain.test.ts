import { describe, expect, test } from "bun:test";
import {
  canLand,
  createLanding,
  filterLandings,
  isTerminal,
  landLanding,
  nextLandingNumber,
  parseDiffLines,
  reviewLanding,
  SEEDED_LANDINGS,
  summarizeLandings,
  toneForLandingState,
  toneForReviewStatus,
} from "./landings";

/**
 * Pure domain tests for the landings surface: the filters, the review/land/create
 * reducers, and the diff parser the card and canvas lean on. No DOM, no store.
 */

describe("filterLandings", () => {
  test('"all" returns every landing in a new array', () => {
    const result = filterLandings(SEEDED_LANDINGS, "all");
    expect(result).toEqual(SEEDED_LANDINGS);
    expect(result).not.toBe(SEEDED_LANDINGS);
  });

  test("keeps only the matching state", () => {
    const open = filterLandings(SEEDED_LANDINGS, "open");
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((landing) => landing.state === "open")).toBe(true);
  });
});

describe("summarizeLandings", () => {
  test("counts total, open, and merged", () => {
    const summary = summarizeLandings(SEEDED_LANDINGS);
    expect(summary.total).toBe(SEEDED_LANDINGS.length);
    expect(summary.open).toBe(SEEDED_LANDINGS.filter((l) => l.state === "open").length);
    expect(summary.merged).toBe(SEEDED_LANDINGS.filter((l) => l.state === "merged").length);
  });
});

describe("tone helpers", () => {
  test("toneForLandingState maps each state", () => {
    expect(toneForLandingState("open")).toBe("tone-info");
    expect(toneForLandingState("draft")).toBe("tone-running");
    expect(toneForLandingState("merged")).toBe("tone-ok");
    expect(toneForLandingState("closed")).toBe("tone-idle");
  });

  test("toneForReviewStatus maps each status", () => {
    expect(toneForReviewStatus("approved")).toBe("tone-ok");
    expect(toneForReviewStatus("changes_requested")).toBe("tone-failed");
    expect(toneForReviewStatus("pending")).toBe("tone-idle");
  });
});

describe("canLand and isTerminal", () => {
  test("canLand is true only for open landings", () => {
    const open = SEEDED_LANDINGS.find((l) => l.state === "open")!;
    const merged = SEEDED_LANDINGS.find((l) => l.state === "merged")!;
    expect(canLand(open)).toBe(true);
    expect(canLand(merged)).toBe(false);
  });

  test("isTerminal is true for merged and closed", () => {
    expect(isTerminal("merged")).toBe(true);
    expect(isTerminal("closed")).toBe(true);
    expect(isTerminal("open")).toBe(false);
    expect(isTerminal("draft")).toBe(false);
  });
});

describe("reviewLanding", () => {
  test("approve sets reviewStatus to approved and is immutable", () => {
    const target = SEEDED_LANDINGS.find((l) => l.reviewStatus !== "approved")!;
    const next = reviewLanding(SEEDED_LANDINGS, target.number, "approve");
    expect(next).not.toBe(SEEDED_LANDINGS);
    expect(next.find((l) => l.number === target.number)!.reviewStatus).toBe("approved");
  });

  test("request_changes sets reviewStatus to changes_requested", () => {
    const target = SEEDED_LANDINGS[0];
    const next = reviewLanding(SEEDED_LANDINGS, target.number, "request_changes");
    expect(next.find((l) => l.number === target.number)!.reviewStatus).toBe("changes_requested");
  });

  test("comment leaves review statuses unchanged", () => {
    const target = SEEDED_LANDINGS[0];
    const next = reviewLanding(SEEDED_LANDINGS, target.number, "comment");
    expect(next.map((l) => l.reviewStatus)).toEqual(SEEDED_LANDINGS.map((l) => l.reviewStatus));
  });
});

describe("landLanding", () => {
  test("sets the targeted landing to merged and is immutable", () => {
    const target = SEEDED_LANDINGS.find((l) => l.state === "open")!;
    const next = landLanding(SEEDED_LANDINGS, target.number);
    expect(next).not.toBe(SEEDED_LANDINGS);
    expect(next.find((l) => l.number === target.number)!.state).toBe("merged");
  });
});

describe("nextLandingNumber", () => {
  test("is one past the current max", () => {
    const max = Math.max(...SEEDED_LANDINGS.map((l) => l.number));
    expect(nextLandingNumber(SEEDED_LANDINGS)).toBe(max + 1);
  });

  test("starts at 1 for an empty list", () => {
    expect(nextLandingNumber([])).toBe(1);
  });
});

describe("createLanding", () => {
  test("increments the number, prepends, and opens as pending", () => {
    const { landings, created } = createLanding(SEEDED_LANDINGS, {
      title: "feat: a new stack",
      description: "body",
      target: "release",
    });
    expect(created.number).toBe(nextLandingNumber(SEEDED_LANDINGS));
    expect(landings[0]).toBe(created);
    expect(landings.length).toBe(SEEDED_LANDINGS.length + 1);
    expect(created.state).toBe("open");
    expect(created.reviewStatus).toBe("pending");
    expect(created.targetBranch).toBe("release");
  });

  test("is immutable and falls back to main when target is empty", () => {
    const { landings, created } = createLanding(SEEDED_LANDINGS, {
      title: "feat: no target",
      description: "",
      target: "",
    });
    expect(landings).not.toBe(SEEDED_LANDINGS);
    expect(created.targetBranch).toBe("main");
    expect(created.diff).toBe("");
    expect(created.checks).toBe("");
  });
});

describe("parseDiffLines", () => {
  test("classifies adds, dels, and context, keeping file headers as context", () => {
    const diff = ["+++ b/file.ts", "--- a/file.ts", "@@ -1 +1 @@", "+added line", "-removed line", " kept line"].join(
      "\n",
    );
    expect(parseDiffLines(diff)).toEqual([
      { sign: " ", text: "+++ b/file.ts" },
      { sign: " ", text: "--- a/file.ts" },
      { sign: " ", text: "@@ -1 +1 @@" },
      { sign: "+", text: "added line" },
      { sign: "-", text: "removed line" },
      { sign: " ", text: " kept line" },
    ]);
  });
});
