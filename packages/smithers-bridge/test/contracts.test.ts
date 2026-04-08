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

  it("models a looped retry execution across waiting_resume attempts before completion", async () => {
    const thread = createThreadFixture({
      id: "thread-smithers-retry",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/retry",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Retry until the workflow passes verification",
      inputEpisodeIds: ["episode-before-retry"],
      tasks: [
        {
          id: "retry-task",
          outputKey: "result",
          prompt: "Implement and verify",
          agent: "pi",
          retryLimit: 3,
          worktreePath: thread.worktreePath,
        },
      ],
    });
    const bridge = new FakeSmithersWorkflowBridge();
    bridge.enqueueRunResult({
      run: {
        runId: "run-retry",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_resume",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath: thread.worktreePath,
      },
      status: "waiting_resume",
      outputs: [
        {
          nodeId: "retry-task",
          schema: "result",
          value: { attempt: 1, passed: false },
        },
      ],
      episode: createEpisodeFixture({
        id: "episode-retry-1",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_input",
        smithersRunId: "run-retry",
        worktreePath: thread.worktreePath!,
        followUpSuggestions: ["Retry attempt 1 failed verification; resume run."],
      }),
      waitReason: "Attempt 1 failed verification.",
      retryCount: 1,
    });
    bridge.enqueueResumeResult({
      run: {
        runId: "run-retry",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_resume",
        updatedAt: "2026-04-08T09:01:00.000Z",
        worktreePath: thread.worktreePath,
      },
      status: "waiting_resume",
      outputs: [
        {
          nodeId: "retry-task",
          schema: "result",
          value: { attempt: 2, passed: false },
        },
      ],
      episode: createEpisodeFixture({
        id: "episode-retry-2",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_input",
        smithersRunId: "run-retry",
        worktreePath: thread.worktreePath!,
        followUpSuggestions: ["Retry attempt 2 failed verification; resume run."],
      }),
      waitReason: "Attempt 2 failed verification.",
      retryCount: 2,
    });
    bridge.enqueueResumeResult({
      run: {
        runId: "run-retry",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "completed",
        updatedAt: "2026-04-08T09:02:00.000Z",
        worktreePath: thread.worktreePath,
      },
      status: "completed",
      outputs: [
        {
          nodeId: "retry-task",
          schema: "result",
          value: { attempt: 3, passed: true },
        },
      ],
      episode: createEpisodeFixture({
        id: "episode-retry-3",
        threadId: thread.id,
        source: "smithers",
        status: "completed",
        smithersRunId: "run-retry",
        worktreePath: thread.worktreePath!,
      }),
      retryCount: 3,
    });

    const first = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
      worktreePath: thread.worktreePath!,
    });
    const second = await bridge.resumeWorkflow({
      runId: "run-retry",
      thread,
      objective: workflow.objective,
    });
    const third = await bridge.resumeWorkflow({
      runId: "run-retry",
      thread,
      objective: workflow.objective,
    });

    expect(bridge.runRequests).toHaveLength(1);
    expect(bridge.runRequests[0]?.workflow.tasks[0]?.retryLimit).toBe(3);
    expect(bridge.resumeRequests.map((request) => request.runId)).toEqual([
      "run-retry",
      "run-retry",
    ]);
    expect(first.status).toBe("waiting_resume");
    expect(first.waitReason).toBe("Attempt 1 failed verification.");
    expect(first.retryCount).toBe(1);
    expect(second.status).toBe("waiting_resume");
    expect(second.waitReason).toBe("Attempt 2 failed verification.");
    expect(second.retryCount).toBe(2);
    expect(third.status).toBe("completed");
    expect(third.retryCount).toBe(3);
    expect(third.outputs[0]?.value).toEqual({ attempt: 3, passed: true });
    expect(translateSmithersRunToEpisode(first).id).toBe("episode-retry-1");
    expect(translateSmithersRunToEpisode(second).id).toBe("episode-retry-2");
    expect(translateSmithersRunToEpisode(third).id).toBe("episode-retry-3");
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
  it.todo(
    "concrete smithers bridge execution enforces retryLimit exhaustion behavior without rerunning already completed workflow nodes",
    () => {},
  );
});
