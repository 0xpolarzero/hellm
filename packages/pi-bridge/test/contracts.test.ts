import { describe, expect, it } from "bun:test";
import {
  createPiRuntimeBridge,
  createPiWorkerRequest,
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
  it("ships a default bridge that is explicit about missing implementation", async () => {
    const bridge = createPiRuntimeBridge();
    const transition: PiRuntimeTransition = {
      reason: "new",
      toSessionId: "session-a",
      aligned: true,
    };

    await expect(
      bridge.runWorker(
        createWorkerRequest({
          threadId: "thread-default-bridge",
          cwd: "/repo",
          relevantPaths: ["/repo"],
          runtimeTransition: transition,
        }),
      ),
    ).rejects.toThrow("Not implemented");
    await expect(bridge.switchRuntime(transition)).rejects.toThrow(
      "Not implemented",
    );
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
});
