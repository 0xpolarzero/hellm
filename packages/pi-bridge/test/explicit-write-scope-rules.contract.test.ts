import { describe, expect, it, test } from "bun:test";
import {
  createPiWorkerRequest,
  normalizePiWorkerResult,
  type PiWorkerResult,
} from "@hellm/pi-bridge";
import {
  FakePiRuntimeBridge,
  createTempGitWorkspace,
  createEpisodeFixture,
  createThreadFixture,
  hasGit,
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

  it("keeps explicit write scope stable when paths come from real linked git worktrees", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const inScopeWorktree = await workspace.createLinkedWorktree("feature-write-scope");
      const outOfScopeWorktree = await workspace.createLinkedWorktree("feature-outside-scope");
      const bridge = new FakePiRuntimeBridge();
      const thread = createThreadFixture({
        id: "thread-linked-worktree-scope",
        kind: "pi-worker",
        worktreePath: inScopeWorktree,
      });
      const episode = createEpisodeFixture({
        id: "episode-linked-worktree-scope",
        threadId: thread.id,
        source: "pi-worker",
        worktreePath: inScopeWorktree,
      });
      bridge.enqueueResult({
        status: "completed",
        episode,
      });

      const request = createPiWorkerRequest({
        path: "pi-worker",
        thread,
        objective: "Edit only the linked in-scope worktree",
        cwd: inScopeWorktree,
        inputEpisodeIds: [],
        scopedContext: {
          sessionHistory: [],
          relevantPaths: [workspace.root, inScopeWorktree, outOfScopeWorktree],
          agentsInstructions: ["Edits must stay in allowed worktree roots"],
          relevantSkills: [],
          priorEpisodeIds: [],
        },
        toolScope: {
          allow: ["read", "edit", "bash"],
          writeRoots: [inScopeWorktree],
          readOnly: false,
        },
        completion: {
          type: "episode-produced",
        },
      });

      await bridge.runWorker(request);

      expect(bridge.workerRequests).toHaveLength(1);
      expect(bridge.workerRequests[0]?.cwd).toBe(inScopeWorktree);
      expect(bridge.workerRequests[0]?.toolScope.writeRoots).toEqual([inScopeWorktree]);
      expect(bridge.workerRequests[0]?.scopedContext.relevantPaths).toEqual([
        workspace.root,
        inScopeWorktree,
        outOfScopeWorktree,
      ]);
    } finally {
      await workspace.cleanup();
    }
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

  it("preserves blocked write-scope outcomes without mutating on-disk files in scope", async () => {
    await withTempWorkspace(async (workspace) => {
      const writeRoot = await workspace.createWorktree("blocked-scope");
      await workspace.write("worktrees/blocked-scope/file.txt", "before\n");
      const bridge = new FakePiRuntimeBridge();
      const thread = createThreadFixture({ id: "thread-blocked-scope", kind: "pi-worker" });
      const blockedEpisode = createEpisodeFixture({
        id: "episode-blocked-scope",
        threadId: thread.id,
        source: "pi-worker",
        status: "blocked",
        unresolvedIssues: [
          "Write denied: attempted edit outside explicit write roots.",
        ],
      });
      bridge.enqueueResult({
        status: "blocked",
        episode: blockedEpisode,
        outputSummary: "Blocked by explicit write-scope enforcement.",
      });

      const request = createPiWorkerRequest({
        path: "pi-worker",
        thread,
        objective: "Attempt out-of-scope mutation",
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
          readOnly: true,
        },
        completion: {
          type: "episode-produced",
        },
      });

      const workerResult = await bridge.runWorker(request);
      const normalized = normalizePiWorkerResult(workerResult);

      expect(workerResult.status).toBe("blocked");
      expect(normalized.status).toBe("blocked");
      expect(normalized.unresolvedIssues).toEqual([
        "Write denied: attempted edit outside explicit write roots.",
      ]);
      expect(await workspace.read("worktrees/blocked-scope/file.txt")).toBe("before\n");
      expect(bridge.workerRequests[0]?.toolScope.readOnly).toBe(true);
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
  test.todo(
    "requires explicit writeRoots for any mutation-capable scope and fails closed when allow includes edit or bash but writeRoots is empty",
    () => {},
  );
  test.todo(
    "applies the same scope guard to shell-triggered writes (redirects, heredocs, and script execution), not only direct edit tool calls",
    () => {},
  );
});
