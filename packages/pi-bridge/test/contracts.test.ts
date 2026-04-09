import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  createPiRuntimeBridge,
  createPiWorkerRequest,
  normalizePiWorkerResult,
  type PiRuntimeTransition,
  type PiWorkerResult,
} from "@hellm/pi-bridge";
import {
  FakePiRuntimeBridge,
  createEpisodeFixture,
  createThreadFixture,
  withTempWorkspace,
} from "@hellm/test-support";

function createWorkerRequest(input: {
  threadId: string;
  cwd: string;
  relevantPaths: string[];
  runtimeTransition?: PiRuntimeTransition;
}) {
  return createPiWorkerRequest({
    path: "pi-worker",
    thread: createThreadFixture({ id: input.threadId, kind: "pi-worker" }),
    objective: "Run worker",
    cwd: input.cwd,
    inputEpisodeIds: ["episode-0"],
    scopedContext: {
      sessionHistory: ["prior message"],
      relevantPaths: input.relevantPaths,
      agentsInstructions: ["Respect AGENTS.md"],
      relevantSkills: ["tests"],
      priorEpisodeIds: ["episode-0"],
    },
    toolScope: {
      allow: ["read", "edit", "bash"],
      writeRoots: [input.cwd],
    },
    completion: {
      type: "episode-produced",
      maxTurns: 1,
    },
    ...(input.runtimeTransition
      ? { runtimeTransition: input.runtimeTransition }
      : {}),
  });
}

describe("@hellm/pi-bridge contract surface", () => {
  it("ships a default bridge that reports pi as its runtime and is connected by default", () => {
    const bridge = createPiRuntimeBridge();
    expect(bridge.runtime).toBe("pi");
    expect(bridge.connected).toBe(true);
  });

  it("allows runtime transitions through the default bridge", async () => {
    const bridge = createPiRuntimeBridge();
    const transition: PiRuntimeTransition = {
      reason: "new",
      toSessionId: "session-a",
      aligned: true,
    };

    const result = await bridge.switchRuntime(transition);
    expect(result).toEqual(transition);
  });

  it("captures scoped context, tool scoping, completion conditions, and runtime transitions in the fake bridge", async () => {
    const bridge = new FakePiRuntimeBridge();
    const thread = createThreadFixture({ id: "thread-pi", kind: "pi-worker" });
    const episode = createEpisodeFixture({
      id: "episode-pi",
      threadId: thread.id,
      source: "pi-worker",
    });
    const result: PiWorkerResult = {
      status: "completed",
      episode,
      runtimeTransition: {
        reason: "resume",
        fromSessionId: "session-a",
        toSessionId: "session-b",
        aligned: true,
        toWorktreePath: "/repo/worktrees/feature",
      },
    };
    bridge.enqueueResult(result);

    const request = createWorkerRequest({
      threadId: thread.id,
      cwd: "/repo",
      relevantPaths: ["/repo", "/repo/worktrees/feature"],
      runtimeTransition: result.runtimeTransition!,
    });

    const workerResult = await bridge.runWorker(request);
    await bridge.switchRuntime(result.runtimeTransition!);

    expect(bridge.workerRequests[0]?.scopedContext.priorEpisodeIds).toEqual([
      "episode-0",
    ]);
    expect(bridge.workerRequests[0]?.toolScope.allow).toEqual([
      "read",
      "edit",
      "bash",
    ]);
    expect(bridge.workerRequests[0]?.completion.maxTurns).toBe(1);
    expect(bridge.transitions[0]?.toSessionId).toBe("session-b");
    expect(workerResult.episode.id).toBe("episode-pi");
  });

  it("preserves runtime transition metadata for new, resume, fork, and import transitions", async () => {
    await withTempWorkspace(async (workspace) => {
      const sourceWorktree = await workspace.createWorktree("source");
      const targetWorktree = await workspace.createWorktree("target");
      const transitions: PiRuntimeTransition[] = [
        {
          reason: "new",
          toSessionId: "session-new",
          aligned: true,
        },
        {
          reason: "resume",
          fromSessionId: "session-a",
          toSessionId: "session-b",
          aligned: false,
          fromWorktreePath: sourceWorktree,
          toWorktreePath: targetWorktree,
        },
        {
          reason: "fork",
          fromSessionId: "session-parent",
          toSessionId: "session-fork",
          aligned: false,
          fromWorktreePath: sourceWorktree,
          toWorktreePath: targetWorktree,
        },
        {
          reason: "import",
          toSessionId: "session-import",
          aligned: false,
          toWorktreePath: targetWorktree,
        },
      ];

      for (const transition of transitions) {
        const bridge = new FakePiRuntimeBridge();
        const threadId = `thread-${transition.reason}`;
        bridge.enqueueResult({
          status: "completed",
          episode: createEpisodeFixture({
            id: `episode-${transition.reason}`,
            threadId,
            source: "pi-worker",
          }),
          runtimeTransition: transition,
        });

        const request = createWorkerRequest({
          threadId,
          cwd: workspace.root,
          relevantPaths: [workspace.root, sourceWorktree, targetWorktree],
          runtimeTransition: transition,
        });

        const workerResult = await bridge.runWorker(request);
        const switched = await bridge.switchRuntime(workerResult.runtimeTransition!);

        expect(bridge.workerRequests[0]?.runtimeTransition).toEqual(transition);
        expect(bridge.transitions[0]).toEqual(transition);
        expect(switched).toEqual(transition);
      }
    });
  });

  it("uses runtime session replacement semantics for worktree-aware transitions through the sdk bridge", async () => {
    await withTempWorkspace(async (workspace) => {
      const capturePath = workspace.path("pi-sdk-transitions.json");
      await workspace.write(
        "pi-sdk-runtime.ts",
        `
import { writeFileSync } from "node:fs";
const CAPTURE_PATH = ${JSON.stringify(capturePath)};
const events = [];

function flush() {
  writeFileSync(CAPTURE_PATH, JSON.stringify(events));
}

export class AgentSessionRuntime {
  async replaceSession(payload) {
    events.push({ type: "replaceSession", payload });
    flush();
  }
}

export function createPiWorkerRuntime() {
  return {
    async runWorker(request) {
      events.push({ type: "runWorker", request: {
        cwd: request.cwd,
        runtimeTransition: request.runtimeTransition ?? null,
      }});
      flush();
      return {
        status: "completed",
        outputSummary: "sdk-run-worker-ok",
      };
    },
  };
}
`,
      );

      const bridge = createPiRuntimeBridge({
        sdkModule: workspace.path("pi-sdk-runtime.ts"),
      });
      const request = createWorkerRequest({
        threadId: "thread-runtime-switch",
        cwd: workspace.root,
        relevantPaths: [workspace.root],
        runtimeTransition: {
          reason: "resume",
          fromSessionId: "session-old",
          toSessionId: "session-new",
          aligned: false,
          fromWorktreePath: workspace.path("worktrees/source"),
          toWorktreePath: workspace.path("worktrees/target"),
        },
      });

      await bridge.runWorker(request);
      await bridge.switchRuntime({
        reason: "fork",
        fromSessionId: "session-new",
        toSessionId: "session-fork",
        aligned: false,
        fromWorktreePath: workspace.path("worktrees/target"),
        toWorktreePath: workspace.path("worktrees/fork"),
      });

      const events = JSON.parse(await readFile(capturePath, "utf8")) as Array<{
        type: string;
        payload?: Record<string, unknown>;
        request?: {
          cwd?: string;
          runtimeTransition?: Record<string, unknown> | null;
        };
      }>;

      expect(events[0]?.type).toBe("replaceSession");
      expect(events[0]?.payload?.["toSessionId"]).toBe("session-new");
      expect(events[1]?.type).toBe("runWorker");
      expect(events[1]?.request?.runtimeTransition?.["toSessionId"]).toBe(
        "session-new",
      );
      expect(events[2]?.type).toBe("replaceSession");
      expect(events[2]?.payload?.["toSessionId"]).toBe("session-fork");
      expect(events[2]?.payload?.["toWorktreePath"]).toBe(
        workspace.path("worktrees/fork"),
      );
    });
  });

  it("keeps raw pi-worker requests and results unwrapped for orchestrator integration", () => {
    const thread = createThreadFixture({ id: "thread-raw-pi", kind: "pi-worker" });
    const request = createPiWorkerRequest({
      path: "pi-worker",
      thread,
      objective: "Execute the bounded pi worker primitive",
      cwd: "/repo",
      inputEpisodeIds: ["episode-prior"],
      scopedContext: {
        sessionHistory: ["prior line"],
        relevantPaths: ["/repo"],
        agentsInstructions: ["Read AGENTS.md"],
        relevantSkills: ["tests"],
        priorEpisodeIds: ["episode-prior"],
      },
      toolScope: {
        allow: ["read", "edit", "bash"],
      },
      completion: {
        type: "episode-produced",
        maxTurns: 1,
      },
      runtimeTransition: {
        reason: "resume",
        toSessionId: "thread-raw-pi:pi",
        aligned: true,
      },
    });
    const episode = createEpisodeFixture({
      id: "episode-raw-pi",
      threadId: thread.id,
      source: "pi-worker",
    });

    expect(request.path).toBe("pi-worker");
    expect(request.thread.id).toBe("thread-raw-pi");
    expect(request.runtimeTransition?.toSessionId).toBe("thread-raw-pi:pi");
    expect(
      normalizePiWorkerResult({
        status: "completed",
        episode,
      }),
    ).toBe(episode);
  });
});
