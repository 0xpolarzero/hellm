import { describe, expect, it, test } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";

const BASE_CONTEXT = {
  sessionHistory: [],
  repoAndWorktree: { cwd: "/repo" },
  agentsInstructions: [],
  relevantSkills: [],
  priorEpisodes: [],
  priorArtifacts: [],
  state: createEmptySessionState({
    sessionId: "thread-model-routing",
    sessionCwd: "/repo",
  }),
};

describe("@hellm/orchestrator broad multi-slot model routing contract", () => {
  it("treats workflow seed metadata as opaque and keeps classification path-based while model routing is deferred", () => {
    const orchestrator = createOrchestrator();

    const classification = orchestrator.classifyRequest(
      {
        threadId: "thread-model-routing-classification",
        prompt: "What does the local change do?",
        cwd: "/repo",
        workflowSeedInput: {
          metadata: {
            modelRouting: {
              main: "gpt-main",
              worker: "gpt-worker",
              verification: "gpt-verify",
            },
          },
        },
      },
      BASE_CONTEXT,
    );

    expect(classification).toEqual({
      path: "direct",
      confidence: "medium",
      reason: "Short question or explanation request classified as small local work.",
    });
  });

  it("keeps visible orchestrator state and structured session entries unchanged when model-routing metadata is supplied", async () => {
    const orchestrator = createOrchestrator({
      clock: () => "2026-04-08T09:00:00.000Z",
      contextLoader: {
        async load() {
          return BASE_CONTEXT;
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-model-routing-run",
      prompt: "Summarize the routing decision.",
      cwd: "/repo",
      routeHint: "direct",
      workflowSeedInput: {
        metadata: {
          modelRouting: {
            main: "gpt-main",
            worker: "gpt-worker",
            reviewer: "gpt-reviewer",
          },
        },
      },
    });

    expect(result.classification).toEqual({
      path: "direct",
      confidence: "hint",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(result.state.visibleSummary).toBe("direct:completed:completed");
    expect(result.threadSnapshot.thread.kind).toBe("direct");
    expect(result.sessionEntries.map((entry) => entry.message.customType)).toEqual([
      "hellm/thread",
      "hellm/episode",
      "hellm/verification",
      "hellm/alignment",
    ]);

    for (const entry of result.sessionEntries) {
      const details = entry.message.details.data as Record<string, unknown>;
      expect(details).not.toHaveProperty("modelSlot");
      expect(details).not.toHaveProperty("modelRouting");
    }
  });

  test.todo(
    "chooses model slots per task type beyond simple main/worker while preserving the same path-level orchestrator API",
    () => {},
  );
  test.todo(
    "applies slot routing to delegated, verification, and approval work without changing visible thread and episode shape",
    () => {},
  );
  test.todo(
    "records slot-selection provenance as additive metadata so existing consumers keep working without schema migration",
    () => {},
  );
  test.todo(
    "falls back deterministically when configured model slots are unavailable without silently changing execution path",
    () => {},
  );
  test.todo(
    "reconciles resume flows safely when slot policy changes between runs for the same thread objective",
    () => {},
  );
});
