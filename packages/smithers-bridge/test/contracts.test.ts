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

  it("preserves waiting_resume run metadata and allows deterministic resume continuation through the fake bridge", async () => {
    const thread = createThreadFixture({
      id: "thread-smithers-waiting-resume",
      kind: "smithers-workflow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Wait for an external resume signal",
      inputEpisodeIds: ["episode-prior"],
      tasks: [
        {
          id: "resume-task",
          outputKey: "resume-result",
          prompt: "Pause until external trigger is ready",
          agent: "pi",
        },
      ],
    });
    const waitingEpisode = createEpisodeFixture({
      id: "episode-waiting-resume",
      threadId: thread.id,
      source: "smithers",
      status: "waiting_input",
      smithersRunId: "run-waiting-resume",
    });
    const completedEpisode = createEpisodeFixture({
      id: "episode-waiting-resume-done",
      threadId: thread.id,
      source: "smithers",
      status: "completed",
      smithersRunId: "run-waiting-resume",
    });
    const waitingResult: SmithersRunResult = {
      run: {
        runId: "run-waiting-resume",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_resume",
        updatedAt: "2026-04-08T09:10:00.000Z",
      },
      status: "waiting_resume",
      outputs: [],
      episode: waitingEpisode,
      waitReason: "Awaiting external event payload before continuing.",
      isolation: {
        runId: "run-waiting-resume",
        runStateStore: "/tmp/run-waiting-resume.sqlite",
        sessionEntryIds: ["entry-waiting-resume"],
      },
    };
    const resumedResult: SmithersRunResult = {
      run: {
        runId: "run-waiting-resume",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "completed",
        updatedAt: "2026-04-08T09:12:00.000Z",
      },
      status: "completed",
      outputs: [
        {
          nodeId: "resume-task",
          schema: "resume-result",
          value: { resumed: true },
        },
      ],
      episode: completedEpisode,
      isolation: waitingResult.isolation,
    };

    const bridge = new FakeSmithersWorkflowBridge();
    bridge.enqueueRunResult(waitingResult);
    bridge.enqueueResumeResult(resumedResult);

    const first = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
    });
    const resumed = await bridge.resumeWorkflow({
      runId: "run-waiting-resume",
      thread,
      objective: workflow.objective,
    });

    expect(first.status).toBe("waiting_resume");
    expect(first.run.status).toBe("waiting_resume");
    expect(first.waitReason).toBe(
      "Awaiting external event payload before continuing.",
    );
    expect(first.episode.status).toBe("waiting_input");
    expect(first.isolation?.runStateStore).toBe("/tmp/run-waiting-resume.sqlite");
    expect(resumed.status).toBe("completed");
    expect(resumed.outputs[0]?.value).toEqual({ resumed: true });
    expect(bridge.resumeRequests[0]?.runId).toBe("run-waiting-resume");
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
