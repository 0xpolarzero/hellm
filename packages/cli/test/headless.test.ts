import { describe, expect, it, test } from "bun:test";
import { executeHeadlessRun } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

describe("@hellm/cli headless execution", () => {
  it("returns structured output and JSONL events for one-shot execution", async () => {
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

    const result = await executeHeadlessRun(
      {
        threadId: "thread-headless",
        prompt: "Summarize the repo.",
        cwd: "/repo",
        routeHint: "direct",
      },
      { orchestrator },
    );

    expect(result.output.threadId).toBe("thread-headless");
    expect(result.output.status).toBe("completed");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
  });

  it("treats structured workflow seed input as the authoritative hint for headless routing semantics", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    const episode = createEpisodeFixture({
      id: "episode-seed",
      threadId: "thread-seed",
      source: "smithers",
      smithersRunId: "run-seed",
    });
    smithersBridge.enqueueRunResult({
      run: {
        runId: "run-seed",
        threadId: "thread-seed",
        workflowId: "workflow:thread-seed",
        status: "completed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode,
    });

    const orchestrator = createOrchestrator({
      clock: fixedClock(),
      smithersBridge,
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

    const result = await executeHeadlessRun(
      {
        threadId: "thread-seed",
        prompt: "Use the workflow seed.",
        cwd: "/repo",
        routeHint: "auto",
        workflowSeedInput: {
          preferredPath: "smithers-workflow",
          tasks: [
            {
              id: "seed-task",
              outputKey: "result",
              prompt: "Execute seeded workflow",
              agent: "pi",
            },
          ],
        },
      },
      { orchestrator },
    );

    expect(result.raw.classification.path).toBe("smithers-workflow");
    expect(result.output.workflowRunIds).toEqual(["run-seed"]);
  });

  it("reuses the same orchestrator instance across repeated entry-surface calls when one is provided", async () => {
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

    const first = await executeHeadlessRun(
      {
        threadId: "thread-a",
        prompt: "A",
        cwd: "/repo",
        routeHint: "direct",
      },
      { orchestrator },
    );
    const second = await executeHeadlessRun(
      {
        threadId: "thread-b",
        prompt: "B",
        cwd: "/repo",
        routeHint: "direct",
      },
      { orchestrator },
    );

    expect(first.orchestratorId).toBe("main");
    expect(second.orchestratorId).toBe(first.orchestratorId);
  });

  test.todo(
    "whole product server mode reuses the same structured contract without requiring a separate orchestration model",
    () => {},
  );
  test.todo(
    "richer remote attachment patterns extend headless input without weakening offline determinism",
    () => {},
  );
});
