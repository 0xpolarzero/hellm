import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";

const EMPTY_CONTEXT = {
  sessionHistory: [],
  repoAndWorktree: { cwd: "/repo" },
  agentsInstructions: [],
  relevantSkills: [],
  priorEpisodes: [],
  priorArtifacts: [],
  state: createEmptySessionState({
    sessionId: "thread-classify",
    sessionCwd: "/repo",
  }),
};

describe("@hellm/orchestrator classification", () => {
  it("prefers explicit route hints over workflow seed hints, approval flags, and prompt heuristics", () => {
    const orchestrator = createOrchestrator();

    const classification = orchestrator.classifyRequest(
      {
        threadId: "thread-classify",
        prompt: "Verify and approve this change",
        cwd: "/repo",
        routeHint: "pi-worker",
        requireApproval: true,
        workflowSeedInput: {
          preferredPath: "smithers-workflow",
        },
      },
      EMPTY_CONTEXT,
    );

    expect(classification).toEqual({
      path: "pi-worker",
      confidence: "hint",
      reason: "Explicit route hint supplied by caller.",
    });
  });

  it("falls through workflow seed hints, approval waits, verification heuristics, and the direct default in that order", () => {
    const orchestrator = createOrchestrator();

    expect(
      orchestrator.classifyRequest(
        {
          threadId: "seeded",
          prompt: "Do the work",
          cwd: "/repo",
          routeHint: "auto",
          workflowSeedInput: {
            preferredPath: "smithers-workflow",
          },
        },
        EMPTY_CONTEXT,
      ),
    ).toEqual({
      path: "smithers-workflow",
      confidence: "hint",
      reason: "Structured workflow seed requested a preferred path.",
    });

    expect(
      orchestrator.classifyRequest(
        {
          threadId: "approval",
          prompt: "Ship it",
          cwd: "/repo",
          requireApproval: true,
        },
        EMPTY_CONTEXT,
      ),
    ).toEqual({
      path: "approval",
      confidence: "high",
      reason: "Request requires approval or clarification.",
    });

    expect(
      orchestrator.classifyRequest(
        {
          threadId: "verify",
          prompt: "Verify the branch",
          cwd: "/repo",
        },
        EMPTY_CONTEXT,
      ),
    ).toEqual({
      path: "verification",
      confidence: "medium",
      reason: "Prompt emphasizes verification work.",
    });

    expect(
      orchestrator.classifyRequest(
        {
          threadId: "direct",
          prompt: "Explain the architecture",
          cwd: "/repo",
        },
        EMPTY_CONTEXT,
      ),
    ).toEqual({
      path: "direct",
      confidence: "medium",
      reason: "Defaulted to direct execution for a small local request.",
    });
  });

  it("uses workflow seed preferredPath when routeHint is omitted, including approval and verification signals", () => {
    const orchestrator = createOrchestrator();
    const scenarios = [
      {
        threadId: "seed-vs-verify",
        prompt: "Verify the implementation details",
      },
      {
        threadId: "seed-vs-approval",
        prompt: "Ship this change",
        requireApproval: true,
      },
      {
        threadId: "seed-vs-approval-and-verify",
        prompt: "Verify this and wait for approval",
        requireApproval: true,
      },
    ] as const;

    for (const scenario of scenarios) {
      expect(
        orchestrator.classifyRequest(
          {
            ...scenario,
            cwd: "/repo",
            workflowSeedInput: {
              preferredPath: "pi-worker",
            },
          },
          EMPTY_CONTEXT,
        ),
      ).toEqual({
        path: "pi-worker",
        confidence: "hint",
        reason: "Structured workflow seed requested a preferred path.",
      });
    }
  });

  it("routes uppercase verify prompts to verification when routeHint is auto", () => {
    const orchestrator = createOrchestrator();

    expect(
      orchestrator.classifyRequest(
        {
          threadId: "verify-uppercase-auto",
          prompt: "VERIFY the branch before merge.",
          cwd: "/repo",
          routeHint: "auto",
        },
        EMPTY_CONTEXT,
      ),
    ).toEqual({
      path: "verification",
      confidence: "medium",
      reason: "Prompt emphasizes verification work.",
    });
  });
});
