import { describe, expect, test } from "bun:test";
import { parseDevToolsSnapshot } from "./parseDevToolsSnapshot";

/**
 * Real unit tests for the DevTools snapshot parser — pure function fed a
 * realistic getDevToolsSnapshot wire payload. Verifies frameNo/seq, the task
 * (kind/iteration) parsing, recursive tree shape + depth, and runState/blocked.
 */

function realisticPayload() {
  return {
    runId: "run-approve-waiting",
    frameNo: 3,
    seq: 12,
    runState: {
      runId: "run-approve-waiting",
      state: "blocked_approval",
      computedAt: "2026-05-29T10:00:00.000Z",
      blocked: { kind: "approval", nodeId: "approve-deploy" },
    },
    root: {
      id: 1,
      type: "workflow",
      name: "studio-ship",
      props: { name: "studio-ship" },
      children: [
        {
          id: 2,
          type: "task",
          name: "plan",
          props: { label: "Plan" },
          task: { nodeId: "plan", kind: "agent", agent: "claude", iteration: 2 },
          children: [],
        },
        {
          id: 3,
          type: "task",
          name: "approve-deploy",
          props: { needsApproval: true },
          task: { nodeId: "approve-deploy", kind: "static" },
          children: [],
        },
      ],
    },
  };
}

describe("parseDevToolsSnapshot", () => {
  test("parses frameNo, seq, runId, and version", () => {
    const snap = parseDevToolsSnapshot(realisticPayload());
    expect(snap).not.toBeNull();
    expect(snap?.version).toBe(1);
    expect(snap?.runId).toBe("run-approve-waiting");
    expect(snap?.frameNo).toBe(3);
    expect(snap?.seq).toBe(12);
  });

  test("parses the task node's kind, agent, and iteration", () => {
    const snap = parseDevToolsSnapshot(realisticPayload());
    const planNode = snap?.root.children[0];
    expect(planNode?.task?.nodeId).toBe("plan");
    expect(planNode?.task?.kind).toBe("agent");
    expect(planNode?.task?.agent).toBe("claude");
    expect(planNode?.task?.iteration).toBe(2);
  });

  test("builds the recursive tree shape with computed depths", () => {
    const snap = parseDevToolsSnapshot(realisticPayload());
    expect(snap?.root.depth).toBe(0);
    expect(snap?.root.children).toHaveLength(2);
    expect(snap?.root.children[0]?.depth).toBe(1);
    expect(snap?.root.children[1]?.depth).toBe(1);
    expect(snap?.root.children[1]?.task?.nodeId).toBe("approve-deploy");
  });

  test("parses runState with the blocked reason", () => {
    const snap = parseDevToolsSnapshot(realisticPayload());
    expect(snap?.runState?.state).toBe("blocked_approval");
    expect(snap?.runState?.blocked).toEqual({ kind: "approval", nodeId: "approve-deploy" });
  });

  test("returns null when there is no root", () => {
    expect(parseDevToolsSnapshot({ runId: "x", frameNo: 0 })).toBeNull();
    expect(parseDevToolsSnapshot(null)).toBeNull();
    expect(parseDevToolsSnapshot(undefined)).toBeNull();
  });

  test("defaults frameNo/seq to 0 and runId to empty when absent", () => {
    const snap = parseDevToolsSnapshot({ root: { id: 0, type: "workflow", name: "(empty)", props: {}, children: [] } });
    expect(snap?.frameNo).toBe(0);
    expect(snap?.seq).toBe(0);
    expect(snap?.runId).toBe("");
  });

  test("non-agent/compute task kind falls back to static; bad iteration dropped", () => {
    const snap = parseDevToolsSnapshot({
      root: {
        id: 1,
        type: "workflow",
        name: "wf",
        props: {},
        task: { nodeId: "n", kind: "bogus", iteration: "nope" },
        children: [],
      },
    });
    expect(snap?.root.task?.kind).toBe("static");
    expect(snap?.root.task?.iteration).toBeUndefined();
  });

  test("a task without a nodeId is dropped (undefined task)", () => {
    const snap = parseDevToolsSnapshot({
      root: { id: 1, type: "workflow", name: "wf", props: {}, task: { kind: "agent" }, children: [] },
    });
    expect(snap?.root.task).toBeUndefined();
  });

  test("runState without runId+state is omitted entirely", () => {
    const snap = parseDevToolsSnapshot({
      root: { id: 1, type: "workflow", name: "wf", props: {}, children: [] },
      runState: { state: "running" },
    });
    expect(snap?.runState).toBeUndefined();
  });
});
