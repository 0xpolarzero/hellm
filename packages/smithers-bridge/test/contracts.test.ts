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
  it("authors deterministic workflow metadata for dynamic plans", () => {
    const thread = createThreadFixture({
      id: "thread-authoring",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/authoring",
    });
    const tasks = [
      {
        id: "task-plan",
        outputKey: "plan",
        prompt: "Plan the migration.",
        agent: "pi" as const,
        retryLimit: 2,
      },
      {
        id: "task-verify",
        outputKey: "verification",
        prompt: "Run verification checks.",
        agent: "verification" as const,
        needsApproval: true,
        worktreePath: "/repo/worktrees/authoring",
      },
    ];

    const workflow = authorWorkflow({
      thread,
      objective: "Run dynamic authoring workflow",
      inputEpisodeIds: ["episode-a", "episode-b"],
      tasks,
    });

    expect(workflow).toEqual({
      workflowId: "workflow:thread-authoring",
      name: "Run dynamic authoring workflow",
      objective: "Run dynamic authoring workflow",
      inputEpisodeIds: ["episode-a", "episode-b"],
      tasks,
    });
  });

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

  it("preserves run identity across waiting_resume and approval-gated resume stages", async () => {
    const thread = createThreadFixture({
      id: "thread-smithers-resume-chain",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/resume-chain",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Resume durable smithers workflow until complete",
      inputEpisodeIds: ["episode-prior"],
      tasks: [
        {
          id: "pi-task",
          outputKey: "result",
          prompt: "Continue workflow after persisted pause",
          agent: "pi",
          needsApproval: true,
          retryLimit: 3,
          worktreePath: thread.worktreePath,
        },
      ],
    });
    const runId = "run-resume-chain";
    const waitingResume: SmithersRunResult = {
      run: {
        runId,
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_resume",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath: thread.worktreePath!,
      },
      status: "waiting_resume",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 1, phase: "paused" },
        },
      ],
      waitReason: "workflow paused and must be resumed",
      retryCount: 1,
      episode: createEpisodeFixture({
        id: "episode-smithers-waiting-resume",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_input",
        smithersRunId: runId,
        worktreePath: thread.worktreePath!,
      }),
      isolation: {
        runId,
        runStateStore: "/tmp/run-resume-chain-v1.sqlite",
        sessionEntryIds: ["entry-1"],
      },
    };
    const waitingApproval: SmithersRunResult = {
      run: {
        ...waitingResume.run,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:03:00.000Z",
      },
      status: "waiting_approval",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 2, phase: "ready-for-approval" },
        },
      ],
      approval: {
        nodeId: "pi-task",
        title: "Approve resumed workflow",
        summary: "Resumed workflow now needs approval",
        mode: "needsApproval",
      },
      retryCount: 2,
      episode: createEpisodeFixture({
        id: "episode-smithers-waiting-approval",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: runId,
        worktreePath: thread.worktreePath!,
      }),
      isolation: {
        runId,
        runStateStore: "/tmp/run-resume-chain-v2.sqlite",
        sessionEntryIds: ["entry-1", "entry-2"],
      },
    };
    const completed: SmithersRunResult = {
      run: {
        ...waitingApproval.run,
        status: "completed",
        updatedAt: "2026-04-08T09:05:00.000Z",
      },
      status: "completed",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 3, approved: true, completed: true },
        },
      ],
      retryCount: 3,
      episode: createEpisodeFixture({
        id: "episode-smithers-complete",
        threadId: thread.id,
        source: "smithers",
        status: "completed",
        smithersRunId: runId,
        worktreePath: thread.worktreePath!,
      }),
      isolation: waitingApproval.isolation,
    };

    const bridge = new FakeSmithersWorkflowBridge();
    bridge.enqueueRunResult(waitingResume);
    bridge.enqueueResumeResult(waitingApproval);
    bridge.enqueueResumeResult(completed);

    const first = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
      worktreePath: thread.worktreePath!,
    });
    const second = await bridge.resumeWorkflow({
      runId,
      thread,
      objective: workflow.objective,
    });
    await bridge.approveRun(runId, { approved: true, decidedBy: "tester" });
    const third = await bridge.resumeWorkflow({
      runId,
      thread,
      objective: workflow.objective,
    });

    expect([first.status, second.status, third.status]).toEqual([
      "waiting_resume",
      "waiting_approval",
      "completed",
    ]);
    expect(first.run.runId).toBe(runId);
    expect(second.run.runId).toBe(runId);
    expect(third.run.runId).toBe(runId);
    expect(second.approval?.nodeId).toBe("pi-task");
    expect(third.outputs[0]?.value).toEqual({
      attempt: 3,
      approved: true,
      completed: true,
    });
    expect(bridge.resumeRequests.map((request) => request.runId)).toEqual([
      runId,
      runId,
    ]);
    expect(bridge.approvals[0]?.runId).toBe(runId);
    expect(first.isolation?.runStateStore).toContain("v1");
    expect(second.isolation?.runStateStore).toContain("v2");
    expect(translateSmithersRunToEpisode(third)).toMatchObject({
      id: "episode-smithers-complete",
      status: "completed",
      smithersRunId: runId,
    });
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
