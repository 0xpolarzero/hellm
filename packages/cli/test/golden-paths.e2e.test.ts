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

function createBaseOrchestrator(dependencies: Parameters<typeof createOrchestrator>[0]) {
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

describe("golden path headless specs", () => {
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
    expect(result.raw.classification.path).toBe("direct");
    expect(jsonl.at(-1)).toContain("\"run.completed\"");
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
    expect(result.threadSnapshot.episodes.at(-1)?.source).toBe("pi-worker");
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
    expect(first.result.events.at(-1)?.type).toBe("run.waiting");
    expect(second.result.output.workflowRunIds).toEqual(["golden-run"]);
    expect(second.result.events.at(-1)?.type).toBe("run.completed");
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
    expect(result.events.at(-1)?.type).toBe("run.waiting");
  });
});
