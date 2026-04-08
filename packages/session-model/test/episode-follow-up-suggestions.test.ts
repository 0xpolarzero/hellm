import { describe, expect, it } from "bun:test";
import {
  createEpisode,
  createThread,
  createThreadSnapshot,
} from "@hellm/session-model";
import {
  FileBackedSessionJsonlHarness,
  InMemorySessionJsonlHarness,
  withTempWorkspace,
} from "@hellm/test-support";

describe("state.episodeFollowUpSuggestions", () => {
  it("round-trips follow-up suggestions through in-memory JSONL reconstruction", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-follow-up-memory",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const thread = createThread({
      id: "thread-follow-up",
      kind: "direct",
      objective: "Preserve follow-up suggestions",
      status: "completed",
      createdAt: "2026-04-08T09:00:00.000Z",
      updatedAt: "2026-04-08T09:00:03.000Z",
    });
    const followUps = [
      "Review generated diff for edge-case handling.",
      "Run targeted tests before merging.",
      "Attach verification artifacts to the episode.",
    ];
    const episode = createEpisode({
      id: "episode-follow-up",
      threadId: thread.id,
      source: "orchestrator",
      objective: thread.objective,
      status: "completed_with_issues",
      followUpSuggestions: followUps,
      unresolvedIssues: ["Pending final verification pass."],
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:00:03.000Z",
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: episode });

    const state = harness.reconstruct();
    const snapshot = createThreadSnapshot(state, thread.id);

    expect(state.episodes).toHaveLength(1);
    expect(state.episodes[0]?.followUpSuggestions).toEqual(followUps);
    expect(state.episodes[0]?.unresolvedIssues).toEqual([
      "Pending final verification pass.",
    ]);
    expect(snapshot.episodes).toHaveLength(1);
    expect(snapshot.episodes[0]?.followUpSuggestions).toEqual(followUps);
  });

  it("applies last-write-wins semantics when a later episode clears follow-up suggestions", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-follow-up-upsert",
      cwd: "/repo",
      timestamp: "2026-04-08T10:00:00.000Z",
    });
    const thread = createThread({
      id: "thread-follow-up-upsert",
      kind: "verification",
      objective: "Keep latest follow-up list",
      status: "completed",
      createdAt: "2026-04-08T10:00:00.000Z",
      updatedAt: "2026-04-08T10:00:03.000Z",
    });
    const initial = createEpisode({
      id: "episode-follow-up-upsert",
      threadId: thread.id,
      source: "verification",
      objective: thread.objective,
      status: "completed_with_issues",
      followUpSuggestions: [
        "Fix lint errors.",
        "Re-run verification.",
      ],
      provenance: {
        executionPath: "verification",
        actor: "verification",
      },
      startedAt: "2026-04-08T10:00:00.000Z",
      completedAt: "2026-04-08T10:00:01.000Z",
    });
    const updated = createEpisode({
      ...initial,
      status: "completed",
      followUpSuggestions: [],
      completedAt: "2026-04-08T10:00:03.000Z",
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: initial });
    harness.append({ kind: "episode", data: updated });

    const state = harness.reconstruct();

    expect(state.episodes).toHaveLength(1);
    expect(state.episodes[0]?.id).toBe(initial.id);
    expect(state.episodes[0]?.status).toBe("completed");
    expect(state.episodes[0]?.followUpSuggestions).toEqual([]);
  });

  it("persists follow-up suggestions across a real file-backed JSONL session roundtrip", async () => {
    await withTempWorkspace(async (workspace) => {
      const filePath = workspace.path(".pi/sessions/follow-up.jsonl");
      const thread = createThread({
        id: "thread-follow-up-fs",
        kind: "smithers-workflow",
        objective: "Persist follow-up suggestions through filesystem",
        status: "waiting_approval",
        createdAt: "2026-04-08T11:00:00.000Z",
        updatedAt: "2026-04-08T11:00:02.000Z",
      });
      const initialEpisode = createEpisode({
        id: "episode-follow-up-fs",
        threadId: thread.id,
        source: "smithers",
        objective: thread.objective,
        status: "waiting_approval",
        followUpSuggestions: [
          "Approve the workflow to continue.",
          "If denied, add rationale in the next episode.",
        ],
        provenance: {
          executionPath: "smithers-workflow",
          actor: "smithers",
        },
        startedAt: "2026-04-08T11:00:00.000Z",
        completedAt: "2026-04-08T11:00:01.000Z",
      });
      const updatedEpisode = createEpisode({
        ...initialEpisode,
        followUpSuggestions: [
          "Approval received, proceed with the queued changes.",
        ],
        status: "completed",
        completedAt: "2026-04-08T11:00:02.000Z",
      });

      const writer = new FileBackedSessionJsonlHarness({
        filePath,
        sessionId: "session-follow-up-fs",
        cwd: workspace.root,
        timestamp: "2026-04-08T11:00:00.000Z",
      });
      writer.append({ kind: "thread", data: thread });
      writer.append({ kind: "episode", data: initialEpisode });

      const reloaded = new FileBackedSessionJsonlHarness({
        filePath,
        sessionId: "session-follow-up-fs",
        cwd: workspace.root,
        timestamp: "2026-04-08T11:00:00.000Z",
      });
      reloaded.append({ kind: "episode", data: updatedEpisode });

      const state = reloaded.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);

      expect(state.episodes).toHaveLength(1);
      expect(state.episodes[0]?.followUpSuggestions).toEqual([
        "Approval received, proceed with the queued changes.",
      ]);
      expect(snapshot.episodes).toHaveLength(1);
      expect(snapshot.episodes[0]?.followUpSuggestions).toEqual([
        "Approval received, proceed with the queued changes.",
      ]);
      expect(reloaded.jsonl()).toContain("\"followUpSuggestions\"");
    });
  });

  it("keeps follow-up suggestions scoped to their owning thread snapshots", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-follow-up-snapshot",
      cwd: "/repo",
      timestamp: "2026-04-08T12:00:00.000Z",
    });
    const threadA = createThread({
      id: "thread-a-follow-up",
      kind: "direct",
      objective: "Thread A",
      status: "completed",
      createdAt: "2026-04-08T12:00:00.000Z",
      updatedAt: "2026-04-08T12:00:02.000Z",
    });
    const threadB = createThread({
      id: "thread-b-follow-up",
      kind: "direct",
      objective: "Thread B",
      status: "completed",
      createdAt: "2026-04-08T12:00:00.000Z",
      updatedAt: "2026-04-08T12:00:02.000Z",
    });

    harness.append({ kind: "thread", data: threadA });
    harness.append({ kind: "thread", data: threadB });
    harness.append({
      kind: "episode",
      data: createEpisode({
        id: "episode-a-follow-up",
        threadId: threadA.id,
        source: "orchestrator",
        objective: threadA.objective,
        status: "completed_with_issues",
        followUpSuggestions: ["Apply reviewer feedback on thread A."],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T12:00:00.000Z",
        completedAt: "2026-04-08T12:00:01.000Z",
      }),
    });
    harness.append({
      kind: "episode",
      data: createEpisode({
        id: "episode-b-follow-up",
        threadId: threadB.id,
        source: "orchestrator",
        objective: threadB.objective,
        status: "completed_with_issues",
        followUpSuggestions: ["Collect approval from thread B owner."],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T12:00:00.000Z",
        completedAt: "2026-04-08T12:00:01.000Z",
      }),
    });

    const state = harness.reconstruct();
    const snapshotA = createThreadSnapshot(state, threadA.id);
    const snapshotB = createThreadSnapshot(state, threadB.id);

    expect(snapshotA.episodes.map((episode) => episode.followUpSuggestions)).toEqual([
      ["Apply reviewer feedback on thread A."],
    ]);
    expect(snapshotB.episodes.map((episode) => episode.followUpSuggestions)).toEqual([
      ["Collect approval from thread B owner."],
    ]);
  });
});
