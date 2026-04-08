import { appendFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  createEpisode,
  createStructuredSessionEntry,
  createThread,
  createThreadSnapshot,
  parseStructuredEntry,
  parseStructuredSessionEntry,
  serializeStructuredEntry,
  type EpisodeSource,
  type HellmExecutionPath,
} from "@hellm/session-model";
import {
  FileBackedSessionJsonlHarness,
  InMemorySessionJsonlHarness,
  createEpisodeFixture,
  createThreadFixture,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/session-model episode provenance", () => {
  it("preserves provenance for every execution path variant", () => {
    const scenarios: Array<{
      executionPath: HellmExecutionPath;
      actor: EpisodeSource | "orchestrator";
      source: EpisodeSource;
    }> = [
      {
        executionPath: "direct",
        actor: "orchestrator",
        source: "orchestrator",
      },
      {
        executionPath: "pi-worker",
        actor: "pi-worker",
        source: "pi-worker",
      },
      {
        executionPath: "smithers-workflow",
        actor: "smithers",
        source: "smithers",
      },
      {
        executionPath: "verification",
        actor: "verification",
        source: "verification",
      },
      {
        executionPath: "approval",
        actor: "orchestrator",
        source: "orchestrator",
      },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const episode = createEpisode({
        id: `episode-provenance-${index}`,
        threadId: "thread-provenance",
        source: scenario.source,
        objective: `Capture provenance for ${scenario.executionPath}`,
        status: "completed",
        provenance: {
          executionPath: scenario.executionPath,
          actor: scenario.actor,
          sourceRef: `source://${scenario.executionPath}`,
          notes: `created from ${scenario.executionPath}`,
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      });

      expect(episode.provenance).toEqual({
        executionPath: scenario.executionPath,
        actor: scenario.actor,
        sourceRef: `source://${scenario.executionPath}`,
        notes: `created from ${scenario.executionPath}`,
      });
    }
  });

  it("applies last-write-wins provenance when episode ids are rewritten in session reconstruction", () => {
    const harness = new InMemorySessionJsonlHarness({
      sessionId: "session-provenance-upsert",
      cwd: "/repo",
      timestamp: "2026-04-08T09:00:00.000Z",
    });
    const thread = createThreadFixture({
      id: "thread-provenance-upsert",
      objective: "Track provenance updates",
    });
    const initialEpisode = createEpisodeFixture({
      id: "episode-provenance-upsert",
      threadId: thread.id,
      status: "running",
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
        sourceRef: "source://direct-initial",
        notes: "Initial direct provenance.",
      },
    });
    const updatedEpisode = createEpisodeFixture({
      ...initialEpisode,
      status: "waiting_approval",
      provenance: {
        executionPath: "approval",
        actor: "orchestrator",
        sourceRef: "source://approval-updated",
        notes: "Updated during approval pause.",
      },
    });

    harness.append({ kind: "thread", data: thread });
    harness.append({ kind: "episode", data: initialEpisode });
    harness.append({ kind: "episode", data: updatedEpisode });

    const state = harness.reconstruct();
    const snapshot = createThreadSnapshot(state, thread.id);

    expect(state.episodes).toHaveLength(1);
    expect(state.episodes[0]?.provenance).toEqual({
      executionPath: "approval",
      actor: "orchestrator",
      sourceRef: "source://approval-updated",
      notes: "Updated during approval pause.",
    });
    expect(snapshot.episodes).toHaveLength(1);
    expect(snapshot.episodes[0]?.provenance).toEqual({
      executionPath: "approval",
      actor: "orchestrator",
      sourceRef: "source://approval-updated",
      notes: "Updated during approval pause.",
    });
  });

  it("round-trips provenance through serializer/parser helpers for structured episode entries", () => {
    const episode = createEpisode({
      id: "episode-provenance-parser",
      threadId: "thread-provenance-parser",
      source: "pi-worker",
      objective: "Persist parser provenance contract",
      status: "completed",
      provenance: {
        executionPath: "pi-worker",
        actor: "pi-worker",
        sourceRef: "pi-session://entry/42",
        notes: "Captured from parser roundtrip.",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:00:01.000Z",
    });
    const entry = createStructuredSessionEntry({
      id: "entry-provenance-parser",
      parentId: null,
      timestamp: "2026-04-08T09:00:02.000Z",
      payload: { kind: "episode", data: episode },
    });
    const serialized = serializeStructuredEntry(entry);
    const parsedEntry = parseStructuredEntry(serialized);
    const parsedPayload = parseStructuredSessionEntry(
      JSON.parse(serialized) as Record<string, unknown>,
    );

    expect(parsedEntry).not.toBeNull();
    if (!parsedEntry) {
      throw new Error("Structured entry should parse successfully.");
    }

    expect(
      (
        parsedEntry.message.details as {
          kind: "episode";
          data: { provenance: unknown };
        }
      ).data.provenance,
    ).toEqual(episode.provenance);
    expect(parsedPayload).toEqual({
      kind: "episode",
      data: episode,
    });
  });

  it("preserves episode provenance in a real JSONL file roundtrip", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/provenance.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-provenance-file",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-provenance-file",
        kind: "pi-worker",
        objective: "Persist provenance from file-backed sessions",
        status: "completed",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:10.000Z",
      });
      const episode = createEpisode({
        id: "episode-provenance-file",
        threadId: thread.id,
        source: "pi-worker",
        objective: thread.objective,
        status: "completed",
        provenance: {
          executionPath: "pi-worker",
          actor: "pi-worker",
          sourceRef: "pi-session://message/provenance-file",
          notes: "Recovered from a file-backed JSONL stream.",
        },
        startedAt: "2026-04-08T09:00:01.000Z",
        completedAt: "2026-04-08T09:00:09.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({ kind: "episode", data: episode });
      appendFileSync(
        sessionFile,
        `${JSON.stringify({
          type: "message",
          id: "foreign-entry",
          parentId: null,
          timestamp: "2026-04-08T09:00:11.000Z",
          message: {
            role: "assistant",
            content: "ignored",
          },
        })}\n`,
        "utf8",
      );

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);

      expect(snapshot.episodes).toHaveLength(1);
      expect(snapshot.episodes[0]?.provenance).toEqual({
        executionPath: "pi-worker",
        actor: "pi-worker",
        sourceRef: "pi-session://message/provenance-file",
        notes: "Recovered from a file-backed JSONL stream.",
      });
      expect(harness.jsonl()).toContain("pi-session://message/provenance-file");
      expect(harness.jsonl()).toContain("ignored");
    });
  });
});
