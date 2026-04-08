import { describe, expect, it, test } from "bun:test";
import { createPiWorkerRequest, type PiWorkerResult } from "@hellm/pi-bridge";
import {
  FakePiRuntimeBridge,
  createEpisodeFixture,
  createThreadFixture,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/pi-bridge explicit write-scope rules contract", () => {
  it("preserves explicit write-scope metadata when creating bounded worker requests", async () => {
    await withTempWorkspace(async (workspace) => {
      const writeRoot = await workspace.createWorktree("feature-write-root");
      const outOfScopeRoot = await workspace.createWorktree("outside-scope");
      const thread = createThreadFixture({ id: "thread-write-scope", kind: "pi-worker" });

      const request = createPiWorkerRequest({
        path: "pi-worker",
        thread,
        objective: "Apply an in-scope edit only",
        cwd: workspace.root,
        inputEpisodeIds: ["episode-0"],
        scopedContext: {
          sessionHistory: ["history"],
          relevantPaths: [workspace.root, writeRoot, outOfScopeRoot],
          agentsInstructions: ["Only mutate files under write roots"],
          relevantSkills: ["tests"],
          priorEpisodeIds: ["episode-0"],
        },
        toolScope: {
          allow: ["read", "edit", "bash"],
          deny: ["rm"],
          writeRoots: [writeRoot],
          readOnly: false,
        },
        completion: {
          type: "episode-produced",
          maxTurns: 1,
        },
      });

      expect(request.path).toBe("pi-worker");
      expect(request.toolScope).toEqual({
        allow: ["read", "edit", "bash"],
        deny: ["rm"],
        writeRoots: [writeRoot],
        readOnly: false,
      });
      expect(request.scopedContext.relevantPaths).toContain(outOfScopeRoot);
    });
  });

  it("makes write-scope metadata observable to runtime adapters before execution", async () => {
    await withTempWorkspace(async (workspace) => {
      const writeRoot = await workspace.createWorktree("worker-scope");
      const bridge = new FakePiRuntimeBridge();
      const thread = createThreadFixture({ id: "thread-pi-scope", kind: "pi-worker" });
      const episode = createEpisodeFixture({
        id: "episode-pi-scope",
        threadId: thread.id,
        source: "pi-worker",
      });
      const result: PiWorkerResult = {
        status: "completed",
        episode,
      };
      bridge.enqueueResult(result);

      const request = createPiWorkerRequest({
        path: "pi-worker",
        thread,
        objective: "Run with explicit scope",
        cwd: workspace.root,
        inputEpisodeIds: [],
        scopedContext: {
          sessionHistory: [],
          relevantPaths: [workspace.root, writeRoot],
          agentsInstructions: [],
          relevantSkills: [],
          priorEpisodeIds: [],
        },
        toolScope: {
          allow: ["edit", "bash"],
          writeRoots: [writeRoot],
          readOnly: false,
        },
        completion: {
          type: "episode-produced",
        },
      });

      await bridge.runWorker(request);

      expect(bridge.workerRequests).toHaveLength(1);
      expect(bridge.workerRequests[0]?.toolScope.writeRoots).toEqual([writeRoot]);
      expect(bridge.workerRequests[0]?.toolScope.readOnly).toBe(false);
    });
  });

  test.todo(
    "denies out-of-scope filesystem mutations (including ../ path traversal) before the worker receives edit-capable tools",
    () => {},
  );
  test.todo(
    "resolves symlinks before scope checks so write attempts cannot escape allowed roots via linked paths",
    () => {},
  );
  test.todo(
    "treats readOnly scope as fail-closed and blocks mutations even when edit or bash tools are otherwise allowed",
    () => {},
  );
  test.todo(
    "records blocked outcomes from write-scope violations as explicit worker results without mutating files",
    () => {},
  );
});
