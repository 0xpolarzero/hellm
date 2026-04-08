import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
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
  it("emits run.waiting when completion decisioning marks a blocked worker result as incomplete", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "blocked",
      episode: createEpisodeFixture({
        id: "episode-blocked",
        threadId: "thread-blocked",
        source: "pi-worker",
        status: "blocked",
      }),
    });
    const orchestrator = createBaseOrchestrator({ piBridge });
    const { result } = await runHeadlessHarness(
      {
        threadId: "thread-blocked",
        prompt: "Run blocked worker case.",
        cwd: "/repo",
        routeHint: "pi-worker",
      },
      orchestrator,
    );

    expect(result.output.status).toBe("blocked");
    expect(result.raw.completion).toEqual({
      isComplete: false,
      reason: "blocked",
    });
    expect(result.events.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "blocked",
    });
  });

  it("emits run.completed for failed and cancelled terminal outcomes", async () => {
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

      const { result } = await runHeadlessHarness(
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
    }
  });
});
