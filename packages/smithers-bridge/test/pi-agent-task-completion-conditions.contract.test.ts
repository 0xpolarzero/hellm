import { describe, expect, test } from "bun:test";
import {
  authorWorkflow,
  type SmithersRunResult,
  type WorkflowTaskSpec,
} from "@hellm/smithers-bridge";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  createThreadFixture,
  withTempWorkspace,
} from "@hellm/test-support";

type HasDedicatedCompletionConditionField =
  "completionCondition" extends keyof WorkflowTaskSpec ? true : false;

function assertFalse<T extends false>(_value: T): void {}

describe("@hellm/smithers-bridge pi-agent task completion-condition contract", () => {
  test("documents the current task contract gap: no dedicated completion-condition field", () => {
    assertFalse<HasDedicatedCompletionConditionField>(false);

    const task: WorkflowTaskSpec = {
      id: "pi-task",
      outputKey: "episode-handoff",
      prompt:
        "Implement the change and stop once an episode can be handed back to the orchestrator.",
      agent: "pi",
      retryLimit: 1,
    };
    const workflow = authorWorkflow({
      thread: createThreadFixture({
        id: "thread-completion-gap",
        kind: "smithers-workflow",
      }),
      objective: "Document current completion-condition contract",
      inputEpisodeIds: [],
      tasks: [task],
    });
    const authoredTask = workflow.tasks[0];

    expect(authoredTask).toBeDefined();
    expect("completionCondition" in (authoredTask as object)).toBe(false);
    expect("completion" in (authoredTask as object)).toBe(false);
    expect(authoredTask?.outputKey).toBe("episode-handoff");
  });

  test("preserves prompt-level handoff boundaries through bridge requests until dedicated completion conditions exist", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("completion-boundary");
      const thread = createThreadFixture({
        id: "thread-completion-boundary",
        kind: "smithers-workflow",
        worktreePath,
      });
      const handoffPrompt =
        "Apply the fix and stop once a single completed episode is ready for orchestrator reconciliation.";
      const workflow = authorWorkflow({
        thread,
        objective: "Run a bounded pi task",
        inputEpisodeIds: ["episode-0"],
        tasks: [
          {
            id: "pi-task",
            outputKey: "episode-handoff",
            prompt: handoffPrompt,
            agent: "pi",
            worktreePath,
          },
        ],
      });
      const completedEpisode = createEpisodeFixture({
        id: "episode-completion-boundary",
        threadId: thread.id,
        source: "smithers",
        status: "completed",
        smithersRunId: "run-completion-boundary",
        worktreePath,
      });
      const runResult: SmithersRunResult = {
        run: {
          runId: "run-completion-boundary",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "completed",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "completed",
        outputs: [
          {
            nodeId: "pi-task",
            schema: "episode-handoff",
            value: { delivered: true },
          },
        ],
        episode: completedEpisode,
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

      const capturedTask = bridge.runRequests[0]?.workflow.tasks[0];
      expect(capturedTask).toBeDefined();
      expect(capturedTask?.prompt).toBe(handoffPrompt);
      expect("completionCondition" in (capturedTask as object)).toBe(false);
      expect(capturedTask?.outputKey).toBe("episode-handoff");
    });
  });

  test.todo(
    "adds a typed completion-condition field for pi-agent workflow tasks so episode handoff boundaries are explicit and machine-checkable",
    () => {},
  );
});
