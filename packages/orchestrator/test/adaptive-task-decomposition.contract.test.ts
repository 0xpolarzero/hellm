import { describe, expect, test } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

function createBaseContext(request: {
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

describe("@hellm/orchestrator adaptive task decomposition contract", () => {
  test("synthesizes a bounded single-task smithers workflow when no explicit decomposition seed is provided", async () => {
    const worktreePath = "/repo/.worktrees/decompose-default";
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-adaptive-default",
        threadId: "thread-adaptive-default",
        workflowId: "workflow:thread-adaptive-default",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath,
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-adaptive-default",
        threadId: "thread-adaptive-default",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-adaptive-default",
        worktreePath,
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
      contextLoader: {
        async load(request) {
          return createBaseContext(request);
        },
      },
    });

    await orchestrator.run({
      threadId: "thread-adaptive-default",
      prompt: "Break this work down and execute the first bounded step.",
      cwd: "/repo",
      worktreePath,
      routeHint: "smithers-workflow",
      requireApproval: true,
    });

    expect(smithersBridge.runRequests).toHaveLength(1);
    expect(smithersBridge.runRequests[0]?.workflow.tasks).toEqual([
      {
        id: "pi-task",
        outputKey: "result",
        prompt: "Break this work down and execute the first bounded step.",
        agent: "pi",
        needsApproval: true,
        worktreePath,
      },
    ]);
  });

  test("supports per-episode decomposition revisions by accepting a new task graph on re-entry while preserving prior episode inputs", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-adaptive-pass-1",
        threadId: "thread-adaptive-reentry",
        workflowId: "workflow:thread-adaptive-reentry",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-adaptive-pass-1",
        threadId: "thread-adaptive-reentry",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-adaptive-pass-1",
      }),
    });
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-adaptive-pass-2",
        threadId: "thread-adaptive-reentry",
        workflowId: "workflow:thread-adaptive-reentry",
        status: "completed",
        updatedAt: "2026-04-08T09:01:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-adaptive-pass-2",
        threadId: "thread-adaptive-reentry",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-adaptive-pass-2",
      }),
    });

    let state = createEmptySessionState({
      sessionId: "thread-adaptive-reentry",
      sessionCwd: "/repo",
    });
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
      contextLoader: {
        async load(request) {
          return {
            ...createBaseContext(request),
            priorEpisodes: state.episodes,
            priorArtifacts: state.artifacts,
            state,
          };
        },
      },
    });

    const firstTasks = [
      {
        id: "task-triage",
        outputKey: "triage",
        prompt: "Triage the failure modes.",
        agent: "pi" as const,
      },
    ];
    const first = await orchestrator.run({
      threadId: "thread-adaptive-reentry",
      prompt: "Start decomposition pass one.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
      workflowSeedInput: {
        tasks: firstTasks,
      },
    });
    state = first.sessionState;

    const secondTasks = [
      {
        id: "task-implement",
        outputKey: "implementation",
        prompt: "Implement the patch from triage output.",
        agent: "pi" as const,
      },
      {
        id: "task-verify",
        outputKey: "verification",
        prompt: "Run focused verification for changed files.",
        agent: "verification" as const,
      },
    ];
    await orchestrator.run({
      threadId: "thread-adaptive-reentry",
      prompt: "Start decomposition pass two.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
      workflowSeedInput: {
        tasks: secondTasks,
      },
    });

    expect(smithersBridge.runRequests).toHaveLength(2);
    expect(smithersBridge.runRequests[0]?.workflow.inputEpisodeIds).toEqual([]);
    expect(smithersBridge.runRequests[1]?.workflow.inputEpisodeIds).toEqual([
      "episode-adaptive-pass-1",
    ]);
    expect(smithersBridge.runRequests[0]?.workflow.tasks).toEqual(firstTasks);
    expect(smithersBridge.runRequests[1]?.workflow.tasks).toEqual(secondTasks);
  });

  test.todo(
    "automatically decomposes complex objectives into bounded multi-step tasks with explicit completion boundaries when no manual task seed is provided",
    () => {},
  );
  test.todo(
    "automatically decides when work can safely fan out in parallel versus staying serialized for reconciliation correctness",
    () => {},
  );
  test.todo(
    "derives decomposition inputs from prior episode conclusions and artifacts rather than requiring caller-provided task lists",
    () => {},
  );
  test.todo(
    "keeps delegated workers task-scoped without introducing persistent planner, implementer, or reviewer role agents",
    () => {},
  );
});
