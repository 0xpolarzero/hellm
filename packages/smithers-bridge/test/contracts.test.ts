import { describe, expect, it } from "bun:test";
import {
  authorWorkflow,
  createSmithersWorkflowBridge,
  translateSmithersRunToEpisode,
  type SmithersRunResult,
} from "@hellm/smithers-bridge";
import {
  FakeSmithersWorkflowBridge,
  createArtifactFixture,
  createEpisodeFixture,
  createThreadFixture,
  createVerificationFixture,
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

  it("keeps a smithers-supplied normalized episode unchanged during translation", () => {
    const thread = createThreadFixture({
      id: "thread-smithers-normalization",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/episode-normalization",
    });
    const episode = createEpisodeFixture({
      id: "episode-smithers-normalized",
      threadId: thread.id,
      source: "smithers",
      status: "completed_with_issues",
      conclusions: ["Workflow run completed with follow-up work."],
      changedFiles: ["packages/cli/src/index.ts"],
      artifacts: [
        createArtifactFixture({
          id: "artifact-smithers-log",
          kind: "log",
          path: "/repo/worktrees/episode-normalization/logs/run.log",
          description: "Smithers workflow log",
        }),
      ],
      verification: [
        createVerificationFixture({
          id: "verification-smithers-test",
          kind: "test",
          status: "failed",
          summary: "A single contract assertion is still failing.",
        }),
      ],
      unresolvedIssues: ["Resolve the remaining failing assertion before merge."],
      followUpSuggestions: ["Run targeted smithers normalization tests after fix."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
        sourceRef: "smithers://run-smithers-normalization",
        notes: "Episode came from a durable smithers workflow run.",
      },
      smithersRunId: "run-smithers-normalization",
      worktreePath: thread.worktreePath!,
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:04:00.000Z",
      inputEpisodeIds: ["episode-prior-normalization"],
    });
    const runResult: SmithersRunResult = {
      run: {
        runId: "run-smithers-normalization",
        threadId: thread.id,
        workflowId: `workflow:${thread.id}`,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:04:00.000Z",
        worktreePath: thread.worktreePath!,
      },
      status: "waiting_approval",
      outputs: [],
      episode,
      approval: {
        nodeId: "approve-normalized",
        title: "Approval not yet applied to run metadata",
        summary: "Run state can lag episode translation in tests.",
        mode: "approval-node",
      },
    };

    const translated = translateSmithersRunToEpisode(runResult);

    expect(translated).toBe(episode);
    expect(translated.status).toBe("completed_with_issues");
    expect(translated.smithersRunId).toBe("run-smithers-normalization");
    expect(translated.worktreePath).toBe(thread.worktreePath);
    expect(translated.inputEpisodeIds).toEqual(["episode-prior-normalization"]);
    expect(translated.artifacts[0]?.id).toBe("artifact-smithers-log");
    expect(translated.verification[0]?.id).toBe("verification-smithers-test");
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
