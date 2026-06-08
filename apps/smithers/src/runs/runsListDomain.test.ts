import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FILTERS,
  distinctWorkflows,
  filterRuns,
  groupRuns,
  hasActiveFilters,
  isTerminal,
  matchesAge,
  matchesSearch,
  runDisplayName,
  runStatusTone,
  runStatusToNode,
  SEEDED_RUNS,
  shortHash,
  shortRunId,
  shouldShowProgress,
  summarizeRuns,
  type RunSummary,
} from "./runsList";

/**
 * Pure domain tests for the runs LIST surface: the seeded roster's invariants
 * plus the filter / group / summarize reducers the card and canvas lean on. No
 * DOM, no gateway, no clock.
 */

describe("shortHash / shortRunId", () => {
  test("shortHash is stable, distinct, and 8 hex chars", () => {
    expect(shortHash("runs")).toBe(shortHash("runs"));
    expect(shortHash("a")).not.toBe(shortHash("b"));
    expect(shortHash("anything")).toMatch(/^[0-9a-f]{8}$/);
  });

  test("shortRunId is the first 8 chars", () => {
    expect(shortRunId("4821a0c3deadbeef")).toBe("4821a0c3");
    expect(shortRunId("abc")).toBe("abc");
  });
});

describe("SEEDED_RUNS invariants", () => {
  test("derives an 8-hex runId and a clamped progress for every row", () => {
    for (const run of SEEDED_RUNS) {
      expect(run.runId).toMatch(/^[0-9a-f]{8}$/);
      expect(run.progress).toBeGreaterThanOrEqual(0);
      expect(run.progress).toBeLessThanOrEqual(1);
      // progress mirrors done/total
      const expected = run.totalNodes > 0 ? run.doneNodes / run.totalNodes : 0;
      expect(run.progress).toBeCloseTo(Math.min(1, Math.max(0, expected)), 6);
    }
  });

  test("runIds are unique", () => {
    const ids = new Set(SEEDED_RUNS.map((r) => r.runId));
    expect(ids.size).toBe(SEEDED_RUNS.length);
  });

  test("blockedNodeLabel only on waiting, errorText only on failed", () => {
    for (const run of SEEDED_RUNS) {
      if (run.blockedNodeLabel) expect(run.status).toBe("waiting");
      if (run.errorText) expect(run.status).toBe("failed");
    }
  });

  test("spans every status and every age bucket", () => {
    const statuses = new Set(SEEDED_RUNS.map((r) => r.status));
    expect(statuses).toEqual(new Set(["running", "waiting", "finished", "failed", "cancelled"]));
    const buckets = new Set(SEEDED_RUNS.map((r) => r.ageBucket));
    expect(buckets).toEqual(new Set(["today", "week", "month", "older"]));
  });
});

describe("matchesAge (bucket inclusion: Today ⊆ Week ⊆ Month ⊆ All)", () => {
  const at = (bucket: RunSummary["ageBucket"]): RunSummary => ({
    id: "x",
    runId: "00000000",
    workflowName: "w",
    model: "m",
    status: "finished",
    totalNodes: 1,
    doneNodes: 1,
    failedNodes: 0,
    progress: 1,
    elapsedLabel: "1s",
    ageBucket: bucket,
  });

  test("All admits every bucket", () => {
    for (const b of ["today", "week", "month", "older"] as const) {
      expect(matchesAge(at(b), "all")).toBe(true);
    }
  });

  test("Today admits only today", () => {
    expect(matchesAge(at("today"), "today")).toBe(true);
    expect(matchesAge(at("week"), "today")).toBe(false);
  });

  test("Week admits today + week, not month/older", () => {
    expect(matchesAge(at("today"), "week")).toBe(true);
    expect(matchesAge(at("week"), "week")).toBe(true);
    expect(matchesAge(at("month"), "week")).toBe(false);
    expect(matchesAge(at("older"), "week")).toBe(false);
  });

  test("Month admits today + week + month, not older", () => {
    expect(matchesAge(at("month"), "month")).toBe(true);
    expect(matchesAge(at("today"), "month")).toBe(true);
    expect(matchesAge(at("older"), "month")).toBe(false);
  });
});

describe("matchesSearch", () => {
  const run = SEEDED_RUNS[0];

  test("empty search matches everything", () => {
    expect(matchesSearch(run, "")).toBe(true);
    expect(matchesSearch(run, "   ")).toBe(true);
  });

  test("matches workflowName substring, case-insensitive", () => {
    expect(matchesSearch(run, "AUTH")).toBe(true);
    expect(matchesSearch(run, "nope")).toBe(false);
  });

  test("matches runId substring", () => {
    expect(matchesSearch(run, run.runId.slice(0, 4))).toBe(true);
  });
});

describe("filterRuns", () => {
  test("default filters pass everything", () => {
    expect(filterRuns(SEEDED_RUNS, DEFAULT_FILTERS)).toHaveLength(SEEDED_RUNS.length);
  });

  test("status filter keeps only that status", () => {
    const out = filterRuns(SEEDED_RUNS, { ...DEFAULT_FILTERS, status: "finished" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.status === "finished")).toBe(true);
  });

  test("workflow filter keeps only that workflow", () => {
    const name = SEEDED_RUNS[0].workflowName;
    const out = filterRuns(SEEDED_RUNS, { ...DEFAULT_FILTERS, workflow: name });
    expect(out.every((r) => r.workflowName === name)).toBe(true);
  });

  test("filters compose (status + age + search)", () => {
    const out = filterRuns(SEEDED_RUNS, {
      status: "running",
      workflow: "all",
      age: "today",
      search: "auth",
    });
    expect(out.every((r) => r.status === "running" && r.ageBucket === "today")).toBe(true);
  });

  test("preserves seed order", () => {
    const out = filterRuns(SEEDED_RUNS, DEFAULT_FILTERS);
    expect(out.map((r) => r.id)).toEqual(SEEDED_RUNS.map((r) => r.id));
  });
});

describe("hasActiveFilters", () => {
  test("false for the defaults", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  test("true when any filter is off-default", () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, status: "failed" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, workflow: "x" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, age: "today" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, search: " q " })).toBe(true);
  });
});

describe("distinctWorkflows", () => {
  test("de-dups case-insensitively, preserves first casing and order", () => {
    const runs: RunSummary[] = [
      { ...SEEDED_RUNS[0], workflowName: "Alpha" },
      { ...SEEDED_RUNS[1], workflowName: "alpha" },
      { ...SEEDED_RUNS[2], workflowName: "Beta" },
    ];
    expect(distinctWorkflows(runs)).toEqual(["Alpha", "Beta"]);
  });

  test("covers every seed workflow exactly once", () => {
    const names = distinctWorkflows(SEEDED_RUNS);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("groupRuns", () => {
  test("orders sections ACTIVE, COMPLETED, FAILED, CANCELLED and drops empties", () => {
    const groups = groupRuns(SEEDED_RUNS);
    expect(groups.map((g) => g.key)).toEqual(["active", "completed", "failed", "cancelled"]);
    expect(groups.map((g) => g.label)).toEqual(["ACTIVE", "COMPLETED", "FAILED", "CANCELLED"]);
  });

  test("ACTIVE bundles running + waiting", () => {
    const active = groupRuns(SEEDED_RUNS).find((g) => g.key === "active")!;
    expect(active.runs.every((r) => r.status === "running" || r.status === "waiting")).toBe(true);
  });

  test("omits a section whose group is empty", () => {
    const onlyFinished = SEEDED_RUNS.filter((r) => r.status === "finished");
    const groups = groupRuns(onlyFinished);
    expect(groups.map((g) => g.key)).toEqual(["completed"]);
  });

  test("every filtered run lands in exactly one group", () => {
    const groups = groupRuns(SEEDED_RUNS);
    const grouped = groups.reduce((n, g) => n + g.runs.length, 0);
    expect(grouped).toBe(SEEDED_RUNS.length);
  });
});

describe("summarizeRuns", () => {
  test("counts active / done / failed / cancelled and totals", () => {
    const s = summarizeRuns(SEEDED_RUNS);
    expect(s.total).toBe(SEEDED_RUNS.length);
    expect(s.active + s.done + s.failed + s.cancelled).toBe(s.total);
    expect(s.active).toBeGreaterThan(0);
    expect(s.failed).toBe(1);
    expect(s.cancelled).toBe(1);
  });
});

describe("shouldShowProgress", () => {
  test("true only for active runs with known nodes", () => {
    for (const run of SEEDED_RUNS) {
      const expected = run.totalNodes > 0 && (run.status === "running" || run.status === "waiting");
      expect(shouldShowProgress(run)).toBe(expected);
    }
  });

  test("false when totalNodes is 0", () => {
    expect(shouldShowProgress({ ...SEEDED_RUNS[0], totalNodes: 0 })).toBe(false);
  });
});

describe("status mapping", () => {
  test("runStatusToNode maps every status to a NodeStatus", () => {
    expect(runStatusToNode("running")).toBe("running");
    expect(runStatusToNode("waiting")).toBe("waiting");
    expect(runStatusToNode("finished")).toBe("ok");
    expect(runStatusToNode("failed")).toBe("failed");
    expect(runStatusToNode("cancelled")).toBe("queued");
  });

  test("runStatusTone colors by state", () => {
    expect(runStatusTone("finished")).toBe("ok");
    expect(runStatusTone("cancelled")).toBe("idle");
    expect(runStatusTone("failed")).toBe("failed");
  });
});

describe("isTerminal", () => {
  test("finished / failed / cancelled are terminal; running / waiting are not", () => {
    expect(isTerminal("finished")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("waiting")).toBe(false);
  });
});

describe("runDisplayName", () => {
  test("falls back to 'Unnamed workflow' for blank names", () => {
    expect(runDisplayName({ ...SEEDED_RUNS[0], workflowName: "  " })).toBe("Unnamed workflow");
    expect(runDisplayName(SEEDED_RUNS[0])).toBe(SEEDED_RUNS[0].workflowName);
  });
});
