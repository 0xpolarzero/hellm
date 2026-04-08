import { describe, expect, it, test } from "bun:test";
import {
  createSessionWorktreeAlignment,
  createStructuredSessionEntry,
  createThreadSnapshot,
  createVerificationRecord,
  reconstructSessionState,
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
      conclusions: ["State reconstructed from JSONL."],
      changedFiles: ["/repo/src/index.ts"],
      artifacts: [artifact],
      verification: [verification],
      unresolvedIssues: ["Waiting for flaky test fix"],
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
    expect(state.episodes[0]?.conclusions).toEqual([
      "State reconstructed from JSONL.",
    ]);
    expect(state.episodes[0]?.changedFiles).toEqual(["/repo/src/index.ts"]);
    expect(state.episodes[0]?.unresolvedIssues).toEqual([
      "Waiting for flaky test fix",
    ]);
    expect(state.artifacts[0]?.path).toBe("/repo/src/index.ts");
    expect(state.verification.byKind.build?.status).toBe("passed");
    expect(snapshot.workflowRuns).toEqual([]);
    expect(snapshot.episodes[0]?.unresolvedIssues).toEqual([
      "Waiting for flaky test fix",
    ]);
    expect(snapshot.alignment.activeWorktreePath).toBe("/repo/worktrees/feature");
  });

  it("falls back to default session metadata when the JSONL stream has no header", () => {
    const thread = createThreadFixture({
      id: "thread-no-header",
      objective: "Reconstruct header fallback",
    });
    const verification = createVerificationRecord({
      id: "verification-no-header",
      kind: "test",
      status: "passed",
      summary: "Headerless stream still reconstructs state",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const entries = [
      createStructuredSessionEntry({
        id: "entry-no-header-thread",
        parentId: null,
        timestamp: "2026-04-08T09:00:00.000Z",
        payload: { kind: "thread", data: thread },
      }),
      createStructuredSessionEntry({
        id: "entry-no-header-verification",
        parentId: "entry-no-header-thread",
        timestamp: "2026-04-08T09:00:01.000Z",
        payload: { kind: "verification", data: verification },
      }),
    ];

    const state = reconstructSessionState(entries);

    expect(state.sessionId).toBe("session");
    expect(state.sessionCwd).toBe(process.cwd());
    expect(state.threads.map((value) => value.id)).toEqual(["thread-no-header"]);
    expect(state.verification.byKind.test?.id).toBe("verification-no-header");
    expect(state.verification.overallStatus).toBe("passed");
  });

  it("preserves explicit global verification payloads over derived verification records", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-verification-override",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const buildPassed = createVerificationFixture({
      id: "verification-build-passed",
      kind: "build",
      status: "passed",
    });
    const buildFailed = createVerificationFixture({
      id: "verification-build-failed",
      kind: "build",
      status: "failed",
    });

    harness.append({ kind: "verification", data: buildPassed });
    harness.append({
      kind: "verification",
      data: {
        overallStatus: "failed",
        byKind: { build: buildFailed },
      },
    });

    const state = harness.reconstruct();

    expect(state.verification.overallStatus).toBe("failed");
    expect(state.verification.byKind.build?.id).toBe("verification-build-failed");
  });

  it("upserts workflow and smithers isolation entries by run id during reconstruction", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-run-upsert",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });

    harness.append({
      kind: "workflow-run",
      data: {
        runId: "run-1",
        threadId: "thread-1",
        workflowId: "workflow:1",
        status: "running",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
    });
    harness.append({
      kind: "workflow-run",
      data: {
        runId: "run-1",
        threadId: "thread-1",
        workflowId: "workflow:1",
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:01:00.000Z",
        worktreePath: "/repo/worktrees/feature",
      },
    });
    harness.append({
      kind: "workflow-run",
      data: {
        runId: "run-2",
        threadId: "thread-2",
        workflowId: "workflow:2",
        status: "running",
        updatedAt: "2026-04-08T09:01:00.000Z",
      },
    });
    harness.append({
      kind: "smithers-isolation",
      data: {
        runId: "run-1",
        runStateStore: "/repo/.smithers/run-1-v1.sqlite",
        sessionEntryIds: ["entry-1"],
      },
    });
    harness.append({
      kind: "smithers-isolation",
      data: {
        runId: "run-1",
        runStateStore: "/repo/.smithers/run-1-v2.sqlite",
        sessionEntryIds: ["entry-1", "entry-2"],
      },
    });

    const state = harness.reconstruct();

    expect(state.workflowRuns).toHaveLength(2);
    expect(state.workflowRuns.find((run) => run.runId === "run-1")).toEqual({
      runId: "run-1",
      threadId: "thread-1",
      workflowId: "workflow:1",
      status: "waiting_approval",
      updatedAt: "2026-04-08T09:01:00.000Z",
      worktreePath: "/repo/worktrees/feature",
    });
    expect(state.smithersIsolations).toEqual([
      {
        runId: "run-1",
        runStateStore: "/repo/.smithers/run-1-v2.sqlite",
        sessionEntryIds: ["entry-1", "entry-2"],
      },
    ]);
  });

  it("keeps the latest unresolved issues when an episode is re-written with the same id", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-1",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const thread = createThreadFixture({
      id: "thread-1",
      objective: "Reconstruct state",
    });
    const firstEpisode = createEpisodeFixture({
      id: "episode-1",
      threadId: thread.id,
      unresolvedIssues: ["Initial unresolved issue"],
    });
    const updatedEpisode = createEpisodeFixture({
      ...firstEpisode,
      unresolvedIssues: ["New unresolved issue"],
      followUpSuggestions: ["Address the new issue first."],
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: firstEpisode });
    harness.append({ kind: "episode", data: updatedEpisode });

    const state = harness.reconstruct();

    expect(state.episodes).toHaveLength(1);
    expect(state.episodes[0]?.id).toBe("episode-1");
    expect(state.episodes[0]?.unresolvedIssues).toEqual([
      "New unresolved issue",
    ]);
    expect(state.episodes[0]?.followUpSuggestions).toEqual([
      "Address the new issue first.",
    ]);
  });

  it("applies last-write-wins upsert semantics for duplicate episode identifiers", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-upsert",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const thread = createThreadFixture({
      id: "thread-upsert",
      objective: "Ensure deterministic episode upserts",
    });
    const initialEpisode = createEpisodeFixture({
      id: "episode-dup",
      threadId: thread.id,
      status: "running",
      conclusions: ["Initial execution started."],
      changedFiles: ["/repo/src/original.ts"],
      startedAt: "2026-04-08T09:00:01.000Z",
    });
    const updatedEpisode = createEpisodeFixture({
      id: "episode-dup",
      threadId: thread.id,
      status: "completed",
      conclusions: ["Episode updated by later structured entry."],
      changedFiles: ["/repo/src/final.ts"],
      startedAt: "2026-04-08T09:00:01.000Z",
      completedAt: "2026-04-08T09:00:05.000Z",
      inputEpisodeIds: ["episode-parent"],
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: initialEpisode });
    harness.append({ kind: "episode", data: updatedEpisode });

    const state = harness.reconstruct();
    const snapshot = createThreadSnapshot(state, thread.id);

    expect(state.episodes).toHaveLength(1);
    expect(state.episodes[0]?.id).toBe("episode-dup");
    expect(state.episodes[0]?.status).toBe("completed");
    expect(state.episodes[0]?.conclusions).toEqual([
      "Episode updated by later structured entry.",
    ]);
    expect(state.episodes[0]?.changedFiles).toEqual(["/repo/src/final.ts"]);
    expect(state.episodes[0]?.inputEpisodeIds).toEqual(["episode-parent"]);
    expect(snapshot.episodes).toHaveLength(1);
    expect(snapshot.episodes[0]?.id).toBe("episode-dup");
  });

  it("uses the latest artifact record for snapshot artifacts when JSONL entries update an artifact id", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-artifact-upsert",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const thread = createThreadFixture({
      id: "thread-artifact-upsert",
      objective: "Track artifact updates",
    });
    const artifactFromEpisode = createArtifactFixture({
      id: "artifact-shared",
      kind: "log",
      description: "Initial build log",
      path: "/repo/reports/build-initial.log",
      createdAt: "2026-04-08T09:00:01.000Z",
    });
    const updatedArtifact = createArtifactFixture({
      id: artifactFromEpisode.id,
      kind: "log",
      description: "Updated build log",
      path: "/repo/reports/build-updated.log",
      createdAt: "2026-04-08T09:00:02.000Z",
    });
    const episode = createEpisodeFixture({
      id: "episode-artifact-upsert",
      threadId: thread.id,
      artifacts: [artifactFromEpisode],
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: episode });
    harness.append({ kind: "artifact", data: updatedArtifact });

    const state = harness.reconstruct();
    const snapshot = createThreadSnapshot(state, thread.id);

    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]?.id).toBe(artifactFromEpisode.id);
    expect(state.artifacts[0]?.path).toBe("/repo/reports/build-updated.log");
    expect(state.artifacts[0]?.description).toBe("Updated build log");
    expect(snapshot.artifacts.map((artifact) => artifact.id)).toEqual([
      artifactFromEpisode.id,
    ]);
    expect(snapshot.artifacts[0]?.path).toBe("/repo/reports/build-updated.log");
    expect(snapshot.artifacts[0]?.description).toBe("Updated build log");
  });

  it("applies cross-entry last-write-wins when a standalone artifact is superseded by an episode artifact with the same id", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-artifact-cross-entry-upsert",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const thread = createThreadFixture({
      id: "thread-artifact-cross-entry-upsert",
      objective: "Prefer the latest artifact entry across payload kinds",
    });
    const standaloneArtifact = createArtifactFixture({
      id: "artifact-shared",
      kind: "note",
      description: "Standalone artifact version",
      createdAt: "2026-04-08T09:00:01.000Z",
    });
    const artifactFromEpisode = createArtifactFixture({
      id: standaloneArtifact.id,
      kind: "note",
      description: "Episode artifact version",
      createdAt: "2026-04-08T09:00:02.000Z",
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "artifact", data: standaloneArtifact });
    harness.append({
      kind: "episode",
      data: createEpisodeFixture({
        id: "episode-artifact-cross-entry-upsert",
        threadId: thread.id,
        artifacts: [artifactFromEpisode],
      }),
    });

    const state = harness.reconstruct();
    const snapshot = createThreadSnapshot(state, thread.id);

    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]?.id).toBe(standaloneArtifact.id);
    expect(state.artifacts[0]?.description).toBe("Episode artifact version");
    expect(snapshot.artifacts).toEqual([artifactFromEpisode]);
  });

  it("uses the latest episode artifact references when an episode id is rewritten", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-artifact-reference-upsert",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const thread = createThreadFixture({
      id: "thread-artifact-reference-upsert",
      objective: "Keep snapshot artifacts aligned with latest episode references",
    });
    const artifact = createArtifactFixture({
      id: "artifact-removed-ref",
      kind: "file",
      description: "Artifact referenced by the first episode revision",
      path: "/repo/reports/removed-ref.txt",
      createdAt: "2026-04-08T09:00:01.000Z",
    });
    const firstEpisodeRevision = createEpisodeFixture({
      id: "episode-artifact-reference-upsert",
      threadId: thread.id,
      artifacts: [artifact],
      conclusions: ["First revision references an artifact."],
    });
    const secondEpisodeRevision = createEpisodeFixture({
      ...firstEpisodeRevision,
      artifacts: [],
      conclusions: ["Second revision removes the artifact reference."],
      completedAt: "2026-04-08T09:00:03.000Z",
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: firstEpisodeRevision });
    harness.append({ kind: "episode", data: secondEpisodeRevision });

    const state = harness.reconstruct();
    const snapshot = createThreadSnapshot(state, thread.id);

    expect(state.artifacts.map((entry) => entry.id)).toEqual([artifact.id]);
    expect(state.episodes).toHaveLength(1);
    expect(state.episodes[0]?.id).toBe(firstEpisodeRevision.id);
    expect(state.episodes[0]?.artifacts).toEqual([]);
    expect(snapshot.episodes[0]?.artifacts).toEqual([]);
    expect(snapshot.artifacts).toEqual([]);
  });

  it("derives global verification from episode and standalone records when no global snapshot is stored", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-2",
      cwd: "/repo",
      timestamp: "2026-04-08T10:00:00.000Z",
    });
    const thread = createThreadFixture({
      id: "thread-2",
      objective: "Aggregate verification records",
    });
    const buildRecord = createVerificationFixture({
      id: "verification-build",
      kind: "build",
      status: "passed",
      summary: "Build passed",
    });
    const episode = createEpisodeFixture({
      id: "episode-2",
      threadId: thread.id,
      verification: [buildRecord],
    });
    const testRecord = createVerificationFixture({
      id: "verification-test",
      kind: "test",
      status: "failed",
      summary: "Tests failed",
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: episode });
    harness.append({ kind: "verification", data: testRecord });

    const state = harness.reconstruct();

    expect(state.verification.byKind.build?.status).toBe("passed");
    expect(state.verification.byKind.test?.status).toBe("failed");
    expect(state.verification.overallStatus).toBe("failed");
  });

  it("uses the latest thread entry for a thread id and preserves full thread metadata", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-thread-upsert",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });

    const initial = createThreadFixture({
      id: "thread-upsert",
      kind: "smithers-workflow",
      status: "running",
      objective: "Original objective",
      parentThreadId: "thread-parent",
      inputEpisodeIds: ["episode-1"],
      worktreePath: "/repo/worktrees/initial",
      smithersRunId: "run-initial",
      updatedAt: "2026-04-08T09:01:00.000Z",
    });
    const updated = createThreadFixture({
      ...initial,
      status: "waiting_approval",
      objective: "Updated objective",
      inputEpisodeIds: ["episode-1", "episode-2"],
      worktreePath: "/repo/worktrees/updated",
      smithersRunId: "run-updated",
      updatedAt: "2026-04-08T09:02:00.000Z",
    });

    harness.append({ kind: "thread", data: initial });
    harness.append({ kind: "thread", data: updated });

    const state = harness.reconstruct();
    const snapshot = createThreadSnapshot(state, updated.id);

    expect(state.threads).toHaveLength(1);
    expect(state.threads[0]).toEqual(updated);
    expect(snapshot.thread).toEqual(updated);
    expect(snapshot.episodes).toEqual([]);
  });

  test.todo(
    "secondary storage backends can reconstruct the same state contract without changing the pi-session schema",
    () => {},
  );

  it("reconstructs standalone artifact entries before any episode reference exists", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-artifacts",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const artifact = createArtifactFixture({
      id: "artifact-standalone",
      kind: "file",
      path: "/repo/reports/standalone.json",
    });

    harness.append({ kind: "artifact", data: artifact });
    const state = harness.reconstruct();

    expect(state.episodes).toHaveLength(0);
    expect(state.artifacts).toEqual([artifact]);
  });
});
