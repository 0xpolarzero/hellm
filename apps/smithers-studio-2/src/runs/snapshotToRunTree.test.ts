import { describe, expect, test } from "bun:test";
import type { DevToolsSnapshot } from "../devtools/DevToolsSnapshot";
import { runNodeId, snapshotToRunTree } from "./snapshotToRunTree";

/**
 * Real unit tests for the Runs tree builder — pure functions fed realistic
 * DevToolsSnapshot inputs. Verifies node-id keying, label/iteration mapping,
 * per-node state derivation (blocked/pending-approval/root), and the
 * empty-root placeholder returning null.
 */

function snapshot(overrides: Partial<DevToolsSnapshot> = {}): DevToolsSnapshot {
  return {
    version: 1,
    runId: "run-approve-waiting",
    frameNo: 3,
    seq: 12,
    runState: {
      runId: "run-approve-waiting",
      state: "blocked_approval",
      blocked: { kind: "approval", nodeId: "approve-deploy" },
    },
    root: {
      id: 1,
      type: "workflow",
      name: "studio-ship",
      props: { name: "studio-ship" },
      depth: 0,
      children: [
        {
          id: 2,
          type: "task",
          name: "plan",
          props: { label: "Plan", target: "main" },
          task: { nodeId: "plan", kind: "agent", label: "Plan step", iteration: 2 },
          depth: 1,
          children: [],
        },
        {
          id: 3,
          type: "task",
          name: "approve-deploy",
          props: { needsApproval: true },
          task: { nodeId: "approve-deploy", kind: "static" },
          depth: 1,
          children: [],
        },
      ],
    },
    ...overrides,
  };
}

describe("runNodeId", () => {
  test("prefers task.nodeId, falls back to numeric id for structural nodes", () => {
    const snap = snapshot();
    expect(runNodeId(snap.root)).toBe("1");
    expect(runNodeId(snap.root.children[0]!)).toBe("plan");
  });
});

describe("snapshotToRunTree", () => {
  test("returns null for a null snapshot", () => {
    expect(snapshotToRunTree(null)).toBeNull();
  });

  test("returns null for the gateway empty-root placeholder", () => {
    const tree = snapshotToRunTree(
      snapshot({ root: { id: 0, type: "workflow", name: "(empty)", props: {}, depth: 0, children: [] } }),
    );
    expect(tree).toBeNull();
  });

  test("root mirrors the run-level state; the blocked node is waiting-approval", () => {
    const tree = snapshotToRunTree(snapshot());
    expect(tree).not.toBeNull();
    expect(tree?.id).toBe("1");
    expect(tree?.state).toBe("waiting-approval"); // root mirrors blocked_approval run state
    const planNode = tree?.children[0];
    const approveNode = tree?.children[1];
    expect(planNode?.state).toBe("unknown"); // non-root, not blocked
    expect(approveNode?.id).toBe("approve-deploy");
    expect(approveNode?.state).toBe("waiting-approval");
  });

  test("maps the task label and iteration onto the node", () => {
    const tree = snapshotToRunTree(snapshot());
    const planNode = tree?.children[0];
    expect(planNode?.name).toBe("Plan step");
    expect(planNode?.iteration).toBe(2);
  });

  test("summarizes key props excluding name/label", () => {
    const tree = snapshotToRunTree(snapshot());
    // plan node props: { label, target } -> label excluded -> "target"
    expect(tree?.children[0]?.keyProps).toBe("target");
  });

  test("a pending-approval node id (no blocked) is marked waiting-approval", () => {
    const tree = snapshotToRunTree(
      snapshot({
        runState: { runId: "run-x", state: "running" },
      }),
      new Set(["approve-deploy"]),
    );
    expect(tree?.state).toBe("running"); // root mirrors running
    expect(tree?.children[1]?.state).toBe("waiting-approval");
  });

  test("a non-blocked terminal run leaves child nodes unknown", () => {
    const tree = snapshotToRunTree(
      snapshot({ runState: { runId: "run-x", state: "finished" } }),
    );
    expect(tree?.state).toBe("succeeded");
    expect(tree?.children[0]?.state).toBe("unknown");
    expect(tree?.children[1]?.state).toBe("unknown");
  });
});
