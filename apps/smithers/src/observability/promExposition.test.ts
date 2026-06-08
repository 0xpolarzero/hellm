import { describe, expect, test } from "bun:test";
import { MetricsRegistry } from "./metrics";
import { renderPrometheus } from "./promExposition";

describe("renderPrometheus", () => {
  test("renders counter, gauge, and histogram in a single deterministic output", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter({
      name: "demo_total",
      help: "demo counter",
      allowedLabels: ["k"],
    });
    counter.inc({ k: "a" });
    counter.inc({ k: "b" }, 3);
    const gauge = registry.gauge({ name: "demo_gauge", help: "demo gauge" });
    gauge.set(7);
    const histogram = registry.histogram({
      name: "demo_ms",
      help: "demo hist",
      buckets: [1, 10, 100],
    });
    histogram.observe(5);
    histogram.observe(50);

    const out = renderPrometheus(registry);
    expect(out).toContain("# TYPE demo_total counter");
    expect(out).toContain('demo_total{k="a"} 1');
    expect(out).toContain('demo_total{k="b"} 3');
    expect(out).toContain("# TYPE demo_gauge gauge");
    expect(out).toContain("demo_gauge 7");
    expect(out).toContain("# TYPE demo_ms histogram");
    expect(out).toContain('demo_ms_bucket{le="1"} 0');
    expect(out).toContain('demo_ms_bucket{le="10"} 1');
    expect(out).toContain('demo_ms_bucket{le="100"} 2');
    expect(out).toContain('demo_ms_bucket{le="+Inf"} 2');
    expect(out).toContain("demo_ms_sum 55");
    expect(out).toContain("demo_ms_count 2");
  });

  test("label values containing quotes are escaped", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter({
      name: "esc_total",
      help: "escape \\ test",
      allowedLabels: ["k"],
    });
    counter.inc({ k: 'has "quote"' });
    const out = renderPrometheus(registry);
    expect(out).toContain('esc_total{k="has \\"quote\\""} 1');
    expect(out).toContain("# HELP esc_total escape \\\\ test");
  });

  test("two output runs of an unchanged registry are byte-identical", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter({ name: "stable_total", help: "h" });
    counter.inc();
    counter.inc();
    expect(renderPrometheus(registry)).toBe(renderPrometheus(registry));
  });
});
