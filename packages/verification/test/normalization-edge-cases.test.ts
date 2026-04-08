import { describe, expect, it } from "bun:test";
import {
  normalizeVerificationRunToEpisode,
  type VerificationRunResult,
} from "@hellm/verification";
import {
  createArtifactFixture,
  createEpisodeFixture,
  createVerificationFixture,
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

  it("records unresolved issues from only failed verification records when normalizing failures", () => {
    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-mixed-failure",
      objective: "Normalize mixed verification outcomes",
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
            summary: "Unit tests failed",
          }),
          createVerificationFixture({
            id: "verification-lint-failed",
            kind: "lint",
            status: "failed",
            summary: "Lint failed",
          }),
        ],
        artifacts: [],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:05:00.000Z",
    });

    expect(episode.status).toBe("completed_with_issues");
    expect(episode.unresolvedIssues).toEqual(["Unit tests failed", "Lint failed"]);
    expect(episode.followUpSuggestions).toEqual([
      "Resolve the failing verification steps before closing the thread.",
    ]);
    expect(episode.provenance).toEqual({
      executionPath: "verification",
      actor: "verification",
      notes: "Normalized verification execution path.",
    });
  });
});
