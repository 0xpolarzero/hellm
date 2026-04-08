import { describe, expect, it, test } from "bun:test";
import {
  createSessionWorktreeAlignment,
  createThreadSnapshot,
} from "@hellm/session-model";
import {
  InMemorySessionJsonlHarness,
  createArtifactFixture,
  createEpisodeFixture,
  createThreadFixture,
  createVerificationFixture,
} from "@hellm/test-support";

describe("@hellm/session-model reconstruction", () => {
  it("reconstructs thread, episode, artifact, verification, and alignment state from JSONL-backed structured entries", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-1",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const thread = createThreadFixture({
      id: "thread-1",
      objective: "Reconstruct state",
      worktreePath: "/repo/worktrees/feature",
    });
    const artifact = createArtifactFixture({
      id: "artifact-1",
      kind: "file",
      path: "/repo/src/index.ts",
    });
    const verification = createVerificationFixture({
      id: "verification-1",
      kind: "build",
      status: "passed",
      artifactIds: [artifact.id],
    });
    const episode = createEpisodeFixture({
      id: "episode-1",
      threadId: thread.id,
      artifacts: [artifact],
      verification: [verification],
      worktreePath: thread.worktreePath!,
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: episode });
    harness.append({
      kind: "alignment",
      data: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
        activeWorktreePath: thread.worktreePath!,
      }),
    });

    const state = harness.reconstruct();
    const snapshot = createThreadSnapshot(state, thread.id);

    expect(state.sessionId).toBe("session-1");
    expect(state.threads).toHaveLength(1);
    expect(state.episodes[0]?.id).toBe("episode-1");
    expect(state.artifacts[0]?.path).toBe("/repo/src/index.ts");
    expect(state.verification.byKind.build?.status).toBe("passed");
    expect(snapshot.workflowRuns).toEqual([]);
    expect(snapshot.alignment.activeWorktreePath).toBe("/repo/worktrees/feature");
  });

  test.todo(
    "secondary storage backends can reconstruct the same state contract without changing the pi-session schema",
    () => {},
  );
});
