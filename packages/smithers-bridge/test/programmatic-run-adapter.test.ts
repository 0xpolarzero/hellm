import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  authorWorkflow,
  createSmithersWorkflowBridge,
} from "@hellm/smithers-bridge";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  createThreadFixture,
  runBunModule,
  withTempWorkspace,
} from "@hellm/test-support";

describe("smithers.programmaticRunAdapter", () => {
  it("exposes a disabled default adapter and explicit Not implemented behavior across every programmatic operation", async () => {
    const bridge = createSmithersWorkflowBridge();
    const thread = createThreadFixture({
      id: "adapter-default-thread",
      kind: "smithers-workflow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Default adapter behavior",
      inputEpisodeIds: [],
      tasks: [],
    });

    expect(bridge.enabled).toBe(false);
    expect(bridge.engine).toBe("smithers");
    await expect(
      bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: "/repo",
        workflow,
      }),
    ).rejects.toThrow("Not implemented");
    await expect(
      bridge.resumeWorkflow({
        runId: "adapter-default-run",
        thread,
        objective: workflow.objective,
      }),
    ).rejects.toThrow("Not implemented");
    await expect(
      bridge.approveRun("adapter-default-run", { approved: true }),
    ).rejects.toThrow("Not implemented");
    await expect(
      bridge.denyRun("adapter-default-run", { approved: false }),
    ).rejects.toThrow("Not implemented");
  });

  it("propagates real worktree paths and durable run state through the fake adapter request queues", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("feature-adapter");
      const thread = createThreadFixture({
        id: "adapter-fake-thread",
        kind: "smithers-workflow",
        worktreePath,
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Run fake adapter flow",
        inputEpisodeIds: ["episode-previous"],
        tasks: [
          {
            id: "pi-task",
            outputKey: "result",
            prompt: "Implement in worktree",
            agent: "pi",
            worktreePath,
          },
        ],
      });
      const runEpisode = createEpisodeFixture({
        id: "adapter-run-episode",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_approval",
        worktreePath,
        smithersRunId: "adapter-fake-run",
      });
      const resumeEpisode = createEpisodeFixture({
        id: "adapter-resume-episode",
        threadId: thread.id,
        source: "smithers",
        status: "completed",
        worktreePath,
        smithersRunId: "adapter-fake-run",
      });

      const bridge = new FakeSmithersWorkflowBridge();
      bridge.enqueueRunResult({
        run: {
          runId: "adapter-fake-run",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "waiting_approval",
        outputs: [],
        episode: runEpisode,
        approval: {
          nodeId: "pi-task",
          title: "Approve run",
          summary: "Approve before resume",
          mode: "needsApproval",
        },
        isolation: {
          runId: "adapter-fake-run",
          runStateStore: workspace.path(".smithers/adapter-fake-run.sqlite"),
          sessionEntryIds: ["entry-1"],
        },
      });
      bridge.enqueueResumeResult({
        run: {
          runId: "adapter-fake-run",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
          worktreePath,
        },
        status: "completed",
        outputs: [],
        episode: resumeEpisode,
      });

      const first = await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
        worktreePath,
      });
      await bridge.approveRun("adapter-fake-run", { approved: true });
      await bridge.denyRun("adapter-fake-run", { approved: false });
      const resumed = await bridge.resumeWorkflow({
        runId: "adapter-fake-run",
        thread,
        objective: workflow.objective,
      });

      expect(bridge.runRequests[0]?.worktreePath).toBe(worktreePath);
      expect(bridge.runRequests[0]?.workflow.tasks[0]?.worktreePath).toBe(
        worktreePath,
      );
      expect(bridge.runRequests[0]?.workflow.inputEpisodeIds).toEqual([
        "episode-previous",
      ]);
      expect(first.isolation?.runStateStore).toContain(
        "adapter-fake-run.sqlite",
      );
      expect(bridge.approvals).toEqual([
        { runId: "adapter-fake-run", decision: { approved: true } },
      ]);
      expect(bridge.denials).toEqual([
        { runId: "adapter-fake-run", decision: { approved: false } },
      ]);
      expect(bridge.resumeRequests[0]?.runId).toBe("adapter-fake-run");
      expect(resumed.episode.id).toBe("adapter-resume-episode");
    });
  });

  it("returns deterministic queue-empty errors from the fake adapter for run and resume", async () => {
    const bridge = new FakeSmithersWorkflowBridge();
    const thread = createThreadFixture({
      id: "adapter-queue-errors",
      kind: "smithers-workflow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Queue validation",
      inputEpisodeIds: [],
      tasks: [],
    });

    await expect(
      bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: "/repo",
        workflow,
      }),
    ).rejects.toThrow("No queued fake Smithers run result.");
    await expect(
      bridge.resumeWorkflow({
        runId: "missing-resume",
        thread,
        objective: workflow.objective,
      }),
    ).rejects.toThrow("No queued fake Smithers resume result.");
  });

  it("holds the Not implemented adapter contract through a real Bun process boundary", () => {
    const entryPath = resolve(import.meta.dir, "fixtures/default-bridge-smoke.ts");
    const repoRoot = resolve(import.meta.dir, "../../../");
    const result = runBunModule({
      entryPath,
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      enabled: false,
      engine: "smithers",
      errors: [
        "Not implemented",
        "Not implemented",
        "Not implemented",
        "Not implemented",
      ],
    });
  });

  it.todo(
    "adapts createSmithersWorkflowBridge to call the real Smithers runtime once wired, including run, resume, and approval decisions",
    () => {},
  );
});
