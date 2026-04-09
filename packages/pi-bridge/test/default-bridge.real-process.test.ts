import { describe, expect, it } from "bun:test";
import { readFile, realpath } from "node:fs/promises";
import { createPiRuntimeBridge } from "@hellm/pi-bridge";
import { createThreadFixture, withTempWorkspace } from "@hellm/test-support";

describe("pi bridge real process", () => {
  it("executes default createPiRuntimeBridge() through the installed pi runtime path", async () => {
    await withTempWorkspace(async (workspace) => {
      const thread = createThreadFixture({
        id: "pi-default-installed-runtime-thread",
        kind: "pi-worker",
      });
      const bridge = createPiRuntimeBridge({
        timeoutMs: 30_000,
      });

      const result = await bridge.runWorker({
        path: "pi-worker",
        thread,
        objective: "Return one short line.",
        cwd: workspace.root,
        inputEpisodeIds: [],
        scopedContext: {
          sessionHistory: [],
          relevantPaths: [workspace.root],
          agentsInstructions: [],
          relevantSkills: [],
          priorEpisodeIds: [],
        },
        toolScope: {
          allow: ["read"],
          readOnly: true,
        },
        completion: {
          type: "episode-produced",
          maxTurns: 1,
        },
      });

      expect(bridge.runtime).toBe("pi");
      expect(result.episode.source).toBe("pi-worker");
      expect(result.episode.conclusions.length).toBeGreaterThan(0);
      expect(result.episode.conclusions).not.toContain(
        "Pi runtime SDK is unavailable.",
      );
      expect(
        result.episode.unresolvedIssues.some((issue) =>
          issue.includes("Unable to import pi runtime module"),
        ),
      ).toBe(false);
    });
  });

  it("executes default createPiRuntimeBridge() through a deterministic pi sdk runtime contract", async () => {
    await withTempWorkspace(async (workspace) => {
      const capturePath = workspace.path("pi-sdk-contract.json");
      await workspace.write(
        "pi-sdk-fake.ts",
        `
import { writeFileSync } from "node:fs";
const CAPTURE_PATH = ${JSON.stringify(capturePath)};

export class AgentSessionRuntime {
  async replaceSession(payload) {
    writeFileSync(CAPTURE_PATH, JSON.stringify({
      phase: "replace-session",
      payload,
    }));
  }
}

export function createPiWorkerRuntime() {
  return {
    async runWorker(request) {
      writeFileSync(CAPTURE_PATH, JSON.stringify({
        phase: "run-worker",
        cwd: request.cwd,
        objective: request.objective,
        toolScope: request.toolScope,
        runtimeTransition: request.runtimeTransition ?? null,
      }));
      return {
        status: "completed",
        outputSummary: "bounded worker response",
      };
    },
  };
}
`,
      );

      const thread = createThreadFixture({
        id: "pi-default-runtime-thread",
        kind: "pi-worker",
      });
      const bridge = createPiRuntimeBridge({
        timeoutMs: 15_000,
        sdkModule: workspace.path("pi-sdk-fake.ts"),
      });

      const result = await bridge.runWorker({
        path: "pi-worker",
        thread,
        objective: "Return one short line about bounded workers.",
        cwd: workspace.root,
        inputEpisodeIds: [],
        scopedContext: {
          sessionHistory: [],
          relevantPaths: [workspace.root],
          agentsInstructions: [],
          relevantSkills: [],
          priorEpisodeIds: [],
        },
        toolScope: {
          allow: ["read"],
          readOnly: true,
        },
        completion: {
          type: "episode-produced",
          maxTurns: 1,
        },
        runtimeTransition: {
          reason: "new",
          toSessionId: "pi-default-runtime-thread:pi",
          aligned: true,
          toWorktreePath: workspace.root,
        },
      });

      const contract = JSON.parse(
        await readFile(capturePath, "utf8"),
      ) as {
        phase: string;
        cwd: string;
        objective: string;
        toolScope: {
          allow: string[];
          readOnly?: boolean;
        };
        runtimeTransition: {
          toSessionId?: string;
          toWorktreePath?: string;
        } | null;
      };

      expect(bridge.runtime).toBe("pi");
      expect(bridge.connected).toBe(true);
      expect(contract.phase).toBe("run-worker");
      expect(await realpath(contract.cwd)).toBe(await realpath(workspace.root));
      expect(contract.objective).toBe(
        "Return one short line about bounded workers.",
      );
      expect(contract.toolScope).toEqual({
        allow: ["read"],
        readOnly: true,
      });
      expect(contract.runtimeTransition?.toSessionId).toBe(
        "pi-default-runtime-thread:pi",
      );
      const runtimeTransitionWorktreePath =
        contract.runtimeTransition?.toWorktreePath;
      expect(runtimeTransitionWorktreePath).toBeDefined();
      expect(await realpath(runtimeTransitionWorktreePath as string)).toBe(
        await realpath(workspace.root),
      );

      expect(result.status).toBe("completed");
      expect(result.episode.source).toBe("pi-worker");
      expect(result.outputSummary).toContain("bounded worker response");
      expect(result.episode.completedAt).toBeTruthy();
    });
  });
});
