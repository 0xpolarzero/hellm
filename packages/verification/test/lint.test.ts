import { describe, expect, it } from "bun:test";
import { normalizeVerificationRunToEpisode } from "@hellm/verification";
import {
  createArtifactFixture,
  createVerificationFixture,
} from "@hellm/test-support";

describe("@hellm/verification lint coverage", () => {
  it("normalizes failed lint records into completed-with-issues episodes", () => {
    const lintArtifact = createArtifactFixture({
      id: "artifact-lint-failed",
      kind: "log",
      path: "/repo/reports/lint-failed.log",
    });
    const lintRecord = createVerificationFixture({
      id: "verification-lint-failed",
      kind: "lint",
      status: "failed",
      summary: "eslint found 2 errors",
      artifactIds: [lintArtifact.id],
    });

    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-lint-failed",
      objective: "Run lint verification",
      result: {
        status: "failed",
        records: [lintRecord],
        artifacts: [lintArtifact],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:01:00.000Z",
    });

    expect(episode.status).toBe("completed_with_issues");
    expect(episode.verification).toEqual([lintRecord]);
    expect(episode.unresolvedIssues).toEqual(["eslint found 2 errors"]);
    expect(episode.followUpSuggestions).toEqual([
      "Resolve the failing verification steps before closing the thread.",
    ]);
    expect(episode.artifacts).toEqual([lintArtifact]);
  });

  it("keeps passed lint-only verification runs clean and complete", () => {
    const lintRecord = createVerificationFixture({
      id: "verification-lint-passed",
      kind: "lint",
      status: "passed",
      summary: "eslint passed",
    });

    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-lint-passed",
      objective: "Run lint verification",
      result: {
        status: "passed",
        records: [lintRecord],
        artifacts: [],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:01:00.000Z",
    });

    expect(episode.status).toBe("completed");
    expect(episode.verification).toEqual([lintRecord]);
    expect(episode.unresolvedIssues).toEqual([]);
    expect(episode.followUpSuggestions).toEqual([]);
  });
});
