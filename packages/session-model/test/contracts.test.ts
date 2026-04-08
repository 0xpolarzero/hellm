import { describe, expect, it } from "bun:test";
import {
  canTransitionThreadStatus,
  createArtifact,
  createEpisode,
  createStructuredSessionEntry,
  createThread,
  createVerificationRecord,
  transitionThreadStatus,
} from "@hellm/session-model";

describe("@hellm/session-model contract surface", () => {
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

  it("requires file-backed artifacts to carry a path", () => {
    expect(() =>
      createArtifact({
        id: "artifact-2",
        kind: "file",
        description: "Missing path",
        createdAt: "2026-04-08T09:00:00.000Z",
      }),
    ).toThrow(/requires a file path/);
  });
});
