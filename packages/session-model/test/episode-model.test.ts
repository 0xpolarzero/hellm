import { describe, expect, it } from "bun:test";
import {
  createEpisode,
  createThread,
  createThreadSnapshot,
  type EpisodeSource,
  type EpisodeStatus,
} from "@hellm/session-model";
import { FileBackedSessionJsonlHarness, withTempWorkspace } from "@hellm/test-support";

const ALL_EPISODE_STATUSES = [
  "completed",
  "completed_with_issues",
  "waiting_input",
  "waiting_approval",
  "blocked",
  "failed",
  "cancelled",
] as const satisfies readonly EpisodeStatus[];

const ALL_EPISODE_SOURCES = [
  "orchestrator",
  "pi-worker",
  "smithers",
  "verification",
] as const satisfies readonly EpisodeSource[];

describe("@hellm/session-model episode model", () => {
  it("supports every documented episode source/status combination", () => {
    for (const source of ALL_EPISODE_SOURCES) {
      for (const status of ALL_EPISODE_STATUSES) {
        const episode = createEpisode({
          id: `episode-${source}-${status}`,
          threadId: "thread-episode-model",
          source,
          objective: `Exercise ${source}/${status}`,
          status,
          provenance: {
            executionPath: source === "verification" ? "verification" : "direct",
            actor: source === "orchestrator" ? "orchestrator" : source,
          },
          startedAt: "2026-04-08T09:00:00.000Z",
        });

        expect(episode.source).toBe(source);
        expect(episode.status).toBe(status);
        expect(episode.completedAt).toBeUndefined();
        expect(episode.inputEpisodeIds).toEqual([]);
      }
    }
  });

  it("reconstructs duplicate episode ids from a real JSONL session file using last-write-wins semantics", async () => {
    await withTempWorkspace(async (workspace) => {
      const thread = createThread({
        id: "thread-episode-upsert-fs",
        kind: "direct",
        objective: "Validate episode upsert semantics in file-backed sessions",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:01.000Z",
      });
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/episode-upsert.jsonl"),
        sessionId: "session-episode-upsert-fs",
        cwd: workspace.root,
      });

      harness.append({ kind: "thread", data: thread }, "2026-04-08T09:00:01.000Z");
      harness.append(
        {
          kind: "episode",
          data: createEpisode({
            id: "episode-upsert-fs",
            threadId: thread.id,
            source: "orchestrator",
            objective: "Initial write",
            status: "waiting_input",
            conclusions: ["Awaiting user reply."],
            unresolvedIssues: ["Need clarification"],
            provenance: {
              executionPath: "approval",
              actor: "orchestrator",
            },
            startedAt: "2026-04-08T09:00:02.000Z",
            inputEpisodeIds: ["episode-seed"],
          }),
        },
        "2026-04-08T09:00:02.000Z",
      );
      harness.append(
        {
          kind: "episode",
          data: createEpisode({
            id: "episode-upsert-fs",
            threadId: thread.id,
            source: "orchestrator",
            objective: "Final write",
            status: "completed_with_issues",
            conclusions: ["Clarification incorporated, with follow-up still needed."],
            unresolvedIssues: ["Follow-up action remains"],
            followUpSuggestions: ["Run the requested verification checks."],
            provenance: {
              executionPath: "direct",
              actor: "orchestrator",
            },
            startedAt: "2026-04-08T09:00:02.000Z",
            completedAt: "2026-04-08T09:00:05.000Z",
            inputEpisodeIds: ["episode-seed", "episode-context"],
          }),
        },
        "2026-04-08T09:00:05.000Z",
      );

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);

      expect(state.episodes).toHaveLength(1);
      expect(state.episodes[0]?.id).toBe("episode-upsert-fs");
      expect(state.episodes[0]?.objective).toBe("Final write");
      expect(state.episodes[0]?.status).toBe("completed_with_issues");
      expect(state.episodes[0]?.completedAt).toBe("2026-04-08T09:00:05.000Z");
      expect(state.episodes[0]?.inputEpisodeIds).toEqual([
        "episode-seed",
        "episode-context",
      ]);
      expect(state.episodes[0]?.followUpSuggestions).toEqual([
        "Run the requested verification checks.",
      ]);
      expect(snapshot.episodes).toHaveLength(1);
      expect(snapshot.episodes[0]).toEqual(state.episodes[0]);
    });
  });
});
