import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  ExtensionSnapshotPayloadCodecs,
  ExtensionSnapshotRestoreAttemptCodecs,
  ExtensionSnapshotsReadModelCodecs,
} from "./extension-snapshot-contracts";

describe("extension snapshot boundary contracts", () => {
  it("rejects traversal paths and secret-like extra fields in payloads", () => {
    const invalid = ExtensionSnapshotPayloadCodecs.decodeExit({
      schemaVersion: 1,
      capturedAt: "2026-07-12T10:00:00.000Z",
      sources: [
        {
          extensionId: "linear",
          category: "user",
          files: [
            {
              relativePath: "../secret",
              contentBase64: "c2VjcmV0",
              contentHash: `sha256:${"a".repeat(64)}`,
              byteSize: 6,
              value: "must-not-cross-boundary",
            },
          ],
        },
      ],
      packageFiles: [],
      actorSettings: [],
      profileSettings: [],
      nonSecretEnvOverrideScopes: [],
      nonSecretEnvOverrides: [],
      secretTargets: [],
    });
    expect(Exit.isFailure(invalid)).toBe(true);
  });

  it("requires canonical contained POSIX source paths", () => {
    for (const relativePath of ["a//b", "a/./b", "C:/x", "a/b/", "/a", "a\\b"]) {
      const result = ExtensionSnapshotPayloadCodecs.decodeExit({
        schemaVersion: 1,
        capturedAt: "2026-07-12T10:00:00.000Z",
        sources: [
          {
            extensionId: "linear",
            category: "user",
            files: [
              {
                relativePath,
                contentBase64: "eA==",
                contentHash: `sha256:${"a".repeat(64)}`,
                byteSize: 1,
              },
            ],
          },
        ],
        packageFiles: [],
        actorSettings: [],
        profileSettings: [],
        nonSecretEnvOverrideScopes: [],
        nonSecretEnvOverrides: [],
        secretTargets: [],
      });
      expect(Exit.isFailure(result), relativePath).toBe(true);
    }
  });

  it("rejects private payload and secret references in the public read model", () => {
    const invalid = ExtensionSnapshotsReadModelCodecs.decodeExit({
      revision: 1,
      snapshots: [
        {
          snapshotId: "extension-snapshot:one",
          name: "One",
          createdAt: "2026-07-12T10:00:00.000Z",
          updatedAt: "2026-07-12T10:00:00.000Z",
          revision: 1,
          extensionCount: 1,
          secretState: "captured",
          status: "available",
          payloadRef: { absolutePath: "/private/snapshot.json" },
          secretPayloadRef: "extension-snapshot-secret:one",
        },
      ],
    });
    expect(Exit.isFailure(invalid)).toBe(true);
  });

  it("rejects raw restore failure messages", () => {
    const result = ExtensionSnapshotRestoreAttemptCodecs.decodeExit({
      attemptId: "extension-snapshot-restore:one",
      snapshotId: "extension-snapshot:one",
      clientRequestId: "request-one",
      snapshotRevision: 1,
      payloadRef: {
        schemaVersion: 1,
        algorithm: "sha256",
        digest: `sha256:${"a".repeat(64)}`,
        byteSize: 1,
        codec: "svvy-extension-snapshot-json-v1",
      },
      secretPayloadRef: "extension-snapshot-secret:v1:one",
      status: "failed",
      startedAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:01:00.000Z",
      finishedAt: "2026-07-12T10:01:00.000Z",
      failureReason: "API key sk-secret leaked here",
      affectedSurfaces: [],
    });
    expect(Exit.isFailure(result)).toBe(true);
  });
});
