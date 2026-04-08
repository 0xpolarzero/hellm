import { describe, expect, it } from "bun:test";
import { normalizeVerificationRunToEpisode } from "@hellm/verification";
import {
  createArtifactFixture,
  createVerificationFixture,
} from "@hellm/test-support";

describe("@hellm/verification manual verification normalization", () => {
  it("marks failed manual verification as completed_with_issues with unresolved summaries", () => {
    const artifact = createArtifactFixture({
      id: "artifact-manual-failure-log",
      kind: "log",
      path: "/repo/reports/manual-check.log",
    });

    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-manual-fail",
      objective: "Run manual validation checks",
      result: {
        status: "failed",
        records: [
          createVerificationFixture({
            id: "verification-manual-failure",
            kind: "manual",
            status: "failed",
            summary: "Manual acceptance checks failed",
            artifactIds: [artifact.id],
          }),
        ],
        artifacts: [artifact],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:10:00.000Z",
    });

    expect(episode.status).toBe("completed_with_issues");
    expect(episode.verification).toHaveLength(1);
    expect(episode.verification[0]).toMatchObject({
      kind: "manual",
      status: "failed",
      summary: "Manual acceptance checks failed",
    });
    expect(episode.unresolvedIssues).toEqual(["Manual acceptance checks failed"]);
    expect(episode.followUpSuggestions).toEqual([
      "Resolve the failing verification steps before closing the thread.",
    ]);
    expect(episode.artifacts[0]?.path).toBe("/repo/reports/manual-check.log");
  });

  it("keeps successful manual-only verification runs completed without unresolved issues", () => {
    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-manual-pass",
      objective: "Run manual smoke checks",
      result: {
        status: "passed",
        records: [
          createVerificationFixture({
            id: "verification-manual-pass",
            kind: "manual",
            status: "passed",
            summary: "Manual smoke checks passed",
          }),
        ],
        artifacts: [],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:05:00.000Z",
      inputEpisodeIds: ["episode-before-manual-check"],
    });

    expect(episode.status).toBe("completed");
    expect(episode.verification).toHaveLength(1);
    expect(episode.verification[0]).toMatchObject({
      kind: "manual",
      status: "passed",
      summary: "Manual smoke checks passed",
    });
    expect(episode.unresolvedIssues).toEqual([]);
    expect(episode.followUpSuggestions).toEqual([]);
    expect(episode.inputEpisodeIds).toEqual(["episode-before-manual-check"]);
  });
});
