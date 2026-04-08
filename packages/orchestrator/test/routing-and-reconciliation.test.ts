import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import {
  createArtifact,
  createEmptySessionState,
  createSessionHeader,
  createStructuredSessionEntry,
  reconstructSessionState,
  type SessionJsonlEntry,
} from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  createEpisodeFixture,
  createThreadFixture,
  createVerificationFixture,
  fixedClock,
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

describe("@hellm/orchestrator routing and reconciliation", () => {
  it("defaults routing without hints to direct and maps verify keywords to verification", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "passed",
      records: [],
      artifacts: [],
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      verificationRunner,
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    const direct = await orchestrator.run({
      threadId: "thread-default-direct",
      prompt: "Summarize the architecture delta.",
      cwd: "/repo",
    });
    const verification = await orchestrator.run({
      threadId: "thread-default-verify",
      prompt: "Please verify the branch before merge.",
      cwd: "/repo",
    });

    expect(direct.classification.path).toBe("direct");
    expect(direct.classification.confidence).toBe("medium");
    expect(verification.classification.path).toBe("verification");
    expect(verification.threadSnapshot.thread.kind).toBe("verification");
    expect(verificationRunner.calls[0]).toMatchObject({
      threadId: "thread-default-verify",
      kinds: ["build", "test", "lint"],
    });
  });

  it("falls back to default context loading when no explicit sources are provided", async () => {
    const orchestrator = createOrchestrator();

    const context = await orchestrator.loadContext({
      threadId: "thread-context-defaults",
      prompt: "Load default context.",
      cwd: "/repo",
      worktreePath: "/repo/worktrees/feature-defaults",
    });

    expect(context.sessionHistory).toEqual([]);
    expect(context.repoAndWorktree).toEqual({
      cwd: "/repo",
      worktreePath: "/repo/worktrees/feature-defaults",
    });
    expect(context.agentsInstructions).toEqual([]);
    expect(context.relevantSkills).toEqual([]);
    expect(context.priorEpisodes).toEqual([]);
    expect(context.priorArtifacts).toEqual([]);
    expect(context.state.sessionId).toBe("thread-context-defaults");
    expect(context.state.sessionCwd).toBe("/repo");
    expect(context.state.alignment.activeWorktreePath).toBe(
      "/repo/worktrees/feature-defaults",
    );
  });

  it("auto-routes to a smithers workflow run when workflow seed input requests the preferred path", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-seeded-routing",
        threadId: "thread-seeded-routing",
        workflowId: "workflow:thread-seeded-routing",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-seeded-routing",
        threadId: "thread-seeded-routing",
        source: "smithers",
        smithersRunId: "run-seeded-routing",
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

    const result = await orchestrator.run({
      threadId: "thread-seeded-routing",
      prompt: "Implement the seeded workflow.",
      cwd: "/repo",
      workflowSeedInput: {
        preferredPath: "smithers-workflow",
      },
    });

    expect(result.classification.path).toBe("smithers-workflow");
    expect(smithersBridge.runRequests[0]?.path).toBe("smithers-workflow");
    expect(result.threadSnapshot.thread.kind).toBe("smithers-workflow");
    expect(result.threadSnapshot.thread.smithersRunId).toBe("run-seeded-routing");
  });

  it("normalizes a direct request into a completed thread, session entries, and visible orchestrator state", async () => {
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-direct",
      prompt: "Summarize the architecture delta.",
      cwd: "/repo",
      routeHint: "direct",
    });

    expect(result.classification.path).toBe("direct");
    expect(result.threadSnapshot.thread.status).toBe("completed");
    expect(result.threadSnapshot.episodes.at(-1)?.provenance).toEqual({
      executionPath: "direct",
      actor: "orchestrator",
      notes: "Direct path normalized into an episode.",
    });
    expect(result.state.visibleSummary).toContain("direct:completed");
    expect(result.completion.isComplete).toBe(true);
    expect(result.sessionEntries.map((entry) => entry.message.customType)).toEqual([
      "hellm/thread",
      "hellm/episode",
      "hellm/verification",
      "hellm/alignment",
    ]);
  });

  it("reuses prior episode ids as thread and episode inputs on the direct path", async () => {
    const priorEpisode = createEpisodeFixture({
      id: "episode-direct-prior",
      threadId: "thread-direct-reuse",
    });
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader: {
        async load(request) {
          return {
            ...baseLoadedContext(request),
            priorEpisodes: [priorEpisode],
            state: {
              ...baseLoadedContext(request).state,
              episodes: [priorEpisode],
            },
          };
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-direct-reuse",
      prompt: "Continue from prior episode state.",
      cwd: "/repo",
      routeHint: "direct",
    });

    expect(result.threadSnapshot.thread.inputEpisodeIds).toEqual([
      "episode-direct-prior",
    ]);
    expect(result.threadSnapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
      "episode-direct-prior",
    ]);
  });

  it("dispatches the pi worker path with scoped prior episode inputs and reconciles the returned episode", async () => {
    const piBridge = new FakePiRuntimeBridge();
    const priorEpisode = createEpisodeFixture({
      id: "episode-prior",
      threadId: "thread-pi",
    });
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "episode-pi",
        threadId: "thread-pi",
        source: "pi-worker",
        inputEpisodeIds: ["episode-prior"],
        provenance: {
          executionPath: "pi-worker",
          actor: "pi-worker",
          notes: "Worker-produced episode.",
        },
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      contextLoader: {
        async load(request) {
          const thread = createThreadFixture({
            id: request.threadId,
            kind: "pi-worker",
            objective: request.prompt,
          });
          return {
            ...baseLoadedContext(request),
            agentsInstructions: ["Respect AGENTS.md"],
            relevantSkills: ["tests"],
            priorEpisodes: [priorEpisode],
            state: {
              ...baseLoadedContext(request).state,
              threads: [thread],
              episodes: [priorEpisode],
            },
          };
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-pi",
      prompt: "Implement the bounded fix.",
      cwd: "/repo",
      routeHint: "pi-worker",
    });

    expect(piBridge.workerRequests[0]?.inputEpisodeIds).toEqual(["episode-prior"]);
    expect(piBridge.workerRequests[0]?.scopedContext.priorEpisodeIds).toEqual([
      "episode-prior",
    ]);
    expect(piBridge.workerRequests[0]?.toolScope.allow).toEqual([
      "read",
      "edit",
      "bash",
    ]);
    expect(piBridge.workerRequests[0]?.runtimeTransition).toEqual({
      reason: "new",
      toSessionId: "thread-pi:pi",
      aligned: true,
    });
    expect(result.threadSnapshot.episodes.at(-1)?.id).toBe("episode-pi");
    expect(result.threadSnapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
      "episode-prior",
    ]);
    expect(result.threadSnapshot.episodes.at(-1)?.provenance).toEqual({
      executionPath: "pi-worker",
      actor: "pi-worker",
      notes: "Worker-produced episode.",
    });
    expect(result.threadSnapshot.thread.status).toBe("completed");
  });

  it("uses a resume runtime transition when a bounded worker run is resumed in a worktree", async () => {
    const piBridge = new FakePiRuntimeBridge();
    const worktreePath = "/repo/.worktrees/feature";
    const priorEpisode = createEpisodeFixture({
      id: "episode-prior",
      threadId: "thread-pi-resume",
    });
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "episode-resumed",
        threadId: "thread-pi-resume",
        source: "pi-worker",
        worktreePath,
        inputEpisodeIds: ["episode-prior"],
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      contextLoader: {
        async load(request) {
          const thread = createThreadFixture({
            id: request.threadId,
            kind: "pi-worker",
            objective: request.prompt,
            status: "running",
            worktreePath,
            inputEpisodeIds: ["episode-prior"],
          });
          return {
            ...baseLoadedContext({ ...request, worktreePath }),
            priorEpisodes: [priorEpisode],
            repoAndWorktree: { cwd: request.cwd, worktreePath },
            state: {
              ...baseLoadedContext({ ...request, worktreePath }).state,
              threads: [thread],
              episodes: [priorEpisode],
            },
          };
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-pi-resume",
      prompt: "Resume bounded worker execution.",
      cwd: "/repo",
      worktreePath,
      routeHint: "pi-worker",
      resumeRunId: "run-resume-1",
    });

    expect(piBridge.workerRequests[0]?.runtimeTransition).toEqual({
      reason: "resume",
      toSessionId: "thread-pi-resume:pi",
      aligned: false,
      toWorktreePath: worktreePath,
    });
    expect(result.threadSnapshot.thread.status).toBe("completed");
    expect(result.threadSnapshot.episodes.at(-1)?.id).toBe("episode-resumed");
  });

  it("re-enters after every pi-worker episode by loading reconciled state into the next run", async () => {
    const threadId = "thread-pi-reenter";
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "episode-pi-1",
        threadId,
        source: "pi-worker",
      }),
    });
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "episode-pi-2",
        threadId,
        source: "pi-worker",
      }),
    });

    let state = createEmptySessionState({
      sessionId: threadId,
      sessionCwd: "/repo",
    });
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      contextLoader: {
        async load(request) {
          return {
            ...baseLoadedContext(request),
            priorEpisodes: state.episodes,
            priorArtifacts: state.artifacts,
            state,
          };
        },
      },
    });

    const first = await orchestrator.run({
      threadId,
      prompt: "Run the first bounded worker step.",
      cwd: "/repo",
      routeHint: "pi-worker",
    });
    state = first.sessionState;
    const second = await orchestrator.run({
      threadId,
      prompt: "Run the second bounded worker step.",
      cwd: "/repo",
      routeHint: "pi-worker",
    });

    expect(piBridge.workerRequests[0]?.inputEpisodeIds).toEqual([]);
    expect(second.context.priorEpisodes.map((episode) => episode.id)).toEqual([
      "episode-pi-1",
    ]);
    expect(piBridge.workerRequests[1]?.inputEpisodeIds).toEqual(["episode-pi-1"]);
    expect(second.threadSnapshot.episodes.map((episode) => episode.id)).toEqual([
      "episode-pi-1",
      "episode-pi-2",
    ]);
  });

  it("honors explicit smithers workflow seed tasks and emits workflow/isolation session entries", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    const explicitTasks = [
      {
        id: "task-plan",
        outputKey: "plan",
        prompt: "Plan the rollout.",
        agent: "pi" as const,
      },
      {
        id: "task-verify",
        outputKey: "verification",
        prompt: "Run verification checks.",
        agent: "verification" as const,
      },
    ];

    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-explicit-tasks",
        threadId: "thread-smithers-explicit",
        workflowId: "workflow:thread-smithers-explicit",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [
        {
          nodeId: "task-plan",
          schema: "plan",
          value: { summary: "workflow completed" },
        },
      ],
      episode: createEpisodeFixture({
        id: "episode-smithers-explicit",
        threadId: "thread-smithers-explicit",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-explicit-tasks",
        provenance: {
          executionPath: "smithers-workflow",
          actor: "smithers",
          notes: "Explicit seed tasks were executed.",
        },
      }),
      isolation: {
        runId: "run-explicit-tasks",
        runStateStore: "/tmp/run-explicit-tasks.sqlite",
        sessionEntryIds: ["entry-1"],
      },
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
    });

    const result = await orchestrator.run({
      threadId: "thread-smithers-explicit",
      prompt: "Do not use implicit fallback task.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
      workflowSeedInput: {
        tasks: explicitTasks,
      },
    });

    expect(smithersBridge.runRequests[0]?.workflow.tasks).toEqual(explicitTasks);
    expect(result.threadSnapshot.workflowRuns[0]?.runId).toBe("run-explicit-tasks");
    expect(result.sessionState.smithersIsolations[0]?.runId).toBe(
      "run-explicit-tasks",
    );
    expect(result.sessionEntries.map((entry) => entry.message.customType)).toEqual([
      "hellm/thread",
      "hellm/episode",
      "hellm/verification",
      "hellm/alignment",
      "hellm/workflow-run",
      "hellm/smithers-isolation",
    ]);
  });

  it("persists smithers workflow runs and isolation records in session state and structured entries", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    const workflowRun = {
      runId: "run-smithers-session",
      threadId: "thread-smithers-session",
      workflowId: "workflow:thread-smithers-session",
      status: "completed" as const,
      updatedAt: "2026-04-08T09:00:00.000Z",
      worktreePath: "/repo/worktrees/feature-smithers",
    };
    const isolation = {
      runId: "run-smithers-session",
      runStateStore: "/repo/.smithers/run-smithers-session.sqlite",
      sessionEntryIds: ["entry-a", "entry-b"],
    };
    smithersBridge.enqueueRunResult({
      run: workflowRun,
      status: "completed",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { summary: "Done" },
        },
      ],
      episode: createEpisodeFixture({
        id: "episode-smithers-session",
        threadId: "thread-smithers-session",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-smithers-session",
      }),
      isolation,
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

    const result = await orchestrator.run({
      threadId: "thread-smithers-session",
      prompt: "Run a bounded delegated workflow.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
    });

    expect(result.classification.path).toBe("smithers-workflow");
    expect(result.threadSnapshot.thread.smithersRunId).toBe("run-smithers-session");
    expect(result.sessionState.workflowRuns).toEqual([workflowRun]);
    expect(result.sessionState.smithersIsolations).toEqual([isolation]);
    expect(result.sessionEntries.map((entry) => entry.message.customType)).toEqual([
      "hellm/thread",
      "hellm/episode",
      "hellm/verification",
      "hellm/alignment",
      "hellm/workflow-run",
      "hellm/smithers-isolation",
    ]);
  });

  it("reconciles smithers workflow references and isolation state by run id", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    const worktreePath = "/repo/.worktrees/feature-smithers";
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-smithers",
        threadId: "thread-smithers",
        workflowId: "workflow:thread-smithers",
        status: "completed",
        updatedAt: "2026-04-08T09:02:00.000Z",
        worktreePath,
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-smithers",
        threadId: "thread-smithers",
        source: "smithers",
        status: "completed",
        smithersRunId: "run-smithers",
        worktreePath,
      }),
      isolation: {
        runId: "run-smithers",
        runStateStore: "/tmp/smithers/new.sqlite",
        sessionEntryIds: ["entry-new"],
      },
    });

    const previousEntry = createStructuredSessionEntry({
      id: "entry-existing",
      parentId: null,
      timestamp: "2026-04-08T08:59:00.000Z",
      payload: {
        kind: "thread",
        data: createThreadFixture({
          id: "thread-smithers",
          kind: "smithers-workflow",
          objective: "Run delegated workflow",
          status: "running",
          worktreePath,
        }),
      },
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
      contextLoader: {
        async load(request) {
          return {
            ...baseLoadedContext({ ...request, worktreePath }),
            sessionHistory: [previousEntry],
            repoAndWorktree: { cwd: request.cwd, worktreePath },
            state: {
              ...baseLoadedContext({ ...request, worktreePath }).state,
              workflowRuns: [
                {
                  runId: "run-smithers",
                  threadId: "thread-smithers",
                  workflowId: "workflow:thread-smithers",
                  status: "waiting_approval",
                  updatedAt: "2026-04-08T09:00:00.000Z",
                  worktreePath,
                },
              ],
              smithersIsolations: [
                {
                  runId: "run-smithers",
                  runStateStore: "/tmp/smithers/old.sqlite",
                  sessionEntryIds: ["entry-old"],
                },
              ],
            },
          };
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-smithers",
      prompt: "Continue delegated workflow.",
      cwd: "/repo",
      worktreePath,
      routeHint: "smithers-workflow",
    });

    expect(result.sessionState.workflowRuns).toEqual([
      {
        runId: "run-smithers",
        threadId: "thread-smithers",
        workflowId: "workflow:thread-smithers",
        status: "completed",
        updatedAt: "2026-04-08T09:02:00.000Z",
        worktreePath,
      },
    ]);
    expect(result.sessionState.smithersIsolations).toEqual([
      {
        runId: "run-smithers",
        runStateStore: "/tmp/smithers/new.sqlite",
        sessionEntryIds: ["entry-new"],
      },
    ]);
    expect(result.threadSnapshot.workflowRuns.map((run) => run.runId)).toEqual([
      "run-smithers",
    ]);
    expect(result.sessionEntries[0]?.parentId).toBe("entry-existing");
    expect(
      result.sessionEntries
        .slice(1)
        .every((entry, index) => entry.parentId === result.sessionEntries[index]?.id),
    ).toBe(true);
  });

  it("re-enters after a waiting smithers episode and resumes from the persisted thread context", async () => {
    const threadId = "thread-smithers-reenter";
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-reenter",
        threadId,
        workflowId: `workflow:${threadId}`,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "waiting_approval",
      outputs: [],
      approval: {
        nodeId: "approve",
        title: "Approve run",
        summary: "Waiting for approval",
        mode: "needsApproval",
      },
      episode: createEpisodeFixture({
        id: "episode-smithers-wait",
        threadId,
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: "run-reenter",
      }),
    });
    smithersBridge.enqueueResumeResult({
      run: {
        runId: "run-reenter",
        threadId,
        workflowId: `workflow:${threadId}`,
        status: "completed",
        updatedAt: "2026-04-08T09:05:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-smithers-done",
        threadId,
        source: "smithers",
        status: "completed",
        smithersRunId: "run-reenter",
      }),
    });

    let state = createEmptySessionState({
      sessionId: threadId,
      sessionCwd: "/repo",
    });
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
      contextLoader: {
        async load(request) {
          return {
            ...baseLoadedContext(request),
            priorEpisodes: state.episodes,
            priorArtifacts: state.artifacts,
            state,
          };
        },
      },
    });

    const waiting = await orchestrator.run({
      threadId,
      prompt: "Run smithers step that needs approval.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
      requireApproval: true,
    });
    state = waiting.sessionState;
    const resumed = await orchestrator.run({
      threadId,
      prompt: "Resume smithers step.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
      resumeRunId: "run-reenter",
    });

    expect(waiting.completion).toEqual({
      isComplete: false,
      reason: "waiting_approval",
    });
    expect(resumed.context.priorEpisodes.map((episode) => episode.id)).toEqual([
      "episode-smithers-wait",
    ]);
    expect(smithersBridge.resumeRequests[0]?.runId).toBe("run-reenter");
    expect(resumed.threadSnapshot.episodes.map((episode) => episode.id)).toEqual([
      "episode-smithers-wait",
      "episode-smithers-done",
    ]);
  });

  it("reconciles artifacts by replacing stale records with the latest episode artifact", async () => {
    const piBridge = new FakePiRuntimeBridge();
    const staleArtifact = createArtifact({
      id: "artifact-report",
      kind: "log",
      description: "Outdated report",
      path: "/repo/reports/old.log",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const latestArtifact = createArtifact({
      id: "artifact-report",
      kind: "log",
      description: "Latest report",
      path: "/repo/reports/new.log",
      createdAt: "2026-04-08T09:03:00.000Z",
    });
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "episode-pi",
        threadId: "thread-artifacts",
        source: "pi-worker",
        artifacts: [latestArtifact],
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      contextLoader: {
        async load(request) {
          return {
            ...baseLoadedContext(request),
            priorArtifacts: [staleArtifact],
            state: {
              ...baseLoadedContext(request).state,
              artifacts: [staleArtifact],
            },
          };
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-artifacts",
      prompt: "Run the worker path with refreshed artifacts.",
      cwd: "/repo",
      routeHint: "pi-worker",
    });

    expect(result.sessionState.artifacts).toEqual([latestArtifact]);
    expect(result.threadSnapshot.artifacts).toEqual([latestArtifact]);
    expect(result.threadSnapshot.episodes.at(-1)?.artifacts).toEqual([
      latestArtifact,
    ]);
  });

  it("reconciles failed verification into global verification state and a completed-with-issues episode", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "failed",
      records: [
        createVerificationFixture({
          id: "verification-build",
          kind: "build",
          status: "failed",
        }),
      ],
      artifacts: [],
    });
    const priorEpisode = createEpisodeFixture({
      id: "episode-verify-prior",
      threadId: "thread-verify",
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      verificationRunner,
      contextLoader: {
        async load(request) {
          return {
            ...baseLoadedContext(request),
            priorEpisodes: [priorEpisode],
            state: {
              ...baseLoadedContext(request).state,
              episodes: [priorEpisode],
            },
          };
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-verify",
      prompt: "Verify the branch.",
      cwd: "/repo",
      routeHint: "verification",
    });

    expect(result.threadSnapshot.thread.status).toBe("completed");
    expect(result.state.verification.overallStatus).toBe("failed");
    expect(result.threadSnapshot.thread.inputEpisodeIds).toEqual([
      "episode-verify-prior",
    ]);
    expect(result.threadSnapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
      "episode-verify-prior",
    ]);
    expect(result.threadSnapshot.episodes.at(-1)?.status).toBe(
      "completed_with_issues",
    );
    expect(result.threadSnapshot.episodes.at(-1)?.provenance).toEqual({
      executionPath: "verification",
      actor: "verification",
      notes: "Normalized verification execution path.",
    });
  });

  it("auto-routes requireApproval requests into the approval path and waiting_approval state", async () => {
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    const approval = await orchestrator.run({
      threadId: "thread-auto-approve",
      prompt: "Ship it?",
      cwd: "/repo",
      requireApproval: true,
    });

    expect(approval.classification.path).toBe("approval");
    expect(approval.threadSnapshot.thread.status).toBe("waiting_approval");
    expect(approval.state.waiting).toBe(true);
    expect(approval.completion.isComplete).toBe(false);
  });

  it("dispatches explicit route hints at runtime even when workflow seed, approval, and verify signals conflict", async () => {
    const piBridge = new FakePiRuntimeBridge();
    const smithersBridge = new FakeSmithersWorkflowBridge();
    const verificationRunner = new FakeVerificationRunner();
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "episode-explicit-hint",
        threadId: "thread-explicit-hint",
        source: "pi-worker",
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      smithersBridge,
      verificationRunner,
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-explicit-hint",
      prompt: "Please verify this and wait for approval.",
      cwd: "/repo",
      routeHint: "pi-worker",
      requireApproval: true,
      workflowSeedInput: {
        preferredPath: "smithers-workflow",
      },
    });

    expect(result.classification).toEqual({
      path: "pi-worker",
      confidence: "hint",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(piBridge.workerRequests).toHaveLength(1);
    expect(smithersBridge.runRequests).toHaveLength(0);
    expect(verificationRunner.calls).toHaveLength(0);
    expect(result.threadSnapshot.thread.kind).toBe("pi-worker");
  });

  it("treats routeHint auto as unset and still prioritizes approval over verification heuristics", async () => {
    const verificationRunner = new FakeVerificationRunner();
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      verificationRunner,
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-auto-approve-over-verify",
      prompt: "Please verify this change before approval.",
      cwd: "/repo",
      routeHint: "auto",
      requireApproval: true,
    });

    expect(result.classification.path).toBe("approval");
    expect(result.threadSnapshot.thread.status).toBe("waiting_approval");
    expect(verificationRunner.calls).toEqual([]);
  });

  it("auto-routes verify prompts into the verification path and runs verification", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "passed",
      records: [
        createVerificationFixture({
          id: "verification-auto",
          kind: "build",
          status: "passed",
        }),
      ],
      artifacts: [],
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      verificationRunner,
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-auto-verify",
      prompt: "Please verify the branch before merge.",
      cwd: "/repo",
    });

    expect(result.classification.path).toBe("verification");
    expect(verificationRunner.calls).toHaveLength(1);
    expect(result.threadSnapshot.thread.kind).toBe("verification");
    expect(result.threadSnapshot.thread.status).toBe("completed");
  });

  it("tracks explicit waiting_input and waiting_approval states instead of guessing", async () => {
    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    const clarification = await orchestrator.run({
      threadId: "thread-clarify",
      prompt: "Need more detail.",
      cwd: "/repo",
      routeHint: "approval",
    });
    const approval = await orchestrator.run({
      threadId: "thread-approve",
      prompt: "Ship it?",
      cwd: "/repo",
      routeHint: "approval",
      requireApproval: true,
    });

    expect(clarification.threadSnapshot.thread.status).toBe("waiting_input");
    expect(clarification.threadSnapshot.episodes.at(-1)?.provenance).toEqual({
      executionPath: "approval",
      actor: "orchestrator",
      notes: "Approval and clarification paths are explicit state transitions.",
    });
    expect(clarification.completion.isComplete).toBe(false);
    expect(clarification.completion.reason).toBe("waiting_input");
    expect(clarification.state.waiting).toBe(true);
    expect(clarification.state.blocked).toBe(false);
    expect(clarification.state.visibleSummary).toContain(
      "approval:waiting_input:waiting_input",
    );
    expect(approval.threadSnapshot.thread.status).toBe("waiting_approval");
    expect(approval.threadSnapshot.episodes.at(-1)?.provenance).toEqual({
      executionPath: "approval",
      actor: "orchestrator",
      notes: "Approval and clarification paths are explicit state transitions.",
    });
    expect(approval.completion.reason).toBe("waiting_approval");
    expect(approval.state.waiting).toBe(true);
    expect(approval.state.blocked).toBe(false);
    expect(approval.state.visibleSummary).toContain(
      "approval:waiting_approval:waiting_approval",
    );
  });

  it("tracks blocked thread state and completion metadata from a blocked worker episode", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "blocked",
      episode: createEpisodeFixture({
        id: "episode-blocked",
        threadId: "thread-blocked",
        source: "pi-worker",
        status: "blocked",
        followUpSuggestions: ["Unblock credentials before retrying."],
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      contextLoader: {
        async load(request) {
          return baseLoadedContext(request);
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-blocked",
      prompt: "Attempt work that gets blocked.",
      cwd: "/repo",
      routeHint: "pi-worker",
    });

    expect(result.threadSnapshot.thread.status).toBe("blocked");
    expect(result.threadSnapshot.episodes.at(-1)?.status).toBe("blocked");
    expect(result.state.waiting).toBe(false);
    expect(result.state.blocked).toBe(true);
    expect(result.completion.isComplete).toBe(false);
    expect(result.completion.reason).toBe("blocked");
    expect(result.state.visibleSummary).toContain("pi-worker:blocked:blocked");
  });

  it("reconciles waiting_input, blocked, and failed bounded worker outcomes into thread state", async () => {
    const scenarios = [
      {
        runStatus: "waiting_input" as const,
        threadStatus: "waiting_input" as const,
        completion: { isComplete: false, reason: "waiting_input" as const },
        waiting: true,
        blocked: false,
      },
      {
        runStatus: "blocked" as const,
        threadStatus: "blocked" as const,
        completion: { isComplete: false, reason: "blocked" as const },
        waiting: false,
        blocked: true,
      },
      {
        runStatus: "failed" as const,
        threadStatus: "failed" as const,
        completion: { isComplete: true, reason: "failed" as const },
        waiting: false,
        blocked: false,
      },
    ];

    for (const scenario of scenarios) {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: scenario.runStatus,
        episode: createEpisodeFixture({
          id: `episode-${scenario.runStatus}`,
          threadId: `thread-${scenario.runStatus}`,
          source: "pi-worker",
          status: scenario.runStatus,
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
        contextLoader: {
          async load(request) {
            return baseLoadedContext(request);
          },
        },
      });

      const result = await orchestrator.run({
        threadId: `thread-${scenario.runStatus}`,
        prompt: "Run bounded worker with non-completed status.",
        cwd: "/repo",
        routeHint: "pi-worker",
      });

      expect(result.classification.path).toBe("pi-worker");
      expect(result.threadSnapshot.thread.status).toBe(scenario.threadStatus);
      expect(result.completion).toEqual(scenario.completion);
      expect(result.state.waiting).toBe(scenario.waiting);
      expect(result.state.blocked).toBe(scenario.blocked);
    }
  });

  it("maps blocked, failed, and cancelled episode statuses into completion decisions", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "blocked",
      episode: createEpisodeFixture({
        id: "episode-blocked",
        threadId: "thread-blocked",
        source: "pi-worker",
        status: "blocked",
        provenance: {
          executionPath: "pi-worker",
          actor: "pi-worker",
          notes: "Worker blocked on missing dependency.",
        },
      }),
    });
    piBridge.enqueueResult({
      status: "failed",
      episode: createEpisodeFixture({
        id: "episode-failed",
        threadId: "thread-failed",
        source: "pi-worker",
        status: "failed",
        provenance: {
          executionPath: "pi-worker",
          actor: "pi-worker",
          notes: "Worker execution failed.",
        },
      }),
    });

    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-cancelled",
        threadId: "thread-cancelled",
        workflowId: "workflow:thread-cancelled",
        status: "cancelled",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "failed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "episode-cancelled",
        threadId: "thread-cancelled",
        source: "smithers",
        status: "cancelled",
        smithersRunId: "run-cancelled",
        provenance: {
          executionPath: "smithers-workflow",
          actor: "smithers",
          notes: "Run was cancelled.",
        },
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      smithersBridge,
    });

    const blocked = await orchestrator.run({
      threadId: "thread-blocked",
      prompt: "Run worker path that gets blocked.",
      cwd: "/repo",
      routeHint: "pi-worker",
    });
    const failed = await orchestrator.run({
      threadId: "thread-failed",
      prompt: "Run worker path that fails.",
      cwd: "/repo",
      routeHint: "pi-worker",
    });
    const cancelled = await orchestrator.run({
      threadId: "thread-cancelled",
      prompt: "Run workflow path that is cancelled.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
    });

    expect(blocked.completion).toEqual({
      isComplete: false,
      reason: "blocked",
    });
    expect(blocked.threadSnapshot.thread.status).toBe("blocked");
    expect(failed.completion).toEqual({
      isComplete: true,
      reason: "failed",
    });
    expect(failed.threadSnapshot.thread.status).toBe("failed");
    expect(cancelled.completion).toEqual({
      isComplete: true,
      reason: "cancelled",
    });
    expect(cancelled.threadSnapshot.thread.status).toBe("cancelled");
  });

  it("re-enters the same thread from session history without duplicating threads and appends episodes", async () => {
    const sessionHistory: SessionJsonlEntry[] = [
      createSessionHeader({
        id: "thread-reentry",
        timestamp: "2026-04-08T09:00:00.000Z",
        cwd: "/repo",
      }),
    ];

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader: {
        async load(request) {
          const state = reconstructSessionState(sessionHistory);
          return {
            ...baseLoadedContext(request),
            sessionHistory,
            priorEpisodes: state.episodes,
            priorArtifacts: state.artifacts,
            state,
          };
        },
      },
    });

    const first = await orchestrator.run({
      threadId: "thread-reentry",
      prompt: "Summarize the first pass.",
      cwd: "/repo",
    });
    sessionHistory.push(...first.sessionEntries);

    const second = await orchestrator.run({
      threadId: "thread-reentry",
      prompt: "Summarize the second pass.",
      cwd: "/repo",
    });

    const firstEpisodeId = first.threadSnapshot.episodes.at(-1)?.id;
    expect(firstEpisodeId).toBeDefined();
    expect(second.sessionState.threads).toHaveLength(1);
    expect(second.sessionState.threads[0]?.id).toBe("thread-reentry");
    expect(second.threadSnapshot.episodes).toHaveLength(2);
    expect(second.threadSnapshot.thread.createdAt).toBe(
      first.threadSnapshot.thread.createdAt,
    );
    expect(second.threadSnapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
      firstEpisodeId!,
    ]);
    expect(second.sessionEntries[0]?.parentId).toBe(first.sessionEntries.at(-1)?.id);
  });
});
