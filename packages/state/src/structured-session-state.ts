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
import {
  RUNTIME_TURN_DECISIONS,
  StateContractError,
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  type ArtifactMaterializationStatus,
  type ArtifactMetadataRecord,
  decodeUnknownExtensionDependencyApprovalIdentityExit,
  decodeUnknownRequestUserInputAnswerQueuePayloadExit,
  type AbsolutePath,
  type ActorKind,
  type AgentProfileId,
  type ApplyRuntimeExtensionSnapshotContextImpactInput,
  type ComposerAttachment,
  type ComposerSnippetMention,
  type CommandId,
  type ExtensionDependencyApprovalIdentity,
  type ExtensionDependencyReadiness,
  type ExtensionId,
  type ExtensionUsageState,
  type ExternalInstructionsSettings,
  type GeneratedPackageName,
  type HandlerInheritedHistoryBlock,
  type JsonValue,
  type DeletePiSessionReferenceInput,
  type MarkGeneratedPackageRefreshNeededInput,
  type AcquireDefaultWorkspaceInput,
  type AcquireWorkspaceInput,
  type AcquireWorkspaceResult,
  type CloseSurfaceInput,
  type CloseSurfaceResult,
  type CreateOrchestratorSurfaceInput,
  type CreateSurfaceResult,
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
  type RecordObservedRuntimeSourceDeletionInput,
  type RecordRuntimeSourceDiagnosticInput,
  type RecordRuntimeSourceDeleteInput,
  type RecordRuntimeSourceScanInput,
  type RecordRuntimeSourceSaveInput,
  type RequestInputAnswerId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RequestUserInputAnswerDeliveryPayload,
  type RequestUserInputAnswerQueuePayload,
  type ReconcileGeneratedPackageManifestInput,
  type ReleaseWorkspaceInput,
  type ReleaseWorkspaceResult,
  type RecordExtensionDependencyReadinessInput,
  type RecordGeneratedPackageBuildInput,
  type RecordGeneratedPackageFailureInput,
  type RecordGeneratedPackageWorkspaceLinkInput,
  type RuntimeSourceFactRecord,
  type RuntimeSourceRootFingerprintFactRecord,
  type RuntimeSourceScanFactRecord,
  type RuntimeExtensionContextChangedSurface,
  type RuntimeExtensionUsageProfileKey,
  type RuntimeGeneratedPackageFactRecord,
  type RuntimeGeneratedPackageWorkspaceLinkRecord,
  type SurfacePiSessionId,
  type SavePiSessionReferenceInput,
  type ValidatePiSessionReferenceInput,
  type WorkspaceId,
  type RuntimeTurnDecision,
  type StateRevision,
  decodeUnknownExternalInstructionsSettingsExit,
} from "@svvy/core";
import type {
  CloseWorkspacePaneCommandInput,
  CreateManagedSnippetCommandInput,
  DeleteManagedSnippetCommandInput,
  DeleteOrchestratorProfileCommandInput,
  PromoteProfileExtensionDefaultCommandInput,
  RemoveExtensionEnvOverrideCommandInput,
  ReorderOrchestratorProfilesCommandInput,
  ResetActorExtensionDefaultsCommandInput,
  SaveWorkspaceLayoutSnapshotCommandInput,
  SelectWorkspaceLayoutSlotCommandInput,
  SelectWorkspaceTabCommandInput,
  SetExternalInstructionActorUsageCommandInput,
  SetExtensionEnvOverrideCommandInput,
  SetProfileExtensionUsageCommandInput,
  SetSnippetEnabledCommandInput,
  SetWorkspaceTabsCommandInput,
  UpdateManagedSnippetCommandInput,
  UpdateOrchestratorProfileCommandInput,
  UpdateThreadHandlerProfileCommandInput,
  UpdateWorkspacePaneCommandInput,
  WorkspaceLayoutSlotId,
} from "./state-command-schemas";

const DEFAULT_SIDEBAR_SECTION_SIZES = {
  pinned: 150,
  active: 260,
  archived: 190,
} as const;

const GLOBAL_PROVIDER_AUTH_WORKSPACE_KEY = "";
const MIN_SIDEBAR_SECTION_SIZE_PX = 64;
const MAX_SIDEBAR_SECTION_SIZE_PX = 1000;
const DEFAULT_EXTERNAL_INSTRUCTIONS_JSON = JSON.stringify(DEFAULT_EXTERNAL_INSTRUCTIONS);
const DEFAULT_EXTERNAL_INSTRUCTIONS_SQL_JSON = DEFAULT_EXTERNAL_INSTRUCTIONS_JSON.replaceAll(
  "'",
  "''",
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
export type StructuredTurnStatus = "running" | "waiting" | "completed" | "failed";
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

export interface StructuredWorkspaceTabRecord {
  workspaceTabId: string;
  workspaceId: string;
  cwd: string;
  openedAt: string;
  activeLayoutId: WorkspaceLayoutSlotId;
}

export interface StructuredWorkspaceChromeLayoutRecord {
  activeWorkspaceTabId: string | null;
  tabs: StructuredWorkspaceTabRecord[];
  knownWorkspaces: StructuredWorkspaceTabRecord[];
  layouts: StructuredWorkspaceLayoutSlotRecord[];
  stateRevision: StateRevision;
}

export interface StructuredWorkspaceLayoutSlotRecord {
  workspaceId: string;
  layoutId: WorkspaceLayoutSlotId;
  initialized: boolean;
  snapshotJson: JsonValue | null;
  focusedPaneId: string | null;
  panelMetadata: JsonValue[];
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

export interface StructuredExtensionEnvOverrideRecord {
  extensionId: string;
  envName: string;
  value: string;
  updatedAt: string;
}

export interface StructuredSnippetRecord {
  id: string;
  workspaceId: string;
  source: "svvy" | "claude" | "pi" | "host";
  title: string;
  body: string;
  metadata: JsonValue;
  enabled: boolean;
  path: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface StructuredPiSessionRecord {
  sessionId: string;
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
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
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
  aggregateCacheKey: string;
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
export type StructuredGeneratedPackageWorkspaceLinkRecord =
  RuntimeGeneratedPackageWorkspaceLinkRecord;
export type StructuredExtensionDependencyReadinessRecord = ExtensionDependencyReadiness;
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
  aggregateCacheKey: string;
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
}

export type StateDigestHelper = {
  readonly sha256Hex: (data: string | Uint8Array) => string;
};

export interface StructuredSessionStateStore {
  readonly workspaceId: string;
  readonly databasePath: string;
  getWorkspaceRecord(): StructuredWorkspaceRecord;
  getCurrentTimestamp(): string;
  getDigestHelper(): StateDigestHelper;
  readCurrentStateRevision(): StateRevision;
  hasAppPreferencesRow(): boolean;
  readAppPreferences(): StructuredAppPreferencesRecord;
  updateAppPreferences(input: StructuredAppPreferencesPatch): StructuredAppPreferencesRecord;
  hasWorkspaceChromeLayoutRows(): boolean;
  readWorkspaceChromeLayout(input?: {
    workspaceId?: string;
    layoutId?: WorkspaceLayoutSlotId;
  }): StructuredWorkspaceChromeLayoutRecord;
  setWorkspaceTabs(input: SetWorkspaceTabsCommandInput): StructuredMutationCommitRecord;
  selectWorkspaceTab(input: SelectWorkspaceTabCommandInput): StructuredMutationCommitRecord;
  selectWorkspaceLayoutSlot(
    input: SelectWorkspaceLayoutSlotCommandInput,
  ): StructuredMutationCommitRecord;
  saveWorkspaceLayoutSnapshot(
    input: SaveWorkspaceLayoutSnapshotCommandInput,
  ): StructuredMutationCommitRecord;
  updateWorkspacePane(input: UpdateWorkspacePaneCommandInput): StructuredMutationCommitRecord;
  closeWorkspacePane(input: CloseWorkspacePaneCommandInput): StructuredMutationCommitRecord;
  hasAgentProfileRows(): boolean;
  listAgentProfiles(): StructuredAgentProfileRecord[];
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
  hasExtensionEnvOverrideRows(): boolean;
  listExtensionEnvOverrides(): StructuredExtensionEnvOverrideRecord[];
  setExtensionEnvOverride(
    input: SetExtensionEnvOverrideCommandInput,
  ): StructuredMutationCommitRecord;
  removeExtensionEnvOverride(
    input: RemoveExtensionEnvOverrideCommandInput,
  ): StructuredMutationCommitRecord;
  hasSnippetRows(workspaceId?: string): boolean;
  listSnippets(input?: { workspaceId?: string }): StructuredSnippetRecord[];
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
  recordRuntimeSourceScan(input: RecordRuntimeSourceScanInput): RuntimeSourceScanFactRecord;
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
    aggregateCacheKey: string;
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
  }): StructuredTurnRecord;
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
  }): StructuredSessionWaitState;
  clearSessionWait(input: { sessionId: string }): void;
  setSessionPinned(input: { sessionId: string; pinned: boolean }): void;
  setSessionArchived(input: { sessionId: string; archived: boolean }): void;
  markSessionUnread(input: {
    sessionId: string;
    reason: "assistant-turn-finished" | "manual";
  }): void;
  markSessionRead(input: { sessionId: string }): void;
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
  createOrReuseStreamingCommand(input: {
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
  }): StructuredCommandRecord;
  updateCommandArguments(commandId: string, args: unknown): StructuredCommandRecord;
  startCommand(commandId: string): StructuredCommandRecord;
  finishCommand(input: {
    commandId: string;
    status: Exclude<StructuredCommandStatus, "requested" | "running">;
    visibility?: StructuredCommandVisibility;
    summary?: string;
    facts?: Record<string, unknown> | null;
    error?: string | null;
  }): StructuredCommandRecord;
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
      aggregateCacheKey: string;
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
  };
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
  }): StructuredRuntimeApprovalRequestRecord;
  getRuntimeApprovalRequest(requestId: string): StructuredRuntimeApprovalRequestRecord;
  listOpenRuntimeApprovalRequests(): StructuredRuntimeApprovalRequestRecord[];
  answerRequestUserInput(input: {
    surfacePiSessionId: string;
    requestId: string;
    questionId: string;
    answer: { kind: "option"; optionId: string } | { kind: "custom"; text: string };
    delivery: StructuredRequestUserInputDelivery;
  }): {
    request: StructuredRequestUserInputRequestRecord;
    answer: StructuredRequestUserInputAnswerRecord;
    queuedMessage: StructuredSurfaceQueuedMessageRecord | null;
  };
  defaultOpenRequestUserInputQuestions(input: {
    requestId: string;
    answeredBy: "timeout_default";
  }): StructuredRequestUserInputRequestRecord;
  cancelRequestUserInputRequest(input: {
    requestId: string;
  }): StructuredRequestUserInputRequestRecord;
  setRequestUserInputTimerPaused(input: {
    surfacePiSessionId: string;
    requestId: string;
    paused: boolean;
  }): StructuredRequestUserInputRequestRecord;
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
  snapshot_json: string | null;
  focused_pane_id: string | null;
  panel_metadata_json: string;
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

type ExtensionEnvOverrideRow = {
  extension_id: string;
  env_name: string;
  value: string;
  updated_at: string;
};

type SnippetRow = {
  snippet_id: string;
  workspace_id: string;
  source: "svvy" | "claude" | "pi" | "host";
  title: string;
  body: string;
  metadata_json: string;
  enabled: number;
  path: string | null;
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

type GeneratedAgentContextBindingRow = {
  id: string;
  surface_pi_session_id: string;
  owner_kind: StructuredGeneratedAgentContextBindingOwner;
  owner_id: string;
  actor_kind: StructuredGeneratedAgentContextActor;
  aggregate_cache_key: string;
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
  status: ExtensionDependencyReadiness["status"];
  detected_version: string | null;
  expected_version: string | null;
  diagnostics_json: string;
  checked_at: string | null;
  source_command_id: string | null;
  created_at: string;
  updated_at: string;
};

type TurnRow = {
  id: string;
  session_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  request_summary: string;
  turn_decision: StructuredTurnDecision;
  status: StructuredTurnStatus;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
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
  private readonly workspace: StructuredWorkspaceRecord;
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
  }

  close(): void {
    this.db.close();
  }

  getWorkspaceRecord(): StructuredWorkspaceRecord {
    return { ...this.workspace };
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
            : input.externalInstructions,
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
          : input.externalInstructions,
      ambientResources:
        input.ambientResources === undefined ? current.ambientResources : input.ambientResources,
      updatedAt: nextUpdatedAt,
      stateRevision,
    };
  }

  hasWorkspaceChromeLayoutRows(): boolean {
    const chrome = this.db
      .query(`SELECT 1 AS found FROM workspace_chrome_state WHERE id = 1`)
      .get() as { found: number } | undefined;
    if (chrome) return true;
    const tab = this.db.query(`SELECT 1 AS found FROM workspace_chrome_tab LIMIT 1`).get() as
      | { found: number }
      | undefined;
    if (tab) return true;
    const layout = this.db.query(`SELECT 1 AS found FROM workspace_layout_slot LIMIT 1`).get() as
      | { found: number }
      | undefined;
    return Boolean(layout);
  }

  readWorkspaceChromeLayout(
    input: {
      workspaceId?: string;
      layoutId?: WorkspaceLayoutSlotId;
    } = {},
  ): StructuredWorkspaceChromeLayoutRecord {
    const state = this.db.query(`SELECT * FROM workspace_chrome_state WHERE id = 1`).get() as
      | WorkspaceChromeStateRow
      | undefined;
    const tabs = this.queryWorkspaceChromeTabs("open");
    const knownWorkspaces = this.queryWorkspaceChromeTabs("known");
    const rows = this.db
      .query(
        `SELECT * FROM workspace_layout_slot
         WHERE (?1 IS NULL OR workspace_id = ?1)
           AND (?2 IS NULL OR layout_id = ?2)
         ORDER BY workspace_id ASC, layout_id ASC`,
      )
      .all(input.workspaceId ?? null, input.layoutId ?? null) as WorkspaceLayoutSlotRow[];
    const existingKeys = new Set(rows.map((row) => `${row.workspace_id}:${row.layout_id}`));
    const workspaceIds = new Set<string>();
    if (input.workspaceId) workspaceIds.add(input.workspaceId);
    for (const tab of [...tabs, ...knownWorkspaces]) workspaceIds.add(tab.workspaceId);
    if (workspaceIds.size === 0) workspaceIds.add(this.workspace.id);
    const layoutIds: WorkspaceLayoutSlotId[] = input.layoutId ? [input.layoutId] : ["A", "B", "C"];
    const defaultLayouts = [...workspaceIds].flatMap((workspaceId) =>
      layoutIds
        .filter((layoutId) => !existingKeys.has(`${workspaceId}:${layoutId}`))
        .map((layoutId) => this.defaultWorkspaceLayoutSlot(workspaceId, layoutId)),
    );
    return {
      activeWorkspaceTabId: state?.active_workspace_tab_id ?? null,
      tabs,
      knownWorkspaces,
      layouts: [...rows.map((row) => this.mapWorkspaceLayoutSlot(row)), ...defaultLayouts],
      stateRevision: this.readStateRevision(),
    };
  }

  setWorkspaceTabs(input: SetWorkspaceTabsCommandInput): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db.query(`DELETE FROM workspace_chrome_tab`).run();
      this.insertWorkspaceChromeTabs(input.tabs, "open", updatedAt);
      this.insertWorkspaceChromeTabs(input.knownWorkspaces, "known", updatedAt);
      this.db
        .query(
          `INSERT INTO workspace_chrome_state (id, active_workspace_tab_id, updated_at)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             active_workspace_tab_id = excluded.active_workspace_tab_id,
             updated_at = excluded.updated_at`,
        )
        .run(input.activeWorkspaceTabId, updatedAt);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  selectWorkspaceTab(input: SelectWorkspaceTabCommandInput): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO workspace_chrome_state (id, active_workspace_tab_id, updated_at)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             active_workspace_tab_id = excluded.active_workspace_tab_id,
             updated_at = excluded.updated_at`,
        )
        .run(input.workspaceTabId, updatedAt);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  selectWorkspaceLayoutSlot(
    input: SelectWorkspaceLayoutSlotCommandInput,
  ): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE workspace_chrome_tab
           SET active_layout_id = ?, updated_at = ?
           WHERE workspace_tab_id = ?`,
        )
        .run(input.layoutId, updatedAt, input.workspaceTabId);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  saveWorkspaceLayoutSnapshot(
    input: SaveWorkspaceLayoutSnapshotCommandInput,
  ): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.upsertWorkspaceLayoutSlot({
        workspaceId: input.workspaceId,
        layoutId: input.layoutId,
        initialized: true,
        snapshotJson: input.snapshotJson as JsonValue,
        focusedPaneId: input.focusedPaneId ?? null,
        panelMetadata: input.panelMetadata as unknown as JsonValue[],
        updatedAt,
      });
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  updateWorkspacePane(input: UpdateWorkspacePaneCommandInput): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      const current = this.findWorkspaceLayoutSlot(input.workspaceId, input.layoutId);
      const currentMetadata = current
        ? this.mapWorkspaceLayoutSlot(current).panelMetadata
        : ([] as JsonValue[]);
      const nextMetadata = currentMetadata.map((pane) => {
        if (!pane || typeof pane !== "object" || Array.isArray(pane)) return pane;
        const record = pane as Record<string, unknown>;
        if (record.paneId !== input.paneId) return pane;
        return { ...record, ...input.patch } as JsonValue;
      });
      const hasPane = nextMetadata.some(
        (pane) =>
          pane &&
          typeof pane === "object" &&
          !Array.isArray(pane) &&
          (pane as Record<string, unknown>).paneId === input.paneId,
      );
      const panelMetadata = hasPane
        ? nextMetadata
        : [...nextMetadata, { paneId: input.paneId, kind: "static", target: input.patch }];
      this.upsertWorkspaceLayoutSlot({
        workspaceId: input.workspaceId,
        layoutId: input.layoutId,
        initialized: true,
        snapshotJson: current ? fromJson<JsonValue>(current.snapshot_json) : null,
        focusedPaneId: current?.focused_pane_id ?? null,
        panelMetadata,
        updatedAt,
      });
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  closeWorkspacePane(input: CloseWorkspacePaneCommandInput): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      const current = this.findWorkspaceLayoutSlot(input.workspaceId, input.layoutId);
      const panelMetadata = current
        ? this.mapWorkspaceLayoutSlot(current).panelMetadata.filter(
            (pane) =>
              !(
                pane &&
                typeof pane === "object" &&
                !Array.isArray(pane) &&
                (pane as Record<string, unknown>).paneId === input.paneId
              ),
          )
        : [];
      this.upsertWorkspaceLayoutSlot({
        workspaceId: input.workspaceId,
        layoutId: input.layoutId,
        initialized: true,
        snapshotJson: current ? fromJson<JsonValue>(current.snapshot_json) : null,
        focusedPaneId:
          current?.focused_pane_id === input.paneId ? null : (current?.focused_pane_id ?? null),
        panelMetadata,
        updatedAt,
      });
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
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
    return this.updateAgentProfileUsage(
      input.actor === "handler" ? "handler" : "orchestrator",
      input.profileId,
      {
        [input.extensionId]: input.usage,
      },
    );
  }

  promoteProfileExtensionDefault(
    input: PromoteProfileExtensionDefaultCommandInput,
  ): StructuredMutationCommitRecord {
    return this.updateAgentProfileUsage("orchestrator", input.profileId, {
      [input.extensionId]: input.usage,
    });
  }

  resetActorExtensionDefaults(input: {
    actor: ResetActorExtensionDefaultsCommandInput["actor"];
    reset: ResetActorExtensionDefaultsCommandInput["reset"];
  }): StructuredMutationCommitRecord {
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      const actor = input.actor === "workflow-task" ? "orchestrator" : input.actor;
      if (input.reset === "usage" || input.reset === "usage-and-order") {
        this.db
          .query(
            `UPDATE agent_profile SET extension_usage_json = '{}', updated_at = ? WHERE actor = ?`,
          )
          .run(updatedAt, actor);
      }
      if (input.reset === "order" || input.reset === "usage-and-order") {
        this.db
          .query(
            `UPDATE agent_profile SET extension_order_json = '[]', updated_at = ? WHERE actor = ?`,
          )
          .run(updatedAt, actor);
      }
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

  hasSnippetRows(workspaceId?: string): boolean {
    const row = this.db
      .query(
        `SELECT 1 AS found FROM snippet
         WHERE deleted_at IS NULL AND (?1 IS NULL OR workspace_id = ?1)
         LIMIT 1`,
      )
      .get(workspaceId ?? null) as { found: number } | undefined;
    return Boolean(row);
  }

  listSnippets(input: { workspaceId?: string } = {}): StructuredSnippetRecord[] {
    return (
      this.db
        .query(
          `SELECT * FROM snippet
         WHERE deleted_at IS NULL AND (?1 IS NULL OR workspace_id = ?1)
         ORDER BY source ASC, title ASC, snippet_id ASC`,
        )
        .all(input.workspaceId ?? null) as SnippetRow[]
    ).map((row) => this.mapSnippet(row));
  }

  createManagedSnippet(input: CreateManagedSnippetCommandInput): StructuredSnippetRecord & {
    stateRevision: StateRevision;
  } {
    const now = this.now();
    const snippetId = this.createId("snippet");
    const workspaceId = input.workspaceId ?? this.workspace.id;
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
          workspaceId,
          input.title.trim(),
          input.body,
          JSON.stringify(input.metadata ?? {}),
          input.enabled ? 1 : 0,
          now,
          now,
        );
      return this.bumpStateRevision();
    })();
    return { ...this.mustFindSnippet(snippetId), stateRevision };
  }

  updateManagedSnippet(input: UpdateManagedSnippetCommandInput): StructuredMutationCommitRecord {
    const current = this.mustFindSnippet(input.snippetId);
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE snippet
           SET title = ?, body = ?, metadata_json = ?, enabled = ?, updated_at = ?
           WHERE snippet_id = ? AND source = 'svvy' AND deleted_at IS NULL`,
        )
        .run(
          input.patch.title ?? current.title,
          input.patch.body ?? current.body,
          JSON.stringify(input.patch.metadata ?? current.metadata ?? {}),
          (input.patch.enabled ?? current.enabled) ? 1 : 0,
          updatedAt,
          input.snippetId,
        );
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  deleteManagedSnippet(input: DeleteManagedSnippetCommandInput): StructuredMutationCommitRecord {
    this.mustFindSnippet(input.snippetId);
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE snippet
           SET deleted_at = ?, updated_at = ?
           WHERE snippet_id = ? AND source = 'svvy' AND deleted_at IS NULL`,
        )
        .run(updatedAt, updatedAt, input.snippetId);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
  }

  setSnippetEnabled(input: SetSnippetEnabledCommandInput): StructuredMutationCommitRecord {
    this.mustFindSnippet(input.snippetId);
    const updatedAt = this.now();
    const stateRevision = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE snippet
           SET enabled = ?, updated_at = ?
           WHERE snippet_id = ? AND deleted_at IS NULL`,
        )
        .run(input.enabled ? 1 : 0, updatedAt, input.snippetId);
      return this.bumpStateRevision();
    })();
    return { updatedAt, stateRevision };
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
    const stateRevision = this.db.transaction(() => {
      this.upsertPiSession({
        sessionId,
        title,
        ...(input.profileId ? { orchestratorAgentProfileId: input.profileId } : {}),
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
      const existing = this.findRuntimeSourceFact(input.scope, input.sourceKind, input.sourceId);
      if (
        input.previousSourceVersion !== undefined &&
        input.previousSourceVersion !== null &&
        existing?.sourceVersion !== input.previousSourceVersion
      ) {
        throw new Error(
          `Runtime source ${input.sourceKind}:${input.sourceId} has version ${
            existing?.sourceVersion ?? "none"
          }, not ${input.previousSourceVersion}.`,
        );
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
          input.sourceCommandId ?? null,
          existing?.createdAt ?? input.savedAt,
          input.savedAt,
        );
      this.bumpStateRevision();
      return this.mustFindRuntimeSourceFact(input.scope, input.sourceKind, input.sourceId);
    })();
  }

  recordRuntimeSourceDelete(input: RecordRuntimeSourceDeleteInput): RuntimeSourceFactRecord {
    return this.db.transaction(() => {
      const existing = this.mustFindRuntimeSourceFact(
        input.scope,
        input.sourceKind,
        input.sourceId,
      );
      if (
        input.expectedSourceVersion !== undefined &&
        input.expectedSourceVersion !== null &&
        existing.sourceVersion !== input.expectedSourceVersion
      ) {
        throw new Error(
          `Runtime source ${input.sourceKind}:${input.sourceId} has version ${existing.sourceVersion}, not ${input.expectedSourceVersion}.`,
        );
      }
      this.db
        .query(
          `UPDATE runtime_source_fact
           SET source_command_id = ?,
               updated_at = ?,
               deleted_at = ?
           WHERE scope_key = ? AND source_kind = ? AND source_id = ?`,
        )
        .run(
          input.sourceCommandId ?? existing.sourceCommandId,
          input.deletedAt,
          input.deletedAt,
          runtimeSourceScopeKey(input.scope),
          input.sourceKind,
          input.sourceId,
        );
      this.bumpStateRevision();
      return this.mustFindRuntimeSourceFact(input.scope, input.sourceKind, input.sourceId);
    })();
  }

  recordRuntimeSourceScan(input: RecordRuntimeSourceScanInput): RuntimeSourceScanFactRecord {
    assertRuntimeSourceScanScopeMatchesDomain(input);
    return this.db.transaction(() => {
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
      this.bumpStateRevision();
      return this.mustFindRuntimeSourceScanFact(input.scope, input.domain);
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pi.sessionId,
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
    aggregateCacheKey: string;
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
               aggregate_cache_key = ?,
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
          input.aggregateCacheKey,
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
           aggregate_cache_key,
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.surfacePiSessionId,
        input.ownerKind,
        input.ownerId,
        input.actorKind,
        input.aggregateCacheKey,
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
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turnId,
        input.sessionId,
        input.surfacePiSessionId,
        threadId,
        input.requestSummary,
        "pending",
        "running",
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

  finishTurn(input: {
    turnId: string;
    status: Exclude<StructuredTurnStatus, "running">;
  }): StructuredTurnRecord {
    const existing = this.mustFindTurnRow(input.turnId);
    const timestamp = this.now();
    const finishedAt = input.status === "waiting" ? null : timestamp;
    this.db
      .query(
        `UPDATE turn
         SET status = ?, updated_at = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(input.status, timestamp, finishedAt, input.turnId);

    this.recordEvent({
      sessionId: existing.session_id,
      kind:
        input.status === "waiting"
          ? "turn.waiting"
          : input.status === "failed"
            ? "turn.failed"
            : "turn.completed",
      subjectKind: "turn",
      subjectId: input.turnId,
      at: timestamp,
    });

    return this.mustFindTurnRecord(input.turnId);
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
            aggregateCacheKey: bindingInput.aggregateCacheKey,
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

    const timestamp = this.now();
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

  clearSessionWait(input: { sessionId: string }): void {
    const existing = this.mustFindSessionRow(input.sessionId);
    if (!this.mapSessionWait(existing)) {
      return;
    }

    const timestamp = this.now();
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

  createOrReuseStreamingCommand(input: {
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
  }): StructuredCommandRecord {
    const existing = this.findCommandByToolCallId(input.toolCallId);
    if (existing) {
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
      return this.mustFindCommandRecord(existing.id);
    }
    return this.createCommand({
      ...input,
      facts: { ...input.facts, toolCallId: input.toolCallId },
    });
  }

  updateCommandArguments(commandId: string, args: unknown): StructuredCommandRecord {
    const existing = this.mustFindCommandRow(commandId);
    const timestamp = this.now();
    this.db
      .query(`UPDATE command SET arguments_json = ?, updated_at = ? WHERE id = ?`)
      .run(args === undefined ? null : toJson(args), timestamp, commandId);
    void existing;
    return this.mustFindCommandRecord(commandId);
  }

  startCommand(commandId: string): StructuredCommandRecord {
    const existing = this.mustFindCommandRow(commandId);
    const timestamp = this.now();
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
    return this.mustFindCommandRecord(commandId);
  }

  finishCommand(input: {
    commandId: string;
    status: Exclude<StructuredCommandStatus, "requested" | "running">;
    visibility?: StructuredCommandVisibility;
    summary?: string;
    facts?: Record<string, unknown> | null;
    error?: string | null;
  }): StructuredCommandRecord {
    const existing = this.mustFindCommandRow(input.commandId);
    if (TERMINAL_COMMAND_STATUSES.has(existing.status as StructuredCommandStatus)) {
      return this.mustFindCommandRecord(input.commandId);
    }
    const timestamp = this.now();
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

    return this.mustFindCommandRecord(input.commandId);
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
      aggregateCacheKey: string;
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
          aggregateCacheKey: input.generatedAgentContextBinding.aggregateCacheKey,
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
        aggregateCacheKey: input.generatedAgentContextBinding.aggregateCacheKey,
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
    this.mustFindSessionRow(input.sessionId);
    this.mustFindTurnRow(input.turnId);
    this.mustFindCommandRow(input.commandId);
    if (input.threadId) {
      this.mustFindThreadRow(input.threadId);
    }
    if (input.questions.length < 1 || input.questions.length > 3) {
      throw new Error("Request user input requires one to three questions.");
    }

    const requestId = this.createId("rui");
    const timestamp = this.now();
    const timeout =
      input.timeout && input.variant === "blocking"
        ? {
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
    this.mustFindSessionRow(input.sessionId);
    if (input.turnId) {
      this.mustFindTurnRow(input.turnId);
    }
    if (input.commandId) {
      this.mustFindCommandRow(input.commandId);
    }
    if (input.threadId) {
      this.mustFindThreadRow(input.threadId);
    }
    const requestId = this.createId("apr");
    const timestamp = this.now();
    const insert = this.db.transaction(() => {
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
  }): StructuredRuntimeApprovalRequestRecord {
    const existing = this.getRuntimeApprovalRequest(input.requestId);
    if (existing.status !== "pending") {
      throw new Error("Runtime approval request is no longer pending.");
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
      .run(input.status, input.decisionReason ?? null, input.reviewer, timestamp, input.requestId);
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
    return this.getRuntimeApprovalRequest(input.requestId);
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
  }): {
    request: StructuredRequestUserInputRequestRecord;
    answer: StructuredRequestUserInputAnswerRecord;
    queuedMessage: StructuredSurfaceQueuedMessageRecord | null;
  } {
    const request = this.mustFindRequestUserInputRequestRecord(input.requestId);
    if (request.surfacePiSessionId !== input.surfacePiSessionId) {
      throw new Error("Request user input answer does not belong to the target surface.");
    }
    if (request.status !== "open") {
      throw new Error("Request user input request is no longer answerable.");
    }
    const question = request.questions.find((entry) => entry.questionId === input.questionId);
    if (!question || question.requestId !== request.requestId) {
      throw new Error("Request user input question does not belong to the request.");
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
           ) VALUES (?, ?, ?, ?, 'user', ?, NULL, ?)`,
        )
        .run(
          answerId,
          request.requestId,
          question.questionId,
          toJson(userAnswer),
          input.delivery,
          timestamp,
        );
      this.db
        .query(
          `UPDATE request_user_input_question
           SET status = 'answered'
           WHERE id = ?`,
        )
        .run(question.questionId);

      const remainingOpen = this.db
        .query(
          `SELECT COUNT(*) AS count
           FROM request_user_input_question
           WHERE request_id = ? AND status = 'open'`,
        )
        .get(request.requestId) as { count: number };
      if (remainingOpen.count === 0) {
        this.db
          .query(
            `UPDATE request_user_input_request
             SET status = 'completed',
                 completed_at = ?
             WHERE id = ?`,
          )
          .run(timestamp, request.requestId);
      }

      if (request.variant === "blocking") {
        return null;
      }

      const queuedMessage = this.enqueueSurfaceMessage({
        sessionId: request.sessionId,
        surfacePiSessionId: request.surfacePiSessionId,
        threadId: request.threadId,
        kind: "request_user_input_answer",
        idempotencyKey: `request_user_input_answer:${answerId}`,
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
      return queuedMessage;
    })();
    const deliveredQueuedMessage =
      result && input.delivery === "enqueue-and-run"
        ? this.markSurfaceMessageSteering({ id: result.id })
        : result;

    return {
      request: this.mustFindRequestUserInputRequestRecord(request.requestId),
      answer: this.mustFindRequestUserInputAnswerRecord(answerId),
      queuedMessage: deliveredQueuedMessage,
    };
  }

  defaultOpenRequestUserInputQuestions(input: {
    requestId: string;
    answeredBy: "timeout_default";
  }): StructuredRequestUserInputRequestRecord {
    const request = this.mustFindRequestUserInputRequestRecord(input.requestId);
    if (request.status !== "open") {
      return request;
    }
    const openQuestions = request.questions.filter((question) => question.status === "open");
    if (openQuestions.length === 0) {
      return request;
    }
    const timestamp = this.now();
    const defaultOpenQuestions = this.db.transaction(() => {
      for (const question of openQuestions) {
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
        this.db
          .query(
            `UPDATE request_user_input_question
             SET status = 'defaulted'
             WHERE id = ?`,
          )
          .run(question.questionId);
      }

      this.db
        .query(
          `UPDATE request_user_input_request
           SET status = 'expired',
               completed_at = ?
           WHERE id = ?`,
        )
        .run(timestamp, request.requestId);
    });
    defaultOpenQuestions();
    return this.mustFindRequestUserInputRequestRecord(request.requestId);
  }

  cancelRequestUserInputRequest(input: {
    requestId: string;
  }): StructuredRequestUserInputRequestRecord {
    const request = this.mustFindRequestUserInputRequestRecord(input.requestId);
    if (request.status !== "open") {
      return request;
    }
    const timestamp = this.now();
    const cancelRequest = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE request_user_input_question
           SET status = 'cancelled'
           WHERE request_id = ? AND status = 'open'`,
        )
        .run(request.requestId);
      this.db
        .query(
          `UPDATE request_user_input_request
           SET status = 'cancelled',
               completed_at = ?
           WHERE id = ?`,
        )
        .run(timestamp, request.requestId);
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
    });
    cancelRequest();
    return this.mustFindRequestUserInputRequestRecord(request.requestId);
  }

  setRequestUserInputTimerPaused(input: {
    surfacePiSessionId: string;
    requestId: string;
    paused: boolean;
  }): StructuredRequestUserInputRequestRecord {
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
      return request;
    }
    if (!input.paused && !request.timeout.pausedAt) {
      return request;
    }

    const timestamp = this.now();
    const timeout = input.paused
      ? {
          ...request.timeout,
          pausedAt: timestamp,
          remainingMsWhenPaused: Math.max(
            0,
            Date.parse(request.timeout.expiresAt ?? timestamp) - Date.parse(timestamp),
          ),
          expiresAt: null,
        }
      : {
          ...request.timeout,
          pausedAt: null,
          remainingMsWhenPaused: null,
          expiresAt: new Date(
            Date.parse(timestamp) + (request.timeout.remainingMsWhenPaused ?? 0),
          ).toISOString(),
        };

    const updateTimer = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE request_user_input_request
           SET timeout_json = ?
           WHERE id = ?`,
        )
        .run(toJson(timeout), request.requestId);
      return this.mustFindRequestUserInputRequestRecord(request.requestId);
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
  } {
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = this.db
        .query(
          `SELECT * FROM surface_message_queue
           WHERE surface_pi_session_id = ?
             AND idempotency_key = ?
             AND status NOT IN ('delivered', 'cancelled')
           LIMIT 1`,
        )
        .get(input.target.surfacePiSessionId, idempotencyKey) as
        | SurfaceQueuedMessageRow
        | undefined;
      if (existing) {
        return {
          queuedMessage: this.mapSurfaceQueuedMessage(existing),
          accepted: "existing",
          draftCleared: false,
        };
      }
    }

    const accept = this.db.transaction(() => {
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
      };
    });

    return accept();
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
    return this.mustFindGeneratedPackageFact(input.status.packageName);
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
    const existing = this.findExtensionDependencyReadinessRow(
      input.readiness.extensionId,
      input.readiness.requirementId,
    );
    this.db
      .query(
        `INSERT INTO extension_dependency_readiness (
           extension_id,
           requirement_id,
           status,
           detected_version,
           expected_version,
           diagnostics_json,
           checked_at,
           source_command_id,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(extension_id, requirement_id) DO UPDATE SET
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
      const kindFilter =
        kinds.length > 0 ? ` AND kind IN (${kinds.map(() => "?").join(", ")})` : "";
      const scopeFilter = scope ? "scope_kind = ? AND workspace_id IS ? AND " : "";
      const candidates = this.db
        .query(
          `SELECT * FROM recovery_work
           WHERE ${scopeFilter}status = 'pending'
             AND available_at <= ?${kindFilter}
           ORDER BY priority ASC, available_at ASC, ordering_key ASC, ordering_seq ASC, created_at ASC
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
  }): StructuredRecoveryWorkRecord {
    const row = this.mustFindRecoveryWorkRow(input.id);
    const timestamp = this.now();
    const status: StructuredRecoveryWorkStatus =
      row.attempts >= row.max_attempts ? "failed" : "pending";
    const availableAt =
      status === "pending"
        ? new Date(Date.parse(timestamp) + Math.min(row.attempts + 1, 5) * 1000).toISOString()
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
             workspace_tab_id, workspace_id, cwd, opened_at, active_layout_id,
             tab_kind, position, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tab.workspaceTabId,
          tab.workspaceId,
          tab.cwd,
          tab.openedAt,
          tab.activeLayoutId,
          tabKind,
          index,
          updatedAt,
        );
    });
  }

  private defaultWorkspaceLayoutSlot(
    workspaceId: string,
    layoutId: WorkspaceLayoutSlotId,
  ): StructuredWorkspaceLayoutSlotRecord {
    return {
      workspaceId,
      layoutId,
      initialized: false,
      snapshotJson: null,
      focusedPaneId: null,
      panelMetadata: [],
      updatedAt: this.now(),
    };
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
           workspace_id, layout_id, initialized, snapshot_json, focused_pane_id,
           panel_metadata_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, layout_id) DO UPDATE SET
           initialized = excluded.initialized,
           snapshot_json = excluded.snapshot_json,
           focused_pane_id = excluded.focused_pane_id,
           panel_metadata_json = excluded.panel_metadata_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.workspaceId,
        input.layoutId,
        input.initialized ? 1 : 0,
        input.snapshotJson === null ? null : JSON.stringify(input.snapshotJson),
        input.focusedPaneId,
        JSON.stringify(input.panelMetadata),
        input.updatedAt,
      );
  }

  private mapWorkspaceLayoutSlot(row: WorkspaceLayoutSlotRow): StructuredWorkspaceLayoutSlotRecord {
    return {
      workspaceId: row.workspace_id,
      layoutId: row.layout_id,
      initialized: row.initialized !== 0,
      snapshotJson: fromJson<JsonValue>(row.snapshot_json),
      focusedPaneId: row.focused_pane_id,
      panelMetadata: fromJson<JsonValue[]>(row.panel_metadata_json) ?? [],
      updatedAt: row.updated_at,
    };
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
    patch: Record<string, ExtensionUsageState>,
  ): StructuredMutationCommitRecord {
    const row = this.findAgentProfileRow(actor, profileId);
    const updatedAt = this.now();
    const currentUsage = row
      ? (fromJson<Record<string, ExtensionUsageState>>(row.extension_usage_json) ?? {})
      : {};
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
        .run(profileId, actor, profileId, JSON.stringify({ ...currentUsage, ...patch }), updatedAt);
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

  private mustFindSnippet(snippetId: string): StructuredSnippetRecord {
    const row = this.db
      .query(`SELECT * FROM snippet WHERE snippet_id = ? AND deleted_at IS NULL`)
      .get(snippetId) as SnippetRow | undefined;
    if (!row) {
      throw new Error(`Snippet ${snippetId} was not found.`);
    }
    return this.mapSnippet(row);
  }

  private mapSnippet(row: SnippetRow): StructuredSnippetRecord {
    return {
      id: row.snippet_id,
      workspaceId: row.workspace_id,
      source: row.source,
      title: row.title,
      body: row.body,
      metadata: fromJson<JsonValue>(row.metadata_json) ?? {},
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
      aggregateCacheKey: row.aggregate_cache_key,
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

  private mapTurn(row: TurnRow): StructuredTurnRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      requestSummary: row.request_summary,
      turnDecision: row.turn_decision,
      status: row.status,
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
      snapshot_json TEXT,
      focused_pane_id TEXT,
      panel_metadata_json TEXT NOT NULL DEFAULT '[]',
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

    CREATE TABLE IF NOT EXISTS extension_env_override (
      extension_id TEXT NOT NULL,
      env_name TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(extension_id, env_name)
    );

    CREATE TABLE IF NOT EXISTS snippet (
      snippet_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      path TEXT,
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
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

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
      aggregate_cache_key TEXT NOT NULL,
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
      created_at TEXT NOT NULL
    );

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
  ensureColumn(db, "workspace_chrome_state", "active_workspace_tab_id", "TEXT");
  ensureColumn(db, "workspace_chrome_state", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "workspace_chrome_tab", "active_layout_id", "TEXT NOT NULL DEFAULT 'A'");
  ensureColumn(db, "workspace_chrome_tab", "tab_kind", "TEXT NOT NULL DEFAULT 'open'");
  ensureColumn(db, "workspace_chrome_tab", "position", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "workspace_chrome_tab", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "workspace_layout_slot", "initialized", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "workspace_layout_slot", "snapshot_json", "TEXT");
  ensureColumn(db, "workspace_layout_slot", "focused_pane_id", "TEXT");
  ensureColumn(db, "workspace_layout_slot", "panel_metadata_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "agent_profile", "reasoning_json", "TEXT");
  ensureColumn(db, "agent_profile", "follow_composer", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "agent_profile", "extension_usage_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "agent_profile", "extension_order_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "agent_profile", "position", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "extension_env_override", "value", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "snippet", "enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "snippet", "path", "TEXT");
  ensureColumn(db, "snippet", "updated_at", "TEXT");
  ensureColumn(db, "snippet", "deleted_at", "TEXT");
  db.exec(`INSERT INTO state_revision (id, revision) VALUES (1, 0) ON CONFLICT(id) DO NOTHING`);
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
    `CREATE INDEX IF NOT EXISTS idx_generated_package_fact_status
     ON generated_package_fact (status, updated_at)`,
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
    `CREATE INDEX IF NOT EXISTS idx_pi_session_reference_session
     ON pi_session_reference (workspace_session_id, surface_kind)
     WHERE deleted_at IS NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_runtime_source_fact_updated
     ON runtime_source_fact (scope_key, source_kind, updated_at)`,
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
  return Boolean(leftWorkflow && rightWorkflow && leftWorkflow === rightWorkflow);
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

function decodeExternalInstructionsSettings(value: unknown): ExternalInstructionsSettings {
  const decoded = decodeUnknownExternalInstructionsSettingsExit(value);
  if (Exit.isFailure(decoded)) {
    throw new Error("INVALID_STATE: persisted external instruction settings are invalid.");
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
