import { describe, expect, it, test } from "bun:test";
import { authorWorkflow, type SmithersRunResult } from "@hellm/smithers-bridge";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  createThreadFixture,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/smithers-bridge pi-agent task tool scoping contract", () => {
  it("keeps pi-agent task payloads bounded to the current task spec while running against a real temp workspace", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("feature-tool-scoping");
      const thread = createThreadFixture({
        id: "thread-tool-scope-gap",
        kind: "smithers-workflow",
        worktreePath,
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Implement a scoped change via smithers workflow.",
        inputEpisodeIds: ["episode-0"],
        tasks: [
          {
            id: "pi-task",
            outputKey: "result",
            prompt: "Apply the minimal code change.",
            agent: "pi",
            worktreePath,
          },
        ],
      });
      const runResult: SmithersRunResult = {
        run: {
          runId: "run-tool-scope-gap",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "completed",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "episode-tool-scope-gap",
          threadId: thread.id,
          source: "smithers",
          status: "completed",
          smithersRunId: "run-tool-scope-gap",
          worktreePath,
        }),
      };
      const bridge = new FakeSmithersWorkflowBridge();
      bridge.enqueueRunResult(runResult);

      await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
        worktreePath,
      });

      const task = bridge.runRequests[0]?.workflow.tasks[0];
      expect(task).toEqual({
        id: "pi-task",
        outputKey: "result",
        prompt: "Apply the minimal code change.",
        agent: "pi",
        worktreePath,
      });
      expect(task).toBeDefined();
      expect("toolScope" in (task as Record<string, unknown>)).toBe(false);
    });
  });

  test.todo(
    "exposes first-class per-task tool allow/deny lists so smithers pi-agent tasks do not rely on prompt text for tool limits",
    () => {},
  );
  test.todo(
    "supports explicit write-root boundaries for smithers pi-agent tasks and carries them through run/resume requests",
    () => {},
  );
  test.todo(
    "supports fail-closed read-only task mode that blocks edit-capable tool grants for smithers pi-agent tasks",
    () => {},
  );
});
