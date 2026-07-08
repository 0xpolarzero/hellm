import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function createDeterministicClock(start = "2026-04-18T12:00:00.000Z") {
  let cursor = Date.parse(start);
  return () => {
    const next = new Date(cursor).toISOString();
    cursor += 1_000;
    return next;
  };
}

const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

function seedSession(
  store: StructuredSessionStateStore,
  input: { sessionId: string; title: string; messageCount?: number },
) {
  store.upsertPiSession({
    sessionId: input.sessionId,
    title: input.title,
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: input.messageCount ?? 0,
    status: "idle",
    createdAt: "2026-04-18T11:55:00.000Z",
    updatedAt: "2026-04-18T11:55:00.000Z",
  });
}

describe("structured session state SQLite persistence", () => {
  const tempDirs: string[] = [];
  const openStores: StructuredSessionStateStore[] = [];

  afterEach(() => {
    while (openStores.length > 0) {
      openStores.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  function createSqliteStore(options: { databasePath?: string; nowStart?: string } = {}) {
    const root = mkdtempSync(join(tmpdir(), "svvy-structured-sqlite-"));
    tempDirs.push(root);
    const databasePath = options.databasePath ?? join(root, "structured-session-state.sqlite");
    const workspaceCwd = root;
    const artifactDir = join(root, "artifact-store");
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: workspaceCwd,
        label: "svvy",
        cwd: workspaceCwd,
        artifactDir,
      },
      databasePath,
      now: createDeterministicClock(options.nowStart ?? "2026-04-18T12:00:00.000Z"),
    });
    openStores.push(store);
    return { databasePath, store, workspaceCwd };
  }

  function closeTrackedStore(store: StructuredSessionStateStore) {
    const index = openStores.indexOf(store);
    if (index >= 0) {
      openStores.splice(index, 1);
    }
    store.close();
  }

  it("applies configured SQLite busy timeout on open", () => {
    const { store } = createSqliteStore();
    closeTrackedStore(store);

    const root = mkdtempSync(join(tmpdir(), "svvy-structured-busy-timeout-"));
    tempDirs.push(root);
    const configuredStore = createStructuredSessionStateStore({
      busyTimeoutMs: 3_456,
      digest: testDigest,
      workspace: {
        id: root,
        label: "svvy",
        cwd: root,
        artifactDir: join(root, "artifact-store"),
      },
      databasePath: join(root, "structured-session-state.sqlite"),
      now: createDeterministicClock(),
    });
    openStores.push(configuredStore);
    const timeout = (configuredStore as unknown as { db: Database }).db
      .query("PRAGMA busy_timeout")
      .get() as { timeout: number };

    expect(timeout.timeout).toBe(3_456);
  });

  it("defaults artifact storage to the app-global config directory", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-structured-default-artifacts-"));
    tempDirs.push(root);
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: root,
        label: "svvy",
        cwd: root,
      },
      databasePath: join(root, "structured-session-state.sqlite"),
    });
    openStores.push(store);
    seedSession(store, {
      sessionId: "session-default-artifact-root",
      title: "Default Artifact Root",
    });

    expect(store.getSessionState("session-default-artifact-root").workspace.artifactDir).toBe(
      join(homedir(), ".config", "svvy", "artifacts"),
    );
  });

  it("persists session navigation metadata and sidebar collapse state across restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-navigation",
      title: "Navigation session",
    });
    first.store.setSessionPinned({ sessionId: "session-navigation", pinned: true });
    first.store.setSessionArchived({ sessionId: "session-navigation", archived: true });
    first.store.markSessionUnread({ sessionId: "session-navigation", reason: "manual" });
    first.store.setArchivedGroupCollapsed({ collapsed: false });
    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-18T12:05:00.000Z",
    });
    const snapshot = second.store.getSessionState("session-navigation");
    expect(snapshot.session.pinnedAt).toBeNull();
    expect(snapshot.session.archivedAt).toBe("2026-04-18T12:00:01.000Z");
    expect(snapshot.session.unreadAt).toBe("2026-04-18T12:00:02.000Z");
    expect(snapshot.session.unreadReason).toBe("manual");
    expect(snapshot.session.lastReadAt).toBeNull();
    expect(snapshot.pi.title).toBe("Navigation session");
    expect(second.store.getWorkspaceSidebarState()).toEqual({
      pinnedGroupCollapsed: false,
      pinnedGroupSizePx: 150,
      activeGroupCollapsed: false,
      activeGroupSizePx: 260,
      archivedGroupCollapsed: false,
      archivedGroupSizePx: 190,
      updatedAt: "2026-04-18T12:00:03.000Z",
    });
  });

  it("persists handler-thread state with many workflow runs and one terminal episode across restart", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-persist",
      title: "Persist me",
      messageCount: 6,
    });

    const orchestratorTurn = first.store.startTurn({
      sessionId: "session-persist",
      surfacePiSessionId: "session-persist",
      requestSummary: "Delegate the design task",
    });
    const handlerThread = first.store.createThread({
      turnId: orchestratorTurn.id,
      surfacePiSessionId: "pi-thread-persist",
      title: "Persisted handler thread",
      objective: "Own the delegated task and supervise workflow runs.",
    });
    first.store.finishTurn({
      turnId: orchestratorTurn.id,
      status: "completed",
    });

    const handlerTurn = first.store.startTurn({
      sessionId: "session-persist",
      surfacePiSessionId: handlerThread.surfacePiSessionId,
      threadId: handlerThread.id,
      requestSummary: "Run the workflow twice and emit the final episode",
    });
    const firstCommand = first.store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Start workflow",
      summary: "Start the first workflow run.",
      arguments: {
        cmd: "svvyx workflows build persist-alpha",
      },
    });
    const runOne = first.store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: firstCommand.id,
      smithersRunId: "smithers-run-alpha",
      workflowName: "persist-alpha",
      workflowSource: "artifact",
      entryPath: ".svvy/artifacts/workflows/persist-alpha/entries/workflow.tsx",
      savedEntryId: null,
      status: "waiting",
      summary: "The first workflow run is waiting on clarification.",
    });
    const secondCommand = first.store.createCommand({
      turnId: handlerTurn.id,
      threadId: handlerThread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Resume workflow",
      summary: "Resume with a repaired workflow run.",
      arguments: {
        cmd: "svvyx workflows build persist-beta",
      },
    });
    const runTwo = first.store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: secondCommand.id,
      smithersRunId: "smithers-run-beta",
      workflowName: "persist-beta",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/persist-beta.tsx",
      savedEntryId: "persist_beta",
      status: "completed",
      summary: "The repaired workflow run completed.",
    });
    const artifact = first.store.createArtifact({
      workflowRunId: runTwo.id,
      sourceCommandId: secondCommand.id,
      kind: "text",
      name: "notes.md",
      content: "# Durable notes\n",
    });
    first.store.updateThread({
      threadId: handlerThread.id,
      status: "completed",
    });
    const episode = first.store.createEpisode({
      threadId: handlerThread.id,
      sourceCommandId: secondCommand.id,
      kind: "workflow",
      title: "Final episode",
      summary: "The handler thread completed.",
      body: "The handler thread completed after two workflow runs.",
    });
    first.store.finishTurn({
      turnId: handlerTurn.id,
      status: "completed",
    });

    const beforeReload = first.store.getSessionState("session-persist");
    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-18T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-persist");
    const detail = second.store.getThreadDetail(handlerThread.id);

    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.session.orchestratorPiSessionId).toBe("session-persist");
    expect(afterReload.workflowRuns.map((workflowRun) => workflowRun.id)).toEqual([
      runOne.id,
      runTwo.id,
    ]);
    expect(afterReload.commands.map((command) => [command.id, command.arguments])).toEqual([
      [firstCommand.id, { cmd: "svvyx workflows build persist-alpha" }],
      [secondCommand.id, { cmd: "svvyx workflows build persist-beta" }],
    ]);
    expect("ciRuns" in afterReload).toBe(false);
    expect("ciCheckResults" in afterReload).toBe(false);
    expect(afterReload.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        threadId: handlerThread.id,
        workflowRunId: runTwo.id,
        sourceCommandId: secondCommand.id,
      }),
    ]);
    expect(afterReload.episodes).toEqual([
      expect.objectContaining({
        id: episode.id,
        threadId: handlerThread.id,
      }),
    ]);
    expect(detail.workflowRuns.map((workflowRun) => workflowRun.id)).toEqual([
      runOne.id,
      runTwo.id,
    ]);
    expect(detail.latestWorkflowRun?.id).toBe(runTwo.id);
  });

  it("writes artifacts into the workspace-scoped artifact directory with persisted ownership metadata", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-artifact-files",
      title: "Artifact Files",
    });

    const turn = store.startTurn({
      sessionId: "session-artifact-files",
      surfacePiSessionId: "session-artifact-files",
      requestSummary: "Persist file-backed artifacts",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-artifact-files",
      title: "Persist file-backed artifacts",
      objective: "Keep artifact payloads on disk instead of only in SQLite.",
    });
    const handlerTurn = store.startTurn({
      sessionId: "session-artifact-files",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      requestSummary: "Persist a file-backed artifact from the handler surface",
    });
    const command = store.createCommand({
      turnId: handlerTurn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Persist snippet",
      summary: "Persist a snippet artifact before execution.",
    });
    const artifact = store.createArtifact({
      threadId: thread.id,
      sourceCommandId: command.id,
      kind: "text",
      name: "snippet.ts",
      content: 'console.log("hello from artifact");\n',
    });

    const snapshot = store.getSessionState("session-artifact-files");
    const expectedArtifactRoot = join(workspaceCwd, "artifact-store");
    const expectedArtifactDir = join(expectedArtifactRoot, "session-artifact-files");

    expect(snapshot.workspace).toEqual(
      expect.objectContaining({
        artifactDir: expectedArtifactRoot,
      }),
    );
    expect(artifact.path).toBe(join(expectedArtifactDir, "snippet.ts"));
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts[0]).toMatchObject({
      id: artifact.id,
      threadId: thread.id,
      sourceCommandId: command.id,
      path: artifact.path,
      name: "snippet.ts",
      mimeType: "text/typescript",
      bytes: 36,
      sha256: "fff7ebfcc62ad265ef9e7102b89c95249ebaeb6105b3e2faaf7e4715b338aea7",
      immutable: false,
      deletedAt: null,
    });
    expect(existsSync(artifact.path!)).toBe(true);
    expect(readFileSync(artifact.path!, "utf8")).toBe('console.log("hello from artifact");\n');
  });

  it("records artifact metadata without materializing or deleting files", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-artifact-metadata",
      title: "Artifact Metadata",
    });
    const turn = store.startTurn({
      sessionId: "session-artifact-metadata",
      surfacePiSessionId: "session-artifact-metadata",
      requestSummary: "Commit artifact metadata",
    });
    const command = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId: "session-artifact-metadata",
      toolName: "execute_typescript",
      executor: "orchestrator",
      visibility: "summary",
      title: "Materialize artifact",
      summary: "Materialize artifact bytes before metadata commit.",
    });
    const storedPath = join(
      workspaceCwd,
      "artifact-store",
      "session-artifact-metadata",
      "ready.md",
    );

    const metadata = store.recordArtifactMetadata({
      workspaceSessionId: "session-artifact-metadata",
      sourceCommandId: command.id,
      kind: "text",
      name: "ready.md",
      storedPath,
      mimeType: "text/markdown",
      byteSize: 12,
      sha256: "1".repeat(64),
      immutable: false,
      materializationStatus: "ready",
    });

    expect(metadata.artifactId as string).toMatch(/^artifact-/);
    expect(metadata.workspaceSessionId as string).toBe("session-artifact-metadata");
    expect(metadata.sourceCommandId as string).toBe(command.id);
    expect(metadata.threadId).toBeNull();
    expect(metadata.workflowRunId).toBeNull();
    expect(metadata.workflowTaskAttemptId).toBeNull();
    expect(metadata.name).toBe("ready.md");
    expect(metadata.storedPath as string).toBe(storedPath);
    expect(metadata.immutable).toBe(false);
    expect(metadata.mimeType).toBe("text/markdown");
    expect(metadata.byteSize).toBe(12);
    expect(metadata.sha256).toBe("1".repeat(64));
    expect(metadata.materializationStatus).toBe("ready");
    expect(metadata.createdAt as string).toBe("2026-04-18T12:00:02.000Z");
    expect(metadata.updatedAt as string).toBe("2026-04-18T12:00:02.000Z");
    expect(metadata.deletedAt).toBeNull();
    expect(metadata.lastRecoveryWorkId).toBeNull();
    expect(existsSync(storedPath)).toBe(false);

    mkdirSync(join(workspaceCwd, "artifact-store", "session-artifact-metadata"), {
      recursive: true,
    });
    writeFileSync(storedPath, "ready bytes\n");
    const deleted = store.markArtifactMetadataDeleted({
      workspaceSessionId: "session-artifact-metadata",
      artifactId: metadata.artifactId,
    });

    expect(deleted.materializationStatus).toBe("deleted");
    expect(deleted.deletedAt as string).toBe("2026-04-18T12:00:03.000Z");
    expect(existsSync(storedPath)).toBe(true);
    expect(store.listArtifacts({ sessionId: "session-artifact-metadata" })).toEqual([]);
  });

  it("stores immutable artifacts under the session immutable directory", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-immutable-artifact",
      title: "Immutable Artifact",
    });

    const artifact = store.createArtifact({
      sessionId: "session-immutable-artifact",
      kind: "text",
      name: "evidence.log",
      content: "passed\n",
      immutable: true,
      mimeType: "text/plain; charset=utf-8",
    });

    expect(artifact.name).toBe("evidence.log");
    expect(artifact.immutable).toBe(true);
    expect(artifact.mimeType).toBe("text/plain");
    expect(artifact.bytes).toBe(7);
    expect(artifact.sha256).toBe(
      "2700165975f68815c97d605c56eca8e90d497ade1264b6282401d13fee99ac27",
    );
    expect(artifact.deletedAt).toBeNull();
    expect(artifact.path).toBe(
      join(
        workspaceCwd,
        "artifact-store",
        "session-immutable-artifact",
        "immutable",
        "evidence.log",
      ),
    );
    expect(readFileSync(artifact.path!, "utf8")).toBe("passed\n");
  });

  it("copies source files into artifact storage instead of recording the source path", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-copy-artifact",
      title: "Copy Artifact",
    });
    const sourcePath = join(workspaceCwd, "source-report.json");
    writeFileSync(sourcePath, '{"ok":true}\n');

    const artifact = store.createArtifact({
      sessionId: "session-copy-artifact",
      kind: "json",
      path: sourcePath,
    });

    expect(artifact.name).toBe("source-report.json");
    expect(artifact.path).toBe(
      join(workspaceCwd, "artifact-store", "session-copy-artifact", "source-report.json"),
    );
    expect(artifact.mimeType).toBe("application/json");
    expect(artifact.bytes).toBe(12);
    expect(artifact.sha256).toBe(
      "e5f1eb4d806641698a35efe20e098efd20d7d57a9b90ee69079d5bb650920726",
    );
    expect(artifact.path).not.toBe(sourcePath);
    expect(readFileSync(artifact.path!, "utf8")).toBe('{"ok":true}\n');
  });

  it("rejects invalid artifact names and active duplicate names", () => {
    const { store } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-artifact-validation",
      title: "Artifact Validation",
    });

    for (const invalidName of ["plan", ".env", "plan.", "../plan.md", "nested/plan.md"]) {
      expect(() =>
        store.createArtifact({
          sessionId: "session-artifact-validation",
          kind: "text",
          name: invalidName,
          content: "",
        }),
      ).toThrow("INVALID_ARGUMENT");
    }

    store.createArtifact({
      sessionId: "session-artifact-validation",
      kind: "text",
      name: "plan.md",
      content: "",
    });
    expect(() =>
      store.createArtifact({
        sessionId: "session-artifact-validation",
        kind: "text",
        name: "plan.md",
        content: "",
      }),
    ).toThrow("ARTIFACT_EXISTS");
  });

  it("allows active mutable and immutable artifacts to share a filename in separate scopes", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-artifact-scopes",
      title: "Artifact Scopes",
    });

    const mutable = store.createArtifact({
      sessionId: "session-artifact-scopes",
      kind: "text",
      name: "report.md",
      content: "mutable\n",
    });
    const immutable = store.createArtifact({
      sessionId: "session-artifact-scopes",
      kind: "text",
      name: "report.md",
      content: "immutable\n",
      immutable: true,
    });

    expect(mutable.path).toBe(
      join(workspaceCwd, "artifact-store", "session-artifact-scopes", "report.md"),
    );
    expect(immutable.path).toBe(
      join(workspaceCwd, "artifact-store", "session-artifact-scopes", "immutable", "report.md"),
    );
  });

  it("rejects disk-only artifact path collisions", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-disk-collision",
      title: "Disk Collision",
    });
    const targetDir = join(workspaceCwd, "artifact-store", "session-disk-collision");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "collision.md"), "existing\n");

    expect(() =>
      store.createArtifact({
        sessionId: "session-disk-collision",
        kind: "text",
        name: "collision.md",
        content: "",
      }),
    ).toThrow("ARTIFACT_EXISTS");
  });

  it("tombstones artifacts, removes files, and permits filename reuse afterward", () => {
    const { store } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-artifact-delete",
      title: "Artifact Delete",
    });
    const first = store.createArtifact({
      sessionId: "session-artifact-delete",
      kind: "text",
      name: "plan.md",
      content: "# first\n",
    });

    const deleted = store.deleteArtifact({
      sessionId: "session-artifact-delete",
      artifactId: first.id,
    });
    expect(deleted.deletedAt).toBe("2026-04-18T12:00:01.000Z");
    expect(existsSync(first.path!)).toBe(false);

    const second = store.createArtifact({
      sessionId: "session-artifact-delete",
      kind: "text",
      name: "plan.md",
      content: "# second\n",
    });
    expect(second.id).not.toBe(first.id);
    expect(second.path).toBe(first.path);
    expect(readFileSync(second.path!, "utf8")).toBe("# second\n");
  });

  it("copies sources with exact rename and rejects invalid MIME or unreadable source shapes", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-source-validation",
      title: "Source Validation",
    });
    const sourcePath = join(workspaceCwd, "source.tmp");
    writeFileSync(sourcePath, "source bytes\n");

    const renamed = store.createArtifact({
      sessionId: "session-source-validation",
      kind: "file",
      path: sourcePath,
      name: "renamed.md",
      immutable: true,
      mimeType: "text/markdown; charset=utf-8",
    });
    expect(renamed.name).toBe("renamed.md");
    expect(renamed.path).toBe(
      join(workspaceCwd, "artifact-store", "session-source-validation", "immutable", "renamed.md"),
    );
    expect(renamed.mimeType).toBe("text/markdown");
    expect(readFileSync(renamed.path!, "utf8")).toBe("source bytes\n");

    expect(() =>
      store.createArtifact({
        sessionId: "session-source-validation",
        kind: "file",
        name: "bad.md",
        content: "",
        mimeType: "not-a-mime",
      }),
    ).toThrow("INVALID_ARGUMENT");
    expect(() =>
      store.createArtifact({
        sessionId: "session-source-validation",
        kind: "file",
        path: join(workspaceCwd, "missing.md"),
      }),
    ).toThrow("SOURCE_NOT_FOUND");

    const sourceDir = join(workspaceCwd, "source-dir.md");
    mkdirSync(sourceDir);
    expect(() =>
      store.createArtifact({
        sessionId: "session-source-validation",
        kind: "file",
        path: sourceDir,
      }),
    ).toThrow("SOURCE_IS_DIRECTORY");
  });

  it("maps artifact materialization failures to COPY_FAILED", () => {
    const { store, workspaceCwd } = createSqliteStore();
    const artifactDir = join(workspaceCwd, "artifact-store");
    rmSync(artifactDir, { force: true, recursive: true });
    writeFileSync(artifactDir, "not a directory\n");
    seedSession(store, {
      sessionId: "session-copy-failed",
      title: "Copy Failed",
    });

    expect(() =>
      store.createArtifact({
        sessionId: "session-copy-failed",
        kind: "text",
        name: "blocked.md",
        content: "",
      }),
    ).toThrow("COPY_FAILED");
  });

  it("maps artifact file deletion failures to DELETE_FAILED without tombstoning", () => {
    const { store } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-delete-failed",
      title: "Delete Failed",
    });
    const artifact = store.createArtifact({
      sessionId: "session-delete-failed",
      kind: "text",
      name: "blocked.md",
      content: "blocked\n",
    });
    rmSync(artifact.path!);
    mkdirSync(artifact.path!);

    expect(() =>
      store.deleteArtifact({
        sessionId: "session-delete-failed",
        artifactId: artifact.id,
      }),
    ).toThrow("DELETE_FAILED");
    expect(
      store.inspectArtifact({ sessionId: "session-delete-failed", artifactId: artifact.id }),
    ).toMatchObject({
      deletedAt: null,
    });
  });

  it("copies symlink source target bytes", () => {
    const { store, workspaceCwd } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-symlink-artifact",
      title: "Symlink Artifact",
    });
    const sourcePath = join(workspaceCwd, "target.txt");
    const linkPath = join(workspaceCwd, "linked.txt");
    writeFileSync(sourcePath, "target bytes\n");
    symlinkSync(sourcePath, linkPath);

    const artifact = store.createArtifact({
      sessionId: "session-symlink-artifact",
      kind: "file",
      path: linkPath,
    });

    expect(artifact.name).toBe("linked.txt");
    expect(readFileSync(artifact.path!, "utf8")).toBe("target bytes\n");
  });

  it("persists thread-owned session wait and clears it when the thread resumes", () => {
    const first = createSqliteStore();
    seedSession(first.store, {
      sessionId: "session-waiting-persist",
      title: "Waiting Persist",
    });

    const turn = first.store.startTurn({
      sessionId: "session-waiting-persist",
      surfacePiSessionId: "session-waiting-persist",
      requestSummary: "Persist session wait",
    });
    const thread = first.store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-thread-waiting",
      title: "Waiting handler thread",
      objective: "Persist session wait details.",
    });
    const wait = {
      owner: "workflow" as const,
      kind: "external" as const,
      reason: "Waiting on a Smithers milestone completion.",
      resumeWhen: "Resume when the milestone gate passes.",
      since: "2026-04-18T12:00:02.000Z",
    };
    first.store.updateThread({
      threadId: thread.id,
      status: "waiting",
      wait,
    });
    const waitingOn = first.store.setSessionWait({
      sessionId: "session-waiting-persist",
      owner: { kind: "thread", threadId: thread.id },
      kind: wait.kind,
      reason: wait.reason,
      resumeWhen: wait.resumeWhen,
    });

    const beforeReload = first.store.getSessionState("session-waiting-persist");
    closeTrackedStore(first.store);

    const second = createSqliteStore({
      databasePath: first.databasePath,
      nowStart: "2026-04-18T13:00:00.000Z",
    });
    const afterReload = second.store.getSessionState("session-waiting-persist");
    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.session.wait).toEqual(waitingOn);
    expect(afterReload.threads[0]?.wait).toEqual(wait);

    second.store.updateThread({
      threadId: thread.id,
      status: "running-handler",
    });

    const resumed = second.store.getSessionState("session-waiting-persist");
    expect(resumed.session.wait).toBeNull();
    expect(resumed.threads[0]?.wait).toBeNull();
  });

  it("lists session states with workflow-run-centric counts and summary facts", () => {
    const { store } = createSqliteStore();
    seedSession(store, {
      sessionId: "session-alpha",
      title: "Alpha Session",
    });
    seedSession(store, {
      sessionId: "session-beta",
      title: "Beta Session",
    });

    const alphaTurn = store.startTurn({
      sessionId: "session-alpha",
      surfacePiSessionId: "session-alpha",
      requestSummary: "Alpha work",
    });
    const alphaThread = store.createThread({
      turnId: alphaTurn.id,
      surfacePiSessionId: "pi-thread-alpha",
      title: "Alpha handler",
      objective: "Handle alpha.",
    });
    const alphaHandlerTurn = store.startTurn({
      sessionId: "session-alpha",
      surfacePiSessionId: alphaThread.surfacePiSessionId,
      threadId: alphaThread.id,
      requestSummary: "Handle alpha on the thread surface",
    });
    const alphaCommand = store.createCommand({
      turnId: alphaHandlerTurn.id,
      threadId: alphaThread.id,
      toolName: "execute_typescript",
      executor: "handler",
      visibility: "summary",
      title: "Alpha command",
      summary: "Alpha summary.",
    });
    store.updateThread({
      threadId: alphaThread.id,
      status: "completed",
    });
    store.createEpisode({
      threadId: alphaThread.id,
      sourceCommandId: alphaCommand.id,
      title: "Alpha episode",
      summary: "Alpha done.",
      body: "Alpha done.",
    });

    const betaTurn = store.startTurn({
      sessionId: "session-beta",
      surfacePiSessionId: "session-beta",
      requestSummary: "Beta work",
    });
    const betaThread = store.createThread({
      turnId: betaTurn.id,
      surfacePiSessionId: "pi-thread-beta",
      title: "Beta handler",
      objective: "Handle beta.",
    });
    const betaHandlerTurn = store.startTurn({
      sessionId: "session-beta",
      surfacePiSessionId: betaThread.surfacePiSessionId,
      threadId: betaThread.id,
      requestSummary: "Handle beta on the thread surface",
    });
    const betaCommand = store.createCommand({
      turnId: betaHandlerTurn.id,
      threadId: betaThread.id,
      toolName: "exec_command",
      executor: "handler",
      visibility: "surface",
      title: "Start beta workflow",
      summary: "Start beta workflow.",
    });
    store.recordWorkflow({
      threadId: betaThread.id,
      commandId: betaCommand.id,
      smithersRunId: "smithers-run-beta-list",
      workflowName: "beta-workflow",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/beta-workflow.tsx",
      savedEntryId: "beta_workflow",
      status: "running",
      summary: "Beta workflow is running.",
    });

    const states = store.listSessionStates();
    const alpha = states.find((state) => state.session.id === "session-alpha")!;
    const beta = states.find((state) => state.session.id === "session-beta")!;

    expect(alpha.workflowRuns).toHaveLength(0);
    expect(alpha.episodes).toHaveLength(1);
    expect(beta.workflowRuns).toHaveLength(1);
    expect(beta.threads[0]?.status).toBe("running-handler");
  });
});
