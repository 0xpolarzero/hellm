import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  createEpisodeFixture,
  createVerificationFixture,
  fixedClock,
} from "@hellm/test-support";

function createBaseOrchestrator(
  dependencies: Parameters<typeof createOrchestrator>[0],
) {
  return createOrchestrator({
    ...dependencies,
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
}

describe("@hellm/orchestrator completion decisioning", () => {
  it("treats direct-path completion as complete", async () => {
    const orchestrator = createBaseOrchestrator({});
    const result = await orchestrator.run({
      threadId: "thread-completed",
      prompt: "Complete a direct request.",
      cwd: "/repo",
      routeHint: "direct",
    });

    expect(result.threadSnapshot.thread.status).toBe("completed");
    expect(result.completion).toEqual({
      isComplete: true,
      reason: "completed",
    });
  });

  it("treats completed_with_issues as complete for verification reconciliation", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "failed",
      records: [
        createVerificationFixture({
          id: "verification-build-failed",
          kind: "build",
          status: "failed",
        }),
      ],
      artifacts: [],
    });
    const orchestrator = createBaseOrchestrator({ verificationRunner });
    const result = await orchestrator.run({
      threadId: "thread-completed-with-issues",
      prompt: "Verify the branch.",
      cwd: "/repo",
      routeHint: "verification",
    });

    expect(result.threadSnapshot.episodes.at(-1)?.status).toBe(
      "completed_with_issues",
    );
    expect(result.threadSnapshot.thread.status).toBe("completed");
    expect(result.completion).toEqual({
      isComplete: true,
      reason: "completed",
    });
  });

  it("maps approval path states to waiting completion decisions", async () => {
    const orchestrator = createBaseOrchestrator({});
    const waitingInput = await orchestrator.run({
      threadId: "thread-waiting-input",
      prompt: "Need clarification before action.",
      cwd: "/repo",
      routeHint: "approval",
    });
    const waitingApproval = await orchestrator.run({
      threadId: "thread-waiting-approval",
      prompt: "Need explicit approval before action.",
      cwd: "/repo",
      routeHint: "approval",
      requireApproval: true,
    });

    expect(waitingInput.threadSnapshot.thread.status).toBe("waiting_input");
    expect(waitingInput.completion).toEqual({
      isComplete: false,
      reason: "waiting_input",
    });
    expect(waitingApproval.threadSnapshot.thread.status).toBe("waiting_approval");
    expect(waitingApproval.completion).toEqual({
      isComplete: false,
      reason: "waiting_approval",
    });
  });

  it("maps waiting, blocked, failed, and cancelled episodes from worker execution", async () => {
    const cases = [
      {
        name: "waiting-input",
        workerStatus: "waiting_input" as const,
        episodeStatus: "waiting_input" as const,
        expected: {
          threadStatus: "waiting_input",
          completion: { isComplete: false, reason: "waiting_input" as const },
          waiting: true,
          blocked: false,
        },
      },
      {
        name: "blocked",
        workerStatus: "blocked" as const,
        episodeStatus: "blocked" as const,
        expected: {
          threadStatus: "blocked",
          completion: { isComplete: false, reason: "blocked" as const },
          waiting: false,
          blocked: true,
        },
      },
      {
        name: "failed",
        workerStatus: "failed" as const,
        episodeStatus: "failed" as const,
        expected: {
          threadStatus: "failed",
          completion: { isComplete: true, reason: "failed" as const },
          waiting: false,
          blocked: false,
        },
      },
      {
        name: "cancelled",
        workerStatus: "completed" as const,
        episodeStatus: "cancelled" as const,
        expected: {
          threadStatus: "cancelled",
          completion: { isComplete: true, reason: "cancelled" as const },
          waiting: false,
          blocked: false,
        },
      },
    ];

    for (const entry of cases) {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: entry.workerStatus,
        episode: createEpisodeFixture({
          id: `episode-${entry.name}`,
          threadId: `thread-${entry.name}`,
          source: "pi-worker",
          status: entry.episodeStatus,
        }),
      });
      const orchestrator = createBaseOrchestrator({ piBridge });

      const result = await orchestrator.run({
        threadId: `thread-${entry.name}`,
        prompt: `Run worker case ${entry.name}.`,
        cwd: "/repo",
        routeHint: "pi-worker",
      });

      expect(result.threadSnapshot.thread.status).toBe(entry.expected.threadStatus);
      expect(result.completion).toEqual(entry.expected.completion);
      expect(result.state.waiting).toBe(entry.expected.waiting);
      expect(result.state.blocked).toBe(entry.expected.blocked);
    }
  });

  it("maps waiting_approval and cancelled episodes from smithers workflows", async () => {
    const cases = [
      {
        name: "waiting-approval",
        runStatus: "waiting_approval" as const,
        episodeStatus: "waiting_approval" as const,
        expected: {
          threadStatus: "waiting_approval",
          completion: { isComplete: false, reason: "waiting_approval" as const },
          waiting: true,
          blocked: false,
        },
      },
      {
        name: "cancelled",
        runStatus: "failed" as const,
        episodeStatus: "cancelled" as const,
        expected: {
          threadStatus: "cancelled",
          completion: { isComplete: true, reason: "cancelled" as const },
          waiting: false,
          blocked: false,
        },
      },
    ];

    for (const entry of cases) {
      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: `run-${entry.name}`,
          threadId: `thread-${entry.name}`,
          workflowId: `workflow:thread-${entry.name}`,
          status: entry.runStatus,
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
        status: entry.runStatus,
        outputs: [],
        episode: createEpisodeFixture({
          id: `episode-${entry.name}`,
          threadId: `thread-${entry.name}`,
          source: "smithers",
          status: entry.episodeStatus,
          smithersRunId: `run-${entry.name}`,
        }),
      });
      const orchestrator = createBaseOrchestrator({ smithersBridge });

      const result = await orchestrator.run({
        threadId: `thread-${entry.name}`,
        prompt: `Run smithers case ${entry.name}.`,
        cwd: "/repo",
        routeHint: "smithers-workflow",
      });

      expect(result.threadSnapshot.thread.status).toBe(entry.expected.threadStatus);
      expect(result.completion).toEqual(entry.expected.completion);
      expect(result.state.waiting).toBe(entry.expected.waiting);
      expect(result.state.blocked).toBe(entry.expected.blocked);
    }
  });
});
