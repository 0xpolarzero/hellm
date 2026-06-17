import { describe, expect, it } from "bun:test";
import type { AppLogEntry, AppLogSummary } from "../shared/workspace-contract";
import {
  APP_LOG_SOURCES,
  applyAppLogLiveUpdate,
  filterAppLogEntries,
  formatAppLogCount,
  formatAppLogUnreadTitle,
  getVisibleAppLogUnreadBadges,
} from "./app-logs";

function entry(overrides: Partial<AppLogEntry>): AppLogEntry {
  return {
    id: "log-1",
    seq: 1,
    createdAt: "2026-05-13T10:00:00.000Z",
    level: "info",
    source: "workspace",
    message: "Workspace ready",
    ...overrides,
  };
}

function appLogSummary(overrides: Partial<AppLogSummary> = {}): AppLogSummary {
  return {
    latestSeq: 1,
    seenSeq: 0,
    unread: { total: 1, debug: 0, info: 1, warn: 0, error: 0 },
    totals: { total: 1, debug: 0, info: 1, warn: 0, error: 0 },
    ...overrides,
  };
}

describe("formatAppLogCount", () => {
  it("caps large badge counts", () => {
    expect(formatAppLogCount(0)).toBe("0");
    expect(formatAppLogCount(99)).toBe("99");
    expect(formatAppLogCount(100)).toBe("99+");
  });
});

describe("app log sources", () => {
  it("does not expose Project CI as a current app-log source", () => {
    expect(APP_LOG_SOURCES).not.toContain("project-ci");
  });
});

describe("getVisibleAppLogUnreadBadges", () => {
  it("shows unread badges for warnings and errors but not info logs", () => {
    const summary = {
      latestSeq: 4,
      seenSeq: 0,
      unread: { total: 4, debug: 0, info: 2, warn: 1, error: 1 },
      totals: { total: 4, debug: 0, info: 2, warn: 1, error: 1 },
    };

    expect(getVisibleAppLogUnreadBadges(summary)).toEqual([
      { level: "error", count: 1 },
      { level: "warn", count: 1 },
    ]);
    expect(formatAppLogUnreadTitle(summary)).toBe("Open app logs: 1 errors, 1 warnings unread");
  });

  it("does not expose a sidebar unread count for info-only logs", () => {
    const summary = {
      latestSeq: 2,
      seenSeq: 0,
      unread: { total: 2, debug: 0, info: 2, warn: 0, error: 0 },
      totals: { total: 2, debug: 0, info: 2, warn: 0, error: 0 },
    };

    expect(getVisibleAppLogUnreadBadges(summary)).toEqual([]);
    expect(formatAppLogUnreadTitle(summary)).toBe("Open app logs");
  });
});

describe("filterAppLogEntries", () => {
  const entries = [
    entry({ id: "1", seq: 1, level: "info", source: "workspace", message: "Workspace ready" }),
    entry({
      id: "2",
      seq: 2,
      level: "warn",
      source: "auth.provider",
      message: "Provider missing",
    }),
    entry({
      id: "3",
      seq: 3,
      level: "error",
      source: "execute_typescript",
      message: "Compile failed",
      commandId: "cmd-1",
      artifactId: "artifact-1",
    }),
  ];

  it("filters by level and source", () => {
    expect(filterAppLogEntries(entries, { level: "warn", query: "" })).toEqual([entries[1]!]);
    expect(
      filterAppLogEntries(entries, { level: "all", sources: ["execute_typescript"], query: "" }),
    ).toEqual([entries[2]!]);
  });

  it("searches messages, sources, and related ids", () => {
    expect(filterAppLogEntries(entries, { level: "all", query: "provider" })).toEqual([
      entries[1]!,
    ]);
    expect(filterAppLogEntries(entries, { level: "all", query: "cmd-1" })).toEqual([entries[2]!]);
    expect(filterAppLogEntries(entries, { level: "all", query: "artifact-1" })).toEqual([
      entries[2]!,
    ]);
  });
});

describe("applyAppLogLiveUpdate", () => {
  const currentEntry = entry({ id: "1", seq: 1, message: "Workspace ready" });
  const nextEntry = entry({ id: "2", seq: 2, level: "warn", message: "Provider missing" });
  const nextSummary = appLogSummary({
    latestSeq: 2,
    unread: { total: 2, debug: 0, info: 1, warn: 1, error: 0 },
    totals: { total: 2, debug: 0, info: 1, warn: 1, error: 0 },
  });

  it("appends matching logs without requesting automatic tail follow", () => {
    const result = applyAppLogLiveUpdate({
      current: { entries: [currentEntry], summary: appLogSummary() },
      incomingEntries: [nextEntry],
      incomingSummary: nextSummary,
      filters: { level: "all", query: "" },
      currentNewLogsWhileAway: 0,
      maxLoaded: 2_000,
    });

    expect(result.readModel.entries.map((log) => log.id)).toEqual(["1", "2"]);
    expect(result.readModel.summary).toEqual(nextSummary);
    expect(result.shouldFollowTail).toBe(false);
    expect(result.newLogsWhileAway).toBe(1);
  });

  it("keeps entries updating while the reader is away from the tail and counts the new logs", () => {
    const result = applyAppLogLiveUpdate({
      current: { entries: [currentEntry], summary: appLogSummary() },
      incomingEntries: [nextEntry],
      incomingSummary: nextSummary,
      filters: { level: "all", query: "" },
      currentNewLogsWhileAway: 3,
      maxLoaded: 2_000,
    });

    expect(result.readModel.entries.map((log) => log.id)).toEqual(["1", "2"]);
    expect(result.shouldFollowTail).toBe(false);
    expect(result.newLogsWhileAway).toBe(4);
  });

  it("ignores duplicate and filtered-out update entries for viewport and New logs counts", () => {
    const result = applyAppLogLiveUpdate({
      current: { entries: [currentEntry], summary: appLogSummary() },
      incomingEntries: [
        currentEntry,
        entry({ id: "3", seq: 3, level: "info", source: "workspace", message: "Background info" }),
      ],
      incomingSummary: nextSummary,
      filters: { level: "error", query: "" },
      currentNewLogsWhileAway: 5,
      maxLoaded: 2_000,
    });

    expect(result.readModel.entries).toEqual([currentEntry]);
    expect(result.matchingNewEntries).toEqual([]);
    expect(result.newLogsWhileAway).toBe(5);
  });
});
