import { describe, expect, test } from "bun:test";
import {
  closeIssue,
  createIssue,
  filterIssues,
  nextIssueNumber,
  reopenIssue,
  SEEDED_ISSUES,
  summarizeIssues,
  toneForIssueState,
} from "./issues";

/**
 * Pure domain tests for the issues surface: the filter, summary, and the
 * create/close/reopen reducers the card and canvas lean on. No DOM, no store.
 */

describe("filterIssues", () => {
  test("open keeps only open issues", () => {
    const open = filterIssues(SEEDED_ISSUES, "open");
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((i) => i.state === "open")).toBe(true);
  });

  test("closed keeps only closed issues", () => {
    const closed = filterIssues(SEEDED_ISSUES, "closed");
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((i) => i.state === "closed")).toBe(true);
  });

  test("all keeps every issue and is a fresh array", () => {
    const all = filterIssues(SEEDED_ISSUES, "all");
    expect(all).toEqual(SEEDED_ISSUES);
    expect(all).not.toBe(SEEDED_ISSUES);
  });
});

describe("summarizeIssues", () => {
  test("open + closed equals total", () => {
    const s = summarizeIssues(SEEDED_ISSUES);
    expect(s.total).toBe(SEEDED_ISSUES.length);
    expect(s.open + s.closed).toBe(s.total);
    expect(s.open).toBeGreaterThan(0);
    expect(s.closed).toBeGreaterThan(0);
  });
});

describe("toneForIssueState", () => {
  test("open is ok, closed is idle", () => {
    expect(toneForIssueState("open")).toBe("tone-ok");
    expect(toneForIssueState("closed")).toBe("tone-idle");
  });
});

describe("nextIssueNumber", () => {
  test("is max + 1 over the seeded issues", () => {
    const max = Math.max(...SEEDED_ISSUES.map((i) => i.number));
    expect(nextIssueNumber(SEEDED_ISSUES)).toBe(max + 1);
  });

  test("is 1 for an empty list", () => {
    expect(nextIssueNumber([])).toBe(1);
  });
});

describe("createIssue", () => {
  test("prepends a new OPEN issue with an incremented number", () => {
    const { issues, created } = createIssue(SEEDED_ISSUES, { title: "New thing", body: "details" });
    expect(created.number).toBe(nextIssueNumber(SEEDED_ISSUES));
    expect(created.id).toBe(`issue-${created.number}`);
    expect(created.state).toBe("open");
    expect(created.labels).toEqual([]);
    expect(created.assignees).toEqual([]);
    expect(created.commentCount).toBe(0);
    expect(issues[0]).toBe(created);
    expect(issues.length).toBe(SEEDED_ISSUES.length + 1);
  });

  test("does not mutate the input list", () => {
    const before = SEEDED_ISSUES.length;
    createIssue(SEEDED_ISSUES, { title: "x", body: "" });
    expect(SEEDED_ISSUES.length).toBe(before);
  });
});

describe("closeIssue and reopenIssue", () => {
  test("closeIssue flips one open issue to closed, immutably", () => {
    const target = SEEDED_ISSUES.find((i) => i.state === "open")!;
    const next = closeIssue(SEEDED_ISSUES, target.number);
    expect(next).not.toBe(SEEDED_ISSUES);
    expect(next.find((i) => i.number === target.number)!.state).toBe("closed");
    expect(SEEDED_ISSUES.find((i) => i.number === target.number)!.state).toBe("open");
  });

  test("reopenIssue flips one closed issue to open, immutably", () => {
    const target = SEEDED_ISSUES.find((i) => i.state === "closed")!;
    const next = reopenIssue(SEEDED_ISSUES, target.number);
    expect(next).not.toBe(SEEDED_ISSUES);
    expect(next.find((i) => i.number === target.number)!.state).toBe("open");
    expect(SEEDED_ISSUES.find((i) => i.number === target.number)!.state).toBe("closed");
  });

  test("close then reopen round-trips back to open", () => {
    const target = SEEDED_ISSUES.find((i) => i.state === "open")!;
    const closed = closeIssue(SEEDED_ISSUES, target.number);
    const reopened = reopenIssue(closed, target.number);
    expect(reopened.find((i) => i.number === target.number)!.state).toBe("open");
  });
});
