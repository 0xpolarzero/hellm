import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { StateContractError } from "./errors";
import {
  CommandFactsPayloadSchema,
  PromptTargetSchema,
  RequestUserInputResolvedAnswerSchema,
  RuntimeExtensionSnapshotContextImpactTransportInputSchema,
  RuntimeExtensionUsageContextImpactTransportInputSchema,
  RuntimeExtensionUsageProfileKeyTransportSchema,
  RuntimeTurnDecisionSchema,
  UpdateActorExtensionBindingRequestSchema,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type AcquireDefaultWorkspaceInput,
  type AcquireWorkspaceInput,
  type AcquireWorkspaceResult,
  type CloseSurfaceInput,
  type CloseSurfaceResult,
  type CreateOrchestratorSurfaceInput,
  type CreateSurfaceResult,
  type OpenSurfaceInput,
  type OpenSurfaceResult,
  type RecordEpisodeRequest,
  type ReleaseWorkspaceInput,
  type ReleaseWorkspaceResult,
  type StateInvalidationDescriptor,
  type SetRequestInputTimerPausedInput,
  type SetRequestInputTimerPausedResult,
  type UpdateActorExtensionBindingRequest,
} from "./runtime-contracts";
import { ExtensionSourceKindSchema, SourceDiagnosticSchema } from "./runtime-source-edit-contracts";
import {
  AbsolutePath,
  ArtifactId,
  CommandId,
  EpisodeId,
  ExtensionId,
  GeneratedPackageBuildId,
  IsoDateTimeStringSchema,
  NonNegativeSafeIntegerSchema,
  RequestInputRequestId,
  RequestInputAnswerId,
  RequestInputOptionId,
  RequestInputQuestionId,
  RuntimeApprovalId,
  RuntimeOwnerId,
  SurfacePiSessionId,
  TitleJobId,
  ThreadId,
  ThreadGroupId,
  ToolItemId,
  TurnId,
  QueueItemId,
  RecoveryWorkId,
  JsonValue,
  WorktreeId,
  WorkspaceId,
  WorkspaceSessionId,
  WorkflowRunId,
  WorkflowTaskAttemptId,
  type IsoDateTimeString,
} from "./ids";
import {
  GeneratedPackageDependencyEvidenceSchema,
  GeneratedPackageNameSchema,
  GeneratedPackageRefreshStatusSchema,
  GeneratedPackageWorkspaceLinkStatusSchema,
  type GeneratedPackageDependencyEvidence,
  type GeneratedPackageName,
  type GeneratedPackageRefreshStatus,
  type GeneratedPackageWorkspaceLinkStatus,
} from "./generated-package-contracts";
import { StateInvalidationDescriptorSchema } from "./runtime-invalidation-contracts";

export interface RuntimeWorkspaceStatePortService {
  acquireWorkspace(
    input: AcquireWorkspaceInput,
  ): Effect.Effect<StateMutationResult<AcquireWorkspaceResult>, StateContractError>;
  acquireDefaultWorkspace(
    input: AcquireDefaultWorkspaceInput,
  ): Effect.Effect<StateMutationResult<AcquireWorkspaceResult>, StateContractError>;
  releaseWorkspace(
    input: ReleaseWorkspaceInput,
  ): Effect.Effect<StateMutationResult<ReleaseWorkspaceResult>, StateContractError>;
}

export interface RuntimeWorkspaceStatePort {
  readonly _tag: "RuntimeWorkspaceStatePort";
}

export const RuntimeWorkspaceStatePort = Context.Service<
  RuntimeWorkspaceStatePort,
  RuntimeWorkspaceStatePortService
>("@svvy/core/RuntimeWorkspaceStatePort");

export interface RuntimeSurfaceLifecycleStatePortService {
  createOrchestratorSurface(
    input: CreateOrchestratorSurfaceInput,
  ): Effect.Effect<StateMutationResult<CreateSurfaceResult>, StateContractError>;
  openSurface(
    input: OpenSurfaceInput,
  ): Effect.Effect<StateMutationResult<OpenSurfaceResult>, StateContractError>;
  closeSurface(
    input: CloseSurfaceInput,
  ): Effect.Effect<StateMutationResult<CloseSurfaceResult>, StateContractError>;
}

export interface RuntimeSurfaceLifecycleStatePort {
  readonly _tag: "RuntimeSurfaceLifecycleStatePort";
}

export const RuntimeSurfaceLifecycleStatePort = Context.Service<
  RuntimeSurfaceLifecycleStatePort,
  RuntimeSurfaceLifecycleStatePortService
>("@svvy/core/RuntimeSurfaceLifecycleStatePort");

export const RuntimeSourceFactRecordSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
  path: AbsolutePath,
  sourceVersion: Schema.String,
  fingerprint: Schema.String,
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  sourceCommandId: Schema.NullOr(CommandId),
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  deletedAt: Schema.NullOr(IsoDateTimeStringSchema),
});
export type RuntimeSourceFactRecord = typeof RuntimeSourceFactRecordSchema.Type;

export const ReadRuntimeSourceVersionInputSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
});
export type ReadRuntimeSourceVersionInput = typeof ReadRuntimeSourceVersionInputSchema.Type;

export const RecordRuntimeSourceSaveInputSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
  path: AbsolutePath,
  previousSourceVersion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sourceVersion: Schema.String,
  fingerprint: Schema.String,
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  savedAt: IsoDateTimeStringSchema,
});
export type RecordRuntimeSourceSaveInput = typeof RecordRuntimeSourceSaveInputSchema.Type;

export const RecordRuntimeSourceDeleteInputSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
  expectedSourceVersion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  deletedAt: IsoDateTimeStringSchema,
});
export type RecordRuntimeSourceDeleteInput = typeof RecordRuntimeSourceDeleteInputSchema.Type;

export interface RuntimeSourceStatePortService {
  readSourceVersion(
    input: ReadRuntimeSourceVersionInput,
  ): Effect.Effect<RuntimeSourceFactRecord | null, StateContractError>;
  recordSourceSave(
    input: RecordRuntimeSourceSaveInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceFactRecord>, StateContractError>;
  recordSourceDelete(
    input: RecordRuntimeSourceDeleteInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceFactRecord>, StateContractError>;
}

export interface RuntimeSourceStatePort {
  readonly _tag: "RuntimeSourceStatePort";
}

export const RuntimeSourceStatePort = Context.Service<
  RuntimeSourceStatePort,
  RuntimeSourceStatePortService
>("@svvy/core/RuntimeSourceStatePort");

export type RuntimeSurfaceQueueItemKind =
  | "user_message"
  | "initial_handler_start"
  | "thread_followup"
  | "report_request"
  | "thread_report_notification"
  | "request_user_input_answer"
  | "workflow_task_agent_start";
export const RuntimeSurfaceQueueItemKindSchema = Schema.Literals([
  "user_message",
  "initial_handler_start",
  "thread_followup",
  "report_request",
  "thread_report_notification",
  "request_user_input_answer",
  "workflow_task_agent_start",
]);

export type RuntimeSurfaceQueuePriority = "interactive" | "runtime" | "background";
export const RuntimeSurfaceQueuePrioritySchema = Schema.Literals([
  "interactive",
  "runtime",
  "background",
]);

export type RuntimeSurfaceQueueStatus =
  | "queued"
  | "steering"
  | "dispatching"
  | "delivered"
  | "failed"
  | "cancelled";
export const RuntimeSurfaceQueueStatusSchema = Schema.Literals([
  "queued",
  "steering",
  "dispatching",
  "delivered",
  "failed",
  "cancelled",
]);

export const RuntimeSurfaceMessageRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  surfacePiSessionId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  workflowTaskAttemptId: Schema.NullOr(Schema.String),
  kind: RuntimeSurfaceQueueItemKindSchema,
  idempotencyKey: Schema.String,
  messageJson: Schema.String,
  payloadJson: Schema.NullOr(Schema.String),
  status: RuntimeSurfaceQueueStatusSchema,
  priority: RuntimeSurfaceQueuePrioritySchema,
  orderingKey: Schema.String,
  sequence: Schema.Number,
  position: Schema.Number,
  sourceCommandId: Schema.NullOr(Schema.String),
  claimOwnerId: Schema.NullOr(Schema.String),
  claimLeaseExpiresAt: Schema.NullOr(Schema.String),
  leaseVersion: Schema.Number,
  attemptCount: Schema.Number,
  maxAttempts: Schema.Number,
  nextAttemptAt: Schema.NullOr(Schema.String),
  lastErrorJson: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  deliveredAt: Schema.NullOr(Schema.String),
  failedAt: Schema.NullOr(Schema.String),
  failureError: Schema.NullOr(Schema.String),
  cancelledAt: Schema.NullOr(Schema.String),
});
export type RuntimeSurfaceMessageRecord = typeof RuntimeSurfaceMessageRecordSchema.Type;

export const RuntimeSurfaceQueuePositionSchema = Schema.Literals(["front", "back"]);
export type RuntimeSurfaceQueuePosition = typeof RuntimeSurfaceQueuePositionSchema.Type;

export const EnqueueRuntimeSurfaceMessageInputSchema = Schema.Struct({
  sessionId: Schema.String,
  surfacePiSessionId: Schema.String,
  threadId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  workflowTaskAttemptId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  kind: Schema.optionalKey(RuntimeSurfaceQueueItemKindSchema),
  idempotencyKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
  priority: Schema.optionalKey(RuntimeSurfaceQueuePrioritySchema),
  orderingKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sourceCommandId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  maxAttempts: Schema.optionalKey(Schema.Number),
  nextAttemptAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  messageJson: Schema.String,
  payloadJson: Schema.optionalKey(Schema.NullOr(Schema.String)),
  position: Schema.optionalKey(RuntimeSurfaceQueuePositionSchema),
});
export type EnqueueRuntimeSurfaceMessageInput = typeof EnqueueRuntimeSurfaceMessageInputSchema.Type;

export const AcceptSubmittedRuntimeSurfaceMessageInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  idempotencyKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sourceCommandId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  maxAttempts: Schema.optionalKey(Schema.Number),
  nextAttemptAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  messageJson: Schema.String,
  payloadJson: Schema.optionalKey(Schema.NullOr(Schema.String)),
  position: Schema.optionalKey(RuntimeSurfaceQueuePositionSchema),
});
export type AcceptSubmittedRuntimeSurfaceMessageInput =
  typeof AcceptSubmittedRuntimeSurfaceMessageInputSchema.Type;

export const GetRuntimeSurfaceMessageInputSchema = Schema.Struct({
  id: Schema.String,
});
export type GetRuntimeSurfaceMessageInput = typeof GetRuntimeSurfaceMessageInputSchema.Type;

export const ClaimNextRuntimeSurfaceMessageInputSchema = Schema.Struct({
  surfacePiSessionId: Schema.String,
  claimOwnerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  leaseDurationMs: Schema.optionalKey(Schema.Number),
});
export type ClaimNextRuntimeSurfaceMessageInput =
  typeof ClaimNextRuntimeSurfaceMessageInputSchema.Type;

export const ReleaseExpiredRuntimeSurfaceMessageClaimsInputSchema = Schema.Struct({
  surfacePiSessionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  now: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type ReleaseExpiredRuntimeSurfaceMessageClaimsInput =
  typeof ReleaseExpiredRuntimeSurfaceMessageClaimsInputSchema.Type;

export const MarkRuntimeSurfaceMessageSteeringInputSchema = Schema.Struct({
  id: Schema.String,
});
export type MarkRuntimeSurfaceMessageSteeringInput =
  typeof MarkRuntimeSurfaceMessageSteeringInputSchema.Type;

export const MarkRuntimeSurfaceMessageQueuedInputSchema = Schema.Struct({
  id: Schema.String,
  position: Schema.optionalKey(RuntimeSurfaceQueuePositionSchema),
});
export type MarkRuntimeSurfaceMessageQueuedInput =
  typeof MarkRuntimeSurfaceMessageQueuedInputSchema.Type;

export const MarkRuntimeSurfaceMessageDeliveredInputSchema = Schema.Struct({
  id: Schema.String,
  claimOwnerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  leaseVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type MarkRuntimeSurfaceMessageDeliveredInput =
  typeof MarkRuntimeSurfaceMessageDeliveredInputSchema.Type;

export const MarkRuntimeSurfaceMessageFailedInputSchema = Schema.Struct({
  id: Schema.String,
  failureError: Schema.String,
  claimOwnerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  leaseVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type MarkRuntimeSurfaceMessageFailedInput =
  typeof MarkRuntimeSurfaceMessageFailedInputSchema.Type;

export const CancelRuntimeSurfaceMessageInputSchema = Schema.Struct({
  id: Schema.String,
  claimOwnerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  leaseVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type CancelRuntimeSurfaceMessageInput = typeof CancelRuntimeSurfaceMessageInputSchema.Type;

export interface RuntimeQueueStatePortService {
  acceptSubmittedSurfaceMessage(
    input: AcceptSubmittedRuntimeSurfaceMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
  enqueueSurfaceMessage(
    input: EnqueueRuntimeSurfaceMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
  getSurfaceQueuedMessage(
    input: GetRuntimeSurfaceMessageInput,
  ): Effect.Effect<RuntimeSurfaceMessageRecord, StateContractError>;
  claimNextQueuedSurfaceMessage(
    input: ClaimNextRuntimeSurfaceMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord | null>, StateContractError>;
  releaseExpiredSurfaceMessageClaims(
    input?: ReleaseExpiredRuntimeSurfaceMessageClaimsInput,
  ): Effect.Effect<StateMutationResult<readonly RuntimeSurfaceMessageRecord[]>, StateContractError>;
  markSurfaceMessageSteering(
    input: MarkRuntimeSurfaceMessageSteeringInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
  markSurfaceMessageQueued(
    input: MarkRuntimeSurfaceMessageQueuedInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
  markSurfaceMessageDelivered(
    input: MarkRuntimeSurfaceMessageDeliveredInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
  markSurfaceMessageFailed(
    input: MarkRuntimeSurfaceMessageFailedInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
  cancelSurfaceMessage(
    input: CancelRuntimeSurfaceMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
}

export interface RuntimeQueueStatePort {
  readonly _tag: "RuntimeQueueStatePort";
}

export const RuntimeQueueStatePort = Context.Service<
  RuntimeQueueStatePort,
  RuntimeQueueStatePortService
>("@svvy/core/RuntimeQueueStatePort");

export type RuntimeTurnStatus = "running" | "waiting" | "completed" | "failed";
export const RuntimeTurnStatusSchema = Schema.Literals([
  "running",
  "waiting",
  "completed",
  "failed",
]);
export const FinishRuntimeTurnStatusSchema = Schema.Literals(["waiting", "completed", "failed"]);

export const RuntimeTurnRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  surfacePiSessionId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  requestSummary: Schema.String,
  turnDecision: Schema.Union([Schema.Literal("pending"), RuntimeTurnDecisionSchema]),
  status: RuntimeTurnStatusSchema,
  startedAt: Schema.String,
  updatedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});
export type RuntimeTurnRecord = typeof RuntimeTurnRecordSchema.Type;

export const StartRuntimeTurnInputSchema = Schema.Struct({
  sessionId: Schema.String,
  surfacePiSessionId: Schema.String,
  threadId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  requestSummary: Schema.String,
});
export type StartRuntimeTurnInput = typeof StartRuntimeTurnInputSchema.Type;

export const SetRuntimeTurnDecisionInputSchema = Schema.Struct({
  turnId: Schema.String,
  decision: RuntimeTurnDecisionSchema,
  onlyIfPending: Schema.optionalKey(Schema.Boolean),
});
export type SetRuntimeTurnDecisionInput = typeof SetRuntimeTurnDecisionInputSchema.Type;

export const FinishRuntimeTurnInputSchema = Schema.Struct({
  turnId: Schema.String,
  status: FinishRuntimeTurnStatusSchema,
});
export type FinishRuntimeTurnInput = typeof FinishRuntimeTurnInputSchema.Type;

export interface RuntimeTurnStatePortService {
  startTurn(
    input: StartRuntimeTurnInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;
  setTurnDecision(
    input: SetRuntimeTurnDecisionInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;
  finishTurn(
    input: FinishRuntimeTurnInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;
}

export interface RuntimeTurnStatePort {
  readonly _tag: "RuntimeTurnStatePort";
}

export const RuntimeTurnStatePort = Context.Service<
  RuntimeTurnStatePort,
  RuntimeTurnStatePortService
>("@svvy/core/RuntimeTurnStatePort");

export type RuntimeCommandExecutor =
  | "orchestrator"
  | "handler"
  | "workflow-task-agent"
  | "execute_typescript"
  | "runtime";
export const RuntimeCommandExecutorSchema = Schema.Literals([
  "orchestrator",
  "handler",
  "workflow-task-agent",
  "execute_typescript",
  "runtime",
]);

export type RuntimeCommandVisibility = "trace" | "summary" | "surface";
export const RuntimeCommandVisibilitySchema = Schema.Literals(["trace", "summary", "surface"]);

export type RuntimeCommandStatus =
  | "streaming"
  | "requested"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";
export const RuntimeCommandStatusSchema = Schema.Literals([
  "streaming",
  "requested",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
]);

export type RuntimeCommandCreateStatus = "requested" | "streaming";
export const RuntimeCommandCreateStatusSchema = Schema.Literals(["requested", "streaming"]);

export type RuntimeCommandFinishStatus = "waiting" | "succeeded" | "failed" | "cancelled";
export const RuntimeCommandFinishStatusSchema = Schema.Literals([
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
]);

export type RuntimeCommandOutputSource =
  | "live-stream"
  | "final-result"
  | "execute_typescript"
  | "retained-log-artifact";
export const RuntimeCommandOutputSourceSchema = Schema.Literals([
  "live-stream",
  "final-result",
  "execute_typescript",
  "retained-log-artifact",
]);

export const RuntimeCommandRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  workflowTaskAttemptId: Schema.NullOr(Schema.String),
  surfacePiSessionId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  workflowRunId: Schema.NullOr(Schema.String),
  parentCommandId: Schema.NullOr(Schema.String),
  toolName: Schema.String,
  executor: RuntimeCommandExecutorSchema,
  visibility: RuntimeCommandVisibilitySchema,
  status: RuntimeCommandStatusSchema,
  attempts: Schema.Number,
  title: Schema.String,
  summary: Schema.String,
  arguments: Schema.NullOr(JsonValue),
  facts: Schema.NullOr(CommandFactsPayloadSchema),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  updatedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});
export type RuntimeCommandRecord = typeof RuntimeCommandRecordSchema.Type;

export const CreateRuntimeCommandInputSchema = Schema.Struct({
  turnId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  workflowTaskAttemptId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  surfacePiSessionId: Schema.optionalKey(Schema.String),
  threadId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  workflowRunId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  parentCommandId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  toolName: Schema.String,
  executor: RuntimeCommandExecutorSchema,
  visibility: RuntimeCommandVisibilitySchema,
  title: Schema.String,
  summary: Schema.String,
  arguments: Schema.optionalKey(JsonValue),
  facts: Schema.optionalKey(Schema.NullOr(CommandFactsPayloadSchema)),
  attempts: Schema.optionalKey(Schema.Number),
  status: Schema.optionalKey(RuntimeCommandCreateStatusSchema),
});
export type CreateRuntimeCommandInput = typeof CreateRuntimeCommandInputSchema.Type;

export const CreateOrReuseStreamingRuntimeCommandInputSchema = Schema.Struct({
  turnId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  workflowTaskAttemptId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  surfacePiSessionId: Schema.optionalKey(Schema.String),
  threadId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  workflowRunId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  parentCommandId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  toolName: Schema.String,
  executor: RuntimeCommandExecutorSchema,
  visibility: RuntimeCommandVisibilitySchema,
  title: Schema.String,
  summary: Schema.String,
  arguments: Schema.optionalKey(JsonValue),
  attempts: Schema.optionalKey(Schema.Number),
  toolCallId: Schema.String,
  facts: Schema.optionalKey(Schema.NullOr(CommandFactsPayloadSchema)),
});
export type CreateOrReuseStreamingRuntimeCommandInput =
  typeof CreateOrReuseStreamingRuntimeCommandInputSchema.Type;

export const FindRuntimeCommandByToolCallIdInputSchema = Schema.Struct({
  toolCallId: Schema.String,
});
export type FindRuntimeCommandByToolCallIdInput =
  typeof FindRuntimeCommandByToolCallIdInputSchema.Type;

export const FindRuntimeCommandByIdInputSchema = Schema.Struct({
  commandId: Schema.String,
});
export type FindRuntimeCommandByIdInput = typeof FindRuntimeCommandByIdInputSchema.Type;

export const UpdateRuntimeCommandArgumentsInputSchema = Schema.Struct({
  commandId: Schema.String,
  arguments: JsonValue,
});
export type UpdateRuntimeCommandArgumentsInput =
  typeof UpdateRuntimeCommandArgumentsInputSchema.Type;

export const StartRuntimeCommandInputSchema = Schema.Struct({
  commandId: Schema.String,
});
export type StartRuntimeCommandInput = typeof StartRuntimeCommandInputSchema.Type;

export const FinishRuntimeCommandInputSchema = Schema.Struct({
  commandId: Schema.String,
  status: RuntimeCommandFinishStatusSchema,
  visibility: Schema.optionalKey(RuntimeCommandVisibilitySchema),
  summary: Schema.optionalKey(Schema.String),
  facts: Schema.optionalKey(Schema.NullOr(CommandFactsPayloadSchema)),
  error: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type FinishRuntimeCommandInput = typeof FinishRuntimeCommandInputSchema.Type;

export type RuntimeCommandEventKind =
  | "command.arg_snapshot"
  | "command.diagnostics"
  | "command.output"
  | "command.patch_snapshot"
  | "command.progress";
export const RuntimeCommandEventKindSchema = Schema.Literals([
  "command.arg_snapshot",
  "command.diagnostics",
  "command.output",
  "command.patch_snapshot",
  "command.progress",
]);

export const RuntimeCommandOutputStreamSchema = Schema.Literals(["stdout", "stderr"]);

export const RecordRuntimeCommandEventInputSchema = Schema.Struct({
  sessionId: Schema.String,
  commandId: Schema.String,
  kind: RuntimeCommandEventKindSchema,
  at: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(CommandFactsPayloadSchema),
});
export type RecordRuntimeCommandEventInput = typeof RecordRuntimeCommandEventInputSchema.Type;

export const RecordRuntimeCommandStdinWriteInputSchema = Schema.Struct({
  sessionId: Schema.String,
  commandId: Schema.String,
  text: Schema.String,
  acceptedBytes: NonNegativeSafeIntegerSchema,
  at: Schema.optionalKey(Schema.String),
});
export type RecordRuntimeCommandStdinWriteInput =
  typeof RecordRuntimeCommandStdinWriteInputSchema.Type;

export const HasRuntimeCommandOutputEventInputSchema = Schema.Struct({
  sessionId: Schema.String,
  commandId: Schema.String,
  stream: Schema.optionalKey(RuntimeCommandOutputStreamSchema),
  source: Schema.optionalKey(RuntimeCommandOutputSourceSchema),
});
export type HasRuntimeCommandOutputEventInput = typeof HasRuntimeCommandOutputEventInputSchema.Type;

export interface RuntimeCommandStatePortService {
  createCommand(
    input: CreateRuntimeCommandInput,
  ): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
  createOrReuseStreamingCommand(
    input: CreateOrReuseStreamingRuntimeCommandInput,
  ): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
  findCommandByToolCallId(
    input: FindRuntimeCommandByToolCallIdInput,
  ): Effect.Effect<RuntimeCommandRecord | null, StateContractError>;
  findCommandById(
    input: FindRuntimeCommandByIdInput,
  ): Effect.Effect<RuntimeCommandRecord | null, StateContractError>;
  updateCommandArguments(
    input: UpdateRuntimeCommandArgumentsInput,
  ): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
  startCommand(
    input: StartRuntimeCommandInput,
  ): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
  finishCommand(
    input: FinishRuntimeCommandInput,
  ): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
  recordCommandEvent(
    input: RecordRuntimeCommandEventInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  recordStdinWrite(
    input: RecordRuntimeCommandStdinWriteInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  hasCommandOutputEvent(
    input: HasRuntimeCommandOutputEventInput,
  ): Effect.Effect<boolean, StateContractError>;
}

export interface RuntimeCommandStatePort {
  readonly _tag: "RuntimeCommandStatePort";
}

export const RuntimeCommandStatePort = Context.Service<
  RuntimeCommandStatePort,
  RuntimeCommandStatePortService
>("@svvy/core/RuntimeCommandStatePort");

export type RuntimeApprovalToolName = "apply_patch" | "exec_command" | "execute_typescript";
export const RuntimeApprovalToolNameSchema = Schema.Literals([
  "apply_patch",
  "exec_command",
  "execute_typescript",
]);
export type RuntimeApprovalMode = "auto-review" | "user";
export const RuntimeApprovalModeSchema = Schema.Literals(["auto-review", "user"]);
export type RuntimeApprovalStatus = "pending" | "approved" | "denied" | "cancelled";
export const RuntimeApprovalStatusSchema = Schema.Literals([
  "pending",
  "approved",
  "denied",
  "cancelled",
]);
export const RuntimeApprovalResolvedStatusSchema = Schema.Literals([
  "approved",
  "denied",
  "cancelled",
]);
export type RuntimeApprovalReviewer = "auto-review" | "user";
export const RuntimeApprovalReviewerSchema = Schema.Literals(["auto-review", "user"]);

export const RuntimeApprovalRecordSchema = Schema.Struct({
  requestId: RuntimeApprovalId,
  sessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  threadId: Schema.NullOr(ThreadId),
  turnId: Schema.NullOr(TurnId),
  commandId: Schema.NullOr(CommandId),
  toolCallId: ToolItemId,
  toolName: RuntimeApprovalToolNameSchema,
  approvalMode: RuntimeApprovalModeSchema,
  cwd: Schema.String,
  command: Schema.NullOr(Schema.String),
  commandFamily: Schema.NullOr(Schema.String),
  patch: Schema.NullOr(Schema.String),
  snippetArtifactId: Schema.NullOr(Schema.String),
  typescriptCode: Schema.NullOr(Schema.String),
  status: RuntimeApprovalStatusSchema,
  decisionReason: Schema.NullOr(Schema.String),
  reviewer: Schema.NullOr(RuntimeApprovalReviewerSchema),
  createdAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
});
export type RuntimeApprovalRecord = typeof RuntimeApprovalRecordSchema.Type;

export const CreateRuntimeApprovalRequestInputSchema = Schema.Struct({
  sessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  turnId: Schema.optionalKey(Schema.NullOr(TurnId)),
  commandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  toolCallId: ToolItemId,
  toolName: RuntimeApprovalToolNameSchema,
  approvalMode: RuntimeApprovalModeSchema,
  cwd: Schema.String,
  command: Schema.optionalKey(Schema.NullOr(Schema.String)),
  commandFamily: Schema.optionalKey(Schema.NullOr(Schema.String)),
  patch: Schema.optionalKey(Schema.NullOr(Schema.String)),
  snippetArtifactId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  typescriptCode: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type CreateRuntimeApprovalRequestInput = typeof CreateRuntimeApprovalRequestInputSchema.Type;

export const ResolveRuntimeApprovalRequestInputSchema = Schema.Struct({
  requestId: RuntimeApprovalId,
  status: RuntimeApprovalResolvedStatusSchema,
  reviewer: RuntimeApprovalReviewerSchema,
  decisionReason: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type ResolveRuntimeApprovalRequestInput =
  typeof ResolveRuntimeApprovalRequestInputSchema.Type;

export const GetRuntimeApprovalRequestInputSchema = Schema.Struct({
  requestId: RuntimeApprovalId,
});
export type GetRuntimeApprovalRequestInput = typeof GetRuntimeApprovalRequestInputSchema.Type;

export const ListOpenRuntimeApprovalRequestsInputSchema = Schema.Struct({
  surfacePiSessionId: Schema.optionalKey(Schema.NullOr(SurfacePiSessionId)),
});
export type ListOpenRuntimeApprovalRequestsInput =
  typeof ListOpenRuntimeApprovalRequestsInputSchema.Type;

export interface RuntimeApprovalStatePortService {
  createApprovalRequest(
    input: CreateRuntimeApprovalRequestInput,
  ): Effect.Effect<StateMutationResult<RuntimeApprovalRecord>, StateContractError>;
  resolveApprovalRequest(
    input: ResolveRuntimeApprovalRequestInput,
  ): Effect.Effect<StateMutationResult<RuntimeApprovalRecord>, StateContractError>;
  getApprovalRequest(
    input: GetRuntimeApprovalRequestInput,
  ): Effect.Effect<RuntimeApprovalRecord, StateContractError>;
  listOpenApprovalRequests(
    input?: ListOpenRuntimeApprovalRequestsInput,
  ): Effect.Effect<readonly RuntimeApprovalRecord[], StateContractError>;
}

export interface RuntimeApprovalStatePort {
  readonly _tag: "RuntimeApprovalStatePort";
}

export const RuntimeApprovalStatePort = Context.Service<
  RuntimeApprovalStatePort,
  RuntimeApprovalStatePortService
>("@svvy/core/RuntimeApprovalStatePort");

export type RuntimeSessionWaitOwner =
  | { kind: "orchestrator" }
  | { kind: "thread"; threadId: ThreadId };
export const RuntimeSessionWaitOwnerSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("orchestrator") }),
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
]);

export const SetRuntimeApprovalSessionWaitInputSchema = Schema.Struct({
  sessionId: WorkspaceSessionId,
  owner: RuntimeSessionWaitOwnerSchema,
  reason: Schema.String,
  resumeWhen: Schema.String,
});
export type SetRuntimeApprovalSessionWaitInput =
  typeof SetRuntimeApprovalSessionWaitInputSchema.Type;

export const SetRuntimeUserSessionWaitInputSchema = Schema.Struct({
  sessionId: WorkspaceSessionId,
  owner: RuntimeSessionWaitOwnerSchema,
  reason: Schema.String,
  resumeWhen: Schema.String,
});
export type SetRuntimeUserSessionWaitInput = typeof SetRuntimeUserSessionWaitInputSchema.Type;

export const ClearRuntimeSessionWaitInputSchema = Schema.Struct({
  sessionId: WorkspaceSessionId,
});
export type ClearRuntimeSessionWaitInput = typeof ClearRuntimeSessionWaitInputSchema.Type;

export interface RuntimeSessionWaitStatePortService {
  setApprovalWait(
    input: SetRuntimeApprovalSessionWaitInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  setUserWait(
    input: SetRuntimeUserSessionWaitInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  clearSessionWait(
    input: ClearRuntimeSessionWaitInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
}

export interface RuntimeSessionWaitStatePort {
  readonly _tag: "RuntimeSessionWaitStatePort";
}

export const RuntimeSessionWaitStatePort = Context.Service<
  RuntimeSessionWaitStatePort,
  RuntimeSessionWaitStatePortService
>("@svvy/core/RuntimeSessionWaitStatePort");

export type RuntimeArtifactKind = "text" | "log" | "json" | "file";
export const RuntimeArtifactKindSchema = Schema.Literals(["text", "log", "json", "file"]);

export const RuntimeArtifactRecordSchema = Schema.Struct({
  id: ArtifactId,
  sessionId: WorkspaceSessionId,
  threadId: Schema.NullOr(ThreadId),
  workflowRunId: Schema.NullOr(WorkflowRunId),
  workflowTaskAttemptId: Schema.NullOr(WorkflowTaskAttemptId),
  sourceCommandId: Schema.NullOr(CommandId),
  kind: RuntimeArtifactKindSchema,
  name: Schema.String,
  path: Schema.optionalKey(AbsolutePath),
  mimeType: Schema.String,
  bytes: Schema.Number,
  sha256: Schema.String,
  immutable: Schema.Boolean,
  createdAt: Schema.String,
  deletedAt: Schema.NullOr(Schema.String),
});
export type RuntimeArtifactRecord = typeof RuntimeArtifactRecordSchema.Type;

export const CreateRuntimeArtifactInputSchema = Schema.Struct({
  sessionId: Schema.optionalKey(Schema.NullOr(WorkspaceSessionId)),
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  workflowRunId: Schema.optionalKey(Schema.NullOr(WorkflowRunId)),
  workflowTaskAttemptId: Schema.optionalKey(Schema.NullOr(WorkflowTaskAttemptId)),
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  kind: RuntimeArtifactKindSchema,
  name: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(AbsolutePath),
  content: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
  immutable: Schema.optionalKey(Schema.Boolean),
});
export type CreateRuntimeArtifactInput = typeof CreateRuntimeArtifactInputSchema.Type;

export const DeleteRuntimeArtifactInputSchema = Schema.Struct({
  sessionId: Schema.optionalKey(Schema.NullOr(WorkspaceSessionId)),
  artifactId: ArtifactId,
});
export type DeleteRuntimeArtifactInput = typeof DeleteRuntimeArtifactInputSchema.Type;

export const InspectRuntimeArtifactInputSchema = Schema.Struct({
  sessionId: Schema.optionalKey(Schema.NullOr(WorkspaceSessionId)),
  artifactId: ArtifactId,
});
export type InspectRuntimeArtifactInput = typeof InspectRuntimeArtifactInputSchema.Type;

export const ListRuntimeArtifactsInputSchema = Schema.Struct({
  sessionId: WorkspaceSessionId,
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  limit: Schema.optionalKey(Schema.Number),
});
export type ListRuntimeArtifactsInput = typeof ListRuntimeArtifactsInputSchema.Type;

export interface RuntimeArtifactStatePortService {
  createArtifact(
    input: CreateRuntimeArtifactInput,
  ): Effect.Effect<StateMutationResult<RuntimeArtifactRecord>, StateContractError>;
  inspectArtifact(
    input: InspectRuntimeArtifactInput,
  ): Effect.Effect<RuntimeArtifactRecord, StateContractError>;
  listArtifacts(
    input: ListRuntimeArtifactsInput,
  ): Effect.Effect<ReadonlyArray<RuntimeArtifactRecord>, StateContractError>;
  deleteArtifact(
    input: DeleteRuntimeArtifactInput,
  ): Effect.Effect<StateMutationResult<RuntimeArtifactRecord>, StateContractError>;
}

export interface RuntimeArtifactStatePort {
  readonly _tag: "RuntimeArtifactStatePort";
}

export const RuntimeArtifactStatePort = Context.Service<
  RuntimeArtifactStatePort,
  RuntimeArtifactStatePortService
>("@svvy/core/RuntimeArtifactStatePort");

export const ClearSubmittedComposerDraftInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  queuedMessageId: QueueItemId,
});
export type ClearSubmittedComposerDraftInput = typeof ClearSubmittedComposerDraftInputSchema.Type;

export interface RuntimeComposerDraftStatePortService {
  clearSubmittedDraft(
    input: ClearSubmittedComposerDraftInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
}

export interface RuntimeComposerDraftStatePort {
  readonly _tag: "RuntimeComposerDraftStatePort";
}

export const RuntimeComposerDraftStatePort = Context.Service<
  RuntimeComposerDraftStatePort,
  RuntimeComposerDraftStatePortService
>("@svvy/core/RuntimeComposerDraftStatePort");

export const RuntimeRequestInputChoiceInputSchema = Schema.Struct({
  label: Schema.String,
  description: Schema.String,
  recommended: Schema.Boolean,
});

export const RuntimeRequestInputQuestionInputSchema = Schema.Struct({
  title: Schema.String,
  question: Schema.String,
  defaultAnswer: RequestUserInputResolvedAnswerSchema,
  choices: Schema.optionalKey(Schema.Array(RuntimeRequestInputChoiceInputSchema)),
});
export type RuntimeRequestInputQuestionInput = typeof RuntimeRequestInputQuestionInputSchema.Type;

export const RuntimeRequestInputTimeoutInputSchema = Schema.NullOr(
  Schema.Struct({
    enabled: Schema.Boolean,
    durationMs: Schema.Number,
  }),
);

export const RuntimeRequestInputModeSchema = Schema.Literals(["nonblocking", "blocking"]);

export const CreateRuntimeRequestInputInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  turnId: TurnId,
  toolItemId: ToolItemId,
  sourceCommandId: CommandId,
  mode: RuntimeRequestInputModeSchema,
  timeout: Schema.optionalKey(RuntimeRequestInputTimeoutInputSchema),
  questions: Schema.Array(RuntimeRequestInputQuestionInputSchema),
});
export type CreateRuntimeRequestInputInput = typeof CreateRuntimeRequestInputInputSchema.Type;

export const RuntimeRequestInputStatusSchema = Schema.Literals([
  "open",
  "completed",
  "cancelled",
  "expired",
]);

export const RuntimeRequestInputRecordSchema = Schema.Struct({
  requestId: RequestInputRequestId,
  sessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  threadId: Schema.NullOr(ThreadId),
  turnId: TurnId,
  commandId: CommandId,
  variant: RuntimeRequestInputModeSchema,
  status: RuntimeRequestInputStatusSchema,
  questionCount: Schema.Number,
});
export type RuntimeRequestInputRecord = typeof RuntimeRequestInputRecordSchema.Type;

export type RuntimeRequestInputAnsweredBy = "user" | "default" | "timeout_default";
export const RuntimeRequestInputAnsweredBySchema = Schema.Literals([
  "user",
  "default",
  "timeout_default",
]);
export type RuntimeRequestInputDelivery = "enqueue-and-run" | "queue-only";
export const RuntimeRequestInputDeliverySchema = Schema.Literals(["enqueue-and-run", "queue-only"]);
export type RuntimeRequestInputQuestionStatus = "open" | "answered" | "defaulted" | "cancelled";
export const RuntimeRequestInputQuestionStatusSchema = Schema.Literals([
  "open",
  "answered",
  "defaulted",
  "cancelled",
]);

export const RuntimeRequestInputChoiceRecordSchema = Schema.Struct({
  optionId: RequestInputOptionId,
  ordinal: Schema.Number,
  label: Schema.String,
  description: Schema.String,
  recommended: Schema.Boolean,
});
export type RuntimeRequestInputChoiceRecord = typeof RuntimeRequestInputChoiceRecordSchema.Type;

export const RuntimeRequestInputQuestionRecordSchema = Schema.Struct({
  questionId: RequestInputQuestionId,
  requestId: RequestInputRequestId,
  ordinal: Schema.Number,
  title: Schema.String,
  question: Schema.String,
  defaultAnswer: RequestUserInputResolvedAnswerSchema,
  choices: Schema.Array(RuntimeRequestInputChoiceRecordSchema),
  status: RuntimeRequestInputQuestionStatusSchema,
});
export type RuntimeRequestInputQuestionRecord = typeof RuntimeRequestInputQuestionRecordSchema.Type;

export const RuntimeRequestInputAnswerRecordSchema = Schema.Struct({
  answerId: RequestInputAnswerId,
  requestId: RequestInputRequestId,
  questionId: RequestInputQuestionId,
  answer: RequestUserInputResolvedAnswerSchema,
  answeredBy: RuntimeRequestInputAnsweredBySchema,
  delivery: Schema.NullOr(RuntimeRequestInputDeliverySchema),
  queuedItemId: Schema.NullOr(QueueItemId),
  createdAt: Schema.String,
});
export type RuntimeRequestInputAnswerRecord = typeof RuntimeRequestInputAnswerRecordSchema.Type;

export const RuntimeRequestInputTimeoutRecordSchema = Schema.Struct({
  enabled: Schema.Boolean,
  durationMs: Schema.Number,
  startedAt: Schema.String,
  pausedAt: Schema.NullOr(Schema.String),
  remainingMsWhenPaused: Schema.NullOr(Schema.Number),
  expiresAt: Schema.NullOr(Schema.String),
});
export type RuntimeRequestInputTimeoutRecord = typeof RuntimeRequestInputTimeoutRecordSchema.Type;

export const RuntimeRequestInputDetailsRecordSchema = Schema.Struct({
  requestId: RequestInputRequestId,
  sessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  threadId: Schema.NullOr(ThreadId),
  turnId: TurnId,
  commandId: CommandId,
  variant: RuntimeRequestInputModeSchema,
  status: RuntimeRequestInputStatusSchema,
  questionCount: Schema.Number,
  toolItemId: ToolItemId,
  createdAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  timeout: Schema.NullOr(RuntimeRequestInputTimeoutRecordSchema),
  questions: Schema.Array(RuntimeRequestInputQuestionRecordSchema),
  answers: Schema.Array(RuntimeRequestInputAnswerRecordSchema),
});
export type RuntimeRequestInputDetailsRecord = typeof RuntimeRequestInputDetailsRecordSchema.Type;

export const GetRuntimeRequestInputInputSchema = Schema.Struct({
  requestId: RequestInputRequestId,
});
export type GetRuntimeRequestInputInput = typeof GetRuntimeRequestInputInputSchema.Type;

export const ListOpenBlockingRuntimeRequestInputsInputSchema = Schema.Struct({
  workspaceSessionId: Schema.optionalKey(Schema.NullOr(WorkspaceSessionId)),
  surfacePiSessionId: Schema.optionalKey(Schema.NullOr(SurfacePiSessionId)),
});
export type ListOpenBlockingRuntimeRequestInputsInput =
  typeof ListOpenBlockingRuntimeRequestInputsInputSchema.Type;

export const DefaultOpenRuntimeRequestInputQuestionsInputSchema = Schema.Struct({
  requestId: RequestInputRequestId,
  answeredBy: Schema.Literal("timeout_default"),
});
export type DefaultOpenRuntimeRequestInputQuestionsInput =
  typeof DefaultOpenRuntimeRequestInputQuestionsInputSchema.Type;

export const CancelRuntimeRequestInputInputSchema = Schema.Struct({
  requestId: RequestInputRequestId,
});
export type CancelRuntimeRequestInputInput = typeof CancelRuntimeRequestInputInputSchema.Type;

export interface RuntimeRequestStatePortService {
  createRequestInput(
    input: CreateRuntimeRequestInputInput,
  ): Effect.Effect<StateMutationResult<RuntimeRequestInputRecord>, StateContractError>;
  getRequestInput(
    input: GetRuntimeRequestInputInput,
  ): Effect.Effect<RuntimeRequestInputDetailsRecord, StateContractError>;
  listOpenBlockingRequestInputs(
    input?: ListOpenBlockingRuntimeRequestInputsInput,
  ): Effect.Effect<ReadonlyArray<RuntimeRequestInputDetailsRecord>, StateContractError>;
  answerRequestInput(
    input: AnswerRequestInputInput,
  ): Effect.Effect<StateMutationResult<AnswerRequestInputResult>, StateContractError>;
  defaultOpenRequestInputQuestions(
    input: DefaultOpenRuntimeRequestInputQuestionsInput,
  ): Effect.Effect<StateMutationResult<RuntimeRequestInputDetailsRecord>, StateContractError>;
  cancelRequestInput(
    input: CancelRuntimeRequestInputInput,
  ): Effect.Effect<StateMutationResult<RuntimeRequestInputDetailsRecord>, StateContractError>;
  setRequestInputTimerPaused(
    input: SetRequestInputTimerPausedInput,
  ): Effect.Effect<StateMutationResult<SetRequestInputTimerPausedResult>, StateContractError>;
}

export interface RuntimeRequestStatePort {
  readonly _tag: "RuntimeRequestStatePort";
}

export const RuntimeRequestStatePort = Context.Service<
  RuntimeRequestStatePort,
  RuntimeRequestStatePortService
>("@svvy/core/RuntimeRequestStatePort");

export type RuntimeGeneratedPackageFactStatus = "ready" | "failed" | "refresh-needed";
export const RuntimeGeneratedPackageFactStatusSchema = Schema.Literals([
  "ready",
  "failed",
  "refresh-needed",
]);

export interface StateMutationResult<T> {
  value: T;
  afterCommit: readonly StateInvalidationDescriptor[];
}

export const StateMutationResultSchema = <T>(value: Schema.Decoder<T>) =>
  Schema.Struct({
    value,
    afterCommit: Schema.Array(StateInvalidationDescriptorSchema),
  });

export interface RuntimeGeneratedPackageFactRecord {
  packageName: GeneratedPackageName;
  status: RuntimeGeneratedPackageFactStatus;
  buildId: GeneratedPackageBuildId | null;
  manifestPath: string | null;
  sourceFingerprint: string | null;
  outputFingerprint: string | null;
  generatedFileListDigest: string | null;
  dependencies: readonly GeneratedPackageDependencyEvidence[];
  diagnostics: readonly string[];
  sourceCommandId: CommandId | null;
  refreshNeededReason: string | null;
  lastRecoveryWorkId: RecoveryWorkId | null;
  createdAt: string;
  updatedAt: string;
}
export const RuntimeGeneratedPackageFactRecordSchema = Schema.Struct({
  packageName: GeneratedPackageNameSchema,
  status: RuntimeGeneratedPackageFactStatusSchema,
  buildId: Schema.NullOr(GeneratedPackageBuildId),
  manifestPath: Schema.NullOr(Schema.String),
  sourceFingerprint: Schema.NullOr(Schema.String),
  outputFingerprint: Schema.NullOr(Schema.String),
  generatedFileListDigest: Schema.NullOr(Schema.String),
  dependencies: Schema.Array(GeneratedPackageDependencyEvidenceSchema),
  diagnostics: Schema.Array(Schema.String),
  sourceCommandId: Schema.NullOr(CommandId),
  refreshNeededReason: Schema.NullOr(Schema.String),
  lastRecoveryWorkId: Schema.NullOr(RecoveryWorkId),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export interface RuntimeGeneratedPackageWorkspaceLinkRecord {
  workspaceId: WorkspaceId;
  packageName: GeneratedPackageName;
  status: GeneratedPackageWorkspaceLinkStatus["status"];
  linkPath: string | null;
  targetPath: string | null;
  diagnostics: readonly string[];
  sourceCommandId: CommandId | null;
  lastRecoveryWorkId: RecoveryWorkId | null;
  createdAt: string;
  updatedAt: string;
}
export const RuntimeGeneratedPackageWorkspaceLinkRecordSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  packageName: GeneratedPackageNameSchema,
  status: GeneratedPackageWorkspaceLinkStatusSchema.fields.status,
  linkPath: Schema.NullOr(Schema.String),
  targetPath: Schema.NullOr(Schema.String),
  diagnostics: Schema.Array(Schema.String),
  sourceCommandId: Schema.NullOr(CommandId),
  lastRecoveryWorkId: Schema.NullOr(RecoveryWorkId),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export interface ReadGeneratedPackageFactsInput {
  packages?: readonly GeneratedPackageName[];
}
export const ReadGeneratedPackageFactsInputSchema = Schema.Struct({
  packages: Schema.optionalKey(Schema.Array(GeneratedPackageNameSchema)),
});

export interface RecordGeneratedPackageBuildInput {
  status: GeneratedPackageRefreshStatus & { action: "written" | "unchanged" };
  sourceCommandId?: CommandId | null;
  recoveryWorkId?: RecoveryWorkId | null;
}
export const RecordGeneratedPackageBuildInputSchema = Schema.Struct({
  status: GeneratedPackageRefreshStatusSchema,
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  recoveryWorkId: Schema.optionalKey(Schema.NullOr(RecoveryWorkId)),
});

export interface RecordGeneratedPackageFailureInput {
  status: GeneratedPackageRefreshStatus & { action: "failed" };
  sourceCommandId?: CommandId | null;
  recoveryWorkId?: RecoveryWorkId | null;
}
export const RecordGeneratedPackageFailureInputSchema = Schema.Struct({
  status: GeneratedPackageRefreshStatusSchema,
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  recoveryWorkId: Schema.optionalKey(Schema.NullOr(RecoveryWorkId)),
});

export interface RecordGeneratedPackageWorkspaceLinkInput {
  status: GeneratedPackageWorkspaceLinkStatus;
  sourceCommandId?: CommandId | null;
  recoveryWorkId?: RecoveryWorkId | null;
}
export const RecordGeneratedPackageWorkspaceLinkInputSchema = Schema.Struct({
  status: GeneratedPackageWorkspaceLinkStatusSchema,
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  recoveryWorkId: Schema.optionalKey(Schema.NullOr(RecoveryWorkId)),
});

export interface ReadGeneratedPackageLinksNeedingRepairInput {
  workspaceId?: WorkspaceId;
  packages?: readonly GeneratedPackageName[];
}
export const ReadGeneratedPackageLinksNeedingRepairInputSchema = Schema.Struct({
  workspaceId: Schema.optionalKey(WorkspaceId),
  packages: Schema.optionalKey(Schema.Array(GeneratedPackageNameSchema)),
});

export interface ReconcileGeneratedPackageManifestInput {
  fact: Omit<
    RuntimeGeneratedPackageFactRecord,
    | "status"
    | "diagnostics"
    | "sourceCommandId"
    | "refreshNeededReason"
    | "lastRecoveryWorkId"
    | "createdAt"
    | "updatedAt"
  >;
  diagnostics?: readonly string[];
  sourceCommandId?: CommandId | null;
  recoveryWorkId?: RecoveryWorkId | null;
}
export const ReconcileGeneratedPackageManifestInputSchema = Schema.Struct({
  fact: Schema.Struct({
    packageName: GeneratedPackageNameSchema,
    buildId: Schema.NullOr(GeneratedPackageBuildId),
    manifestPath: Schema.NullOr(Schema.String),
    sourceFingerprint: Schema.NullOr(Schema.String),
    outputFingerprint: Schema.NullOr(Schema.String),
    generatedFileListDigest: Schema.NullOr(Schema.String),
    dependencies: Schema.Array(GeneratedPackageDependencyEvidenceSchema),
  }),
  diagnostics: Schema.optionalKey(Schema.Array(Schema.String)),
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  recoveryWorkId: Schema.optionalKey(Schema.NullOr(RecoveryWorkId)),
});

export interface MarkGeneratedPackageRefreshNeededInput {
  packageName: GeneratedPackageName;
  reason: string;
  sourceCommandId?: CommandId | null;
  recoveryWorkId?: RecoveryWorkId | null;
}
export const MarkGeneratedPackageRefreshNeededInputSchema = Schema.Struct({
  packageName: GeneratedPackageNameSchema,
  reason: Schema.String,
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  recoveryWorkId: Schema.optionalKey(Schema.NullOr(RecoveryWorkId)),
});

export const ExtensionDependencyReadinessStatusSchema = Schema.Literals([
  "missing",
  "unknown",
  "available",
  "version-mismatch",
  "update-available",
  "ready",
]);
export type ExtensionDependencyReadinessStatus =
  typeof ExtensionDependencyReadinessStatusSchema.Type;

export const ExtensionDependencyReadinessSchema = Schema.Struct({
  extensionId: ExtensionId,
  requirementId: Schema.String.check(Schema.isNonEmpty()),
  status: ExtensionDependencyReadinessStatusSchema,
  detectedVersion: Schema.NullOr(Schema.String),
  expectedVersion: Schema.NullOr(Schema.String),
  diagnostics: Schema.Array(Schema.String),
  checkedAt: Schema.NullOr(IsoDateTimeStringSchema),
});
export type ExtensionDependencyReadiness = typeof ExtensionDependencyReadinessSchema.Type;

export interface RecordExtensionDependencyReadinessInput {
  readiness: ExtensionDependencyReadiness;
  sourceCommandId?: CommandId | null;
  recordedAt: IsoDateTimeString;
}
export const RecordExtensionDependencyReadinessInputSchema = Schema.Struct({
  readiness: ExtensionDependencyReadinessSchema,
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  recordedAt: IsoDateTimeStringSchema,
});

export interface RuntimeExtensionStatePortService {
  recordDependencyReadiness(
    input: RecordExtensionDependencyReadinessInput,
  ): Effect.Effect<StateMutationResult<ExtensionDependencyReadiness>, StateContractError>;
}

export interface RuntimeExtensionStatePort {
  readonly _tag: "RuntimeExtensionStatePort";
}

export const RuntimeExtensionStatePort = Context.Service<
  RuntimeExtensionStatePort,
  RuntimeExtensionStatePortService
>("@svvy/core/RuntimeExtensionStatePort");

export interface RuntimeGeneratedPackageStatePortService {
  recordGeneratedPackageBuild(
    input: RecordGeneratedPackageBuildInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;
  recordGeneratedPackageFailure(
    input: RecordGeneratedPackageFailureInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;
  recordWorkspaceLinkStatus(
    input: RecordGeneratedPackageWorkspaceLinkInput,
  ): Effect.Effect<
    StateMutationResult<RuntimeGeneratedPackageWorkspaceLinkRecord>,
    StateContractError
  >;
  readLinksNeedingRepair(
    input?: ReadGeneratedPackageLinksNeedingRepairInput,
  ): Effect.Effect<ReadonlyArray<RuntimeGeneratedPackageWorkspaceLinkRecord>, StateContractError>;
  readGeneratedPackageFacts(
    input?: ReadGeneratedPackageFactsInput,
  ): Effect.Effect<ReadonlyArray<RuntimeGeneratedPackageFactRecord>, StateContractError>;
  reconcileGeneratedPackageManifest(
    input: ReconcileGeneratedPackageManifestInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;
  markGeneratedPackageRefreshNeeded(
    input: MarkGeneratedPackageRefreshNeededInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;
}

export interface RuntimeGeneratedPackageStatePort {
  readonly _tag: "RuntimeGeneratedPackageStatePort";
}

export const RuntimeGeneratedPackageStatePort = Context.Service<
  RuntimeGeneratedPackageStatePort,
  RuntimeGeneratedPackageStatePortService
>("@svvy/core/RuntimeGeneratedPackageStatePort");

export const RuntimeActorExtensionBindingRecordSchema = Schema.Struct({
  target: PromptTargetSchema,
  loadedExtensionIds: Schema.Array(ExtensionId),
  availableExtensionIds: Schema.Array(ExtensionId),
  generatedAgentContextFingerprint: Schema.NullOr(Schema.String),
  updateExtensionContextBeforeNextTurn: Schema.Boolean,
});
export type RuntimeActorExtensionBindingRecord =
  typeof RuntimeActorExtensionBindingRecordSchema.Type;

export const SetRuntimeActorExtensionBindingInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  loadedExtensionIds: Schema.Array(ExtensionId),
  availableExtensionIds: Schema.Array(ExtensionId),
  reason: UpdateActorExtensionBindingRequestSchema.fields.reason,
  sourceCommandId: Schema.optionalKey(CommandId),
});
export type SetRuntimeActorExtensionBindingInput =
  typeof SetRuntimeActorExtensionBindingInputSchema.Type;

export interface RuntimeActorExtensionBindingStatePortService {
  updateActorExtensionBinding(
    input: UpdateActorExtensionBindingRequest,
  ): Effect.Effect<StateMutationResult<RuntimeActorExtensionBindingRecord>, StateContractError>;
  setActorExtensionBinding(
    input: SetRuntimeActorExtensionBindingInput,
  ): Effect.Effect<StateMutationResult<RuntimeActorExtensionBindingRecord>, StateContractError>;
}

export interface RuntimeActorExtensionBindingStatePort {
  readonly _tag: "RuntimeActorExtensionBindingStatePort";
}

export const RuntimeActorExtensionBindingStatePort = Context.Service<
  RuntimeActorExtensionBindingStatePort,
  RuntimeActorExtensionBindingStatePortService
>("@svvy/core/RuntimeActorExtensionBindingStatePort");

export type RuntimeExtensionContextChangedReason = "extension_usage_changed" | "snapshot_loaded";
export const RuntimeExtensionContextChangedReasonSchema = Schema.Literals([
  "extension_usage_changed",
  "snapshot_loaded",
]);

export const RuntimeExtensionContextChangedSurfaceSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  kind: Schema.Literal("extension_context_changed"),
  label: Schema.Literal("Extensions changed"),
  reason: RuntimeExtensionContextChangedReasonSchema,
});
export type RuntimeExtensionContextChangedSurface =
  typeof RuntimeExtensionContextChangedSurfaceSchema.Type;

export const ListRuntimeExtensionUsageContextAffectedSurfacesInputSchema =
  RuntimeExtensionUsageContextImpactTransportInputSchema;
export type ListRuntimeExtensionUsageContextAffectedSurfacesInput =
  typeof ListRuntimeExtensionUsageContextAffectedSurfacesInputSchema.Type;

export const RuntimeExtensionUsageProfileKeySchema = RuntimeExtensionUsageProfileKeyTransportSchema;
export type RuntimeExtensionUsageProfileKey = typeof RuntimeExtensionUsageProfileKeySchema.Type;

export const ApplyRuntimeExtensionSnapshotContextImpactInputSchema =
  RuntimeExtensionSnapshotContextImpactTransportInputSchema;
export type ApplyRuntimeExtensionSnapshotContextImpactInput =
  typeof ApplyRuntimeExtensionSnapshotContextImpactInputSchema.Type;

export interface RuntimeExtensionContextImpactStatePortService {
  listUsageContextAffectedSurfaces(
    input: ListRuntimeExtensionUsageContextAffectedSurfacesInput,
  ): Effect.Effect<ReadonlyArray<RuntimeExtensionContextChangedSurface>, StateContractError>;
  applySnapshotContextImpact(
    input: ApplyRuntimeExtensionSnapshotContextImpactInput,
  ): Effect.Effect<
    StateMutationResult<ReadonlyArray<RuntimeExtensionContextChangedSurface>>,
    StateContractError
  >;
}

export interface RuntimeExtensionContextImpactStatePort {
  readonly _tag: "RuntimeExtensionContextImpactStatePort";
}

export const RuntimeExtensionContextImpactStatePort = Context.Service<
  RuntimeExtensionContextImpactStatePort,
  RuntimeExtensionContextImpactStatePortService
>("@svvy/core/RuntimeExtensionContextImpactStatePort");

export interface RuntimeExtensionContextImpactStateFacade {
  listUsageContextAffectedSurfaces(
    input: ListRuntimeExtensionUsageContextAffectedSurfacesInput,
  ): ReadonlyArray<RuntimeExtensionContextChangedSurface>;
  applySnapshotContextImpact(
    input: ApplyRuntimeExtensionSnapshotContextImpactInput,
  ): ReadonlyArray<RuntimeExtensionContextChangedSurface>;
}

export type RuntimeRecoveryWorkKind =
  | "queue_delivery"
  | "active_turn_recovery"
  | "workflow_task_attempt_recovery"
  | "source_reconcile"
  | "generated_context_refresh"
  | "generated_package_refresh"
  | "workspace_generated_package_link_repair"
  | "artifact_materialization"
  | "title_generation"
  | "request_input_wait"
  | "approval_wait"
  | "command_process_reconciliation";
export const RuntimeRecoveryWorkKindSchema = Schema.Literals([
  "queue_delivery",
  "active_turn_recovery",
  "workflow_task_attempt_recovery",
  "source_reconcile",
  "generated_context_refresh",
  "generated_package_refresh",
  "workspace_generated_package_link_repair",
  "artifact_materialization",
  "title_generation",
  "request_input_wait",
  "approval_wait",
  "command_process_reconciliation",
]);

export type RuntimeRecoveryWorkStatus =
  | "pending"
  | "claimed"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export const RuntimeRecoveryWorkStatusSchema = Schema.Literals([
  "pending",
  "claimed",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);

export type RuntimeRecoveryWorkOwnerScope =
  | { kind: "workspace" }
  | { kind: "workspace_session"; workspaceSessionId: WorkspaceSessionId }
  | {
      kind: "surface";
      workspaceSessionId: WorkspaceSessionId;
      surfacePiSessionId: SurfacePiSessionId;
    }
  | {
      kind: "thread";
      workspaceSessionId: WorkspaceSessionId;
      threadId: ThreadId;
      surfacePiSessionId: SurfacePiSessionId;
    }
  | { kind: "workflow_run"; workflowRunId: WorkflowRunId; smithersRunId: string }
  | { kind: "queue_item"; queuedItemId: QueueItemId; surfacePiSessionId: SurfacePiSessionId }
  | { kind: "title_job"; titleJobId: TitleJobId };
export const RuntimeRecoveryWorkOwnerScopeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("workspace") }),
  Schema.Struct({
    kind: Schema.Literal("workspace_session"),
    workspaceSessionId: WorkspaceSessionId,
  }),
  Schema.Struct({
    kind: Schema.Literal("surface"),
    workspaceSessionId: WorkspaceSessionId,
    surfacePiSessionId: SurfacePiSessionId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread"),
    workspaceSessionId: WorkspaceSessionId,
    threadId: ThreadId,
    surfacePiSessionId: SurfacePiSessionId,
  }),
  Schema.Struct({
    kind: Schema.Literal("workflow_run"),
    workflowRunId: WorkflowRunId,
    smithersRunId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("queue_item"),
    queuedItemId: QueueItemId,
    surfacePiSessionId: SurfacePiSessionId,
  }),
  Schema.Struct({ kind: Schema.Literal("title_job"), titleJobId: TitleJobId }),
]);

export const RuntimeRecoveryWorkRecordSchema = Schema.Struct({
  id: RecoveryWorkId,
  workspaceId: WorkspaceId,
  kind: RuntimeRecoveryWorkKindSchema,
  status: RuntimeRecoveryWorkStatusSchema,
  ownerScope: RuntimeRecoveryWorkOwnerScopeSchema,
  idempotencyKey: Schema.String,
  orderingKey: Schema.String,
  orderingSeq: Schema.Number,
  priority: Schema.Number,
  availableAt: Schema.String,
  attempts: Schema.Number,
  maxAttempts: Schema.Number,
  claimedBy: Schema.NullOr(RuntimeOwnerId),
  claimedAt: Schema.NullOr(Schema.String),
  claimExpiresAt: Schema.NullOr(Schema.String),
  leaseVersion: Schema.Number,
  payloadJson: Schema.NullOr(JsonValue),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
});
export type RuntimeRecoveryWorkRecord = typeof RuntimeRecoveryWorkRecordSchema.Type;

export type RuntimeRecoveryStartupTurnStatus = "running" | "waiting" | "completed" | "failed";
export const RuntimeRecoveryStartupTurnStatusSchema = RuntimeTurnStatusSchema;

export type RuntimeRecoveryStartupQueueStatus =
  | "queued"
  | "steering"
  | "dispatching"
  | "delivered"
  | "failed"
  | "cancelled";
export const RuntimeRecoveryStartupQueueStatusSchema = RuntimeSurfaceQueueStatusSchema;

export type RuntimeRecoveryStartupThreadStatus =
  | "idle"
  | "running-handler"
  | "running-workflow"
  | "waiting"
  | "troubleshooting"
  | "completed";
export const RuntimeRecoveryStartupThreadStatusSchema = Schema.Literals([
  "idle",
  "running-handler",
  "running-workflow",
  "waiting",
  "troubleshooting",
  "completed",
]);

export type RuntimeRecoveryStartupTitleGenerationStatus =
  | "not-started"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export const RuntimeRecoveryStartupTitleGenerationStatusSchema = Schema.Literals([
  "not-started",
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const RuntimeRecoveryStartupSnapshotSchema = Schema.Struct({
  session: Schema.Struct({
    id: WorkspaceSessionId,
    orchestratorPiSessionId: SurfacePiSessionId,
  }),
  pi: Schema.Struct({
    titleGenerationStatus: RuntimeRecoveryStartupTitleGenerationStatusSchema,
  }),
  turns: Schema.Array(
    Schema.Struct({
      id: TurnId,
      status: RuntimeRecoveryStartupTurnStatusSchema,
      surfacePiSessionId: SurfacePiSessionId,
      threadId: Schema.NullOr(ThreadId),
    }),
  ),
  queuedMessages: Schema.Array(
    Schema.Struct({
      id: QueueItemId,
      status: RuntimeRecoveryStartupQueueStatusSchema,
      surfacePiSessionId: SurfacePiSessionId,
      kind: RuntimeSurfaceQueueItemKindSchema,
      position: Schema.Number,
    }),
  ),
  threads: Schema.Array(
    Schema.Struct({
      id: ThreadId,
      status: RuntimeRecoveryStartupThreadStatusSchema,
      surfacePiSessionId: SurfacePiSessionId,
      title: Schema.String,
      objective: Schema.String,
    }),
  ),
});
export type RuntimeRecoveryStartupSnapshot = typeof RuntimeRecoveryStartupSnapshotSchema.Type;

export const EnsureRuntimeRecoveryWorkInputSchema = Schema.Struct({
  kind: RuntimeRecoveryWorkKindSchema,
  ownerScope: RuntimeRecoveryWorkOwnerScopeSchema,
  idempotencyKey: Schema.String,
  orderingKey: Schema.String,
  orderingSeq: Schema.Number,
  priority: Schema.Number,
  availableAt: Schema.String,
  maxAttempts: Schema.Number,
  payloadJson: Schema.optionalKey(JsonValue),
});
export type EnsureRuntimeRecoveryWorkInput = typeof EnsureRuntimeRecoveryWorkInputSchema.Type;

export const ClaimNextRuntimeRecoveryWorkInputSchema = Schema.Struct({
  claimedBy: RuntimeOwnerId,
  leaseMs: Schema.optionalKey(Schema.Number),
});
export type ClaimNextRuntimeRecoveryWorkInput = typeof ClaimNextRuntimeRecoveryWorkInputSchema.Type;

export const CompleteRuntimeRecoveryWorkInputSchema = Schema.Struct({
  id: RecoveryWorkId,
  claimedBy: Schema.optionalKey(Schema.NullOr(RuntimeOwnerId)),
  leaseVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type CompleteRuntimeRecoveryWorkInput = typeof CompleteRuntimeRecoveryWorkInputSchema.Type;

export const FailOrRetryRuntimeRecoveryWorkInputSchema = Schema.Struct({
  id: RecoveryWorkId,
  error: Schema.String,
  claimedBy: Schema.optionalKey(Schema.NullOr(RuntimeOwnerId)),
  leaseVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type FailOrRetryRuntimeRecoveryWorkInput =
  typeof FailOrRetryRuntimeRecoveryWorkInputSchema.Type;

export const NormalizeRuntimeRecoveryStateInputSchema = Schema.Struct({
  claimedBy: RuntimeOwnerId,
});
export type NormalizeRuntimeRecoveryStateInput =
  typeof NormalizeRuntimeRecoveryStateInputSchema.Type;

export interface RuntimeRecoveryStatePortService {
  normalizeWorkspaceRecoveryState(
    input: NormalizeRuntimeRecoveryStateInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  listWorkspaceRecoveryStartupSnapshots(): Effect.Effect<
    ReadonlyArray<RuntimeRecoveryStartupSnapshot>,
    StateContractError
  >;
  ensureRecoveryWork(
    input: EnsureRuntimeRecoveryWorkInput,
  ): Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord>, StateContractError>;
  claimNextRecoveryWork(
    input: ClaimNextRuntimeRecoveryWorkInput,
  ): Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord | null>, StateContractError>;
  completeRecoveryWork(
    input: CompleteRuntimeRecoveryWorkInput,
  ): Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord>, StateContractError>;
  failOrRetryRecoveryWork(
    input: FailOrRetryRuntimeRecoveryWorkInput,
  ): Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord>, StateContractError>;
}

export interface RuntimeRecoveryStatePort {
  readonly _tag: "RuntimeRecoveryStatePort";
}

export const RuntimeRecoveryStatePort = Context.Service<
  RuntimeRecoveryStatePort,
  RuntimeRecoveryStatePortService
>("@svvy/core/RuntimeRecoveryStatePort");

export type RuntimeHandlerThreadEpisodeRequest = Extract<
  RecordEpisodeRequest,
  { scope: "handler-thread" }
>;

export type RuntimeEpisodeKind = RuntimeHandlerThreadEpisodeRequest["kind"];

export interface RuntimeEpisodeRecord {
  id: EpisodeId;
  sessionId: WorkspaceSessionId;
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  sourceCommandId: CommandId | null;
  kind: RuntimeEpisodeKind;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
}

export interface RuntimeEpisodeStatePortService {
  recordHandlerThreadEpisode(
    input: RuntimeHandlerThreadEpisodeRequest,
  ): Effect.Effect<StateMutationResult<RuntimeEpisodeRecord>, StateContractError>;
}

export interface RuntimeEpisodeStatePort {
  readonly _tag: "RuntimeEpisodeStatePort";
}

export const RuntimeEpisodeStatePort = Context.Service<
  RuntimeEpisodeStatePort,
  RuntimeEpisodeStatePortService
>("@svvy/core/RuntimeEpisodeStatePort");

export type RuntimeThreadStatus =
  | "running-handler"
  | "running-workflow"
  | "waiting"
  | "idle"
  | "troubleshooting"
  | "completed";

export interface RuntimeThreadReadModelWait {
  kind: "user" | "external";
  reason: string;
  resumeWhen: string;
}

export interface EnsureRuntimeHandlerThreadRunnableInput {
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId: ThreadId;
}

export interface RuntimeHandlerThreadGeneratedContextBindingInput {
  aggregateCacheKey: string;
  systemPrompt: string;
  svvyxGuidance: string;
  commandsDts: string;
  nativeToolSchemasJson: string;
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  externalSourceHashes: readonly string[];
}

export interface RuntimeHandlerThreadInitialQueueInput {
  idempotencyKey: string;
  priority?: RuntimeSurfaceQueuePriority;
  orderingKey?: string | null;
  nextAttemptAt?: string | null;
  maxAttempts?: number;
  messageJson: string;
  payloadJson: string;
}

export interface StartRuntimeHandlerThreadInput {
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  historyMode: "isolated" | "forked";
  worktreeId?: WorktreeId | null;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  agentProfileJson?: string | null;
  generatedAgentContextBinding: RuntimeHandlerThreadGeneratedContextBindingInput;
  initialQueue: RuntimeHandlerThreadInitialQueueInput;
}

export interface StartRuntimeHandlerThreadsInput {
  workspaceSessionId: WorkspaceSessionId;
  orchestratorTurnId: TurnId;
  sourceCommandId: CommandId;
  threadGroupId?: ThreadGroupId | null;
  threads: readonly [StartRuntimeHandlerThreadInput, ...StartRuntimeHandlerThreadInput[]];
}

export interface StartedRuntimeHandlerThread {
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  historyMode: "isolated" | "forked";
  objectiveState: "active";
  status: "running-handler";
  wait: null;
  worktreeId: WorktreeId | null;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  generatedAgentContextFingerprint: string;
  generatedAgentContextBindingId: string;
  queuedMessage: RuntimeSurfaceMessageRecord;
}

export interface StartRuntimeHandlerThreadsResult {
  threadGroupId: ThreadGroupId;
  threads: readonly StartedRuntimeHandlerThread[];
}

export interface RuntimeThreadStatePortService {
  ensureHandlerThreadRunnable(
    input: EnsureRuntimeHandlerThreadRunnableInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  startHandlerThreads(
    input: StartRuntimeHandlerThreadsInput,
  ): Effect.Effect<StateMutationResult<StartRuntimeHandlerThreadsResult>, StateContractError>;
}

export interface RuntimeThreadStatePort {
  readonly _tag: "RuntimeThreadStatePort";
}

export const RuntimeThreadStatePort = Context.Service<
  RuntimeThreadStatePort,
  RuntimeThreadStatePortService
>("@svvy/core/RuntimeThreadStatePort");

export interface RuntimeThreadReadModelEpisodeSummary {
  id: EpisodeId;
  title: string;
  summary: string;
  createdAt: string;
}

export interface RuntimeThreadCompactRow {
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  objectiveState: "active" | "concluded";
  status: RuntimeThreadStatus;
  wait: RuntimeThreadReadModelWait | null;
  latestEpisode: RuntimeThreadReadModelEpisodeSummary | null;
}

export interface RuntimeThreadPendingReportRequest {
  queuedMessageId: QueueItemId;
  request: string;
  createdAt: string;
}

export interface RuntimeThreadCurrentReadModel extends RuntimeThreadCompactRow {
  pendingReportRequests: RuntimeThreadPendingReportRequest[];
  loadedExtensionIds: ExtensionId[];
  availableExtensionIds: ExtensionId[];
}

export interface RuntimeThreadListReadModel {
  threads: RuntimeThreadCompactRow[];
}

export interface RuntimeThreadEpisodesReadModel {
  episodes: Array<{
    id: EpisodeId;
    threadId: ThreadId;
    title: string;
    summary: string;
    body: string;
    createdAt: string;
  }>;
}

export interface RuntimeThreadGroupReadModel {
  threadGroupId: ThreadGroupId;
  currentThreadId: ThreadId;
  threads: RuntimeThreadCompactRow[];
}

export interface GetCurrentRuntimeThreadInput {
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId;
}

export interface ListRuntimeThreadsInput {
  workspaceSessionId: WorkspaceSessionId;
  status?: readonly RuntimeThreadStatus[] | null;
  threadGroupId?: ThreadGroupId | null;
  limit?: number;
}

export interface ReadRuntimeThreadEpisodesInput {
  workspaceSessionId: WorkspaceSessionId;
  threadId?: ThreadId | null;
  threadGroupId?: ThreadGroupId | null;
  defaultThreadId?: ThreadId | null;
  limit?: number;
}

export interface GetRuntimeThreadGroupInput {
  workspaceSessionId: WorkspaceSessionId;
  currentThreadId: ThreadId;
}

export interface RuntimeReadModelStatePortService {
  getCurrentThread(
    input: GetCurrentRuntimeThreadInput,
  ): Effect.Effect<RuntimeThreadCurrentReadModel, StateContractError>;
  listThreads(
    input: ListRuntimeThreadsInput,
  ): Effect.Effect<RuntimeThreadListReadModel, StateContractError>;
  readThreadEpisodes(
    input: ReadRuntimeThreadEpisodesInput,
  ): Effect.Effect<RuntimeThreadEpisodesReadModel, StateContractError>;
  getThreadGroup(
    input: GetRuntimeThreadGroupInput,
  ): Effect.Effect<RuntimeThreadGroupReadModel, StateContractError>;
}

export interface RuntimeReadModelStatePort {
  readonly _tag: "RuntimeReadModelStatePort";
}

export const RuntimeReadModelStatePort = Context.Service<
  RuntimeReadModelStatePort,
  RuntimeReadModelStatePortService
>("@svvy/core/RuntimeReadModelStatePort");
