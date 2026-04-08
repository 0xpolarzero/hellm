import { appendFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createSessionWorktreeAlignment,
  createThread,
  createThreadSnapshot,
  createVerificationRecord,
  parseStructuredSessionEntry,
  transitionThreadStatus,
} from "@hellm/session-model";
import {
  FileBackedSessionJsonlHarness,
  runBunModule,
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

  it("persists unresolved issue clearance when an episode is rewritten in a real JSONL file", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/unresolved-rewrite.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-unresolved-rewrite",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-unresolved-rewrite",
        kind: "direct",
        objective: "Resolve previously unresolved issues",
        status: "completed",
        createdAt: "2026-04-08T11:00:00.000Z",
        updatedAt: "2026-04-08T11:05:00.000Z",
      });
      const initialEpisode = createEpisode({
        id: "episode-unresolved-rewrite",
        threadId: thread.id,
        source: "orchestrator",
        objective: thread.objective,
        status: "completed_with_issues",
        conclusions: ["Initial run completed with unresolved issues."],
        unresolvedIssues: ["Need product-owner confirmation."],
        followUpSuggestions: ["Ask the product owner for confirmation."],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
          notes: "Initial unresolved state.",
        },
        startedAt: "2026-04-08T11:00:00.000Z",
        completedAt: "2026-04-08T11:01:00.000Z",
      });
      const resolvedEpisode = createEpisode({
        ...initialEpisode,
        status: "completed",
        conclusions: ["Follow-up completed and unresolved issues cleared."],
        unresolvedIssues: [],
        followUpSuggestions: [],
        completedAt: "2026-04-08T11:05:00.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({ kind: "episode", data: initialEpisode });
      harness.append({ kind: "episode", data: resolvedEpisode });

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);

      expect(state.episodes).toHaveLength(1);
      expect(state.episodes[0]?.id).toBe("episode-unresolved-rewrite");
      expect(state.episodes[0]?.unresolvedIssues).toEqual([]);
      expect(state.episodes[0]?.followUpSuggestions).toEqual([]);
      expect(snapshot.episodes[0]?.unresolvedIssues).toEqual([]);
      expect(harness.jsonl()).toContain("\"unresolvedIssues\":[]");
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

  it("keeps episode verification records stable when later standalone records reuse the same id", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/verification-divergence.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-verification-divergence",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-verification-divergence",
        kind: "verification",
        objective: "Track episode verification immutability",
        status: "completed",
        createdAt: "2026-04-08T10:00:00.000Z",
        updatedAt: "2026-04-08T10:05:00.000Z",
      });
      const episodeRecord = createVerificationRecord({
        id: "verification-shared-id",
        kind: "test",
        status: "failed",
        summary: "Episode-local test result failed",
        createdAt: "2026-04-08T10:00:01.000Z",
      });
      const episode = createEpisode({
        id: "episode-verification-divergence",
        threadId: thread.id,
        source: "verification",
        objective: "Verification run",
        status: "completed_with_issues",
        verification: [episodeRecord],
        provenance: {
          executionPath: "verification",
          actor: "verification",
        },
        startedAt: "2026-04-08T10:00:00.000Z",
        completedAt: "2026-04-08T10:05:00.000Z",
      });
      const laterStandaloneRecord = createVerificationRecord({
        id: "verification-shared-id",
        kind: "test",
        status: "passed",
        summary: "Standalone correction marked tests as passed",
        createdAt: "2026-04-08T10:06:00.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({ kind: "episode", data: episode });
      harness.append({ kind: "verification", data: laterStandaloneRecord });

      const reconstructed = harness.reconstruct();
      const reconstructedEpisode = reconstructed.episodes.find(
        (candidate) => candidate.id === episode.id,
      );

      expect(reconstructedEpisode?.verification).toEqual([episodeRecord]);
      expect(reconstructed.verification.byKind.test?.id).toBe("verification-shared-id");
      expect(reconstructed.verification.byKind.test?.status).toBe("passed");
      expect(reconstructed.verification.overallStatus).toBe("passed");
    });
  });

  it("prefers explicit global verification snapshot from real JSONL over later conflicting records", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/verification-snapshot.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-verification-snapshot-fs",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-verification-snapshot-fs",
        kind: "verification",
        objective: "Preserve explicit global verification snapshot",
        status: "completed",
        createdAt: "2026-04-08T11:00:00.000Z",
        updatedAt: "2026-04-08T11:05:00.000Z",
      });
      const buildPassed = createVerificationRecord({
        id: "verification-build-passed-fs",
        kind: "build",
        status: "passed",
        summary: "Build passed",
        createdAt: "2026-04-08T11:00:01.000Z",
      });
      const testFailed = createVerificationRecord({
        id: "verification-test-failed-fs",
        kind: "test",
        status: "failed",
        summary: "Tests failed",
        createdAt: "2026-04-08T11:05:00.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({
        kind: "verification",
        data: {
          overallStatus: "passed",
          byKind: { build: buildPassed },
        },
      });
      harness.append({ kind: "verification", data: testFailed });

      const reconstructed = harness.reconstruct();

      expect(reconstructed.verification.overallStatus).toBe("passed");
      expect(reconstructed.verification.byKind.build?.id).toBe(
        "verification-build-passed-fs",
      );
      expect(reconstructed.verification.byKind.test).toBeUndefined();
    });
  });

  it("keeps the latest persisted alignment snapshot and normalized paths in a real JSONL session file", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/alignment-updates.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-alignment-updates",
        cwd: workspace.root,
      });

      harness.append({
        kind: "alignment",
        data: createSessionWorktreeAlignment({
          sessionCwd: `${workspace.root}/nested/..`,
          activeWorktreePath: workspace.path("worktrees/feature-a"),
        }),
      });
      harness.append({
        kind: "alignment",
        data: createSessionWorktreeAlignment({
          sessionCwd: `${workspace.root}/nested/..`,
          activeWorktreePath: `${workspace.root}/./`,
        }),
      });

      const alignmentEntries = harness
        .lines()
        .filter(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "type" in entry &&
            entry.type === "message" &&
            "message" in entry &&
            typeof entry.message === "object" &&
            entry.message !== null &&
            "customType" in entry.message &&
            entry.message.customType === "hellm/alignment",
        );
      const reconstructed = harness.reconstruct();

      expect(alignmentEntries).toHaveLength(2);
      expect(reconstructed.alignment.sessionCwd).toBe(workspace.root);
      expect(reconstructed.alignment.activeWorktreePath).toBe(workspace.root);
      expect(reconstructed.alignment.aligned).toBe(true);
      expect(reconstructed.alignment.reason).toBe("session and worktree are aligned");
    });
  });

  it("ignores malformed hellm custom entries in a real JSONL file while preserving valid state", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/malformed-custom.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-malformed-custom",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-malformed-custom",
        kind: "direct",
        objective: "Ignore malformed custom entries",
        status: "completed",
        createdAt: "2026-04-08T11:00:00.000Z",
        updatedAt: "2026-04-08T11:00:05.000Z",
      });
      const episode = createEpisode({
        id: "episode-malformed-custom",
        threadId: thread.id,
        source: "orchestrator",
        objective: thread.objective,
        status: "completed",
        conclusions: ["Valid state is preserved."],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T11:00:00.000Z",
        completedAt: "2026-04-08T11:00:05.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({ kind: "episode", data: episode });
      appendFileSync(
        sessionFile,
        `${JSON.stringify({
          type: "message",
          id: "entry-malformed-no-details",
          parentId: null,
          timestamp: "2026-04-08T11:00:06.000Z",
          message: {
            role: "custom",
            customType: "hellm/thread",
            content: "hellm:thread",
            display: false,
            timestamp: Date.parse("2026-04-08T11:00:06.000Z"),
          },
        })}\n${JSON.stringify({
          type: "message",
          id: "entry-malformed-no-data",
          parentId: "entry-malformed-no-details",
          timestamp: "2026-04-08T11:00:07.000Z",
          message: {
            role: "custom",
            customType: "hellm/thread",
            content: "hellm:thread",
            display: false,
            details: { kind: "thread" },
            timestamp: Date.parse("2026-04-08T11:00:07.000Z"),
          },
        })}\n${JSON.stringify({
          type: "message",
          id: "entry-unknown-kind",
          parentId: "entry-malformed-no-data",
          timestamp: "2026-04-08T11:00:08.000Z",
          message: {
            role: "custom",
            customType: "hellm/future",
            content: "hellm:future",
            display: false,
            details: {
              kind: "future",
              data: { id: "future-1", note: "ignore until supported" },
            },
            timestamp: Date.parse("2026-04-08T11:00:08.000Z"),
          },
        })}\n`,
        "utf8",
      );

      const reconstructed = harness.reconstruct();
      const snapshot = createThreadSnapshot(reconstructed, thread.id);

      expect(reconstructed.sessionId).toBe("session-malformed-custom");
      expect(reconstructed.threads).toEqual([thread]);
      expect(reconstructed.episodes).toEqual([episode]);
      expect(reconstructed.artifacts).toEqual([]);
      expect(snapshot.thread.id).toBe(thread.id);
      expect(snapshot.episodes).toEqual([episode]);
      expect(snapshot.artifacts).toEqual([]);
    });
  });

  it("persists a full thread lifecycle timeline in JSONL and reconstructs the latest status", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/thread-lifecycle.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-thread-lifecycle",
        cwd: workspace.root,
      });

      let thread = createThread({
        id: "thread-lifecycle-fs",
        kind: "direct",
        objective: "Execute lifecycle transitions",
        parentThreadId: "thread-parent",
        inputEpisodeIds: ["episode-1", "episode-2"],
        worktreePath: workspace.path("worktrees/lifecycle"),
        createdAt: "2026-04-08T11:00:00.000Z",
        updatedAt: "2026-04-08T11:00:00.000Z",
      });

      harness.append(
        { kind: "thread", data: thread },
        "2026-04-08T11:00:00.000Z",
      );
      thread = transitionThreadStatus(
        thread,
        "running",
        "2026-04-08T11:00:01.000Z",
      );
      harness.append(
        { kind: "thread", data: thread },
        "2026-04-08T11:00:01.000Z",
      );
      thread = transitionThreadStatus(
        thread,
        "waiting_input",
        "2026-04-08T11:00:02.000Z",
      );
      harness.append(
        { kind: "thread", data: thread },
        "2026-04-08T11:00:02.000Z",
      );
      thread = transitionThreadStatus(
        thread,
        "running",
        "2026-04-08T11:00:03.000Z",
      );
      harness.append(
        { kind: "thread", data: thread },
        "2026-04-08T11:00:03.000Z",
      );
      thread = transitionThreadStatus(
        thread,
        "completed",
        "2026-04-08T11:00:04.000Z",
      );
      harness.append(
        { kind: "thread", data: thread },
        "2026-04-08T11:00:04.000Z",
      );

      expect(() =>
        transitionThreadStatus(
          thread,
          "running",
          "2026-04-08T11:00:05.000Z",
        ),
      ).toThrow(
        "Cannot transition thread thread-lifecycle-fs from completed to running.",
      );

      const lifecycleStatuses = harness
        .lines()
        .flatMap((entry) => {
          const payload = parseStructuredSessionEntry(entry);
          return payload?.kind === "thread" ? [payload.data.status] : [];
        });

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);

      expect(lifecycleStatuses).toEqual([
        "pending",
        "running",
        "waiting_input",
        "running",
        "completed",
      ]);
      expect(state.threads).toHaveLength(1);
      expect(snapshot.thread.status).toBe("completed");
      expect(snapshot.thread.updatedAt).toBe("2026-04-08T11:00:04.000Z");
      expect(snapshot.thread.createdAt).toBe("2026-04-08T11:00:00.000Z");
      expect(snapshot.thread.parentThreadId).toBe("thread-parent");
      expect(snapshot.thread.inputEpisodeIds).toEqual(["episode-1", "episode-2"]);
      expect(snapshot.thread.worktreePath).toBe(
        workspace.path("worktrees/lifecycle"),
      );
      expect(snapshot.episodes).toEqual([]);
      expect(harness.jsonl()).toContain("\"status\":\"waiting_input\"");
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

  it("keeps historical artifacts in session state but prunes stale artifact references from a thread snapshot after an episode upsert", async () => {
    await withTempWorkspace(async (workspace) => {
      const stalePath = await workspace.write("reports/stale.log", "stale\n");
      const freshPath = await workspace.write("reports/fresh.log", "fresh\n");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/artifact-pruning.jsonl"),
        sessionId: "session-artifact-pruning",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-artifact-pruning",
        kind: "direct",
        objective: "Track latest artifact references",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:01:00.000Z",
      });
      const staleArtifact = createArtifact({
        id: "artifact-stale",
        kind: "log",
        description: "Stale artifact from the first episode write",
        path: stalePath,
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const freshArtifactInitial = createArtifact({
        id: "artifact-fresh",
        kind: "log",
        description: "Initial fresh artifact metadata",
        path: freshPath,
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const freshArtifactUpdated = createArtifact({
        id: "artifact-fresh",
        kind: "log",
        description: "Updated fresh artifact metadata",
        path: freshPath,
        createdAt: "2026-04-08T09:00:02.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({
        kind: "episode",
        data: createEpisode({
          id: "episode-artifact-pruning",
          threadId: thread.id,
          source: "orchestrator",
          objective: thread.objective,
          status: "running",
          artifacts: [staleArtifact, freshArtifactInitial],
          provenance: {
            executionPath: "direct",
            actor: "orchestrator",
          },
          startedAt: "2026-04-08T09:00:00.000Z",
        }),
      });
      harness.append({
        kind: "episode",
        data: createEpisode({
          id: "episode-artifact-pruning",
          threadId: thread.id,
          source: "orchestrator",
          objective: thread.objective,
          status: "completed",
          artifacts: [freshArtifactUpdated],
          provenance: {
            executionPath: "direct",
            actor: "orchestrator",
          },
          startedAt: "2026-04-08T09:00:00.000Z",
          completedAt: "2026-04-08T09:00:03.000Z",
        }),
      });

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);

      expect(state.artifacts.map((artifact) => artifact.id).sort()).toEqual([
        "artifact-fresh",
        "artifact-stale",
      ]);
      expect(snapshot.artifacts.map((artifact) => artifact.id)).toEqual([
        "artifact-fresh",
      ]);
      expect(snapshot.artifacts[0]?.description).toBe(
        "Updated fresh artifact metadata",
      );
    });
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

  it("ignores malformed hellm custom entries while reconstructing top-level session state", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/malformed.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-malformed",
        cwd: workspace.root,
      });
      const validThread = createThread({
        id: "thread-valid",
        kind: "direct",
        objective: "Preserve valid state despite malformed custom entries",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:01.000Z",
      });

      harness.append({ kind: "thread", data: validThread });
      appendFileSync(
        sessionFile,
        `${JSON.stringify({
          type: "message",
          id: "malformed-missing-data",
          parentId: null,
          timestamp: "2026-04-08T09:00:02.000Z",
          message: {
            role: "custom",
            customType: "hellm/thread",
            content: "hellm:thread",
            display: false,
            details: { kind: "thread" },
            timestamp: Date.parse("2026-04-08T09:00:02.000Z"),
          },
        })}\n`,
        "utf8",
      );
      appendFileSync(
        sessionFile,
        `${JSON.stringify({
          type: "message",
          id: "malformed-unknown-kind",
          parentId: null,
          timestamp: "2026-04-08T09:00:03.000Z",
          message: {
            role: "custom",
            customType: "hellm/unknown",
            content: "hellm:unknown",
            display: false,
            details: { kind: "unknown-kind", data: { x: 1 } },
            timestamp: Date.parse("2026-04-08T09:00:03.000Z"),
          },
        })}\n`,
        "utf8",
      );

      const state = harness.reconstruct();

      expect(state.sessionId).toBe("session-malformed");
      expect(state.threads).toEqual([validThread]);
      expect(state.episodes).toEqual([]);
      expect(state.artifacts).toEqual([]);
      expect(state.workflowRuns).toEqual([]);
      expect(state.smithersIsolations).toEqual([]);
      expect(state.verification.overallStatus).toBe("unknown");
    });
  });

  it("maintains JSONL parentId chaining and state reconstruction across real process boundaries", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/multi-process.jsonl");
      const repoRoot = process.cwd().replaceAll("\\", "/");
      const writerScript = await workspace.write(
        "scripts/session-writer.ts",
        `
import { createEpisode, createThread } from "${repoRoot}/packages/session-model/src/index.ts";
import { FileBackedSessionJsonlHarness } from "${repoRoot}/test-support/session-jsonl.ts";

const [filePath, cwd, mode] = process.argv.slice(2);

if (!filePath || !cwd || !mode) {
  console.error("Expected filePath, cwd, and mode arguments.");
  process.exit(2);
}

const harness = new FileBackedSessionJsonlHarness({
  filePath,
  sessionId: "session-process-boundary",
  cwd,
  timestamp: "2026-04-08T09:00:00.000Z",
});

if (mode === "thread") {
  harness.append(
    {
      kind: "thread",
      data: createThread({
        id: "thread-process",
        kind: "direct",
        objective: "Cross-process JSONL append",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:01.000Z",
      }),
    },
    "2026-04-08T09:00:01.000Z",
  );
  process.exit(0);
}

if (mode === "episode") {
  harness.append(
    {
      kind: "episode",
      data: createEpisode({
        id: "episode-process",
        threadId: "thread-process",
        source: "orchestrator",
        objective: "Cross-process JSONL append",
        status: "completed",
        conclusions: ["Second process appended episode state."],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T09:00:02.000Z",
        completedAt: "2026-04-08T09:00:03.000Z",
      }),
    },
    "2026-04-08T09:00:03.000Z",
  );
  process.exit(0);
}

console.error("Unknown mode.");
process.exit(2);
`,
      );

      const firstRun = runBunModule({
        entryPath: writerScript,
        cwd: process.cwd(),
        args: [sessionFile, workspace.root, "thread"],
      });
      const secondRun = runBunModule({
        entryPath: writerScript,
        cwd: process.cwd(),
        args: [sessionFile, workspace.root, "episode"],
      });

      expect(firstRun.exitCode).toBe(0);
      expect(firstRun.stderr).toBe("");
      expect(secondRun.exitCode).toBe(0);
      expect(secondRun.stderr).toBe("");

      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        cwd: workspace.root,
      });
      const structuredEntries = harness
        .lines()
        .filter(
          (entry): entry is { type: "message"; id: string; parentId: string | null } =>
            typeof entry === "object" &&
            entry !== null &&
            "type" in entry &&
            entry.type === "message" &&
            "id" in entry &&
            typeof entry.id === "string",
        );
      const [threadEntry, episodeEntry] = structuredEntries;
      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, "thread-process");

      expect(structuredEntries).toHaveLength(2);
      expect(episodeEntry?.parentId).toBe(threadEntry?.id);
      expect(state.sessionId).toBe("session-process-boundary");
      expect(state.threads.map((thread) => thread.id)).toEqual(["thread-process"]);
      expect(state.episodes.map((episode) => episode.id)).toEqual(["episode-process"]);
      expect(snapshot.thread.status).toBe("running");
      expect(snapshot.episodes[0]?.status).toBe("completed");
      expect(snapshot.episodes[0]?.conclusions).toEqual([
        "Second process appended episode state.",
      ]);
    });
  });

  it("round-trips every thread kind and preserves optional thread metadata in file-backed JSONL", async () => {
    await withTempWorkspace(async (workspace) => {
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/thread-kinds.jsonl"),
        sessionId: "session-thread-kinds",
        cwd: workspace.root,
      });
      const timestamps = [
        "2026-04-08T09:00:00.000Z",
        "2026-04-08T09:01:00.000Z",
        "2026-04-08T09:02:00.000Z",
        "2026-04-08T09:03:00.000Z",
        "2026-04-08T09:04:00.000Z",
      ] as const;
      const threads = [
        createThread({
          id: "thread-kind-direct",
          kind: "direct",
          objective: "Direct path thread",
          inputEpisodeIds: ["episode-direct"],
          createdAt: timestamps[0],
        }),
        createThread({
          id: "thread-kind-pi",
          kind: "pi-worker",
          objective: "Pi worker thread",
          status: "running",
          worktreePath: workspace.path("worktrees/pi"),
          createdAt: timestamps[1],
          updatedAt: timestamps[2],
        }),
        createThread({
          id: "thread-kind-smithers",
          kind: "smithers-workflow",
          objective: "Smithers workflow thread",
          status: "waiting_approval",
          parentThreadId: "thread-kind-direct",
          inputEpisodeIds: ["episode-shared"],
          worktreePath: workspace.path("worktrees/smithers"),
          smithersRunId: "run-thread-kind-smithers",
          createdAt: timestamps[2],
          updatedAt: timestamps[3],
        }),
        createThread({
          id: "thread-kind-verify",
          kind: "verification",
          objective: "Verification thread",
          status: "completed",
          createdAt: timestamps[3],
          updatedAt: timestamps[4],
        }),
        createThread({
          id: "thread-kind-approval",
          kind: "approval",
          objective: "Approval thread",
          status: "waiting_input",
          parentThreadId: "thread-kind-smithers",
          createdAt: timestamps[4],
        }),
      ];

      for (const thread of threads) {
        harness.append({ kind: "thread", data: thread });
      }

      const state = harness.reconstruct();

      expect(state.threads).toHaveLength(threads.length);
      expect(state.threads).toEqual(threads);
      for (const thread of threads) {
        expect(createThreadSnapshot(state, thread.id).thread).toEqual(thread);
      }
      expect(harness.jsonl()).toContain("\"customType\":\"hellm/thread\"");
    });
  });
});
