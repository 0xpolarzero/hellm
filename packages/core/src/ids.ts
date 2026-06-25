import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";

export const WorkspaceId = Schema.String.pipe(Schema.brand("WorkspaceId"));
export type WorkspaceId = typeof WorkspaceId.Type;

export const WorkspaceTabId = Schema.String.pipe(Schema.brand("WorkspaceTabId"));
export type WorkspaceTabId = typeof WorkspaceTabId.Type;

export const WorkspacePaneId = Schema.String.pipe(Schema.brand("WorkspacePaneId"));
export type WorkspacePaneId = typeof WorkspacePaneId.Type;

export const WorkspaceSessionId = Schema.String.pipe(Schema.brand("WorkspaceSessionId"));
export type WorkspaceSessionId = typeof WorkspaceSessionId.Type;

export const SurfacePiSessionId = Schema.String.pipe(Schema.brand("SurfacePiSessionId"));
export type SurfacePiSessionId = typeof SurfacePiSessionId.Type;

export const ThreadId = Schema.String.pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;

export const ThreadGroupId = Schema.String.pipe(Schema.brand("ThreadGroupId"));
export type ThreadGroupId = typeof ThreadGroupId.Type;

export const WorkflowRunId = Schema.String.pipe(Schema.brand("WorkflowRunId"));
export type WorkflowRunId = typeof WorkflowRunId.Type;

export const WorkflowTaskAttemptId = Schema.String.pipe(Schema.brand("WorkflowTaskAttemptId"));
export type WorkflowTaskAttemptId = typeof WorkflowTaskAttemptId.Type;

export const QueueItemId = Schema.String.pipe(Schema.brand("QueueItemId"));
export type QueueItemId = typeof QueueItemId.Type;

export const TurnId = Schema.String.pipe(Schema.brand("TurnId"));
export type TurnId = typeof TurnId.Type;

export const CommandId = Schema.String.pipe(Schema.brand("CommandId"));
export type CommandId = typeof CommandId.Type;

export const CommandEventId = Schema.String.pipe(Schema.brand("CommandEventId"));
export type CommandEventId = typeof CommandEventId.Type;

export const ToolCallId = Schema.String.pipe(Schema.brand("ToolCallId"));
export type ToolCallId = typeof ToolCallId.Type;

export const ToolItemId = Schema.String.pipe(Schema.brand("ToolItemId"));
export type ToolItemId = typeof ToolItemId.Type;

export const ArtifactId = Schema.String.pipe(Schema.brand("ArtifactId"));
export type ArtifactId = typeof ArtifactId.Type;

export const EpisodeId = Schema.String.pipe(Schema.brand("EpisodeId"));
export type EpisodeId = typeof EpisodeId.Type;

export const RequestInputRequestId = Schema.String.pipe(Schema.brand("RequestInputRequestId"));
export type RequestInputRequestId = typeof RequestInputRequestId.Type;

export const RequestInputQuestionId = Schema.String.pipe(Schema.brand("RequestInputQuestionId"));
export type RequestInputQuestionId = typeof RequestInputQuestionId.Type;

export const RequestInputOptionId = Schema.String.pipe(Schema.brand("RequestInputOptionId"));
export type RequestInputOptionId = typeof RequestInputOptionId.Type;

export const RequestInputAnswerId = Schema.String.pipe(Schema.brand("RequestInputAnswerId"));
export type RequestInputAnswerId = typeof RequestInputAnswerId.Type;

export const RuntimeApprovalId = Schema.String.pipe(Schema.brand("RuntimeApprovalId"));
export type RuntimeApprovalId = typeof RuntimeApprovalId.Type;

export const RecoveryWorkId = Schema.String.pipe(Schema.brand("RecoveryWorkId"));
export type RecoveryWorkId = typeof RecoveryWorkId.Type;

export const RuntimeEventGenerationId = Schema.String.pipe(
  Schema.brand("RuntimeEventGenerationId"),
);
export type RuntimeEventGenerationId = typeof RuntimeEventGenerationId.Type;

export const NonNegativeSafeIntegerSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export type NonNegativeSafeInteger = typeof NonNegativeSafeIntegerSchema.Type;

export const RuntimeEventSequence = NonNegativeSafeIntegerSchema.pipe(
  Schema.brand("RuntimeEventSequence"),
);
export type RuntimeEventSequence = typeof RuntimeEventSequence.Type;

export const SurfaceStreamSequence = NonNegativeSafeIntegerSchema.pipe(
  Schema.brand("SurfaceStreamSequence"),
);
export type SurfaceStreamSequence = typeof SurfaceStreamSequence.Type;

export const SurfaceStreamGenerationId = Schema.String.pipe(
  Schema.brand("SurfaceStreamGenerationId"),
);
export type SurfaceStreamGenerationId = typeof SurfaceStreamGenerationId.Type;

export const RuntimeOwnerId = Schema.String.pipe(Schema.brand("RuntimeOwnerId"));
export type RuntimeOwnerId = typeof RuntimeOwnerId.Type;

export const WorktreeId = Schema.String.pipe(Schema.brand("WorktreeId"));
export type WorktreeId = typeof WorktreeId.Type;

export const AgentProfileId = Schema.String.pipe(Schema.brand("AgentProfileId"));
export type AgentProfileId = typeof AgentProfileId.Type;

export const ExtensionId = Schema.String.pipe(Schema.brand("ExtensionId"));
export type ExtensionId = typeof ExtensionId.Type;

export const ExtensionExecutionPlanId = Schema.String.pipe(
  Schema.brand("ExtensionExecutionPlanId"),
);
export type ExtensionExecutionPlanId = typeof ExtensionExecutionPlanId.Type;

export const GeneratedPackageBuildId = Schema.String.pipe(Schema.brand("GeneratedPackageBuildId"));
export type GeneratedPackageBuildId = typeof GeneratedPackageBuildId.Type;

export const GeneratedContextFingerprint = Schema.String.pipe(
  Schema.brand("GeneratedContextFingerprint"),
);
export type GeneratedContextFingerprint = typeof GeneratedContextFingerprint.Type;

export const GeneratedContextRevision = Schema.String.pipe(
  Schema.brand("GeneratedContextRevision"),
);
export type GeneratedContextRevision = typeof GeneratedContextRevision.Type;

export const MessageId = Schema.String.pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

export const SnippetId = Schema.String.pipe(Schema.brand("SnippetId"));
export type SnippetId = typeof SnippetId.Type;

export const ProviderId = Schema.String.pipe(Schema.brand("ProviderId"));
export type ProviderId = typeof ProviderId.Type;

export const ModelId = Schema.String.pipe(Schema.brand("ModelId"));
export type ModelId = typeof ModelId.Type;

export const ExternalInstructionSourceId = Schema.String.pipe(
  Schema.brand("ExternalInstructionSourceId"),
);
export type ExternalInstructionSourceId = typeof ExternalInstructionSourceId.Type;

export const TitleJobId = Schema.String.pipe(Schema.brand("TitleJobId"));
export type TitleJobId = typeof TitleJobId.Type;

export const AppLogEntryId = Schema.String.pipe(Schema.brand("AppLogEntryId"));
export type AppLogEntryId = typeof AppLogEntryId.Type;

export const AbsolutePath = Schema.String.pipe(Schema.brand("AbsolutePath"));
export type AbsolutePath = typeof AbsolutePath.Type;

export const UtcDateTime = Schema.DateTimeUtcFromString;
export type UtcDateTime = typeof UtcDateTime.Type;

const decodeUtcDateTimeExit = Schema.decodeUnknownExit(UtcDateTime, strictBoundaryParseOptions);

export const IsoDateTimeStringSchema = Schema.String.pipe(
  Schema.refine((value): value is string => Exit.isSuccess(decodeUtcDateTimeExit(value)), {
    expected: "UTC ISO date-time string",
  }),
  Schema.brand("IsoDateTimeString"),
);
export type IsoDateTimeString = typeof UtcDateTime.Encoded;

export const JsonPrimitive = Schema.Union([
  Schema.Null,
  Schema.Boolean,
  Schema.Number,
  Schema.String,
]);
export type JsonPrimitive = typeof JsonPrimitive.Type;

export const JsonValue = Schema.Json;
export type JsonValue = typeof JsonValue.Type;

export const JsonArray = Schema.Array(JsonValue);
export type JsonArray = typeof JsonArray.Type;

export const JsonObject = Schema.Record(Schema.String, JsonValue);
export type JsonObject = typeof JsonObject.Type;
