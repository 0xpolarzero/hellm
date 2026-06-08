import { describe, expect, test } from "bun:test";
import {
  factAge,
  factsInNamespace,
  factValuePreview,
  formatTtl,
  MEMORY_FACTS,
  namespaces,
  normalizedRecallTopK,
  NOW_MS,
  prettyValue,
  recall,
  scoreTone,
  validatedFilter,
} from "./memoryFacts";

/**
 * Pure domain tests for the memory surface: the namespace derivation/filter, the
 * value preview + age formatter, the value pretty-printer, the topK clamp, the
 * score tone, and the recall scorer the card and canvas lean on. No DOM, no
 * store, no clock — every age is measured against the fixed NOW_MS anchor.
 */

describe("seed invariants", () => {
  test("has ~12 facts across 5 namespaces with unique ids", () => {
    expect(MEMORY_FACTS.length).toBeGreaterThanOrEqual(12);
    expect(namespaces(MEMORY_FACTS).length).toBe(5);
    expect(new Set(MEMORY_FACTS.map((f) => f.id)).size).toBe(MEMORY_FACTS.length);
  });

  test("every fact is well-formed: text filled, weight in [0,1], updated before now", () => {
    for (const fact of MEMORY_FACTS) {
      expect(fact.namespace.length).toBeGreaterThan(0);
      expect(fact.key.length).toBeGreaterThan(0);
      expect(fact.text.length).toBeGreaterThan(0);
      expect(fact.value.length).toBeGreaterThan(0);
      expect(fact.weight).toBeGreaterThanOrEqual(0);
      expect(fact.weight).toBeLessThanOrEqual(1);
      expect(fact.updatedAtMs).toBeLessThanOrEqual(NOW_MS);
      expect(fact.createdAtMs).toBeLessThanOrEqual(fact.updatedAtMs);
    }
  });

  test("at least one fact carries a TTL and one does not", () => {
    expect(MEMORY_FACTS.some((f) => f.ttlMs !== undefined)).toBe(true);
    expect(MEMORY_FACTS.some((f) => f.ttlMs === undefined)).toBe(true);
  });
});

describe("namespaces", () => {
  test("returns the distinct namespaces sorted alphabetically", () => {
    const ns = namespaces(MEMORY_FACTS);
    expect(ns).toEqual([...ns].sort());
    expect(new Set(ns).size).toBe(ns.length);
    expect(ns).toContain("ci");
    expect(ns).toContain("docs");
  });
});

describe("validatedFilter", () => {
  test("keeps a present namespace and falls back to null for a stale one", () => {
    expect(validatedFilter("ci", MEMORY_FACTS)).toBe("ci");
    expect(validatedFilter("nope", MEMORY_FACTS)).toBeNull();
    expect(validatedFilter(null, MEMORY_FACTS)).toBeNull();
  });
});

describe("factsInNamespace", () => {
  test("null returns a fresh copy of every fact", () => {
    const all = factsInNamespace(MEMORY_FACTS, null);
    expect(all).toEqual(MEMORY_FACTS);
    expect(all).not.toBe(MEMORY_FACTS);
  });

  test("a namespace keeps only its facts", () => {
    const ci = factsInNamespace(MEMORY_FACTS, "ci");
    expect(ci.length).toBeGreaterThan(0);
    expect(ci.every((f) => f.namespace === "ci")).toBe(true);
  });
});

describe("factValuePreview", () => {
  test("strips wrapping JSON quotes and leaves short values whole", () => {
    expect(factValuePreview('"hi there"')).toBe("hi there");
    expect(factValuePreview("plain")).toBe("plain");
  });

  test("clips a long value to maxLen with a trailing ellipsis", () => {
    const long = "x".repeat(120);
    const preview = factValuePreview(long, 60);
    expect(preview.length).toBe(60);
    expect(preview.endsWith("...")).toBe(true);
  });
});

describe("factAge", () => {
  test("buckets seconds / minutes / hours / days off the fixed NOW_MS", () => {
    expect(factAge(NOW_MS - 42 * 1000)).toBe("42s ago");
    expect(factAge(NOW_MS - 5 * 60 * 1000)).toBe("5m ago");
    expect(factAge(NOW_MS - 2 * 60 * 60 * 1000)).toBe("2h ago");
    expect(factAge(NOW_MS - 3 * 24 * 60 * 60 * 1000)).toBe("3d ago");
  });

  test("clamps a future timestamp to 0s ago", () => {
    expect(factAge(NOW_MS + 10_000)).toBe("0s ago");
  });
});

describe("formatTtl", () => {
  test("renders milliseconds as one-decimal seconds", () => {
    expect(formatTtl(3_600_000)).toBe("3600.0s");
    expect(formatTtl(1_500)).toBe("1.5s");
  });
});

describe("prettyValue", () => {
  test("pretty-prints parseable JSON with 2-space indent", () => {
    expect(prettyValue('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  test("falls back to the raw trimmed string when unparseable", () => {
    expect(prettyValue("  not json  ")).toBe("not json");
  });

  test("reports (empty) for a blank value", () => {
    expect(prettyValue("   ")).toBe("(empty)");
  });
});

describe("normalizedRecallTopK", () => {
  test("clamps below 1 up to 1 and floors fractionals", () => {
    expect(normalizedRecallTopK(0)).toBe(1);
    expect(normalizedRecallTopK(-4)).toBe(1);
    expect(normalizedRecallTopK(10.9)).toBe(10);
    expect(normalizedRecallTopK(NaN)).toBe(1);
  });
});

describe("scoreTone", () => {
  test("maps score bands to color classes", () => {
    expect(scoreTone(0.94)).toBe("score-ok");
    expect(scoreTone(0.8)).toBe("score-ok");
    expect(scoreTone(0.62)).toBe("score-warn");
    expect(scoreTone(0.5)).toBe("score-warn");
    expect(scoreTone(0.3)).toBe("score-danger");
  });
});

describe("recall", () => {
  test("returns RecallResult rows sorted by score descending, sliced to topK", () => {
    const results = recall("token rotation", MEMORY_FACTS, null, 3);
    expect(results.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
    expect(results[0]).toHaveProperty("content");
    expect(results[0].metadata).toMatch(/^[a-z]+\/[a-z-]+$/);
  });

  test("keyword overlap lifts a matching fact above its base weight", () => {
    const baseline = recall("", MEMORY_FACTS, "ci", 50);
    const matched = recall("lockfile pnpm", MEMORY_FACTS, "ci", 50);
    const target = (rows: ReturnType<typeof recall>) =>
      rows.find((r) => r.metadata === "ci/lockfile-topology")!;
    expect(matched.length).toBe(baseline.length);
    expect(target(matched).score).toBeGreaterThan(target(baseline).score);
  });

  test("an empty query returns the namespace facts at base weight, scoped", () => {
    const ci = recall("", MEMORY_FACTS, "ci", 50);
    expect(ci.length).toBe(factsInNamespace(MEMORY_FACTS, "ci").length);
    expect(ci.every((r) => r.metadata?.startsWith("ci/"))).toBe(true);
  });

  test("scopes results to the active namespace", () => {
    const docs = recall("docs", MEMORY_FACTS, "docs", 50);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((r) => r.metadata?.startsWith("docs/"))).toBe(true);
  });

  test("scores never exceed the 0.99 cap and is deterministic", () => {
    const a = recall("docs", MEMORY_FACTS, null, 10);
    const b = recall("docs", MEMORY_FACTS, null, 10);
    expect(a).toEqual(b);
    expect(a.every((r) => r.score <= 0.99)).toBe(true);
  });
});
