import { describe, expect, test } from "bun:test";
import {
  cacheHitPercent,
  costPerRun,
  EM_DASH,
  formatScore,
  formatUsd,
  humanizeDurationMs,
  humanizeTokens,
  mean,
  metricsForRun,
  normalizeRunId,
  resolveActiveRunId,
  runLabel,
  RUN_METRICS,
  SCORES_RUNS,
  scorerAggregates,
  scoreTone,
  summaryStats,
  truncateMiddle,
  type ScoreRow,
} from "./scoreReport";

/**
 * Pure domain tests for the scores surface: the formatters, the active-run
 * resolver, the per-scorer aggregates, and the Summary roll-up. No DOM, no
 * gateway — every input is deterministic seed data.
 */

describe("normalizeRunId", () => {
  test("trims and nulls empty/whitespace ids", () => {
    expect(normalizeRunId(null)).toBeNull();
    expect(normalizeRunId(undefined)).toBeNull();
    expect(normalizeRunId("")).toBeNull();
    expect(normalizeRunId("   ")).toBeNull();
    expect(normalizeRunId("  run-1  ")).toBe("run-1");
  });
});

describe("resolveActiveRunId", () => {
  test("keeps a stored id that names a run in the list", () => {
    expect(resolveActiveRunId(SCORES_RUNS, "run-2b8e4d10")).toBe("run-2b8e4d10");
  });

  test("falls back to the first run when the selection is missing or unknown", () => {
    expect(resolveActiveRunId(SCORES_RUNS, null)).toBe(SCORES_RUNS[0].runId);
    expect(resolveActiveRunId(SCORES_RUNS, "  ")).toBe(SCORES_RUNS[0].runId);
    expect(resolveActiveRunId(SCORES_RUNS, "run-does-not-exist")).toBe(SCORES_RUNS[0].runId);
  });

  test("returns null for an empty run list", () => {
    expect(resolveActiveRunId([], "anything")).toBeNull();
  });
});

describe("scoreTone", () => {
  test("bands by the 3-band scale and faints non-finite", () => {
    expect(scoreTone(0.92)).toBe("tone-ok");
    expect(scoreTone(0.8)).toBe("tone-ok");
    expect(scoreTone(0.74)).toBe("tone-warn");
    expect(scoreTone(0.5)).toBe("tone-warn");
    expect(scoreTone(0.21)).toBe("tone-fail");
    expect(scoreTone(Number.NaN)).toBe("tone-faint");
    expect(scoreTone(Number.POSITIVE_INFINITY)).toBe("tone-faint");
  });
});

describe("humanizeTokens", () => {
  test("M/K/raw banding", () => {
    expect(humanizeTokens(1_242_880)).toBe("1.24M");
    expect(humanizeTokens(318_400)).toBe("318.4K");
    expect(humanizeTokens(1_000)).toBe("1.0K");
    expect(humanizeTokens(940)).toBe("940");
    expect(humanizeTokens(0)).toBe("0");
    expect(humanizeTokens(Number.NaN)).toBe(EM_DASH);
  });
});

describe("humanizeDurationMs", () => {
  test("m/s/ms banding", () => {
    expect(humanizeDurationMs(72_000)).toBe("1.2m");
    expect(humanizeDurationMs(4_120)).toBe("4.12s");
    expect(humanizeDurationMs(1_000)).toBe("1.00s");
    expect(humanizeDurationMs(612)).toBe("612ms");
    expect(humanizeDurationMs(0)).toBe("0ms");
    expect(humanizeDurationMs(Number.NaN)).toBe(EM_DASH);
  });
});

describe("formatUsd", () => {
  test("fixed-precision USD with default 6 digits", () => {
    expect(formatUsd(0.7412)).toBe("$0.741200");
    expect(formatUsd(0.7412, 4)).toBe("$0.7412");
    expect(formatUsd(0)).toBe("$0.000000");
    expect(formatUsd(Number.NaN)).toBe(EM_DASH);
  });
});

describe("mean", () => {
  test("averages a list, null when empty", () => {
    expect(mean([0.2, 0.4, 0.6])).toBeCloseTo(0.4, 10);
    expect(mean([])).toBeNull();
  });
});

describe("formatScore", () => {
  test("2 decimals, em-dash for null/non-finite", () => {
    expect(formatScore(0.9)).toBe("0.90");
    expect(formatScore(null)).toBe(EM_DASH);
    expect(formatScore(Number.NaN)).toBe(EM_DASH);
  });
});

describe("truncateMiddle", () => {
  test("ellipsizes only when longer than the cap", () => {
    expect(truncateMiddle("2026-06-05", 30)).toBe("2026-06-05");
    expect(truncateMiddle("a".repeat(40), 9)).toContain("…");
    expect(truncateMiddle("a".repeat(40), 9).length).toBe(9);
  });
});

describe("runLabel", () => {
  test("workflow · status · short8 for named runs", () => {
    expect(runLabel(SCORES_RUNS[0])).toBe("review-suite · completed · 7a3f9c21");
  });

  test("falls back to 'Run <8>' when the workflow name is null", () => {
    const anon = SCORES_RUNS.find((run) => run.workflowName == null)!;
    expect(runLabel(anon)).toBe("Run c4f10a99");
  });
});

describe("scorerAggregates", () => {
  test("groups by scorer in first-seen order with mean/min/max/p50", () => {
    const rows: ScoreRow[] = [
      { scorer: "a", score: 0.4, scoredAt: "t1" },
      { scorer: "b", score: 0.9, scoredAt: "t2" },
      { scorer: "a", score: 0.8, scoredAt: "t3" },
      { scorer: "a", score: 0.6, scoredAt: "t4" },
    ];
    const aggregates = scorerAggregates(rows);
    expect(aggregates.map((a) => a.scorer)).toEqual(["a", "b"]);
    const a = aggregates[0];
    expect(a.count).toBe(3);
    expect(a.min).toBe(0.4);
    expect(a.max).toBe(0.8);
    expect(a.mean).toBeCloseTo(0.6, 10);
    expect(a.p50).toBe(0.6);
  });

  test("empty input yields no aggregates", () => {
    expect(scorerAggregates([])).toEqual([]);
  });
});

describe("summaryStats", () => {
  test("derives the six tiles for the fully-populated default run", () => {
    const stats = summaryStats(RUN_METRICS["run-7a3f9c21"]);
    expect(stats.evaluations).toBe(7);
    expect(stats.tokens).toBe("1.24M");
    expect(stats.avgDuration).toBe("4.12s");
    expect(stats.estCost).toBe("$0.7412");
    expect(stats.cacheHitRate).toMatch(/%$/);
    expect(stats.mean).not.toBe(EM_DASH);
  });

  test("em-dashes unavailable metrics for the failed run", () => {
    const stats = summaryStats(RUN_METRICS["run-c4f10a99"]);
    expect(stats.evaluations).toBe(1);
    expect(stats.tokens).toBe(EM_DASH);
    expect(stats.avgDuration).toBe(EM_DASH);
    expect(stats.cacheHitRate).toBe(EM_DASH);
    expect(stats.estCost).toBe(EM_DASH);
  });
});

describe("cacheHitPercent", () => {
  test("null when no cache data; a percent otherwise", () => {
    expect(cacheHitPercent(RUN_METRICS["run-2b8e4d10"].tokens)).toBeNull();
    expect(cacheHitPercent(RUN_METRICS["run-7a3f9c21"].tokens)).toBeGreaterThan(0);
  });
});

describe("costPerRun", () => {
  test("total / runCount, null when runCount is 0", () => {
    const cost = RUN_METRICS["run-7a3f9c21"].cost;
    expect(costPerRun(cost)).toBeCloseTo(cost.total / cost.runCount, 10);
    expect(costPerRun(RUN_METRICS["run-2b8e4d10"].cost)).toBeNull();
  });
});

describe("metricsForRun", () => {
  test("returns seeded metrics for a known run", () => {
    expect(metricsForRun("run-7a3f9c21")).toBe(RUN_METRICS["run-7a3f9c21"]);
  });

  test("returns an all-empty block for null/unknown runs", () => {
    const empty = metricsForRun(null);
    expect(empty.scores).toEqual([]);
    expect(empty.tokens.total).toBe(0);
    expect(empty.latency.count).toBe(0);
    expect(empty.cost.runCount).toBe(0);
    expect(metricsForRun("nope").scores).toEqual([]);
  });
});
