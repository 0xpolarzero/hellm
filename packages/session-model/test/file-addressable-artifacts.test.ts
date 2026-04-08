import { describe, expect, it } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createThread,
  createThreadSnapshot,
  isFileAddressableArtifact,
} from "@hellm/session-model";
import {
  FileBackedSessionJsonlHarness,
  withTempWorkspace,
} from "@hellm/test-support";

describe("@hellm/session-model file-addressable artifacts", () => {
  it("requires non-empty file paths for file-backed artifact kinds", () => {
    const fileBackedKinds = [
      "file",
      "diff",
      "log",
      "test-report",
      "screenshot",
    ] as const;

    for (const kind of fileBackedKinds) {
      expect(() =>
        createArtifact({
          id: `artifact-missing-${kind}`,
          kind,
          description: "Missing path",
          createdAt: "2026-04-08T09:00:00.000Z",
        }),
      ).toThrow(/requires a file path/);
      expect(() =>
        createArtifact({
          id: `artifact-whitespace-${kind}`,
          kind,
          description: "Whitespace path",
          path: "   ",
          createdAt: "2026-04-08T09:00:00.000Z",
        }),
      ).toThrow(/requires a file path/);
    }
  });

  it("treats addressability as path-based regardless of artifact kind", () => {
    const metadata = createArtifact({
      id: "artifact-note",
      kind: "note",
      description: "Note artifact",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const metadataWithPath = createArtifact({
      id: "artifact-note-with-path",
      kind: "note",
      description: "Attached markdown note",
      path: "  /repo/notes/note.md  ",
      createdAt: "2026-04-08T09:00:00.000Z",
    });

    expect(metadata.path).toBeUndefined();
    expect(isFileAddressableArtifact(metadata)).toBe(false);
    expect(metadataWithPath.path).toBe("/repo/notes/note.md");
    expect(isFileAddressableArtifact(metadataWithPath)).toBe(true);
    expect(
      isFileAddressableArtifact({
        id: "artifact-whitespace",
        kind: "note",
        description: "Whitespace path should not be addressable",
        path: "   ",
        createdAt: "2026-04-08T09:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("reconstructs latest artifact paths from real JSONL and keeps non-file artifacts non-addressable", async () => {
    await withTempWorkspace(async (workspace) => {
      const initialLogPath = await workspace.write(
        "reports/build-initial.log",
        "initial\n",
      );
      const updatedLogPath = await workspace.write(
        "reports/build-updated.log",
        "updated\n",
      );
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/file-addressable.jsonl"),
        sessionId: "session-file-addressable",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-file-addressable",
        kind: "direct",
        objective: "Track file-addressable artifacts",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:01.000Z",
      });
      const logArtifact = createArtifact({
        id: "artifact-log",
        kind: "log",
        description: "Initial build log",
        path: initialLogPath,
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const noteArtifact = createArtifact({
        id: "artifact-note",
        kind: "note",
        description: "Human summary",
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const updatedLogArtifact = createArtifact({
        id: "artifact-log",
        kind: "log",
        description: "Updated build log",
        path: updatedLogPath,
        createdAt: "2026-04-08T09:00:02.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({
        kind: "episode",
        data: createEpisode({
          id: "episode-file-addressable",
          threadId: thread.id,
          source: "orchestrator",
          objective: thread.objective,
          status: "completed",
          artifacts: [logArtifact, noteArtifact],
          provenance: {
            executionPath: "direct",
            actor: "orchestrator",
          },
          startedAt: "2026-04-08T09:00:00.000Z",
          completedAt: "2026-04-08T09:00:02.000Z",
        }),
      });
      harness.append({ kind: "artifact", data: updatedLogArtifact });

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);
      const fileAddressableArtifacts = snapshot.artifacts.filter(
        isFileAddressableArtifact,
      );

      expect(snapshot.artifacts).toHaveLength(2);
      expect(snapshot.artifacts.find((artifact) => artifact.id === "artifact-log")).toEqual(
        updatedLogArtifact,
      );
      expect(snapshot.artifacts.find((artifact) => artifact.id === "artifact-note")).toEqual(
        noteArtifact,
      );
      expect(fileAddressableArtifacts).toEqual([updatedLogArtifact]);
    });
  });
});
