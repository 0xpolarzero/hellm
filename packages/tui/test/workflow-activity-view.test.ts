import { describe, expect, it } from "bun:test";
import {
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  createThreadSnapshot,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import {
  FileBackedSessionJsonlHarness,
  VirtualTerminalHarness,
  withTempWorkspace,
} from "../../../test-support/index.ts";

describe("@hellm/tui workflow activity view", () => {
  it("shows an explicit empty workflow state when a thread has no workflow runs", () => {
    const thread = createThread({
      id: "thread-no-workflow",
      kind: "direct",
      objective: "Render workflow activity fallback",
      status: "completed",
      createdAt: "2026-04-08T11:00:00.000Z",
      updatedAt: "2026-04-08T11:01:00.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    });

    const terminal = new VirtualTerminalHarness(120, 20);
    const viewport = terminal.render(projection);

    expect(projection.workflowActivity).toEqual(["workflow none"]);
    expect(viewport).toContain("[workflow]");
    expect(viewport).toContain("workflow none");
  });

  it("renders each workflow run using workflow id, status, and run id in deterministic order", () => {
    const thread = createThread({
      id: "thread-workflow-order",
      kind: "smithers-workflow",
      objective: "Render ordered workflow activity lines",
      status: "running",
      createdAt: "2026-04-08T11:10:00.000Z",
      updatedAt: "2026-04-08T11:11:00.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
        activeWorktreePath: "/repo/worktrees/workflow-order",
      }),
      workflowRuns: [
        {
          runId: "run-running",
          threadId: thread.id,
          workflowId: "workflow:thread-workflow-order:run",
          status: "running",
          updatedAt: "2026-04-08T11:10:01.000Z",
        },
        {
          runId: "run-awaiting-approval",
          threadId: thread.id,
          workflowId: "workflow:thread-workflow-order:approval",
          status: "waiting_approval",
          updatedAt: "2026-04-08T11:10:02.000Z",
        },
        {
          runId: "run-completed",
          threadId: thread.id,
          workflowId: "workflow:thread-workflow-order:completed",
          status: "completed",
          updatedAt: "2026-04-08T11:10:03.000Z",
        },
      ],
    });

    expect(projection.workflowActivity).toEqual([
      "workflow:thread-workflow-order:run: running (run-running)",
      "workflow:thread-workflow-order:approval: waiting_approval (run-awaiting-approval)",
      "workflow:thread-workflow-order:completed: completed (run-completed)",
    ]);
  });

  it("projects only the active thread's reconstructed workflow runs from a real session JSONL file", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/workflow-activity.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-workflow-activity",
        cwd: workspace.root,
      });

      const activeThread = createThread({
        id: "thread-active",
        kind: "smithers-workflow",
        objective: "Show active workflow activity",
        status: "waiting_approval",
        createdAt: "2026-04-08T11:20:00.000Z",
        updatedAt: "2026-04-08T11:21:00.000Z",
      });
      const otherThread = createThread({
        id: "thread-other",
        kind: "smithers-workflow",
        objective: "Should not bleed into active thread workflow view",
        status: "running",
        createdAt: "2026-04-08T11:20:00.000Z",
        updatedAt: "2026-04-08T11:21:00.000Z",
      });

      harness.append({ kind: "thread", data: activeThread });
      harness.append({ kind: "thread", data: otherThread });
      harness.append({
        kind: "workflow-run",
        data: {
          runId: "run-active",
          threadId: activeThread.id,
          workflowId: "workflow:thread-active",
          status: "running",
          updatedAt: "2026-04-08T11:20:30.000Z",
          worktreePath: workspace.path("worktrees/active"),
        },
      });
      harness.append({
        kind: "workflow-run",
        data: {
          runId: "run-active",
          threadId: activeThread.id,
          workflowId: "workflow:thread-active",
          status: "waiting_approval",
          updatedAt: "2026-04-08T11:21:00.000Z",
          worktreePath: workspace.path("worktrees/active"),
        },
      });
      harness.append({
        kind: "workflow-run",
        data: {
          runId: "run-other",
          threadId: otherThread.id,
          workflowId: "workflow:thread-other",
          status: "failed",
          updatedAt: "2026-04-08T11:21:00.000Z",
          worktreePath: workspace.path("worktrees/other"),
        },
      });

      const reconstructed = harness.reconstruct();
      const snapshot = createThreadSnapshot(reconstructed, activeThread.id);
      const projection = projectThreadSnapshot(snapshot);

      expect(snapshot.workflowRuns).toHaveLength(1);
      expect(projection.workflowActivity).toEqual([
        "workflow:thread-active: waiting_approval (run-active)",
      ]);
      expect(projection.workflowActivity.join("\n")).not.toContain("thread-other");
      expect(harness.jsonl()).toContain("\"customType\":\"hellm/workflow-run\"");
    });
  });

  it("keeps the workflow section readable in constrained viewports via truncation", () => {
    const thread = createThread({
      id: "thread-workflow-truncation",
      kind: "smithers-workflow",
      objective: "Keep workflow activity legible in narrow frame",
      status: "running",
      createdAt: "2026-04-08T11:30:00.000Z",
      updatedAt: "2026-04-08T11:31:00.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [
        {
          runId: "run-with-a-very-long-identifier",
          threadId: thread.id,
          workflowId: "workflow:thread-workflow-truncation:with-an-intentionally-verbose-id",
          status: "waiting_resume",
          updatedAt: "2026-04-08T11:30:10.000Z",
        },
      ],
    });

    const terminal = new VirtualTerminalHarness(48, 12);
    const viewport = terminal.render(projection);

    const workflowSectionStart = viewport.indexOf("[workflow]");
    expect(workflowSectionStart).toBeGreaterThan(-1);
    expect(viewport[workflowSectionStart + 1]?.endsWith("...")).toBe(true);
  });
});
