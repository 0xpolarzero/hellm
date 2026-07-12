import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  RUNTIME_TURN_DECISIONS,
  StateContractError,
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  type ArtifactMaterializationStatus,
  type ArtifactMetadataRecord,
  decodeUnknownExtensionDependencyApprovalIdentityExit,
  ExtensionRegistryObservationResultSchema,
  decodeUnknownRequestUserInputAnswerQueuePayloadExit,
  decodeUnknownRequestInputSettingsExit,
  PiHistoryEntryRefSchema,
  RuntimeSubmittedMessageSchema,
  RuntimeTranscriptAssistantContentSchema,
  RuntimeTranscriptUsageSchema,
  type AbsolutePath,
  type ActorKind,
  type AgentProfileId,
  type AcceptEditedCommittedRuntimeSurfaceMessageInput,
  type AcceptEditedCommittedRuntimeSurfaceMessageResult,
  type ApplyRuntimeExtensionSnapshotContextImpactInput,
  type BindRuntimeGeneratedContextInput,
  type ComposerAttachment,
  type ComposerSnippetMention,
  type DiscoveredSnippetScope,
  type DiscoveredSnippetSource,
  type CommandId,
  type ExtensionDependencyApprovalIdentity,
  type ExtensionDependencyReadiness,
  type ExtensionUsageChangeId,
  type ExtensionUsageChangeRecord,
  type RevertExtensionUsageInput,
  type SetExtensionUsageInput,
  ExtensionBuildAttemptRecordSchema,
  RecordExtensionBuildFailureInputSchema,
  RecordExtensionBuildSuccessInputSchema,
  StartExtensionBuildAttemptInputSchema,
  type ExtensionBuildAttemptRecord,
  type RecordExtensionBuildFailureInput,
  type RecordExtensionBuildSuccessInput,
  type StartExtensionBuildAttemptInput,
  ExtensionSourceBuildObservationSchema,
  type ExtensionSourceBuildObservation,
  type ExtensionRegistryStateRecord,
  type ReconcileExtensionRegistryObservationInput,
  type ReconcileExtensionSourceBuildEvidenceInput,
  type ReconcileExtensionSourceBuildEvidenceResult,
  type ExtensionId,
  type ExtensionEnvSecretRef,
  ExtensionSnapshotPayloadRefSchema,
  ExtensionSnapshotRestoreAttemptSchema,
  ExtensionSnapshotStateRecordSchema,
  type AdvanceExtensionSnapshotRestoreAttemptCommand,
  type AdvanceExtensionSnapshotRestoreAttemptReceipt,
  type ApplyExtensionSnapshotSettingsCommand,
  type ApplyExtensionSnapshotSettingsReceipt,
  type CompleteExtensionSnapshotCleanupCommand,
  type CompleteExtensionSnapshotCleanupReceipt,
  type DeleteExtensionSnapshotCommand,
  type DeleteExtensionSnapshotReceipt,
  type ExtensionSnapshotCleanupRecord,
  type ExtensionSnapshotId,
  type ExtensionSnapshotRestoreAttempt,
  type ExtensionSnapshotRestoreAttemptId,
  type ExtensionSnapshotsReadModel,
  type ExtensionSnapshotStateRecord,
  type ExtensionSnapshotSettingsCaptureFacts,
  type LoadExtensionSnapshotCommand,
  type LoadExtensionSnapshotReceipt,
  type RenameExtensionSnapshotCommand,
  type RenameExtensionSnapshotReceipt,
  type SaveExtensionSnapshotCommand,
  type SaveExtensionSnapshotReceipt,
  type ExtensionUsageState,
  type ExternalInstructionsSettings,
  type ExternalInstructionObservationProjection,
  type ExternalInstructionProjectedSource,
  type ReconcileExternalInstructionsInput,
  type ReconcileExternalInstructionsResult,
  type GeneratedPackageBuildId,
  type GeneratedPackageName,
  type GeneratedWorkflowsExportBuildEvidence,
  type HandlerInheritedHistoryBlock,
  type JsonValue,
  type IsoDateTimeString,
  type CompactWorkspaceSurface,
  type DeletePiSessionReferenceInput,
  type MarkGeneratedPackageRefreshNeededInput,
  type MessageId,
  type AdvanceRuntimeTranscriptStreamCursorInput,
  type AppendRuntimeTranscriptAssistantContentDeltaInput,
  type BeginRuntimeTranscriptAssistantMessageInput,
  type BindRuntimeTranscriptPiHistoryEntryInput,
  type CommitRuntimeTranscriptAssistantMessageInput,
  type CommitRuntimeTranscriptUserMessageInput,
  type FailRuntimeTranscriptAssistantMessageInput,
  type LinkRuntimeTranscriptAssistantToolCallCommandInput,
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
  type ListProviderStatusesInput,
  type GetPiSessionReferenceInput,
  type PiSessionReference,
  type PiSessionReferenceValidation,
  type ProviderAuthStatus,
  type ReadRuntimeSourceVersionInput,
  type ReadGeneratedPackageFactsInput,
  type ReadGeneratedPackageLinksNeedingRepairInput,
  type MarkWorkspaceGeneratedPackageLinksRepairNeededInput,
  type MarkWorkspaceGeneratedPackageLinksRepairNeededResult,
  type RecordProviderAuthStatusInput,
  type ReconcileDiscoveredHostSnippetsInput,
  type RecordObservedRuntimeSourceDeletionInput,
  type RecordRuntimeSourceDiagnosticInput,
  type RecordRuntimeSourceDeleteInput,
  type RecordRuntimeSourceScanInput,
  type RecordRuntimeSourceSaveInput,
  type RecordRuntimeWorkflowAgentSourceDeleteInput,
  type RecordRuntimeWorkflowAgentSourceSaveInput,
  type ReconcileRuntimeWorkflowAgentSourcesInput,
  type RequestInputAnswerId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RequestInputSettings,
  type SetRequestInputBlockingTimeoutInput,
  type SetRequestInputVariantInput,
  type RequestUserInputAnswerDeliveryPayload,
  type RequestUserInputAnswerQueuePayload,
  type ReconcileGeneratedPackageManifestInput,
  type ReleaseWorkspaceInput,
  type ReleaseWorkspaceResult,
  type RenameOrchestratorSurfaceResult,
  type RecordExtensionDependencyReadinessInput,
  type ReconcileExtensionDependencyReadinessInput,
  type ReconcileExtensionDependencyReadinessResult,
  type RecordGeneratedPackageBuildInput,
  type RecordGeneratedPackageFailureInput,
  type RecordGeneratedPackageWorkspaceLinkInput,
  type RuntimeSourceFactRecord,
  type RuntimeSourceRootFingerprintFactRecord,
  type RuntimeSourceScanFactRecord,
  type RuntimeSurfaceTranscriptSnapshot,
  type RuntimeSurfaceTarget,
  type RuntimeTranscriptAssistantContent,
  type RuntimeTranscriptAssistantMessage,
  type RuntimeTranscriptAssistantMutation,
  type RuntimeTranscriptMessage,
  type RuntimeTranscriptStreamCursor,
  type RuntimeTranscriptToolCallBlock,
  type RuntimeTranscriptUserMessage,
  type RuntimeTranscriptUserMutation,
  type WorkflowAgentSourceObservation,
  type RuntimeExtensionContextChangedSurface,
  type RuntimeExtensionUsageProfileKey,
  type RuntimeGeneratedPackageFactRecord,
  type RuntimeGeneratedPackageWorkspaceLinkRecord,
  type SurfacePiSessionId,
  type ThreadId,
  type UpsertRuntimeTranscriptAssistantToolCallInput,
  type SavePiSessionReferenceInput,
  type ValidatePiSessionReferenceInput,
  type WorkspaceId,
  type WorkspaceSessionId,
  type WorkflowTaskAttemptId,
  type WorkspacePaneRecord,
  CheckedWorkspaceLayoutSlotContentSchema,
  type RuntimeTurnDecision,
  SnippetMetadataSchema,
  SnippetSourceSchema,
  discoveredHostSnippetId,
  type StateRevision,
  strictBoundaryParseOptions,
  type SnippetMetadata,
  type SnippetSource,
  decodeUnknownExternalInstructionsSettingsExit,
  decodeUnknownGeneratedWorkflowsExportBuildEvidenceExit,
  normalizeExternalInstructionsSettings,
  normalizeRuntimeClientSubmissionMetadata,
  type RuntimeClientSubmissionInput,
  type StateCommandReceipt,
} from "@svvy/core";
import type {
  CreateManagedSnippetCommandInput,
  DeleteManagedSnippetCommandInput,
  DeleteOrchestratorProfileCommandInput,
  PromoteProfileExtensionDefaultCommandInput,
  RemoveExtensionEnvOverrideCommandInput,
  RemoveExtensionEnvSecretCommandInput,
  ReorderOrchestratorProfilesCommandInput,
  ResetActorExtensionDefaultsCommandInput,
  SaveWorkspaceLayoutSlotCommandInput,
  SelectWorkspaceLayoutSlotCommandInput,
  SelectWorkspaceTabCommandInput,
  SetExternalInstructionActorUsageCommandInput,
  SetExtensionEnvOverrideCommandInput,
  SetExtensionEnvSecretCommandInput,
  SetProfileExtensionUsageCommandInput,
  SetSnippetEnabledCommandInput,
  SetWorkspaceTabsCommandInput,
  UpdateManagedSnippetCommandInput,
  UpdateOrchestratorProfileCommandInput,
  UpdateThreadHandlerProfileCommandInput,
  WorkspaceLayoutSlotId,
} from "./state-command-schemas";

const DEFAULT_SIDEBAR_SECTION_SIZES = {
  pinned: 150,
  active: 260,
  archived: 190,
} as const;

const GLOBAL_PROVIDER_AUTH_WORKSPACE_KEY = "";
const EMPTY_WORKSPACE_LAYOUT_UPDATED_AT = "1970-01-01T00:00:00.000Z";
const DEFAULT_AGENT_PROFILE_UPDATED_AT = "1970-01-01T00:00:00.000Z";
const MIN_SIDEBAR_SECTION_SIZE_PX = 64;
const MAX_SIDEBAR_SECTION_SIZE_PX = 1000;
const DEFAULT_EXTERNAL_INSTRUCTIONS_JSON = JSON.stringify(DEFAULT_EXTERNAL_INSTRUCTIONS);
const DEFAULT_EXTERNAL_INSTRUCTIONS_SQL_JSON = DEFAULT_EXTERNAL_INSTRUCTIONS_JSON.replaceAll(
  "'",
  "''",
);
const DEFAULT_REQUEST_INPUT_SETTINGS = {
  mode: "nonblocking",
  blockingTimeout: {
    enabled: true,
    durationMs: 300000 as RequestInputSettings["blockingTimeout"]["durationMs"],
  },
} satisfies RequestInputSettings;
const decodeSnippetMetadataContract = Schema.decodeUnknownSync(
  SnippetMetadataSchema,
  strictBoundaryParseOptions,
);
const decodeSnippetSourceContract = Schema.decodeUnknownSync(
  SnippetSourceSchema,
  strictBoundaryParseOptions,
);
const decodeExtensionRegistryObservationResultContract = Schema.decodeUnknownSync(
  ExtensionRegistryObservationResultSchema,
  strictBoundaryParseOptions,
);
const decodeExtensionSourceBuildObservationContract = Schema.decodeUnknownSync(
  ExtensionSourceBuildObservationSchema,
  strictBoundaryParseOptions,
);
const decodeExtensionBuildAttemptRecordContract = Schema.decodeUnknownSync(
  ExtensionBuildAttemptRecordSchema,
  strictBoundaryParseOptions,
);
const decodeExtensionSnapshotPayloadRefContract = Schema.decodeUnknownSync(
  ExtensionSnapshotPayloadRefSchema,
  strictBoundaryParseOptions,
);
const decodeExtensionSnapshotStateRecordContract = Schema.decodeUnknownSync(
  ExtensionSnapshotStateRecordSchema,
  strictBoundaryParseOptions,
);
const decodeExtensionSnapshotRestoreAttemptContract = Schema.decodeUnknownSync(
  ExtensionSnapshotRestoreAttemptSchema,
  strictBoundaryParseOptions,
);
const decodeStartExtensionBuildAttemptInputContract = Schema.decodeUnknownSync(
  StartExtensionBuildAttemptInputSchema,
  strictBoundaryParseOptions,
);
const decodeRecordExtensionBuildSuccessInputContract = Schema.decodeUnknownSync(
  RecordExtensionBuildSuccessInputSchema,
  strictBoundaryParseOptions,
);
const decodeRecordExtensionBuildFailureInputContract = Schema.decodeUnknownSync(
  RecordExtensionBuildFailureInputSchema,
  strictBoundaryParseOptions,
);
const decodeWorkspaceLayoutSlotContentContract = Schema.decodeUnknownSync(
  CheckedWorkspaceLayoutSlotContentSchema,
  strictBoundaryParseOptions,
);
const decodeRuntimeSubmittedMessageContract = Schema.decodeUnknownSync(
  RuntimeSubmittedMessageSchema,
  strictBoundaryParseOptions,
);
const decodeRuntimeTranscriptAssistantContentContract = Schema.decodeUnknownSync(
  RuntimeTranscriptAssistantContentSchema,
  strictBoundaryParseOptions,
);
const decodeRuntimeTranscriptUsageContract = Schema.decodeUnknownSync(
  RuntimeTranscriptUsageSchema,
  strictBoundaryParseOptions,
);
const decodePiHistoryEntryRefContract = Schema.decodeUnknownSync(
  PiHistoryEntryRefSchema,
  strictBoundaryParseOptions,
);

function runtimeSourceScopeKey(scope: RuntimeSourceScanFactRecord["scope"]): string {
  return scope.kind === "workspace" ? `workspace:${scope.workspaceId}` : "app-global";
}

function extensionDependencyApprovalIdentityKey(
  identity: ExtensionDependencyApprovalIdentity,
): string {
  return JSON.stringify({
    kind: identity.kind,
    packageManager: identity.packageManager,
    source: identity.source,
    name: identity.name,
    version: identity.version,
    integrity: identity.integrity,
    resolution: identity.resolution,
  });
}

function recoveryWorkScopeSql(scope: StructuredRecoveryWorkScope): {
  scopeKind: "app" | "workspace";
  workspaceId: string | null;
} {
  return scope.kind === "app"
    ? { scopeKind: "app", workspaceId: null }
    : { scopeKind: "workspace", workspaceId: scope.workspaceId };
}

function assertRecoveryWorkScopeMatchesKind(input: {
  scope: StructuredRecoveryWorkScope;
  kind: StructuredRecoveryWorkKind;
  ownerScope: StructuredRecoveryWorkOwnerScope;
}): void {
  if (input.kind === "generated_package_refresh" && input.scope.kind !== "app") {
    throw new Error("generated_package_refresh recovery work must be app-scoped.");
  }
  if (
    input.kind === "workspace_generated_package_link_repair" &&
    input.scope.kind !== "workspace"
  ) {
    throw new Error(
      "workspace_generated_package_link_repair recovery work must be workspace-scoped.",
    );
  }
  if (input.kind === "source_reconcile" && input.scope.kind !== "app") {
    throw new Error("source_reconcile recovery work must be app-scoped.");
  }
  if (input.kind === "source_reconcile" && input.ownerScope.kind !== "source") {
    throw new Error("source_reconcile recovery work must be owned by a source.");
  }
  if (input.ownerScope.kind === "source" && input.kind !== "source_reconcile") {
    throw new Error("source recovery ownership is reserved for source_reconcile work.");
  }
}

function assertRuntimeSourceScanScopeMatchesDomain(input: {
  scope: RuntimeSourceScanFactRecord["scope"];
  domain: RuntimeSourceScanFactRecord["domain"];
}): void {
  const isAppGlobalDomain = input.domain === "extensions" || input.domain === "workflows";
  if (input.scope.kind === "app-global" && !isAppGlobalDomain) {
    throw new Error(`app-global source scan cannot target ${input.domain}.`);
  }
  if (input.scope.kind === "workspace" && isAppGlobalDomain) {
    throw new Error(`workspace source scan cannot target ${input.domain}.`);
  }
}

function assertStructuredAppPreferenceApprovalMode(
  value: string,
): asserts value is StructuredAppPreferenceApprovalMode {
  if (value === "auto-review" || value === "user" || value === "full-access") return;
  throw new Error(`Invalid app preference approval mode ${value}.`);
}

function assertStructuredAppPreferenceAppearance(value: string): StructuredAppPreferenceAppearance {
  if (value === "system" || value === "light" || value === "dark") return value;
  throw new Error(`Invalid app preference appearance ${value}.`);
}

function runtimeSourceScanFallbackFingerprint(
  domain: RuntimeSourceScanFactRecord["domain"],
): string {
  return `unresolved:${domain}`;
}

export type StructuredSessionStatus = "idle" | "running" | "waiting" | "error";
export type StructuredTurnStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";
export const STRUCTURED_TURN_DECISIONS = ["pending", ...RUNTIME_TURN_DECISIONS] as const;
export type StructuredTurnDecision = "pending" | RuntimeTurnDecision;
export type StructuredThreadStatus =
  | "idle"
  | "running-handler"
  | "running-workflow"
  | "waiting"
  | "troubleshooting"
  | "completed";
export type StructuredThreadHistoryMode = "isolated" | "forked";
export type StructuredThreadObjectiveState = "active" | "concluded";
export type StructuredWaitKind = "user" | "external" | "approval" | "signal" | "timer";
export type StructuredThreadWaitOwner = "handler" | "workflow";
export type StructuredWorkflowWaitKind = "approval" | "event" | "timer";
export type StructuredCommandExecutor =
  | "orchestrator"
  | "handler"
  | "workflow-task-agent"
  | "execute_typescript"
  | "runtime";
export type StructuredCommandVisibility = "trace" | "summary" | "surface";
export type StructuredCommandStatus =
  | "streaming"
  | "requested"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";
const TERMINAL_COMMAND_STATUSES = new Set<StructuredCommandStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);
export type StructuredRuntimeApprovalStatus = "pending" | "approved" | "denied" | "cancelled";
export type StructuredRuntimeApprovalMode = "auto-review" | "user";
export type StructuredRuntimeApprovalToolName =
  | "apply_patch"
  | "exec_command"
  | "execute_typescript";
export type StructuredEpisodeKind =
  | "analysis"
  | "change"
  | "workflow"
  | "clarification"
  | "report"
  | "handoff"
  | "conclusion";
export type StructuredArtifactKind = "text" | "log" | "json" | "file";
export type StructuredWorkflowStatus =
  | "running"
  | "waiting"
  | "continued"
  | "completed"
  | "failed"
  | "cancelled";
export type StructuredWorkflowTaskAttemptKind = "agent" | "compute" | "static" | "unknown";
export type StructuredWorkflowTaskAttemptStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";
export type StructuredWorkflowTaskMessageRole = "user" | "assistant" | "stderr";
export type StructuredGeneratedAgentContextActor = "orchestrator" | "handler" | "workflow-task";
export type StructuredGeneratedAgentContextBindingOwner =
  | "session"
  | "thread"
  | "workflow-task-attempt";
export type StructuredWorkflowTaskMessageSource = "prompt" | "event" | "responseText";
export type StructuredTitleGenerationStatus =
  | "not-started"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface StructuredWorkspaceRecord {
  id: string;
  label: string;
  cwd: string;
  artifactDir: string;
}

export interface StructuredWorkspaceInput {
  id: string;
  label: string;
  cwd: string;
  artifactDir?: string;
}

export type StructuredAppPreferenceApprovalMode = "auto-review" | "user" | "full-access";
export type StructuredAppPreferenceAppearance = "system" | "light" | "dark";

export interface StructuredAppPreferencesRecord {
  appearance: StructuredAppPreferenceAppearance;
  externalEditor: string | null;
  artifactDirectory: string;
  approvalMode: StructuredAppPreferenceApprovalMode;
  networkAccess: boolean;
  externalInstructions: ExternalInstructionsSettings;
  ambientResources: JsonValue;
  updatedAt: string;
  stateRevision: StateRevision;
}

export interface StructuredAppPreferencesPatch {
  appearance?: StructuredAppPreferenceAppearance;
  externalEditor?: string | null;
  artifactDirectory?: string;
  approvalMode?: StructuredAppPreferenceApprovalMode;
  networkAccess?: boolean;
  externalInstructions?: ExternalInstructionsSettings;
  ambientResources?: JsonValue;
  updatedAt?: string;
}

export interface StructuredMutationCommitRecord {
  updatedAt: string;
  stateRevision: StateRevision;
}

export interface StructuredWorkspaceChromeMutationRecord extends StructuredMutationCommitRecord {
  outcome: "committed" | "no-op";
}

export interface StructuredWorkspaceTabRecord {
  workspaceTabId: string;
  workspaceId: string;
  cwd: string;
  workspaceLabel: string;
  kind: "default" | "user";
  openedAt: string;
  activeLayoutId: WorkspaceLayoutSlotId;
}

export interface StructuredWorkspaceChromeRecord {
  activeWorkspaceTabId: string | null;
  tabs: StructuredWorkspaceTabRecord[];
  knownWorkspaces: StructuredWorkspaceTabRecord[];
  stateRevision: StateRevision;
}

export interface StructuredWorkspaceLayoutRecord {
  workspaceId: string;
  slots: readonly StructuredWorkspaceLayoutSlotRecord[];
  stateRevision: StateRevision;
}

export interface StructuredWorkspaceLayoutSlotRecord {
  workspaceId: string;
  layoutId: WorkspaceLayoutSlotId;
  initialized: boolean;
  dockviewJson: JsonValue | null;
  panes: readonly WorkspacePaneRecord[];
  compactSurfaces: readonly CompactWorkspaceSurface[];
  focusedPaneId: string | null;
  updatedAt: string;
}

export interface StructuredAgentProfileRecord {
  profileId: string;
  actor: "orchestrator" | "handler";
  name: string;
  providerId: string;
  modelId: string;
  reasoning: JsonValue | null;
  followComposer: boolean;
  extensionUsage: Record<string, ExtensionUsageState>;
  extensionOrder: string[];
  position: number;
  updatedAt: string;
}

export interface StructuredAgentActorExtensionDefaultsRecord {
  actor: "orchestrator" | "workflow-task";
  extensionUsage: Record<string, ExtensionUsageState>;
  extensionOrder: string[];
  updatedAt: string;
}

export interface StructuredAgentActorExtensionDefaultsInput {
  actor: StructuredAgentActorExtensionDefaultsRecord["actor"];
  extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
  extensionOrder: readonly string[];
}

export interface StructuredExtensionEnvOverrideRecord {
  extensionId: string;
  envName: string;
  value: string;
  updatedAt: string;
}

export interface StructuredExtensionEnvDeclarationRecord {
  extensionId: string;
  envName: string;
  required: boolean;
  secret: boolean;
  description: string | null;
  updatedAt: string;
}

export interface StructuredExtensionEnvSecretRecord {
  extensionId: string;
  envName: string;
  ref: ExtensionEnvSecretRef;
  revisionFingerprint: string;
  status: "configured" | "missing";
  updatedAt: string;
}

export interface StructuredExtensionEnvSecretReceiptRecord {
  operation: "set" | "remove";
  clientRequestId: string;
  extensionId: string;
  envName: string;
  configured: boolean;
  committedAt: string;
  stateRevision: StateRevision;
}

export interface StructuredExtensionEnvSecretCleanupRecord {
  ref: ExtensionEnvSecretRef;
  revisionFingerprint: string;
  reason: "replaced" | "removed" | "orphaned";
  createdAt: string;
}

export interface StructuredExtensionRegistryReconcileResult {
  record: ExtensionRegistryStateRecord;
  outcome: "committed" | "no-op";
  stateRevision: StateRevision;
}

export interface StructuredExtensionSourceBuildEvidenceBatchRecord {
  registryAggregateFingerprint: string;
  observations: readonly ExtensionSourceBuildObservation[];
  observedAt: IsoDateTimeString;
}

export interface StructuredExtensionSourceBuildEvidenceReconcileResult extends ReconcileExtensionSourceBuildEvidenceResult {
  stateRevision: StateRevision;
}

export interface StructuredExtensionBuildAttemptMutationResult {
  record: ExtensionBuildAttemptRecord;
  outcome: "committed" | "no-op";
  stateRevision: StateRevision;
}

export interface StructuredSnippetRecord {
  id: string;
  workspaceId: string;
  source: SnippetSource;
  title: string;
  body: string;
  metadata: SnippetMetadata;
  enabled: boolean;
  path: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface StructuredPiSessionRecord {
  sessionId: string;
  parentSessionId?: string | null;
  title: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  orchestratorAgentProfileId?: AgentProfileId;
  orchestratorAgentProfileJson?: string | null;
  generatedAgentContextFingerprint?: string | null;
  updateExtensionContextBeforeNextTurn?: boolean;
  loadedExtensionIds?: string[];
  availableExtensionIds?: string[];
  titleNamerAgentJson?: string | null;
  titleGenerationStatus?: StructuredTitleGenerationStatus;
  titleGenerationTriggeredAt?: string | null;
  titleGenerationFinishedAt?: string | null;
  titleGenerationError?: string | null;
  titleAutoFrozen?: boolean;
  titleManualOverride?: boolean;
  messageCount: number;
  status: StructuredSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StructuredComposerDraftRecord {
  sessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  text: string;
  attachments: ComposerAttachment[];
  snippetMentions: ComposerSnippetMention[];
  updatedAt: string;
}

export interface StructuredPromptHistoryRecord {
  workspaceId: string;
  workspaceSessionId: string;
  surfacePiSessionId: string;
  queueItemId: string;
  text: string;
  sentAt: string;
}

export interface StructuredWaitState {
  owner: StructuredThreadWaitOwner;
  kind: StructuredWaitKind;
  reason: string;
  resumeWhen: string;
  since: string;
}

export type StructuredSessionWaitOwner =
  | { kind: "orchestrator" }
  | { kind: "thread"; threadId: string };

export interface StructuredSessionWaitState {
  owner: StructuredSessionWaitOwner;
  kind: StructuredWaitKind;
  reason: string;
  resumeWhen: string;
  since: string;
}

export interface StructuredTurnRecord {
  id: string;
  sessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  requestSummary: string;
  turnDecision: StructuredTurnDecision;
  status: StructuredTurnStatus;
  assistantMessageId: MessageId | null;
  assistantText: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredInterruptedTurnRecoveryResult {
  changed: boolean;
  turn: StructuredTurnRecord;
  terminalizedAssistantMessageId: string | null;
  terminalizedCommandIds: string[];
  settledQueueItemId: string | null;
  cancelledRequestInputIds: string[];
  cancelledApprovalIds: string[];
  sessionWaitCleared: boolean;
}

export interface StructuredPromptTurnSettlementResult {
  changed: boolean;
  turn: StructuredTurnRecord;
  queuedMessage: StructuredSurfaceQueuedMessageRecord;
  terminalizedCommandIds: string[];
}

export interface StructuredThreadRecord {
  id: string;
  sessionId: string;
  turnId: string;
  parentThreadId: string | null;
  threadGroupId: string;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  historyMode: StructuredThreadHistoryMode;
  objectiveState: StructuredThreadObjectiveState;
  status: StructuredThreadStatus;
  wait: StructuredWaitState | null;
  loadedExtensionIds: string[];
  availableExtensionIds: string[];
  worktree?: string;
  agentProfileJson?: string | null;
  generatedAgentContextFingerprint?: string | null;
  updateExtensionContextBeforeNextTurn: boolean;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredGeneratedAgentContextBindingRecord {
  id: string;
  surfacePiSessionId: string;
  ownerKind: StructuredGeneratedAgentContextBindingOwner;
  ownerId: string;
  actorKind: StructuredGeneratedAgentContextActor;
  systemPrompt: string;
  svvyxGuidance: string;
  commandsDts: string;
  nativeToolSchemasJson: string;
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  loadedExtensionIds: string[];
  availableExtensionIds: string[];
  externalSourceHashes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StructuredCommandRecord {
  id: string;
  sessionId: string;
  turnId: string | null;
  workflowTaskAttemptId: string | null;
  surfacePiSessionId: string;
  threadId: string | null;
  workflowRunId: string | null;
  parentCommandId: string | null;
  toolName: string;
  executor: StructuredCommandExecutor;
  visibility: StructuredCommandVisibility;
  status: StructuredCommandStatus;
  attempts: number;
  title: string;
  summary: string;
  arguments: unknown | null;
  facts: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredStreamingCommandInput {
  toolCallId: string;
  turnId?: string | null;
  workflowTaskAttemptId?: string | null;
  surfacePiSessionId?: string;
  threadId?: string | null;
  workflowRunId?: string | null;
  parentCommandId?: string | null;
  toolName: string;
  executor: StructuredCommandExecutor;
  visibility: StructuredCommandVisibility;
  title: string;
  summary: string;
  arguments?: unknown;
  facts?: Record<string, unknown> | null;
}

export interface StructuredFinishCommandInput {
  commandId: string;
  status: Exclude<StructuredCommandStatus, "requested" | "running">;
  visibility?: StructuredCommandVisibility;
  summary?: string;
  facts?: Record<string, unknown> | null;
  error?: string | null;
  at?: string;
}

export interface StructuredCommandMutationResult {
  record: StructuredCommandRecord;
  changed: boolean;
}

export interface StructuredEpisodeRecord {
  id: string;
  sessionId: string;
  threadId: string;
  sourceCommandId: string | null;
  kind: StructuredEpisodeKind;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
}

export interface StructuredWorkflowRunRecord {
  id: string;
  sessionId: string;
  threadId: string;
  commandId: string;
  smithersRunId: string;
  workflowName: string;
  workflowSource: "saved" | "artifact";
  entryPath: string | null;
  savedEntryId: string | null;
  status: StructuredWorkflowStatus;
  smithersStatus: string;
  waitKind: StructuredWorkflowWaitKind | null;
  continuedFromRunIds: string[];
  activeDescendantRunId: string | null;
  lastEventSeq: number | null;
  heartbeatAt: string | null;
  summary: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredWorkflowTaskAttemptRecord {
  id: string;
  sessionId: string;
  threadId: string;
  workflowRunId: string;
  smithersRunId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  surfacePiSessionId: string | null;
  title: string;
  summary: string;
  kind: StructuredWorkflowTaskAttemptKind;
  status: StructuredWorkflowTaskAttemptStatus;
  smithersState: string;
  prompt: string | null;
  responseText: string | null;
  error: string | null;
  cached: boolean;
  jjPointer: string | null;
  jjCwd: string | null;
  heartbeatAt: string | null;
  agentId: string | null;
  agentModel: string | null;
  agentEngine: string | null;
  agentResume: string | null;
  generatedAgentContextFingerprint: string | null;
  meta: Record<string, unknown> | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredWorkflowTaskMessageRecord {
  id: string;
  sessionId: string;
  workflowTaskAttemptId: string;
  role: StructuredWorkflowTaskMessageRole;
  source: StructuredWorkflowTaskMessageSource;
  smithersEventSeq: number | null;
  text: string;
  createdAt: string;
}

export type StructuredRequestUserInputVariant = "nonblocking" | "blocking";
export type StructuredRequestUserInputStatus = "open" | "completed" | "cancelled" | "expired";
export type StructuredRequestUserInputQuestionStatus =
  | "open"
  | "answered"
  | "defaulted"
  | "cancelled";
export type StructuredRequestUserInputAnsweredBy = "user" | "default" | "timeout_default";
export type StructuredRequestUserInputDelivery = "enqueue-and-run" | "queue-only";
export type StructuredRequestUserInputAnswer =
  | {
      kind: "option";
      label: string;
      text: string;
    }
  | {
      kind: "custom";
      text: string;
    };

export interface StructuredRequestUserInputOptionRecord {
  optionId: string;
  ordinal: number;
  label: string;
  description: string;
  recommended: boolean;
}

export interface StructuredRequestUserInputQuestionRecord {
  questionId: string;
  requestId: string;
  ordinal: number;
  title: string;
  question: string;
  defaultAnswer: StructuredRequestUserInputAnswer;
  choices: StructuredRequestUserInputOptionRecord[];
  status: StructuredRequestUserInputQuestionStatus;
}

export interface StructuredRequestUserInputAnswerRecord {
  answerId: string;
  requestId: string;
  questionId: string;
  answer: StructuredRequestUserInputAnswer;
  answeredBy: StructuredRequestUserInputAnsweredBy;
  delivery: StructuredRequestUserInputDelivery | null;
  queuedItemId: string | null;
  createdAt: string;
}

export interface StructuredRequestUserInputRequestRecord {
  requestId: string;
  sessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  turnId: string;
  commandId: string;
  toolItemId: string;
  variant: StructuredRequestUserInputVariant;
  status: StructuredRequestUserInputStatus;
  createdAt: string;
  completedAt: string | null;
  timeout: null | {
    timerVersion: number;
    enabled: boolean;
    durationMs: number;
    startedAt: string;
    pausedAt: string | null;
    remainingMsWhenPaused: number | null;
    expiresAt: string | null;
  };
  questions: StructuredRequestUserInputQuestionRecord[];
  answers: StructuredRequestUserInputAnswerRecord[];
}

export interface StructuredRequestUserInputMutationResult {
  record: StructuredRequestUserInputRequestRecord;
  changed: boolean;
}

export interface StructuredRuntimeApprovalRequestRecord {
  requestId: string;
  sessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  turnId: string | null;
  commandId: string | null;
  toolCallId: string;
  toolName: StructuredRuntimeApprovalToolName;
  approvalMode: StructuredRuntimeApprovalMode;
  cwd: string;
  command: string | null;
  commandFamily: string | null;
  patch: string | null;
  snippetArtifactId: string | null;
  typescriptCode: string | null;
  context: {
    reason: "sandbox_denial_escalation";
    sandboxDenied: true;
  } | null;
  status: StructuredRuntimeApprovalStatus;
  decisionReason: string | null;
  reviewer: "auto-review" | "user" | null;
  createdAt: string;
  completedAt: string | null;
}

export interface StructuredRuntimeApprovalResolutionResult {
  record: StructuredRuntimeApprovalRequestRecord;
  changed: boolean;
}

export interface StructuredArtifactRecord {
  id: string;
  sessionId: string;
  threadId: string | null;
  workflowRunId: string | null;
  workflowTaskAttemptId: string | null;
  sourceCommandId: string | null;
  kind: StructuredArtifactKind;
  name: string;
  path?: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  immutable: boolean;
  missingFile?: boolean;
  createdAt: string;
  deletedAt: string | null;
}

type RecordArtifactMetadataInput = {
  workspaceSessionId: string;
  threadId?: string | null;
  workflowRunId?: string | null;
  workflowTaskAttemptId?: string | null;
  sourceCommandId: string;
  kind: StructuredArtifactKind;
  name: string;
  storedPath: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  immutable: boolean;
  materializationStatus: "ready";
};

export type StructuredEventSubjectKind =
  | "session"
  | "turn"
  | "thread"
  | "command"
  | "episode"
  | "workflowRun"
  | "workflowTaskAttempt"
  | "artifact";

export interface StructuredLifecycleEventRecord {
  id: string;
  sessionId: string;
  at: string;
  kind: string;
  subject: {
    kind: StructuredEventSubjectKind;
    id: string;
  };
  data?: Record<string, unknown>;
}

export type StructuredSurfaceQueuedMessageStatus =
  | "queued"
  | "steering"
  | "dispatching"
  | "delivered"
  | "failed"
  | "cancelled";

export type StructuredSurfaceQueueItemKind =
  | "user_message"
  | "initial_handler_start"
  | "thread_followup"
  | "report_request"
  | "thread_report_notification"
  | "request_user_input_answer"
  | "workflow_task_agent_start";

export type StructuredSurfaceQueuePriority = "interactive" | "runtime" | "background";

export type StructuredRecoveryWorkKind =
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

export type StructuredRecoveryWorkStatus =
  | "pending"
  | "claimed"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type StructuredRecoveryWorkOwnerScope =
  | { kind: "workspace" }
  | { kind: "source"; sourceKind: RuntimeSourceFactRecord["sourceKind"]; sourceId: string }
  | { kind: "workspace_session"; workspaceSessionId: string }
  | { kind: "surface"; workspaceSessionId: string; surfacePiSessionId: string }
  | {
      kind: "thread";
      workspaceSessionId: string;
      threadId: string;
      surfacePiSessionId: string;
    }
  | { kind: "workflow_run"; workflowRunId: string; smithersRunId: string }
  | { kind: "queue_item"; queuedItemId: string; surfacePiSessionId: string }
  | { kind: "title_job"; titleJobId: string };

export type StructuredRecoveryWorkScope =
  | { kind: "app" }
  | { kind: "workspace"; workspaceId: string };

export interface StructuredRecoveryWorkRecord {
  id: string;
  scope: StructuredRecoveryWorkScope;
  kind: StructuredRecoveryWorkKind;
  status: StructuredRecoveryWorkStatus;
  ownerScope: StructuredRecoveryWorkOwnerScope;
  idempotencyKey: string;
  orderingKey: string;
  orderingSeq: number;
  priority: number;
  availableAt: string;
  attempts: number;
  maxAttempts: number;
  claimedBy: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  leaseVersion: number;
  payloadJson: JsonValue | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type StructuredGeneratedPackageFactRecord = RuntimeGeneratedPackageFactRecord;
export type StructuredGeneratedWorkflowsExportRecord = GeneratedWorkflowsExportBuildEvidence & {
  readonly buildId: GeneratedPackageBuildId;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};
export interface ReadGeneratedWorkflowsExportsInput {
  readonly buildId?: GeneratedPackageBuildId;
}
export type StructuredGeneratedPackageWorkspaceLinkRecord =
  RuntimeGeneratedPackageWorkspaceLinkRecord;
export type StructuredExtensionDependencyReadinessRecord = ExtensionDependencyReadiness;

export interface StructuredExtensionDependencyReadinessBatchRecord {
  registryAggregateFingerprint: string;
  readiness: readonly StructuredExtensionDependencyReadinessRecord[];
  recordedAt: string;
  sourceCommandId: CommandId | null;
}

export interface StructuredExtensionDependencyReadinessReconcileResult extends ReconcileExtensionDependencyReadinessResult {
  stateRevision: StateRevision;
}
export type StructuredExtensionDependencyApprovalRecord = {
  readonly dependency: ExtensionDependencyApprovalIdentity;
  readonly approvedAt: string;
  readonly approvedBy: "user";
  readonly sourceCommandId: CommandId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface StructuredSurfaceQueuedMessageRecord {
  id: string;
  sessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  workflowTaskAttemptId: string | null;
  kind: StructuredSurfaceQueueItemKind;
  idempotencyKey: string;
  messageJson: string;
  payloadJson: string | null;
  status: StructuredSurfaceQueuedMessageStatus;
  priority: StructuredSurfaceQueuePriority;
  orderingKey: string;
  sequence: number;
  position: number;
  sourceCommandId: string | null;
  claimOwnerId: string | null;
  claimLeaseExpiresAt: string | null;
  leaseVersion: number;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastErrorJson: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  failedAt: string | null;
  failureError: string | null;
  cancelledAt: string | null;
}

export interface StructuredRuntimeHandlerThreadGeneratedContextBindingInput {
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  externalSourceHashes: readonly string[];
}

export interface StructuredRuntimeHandlerThreadInitialQueueInput {
  idempotencyKey: string;
  priority?: StructuredSurfaceQueuePriority;
  orderingKey?: string | null;
  nextAttemptAt?: string | null;
  maxAttempts?: number;
  inheritedHistory?: HandlerInheritedHistoryBlock;
  overrides?: Readonly<Record<ExtensionId, ExtensionUsageState>>;
}

export interface StructuredStartRuntimeHandlerThreadInput {
  parentThreadId?: string | null;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  historyMode: StructuredThreadHistoryMode;
  worktreeId?: string | null;
  agentProfileJson?: string | null;
  generatedAgentContextBinding: StructuredRuntimeHandlerThreadGeneratedContextBindingInput;
  initialQueue: StructuredRuntimeHandlerThreadInitialQueueInput;
}

export interface StructuredStartRuntimeHandlerThreadsInput {
  workspaceSessionId: string;
  orchestratorTurnId: string;
  sourceCommandId: string;
  threadGroupId?: string | null;
  threads: readonly [
    StructuredStartRuntimeHandlerThreadInput,
    ...StructuredStartRuntimeHandlerThreadInput[],
  ];
}

export interface StructuredStartedRuntimeHandlerThread {
  thread: StructuredThreadRecord;
  generatedAgentContextBinding: StructuredGeneratedAgentContextBindingRecord;
  queuedMessage: StructuredSurfaceQueuedMessageRecord;
}

export interface StructuredStartRuntimeHandlerThreadsResult {
  threadGroupId: string;
  threads: StructuredStartedRuntimeHandlerThread[];
  committed: boolean;
}

export interface StructuredSessionSnapshot {
  workspace: StructuredWorkspaceRecord;
  pi: StructuredPiSessionRecord;
  session: {
    id: string;
    orchestratorPiSessionId: string;
    pinnedAt: string | null;
    archivedAt: string | null;
    unreadAt: string | null;
    unreadReason: "assistant-turn-finished" | "manual" | null;
    lastReadAt: string | null;
    wait: StructuredSessionWaitState | null;
  };
  turns: StructuredTurnRecord[];
  threads: StructuredThreadRecord[];
  commands: StructuredCommandRecord[];
  episodes: StructuredEpisodeRecord[];
  workflowRuns: StructuredWorkflowRunRecord[];
  workflowTaskAttempts: StructuredWorkflowTaskAttemptRecord[];
  workflowTaskMessages: StructuredWorkflowTaskMessageRecord[];
  generatedAgentContextBindings: StructuredGeneratedAgentContextBindingRecord[];
  requestUserInputRequests: StructuredRequestUserInputRequestRecord[];
  runtimeApprovalRequests?: StructuredRuntimeApprovalRequestRecord[];
  artifacts: StructuredArtifactRecord[];
  queuedMessages?: StructuredSurfaceQueuedMessageRecord[];
  events: StructuredLifecycleEventRecord[];
}

export interface StructuredWorkspaceSidebarState {
  pinnedGroupCollapsed: boolean;
  pinnedGroupSizePx: number;
  activeGroupCollapsed: boolean;
  activeGroupSizePx: number;
  archivedGroupCollapsed: boolean;
  archivedGroupSizePx: number;
  updatedAt: string;
}

export type StructuredSessionNavigationCommandInput =
  | { kind: "set-pinned"; sessionId: string; pinned: boolean }
  | { kind: "set-archived"; sessionId: string; archived: boolean }
  | { kind: "mark-read"; sessionId: string }
  | { kind: "mark-unread"; sessionId: string }
  | {
      kind: "set-section-state";
      section: "pinned" | "active" | "archived";
      collapsed?: boolean;
      sizePx?: number;
    };

export interface StructuredThreadDetail {
  thread: StructuredThreadRecord;
  childThreads: StructuredThreadRecord[];
  commands: StructuredCommandRecord[];
  episodes: StructuredEpisodeRecord[];
  workflowRuns: StructuredWorkflowRunRecord[];
  latestWorkflowRun: StructuredWorkflowRunRecord | null;
  workflowTaskAttempts: StructuredWorkflowTaskAttemptRecord[];
  workflowTaskMessages: StructuredWorkflowTaskMessageRecord[];
  artifacts: StructuredArtifactRecord[];
}

interface ProviderAuthStatusWriteResult {
  status: ProviderAuthStatus;
  stateRevision: StateRevision;
}

export interface CreateStructuredSessionStateStoreOptions {
  databasePath?: string;
  busyTimeoutMs?: number;
  digest?: StateDigestHelper;
  filesystemSetup?: "store" | "caller";
  idFactory?: (prefix: string) => string;
  now?: () => string;
  workspace: StructuredWorkspaceInput;
  workspaceArtifactDirectoryAuthority?: "seed" | "state-preference";
}

export type StateDigestHelper = {
  readonly sha256Hex: (data: string | Uint8Array) => string;
};

export interface StructuredSessionStateStore {
  readonly workspaceId: string;
  readonly databasePath: string;
  getWorkspaceRecord(): StructuredWorkspaceRecord;
  setWorkspaceArtifactDirectory(artifactDir: string): StructuredWorkspaceRecord;
  getCurrentTimestamp(): string;
  getDigestHelper(): StateDigestHelper;
  readCurrentStateRevision(): StateRevision;
  readRequestInputSettings(): RequestInputSettings;
  setRequestInputVariant(input: SetRequestInputVariantInput): RequestInputSettings;
  setRequestInputBlockingTimeout(input: SetRequestInputBlockingTimeoutInput): RequestInputSettings;
  hasAppPreferencesRow(): boolean;
  readAppPreferences(): StructuredAppPreferencesRecord;
  updateAppPreferences(input: StructuredAppPreferencesPatch): StructuredAppPreferencesRecord;
  hasWorkspaceChromeRows(): boolean;
  readWorkspaceChrome(): StructuredWorkspaceChromeRecord;
  hasWorkspaceLayoutRows(): boolean;
  readWorkspaceLayout(workspaceId: string): StructuredWorkspaceLayoutRecord;
  setWorkspaceTabs(input: SetWorkspaceTabsCommandInput): StructuredWorkspaceChromeMutationRecord;
  selectWorkspaceTab(
    input: SelectWorkspaceTabCommandInput,
  ): StructuredWorkspaceChromeMutationRecord;
  selectWorkspaceLayoutSlot(
    input: SelectWorkspaceLayoutSlotCommandInput,
  ): StructuredWorkspaceChromeMutationRecord;
  saveWorkspaceLayoutSlot(
    input: SaveWorkspaceLayoutSlotCommandInput,
  ): StructuredMutationCommitRecord;
  hasAgentProfileRows(): boolean;
  listAgentProfiles(): StructuredAgentProfileRecord[];
  listAgentActorExtensionDefaults(): StructuredAgentActorExtensionDefaultsRecord[];
  setAgentActorExtensionDefaults(
    input: StructuredAgentActorExtensionDefaultsInput,
  ): StructuredMutationCommitRecord;
  updateOrchestratorProfile(
    input: UpdateOrchestratorProfileCommandInput,
  ): StructuredMutationCommitRecord;
  updateThreadHandlerProfile(
    input: UpdateThreadHandlerProfileCommandInput,
  ): StructuredMutationCommitRecord;
  deleteOrchestratorProfile(
    input: DeleteOrchestratorProfileCommandInput,
  ): StructuredMutationCommitRecord;
  reorderOrchestratorProfiles(
    input: ReorderOrchestratorProfilesCommandInput,
  ): StructuredMutationCommitRecord;
  setProfileExtensionUsage(
    input: SetProfileExtensionUsageCommandInput,
  ): StructuredMutationCommitRecord;
  promoteProfileExtensionDefault(
    input: PromoteProfileExtensionDefaultCommandInput,
  ): StructuredMutationCommitRecord;
  resetActorExtensionDefaults(input: {
    actor: ResetActorExtensionDefaultsCommandInput["actor"];
    reset: ResetActorExtensionDefaultsCommandInput["reset"];
  }): StructuredMutationCommitRecord;
  setExternalInstructionActorUsage(
    input: SetExternalInstructionActorUsageCommandInput,
  ): StructuredMutationCommitRecord;
  readExternalInstructionsProjection(input: {
    workspaceId: string;
  }): ExternalInstructionObservationProjection;
  reconcileExternalInstructions(
    input: ReconcileExternalInstructionsInput,
  ): ReconcileExternalInstructionsResult;
  hasExtensionEnvOverrideRows(): boolean;
  listExtensionEnvOverrides(): StructuredExtensionEnvOverrideRecord[];
  setExtensionEnvOverride(
    input: SetExtensionEnvOverrideCommandInput,
  ): StructuredMutationCommitRecord;
  removeExtensionEnvOverride(
    input: RemoveExtensionEnvOverrideCommandInput,
  ): StructuredMutationCommitRecord;
  readExtensionRegistryObservation(): ExtensionRegistryStateRecord | null;
  reconcileExtensionRegistryObservation(
    input: ReconcileExtensionRegistryObservationInput,
  ): StructuredExtensionRegistryReconcileResult;
  readExtensionSourceBuildEvidence(): StructuredExtensionSourceBuildEvidenceBatchRecord | null;
  reconcileExtensionSourceBuildEvidence(
    input: ReconcileExtensionSourceBuildEvidenceInput,
  ): StructuredExtensionSourceBuildEvidenceReconcileResult;
  readExtensionBuildAttempt(
    attemptId: ExtensionBuildAttemptRecord["attemptId"],
  ): ExtensionBuildAttemptRecord | null;
  readExtensionBuildAttemptByClientRequestId(
    clientRequestId: ExtensionBuildAttemptRecord["clientRequestId"],
  ): ExtensionBuildAttemptRecord | null;
  startExtensionBuildAttempt(
    input: StartExtensionBuildAttemptInput,
  ): StructuredExtensionBuildAttemptMutationResult;
  recordExtensionBuildSuccess(
    input: RecordExtensionBuildSuccessInput,
  ): StructuredExtensionBuildAttemptMutationResult;
  recordExtensionBuildFailure(
    input: RecordExtensionBuildFailureInput,
  ): StructuredExtensionBuildAttemptMutationResult;
  listExtensionSnapshots(): ExtensionSnapshotsReadModel;
  readExtensionSnapshot(snapshotId: ExtensionSnapshotId): ExtensionSnapshotStateRecord | null;
  saveExtensionSnapshot(input: SaveExtensionSnapshotCommand): SaveExtensionSnapshotReceipt;
  renameExtensionSnapshot(input: RenameExtensionSnapshotCommand): RenameExtensionSnapshotReceipt;
  deleteExtensionSnapshot(input: DeleteExtensionSnapshotCommand): DeleteExtensionSnapshotReceipt;
  loadExtensionSnapshot(input: LoadExtensionSnapshotCommand): LoadExtensionSnapshotReceipt;
  readExtensionSnapshotRestoreAttempt(
    attemptId: ExtensionSnapshotRestoreAttemptId,
  ): ExtensionSnapshotRestoreAttempt | null;
  listPendingExtensionSnapshotRestoreAttempts(): ExtensionSnapshotRestoreAttempt[];
  advanceExtensionSnapshotRestoreAttempt(
    input: AdvanceExtensionSnapshotRestoreAttemptCommand,
  ): AdvanceExtensionSnapshotRestoreAttemptReceipt;
  listPendingExtensionSnapshotCleanup(): ExtensionSnapshotCleanupRecord[];
  completeExtensionSnapshotCleanup(
    input: CompleteExtensionSnapshotCleanupCommand,
  ): CompleteExtensionSnapshotCleanupReceipt;
  readExtensionUsageChange(changeId: ExtensionUsageChangeId): ExtensionUsageChangeRecord | null;
  resolveExtensionUsageTarget(agentProfile: string): SetExtensionUsageInput["target"];
  setExtensionUsage(input: SetExtensionUsageInput): ExtensionUsageChangeRecord;
  revertExtensionUsage(input: RevertExtensionUsageInput): ExtensionUsageChangeRecord;
  readExtensionSnapshotSettingsCaptureFacts(): ExtensionSnapshotSettingsCaptureFacts;
  applyExtensionSnapshotSettings(
    input: ApplyExtensionSnapshotSettingsCommand,
  ): ApplyExtensionSnapshotSettingsReceipt;
  reconcileExtensionEnvDeclarations(input: {
    declarations: readonly Omit<StructuredExtensionEnvDeclarationRecord, "updatedAt">[];
  }): StructuredMutationCommitRecord;
  listExtensionEnvDeclarations(): StructuredExtensionEnvDeclarationRecord[];
  listExtensionEnvSecrets(): StructuredExtensionEnvSecretRecord[];
  listExtensionEnvSecretCleanupRecords(): StructuredExtensionEnvSecretCleanupRecord[];
  readExtensionEnvSecretCommandState(input: {
    operation: "set" | "remove";
    clientRequestId?: string;
    extensionId: string;
    envName: string;
  }): {
    declaration: StructuredExtensionEnvDeclarationRecord | null;
    current: StructuredExtensionEnvSecretRecord | null;
    receipt: StructuredExtensionEnvSecretReceiptRecord | null;
  };
  commitExtensionEnvSecretSet(input: {
    command: SetExtensionEnvSecretCommandInput;
    ref: ExtensionEnvSecretRef;
    revisionFingerprint: string;
    previous: StructuredExtensionEnvSecretRecord | null;
  }): StructuredExtensionEnvSecretReceiptRecord;
  commitExtensionEnvSecretRemove(input: {
    command: RemoveExtensionEnvSecretCommandInput;
    previous: StructuredExtensionEnvSecretRecord | null;
  }): StructuredExtensionEnvSecretReceiptRecord;
  completeExtensionEnvSecretCleanup(ref: ExtensionEnvSecretRef): void;
  recordExtensionEnvSecretOrphanCleanup(input: {
    ref: ExtensionEnvSecretRef;
    revisionFingerprint: string;
  }): void;
  hasSnippetRows(workspaceId: string): boolean;
  listSnippets(input: { workspaceId: string }): StructuredSnippetRecord[];
  createManagedSnippet(input: CreateManagedSnippetCommandInput): StructuredSnippetRecord & {
    stateRevision: StateRevision;
  };
  updateManagedSnippet(input: UpdateManagedSnippetCommandInput): StructuredMutationCommitRecord;
  deleteManagedSnippet(input: DeleteManagedSnippetCommandInput): StructuredMutationCommitRecord;
  setSnippetEnabled(input: SetSnippetEnabledCommandInput): StructuredMutationCommitRecord;
  acquireWorkspace(input: AcquireWorkspaceInput): AcquireWorkspaceResult;
  acquireDefaultWorkspace(input: AcquireDefaultWorkspaceInput): AcquireWorkspaceResult;
  releaseWorkspace(input: ReleaseWorkspaceInput): ReleaseWorkspaceResult;
  createOrchestratorSurface(input: CreateOrchestratorSurfaceInput): CreateSurfaceResult;
  readOrchestratorLifecycle(input: {
    workspaceId: WorkspaceId;
    workspaceSessionId: WorkspaceSessionId;
  }): {
    title: string;
    titleGenerationStatus: string;
    targets: RuntimeSurfaceTarget[];
  };
  renameOrchestratorSurface(input: {
    workspaceId: WorkspaceId;
    workspaceSessionId: WorkspaceSessionId;
    title: string;
  }): RenameOrchestratorSurfaceResult;
  forkOrchestratorSurface(input: {
    workspaceId: WorkspaceId;
    sourceWorkspaceSessionId: WorkspaceSessionId;
    targetSurfacePiSessionId: SurfacePiSessionId;
    title?: string;
  }): CreateSurfaceResult;
  deleteOrchestratorSurface(input: {
    workspaceId: WorkspaceId;
    workspaceSessionId: WorkspaceSessionId;
  }): DeleteOrchestratorSurfaceResult;
  openSurface(input: OpenSurfaceInput): OpenSurfaceResult;
  closeSurface(input: CloseSurfaceInput): CloseSurfaceResult;
  getPiSessionReference(input: GetPiSessionReferenceInput): PiSessionReference | undefined;
  savePiSessionReference(input: SavePiSessionReferenceInput): PiSessionReference;
  deletePiSessionReference(input: DeletePiSessionReferenceInput): {
    surfacePiSessionId: SurfacePiSessionId;
  };
  validatePiSessionReference(input: ValidatePiSessionReferenceInput): PiSessionReferenceValidation;
  readRuntimeSourceVersion(input: ReadRuntimeSourceVersionInput): RuntimeSourceFactRecord | null;
  readRuntimeSourceRootFingerprint(input: {
    sourceRoot: AbsolutePath;
  }): RuntimeSourceRootFingerprintFactRecord | null;
  recordRuntimeSourceSave(input: RecordRuntimeSourceSaveInput): RuntimeSourceFactRecord;
  recordRuntimeSourceDelete(input: RecordRuntimeSourceDeleteInput): RuntimeSourceFactRecord;
  recordRuntimeWorkflowAgentSourceSave(
    input: RecordRuntimeWorkflowAgentSourceSaveInput,
  ): RuntimeSourceFactRecord;
  recordRuntimeWorkflowAgentSourceDelete(
    input: RecordRuntimeWorkflowAgentSourceDeleteInput,
  ): RuntimeSourceFactRecord;
  reconcileRuntimeWorkflowAgentSources(
    input: ReconcileRuntimeWorkflowAgentSourcesInput,
  ): RuntimeSourceScanFactRecord;
  listCurrentWorkflowAgentSources(): StructuredWorkflowAgentSourceIndexRecord[];
  recordRuntimeSourceScan(input: RecordRuntimeSourceScanInput): RuntimeSourceScanFactRecord;
  reconcileDiscoveredHostSnippets(
    input: ReconcileDiscoveredHostSnippetsInput,
  ): RuntimeSourceScanFactRecord;
  recordObservedRuntimeSourceDeletion(
    input: RecordObservedRuntimeSourceDeletionInput,
  ): RuntimeSourceScanFactRecord;
  recordRuntimeSourceDiagnostic(
    input: RecordRuntimeSourceDiagnosticInput,
  ): RuntimeSourceScanFactRecord;
  upsertPiSession(pi: StructuredPiSessionRecord): void;
  upsertGeneratedAgentContextBinding(input: {
    surfacePiSessionId: string;
    ownerKind: StructuredGeneratedAgentContextBindingOwner;
    ownerId: string;
    actorKind: StructuredGeneratedAgentContextActor;
    systemPrompt: string;
    svvyxGuidance: string;
    commandsDts: string;
    nativeToolSchemasJson: string;
    generatedAgentContextFingerprint: string;
    generatedAgentContextRevision: number;
    loadedExtensionIds: string[];
    availableExtensionIds: string[];
    externalSourceHashes: string[];
  }): StructuredGeneratedAgentContextBindingRecord;
  bindRuntimeGeneratedContext(
    input: BindRuntimeGeneratedContextInput,
  ): StructuredGeneratedAgentContextBindingRecord;
  getGeneratedAgentContextBinding(input: {
    surfacePiSessionId: string;
    generatedAgentContextFingerprint?: string | null;
  }): StructuredGeneratedAgentContextBindingRecord | null;
  updatePiSessionExtensionState(input: {
    sessionId: string;
    loadedExtensionIds: string[];
    availableExtensionIds: string[];
  }): StructuredPiSessionRecord;
  applySnapshotContextImpact(
    input: ApplyRuntimeExtensionSnapshotContextImpactInput,
  ): readonly RuntimeExtensionContextChangedSurface[];
  isSessionDeleted(sessionId: string): boolean;
  startTurn(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    requestSummary: string;
  }): StructuredTurnRecord;
  setTurnDecision(input: {
    turnId: string;
    decision: Exclude<StructuredTurnDecision, "pending">;
    onlyIfPending?: boolean;
  }): StructuredTurnRecord;
  finishTurn(input: {
    turnId: string;
    status: Exclude<StructuredTurnStatus, "running">;
    assistantMessageId?: string;
    assistantText?: string;
  }): StructuredTurnRecord;
  commitRuntimeTranscriptUserMessage(
    input: CommitRuntimeTranscriptUserMessageInput,
  ): RuntimeTranscriptUserMutation;
  beginRuntimeTranscriptAssistantMessage(
    input: BeginRuntimeTranscriptAssistantMessageInput,
  ): RuntimeTranscriptAssistantMutation;
  appendRuntimeTranscriptAssistantContentDelta(
    input: AppendRuntimeTranscriptAssistantContentDeltaInput,
  ): RuntimeTranscriptAssistantMutation;
  upsertRuntimeTranscriptAssistantToolCall(
    input: UpsertRuntimeTranscriptAssistantToolCallInput,
  ): RuntimeTranscriptAssistantMutation;
  linkRuntimeTranscriptAssistantToolCallCommand(
    input: LinkRuntimeTranscriptAssistantToolCallCommandInput,
  ): RuntimeTranscriptAssistantMutation;
  commitRuntimeTranscriptAssistantMessage(
    input: CommitRuntimeTranscriptAssistantMessageInput,
  ): RuntimeTranscriptAssistantMutation;
  failRuntimeTranscriptAssistantMessage(
    input: FailRuntimeTranscriptAssistantMessageInput,
  ): RuntimeTranscriptAssistantMutation;
  bindRuntimeTranscriptPiHistoryEntry(
    input: BindRuntimeTranscriptPiHistoryEntryInput,
  ): RuntimeTranscriptMessage;
  advanceRuntimeTranscriptStreamCursor(
    input: AdvanceRuntimeTranscriptStreamCursorInput,
  ): RuntimeTranscriptStreamCursor;
  readRuntimeSurfaceTranscript(surfacePiSessionId: string): RuntimeSurfaceTranscriptSnapshot;
  recoverInterruptedTurn(input: {
    turnId: string;
    terminalStatus: "failed" | "cancelled";
    reason: string;
  }): StructuredInterruptedTurnRecoveryResult;
  settlePromptTurn(input: {
    turnId: string;
    queueItemId: string;
    status: "completed" | "failed" | "cancelled";
    assistantMessageId?: string;
    assistantText?: string;
    terminalCommandIds: readonly string[];
    terminalCommandSummary: string;
    terminalCommandError: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
  }): StructuredPromptTurnSettlementResult;
  createThread(input: {
    turnId: string;
    parentThreadId?: string | null;
    threadGroupId?: string | null;
    surfacePiSessionId?: string;
    title: string;
    objective: string;
    historyMode?: StructuredThreadHistoryMode;
    objectiveState?: StructuredThreadObjectiveState;
    loadedExtensionIds?: string[];
    availableExtensionIds?: string[];
    worktree?: string;
    agentProfileJson?: string | null;
    generatedAgentContextFingerprint?: string | null;
  }): StructuredThreadRecord;
  ensureHandlerThreadRunnable(input: {
    workspaceSessionId: string;
    surfacePiSessionId: string;
    threadId: string;
  }): { thread: StructuredThreadRecord; committed: boolean };
  startHandlerThreads(
    input: StructuredStartRuntimeHandlerThreadsInput,
  ): StructuredStartRuntimeHandlerThreadsResult;
  updateThread(input: {
    threadId: string;
    status?: StructuredThreadStatus;
    objectiveState?: StructuredThreadObjectiveState;
    wait?: StructuredWaitState | null;
    title?: string;
    objective?: string;
    loadedExtensionIds?: string[];
    availableExtensionIds?: string[];
    worktree?: string | null;
    agentProfileJson?: string | null;
    generatedAgentContextFingerprint?: string | null;
  }): StructuredThreadRecord;
  setSessionWait(input: {
    sessionId: string;
    owner: StructuredSessionWaitOwner;
    kind: StructuredWaitKind;
    reason: string;
    resumeWhen: string;
    at?: string;
  }): StructuredSessionWaitState;
  clearSessionWait(input: { sessionId: string; at?: string }): void;
  setSessionPinned(input: { sessionId: string; pinned: boolean }): void;
  setSessionArchived(input: { sessionId: string; archived: boolean }): void;
  markSessionUnread(input: {
    sessionId: string;
    reason: "assistant-turn-finished" | "manual";
  }): void;
  markSessionRead(input: { sessionId: string }): void;
  applySessionNavigationCommand(
    input: StructuredSessionNavigationCommandInput,
  ): StructuredMutationCommitRecord;
  getWorkspaceSidebarState(): StructuredWorkspaceSidebarState;
  setSessionNavigationSectionState(input: {
    section: "pinned" | "active" | "archived";
    collapsed?: boolean;
    sizePx?: number;
  }): StructuredWorkspaceSidebarState;
  recordLifecycleEvent(input: {
    sessionId: string;
    kind: string;
    subjectKind: StructuredEventSubjectKind;
    subjectId: string;
    at?: string;
    data?: Record<string, unknown>;
  }): void;
  createCommand(input: {
    turnId?: string | null;
    workflowTaskAttemptId?: string | null;
    surfacePiSessionId?: string;
    threadId?: string | null;
    workflowRunId?: string | null;
    parentCommandId?: string | null;
    toolName: string;
    executor: StructuredCommandExecutor;
    visibility: StructuredCommandVisibility;
    title: string;
    summary: string;
    arguments?: unknown;
    facts?: Record<string, unknown> | null;
    attempts?: number;
    status?: StructuredCommandStatus;
  }): StructuredCommandRecord;
  findCommandByToolCallId(toolCallId: string): StructuredCommandRecord | null;
  findCommandById(commandId: string): StructuredCommandRecord | null;
  createOrReuseStreamingCommand(input: StructuredStreamingCommandInput): StructuredCommandRecord;
  createOrReuseStreamingCommandMutation(
    input: StructuredStreamingCommandInput,
  ): StructuredCommandMutationResult;
  updateCommandArguments(commandId: string, args: unknown): StructuredCommandRecord;
  updateCommandArgumentsMutation(commandId: string, args: unknown): StructuredCommandMutationResult;
  startCommand(commandId: string): StructuredCommandRecord;
  startCommandMutation(commandId: string, at?: string): StructuredCommandMutationResult;
  finishCommand(input: StructuredFinishCommandInput): StructuredCommandRecord;
  finishCommandMutation(input: StructuredFinishCommandInput): StructuredCommandMutationResult;
  createEpisode(input: {
    threadId: string;
    sourceCommandId?: string | null;
    kind?: StructuredEpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): StructuredEpisodeRecord;
  recordHandlerThreadEpisode(input: {
    workspaceSessionId: string;
    threadId: string;
    threadGroupId: string;
    sourceCommandId?: string | null;
    kind?: StructuredEpisodeKind;
    summary: string;
    body?: string | null;
    outcome?: unknown;
    relatedCommandIds?: readonly string[];
    relatedArtifactIds?: readonly string[];
    relatedWorkflowRunIds?: readonly string[];
  }): { episode: StructuredEpisodeRecord; thread: StructuredThreadRecord; concluded: boolean };
  createArtifact(input: {
    sessionId?: string | null;
    threadId?: string | null;
    workflowRunId?: string | null;
    workflowTaskAttemptId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name?: string;
    path?: string;
    content?: string;
    mimeType?: string;
    immutable?: boolean;
  }): StructuredArtifactRecord;
  recordArtifactMetadata(input: {
    workspaceSessionId: string;
    threadId?: string | null;
    workflowRunId?: string | null;
    workflowTaskAttemptId?: string | null;
    sourceCommandId: string;
    kind: StructuredArtifactKind;
    name: string;
    storedPath: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    immutable: boolean;
    materializationStatus: "ready";
  }): ArtifactMetadataRecord;
  markArtifactMetadataDeleted(input: {
    workspaceSessionId?: string | null;
    artifactId: string;
  }): ArtifactMetadataRecord;
  inspectArtifactMetadata(input: {
    workspaceSessionId?: string | null;
    artifactId: string;
  }): ArtifactMetadataRecord;
  listArtifactMetadata(input: {
    workspaceSessionId: string;
    threadId?: string | null;
    limit?: number;
  }): ArtifactMetadataRecord[];
  deleteArtifact(input: {
    sessionId?: string | null;
    artifactId: string;
  }): StructuredArtifactRecord;
  inspectArtifact(input: {
    sessionId?: string | null;
    artifactId: string;
  }): StructuredArtifactRecord;
  listArtifacts(input: {
    sessionId: string;
    threadId?: string | null;
    limit?: number;
  }): StructuredArtifactRecord[];
  upsertWorkflowTaskAttempt(input: {
    workflowRunId: string;
    smithersRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
    surfacePiSessionId?: string | null;
    title?: string;
    summary: string;
    kind: StructuredWorkflowTaskAttemptKind;
    status: StructuredWorkflowTaskAttemptStatus;
    smithersState: string;
    prompt?: string | null;
    responseText?: string | null;
    error?: string | null;
    cached?: boolean;
    jjPointer?: string | null;
    jjCwd?: string | null;
    heartbeatAt?: string | null;
    agentId?: string | null;
    agentModel?: string | null;
    agentEngine?: string | null;
    agentResume?: string | null;
    generatedAgentContextFingerprint?: string | null;
    generatedAgentContextBinding?: {
      systemPrompt: string;
      svvyxGuidance: string;
      commandsDts: string;
      nativeToolSchemasJson: string;
      generatedAgentContextRevision: number;
      loadedExtensionIds: string[];
      availableExtensionIds: string[];
      externalSourceHashes: string[];
    } | null;
    meta?: Record<string, unknown> | null;
    startedAt?: string;
    finishedAt?: string | null;
  }): StructuredWorkflowTaskAttemptRecord;
  replaceWorkflowTaskMessages(input: {
    workflowTaskAttemptId: string;
    messages: Array<{
      id: string;
      role: StructuredWorkflowTaskMessageRole;
      source: StructuredWorkflowTaskMessageSource;
      smithersEventSeq?: number | null;
      text: string;
      createdAt: string;
    }>;
  }): StructuredWorkflowTaskMessageRecord[];
  findWorkflowRunBySmithersRunId(smithersRunId: string): StructuredWorkflowRunRecord | null;
  findWorkflowTaskAttemptBySmithersIdentity(input: {
    smithersRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
  }): StructuredWorkflowTaskAttemptRecord | null;
  acceptWorkflowTaskAgentStart(input: {
    workspaceSessionId: string;
    sourceCommandId: string;
    idempotencyKey: string;
    agent: {
      id: string;
      label: string;
      provider: string;
      model: string;
      reasoning: { effort: string };
      instructions: string;
      overrides?: Record<string, "loaded" | "available" | "unavailable">;
    };
    taskIdentity: {
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
    };
    smithersContext?: unknown;
    promptSource: unknown;
  }): {
    workspaceId: string;
    target: {
      workspaceSessionId: string;
      surface: "workflow-task";
      surfacePiSessionId: string;
      workflowTaskAttemptId: string;
      workflowRunId: string;
      threadId: string;
    };
    queuedMessage: StructuredSurfaceQueuedMessageRecord;
    accepted: "created" | "existing";
  };
  getWorkflowTaskAgentAttemptTerminal(input: {
    workspaceSessionId: string;
    idempotencyKey: string;
  }):
    | {
        status: "in-flight";
        workspaceId: string;
        target: {
          workspaceSessionId: string;
          surface: "workflow-task";
          surfacePiSessionId: string;
          workflowTaskAttemptId: string;
          workflowRunId: string;
          threadId: string;
        };
        queuedMessage: StructuredSurfaceQueuedMessageRecord;
      }
    | {
        status: "completed";
        result: { text: string; usage?: unknown; output?: unknown };
      }
    | {
        status: "failed";
        error: string;
      }
    | {
        status: "conflict";
        error: string;
      }
    | null;
  settleWorkflowTaskAgentAttempt(input: {
    workflowTaskAttemptId: string;
    idempotencyKey: string;
    status: "completed" | "failed" | "cancelled";
    result?: { text: string; usage?: unknown; output?: unknown };
    error?: string;
  }):
    | {
        status: "completed";
        result: { text: string; usage?: unknown; output?: unknown };
      }
    | {
        status: "failed";
        error: string;
      }
    | {
        status: "conflict";
        error: string;
      };
  recordWorkflow(input: {
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    workflowSource: "saved" | "artifact";
    entryPath?: string | null;
    savedEntryId?: string | null;
    status: StructuredWorkflowStatus;
    smithersStatus?: string;
    waitKind?: StructuredWorkflowWaitKind | null;
    continuedFromRunIds?: string[];
    activeDescendantRunId?: string | null;
    lastEventSeq?: number | null;
    heartbeatAt?: string | null;
    summary: string;
  }): StructuredWorkflowRunRecord;
  updateWorkflow(input: {
    workflowId: string;
    commandId?: string;
    status?: StructuredWorkflowStatus;
    smithersStatus?: string;
    waitKind?: StructuredWorkflowWaitKind | null;
    continuedFromRunIds?: string[];
    activeDescendantRunId?: string | null;
    lastEventSeq?: number | null;
    heartbeatAt?: string | null;
    summary?: string;
  }): StructuredWorkflowRunRecord;
  enqueueSurfaceMessage(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    workflowTaskAttemptId?: string | null;
    kind?: StructuredSurfaceQueueItemKind;
    idempotencyKey?: string | null;
    priority?: StructuredSurfaceQueuePriority;
    orderingKey?: string | null;
    sourceCommandId?: string | null;
    maxAttempts?: number;
    nextAttemptAt?: string | null;
    messageJson: string;
    payloadJson?: string | null;
    position?: "front" | "back";
  }): StructuredSurfaceQueuedMessageRecord;
  acceptSubmittedSurfaceMessage(input: {
    target: {
      workspaceSessionId: string;
      surfacePiSessionId: string;
      surface: "orchestrator" | "handler";
      threadId?: string;
    };
    idempotencyKey?: string | null;
    promptHistoryText: string | null;
    sourceCommandId?: string | null;
    maxAttempts?: number;
    nextAttemptAt?: string | null;
    messageJson: string;
    payloadJson?: string | null;
    position?: "front" | "back";
  }): {
    queuedMessage: StructuredSurfaceQueuedMessageRecord;
    accepted: "created" | "existing";
    draftCleared: boolean;
    promptHistoryRecorded: boolean;
  };
  acceptEditedCommittedSurfaceMessage(
    input: AcceptEditedCommittedRuntimeSurfaceMessageInput,
  ): AcceptEditedCommittedRuntimeSurfaceMessageResult;
  createRequestUserInputRequest(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    turnId: string;
    commandId: string;
    toolItemId: string;
    variant: StructuredRequestUserInputVariant;
    timeout?: null | {
      enabled: boolean;
      durationMs: number;
    };
    questions: Array<{
      title: string;
      question: string;
      defaultAnswer: StructuredRequestUserInputAnswer;
      choices?: Array<{
        label: string;
        description: string;
        recommended: boolean;
      }>;
    }>;
  }): StructuredRequestUserInputRequestRecord;
  createRuntimeApprovalRequest(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    turnId?: string | null;
    commandId?: string | null;
    toolCallId: string;
    toolName: StructuredRuntimeApprovalToolName;
    approvalMode: StructuredRuntimeApprovalMode;
    cwd: string;
    command?: string | null;
    commandFamily?: string | null;
    patch?: string | null;
    snippetArtifactId?: string | null;
    typescriptCode?: string | null;
    context?: StructuredRuntimeApprovalRequestRecord["context"];
  }): StructuredRuntimeApprovalRequestRecord;
  resolveRuntimeApprovalRequest(input: {
    requestId: string;
    status: Extract<StructuredRuntimeApprovalStatus, "approved" | "denied" | "cancelled">;
    reviewer: "auto-review" | "user";
    decisionReason?: string | null;
    terminalCommandStatus?: "failed" | "cancelled";
  }): StructuredRuntimeApprovalResolutionResult;
  getRuntimeApprovalRequest(requestId: string): StructuredRuntimeApprovalRequestRecord;
  listOpenRuntimeApprovalRequests(): StructuredRuntimeApprovalRequestRecord[];
  answerRequestUserInput(input: {
    surfacePiSessionId: string;
    requestId: string;
    questionId: string;
    answer: { kind: "option"; optionId: string } | { kind: "custom"; text: string };
    delivery: StructuredRequestUserInputDelivery;
    clientSubmission?: RuntimeClientSubmissionInput;
  }): {
    request: StructuredRequestUserInputRequestRecord;
    answer: StructuredRequestUserInputAnswerRecord;
    queuedMessage: StructuredSurfaceQueuedMessageRecord | null;
    duplicate: boolean;
  };
  defaultOpenRequestUserInputQuestions(input: {
    requestId: string;
    answeredBy: "timeout_default";
    expectedTimerVersion: number;
    expectedExpiresAt: string;
  }): StructuredRequestUserInputMutationResult;
  cancelRequestUserInputRequest(input: {
    requestId: string;
    terminalCommandStatus?: "failed" | "cancelled";
    reason?: string;
  }): StructuredRequestUserInputMutationResult;
  setRequestUserInputTimerPaused(input: {
    surfacePiSessionId: string;
    requestId: string;
    paused: boolean;
  }): StructuredRequestUserInputMutationResult;
  getRequestUserInputRequest(requestId: string): StructuredRequestUserInputRequestRecord;
  listQueuedSurfaceMessages(input: {
    surfacePiSessionId: string;
  }): StructuredSurfaceQueuedMessageRecord[];
  getSurfaceQueuedMessage(input: { id: string }): StructuredSurfaceQueuedMessageRecord;
  claimNextQueuedSurfaceMessage(input: {
    surfacePiSessionId: string;
    claimOwnerId?: string | null;
    leaseDurationMs?: number;
  }): StructuredSurfaceQueuedMessageRecord | null;
  releaseExpiredSurfaceMessageClaims(input?: {
    surfacePiSessionId?: string | null;
    now?: string | null;
  }): StructuredSurfaceQueuedMessageRecord[];
  markSurfaceMessageSteering(input: { id: string }): StructuredSurfaceQueuedMessageRecord;
  markSurfaceMessageQueued(input: {
    id: string;
    position?: "front" | "back";
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
    expectedStatuses?: readonly StructuredSurfaceQueuedMessageStatus[];
  }): StructuredSurfaceQueuedMessageRecord;
  markSurfaceMessageDelivered(input: {
    id: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
  }): StructuredSurfaceQueuedMessageRecord;
  markSurfaceMessageFailed(input: {
    id: string;
    failureError: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
  }): StructuredSurfaceQueuedMessageRecord;
  cancelSurfaceMessage(input: {
    id: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
    expectedStatuses?: readonly StructuredSurfaceQueuedMessageStatus[];
  }): StructuredSurfaceQueuedMessageRecord;
  reorderSurfaceMessage(input: {
    surfacePiSessionId: string;
    id: string;
    beforeId?: string | null;
  }): StructuredSurfaceQueuedMessageRecord[];
  ensureRecoveryWork(input: {
    scope: StructuredRecoveryWorkScope;
    kind: StructuredRecoveryWorkKind;
    ownerScope: StructuredRecoveryWorkOwnerScope;
    idempotencyKey: string;
    orderingKey: string;
    orderingSeq: number;
    priority: number;
    availableAt: string;
    maxAttempts: number;
    payloadJson?: JsonValue;
  }): StructuredRecoveryWorkRecord;
  recordGeneratedPackageBuild(
    input: RecordGeneratedPackageBuildInput,
  ): StructuredGeneratedPackageFactRecord;
  recordGeneratedPackageFailure(
    input: RecordGeneratedPackageFailureInput,
  ): StructuredGeneratedPackageFactRecord;
  recordWorkspaceLinkStatus(
    input: RecordGeneratedPackageWorkspaceLinkInput,
  ): StructuredGeneratedPackageWorkspaceLinkRecord;
  markWorkspaceLinksRepairNeeded(
    input: MarkWorkspaceGeneratedPackageLinksRepairNeededInput,
  ): MarkWorkspaceGeneratedPackageLinksRepairNeededResult;
  readLinksNeedingRepair(
    input?: ReadGeneratedPackageLinksNeedingRepairInput,
  ): StructuredGeneratedPackageWorkspaceLinkRecord[];
  readGeneratedPackageFacts(
    input?: ReadGeneratedPackageFactsInput,
  ): StructuredGeneratedPackageFactRecord[];
  readGeneratedWorkflowsExports(
    input?: ReadGeneratedWorkflowsExportsInput,
  ): StructuredGeneratedWorkflowsExportRecord[];
  reconcileGeneratedPackageManifest(
    input: ReconcileGeneratedPackageManifestInput,
  ): StructuredGeneratedPackageFactRecord;
  markGeneratedPackageRefreshNeeded(
    input: MarkGeneratedPackageRefreshNeededInput,
  ): StructuredGeneratedPackageFactRecord;
  readExtensionDependencyReadiness(input: {
    extensionId: ExtensionId;
    requirementId: string;
  }): StructuredExtensionDependencyReadinessRecord | null;
  listExtensionDependencyReadiness(): StructuredExtensionDependencyReadinessRecord[];
  readExtensionDependencyReadinessBatch(): StructuredExtensionDependencyReadinessBatchRecord | null;
  readExtensionDependencyApproval(input: {
    dependency: ExtensionDependencyApprovalIdentity;
  }): boolean;
  recordExtensionDependencyApproval(input: {
    dependency: ExtensionDependencyApprovalIdentity;
    approvedAt: string;
    approvedBy: "user";
    sourceCommandId?: CommandId | null;
  }): StructuredExtensionDependencyApprovalRecord;
  recordExtensionDependencyReadiness(
    input: RecordExtensionDependencyReadinessInput,
  ): StructuredExtensionDependencyReadinessRecord;
  reconcileExtensionDependencyReadiness(
    input: ReconcileExtensionDependencyReadinessInput,
  ): StructuredExtensionDependencyReadinessReconcileResult;
  listProviderAuthStatuses(input: ListProviderStatusesInput): ProviderAuthStatus[];
  recordProviderAuthStatus(input: RecordProviderAuthStatusInput): ProviderAuthStatusWriteResult;
  listRecoveryWork(input?: { scope?: StructuredRecoveryWorkScope }): StructuredRecoveryWorkRecord[];
  normalizeWorkspaceRecoveryState(input: { claimedBy: string }): string[];
  claimNextRecoveryWork(input: {
    claimedBy: string;
    scope?: StructuredRecoveryWorkScope;
    kinds?: readonly StructuredRecoveryWorkKind[];
    leaseMs?: number;
  }): StructuredRecoveryWorkRecord | null;
  completeRecoveryWork(input: {
    id: string;
    claimedBy?: string | null;
    leaseVersion?: number | null;
  }): StructuredRecoveryWorkRecord;
  blockRecoveryWork(input: { id: string; error?: string | null }): StructuredRecoveryWorkRecord;
  failOrRetryRecoveryWork(input: {
    id: string;
    error: string;
    claimedBy?: string | null;
    leaseVersion?: number | null;
    retryAvailableAt?: string;
  }): StructuredRecoveryWorkRecord;
  getSessionState(sessionId: string): StructuredSessionSnapshot;
  listSessionStates(): StructuredSessionSnapshot[];
  deleteSessionState(sessionId: string): void;
  getThreadDetail(threadId: string): StructuredThreadDetail;
  close(): void;
  queueTitleGeneration(sessionId: string): StructuredPiSessionRecord | null;
  markTitleGenerationRunning(sessionId: string): StructuredPiSessionRecord;
  completeTitleGeneration(input: { sessionId: string; title: string }): StructuredPiSessionRecord;
  failTitleGeneration(input: { sessionId: string; error: string }): StructuredPiSessionRecord;
  markManualTitleOverride(input: { sessionId: string; title: string }): StructuredPiSessionRecord;
  setSessionExtensionContextAutoUpdate(input: {
    sessionId: string;
    enabled: boolean;
  }): StructuredPiSessionRecord;
  setThreadExtensionContextAutoUpdate(input: {
    threadId: string;
    enabled: boolean;
  }): StructuredThreadRecord;
  getComposerDraft(surfacePiSessionId: string): StructuredComposerDraftRecord | null;
  listPromptHistory(input: { workspaceId: string }): StructuredPromptHistoryRecord[];
  setComposerDraft(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    text: string;
    attachments?: ComposerAttachment[];
    snippetMentions?: ComposerSnippetMention[];
  }): StructuredComposerDraftRecord | null;
}

type StructuredSessionStateStoreMethodKeys = {
  [K in keyof StructuredSessionStateStore]: StructuredSessionStateStore[K] extends (
    ...args: never[]
  ) => unknown
    ? K
    : never;
}[keyof StructuredSessionStateStore];

type StructuredSessionStateStoreServiceMethods = {
  readonly [K in Exclude<
    StructuredSessionStateStoreMethodKeys,
    "close"
  >]: StructuredSessionStateStore[K] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Effect.Effect<Result, StateContractError>
    : never;
};

export type StructuredSessionStateService = {
  readonly workspaceId: string;
  readonly databasePath: string;
} & StructuredSessionStateStoreServiceMethods;

export class StructuredSessionState extends Context.Service<
  StructuredSessionState,
  StructuredSessionStateService
>()("@svvy/state/StructuredSessionState") {}

export function structuredSessionStateFromStore(
  store: StructuredSessionStateStore,
): StructuredSessionState["Service"] {
  const base = {
    workspaceId: store.workspaceId,
    databasePath: store.databasePath,
  };

  const service = new Proxy(base, {
    get(target, property, receiver) {
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }
      if (property === "close") {
        return undefined;
      }
      const value = (store as unknown as Record<PropertyKey, unknown>)[property];
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) =>
        tryStructuredSessionStateOperation(`structured-session.${String(property)}`, () =>
          value.apply(store, args),
        );
    },
  });

  return StructuredSessionState.of(service as StructuredSessionState["Service"]);
}

export const makeStructuredSessionState = Effect.fn("@svvy/state/makeStructuredSessionState")(
  function* (options: CreateStructuredSessionStateStoreOptions) {
    const store = yield* Effect.acquireRelease(
      tryStructuredSessionStateOperation("structured-session.open", () =>
        createStructuredSessionStateStore(options),
      ),
      (acquiredStore) =>
        tryStructuredSessionStateOperation("structured-session.close", () =>
          acquiredStore.close(),
        ).pipe(Effect.ignore),
    );
    return structuredSessionStateFromStore(store);
  },
);

export const layerStructuredSessionState = (options: CreateStructuredSessionStateStoreOptions) =>
  Layer.effect(StructuredSessionState, makeStructuredSessionState(options));

type SessionRow = {
  session_id: string;
  parent_session_id: string | null;
  title: string;
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
  orchestrator_agent_profile_id: AgentProfileId | null;
  orchestrator_agent_profile_json: string | null;
  generated_agent_context_fingerprint: string | null;
  update_extension_context_before_next_turn: number | null;
  loaded_extension_ids_json: string | null;
  available_extension_ids_json: string | null;
  title_namer_agent_json: string | null;
  title_generation_status: StructuredTitleGenerationStatus | null;
  title_generation_triggered_at: string | null;
  title_generation_finished_at: string | null;
  title_generation_error: string | null;
  title_auto_frozen: number | null;
  title_manual_override: number | null;
  message_count: number;
  pi_status: StructuredSessionStatus;
  created_at: string;
  updated_at: string;
  orchestrator_pi_session_id: string;
  pinned_at: string | null;
  archived_at: string | null;
  unread_at: string | null;
  unread_reason: "assistant-turn-finished" | "manual" | null;
  last_read_at: string | null;
  wait_owner_kind: "orchestrator" | "thread" | null;
  wait_thread_id: string | null;
  wait_kind: StructuredWaitKind | null;
  wait_reason: string | null;
  wait_resume_when: string | null;
  wait_since: string | null;
};

type WorkspaceRuntimeOwnerRow = {
  workspace_id: string;
  owner_id: string;
  owner_kind: string;
  open_reason: string;
  acquired_at: string;
  updated_at: string;
};

type ExternalInstructionProjectionRow = {
  id: number;
  workspace_id: string;
  sources_json: string;
  diagnostics_json: string;
  observed_at: string;
  state_revision: number;
};

type SurfaceLifecycleRow = {
  surface_pi_session_id: string;
  session_id: string;
  surface_kind: "orchestrator" | "handler" | "workflow-task";
  thread_id: string | null;
  workflow_task_attempt_id: string | null;
  status: "open" | "idle" | "disposed";
  open_count: number;
  opened_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  created_at: string;
  updated_at: string;
};

type PiSessionReferenceRow = {
  surface_pi_session_id: string;
  workspace_id: string;
  workspace_session_id: string;
  surface_kind: "orchestrator" | "handler" | "workflow-task";
  actor_kind: ActorKind;
  thread_id: string | null;
  workflow_task_attempt_id: string | null;
  adapter_kind: string;
  adapter_version: string;
  storage_locator: string;
  pi_session_id: string | null;
  reference_fingerprint: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  last_validated_at: string | null;
  deleted_at: string | null;
};

type RuntimeSourceFactRow = {
  scope_kind: RuntimeSourceFactRecord["scope"]["kind"];
  scope_workspace_id: string | null;
  scope_key: string;
  source_kind: RuntimeSourceFactRecord["sourceKind"];
  source_id: string;
  path: string;
  source_version: string;
  fingerprint: string;
  diagnostics_json: string;
  source_command_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RuntimeSourceScanFactRow = {
  scope_kind: RuntimeSourceScanFactRecord["scope"]["kind"];
  scope_workspace_id: string | null;
  scope_key: string;
  domain: RuntimeSourceScanFactRecord["domain"];
  source_fingerprint: string;
  diagnostics_json: string;
  last_observed_path: string | null;
  last_observation_kind: RuntimeSourceScanFactRecord["lastObservationKind"];
  observed_at: string;
  created_at: string;
  updated_at: string;
};

type RuntimeSourceRootFingerprintFactRow = {
  scope_kind: RuntimeSourceRootFingerprintFactRecord["scope"]["kind"];
  scope_workspace_id: string | null;
  scope_key: string;
  domain: RuntimeSourceRootFingerprintFactRecord["domain"];
  source_root: string;
  root_fingerprint: string;
  diagnostics_json: string;
  observed_at: string;
  created_at: string;
  updated_at: string;
};

type WorkflowAgentSourceIndexRow = {
  source_id: string;
  path: string;
  source_version: string;
  fingerprint: string;
  validation_status: WorkflowAgentSourceObservation["validationStatus"] | null;
  diagnostics_json: string;
  parameters_json: string | null;
  extension_order_json: string;
  observed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export interface StructuredWorkflowAgentSourceIndexRecord {
  sourceId: string;
  path: AbsolutePath;
  sourceVersion: string;
  fingerprint: string;
  validationStatus: WorkflowAgentSourceObservation["validationStatus"];
  diagnostics: WorkflowAgentSourceObservation["diagnostics"];
  parameters: WorkflowAgentSourceObservation["parameters"];
  extensionOrder: WorkflowAgentSourceObservation["extensionOrder"];
  extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
  observedAt: WorkflowAgentSourceObservation["observedAt"];
  createdAt: string;
  updatedAt: string;
}

type ExtensionDependencyApprovalRow = {
  approval_key: string;
  identity_json: string;
  approved_at: string;
  approved_by: "user";
  source_command_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderAuthStatusRow = {
  provider_id: string;
  workspace_key: string;
  workspace_id: string | null;
  health: ProviderAuthStatus["health"];
  redacted_account_label: string | null;
  refreshed_at: string | null;
  expires_at: string | null;
  issue: string | null;
  observed_at: string;
  source: RecordProviderAuthStatusInput["source"];
  created_at: string;
  updated_at: string;
};

type WorkspaceSidebarStateRow = {
  id: number;
  pinned_group_collapsed: number;
  pinned_group_size_px: number;
  active_group_collapsed: number;
  active_group_size_px: number;
  archived_group_collapsed: number;
  archived_group_size_px: number;
  updated_at: string;
};

type WorkspaceChromeStateRow = {
  id: number;
  active_workspace_tab_id: string | null;
  updated_at: string;
};

type WorkspaceChromeTabRow = {
  workspace_tab_id: string;
  workspace_id: string;
  cwd: string;
  workspace_label: string;
  workspace_kind: "default" | "user";
  opened_at: string;
  active_layout_id: WorkspaceLayoutSlotId;
  tab_kind: "open" | "known";
  position: number;
  updated_at: string;
};

type WorkspaceLayoutSlotRow = {
  workspace_id: string;
  layout_id: WorkspaceLayoutSlotId;
  initialized: number;
  dockview_json: string | null;
  panes_json: string;
  compact_surfaces_json: string;
  focused_pane_id: string | null;
  updated_at: string;
};

type AgentProfileRow = {
  profile_id: string;
  actor: "orchestrator" | "handler";
  name: string;
  provider_id: string;
  model_id: string;
  reasoning_json: string | null;
  follow_composer: number;
  extension_usage_json: string;
  extension_order_json: string;
  position: number;
  updated_at: string;
};

type AgentActorExtensionDefaultsRow = {
  actor: "orchestrator" | "workflow-task";
  extension_usage_json: string;
  extension_order_json: string;
  updated_at: string;
};

type ExtensionEnvOverrideRow = {
  extension_id: string;
  env_name: string;
  value: string;
  updated_at: string;
};

type ExtensionEnvDeclarationRow = {
  extension_id: string;
  env_name: string;
  required: number;
  secret: number;
  description: string | null;
  updated_at: string;
};

type ExtensionRegistryObservationRow = {
  observation_json: string;
  observed_at: string;
};

type ExtensionSourceBuildEvidenceRow = {
  extension_id: string;
  registry_aggregate_fingerprint: string;
  observation_json: string;
  observed_at: string;
};

type ExtensionSourceBuildEvidenceBatchRow = {
  registry_aggregate_fingerprint: string;
  observed_at: string;
};

type ExtensionEnvSecretRow = {
  extension_id: string;
  env_name: string;
  material_id: string;
  revision_fingerprint: string;
  status: "configured" | "missing";
  updated_at: string;
};

type ExtensionEnvSecretReceiptRow = {
  operation: "set" | "remove";
  client_request_id: string;
  extension_id: string;
  env_name: string;
  configured: number;
  committed_at: string;
  state_revision: number;
};

type ExtensionEnvSecretCleanupRow = {
  extension_id: string;
  env_name: string;
  material_id: string;
  revision_fingerprint: string;
  reason: "replaced" | "removed" | "orphaned";
  created_at: string;
};

type SnippetRow = {
  snippet_id: string;
  workspace_id: string;
  source: string;
  title: string;
  body: string;
  metadata_json: string;
  enabled: number;
  path: string | null;
  discovery_scope: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
};

type ComposerDraftRow = {
  session_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  text: string;
  attachments_json: string | null;
  snippet_mentions_json: string | null;
  updated_at: string;
};

type PromptHistoryRow = {
  workspace_id: string;
  workspace_session_id: string;
  surface_pi_session_id: string;
  queue_item_id: string;
  text: string;
  sent_at: string;
};

type GeneratedAgentContextBindingRow = {
  id: string;
  surface_pi_session_id: string;
  owner_kind: StructuredGeneratedAgentContextBindingOwner;
  owner_id: string;
  actor_kind: StructuredGeneratedAgentContextActor;
  system_prompt: string;
  svvyx_guidance: string;
  commands_dts: string;
  native_tool_schemas_json: string;
  generated_agent_context_fingerprint: string;
  generated_agent_context_revision: number;
  loaded_extension_ids_json: string;
  available_extension_ids_json: string;
  external_source_hashes_json: string;
  created_at: string;
  updated_at: string;
};

type GeneratedPackageFactRow = {
  package_name: GeneratedPackageName;
  status: RuntimeGeneratedPackageFactRecord["status"];
  build_id: string | null;
  manifest_path: string | null;
  source_fingerprint: string | null;
  output_fingerprint: string | null;
  generated_file_list_digest: string | null;
  dependencies_json: string;
  diagnostics_json: string;
  source_command_id: string | null;
  refresh_needed_reason: string | null;
  last_recovery_work_id: string | null;
  created_at: string;
  updated_at: string;
};

type GeneratedWorkflowsExportRow = {
  package_name: "@svvyx/workflows";
  build_id: string;
  position: number;
  kind: GeneratedWorkflowsExportBuildEvidence["kind"];
  namespace: GeneratedWorkflowsExportBuildEvidence["namespace"];
  export_name: string;
  qualified_name: string;
  source_path: string;
  generated_path: string;
  generated_code: string;
  agent_parameters_json: string | null;
  workflow_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

type GeneratedPackageWorkspaceLinkRow = {
  workspace_id: string;
  package_name: GeneratedPackageName;
  status: RuntimeGeneratedPackageWorkspaceLinkRecord["status"];
  link_path: string | null;
  target_path: string | null;
  diagnostics_json: string;
  source_command_id: string | null;
  last_recovery_work_id: string | null;
  created_at: string;
  updated_at: string;
};

type ExtensionDependencyReadinessRow = {
  extension_id: ExtensionId;
  requirement_id: string;
  requirement_fingerprint: string;
  status: ExtensionDependencyReadiness["status"];
  detected_version: string | null;
  expected_version: string | null;
  diagnostics_json: string;
  checked_at: string | null;
  source_command_id: string | null;
  created_at: string;
  updated_at: string;
};

type ExtensionDependencyReadinessBatchRow = {
  registry_aggregate_fingerprint: string;
  readiness_json: string;
  recorded_at: string;
  source_command_id: string | null;
};

type ExtensionBuildAttemptRow = {
  attempt_id: string;
  client_request_id: string;
  extension_id: ExtensionId;
  registry_aggregate_fingerprint: string;
  source_fingerprint: string;
  status: ExtensionBuildAttemptRecord["status"];
  failure_reason: ExtensionBuildAttemptRecord["failureReason"];
  successful_build_id: string | null;
  started_at: string;
  finished_at: string | null;
};

type TurnRow = {
  id: string;
  session_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  request_summary: string;
  turn_decision: StructuredTurnDecision;
  status: StructuredTurnStatus;
  assistant_message_id: string | null;
  assistant_text: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type TranscriptMessageRow = {
  message_id: string;
  session_id: string;
  surface_pi_session_id: string;
  turn_id: string;
  queue_item_id: string | null;
  ordinal: number;
  role: "user" | "assistant";
  status: RuntimeTranscriptAssistantMessage["status"] | null;
  user_message_json: string | null;
  api: string | null;
  provider_id: string | null;
  model_id: string | null;
  response_id: string | null;
  usage_json: string | null;
  stop_reason: RuntimeTranscriptAssistantMessage["stopReason"];
  error_message: string | null;
  pi_history_entry_id: string | null;
  pi_history_entry_json: string | null;
  submitted_at: string | null;
  committed_at: string | null;
  started_at: string | null;
  message_timestamp: string | null;
  updated_at: string;
  finished_at: string | null;
};

type TranscriptContentBlockRow = {
  message_id: string;
  content_index: number;
  kind: "text" | "thinking" | "tool-call";
  text_content: string | null;
  thinking_content: string | null;
  thinking_redacted: number | null;
  thinking_signature: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  arguments_json: string | null;
  arguments_status: "streaming" | "accepted" | null;
  command_id: string | null;
  thought_signature: string | null;
  created_at: string;
  updated_at: string;
};

type TranscriptStreamCursorRow = {
  surface_pi_session_id: string;
  stream_generation_id: string;
  stream_sequence: number;
  active_assistant_message_id: string | null;
  updated_at: string;
};

type FinalizeRuntimeTranscriptAssistantInput = Omit<
  CommitRuntimeTranscriptAssistantMessageInput,
  "content"
> & {
  readonly status: "completed" | "failed" | "cancelled";
  readonly content: RuntimeTranscriptAssistantContent | null;
};

type ThreadRow = {
  id: string;
  session_id: string;
  turn_id: string;
  parent_thread_id: string | null;
  thread_group_id: string;
  surface_pi_session_id: string;
  title: string;
  objective: string;
  history_mode: StructuredThreadHistoryMode;
  objective_state: StructuredThreadObjectiveState;
  loaded_extension_ids_json: string | null;
  available_extension_ids_json: string | null;
  status: StructuredThreadStatus;
  wait_owner: StructuredThreadWaitOwner | null;
  wait_kind: StructuredWaitKind | null;
  wait_reason: string | null;
  wait_resume_when: string | null;
  wait_since: string | null;
  worktree: string | null;
  agent_profile_json: string | null;
  generated_agent_context_fingerprint: string | null;
  update_extension_context_before_next_turn: number | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type CommandRow = {
  id: string;
  session_id: string;
  turn_id: string | null;
  workflow_task_attempt_id: string | null;
  surface_pi_session_id: string;
  thread_id: string | null;
  workflow_run_id: string | null;
  parent_command_id: string | null;
  tool_name: string;
  executor: StructuredCommandExecutor;
  visibility: StructuredCommandVisibility;
  status: StructuredCommandStatus;
  attempts: number;
  title: string;
  summary: string;
  arguments_json: string | null;
  facts_json: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type EpisodeRow = {
  id: string;
  session_id: string;
  thread_id: string | null;
  source_command_id: string | null;
  kind: StructuredEpisodeKind;
  title: string;
  summary: string;
  body: string;
  created_at: string;
};

type WorkflowRunRow = {
  id: string;
  session_id: string;
  thread_id: string;
  command_id: string;
  smithers_run_id: string;
  workflow_name: string;
  workflow_source: "saved" | "artifact";
  entry_path: string | null;
  saved_entry_id: string | null;
  status: StructuredWorkflowStatus;
  smithers_status: string;
  wait_kind: StructuredWorkflowWaitKind | null;
  continued_from_run_ids_json: string | null;
  active_descendant_run_id: string | null;
  last_event_seq: number | null;
  heartbeat_at: string | null;
  summary: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type WorkflowTaskAttemptRow = {
  id: string;
  session_id: string;
  thread_id: string;
  workflow_run_id: string;
  smithers_run_id: string;
  node_id: string;
  iteration: number;
  attempt: number;
  surface_pi_session_id: string | null;
  title: string;
  summary: string;
  kind: StructuredWorkflowTaskAttemptKind;
  status: StructuredWorkflowTaskAttemptStatus;
  smithers_state: string;
  prompt: string | null;
  response_text: string | null;
  error: string | null;
  cached: number | null;
  jj_pointer: string | null;
  jj_cwd: string | null;
  heartbeat_at: string | null;
  agent_id: string | null;
  agent_model: string | null;
  agent_engine: string | null;
  agent_resume: string | null;
  generated_agent_context_fingerprint: string | null;
  meta_json: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type WorkflowTaskMessageRow = {
  id: string;
  session_id: string;
  workflow_task_attempt_id: string;
  role: StructuredWorkflowTaskMessageRole;
  source: StructuredWorkflowTaskMessageSource;
  smithers_event_seq: number | null;
  text: string;
  created_at: string;
};

type RequestUserInputRequestRow = {
  id: string;
  session_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  turn_id: string;
  command_id: string;
  tool_item_id: string;
  variant: StructuredRequestUserInputVariant;
  status: StructuredRequestUserInputStatus;
  timeout_json: string | null;
  created_at: string;
  completed_at: string | null;
};

type RequestUserInputQuestionRow = {
  id: string;
  request_id: string;
  ordinal: number;
  title: string;
  question: string;
  default_answer_json: string;
  choices_json: string;
  status: StructuredRequestUserInputQuestionStatus;
};

type RequestUserInputAnswerRow = {
  id: string;
  request_id: string;
  question_id: string;
  answer_json: string;
  answered_by: StructuredRequestUserInputAnsweredBy;
  delivery: StructuredRequestUserInputDelivery | null;
  queued_item_id: string | null;
  idempotency_key: string | null;
  created_at: string;
};

type RuntimeApprovalRequestRow = {
  id: string;
  session_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  turn_id: string | null;
  command_id: string | null;
  tool_call_id: string;
  tool_name: StructuredRuntimeApprovalToolName;
  approval_mode: StructuredRuntimeApprovalMode;
  cwd: string;
  command_text: string | null;
  command_family: string | null;
  patch_text: string | null;
  snippet_artifact_id: string | null;
  typescript_code: string | null;
  context_json: string | null;
  status: StructuredRuntimeApprovalStatus;
  decision_reason: string | null;
  reviewer: "auto-review" | "user" | null;
  created_at: string;
  completed_at: string | null;
};

type RecoveryWorkRow = {
  id: string;
  scope_kind: "app" | "workspace";
  workspace_id: string | null;
  kind: StructuredRecoveryWorkKind;
  status: StructuredRecoveryWorkStatus;
  owner_scope_json: string;
  idempotency_key: string;
  ordering_key: string;
  ordering_seq: number;
  priority: number;
  available_at: string;
  attempts: number;
  max_attempts: number;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  lease_version: number;
  payload_json: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ArtifactRow = {
  id: string;
  session_id: string;
  thread_id: string | null;
  workflow_run_id: string | null;
  workflow_task_attempt_id: string | null;
  source_command_id: string | null;
  kind: StructuredArtifactKind;
  name: string;
  path: string | null;
  mime_type: string;
  bytes: number;
  sha256: string;
  immutable: number;
  materialization_status: ArtifactMaterializationStatus | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  last_recovery_work_id: string | null;
};

type SurfaceQueuedMessageRow = {
  id: string;
  session_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  workflow_task_attempt_id: string | null;
  kind: StructuredSurfaceQueueItemKind;
  idempotency_key: string;
  message_json: string;
  payload_json: string | null;
  status: StructuredSurfaceQueuedMessageStatus;
  priority: StructuredSurfaceQueuePriority;
  ordering_key: string;
  sequence: number;
  position: number;
  source_command_id: string | null;
  claim_owner_id: string | null;
  claim_lease_expires_at: string | null;
  lease_version: number;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error_json: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  failed_at: string | null;
  failure_error: string | null;
  cancelled_at: string | null;
};

type EventRow = {
  id: string;
  session_id: string;
  at: string;
  kind: string;
  subject_kind: StructuredEventSubjectKind;
  subject_id: string;
  data_json: string | null;
};

const MEMORY_DATABASE = ":memory:";

export function createStructuredSessionStateStore(
  options: CreateStructuredSessionStateStoreOptions,
): StructuredSessionStateStore {
  return new SqliteStructuredSessionStateStore(options);
}

function tryStructuredSessionStateOperation<A>(
  operation: string,
  run: () => A,
): Effect.Effect<A, StateContractError> {
  return Effect.try({
    try: run,
    catch: (cause) => structuredSessionStateStoreError(operation, cause),
  });
}

function structuredSessionStateStoreError(operation: string, cause: unknown): StateContractError {
  if (cause instanceof StateContractError) {
    return cause;
  }
  return new StateContractError({
    operation,
    reason: "transaction-failed",
    message: describeUnknownStructuredSessionStateCause(cause),
    cause,
  });
}

function describeUnknownStructuredSessionStateCause(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  return "Structured session state operation failed.";
}

class SqliteStructuredSessionStateStore implements StructuredSessionStateStore {
  private readonly db: Database;
  private readonly digest: StateDigestHelper | undefined;
  private readonly idFactory: ((prefix: string) => string) | undefined;
  private readonly nowFn: () => string;
  private workspace: StructuredWorkspaceRecord;
  readonly workspaceId: string;
  readonly databasePath: string;

  constructor(options: CreateStructuredSessionStateStoreOptions) {
    const databasePath = options.databasePath ?? MEMORY_DATABASE;
    this.databasePath = databasePath;
    if (databasePath !== MEMORY_DATABASE && options.filesystemSetup !== "caller") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.db = new Database(databasePath);
    applyBusyTimeout(this.db, options.busyTimeoutMs);
    this.digest = options.digest;
    this.idFactory = options.idFactory;
    this.nowFn = options.now ?? createDeterministicClock();
    initializeSchema(this.db);
    this.workspaceId = options.workspace.id;

    const existingWorkspace = this.db.query(`SELECT * FROM workspace LIMIT 1`).get() as
      | { id: string; label: string; cwd: string; artifact_dir: string }
      | undefined;
    this.workspace = existingWorkspace
      ? {
          id: existingWorkspace.id,
          label: existingWorkspace.label,
          cwd: existingWorkspace.cwd,
          artifactDir: existingWorkspace.artifact_dir,
        }
      : {
          id: options.workspace.id,
          label: options.workspace.label,
          cwd: options.workspace.cwd,
          artifactDir: options.workspace.artifactDir ?? defaultArtifactDirectory(),
        };

    if (options.filesystemSetup !== "caller") {
      try {
        mkdirSync(this.workspace.artifactDir, { recursive: true });
      } catch {
        // Some unit tests intentionally point at read-only fake workspace roots.
      }
    }

    if (!existingWorkspace) {
      this.db
        .query(
          `INSERT INTO workspace (id, label, cwd, artifact_dir)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          this.workspace.id,
          this.workspace.label,
          this.workspace.cwd,
          this.workspace.artifactDir,
        );
    }
    this.workspaceId = this.workspace.id;
    if (
      existingWorkspace &&
      options.workspaceArtifactDirectoryAuthority === "state-preference" &&
      options.workspace.artifactDir
    ) {
      this.setWorkspaceArtifactDirectory(options.workspace.artifactDir);
    }
    this.ensureWorkspaceLayoutSlots();
  }

  close(): void {
    this.db.close();
  }

  getWorkspaceRecord(): StructuredWorkspaceRecord {
    return { ...this.workspace };
  }

  setWorkspaceArtifactDirectory(artifactDir: string): StructuredWorkspaceRecord {
    const nextArtifactDir = resolve(artifactDir);
    if (nextArtifactDir === this.workspace.artifactDir) {
      return this.getWorkspaceRecord();
    }
    try {
      mkdirSync(nextArtifactDir, { recursive: true });
    } catch {
      // Artifact materialization reports the exact failure when this configured root is used.
    }
    this.db
      .query(`UPDATE workspace SET artifact_dir = ? WHERE id = ?`)
      .run(nextArtifactDir, this.workspace.id);
    this.workspace = { ...this.workspace, artifactDir: nextArtifactDir };
    this.bumpStateRevision();
    return this.getWorkspaceRecord();
  }

  getCurrentTimestamp(): string {
    return this.now();
  }

  getDigestHelper(): StateDigestHelper {
    if (!this.digest) {
      throw new Error("Structured session state digest helper is required.");
    }
    return this.digest;
  }

  readRequestInputSettings(): RequestInputSettings {
    const row = this.db.query(`SELECT * FROM request_user_input_settings WHERE id = 1`).get() as
      | {
          mode: string;
          blocking_timeout_enabled: number;
          blocking_timeout_duration_ms: number;
        }
      | undefined;
    if (!row) {
      return structuredClone(DEFAULT_REQUEST_INPUT_SETTINGS);
    }
    return decodeRequestInputSettings({
      mode: row.mode,
      blockingTimeout: {
        enabled: row.blocking_timeout_enabled !== 0,
        durationMs: row.blocking_timeout_duration_ms,
      },
    });
  }

  readExtensionSnapshotSettingsCaptureFacts(): ExtensionSnapshotSettingsCaptureFacts {
    const actorSettings = this.listAgentActorExtensionDefaults().map((record) => ({
      actor: record.actor,
      extensionOrder: record.extensionOrder.map((id) => id as ExtensionId),
      extensionUsage: Object.entries(record.extensionUsage)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([extensionId, usage]) => ({ extensionId: extensionId as ExtensionId, usage })),
    }));
    const profileSettings = this.listAgentProfiles().map((record) => ({
      actor: record.actor,
      profileId: record.profileId,
      extensionOrder: record.extensionOrder.map((id) => id as ExtensionId),
      extensionUsage: Object.entries(record.extensionUsage)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([extensionId, usage]) => ({ extensionId: extensionId as ExtensionId, usage })),
    }));
    const overrides = this.listExtensionEnvOverrides();
    const declarations = this.listExtensionEnvDeclarations();
    const secrets = new Map(
      this.listExtensionEnvSecrets().map((record) => [
        `${record.extensionId}\0${record.envName}`,
        record,
      ]),
    );
    return {
      actorSettings,
      profileSettings,
      nonSecretEnvOverrideScopes: [
        ...new Set([
          ...declarations.filter((record) => !record.secret).map((record) => record.extensionId),
          ...overrides.map((record) => record.extensionId),
        ]),
      ]
        .toSorted()
        .map((id) => id as ExtensionId),
      nonSecretEnvOverrides: overrides.map((record) => ({
        extensionId: record.extensionId as ExtensionId,
        envName: record.envName,
        value: record.value,
      })),
      secretTargets: declarations
        .filter((record) => record.secret)
        .map((record) => ({
          extensionId: record.extensionId as ExtensionId,
          envName: record.envName,
          present: secrets.get(`${record.extensionId}\0${record.envName}`)?.status === "configured",
        })),
    };
  }

  applyExtensionSnapshotSettings(
    input: ApplyExtensionSnapshotSettingsCommand,
  ): ApplyExtensionSnapshotSettingsReceipt {
    return this.extensionSnapshotIdempotent(input.clientRequestId, "apply-settings", input, () => {
      const skippedProfileIds: string[] = [];
      let appliedProfileCount = 0;
      for (const actor of input.payload.actorSettings) {
        this.writeAgentActorExtensionDefaults({
          actor: actor.actor,
          extensionOrder: actor.extensionOrder.map(String),
          extensionUsage: Object.fromEntries(
            actor.extensionUsage.map((entry) => [entry.extensionId, entry.usage]),
          ),
          updatedAt: input.appliedAt,
        });
      }
      for (const profile of input.payload.profileSettings) {
        const exists = this.db
          .query(`SELECT 1 AS found FROM agent_profile WHERE actor = ? AND profile_id = ?`)
          .get(profile.actor, profile.profileId) as { found: number } | undefined;
        if (!exists) {
          skippedProfileIds.push(profile.profileId);
          continue;
        }
        this.db
          .query(
            `UPDATE agent_profile
               SET extension_usage_json = ?, extension_order_json = ?, updated_at = ?
               WHERE actor = ? AND profile_id = ?`,
          )
          .run(
            JSON.stringify(
              Object.fromEntries(
                profile.extensionUsage.map((entry) => [entry.extensionId, entry.usage]),
              ),
            ),
            JSON.stringify(profile.extensionOrder),
            input.appliedAt,
            profile.actor,
            profile.profileId,
          );
        appliedProfileCount += 1;
      }
      for (const extensionId of input.payload.nonSecretEnvOverrideScopes) {
        this.db.query(`DELETE FROM extension_env_override WHERE extension_id = ?`).run(extensionId);
      }
      for (const override of input.payload.nonSecretEnvOverrides) {
        if (!input.payload.nonSecretEnvOverrideScopes.includes(override.extensionId)) {
          throw new StateContractError({
            operation: "structured-session.applyExtensionSnapshotSettings",
            reason: "invalid-input",
            message: "Snapshot env override is outside its captured scopes.",
          });
        }
        this.db
          .query(
            `INSERT INTO extension_env_override (extension_id, env_name, value, updated_at)
               VALUES (?, ?, ?, ?)`,
          )
          .run(override.extensionId, override.envName, override.value, input.appliedAt);
      }
      const stateRevision = this.bumpStateRevision();
      return {
        receipt: this.extensionSnapshotReceipt(
          input.clientRequestId,
          input.appliedAt,
          stateRevision,
        ),
        appliedActorCount: input.payload.actorSettings.length,
        appliedProfileCount,
        skippedProfileIds: skippedProfileIds.toSorted(),
        appliedOverrideCount: input.payload.nonSecretEnvOverrides.length,
        deferredSecretTargetCount: input.payload.secretTargets.length,
      };
    });
  }

  setRequestInputVariant(input: SetRequestInputVariantInput): RequestInputSettings {
    const current = this.readRequestInputSettings();
    return this.writeRequestInputSettings({ ...current, mode: input.mode });
  }

  setRequestInputBlockingTimeout(input: SetRequestInputBlockingTimeoutInput): RequestInputSettings {
    const current = this.readRequestInputSettings();
    return this.writeRequestInputSettings({
      ...current,
      blockingTimeout: { enabled: input.enabled, durationMs: input.durationMs },
    });
  }

  readAppPreferences(): StructuredAppPreferencesRecord {
    return this.readAppPreferencesRow();
  }

  hasAppPreferencesRow(): boolean {
    const row = this.db.query(`SELECT 1 AS found FROM app_preferences WHERE id = 1`).get() as
      | { found: number }
      | undefined;
    return Boolean(row);
  }

  updateAppPreferences(input: StructuredAppPreferencesPatch): StructuredAppPreferencesRecord {
    const current = this.readAppPreferencesRow();
    const nextUpdatedAt = input.updatedAt ?? this.now();
    const stateRevision = this.db.transaction(() => {
      const next = {
        appearance: input.appearance ?? current.appearance,
        externalEditor:
          input.externalEditor === undefined ? current.externalEditor : input.externalEditor,
        artifactDirectory: input.artifactDirectory ?? current.artifactDirectory,
        approvalMode: input.approvalMode ?? current.approvalMode,
        networkAccess: input.networkAccess ?? current.networkAccess,
        externalInstructions:
          input.externalInstructions === undefined
            ? current.externalInstructions
            : normalizeExternalInstructionsSettings(input.externalInstructions),
        ambientResources:
          input.ambientResources === undefined ? current.ambientResources : input.ambientResources,
        updatedAt: nextUpdatedAt,
        stateRevision: current.stateRevision,
      } satisfies StructuredAppPreferencesRecord;
      assertStructuredAppPreferenceApprovalMode(next.approvalMode);
      this.db
        .query(
          `INSERT INTO app_preferences (
             id,
             appearance,
             external_editor,
             artifact_directory,
             approval_mode,
             network_access,
             external_instructions_json,
             ambient_resources_json,
             updated_at
           )
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             appearance = excluded.appearance,
             external_editor = excluded.external_editor,
             artifact_directory = excluded.artifact_directory,
             approval_mode = excluded.approval_mode,
             network_access = excluded.network_access,
             external_instructions_json = excluded.external_instructions_json,
             ambient_resources_json = excluded.ambient_resources_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          next.appearance,
          next.externalEditor,
          next.artifactDirectory,
          next.approvalMode,
          next.networkAccess ? 1 : 0,
          JSON.stringify(next.externalInstructions),
          JSON.stringify(next.ambientResources),
          next.updatedAt,
        );
      return this.bumpStateRevision();
    })();
    return {
      appearance: input.appearance ?? current.appearance,
      externalEditor:
        input.externalEditor === undefined ? current.externalEditor : input.externalEditor,
      artifactDirectory: input.artifactDirectory ?? current.artifactDirectory,
      approvalMode: input.approvalMode ?? current.approvalMode,
      networkAccess: input.networkAccess ?? current.networkAccess,
      externalInstructions:
        input.externalInstructions === undefined
          ? current.externalInstructions
          : normalizeExternalInstructionsSettings(input.externalInstructions),
      ambientResources:
        input.ambientResources === undefined ? current.ambientResources : input.ambientResources,
      updatedAt: nextUpdatedAt,
      stateRevision,
    };
  }

  hasWorkspaceChromeRows(): boolean {
    const chrome = this.db
      .query(`SELECT 1 AS found FROM workspace_chrome_state WHERE id = 1`)
      .get() as { found: number } | undefined;
    if (chrome) return true;
    const tab = this.db.query(`SELECT 1 AS found FROM workspace_chrome_tab LIMIT 1`).get() as
      | { found: number }
      | undefined;
    return Boolean(tab);
  }

  hasWorkspaceLayoutRows(): boolean {
    const layout = this.db.query(`SELECT 1 AS found FROM workspace_layout_slot LIMIT 1`).get() as
      | { found: number }
      | undefined;
    return Boolean(layout);
  }

  readWorkspaceChrome(): StructuredWorkspaceChromeRecord {
    const state = this.db.query(`SELECT * FROM workspace_chrome_state WHERE id = 1`).get() as
      | WorkspaceChromeStateRow
      | undefined;
    const tabs = this.queryWorkspaceChromeTabs("open");
    const knownWorkspaces = this.queryWorkspaceChromeTabs("known");
    return {
      activeWorkspaceTabId: state?.active_workspace_tab_id ?? null,
      tabs,
      knownWorkspaces,
      stateRevision: this.readStateRevision(),
    };
  }

  readWorkspaceLayout(workspaceId: string): StructuredWorkspaceLayoutRecord {
    this.assertWorkspaceLayoutScope(workspaceId, "structured-session.readWorkspaceLayout");
    const rows = this.db
      .query(
        `SELECT * FROM workspace_layout_slot
         WHERE workspace_id = ?
         ORDER BY layout_id ASC`,
      )
      .all(workspaceId) as WorkspaceLayoutSlotRow[];
    if (
      rows.length !== 3 ||
      !(["A", "B", "C"] as const).every((layoutId) =>
        rows.some((row) => row.layout_id === layoutId),
      )
    ) {
      throw new StateContractError({
        operation: "structured-session.readWorkspaceLayout",
        reason: "decode-failed",
        message: `Workspace ${workspaceId} does not have exactly one A, B, and C layout slot.`,
      });
    }
    return {
      workspaceId,
      slots: rows.map((row) => this.mapWorkspaceLayoutSlot(row)),
      stateRevision: this.readStateRevision(),
    };
  }

  setWorkspaceTabs(input: SetWorkspaceTabsCommandInput): StructuredWorkspaceChromeMutationRecord {
    return this.db.transaction((): StructuredWorkspaceChromeMutationRecord => {
      const state = this.db.query(`SELECT * FROM workspace_chrome_state WHERE id = 1`).get() as
        | WorkspaceChromeStateRow
        | undefined;
      const currentTabs = this.queryWorkspaceChromeTabs("open");
      const currentKnownWorkspaces = this.queryWorkspaceChromeTabs("known");
      const existingLayoutIdByWorkspaceTab = new Map<string, WorkspaceLayoutSlotId>();
      for (const tab of [...currentTabs, ...currentKnownWorkspaces]) {
        const key = `${tab.workspaceTabId}\u0000${tab.workspaceId}`;
        if (!existingLayoutIdByWorkspaceTab.has(key)) {
          existingLayoutIdByWorkspaceTab.set(key, tab.activeLayoutId);
        }
      }
      const incomingOpenLayoutIdByWorkspaceTab = new Map(
        input.tabs.map((tab) => [
          `${tab.workspaceTabId}\u0000${tab.workspaceId}`,
          tab.activeLayoutId,
        ]),
      );
      const preserveGranularSelection = (
        tab: StructuredWorkspaceTabRecord,
      ): StructuredWorkspaceTabRecord => {
        const key = `${tab.workspaceTabId}\u0000${tab.workspaceId}`;
        return {
          ...tab,
          activeLayoutId:
            existingLayoutIdByWorkspaceTab.get(key) ??
            incomingOpenLayoutIdByWorkspaceTab.get(key) ??
            tab.activeLayoutId,
        };
      };
      const tabs = input.tabs.map(preserveGranularSelection);
      const knownWorkspaces = input.knownWorkspaces.map(preserveGranularSelection);
      const tabCollectionsChanged =
        !workspaceTabCollectionsEqual(currentTabs, tabs) ||
        !workspaceTabCollectionsEqual(currentKnownWorkspaces, knownWorkspaces);
      const activeWorkspaceTabId =
        !tabCollectionsChanged &&
        state?.active_workspace_tab_id !== null &&
        state?.active_workspace_tab_id !== undefined &&
        tabs.some((tab) => tab.workspaceTabId === state.active_workspace_tab_id)
          ? state.active_workspace_tab_id
          : input.activeWorkspaceTabId;
      if (
        activeWorkspaceTabId !== null &&
        !tabs.some((tab) => tab.workspaceTabId === activeWorkspaceTabId)
      ) {
        throw new StateContractError({
          operation: "structured-session.setWorkspaceTabs",
          reason: "invalid-input",
          message: `Active workspace tab ${activeWorkspaceTabId} is not open.`,
        });
      }
      if (
        state &&
        state.active_workspace_tab_id === activeWorkspaceTabId &&
        workspaceTabCollectionsEqual(currentTabs, tabs) &&
        workspaceTabCollectionsEqual(currentKnownWorkspaces, knownWorkspaces)
      ) {
        return {
          outcome: "no-op",
          updatedAt: state.updated_at,
          stateRevision: this.readStateRevision(),
        };
      }
      const updatedAt = this.now();
      this.db.query(`DELETE FROM workspace_chrome_tab`).run();
      this.insertWorkspaceChromeTabs(tabs, "open", updatedAt);
      this.insertWorkspaceChromeTabs(knownWorkspaces, "known", updatedAt);
      this.db
        .query(
          `INSERT INTO workspace_chrome_state (id, active_workspace_tab_id, updated_at)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             active_workspace_tab_id = excluded.active_workspace_tab_id,
             updated_at = excluded.updated_at`,
        )
        .run(activeWorkspaceTabId, updatedAt);
      return {
        outcome: "committed",
        updatedAt,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  readExtensionBuildAttempt(
    attemptId: ExtensionBuildAttemptRecord["attemptId"],
  ): ExtensionBuildAttemptRecord | null {
    const row = this.db
      .query(
        `SELECT attempt_id, client_request_id, extension_id, registry_aggregate_fingerprint, source_fingerprint,
                status, failure_reason, successful_build_id, started_at, finished_at
         FROM extension_build_attempt
         WHERE attempt_id = ?`,
      )
      .get(attemptId) as ExtensionBuildAttemptRow | null;
    return row ? extensionBuildAttemptRecordFromRow(row) : null;
  }

  readExtensionBuildAttemptByClientRequestId(
    clientRequestId: ExtensionBuildAttemptRecord["clientRequestId"],
  ): ExtensionBuildAttemptRecord | null {
    const row = this.db
      .query(
        `SELECT attempt_id, client_request_id, extension_id, registry_aggregate_fingerprint,
                source_fingerprint, status, failure_reason, successful_build_id, started_at, finished_at
         FROM extension_build_attempt WHERE client_request_id = ?`,
      )
      .get(clientRequestId) as ExtensionBuildAttemptRow | null;
    return row ? extensionBuildAttemptRecordFromRow(row) : null;
  }

  startExtensionBuildAttempt(
    unsafeInput: StartExtensionBuildAttemptInput,
  ): StructuredExtensionBuildAttemptMutationResult {
    const input = decodeStartExtensionBuildAttemptInputContract(unsafeInput);
    return this.db.transaction(() => {
      const existing = this.readExtensionBuildAttempt(input.attemptId);
      if (existing) {
        if (
          existing.clientRequestId === input.clientRequestId &&
          existing.extensionId === input.extensionId &&
          existing.registryAggregateFingerprint === input.registryAggregateFingerprint &&
          existing.sourceFingerprint === input.sourceFingerprint &&
          existing.startedAt === input.startedAt
        ) {
          return {
            record: existing,
            outcome: "no-op" as const,
            stateRevision: this.readCurrentStateRevision(),
          };
        }
        throw new StateContractError({
          operation: "structured-session.startExtensionBuildAttempt",
          reason: "conflict",
          message: "Extension build attempt identity was already used for different build work.",
        });
      }

      const requestAttempt = this.readExtensionBuildAttemptByClientRequestId(input.clientRequestId);
      if (requestAttempt) {
        if (
          requestAttempt.extensionId === input.extensionId &&
          requestAttempt.registryAggregateFingerprint === input.registryAggregateFingerprint &&
          requestAttempt.sourceFingerprint === input.sourceFingerprint
        ) {
          return {
            record: requestAttempt,
            outcome: "no-op" as const,
            stateRevision: this.readCurrentStateRevision(),
          };
        }
        throw new StateContractError({
          operation: "structured-session.startExtensionBuildAttempt",
          reason: "conflict",
          message: "Extension build client request id was reused for different build work.",
        });
      }

      const registry = this.readExtensionRegistryObservation();
      const registryObservation = registry?.observation.observations.find(
        (observation) => observation.extensionId === input.extensionId,
      );
      const evidence = this.readExtensionSourceBuildEvidence();
      const sourceObservation = evidence?.observations.find(
        (observation) => observation.extensionId === input.extensionId,
      );
      if (
        !registry ||
        registry.observation.aggregateFingerprint !== input.registryAggregateFingerprint ||
        !registryObservation ||
        registryObservation.buildRequirement !== "required" ||
        registryObservation.sourceFingerprint !== input.sourceFingerprint ||
        !evidence ||
        evidence.registryAggregateFingerprint !== input.registryAggregateFingerprint ||
        !sourceObservation ||
        sourceObservation.buildRequirement !== "required" ||
        sourceObservation.sourceStatus !== "materialized" ||
        sourceObservation.sourceFingerprint !== input.sourceFingerprint
      ) {
        throw new StateContractError({
          operation: "structured-session.startExtensionBuildAttempt",
          reason: "conflict",
          message: "Extension build attempt does not match current registry and source authority.",
        });
      }

      const record = decodeExtensionBuildAttemptRecordContract({
        ...input,
        status: "running",
        failureReason: null,
        successfulBuildId: null,
        finishedAt: null,
      });
      this.db
        .query(
          `INSERT INTO extension_build_attempt (
             attempt_id, client_request_id, extension_id, registry_aggregate_fingerprint, source_fingerprint,
             status, failure_reason, successful_build_id, started_at, finished_at
           ) VALUES (?, ?, ?, ?, ?, 'running', NULL, NULL, ?, NULL)`,
        )
        .run(
          record.attemptId,
          record.clientRequestId,
          record.extensionId,
          record.registryAggregateFingerprint,
          record.sourceFingerprint,
          record.startedAt,
        );
      return {
        record,
        outcome: "committed" as const,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  recordExtensionBuildSuccess(
    unsafeInput: RecordExtensionBuildSuccessInput,
  ): StructuredExtensionBuildAttemptMutationResult {
    const input = decodeRecordExtensionBuildSuccessInputContract(unsafeInput);
    return this.db.transaction(() => {
      const existing = this.readExtensionBuildAttempt(input.attemptId);
      if (!existing) {
        throw new StateContractError({
          operation: "structured-session.recordExtensionBuildSuccess",
          reason: "not-found",
          message: "Extension build attempt was not found.",
        });
      }
      if (existing.status !== "running") {
        if (
          existing.status === "succeeded" &&
          existing.clientRequestId === input.clientRequestId &&
          existing.extensionId === input.extensionId &&
          existing.registryAggregateFingerprint === input.registryAggregateFingerprint &&
          existing.sourceFingerprint === input.sourceFingerprint &&
          existing.successfulBuildId === input.manifest.buildId &&
          existing.finishedAt === input.finishedAt
        ) {
          return {
            record: existing,
            outcome: "no-op" as const,
            stateRevision: this.readCurrentStateRevision(),
          };
        }
        throw new StateContractError({
          operation: "structured-session.recordExtensionBuildSuccess",
          reason: "conflict",
          message: "Extension build attempt already has a different terminal outcome.",
        });
      }
      if (
        existing.clientRequestId !== input.clientRequestId ||
        existing.extensionId !== input.extensionId ||
        existing.registryAggregateFingerprint !== input.registryAggregateFingerprint ||
        existing.sourceFingerprint !== input.sourceFingerprint ||
        input.finishedAt < existing.startedAt
      ) {
        throw new StateContractError({
          operation: "structured-session.recordExtensionBuildSuccess",
          reason: "conflict",
          message: "Extension build success does not match the running attempt identity.",
        });
      }

      const registry = this.readExtensionRegistryObservation();
      const registryObservation = registry?.observation.observations.find(
        (observation) => observation.extensionId === input.extensionId,
      );
      const evidence = this.readExtensionSourceBuildEvidence();
      const sourceObservation = evidence?.observations.find(
        (observation) => observation.extensionId === input.extensionId,
      );
      if (
        !registry ||
        registry.observation.aggregateFingerprint !== input.registryAggregateFingerprint ||
        !registryObservation ||
        registryObservation.buildRequirement !== "required" ||
        registryObservation.sourceFingerprint !== input.sourceFingerprint ||
        input.manifest.extensionId !== input.extensionId ||
        input.manifest.interfaceKind !== registryObservation.interfaceKind ||
        input.manifest.sourceFingerprint !== input.sourceFingerprint ||
        !evidence ||
        evidence.registryAggregateFingerprint !== input.registryAggregateFingerprint ||
        !sourceObservation ||
        sourceObservation.buildRequirement !== "required" ||
        sourceObservation.sourceStatus !== "materialized" ||
        sourceObservation.sourceFingerprint !== input.sourceFingerprint
      ) {
        throw new StateContractError({
          operation: "structured-session.recordExtensionBuildSuccess",
          reason: "conflict",
          message: "Extension build success does not match current registry and source authority.",
        });
      }

      const promotedObservation = decodeExtensionSourceBuildObservationContract({
        ...sourceObservation,
        currentBuildStatus: "current",
        currentBuild: input.manifest,
        buildRequired: false,
        diagnostics: [],
      });
      this.db
        .query(
          `UPDATE extension_source_build_evidence
           SET observation_json = ?, observed_at = ?
           WHERE extension_id = ? AND registry_aggregate_fingerprint = ?`,
        )
        .run(
          JSON.stringify(promotedObservation),
          input.finishedAt,
          input.extensionId,
          input.registryAggregateFingerprint,
        );
      this.db
        .query(
          `UPDATE extension_source_build_evidence_batch
           SET observed_at = ?
           WHERE singleton_id = 1 AND registry_aggregate_fingerprint = ?`,
        )
        .run(input.finishedAt, input.registryAggregateFingerprint);
      this.db
        .query(
          `UPDATE extension_build_attempt
           SET status = 'succeeded', successful_build_id = ?, finished_at = ?
           WHERE attempt_id = ? AND status = 'running'`,
        )
        .run(input.manifest.buildId, input.finishedAt, input.attemptId);
      const record = this.readExtensionBuildAttempt(input.attemptId)!;
      return {
        record,
        outcome: "committed" as const,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  recordExtensionBuildFailure(
    unsafeInput: RecordExtensionBuildFailureInput,
  ): StructuredExtensionBuildAttemptMutationResult {
    const input = decodeRecordExtensionBuildFailureInputContract(unsafeInput);
    return this.db.transaction(() => {
      const existing = this.readExtensionBuildAttempt(input.attemptId);
      if (!existing) {
        throw new StateContractError({
          operation: "structured-session.recordExtensionBuildFailure",
          reason: "not-found",
          message: "Extension build attempt was not found.",
        });
      }
      if (existing.status !== "running") {
        if (
          existing.status === "failed" &&
          existing.clientRequestId === input.clientRequestId &&
          existing.extensionId === input.extensionId &&
          existing.registryAggregateFingerprint === input.registryAggregateFingerprint &&
          existing.sourceFingerprint === input.sourceFingerprint &&
          existing.failureReason === input.failureReason &&
          existing.finishedAt === input.finishedAt
        ) {
          return {
            record: existing,
            outcome: "no-op" as const,
            stateRevision: this.readCurrentStateRevision(),
          };
        }
        throw new StateContractError({
          operation: "structured-session.recordExtensionBuildFailure",
          reason: "conflict",
          message: "Extension build attempt already has a different terminal outcome.",
        });
      }
      if (
        existing.clientRequestId !== input.clientRequestId ||
        existing.extensionId !== input.extensionId ||
        existing.registryAggregateFingerprint !== input.registryAggregateFingerprint ||
        existing.sourceFingerprint !== input.sourceFingerprint ||
        input.finishedAt < existing.startedAt
      ) {
        throw new StateContractError({
          operation: "structured-session.recordExtensionBuildFailure",
          reason: "conflict",
          message: "Extension build failure does not match the running attempt identity.",
        });
      }
      this.db
        .query(
          `UPDATE extension_build_attempt
           SET status = 'failed', failure_reason = ?, finished_at = ?
           WHERE attempt_id = ? AND status = 'running'`,
        )
        .run(input.failureReason, input.finishedAt, input.attemptId);
      const record = this.readExtensionBuildAttempt(input.attemptId)!;
      return {
        record,
        outcome: "committed" as const,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  listExtensionSnapshots(): ExtensionSnapshotsReadModel {
    const rows = this.db
      .query(`SELECT * FROM extension_snapshot ORDER BY updated_at DESC, snapshot_id ASC`)
      .all() as Array<Record<string, unknown>>;
    return {
      revision: this.readCurrentStateRevision(),
      snapshots: rows.map((row) => {
        const record = this.mapExtensionSnapshotRow(row);
        return this.publicExtensionSnapshot(record);
      }),
    };
  }

  readExtensionSnapshot(snapshotId: ExtensionSnapshotId): ExtensionSnapshotStateRecord | null {
    const row = this.db
      .query(`SELECT * FROM extension_snapshot WHERE snapshot_id = ?`)
      .get(snapshotId) as Record<string, unknown> | undefined;
    return row ? this.mapExtensionSnapshotRow(row) : null;
  }

  saveExtensionSnapshot(input: SaveExtensionSnapshotCommand): SaveExtensionSnapshotReceipt {
    return this.extensionSnapshotIdempotent(input.clientRequestId, "save", input, () => {
      if (this.readExtensionSnapshot(input.snapshotId)) {
        throw new StateContractError({
          operation: "structured-session.saveExtensionSnapshot",
          reason: "conflict",
          message: "Extension snapshot id already exists.",
        });
      }
      const stateRevision = this.bumpStateRevision();
      this.db
        .query(
          `INSERT INTO extension_snapshot
         (snapshot_id, name, created_at, updated_at, revision, payload_ref_json,
          secret_payload_ref, extension_count, secret_state, status)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'available')`,
        )
        .run(
          input.snapshotId,
          input.name,
          input.capturedAt,
          input.capturedAt,
          JSON.stringify(input.payloadRef),
          input.secretPayloadRef,
          input.extensionCount,
          input.secretPayloadRef === null ? "not-present" : "captured",
        );
      const snapshot = this.readExtensionSnapshot(input.snapshotId)!;
      return {
        receipt: this.extensionSnapshotReceipt(
          input.clientRequestId,
          input.capturedAt,
          stateRevision,
        ),
        snapshot: this.publicExtensionSnapshot(snapshot),
      };
    });
  }

  renameExtensionSnapshot(input: RenameExtensionSnapshotCommand): RenameExtensionSnapshotReceipt {
    return this.extensionSnapshotIdempotent(input.clientRequestId, "rename", input, () => {
      const snapshot = this.requireExtensionSnapshot(input.snapshotId, "renameExtensionSnapshot");
      if (snapshot.revision !== input.expectedRevision) {
        throw this.extensionSnapshotStale("renameExtensionSnapshot");
      }
      let stateRevision = this.readCurrentStateRevision();
      if (snapshot.name !== input.name) {
        this.db
          .query(
            `UPDATE extension_snapshot SET name = ?, updated_at = ?, revision = revision + 1
           WHERE snapshot_id = ?`,
          )
          .run(input.name, input.renamedAt, input.snapshotId);
        stateRevision = this.bumpStateRevision();
      }
      return {
        receipt: this.extensionSnapshotReceipt(
          input.clientRequestId,
          input.renamedAt,
          stateRevision,
        ),
        snapshot: this.publicExtensionSnapshot(this.readExtensionSnapshot(input.snapshotId)!),
      };
    });
  }

  deleteExtensionSnapshot(input: DeleteExtensionSnapshotCommand): DeleteExtensionSnapshotReceipt {
    return this.extensionSnapshotIdempotent(input.clientRequestId, "delete", input, () => {
      const snapshot = this.requireExtensionSnapshot(input.snapshotId, "deleteExtensionSnapshot");
      if (snapshot.revision !== input.expectedRevision) {
        throw this.extensionSnapshotStale("deleteExtensionSnapshot");
      }
      const cleanup: ExtensionSnapshotCleanupRecord = {
        cleanupId: input.cleanupId,
        snapshotId: snapshot.snapshotId,
        payloadRef: snapshot.payloadRef,
        secretPayloadRef: snapshot.secretPayloadRef,
        requestedAt: input.deletedAt,
      };
      this.db
        .query(
          `INSERT INTO extension_snapshot_cleanup
         (cleanup_id, snapshot_id, payload_ref_json, secret_payload_ref, requested_at)
         VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          cleanup.cleanupId,
          cleanup.snapshotId,
          JSON.stringify(cleanup.payloadRef),
          cleanup.secretPayloadRef,
          cleanup.requestedAt,
        );
      this.db.query(`DELETE FROM extension_snapshot WHERE snapshot_id = ?`).run(input.snapshotId);
      const stateRevision = this.bumpStateRevision();
      return {
        receipt: this.extensionSnapshotReceipt(
          input.clientRequestId,
          input.deletedAt,
          stateRevision,
        ),
        snapshotId: input.snapshotId,
        cleanup,
      };
    });
  }

  loadExtensionSnapshot(input: LoadExtensionSnapshotCommand): LoadExtensionSnapshotReceipt {
    return this.extensionSnapshotIdempotent(input.clientRequestId, "load", input, () => {
      const snapshot = this.requireExtensionSnapshot(input.snapshotId, "loadExtensionSnapshot");
      if (snapshot.revision !== input.expectedRevision) {
        throw this.extensionSnapshotStale("loadExtensionSnapshot");
      }
      this.db
        .query(
          `INSERT INTO extension_snapshot_restore_attempt
         (attempt_id, snapshot_id, client_request_id, snapshot_revision, payload_ref_json,
          secret_payload_ref, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`,
        )
        .run(
          input.attemptId,
          input.snapshotId,
          input.clientRequestId,
          snapshot.revision,
          JSON.stringify(snapshot.payloadRef),
          snapshot.secretPayloadRef,
          input.startedAt,
          input.startedAt,
        );
      const stateRevision = this.bumpStateRevision();
      return {
        receipt: this.extensionSnapshotReceipt(
          input.clientRequestId,
          input.startedAt,
          stateRevision,
        ),
        attempt: this.readExtensionSnapshotRestoreAttempt(input.attemptId)!,
      };
    });
  }

  readExtensionSnapshotRestoreAttempt(
    attemptId: ExtensionSnapshotRestoreAttemptId,
  ): ExtensionSnapshotRestoreAttempt | null {
    const row = this.db
      .query(`SELECT * FROM extension_snapshot_restore_attempt WHERE attempt_id = ?`)
      .get(attemptId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return decodeExtensionSnapshotRestoreAttemptContract({
      attemptId: row.attempt_id,
      snapshotId: row.snapshot_id,
      clientRequestId: row.client_request_id,
      snapshotRevision: row.snapshot_revision,
      payloadRef: decodeExtensionSnapshotPayloadRefContract(
        JSON.parse(String(row.payload_ref_json)),
      ),
      secretPayloadRef: row.secret_payload_ref,
      status: row.status,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      failureReason: row.failure_reason,
    });
  }

  listPendingExtensionSnapshotRestoreAttempts(): ExtensionSnapshotRestoreAttempt[] {
    const rows = this.db
      .query(
        `SELECT attempt_id FROM extension_snapshot_restore_attempt
         WHERE status NOT IN ('completed', 'failed')
         ORDER BY started_at ASC, attempt_id ASC`,
      )
      .all() as Array<{ attempt_id: string }>;
    return rows.map(
      (row) =>
        this.readExtensionSnapshotRestoreAttempt(
          row.attempt_id as ExtensionSnapshotRestoreAttemptId,
        )!,
    );
  }

  advanceExtensionSnapshotRestoreAttempt(
    input: AdvanceExtensionSnapshotRestoreAttemptCommand,
  ): AdvanceExtensionSnapshotRestoreAttemptReceipt {
    return this.extensionSnapshotIdempotent(input.clientRequestId, "advance-restore", input, () => {
      const attempt = this.readExtensionSnapshotRestoreAttempt(input.attemptId);
      if (!attempt) {
        throw new StateContractError({
          operation: "structured-session.advanceExtensionSnapshotRestoreAttempt",
          reason: "not-found",
          message: "Extension snapshot restore attempt was not found.",
        });
      }
      if (attempt.status !== input.expectedStatus) {
        throw this.extensionSnapshotStale("advanceExtensionSnapshotRestoreAttempt");
      }
      const allowed: Record<string, readonly string[]> = {
        prepared: ["payload-applied", "failed"],
        "payload-applied": ["state-committed", "failed"],
        "state-committed": ["building", "failed"],
        building: ["completed", "failed"],
        completed: [],
        failed: [],
      };
      if (!allowed[attempt.status]?.includes(input.status)) {
        throw new StateContractError({
          operation: "structured-session.advanceExtensionSnapshotRestoreAttempt",
          reason: "conflict",
          message: `Invalid extension snapshot restore transition: ${attempt.status} -> ${input.status}.`,
        });
      }
      const terminal = input.status === "completed" || input.status === "failed";
      if ((input.status === "failed") !== (input.failureReason !== null)) {
        throw new StateContractError({
          operation: "structured-session.advanceExtensionSnapshotRestoreAttempt",
          reason: "invalid-input",
          message: "Only failed restore attempts may carry a failure reason.",
        });
      }
      this.db
        .query(
          `UPDATE extension_snapshot_restore_attempt
         SET status = ?, updated_at = ?, finished_at = ?, failure_reason = ?
         WHERE attempt_id = ?`,
        )
        .run(
          input.status,
          input.updatedAt,
          terminal ? input.updatedAt : null,
          input.failureReason,
          input.attemptId,
        );
      const stateRevision = this.bumpStateRevision();
      return {
        receipt: this.extensionSnapshotReceipt(
          input.clientRequestId,
          input.updatedAt,
          stateRevision,
        ),
        attempt: this.readExtensionSnapshotRestoreAttempt(input.attemptId)!,
      };
    });
  }

  listPendingExtensionSnapshotCleanup(): ExtensionSnapshotCleanupRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM extension_snapshot_cleanup WHERE completed_at IS NULL
       ORDER BY requested_at ASC, cleanup_id ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      cleanupId: row.cleanup_id as ExtensionSnapshotCleanupRecord["cleanupId"],
      snapshotId: row.snapshot_id as ExtensionSnapshotCleanupRecord["snapshotId"],
      payloadRef: decodeExtensionSnapshotPayloadRefContract(
        JSON.parse(String(row.payload_ref_json)),
      ),
      secretPayloadRef:
        row.secret_payload_ref as ExtensionSnapshotCleanupRecord["secretPayloadRef"],
      requestedAt: row.requested_at as ExtensionSnapshotCleanupRecord["requestedAt"],
    }));
  }

  completeExtensionSnapshotCleanup(
    input: CompleteExtensionSnapshotCleanupCommand,
  ): CompleteExtensionSnapshotCleanupReceipt {
    return this.extensionSnapshotIdempotent(
      input.clientRequestId,
      "complete-cleanup",
      input,
      () => {
        const result = this.db
          .query(
            `UPDATE extension_snapshot_cleanup SET completed_at = ?
         WHERE cleanup_id = ? AND completed_at IS NULL`,
          )
          .run(input.completedAt, input.cleanupId);
        if (result.changes === 0) {
          throw new StateContractError({
            operation: "structured-session.completeExtensionSnapshotCleanup",
            reason: "not-found",
            message: "Pending extension snapshot cleanup was not found.",
          });
        }
        const stateRevision = this.bumpStateRevision();
        return {
          receipt: this.extensionSnapshotReceipt(
            input.clientRequestId,
            input.completedAt,
            stateRevision,
          ),
          cleanupId: input.cleanupId,
        };
      },
    );
  }

  private mapExtensionSnapshotRow(row: Record<string, unknown>): ExtensionSnapshotStateRecord {
    return decodeExtensionSnapshotStateRecordContract({
      snapshotId: row.snapshot_id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      payloadRef: decodeExtensionSnapshotPayloadRefContract(
        JSON.parse(String(row.payload_ref_json)),
      ),
      secretPayloadRef: row.secret_payload_ref,
      extensionCount: row.extension_count,
      secretState: row.secret_state,
      status: row.status,
    });
  }

  private publicExtensionSnapshot(snapshot: ExtensionSnapshotStateRecord) {
    const { payloadRef: _payloadRef, secretPayloadRef: _secretPayloadRef, ...summary } = snapshot;
    return summary;
  }

  private requireExtensionSnapshot(snapshotId: ExtensionSnapshotId, operation: string) {
    const snapshot = this.readExtensionSnapshot(snapshotId);
    if (!snapshot) {
      throw new StateContractError({
        operation: `structured-session.${operation}`,
        reason: "not-found",
        message: "Extension snapshot was not found.",
      });
    }
    return snapshot;
  }

  private extensionSnapshotStale(operation: string) {
    return new StateContractError({
      operation: `structured-session.${operation}`,
      reason: "stale-state",
      message: "Extension snapshot revision no longer matches.",
    });
  }

  private extensionSnapshotReceipt(
    clientRequestId: string,
    committedAt: IsoDateTimeString,
    stateRevision: StateRevision,
  ): StateCommandReceipt {
    return {
      clientRequestId,
      outcome: "applied",
      committedAt: committedAt as StateCommandReceipt["committedAt"],
      stateRevision,
    };
  }

  private extensionSnapshotIdempotent<T extends { receipt: { outcome: "applied" | "duplicate" } }>(
    clientRequestId: string,
    operation: string,
    input: unknown,
    apply: () => T,
  ): T {
    return this.db.transaction(() => {
      const inputJson = JSON.stringify(input);
      const existing = this.db
        .query(
          `SELECT operation, input_json, result_json FROM extension_snapshot_client_request
         WHERE client_request_id = ?`,
        )
        .get(clientRequestId) as
        | { operation: string; input_json: string; result_json: string }
        | undefined;
      if (existing) {
        if (existing.operation !== operation || existing.input_json !== inputJson) {
          throw new StateContractError({
            operation: `structured-session.${operation}ExtensionSnapshot`,
            reason: "conflict",
            message: "Client request id was already used with different snapshot input.",
          });
        }
        const result = JSON.parse(existing.result_json) as T;
        return { ...result, receipt: { ...result.receipt, outcome: "duplicate" } };
      }
      const result = apply();
      this.db
        .query(
          `INSERT INTO extension_snapshot_client_request
         (client_request_id, operation, input_json, result_json) VALUES (?, ?, ?, ?)`,
        )
        .run(clientRequestId, operation, inputJson, JSON.stringify(result));
      return result;
    })();
  }

  selectWorkspaceTab(
    input: SelectWorkspaceTabCommandInput,
  ): StructuredWorkspaceChromeMutationRecord {
    return this.db.transaction((): StructuredWorkspaceChromeMutationRecord => {
      const tab = this.db
        .query(
          `SELECT * FROM workspace_chrome_tab
           WHERE workspace_tab_id = ? AND tab_kind = 'open'`,
        )
        .get(input.workspaceTabId) as WorkspaceChromeTabRow | undefined;
      if (!tab) {
        throw workspaceChromeTabNotFoundError(
          "structured-session.selectWorkspaceTab",
          input.workspaceTabId,
        );
      }
      const state = this.db.query(`SELECT * FROM workspace_chrome_state WHERE id = 1`).get() as
        | WorkspaceChromeStateRow
        | undefined;
      if (state?.active_workspace_tab_id === input.workspaceTabId) {
        return {
          outcome: "no-op",
          updatedAt: state.updated_at,
          stateRevision: this.readStateRevision(),
        };
      }
      const updatedAt = this.now();
      this.db
        .query(
          `INSERT INTO workspace_chrome_state (id, active_workspace_tab_id, updated_at)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             active_workspace_tab_id = excluded.active_workspace_tab_id,
             updated_at = excluded.updated_at`,
        )
        .run(input.workspaceTabId, updatedAt);
      return {
        outcome: "committed",
        updatedAt,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  selectWorkspaceLayoutSlot(
    input: SelectWorkspaceLayoutSlotCommandInput,
  ): StructuredWorkspaceChromeMutationRecord {
    return this.db.transaction((): StructuredWorkspaceChromeMutationRecord => {
      const rows = this.db
        .query(`SELECT * FROM workspace_chrome_tab WHERE workspace_tab_id = ?`)
        .all(input.workspaceTabId) as WorkspaceChromeTabRow[];
      const openTab = rows.find((row) => row.tab_kind === "open");
      if (!openTab) {
        throw workspaceChromeTabNotFoundError(
          "structured-session.selectWorkspaceLayoutSlot",
          input.workspaceTabId,
        );
      }
      if (rows.every((row) => row.active_layout_id === input.layoutId)) {
        return {
          outcome: "no-op",
          updatedAt: openTab.updated_at,
          stateRevision: this.readStateRevision(),
        };
      }
      const updatedAt = this.now();
      this.db
        .query(
          `UPDATE workspace_chrome_tab
           SET active_layout_id = ?, updated_at = ?
           WHERE workspace_tab_id = ?`,
        )
        .run(input.layoutId, updatedAt, input.workspaceTabId);
      return {
        outcome: "committed",
        updatedAt,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  saveWorkspaceLayoutSlot(
    input: SaveWorkspaceLayoutSlotCommandInput,
  ): StructuredMutationCommitRecord {
    this.assertWorkspaceLayoutScope(
      input.workspaceId,
      "structured-session.saveWorkspaceLayoutSlot",
    );
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      const current = this.findWorkspaceLayoutSlot(input.workspaceId, input.layoutId);
      this.upsertWorkspaceLayoutSlot({
        workspaceId: input.workspaceId,
        layoutId: input.layoutId,
        initialized: current?.initialized !== 0 || input.panes.length > 0,
        dockviewJson: input.dockviewJson,
        panes: [...input.panes],
        compactSurfaces: [...input.compactSurfaces],
        focusedPaneId: input.focusedPaneId,
        updatedAt,
      });
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  readExtensionRegistryObservation(): ExtensionRegistryStateRecord | null {
    const row = this.db
      .query(
        `SELECT observation_json, observed_at
         FROM extension_registry_observation
         WHERE singleton_id = 1`,
      )
      .get() as ExtensionRegistryObservationRow | null;
    if (!row) return null;
    return {
      observation: decodeStoredExtensionRegistryObservation(row.observation_json),
      observedAt: row.observed_at as ExtensionRegistryStateRecord["observedAt"],
    };
  }

  reconcileExtensionRegistryObservation(
    input: ReconcileExtensionRegistryObservationInput,
  ): StructuredExtensionRegistryReconcileResult {
    const observation = decodeExtensionRegistryObservationResultContract(input.observation);
    const observationJson = JSON.stringify(observation);
    return this.db.transaction(() => {
      const currentRow = this.db
        .query(
          `SELECT observation_json, observed_at
           FROM extension_registry_observation
           WHERE singleton_id = 1`,
        )
        .get() as ExtensionRegistryObservationRow | null;
      if (currentRow?.observation_json === observationJson) {
        return {
          record: {
            observation: decodeStoredExtensionRegistryObservation(currentRow.observation_json),
            observedAt: currentRow.observed_at as ExtensionRegistryStateRecord["observedAt"],
          },
          outcome: "no-op" as const,
          stateRevision: this.readCurrentStateRevision(),
        };
      }

      const acceptedSecretTargets = new Set(
        observation.observations.flatMap((extension) =>
          extension.envDeclarations
            .filter((declaration) => declaration.secret)
            .map((declaration) => `${extension.extensionId}\0${declaration.name}`),
        ),
      );
      const invalidatedSecrets = this.listExtensionEnvSecrets().filter(
        (record) => !acceptedSecretTargets.has(`${record.extensionId}\0${record.envName}`),
      );
      for (const record of invalidatedSecrets) {
        this.insertExtensionEnvSecretCleanup(
          record.ref,
          record.revisionFingerprint,
          "removed",
          input.observedAt,
        );
        this.db
          .query(`DELETE FROM extension_env_secret WHERE extension_id = ? AND env_name = ?`)
          .run(record.extensionId, record.envName);
      }

      this.db.query(`DELETE FROM extension_env_declaration`).run();
      const insertDeclaration = this.db.query(
        `INSERT INTO extension_env_declaration
           (extension_id, env_name, required, secret, description, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const extension of observation.observations) {
        for (const declaration of extension.envDeclarations) {
          insertDeclaration.run(
            extension.extensionId,
            declaration.name,
            declaration.required ? 1 : 0,
            declaration.secret ? 1 : 0,
            declaration.description,
            input.observedAt,
          );
        }
      }

      this.db
        .query(
          `INSERT INTO extension_registry_observation
             (singleton_id, observation_json, observed_at)
           VALUES (1, ?, ?)
           ON CONFLICT(singleton_id) DO UPDATE SET
             observation_json = excluded.observation_json,
             observed_at = excluded.observed_at`,
        )
        .run(observationJson, input.observedAt);
      return {
        record: { observation, observedAt: input.observedAt },
        outcome: "committed" as const,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  readExtensionSourceBuildEvidence(): StructuredExtensionSourceBuildEvidenceBatchRecord | null {
    const batch = this.db
      .query(
        `SELECT registry_aggregate_fingerprint, observed_at
         FROM extension_source_build_evidence_batch
         WHERE singleton_id = 1`,
      )
      .get() as ExtensionSourceBuildEvidenceBatchRow | null;
    if (!batch) return null;
    const rows = this.db
      .query(
        `SELECT extension_id, registry_aggregate_fingerprint, observation_json, observed_at
         FROM extension_source_build_evidence
         WHERE registry_aggregate_fingerprint = ?
         ORDER BY extension_id`,
      )
      .all(batch.registry_aggregate_fingerprint) as ExtensionSourceBuildEvidenceRow[];
    return {
      registryAggregateFingerprint: batch.registry_aggregate_fingerprint,
      observations: rows.map((row) =>
        decodeStoredExtensionSourceBuildObservation(row.observation_json),
      ),
      observedAt: batch.observed_at as IsoDateTimeString,
    };
  }

  reconcileExtensionSourceBuildEvidence(
    input: ReconcileExtensionSourceBuildEvidenceInput,
  ): StructuredExtensionSourceBuildEvidenceReconcileResult {
    return this.db.transaction(() => {
      const registry = this.readExtensionRegistryObservation();
      if (
        !registry ||
        registry.observation.aggregateFingerprint !== input.registryAggregateFingerprint
      ) {
        throw new StateContractError({
          operation: "structured-session.reconcileExtensionSourceBuildEvidence",
          reason: "conflict",
          message:
            "Extension source/build evidence was observed against a stale registry fingerprint.",
        });
      }

      const observations = input.observations.map((observation) =>
        decodeExtensionSourceBuildObservationContract(observation),
      );
      const sortedIds = observations
        .map((observation) => observation.extensionId as string)
        .toSorted((left, right) => left.localeCompare(right));
      if (
        observations.some((observation, index) => observation.extensionId !== sortedIds[index]) ||
        new Set(sortedIds).size !== sortedIds.length
      ) {
        throw new StateContractError({
          operation: "structured-session.reconcileExtensionSourceBuildEvidence",
          reason: "invalid-input",
          message: "Extension source/build evidence must be a unique extension-id-sorted batch.",
        });
      }

      const registryById = new Map(
        registry.observation.observations.map((observation) => [
          observation.extensionId as string,
          observation,
        ]),
      );
      if (
        observations.length !== registryById.size ||
        observations.some((observation) => !registryById.has(observation.extensionId))
      ) {
        throw new StateContractError({
          operation: "structured-session.reconcileExtensionSourceBuildEvidence",
          reason: "invalid-input",
          message: "Extension source/build evidence must be complete for the current registry.",
        });
      }
      for (const observation of observations) {
        const registryObservation = registryById.get(observation.extensionId)!;
        if (observation.category !== registryObservation.category) {
          throw new StateContractError({
            operation: "structured-session.reconcileExtensionSourceBuildEvidence",
            reason: "invalid-input",
            message: `Extension source/build category does not match the registry for ${observation.extensionId}.`,
          });
        }
        if (observation.buildRequirement !== registryObservation.buildRequirement) {
          throw new StateContractError({
            operation: "structured-session.reconcileExtensionSourceBuildEvidence",
            reason: "invalid-input",
            message: `Extension source/build requirement does not match the registry for ${observation.extensionId}.`,
          });
        }
        if (
          observation.sourceStatus === "materialized" &&
          observation.sourceFingerprint !== registryObservation.sourceFingerprint
        ) {
          throw new StateContractError({
            operation: "structured-session.reconcileExtensionSourceBuildEvidence",
            reason: "invalid-input",
            message: `Extension source fingerprint does not match the registry for ${observation.extensionId}.`,
          });
        }
        if (
          observation.currentBuild &&
          (observation.currentBuild.extensionId !== observation.extensionId ||
            observation.currentBuild.interfaceKind !== registryObservation.interfaceKind ||
            observation.currentBuild.sourceFingerprint !== observation.sourceFingerprint)
        ) {
          throw new StateContractError({
            operation: "structured-session.reconcileExtensionSourceBuildEvidence",
            reason: "invalid-input",
            message: `Extension current build does not match current source authority for ${observation.extensionId}.`,
          });
        }
      }

      const currentRows = this.db
        .query(
          `SELECT extension_id, registry_aggregate_fingerprint, observation_json, observed_at
           FROM extension_source_build_evidence
           ORDER BY extension_id`,
        )
        .all() as ExtensionSourceBuildEvidenceRow[];
      const currentBatch = this.db
        .query(
          `SELECT registry_aggregate_fingerprint, observed_at
           FROM extension_source_build_evidence_batch
           WHERE singleton_id = 1`,
        )
        .get() as ExtensionSourceBuildEvidenceBatchRow | null;
      const nextById = new Map(
        observations.map((observation) => [
          observation.extensionId as string,
          JSON.stringify(observation),
        ]),
      );
      const currentById = new Map(
        currentRows.map((row) => [row.extension_id, row.observation_json]),
      );
      let changedExtensionIds = [...new Set([...currentById.keys(), ...nextById.keys()])]
        .filter((extensionId) => currentById.get(extensionId) !== nextById.get(extensionId))
        .toSorted((left, right) => left.localeCompare(right)) as ExtensionId[];
      if (
        currentBatch &&
        currentBatch.registry_aggregate_fingerprint !== input.registryAggregateFingerprint
      ) {
        changedExtensionIds = [...new Set([...currentById.keys(), ...nextById.keys()])].toSorted(
          (left, right) => left.localeCompare(right),
        ) as ExtensionId[];
      }
      if (
        currentBatch?.registry_aggregate_fingerprint === input.registryAggregateFingerprint &&
        changedExtensionIds.length === 0
      ) {
        return {
          changed: false,
          changedExtensionIds: [],
          stateRevision: this.readCurrentStateRevision(),
        };
      }

      const observedAt = input.observedAt;
      this.db.query(`DELETE FROM extension_source_build_evidence`).run();
      const insert = this.db.query(
        `INSERT INTO extension_source_build_evidence (
           extension_id, registry_aggregate_fingerprint, observation_json, observed_at
         ) VALUES (?, ?, ?, ?)`,
      );
      for (const observation of observations) {
        insert.run(
          observation.extensionId,
          input.registryAggregateFingerprint,
          nextById.get(observation.extensionId)!,
          observedAt,
        );
      }
      this.db
        .query(
          `INSERT INTO extension_source_build_evidence_batch (
             singleton_id, registry_aggregate_fingerprint, observed_at
           ) VALUES (1, ?, ?)
           ON CONFLICT(singleton_id) DO UPDATE SET
             registry_aggregate_fingerprint = excluded.registry_aggregate_fingerprint,
             observed_at = excluded.observed_at`,
        )
        .run(input.registryAggregateFingerprint, observedAt);
      return {
        changed: true,
        changedExtensionIds,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  reconcileExtensionEnvDeclarations(input: {
    declarations: readonly Omit<StructuredExtensionEnvDeclarationRecord, "updatedAt">[];
  }): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      const acceptedSecretTargets = new Set(
        input.declarations
          .filter((declaration) => declaration.secret)
          .map((declaration) => `${declaration.extensionId}\0${declaration.envName}`),
      );
      const invalidatedSecrets = this.listExtensionEnvSecrets().filter(
        (record) => !acceptedSecretTargets.has(`${record.extensionId}\0${record.envName}`),
      );
      for (const record of invalidatedSecrets) {
        this.insertExtensionEnvSecretCleanup(
          record.ref,
          record.revisionFingerprint,
          "removed",
          updatedAt,
        );
        this.db
          .query(`DELETE FROM extension_env_secret WHERE extension_id = ? AND env_name = ?`)
          .run(record.extensionId, record.envName);
      }
      this.db.query(`DELETE FROM extension_env_declaration`).run();
      const insert = this.db.query(
        `INSERT INTO extension_env_declaration
           (extension_id, env_name, required, secret, description, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const declaration of input.declarations) {
        insert.run(
          declaration.extensionId,
          declaration.envName,
          declaration.required ? 1 : 0,
          declaration.secret ? 1 : 0,
          declaration.description,
          updatedAt,
        );
      }
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  listExtensionEnvDeclarations(): StructuredExtensionEnvDeclarationRecord[] {
    return (
      this.db
        .query(`SELECT * FROM extension_env_declaration ORDER BY extension_id, env_name`)
        .all() as ExtensionEnvDeclarationRow[]
    ).map(extensionEnvDeclarationRecord);
  }

  listExtensionEnvSecrets(): StructuredExtensionEnvSecretRecord[] {
    return (
      this.db
        .query(`SELECT * FROM extension_env_secret ORDER BY extension_id, env_name`)
        .all() as ExtensionEnvSecretRow[]
    ).map(extensionEnvSecretRecord);
  }

  listExtensionEnvSecretCleanupRecords(): StructuredExtensionEnvSecretCleanupRecord[] {
    return (
      this.db
        .query(`SELECT * FROM extension_env_secret_cleanup ORDER BY created_at, material_id`)
        .all() as ExtensionEnvSecretCleanupRow[]
    ).map((row) => ({
      ref: {
        kind: "extension-env" as const,
        extensionId: row.extension_id as ExtensionId,
        envName: row.env_name as ExtensionEnvSecretRef["envName"],
        materialId: row.material_id as ExtensionEnvSecretRef["materialId"],
      },
      revisionFingerprint: row.revision_fingerprint,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  readExtensionEnvSecretCommandState(input: {
    operation: "set" | "remove";
    clientRequestId?: string;
    extensionId: string;
    envName: string;
  }): {
    declaration: StructuredExtensionEnvDeclarationRecord | null;
    current: StructuredExtensionEnvSecretRecord | null;
    receipt: StructuredExtensionEnvSecretReceiptRecord | null;
  } {
    const declaration = this.db
      .query(`SELECT * FROM extension_env_declaration WHERE extension_id = ? AND env_name = ?`)
      .get(input.extensionId, input.envName) as ExtensionEnvDeclarationRow | null;
    const current = this.db
      .query(`SELECT * FROM extension_env_secret WHERE extension_id = ? AND env_name = ?`)
      .get(input.extensionId, input.envName) as ExtensionEnvSecretRow | null;
    const receipt = input.clientRequestId
      ? (this.db
          .query(
            `SELECT * FROM extension_env_secret_receipt
             WHERE client_request_id = ?`,
          )
          .get(input.clientRequestId) as ExtensionEnvSecretReceiptRow | null)
      : null;
    if (
      receipt &&
      (receipt.operation !== input.operation ||
        receipt.extension_id !== input.extensionId ||
        receipt.env_name !== input.envName)
    ) {
      throw new StateContractError({
        operation: `structured-session.extension-env-secret.${input.operation}`,
        reason: "conflict",
        message:
          "The client request id already identifies a different extension env secret command.",
      });
    }
    return {
      declaration: declaration ? extensionEnvDeclarationRecord(declaration) : null,
      current: current ? extensionEnvSecretRecord(current) : null,
      receipt: receipt ? extensionEnvSecretReceiptRecord(receipt) : null,
    };
  }

  commitExtensionEnvSecretSet(input: {
    command: SetExtensionEnvSecretCommandInput;
    ref: ExtensionEnvSecretRef;
    revisionFingerprint: string;
    previous: StructuredExtensionEnvSecretRecord | null;
  }): StructuredExtensionEnvSecretReceiptRecord {
    const committedAt = this.now();
    return this.db.transaction(() => {
      const current = this.db
        .query(`SELECT * FROM extension_env_secret WHERE extension_id = ? AND env_name = ?`)
        .get(input.command.extensionId, input.command.envName) as ExtensionEnvSecretRow | null;
      if ((current?.material_id ?? null) !== (input.previous?.ref.materialId ?? null)) {
        throw new StateContractError({
          operation: "structured-session.extension-env-secret.set",
          reason: "stale-state",
          message: "The extension env secret changed while its replacement was being committed.",
        });
      }
      this.db
        .query(
          `INSERT INTO extension_env_secret
             (extension_id, env_name, material_id, revision_fingerprint, status, updated_at)
           VALUES (?, ?, ?, ?, 'configured', ?)
           ON CONFLICT(extension_id, env_name) DO UPDATE SET
             material_id = excluded.material_id,
             revision_fingerprint = excluded.revision_fingerprint,
             status = excluded.status,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.command.extensionId,
          input.command.envName,
          input.ref.materialId,
          input.revisionFingerprint,
          committedAt,
        );
      if (input.previous) {
        this.insertExtensionEnvSecretCleanup(
          input.previous.ref,
          input.previous.revisionFingerprint,
          "replaced",
          committedAt,
        );
      }
      const stateRevision = this.bumpStateRevision();
      const receipt = {
        operation: "set" as const,
        clientRequestId: input.command.clientSubmission?.clientRequestId ?? "",
        extensionId: input.command.extensionId,
        envName: input.command.envName,
        configured: true,
        committedAt,
        stateRevision,
      };
      if (receipt.clientRequestId) this.insertExtensionEnvSecretReceipt(receipt);
      return receipt;
    })();
  }

  commitExtensionEnvSecretRemove(input: {
    command: RemoveExtensionEnvSecretCommandInput;
    previous: StructuredExtensionEnvSecretRecord;
  }): StructuredExtensionEnvSecretReceiptRecord {
    const committedAt = this.now();
    return this.db.transaction(() => {
      if (input.previous) {
        const result = this.db
          .query(
            `DELETE FROM extension_env_secret
             WHERE extension_id = ? AND env_name = ? AND material_id = ?`,
          )
          .run(input.command.extensionId, input.command.envName, input.previous.ref.materialId);
        if (result.changes !== 1) {
          throw new StateContractError({
            operation: "structured-session.extension-env-secret.remove",
            reason: "stale-state",
            message: "The extension env secret changed while its removal was being committed.",
          });
        }
        this.insertExtensionEnvSecretCleanup(
          input.previous.ref,
          input.previous.revisionFingerprint,
          "removed",
          committedAt,
        );
      }
      const stateRevision = this.bumpStateRevision();
      const receipt = {
        operation: "remove" as const,
        clientRequestId: input.command.clientSubmission?.clientRequestId ?? "",
        extensionId: input.command.extensionId,
        envName: input.command.envName,
        configured: false,
        committedAt,
        stateRevision,
      };
      if (receipt.clientRequestId) this.insertExtensionEnvSecretReceipt(receipt);
      return receipt;
    })();
  }

  completeExtensionEnvSecretCleanup(ref: ExtensionEnvSecretRef): void {
    this.db
      .query(
        `DELETE FROM extension_env_secret_cleanup
         WHERE extension_id = ? AND env_name = ? AND material_id = ?`,
      )
      .run(ref.extensionId, ref.envName, ref.materialId);
  }

  recordExtensionEnvSecretOrphanCleanup(input: {
    ref: ExtensionEnvSecretRef;
    revisionFingerprint: string;
  }): void {
    this.db.transaction(() => {
      this.insertExtensionEnvSecretCleanup(
        input.ref,
        input.revisionFingerprint,
        "orphaned",
        this.now(),
      );
    })();
  }

  private insertExtensionEnvSecretCleanup(
    ref: ExtensionEnvSecretRef,
    revisionFingerprint: string,
    reason: "replaced" | "removed" | "orphaned",
    createdAt: string,
  ): void {
    this.db
      .query(
        `INSERT INTO extension_env_secret_cleanup
           (extension_id, env_name, material_id, revision_fingerprint, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(extension_id, env_name, material_id) DO NOTHING`,
      )
      .run(ref.extensionId, ref.envName, ref.materialId, revisionFingerprint, reason, createdAt);
  }

  private insertExtensionEnvSecretReceipt(
    receipt: StructuredExtensionEnvSecretReceiptRecord,
  ): void {
    this.db
      .query(
        `INSERT INTO extension_env_secret_receipt
           (operation, client_request_id, extension_id, env_name, configured, committed_at, state_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.operation,
        receipt.clientRequestId,
        receipt.extensionId,
        receipt.envName,
        receipt.configured ? 1 : 0,
        receipt.committedAt,
        receipt.stateRevision,
      );
  }

  hasAgentProfileRows(): boolean {
    const row = this.db.query(`SELECT 1 AS found FROM agent_profile LIMIT 1`).get() as
      | { found: number }
      | undefined;
    return Boolean(row);
  }

  listAgentProfiles(): StructuredAgentProfileRecord[] {
    return (
      this.db
        .query(`SELECT * FROM agent_profile ORDER BY actor ASC, position ASC, profile_id ASC`)
        .all() as AgentProfileRow[]
    ).map((row) => this.mapAgentProfile(row));
  }

  listAgentActorExtensionDefaults(): StructuredAgentActorExtensionDefaultsRecord[] {
    return (
      this.db
        .query(`SELECT * FROM agent_actor_extension_defaults ORDER BY actor ASC`)
        .all() as AgentActorExtensionDefaultsRow[]
    ).map((row) => this.mapAgentActorExtensionDefaults(row));
  }

  setAgentActorExtensionDefaults(
    input: StructuredAgentActorExtensionDefaultsInput,
  ): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.writeAgentActorExtensionDefaults({
        actor: input.actor,
        extensionUsage: { ...input.extensionUsage },
        extensionOrder: [...input.extensionOrder],
        updatedAt,
      });
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  updateOrchestratorProfile(
    input: UpdateOrchestratorProfileCommandInput,
  ): StructuredMutationCommitRecord {
    return this.upsertAgentProfileCommand(
      "orchestrator",
      input.profile,
      input.profile.followComposer,
    );
  }

  updateThreadHandlerProfile(
    input: UpdateThreadHandlerProfileCommandInput,
  ): StructuredMutationCommitRecord {
    return this.upsertAgentProfileCommand("handler", input.profile, false);
  }

  deleteOrchestratorProfile(
    input: DeleteOrchestratorProfileCommandInput,
  ): StructuredMutationCommitRecord {
    if (input.profileId === "default-orchestrator") {
      throw new StateContractError({
        operation: "structured-session.deleteOrchestratorProfile",
        reason: "invalid-input",
        message: "The default orchestrator profile is locked and cannot be deleted.",
      });
    }
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(`DELETE FROM agent_profile WHERE actor = 'orchestrator' AND profile_id = ?`)
        .run(input.profileId);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  reorderOrchestratorProfiles(
    input: ReorderOrchestratorProfilesCommandInput,
  ): StructuredMutationCommitRecord {
    const currentProfileIds = (
      this.db
        .query(
          `SELECT profile_id
           FROM agent_profile
           WHERE actor = 'orchestrator'
           ORDER BY position ASC, profile_id ASC`,
        )
        .all() as { profile_id: string }[]
    ).map((row) => row.profile_id);
    const requestedProfileIds = [...input.profileIds];
    const requestedProfileIdSet = new Set<string>(requestedProfileIds);
    if (
      requestedProfileIdSet.size !== requestedProfileIds.length ||
      requestedProfileIds.length !== currentProfileIds.length ||
      currentProfileIds.some((profileId) => !requestedProfileIdSet.has(profileId))
    ) {
      throw new StateContractError({
        operation: "structured-session.reorderOrchestratorProfiles",
        reason: "invalid-input",
        message: "Orchestrator profile reorder must contain every configured profile exactly once.",
      });
    }
    if (
      currentProfileIds.includes("default-orchestrator") &&
      requestedProfileIds[0] !== "default-orchestrator"
    ) {
      throw new StateContractError({
        operation: "structured-session.reorderOrchestratorProfiles",
        reason: "invalid-input",
        message: "The default orchestrator profile is locked in the first position.",
      });
    }
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      input.profileIds.forEach((profileId, index) => {
        this.db
          .query(
            `UPDATE agent_profile
             SET position = ?, updated_at = ?
             WHERE actor = 'orchestrator' AND profile_id = ?`,
          )
          .run(index, updatedAt, profileId);
      });
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  setProfileExtensionUsage(
    input: SetProfileExtensionUsageCommandInput,
  ): StructuredMutationCommitRecord {
    if (input.actor === "orchestrator") {
      const actorDefault = this.findAgentActorExtensionDefaults("orchestrator");
      return this.updateAgentProfileUsage("orchestrator", input.profileId, {
        [input.extensionId]:
          actorDefault?.extensionUsage[input.extensionId] === input.usage ? null : input.usage,
      });
    }
    return this.updateAgentProfileUsage("handler", input.profileId, {
      [input.extensionId]: input.usage,
    });
  }

  readExtensionUsageChange(changeId: ExtensionUsageChangeId): ExtensionUsageChangeRecord | null {
    const row = this.db
      .query(`SELECT * FROM extension_usage_change WHERE change_id = ?`)
      .get(changeId) as Record<string, unknown> | undefined;
    return row ? this.mapExtensionUsageChange(row) : null;
  }

  resolveExtensionUsageTarget(agentProfile: string): SetExtensionUsageInput["target"] {
    const alias = agentProfile === "threadHandler" ? "thread-handler" : agentProfile;
    const profile = this.db
      .query(
        `SELECT actor, profile_id FROM agent_profile WHERE profile_id = ? ORDER BY CASE actor WHEN 'orchestrator' THEN 0 ELSE 1 END LIMIT 1`,
      )
      .get(alias) as { actor: "orchestrator" | "handler"; profile_id: string } | undefined;
    if (profile)
      return {
        actor: profile.actor,
        agentProfile: profile.actor === "handler" ? "threadHandler" : profile.profile_id,
        profileId: profile.profile_id,
      };
    const workflow = this.db
      .query(
        `SELECT source_id FROM workflow_agent_source_index WHERE source_id = ? AND deleted_at IS NULL`,
      )
      .get(agentProfile) as { source_id: string } | undefined;
    if (workflow)
      return {
        actor: "workflow-task",
        agentProfile: workflow.source_id,
        profileId: workflow.source_id,
      };
    throw new StateContractError({
      operation: "structured-session.resolveExtensionUsageTarget",
      reason: "not-found",
      message: "Agent profile was not found.",
    });
  }

  setExtensionUsage(input: SetExtensionUsageInput): ExtensionUsageChangeRecord {
    return this.db.transaction(() => {
      const replay = this.db
        .query(`SELECT * FROM extension_usage_change WHERE client_request_id = ?`)
        .get(input.clientRequestId) as Record<string, unknown> | undefined;
      if (replay) {
        const existing = this.mapExtensionUsageChange(replay);
        if (
          existing.extensionId !== input.extensionId ||
          existing.target.actor !== input.target.actor ||
          existing.target.agentProfile !== input.target.agentProfile ||
          existing.target.profileId !== input.target.profileId ||
          existing.after !== input.usage ||
          existing.revertedChangeId !== null
        ) {
          throw new StateContractError({
            operation: "structured-session.setExtensionUsage",
            reason: "conflict",
            message: "Client request id was already used for a different extension usage mutation.",
          });
        }
        return existing;
      }
      this.assertExtensionUsageRevision(input.expectedStateRevision, "setExtensionUsage");
      const before = this.readExplicitExtensionUsage(input.target, input.extensionId);
      this.writeExplicitExtensionUsage(input.target, input.extensionId, input.usage);
      const stateRevision = this.bumpStateRevision();
      const createdAt = this.now();
      const changeId =
        `extension-usage-change:${String(input.clientRequestId)}` as ExtensionUsageChangeId;
      this.db
        .query(
          `INSERT INTO extension_usage_change
          (change_id, client_request_id, extension_id, actor, agent_profile, profile_id, before_usage, after_usage,
           reverted_change_id, created_at, state_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          changeId,
          input.clientRequestId,
          input.extensionId,
          input.target.actor,
          input.target.agentProfile,
          input.target.profileId,
          before,
          input.usage,
          createdAt,
          stateRevision,
        );
      return this.readExtensionUsageChange(changeId)!;
    })();
  }

  revertExtensionUsage(input: RevertExtensionUsageInput): ExtensionUsageChangeRecord {
    return this.db.transaction(() => {
      const replay = this.db
        .query(`SELECT * FROM extension_usage_change WHERE client_request_id = ?`)
        .get(input.clientRequestId) as Record<string, unknown> | undefined;
      if (replay) {
        const existing = this.mapExtensionUsageChange(replay);
        if (existing.revertedChangeId !== input.changeId) {
          throw new StateContractError({
            operation: "structured-session.revertExtensionUsage",
            reason: "conflict",
            message: "Client request id was already used for a different extension usage revert.",
          });
        }
        return existing;
      }
      this.assertExtensionUsageRevision(input.expectedStateRevision, "revertExtensionUsage");
      const original = this.readExtensionUsageChange(input.changeId);
      if (!original)
        throw new StateContractError({
          operation: "structured-session.revertExtensionUsage",
          reason: "not-found",
          message: "Extension usage change was not found.",
        });
      const current = this.readExplicitExtensionUsage(original.target, original.extensionId);
      if (current !== original.after)
        throw new StateContractError({
          operation: "structured-session.revertExtensionUsage",
          reason: "conflict",
          message: "Extension usage changed after the requested change was recorded.",
        });
      this.writeExplicitExtensionUsage(original.target, original.extensionId, original.before);
      const stateRevision = this.bumpStateRevision();
      const createdAt = this.now();
      const changeId =
        `extension-usage-change:${String(input.clientRequestId)}` as ExtensionUsageChangeId;
      this.db
        .query(
          `INSERT INTO extension_usage_change
          (change_id, client_request_id, extension_id, actor, agent_profile, profile_id, before_usage, after_usage,
           reverted_change_id, created_at, state_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          changeId,
          input.clientRequestId,
          original.extensionId,
          original.target.actor,
          original.target.agentProfile,
          original.target.profileId,
          current,
          original.before,
          original.changeId,
          createdAt,
          stateRevision,
        );
      return this.readExtensionUsageChange(changeId)!;
    })();
  }

  private assertExtensionUsageRevision(
    expected: SetExtensionUsageInput["expectedStateRevision"],
    operation: string,
  ): void {
    if (expected !== undefined && expected !== this.readStateRevision()) {
      throw new StateContractError({
        operation: `structured-session.${operation}`,
        reason: "conflict",
        message: "Extension usage state revision is stale.",
      });
    }
  }

  private readExplicitExtensionUsage(
    target: SetExtensionUsageInput["target"],
    extensionId: string,
  ): ExtensionUsageState | null {
    if (target.actor === "workflow-task") {
      const row = this.db
        .query(
          `SELECT usage FROM workflow_agent_extension_usage WHERE profile_id = ? AND extension_id = ?`,
        )
        .get(target.profileId, extensionId) as { usage: ExtensionUsageState } | undefined;
      return row?.usage ?? null;
    }
    const row = this.db
      .query(`SELECT extension_usage_json FROM agent_profile WHERE actor = ? AND profile_id = ?`)
      .get(target.actor, target.profileId) as { extension_usage_json: string } | undefined;
    if (!row)
      throw new StateContractError({
        operation: "structured-session.extensionUsage",
        reason: "not-found",
        message: "Agent profile was not found.",
      });
    return (
      (fromJson<Record<string, ExtensionUsageState>>(row.extension_usage_json) ?? {})[
        extensionId
      ] ?? null
    );
  }

  private writeExplicitExtensionUsage(
    target: SetExtensionUsageInput["target"],
    extensionId: string,
    usage: ExtensionUsageState | null,
  ): void {
    if (target.actor === "workflow-task") {
      if (
        !this.db
          .query(
            `SELECT 1 AS found FROM workflow_agent_source_index WHERE source_id = ? AND deleted_at IS NULL`,
          )
          .get(target.profileId)
      )
        throw new StateContractError({
          operation: "structured-session.extensionUsage",
          reason: "not-found",
          message: "Workflow task-agent profile was not found.",
        });
      if (usage === null)
        this.db
          .query(
            `DELETE FROM workflow_agent_extension_usage WHERE profile_id = ? AND extension_id = ?`,
          )
          .run(target.profileId, extensionId);
      else
        this.db
          .query(
            `INSERT INTO workflow_agent_extension_usage (profile_id, extension_id, usage, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, extension_id) DO UPDATE SET usage = excluded.usage, updated_at = excluded.updated_at`,
          )
          .run(target.profileId, extensionId, usage, this.now());
      return;
    }
    const row = this.db
      .query(`SELECT extension_usage_json FROM agent_profile WHERE actor = ? AND profile_id = ?`)
      .get(target.actor, target.profileId) as { extension_usage_json: string } | undefined;
    if (!row)
      throw new StateContractError({
        operation: "structured-session.extensionUsage",
        reason: "not-found",
        message: "Agent profile was not found.",
      });
    const values = fromJson<Record<string, ExtensionUsageState>>(row.extension_usage_json) ?? {};
    if (usage === null) delete values[extensionId];
    else values[extensionId] = usage;
    this.db
      .query(
        `UPDATE agent_profile SET extension_usage_json = ?, updated_at = ? WHERE actor = ? AND profile_id = ?`,
      )
      .run(JSON.stringify(values), this.now(), target.actor, target.profileId);
  }

  private mapExtensionUsageChange(row: Record<string, unknown>): ExtensionUsageChangeRecord {
    return {
      changeId: row.change_id as ExtensionUsageChangeId,
      clientRequestId: row.client_request_id as ExtensionUsageChangeRecord["clientRequestId"],
      extensionId: row.extension_id as ExtensionUsageChangeRecord["extensionId"],
      target: {
        actor: row.actor as ExtensionUsageChangeRecord["target"]["actor"],
        agentProfile: String(row.agent_profile),
        profileId: String(row.profile_id),
      },
      before: (row.before_usage as ExtensionUsageState | null) ?? null,
      after: (row.after_usage as ExtensionUsageState | null) ?? null,
      revertedChangeId: (row.reverted_change_id as ExtensionUsageChangeId | null) ?? null,
      createdAt: String(row.created_at),
      stateRevision: row.state_revision as ExtensionUsageChangeRecord["stateRevision"],
    };
  }

  promoteProfileExtensionDefault(
    input: PromoteProfileExtensionDefaultCommandInput,
  ): StructuredMutationCommitRecord {
    const current = this.findAgentActorExtensionDefaults(input.actor);
    return this.setAgentActorExtensionDefaults({
      actor: input.actor,
      extensionUsage: {
        ...current?.extensionUsage,
        [input.extensionId]: input.usage,
      },
      extensionOrder: current?.extensionOrder ?? [],
    });
  }

  resetActorExtensionDefaults(input: {
    actor: ResetActorExtensionDefaultsCommandInput["actor"];
    reset: ResetActorExtensionDefaultsCommandInput["reset"];
  }): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      const current = this.findAgentActorExtensionDefaults(input.actor);
      this.writeAgentActorExtensionDefaults({
        actor: input.actor,
        extensionUsage:
          input.reset === "usage" || input.reset === "usage-and-order"
            ? {}
            : (current?.extensionUsage ?? {}),
        extensionOrder:
          input.reset === "order" || input.reset === "usage-and-order"
            ? []
            : (current?.extensionOrder ?? []),
        updatedAt,
      });
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  setExternalInstructionActorUsage(
    input: SetExternalInstructionActorUsageCommandInput,
  ): StructuredMutationCommitRecord {
    const usage = input.usage === "disabled" ? "unavailable" : input.usage;
    return this.updateAgentProfileUsage(
      input.actor === "handler" ? "handler" : "orchestrator",
      input.profileId,
      {
        [input.sourceId]: usage,
      },
    );
  }

  readExternalInstructionsProjection(input: {
    workspaceId: string;
  }): ExternalInstructionObservationProjection {
    this.assertExternalInstructionWorkspace(
      input.workspaceId,
      "structured-session.readExternalInstructionsProjection",
    );
    const row = this.db
      .query(`SELECT * FROM external_instruction_projection WHERE id = 1`)
      .get() as ExternalInstructionProjectionRow | undefined;
    const sources = row
      ? (fromJson<ExternalInstructionProjectedSource[]>(row.sources_json) ?? [])
      : [];
    const diagnostics = row
      ? (fromJson<ExternalInstructionObservationProjection["diagnostics"]>(row.diagnostics_json) ??
        [])
      : [];
    return {
      workspaceId: input.workspaceId as ExternalInstructionObservationProjection["workspaceId"],
      sources,
      diagnostics,
      observedAt: (row?.observed_at ??
        null) as ExternalInstructionObservationProjection["observedAt"],
      revision: (row?.state_revision ?? 0) as StateRevision,
    };
  }

  reconcileExternalInstructions(
    input: ReconcileExternalInstructionsInput,
  ): ReconcileExternalInstructionsResult {
    this.assertExternalInstructionWorkspace(
      input.workspaceId,
      "structured-session.reconcileExternalInstructions",
    );
    const contentBySourceId = new Map<string, string>();
    for (const content of input.scan.contents) {
      if (contentBySourceId.has(content.sourceId)) {
        throw new StateContractError({
          operation: "structured-session.reconcileExternalInstructions",
          reason: "invalid-input",
          message: `External instruction scan contains duplicate content for ${content.sourceId}.`,
        });
      }
      contentBySourceId.set(content.sourceId, content.content);
    }
    const seenSourceIds = new Set<string>();
    const sources = input.scan.sources.map((observation): ExternalInstructionProjectedSource => {
      if (seenSourceIds.has(observation.id)) {
        throw new StateContractError({
          operation: "structured-session.reconcileExternalInstructions",
          reason: "invalid-input",
          message: `External instruction scan contains duplicate source ${observation.id}.`,
        });
      }
      seenSourceIds.add(observation.id);
      const content = contentBySourceId.get(observation.id) ?? null;
      contentBySourceId.delete(observation.id);
      if (observation.readStatus.status === "readable" && content === null) {
        throw new StateContractError({
          operation: "structured-session.reconcileExternalInstructions",
          reason: "invalid-input",
          message: `Readable external instruction ${observation.id} is missing content.`,
        });
      }
      if (observation.readStatus.status === "unreadable" && content !== null) {
        throw new StateContractError({
          operation: "structured-session.reconcileExternalInstructions",
          reason: "invalid-input",
          message: `Unreadable external instruction ${observation.id} cannot include content.`,
        });
      }
      return {
        id: observation.id,
        source: observation.source,
        fileName: observation.fileName,
        title: observation.title,
        canonicalPath: observation.canonicalPath,
        sourceGroup: observation.sourceGroup,
        ...(observation.rootId === undefined ? {} : { rootId: observation.rootId }),
        ...(observation.rootLabel === undefined ? {} : { rootLabel: observation.rootLabel }),
        order: observation.order,
        defaultControl: {
          enabled: observation.enabled,
          eligibleActors: [...observation.eligibleActors],
        },
        readOnly: true,
        contentHash: observation.contentHash,
        fingerprint: observation.fingerprint,
        readStatus: observation.readStatus,
        content,
      };
    });
    if (contentBySourceId.size > 0) {
      throw new StateContractError({
        operation: "structured-session.reconcileExternalInstructions",
        reason: "invalid-input",
        message: `External instruction scan contains content for an unknown source: ${contentBySourceId.keys().next().value}.`,
      });
    }
    const sourcesJson = JSON.stringify(sources);
    const diagnosticsJson = JSON.stringify(input.scan.diagnostics);
    const existing = this.db
      .query(`SELECT * FROM external_instruction_projection WHERE id = 1`)
      .get() as ExternalInstructionProjectionRow | undefined;
    if (
      existing?.workspace_id === input.workspaceId &&
      existing.sources_json === sourcesJson &&
      existing.diagnostics_json === diagnosticsJson
    ) {
      return {
        changed: false,
        projection: this.readExternalInstructionsProjection({ workspaceId: input.workspaceId }),
      };
    }

    const observedAt = this.now();
    this.db.transaction(() => {
      const stateRevision = this.bumpStateRevision();
      this.db
        .query(
          `INSERT INTO external_instruction_projection (
             id, workspace_id, sources_json, diagnostics_json, observed_at, state_revision
           ) VALUES (1, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             workspace_id = excluded.workspace_id,
             sources_json = excluded.sources_json,
             diagnostics_json = excluded.diagnostics_json,
             observed_at = excluded.observed_at,
             state_revision = excluded.state_revision`,
        )
        .run(input.workspaceId, sourcesJson, diagnosticsJson, observedAt, stateRevision);
    })();
    return {
      changed: true,
      projection: this.readExternalInstructionsProjection({ workspaceId: input.workspaceId }),
    };
  }

  hasExtensionEnvOverrideRows(): boolean {
    const row = this.db.query(`SELECT 1 AS found FROM extension_env_override LIMIT 1`).get() as
      | { found: number }
      | undefined;
    return Boolean(row);
  }

  listExtensionEnvOverrides(): StructuredExtensionEnvOverrideRecord[] {
    return (
      this.db
        .query(`SELECT * FROM extension_env_override ORDER BY extension_id ASC, env_name ASC`)
        .all() as ExtensionEnvOverrideRow[]
    ).map((row) => ({
      extensionId: row.extension_id,
      envName: row.env_name,
      value: row.value,
      updatedAt: row.updated_at,
    }));
  }

  setExtensionEnvOverride(
    input: SetExtensionEnvOverrideCommandInput,
  ): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO extension_env_override (extension_id, env_name, value, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(extension_id, env_name) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at`,
        )
        .run(input.extensionId, input.envName, input.value, updatedAt);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  removeExtensionEnvOverride(
    input: RemoveExtensionEnvOverrideCommandInput,
  ): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(`DELETE FROM extension_env_override WHERE extension_id = ? AND env_name = ?`)
        .run(input.extensionId, input.envName);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  hasSnippetRows(workspaceId: string): boolean {
    const row = this.db
      .query(
        `SELECT 1 AS found FROM snippet
         WHERE deleted_at IS NULL AND workspace_id = ?
         LIMIT 1`,
      )
      .get(workspaceId) as { found: number } | undefined;
    return Boolean(row);
  }

  listSnippets(input: { workspaceId: string }): StructuredSnippetRecord[] {
    return (
      this.db
        .query(
          `SELECT * FROM snippet
         WHERE deleted_at IS NULL AND workspace_id = ?
         ORDER BY source ASC, title ASC, snippet_id ASC`,
        )
        .all(input.workspaceId) as SnippetRow[]
    ).map((row) => this.mapSnippet(row));
  }

  createManagedSnippet(input: CreateManagedSnippetCommandInput): StructuredSnippetRecord & {
    stateRevision: StateRevision;
  } {
    const operation = "structured-session.createManagedSnippet";
    this.assertSnippetWorkspace(input.workspaceId, operation);
    const title = normalizeManagedSnippetTitle(input.title, operation);
    const metadata = decodeSnippetMetadataInput(input.metadata, operation);
    const now = this.now();
    const snippetId = this.createId("snippet");
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO snippet (
             snippet_id, workspace_id, source, title, body, metadata_json,
             enabled, path, created_at, updated_at, deleted_at
           ) VALUES (?, ?, 'svvy', ?, ?, ?, ?, NULL, ?, ?, NULL)`,
        )
        .run(
          snippetId,
          input.workspaceId,
          title,
          input.body,
          JSON.stringify(metadata),
          input.enabled ? 1 : 0,
          now,
          now,
        );
      return this.bumpStateRevision();
    })();
    return {
      ...this.mustFindSnippet(input.workspaceId, snippetId, operation),
      stateRevision,
    };
  }

  updateManagedSnippet(input: UpdateManagedSnippetCommandInput): StructuredMutationCommitRecord {
    const operation = "structured-session.updateManagedSnippet";
    this.assertSnippetWorkspace(input.workspaceId, operation);
    return this.db.transaction(() => {
      const current = this.mustFindManagedSnippet(input.workspaceId, input.snippetId, operation);
      const title =
        input.patch.title === undefined
          ? current.title
          : normalizeManagedSnippetTitle(input.patch.title, operation);
      const metadata =
        input.patch.metadata === undefined
          ? current.metadata
          : decodeSnippetMetadataInput(input.patch.metadata, operation);
      const updatedAt = this.now();
      const updated = this.db
        .query(
          `UPDATE snippet
           SET title = ?, body = ?, metadata_json = ?, enabled = ?, updated_at = ?
           WHERE snippet_id = ? AND workspace_id = ? AND source = 'svvy' AND deleted_at IS NULL`,
        )
        .run(
          title,
          input.patch.body ?? current.body,
          JSON.stringify(metadata),
          (input.patch.enabled ?? current.enabled) ? 1 : 0,
          updatedAt,
          input.snippetId,
          input.workspaceId,
        );
      if (updated.changes !== 1) {
        throw snippetNotFoundError(operation, input.workspaceId, input.snippetId, true);
      }
      return { updatedAt, stateRevision: this.bumpStateRevision() };
    })();
  }

  deleteManagedSnippet(input: DeleteManagedSnippetCommandInput): StructuredMutationCommitRecord {
    const operation = "structured-session.deleteManagedSnippet";
    this.assertSnippetWorkspace(input.workspaceId, operation);
    return this.db.transaction(() => {
      this.mustFindManagedSnippet(input.workspaceId, input.snippetId, operation);
      const updatedAt = this.now();
      const deleted = this.db
        .query(
          `UPDATE snippet
           SET deleted_at = ?, updated_at = ?
           WHERE snippet_id = ? AND workspace_id = ? AND source = 'svvy' AND deleted_at IS NULL`,
        )
        .run(updatedAt, updatedAt, input.snippetId, input.workspaceId);
      if (deleted.changes !== 1) {
        throw snippetNotFoundError(operation, input.workspaceId, input.snippetId, true);
      }
      return { updatedAt, stateRevision: this.bumpStateRevision() };
    })();
  }

  setSnippetEnabled(input: SetSnippetEnabledCommandInput): StructuredMutationCommitRecord {
    const operation = "structured-session.setSnippetEnabled";
    this.assertSnippetWorkspace(input.workspaceId, operation);
    return this.db.transaction(() => {
      this.mustFindSnippet(input.workspaceId, input.snippetId, operation);
      const updatedAt = this.now();
      const updated = this.db
        .query(
          `UPDATE snippet
           SET enabled = ?, updated_at = ?
           WHERE snippet_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        )
        .run(input.enabled ? 1 : 0, updatedAt, input.snippetId, input.workspaceId);
      if (updated.changes !== 1) {
        throw snippetNotFoundError(operation, input.workspaceId, input.snippetId, false);
      }
      return { updatedAt, stateRevision: this.bumpStateRevision() };
    })();
  }

  acquireWorkspace(input: AcquireWorkspaceInput): AcquireWorkspaceResult {
    const requestedCwd = resolve(input.cwd);
    if (resolve(this.workspace.cwd) !== requestedCwd) {
      throw new Error(
        `Workspace cwd ${input.cwd} does not match scoped state workspace ${this.workspace.cwd}.`,
      );
    }
    return this.acquireScopedWorkspaceOwner({
      ownerId: input.owner.ownerId,
      ownerKind: input.owner.kind,
      openReason: input.openReason,
      kind: "user",
    });
  }

  acquireDefaultWorkspace(input: AcquireDefaultWorkspaceInput): AcquireWorkspaceResult {
    return this.acquireScopedWorkspaceOwner({
      ownerId: input.owner.ownerId,
      ownerKind: input.owner.kind,
      openReason: input.openReason,
      kind: "default",
    });
  }

  releaseWorkspace(input: ReleaseWorkspaceInput): ReleaseWorkspaceResult {
    if (input.workspaceId !== this.workspace.id) {
      throw new Error(`Workspace ${input.workspaceId} is not managed by this state store.`);
    }
    const result = this.db.transaction(() => {
      this.db
        .query(
          `DELETE FROM workspace_runtime_owner
           WHERE workspace_id = ? AND owner_id = ? AND owner_kind = ?`,
        )
        .run(this.workspace.id, input.owner.ownerId, input.owner.kind);
      const remainingOwners = this.countWorkspaceRuntimeOwners();
      this.bumpStateRevision();
      return remainingOwners;
    })();
    return {
      workspaceId: this.workspace.id as ReleaseWorkspaceResult["workspaceId"],
      released: true,
      remainingOwners: result,
      lifecycle: result > 0 ? "active" : input.releaseReason === "shutdown" ? "disposed" : "idle",
    };
  }

  createOrchestratorSurface(input: CreateOrchestratorSurfaceInput): CreateSurfaceResult {
    if (input.workspaceId !== this.workspace.id) {
      throw new Error(`Workspace ${input.workspaceId} is not managed by this state store.`);
    }
    const timestamp = this.now();
    const sessionId = this.createId("session");
    const title = input.title?.trim() || "New orchestrator";
    const profileId = input.profileId ?? ("default-orchestrator" as AgentProfileId);
    const profile = this.findAgentProfileRow("orchestrator", profileId);
    if (!profile || !profile.provider_id || !profile.model_id) {
      throw new StateContractError({
        operation: "structured-session.createOrchestratorSurface",
        reason: "not-found",
        message: `Orchestrator profile ${profileId} does not have complete prompt defaults.`,
      });
    }
    const reasoning = fromJson<{ effort?: unknown }>(profile.reasoning_json);
    const reasoningEffort = typeof reasoning?.effort === "string" ? reasoning.effort : "medium";
    const stateRevision = this.db.transaction(() => {
      this.upsertPiSession({
        sessionId,
        title,
        provider: profile.provider_id,
        model: profile.model_id,
        reasoningEffort,
        orchestratorAgentProfileId: profileId,
        messageCount: 0,
        status: "idle",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.upsertSurfaceLifecycle({
        surfacePiSessionId: sessionId,
        sessionId,
        surfaceKind: "orchestrator",
        threadId: null,
        workflowTaskAttemptId: null,
        status: "open",
        openedAt: timestamp,
        closedAt: null,
        closeReason: null,
      });
      this.recordEvent({
        sessionId,
        kind: "surface.lifecycle.created",
        subjectKind: "session",
        subjectId: sessionId,
        at: timestamp,
        data: { surface: "orchestrator" },
      });
      return this.bumpStateRevision();
    })();
    const target = {
      workspaceSessionId: sessionId as CreateSurfaceResult["workspaceSessionId"],
      surface: "orchestrator" as const,
      surfacePiSessionId: sessionId as CreateSurfaceResult["surfacePiSessionId"],
    };
    return {
      workspaceSessionId: target.workspaceSessionId,
      surfacePiSessionId: target.surfacePiSessionId,
      target,
      created: "new",
      stateRevision,
    };
  }

  readOrchestratorLifecycle(input: {
    workspaceId: WorkspaceId;
    workspaceSessionId: WorkspaceSessionId;
  }): {
    title: string;
    titleGenerationStatus: string;
    targets: RuntimeSurfaceTarget[];
  } {
    if (input.workspaceId !== this.workspace.id) {
      throw new Error(`Workspace ${input.workspaceId} is not managed by this state store.`);
    }
    const snapshot = this.getSessionState(input.workspaceSessionId);
    return {
      title: snapshot.pi.title,
      titleGenerationStatus: snapshot.pi.titleGenerationStatus ?? "not-started",
      targets: [
        {
          workspaceSessionId: input.workspaceSessionId,
          surface: "orchestrator" as const,
          surfacePiSessionId: snapshot.session.orchestratorPiSessionId as SurfacePiSessionId,
        },
        ...snapshot.threads.map((thread) => ({
          workspaceSessionId: input.workspaceSessionId,
          surface: "handler" as const,
          surfacePiSessionId: thread.surfacePiSessionId as SurfacePiSessionId,
          threadId: thread.id as ThreadId,
        })),
        ...snapshot.workflowTaskAttempts.flatMap((attempt) =>
          attempt.surfacePiSessionId
            ? [
                {
                  workspaceSessionId: input.workspaceSessionId,
                  surface: "workflow-task" as const,
                  surfacePiSessionId: attempt.surfacePiSessionId as SurfacePiSessionId,
                  workflowTaskAttemptId: attempt.id as WorkflowTaskAttemptId,
                  threadId: attempt.threadId as ThreadId,
                },
              ]
            : [],
        ),
      ],
    };
  }

  renameOrchestratorSurface(input: {
    workspaceId: WorkspaceId;
    workspaceSessionId: WorkspaceSessionId;
    title: string;
  }): RenameOrchestratorSurfaceResult {
    const current = this.readOrchestratorLifecycle(input);
    if (
      current.titleGenerationStatus === "pending" ||
      current.titleGenerationStatus === "running"
    ) {
      throw new Error("Session title is being generated. Rename is temporarily locked.");
    }
    const updated = this.markManualTitleOverride({
      sessionId: input.workspaceSessionId,
      title: input.title,
    });
    return {
      workspaceSessionId: input.workspaceSessionId,
      title: updated.title,
      stateRevision: this.bumpStateRevision(),
    };
  }

  forkOrchestratorSurface(input: {
    workspaceId: WorkspaceId;
    sourceWorkspaceSessionId: WorkspaceSessionId;
    targetSurfacePiSessionId: SurfacePiSessionId;
    title?: string;
  }): CreateSurfaceResult {
    if (input.workspaceId !== this.workspace.id) {
      throw new Error(`Workspace ${input.workspaceId} is not managed by this state store.`);
    }
    const source = this.getSessionState(input.sourceWorkspaceSessionId).pi;
    const timestamp = this.now();
    const title = input.title?.trim() || source.title || "New orchestrator";
    const stateRevision = this.db.transaction(() => {
      this.upsertPiSession({
        ...source,
        sessionId: input.targetSurfacePiSessionId,
        parentSessionId: input.sourceWorkspaceSessionId,
        title,
        titleGenerationStatus: "not-started",
        titleGenerationTriggeredAt: null,
        titleGenerationFinishedAt: null,
        titleGenerationError: null,
        titleAutoFrozen: false,
        titleManualOverride: Boolean(input.title?.trim()),
        status: "idle",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.upsertSurfaceLifecycle({
        surfacePiSessionId: input.targetSurfacePiSessionId,
        sessionId: input.targetSurfacePiSessionId,
        surfaceKind: "orchestrator",
        threadId: null,
        workflowTaskAttemptId: null,
        status: "open",
        openedAt: timestamp,
        closedAt: null,
        closeReason: null,
      });
      this.recordEvent({
        sessionId: input.targetSurfacePiSessionId,
        kind: "surface.lifecycle.created",
        subjectKind: "session",
        subjectId: input.targetSurfacePiSessionId,
        at: timestamp,
        data: { surface: "orchestrator", parentSessionId: input.sourceWorkspaceSessionId },
      });
      return this.bumpStateRevision();
    })();
    const target = {
      workspaceSessionId: input.targetSurfacePiSessionId as unknown as WorkspaceSessionId,
      surface: "orchestrator" as const,
      surfacePiSessionId: input.targetSurfacePiSessionId,
    };
    return {
      workspaceSessionId: target.workspaceSessionId,
      surfacePiSessionId: target.surfacePiSessionId,
      target,
      created: "new",
      stateRevision,
    };
  }

  deleteOrchestratorSurface(input: {
    workspaceId: WorkspaceId;
    workspaceSessionId: WorkspaceSessionId;
  }): DeleteOrchestratorSurfaceResult {
    if (input.workspaceId !== this.workspace.id) {
      throw new Error(`Workspace ${input.workspaceId} is not managed by this state store.`);
    }
    this.deleteSessionState(input.workspaceSessionId);
    return {
      workspaceSessionId: input.workspaceSessionId,
      deleted: true,
      stateRevision: this.bumpStateRevision(),
    };
  }

  openSurface(input: OpenSurfaceInput): OpenSurfaceResult {
    if (input.workspaceId !== this.workspace.id) {
      throw new Error(`Workspace ${input.workspaceId} is not managed by this state store.`);
    }
    const resolved = this.resolveRuntimeSurfaceTarget(input.target);
    const timestamp = this.now();
    const stateRevision = this.db.transaction(() => {
      this.upsertSurfaceLifecycle({
        surfacePiSessionId: resolved.surfacePiSessionId,
        sessionId: resolved.sessionId,
        surfaceKind: resolved.surfaceKind,
        threadId: resolved.threadId,
        workflowTaskAttemptId: resolved.workflowTaskAttemptId,
        status: "open",
        openedAt: timestamp,
        closedAt: null,
        closeReason: null,
      });
      this.recordEvent({
        sessionId: resolved.sessionId,
        kind: "surface.lifecycle.opened",
        subjectKind: "session",
        subjectId: resolved.surfacePiSessionId,
        at: timestamp,
        data: { surface: resolved.surfaceKind },
      });
      return this.bumpStateRevision();
    })();
    return {
      workspaceSessionId: resolved.sessionId as OpenSurfaceResult["workspaceSessionId"],
      surfacePiSessionId: resolved.surfacePiSessionId as OpenSurfaceResult["surfacePiSessionId"],
      target: input.target,
      stateRevision,
    };
  }

  getPiSessionReference(input: GetPiSessionReferenceInput): PiSessionReference | undefined {
    const row = this.findPiSessionReferenceRow(input.surfacePiSessionId);
    return row ? this.mapPiSessionReference(row) : undefined;
  }

  savePiSessionReference(input: SavePiSessionReferenceInput): PiSessionReference {
    if (input.reference.surfacePiSessionId !== input.surfacePiSessionId) {
      throw new Error(
        `Pi session reference ${input.reference.surfacePiSessionId} does not match target ${input.surfacePiSessionId}.`,
      );
    }
    const resolved = this.resolveSurfaceReferenceIdentity(input.surfacePiSessionId);
    const timestamp = this.now();
    return this.db.transaction(() => {
      const existing = this.findPiSessionReferenceRow(input.surfacePiSessionId);
      this.db
        .query(
          `INSERT INTO pi_session_reference (
             surface_pi_session_id,
             workspace_id,
             workspace_session_id,
             surface_kind,
             actor_kind,
             thread_id,
             workflow_task_attempt_id,
             adapter_kind,
             adapter_version,
             storage_locator,
             pi_session_id,
             reference_fingerprint,
             metadata_json,
             created_at,
             updated_at,
             last_validated_at,
             deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(surface_pi_session_id) DO UPDATE SET
             workspace_id = excluded.workspace_id,
             workspace_session_id = excluded.workspace_session_id,
             surface_kind = excluded.surface_kind,
             actor_kind = excluded.actor_kind,
             thread_id = excluded.thread_id,
             workflow_task_attempt_id = excluded.workflow_task_attempt_id,
             adapter_kind = excluded.adapter_kind,
             adapter_version = excluded.adapter_version,
             storage_locator = excluded.storage_locator,
             pi_session_id = excluded.pi_session_id,
             reference_fingerprint = excluded.reference_fingerprint,
             metadata_json = excluded.metadata_json,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
        )
        .run(
          input.surfacePiSessionId,
          this.workspace.id,
          resolved.sessionId,
          resolved.surfaceKind,
          resolved.actorKind,
          resolved.threadId,
          resolved.workflowTaskAttemptId,
          input.reference.adapterKind,
          input.reference.adapterVersion,
          input.reference.storageLocator,
          input.reference.piSessionId ?? null,
          input.reference.referenceFingerprint,
          toJson(input.reference.metadata ?? null),
          existing?.created_at ?? timestamp,
          timestamp,
          existing?.last_validated_at ?? null,
        );
      this.bumpStateRevision();
      return this.mapPiSessionReference(
        this.mustFindPiSessionReferenceRow(input.surfacePiSessionId),
      );
    })();
  }

  deletePiSessionReference(input: DeletePiSessionReferenceInput): {
    surfacePiSessionId: SurfacePiSessionId;
  } {
    const timestamp = this.now();
    const result = this.db.transaction(() => {
      const existing = this.mustFindPiSessionReferenceRow(input.surfacePiSessionId);
      this.db
        .query(
          `UPDATE pi_session_reference
           SET deleted_at = ?,
               updated_at = ?
           WHERE surface_pi_session_id = ?`,
        )
        .run(timestamp, timestamp, existing.surface_pi_session_id);
      this.bumpStateRevision();
      return { surfacePiSessionId: existing.surface_pi_session_id as SurfacePiSessionId };
    })();
    return result;
  }

  validatePiSessionReference(input: ValidatePiSessionReferenceInput): PiSessionReferenceValidation {
    const row = this.findPiSessionReferenceRow(input.surfacePiSessionId);
    if (!row) {
      return { valid: false, reason: "not-found" };
    }
    if (row.workspace_id !== input.workspaceId) {
      return {
        valid: false,
        reason: "workspace-mismatch",
        referenceFingerprint: row.reference_fingerprint,
      };
    }
    if (row.surface_pi_session_id !== input.reference.surfacePiSessionId) {
      return {
        valid: false,
        reason: "surface-mismatch",
        referenceFingerprint: row.reference_fingerprint,
      };
    }
    if (row.actor_kind !== input.actorKind) {
      return {
        valid: false,
        reason: "actor-mismatch",
        referenceFingerprint: row.reference_fingerprint,
      };
    }
    if (
      row.adapter_kind !== input.reference.adapterKind ||
      row.adapter_version !== input.reference.adapterVersion ||
      row.reference_fingerprint !== input.reference.referenceFingerprint
    ) {
      return {
        valid: false,
        reason: "adapter-version-mismatch",
        referenceFingerprint: row.reference_fingerprint,
      };
    }
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE pi_session_reference
         SET last_validated_at = ?,
             updated_at = ?
         WHERE surface_pi_session_id = ?`,
      )
      .run(timestamp, timestamp, row.surface_pi_session_id);
    const reference = this.mapPiSessionReference(
      this.mustFindPiSessionReferenceRow(input.surfacePiSessionId),
    );
    return {
      valid: true,
      reference,
      referenceFingerprint: reference.referenceFingerprint,
    };
  }

  closeSurface(input: CloseSurfaceInput): CloseSurfaceResult {
    const resolved = this.resolveRuntimeSurfaceTarget(input.target);
    const timestamp = this.now();
    const lifecycle =
      input.closeReason === "pane-closed"
        ? "idle"
        : input.closeReason === "test"
          ? "idle"
          : "disposed";
    this.db.transaction(() => {
      this.upsertSurfaceLifecycle({
        surfacePiSessionId: resolved.surfacePiSessionId,
        sessionId: resolved.sessionId,
        surfaceKind: resolved.surfaceKind,
        threadId: resolved.threadId,
        workflowTaskAttemptId: resolved.workflowTaskAttemptId,
        status: lifecycle,
        openedAt: null,
        closedAt: timestamp,
        closeReason: input.closeReason,
      });
      this.recordEvent({
        sessionId: resolved.sessionId,
        kind: "surface.lifecycle.closed",
        subjectKind: "session",
        subjectId: resolved.surfacePiSessionId,
        at: timestamp,
        data: { surface: resolved.surfaceKind, closeReason: input.closeReason, lifecycle },
      });
      this.bumpStateRevision();
    })();
    return {
      target: input.target,
      lifecycle,
    };
  }

  readRuntimeSourceVersion(input: ReadRuntimeSourceVersionInput): RuntimeSourceFactRecord | null {
    return this.findRuntimeSourceFact(input.scope, input.sourceKind, input.sourceId);
  }

  readRuntimeSourceRootFingerprint(input: {
    sourceRoot: AbsolutePath;
  }): RuntimeSourceRootFingerprintFactRecord | null {
    const row = this.findRuntimeSourceRootFingerprintFact(input.sourceRoot);
    return row ? this.mapRuntimeSourceRootFingerprintFact(row) : null;
  }

  recordRuntimeSourceSave(input: RecordRuntimeSourceSaveInput): RuntimeSourceFactRecord {
    return this.db.transaction(() => {
      const record = this.upsertRuntimeSourceSaveFact(input);
      this.bumpStateRevision();
      return record;
    })();
  }

  recordRuntimeSourceDelete(input: RecordRuntimeSourceDeleteInput): RuntimeSourceFactRecord {
    return this.db.transaction(() => {
      const record = this.upsertRuntimeSourceDeleteFact(input);
      this.bumpStateRevision();
      return record;
    })();
  }

  recordRuntimeWorkflowAgentSourceSave(
    input: RecordRuntimeWorkflowAgentSourceSaveInput,
  ): RuntimeSourceFactRecord {
    return this.db.transaction(() => {
      const record = this.upsertRuntimeSourceSaveFact(input.source);
      this.upsertWorkflowAgentSourceObservation(input.observation);
      this.bumpStateRevision();
      return record;
    })();
  }

  recordRuntimeWorkflowAgentSourceDelete(
    input: RecordRuntimeWorkflowAgentSourceDeleteInput,
  ): RuntimeSourceFactRecord {
    return this.db.transaction(() => {
      const record = this.upsertRuntimeSourceDeleteFact(input.source);
      this.tombstoneWorkflowAgentSource(input.source);
      this.bumpStateRevision();
      return record;
    })();
  }

  reconcileRuntimeWorkflowAgentSources(
    input: ReconcileRuntimeWorkflowAgentSourcesInput,
  ): RuntimeSourceScanFactRecord {
    return this.db.transaction(() => {
      const observedSourceIds = new Set(
        input.observations.map((observation) => observation.sourceId),
      );
      for (const observation of input.observations) {
        this.upsertObservedWorkflowAgentSourceFact(observation);
        this.upsertWorkflowAgentSourceObservation(observation);
      }
      const currentFacts = this.db
        .query(
          `SELECT * FROM runtime_source_fact
           WHERE scope_key = 'app-global'
             AND source_kind = 'workflow-agent'
             AND deleted_at IS NULL`,
        )
        .all() as RuntimeSourceFactRow[];
      for (const fact of currentFacts) {
        if (observedSourceIds.has(fact.source_id)) continue;
        this.db
          .query(
            `UPDATE runtime_source_fact
             SET updated_at = ?, deleted_at = ?
             WHERE scope_key = 'app-global'
               AND source_kind = 'workflow-agent'
               AND source_id = ?`,
          )
          .run(input.scannedAt, input.scannedAt, fact.source_id);
        this.db
          .query(
            `UPDATE workflow_agent_source_index
             SET updated_at = ?, deleted_at = ?
             WHERE source_id = ?`,
          )
          .run(input.scannedAt, input.scannedAt, fact.source_id);
      }
      const currentIndexRows = this.db
        .query(`SELECT source_id FROM workflow_agent_source_index WHERE deleted_at IS NULL`)
        .all() as Array<{ source_id: string }>;
      for (const row of currentIndexRows) {
        if (observedSourceIds.has(row.source_id)) continue;
        this.db
          .query(
            `UPDATE workflow_agent_source_index
             SET updated_at = ?, deleted_at = ?
             WHERE source_id = ?`,
          )
          .run(input.scannedAt, input.scannedAt, row.source_id);
      }
      this.upsertRuntimeSourceScan({
        scope: { kind: "app-global" },
        domain: "workflows",
        sourceFingerprint: input.sourceFingerprint,
        ...(input.sourceRoots === undefined ? {} : { sourceRoots: input.sourceRoots }),
        diagnostics: input.diagnostics,
        scannedAt: input.scannedAt,
      });
      this.bumpStateRevision();
      return this.mustFindRuntimeSourceScanFact({ kind: "app-global" }, "workflows");
    })();
  }

  listCurrentWorkflowAgentSources(): StructuredWorkflowAgentSourceIndexRecord[] {
    const rows = this.db
      .query(
        `SELECT workflow_agent_source_index.*
         FROM workflow_agent_source_index
         INNER JOIN runtime_source_fact
           ON runtime_source_fact.scope_key = 'app-global'
          AND runtime_source_fact.source_kind = 'workflow-agent'
          AND runtime_source_fact.source_id = workflow_agent_source_index.source_id
          AND runtime_source_fact.path = workflow_agent_source_index.path
          AND runtime_source_fact.source_version = workflow_agent_source_index.source_version
          AND runtime_source_fact.fingerprint = workflow_agent_source_index.fingerprint
         WHERE workflow_agent_source_index.deleted_at IS NULL
           AND runtime_source_fact.deleted_at IS NULL
         ORDER BY workflow_agent_source_index.source_id ASC`,
      )
      .all() as WorkflowAgentSourceIndexRow[];
    return rows.map((row) => this.mapWorkflowAgentSourceIndex(row));
  }

  recordRuntimeSourceScan(input: RecordRuntimeSourceScanInput): RuntimeSourceScanFactRecord {
    assertRuntimeSourceScanScopeMatchesDomain(input);
    return this.db.transaction(() => {
      this.upsertRuntimeSourceScan(input);
      this.bumpStateRevision();
      return this.mustFindRuntimeSourceScanFact(input.scope, input.domain);
    })();
  }

  reconcileDiscoveredHostSnippets(
    input: ReconcileDiscoveredHostSnippetsInput,
  ): RuntimeSourceScanFactRecord {
    const operation = "structured-session.reconcileDiscoveredHostSnippets";
    this.assertSnippetWorkspace(input.scope.workspaceId, operation);
    const observedIdentities = new Set<string>();
    const unreadableIdentities = new Set<string>();

    for (const snippet of input.observedSnippets) {
      assertDiscoveredHostSnippetIdentity(snippet, operation);
      const identity = discoveredHostSnippetId(snippet);
      if (observedIdentities.has(identity)) {
        throw new StateContractError({
          operation,
          reason: "invalid-input",
          message: `Discovered snippet scan contains duplicate identity ${identity}.`,
        });
      }
      observedIdentities.add(identity);
    }
    for (const snippet of input.unreadableSnippets) {
      assertDiscoveredHostSnippetIdentity(snippet, operation);
      const identity = discoveredHostSnippetId(snippet);
      if (observedIdentities.has(identity) || unreadableIdentities.has(identity)) {
        throw new StateContractError({
          operation,
          reason: "invalid-input",
          message: `Discovered snippet scan contains overlapping unreadable identity ${identity}.`,
        });
      }
      unreadableIdentities.add(identity);
    }
    for (const root of input.unreadableRoots) {
      assertDiscoveredHostSnippetIdentity(root, operation);
    }

    return this.db.transaction(() => {
      for (const snippet of input.observedSnippets) {
        const snippetId = discoveredHostSnippetId(snippet);
        const existing = this.db
          .query(`SELECT * FROM snippet WHERE snippet_id = ?`)
          .get(snippetId) as SnippetRow | undefined;
        if (
          existing &&
          (existing.workspace_id !== input.scope.workspaceId || existing.source === "svvy")
        ) {
          throw new StateContractError({
            operation,
            reason: "conflict",
            message: `Discovered snippet identity ${snippetId} collides with an unrelated snippet row.`,
          });
        }
        const metadata = decodeSnippetMetadataInput(snippet.metadata, operation);
        this.db
          .query(
            `INSERT INTO snippet (
               snippet_id, workspace_id, source, title, body, metadata_json,
               enabled, path, discovery_scope, created_at, updated_at, deleted_at
             ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)
             ON CONFLICT(snippet_id) DO UPDATE SET
               title = excluded.title,
               body = excluded.body,
               metadata_json = excluded.metadata_json,
               path = excluded.path,
               discovery_scope = excluded.discovery_scope,
               updated_at = excluded.updated_at,
               deleted_at = NULL`,
          )
          .run(
            snippetId,
            input.scope.workspaceId,
            snippet.source,
            normalizeDiscoveredSnippetTitle(snippet.title, operation),
            snippet.body,
            JSON.stringify(metadata),
            snippet.path,
            snippet.scope,
            existing?.created_at ?? input.scannedAt,
            input.scannedAt,
          );
      }

      const currentDiscovered = this.db
        .query(
          `SELECT * FROM snippet
           WHERE workspace_id = ? AND source IN ('claude', 'pi') AND deleted_at IS NULL`,
        )
        .all(input.scope.workspaceId) as SnippetRow[];
      for (const current of currentDiscovered) {
        const discoveryScope = decodeStoredDiscoveredSnippetScope(current.discovery_scope);
        const identity =
          discoveryScope && current.path
            ? discoveredHostSnippetId({
                source: decodeStoredDiscoveredSnippetSource(current.source),
                scope: discoveryScope,
                path: current.path as AbsolutePath,
              })
            : null;
        const retainedByUnreadableRoot = input.unreadableRoots.some(
          (root) =>
            root.source === current.source &&
            root.scope === discoveryScope &&
            current.path !== null &&
            isPathInside(current.path, root.path),
        );
        if (
          identity &&
          (observedIdentities.has(identity) ||
            unreadableIdentities.has(identity) ||
            retainedByUnreadableRoot)
        ) {
          continue;
        }
        this.db
          .query(
            `UPDATE snippet
             SET deleted_at = ?, updated_at = ?
             WHERE snippet_id = ? AND workspace_id = ? AND source IN ('claude', 'pi')`,
          )
          .run(input.scannedAt, input.scannedAt, current.snippet_id, input.scope.workspaceId);
      }

      this.upsertRuntimeSourceScan({
        scope: input.scope,
        domain: "host_snippets",
        sourceFingerprint: input.sourceFingerprint,
        sourceRoots: input.sourceRoots,
        diagnostics: input.diagnostics,
        scannedAt: input.scannedAt,
      });
      this.bumpStateRevision();
      return this.mustFindRuntimeSourceScanFact(input.scope, "host_snippets");
    })();
  }

  recordObservedRuntimeSourceDeletion(
    input: RecordObservedRuntimeSourceDeletionInput,
  ): RuntimeSourceScanFactRecord {
    assertRuntimeSourceScanScopeMatchesDomain(input);
    return this.db.transaction(() => {
      const scopeKey = runtimeSourceScopeKey(input.scope);
      const existing = this.findRuntimeSourceScanFact(input.scope, input.domain);
      const diagnostics = input.diagnostics;
      const sourceFingerprint =
        input.sourceFingerprint ?? runtimeSourceScanFallbackFingerprint(input.domain);
      this.db
        .query(
          `INSERT INTO runtime_source_scan_fact (
             scope_kind,
             scope_workspace_id,
             scope_key,
             domain,
             source_fingerprint,
             diagnostics_json,
             last_observed_path,
             last_observation_kind,
             observed_at,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'deletion', ?, ?, ?)
           ON CONFLICT(scope_key, domain) DO UPDATE SET
             scope_kind = excluded.scope_kind,
             scope_workspace_id = excluded.scope_workspace_id,
             source_fingerprint = excluded.source_fingerprint,
             diagnostics_json = excluded.diagnostics_json,
             last_observed_path = excluded.last_observed_path,
             last_observation_kind = 'deletion',
             observed_at = excluded.observed_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.scope.kind,
          input.scope.kind === "workspace" ? input.scope.workspaceId : null,
          scopeKey,
          input.domain,
          sourceFingerprint,
          JSON.stringify(diagnostics),
          input.path,
          input.observedAt,
          existing?.createdAt ?? input.observedAt,
          input.observedAt,
        );
      this.bumpStateRevision();
      return this.mustFindRuntimeSourceScanFact(input.scope, input.domain);
    })();
  }

  recordRuntimeSourceDiagnostic(
    input: RecordRuntimeSourceDiagnosticInput,
  ): RuntimeSourceScanFactRecord {
    assertRuntimeSourceScanScopeMatchesDomain(input);
    return this.db.transaction(() => {
      const scopeKey = runtimeSourceScopeKey(input.scope);
      const existing = this.findRuntimeSourceScanFact(input.scope, input.domain);
      const diagnostics = [...(existing?.diagnostics ?? []), input.diagnostic];
      const sourceFingerprint =
        input.sourceFingerprint ?? runtimeSourceScanFallbackFingerprint(input.domain);
      this.db
        .query(
          `INSERT INTO runtime_source_scan_fact (
             scope_kind,
             scope_workspace_id,
             scope_key,
             domain,
             source_fingerprint,
             diagnostics_json,
             last_observed_path,
             last_observation_kind,
             observed_at,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'diagnostic', ?, ?, ?)
           ON CONFLICT(scope_key, domain) DO UPDATE SET
             scope_kind = excluded.scope_kind,
             scope_workspace_id = excluded.scope_workspace_id,
             source_fingerprint = excluded.source_fingerprint,
             diagnostics_json = excluded.diagnostics_json,
             last_observed_path = excluded.last_observed_path,
             last_observation_kind = 'diagnostic',
             observed_at = excluded.observed_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.scope.kind,
          input.scope.kind === "workspace" ? input.scope.workspaceId : null,
          scopeKey,
          input.domain,
          sourceFingerprint,
          JSON.stringify(diagnostics),
          input.path ?? null,
          input.observedAt,
          existing?.createdAt ?? input.observedAt,
          input.observedAt,
        );
      this.bumpStateRevision();
      return this.mustFindRuntimeSourceScanFact(input.scope, input.domain);
    })();
  }

  private acquireScopedWorkspaceOwner(input: {
    ownerId: string;
    ownerKind: string;
    openReason: string;
    kind: AcquireWorkspaceResult["kind"];
  }): AcquireWorkspaceResult {
    const timestamp = this.now();
    const acquired = this.db.transaction(() => {
      const existing = this.findWorkspaceRuntimeOwner(input.ownerId, input.ownerKind);
      this.db
        .query(
          `INSERT INTO workspace_runtime_owner (
             workspace_id,
             owner_id,
             owner_kind,
             open_reason,
             acquired_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id, owner_id, owner_kind) DO UPDATE SET
             open_reason = excluded.open_reason,
             updated_at = excluded.updated_at`,
        )
        .run(
          this.workspace.id,
          input.ownerId,
          input.ownerKind,
          input.openReason,
          existing?.acquired_at ?? timestamp,
          timestamp,
        );
      this.bumpStateRevision();
      return existing ? "existing" : "created";
    })();
    return {
      workspaceId: this.workspace.id as AcquireWorkspaceResult["workspaceId"],
      cwd: this.workspace.cwd as AcquireWorkspaceResult["cwd"],
      kind: input.kind,
      acquired,
      readiness: "ready",
      readinessDetail: { mode: "full" },
      stateRevision: this.readStateRevision(),
    };
  }

  private findWorkspaceRuntimeOwner(
    ownerId: string,
    ownerKind: string,
  ): WorkspaceRuntimeOwnerRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM workspace_runtime_owner
           WHERE workspace_id = ? AND owner_id = ? AND owner_kind = ?`,
        )
        .get(this.workspace.id, ownerId, ownerKind) as WorkspaceRuntimeOwnerRow | undefined) ?? null
    );
  }

  private countWorkspaceRuntimeOwners(): number {
    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM workspace_runtime_owner WHERE workspace_id = ?`)
      .get(this.workspace.id) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private upsertSurfaceLifecycle(input: {
    surfacePiSessionId: string;
    sessionId: string;
    surfaceKind: SurfaceLifecycleRow["surface_kind"];
    threadId: string | null;
    workflowTaskAttemptId: string | null;
    status: SurfaceLifecycleRow["status"];
    openedAt: string | null;
    closedAt: string | null;
    closeReason: string | null;
  }): void {
    const timestamp = this.now();
    const existing = this.findSurfaceLifecycleRow(input.surfacePiSessionId);
    this.db
      .query(
        `INSERT INTO surface_lifecycle (
           surface_pi_session_id,
           session_id,
           surface_kind,
           thread_id,
           workflow_task_attempt_id,
           status,
           open_count,
           opened_at,
           closed_at,
           close_reason,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(surface_pi_session_id) DO UPDATE SET
           session_id = excluded.session_id,
           surface_kind = excluded.surface_kind,
           thread_id = excluded.thread_id,
           workflow_task_attempt_id = excluded.workflow_task_attempt_id,
           status = excluded.status,
           open_count = CASE
             WHEN excluded.status = 'open' THEN surface_lifecycle.open_count + 1
             ELSE surface_lifecycle.open_count
           END,
           opened_at = COALESCE(excluded.opened_at, surface_lifecycle.opened_at),
           closed_at = excluded.closed_at,
           close_reason = excluded.close_reason,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.surfacePiSessionId,
        input.sessionId,
        input.surfaceKind,
        input.threadId,
        input.workflowTaskAttemptId,
        input.status,
        input.status === "open" ? 1 : 0,
        input.openedAt,
        input.closedAt,
        input.closeReason,
        existing?.created_at ?? timestamp,
        timestamp,
      );
  }

  private findSurfaceLifecycleRow(surfacePiSessionId: string): SurfaceLifecycleRow | null {
    return (
      (this.db
        .query(`SELECT * FROM surface_lifecycle WHERE surface_pi_session_id = ?`)
        .get(surfacePiSessionId) as SurfaceLifecycleRow | undefined) ?? null
    );
  }

  private resolveRuntimeSurfaceTarget(target: OpenSurfaceInput["target"]): {
    sessionId: string;
    surfacePiSessionId: string;
    surfaceKind: SurfaceLifecycleRow["surface_kind"];
    threadId: string | null;
    workflowTaskAttemptId: string | null;
  } {
    if (target.surface === "orchestrator") {
      const session = this.mustFindSessionRow(target.workspaceSessionId);
      if (session.orchestrator_pi_session_id !== target.surfacePiSessionId) {
        throw new Error(
          `Orchestrator surface ${target.surfacePiSessionId} does not belong to session ${target.workspaceSessionId}.`,
        );
      }
      return {
        sessionId: session.session_id,
        surfacePiSessionId: session.orchestrator_pi_session_id,
        surfaceKind: "orchestrator",
        threadId: null,
        workflowTaskAttemptId: null,
      };
    }
    if (target.surface === "handler") {
      const thread = this.mustFindThreadRow(target.threadId);
      if (
        thread.session_id !== target.workspaceSessionId ||
        thread.surface_pi_session_id !== target.surfacePiSessionId
      ) {
        throw new Error(
          `Handler surface ${target.surfacePiSessionId} does not belong to thread ${target.threadId}.`,
        );
      }
      return {
        sessionId: thread.session_id,
        surfacePiSessionId: thread.surface_pi_session_id,
        surfaceKind: "handler",
        threadId: thread.id,
        workflowTaskAttemptId: null,
      };
    }
    const attempt = this.mustFindWorkflowTaskAttemptRow(target.workflowTaskAttemptId);
    if (
      attempt.session_id !== target.workspaceSessionId ||
      attempt.surface_pi_session_id !== target.surfacePiSessionId
    ) {
      throw new Error(
        `Workflow task surface ${target.surfacePiSessionId} does not belong to attempt ${target.workflowTaskAttemptId}.`,
      );
    }
    return {
      sessionId: attempt.session_id,
      surfacePiSessionId: attempt.surface_pi_session_id ?? target.surfacePiSessionId,
      surfaceKind: "workflow-task",
      threadId: target.threadId,
      workflowTaskAttemptId: attempt.id,
    };
  }

  private resolveSurfaceReferenceIdentity(surfacePiSessionId: string): {
    sessionId: string;
    surfaceKind: SurfaceLifecycleRow["surface_kind"];
    actorKind: ActorKind;
    threadId: string | null;
    workflowTaskAttemptId: string | null;
  } {
    const lifecycle = this.findSurfaceLifecycleRow(surfacePiSessionId);
    if (lifecycle) {
      return {
        sessionId: lifecycle.session_id,
        surfaceKind: lifecycle.surface_kind,
        actorKind:
          lifecycle.surface_kind === "workflow-task" ? "workflow-task" : lifecycle.surface_kind,
        threadId: lifecycle.thread_id,
        workflowTaskAttemptId: lifecycle.workflow_task_attempt_id,
      };
    }
    const session = this.db
      .query(`SELECT * FROM session WHERE orchestrator_pi_session_id = ? LIMIT 1`)
      .get(surfacePiSessionId) as SessionRow | undefined;
    if (session) {
      return {
        sessionId: session.session_id,
        surfaceKind: "orchestrator",
        actorKind: "orchestrator",
        threadId: null,
        workflowTaskAttemptId: null,
      };
    }
    const thread = this.db
      .query(`SELECT * FROM thread WHERE surface_pi_session_id = ? LIMIT 1`)
      .get(surfacePiSessionId) as ThreadRow | undefined;
    if (thread) {
      return {
        sessionId: thread.session_id,
        surfaceKind: "handler",
        actorKind: "handler",
        threadId: thread.id,
        workflowTaskAttemptId: null,
      };
    }
    const attempt = this.db
      .query(`SELECT * FROM workflow_task_attempt WHERE surface_pi_session_id = ? LIMIT 1`)
      .get(surfacePiSessionId) as WorkflowTaskAttemptRow | undefined;
    if (attempt) {
      return {
        sessionId: attempt.session_id,
        surfaceKind: "workflow-task",
        actorKind: "workflow-task",
        threadId: attempt.thread_id,
        workflowTaskAttemptId: attempt.id,
      };
    }
    throw new Error(`Surface ${surfacePiSessionId} was not found for pi session reference.`);
  }

  private findPiSessionReferenceRow(surfacePiSessionId: string): PiSessionReferenceRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM pi_session_reference
           WHERE surface_pi_session_id = ? AND deleted_at IS NULL
           LIMIT 1`,
        )
        .get(surfacePiSessionId) as PiSessionReferenceRow | undefined) ?? null
    );
  }

  private mustFindPiSessionReferenceRow(surfacePiSessionId: string): PiSessionReferenceRow {
    const row = this.findPiSessionReferenceRow(surfacePiSessionId);
    if (!row) {
      throw new Error(`Pi session reference was not found: ${surfacePiSessionId}`);
    }
    return row;
  }

  private upsertRuntimeSourceSaveFact(
    input: RecordRuntimeSourceSaveInput,
  ): RuntimeSourceFactRecord {
    const existing = this.findRuntimeSourceFact(input.scope, input.sourceKind, input.sourceId);
    const sourceCommandId = input.sourceCommandId ?? null;
    if (
      existing &&
      existing.deletedAt === null &&
      existing.path === input.path &&
      existing.sourceVersion === input.sourceVersion &&
      existing.fingerprint === input.fingerprint &&
      JSON.stringify(existing.diagnostics) === JSON.stringify(input.diagnostics) &&
      existing.sourceCommandId === sourceCommandId &&
      existing.updatedAt === input.savedAt
    ) {
      return existing;
    }
    if (
      (input.previousSourceVersion === null && existing?.deletedAt === null) ||
      (input.previousSourceVersion !== undefined &&
        input.previousSourceVersion !== null &&
        existing?.sourceVersion !== input.previousSourceVersion)
    ) {
      throw new StateContractError({
        operation: "structured-session.recordRuntimeSourceSave",
        reason: "stale-state",
        message: `Runtime source ${input.sourceKind}:${input.sourceId} has version ${
          existing?.sourceVersion ?? "none"
        }, not ${input.previousSourceVersion ?? "none"}.`,
      });
    }
    this.db
      .query(
        `INSERT INTO runtime_source_fact (
           scope_kind,
           scope_workspace_id,
           scope_key,
           source_kind,
           source_id,
           path,
           source_version,
           fingerprint,
           diagnostics_json,
           source_command_id,
           created_at,
           updated_at,
           deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(scope_key, source_kind, source_id) DO UPDATE SET
           path = excluded.path,
           source_version = excluded.source_version,
           fingerprint = excluded.fingerprint,
           diagnostics_json = excluded.diagnostics_json,
           source_command_id = excluded.source_command_id,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
      )
      .run(
        input.scope.kind,
        input.scope.kind === "workspace" ? input.scope.workspaceId : null,
        runtimeSourceScopeKey(input.scope),
        input.sourceKind,
        input.sourceId,
        input.path,
        input.sourceVersion,
        input.fingerprint,
        JSON.stringify(input.diagnostics),
        sourceCommandId,
        existing?.createdAt ?? input.savedAt,
        input.savedAt,
      );
    return this.mustFindRuntimeSourceFact(input.scope, input.sourceKind, input.sourceId);
  }

  private upsertRuntimeSourceDeleteFact(
    input: RecordRuntimeSourceDeleteInput,
  ): RuntimeSourceFactRecord {
    const existing = this.findRuntimeSourceFact(input.scope, input.sourceKind, input.sourceId);
    const sourceCommandId = input.sourceCommandId ?? existing?.sourceCommandId ?? null;
    if (
      existing &&
      existing.path === input.path &&
      existing.sourceVersion === input.previousSourceVersion &&
      existing.fingerprint === input.previousFingerprint &&
      existing.sourceCommandId === sourceCommandId &&
      existing.updatedAt === input.deletedAt &&
      existing.deletedAt === input.deletedAt
    ) {
      return existing;
    }
    if (
      existing &&
      (existing.deletedAt !== null ||
        existing.path !== input.path ||
        existing.sourceVersion !== input.previousSourceVersion ||
        existing.fingerprint !== input.previousFingerprint)
    ) {
      throw new StateContractError({
        operation: "structured-session.recordRuntimeSourceDelete",
        reason: "stale-state",
        message: `Runtime source ${input.sourceKind}:${input.sourceId} does not match the source version and fingerprint being deleted.`,
      });
    }
    this.db
      .query(
        `INSERT INTO runtime_source_fact (
           scope_kind,
           scope_workspace_id,
           scope_key,
           source_kind,
           source_id,
           path,
           source_version,
           fingerprint,
           diagnostics_json,
           source_command_id,
           created_at,
           updated_at,
           deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
         ON CONFLICT(scope_key, source_kind, source_id) DO UPDATE SET
           path = excluded.path,
           source_version = excluded.source_version,
           fingerprint = excluded.fingerprint,
           source_command_id = excluded.source_command_id,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`,
      )
      .run(
        input.scope.kind,
        input.scope.kind === "workspace" ? input.scope.workspaceId : null,
        runtimeSourceScopeKey(input.scope),
        input.sourceKind,
        input.sourceId,
        input.path,
        input.previousSourceVersion,
        input.previousFingerprint,
        sourceCommandId,
        existing?.createdAt ?? input.deletedAt,
        input.deletedAt,
        input.deletedAt,
      );
    return this.mustFindRuntimeSourceFact(input.scope, input.sourceKind, input.sourceId);
  }

  private upsertObservedWorkflowAgentSourceFact(observation: WorkflowAgentSourceObservation): void {
    const existing = this.findRuntimeSourceFact(
      { kind: "app-global" },
      "workflow-agent",
      observation.sourceId,
    );
    this.db
      .query(
        `INSERT INTO runtime_source_fact (
           scope_kind,
           scope_workspace_id,
           scope_key,
           source_kind,
           source_id,
           path,
           source_version,
           fingerprint,
           diagnostics_json,
           source_command_id,
           created_at,
           updated_at,
           deleted_at
         ) VALUES ('app-global', NULL, 'app-global', 'workflow-agent', ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
         ON CONFLICT(scope_key, source_kind, source_id) DO UPDATE SET
           path = excluded.path,
           source_version = excluded.source_version,
           fingerprint = excluded.fingerprint,
           diagnostics_json = excluded.diagnostics_json,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
      )
      .run(
        observation.sourceId,
        observation.path,
        observation.sourceVersion,
        observation.fingerprint,
        JSON.stringify(observation.diagnostics),
        existing?.createdAt ?? observation.observedAt,
        observation.observedAt,
      );
  }

  private upsertWorkflowAgentSourceObservation(observation: WorkflowAgentSourceObservation): void {
    const existing = this.db
      .query(`SELECT created_at FROM workflow_agent_source_index WHERE source_id = ?`)
      .get(observation.sourceId) as { created_at: string } | undefined;
    this.db
      .query(
        `INSERT INTO workflow_agent_source_index (
           source_id,
           path,
           source_version,
           fingerprint,
           validation_status,
           diagnostics_json,
           parameters_json,
           extension_order_json,
           observed_at,
           created_at,
           updated_at,
           deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(source_id) DO UPDATE SET
           path = excluded.path,
           source_version = excluded.source_version,
           fingerprint = excluded.fingerprint,
           validation_status = excluded.validation_status,
           diagnostics_json = excluded.diagnostics_json,
           parameters_json = excluded.parameters_json,
           extension_order_json = excluded.extension_order_json,
           observed_at = excluded.observed_at,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
      )
      .run(
        observation.sourceId,
        observation.path,
        observation.sourceVersion,
        observation.fingerprint,
        observation.validationStatus,
        JSON.stringify(observation.diagnostics),
        observation.parameters === null ? null : JSON.stringify(observation.parameters),
        JSON.stringify(observation.extensionOrder),
        observation.observedAt,
        existing?.created_at ?? observation.observedAt,
        observation.observedAt,
      );
  }

  private tombstoneWorkflowAgentSource(input: RecordRuntimeSourceDeleteInput): void {
    const existing = this.db
      .query(`SELECT created_at FROM workflow_agent_source_index WHERE source_id = ?`)
      .get(input.sourceId) as { created_at: string } | undefined;
    this.db
      .query(
        `INSERT INTO workflow_agent_source_index (
           source_id,
           path,
           source_version,
           fingerprint,
           validation_status,
           diagnostics_json,
           parameters_json,
           extension_order_json,
           observed_at,
           created_at,
           updated_at,
           deleted_at
         ) VALUES (?, ?, ?, ?, NULL, '[]', NULL, '[]', NULL, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           path = excluded.path,
           source_version = excluded.source_version,
           fingerprint = excluded.fingerprint,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`,
      )
      .run(
        input.sourceId,
        input.path,
        input.previousSourceVersion,
        input.previousFingerprint,
        existing?.created_at ?? input.deletedAt,
        input.deletedAt,
        input.deletedAt,
      );
  }

  private mapWorkflowAgentSourceIndex(
    row: WorkflowAgentSourceIndexRow,
  ): StructuredWorkflowAgentSourceIndexRecord {
    if (row.validation_status === null || row.observed_at === null) {
      throw new Error(`Current workflow-agent source index row is incomplete: ${row.source_id}`);
    }
    return {
      sourceId: row.source_id,
      path: row.path as AbsolutePath,
      sourceVersion: row.source_version,
      fingerprint: row.fingerprint,
      validationStatus: row.validation_status,
      diagnostics: JSON.parse(
        row.diagnostics_json,
      ) as WorkflowAgentSourceObservation["diagnostics"],
      parameters: fromJson<WorkflowAgentSourceObservation["parameters"]>(row.parameters_json),
      extensionOrder: JSON.parse(
        row.extension_order_json,
      ) as WorkflowAgentSourceObservation["extensionOrder"],
      extensionUsage: Object.fromEntries(
        (
          this.db
            .query(
              `SELECT extension_id, usage FROM workflow_agent_extension_usage WHERE profile_id = ? ORDER BY extension_id ASC`,
            )
            .all(row.source_id) as Array<{ extension_id: string; usage: ExtensionUsageState }>
        ).map((entry) => [entry.extension_id, entry.usage]),
      ),
      observedAt: row.observed_at as WorkflowAgentSourceObservation["observedAt"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private findRuntimeSourceFact(
    scope: RuntimeSourceFactRecord["scope"],
    sourceKind: RuntimeSourceFactRecord["sourceKind"],
    sourceId: string,
  ): RuntimeSourceFactRecord | null {
    const row =
      (this.db
        .query(
          `SELECT * FROM runtime_source_fact WHERE scope_key = ? AND source_kind = ? AND source_id = ?`,
        )
        .get(runtimeSourceScopeKey(scope), sourceKind, sourceId) as
        | RuntimeSourceFactRow
        | undefined) ?? null;
    return row ? this.mapRuntimeSourceFact(row) : null;
  }

  private mustFindRuntimeSourceFact(
    scope: RuntimeSourceFactRecord["scope"],
    sourceKind: RuntimeSourceFactRecord["sourceKind"],
    sourceId: string,
  ): RuntimeSourceFactRecord {
    const record = this.findRuntimeSourceFact(scope, sourceKind, sourceId);
    if (!record) {
      throw new Error(
        `Runtime source fact not found: ${runtimeSourceScopeKey(scope)}:${sourceKind}:${sourceId}`,
      );
    }
    return record;
  }

  private findRuntimeSourceScanFact(
    scope: RuntimeSourceScanFactRecord["scope"],
    domain: RuntimeSourceScanFactRecord["domain"],
  ): RuntimeSourceScanFactRecord | null {
    const row =
      (this.db
        .query(`SELECT * FROM runtime_source_scan_fact WHERE scope_key = ? AND domain = ?`)
        .get(runtimeSourceScopeKey(scope), domain) as RuntimeSourceScanFactRow | undefined) ?? null;
    return row ? this.mapRuntimeSourceScanFact(row) : null;
  }

  private findRuntimeSourceRootFingerprintFact(
    sourceRoot: AbsolutePath,
  ): RuntimeSourceRootFingerprintFactRow | null {
    return (
      (this.db
        .query(`SELECT * FROM runtime_source_root_fingerprint_fact WHERE source_root = ?`)
        .get(sourceRoot) as RuntimeSourceRootFingerprintFactRow | undefined) ?? null
    );
  }

  private upsertRuntimeSourceScan(input: RecordRuntimeSourceScanInput): void {
    const scopeKey = runtimeSourceScopeKey(input.scope);
    const existing = this.findRuntimeSourceScanFact(input.scope, input.domain);
    this.db
      .query(
        `INSERT INTO runtime_source_scan_fact (
           scope_kind,
           scope_workspace_id,
           scope_key,
           domain,
           source_fingerprint,
           diagnostics_json,
           last_observed_path,
           last_observation_kind,
           observed_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'scan', ?, ?, ?)
         ON CONFLICT(scope_key, domain) DO UPDATE SET
           scope_kind = excluded.scope_kind,
           scope_workspace_id = excluded.scope_workspace_id,
           source_fingerprint = excluded.source_fingerprint,
           diagnostics_json = excluded.diagnostics_json,
           last_observed_path = NULL,
           last_observation_kind = 'scan',
           observed_at = excluded.observed_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.scope.kind,
        input.scope.kind === "workspace" ? input.scope.workspaceId : null,
        scopeKey,
        input.domain,
        input.sourceFingerprint,
        JSON.stringify(input.diagnostics),
        input.scannedAt,
        existing?.createdAt ?? input.scannedAt,
        input.scannedAt,
      );
    for (const sourceRoot of input.sourceRoots ?? []) {
      this.upsertRuntimeSourceRootFingerprintFact({
        scope: input.scope,
        domain: input.domain,
        sourceRoot: sourceRoot.sourceRoot,
        rootFingerprint: sourceRoot.rootFingerprint,
        diagnostics: input.diagnostics,
        observedAt: input.scannedAt,
      });
    }
  }

  private upsertRuntimeSourceRootFingerprintFact(input: {
    scope: RuntimeSourceRootFingerprintFactRecord["scope"];
    domain: RuntimeSourceRootFingerprintFactRecord["domain"];
    sourceRoot: AbsolutePath;
    rootFingerprint: string;
    diagnostics: RuntimeSourceRootFingerprintFactRecord["diagnostics"];
    observedAt: string;
  }): void {
    const scopeKey = runtimeSourceScopeKey(input.scope);
    const existing = this.findRuntimeSourceRootFingerprintFact(input.sourceRoot);
    this.db
      .query(
        `INSERT INTO runtime_source_root_fingerprint_fact (
           scope_kind,
           scope_workspace_id,
           scope_key,
           domain,
           source_root,
           root_fingerprint,
           diagnostics_json,
           observed_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_root) DO UPDATE SET
           scope_kind = excluded.scope_kind,
           scope_workspace_id = excluded.scope_workspace_id,
           scope_key = excluded.scope_key,
           domain = excluded.domain,
           root_fingerprint = excluded.root_fingerprint,
           diagnostics_json = excluded.diagnostics_json,
           observed_at = excluded.observed_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.scope.kind,
        input.scope.kind === "workspace" ? input.scope.workspaceId : null,
        scopeKey,
        input.domain,
        input.sourceRoot,
        input.rootFingerprint,
        JSON.stringify(input.diagnostics),
        input.observedAt,
        existing?.created_at ?? input.observedAt,
        input.observedAt,
      );
  }

  private mustFindRuntimeSourceScanFact(
    scope: RuntimeSourceScanFactRecord["scope"],
    domain: RuntimeSourceScanFactRecord["domain"],
  ): RuntimeSourceScanFactRecord {
    const record = this.findRuntimeSourceScanFact(scope, domain);
    if (!record) {
      throw new Error(
        `Runtime source scan fact not found: ${runtimeSourceScopeKey(scope)}:${domain}`,
      );
    }
    return record;
  }

  private mapRuntimeSourceFact(row: RuntimeSourceFactRow): RuntimeSourceFactRecord {
    const scope =
      row.scope_kind === "workspace"
        ? { kind: "workspace" as const, workspaceId: row.scope_workspace_id as WorkspaceId }
        : { kind: "app-global" as const };
    return {
      scope,
      scopeKey: row.scope_key,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      path: row.path as RuntimeSourceFactRecord["path"],
      sourceVersion: row.source_version,
      fingerprint: row.fingerprint,
      diagnostics: fromJson<RuntimeSourceFactRecord["diagnostics"]>(row.diagnostics_json) ?? [],
      sourceCommandId: row.source_command_id as RuntimeSourceFactRecord["sourceCommandId"],
      createdAt: row.created_at as RuntimeSourceFactRecord["createdAt"],
      updatedAt: row.updated_at as RuntimeSourceFactRecord["updatedAt"],
      deletedAt: row.deleted_at as RuntimeSourceFactRecord["deletedAt"],
    };
  }

  private mapRuntimeSourceScanFact(row: RuntimeSourceScanFactRow): RuntimeSourceScanFactRecord {
    const scope =
      row.scope_kind === "workspace"
        ? { kind: "workspace" as const, workspaceId: row.scope_workspace_id as WorkspaceId }
        : { kind: "app-global" as const };
    return {
      scope,
      scopeKey: row.scope_key,
      domain: row.domain,
      sourceFingerprint: row.source_fingerprint,
      diagnostics: fromJson<RuntimeSourceScanFactRecord["diagnostics"]>(row.diagnostics_json) ?? [],
      lastObservedPath: row.last_observed_path as RuntimeSourceScanFactRecord["lastObservedPath"],
      lastObservationKind: row.last_observation_kind,
      observedAt: row.observed_at as RuntimeSourceScanFactRecord["observedAt"],
      createdAt: row.created_at as RuntimeSourceScanFactRecord["createdAt"],
      updatedAt: row.updated_at as RuntimeSourceScanFactRecord["updatedAt"],
    };
  }

  private mapRuntimeSourceRootFingerprintFact(
    row: RuntimeSourceRootFingerprintFactRow,
  ): RuntimeSourceRootFingerprintFactRecord {
    const scope =
      row.scope_kind === "workspace"
        ? { kind: "workspace" as const, workspaceId: row.scope_workspace_id as WorkspaceId }
        : { kind: "app-global" as const };
    return {
      scope,
      scopeKey: row.scope_key,
      domain: row.domain,
      sourceRoot: row.source_root as RuntimeSourceRootFingerprintFactRecord["sourceRoot"],
      rootFingerprint: row.root_fingerprint,
      diagnostics:
        fromJson<RuntimeSourceRootFingerprintFactRecord["diagnostics"]>(row.diagnostics_json) ?? [],
      observedAt: row.observed_at as RuntimeSourceRootFingerprintFactRecord["observedAt"],
      createdAt: row.created_at as RuntimeSourceRootFingerprintFactRecord["createdAt"],
      updatedAt: row.updated_at as RuntimeSourceRootFingerprintFactRecord["updatedAt"],
    };
  }

  private findProviderAuthStatus(
    providerId: ProviderAuthStatus["providerId"],
    workspaceKey: string,
  ): ProviderAuthStatus | null {
    const row =
      (this.db
        .query(
          `SELECT * FROM provider_auth_status
           WHERE provider_id = ? AND workspace_key = ?`,
        )
        .get(providerId, workspaceKey) as ProviderAuthStatusRow | undefined) ?? null;
    return row ? this.mapProviderAuthStatus(row) : null;
  }

  private mustFindProviderAuthStatus(
    providerId: ProviderAuthStatus["providerId"],
    workspaceKey: string,
  ): ProviderAuthStatus {
    const status = this.findProviderAuthStatus(providerId, workspaceKey);
    if (!status) {
      throw new Error(`Provider auth status not found: ${providerId}:${workspaceKey}`);
    }
    return status;
  }

  private mapProviderAuthStatus(row: ProviderAuthStatusRow): ProviderAuthStatus {
    return {
      providerId: row.provider_id as ProviderAuthStatus["providerId"],
      health: row.health,
      ...(row.workspace_id
        ? { workspaceId: row.workspace_id as NonNullable<ProviderAuthStatus["workspaceId"]> }
        : {}),
      ...(row.redacted_account_label ? { redactedAccountLabel: row.redacted_account_label } : {}),
      ...(row.refreshed_at
        ? { refreshedAt: row.refreshed_at as NonNullable<ProviderAuthStatus["refreshedAt"]> }
        : {}),
      ...(row.expires_at
        ? { expiresAt: row.expires_at as NonNullable<ProviderAuthStatus["expiresAt"]> }
        : {}),
      ...(row.issue ? { issue: row.issue } : {}),
    };
  }

  private readStateRevision(): StateRevision {
    const row = this.db.query(`SELECT revision FROM state_revision WHERE id = 1`).get() as
      | { revision: number }
      | undefined;
    return (row?.revision ?? 0) as StateRevision;
  }

  readCurrentStateRevision(): StateRevision {
    return this.readStateRevision();
  }

  private bumpStateRevision(): StateRevision {
    this.db
      .query(`INSERT INTO state_revision (id, revision) VALUES (1, 0) ON CONFLICT(id) DO NOTHING`)
      .run();
    this.db.query(`UPDATE state_revision SET revision = revision + 1 WHERE id = 1`).run();
    return this.readStateRevision();
  }

  private nextSurfaceMessagePosition(
    surfacePiSessionId: string,
    placement: "front" | "back",
  ): number {
    const row = this.db
      .query(
        `SELECT MIN(position) AS min_position, MAX(position) AS max_position
         FROM surface_message_queue
         WHERE surface_pi_session_id = ? AND status IN ('queued', 'steering', 'dispatching')`,
      )
      .get(surfacePiSessionId) as
      | { min_position: number | null; max_position: number | null }
      | undefined;
    if (placement === "front") {
      return (row?.min_position ?? 1) - 1;
    }
    return (row?.max_position ?? 0) + 1;
  }

  private nextSurfaceMessageSequence(surfacePiSessionId: string, orderingKey: string): number {
    const row = this.db
      .query(
        `SELECT MAX(sequence) AS max_sequence
         FROM surface_message_queue
         WHERE surface_pi_session_id = ? AND ordering_key = ?`,
      )
      .get(surfacePiSessionId, orderingKey) as { max_sequence: number | null } | undefined;
    return (row?.max_sequence ?? 0) + 1;
  }

  private recordSurfaceMessageEvent(row: SurfaceQueuedMessageRow, kind: string, at: string): void {
    this.recordEvent({
      sessionId: row.session_id,
      kind,
      subjectKind: "session",
      subjectId: row.session_id,
      at,
      data: {
        surfacePiSessionId: row.surface_pi_session_id,
        threadId: row.thread_id,
        queuedMessageId: row.id,
        kind: row.kind,
        status: row.status,
        priority: row.priority,
        orderingKey: row.ordering_key,
        sequence: row.sequence,
        sourceCommandId: row.source_command_id,
        workflowTaskAttemptId: row.workflow_task_attempt_id,
        attemptCount: row.attempt_count,
        leaseVersion: row.lease_version,
      },
    });
  }

  private updateSurfaceMessageStatus(input: {
    id: string;
    status: StructuredSurfaceQueuedMessageStatus;
    eventKind: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
  }): StructuredSurfaceQueuedMessageRecord {
    const existing = this.mustFindSurfaceQueuedMessageRow(input.id);
    const timestamp = this.now();
    const result = this.db
      .query(
        `UPDATE surface_message_queue
         SET status = ?,
             updated_at = ?,
             claim_owner_id = CASE WHEN ? IN ('delivered', 'cancelled', 'failed') THEN NULL ELSE claim_owner_id END,
             claim_lease_expires_at = CASE WHEN ? IN ('delivered', 'cancelled', 'failed') THEN NULL ELSE claim_lease_expires_at END,
             delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
             failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
             cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END
         WHERE id = ?
           AND (? IS NULL OR claim_owner_id = ?)
           AND (? IS NULL OR lease_version = ?)`,
      )
      .run(
        input.status,
        timestamp,
        input.status,
        input.status,
        input.status,
        timestamp,
        input.status,
        timestamp,
        input.status,
        timestamp,
        input.id,
        input.claimOwnerId ?? null,
        input.claimOwnerId ?? null,
        input.leaseVersion ?? null,
        input.leaseVersion ?? null,
      );
    if (result.changes !== 1) {
      throw new Error(`Surface queued message claim is stale: ${input.id}`);
    }
    this.recordSurfaceMessageEvent(existing, input.eventKind, timestamp);
    return this.mustFindSurfaceQueuedMessageRecord(input.id);
  }

  upsertPiSession(pi: StructuredPiSessionRecord): void {
    if (this.isSessionDeleted(pi.sessionId)) {
      return;
    }

    const existing = this.getSessionRow(pi.sessionId);
    this.db
      .query(
        `INSERT OR REPLACE INTO session (
           session_id,
           parent_session_id,
           title,
           provider,
           model,
           reasoning_effort,
           orchestrator_agent_profile_id,
           orchestrator_agent_profile_json,
           generated_agent_context_fingerprint,
           update_extension_context_before_next_turn,
           loaded_extension_ids_json,
           available_extension_ids_json,
           title_namer_agent_json,
           title_generation_status,
           title_generation_triggered_at,
           title_generation_finished_at,
           title_generation_error,
           title_auto_frozen,
           title_manual_override,
           message_count,
           pi_status,
           created_at,
           updated_at,
           orchestrator_pi_session_id,
           pinned_at,
           archived_at,
           unread_at,
           unread_reason,
           last_read_at,
           wait_owner_kind,
           wait_thread_id,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pi.sessionId,
        pi.parentSessionId === undefined
          ? (existing?.parent_session_id ?? null)
          : pi.parentSessionId,
        pi.title,
        pi.provider ?? null,
        pi.model ?? null,
        pi.reasoningEffort ?? null,
        pi.orchestratorAgentProfileId ?? existing?.orchestrator_agent_profile_id ?? null,
        pi.orchestratorAgentProfileJson ?? existing?.orchestrator_agent_profile_json ?? null,
        pi.generatedAgentContextFingerprint ??
          existing?.generated_agent_context_fingerprint ??
          null,
        pi.updateExtensionContextBeforeNextTurn === undefined
          ? (existing?.update_extension_context_before_next_turn ?? 1)
          : pi.updateExtensionContextBeforeNextTurn
            ? 1
            : 0,
        pi.loadedExtensionIds === undefined
          ? (existing?.loaded_extension_ids_json ?? null)
          : toJson(normalizeStringList(pi.loadedExtensionIds)),
        pi.availableExtensionIds === undefined
          ? (existing?.available_extension_ids_json ?? null)
          : toJson(normalizeStringList(pi.availableExtensionIds)),
        pi.titleNamerAgentJson ?? existing?.title_namer_agent_json ?? null,
        pi.titleGenerationStatus ?? existing?.title_generation_status ?? "not-started",
        pi.titleGenerationTriggeredAt ?? existing?.title_generation_triggered_at ?? null,
        pi.titleGenerationFinishedAt ?? existing?.title_generation_finished_at ?? null,
        pi.titleGenerationError ?? existing?.title_generation_error ?? null,
        pi.titleAutoFrozen === undefined
          ? (existing?.title_auto_frozen ?? 0)
          : pi.titleAutoFrozen
            ? 1
            : 0,
        pi.titleManualOverride === undefined
          ? (existing?.title_manual_override ?? 0)
          : pi.titleManualOverride
            ? 1
            : 0,
        pi.messageCount,
        pi.status,
        existing?.created_at ?? pi.createdAt,
        pi.updatedAt,
        existing?.orchestrator_pi_session_id ?? pi.sessionId,
        existing?.pinned_at ?? null,
        existing?.archived_at ?? null,
        existing?.unread_at ?? null,
        existing?.unread_reason ?? null,
        existing?.last_read_at ?? null,
        existing?.wait_owner_kind ?? null,
        existing?.wait_thread_id ?? null,
        existing?.wait_kind ?? null,
        existing?.wait_reason ?? null,
        existing?.wait_resume_when ?? null,
        existing?.wait_since ?? null,
      );
  }

  upsertGeneratedAgentContextBinding(input: {
    surfacePiSessionId: string;
    ownerKind: StructuredGeneratedAgentContextBindingOwner;
    ownerId: string;
    actorKind: StructuredGeneratedAgentContextActor;
    systemPrompt: string;
    svvyxGuidance: string;
    commandsDts: string;
    nativeToolSchemasJson: string;
    generatedAgentContextFingerprint: string;
    generatedAgentContextRevision: number;
    loadedExtensionIds: string[];
    availableExtensionIds: string[];
    externalSourceHashes: string[];
  }): StructuredGeneratedAgentContextBindingRecord {
    const timestamp = this.now();
    const existing = this.db
      .query(
        `SELECT * FROM generated_agent_context_binding
         WHERE surface_pi_session_id = ? AND generated_agent_context_fingerprint = ?
         LIMIT 1`,
      )
      .get(input.surfacePiSessionId, input.generatedAgentContextFingerprint) as
      | GeneratedAgentContextBindingRow
      | undefined;
    if (existing) {
      this.db
        .query(
          `UPDATE generated_agent_context_binding
           SET owner_kind = ?,
               owner_id = ?,
               actor_kind = ?,
               system_prompt = ?,
               svvyx_guidance = ?,
               commands_dts = ?,
               native_tool_schemas_json = ?,
               generated_agent_context_revision = ?,
               loaded_extension_ids_json = ?,
               available_extension_ids_json = ?,
               external_source_hashes_json = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.ownerKind,
          input.ownerId,
          input.actorKind,
          input.systemPrompt,
          input.svvyxGuidance,
          input.commandsDts,
          input.nativeToolSchemasJson,
          input.generatedAgentContextRevision,
          toJson(normalizeStringList(input.loadedExtensionIds)),
          toJson(normalizeStringList(input.availableExtensionIds)),
          toJson(normalizeStringList(input.externalSourceHashes)),
          timestamp,
          existing.id,
        );
      return this.mapGeneratedAgentContextBinding(
        this.mustFindGeneratedAgentContextBindingRow(existing.id),
      );
    }

    const id = this.createId("generated-context-binding");
    this.db
      .query(
        `INSERT INTO generated_agent_context_binding (
           id,
           surface_pi_session_id,
           owner_kind,
           owner_id,
           actor_kind,
           system_prompt,
           svvyx_guidance,
           commands_dts,
           native_tool_schemas_json,
           generated_agent_context_fingerprint,
           generated_agent_context_revision,
           loaded_extension_ids_json,
           available_extension_ids_json,
           external_source_hashes_json,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.surfacePiSessionId,
        input.ownerKind,
        input.ownerId,
        input.actorKind,
        input.systemPrompt,
        input.svvyxGuidance,
        input.commandsDts,
        input.nativeToolSchemasJson,
        input.generatedAgentContextFingerprint,
        input.generatedAgentContextRevision,
        toJson(normalizeStringList(input.loadedExtensionIds)),
        toJson(normalizeStringList(input.availableExtensionIds)),
        toJson(normalizeStringList(input.externalSourceHashes)),
        timestamp,
        timestamp,
      );
    return this.mapGeneratedAgentContextBinding(this.mustFindGeneratedAgentContextBindingRow(id));
  }

  bindRuntimeGeneratedContext(
    input: BindRuntimeGeneratedContextInput,
  ): StructuredGeneratedAgentContextBindingRecord {
    return this.db.transaction((bindingInput: BindRuntimeGeneratedContextInput) => {
      const latest = this.db
        .query(
          `SELECT MAX(generated_agent_context_revision) AS revision
           FROM generated_agent_context_binding
           WHERE surface_pi_session_id = ?`,
        )
        .get(bindingInput.target.surfacePiSessionId) as { revision: number | null };
      const generatedAgentContextRevision = (latest.revision ?? 0) + 1;
      let ownerKind: StructuredGeneratedAgentContextBindingOwner;
      let ownerId: string;
      if (bindingInput.target.surface === "orchestrator") {
        const session = this.mustFindSessionRow(bindingInput.target.workspaceSessionId);
        if (session.orchestrator_pi_session_id !== bindingInput.target.surfacePiSessionId) {
          throw new StateContractError({
            operation: "structured-session.bindRuntimeGeneratedContext",
            reason: "not-found",
            message: `Orchestrator surface ${bindingInput.target.surfacePiSessionId} was not found.`,
          });
        }
        ownerKind = "session";
        ownerId = bindingInput.target.workspaceSessionId;
        this.db
          .query(
            `UPDATE session SET generated_agent_context_fingerprint = ?,
               update_extension_context_before_next_turn = 0,
               loaded_extension_ids_json = ?, available_extension_ids_json = ?, updated_at = ?
             WHERE session_id = ?`,
          )
          .run(
            bindingInput.fingerprint,
            toJson(normalizeStringList(bindingInput.loadedExtensionIds)),
            toJson(normalizeStringList(bindingInput.availableExtensionIds)),
            this.now(),
            bindingInput.target.workspaceSessionId,
          );
      } else if (bindingInput.target.surface === "handler") {
        const thread = this.mustFindThreadRow(bindingInput.target.threadId);
        if (thread.surface_pi_session_id !== bindingInput.target.surfacePiSessionId) {
          throw new StateContractError({
            operation: "structured-session.bindRuntimeGeneratedContext",
            reason: "not-found",
            message: `Handler surface ${bindingInput.target.surfacePiSessionId} was not found.`,
          });
        }
        ownerKind = "thread";
        ownerId = bindingInput.target.threadId;
        this.db
          .query(
            `UPDATE thread SET generated_agent_context_fingerprint = ?,
               update_extension_context_before_next_turn = 0,
               loaded_extension_ids_json = ?, available_extension_ids_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            bindingInput.fingerprint,
            toJson(normalizeStringList(bindingInput.loadedExtensionIds)),
            toJson(normalizeStringList(bindingInput.availableExtensionIds)),
            this.now(),
            bindingInput.target.threadId,
          );
      } else {
        const attempt = this.mustFindWorkflowTaskAttemptRecord(
          bindingInput.target.workflowTaskAttemptId,
        );
        if (attempt.surfacePiSessionId !== bindingInput.target.surfacePiSessionId) {
          throw new StateContractError({
            operation: "structured-session.bindRuntimeGeneratedContext",
            reason: "not-found",
            message: `Workflow-task surface ${bindingInput.target.surfacePiSessionId} was not found.`,
          });
        }
        ownerKind = "workflow-task-attempt";
        ownerId = bindingInput.target.workflowTaskAttemptId;
        this.db
          .query(
            `UPDATE workflow_task_attempt SET generated_agent_context_fingerprint = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(bindingInput.fingerprint, this.now(), bindingInput.target.workflowTaskAttemptId);
      }
      return this.upsertGeneratedAgentContextBinding({
        surfacePiSessionId: bindingInput.target.surfacePiSessionId,
        ownerKind,
        ownerId,
        actorKind: bindingInput.actorKind,
        systemPrompt: bindingInput.systemPrompt,
        svvyxGuidance: bindingInput.svvyxGuidance,
        commandsDts: bindingInput.commandsDts,
        nativeToolSchemasJson: bindingInput.nativeToolSchemasJson,
        generatedAgentContextFingerprint: bindingInput.fingerprint,
        generatedAgentContextRevision,
        loadedExtensionIds: [...bindingInput.loadedExtensionIds],
        availableExtensionIds: [...bindingInput.availableExtensionIds],
        externalSourceHashes: [...bindingInput.externalSourceHashes],
      });
    })(input);
  }

  getGeneratedAgentContextBinding(input: {
    surfacePiSessionId: string;
    generatedAgentContextFingerprint?: string | null;
  }): StructuredGeneratedAgentContextBindingRecord | null {
    const row = input.generatedAgentContextFingerprint
      ? (this.db
          .query(
            `SELECT * FROM generated_agent_context_binding
             WHERE surface_pi_session_id = ? AND generated_agent_context_fingerprint = ?
             LIMIT 1`,
          )
          .get(input.surfacePiSessionId, input.generatedAgentContextFingerprint) as
          | GeneratedAgentContextBindingRow
          | undefined)
      : (this.db
          .query(
            `SELECT * FROM generated_agent_context_binding
             WHERE surface_pi_session_id = ?
             ORDER BY updated_at DESC, rowid DESC
             LIMIT 1`,
          )
          .get(input.surfacePiSessionId) as GeneratedAgentContextBindingRow | undefined);
    return row ? this.mapGeneratedAgentContextBinding(row) : null;
  }

  updatePiSessionExtensionState(input: {
    sessionId: string;
    loadedExtensionIds: string[];
    availableExtensionIds: string[];
  }): StructuredPiSessionRecord {
    const existing = this.mustFindSessionRow(input.sessionId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET loaded_extension_ids_json = ?,
             available_extension_ids_json = ?,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(
        toJson(normalizeStringList(input.loadedExtensionIds)),
        toJson(normalizeStringList(input.availableExtensionIds)),
        timestamp,
        existing.session_id,
      );
    this.recordEvent({
      sessionId: existing.session_id,
      kind: "session.updated",
      subjectKind: "session",
      subjectId: existing.session_id,
      at: timestamp,
    });
    return this.mapPiSession(this.mustFindSessionRow(existing.session_id));
  }

  applySnapshotContextImpact(
    input: ApplyRuntimeExtensionSnapshotContextImpactInput,
  ): readonly RuntimeExtensionContextChangedSurface[] {
    const affectedExtensionIds = new Set(input.affectedExtensionIds);
    const affectedUsageProfiles = new Set<RuntimeExtensionUsageProfileKey>(
      input.affectedUsageProfiles,
    );
    const removedUserExtensionIds = new Set(input.removedUserExtensionIds);
    if (
      affectedExtensionIds.size === 0 &&
      affectedUsageProfiles.size === 0 &&
      removedUserExtensionIds.size === 0
    ) {
      return [];
    }

    const applyImpact = this.db.transaction(() => {
      const affected: RuntimeExtensionContextChangedSurface[] = [];
      for (const snapshot of this.listSessionStates()) {
        const piLoaded = snapshot.pi.loadedExtensionIds ?? [];
        const piAvailable = snapshot.pi.availableExtensionIds ?? [];
        const orchestratorProfileId = snapshot.pi.orchestratorAgentProfileId;
        if (
          structuredExtensionListsIntersect([piLoaded, piAvailable], affectedExtensionIds) ||
          (orchestratorProfileId !== undefined &&
            affectedUsageProfiles.has(structuredOrchestratorUsageProfileKey(orchestratorProfileId)))
        ) {
          const updated = this.updatePiSessionExtensionState({
            sessionId: snapshot.pi.sessionId,
            loadedExtensionIds: structuredDropExtensionIds(piLoaded, removedUserExtensionIds),
            availableExtensionIds: structuredDropExtensionIds(piAvailable, removedUserExtensionIds),
          });
          affected.push(structuredExtensionContextChangedSurface(updated.sessionId));
        }

        for (const thread of snapshot.threads) {
          if (
            !structuredExtensionListsIntersect(
              [thread.loadedExtensionIds, thread.availableExtensionIds],
              affectedExtensionIds,
            ) &&
            !affectedUsageProfiles.has("handler:threadHandler")
          ) {
            continue;
          }
          const updated = this.updateThread({
            threadId: thread.id,
            loadedExtensionIds: structuredDropExtensionIds(
              thread.loadedExtensionIds,
              removedUserExtensionIds,
            ),
            availableExtensionIds: structuredDropExtensionIds(
              thread.availableExtensionIds,
              removedUserExtensionIds,
            ),
          });
          affected.push(structuredExtensionContextChangedSurface(updated.surfacePiSessionId));
        }
      }
      return affected;
    });

    return applyImpact();
  }

  isSessionDeleted(sessionId: string): boolean {
    const row = this.db
      .query(`SELECT session_id FROM deleted_session WHERE session_id = ?`)
      .get(sessionId);
    return Boolean(row);
  }

  queueTitleGeneration(sessionId: string): StructuredPiSessionRecord | null {
    const row = this.ensureSessionRow(sessionId);
    const status = row.title_generation_status ?? "not-started";
    if (
      row.title_auto_frozen ||
      row.title_manual_override ||
      status === "pending" ||
      status === "running" ||
      status === "completed"
    ) {
      return null;
    }
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET title_generation_status = 'pending',
             title_generation_triggered_at = ?,
             title_generation_finished_at = NULL,
             title_generation_error = NULL,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(timestamp, timestamp, sessionId);
    this.recordEvent({
      sessionId,
      kind: "session.title_generation.queued",
      subjectKind: "session",
      subjectId: sessionId,
      data: { status: "pending" },
    });
    return this.mapPiSession(this.mustFindSessionRow(sessionId));
  }

  markTitleGenerationRunning(sessionId: string): StructuredPiSessionRecord {
    const timestamp = this.now();
    this.ensureSessionRow(sessionId);
    this.db
      .query(
        `UPDATE session
         SET title_generation_status = 'running',
             title_generation_error = NULL,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(timestamp, sessionId);
    this.recordEvent({
      sessionId,
      kind: "session.title_generation.started",
      subjectKind: "session",
      subjectId: sessionId,
      data: { status: "running" },
    });
    return this.mapPiSession(this.mustFindSessionRow(sessionId));
  }

  completeTitleGeneration(input: { sessionId: string; title: string }): StructuredPiSessionRecord {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Generated session title cannot be empty.");
    }
    const timestamp = this.now();
    this.ensureSessionRow(input.sessionId);
    this.db
      .query(
        `UPDATE session
         SET title = ?,
             title_generation_status = 'completed',
             title_generation_finished_at = ?,
             title_generation_error = NULL,
             title_auto_frozen = 1,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(title, timestamp, timestamp, input.sessionId);
    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.title_generation.completed",
      subjectKind: "session",
      subjectId: input.sessionId,
      data: { title },
    });
    return this.mapPiSession(this.mustFindSessionRow(input.sessionId));
  }

  failTitleGeneration(input: { sessionId: string; error: string }): StructuredPiSessionRecord {
    const timestamp = this.now();
    this.ensureSessionRow(input.sessionId);
    this.db
      .query(
        `UPDATE session
         SET title_generation_status = 'failed',
             title_generation_finished_at = ?,
             title_generation_error = ?,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(timestamp, input.error, timestamp, input.sessionId);
    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.title_generation.failed",
      subjectKind: "session",
      subjectId: input.sessionId,
      data: { error: input.error },
    });
    return this.mapPiSession(this.mustFindSessionRow(input.sessionId));
  }

  markManualTitleOverride(input: { sessionId: string; title: string }): StructuredPiSessionRecord {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Session title cannot be empty.");
    }
    const timestamp = this.now();
    this.ensureSessionRow(input.sessionId);
    this.db
      .query(
        `UPDATE session
         SET title = ?,
             title_auto_frozen = 1,
             title_manual_override = 1,
             title_generation_status = CASE
               WHEN title_generation_status IN ('pending', 'running') THEN 'cancelled'
               ELSE title_generation_status
             END,
             title_generation_finished_at = CASE
               WHEN title_generation_status IN ('pending', 'running') THEN ?
               ELSE title_generation_finished_at
             END,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(title, timestamp, timestamp, input.sessionId);
    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.title.manual_override",
      subjectKind: "session",
      subjectId: input.sessionId,
      data: { title },
    });
    return this.mapPiSession(this.mustFindSessionRow(input.sessionId));
  }

  setSessionExtensionContextAutoUpdate(input: {
    sessionId: string;
    enabled: boolean;
  }): StructuredPiSessionRecord {
    const existing = this.mustFindSessionRow(input.sessionId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET update_extension_context_before_next_turn = ?,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(input.enabled ? 1 : 0, timestamp, input.sessionId);
    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.extension_context_auto_update.updated",
      subjectKind: "session",
      subjectId: input.sessionId,
      data: {
        surfacePiSessionId: existing.orchestrator_pi_session_id,
        enabled: input.enabled,
      },
    });
    return this.mapPiSession(this.mustFindSessionRow(input.sessionId));
  }

  setThreadExtensionContextAutoUpdate(input: {
    threadId: string;
    enabled: boolean;
  }): StructuredThreadRecord {
    const existing = this.mustFindThreadRow(input.threadId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE thread
         SET update_extension_context_before_next_turn = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(input.enabled ? 1 : 0, timestamp, input.threadId);
    this.recordEvent({
      sessionId: existing.session_id,
      kind: "thread.extension_context_auto_update.updated",
      subjectKind: "thread",
      subjectId: input.threadId,
      data: {
        surfacePiSessionId: existing.surface_pi_session_id,
        enabled: input.enabled,
      },
    });
    return this.mustFindThreadRecord(input.threadId);
  }

  getComposerDraft(surfacePiSessionId: string): StructuredComposerDraftRecord | null {
    const row =
      (this.db
        .query(`SELECT * FROM surface_composer_draft WHERE surface_pi_session_id = ? LIMIT 1`)
        .get(surfacePiSessionId) as ComposerDraftRow | undefined) ?? null;
    return row ? this.mapComposerDraft(row) : null;
  }

  listPromptHistory(input: { workspaceId: string }): StructuredPromptHistoryRecord[] {
    if (input.workspaceId !== this.workspace.id) {
      throw new StateContractError({
        operation: "structured-session.listPromptHistory",
        reason: "invalid-input",
        message: `Workspace ${input.workspaceId} is not managed by this state store.`,
      });
    }
    const rows = this.db
      .query(
        `SELECT workspace_id,
                workspace_session_id,
                surface_pi_session_id,
                queue_item_id,
                text,
                sent_at
         FROM prompt_history
         WHERE workspace_id = ?
         ORDER BY sent_at ASC, rowid ASC`,
      )
      .all(input.workspaceId) as PromptHistoryRow[];
    return rows.map((row) => ({
      workspaceId: row.workspace_id,
      workspaceSessionId: row.workspace_session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      queueItemId: row.queue_item_id,
      text: row.text,
      sentAt: row.sent_at,
    }));
  }

  setComposerDraft(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    text: string;
    attachments?: ComposerAttachment[];
    snippetMentions?: ComposerSnippetMention[];
  }): StructuredComposerDraftRecord | null {
    this.ensureSessionRow(input.sessionId);
    const text = input.text;
    const attachments = input.attachments ?? [];
    const snippetMentions = input.snippetMentions ?? [];
    const timestamp = this.now();

    if (!text.trim() && attachments.length === 0 && snippetMentions.length === 0) {
      this.db
        .query(`DELETE FROM surface_composer_draft WHERE surface_pi_session_id = ?`)
        .run(input.surfacePiSessionId);
      this.db
        .query(`UPDATE session SET updated_at = ? WHERE session_id = ?`)
        .run(timestamp, input.sessionId);
      this.recordEvent({
        sessionId: input.sessionId,
        kind: "surface.composer_draft.cleared",
        subjectKind: "session",
        subjectId: input.sessionId,
        at: timestamp,
        data: { threadId: input.threadId ?? null },
      });
      return null;
    }

    this.db
      .query(
        `INSERT INTO surface_composer_draft (
           session_id,
           surface_pi_session_id,
           thread_id,
           text,
           attachments_json,
           snippet_mentions_json,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(surface_pi_session_id) DO UPDATE SET
           session_id = excluded.session_id,
           thread_id = excluded.thread_id,
           text = excluded.text,
           attachments_json = excluded.attachments_json,
           snippet_mentions_json = excluded.snippet_mentions_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.sessionId,
        input.surfacePiSessionId,
        input.threadId ?? null,
        text,
        toJson(attachments),
        toJson(snippetMentions),
        timestamp,
      );
    this.db
      .query(`UPDATE session SET updated_at = ? WHERE session_id = ?`)
      .run(timestamp, input.sessionId);
    this.recordEvent({
      sessionId: input.sessionId,
      kind: "surface.composer_draft.updated",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: { threadId: input.threadId ?? null },
    });
    return this.getComposerDraft(input.surfacePiSessionId);
  }

  startTurn(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    requestSummary: string;
  }): StructuredTurnRecord {
    const timestamp = this.now();
    this.ensureSessionRow(input.sessionId);

    const threadId = input.threadId ?? null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    if (threadId && thread) {
      if (thread.status !== "running-handler" || thread.wait_kind || thread.wait_owner) {
        this.db
          .query(
            `UPDATE thread
             SET status = ?, wait_owner = NULL, wait_kind = NULL, wait_reason = NULL, wait_resume_when = NULL, wait_since = NULL, updated_at = ?, finished_at = NULL
             WHERE id = ?`,
          )
          .run("running-handler", timestamp, threadId);
        this.recordEvent({
          sessionId: thread.session_id,
          kind: "thread.updated",
          subjectKind: "thread",
          subjectId: threadId,
          at: timestamp,
        });
      }

      const sessionWait = this.mapSessionWait(this.mustFindSessionRow(input.sessionId));
      if (sessionWait?.owner.kind === "thread" && sessionWait.owner.threadId === threadId) {
        this.clearSessionWait({ sessionId: input.sessionId });
      }
    } else {
      const sessionWait = this.mapSessionWait(this.mustFindSessionRow(input.sessionId));
      if (sessionWait?.owner.kind === "orchestrator") {
        this.clearSessionWait({ sessionId: input.sessionId });
      }
    }

    const turnId = this.createId("turn");
    this.db
      .query(
        `INSERT INTO turn (
           id,
           session_id,
           surface_pi_session_id,
           thread_id,
           request_summary,
           turn_decision,
           status,
           assistant_message_id,
           assistant_text,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turnId,
        input.sessionId,
        input.surfacePiSessionId,
        threadId,
        input.requestSummary,
        "pending",
        "running",
        null,
        null,
        timestamp,
        timestamp,
        null,
      );

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "turn.started",
      subjectKind: "turn",
      subjectId: turnId,
      at: timestamp,
    });

    return this.mustFindTurnRecord(turnId);
  }

  setTurnDecision(input: {
    turnId: string;
    decision: Exclude<StructuredTurnDecision, "pending">;
    onlyIfPending?: boolean;
  }): StructuredTurnRecord {
    const existing = this.mustFindTurnRow(input.turnId);
    if (input.onlyIfPending && existing.turn_decision !== "pending") {
      return this.mustFindTurnRecord(input.turnId);
    }

    if (existing.turn_decision === input.decision) {
      return this.mustFindTurnRecord(input.turnId);
    }

    const timestamp = this.now();
    this.db
      .query(
        `UPDATE turn
         SET turn_decision = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.decision, timestamp, input.turnId);

    this.recordEvent({
      sessionId: existing.session_id,
      kind: "turn.decision",
      subjectKind: "turn",
      subjectId: input.turnId,
      at: timestamp,
      data: {
        decision: input.decision,
      },
    });

    return this.mustFindTurnRecord(input.turnId);
  }

  commitRuntimeTranscriptUserMessage(
    input: CommitRuntimeTranscriptUserMessageInput,
  ): RuntimeTranscriptUserMutation {
    return this.db.transaction(() => {
      const turn = this.mustFindTurnRow(input.turnId);
      if (
        turn.session_id !== input.workspaceSessionId ||
        turn.surface_pi_session_id !== input.surfacePiSessionId
      ) {
        throw this.transcriptStateError(
          "commitUserMessage",
          "conflict",
          `Turn ${input.turnId} does not belong to transcript surface ${input.surfacePiSessionId}.`,
        );
      }
      const normalizedMessage = decodeRuntimeSubmittedMessageContract(input.message);
      const existing = this.db
        .query(`SELECT * FROM transcript_message WHERE queue_item_id = ? LIMIT 1`)
        .get(input.queueItemId) as TranscriptMessageRow | undefined;
      if (existing) {
        if (
          existing.role !== "user" ||
          existing.session_id !== input.workspaceSessionId ||
          existing.surface_pi_session_id !== input.surfacePiSessionId ||
          existing.turn_id !== input.turnId ||
          existing.user_message_json !== toJson(normalizedMessage) ||
          existing.submitted_at !== input.submittedAt ||
          existing.committed_at !== input.committedAt
        ) {
          throw this.transcriptStateError(
            "commitUserMessage",
            "conflict",
            `Queue item ${input.queueItemId} is already bound to a different transcript message.`,
          );
        }
        const cursor = this.mustReadRuntimeTranscriptStreamCursor(input.surfacePiSessionId);
        return { message: this.mapRuntimeTranscriptUserMessage(existing), cursor };
      }

      const cursor = this.advanceRuntimeTranscriptCursorRow({
        surfacePiSessionId: input.surfacePiSessionId,
        streamGenerationId: input.streamGenerationId,
        expectedCursor: input.expectedCursor,
        activeAssistantMessageId: null,
      });
      const messageId = this.createId("message");
      const ordinal = this.nextRuntimeTranscriptMessageOrdinal(input.surfacePiSessionId);
      this.db
        .query(
          `INSERT INTO transcript_message (
             message_id, session_id, surface_pi_session_id, turn_id, queue_item_id, ordinal,
             role, status, user_message_json, api, provider_id, model_id, response_id,
             usage_json, stop_reason, error_message, pi_history_entry_id,
             pi_history_entry_json, submitted_at, committed_at, started_at,
             message_timestamp, updated_at, finished_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'user', NULL, ?, NULL, NULL, NULL, NULL,
             NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, ?, NULL)`,
        )
        .run(
          messageId,
          input.workspaceSessionId,
          input.surfacePiSessionId,
          input.turnId,
          input.queueItemId,
          ordinal,
          toJson(normalizedMessage),
          input.submittedAt,
          input.committedAt,
          input.committedAt,
        );
      this.bumpStateRevision();
      return {
        message: this.mapRuntimeTranscriptUserMessage(this.mustFindTranscriptMessageRow(messageId)),
        cursor,
      };
    })();
  }

  beginRuntimeTranscriptAssistantMessage(
    input: BeginRuntimeTranscriptAssistantMessageInput,
  ): RuntimeTranscriptAssistantMutation {
    return this.db.transaction(() => {
      const turn = this.mustFindTurnRow(input.turnId);
      if (
        turn.session_id !== input.workspaceSessionId ||
        turn.surface_pi_session_id !== input.surfacePiSessionId
      ) {
        throw this.transcriptStateError(
          "beginAssistantMessage",
          "conflict",
          `Turn ${input.turnId} does not belong to transcript surface ${input.surfacePiSessionId}.`,
        );
      }
      const currentCursor = this.readRuntimeTranscriptStreamCursorRow(input.surfacePiSessionId);
      if (currentCursor?.active_assistant_message_id) {
        throw this.transcriptStateError(
          "beginAssistantMessage",
          "conflict",
          `Transcript surface ${input.surfacePiSessionId} already has an active assistant message.`,
        );
      }
      const messageId = this.createId("message");
      const cursor = this.advanceRuntimeTranscriptCursorRow({
        surfacePiSessionId: input.surfacePiSessionId,
        streamGenerationId: input.streamGenerationId,
        expectedCursor: input.expectedCursor,
        activeAssistantMessageId: messageId,
      });
      const ordinal = this.nextRuntimeTranscriptMessageOrdinal(input.surfacePiSessionId);
      this.db
        .query(
          `INSERT INTO transcript_message (
             message_id, session_id, surface_pi_session_id, turn_id, queue_item_id, ordinal,
             role, status, user_message_json, api, provider_id, model_id, response_id,
             usage_json, stop_reason, error_message, pi_history_entry_id,
             pi_history_entry_json, submitted_at, committed_at, started_at,
             message_timestamp, updated_at, finished_at
           ) VALUES (?, ?, ?, ?, NULL, ?, 'assistant', 'streaming', NULL, ?, ?, ?, NULL,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, NULL)`,
        )
        .run(
          messageId,
          input.workspaceSessionId,
          input.surfacePiSessionId,
          input.turnId,
          ordinal,
          input.api,
          input.providerId,
          input.modelId,
          input.startedAt,
          input.startedAt,
        );
      this.bumpStateRevision();
      return { message: this.mustReadRuntimeTranscriptAssistantMessage(messageId), cursor };
    })();
  }

  appendRuntimeTranscriptAssistantContentDelta(
    input: AppendRuntimeTranscriptAssistantContentDeltaInput,
  ): RuntimeTranscriptAssistantMutation {
    return this.db.transaction(() => {
      const message = this.mustFindStreamingTranscriptAssistantRow(
        input.messageId,
        input.surfacePiSessionId,
        "appendAssistantContentDelta",
      );
      const cursor = this.advanceRuntimeTranscriptCursorRow({
        surfacePiSessionId: input.surfacePiSessionId,
        streamGenerationId: input.streamGenerationId,
        expectedCursor: input.expectedCursor,
        activeAssistantMessageId: input.messageId,
      });
      const timestamp = this.now();
      const existing = this.findRuntimeTranscriptContentBlockRow(
        input.messageId,
        input.contentIndex,
      );
      if (!existing) {
        this.db
          .query(
            `INSERT INTO transcript_content_block (
               message_id, content_index, kind, text_content, thinking_content,
               thinking_redacted, thinking_signature, tool_call_id, tool_name,
               arguments_json, arguments_status, command_id, thought_signature,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
          )
          .run(
            input.messageId,
            input.contentIndex,
            input.kind,
            input.kind === "text" ? input.delta : null,
            input.kind === "thinking" ? input.delta : null,
            input.kind === "thinking" && input.redacted !== undefined
              ? input.redacted
                ? 1
                : 0
              : null,
            input.kind === "thinking" ? (input.thinkingSignature ?? null) : null,
            timestamp,
            timestamp,
          );
      } else {
        if (existing.kind !== input.kind) {
          throw this.transcriptStateError(
            "appendAssistantContentDelta",
            "conflict",
            `Transcript content index ${input.contentIndex} is already ${existing.kind}.`,
          );
        }
        if (
          input.kind === "thinking" &&
          ((existing.thinking_signature !== null &&
            input.thinkingSignature !== undefined &&
            existing.thinking_signature !== input.thinkingSignature) ||
            (existing.thinking_redacted !== null &&
              input.redacted !== undefined &&
              Boolean(existing.thinking_redacted) !== input.redacted))
        ) {
          throw this.transcriptStateError(
            "appendAssistantContentDelta",
            "conflict",
            `Transcript thinking metadata at content index ${input.contentIndex} is immutable.`,
          );
        }
        this.db
          .query(
            input.kind === "text"
              ? `UPDATE transcript_content_block
                 SET text_content = text_content || ?, updated_at = ?
                 WHERE message_id = ? AND content_index = ?`
              : `UPDATE transcript_content_block
                 SET thinking_content = thinking_content || ?,
                     thinking_redacted = COALESCE(thinking_redacted, ?),
                     thinking_signature = COALESCE(thinking_signature, ?),
                     updated_at = ?
                 WHERE message_id = ? AND content_index = ?`,
          )
          .run(
            ...(input.kind === "text"
              ? [input.delta, timestamp, input.messageId, input.contentIndex]
              : [
                  input.delta,
                  input.redacted === undefined ? null : input.redacted ? 1 : 0,
                  input.thinkingSignature ?? null,
                  timestamp,
                  input.messageId,
                  input.contentIndex,
                ]),
          );
      }
      this.db
        .query(`UPDATE transcript_message SET updated_at = ? WHERE message_id = ?`)
        .run(timestamp, message.message_id);
      this.bumpStateRevision();
      return { message: this.mustReadRuntimeTranscriptAssistantMessage(input.messageId), cursor };
    })();
  }

  upsertRuntimeTranscriptAssistantToolCall(
    input: UpsertRuntimeTranscriptAssistantToolCallInput,
  ): RuntimeTranscriptAssistantMutation {
    return this.db.transaction(() => {
      this.mustFindStreamingTranscriptAssistantRow(
        input.messageId,
        input.surfacePiSessionId,
        "upsertAssistantToolCall",
      );
      const existing = this.findRuntimeTranscriptContentBlockRow(
        input.messageId,
        input.contentIndex,
      );
      if (
        existing &&
        (existing.kind !== "tool-call" ||
          existing.tool_call_id !== input.toolCallId ||
          existing.tool_name !== input.toolName)
      ) {
        throw this.transcriptStateError(
          "upsertAssistantToolCall",
          "conflict",
          `Transcript content index ${input.contentIndex} is already bound to different content.`,
        );
      }
      if (
        existing?.arguments_status === "accepted" &&
        (input.argumentsStatus !== "accepted" || existing.arguments_json !== input.argumentsJson)
      ) {
        throw this.transcriptStateError(
          "upsertAssistantToolCall",
          "conflict",
          `Accepted tool arguments for ${input.toolCallId} are immutable.`,
        );
      }
      if (
        existing?.thought_signature &&
        input.thoughtSignature !== undefined &&
        existing.thought_signature !== input.thoughtSignature
      ) {
        throw this.transcriptStateError(
          "upsertAssistantToolCall",
          "conflict",
          `Tool thought signature for ${input.toolCallId} is immutable.`,
        );
      }

      const cursor = this.advanceRuntimeTranscriptCursorRow({
        surfacePiSessionId: input.surfacePiSessionId,
        streamGenerationId: input.streamGenerationId,
        expectedCursor: input.expectedCursor,
        activeAssistantMessageId: input.messageId,
      });
      const timestamp = this.now();
      if (!existing) {
        this.db
          .query(
            `INSERT INTO transcript_content_block (
               message_id, content_index, kind, text_content, thinking_content,
               thinking_redacted, thinking_signature, tool_call_id, tool_name,
               arguments_json, arguments_status, command_id, thought_signature,
               created_at, updated_at
             ) VALUES (?, ?, 'tool-call', NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?, ?)`,
          )
          .run(
            input.messageId,
            input.contentIndex,
            input.toolCallId,
            input.toolName,
            input.argumentsJson,
            input.argumentsStatus,
            input.thoughtSignature ?? null,
            timestamp,
            timestamp,
          );
      } else {
        this.db
          .query(
            `UPDATE transcript_content_block
             SET arguments_json = ?, arguments_status = ?,
                 thought_signature = COALESCE(thought_signature, ?), updated_at = ?
             WHERE message_id = ? AND content_index = ?`,
          )
          .run(
            input.argumentsJson,
            input.argumentsStatus,
            input.thoughtSignature ?? null,
            timestamp,
            input.messageId,
            input.contentIndex,
          );
      }
      this.db
        .query(`UPDATE transcript_message SET updated_at = ? WHERE message_id = ?`)
        .run(timestamp, input.messageId);
      this.bumpStateRevision();
      return { message: this.mustReadRuntimeTranscriptAssistantMessage(input.messageId), cursor };
    })();
  }

  linkRuntimeTranscriptAssistantToolCallCommand(
    input: LinkRuntimeTranscriptAssistantToolCallCommandInput,
  ): RuntimeTranscriptAssistantMutation {
    return this.db.transaction(() => {
      this.mustFindStreamingTranscriptAssistantRow(
        input.messageId,
        input.surfacePiSessionId,
        "linkAssistantToolCallCommand",
      );
      const block = this.findRuntimeTranscriptContentBlockRow(input.messageId, input.contentIndex);
      if (!block || block.kind !== "tool-call" || block.tool_call_id !== input.toolCallId) {
        throw this.transcriptStateError(
          "linkAssistantToolCallCommand",
          "not-found",
          `Tool call ${input.toolCallId} was not found at transcript content index ${input.contentIndex}.`,
        );
      }
      if (block.command_id && block.command_id !== input.commandId) {
        throw this.transcriptStateError(
          "linkAssistantToolCallCommand",
          "conflict",
          `Tool call ${input.toolCallId} is already linked to command ${block.command_id}.`,
        );
      }
      if (block.command_id === input.commandId) {
        return {
          message: this.mustReadRuntimeTranscriptAssistantMessage(input.messageId),
          cursor: this.mustReadRuntimeTranscriptStreamCursor(input.surfacePiSessionId),
        };
      }
      const cursor = this.advanceRuntimeTranscriptCursorRow({
        surfacePiSessionId: input.surfacePiSessionId,
        streamGenerationId: input.streamGenerationId,
        expectedCursor: input.expectedCursor,
        activeAssistantMessageId: input.messageId,
      });
      const timestamp = this.now();
      this.db
        .query(
          `UPDATE transcript_content_block
           SET command_id = ?, updated_at = ?
           WHERE message_id = ? AND content_index = ?`,
        )
        .run(input.commandId, timestamp, input.messageId, input.contentIndex);
      this.db
        .query(`UPDATE transcript_message SET updated_at = ? WHERE message_id = ?`)
        .run(timestamp, input.messageId);
      this.bumpStateRevision();
      return { message: this.mustReadRuntimeTranscriptAssistantMessage(input.messageId), cursor };
    })();
  }

  commitRuntimeTranscriptAssistantMessage(
    input: CommitRuntimeTranscriptAssistantMessageInput,
  ): RuntimeTranscriptAssistantMutation {
    return this.finalizeRuntimeTranscriptAssistantMessage({
      ...input,
      status: "completed",
      content: decodeRuntimeTranscriptAssistantContentContract(input.content),
    });
  }

  failRuntimeTranscriptAssistantMessage(
    input: FailRuntimeTranscriptAssistantMessageInput,
  ): RuntimeTranscriptAssistantMutation {
    return this.finalizeRuntimeTranscriptAssistantMessage({ ...input, content: null });
  }

  bindRuntimeTranscriptPiHistoryEntry(
    input: BindRuntimeTranscriptPiHistoryEntryInput,
  ): RuntimeTranscriptMessage {
    return this.db.transaction(() => {
      const row = this.mustFindTranscriptMessageRow(input.messageId);
      const history = decodePiHistoryEntryRefContract(input.piHistoryEntry);
      this.assertRuntimeTranscriptPiHistoryEntry(row, history, "bindPiHistoryEntry");
      if (row.pi_history_entry_id) {
        if (row.pi_history_entry_json !== toJson(history)) {
          throw this.transcriptStateError(
            "bindPiHistoryEntry",
            "conflict",
            `Transcript message ${input.messageId} already has a different Pi history entry.`,
          );
        }
        return this.mapRuntimeTranscriptMessage(row);
      }
      this.db
        .query(
          `UPDATE transcript_message
           SET pi_history_entry_id = ?, pi_history_entry_json = ?, updated_at = ?
           WHERE message_id = ?`,
        )
        .run(history.entryId, toJson(history), this.now(), input.messageId);
      this.bumpStateRevision();
      return this.mapRuntimeTranscriptMessage(this.mustFindTranscriptMessageRow(input.messageId));
    })();
  }

  advanceRuntimeTranscriptStreamCursor(
    input: AdvanceRuntimeTranscriptStreamCursorInput,
  ): RuntimeTranscriptStreamCursor {
    return this.db.transaction(() => {
      const current = this.readRuntimeTranscriptStreamCursorRow(input.surfacePiSessionId);
      const cursor = this.advanceRuntimeTranscriptCursorRow({
        surfacePiSessionId: input.surfacePiSessionId,
        streamGenerationId: input.streamGenerationId,
        expectedCursor: input.expectedCursor,
        activeAssistantMessageId: current?.active_assistant_message_id ?? null,
      });
      this.bumpStateRevision();
      return cursor;
    })();
  }

  readRuntimeSurfaceTranscript(surfacePiSessionId: string): RuntimeSurfaceTranscriptSnapshot {
    const rows = this.db
      .query(
        `SELECT * FROM transcript_message
         WHERE surface_pi_session_id = ?
         ORDER BY ordinal ASC`,
      )
      .all(surfacePiSessionId) as TranscriptMessageRow[];
    const activeRow = rows.find((row) => row.role === "assistant" && row.status === "streaming");
    return {
      surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
      messages: rows
        .filter((row) => row !== activeRow)
        .map((row) => this.mapRuntimeTranscriptMessage(row)),
      activeAssistantMessage: activeRow
        ? this.mapRuntimeTranscriptAssistantMessage(activeRow)
        : null,
      streamCursor: this.readRuntimeTranscriptStreamCursor(surfacePiSessionId),
    };
  }

  finishTurn(input: {
    turnId: string;
    status: Exclude<StructuredTurnStatus, "running">;
    assistantMessageId?: string;
    assistantText?: string;
  }): StructuredTurnRecord {
    const existing = this.mustFindTurnRow(input.turnId);
    const timestamp = this.now();
    const finishedAt = input.status === "waiting" ? null : timestamp;
    this.db
      .query(
        `UPDATE turn
         SET status = ?,
             assistant_message_id = COALESCE(?, assistant_message_id),
             assistant_text = COALESCE(?, assistant_text),
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status,
        input.assistantMessageId ?? null,
        input.assistantText ?? null,
        timestamp,
        finishedAt,
        input.turnId,
      );

    this.recordEvent({
      sessionId: existing.session_id,
      kind:
        input.status === "waiting"
          ? "turn.waiting"
          : input.status === "failed"
            ? "turn.failed"
            : input.status === "cancelled"
              ? "turn.cancelled"
              : "turn.completed",
      subjectKind: "turn",
      subjectId: input.turnId,
      at: timestamp,
    });

    return this.mustFindTurnRecord(input.turnId);
  }

  recoverInterruptedTurn(input: {
    turnId: string;
    terminalStatus: "failed" | "cancelled";
    reason: string;
  }): StructuredInterruptedTurnRecoveryResult {
    const recover = this.db.transaction(() => {
      const initialTurn = this.mustFindTurnRecord(input.turnId);
      if (initialTurn.status !== "running" && initialTurn.status !== "waiting") {
        return {
          changed: false,
          turn: initialTurn,
          terminalizedAssistantMessageId: null,
          terminalizedCommandIds: [],
          settledQueueItemId: null,
          cancelledRequestInputIds: [],
          cancelledApprovalIds: [],
          sessionWaitCleared: false,
        };
      }
      const initialSessionWait = this.mapSessionWait(
        this.mustFindSessionRow(initialTurn.sessionId),
      );
      const initialSessionWaitOwnedByTurn = initialTurn.threadId
        ? initialSessionWait?.owner.kind === "thread" &&
          initialSessionWait.owner.threadId === initialTurn.threadId
        : initialSessionWait?.owner.kind === "orchestrator";
      const terminalizedCommandIds: string[] = [];
      const cancelledRequestInputIds = (
        this.db
          .query(
            `SELECT * FROM request_user_input_request
             WHERE turn_id = ? AND variant = 'blocking' AND status = 'open'
             ORDER BY created_at ASC`,
          )
          .all(input.turnId) as RequestUserInputRequestRow[]
      ).map((request) => {
        const command = this.mustFindCommandRecord(request.command_id);
        this.cancelRequestUserInputRequest({
          requestId: request.id,
          terminalCommandStatus: input.terminalStatus,
          reason: input.reason,
        });
        if (!isTerminalCommandStatus(command.status)) {
          terminalizedCommandIds.push(command.id);
        }
        return request.id;
      });
      const cancelledApprovalIds = (
        this.db
          .query(
            `SELECT * FROM runtime_approval_request
             WHERE turn_id = ? AND status = 'pending'
             ORDER BY created_at ASC`,
          )
          .all(input.turnId) as RuntimeApprovalRequestRow[]
      ).map((approval) => {
        const command = approval.command_id
          ? this.mustFindCommandRecord(approval.command_id)
          : null;
        this.resolveRuntimeApprovalRequest({
          requestId: approval.id,
          status: "cancelled",
          reviewer: "user",
          decisionReason: input.reason,
          terminalCommandStatus: input.terminalStatus,
        });
        if (command && !isTerminalCommandStatus(command.status)) {
          terminalizedCommandIds.push(command.id);
        }
        return approval.id;
      });

      const remainingCommands = this.db
        .query(
          `SELECT * FROM command
             WHERE turn_id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')
             ORDER BY started_at ASC, id ASC`,
        )
        .all(input.turnId) as CommandRow[];
      for (const command of remainingCommands) {
        this.finishCommand({
          commandId: command.id,
          status: input.terminalStatus,
          summary: input.reason,
          error: input.reason,
        });
        terminalizedCommandIds.push(command.id);
      }

      const activeAssistant =
        (this.db
          .query(
            `SELECT * FROM transcript_message
             WHERE turn_id = ? AND role = 'assistant' AND status = 'streaming'
             LIMIT 1`,
          )
          .get(input.turnId) as TranscriptMessageRow | null) ?? null;
      if (activeAssistant) {
        const cursorRow = this.readRuntimeTranscriptStreamCursorRow(
          activeAssistant.surface_pi_session_id,
        );
        if (cursorRow?.active_assistant_message_id !== activeAssistant.message_id) {
          throw this.transcriptStateError(
            "recoverInterruptedTurn",
            "conflict",
            `Interrupted transcript assistant ${activeAssistant.message_id} is not the active assistant for its surface.`,
          );
        }
        this.advanceRuntimeTranscriptCursorRow({
          surfacePiSessionId:
            activeAssistant.surface_pi_session_id as RuntimeTranscriptStreamCursor["surfacePiSessionId"],
          streamGenerationId:
            cursorRow.stream_generation_id as RuntimeTranscriptStreamCursor["streamGenerationId"],
          expectedCursor: {
            surfacePiSessionId:
              cursorRow.surface_pi_session_id as RuntimeTranscriptStreamCursor["surfacePiSessionId"],
            streamGenerationId:
              cursorRow.stream_generation_id as RuntimeTranscriptStreamCursor["streamGenerationId"],
            streamSequence:
              cursorRow.stream_sequence as RuntimeTranscriptStreamCursor["streamSequence"],
          },
          activeAssistantMessageId: null,
          clearingActiveAssistantMessageId: activeAssistant.message_id,
        });
        const timestamp = this.now();
        this.db
          .query(
            `UPDATE transcript_message
             SET status = ?, stop_reason = ?, error_message = ?, updated_at = ?, finished_at = ?
             WHERE message_id = ? AND status = 'streaming'`,
          )
          .run(
            input.terminalStatus,
            input.terminalStatus === "cancelled" ? "aborted" : "error",
            input.reason,
            timestamp,
            timestamp,
            activeAssistant.message_id,
          );
        this.bumpStateRevision();
      }

      const userTranscript = this.db
        .query(
          `SELECT * FROM transcript_message
           WHERE turn_id = ? AND role = 'user' AND queue_item_id IS NOT NULL
           LIMIT 1`,
        )
        .get(input.turnId) as TranscriptMessageRow | undefined;
      const queueRow = userTranscript?.queue_item_id
        ? (this.db
            .query(`SELECT * FROM surface_message_queue WHERE id = ? LIMIT 1`)
            .get(userTranscript.queue_item_id) as SurfaceQueuedMessageRow | undefined)
        : (this.db
            .query(
              `SELECT * FROM surface_message_queue
               WHERE session_id = ? AND surface_pi_session_id = ? AND status = 'dispatching'
               ORDER BY updated_at ASC, id ASC
               LIMIT 1`,
            )
            .get(initialTurn.sessionId, initialTurn.surfacePiSessionId) as
            | SurfaceQueuedMessageRow
            | undefined);
      let settledQueueItemId: string | null = null;
      if (queueRow?.status === "dispatching") {
        if (input.terminalStatus === "cancelled") {
          this.cancelSurfaceMessage({
            id: queueRow.id,
            claimOwnerId: queueRow.claim_owner_id,
            leaseVersion: queueRow.lease_version,
            expectedStatuses: ["dispatching"],
          });
        } else {
          this.markSurfaceMessageFailed({
            id: queueRow.id,
            failureError: input.reason,
            claimOwnerId: queueRow.claim_owner_id,
            leaseVersion: queueRow.lease_version,
          });
        }
        settledQueueItemId = queueRow.id;
      }

      const sessionWait = this.mapSessionWait(this.mustFindSessionRow(initialTurn.sessionId));
      const sessionWaitOwnedByTurn = initialTurn.threadId
        ? sessionWait?.owner.kind === "thread" &&
          sessionWait.owner.threadId === initialTurn.threadId
        : sessionWait?.owner.kind === "orchestrator";
      if (sessionWaitOwnedByTurn) {
        this.clearSessionWait({ sessionId: initialTurn.sessionId });
      }
      const sessionWaitCleared = Boolean(initialSessionWaitOwnedByTurn || sessionWaitOwnedByTurn);

      const turn =
        initialTurn.status === "running" || initialTurn.status === "waiting"
          ? this.finishTurn({ turnId: input.turnId, status: input.terminalStatus })
          : initialTurn;
      const changed =
        turn !== initialTurn ||
        activeAssistant !== null ||
        terminalizedCommandIds.length > 0 ||
        settledQueueItemId !== null ||
        cancelledRequestInputIds.length > 0 ||
        cancelledApprovalIds.length > 0 ||
        sessionWaitCleared;
      if (changed) {
        this.recordLifecycleEvent({
          sessionId: turn.sessionId,
          kind: "surface.turn_recovery.interrupted",
          subjectKind: "turn",
          subjectId: turn.id,
          data: {
            surfacePiSessionId: turn.surfacePiSessionId,
            terminalStatus: input.terminalStatus,
            reason: input.reason,
            terminalizedAssistantMessageId: activeAssistant?.message_id ?? null,
            terminalizedCommandIds,
            settledQueueItemId,
          },
        });
      }
      return {
        changed,
        turn,
        terminalizedAssistantMessageId: activeAssistant?.message_id ?? null,
        terminalizedCommandIds,
        settledQueueItemId,
        cancelledRequestInputIds,
        cancelledApprovalIds,
        sessionWaitCleared,
      };
    });
    return recover();
  }

  settlePromptTurn(input: {
    turnId: string;
    queueItemId: string;
    status: "completed" | "failed" | "cancelled";
    assistantMessageId?: string;
    assistantText?: string;
    terminalCommandIds: readonly string[];
    terminalCommandSummary: string;
    terminalCommandError: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
  }): StructuredPromptTurnSettlementResult {
    const settle = this.db.transaction(() => {
      const initialTurn = this.mustFindTurnRecord(input.turnId);
      const initialQueue = this.mustFindSurfaceQueuedMessageRecord(input.queueItemId);
      if (
        initialQueue.sessionId !== initialTurn.sessionId ||
        initialQueue.surfacePiSessionId !== initialTurn.surfacePiSessionId
      ) {
        throw new StateContractError({
          operation: "structured-session.settlePromptTurn",
          reason: "conflict",
          message: `Prompt queue item ${input.queueItemId} does not belong to turn ${input.turnId}.`,
        });
      }

      const targetQueueStatus =
        input.status === "completed"
          ? ("delivered" as const)
          : input.status === "cancelled"
            ? ("cancelled" as const)
            : ("failed" as const);
      if (
        initialTurn.status !== "running" &&
        initialTurn.status !== "waiting" &&
        initialTurn.status !== input.status
      ) {
        throw new StateContractError({
          operation: "structured-session.settlePromptTurn",
          reason: "conflict",
          message: `Turn ${input.turnId} is already terminal with ${initialTurn.status}.`,
        });
      }
      if (initialQueue.status !== "dispatching" && initialQueue.status !== targetQueueStatus) {
        throw new StateContractError({
          operation: "structured-session.settlePromptTurn",
          reason: "claim-conflict",
          message: `Prompt queue item ${input.queueItemId} is ${initialQueue.status}, not dispatching or ${targetQueueStatus}.`,
        });
      }
      if (
        initialTurn.status === input.status &&
        ((input.assistantMessageId !== undefined &&
          initialTurn.assistantMessageId !== input.assistantMessageId) ||
          (input.assistantText !== undefined && initialTurn.assistantText !== input.assistantText))
      ) {
        throw new StateContractError({
          operation: "structured-session.settlePromptTurn",
          reason: "conflict",
          message: `Turn ${input.turnId} is already terminal with different assistant facts.`,
        });
      }

      const terminalizedCommandIds: string[] = [];
      for (const commandId of new Set(input.terminalCommandIds)) {
        const command = this.mustFindCommandRow(commandId);
        if (command.turn_id !== input.turnId) {
          throw new StateContractError({
            operation: "structured-session.settlePromptTurn",
            reason: "conflict",
            message: `Command ${commandId} does not belong to turn ${input.turnId}.`,
          });
        }
        const finished = this.finishCommandMutation({
          commandId,
          status: input.status === "cancelled" ? "cancelled" : "failed",
          summary: input.terminalCommandSummary,
          error: input.terminalCommandError,
        });
        if (finished.changed) terminalizedCommandIds.push(commandId);
      }

      let queuedMessage = initialQueue;
      if (initialQueue.status !== targetQueueStatus) {
        queuedMessage =
          input.status === "completed"
            ? this.markSurfaceMessageDelivered({
                id: input.queueItemId,
                ...(input.claimOwnerId !== undefined ? { claimOwnerId: input.claimOwnerId } : {}),
                ...(input.leaseVersion !== undefined ? { leaseVersion: input.leaseVersion } : {}),
              })
            : input.status === "cancelled"
              ? this.cancelSurfaceMessage({
                  id: input.queueItemId,
                  ...(input.claimOwnerId !== undefined ? { claimOwnerId: input.claimOwnerId } : {}),
                  ...(input.leaseVersion !== undefined ? { leaseVersion: input.leaseVersion } : {}),
                  expectedStatuses: ["dispatching"],
                })
              : this.markSurfaceMessageFailed({
                  id: input.queueItemId,
                  failureError: input.terminalCommandError,
                  ...(input.claimOwnerId !== undefined ? { claimOwnerId: input.claimOwnerId } : {}),
                  ...(input.leaseVersion !== undefined ? { leaseVersion: input.leaseVersion } : {}),
                });
      }

      const turn =
        initialTurn.status === "running" || initialTurn.status === "waiting"
          ? this.finishTurn({
              turnId: input.turnId,
              status: input.status,
              ...(input.assistantMessageId
                ? { assistantMessageId: input.assistantMessageId as MessageId }
                : {}),
              ...(input.assistantText !== undefined ? { assistantText: input.assistantText } : {}),
            })
          : initialTurn;
      return {
        changed:
          terminalizedCommandIds.length > 0 ||
          queuedMessage !== initialQueue ||
          turn !== initialTurn,
        turn,
        queuedMessage,
        terminalizedCommandIds,
      };
    });
    return settle();
  }

  createThread(input: {
    turnId: string;
    parentThreadId?: string | null;
    threadGroupId?: string | null;
    surfacePiSessionId?: string;
    title: string;
    objective: string;
    historyMode?: StructuredThreadHistoryMode;
    objectiveState?: StructuredThreadObjectiveState;
    loadedExtensionIds?: string[];
    availableExtensionIds?: string[];
    worktree?: string;
    agentProfileJson?: string | null;
    generatedAgentContextFingerprint?: string | null;
  }): StructuredThreadRecord {
    const turn = this.mustFindTurnRow(input.turnId);
    const parent = input.parentThreadId ? this.mustFindThreadRow(input.parentThreadId) : null;
    if (parent && parent.session_id !== turn.session_id) {
      throw new StateContractError({
        operation: "structured-session.createThread",
        reason: "conflict",
        message: `Parent thread ${parent.id} belongs to session ${parent.session_id}, not ${turn.session_id}.`,
      });
    }
    const timestamp = this.now();
    const threadId = this.createId("thread");
    const threadGroupId = input.threadGroupId?.trim() || parent?.thread_group_id || threadId;
    const surfacePiSessionId =
      input.surfacePiSessionId ?? parent?.surface_pi_session_id ?? turn.surface_pi_session_id;

    this.db
      .query(
        `INSERT INTO thread (
           id,
           session_id,
           turn_id,
           parent_thread_id,
           thread_group_id,
           surface_pi_session_id,
           title,
           objective,
           history_mode,
           objective_state,
           loaded_extension_ids_json,
           available_extension_ids_json,
           status,
           wait_owner,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since,
           worktree,
           agent_profile_json,
           generated_agent_context_fingerprint,
           update_extension_context_before_next_turn,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 1, ?, ?, NULL)`,
      )
      .run(
        threadId,
        turn.session_id,
        input.turnId,
        input.parentThreadId ?? null,
        threadGroupId,
        surfacePiSessionId,
        input.title,
        input.objective,
        input.historyMode ?? "isolated",
        input.objectiveState ?? "active",
        toJson(normalizeStringList(input.loadedExtensionIds ?? [])),
        toJson(normalizeStringList(input.availableExtensionIds ?? [])),
        "running-handler",
        input.worktree ?? null,
        input.agentProfileJson ?? null,
        input.generatedAgentContextFingerprint ?? null,
        timestamp,
        timestamp,
      );

    this.recordEvent({
      sessionId: turn.session_id,
      kind: "thread.created",
      subjectKind: "thread",
      subjectId: threadId,
      at: timestamp,
    });
    this.reconcileSessionWaitAfterRunnableChange(turn.session_id);

    return this.mustFindThreadRecord(threadId);
  }

  ensureHandlerThreadRunnable(input: {
    workspaceSessionId: string;
    surfacePiSessionId: string;
    threadId: string;
  }): { thread: StructuredThreadRecord; committed: boolean } {
    const ensureRunnable = this.db.transaction((transactionInput: typeof input) => {
      const thread = this.db
        .query(`SELECT * FROM thread WHERE id = ?`)
        .get(transactionInput.threadId) as ThreadRow | undefined;
      if (!thread) {
        throw new StateContractError({
          operation: "structured-session.ensureHandlerThreadRunnable",
          reason: "not-found",
          message: `Handler thread ${transactionInput.threadId} was not found for surface ${transactionInput.surfacePiSessionId}.`,
        });
      }
      if (
        thread.session_id !== transactionInput.workspaceSessionId ||
        thread.surface_pi_session_id !== transactionInput.surfacePiSessionId
      ) {
        throw new StateContractError({
          operation: "structured-session.ensureHandlerThreadRunnable",
          reason: "conflict",
          message: `Handler thread ${transactionInput.threadId} was not found for surface ${transactionInput.surfacePiSessionId}.`,
        });
      }

      if (thread.status === "running-handler" && this.mapThreadWait(thread) === null) {
        return { thread: this.mapThread(thread), committed: false };
      }

      return {
        thread: this.updateThread({
          threadId: transactionInput.threadId,
          status: "running-handler",
          wait: null,
        }),
        committed: true,
      };
    });

    return ensureRunnable(input);
  }

  startHandlerThreads(
    input: StructuredStartRuntimeHandlerThreadsInput,
  ): StructuredStartRuntimeHandlerThreadsResult {
    const start = this.db.transaction(
      (transactionInput: StructuredStartRuntimeHandlerThreadsInput) => {
        const turn = this.mustFindTurnRow(transactionInput.orchestratorTurnId);
        if (turn.session_id !== transactionInput.workspaceSessionId) {
          throw new StateContractError({
            operation: "structured-session.startHandlerThreads",
            reason: "conflict",
            message: `Turn ${transactionInput.orchestratorTurnId} belongs to session ${turn.session_id}, not ${transactionInput.workspaceSessionId}.`,
          });
        }

        const existingQueueRows = this.db
          .query(
            `SELECT * FROM surface_message_queue
             WHERE session_id = ?
               AND source_command_id = ?
               AND kind = 'initial_handler_start'
               AND status != 'cancelled'
             ORDER BY sequence ASC`,
          )
          .all(
            transactionInput.workspaceSessionId,
            transactionInput.sourceCommandId,
          ) as SurfaceQueuedMessageRow[];
        if (existingQueueRows.length > 0) {
          if (existingQueueRows.length !== transactionInput.threads.length) {
            throw new StateContractError({
              operation: "structured-session.startHandlerThreads",
              reason: "conflict",
              message: `Command ${transactionInput.sourceCommandId} already started ${existingQueueRows.length} handler thread(s), not ${transactionInput.threads.length}.`,
            });
          }

          const replayedThreads = existingQueueRows.map((queueRow, index) => {
            if (!queueRow.thread_id) {
              throw new StateContractError({
                operation: "structured-session.startHandlerThreads",
                reason: "conflict",
                message: `Initial handler queue item ${queueRow.id} does not reference a thread.`,
              });
            }
            const thread = this.mustFindThreadRecord(queueRow.thread_id);
            const requestedThread = transactionInput.threads[index];
            if (!requestedThread) {
              throw new StateContractError({
                operation: "structured-session.startHandlerThreads",
                reason: "conflict",
                message: `Replay for command ${transactionInput.sourceCommandId} has no requested thread at index ${index}.`,
              });
            }
            const bindingInput = requestedThread.generatedAgentContextBinding;
            const generatedAgentContextBinding = this.getGeneratedAgentContextBinding({
              surfacePiSessionId: thread.surfacePiSessionId,
              generatedAgentContextFingerprint: bindingInput.generatedAgentContextFingerprint,
            });
            if (!generatedAgentContextBinding) {
              throw new StateContractError({
                operation: "structured-session.startHandlerThreads",
                reason: "not-found",
                message: `Generated context binding ${bindingInput.generatedAgentContextFingerprint} was not found for handler thread ${thread.id}.`,
              });
            }
            return {
              thread,
              generatedAgentContextBinding,
              queuedMessage: this.mapSurfaceQueuedMessage(queueRow),
            };
          });
          const firstReplayedThread = replayedThreads[0];
          if (!firstReplayedThread) {
            throw new StateContractError({
              operation: "structured-session.startHandlerThreads",
              reason: "conflict",
              message: `Command ${transactionInput.sourceCommandId} replay did not resolve any handler threads.`,
            });
          }

          return {
            threadGroupId: firstReplayedThread.thread.threadGroupId,
            threads: replayedThreads,
            committed: false,
          };
        }

        let threadGroupId = transactionInput.threadGroupId?.trim() || null;
        const threads: StructuredStartedRuntimeHandlerThread[] = [];
        for (const threadInput of transactionInput.threads) {
          const bindingInput = threadInput.generatedAgentContextBinding;
          const thread = this.createThread({
            turnId: transactionInput.orchestratorTurnId,
            parentThreadId: threadInput.parentThreadId ?? null,
            threadGroupId,
            surfacePiSessionId: threadInput.surfacePiSessionId,
            title: threadInput.title,
            objective: threadInput.objective,
            historyMode: threadInput.historyMode,
            objectiveState: "active",
            loadedExtensionIds: [],
            availableExtensionIds: [],
            agentProfileJson: threadInput.agentProfileJson ?? null,
            generatedAgentContextFingerprint: bindingInput.generatedAgentContextFingerprint,
            ...(threadInput.worktreeId ? { worktree: threadInput.worktreeId } : {}),
          });
          threadGroupId = thread.threadGroupId;
          const generatedAgentContextBinding = this.upsertGeneratedAgentContextBinding({
            surfacePiSessionId: thread.surfacePiSessionId,
            ownerKind: "thread",
            ownerId: thread.id,
            actorKind: "handler",
            systemPrompt: "",
            svvyxGuidance: "",
            commandsDts: "",
            nativeToolSchemasJson: "[]",
            generatedAgentContextFingerprint: bindingInput.generatedAgentContextFingerprint,
            generatedAgentContextRevision: bindingInput.generatedAgentContextRevision,
            loadedExtensionIds: [],
            availableExtensionIds: [],
            externalSourceHashes: [...bindingInput.externalSourceHashes],
          });
          const payload = {
            kind: "initial_handler_start",
            threadId: thread.id,
            threadGroupId: thread.threadGroupId,
            objective: thread.objective,
            ...(thread.worktree ? { worktreeId: thread.worktree } : {}),
            ...(threadInput.initialQueue.inheritedHistory
              ? { inheritedHistory: threadInput.initialQueue.inheritedHistory }
              : {}),
            ...(threadInput.initialQueue.overrides
              ? { overrides: threadInput.initialQueue.overrides }
              : {}),
          };
          const queuedMessage = this.enqueueSurfaceMessage({
            sessionId: transactionInput.workspaceSessionId,
            surfacePiSessionId: thread.surfacePiSessionId,
            threadId: thread.id,
            kind: "initial_handler_start",
            idempotencyKey: threadInput.initialQueue.idempotencyKey,
            sourceCommandId: transactionInput.sourceCommandId,
            messageJson: "{}",
            payloadJson: JSON.stringify(payload),
            ...(threadInput.initialQueue.priority
              ? { priority: threadInput.initialQueue.priority }
              : {}),
            ...(threadInput.initialQueue.orderingKey !== undefined
              ? { orderingKey: threadInput.initialQueue.orderingKey }
              : {}),
            ...(threadInput.initialQueue.maxAttempts !== undefined
              ? { maxAttempts: threadInput.initialQueue.maxAttempts }
              : {}),
            ...(threadInput.initialQueue.nextAttemptAt !== undefined
              ? { nextAttemptAt: threadInput.initialQueue.nextAttemptAt }
              : {}),
          });
          threads.push({
            thread,
            generatedAgentContextBinding,
            queuedMessage,
          });
        }
        const firstStartedThread = threads[0];
        if (!firstStartedThread) {
          throw new StateContractError({
            operation: "structured-session.startHandlerThreads",
            reason: "invalid-input",
            message: "At least one handler thread is required.",
          });
        }

        return {
          threadGroupId: threadGroupId ?? firstStartedThread.thread.threadGroupId,
          threads,
          committed: true,
        };
      },
    );

    return start(input);
  }

  updateThread(input: {
    threadId: string;
    status?: StructuredThreadStatus;
    objectiveState?: StructuredThreadObjectiveState;
    wait?: StructuredWaitState | null;
    title?: string;
    objective?: string;
    loadedExtensionIds?: string[];
    availableExtensionIds?: string[];
    worktree?: string | null;
    agentProfileJson?: string | null;
    generatedAgentContextFingerprint?: string | null;
  }): StructuredThreadRecord {
    const existing = this.mustFindThreadRow(input.threadId);
    const timestamp = this.now();
    const nextStatus = input.status ?? existing.status;
    const nextObjectiveState = input.objectiveState ?? existing.objective_state;
    const nextWait =
      input.wait !== undefined
        ? input.wait
        : input.status && input.status !== "waiting"
          ? null
          : this.mapThreadWait(existing);
    const nextTitle = input.title ?? existing.title;
    const nextObjective = input.objective ?? existing.objective;
    const nextLoadedExtensionIds =
      input.loadedExtensionIds === undefined
        ? existing.loaded_extension_ids_json
        : toJson(normalizeStringList(input.loadedExtensionIds));
    const nextAvailableExtensionIds =
      input.availableExtensionIds === undefined
        ? existing.available_extension_ids_json
        : toJson(normalizeStringList(input.availableExtensionIds));
    const nextWorktree =
      input.worktree === undefined ? existing.worktree : (input.worktree ?? null);
    const nextAgentProfileJson =
      input.agentProfileJson === undefined
        ? existing.agent_profile_json
        : (input.agentProfileJson ?? null);
    const nextGeneratedAgentContextFingerprint =
      input.generatedAgentContextFingerprint === undefined
        ? existing.generated_agent_context_fingerprint
        : (input.generatedAgentContextFingerprint ?? null);
    const finishedAt = isTerminalThreadStatus(nextStatus) ? timestamp : null;

    this.db
      .query(
        `UPDATE thread
         SET title = ?,
             objective = ?,
             objective_state = ?,
             loaded_extension_ids_json = ?,
             available_extension_ids_json = ?,
             status = ?,
             wait_owner = ?,
             wait_kind = ?,
             wait_reason = ?,
             wait_resume_when = ?,
             wait_since = ?,
             worktree = ?,
             agent_profile_json = ?,
             generated_agent_context_fingerprint = ?,
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        nextTitle,
        nextObjective,
        nextObjectiveState,
        nextLoadedExtensionIds,
        nextAvailableExtensionIds,
        nextStatus,
        nextWait?.owner ?? null,
        nextWait?.kind ?? null,
        nextWait?.reason ?? null,
        nextWait?.resumeWhen ?? null,
        nextWait?.since ?? null,
        nextWorktree,
        nextAgentProfileJson,
        nextGeneratedAgentContextFingerprint,
        timestamp,
        finishedAt,
        input.threadId,
      );

    this.recordEvent({
      sessionId: existing.session_id,
      kind: isTerminalThreadStatus(nextStatus) ? "thread.finished" : "thread.updated",
      subjectKind: "thread",
      subjectId: input.threadId,
      at: timestamp,
    });
    this.reconcileSessionWaitAfterRunnableChange(existing.session_id);

    return this.mustFindThreadRecord(input.threadId);
  }

  setSessionWait(input: {
    sessionId: string;
    owner: StructuredSessionWaitOwner;
    kind: StructuredWaitKind;
    reason: string;
    resumeWhen: string;
    at?: string;
  }): StructuredSessionWaitState {
    const session = this.mustFindSessionRow(input.sessionId);
    const owner = input.owner;
    if (owner.kind === "thread") {
      this.mustFindThreadRow(owner.threadId);
      const hasOtherRunningThread = this.queryThreadRows(session.session_id).some(
        (thread) => thread.id !== owner.threadId && isRunnableThreadStatus(thread.status),
      );
      if (hasOtherRunningThread) {
        throw new Error("Cannot set session wait while other runnable thread work remains.");
      }
    } else if (
      this.queryThreadRows(session.session_id).some((thread) =>
        isRunnableThreadStatus(thread.status),
      )
    ) {
      throw new Error("Cannot set orchestrator session wait while runnable thread work remains.");
    }

    const timestamp = input.at ?? this.now();
    this.db
      .query(
        `UPDATE session
         SET wait_owner_kind = ?,
             wait_thread_id = ?,
             wait_kind = ?,
             wait_reason = ?,
             wait_resume_when = ?,
             wait_since = ?
         WHERE session_id = ?`,
      )
      .run(
        owner.kind,
        owner.kind === "thread" ? owner.threadId : null,
        input.kind,
        input.reason,
        input.resumeWhen,
        timestamp,
        input.sessionId,
      );

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.wait.started",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        owner,
        kind: input.kind,
        reason: input.reason,
      },
    });

    return this.mustFindSessionWait(input.sessionId);
  }

  clearSessionWait(input: { sessionId: string; at?: string }): void {
    const existing = this.mustFindSessionRow(input.sessionId);
    if (!this.mapSessionWait(existing)) {
      return;
    }

    const timestamp = input.at ?? this.now();
    this.db
      .query(
        `UPDATE session
         SET wait_owner_kind = NULL,
             wait_thread_id = NULL,
             wait_kind = NULL,
             wait_reason = NULL,
             wait_resume_when = NULL,
             wait_since = NULL
         WHERE session_id = ?`,
      )
      .run(input.sessionId);

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.wait.cleared",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
    });
  }

  setSessionPinned(input: { sessionId: string; pinned: boolean }): void {
    this.ensureSessionRow(input.sessionId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET pinned_at = ?,
             archived_at = NULL,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(input.pinned ? timestamp : null, timestamp, input.sessionId);

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.navigation.updated",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        pinned: input.pinned,
        archived: false,
      },
    });
  }

  setSessionArchived(input: { sessionId: string; archived: boolean }): void {
    this.ensureSessionRow(input.sessionId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET archived_at = ?,
             pinned_at = NULL,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(input.archived ? timestamp : null, timestamp, input.sessionId);

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.navigation.updated",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        pinned: false,
        archived: input.archived,
      },
    });
  }

  markSessionUnread(input: {
    sessionId: string;
    reason: "assistant-turn-finished" | "manual";
  }): void {
    this.ensureSessionRow(input.sessionId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET unread_at = ?,
             unread_reason = ?
         WHERE session_id = ?`,
      )
      .run(timestamp, input.reason, input.sessionId);

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.unread.updated",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        unread: true,
        reason: input.reason,
      },
    });
  }

  markSessionRead(input: { sessionId: string }): void {
    this.ensureSessionRow(input.sessionId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET unread_at = NULL,
             unread_reason = NULL,
             last_read_at = ?
         WHERE session_id = ?`,
      )
      .run(timestamp, input.sessionId);

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.unread.updated",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        unread: false,
      },
    });
  }

  applySessionNavigationCommand(
    input: StructuredSessionNavigationCommandInput,
  ): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      switch (input.kind) {
        case "set-pinned":
          this.mustFindSessionRow(input.sessionId);
          this.setSessionPinned(input);
          break;
        case "set-archived":
          this.mustFindSessionRow(input.sessionId);
          this.setSessionArchived(input);
          break;
        case "mark-read":
          this.mustFindSessionRow(input.sessionId);
          this.markSessionRead(input);
          break;
        case "mark-unread":
          this.mustFindSessionRow(input.sessionId);
          this.markSessionUnread({ sessionId: input.sessionId, reason: "manual" });
          break;
        case "set-section-state":
          this.setSessionNavigationSectionState(input);
          break;
      }
      return this.bumpStateRevision();
    })();

    return { updatedAt, stateRevision };
  }

  getWorkspaceSidebarState(): StructuredWorkspaceSidebarState {
    const row = this.getWorkspaceSidebarStateRow();
    if (!row) {
      return {
        pinnedGroupCollapsed: false,
        pinnedGroupSizePx: DEFAULT_SIDEBAR_SECTION_SIZES.pinned,
        activeGroupCollapsed: false,
        activeGroupSizePx: DEFAULT_SIDEBAR_SECTION_SIZES.active,
        archivedGroupCollapsed: true,
        archivedGroupSizePx: DEFAULT_SIDEBAR_SECTION_SIZES.archived,
        updatedAt: new Date(0).toISOString(),
      };
    }

    return this.mapWorkspaceSidebarState(row);
  }

  setSessionNavigationSectionState(input: {
    section: "pinned" | "active" | "archived";
    collapsed?: boolean;
    sizePx?: number;
  }): StructuredWorkspaceSidebarState {
    const timestamp = this.now();
    const current = this.getWorkspaceSidebarState();
    const next = {
      pinnedGroupCollapsed: current.pinnedGroupCollapsed,
      pinnedGroupSizePx: current.pinnedGroupSizePx,
      activeGroupCollapsed: current.activeGroupCollapsed,
      activeGroupSizePx: current.activeGroupSizePx,
      archivedGroupCollapsed: current.archivedGroupCollapsed,
      archivedGroupSizePx: current.archivedGroupSizePx,
    };
    const collapsed =
      typeof input.collapsed === "boolean"
        ? input.collapsed
        : getSidebarSectionCollapsed(next, input.section);
    const sizePx =
      typeof input.sizePx === "number"
        ? clampSidebarSectionSize(input.sizePx)
        : getSidebarSectionSize(next, input.section);
    setSidebarSectionState(next, input.section, { collapsed, sizePx });

    this.db
      .query(
        `INSERT INTO workspace_sidebar_state (
           id,
           pinned_group_collapsed,
           pinned_group_size_px,
           active_group_collapsed,
           active_group_size_px,
           archived_group_collapsed,
           archived_group_size_px,
           updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           pinned_group_collapsed = excluded.pinned_group_collapsed,
           pinned_group_size_px = excluded.pinned_group_size_px,
           active_group_collapsed = excluded.active_group_collapsed,
           active_group_size_px = excluded.active_group_size_px,
           archived_group_collapsed = excluded.archived_group_collapsed,
           archived_group_size_px = excluded.archived_group_size_px,
           updated_at = excluded.updated_at`,
      )
      .run(
        next.pinnedGroupCollapsed ? 1 : 0,
        next.pinnedGroupSizePx,
        next.activeGroupCollapsed ? 1 : 0,
        next.activeGroupSizePx,
        next.archivedGroupCollapsed ? 1 : 0,
        next.archivedGroupSizePx,
        timestamp,
      );

    return this.getWorkspaceSidebarState();
  }

  recordLifecycleEvent(input: {
    sessionId: string;
    kind: string;
    subjectKind: StructuredEventSubjectKind;
    subjectId: string;
    at?: string;
    data?: Record<string, unknown>;
  }): void {
    this.recordEvent(input);
  }

  createCommand(input: {
    turnId?: string | null;
    workflowTaskAttemptId?: string | null;
    surfacePiSessionId?: string;
    threadId?: string | null;
    workflowRunId?: string | null;
    parentCommandId?: string | null;
    toolName: string;
    executor: StructuredCommandExecutor;
    visibility: StructuredCommandVisibility;
    title: string;
    summary: string;
    arguments?: unknown;
    facts?: Record<string, unknown> | null;
    attempts?: number;
    status?: StructuredCommandStatus;
  }): StructuredCommandRecord {
    const workflowTaskAttempt = input.workflowTaskAttemptId
      ? this.mustFindWorkflowTaskAttemptRow(input.workflowTaskAttemptId)
      : null;
    const turn = input.turnId ? this.mustFindTurnRow(input.turnId) : null;
    if (!turn && !workflowTaskAttempt) {
      throw new Error("Command creation requires a turn or workflow task attempt owner.");
    }

    const threadId = input.threadId ?? workflowTaskAttempt?.thread_id ?? null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    const workflowRunId = input.workflowRunId ?? workflowTaskAttempt?.workflow_run_id ?? null;
    if (workflowRunId) {
      this.mustFindWorkflowRunRow(workflowRunId);
    }

    const timestamp = this.now();
    const commandId = this.createId("command");
    const surfacePiSessionId =
      input.surfacePiSessionId ??
      workflowTaskAttempt?.surface_pi_session_id ??
      thread?.surface_pi_session_id ??
      turn?.surface_pi_session_id;
    if (!surfacePiSessionId) {
      throw new Error("Command creation requires a surface pi session id.");
    }
    const sessionId =
      turn?.session_id ?? workflowTaskAttempt?.session_id ?? thread?.session_id ?? null;
    if (!sessionId) {
      throw new Error("Command creation requires a session owner.");
    }

    this.db
      .query(
        `INSERT INTO command (
           id,
           session_id,
           turn_id,
           workflow_task_attempt_id,
           surface_pi_session_id,
           thread_id,
           workflow_run_id,
           parent_command_id,
           tool_name,
           executor,
           visibility,
           status,
           attempts,
           title,
           summary,
           arguments_json,
           facts_json,
           error,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        commandId,
        sessionId,
        turn?.id ?? null,
        workflowTaskAttempt?.id ?? input.workflowTaskAttemptId ?? null,
        surfacePiSessionId,
        threadId,
        workflowRunId,
        input.parentCommandId ?? null,
        input.toolName,
        input.executor,
        input.visibility,
        input.status ?? "requested",
        input.attempts ?? 1,
        input.title,
        input.summary,
        input.arguments === undefined ? null : toJson(input.arguments),
        toJson(input.facts ?? null),
        timestamp,
        timestamp,
      );

    this.recordEvent({
      sessionId,
      kind: "command.requested",
      subjectKind: "command",
      subjectId: commandId,
      at: timestamp,
    });

    return this.mustFindCommandRecord(commandId);
  }

  findCommandByToolCallId(toolCallId: string): StructuredCommandRecord | null {
    const rows = this.db
      .query(
        `SELECT * FROM command WHERE json_extract(facts_json, '$.toolCallId') = ? ORDER BY updated_at DESC LIMIT 1`,
      )
      .all(toolCallId) as CommandRow[];
    if (rows.length === 0) return null;
    return this.mapCommand(rows[0]!);
  }

  findCommandById(commandId: string): StructuredCommandRecord | null {
    const row = this.db.query(`SELECT * FROM command WHERE id = ? LIMIT 1`).get(commandId) as
      | CommandRow
      | undefined;
    return row ? this.mapCommand(row) : null;
  }

  createOrReuseStreamingCommand(input: StructuredStreamingCommandInput): StructuredCommandRecord {
    return this.createOrReuseStreamingCommandMutation(input).record;
  }

  createOrReuseStreamingCommandMutation(
    input: StructuredStreamingCommandInput,
  ): StructuredCommandMutationResult {
    const existing = this.findCommandByToolCallId(input.toolCallId);
    if (existing) {
      if (TERMINAL_COMMAND_STATUSES.has(existing.status)) {
        return { record: existing, changed: false };
      }
      if (input.arguments !== undefined) {
        this.updateCommandArguments(existing.id, input.arguments);
      }
      const updatedFacts = { ...existing.facts, ...input.facts };
      this.db
        .query(
          `UPDATE command SET facts_json = ?, summary = ?, title = ?, visibility = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          toJson(updatedFacts),
          input.summary ?? existing.summary,
          input.title ?? existing.title,
          input.visibility ?? existing.visibility,
          this.now(),
          existing.id,
        );
      return { record: this.mustFindCommandRecord(existing.id), changed: true };
    }
    return {
      record: this.createCommand({
        ...input,
        facts: { ...input.facts, toolCallId: input.toolCallId },
      }),
      changed: true,
    };
  }

  updateCommandArguments(commandId: string, args: unknown): StructuredCommandRecord {
    return this.updateCommandArgumentsMutation(commandId, args).record;
  }

  updateCommandArgumentsMutation(
    commandId: string,
    args: unknown,
  ): StructuredCommandMutationResult {
    const existing = this.mustFindCommandRow(commandId);
    if (TERMINAL_COMMAND_STATUSES.has(existing.status as StructuredCommandStatus)) {
      return { record: this.mustFindCommandRecord(commandId), changed: false };
    }
    const timestamp = this.now();
    this.db
      .query(`UPDATE command SET arguments_json = ?, updated_at = ? WHERE id = ?`)
      .run(args === undefined ? null : toJson(args), timestamp, commandId);
    void existing;
    return { record: this.mustFindCommandRecord(commandId), changed: true };
  }

  startCommand(commandId: string): StructuredCommandRecord {
    return this.startCommandMutation(commandId).record;
  }

  startCommandMutation(commandId: string, at?: string): StructuredCommandMutationResult {
    const existing = this.mustFindCommandRow(commandId);
    if (
      existing.status === "running" ||
      TERMINAL_COMMAND_STATUSES.has(existing.status as StructuredCommandStatus)
    ) {
      return { record: this.mustFindCommandRecord(commandId), changed: false };
    }
    const timestamp = at ?? this.now();
    this.db
      .query(`UPDATE command SET status = ?, updated_at = ? WHERE id = ?`)
      .run("running", timestamp, commandId);
    this.recordEvent({
      sessionId: existing.session_id,
      kind: "command.started",
      subjectKind: "command",
      subjectId: commandId,
      at: timestamp,
    });
    return { record: this.mustFindCommandRecord(commandId), changed: true };
  }

  finishCommand(input: StructuredFinishCommandInput): StructuredCommandRecord {
    return this.finishCommandMutation(input).record;
  }

  finishCommandMutation(input: StructuredFinishCommandInput): StructuredCommandMutationResult {
    const existing = this.mustFindCommandRow(input.commandId);
    if (TERMINAL_COMMAND_STATUSES.has(existing.status as StructuredCommandStatus)) {
      return { record: this.mustFindCommandRecord(input.commandId), changed: false };
    }
    const timestamp = input.at ?? this.now();
    const visibility = input.visibility ?? existing.visibility;
    const factsJson = input.facts === undefined ? existing.facts_json : toJson(input.facts ?? null);
    const finishedAt = input.status === "waiting" ? null : timestamp;

    this.db
      .query(
        `UPDATE command
         SET visibility = ?,
             status = ?,
             summary = ?,
             facts_json = ?,
             error = ?,
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        visibility,
        input.status,
        input.summary ?? existing.summary,
        factsJson,
        input.error === undefined ? existing.error : input.error,
        timestamp,
        finishedAt,
        input.commandId,
      );

    this.recordEvent({
      sessionId: existing.session_id,
      kind: input.status === "waiting" ? "command.waiting" : "command.finished",
      subjectKind: "command",
      subjectId: input.commandId,
      at: timestamp,
    });

    return { record: this.mustFindCommandRecord(input.commandId), changed: true };
  }

  createEpisode(input: {
    threadId: string;
    sourceCommandId?: string | null;
    kind?: StructuredEpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): StructuredEpisodeRecord {
    const thread = this.mustFindThreadRow(input.threadId);
    const sessionId = thread.session_id;

    const episodeId = this.createId("episode");
    const timestamp = this.now();
    this.db
      .query(
        `INSERT INTO episode (
           id,
           session_id,
           thread_id,
           source_command_id,
           kind,
           title,
           summary,
           body,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        episodeId,
        sessionId,
        input.threadId,
        input.sourceCommandId ?? null,
        input.kind ?? "change",
        input.title,
        input.summary,
        input.body,
        timestamp,
      );

    this.recordEvent({
      sessionId,
      kind: "episode.created",
      subjectKind: "episode",
      subjectId: episodeId,
      at: timestamp,
    });

    return this.mustFindEpisodeRecord(episodeId);
  }

  recordHandlerThreadEpisode(input: {
    workspaceSessionId: string;
    threadId: string;
    threadGroupId: string;
    sourceCommandId?: string | null;
    kind?: StructuredEpisodeKind;
    summary: string;
    body?: string | null;
    outcome?: unknown;
    relatedCommandIds?: readonly string[];
    relatedArtifactIds?: readonly string[];
    relatedWorkflowRunIds?: readonly string[];
  }): { episode: StructuredEpisodeRecord; thread: StructuredThreadRecord; concluded: boolean } {
    const recordEpisode = this.db.transaction((transactionInput: typeof input) => {
      const thread = this.db
        .query(`SELECT * FROM thread WHERE id = ?`)
        .get(transactionInput.threadId) as ThreadRow | undefined;
      if (!thread) {
        throw new StateContractError({
          operation: "runtime-episode.recordHandlerThreadEpisode",
          reason: "not-found",
          message: `Thread ${transactionInput.threadId} was not found.`,
        });
      }
      if (thread.session_id !== transactionInput.workspaceSessionId) {
        throw new StateContractError({
          operation: "runtime-episode.recordHandlerThreadEpisode",
          reason: "invalid-input",
          message: `Thread ${transactionInput.threadId} was not found.`,
        });
      }
      if (thread.thread_group_id !== transactionInput.threadGroupId) {
        throw new StateContractError({
          operation: "runtime-episode.recordHandlerThreadEpisode",
          reason: "invalid-input",
          message: `Thread ${transactionInput.threadId} does not belong to thread group ${transactionInput.threadGroupId}.`,
        });
      }

      for (const commandId of transactionInput.relatedCommandIds ?? []) {
        const command = this.db.query(`SELECT * FROM command WHERE id = ?`).get(commandId) as
          | CommandRow
          | undefined;
        if (!command || command.session_id !== transactionInput.workspaceSessionId) {
          throw new StateContractError({
            operation: "runtime-episode.recordHandlerThreadEpisode",
            reason: "invalid-input",
            message: `thread_report related command is not durable or inspectable: ${commandId}`,
          });
        }
      }
      for (const artifactId of transactionInput.relatedArtifactIds ?? []) {
        const artifact = this.db.query(`SELECT * FROM artifact WHERE id = ?`).get(artifactId) as
          | ArtifactRow
          | undefined;
        if (!artifact || artifact.session_id !== transactionInput.workspaceSessionId) {
          throw new StateContractError({
            operation: "runtime-episode.recordHandlerThreadEpisode",
            reason: "invalid-input",
            message: `thread_report related artifact is not durable or inspectable: ${artifactId}`,
          });
        }
      }
      for (const workflowRunId of transactionInput.relatedWorkflowRunIds ?? []) {
        const workflowRun = this.db
          .query(`SELECT * FROM workflow_run WHERE id = ?`)
          .get(workflowRunId) as WorkflowRunRow | undefined;
        if (!workflowRun || workflowRun.session_id !== transactionInput.workspaceSessionId) {
          throw new StateContractError({
            operation: "runtime-episode.recordHandlerThreadEpisode",
            reason: "invalid-input",
            message: `thread_report related workflow run is not durable or inspectable: ${workflowRunId}`,
          });
        }
      }

      const episodeInput: {
        threadId: string;
        sourceCommandId: string | null;
        kind?: StructuredEpisodeKind;
        title: string;
        summary: string;
        body: string;
      } = {
        threadId: transactionInput.threadId,
        sourceCommandId: transactionInput.sourceCommandId ?? null,
        title: transactionInput.summary,
        summary: transactionInput.summary,
        body: transactionInput.body ?? "",
      };
      if (transactionInput.kind !== undefined) {
        episodeInput.kind = transactionInput.kind;
      }
      const episode = this.createEpisode(episodeInput);
      const concluded = Boolean(transactionInput.outcome);
      const nextThread = concluded
        ? this.updateThread({
            threadId: transactionInput.threadId,
            objectiveState: "concluded",
            status: "completed",
            wait: null,
          })
        : this.mapThread(thread);

      return { episode, thread: nextThread, concluded };
    });

    return recordEpisode(input);
  }

  createArtifact(input: {
    sessionId?: string | null;
    threadId?: string | null;
    workflowRunId?: string | null;
    workflowTaskAttemptId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name?: string;
    path?: string;
    content?: string;
    mimeType?: string;
    immutable?: boolean;
  }): StructuredArtifactRecord {
    const sourceCommand = input.sourceCommandId
      ? this.mustFindCommandRow(input.sourceCommandId)
      : null;
    const workflowRun =
      input.workflowRunId != null ? this.mustFindWorkflowRunRow(input.workflowRunId) : null;
    const workflowTaskAttempt =
      input.workflowTaskAttemptId != null
        ? this.mustFindWorkflowTaskAttemptRow(input.workflowTaskAttemptId)
        : sourceCommand?.workflow_task_attempt_id
          ? this.mustFindWorkflowTaskAttemptRow(sourceCommand.workflow_task_attempt_id)
          : null;

    const threadId =
      input.threadId ??
      workflowTaskAttempt?.thread_id ??
      workflowRun?.thread_id ??
      sourceCommand?.thread_id ??
      null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    const workflowRunId =
      input.workflowRunId ??
      workflowTaskAttempt?.workflow_run_id ??
      sourceCommand?.workflow_run_id ??
      workflowRun?.id ??
      null;
    const workflowTaskAttemptId = input.workflowTaskAttemptId ?? workflowTaskAttempt?.id ?? null;
    const sourceCommandId = input.sourceCommandId ?? null;
    const explicitSession = input.sessionId ? this.mustFindSessionRow(input.sessionId) : null;
    const sessionId =
      thread?.session_id ??
      workflowTaskAttempt?.session_id ??
      workflowRun?.session_id ??
      sourceCommand?.session_id ??
      explicitSession?.session_id ??
      null;

    if (!sessionId) {
      throw new Error(
        "Artifact creation requires thread, workflow run, workflow task attempt, or command ownership.",
      );
    }

    const artifactId = this.createId("artifact");
    const timestamp = this.now();
    const name = validateArtifactName(input.name?.trim() || basename(input.path ?? ""));
    const immutable = input.immutable === true;
    const path = resolveArtifactPath({
      artifactDir: this.workspace.artifactDir,
      sessionId,
      name,
      immutable,
    });
    const mimeType = normalizeArtifactMimeType(input.mimeType) ?? inferArtifactMimeType(name);

    const activeName = this.db
      .query(
        `SELECT id FROM artifact
         WHERE session_id = ? AND name = ? AND immutable = ? AND deleted_at IS NULL
         LIMIT 1`,
      )
      .get(sessionId, name, immutable ? 1 : 0) as { id: string } | undefined;
    if (activeName || existsSync(path)) {
      throw new Error(`ARTIFACT_EXISTS: active artifact already owns ${name}`);
    }

    let wroteArtifactFile = false;
    try {
      mkdirSync(dirname(path), { recursive: true });
      if (input.path && input.content === undefined) {
        copyArtifactSourceFile(input.path, path);
      } else {
        writeFileSync(path, input.content ?? "");
      }
      wroteArtifactFile = true;
      const fileMetadata = readArtifactFileMetadata(this.digest, path);

      this.db.transaction(() => {
        this.db
          .query(
            `INSERT INTO artifact (
               id,
               session_id,
               thread_id,
               workflow_run_id,
               workflow_task_attempt_id,
               source_command_id,
               kind,
               name,
               path,
               mime_type,
               bytes,
               sha256,
               immutable,
               materialization_status,
               created_at,
               updated_at,
               deleted_at,
               last_recovery_work_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            artifactId,
            sessionId,
            threadId,
            workflowRunId,
            workflowTaskAttemptId,
            sourceCommandId,
            input.kind,
            name,
            path,
            mimeType,
            fileMetadata.bytes,
            fileMetadata.sha256,
            immutable ? 1 : 0,
            "ready",
            timestamp,
            timestamp,
            null,
            null,
          );

        this.recordEvent({
          sessionId,
          kind: "artifact.created",
          subjectKind: "artifact",
          subjectId: artifactId,
          at: timestamp,
        });
      })();
    } catch (error) {
      if (wroteArtifactFile) {
        try {
          unlinkSync(path);
        } catch {
          // Preserve the original persistence failure.
        }
      }
      if (isStructuredArtifactError(error)) {
        throw error;
      }
      throw new Error(`COPY_FAILED: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }

    return this.mustFindArtifactRecord(artifactId);
  }

  recordArtifactMetadata(input: RecordArtifactMetadataInput): ArtifactMetadataRecord {
    const session = this.mustFindSessionRow(input.workspaceSessionId);
    const sourceCommand = this.mustFindCommandRow(input.sourceCommandId);
    const workflowRun =
      input.workflowRunId != null ? this.mustFindWorkflowRunRow(input.workflowRunId) : null;
    const workflowTaskAttempt =
      input.workflowTaskAttemptId != null
        ? this.mustFindWorkflowTaskAttemptRow(input.workflowTaskAttemptId)
        : sourceCommand.workflow_task_attempt_id
          ? this.mustFindWorkflowTaskAttemptRow(sourceCommand.workflow_task_attempt_id)
          : null;
    const threadId =
      input.threadId ??
      workflowTaskAttempt?.thread_id ??
      workflowRun?.thread_id ??
      sourceCommand.thread_id ??
      null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    const workflowRunId =
      input.workflowRunId ??
      workflowTaskAttempt?.workflow_run_id ??
      sourceCommand.workflow_run_id ??
      workflowRun?.id ??
      null;
    const workflowTaskAttemptId = input.workflowTaskAttemptId ?? workflowTaskAttempt?.id ?? null;
    const linkedSessionIds = [
      session.session_id,
      sourceCommand.session_id,
      workflowRun?.session_id,
      workflowTaskAttempt?.session_id,
      thread?.session_id,
    ].filter((value): value is string => value != null);
    if (linkedSessionIds.some((sessionId) => sessionId !== input.workspaceSessionId)) {
      throw new Error("INVALID_ARGUMENT: artifact metadata ownership links cross sessions.");
    }
    if (input.materializationStatus !== "ready") {
      throw new Error(
        "INVALID_ARGUMENT: artifact metadata creation requires ready materialization.",
      );
    }

    const artifactId = this.createId("artifact");
    const timestamp = this.now();
    const name = validateArtifactName(input.name.trim());
    const storedPath = validateArtifactStoredPath(this.workspace.artifactDir, input.storedPath);
    const byteSize = validateArtifactByteSize(input.byteSize);
    const sha256 = validateArtifactSha256(input.sha256);
    const mimeType = normalizeArtifactMimeType(input.mimeType) ?? inferArtifactMimeType(name);
    const immutable = input.immutable === true;

    const activeName = this.db
      .query(
        `SELECT id FROM artifact
         WHERE session_id = ? AND name = ? AND immutable = ? AND deleted_at IS NULL
         LIMIT 1`,
      )
      .get(input.workspaceSessionId, name, immutable ? 1 : 0) as { id: string } | undefined;
    if (activeName) {
      throw new Error(`ARTIFACT_EXISTS: active artifact already owns ${name}`);
    }
    const activeStoredPath = this.db
      .query(
        `SELECT id FROM artifact
         WHERE session_id = ? AND path = ? AND deleted_at IS NULL
         LIMIT 1`,
      )
      .get(input.workspaceSessionId, storedPath) as { id: string } | undefined;
    if (activeStoredPath) {
      throw new Error(`ARTIFACT_EXISTS: active artifact already owns stored path ${storedPath}`);
    }

    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO artifact (
             id,
             session_id,
             thread_id,
             workflow_run_id,
             workflow_task_attempt_id,
             source_command_id,
             kind,
             name,
             path,
             mime_type,
             bytes,
             sha256,
             immutable,
             materialization_status,
             created_at,
             updated_at,
             deleted_at,
             last_recovery_work_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifactId,
          input.workspaceSessionId,
          threadId,
          workflowRunId,
          workflowTaskAttemptId,
          input.sourceCommandId,
          input.kind,
          name,
          storedPath,
          mimeType,
          byteSize,
          sha256,
          immutable ? 1 : 0,
          "ready",
          timestamp,
          timestamp,
          null,
          null,
        );

      this.recordEvent({
        sessionId: input.workspaceSessionId,
        kind: "artifact.created",
        subjectKind: "artifact",
        subjectId: artifactId,
        at: timestamp,
      });
    })();

    return this.mustFindArtifactMetadataRecord(artifactId);
  }

  markArtifactMetadataDeleted(input: {
    workspaceSessionId?: string | null;
    artifactId: string;
  }): ArtifactMetadataRecord {
    const row = this.db.query(`SELECT * FROM artifact WHERE id = ?`).get(input.artifactId) as
      | ArtifactRow
      | undefined;
    if (!row || (input.workspaceSessionId && row.session_id !== input.workspaceSessionId)) {
      throw new Error(`ARTIFACT_NOT_FOUND: ${input.artifactId}`);
    }
    if (row.deleted_at) {
      return this.mapArtifactMetadata(row);
    }

    const timestamp = this.now();
    this.db.transaction(() => {
      this.db
        .query(
          `UPDATE artifact
           SET deleted_at = ?,
               updated_at = ?,
               materialization_status = 'deleted'
           WHERE id = ?`,
        )
        .run(timestamp, timestamp, input.artifactId);
      this.recordEvent({
        sessionId: row.session_id,
        kind: "artifact.deleted",
        subjectKind: "artifact",
        subjectId: input.artifactId,
        at: timestamp,
      });
    })();

    return this.mustFindArtifactMetadataRecord(input.artifactId);
  }

  inspectArtifactMetadata(input: {
    workspaceSessionId?: string | null;
    artifactId: string;
  }): ArtifactMetadataRecord {
    const row = this.db.query(`SELECT * FROM artifact WHERE id = ?`).get(input.artifactId) as
      | ArtifactRow
      | undefined;
    if (!row || (input.workspaceSessionId && row.session_id !== input.workspaceSessionId)) {
      throw new Error(`ARTIFACT_NOT_FOUND: ${input.artifactId}`);
    }
    return this.mapArtifactMetadata(row);
  }

  listArtifactMetadata(input: {
    workspaceSessionId: string;
    threadId?: string | null;
    limit?: number;
  }): ArtifactMetadataRecord[] {
    const limit = input.limit ?? 20;
    const rows = input.threadId
      ? (this.db
          .query(
            `SELECT * FROM artifact
             WHERE session_id = ? AND thread_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?`,
          )
          .all(input.workspaceSessionId, input.threadId, limit) as ArtifactRow[])
      : (this.db
          .query(
            `SELECT * FROM artifact
             WHERE session_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?`,
          )
          .all(input.workspaceSessionId, limit) as ArtifactRow[]);
    return rows.map((row) => this.mapArtifactMetadata(row));
  }

  deleteArtifact(input: {
    sessionId?: string | null;
    artifactId: string;
  }): StructuredArtifactRecord {
    const row = this.db.query(`SELECT * FROM artifact WHERE id = ?`).get(input.artifactId) as
      | ArtifactRow
      | undefined;
    if (!row || (input.sessionId && row.session_id !== input.sessionId)) {
      throw new Error(`ARTIFACT_NOT_FOUND: ${input.artifactId}`);
    }

    if (row.deleted_at) {
      return this.mapArtifact(row);
    }

    const timestamp = this.now();
    this.db.transaction(() => {
      if (row.path && existsSync(row.path)) {
        try {
          unlinkSync(row.path);
        } catch (error) {
          throw new Error(
            `DELETE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
      this.db
        .query(
          `UPDATE artifact
           SET deleted_at = ?,
               updated_at = ?,
               materialization_status = 'deleted'
           WHERE id = ?`,
        )
        .run(timestamp, timestamp, input.artifactId);
      this.recordEvent({
        sessionId: row.session_id,
        kind: "artifact.deleted",
        subjectKind: "artifact",
        subjectId: input.artifactId,
        at: timestamp,
      });
    })();

    return this.mustFindArtifactRecord(input.artifactId);
  }

  inspectArtifact(input: {
    sessionId?: string | null;
    artifactId: string;
  }): StructuredArtifactRecord {
    const row = this.db.query(`SELECT * FROM artifact WHERE id = ?`).get(input.artifactId) as
      | ArtifactRow
      | undefined;
    if (!row || (input.sessionId && row.session_id !== input.sessionId)) {
      throw new Error(`ARTIFACT_NOT_FOUND: ${input.artifactId}`);
    }
    return this.mapArtifact(row);
  }

  listArtifacts(input: {
    sessionId: string;
    threadId?: string | null;
    limit?: number;
  }): StructuredArtifactRecord[] {
    const limit = input.limit ?? 20;
    const rows = input.threadId
      ? (this.db
          .query(
            `SELECT * FROM artifact
             WHERE session_id = ? AND thread_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?`,
          )
          .all(input.sessionId, input.threadId, limit) as ArtifactRow[])
      : (this.db
          .query(
            `SELECT * FROM artifact
             WHERE session_id = ? AND deleted_at IS NULL
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?`,
          )
          .all(input.sessionId, limit) as ArtifactRow[]);
    return rows.map((row) => this.mapArtifact(row));
  }

  upsertWorkflowTaskAttempt(input: {
    workflowRunId: string;
    smithersRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
    surfacePiSessionId?: string | null;
    title?: string;
    summary: string;
    kind: StructuredWorkflowTaskAttemptKind;
    status: StructuredWorkflowTaskAttemptStatus;
    smithersState: string;
    prompt?: string | null;
    responseText?: string | null;
    error?: string | null;
    cached?: boolean;
    jjPointer?: string | null;
    jjCwd?: string | null;
    heartbeatAt?: string | null;
    agentId?: string | null;
    agentModel?: string | null;
    agentEngine?: string | null;
    agentResume?: string | null;
    generatedAgentContextFingerprint?: string | null;
    generatedAgentContextBinding?: {
      systemPrompt: string;
      svvyxGuidance: string;
      commandsDts: string;
      nativeToolSchemasJson: string;
      generatedAgentContextRevision: number;
      loadedExtensionIds: string[];
      availableExtensionIds: string[];
      externalSourceHashes: string[];
    } | null;
    meta?: Record<string, unknown> | null;
    startedAt?: string;
    finishedAt?: string | null;
  }): StructuredWorkflowTaskAttemptRecord {
    const workflowRun = this.mustFindWorkflowRunRow(input.workflowRunId);
    if (workflowRun.smithers_run_id !== input.smithersRunId) {
      throw new Error(
        `Structured workflow run ${input.workflowRunId} is bound to Smithers run ${workflowRun.smithers_run_id}, not ${input.smithersRunId}.`,
      );
    }
    const existing = this.findWorkflowTaskAttemptRowByIdentity({
      smithersRunId: input.smithersRunId,
      nodeId: input.nodeId,
      iteration: input.iteration,
      attempt: input.attempt,
    });
    if (existing && existing.workflow_run_id !== input.workflowRunId) {
      throw new Error(
        `Smithers task attempt ${input.smithersRunId}:${input.nodeId}:${input.iteration}:${input.attempt} is already bound to structured workflow run ${existing.workflow_run_id}.`,
      );
    }
    const timestamp = this.now();
    const title = input.title?.trim() || input.nodeId;
    const startedAt = input.startedAt ?? existing?.started_at ?? timestamp;
    const finishedAt =
      input.finishedAt === undefined
        ? (existing?.finished_at ??
          (isTerminalWorkflowTaskAttemptStatus(input.status) ? timestamp : null))
        : (input.finishedAt ?? null);

    if (existing) {
      this.db
        .query(
          `UPDATE workflow_task_attempt
           SET surface_pi_session_id = ?,
               title = ?,
               summary = ?,
               kind = ?,
               status = ?,
               smithers_state = ?,
               prompt = ?,
               response_text = ?,
               error = ?,
               cached = ?,
               jj_pointer = ?,
               jj_cwd = ?,
               heartbeat_at = ?,
               agent_id = ?,
               agent_model = ?,
               agent_engine = ?,
               agent_resume = ?,
               generated_agent_context_fingerprint = ?,
               meta_json = ?,
               started_at = ?,
               updated_at = ?,
               finished_at = ?
           WHERE id = ?`,
        )
        .run(
          input.surfacePiSessionId ?? existing.surface_pi_session_id,
          title,
          input.summary,
          input.kind,
          input.status,
          input.smithersState,
          input.prompt === undefined ? existing.prompt : (input.prompt ?? null),
          input.responseText === undefined ? existing.response_text : (input.responseText ?? null),
          input.error === undefined ? existing.error : (input.error ?? null),
          input.cached === undefined ? existing.cached : input.cached,
          input.jjPointer === undefined ? existing.jj_pointer : (input.jjPointer ?? null),
          input.jjCwd === undefined ? existing.jj_cwd : (input.jjCwd ?? null),
          input.heartbeatAt === undefined ? existing.heartbeat_at : (input.heartbeatAt ?? null),
          input.agentId === undefined ? existing.agent_id : (input.agentId ?? null),
          input.agentModel === undefined ? existing.agent_model : (input.agentModel ?? null),
          input.agentEngine === undefined ? existing.agent_engine : (input.agentEngine ?? null),
          input.agentResume === undefined ? existing.agent_resume : (input.agentResume ?? null),
          input.generatedAgentContextFingerprint === undefined
            ? existing.generated_agent_context_fingerprint
            : (input.generatedAgentContextFingerprint ?? null),
          input.meta === undefined ? existing.meta_json : toJson(input.meta ?? null),
          startedAt,
          timestamp,
          finishedAt,
          existing.id,
        );

      this.recordEvent({
        sessionId: workflowRun.session_id,
        kind: "workflowTaskAttempt.updated",
        subjectKind: "workflowTaskAttempt",
        subjectId: existing.id,
        at: timestamp,
      });
      const bindingSurfacePiSessionId = input.surfacePiSessionId ?? existing.surface_pi_session_id;
      const bindingFingerprint =
        input.generatedAgentContextFingerprint ??
        existing.generated_agent_context_fingerprint ??
        null;
      if (input.generatedAgentContextBinding && bindingSurfacePiSessionId && bindingFingerprint) {
        this.upsertGeneratedAgentContextBinding({
          surfacePiSessionId: bindingSurfacePiSessionId,
          ownerKind: "workflow-task-attempt",
          ownerId: existing.id,
          actorKind: "workflow-task",
          systemPrompt: input.generatedAgentContextBinding.systemPrompt,
          svvyxGuidance: input.generatedAgentContextBinding.svvyxGuidance,
          commandsDts: input.generatedAgentContextBinding.commandsDts,
          nativeToolSchemasJson: input.generatedAgentContextBinding.nativeToolSchemasJson,
          generatedAgentContextFingerprint: bindingFingerprint,
          generatedAgentContextRevision:
            input.generatedAgentContextBinding.generatedAgentContextRevision,
          loadedExtensionIds: input.generatedAgentContextBinding.loadedExtensionIds,
          availableExtensionIds: input.generatedAgentContextBinding.availableExtensionIds,
          externalSourceHashes: input.generatedAgentContextBinding.externalSourceHashes,
        });
      }
      return this.mustFindWorkflowTaskAttemptRecord(existing.id);
    }

    const workflowTaskAttemptId = this.createId("workflow-task-attempt");
    this.db
      .query(
        `INSERT INTO workflow_task_attempt (
           id,
           session_id,
           thread_id,
           workflow_run_id,
           smithers_run_id,
           node_id,
           iteration,
           attempt,
           surface_pi_session_id,
           title,
           summary,
           kind,
           status,
           smithers_state,
           prompt,
           response_text,
           error,
           cached,
           jj_pointer,
           jj_cwd,
           heartbeat_at,
           agent_id,
           agent_model,
           agent_engine,
           agent_resume,
           generated_agent_context_fingerprint,
           meta_json,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workflowTaskAttemptId,
        workflowRun.session_id,
        workflowRun.thread_id,
        input.workflowRunId,
        input.smithersRunId,
        input.nodeId,
        input.iteration,
        input.attempt,
        input.surfacePiSessionId ?? null,
        title,
        input.summary,
        input.kind,
        input.status,
        input.smithersState,
        input.prompt ?? null,
        input.responseText ?? null,
        input.error ?? null,
        input.cached ?? false,
        input.jjPointer ?? null,
        input.jjCwd ?? null,
        input.heartbeatAt ?? null,
        input.agentId ?? null,
        input.agentModel ?? null,
        input.agentEngine ?? null,
        input.agentResume ?? null,
        input.generatedAgentContextFingerprint ?? null,
        toJson(input.meta ?? null),
        startedAt,
        timestamp,
        finishedAt,
      );
    if (
      input.generatedAgentContextBinding &&
      input.surfacePiSessionId &&
      input.generatedAgentContextFingerprint
    ) {
      this.upsertGeneratedAgentContextBinding({
        surfacePiSessionId: input.surfacePiSessionId,
        ownerKind: "workflow-task-attempt",
        ownerId: workflowTaskAttemptId,
        actorKind: "workflow-task",
        systemPrompt: input.generatedAgentContextBinding.systemPrompt,
        svvyxGuidance: input.generatedAgentContextBinding.svvyxGuidance,
        commandsDts: input.generatedAgentContextBinding.commandsDts,
        nativeToolSchemasJson: input.generatedAgentContextBinding.nativeToolSchemasJson,
        generatedAgentContextFingerprint: input.generatedAgentContextFingerprint,
        generatedAgentContextRevision:
          input.generatedAgentContextBinding.generatedAgentContextRevision,
        loadedExtensionIds: input.generatedAgentContextBinding.loadedExtensionIds,
        availableExtensionIds: input.generatedAgentContextBinding.availableExtensionIds,
        externalSourceHashes: input.generatedAgentContextBinding.externalSourceHashes,
      });
    }

    this.recordEvent({
      sessionId: workflowRun.session_id,
      kind: "workflowTaskAttempt.created",
      subjectKind: "workflowTaskAttempt",
      subjectId: workflowTaskAttemptId,
      at: timestamp,
    });
    return this.mustFindWorkflowTaskAttemptRecord(workflowTaskAttemptId);
  }

  replaceWorkflowTaskMessages(input: {
    workflowTaskAttemptId: string;
    messages: Array<{
      id: string;
      role: StructuredWorkflowTaskMessageRole;
      source: StructuredWorkflowTaskMessageSource;
      smithersEventSeq?: number | null;
      text: string;
      createdAt: string;
    }>;
  }): StructuredWorkflowTaskMessageRecord[] {
    const attempt = this.mustFindWorkflowTaskAttemptRow(input.workflowTaskAttemptId);
    this.db
      .query(`DELETE FROM workflow_task_message WHERE workflow_task_attempt_id = ?`)
      .run(input.workflowTaskAttemptId);

    for (const message of input.messages) {
      this.db
        .query(
          `INSERT INTO workflow_task_message (
             id,
             session_id,
             workflow_task_attempt_id,
             role,
             source,
             smithers_event_seq,
             text,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.id,
          attempt.session_id,
          input.workflowTaskAttemptId,
          message.role,
          message.source,
          message.smithersEventSeq ?? null,
          message.text,
          message.createdAt,
        );
    }

    return this.queryWorkflowTaskMessageRowsByAttempt(input.workflowTaskAttemptId).map((row) =>
      this.mapWorkflowTaskMessage(row),
    );
  }

  findWorkflowRunBySmithersRunId(smithersRunId: string): StructuredWorkflowRunRecord | null {
    const row = this.findWorkflowRunRowBySmithersRunId(smithersRunId);
    return row ? this.mapWorkflowRun(row) : null;
  }

  findWorkflowTaskAttemptBySmithersIdentity(input: {
    smithersRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
  }): StructuredWorkflowTaskAttemptRecord | null {
    const row = this.findWorkflowTaskAttemptRowByIdentity(input);
    return row ? this.mapWorkflowTaskAttempt(row) : null;
  }

  acceptWorkflowTaskAgentStart(input: {
    workspaceSessionId: string;
    sourceCommandId: string;
    idempotencyKey: string;
    agent: {
      id: string;
      label: string;
      provider: string;
      model: string;
      reasoning: { effort: string };
      instructions: string;
      overrides?: Record<string, "loaded" | "available" | "unavailable">;
    };
    taskIdentity: {
      runId: string;
      nodeId: string;
      iteration: number;
      attempt: number;
    };
    smithersContext?: unknown;
    promptSource: unknown;
  }): {
    workspaceId: string;
    target: {
      workspaceSessionId: string;
      surface: "workflow-task";
      surfacePiSessionId: string;
      workflowTaskAttemptId: string;
      workflowRunId: string;
      threadId: string;
    };
    queuedMessage: StructuredSurfaceQueuedMessageRecord;
    accepted: "created" | "existing";
  } {
    return this.db.transaction((transactionInput: typeof input) => {
      const sourceCommand = this.mustFindCommandRow(transactionInput.sourceCommandId);
      if (sourceCommand.session_id !== transactionInput.workspaceSessionId) {
        throw new StateContractError({
          operation: "structured-session.acceptWorkflowTaskAgentStart",
          reason: "invalid-input",
          message: `Smithers source command ${transactionInput.sourceCommandId} is not owned by workspace session ${transactionInput.workspaceSessionId}.`,
        });
      }
      if (!sourceCommand.thread_id) {
        throw new StateContractError({
          operation: "structured-session.acceptWorkflowTaskAgentStart",
          reason: "invalid-input",
          message: "Smithers task-agent bridge requires a handler-thread source command.",
        });
      }
      if (
        sourceCommand.status === "succeeded" ||
        sourceCommand.status === "failed" ||
        sourceCommand.status === "cancelled"
      ) {
        throw new StateContractError({
          operation: "structured-session.acceptWorkflowTaskAgentStart",
          reason: "conflict",
          message: "Smithers source command is already terminal.",
        });
      }

      const existingQueue = this.db
        .query(
          `SELECT * FROM surface_message_queue
           WHERE idempotency_key = ?
             AND kind = 'workflow_task_agent_start'
             AND status != 'cancelled'
           LIMIT 1`,
        )
        .get(transactionInput.idempotencyKey) as SurfaceQueuedMessageRow | undefined;
      if (existingQueue?.workflow_task_attempt_id) {
        const attempt = this.mustFindWorkflowTaskAttemptRow(existingQueue.workflow_task_attempt_id);
        return {
          workspaceId: this.workspace.id,
          target: workflowTaskTarget({
            workspaceSessionId: transactionInput.workspaceSessionId,
            attempt,
          }),
          queuedMessage: this.mapSurfaceQueuedMessage(existingQueue),
          accepted: "existing" as const,
        };
      }

      let workflowRun = this.findWorkflowRunRowBySmithersRunId(transactionInput.taskIdentity.runId);
      if (!workflowRun) {
        const recorded = this.recordWorkflow({
          threadId: sourceCommand.thread_id,
          commandId: transactionInput.sourceCommandId,
          smithersRunId: transactionInput.taskIdentity.runId,
          workflowName: "Smithers workflow",
          workflowSource: "artifact",
          status: "running",
          smithersStatus: "running",
          summary: `Smithers run ${transactionInput.taskIdentity.runId}`,
        });
        workflowRun = this.mustFindWorkflowRunRow(recorded.id);
      }
      if (workflowRun.session_id !== transactionInput.workspaceSessionId) {
        throw new StateContractError({
          operation: "structured-session.acceptWorkflowTaskAgentStart",
          reason: "invalid-input",
          message: `Smithers run ${transactionInput.taskIdentity.runId} is not owned by workspace session ${transactionInput.workspaceSessionId}.`,
        });
      }
      if (workflowRun.thread_id !== sourceCommand.thread_id) {
        throw new StateContractError({
          operation: "structured-session.acceptWorkflowTaskAgentStart",
          reason: "invalid-input",
          message: `Smithers run ${transactionInput.taskIdentity.runId} is not owned by the source command handler thread.`,
        });
      }

      const existingAttempt = this.findWorkflowTaskAttemptRowByIdentity({
        smithersRunId: transactionInput.taskIdentity.runId,
        nodeId: transactionInput.taskIdentity.nodeId,
        iteration: transactionInput.taskIdentity.iteration,
        attempt: transactionInput.taskIdentity.attempt,
      });
      const surfacePiSessionId =
        existingAttempt?.surface_pi_session_id ?? this.createId("workflow-task-surface");
      const attempt = this.upsertWorkflowTaskAttempt({
        workflowRunId: workflowRun.id,
        smithersRunId: transactionInput.taskIdentity.runId,
        nodeId: transactionInput.taskIdentity.nodeId,
        iteration: transactionInput.taskIdentity.iteration,
        attempt: transactionInput.taskIdentity.attempt,
        surfacePiSessionId,
        title: transactionInput.agent.label,
        summary: `Workflow task agent ${transactionInput.agent.label}`,
        kind: "agent",
        status: "running",
        smithersState: "running",
        prompt:
          typeof (transactionInput.promptSource as { prompt?: unknown }).prompt === "string"
            ? (transactionInput.promptSource as { prompt: string }).prompt
            : null,
        agentId: transactionInput.agent.id,
        agentModel: transactionInput.agent.model,
        agentEngine: transactionInput.agent.provider,
        meta: {
          bridgeRequestIdempotencyKey: transactionInput.idempotencyKey,
          taskIdentity: transactionInput.taskIdentity,
          smithersContext: transactionInput.smithersContext ?? null,
          agentOverrides: transactionInput.agent.overrides ?? null,
        },
      });
      const attemptSurfacePiSessionId = attempt.surfacePiSessionId ?? surfacePiSessionId;
      this.upsertSurfaceLifecycle({
        surfacePiSessionId: attemptSurfacePiSessionId,
        sessionId: transactionInput.workspaceSessionId,
        surfaceKind: "workflow-task",
        threadId: sourceCommand.thread_id,
        workflowTaskAttemptId: attempt.id,
        status: "open",
        openedAt: this.now(),
        closedAt: null,
        closeReason: null,
      });

      const payload = {
        kind: "workflow_task_agent_start",
        workflowTaskAttemptId: attempt.id,
        taskIdentity: transactionInput.taskIdentity,
        smithersContext: transactionInput.smithersContext,
        agent: transactionInput.agent,
        promptSource: transactionInput.promptSource,
      };
      const queuedMessage = this.enqueueSurfaceMessage({
        sessionId: transactionInput.workspaceSessionId,
        surfacePiSessionId: attemptSurfacePiSessionId,
        threadId: sourceCommand.thread_id,
        workflowTaskAttemptId: attempt.id,
        kind: "workflow_task_agent_start",
        idempotencyKey: transactionInput.idempotencyKey,
        priority: "runtime",
        orderingKey: `workflow-task-attempt:${attempt.id}`,
        sourceCommandId: transactionInput.sourceCommandId,
        messageJson: JSON.stringify(
          workflowTaskPromptSourceToSubmittedMessage(transactionInput.promptSource),
        ),
        payloadJson: JSON.stringify(payload),
      });

      return {
        workspaceId: this.workspace.id,
        target: {
          workspaceSessionId: transactionInput.workspaceSessionId,
          surface: "workflow-task" as const,
          surfacePiSessionId: attemptSurfacePiSessionId,
          workflowTaskAttemptId: attempt.id,
          workflowRunId: workflowRun.id,
          threadId: sourceCommand.thread_id,
        },
        queuedMessage,
        accepted: existingAttempt ? ("existing" as const) : ("created" as const),
      };
    })(input);
  }

  getWorkflowTaskAgentAttemptTerminal(input: {
    workspaceSessionId: string;
    idempotencyKey: string;
  }):
    | {
        status: "in-flight";
        workspaceId: string;
        target: {
          workspaceSessionId: string;
          surface: "workflow-task";
          surfacePiSessionId: string;
          workflowTaskAttemptId: string;
          workflowRunId: string;
          threadId: string;
        };
        queuedMessage: StructuredSurfaceQueuedMessageRecord;
      }
    | {
        status: "completed";
        result: { text: string; usage?: unknown; output?: unknown };
      }
    | {
        status: "failed";
        error: string;
      }
    | {
        status: "conflict";
        error: string;
      }
    | null {
    const queue = this.findWorkflowTaskQueueRowByIdempotencyKey(input.idempotencyKey);
    if (!queue?.workflow_task_attempt_id) {
      return null;
    }
    const attempt = this.mustFindWorkflowTaskAttemptRow(queue.workflow_task_attempt_id);
    if (attempt.session_id !== input.workspaceSessionId) {
      return {
        status: "conflict",
        error: `Workflow task-agent idempotency key is not owned by workspace session ${input.workspaceSessionId}.`,
      };
    }
    const meta = fromJson<Record<string, unknown>>(attempt.meta_json) ?? {};
    if (meta.bridgeRequestIdempotencyKey !== input.idempotencyKey) {
      return {
        status: "conflict",
        error: "Workflow task-agent idempotency key does not match the durable attempt.",
      };
    }
    if (attempt.status === "completed") {
      return {
        status: "completed",
        result: workflowTaskAgentTerminalResultFromAttempt(attempt),
      };
    }
    if (attempt.status === "failed" || attempt.status === "cancelled") {
      return {
        status: "failed",
        error: attempt.error ?? `Workflow task-agent attempt ${attempt.status}.`,
      };
    }
    return {
      status: "in-flight",
      workspaceId: this.workspace.id,
      target: workflowTaskTarget({
        workspaceSessionId: input.workspaceSessionId,
        attempt,
      }),
      queuedMessage: this.mapSurfaceQueuedMessage(queue),
    };
  }

  settleWorkflowTaskAgentAttempt(input: {
    workflowTaskAttemptId: string;
    idempotencyKey: string;
    status: "completed" | "failed" | "cancelled";
    result?: { text: string; usage?: unknown; output?: unknown };
    error?: string;
  }):
    | {
        status: "completed";
        result: { text: string; usage?: unknown; output?: unknown };
      }
    | {
        status: "failed";
        error: string;
      }
    | {
        status: "conflict";
        error: string;
      } {
    return this.db.transaction((transactionInput: typeof input) => {
      const attempt = this.mustFindWorkflowTaskAttemptRow(transactionInput.workflowTaskAttemptId);
      const meta = fromJson<Record<string, unknown>>(attempt.meta_json) ?? {};
      if (meta.bridgeRequestIdempotencyKey !== transactionInput.idempotencyKey) {
        return {
          status: "conflict" as const,
          error:
            "Workflow task-agent settlement idempotency key does not match the durable attempt.",
        };
      }
      if (attempt.status === "completed") {
        return {
          status: "completed" as const,
          result: workflowTaskAgentTerminalResultFromAttempt(attempt),
        };
      }
      if (attempt.status === "failed" || attempt.status === "cancelled") {
        return {
          status: "failed" as const,
          error: attempt.error ?? `Workflow task-agent attempt ${attempt.status}.`,
        };
      }

      if (transactionInput.status === "completed" && !transactionInput.result) {
        return {
          status: "conflict" as const,
          error: "Completed workflow task-agent settlement requires a result.",
        };
      }
      const nextMeta = {
        ...meta,
        bridgeResult:
          transactionInput.status === "completed"
            ? {
                text: transactionInput.result?.text ?? "",
                ...(transactionInput.result?.usage === undefined
                  ? {}
                  : { usage: transactionInput.result.usage }),
                ...(transactionInput.result?.output === undefined
                  ? {}
                  : { output: transactionInput.result.output }),
              }
            : null,
      };
      const updated = this.upsertWorkflowTaskAttempt({
        workflowRunId: attempt.workflow_run_id,
        smithersRunId: attempt.smithers_run_id,
        nodeId: attempt.node_id,
        iteration: attempt.iteration,
        attempt: attempt.attempt,
        surfacePiSessionId: attempt.surface_pi_session_id,
        title: attempt.title,
        summary:
          transactionInput.status === "completed"
            ? "Task-agent attempt completed."
            : "Task-agent attempt failed.",
        kind: attempt.kind,
        status: transactionInput.status,
        smithersState: transactionInput.status,
        responseText:
          transactionInput.status === "completed"
            ? (transactionInput.result?.text ?? "")
            : attempt.response_text,
        error:
          transactionInput.status === "completed"
            ? null
            : (transactionInput.error ?? `Workflow task-agent attempt ${transactionInput.status}.`),
        cached: Boolean(attempt.cached),
        jjPointer: attempt.jj_pointer,
        jjCwd: attempt.jj_cwd,
        heartbeatAt: attempt.heartbeat_at,
        agentId: attempt.agent_id,
        agentModel: attempt.agent_model,
        agentEngine: attempt.agent_engine,
        agentResume: attempt.agent_resume,
        generatedAgentContextFingerprint: attempt.generated_agent_context_fingerprint,
        meta: nextMeta,
      });
      if (updated.status === "completed") {
        return {
          status: "completed" as const,
          result: workflowTaskAgentTerminalResultFromRecord(updated),
        };
      }
      return {
        status: "failed" as const,
        error: updated.error ?? `Workflow task-agent attempt ${updated.status}.`,
      };
    })(input);
  }

  recordWorkflow(input: {
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    workflowSource: "saved" | "artifact";
    entryPath?: string | null;
    savedEntryId?: string | null;
    status: StructuredWorkflowStatus;
    smithersStatus?: string;
    waitKind?: StructuredWorkflowWaitKind | null;
    continuedFromRunIds?: string[];
    activeDescendantRunId?: string | null;
    lastEventSeq?: number | null;
    heartbeatAt?: string | null;
    summary: string;
  }): StructuredWorkflowRunRecord {
    const thread = this.mustFindThreadRow(input.threadId);
    this.mustFindCommandRow(input.commandId);
    const workflowId = this.createId("workflow");
    const timestamp = this.now();
    this.db
      .query(
        `INSERT INTO workflow_run (
           id,
           session_id,
           thread_id,
           command_id,
           smithers_run_id,
           workflow_name,
           workflow_source,
           entry_path,
           saved_entry_id,
           status,
           smithers_status,
           wait_kind,
           continued_from_run_ids_json,
           active_descendant_run_id,
           last_event_seq,
           heartbeat_at,
           summary,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workflowId,
        thread.session_id,
        input.threadId,
        input.commandId,
        input.smithersRunId,
        input.workflowName,
        input.workflowSource,
        input.entryPath ?? null,
        input.savedEntryId ?? null,
        input.status,
        input.smithersStatus ?? defaultSmithersStatusForWorkflowStatus(input.status),
        input.waitKind ?? defaultWaitKindForWorkflowStatus(input.status),
        toJson(input.continuedFromRunIds ?? []),
        input.activeDescendantRunId ?? null,
        input.lastEventSeq ?? null,
        input.heartbeatAt ?? null,
        input.summary,
        timestamp,
        timestamp,
        isTerminalWorkflowStatus(input.status) ? timestamp : null,
      );

    this.recordEvent({
      sessionId: thread.session_id,
      kind: "workflowRun.created",
      subjectKind: "workflowRun",
      subjectId: workflowId,
      at: timestamp,
    });

    return this.mustFindWorkflowRunRecord(workflowId);
  }

  updateWorkflow(input: {
    workflowId: string;
    commandId?: string;
    status?: StructuredWorkflowStatus;
    smithersStatus?: string;
    waitKind?: StructuredWorkflowWaitKind | null;
    continuedFromRunIds?: string[];
    activeDescendantRunId?: string | null;
    lastEventSeq?: number | null;
    heartbeatAt?: string | null;
    summary?: string;
  }): StructuredWorkflowRunRecord {
    const existing = this.mustFindWorkflowRunRow(input.workflowId);
    if (input.commandId) {
      this.mustFindCommandRow(input.commandId);
    }
    const timestamp = this.now();
    const nextStatus = input.status ?? existing.status;
    this.db
      .query(
        `UPDATE workflow_run
         SET command_id = ?,
             status = ?,
             smithers_status = ?,
             wait_kind = ?,
             continued_from_run_ids_json = ?,
             active_descendant_run_id = ?,
             last_event_seq = ?,
             heartbeat_at = ?,
             summary = ?,
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        input.commandId ?? existing.command_id,
        nextStatus,
        input.smithersStatus ?? existing.smithers_status,
        input.waitKind === undefined ? existing.wait_kind : input.waitKind,
        input.continuedFromRunIds === undefined
          ? existing.continued_from_run_ids_json
          : toJson(input.continuedFromRunIds),
        input.activeDescendantRunId === undefined
          ? existing.active_descendant_run_id
          : (input.activeDescendantRunId ?? null),
        input.lastEventSeq === undefined ? existing.last_event_seq : input.lastEventSeq,
        input.heartbeatAt === undefined ? existing.heartbeat_at : (input.heartbeatAt ?? null),
        input.summary ?? existing.summary,
        timestamp,
        input.status === undefined
          ? existing.finished_at
          : isTerminalWorkflowStatus(nextStatus)
            ? timestamp
            : null,
        input.workflowId,
      );

    this.recordEvent({
      sessionId: existing.session_id,
      kind: "workflowRun.updated",
      subjectKind: "workflowRun",
      subjectId: input.workflowId,
      at: timestamp,
    });

    return this.mustFindWorkflowRunRecord(input.workflowId);
  }

  createRequestUserInputRequest(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    turnId: string;
    commandId: string;
    toolItemId: string;
    variant: StructuredRequestUserInputVariant;
    timeout?: null | {
      enabled: boolean;
      durationMs: number;
    };
    questions: Array<{
      title: string;
      question: string;
      defaultAnswer: StructuredRequestUserInputAnswer;
      choices?: Array<{
        label: string;
        description: string;
        recommended: boolean;
      }>;
    }>;
  }): StructuredRequestUserInputRequestRecord {
    if (input.questions.length < 1 || input.questions.length > 3) {
      throw new Error("Request user input requires one to three questions.");
    }

    const requestId = this.createId("rui");
    const timestamp = this.now();
    const timeout =
      input.timeout && input.variant === "blocking"
        ? {
            timerVersion: 1,
            enabled: input.timeout.enabled,
            durationMs: input.timeout.durationMs,
            startedAt: timestamp,
            pausedAt: null,
            remainingMsWhenPaused: null,
            expiresAt: input.timeout.enabled
              ? new Date(Date.parse(timestamp) + input.timeout.durationMs).toISOString()
              : null,
          }
        : null;
    const insertRequest = this.db.transaction(() => {
      this.mustFindSessionRow(input.sessionId);
      const turn = this.mustFindTurnRecord(input.turnId);
      const command = this.mustFindCommandRecord(input.commandId);
      const thread = input.threadId ? this.mustFindThreadRecord(input.threadId) : null;
      if (
        turn.sessionId !== input.sessionId ||
        turn.surfacePiSessionId !== input.surfacePiSessionId ||
        turn.threadId !== (input.threadId ?? null) ||
        command.sessionId !== input.sessionId ||
        command.surfacePiSessionId !== input.surfacePiSessionId ||
        command.threadId !== (input.threadId ?? null) ||
        command.turnId !== input.turnId ||
        (thread &&
          (thread.sessionId !== input.sessionId ||
            thread.surfacePiSessionId !== input.surfacePiSessionId))
      ) {
        throw new StateContractError({
          operation: "structured-session.createRequestUserInputRequest",
          reason: "conflict",
          message: "Request user input lineage does not match its target surface.",
        });
      }
      if (
        (turn.status !== "running" && turn.status !== "waiting") ||
        (command.status !== "requested" && command.status !== "running")
      ) {
        throw new StateContractError({
          operation: "structured-session.createRequestUserInputRequest",
          reason: "conflict",
          message: "Request user input requires an active turn and command.",
        });
      }
      this.db
        .query(
          `INSERT INTO request_user_input_request (
             id,
             session_id,
             surface_pi_session_id,
             thread_id,
             turn_id,
             command_id,
             tool_item_id,
             variant,
             status,
             timeout_json,
             created_at,
             completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)`,
        )
        .run(
          requestId,
          input.sessionId,
          input.surfacePiSessionId,
          input.threadId ?? null,
          input.turnId,
          input.commandId,
          input.toolItemId,
          input.variant,
          toJson(timeout),
          timestamp,
        );

      input.questions.forEach((question, questionIndex) => {
        const questionId = this.createId("ruiq");
        const choices = (question.choices ?? []).map((choice, choiceIndex) => ({
          optionId: this.createId("ruio"),
          ordinal: choiceIndex + 1,
          label: choice.label,
          description: choice.description,
          recommended: choice.recommended,
        }));
        this.db
          .query(
            `INSERT INTO request_user_input_question (
               id,
               request_id,
               ordinal,
               title,
               question,
               default_answer_json,
               choices_json,
               status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
          )
          .run(
            questionId,
            requestId,
            questionIndex + 1,
            question.title,
            question.question,
            toJson(question.defaultAnswer),
            toJson(choices),
          );
        this.db
          .query(
            `INSERT INTO request_user_input_answer (
               id,
               request_id,
               question_id,
               answer_json,
               answered_by,
               delivery,
               queued_item_id,
               created_at
             ) VALUES (?, ?, ?, ?, 'default', NULL, NULL, ?)`,
          )
          .run(
            this.createId("ruia"),
            requestId,
            questionId,
            toJson(question.defaultAnswer),
            timestamp,
          );
      });

      this.recordEvent({
        sessionId: input.sessionId,
        kind: "requestUserInput.created",
        subjectKind: "command",
        subjectId: input.commandId,
        at: timestamp,
        data: {
          requestId,
          surfacePiSessionId: input.surfacePiSessionId,
          threadId: input.threadId ?? null,
          variant: input.variant,
          questionCount: input.questions.length,
        },
      });
      if (input.variant === "blocking") {
        this.finishCommandMutation({
          commandId: input.commandId,
          status: "waiting",
          summary: `Waiting for user answer: ${input.questions.map((question) => question.title).join("; ")}`,
          facts: {
            questionCount: input.questions.length,
            answeredBy: "pending",
          },
          at: timestamp,
        });
        this.setSessionWait({
          sessionId: input.sessionId,
          owner: input.threadId
            ? { kind: "thread", threadId: input.threadId }
            : { kind: "orchestrator" },
          kind: "user",
          reason:
            input.questions.length === 1
              ? input.questions[0]!.title
              : `Waiting for ${input.questions.length} clarification answers.`,
          resumeWhen: "Resume when the user answers the clarification request.",
          at: timestamp,
        });
      }
    });
    insertRequest();
    return this.mustFindRequestUserInputRequestRecord(requestId);
  }

  createRuntimeApprovalRequest(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    turnId?: string | null;
    commandId?: string | null;
    toolCallId: string;
    toolName: StructuredRuntimeApprovalToolName;
    approvalMode: StructuredRuntimeApprovalMode;
    cwd: string;
    command?: string | null;
    commandFamily?: string | null;
    patch?: string | null;
    snippetArtifactId?: string | null;
    typescriptCode?: string | null;
    context?: StructuredRuntimeApprovalRequestRecord["context"];
  }): StructuredRuntimeApprovalRequestRecord {
    const requestId = this.createId("apr");
    const timestamp = this.now();
    const insert = this.db.transaction(() => {
      this.mustFindSessionRow(input.sessionId);
      const turn = input.turnId ? this.mustFindTurnRecord(input.turnId) : null;
      const command = input.commandId ? this.mustFindCommandRecord(input.commandId) : null;
      const thread = input.threadId ? this.mustFindThreadRecord(input.threadId) : null;
      if (
        (turn &&
          (turn.sessionId !== input.sessionId ||
            turn.surfacePiSessionId !== input.surfacePiSessionId ||
            turn.threadId !== (input.threadId ?? null))) ||
        (command &&
          (command.sessionId !== input.sessionId ||
            command.surfacePiSessionId !== input.surfacePiSessionId ||
            command.threadId !== (input.threadId ?? null) ||
            command.turnId !== (input.turnId ?? null))) ||
        (thread &&
          (thread.sessionId !== input.sessionId ||
            thread.surfacePiSessionId !== input.surfacePiSessionId))
      ) {
        throw new StateContractError({
          operation: "structured-session.createRuntimeApprovalRequest",
          reason: "conflict",
          message: "Runtime approval request lineage does not match its target surface.",
        });
      }
      if (command && command.status !== "requested" && command.status !== "running") {
        throw new StateContractError({
          operation: "structured-session.createRuntimeApprovalRequest",
          reason: "conflict",
          message: `Runtime approval command ${command.id} is already ${command.status}.`,
        });
      }
      if (input.approvalMode === "user" && !command) {
        throw new StateContractError({
          operation: "structured-session.createRuntimeApprovalRequest",
          reason: "invalid-input",
          message: "User approval requests require an active command.",
        });
      }
      this.db
        .query(
          `INSERT INTO runtime_approval_request (
             id,
             session_id,
             surface_pi_session_id,
             thread_id,
             turn_id,
             command_id,
             tool_call_id,
             tool_name,
             approval_mode,
             cwd,
             command_text,
             command_family,
             patch_text,
             snippet_artifact_id,
             typescript_code,
             context_json,
             status,
             decision_reason,
             reviewer,
             created_at,
             completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL)`,
        )
        .run(
          requestId,
          input.sessionId,
          input.surfacePiSessionId,
          input.threadId ?? null,
          input.turnId ?? null,
          input.commandId ?? null,
          input.toolCallId,
          input.toolName,
          input.approvalMode,
          input.cwd,
          input.command ?? null,
          input.commandFamily ?? null,
          input.patch ?? null,
          input.snippetArtifactId ?? null,
          input.typescriptCode ?? null,
          toJson(input.context ?? null),
          timestamp,
        );
      if (input.approvalMode === "user" && command) {
        const summary =
          input.toolName === "exec_command" && input.command
            ? `Run command: ${input.command}`
            : input.toolName === "apply_patch"
              ? "Apply patch"
              : "Run TypeScript";
        this.finishCommandMutation({
          commandId: command.id,
          status: "waiting",
          summary: `Waiting for approval: ${summary}`,
          facts: {
            ...command.facts,
            approval: "pending",
            approvalRequestId: requestId,
          },
          at: timestamp,
        });
        this.setSessionWait({
          sessionId: input.sessionId,
          owner: input.threadId
            ? { kind: "thread", threadId: input.threadId }
            : { kind: "orchestrator" },
          kind: "approval",
          reason: summary,
          resumeWhen: "Resume when the user approves or denies the runtime action.",
          at: timestamp,
        });
      }
      this.recordEvent({
        sessionId: input.sessionId,
        kind: "runtimeApproval.created",
        subjectKind: "command",
        subjectId: input.commandId ?? requestId,
        at: timestamp,
        data: {
          requestId,
          surfacePiSessionId: input.surfacePiSessionId,
          threadId: input.threadId ?? null,
          toolName: input.toolName,
          approvalMode: input.approvalMode,
        },
      });
    });
    insert();
    return this.getRuntimeApprovalRequest(requestId);
  }

  resolveRuntimeApprovalRequest(input: {
    requestId: string;
    status: Extract<StructuredRuntimeApprovalStatus, "approved" | "denied" | "cancelled">;
    reviewer: "auto-review" | "user";
    decisionReason?: string | null;
    terminalCommandStatus?: "failed" | "cancelled";
  }): StructuredRuntimeApprovalResolutionResult {
    const resolveApproval = this.db.transaction((): StructuredRuntimeApprovalResolutionResult => {
      const existing = this.getRuntimeApprovalRequest(input.requestId);
      if (existing.status !== "pending") {
        const sameDecision =
          existing.status === input.status &&
          existing.reviewer === input.reviewer &&
          existing.decisionReason === (input.decisionReason ?? null);
        if (sameDecision) {
          return { record: existing, changed: false };
        }
        throw new StateContractError({
          operation: "structured-session.resolveRuntimeApprovalRequest",
          reason: "conflict",
          message: `Runtime approval request ${input.requestId} already resolved with different facts.`,
        });
      }
      const timestamp = this.now();
      this.db
        .query(
          `UPDATE runtime_approval_request
           SET status = ?,
               decision_reason = ?,
               reviewer = ?,
               completed_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(
          input.status,
          input.decisionReason ?? null,
          input.reviewer,
          timestamp,
          input.requestId,
        );

      if (existing.commandId) {
        if (input.status === "approved") {
          this.startCommandMutation(existing.commandId, timestamp);
        } else {
          const command = this.mustFindCommandRecord(existing.commandId);
          this.finishCommandMutation({
            commandId: existing.commandId,
            status:
              input.status === "cancelled"
                ? (input.terminalCommandStatus ?? "cancelled")
                : "cancelled",
            summary: `Approval ${input.status}: ${existing.toolName}`,
            facts: {
              ...command.facts,
              approval: input.status,
              approvalRequestId: existing.requestId,
            },
            error: input.decisionReason ?? `Approval ${input.status}.`,
            at: timestamp,
          });
        }

        const wait = this.mapSessionWait(this.mustFindSessionRow(existing.sessionId));
        const waitOwnedByApproval =
          wait?.kind === "approval" &&
          (existing.threadId
            ? wait.owner.kind === "thread" && wait.owner.threadId === existing.threadId
            : wait.owner.kind === "orchestrator");
        const otherPendingApproval = this.db
          .query(
            `SELECT id FROM runtime_approval_request
             WHERE session_id = ?
               AND status = 'pending'
               AND thread_id IS ?
             LIMIT 1`,
          )
          .get(existing.sessionId, existing.threadId) as { id: string } | null;
        if (waitOwnedByApproval && !otherPendingApproval) {
          this.clearSessionWait({ sessionId: existing.sessionId, at: timestamp });
        }
      }

      this.recordEvent({
        sessionId: existing.sessionId,
        kind: "runtimeApproval.resolved",
        subjectKind: "command",
        subjectId: existing.commandId ?? existing.requestId,
        at: timestamp,
        data: {
          requestId: existing.requestId,
          status: input.status,
          reviewer: input.reviewer,
        },
      });
      return {
        record: this.getRuntimeApprovalRequest(input.requestId),
        changed: true,
      };
    });
    return resolveApproval();
  }

  getRuntimeApprovalRequest(requestId: string): StructuredRuntimeApprovalRequestRecord {
    return this.mustFindRuntimeApprovalRequestRecord(requestId);
  }

  listOpenRuntimeApprovalRequests(): StructuredRuntimeApprovalRequestRecord[] {
    return (
      this.db
        .query(
          `SELECT * FROM runtime_approval_request
           WHERE status = 'pending'
           ORDER BY created_at ASC`,
        )
        .all() as RuntimeApprovalRequestRow[]
    ).map((row) => this.mapRuntimeApprovalRequest(row));
  }

  answerRequestUserInput(input: {
    surfacePiSessionId: string;
    requestId: string;
    questionId: string;
    answer: { kind: "option"; optionId: string } | { kind: "custom"; text: string };
    delivery: StructuredRequestUserInputDelivery;
    clientSubmission?: RuntimeClientSubmissionInput;
  }): {
    request: StructuredRequestUserInputRequestRecord;
    answer: StructuredRequestUserInputAnswerRecord;
    queuedMessage: StructuredSurfaceQueuedMessageRecord | null;
    duplicate: boolean;
  } {
    const request = this.mustFindRequestUserInputRequestRecord(input.requestId);
    if (request.surfacePiSessionId !== input.surfacePiSessionId) {
      throw new Error("Request user input answer does not belong to the target surface.");
    }
    const question = request.questions.find((entry) => entry.questionId === input.questionId);
    if (!question || question.requestId !== request.requestId) {
      throw new Error("Request user input question does not belong to the request.");
    }
    const clientSubmission = normalizeRuntimeClientSubmissionMetadata(input.clientSubmission);
    const idempotencyKey =
      clientSubmission?.submissionId ??
      clientSubmission?.clientRequestId ??
      clientSubmission?.correlationId ??
      null;
    if (idempotencyKey) {
      const duplicate = this.findRequestUserInputAnswerByIdempotencyKey({
        requestId: request.requestId,
        questionId: question.questionId,
        idempotencyKey,
      });
      if (duplicate) {
        return {
          request,
          answer: this.mapRequestUserInputAnswer(duplicate),
          queuedMessage: duplicate.queued_item_id
            ? this.mustFindSurfaceQueuedMessageRecord(duplicate.queued_item_id)
            : null,
          duplicate: true,
        };
      }
    }
    if (request.status !== "open") {
      throw new Error("Request user input request is no longer answerable.");
    }
    if (question.status !== "open") {
      throw new Error("Request user input question is no longer answerable.");
    }
    if (input.delivery !== "enqueue-and-run" && input.delivery !== "queue-only") {
      throw new Error("Request user input answer delivery must be enqueue-and-run or queue-only.");
    }

    const userAnswer =
      input.answer.kind === "option"
        ? resolveRequestUserInputOptionAnswer(question, input.answer.optionId)
        : normalizeRequestUserInputCustomAnswer(input.answer.text);
    const originalAnswer = question.defaultAnswer;
    const payload = {
      type: "request_user_input.answer",
      title: question.title,
      question: question.question,
      originalAnswer,
      userAnswer,
    } satisfies RequestUserInputAnswerDeliveryPayload;
    const answerId = this.createId("ruia");
    const queuePayload = {
      kind: "request_user_input_answer",
      requestId: request.requestId as RequestInputRequestId,
      questionId: question.questionId as RequestInputQuestionId,
      answerId: answerId as RequestInputAnswerId,
      delivery: input.delivery,
    } satisfies RequestUserInputAnswerQueuePayload;
    const timestamp = this.now();
    const result = this.db.transaction(() => {
      const claimedQuestion = this.db
        .query(
          `UPDATE request_user_input_question
           SET status = 'answered'
           WHERE id = ?
             AND request_id = ?
             AND status = 'open'
             AND EXISTS (
               SELECT 1 FROM request_user_input_request AS request
               WHERE request.id = ?
                 AND request.surface_pi_session_id = ?
                 AND request.status = 'open'
             )`,
        )
        .run(question.questionId, request.requestId, request.requestId, input.surfacePiSessionId);
      if (claimedQuestion.changes !== 1) {
        const duplicate = idempotencyKey
          ? this.findRequestUserInputAnswerByIdempotencyKey({
              requestId: request.requestId,
              questionId: question.questionId,
              idempotencyKey,
            })
          : null;
        if (duplicate) {
          return {
            answerId: duplicate.id,
            queuedMessage: duplicate.queued_item_id
              ? this.mustFindSurfaceQueuedMessageRecord(duplicate.queued_item_id)
              : null,
            duplicate: true,
          };
        }
        throw new StateContractError({
          operation: "structured-session.answerRequestUserInput",
          reason: "stale-state",
          message: `Request user input ${request.requestId} question ${question.questionId} is no longer open.`,
        });
      }
      this.db
        .query(
          `INSERT INTO request_user_input_answer (
             id,
             request_id,
             question_id,
             answer_json,
             answered_by,
             delivery,
             queued_item_id,
             idempotency_key,
             created_at
           ) VALUES (?, ?, ?, ?, 'user', ?, NULL, ?, ?)`,
        )
        .run(
          answerId,
          request.requestId,
          question.questionId,
          toJson(userAnswer),
          input.delivery,
          idempotencyKey,
          timestamp,
        );
      const remainingOpen = this.db
        .query(
          `SELECT COUNT(*) AS count
           FROM request_user_input_question
           WHERE request_id = ? AND status = 'open'`,
        )
        .get(request.requestId) as { count: number };
      if (remainingOpen.count === 0) {
        const completedRequest = this.db
          .query(
            `UPDATE request_user_input_request
             SET status = 'completed',
                 completed_at = ?
             WHERE id = ?
               AND surface_pi_session_id = ?
               AND command_id = ?
               AND status = 'open'`,
          )
          .run(timestamp, request.requestId, request.surfacePiSessionId, request.commandId);
        if (completedRequest.changes !== 1) {
          throw new StateContractError({
            operation: "structured-session.answerRequestUserInput",
            reason: "stale-state",
            message: `Request user input ${request.requestId} terminal state changed while answering.`,
          });
        }
      }

      if (request.variant === "blocking") {
        if (remainingOpen.count === 0) {
          this.finalizeBlockingRequestUserInputFacts(request.requestId, undefined, timestamp);
        }
        return { answerId, queuedMessage: null, duplicate: false };
      }

      const queuedMessage = this.enqueueSurfaceMessage({
        sessionId: request.sessionId,
        surfacePiSessionId: request.surfacePiSessionId,
        threadId: request.threadId,
        kind: "request_user_input_answer",
        idempotencyKey: idempotencyKey
          ? `request_user_input_answer:${request.requestId}:${question.questionId}:${idempotencyKey}`
          : `request_user_input_answer:${answerId}`,
        messageJson: JSON.stringify(payload),
        payloadJson: JSON.stringify(queuePayload),
        position: "back",
      });
      this.db
        .query(
          `UPDATE request_user_input_answer
           SET queued_item_id = ?
           WHERE id = ?`,
        )
        .run(queuedMessage.id, answerId);
      return {
        answerId,
        queuedMessage:
          input.delivery === "enqueue-and-run"
            ? this.markSurfaceMessageSteering({ id: queuedMessage.id })
            : queuedMessage,
        duplicate: false,
      };
    })();

    return {
      request: this.mustFindRequestUserInputRequestRecord(request.requestId),
      answer: this.mustFindRequestUserInputAnswerRecord(result.answerId),
      queuedMessage: result.queuedMessage,
      duplicate: result.duplicate,
    };
  }

  defaultOpenRequestUserInputQuestions(input: {
    requestId: string;
    answeredBy: "timeout_default";
    expectedTimerVersion: number;
    expectedExpiresAt: string;
  }): StructuredRequestUserInputMutationResult {
    const request = this.mustFindRequestUserInputRequestRecord(input.requestId);
    if (request.status !== "open") {
      throw new StateContractError({
        operation: "structured-session.defaultOpenRequestUserInputQuestions",
        reason: "stale-state",
        message: `Request user input ${input.requestId} is no longer open.`,
      });
    }
    if (
      request.timeout?.enabled !== true ||
      request.timeout.pausedAt !== null ||
      request.timeout.timerVersion !== input.expectedTimerVersion ||
      request.timeout.expiresAt !== input.expectedExpiresAt
    ) {
      throw new StateContractError({
        operation: "structured-session.defaultOpenRequestUserInputQuestions",
        reason: "stale-state",
        message: `Request user input ${input.requestId} timeout generation is stale.`,
      });
    }
    const openQuestions = request.questions.filter((question) => question.status === "open");
    if (openQuestions.length === 0) {
      throw new StateContractError({
        operation: "structured-session.defaultOpenRequestUserInputQuestions",
        reason: "stale-state",
        message: `Request user input ${input.requestId} has no open questions.`,
      });
    }
    const timestamp = this.now();
    const defaultOpenQuestions = this.db.transaction(() => {
      const expiredRequest = this.db
        .query(
          `UPDATE request_user_input_request
           SET status = 'expired',
               completed_at = ?
           WHERE id = ?
             AND command_id = ?
             AND status = 'open'
             AND timeout_json = ?
             AND EXISTS (
               SELECT 1 FROM request_user_input_question AS question
               WHERE question.request_id = request_user_input_request.id
                 AND question.status = 'open'
             )`,
        )
        .run(timestamp, request.requestId, request.commandId, toJson(request.timeout));
      if (expiredRequest.changes !== 1) {
        throw new StateContractError({
          operation: "structured-session.defaultOpenRequestUserInputQuestions",
          reason: "stale-state",
          message: `Request user input ${input.requestId} timeout generation changed before expiry.`,
        });
      }
      const claimedRequest = this.mustFindRequestUserInputRequestRecord(request.requestId);
      const claimedQuestions = claimedRequest.questions.filter(
        (question) => question.status === "open",
      );
      for (const question of claimedQuestions) {
        this.db
          .query(
            `INSERT INTO request_user_input_answer (
               id,
               request_id,
               question_id,
               answer_json,
               answered_by,
               delivery,
               queued_item_id,
               created_at
             ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
          )
          .run(
            this.createId("ruia"),
            request.requestId,
            question.questionId,
            toJson(question.defaultAnswer),
            input.answeredBy,
            timestamp,
          );
        const defaultedQuestion = this.db
          .query(
            `UPDATE request_user_input_question
             SET status = 'defaulted'
             WHERE id = ? AND request_id = ? AND status = 'open'`,
          )
          .run(question.questionId, request.requestId);
        if (defaultedQuestion.changes !== 1) {
          throw new StateContractError({
            operation: "structured-session.defaultOpenRequestUserInputQuestions",
            reason: "stale-state",
            message: `Request user input ${request.requestId} question ${question.questionId} changed during expiry.`,
          });
        }
      }
      this.finalizeBlockingRequestUserInputFacts(request.requestId, undefined, timestamp);
    });
    defaultOpenQuestions();
    return {
      record: this.mustFindRequestUserInputRequestRecord(request.requestId),
      changed: true,
    };
  }

  cancelRequestUserInputRequest(input: {
    requestId: string;
    terminalCommandStatus?: "failed" | "cancelled";
    reason?: string;
  }): StructuredRequestUserInputMutationResult {
    const request = this.mustFindRequestUserInputRequestRecord(input.requestId);
    if (request.status !== "open") {
      return { record: request, changed: false };
    }
    const timestamp = this.now();
    const cancelRequest = this.db.transaction(() => {
      const cancelledRequest = this.db
        .query(
          `UPDATE request_user_input_request
           SET status = 'cancelled',
               completed_at = ?
           WHERE id = ?
             AND command_id = ?
             AND status = 'open'`,
        )
        .run(timestamp, request.requestId, request.commandId);
      if (cancelledRequest.changes !== 1) {
        return {
          record: this.mustFindRequestUserInputRequestRecord(request.requestId),
          changed: false,
        };
      }
      this.db
        .query(
          `UPDATE request_user_input_question
           SET status = 'cancelled'
           WHERE request_id = ? AND status = 'open'`,
        )
        .run(request.requestId);
      this.recordEvent({
        sessionId: request.sessionId,
        kind: "requestUserInput.cancelled",
        subjectKind: "command",
        subjectId: request.commandId,
        at: timestamp,
        data: {
          requestId: request.requestId,
          surfacePiSessionId: request.surfacePiSessionId,
        },
      });
      this.finalizeBlockingRequestUserInputFacts(
        request.requestId,
        input.reason ?? "Request user input cancelled.",
        timestamp,
        input.terminalCommandStatus,
      );
      return {
        record: this.mustFindRequestUserInputRequestRecord(request.requestId),
        changed: true,
      };
    });
    return cancelRequest();
  }

  private finalizeBlockingRequestUserInputFacts(
    requestId: string,
    reason?: string,
    at?: string,
    cancelledCommandStatus: "failed" | "cancelled" = "cancelled",
  ): void {
    const request = this.mustFindRequestUserInputRequestRecord(requestId);
    if (request.variant !== "blocking" || request.status === "open") {
      return;
    }
    if (request.status === "cancelled") {
      this.finishCommandMutation({
        commandId: request.commandId,
        status: cancelledCommandStatus,
        summary: "Request user input cancelled.",
        error: reason ?? "Request user input cancelled.",
        ...(at ? { at } : {}),
      });
    } else {
      const answerSources = request.questions.map(
        (question) =>
          request.answers
            .filter((answer) => answer.questionId === question.questionId)
            .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
            .at(-1)?.answeredBy ?? "default",
      );
      const answeredBy = new Set(answerSources);
      this.finishCommandMutation({
        commandId: request.commandId,
        status: "succeeded",
        summary:
          request.questions.length === 1
            ? `Answered ${request.questions[0]!.title}.`
            : `Answered ${request.questions.length} clarification questions.`,
        facts: {
          questionCount: request.questions.length,
          answeredBy: answeredBy.size === 1 ? (answerSources[0] ?? "default") : "mixed",
          requestInputId: request.requestId,
        },
        ...(at ? { at } : {}),
      });
    }

    const wait = this.mapSessionWait(this.mustFindSessionRow(request.sessionId));
    const waitOwnedByRequest =
      wait?.kind === "user" &&
      (request.threadId
        ? wait.owner.kind === "thread" && wait.owner.threadId === request.threadId
        : wait.owner.kind === "orchestrator");
    const otherOpenBlockingRequest = this.db
      .query(
        `SELECT id FROM request_user_input_request
         WHERE session_id = ?
           AND variant = 'blocking'
           AND status = 'open'
           AND thread_id IS ?
         LIMIT 1`,
      )
      .get(request.sessionId, request.threadId) as { id: string } | null;
    if (waitOwnedByRequest && !otherOpenBlockingRequest) {
      this.clearSessionWait({ sessionId: request.sessionId, ...(at ? { at } : {}) });
    }
  }

  setRequestUserInputTimerPaused(input: {
    surfacePiSessionId: string;
    requestId: string;
    paused: boolean;
  }): StructuredRequestUserInputMutationResult {
    const request = this.mustFindRequestUserInputRequestRecord(input.requestId);
    if (request.surfacePiSessionId !== input.surfacePiSessionId) {
      throw new StateContractError({
        operation: "runtime-request-state.setRequestInputTimerPaused",
        reason: "conflict",
        message: "Request user input timer does not belong to the target surface.",
      });
    }
    if (request.status !== "open") {
      throw new Error("Request user input timer is no longer active.");
    }
    if (request.variant !== "blocking" || !request.timeout?.enabled) {
      throw new Error("Request user input timer is not enabled.");
    }
    if (input.paused && request.timeout.pausedAt) {
      return { record: request, changed: false };
    }
    if (!input.paused && !request.timeout.pausedAt) {
      return { record: request, changed: false };
    }

    const timestamp = this.now();
    const timeout = input.paused
      ? {
          ...request.timeout,
          timerVersion: request.timeout.timerVersion + 1,
          pausedAt: timestamp,
          remainingMsWhenPaused: Math.max(
            0,
            Date.parse(request.timeout.expiresAt ?? timestamp) - Date.parse(timestamp),
          ),
          expiresAt: null,
        }
      : {
          ...request.timeout,
          timerVersion: request.timeout.timerVersion + 1,
          pausedAt: null,
          remainingMsWhenPaused: null,
          expiresAt: new Date(
            Date.parse(timestamp) + (request.timeout.remainingMsWhenPaused ?? 0),
          ).toISOString(),
        };

    const updateTimer = this.db.transaction(() => {
      const updated = this.db
        .query(
          `UPDATE request_user_input_request
           SET timeout_json = ?
           WHERE id = ?
             AND surface_pi_session_id = ?
             AND status = 'open'
             AND timeout_json = ?`,
        )
        .run(toJson(timeout), request.requestId, input.surfacePiSessionId, toJson(request.timeout));
      if (updated.changes !== 1) {
        const latest = this.mustFindRequestUserInputRequestRecord(request.requestId);
        if (
          latest.status === "open" &&
          latest.timeout?.enabled === true &&
          Boolean(latest.timeout.pausedAt) === input.paused
        ) {
          return { record: latest, changed: false };
        }
        throw new StateContractError({
          operation: "runtime-request-state.setRequestInputTimerPaused",
          reason: "stale-state",
          message: `Request user input ${request.requestId} timer generation changed before update.`,
        });
      }
      return {
        record: this.mustFindRequestUserInputRequestRecord(request.requestId),
        changed: true,
      };
    });
    return updateTimer();
  }

  getRequestUserInputRequest(requestId: string): StructuredRequestUserInputRequestRecord {
    return this.mustFindRequestUserInputRequestRecord(requestId);
  }

  enqueueSurfaceMessage(input: {
    sessionId: string;
    surfacePiSessionId: string;
    threadId?: string | null;
    workflowTaskAttemptId?: string | null;
    kind?: StructuredSurfaceQueueItemKind;
    idempotencyKey?: string | null;
    priority?: StructuredSurfaceQueuePriority;
    orderingKey?: string | null;
    sourceCommandId?: string | null;
    maxAttempts?: number;
    nextAttemptAt?: string | null;
    messageJson: string;
    payloadJson?: string | null;
    position?: "front" | "back";
  }): StructuredSurfaceQueuedMessageRecord {
    this.mustFindSessionRow(input.sessionId);
    if (input.threadId) {
      this.mustFindThreadRow(input.threadId);
    }
    if (input.workflowTaskAttemptId) {
      this.mustFindWorkflowTaskAttemptRow(input.workflowTaskAttemptId);
    }
    const id = this.createId("queued-message");
    const idempotencyKey = input.idempotencyKey?.trim() || `surface_queue:${id}`;
    const existing = this.db
      .query(
        `SELECT * FROM surface_message_queue
         WHERE surface_pi_session_id = ?
           AND idempotency_key = ?
           AND status NOT IN ('delivered', 'cancelled')
         LIMIT 1`,
      )
      .get(input.surfacePiSessionId, idempotencyKey) as SurfaceQueuedMessageRow | undefined;
    if (existing) {
      return this.mapSurfaceQueuedMessage(existing);
    }
    const timestamp = this.now();
    const kind = input.kind ?? "user_message";
    const priority =
      input.priority ?? (kind === "request_user_input_answer" ? "interactive" : "runtime");
    const orderingKey = input.orderingKey?.trim() || `surface:${input.surfacePiSessionId}`;
    const sequence = this.nextSurfaceMessageSequence(input.surfacePiSessionId, orderingKey);
    const queuePosition = this.nextSurfaceMessagePosition(
      input.surfacePiSessionId,
      input.position ?? "back",
    );
    this.db
      .query(
        `INSERT INTO surface_message_queue (
           id,
           session_id,
           surface_pi_session_id,
           thread_id,
           workflow_task_attempt_id,
           kind,
           idempotency_key,
           message_json,
           payload_json,
           status,
           priority,
           ordering_key,
           sequence,
           position,
           source_command_id,
           claim_owner_id,
           claim_lease_expires_at,
           lease_version,
           attempt_count,
           max_attempts,
           next_attempt_at,
           last_error_json,
           created_at,
           updated_at,
           delivered_at,
           failed_at,
           failure_error,
           cancelled_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, NULL, NULL, 0, 0, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL)`,
      )
      .run(
        id,
        input.sessionId,
        input.surfacePiSessionId,
        input.threadId ?? null,
        input.workflowTaskAttemptId ?? null,
        kind,
        idempotencyKey,
        input.messageJson,
        input.payloadJson ?? null,
        priority,
        orderingKey,
        sequence,
        queuePosition,
        input.sourceCommandId ?? null,
        Math.max(1, Math.trunc(input.maxAttempts ?? 3)),
        input.nextAttemptAt ?? null,
        timestamp,
        timestamp,
      );

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "surfaceMessage.queued",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        surfacePiSessionId: input.surfacePiSessionId,
        threadId: input.threadId ?? null,
        queuedMessageId: id,
        idempotencyKey,
      },
    });

    return this.mustFindSurfaceQueuedMessageRecord(id);
  }

  acceptSubmittedSurfaceMessage(input: {
    target: {
      workspaceSessionId: string;
      surfacePiSessionId: string;
      surface: "orchestrator" | "handler";
      threadId?: string;
    };
    idempotencyKey?: string | null;
    promptHistoryText: string | null;
    sourceCommandId?: string | null;
    maxAttempts?: number;
    nextAttemptAt?: string | null;
    messageJson: string;
    payloadJson?: string | null;
    position?: "front" | "back";
  }): {
    queuedMessage: StructuredSurfaceQueuedMessageRecord;
    accepted: "created" | "existing";
    draftCleared: boolean;
    promptHistoryRecorded: boolean;
  } {
    if (input.promptHistoryText !== null && !input.promptHistoryText.trim()) {
      throw new StateContractError({
        operation: "structured-session.acceptSubmittedSurfaceMessage",
        reason: "invalid-input",
        message: "Prompt-history text must be non-empty when present.",
      });
    }
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    const accept = this.db.transaction(() => {
      if (idempotencyKey) {
        const existing = this.db
          .query(
            `SELECT * FROM surface_message_queue
             WHERE surface_pi_session_id = ?
               AND idempotency_key = ?
             ORDER BY created_at ASC, id ASC
             LIMIT 1`,
          )
          .get(input.target.surfacePiSessionId, idempotencyKey) as
          | SurfaceQueuedMessageRow
          | undefined;
        if (existing) {
          return {
            queuedMessage: this.mapSurfaceQueuedMessage(existing),
            accepted: "existing" as const,
            draftCleared: false,
            promptHistoryRecorded: false,
          };
        }
      }
      const threadId = input.target.surface === "handler" ? (input.target.threadId ?? null) : null;
      const queuedMessage = this.enqueueSurfaceMessage({
        sessionId: input.target.workspaceSessionId,
        surfacePiSessionId: input.target.surfacePiSessionId,
        threadId,
        kind: "user_message",
        ...(idempotencyKey ? { idempotencyKey } : {}),
        priority: "runtime",
        orderingKey: `surface:${input.target.surfacePiSessionId}`,
        ...(input.sourceCommandId ? { sourceCommandId: input.sourceCommandId } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
        ...(input.nextAttemptAt !== undefined ? { nextAttemptAt: input.nextAttemptAt } : {}),
        messageJson: input.messageJson,
        ...(input.payloadJson !== undefined ? { payloadJson: input.payloadJson } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      });
      if (input.promptHistoryText !== null) {
        this.db
          .query(
            `INSERT INTO prompt_history (
               workspace_id,
               workspace_session_id,
               surface_pi_session_id,
               queue_item_id,
               text,
               sent_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.workspace.id,
            input.target.workspaceSessionId,
            input.target.surfacePiSessionId,
            queuedMessage.id,
            input.promptHistoryText,
            queuedMessage.createdAt,
          );
      }
      const existingDraft = this.getComposerDraft(input.target.surfacePiSessionId);
      if (existingDraft) {
        this.setComposerDraft({
          sessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId,
          text: "",
          attachments: [],
          snippetMentions: [],
        });
      }

      return {
        queuedMessage,
        accepted: "created" as const,
        draftCleared: existingDraft !== null,
        promptHistoryRecorded: input.promptHistoryText !== null,
      };
    });

    return accept();
  }

  acceptEditedCommittedSurfaceMessage(
    input: AcceptEditedCommittedRuntimeSurfaceMessageInput,
  ): AcceptEditedCommittedRuntimeSurfaceMessageResult {
    if (input.workspaceId !== this.workspace.id) {
      throw new StateContractError({
        operation: "structured-session.acceptEditedCommittedSurfaceMessage",
        reason: "not-found",
        message: `Workspace ${input.workspaceId} is not managed by this state store.`,
      });
    }
    return this.db.transaction(() => {
      const existing = this.db
        .query(
          `SELECT * FROM surface_message_queue
           WHERE surface_pi_session_id = ? AND idempotency_key = ?
           ORDER BY created_at ASC, id ASC LIMIT 1`,
        )
        .get(input.target.surfacePiSessionId, input.idempotencyKey) as
        | SurfaceQueuedMessageRow
        | undefined;
      if (existing) {
        return {
          queuedMessage: this.mapSurfaceQueuedMessage(existing),
          accepted: "existing" as const,
        };
      }

      const pending = this.db
        .query(
          `SELECT id FROM surface_message_queue
           WHERE surface_pi_session_id = ?
             AND status IN ('queued', 'steering', 'dispatching') LIMIT 1`,
        )
        .get(input.target.surfacePiSessionId) as { id: string } | undefined;
      if (pending) {
        throw new StateContractError({
          operation: "structured-session.acceptEditedCommittedSurfaceMessage",
          reason: "conflict",
          message: `Surface ${input.target.surfacePiSessionId} has pending queued message ${pending.id}.`,
        });
      }

      const source = this.mustFindTranscriptMessageRow(input.sourceMessageId);
      if (
        source.role !== "user" ||
        source.session_id !== input.target.workspaceSessionId ||
        source.surface_pi_session_id !== input.target.surfacePiSessionId ||
        source.committed_at !== input.expectedCommittedAt ||
        source.pi_history_entry_json !== JSON.stringify(input.sourcePiHistoryEntry)
      ) {
        throw new StateContractError({
          operation: "structured-session.acceptEditedCommittedSurfaceMessage",
          reason: "conflict",
          message: `Transcript message ${input.sourceMessageId} is not the expected committed user message.`,
        });
      }
      const cursor = this.readRuntimeTranscriptStreamCursorRow(input.target.surfacePiSessionId);
      if (cursor?.active_assistant_message_id) {
        throw new StateContractError({
          operation: "structured-session.acceptEditedCommittedSurfaceMessage",
          reason: "conflict",
          message: `Transcript surface ${input.target.surfacePiSessionId} still has an active assistant message.`,
        });
      }

      this.db
        .query(
          `DELETE FROM transcript_content_block WHERE message_id IN (
             SELECT message_id FROM transcript_message
             WHERE surface_pi_session_id = ? AND ordinal >= ?
           )`,
        )
        .run(input.target.surfacePiSessionId, source.ordinal);
      this.db
        .query(
          `DELETE FROM transcript_message
           WHERE surface_pi_session_id = ? AND ordinal >= ?`,
        )
        .run(input.target.surfacePiSessionId, source.ordinal);

      const queuedMessage = this.enqueueSurfaceMessage({
        sessionId: input.target.workspaceSessionId,
        surfacePiSessionId: input.target.surfacePiSessionId,
        threadId: input.target.surface === "handler" ? input.target.threadId : null,
        kind: "user_message",
        idempotencyKey: input.idempotencyKey,
        priority: "interactive",
        orderingKey: `surface:${input.target.surfacePiSessionId}`,
        messageJson: input.messageJson,
        payloadJson: input.payloadJson,
      });
      if (input.promptHistoryText !== null) {
        this.db
          .query(
            `INSERT INTO prompt_history (
               workspace_id, workspace_session_id, surface_pi_session_id,
               queue_item_id, text, sent_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.workspace.id,
            input.target.workspaceSessionId,
            input.target.surfacePiSessionId,
            queuedMessage.id,
            input.promptHistoryText,
            queuedMessage.createdAt,
          );
      }
      const existingDraft = this.getComposerDraft(input.target.surfacePiSessionId);
      if (existingDraft) {
        this.setComposerDraft({
          sessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.surface === "handler" ? input.target.threadId : null,
          text: "",
          attachments: [],
          snippetMentions: [],
        });
      }
      this.bumpStateRevision();
      return { queuedMessage, accepted: "created" as const };
    })();
  }

  listQueuedSurfaceMessages(input: {
    surfacePiSessionId: string;
  }): StructuredSurfaceQueuedMessageRecord[] {
    return this.queryQueuedSurfaceMessageRows(input.surfacePiSessionId).map((row) =>
      this.mapSurfaceQueuedMessage(row),
    );
  }

  getSurfaceQueuedMessage(input: { id: string }): StructuredSurfaceQueuedMessageRecord {
    return this.mustFindSurfaceQueuedMessageRecord(input.id);
  }

  claimNextQueuedSurfaceMessage(input: {
    surfacePiSessionId: string;
    claimOwnerId?: string | null;
    leaseDurationMs?: number;
  }): StructuredSurfaceQueuedMessageRecord | null {
    const timestamp = this.now();
    const claimOwnerId = input.claimOwnerId?.trim() || "runtime";
    const leaseDurationMs = Math.max(1, Math.trunc(input.leaseDurationMs ?? 30_000));
    const claimLeaseExpiresAt = new Date(Date.parse(timestamp) + leaseDurationMs).toISOString();
    const claim = this.db.transaction(() => {
      const row =
        (this.db
          .query(
            `SELECT * FROM surface_message_queue
             WHERE surface_pi_session_id = ?
               AND status IN ('queued', 'steering')
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
               AND attempt_count < max_attempts
           ORDER BY
               CASE
                 WHEN status = 'steering' THEN 0
                 ELSE 1
               END ASC,
               CASE priority
                 WHEN 'interactive' THEN 0
                 WHEN 'runtime' THEN 1
                 ELSE 2
               END ASC,
               ordering_key ASC,
               sequence ASC,
               rowid ASC
             LIMIT 1`,
          )
          .get(input.surfacePiSessionId, timestamp) as SurfaceQueuedMessageRow | undefined) ?? null;
      if (!row) {
        return null;
      }
      const result = this.db
        .query(
          `UPDATE surface_message_queue
           SET status = 'dispatching',
               updated_at = ?,
               claim_owner_id = ?,
               claim_lease_expires_at = ?,
               lease_version = lease_version + 1,
               attempt_count = attempt_count + 1
           WHERE id = ? AND status IN ('queued', 'steering')`,
        )
        .run(timestamp, claimOwnerId, claimLeaseExpiresAt, row.id);
      if (result.changes !== 1) {
        return null;
      }
      this.recordSurfaceMessageEvent(row, "surfaceMessage.dispatching", timestamp);
      return this.mustFindSurfaceQueuedMessageRecord(row.id);
    });
    return claim();
  }

  releaseExpiredSurfaceMessageClaims(
    input: {
      surfacePiSessionId?: string | null;
      now?: string | null;
    } = {},
  ): StructuredSurfaceQueuedMessageRecord[] {
    const timestamp = input.now ?? this.now();
    const release = this.db.transaction(() => {
      const rows = this.db
        .query(
          `SELECT * FROM surface_message_queue
           WHERE status = 'dispatching'
             AND claim_lease_expires_at IS NOT NULL
             AND claim_lease_expires_at <= ?
             AND (? IS NULL OR surface_pi_session_id = ?)
           ORDER BY surface_pi_session_id ASC, ordering_key ASC, sequence ASC, rowid ASC`,
        )
        .all(
          timestamp,
          input.surfacePiSessionId ?? null,
          input.surfacePiSessionId ?? null,
        ) as SurfaceQueuedMessageRow[];
      for (const row of rows) {
        this.db
          .query(
            `UPDATE surface_message_queue
             SET status = 'queued',
                 updated_at = ?,
                 claim_owner_id = NULL,
                 claim_lease_expires_at = NULL
             WHERE id = ? AND status = 'dispatching'`,
          )
          .run(timestamp, row.id);
        this.recordSurfaceMessageEvent(row, "surfaceMessage.claimReleased", timestamp);
      }
      return rows.map((row) => this.mustFindSurfaceQueuedMessageRecord(row.id));
    });
    return release();
  }

  markSurfaceMessageSteering(input: { id: string }): StructuredSurfaceQueuedMessageRecord {
    return this.updateSurfaceMessageStatus({
      id: input.id,
      status: "steering",
      eventKind: "surfaceMessage.steering",
    });
  }

  markSurfaceMessageQueued(input: {
    id: string;
    position?: "front" | "back";
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
    expectedStatuses?: readonly StructuredSurfaceQueuedMessageStatus[];
  }): StructuredSurfaceQueuedMessageRecord {
    const existing = this.mustFindSurfaceQueuedMessageRow(input.id);
    const timestamp = this.now();
    const position = this.nextSurfaceMessagePosition(
      existing.surface_pi_session_id,
      input.position ?? "front",
    );
    const expectedStatuses = input.expectedStatuses ?? [];
    const result =
      expectedStatuses.length > 0
        ? this.db
            .query(
              `UPDATE surface_message_queue
               SET status = 'queued',
                   position = ?,
                   updated_at = ?,
                   claim_owner_id = NULL,
                   claim_lease_expires_at = NULL,
                   attempt_count = 0,
                   next_attempt_at = NULL,
                   last_error_json = NULL,
                   delivered_at = NULL,
                   failed_at = NULL,
                   failure_error = NULL,
                   cancelled_at = NULL
               WHERE id = ?
                 AND (? IS NULL OR claim_owner_id = ?)
                 AND (? IS NULL OR lease_version = ?)
                 AND status IN (${expectedStatuses.map(() => "?").join(", ")})`,
            )
            .run(
              position,
              timestamp,
              input.id,
              input.claimOwnerId ?? null,
              input.claimOwnerId ?? null,
              input.leaseVersion ?? null,
              input.leaseVersion ?? null,
              ...expectedStatuses,
            )
        : this.db
            .query(
              `UPDATE surface_message_queue
               SET status = 'queued',
                   position = ?,
                   updated_at = ?,
                   claim_owner_id = NULL,
                   claim_lease_expires_at = NULL,
                   attempt_count = 0,
                   next_attempt_at = NULL,
                   last_error_json = NULL,
                   delivered_at = NULL,
                   failed_at = NULL,
                   failure_error = NULL,
                   cancelled_at = NULL
               WHERE id = ?
                 AND (? IS NULL OR claim_owner_id = ?)
                 AND (? IS NULL OR lease_version = ?)`,
            )
            .run(
              position,
              timestamp,
              input.id,
              input.claimOwnerId ?? null,
              input.claimOwnerId ?? null,
              input.leaseVersion ?? null,
              input.leaseVersion ?? null,
            );
    if (result.changes !== 1) {
      throw new StateContractError({
        operation: "structured-session.markSurfaceMessageQueued",
        reason: "claim-conflict",
        message: `Surface queued message ${input.id} is not in a queueable state.`,
      });
    }
    this.recordSurfaceMessageEvent(existing, "surfaceMessage.restored", timestamp);
    return this.mustFindSurfaceQueuedMessageRecord(input.id);
  }

  markSurfaceMessageDelivered(input: {
    id: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
  }): StructuredSurfaceQueuedMessageRecord {
    return this.updateSurfaceMessageStatus({
      id: input.id,
      status: "delivered",
      eventKind: "surfaceMessage.delivered",
      ...(input.claimOwnerId === undefined ? {} : { claimOwnerId: input.claimOwnerId }),
      ...(input.leaseVersion === undefined ? {} : { leaseVersion: input.leaseVersion }),
    });
  }

  markSurfaceMessageFailed(input: {
    id: string;
    failureError: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
  }): StructuredSurfaceQueuedMessageRecord {
    const existing = this.mustFindSurfaceQueuedMessageRow(input.id);
    const timestamp = this.now();
    const result = this.db
      .query(
        `UPDATE surface_message_queue
         SET status = 'failed',
             updated_at = ?,
             failed_at = ?,
             failure_error = ?,
             last_error_json = ?,
             claim_owner_id = NULL,
             claim_lease_expires_at = NULL
         WHERE id = ?
           AND (? IS NULL OR claim_owner_id = ?)
           AND (? IS NULL OR lease_version = ?)`,
      )
      .run(
        timestamp,
        timestamp,
        input.failureError,
        JSON.stringify({ message: input.failureError }),
        input.id,
        input.claimOwnerId ?? null,
        input.claimOwnerId ?? null,
        input.leaseVersion ?? null,
        input.leaseVersion ?? null,
      );
    if (result.changes !== 1) {
      throw new Error(`Surface queued message claim is stale: ${input.id}`);
    }
    this.recordSurfaceMessageEvent(existing, "surfaceMessage.failed", timestamp);
    return this.mustFindSurfaceQueuedMessageRecord(input.id);
  }

  cancelSurfaceMessage(input: {
    id: string;
    claimOwnerId?: string | null;
    leaseVersion?: number | null;
    expectedStatuses?: readonly StructuredSurfaceQueuedMessageStatus[];
  }): StructuredSurfaceQueuedMessageRecord {
    const existing = this.mustFindSurfaceQueuedMessageRow(input.id);
    const timestamp = this.now();
    const cancel = this.db.transaction(() => {
      const expectedStatuses = input.expectedStatuses ?? [];
      const result = this.db
        .query(
          `UPDATE surface_message_queue
           SET status = 'cancelled',
               updated_at = ?,
               cancelled_at = ?,
               claim_owner_id = NULL,
               claim_lease_expires_at = NULL
           WHERE id = ?
             AND (? IS NULL OR claim_owner_id = ?)
             AND (? IS NULL OR lease_version = ?)
             ${
               expectedStatuses.length > 0
                 ? `AND status IN (${expectedStatuses.map(() => "?").join(", ")})`
                 : ""
             }`,
        )
        .run(
          timestamp,
          timestamp,
          input.id,
          input.claimOwnerId ?? null,
          input.claimOwnerId ?? null,
          input.leaseVersion ?? null,
          input.leaseVersion ?? null,
          ...expectedStatuses,
        );
      if (result.changes !== 1) {
        throw new StateContractError({
          operation: "structured-session.cancelSurfaceMessage",
          reason: "claim-conflict",
          message: `Surface queued message claim is stale or not cancellable: ${input.id}`,
        });
      }

      if (existing.kind === "request_user_input_answer") {
        const rawPayload = fromJson<unknown>(existing.payload_json);
        const payload = rawPayload
          ? Exit.match(decodeUnknownRequestUserInputAnswerQueuePayloadExit(rawPayload), {
              onFailure: (cause) => {
                throw Cause.squash(cause);
              },
              onSuccess: (value) => value,
            })
          : null;
        if (payload) {
          this.db
            .query(
              `DELETE FROM request_user_input_answer
               WHERE id = ?
                 AND request_id = ?
                 AND question_id = ?
                 AND queued_item_id = ?`,
            )
            .run(payload.answerId, payload.requestId, payload.questionId, input.id);
          this.db
            .query(
              `UPDATE request_user_input_question
               SET status = 'open'
               WHERE id = ?
                 AND request_id = ?`,
            )
            .run(payload.questionId, payload.requestId);
          this.db
            .query(
              `UPDATE request_user_input_request
               SET status = 'open',
                   completed_at = NULL
               WHERE id = ?
                 AND status = 'completed'`,
            )
            .run(payload.requestId);
        }
      }

      this.recordSurfaceMessageEvent(existing, "surfaceMessage.cancelled", timestamp);
    });
    cancel();
    return this.mustFindSurfaceQueuedMessageRecord(input.id);
  }

  reorderSurfaceMessage(input: {
    surfacePiSessionId: string;
    id: string;
    beforeId?: string | null;
  }): StructuredSurfaceQueuedMessageRecord[] {
    const rows = this.queryQueuedSurfaceMessageRows(input.surfacePiSessionId);
    if (!rows.some((row) => row.id === input.id) || input.id === input.beforeId) {
      return rows.map((row) => this.mapSurfaceQueuedMessage(row));
    }

    const moving = rows.find((row) => row.id === input.id)!;
    const remaining = rows.filter((row) => row.id !== input.id);
    const beforeIndex = input.beforeId
      ? remaining.findIndex((row) => row.id === input.beforeId)
      : remaining.length;
    if (beforeIndex < 0) {
      return rows.map((row) => this.mapSurfaceQueuedMessage(row));
    }

    const reordered = [...remaining.slice(0, beforeIndex), moving, ...remaining.slice(beforeIndex)];
    if (reordered.every((row, index) => row.id === rows[index]?.id)) {
      return rows.map((row) => this.mapSurfaceQueuedMessage(row));
    }

    const timestamp = this.now();
    const updatePositions = this.db.transaction((nextRows: SurfaceQueuedMessageRow[]) => {
      nextRows.forEach((row, index) => {
        if (row.position === index + 1) {
          return;
        }
        this.db
          .query(
            `UPDATE surface_message_queue
             SET position = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(index + 1, timestamp, row.id);
      });
    });
    updatePositions(reordered);
    this.recordSurfaceMessageEvent(moving, "surfaceMessage.reordered", timestamp);
    return this.queryQueuedSurfaceMessageRows(input.surfacePiSessionId).map((row) =>
      this.mapSurfaceQueuedMessage(row),
    );
  }

  recordGeneratedPackageBuild(
    input: RecordGeneratedPackageBuildInput,
  ): StructuredGeneratedPackageFactRecord {
    return this.db.transaction(() => {
      const existing = this.findGeneratedPackageFactRow(input.status.packageName);
      const timestamp = this.now();
      const generatedFileListDigest =
        digestGeneratedPackageFileList(this.digest, input.status.generatedFiles) ??
        existing?.generated_file_list_digest ??
        null;
      this.upsertGeneratedPackageFact({
        packageName: input.status.packageName,
        status: "ready",
        buildId: input.status.buildId ?? existing?.build_id ?? null,
        manifestPath: input.status.manifestPath ?? existing?.manifest_path ?? null,
        sourceFingerprint: input.status.sourceFingerprint ?? existing?.source_fingerprint ?? null,
        outputFingerprint: input.status.outputFingerprint ?? existing?.output_fingerprint ?? null,
        generatedFileListDigest,
        dependencies:
          input.status.dependencies ?? this.dependenciesFromGeneratedPackageFact(existing),
        diagnostics: input.status.diagnostics ?? [],
        sourceCommandId: input.sourceCommandId ?? null,
        refreshNeededReason: null,
        lastRecoveryWorkId: input.recoveryWorkId ?? null,
        createdAt: existing?.created_at ?? timestamp,
        updatedAt: timestamp,
      });
      if ("workflowsExports" in input) {
        this.replaceGeneratedWorkflowsExports(
          input.status.buildId,
          input.workflowsExports,
          timestamp,
        );
      }
      return this.mustFindGeneratedPackageFact(input.status.packageName);
    })();
  }

  recordGeneratedPackageFailure(
    input: RecordGeneratedPackageFailureInput,
  ): StructuredGeneratedPackageFactRecord {
    const existing = this.findGeneratedPackageFactRow(input.status.packageName);
    const timestamp = this.now();
    const generatedFileListDigest =
      existing?.generated_file_list_digest ??
      digestGeneratedPackageFileList(this.digest, input.status.generatedFiles) ??
      null;
    this.upsertGeneratedPackageFact({
      packageName: input.status.packageName,
      status: "failed",
      buildId: existing?.build_id ?? input.status.buildId ?? null,
      manifestPath: existing?.manifest_path ?? input.status.manifestPath ?? null,
      sourceFingerprint: existing?.source_fingerprint ?? input.status.sourceFingerprint ?? null,
      outputFingerprint: existing?.output_fingerprint ?? input.status.outputFingerprint ?? null,
      generatedFileListDigest,
      dependencies: this.dependenciesFromGeneratedPackageFact(existing),
      diagnostics: input.status.diagnostics ?? [],
      sourceCommandId: input.sourceCommandId ?? null,
      refreshNeededReason: null,
      lastRecoveryWorkId: input.recoveryWorkId ?? null,
      createdAt: existing?.created_at ?? timestamp,
      updatedAt: timestamp,
    });
    return this.mustFindGeneratedPackageFact(input.status.packageName);
  }

  recordWorkspaceLinkStatus(
    input: RecordGeneratedPackageWorkspaceLinkInput,
  ): StructuredGeneratedPackageWorkspaceLinkRecord {
    const existing = this.findGeneratedPackageWorkspaceLinkRow(
      input.status.workspaceId,
      input.status.packageName,
    );
    const timestamp = this.now();
    this.db
      .query(
        `INSERT INTO generated_package_workspace_link (
           workspace_id,
           package_name,
           status,
           link_path,
           target_path,
           diagnostics_json,
           source_command_id,
           last_recovery_work_id,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, package_name) DO UPDATE SET
           status = excluded.status,
           link_path = excluded.link_path,
           target_path = excluded.target_path,
           diagnostics_json = excluded.diagnostics_json,
           source_command_id = excluded.source_command_id,
           last_recovery_work_id = excluded.last_recovery_work_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.status.workspaceId,
        input.status.packageName,
        input.status.status,
        input.status.linkPath ?? existing?.link_path ?? null,
        input.status.targetPath ?? existing?.target_path ?? null,
        toJson(input.status.diagnostics ?? []),
        input.sourceCommandId ?? null,
        input.recoveryWorkId ?? null,
        existing?.created_at ?? timestamp,
        timestamp,
      );
    return this.mustFindGeneratedPackageWorkspaceLink(
      input.status.workspaceId,
      input.status.packageName,
    );
  }

  markWorkspaceLinksRepairNeeded(
    input: MarkWorkspaceGeneratedPackageLinksRepairNeededInput,
  ): MarkWorkspaceGeneratedPackageLinksRepairNeededResult {
    if (input.workspaceId !== this.workspace.id) {
      throw new Error(
        `Workspace generated-package link repair target ${input.workspaceId} is not managed by this state store.`,
      );
    }

    const packages = orderedUniqueGeneratedPackages(input.packages);
    if (packages.length === 0) {
      return { links: [], recoveryWorkIds: [] };
    }

    const result = this.db.transaction(() => {
      const recoveryWork = this.ensureWorkspaceGeneratedPackageLinkRepairWork({
        packages,
        requestedAt: input.requestedAt,
        maxAttempts: input.maxAttempts,
        sourceCommandId: input.sourceCommandId ?? null,
        reason: input.reason,
      });
      const timestamp = this.now();
      const links = packages.map((packageName) => {
        const existing = this.findGeneratedPackageWorkspaceLinkRow(this.workspace.id, packageName);
        this.db
          .query(
            `INSERT INTO generated_package_workspace_link (
               workspace_id,
               package_name,
               status,
               link_path,
               target_path,
               diagnostics_json,
               source_command_id,
               last_recovery_work_id,
               created_at,
               updated_at
             ) VALUES (?, ?, 'repair-needed', ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(workspace_id, package_name) DO UPDATE SET
               status = excluded.status,
               link_path = excluded.link_path,
               target_path = excluded.target_path,
               diagnostics_json = excluded.diagnostics_json,
               source_command_id = excluded.source_command_id,
               last_recovery_work_id = excluded.last_recovery_work_id,
               updated_at = excluded.updated_at`,
          )
          .run(
            this.workspace.id,
            packageName,
            existing?.link_path ?? null,
            existing?.target_path ?? null,
            toJson([]),
            input.sourceCommandId ?? null,
            recoveryWork.id,
            existing?.created_at ?? timestamp,
            timestamp,
          );
        return this.mustFindGeneratedPackageWorkspaceLink(this.workspace.id, packageName);
      });

      return {
        links,
        recoveryWorkIds: [
          recoveryWork.id as MarkWorkspaceGeneratedPackageLinksRepairNeededResult["recoveryWorkIds"][number],
        ],
      };
    })();

    return result;
  }

  readLinksNeedingRepair(
    input: ReadGeneratedPackageLinksNeedingRepairInput = {},
  ): StructuredGeneratedPackageWorkspaceLinkRecord[] {
    return this.queryGeneratedPackageWorkspaceLinkRows()
      .filter((row) => row.status !== "linked" && row.status !== "unchanged")
      .filter((row) => !input.workspaceId || row.workspace_id === input.workspaceId)
      .filter((row) => !input.packages || input.packages.includes(row.package_name))
      .map((row) => this.mapGeneratedPackageWorkspaceLink(row));
  }

  readGeneratedPackageFacts(
    input: ReadGeneratedPackageFactsInput = {},
  ): StructuredGeneratedPackageFactRecord[] {
    return this.queryGeneratedPackageFactRows()
      .filter((row) => !input.packages || input.packages.includes(row.package_name))
      .map((row) => this.mapGeneratedPackageFact(row));
  }

  readGeneratedWorkflowsExports(
    input: ReadGeneratedWorkflowsExportsInput = {},
  ): StructuredGeneratedWorkflowsExportRecord[] {
    return this.queryGeneratedWorkflowsExportRows()
      .filter((row) => !input.buildId || row.build_id === input.buildId)
      .map((row) => this.mapGeneratedWorkflowsExport(row));
  }

  reconcileGeneratedPackageManifest(
    input: ReconcileGeneratedPackageManifestInput,
  ): StructuredGeneratedPackageFactRecord {
    const existing = this.findGeneratedPackageFactRow(input.fact.packageName);
    const timestamp = this.now();
    this.upsertGeneratedPackageFact({
      packageName: input.fact.packageName,
      status: "ready",
      buildId: input.fact.buildId,
      manifestPath: input.fact.manifestPath,
      sourceFingerprint: input.fact.sourceFingerprint,
      outputFingerprint: input.fact.outputFingerprint,
      generatedFileListDigest: input.fact.generatedFileListDigest,
      dependencies: input.fact.dependencies,
      diagnostics: input.diagnostics ?? [],
      sourceCommandId: input.sourceCommandId ?? null,
      refreshNeededReason: null,
      lastRecoveryWorkId: input.recoveryWorkId ?? null,
      createdAt: existing?.created_at ?? timestamp,
      updatedAt: timestamp,
    });
    return this.mustFindGeneratedPackageFact(input.fact.packageName);
  }

  markGeneratedPackageRefreshNeeded(
    input: MarkGeneratedPackageRefreshNeededInput,
  ): StructuredGeneratedPackageFactRecord {
    const existing = this.findGeneratedPackageFactRow(input.packageName);
    const timestamp = this.now();
    this.upsertGeneratedPackageFact({
      packageName: input.packageName,
      status: "refresh-needed",
      buildId: existing?.build_id ?? null,
      manifestPath: existing?.manifest_path ?? null,
      sourceFingerprint: existing?.source_fingerprint ?? null,
      outputFingerprint: existing?.output_fingerprint ?? null,
      generatedFileListDigest: existing?.generated_file_list_digest ?? null,
      dependencies: this.dependenciesFromGeneratedPackageFact(existing),
      diagnostics: this.diagnosticsFromGeneratedPackageFact(existing),
      sourceCommandId: input.sourceCommandId ?? null,
      refreshNeededReason: input.reason,
      lastRecoveryWorkId: input.recoveryWorkId ?? null,
      createdAt: existing?.created_at ?? timestamp,
      updatedAt: timestamp,
    });
    return this.mustFindGeneratedPackageFact(input.packageName);
  }

  listProviderAuthStatuses(input: ListProviderStatusesInput): ProviderAuthStatus[] {
    const workspaceKey = providerAuthWorkspaceKey(input.workspaceId);
    if (workspaceKey !== GLOBAL_PROVIDER_AUTH_WORKSPACE_KEY) {
      const rows = this.db
        .query(
          `SELECT * FROM provider_auth_status
           WHERE workspace_key IN (?, ?)
           ORDER BY workspace_key ASC, provider_id ASC`,
        )
        .all(GLOBAL_PROVIDER_AUTH_WORKSPACE_KEY, workspaceKey) as ProviderAuthStatusRow[];
      const statusesByProvider = new Map<string, ProviderAuthStatus>();
      for (const row of rows) {
        statusesByProvider.set(row.provider_id, this.mapProviderAuthStatus(row));
      }
      return [...statusesByProvider.values()].toSorted((left, right) =>
        String(left.providerId).localeCompare(String(right.providerId)),
      );
    }
    const rows = this.db
      .query(
        `SELECT * FROM provider_auth_status
         WHERE workspace_key = ?
         ORDER BY provider_id ASC`,
      )
      .all(workspaceKey) as ProviderAuthStatusRow[];
    return rows.map((row) => this.mapProviderAuthStatus(row));
  }

  recordProviderAuthStatus(input: RecordProviderAuthStatusInput): ProviderAuthStatusWriteResult {
    const workspaceKey = providerAuthWorkspaceKey(input.status.workspaceId);
    return this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO provider_auth_status (
             provider_id,
             workspace_key,
             workspace_id,
             health,
             redacted_account_label,
             refreshed_at,
             expires_at,
             issue,
             observed_at,
             source,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(provider_id, workspace_key) DO UPDATE SET
             workspace_id = excluded.workspace_id,
             health = excluded.health,
             redacted_account_label = excluded.redacted_account_label,
             refreshed_at = excluded.refreshed_at,
             expires_at = excluded.expires_at,
             issue = excluded.issue,
             observed_at = excluded.observed_at,
             source = excluded.source,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.status.providerId,
          workspaceKey,
          input.status.workspaceId ?? null,
          input.status.health,
          input.status.redactedAccountLabel ?? null,
          input.status.refreshedAt ?? null,
          input.status.expiresAt ?? null,
          input.status.issue ?? null,
          input.observedAt,
          input.source,
          input.observedAt,
          input.observedAt,
        );
      const stateRevision = this.bumpStateRevision();
      return {
        status: this.mustFindProviderAuthStatus(input.status.providerId, workspaceKey),
        stateRevision,
      };
    })();
  }

  readExtensionDependencyReadiness(input: {
    extensionId: ExtensionId;
    requirementId: string;
  }): StructuredExtensionDependencyReadinessRecord | null {
    const row = this.findExtensionDependencyReadinessRow(input.extensionId, input.requirementId);
    return row ? this.mapExtensionDependencyReadiness(row) : null;
  }

  listExtensionDependencyReadiness(): StructuredExtensionDependencyReadinessRecord[] {
    return (
      this.db
        .query(
          `SELECT * FROM extension_dependency_readiness
           ORDER BY extension_id, requirement_id`,
        )
        .all() as ExtensionDependencyReadinessRow[]
    ).map((row) => this.mapExtensionDependencyReadiness(row));
  }

  readExtensionDependencyReadinessBatch(): StructuredExtensionDependencyReadinessBatchRecord | null {
    const row = this.db
      .query(
        `SELECT registry_aggregate_fingerprint, readiness_json, recorded_at, source_command_id
         FROM extension_dependency_readiness_batch
         WHERE singleton_id = 1`,
      )
      .get() as ExtensionDependencyReadinessBatchRow | null;
    if (!row) return null;
    return {
      registryAggregateFingerprint: row.registry_aggregate_fingerprint,
      readiness: this.listExtensionDependencyReadiness(),
      recordedAt: row.recorded_at,
      sourceCommandId: row.source_command_id as CommandId | null,
    };
  }

  readExtensionDependencyApproval(input: {
    dependency: ExtensionDependencyApprovalIdentity;
  }): boolean {
    return this.findExtensionDependencyApprovalRow(input.dependency) !== null;
  }

  recordExtensionDependencyApproval(input: {
    dependency: ExtensionDependencyApprovalIdentity;
    approvedAt: string;
    approvedBy: "user";
    sourceCommandId?: CommandId | null;
  }): StructuredExtensionDependencyApprovalRecord {
    const approvalKey = extensionDependencyApprovalIdentityKey(input.dependency);
    const existing = this.findExtensionDependencyApprovalRow(input.dependency);
    this.db
      .query(
        `INSERT INTO extension_dependency_approval (
           approval_key,
           identity_json,
           approved_at,
           approved_by,
           source_command_id,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(approval_key) DO UPDATE SET
           identity_json = excluded.identity_json,
           approved_at = excluded.approved_at,
           approved_by = excluded.approved_by,
           source_command_id = excluded.source_command_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        approvalKey,
        toJson(input.dependency),
        input.approvedAt,
        input.approvedBy,
        input.sourceCommandId ?? null,
        existing?.created_at ?? input.approvedAt,
        input.approvedAt,
      );
    return this.mustFindExtensionDependencyApproval(input.dependency);
  }

  recordExtensionDependencyReadiness(
    input: RecordExtensionDependencyReadinessInput,
  ): StructuredExtensionDependencyReadinessRecord {
    this.db.query(`DELETE FROM extension_dependency_readiness_batch`).run();
    const existing = this.findExtensionDependencyReadinessRow(
      input.readiness.extensionId,
      input.readiness.requirementId,
    );
    this.db
      .query(
        `INSERT INTO extension_dependency_readiness (
           extension_id,
           requirement_id,
           requirement_fingerprint,
           status,
           detected_version,
           expected_version,
           diagnostics_json,
           checked_at,
           source_command_id,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(extension_id, requirement_id) DO UPDATE SET
           requirement_fingerprint = excluded.requirement_fingerprint,
           status = excluded.status,
           detected_version = excluded.detected_version,
           expected_version = excluded.expected_version,
           diagnostics_json = excluded.diagnostics_json,
           checked_at = excluded.checked_at,
           source_command_id = excluded.source_command_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.readiness.extensionId,
        input.readiness.requirementId,
        input.readiness.requirementFingerprint,
        input.readiness.status,
        input.readiness.detectedVersion,
        input.readiness.expectedVersion,
        toJson(input.readiness.diagnostics),
        input.readiness.checkedAt,
        input.sourceCommandId ?? null,
        existing?.created_at ?? input.recordedAt,
        input.recordedAt,
      );
    return this.mustFindExtensionDependencyReadiness(
      input.readiness.extensionId,
      input.readiness.requirementId,
    );
  }

  reconcileExtensionDependencyReadiness(
    input: ReconcileExtensionDependencyReadinessInput,
  ): StructuredExtensionDependencyReadinessReconcileResult {
    return this.db.transaction(() => {
      const registry = this.readExtensionRegistryObservation();
      if (
        !registry ||
        registry.observation.aggregateFingerprint !== input.registryAggregateFingerprint
      ) {
        throw new StateContractError({
          operation: "structured-session.reconcileExtensionDependencyReadiness",
          reason: "conflict",
          message:
            "Extension dependency readiness was observed against a stale registry fingerprint.",
        });
      }

      const expected = new Map<string, string>();
      for (const extension of registry.observation.observations) {
        for (const declaration of extension.cliDeclarations) {
          const key = `${extension.extensionId}\0${declaration.id}`;
          if (expected.has(key)) {
            throw new StateContractError({
              operation: "structured-session.reconcileExtensionDependencyReadiness",
              reason: "invalid-input",
              message: `Registry contains duplicate CLI requirement ${extension.extensionId}/${declaration.id}.`,
            });
          }
          expected.set(key, declaration.requirementFingerprint);
        }
      }

      const seen = new Set<string>();
      for (const readiness of input.readiness) {
        const key = `${readiness.extensionId}\0${readiness.requirementId}`;
        if (seen.has(key) || expected.get(key) !== readiness.requirementFingerprint) {
          throw new StateContractError({
            operation: "structured-session.reconcileExtensionDependencyReadiness",
            reason: "invalid-input",
            message: `CLI readiness does not match registry requirement ${readiness.extensionId}/${readiness.requirementId}.`,
          });
        }
        seen.add(key);
      }
      if (seen.size !== expected.size || [...expected.keys()].some((key) => !seen.has(key))) {
        throw new StateContractError({
          operation: "structured-session.reconcileExtensionDependencyReadiness",
          reason: "invalid-input",
          message: "CLI readiness must be a complete batch for the current extension registry.",
        });
      }

      const readiness = [...input.readiness].toSorted(
        (left, right) =>
          left.extensionId.localeCompare(right.extensionId) ||
          left.requirementId.localeCompare(right.requirementId),
      );
      const readinessJson = JSON.stringify(readiness);
      const current = this.db
        .query(
          `SELECT registry_aggregate_fingerprint, readiness_json, recorded_at, source_command_id
           FROM extension_dependency_readiness_batch
           WHERE singleton_id = 1`,
        )
        .get() as ExtensionDependencyReadinessBatchRow | null;
      if (
        current?.registry_aggregate_fingerprint === input.registryAggregateFingerprint &&
        current.readiness_json === readinessJson
      ) {
        return {
          changed: false,
          readiness,
          stateRevision: this.readCurrentStateRevision(),
        };
      }

      this.db.query(`DELETE FROM extension_dependency_readiness`).run();
      const insert = this.db.query(
        `INSERT INTO extension_dependency_readiness (
           extension_id, requirement_id, requirement_fingerprint, status,
           detected_version, expected_version, diagnostics_json, checked_at,
           source_command_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const fact of readiness) {
        insert.run(
          fact.extensionId,
          fact.requirementId,
          fact.requirementFingerprint,
          fact.status,
          fact.detectedVersion,
          fact.expectedVersion,
          toJson(fact.diagnostics),
          fact.checkedAt,
          input.sourceCommandId ?? null,
          input.recordedAt,
          input.recordedAt,
        );
      }
      this.db
        .query(
          `INSERT INTO extension_dependency_readiness_batch (
             singleton_id, registry_aggregate_fingerprint, readiness_json,
             recorded_at, source_command_id
           ) VALUES (1, ?, ?, ?, ?)
           ON CONFLICT(singleton_id) DO UPDATE SET
             registry_aggregate_fingerprint = excluded.registry_aggregate_fingerprint,
             readiness_json = excluded.readiness_json,
             recorded_at = excluded.recorded_at,
             source_command_id = excluded.source_command_id`,
        )
        .run(
          input.registryAggregateFingerprint,
          readinessJson,
          input.recordedAt,
          input.sourceCommandId ?? null,
        );
      return {
        changed: true,
        readiness,
        stateRevision: this.bumpStateRevision(),
      };
    })();
  }

  ensureRecoveryWork(input: {
    scope: StructuredRecoveryWorkScope;
    kind: StructuredRecoveryWorkKind;
    ownerScope: StructuredRecoveryWorkOwnerScope;
    idempotencyKey: string;
    orderingKey: string;
    orderingSeq: number;
    priority: number;
    availableAt: string;
    maxAttempts: number;
    payloadJson?: JsonValue;
  }): StructuredRecoveryWorkRecord {
    assertRecoveryWorkScopeMatchesKind(input);
    const scope = recoveryWorkScopeSql(input.scope);
    const existing = this.db
      .query(
        `SELECT * FROM recovery_work
         WHERE scope_kind = ? AND workspace_id IS ? AND idempotency_key = ?
           AND status NOT IN ('claimed', 'completed', 'failed', 'cancelled')
         LIMIT 1`,
      )
      .get(scope.scopeKind, scope.workspaceId, input.idempotencyKey) as RecoveryWorkRow | undefined;
    if (existing) {
      return this.mapRecoveryWork(existing);
    }

    const timestamp = this.now();
    const id = this.createId("recovery-work");
    this.db
      .query(
        `INSERT INTO recovery_work (
           id,
           scope_kind,
           workspace_id,
           kind,
           status,
           owner_scope_json,
           idempotency_key,
           ordering_key,
           ordering_seq,
           priority,
           available_at,
           attempts,
           max_attempts,
           claimed_by,
           claimed_at,
           claim_expires_at,
           lease_version,
           payload_json,
           last_error,
           created_at,
           updated_at,
           completed_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, 0, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        scope.scopeKind,
        scope.workspaceId,
        input.kind,
        JSON.stringify(input.ownerScope),
        input.idempotencyKey,
        input.orderingKey,
        input.orderingSeq,
        input.priority,
        input.availableAt,
        input.maxAttempts,
        toJson(input.payloadJson ?? null),
        timestamp,
        timestamp,
      );
    return this.mustFindRecoveryWorkRecord(id);
  }

  private ensureWorkspaceGeneratedPackageLinkRepairWork(input: {
    packages: readonly GeneratedPackageName[];
    requestedAt: string;
    maxAttempts: number;
    sourceCommandId: string | null;
    reason: MarkWorkspaceGeneratedPackageLinksRepairNeededInput["reason"];
  }): StructuredRecoveryWorkRecord {
    const scope = recoveryWorkScopeSql({
      kind: "workspace",
      workspaceId: this.workspace.id,
    });
    const idempotencyKey = `workspace_generated_package_link_repair:${this.workspace.id}:${input.packages.join(",")}`;
    const existing = this.db
      .query(
        `SELECT * FROM recovery_work
         WHERE scope_kind = ? AND workspace_id IS ? AND idempotency_key = ?
           AND status NOT IN ('claimed', 'completed', 'failed', 'cancelled')
         LIMIT 1`,
      )
      .get(scope.scopeKind, scope.workspaceId, idempotencyKey) as RecoveryWorkRow | undefined;
    if (existing) {
      return this.mapRecoveryWork(existing);
    }

    const timestamp = this.now();
    const id = this.createId("recovery-work");
    const payloadJson: JsonValue = {
      refreshGeneratedPackages: {
        scope: "workspace-link-repair",
        workspaceId: this.workspace.id,
        packages: [...input.packages],
        reason: "link-repair",
        sourceCommandId: input.sourceCommandId,
        scheduledReason: input.reason,
      },
    };
    this.db
      .query(
        `INSERT INTO recovery_work (
           id,
           scope_kind,
           workspace_id,
           kind,
           status,
           owner_scope_json,
           idempotency_key,
           ordering_key,
           ordering_seq,
           priority,
           available_at,
           attempts,
           max_attempts,
           claimed_by,
           claimed_at,
           claim_expires_at,
           lease_version,
           payload_json,
           last_error,
           created_at,
           updated_at,
           completed_at
         ) VALUES (?, ?, ?, 'workspace_generated_package_link_repair', 'pending', ?, ?, ?, 0, 5, ?, 0, ?, NULL, NULL, NULL, 0, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        scope.scopeKind,
        scope.workspaceId,
        JSON.stringify({ kind: "workspace" }),
        idempotencyKey,
        `workspace:${this.workspace.id}`,
        input.requestedAt,
        input.maxAttempts,
        toJson(payloadJson),
        timestamp,
        timestamp,
      );
    return this.mustFindRecoveryWorkRecord(id);
  }

  listRecoveryWork(
    input: { scope?: StructuredRecoveryWorkScope } = {},
  ): StructuredRecoveryWorkRecord[] {
    const scope = input.scope ? recoveryWorkScopeSql(input.scope) : null;
    const query = scope
      ? this.db.query(
          `SELECT * FROM recovery_work
           WHERE scope_kind = ? AND workspace_id IS ?
           ORDER BY priority ASC, available_at ASC, ordering_key ASC, ordering_seq ASC, created_at ASC`,
        )
      : this.db.query(
          `SELECT * FROM recovery_work
           ORDER BY priority ASC, available_at ASC, ordering_key ASC, ordering_seq ASC, created_at ASC`,
        );
    const rows = scope
      ? (query.all(scope.scopeKind, scope.workspaceId) as RecoveryWorkRow[])
      : (query.all() as RecoveryWorkRow[]);
    return rows.map((row) => this.mapRecoveryWork(row));
  }

  normalizeWorkspaceRecoveryState(_input: { claimedBy: string }): string[] {
    const timestamp = this.now();
    const normalizeRecoveryState = this.db.transaction(() => {
      const resetQueueSurfaces = (
        this.db
          .query(
            `SELECT DISTINCT surface_pi_session_id FROM surface_message_queue
             WHERE status IN ('steering', 'dispatching')`,
          )
          .all() as Array<{ surface_pi_session_id: string }>
      ).map((row) => row.surface_pi_session_id);
      this.db
        .query(
          `UPDATE recovery_work
           SET status = 'pending',
               claimed_by = NULL,
               claimed_at = NULL,
               claim_expires_at = NULL,
               updated_at = ?
           WHERE workspace_id = ?
             AND scope_kind = 'workspace'
             AND status = 'claimed'
             AND (claim_expires_at IS NULL OR claim_expires_at <= ?)`,
        )
        .run(timestamp, this.workspace.id, timestamp);
      this.db
        .query(
          `UPDATE surface_message_queue
           SET status = 'queued',
               updated_at = ?,
               claim_owner_id = NULL,
               claim_lease_expires_at = NULL,
               delivered_at = NULL,
               cancelled_at = NULL
           WHERE status IN ('steering', 'dispatching')`,
        )
        .run(timestamp);
      return resetQueueSurfaces;
    });
    return normalizeRecoveryState();
  }

  claimNextRecoveryWork(input: {
    claimedBy: string;
    scope?: StructuredRecoveryWorkScope;
    kinds?: readonly StructuredRecoveryWorkKind[];
    leaseMs?: number;
  }): StructuredRecoveryWorkRecord | null {
    const timestamp = this.now();
    const leaseUntil = new Date(
      Date.parse(timestamp) + (input.leaseMs ?? 5 * 60_000),
    ).toISOString();
    const claim = this.db.transaction(() => {
      const scope = input.scope ? recoveryWorkScopeSql(input.scope) : null;
      const kinds = input.kinds ?? [];
      const kindPlaceholders = kinds.map(() => "?").join(", ");
      const scopeFilter = scope ? "scope_kind = ? AND workspace_id IS ? AND " : "";
      this.db
        .query(
          `UPDATE recovery_work
           SET status = 'failed',
               claimed_by = NULL,
               claimed_at = NULL,
               claim_expires_at = NULL,
               last_error = COALESCE(last_error, 'Recovery claim expired after its final attempt.'),
               updated_at = ?,
               completed_at = ?
           WHERE ${scopeFilter}status = 'claimed'
             AND attempts >= max_attempts
             AND (claim_expires_at IS NULL OR claim_expires_at <= ?)`,
        )
        .run(
          timestamp,
          timestamp,
          ...(scope ? [scope.scopeKind, scope.workspaceId] : []),
          timestamp,
        );
      this.db
        .query(
          `UPDATE recovery_work
           SET status = 'failed',
               claimed_by = NULL,
               claimed_at = NULL,
               claim_expires_at = NULL,
               last_error = COALESCE(last_error, 'Recovery work exhausted its final attempt.'),
               updated_at = ?,
               completed_at = ?
           WHERE ${scopeFilter}status = 'pending'
             AND attempts >= max_attempts`,
        )
        .run(timestamp, timestamp, ...(scope ? [scope.scopeKind, scope.workspaceId] : []));
      this.db
        .query(
          `UPDATE recovery_work
           SET status = 'pending',
               claimed_by = NULL,
               claimed_at = NULL,
               claim_expires_at = NULL,
               updated_at = ?
           WHERE ${scopeFilter}status = 'claimed'
             AND attempts < max_attempts
             AND (claim_expires_at IS NULL OR claim_expires_at <= ?)`,
        )
        .run(timestamp, ...(scope ? [scope.scopeKind, scope.workspaceId] : []), timestamp);
      const candidateScopeFilter = scope
        ? "candidate.scope_kind = ? AND candidate.workspace_id IS ? AND "
        : "";
      const candidateKindFilter =
        kinds.length > 0 ? ` AND candidate.kind IN (${kindPlaceholders})` : "";
      const candidates = this.db
        .query(
          `SELECT candidate.* FROM recovery_work AS candidate
           WHERE ${candidateScopeFilter}candidate.status = 'pending'
             AND candidate.available_at <= ?${candidateKindFilter}
             AND NOT EXISTS (
               SELECT 1 FROM recovery_work AS earlier
               WHERE earlier.scope_kind = candidate.scope_kind
                 AND earlier.workspace_id IS candidate.workspace_id
                 AND earlier.ordering_key = candidate.ordering_key
                 AND earlier.status NOT IN ('completed', 'failed', 'cancelled')
                 AND (
                   earlier.ordering_seq < candidate.ordering_seq
                   OR (
                     earlier.ordering_seq = candidate.ordering_seq
                     AND (
                       earlier.created_at < candidate.created_at
                       OR (earlier.created_at = candidate.created_at AND earlier.id < candidate.id)
                     )
                   )
                 )
             )
           ORDER BY candidate.priority ASC,
                    candidate.available_at ASC,
                    candidate.ordering_key ASC,
                    candidate.ordering_seq ASC,
                    candidate.created_at ASC
           LIMIT 50`,
        )
        .all(
          ...(scope ? [scope.scopeKind, scope.workspaceId] : []),
          timestamp,
          ...kinds,
        ) as RecoveryWorkRow[];
      const active = this.db
        .query(
          `SELECT * FROM recovery_work
           WHERE status = 'claimed'`,
        )
        .all() as RecoveryWorkRow[];
      const row = candidates.find((candidate) =>
        isRecoveryOwnerAvailable(
          this.mapRecoveryWork(candidate),
          active
            .filter(
              (entry) =>
                entry.scope_kind === candidate.scope_kind &&
                entry.workspace_id === candidate.workspace_id,
            )
            .map((entry) => this.mapRecoveryWork(entry)),
        ),
      );
      if (!row) {
        return null;
      }
      const result = this.db
        .query(
          `UPDATE recovery_work
           SET status = 'claimed',
               attempts = attempts + 1,
               claimed_by = ?,
               claimed_at = ?,
               claim_expires_at = ?,
               lease_version = lease_version + 1,
               updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(input.claimedBy, timestamp, leaseUntil, timestamp, row.id);
      if (result.changes !== 1) {
        return null;
      }
      return this.mustFindRecoveryWorkRecord(row.id);
    });
    return claim();
  }

  completeRecoveryWork(input: {
    id: string;
    claimedBy?: string | null;
    leaseVersion?: number | null;
  }): StructuredRecoveryWorkRecord {
    return this.updateRecoveryWorkTerminal({
      id: input.id,
      status: "completed",
      error: null,
      ...(input.claimedBy === undefined ? {} : { claimedBy: input.claimedBy }),
      ...(input.leaseVersion === undefined ? {} : { leaseVersion: input.leaseVersion }),
    });
  }

  blockRecoveryWork(input: { id: string; error?: string | null }): StructuredRecoveryWorkRecord {
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE recovery_work
         SET status = 'blocked',
             claimed_by = NULL,
             claimed_at = NULL,
             claim_expires_at = NULL,
             last_error = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(input.error ?? null, timestamp, input.id);
    return this.mustFindRecoveryWorkRecord(input.id);
  }

  failOrRetryRecoveryWork(input: {
    id: string;
    error: string;
    claimedBy?: string | null;
    leaseVersion?: number | null;
    retryAvailableAt?: string;
  }): StructuredRecoveryWorkRecord {
    const row = this.mustFindRecoveryWorkRow(input.id);
    const timestamp = this.now();
    const status: StructuredRecoveryWorkStatus =
      row.attempts >= row.max_attempts ? "failed" : "pending";
    const availableAt =
      status === "pending"
        ? (input.retryAvailableAt ??
          new Date(Date.parse(timestamp) + Math.min(row.attempts + 1, 5) * 1000).toISOString())
        : timestamp;
    const result = this.db
      .query(
        `UPDATE recovery_work
         SET status = ?,
             available_at = ?,
             claimed_by = NULL,
             claimed_at = NULL,
             claim_expires_at = NULL,
             last_error = ?,
             updated_at = ?,
             completed_at = ?
         WHERE id = ?
           AND (? IS NULL OR claimed_by = ?)
           AND (? IS NULL OR lease_version = ?)`,
      )
      .run(
        status,
        availableAt,
        input.error,
        timestamp,
        status === "failed" ? timestamp : null,
        input.id,
        input.claimedBy ?? null,
        input.claimedBy ?? null,
        input.leaseVersion ?? null,
        input.leaseVersion ?? null,
      );
    if (result.changes !== 1) {
      throw new Error(`Recovery work claim is stale: ${input.id}`);
    }
    return this.mustFindRecoveryWorkRecord(input.id);
  }

  getSessionState(sessionId: string): StructuredSessionSnapshot {
    const session = this.mustFindSessionRow(sessionId);
    const workflowRuns = this.queryWorkflowRunRecords(sessionId);
    return {
      workspace: { ...this.workspace },
      pi: this.mapPiSession(session),
      session: {
        id: session.session_id,
        orchestratorPiSessionId: session.orchestrator_pi_session_id,
        pinnedAt: session.pinned_at,
        archivedAt: session.archived_at,
        unreadAt: session.unread_at,
        unreadReason: session.unread_reason,
        lastReadAt: session.last_read_at,
        wait: this.mapSessionWait(session),
      },
      turns: this.queryTurnRecords(sessionId),
      threads: this.queryThreadRecords(sessionId),
      commands: this.queryCommandRecords(sessionId),
      episodes: this.queryEpisodeRecords(sessionId),
      workflowRuns,
      workflowTaskAttempts: this.queryWorkflowTaskAttemptRecords(sessionId),
      workflowTaskMessages: this.queryWorkflowTaskMessageRecords(sessionId),
      generatedAgentContextBindings: this.queryGeneratedAgentContextBindingRecords(sessionId),
      requestUserInputRequests: this.queryRequestUserInputRequestRecords(sessionId),
      runtimeApprovalRequests: this.queryRuntimeApprovalRequestRecords(sessionId),
      artifacts: this.queryArtifactRecords(sessionId),
      queuedMessages: this.querySurfaceQueuedMessageRecords(sessionId),
      events: this.queryEventRecords(sessionId),
    };
  }

  listSessionStates(): StructuredSessionSnapshot[] {
    const rows = this.db
      .query(`SELECT session_id FROM session ORDER BY updated_at DESC, rowid ASC`)
      .all() as Array<{ session_id: string }>;
    return rows.map((row) => this.getSessionState(row.session_id));
  }

  deleteSessionState(sessionId: string): void {
    const deleteRows = this.db.transaction((targetSessionId: string) => {
      const timestamp = this.now();
      this.db
        .query(
          `DELETE FROM request_user_input_answer
           WHERE request_id IN (
             SELECT id FROM request_user_input_request WHERE session_id = ?
           )`,
        )
        .run(targetSessionId);
      this.db
        .query(
          `DELETE FROM request_user_input_question
           WHERE request_id IN (
             SELECT id FROM request_user_input_request WHERE session_id = ?
           )`,
        )
        .run(targetSessionId);
      this.db
        .query(`DELETE FROM pi_session_reference WHERE workspace_session_id = ?`)
        .run(targetSessionId);
      for (const table of [
        "surface_composer_draft",
        "surface_message_queue",
        "event",
        "artifact",
        "runtime_approval_request",
        "workflow_task_message",
        "request_user_input_request",
        "workflow_task_attempt",
        "workflow_run",
        "episode",
        "command",
        "thread",
        "turn",
        "session",
      ]) {
        this.db.query(`DELETE FROM ${table} WHERE session_id = ?`).run(targetSessionId);
      }
      this.db
        .query(
          `INSERT OR REPLACE INTO deleted_session (session_id, deleted_at)
           VALUES (?, ?)`,
        )
        .run(targetSessionId, timestamp);
    });
    deleteRows(sessionId);
  }

  getThreadDetail(threadId: string): StructuredThreadDetail {
    const thread = this.mustFindThreadRecord(threadId);
    const workflowRuns = this.queryWorkflowRunRecordsForThread(threadId);
    const workflowTaskAttempts = this.queryWorkflowTaskAttemptRecordsForThread(threadId);
    const latestWorkflowRun =
      workflowRuns.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
      null;

    return {
      thread,
      childThreads: this.queryThreadRowsByParent(threadId).map((row) => this.mapThread(row)),
      commands: this.queryCommandRowsByThread(threadId).map((row) => this.mapCommand(row)),
      episodes: this.queryEpisodeRowsByThread(threadId).map((row) => this.mapEpisode(row)),
      workflowRuns,
      latestWorkflowRun,
      workflowTaskAttempts,
      workflowTaskMessages: this.queryWorkflowTaskMessageRowsByThread(threadId).map((row) =>
        this.mapWorkflowTaskMessage(row),
      ),
      artifacts: this.queryArtifactRowsByThread(threadId).map((row) => this.mapArtifact(row)),
    };
  }

  private now(): string {
    return this.nowFn();
  }

  private writeRequestInputSettings(input: RequestInputSettings): RequestInputSettings {
    const settings = decodeRequestInputSettings(input);
    const updatedAt = this.now();
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO request_user_input_settings (
             id,
             mode,
             blocking_timeout_enabled,
             blocking_timeout_duration_ms,
             updated_at
           )
           VALUES (1, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             mode = excluded.mode,
             blocking_timeout_enabled = excluded.blocking_timeout_enabled,
             blocking_timeout_duration_ms = excluded.blocking_timeout_duration_ms,
             updated_at = excluded.updated_at`,
        )
        .run(
          settings.mode,
          settings.blockingTimeout.enabled ? 1 : 0,
          settings.blockingTimeout.durationMs,
          updatedAt,
        );
      this.bumpStateRevision();
    })();
    return settings;
  }

  private readAppPreferencesRow(): StructuredAppPreferencesRecord {
    const row = this.db.query(`SELECT * FROM app_preferences WHERE id = 1`).get() as
      | {
          appearance: string;
          external_editor: string | null;
          artifact_directory: string;
          approval_mode: string;
          network_access: number;
          external_instructions_json: string;
          ambient_resources_json: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return {
        appearance: "system",
        externalEditor: null,
        artifactDirectory: defaultArtifactDirectory(),
        approvalMode: "auto-review",
        networkAccess: true,
        externalInstructions: decodeExternalInstructionsSettings(
          JSON.parse(DEFAULT_EXTERNAL_INSTRUCTIONS_JSON),
        ),
        ambientResources: {},
        updatedAt: this.now(),
        stateRevision: this.readStateRevision(),
      };
    }
    assertStructuredAppPreferenceApprovalMode(row.approval_mode);
    return {
      appearance: assertStructuredAppPreferenceAppearance(row.appearance),
      externalEditor: row.external_editor,
      artifactDirectory: row.artifact_directory,
      approvalMode: row.approval_mode,
      networkAccess: row.network_access !== 0,
      externalInstructions: decodeExternalInstructionsSettings(
        fromJson<unknown>(row.external_instructions_json) ??
          JSON.parse(DEFAULT_EXTERNAL_INSTRUCTIONS_JSON),
      ),
      ambientResources: fromJson<JsonValue>(row.ambient_resources_json) ?? {},
      updatedAt: row.updated_at,
      stateRevision: this.readStateRevision(),
    };
  }

  private queryWorkspaceChromeTabs(
    tabKind: WorkspaceChromeTabRow["tab_kind"],
  ): StructuredWorkspaceTabRecord[] {
    return (
      this.db
        .query(
          `SELECT * FROM workspace_chrome_tab
         WHERE tab_kind = ?
         ORDER BY position ASC, workspace_tab_id ASC`,
        )
        .all(tabKind) as WorkspaceChromeTabRow[]
    ).map((row) => ({
      workspaceTabId: row.workspace_tab_id,
      workspaceId: row.workspace_id,
      cwd: row.cwd,
      workspaceLabel: row.workspace_label,
      kind: row.workspace_kind,
      openedAt: row.opened_at,
      activeLayoutId: row.active_layout_id,
    }));
  }

  private insertWorkspaceChromeTabs(
    tabs: readonly StructuredWorkspaceTabRecord[],
    tabKind: WorkspaceChromeTabRow["tab_kind"],
    updatedAt: string,
  ): void {
    tabs.forEach((tab, index) => {
      this.db
        .query(
          `INSERT INTO workspace_chrome_tab (
             workspace_tab_id, workspace_id, cwd, workspace_label, workspace_kind,
             opened_at, active_layout_id, tab_kind, position, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tab.workspaceTabId,
          tab.workspaceId,
          tab.cwd,
          tab.workspaceLabel,
          tab.kind,
          tab.openedAt,
          tab.activeLayoutId,
          tabKind,
          index,
          updatedAt,
        );
    });
  }

  private findWorkspaceLayoutSlot(
    workspaceId: string,
    layoutId: WorkspaceLayoutSlotId,
  ): WorkspaceLayoutSlotRow | null {
    return (
      (this.db
        .query(`SELECT * FROM workspace_layout_slot WHERE workspace_id = ? AND layout_id = ?`)
        .get(workspaceId, layoutId) as WorkspaceLayoutSlotRow | undefined) ?? null
    );
  }

  private upsertWorkspaceLayoutSlot(input: StructuredWorkspaceLayoutSlotRecord): void {
    this.db
      .query(
        `INSERT INTO workspace_layout_slot (
           workspace_id, layout_id, initialized, dockview_json, panes_json,
           compact_surfaces_json, focused_pane_id, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, layout_id) DO UPDATE SET
           initialized = excluded.initialized,
           dockview_json = excluded.dockview_json,
           panes_json = excluded.panes_json,
           compact_surfaces_json = excluded.compact_surfaces_json,
           focused_pane_id = excluded.focused_pane_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.workspaceId,
        input.layoutId,
        input.initialized ? 1 : 0,
        input.dockviewJson === null ? null : JSON.stringify(input.dockviewJson),
        JSON.stringify(input.panes),
        JSON.stringify(input.compactSurfaces),
        input.focusedPaneId,
        input.updatedAt,
      );
  }

  private ensureWorkspaceLayoutSlots(): void {
    this.db.transaction(() => {
      for (const layoutId of ["A", "B", "C"] as const) {
        this.db
          .query(
            `INSERT INTO workspace_layout_slot (
               workspace_id, layout_id, initialized, dockview_json, panes_json,
               compact_surfaces_json, focused_pane_id, updated_at
             ) VALUES (?, ?, 0, NULL, '[]', '[]', NULL, ?)
             ON CONFLICT(workspace_id, layout_id) DO NOTHING`,
          )
          .run(this.workspace.id, layoutId, EMPTY_WORKSPACE_LAYOUT_UPDATED_AT);
      }
    })();
  }

  private mapWorkspaceLayoutSlot(row: WorkspaceLayoutSlotRow): StructuredWorkspaceLayoutSlotRecord {
    let content;
    try {
      content = decodeWorkspaceLayoutSlotContentContract({
        dockviewJson: row.dockview_json === null ? null : JSON.parse(row.dockview_json),
        panes: JSON.parse(row.panes_json),
        compactSurfaces: JSON.parse(row.compact_surfaces_json),
        focusedPaneId: row.focused_pane_id,
      });
    } catch (cause) {
      throw new StateContractError({
        operation: "structured-session.readWorkspaceLayout",
        reason: "decode-failed",
        message: `Persisted workspace layout ${row.workspace_id}:${row.layout_id} is invalid.`,
        cause,
      });
    }
    return {
      workspaceId: row.workspace_id,
      layoutId: row.layout_id,
      initialized: row.initialized !== 0,
      ...content,
      updatedAt: row.updated_at,
    };
  }

  private assertWorkspaceLayoutScope(workspaceId: string, operation: string): void {
    if (workspaceId !== this.workspace.id) {
      throw new StateContractError({
        operation,
        reason: "invalid-input",
        message: `Workspace ${workspaceId} is not managed by this state store.`,
      });
    }
  }

  private upsertAgentProfileCommand(
    actor: StructuredAgentProfileRecord["actor"],
    profile:
      | UpdateOrchestratorProfileCommandInput["profile"]
      | UpdateThreadHandlerProfileCommandInput["profile"],
    followComposer: boolean,
  ): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const position =
      (
        this.db
          .query(`SELECT MAX(position) AS position FROM agent_profile WHERE actor = ?`)
          .get(actor) as { position: number | null } | undefined
      )?.position ?? -1;
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO agent_profile (
             profile_id, actor, name, provider_id, model_id, reasoning_json,
             follow_composer, extension_usage_json, extension_order_json, position, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, actor) DO UPDATE SET
             name = excluded.name,
             provider_id = excluded.provider_id,
             model_id = excluded.model_id,
             reasoning_json = excluded.reasoning_json,
             follow_composer = excluded.follow_composer,
             extension_usage_json = excluded.extension_usage_json,
             extension_order_json = excluded.extension_order_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          profile.profileId,
          actor,
          profile.name,
          profile.providerId,
          profile.modelId,
          profile.reasoning === undefined ? null : JSON.stringify(profile.reasoning),
          followComposer ? 1 : 0,
          JSON.stringify(profile.extensionUsage),
          JSON.stringify(profile.extensionOrder ?? []),
          position + 1,
          updatedAt,
        );
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  private updateAgentProfileUsage(
    actor: StructuredAgentProfileRecord["actor"],
    profileId: string,
    patch: Record<string, ExtensionUsageState | null>,
  ): StructuredMutationCommitRecord {
    const row = this.findAgentProfileRow(actor, profileId);
    const updatedAt = this.now();
    const currentUsage = row
      ? (fromJson<Record<string, ExtensionUsageState>>(row.extension_usage_json) ?? {})
      : {};
    const nextUsage = { ...currentUsage };
    for (const [extensionId, usage] of Object.entries(patch)) {
      if (usage === null) {
        delete nextUsage[extensionId];
      } else {
        nextUsage[extensionId] = usage;
      }
    }
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO agent_profile (
             profile_id, actor, name, provider_id, model_id, reasoning_json,
             follow_composer, extension_usage_json, extension_order_json, position, updated_at
           ) VALUES (?, ?, ?, '', '', NULL, 0, ?, '[]', 0, ?)
           ON CONFLICT(profile_id, actor) DO UPDATE SET
             extension_usage_json = excluded.extension_usage_json,
             updated_at = excluded.updated_at`,
        )
        .run(profileId, actor, profileId, JSON.stringify(nextUsage), updatedAt);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  private findAgentProfileRow(
    actor: StructuredAgentProfileRecord["actor"],
    profileId: string,
  ): AgentProfileRow | null {
    return (
      (this.db
        .query(`SELECT * FROM agent_profile WHERE actor = ? AND profile_id = ?`)
        .get(actor, profileId) as AgentProfileRow | undefined) ?? null
    );
  }

  private mapAgentProfile(row: AgentProfileRow): StructuredAgentProfileRecord {
    return {
      profileId: row.profile_id,
      actor: row.actor,
      name: row.name,
      providerId: row.provider_id,
      modelId: row.model_id,
      reasoning: fromJson<JsonValue>(row.reasoning_json),
      followComposer: row.follow_composer !== 0,
      extensionUsage: fromJson<Record<string, ExtensionUsageState>>(row.extension_usage_json) ?? {},
      extensionOrder: fromJson<string[]>(row.extension_order_json) ?? [],
      position: row.position,
      updatedAt: row.updated_at,
    };
  }

  private findAgentActorExtensionDefaults(
    actor: StructuredAgentActorExtensionDefaultsRecord["actor"],
  ): StructuredAgentActorExtensionDefaultsRecord | null {
    const row = this.db
      .query(`SELECT * FROM agent_actor_extension_defaults WHERE actor = ?`)
      .get(actor) as AgentActorExtensionDefaultsRow | undefined;
    return row ? this.mapAgentActorExtensionDefaults(row) : null;
  }

  private mapAgentActorExtensionDefaults(
    row: AgentActorExtensionDefaultsRow,
  ): StructuredAgentActorExtensionDefaultsRecord {
    return {
      actor: row.actor,
      extensionUsage: fromJson<Record<string, ExtensionUsageState>>(row.extension_usage_json) ?? {},
      extensionOrder: fromJson<string[]>(row.extension_order_json) ?? [],
      updatedAt: row.updated_at,
    };
  }

  private writeAgentActorExtensionDefaults(
    record: StructuredAgentActorExtensionDefaultsRecord,
  ): void {
    this.db
      .query(
        `INSERT INTO agent_actor_extension_defaults (
           actor, extension_usage_json, extension_order_json, updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(actor) DO UPDATE SET
           extension_usage_json = excluded.extension_usage_json,
           extension_order_json = excluded.extension_order_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.actor,
        JSON.stringify(record.extensionUsage),
        JSON.stringify(record.extensionOrder),
        record.updatedAt,
      );
  }

  private assertSnippetWorkspace(workspaceId: string, operation: string): void {
    if (workspaceId !== this.workspace.id) {
      throw new StateContractError({
        operation,
        reason: "invalid-input",
        message: `Workspace ${workspaceId} is not managed by this state store.`,
      });
    }
  }

  private assertExternalInstructionWorkspace(workspaceId: string, operation: string): void {
    if (workspaceId !== this.workspace.id) {
      throw new StateContractError({
        operation,
        reason: "invalid-input",
        message: `Workspace ${workspaceId} is not managed by this state store.`,
      });
    }
  }

  private mustFindSnippet(
    workspaceId: string,
    snippetId: string,
    operation: string,
  ): StructuredSnippetRecord {
    const row = this.db
      .query(
        `SELECT * FROM snippet
         WHERE snippet_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      )
      .get(snippetId, workspaceId) as SnippetRow | undefined;
    if (!row) {
      throw snippetNotFoundError(operation, workspaceId, snippetId, false);
    }
    return this.mapSnippet(row);
  }

  private mustFindManagedSnippet(
    workspaceId: string,
    snippetId: string,
    operation: string,
  ): StructuredSnippetRecord {
    const row = this.db
      .query(
        `SELECT * FROM snippet
         WHERE snippet_id = ? AND workspace_id = ? AND source = 'svvy' AND deleted_at IS NULL`,
      )
      .get(snippetId, workspaceId) as SnippetRow | undefined;
    if (!row) {
      throw snippetNotFoundError(operation, workspaceId, snippetId, true);
    }
    return this.mapSnippet(row);
  }

  private mapSnippet(row: SnippetRow): StructuredSnippetRecord {
    return {
      id: row.snippet_id,
      workspaceId: row.workspace_id,
      source: decodeStoredSnippetSource(row.source),
      title: row.title,
      body: row.body,
      metadata: decodeStoredSnippetMetadata(row.metadata_json),
      enabled: row.enabled !== 0,
      path: row.path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private createId(prefix: string): string {
    if (this.idFactory) {
      return this.idFactory(prefix);
    }
    this.db
      .query(
        `INSERT INTO local_id_sequence (prefix, value)
           VALUES (?, 1)
           ON CONFLICT(prefix) DO UPDATE SET value = value + 1`,
      )
      .run(prefix);
    const row = this.db
      .query(`SELECT value FROM local_id_sequence WHERE prefix = ?`)
      .get(prefix) as { value: number } | null;
    if (!row) {
      throw new Error(`Failed to allocate local id for ${prefix}.`);
    }
    return `${prefix}-${row.value.toString(36)}`;
  }

  private ensureSessionRow(sessionId: string): SessionRow {
    if (this.isSessionDeleted(sessionId)) {
      throw new Error(`Structured session was deleted: ${sessionId}`);
    }

    const existing = this.getSessionRow(sessionId);
    if (existing) {
      return existing;
    }

    const timestamp = this.now();
    this.db
      .query(
        `INSERT INTO session (
           session_id,
           title,
           provider,
           model,
           reasoning_effort,
           orchestrator_agent_profile_id,
           orchestrator_agent_profile_json,
           title_namer_agent_json,
           title_generation_status,
           title_generation_triggered_at,
           title_generation_finished_at,
           title_generation_error,
           title_auto_frozen,
           title_manual_override,
           message_count,
           pi_status,
           created_at,
           updated_at,
           orchestrator_pi_session_id,
           pinned_at,
           archived_at,
           wait_owner_kind,
           wait_thread_id,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since
         ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 'not-started', NULL, NULL, NULL, 0, 0, 0, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      )
      .run(sessionId, sessionId, "idle", timestamp, timestamp, sessionId);
    return this.mustFindSessionRow(sessionId);
  }

  private getSessionRow(sessionId: string): SessionRow | undefined {
    return this.db.query(`SELECT * FROM session WHERE session_id = ?`).get(sessionId) as
      | SessionRow
      | undefined;
  }

  private getWorkspaceSidebarStateRow(): WorkspaceSidebarStateRow | null {
    return (
      (this.db.query(`SELECT * FROM workspace_sidebar_state WHERE id = 1`).get() as
        | WorkspaceSidebarStateRow
        | undefined) ?? null
    );
  }

  private mustFindSessionRow(sessionId: string): SessionRow {
    const row = this.getSessionRow(sessionId);
    if (!row) {
      throw new Error(`Structured session not found: ${sessionId}`);
    }
    return row;
  }

  private mustFindTurnRow(turnId: string): TurnRow {
    const row = this.db.query(`SELECT * FROM turn WHERE id = ?`).get(turnId) as TurnRow | undefined;
    if (!row) {
      throw new Error(`Structured turn not found: ${turnId}`);
    }
    return row;
  }

  private mustFindThreadRow(threadId: string): ThreadRow {
    const row = this.db.query(`SELECT * FROM thread WHERE id = ?`).get(threadId) as
      | ThreadRow
      | undefined;
    if (!row) {
      throw new Error(`Structured thread not found: ${threadId}`);
    }
    return row;
  }

  private mustFindCommandRow(commandId: string): CommandRow {
    const row = this.db.query(`SELECT * FROM command WHERE id = ?`).get(commandId) as
      | CommandRow
      | undefined;
    if (!row) {
      throw new Error(`Structured command not found: ${commandId}`);
    }
    return row;
  }

  private mustFindRuntimeApprovalRequestRow(requestId: string): RuntimeApprovalRequestRow {
    const row = this.db
      .query(`SELECT * FROM runtime_approval_request WHERE id = ?`)
      .get(requestId) as RuntimeApprovalRequestRow | undefined;
    if (!row) {
      throw new Error(`Runtime approval request not found: ${requestId}`);
    }
    return row;
  }

  private mustFindEpisodeRow(episodeId: string): EpisodeRow {
    const row = this.db.query(`SELECT * FROM episode WHERE id = ?`).get(episodeId) as
      | EpisodeRow
      | undefined;
    if (!row) {
      throw new Error(`Structured episode not found: ${episodeId}`);
    }
    return row;
  }

  private mustFindWorkflowRunRow(workflowId: string): WorkflowRunRow {
    const row = this.db.query(`SELECT * FROM workflow_run WHERE id = ?`).get(workflowId) as
      | WorkflowRunRow
      | undefined;
    if (!row) {
      throw new Error(`Structured workflow run not found: ${workflowId}`);
    }
    return row;
  }

  private findWorkflowRunRowBySmithersRunId(smithersRunId: string): WorkflowRunRow | null {
    return (
      (this.db
        .query(`SELECT * FROM workflow_run WHERE smithers_run_id = ? LIMIT 1`)
        .get(smithersRunId) as WorkflowRunRow | undefined) ?? null
    );
  }

  private mustFindWorkflowTaskAttemptRow(workflowTaskAttemptId: string): WorkflowTaskAttemptRow {
    const row = this.db
      .query(`SELECT * FROM workflow_task_attempt WHERE id = ?`)
      .get(workflowTaskAttemptId) as WorkflowTaskAttemptRow | undefined;
    if (!row) {
      throw new Error(`Structured workflow task attempt not found: ${workflowTaskAttemptId}`);
    }
    return row;
  }

  private mustFindSurfaceQueuedMessageRow(id: string): SurfaceQueuedMessageRow {
    const row = this.db.query(`SELECT * FROM surface_message_queue WHERE id = ?`).get(id) as
      | SurfaceQueuedMessageRow
      | undefined;
    if (!row) {
      throw new Error(`Structured queued surface message not found: ${id}`);
    }
    return row;
  }

  private findWorkflowTaskQueueRowByIdempotencyKey(
    idempotencyKey: string,
  ): SurfaceQueuedMessageRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM surface_message_queue
           WHERE idempotency_key = ?
             AND kind = 'workflow_task_agent_start'
             AND status != 'cancelled'
           LIMIT 1`,
        )
        .get(idempotencyKey) as SurfaceQueuedMessageRow | undefined) ?? null
    );
  }

  private mustFindGeneratedAgentContextBindingRow(id: string): GeneratedAgentContextBindingRow {
    const row = this.db
      .query(`SELECT * FROM generated_agent_context_binding WHERE id = ?`)
      .get(id) as GeneratedAgentContextBindingRow | undefined;
    if (!row) {
      throw new Error(`Generated agent context binding not found: ${id}`);
    }
    return row;
  }

  private mustFindRequestUserInputRequestRow(requestId: string): RequestUserInputRequestRow {
    const row = this.db
      .query(`SELECT * FROM request_user_input_request WHERE id = ?`)
      .get(requestId) as RequestUserInputRequestRow | undefined;
    if (!row) {
      throw new Error(`Request user input request not found: ${requestId}`);
    }
    return row;
  }

  private mustFindRequestUserInputAnswerRow(answerId: string): RequestUserInputAnswerRow {
    const row = this.db
      .query(`SELECT * FROM request_user_input_answer WHERE id = ?`)
      .get(answerId) as RequestUserInputAnswerRow | undefined;
    if (!row) {
      throw new Error(`Request user input answer not found: ${answerId}`);
    }
    return row;
  }

  private findRequestUserInputAnswerByIdempotencyKey(input: {
    requestId: string;
    questionId: string;
    idempotencyKey: string;
  }): RequestUserInputAnswerRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM request_user_input_answer
           WHERE request_id = ? AND question_id = ? AND idempotency_key = ?
           LIMIT 1`,
        )
        .get(input.requestId, input.questionId, input.idempotencyKey) as
        | RequestUserInputAnswerRow
        | undefined) ?? null
    );
  }

  private mustFindRecoveryWorkRow(id: string): RecoveryWorkRow {
    const row = this.db.query(`SELECT * FROM recovery_work WHERE id = ?`).get(id) as
      | RecoveryWorkRow
      | undefined;
    if (!row) {
      throw new Error(`Structured recovery work not found: ${id}`);
    }
    return row;
  }

  private findWorkflowTaskAttemptRowByIdentity(input: {
    smithersRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
  }): WorkflowTaskAttemptRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM workflow_task_attempt
           WHERE smithers_run_id = ? AND node_id = ? AND iteration = ? AND attempt = ?
           LIMIT 1`,
        )
        .get(input.smithersRunId, input.nodeId, input.iteration, input.attempt) as
        | WorkflowTaskAttemptRow
        | undefined) ?? null
    );
  }

  private mustFindTurnRecord(turnId: string): StructuredTurnRecord {
    return this.mapTurn(this.mustFindTurnRow(turnId));
  }

  private mustFindThreadRecord(threadId: string): StructuredThreadRecord {
    return this.mapThread(this.mustFindThreadRow(threadId));
  }

  private mustFindCommandRecord(commandId: string): StructuredCommandRecord {
    return this.mapCommand(this.mustFindCommandRow(commandId));
  }

  private mustFindEpisodeRecord(episodeId: string): StructuredEpisodeRecord {
    return this.mapEpisode(this.mustFindEpisodeRow(episodeId));
  }

  private mustFindWorkflowRunRecord(workflowId: string): StructuredWorkflowRunRecord {
    return this.mapWorkflowRun(this.mustFindWorkflowRunRow(workflowId));
  }

  private mustFindWorkflowTaskAttemptRecord(
    workflowTaskAttemptId: string,
  ): StructuredWorkflowTaskAttemptRecord {
    return this.mapWorkflowTaskAttempt(this.mustFindWorkflowTaskAttemptRow(workflowTaskAttemptId));
  }

  private mustFindSurfaceQueuedMessageRecord(id: string): StructuredSurfaceQueuedMessageRecord {
    return this.mapSurfaceQueuedMessage(this.mustFindSurfaceQueuedMessageRow(id));
  }

  private mustFindRequestUserInputRequestRecord(
    requestId: string,
  ): StructuredRequestUserInputRequestRecord {
    return this.mapRequestUserInputRequest(this.mustFindRequestUserInputRequestRow(requestId));
  }

  private mustFindRequestUserInputAnswerRecord(
    answerId: string,
  ): StructuredRequestUserInputAnswerRecord {
    return this.mapRequestUserInputAnswer(this.mustFindRequestUserInputAnswerRow(answerId));
  }

  private mustFindRuntimeApprovalRequestRecord(
    requestId: string,
  ): StructuredRuntimeApprovalRequestRecord {
    return this.mapRuntimeApprovalRequest(this.mustFindRuntimeApprovalRequestRow(requestId));
  }

  private mustFindRecoveryWorkRecord(id: string): StructuredRecoveryWorkRecord {
    return this.mapRecoveryWork(this.mustFindRecoveryWorkRow(id));
  }

  private updateRecoveryWorkTerminal(input: {
    id: string;
    status: Extract<StructuredRecoveryWorkStatus, "completed" | "failed" | "cancelled">;
    error: string | null;
    claimedBy?: string | null;
    leaseVersion?: number | null;
  }): StructuredRecoveryWorkRecord {
    const timestamp = this.now();
    const result = this.db
      .query(
        `UPDATE recovery_work
         SET status = ?,
             claimed_by = NULL,
             claimed_at = NULL,
             claim_expires_at = NULL,
             last_error = ?,
             updated_at = ?,
             completed_at = ?
         WHERE id = ?
           AND (? IS NULL OR claimed_by = ?)
           AND (? IS NULL OR lease_version = ?)`,
      )
      .run(
        input.status,
        input.error,
        timestamp,
        timestamp,
        input.id,
        input.claimedBy ?? null,
        input.claimedBy ?? null,
        input.leaseVersion ?? null,
        input.leaseVersion ?? null,
      );
    if (result.changes !== 1) {
      throw new Error(`Recovery work claim is stale: ${input.id}`);
    }
    return this.mustFindRecoveryWorkRecord(input.id);
  }

  private mustFindArtifactRecord(artifactId: string): StructuredArtifactRecord {
    const row = this.db.query(`SELECT * FROM artifact WHERE id = ?`).get(artifactId) as
      | ArtifactRow
      | undefined;
    if (!row) {
      throw new Error(`Structured artifact not found: ${artifactId}`);
    }
    return this.mapArtifact(row);
  }

  private mustFindArtifactMetadataRecord(artifactId: string): ArtifactMetadataRecord {
    const row = this.db.query(`SELECT * FROM artifact WHERE id = ?`).get(artifactId) as
      | ArtifactRow
      | undefined;
    if (!row) {
      throw new Error(`Structured artifact not found: ${artifactId}`);
    }
    return this.mapArtifactMetadata(row);
  }

  private mustFindSessionWait(sessionId: string): StructuredSessionWaitState {
    const wait = this.mapSessionWait(this.mustFindSessionRow(sessionId));
    if (!wait) {
      throw new Error(`Structured session wait not found: ${sessionId}`);
    }
    return wait;
  }

  private queryTurnRows(sessionId: string): TurnRow[] {
    return this.db
      .query(`SELECT * FROM turn WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as TurnRow[];
  }

  private queryThreadRows(sessionId: string): ThreadRow[] {
    return this.db
      .query(`SELECT * FROM thread WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as ThreadRow[];
  }

  private queryCommandRows(sessionId: string): CommandRow[] {
    return this.db
      .query(`SELECT * FROM command WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as CommandRow[];
  }

  private queryEpisodeRows(sessionId: string): EpisodeRow[] {
    return this.db
      .query(`SELECT * FROM episode WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as EpisodeRow[];
  }

  private queryWorkflowRunRows(sessionId: string): WorkflowRunRow[] {
    return this.db
      .query(`SELECT * FROM workflow_run WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as WorkflowRunRow[];
  }

  private queryWorkflowTaskAttemptRows(sessionId: string): WorkflowTaskAttemptRow[] {
    return this.db
      .query(`SELECT * FROM workflow_task_attempt WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as WorkflowTaskAttemptRow[];
  }

  private queryWorkflowTaskMessageRows(sessionId: string): WorkflowTaskMessageRow[] {
    return this.db
      .query(`SELECT * FROM workflow_task_message WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as WorkflowTaskMessageRow[];
  }

  private queryGeneratedAgentContextBindingRows(
    sessionId: string,
  ): GeneratedAgentContextBindingRow[] {
    return this.db
      .query(
        `SELECT * FROM generated_agent_context_binding
         WHERE (owner_kind = 'session' AND owner_id = ?)
            OR (owner_kind = 'thread' AND owner_id IN (
              SELECT id FROM thread WHERE session_id = ?
            ))
            OR (owner_kind = 'workflow-task-attempt' AND owner_id IN (
              SELECT id FROM workflow_task_attempt WHERE session_id = ?
            ))
         ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(sessionId, sessionId, sessionId) as GeneratedAgentContextBindingRow[];
  }

  private queryRequestUserInputRequestRows(sessionId: string): RequestUserInputRequestRow[] {
    return this.db
      .query(`SELECT * FROM request_user_input_request WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as RequestUserInputRequestRow[];
  }

  private queryRequestUserInputQuestionRows(requestId: string): RequestUserInputQuestionRow[] {
    return this.db
      .query(`SELECT * FROM request_user_input_question WHERE request_id = ? ORDER BY ordinal ASC`)
      .all(requestId) as RequestUserInputQuestionRow[];
  }

  private queryRequestUserInputAnswerRows(requestId: string): RequestUserInputAnswerRow[] {
    return this.db
      .query(`SELECT * FROM request_user_input_answer WHERE request_id = ? ORDER BY rowid ASC`)
      .all(requestId) as RequestUserInputAnswerRow[];
  }

  private queryRuntimeApprovalRequestRows(sessionId: string): RuntimeApprovalRequestRow[] {
    return this.db
      .query(`SELECT * FROM runtime_approval_request WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as RuntimeApprovalRequestRow[];
  }

  private queryArtifactRows(sessionId: string): ArtifactRow[] {
    return this.db
      .query(`SELECT * FROM artifact WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as ArtifactRow[];
  }

  private querySurfaceQueuedMessageRows(sessionId: string): SurfaceQueuedMessageRow[] {
    return this.db
      .query(
        `SELECT * FROM surface_message_queue
         WHERE session_id = ?
         ORDER BY surface_pi_session_id ASC, position ASC, rowid ASC`,
      )
      .all(sessionId) as SurfaceQueuedMessageRow[];
  }

  private queryQueuedSurfaceMessageRows(surfacePiSessionId: string): SurfaceQueuedMessageRow[] {
    return this.db
      .query(
        `SELECT * FROM surface_message_queue
         WHERE surface_pi_session_id = ? AND status IN ('queued', 'steering', 'dispatching', 'failed')
         ORDER BY
           CASE
             WHEN status = 'failed' THEN 3
             WHEN status = 'steering' THEN 0
             ELSE 2
           END ASC,
           CASE priority
             WHEN 'interactive' THEN 0
             WHEN 'runtime' THEN 1
             ELSE 2
           END ASC,
           position ASC,
           rowid ASC`,
      )
      .all(surfacePiSessionId) as SurfaceQueuedMessageRow[];
  }

  private queryEventRows(sessionId: string): EventRow[] {
    return this.db
      .query(`SELECT * FROM event WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as EventRow[];
  }

  private queryTurnRecords(sessionId: string): StructuredTurnRecord[] {
    return this.queryTurnRows(sessionId).map((row) => this.mapTurn(row));
  }

  private queryThreadRecords(sessionId: string): StructuredThreadRecord[] {
    return this.queryThreadRows(sessionId).map((row) => this.mapThread(row));
  }

  private queryCommandRecords(sessionId: string): StructuredCommandRecord[] {
    return this.queryCommandRows(sessionId).map((row) => this.mapCommand(row));
  }

  private queryEpisodeRecords(sessionId: string): StructuredEpisodeRecord[] {
    return this.queryEpisodeRows(sessionId).map((row) => this.mapEpisode(row));
  }

  private queryWorkflowRunRecords(sessionId: string): StructuredWorkflowRunRecord[] {
    return this.queryWorkflowRunRows(sessionId).map((row) => this.mapWorkflowRun(row));
  }

  private queryWorkflowTaskAttemptRecords(
    sessionId: string,
  ): StructuredWorkflowTaskAttemptRecord[] {
    return this.queryWorkflowTaskAttemptRows(sessionId).map((row) =>
      this.mapWorkflowTaskAttempt(row),
    );
  }

  private queryWorkflowTaskMessageRecords(
    sessionId: string,
  ): StructuredWorkflowTaskMessageRecord[] {
    return this.queryWorkflowTaskMessageRows(sessionId).map((row) =>
      this.mapWorkflowTaskMessage(row),
    );
  }

  private queryGeneratedAgentContextBindingRecords(
    sessionId: string,
  ): StructuredGeneratedAgentContextBindingRecord[] {
    return this.queryGeneratedAgentContextBindingRows(sessionId).map((row) =>
      this.mapGeneratedAgentContextBinding(row),
    );
  }

  private queryRequestUserInputRequestRecords(
    sessionId: string,
  ): StructuredRequestUserInputRequestRecord[] {
    return this.queryRequestUserInputRequestRows(sessionId).map((row) =>
      this.mapRequestUserInputRequest(row),
    );
  }

  private queryRuntimeApprovalRequestRecords(
    sessionId: string,
  ): StructuredRuntimeApprovalRequestRecord[] {
    return this.queryRuntimeApprovalRequestRows(sessionId).map((row) =>
      this.mapRuntimeApprovalRequest(row),
    );
  }

  private queryArtifactRecords(sessionId: string): StructuredArtifactRecord[] {
    return this.queryArtifactRows(sessionId).map((row) => this.mapArtifact(row));
  }

  private querySurfaceQueuedMessageRecords(
    sessionId: string,
  ): StructuredSurfaceQueuedMessageRecord[] {
    return this.querySurfaceQueuedMessageRows(sessionId).map((row) =>
      this.mapSurfaceQueuedMessage(row),
    );
  }

  private queryEventRecords(sessionId: string): StructuredLifecycleEventRecord[] {
    return this.queryEventRows(sessionId).map((row) => this.mapEvent(row));
  }

  private queryThreadRowsByParent(parentThreadId: string): ThreadRow[] {
    return this.db
      .query(`SELECT * FROM thread WHERE parent_thread_id = ? ORDER BY rowid ASC`)
      .all(parentThreadId) as ThreadRow[];
  }

  private queryCommandRowsByThread(threadId: string): CommandRow[] {
    return this.db
      .query(`SELECT * FROM command WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as CommandRow[];
  }

  private queryEpisodeRowsByThread(threadId: string): EpisodeRow[] {
    return this.db
      .query(`SELECT * FROM episode WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as EpisodeRow[];
  }

  private queryWorkflowRunRowsForThread(threadId: string): WorkflowRunRow[] {
    return this.db
      .query(`SELECT * FROM workflow_run WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as WorkflowRunRow[];
  }

  private queryWorkflowRunRecordsForThread(threadId: string): StructuredWorkflowRunRecord[] {
    return this.queryWorkflowRunRowsForThread(threadId).map((row) => this.mapWorkflowRun(row));
  }

  private queryWorkflowTaskAttemptRowsForThread(threadId: string): WorkflowTaskAttemptRow[] {
    return this.db
      .query(`SELECT * FROM workflow_task_attempt WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as WorkflowTaskAttemptRow[];
  }

  private queryWorkflowTaskAttemptRecordsForThread(
    threadId: string,
  ): StructuredWorkflowTaskAttemptRecord[] {
    return this.queryWorkflowTaskAttemptRowsForThread(threadId).map((row) =>
      this.mapWorkflowTaskAttempt(row),
    );
  }

  private queryWorkflowTaskMessageRowsByThread(threadId: string): WorkflowTaskMessageRow[] {
    return this.db
      .query(
        `SELECT message.*
         FROM workflow_task_message AS message
         JOIN workflow_task_attempt AS attempt ON attempt.id = message.workflow_task_attempt_id
         WHERE attempt.thread_id = ?
         ORDER BY message.rowid ASC`,
      )
      .all(threadId) as WorkflowTaskMessageRow[];
  }

  private queryWorkflowTaskMessageRowsByAttempt(
    workflowTaskAttemptId: string,
  ): WorkflowTaskMessageRow[] {
    return this.db
      .query(
        `SELECT * FROM workflow_task_message
         WHERE workflow_task_attempt_id = ?
         ORDER BY rowid ASC`,
      )
      .all(workflowTaskAttemptId) as WorkflowTaskMessageRow[];
  }

  private queryArtifactRowsByThread(threadId: string): ArtifactRow[] {
    return this.db
      .query(`SELECT * FROM artifact WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as ArtifactRow[];
  }

  private reconcileSessionWaitAfterRunnableChange(sessionId: string): void {
    const session = this.mustFindSessionRow(sessionId);
    const wait = this.mapSessionWait(session);
    if (!wait) {
      return;
    }

    const threads = this.queryThreadRows(sessionId);
    if (wait.owner.kind === "orchestrator") {
      if (threads.some((thread) => isRunnableThreadStatus(thread.status))) {
        this.clearSessionWait({ sessionId });
      }
      return;
    }

    const ownerThreadId = wait.owner.threadId;
    const ownerThread = threads.find((thread) => thread.id === ownerThreadId) ?? null;
    if (!ownerThread || ownerThread.status !== "waiting") {
      this.clearSessionWait({ sessionId });
      return;
    }

    if (
      threads.some((thread) => thread.id !== ownerThreadId && isRunnableThreadStatus(thread.status))
    ) {
      this.clearSessionWait({ sessionId });
    }
  }

  private recordEvent(input: {
    sessionId: string;
    kind: string;
    subjectKind: StructuredEventSubjectKind;
    subjectId: string;
    at?: string;
    data?: Record<string, unknown>;
  }): void {
    const at = input.at ?? this.now();
    this.db
      .query(
        `INSERT INTO event (
           id,
           session_id,
           at,
           kind,
           subject_kind,
           subject_id,
           data_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.createId("event"),
        input.sessionId,
        at,
        input.kind,
        input.subjectKind,
        input.subjectId,
        toJson(input.data),
      );
  }

  private mapPiSession(row: SessionRow): StructuredPiSessionRecord {
    const record: StructuredPiSessionRecord = {
      sessionId: row.session_id,
      title: row.title,
      orchestratorAgentProfileJson: row.orchestrator_agent_profile_json,
      generatedAgentContextFingerprint: row.generated_agent_context_fingerprint,
      updateExtensionContextBeforeNextTurn:
        row.update_extension_context_before_next_turn === null
          ? true
          : Boolean(row.update_extension_context_before_next_turn),
      titleNamerAgentJson: row.title_namer_agent_json,
      titleGenerationStatus: row.title_generation_status ?? "not-started",
      titleGenerationTriggeredAt: row.title_generation_triggered_at,
      titleGenerationFinishedAt: row.title_generation_finished_at,
      titleGenerationError: row.title_generation_error,
      titleAutoFrozen: Boolean(row.title_auto_frozen),
      titleManualOverride: Boolean(row.title_manual_override),
      messageCount: row.message_count,
      status: row.pi_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.parent_session_id !== null) record.parentSessionId = row.parent_session_id;
    if (row.provider !== null) record.provider = row.provider;
    if (row.model !== null) record.model = row.model;
    if (row.reasoning_effort !== null) record.reasoningEffort = row.reasoning_effort;
    if (row.orchestrator_agent_profile_id !== null) {
      record.orchestratorAgentProfileId = row.orchestrator_agent_profile_id;
    }
    if (row.loaded_extension_ids_json !== null) {
      record.loadedExtensionIds = fromJson<string[]>(row.loaded_extension_ids_json) ?? [];
    }
    if (row.available_extension_ids_json !== null) {
      record.availableExtensionIds = fromJson<string[]>(row.available_extension_ids_json) ?? [];
    }
    return record;
  }

  private mapGeneratedAgentContextBinding(
    row: GeneratedAgentContextBindingRow,
  ): StructuredGeneratedAgentContextBindingRecord {
    return {
      id: row.id,
      surfacePiSessionId: row.surface_pi_session_id,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      actorKind: row.actor_kind,
      systemPrompt: row.system_prompt,
      svvyxGuidance: row.svvyx_guidance,
      commandsDts: row.commands_dts,
      nativeToolSchemasJson: row.native_tool_schemas_json,
      generatedAgentContextFingerprint: row.generated_agent_context_fingerprint,
      generatedAgentContextRevision: row.generated_agent_context_revision,
      loadedExtensionIds: fromJson<string[]>(row.loaded_extension_ids_json) ?? [],
      availableExtensionIds: fromJson<string[]>(row.available_extension_ids_json) ?? [],
      externalSourceHashes: fromJson<string[]>(row.external_source_hashes_json) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private queryGeneratedPackageFactRows(): GeneratedPackageFactRow[] {
    return this.db
      .query(`SELECT * FROM generated_package_fact ORDER BY package_name ASC`)
      .all() as GeneratedPackageFactRow[];
  }

  private queryGeneratedWorkflowsExportRows(): GeneratedWorkflowsExportRow[] {
    return this.db
      .query(
        `SELECT *
         FROM generated_workflows_export
         ORDER BY position ASC, qualified_name ASC`,
      )
      .all() as GeneratedWorkflowsExportRow[];
  }

  private findGeneratedPackageFactRow(
    packageName: GeneratedPackageName,
  ): GeneratedPackageFactRow | null {
    return (
      (this.db
        .query(`SELECT * FROM generated_package_fact WHERE package_name = ?`)
        .get(packageName) as GeneratedPackageFactRow | undefined) ?? null
    );
  }

  private mustFindGeneratedPackageFact(
    packageName: GeneratedPackageName,
  ): StructuredGeneratedPackageFactRecord {
    const row = this.findGeneratedPackageFactRow(packageName);
    if (!row) {
      throw new Error(`Generated package fact not found: ${packageName}`);
    }
    return this.mapGeneratedPackageFact(row);
  }

  private dependenciesFromGeneratedPackageFact(
    row: GeneratedPackageFactRow | null,
  ): RuntimeGeneratedPackageFactRecord["dependencies"] {
    if (!row) return [];
    return fromJson<RuntimeGeneratedPackageFactRecord["dependencies"]>(row.dependencies_json) ?? [];
  }

  private diagnosticsFromGeneratedPackageFact(
    row: GeneratedPackageFactRow | null,
  ): RuntimeGeneratedPackageFactRecord["diagnostics"] {
    if (!row) return [];
    return fromJson<string[]>(row.diagnostics_json) ?? [];
  }

  private upsertGeneratedPackageFact(input: {
    packageName: GeneratedPackageName;
    status: RuntimeGeneratedPackageFactRecord["status"];
    buildId: string | null;
    manifestPath: string | null;
    sourceFingerprint: string | null;
    outputFingerprint: string | null;
    generatedFileListDigest: string | null;
    dependencies: RuntimeGeneratedPackageFactRecord["dependencies"];
    diagnostics: RuntimeGeneratedPackageFactRecord["diagnostics"];
    sourceCommandId: string | null;
    refreshNeededReason: string | null;
    lastRecoveryWorkId: string | null;
    createdAt: string;
    updatedAt: string;
  }): void {
    this.db
      .query(
        `INSERT INTO generated_package_fact (
           package_name,
           status,
           build_id,
           manifest_path,
           source_fingerprint,
           output_fingerprint,
           generated_file_list_digest,
           dependencies_json,
           diagnostics_json,
           source_command_id,
           refresh_needed_reason,
           last_recovery_work_id,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(package_name) DO UPDATE SET
           status = excluded.status,
           build_id = excluded.build_id,
           manifest_path = excluded.manifest_path,
           source_fingerprint = excluded.source_fingerprint,
           output_fingerprint = excluded.output_fingerprint,
           generated_file_list_digest = excluded.generated_file_list_digest,
           dependencies_json = excluded.dependencies_json,
           diagnostics_json = excluded.diagnostics_json,
           source_command_id = excluded.source_command_id,
           refresh_needed_reason = excluded.refresh_needed_reason,
           last_recovery_work_id = excluded.last_recovery_work_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.packageName,
        input.status,
        input.buildId,
        input.manifestPath,
        input.sourceFingerprint,
        input.outputFingerprint,
        input.generatedFileListDigest,
        toJson(input.dependencies),
        toJson(input.diagnostics),
        input.sourceCommandId,
        input.refreshNeededReason,
        input.lastRecoveryWorkId,
        input.createdAt,
        input.updatedAt,
      );
  }

  private replaceGeneratedWorkflowsExports(
    buildId: GeneratedPackageBuildId,
    exports: readonly GeneratedWorkflowsExportBuildEvidence[],
    timestamp: string,
  ): void {
    this.db
      .query(`DELETE FROM generated_workflows_export WHERE package_name = '@svvyx/workflows'`)
      .run();
    const insert = this.db.query(
      `INSERT INTO generated_workflows_export (
         package_name,
         build_id,
         position,
         kind,
         namespace,
         export_name,
         qualified_name,
         source_path,
         generated_path,
         generated_code,
         agent_parameters_json,
         workflow_agent_id,
         created_at,
         updated_at
       ) VALUES ('@svvyx/workflows', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [position, evidence] of exports.entries()) {
      insert.run(
        buildId,
        position,
        evidence.kind,
        evidence.namespace,
        evidence.exportName,
        evidence.qualifiedName,
        evidence.sourcePath,
        evidence.generatedPath,
        evidence.generatedCode,
        toJson(evidence.agentParameters),
        evidence.workflowAgentId,
        timestamp,
        timestamp,
      );
    }
  }

  private mapGeneratedPackageFact(
    row: GeneratedPackageFactRow,
  ): StructuredGeneratedPackageFactRecord {
    return {
      packageName: row.package_name,
      status: row.status,
      buildId: row.build_id as StructuredGeneratedPackageFactRecord["buildId"],
      manifestPath: row.manifest_path,
      sourceFingerprint: row.source_fingerprint,
      outputFingerprint: row.output_fingerprint,
      generatedFileListDigest: row.generated_file_list_digest,
      dependencies: this.dependenciesFromGeneratedPackageFact(row),
      diagnostics: this.diagnosticsFromGeneratedPackageFact(row),
      sourceCommandId:
        row.source_command_id as StructuredGeneratedPackageFactRecord["sourceCommandId"],
      refreshNeededReason: row.refresh_needed_reason,
      lastRecoveryWorkId:
        row.last_recovery_work_id as StructuredGeneratedPackageFactRecord["lastRecoveryWorkId"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapGeneratedWorkflowsExport(
    row: GeneratedWorkflowsExportRow,
  ): StructuredGeneratedWorkflowsExportRecord {
    const decoded = decodeUnknownGeneratedWorkflowsExportBuildEvidenceExit({
      kind: row.kind,
      namespace: row.namespace,
      exportName: row.export_name,
      qualifiedName: row.qualified_name,
      sourcePath: row.source_path,
      generatedPath: row.generated_path,
      generatedCode: row.generated_code,
      agentParameters: fromJson<JsonValue>(row.agent_parameters_json),
      workflowAgentId: row.workflow_agent_id,
    });
    if (Exit.isFailure(decoded)) {
      throw new StateContractError({
        operation: "structured-session.generated-workflows-export.decode",
        reason: "decode-failed",
        message: `Persisted generated Workflows export is invalid: ${row.qualified_name}`,
        cause: decoded.cause,
      });
    }
    return {
      ...decoded.value,
      buildId: row.build_id as GeneratedPackageBuildId,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private findExtensionDependencyReadinessRow(
    extensionId: ExtensionId,
    requirementId: string,
  ): ExtensionDependencyReadinessRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM extension_dependency_readiness
           WHERE extension_id = ? AND requirement_id = ?`,
        )
        .get(extensionId, requirementId) as ExtensionDependencyReadinessRow | undefined) ?? null
    );
  }

  private findExtensionDependencyApprovalRow(
    dependency: ExtensionDependencyApprovalIdentity,
  ): ExtensionDependencyApprovalRow | null {
    return (
      (this.db
        .query(`SELECT * FROM extension_dependency_approval WHERE approval_key = ?`)
        .get(extensionDependencyApprovalIdentityKey(dependency)) as
        | ExtensionDependencyApprovalRow
        | undefined) ?? null
    );
  }

  private mustFindExtensionDependencyApproval(
    dependency: ExtensionDependencyApprovalIdentity,
  ): StructuredExtensionDependencyApprovalRecord {
    const row = this.findExtensionDependencyApprovalRow(dependency);
    if (!row) {
      throw new Error(
        `Extension dependency approval not found: ${extensionDependencyApprovalIdentityKey(
          dependency,
        )}`,
      );
    }
    return this.mapExtensionDependencyApproval(row);
  }

  private mapExtensionDependencyApproval(
    row: ExtensionDependencyApprovalRow,
  ): StructuredExtensionDependencyApprovalRecord {
    if (row.approved_by !== "user") {
      throw new Error(`Invalid extension dependency approval actor: ${row.approved_by}`);
    }
    const dependency = Exit.match(
      decodeUnknownExtensionDependencyApprovalIdentityExit(fromJson<unknown>(row.identity_json)),
      {
        onFailure: (cause) => {
          throw Cause.squash(cause);
        },
        onSuccess: (value) => value,
      },
    );
    return {
      dependency,
      approvedAt: row.approved_at,
      approvedBy: "user",
      sourceCommandId: row.source_command_id as CommandId | null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mustFindExtensionDependencyReadiness(
    extensionId: ExtensionId,
    requirementId: string,
  ): StructuredExtensionDependencyReadinessRecord {
    const row = this.findExtensionDependencyReadinessRow(extensionId, requirementId);
    if (!row) {
      throw new Error(`Extension dependency readiness not found: ${extensionId}/${requirementId}`);
    }
    return this.mapExtensionDependencyReadiness(row);
  }

  private mapExtensionDependencyReadiness(
    row: ExtensionDependencyReadinessRow,
  ): StructuredExtensionDependencyReadinessRecord {
    return {
      extensionId: row.extension_id,
      requirementId: row.requirement_id,
      requirementFingerprint: row.requirement_fingerprint,
      status: row.status,
      detectedVersion: row.detected_version,
      expectedVersion: row.expected_version,
      diagnostics: fromJson<string[]>(row.diagnostics_json) ?? [],
      checkedAt: row.checked_at as StructuredExtensionDependencyReadinessRecord["checkedAt"],
    };
  }

  private queryGeneratedPackageWorkspaceLinkRows(): GeneratedPackageWorkspaceLinkRow[] {
    return this.db
      .query(
        `SELECT * FROM generated_package_workspace_link
         ORDER BY workspace_id ASC, package_name ASC`,
      )
      .all() as GeneratedPackageWorkspaceLinkRow[];
  }

  private findGeneratedPackageWorkspaceLinkRow(
    workspaceId: string,
    packageName: GeneratedPackageName,
  ): GeneratedPackageWorkspaceLinkRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM generated_package_workspace_link
           WHERE workspace_id = ? AND package_name = ?`,
        )
        .get(workspaceId, packageName) as GeneratedPackageWorkspaceLinkRow | undefined) ?? null
    );
  }

  private mustFindGeneratedPackageWorkspaceLink(
    workspaceId: string,
    packageName: GeneratedPackageName,
  ): StructuredGeneratedPackageWorkspaceLinkRecord {
    const row = this.findGeneratedPackageWorkspaceLinkRow(workspaceId, packageName);
    if (!row) {
      throw new Error(`Generated package workspace link not found: ${workspaceId}:${packageName}`);
    }
    return this.mapGeneratedPackageWorkspaceLink(row);
  }

  private mapGeneratedPackageWorkspaceLink(
    row: GeneratedPackageWorkspaceLinkRow,
  ): StructuredGeneratedPackageWorkspaceLinkRecord {
    return {
      workspaceId: row.workspace_id as StructuredGeneratedPackageWorkspaceLinkRecord["workspaceId"],
      packageName: row.package_name,
      status: row.status,
      linkPath: row.link_path,
      targetPath: row.target_path,
      diagnostics: fromJson<string[]>(row.diagnostics_json) ?? [],
      sourceCommandId:
        row.source_command_id as StructuredGeneratedPackageWorkspaceLinkRecord["sourceCommandId"],
      lastRecoveryWorkId:
        row.last_recovery_work_id as StructuredGeneratedPackageWorkspaceLinkRecord["lastRecoveryWorkId"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapSessionWait(row: SessionRow): StructuredSessionWaitState | null {
    if (!row.wait_kind || !row.wait_reason || !row.wait_resume_when || !row.wait_since) {
      return null;
    }

    const owner: StructuredSessionWaitOwner =
      row.wait_owner_kind === "thread" && row.wait_thread_id
        ? { kind: "thread", threadId: row.wait_thread_id }
        : { kind: "orchestrator" };

    return {
      owner,
      kind: row.wait_kind,
      reason: row.wait_reason,
      resumeWhen: row.wait_resume_when,
      since: row.wait_since,
    };
  }

  private mapWorkspaceSidebarState(row: WorkspaceSidebarStateRow): StructuredWorkspaceSidebarState {
    return {
      pinnedGroupCollapsed: Boolean(row.pinned_group_collapsed),
      pinnedGroupSizePx: clampSidebarSectionSize(row.pinned_group_size_px),
      activeGroupCollapsed: Boolean(row.active_group_collapsed),
      activeGroupSizePx: clampSidebarSectionSize(row.active_group_size_px),
      archivedGroupCollapsed: Boolean(row.archived_group_collapsed),
      archivedGroupSizePx: clampSidebarSectionSize(row.archived_group_size_px),
      updatedAt: row.updated_at,
    };
  }

  private mapComposerDraft(row: ComposerDraftRow): StructuredComposerDraftRecord {
    return {
      sessionId: row.session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      text: row.text,
      attachments: fromJson<ComposerAttachment[]>(row.attachments_json) ?? [],
      snippetMentions: fromJson<ComposerSnippetMention[]>(row.snippet_mentions_json) ?? [],
      updatedAt: row.updated_at,
    };
  }

  private mapPiSessionReference(row: PiSessionReferenceRow): PiSessionReference {
    const metadata = fromJson<Record<string, JsonValue>>(row.metadata_json);
    return {
      surfacePiSessionId: row.surface_pi_session_id as SurfacePiSessionId,
      referenceFingerprint: row.reference_fingerprint,
      adapterKind: row.adapter_kind,
      adapterVersion: row.adapter_version,
      storageLocator: row.storage_locator,
      ...(row.pi_session_id ? { piSessionId: row.pi_session_id } : {}),
      ...(metadata ? { metadata } : {}),
    };
  }

  private finalizeRuntimeTranscriptAssistantMessage(
    input: FinalizeRuntimeTranscriptAssistantInput,
  ): RuntimeTranscriptAssistantMutation {
    return this.db.transaction(() => {
      const row = this.mustFindTranscriptMessageRow(input.messageId);
      if (row.role !== "assistant" || row.surface_pi_session_id !== input.surfacePiSessionId) {
        throw this.transcriptStateError(
          "finalizeAssistantMessage",
          "conflict",
          `Transcript message ${input.messageId} is not an assistant on surface ${input.surfacePiSessionId}.`,
        );
      }
      const history = input.piHistoryEntry
        ? decodePiHistoryEntryRefContract(input.piHistoryEntry)
        : null;
      if (history) {
        this.assertRuntimeTranscriptPiHistoryEntry(row, history, "finalizeAssistantMessage");
      }
      const usage = input.usage ? decodeRuntimeTranscriptUsageContract(input.usage) : null;
      if (row.status !== "streaming") {
        const current = this.mapRuntimeTranscriptAssistantMessage(row);
        const terminalMatches =
          current.status === input.status &&
          current.api === input.api &&
          current.providerId === input.providerId &&
          current.modelId === input.modelId &&
          current.responseId === input.responseId &&
          toJson(current.usage) === toJson(usage) &&
          current.stopReason === input.stopReason &&
          current.errorMessage === input.errorMessage &&
          toJson(current.piHistoryEntry) === toJson(history) &&
          current.messageTimestamp === input.messageTimestamp &&
          current.finishedAt === input.finishedAt &&
          (input.content === null || toJson(current.content) === toJson(input.content));
        if (!terminalMatches) {
          throw this.transcriptStateError(
            "finalizeAssistantMessage",
            "conflict",
            `Terminal transcript assistant ${input.messageId} is immutable.`,
          );
        }
        return {
          message: current,
          cursor: this.mustReadRuntimeTranscriptStreamCursor(input.surfacePiSessionId),
        };
      }

      const cursorRow = this.readRuntimeTranscriptStreamCursorRow(input.surfacePiSessionId);
      if (cursorRow?.active_assistant_message_id !== input.messageId) {
        throw this.transcriptStateError(
          "finalizeAssistantMessage",
          "conflict",
          `Transcript assistant ${input.messageId} is not the active assistant for its surface.`,
        );
      }
      const cursor = this.advanceRuntimeTranscriptCursorRow({
        surfacePiSessionId: input.surfacePiSessionId,
        streamGenerationId: input.streamGenerationId,
        expectedCursor: input.expectedCursor,
        activeAssistantMessageId: null,
        clearingActiveAssistantMessageId: input.messageId,
      });

      if (input.content) {
        const currentToolCommands = new Map<string, CommandId | null>(
          this.readRuntimeTranscriptContentBlockRows(input.messageId)
            .filter((block) => block.kind === "tool-call" && block.tool_call_id)
            .map((block) => [block.tool_call_id!, block.command_id as CommandId | null]),
        );
        this.db
          .query(`DELETE FROM transcript_content_block WHERE message_id = ?`)
          .run(input.messageId);
        for (const block of input.content) {
          if (block.kind !== "tool-call") {
            this.insertRuntimeTranscriptContentBlock(input.messageId, block, input.finishedAt);
            continue;
          }
          const linkedCommandId = currentToolCommands.get(block.toolCallId) ?? null;
          if (linkedCommandId && block.commandId && linkedCommandId !== block.commandId) {
            throw this.transcriptStateError(
              "finalizeAssistantMessage",
              "conflict",
              `Tool call ${block.toolCallId} cannot be retargeted from command ${linkedCommandId}.`,
            );
          }
          this.insertRuntimeTranscriptContentBlock(
            input.messageId,
            { ...block, commandId: block.commandId ?? linkedCommandId },
            input.finishedAt,
          );
        }
      }

      this.db
        .query(
          `UPDATE transcript_message
           SET status = ?, api = ?, provider_id = ?, model_id = ?, response_id = ?,
               usage_json = ?, stop_reason = ?, error_message = ?,
               pi_history_entry_id = ?, pi_history_entry_json = ?,
               message_timestamp = ?, updated_at = ?, finished_at = ?
           WHERE message_id = ?`,
        )
        .run(
          input.status,
          input.api,
          input.providerId,
          input.modelId,
          input.responseId,
          usage ? toJson(usage) : null,
          input.stopReason,
          input.errorMessage,
          history?.entryId ?? null,
          history ? toJson(history) : null,
          input.messageTimestamp,
          input.finishedAt,
          input.finishedAt,
          input.messageId,
        );
      this.bumpStateRevision();
      return { message: this.mustReadRuntimeTranscriptAssistantMessage(input.messageId), cursor };
    })();
  }

  private insertRuntimeTranscriptContentBlock(
    messageId: string,
    block: RuntimeTranscriptAssistantContent[number],
    timestamp: string,
  ): void {
    this.db
      .query(
        `INSERT INTO transcript_content_block (
           message_id, content_index, kind, text_content, thinking_content,
           thinking_redacted, thinking_signature, tool_call_id, tool_name,
           arguments_json, arguments_status, command_id, thought_signature,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        messageId,
        block.contentIndex,
        block.kind,
        block.kind === "text" ? block.text : null,
        block.kind === "thinking" ? block.thinking : null,
        block.kind === "thinking" && block.redacted !== undefined ? (block.redacted ? 1 : 0) : null,
        block.kind === "thinking" ? (block.thinkingSignature ?? null) : null,
        block.kind === "tool-call" ? block.toolCallId : null,
        block.kind === "tool-call" ? block.toolName : null,
        block.kind === "tool-call" ? block.argumentsJson : null,
        block.kind === "tool-call" ? block.argumentsStatus : null,
        block.kind === "tool-call" ? block.commandId : null,
        block.kind === "tool-call" ? (block.thoughtSignature ?? null) : null,
        timestamp,
        timestamp,
      );
  }

  private transcriptStateError(
    operation: string,
    reason: "not-found" | "conflict" | "stale-state",
    message: string,
  ): StateContractError {
    return new StateContractError({
      operation: `structured-session.transcript.${operation}`,
      reason,
      message,
    });
  }

  private nextRuntimeTranscriptMessageOrdinal(surfacePiSessionId: string): number {
    const row = this.db
      .query(
        `SELECT MAX(ordinal) AS max_ordinal
         FROM transcript_message
         WHERE surface_pi_session_id = ?`,
      )
      .get(surfacePiSessionId) as { max_ordinal: number | null } | undefined;
    return (row?.max_ordinal ?? -1) + 1;
  }

  private findTranscriptMessageRow(messageId: string): TranscriptMessageRow | null {
    return (
      (this.db
        .query(`SELECT * FROM transcript_message WHERE message_id = ? LIMIT 1`)
        .get(messageId) as TranscriptMessageRow | undefined) ?? null
    );
  }

  private mustFindTranscriptMessageRow(messageId: string): TranscriptMessageRow {
    const row = this.findTranscriptMessageRow(messageId);
    if (!row) {
      throw this.transcriptStateError(
        "readMessage",
        "not-found",
        `Transcript message ${messageId} was not found.`,
      );
    }
    return row;
  }

  private mustFindStreamingTranscriptAssistantRow(
    messageId: string,
    surfacePiSessionId: string,
    operation: string,
  ): TranscriptMessageRow {
    const row = this.mustFindTranscriptMessageRow(messageId);
    if (
      row.role !== "assistant" ||
      row.status !== "streaming" ||
      row.surface_pi_session_id !== surfacePiSessionId
    ) {
      throw this.transcriptStateError(
        operation,
        "conflict",
        `Transcript message ${messageId} is not the active streaming assistant for ${surfacePiSessionId}.`,
      );
    }
    return row;
  }

  private findRuntimeTranscriptContentBlockRow(
    messageId: string,
    contentIndex: number,
  ): TranscriptContentBlockRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM transcript_content_block
           WHERE message_id = ? AND content_index = ? LIMIT 1`,
        )
        .get(messageId, contentIndex) as TranscriptContentBlockRow | undefined) ?? null
    );
  }

  private readRuntimeTranscriptContentBlockRows(messageId: string): TranscriptContentBlockRow[] {
    return this.db
      .query(
        `SELECT * FROM transcript_content_block
         WHERE message_id = ?
         ORDER BY content_index ASC`,
      )
      .all(messageId) as TranscriptContentBlockRow[];
  }

  private readRuntimeTranscriptStreamCursorRow(
    surfacePiSessionId: string,
  ): TranscriptStreamCursorRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM surface_transcript_stream
           WHERE surface_pi_session_id = ? LIMIT 1`,
        )
        .get(surfacePiSessionId) as TranscriptStreamCursorRow | undefined) ?? null
    );
  }

  private readRuntimeTranscriptStreamCursor(
    surfacePiSessionId: string,
  ): RuntimeTranscriptStreamCursor | null {
    const row = this.readRuntimeTranscriptStreamCursorRow(surfacePiSessionId);
    return row
      ? {
          surfacePiSessionId:
            row.surface_pi_session_id as RuntimeTranscriptStreamCursor["surfacePiSessionId"],
          streamGenerationId:
            row.stream_generation_id as RuntimeTranscriptStreamCursor["streamGenerationId"],
          streamSequence: row.stream_sequence as RuntimeTranscriptStreamCursor["streamSequence"],
        }
      : null;
  }

  private mustReadRuntimeTranscriptStreamCursor(
    surfacePiSessionId: string,
  ): RuntimeTranscriptStreamCursor {
    const cursor = this.readRuntimeTranscriptStreamCursor(surfacePiSessionId);
    if (!cursor) {
      throw this.transcriptStateError(
        "readStreamCursor",
        "not-found",
        `Transcript stream cursor for ${surfacePiSessionId} was not found.`,
      );
    }
    return cursor;
  }

  private advanceRuntimeTranscriptCursorRow(input: {
    readonly surfacePiSessionId: SurfacePiSessionId;
    readonly streamGenerationId: RuntimeTranscriptStreamCursor["streamGenerationId"];
    readonly expectedCursor: RuntimeTranscriptStreamCursor | null;
    readonly activeAssistantMessageId: string | null;
    readonly clearingActiveAssistantMessageId?: string;
  }): RuntimeTranscriptStreamCursor {
    const current = this.readRuntimeTranscriptStreamCursorRow(input.surfacePiSessionId);
    const expected = input.expectedCursor;
    const matchesExpected =
      current === null
        ? expected === null
        : expected !== null &&
          expected.surfacePiSessionId === input.surfacePiSessionId &&
          expected.streamGenerationId === current.stream_generation_id &&
          expected.streamSequence === current.stream_sequence;
    if (!matchesExpected) {
      throw this.transcriptStateError(
        "advanceStreamCursor",
        "stale-state",
        `Transcript stream cursor for ${input.surfacePiSessionId} changed before this mutation committed.`,
      );
    }
    if (
      current?.active_assistant_message_id &&
      current.active_assistant_message_id !== input.activeAssistantMessageId &&
      current.active_assistant_message_id !== input.clearingActiveAssistantMessageId
    ) {
      throw this.transcriptStateError(
        "advanceStreamCursor",
        "conflict",
        `Transcript surface ${input.surfacePiSessionId} has a different active assistant message.`,
      );
    }
    if (
      current &&
      current.stream_generation_id !== input.streamGenerationId &&
      current.active_assistant_message_id
    ) {
      throw this.transcriptStateError(
        "advanceStreamCursor",
        "conflict",
        `Cannot replace an active transcript stream generation for ${input.surfacePiSessionId}.`,
      );
    }
    const sequence =
      current?.stream_generation_id === input.streamGenerationId ? current.stream_sequence + 1 : 1;
    const timestamp = this.now();
    this.db
      .query(
        `INSERT INTO surface_transcript_stream (
           surface_pi_session_id, stream_generation_id, stream_sequence,
           active_assistant_message_id, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(surface_pi_session_id) DO UPDATE SET
           stream_generation_id = excluded.stream_generation_id,
           stream_sequence = excluded.stream_sequence,
           active_assistant_message_id = excluded.active_assistant_message_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.surfacePiSessionId,
        input.streamGenerationId,
        sequence,
        input.activeAssistantMessageId,
        timestamp,
      );
    return {
      surfacePiSessionId: input.surfacePiSessionId,
      streamGenerationId: input.streamGenerationId,
      streamSequence: sequence as RuntimeTranscriptStreamCursor["streamSequence"],
    };
  }

  private assertRuntimeTranscriptPiHistoryEntry(
    row: TranscriptMessageRow,
    history: NonNullable<RuntimeTranscriptMessage["piHistoryEntry"]>,
    operation: string,
  ): void {
    if (
      history.session.surfacePiSessionId !== row.surface_pi_session_id ||
      (history.messageId !== undefined && history.messageId !== row.message_id)
    ) {
      throw this.transcriptStateError(
        operation,
        "conflict",
        `Pi history entry ${history.entryId} does not identify transcript message ${row.message_id}.`,
      );
    }
    const existing = this.db
      .query(
        `SELECT message_id FROM transcript_message
         WHERE surface_pi_session_id = ? AND pi_history_entry_id = ? AND message_id <> ?
         LIMIT 1`,
      )
      .get(row.surface_pi_session_id, history.entryId, row.message_id) as
      | { message_id: string }
      | undefined;
    if (existing) {
      throw this.transcriptStateError(
        operation,
        "conflict",
        `Pi history entry ${history.entryId} is already bound to transcript message ${existing.message_id}.`,
      );
    }
  }

  private mapRuntimeTranscriptMessage(row: TranscriptMessageRow): RuntimeTranscriptMessage {
    return row.role === "user"
      ? this.mapRuntimeTranscriptUserMessage(row)
      : this.mapRuntimeTranscriptAssistantMessage(row);
  }

  private mapRuntimeTranscriptUserMessage(row: TranscriptMessageRow): RuntimeTranscriptUserMessage {
    if (
      row.role !== "user" ||
      !row.queue_item_id ||
      !row.user_message_json ||
      !row.submitted_at ||
      !row.committed_at
    ) {
      throw this.transcriptStateError(
        "decodeUserMessage",
        "conflict",
        `Stored transcript message ${row.message_id} is not a complete user message.`,
      );
    }
    return {
      role: "user",
      messageId: row.message_id as RuntimeTranscriptUserMessage["messageId"],
      workspaceSessionId: row.session_id as RuntimeTranscriptUserMessage["workspaceSessionId"],
      surfacePiSessionId:
        row.surface_pi_session_id as RuntimeTranscriptUserMessage["surfacePiSessionId"],
      turnId: row.turn_id as RuntimeTranscriptUserMessage["turnId"],
      ordinal: row.ordinal,
      queueItemId: row.queue_item_id as RuntimeTranscriptUserMessage["queueItemId"],
      message: decodeRuntimeSubmittedMessageContract(fromJson(row.user_message_json)),
      piHistoryEntry: row.pi_history_entry_json
        ? decodePiHistoryEntryRefContract(fromJson(row.pi_history_entry_json))
        : null,
      submittedAt: row.submitted_at as RuntimeTranscriptUserMessage["submittedAt"],
      committedAt: row.committed_at as RuntimeTranscriptUserMessage["committedAt"],
    };
  }

  private mapRuntimeTranscriptAssistantMessage(
    row: TranscriptMessageRow,
  ): RuntimeTranscriptAssistantMessage {
    if (
      row.role !== "assistant" ||
      !row.status ||
      !row.provider_id ||
      !row.model_id ||
      !row.started_at
    ) {
      throw this.transcriptStateError(
        "decodeAssistantMessage",
        "conflict",
        `Stored transcript message ${row.message_id} is not a complete assistant message.`,
      );
    }
    const content = this.readRuntimeTranscriptContentBlockRows(row.message_id).map((block) => {
      if (block.kind === "text") {
        return {
          kind: "text" as const,
          contentIndex: block.content_index,
          text: block.text_content ?? "",
        };
      }
      if (block.kind === "thinking") {
        return {
          kind: "thinking" as const,
          contentIndex: block.content_index,
          thinking: block.thinking_content ?? "",
          ...(block.thinking_redacted === null
            ? {}
            : { redacted: Boolean(block.thinking_redacted) }),
          ...(block.thinking_signature ? { thinkingSignature: block.thinking_signature } : {}),
        };
      }
      return {
        kind: "tool-call" as const,
        contentIndex: block.content_index,
        toolCallId: block.tool_call_id as RuntimeTranscriptToolCallBlock["toolCallId"],
        toolName: block.tool_name ?? "",
        argumentsJson: block.arguments_json ?? "",
        argumentsStatus: block.arguments_status ?? "streaming",
        commandId: block.command_id as RuntimeTranscriptToolCallBlock["commandId"],
        ...(block.thought_signature ? { thoughtSignature: block.thought_signature } : {}),
      };
    });
    return {
      role: "assistant",
      messageId: row.message_id as RuntimeTranscriptAssistantMessage["messageId"],
      workspaceSessionId: row.session_id as RuntimeTranscriptAssistantMessage["workspaceSessionId"],
      surfacePiSessionId:
        row.surface_pi_session_id as RuntimeTranscriptAssistantMessage["surfacePiSessionId"],
      turnId: row.turn_id as RuntimeTranscriptAssistantMessage["turnId"],
      ordinal: row.ordinal,
      status: row.status,
      content: decodeRuntimeTranscriptAssistantContentContract(content),
      api: row.api,
      providerId: row.provider_id as RuntimeTranscriptAssistantMessage["providerId"],
      modelId: row.model_id as RuntimeTranscriptAssistantMessage["modelId"],
      responseId: row.response_id,
      usage: row.usage_json ? decodeRuntimeTranscriptUsageContract(fromJson(row.usage_json)) : null,
      stopReason: row.stop_reason,
      errorMessage: row.error_message,
      piHistoryEntry: row.pi_history_entry_json
        ? decodePiHistoryEntryRefContract(fromJson(row.pi_history_entry_json))
        : null,
      startedAt: row.started_at as RuntimeTranscriptAssistantMessage["startedAt"],
      messageTimestamp:
        row.message_timestamp as RuntimeTranscriptAssistantMessage["messageTimestamp"],
      updatedAt: row.updated_at as RuntimeTranscriptAssistantMessage["updatedAt"],
      finishedAt: row.finished_at as RuntimeTranscriptAssistantMessage["finishedAt"],
    };
  }

  private mustReadRuntimeTranscriptAssistantMessage(
    messageId: string,
  ): RuntimeTranscriptAssistantMessage {
    return this.mapRuntimeTranscriptAssistantMessage(this.mustFindTranscriptMessageRow(messageId));
  }

  private mapTurn(row: TurnRow): StructuredTurnRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      requestSummary: row.request_summary,
      turnDecision: row.turn_decision,
      status: row.status,
      assistantMessageId: row.assistant_message_id as MessageId | null,
      assistantText: row.assistant_text,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapThreadWait(row: ThreadRow): StructuredWaitState | null {
    if (
      !row.wait_owner ||
      !row.wait_kind ||
      !row.wait_reason ||
      !row.wait_resume_when ||
      !row.wait_since
    ) {
      return null;
    }
    return {
      owner: row.wait_owner,
      kind: row.wait_kind,
      reason: row.wait_reason,
      resumeWhen: row.wait_resume_when,
      since: row.wait_since,
    };
  }

  private mapThread(row: ThreadRow): StructuredThreadRecord {
    const record: StructuredThreadRecord = {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      parentThreadId: row.parent_thread_id,
      threadGroupId: row.thread_group_id,
      surfacePiSessionId: row.surface_pi_session_id,
      title: row.title,
      objective: row.objective,
      historyMode: row.history_mode,
      objectiveState: row.objective_state,
      status: row.status,
      wait: this.mapThreadWait(row),
      loadedExtensionIds: fromJson<string[]>(row.loaded_extension_ids_json) ?? [],
      availableExtensionIds: fromJson<string[]>(row.available_extension_ids_json) ?? [],
      agentProfileJson: row.agent_profile_json,
      generatedAgentContextFingerprint: row.generated_agent_context_fingerprint,
      updateExtensionContextBeforeNextTurn:
        row.update_extension_context_before_next_turn === null
          ? true
          : Boolean(row.update_extension_context_before_next_turn),
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
    if (row.worktree !== null) record.worktree = row.worktree;
    return record;
  }

  private mapCommand(row: CommandRow): StructuredCommandRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      workflowTaskAttemptId: row.workflow_task_attempt_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      parentCommandId: row.parent_command_id,
      toolName: row.tool_name,
      executor: row.executor,
      visibility: row.visibility,
      status: row.status,
      attempts: row.attempts,
      title: row.title,
      summary: row.summary,
      arguments: fromJson<unknown>(row.arguments_json),
      facts: fromJson<Record<string, unknown>>(row.facts_json),
      error: row.error,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapEpisode(row: EpisodeRow): StructuredEpisodeRecord {
    if (row.thread_id === null) {
      throw new Error(`Structured episode ${row.id} is missing its thread ownership.`);
    }

    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      sourceCommandId: row.source_command_id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      body: row.body,
      createdAt: row.created_at,
    };
  }

  private mapWorkflowRun(row: WorkflowRunRow): StructuredWorkflowRunRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      commandId: row.command_id,
      smithersRunId: row.smithers_run_id,
      workflowName: row.workflow_name,
      workflowSource: row.workflow_source,
      entryPath: row.entry_path,
      savedEntryId: row.saved_entry_id,
      status: row.status,
      smithersStatus: row.smithers_status,
      waitKind: row.wait_kind,
      continuedFromRunIds: fromJson<string[]>(row.continued_from_run_ids_json) ?? [],
      activeDescendantRunId: row.active_descendant_run_id,
      lastEventSeq: row.last_event_seq,
      heartbeatAt: row.heartbeat_at,
      summary: row.summary,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapWorkflowTaskAttempt(row: WorkflowTaskAttemptRow): StructuredWorkflowTaskAttemptRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      smithersRunId: row.smithers_run_id,
      nodeId: row.node_id,
      iteration: row.iteration,
      attempt: row.attempt,
      surfacePiSessionId: row.surface_pi_session_id,
      title: row.title,
      summary: row.summary,
      kind: row.kind,
      status: row.status,
      smithersState: row.smithers_state,
      prompt: row.prompt,
      responseText: row.response_text,
      error: row.error,
      cached: Boolean(row.cached),
      jjPointer: row.jj_pointer,
      jjCwd: row.jj_cwd,
      heartbeatAt: row.heartbeat_at,
      agentId: row.agent_id,
      agentModel: row.agent_model,
      agentEngine: row.agent_engine,
      agentResume: row.agent_resume,
      generatedAgentContextFingerprint: row.generated_agent_context_fingerprint,
      meta: fromJson<Record<string, unknown>>(row.meta_json),
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapWorkflowTaskMessage(row: WorkflowTaskMessageRow): StructuredWorkflowTaskMessageRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      workflowTaskAttemptId: row.workflow_task_attempt_id,
      role: row.role,
      source: row.source,
      smithersEventSeq: row.smithers_event_seq,
      text: row.text,
      createdAt: row.created_at,
    };
  }

  private mapRequestUserInputRequest(
    row: RequestUserInputRequestRow,
  ): StructuredRequestUserInputRequestRecord {
    return {
      requestId: row.id,
      sessionId: row.session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      commandId: row.command_id,
      toolItemId: row.tool_item_id,
      variant: row.variant,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      timeout: fromJson<StructuredRequestUserInputRequestRecord["timeout"]>(row.timeout_json),
      questions: this.queryRequestUserInputQuestionRows(row.id).map((question) =>
        this.mapRequestUserInputQuestion(question),
      ),
      answers: this.queryRequestUserInputAnswerRows(row.id).map((answer) =>
        this.mapRequestUserInputAnswer(answer),
      ),
    };
  }

  private mapRequestUserInputQuestion(
    row: RequestUserInputQuestionRow,
  ): StructuredRequestUserInputQuestionRecord {
    return {
      questionId: row.id,
      requestId: row.request_id,
      ordinal: row.ordinal,
      title: row.title,
      question: row.question,
      defaultAnswer: fromJson<StructuredRequestUserInputAnswer>(row.default_answer_json)!,
      choices: fromJson<StructuredRequestUserInputOptionRecord[]>(row.choices_json) ?? [],
      status: row.status,
    };
  }

  private mapRequestUserInputAnswer(
    row: RequestUserInputAnswerRow,
  ): StructuredRequestUserInputAnswerRecord {
    return {
      answerId: row.id,
      requestId: row.request_id,
      questionId: row.question_id,
      answer: fromJson<StructuredRequestUserInputAnswer>(row.answer_json)!,
      answeredBy: row.answered_by,
      delivery: row.delivery,
      queuedItemId: row.queued_item_id,
      createdAt: row.created_at,
    };
  }

  private mapRuntimeApprovalRequest(
    row: RuntimeApprovalRequestRow,
  ): StructuredRuntimeApprovalRequestRecord {
    return {
      requestId: row.id,
      sessionId: row.session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      commandId: row.command_id,
      toolCallId: row.tool_call_id,
      toolName: row.tool_name,
      approvalMode: row.approval_mode,
      cwd: row.cwd,
      command: row.command_text,
      commandFamily: row.command_family,
      patch: row.patch_text,
      snippetArtifactId: row.snippet_artifact_id,
      typescriptCode: row.typescript_code,
      context: fromJson<StructuredRuntimeApprovalRequestRecord["context"]>(row.context_json),
      status: row.status,
      decisionReason: row.decision_reason,
      reviewer: row.reviewer,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  private mapArtifact(row: ArtifactRow): StructuredArtifactRecord {
    const record: StructuredArtifactRecord = {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      workflowTaskAttemptId: row.workflow_task_attempt_id,
      sourceCommandId: row.source_command_id,
      kind: row.kind,
      name: row.name,
      mimeType: row.mime_type || inferArtifactMimeType(row.name),
      bytes: row.bytes ?? 0,
      sha256: row.sha256 || EMPTY_SHA256,
      immutable: row.immutable === 1,
      createdAt: row.created_at,
      deletedAt: row.deleted_at ?? null,
    };
    if (row.path !== null) {
      record.path = row.path;
      if (!existsSync(row.path)) record.missingFile = true;
    }
    return record;
  }

  private mapArtifactMetadata(row: ArtifactRow): ArtifactMetadataRecord {
    if (row.source_command_id === null) {
      throw new Error(`INVALID_ARGUMENT: artifact metadata ${row.id} has no source command.`);
    }
    if (row.path === null) {
      throw new Error(`INVALID_ARGUMENT: artifact metadata ${row.id} has no stored path.`);
    }
    return {
      artifactId: row.id as ArtifactMetadataRecord["artifactId"],
      workspaceSessionId: row.session_id as ArtifactMetadataRecord["workspaceSessionId"],
      sourceCommandId: row.source_command_id as ArtifactMetadataRecord["sourceCommandId"],
      threadId: row.thread_id as ArtifactMetadataRecord["threadId"],
      workflowRunId: row.workflow_run_id as ArtifactMetadataRecord["workflowRunId"],
      workflowTaskAttemptId:
        row.workflow_task_attempt_id as ArtifactMetadataRecord["workflowTaskAttemptId"],
      name: row.name,
      storedPath: row.path as ArtifactMetadataRecord["storedPath"],
      immutable: row.immutable === 1,
      mimeType: row.mime_type || inferArtifactMimeType(row.name),
      byteSize: row.bytes ?? 0,
      sha256: row.sha256 || EMPTY_SHA256,
      materializationStatus:
        row.materialization_status ?? (row.deleted_at === null ? "ready" : "deleted"),
      createdAt: row.created_at as ArtifactMetadataRecord["createdAt"],
      updatedAt: (row.updated_at ?? row.created_at) as ArtifactMetadataRecord["updatedAt"],
      deletedAt: (row.deleted_at ?? null) as ArtifactMetadataRecord["deletedAt"],
      lastRecoveryWorkId: row.last_recovery_work_id as ArtifactMetadataRecord["lastRecoveryWorkId"],
    };
  }

  private mapSurfaceQueuedMessage(
    row: SurfaceQueuedMessageRow,
  ): StructuredSurfaceQueuedMessageRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      workflowTaskAttemptId: row.workflow_task_attempt_id,
      kind: row.kind,
      idempotencyKey: row.idempotency_key || `surface_queue:${row.id}`,
      messageJson: row.message_json,
      payloadJson: row.payload_json,
      status: row.status,
      priority: row.priority,
      orderingKey: row.ordering_key,
      sequence: row.sequence,
      position: row.position,
      sourceCommandId: row.source_command_id,
      claimOwnerId: row.claim_owner_id,
      claimLeaseExpiresAt: row.claim_lease_expires_at,
      leaseVersion: row.lease_version,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      nextAttemptAt: row.next_attempt_at,
      lastErrorJson: row.last_error_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deliveredAt: row.delivered_at,
      failedAt: row.failed_at,
      failureError: row.failure_error,
      cancelledAt: row.cancelled_at,
    };
  }

  private mapRecoveryWork(row: RecoveryWorkRow): StructuredRecoveryWorkRecord {
    return {
      id: row.id,
      scope:
        row.scope_kind === "workspace" && row.workspace_id
          ? { kind: "workspace", workspaceId: row.workspace_id }
          : { kind: "app" },
      kind: row.kind,
      status: row.status,
      ownerScope: fromJson<StructuredRecoveryWorkOwnerScope>(row.owner_scope_json) ?? {
        kind: "workspace",
      },
      idempotencyKey: row.idempotency_key,
      orderingKey: row.ordering_key,
      orderingSeq: row.ordering_seq,
      priority: row.priority,
      availableAt: row.available_at,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at,
      claimExpiresAt: row.claim_expires_at,
      leaseVersion: row.lease_version,
      payloadJson: fromJson<JsonValue>(row.payload_json) ?? null,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  private mapEvent(row: EventRow): StructuredLifecycleEventRecord {
    const record: StructuredLifecycleEventRecord = {
      id: row.id,
      sessionId: row.session_id,
      at: row.at,
      kind: row.kind,
      subject: {
        kind: row.subject_kind,
        id: row.subject_id,
      },
    };
    const data = fromJson<Record<string, unknown>>(row.data_json);
    if (data != null) record.data = data;
    return record;
  }
}

function initializeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      cwd TEXT NOT NULL,
      artifact_dir TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS state_revision (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_id_sequence (
      prefix TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      appearance TEXT NOT NULL DEFAULT 'system',
      external_editor TEXT,
      artifact_directory TEXT NOT NULL DEFAULT '~/.config/svvy/artifacts',
      approval_mode TEXT NOT NULL,
      network_access INTEGER NOT NULL,
      external_instructions_json TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_INSTRUCTIONS_SQL_JSON}',
      ambient_resources_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_user_input_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL CHECK (mode IN ('nonblocking', 'blocking')),
      blocking_timeout_enabled INTEGER NOT NULL CHECK (blocking_timeout_enabled IN (0, 1)),
      blocking_timeout_duration_ms INTEGER NOT NULL CHECK (blocking_timeout_duration_ms > 0),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_auth_status (
      provider_id TEXT NOT NULL,
      workspace_key TEXT NOT NULL,
      workspace_id TEXT,
      health TEXT NOT NULL,
      redacted_account_label TEXT,
      refreshed_at TEXT,
      expires_at TEXT,
      issue TEXT,
      observed_at TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(provider_id, workspace_key)
    );

    CREATE INDEX IF NOT EXISTS provider_auth_status_workspace_idx
      ON provider_auth_status(workspace_key);

    CREATE TABLE IF NOT EXISTS external_instruction_projection (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      workspace_id TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      state_revision INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_runtime_owner (
      workspace_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      owner_kind TEXT NOT NULL,
      open_reason TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, owner_id, owner_kind)
    );

    CREATE TABLE IF NOT EXISTS session (
      session_id TEXT PRIMARY KEY,
      parent_session_id TEXT,
      title TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      reasoning_effort TEXT,
      orchestrator_agent_profile_id TEXT,
      orchestrator_agent_profile_json TEXT,
      generated_agent_context_fingerprint TEXT,
      update_extension_context_before_next_turn INTEGER NOT NULL DEFAULT 1,
      loaded_extension_ids_json TEXT,
      available_extension_ids_json TEXT,
      title_namer_agent_json TEXT,
      title_generation_status TEXT NOT NULL DEFAULT 'not-started',
      title_generation_triggered_at TEXT,
      title_generation_finished_at TEXT,
      title_generation_error TEXT,
      title_auto_frozen INTEGER NOT NULL DEFAULT 0,
      title_manual_override INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL,
      pi_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      orchestrator_pi_session_id TEXT NOT NULL,
      pinned_at TEXT,
      archived_at TEXT,
      unread_at TEXT,
      unread_reason TEXT,
      last_read_at TEXT,
      wait_owner_kind TEXT,
      wait_thread_id TEXT,
      wait_kind TEXT,
      wait_reason TEXT,
      wait_resume_when TEXT,
      wait_since TEXT
    );

    CREATE TABLE IF NOT EXISTS deleted_session (
      session_id TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_sidebar_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pinned_group_collapsed INTEGER NOT NULL DEFAULT 0,
      pinned_group_size_px INTEGER NOT NULL DEFAULT 150,
      active_group_collapsed INTEGER NOT NULL DEFAULT 0,
      active_group_size_px INTEGER NOT NULL DEFAULT 260,
      archived_group_collapsed INTEGER NOT NULL DEFAULT 1,
      archived_group_size_px INTEGER NOT NULL DEFAULT 190,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_chrome_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_workspace_tab_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_chrome_tab (
      workspace_tab_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      workspace_label TEXT NOT NULL,
      workspace_kind TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      active_layout_id TEXT NOT NULL,
      tab_kind TEXT NOT NULL,
      position INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_tab_id, tab_kind)
    );

    CREATE TABLE IF NOT EXISTS workspace_layout_slot (
      workspace_id TEXT NOT NULL,
      layout_id TEXT NOT NULL,
      initialized INTEGER NOT NULL DEFAULT 0,
      dockview_json TEXT,
      panes_json TEXT NOT NULL,
      compact_surfaces_json TEXT NOT NULL,
      focused_pane_id TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, layout_id)
    );

    CREATE TABLE IF NOT EXISTS agent_profile (
      profile_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      reasoning_json TEXT,
      follow_composer INTEGER NOT NULL DEFAULT 0,
      extension_usage_json TEXT NOT NULL DEFAULT '{}',
      extension_order_json TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(profile_id, actor)
    );

    CREATE TABLE IF NOT EXISTS agent_actor_extension_defaults (
      actor TEXT PRIMARY KEY CHECK (actor IN ('orchestrator', 'workflow-task')),
      extension_usage_json TEXT NOT NULL DEFAULT '{}',
      extension_order_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extension_env_override (
      extension_id TEXT NOT NULL,
      env_name TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(extension_id, env_name)
    );

    CREATE TABLE IF NOT EXISTS extension_env_declaration (
      extension_id TEXT NOT NULL,
      env_name TEXT NOT NULL,
      required INTEGER NOT NULL CHECK (required IN (0, 1)),
      secret INTEGER NOT NULL CHECK (secret IN (0, 1)),
      description TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(extension_id, env_name)
    );

    CREATE TABLE IF NOT EXISTS extension_registry_observation (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      observation_json TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extension_source_build_evidence (
      extension_id TEXT PRIMARY KEY,
      registry_aggregate_fingerprint TEXT NOT NULL,
      observation_json TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extension_source_build_evidence_batch (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      registry_aggregate_fingerprint TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extension_build_attempt (
      attempt_id TEXT PRIMARY KEY,
      client_request_id TEXT NOT NULL UNIQUE,
      extension_id TEXT NOT NULL,
      registry_aggregate_fingerprint TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
      failure_reason TEXT CHECK (failure_reason IS NULL OR failure_reason IN (
        'validation', 'process-failed', 'timed-out', 'cancelled', 'stale-state',
        'output-invalid', 'unknown'
      )),
      successful_build_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      CHECK (
        (status = 'running' AND failure_reason IS NULL AND successful_build_id IS NULL AND finished_at IS NULL)
        OR (status = 'succeeded' AND failure_reason IS NULL AND successful_build_id IS NOT NULL AND finished_at IS NOT NULL)
        OR (status = 'failed' AND failure_reason IS NOT NULL AND successful_build_id IS NULL AND finished_at IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS extension_snapshot (
      snapshot_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      payload_ref_json TEXT NOT NULL,
      secret_payload_ref TEXT,
      extension_count INTEGER NOT NULL CHECK (extension_count >= 0),
      secret_state TEXT NOT NULL CHECK (secret_state IN ('not-present', 'captured')),
      status TEXT NOT NULL CHECK (status = 'available'),
      CHECK ((secret_payload_ref IS NULL AND secret_state = 'not-present') OR
             (secret_payload_ref IS NOT NULL AND secret_state = 'captured'))
    );

    CREATE TABLE IF NOT EXISTS extension_snapshot_restore_attempt (
      attempt_id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      client_request_id TEXT NOT NULL UNIQUE,
      snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision > 0),
      payload_ref_json TEXT NOT NULL,
      secret_payload_ref TEXT,
      status TEXT NOT NULL CHECK (status IN (
        'prepared', 'payload-applied', 'state-committed', 'building', 'completed', 'failed'
      )),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      failure_reason TEXT,
      CHECK ((status IN ('completed', 'failed') AND finished_at IS NOT NULL) OR
             (status NOT IN ('completed', 'failed') AND finished_at IS NULL)),
      CHECK ((status = 'failed' AND failure_reason IS NOT NULL) OR
             (status != 'failed' AND failure_reason IS NULL))
    );

    CREATE TABLE IF NOT EXISTS extension_snapshot_cleanup (
      cleanup_id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      payload_ref_json TEXT NOT NULL,
      secret_payload_ref TEXT,
      requested_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS extension_snapshot_client_request (
      client_request_id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extension_env_secret (
      extension_id TEXT NOT NULL,
      env_name TEXT NOT NULL,
      material_id TEXT NOT NULL,
      revision_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('configured', 'missing')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(extension_id, env_name),
      UNIQUE(extension_id, env_name, material_id)
    );

    CREATE TABLE IF NOT EXISTS extension_env_secret_cleanup (
      extension_id TEXT NOT NULL,
      env_name TEXT NOT NULL,
      material_id TEXT NOT NULL,
      revision_fingerprint TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('replaced', 'removed', 'orphaned')),
      created_at TEXT NOT NULL,
      PRIMARY KEY(extension_id, env_name, material_id)
    );

    CREATE TABLE IF NOT EXISTS extension_env_secret_receipt (
      operation TEXT NOT NULL CHECK (operation IN ('set', 'remove')),
      client_request_id TEXT NOT NULL,
      extension_id TEXT NOT NULL,
      env_name TEXT NOT NULL,
      configured INTEGER NOT NULL CHECK (configured IN (0, 1)),
      committed_at TEXT NOT NULL,
      state_revision INTEGER NOT NULL,
      PRIMARY KEY(client_request_id)
    );

    CREATE TABLE IF NOT EXISTS snippet (
      snippet_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('svvy', 'claude', 'pi')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{"description":null,"argumentHint":null}',
      enabled INTEGER NOT NULL DEFAULT 1,
      path TEXT,
      discovery_scope TEXT CHECK (discovery_scope IN ('user', 'workspace')),
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS surface_lifecycle (
      surface_pi_session_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      surface_kind TEXT NOT NULL,
      thread_id TEXT,
      workflow_task_attempt_id TEXT,
      status TEXT NOT NULL,
      open_count INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      closed_at TEXT,
      close_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pi_session_reference (
      surface_pi_session_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      workspace_session_id TEXT NOT NULL,
      surface_kind TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      thread_id TEXT,
      workflow_task_attempt_id TEXT,
      adapter_kind TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      storage_locator TEXT NOT NULL,
      pi_session_id TEXT,
      reference_fingerprint TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_validated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS turn (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      thread_id TEXT,
      request_summary TEXT NOT NULL,
      turn_decision TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL,
      assistant_message_id TEXT,
      assistant_text TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transcript_message (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      queue_item_id TEXT UNIQUE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      status TEXT CHECK (status IN ('streaming', 'completed', 'failed', 'cancelled')),
      user_message_json TEXT,
      api TEXT,
      provider_id TEXT,
      model_id TEXT,
      response_id TEXT,
      usage_json TEXT,
      stop_reason TEXT CHECK (stop_reason IN ('stop', 'length', 'toolUse', 'error', 'aborted')),
      error_message TEXT,
      pi_history_entry_id TEXT,
      pi_history_entry_json TEXT,
      submitted_at TEXT,
      committed_at TEXT,
      started_at TEXT,
      message_timestamp TEXT,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      UNIQUE(surface_pi_session_id, ordinal),
      UNIQUE(surface_pi_session_id, pi_history_entry_id),
      CHECK (
        (role = 'user' AND queue_item_id IS NOT NULL AND user_message_json IS NOT NULL AND
          status IS NULL AND submitted_at IS NOT NULL AND committed_at IS NOT NULL) OR
        (role = 'assistant' AND queue_item_id IS NULL AND user_message_json IS NULL AND
          status IS NOT NULL AND provider_id IS NOT NULL AND model_id IS NOT NULL AND
          started_at IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS transcript_content_block (
      message_id TEXT NOT NULL,
      content_index INTEGER NOT NULL CHECK (content_index >= 0),
      kind TEXT NOT NULL CHECK (kind IN ('text', 'thinking', 'tool-call')),
      text_content TEXT,
      thinking_content TEXT,
      thinking_redacted INTEGER CHECK (thinking_redacted IN (0, 1)),
      thinking_signature TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      arguments_json TEXT,
      arguments_status TEXT CHECK (arguments_status IN ('streaming', 'accepted')),
      command_id TEXT,
      thought_signature TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (message_id, content_index),
      UNIQUE(message_id, tool_call_id),
      CHECK (
        (kind = 'text' AND text_content IS NOT NULL AND thinking_content IS NULL AND
          tool_call_id IS NULL) OR
        (kind = 'thinking' AND text_content IS NULL AND thinking_content IS NOT NULL AND
          tool_call_id IS NULL) OR
        (kind = 'tool-call' AND text_content IS NULL AND thinking_content IS NULL AND
          tool_call_id IS NOT NULL AND tool_name IS NOT NULL AND arguments_json IS NOT NULL AND
          arguments_status IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS surface_transcript_stream (
      surface_pi_session_id TEXT PRIMARY KEY,
      stream_generation_id TEXT NOT NULL,
      stream_sequence INTEGER NOT NULL CHECK (stream_sequence >= 0),
      active_assistant_message_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_one_streaming_assistant_per_surface
      ON transcript_message(surface_pi_session_id)
      WHERE role = 'assistant' AND status = 'streaming';

    CREATE INDEX IF NOT EXISTS idx_transcript_message_surface_order
      ON transcript_message(surface_pi_session_id, ordinal);

    CREATE INDEX IF NOT EXISTS idx_transcript_content_message_order
      ON transcript_content_block(message_id, content_index);

    CREATE TABLE IF NOT EXISTS thread (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      parent_thread_id TEXT,
      thread_group_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      history_mode TEXT NOT NULL DEFAULT 'isolated',
      objective_state TEXT NOT NULL DEFAULT 'active',
      loaded_extension_ids_json TEXT,
      available_extension_ids_json TEXT,
      status TEXT NOT NULL,
      wait_owner TEXT,
      wait_kind TEXT,
      wait_reason TEXT,
      wait_resume_when TEXT,
      wait_since TEXT,
      worktree TEXT,
      agent_profile_json TEXT,
      generated_agent_context_fingerprint TEXT,
      update_extension_context_before_next_turn INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS generated_agent_context_binding (
      id TEXT PRIMARY KEY,
      surface_pi_session_id TEXT NOT NULL,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      svvyx_guidance TEXT NOT NULL,
      commands_dts TEXT NOT NULL,
      native_tool_schemas_json TEXT NOT NULL,
      generated_agent_context_fingerprint TEXT NOT NULL,
      generated_agent_context_revision INTEGER NOT NULL,
      loaded_extension_ids_json TEXT NOT NULL,
      available_extension_ids_json TEXT NOT NULL,
      external_source_hashes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(surface_pi_session_id, generated_agent_context_fingerprint)
    );

    CREATE TABLE IF NOT EXISTS generated_package_fact (
      package_name TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      build_id TEXT,
      manifest_path TEXT,
      source_fingerprint TEXT,
      output_fingerprint TEXT,
      generated_file_list_digest TEXT,
      dependencies_json TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      source_command_id TEXT,
      refresh_needed_reason TEXT,
      last_recovery_work_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generated_workflows_export (
      package_name TEXT NOT NULL CHECK (package_name = '@svvyx/workflows'),
      build_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL,
      namespace TEXT NOT NULL,
      export_name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      source_path TEXT NOT NULL,
      generated_path TEXT NOT NULL,
      generated_code TEXT NOT NULL,
      agent_parameters_json TEXT,
      workflow_agent_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(package_name, qualified_name),
      UNIQUE(package_name, position)
    );

    CREATE TABLE IF NOT EXISTS generated_package_workspace_link (
      workspace_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      status TEXT NOT NULL,
      link_path TEXT,
      target_path TEXT,
      diagnostics_json TEXT NOT NULL,
      source_command_id TEXT,
      last_recovery_work_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, package_name)
    );

    CREATE TABLE IF NOT EXISTS runtime_source_fact (
      scope_kind TEXT NOT NULL,
      scope_workspace_id TEXT,
      scope_key TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      source_version TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      source_command_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY(scope_key, source_kind, source_id)
    );

    CREATE TABLE IF NOT EXISTS workflow_agent_source_index (
      source_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source_version TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      validation_status TEXT,
      diagnostics_json TEXT NOT NULL,
      parameters_json TEXT,
      extension_order_json TEXT NOT NULL,
      observed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_agent_extension_usage (
      profile_id TEXT NOT NULL,
      extension_id TEXT NOT NULL,
      usage TEXT NOT NULL CHECK (usage IN ('loaded', 'available', 'unavailable')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(profile_id, extension_id)
    );

    CREATE TABLE IF NOT EXISTS extension_usage_change (
      change_id TEXT PRIMARY KEY,
      client_request_id TEXT NOT NULL UNIQUE,
      extension_id TEXT NOT NULL,
      actor TEXT NOT NULL CHECK (actor IN ('orchestrator', 'handler', 'workflow-task')),
      agent_profile TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      before_usage TEXT CHECK (before_usage IS NULL OR before_usage IN ('loaded', 'available', 'unavailable')),
      after_usage TEXT CHECK (after_usage IS NULL OR after_usage IN ('loaded', 'available', 'unavailable')),
      reverted_change_id TEXT,
      created_at TEXT NOT NULL,
      state_revision INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_source_scan_fact (
      scope_kind TEXT NOT NULL,
      scope_workspace_id TEXT,
      scope_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      last_observed_path TEXT,
      last_observation_kind TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(scope_key, domain)
    );

    CREATE TABLE IF NOT EXISTS runtime_source_root_fingerprint_fact (
      scope_kind TEXT NOT NULL,
      scope_workspace_id TEXT,
      scope_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      source_root TEXT NOT NULL,
      root_fingerprint TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(source_root)
    );

    CREATE TABLE IF NOT EXISTS extension_dependency_readiness (
      extension_id TEXT NOT NULL,
      requirement_id TEXT NOT NULL,
      requirement_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      detected_version TEXT,
      expected_version TEXT,
      diagnostics_json TEXT NOT NULL,
      checked_at TEXT,
      source_command_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(extension_id, requirement_id)
    );

    CREATE TABLE IF NOT EXISTS extension_dependency_readiness_batch (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      registry_aggregate_fingerprint TEXT NOT NULL,
      readiness_json TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      source_command_id TEXT
    );

    CREATE TABLE IF NOT EXISTS extension_dependency_approval (
      approval_key TEXT PRIMARY KEY,
      identity_json TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      source_command_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      workflow_task_attempt_id TEXT,
      surface_pi_session_id TEXT NOT NULL,
      thread_id TEXT,
      workflow_run_id TEXT,
      parent_command_id TEXT,
      tool_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      visibility TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      arguments_json TEXT,
      facts_json TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS episode (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      source_command_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_run (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      smithers_run_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      workflow_source TEXT NOT NULL,
      entry_path TEXT,
      saved_entry_id TEXT,
      status TEXT NOT NULL,
      smithers_status TEXT NOT NULL,
      wait_kind TEXT,
      continued_from_run_ids_json TEXT,
      active_descendant_run_id TEXT,
      last_event_seq INTEGER,
      heartbeat_at TEXT,
      summary TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_task_attempt (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      workflow_run_id TEXT NOT NULL,
      smithers_run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      surface_pi_session_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      smithers_state TEXT NOT NULL,
      prompt TEXT,
      response_text TEXT,
      error TEXT,
      cached INTEGER,
      jj_pointer TEXT,
      jj_cwd TEXT,
      heartbeat_at TEXT,
      agent_id TEXT,
      agent_model TEXT,
      agent_engine TEXT,
      agent_resume TEXT,
      generated_agent_context_fingerprint TEXT,
      meta_json TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_task_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workflow_task_attempt_id TEXT NOT NULL,
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      smithers_event_seq INTEGER,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_user_input_request (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      thread_id TEXT,
      turn_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      tool_item_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      status TEXT NOT NULL,
      timeout_json TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS request_user_input_question (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL,
      question TEXT NOT NULL,
      default_answer_json TEXT NOT NULL,
      choices_json TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_user_input_answer (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      answered_by TEXT NOT NULL,
      delivery TEXT,
      queued_item_id TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_request_user_input_answer_idempotency
      ON request_user_input_answer (request_id, question_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS runtime_approval_request (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      thread_id TEXT,
      turn_id TEXT,
      command_id TEXT,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      cwd TEXT NOT NULL,
      command_text TEXT,
      command_family TEXT,
      patch_text TEXT,
      snippet_artifact_id TEXT,
      typescript_code TEXT,
      context_json TEXT,
      status TEXT NOT NULL,
      decision_reason TEXT,
      reviewer TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS artifact (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      workflow_run_id TEXT,
      workflow_task_attempt_id TEXT,
      source_command_id TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '${EMPTY_SHA256}',
      immutable INTEGER NOT NULL DEFAULT 0,
      materialization_status TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT,
      last_recovery_work_id TEXT
    );

    CREATE TABLE IF NOT EXISTS surface_message_queue (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      thread_id TEXT,
      workflow_task_attempt_id TEXT,
      kind TEXT NOT NULL DEFAULT 'user_message',
      idempotency_key TEXT NOT NULL DEFAULT '',
      message_json TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'runtime',
      ordering_key TEXT NOT NULL DEFAULT '',
      sequence INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      source_command_id TEXT,
      claim_owner_id TEXT,
      claim_lease_expires_at TEXT,
      lease_version INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TEXT,
      last_error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT,
      failed_at TEXT,
      failure_error TEXT,
      cancelled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS prompt_history (
      workspace_id TEXT NOT NULL,
      workspace_session_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      queue_item_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      sent_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS surface_composer_draft (
      surface_pi_session_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      text TEXT NOT NULL,
      attachments_json TEXT,
      snippet_mentions_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recovery_work (
      id TEXT PRIMARY KEY,
      scope_kind TEXT NOT NULL,
      workspace_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_scope_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      ordering_key TEXT NOT NULL,
      ordering_seq INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      claimed_by TEXT,
      claimed_at TEXT,
      claim_expires_at TEXT,
      lease_version INTEGER NOT NULL,
      payload_json TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      CHECK (
        (scope_kind = 'app' AND workspace_id IS NULL)
        OR (scope_kind = 'workspace' AND workspace_id IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS event (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      data_json TEXT
    );
  `);
  ensureColumn(db, "session", "pinned_at", "TEXT");
  ensureColumn(db, "session", "archived_at", "TEXT");
  ensureColumn(db, "session", "unread_at", "TEXT");
  ensureColumn(db, "session", "unread_reason", "TEXT");
  ensureColumn(db, "session", "last_read_at", "TEXT");
  ensureColumn(db, "session", "orchestrator_agent_profile_id", "TEXT");
  ensureColumn(db, "session", "orchestrator_agent_profile_json", "TEXT");
  ensureColumn(db, "session", "generated_agent_context_fingerprint", "TEXT");
  ensureColumn(
    db,
    "session",
    "update_extension_context_before_next_turn",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(db, "session", "loaded_extension_ids_json", "TEXT");
  ensureColumn(db, "session", "available_extension_ids_json", "TEXT");
  ensureColumn(db, "session", "title_namer_agent_json", "TEXT");
  ensureColumn(db, "session", "title_generation_status", "TEXT NOT NULL DEFAULT 'not-started'");
  ensureColumn(db, "session", "title_generation_triggered_at", "TEXT");
  ensureColumn(db, "session", "title_generation_finished_at", "TEXT");
  ensureColumn(db, "session", "title_generation_error", "TEXT");
  ensureColumn(db, "session", "title_auto_frozen", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session", "title_manual_override", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(
    db,
    "workspace_sidebar_state",
    "pinned_group_collapsed",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "workspace_sidebar_state",
    "pinned_group_size_px",
    "INTEGER NOT NULL DEFAULT 150",
  );
  ensureColumn(
    db,
    "workspace_sidebar_state",
    "active_group_collapsed",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    db,
    "workspace_sidebar_state",
    "active_group_size_px",
    "INTEGER NOT NULL DEFAULT 260",
  );
  ensureColumn(
    db,
    "workspace_sidebar_state",
    "archived_group_size_px",
    "INTEGER NOT NULL DEFAULT 190",
  );
  ensureColumn(db, "thread", "agent_profile_json", "TEXT");
  ensureColumn(db, "thread", "generated_agent_context_fingerprint", "TEXT");
  ensureColumn(
    db,
    "thread",
    "update_extension_context_before_next_turn",
    "INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(db, "thread", "thread_group_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "thread", "history_mode", "TEXT NOT NULL DEFAULT 'isolated'");
  ensureColumn(db, "thread", "objective_state", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, "thread", "loaded_extension_ids_json", "TEXT");
  ensureColumn(db, "thread", "available_extension_ids_json", "TEXT");
  ensureColumn(db, "workflow_task_attempt", "generated_agent_context_fingerprint", "TEXT");
  ensureColumn(db, "artifact", "mime_type", "TEXT NOT NULL DEFAULT 'application/octet-stream'");
  ensureColumn(db, "artifact", "bytes", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "artifact", "sha256", `TEXT NOT NULL DEFAULT '${EMPTY_SHA256}'`);
  ensureColumn(db, "artifact", "immutable", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "artifact", "materialization_status", "TEXT NOT NULL DEFAULT 'ready'");
  ensureColumn(db, "artifact", "updated_at", "TEXT");
  ensureColumn(db, "artifact", "deleted_at", "TEXT");
  ensureColumn(db, "artifact", "last_recovery_work_id", "TEXT");
  ensureColumn(db, "extension_build_attempt", "client_request_id", "TEXT");
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS extension_build_attempt_client_request_idx
     ON extension_build_attempt(client_request_id) WHERE client_request_id IS NOT NULL`,
  );
  db.exec(`UPDATE artifact SET updated_at = created_at WHERE updated_at IS NULL`);
  ensureColumn(db, "command", "arguments_json", "TEXT");
  db.exec(
    `UPDATE thread
     SET thread_group_id = CASE
       WHEN thread_group_id IS NULL OR thread_group_id = '' THEN id
       ELSE thread_group_id
     END`,
  );
  ensureColumn(db, "surface_message_queue", "position", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "surface_message_queue", "cancelled_at", "TEXT");
  ensureColumn(db, "surface_message_queue", "failed_at", "TEXT");
  ensureColumn(db, "surface_message_queue", "failure_error", "TEXT");
  ensureColumn(db, "surface_message_queue", "kind", "TEXT NOT NULL DEFAULT 'user_message'");
  ensureColumn(db, "surface_message_queue", "idempotency_key", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "surface_message_queue", "payload_json", "TEXT");
  ensureColumn(db, "surface_message_queue", "workflow_task_attempt_id", "TEXT");
  ensureColumn(db, "surface_message_queue", "priority", "TEXT NOT NULL DEFAULT 'runtime'");
  ensureColumn(db, "surface_message_queue", "ordering_key", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "surface_message_queue", "sequence", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "surface_message_queue", "source_command_id", "TEXT");
  ensureColumn(db, "surface_message_queue", "claim_owner_id", "TEXT");
  ensureColumn(db, "surface_message_queue", "claim_lease_expires_at", "TEXT");
  ensureColumn(db, "surface_message_queue", "lease_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "surface_message_queue", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "surface_message_queue", "max_attempts", "INTEGER NOT NULL DEFAULT 3");
  ensureColumn(db, "surface_message_queue", "next_attempt_at", "TEXT");
  ensureColumn(db, "surface_message_queue", "last_error_json", "TEXT");
  ensureColumn(db, "surface_composer_draft", "snippet_mentions_json", "TEXT");
  ensureColumn(db, "runtime_approval_request", "context_json", "TEXT");
  ensureColumn(db, "app_preferences", "appearance", "TEXT NOT NULL DEFAULT 'system'");
  ensureColumn(db, "app_preferences", "external_editor", "TEXT");
  ensureColumn(
    db,
    "app_preferences",
    "artifact_directory",
    "TEXT NOT NULL DEFAULT '~/.config/svvy/artifacts'",
  );
  ensureColumn(db, "app_preferences", "ambient_resources_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(
    db,
    "app_preferences",
    "external_instructions_json",
    `TEXT NOT NULL DEFAULT '${DEFAULT_EXTERNAL_INSTRUCTIONS_SQL_JSON}'`,
  );
  ensureColumn(db, "agent_profile", "reasoning_json", "TEXT");
  ensureColumn(db, "agent_profile", "follow_composer", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "agent_profile", "extension_usage_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "agent_profile", "extension_order_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "agent_profile", "position", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "extension_env_override", "value", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    db,
    "extension_dependency_readiness",
    "requirement_fingerprint",
    "TEXT NOT NULL DEFAULT ''",
  );
  db.query(`DELETE FROM extension_dependency_readiness WHERE requirement_fingerprint = ''`).run();
  ensureColumn(db, "snippet", "enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "snippet", "path", "TEXT");
  ensureColumn(db, "snippet", "discovery_scope", "TEXT");
  ensureColumn(db, "snippet", "updated_at", "TEXT");
  ensureColumn(db, "snippet", "deleted_at", "TEXT");
  db.exec(`INSERT INTO state_revision (id, revision) VALUES (1, 0) ON CONFLICT(id) DO NOTHING`);
  ensureCanonicalAgentProfileAuthority(db);
  db.exec(
    `UPDATE surface_message_queue
     SET idempotency_key = 'surface_queue:' || id
     WHERE idempotency_key = ''`,
  );
  db.exec(
    `UPDATE surface_message_queue
     SET ordering_key = 'surface:' || surface_pi_session_id
     WHERE ordering_key = ''`,
  );
  db.exec(
    `UPDATE surface_message_queue
     SET sequence = position
     WHERE sequence = 0`,
  );
  db.exec(`DROP INDEX IF EXISTS idx_surface_message_queue_pending`);
  db.exec(
    `CREATE INDEX idx_surface_message_queue_pending
     ON surface_message_queue (surface_pi_session_id, status, priority, ordering_key, sequence)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_request_user_input_request_session
     ON request_user_input_request (session_id, created_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_request_user_input_question_request
     ON request_user_input_question (request_id, ordinal)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_request_user_input_answer_request
     ON request_user_input_answer (request_id, created_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_runtime_approval_request_session
     ON runtime_approval_request (session_id, created_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_runtime_approval_request_pending
     ON runtime_approval_request (status, created_at)`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_surface_message_queue_active_idempotency
     ON surface_message_queue (surface_pi_session_id, idempotency_key)
     WHERE status NOT IN ('delivered', 'cancelled')`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_prompt_history_workspace_sent
     ON prompt_history (workspace_id, sent_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_generated_package_fact_status
     ON generated_package_fact (status, updated_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_generated_workflows_export_build
     ON generated_workflows_export (build_id, position)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_generated_package_workspace_link_repair
     ON generated_package_workspace_link (workspace_id, status, package_name)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_surface_lifecycle_session
     ON surface_lifecycle (session_id, surface_kind)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_workspace_chrome_tab_kind_position
     ON workspace_chrome_tab (tab_kind, position)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_workspace_layout_slot_workspace
     ON workspace_layout_slot (workspace_id, layout_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_profile_actor_position
     ON agent_profile (actor, position, profile_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_extension_env_override_extension
     ON extension_env_override (extension_id, env_name)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_snippet_workspace_source
     ON snippet (workspace_id, source, title)
     WHERE deleted_at IS NULL`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_snippet_discovered_identity
     ON snippet (workspace_id, source, discovery_scope, path)
     WHERE source IN ('claude', 'pi')
       AND discovery_scope IS NOT NULL
       AND path IS NOT NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_pi_session_reference_session
     ON pi_session_reference (workspace_session_id, surface_kind)
     WHERE deleted_at IS NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_runtime_source_fact_updated
     ON runtime_source_fact (scope_key, source_kind, updated_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_workflow_agent_source_index_current
     ON workflow_agent_source_index (deleted_at, source_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_runtime_source_scan_fact_updated
     ON runtime_source_scan_fact (scope_key, updated_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_runtime_source_root_fingerprint_fact_updated
     ON runtime_source_root_fingerprint_fact (scope_key, domain, updated_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_extension_dependency_readiness_status
     ON extension_dependency_readiness (status, updated_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_extension_dependency_approval_updated
     ON extension_dependency_approval (updated_at)`,
  );
  db.exec(`DROP INDEX IF EXISTS idx_recovery_work_active_idempotency`);
  db.exec(
    `CREATE UNIQUE INDEX idx_recovery_work_active_idempotency
     ON recovery_work (scope_kind, workspace_id, idempotency_key)
     WHERE status NOT IN ('claimed', 'completed', 'failed', 'cancelled')`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_recovery_work_claim
     ON recovery_work (scope_kind, workspace_id, status, available_at, priority, ordering_key, ordering_seq, created_at)`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_run_smithers_run_id
     ON workflow_run (smithers_run_id)`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_task_attempt_smithers_identity
     ON workflow_task_attempt (smithers_run_id, node_id, iteration, attempt)`,
  );
}

function ensureCanonicalAgentProfileAuthority(db: Database): void {
  db.transaction(() => {
    const insertProfile = db.query(
      `INSERT INTO agent_profile (
         profile_id, actor, name, provider_id, model_id, reasoning_json,
         follow_composer, extension_usage_json, extension_order_json, position, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '[]', 0, ?)
       ON CONFLICT(profile_id, actor) DO NOTHING`,
    );
    insertProfile.run(
      "default-orchestrator",
      "orchestrator",
      "Default orchestrator",
      "zai",
      "glm-5-turbo",
      JSON.stringify({ effort: "medium" }),
      0,
      DEFAULT_AGENT_PROFILE_UPDATED_AT,
    );
    insertProfile.run(
      "thread-handler",
      "handler",
      "Thread handler",
      "zai",
      "glm-5-turbo",
      JSON.stringify({ effort: "medium" }),
      0,
      DEFAULT_AGENT_PROFILE_UPDATED_AT,
    );

    const insertActorExtensionDefaults = db.query(
      `INSERT INTO agent_actor_extension_defaults (
         actor, extension_usage_json, extension_order_json, updated_at
       ) VALUES (?, '{}', '[]', ?)
       ON CONFLICT(actor) DO NOTHING`,
    );
    insertActorExtensionDefaults.run("orchestrator", DEFAULT_AGENT_PROFILE_UPDATED_AT);
    insertActorExtensionDefaults.run("workflow-task", DEFAULT_AGENT_PROFILE_UPDATED_AT);
  })();
}

function applyBusyTimeout(db: Database, busyTimeoutMs: number | undefined): void {
  if (busyTimeoutMs === undefined) return;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs <= 0) {
    throw new Error("SQLite busyTimeoutMs must be a positive safe integer.");
  }
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
}

function ensureColumn(
  db: Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const columns = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function isRecoveryOwnerAvailable(
  candidate: StructuredRecoveryWorkRecord,
  activeClaims: StructuredRecoveryWorkRecord[],
): boolean {
  return !activeClaims.some((active) => recoveryOwnerConflicts(candidate, active));
}

function orderedUniqueGeneratedPackages(
  packages: readonly GeneratedPackageName[],
): readonly GeneratedPackageName[] {
  const requested = new Set(packages);
  return (["@svvyx/extensions", "@svvyx/workflows"] as const).filter((packageName) =>
    requested.has(packageName),
  );
}

function recoveryOwnerConflicts(
  left: StructuredRecoveryWorkRecord,
  right: StructuredRecoveryWorkRecord,
): boolean {
  if (left.orderingKey === right.orderingKey) {
    return true;
  }
  const leftSurface = recoverySurfaceOwner(left.ownerScope);
  const rightSurface = recoverySurfaceOwner(right.ownerScope);
  if (leftSurface && rightSurface && leftSurface === rightSurface) {
    return true;
  }
  const leftThread = recoveryThreadOwner(left.ownerScope);
  const rightThread = recoveryThreadOwner(right.ownerScope);
  if (leftThread && rightThread && leftThread === rightThread) {
    return true;
  }
  const leftWorkflow = recoveryWorkflowOwner(left.ownerScope);
  const rightWorkflow = recoveryWorkflowOwner(right.ownerScope);
  if (leftWorkflow && rightWorkflow && leftWorkflow === rightWorkflow) {
    return true;
  }
  const leftSource = recoverySourceOwner(left.ownerScope);
  const rightSource = recoverySourceOwner(right.ownerScope);
  return Boolean(leftSource && rightSource && leftSource === rightSource);
}

function recoverySourceOwner(scope: StructuredRecoveryWorkOwnerScope): string | null {
  return scope.kind === "source" ? `${scope.sourceKind}:${scope.sourceId}` : null;
}

function recoverySurfaceOwner(scope: StructuredRecoveryWorkOwnerScope): string | null {
  if (scope.kind === "surface" || scope.kind === "thread" || scope.kind === "queue_item") {
    return scope.surfacePiSessionId;
  }
  return null;
}

function recoveryThreadOwner(scope: StructuredRecoveryWorkOwnerScope): string | null {
  return scope.kind === "thread" ? scope.threadId : null;
}

function recoveryWorkflowOwner(scope: StructuredRecoveryWorkOwnerScope): string | null {
  return scope.kind === "workflow_run" ? scope.workflowRunId : null;
}

function clampSidebarSectionSize(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return MIN_SIDEBAR_SECTION_SIZE_PX;
  return Math.max(
    MIN_SIDEBAR_SECTION_SIZE_PX,
    Math.min(Math.round(sizePx), MAX_SIDEBAR_SECTION_SIZE_PX),
  );
}

type SidebarSectionId = "pinned" | "active" | "archived";

function getSidebarSectionCollapsed(
  state: Omit<StructuredWorkspaceSidebarState, "updatedAt">,
  section: SidebarSectionId,
): boolean {
  if (section === "pinned") return state.pinnedGroupCollapsed;
  if (section === "active") return state.activeGroupCollapsed;
  return state.archivedGroupCollapsed;
}

function getSidebarSectionSize(
  state: Omit<StructuredWorkspaceSidebarState, "updatedAt">,
  section: SidebarSectionId,
): number {
  if (section === "pinned") return state.pinnedGroupSizePx;
  if (section === "active") return state.activeGroupSizePx;
  return state.archivedGroupSizePx;
}

function setSidebarSectionState(
  state: Omit<StructuredWorkspaceSidebarState, "updatedAt">,
  section: SidebarSectionId,
  next: { collapsed: boolean; sizePx: number },
): void {
  if (section === "pinned") {
    state.pinnedGroupCollapsed = next.collapsed;
    state.pinnedGroupSizePx = next.sizePx;
    return;
  }
  if (section === "active") {
    state.activeGroupCollapsed = next.collapsed;
    state.activeGroupSizePx = next.sizePx;
    return;
  }
  state.archivedGroupCollapsed = next.collapsed;
  state.archivedGroupSizePx = next.sizePx;
}

function createDeterministicClock(): () => string {
  let offsetMs = 0;
  const startMs = Date.parse("2026-06-28T00:00:00.000Z");
  return () => new Date(startMs + offsetMs++).toISOString();
}

function providerAuthWorkspaceKey(workspaceId: ListProviderStatusesInput["workspaceId"]): string {
  return workspaceId ?? GLOBAL_PROVIDER_AUTH_WORKSPACE_KEY;
}

function toJson(value: unknown): string | null {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
}

function fromJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return JSON.parse(value) as T;
}

function normalizeManagedSnippetTitle(title: string, operation: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new StateContractError({
      operation,
      reason: "invalid-input",
      message: "Managed snippet title must not be empty.",
    });
  }
  return normalized;
}

function normalizeDiscoveredSnippetTitle(title: string, operation: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new StateContractError({
      operation,
      reason: "invalid-input",
      message: "Discovered snippet title must not be empty.",
    });
  }
  return normalized;
}

function assertCanonicalDiscoveredSnippetPath(path: string, operation: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new StateContractError({
      operation,
      reason: "invalid-input",
      message: `Discovered snippet path must be a canonical absolute path: ${path}.`,
    });
  }
}

function assertDiscoveredHostSnippetIdentity(
  input: { source: string; scope: string; path: string },
  operation: string,
): void {
  if (input.source !== "claude" && input.source !== "pi") {
    throw new StateContractError({
      operation,
      reason: "invalid-input",
      message: `Discovered snippet source ${input.source} is unsupported.`,
    });
  }
  if (input.scope !== "user" && input.scope !== "workspace") {
    throw new StateContractError({
      operation,
      reason: "invalid-input",
      message: `Discovered snippet scope ${input.scope} is unsupported.`,
    });
  }
  assertCanonicalDiscoveredSnippetPath(input.path, operation);
}

function decodeSnippetMetadataInput(input: unknown, operation: string): SnippetMetadata {
  try {
    return decodeSnippetMetadataContract(input);
  } catch (cause) {
    throw new StateContractError({
      operation,
      reason: "invalid-input",
      message: "Snippet metadata does not match the snippet metadata contract.",
      cause,
    });
  }
}

function decodeStoredSnippetMetadata(value: string): SnippetMetadata {
  try {
    return decodeSnippetMetadataContract(JSON.parse(value));
  } catch (cause) {
    throw new StateContractError({
      operation: "structured-session.snippet.decode",
      reason: "decode-failed",
      message: "Persisted snippet metadata does not match the snippet metadata contract.",
      cause,
    });
  }
}

function decodeStoredExtensionRegistryObservation(
  value: string,
): ExtensionRegistryStateRecord["observation"] {
  try {
    return decodeExtensionRegistryObservationResultContract(JSON.parse(value));
  } catch (cause) {
    throw new StateContractError({
      operation: "structured-session.extension-registry.decode",
      reason: "decode-failed",
      message: "Persisted extension registry observation does not match its core contract.",
      cause,
    });
  }
}

function decodeStoredExtensionSourceBuildObservation(
  value: string,
): ExtensionSourceBuildObservation {
  try {
    return decodeExtensionSourceBuildObservationContract(JSON.parse(value));
  } catch (cause) {
    throw new StateContractError({
      operation: "structured-session.extension-source-build-evidence.decode",
      reason: "decode-failed",
      message: "Persisted extension source/build evidence does not match its core contract.",
      cause,
    });
  }
}

function extensionBuildAttemptRecordFromRow(
  row: ExtensionBuildAttemptRow,
): ExtensionBuildAttemptRecord {
  return decodeExtensionBuildAttemptRecordContract({
    attemptId: row.attempt_id,
    clientRequestId: row.client_request_id,
    extensionId: row.extension_id,
    registryAggregateFingerprint: row.registry_aggregate_fingerprint,
    sourceFingerprint: row.source_fingerprint,
    status: row.status,
    failureReason: row.failure_reason,
    successfulBuildId: row.successful_build_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
}

function extensionEnvDeclarationRecord(
  row: ExtensionEnvDeclarationRow,
): StructuredExtensionEnvDeclarationRecord {
  return {
    extensionId: row.extension_id,
    envName: row.env_name,
    required: row.required === 1,
    secret: row.secret === 1,
    description: row.description,
    updatedAt: row.updated_at,
  };
}

function extensionEnvSecretRecord(row: ExtensionEnvSecretRow): StructuredExtensionEnvSecretRecord {
  return {
    extensionId: row.extension_id,
    envName: row.env_name,
    ref: {
      kind: "extension-env",
      extensionId: row.extension_id as ExtensionId,
      envName: row.env_name as ExtensionEnvSecretRef["envName"],
      materialId: row.material_id as ExtensionEnvSecretRef["materialId"],
    },
    revisionFingerprint: row.revision_fingerprint,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function extensionEnvSecretReceiptRecord(
  row: ExtensionEnvSecretReceiptRow,
): StructuredExtensionEnvSecretReceiptRecord {
  return {
    operation: row.operation,
    clientRequestId: row.client_request_id,
    extensionId: row.extension_id,
    envName: row.env_name,
    configured: row.configured === 1,
    committedAt: row.committed_at,
    stateRevision: row.state_revision as StateRevision,
  };
}

function decodeStoredSnippetSource(value: string): SnippetSource {
  try {
    return decodeSnippetSourceContract(value);
  } catch (cause) {
    throw new StateContractError({
      operation: "structured-session.snippet.decode",
      reason: "decode-failed",
      message: `Persisted snippet source ${value} is unsupported.`,
      cause,
    });
  }
}

function decodeStoredDiscoveredSnippetSource(value: string): DiscoveredSnippetSource {
  const source = decodeStoredSnippetSource(value);
  if (source === "svvy") {
    throw new StateContractError({
      operation: "structured-session.snippet.decode",
      reason: "decode-failed",
      message: "Managed snippet source cannot be decoded as a discovered snippet source.",
    });
  }
  return source;
}

function decodeStoredDiscoveredSnippetScope(value: string | null): DiscoveredSnippetScope | null {
  if (value === "user" || value === "workspace") return value;
  return null;
}

function snippetNotFoundError(
  operation: string,
  workspaceId: string,
  snippetId: string,
  managedOnly: boolean,
): StateContractError {
  return new StateContractError({
    operation,
    reason: "not-found",
    message: `${managedOnly ? "Managed snippet" : "Snippet"} ${snippetId} was not found in workspace ${workspaceId}.`,
  });
}

function workspaceChromeTabNotFoundError(
  operation: string,
  workspaceTabId: string,
): StateContractError {
  return new StateContractError({
    operation,
    reason: "not-found",
    message: `Open workspace tab ${workspaceTabId} was not found.`,
  });
}

function workspaceTabCollectionsEqual(
  left: readonly StructuredWorkspaceTabRecord[],
  right: readonly StructuredWorkspaceTabRecord[],
): boolean {
  return (
    left.length === right.length &&
    left.every((tab, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        tab.workspaceTabId === other.workspaceTabId &&
        tab.workspaceId === other.workspaceId &&
        tab.cwd === other.cwd &&
        tab.workspaceLabel === other.workspaceLabel &&
        tab.kind === other.kind &&
        tab.openedAt === other.openedAt &&
        tab.activeLayoutId === other.activeLayoutId
      );
    })
  );
}

function decodeExternalInstructionsSettings(value: unknown): ExternalInstructionsSettings {
  const decoded = decodeUnknownExternalInstructionsSettingsExit(value);
  if (Exit.isFailure(decoded)) {
    throw new Error("INVALID_STATE: persisted external instruction settings are invalid.");
  }
  return normalizeExternalInstructionsSettings(decoded.value);
}

function decodeRequestInputSettings(value: unknown): RequestInputSettings {
  const decoded = decodeUnknownRequestInputSettingsExit(value);
  if (Exit.isFailure(decoded)) {
    throw new Error("INVALID_STATE: persisted request user input settings are invalid.");
  }
  return decoded.value;
}

function normalizeStringList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted();
}

function structuredExtensionListsIntersect(
  lists: readonly (readonly string[] | undefined)[],
  ids: ReadonlySet<ExtensionId>,
): boolean {
  if (ids.size === 0) return false;
  return lists.some((list) => (list ?? []).some((id) => ids.has(id as ExtensionId)));
}

function structuredDropExtensionIds(
  values: readonly string[] | undefined,
  removed: ReadonlySet<ExtensionId>,
): string[] {
  if (!values || removed.size === 0) return values ? [...values] : [];
  return values.filter((id) => !removed.has(id as ExtensionId));
}

function structuredOrchestratorUsageProfileKey(profileId: string): RuntimeExtensionUsageProfileKey {
  return `orchestrator:${profileId}`;
}

function structuredExtensionContextChangedSurface(
  surfacePiSessionId: string,
): RuntimeExtensionContextChangedSurface {
  return {
    surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
    kind: "extension_context_changed",
    label: "Extensions changed",
    reason: "snapshot_loaded",
  };
}

function resolveRequestUserInputOptionAnswer(
  question: StructuredRequestUserInputQuestionRecord,
  optionId: string,
): StructuredRequestUserInputAnswer {
  const option = question.choices.find((choice) => choice.optionId === optionId);
  if (!option) {
    throw new Error("Request user input option does not belong to the question.");
  }
  return {
    kind: "option",
    label: option.label,
    text: option.label,
  };
}

function normalizeRequestUserInputCustomAnswer(text: string): StructuredRequestUserInputAnswer {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Request user input custom answer cannot be blank.");
  }
  return {
    kind: "custom",
    text: trimmed,
  };
}

function isTerminalThreadStatus(status: StructuredThreadStatus): boolean {
  return status === "completed";
}

function isRunnableThreadStatus(status: StructuredThreadStatus): boolean {
  return (
    status === "running-handler" || status === "running-workflow" || status === "troubleshooting"
  );
}

function isTerminalCommandStatus(status: StructuredCommandStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function isTerminalWorkflowStatus(status: StructuredWorkflowStatus): boolean {
  return (
    status === "continued" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function workflowTaskTarget(input: {
  workspaceSessionId: string;
  attempt: WorkflowTaskAttemptRow;
}): {
  workspaceSessionId: string;
  surface: "workflow-task";
  surfacePiSessionId: string;
  workflowTaskAttemptId: string;
  workflowRunId: string;
  threadId: string;
} {
  const surfacePiSessionId = input.attempt.surface_pi_session_id;
  if (!surfacePiSessionId) {
    throw new StateContractError({
      operation: "structured-session.acceptWorkflowTaskAgentStart",
      reason: "conflict",
      message: `Workflow task attempt ${input.attempt.id} has no surface pi session id.`,
    });
  }
  return {
    workspaceSessionId: input.workspaceSessionId,
    surface: "workflow-task",
    surfacePiSessionId,
    workflowTaskAttemptId: input.attempt.id,
    workflowRunId: input.attempt.workflow_run_id,
    threadId: input.attempt.thread_id,
  };
}

function workflowTaskAgentTerminalResultFromAttempt(attempt: WorkflowTaskAttemptRow): {
  text: string;
  usage?: unknown;
  output?: unknown;
} {
  const meta = fromJson<Record<string, unknown>>(attempt.meta_json) ?? {};
  const bridgeResult =
    meta.bridgeResult && typeof meta.bridgeResult === "object"
      ? (meta.bridgeResult as { text?: unknown; usage?: unknown; output?: unknown })
      : null;
  const result = {
    text:
      typeof bridgeResult?.text === "string" ? bridgeResult.text : (attempt.response_text ?? ""),
  } as { text: string; usage?: unknown; output?: unknown };
  if (bridgeResult && "usage" in bridgeResult) {
    result.usage = bridgeResult.usage;
  }
  if (bridgeResult && "output" in bridgeResult) {
    result.output = bridgeResult.output;
  }
  return result;
}

function workflowTaskAgentTerminalResultFromRecord(attempt: StructuredWorkflowTaskAttemptRecord): {
  text: string;
  usage?: unknown;
  output?: unknown;
} {
  const bridgeResult =
    attempt.meta?.bridgeResult && typeof attempt.meta.bridgeResult === "object"
      ? (attempt.meta.bridgeResult as { text?: unknown; usage?: unknown; output?: unknown })
      : null;
  const result = {
    text: typeof bridgeResult?.text === "string" ? bridgeResult.text : (attempt.responseText ?? ""),
  } as { text: string; usage?: unknown; output?: unknown };
  if (bridgeResult && "usage" in bridgeResult) {
    result.usage = bridgeResult.usage;
  }
  if (bridgeResult && "output" in bridgeResult) {
    result.output = bridgeResult.output;
  }
  return result;
}

function workflowTaskPromptSourceToSubmittedMessage(promptSource: unknown): { text: string } {
  if (
    promptSource &&
    typeof promptSource === "object" &&
    (promptSource as { kind?: unknown }).kind === "messages" &&
    Array.isArray((promptSource as { messages?: unknown }).messages)
  ) {
    return {
      text: (promptSource as { messages: Array<{ role: string; text: string }> }).messages
        .map((message) => `${message.role}: ${message.text}`)
        .join("\n\n"),
    };
  }
  return { text: String((promptSource as { prompt?: unknown })?.prompt ?? "") };
}

function isTerminalWorkflowTaskAttemptStatus(status: StructuredWorkflowTaskAttemptStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function defaultSmithersStatusForWorkflowStatus(status: StructuredWorkflowStatus): string {
  switch (status) {
    case "running":
      return "running";
    case "waiting":
      return "waiting-event";
    case "continued":
      return "continued";
    case "completed":
      return "finished";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function defaultWaitKindForWorkflowStatus(
  status: StructuredWorkflowStatus,
): StructuredWorkflowWaitKind | null {
  return status === "waiting" ? "event" : null;
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function defaultArtifactDirectory(): string {
  return join(homedir(), ".config", "svvy", "artifacts");
}

function resolveArtifactPath(input: {
  artifactDir: string;
  sessionId: string;
  name: string;
  immutable: boolean;
}): string {
  const artifactRoot = resolve(input.artifactDir);
  const sessionArtifactDir = resolve(
    artifactRoot,
    input.sessionId,
    input.immutable ? "immutable" : "",
  );
  const artifactPath = resolve(sessionArtifactDir, input.name);
  if (!isPathInside(artifactPath, artifactRoot)) {
    throw new Error(`INVALID_ARGUMENT: artifact path escapes artifact directory`);
  }
  return artifactPath;
}

function validateArtifactStoredPath(artifactDir: string, storedPath: string): string {
  if (!isAbsolute(storedPath)) {
    throw new Error("INVALID_ARGUMENT: artifact storedPath must be absolute.");
  }
  const artifactRoot = resolve(artifactDir);
  const resolvedStoredPath = resolve(storedPath);
  if (!isPathInside(resolvedStoredPath, artifactRoot)) {
    throw new Error("INVALID_ARGUMENT: artifact storedPath escapes artifact directory.");
  }
  return resolvedStoredPath;
}

function validateArtifactName(name: string): string {
  const normalized = normalize(name);
  if (
    !name ||
    normalized !== basename(normalized) ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    hasAsciiControlCharacter(name) ||
    name === "immutable" ||
    name.startsWith(".") ||
    !name.includes(".") ||
    name.endsWith(".")
  ) {
    throw new Error(`INVALID_ARGUMENT: invalid artifact filename ${JSON.stringify(name)}`);
  }
  return name;
}

function validateArtifactByteSize(byteSize: number): number {
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new Error("INVALID_ARGUMENT: artifact byteSize must be a non-negative safe integer.");
  }
  return byteSize;
}

function validateArtifactSha256(sha256: string): string {
  const normalized = sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("INVALID_ARGUMENT: artifact sha256 must be a lowercase hex SHA-256 digest.");
  }
  return normalized;
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function copyArtifactSourceFile(sourcePath: string, artifactPath: string): void {
  if (!existsSync(sourcePath)) {
    throw new Error(`SOURCE_NOT_FOUND: ${sourcePath}`);
  }
  let realSourcePath: string;
  let sourceStat;
  try {
    realSourcePath = realpathSync(sourcePath);
    sourceStat = statSync(realSourcePath);
  } catch (error) {
    throw new Error(
      `SOURCE_UNREADABLE: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  if (sourceStat.isDirectory()) {
    throw new Error(`SOURCE_IS_DIRECTORY: ${sourcePath}`);
  }
  if (!sourceStat.isFile()) {
    throw new Error(`SOURCE_NOT_FILE: ${sourcePath}`);
  }
  copyFileSync(realSourcePath, artifactPath);
}

function isStructuredArtifactError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /^(ARTIFACT_EXISTS|ARTIFACT_NOT_FOUND|INVALID_ARGUMENT|SOURCE_NOT_FOUND|SOURCE_IS_DIRECTORY|SOURCE_NOT_FILE|SOURCE_UNREADABLE|COPY_FAILED|DELETE_FAILED):/.test(
    error.message,
  );
}

function readArtifactFileMetadata(
  digest: StateDigestHelper | undefined,
  path: string,
): { bytes: number; sha256: string } {
  const content = readFileSync(path);
  return {
    bytes: content.byteLength,
    sha256: requireStateDigestHelper(digest).sha256Hex(content),
  };
}

function digestGeneratedPackageFileList(
  digest: StateDigestHelper | undefined,
  files:
    | ReadonlyArray<{
        relativePath: string;
        path: string;
      }>
    | undefined,
): string | null {
  if (!files) return null;
  const stableFiles = files.toSorted((left, right) => {
    const relativeCompare = left.relativePath.localeCompare(right.relativePath);
    if (relativeCompare !== 0) return relativeCompare;
    return left.path.localeCompare(right.path);
  });
  return requireStateDigestHelper(digest).sha256Hex(JSON.stringify(stableFiles));
}

function requireStateDigestHelper(digest: StateDigestHelper | undefined): StateDigestHelper {
  if (!digest) {
    throw new StateContractError({
      operation: "structured-session.digest",
      reason: "transaction-failed",
      message: "Structured session digest helper is required.",
    });
  }
  return digest;
}

function normalizeArtifactMimeType(mimeType?: string): string | undefined {
  if (!mimeType) {
    return undefined;
  }
  const mediaType = mimeType.split(";")[0]?.trim().toLowerCase();
  if (!mediaType || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mediaType)) {
    throw new Error(`INVALID_ARGUMENT: invalid artifact MIME type ${JSON.stringify(mimeType)}`);
  }
  return mediaType;
}

function inferArtifactMimeType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".log")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".ts")) return "text/typescript";
  if (lower.endsWith(".js")) return "text/javascript";
  return "application/octet-stream";
}

function isPathInside(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
