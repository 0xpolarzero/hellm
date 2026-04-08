import { describe, expect, it } from "bun:test";
import {
  authorWorkflow,
  createSmithersWorkflowBridge,
  translateSmithersRunToEpisode,
  type SmithersRunResult,
} from "@hellm/smithers-bridge";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  createThreadFixture,
} from "@hellm/test-support";

describe("@hellm/smithers-bridge contract surface", () => {
  it("ships a default bridge that is explicit about missing implementation", async () => {
    const bridge = createSmithersWorkflowBridge();
    const thread = createThreadFixture({ id: "thread-smithers", kind: "smithers-workflow" });

    await expect(
      bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: "Run workflow",
        cwd: "/repo",
        workflow: authorWorkflow({
          thread,
          objective: "Run workflow",
          inputEpisodeIds: [],
          tasks: [],
        }),
      }),
    ).rejects.toThrow("Not implemented");
  });

  it("surfaces explicit not-implemented errors for approval-gate control methods", async () => {
    const bridge = createSmithersWorkflowBridge();
    const thread = createThreadFixture({
      id: "thread-smithers-approval",
      kind: "smithers-workflow",
    });

    await expect(
      bridge.resumeWorkflow({
        runId: "run-approval",
        thread,
        objective: "Resume workflow",
      }),
    ).rejects.toThrow("Not implemented");
    await expect(
      bridge.approveRun("run-approval", {
        approved: true,
        decidedBy: "reviewer",
      }),
    ).rejects.toThrow("Not implemented");
    await expect(
      bridge.denyRun("run-approval", {
        approved: false,
        decidedBy: "reviewer",
      }),
    ).rejects.toThrow("Not implemented");
  });

  it("preserves both Smithers approval-gate modes and captures approve/deny decisions in the fake bridge", async () => {
    const bridge = new FakeSmithersWorkflowBridge();
    const thread = createThreadFixture({
      id: "thread-smithers-modes",
      kind: "smithers-workflow",
    });

    const needsApprovalWorkflow = authorWorkflow({
      thread,
      objective: "Gate task output for approval",
      inputEpisodeIds: [],
      tasks: [
        {
          id: "task-needs-approval",
          outputKey: "result",
          prompt: "Implement change and wait for sign-off",
          agent: "pi",
          needsApproval: true,
        },
      ],
    });
    const approvalNodeWorkflow = authorWorkflow({
      thread,
      objective: "Ask for explicit decision node",
      inputEpisodeIds: [],
      tasks: [
        {
          id: "task-approval-node",
          outputKey: "result",
          prompt: "Pause on explicit approval node",
          agent: "pi",
        },
      ],
    });

    bridge.enqueueRunResult({
      run: {
        runId: "run-needs-approval",
        threadId: thread.id,
        workflowId: needsApprovalWorkflow.workflowId,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "waiting_approval",
      outputs: [],
      approval: {
        nodeId: "task-needs-approval",
        title: "Approve task output",
        summary: "Task is gated by needsApproval.",
        mode: "needsApproval",
      },
      episode: createEpisodeFixture({
        id: "episode-needs-approval",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: "run-needs-approval",
      }),
    });
    bridge.enqueueRunResult({
      run: {
        runId: "run-approval-node",
        threadId: thread.id,
        workflowId: approvalNodeWorkflow.workflowId,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:01:00.000Z",
      },
      status: "waiting_approval",
      outputs: [],
      approval: {
        nodeId: "task-approval-node",
        title: "Approve explicit node",
        summary: "Workflow is paused on an Approval node.",
        mode: "approval-node",
      },
      episode: createEpisodeFixture({
        id: "episode-approval-node",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: "run-approval-node",
      }),
    });

    const needsApprovalResult = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: needsApprovalWorkflow.objective,
      cwd: "/repo",
      workflow: needsApprovalWorkflow,
    });
    await bridge.approveRun("run-needs-approval", {
      approved: true,
      note: "Approved output.",
      decidedAt: "2026-04-08T09:02:00.000Z",
      decidedBy: "maintainer",
    });

    const approvalNodeResult = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: approvalNodeWorkflow.objective,
      cwd: "/repo",
      workflow: approvalNodeWorkflow,
    });
    await bridge.denyRun("run-approval-node", {
      approved: false,
      note: "Denied explicit decision node.",
      decidedAt: "2026-04-08T09:03:00.000Z",
      decidedBy: "maintainer",
    });

    expect(needsApprovalResult.status).toBe("waiting_approval");
    expect(needsApprovalResult.approval?.mode).toBe("needsApproval");
    expect(approvalNodeResult.status).toBe("waiting_approval");
    expect(approvalNodeResult.approval?.mode).toBe("approval-node");
    expect(needsApprovalWorkflow.tasks[0]?.needsApproval).toBe(true);
    expect(approvalNodeWorkflow.tasks[0]?.needsApproval).toBeUndefined();
    expect(bridge.approvals).toEqual([
      {
        runId: "run-needs-approval",
        decision: {
          approved: true,
          note: "Approved output.",
          decidedAt: "2026-04-08T09:02:00.000Z",
          decidedBy: "maintainer",
        },
      },
    ]);
    expect(bridge.denials).toEqual([
      {
        runId: "run-approval-node",
        decision: {
          approved: false,
          note: "Denied explicit decision node.",
          decidedAt: "2026-04-08T09:03:00.000Z",
          decidedBy: "maintainer",
        },
      },
    ]);
    expect(translateSmithersRunToEpisode(needsApprovalResult).id).toBe(
      "episode-needs-approval",
    );
    expect(translateSmithersRunToEpisode(approvalNodeResult).id).toBe(
      "episode-approval-node",
    );
  });

  it("authors deterministic workflow plans and preserves typed outputs, approvals, retries, and worktree state through the fake bridge", async () => {
    const thread = createThreadFixture({
      id: "thread-smithers",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/flow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Run a durable workflow",
      inputEpisodeIds: ["episode-0"],
      tasks: [
        {
          id: "pi-task",
          outputKey: "result",
          prompt: "Implement the change",
          agent: "pi",
          needsApproval: true,
          retryLimit: 2,
          worktreePath: thread.worktreePath,
        },
      ],
    });
    const waitingEpisode = createEpisodeFixture({
      id: "episode-waiting",
      threadId: thread.id,
      source: "smithers",
      status: "waiting_approval",
      worktreePath: thread.worktreePath!,
      smithersRunId: "run-1",
    });
    const completedEpisode = createEpisodeFixture({
      id: "episode-complete",
      threadId: thread.id,
      source: "smithers",
      status: "completed",
      worktreePath: thread.worktreePath!,
      smithersRunId: "run-1",
    });
    const waitingResult: SmithersRunResult = {
      run: {
        runId: "run-1",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath: thread.worktreePath!,
      },
      status: "waiting_approval",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 1 },
        },
      ],
      episode: waitingEpisode,
      approval: {
        nodeId: "pi-task",
        title: "Approve workflow step",
        summary: "Needs approval before continuing.",
        mode: "needsApproval",
      },
      retryCount: 1,
      isolation: {
        runId: "run-1",
        runStateStore: "/tmp/run-1.sqlite",
        sessionEntryIds: ["entry-1"],
      },
    };
    const resumeResult: SmithersRunResult = {
      run: {
        ...waitingResult.run,
        status: "completed",
        updatedAt: "2026-04-08T09:05:00.000Z",
      },
      status: "completed",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 2, approved: true },
        },
      ],
      episode: completedEpisode,
      retryCount: 2,
      isolation: waitingResult.isolation,
    };

    const bridge = new FakeSmithersWorkflowBridge();
    bridge.enqueueRunResult(waitingResult);
    bridge.enqueueResumeResult(resumeResult);

    const first = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
      worktreePath: thread.worktreePath!,
    });
    await bridge.approveRun("run-1", {
      approved: true,
      decidedBy: "tester",
    });
    const resumed = await bridge.resumeWorkflow({
      runId: "run-1",
      thread,
      objective: workflow.objective,
    });

    expect(workflow.inputEpisodeIds).toEqual(["episode-0"]);
    expect(workflow.tasks).toHaveLength(1);
    expect(workflow.tasks[0]?.agent).toBe("pi");
    expect(workflow.tasks[0]?.id).toBe("pi-task");
    expect(first.approval?.nodeId).toBe("pi-task");
    expect(first.retryCount).toBe(1);
    expect(first.run.worktreePath).toBe("/repo/worktrees/flow");
    expect(resumed.outputs[0]?.value).toEqual({ attempt: 2, approved: true });
    expect(bridge.approvals[0]?.runId).toBe("run-1");
    expect(translateSmithersRunToEpisode(resumed).id).toBe("episode-complete");
  });

  it.todo(
    "pi-agent tasks inside smithers carry explicit scoped context from the orchestrator without assuming Slate internals",
    () => {},
  );
  it.todo(
    "pi-agent tasks inside smithers carry explicit tool scoping for bounded execution",
    () => {},
  );
  it.todo(
    "pi-agent tasks inside smithers carry explicit completion conditions for episode handoff",
    () => {},
  );
});
