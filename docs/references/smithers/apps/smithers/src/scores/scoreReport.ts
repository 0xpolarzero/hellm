/**
 * The scores surface: scorer/eval results for a run, plus the token, latency and
 * cost metrics the `smithers scores` view rolls up. Ported from the Swift
 * ScoresView (run selector + Summary/Metrics/Recent tabs). Seeded with a
 * believable demo over three runs like the other feature cards (apps/smithers has
 * no gateway yet); the per-run metrics map is keyed by runId so swapping the
 * selected run swaps every tab together.
 *
 * Everything below the seed data is pure (scoreTone, humanize*, formatUsd, mean,
 * resolveActiveRunId, normalizeRunId, and the aggregate roll-ups), so the
 * formatters and selectors are unit-tested without a DOM (see
 * scoresDomain.test.ts).
 *
 * The legacy ScoreReport / SCORE_REPORTS / findReport below stay as-is so the
 * existing inline ScoresCard keeps rendering its compact scorecard.
 */

/** An eval/score report, shown as a compact scorecard. */
export type ScoreTile = { name: string; value: string };

export type ScoreReport = {
  id: string;
  suite: string;
  delta: string;
  tiles: ScoreTile[];
  /** Trend bars, 0..1. */
  trend: number[];
};

export const SCORE_REPORTS: Record<string, ScoreReport> = {
  "review-suite": {
    id: "review-suite",
    suite: "review-suite",
    delta: "+0.06",
    tiles: [
      { name: "evals", value: "24" },
      { name: "mean", value: "0.82" },
      { name: "tokens", value: "1.2M" },
      { name: "p95", value: "8.3s" },
      { name: "cost", value: "$0.74" },
    ],
    trend: [0.4, 0.55, 0.48, 0.7, 0.62, 0.8, 0.74, 0.88],
  },
};

export function findReport(id: string): ScoreReport | undefined {
  return SCORE_REPORTS[id];
}

// ---------------------------------------------------------------------------
// Canvas domain: runs, scores, and per-run metrics keyed by runId.
// ---------------------------------------------------------------------------

export type RunStatus = "completed" | "running" | "failed";

/** A run the score selector lists. `workflowName` is null when the run is anonymous. */
export type ScoresRun = {
  runId: string;
  workflowName: string | null;
  status: RunStatus;
};

/** One scorer's verdict on one eval, newest-first in the seed. */
export type ScoreRow = {
  scorer: string;
  score: number;
  reason?: string;
  /** Fixed display timestamp (no wall-clock); rendered verbatim. */
  scoredAt: string;
};

/** One labeled bucket in a byPeriod table (token/cost breakdowns). */
export type TokenPeriod = { period: string; input: number; output: number };
export type CostPeriod = { period: string; total: number; runs: number };

/** Token usage for a run; cache fields are absent when the provider reports none. */
export type TokenReport = {
  total: number;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  byPeriod: TokenPeriod[];
};

/** Per-node latency stats (ms); count 0 means no latency data. */
export type LatencyReport = {
  count: number;
  mean: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
};

/** Cost roll-up (USD); runCount 0 means no per-run breakdown. */
export type CostReport = {
  total: number;
  input: number;
  output: number;
  runCount: number;
  byPeriod: CostPeriod[];
};

/** Everything the three tabs render for one run, all keyed off the same runId. */
export type RunMetrics = {
  scores: ScoreRow[];
  tokens: TokenReport;
  latency: LatencyReport;
  cost: CostReport;
};

/** Per-scorer aggregate, computed from a run's ScoreRows for the Summary tab. */
export type ScorerAggregate = {
  scorer: string;
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
};

/** The six Summary-tab tiles, each already humanized or em-dashed. */
export type SummaryStats = {
  evaluations: number;
  mean: string;
  tokens: string;
  avgDuration: string;
  cacheHitRate: string;
  estCost: string;
};

/** Em-dash placeholder for any metric that is unavailable. */
export const EM_DASH = "—";

// ---- Pure formatters -------------------------------------------------------

/**
 * Trim and null out an empty/whitespace run id so resolveActiveRunId can fall
 * back to the first run cleanly.
 */
export function normalizeRunId(id: string | null | undefined): string | null {
  if (id == null) return null;
  const trimmed = id.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Pick the active run id: the stored selection when it names a run in the list,
 * otherwise the first run, otherwise null (empty list). Mirrors the Swift
 * resolveActiveRunId.
 */
export function resolveActiveRunId(runs: ScoresRun[], selectedRunId: string | null): string | null {
  const normalized = normalizeRunId(selectedRunId);
  if (normalized != null && runs.some((run) => run.runId === normalized)) return normalized;
  return runs.length > 0 ? runs[0].runId : null;
}

/**
 * The score color band: >= 0.8 reads as success, >= 0.5 as warning, lower as
 * danger; non-finite scores are faint. Returns a tone class name so the cells,
 * the recent dots, and the aggregate values all share one rule.
 */
export function scoreTone(score: number): "tone-ok" | "tone-warn" | "tone-fail" | "tone-faint" {
  if (!Number.isFinite(score)) return "tone-faint";
  if (score >= 0.8) return "tone-ok";
  if (score >= 0.5) return "tone-warn";
  return "tone-fail";
}

/** Humanize a token count: >= 1e6 -> 'X.XXM', >= 1e3 -> 'X.XK', else the raw int. */
export function humanizeTokens(tokens: number): string {
  if (!Number.isFinite(tokens)) return EM_DASH;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(Math.round(tokens));
}

/** Humanize a duration in ms: >= 60000 -> 'X.Xm', >= 1000 -> 'X.XXs', else 'Xms'. */
export function humanizeDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return EM_DASH;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

/** Format a USD amount to a fixed precision (default 6 for the metric rows). */
export function formatUsd(amount: number, fractionDigits = 6): string {
  if (!Number.isFinite(amount)) return EM_DASH;
  return `$${amount.toFixed(fractionDigits)}`;
}

/** Arithmetic mean of a numeric list, or null when empty. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** A 2-decimal score string, em-dash for null/non-finite. */
export function formatScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return EM_DASH;
  return score.toFixed(2);
}

/** Truncate a long label to maxLen with a trailing ellipsis (for period cells). */
export function truncateMiddle(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  if (maxLen <= 1) return text.slice(0, maxLen);
  const head = Math.ceil((maxLen - 1) / 2);
  const tail = Math.floor((maxLen - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** The first 8 chars of a run id, the short form the selector and rows show. */
export function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

/** Strip a leading 'run-' so the fallback label reads 'Run c4f10a99'. */
function runIdTail(runId: string): string {
  return runId.startsWith("run-") ? runId.slice(4) : runId;
}

/** The selector option label: 'workflow · status · short8', or 'Run <8>' anonymous. */
export function runLabel(run: ScoresRun): string {
  if (run.workflowName == null || run.workflowName.trim() === "") {
    return `Run ${shortRunId(runIdTail(run.runId))}`;
  }
  return `${run.workflowName} · ${run.status} · ${shortRunId(runIdTail(run.runId))}`;
}

// ---- Pure aggregations -----------------------------------------------------

/** The median (P50) of a numeric list, or null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Roll a run's ScoreRows into one aggregate card per scorer (first-seen order),
 * each carrying Mean / Min / Max / P50 over that scorer's scores.
 */
export function scorerAggregates(scores: ScoreRow[]): ScorerAggregate[] {
  const order: string[] = [];
  const byScorer = new Map<string, number[]>();
  for (const row of scores) {
    if (!byScorer.has(row.scorer)) {
      byScorer.set(row.scorer, []);
      order.push(row.scorer);
    }
    byScorer.get(row.scorer)!.push(row.score);
  }
  return order.map((scorer) => {
    const values = byScorer.get(scorer)!;
    return {
      scorer,
      count: values.length,
      mean: mean(values),
      min: values.length > 0 ? Math.min(...values) : null,
      max: values.length > 0 ? Math.max(...values) : null,
      p50: median(values),
    };
  });
}

/** The six Summary tiles, derived from a run's full metrics. */
export function summaryStats(metrics: RunMetrics): SummaryStats {
  const scoreValues = metrics.scores.map((row) => row.score);
  const meanScore = mean(scoreValues);
  const cacheRead = metrics.tokens.cacheRead ?? 0;
  const cacheWrite = metrics.tokens.cacheWrite ?? 0;
  const cacheTotal = cacheRead + cacheWrite;
  const cacheable = cacheTotal + metrics.tokens.input;
  const hasCache = metrics.tokens.cacheRead != null || metrics.tokens.cacheWrite != null;

  return {
    evaluations: metrics.scores.length,
    mean: meanScore == null ? EM_DASH : meanScore.toFixed(2),
    tokens: metrics.tokens.total > 0 ? humanizeTokens(metrics.tokens.total) : EM_DASH,
    avgDuration: metrics.latency.count > 0 ? humanizeDurationMs(metrics.latency.mean) : EM_DASH,
    cacheHitRate:
      hasCache && cacheable > 0 ? `${((cacheRead / cacheable) * 100).toFixed(1)}%` : EM_DASH,
    estCost: metrics.cost.total > 0 ? formatUsd(metrics.cost.total, 4) : EM_DASH,
  };
}

/** The cache hit % for the Token Usage panel, or null when no cache data. */
export function cacheHitPercent(tokens: TokenReport): number | null {
  if (tokens.cacheRead == null && tokens.cacheWrite == null) return null;
  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;
  const cacheable = cacheRead + cacheWrite + tokens.input;
  if (cacheable <= 0) return null;
  return (cacheRead / cacheable) * 100;
}

/** Per-run cost: total / runCount, or null when runCount is 0. */
export function costPerRun(cost: CostReport): number | null {
  if (cost.runCount <= 0) return null;
  return cost.total / cost.runCount;
}

// ---- Seed data -------------------------------------------------------------

/** The seeded 'today' label, so daily/weekly summaries are wall-clock-free. */
export const SEED_TODAY = "2026-06-05";

export const SCORES_RUNS: ScoresRun[] = [
  { runId: "run-7a3f9c21", workflowName: "review-suite", status: "completed" },
  { runId: "run-2b8e4d10", workflowName: "ship-pipeline", status: "running" },
  { runId: "run-c4f10a99", workflowName: null, status: "failed" },
];

/**
 * Per-run metrics, keyed by runId. The default run (review-suite) is fully
 * populated; ship-pipeline is mid-run (no cost/cache yet); the failed run has a
 * single low score and no metrics, exercising every empty-state branch.
 */
export const RUN_METRICS: Record<string, RunMetrics> = {
  "run-7a3f9c21": {
    scores: [
      {
        scorer: "correctness",
        score: 0.92,
        reason: "All assertions passed; no regressions in the diff.",
        scoredAt: "2026-06-05 14:02",
      },
      {
        scorer: "correctness",
        score: 0.88,
        reason: "One edge case under-tested but behavior is correct.",
        scoredAt: "2026-06-05 14:01",
      },
      {
        scorer: "style",
        score: 0.74,
        reason: "Naming is consistent; two functions exceed the length budget.",
        scoredAt: "2026-06-05 13:59",
      },
      {
        scorer: "style",
        score: 0.81,
        reason: "Idiomatic; minor import-order nit.",
        scoredAt: "2026-06-05 13:58",
      },
      {
        scorer: "security",
        score: 0.46,
        reason: "Unsanitized path join in the legacy fallback — flag for review.",
        scoredAt: "2026-06-05 13:55",
      },
      {
        scorer: "security",
        score: 0.95,
        reason: "No new sinks; secrets stay in the auth file.",
        scoredAt: "2026-06-05 13:54",
      },
      {
        scorer: "correctness",
        score: 0.79,
        reason: "Passes, but the retry path is only exercised once.",
        scoredAt: "2026-06-05 13:50",
      },
    ],
    tokens: {
      total: 1_242_880,
      input: 904_512,
      output: 338_368,
      cacheRead: 612_400,
      cacheWrite: 41_200,
      byPeriod: [
        { period: "2026-06-05", input: 540_120, output: 201_004 },
        { period: "2026-06-04", input: 364_392, output: 137_364 },
      ],
    },
    latency: {
      count: 18,
      mean: 4_120,
      min: 612,
      p50: 3_480,
      p95: 8_330,
      max: 12_940,
    },
    cost: {
      total: 0.7412,
      input: 0.4521,
      output: 0.2891,
      runCount: 3,
      byPeriod: [
        { period: "2026-06-05", total: 0.4218, runs: 2 },
        { period: "2026-06-04", total: 0.3194, runs: 1 },
      ],
    },
  },
  "run-2b8e4d10": {
    scores: [
      {
        scorer: "correctness",
        score: 0.83,
        reason: "Build and unit suites green so far.",
        scoredAt: "2026-06-05 15:10",
      },
      {
        scorer: "lint",
        score: 0.67,
        reason: "Three warnings remain in the changed files.",
        scoredAt: "2026-06-05 15:08",
      },
    ],
    tokens: {
      total: 318_400,
      input: 244_100,
      output: 74_300,
      byPeriod: [{ period: "2026-06-05", input: 244_100, output: 74_300 }],
    },
    latency: {
      count: 6,
      mean: 5_240,
      min: 1_180,
      p50: 4_900,
      p95: 9_010,
      max: 9_600,
    },
    cost: {
      total: 0,
      input: 0,
      output: 0,
      runCount: 0,
      byPeriod: [],
    },
  },
  "run-c4f10a99": {
    scores: [
      {
        scorer: "correctness",
        score: 0.21,
        reason: "Run failed before the suite completed; partial scoring only.",
        scoredAt: "2026-06-05 11:42",
      },
    ],
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      byPeriod: [],
    },
    latency: {
      count: 0,
      mean: 0,
      min: 0,
      p50: 0,
      p95: 0,
      max: 0,
    },
    cost: {
      total: 0,
      input: 0,
      output: 0,
      runCount: 0,
      byPeriod: [],
    },
  },
};

/** Look up a run's metrics, or an all-empty block when the run is unknown. */
export function metricsForRun(runId: string | null): RunMetrics {
  if (runId != null && RUN_METRICS[runId]) return RUN_METRICS[runId];
  return {
    scores: [],
    tokens: { total: 0, input: 0, output: 0, byPeriod: [] },
    latency: { count: 0, mean: 0, min: 0, p50: 0, p95: 0, max: 0 },
    cost: { total: 0, input: 0, output: 0, runCount: 0, byPeriod: [] },
  };
}
