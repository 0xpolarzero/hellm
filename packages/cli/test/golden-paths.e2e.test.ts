import { appendFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState, reconstructSessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  FileBackedSessionJsonlHarness,
  createEpisodeFixture,
  createVerificationFixture,
  fixedClock,
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

      const first = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run first worker episode.",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        orchestrator,
      );
      harness.appendEntries(first.result.raw.sessionEntries);

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

      expect(piBridge.workerRequests[0]?.inputEpisodeIds).toEqual([]);
      expect(second.result.raw.context.priorEpisodes.map((episode) => episode.id)).toEqual(
        ["golden-reenter-episode-1"],
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
        threadId: "golden-verify",
        prompt: "Verify the branch.",
        cwd: "/repo",
        routeHint: "verification",
      },
      orchestrator,
    );

    expect(result.raw.classification.path).toBe("verification");
    expect(result.raw.state.visibleSummary).toBe(
      "verification:completed:completed",
    );
    expect(result.raw.state.waiting).toBe(false);
    expect(result.raw.state.blocked).toBe(false);
    expect(result.output.status).toBe("completed");
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
