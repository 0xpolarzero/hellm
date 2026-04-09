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
  it("ships a default runner that executes verification commands via subprocess", async () => {
    const runner = createVerificationRunner();

    const result = await runner.run({
      threadId: "thread-default-runner",
      cwd: "/repo",
      objective: "Run verification",
      kinds: ["manual"],
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.kind).toBe("manual");
    expect(result.records[0]?.status).toBe("unknown");
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

  it("normalizes a test-only failure into a completed-with-issues verification episode", () => {
    const testReport = createArtifactFixture({
      id: "artifact-test-report",
      kind: "test-report",
      path: "/repo/reports/unit-test-report.json",
    });
    const failedTestRecord = createVerificationFixture({
      id: "verification-test-only",
      kind: "test",
      status: "failed",
      summary: "2 suites failed in unit tests.",
      artifactIds: [testReport.id],
    });

    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-verify-test-only",
      objective: "Run tests only",
      result: {
        status: "failed",
        records: [failedTestRecord],
        artifacts: [testReport],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:01:00.000Z",
    });

    expect(episode.status).toBe("completed_with_issues");
    expect(episode.verification).toEqual([failedTestRecord]);
    expect(episode.artifacts).toEqual([testReport]);
    expect(episode.unresolvedIssues).toEqual(["2 suites failed in unit tests."]);
    expect(episode.followUpSuggestions).toEqual([
      "Resolve the failing verification steps before closing the thread.",
    ]);
  });

  it("keeps a passed test-only verification run in a completed state", () => {
    const passedTestRecord = createVerificationFixture({
      id: "verification-test-pass",
      kind: "test",
      status: "passed",
      summary: "All unit tests passed.",
    });

    const episode = normalizeVerificationRunToEpisode({
      threadId: "thread-verify-test-pass",
      objective: "Run tests only",
      result: {
        status: "passed",
        records: [passedTestRecord],
        artifacts: [],
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:01:00.000Z",
    });

    expect(episode.status).toBe("completed");
    expect(episode.verification).toEqual([passedTestRecord]);
    expect(episode.unresolvedIssues).toEqual([]);
    expect(episode.followUpSuggestions).toEqual([]);
  });
});
