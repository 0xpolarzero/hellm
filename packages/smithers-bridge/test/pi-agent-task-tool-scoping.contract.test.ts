import { describe, expect, it } from "bun:test";
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
            toolScope: {
              allow: ["read", "edit"],
              deny: ["network"],
              writeRoots: [worktreePath],
              readOnly: false,
            },
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
      expect(task).toMatchObject({
        id: "pi-task",
        outputKey: "result",
        prompt: "Apply the minimal code change.",
        agent: "pi",
        worktreePath,
        toolScope: {
          allow: ["read", "edit"],
          deny: ["network"],
          writeRoots: [worktreePath],
          readOnly: false,
        },
      });
      expect(task).toBeDefined();
      expect(task?.toolScope?.writeRoots).toEqual([worktreePath]);
    });
  });

  it("exposes first-class per-task tool allow/deny lists so smithers pi-agent tasks do not rely on prompt text for tool limits", () => {
    const thread = createThreadFixture({
      id: "thread-tool-allow-deny",
      kind: "smithers-workflow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Run tool-scoped delegated task.",
      inputEpisodeIds: [],
      tasks: [
        {
          id: "pi-task",
          outputKey: "result",
          prompt: "Use explicit tool scoping metadata.",
          agent: "pi",
          toolScope: {
            allow: ["read", "edit"],
            deny: ["network", "dangerous-shell"],
            writeRoots: ["/repo/worktrees/tool-scope"],
          },
        },
      ],
    });

    expect(workflow.tasks[0]?.toolScope).toEqual({
      allow: ["read", "edit"],
      deny: ["network", "dangerous-shell"],
      writeRoots: ["/repo/worktrees/tool-scope"],
    });
  });

  it("supports explicit write-root boundaries for smithers pi-agent tasks and carries them through run/resume requests", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("feature-tool-write-roots");
      const thread = createThreadFixture({
        id: "thread-tool-write-roots",
        kind: "smithers-workflow",
        worktreePath,
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Carry write roots through requests.",
        inputEpisodeIds: [],
        tasks: [
          {
            id: "pi-task",
            outputKey: "result",
            prompt: "Apply bounded edits.",
            agent: "pi",
            worktreePath,
            toolScope: {
              allow: ["read", "edit", "bash"],
              writeRoots: [worktreePath],
            },
          },
        ],
      });

      const bridge = new FakeSmithersWorkflowBridge();
      bridge.enqueueRunResult({
        run: {
          runId: "run-tool-write-roots",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "waiting_resume",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "waiting_resume",
        outputs: [],
        episode: createEpisodeFixture({
          id: "episode-tool-write-roots-waiting",
          threadId: thread.id,
          source: "smithers",
          status: "waiting_input",
          smithersRunId: "run-tool-write-roots",
          worktreePath,
        }),
      });
      bridge.enqueueResumeResult({
        run: {
          runId: "run-tool-write-roots",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "completed",
          updatedAt: "2026-04-08T09:01:00.000Z",
          worktreePath,
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "episode-tool-write-roots-complete",
          threadId: thread.id,
          source: "smithers",
          status: "completed",
          smithersRunId: "run-tool-write-roots",
          worktreePath,
        }),
      });

      await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
        worktreePath,
      });
      await bridge.resumeWorkflow({
        runId: "run-tool-write-roots",
        thread,
        objective: workflow.objective,
      });

      expect(bridge.runRequests[0]?.workflow.tasks[0]?.toolScope?.writeRoots).toEqual([
        worktreePath,
      ]);
    });
  });

  it("supports fail-closed read-only task mode that blocks edit-capable tool grants for smithers pi-agent tasks", () => {
    const thread = createThreadFixture({
      id: "thread-tool-read-only",
      kind: "smithers-workflow",
    });

    expect(() =>
      authorWorkflow({
        thread,
        objective: "Reject invalid read-only tool grants.",
        inputEpisodeIds: [],
        tasks: [
          {
            id: "pi-task",
            outputKey: "result",
            prompt: "Do not mutate files.",
            agent: "pi",
            toolScope: {
              allow: ["read", "edit"],
              readOnly: true,
            },
          },
        ],
      }),
    ).toThrow('Task "pi-task" is read-only but grants edit-capable tools.');
  });
});
