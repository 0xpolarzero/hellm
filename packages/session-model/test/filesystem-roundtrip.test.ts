import { appendFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createSessionWorktreeAlignment,
  createThread,
  createThreadSnapshot,
  createVerificationRecord,
} from "@hellm/session-model";
import {
  FileBackedSessionJsonlHarness,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/session-model filesystem roundtrip", () => {
  it("reconstructs structured state from a real JSONL file while ignoring non-hellm entries", async () => {
    await withTempWorkspace(async (workspace) => {
      const reportPath = await workspace.write("reports/build.log", "build passed\n");
      const changedFilePath = workspace.path("src/index.ts");
      const sessionFile = workspace.path(".pi/sessions/thread.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-fs",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-fs",
        kind: "smithers-workflow",
        objective: "Persist structured workflow state",
        status: "waiting_approval",
        parentThreadId: "thread-parent",
        inputEpisodeIds: ["episode-prior", "episode-context"],
        worktreePath: workspace.path("worktrees/feature"),
        smithersRunId: "run-fs",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:05:00.000Z",
      });
      const artifact = createArtifact({
        id: "artifact-build-log",
        kind: "log",
        description: "Build output",
        path: reportPath,
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const verification = createVerificationRecord({
        id: "verification-build",
        kind: "build",
        status: "passed",
        summary: "Build passed",
        artifactIds: [artifact.id],
        createdAt: "2026-04-08T09:00:01.000Z",
      });
      const episode = createEpisode({
        id: "episode-fs",
        threadId: thread.id,
        source: "smithers",
        objective: thread.objective,
        status: "waiting_approval",
        conclusions: ["Workflow paused at approval gate."],
        changedFiles: [changedFilePath],
        artifacts: [artifact],
        verification: [verification],
        unresolvedIssues: ["Approval is still pending from the repository owner."],
        followUpSuggestions: ["Approve the workflow to continue."],
        provenance: {
          executionPath: "smithers-workflow",
          actor: "smithers",
          notes: "File-backed roundtrip.",
        },
        smithersRunId: "run-fs",
        worktreePath: thread.worktreePath,
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:05:00.000Z",
        inputEpisodeIds: ["episode-prior"],
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({ kind: "episode", data: episode });
      harness.append({
        kind: "verification",
        data: {
          overallStatus: "passed",
          byKind: { build: verification },
        },
      });
      harness.append({
        kind: "alignment",
        data: createSessionWorktreeAlignment({
          sessionCwd: workspace.root,
          activeWorktreePath: thread.worktreePath,
        }),
      });
      harness.append({
        kind: "workflow-run",
        data: {
          runId: "run-fs",
          threadId: thread.id,
          workflowId: "workflow:thread-fs",
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:05:00.000Z",
          worktreePath: thread.worktreePath,
        },
      });
      harness.append({
        kind: "smithers-isolation",
        data: {
          runId: "run-fs",
          runStateStore: workspace.path(".smithers/run-fs.sqlite"),
          sessionEntryIds: ["entry-a", "entry-b"],
        },
      });
      appendFileSync(
        sessionFile,
        `${JSON.stringify({
          type: "message",
          id: "foreign-message",
          parentId: null,
          timestamp: "2026-04-08T09:06:00.000Z",
          message: {
            role: "user",
            content: "ignore me",
          },
        })}\n`,
        "utf8",
      );

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);

      expect(state.sessionId).toBe("session-fs");
      expect(state.threads).toHaveLength(1);
      expect(state.workflowRuns).toHaveLength(1);
      expect(state.smithersIsolations).toHaveLength(1);
      expect(state.verification.byKind.build?.artifactIds).toEqual([artifact.id]);
      expect(state.episodes.at(-1)?.unresolvedIssues).toEqual([
        "Approval is still pending from the repository owner.",
      ]);
      expect(snapshot.thread.status).toBe("waiting_approval");
      expect(snapshot.thread.parentThreadId).toBe("thread-parent");
      expect(snapshot.thread.inputEpisodeIds).toEqual([
        "episode-prior",
        "episode-context",
      ]);
      expect(snapshot.thread.smithersRunId).toBe("run-fs");
      expect(snapshot.episodes.at(-1)?.smithersRunId).toBe("run-fs");
      expect(snapshot.episodes.at(-1)?.changedFiles).toEqual([changedFilePath]);
      expect(snapshot.episodes.at(-1)?.inputEpisodeIds).toEqual(["episode-prior"]);
      expect(snapshot.episodes.at(-1)?.unresolvedIssues).toEqual([
        "Approval is still pending from the repository owner.",
      ]);
      expect(snapshot.artifacts[0]?.path).toBe(reportPath);
      expect(snapshot.verification.overallStatus).toBe("passed");
      expect(snapshot.workflowRuns[0]?.worktreePath).toBe(thread.worktreePath);
      expect(snapshot.alignment.activeWorktreePath).toBe(thread.worktreePath);
      expect(harness.jsonl()).toContain("\"customType\":\"hellm/thread\"");
      expect(harness.jsonl()).toContain("ignore me");
    });
  });

  it("rebuilds episode verification records from real JSONL when no global verification snapshot exists", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/verification-only.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-verification-fs",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-verification-fs",
        kind: "verification",
        objective: "Rebuild verification records",
        status: "completed",
        createdAt: "2026-04-08T10:00:00.000Z",
        updatedAt: "2026-04-08T10:05:00.000Z",
      });
      const buildRecord = createVerificationRecord({
        id: "verification-build-fs",
        kind: "build",
        status: "passed",
        summary: "Build passed",
        createdAt: "2026-04-08T10:00:01.000Z",
      });
      const episode = createEpisode({
        id: "episode-verification-fs",
        threadId: thread.id,
        source: "verification",
        objective: "Verification run",
        status: "completed_with_issues",
        verification: [buildRecord],
        provenance: {
          executionPath: "verification",
          actor: "verification",
        },
        startedAt: "2026-04-08T10:00:00.000Z",
        completedAt: "2026-04-08T10:05:00.000Z",
      });
      const manualRecord = createVerificationRecord({
        id: "verification-manual-fs",
        kind: "manual",
        status: "failed",
        summary: "Manual verification failed",
        createdAt: "2026-04-08T10:05:00.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({ kind: "episode", data: episode });
      harness.append({ kind: "verification", data: manualRecord });

      const reconstructed = harness.reconstruct();

      expect(reconstructed.verification.byKind.build?.status).toBe("passed");
      expect(reconstructed.verification.byKind.manual?.status).toBe("failed");
      expect(reconstructed.verification.overallStatus).toBe("failed");
    });
  });

  it("filters snapshots by thread and raises when the requested thread does not exist", async () => {
    const threadA = createThread({
      id: "thread-a",
      kind: "direct",
      objective: "Thread A",
      status: "completed",
      createdAt: "2026-04-08T09:00:00.000Z",
      updatedAt: "2026-04-08T09:01:00.000Z",
    });
    const threadB = createThread({
      id: "thread-b",
      kind: "smithers-workflow",
      objective: "Thread B",
      status: "running",
      createdAt: "2026-04-08T09:00:00.000Z",
      updatedAt: "2026-04-08T09:01:00.000Z",
    });
    const artifactA = createArtifact({
      id: "artifact-a",
      kind: "note",
      description: "Thread A note",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const artifactB = createArtifact({
      id: "artifact-b",
      kind: "note",
      description: "Thread B note",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const episodeA = createEpisode({
      id: "episode-a",
      threadId: threadA.id,
      source: "orchestrator",
      objective: threadA.objective,
      status: "completed",
      artifacts: [artifactA],
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:00:01.000Z",
    });
    const episodeB = createEpisode({
      id: "episode-b",
      threadId: threadB.id,
      source: "smithers",
      objective: threadB.objective,
      status: "blocked",
      artifacts: [artifactB],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:00:01.000Z",
    });

    const snapshot = createThreadSnapshot(
      {
        sessionId: "session",
        sessionCwd: "/repo",
        threads: [threadA, threadB],
        episodes: [episodeA, episodeB],
        artifacts: [artifactA, artifactB],
        verification: {
          overallStatus: "unknown",
          byKind: {},
        },
        alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
        workflowRuns: [
          {
            runId: "run-b",
            threadId: threadB.id,
            workflowId: "workflow:thread-b",
            status: "running",
            updatedAt: "2026-04-08T09:01:00.000Z",
          },
        ],
        smithersIsolations: [],
      },
      threadB.id,
    );

    expect(snapshot.thread.id).toBe(threadB.id);
    expect(snapshot.episodes.map((episode) => episode.id)).toEqual(["episode-b"]);
    expect(snapshot.artifacts.map((artifact) => artifact.id)).toEqual(["artifact-b"]);
    expect(snapshot.workflowRuns.map((run) => run.runId)).toEqual(["run-b"]);
    expect(() =>
      createThreadSnapshot(
        {
          sessionId: "session",
          sessionCwd: "/repo",
          threads: [threadA],
          episodes: [],
          artifacts: [],
          verification: {
            overallStatus: "unknown",
            byKind: {},
          },
          alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
          workflowRuns: [],
          smithersIsolations: [],
        },
        "missing-thread",
      ),
    ).toThrow(/Thread missing-thread was not found/);
  });

  it("deduplicates episode artifact references per thread and excludes artifacts from other threads", async () => {
    await withTempWorkspace(async (workspace) => {
      const sharedDiffPath = await workspace.write(
        "reports/shared.patch",
        "diff --git a/a.ts b/a.ts\n",
      );
      const otherThreadPath = await workspace.write("reports/other.txt", "thread b\n");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/artifacts.jsonl"),
        sessionId: "session-artifact-refs",
        cwd: workspace.root,
      });
      const threadA = createThread({
        id: "thread-artifact-a",
        kind: "direct",
        objective: "Thread A objective",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:01:00.000Z",
      });
      const threadB = createThread({
        id: "thread-artifact-b",
        kind: "direct",
        objective: "Thread B objective",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:01:00.000Z",
      });
      const sharedArtifactInitial = createArtifact({
        id: "artifact-shared",
        kind: "diff",
        description: "Initial shared diff",
        path: sharedDiffPath,
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const sharedArtifactUpdated = createArtifact({
        id: "artifact-shared",
        kind: "diff",
        description: "Updated shared diff",
        path: sharedDiffPath,
        createdAt: "2026-04-08T09:02:00.000Z",
      });
      const otherThreadArtifact = createArtifact({
        id: "artifact-other-thread",
        kind: "file",
        description: "Thread B file",
        path: otherThreadPath,
        createdAt: "2026-04-08T09:00:00.000Z",
      });

      harness.append({ kind: "thread", data: threadA });
      harness.append({ kind: "thread", data: threadB });
      harness.append({
        kind: "episode",
        data: createEpisode({
          id: "episode-a-1",
          threadId: threadA.id,
          source: "orchestrator",
          objective: threadA.objective,
          status: "completed",
          artifacts: [sharedArtifactInitial],
          provenance: {
            executionPath: "direct",
            actor: "orchestrator",
          },
          startedAt: "2026-04-08T09:00:00.000Z",
          completedAt: "2026-04-08T09:00:01.000Z",
        }),
      });
      harness.append({
        kind: "episode",
        data: createEpisode({
          id: "episode-a-2",
          threadId: threadA.id,
          source: "orchestrator",
          objective: threadA.objective,
          status: "completed",
          artifacts: [sharedArtifactUpdated],
          provenance: {
            executionPath: "direct",
            actor: "orchestrator",
          },
          startedAt: "2026-04-08T09:02:00.000Z",
          completedAt: "2026-04-08T09:02:01.000Z",
        }),
      });
      harness.append({
        kind: "episode",
        data: createEpisode({
          id: "episode-b-1",
          threadId: threadB.id,
          source: "orchestrator",
          objective: threadB.objective,
          status: "completed",
          artifacts: [otherThreadArtifact],
          provenance: {
            executionPath: "direct",
            actor: "orchestrator",
          },
          startedAt: "2026-04-08T09:00:00.000Z",
          completedAt: "2026-04-08T09:00:01.000Z",
        }),
      });

      const state = harness.reconstruct();
      const threadASnapshot = createThreadSnapshot(state, threadA.id);
      const threadBSnapshot = createThreadSnapshot(state, threadB.id);

      expect(state.artifacts.map((artifact) => artifact.id).sort()).toEqual([
        "artifact-other-thread",
        "artifact-shared",
      ]);
      expect(threadASnapshot.episodes.map((episode) => episode.id)).toEqual([
        "episode-a-1",
        "episode-a-2",
      ]);
      expect(threadASnapshot.artifacts).toHaveLength(1);
      expect(threadASnapshot.artifacts[0]?.id).toBe("artifact-shared");
      expect(threadASnapshot.artifacts[0]?.description).toBe("Updated shared diff");
      expect(threadBSnapshot.artifacts.map((artifact) => artifact.id)).toEqual([
        "artifact-other-thread",
      ]);
    });
  });

  it("uses latest file-backed episode artifact references when an episode revision removes an artifact", async () => {
    await withTempWorkspace(async (workspace) => {
      const reportPath = await workspace.write("reports/old-output.log", "old output\n");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/artifact-upsert.jsonl"),
        sessionId: "session-artifact-upsert-fs",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-artifact-upsert-fs",
        kind: "direct",
        objective: "Track artifact references across episode revisions",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:01:00.000Z",
      });
      const artifact = createArtifact({
        id: "artifact-fs-removed",
        kind: "log",
        description: "Artifact from first revision",
        path: reportPath,
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const firstEpisodeRevision = createEpisode({
        id: "episode-fs-artifact-upsert",
        threadId: thread.id,
        source: "orchestrator",
        objective: thread.objective,
        status: "completed",
        artifacts: [artifact],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      });
      const secondEpisodeRevision = createEpisode({
        ...firstEpisodeRevision,
        artifacts: [],
        conclusions: ["Final episode no longer references the prior log artifact."],
        completedAt: "2026-04-08T09:00:02.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({ kind: "episode", data: firstEpisodeRevision });
      harness.append({ kind: "episode", data: secondEpisodeRevision });

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);

      expect(state.artifacts.map((entry) => entry.id)).toEqual([artifact.id]);
      expect(snapshot.episodes).toHaveLength(1);
      expect(snapshot.episodes[0]?.id).toBe(firstEpisodeRevision.id);
      expect(snapshot.episodes[0]?.artifacts).toEqual([]);
      expect(snapshot.artifacts).toEqual([]);
    });
  });
});
