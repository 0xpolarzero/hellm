import { describe, expect, it } from "bun:test";
import { executeHeadlessRun, serializeJsonlEvents } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState, type SessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  createEpisodeFixture,
  fixedClock,
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
