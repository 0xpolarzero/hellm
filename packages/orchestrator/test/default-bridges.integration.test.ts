import { describe, expect, it } from "bun:test";
import { chmod, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createEmptySessionState } from "@hellm/session-model";
import { createOrchestrator } from "@hellm/orchestrator";
import { withTempWorkspace } from "@hellm/test-support";

describe("orchestrator default bridge integration", () => {
  it("runs smithers-workflow and pi-worker paths with deterministic default bridge contracts", async () => {
    await withTempWorkspace(async (workspace) => {
      const binDir = workspace.path("bin");
      const smithersCapturePath = workspace.path("smithers-contract.json");
      const piCapturePath = workspace.path("pi-runtime-contract.json");
      await workspace.write(
        "bin/smithers",
        `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const runIdIndex = argv.indexOf("--run-id");
const inputIndex = argv.indexOf("--input");
const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : "missing-run-id";
const rawInput = inputIndex >= 0 ? argv[inputIndex + 1] : "{}";
writeFileSync(${JSON.stringify(smithersCapturePath)}, JSON.stringify({
  argv,
  cwd: process.cwd(),
  env: {
    FORCE_COLOR: process.env.FORCE_COLOR,
    NO_COLOR: process.env.NO_COLOR,
  },
  input: JSON.parse(rawInput),
}));
console.log(JSON.stringify({
  nodeId: "task-output",
  schema: "bridge.output",
  value: { ok: true },
}));
console.log(JSON.stringify({
  status: "completed",
  runId,
}));
`,
      );
      await workspace.write(
        "pi-runtime-fake.ts",
        `
import { writeFileSync } from "node:fs";
const CAPTURE_PATH = ${JSON.stringify(piCapturePath)};
const events = [];

function flush() {
  writeFileSync(CAPTURE_PATH, JSON.stringify(events));
}

export class AgentSessionRuntime {
  async replaceSession(payload) {
    events.push({ phase: "replaceSession", payload });
    flush();
  }
}

export function createPiWorkerRuntime() {
  return {
    async runWorker(request) {
      events.push({
        phase: "runWorker",
        request: {
          objective: request.objective,
          cwd: request.cwd,
          toolScope: request.toolScope,
          runtimeTransition: request.runtimeTransition ?? null,
        },
      });
      flush();
      return {
        status: "completed",
        outputSummary: "pi worker contract response",
      };
    },
  };
}
`,
      );
      await chmod(resolve(binDir, "smithers"), 0o755);

      const previousPath = process.env.PATH ?? "";
      const previousSdkModule = process.env.HELLM_PI_SDK_MODULE;
      process.env.PATH = `${binDir}:${previousPath}`;
      process.env.HELLM_PI_SDK_MODULE = workspace.path("pi-runtime-fake.ts");

      const orchestrator = createOrchestrator({
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

      try {
        const smithersResult = await orchestrator.run({
          threadId: "default-bridges-smithers",
          prompt: "Run delegated workflow",
          cwd: workspace.root,
          routeHint: "smithers-workflow",
        });

        const smithersContract = JSON.parse(
          await readFile(smithersCapturePath, "utf8"),
        ) as {
          argv: string[];
          cwd: string;
          env: {
            FORCE_COLOR?: string;
            NO_COLOR?: string;
          };
          input: {
            objective?: string;
          };
        };

        expect(smithersResult.classification.path).toBe("smithers-workflow");
        expect(smithersResult.state.latestEpisode.source).toBe("smithers");
        expect(smithersResult.state.latestEpisode.status).toBe("completed");
        expect(smithersResult.state.workflowRuns).toHaveLength(1);
        expect(smithersResult.state.workflowRuns[0]?.status).toBe("completed");
        expect(await realpath(smithersContract.cwd)).toBe(
          await realpath(workspace.root),
        );
        expect(smithersContract.argv[0]).toBe("up");
        expect(smithersContract.argv).toContain("--format");
        expect(smithersContract.argv).toContain("json");
        expect(smithersContract.argv).toContain("--root");
        expect(smithersContract.argv).toContain(workspace.root);
        expect(smithersContract.input.objective).toBe("Run delegated workflow");
        expect(smithersContract.env.FORCE_COLOR).toBe("0");
        expect(smithersContract.env.NO_COLOR).toBe("1");

        const piResult = await orchestrator.run({
          threadId: "default-bridges-pi",
          prompt: "run pi worker",
          cwd: workspace.root,
          routeHint: "pi-worker",
        });

        const piContract = JSON.parse(
          await readFile(piCapturePath, "utf8"),
        ) as Array<{
          phase: string;
          payload?: {
            toSessionId?: string;
            toWorktreePath?: string;
          };
          request?: {
            objective?: string;
            cwd?: string;
            toolScope?: {
              allow?: string[];
            };
            runtimeTransition?: {
              toSessionId?: string;
            };
          };
        }>;

        expect(piResult.classification.path).toBe("pi-worker");
        expect(piResult.state.latestEpisode.source).toBe("pi-worker");
        expect(piResult.state.latestEpisode.status).toBe("completed");
        expect(piContract[0]?.phase).toBe("replaceSession");
        expect(piContract[0]?.payload?.toSessionId).toBe("default-bridges-pi:pi");
        expect(piContract[1]?.phase).toBe("runWorker");
        const runWorkerCwd = piContract[1]?.request?.cwd;
        expect(runWorkerCwd).toBeDefined();
        expect(await realpath(runWorkerCwd as string)).toBe(
          await realpath(workspace.root),
        );
        expect(piContract[1]?.request?.objective).toBe("run pi worker");
        expect(piContract[1]?.request?.toolScope?.allow).toEqual([
          "read",
          "edit",
          "bash",
        ]);
        expect(piContract[1]?.request?.runtimeTransition?.toSessionId).toBe(
          "default-bridges-pi:pi",
        );
      } finally {
        process.env.PATH = previousPath;
        if (previousSdkModule === undefined) {
          delete process.env.HELLM_PI_SDK_MODULE;
        } else {
          process.env.HELLM_PI_SDK_MODULE = previousSdkModule;
        }
      }
    });
  });

  it("isolates smithers delegated execution from pre-existing workspace smithers state", async () => {
    await withTempWorkspace(async (workspace) => {
      const binDir = workspace.path("bin");
      const smithersCapturePath = workspace.path("smithers-isolation-contract.json");
      await workspace.write("smithers.db", "legacy incompatible state");
      await workspace.write(
        "bin/smithers",
        `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const runIdIndex = argv.indexOf("--run-id");
const inputIndex = argv.indexOf("--input");
const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : "missing-run-id";
const rawInput = inputIndex >= 0 ? argv[inputIndex + 1] : "{}";
writeFileSync(${JSON.stringify(smithersCapturePath)}, JSON.stringify({
  cwd: process.cwd(),
  dbPath: process.env.HELLM_SMITHERS_DB_PATH ?? null,
  argv,
  input: JSON.parse(rawInput),
}));
console.log(JSON.stringify({
  status: "completed",
  runId,
}));
`,
      );
      await chmod(resolve(binDir, "smithers"), 0o755);

      const previousPath = process.env.PATH ?? "";
      process.env.PATH = `${binDir}:${previousPath}`;

      const orchestrator = createOrchestrator({
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

      try {
        const result = await orchestrator.run({
          threadId: "default-bridges-smithers-isolation",
          prompt: "Run delegated workflow with pre-existing smithers.db",
          cwd: workspace.root,
          routeHint: "smithers-workflow",
        });
        const capture = JSON.parse(
          await readFile(smithersCapturePath, "utf8"),
        ) as {
          cwd: string;
          dbPath: string | null;
          argv: string[];
          input: {
            objective?: string;
          };
        };

        expect(result.classification.path).toBe("smithers-workflow");
        expect(result.state.latestEpisode.source).toBe("smithers");
        expect(result.state.latestEpisode.status).toBe("completed");
        expect(await realpath(capture.cwd)).toBe(await realpath(workspace.root));
        expect(capture.dbPath).toBeTruthy();
        expect(capture.dbPath).not.toBe(resolve(workspace.root, "smithers.db"));
        expect(capture.dbPath).toContain("smithers-runs/db/");
        expect(capture.argv).toContain("--log-dir");
        expect(capture.input.objective).toBe(
          "Run delegated workflow with pre-existing smithers.db",
        );
      } finally {
        process.env.PATH = previousPath;
      }
    });
  });
});
