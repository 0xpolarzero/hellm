import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { SourceScopeDomainInvariant } from "./source-scope-domain-invariant";
import {
  AbsolutePath,
  AgentProfileId,
  AppLogEntryId,
  ArtifactId,
  AttachmentDisplayName,
  Base64String,
  ByteCountSchema,
  CommandId,
  EpisodeId,
  ExtensionExecutionPlanId,
  ExtensionId,
  MessageId,
  MimeType,
  NonNegativeSafeIntegerSchema,
  QueueItemId,
  RecoveryWorkId,
  RequestInputAnswerId,
  RequestInputOptionId,
  RequestInputQuestionId,
  RequestInputRequestId,
  RuntimeAttachmentId,
  RuntimeClientCorrelationId,
  RuntimeClientRequestId,
  RuntimeClientSubmissionId,
  RuntimeClientSubmissionSource,
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  RuntimeApprovalId,
  RuntimeOwnerId,
  SurfaceStreamGenerationId,
  SurfaceStreamSequence,
  SurfacePiSessionId,
  ThreadGroupId,
  ThreadId,
  ToolCallId,
  ToolItemId,
  TurnId,
  UtcDateTime,
  WorktreeId,
  WorkflowRunId,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspaceRelativePath,
  WorkspaceSessionId,
  IsoDateTimeStringSchema,
  JsonValue,
} from "./ids";

import { SnippetSourceSchema } from "./composer-contracts";
import {
  RuntimeContractError,
  RuntimeEventRebaselineRequired,
  RuntimeEventStreamError,
  StateContractError,
} from "./errors";
import {
  decodeUnknownStateInvalidationDescriptorEffect,
  decodeUnknownStateInvalidationDescriptorExit,
  AppReadModelInvalidationSchema,
  StateInvalidationDescriptorSchema,
  type StateInvalidationDescriptor,
  unsafeDecodeStateInvalidationDescriptorSyncForTestsAndBootstrap,
  WorkspaceReadModelInvalidationSchema,
} from "./runtime-invalidation-contracts";
export {
  decodeUnknownStateInvalidationDescriptorEffect,
  decodeUnknownStateInvalidationDescriptorExit,
  AppReadModelInvalidationSchema,
  StateInvalidationDescriptorSchema,
  unsafeDecodeStateInvalidationDescriptorSyncForTestsAndBootstrap,
  WorkspaceReadModelInvalidationSchema,
};
export type {
  AppReadModelInvalidation,
  StateInvalidationDescriptor,
  WorkspaceReadModelInvalidation,
} from "./runtime-invalidation-contracts";
import {
  type InternalRefreshGeneratedPackagesRequest,
  InternalRefreshGeneratedPackagesRequestSchema,
  type RefreshGeneratedPackagesRequest,
  GeneratedPackageBuildStatusSchema,
  GeneratedPackageWorkspaceLinkStatusSchema,
  RefreshGeneratedPackagesRequestSchema,
} from "./generated-package-contracts";
export { InternalRefreshGeneratedPackagesRequestSchema, RefreshGeneratedPackagesRequestSchema };
export type { InternalRefreshGeneratedPackagesRequest, RefreshGeneratedPackagesRequest };
import {
  CommandFactsPayloadSchema,
  CommandResultEnvelopeSchema,
  unsafeDecodeCommandResultEnvelopeSyncForTestsAndBootstrap,
  decodeUnknownCommandResultEnvelopeEffect,
  decodeUnknownCommandResultEnvelopeExit,
  NativeToolResultSchema,
  type CommandFactsPayload,
  type CommandResultEnvelope,
} from "./native-tool-contracts";
import type {
  SetRequestInputBlockingTimeoutInput,
  SetRequestInputBlockingTimeoutResult,
  SetRequestInputVariantInput,
  SetRequestInputVariantResult,
} from "./request-input-settings-contracts";
export {
  CommandFactsPayloadSchema,
  CommandResultEnvelopeSchema,
  unsafeDecodeCommandResultEnvelopeSyncForTestsAndBootstrap,
  decodeUnknownCommandResultEnvelopeEffect,
  decodeUnknownCommandResultEnvelopeExit,
};
export type { CommandFactsPayload, CommandResultEnvelope };

export const CommandArgumentSnapshotEventPayloadSchema = Schema.Struct({
  source: Schema.optionalKey(Schema.String),
  arguments: JsonValue,
  facts: Schema.optionalKey(CommandFactsPayloadSchema),
});
export type CommandArgumentSnapshotEventPayload =
  typeof CommandArgumentSnapshotEventPayloadSchema.Type;

export const CommandOutputEventPayloadSchema = Schema.Struct({
  stream: Schema.Literals(["stdout", "stderr"]),
  source: Schema.optionalKey(Schema.String),
  chunkRef: Schema.optionalKey(ToolItemId),
  text: Schema.optionalKey(Schema.String),
  truncated: Schema.optionalKey(Schema.Boolean),
});
export type CommandOutputEventPayload = typeof CommandOutputEventPayloadSchema.Type;

export const CommandProgressEventPayloadSchema = Schema.Struct({
  source: Schema.String,
  phase: Schema.optionalKey(Schema.String),
  family: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  progress: Schema.optionalKey(Schema.Number),
  facts: Schema.optionalKey(CommandFactsPayloadSchema),
});
export type CommandProgressEventPayload = typeof CommandProgressEventPayloadSchema.Type;

export const CommandPatchSnapshotFileSchema = Schema.Struct({
  path: Schema.String,
  changeType: Schema.Literals(["created", "deleted", "modified"]),
  additions: Schema.Number,
  deletions: Schema.Number,
});
export type CommandPatchSnapshotFile = typeof CommandPatchSnapshotFileSchema.Type;

export const CommandPatchSnapshotEventPayloadSchema = Schema.Struct({
  source: Schema.optionalKey(Schema.String),
  files: Schema.Array(CommandPatchSnapshotFileSchema),
});
export type CommandPatchSnapshotEventPayload = typeof CommandPatchSnapshotEventPayloadSchema.Type;

export const CommandDiagnosticSchema = Schema.Struct({
  severity: Schema.optionalKey(Schema.String),
  message: Schema.String,
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
  column: Schema.optionalKey(Schema.Number),
  code: Schema.optionalKey(Schema.String),
});
export type CommandDiagnostic = typeof CommandDiagnosticSchema.Type;

export const CommandDiagnosticEventPayloadSchema = Schema.Struct({
  source: Schema.optionalKey(Schema.String),
  stage: Schema.optionalKey(Schema.String),
  diagnostics: Schema.Array(CommandDiagnosticSchema),
});
export type CommandDiagnosticEventPayload = typeof CommandDiagnosticEventPayloadSchema.Type;

export const CommandEventPayloadSchema = Schema.Union([
  CommandArgumentSnapshotEventPayloadSchema,
  CommandDiagnosticEventPayloadSchema,
  CommandOutputEventPayloadSchema,
  CommandPatchSnapshotEventPayloadSchema,
  CommandProgressEventPayloadSchema,
]);
export type CommandEventPayload = typeof CommandEventPayloadSchema.Type;

export const ReasoningEffortSchema = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export type ReasoningEffort = typeof ReasoningEffortSchema.Type;

export const ReasoningSelectionSchema = Schema.Struct({
  effort: ReasoningEffortSchema,
});
export type ReasoningSelection = typeof ReasoningSelectionSchema.Type;

export const RUNTIME_TURN_DECISIONS = [
  "reply",
  "exec_command",
  "write_stdin",
  "apply_patch",
  "execute_typescript",
  "list_extensions",
  "load_extension",
  "thread_start",
  "thread_followup",
  "thread_list",
  "thread_request_report",
  "thread_current",
  "thread_group",
  "thread_report",
  "thread_episodes",
  "request_user_input",
] as const;

export const RuntimeTurnDecisionSchema = Schema.Literals([...RUNTIME_TURN_DECISIONS]);

export type RuntimeTurnDecision = typeof RuntimeTurnDecisionSchema.Type;

export const OrchestratorPromptTargetSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  surface: Schema.Literal("orchestrator"),
  surfacePiSessionId: SurfacePiSessionId,
});

export const HandlerPromptTargetSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  surface: Schema.Literal("handler"),
  surfacePiSessionId: SurfacePiSessionId,
  threadId: ThreadId,
});

export const PromptTargetSchema = Schema.Union([
  OrchestratorPromptTargetSchema,
  HandlerPromptTargetSchema,
]);

export type PromptTarget = typeof PromptTargetSchema.Type;

export const WorkflowTaskRuntimeSurfaceTargetSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  surface: Schema.Literal("workflow-task"),
  surfacePiSessionId: SurfacePiSessionId,
  workflowTaskAttemptId: WorkflowTaskAttemptId,
  workflowRunId: Schema.optionalKey(WorkflowRunId),
  threadId: ThreadId,
});

export const RuntimeSurfaceTargetSchema = Schema.Union([
  PromptTargetSchema,
  WorkflowTaskRuntimeSurfaceTargetSchema,
]);

export type WorkflowTaskRuntimeSurfaceTarget = typeof WorkflowTaskRuntimeSurfaceTargetSchema.Type;

export type RuntimeSurfaceTarget = typeof RuntimeSurfaceTargetSchema.Type;

export const RuntimeSubmittedAttachmentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("image"),
    id: Schema.optionalKey(RuntimeAttachmentId),
    name: Schema.optionalKey(AttachmentDisplayName),
    path: Schema.optionalKey(AbsolutePath),
    workspaceRelativePath: Schema.optionalKey(WorkspaceRelativePath),
    dataBase64: Schema.optionalKey(Base64String),
    mimeType: MimeType,
    sizeBytes: Schema.optionalKey(ByteCountSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("file"),
    id: Schema.optionalKey(RuntimeAttachmentId),
    name: Schema.optionalKey(AttachmentDisplayName),
    path: AbsolutePath,
    workspaceRelativePath: Schema.optionalKey(WorkspaceRelativePath),
    mimeType: Schema.optionalKey(MimeType),
    sizeBytes: Schema.optionalKey(ByteCountSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("folder"),
    id: Schema.optionalKey(RuntimeAttachmentId),
    name: Schema.optionalKey(AttachmentDisplayName),
    path: AbsolutePath,
    workspaceRelativePath: Schema.optionalKey(WorkspaceRelativePath),
    mimeType: Schema.optionalKey(MimeType),
    sizeBytes: Schema.optionalKey(ByteCountSchema),
  }),
]);

export type RuntimeSubmittedAttachment = typeof RuntimeSubmittedAttachmentSchema.Type;

export const SentSnippetProvenanceSchema = Schema.Struct({
  mentionId: Schema.String,
  snippetId: Schema.String,
  source: SnippetSourceSchema,
  title: Schema.String,
  path: Schema.optionalKey(Schema.String),
  contentHash: Schema.String,
  arguments: Schema.Array(Schema.String),
  resolvedText: Schema.String,
});

export type SentSnippetProvenance = typeof SentSnippetProvenanceSchema.Type;

export const RuntimeSubmittedMessageSchema = Schema.Struct({
  text: Schema.String,
  attachments: Schema.optionalKey(Schema.Array(RuntimeSubmittedAttachmentSchema)),
  snippetProvenance: Schema.optionalKey(Schema.Array(SentSnippetProvenanceSchema)),
});

export type RuntimeSubmittedMessage = typeof RuntimeSubmittedMessageSchema.Type;

export const RuntimeMessageDeliverySchema = Schema.Literals(["enqueue-and-run", "queue-only"]);
export type RuntimeMessageDelivery = typeof RuntimeMessageDeliverySchema.Type;

export const RuntimeClientSubmissionInputSchema = Schema.Struct({
  submissionId: Schema.optionalKey(RuntimeClientSubmissionId),
  correlationId: Schema.optionalKey(RuntimeClientCorrelationId),
  clientRequestId: Schema.optionalKey(RuntimeClientRequestId),
  source: Schema.optionalKey(RuntimeClientSubmissionSource),
  submittedAt: Schema.optionalKey(IsoDateTimeStringSchema),
  sequence: Schema.optionalKey(NonNegativeSafeIntegerSchema),
});
export type RuntimeClientSubmissionInput = typeof RuntimeClientSubmissionInputSchema.Type;

export const RuntimeClientSubmissionSchema = Schema.Struct({
  submissionId: Schema.optionalKey(RuntimeClientSubmissionId),
  correlationId: Schema.optionalKey(RuntimeClientCorrelationId),
  clientRequestId: Schema.optionalKey(RuntimeClientRequestId),
  source: Schema.optionalKey(RuntimeClientSubmissionSource),
  submittedAt: Schema.optionalKey(UtcDateTime),
  sequence: Schema.optionalKey(NonNegativeSafeIntegerSchema),
});
export type RuntimeClientSubmission = typeof RuntimeClientSubmissionSchema.Type;
export type RuntimeClientSubmissionEncoded = typeof RuntimeClientSubmissionSchema.Encoded;

export const unsafeDecodeRuntimeClientSubmissionInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RuntimeClientSubmissionInputSchema, strictBoundaryParseOptions);
export const decodeUnknownRuntimeClientSubmissionInputExit = Schema.decodeUnknownExit(
  RuntimeClientSubmissionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeClientSubmissionInputEffect = Schema.decodeUnknownEffect(
  RuntimeClientSubmissionInputSchema,
  strictBoundaryParseOptions,
);

export const unsafeDecodeRuntimeClientSubmissionSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RuntimeClientSubmissionSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeClientSubmissionExit = Schema.decodeUnknownExit(
  RuntimeClientSubmissionSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeClientSubmissionEffect = Schema.decodeUnknownEffect(
  RuntimeClientSubmissionSchema,
  strictBoundaryParseOptions,
);

export const StateRevisionSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
).pipe(Schema.brand("StateRevision"));
export type StateRevision = typeof StateRevisionSchema.Type;

export const StateCommandReceiptSchema = Schema.Struct({
  clientRequestId: Schema.Union([Schema.String, Schema.Null]),
  outcome: Schema.Literals(["applied", "duplicate"]),
  committedAt: IsoDateTimeStringSchema,
  stateRevision: StateRevisionSchema,
});
export type StateCommandReceipt = typeof StateCommandReceiptSchema.Type;

export interface StateCommandPostCommitNotificationError {
  readonly type: "state-command-post-commit-notification-error";
  readonly operation: string;
  readonly reason: "publication-failed" | "runtime-shutdown" | "runtime-disposed";
  readonly receipt: StateCommandReceipt;
  readonly message: string;
  readonly affectedReadModels?: readonly StateInvalidationDescriptor[];
}

export const StateCommandPostCommitNotificationErrorSchema = Schema.Struct({
  type: Schema.Literal("state-command-post-commit-notification-error"),
  operation: Schema.String,
  reason: Schema.Literals(["publication-failed", "runtime-shutdown", "runtime-disposed"]),
  receipt: StateCommandReceiptSchema,
  message: Schema.String,
  affectedReadModels: Schema.optionalKey(Schema.Array(StateInvalidationDescriptorSchema)),
});

export const RuntimeOwnerKindSchema = Schema.Literals([
  "desktop-tab",
  "browser-tool",
  "headless",
  "test",
  "runtime-background",
]);
export type RuntimeOwnerKind = typeof RuntimeOwnerKindSchema.Type;

export const RuntimeOwnerRefSchema = Schema.Struct({
  ownerId: RuntimeOwnerId,
  kind: RuntimeOwnerKindSchema,
});
export type RuntimeOwnerRef = typeof RuntimeOwnerRefSchema.Type;

export const AcquireWorkspaceOpenReasonSchema = Schema.Literals([
  "user-open",
  "restore",
  "headless",
  "test",
  "runtime-recovery",
]);
export type AcquireWorkspaceOpenReason = typeof AcquireWorkspaceOpenReasonSchema.Type;

export const AcquireWorkspaceInputSchema = Schema.Struct({
  cwd: AbsolutePath,
  owner: RuntimeOwnerRefSchema,
  openReason: AcquireWorkspaceOpenReasonSchema,
});
export type AcquireWorkspaceInput = typeof AcquireWorkspaceInputSchema.Type;

export const AcquireDefaultWorkspaceOpenReasonSchema = Schema.Literals([
  "startup",
  "new-tab",
  "headless",
  "test",
]);
export type AcquireDefaultWorkspaceOpenReason = typeof AcquireDefaultWorkspaceOpenReasonSchema.Type;

export const AcquireDefaultWorkspaceInputSchema = Schema.Struct({
  owner: RuntimeOwnerRefSchema,
  openReason: AcquireDefaultWorkspaceOpenReasonSchema,
});
export type AcquireDefaultWorkspaceInput = typeof AcquireDefaultWorkspaceInputSchema.Type;

export const WorkspaceReadinessDisabledCapabilitySchema = Schema.Literals([
  "generated-imports",
  "source-watch",
  "link-repair",
]);
export type WorkspaceReadinessDisabledCapability =
  typeof WorkspaceReadinessDisabledCapabilitySchema.Type;

export const WorkspaceReadinessDetailSchema = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("full"),
  }),
  Schema.Struct({
    mode: Schema.Literal("degraded"),
    disabledCapabilities: Schema.Array(WorkspaceReadinessDisabledCapabilitySchema),
    recoveryWorkIds: Schema.Array(RecoveryWorkId),
  }),
]);
export type WorkspaceReadinessDetail = typeof WorkspaceReadinessDetailSchema.Type;

export const AcquireWorkspaceResultSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  cwd: AbsolutePath,
  kind: Schema.Literals(["user", "default"]),
  acquired: Schema.Literals(["created", "existing"]),
  readiness: Schema.Literal("ready"),
  readinessDetail: WorkspaceReadinessDetailSchema,
  stateRevision: StateRevisionSchema,
});
export type AcquireWorkspaceResult = typeof AcquireWorkspaceResultSchema.Type;

export const ReleaseWorkspaceReasonSchema = Schema.Literals([
  "tab-closed",
  "workspace-replaced",
  "headless-complete",
  "shutdown",
  "test",
]);
export type ReleaseWorkspaceReason = typeof ReleaseWorkspaceReasonSchema.Type;

export const ReleaseWorkspaceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  owner: RuntimeOwnerRefSchema,
  releaseReason: ReleaseWorkspaceReasonSchema,
});
export type ReleaseWorkspaceInput = typeof ReleaseWorkspaceInputSchema.Type;

export const ReleaseWorkspaceResultSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  released: Schema.Literal(true),
  remainingOwners: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  lifecycle: Schema.Literals(["active", "idle", "disposed"]),
});
export type ReleaseWorkspaceResult = typeof ReleaseWorkspaceResultSchema.Type;

export const CreateOrchestratorSurfaceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  title: Schema.optionalKey(Schema.String),
  profileId: Schema.optionalKey(AgentProfileId),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type CreateOrchestratorSurfaceInput = typeof CreateOrchestratorSurfaceInputSchema.Type;

export const CreateSurfaceResultSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  target: RuntimeSurfaceTargetSchema,
  created: Schema.Literals(["new", "existing"]),
  stateRevision: StateRevisionSchema,
});
export type CreateSurfaceResult = typeof CreateSurfaceResultSchema.Type;

export const OpenSurfaceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  target: RuntimeSurfaceTargetSchema,
});
export type OpenSurfaceInput = typeof OpenSurfaceInputSchema.Type;

export const OpenSurfaceResultSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  target: RuntimeSurfaceTargetSchema,
  stateRevision: StateRevisionSchema,
});
export type OpenSurfaceResult = typeof OpenSurfaceResultSchema.Type;

export const CloseSurfaceReasonSchema = Schema.Literals([
  "pane-closed",
  "headless-complete",
  "idle-dispose",
  "shutdown",
  "test",
]);
export type CloseSurfaceReason = typeof CloseSurfaceReasonSchema.Type;

export const CloseSurfaceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  target: RuntimeSurfaceTargetSchema,
  closeReason: CloseSurfaceReasonSchema,
});
export type CloseSurfaceInput = typeof CloseSurfaceInputSchema.Type;

export const CloseSurfaceResultSchema = Schema.Struct({
  target: RuntimeSurfaceTargetSchema,
  lifecycle: Schema.Literals(["open", "idle", "disposed"]),
});
export type CloseSurfaceResult = typeof CloseSurfaceResultSchema.Type;

export const SubmitMessageInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  message: RuntimeSubmittedMessageSchema,
  delivery: Schema.optionalKey(RuntimeMessageDeliverySchema),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});

export type SubmitMessageInput = typeof SubmitMessageInputSchema.Type;

export const SubmitMessageResultSchema = Schema.Struct({
  queuedMessageId: QueueItemId,
  target: PromptTargetSchema,
  status: Schema.Literal("queued"),
  receipt: Schema.Struct({
    clientRequestId: Schema.Union([Schema.String, Schema.Null]),
    outcome: Schema.Literals(["accepted", "duplicate"]),
    acceptedAt: IsoDateTimeStringSchema,
    stateRevision: StateRevisionSchema,
  }),
});

export type SubmitMessageResult = typeof SubmitMessageResultSchema.Type;

export const AbortQueuedPromptInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  mode: Schema.Literal("queued"),
  queuedMessageId: QueueItemId,
  reason: Schema.optionalKey(Schema.String),
});

export const AbortActiveTurnPromptInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  mode: Schema.Literal("active-turn"),
  turnId: Schema.optionalKey(TurnId),
  reason: Schema.optionalKey(Schema.String),
});

export const AbortAllForSurfacePromptInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  mode: Schema.Literal("all-for-surface"),
  reason: Schema.optionalKey(Schema.String),
});

export const AbortPromptInputSchema = Schema.Union([
  AbortQueuedPromptInputSchema,
  AbortActiveTurnPromptInputSchema,
  AbortAllForSurfacePromptInputSchema,
]);

export type AbortPromptInput = typeof AbortPromptInputSchema.Type;

export const SteerQueuedMessageInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  queuedMessageId: QueueItemId,
});

export type SteerQueuedMessageInput = typeof SteerQueuedMessageInputSchema.Type;

export const CancelCommandInputSchema = Schema.Struct({
  commandId: CommandId,
  reason: Schema.optionalKey(Schema.String),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});

export type CancelCommandInput = typeof CancelCommandInputSchema.Type;

export const CancelCommandResultSchema = Schema.Struct({
  commandId: CommandId,
  status: Schema.Literals(["cancelling", "cancelled", "already_terminal"]),
});

export type CancelCommandResult = typeof CancelCommandResultSchema.Type;

export const WriteCommandStdinInputSchema = Schema.Struct({
  commandId: CommandId,
  text: Schema.String,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});

export type WriteCommandStdinInput = typeof WriteCommandStdinInputSchema.Type;

export const WriteCommandStdinResultSchema = Schema.Union([
  Schema.Struct({
    commandId: CommandId,
    status: Schema.Literal("accepted"),
    acceptedBytes: NonNegativeSafeIntegerSchema,
  }),
  Schema.Struct({
    commandId: CommandId,
    status: Schema.Literals(["stdin_closed", "not_running", "already_terminal"]),
  }),
]);

export type WriteCommandStdinResult = typeof WriteCommandStdinResultSchema.Type;

export const SourceDomainSchema = Schema.Literals([
  "extensions",
  "workflows",
  "external_instructions",
  "host_snippets",
]);
export type SourceDomain = typeof SourceDomainSchema.Type;

export const SourceInvalidationScopeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("app-global"),
  }),
  Schema.Struct({
    kind: Schema.Literal("workspace"),
    workspaceId: WorkspaceId,
  }),
]);
export type SourceInvalidationScope = typeof SourceInvalidationScopeSchema.Type;

export const SourceInvalidationHintSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  domain: SourceDomainSchema,
  path: AbsolutePath,
  observedAt: Schema.optionalKey(IsoDateTimeStringSchema),
}).pipe(Schema.check(SourceScopeDomainInvariant));
export type SourceInvalidationHint = typeof SourceInvalidationHintSchema.Type;

export const SourceReconcileReasonSchema = Schema.Literals([
  "startup",
  "periodic",
  "watcher-debounce",
  "ignored-path-parent-domain-scan",
  "manual",
  "recovery",
]);
export type SourceReconcileReason = typeof SourceReconcileReasonSchema.Type;

export const SourceReconcileRequestSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  domains: Schema.optionalKey(Schema.Array(SourceDomainSchema)),
  reason: SourceReconcileReasonSchema,
}).pipe(Schema.check(SourceScopeDomainInvariant));
export type SourceReconcileRequest = typeof SourceReconcileRequestSchema.Type;

const SourceFingerprintRecordSchema = Schema.Record(SourceDomainSchema, Schema.String);

export const CommittedSourceInvalidationEventSchema = Schema.Struct({
  domains: Schema.Array(SourceDomainSchema),
  reason: Schema.String.check(Schema.isNonEmpty()),
  sourceFingerprints: SourceFingerprintRecordSchema,
  afterCommit: Schema.Array(StateInvalidationDescriptorSchema),
});
export type CommittedSourceInvalidationEvent = typeof CommittedSourceInvalidationEventSchema.Type;

export const ApplyCommittedSourceInvalidationEventInputSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  event: CommittedSourceInvalidationEventSchema,
}).pipe(Schema.check(SourceScopeDomainInvariant));
export type ApplyCommittedSourceInvalidationEventInput =
  typeof ApplyCommittedSourceInvalidationEventInputSchema.Type;

export const RuntimeEventsInputSchema = Schema.Struct({
  workspaceId: Schema.optionalKey(WorkspaceId),
  workspaceSessionId: Schema.optionalKey(WorkspaceSessionId),
  eventGenerationId: Schema.optionalKey(RuntimeEventGenerationId),
  afterSequence: Schema.optionalKey(RuntimeEventSequence),
  includeAppEvents: Schema.optionalKey(Schema.Boolean),
});

export type RuntimeEventsInput = typeof RuntimeEventsInputSchema.Type;

export const RuntimeEventSubscriptionCloseSchema = Schema.Union([
  Schema.Struct({
    reason: Schema.Literal("closed"),
    eventGenerationId: RuntimeEventGenerationId,
    lastContiguousSequence: RuntimeEventSequence,
    rebaselineRequired: Schema.Literal(false),
  }),
  Schema.Struct({
    reason: Schema.Literals(["slow-consumer", "runtime-shutdown", "runtime-restart"]),
    eventGenerationId: RuntimeEventGenerationId,
    lastContiguousSequence: RuntimeEventSequence,
    rebaselineRequired: Schema.Literal(true),
  }),
]);

export type RuntimeEventSubscriptionClose = typeof RuntimeEventSubscriptionCloseSchema.Type;

export const ActorKindSchema = Schema.Literals(["orchestrator", "handler", "workflow-task"]);
export type ActorKind = typeof ActorKindSchema.Type;

export const SurfaceStreamPatchInputSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("user_message_committed"),
    messageId: MessageId,
    queueItemId: Schema.optionalKey(QueueItemId),
    message: RuntimeSubmittedMessageSchema,
    submittedAt: IsoDateTimeStringSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("assistant_message_started"),
    messageId: MessageId,
    turnId: TurnId,
    createdAt: IsoDateTimeStringSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("assistant_text_delta"),
    messageId: MessageId,
    contentIndex: NonNegativeSafeIntegerSchema,
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("assistant_thinking_delta"),
    messageId: MessageId,
    contentIndex: NonNegativeSafeIntegerSchema,
    delta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_arguments_snapshot"),
    messageId: MessageId,
    toolCallId: ToolCallId,
    commandId: Schema.optionalKey(CommandId),
    contentIndex: NonNegativeSafeIntegerSchema,
    snapshotRef: ToolItemId,
  }),
  Schema.Struct({
    type: Schema.Literal("active_command"),
    messageId: MessageId,
    toolCallId: ToolCallId,
    commandId: CommandId,
    contentIndex: NonNegativeSafeIntegerSchema,
    status: Schema.Literals(["accepted", "running", "waiting", "finished"]),
  }),
  Schema.Struct({
    type: Schema.Literal("assistant_message_finished"),
    messageId: MessageId,
    status: Schema.Literals(["completed", "failed", "cancelled"]),
    finishedAt: IsoDateTimeStringSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("prompt_status"),
    turnId: TurnId,
    status: Schema.Literals(["running", "waiting", "completed", "failed", "cancelled"]),
  }),
  Schema.Struct({
    type: Schema.Literal("stream_reset"),
    reason: Schema.Literals(["rebaseline_required", "runtime_recovered", "surface_reopened"]),
    latestStreamSequence: SurfaceStreamSequence,
  }),
]);

export type SurfaceStreamPatchInput = typeof SurfaceStreamPatchInputSchema.Type;

export const RuntimeEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("surface.stream"),
    workspaceId: WorkspaceId,
    target: RuntimeSurfaceTargetSchema,
    eventGenerationId: RuntimeEventGenerationId,
    sequence: RuntimeEventSequence,
    streamGenerationId: SurfaceStreamGenerationId,
    streamSequence: SurfaceStreamSequence,
    patch: SurfaceStreamPatchInputSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("surface.changed"),
    eventGenerationId: RuntimeEventGenerationId,
    sequence: RuntimeEventSequence,
    workspaceId: WorkspaceId,
    target: RuntimeSurfaceTargetSchema,
    reason: Schema.Literals([
      "surface.updated",
      "prompt.started",
      "prompt.settled",
      "background.started",
      "surface.closed",
    ]),
  }),
  Schema.Struct({
    type: Schema.Literal("command.changed"),
    eventGenerationId: RuntimeEventGenerationId,
    sequence: RuntimeEventSequence,
    workspaceId: WorkspaceId,
    workspaceSessionId: WorkspaceSessionId,
    target: Schema.optionalKey(RuntimeSurfaceTargetSchema),
    turnId: Schema.optionalKey(TurnId),
    commandId: CommandId,
    change: Schema.Struct({
      kind: Schema.Literals([
        "created",
        "argument_snapshot",
        "accepted",
        "started",
        "output",
        "progress",
        "diagnostic",
        "patch_snapshot",
        "child_command",
        "artifact_linked",
        "approval",
        "wait",
        "finished",
      ]),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("queue.changed"),
    eventGenerationId: RuntimeEventGenerationId,
    sequence: RuntimeEventSequence,
    workspaceId: WorkspaceId,
    target: RuntimeSurfaceTargetSchema,
    queuedMessageId: QueueItemId,
    status: Schema.Literals([
      "queued",
      "steering",
      "dispatching",
      "delivered",
      "failed",
      "cancelled",
    ]),
  }),
  Schema.Struct({
    type: Schema.Literal("turn.changed"),
    eventGenerationId: RuntimeEventGenerationId,
    sequence: RuntimeEventSequence,
    workspaceId: WorkspaceId,
    target: RuntimeSurfaceTargetSchema,
    turnId: TurnId,
    status: Schema.Literals(["running", "waiting", "completed", "failed", "cancelled"]),
  }),
  Schema.Struct({
    type: Schema.Literal("workflow_task_attempt.changed"),
    eventGenerationId: RuntimeEventGenerationId,
    sequence: RuntimeEventSequence,
    workspaceId: WorkspaceId,
    target: WorkflowTaskRuntimeSurfaceTargetSchema,
    workflowTaskAttemptId: WorkflowTaskAttemptId,
    status: Schema.Literals(["running", "waiting", "completed", "failed", "cancelled"]),
  }),
  Schema.Struct({
    type: Schema.Literal("workspace_read_model.changed"),
    eventGenerationId: RuntimeEventGenerationId,
    sequence: RuntimeEventSequence,
    workspaceId: WorkspaceId,
    invalidation: WorkspaceReadModelInvalidationSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("app_read_model.changed"),
    eventGenerationId: RuntimeEventGenerationId,
    sequence: RuntimeEventSequence,
    invalidation: AppReadModelInvalidationSchema,
  }),
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal("runtime.recovery"),
      eventGenerationId: RuntimeEventGenerationId,
      sequence: RuntimeEventSequence,
      scope: Schema.Literal("workspace"),
      workspaceId: WorkspaceId,
      workId: RecoveryWorkId,
      status: Schema.Literals([
        "pending",
        "claimed",
        "blocked",
        "completed",
        "failed",
        "cancelled",
      ]),
    }),
    Schema.Struct({
      type: Schema.Literal("runtime.recovery"),
      eventGenerationId: RuntimeEventGenerationId,
      sequence: RuntimeEventSequence,
      scope: Schema.Literal("app"),
      workId: RecoveryWorkId,
      status: Schema.Literals([
        "pending",
        "claimed",
        "blocked",
        "completed",
        "failed",
        "cancelled",
      ]),
    }),
  ]),
]);

export type RuntimeEvent = typeof RuntimeEventSchema.Type;

export const RuntimeEventErrorSchema = Schema.Union([
  RuntimeEventRebaselineRequired,
  RuntimeEventStreamError,
]);

export const RuntimeFacadeErrorContractSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("typed-failure"),
    error: Schema.Union([RuntimeContractError, RuntimeEventErrorSchema]),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("defect"),
    message: Schema.String,
    defectClass: Schema.optionalKey(Schema.String),
    diagnosticAppLogEntryId: Schema.optionalKey(AppLogEntryId),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("interrupted"),
    interruptReason: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("aborted"),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("disposed"),
  }),
]);
export type RuntimeFacadeErrorContract = typeof RuntimeFacadeErrorContractSchema.Type;

export const StateFacadeErrorContractSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("typed-failure"),
    error: StateContractError,
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("post-commit-notification-failed"),
    receipt: StateCommandReceiptSchema,
    notificationError: StateCommandPostCommitNotificationErrorSchema,
    message: Schema.String,
    diagnosticAppLogEntryId: Schema.optionalKey(AppLogEntryId),
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("defect"),
    message: Schema.String,
    defectClass: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("interrupted"),
    interruptReason: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("aborted"),
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("disposed"),
  }),
]);
export type StateFacadeErrorContract = typeof StateFacadeErrorContractSchema.Type;

const RuntimeBoundaryParseOptions = strictBoundaryParseOptions;
export const ExtensionUsageStateSchema = Schema.Literals(["loaded", "available", "unavailable"]);
export type ExtensionUsageState = typeof ExtensionUsageStateSchema.Type;

export const ExtensionCategorySchema = Schema.Literals(["builtin", "user", "external_instruction"]);
export type ExtensionCategory = typeof ExtensionCategorySchema.Type;

export const ExtensionInterfaceKindSchema = Schema.Literals([
  "instructions",
  "native_tool",
  "svvyx",
]);
export type ExtensionInterfaceKind = typeof ExtensionInterfaceKindSchema.Type;

export const ThreadHistoryModeSchema = Schema.Literals(["isolated", "forked"]);
export type ThreadHistoryMode = typeof ThreadHistoryModeSchema.Type;

const ExtensionUsageOverrideMapSchema = Schema.Record(Schema.String, ExtensionUsageStateSchema);

export const RunTaskAgentMessageSchema = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String.check(Schema.isNonEmpty()),
});

export type RunTaskAgentMessage = typeof RunTaskAgentMessageSchema.Type;

export const RunTaskAgentOperationSchema = Schema.Literal("runTaskAgent");
export type RunTaskAgentOperation = typeof RunTaskAgentOperationSchema.Type;

export const TaskAgentParametersSourceSchema = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  label: Schema.String.check(Schema.isNonEmpty()),
  provider: Schema.String.check(Schema.isNonEmpty()),
  model: Schema.String.check(Schema.isNonEmpty()),
  reasoning: ReasoningSelectionSchema,
  instructions: Schema.String,
  overrides: Schema.optionalKey(ExtensionUsageOverrideMapSchema),
});
export type TaskAgentParametersSource = typeof TaskAgentParametersSourceSchema.Type;

export const SmithersObservedJsonSchema = Schema.Json;
export type SmithersObservedJson = typeof SmithersObservedJsonSchema.Type;

export const SmithersTaskContextSnapshotSchema = Schema.Struct({
  run: Schema.optionalKey(SmithersObservedJsonSchema),
  node: Schema.optionalKey(SmithersObservedJsonSchema),
  rootDir: Schema.optionalKey(AbsolutePath),
});
export type SmithersTaskContextSnapshot = typeof SmithersTaskContextSnapshotSchema.Type;

export const SmithersTaskSourceContextSnapshotSchema = Schema.Struct({
  run: Schema.optionalKey(SmithersObservedJsonSchema),
  node: Schema.optionalKey(SmithersObservedJsonSchema),
  rootDir: Schema.optionalKey(Schema.String),
});
export type SmithersTaskSourceContextSnapshot = typeof SmithersTaskSourceContextSnapshotSchema.Type;

export const SmithersTaskAttemptIdentitySchema = Schema.Struct({
  runId: Schema.String.check(Schema.isNonEmpty()),
  nodeId: Schema.String.check(Schema.isNonEmpty()),
  iteration: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  attempt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type SmithersTaskAttemptIdentity = typeof SmithersTaskAttemptIdentitySchema.Type;

export const RunTaskAgentPromptSourceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("prompt"),
    prompt: Schema.String.check(Schema.isNonEmpty()),
  }),
  Schema.Struct({
    kind: Schema.Literal("messages"),
    messages: Schema.Array(RunTaskAgentMessageSchema).check(Schema.isNonEmpty()),
  }),
]);
export type RunTaskAgentPromptSource = typeof RunTaskAgentPromptSourceSchema.Type;

export const WorkflowTaskAgentContextSchema = Schema.Struct({
  runId: Schema.String,
  nodeId: Schema.String,
  iteration: Schema.Number,
  attempt: Schema.Number,
});

export type WorkflowTaskAgentContext = typeof WorkflowTaskAgentContextSchema.Type;

const RunTaskAgentSourceInputBaseFields = {
  operation: RunTaskAgentOperationSchema,
  bridgeRequestId: Schema.optionalKey(Schema.String),
  agent: TaskAgentParametersSourceSchema,
  taskIdentity: SmithersTaskAttemptIdentitySchema,
  smithersContext: Schema.optionalKey(SmithersTaskSourceContextSnapshotSchema),
  promptSource: RunTaskAgentPromptSourceSchema,
  workspaceSessionId: Schema.String,
  sourceCommandId: Schema.String,
} as const;

export const RunTaskAgentSourceInputSchema = Schema.Struct(RunTaskAgentSourceInputBaseFields);
export type RunTaskAgentSourceInput = typeof RunTaskAgentSourceInputSchema.Type;

const RunTaskAgentInputBaseFields = {
  operation: RunTaskAgentOperationSchema,
  bridgeRequestId: Schema.optionalKey(Schema.String),
  agent: TaskAgentParametersSourceSchema,
  taskIdentity: SmithersTaskAttemptIdentitySchema,
  smithersContext: Schema.optionalKey(SmithersTaskContextSnapshotSchema),
  promptSource: RunTaskAgentPromptSourceSchema,
  workspaceSessionId: WorkspaceSessionId,
  sourceCommandId: CommandId,
} as const;

export const RunTaskAgentInputSchema = Schema.Struct(RunTaskAgentInputBaseFields);
export type RunTaskAgentInput = typeof RunTaskAgentInputSchema.Type;

export const AuthenticatedRunTaskAgentInputSchema = Schema.Struct({
  auth: Schema.Struct({
    kind: Schema.Literal("bearer"),
    token: Schema.String.check(Schema.isNonEmpty()),
    transport: Schema.Literal("loopback-http"),
  }),
  request: RunTaskAgentSourceInputSchema,
});
export type AuthenticatedRunTaskAgentInput = typeof AuthenticatedRunTaskAgentInputSchema.Type;

export const RunTaskAgentResultSchema = Schema.Struct({
  text: Schema.String,
  usage: Schema.optionalKey(SmithersObservedJsonSchema),
  output: Schema.optionalKey(SmithersObservedJsonSchema),
});

export type RunTaskAgentResult = typeof RunTaskAgentResultSchema.Type;

export const RunTaskAgentErrorCodeSchema = Schema.Literals([
  "unauthorized",
  "forbidden",
  "invalid_request",
  "payload_too_large",
  "bridge_request_conflict",
  "source_command_not_found",
  "source_command_not_handler_owned",
  "source_command_terminal",
  "task_attempt_cancelled",
  "task_attempt_failed",
]);
export type RunTaskAgentErrorCode = typeof RunTaskAgentErrorCodeSchema.Type;

export const RunTaskAgentErrorSchema = Schema.Struct({
  error: RunTaskAgentErrorCodeSchema,
  message: Schema.String,
  retryable: Schema.Boolean,
  requestId: Schema.optionalKey(Schema.String),
  workspaceSessionId: Schema.optionalKey(Schema.String),
  sourceCommandId: Schema.optionalKey(Schema.String),
  taskAttemptId: Schema.optionalKey(Schema.String),
});

export type RunTaskAgentError = typeof RunTaskAgentErrorSchema.Type;

export const ValidatedTaskAgentParametersSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  reasoning: ReasoningSelectionSchema,
  instructions: Schema.String,
  overrides: Schema.optionalKey(ExtensionUsageOverrideMapSchema),
});

export type ValidatedTaskAgentParameters = typeof ValidatedTaskAgentParametersSchema.Type;

export const SurfaceQueueItemKindSchema = Schema.Literals([
  "user_message",
  "initial_handler_start",
  "thread_followup",
  "report_request",
  "thread_report_notification",
  "request_user_input_answer",
  "workflow_task_agent_start",
]);

export type SurfaceQueueItemKind = typeof SurfaceQueueItemKindSchema.Type;

export const HandlerInheritedHistoryBlockSchema = Schema.Struct({
  mode: Schema.Literal("forked"),
  sourceSurfacePiSessionId: SurfacePiSessionId,
  sourceTurnId: Schema.optionalKey(TurnId),
  summary: Schema.String,
  includedMessageIds: Schema.Array(MessageId),
});

export type HandlerInheritedHistoryBlock = typeof HandlerInheritedHistoryBlockSchema.Type;

export const HandlerThreadInitialQueueInputSchema = Schema.Struct({
  idempotencyKey: Schema.optionalKey(Schema.String),
  priority: Schema.optionalKey(Schema.Literals(["interactive", "runtime", "background"])),
  notBefore: Schema.optionalKey(Schema.String),
});

export type HandlerThreadInitialQueueInput = typeof HandlerThreadInitialQueueInputSchema.Type;

export const StartHandlerThreadItemSchema = Schema.Struct({
  objective: Schema.String.check(Schema.isNonEmpty()),
  worktreeId: Schema.optionalKey(WorktreeId),
  history: Schema.optionalKey(Schema.Literals(["isolated", "forked"])),
  overrides: Schema.optionalKey(ExtensionUsageOverrideMapSchema),
  initialQueue: Schema.optionalKey(HandlerThreadInitialQueueInputSchema),
});

export type StartHandlerThreadItem = typeof StartHandlerThreadItemSchema.Type;

export const StartHandlerThreadRequestSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  threadGroupId: Schema.optionalKey(ThreadGroupId),
  sourceCommandId: CommandId,
  threads: Schema.Array(StartHandlerThreadItemSchema).check(Schema.isNonEmpty()),
});

export type StartHandlerThreadRequest = typeof StartHandlerThreadRequestSchema.Type;

export const RequestUserInputAnswerQueuePayloadSchema = Schema.Struct({
  kind: Schema.Literal("request_user_input_answer"),
  requestId: RequestInputRequestId,
  questionId: RequestInputQuestionId,
  answerId: RequestInputAnswerId,
  delivery: RuntimeMessageDeliverySchema,
});

export type RequestUserInputAnswerQueuePayload =
  typeof RequestUserInputAnswerQueuePayloadSchema.Type;

export const UserMessageQueuePayloadSchema = Schema.Struct({
  kind: Schema.Literal("user_message"),
  message: RuntimeSubmittedMessageSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});

export const InitialHandlerStartQueuePayloadSchema = Schema.Struct({
  kind: Schema.Literal("initial_handler_start"),
  threadId: ThreadId,
  threadGroupId: ThreadGroupId,
  objective: Schema.String,
  inheritedHistory: Schema.optionalKey(HandlerInheritedHistoryBlockSchema),
  worktreeId: Schema.optionalKey(WorktreeId),
  overrides: Schema.optionalKey(ExtensionUsageOverrideMapSchema),
});

export const ThreadFollowupQueuePayloadSchema = Schema.Struct({
  kind: Schema.Literal("thread_followup"),
  threadIds: Schema.optionalKey(Schema.Array(ThreadId)),
  threadGroupId: Schema.optionalKey(ThreadGroupId),
  message: Schema.String,
  sender: Schema.Literals(["user", "orchestrator", "runtime"]),
  activate: Schema.optionalKey(Schema.Boolean),
});

export const ReportRequestQueuePayloadSchema = Schema.Struct({
  kind: Schema.Literal("report_request"),
  threadId: Schema.optionalKey(ThreadId),
  threadGroupId: Schema.optionalKey(ThreadGroupId),
  reason: Schema.optionalKey(Schema.String),
  expectedEpisodeKind: Schema.Literal("report"),
});

export const ThreadReportNotificationQueuePayloadSchema = Schema.Struct({
  kind: Schema.Literal("thread_report_notification"),
  sourceThreadId: ThreadId,
  episodeId: EpisodeId,
  notificationKind: Schema.Literals(["update", "conclusion"]),
});

export const WorkflowTaskAgentStartQueuePayloadSchema = Schema.Struct({
  kind: Schema.Literal("workflow_task_agent_start"),
  workflowTaskAttemptId: WorkflowTaskAttemptId,
  taskIdentity: SmithersTaskAttemptIdentitySchema,
  smithersContext: Schema.optionalKey(SmithersTaskContextSnapshotSchema),
  agent: ValidatedTaskAgentParametersSchema,
  promptSource: RunTaskAgentPromptSourceSchema,
});

export const QueueItemPayloadSchema = Schema.Union([
  UserMessageQueuePayloadSchema,
  InitialHandlerStartQueuePayloadSchema,
  ThreadFollowupQueuePayloadSchema,
  ReportRequestQueuePayloadSchema,
  ThreadReportNotificationQueuePayloadSchema,
  RequestUserInputAnswerQueuePayloadSchema,
  WorkflowTaskAgentStartQueuePayloadSchema,
]);

export type QueueItemPayload = typeof QueueItemPayloadSchema.Type;

const QueueItemRequestBaseFields = {
  priority: Schema.optionalKey(Schema.Literals(["interactive", "runtime", "background"])),
  idempotencyKey: Schema.String,
  sourceCommandId: Schema.optionalKey(CommandId),
  notBefore: Schema.optionalKey(Schema.String),
} as const;

export const InsertQueueItemRequestSchema = Schema.Union([
  Schema.Struct({
    ...QueueItemRequestBaseFields,
    target: HandlerPromptTargetSchema,
    kind: Schema.Literal("initial_handler_start"),
    payload: InitialHandlerStartQueuePayloadSchema,
  }),
  Schema.Struct({
    ...QueueItemRequestBaseFields,
    target: HandlerPromptTargetSchema,
    kind: Schema.Literal("thread_followup"),
    payload: ThreadFollowupQueuePayloadSchema,
  }),
  Schema.Struct({
    ...QueueItemRequestBaseFields,
    target: HandlerPromptTargetSchema,
    kind: Schema.Literal("report_request"),
    payload: ReportRequestQueuePayloadSchema,
  }),
  Schema.Struct({
    ...QueueItemRequestBaseFields,
    sourceCommandId: CommandId,
    target: OrchestratorPromptTargetSchema,
    kind: Schema.Literal("thread_report_notification"),
    payload: ThreadReportNotificationQueuePayloadSchema,
  }),
  Schema.Struct({
    ...QueueItemRequestBaseFields,
    target: RuntimeSurfaceTargetSchema,
    kind: Schema.Literal("request_user_input_answer"),
    payload: RequestUserInputAnswerQueuePayloadSchema,
  }),
  Schema.Struct({
    ...QueueItemRequestBaseFields,
    sourceCommandId: CommandId,
    target: WorkflowTaskRuntimeSurfaceTargetSchema,
    kind: Schema.Literal("workflow_task_agent_start"),
    payload: WorkflowTaskAgentStartQueuePayloadSchema,
  }),
]);

export type InsertQueueItemRequest = typeof InsertQueueItemRequestSchema.Type;

export const UpdateActorExtensionBindingRequestSchema = Schema.Struct({
  target: PromptTargetSchema,
  extensionId: ExtensionId,
  usage: ExtensionUsageStateSchema,
  reason: Schema.Literals([
    "load_extension",
    "user-profile-edit",
    "composer-control",
    "source-refresh",
  ]),
  sourceCommandId: Schema.optionalKey(CommandId),
});

export type UpdateActorExtensionBindingRequest =
  typeof UpdateActorExtensionBindingRequestSchema.Type;

export const RecordEpisodeRequestSchema = Schema.Struct({
  scope: Schema.Literal("handler-thread"),
  workspaceSessionId: WorkspaceSessionId,
  threadId: ThreadId,
  threadGroupId: ThreadGroupId,
  sourceCommandId: Schema.optionalKey(CommandId),
  kind: Schema.Literals(["change", "clarification", "report", "handoff", "conclusion"]),
  summary: Schema.String,
  body: Schema.optionalKey(Schema.String),
  outcome: Schema.optionalKey(Schema.Literals(["completed", "failed", "blocked", "cancelled"])),
  relatedCommandIds: Schema.optionalKey(Schema.Array(CommandId)),
  relatedArtifactIds: Schema.optionalKey(Schema.Array(ArtifactId)),
  relatedWorkflowRunIds: Schema.optionalKey(Schema.Array(WorkflowRunId)),
  notifyOrchestrator: Schema.optionalKey(Schema.Boolean),
});

export type RecordEpisodeRequest = typeof RecordEpisodeRequestSchema.Type;

export const RequestUserInputAnswerSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("option"), optionId: RequestInputOptionId }),
  Schema.Struct({ kind: Schema.Literal("custom"), text: Schema.String }),
]);

export type RequestUserInputAnswer = typeof RequestUserInputAnswerSchema.Type;

export const AnswerRequestInputInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  requestId: RequestInputRequestId,
  questionId: RequestInputQuestionId,
  answer: RequestUserInputAnswerSchema,
  delivery: RuntimeMessageDeliverySchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});

export type AnswerRequestInputInput = typeof AnswerRequestInputInputSchema.Type;

export const AnswerRequestInputDeliveryResultSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("blocking-resolved"),
    queuedItemId: Schema.Null,
  }),
  Schema.Struct({
    kind: Schema.Literal("blocking-open"),
    queuedItemId: Schema.Null,
  }),
  Schema.Struct({
    kind: Schema.Literal("nonblocking-queued"),
    queuedItemId: QueueItemId,
  }),
  Schema.Struct({
    kind: Schema.Literal("nonblocking-recorded"),
    queuedItemId: Schema.Null,
  }),
]);

export const AnswerRequestInputResultSchema = Schema.Struct({
  requestId: RequestInputRequestId,
  questionId: RequestInputQuestionId,
  status: Schema.Literals(["recorded", "duplicate"]),
  delivery: AnswerRequestInputDeliveryResultSchema,
});

export type AnswerRequestInputResult = typeof AnswerRequestInputResultSchema.Type;

export const SetRequestInputTimerPausedInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  requestId: RequestInputRequestId,
  paused: Schema.Boolean,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});

export type SetRequestInputTimerPausedInput = typeof SetRequestInputTimerPausedInputSchema.Type;

export const SetRequestInputTimerPausedResultSchema = Schema.Struct({
  requestId: RequestInputRequestId,
});

export type SetRequestInputTimerPausedResult = typeof SetRequestInputTimerPausedResultSchema.Type;

export const RequestUserInputResolvedAnswerSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("option"),
    label: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("custom"), text: Schema.String }),
]);

export type RequestUserInputResolvedAnswer = typeof RequestUserInputResolvedAnswerSchema.Type;

export const RequestUserInputAnswerDeliveryPayloadSchema = Schema.Struct({
  type: Schema.Literal("request_user_input.answer"),
  title: Schema.String.check(Schema.isNonEmpty()),
  question: Schema.String.check(Schema.isNonEmpty()),
  originalAnswer: RequestUserInputResolvedAnswerSchema,
  userAnswer: RequestUserInputResolvedAnswerSchema,
});

export type RequestUserInputAnswerDeliveryPayload =
  typeof RequestUserInputAnswerDeliveryPayloadSchema.Type;

type RequestInputChoiceQuestionRequestShape = {
  readonly options: ReadonlyArray<{
    readonly recommended?: true | undefined;
  }>;
};

const RequestInputChoiceQuestionInvariant = Schema.makeFilter(
  (question: RequestInputChoiceQuestionRequestShape) => {
    const recommendedCount = question.options.filter((option) => option.recommended).length;
    if (recommendedCount !== 1) {
      return {
        path: ["options"],
        issue: "choice request-input questions require exactly one recommended option",
      };
    }
    return true;
  },
  { expected: "a valid choice request-input question" },
);

export const RequestInputChoiceOptionRequestSchema = Schema.Struct({
  label: Schema.String.check(Schema.isNonEmpty()),
  description: Schema.String.check(Schema.isNonEmpty()),
  recommended: Schema.optionalKey(Schema.Literal(true)),
});

export type RequestInputChoiceOptionRequest = typeof RequestInputChoiceOptionRequestSchema.Type;

export const RequestInputChoiceQuestionRequestSchema = Schema.Struct({
  title: Schema.String.check(Schema.isNonEmpty()),
  question: Schema.String.check(Schema.isNonEmpty()),
  options: Schema.Array(RequestInputChoiceOptionRequestSchema).pipe(
    Schema.check(Schema.isLengthBetween(2, 3)),
  ),
}).pipe(Schema.check(RequestInputChoiceQuestionInvariant));

export type RequestInputChoiceQuestionRequest = typeof RequestInputChoiceQuestionRequestSchema.Type;

export const RequestInputFreeformQuestionRequestSchema = Schema.Struct({
  title: Schema.String.check(Schema.isNonEmpty()),
  question: Schema.String.check(Schema.isNonEmpty()),
  defaultAnswer: Schema.String.check(Schema.isNonEmpty()),
});

export type RequestInputFreeformQuestionRequest =
  typeof RequestInputFreeformQuestionRequestSchema.Type;

export const RequestInputQuestionRequestSchema = Schema.Union([
  RequestInputChoiceQuestionRequestSchema,
  RequestInputFreeformQuestionRequestSchema,
]);

export type RequestInputQuestionRequest = typeof RequestInputQuestionRequestSchema.Type;

export const CreateRequestInputRequestSchema = Schema.Struct({
  target: PromptTargetSchema,
  sourceCommandId: CommandId,
  questions: Schema.Array(RequestInputQuestionRequestSchema).pipe(
    Schema.check(Schema.isLengthBetween(1, 3)),
  ),
});

export type CreateRequestInputRequest = typeof CreateRequestInputRequestSchema.Type;

export const RuntimeApprovalRequestSchema = Schema.Struct({
  target: RuntimeSurfaceTargetSchema,
  sourceCommandId: CommandId,
  approvalKind: Schema.Literals([
    "shell",
    "apply_patch",
    "dependency",
    "extension_env",
    "external_editor",
  ]),
  title: Schema.String,
  reason: Schema.String,
});

export type RuntimeApprovalRequest = typeof RuntimeApprovalRequestSchema.Type;

export const RuntimeApprovalDecisionSchema = Schema.Literals(["approved", "denied"]);
export type RuntimeApprovalDecision = typeof RuntimeApprovalDecisionSchema.Type;

export const AnswerRuntimeApprovalInputSchema = Schema.Struct({
  approvalId: RuntimeApprovalId,
  decision: RuntimeApprovalDecisionSchema,
  reason: Schema.optionalKey(Schema.String),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type AnswerRuntimeApprovalInput = typeof AnswerRuntimeApprovalInputSchema.Type;

export const AnswerRuntimeApprovalResultSchema = Schema.Struct({
  approvalId: RuntimeApprovalId,
  commandId: CommandId,
  status: RuntimeApprovalDecisionSchema,
});
export type AnswerRuntimeApprovalResult = typeof AnswerRuntimeApprovalResultSchema.Type;

export const RefreshGeneratedContextReasonSchema = Schema.Literals([
  "extension-source-changed",
  "external-instruction-changed",
  "profile-settings-changed",
  "load-extension",
  "startup-recovery",
  "workflow-task-agent-start",
]);

export const RefreshGeneratedContextRequestSchema = Schema.Union([
  Schema.Struct({
    scope: Schema.Literal("target"),
    target: RuntimeSurfaceTargetSchema,
    actorKind: Schema.optionalKey(ActorKindSchema),
    reason: RefreshGeneratedContextReasonSchema,
    sourceCommandId: Schema.optionalKey(CommandId),
    refreshBoundSurfaceBeforeNextTurn: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    scope: Schema.Literal("workspace"),
    workspaceId: WorkspaceId,
    actorKind: Schema.optionalKey(ActorKindSchema),
    reason: Schema.Literals([
      "extension-source-changed",
      "external-instruction-changed",
      "profile-settings-changed",
      "startup-recovery",
    ]),
    sourceCommandId: Schema.optionalKey(CommandId),
  }),
]);

export type RefreshGeneratedContextRequest = typeof RefreshGeneratedContextRequestSchema.Type;

export const GeneratedPackagesRefreshResultSchema = Schema.Union([
  Schema.Struct({
    scope: Schema.Literal("app-global"),
    packages: Schema.Array(GeneratedPackageBuildStatusSchema),
    workspaceLinks: Schema.Array(GeneratedPackageWorkspaceLinkStatusSchema).pipe(
      Schema.check(Schema.isLengthBetween(0, 0)),
    ),
    recoveryWorkIds: Schema.Array(RecoveryWorkId),
  }),
  Schema.Struct({
    scope: Schema.Literal("workspace-link-repair"),
    packages: Schema.Array(GeneratedPackageBuildStatusSchema).pipe(
      Schema.check(Schema.isLengthBetween(0, 0)),
    ),
    workspaceLinks: Schema.Array(GeneratedPackageWorkspaceLinkStatusSchema),
    recoveryWorkIds: Schema.Array(RecoveryWorkId),
  }),
]);
export type GeneratedPackagesRefreshResult = typeof GeneratedPackagesRefreshResultSchema.Type;

export const SourceReconcileResultSchema = Schema.Struct({
  changedReadModelCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  generatedPackageRefreshes: Schema.Array(GeneratedPackagesRefreshResultSchema),
  recoveryWorkIds: Schema.Array(RecoveryWorkId),
});
export type SourceReconcileResult = typeof SourceReconcileResultSchema.Type;

export const RuntimeEffectRequestSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("handler_thread.start"),
    input: StartHandlerThreadRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("queue.insert"),
    input: InsertQueueItemRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("actor_extension_binding.update"),
    input: UpdateActorExtensionBindingRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("episode.record"),
    input: RecordEpisodeRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("request_input.create"),
    input: CreateRequestInputRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("generated_context.refresh"),
    input: RefreshGeneratedContextRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("generated_packages.refresh"),
    input: InternalRefreshGeneratedPackagesRequestSchema,
  }),
]);

export type RuntimeEffectRequest = typeof RuntimeEffectRequestSchema.Type;

export const RuntimeExtensionUsageContextImpactTransportInputSchema = Schema.Struct({
  agentProfile: Schema.String,
  profileId: AgentProfileId,
});
export type RuntimeExtensionUsageContextImpactTransportInput =
  typeof RuntimeExtensionUsageContextImpactTransportInputSchema.Type;

export const RuntimeExtensionUsageProfileKeyTransportSchema = Schema.Union([
  Schema.TemplateLiteral(["orchestrator:", Schema.String.check(Schema.isNonEmpty())]),
  Schema.Literal("handler:threadHandler"),
]);
export type RuntimeExtensionUsageProfileKeyTransport =
  typeof RuntimeExtensionUsageProfileKeyTransportSchema.Type;

export const RuntimeExtensionSnapshotContextImpactTransportInputSchema = Schema.Struct({
  affectedExtensionIds: Schema.Array(ExtensionId),
  affectedUsageProfiles: Schema.Array(RuntimeExtensionUsageProfileKeyTransportSchema),
  removedUserExtensionIds: Schema.Array(ExtensionId),
});
export type RuntimeExtensionSnapshotContextImpactTransportInput =
  typeof RuntimeExtensionSnapshotContextImpactTransportInputSchema.Type;

export const SvvyxRuntimeEffectTransportRequestSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("extension_usage.context_impact"),
    input: RuntimeExtensionUsageContextImpactTransportInputSchema,
    target: Schema.Literals(["extension_usage", "extension_usage_revert"]),
  }),
  Schema.Struct({
    type: Schema.Literal("extension_snapshot.context_impact"),
    input: RuntimeExtensionSnapshotContextImpactTransportInputSchema,
    target: Schema.Literal("snapshot_load"),
  }),
]);
export type SvvyxRuntimeEffectTransportRequest =
  typeof SvvyxRuntimeEffectTransportRequestSchema.Type;

export const SvvyxRuntimeEffectTransportIntentSchema = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  kind: Schema.Literal("runtime_effect.request"),
  request: SvvyxRuntimeEffectTransportRequestSchema,
});
export type SvvyxRuntimeEffectTransportIntent = typeof SvvyxRuntimeEffectTransportIntentSchema.Type;

const StringRecordSchema = Schema.Record(Schema.String, Schema.String);

export const ExtensionExecutionCommandDescriptionSchema = Schema.Struct({
  argv: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isNonEmpty()),
});
export type ExtensionExecutionCommandDescription =
  typeof ExtensionExecutionCommandDescriptionSchema.Type;

export const ExtensionExecutionEnvPlanSchema = Schema.Struct({
  extensionId: ExtensionId,
  nonSecretValues: StringRecordSchema,
  secretKeyNames: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  redactedLabels: StringRecordSchema,
  secretRevisionFingerprint: Schema.String.check(Schema.isNonEmpty()),
});
export type ExtensionExecutionEnvPlan = typeof ExtensionExecutionEnvPlanSchema.Type;

export const ChildProcessCommandExecutionPlanSchema = Schema.Struct({
  type: Schema.Literal("child_process.command"),
  planId: ExtensionExecutionPlanId,
  commandFamily: Schema.Literals(["shell", "execute_typescript", "svvyx"]),
  command: ExtensionExecutionCommandDescriptionSchema,
  cwd: AbsolutePath,
  env: ExtensionExecutionEnvPlanSchema,
  stdin: Schema.Literals(["none", "continuable"]),
});
export type ChildProcessCommandExecutionPlan = typeof ChildProcessCommandExecutionPlanSchema.Type;

export const FileEffectApplyPatchExecutionPlanSchema = Schema.Struct({
  type: Schema.Literal("file_effect.apply_patch"),
  planId: ExtensionExecutionPlanId,
  patch: Schema.String.check(Schema.isNonEmpty()),
  cwd: AbsolutePath,
});
export type FileEffectApplyPatchExecutionPlan = typeof FileEffectApplyPatchExecutionPlanSchema.Type;

export const ExtensionExecutionPlanSchema = Schema.Union([
  ChildProcessCommandExecutionPlanSchema,
  FileEffectApplyPatchExecutionPlanSchema,
]);
export type ExtensionExecutionPlan = typeof ExtensionExecutionPlanSchema.Type;

export const RuntimeEffectOperationSchema = Schema.Struct({
  kind: Schema.Literal("runtime_effect"),
  request: RuntimeEffectRequestSchema,
});
export type RuntimeEffectOperation = typeof RuntimeEffectOperationSchema.Type;

export const ExecutionPlanOperationSchema = Schema.Struct({
  kind: Schema.Literal("execution_plan"),
  plan: ExtensionExecutionPlanSchema,
});
export type ExecutionPlanOperation = typeof ExecutionPlanOperationSchema.Type;

export const ExtensionRuntimeOperationSchema = Schema.Union([
  RuntimeEffectOperationSchema,
  ExecutionPlanOperationSchema,
]);
export type ExtensionRuntimeOperation = typeof ExtensionRuntimeOperationSchema.Type;

export const ExtensionHandlerResultSchema = Schema.Struct({
  result: NativeToolResultSchema,
  operations: Schema.optionalKey(Schema.Array(ExtensionRuntimeOperationSchema)),
});

export type ExtensionHandlerResult = typeof ExtensionHandlerResultSchema.Type;

export interface RuntimeWorkspacesApiEffect {
  acquire(
    input: AcquireWorkspaceInput,
  ): Effect.Effect<AcquireWorkspaceResult, RuntimeContractError>;
  acquireDefault(
    input: AcquireDefaultWorkspaceInput,
  ): Effect.Effect<AcquireWorkspaceResult, RuntimeContractError>;
  release(
    input: ReleaseWorkspaceInput,
  ): Effect.Effect<ReleaseWorkspaceResult, RuntimeContractError>;
}

export interface RuntimeSurfacesApiEffect {
  createOrchestrator(
    input: CreateOrchestratorSurfaceInput,
  ): Effect.Effect<CreateSurfaceResult, RuntimeContractError>;
  open(input: OpenSurfaceInput): Effect.Effect<OpenSurfaceResult, RuntimeContractError>;
  close(input: CloseSurfaceInput): Effect.Effect<CloseSurfaceResult, RuntimeContractError>;
}

export interface RuntimeMessagesApiEffect {
  submit(input: SubmitMessageInput): Effect.Effect<SubmitMessageResult, RuntimeContractError>;
  abort(input: AbortPromptInput): Effect.Effect<void, RuntimeContractError>;
}

export interface RuntimeQueuesApiEffect {
  steer(input: SteerQueuedMessageInput): Effect.Effect<void, RuntimeContractError>;
}

export interface RuntimeCommandsApiEffect {
  writeStdin(
    input: WriteCommandStdinInput,
  ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError>;
  cancel(input: CancelCommandInput): Effect.Effect<CancelCommandResult, RuntimeContractError>;
}

export interface RuntimeApprovalsApiEffect {
  answer(
    input: AnswerRuntimeApprovalInput,
  ): Effect.Effect<AnswerRuntimeApprovalResult, RuntimeContractError>;
}

export interface RuntimeRequestInputApiEffect {
  setVariant(
    input: SetRequestInputVariantInput,
  ): Effect.Effect<SetRequestInputVariantResult, RuntimeContractError>;
  setBlockingTimeout(
    input: SetRequestInputBlockingTimeoutInput,
  ): Effect.Effect<SetRequestInputBlockingTimeoutResult, RuntimeContractError>;
  answer(
    input: AnswerRequestInputInput,
  ): Effect.Effect<AnswerRequestInputResult, RuntimeContractError>;
  setTimerPaused(
    input: SetRequestInputTimerPausedInput,
  ): Effect.Effect<SetRequestInputTimerPausedResult, RuntimeContractError>;
}

export interface RuntimeSourceInvalidationApiEffect {
  hint(input: SourceInvalidationHint): Effect.Effect<void, RuntimeContractError>;
  reconcile(
    input: SourceReconcileRequest,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  applyCommittedScanEvent(
    input: ApplyCommittedSourceInvalidationEventInput,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  refreshGeneratedContext(
    input: RefreshGeneratedContextRequest,
  ): Effect.Effect<void, RuntimeContractError>;
  refreshGeneratedPackages(
    input: InternalRefreshGeneratedPackagesRequest,
  ): Effect.Effect<GeneratedPackagesRefreshResult, RuntimeContractError>;
}

export const unsafeDecodeRuntimeOwnerRefSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RuntimeOwnerRefSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeOwnerRefExit = Schema.decodeUnknownExit(
  RuntimeOwnerRefSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeOwnerRefEffect = Schema.decodeUnknownEffect(
  RuntimeOwnerRefSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAcquireWorkspaceInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  AcquireWorkspaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAcquireWorkspaceInputExit = Schema.decodeUnknownExit(
  AcquireWorkspaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAcquireWorkspaceInputEffect = Schema.decodeUnknownEffect(
  AcquireWorkspaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAcquireDefaultWorkspaceInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(AcquireDefaultWorkspaceInputSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownAcquireDefaultWorkspaceInputExit = Schema.decodeUnknownExit(
  AcquireDefaultWorkspaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAcquireDefaultWorkspaceInputEffect = Schema.decodeUnknownEffect(
  AcquireDefaultWorkspaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAcquireWorkspaceResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  AcquireWorkspaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAcquireWorkspaceResultExit = Schema.decodeUnknownExit(
  AcquireWorkspaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAcquireWorkspaceResultEffect = Schema.decodeUnknownEffect(
  AcquireWorkspaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeReleaseWorkspaceInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  ReleaseWorkspaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownReleaseWorkspaceInputExit = Schema.decodeUnknownExit(
  ReleaseWorkspaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownReleaseWorkspaceInputEffect = Schema.decodeUnknownEffect(
  ReleaseWorkspaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeReleaseWorkspaceResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  ReleaseWorkspaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownReleaseWorkspaceResultExit = Schema.decodeUnknownExit(
  ReleaseWorkspaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownReleaseWorkspaceResultEffect = Schema.decodeUnknownEffect(
  ReleaseWorkspaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeCreateOrchestratorSurfaceInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(CreateOrchestratorSurfaceInputSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownCreateOrchestratorSurfaceInputExit = Schema.decodeUnknownExit(
  CreateOrchestratorSurfaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCreateOrchestratorSurfaceInputEffect = Schema.decodeUnknownEffect(
  CreateOrchestratorSurfaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeCreateSurfaceResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  CreateSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCreateSurfaceResultExit = Schema.decodeUnknownExit(
  CreateSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCreateSurfaceResultEffect = Schema.decodeUnknownEffect(
  CreateSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeOpenSurfaceInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  OpenSurfaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownOpenSurfaceInputExit = Schema.decodeUnknownExit(
  OpenSurfaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownOpenSurfaceInputEffect = Schema.decodeUnknownEffect(
  OpenSurfaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeOpenSurfaceResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  OpenSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownOpenSurfaceResultExit = Schema.decodeUnknownExit(
  OpenSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownOpenSurfaceResultEffect = Schema.decodeUnknownEffect(
  OpenSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeCloseSurfaceInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  CloseSurfaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCloseSurfaceInputExit = Schema.decodeUnknownExit(
  CloseSurfaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCloseSurfaceInputEffect = Schema.decodeUnknownEffect(
  CloseSurfaceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeCloseSurfaceResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  CloseSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCloseSurfaceResultExit = Schema.decodeUnknownExit(
  CloseSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCloseSurfaceResultEffect = Schema.decodeUnknownEffect(
  CloseSurfaceResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSubmitMessageInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  SubmitMessageInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRuntimeSubmittedMessageSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RuntimeSubmittedMessageSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeSubmittedMessageExit = Schema.decodeUnknownExit(
  RuntimeSubmittedMessageSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeSubmittedMessageEffect = Schema.decodeUnknownEffect(
  RuntimeSubmittedMessageSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSubmitMessageInputExit = Schema.decodeUnknownExit(
  SubmitMessageInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSubmitMessageInputEffect = Schema.decodeUnknownEffect(
  SubmitMessageInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSubmitMessageResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  SubmitMessageResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSubmitMessageResultExit = Schema.decodeUnknownExit(
  SubmitMessageResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSubmitMessageResultEffect = Schema.decodeUnknownEffect(
  SubmitMessageResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAbortPromptInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  AbortPromptInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAbortPromptInputExit = Schema.decodeUnknownExit(
  AbortPromptInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAbortPromptInputEffect = Schema.decodeUnknownEffect(
  AbortPromptInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSteerQueuedMessageInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  SteerQueuedMessageInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSteerQueuedMessageInputExit = Schema.decodeUnknownExit(
  SteerQueuedMessageInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSteerQueuedMessageInputEffect = Schema.decodeUnknownEffect(
  SteerQueuedMessageInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRuntimeEventsInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RuntimeEventsInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeEventsInputExit = Schema.decodeUnknownExit(
  RuntimeEventsInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeEventsInputEffect = Schema.decodeUnknownEffect(
  RuntimeEventsInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRuntimeEventSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RuntimeEventSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeEventExit = Schema.decodeUnknownExit(
  RuntimeEventSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeEventEffect = Schema.decodeUnknownEffect(
  RuntimeEventSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRuntimeEventSubscriptionCloseSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RuntimeEventSubscriptionCloseSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownRuntimeEventSubscriptionCloseExit = Schema.decodeUnknownExit(
  RuntimeEventSubscriptionCloseSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeEventSubscriptionCloseEffect = Schema.decodeUnknownEffect(
  RuntimeEventSubscriptionCloseSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRuntimeEventErrorSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RuntimeEventErrorSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRuntimeFacadeErrorContractSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RuntimeFacadeErrorContractSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownRuntimeFacadeErrorContractExit = Schema.decodeUnknownExit(
  RuntimeFacadeErrorContractSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeFacadeErrorContractEffect = Schema.decodeUnknownEffect(
  RuntimeFacadeErrorContractSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRuntimeFacadeErrorContractExit = Schema.encodeExit(
  RuntimeFacadeErrorContractSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRuntimeFacadeErrorContractEffect = Schema.encodeEffect(
  RuntimeFacadeErrorContractSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeStateFacadeErrorContractSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(StateFacadeErrorContractSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownStateFacadeErrorContractExit = Schema.decodeUnknownExit(
  StateFacadeErrorContractSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownStateFacadeErrorContractEffect = Schema.decodeUnknownEffect(
  StateFacadeErrorContractSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeStateFacadeErrorContractExit = Schema.encodeExit(
  StateFacadeErrorContractSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeStateFacadeErrorContractEffect = Schema.encodeEffect(
  StateFacadeErrorContractSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownStateCommandPostCommitNotificationErrorExit = Schema.decodeUnknownExit(
  StateCommandPostCommitNotificationErrorSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownStateCommandPostCommitNotificationErrorEffect =
  Schema.decodeUnknownEffect(
    StateCommandPostCommitNotificationErrorSchema,
    RuntimeBoundaryParseOptions,
  );
export const encodeStateCommandPostCommitNotificationErrorExit = Schema.encodeExit(
  StateCommandPostCommitNotificationErrorSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeStateCommandPostCommitNotificationErrorEffect = Schema.encodeEffect(
  StateCommandPostCommitNotificationErrorSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSourceInvalidationHintSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  SourceInvalidationHintSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSourceInvalidationHintExit = Schema.decodeUnknownExit(
  SourceInvalidationHintSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSourceInvalidationHintEffect = Schema.decodeUnknownEffect(
  SourceInvalidationHintSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSourceReconcileRequestSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  SourceReconcileRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSourceReconcileRequestExit = Schema.decodeUnknownExit(
  SourceReconcileRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSourceReconcileRequestEffect = Schema.decodeUnknownEffect(
  SourceReconcileRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSourceReconcileResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  SourceReconcileResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSourceReconcileResultExit = Schema.decodeUnknownExit(
  SourceReconcileResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSourceReconcileResultEffect = Schema.decodeUnknownEffect(
  SourceReconcileResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeCommittedSourceInvalidationEventSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(CommittedSourceInvalidationEventSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownCommittedSourceInvalidationEventExit = Schema.decodeUnknownExit(
  CommittedSourceInvalidationEventSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCommittedSourceInvalidationEventEffect = Schema.decodeUnknownEffect(
  CommittedSourceInvalidationEventSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeApplyCommittedSourceInvalidationEventInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(
    ApplyCommittedSourceInvalidationEventInputSchema,
    RuntimeBoundaryParseOptions,
  );
export const decodeUnknownApplyCommittedSourceInvalidationEventInputExit = Schema.decodeUnknownExit(
  ApplyCommittedSourceInvalidationEventInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownApplyCommittedSourceInvalidationEventInputEffect =
  Schema.decodeUnknownEffect(
    ApplyCommittedSourceInvalidationEventInputSchema,
    RuntimeBoundaryParseOptions,
  );
export const unsafeDecodeRefreshGeneratedContextRequestSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RefreshGeneratedContextRequestSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownRefreshGeneratedContextRequestExit = Schema.decodeUnknownExit(
  RefreshGeneratedContextRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRefreshGeneratedContextRequestEffect = Schema.decodeUnknownEffect(
  RefreshGeneratedContextRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeGeneratedPackagesRefreshResultSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(GeneratedPackagesRefreshResultSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownGeneratedPackagesRefreshResultExit = Schema.decodeUnknownExit(
  GeneratedPackagesRefreshResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownGeneratedPackagesRefreshResultEffect = Schema.decodeUnknownEffect(
  GeneratedPackagesRefreshResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RuntimeEffectRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeEffectRequestExit = Schema.decodeUnknownExit(
  RuntimeEffectRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRuntimeEffectRequestEffect = Schema.decodeUnknownEffect(
  RuntimeEffectRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRuntimeEffectRequestExit = Schema.encodeExit(
  RuntimeEffectRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRuntimeEffectRequestEffect = Schema.encodeEffect(
  RuntimeEffectRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSvvyxRuntimeEffectTransportIntentSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(SvvyxRuntimeEffectTransportIntentSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownSvvyxRuntimeEffectTransportIntentExit = Schema.decodeUnknownExit(
  SvvyxRuntimeEffectTransportIntentSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSvvyxRuntimeEffectTransportIntentEffect = Schema.decodeUnknownEffect(
  SvvyxRuntimeEffectTransportIntentSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeSvvyxRuntimeEffectTransportIntentExit = Schema.encodeExit(
  SvvyxRuntimeEffectTransportIntentSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeSvvyxRuntimeEffectTransportIntentEffect = Schema.encodeEffect(
  SvvyxRuntimeEffectTransportIntentSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeExtensionExecutionPlanSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  ExtensionExecutionPlanSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownExtensionExecutionPlanExit = Schema.decodeUnknownExit(
  ExtensionExecutionPlanSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownExtensionExecutionPlanEffect = Schema.decodeUnknownEffect(
  ExtensionExecutionPlanSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeExtensionExecutionPlanExit = Schema.encodeExit(
  ExtensionExecutionPlanSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeExtensionExecutionPlanEffect = Schema.encodeEffect(
  ExtensionExecutionPlanSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeExtensionRuntimeOperationSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(ExtensionRuntimeOperationSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownExtensionRuntimeOperationExit = Schema.decodeUnknownExit(
  ExtensionRuntimeOperationSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownExtensionRuntimeOperationEffect = Schema.decodeUnknownEffect(
  ExtensionRuntimeOperationSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeExtensionRuntimeOperationExit = Schema.encodeExit(
  ExtensionRuntimeOperationSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeExtensionRuntimeOperationEffect = Schema.encodeEffect(
  ExtensionRuntimeOperationSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeExtensionHandlerResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  ExtensionHandlerResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownExtensionHandlerResultExit = Schema.decodeUnknownExit(
  ExtensionHandlerResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownExtensionHandlerResultEffect = Schema.decodeUnknownEffect(
  ExtensionHandlerResultSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeExtensionHandlerResultExit = Schema.encodeExit(
  ExtensionHandlerResultSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeExtensionHandlerResultEffect = Schema.encodeEffect(
  ExtensionHandlerResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeCreateRequestInputRequestSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(CreateRequestInputRequestSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownCreateRequestInputRequestExit = Schema.decodeUnknownExit(
  CreateRequestInputRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCreateRequestInputRequestEffect = Schema.decodeUnknownEffect(
  CreateRequestInputRequestSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRequestUserInputAnswerQueuePayloadSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RequestUserInputAnswerQueuePayloadSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownRequestUserInputAnswerQueuePayloadExit = Schema.decodeUnknownExit(
  RequestUserInputAnswerQueuePayloadSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRequestUserInputAnswerQueuePayloadEffect = Schema.decodeUnknownEffect(
  RequestUserInputAnswerQueuePayloadSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRequestUserInputAnswerQueuePayload = Schema.encodeUnknownSync(
  RequestUserInputAnswerQueuePayloadSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAnswerRequestInputInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  AnswerRequestInputInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAnswerRequestInputInputExit = Schema.decodeUnknownExit(
  AnswerRequestInputInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAnswerRequestInputInputEffect = Schema.decodeUnknownEffect(
  AnswerRequestInputInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAnswerRequestInputResultSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(AnswerRequestInputResultSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownAnswerRequestInputResultExit = Schema.decodeUnknownExit(
  AnswerRequestInputResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAnswerRequestInputResultEffect = Schema.decodeUnknownEffect(
  AnswerRequestInputResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSetRequestInputTimerPausedInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(SetRequestInputTimerPausedInputSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownSetRequestInputTimerPausedInputExit = Schema.decodeUnknownExit(
  SetRequestInputTimerPausedInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSetRequestInputTimerPausedInputEffect = Schema.decodeUnknownEffect(
  SetRequestInputTimerPausedInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeSetRequestInputTimerPausedResultSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(SetRequestInputTimerPausedResultSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownSetRequestInputTimerPausedResultExit = Schema.decodeUnknownExit(
  SetRequestInputTimerPausedResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownSetRequestInputTimerPausedResultEffect = Schema.decodeUnknownEffect(
  SetRequestInputTimerPausedResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAnswerRuntimeApprovalInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(AnswerRuntimeApprovalInputSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownAnswerRuntimeApprovalInputExit = Schema.decodeUnknownExit(
  AnswerRuntimeApprovalInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAnswerRuntimeApprovalInputEffect = Schema.decodeUnknownEffect(
  AnswerRuntimeApprovalInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAnswerRuntimeApprovalResultSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(AnswerRuntimeApprovalResultSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownAnswerRuntimeApprovalResultExit = Schema.decodeUnknownExit(
  AnswerRuntimeApprovalResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAnswerRuntimeApprovalResultEffect = Schema.decodeUnknownEffect(
  AnswerRuntimeApprovalResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRequestUserInputAnswerDeliveryPayloadSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(
    RequestUserInputAnswerDeliveryPayloadSchema,
    RuntimeBoundaryParseOptions,
  );
export const decodeUnknownRequestUserInputAnswerDeliveryPayloadExit = Schema.decodeUnknownExit(
  RequestUserInputAnswerDeliveryPayloadSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRequestUserInputAnswerDeliveryPayloadEffect = Schema.decodeUnknownEffect(
  RequestUserInputAnswerDeliveryPayloadSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRequestUserInputAnswerDeliveryPayload = Schema.encodeUnknownSync(
  RequestUserInputAnswerDeliveryPayloadSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeCancelCommandInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  CancelCommandInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCancelCommandInputExit = Schema.decodeUnknownExit(
  CancelCommandInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCancelCommandInputEffect = Schema.decodeUnknownEffect(
  CancelCommandInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeCancelCommandResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  CancelCommandResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCancelCommandResultExit = Schema.decodeUnknownExit(
  CancelCommandResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownCancelCommandResultEffect = Schema.decodeUnknownEffect(
  CancelCommandResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeWriteCommandStdinInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  WriteCommandStdinInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownWriteCommandStdinInputExit = Schema.decodeUnknownExit(
  WriteCommandStdinInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownWriteCommandStdinInputEffect = Schema.decodeUnknownEffect(
  WriteCommandStdinInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeWriteCommandStdinResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  WriteCommandStdinResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownWriteCommandStdinResultExit = Schema.decodeUnknownExit(
  WriteCommandStdinResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownWriteCommandStdinResultEffect = Schema.decodeUnknownEffect(
  WriteCommandStdinResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeTaskAgentParametersSourceSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(TaskAgentParametersSourceSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownTaskAgentParametersSourceExit = Schema.decodeUnknownExit(
  TaskAgentParametersSourceSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownTaskAgentParametersSourceEffect = Schema.decodeUnknownEffect(
  TaskAgentParametersSourceSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRunTaskAgentSourceInputSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RunTaskAgentSourceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRunTaskAgentSourceInputExit = Schema.decodeUnknownExit(
  RunTaskAgentSourceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRunTaskAgentSourceInputEffect = Schema.decodeUnknownEffect(
  RunTaskAgentSourceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRunTaskAgentSourceInputExit = Schema.encodeExit(
  RunTaskAgentSourceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRunTaskAgentSourceInputEffect = Schema.encodeEffect(
  RunTaskAgentSourceInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRunTaskAgentInputExit = Schema.decodeUnknownExit(
  RunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRunTaskAgentInputEffect = Schema.decodeUnknownEffect(
  RunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRunTaskAgentInputExit = Schema.encodeExit(
  RunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRunTaskAgentInputEffect = Schema.encodeEffect(
  RunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeAuthenticatedRunTaskAgentInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(AuthenticatedRunTaskAgentInputSchema, RuntimeBoundaryParseOptions);
export const decodeUnknownAuthenticatedRunTaskAgentInputExit = Schema.decodeUnknownExit(
  AuthenticatedRunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownAuthenticatedRunTaskAgentInputEffect = Schema.decodeUnknownEffect(
  AuthenticatedRunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeAuthenticatedRunTaskAgentInputExit = Schema.encodeExit(
  AuthenticatedRunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeAuthenticatedRunTaskAgentInputEffect = Schema.encodeEffect(
  AuthenticatedRunTaskAgentInputSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRunTaskAgentResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RunTaskAgentResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRunTaskAgentResultExit = Schema.decodeUnknownExit(
  RunTaskAgentResultSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRunTaskAgentResultEffect = Schema.decodeUnknownEffect(
  RunTaskAgentResultSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRunTaskAgentResultExit = Schema.encodeExit(
  RunTaskAgentResultSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRunTaskAgentResultEffect = Schema.encodeEffect(
  RunTaskAgentResultSchema,
  RuntimeBoundaryParseOptions,
);
export const unsafeDecodeRunTaskAgentErrorSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RunTaskAgentErrorSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRunTaskAgentErrorExit = Schema.decodeUnknownExit(
  RunTaskAgentErrorSchema,
  RuntimeBoundaryParseOptions,
);
export const decodeUnknownRunTaskAgentErrorEffect = Schema.decodeUnknownEffect(
  RunTaskAgentErrorSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRunTaskAgentErrorExit = Schema.encodeExit(
  RunTaskAgentErrorSchema,
  RuntimeBoundaryParseOptions,
);
export const encodeRunTaskAgentErrorEffect = Schema.encodeEffect(
  RunTaskAgentErrorSchema,
  RuntimeBoundaryParseOptions,
);
