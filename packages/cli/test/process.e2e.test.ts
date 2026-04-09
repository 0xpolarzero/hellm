import { readFileSync } from "node:fs";
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
const DIRECT_DEFAULT_ENTRY = fileURLToPath(
  new URL("./fixtures/direct-default-process-entry.ts", import.meta.url),
);
const VERIFICATION_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/verification-process-entry.ts", import.meta.url),
);
const APPROVAL_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/approval-process-entry.ts", import.meta.url),
);
const PI_WORKER_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/pi-worker-process-entry.ts", import.meta.url),
);
const SMITHERS_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/smithers-workflow-process.ts", import.meta.url),
);
const PATH_ROUTING_PROCESS_FIXTURE = fileURLToPath(
  new URL("./fixtures/path-routing-process-runner.ts", import.meta.url),
);
const HEADLESS_REQUEST_RUNNER = fileURLToPath(
  new URL("./fixtures/run-headless-request.ts", import.meta.url),
);
const APPROVAL_DECISION_FLAGS_PROCESS_RUNNER = fileURLToPath(
  new URL("./fixtures/approval-decision-flags-process-runner.ts", import.meta.url),
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
      args: ["Describe the current workspace contract surface.", "--hint", "direct"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const events = parseJsonlEvents(result.stdout);

    expectHeadlessOneShotEventOrder(events);
    expect(events[0]).toMatchObject({
      type: "run.started",
      orchestratorId: "main",
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
      args: ["First prompt", "--hint", "direct"],
    });
    const second = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
      args: ["Second prompt", "--hint", "direct"],
    });

    expect(first.exitCode).toBe(0);
    expect(first.stderr.trim()).toBe("");
    expect(second.exitCode).toBe(0);
    expect(second.stderr.trim()).toBe("");

    const firstEvents = parseJsonlEvents(first.stdout);
    const secondEvents = parseJsonlEvents(second.stdout);
    expectHeadlessOneShotEventOrder(firstEvents);
    expectHeadlessOneShotEventOrder(secondEvents);
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

  it("accepts --input-file on the real CLI entrypoint for structured workflow seed input", async () => {
    await withTempWorkspace(async (workspace) => {
      const inputPath = await workspace.write(
        "cli-input.json",
        JSON.stringify(
          {
            threadId: "process-cli-input-file",
            prompt: "Fallback prompt from file",
            cwd: workspace.root,
            routeHint: "direct",
            workflowSeedInput: {
              objective: "Objective loaded from --input-file",
              metadata: {
                source: "cli-input-file",
              },
            },
          },
          null,
          2,
        ),
      );

      const result = runBunModule({
        entryPath: CLI_ENTRY,
        cwd: REPO_ROOT,
        args: ["--input-file", inputPath],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const events = parseJsonlEvents(result.stdout);
      expectHeadlessOneShotEventOrder(events);
      expect(events[1]).toMatchObject({
        type: "run.classified",
        path: "direct",
        reason: "Explicit route hint supplied by caller.",
      });

      const sessionFile = workspace.path(
        ".hellm/sessions/process-cli-input-file.jsonl",
      );
      const lines = readFileSync(sessionFile, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const episodeEntries = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter(
          (entry) =>
            entry.type === "message" &&
            (entry.message as { customType?: string } | undefined)?.customType ===
              "hellm/episode",
        );
      expect(episodeEntries.length).toBeGreaterThan(0);
      const latestEpisode = episodeEntries.at(-1) as {
        message: {
          details: {
            data: {
              objective: string;
            };
          };
        };
      };
      expect(latestEpisode.message.details.data.objective).toBe(
        "Objective loaded from --input-file",
      );
    });
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

  it("defaults to the direct path in a real process when no route hint or other routing signals are provided", async () => {
    const result = runBunModule({
      entryPath: DIRECT_DEFAULT_ENTRY,
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
          path?: string;
          reason?: string;
          status?: string;
          source?: string;
        },
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "direct",
      reason: "Short question or explanation request classified as small local work.",
    });
    expect(events.at(-1)?.status).toBe("completed");
  });

  it("executes a verification run across the process boundary and emits normalized JSONL status", async () => {
    const result = runBunModule({
      entryPath: VERIFICATION_PROCESS_ENTRY,
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
          path?: string;
          status?: string;
          source?: string;
          reason?: string;
        },
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "verification",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(events[2]).toMatchObject({
      type: "run.episode",
      source: "verification",
      status: "completed_with_issues",
    });
    expect(events[3]).toMatchObject({
      type: "run.completed",
      status: "completed",
    });
  });

  it("emits waiting JSONL events for both clarification and explicit approval requests", async () => {
    const clarification = runBunModule({
      entryPath: APPROVAL_PROCESS_ENTRY,
      cwd: REPO_ROOT,
    });
    const approval = runBunModule({
      entryPath: APPROVAL_PROCESS_ENTRY,
      cwd: REPO_ROOT,
      args: ["approval"],
    });

    expect(clarification.exitCode).toBe(0);
    expect(clarification.stderr.trim()).toBe("");
    expect(approval.exitCode).toBe(0);
    expect(approval.stderr.trim()).toBe("");

    const clarificationEvents = parseEvents(clarification.stdout);
    const approvalEvents = parseEvents(approval.stdout);

    expect(clarificationEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.waiting",
    ]);
    expect(approvalEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.waiting",
    ]);
    expect(clarificationEvents[1]).toMatchObject({
      type: "run.classified",
      path: "approval",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(approvalEvents[1]).toMatchObject({
      type: "run.classified",
      path: "approval",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(clarificationEvents[2]).toMatchObject({
      type: "run.episode",
      status: "waiting_input",
      source: "orchestrator",
    });
    expect(approvalEvents[2]).toMatchObject({
      type: "run.episode",
      status: "waiting_approval",
      source: "orchestrator",
    });
    expect(clarificationEvents.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_input",
      threadId: "process-clarification",
    });
    expect(approvalEvents.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_approval",
      threadId: "process-approval",
    });
  });

  it("executes the pi-worker raw execution primitive in a real process with file-backed session JSONL", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("feature-pi-process");
      const sessionFile = workspace.path(".pi/sessions/process-pi-worker.jsonl");
      const result = runBunModule({
        entryPath: PI_WORKER_PROCESS_ENTRY,
        cwd: REPO_ROOT,
        env: {
          HELLM_PROCESS_TEST_CWD: workspace.root,
          HELLM_PROCESS_TEST_WORKTREE: worktreePath,
          HELLM_PROCESS_TEST_SESSION_FILE: sessionFile,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");

      const payload = JSON.parse(result.stdout.trim()) as {
        eventTypes: string[];
        classification: {
          path: string;
          reason: string;
        };
        completion: {
          reason: string;
          isComplete: boolean;
        };
        workerRequest: {
          runtimeTransition: {
            reason: string;
            toSessionId: string;
            aligned: boolean;
            toWorktreePath: string;
          };
          scopedContext: {
            relevantPaths: string[];
            priorEpisodeIds: string[];
          };
          toolScope: {
            allow: string[];
            writeRoots: string[];
          };
          completion: {
            type: string;
            maxTurns: number;
          };
        };
        sessionJsonlLineCount: number;
        reconstructedEpisodeIds: string[];
      };

      expect(payload.eventTypes).toEqual([
        "run.started",
        "run.classified",
        "run.episode",
        "run.completed",
      ]);
      expect(payload.classification).toMatchObject({
        path: "pi-worker",
        reason: "Explicit route hint supplied by caller.",
      });
      expect(payload.completion).toEqual({
        reason: "completed",
        isComplete: true,
      });
      expect(payload.workerRequest.runtimeTransition).toEqual({
        reason: "resume",
        toSessionId: "process-pi-worker:pi",
        aligned: false,
        toWorktreePath: worktreePath,
      });
      expect(payload.workerRequest.scopedContext.relevantPaths).toEqual([
        workspace.root,
        worktreePath,
      ]);
      expect(payload.workerRequest.scopedContext.priorEpisodeIds).toEqual([]);
      expect(payload.workerRequest.toolScope).toEqual({
        allow: ["read", "edit", "bash"],
        writeRoots: [workspace.root],
      });
      expect(payload.workerRequest.completion).toEqual({
        type: "episode-produced",
        maxTurns: 1,
      });
      expect(payload.reconstructedEpisodeIds).toEqual(["process-pi-episode"]);
      expect(payload.sessionJsonlLineCount).toBe(5);

      const persistedLines = readFileSync(sessionFile, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(persistedLines).toHaveLength(payload.sessionJsonlLineCount);
    });
  });

  it("executes smithers workflow runs as a real process and emits waiting/completed JSONL events", async () => {
    const waiting = runBunModule({
      entryPath: SMITHERS_PROCESS_ENTRY,
      cwd: REPO_ROOT,
      args: ["waiting"],
    });
    const resumed = runBunModule({
      entryPath: SMITHERS_PROCESS_ENTRY,
      cwd: REPO_ROOT,
      args: ["resume"],
    });

    expect(waiting.exitCode).toBe(0);
    expect(waiting.stderr.trim()).toBe("");
    const waitingEvents = parseEvents(waiting.stdout);
    expect(waitingEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.waiting",
    ]);
    expect(waitingEvents[1]).toMatchObject({
      type: "run.classified",
      path: "smithers-workflow",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(waitingEvents[2]).toMatchObject({
      type: "run.episode",
      source: "smithers",
      status: "waiting_approval",
    });
    expect(waitingEvents.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_approval",
      threadId: "cli-process-smithers",
    });

    expect(resumed.exitCode).toBe(0);
    expect(resumed.stderr.trim()).toBe("");
    const resumedEvents = parseEvents(resumed.stdout);
    expect(resumedEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(resumedEvents[2]).toMatchObject({
      type: "run.episode",
      source: "smithers",
      status: "completed",
    });
    expect(resumedEvents.at(-1)).toMatchObject({
      type: "run.completed",
      status: "completed",
      threadId: "cli-process-smithers",
    });
  });

  it("routes auto verification requests in a subprocess and emits classified verification JSONL events", async () => {
    const result = runBunModule({
      entryPath: PATH_ROUTING_PROCESS_FIXTURE,
      cwd: REPO_ROOT,
      env: {
        HELLM_REQUEST_JSON: JSON.stringify({
          threadId: "process-auto-verify",
          prompt: "Please VERIFY the branch before merge.",
          cwd: REPO_ROOT,
          routeHint: "auto",
        }),
        HELLM_FAKE_VERIFICATION: "1",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const events = parseJsonlEvents(result.stdout);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "verification",
      reason: "Prompt emphasizes verification work.",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      status: "completed",
      threadId: "process-auto-verify",
    });
  });

  it("routes auto approval requests in a subprocess and emits waiting approval JSONL events", async () => {
    const result = runBunModule({
      entryPath: PATH_ROUTING_PROCESS_FIXTURE,
      cwd: REPO_ROOT,
      env: {
        HELLM_REQUEST_JSON: JSON.stringify({
          threadId: "process-auto-approval",
          prompt: "Ship this after approval.",
          cwd: REPO_ROOT,
          routeHint: "auto",
          requireApproval: true,
        }),
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const events = parseJsonlEvents(result.stdout);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "approval",
      reason: "Request requires approval or clarification.",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_approval",
      threadId: "process-auto-approval",
    });
  });

  it("preserves request-classification precedence and reasons across a real process boundary", async () => {
    await withTempWorkspace(async (workspace) => {
      const scenarios = [
        {
          name: "explicit-route-hint",
          request: {
            threadId: "proc-explicit-route-hint",
            prompt: "VERIFY and request approval",
            cwd: workspace.root,
            routeHint: "pi-worker" as const,
            requireApproval: true,
            workflowSeedInput: {
              preferredPath: "smithers-workflow" as const,
            },
          },
          expectedClassification: {
            path: "pi-worker",
            reason: "Explicit route hint supplied by caller.",
          },
          expectedCompletion: {
            type: "run.completed",
            status: "completed",
          },
        },
        {
          name: "seed-preferred-path",
          request: {
            threadId: "proc-seed-hint",
            prompt: "verify this and wait for approval",
            cwd: workspace.root,
            routeHint: "auto" as const,
            requireApproval: true,
            workflowSeedInput: {
              preferredPath: "smithers-workflow" as const,
            },
          },
          expectedClassification: {
            path: "smithers-workflow",
            reason: "Structured workflow seed requested a preferred path.",
          },
          expectedCompletion: {
            type: "run.completed",
            status: "completed",
          },
        },
        {
          name: "approval-over-verification",
          request: {
            threadId: "proc-approval-over-verification",
            prompt: "please verify this change",
            cwd: workspace.root,
            requireApproval: true,
          },
          expectedClassification: {
            path: "approval",
            reason: "Request requires approval or clarification.",
          },
          expectedCompletion: {
            type: "run.waiting",
            status: "waiting_approval",
          },
        },
        {
          name: "verification-heuristic",
          request: {
            threadId: "proc-verification-heuristic",
            prompt: "PLEASE VERIFY THE WORKSPACE",
            cwd: workspace.root,
          },
          expectedClassification: {
            path: "verification",
            reason: "Prompt emphasizes verification work.",
          },
          expectedCompletion: {
            type: "run.completed",
            status: "completed",
          },
        },
        {
          name: "direct-default",
          request: {
            threadId: "proc-direct-default",
            prompt: "summarize the architecture",
            cwd: workspace.root,
          },
          expectedClassification: {
            path: "direct",
            reason: "Short question or explanation request classified as small local work.",
          },
          expectedCompletion: {
            type: "run.completed",
            status: "completed",
          },
        },
      ] as const;

      for (const scenario of scenarios) {
        const result = runBunModule({
          entryPath: HEADLESS_REQUEST_RUNNER,
          cwd: REPO_ROOT,
          args: [JSON.stringify(scenario.request)],
        });

        expect(result.exitCode).toBe(0);
        expect(result.stderr.trim()).toBe("");

        const events = parseJsonlEvents(result.stdout);
        expect(events.map((event) => event.type)).toEqual([
          "run.started",
          "run.classified",
          "run.episode",
          scenario.expectedCompletion.type,
        ]);
        expect(events[1]).toMatchObject({
          type: "run.classified",
          path: scenario.expectedClassification.path,
          reason: scenario.expectedClassification.reason,
        });
        expect(events.at(-1)).toMatchObject({
          type: scenario.expectedCompletion.type,
          status: scenario.expectedCompletion.status,
        });
      }
    });
  });

  it("forwards --approve-run decision flags through subprocess CLI parsing into smithers resume and completed JSONL outcomes", async () => {
    const threadId = "process-approval-flags-approve";
    const runId = "process-approval-flags-approve-run";
    const result = runBunModule({
      entryPath: APPROVAL_DECISION_FLAGS_PROCESS_RUNNER,
      cwd: REPO_ROOT,
      args: [
        "Resume approved smithers run",
        "--hint",
        "smithers-workflow",
        "--session",
        threadId,
        "--resume-run-id",
        runId,
        "--approve-run",
        runId,
        "--approval-note",
        "Looks good",
        "--approval-by",
        "ci-reviewer",
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const jsonlEvents = parseJsonlEvents(
      lines
        .filter((line) => !line.includes('"type":"approval-flags.assertions"'))
        .join("\n"),
    );
    expect(jsonlEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(jsonlEvents.at(-1)).toMatchObject({
      type: "run.completed",
      status: "completed",
      threadId,
    });

    const assertions = JSON.parse(
      lines.find((line) => line.includes('"type":"approval-flags.assertions"'))!,
    ) as {
      request: {
        resumeRunId?: string;
        approvalDecision?: {
          runId: string;
          approved: boolean;
          note?: string;
          decidedBy?: string;
        };
      };
      approvals: Array<{
        runId: string;
        decision: {
          approved: boolean;
          note?: string;
          decidedBy?: string;
        };
      }>;
      denials: Array<unknown>;
      resumeRequests: Array<{ runId: string }>;
      latestEpisodeConclusions: string[];
      latestEpisodeStatus: string;
    };

    expect(assertions.request.resumeRunId).toBe(runId);
    expect(assertions.request.approvalDecision).toEqual({
      runId,
      approved: true,
      note: "Looks good",
      decidedBy: "ci-reviewer",
    });
    expect(assertions.approvals).toEqual([
      {
        runId,
        decision: {
          approved: true,
          note: "Looks good",
          decidedBy: "ci-reviewer",
        },
      },
    ]);
    expect(assertions.denials).toEqual([]);
    expect(assertions.resumeRequests.map((request) => request.runId)).toEqual([
      runId,
    ]);
    expect(assertions.latestEpisodeStatus).toBe("completed");
    expect(assertions.latestEpisodeConclusions[0]).toContain("approved");
  });

  it("forwards --deny-run decision flags into smithers resume and deterministic waiting JSONL outcomes", async () => {
    const threadId = "process-approval-flags-deny";
    const runId = "process-approval-flags-deny-run";
    const result = runBunModule({
      entryPath: APPROVAL_DECISION_FLAGS_PROCESS_RUNNER,
      cwd: REPO_ROOT,
      args: [
        "Resume denied smithers run",
        "--hint",
        "smithers-workflow",
        "--session",
        threadId,
        "--resume-run-id",
        runId,
        "--deny-run",
        runId,
        "--approval-note",
        "Needs changes",
        "--approval-by",
        "qa-reviewer",
      ],
      env: {
        HELLM_APPROVAL_FIXTURE_OUTCOME: "waiting",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const jsonlEvents = parseJsonlEvents(
      lines
        .filter((line) => !line.includes('"type":"approval-flags.assertions"'))
        .join("\n"),
    );
    expect(jsonlEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.waiting",
    ]);
    expect(jsonlEvents.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_approval",
      threadId,
    });

    const assertions = JSON.parse(
      lines.find((line) => line.includes('"type":"approval-flags.assertions"'))!,
    ) as {
      request: {
        resumeRunId?: string;
        approvalDecision?: {
          runId: string;
          approved: boolean;
          note?: string;
          decidedBy?: string;
        };
      };
      approvals: Array<unknown>;
      denials: Array<{
        runId: string;
        decision: {
          approved: boolean;
          note?: string;
          decidedBy?: string;
        };
      }>;
      resumeRequests: Array<{ runId: string }>;
      latestEpisodeConclusions: string[];
      latestEpisodeStatus: string;
    };

    expect(assertions.request.resumeRunId).toBe(runId);
    expect(assertions.request.approvalDecision).toEqual({
      runId,
      approved: false,
      note: "Needs changes",
      decidedBy: "qa-reviewer",
    });
    expect(assertions.approvals).toEqual([]);
    expect(assertions.denials).toEqual([
      {
        runId,
        decision: {
          approved: false,
          note: "Needs changes",
          decidedBy: "qa-reviewer",
        },
      },
    ]);
    expect(assertions.resumeRequests.map((request) => request.runId)).toEqual([
      runId,
    ]);
    expect(assertions.latestEpisodeStatus).toBe("waiting_approval");
    expect(assertions.latestEpisodeConclusions[0]).toContain("denied");
  });

  it("fails fast on invalid CLI approval flag combinations in a real subprocess", async () => {
    const result = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
      args: [
        "Invalid approval flag combination",
        "--approve-run",
        "same-run",
        "--deny-run",
        "same-run",
      ],
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Specify only one of --approve-run or --deny-run.",
    );
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

const parseEvents = parseJsonlEvents;
