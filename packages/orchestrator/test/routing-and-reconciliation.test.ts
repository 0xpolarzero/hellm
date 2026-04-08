import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeVerificationRunner,
  createEpisodeFixture,
  createThreadFixture,
  createVerificationFixture,
  fixedClock,
} from "@hellm/test-support";

describe("@hellm/orchestrator routing and reconciliation", () => {
  it("normalizes a direct request into a completed thread, session entries, and visible orchestrator state", async () => {
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

    const result = await orchestrator.run({
      threadId: "thread-direct",
      prompt: "Summarize the architecture delta.",
      cwd: "/repo",
      routeHint: "direct",
    });

    expect(result.classification.path).toBe("direct");
    expect(result.threadSnapshot.thread.status).toBe("completed");
    expect(result.state.visibleSummary).toContain("direct:completed");
    expect(result.completion.isComplete).toBe(true);
    expect(result.sessionEntries.map((entry) => entry.message.customType)).toEqual([
      "hellm/thread",
      "hellm/episode",
      "hellm/verification",
      "hellm/alignment",
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
            sessionHistory: [],
            repoAndWorktree: { cwd: request.cwd },
            agentsInstructions: ["Respect AGENTS.md"],
            relevantSkills: ["tests"],
            priorEpisodes: [priorEpisode],
            priorArtifacts: [],
            state: {
              ...createEmptySessionState({
                sessionId: request.threadId,
                sessionCwd: request.cwd,
              }),
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
    expect(result.threadSnapshot.episodes.at(-1)?.id).toBe("episode-pi");
    expect(result.threadSnapshot.thread.status).toBe("completed");
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

    const result = await orchestrator.run({
      threadId: "thread-verify",
      prompt: "Verify the branch.",
      cwd: "/repo",
      routeHint: "verification",
    });

    expect(result.threadSnapshot.thread.status).toBe("completed");
    expect(result.state.verification.overallStatus).toBe("failed");
    expect(result.threadSnapshot.episodes.at(-1)?.status).toBe(
      "completed_with_issues",
    );
  });

  it("tracks explicit waiting_input and waiting_approval states instead of guessing", async () => {
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
    expect(clarification.completion.isComplete).toBe(false);
    expect(approval.threadSnapshot.thread.status).toBe("waiting_approval");
    expect(approval.state.waiting).toBe(true);
  });
});
