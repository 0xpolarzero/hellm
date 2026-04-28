import { describe, expect, it } from "bun:test";
import {
  buildVisibleNodeKeys,
  buildWorkflowInspectorReadModel,
  classifyWorkflowInspectorNode,
  normalizeWorkflowInspectorStatus,
} from "./workflow-inspector";

const baseInput = {
  sessionId: "session-1",
  workflowRun: {
    id: "workflow-run-1",
    threadId: "thread-1",
    smithersRunId: "smithers-run-1",
    workflowName: "project-ci",
    savedEntryId: "ci",
    status: "running" as const,
    smithersStatus: "in-progress",
    input: { target: "all" },
    startedAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:01.000Z",
    finishedAt: null,
    heartbeatAt: "2026-04-28T00:00:02.000Z",
    lastEventSeq: 7,
  },
  thread: { id: "thread-1", title: "CI handler" },
  snapshot: {
    version: 1,
    runId: "smithers-run-1",
    frameNo: 3,
    seq: 7,
    root: {
      id: "root",
      type: "workflow",
      name: "Project CI",
      props: { state: "running" },
      children: [
        {
          id: "check:lint",
          type: "task",
          name: "Lint",
          props: { state: "waiting-approval", preview: "bun test" },
          children: [],
        },
        {
          id: "fix",
          type: "task",
          name: "Fix",
          props: { state: "failed", error: "bad patch" },
          task: { nodeId: "fix", kind: "agent", agent: "implementer" },
          children: [],
        },
      ],
    },
  },
  frames: [
    { frameNo: 1, seq: 2 },
    { frameNo: 3, seq: 7 },
  ],
  events: [{ seq: 7, timestampMs: 1777334402000, payload: { nodeId: "fix" } }],
  taskAttempts: [
    {
      workflowTaskAttemptId: "attempt-1",
      workflowRunId: "workflow-run-1",
      nodeId: "fix",
      kind: "agent",
      status: "failed",
      iteration: 0,
      attempt: 1,
      summary: "failed while editing",
    },
  ],
  commands: [
    {
      commandId: "command-1",
      workflowRunId: "workflow-run-1",
      workflowTaskAttemptId: "attempt-1",
      summary: "execute_typescript failed",
      toolName: "execute_typescript",
      status: "failed",
    },
  ],
  artifacts: [
    {
      artifactId: "artifact-1",
      kind: "log" as const,
      name: "fix.log",
      createdAt: "2026-04-28T00:00:02.000Z",
      sourceCommandId: "command-1",
      workflowRunId: "workflow-run-1",
    },
  ],
  ciChecks: [
    {
      checkResultId: "ci-check-1",
      checkId: "check:lint",
      label: "Lint",
      required: true,
      command: ["bun", "test"],
      status: "blocked",
    },
  ],
};

describe("workflow inspector projection", () => {
  it("classifies Smithers nodes and gates Project CI rows to declared checks", () => {
    expect(classifyWorkflowInspectorNode({ type: "approval" }, baseInput)).toBe("approval");
    expect(
      classifyWorkflowInspectorNode({ type: "task", task: { agent: "explorer" } }, baseInput),
    ).toBe("task-agent");
    expect(classifyWorkflowInspectorNode({ id: "check:lint", type: "task" }, baseInput)).toBe(
      "project-ci-check",
    );
    expect(classifyWorkflowInspectorNode({ id: "check:unknown", type: "task" }, baseInput)).toBe(
      "script",
    );
  });

  it("normalizes Smithers status strings into row states", () => {
    expect(normalizeWorkflowInspectorStatus({ state: "waiting-approval" })).toBe("waiting");
    expect(normalizeWorkflowInspectorStatus({ status: "in-progress" })).toBe("running");
    expect(normalizeWorkflowInspectorStatus({ status: "finished" })).toBe("completed");
    expect(normalizeWorkflowInspectorStatus({ status: "error" })).toBe("failed");
  });

  it("builds tree rollups, search index, related targets, and detail tabs", () => {
    const model = buildWorkflowInspectorReadModel({
      ...baseInput,
      searchQuery: "implementer",
      selectedNodeKey: "root/fix",
    });

    expect(model.runHeader.workflowLabel).toBe("project-ci");
    expect(model.runHeader.lastSeq).toBe(7);
    expect(model.frames.map((frame) => frame.frameNo)).toEqual([1, 3]);
    expect(model.selectedNode?.key).toBe("root/fix");
    expect(model.selectedNode?.task?.workflowTaskAttemptId).toBe("attempt-1");
    expect(model.selectedNode?.relatedSurfaceTargets).toContainEqual({
      kind: "command",
      commandId: "command-1",
    });
    expect(model.tree.nodes.find((node) => node.key === "root")?.hasFailedDescendant).toBe(true);
    expect(model.tree.nodes.find((node) => node.key === "root")?.hasWaitingDescendant).toBe(true);
    expect(model.tree.matchedNodeKeys).toEqual(["root/fix"]);
    expect(model.detailTabs.map((tab) => tab.id)).toContain("raw");
  });

  it("projects selected-node details for output, artifacts, agent, command, worktree, timing, and wait reason", () => {
    const model = buildWorkflowInspectorReadModel({
      ...baseInput,
      selectedNodeKey: "root/fix",
      snapshot: {
        root: {
          id: "root",
          type: "workflow",
          name: "Project CI",
          children: [
            {
              id: "fix",
              type: "task",
              name: "Fix implementation",
              props: { state: "running" },
              task: { kind: "agent", agent: "implementer" },
              outputPreview: "latest structured output",
              partialOutput: "assistant is editing src/app.ts",
              waitReason: "waiting for approval",
              startedAtMs: 1777334400000,
              updatedAtMs: 1777334402000,
              durationMs: 2000,
            },
          ],
        },
      },
      taskAttempts: [
        {
          ...baseInput.taskAttempts[0]!,
          responseText: "attempt final response",
          error: "patch failed",
          jjCwd: "/repo/worktrees/fix",
          agentId: "implementer",
          agentModel: "gpt-5.4",
        },
      ],
    });

    expect(model.selectedNode?.detail).toMatchObject({
      objectiveOrLabel: "Fix implementation",
      latestOutput: "attempt final response",
      partialOutput: "assistant is editing src/app.ts",
      workflowAgent: "implementer",
      worktree: "/repo/worktrees/fix",
      waitReason: "waiting for approval",
      taskAttempt: {
        workflowTaskAttemptId: "attempt-1",
        responseText: "attempt final response",
        error: "patch failed",
      },
      command: {
        commandId: "command-1",
        toolName: "execute_typescript",
        status: "failed",
      },
    });
    expect(model.selectedNode?.detail.relatedArtifacts).toHaveLength(1);
    expect(model.selectedNode?.detail.timing.elapsedMs).toBe(2000);
  });

  it("preserves user-collapsed active ancestors during live expansion", () => {
    const model = buildWorkflowInspectorReadModel({
      ...baseInput,
      selectedNodeKey: "root/fix",
      expandedNodeKeys: [],
      userCollapsedNodeKeys: ["root"],
    });

    expect(model.expandedNodeKeys).not.toContain("root");
    expect(model.tree.visibleNodeKeys).toEqual(["root"]);
  });

  it("keeps expansion visibility deterministic in live and search modes", () => {
    const model = buildWorkflowInspectorReadModel({
      ...baseInput,
      selectedNodeKey: "root/fix",
      expandedNodeKeys: [],
    });
    expect(model.expandedNodeKeys).toContain("root");
    expect(buildVisibleNodeKeys(model.tree.nodes, [])).toEqual(["root"]);
    expect(buildVisibleNodeKeys(model.tree.nodes, [], "lint", ["root/check:lint"])).toEqual([
      "root",
      "root/check:lint",
    ]);
  });

  it("preserves historical frame mode without treating it as rewind control", () => {
    const model = buildWorkflowInspectorReadModel({
      ...baseInput,
      mode: { kind: "historical", frameNo: 1 },
    });
    expect(model.mode).toEqual({ kind: "historical", frameNo: 1 });
  });
});
