import { describe, expect, it, test } from "bun:test";
import { executeHeadlessRun } from "@hellm/cli";
import {
  createOrchestrator,
  type Orchestrator,
  type OrchestratorRunResult,
} from "@hellm/orchestrator";
import {
  createEmptySessionState,
  createGlobalVerificationState,
  createThread,
  createThreadSnapshot,
  type Episode,
} from "@hellm/session-model";
import {
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  createEpisodeFixture,
  createVerificationFixture,
  fixedClock,
} from "@hellm/test-support";

describe("@hellm/cli headless execution", () => {
  it("returns structured output and JSONL events for one-shot execution", async () => {
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
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

    const result = await executeHeadlessRun(
      {
        threadId: "thread-headless",
        prompt: "Summarize the repo.",
        cwd: "/repo",
        routeHint: "direct",
      },
      { orchestrator },
    );

    expect(result.orchestratorId).toBe("main");
    expect(result.output.threadId).toBe("thread-headless");
    expect(result.output.status).toBe("completed");
    expect(result.events[0]).toEqual({
      type: "run.started",
      orchestratorId: result.orchestratorId,
      threadId: "thread-headless",
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
  });

  it("treats structured workflow seed input as the authoritative hint for headless routing semantics", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    const episode = createEpisodeFixture({
      id: "episode-seed",
      threadId: "thread-seed",
      source: "smithers",
      smithersRunId: "run-seed",
    });
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-seed",
        threadId: "thread-seed",
        workflowId: "workflow:thread-seed",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode,
    });

    const orchestrator = createOrchestrator({
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

    const result = await executeHeadlessRun(
      {
        threadId: "thread-seed",
        prompt: "Use the workflow seed.",
        cwd: "/repo",
        routeHint: "auto",
        workflowSeedInput: {
          preferredPath: "smithers-workflow",
          tasks: [
            {
              id: "seed-task",
              outputKey: "result",
              prompt: "Execute seeded workflow",
              agent: "pi",
            },
          ],
        },
      },
      { orchestrator },
    );

    expect(result.raw.classification.path).toBe("smithers-workflow");
    expect(result.output.workflowRunIds).toEqual(["run-seed"]);
  });

  it("keeps explicit route hints authoritative over workflow seed preferredPath in headless mode", async () => {
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader: createDefaultHeadlessContextLoader(),
    });

    const result = await executeHeadlessRun(
      {
        threadId: "thread-seed-explicit-hint",
        prompt: "Prefer the explicit route hint.",
        cwd: "/repo",
        routeHint: "direct",
        workflowSeedInput: {
          preferredPath: "smithers-workflow",
        },
      },
      { orchestrator },
    );

    expect(result.raw.classification).toEqual({
      path: "direct",
      confidence: "hint",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(result.events).toContainEqual({
      type: "run.classified",
      path: "direct",
      reason: "Explicit route hint supplied by caller.",
    });
  });

  it("falls back to approval, verification, and direct semantics when workflow seed input omits preferredPath", async () => {
    const scenarios = [
      {
        id: "approval",
        request: {
          prompt: "Wait for approval before executing.",
          requireApproval: true,
        },
        expected: {
          path: "approval" as const,
          reason: "Request requires approval or clarification.",
        },
      },
      {
        id: "verification",
        request: {
          prompt: "Please verify this workspace state.",
        },
        expected: {
          path: "verification" as const,
          reason: "Prompt emphasizes verification work.",
        },
      },
      {
        id: "direct",
        request: {
          prompt: "Describe what changed in the repository.",
        },
        expected: {
          path: "direct" as const,
          reason: "Defaulted to direct execution for a small local request.",
        },
      },
    ];

    for (const scenario of scenarios) {
      const verificationRunner = new FakeVerificationRunner();
      verificationRunner.enqueueResult({
        status: "passed",
        records: [createVerificationFixture({ kind: "build", status: "passed" })],
        artifacts: [],
      });
      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        verificationRunner,
        contextLoader: createDefaultHeadlessContextLoader(),
      });

      const result = await executeHeadlessRun(
        {
          threadId: `thread-seed-fallback-${scenario.id}`,
          cwd: "/repo",
          routeHint: "auto",
          workflowSeedInput: {
            objective: "Workflow seed objective without preferred path",
            tasks: [
              {
                id: "seed-task",
                outputKey: "result",
                prompt: "Seeded task definition.",
                agent: "pi",
              },
            ],
          },
          ...scenario.request,
        },
        { orchestrator },
      );

      expect(result.raw.classification.path).toBe(scenario.expected.path);
      expect(result.events).toContainEqual({
        type: "run.classified",
        path: scenario.expected.path,
        reason: scenario.expected.reason,
      });
    }
  });

  it("forwards workflow seed objective and tasks when seed semantics choose smithers workflow", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    const seededObjective = "Seeded objective from workflow input";
    const seededTasks = [
      {
        id: "seed-task-plan",
        outputKey: "plan",
        prompt: "Plan the seeded change.",
        agent: "pi" as const,
      },
    ];
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-seed-objective",
        threadId: "thread-seed-objective",
        workflowId: "workflow:thread-seed-objective",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-seed-objective",
        threadId: "thread-seed-objective",
        source: "smithers",
        smithersRunId: "run-seed-objective",
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
      contextLoader: createDefaultHeadlessContextLoader(),
    });

    const result = await executeHeadlessRun(
      {
        threadId: "thread-seed-objective",
        prompt: "Prompt should not override the workflow seed objective.",
        cwd: "/repo",
        routeHint: "auto",
        workflowSeedInput: {
          objective: seededObjective,
          preferredPath: "smithers-workflow",
          tasks: seededTasks,
        },
      },
      { orchestrator },
    );

    expect(result.raw.classification.path).toBe("smithers-workflow");
    expect(smithersBridge.runRequests[0]?.objective).toBe(seededObjective);
    expect(smithersBridge.runRequests[0]?.workflow.objective).toBe(seededObjective);
    expect(smithersBridge.runRequests[0]?.workflow.name).toBe(seededObjective);
    expect(smithersBridge.runRequests[0]?.workflow.tasks).toEqual(seededTasks);
  });

  it("uses prompt-driven verification classification when routeHint is omitted or auto and emits run.classified", async () => {
    const scenarios = [
      { id: "omitted-route-hint" },
      { id: "auto-route-hint", routeHint: "auto" as const },
    ];

    for (const scenario of scenarios) {
      const verificationRunner = new FakeVerificationRunner();
      verificationRunner.enqueueResult({
        status: "passed",
        records: [createVerificationFixture({ kind: "build", status: "passed" })],
        artifacts: [],
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        verificationRunner,
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

      const result = await executeHeadlessRun(
        {
          threadId: `thread-verify-${scenario.id}`,
          prompt: "Please verify the current workspace state.",
          cwd: "/repo",
          ...(scenario.routeHint ? { routeHint: scenario.routeHint } : {}),
        },
        { orchestrator },
      );

      expect(result.raw.classification.path).toBe("verification");
      expect(result.events).toContainEqual({
        type: "run.classified",
        path: "verification",
        reason: "Prompt emphasizes verification work.",
      });
    }
  });

  it("reuses the same orchestrator instance across repeated entry-surface calls when one is provided", async () => {
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
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

    const first = await executeHeadlessRun(
      {
        threadId: "thread-a",
        prompt: "A",
        cwd: "/repo",
        routeHint: "direct",
      },
      { orchestrator },
    );
    const second = await executeHeadlessRun(
      {
        threadId: "thread-b",
        prompt: "B",
        cwd: "/repo",
        routeHint: "direct",
      },
      { orchestrator },
    );

    expect(first.orchestratorId).toBe("main");
    expect(second.orchestratorId).toBe(first.orchestratorId);
    expect(first.events[0]).toEqual({
      type: "run.started",
      orchestratorId: first.orchestratorId,
      threadId: "thread-a",
    });
    expect(second.events[0]).toEqual({
      type: "run.started",
      orchestratorId: first.orchestratorId,
      threadId: "thread-b",
    });
  });

  it("chooses summary output from conclusions, then follow-up suggestions, then objective", async () => {
    const scenarios: Array<{
      id: string;
      episode: Episode;
      expectedSummary: string;
    }> = [
      {
        id: "conclusions-first",
        episode: createEpisodeFixture({
          id: "episode-summary-conclusion",
          threadId: "thread-summary-conclusion",
          objective: "Objective should not be used",
          conclusions: ["Conclusion takes priority"],
          followUpSuggestions: ["Follow-up fallback"],
        }),
        expectedSummary: "Conclusion takes priority",
      },
      {
        id: "follow-up-second",
        episode: createEpisodeFixture({
          id: "episode-summary-follow-up",
          threadId: "thread-summary-follow-up",
          objective: "Objective should not be used",
          conclusions: [],
          followUpSuggestions: ["Follow-up becomes summary"],
        }),
        expectedSummary: "Follow-up becomes summary",
      },
      {
        id: "objective-fallback",
        episode: createEpisodeFixture({
          id: "episode-summary-objective",
          threadId: "thread-summary-objective",
          objective: "Objective fallback summary",
          conclusions: [],
          followUpSuggestions: [],
        }),
        expectedSummary: "Objective fallback summary",
      },
    ];

    for (const scenario of scenarios) {
      const orchestrator = createStubOrchestrator(
        createRunResultForHeadless({
          threadId: scenario.episode.threadId,
          episodes: [scenario.episode],
        }),
      );
      const result = await executeHeadlessRun(
        {
          threadId: scenario.episode.threadId,
          prompt: `summary scenario ${scenario.id}`,
          cwd: "/repo",
          routeHint: "direct",
        },
        { orchestrator },
      );

      expect(result.output.summary).toBe(scenario.expectedSummary);
    }
  });

  it("throws when one-shot execution does not produce any episodes", async () => {
    const orchestrator = createStubOrchestrator(
      createRunResultForHeadless({
        threadId: "thread-without-episode",
        episodes: [],
      }),
    );

    expect(
      executeHeadlessRun(
        {
          threadId: "thread-without-episode",
          prompt: "Run without output episodes.",
          cwd: "/repo",
          routeHint: "direct",
        },
        { orchestrator },
      ),
    ).rejects.toThrow("Cannot build JSONL events without an episode.");
  });

  test.todo(
    "whole product server mode reuses the same structured contract without requiring a separate orchestration model",
    () => {},
  );
  test.todo(
    "richer remote attachment patterns extend headless input without weakening offline determinism",
    () => {},
  );
});

function createDefaultHeadlessContextLoader() {
  return {
    async load(request: { threadId: string; cwd: string }) {
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
  };
}

function createStubOrchestrator(result: OrchestratorRunResult): Orchestrator {
  return {
    id: "main",
    async loadContext() {
      throw new Error("createStubOrchestrator.loadContext should not be called");
    },
    classifyRequest() {
      throw new Error("createStubOrchestrator.classifyRequest should not be called");
    },
    async run() {
      return result;
    },
  };
}

function createRunResultForHeadless(input: {
  threadId: string;
  episodes: Episode[];
}): OrchestratorRunResult {
  const now = "2026-04-08T09:00:00.000Z";
  const sessionState = createEmptySessionState({
    sessionId: input.threadId,
    sessionCwd: "/repo",
  });
  const thread = createThread({
    id: input.threadId,
    kind: "direct",
    objective: "headless test objective",
    status: input.episodes.length > 0 ? "completed" : "running",
    createdAt: now,
    updatedAt: now,
  });

  sessionState.threads = [thread];
  sessionState.episodes = input.episodes;

  const threadSnapshot = createThreadSnapshot(sessionState, input.threadId);
  const latestEpisode =
    input.episodes.at(-1) ??
    createEpisodeFixture({
      id: "episode-placeholder",
      threadId: input.threadId,
    });

  return {
    classification: {
      path: "direct",
      confidence: "hint",
      reason: "Explicit route hint supplied by caller.",
    },
    context: {
      sessionHistory: [],
      repoAndWorktree: { cwd: "/repo" },
      agentsInstructions: [],
      relevantSkills: [],
      priorEpisodes: [],
      priorArtifacts: [],
      state: createEmptySessionState({
        sessionId: input.threadId,
        sessionCwd: "/repo",
      }),
    },
    threadSnapshot,
    state: {
      thread,
      latestEpisode,
      verification: createGlobalVerificationState(),
      alignment: threadSnapshot.alignment,
      workflowRuns: [],
      waiting: thread.status !== "completed",
      blocked: false,
      visibleSummary: "stubbed",
    },
    sessionState,
    sessionEntries: [],
    completion: {
      isComplete: input.episodes.length > 0,
      reason: input.episodes.length > 0 ? "completed" : "waiting_input",
    },
  };
}
