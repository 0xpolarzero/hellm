import { describe, expect, it } from "bun:test";
import {
  normalizeVerificationRunToEpisode,
  type VerificationRunResult,
} from "@hellm/verification";
import {
  createVerificationFixture,
  createArtifactFixture,
  createEpisodeFixture,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/verification normalization edge cases", () => {
  it("returns a runner-supplied episode unchanged when the runner already normalized the result", () => {
    const episode = createEpisodeFixture({
      id: "episode-prebuilt",
      threadId: "thread-prebuilt",
      source: "verification",
      status: "completed_with_issues",
      conclusions: ["Runner supplied the normalized episode."],
    });
    const result: VerificationRunResult = {
      status: "failed",
      records: [],
      artifacts: [],
      episode,
    };

    expect(
      normalizeVerificationRunToEpisode({
        threadId: "thread-prebuilt",
        objective: "Use the prebuilt episode",
        result,
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      }),
    ).toBe(episode);
  });

  it("normalizes unknown verification runs into completed episodes without inventing failures", () => {
    const artifact = createArtifactFixture({
      id: "artifact-unknown",
      kind: "log",
      path: "/repo/reports/unknown.log",
    });

    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-unknown",
      objective: "Run uncertain verification",
      result: {
        status: "unknown",
        records: [],
        artifacts: [artifact],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:05:00.000Z",
      inputEpisodeIds: ["episode-prior"],
    });

    expect(episode.status).toBe("completed");
    expect(episode.unresolvedIssues).toEqual([]);
    expect(episode.followUpSuggestions).toEqual([]);
    expect(episode.artifacts[0]?.path).toBe("/repo/reports/unknown.log");
    expect(episode.inputEpisodeIds).toEqual(["episode-prior"]);
  });

  it("extracts unresolved issues only from failed verification records", () => {
    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-failed-selective-issues",
      objective: "Run mixed verification",
      result: {
        status: "failed",
        records: [
          createVerificationFixture({
            id: "verification-build-passed",
            kind: "build",
            status: "passed",
            summary: "Build passed",
          }),
          createVerificationFixture({
            id: "verification-test-failed",
            kind: "test",
            status: "failed",
            summary: "Test suite failed",
          }),
          createVerificationFixture({
            id: "verification-manual-skipped",
            kind: "manual",
            status: "skipped",
            summary: "Manual check skipped",
          }),
        ],
        artifacts: [],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:06:00.000Z",
    });

    expect(episode.status).toBe("completed_with_issues");
    expect(episode.unresolvedIssues).toEqual(["Test suite failed"]);
    expect(episode.followUpSuggestions).toEqual([
      "Resolve the failing verification steps before closing the thread.",
    ]);
  });

  it("normalizes deterministic metadata and preserves real filesystem artifact paths", async () => {
    await withTempWorkspace(async (workspace) => {
      const reportPath = await workspace.write(
        "reports/verification.log",
        "verification output\n",
      );
      const artifact = createArtifactFixture({
        id: "artifact-verification-log",
        kind: "log",
        path: reportPath,
      });

      const episode = normalizeVerificationRunToEpisode({
        threadId: "thread-fs-artifact",
        objective: "Verify with disk-backed output",
        result: {
          status: "passed",
          records: [],
          artifacts: [artifact],
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:09:00.000Z",
      });

      expect(episode.id).toBe("thread-fs-artifact:verification:2026-04-08T09:09:00.000Z");
      expect(episode.inputEpisodeIds).toEqual([]);
      expect(episode.provenance).toEqual({
        executionPath: "verification",
        actor: "verification",
        notes: "Normalized verification execution path.",
      });
      expect(episode.artifacts[0]?.path).toBe(reportPath);
    });
  });
});
