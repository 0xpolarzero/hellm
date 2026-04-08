import { describe, expect, it } from "bun:test";
import {
  normalizeVerificationRunToEpisode,
  type VerificationRunResult,
} from "@hellm/verification";
import {
  createArtifactFixture,
  createEpisodeFixture,
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
});
