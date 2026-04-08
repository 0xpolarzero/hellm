import { appendFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { executeHeadlessRun } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState, reconstructSessionState } from "@hellm/session-model";
import {
  createTempGitWorkspace,
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  FileBackedSessionJsonlHarness,
  createArtifactFixture,
  createEpisodeFixture,
  createVerificationFixture,
  fixedClock,
  hasGit,
  runHeadlessHarness,
  withTempWorkspace,
} from "@hellm/test-support";

function createBaseOrchestrator(
  dependencies: Parameters<typeof createOrchestrator>[0],
  options: { priorEpisodes?: ReturnType<typeof createEpisodeFixture>[] } = {},
) {
  const priorEpisodes = options.priorEpisodes ?? [];
  return createOrchestrator({
    ...dependencies,
    clock: fixedClock(),
    contextLoader: {
      async load(request) {
        return {
          sessionHistory: [],
          repoAndWorktree: { cwd: request.cwd },
          agentsInstructions: ["Read docs/prd.md"],
          relevantSkills: ["tests"],
          priorEpisodes,
          priorArtifacts: [],
          state: {
            ...createEmptySessionState({
              sessionId: request.threadId,
              sessionCwd: request.cwd,
            }),
            episodes: priorEpisodes,
          },
        };
      },
    },
  });
}

describe("golden path headless specs", () => {
  it("auto-routes from workflow seed preferredPath without explicit route hints", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "golden-seed-run",
        threadId: "golden-seed",
        workflowId: "workflow:golden-seed",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "golden-seed-episode",
        threadId: "golden-seed",
        source: "smithers",
        smithersRunId: "golden-seed-run",
      }),
    });
    const orchestrator = createBaseOrchestrator({ smithersBridge });
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-seed",
        prompt: "Use the structured workflow seed.",
        cwd: "/repo",
        workflowSeedInput: {
          preferredPath: "smithers-workflow",
          tasks: [
            {
              id: "seed-task",
              outputKey: "result",
              prompt: "Run seeded task",
              agent: "pi",
            },
          ],
        },
      },
      orchestrator,
    );

    expect(result.raw.classification.path).toBe("smithers-workflow");
    expect(result.raw.classification.reason).toBe(
      "Structured workflow seed requested a preferred path.",
    );
    expect(result.output.workflowRunIds).toEqual(["golden-seed-run"]);
  });

  it("auto-routes to verification from prompt heuristics without explicit route hints", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "passed",
      records: [
        createVerificationFixture({ kind: "build", status: "passed" }),
        createVerificationFixture({ kind: "test", status: "passed" }),
      ],
      artifacts: [],
    });
    const orchestrator = createBaseOrchestrator({ verificationRunner });
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-verify-auto",
        prompt: "Please verify this branch before merge.",
        cwd: "/repo",
      },
      orchestrator,
    );

    expect(result.raw.classification.path).toBe("verification");
    expect(result.raw.classification.reason).toBe(
      "Prompt emphasizes verification work.",
    );
    expect(result.output.status).toBe("completed");
  });

  it("auto-routes to approval when requireApproval is set without explicit route hints", async () => {
    const orchestrator = createBaseOrchestrator({});
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-approval-auto",
        prompt: "Proceed once approved.",
        cwd: "/repo",
        requireApproval: true,
      },
      orchestrator,
    );

    expect(result.raw.classification.path).toBe("approval");
    expect(result.raw.classification.reason).toBe(
      "Request requires approval or clarification.",
    );
    expect(result.output.status).toBe("waiting_approval");
  });

  it("covers a direct path request", async () => {
    const orchestrator = createBaseOrchestrator({});
    const { result, jsonl } = await runHeadlessHarness(
      {
        threadId: "golden-direct",
        prompt: "Explain the direct path.",
        cwd: "/repo",
        routeHint: "direct",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("completed");
    expect(result.raw.state.visibleSummary).toBe("direct:completed:completed");
    expect(result.raw.state.waiting).toBe(false);
    expect(result.raw.state.blocked).toBe(false);
    expect(result.raw.classification.path).toBe("direct");
    expect(jsonl.at(-1)).toContain("\"run.completed\"");
  });

  it("propagates reused prior episode ids through the headless direct-path snapshot", async () => {
    const priorEpisode = createEpisodeFixture({
      id: "golden-direct-prior",
      threadId: "golden-direct-reuse",
    });
    const orchestrator = createBaseOrchestrator(
      {},
      { priorEpisodes: [priorEpisode] },
    );
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-direct-reuse",
        prompt: "Continue direct execution from prior outcomes.",
        cwd: "/repo",
        routeHint: "direct",
      },
      orchestrator,
    );

    expect(result.threadSnapshot.thread.inputEpisodeIds).toEqual([
      "golden-direct-prior",
    ]);
    expect(result.threadSnapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
      "golden-direct-prior",
    ]);
  });

  it("prefers reconstructed structured state over decoy transcript lines for headless pi-worker inputs", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "golden-structured-state-first";
      const sessionFile = workspace.path(
        ".pi/sessions/golden-structured-state-first.jsonl",
      );
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: threadId,
        cwd: workspace.root,
      });
      const priorEpisode = createEpisodeFixture({
        id: "golden-structured-prior",
        threadId,
        source: "orchestrator",
      });
      harness.append({ kind: "episode", data: priorEpisode });

      const decoyEntries = [
        {
          type: "message",
          id: "entry-decoy-user",
          parentId: "entry-prior-episode",
          timestamp: "2026-04-08T09:00:02.000Z",
          message: {
            role: "user",
            content: "Decoy transcript says input episode is golden-decoy.",
            timestamp: Date.parse("2026-04-08T09:00:02.000Z"),
          },
        },
        {
          type: "message",
          id: "entry-decoy-assistant",
          parentId: "entry-decoy-user",
          timestamp: "2026-04-08T09:00:03.000Z",
          message: {
            role: "assistant",
            content: "{\"inputEpisodeIds\":[\"golden-decoy\"]}",
            timestamp: Date.parse("2026-04-08T09:00:03.000Z"),
          },
        },
      ];
      appendFileSync(
        sessionFile,
        `${decoyEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        "utf8",
      );

      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "golden-structured-state-first-episode",
          threadId,
          source: "pi-worker",
          inputEpisodeIds: ["golden-structured-prior"],
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
        contextLoader: {
          async load(request) {
            const sessionHistory = harness.lines();
            const state = reconstructSessionState(sessionHistory);
            return {
              sessionHistory,
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

      const { result } = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run worker using structured state, not transcript replay.",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        orchestrator,
      );

      expect(result.raw.context.priorEpisodes.map((episode) => episode.id)).toEqual([
        "golden-structured-prior",
      ]);
      expect(
        piBridge.workerRequests[0]?.scopedContext.sessionHistory.some((entry) =>
          entry.includes("\"entry-decoy-user\""),
        ),
      ).toBe(true);
      expect(piBridge.workerRequests[0]?.inputEpisodeIds).toEqual([
        "golden-structured-prior",
      ]);
      expect(piBridge.workerRequests[0]?.inputEpisodeIds).not.toContain(
        "golden-decoy",
      );
      expect(result.threadSnapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
        "golden-structured-prior",
      ]);
    });
  });

  it("covers a pi worker path request", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "golden-pi-episode",
        threadId: "golden-pi",
        source: "pi-worker",
      }),
    });
    const orchestrator = createBaseOrchestrator({ piBridge });
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-pi",
        prompt: "Run the bounded worker path.",
        cwd: "/repo",
        routeHint: "pi-worker",
      },
      orchestrator,
    );

    expect(result.raw.classification.path).toBe("pi-worker");
    expect(result.raw.state.visibleSummary).toBe("pi-worker:completed:completed");
    expect(result.raw.state.waiting).toBe(false);
    expect(result.raw.state.blocked).toBe(false);
    expect(piBridge.workerRequests[0]?.runtimeTransition).toEqual({
      reason: "new",
      toSessionId: "golden-pi:pi",
      aligned: true,
    });
    expect(result.threadSnapshot.episodes.at(-1)?.source).toBe("pi-worker");
  });

  it("covers a pi worker resume request and forwards the resume transition", async () => {
    const piBridge = new FakePiRuntimeBridge();
    const worktreePath = "/repo/.worktrees/feature-pi";
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "golden-pi-resume-episode",
        threadId: "golden-pi-resume",
        source: "pi-worker",
        worktreePath,
      }),
    });
    const orchestrator = createBaseOrchestrator({ piBridge });
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-pi-resume",
        prompt: "Resume bounded worker execution.",
        cwd: "/repo",
        worktreePath,
        routeHint: "pi-worker",
        resumeRunId: "pi-run-1",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("completed");
    expect(piBridge.workerRequests[0]?.runtimeTransition).toEqual({
      reason: "resume",
      toSessionId: "golden-pi-resume:pi",
      aligned: false,
      toWorktreePath: worktreePath,
    });
    expect(piBridge.workerRequests[0]?.runtimeTransition?.fromSessionId).toBeUndefined();
    expect(
      piBridge.workerRequests[0]?.runtimeTransition?.fromWorktreePath,
    ).toBeUndefined();
    expect(result.threadSnapshot.thread.worktreePath).toBe(worktreePath);
  });

  it("derives resume runtime transition worktree from context when the request omits worktreePath", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const worktreePath = await workspace.createLinkedWorktree(
        "feature-pi-context-runtime",
      );
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "golden-pi-context-resume-episode",
          threadId: "golden-pi-context-resume",
          source: "pi-worker",
          worktreePath,
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
        contextLoader: {
          async load(request) {
            return {
              sessionHistory: [],
              repoAndWorktree: { cwd: workspace.root, worktreePath },
              agentsInstructions: ["Read docs/prd.md"],
              relevantSkills: ["tests"],
              priorEpisodes: [],
              priorArtifacts: [],
              state: createEmptySessionState({
                sessionId: request.threadId,
                sessionCwd: workspace.root,
                activeWorktreePath: worktreePath,
              }),
            };
          },
        },
      });

      const { result } = await runHeadlessHarness(
        {
          threadId: "golden-pi-context-resume",
          prompt: "Resume from context-bound worktree.",
          cwd: workspace.root,
          routeHint: "pi-worker",
          resumeRunId: "pi-context-resume-1",
        },
        orchestrator,
      );

      expect(result.output.status).toBe("completed");
      expect(piBridge.workerRequests[0]?.runtimeTransition).toEqual({
        reason: "resume",
        toSessionId: "golden-pi-context-resume:pi",
        aligned: false,
        toWorktreePath: worktreePath,
      });
      expect(result.threadSnapshot.thread.worktreePath).toBe(worktreePath);
    } finally {
      await workspace.cleanup();
    }
  });

  it("covers a waiting pi worker path request and emits waiting JSONL events", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "waiting_input",
      episode: createEpisodeFixture({
        id: "golden-pi-waiting-episode",
        threadId: "golden-pi-waiting",
        source: "pi-worker",
        status: "waiting_input",
      }),
    });
    const orchestrator = createBaseOrchestrator({ piBridge });
    const { result, jsonl } = await runHeadlessHarness(
      {
        threadId: "golden-pi-waiting",
        prompt: "Need more details before continuing.",
        cwd: "/repo",
        routeHint: "pi-worker",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("waiting_input");
    expect(result.events.at(-1)?.type).toBe("run.waiting");
    expect(result.events.find((event) => event.type === "run.episode")).toMatchObject(
      {
        source: "pi-worker",
        status: "waiting_input",
      },
    );
    expect(jsonl.at(-1)).toContain("\"run.waiting\"");
  });

  it("persists waiting and blocked worker states through file-backed JSONL re-entry", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "golden-waiting-blocked-jsonl";
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/golden-waiting-blocked.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "waiting_input",
        episode: createEpisodeFixture({
          id: "golden-waiting-jsonl-episode",
          threadId,
          source: "pi-worker",
          status: "waiting_input",
        }),
      });
      piBridge.enqueueResult({
        status: "blocked",
        episode: createEpisodeFixture({
          id: "golden-blocked-jsonl-episode",
          threadId,
          source: "pi-worker",
          status: "blocked",
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
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

      const first = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run worker episode that needs user input.",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        orchestrator,
      );
      harness.appendEntries(first.result.raw.sessionEntries);

      const second = await runHeadlessHarness(
        {
          threadId,
          prompt: "Retry worker episode that remains blocked.",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        orchestrator,
      );
      harness.appendEntries(second.result.raw.sessionEntries);

      const reconstructed = harness.reconstruct();

      expect(first.result.output.status).toBe("waiting_input");
      expect(first.result.events.at(-1)?.type).toBe("run.waiting");
      expect(second.result.output.status).toBe("blocked");
      expect(second.result.events.at(-1)?.type).toBe("run.waiting");
      expect(second.result.raw.context.priorEpisodes.map((episode) => episode.id)).toEqual([
        "golden-waiting-jsonl-episode",
      ]);
      expect(reconstructed.threads).toHaveLength(1);
      expect(reconstructed.threads[0]?.status).toBe("blocked");
      expect(reconstructed.episodes.map((episode) => episode.id)).toEqual([
        "golden-waiting-jsonl-episode",
        "golden-blocked-jsonl-episode",
      ]);
      expect(reconstructed.episodes.map((episode) => episode.status)).toEqual([
        "waiting_input",
        "blocked",
      ]);
      expect(harness.jsonl()).toContain("\"status\":\"waiting_input\"");
      expect(harness.jsonl()).toContain("\"status\":\"blocked\"");
    });
  });

  it("covers a blocked pi worker path request and keeps blocked state in headless output/events", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "blocked",
      episode: createEpisodeFixture({
        id: "golden-pi-blocked-episode",
        threadId: "golden-pi-blocked",
        source: "pi-worker",
        status: "blocked",
      }),
    });
    const orchestrator = createBaseOrchestrator({ piBridge });
    const { result, jsonl } = await runHeadlessHarness(
      {
        threadId: "golden-pi-blocked",
        prompt: "Run bounded worker and stop on blocked state.",
        cwd: "/repo",
        routeHint: "pi-worker",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("blocked");
    expect(result.raw.state.visibleSummary).toBe("pi-worker:blocked:blocked");
    expect(result.raw.state.waiting).toBe(false);
    expect(result.raw.state.blocked).toBe(true);
    expect(result.events.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "blocked",
    });
    expect(jsonl.at(-1)).toContain("\"run.waiting\"");
  });

  it("re-enters after each headless episode using file-backed JSONL session state", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "golden-reenter";
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/golden-reenter.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "golden-reenter-episode-1",
          threadId,
          source: "pi-worker",
        }),
      });
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "golden-reenter-episode-2",
          threadId,
          source: "pi-worker",
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
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

      const first = await executeHeadlessRun(
        {
          threadId,
          prompt: "Run first worker episode.",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        { orchestrator },
      );
      harness.appendEntries(first.raw.sessionEntries);

      const second = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run second worker episode.",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        orchestrator,
      );
      harness.appendEntries(second.result.raw.sessionEntries);
      const reconstructed = harness.reconstruct();

      expect(first.orchestratorId).toBe(second.result.orchestratorId);
      expect(piBridge.workerRequests[0]?.inputEpisodeIds).toEqual([]);
      expect(second.result.raw.context.priorEpisodes.map((episode) => episode.id)).toEqual(
        ["golden-reenter-episode-1"],
      );
      expect(second.result.raw.sessionEntries[0]?.parentId).toBe(
        first.raw.sessionEntries.at(-1)?.id,
      );
      expect(piBridge.workerRequests[1]?.inputEpisodeIds).toEqual([
        "golden-reenter-episode-1",
      ]);
      expect(second.result.threadSnapshot.thread.inputEpisodeIds).toEqual([
        "golden-reenter-episode-1",
      ]);
      expect(reconstructed.episodes.map((episode) => episode.id)).toEqual([
        "golden-reenter-episode-1",
        "golden-reenter-episode-2",
      ]);
      expect(second.result.events.at(-1)?.type).toBe("run.completed");
    });
  });

  it("re-enters lint verification using file-backed JSONL session state", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "golden-lint-reenter";
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/golden-lint-reenter.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      const verificationRunner = new FakeVerificationRunner();
      verificationRunner.enqueueResult({
        status: "failed",
        records: [
          createVerificationFixture({
            id: "golden-lint-reenter-1",
            kind: "lint",
            status: "failed",
            summary: "eslint found 2 errors",
          }),
        ],
        artifacts: [
          createArtifactFixture({
            id: "golden-lint-artifact-1",
            kind: "log",
            path: workspace.path("reports/lint-1.log"),
          }),
        ],
      });
      verificationRunner.enqueueResult({
        status: "passed",
        records: [
          createVerificationFixture({
            id: "golden-lint-reenter-2",
            kind: "lint",
            status: "passed",
            summary: "eslint clean",
          }),
        ],
        artifacts: [
          createArtifactFixture({
            id: "golden-lint-artifact-2",
            kind: "log",
            path: workspace.path("reports/lint-2.log"),
          }),
        ],
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        verificationRunner,
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

      const first = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run lint verification first pass.",
          cwd: workspace.root,
          routeHint: "verification",
          workflowSeedInput: {
            verificationKinds: ["lint"],
          },
        },
        orchestrator,
      );
      harness.appendEntries(first.result.raw.sessionEntries);

      const second = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run lint verification second pass.",
          cwd: workspace.root,
          routeHint: "verification",
          workflowSeedInput: {
            verificationKinds: ["lint"],
          },
        },
        orchestrator,
      );
      harness.appendEntries(second.result.raw.sessionEntries);

      const reconstructed = harness.reconstruct();
      const firstEpisodeId = first.result.threadSnapshot.episodes.at(-1)?.id;
      expect(firstEpisodeId).toBeDefined();
      const expectedInputEpisodeIds = [firstEpisodeId as string];

      expect(verificationRunner.calls.map((call) => call.kinds)).toEqual([
        ["lint"],
        ["lint"],
      ]);
      expect(second.result.raw.context.priorEpisodes.map((episode) => episode.id)).toEqual(
        expectedInputEpisodeIds,
      );
      expect(second.result.threadSnapshot.episodes.at(-1)?.inputEpisodeIds).toEqual(
        expectedInputEpisodeIds,
      );
      expect(reconstructed.verification.byKind.lint?.status).toBe("passed");
      expect(reconstructed.verification.overallStatus).toBe("passed");
      expect(reconstructed.episodes.at(-1)?.verification[0]?.kind).toBe("lint");
    });
  });

  it("re-enters from persisted JSONL using a fresh orchestrator instance for each headless run", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "golden-reenter-fresh-orchestrator";
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/golden-reenter-fresh.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "golden-fresh-episode-1",
          threadId,
          source: "pi-worker",
        }),
      });
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "golden-fresh-episode-2",
          threadId,
          source: "pi-worker",
        }),
      });

      const createReentryOrchestrator = () =>
        createOrchestrator({
          clock: fixedClock(),
          piBridge,
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

      const first = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run first worker episode.",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        createReentryOrchestrator(),
      );
      harness.appendEntries(first.result.raw.sessionEntries);

      const second = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run second worker episode.",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        createReentryOrchestrator(),
      );
      harness.appendEntries(second.result.raw.sessionEntries);

      const firstEntryIds = first.result.raw.sessionEntries.map((entry) => entry.id);
      const secondEntryIds = second.result.raw.sessionEntries.map((entry) => entry.id);
      const allEntryIds = [...firstEntryIds, ...secondEntryIds];

      expect(second.result.raw.context.priorEpisodes.map((episode) => episode.id)).toEqual(
        ["golden-fresh-episode-1"],
      );
      expect(piBridge.workerRequests[1]?.inputEpisodeIds).toEqual([
        "golden-fresh-episode-1",
      ]);
      expect(secondEntryIds.some((id) => firstEntryIds.includes(id))).toBe(false);
      expect(new Set(allEntryIds).size).toBe(allEntryIds.length);
      expect(second.result.raw.sessionEntries[0]?.parentId).toBe(
        first.result.raw.sessionEntries.at(-1)?.id,
      );
      expect(second.result.events.at(-1)?.type).toBe("run.completed");
    });
  });

  it("re-enters a smithers approval flow from file-backed JSONL state and resumes with prior waiting episode context", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "golden-reenter-smithers";
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/golden-reenter-smithers.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: "golden-reenter-smithers-run",
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
        status: "waiting_approval",
        outputs: [],
        approval: {
          nodeId: "approve",
          title: "Approve workflow",
          summary: "Need approval before resuming.",
          mode: "needsApproval",
        },
        episode: createEpisodeFixture({
          id: "golden-reenter-smithers-wait",
          threadId,
          source: "smithers",
          status: "waiting_approval",
          smithersRunId: "golden-reenter-smithers-run",
        }),
      });
      smithersBridge.enqueueResumeResult({
        run: {
          runId: "golden-reenter-smithers-run",
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "golden-reenter-smithers-done",
          threadId,
          source: "smithers",
          status: "completed",
          smithersRunId: "golden-reenter-smithers-run",
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

      const waiting = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run smithers episode that requires approval.",
          cwd: workspace.root,
          routeHint: "smithers-workflow",
          requireApproval: true,
        },
        orchestrator,
      );
      harness.appendEntries(waiting.result.raw.sessionEntries);

      const resumed = await runHeadlessHarness(
        {
          threadId,
          prompt: "Resume smithers workflow after approval.",
          cwd: workspace.root,
          routeHint: "smithers-workflow",
          resumeRunId: "golden-reenter-smithers-run",
        },
        orchestrator,
      );
      harness.appendEntries(resumed.result.raw.sessionEntries);
      const reconstructed = harness.reconstruct();

      expect(waiting.result.output.status).toBe("waiting_approval");
      expect(resumed.result.raw.context.priorEpisodes.map((episode) => episode.id)).toEqual(
        ["golden-reenter-smithers-wait"],
      );
      expect(smithersBridge.resumeRequests[0]?.runId).toBe(
        "golden-reenter-smithers-run",
      );
      expect(reconstructed.episodes.map((episode) => episode.id)).toEqual([
        "golden-reenter-smithers-wait",
        "golden-reenter-smithers-done",
      ]);
      expect(resumed.result.events.at(-1)?.type).toBe("run.completed");
    });
  });

  it("covers a smithers workflow path with approval and resume", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "golden-run",
        threadId: "golden-smithers",
        workflowId: "workflow:golden-smithers",
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "waiting_approval",
      outputs: [],
      approval: {
        nodeId: "approve",
        title: "Approve workflow",
        summary: "Needs approval",
        mode: "needsApproval",
      },
      episode: createEpisodeFixture({
        id: "golden-smithers-wait",
        threadId: "golden-smithers",
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: "golden-run",
      }),
    });
    smithersBridge.enqueueResumeResult({
      run: {
        runId: "golden-run",
        threadId: "golden-smithers",
        workflowId: "workflow:golden-smithers",
        status: "completed",
        updatedAt: "2026-04-08T09:05:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "golden-smithers-done",
        threadId: "golden-smithers",
        source: "smithers",
        status: "completed",
        smithersRunId: "golden-run",
      }),
    });
    const orchestrator = createBaseOrchestrator({ smithersBridge });

    const first = await runHeadlessHarness(
      {
        threadId: "golden-smithers",
        prompt: "Run the workflow path.",
        cwd: "/repo",
        routeHint: "smithers-workflow",
        requireApproval: true,
      },
      orchestrator,
    );
    await smithersBridge.approveRun("golden-run", { approved: true });
    const second = await runHeadlessHarness(
      {
        threadId: "golden-smithers",
        prompt: "Resume the workflow path.",
        cwd: "/repo",
        routeHint: "smithers-workflow",
        resumeRunId: "golden-run",
      },
      orchestrator,
    );

    expect(first.result.output.status).toBe("waiting_approval");
    expect(first.result.raw.state.visibleSummary).toBe(
      "smithers-workflow:waiting_approval:waiting_approval",
    );
    expect(first.result.raw.state.waiting).toBe(true);
    expect(first.result.raw.state.blocked).toBe(false);
    expect(first.result.events.at(-1)?.type).toBe("run.waiting");
    expect(second.result.output.workflowRunIds).toEqual(["golden-run"]);
    expect(second.result.raw.state.visibleSummary).toBe(
      "smithers-workflow:completed:completed",
    );
    expect(second.result.raw.state.waiting).toBe(false);
    expect(second.result.raw.state.blocked).toBe(false);
    expect(second.result.events.at(-1)?.type).toBe("run.completed");
  });

  it("persists smithers isolation references across file-backed headless runs and upserts by run id", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "golden-smithers-isolation-upsert";
      const runId = "golden-isolation-run";
      const worktreePath = workspace.path("worktrees/feature-smithers");
      const firstStore = workspace.path(".smithers/run-isolation-v1.sqlite");
      const secondStore = workspace.path(".smithers/run-isolation-v2.sqlite");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/golden-smithers-isolation-upsert.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      let state = createEmptySessionState({
        sessionId: threadId,
        sessionCwd: workspace.root,
      });
      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId,
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "waiting_approval",
        outputs: [],
        approval: {
          nodeId: "approve",
          title: "Approve workflow",
          summary: "Awaiting approval",
          mode: "needsApproval",
        },
        episode: createEpisodeFixture({
          id: "golden-smithers-isolation-upsert-waiting",
          threadId,
          source: "smithers",
          status: "waiting_approval",
          smithersRunId: runId,
          worktreePath,
        }),
        isolation: {
          runId,
          runStateStore: firstStore,
          sessionEntryIds: ["entry-1"],
        },
      });
      smithersBridge.enqueueResumeResult({
        run: {
          runId,
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
          worktreePath,
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "golden-smithers-isolation-upsert-completed",
          threadId,
          source: "smithers",
          status: "completed",
          smithersRunId: runId,
          worktreePath,
        }),
        isolation: {
          runId,
          runStateStore: secondStore,
          sessionEntryIds: ["entry-1", "entry-2"],
        },
      });
      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        smithersBridge,
        contextLoader: {
          async load(request) {
            return {
              sessionHistory: harness.lines(),
              repoAndWorktree: {
                cwd: request.cwd,
                ...(request.worktreePath ? { worktreePath: request.worktreePath } : {}),
              },
              agentsInstructions: ["Read docs/prd.md"],
              relevantSkills: ["tests"],
              priorEpisodes: state.episodes,
              priorArtifacts: state.artifacts,
              state,
            };
          },
        },
      });

      const first = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run smithers workflow with isolated state.",
          cwd: workspace.root,
          worktreePath,
          routeHint: "smithers-workflow",
          requireApproval: true,
        },
        orchestrator,
      );
      harness.appendEntries(first.result.raw.sessionEntries);
      state = harness.reconstruct();

      const second = await runHeadlessHarness(
        {
          threadId,
          prompt: "Resume smithers workflow.",
          cwd: workspace.root,
          worktreePath,
          routeHint: "smithers-workflow",
          resumeRunId: runId,
        },
        orchestrator,
      );
      harness.appendEntries(second.result.raw.sessionEntries);
      const reconstructed = harness.reconstruct();

      expect(first.result.raw.sessionState.smithersIsolations).toEqual([
        {
          runId,
          runStateStore: firstStore,
          sessionEntryIds: ["entry-1"],
        },
      ]);
      expect(second.result.raw.sessionState.smithersIsolations).toEqual([
        {
          runId,
          runStateStore: secondStore,
          sessionEntryIds: ["entry-1", "entry-2"],
        },
      ]);
      expect(reconstructed.smithersIsolations).toEqual([
        {
          runId,
          runStateStore: secondStore,
          sessionEntryIds: ["entry-1", "entry-2"],
        },
      ]);
      expect(second.result.output.workflowRunIds).toEqual([runId]);
      expect(
        second.result.raw.sessionEntries.filter(
          (entry) => entry.message.customType === "hellm/smithers-isolation",
        ),
      ).toHaveLength(1);
      expect(
        (second.result.threadSnapshot as unknown as { smithersIsolations?: unknown })
          .smithersIsolations,
      ).toBeUndefined();
      expect(JSON.stringify(second.result.output)).not.toContain(".sqlite");
    });
  });

  it("keeps the prior smithers isolation reference when a resume response omits isolation metadata", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "golden-smithers-isolation-retain";
      const runId = "golden-isolation-retain-run";
      const worktreePath = workspace.path("worktrees/feature-smithers-retain");
      const storePath = workspace.path(".smithers/run-isolation-retain.sqlite");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/golden-smithers-isolation-retain.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      let state = createEmptySessionState({
        sessionId: threadId,
        sessionCwd: workspace.root,
      });
      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId,
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "waiting_approval",
        outputs: [],
        approval: {
          nodeId: "approve",
          title: "Approve workflow",
          summary: "Awaiting approval",
          mode: "needsApproval",
        },
        episode: createEpisodeFixture({
          id: "golden-smithers-isolation-retain-waiting",
          threadId,
          source: "smithers",
          status: "waiting_approval",
          smithersRunId: runId,
          worktreePath,
        }),
        isolation: {
          runId,
          runStateStore: storePath,
          sessionEntryIds: ["entry-start"],
        },
      });
      smithersBridge.enqueueResumeResult({
        run: {
          runId,
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
          worktreePath,
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "golden-smithers-isolation-retain-completed",
          threadId,
          source: "smithers",
          status: "completed",
          smithersRunId: runId,
          worktreePath,
        }),
      });
      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        smithersBridge,
        contextLoader: {
          async load(request) {
            return {
              sessionHistory: harness.lines(),
              repoAndWorktree: {
                cwd: request.cwd,
                ...(request.worktreePath ? { worktreePath: request.worktreePath } : {}),
              },
              agentsInstructions: ["Read docs/prd.md"],
              relevantSkills: ["tests"],
              priorEpisodes: state.episodes,
              priorArtifacts: state.artifacts,
              state,
            };
          },
        },
      });

      const first = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run smithers workflow with isolated state.",
          cwd: workspace.root,
          worktreePath,
          routeHint: "smithers-workflow",
          requireApproval: true,
        },
        orchestrator,
      );
      harness.appendEntries(first.result.raw.sessionEntries);
      state = harness.reconstruct();

      const second = await runHeadlessHarness(
        {
          threadId,
          prompt: "Resume smithers workflow without a new isolation payload.",
          cwd: workspace.root,
          worktreePath,
          routeHint: "smithers-workflow",
          resumeRunId: runId,
        },
        orchestrator,
      );
      harness.appendEntries(second.result.raw.sessionEntries);
      const reconstructed = harness.reconstruct();

      expect(first.result.raw.sessionState.smithersIsolations).toEqual([
        {
          runId,
          runStateStore: storePath,
          sessionEntryIds: ["entry-start"],
        },
      ]);
      expect(second.result.raw.sessionState.smithersIsolations).toEqual([
        {
          runId,
          runStateStore: storePath,
          sessionEntryIds: ["entry-start"],
        },
      ]);
      expect(reconstructed.smithersIsolations).toEqual([
        {
          runId,
          runStateStore: storePath,
          sessionEntryIds: ["entry-start"],
        },
      ]);
      expect(
        second.result.raw.sessionEntries.some(
          (entry) => entry.message.customType === "hellm/smithers-isolation",
        ),
      ).toBe(false);
    });
  });

  it("covers a blocked smithers workflow request and preserves blocked visible state in headless output", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "golden-run-blocked",
        threadId: "golden-smithers-blocked",
        workflowId: "workflow:golden-smithers-blocked",
        status: "failed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "blocked",
      outputs: [],
      episode: createEpisodeFixture({
        id: "golden-smithers-blocked-episode",
        threadId: "golden-smithers-blocked",
        source: "smithers",
        status: "blocked",
        smithersRunId: "golden-run-blocked",
      }),
    });
    const orchestrator = createBaseOrchestrator({ smithersBridge });
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-smithers-blocked",
        prompt: "Run blocked workflow path.",
        cwd: "/repo",
        routeHint: "smithers-workflow",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("blocked");
    expect(result.raw.state.visibleSummary).toBe(
      "smithers-workflow:blocked:blocked",
    );
    expect(result.raw.state.waiting).toBe(false);
    expect(result.raw.state.blocked).toBe(true);
    expect(result.events.at(-1)?.type).toBe("run.waiting");
  });

  it("covers a verification-only request", async () => {
    const verificationRunner = new FakeVerificationRunner();
    const lintArtifact = createArtifactFixture({
      id: "golden-verify-lint-artifact",
      kind: "log",
      path: "/repo/reports/lint.log",
    });
    verificationRunner.enqueueResult({
      status: "failed",
      records: [
        createVerificationFixture({ kind: "build", status: "passed" }),
        createVerificationFixture({ kind: "test", status: "passed" }),
        createVerificationFixture({
          kind: "integration",
          status: "failed",
          summary: "Integration smoke test failed",
        }),
        createVerificationFixture({
          kind: "lint",
          status: "passed",
          artifactIds: [lintArtifact.id],
        }),
      ],
      artifacts: [lintArtifact],
    });
    const orchestrator = createBaseOrchestrator({ verificationRunner });
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-verify",
        prompt: "Verify the branch.",
        cwd: "/repo",
        routeHint: "verification",
      },
      orchestrator,
    );

    expect(result.raw.classification.path).toBe("verification");
    expect(result.raw.state.visibleSummary).toBe(
      "verification:completed:completed_with_issues",
    );
    expect(result.raw.state.waiting).toBe(false);
    expect(result.raw.state.blocked).toBe(false);
    expect(result.output.status).toBe("completed");
    expect(result.threadSnapshot.episodes.at(-1)?.status).toBe(
      "completed_with_issues",
    );
    expect(result.raw.state.verification.byKind.integration?.status).toBe(
      "failed",
    );
    expect(result.raw.state.verification.overallStatus).toBe("failed");
    expect(verificationRunner.calls[0]?.kinds).toEqual(["build", "test", "lint", "integration"]);
    expect(result.threadSnapshot.episodes.at(-1)?.verification).toEqual([
      expect.objectContaining({ kind: "build", status: "passed" }),
      expect.objectContaining({ kind: "test", status: "passed" }),
      expect.objectContaining({ kind: "integration", status: "failed" }),
      expect.objectContaining({ kind: "lint", status: "passed" }),
    ]);
    expect(result.threadSnapshot.episodes.at(-1)?.artifacts).toEqual([
      lintArtifact,
    ]);
    expect(result.raw.state.verification.byKind.lint).toEqual(
      expect.objectContaining({ kind: "lint", status: "passed" }),
    );
  });

  it("covers a manual-only verification request and forwards manual checks", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "failed",
      records: [
        createVerificationFixture({
          kind: "manual",
          status: "failed",
          summary: "Manual verification failed on acceptance checks",
        }),
      ],
      artifacts: [],
    });
    const orchestrator = createBaseOrchestrator({ verificationRunner });
    const { result, jsonl } = await runHeadlessHarness(
      {
        threadId: "golden-verify-manual",
        prompt: "Run only manual verification checks.",
        cwd: "/repo",
        routeHint: "verification",
        workflowSeedInput: {
          verificationKinds: ["manual"],
          manualChecks: [
            "Open the app and validate the acceptance flow.",
            "Capture outcomes for manual QA sign-off.",
          ],
        },
      },
      orchestrator,
    );

    expect(verificationRunner.calls[0]).toMatchObject({
      kinds: ["manual"],
      manualChecks: [
        "Open the app and validate the acceptance flow.",
        "Capture outcomes for manual QA sign-off.",
      ],
    });
    expect(result.raw.classification.path).toBe("verification");
    expect(result.raw.state.visibleSummary).toBe(
      "verification:completed:completed_with_issues",
    );
    expect(result.raw.state.verification.byKind.manual?.status).toBe("failed");
    expect(result.output.status).toBe("completed");
    expect(result.output.summary).toBe("Verification failed.");
    expect(result.events[2]).toMatchObject({
      type: "run.episode",
      source: "verification",
      status: "completed_with_issues",
    });
    expect(result.events.at(-1)?.type).toBe("run.completed");
    expect(jsonl.at(-1)).toContain("\"run.completed\"");
  });

  it("treats failed verification as completed headless output while surfacing failed reconciliation state", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "failed",
      records: [
        createVerificationFixture({
          id: "golden-verification-build-failed",
          kind: "build",
          status: "failed",
        }),
        createVerificationFixture({
          id: "golden-verification-test-passed",
          kind: "test",
          status: "passed",
        }),
      ],
      artifacts: [],
    });
    const orchestrator = createBaseOrchestrator({ verificationRunner });
    const { result, jsonl } = await runHeadlessHarness(
      {
        threadId: "golden-verify-failed",
        prompt: "Verify and report failures.",
        cwd: "/repo",
        routeHint: "verification",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("completed");
    expect(result.raw.completion).toEqual({
      isComplete: true,
      reason: "completed",
    });
    expect(result.raw.state.verification.overallStatus).toBe("failed");
    expect(result.raw.state.visibleSummary).toBe(
      "verification:completed:completed_with_issues",
    );
    expect(result.threadSnapshot.episodes.at(-1)?.status).toBe(
      "completed_with_issues",
    );
    expect(result.events.at(-1)?.type).toBe("run.completed");
    expect(result.events.find((event) => event.type === "run.episode")).toMatchObject(
      {
        source: "verification",
        status: "completed_with_issues",
      },
    );
    expect(jsonl.at(-1)).toContain("\"run.completed\"");
  });

  it("covers a clarification or waiting request", async () => {
    const orchestrator = createBaseOrchestrator({});
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-wait",
        prompt: "Need clarification first.",
        cwd: "/repo",
        routeHint: "approval",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("waiting_input");
    expect(result.raw.state.visibleSummary).toBe(
      "approval:waiting_input:waiting_input",
    );
    expect(result.raw.state.waiting).toBe(true);
    expect(result.raw.state.blocked).toBe(false);
    expect(result.events.at(-1)?.type).toBe("run.waiting");
  });

  it("covers an approval-gated waiting request", async () => {
    const orchestrator = createBaseOrchestrator({});
    const { result } = await runHeadlessHarness(
      {
        threadId: "golden-wait-approval",
        prompt: "Require explicit approval before proceeding.",
        cwd: "/repo",
        routeHint: "approval",
        requireApproval: true,
      },
      orchestrator,
    );

    expect(result.output.status).toBe("waiting_approval");
    expect(result.events.at(-1)?.type).toBe("run.waiting");
    expect(result.raw.completion.reason).toBe("waiting_approval");
  });

  it("covers a blocked worker request", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "blocked",
      episode: createEpisodeFixture({
        id: "golden-blocked-episode",
        threadId: "golden-blocked",
        source: "pi-worker",
        status: "blocked",
        followUpSuggestions: ["Resolve environment issue before retrying."],
      }),
    });
    const orchestrator = createBaseOrchestrator({ piBridge });
    const { result, jsonl } = await runHeadlessHarness(
      {
        threadId: "golden-blocked",
        prompt: "Run worker in a blocked environment.",
        cwd: "/repo",
        routeHint: "pi-worker",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("blocked");
    expect(result.events.at(-1)?.type).toBe("run.waiting");
    expect(result.raw.completion.reason).toBe("blocked");
    expect(result.raw.state.waiting).toBe(false);
    expect(result.raw.state.blocked).toBe(true);
    expect(jsonl.at(-1)).toContain("\"status\":\"blocked\"");
  });
});
