import { describe, expect, it } from "bun:test";
import { normalizeVerificationRunToEpisode } from "@hellm/verification";
import {
  createArtifactFixture,
  createVerificationFixture,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/verification artifact normalization", () => {
  it("preserves file-backed artifact metadata and verification artifact links", async () => {
    await withTempWorkspace(async (workspace) => {
      const buildLogPath = await workspace.write(
        "reports/build.log",
        "build output\n",
      );
      const testReportPath = await workspace.write(
        "reports/tests.json",
        '{"status":"failed"}\n',
      );

      const buildLogArtifact = createArtifactFixture({
        id: "artifact-build-log",
        kind: "log",
        description: "Build output log",
        path: buildLogPath,
      });
      const testReportArtifact = createArtifactFixture({
        id: "artifact-test-report",
        kind: "test-report",
        description: "Test runner JSON report",
        path: testReportPath,
      });
      const records = [
        createVerificationFixture({
          id: "verification-build",
          kind: "build",
          status: "passed",
          summary: "Build completed.",
          artifactIds: [buildLogArtifact.id],
        }),
        createVerificationFixture({
          id: "verification-test",
          kind: "test",
          status: "failed",
          summary: "Tests failed in workspace.",
          artifactIds: [testReportArtifact.id],
        }),
      ];

      const episode = normalizeVerificationRunToEpisode({
        threadId: "thread-verification-artifacts",
        objective: "Run verification for artifact capture",
        result: {
          status: "failed",
          records,
          artifacts: [buildLogArtifact, testReportArtifact],
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:05:00.000Z",
      });

      expect(episode.artifacts).toEqual([buildLogArtifact, testReportArtifact]);
      expect(episode.verification.map((record) => record.artifactIds)).toEqual([
        [buildLogArtifact.id],
        [testReportArtifact.id],
      ]);
      expect(episode.unresolvedIssues).toEqual(["Tests failed in workspace."]);
      expect(episode.followUpSuggestions).toEqual([
        "Resolve the failing verification steps before closing the thread.",
      ]);
    });
  });

  it("keeps metadata-only artifacts for manual or unknown verification outcomes", () => {
    const noteArtifact = createArtifactFixture({
      id: "artifact-manual-note",
      kind: "note",
      description: "Manual verification note",
    });

    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-verification-note-artifact",
      objective: "Capture manual verification notes",
      result: {
        status: "unknown",
        records: [
          createVerificationFixture({
            id: "verification-manual",
            kind: "manual",
            status: "skipped",
            summary: "Manual check deferred.",
            artifactIds: [noteArtifact.id],
          }),
        ],
        artifacts: [noteArtifact],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:02:00.000Z",
    });

    expect(episode.artifacts).toHaveLength(1);
    expect(episode.artifacts[0]).toEqual(noteArtifact);
    expect(episode.artifacts[0]?.path).toBeUndefined();
    expect(episode.verification[0]?.artifactIds).toEqual([noteArtifact.id]);
  });
});
