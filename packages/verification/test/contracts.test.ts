import { describe, expect, it } from "bun:test";
import {
  createVerificationRunner,
  normalizeVerificationRunToEpisode,
} from "@hellm/verification";
import {
  FakeVerificationRunner,
  createArtifactFixture,
  createVerificationFixture,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/verification contract surface", () => {
  it("ships a default runner that is explicit about missing implementation", async () => {
    const runner = createVerificationRunner();

    await expect(
      runner.run({
        threadId: "thread-1",
        cwd: "/repo",
        objective: "Run verification",
        kinds: ["build"],
      }),
    ).rejects.toThrow("Not implemented");
  });

  it("normalizes build, test, lint, manual, and integration results into a verification episode", async () => {
    await withTempWorkspace(async (workspace) => {
      const runner = new FakeVerificationRunner();
      const reportPath = await workspace.write(
        "reports/tests.json",
        '{"integration":"failed"}\n',
      );
      const artifact = createArtifactFixture({
        id: "artifact-verification",
        kind: "test-report",
        path: reportPath,
      });
      runner.enqueueResult({
        status: "failed",
        records: [
          createVerificationFixture({ kind: "build", status: "passed" }),
          createVerificationFixture({
            kind: "test",
            status: "failed",
            artifactIds: [artifact.id],
          }),
          createVerificationFixture({ kind: "lint", status: "passed" }),
          createVerificationFixture({ kind: "manual", status: "skipped" }),
          createVerificationFixture({
            kind: "integration",
            status: "failed",
            summary: "Integration suite failed in worktree",
            artifactIds: [artifact.id],
          }),
        ],
        artifacts: [artifact],
      });

      const result = await runner.run({
        threadId: "thread-verify",
        cwd: workspace.root,
        objective: "Verify the change",
        kinds: ["build", "test", "lint", "manual", "integration"],
        manualChecks: ["Open the app and confirm the fix"],
      });
      const episode = normalizeVerificationRunToEpisode({
        threadId: "thread-verify",
        objective: "Verify the change",
        result,
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:10:00.000Z",
      });

      expect(result.records).toHaveLength(5);
      expect(result.artifacts[0]?.path).toBe(reportPath);
      expect(episode.status).toBe("completed_with_issues");
      expect(episode.verification.map((record) => record.kind)).toEqual([
        "build",
        "test",
        "lint",
        "manual",
        "integration",
      ]);
      expect(
        episode.verification.find((record) => record.kind === "integration")
          ?.artifactIds,
      ).toEqual([artifact.id]);
      expect(episode.unresolvedIssues).toEqual([
        "Fixture verification summary",
        "Integration suite failed in worktree",
      ]);
      expect(episode.followUpSuggestions).toEqual([
        "Resolve the failing verification steps before closing the thread.",
      ]);
    });
  });
});
