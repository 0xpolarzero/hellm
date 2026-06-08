import { describe, expect, test } from "bun:test";
import {
  filterPending,
  formatTimestamp,
  gateLabel,
  NOW_MS,
  orderHistory,
  prettyJson,
  SEEDED_DECISIONS,
  SEEDED_GATES,
  shortRunId,
  summarizeApprovals,
  waitTime,
  waitTimeTone,
  type ApprovalGate,
} from "./approvals";

/**
 * Pure domain tests for the approvals surface: the pending filter, history
 * ordering, the deterministic wait-time formatter + escalation tone, and the
 * payload pretty-printer. No DOM, no store.
 */

describe("filterPending", () => {
  test("keeps only pending gates, oldest requested first", () => {
    const pending = filterPending(SEEDED_GATES);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((gate) => gate.status === "pending")).toBe(true);
    for (let i = 1; i < pending.length; i += 1) {
      expect(pending[i].requestedAtMs).toBeGreaterThanOrEqual(pending[i - 1].requestedAtMs);
    }
  });

  test("excludes resolved gates and is immutable", () => {
    const mixed: ApprovalGate[] = [
      ...SEEDED_GATES,
      { ...SEEDED_GATES[0], id: "done", status: "approved" },
    ];
    const pending = filterPending(mixed);
    expect(pending.some((gate) => gate.id === "done")).toBe(false);
    expect(mixed.length).toBe(SEEDED_GATES.length + 1);
  });

  test("the most-overdue gate sorts to the top", () => {
    const pending = filterPending(SEEDED_GATES);
    const oldest = SEEDED_GATES.filter((g) => g.status === "pending").reduce((a, b) =>
      a.requestedAtMs <= b.requestedAtMs ? a : b,
    );
    expect(pending[0].id).toBe(oldest.id);
  });
});

describe("orderHistory", () => {
  test("orders decisions newest-resolved first, immutably", () => {
    const ordered = orderHistory(SEEDED_DECISIONS);
    expect(ordered.length).toBe(SEEDED_DECISIONS.length);
    expect(ordered).not.toBe(SEEDED_DECISIONS);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].resolvedAtMs).toBeLessThanOrEqual(ordered[i - 1].resolvedAtMs);
    }
  });
});

describe("gateLabel", () => {
  test("uses the gate name when present", () => {
    expect(gateLabel({ gate: "deploy-to-prod", nodeId: "deploy-prod" })).toBe("deploy-to-prod");
  });

  test("falls back to nodeId when the gate is absent or blank", () => {
    expect(gateLabel({ nodeId: "notify-customers" })).toBe("notify-customers");
    expect(gateLabel({ gate: "  ", nodeId: "notify-customers" })).toBe("notify-customers");
  });
});

describe("shortRunId", () => {
  test("takes the first 8 chars", () => {
    expect(shortRunId("run_8f3a91c2d4e5f6a7")).toBe("run_8f3a");
    expect(shortRunId("ab")).toBe("ab");
  });
});

describe("waitTime", () => {
  test("seconds under a minute", () => {
    expect(waitTime(NOW_MS - 42_000, NOW_MS)).toBe("42s");
    expect(waitTime(NOW_MS - 0, NOW_MS)).toBe("0s");
  });

  test("minutes (and minutes+seconds) under an hour", () => {
    expect(waitTime(NOW_MS - 14 * 60_000, NOW_MS)).toBe("14m");
    expect(waitTime(NOW_MS - (14 * 60_000 + 5_000), NOW_MS)).toBe("14m 5s");
  });

  test("hours and minutes over an hour", () => {
    expect(waitTime(NOW_MS - (2 * 3_600_000 + 8 * 60_000), NOW_MS)).toBe("2h 8m");
  });

  test("clamps negative spans (anchor before request) to 0s", () => {
    expect(waitTime(NOW_MS + 5_000, NOW_MS)).toBe("0s");
  });
});

describe("waitTimeTone", () => {
  test("under 5 minutes is fresh", () => {
    expect(waitTimeTone(NOW_MS - 42_000, NOW_MS)).toBe("is-fresh");
    expect(waitTimeTone(NOW_MS - (4 * 60_000 + 59_000), NOW_MS)).toBe("is-fresh");
  });

  test("5 to 30 minutes is warn", () => {
    expect(waitTimeTone(NOW_MS - 5 * 60_000, NOW_MS)).toBe("is-warn");
    expect(waitTimeTone(NOW_MS - 14 * 60_000, NOW_MS)).toBe("is-warn");
    expect(waitTimeTone(NOW_MS - 30 * 60_000, NOW_MS)).toBe("is-warn");
  });

  test("over 30 minutes is stale", () => {
    expect(waitTimeTone(NOW_MS - (30 * 60_000 + 1_000), NOW_MS)).toBe("is-stale");
    expect(waitTimeTone(NOW_MS - 47 * 60_000, NOW_MS)).toBe("is-stale");
  });

  test("the three seeded pending gates span all three bands", () => {
    const tones = filterPending(SEEDED_GATES).map((gate) => waitTimeTone(gate.requestedAtMs, NOW_MS));
    expect(new Set(tones)).toEqual(new Set(["is-fresh", "is-warn", "is-stale"]));
  });
});

describe("prettyJson", () => {
  test("2-space pretty-prints valid JSON", () => {
    expect(prettyJson('{"a":1,"b":[2,3]}')).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  test("falls back to the trimmed raw string when parsing fails", () => {
    expect(prettyJson("  not json  ")).toBe("not json");
  });

  test("empty and undefined yield an empty string", () => {
    expect(prettyJson("")).toBe("");
    expect(prettyJson(undefined)).toBe("");
  });

  test("every seeded payload pretty-prints without throwing", () => {
    for (const gate of SEEDED_GATES) {
      expect(() => prettyJson(gate.payload)).not.toThrow();
    }
    for (const decision of SEEDED_DECISIONS) {
      expect(() => prettyJson(decision.payload)).not.toThrow();
    }
  });
});

describe("formatTimestamp", () => {
  test("is a stable UTC YYYY-MM-DD HH:MM:SS string", () => {
    expect(formatTimestamp(NOW_MS)).toBe("2024-12-06 15:46:40");
  });
});

describe("summarizeApprovals", () => {
  test("counts pending gates and decided history", () => {
    const s = summarizeApprovals(SEEDED_GATES, SEEDED_DECISIONS);
    expect(s.pending).toBe(filterPending(SEEDED_GATES).length);
    expect(s.decided).toBe(SEEDED_DECISIONS.length);
  });
});

describe("seed integrity", () => {
  test("at least one pending gate is the synthetic fallback", () => {
    expect(SEEDED_GATES.some((gate) => gate.source === "synthetic")).toBe(true);
  });

  test("history mixes approvals and denials", () => {
    expect(SEEDED_DECISIONS.some((d) => d.action === "approved")).toBe(true);
    expect(SEEDED_DECISIONS.some((d) => d.action === "denied")).toBe(true);
  });

  test("every decision resolved at or after it was requested", () => {
    for (const d of SEEDED_DECISIONS) {
      expect(d.resolvedAtMs).toBeGreaterThanOrEqual(d.requestedAtMs);
    }
  });
});
