import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import {
  FakeVerificationRunner,
  FileBackedSessionJsonlHarness,
  createArtifactFixture,
  createVerificationFixture,
  fixedClock,
  runHeadlessHarness,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/cli verification artifact persistence", () => {
  it("persists and refreshes verification artifacts through file-backed JSONL session flows", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "thread-verification-artifacts";
      const artifactId = "artifact-verification-report";
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/verification-artifacts.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });

      const reportPathV1 = await workspace.write(
        "reports/verification-v1.json",
        '{"status":"failed"}\n',
      );
      const reportPathV2 = await workspace.write(
        "reports/verification-v2.json",
        '{"status":"passed"}\n',
      );

      const verificationRunner = new FakeVerificationRunner();
      verificationRunner.enqueueResult({
        status: "failed",
        records: [
          createVerificationFixture({
            id: "verification-test-v1",
            kind: "test",
            status: "failed",
            summary: "Verification tests failed.",
            artifactIds: [artifactId],
          }),
        ],
        artifacts: [
          createArtifactFixture({
            id: artifactId,
            kind: "test-report",
            description: "Verification report v1",
            path: reportPathV1,
          }),
        ],
      });
      verificationRunner.enqueueResult({
        status: "passed",
        records: [
          createVerificationFixture({
            id: "verification-test-v2",
            kind: "test",
            status: "passed",
            summary: "Verification tests passed.",
            artifactIds: [artifactId],
          }),
        ],
        artifacts: [
          createArtifactFixture({
            id: artifactId,
            kind: "test-report",
            description: "Verification report v2",
            path: reportPathV2,
          }),
        ],
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        verificationRunner,
        contextLoader: {
          async load(request) {
            const state = harness.reconstruct();
            return {
              sessionHistory: harness.lines(),
              repoAndWorktree: { cwd: request.cwd },
              agentsInstructions: ["Read docs/prd.md"],
              relevantSkills: ["tests"],
              priorEpisodes: state.episodes,
              priorArtifacts: state.artifacts,
              state,
            };
          },
        },
      });

      const first = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run verification with first report artifact.",
          cwd: workspace.root,
          routeHint: "verification",
        },
        orchestrator,
      );
      harness.appendEntries(first.result.raw.sessionEntries);

      const second = await runHeadlessHarness(
        {
          threadId,
          prompt: "Run verification with updated report artifact.",
          cwd: workspace.root,
          routeHint: "verification",
        },
        orchestrator,
      );
      harness.appendEntries(second.result.raw.sessionEntries);

      const reconstructed = harness.reconstruct();

      expect(first.result.threadSnapshot.episodes.at(-1)?.artifacts[0]?.path).toBe(
        reportPathV1,
      );
      expect(second.result.raw.context.priorArtifacts[0]?.path).toBe(reportPathV1);
      expect(second.result.threadSnapshot.episodes.at(-1)?.artifacts[0]?.path).toBe(
        reportPathV2,
      );
      expect(second.result.threadSnapshot.artifacts[0]?.path).toBe(reportPathV2);
      expect(reconstructed.artifacts).toHaveLength(1);
      expect(reconstructed.artifacts[0]).toMatchObject({
        id: artifactId,
        description: "Verification report v2",
        path: reportPathV2,
      });
      expect(reconstructed.verification.byKind.test?.artifactIds).toEqual([artifactId]);
    });
  });
});
