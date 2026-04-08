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
  runHeadlessHarness,
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

describe("@hellm/cli completion decisioning JSONL semantics", () => {
  it("emits run.waiting for blocked, waiting_input, and waiting_approval completion states", async () => {
    const blockedBridge = new FakePiRuntimeBridge();
    blockedBridge.enqueueResult({
      status: "blocked",
      episode: createEpisodeFixture({
        id: "episode-blocked",
        threadId: "thread-blocked",
        source: "pi-worker",
        status: "blocked",
      }),
    });
    const waitingInputBridge = new FakePiRuntimeBridge();
    waitingInputBridge.enqueueResult({
      status: "waiting_input",
      episode: createEpisodeFixture({
        id: "episode-waiting-input",
        threadId: "thread-waiting-input",
        source: "pi-worker",
        status: "waiting_input",
      }),
    });
    const cases = [
      {
        name: "blocked",
        request: {
          threadId: "thread-blocked",
          prompt: "Run blocked worker case.",
          cwd: "/repo",
          routeHint: "pi-worker" as const,
        },
        orchestrator: createBaseOrchestrator({ piBridge: blockedBridge }),
        expectedStatus: "blocked",
        expectedReason: "blocked" as const,
      },
      {
        name: "waiting-input",
        request: {
          threadId: "thread-waiting-input",
          prompt: "Need additional details.",
          cwd: "/repo",
          routeHint: "pi-worker" as const,
        },
        orchestrator: createBaseOrchestrator({ piBridge: waitingInputBridge }),
        expectedStatus: "waiting_input",
        expectedReason: "waiting_input" as const,
      },
      {
        name: "waiting-approval",
        request: {
          threadId: "thread-waiting-approval",
          prompt: "Need explicit approval before continuing.",
          cwd: "/repo",
          routeHint: "approval" as const,
          requireApproval: true,
        },
        orchestrator: createBaseOrchestrator({}),
        expectedStatus: "waiting_approval",
        expectedReason: "waiting_approval" as const,
      },
    ];

    for (const entry of cases) {
      const { result, jsonl } = await runHeadlessHarness(
        entry.request,
        entry.orchestrator,
      );

      expect(result.output.status).toBe(entry.expectedStatus);
      expect(result.raw.completion).toEqual({
        isComplete: false,
        reason: entry.expectedReason,
      });
      expect(result.events.at(-1)).toMatchObject({
        type: "run.waiting",
        status: entry.expectedStatus,
      });
      expect(jsonl.at(-1)).toContain("\"type\":\"run.waiting\"");
      expect(jsonl.at(-1)).toContain(`\"status\":\"${entry.expectedStatus}\"`);
    }
  });

  it("emits run.completed for completed_with_issues, failed, and cancelled terminal outcomes", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "failed",
      records: [
        createVerificationFixture({
          id: "verification-failed-completed-with-issues",
          kind: "test",
          status: "failed",
        }),
      ],
      artifacts: [],
    });
    const verificationOrchestrator = createBaseOrchestrator({ verificationRunner });
    const verificationResult = await runHeadlessHarness(
      {
        threadId: "thread-completed-with-issues",
        prompt: "Verify this branch.",
        cwd: "/repo",
        routeHint: "verification",
      },
      verificationOrchestrator,
    );

    expect(verificationResult.result.output.status).toBe("completed");
    expect(verificationResult.result.raw.completion).toEqual({
      isComplete: true,
      reason: "completed",
    });
    expect(verificationResult.result.events.at(-1)).toMatchObject({
      type: "run.completed",
      status: "completed",
    });

    const cases = [
      {
        status: "failed" as const,
        expectedReason: "failed" as const,
      },
      {
        status: "cancelled" as const,
        expectedReason: "cancelled" as const,
      },
    ];

    for (const entry of cases) {
      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: `run-${entry.status}`,
          threadId: `thread-${entry.status}`,
          workflowId: `workflow:thread-${entry.status}`,
          status: entry.status,
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
        status: entry.status === "cancelled" ? "completed" : entry.status,
        outputs: [],
        episode: createEpisodeFixture({
          id: `episode-${entry.status}`,
          threadId: `thread-${entry.status}`,
          source: "smithers",
          status: entry.status,
          smithersRunId: `run-${entry.status}`,
        }),
      });
      const orchestrator = createBaseOrchestrator({ smithersBridge });

      const { result, jsonl } = await runHeadlessHarness(
        {
          threadId: `thread-${entry.status}`,
          prompt: `Run ${entry.status} workflow case.`,
          cwd: "/repo",
          routeHint: "smithers-workflow",
        },
        orchestrator,
      );

      expect(result.output.status).toBe(entry.status);
      expect(result.raw.completion).toEqual({
        isComplete: true,
        reason: entry.expectedReason,
      });
      expect(result.events.at(-1)).toMatchObject({
        type: "run.completed",
        status: entry.status,
      });
      expect(jsonl.at(-1)).toContain("\"type\":\"run.completed\"");
    }
  });
});
