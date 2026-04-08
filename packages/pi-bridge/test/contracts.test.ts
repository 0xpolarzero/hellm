import { describe, expect, it, test } from "bun:test";
import {
  createPiRuntimeBridge,
  createPiWorkerRequest,
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

  test.todo(
    "explicit write scope rules deny out-of-scope mutations before the worker receives tool access",
    () => {},
  );
});
