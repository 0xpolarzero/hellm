import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import type {
  ExtensionRegistryStateRecord,
  ReconcileExtensionRegistryObservationInput,
} from "./extension-inventory-contracts";
import type { ActorBinding } from "./extension-contracts";
import {
  ExtensionBuildAttemptIdSchema,
  ExtensionBuildIdSchema,
  ExtensionCurrentBuildManifestSchema,
  ExtensionSourceBuildObservationSchema,
  ExtensionSourceFingerprintSchema,
} from "./extension-build-contracts";
import {
  ComposerAttachmentSchema,
  ComposerSnippetMentionSchema,
  DiscoveredSnippetScopeSchema,
  DiscoveredSnippetSourceSchema,
  SnippetMetadataSchema,
} from "./composer-contracts";
import type { StateContractError } from "./errors";
import { SourceScopeDomainInvariant } from "./source-scope-domain-invariant";
import { ArtifactMetadataRecordSchema, type ArtifactMetadataRecord } from "./artifact-contracts";
import {
  CommandFactsPayloadSchema,
  CommandEventPayloadSchema,
  PromptTargetSchema,
  RuntimeSubmittedMessageSchema,
  RuntimeSurfaceTargetSchema,
  type RuntimeSurfaceTarget,
  WorkflowTaskRuntimeSurfaceTargetSchema,
  RequestUserInputResolvedAnswerSchema,
  RunTaskAgentPromptSourceSchema,
  AnswerRequestInputResultSchema,
  RuntimeClientSubmissionInputSchema,
  StateCommandReceiptSchema,
  RuntimeTurnDecisionSchema,
  UpdateActorExtensionBindingRequestSchema,
  ExtensionUsageStateSchema,
  type ExtensionUsageState,
  HandlerInheritedHistoryBlockSchema,
  ThreadHistoryModeSchema,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type AcquireDefaultWorkspaceInput,
  type AcquireWorkspaceInput,
  type AcquireWorkspaceResult,
  type CloseSurfaceInput,
  type CloseSurfaceResult,
  type CreateOrchestratorSurfaceInput,
  type CreateSurfaceResult,
  type DeleteOrchestratorSurfaceResult,
  type OpenSurfaceInput,
  type OpenSurfaceResult,
  type RenameOrchestratorSurfaceResult,
  type PromptTarget,
  RecordEpisodeRequestSchema,
  ReasoningEffortSchema,
  type ReleaseWorkspaceInput,
  type ReleaseWorkspaceResult,
  type ReasoningEffort,
  type RuntimeClientSubmissionInput,
  type StateCommandReceipt,
  type StateCommandPostCommitNotificationError,
  type StateInvalidationDescriptor,
  type SetRequestInputTimerPausedInput,
  SourceDomainSchema,
  SourceInvalidationScopeSchema,
  SourceReconcileRequestSchema,
  SmithersTaskAttemptIdentitySchema,
  SmithersTaskContextSnapshotSchema,
  ValidatedTaskAgentParametersSchema,
  type UpdateActorExtensionBindingRequest,
} from "./runtime-contracts";
export {
  StateCommandPostCommitNotificationErrorSchema,
  decodeUnknownStateCommandPostCommitNotificationErrorEffect,
  decodeUnknownStateCommandPostCommitNotificationErrorExit,
  encodeStateCommandPostCommitNotificationErrorEffect,
  encodeStateCommandPostCommitNotificationErrorExit,
} from "./runtime-contracts";
export type { StateCommandPostCommitNotificationError } from "./runtime-contracts";
import {
  ExtensionSourceKindSchema,
  SourceDiagnosticSchema,
  WorkflowAgentSourceObservationSchema,
  type ExtensionSourceKind,
  type WorkflowAgentSourceObservation,
} from "./runtime-source-edit-contracts";
import {
  AbsolutePath,
  ArtifactId,
  CommandId,
  EpisodeId,
  ExtensionId,
  GeneratedContextFingerprint,
  GeneratedPackageBuildId,
  IsoDateTimeStringSchema,
  AgentProfileId,
  MessageId,
  ModelId,
  NonNegativeSafeIntegerSchema,
  FiniteDurationMsSchema,
  PositiveDurationMsSchema,
  PositiveSafeIntegerSchema,
  ProviderId,
  RequestInputRequestId,
  RequestInputAnswerId,
  RequestInputOptionId,
  RequestInputQuestionId,
  RuntimeApprovalId,
  RuntimeClientRequestId,
  RuntimeOwnerId,
  SurfacePiSessionId,
  SurfaceStreamGenerationId,
  TitleJobId,
  ThreadId,
  ThreadGroupId,
  ToolItemId,
  ToolCallId,
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
import { PiHistoryEntryRefSchema, type PiHistoryEntryRef } from "./pi-adapter-contracts";
import {
  RuntimeTranscriptAssistantContentSchema,
  RuntimeTranscriptAssistantMessageSchema,
  RuntimeTranscriptAssistantStopReasonSchema,
  RuntimeTranscriptStreamCursorSchema,
  RuntimeTranscriptUsageSchema,
  RuntimeTranscriptUserMessageSchema,
  type RuntimeSurfaceTranscriptSnapshot,
  type RuntimeTranscriptMessage,
  type RuntimeTranscriptStreamCursor,
} from "./transcript-contracts";
import {
  GeneratedPackageDependencyEvidenceSchema,
  GeneratedPackageNameSchema,
  GeneratedPackageRefreshStatusSchema,
  GeneratedPackageWorkspaceLinkStatusSchema,
  GeneratedWorkflowsExportBuildEvidenceSchema,
  type GeneratedPackageDependencyEvidence,
  type GeneratedPackageName,
  type GeneratedPackageRefreshStatus,
  type GeneratedPackageWorkspaceLinkStatus,
} from "./generated-package-contracts";
import { StateInvalidationDescriptorSchema } from "./runtime-invalidation-contracts";
import type { RecordExtensionDependencyApprovalInput } from "./extension-state-ports";
import {
  RequestInputVariantSchema,
  type RequestInputSettings,
  type SetRequestInputBlockingTimeoutInput,
  type SetRequestInputBlockingTimeoutResult,
  type SetRequestInputVariantInput,
  type SetRequestInputVariantResult,
} from "./request-input-settings-contracts";

export interface RuntimeWorkspaceStatePortService {
  resolvePromptTargetWorkspaceId(input: {
    readonly target: PromptTarget;
  }): Effect.Effect<WorkspaceId, StateContractError>;
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

export type RuntimeToolExecutionApprovalMode = "auto-review" | "user" | "full-access";

export type RuntimeToolExecutionPolicy = {
  readonly approvalMode: RuntimeToolExecutionApprovalMode;
  readonly cwd: AbsolutePath;
};

export interface RuntimeToolExecutionPolicyStatePortService {
  readPolicy(input: {
    readonly workspaceId: WorkspaceId;
  }): Effect.Effect<RuntimeToolExecutionPolicy, StateContractError>;
}

export interface RuntimeToolExecutionPolicyStatePort {
  readonly _tag: "RuntimeToolExecutionPolicyStatePort";
}

export const RuntimeToolExecutionPolicyStatePort = Context.Service<
  RuntimeToolExecutionPolicyStatePort,
  RuntimeToolExecutionPolicyStatePortService
>("@svvy/core/RuntimeToolExecutionPolicyStatePort");

export interface RuntimeWorkspaceStatePort {
  readonly _tag: "RuntimeWorkspaceStatePort";
}

export const RuntimeWorkspaceStatePort = Context.Service<
  RuntimeWorkspaceStatePort,
  RuntimeWorkspaceStatePortService
>("@svvy/core/RuntimeWorkspaceStatePort");

export interface RuntimeSurfaceLifecycleStatePortService {
  createOrchestratorSurface(
    input: CreateRuntimeOrchestratorSurfaceStateInput,
  ): Effect.Effect<StateMutationResult<CreateSurfaceResult>, StateContractError>;
  openSurface(
    input: OpenSurfaceInput,
  ): Effect.Effect<StateMutationResult<OpenSurfaceResult>, StateContractError>;
  closeSurface(
    input: CloseSurfaceInput,
  ): Effect.Effect<StateMutationResult<CloseSurfaceResult>, StateContractError>;
  readOrchestratorLifecycle(input: {
    readonly workspaceId: WorkspaceId;
    readonly workspaceSessionId: WorkspaceSessionId;
  }): Effect.Effect<
    {
      readonly title: string;
      readonly titleGenerationStatus: string;
      readonly targets: readonly RuntimeSurfaceTarget[];
    },
    StateContractError
  >;
  renameOrchestrator(input: {
    readonly workspaceId: WorkspaceId;
    readonly workspaceSessionId: WorkspaceSessionId;
    readonly title: string;
  }): Effect.Effect<StateMutationResult<RenameOrchestratorSurfaceResult>, StateContractError>;
  forkOrchestrator(input: {
    readonly workspaceId: WorkspaceId;
    readonly sourceWorkspaceSessionId: WorkspaceSessionId;
    readonly targetSurfacePiSessionId: SurfacePiSessionId;
    readonly title?: string;
  }): Effect.Effect<StateMutationResult<CreateSurfaceResult>, StateContractError>;
  deleteOrchestrator(input: {
    readonly workspaceId: WorkspaceId;
    readonly workspaceSessionId: WorkspaceSessionId;
  }): Effect.Effect<StateMutationResult<DeleteOrchestratorSurfaceResult>, StateContractError>;
}

/**
 * Trusted runtime-to-state input used after the app-global agent profile and
 * extension binding have been resolved. This is intentionally distinct from
 * the public CreateOrchestratorSurfaceInput so callers cannot supply prompt or
 * capability authority at the public facade boundary.
 */
export interface CreateRuntimeOrchestratorSurfaceStateInput extends CreateOrchestratorSurfaceInput {
  readonly profileId: AgentProfileId;
  readonly provider: ProviderId;
  readonly model: ModelId;
  readonly reasoningEffort: ReasoningEffort;
  readonly loadedExtensionIds: readonly ExtensionId[];
  readonly availableExtensionIds: readonly ExtensionId[];
}

export interface RuntimeSurfaceLifecycleStatePort {
  readonly _tag: "RuntimeSurfaceLifecycleStatePort";
}

export const RuntimeSurfaceLifecycleStatePort = Context.Service<
  RuntimeSurfaceLifecycleStatePort,
  RuntimeSurfaceLifecycleStatePortService
>("@svvy/core/RuntimeSurfaceLifecycleStatePort");

export const RuntimePromptDefaultsRecordSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  reasoningEffort: ReasoningEffortSchema,
});
export type RuntimePromptDefaultsRecord = typeof RuntimePromptDefaultsRecordSchema.Type;

export interface ResolveRuntimePromptDefaultsInput {
  readonly target: PromptTarget;
}
export const ResolveRuntimePromptDefaultsInputSchema = Schema.Struct({
  target: PromptTargetSchema,
});

export const UpdateRuntimePromptDefaultsInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  provider: Schema.String,
  model: Schema.String,
  reasoningEffort: ReasoningEffortSchema,
});
export type UpdateRuntimePromptDefaultsInput = typeof UpdateRuntimePromptDefaultsInputSchema.Type;

export interface RuntimePromptDefaultsStatePortService {
  resolvePromptDefaults(
    input: ResolveRuntimePromptDefaultsInput,
  ): Effect.Effect<RuntimePromptDefaultsRecord, StateContractError>;
  updatePromptDefaults(
    input: UpdateRuntimePromptDefaultsInput,
  ): Effect.Effect<StateMutationResult<RuntimePromptDefaultsRecord>, StateContractError>;
}

export interface RuntimePromptDefaultsStatePort {
  readonly _tag: "RuntimePromptDefaultsStatePort";
}

export const RuntimePromptDefaultsStatePort = Context.Service<
  RuntimePromptDefaultsStatePort,
  RuntimePromptDefaultsStatePortService
>("@svvy/core/RuntimePromptDefaultsStatePort");

export interface RuntimeComposerProfileUpdateInput {
  readonly profileId: AgentProfileId;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly extensionUsage?: Readonly<Record<string, ExtensionUsageState>>;
}

export interface RuntimeComposerProfileStatePortService {
  readSurfaceProfileId(input: {
    readonly target: PromptTarget;
  }): Effect.Effect<AgentProfileId | null, StateContractError>;
  updateFromComposer(
    input: RuntimeComposerProfileUpdateInput,
  ): Effect.Effect<StateMutationResult<boolean>, StateContractError>;
}

export interface RuntimeComposerProfileStatePort {
  readonly _tag: "RuntimeComposerProfileStatePort";
}

export const RuntimeComposerProfileStatePort = Context.Service<
  RuntimeComposerProfileStatePort,
  RuntimeComposerProfileStatePortService
>("@svvy/core/RuntimeComposerProfileStatePort");

export const RuntimeSourceFactRecordSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  scopeKey: Schema.String,
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
  scope: SourceInvalidationScopeSchema,
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
});
export type ReadRuntimeSourceVersionInput = typeof ReadRuntimeSourceVersionInputSchema.Type;

export const RecordRuntimeSourceSaveInputSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
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
  scope: SourceInvalidationScopeSchema,
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
  path: AbsolutePath,
  previousSourceVersion: Schema.String,
  previousFingerprint: Schema.String,
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  deletedAt: IsoDateTimeStringSchema,
});
export type RecordRuntimeSourceDeleteInput = typeof RecordRuntimeSourceDeleteInputSchema.Type;

export const RuntimeSourceScanFactRecordSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  scopeKey: Schema.String,
  domain: SourceDomainSchema,
  sourceFingerprint: Schema.String,
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  lastObservedPath: Schema.NullOr(AbsolutePath),
  lastObservationKind: Schema.Literals(["scan", "deletion", "diagnostic"]),
  observedAt: IsoDateTimeStringSchema,
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
}).pipe(Schema.check(SourceScopeDomainInvariant));
export type RuntimeSourceScanFactRecord = typeof RuntimeSourceScanFactRecordSchema.Type;

export const RuntimeSourceRootFingerprintFactRecordSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  scopeKey: Schema.String,
  domain: SourceDomainSchema,
  sourceRoot: AbsolutePath,
  rootFingerprint: Schema.String,
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  observedAt: IsoDateTimeStringSchema,
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
}).pipe(Schema.check(SourceScopeDomainInvariant));
export type RuntimeSourceRootFingerprintFactRecord =
  typeof RuntimeSourceRootFingerprintFactRecordSchema.Type;

export const RuntimeSourceRootFingerprintInputSchema = Schema.Struct({
  sourceRoot: AbsolutePath,
  rootFingerprint: Schema.String,
});
export type RuntimeSourceRootFingerprintInput = typeof RuntimeSourceRootFingerprintInputSchema.Type;

export const RecordRuntimeSourceScanInputSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  domain: SourceDomainSchema,
  sourceFingerprint: Schema.String,
  sourceRoots: Schema.optionalKey(Schema.Array(RuntimeSourceRootFingerprintInputSchema)),
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  scannedAt: IsoDateTimeStringSchema,
}).pipe(Schema.check(SourceScopeDomainInvariant));
export type RecordRuntimeSourceScanInput = typeof RecordRuntimeSourceScanInputSchema.Type;

type RecordRuntimeWorkflowAgentSourceSaveInputShape = {
  readonly source: typeof RecordRuntimeSourceSaveInputSchema.Type;
  readonly observation: WorkflowAgentSourceObservation;
};

const RecordRuntimeWorkflowAgentSourceSaveInputInvariant = Schema.makeFilter(
  (input: RecordRuntimeWorkflowAgentSourceSaveInputShape) => {
    if (input.source.scope.kind !== "app-global") {
      return {
        path: ["source", "scope"],
        issue: "workflow-agent source saves must be app-global",
      };
    }
    if (input.source.sourceKind !== "workflow-agent") {
      return {
        path: ["source", "sourceKind"],
        issue: "workflow-agent source saves must use the workflow-agent source kind",
      };
    }
    const observation = input.observation;
    if (
      input.source.sourceId !== observation.sourceId ||
      input.source.path !== observation.path ||
      input.source.sourceVersion !== observation.sourceVersion ||
      input.source.fingerprint !== observation.fingerprint ||
      input.source.savedAt !== observation.observedAt ||
      JSON.stringify(input.source.diagnostics) !== JSON.stringify(observation.diagnostics)
    ) {
      return {
        path: ["observation"],
        issue: "workflow-agent source save observation must exactly match its source fact",
      };
    }
    return true;
  },
  { expected: "an atomic app-global workflow-agent source save" },
);

export const RecordRuntimeWorkflowAgentSourceSaveInputSchema = Schema.Struct({
  source: RecordRuntimeSourceSaveInputSchema,
  observation: WorkflowAgentSourceObservationSchema,
}).pipe(Schema.check(RecordRuntimeWorkflowAgentSourceSaveInputInvariant));
export type RecordRuntimeWorkflowAgentSourceSaveInput =
  typeof RecordRuntimeWorkflowAgentSourceSaveInputSchema.Type;

type RecordRuntimeWorkflowAgentSourceDeleteInputShape = {
  readonly source: typeof RecordRuntimeSourceDeleteInputSchema.Type;
};

const RecordRuntimeWorkflowAgentSourceDeleteInputInvariant = Schema.makeFilter(
  (input: RecordRuntimeWorkflowAgentSourceDeleteInputShape) =>
    input.source.scope.kind === "app-global" && input.source.sourceKind === "workflow-agent",
  { expected: "an atomic app-global workflow-agent source delete" },
);

export const RecordRuntimeWorkflowAgentSourceDeleteInputSchema = Schema.Struct({
  source: RecordRuntimeSourceDeleteInputSchema,
}).pipe(Schema.check(RecordRuntimeWorkflowAgentSourceDeleteInputInvariant));
export type RecordRuntimeWorkflowAgentSourceDeleteInput =
  typeof RecordRuntimeWorkflowAgentSourceDeleteInputSchema.Type;

type ReconcileRuntimeWorkflowAgentSourcesInputShape = {
  readonly observations: ReadonlyArray<WorkflowAgentSourceObservation>;
  readonly scannedAt: string;
};

const ReconcileRuntimeWorkflowAgentSourcesInputInvariant = Schema.makeFilter(
  (input: ReconcileRuntimeWorkflowAgentSourcesInputShape) => {
    const sourceIds = input.observations.map((observation) => observation.sourceId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      return {
        path: ["observations"],
        issue: "workflow-agent source reconciliation observations must have unique source ids",
      };
    }
    const paths = input.observations.map((observation) => observation.path);
    if (new Set(paths).size !== paths.length) {
      return {
        path: ["observations"],
        issue: "workflow-agent source reconciliation observations must have unique paths",
      };
    }
    if (input.observations.some((observation) => observation.observedAt !== input.scannedAt)) {
      return {
        path: ["observations"],
        issue: "workflow-agent source observations must share the reconciliation scan timestamp",
      };
    }
    return true;
  },
  { expected: "one deterministic workflow-agent source reconciliation batch" },
);

export const ReconcileRuntimeWorkflowAgentSourcesInputSchema = Schema.Struct({
  sourceFingerprint: Schema.String.check(Schema.isNonEmpty()),
  sourceRoots: Schema.optionalKey(Schema.Array(RuntimeSourceRootFingerprintInputSchema)),
  observations: Schema.Array(WorkflowAgentSourceObservationSchema),
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  scannedAt: IsoDateTimeStringSchema,
}).pipe(Schema.check(ReconcileRuntimeWorkflowAgentSourcesInputInvariant));
export type ReconcileRuntimeWorkflowAgentSourcesInput =
  typeof ReconcileRuntimeWorkflowAgentSourcesInputSchema.Type;

export const DiscoveredHostSnippetIdentitySchema = Schema.Struct({
  source: DiscoveredSnippetSourceSchema,
  scope: DiscoveredSnippetScopeSchema,
  path: AbsolutePath,
});
export type DiscoveredHostSnippetIdentityInput = typeof DiscoveredHostSnippetIdentitySchema.Type;

export const DiscoveredHostSnippetObservationSchema = Schema.Struct({
  source: DiscoveredSnippetSourceSchema,
  scope: DiscoveredSnippetScopeSchema,
  path: AbsolutePath,
  title: Schema.String,
  body: Schema.String,
  metadata: SnippetMetadataSchema,
});
export type DiscoveredHostSnippetObservation = typeof DiscoveredHostSnippetObservationSchema.Type;

export const ReconcileDiscoveredHostSnippetsInputSchema = Schema.Struct({
  scope: Schema.Struct({
    kind: Schema.Literal("workspace"),
    workspaceId: WorkspaceId,
  }),
  sourceFingerprint: Schema.String,
  sourceRoots: Schema.Array(RuntimeSourceRootFingerprintInputSchema),
  observedSnippets: Schema.Array(DiscoveredHostSnippetObservationSchema),
  unreadableSnippets: Schema.Array(DiscoveredHostSnippetIdentitySchema),
  unreadableRoots: Schema.Array(DiscoveredHostSnippetIdentitySchema),
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  scannedAt: IsoDateTimeStringSchema,
});
export type ReconcileDiscoveredHostSnippetsInput =
  typeof ReconcileDiscoveredHostSnippetsInputSchema.Type;

export const RecordObservedRuntimeSourceDeletionInputSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  domain: SourceDomainSchema,
  path: AbsolutePath,
  sourceFingerprint: Schema.optionalKey(Schema.String),
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  observedAt: IsoDateTimeStringSchema,
}).pipe(Schema.check(SourceScopeDomainInvariant));
export type RecordObservedRuntimeSourceDeletionInput =
  typeof RecordObservedRuntimeSourceDeletionInputSchema.Type;

export const RecordRuntimeSourceDiagnosticInputSchema = Schema.Struct({
  scope: SourceInvalidationScopeSchema,
  domain: SourceDomainSchema,
  path: Schema.optionalKey(Schema.NullOr(AbsolutePath)),
  sourceFingerprint: Schema.optionalKey(Schema.String),
  diagnostic: SourceDiagnosticSchema,
  observedAt: IsoDateTimeStringSchema,
}).pipe(Schema.check(SourceScopeDomainInvariant));
export type RecordRuntimeSourceDiagnosticInput =
  typeof RecordRuntimeSourceDiagnosticInputSchema.Type;

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
  recordWorkflowAgentSourceSave(
    input: RecordRuntimeWorkflowAgentSourceSaveInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceFactRecord>, StateContractError>;
  recordWorkflowAgentSourceDelete(
    input: RecordRuntimeWorkflowAgentSourceDeleteInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceFactRecord>, StateContractError>;
  reconcileWorkflowAgentSources(
    input: ReconcileRuntimeWorkflowAgentSourcesInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;
  recordSourceScan(
    input: RecordRuntimeSourceScanInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;
  reconcileDiscoveredHostSnippets(
    input: ReconcileDiscoveredHostSnippetsInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;
  recordObservedSourceDeletion(
    input: RecordObservedRuntimeSourceDeletionInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;
  recordSourceDiagnostic(
    input: RecordRuntimeSourceDiagnosticInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;
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

export const AcceptRuntimeWorkflowTaskAgentStartInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  sourceCommandId: CommandId,
  idempotencyKey: Schema.String,
  agent: ValidatedTaskAgentParametersSchema,
  taskIdentity: SmithersTaskAttemptIdentitySchema,
  smithersContext: Schema.optionalKey(SmithersTaskContextSnapshotSchema),
  promptSource: RunTaskAgentPromptSourceSchema,
});
export type AcceptRuntimeWorkflowTaskAgentStartInput =
  typeof AcceptRuntimeWorkflowTaskAgentStartInputSchema.Type;

export const RuntimeWorkflowTaskAgentStartReceiptSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  target: WorkflowTaskRuntimeSurfaceTargetSchema,
  queuedMessage: RuntimeSurfaceMessageRecordSchema,
  accepted: Schema.Literals(["created", "existing"]),
});
export type RuntimeWorkflowTaskAgentStartReceipt =
  typeof RuntimeWorkflowTaskAgentStartReceiptSchema.Type;

export const RuntimeWorkflowTaskAgentTerminalResultSchema = Schema.Struct({
  text: Schema.String,
  usage: Schema.optionalKey(JsonValue),
  output: Schema.optionalKey(JsonValue),
});
export type RuntimeWorkflowTaskAgentTerminalResult =
  typeof RuntimeWorkflowTaskAgentTerminalResultSchema.Type;

export const RuntimeWorkflowTaskAgentTerminalReceiptSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("in-flight"),
    workspaceId: WorkspaceId,
    target: WorkflowTaskRuntimeSurfaceTargetSchema,
    queuedMessage: RuntimeSurfaceMessageRecordSchema,
  }),
  Schema.Struct({
    status: Schema.Literal("completed"),
    result: RuntimeWorkflowTaskAgentTerminalResultSchema,
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    error: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("conflict"),
    error: Schema.String,
  }),
]);
export type RuntimeWorkflowTaskAgentTerminalReceipt =
  typeof RuntimeWorkflowTaskAgentTerminalReceiptSchema.Type;

export const SettleRuntimeWorkflowTaskAgentAttemptInputSchema = Schema.Struct({
  workflowTaskAttemptId: WorkflowTaskAttemptId,
  idempotencyKey: Schema.String,
  status: Schema.Literals(["completed", "failed", "cancelled"]),
  result: Schema.optionalKey(RuntimeWorkflowTaskAgentTerminalResultSchema),
  contextBudget: Schema.optionalKey(
    Schema.Struct({
      usedTokens: NonNegativeSafeIntegerSchema,
      maxTokens: PositiveSafeIntegerSchema,
    }),
  ),
  error: Schema.optionalKey(Schema.String),
});
export type SettleRuntimeWorkflowTaskAgentAttemptInput =
  typeof SettleRuntimeWorkflowTaskAgentAttemptInputSchema.Type;

export interface RuntimeWorkflowTaskStatePortService {
  acceptWorkflowTaskAgentStart(
    input: AcceptRuntimeWorkflowTaskAgentStartInput,
  ): Effect.Effect<StateMutationResult<RuntimeWorkflowTaskAgentStartReceipt>, StateContractError>;
  getWorkflowTaskAgentAttemptTerminal(input: {
    readonly workspaceSessionId: WorkspaceSessionId;
    readonly idempotencyKey: string;
  }): Effect.Effect<RuntimeWorkflowTaskAgentTerminalReceipt | null, StateContractError>;
  settleWorkflowTaskAgentAttempt(
    input: SettleRuntimeWorkflowTaskAgentAttemptInput,
  ): Effect.Effect<
    StateMutationResult<RuntimeWorkflowTaskAgentTerminalReceipt>,
    StateContractError
  >;
}

export interface RuntimeWorkflowTaskStatePort {
  readonly _tag: "RuntimeWorkflowTaskStatePort";
}

export const RuntimeWorkflowTaskStatePort = Context.Service<
  RuntimeWorkflowTaskStatePort,
  RuntimeWorkflowTaskStatePortService
>("@svvy/core/RuntimeWorkflowTaskStatePort");

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
  promptHistoryText: Schema.NullOr(Schema.String),
  sourceCommandId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  maxAttempts: Schema.optionalKey(Schema.Number),
  nextAttemptAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  messageJson: Schema.String,
  payloadJson: Schema.optionalKey(Schema.NullOr(Schema.String)),
  position: Schema.optionalKey(RuntimeSurfaceQueuePositionSchema),
});
export type AcceptSubmittedRuntimeSurfaceMessageInput =
  typeof AcceptSubmittedRuntimeSurfaceMessageInputSchema.Type;

export interface AcceptEditedCommittedRuntimeSurfaceMessageInput {
  readonly workspaceId: WorkspaceId;
  readonly target: PromptTarget;
  readonly sourceMessageId: MessageId;
  readonly expectedCommittedAt: IsoDateTimeString;
  readonly sourcePiHistoryEntry: PiHistoryEntryRef;
  readonly idempotencyKey: string;
  readonly promptHistoryText: string | null;
  readonly messageJson: string;
  readonly payloadJson: string;
}

export const CommittedUserMessageEditQueuePayloadSchema = Schema.Struct({
  source: Schema.Literal("committed-user-message-edit"),
  sourceMessageId: MessageId,
  expectedCommittedAt: IsoDateTimeStringSchema,
  sourcePiHistoryEntry: PiHistoryEntryRefSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type CommittedUserMessageEditQueuePayload =
  typeof CommittedUserMessageEditQueuePayloadSchema.Type;

export interface AcceptEditedCommittedRuntimeSurfaceMessageResult {
  readonly queuedMessage: RuntimeSurfaceMessageRecord;
  readonly accepted: "created" | "existing";
}

export const GetRuntimeSurfaceMessageInputSchema = Schema.Struct({
  id: Schema.String,
});
export type GetRuntimeSurfaceMessageInput = typeof GetRuntimeSurfaceMessageInputSchema.Type;

export const ClaimNextRuntimeSurfaceMessageInputSchema = Schema.Struct({
  surfacePiSessionId: Schema.String,
  claimOwnerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  leaseDurationMs: Schema.optionalKey(PositiveDurationMsSchema),
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
  claimOwnerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  leaseVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  expectedStatuses: Schema.optionalKey(Schema.Array(RuntimeSurfaceQueueStatusSchema)),
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
  expectedStatuses: Schema.optionalKey(Schema.Array(RuntimeSurfaceQueueStatusSchema)),
});
export type CancelRuntimeSurfaceMessageInput = typeof CancelRuntimeSurfaceMessageInputSchema.Type;

export const ReorderRuntimeSurfaceMessageInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  id: QueueItemId,
  beforeId: Schema.optionalKey(Schema.NullOr(QueueItemId)),
});
export type ReorderRuntimeSurfaceMessageInput = typeof ReorderRuntimeSurfaceMessageInputSchema.Type;

export interface RuntimeQueueStatePortService {
  acceptSubmittedSurfaceMessage(
    input: AcceptSubmittedRuntimeSurfaceMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
  acceptEditedCommittedSurfaceMessage(
    input: AcceptEditedCommittedRuntimeSurfaceMessageInput,
  ): Effect.Effect<
    StateMutationResult<AcceptEditedCommittedRuntimeSurfaceMessageResult>,
    StateContractError
  >;
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
  reorderSurfaceMessage(
    input: ReorderRuntimeSurfaceMessageInput,
  ): Effect.Effect<StateMutationResult<readonly RuntimeSurfaceMessageRecord[]>, StateContractError>;
}

export interface RuntimeQueueStatePort {
  readonly _tag: "RuntimeQueueStatePort";
}

export const RuntimeQueueStatePort = Context.Service<
  RuntimeQueueStatePort,
  RuntimeQueueStatePortService
>("@svvy/core/RuntimeQueueStatePort");

export type RuntimeTurnStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";
export const RuntimeTurnStatusSchema = Schema.Literals([
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
export const FinishRuntimeTurnStatusSchema = Schema.Literals([
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

export const RuntimeTurnRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  surfacePiSessionId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  requestSummary: Schema.String,
  turnDecision: Schema.Union([Schema.Literal("pending"), RuntimeTurnDecisionSchema]),
  status: RuntimeTurnStatusSchema,
  assistantMessageId: Schema.NullOr(MessageId),
  assistantText: Schema.NullOr(Schema.String),
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

export const RuntimeTitleGenerationQueueReceiptSchema = Schema.Struct({
  queued: Schema.Boolean,
  sessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  title: Schema.String,
});
export type RuntimeTitleGenerationQueueReceipt =
  typeof RuntimeTitleGenerationQueueReceiptSchema.Type;

export const SetRuntimeTurnDecisionInputSchema = Schema.Struct({
  turnId: Schema.String,
  decision: RuntimeTurnDecisionSchema,
  onlyIfPending: Schema.optionalKey(Schema.Boolean),
});
export type SetRuntimeTurnDecisionInput = typeof SetRuntimeTurnDecisionInputSchema.Type;

export const FinishRuntimeTurnInputSchema = Schema.Struct({
  turnId: Schema.String,
  status: FinishRuntimeTurnStatusSchema,
  assistantMessageId: Schema.optionalKey(MessageId),
  assistantText: Schema.optionalKey(Schema.String),
});
export type FinishRuntimeTurnInput = typeof FinishRuntimeTurnInputSchema.Type;

export const RecoverInterruptedRuntimeTurnInputSchema = Schema.Struct({
  turnId: TurnId,
  terminalStatus: Schema.Literals(["failed", "cancelled"]),
  reason: Schema.String,
});
export type RecoverInterruptedRuntimeTurnInput =
  typeof RecoverInterruptedRuntimeTurnInputSchema.Type;

export const RuntimeInterruptedTurnRecoveryResultSchema = Schema.Struct({
  changed: Schema.Boolean,
  turn: RuntimeTurnRecordSchema,
  terminalizedAssistantMessageId: Schema.NullOr(MessageId),
  terminalizedCommandIds: Schema.Array(CommandId),
  settledQueueItemId: Schema.NullOr(QueueItemId),
  cancelledRequestInputIds: Schema.Array(RequestInputRequestId),
  cancelledApprovalIds: Schema.Array(RuntimeApprovalId),
  sessionWaitCleared: Schema.Boolean,
});
export type RuntimeInterruptedTurnRecoveryResult =
  typeof RuntimeInterruptedTurnRecoveryResultSchema.Type;

export const SettleRuntimePromptTurnInputSchema = Schema.Struct({
  turnId: TurnId,
  queueItemId: QueueItemId,
  status: Schema.Literals(["completed", "failed", "cancelled"]),
  assistantMessageId: Schema.optionalKey(MessageId),
  assistantText: Schema.optionalKey(Schema.String),
  terminalCommandIds: Schema.Array(CommandId),
  terminalCommandSummary: Schema.String,
  terminalCommandError: Schema.String,
  claimOwnerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  leaseVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export type SettleRuntimePromptTurnInput = typeof SettleRuntimePromptTurnInputSchema.Type;

export const RuntimePromptTurnSettlementResultSchema = Schema.Struct({
  changed: Schema.Boolean,
  turn: RuntimeTurnRecordSchema,
  queuedMessage: RuntimeSurfaceMessageRecordSchema,
  terminalizedCommandIds: Schema.Array(CommandId),
});
export type RuntimePromptTurnSettlementResult = typeof RuntimePromptTurnSettlementResultSchema.Type;

export interface RuntimeTurnStatePortService {
  startTurn(
    input: StartRuntimeTurnInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;
  queueTopLevelTitleGeneration(input: {
    readonly sessionId: WorkspaceSessionId;
    readonly surfacePiSessionId: SurfacePiSessionId;
  }): Effect.Effect<StateMutationResult<RuntimeTitleGenerationQueueReceipt>, StateContractError>;
  setTurnDecision(
    input: SetRuntimeTurnDecisionInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;
  finishTurn(
    input: FinishRuntimeTurnInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;
  recoverInterruptedTurn(
    input: RecoverInterruptedRuntimeTurnInput,
  ): Effect.Effect<StateMutationResult<RuntimeInterruptedTurnRecoveryResult>, StateContractError>;
  settlePromptTurn(
    input: SettleRuntimePromptTurnInput,
  ): Effect.Effect<StateMutationResult<RuntimePromptTurnSettlementResult>, StateContractError>;
}

export interface RuntimeTurnStatePort {
  readonly _tag: "RuntimeTurnStatePort";
}

export const RuntimeTurnStatePort = Context.Service<
  RuntimeTurnStatePort,
  RuntimeTurnStatePortService
>("@svvy/core/RuntimeTurnStatePort");

const RuntimeTranscriptStreamMutationBaseSchema = {
  surfacePiSessionId: SurfacePiSessionId,
  streamGenerationId: SurfaceStreamGenerationId,
  expectedCursor: Schema.NullOr(RuntimeTranscriptStreamCursorSchema),
} as const;

export const CommitRuntimeTranscriptUserMessageInputSchema = Schema.Struct({
  ...RuntimeTranscriptStreamMutationBaseSchema,
  workspaceSessionId: WorkspaceSessionId,
  turnId: TurnId,
  queueItemId: QueueItemId,
  message: RuntimeSubmittedMessageSchema,
  submittedAt: IsoDateTimeStringSchema,
  committedAt: IsoDateTimeStringSchema,
});
export type CommitRuntimeTranscriptUserMessageInput =
  typeof CommitRuntimeTranscriptUserMessageInputSchema.Type;

export const BeginRuntimeTranscriptAssistantMessageInputSchema = Schema.Struct({
  ...RuntimeTranscriptStreamMutationBaseSchema,
  workspaceSessionId: WorkspaceSessionId,
  turnId: TurnId,
  api: Schema.NullOr(Schema.String),
  providerId: ProviderId,
  modelId: ModelId,
  startedAt: IsoDateTimeStringSchema,
});
export type BeginRuntimeTranscriptAssistantMessageInput =
  typeof BeginRuntimeTranscriptAssistantMessageInputSchema.Type;

export const AppendRuntimeTranscriptAssistantContentDeltaInputSchema = Schema.Struct({
  ...RuntimeTranscriptStreamMutationBaseSchema,
  messageId: MessageId,
  contentIndex: NonNegativeSafeIntegerSchema,
  kind: Schema.Literals(["text", "thinking"]),
  delta: Schema.String,
  redacted: Schema.optionalKey(Schema.Boolean),
  thinkingSignature: Schema.optionalKey(Schema.String),
});
export type AppendRuntimeTranscriptAssistantContentDeltaInput =
  typeof AppendRuntimeTranscriptAssistantContentDeltaInputSchema.Type;

export const UpsertRuntimeTranscriptAssistantToolCallInputSchema = Schema.Struct({
  ...RuntimeTranscriptStreamMutationBaseSchema,
  messageId: MessageId,
  contentIndex: NonNegativeSafeIntegerSchema,
  toolCallId: ToolCallId,
  toolName: Schema.String,
  argumentsJson: Schema.String,
  argumentsStatus: Schema.Literals(["streaming", "accepted"]),
  thoughtSignature: Schema.optionalKey(Schema.String),
});
export type UpsertRuntimeTranscriptAssistantToolCallInput =
  typeof UpsertRuntimeTranscriptAssistantToolCallInputSchema.Type;

export const LinkRuntimeTranscriptAssistantToolCallCommandInputSchema = Schema.Struct({
  ...RuntimeTranscriptStreamMutationBaseSchema,
  messageId: MessageId,
  contentIndex: NonNegativeSafeIntegerSchema,
  toolCallId: ToolCallId,
  commandId: CommandId,
});
export type LinkRuntimeTranscriptAssistantToolCallCommandInput =
  typeof LinkRuntimeTranscriptAssistantToolCallCommandInputSchema.Type;

const RuntimeTranscriptAssistantTerminalInputBaseSchema = {
  ...RuntimeTranscriptStreamMutationBaseSchema,
  messageId: MessageId,
  api: Schema.NullOr(Schema.String),
  providerId: ProviderId,
  modelId: ModelId,
  responseId: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(RuntimeTranscriptUsageSchema),
  stopReason: Schema.NullOr(RuntimeTranscriptAssistantStopReasonSchema),
  errorMessage: Schema.NullOr(Schema.String),
  piHistoryEntry: Schema.NullOr(PiHistoryEntryRefSchema),
  messageTimestamp: Schema.NullOr(IsoDateTimeStringSchema),
  finishedAt: IsoDateTimeStringSchema,
} as const;

export const CommitRuntimeTranscriptAssistantMessageInputSchema = Schema.Struct({
  ...RuntimeTranscriptAssistantTerminalInputBaseSchema,
  content: RuntimeTranscriptAssistantContentSchema,
});
export type CommitRuntimeTranscriptAssistantMessageInput =
  typeof CommitRuntimeTranscriptAssistantMessageInputSchema.Type;

export const FailRuntimeTranscriptAssistantMessageInputSchema = Schema.Struct({
  ...RuntimeTranscriptAssistantTerminalInputBaseSchema,
  status: Schema.Literals(["failed", "cancelled"]),
});
export type FailRuntimeTranscriptAssistantMessageInput =
  typeof FailRuntimeTranscriptAssistantMessageInputSchema.Type;

export const BindRuntimeTranscriptPiHistoryEntryInputSchema = Schema.Struct({
  messageId: MessageId,
  piHistoryEntry: PiHistoryEntryRefSchema,
});
export type BindRuntimeTranscriptPiHistoryEntryInput =
  typeof BindRuntimeTranscriptPiHistoryEntryInputSchema.Type;

export const AdvanceRuntimeTranscriptStreamCursorInputSchema = Schema.Struct({
  ...RuntimeTranscriptStreamMutationBaseSchema,
});
export type AdvanceRuntimeTranscriptStreamCursorInput =
  typeof AdvanceRuntimeTranscriptStreamCursorInputSchema.Type;

export const ReadRuntimeSurfaceTranscriptInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
});
export type ReadRuntimeSurfaceTranscriptInput = typeof ReadRuntimeSurfaceTranscriptInputSchema.Type;

export const RuntimeTranscriptUserMutationSchema = Schema.Struct({
  message: RuntimeTranscriptUserMessageSchema,
  cursor: RuntimeTranscriptStreamCursorSchema,
});
export type RuntimeTranscriptUserMutation = typeof RuntimeTranscriptUserMutationSchema.Type;

export const RuntimeTranscriptAssistantMutationSchema = Schema.Struct({
  message: RuntimeTranscriptAssistantMessageSchema,
  cursor: RuntimeTranscriptStreamCursorSchema,
});
export type RuntimeTranscriptAssistantMutation =
  typeof RuntimeTranscriptAssistantMutationSchema.Type;

export interface RuntimeTranscriptStatePortService {
  commitUserMessage(
    input: CommitRuntimeTranscriptUserMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptUserMutation>, StateContractError>;
  beginAssistantMessage(
    input: BeginRuntimeTranscriptAssistantMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  appendAssistantContentDelta(
    input: AppendRuntimeTranscriptAssistantContentDeltaInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  upsertAssistantToolCall(
    input: UpsertRuntimeTranscriptAssistantToolCallInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  linkAssistantToolCallCommand(
    input: LinkRuntimeTranscriptAssistantToolCallCommandInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  commitAssistantMessage(
    input: CommitRuntimeTranscriptAssistantMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  failAssistantMessage(
    input: FailRuntimeTranscriptAssistantMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  bindPiHistoryEntry(
    input: BindRuntimeTranscriptPiHistoryEntryInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptMessage>, StateContractError>;
  advanceStreamCursor(
    input: AdvanceRuntimeTranscriptStreamCursorInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptStreamCursor>, StateContractError>;
  readSurfaceTranscript(
    input: ReadRuntimeSurfaceTranscriptInput,
  ): Effect.Effect<RuntimeSurfaceTranscriptSnapshot, StateContractError>;
}

export interface RuntimeTranscriptStatePort {
  readonly _tag: "RuntimeTranscriptStatePort";
}

export const RuntimeTranscriptStatePort = Context.Service<
  RuntimeTranscriptStatePort,
  RuntimeTranscriptStatePortService
>("@svvy/core/RuntimeTranscriptStatePort");

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
  surfacePiSessionId: Schema.optionalKey(SurfacePiSessionId),
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
  data: Schema.optionalKey(CommandEventPayloadSchema),
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
  context: Schema.NullOr(
    Schema.Struct({
      reason: Schema.Literal("sandbox_denial_escalation"),
      sandboxDenied: Schema.Literal(true),
    }),
  ),
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
  context: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        reason: Schema.Literal("sandbox_denial_escalation"),
        sandboxDenied: Schema.Literal(true),
      }),
    ),
  ),
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

export const RuntimeArtifactMetadataRecordSchema = ArtifactMetadataRecordSchema;
export type RuntimeArtifactMetadataRecord = ArtifactMetadataRecord;

export const RecordRuntimeArtifactMetadataInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  workflowRunId: Schema.optionalKey(Schema.NullOr(WorkflowRunId)),
  workflowTaskAttemptId: Schema.optionalKey(Schema.NullOr(WorkflowTaskAttemptId)),
  sourceCommandId: CommandId,
  kind: RuntimeArtifactKindSchema,
  name: Schema.String,
  storedPath: AbsolutePath,
  mimeType: Schema.String,
  byteSize: NonNegativeSafeIntegerSchema,
  sha256: Schema.String,
  immutable: Schema.Boolean,
  materializationStatus: Schema.Literal("ready"),
});
export type RecordRuntimeArtifactMetadataInput =
  typeof RecordRuntimeArtifactMetadataInputSchema.Type;

export const MarkRuntimeArtifactMetadataDeletedInputSchema = Schema.Struct({
  workspaceSessionId: Schema.optionalKey(Schema.NullOr(WorkspaceSessionId)),
  artifactId: ArtifactId,
});
export type MarkRuntimeArtifactMetadataDeletedInput =
  typeof MarkRuntimeArtifactMetadataDeletedInputSchema.Type;

export const InspectRuntimeArtifactInputSchema = Schema.Struct({
  workspaceSessionId: Schema.optionalKey(Schema.NullOr(WorkspaceSessionId)),
  artifactId: ArtifactId,
});
export type InspectRuntimeArtifactInput = typeof InspectRuntimeArtifactInputSchema.Type;

export const ListRuntimeArtifactsInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  threadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  limit: Schema.optionalKey(PositiveSafeIntegerSchema),
});
export type ListRuntimeArtifactsInput = typeof ListRuntimeArtifactsInputSchema.Type;

export interface RuntimeArtifactStatePortService {
  recordArtifactMetadata(
    input: RecordRuntimeArtifactMetadataInput,
  ): Effect.Effect<StateMutationResult<ArtifactMetadataRecord>, StateContractError>;
  inspectArtifact(
    input: InspectRuntimeArtifactInput,
  ): Effect.Effect<ArtifactMetadataRecord, StateContractError>;
  listArtifacts(
    input: ListRuntimeArtifactsInput,
  ): Effect.Effect<ReadonlyArray<ArtifactMetadataRecord>, StateContractError>;
  markArtifactMetadataDeleted(
    input: MarkRuntimeArtifactMetadataDeletedInput,
  ): Effect.Effect<StateMutationResult<ArtifactMetadataRecord>, StateContractError>;
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

export const SetRuntimeComposerDraftInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  text: Schema.String,
  attachments: Schema.Array(ComposerAttachmentSchema),
  snippetMentions: Schema.Array(ComposerSnippetMentionSchema),
});
export type SetRuntimeComposerDraftInput = typeof SetRuntimeComposerDraftInputSchema.Type;

export interface RuntimeComposerDraftStatePortService {
  setDraft(
    input: SetRuntimeComposerDraftInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
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
    durationMs: PositiveDurationMsSchema,
  }),
);

export const CreateRuntimeRequestInputInputSchema = Schema.Struct({
  target: PromptTargetSchema,
  turnId: TurnId,
  toolItemId: ToolItemId,
  sourceCommandId: CommandId,
  mode: RequestInputVariantSchema,
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
  variant: RequestInputVariantSchema,
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
  timerVersion: PositiveSafeIntegerSchema,
  enabled: Schema.Boolean,
  durationMs: PositiveDurationMsSchema,
  startedAt: Schema.String,
  pausedAt: Schema.NullOr(Schema.String),
  remainingMsWhenPaused: Schema.NullOr(FiniteDurationMsSchema),
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
  variant: RequestInputVariantSchema,
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
  expectedTimerVersion: PositiveSafeIntegerSchema,
  expectedExpiresAt: Schema.String,
});
export type DefaultOpenRuntimeRequestInputQuestionsInput =
  typeof DefaultOpenRuntimeRequestInputQuestionsInputSchema.Type;

export const CancelRuntimeRequestInputInputSchema = Schema.Struct({
  requestId: RequestInputRequestId,
});
export type CancelRuntimeRequestInputInput = typeof CancelRuntimeRequestInputInputSchema.Type;

export interface RuntimeRequestStatePortService {
  readRequestInputSettings(): Effect.Effect<RequestInputSettings, StateContractError>;
  setRequestInputVariant(
    input: SetRequestInputVariantInput,
  ): Effect.Effect<StateMutationResult<SetRequestInputVariantResult>, StateContractError>;
  setRequestInputBlockingTimeout(
    input: SetRequestInputBlockingTimeoutInput,
  ): Effect.Effect<StateMutationResult<SetRequestInputBlockingTimeoutResult>, StateContractError>;
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
  ): Effect.Effect<StateMutationResult<RuntimeAnswerRequestInputCommitResult>, StateContractError>;
  defaultOpenRequestInputQuestions(
    input: DefaultOpenRuntimeRequestInputQuestionsInput,
  ): Effect.Effect<StateMutationResult<RuntimeRequestInputDetailsRecord>, StateContractError>;
  cancelRequestInput(
    input: CancelRuntimeRequestInputInput,
  ): Effect.Effect<StateMutationResult<RuntimeRequestInputDetailsRecord>, StateContractError>;
  setRequestInputTimerPaused(
    input: SetRequestInputTimerPausedInput,
  ): Effect.Effect<StateMutationResult<RuntimeRequestInputDetailsRecord>, StateContractError>;
}

export interface RuntimeRequestStatePort {
  readonly _tag: "RuntimeRequestStatePort";
}

export const RuntimeRequestStatePort = Context.Service<
  RuntimeRequestStatePort,
  RuntimeRequestStatePortService
>("@svvy/core/RuntimeRequestStatePort");

export interface RuntimeAnswerRequestInputCommitResult {
  readonly answer: AnswerRequestInputResult;
  readonly target: PromptTarget;
}
export const RuntimeAnswerRequestInputCommitResultSchema = Schema.Struct({
  answer: AnswerRequestInputResultSchema,
  target: PromptTargetSchema,
});

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

export const StateMutationResultSchema = <S extends Schema.Top>(value: S) =>
  Schema.Struct({
    value,
    afterCommit: Schema.Array(StateInvalidationDescriptorSchema),
  });

export interface StateCommandPostCommitNotificationInput {
  readonly operation: string;
  readonly receipt: StateCommandReceipt;
  readonly descriptors: readonly StateInvalidationDescriptor[];
  readonly clientSubmission?: RuntimeClientSubmissionInput;
}

export const StateCommandPostCommitNotificationInputSchema = Schema.Struct({
  operation: Schema.String,
  receipt: StateCommandReceiptSchema,
  descriptors: Schema.Array(StateInvalidationDescriptorSchema),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export const decodeUnknownStateCommandPostCommitNotificationInputExit = Schema.decodeUnknownExit(
  StateCommandPostCommitNotificationInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownStateCommandPostCommitNotificationInputEffect =
  Schema.decodeUnknownEffect(
    StateCommandPostCommitNotificationInputSchema,
    strictBoundaryParseOptions,
  );
export const encodeStateCommandPostCommitNotificationInputExit = Schema.encodeExit(
  StateCommandPostCommitNotificationInputSchema,
  strictBoundaryParseOptions,
);
export const encodeStateCommandPostCommitNotificationInputEffect = Schema.encodeEffect(
  StateCommandPostCommitNotificationInputSchema,
  strictBoundaryParseOptions,
);

export interface StateCommandPostCommitNotificationResult {
  readonly receipt: StateCommandReceipt;
  readonly acceptedDescriptorCount: typeof NonNegativeSafeIntegerSchema.Type;
  readonly rebaselineRequired: boolean;
}

export const StateCommandPostCommitNotificationResultSchema = Schema.Struct({
  receipt: StateCommandReceiptSchema,
  acceptedDescriptorCount: NonNegativeSafeIntegerSchema,
  rebaselineRequired: Schema.Boolean,
});
export const decodeUnknownStateCommandPostCommitNotificationResultExit = Schema.decodeUnknownExit(
  StateCommandPostCommitNotificationResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownStateCommandPostCommitNotificationResultEffect =
  Schema.decodeUnknownEffect(
    StateCommandPostCommitNotificationResultSchema,
    strictBoundaryParseOptions,
  );
export const encodeStateCommandPostCommitNotificationResultExit = Schema.encodeExit(
  StateCommandPostCommitNotificationResultSchema,
  strictBoundaryParseOptions,
);
export const encodeStateCommandPostCommitNotificationResultEffect = Schema.encodeEffect(
  StateCommandPostCommitNotificationResultSchema,
  strictBoundaryParseOptions,
);

export interface StateCommandPostCommitNotificationPortService {
  notifyCommittedStateCommand(
    input: StateCommandPostCommitNotificationInput,
  ): Effect.Effect<
    StateCommandPostCommitNotificationResult,
    StateCommandPostCommitNotificationError
  >;
}

export interface StateCommandPostCommitNotificationPort {
  readonly _tag: "StateCommandPostCommitNotificationPort";
}

export const StateCommandPostCommitNotificationPort = Context.Service<
  StateCommandPostCommitNotificationPort,
  StateCommandPostCommitNotificationPortService
>("@svvy/core/StateCommandPostCommitNotificationPort");

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

export const RecordGeneratedPackageBuildStatusSchema = Schema.Struct({
  ...GeneratedPackageRefreshStatusSchema.fields,
  action: Schema.Literals(["written", "unchanged"]),
});
const RecordGeneratedPackageBuildLineageFields = {
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  recoveryWorkId: Schema.optionalKey(Schema.NullOr(RecoveryWorkId)),
};
export const RecordGeneratedPackageBuildInputSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Struct({
      ...GeneratedPackageRefreshStatusSchema.fields,
      packageName: Schema.Literal("@svvyx/workflows"),
      action: Schema.Literals(["written", "unchanged"]),
      buildId: GeneratedPackageBuildId,
    }),
    workflowsExports: Schema.Array(GeneratedWorkflowsExportBuildEvidenceSchema),
    ...RecordGeneratedPackageBuildLineageFields,
  }),
  Schema.Struct({
    status: Schema.Struct({
      ...GeneratedPackageRefreshStatusSchema.fields,
      packageName: Schema.Literal("@svvyx/extensions"),
      action: Schema.Literals(["written", "unchanged"]),
    }),
    ...RecordGeneratedPackageBuildLineageFields,
  }),
]);
export type RecordGeneratedPackageBuildInput = typeof RecordGeneratedPackageBuildInputSchema.Type;

export interface RecordGeneratedPackageFailureInput {
  status: GeneratedPackageRefreshStatus & { action: "failed" };
  sourceCommandId?: CommandId | null;
  recoveryWorkId?: RecoveryWorkId | null;
}
export const RecordGeneratedPackageFailureStatusSchema = Schema.Struct({
  ...GeneratedPackageRefreshStatusSchema.fields,
  action: Schema.Literal("failed"),
});
export const RecordGeneratedPackageFailureInputSchema = Schema.Struct({
  status: RecordGeneratedPackageFailureStatusSchema,
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

export const MarkWorkspaceGeneratedPackageLinksRepairNeededReasonSchema = Schema.Literals([
  "app-global-generated-package-refreshed",
  "startup-recovery",
  "manifest-reconciled",
]);
export type MarkWorkspaceGeneratedPackageLinksRepairNeededReason =
  typeof MarkWorkspaceGeneratedPackageLinksRepairNeededReasonSchema.Type;

export interface MarkWorkspaceGeneratedPackageLinksRepairNeededInput {
  workspaceId: WorkspaceId;
  packages: readonly GeneratedPackageName[];
  reason: MarkWorkspaceGeneratedPackageLinksRepairNeededReason;
  sourceCommandId?: CommandId | null;
  recoveryWorkId?: RecoveryWorkId | null;
  requestedAt: IsoDateTimeString;
  maxAttempts: number;
}
export const MarkWorkspaceGeneratedPackageLinksRepairNeededInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  packages: Schema.Array(GeneratedPackageNameSchema),
  reason: MarkWorkspaceGeneratedPackageLinksRepairNeededReasonSchema,
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
  recoveryWorkId: Schema.optionalKey(Schema.NullOr(RecoveryWorkId)),
  requestedAt: IsoDateTimeStringSchema,
  maxAttempts: PositiveSafeIntegerSchema,
});

export interface MarkWorkspaceGeneratedPackageLinksRepairNeededResult {
  links: readonly RuntimeGeneratedPackageWorkspaceLinkRecord[];
  recoveryWorkIds: readonly RecoveryWorkId[];
}
export const MarkWorkspaceGeneratedPackageLinksRepairNeededResultSchema = Schema.Struct({
  links: Schema.Array(RuntimeGeneratedPackageWorkspaceLinkRecordSchema),
  recoveryWorkIds: Schema.Array(RecoveryWorkId),
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
  requirementFingerprint: Schema.String.check(Schema.isNonEmpty()),
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

export const ReconcileExtensionDependencyReadinessInputSchema = Schema.Struct({
  registryAggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  readiness: Schema.Array(ExtensionDependencyReadinessSchema),
  recordedAt: IsoDateTimeStringSchema,
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
});
export type ReconcileExtensionDependencyReadinessInput =
  typeof ReconcileExtensionDependencyReadinessInputSchema.Type;

export const ReconcileExtensionDependencyReadinessResultSchema = Schema.Struct({
  changed: Schema.Boolean,
  readiness: Schema.Array(ExtensionDependencyReadinessSchema),
});
export type ReconcileExtensionDependencyReadinessResult =
  typeof ReconcileExtensionDependencyReadinessResultSchema.Type;

export const ReconcileExtensionSourceBuildEvidenceInputSchema = Schema.Struct({
  registryAggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  observations: Schema.Array(ExtensionSourceBuildObservationSchema),
  observedAt: IsoDateTimeStringSchema,
});
export type ReconcileExtensionSourceBuildEvidenceInput =
  typeof ReconcileExtensionSourceBuildEvidenceInputSchema.Type;

export const ReconcileExtensionSourceBuildEvidenceResultSchema = Schema.Struct({
  changed: Schema.Boolean,
  changedExtensionIds: Schema.Array(ExtensionId),
});
export type ReconcileExtensionSourceBuildEvidenceResult =
  typeof ReconcileExtensionSourceBuildEvidenceResultSchema.Type;

export const ExtensionBuildFailureReasonSchema = Schema.Literals([
  "validation",
  "process-failed",
  "timed-out",
  "cancelled",
  "stale-state",
  "output-invalid",
  "unknown",
]);
export type ExtensionBuildFailureReason = typeof ExtensionBuildFailureReasonSchema.Type;

type ExtensionBuildAttemptRecordShape = {
  readonly status: "running" | "succeeded" | "failed";
  readonly failureReason: ExtensionBuildFailureReason | null;
  readonly successfulBuildId: import("./extension-build-contracts").ExtensionBuildId | null;
  readonly startedAt: IsoDateTimeString;
  readonly finishedAt: IsoDateTimeString | null;
};

const ExtensionBuildAttemptRecordInvariant = Schema.makeFilter(
  (record: ExtensionBuildAttemptRecordShape) => {
    if (record.status === "running") {
      if (
        record.failureReason !== null ||
        record.successfulBuildId !== null ||
        record.finishedAt !== null
      ) {
        return {
          path: ["status"],
          issue: "running extension build attempts cannot carry terminal fields",
        };
      }
      return true;
    }
    if (record.finishedAt === null || record.finishedAt < record.startedAt) {
      return {
        path: ["finishedAt"],
        issue: "terminal extension build attempts must finish at or after their start time",
      };
    }
    if (record.status === "succeeded") {
      return record.failureReason === null && record.successfulBuildId !== null
        ? true
        : {
            path: ["status"],
            issue: "successful extension build attempts require only a successful build id",
          };
    }
    return record.failureReason !== null && record.successfulBuildId === null
      ? true
      : {
          path: ["status"],
          issue: "failed extension build attempts require only a failure reason",
        };
  },
  { expected: "valid extension build attempt terminal fields and timestamps" },
);

export const ExtensionBuildAttemptRecordSchema = Schema.Struct({
  attemptId: ExtensionBuildAttemptIdSchema,
  clientRequestId: RuntimeClientRequestId,
  extensionId: ExtensionId,
  registryAggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  sourceFingerprint: ExtensionSourceFingerprintSchema,
  status: Schema.Literals(["running", "succeeded", "failed"]),
  failureReason: Schema.NullOr(ExtensionBuildFailureReasonSchema),
  successfulBuildId: Schema.NullOr(ExtensionBuildIdSchema),
  startedAt: IsoDateTimeStringSchema,
  finishedAt: Schema.NullOr(IsoDateTimeStringSchema),
}).pipe(Schema.check(ExtensionBuildAttemptRecordInvariant));
export type ExtensionBuildAttemptRecord = typeof ExtensionBuildAttemptRecordSchema.Type;

const ExtensionBuildAttemptIdentityFields = {
  attemptId: ExtensionBuildAttemptIdSchema,
  clientRequestId: RuntimeClientRequestId,
  extensionId: ExtensionId,
  registryAggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  sourceFingerprint: ExtensionSourceFingerprintSchema,
};

export const StartExtensionBuildAttemptInputSchema = Schema.Struct({
  ...ExtensionBuildAttemptIdentityFields,
  startedAt: IsoDateTimeStringSchema,
});
export type StartExtensionBuildAttemptInput = typeof StartExtensionBuildAttemptInputSchema.Type;

export const RecordExtensionBuildSuccessInputSchema = Schema.Struct({
  ...ExtensionBuildAttemptIdentityFields,
  manifest: ExtensionCurrentBuildManifestSchema,
  finishedAt: IsoDateTimeStringSchema,
});
export type RecordExtensionBuildSuccessInput = typeof RecordExtensionBuildSuccessInputSchema.Type;

export const RecordExtensionBuildFailureInputSchema = Schema.Struct({
  ...ExtensionBuildAttemptIdentityFields,
  failureReason: ExtensionBuildFailureReasonSchema,
  finishedAt: IsoDateTimeStringSchema,
});
export type RecordExtensionBuildFailureInput = typeof RecordExtensionBuildFailureInputSchema.Type;

export const decodeUnknownExtensionBuildAttemptRecordExit = Schema.decodeUnknownExit(
  ExtensionBuildAttemptRecordSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownStartExtensionBuildAttemptInputExit = Schema.decodeUnknownExit(
  StartExtensionBuildAttemptInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRecordExtensionBuildSuccessInputExit = Schema.decodeUnknownExit(
  RecordExtensionBuildSuccessInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRecordExtensionBuildFailureInputExit = Schema.decodeUnknownExit(
  RecordExtensionBuildFailureInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownReconcileExtensionSourceBuildEvidenceInputEffect =
  Schema.decodeUnknownEffect(
    ReconcileExtensionSourceBuildEvidenceInputSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownReconcileExtensionSourceBuildEvidenceInputExit = Schema.decodeUnknownExit(
  ReconcileExtensionSourceBuildEvidenceInputSchema,
  strictBoundaryParseOptions,
);
export const encodeReconcileExtensionSourceBuildEvidenceResultEffect = Schema.encodeEffect(
  ReconcileExtensionSourceBuildEvidenceResultSchema,
  strictBoundaryParseOptions,
);
export const encodeReconcileExtensionSourceBuildEvidenceResultExit = Schema.encodeExit(
  ReconcileExtensionSourceBuildEvidenceResultSchema,
  strictBoundaryParseOptions,
);

export interface RuntimeExtensionStatePortService {
  readBuildAttemptByClientRequestId(
    clientRequestId: RuntimeClientRequestId,
  ): Effect.Effect<ExtensionBuildAttemptRecord | null, StateContractError>;
  reconcileRegistryObservation(
    input: ReconcileExtensionRegistryObservationInput,
  ): Effect.Effect<StateMutationResult<ExtensionRegistryStateRecord>, StateContractError>;
  reconcileBuildEvidence(
    input: ReconcileExtensionSourceBuildEvidenceInput,
  ): Effect.Effect<
    StateMutationResult<ReconcileExtensionSourceBuildEvidenceResult>,
    StateContractError
  >;
  startBuildAttempt(
    input: StartExtensionBuildAttemptInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordBuildSuccess(
    input: RecordExtensionBuildSuccessInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordBuildFailure(
    input: RecordExtensionBuildFailureInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordDependencyApproval(
    input: RecordExtensionDependencyApprovalInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  recordDependencyReadiness(
    input: RecordExtensionDependencyReadinessInput,
  ): Effect.Effect<StateMutationResult<ExtensionDependencyReadiness>, StateContractError>;
  reconcileDependencyReadiness(
    input: ReconcileExtensionDependencyReadinessInput,
  ): Effect.Effect<
    StateMutationResult<ReconcileExtensionDependencyReadinessResult>,
    StateContractError
  >;
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
  markWorkspaceLinksRepairNeeded(
    input: MarkWorkspaceGeneratedPackageLinksRepairNeededInput,
  ): Effect.Effect<
    StateMutationResult<MarkWorkspaceGeneratedPackageLinksRepairNeededResult>,
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

export const RuntimePromptBindingRecordSchema = Schema.Struct({
  target: RuntimeSurfaceTargetSchema,
  generatedAgentContextBindingId: Schema.String,
  generatedAgentContextFingerprint: GeneratedContextFingerprint,
  generatedAgentContextRevision: NonNegativeSafeIntegerSchema,
  systemPrompt: Schema.String,
  loadedExtensionIds: Schema.Array(ExtensionId),
  availableExtensionIds: Schema.Array(ExtensionId),
  externalSourceHashes: Schema.Array(Schema.String),
  updateExtensionContextBeforeNextTurn: Schema.Boolean,
});
export type RuntimePromptBindingRecord = typeof RuntimePromptBindingRecordSchema.Type;

export const ReadRuntimePromptBindingInputSchema = Schema.Struct({
  target: RuntimeSurfaceTargetSchema,
});
export type ReadRuntimePromptBindingInput = typeof ReadRuntimePromptBindingInputSchema.Type;

export interface RuntimeGeneratedContextBuildSubjectRecord {
  readonly target: RuntimeSurfaceTarget;
  readonly actorKind: ActorBinding["actorKind"];
  readonly profileId: string | null;
  readonly loadedExtensionIds: readonly ExtensionId[];
  readonly availableExtensionIds: readonly ExtensionId[];
}

export interface BindRuntimeGeneratedContextInput {
  readonly target: RuntimeSurfaceTarget;
  readonly actorKind: ActorBinding["actorKind"];
  readonly fingerprint: GeneratedContextFingerprint;
  readonly systemPrompt: string;
  readonly svvyxGuidance: string;
  readonly commandsDts: string;
  readonly nativeToolSchemasJson: string;
  readonly loadedExtensionIds: readonly ExtensionId[];
  readonly availableExtensionIds: readonly ExtensionId[];
  readonly externalSourceHashes: readonly string[];
}

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
  readRuntimePromptBinding(
    input: ReadRuntimePromptBindingInput,
  ): Effect.Effect<RuntimePromptBindingRecord, StateContractError>;
  readGeneratedContextBuildSubject(input: {
    readonly target: RuntimeSurfaceTarget;
  }): Effect.Effect<RuntimeGeneratedContextBuildSubjectRecord, StateContractError>;
  bindGeneratedContext(
    input: BindRuntimeGeneratedContextInput,
  ): Effect.Effect<StateMutationResult<RuntimePromptBindingRecord>, StateContractError>;
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

export const ListRuntimeExtensionUsageContextAffectedSurfacesInputSchema = Schema.Struct({
  agentProfile: Schema.String,
  profileId: AgentProfileId,
});
export type ListRuntimeExtensionUsageContextAffectedSurfacesInput =
  typeof ListRuntimeExtensionUsageContextAffectedSurfacesInputSchema.Type;

export const RuntimeExtensionUsageProfileKeySchema = Schema.Union([
  Schema.TemplateLiteral(["orchestrator:", Schema.String.check(Schema.isNonEmpty())]),
  Schema.Literal("handler:threadHandler"),
]);
export type RuntimeExtensionUsageProfileKey = typeof RuntimeExtensionUsageProfileKeySchema.Type;

export const ApplyRuntimeExtensionSnapshotContextImpactInputSchema = Schema.Struct({
  affectedExtensionIds: Schema.Array(ExtensionId),
  affectedUsageProfiles: Schema.Array(RuntimeExtensionUsageProfileKeySchema),
  removedUserExtensionIds: Schema.Array(ExtensionId),
});
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

type SourceReconcileRecoveryPayloadShape = {
  readonly request: typeof SourceReconcileRequestSchema.Type;
  readonly retry:
    | {
        readonly operation: "record-save";
        readonly record: typeof RecordRuntimeSourceSaveInputSchema.Type;
      }
    | {
        readonly operation: "record-delete";
        readonly record: typeof RecordRuntimeSourceDeleteInputSchema.Type;
      };
};

const SourceReconcileRecoveryPayloadInvariant = Schema.makeFilter(
  (input: SourceReconcileRecoveryPayloadShape) => {
    const requestScope = input.request.scope;
    const recordScope = input.retry.record.scope;
    if (requestScope.kind !== "app-global" || recordScope.kind !== "app-global") {
      return {
        path: ["request", "scope"],
        issue: "source reconcile recovery requests and source records must be app-global",
      };
    }
    if (input.request.reason !== "recovery") {
      return {
        path: ["request", "reason"],
        issue: "source reconcile recovery requests must use the recovery reason",
      };
    }
    const expectedDomain = input.retry.record.sourceKind.startsWith("workflow-")
      ? "workflows"
      : "extensions";
    if (input.request.domains?.length !== 1 || input.request.domains[0] !== expectedDomain) {
      return {
        path: ["request", "domains"],
        issue: `source reconcile recovery for ${input.retry.record.sourceKind} must target only ${expectedDomain}`,
      };
    }
    return true;
  },
  { expected: "a source reconcile recovery payload matching its source record" },
);

export const SourceReconcileRecoveryPayloadSchema = Schema.Struct({
  request: SourceReconcileRequestSchema,
  retry: Schema.Union([
    Schema.Struct({
      operation: Schema.Literal("record-save"),
      record: RecordRuntimeSourceSaveInputSchema,
    }),
    Schema.Struct({
      operation: Schema.Literal("record-delete"),
      record: RecordRuntimeSourceDeleteInputSchema,
    }),
  ]),
}).pipe(Schema.check(SourceReconcileRecoveryPayloadInvariant));

export type SourceReconcileRecoveryPayload = typeof SourceReconcileRecoveryPayloadSchema.Type;

export const decodeUnknownSourceReconcileRecoveryPayloadExit = Schema.decodeUnknownExit(
  SourceReconcileRecoveryPayloadSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSourceReconcileRecoveryPayloadEffect = Schema.decodeUnknownEffect(
  SourceReconcileRecoveryPayloadSchema,
  strictBoundaryParseOptions,
);
export const encodeSourceReconcileRecoveryPayloadExit = Schema.encodeExit(
  SourceReconcileRecoveryPayloadSchema,
  strictBoundaryParseOptions,
);
export const encodeSourceReconcileRecoveryPayloadEffect = Schema.encodeEffect(
  SourceReconcileRecoveryPayloadSchema,
  strictBoundaryParseOptions,
);

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
  | { kind: "source"; sourceKind: ExtensionSourceKind; sourceId: string }
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
    kind: Schema.Literal("source"),
    sourceKind: ExtensionSourceKindSchema,
    sourceId: Schema.String,
  }),
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

export type RuntimeRecoveryWorkScope =
  | { kind: "app" }
  | { kind: "workspace"; workspaceId: WorkspaceId };
export const RuntimeRecoveryWorkScopeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("app") }),
  Schema.Struct({ kind: Schema.Literal("workspace"), workspaceId: WorkspaceId }),
]);

type RuntimeRecoveryWorkScopedKindShape = {
  readonly scope: RuntimeRecoveryWorkScope;
  readonly kind: RuntimeRecoveryWorkKind;
  readonly ownerScope: RuntimeRecoveryWorkOwnerScope;
};

const RuntimeRecoveryWorkScopedKindInvariant = Schema.makeFilter(
  (input: RuntimeRecoveryWorkScopedKindShape) => {
    if (input.kind === "generated_package_refresh" && input.scope.kind !== "app") {
      return {
        path: ["scope"],
        issue: "generated_package_refresh recovery work must be app-scoped",
      };
    }
    if (
      input.kind === "workspace_generated_package_link_repair" &&
      input.scope.kind !== "workspace"
    ) {
      return {
        path: ["scope"],
        issue: "workspace_generated_package_link_repair recovery work must be workspace-scoped",
      };
    }
    if (input.kind === "source_reconcile" && input.scope.kind !== "app") {
      return {
        path: ["scope"],
        issue: "source_reconcile recovery work must be app-scoped",
      };
    }
    if (input.kind === "source_reconcile" && input.ownerScope.kind !== "source") {
      return {
        path: ["ownerScope"],
        issue: "source_reconcile recovery work must be owned by a source",
      };
    }
    if (input.ownerScope.kind === "source" && input.kind !== "source_reconcile") {
      return {
        path: ["ownerScope"],
        issue: "source recovery ownership is reserved for source_reconcile work",
      };
    }
    return true;
  },
  { expected: "a valid recovery work kind/scope pair" },
);

export const RuntimeRecoveryWorkRecordSchema = Schema.Struct({
  id: RecoveryWorkId,
  scope: RuntimeRecoveryWorkScopeSchema,
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
}).pipe(Schema.check(RuntimeRecoveryWorkScopedKindInvariant));
export type RuntimeRecoveryWorkRecord = typeof RuntimeRecoveryWorkRecordSchema.Type;

export type RuntimeRecoveryStartupTurnStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";
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
  scope: RuntimeRecoveryWorkScopeSchema,
  kind: RuntimeRecoveryWorkKindSchema,
  ownerScope: RuntimeRecoveryWorkOwnerScopeSchema,
  idempotencyKey: Schema.String,
  orderingKey: Schema.String,
  orderingSeq: Schema.Number,
  priority: Schema.Number,
  availableAt: Schema.String,
  maxAttempts: Schema.Number,
  payloadJson: Schema.optionalKey(JsonValue),
}).pipe(Schema.check(RuntimeRecoveryWorkScopedKindInvariant));
export type EnsureRuntimeRecoveryWorkInput = typeof EnsureRuntimeRecoveryWorkInputSchema.Type;

export const ClaimNextRuntimeRecoveryWorkInputSchema = Schema.Struct({
  claimedBy: RuntimeOwnerId,
  scope: Schema.optionalKey(RuntimeRecoveryWorkScopeSchema),
  kinds: Schema.optionalKey(Schema.Array(RuntimeRecoveryWorkKindSchema)),
  leaseMs: Schema.optionalKey(PositiveDurationMsSchema),
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
  retryAvailableAt: Schema.optionalKey(IsoDateTimeStringSchema),
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

export const RuntimeHandlerThreadEpisodeRequestSchema = RecordEpisodeRequestSchema;
export type RuntimeHandlerThreadEpisodeRequest =
  typeof RuntimeHandlerThreadEpisodeRequestSchema.Type;

export const RuntimeEpisodeKindSchema = Schema.Literals([
  "change",
  "clarification",
  "report",
  "handoff",
  "conclusion",
]);
export type RuntimeEpisodeKind = typeof RuntimeEpisodeKindSchema.Type;

export const RuntimeEpisodeRecordSchema = Schema.Struct({
  id: EpisodeId,
  sessionId: WorkspaceSessionId,
  threadId: ThreadId,
  threadGroupId: ThreadGroupId,
  sourceCommandId: Schema.NullOr(CommandId),
  kind: RuntimeEpisodeKindSchema,
  title: Schema.String,
  summary: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
});
export type RuntimeEpisodeRecord = typeof RuntimeEpisodeRecordSchema.Type;

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

export const RuntimeThreadStatusSchema = Schema.Literals([
  "running-handler",
  "running-workflow",
  "waiting",
  "idle",
  "troubleshooting",
  "completed",
]);
export type RuntimeThreadStatus = typeof RuntimeThreadStatusSchema.Type;

export const RuntimeThreadReadModelWaitSchema = Schema.Struct({
  kind: Schema.Literals(["user", "external"]),
  reason: Schema.String,
  resumeWhen: Schema.String,
});
export type RuntimeThreadReadModelWait = typeof RuntimeThreadReadModelWaitSchema.Type;

export const EnsureRuntimeHandlerThreadRunnableInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  threadId: ThreadId,
});
export type EnsureRuntimeHandlerThreadRunnableInput =
  typeof EnsureRuntimeHandlerThreadRunnableInputSchema.Type;

export const RuntimeHandlerThreadGeneratedContextBindingInputSchema = Schema.Struct({
  generatedAgentContextFingerprint: Schema.String,
  generatedAgentContextRevision: Schema.Number,
  externalSourceHashes: Schema.Array(Schema.String),
});
export type RuntimeHandlerThreadGeneratedContextBindingInput =
  typeof RuntimeHandlerThreadGeneratedContextBindingInputSchema.Type;

export const RuntimeHandlerThreadInitialQueueInputSchema = Schema.Struct({
  idempotencyKey: Schema.String,
  priority: Schema.optionalKey(RuntimeSurfaceQueuePrioritySchema),
  orderingKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
  nextAttemptAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  maxAttempts: Schema.optionalKey(Schema.Number),
  inheritedHistory: Schema.optionalKey(HandlerInheritedHistoryBlockSchema),
  overrides: Schema.optionalKey(Schema.Record(ExtensionId, ExtensionUsageStateSchema)),
});
export type RuntimeHandlerThreadInitialQueueInput =
  typeof RuntimeHandlerThreadInitialQueueInputSchema.Type;

export const StartRuntimeHandlerThreadInputSchema = Schema.Struct({
  parentThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  surfacePiSessionId: SurfacePiSessionId,
  title: Schema.String,
  objective: Schema.String,
  historyMode: ThreadHistoryModeSchema,
  worktreeId: Schema.optionalKey(Schema.NullOr(WorktreeId)),
  agentProfileJson: Schema.optionalKey(Schema.NullOr(Schema.String)),
  generatedAgentContextBinding: RuntimeHandlerThreadGeneratedContextBindingInputSchema,
  initialQueue: RuntimeHandlerThreadInitialQueueInputSchema,
});
export type StartRuntimeHandlerThreadInput = typeof StartRuntimeHandlerThreadInputSchema.Type;

export const StartRuntimeHandlerThreadsInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  orchestratorTurnId: TurnId,
  sourceCommandId: CommandId,
  threadGroupId: Schema.optionalKey(Schema.NullOr(ThreadGroupId)),
  threads: Schema.Array(StartRuntimeHandlerThreadInputSchema).check(Schema.isNonEmpty()),
});
export type StartRuntimeHandlerThreadsInput = typeof StartRuntimeHandlerThreadsInputSchema.Type;

export const StartedRuntimeHandlerThreadSchema = Schema.Struct({
  threadId: ThreadId,
  threadGroupId: ThreadGroupId,
  workspaceSessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  parentThreadId: Schema.NullOr(ThreadId),
  title: Schema.String,
  objective: Schema.String,
  historyMode: ThreadHistoryModeSchema,
  objectiveState: Schema.Literal("active"),
  status: Schema.Literal("running-handler"),
  wait: Schema.Null,
  worktreeId: Schema.NullOr(WorktreeId),
  generatedAgentContextFingerprint: Schema.String,
  generatedAgentContextBindingId: Schema.String,
  queuedMessageId: QueueItemId,
});
export type StartedRuntimeHandlerThread = typeof StartedRuntimeHandlerThreadSchema.Type;

export const StartRuntimeHandlerThreadsResultSchema = Schema.Struct({
  threadGroupId: ThreadGroupId,
  threads: Schema.Array(StartedRuntimeHandlerThreadSchema),
});
export type StartRuntimeHandlerThreadsResult = typeof StartRuntimeHandlerThreadsResultSchema.Type;

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

export const RuntimeThreadReadModelEpisodeSummarySchema = Schema.Struct({
  id: EpisodeId,
  title: Schema.String,
  summary: Schema.String,
  createdAt: Schema.String,
});
export type RuntimeThreadReadModelEpisodeSummary =
  typeof RuntimeThreadReadModelEpisodeSummarySchema.Type;

export const RuntimeThreadCompactRowSchema = Schema.Struct({
  threadId: ThreadId,
  threadGroupId: ThreadGroupId,
  workspaceSessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  title: Schema.String,
  objective: Schema.String,
  objectiveState: Schema.Literals(["active", "concluded"]),
  status: RuntimeThreadStatusSchema,
  wait: Schema.NullOr(RuntimeThreadReadModelWaitSchema),
  latestEpisode: Schema.NullOr(RuntimeThreadReadModelEpisodeSummarySchema),
});
export type RuntimeThreadCompactRow = typeof RuntimeThreadCompactRowSchema.Type;

export const RuntimeThreadPendingReportRequestSchema = Schema.Struct({
  queuedMessageId: QueueItemId,
  request: Schema.String,
  createdAt: Schema.String,
});
export type RuntimeThreadPendingReportRequest = typeof RuntimeThreadPendingReportRequestSchema.Type;

export const RuntimeThreadCurrentReadModelSchema = Schema.Struct({
  ...RuntimeThreadCompactRowSchema.fields,
  pendingReportRequests: Schema.Array(RuntimeThreadPendingReportRequestSchema),
});
export type RuntimeThreadCurrentReadModel = typeof RuntimeThreadCurrentReadModelSchema.Type;

export const RuntimeThreadListReadModelSchema = Schema.Struct({
  threads: Schema.Array(RuntimeThreadCompactRowSchema),
});
export type RuntimeThreadListReadModel = typeof RuntimeThreadListReadModelSchema.Type;

export const RuntimeThreadEpisodesReadModelSchema = Schema.Struct({
  episodes: Schema.Array(RuntimeEpisodeRecordSchema),
});
export type RuntimeThreadEpisodesReadModel = typeof RuntimeThreadEpisodesReadModelSchema.Type;

export const RuntimeThreadGroupReadModelSchema = Schema.Struct({
  threadGroupId: ThreadGroupId,
  currentThreadId: ThreadId,
  threads: Schema.Array(RuntimeThreadCompactRowSchema),
});
export type RuntimeThreadGroupReadModel = typeof RuntimeThreadGroupReadModelSchema.Type;

export const GetCurrentRuntimeThreadInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  threadId: ThreadId,
});
export type GetCurrentRuntimeThreadInput = typeof GetCurrentRuntimeThreadInputSchema.Type;

export const ListRuntimeThreadsInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  status: Schema.optionalKey(Schema.NullOr(Schema.Array(RuntimeThreadStatusSchema))),
  threadGroupId: Schema.optionalKey(Schema.NullOr(ThreadGroupId)),
  limit: Schema.optionalKey(Schema.Number),
});
export type ListRuntimeThreadsInput = typeof ListRuntimeThreadsInputSchema.Type;

export const ReadRuntimeThreadEpisodesInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  target: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("thread"),
      threadId: ThreadId,
    }),
    Schema.Struct({
      kind: Schema.Literal("thread-group"),
      threadGroupId: ThreadGroupId,
    }),
  ]),
  limit: Schema.optionalKey(Schema.Number),
});
export type ReadRuntimeThreadEpisodesInput = typeof ReadRuntimeThreadEpisodesInputSchema.Type;

export const GetRuntimeThreadGroupInputSchema = Schema.Struct({
  workspaceSessionId: WorkspaceSessionId,
  currentThreadId: ThreadId,
});
export type GetRuntimeThreadGroupInput = typeof GetRuntimeThreadGroupInputSchema.Type;

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
