import { describe, expect, it } from "bun:test";
import { executeHeadlessRun, serializeJsonlEvents } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState, type SessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FileBackedSessionJsonlHarness,
  createEpisodeFixture,
  fixedClock,
  withTempWorkspace,
} from "@hellm/test-support";

function createContextState(
  threadId: string,
  cwd: string,
  overrides: Partial<SessionState> = {},
): SessionState {
  return {
    ...createEmptySessionState({
      sessionId: threadId,
      sessionCwd: cwd,
    }),
    ...overrides,
  };
}

describe("@hellm/cli structured headless output", () => {
  it("prefers conclusions[0] as summary when present", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "episode-summary-conclusion",
        threadId: "thread-summary-conclusion",
        source: "pi-worker",
        objective: "Objective fallback should not be used",
        conclusions: ["Use this conclusion", "Ignore this conclusion"],
        followUpSuggestions: ["Ignore this follow-up"],
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      contextLoader: {
        async load(request) {
          return {
            sessionHistory: [],
            repoAndWorktree: { cwd: request.cwd },
            agentsInstructions: [],
            relevantSkills: [],
            priorEpisodes: [],
            priorArtifacts: [],
            state: createContextState(request.threadId, request.cwd),
          };
        },
      },
    });

    const result = await executeHeadlessRun(
      {
        threadId: "thread-summary-conclusion",
        prompt: "Run bounded worker.",
        cwd: "/repo",
        routeHint: "pi-worker",
      },
      { orchestrator },
    );

    expect(result.output.summary).toBe("Use this conclusion");
  });

  it("falls back to followUpSuggestions[0] when conclusions are absent", async () => {
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
            state: createContextState(request.threadId, request.cwd),
          };
        },
      },
    });

    const result = await executeHeadlessRun(
      {
        threadId: "thread-summary-followup",
        prompt: "Pause for approval.",
        cwd: "/repo",
        routeHint: "approval",
        requireApproval: true,
      },
      { orchestrator },
    );

    expect(result.output.summary).toBe(
      "Await explicit approval before resuming work.",
    );
  });

  it("falls back to objective when both conclusions and follow-up suggestions are absent", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisodeFixture({
        id: "episode-summary-objective",
        threadId: "thread-summary-objective",
        source: "pi-worker",
        objective: "Use this objective fallback",
      }),
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      piBridge,
      contextLoader: {
        async load(request) {
          return {
            sessionHistory: [],
            repoAndWorktree: { cwd: request.cwd },
            agentsInstructions: [],
            relevantSkills: [],
            priorEpisodes: [],
            priorArtifacts: [],
            state: createContextState(request.threadId, request.cwd),
          };
        },
      },
    });

    const result = await executeHeadlessRun(
      {
        threadId: "thread-summary-objective",
        prompt: "Worker prompt",
        cwd: "/repo",
        routeHint: "pi-worker",
      },
      { orchestrator },
    );

    expect(result.output.summary).toBe("Use this objective fallback");
  });

  it("returns latest episode id and thread-scoped workflow run ids in structured output", async () => {
    const threadId = "thread-structured-output";
    const priorEpisode = createEpisodeFixture({
      id: "episode-prior",
      threadId,
      source: "orchestrator",
    });
    const state = createContextState(threadId, "/repo", {
      episodes: [priorEpisode],
      workflowRuns: [
        {
          runId: "run-owned",
          threadId,
          workflowId: "workflow:owned",
          status: "completed",
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
        {
          runId: "run-other-thread",
          threadId: "other-thread",
          workflowId: "workflow:other",
          status: "completed",
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
      ],
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader: {
        async load(request) {
          return {
            sessionHistory: [],
            repoAndWorktree: { cwd: request.cwd },
            agentsInstructions: [],
            relevantSkills: [],
            priorEpisodes: state.episodes,
            priorArtifacts: state.artifacts,
            state,
          };
        },
      },
    });

    const result = await executeHeadlessRun(
      {
        threadId,
        prompt: "Direct path summary",
        cwd: "/repo",
        routeHint: "direct",
      },
      { orchestrator },
    );

    expect(result.output.latestEpisodeId).not.toBe("episode-prior");
    expect(result.output.latestEpisodeId).toBe(
      result.threadSnapshot.episodes.at(-1)?.id,
    );
    expect(result.output.workflowRunIds).toEqual(["run-owned"]);
  });

  it("includes all thread-scoped workflow run ids in snapshot order", async () => {
    const threadId = "thread-structured-runs";
    const state = createContextState(threadId, "/repo", {
      workflowRuns: [
        {
          runId: "run-one",
          threadId,
          workflowId: "workflow:one",
          status: "running",
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
        {
          runId: "run-two",
          threadId,
          workflowId: "workflow:two",
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
        },
        {
          runId: "run-three",
          threadId: "other-thread",
          workflowId: "workflow:three",
          status: "completed",
          updatedAt: "2026-04-08T09:10:00.000Z",
        },
        {
          runId: "run-four",
          threadId,
          workflowId: "workflow:four",
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:15:00.000Z",
        },
      ],
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader: {
        async load(request) {
          return {
            sessionHistory: [],
            repoAndWorktree: { cwd: request.cwd },
            agentsInstructions: [],
            relevantSkills: [],
            priorEpisodes: state.episodes,
            priorArtifacts: state.artifacts,
            state,
          };
        },
      },
    });

    const result = await executeHeadlessRun(
      {
        threadId,
        prompt: "Direct path summary",
        cwd: "/repo",
        routeHint: "direct",
      },
      { orchestrator },
    );

    expect(result.output.workflowRunIds).toEqual([
      "run-one",
      "run-two",
      "run-four",
    ]);
  });

  it("tracks the latest structured output fields across file-backed JSONL re-entry", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "thread-structured-reentry";
      const sessionHarness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/structured-reentry.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "episode-structured-reentry-1",
          threadId,
          source: "pi-worker",
          conclusions: ["First summary"],
        }),
      });
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "episode-structured-reentry-2",
          threadId,
          source: "pi-worker",
          conclusions: ["Second summary"],
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
        contextLoader: {
          async load(request) {
            const state = sessionHarness.reconstruct();
            return {
              sessionHistory: sessionHarness.lines(),
              repoAndWorktree: { cwd: request.cwd },
              agentsInstructions: [],
              relevantSkills: [],
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
          prompt: "First worker run",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        { orchestrator },
      );
      sessionHarness.appendEntries(first.raw.sessionEntries);

      const second = await executeHeadlessRun(
        {
          threadId,
          prompt: "Second worker run",
          cwd: workspace.root,
          routeHint: "pi-worker",
        },
        { orchestrator },
      );
      sessionHarness.appendEntries(second.raw.sessionEntries);
      const reconstructed = sessionHarness.reconstruct();

      expect(first.output.summary).toBe("First summary");
      expect(second.output.summary).toBe("Second summary");
      expect(second.output.latestEpisodeId).toBe("episode-structured-reentry-2");
      expect(second.output.latestEpisodeId).toBe(
        second.threadSnapshot.episodes.at(-1)?.id,
      );
      expect(second.output.latestEpisodeId).not.toBe(first.output.latestEpisodeId);
      expect(second.raw.context.priorEpisodes.map((episode) => episode.id)).toEqual([
        "episode-structured-reentry-1",
      ]);
      expect(reconstructed.episodes.map((episode) => episode.id)).toEqual([
        "episode-structured-reentry-1",
        "episode-structured-reentry-2",
      ]);
    });
  });

  it("fails fast when orchestrator returns a thread snapshot with no episodes", async () => {
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
            state: createContextState(request.threadId, request.cwd),
          };
        },
      },
    });

    const baseRun = orchestrator.run.bind(orchestrator);
    orchestrator.run = async (request) => {
      const result = await baseRun(request);
      return {
        ...result,
        threadSnapshot: {
          ...result.threadSnapshot,
          episodes: [],
        },
      };
    };

    await expect(
      executeHeadlessRun(
        {
          threadId: "thread-invalid-output",
          prompt: "Direct path",
          cwd: "/repo",
          routeHint: "direct",
        },
        { orchestrator },
      ),
    ).rejects.toThrow(/episode/i);
  });

  it("serializes structured JSONL events into a parseable stream without losing waiting-state details", async () => {
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
            state: createContextState(request.threadId, request.cwd),
          };
        },
      },
    });

    const result = await executeHeadlessRun(
      {
        threadId: "thread-jsonl-stream",
        prompt: "Pause for approval before continuing.",
        cwd: "/repo",
        routeHint: "approval",
        requireApproval: true,
      },
      { orchestrator },
    );

    const reparsed = serializeJsonlEvents(result.events)
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(result.events.at(-1)).toEqual({
      type: "run.waiting",
      threadId: "thread-jsonl-stream",
      status: "waiting_approval",
      latestEpisodeId: result.threadSnapshot.episodes.at(-1)?.id,
    });
    expect(reparsed).toEqual(result.events);
  });
});
