import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule, withTempWorkspace } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const PI_WORKER_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/pi-worker-process-entry.ts", import.meta.url),
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
});
