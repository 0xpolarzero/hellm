import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

function createTestOrchestrator(smithersBridge: FakeSmithersWorkflowBridge) {
  return createOrchestrator({
    clock: fixedClock(),
    smithersBridge,
    contextLoader: {
      async load(request) {
        return {
          sessionHistory: [],
          repoAndWorktree: { cwd: request.cwd },
          agentsInstructions: [],
          relevantSkills: [],
          priorEpisodes: [],
          priorArtifacts: [],
          state: createEmptySessionState({
            sessionId: request.threadId,
            sessionCwd: request.cwd,
          }),
        };
      },
    },
  });
}

describe("@hellm/orchestrator smithers default delegated path contract", () => {
  it("classifies delegated requests to `smithers-workflow` by default when `routeHint` is `auto` and no explicit preferred path is provided", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-default",
        threadId: "thread-default",
        workflowId: "workflow:thread-default",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-default",
        threadId: "thread-default",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-default",
      }),
    });
    const orchestrator = createTestOrchestrator(smithersBridge);

    const result = await orchestrator.run({
      threadId: "thread-default",
      prompt: "Implement the new feature and run tests.",
      cwd: "/repo",
      routeHint: "auto",
    });

    expect(result.classification.path).toBe("smithers-workflow");
    expect(result.classification.confidence).toBe("medium");
    expect(result.classification.reason).toContain("delegated");
  });

  it("treats a single bounded subagent request as delegated work and chooses `smithers-workflow` instead of `pi-worker`", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-single",
        threadId: "thread-single",
        workflowId: "workflow:thread-single",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-single",
        threadId: "thread-single",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-single",
      }),
    });
    const orchestrator = createTestOrchestrator(smithersBridge);

    const result = await orchestrator.run({
      threadId: "thread-single",
      prompt: "Refactor the authentication module to use the new token format.",
      cwd: "/repo",
    });

    expect(result.classification.path).toBe("smithers-workflow");
    expect(smithersBridge.runRequests).toHaveLength(1);
    expect(smithersBridge.runRequests[0]?.workflow.tasks).toHaveLength(1);
    expect(smithersBridge.runRequests[0]?.workflow.tasks[0]?.agent).toBe("pi");
  });

  it("promotes structured delegated intent (for example, bounded workflow tasks) to `smithers-workflow` without requiring explicit `preferredPath`", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-tasks",
        threadId: "thread-tasks",
        workflowId: "workflow:thread-tasks",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-tasks",
        threadId: "thread-tasks",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-tasks",
      }),
    });
    const orchestrator = createTestOrchestrator(smithersBridge);

    const result = await orchestrator.run({
      threadId: "thread-tasks",
      prompt: "Do the work",
      cwd: "/repo",
      workflowSeedInput: {
        tasks: [
          {
            id: "task-1",
            outputKey: "result",
            prompt: "Implement the change",
            agent: "pi",
          },
        ],
      },
    });

    expect(result.classification.path).toBe("smithers-workflow");
    expect(result.classification.confidence).toBe("high");
    expect(smithersBridge.runRequests[0]?.workflow.tasks).toHaveLength(1);
    expect(smithersBridge.runRequests[0]?.workflow.tasks[0]?.id).toBe("task-1");
  });

  it("dispatches delegated-default routing through `smithersBridge.runWorkflow` and avoids `piBridge.runWorker` for equivalent bounded work", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-dispatch",
        threadId: "thread-dispatch",
        workflowId: "workflow:thread-dispatch",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-dispatch",
        threadId: "thread-dispatch",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-dispatch",
      }),
    });
    const orchestrator = createTestOrchestrator(smithersBridge);

    const result = await orchestrator.run({
      threadId: "thread-dispatch",
      prompt: "Fix the failing integration test and make it pass.",
      cwd: "/repo",
    });

    expect(result.classification.path).toBe("smithers-workflow");
    expect(smithersBridge.runRequests).toHaveLength(1);
    expect(result.threadSnapshot.thread.kind).toBe("smithers-workflow");
    expect(result.threadSnapshot.episodes.at(-1)?.source).toBe("smithers");
  });

  it("keeps delegated-default routing stable across real session/worktree context boundaries and records the resulting workflow run reference", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-stable",
        threadId: "thread-stable",
        workflowId: "workflow:thread-stable",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath: "/repo/worktrees/feature",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-stable",
        threadId: "thread-stable",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-stable",
        worktreePath: "/repo/worktrees/feature",
      }),
    });
    const orchestrator = createTestOrchestrator(smithersBridge);

    const result = await orchestrator.run({
      threadId: "thread-stable",
      prompt: "Implement the feature in the worktree branch.",
      cwd: "/repo",
      worktreePath: "/repo/worktrees/feature",
    });

    expect(result.classification.path).toBe("smithers-workflow");
    expect(result.threadSnapshot.thread.worktreePath).toBe(
      "/repo/worktrees/feature",
    );
    expect(result.threadSnapshot.thread.smithersRunId).toBe("run-stable");
    expect(result.sessionState.workflowRuns[0]?.runId).toBe("run-stable");
    expect(smithersBridge.runRequests[0]?.worktreePath).toBe(
      "/repo/worktrees/feature",
    );
  });

  it("routes short question-like prompts to direct instead of smithers-workflow", async () => {
    const orchestrator = createTestOrchestrator(new FakeSmithersWorkflowBridge());

    const result = await orchestrator.run({
      threadId: "thread-question",
      prompt: "What does the orchestrator do?",
      cwd: "/repo",
    });

    expect(result.classification.path).toBe("direct");
    expect(result.classification.reason).toContain("small local");
  });
});
