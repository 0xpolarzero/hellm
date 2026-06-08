import { describe, expect, test } from "bun:test";
import type { DiffLineKind } from "./Diff";
import { AUTH_REFACTOR_DIFF } from "./authRefactorDiff";
import { runToFlow } from "../runs/runToFlow";
import type { Run } from "../runs/Run";
import { AUTH_REFACTOR_FRAMES } from "../runs/authRefactorFrames";

/**
 * Pure domain tests for the diff representation and the run→graph adapter. No
 * DOM, no gateway. We exercise the real AUTH_REFACTOR_DIFF the cards/canvas
 * render, and feed runToFlow the same AUTH_REFACTOR_FRAMES tree the inspector
 * shows, so the invariants here track the shapes the UI actually leans on.
 */

const VALID_KINDS = new Set<DiffLineKind>(["context", "add", "del"]);

describe("AUTH_REFACTOR_DIFF representation", () => {
  test("every line carries a known kind and non-null text", () => {
    for (const file of AUTH_REFACTOR_DIFF.files) {
      for (const line of file.lines) {
        expect(VALID_KINDS.has(line.kind)).toBe(true);
        expect(typeof line.text).toBe("string");
      }
    }
  });

  test("dual gutter tracks both files: add has new ln, del has old lnOld", () => {
    // The bundle now carries a dual gutter — `ln` for the new file, `lnOld` for
    // the old. Deletions have no slot in the new file (ln omitted) but do carry
    // lnOld; additions are the mirror. `@@` headers and the binary marker ride
    // along as context lines with neither number, so we skip those.
    for (const file of AUTH_REFACTOR_DIFF.files) {
      for (const line of file.lines) {
        if (line.kind === "context") continue;
        if (line.kind === "del") {
          expect(line.ln).toBeUndefined();
          expect(typeof line.lnOld).toBe("number");
        } else {
          expect(typeof line.ln).toBe("number");
          expect(line.lnOld).toBeUndefined();
        }
      }
    }
  });

  test("text files carry change lines; the deleted file is all deletions", () => {
    // The bundle now spans every status: added/modified files show adds, the
    // deleted file shows only deletions, and the binary blob shows no hunks at
    // all (just its marker), so the invariant is per-status, not "every file".
    for (const file of AUTH_REFACTOR_DIFF.files) {
      expect(file.lines.length).toBeGreaterThan(0);
    }
    const deleted = AUTH_REFACTOR_DIFF.files.find((file) => file.path === "auth/legacy-session.ts")!;
    expect(deleted.lines.some((line) => line.kind === "del")).toBe(true);
    expect(deleted.lines.some((line) => line.kind === "add")).toBe(false);
  });

  test("the diff overall renders both additions and deletions", () => {
    const kinds = AUTH_REFACTOR_DIFF.files.flatMap((file) =>
      file.lines.map((line) => line.kind),
    );
    expect(kinds).toContain("add");
    expect(kinds).toContain("del");
  });
});

describe("AUTH_REFACTOR_DIFF add/del counts", () => {
  test("per-file add/del are non-negative integer line-delta counts", () => {
    // The bundle now includes an added file (del 0 possible), a deleted file
    // (add 0), and a binary blob (both 0), so the counts are non-negative
    // rather than strictly positive.
    for (const file of AUTH_REFACTOR_DIFF.files) {
      expect(file.add).toBeGreaterThanOrEqual(0);
      expect(file.del).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(file.add)).toBe(true);
      expect(Number.isInteger(file.del)).toBe(true);
    }
  });

  test("totals equal the sum of the per-file deltas", () => {
    const add = AUTH_REFACTOR_DIFF.files.reduce((sum, file) => sum + file.add, 0);
    const del = AUTH_REFACTOR_DIFF.files.reduce((sum, file) => sum + file.del, 0);
    // 22+31+6+0+8+0 = 67 added, 8+9+2+212+3+0 = 234 deleted across the 6 files.
    expect(add).toBe(67);
    expect(del).toBe(234);
    // The headline totals are derived from the same files, so they match exactly.
    expect(AUTH_REFACTOR_DIFF.totalAdd).toBe(add);
    expect(AUTH_REFACTOR_DIFF.totalDel).toBe(del);
  });

  test("file paths are unique so the card's file tabs key cleanly", () => {
    const paths = AUTH_REFACTOR_DIFF.files.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

/** A frame from the real fixture is a complete RunNode tree; wrap it as a Run. */
function runFrom(root: Run["root"]): Run {
  return {
    id: "r1",
    title: "Implement · auth refactor",
    model: "claude-opus-4-8",
    runId: "4821",
    status: root.status,
    startedAtMs: 0,
    frame: 0,
    frameCount: 1,
    root,
  };
}

describe("runToFlow", () => {
  // Frame 3: plan ok → edit-files ok → run-tests running, all three top-level.
  const run = runFrom(AUTH_REFACTOR_FRAMES[3]!);
  const { nodes, edges } = runToFlow(run);

  test("emits one graph node per top-level step", () => {
    const stepIds = (run.root.children ?? []).map((step) => step.id);
    expect(nodes.map((node) => node.id)).toEqual(stepIds);
  });

  test("node data mirrors the real step's label, kind, and live status output", () => {
    const plan = nodes.find((node) => node.id === "plan");
    expect(plan?.data.label).toBe("plan");
    expect(plan?.data.kind).toBe("agent");
    // step.meta wins over status as the node output (see runToFlow).
    expect(plan?.data.output).toBe("8s");
  });

  test("edges chain the steps in order and reference only real node ids", () => {
    const ids = new Set(nodes.map((node) => node.id));
    for (const edge of edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
    // Linear plan → edit-files → run-tests, so each step depends on the prior.
    expect(edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "plan->edit-files",
      "edit-files->run-tests",
    ]);
  });

  test("every node gets a finite laid-out position", () => {
    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  test("a root with no children produces an empty graph", () => {
    const empty = runFrom({ id: "workflow", name: "workflow", kind: "merge", status: "ok" });
    const flow = runToFlow(empty);
    expect(flow.nodes).toEqual([]);
    expect(flow.edges).toEqual([]);
  });
});
