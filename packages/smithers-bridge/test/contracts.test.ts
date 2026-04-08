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

  it("translates smithers run results into episodes without dropping rich episode fields", () => {
    const artifact = createArtifactFixture({
      id: "artifact-smithers-translation",
      kind: "log",
      path: "/repo/.smithers/logs/run-translation.log",
      description: "Smithers workflow execution log",
    });
    const verification = createVerificationFixture({
      id: "verification-smithers-translation",
      kind: "integration",
      status: "failed",
      summary: "Integration checks failed in workflow sandbox.",
      artifactIds: [artifact.id],
    });
    const translatedEpisode = createEpisodeFixture({
      id: "episode-smithers-translation",
      threadId: "thread-smithers-translation",
      source: "smithers",
      status: "completed_with_issues",
      objective: "Translate smithers run output to a reusable episode.",
      conclusions: ["Workflow completed with known integration failures."],
      changedFiles: ["packages/orchestrator/src/index.ts"],
      artifacts: [artifact],
      verification: [verification],
      unresolvedIssues: ["Integration test flakes in linux-arm64 container."],
      followUpSuggestions: ["Re-run integration verification after dependency bump."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
        sourceRef: "workflow:thread-smithers-translation/task-verify",
        notes: "Translated from smithers workflow run output.",
      },
      smithersRunId: "run-translation",
      worktreePath: "/repo/.worktrees/feature-translation",
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:05:00.000Z",
      inputEpisodeIds: ["episode-prior-a", "episode-prior-b"],
    });
    const runResult: SmithersRunResult = {
      run: {
        runId: "run-translation",
        threadId: "thread-smithers-translation",
        workflowId: "workflow:thread-smithers-translation",
        status: "failed",
        updatedAt: "2026-04-08T09:06:00.000Z",
        worktreePath: "/repo/.worktrees/feature-translation",
      },
      status: "failed",
      outputs: [
        {
          nodeId: "task-verify",
          schema: "verification",
          value: {
            failedKinds: ["integration"],
            artifactId: artifact.id,
          },
        },
      ],
      waitReason: "manual-inspection-required",
      retryCount: 3,
      episode: translatedEpisode,
    };

    const episode = translateSmithersRunToEpisode(runResult);

    expect(episode).toEqual(translatedEpisode);
    expect(episode.status).toBe("completed_with_issues");
    expect(episode.artifacts).toEqual([artifact]);
    expect(episode.verification).toEqual([verification]);
    expect(episode.smithersRunId).toBe("run-translation");
    expect(episode.inputEpisodeIds).toEqual([
      "episode-prior-a",
      "episode-prior-b",
    ]);
    expect(episode.followUpSuggestions).toEqual([
      "Re-run integration verification after dependency bump.",
    ]);
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
