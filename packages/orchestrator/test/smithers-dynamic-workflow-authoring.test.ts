import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakeSmithersWorkflowBridge,
  FileBackedSessionJsonlHarness,
  createEpisodeFixture,
  fixedClock,
  withTempWorkspace,
} from "@hellm/test-support";

function baseLoadedContext(request: {
  threadId: string;
  cwd: string;
  worktreePath?: string;
}) {
  return {
    sessionHistory: [],
    repoAndWorktree: {
      cwd: request.cwd,
      ...(request.worktreePath ? { worktreePath: request.worktreePath } : {}),
    },
    agentsInstructions: [],
    relevantSkills: [],
    priorEpisodes: [],
    priorArtifacts: [],
    state: createEmptySessionState({
      sessionId: request.threadId,
      sessionCwd: request.cwd,
      ...(request.worktreePath
        ? { activeWorktreePath: request.worktreePath }
        : {}),
    }),
  };
}

describe("@hellm/orchestrator smithers dynamic workflow authoring", () => {
  it("authors the default smithers workflow task from prompt, worktree, approval mode, and prior episode context", async () => {
    const threadId = "thread-smithers-default-authoring";
    const worktreePath = "/repo/.worktrees/feature-authoring";
    const priorEpisode = createEpisodeFixture({
      id: "episode-smithers-prior",
      threadId,
      source: "smithers",
      smithersRunId: "run-smithers-prior",
    });

    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-smithers-default-authoring",
        threadId,
        workflowId: `workflow:${threadId}`,
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath,
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-smithers-default-authoring",
        threadId,
        source: "smithers",
        status: "completed",
        smithersRunId: "run-smithers-default-authoring",
        worktreePath,
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
      contextLoader: {
        async load(request) {
          return {
            ...baseLoadedContext({ ...request, worktreePath }),
            repoAndWorktree: { cwd: request.cwd, worktreePath },
            priorEpisodes: [priorEpisode],
            state: {
              ...baseLoadedContext({ ...request, worktreePath }).state,
              episodes: [priorEpisode],
            },
          };
        },
      },
    });

    await orchestrator.run({
      threadId,
      prompt: "Implement workflow fallback behavior.",
      cwd: "/repo",
      worktreePath,
      routeHint: "smithers-workflow",
      requireApproval: false,
      workflowSeedInput: {
        objective: "Ship dynamic workflow authoring behavior.",
      },
    });

    expect(smithersBridge.runRequests[0]).toMatchObject({
      objective: "Ship dynamic workflow authoring behavior.",
      worktreePath,
    });
    expect(smithersBridge.runRequests[0]?.workflow).toEqual({
      workflowId: `workflow:${threadId}`,
      name: "Ship dynamic workflow authoring behavior.",
      objective: "Ship dynamic workflow authoring behavior.",
      inputEpisodeIds: ["episode-smithers-prior"],
      tasks: [
        {
          id: "pi-task",
          outputKey: "result",
          prompt: "Implement workflow fallback behavior.",
          agent: "pi",
          needsApproval: false,
          worktreePath,
        },
      ],
    });
  });

  it("keeps authored workflow seed tasks unchanged even when request-level approval is required", async () => {
    const threadId = "thread-smithers-seeded-authoring";
    const seededTasks = [
      {
        id: "task-plan",
        outputKey: "plan",
        prompt: "Plan the rollout.",
        agent: "pi" as const,
      },
      {
        id: "task-verify",
        outputKey: "verification",
        prompt: "Verify rollout health.",
        agent: "verification" as const,
      },
    ];
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-smithers-seeded-authoring",
        threadId,
        workflowId: `workflow:${threadId}`,
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-smithers-seeded-authoring",
        threadId,
        source: "smithers",
        status: "completed",
        smithersRunId: "run-smithers-seeded-authoring",
      }),
    });
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    await orchestrator.run({
      threadId,
      prompt: "Run seeded dynamic workflow.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
      requireApproval: true,
      workflowSeedInput: {
        tasks: seededTasks,
      },
    });

    expect(smithersBridge.runRequests[0]?.workflow.tasks).toEqual(seededTasks);
    expect(smithersBridge.runRequests[0]?.workflow.tasks).toHaveLength(2);
  });

  it("re-enters from file-backed session state and authors the next workflow with prior episode ids", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "thread-smithers-file-reentry";
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/smithers-file-reentry.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: "run-smithers-file-reentry-1",
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "completed",
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "episode-smithers-file-reentry-1",
          threadId,
          source: "smithers",
          status: "completed",
          smithersRunId: "run-smithers-file-reentry-1",
        }),
      });
      smithersBridge.enqueueRunResult({
        run: {
          runId: "run-smithers-file-reentry-2",
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "completed",
          updatedAt: "2026-04-08T09:01:00.000Z",
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "episode-smithers-file-reentry-2",
          threadId,
          source: "smithers",
          status: "completed",
          smithersRunId: "run-smithers-file-reentry-2",
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        smithersBridge,
        contextLoader: {
          async load(request) {
            const state = harness.reconstruct();
            return {
              sessionHistory: harness.lines(),
              repoAndWorktree: { cwd: request.cwd },
              agentsInstructions: ["Read docs/prd.md"],
              relevantSkills: ["tests"],
              priorEpisodes: state.episodes,
              priorArtifacts: state.artifacts,
              state,
            };
          },
        },
      });

      const first = await orchestrator.run({
        threadId,
        prompt: "Run first delegated workflow step.",
        cwd: workspace.root,
        routeHint: "smithers-workflow",
      });
      harness.appendEntries(first.sessionEntries);
      const second = await orchestrator.run({
        threadId,
        prompt: "Run second delegated workflow step.",
        cwd: workspace.root,
        routeHint: "smithers-workflow",
      });
      harness.appendEntries(second.sessionEntries);

      expect(smithersBridge.runRequests[0]?.workflow.inputEpisodeIds).toEqual([]);
      expect(smithersBridge.runRequests[1]?.workflow.inputEpisodeIds).toEqual([
        "episode-smithers-file-reentry-1",
      ]);
      expect(smithersBridge.runRequests[1]?.workflow.tasks[0]?.prompt).toBe(
        "Run second delegated workflow step.",
      );
      expect(harness.reconstruct().episodes.map((episode) => episode.id)).toEqual([
        "episode-smithers-file-reentry-1",
        "episode-smithers-file-reentry-2",
      ]);
    });
  });
});
