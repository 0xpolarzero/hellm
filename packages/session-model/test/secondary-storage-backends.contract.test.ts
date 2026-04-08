import { describe, expect, it, test } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createSessionHeader,
  createSessionWorktreeAlignment,
  createStructuredSessionEntry,
  createThread,
  createVerificationRecord,
  reconstructSessionState,
  type SessionJsonlEntry,
} from "@hellm/session-model";
import { FileBackedSessionJsonlHarness, withTempWorkspace } from "@hellm/test-support";

describe("@hellm/session-model advanced secondary storage backends contract", () => {
  it("reconstructs the same state when structured session entries are replayed from a non-JSONL durable representation", async () => {
    await withTempWorkspace(async (workspace) => {
      const artifactPath = await workspace.write("artifacts/secondary.log", "ok\n");
      const sessionFile = workspace.path(".pi/sessions/secondary-contract.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-secondary-contract",
        cwd: workspace.root,
      });

      const thread = createThread({
        id: "thread-secondary-contract",
        kind: "smithers-workflow",
        objective: "Persist durable structured state",
        status: "waiting_approval",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:05:00.000Z",
        worktreePath: workspace.path("worktrees/feature-secondary"),
        smithersRunId: "run-secondary-contract",
      });
      const artifact = createArtifact({
        id: "artifact-secondary-contract",
        kind: "log",
        description: "Secondary backend contract output",
        path: artifactPath,
        createdAt: "2026-04-08T09:01:00.000Z",
      });
      const verification = createVerificationRecord({
        id: "verification-secondary-contract",
        kind: "test",
        status: "failed",
        summary: "One contract assertion failed",
        artifactIds: [artifact.id],
        createdAt: "2026-04-08T09:02:00.000Z",
      });
      const episode = createEpisode({
        id: "episode-secondary-contract",
        threadId: thread.id,
        source: "smithers",
        objective: "Capture secondary storage backend requirements",
        status: "waiting_approval",
        conclusions: ["Durable representation must replay structured entries."],
        changedFiles: [workspace.path("docs/contract.md")],
        artifacts: [artifact],
        verification: [verification],
        unresolvedIssues: ["Secondary storage adapter is not implemented yet."],
        followUpSuggestions: ["Implement adapter and wire dual read-path tests."],
        provenance: {
          executionPath: "smithers-workflow",
          actor: "smithers",
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:05:00.000Z",
      });

      harness.append({ kind: "thread", data: thread }, "2026-04-08T09:00:00.000Z");
      harness.append({ kind: "episode", data: episode }, "2026-04-08T09:01:00.000Z");
      harness.append({ kind: "verification", data: verification }, "2026-04-08T09:02:00.000Z");
      harness.append(
        {
          kind: "alignment",
          data: createSessionWorktreeAlignment({
            sessionCwd: workspace.root,
            activeWorktreePath: thread.worktreePath,
          }),
        },
        "2026-04-08T09:03:00.000Z",
      );
      harness.append(
        {
          kind: "workflow-run",
          data: {
            runId: "run-secondary-contract",
            threadId: thread.id,
            workflowId: "workflow:secondary-contract",
            status: "waiting_approval",
            updatedAt: "2026-04-08T09:04:00.000Z",
            worktreePath: thread.worktreePath,
          },
        },
        "2026-04-08T09:04:00.000Z",
      );
      harness.append(
        {
          kind: "smithers-isolation",
          data: {
            runId: "run-secondary-contract",
            runStateStore: workspace.path(".smithers/run-secondary.sqlite"),
            sessionEntryIds: ["entry-a", "entry-b"],
          },
        },
        "2026-04-08T09:05:00.000Z",
      );

      const primaryState = harness.reconstruct();
      const exportedRows = harness.lines().map((sessionEntry, index) => ({
        rowId: `row-${index + 1}`,
        sessionEntry,
      }));
      await workspace.write(
        ".secondary-store/structured-entries.json",
        `${JSON.stringify(exportedRows, null, 2)}\n`,
      );

      const restoredRows = JSON.parse(
        await workspace.read(".secondary-store/structured-entries.json"),
      ) as Array<{
        rowId: string;
        sessionEntry: SessionJsonlEntry;
      }>;
      const reconstructedFromSecondary = reconstructSessionState(
        restoredRows.map((row) => row.sessionEntry),
      );

      expect(reconstructedFromSecondary).toEqual(primaryState);
    });
  });

  it("documents replay ordering requirements for alternate backends by asserting last-write-wins semantics", () => {
    const header = createSessionHeader({
      id: "session-secondary-ordering",
      timestamp: "2026-04-08T09:00:00.000Z",
      cwd: "/repo",
    });
    const initialThread = createThread({
      id: "thread-secondary-ordering",
      kind: "direct",
      status: "running",
      objective: "Initial thread state",
      createdAt: "2026-04-08T09:00:00.000Z",
      updatedAt: "2026-04-08T09:01:00.000Z",
    });
    const updatedThread = createThread({
      ...initialThread,
      status: "waiting_input",
      objective: "Updated thread state",
      updatedAt: "2026-04-08T09:02:00.000Z",
    });

    const initialEntry = createStructuredSessionEntry({
      id: "entry-secondary-initial",
      parentId: null,
      timestamp: "2026-04-08T09:01:00.000Z",
      payload: { kind: "thread", data: initialThread },
    });
    const updatedEntry = createStructuredSessionEntry({
      id: "entry-secondary-updated",
      parentId: "entry-secondary-initial",
      timestamp: "2026-04-08T09:02:00.000Z",
      payload: { kind: "thread", data: updatedThread },
    });

    const inOrder = reconstructSessionState([header, initialEntry, updatedEntry]);
    const outOfOrder = reconstructSessionState([header, updatedEntry, initialEntry]);

    expect(inOrder.threads).toHaveLength(1);
    expect(inOrder.threads[0]).toEqual(updatedThread);
    expect(outOfOrder.threads).toHaveLength(1);
    expect(outOfOrder.threads[0]).toEqual(initialThread);
  });

  test.todo(
    "introduces a pluggable secondary storage adapter interface that can read and write structured entries without changing the pi-session schema",
    () => {},
  );
  test.todo(
    "round-trips migrated state between primary JSONL sessions and a secondary backend while preserving thread snapshots and verification aggregation",
    () => {},
  );
  test.todo(
    "supports deterministic fallback from secondary backend reads to primary JSONL replay without duplicating or dropping structured entries",
    () => {},
  );
});
