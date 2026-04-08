import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule, withTempWorkspace } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const ORCHESTRATOR_ENTRY = fileURLToPath(
  new URL("../../orchestrator/src/index.ts", import.meta.url),
);
const SESSION_MODEL_ENTRY = fileURLToPath(
  new URL("../../session-model/src/index.ts", import.meta.url),
);
const TEST_SUPPORT_ENTRY = fileURLToPath(
  new URL("../../../test-support/index.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

describe("@hellm/cli process boundary", () => {
  it("executes the headless entrypoint as a real process and emits JSONL events", async () => {
    const result = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const events = lines.map(
      (line) =>
        JSON.parse(line) as {
          type: string;
          orchestratorId?: string;
          path?: string;
          reason?: string;
          status?: string;
          threadId?: string;
        },
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
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
});
