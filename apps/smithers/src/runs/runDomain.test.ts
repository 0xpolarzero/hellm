import { describe, expect, test } from "bun:test";
import { findNode, runSteps, type NodeStatus, type Run, type RunNode } from "./Run";
import { statusLabel, statusTone } from "./statusMeta";
import { AUTH_REFACTOR_FRAMES } from "./authRefactorFrames";

/**
 * Pure domain tests for the run tree + status palette. No DOM, no gateway —
 * these are the invariants the chat card and inspector lean on. We reuse the
 * real AUTH_REFACTOR_FRAMES fixture so findNode is exercised against the same
 * nested shape the UI renders.
 */

/** Frame 2: edit-files is running with two file children (session ok, token running). */
const NESTED_ROOT: RunNode = AUTH_REFACTOR_FRAMES[2]!;

/** Wrap a RunNode tree as a Run so runSteps has something to read. */
function runFrom(root: RunNode): Run {
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

describe("findNode", () => {
  test("returns the node when the id matches the root", () => {
    expect(findNode(NESTED_ROOT, "workflow")).toBe(NESTED_ROOT);
  });

  test("finds a node nested under a child", () => {
    // edit-session lives under edit-files, two levels below the root.
    const hit = findNode(NESTED_ROOT, "edit-session");
    expect(hit?.id).toBe("edit-session");
    expect(hit?.name).toBe("auth/session.ts");
  });

  test("returns undefined for an id that is not in the tree", () => {
    expect(findNode(NESTED_ROOT, "does-not-exist")).toBeUndefined();
  });

  test("returns undefined on a leaf with no children", () => {
    const leaf: RunNode = { id: "leaf", name: "leaf", kind: "compute", status: "ok" };
    expect(findNode(leaf, "other")).toBeUndefined();
    expect(findNode(leaf, "leaf")).toBe(leaf);
  });
});

describe("runSteps", () => {
  test("returns the root's top-level children as the step list", () => {
    const steps = runSteps(runFrom(NESTED_ROOT));
    expect(steps).toBe(NESTED_ROOT.children!);
    // plan → edit-files → run-tests
    expect(steps.map((s) => s.id)).toEqual(["plan", "edit-files", "run-tests"]);
  });

  test("returns an empty array when the root has no children", () => {
    const root: RunNode = { id: "workflow", name: "workflow", kind: "merge", status: "ok" };
    expect(runSteps(runFrom(root))).toEqual([]);
  });
});

describe("statusMeta", () => {
  // The full NodeStatus union; keep in lockstep with Run.ts.
  const ALL_STATUSES: NodeStatus[] = ["ok", "running", "queued", "failed", "waiting"];
  const TONES = new Set(["running", "ok", "waiting", "failed", "idle"]);

  test("every NodeStatus resolves to a defined tone and label", () => {
    for (const status of ALL_STATUSES) {
      const tone = statusTone(status);
      const label = statusLabel(status);
      expect(TONES.has(tone)).toBe(true);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test("queued maps to the idle tone (color is state, not decoration)", () => {
    expect(statusTone("queued")).toBe("idle");
    expect(statusLabel("queued")).toBe("queued");
  });

  test("failed and waiting keep their own tone", () => {
    expect(statusTone("failed")).toBe("failed");
    expect(statusTone("waiting")).toBe("waiting");
  });
});
