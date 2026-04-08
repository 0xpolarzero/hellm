import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule, withTempWorkspace } from "@hellm/test-support";

const FIXTURE_ENTRY = fileURLToPath(
  new URL("./fixtures/reconstruction-process.fixture.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

describe("@hellm/session-model reconstruction process boundary", () => {
  it("reconstructs latest state from a real JSONL session file across separate processes and cwd changes", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/process-reconstruction.jsonl");
      const observerCwd = await workspace.createWorktree("observer");
      await workspace.createWorktree("feature");

      const appendInitial = runBunModule({
        entryPath: FIXTURE_ENTRY,
        cwd: REPO_ROOT,
        args: ["append-initial", sessionFile, workspace.root],
      });
      expect(appendInitial.exitCode).toBe(0);
      expect(appendInitial.stderr.trim()).toBe("");

      const appendFinal = runBunModule({
        entryPath: FIXTURE_ENTRY,
        cwd: REPO_ROOT,
        args: ["append-final", sessionFile, workspace.root, observerCwd],
      });
      expect(appendFinal.exitCode).toBe(0);
      expect(appendFinal.stderr.trim()).toBe("");

      const reconstructed = runBunModule({
        entryPath: FIXTURE_ENTRY,
        cwd: REPO_ROOT,
        args: ["reconstruct", sessionFile, workspace.root, observerCwd],
      });
      expect(reconstructed.exitCode).toBe(0);
      expect(reconstructed.stderr.trim()).toBe("");

      const summary = JSON.parse(reconstructed.stdout.trim()) as {
        sessionId: string;
        sessionCwd: string;
        threadStatus: string;
        threadInputEpisodeIds: string[];
        episodeStatus: string;
        episodeConclusions: string[];
        verificationOverallStatus: string;
        alignment: {
          sessionCwd: string;
          activeWorktreePath?: string;
          aligned: boolean;
          reason: string;
        };
      };

      expect(summary.sessionId).toBe("session-process-reconstruction");
      expect(summary.sessionCwd).toBe(resolve(workspace.root));
      expect(summary.threadStatus).toBe("completed");
      expect(summary.threadInputEpisodeIds).toEqual([
        "episode-seed",
        "episode-previous",
      ]);
      expect(summary.episodeStatus).toBe("completed");
      expect(summary.episodeConclusions).toEqual([
        "Process-boundary reconstruction is complete.",
      ]);
      expect(summary.verificationOverallStatus).toBe("passed");
      expect(summary.alignment.sessionCwd).toBe(resolve(workspace.root));
      expect(summary.alignment.activeWorktreePath).toBe(
        resolve(workspace.root, "worktrees/feature"),
      );
      expect(summary.alignment.aligned).toBe(false);

      const sessionLines = (await workspace.read(
        ".pi/sessions/process-reconstruction.jsonl",
      ))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const structured = sessionLines.filter(
        (entry) =>
          entry.type === "message" &&
          typeof entry.id === "string" &&
          typeof entry.parentId !== "undefined",
      ) as Array<{ id: string; parentId: string | null }>;

      for (let index = 1; index < structured.length; index += 1) {
        expect(structured[index]?.parentId).toBe(structured[index - 1]?.id);
      }
    });
  });
});
