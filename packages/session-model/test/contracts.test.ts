import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import {
  canTransitionThreadStatus,
  createArtifact,
  createEmptySessionState,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createStructuredSessionEntry,
  createThread,
  createVerificationRecord,
  parseStructuredEntry,
  parseStructuredSessionEntry,
  serializeStructuredEntry,
  transitionThreadStatus,
} from "@hellm/session-model";

describe("@hellm/session-model contract surface", () => {
  it("materializes the thread model defaults and optional references", () => {
    const thread = createThread({
      id: "thread-contract",
      kind: "smithers-workflow",
      objective: "Persist a full thread reference",
      parentThreadId: "thread-parent",
      inputEpisodeIds: ["episode-a", "episode-b"],
      worktreePath: "/repo/worktrees/feature",
      smithersRunId: "run-123",
      createdAt: "2026-04-08T09:00:00.000Z",
    });

    expect(thread.id).toBe("thread-contract");
    expect(thread.kind).toBe("smithers-workflow");
    expect(thread.status).toBe("pending");
    expect(thread.objective).toBe("Persist a full thread reference");
    expect(thread.parentThreadId).toBe("thread-parent");
    expect(thread.inputEpisodeIds).toEqual(["episode-a", "episode-b"]);
    expect(thread.worktreePath).toBe("/repo/worktrees/feature");
    expect(thread.smithersRunId).toBe("run-123");
    expect(thread.createdAt).toBe("2026-04-08T09:00:00.000Z");
    expect(thread.updatedAt).toBe("2026-04-08T09:00:00.000Z");
  });

  it("enforces the documented thread status lifecycle", () => {
    const thread = createThread({
      id: "thread-1",
      kind: "direct",
      objective: "Test lifecycle",
      status: "running",
      createdAt: "2026-04-08T09:00:00.000Z",
    });

    expect(canTransitionThreadStatus("running", "completed")).toBe(true);
    expect(
      transitionThreadStatus(
        thread,
        "completed",
        "2026-04-08T09:00:01.000Z",
      ).status,
    ).toBe("completed");
    expect(() =>
      transitionThreadStatus(thread, "pending", "2026-04-08T09:00:01.000Z"),
    ).toThrow(/Cannot transition thread/);
  });

  it("preserves artifact, verification, unresolved issue, follow-up, and provenance fields on episodes", () => {
    const artifact = createArtifact({
      id: "artifact-1",
      kind: "file",
      path: "/tmp/demo.txt",
      description: "Changed file",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const verification = createVerificationRecord({
      id: "verification-1",
      kind: "test",
      status: "failed",
      summary: "Unit tests failed",
      artifactIds: [artifact.id],
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const episode = createEpisode({
      id: "episode-1",
      threadId: "thread-1",
      source: "verification",
      objective: "Run verification",
      status: "completed_with_issues",
      conclusions: ["Verification completed with issues"],
      changedFiles: ["/tmp/demo.txt"],
      artifacts: [artifact],
      verification: [verification],
      unresolvedIssues: ["Unit tests still failing"],
      followUpSuggestions: ["Fix the failing tests"],
      provenance: {
        executionPath: "verification",
        actor: "verification",
        notes: "Normalized verification path",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:00:05.000Z",
      inputEpisodeIds: ["episode-0"],
    });

    expect(episode.artifacts[0]?.path).toBe("/tmp/demo.txt");
    expect(episode.verification[0]?.artifactIds).toEqual([artifact.id]);
    expect(episode.unresolvedIssues).toEqual(["Unit tests still failing"]);
    expect(episode.followUpSuggestions).toEqual(["Fix the failing tests"]);
    expect(episode.provenance.executionPath).toBe("verification");
  });

  it("defaults episode list fields and preserves optional provenance metadata", () => {
    const episode = createEpisode({
      id: "episode-defaults",
      threadId: "thread-1",
      source: "orchestrator",
      objective: "Validate defaults",
      status: "running",
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
        sourceRef: "runbook://episode-model",
        notes: "Episode created without optional arrays.",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
    });

    expect(episode.conclusions).toEqual([]);
    expect(episode.changedFiles).toEqual([]);
    expect(episode.artifacts).toEqual([]);
    expect(episode.verification).toEqual([]);
    expect(episode.unresolvedIssues).toEqual([]);
    expect(episode.followUpSuggestions).toEqual([]);
    expect(episode.inputEpisodeIds).toEqual([]);
    expect(episode.provenance.sourceRef).toBe("runbook://episode-model");
    expect(episode.provenance.notes).toBe(
      "Episode created without optional arrays.",
    );
  });

  it("defaults unresolved issues to an empty list when they are omitted", () => {
    const episode = createEpisode({
      id: "episode-default-unresolved",
      threadId: "thread-1",
      source: "orchestrator",
      objective: "No unresolved issues",
      status: "completed",
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:00:01.000Z",
    });

    expect(episode.unresolvedIssues).toEqual([]);
  });

  it("defaults verification artifact links to an empty array when omitted", () => {
    const verification = createVerificationRecord({
      id: "verification-default-artifacts",
      kind: "manual",
      status: "unknown",
      summary: "Manual checks were not run",
      createdAt: "2026-04-08T09:00:00.000Z",
    });

    expect(verification.artifactIds).toEqual([]);
  });

  it("derives global verification status and last-write-per-kind deterministically", () => {
    const olderBuild = createVerificationRecord({
      id: "verification-build-older",
      kind: "build",
      status: "passed",
      summary: "Older build result",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const newerBuild = createVerificationRecord({
      id: "verification-build-newer",
      kind: "build",
      status: "failed",
      summary: "Newer build result",
      createdAt: "2026-04-08T09:01:00.000Z",
    });
    const unknownManual = createVerificationRecord({
      id: "verification-manual",
      kind: "manual",
      status: "unknown",
      summary: "Manual checks pending",
      createdAt: "2026-04-08T09:02:00.000Z",
    });

    const aggregated = createGlobalVerificationState([
      olderBuild,
      newerBuild,
      unknownManual,
    ]);

    expect(aggregated.byKind.build?.id).toBe("verification-build-newer");
    expect(aggregated.byKind.manual?.status).toBe("unknown");
    expect(aggregated.overallStatus).toBe("failed");
    expect(createGlobalVerificationState([olderBuild]).overallStatus).toBe(
      "passed",
    );
    expect(
      createGlobalVerificationState([olderBuild, unknownManual]).overallStatus,
    ).toBe("unknown");
    expect(createGlobalVerificationState().overallStatus).toBe("unknown");
  });

  it("resolves per-kind verification by append order rather than record timestamps", () => {
    const newerTimestamp = createVerificationRecord({
      id: "verification-build-newer-ts",
      kind: "build",
      status: "passed",
      summary: "Built at a newer timestamp",
      createdAt: "2026-04-08T09:10:00.000Z",
    });
    const olderTimestamp = createVerificationRecord({
      id: "verification-build-older-ts",
      kind: "build",
      status: "failed",
      summary: "Appended later but with older timestamp",
      createdAt: "2026-04-08T09:00:00.000Z",
    });

    const aggregated = createGlobalVerificationState([
      newerTimestamp,
      olderTimestamp,
    ]);

    expect(aggregated.byKind.build?.id).toBe("verification-build-older-ts");
    expect(aggregated.overallStatus).toBe("failed");
  });

  it("normalizes session/worktree alignment and empty top-level state defaults", () => {
    const aligned = createSessionWorktreeAlignment({
      sessionCwd: "/repo",
      activeWorktreePath: "/repo",
    });
    const misaligned = createSessionWorktreeAlignment({
      sessionCwd: "/repo",
      activeWorktreePath: "/repo/worktrees/feature-a",
    });
    const empty = createEmptySessionState({
      sessionId: "session-empty",
      sessionCwd: "/repo",
      activeWorktreePath: "/repo/worktrees/feature-a",
    });

    expect(aligned.aligned).toBe(true);
    expect(aligned.reason).toBe("session and worktree are aligned");
    expect(misaligned.aligned).toBe(false);
    expect(misaligned.reason).toMatch(/active worktree differs/);
    expect(empty.sessionCwd).toBe("/repo");
    expect(empty.threads).toEqual([]);
    expect(empty.episodes).toEqual([]);
    expect(empty.artifacts).toEqual([]);
    expect(empty.workflowRuns).toEqual([]);
    expect(empty.smithersIsolations).toEqual([]);
    expect(empty.verification.overallStatus).toBe("unknown");
    expect(empty.alignment.activeWorktreePath).toBe("/repo/worktrees/feature-a");
    expect(empty.alignment.aligned).toBe(false);
  });

  it("marks omitted worktree paths as aligned and resolves non-canonical paths before comparison", () => {
    const withoutActiveWorktree = createSessionWorktreeAlignment({
      sessionCwd: "./repo-root",
    });
    const normalizedAligned = createSessionWorktreeAlignment({
      sessionCwd: "./repo-root/./src/..",
      activeWorktreePath: "./repo-root",
    });

    expect(withoutActiveWorktree.sessionCwd).toBe(resolve("./repo-root"));
    expect(withoutActiveWorktree.activeWorktreePath).toBeUndefined();
    expect(withoutActiveWorktree.aligned).toBe(true);
    expect(withoutActiveWorktree.reason).toBe("session and worktree are aligned");
    expect(normalizedAligned.sessionCwd).toBe(resolve("./repo-root"));
    expect(normalizedAligned.activeWorktreePath).toBe(resolve("./repo-root"));
    expect(normalizedAligned.aligned).toBe(true);
    expect(normalizedAligned.reason).toBe("session and worktree are aligned");
  });

  it("stores structured session entries as pi-style custom messages", () => {
    const thread = createThread({
      id: "thread-1",
      kind: "direct",
      objective: "Persist thread state",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const entry = createStructuredSessionEntry({
      id: "entry-1",
      parentId: null,
      timestamp: "2026-04-08T09:00:01.000Z",
      payload: {
        kind: "thread",
        data: thread,
      },
    });

    expect(entry.type).toBe("message");
    expect(entry.message.role).toBe("custom");
    expect(entry.message.customType).toBe("hellm/thread");
    expect(entry.message.display).toBe(false);
    expect(entry.message.details.kind).toBe("thread");
  });

  it("round-trips structured entries through serializer/parser helpers and ignores foreign custom payloads", () => {
    const thread = createThread({
      id: "thread-parser",
      kind: "direct",
      objective: "Persist parser contract",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const entry = createStructuredSessionEntry({
      id: "entry-parser",
      parentId: null,
      timestamp: "2026-04-08T09:00:01.000Z",
      payload: { kind: "thread", data: thread },
    });

    const serialized = serializeStructuredEntry(entry);
    const parsedFromString = parseStructuredEntry(serialized);
    const parsedPayload = parseStructuredSessionEntry(entry);
    const foreignCustom = parseStructuredSessionEntry({
      ...entry,
      message: {
        ...entry.message,
        customType: "other/thread",
      },
    });

    expect(parsedFromString?.id).toBe(entry.id);
    expect(parsedFromString?.message.customType).toBe("hellm/thread");
    expect(parsedPayload).toEqual({ kind: "thread", data: thread });
    expect(parseStructuredEntry("{not-json")).toBeNull();
    expect(parseStructuredEntry({ type: "session", id: "session-1" })).toBeNull();
    expect(foreignCustom).toBeNull();
  });

  it("preserves thread worktree binding and aligned session metadata", () => {
    const thread = createThread({
      id: "thread-worktree",
      kind: "direct",
      objective: "Keep thread bound to a worktree",
      worktreePath: "/repo/worktrees/feature",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const alignment = createSessionWorktreeAlignment({
      sessionCwd: "/repo/worktrees/feature",
      activeWorktreePath: thread.worktreePath,
    });

    expect(thread.worktreePath).toBe("/repo/worktrees/feature");
    expect(alignment.activeWorktreePath).toBe("/repo/worktrees/feature");
    expect(alignment.aligned).toBe(true);
    expect(alignment.reason).toBe("session and worktree are aligned");
  });

  it("requires file-backed artifacts to carry a path", () => {
    const fileBackedKinds = [
      "file",
      "diff",
      "log",
      "test-report",
      "screenshot",
    ] as const;
    const metadataKinds = ["workflow-run", "note"] as const;

    for (const kind of fileBackedKinds) {
      expect(() =>
        createArtifact({
          id: `artifact-missing-path-${kind}`,
          kind,
          description: "Missing path",
          createdAt: "2026-04-08T09:00:00.000Z",
        }),
      ).toThrow(/requires a file path/);
    }

    for (const kind of metadataKinds) {
      const artifact = createArtifact({
        id: `artifact-metadata-${kind}`,
        kind,
        description: "Metadata-only artifact",
        createdAt: "2026-04-08T09:00:00.000Z",
      });

      expect(artifact.path).toBeUndefined();
    }
  });
});
