import { describe, expect, test } from "bun:test";
import { AUTH_REFACTOR_LOG, type LogRole } from "./logLines";
import { SCORE_REPORTS, findReport, type ScoreReport } from "../scores/scoreReport";

/**
 * Pure shape tests for the two canvas fixtures the chat surfaces render from:
 * the logs transcript (logLines.ts) and the eval scorecard (scoreReport.ts).
 * No DOM — these guard the invariants LogsCanvas and ScoresCard lean on
 * (every line has a known role; a redactable secret is actually a substring of
 * its line; report tiles are well-formed and the mean reads as a 0..1 score).
 */

describe("AUTH_REFACTOR_LOG", () => {
  const ROLES = new Set<LogRole>(["agent", "tool", "noise"]);

  test("the fixture is non-empty", () => {
    expect(AUTH_REFACTOR_LOG.length).toBeGreaterThan(0);
  });

  test("every line has a known role and non-empty text", () => {
    for (const line of AUTH_REFACTOR_LOG) {
      expect(ROLES.has(line.role)).toBe(true);
      expect(typeof line.text).toBe("string");
      expect(line.text.length).toBeGreaterThan(0);
    }
  });

  test("all three roles appear at least once", () => {
    const seen = new Set(AUTH_REFACTOR_LOG.map((line) => line.role));
    expect(seen).toEqual(new Set<LogRole>(["agent", "tool", "noise"]));
  });

  test("when a line carries a secret it is a real substring of the text", () => {
    // LogsCanvas masks with text.replace(secret, "•••••"); a secret that is not
    // present would silently fail to redact, so the invariant must hold.
    const withSecrets = AUTH_REFACTOR_LOG.filter((line) => line.secret);
    expect(withSecrets.length).toBeGreaterThan(0);
    for (const line of withSecrets) {
      expect(line.secret!.length).toBeGreaterThan(0);
      expect(line.text.includes(line.secret!)).toBe(true);
    }
  });

  test("noise lines never carry a secret to redact", () => {
    for (const line of AUTH_REFACTOR_LOG) {
      if (line.role === "noise") expect(line.secret).toBeUndefined();
    }
  });
});

describe("SCORE_REPORTS", () => {
  const reports = Object.entries(SCORE_REPORTS);

  test("the catalog is non-empty", () => {
    expect(reports.length).toBeGreaterThan(0);
  });

  test("each entry's map key matches its own id", () => {
    for (const [key, report] of reports) {
      expect(report.id).toBe(key);
    }
  });

  test("report ids are unique", () => {
    const ids = reports.map(([, report]) => report.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every report is well-formed", () => {
    for (const [, report] of reports) {
      assertReportShape(report);
    }
  });

  test("trend bars stay within the documented 0..1 range", () => {
    for (const [, report] of reports) {
      expect(report.trend.length).toBeGreaterThan(0);
      for (const bar of report.trend) {
        expect(bar).toBeGreaterThanOrEqual(0);
        expect(bar).toBeLessThanOrEqual(1);
      }
    }
  });

  test("the mean tile reads as a 0..1 score", () => {
    for (const [, report] of reports) {
      const mean = report.tiles.find((tile) => tile.name === "mean");
      expect(mean).toBeDefined();
      const value = Number(mean!.value);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("findReport", () => {
  test("returns the report for a known id", () => {
    const report = findReport("review-suite");
    expect(report).toBeDefined();
    expect(report!.id).toBe("review-suite");
  });

  test("returns the same object the catalog holds", () => {
    expect(findReport("review-suite")).toBe(SCORE_REPORTS["review-suite"]);
  });

  test("returns undefined for an unknown id", () => {
    expect(findReport("does-not-exist")).toBeUndefined();
  });
});

/** Structural invariants for a single ScoreReport (id/suite/delta/tiles). */
function assertReportShape(report: ScoreReport): void {
  expect(report.id.length).toBeGreaterThan(0);
  expect(report.suite.length).toBeGreaterThan(0);
  expect(report.delta.length).toBeGreaterThan(0);
  expect(report.tiles.length).toBeGreaterThan(0);
  for (const tile of report.tiles) {
    expect(tile.name.length).toBeGreaterThan(0);
    expect(tile.value.length).toBeGreaterThan(0);
  }
  // Tile names are the scorecard's column labels; duplicates would collide.
  const names = report.tiles.map((tile) => tile.name);
  expect(new Set(names).size).toBe(names.length);
}
