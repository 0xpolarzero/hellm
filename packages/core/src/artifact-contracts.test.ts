import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";

import {
  ArtifactMetadataRecordSchema,
  ArtifactMaterializationStatusSchema,
} from "./artifact-contracts";

describe("@svvy/core artifact contracts", () => {
  it("decodes the DB-backed artifact metadata record without file-store behavior", () => {
    const decode = Schema.decodeUnknownSync(ArtifactMetadataRecordSchema, {
      errors: "all",
      onExcessProperty: "error",
    });

    expect(
      decode({
        artifactId: "artifact_01",
        workspaceSessionId: "session_01",
        sourceCommandId: "command_01",
        threadId: "thread_01",
        workflowRunId: null,
        workflowTaskAttemptId: null,
        name: "result.json",
        storedPath: "/repo/.svvy/artifacts/session_01/result.json",
        immutable: true,
        mimeType: "application/json",
        byteSize: 17,
        sha256: "0".repeat(64),
        materializationStatus: "ready",
        createdAt: "2026-06-21T12:00:00.000Z",
        updatedAt: "2026-06-21T12:00:01.000Z",
        deletedAt: null,
        lastRecoveryWorkId: null,
      }).materializationStatus,
    ).toBe("ready");
  });

  it("rejects invalid artifact timestamp strings", () => {
    expect(() =>
      Schema.decodeUnknownSync(ArtifactMetadataRecordSchema)({
        artifactId: "artifact_01",
        workspaceSessionId: "session_01",
        sourceCommandId: "command_01",
        threadId: "thread_01",
        workflowRunId: null,
        workflowTaskAttemptId: null,
        name: "result.json",
        storedPath: "/repo/.svvy/artifacts/session_01/result.json",
        immutable: true,
        mimeType: "application/json",
        byteSize: 17,
        sha256: "0".repeat(64),
        materializationStatus: "ready",
        createdAt: "2026-06-21T12:00:00.000Z",
        updatedAt: "not-a-date",
        deletedAt: null,
        lastRecoveryWorkId: null,
      }),
    ).toThrow();
  });

  it("keeps materialization status closed", () => {
    expect(
      Schema.decodeUnknownExit(ArtifactMaterializationStatusSchema)("moved_elsewhere")._tag,
    ).toBe("Failure");
  });
});
