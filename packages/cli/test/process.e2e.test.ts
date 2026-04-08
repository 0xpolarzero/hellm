import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule, withTempWorkspace } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const STRUCTURED_OUTPUT_FIXTURE = fileURLToPath(
  new URL("./fixtures/structured-output.process.ts", import.meta.url),
);
const ORCHESTRATOR_ENTRY = fileURLToPath(
  new URL("../../orchestrator/src/index.ts", import.meta.url),
);
const SESSION_MODEL_ENTRY = fileURLToPath(
  new URL("../../session-model/src/index.ts", import.meta.url),
);
const TEST_SUPPORT_ENTRY = fileURLToPath(
  new URL("../../../test-support/index.ts", import.meta.url),
);
const WORKFLOW_SEED_ENTRY = fileURLToPath(
  new URL("./fixtures/workflow-seed-process.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

interface ProcessJsonlEvent {
  type: string;
  orchestratorId?: string;
  path?: string;
  reason?: string;
  status?: string;
  threadId?: string;
  episodeId?: string;
  latestEpisodeId?: string;
}

describe("@hellm/cli process boundary", () => {
  it("executes the headless entrypoint as a real process and emits JSONL events", async () => {
    const result = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const events = parseJsonlEvents(result.stdout);

    expectHeadlessOneShotEventOrder(events);
    expect(events[0]).toMatchObject({
      type: "run.started",
      orchestratorId: "main",
      threadId: "cli",
    });
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "direct",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(events.at(-1)?.status).toBe("completed");
  });

  it("supports repeated one-shot process invocations without carrying prior process state", async () => {
    const first = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
    });
    const second = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(first.exitCode).toBe(0);
    expect(first.stderr.trim()).toBe("");
    expect(second.exitCode).toBe(0);
    expect(second.stderr.trim()).toBe("");

    const firstEvents = parseJsonlEvents(first.stdout);
    const secondEvents = parseJsonlEvents(second.stdout);
    expectHeadlessOneShotEventOrder(firstEvents);
    expectHeadlessOneShotEventOrder(secondEvents);
    expect(firstEvents[0]?.threadId).toBe("cli");
    expect(secondEvents[0]?.threadId).toBe("cli");
    expect(firstEvents[1]?.path).toBe("direct");
    expect(secondEvents[1]?.path).toBe("direct");

    const firstEpisode = firstEvents.find((event) => event.type === "run.episode");
    const firstTerminal = firstEvents.at(-1);
    expect(firstEpisode?.episodeId).toBe(firstTerminal?.latestEpisodeId);

    const secondEpisode = secondEvents.find((event) => event.type === "run.episode");
    const secondTerminal = secondEvents.at(-1);
    expect(secondEpisode?.episodeId).toBe(secondTerminal?.latestEpisodeId);
  });

  it("executes structured headless output over a real process boundary", async () => {
    const result = runBunModule({
      entryPath: STRUCTURED_OUTPUT_FIXTURE,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const parsed = JSON.parse(result.stdout.trim()) as {
      output: {
        threadId: string;
        status: string;
        latestEpisodeId: string;
        summary: string;
        workflowRunIds: string[];
      };
      latestEpisodeIdFromSnapshot?: string;
    };

    expect(parsed.output.threadId).toBe("process-structured-output");
    expect(parsed.output.status).toBe("completed");
    expect(parsed.output.latestEpisodeId).toBe(
      parsed.latestEpisodeIdFromSnapshot,
    );
    expect(parsed.output.summary.length).toBeGreaterThan(0);
    expect(parsed.output.workflowRunIds).toEqual([]);
  });

  it("loads structured workflow seed input from a JSON file through a real process boundary", async () => {
    await withTempWorkspace(async (workspace) => {
      const seedPath = await workspace.write(
        "seed-input.json",
        JSON.stringify(
          {
            threadId: "thread-process-seed",
            prompt: "Use seeded workflow routing.",
            cwd: "/repo",
            routeHint: "auto",
            workflowSeedInput: {
              objective: "Seed objective from JSON file",
              preferredPath: "smithers-workflow",
              tasks: [
                {
                  id: "seed-task",
                  outputKey: "result",
                  prompt: "Execute seeded workflow",
                  agent: "pi",
                },
              ],
              metadata: {
                source: "file",
                labels: ["nightly", "ci"],
              },
            },
          },
          null,
          2,
        ),
      );
      const scriptPath = await workspace.write(
        "run-seeded-headless.ts",
        [
          'import { readFileSync } from "node:fs";',
          `import { executeHeadlessRun } from ${JSON.stringify(pathToFileURL(CLI_ENTRY).href)};`,
          `import { createOrchestrator } from ${JSON.stringify(pathToFileURL(ORCHESTRATOR_ENTRY).href)};`,
          `import { createEmptySessionState } from ${JSON.stringify(pathToFileURL(SESSION_MODEL_ENTRY).href)};`,
          `import { FakeSmithersWorkflowBridge, createEpisodeFixture, fixedClock } from ${JSON.stringify(pathToFileURL(TEST_SUPPORT_ENTRY).href)};`,
          "const seedPath = process.argv[2];",
          "if (!seedPath) throw new Error('Missing seed path');",
          "const request = JSON.parse(readFileSync(seedPath, 'utf8'));",
          "const smithersBridge = new FakeSmithersWorkflowBridge();",
          "smithersBridge.enqueueRunResult({",
          "  run: {",
          "    runId: 'process-seed-run',",
          "    threadId: request.threadId,",
          "    workflowId: `workflow:${request.threadId}`,",
          "    status: 'completed',",
          "    updatedAt: '2026-04-08T09:00:00.000Z',",
          "  },",
          "  status: 'completed',",
          "  outputs: [],",
          "  episode: createEpisodeFixture({",
          "    id: 'process-seed-episode',",
          "    threadId: request.threadId,",
          "    source: 'smithers',",
          "    smithersRunId: 'process-seed-run',",
          "  }),",
          "});",
          "const orchestrator = createOrchestrator({",
          "  clock: fixedClock(),",
          "  smithersBridge,",
          "  contextLoader: {",
          "    async load(incoming) {",
          "      return {",
          "        sessionHistory: [],",
          "        repoAndWorktree: { cwd: incoming.cwd },",
          "        agentsInstructions: [],",
          "        relevantSkills: [],",
          "        priorEpisodes: [],",
          "        priorArtifacts: [],",
          "        state: createEmptySessionState({",
          "          sessionId: incoming.threadId,",
          "          sessionCwd: incoming.cwd,",
          "        }),",
          "      };",
          "    },",
          "  },",
          "});",
          "const result = await executeHeadlessRun(request, { orchestrator });",
          "process.stdout.write(",
          "  JSON.stringify({",
          "    path: result.raw.classification.path,",
          "    reason: result.raw.classification.reason,",
          "    objective: result.threadSnapshot.thread.objective,",
          "    workflowTaskIds: smithersBridge.runRequests[0]?.workflow.tasks.map((task) => task.id) ?? [],",
          "    workflowRunIds: result.output.workflowRunIds,",
          "  }) + '\\n',",
          ");",
        ].join("\n"),
      );

      const result = runBunModule({
        entryPath: scriptPath,
        cwd: REPO_ROOT,
        args: [seedPath],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");

      const parsed = JSON.parse(result.stdout.trim()) as {
        path: string;
        reason: string;
        objective: string;
        workflowTaskIds: string[];
        workflowRunIds: string[];
      };

      expect(parsed).toEqual({
        path: "smithers-workflow",
        reason: "Structured workflow seed requested a preferred path.",
        objective: "Seed objective from JSON file",
        workflowTaskIds: ["seed-task"],
        workflowRunIds: ["process-seed-run"],
      });
    });
  });

  it("preserves workflow seed routing semantics across a real process boundary", async () => {
    const result = runBunModule({
      entryPath: WORKFLOW_SEED_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parsed = lines.map(
      (line) =>
        JSON.parse(line) as
          | {
              type: string;
              path?: string;
              reason?: string;
            }
          | {
              type: "seed.assertions";
              classificationPath: string;
              classificationReason: string;
              runObjective?: string;
              workflowObjective?: string;
            },
    );
    const events = parsed.filter(
      (entry): entry is { type: string; path?: string; reason?: string } =>
        entry.type !== "seed.assertions",
    );
    const assertions = parsed.find(
      (entry): entry is {
        type: "seed.assertions";
        classificationPath: string;
        classificationReason: string;
        runObjective?: string;
        workflowObjective?: string;
      } => entry.type === "seed.assertions",
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "smithers-workflow",
      reason: "Structured workflow seed requested a preferred path.",
    });
    expect(assertions).toEqual({
      type: "seed.assertions",
      classificationPath: "smithers-workflow",
      classificationReason: "Structured workflow seed requested a preferred path.",
      runObjective: "Seeded objective from process fixture",
      workflowObjective: "Seeded objective from process fixture",
    });
  });
});

function parseJsonlEvents(stdout: string): ProcessJsonlEvent[] {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line) => JSON.parse(line) as ProcessJsonlEvent);
}

function expectHeadlessOneShotEventOrder(events: ProcessJsonlEvent[]): void {
  expect(events.map((event) => event.type)).toEqual([
    "run.started",
    "run.classified",
    "run.episode",
    "run.completed",
  ]);
}
