import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DeleteExtensionSnapshotCommand,
  ExtensionSnapshotCleanupId,
  ExtensionSnapshotId,
  ExtensionSnapshotRestoreAttemptId,
  ExtensionSnapshotSecretPayloadRef,
  LoadExtensionSnapshotCommand,
  RuntimeClientRequestId,
  SaveExtensionSnapshotCommand,
} from "@svvy/core";

import { createStructuredSessionStateStore } from "./structured-session-state";
import { extensionSnapshotStatePortFromStore } from "./extension-snapshot-state-port";
import { runTestEffect } from "./effect.test-support";

const at = (value: string) => value as SaveExtensionSnapshotCommand["capturedAt"];
const requestId = (value: string) => value as RuntimeClientRequestId;
const snapshotId = (value: string) => `extension-snapshot:${value}` as ExtensionSnapshotId;
const attemptId = (value: string) =>
  `extension-snapshot-restore:${value}` as ExtensionSnapshotRestoreAttemptId;
const cleanupId = (value: string) =>
  `extension-snapshot-cleanup:${value}` as ExtensionSnapshotCleanupId;

describe("extension snapshot SQLite authority", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  const open = (databasePath?: string) => {
    const cwd = databasePath
      ? join(databasePath, "workspace")
      : mkdtempSync(join(tmpdir(), "svvy-snapshot-"));
    if (!databasePath) directories.push(cwd);
    return createStructuredSessionStateStore({
      ...(databasePath ? { databasePath: join(databasePath, "state.sqlite") } : {}),
      workspace: { id: cwd, label: "test", cwd, artifactDir: join(cwd, "artifacts") },
    });
  };

  const save = (name = "Before refactor"): SaveExtensionSnapshotCommand => ({
    clientRequestId: requestId("save-1"),
    snapshotId: snapshotId("before-refactor"),
    name,
    capturedAt: at("2026-07-12T10:00:00.000Z"),
    payloadRef: {
      schemaVersion: 1,
      algorithm: "sha256",
      digest: `sha256:${"a".repeat(64)}`,
      byteSize: 123,
      codec: "svvy-extension-snapshot-json-v1",
    },
    secretPayloadRef:
      "extension-snapshot-secret:v1:before-refactor" as ExtensionSnapshotSecretPayloadRef,
    extensionCount: 2,
  });

  it("does not create an Initial snapshot while listing and persists private metadata across reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "svvy-snapshot-reopen-"));
    directories.push(directory);
    let store = open(directory);
    expect(store.listExtensionSnapshots().snapshots).toEqual([]);
    expect(Number(store.readCurrentStateRevision())).toBe(0);

    const applied = store.saveExtensionSnapshot(save());
    expect(applied.receipt.outcome).toBe("applied");
    expect(store.listExtensionSnapshots().snapshots[0]).not.toHaveProperty("payloadRef");
    expect(store.listExtensionSnapshots().snapshots[0]).not.toHaveProperty("secretPayloadRef");
    store.close();

    store = open(directory);
    expect(store.readExtensionSnapshot(snapshotId("before-refactor"))?.payloadRef.digest).toBe(
      `sha256:${"a".repeat(64)}`,
    );
    expect(store.listExtensionSnapshots().snapshots).toHaveLength(1);
    store.close();
  });

  it("deduplicates client submissions and rejects reusing one with different input", () => {
    const store = open();
    expect(store.saveExtensionSnapshot(save()).receipt.outcome).toBe("applied");
    expect(store.saveExtensionSnapshot(save()).receipt.outcome).toBe("duplicate");
    expect(() => store.saveExtensionSnapshot(save("Different"))).toThrow(
      "Client request id was already used",
    );
    expect(store.listExtensionSnapshots().snapshots).toHaveLength(1);
    store.close();
  });

  it("projects list and mutations through the Effect state port", async () => {
    const store = open();
    const port = extensionSnapshotStatePortFromStore(store);
    expect((await runTestEffect(port.list())).snapshots).toEqual([]);
    const result = await runTestEffect(port.save(save()));
    expect(result.value.snapshot.name).toBe("Before refactor");
    expect(result.afterCommit).toEqual([{ scope: "app", invalidation: { model: "extensions" } }]);
    store.close();
  });

  it("tracks resumable restore attempts and pending private cleanup without public leakage", () => {
    const store = open();
    store.saveExtensionSnapshot(save());
    const load: LoadExtensionSnapshotCommand = {
      clientRequestId: requestId("load-1"),
      snapshotId: snapshotId("before-refactor"),
      expectedRevision: 1,
      attemptId: attemptId("load-1"),
      startedAt: at("2026-07-12T10:01:00.000Z"),
    };
    expect(store.loadExtensionSnapshot(load).attempt.status).toBe("prepared");
    const advanced = store.advanceExtensionSnapshotRestoreAttempt({
      clientRequestId: requestId("advance-1"),
      attemptId: load.attemptId,
      expectedStatus: "prepared",
      status: "payload-applied",
      updatedAt: at("2026-07-12T10:02:00.000Z"),
      failureReason: null,
    });
    expect(advanced.attempt.status).toBe("payload-applied");
    expect(store.listPendingExtensionSnapshotRestoreAttempts()).toEqual([advanced.attempt]);

    const remove: DeleteExtensionSnapshotCommand = {
      clientRequestId: requestId("delete-1"),
      snapshotId: save().snapshotId,
      expectedRevision: 1,
      cleanupId: cleanupId("delete-1"),
      deletedAt: at("2026-07-12T10:03:00.000Z"),
    };
    store.deleteExtensionSnapshot(remove);
    expect(store.listExtensionSnapshots().snapshots).toEqual([]);
    expect(String(store.listPendingExtensionSnapshotCleanup()[0]?.secretPayloadRef)).toBe(
      "extension-snapshot-secret:v1:before-refactor",
    );
    store.completeExtensionSnapshotCleanup({
      clientRequestId: requestId("cleanup-1"),
      cleanupId: remove.cleanupId,
      completedAt: at("2026-07-12T10:04:00.000Z"),
    });
    expect(store.listPendingExtensionSnapshotCleanup()).toEqual([]);
    store.close();
  });
});
