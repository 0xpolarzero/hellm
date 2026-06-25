import * as Schema from "effect/Schema";

import {
  AbsolutePath,
  ArtifactId,
  CommandId,
  IsoDateTimeStringSchema,
  RecoveryWorkId,
  ThreadId,
  WorkflowRunId,
  WorkflowTaskAttemptId,
  WorkspaceSessionId,
} from "./ids";

export const ArtifactMaterializationStatusSchema = Schema.Literals([
  "staging",
  "ready",
  "delete_pending",
  "deleted",
  "failed",
]);
export type ArtifactMaterializationStatus = typeof ArtifactMaterializationStatusSchema.Type;

export const ArtifactMetadataRecordSchema = Schema.Struct({
  artifactId: ArtifactId,
  workspaceSessionId: WorkspaceSessionId,
  sourceCommandId: CommandId,
  threadId: Schema.NullOr(ThreadId),
  workflowRunId: Schema.NullOr(WorkflowRunId),
  workflowTaskAttemptId: Schema.NullOr(WorkflowTaskAttemptId),
  name: Schema.String,
  storedPath: AbsolutePath,
  immutable: Schema.Boolean,
  mimeType: Schema.String,
  byteSize: Schema.Number,
  sha256: Schema.String,
  materializationStatus: ArtifactMaterializationStatusSchema,
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  deletedAt: Schema.NullOr(IsoDateTimeStringSchema),
  lastRecoveryWorkId: Schema.NullOr(RecoveryWorkId),
});
export type ArtifactMetadataRecord = typeof ArtifactMetadataRecordSchema.Type;
