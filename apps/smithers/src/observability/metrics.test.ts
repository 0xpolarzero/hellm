import { describe, expect, test } from "bun:test";
import {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  DEFAULT_MS_BUCKETS,
} from "./metrics";

describe("Counter", () => {
  test("inc accumulates per-label series", () => {
    const counter = new Counter({
      name: "test_counter",
      help: "test",
      allowedLabels: ["a"],
    });
    counter.inc({ a: "x" });
    counter.inc({ a: "x" }, 2);
    counter.inc({ a: "y" });
    expect(counter.get({ a: "x" })).toBe(3);
    expect(counter.get({ a: "y" })).toBe(1);
    expect(counter.get({ a: "z" })).toBe(0);
  });

  test("foreign labels are dropped (no PII leak / no cardinality leak)", () => {
    const counter = new Counter({
      name: "test_counter_2",
      help: "test",
      allowedLabels: ["allowed"],
    });
    counter.inc({ allowed: "a", forbidden: "user@example.com" });
    counter.inc({ allowed: "a", forbidden: "other@example.com" });
    expect(counter.entries()).toHaveLength(1);
    expect(counter.get({ allowed: "a" })).toBe(2);
  });

  test("series cap collapses to overflow token", () => {
    const counter = new Counter({
      name: "test_counter_3",
      help: "test",
      allowedLabels: ["id"],
      maxSeries: 3,
    });
    counter.inc({ id: "1" });
    counter.inc({ id: "2" });
    counter.inc({ id: "3" });
    counter.inc({ id: "4" });
    counter.inc({ id: "5" });
    expect(counter.hasOverflowed()).toBe(true);
    const overflowEntry = counter
      .entries()
      .find((e) => e.labels.id === "__overflow__");
    expect(overflowEntry?.value).toBe(2);
  });

  test("inc ignores non-finite and negative deltas", () => {
    const counter = new Counter({ name: "test_counter_4", help: "test" });
    counter.inc();
    counter.inc(undefined, Number.NaN);
    counter.inc(undefined, Number.POSITIVE_INFINITY);
    counter.inc(undefined, -1);
    expect(counter.get()).toBe(1);
  });

  test("allowedLabels: [] enforces zero labels (drops every label)", () => {
    const counter = new Counter({
      name: "test_counter_5",
      help: "test",
      allowedLabels: [],
    });
    counter.inc({ stray: "x" });
    counter.inc({ also: "y" });
    expect(counter.entries()).toHaveLength(1);
    expect(counter.entries()[0].labels).toEqual({});
    expect(counter.get()).toBe(2);
  });

  test("allowedLabels: undefined disables filtering (legacy escape hatch)", () => {
    const counter = new Counter({ name: "test_counter_6", help: "test" });
    counter.inc({ free_form: "a" });
    counter.inc({ free_form: "b" });
    expect(counter.entries()).toHaveLength(2);
  });
});

describe("Gauge", () => {
  test("set/inc/dec move the value", () => {
    const gauge = new Gauge({ name: "g1", help: "test", allowedLabels: ["k"] });
    gauge.set(5, { k: "a" });
    gauge.inc(2, { k: "a" });
    gauge.dec(1, { k: "a" });
    expect(gauge.get({ k: "a" })).toBe(6);
  });

  test("cardinality cap collapses to overflow", () => {
    const gauge = new Gauge({
      name: "g2",
      help: "test",
      allowedLabels: ["id"],
      maxSeries: 2,
    });
    gauge.set(1, { id: "a" });
    gauge.set(1, { id: "b" });
    gauge.set(1, { id: "c" });
    expect(gauge.hasOverflowed()).toBe(true);
  });

  test("allowedLabels: [] forces a single zero-label series", () => {
    const gauge = new Gauge({ name: "g3", help: "test", allowedLabels: [] });
    gauge.set(1, { id: "a" });
    gauge.set(2, { id: "b" });
    expect(gauge.entries()).toHaveLength(1);
    expect(gauge.get()).toBe(2);
  });
});

describe("Histogram", () => {
  test("observe places samples into the right buckets", () => {
    const histogram = new Histogram({
      name: "h1",
      help: "test",
      allowedLabels: ["op"],
      buckets: [1, 10, 100],
    });
    histogram.observe(0.5, { op: "x" });
    histogram.observe(5, { op: "x" });
    histogram.observe(50, { op: "x" });
    histogram.observe(500, { op: "x" });
    const snapshot = histogram.snapshots()[0];
    expect(snapshot.count).toBe(4);
    expect(snapshot.sum).toBe(555.5);
    const bucketAt = (le: number) =>
      snapshot.buckets.find((b) => b.upperBound === le)!.count;
    expect(bucketAt(1)).toBe(1);
    expect(bucketAt(10)).toBe(2);
    expect(bucketAt(100)).toBe(3);
  });

  test("rejects negative samples (cannot fix bucket assignment)", () => {
    const histogram = new Histogram({ name: "h2", help: "test" });
    histogram.observe(-1);
    expect(histogram.snapshots()).toHaveLength(0);
  });

  test("default buckets are the ms profile", () => {
    const histogram = new Histogram({ name: "h3", help: "test" });
    expect(histogram.buckets()).toEqual(DEFAULT_MS_BUCKETS);
  });

  test("series cap collapses to overflow", () => {
    const histogram = new Histogram({
      name: "h4",
      help: "test",
      allowedLabels: ["op"],
      maxSeries: 2,
      buckets: [1, 10],
    });
    histogram.observe(1, { op: "a" });
    histogram.observe(1, { op: "b" });
    histogram.observe(1, { op: "c" });
    expect(histogram.hasOverflowed()).toBe(true);
  });
});

describe("MetricsRegistry", () => {
  test("idempotent registration of same-kind metric", () => {
    const registry = new MetricsRegistry();
    const a = registry.counter({ name: "x", help: "h" });
    const b = registry.counter({ name: "x", help: "h" });
    expect(a).toBe(b);
  });

  test("registering same name as different kind throws", () => {
    const registry = new MetricsRegistry();
    registry.counter({ name: "y", help: "h" });
    expect(() => registry.gauge({ name: "y", help: "h" })).toThrow();
  });

  test("reset clears all metrics", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter({ name: "z", help: "h" });
    counter.inc();
    registry.reset();
    expect(counter.get()).toBe(0);
  });
});
