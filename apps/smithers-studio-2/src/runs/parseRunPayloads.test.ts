import { describe, expect, test } from "bun:test";
import {
  parseApprovals,
  parseRunState,
  parseRunSummaries,
  parseWorkflowUiPaths,
} from "./parseRunPayloads";

/**
 * Real unit tests for the Runs RPC payload parsers — pure functions fed
 * realistic listRuns/getRun/listApprovals/listWorkflows wire shapes. No mocking.
 */

describe("parseWorkflowUiPaths", () => {
  test("keeps only workflows with hasUi true and a non-empty uiPath", () => {
    const paths = parseWorkflowUiPaths([
      { key: "studio-ui", hasUi: true, uiPath: "/ui/studio" },
      { key: "no-ui", hasUi: false, uiPath: "/ui/none" },
      { key: "missing-path", hasUi: true, uiPath: "" },
      { key: "missing-flag", uiPath: "/ui/x" },
    ]);
    expect(paths).toEqual({ "studio-ui": "/ui/studio" });
  });

  test("non-array payload yields an empty map", () => {
    expect(parseWorkflowUiPaths(null)).toEqual({});
    expect(parseWorkflowUiPaths({})).toEqual({});
  });
});

describe("parseRunSummaries", () => {
  test("normalizes status and keeps createdAtMs; drops rows without a runId", () => {
    const rows = parseRunSummaries([
      { runId: "run-1", workflowKey: "studio-ship", status: "finished", createdAtMs: 1000 },
      { runId: "run-2", status: "active" },
      { workflowKey: "no-id" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      runId: "run-1",
      workflowKey: "studio-ship",
      status: "succeeded",
      createdAtMs: 1000,
    });
    expect(rows[1]?.status).toBe("running");
    expect(rows[1]?.createdAtMs).toBeUndefined();
  });

  test("non-array payload yields an empty list", () => {
    expect(parseRunSummaries(undefined)).toEqual([]);
  });
});

describe("parseRunState", () => {
  test("takes state from runState.state and exposes the blocked node id", () => {
    const view = parseRunState({
      runId: "run-approve-waiting",
      workflowKey: "studio-ship",
      createdAtMs: 2000,
      runState: {
        runId: "run-approve-waiting",
        state: "blocked_approval",
        blocked: { kind: "approval", nodeId: "approve-deploy" },
      },
    });
    expect(view.runId).toBe("run-approve-waiting");
    expect(view.workflowKey).toBe("studio-ship");
    expect(view.state).toBe("waiting-approval");
    expect(view.blockedNodeId).toBe("approve-deploy");
    expect(view.tree).toBeNull();
  });

  test("falls back to row status when runState.state is absent", () => {
    const view = parseRunState({ runId: "run-x", status: "failed" });
    expect(view.state).toBe("failed");
    expect(view.blockedNodeId).toBeUndefined();
  });

  test("derives runId from runState.runId when the top-level is missing", () => {
    const view = parseRunState({ runState: { runId: "run-y", state: "running" } });
    expect(view.runId).toBe("run-y");
    expect(view.state).toBe("running");
  });
});

describe("parseApprovals", () => {
  test("parses pending gates and drops rows missing runId or nodeId", () => {
    const rows = parseApprovals([
      {
        runId: "run-approve-waiting",
        workflowKey: "studio-ship",
        nodeId: "approve-deploy",
        iteration: 1,
        requestTitle: "Deploy?",
        requestSummary: "Ship to prod",
        requestedAtMs: 5000,
      },
      { runId: "run-z", nodeId: "" },
      { nodeId: "orphan" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      runId: "run-approve-waiting",
      workflowKey: "studio-ship",
      nodeId: "approve-deploy",
      iteration: 1,
      requestTitle: "Deploy?",
      requestSummary: "Ship to prod",
      requestedAtMs: 5000,
    });
  });

  test("missing iteration defaults to 0 and missing requestedAtMs to null", () => {
    const rows = parseApprovals([{ runId: "r", nodeId: "n" }]);
    expect(rows[0]?.iteration).toBe(0);
    expect(rows[0]?.requestedAtMs).toBeNull();
  });
});
