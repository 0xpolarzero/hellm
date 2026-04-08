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
        worktreePath: workspace.path("worktrees/feature"),
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
        artifacts: [artifact],
        verification: [verification],
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
      expect(snapshot.episodes.at(-1)?.smithersRunId).toBe("run-fs");
      expect(snapshot.artifacts[0]?.path).toBe(reportPath);
      expect(snapshot.workflowRuns[0]?.worktreePath).toBe(thread.worktreePath);
      expect(snapshot.alignment.activeWorktreePath).toBe(thread.worktreePath);
      expect(harness.jsonl()).toContain("\"customType\":\"hellm/thread\"");
      expect(harness.jsonl()).toContain("ignore me");
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
});
