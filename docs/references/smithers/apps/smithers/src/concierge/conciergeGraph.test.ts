import { describe, expect, test } from "bun:test";
import { CONCIERGE_EDGES, CONCIERGE_NODES } from "./conciergeDefs";

/**
 * Pure data-integrity checks for the static concierge pipeline graph, mirroring
 * the grill-me graph invariants in `../store/workflows.test.ts`. These guard the
 * invariants the Console assumes — every edge references a real node, node ids are
 * unique, and every node carries a non-empty output — without booting React or a
 * gateway.
 */

describe("concierge graph invariants", () => {
  test("CONCIERGE_EDGES only reference ids present in CONCIERGE_NODES", () => {
    const nodeIds = new Set(CONCIERGE_NODES.map((n) => n.id));
    expect(nodeIds.size).toBeGreaterThan(0);
    for (const edge of CONCIERGE_EDGES) {
      expect(nodeIds.has(edge.source), `edge ${edge.id} source ${edge.source}`).toBe(true);
      expect(nodeIds.has(edge.target), `edge ${edge.id} target ${edge.target}`).toBe(true);
    }
  });

  test("node ids are unique", () => {
    const ids = CONCIERGE_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every node carries a non-empty output", () => {
    for (const node of CONCIERGE_NODES) {
      expect(typeof node.data.output, `${node.id}.output should be a string`).toBe("string");
      expect(node.data.output.trim().length, `${node.id}.output blank`).toBeGreaterThan(0);
    }
  });

  test("includes the grilling loop-back edge", () => {
    // The loop that keeps re-grilling until intent is clear.
    expect(CONCIERGE_EDGES.some((e) => e.source === "grill" && e.target === "grill")).toBe(true);
  });
});
