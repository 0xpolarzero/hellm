import { describe, expect, it } from "bun:test";
import { normalizeVerificationRunToEpisode } from "@hellm/verification";
import {
  createArtifactFixture,
  createVerificationFixture,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/verification build contracts", () => {
  it("normalizes a successful build verification run with a real file-backed artifact", async () => {
    await withTempWorkspace(async (workspace) => {
      const buildLogPath = await workspace.write(
        "reports/build.log",
        "build completed successfully\n",
      );
      const buildArtifact = createArtifactFixture({
        id: "artifact-build-log-pass",
        kind: "log",
        path: buildLogPath,
        description: "Build stdout and stderr",
      });
      const buildRecord = createVerificationFixture({
        id: "verification-build-pass",
        kind: "build",
        status: "passed",
        summary: "Build passed.",
        artifactIds: [buildArtifact.id],
      });

      const episode = normalizeVerificationRunToEpisode({
        threadId: "thread-build-pass",
        objective: "Run build verification",
        result: {
          status: "passed",
          records: [buildRecord],
          artifacts: [buildArtifact],
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:01:00.000Z",
      });

      expect(await workspace.read("reports/build.log")).toContain(
        "build completed successfully",
      );
      expect(episode.id).toBe(
        "thread-build-pass:verification:2026-04-08T09:01:00.000Z",
      );
      expect(episode.status).toBe("completed");
      expect(episode.objective).toBe("Run build verification");
      expect(episode.artifacts).toEqual([buildArtifact]);
      expect(episode.verification).toEqual([buildRecord]);
      expect(episode.unresolvedIssues).toEqual([]);
      expect(episode.followUpSuggestions).toEqual([]);
      expect(episode.provenance).toEqual({
        executionPath: "verification",
        actor: "verification",
        notes: "Normalized verification execution path.",
      });
      expect(episode.inputEpisodeIds).toEqual([]);
    });
  });

  it("normalizes a failed build verification run into a completed-with-issues episode", async () => {
    await withTempWorkspace(async (workspace) => {
      const buildLogPath = await workspace.write(
        "reports/build-fail.log",
        "error TS2304: Cannot find name 'missingSymbol'\n",
      );
      const buildArtifact = createArtifactFixture({
        id: "artifact-build-log-fail",
        kind: "log",
        path: buildLogPath,
        description: "Build failure output",
      });
      const buildRecord = createVerificationFixture({
        id: "verification-build-fail",
        kind: "build",
        status: "failed",
        summary: "Build failed with TypeScript errors.",
        artifactIds: [buildArtifact.id],
      });

      const episode = normalizeVerificationRunToEpisode({
        threadId: "thread-build-fail",
        objective: "Run build verification",
        result: {
          status: "failed",
          records: [buildRecord],
          artifacts: [buildArtifact],
        },
        startedAt: "2026-04-08T09:10:00.000Z",
        completedAt: "2026-04-08T09:12:00.000Z",
        inputEpisodeIds: ["episode-prior-build"],
      });

      expect(await workspace.read("reports/build-fail.log")).toContain(
        "TS2304",
      );
      expect(episode.status).toBe("completed_with_issues");
      expect(episode.conclusions).toEqual(["Verification failed."]);
      expect(episode.verification).toEqual([buildRecord]);
      expect(episode.unresolvedIssues).toEqual([
        "Build failed with TypeScript errors.",
      ]);
      expect(episode.followUpSuggestions).toEqual([
        "Resolve the failing verification steps before closing the thread.",
      ]);
      expect(episode.inputEpisodeIds).toEqual(["episode-prior-build"]);
    });
  });
});
