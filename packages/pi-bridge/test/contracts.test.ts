import { describe, expect, it } from "bun:test";
import {
  createPiRuntimeBridge,
  createPiWorkerRequest,
  normalizePiWorkerResult,
  type PiWorkerResult,
} from "@hellm/pi-bridge";
import {
  FakePiRuntimeBridge,
  createEpisodeFixture,
  createThreadFixture,
} from "@hellm/test-support";

describe("@hellm/pi-bridge contract surface", () => {
  it("ships a default bridge that is explicit about missing implementation", async () => {
    const bridge = createPiRuntimeBridge();
    expect(bridge.runtime).toBe("pi");
    expect(bridge.connected).toBe(false);

    await expect(
      bridge.runWorker(
        createPiWorkerRequest({
          path: "pi-worker",
          thread: createThreadFixture(),
          objective: "Run worker",
          cwd: "/repo",
          inputEpisodeIds: [],
          scopedContext: {
            sessionHistory: [],
            relevantPaths: ["/repo"],
            agentsInstructions: [],
            relevantSkills: [],
            priorEpisodeIds: [],
          },
          toolScope: {
            allow: ["read"],
          },
          completion: {
            type: "episode-produced",
          },
        }),
      ),
    ).rejects.toThrow("Not implemented");
    await expect(
      bridge.switchRuntime({
        reason: "new",
        toSessionId: "session-pi",
        aligned: true,
      }),
    ).rejects.toThrow("Not implemented");
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

    const request = createPiWorkerRequest({
      path: "pi-worker",
      thread,
      objective: "Fix a bounded task",
      cwd: "/repo",
      inputEpisodeIds: ["episode-0"],
      scopedContext: {
        sessionHistory: ["prior message"],
        relevantPaths: ["/repo", "/repo/worktrees/feature"],
        agentsInstructions: ["Respect AGENTS.md"],
        relevantSkills: ["tests"],
        priorEpisodeIds: ["episode-0"],
      },
      toolScope: {
        allow: ["read", "edit", "bash"],
        writeRoots: ["/repo"],
      },
      completion: {
        type: "episode-produced",
        maxTurns: 1,
      },
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
