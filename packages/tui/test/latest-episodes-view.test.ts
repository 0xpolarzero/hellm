import { describe, expect, it, test } from "bun:test";
import {
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  createThreadSnapshot,
} from "@hellm/session-model";
import {
  FileBackedSessionJsonlHarness,
  VirtualTerminalHarness,
  withTempWorkspace,
} from "@hellm/test-support";
import { projectThreadSnapshot } from "@hellm/tui";

describe("@hellm/tui latest episodes view", () => {
  it("projects only the latest episode details into the episode inspector", () => {
    const thread = createThread({
      id: "thread-latest",
      kind: "direct",
      objective: "Show latest episode details",
      status: "completed",
      createdAt: "2026-04-08T09:00:00.000Z",
      updatedAt: "2026-04-08T09:05:00.000Z",
    });
    const olderEpisode = createEpisode({
      id: "episode-older",
      threadId: thread.id,
      source: "orchestrator",
      objective: thread.objective,
      status: "completed",
      conclusions: ["older conclusion should not be shown"],
      unresolvedIssues: ["older issue should not be shown"],
      followUpSuggestions: ["older follow-up should not be shown"],
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:02:00.000Z",
    });
    const latestEpisode = createEpisode({
      id: "episode-latest",
      threadId: thread.id,
      source: "verification",
      objective: thread.objective,
      status: "completed_with_issues",
      conclusions: ["latest conclusion is visible"],
      unresolvedIssues: ["latest issue is visible"],
      followUpSuggestions: ["latest follow-up is visible"],
      provenance: {
        executionPath: "verification",
        actor: "verification",
      },
      startedAt: "2026-04-08T09:03:00.000Z",
      completedAt: "2026-04-08T09:05:00.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [olderEpisode, latestEpisode],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
    });

    expect(projection.episodeInspector).toContain("episode episode-latest");
    expect(projection.episodeInspector).toContain("source verification");
    expect(projection.episodeInspector).toContain("status completed_with_issues");
    expect(projection.episodeInspector).toContain(
      "conclusion latest conclusion is visible",
    );
    expect(projection.episodeInspector).toContain("issue latest issue is visible");
    expect(projection.episodeInspector).toContain(
      "follow-up latest follow-up is visible",
    );
    expect(projection.episodeInspector).not.toContain(
      "conclusion older conclusion should not be shown",
    );
    expect(projection.episodeInspector).not.toContain(
      "issue older issue should not be shown",
    );
    expect(projection.episodeInspector).not.toContain(
      "follow-up older follow-up should not be shown",
    );
  });

  it("renders the latest episode from reconstructed file-backed JSONL session state", async () => {
    await withTempWorkspace(async (workspace) => {
      const thread = createThread({
        id: "thread-jsonl-latest",
        kind: "smithers-workflow",
        objective: "Render latest episode from file-backed session",
        status: "running",
        createdAt: "2026-04-08T10:00:00.000Z",
        updatedAt: "2026-04-08T10:05:00.000Z",
      });
      const olderEpisode = createEpisode({
        id: "episode-jsonl-older",
        threadId: thread.id,
        source: "smithers",
        objective: thread.objective,
        status: "waiting_approval",
        conclusions: ["older file-backed episode"],
        provenance: {
          executionPath: "smithers-workflow",
          actor: "smithers",
        },
        startedAt: "2026-04-08T10:00:00.000Z",
        completedAt: "2026-04-08T10:02:00.000Z",
      });
      const latestEpisode = createEpisode({
        id: "episode-jsonl-latest",
        threadId: thread.id,
        source: "orchestrator",
        objective: thread.objective,
        status: "completed",
        conclusions: ["latest file-backed episode"],
        followUpSuggestions: ["render this line in the latest episode view"],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T10:03:00.000Z",
        completedAt: "2026-04-08T10:04:00.000Z",
      });
      const rewrittenOlderEpisode = createEpisode({
        ...olderEpisode,
        conclusions: ["older episode rewritten later in the log"],
      });

      const sessionFile = workspace.path(".pi/sessions/latest-episodes.jsonl");
      const session = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-latest-episodes",
        cwd: workspace.root,
      });

      session.append({ kind: "thread", data: thread }, "2026-04-08T10:00:00.000Z");
      session.append(
        { kind: "episode", data: olderEpisode },
        "2026-04-08T10:01:00.000Z",
      );
      session.append(
        { kind: "episode", data: latestEpisode },
        "2026-04-08T10:02:00.000Z",
      );
      session.append(
        { kind: "episode", data: rewrittenOlderEpisode },
        "2026-04-08T10:03:00.000Z",
      );

      const state = session.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);
      const projection = projectThreadSnapshot(snapshot);
      const terminal = new VirtualTerminalHarness(120, 20);
      const viewport = terminal.render(projection);

      expect(snapshot.episodes.map((episode) => episode.id)).toEqual([
        "episode-jsonl-older",
        "episode-jsonl-latest",
      ]);
      expect(projection.episodeInspector).toContain("episode episode-jsonl-latest");
      expect(projection.episodeInspector).toContain(
        "conclusion latest file-backed episode",
      );
      expect(projection.episodeInspector).toContain(
        "follow-up render this line in the latest episode view",
      );
      expect(projection.episodeInspector).not.toContain(
        "conclusion older episode rewritten later in the log",
      );
      expect(viewport).toContain("[episode]");
      expect(viewport).toContain("episode episode-jsonl-latest");
      expect(session.jsonl()).toContain("\"customType\":\"hellm/episode\"");
    });
  });

  it("falls back to an empty latest episode view when no episodes exist", () => {
    const thread = createThread({
      id: "thread-no-episodes",
      kind: "direct",
      objective: "No episodes available",
      status: "running",
      createdAt: "2026-04-08T11:00:00.000Z",
      updatedAt: "2026-04-08T11:00:00.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
    });

    expect(projection.episodeInspector).toEqual(["episode none"]);
  });

  test.todo(
    "renders multiple recent episodes in a dedicated latest-episodes list view while keeping the inspector focused on one selected episode",
    () => {},
  );
});
