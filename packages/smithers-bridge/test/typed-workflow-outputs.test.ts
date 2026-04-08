import { describe, expect, it } from "bun:test";
import {
  authorWorkflow,
  translateSmithersRunToEpisode,
  type SmithersRunResult,
} from "@hellm/smithers-bridge";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  createThreadFixture,
} from "@hellm/test-support";

describe("smithers typed workflow output contracts", () => {
  it("authors deterministic task output contracts for smithers workflows", () => {
    const thread = createThreadFixture({
      id: "thread-typed-contract",
      kind: "smithers-workflow",
    });
    const taskTemplate = [
      {
        id: "plan-task",
        outputKey: "plan",
        prompt: "Create a rollout plan.",
        agent: "pi" as const,
        retryLimit: 1,
      },
      {
        id: "verify-task",
        outputKey: "verification",
        prompt: "Run verification checks.",
        agent: "verification" as const,
      },
    ];

    const authoredA = authorWorkflow({
      thread,
      objective: "Produce typed outputs",
      inputEpisodeIds: ["episode-0"],
      tasks: taskTemplate.map((task) => ({ ...task })),
    });
    const authoredB = authorWorkflow({
      thread,
      objective: "Produce typed outputs",
      inputEpisodeIds: ["episode-0"],
      tasks: taskTemplate.map((task) => ({ ...task })),
    });

    expect(authoredA.workflowId).toBe("workflow:thread-typed-contract");
    expect(authoredA).toEqual(authoredB);
    expect(
      authoredA.tasks.map((task) => ({
        id: task.id,
        outputKey: task.outputKey,
      })),
    ).toEqual([
      { id: "plan-task", outputKey: "plan" },
      { id: "verify-task", outputKey: "verification" },
    ]);
  });

  it("preserves typed outputs through run, approval, denial, and resume boundaries", async () => {
    const thread = createThreadFixture({
      id: "thread-typed-outputs",
      kind: "smithers-workflow",
      worktreePath: "/repo/.worktrees/typed",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Run typed output workflow",
      inputEpisodeIds: ["episode-prior"],
      tasks: [
        {
          id: "plan-task",
          outputKey: "plan",
          prompt: "Plan the migration.",
          agent: "pi",
          needsApproval: true,
          retryLimit: 2,
          worktreePath: thread.worktreePath,
        },
        {
          id: "verify-task",
          outputKey: "verification",
          prompt: "Verify migration safety.",
          agent: "verification",
          worktreePath: thread.worktreePath,
        },
      ],
    });

    const waitingEpisode = createEpisodeFixture({
      id: "episode-typed-waiting",
      threadId: thread.id,
      source: "smithers",
      status: "waiting_approval",
      smithersRunId: "run-typed",
      worktreePath: thread.worktreePath!,
    });
    const completedEpisode = createEpisodeFixture({
      id: "episode-typed-completed",
      threadId: thread.id,
      source: "smithers",
      status: "completed",
      smithersRunId: "run-typed",
      worktreePath: thread.worktreePath!,
    });

    const initialOutputs: SmithersRunResult["outputs"] = [
      {
        nodeId: "plan-task",
        schema: "plan",
        value: {
          summary: "Migration strategy prepared",
          files: ["packages/a.ts", "packages/b.ts"],
          risk: { level: "medium", mitigations: ["run tests", "stage rollout"] },
        },
      },
      {
        nodeId: "verify-task",
        schema: "verification",
        value: {
          records: [{ kind: "test", status: "passed" }],
          artifacts: ["/tmp/report.json"],
        },
      },
    ];
    const resumedOutputs: SmithersRunResult["outputs"] = [
      {
        nodeId: "plan-task",
        schema: "plan",
        value: {
          summary: "Migration strategy approved",
          attempts: 2,
          approved: true,
        },
      },
      {
        nodeId: "verify-task",
        schema: "verification",
        value: {
          records: [
            { kind: "build", status: "passed" },
            { kind: "test", status: "passed" },
          ],
          artifacts: ["/tmp/report-final.json"],
        },
      },
    ];

    const bridge = new FakeSmithersWorkflowBridge();
    bridge.enqueueRunResult({
      run: {
        runId: "run-typed",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath: thread.worktreePath!,
      },
      status: "waiting_approval",
      outputs: initialOutputs,
      episode: waitingEpisode,
      approval: {
        nodeId: "plan-task",
        title: "Approve plan output",
        summary: "Approve typed plan output before verification.",
        mode: "needsApproval",
      },
      retryCount: 1,
    });
    bridge.enqueueResumeResult({
      run: {
        runId: "run-typed",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "completed",
        updatedAt: "2026-04-08T09:05:00.000Z",
        worktreePath: thread.worktreePath!,
      },
      status: "completed",
      outputs: resumedOutputs,
      episode: completedEpisode,
      retryCount: 2,
    });

    const first = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
      worktreePath: thread.worktreePath!,
    });
    const initialOutputsSnapshot = structuredClone(first.outputs);
    await bridge.approveRun("run-typed", {
      approved: true,
      note: "Looks good",
      decidedBy: "reviewer-a",
    });
    await bridge.denyRun("run-typed", {
      approved: false,
      note: "Demonstrate denial path recording",
      decidedBy: "reviewer-b",
    });
    const resumed = await bridge.resumeWorkflow({
      runId: "run-typed",
      thread,
      objective: workflow.objective,
    });

    expect(first.outputs).toEqual(initialOutputs);
    expect(first.outputs).toEqual(initialOutputsSnapshot);
    expect(
      Object.fromEntries(
        workflow.tasks.map((task) => [task.id, task.outputKey]),
      ),
    ).toEqual(
      Object.fromEntries(
        first.outputs.map((output) => [output.nodeId, output.schema]),
      ),
    );
    expect(bridge.approvals).toEqual([
      {
        runId: "run-typed",
        decision: {
          approved: true,
          note: "Looks good",
          decidedBy: "reviewer-a",
        },
      },
    ]);
    expect(bridge.denials).toEqual([
      {
        runId: "run-typed",
        decision: {
          approved: false,
          note: "Demonstrate denial path recording",
          decidedBy: "reviewer-b",
        },
      },
    ]);
    expect(resumed.outputs).toEqual(resumedOutputs);
    expect(translateSmithersRunToEpisode(resumed)).toBe(completedEpisode);
  });

  it.todo(
    "persists typed smithers outputs into durable session or episode fields once the session model exposes a typed-output slot",
    () => {},
  );
});
