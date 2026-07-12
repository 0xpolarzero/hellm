import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  AbsolutePath,
  DEFAULT_WORKFLOW_AGENT_SOURCE_IDS,
  decodeUnknownWorkspaceChromeReadModelEffect,
  decodeUnknownWorkspaceLayoutReadModelEffect,
  decodeUnknownSessionNavigationReadModelEffect,
  type AgentProfileId,
  AppLogEntryId,
  type CommandId,
  type ComposerAttachment,
  type ComposerSnippetMention,
  type AppLogEntry,
  type AppLogLevel,
  type IsoDateTimeString,
  isWorkflowAgentSourceExportName,
  type AppLogQuery,
  type AppLogReadModel,
  type AppLogSource,
  type AppLogSummary,
  type AppLogWritePort,
  type AppLogWritePortService,
  type ExtensionId,
  type ExtensionUsageState,
  type ExternalInstructionsSettings,
  type ExtensionStatePort,
  type JsonValue as JsonValueType,
  type MessageId,
  type ModelId,
  type PiSessionReferencePort,
  type PositiveSafeInteger,
  type ProviderAuthStatus,
  type ProviderAuthStatusStatePort,
  type ProviderId,
  type QueueItemId,
  type RequestInputOptionId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RequestInputSettings,
  type RuntimeApprovalId,
  type RuntimeApprovalRecord,
  type RuntimeMessageDelivery,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeSurfaceTarget,
  type RuntimeSurfaceTranscriptSnapshot,
  type RuntimeTranscriptAssistantMessage,
  type RuntimeTranscriptMessage,
  type RuntimeTranscriptStreamCursor,
  type RuntimeActorExtensionBindingStatePort,
  type RuntimeApprovalStatePort,
  type RuntimeArtifactStatePort,
  type RuntimeClientSubmissionInput,
  type RuntimeCommandStatePort,
  type RuntimeComposerDraftStatePort,
  type RuntimeEpisodeStatePort,
  type RuntimeExtensionContextImpactStatePort,
  type RuntimeExtensionStatePort,
  type RuntimeGeneratedPackageStatePort,
  type RuntimePromptDefaultsStatePort,
  type RuntimeQueueStatePort,
  type RuntimeReadModelStatePort,
  type RuntimeRecoveryStatePort,
  type RuntimeRequestStatePort,
  type RuntimeSessionWaitStatePort,
  type RuntimeSourceStatePort,
  type RuntimeSurfaceLifecycleStatePort,
  type RuntimeThreadStatePort,
  type RuntimeTurnStatePort,
  type RuntimeWorkspaceStatePort,
  type SandboxPolicySource,
  SessionNavigationSummarySchema,
  type SessionNavigationReadModel as CoreSessionNavigationReadModel,
  type SessionNavigationSummary as CoreSessionNavigationSummary,
  type StateCommandPostCommitNotificationError,
  StateCommandPostCommitNotificationPort,
  type StateCommandReceipt,
  StateContractError,
  type StateFacadeErrorContract,
  type StateInvalidationDescriptor,
  type StateMutationResult,
  type StateRevision,
  type SourceDiagnostic,
  strictBoundaryParseOptions,
  type SnippetId,
  type SnippetMetadata,
  type SnippetSource,
  type SurfacePiSessionId,
  type TaskAgentParametersSource,
  type ThreadId,
  type TurnId,
  type WorkflowTaskAttemptId,
  type WorkspaceSessionId,
  WorkspaceChromeReadModelSchema,
  type WorkspaceChromeReadModel,
  WorkspaceId,
  type WorkspaceLayoutReadModel,
  WorkspaceLayoutReadModelSchema,
  type WorkspaceLayoutSlotId,
  type WorkspaceId as WorkspaceIdType,
} from "@svvy/core";
import {
  appLogStateFromStore,
  createAppLogStore,
  AppLogState,
  layerAppLogState,
} from "./app-log-store";
import { appLogWritePortFromAppLogState } from "./app-log-write-port";
import { layerAppLogWritePort } from "./app-log-write-port";
import { mutationResult } from "./state-mutation-result";
import { structuredSessionStatePortsLayerWithSandboxPolicyConfig } from "./structured-session-state-ports-layer";
import { buildWorkspaceSessionNavigation } from "./session-navigation";
import {
  buildStructuredCommandInspector,
  buildStructuredArtifactLink,
  buildStructuredHandlerThreadInspector,
  buildStructuredSessionSummaryProjection,
  buildStructuredSessionView,
  buildStructuredWorkflowTaskAttemptInspector,
  hasStructuredSessionFacts,
  type StructuredCommandInspector,
  type StructuredHandlerThreadInspector,
  type StructuredWorkflowTaskAttemptInspector,
} from "./structured-session-selectors";
import {
  createStructuredSessionStateStore,
  structuredSessionStateFromStore,
  StructuredSessionState,
  type StateDigestHelper,
  type StructuredCommandRecord,
  type StructuredRuntimeApprovalRequestRecord,
  type StructuredSessionSnapshot,
  type StructuredAppPreferencesRecord,
  type StructuredGeneratedPackageFactRecord,
  type StructuredSurfaceQueuedMessageRecord,
  type StructuredSessionStateStore,
  type StructuredAgentProfileRecord,
  type StructuredSnippetRecord,
} from "./structured-session-state";
import type { StateLayerConfig } from "./state-layer-config";
import type { WorkspaceStateRouter } from "./workspace-state-router";
import {
  decodeUnknownClearWorkspaceAppLogUnreadCommandInputEffect,
  decodeUnknownCreateManagedSnippetCommandInputEffect,
  decodeUnknownDeleteManagedSnippetCommandInputEffect,
  decodeUnknownDeleteOrchestratorProfileCommandInputEffect,
  decodeUnknownMarkAppLogReadCommandInputEffect,
  decodeUnknownMarkSessionReadCommandInputEffect,
  decodeUnknownMarkSessionUnreadCommandInputEffect,
  decodeUnknownMarkVisibleAppLogRangeReadCommandInputEffect,
  decodeUnknownPromoteProfileExtensionDefaultCommandInputEffect,
  decodeUnknownRecordProviderAuthStatusCommandInputEffect,
  decodeUnknownRemoveExtensionEnvOverrideCommandInputEffect,
  decodeUnknownReorderOrchestratorProfilesCommandInputEffect,
  decodeUnknownResetActorExtensionDefaultsCommandInputEffect,
  decodeUnknownSetAgentActorExtensionDefaultsCommandInputEffect,
  decodeUnknownSaveWorkspaceLayoutSlotCommandInputEffect,
  decodeUnknownSelectWorkspaceLayoutSlotCommandInputEffect,
  decodeUnknownSelectWorkspaceTabCommandInputEffect,
  decodeUnknownSetExternalInstructionActorUsageCommandInputEffect,
  decodeUnknownSetExtensionEnvOverrideCommandInputEffect,
  decodeUnknownSetProfileExtensionUsageCommandInputEffect,
  decodeUnknownSetSessionArchivedCommandInputEffect,
  decodeUnknownSetSessionNavigationSectionStateCommandInputEffect,
  decodeUnknownSetSessionPinnedCommandInputEffect,
  decodeUnknownSetSnippetEnabledCommandInputEffect,
  decodeUnknownSetWorkspaceTabsCommandInputEffect,
  decodeUnknownUpdateManagedSnippetCommandInputEffect,
  decodeUnknownUpdateAppPreferencesCommandInputEffect,
  decodeUnknownUpdateOrchestratorProfileCommandInputEffect,
  decodeUnknownUpdateThreadHandlerProfileCommandInputEffect,
  type AppPreferenceAppearance,
  type AppPreferenceApprovalMode,
  type CreateManagedSnippetCommandInput,
  type DeleteManagedSnippetCommandInput,
  type DeleteOrchestratorProfileCommandInput,
  type ClearWorkspaceAppLogUnreadCommandInput,
  type MarkAppLogReadCommandInput,
  type MarkSessionReadCommandInput,
  type MarkSessionUnreadCommandInput,
  type MarkVisibleAppLogRangeReadCommandInput,
  type PromoteProfileExtensionDefaultCommandInput,
  type RecordProviderAuthStatusCommandInput,
  type RemoveExtensionEnvOverrideCommandInput,
  type ReorderOrchestratorProfilesCommandInput,
  type ResetActorExtensionDefaultsCommandInput,
  type SetAgentActorExtensionDefaultsCommandInput,
  type SaveWorkspaceLayoutSlotCommandInput,
  type SelectWorkspaceLayoutSlotCommandInput,
  type SelectWorkspaceTabCommandInput,
  type SetExternalInstructionActorUsageCommandInput,
  type SetExtensionEnvOverrideCommandInput,
  type SetProfileExtensionUsageCommandInput,
  type SetSessionArchivedCommandInput,
  type SetSessionNavigationSectionStateCommandInput,
  type SetSessionPinnedCommandInput,
  type SetSnippetEnabledCommandInput,
  type SetWorkspaceTabsCommandInput,
  type UpdateManagedSnippetCommandInput,
  type UpdateAppPreferencesCommandInput,
  type UpdateOrchestratorProfileCommandInput,
  type UpdateThreadHandlerProfileCommandInput,
} from "./state-command-schemas";

const decodeSessionNavigationSummaryProjection = Schema.decodeUnknownEffect(
  SessionNavigationSummarySchema,
  strictBoundaryParseOptions,
);

export interface StateFacadeCallOptions {
  signal?: AbortSignal;
}

export type AppLogReadModelRequest =
  | {
      kind: "appLogs";
      workspaceId?: WorkspaceIdType;
      query?: AppLogQuery;
    }
  | {
      kind: "appLogSummary";
      workspaceId?: WorkspaceIdType;
    };

export type StateReadModelRequest =
  | AppLogReadModelRequest
  | AppPreferencesReadModelRequest
  | ProviderAuthReadModelRequest
  | SessionNavigationReadModelRequest
  | PromptHistoryReadModelRequest
  | SurfaceTranscriptReadModelRequest
  | SurfaceSummaryReadModelRequest
  | SurfaceComposerReadModelRequest
  | SurfaceQueuedMessagesReadModelRequest
  | CommandInspectorReadModelRequest
  | ArtifactInspectorReadModelRequest
  | RequestInputReadModelRequest
  | ApprovalsReadModelRequest
  | AgentsReadModelRequest
  | ExtensionsReadModelRequest
  | SnippetsReadModelRequest
  | WorkflowsGeneratedReadModelRequest
  | HandlerInspectorReadModelRequest
  | WorkflowTaskAttemptInspectorReadModelRequest
  | WorkspaceChromeReadModelRequest
  | WorkspaceLayoutReadModelRequest;

export type StateReadModelResult =
  | { kind: "appLogs"; value: AppLogReadModel }
  | { kind: "appLogSummary"; value: AppLogSummary }
  | { kind: "appPreferences"; value: AppPreferencesReadModel }
  | { kind: "settings"; value: SettingsReadModel }
  | { kind: "providerAuth"; value: ProviderAuthReadModel }
  | { kind: "sessionNavigation"; value: SessionNavigationReadModel }
  | { kind: "promptHistory"; value: PromptHistoryReadModel }
  | { kind: "surfaceTranscript"; value: SurfaceTranscriptReadModel }
  | { kind: "surfaceSummary"; value: SurfaceSummaryReadModel }
  | { kind: "surfaceComposer"; value: SurfaceComposerReadModel }
  | { kind: "surfaceQueuedMessages"; value: SurfaceQueuedMessagesReadModel }
  | { kind: "commandInspector"; value: CommandInspectorReadModel | null }
  | { kind: "artifactInspector"; value: ArtifactInspectorReadModel | null }
  | { kind: "requestInput"; value: RequestInputReadModel }
  | { kind: "approvals"; value: ApprovalsReadModel }
  | { kind: "agents"; value: AgentsReadModel }
  | { kind: "extensions"; value: ExtensionsReadModel }
  | { kind: "snippets"; value: SnippetsReadModel }
  | { kind: "workflowsGenerated"; value: WorkflowsGeneratedReadModel }
  | { kind: "handlerInspector"; value: HandlerInspectorReadModel | null }
  | { kind: "workflowTaskAttemptInspector"; value: WorkflowTaskAttemptInspectorReadModel | null }
  | { kind: "workspaceChrome"; value: WorkspaceChromeReadModel }
  | { kind: "workspaceLayout"; value: WorkspaceLayoutReadModel };

export interface AppPreferencesReadModel {
  appearance: AppPreferenceAppearance;
  externalEditor: string | null;
  artifactDirectory: string;
  approvalMode: AppPreferenceApprovalMode;
  networkAccess: boolean;
  externalInstructions: ExternalInstructionsSettings;
  ambientResources: JsonValueType;
  updatedAt: IsoDateTimeString;
  revision: StateRevision;
}

export interface SettingsReadModel {
  preferences: AppPreferencesReadModel;
  requestInput: RequestInputSettings;
}

export interface AppPreferencesReadModelRequest {
  kind: "appPreferences" | "settings";
}

export interface ProviderAuthReadModel {
  providers: readonly ProviderAuthStatus[];
  usableModelProviders: readonly ProviderId[];
}

export interface ProviderAuthReadModelRequest {
  kind: "providerAuth";
  workspaceId?: WorkspaceIdType;
}

export const StateReadModelRequestSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("appLogs"),
    workspaceId: Schema.optionalKey(Schema.String),
    query: Schema.optionalKey(Schema.Json),
  }),
  Schema.Struct({
    kind: Schema.Literal("appLogSummary"),
    workspaceId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("appPreferences") }),
  Schema.Struct({ kind: Schema.Literal("settings") }),
  Schema.Struct({
    kind: Schema.Literal("providerAuth"),
    workspaceId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("sessionNavigation"),
    workspaceId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("promptHistory"),
    workspaceId: WorkspaceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("surfaceTranscript"),
    target: Schema.Json,
    afterMessageId: Schema.optionalKey(Schema.String),
    limit: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({ kind: Schema.Literal("surfaceSummary"), target: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceComposer"), target: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceQueuedMessages"), target: Schema.Json }),
  Schema.Struct({
    kind: Schema.Literal("commandInspector"),
    workspaceId: WorkspaceId,
    commandId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("artifactInspector"),
    workspaceId: WorkspaceId,
    workspaceSessionId: Schema.String,
    artifactId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("requestInput"),
    workspaceId: Schema.optionalKey(Schema.String),
    surfacePiSessionId: Schema.optionalKey(Schema.String),
    requestId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("approvals"),
    workspaceId: Schema.optionalKey(Schema.String),
    surfacePiSessionId: Schema.optionalKey(Schema.String),
    requestId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("agents"),
    profileId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("extensions"),
    extensionId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("snippets"),
    workspaceId: Schema.String,
    snippetId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("workflowsGenerated"),
    buildId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("handlerInspector"),
    workspaceId: WorkspaceId,
    threadId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("workflowTaskAttemptInspector"),
    workspaceId: WorkspaceId,
    workflowTaskAttemptId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("workspaceChrome"),
  }),
  Schema.Struct({
    kind: Schema.Literal("workspaceLayout"),
    workspaceId: WorkspaceId,
  }),
]);

export const StateReadModelResultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("appLogs"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("appLogSummary"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("appPreferences"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("settings"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("providerAuth"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("sessionNavigation"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("promptHistory"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceTranscript"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceSummary"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceComposer"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceQueuedMessages"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("commandInspector"), value: Schema.NullOr(Schema.Json) }),
  Schema.Struct({ kind: Schema.Literal("artifactInspector"), value: Schema.NullOr(Schema.Json) }),
  Schema.Struct({ kind: Schema.Literal("requestInput"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("approvals"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("agents"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("extensions"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("snippets"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("workflowsGenerated"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("handlerInspector"), value: Schema.NullOr(Schema.Json) }),
  Schema.Struct({
    kind: Schema.Literal("workflowTaskAttemptInspector"),
    value: Schema.NullOr(Schema.Json),
  }),
  Schema.Struct({ kind: Schema.Literal("workspaceChrome"), value: WorkspaceChromeReadModelSchema }),
  Schema.Struct({ kind: Schema.Literal("workspaceLayout"), value: WorkspaceLayoutReadModelSchema }),
]);

export interface SessionNavigationReadModelRequest {
  kind: "sessionNavigation";
  workspaceId?: WorkspaceIdType;
}

export interface PromptHistoryReadModelRequest {
  kind: "promptHistory";
  workspaceId: WorkspaceIdType;
}

export interface PromptHistoryReadModel {
  workspaceId: WorkspaceIdType;
  entries: readonly PromptHistoryReadModelEntry[];
}

export interface PromptHistoryReadModelEntry {
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  queueItemId: QueueItemId;
  text: string;
  sentAt: IsoDateTimeString;
}

export interface SurfaceTranscriptReadModelRequest {
  kind: "surfaceTranscript";
  target: RuntimeSurfaceTarget;
  afterMessageId?: MessageId;
  limit?: PositiveSafeInteger;
}

export interface SurfaceSummaryReadModelRequest {
  kind: "surfaceSummary";
  target: RuntimeSurfaceTarget;
}

export interface SurfaceComposerReadModelRequest {
  kind: "surfaceComposer";
  target: RuntimeSurfaceTarget;
}

export interface SurfaceQueuedMessagesReadModelRequest {
  kind: "surfaceQueuedMessages";
  target: RuntimeSurfaceTarget;
}

export interface CommandInspectorReadModelRequest {
  kind: "commandInspector";
  workspaceId: WorkspaceIdType;
  commandId: CommandId;
}

export interface ArtifactInspectorReadModelRequest {
  kind: "artifactInspector";
  workspaceId: WorkspaceIdType;
  workspaceSessionId: WorkspaceSessionId;
  artifactId: string;
}

export interface ArtifactInspectorReadModel {
  artifactId: string;
  workspaceSessionId: WorkspaceSessionId;
  kind: "text" | "log" | "json" | "file";
  name: string;
  path?: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  immutable: boolean;
  createdAt: string;
  deletedAt: string | null;
  sourceCommandId?: string;
  workflowRunId?: string;
  workflowName?: string;
  producerLabel?: string;
}

export interface RequestInputReadModelRequest {
  kind: "requestInput";
  workspaceId?: WorkspaceIdType;
  surfacePiSessionId?: SurfacePiSessionId;
  requestId?: RequestInputRequestId;
}

export interface ApprovalsReadModelRequest {
  kind: "approvals";
  workspaceId?: WorkspaceIdType;
  surfacePiSessionId?: SurfacePiSessionId;
  requestId?: RuntimeApprovalId;
}

export interface AgentsReadModelRequest {
  kind: "agents";
  profileId?: string;
}

export interface ExtensionsReadModelRequest {
  kind: "extensions";
  extensionId?: string;
}

export interface SnippetsReadModelRequest {
  kind: "snippets";
  workspaceId: WorkspaceIdType;
  snippetId?: string;
}

export interface WorkflowsGeneratedReadModelRequest {
  kind: "workflowsGenerated";
  buildId?: string;
}

export interface HandlerInspectorReadModelRequest {
  kind: "handlerInspector";
  workspaceId: WorkspaceIdType;
  threadId: string;
}

export interface WorkflowTaskAttemptInspectorReadModelRequest {
  kind: "workflowTaskAttemptInspector";
  workspaceId: WorkspaceIdType;
  workflowTaskAttemptId: string;
}

export interface WorkspaceChromeReadModelRequest {
  kind: "workspaceChrome";
}

export interface WorkspaceLayoutReadModelRequest {
  kind: "workspaceLayout";
  workspaceId: WorkspaceIdType;
}

export type SessionNavigationReadModel = CoreSessionNavigationReadModel;

export type SessionNavigationSummary = CoreSessionNavigationSummary;

export interface SurfaceTranscriptReadModel {
  target: RuntimeSurfaceTarget;
  surfaceStatus: "idle" | "running" | "waiting" | "error";
  promptLock: { activeTurnId: TurnId | null; queuedCount: number };
  composerDraft: { text: string; attachmentIds: readonly string[] };
  messages: readonly RuntimeTranscriptMessage[];
  activeAssistantMessage: RuntimeTranscriptAssistantMessage | null;
  streamCursor: RuntimeTranscriptStreamCursor | null;
}

export interface SurfaceSummaryReadModel {
  target: RuntimeSurfaceTarget;
  title: string;
  status: SurfaceTranscriptReadModel["surfaceStatus"];
  activeTurnId: TurnId | null;
  activeTurnStartedAt: IsoDateTimeString | null;
  queuedCount: number;
  model: string;
  provider: string;
  reasoningEffort: string;
  agentProfileId: string;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
}

export interface SurfaceComposerReadModel {
  target: RuntimeSurfaceTarget;
  draft: {
    text: string;
    attachments: readonly ComposerAttachment[];
    snippetMentions: readonly ComposerSnippetMention[];
    updatedAt: IsoDateTimeString | null;
  };
}

export interface SurfaceQueuedMessagesReadModel {
  target: RuntimeSurfaceTarget;
  queuedMessages: readonly {
    id: QueueItemId;
    kind: StructuredSurfaceQueuedMessageRecord["kind"];
    text: string;
    title?: string;
    summary?: string;
    threadId?: string;
    episodeId?: string;
    sourceCommandId?: CommandId;
    status: "queued" | "steering" | "dispatching" | "failed";
    failureError?: string;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
  }[];
}

export interface CommandInspectorReadModel extends StructuredCommandInspector {
  target: RuntimeSurfaceTarget;
  acceptedArguments: JsonValueType;
}

export interface RequestInputReadModel {
  requests: RequestInputReadModelRequestItem[];
}

export type WorkspaceRequestInputDelivery = RuntimeMessageDelivery;

export interface RequestInputReadModelRequestItem {
  requestId: RequestInputRequestId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId: string | null;
  ownerTitle: string;
  variant: "nonblocking" | "blocking";
  status: "open" | "completed" | "cancelled" | "expired";
  createdAt: IsoDateTimeString;
  completedAt: IsoDateTimeString | null;
  timeout: RuntimeRequestInputDetailsRecord["timeout"];
  questions: {
    questionId: RequestInputQuestionId;
    ordinal: number;
    title: string;
    question: string;
    defaultAnswer:
      | { kind: "option"; label: string; text: string }
      | { kind: "custom"; text: string };
    choices: {
      optionId: RequestInputOptionId;
      ordinal: number;
      label: string;
      description: string;
      recommended: boolean;
    }[];
    status: "open" | "answered" | "defaulted" | "cancelled";
  }[];
}

export interface ApprovalsReadModel {
  requests: ApprovalReadModelRequestItem[];
}

export interface ApprovalReadModelRequestItem {
  requestId: RuntimeApprovalId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId: string | null;
  ownerTitle: string;
  toolName: RuntimeApprovalRecord["toolName"];
  approvalMode: RuntimeApprovalRecord["approvalMode"];
  cwd: string;
  command: string | null;
  commandFamily: string | null;
  snippetArtifactId: string | null;
  status: RuntimeApprovalRecord["status"];
  createdAt: IsoDateTimeString;
  completedAt: IsoDateTimeString | null;
  summary: string;
}

export interface AgentsReadModel {
  configuredProfiles: readonly ConfiguredAgentProfileReadModelRecord[];
  workflowAgents: readonly WorkflowAgentSourceReadModelRecord[];
  actorExtensionDefaults: readonly AgentActorExtensionDefaultsReadModelRecord[];
  bindings: readonly AgentBindingReadModelRecord[];
  generatedContextPreviews: readonly GeneratedContextPreviewReadModelRecord[];
}

export interface WorkflowAgentSourceReadModelRecord {
  sourceId: string;
  path: AbsolutePath;
  sourceVersion: string;
  fingerprint: string;
  validationStatus: "valid" | "invalid";
  diagnostics: readonly SourceDiagnostic[];
  parameters: TaskAgentParametersSource | null;
  extensionOrder: readonly ExtensionId[];
  observedAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  builtin: boolean;
  deletable: boolean;
}

export interface AgentActorExtensionDefaultsReadModelRecord {
  actor: "orchestrator" | "workflow-task";
  extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
  extensionOrder: readonly ExtensionId[];
  updatedAt: IsoDateTimeString | null;
}

export interface ConfiguredAgentProfileReadModelRecord {
  profileId: AgentProfileId;
  actor: "orchestrator" | "handler";
  name: string;
  providerId: ProviderId | "";
  modelId: ModelId | "";
  reasoning: JsonValueType | null;
  followComposer: boolean;
  extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
  extensionOrder: readonly ExtensionId[];
  position: number;
  updatedAt: IsoDateTimeString;
  builtin: boolean;
  locked: boolean;
  deletable: boolean;
}

export interface AgentBindingReadModelRecord {
  ownerKind: "session" | "thread" | "workflow-task-attempt";
  ownerId: WorkspaceSessionId | ThreadId | WorkflowTaskAttemptId | string;
  surfacePiSessionId: SurfacePiSessionId | null;
  profileId: AgentProfileId | string;
  actor: "orchestrator" | "handler" | "workflow-task";
  name: string;
  providerId: ProviderId | "";
  modelId: ModelId | "";
  reasoning: JsonValueType | null;
  followComposer: boolean;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  generatedAgentContextFingerprint: string | null;
  source: "surface-binding" | "handler-thread" | "workflow-task-attempt";
}

export interface GeneratedContextPreviewReadModelRecord {
  ownerKind: "session" | "thread" | "workflow-task-attempt";
  ownerId: WorkspaceSessionId | ThreadId | WorkflowTaskAttemptId | string;
  surfacePiSessionId: SurfacePiSessionId;
  actorKind: "orchestrator" | "handler" | "workflow-task";
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  externalSourceHashes: readonly string[];
}

export interface ExtensionsReadModel {
  records: readonly ExtensionReadModelRecord[];
  dependencyReadiness: readonly unknown[];
}

export interface ExtensionReadModelRecord {
  extensionId: ExtensionId;
  readiness: "ready" | "not-ready" | "unknown";
  loadedByProfileIds: readonly (AgentProfileId | string)[];
  availableByProfileIds: readonly (AgentProfileId | string)[];
  generatedPackageStatus: "ready" | "failed" | "refresh-needed" | "unknown";
}

export interface SnippetsReadModel {
  managed: readonly SnippetReadModelRecord[];
  discovered: readonly SnippetReadModelRecord[];
  snippets: readonly SnippetReadModelRecord[];
}

export interface SnippetReadModelRecord {
  id: SnippetId;
  source: SnippetSource;
  title: string;
  body: string;
  metadata: SnippetMetadata;
  enabled: boolean;
  path: string | null;
  updatedAt: IsoDateTimeString | null;
}

export interface WorkflowsGeneratedReadModel {
  packageName: "@svvyx/workflows";
  facts: readonly StructuredGeneratedPackageFactRecord[];
  exports: readonly WorkflowsGeneratedExportReadModelRecord[];
}

export interface WorkflowsGeneratedExportReadModelRecord {
  namespace: "Agents" | "Components" | "Prompts" | "Workflows";
  exportName: string;
  qualifiedName: string;
  kind: "agent" | "component" | "prompt" | "workflow";
  generatedCode: string;
  generatedPath: string | null;
  sourcePath: string | null;
  agentParameters: JsonValueType | null;
  workflowAgentId: string | null;
}

export type HandlerInspectorReadModel = StructuredHandlerThreadInspector;

export type WorkflowTaskAttemptInspectorReadModel = StructuredWorkflowTaskAttemptInspector;

export interface StateReadModelInvalidationRefetchRequest {
  descriptor: StateInvalidationDescriptor;
}

export interface StateReadModelBaseline {
  app: readonly StateReadModelResult[];
  workspaces: readonly StateReadModelResult[];
  revision: StateRevision;
}

export interface StateReadModelRebaselineRequest {
  workspaceId?: WorkspaceIdType;
  reason: "renderer-startup" | "event-sequence-gap" | "manual-refresh" | "runtime-restart";
}

export interface StateReadModelsService {
  fetch(input: StateReadModelRequest): Effect.Effect<StateReadModelResult, StateContractError>;
  refetchInvalidation(
    input: StateReadModelInvalidationRefetchRequest,
  ): Effect.Effect<readonly StateReadModelResult[], StateContractError>;
  rebaseline(
    input: StateReadModelRebaselineRequest,
  ): Effect.Effect<StateReadModelBaseline, StateContractError>;
}

export class StateReadModels extends Context.Service<StateReadModels, StateReadModelsService>()(
  "@svvy/state/StateReadModels",
) {}

export type StateCommandResult<Extra extends object = Record<never, never>> = Extra & {
  receipt: StateCommandReceipt;
};

export interface AppLogReadStateCommands {
  markRead(
    input: MarkAppLogReadCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  markVisibleRangeRead(
    input: MarkVisibleAppLogRangeReadCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  clearWorkspaceUnread(
    input: ClearWorkspaceAppLogUnreadCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface AppPreferencesStateCommands {
  update(
    input: UpdateAppPreferencesCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface ProviderAuthStateCommands {
  recordStatus(
    input: RecordProviderAuthStatusCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface WorkspaceChromeStateCommands {
  setTabs(
    input: SetWorkspaceTabsCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  selectTab(
    input: SelectWorkspaceTabCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  selectLayoutSlot(
    input: SelectWorkspaceLayoutSlotCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface WorkspaceLayoutStateCommands {
  saveSlot(
    input: SaveWorkspaceLayoutSlotCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface SessionNavigationStateCommands {
  setPinned(
    input: SetSessionPinnedCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  setArchived(
    input: SetSessionArchivedCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  markRead(
    input: MarkSessionReadCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  markUnread(
    input: MarkSessionUnreadCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  setSectionState(
    input: SetSessionNavigationSectionStateCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface ExtensionEnvStateCommands {
  setOverride(
    input: SetExtensionEnvOverrideCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  removeOverride(
    input: RemoveExtensionEnvOverrideCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface AgentProfileStateCommands {
  updateOrchestrator(
    input: UpdateOrchestratorProfileCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  updateThreadHandler(
    input: UpdateThreadHandlerProfileCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  deleteOrchestrator(
    input: DeleteOrchestratorProfileCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  reorderOrchestrators(
    input: ReorderOrchestratorProfilesCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  setProfileExtensionUsage(
    input: SetProfileExtensionUsageCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  promoteExtensionDefault(
    input: PromoteProfileExtensionDefaultCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  resetActorExtensionDefaults(
    input: ResetActorExtensionDefaultsCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  setActorExtensionDefaults(
    input: SetAgentActorExtensionDefaultsCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  setExternalInstructionActorUsage(
    input: SetExternalInstructionActorUsageCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface SnippetStateCommands {
  createManaged(
    input: CreateManagedSnippetCommandInput,
  ): Effect.Effect<
    StateMutationResult<StateCommandResult<{ snippetId: SnippetId }>>,
    StateContractError
  >;
  updateManaged(
    input: UpdateManagedSnippetCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  deleteManaged(
    input: DeleteManagedSnippetCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  setEnabled(
    input: SetSnippetEnabledCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface StateCommandsService {
  workspaceChrome: WorkspaceChromeStateCommands;
  workspaceLayout: WorkspaceLayoutStateCommands;
  sessionNavigation: SessionNavigationStateCommands;
  appLogs: AppLogReadStateCommands;
  appPreferences: AppPreferencesStateCommands;
  providerAuth: ProviderAuthStateCommands;
  extensionEnv: ExtensionEnvStateCommands;
  agentProfiles: AgentProfileStateCommands;
  snippets: SnippetStateCommands;
}

export class StateCommands extends Context.Service<StateCommands, StateCommandsService>()(
  "@svvy/state/StateCommands",
) {}

export interface StateFacade {
  readModels: {
    fetch(
      input: StateReadModelRequest,
      options?: StateFacadeCallOptions,
    ): Promise<StateReadModelResult>;
    refetchInvalidation(
      input: StateReadModelInvalidationRefetchRequest,
      options?: StateFacadeCallOptions,
    ): Promise<readonly StateReadModelResult[]>;
    rebaseline(
      input: StateReadModelRebaselineRequest,
      options?: StateFacadeCallOptions,
    ): Promise<StateReadModelBaseline>;
  };
  close(): void;
}

export interface StateCommandsFacade {
  workspaceChrome: {
    setTabs(
      input: SetWorkspaceTabsCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    selectTab(
      input: SelectWorkspaceTabCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    selectLayoutSlot(
      input: SelectWorkspaceLayoutSlotCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  workspaceLayout: {
    saveSlot(
      input: SaveWorkspaceLayoutSlotCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  sessionNavigation: {
    setPinned(
      input: SetSessionPinnedCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setArchived(
      input: SetSessionArchivedCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    markRead(
      input: MarkSessionReadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    markUnread(
      input: MarkSessionUnreadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setSectionState(
      input: SetSessionNavigationSectionStateCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  appLogs: {
    markRead(
      input: MarkAppLogReadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    markVisibleRangeRead(
      input: MarkVisibleAppLogRangeReadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    clearWorkspaceUnread(
      input: ClearWorkspaceAppLogUnreadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  appPreferences: {
    update(
      input: UpdateAppPreferencesCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  providerAuth: {
    recordStatus(
      input: RecordProviderAuthStatusCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  extensionEnv: {
    setOverride(
      input: SetExtensionEnvOverrideCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    removeOverride(
      input: RemoveExtensionEnvOverrideCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  agentProfiles: {
    updateOrchestrator(
      input: UpdateOrchestratorProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    updateThreadHandler(
      input: UpdateThreadHandlerProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    deleteOrchestrator(
      input: DeleteOrchestratorProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    reorderOrchestrators(
      input: ReorderOrchestratorProfilesCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setProfileExtensionUsage(
      input: SetProfileExtensionUsageCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    promoteExtensionDefault(
      input: PromoteProfileExtensionDefaultCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    resetActorExtensionDefaults(
      input: ResetActorExtensionDefaultsCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setActorExtensionDefaults(
      input: SetAgentActorExtensionDefaultsCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setExternalInstructionActorUsage(
      input: SetExternalInstructionActorUsageCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  snippets: {
    createManaged(
      input: CreateManagedSnippetCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult<{ snippetId: SnippetId }>>;
    updateManaged(
      input: UpdateManagedSnippetCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    deleteManaged(
      input: DeleteManagedSnippetCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setEnabled(
      input: SetSnippetEnabledCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  close(): void;
}

export interface StateAppLogAppendInput {
  createdAt?: string;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
  details?: Record<string, unknown>;
  error?: unknown;
  workspaceSessionId?: string;
  surfacePiSessionId?: string;
  threadId?: string;
  workflowRunId?: string;
  workflowTaskAttemptId?: string;
  commandId?: string;
  artifactId?: string;
}

export interface StateAppLogsFacade {
  append(entry: StateAppLogAppendInput): AppLogEntry;
  query(query?: AppLogQuery): AppLogReadModel;
  summary(): AppLogSummary;
  markSeen(throughSeq: number): AppLogSummary;
  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void;
  writePort: AppLogWritePortService;
  close(): void;
}

export interface CreateStateAppLogsFacadeOptions {
  databasePath?: string;
  now: () => string;
  memoryLimit?: number;
  persistedLimit?: number;
  retentionDays?: number;
}

type StateLayerConfigInput = {
  readonly config: StateLayerConfig;
  readonly digest?: StateDigestHelper;
};

type StateLayerProvidedPortServices =
  | ExtensionStatePort
  | RuntimeWorkspaceStatePort
  | RuntimeSurfaceLifecycleStatePort
  | RuntimeComposerDraftStatePort
  | RuntimeQueueStatePort
  | RuntimeTurnStatePort
  | RuntimeCommandStatePort
  | RuntimeApprovalStatePort
  | RuntimeActorExtensionBindingStatePort
  | RuntimeEpisodeStatePort
  | RuntimeExtensionStatePort
  | RuntimeExtensionContextImpactStatePort
  | RuntimeGeneratedPackageStatePort
  | RuntimePromptDefaultsStatePort
  | RuntimeArtifactStatePort
  | RuntimeRecoveryStatePort
  | RuntimeReadModelStatePort
  | RuntimeRequestStatePort
  | RuntimeSessionWaitStatePort
  | RuntimeSourceStatePort
  | RuntimeThreadStatePort
  | ProviderAuthStatusStatePort
  | SandboxPolicySource
  | PiSessionReferencePort;

const stateLayerNow = () => "1970-01-01T00:00:00.000Z";

export function createStateFacade(
  managedRuntime: ManagedRuntime.ManagedRuntime<StateReadModels, unknown>,
): StateFacade {
  let closed = false;
  const run = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E, StateReadModels>,
    options?: StateFacadeCallOptions,
  ): Promise<A> => runStateFacadeEffect({ managedRuntime, operation, effect, options, closed });

  return {
    readModels: {
      fetch: (input, options) =>
        run(
          "state.readModels.fetch",
          Effect.gen(function* () {
            const readModels = yield* StateReadModels;
            return yield* readModels.fetch(input);
          }),
          options,
        ),
      refetchInvalidation: (input, options) =>
        run(
          "state.readModels.refetchInvalidation",
          Effect.gen(function* () {
            const readModels = yield* StateReadModels;
            return yield* readModels.refetchInvalidation(input);
          }),
          options,
        ),
      rebaseline: (input, options) =>
        run(
          "state.readModels.rebaseline",
          Effect.gen(function* () {
            const readModels = yield* StateReadModels;
            return yield* readModels.rebaseline(input);
          }),
          options,
        ),
    },
    close: () => {
      closed = true;
    },
  };
}

export function createStateCommandsFacade(
  managedRuntime: ManagedRuntime.ManagedRuntime<
    StateCommands | StateCommandPostCommitNotificationPort,
    unknown
  >,
): StateCommandsFacade {
  let closed = false;
  const run = <A extends { readonly receipt: StateCommandReceipt }, E>(
    operation: string,
    effect: Effect.Effect<StateMutationResult<A>, E, StateCommands>,
    clientSubmission: RuntimeClientSubmissionInput | undefined,
    callOptions?: StateFacadeCallOptions,
  ): Promise<A> =>
    runStateFacadeEffect({
      managedRuntime,
      operation,
      options: callOptions,
      closed,
      effect: Effect.gen(function* () {
        const result = yield* effect;
        if (result.afterCommit.length > 0) {
          const notifications = yield* StateCommandPostCommitNotificationPort;
          yield* notifications
            .notifyCommittedStateCommand({
              operation,
              receipt: result.value.receipt,
              descriptors: result.afterCommit,
              ...(clientSubmission ? { clientSubmission } : {}),
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  postCommitNotificationError(
                    operation,
                    result.value.receipt,
                    result.afterCommit,
                    cause,
                  ),
                ),
              ),
            );
        }
        return result.value;
      }),
    });

  return {
    workspaceChrome: {
      setTabs: (input, callOptions) =>
        run(
          "stateCommands.workspaceChrome.setTabs",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.workspaceChrome.setTabs(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      selectTab: (input, callOptions) =>
        run(
          "stateCommands.workspaceChrome.selectTab",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.workspaceChrome.selectTab(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      selectLayoutSlot: (input, callOptions) =>
        run(
          "stateCommands.workspaceChrome.selectLayoutSlot",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.workspaceChrome.selectLayoutSlot(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    workspaceLayout: {
      saveSlot: (input, callOptions) =>
        run(
          "stateCommands.workspaceLayout.saveSlot",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.workspaceLayout.saveSlot(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    sessionNavigation: {
      setPinned: (input, callOptions) =>
        run(
          "stateCommands.sessionNavigation.setPinned",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.sessionNavigation.setPinned(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      setArchived: (input, callOptions) =>
        run(
          "stateCommands.sessionNavigation.setArchived",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.sessionNavigation.setArchived(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      markRead: (input, callOptions) =>
        run(
          "stateCommands.sessionNavigation.markRead",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.sessionNavigation.markRead(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      markUnread: (input, callOptions) =>
        run(
          "stateCommands.sessionNavigation.markUnread",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.sessionNavigation.markUnread(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      setSectionState: (input, callOptions) =>
        run(
          "stateCommands.sessionNavigation.setSectionState",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.sessionNavigation.setSectionState(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    appLogs: {
      markRead: (input, callOptions) =>
        run(
          "stateCommands.appLogs.markRead",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.appLogs.markRead(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      markVisibleRangeRead: (input, callOptions) =>
        run(
          "stateCommands.appLogs.markVisibleRangeRead",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.appLogs.markVisibleRangeRead(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      clearWorkspaceUnread: (input, callOptions) =>
        run(
          "stateCommands.appLogs.clearWorkspaceUnread",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.appLogs.clearWorkspaceUnread(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    appPreferences: {
      update: (input, callOptions) =>
        run(
          "stateCommands.appPreferences.update",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.appPreferences.update(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    providerAuth: {
      recordStatus: (input, callOptions) =>
        run(
          "stateCommands.providerAuth.recordStatus",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.providerAuth.recordStatus(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    extensionEnv: {
      setOverride: (input, callOptions) =>
        run(
          "stateCommands.extensionEnv.setOverride",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.extensionEnv.setOverride(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      removeOverride: (input, callOptions) =>
        run(
          "stateCommands.extensionEnv.removeOverride",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.extensionEnv.removeOverride(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    agentProfiles: {
      updateOrchestrator: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.updateOrchestrator",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.updateOrchestrator(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      updateThreadHandler: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.updateThreadHandler",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.updateThreadHandler(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      deleteOrchestrator: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.deleteOrchestrator",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.deleteOrchestrator(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      reorderOrchestrators: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.reorderOrchestrators",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.reorderOrchestrators(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      setProfileExtensionUsage: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.setProfileExtensionUsage",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.setProfileExtensionUsage(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      promoteExtensionDefault: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.promoteExtensionDefault",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.promoteExtensionDefault(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      resetActorExtensionDefaults: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.resetActorExtensionDefaults",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.resetActorExtensionDefaults(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      setActorExtensionDefaults: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.setActorExtensionDefaults",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.setActorExtensionDefaults(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      setExternalInstructionActorUsage: (input, callOptions) =>
        run(
          "stateCommands.agentProfiles.setExternalInstructionActorUsage",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.agentProfiles.setExternalInstructionActorUsage(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    snippets: {
      createManaged: (input, callOptions) =>
        run(
          "stateCommands.snippets.createManaged",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.snippets.createManaged(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      updateManaged: (input, callOptions) =>
        run(
          "stateCommands.snippets.updateManaged",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.snippets.updateManaged(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      deleteManaged: (input, callOptions) =>
        run(
          "stateCommands.snippets.deleteManaged",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.snippets.deleteManaged(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      setEnabled: (input, callOptions) =>
        run(
          "stateCommands.snippets.setEnabled",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.snippets.setEnabled(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    close: () => {
      closed = true;
    },
  };
}

export function createStateAppLogsFacade(
  options: CreateStateAppLogsFacadeOptions,
): StateAppLogsFacade {
  const store = createAppLogStore(options);
  const appLogState = appLogStateFromStore(store);
  return {
    append: (entry) => store.append(entry),
    query: (query) => store.query(query),
    summary: () => store.summary(),
    markSeen: (throughSeq) => store.markSeen(throughSeq),
    subscribe: (listener) => store.subscribe(listener),
    writePort: appLogWritePortFromAppLogState(appLogState),
    close: () => store.close(),
  };
}

const makeStateReadModels = Effect.fn("@svvy/state/makeStateReadModels")(function* () {
  const appLogs = yield* AppLogState;
  const structuredSession = yield* StructuredSessionState;
  return stateReadModelsFromState({
    appLogs: appLogStateResolver(appLogs),
    structuredSession: () => Effect.succeed(structuredSession),
  });
});

export function stateReadModelsFromRouter(input: {
  router: WorkspaceStateRouter;
  appLogs: AppLogState["Service"];
  resolveAppLogs?: AppLogStateResolver;
}): StateReadModels["Service"] {
  return stateReadModelsFromState({
    appLogs: input.resolveAppLogs ?? appLogStateResolver(input.appLogs),
    fetchStructuredSession: (request) => {
      switch (request.kind) {
        case "surfaceTranscript":
        case "surfaceSummary":
        case "surfaceComposer":
        case "surfaceQueuedMessages":
          return input.router.resolveRuntimeSurfaceStructuredSession(request.target);
        default: {
          const workspaceId = readModelWorkspaceId(request);
          return workspaceId
            ? input.router.resolveWorkspaceStructuredSession(workspaceId)
            : Effect.succeed(input.router.appGlobalStructuredSession);
        }
      }
    },
    structuredSession: (workspaceId) =>
      workspaceId
        ? input.router.resolveWorkspaceStructuredSession(workspaceId)
        : Effect.succeed(input.router.appGlobalStructuredSession),
  });
}

export function stateCommandsFromRouter(input: {
  router: WorkspaceStateRouter;
  appLogs: AppLogState["Service"];
  resolveAppLogs?: AppLogStateResolver;
}): StateCommands["Service"] {
  return stateCommandsFromState({
    appLogs: input.resolveAppLogs ?? appLogStateResolver(input.appLogs),
    structuredSession: (workspaceId) =>
      workspaceId
        ? input.router.resolveWorkspaceStructuredSession(workspaceId)
        : Effect.succeed(input.router.appGlobalStructuredSession),
  });
}

const layerStateReadModels = Layer.effect(StateReadModels, makeStateReadModels());

const makeStateCommands = Effect.fn("@svvy/state/makeStateCommands")(function* () {
  const appLogs = yield* AppLogState;
  const structuredSession = yield* StructuredSessionState;
  return stateCommandsFromState({
    appLogs: appLogStateResolver(appLogs),
    structuredSession: () => Effect.succeed(structuredSession),
  });
});

const layerStateCommands = Layer.effect(StateCommands, makeStateCommands());

export const layer = (
  input: StateLayerConfigInput,
): Layer.Layer<
  StateReadModels | StateCommands | AppLogWritePort | StateLayerProvidedPortServices,
  StateContractError,
  FileSystem.FileSystem | Path.Path
> => {
  const structuredSessionLayer = layerRootStructuredSessionState(input);
  const packageStateLayer = Layer.mergeAll(
    layerAppLogState({
      databasePath: input.config.databasePath,
      busyTimeoutMs: input.config.busyTimeoutMs,
      now: stateLayerNow,
    }),
    structuredSessionLayer,
  );
  return Layer.mergeAll(
    Layer.mergeAll(layerStateReadModels, layerStateCommands, layerAppLogWritePort).pipe(
      Layer.provide(packageStateLayer),
    ),
    structuredSessionStatePortsLayerWithSandboxPolicyConfig(input.config.sandboxPolicy ?? {}).pipe(
      Layer.provide(structuredSessionLayer),
    ),
  );
};

function layerRootStructuredSessionState(
  input: StateLayerConfigInput,
): Layer.Layer<StructuredSessionState, StateContractError, FileSystem.FileSystem | Path.Path> {
  return Layer.effect(
    StructuredSessionState,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fileSystem
        .makeDirectory(path.dirname(input.config.databasePath), { recursive: true })
        .pipe(
          Effect.mapError((cause) =>
            stateLayerOpenError("state.structuredSession.prepareDatabaseDirectory", cause),
          ),
        );
      yield* fileSystem
        .makeDirectory(input.config.artifactRoot, { recursive: true })
        .pipe(Effect.catch(() => Effect.void));

      const store = yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            createStructuredSessionStateStore({
              databasePath: input.config.databasePath,
              busyTimeoutMs: input.config.busyTimeoutMs,
              filesystemSetup: "caller",
              ...(input.digest ? { digest: input.digest } : {}),
              workspace: {
                id: "workspace_state_root" as WorkspaceIdType,
                label: "State root",
                cwd: path.dirname(input.config.databasePath) as typeof AbsolutePath.Type,
                artifactDir: input.config.artifactRoot,
              },
              now: stateLayerNow,
            }),
          catch: (cause) => stateLayerOpenError("state.structuredSession.open", cause),
        }),
        (acquiredStore: StructuredSessionStateStore) =>
          Effect.try({
            try: () => acquiredStore.close(),
            catch: (cause) => stateLayerOpenError("state.structuredSession.close", cause),
          }).pipe(Effect.ignore),
      );
      return structuredSessionStateFromStore(store);
    }),
  );
}

function stateLayerOpenError(operation: string, cause: unknown): StateContractError {
  if (cause instanceof StateContractError) {
    return cause;
  }
  return new StateContractError({
    operation,
    reason: "transaction-failed",
    message: cause instanceof Error ? cause.message : "State layer open failed.",
    cause,
  });
}

type AppLogStateResolver = (
  workspaceId: WorkspaceIdType | undefined,
) => Effect.Effect<AppLogState["Service"], StateContractError>;

type StructuredSessionStateResolver = (
  workspaceId: WorkspaceIdType | undefined,
) => Effect.Effect<StructuredSessionState["Service"], StateContractError>;

type FetchStructuredSessionStateResolver = (
  request: StateReadModelRequest,
) => Effect.Effect<StructuredSessionState["Service"], StateContractError>;

function appLogStateResolver(appLogs: AppLogState["Service"]): AppLogStateResolver {
  return () => Effect.succeed(appLogs);
}

function stateReadModelsFromState(state: {
  appLogs: AppLogStateResolver;
  fetchStructuredSession?: FetchStructuredSessionStateResolver;
  structuredSession: StructuredSessionStateResolver;
}): StateReadModels["Service"] {
  return StateReadModels.of({
    fetch: (request) =>
      Effect.gen(function* () {
        const structuredSession = yield* (
          state.fetchStructuredSession?.(request) ??
            state.structuredSession(readModelWorkspaceId(request))
        );
        switch (request.kind) {
          case "appLogs": {
            const appLogs = yield* state.appLogs(request.workspaceId);
            return { kind: "appLogs", value: yield* appLogs.query(request.query) };
          }
          case "appLogSummary": {
            const appLogs = yield* state.appLogs(request.workspaceId);
            return { kind: "appLogSummary", value: yield* appLogs.summary() };
          }
          case "appPreferences": {
            const record = yield* structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return { kind: "appPreferences", value: preferences };
          }
          case "settings": {
            const [record, requestInput] = yield* Effect.all([
              structuredSession.readAppPreferences(),
              structuredSession.readRequestInputSettings(),
            ]);
            const preferences = appPreferencesReadModel(record);
            return { kind: "settings", value: { preferences, requestInput } };
          }
          case "providerAuth": {
            const providers = yield* structuredSession.listProviderAuthStatuses(
              request.workspaceId ? { workspaceId: request.workspaceId } : {},
            );
            return { kind: "providerAuth", value: providerAuthReadModel(providers) };
          }
          case "sessionNavigation":
            return {
              kind: "sessionNavigation",
              value: yield* buildSessionNavigationReadModel(structuredSession),
            };
          case "promptHistory":
            return {
              kind: "promptHistory",
              value: yield* buildPromptHistoryReadModel(structuredSession, request.workspaceId),
            };
          case "surfaceTranscript":
            return {
              kind: "surfaceTranscript",
              value: yield* buildSurfaceTranscriptReadModel(structuredSession, request),
            };
          case "surfaceSummary":
            return {
              kind: "surfaceSummary",
              value: yield* buildSurfaceSummaryReadModel(structuredSession, request.target),
            };
          case "surfaceComposer":
            return {
              kind: "surfaceComposer",
              value: yield* buildSurfaceComposerReadModel(structuredSession, request.target),
            };
          case "surfaceQueuedMessages":
            return {
              kind: "surfaceQueuedMessages",
              value: yield* buildSurfaceQueuedMessagesReadModel(structuredSession, request.target),
            };
          case "commandInspector":
            return {
              kind: "commandInspector",
              value: yield* buildCommandInspectorReadModel(structuredSession, request.commandId),
            };
          case "artifactInspector":
            return {
              kind: "artifactInspector",
              value: yield* buildArtifactInspectorReadModel(structuredSession, request),
            };
          case "requestInput":
            return {
              kind: "requestInput",
              value: yield* buildRequestInputReadModel(structuredSession, request),
            };
          case "approvals":
            return {
              kind: "approvals",
              value: yield* buildApprovalsReadModel(structuredSession, request),
            };
          case "agents":
            return {
              kind: "agents",
              value: yield* buildAgentsReadModel(structuredSession, request),
            };
          case "extensions":
            return {
              kind: "extensions",
              value: yield* buildExtensionsReadModel(structuredSession, request),
            };
          case "snippets":
            return {
              kind: "snippets",
              value: yield* buildSnippetsReadModel(structuredSession, request),
            };
          case "workflowsGenerated":
            return {
              kind: "workflowsGenerated",
              value: yield* buildWorkflowsGeneratedReadModel(structuredSession, request),
            };
          case "handlerInspector":
            return {
              kind: "handlerInspector",
              value: yield* buildHandlerInspectorReadModel(structuredSession, request.threadId),
            };
          case "workflowTaskAttemptInspector":
            return {
              kind: "workflowTaskAttemptInspector",
              value: yield* buildWorkflowTaskAttemptInspectorReadModel(
                structuredSession,
                request.workflowTaskAttemptId,
              ),
            };
          case "workspaceChrome":
            return {
              kind: "workspaceChrome",
              value: yield* buildWorkspaceChromeReadModel(structuredSession),
            };
          case "workspaceLayout":
            return {
              kind: "workspaceLayout",
              value: yield* buildWorkspaceLayoutReadModel(structuredSession, request.workspaceId),
            };
        }
      }),
    refetchInvalidation: (request) =>
      Effect.gen(function* () {
        const model = request.descriptor.invalidation.model;
        const structuredSession = yield* state.structuredSession(
          request.descriptor.scope === "workspace" ? request.descriptor.workspaceId : undefined,
        );
        switch (model) {
          case "appLogs": {
            const appLogs = yield* state.appLogs(
              request.descriptor.scope === "workspace" ? request.descriptor.workspaceId : undefined,
            );
            const [logs, summary] = yield* Effect.all([appLogs.query(), appLogs.summary()]);
            return [
              { kind: "appLogs", value: logs },
              { kind: "appLogSummary", value: summary },
            ];
          }
          case "appPreferences": {
            const record = yield* structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return [{ kind: "appPreferences", value: preferences }];
          }
          case "settings": {
            const [record, requestInput] = yield* Effect.all([
              structuredSession.readAppPreferences(),
              structuredSession.readRequestInputSettings(),
            ]);
            const preferences = appPreferencesReadModel(record);
            return [{ kind: "settings", value: { preferences, requestInput } }];
          }
          case "providerAuth": {
            const providers = yield* structuredSession.listProviderAuthStatuses(
              request.descriptor.scope === "workspace"
                ? { workspaceId: request.descriptor.workspaceId }
                : {},
            );
            return [{ kind: "providerAuth", value: providerAuthReadModel(providers) }];
          }
          case "sessionNavigation":
            return [
              {
                kind: "sessionNavigation",
                value: yield* buildSessionNavigationReadModel(structuredSession),
              },
            ];
          case "promptHistory":
            if (request.descriptor.scope !== "workspace") return [];
            return [
              {
                kind: "promptHistory",
                value: yield* buildPromptHistoryReadModel(
                  structuredSession,
                  request.descriptor.workspaceId,
                ),
              },
            ];
          case "workspaceChrome":
            return [
              {
                kind: "workspaceChrome",
                value: yield* buildWorkspaceChromeReadModel(structuredSession),
              },
            ];
          case "workspaceLayout":
            if (request.descriptor.scope !== "workspace") return [];
            return [
              {
                kind: "workspaceLayout",
                value: yield* buildWorkspaceLayoutReadModel(
                  structuredSession,
                  request.descriptor.workspaceId,
                ),
              },
            ];
          case "surface":
            return yield* refetchSurfaceInvalidation(
              structuredSession,
              request.descriptor.invalidation.ids,
            );
          case "commandInspector":
            return yield* Effect.all(
              request.descriptor.invalidation.ids.map((commandId) =>
                buildCommandInspectorReadModel(structuredSession, commandId).pipe(
                  Effect.map(
                    (value): StateReadModelResult => ({ kind: "commandInspector", value }),
                  ),
                ),
              ),
            );
          case "requestInput":
            return [
              {
                kind: "requestInput",
                value: yield* buildRequestInputReadModel(structuredSession, {
                  kind: "requestInput",
                }),
              },
            ];
          case "runtimeApprovals":
            return [
              {
                kind: "approvals",
                value: yield* buildApprovalsReadModel(structuredSession, { kind: "approvals" }),
              },
            ];
          case "handlerThreadInspector":
            return yield* Effect.all(
              request.descriptor.invalidation.ids.map((threadId) =>
                buildHandlerInspectorReadModel(structuredSession, threadId).pipe(
                  Effect.map(
                    (value): StateReadModelResult => ({ kind: "handlerInspector", value }),
                  ),
                ),
              ),
            );
          case "workflowTaskAttemptInspector":
            return yield* Effect.all(
              request.descriptor.invalidation.ids.map((workflowTaskAttemptId) =>
                buildWorkflowTaskAttemptInspectorReadModel(
                  structuredSession,
                  workflowTaskAttemptId,
                ).pipe(
                  Effect.map(
                    (value): StateReadModelResult => ({
                      kind: "workflowTaskAttemptInspector",
                      value,
                    }),
                  ),
                ),
              ),
            );
          case "snippets":
            if (request.descriptor.scope !== "workspace") return [];
            return [
              {
                kind: "snippets",
                value: yield* buildSnippetsReadModel(structuredSession, {
                  kind: "snippets",
                  workspaceId: request.descriptor.workspaceId,
                }),
              },
            ];
          case "workflowsGenerated":
            return [
              {
                kind: "workflowsGenerated",
                value: yield* buildWorkflowsGeneratedReadModel(structuredSession, {
                  kind: "workflowsGenerated",
                }),
              },
            ];
          case "agents":
            return [
              {
                kind: "agents",
                value: yield* buildAgentsReadModel(structuredSession, { kind: "agents" }),
              },
            ];
          case "extensions":
            return [
              {
                kind: "extensions",
                value: yield* buildExtensionsReadModel(structuredSession, { kind: "extensions" }),
              },
            ];
          default:
            return [];
        }
      }),
    rebaseline: (request) =>
      Effect.gen(function* () {
        const appLogs = yield* state.appLogs(undefined);
        const appState = yield* state.structuredSession(undefined);
        const [summary, appStateRevision, record, requestInput] = yield* Effect.all([
          appLogs.summary(),
          appState.readCurrentStateRevision(),
          appState.readAppPreferences(),
          appState.readRequestInputSettings(),
        ]);
        const preferences = appPreferencesReadModel(record);
        const workspaceId = request.workspaceId;
        const workspaceBaseline = workspaceId
          ? yield* Effect.gen(function* () {
              const workspaceLogs = yield* state.appLogs(workspaceId);
              const workspaceState = yield* state.structuredSession(workspaceId);
              const [logs, workspaceStateRevision] = yield* Effect.all([
                workspaceLogs.query(),
                workspaceState.readCurrentStateRevision(),
              ]);
              return {
                results: [
                  { kind: "appLogs", value: logs },
                  {
                    kind: "sessionNavigation",
                    value: yield* buildSessionNavigationReadModel(workspaceState),
                  },
                  {
                    kind: "promptHistory",
                    value: yield* buildPromptHistoryReadModel(workspaceState, workspaceId),
                  },
                  {
                    kind: "requestInput",
                    value: yield* buildRequestInputReadModel(workspaceState, {
                      kind: "requestInput",
                    }),
                  },
                  {
                    kind: "approvals",
                    value: yield* buildApprovalsReadModel(workspaceState, { kind: "approvals" }),
                  },
                  {
                    kind: "snippets",
                    value: yield* buildSnippetsReadModel(workspaceState, {
                      kind: "snippets",
                      workspaceId,
                    }),
                  },
                  {
                    kind: "workspaceLayout",
                    value: yield* buildWorkspaceLayoutReadModel(workspaceState, workspaceId),
                  },
                ] satisfies StateReadModelResult[],
                revision: workspaceStateRevision,
              };
            })
          : { results: [] as StateReadModelResult[], revision: 0 as StateRevision };
        return {
          app: [
            { kind: "appLogSummary", value: summary },
            { kind: "appPreferences", value: preferences },
            { kind: "settings", value: { preferences, requestInput } },
            {
              kind: "providerAuth",
              value: providerAuthReadModel(yield* appState.listProviderAuthStatuses({})),
            },
            {
              kind: "agents",
              value: yield* buildAgentsReadModel(appState, { kind: "agents" }),
            },
            {
              kind: "extensions",
              value: yield* buildExtensionsReadModel(appState, { kind: "extensions" }),
            },
            {
              kind: "workflowsGenerated",
              value: yield* buildWorkflowsGeneratedReadModel(appState, {
                kind: "workflowsGenerated",
              }),
            },
            {
              kind: "workspaceChrome",
              value: yield* buildWorkspaceChromeReadModel(appState),
            },
          ],
          workspaces: workspaceBaseline.results,
          revision: Math.max(
            summary.latestSeq,
            appStateRevision,
            workspaceBaseline.revision,
          ) as StateRevision,
        };
      }),
  });
}

function readModelWorkspaceId(request: StateReadModelRequest): WorkspaceIdType | undefined {
  switch (request.kind) {
    case "appLogs":
    case "appLogSummary":
    case "providerAuth":
    case "sessionNavigation":
    case "promptHistory":
    case "commandInspector":
    case "artifactInspector":
    case "requestInput":
    case "approvals":
    case "snippets":
    case "handlerInspector":
    case "workflowTaskAttemptInspector":
    case "workspaceLayout":
      return request.workspaceId;
    default:
      return undefined;
  }
}

function buildSessionNavigationReadModel(
  state: StructuredSessionState["Service"],
): Effect.Effect<SessionNavigationReadModel, StateContractError> {
  return Effect.gen(function* () {
    const snapshots = yield* state.listSessionStates();
    const sidebarState = yield* state.getWorkspaceSidebarState();
    const summaries = yield* Effect.forEach(snapshots, (snapshot) =>
      Effect.gen(function* () {
        const draft = yield* state.getComposerDraft(snapshot.session.orchestratorPiSessionId);
        return yield* decodeSessionNavigationSummaryProjection(
          sessionNavigationSummary(snapshot, draft?.text ?? ""),
        ).pipe(Effect.mapError(sessionNavigationProjectionError));
      }),
    );

    const navigation = buildWorkspaceSessionNavigation(
      summaries,
      sidebarState.archivedGroupCollapsed,
      {
        pinned: {
          collapsed: sidebarState.pinnedGroupCollapsed,
          sizePx: sidebarState.pinnedGroupSizePx,
        },
        active: {
          collapsed: sidebarState.activeGroupCollapsed,
          sizePx: sidebarState.activeGroupSizePx,
        },
        archived: {
          collapsed: sidebarState.archivedGroupCollapsed,
          sizePx: sidebarState.archivedGroupSizePx,
        },
      },
    );

    return yield* decodeUnknownSessionNavigationReadModelEffect(navigation).pipe(
      Effect.mapError(sessionNavigationProjectionError),
    );
  });
}

function buildPromptHistoryReadModel(
  state: StructuredSessionState["Service"],
  workspaceId: WorkspaceIdType,
): Effect.Effect<PromptHistoryReadModel, StateContractError> {
  return state.listPromptHistory({ workspaceId }).pipe(
    Effect.map((entries) => ({
      workspaceId,
      entries: entries.map((entry) => ({
        workspaceSessionId: entry.workspaceSessionId as WorkspaceSessionId,
        surfacePiSessionId: entry.surfacePiSessionId as SurfacePiSessionId,
        queueItemId: entry.queueItemId as QueueItemId,
        text: entry.text,
        sentAt: entry.sentAt as IsoDateTimeString,
      })),
    })),
  );
}

function sessionNavigationSummary(snapshot: StructuredSessionSnapshot, composerDraftText: string) {
  const projection = buildStructuredSessionSummaryProjection(snapshot);
  const view = buildStructuredSessionView(snapshot);
  const provisionalTitle = sessionNavigationProvisionalTitle(snapshot, composerDraftText);
  const durableTitle =
    snapshot.pi.titleManualOverride ||
    snapshot.pi.titleAutoFrozen ||
    snapshot.pi.titleGenerationStatus === "completed"
      ? snapshot.pi.title
      : null;
  const title = durableTitle || provisionalTitle || snapshot.pi.title;
  const summary = {
    id: snapshot.session.id,
    ...(snapshot.pi.parentSessionId
      ? { parentSessionId: snapshot.pi.parentSessionId as WorkspaceSessionId }
      : {}),
    title,
    preview: projection.preview || title,
    createdAt: snapshot.pi.createdAt,
    updatedAt: projection.updatedAt,
    messageCount: snapshot.pi.messageCount,
    status: projection.status,
    isPinned: snapshot.session.pinnedAt !== null,
    pinnedAt: snapshot.session.pinnedAt,
    isArchived: snapshot.session.archivedAt !== null,
    archivedAt: snapshot.session.archivedAt,
    isUnread: snapshot.session.unreadAt !== null,
    unreadAt: snapshot.session.unreadAt,
    unreadReason: snapshot.session.unreadReason,
    lastReadAt: snapshot.session.lastReadAt,
    ...(snapshot.pi.provider ? { provider: snapshot.pi.provider } : {}),
    ...(snapshot.pi.model ? { modelId: snapshot.pi.model } : {}),
    ...(snapshot.pi.reasoningEffort ? { thinkingLevel: snapshot.pi.reasoningEffort } : {}),
    titleGeneration: {
      status: snapshot.pi.titleGenerationStatus ?? "not-started",
      renameLocked:
        snapshot.pi.titleGenerationStatus === "pending" ||
        snapshot.pi.titleGenerationStatus === "running",
      autoFrozen: snapshot.pi.titleAutoFrozen ?? false,
      manualOverride: snapshot.pi.titleManualOverride ?? false,
      triggeredAt: snapshot.pi.titleGenerationTriggeredAt ?? null,
      finishedAt: snapshot.pi.titleGenerationFinishedAt ?? null,
      error: snapshot.pi.titleGenerationError ?? null,
    },
  };

  if (!hasStructuredSessionFacts(snapshot)) {
    return summary;
  }

  return {
    ...summary,
    wait: snapshot.session.wait
      ? {
          ...(snapshot.session.wait.owner.kind === "thread"
            ? { threadId: snapshot.session.wait.owner.threadId }
            : {}),
          kind: snapshot.session.wait.kind,
          reason: snapshot.session.wait.reason,
          resumeWhen: snapshot.session.wait.resumeWhen,
          since: snapshot.session.wait.since,
        }
      : null,
    counts: projection.counts,
    threadIdsByStatus: view.threadIdsByStatus,
    threadIds: projection.threadIds,
    sidebarThreads: view.sidebarThreads,
    ...(view.commandRollups.length > 0 ? { commandRollups: view.commandRollups } : {}),
    ...(view.productEvents.length > 0 ? { productEvents: view.productEvents } : {}),
  };
}

function sessionNavigationProjectionError(cause: Schema.SchemaError): StateContractError {
  return new StateContractError({
    operation: "state.readModels.sessionNavigation",
    reason: "decode-failed",
    message: cause.message,
    cause,
  });
}

function sessionNavigationProvisionalTitle(
  snapshot: StructuredSessionSnapshot,
  composerDraftText: string,
): string | null {
  if (snapshot.pi.titleManualOverride || snapshot.pi.titleGenerationStatus === "completed") {
    return null;
  }

  const firstTurnSummary = snapshot.turns[0]?.requestSummary?.trim() ?? "";
  const sourceText = composerDraftText.trim() || firstTurnSummary;
  if (!sourceText) {
    return null;
  }

  const collapsed = sourceText.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 72) {
    return collapsed;
  }
  return `${collapsed.slice(0, 71).trimEnd()}…`;
}

function buildSurfaceTranscriptReadModel(
  state: StructuredSessionState["Service"],
  request: SurfaceTranscriptReadModelRequest,
): Effect.Effect<SurfaceTranscriptReadModel, StateContractError> {
  return Effect.gen(function* () {
    const snapshot = yield* getSnapshotForTarget(state, request.target);
    const activeTurnId =
      activeTurnForSurface(snapshot, request.target.surfacePiSessionId)?.id ?? null;
    const queuedCount = countQueuedMessages(snapshot, request.target.surfacePiSessionId);
    const draft = yield* state.getComposerDraft(request.target.surfacePiSessionId);
    const transcript = yield* state.readRuntimeSurfaceTranscript(request.target.surfacePiSessionId);
    const messages = transcriptMessages(transcript, request);

    return {
      target: request.target,
      surfaceStatus: deriveSurfaceStatus(snapshot, request.target.surfacePiSessionId),
      promptLock: {
        activeTurnId: activeTurnId as TurnId | null,
        queuedCount,
      },
      composerDraft: {
        text: draft?.text ?? "",
        attachmentIds: (draft?.attachments ?? []).map((attachment) => attachment.id),
      },
      messages,
      activeAssistantMessage: transcript.activeAssistantMessage,
      streamCursor: transcript.streamCursor,
    };
  });
}

function buildSurfaceSummaryReadModel(
  state: StructuredSessionState["Service"],
  target: RuntimeSurfaceTarget,
): Effect.Effect<SurfaceSummaryReadModel, StateContractError> {
  return Effect.gen(function* () {
    const snapshot = yield* getSnapshotForTarget(state, target);
    const activeTurn = activeTurnForSurface(snapshot, target.surfacePiSessionId);
    const thread =
      "threadId" in target
        ? snapshot.threads.find((candidate) => candidate.id === target.threadId)
        : null;
    return {
      target,
      title: thread?.title ?? snapshot.pi.title,
      status: deriveSurfaceStatus(snapshot, target.surfacePiSessionId),
      activeTurnId: (activeTurn?.id as TurnId | undefined) ?? null,
      activeTurnStartedAt: (activeTurn?.startedAt as IsoDateTimeString | undefined) ?? null,
      queuedCount: countQueuedMessages(snapshot, target.surfacePiSessionId),
      model: snapshot.pi.model ?? "",
      provider: snapshot.pi.provider ?? "",
      reasoningEffort: snapshot.pi.reasoningEffort ?? "medium",
      agentProfileId: snapshot.pi.orchestratorAgentProfileId ?? "",
      loadedExtensionIds: snapshot.pi.loadedExtensionIds ?? [],
      availableExtensionIds: snapshot.pi.availableExtensionIds ?? [],
    };
  });
}

function buildSurfaceComposerReadModel(
  state: StructuredSessionState["Service"],
  target: RuntimeSurfaceTarget,
): Effect.Effect<SurfaceComposerReadModel, StateContractError> {
  return Effect.gen(function* () {
    const draft = yield* state.getComposerDraft(target.surfacePiSessionId);
    return {
      target,
      draft: {
        text: draft?.text ?? "",
        attachments: draft?.attachments ?? [],
        snippetMentions: draft?.snippetMentions ?? [],
        updatedAt: (draft?.updatedAt as IsoDateTimeString | undefined) ?? null,
      },
    };
  });
}

function buildSurfaceQueuedMessagesReadModel(
  state: StructuredSessionState["Service"],
  target: RuntimeSurfaceTarget,
): Effect.Effect<SurfaceQueuedMessagesReadModel, StateContractError> {
  return Effect.gen(function* () {
    const queuedMessages = yield* state.listQueuedSurfaceMessages({
      surfacePiSessionId: target.surfacePiSessionId,
    });
    return {
      target,
      queuedMessages: queuedMessages.map(surfaceQueuedMessageReadModel),
    };
  });
}

function buildCommandInspectorReadModel(
  state: StructuredSessionState["Service"],
  commandId: CommandId,
): Effect.Effect<CommandInspectorReadModel | null, StateContractError> {
  return Effect.gen(function* () {
    const snapshots = yield* state.listSessionStates();
    for (const snapshot of snapshots) {
      const inspector = buildStructuredCommandInspector(snapshot, commandId);
      if (!inspector) continue;
      const command = snapshot.commands.find((candidate) => candidate.id === inspector.commandId);
      if (!command) continue;
      return {
        ...inspector,
        target: commandTarget(snapshot, command),
        acceptedArguments: (command.arguments ?? null) as JsonValueType,
      };
    }
    return null;
  });
}

function buildArtifactInspectorReadModel(
  state: StructuredSessionState["Service"],
  request: ArtifactInspectorReadModelRequest,
): Effect.Effect<ArtifactInspectorReadModel | null, StateContractError> {
  return state.listSessionStates().pipe(
    Effect.map((snapshots) => {
      const snapshot = snapshots.find(
        (candidate) => candidate.session.id === request.workspaceSessionId,
      );
      const artifact = snapshot?.artifacts.find((candidate) => candidate.id === request.artifactId);
      if (!snapshot || !artifact) return null;

      const link = buildStructuredArtifactLink(snapshot, artifact);
      return {
        artifactId: artifact.id,
        workspaceSessionId: artifact.sessionId as WorkspaceSessionId,
        kind: artifact.kind,
        name: artifact.name,
        ...(artifact.path ? { path: artifact.path } : {}),
        mimeType: artifact.mimeType,
        byteSize: artifact.bytes,
        sha256: artifact.sha256,
        immutable: artifact.immutable,
        createdAt: artifact.createdAt,
        deletedAt: artifact.deletedAt,
        ...(link.sourceCommandId ? { sourceCommandId: link.sourceCommandId } : {}),
        ...(link.workflowRunId ? { workflowRunId: link.workflowRunId } : {}),
        ...(link.workflowName ? { workflowName: link.workflowName } : {}),
        ...(link.producerLabel ? { producerLabel: link.producerLabel } : {}),
      };
    }),
  );
}

function buildRequestInputReadModel(
  state: StructuredSessionState["Service"],
  request: RequestInputReadModelRequest,
): Effect.Effect<RequestInputReadModel, StateContractError> {
  return state.listSessionStates().pipe(
    Effect.map((snapshots) => ({
      requests: snapshots
        .flatMap((snapshot) =>
          snapshot.requestUserInputRequests
            .filter(
              (record) =>
                (record.status === "open" || record.status === "completed") &&
                (!request.surfacePiSessionId ||
                  record.surfacePiSessionId === request.surfacePiSessionId) &&
                (!request.requestId || record.requestId === request.requestId),
            )
            .map((record) => requestInputReadModelItem(snapshot, record)),
        )
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
    })),
  );
}

function buildApprovalsReadModel(
  state: StructuredSessionState["Service"],
  request: ApprovalsReadModelRequest,
): Effect.Effect<ApprovalsReadModel, StateContractError> {
  return state.listSessionStates().pipe(
    Effect.map((snapshots) => ({
      requests: snapshots
        .flatMap((snapshot) =>
          (snapshot.runtimeApprovalRequests ?? [])
            .filter(
              (record) =>
                record.status === "pending" &&
                (!request.surfacePiSessionId ||
                  record.surfacePiSessionId === request.surfacePiSessionId) &&
                (!request.requestId || record.requestId === request.requestId),
            )
            .map((record) => approvalReadModelItem(snapshot, record)),
        )
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
    })),
  );
}

function buildAgentsReadModel(
  state: StructuredSessionState["Service"],
  request: AgentsReadModelRequest,
): Effect.Effect<AgentsReadModel, StateContractError> {
  return Effect.gen(function* () {
    const snapshots = yield* state.listSessionStates();
    const persistedProfiles = yield* state.listAgentProfiles();
    const persistedWorkflowAgents = yield* state.listCurrentWorkflowAgentSources();
    const persistedActorExtensionDefaults = yield* state.listAgentActorExtensionDefaults();
    const configuredProfiles = persistedProfiles
      .map(configuredAgentProfileRecord)
      .filter((profile) => (request.profileId ? profile.profileId === request.profileId : true));
    const builtinWorkflowAgentSourceIds = new Set<string>(DEFAULT_WORKFLOW_AGENT_SOURCE_IDS);
    const workflowAgents = persistedWorkflowAgents.map((source) => {
      const builtin = builtinWorkflowAgentSourceIds.has(source.sourceId);
      return {
        sourceId: source.sourceId,
        path: source.path,
        sourceVersion: source.sourceVersion,
        fingerprint: source.fingerprint,
        validationStatus: source.validationStatus,
        diagnostics: source.diagnostics,
        parameters: source.parameters,
        extensionOrder: source.extensionOrder as readonly ExtensionId[],
        observedAt: source.observedAt,
        updatedAt: source.updatedAt as IsoDateTimeString,
        builtin,
        deletable: !builtin && isWorkflowAgentSourceExportName(source.sourceId),
      } satisfies WorkflowAgentSourceReadModelRecord;
    });
    const bindings = snapshots
      .flatMap(agentBindingRecordsFromSnapshot)
      .filter((binding) => (request.profileId ? binding.profileId === request.profileId : true));
    const actorExtensionDefaults = (["orchestrator", "workflow-task"] as const).map((actor) => {
      const persisted = persistedActorExtensionDefaults.find((record) => record.actor === actor);
      return {
        actor,
        extensionUsage: { ...persisted?.extensionUsage },
        extensionOrder: (persisted?.extensionOrder ?? []) as ExtensionId[],
        updatedAt: (persisted?.updatedAt ?? null) as IsoDateTimeString | null,
      };
    });
    const generatedContextPreviews = snapshots
      .flatMap((snapshot) => snapshot.generatedAgentContextBindings)
      .map((binding) => ({
        ownerKind: binding.ownerKind,
        ownerId: binding.ownerId,
        surfacePiSessionId: binding.surfacePiSessionId as SurfacePiSessionId,
        actorKind: binding.actorKind,
        generatedAgentContextFingerprint: binding.generatedAgentContextFingerprint,
        generatedAgentContextRevision: binding.generatedAgentContextRevision,
        loadedExtensionIds: binding.loadedExtensionIds as ExtensionId[],
        availableExtensionIds: binding.availableExtensionIds as ExtensionId[],
        externalSourceHashes: binding.externalSourceHashes,
      }));
    return {
      configuredProfiles,
      workflowAgents,
      actorExtensionDefaults,
      bindings,
      generatedContextPreviews,
    };
  });
}

function buildExtensionsReadModel(
  state: StructuredSessionState["Service"],
  request: ExtensionsReadModelRequest,
): Effect.Effect<ExtensionsReadModel, StateContractError> {
  return Effect.gen(function* () {
    const facts = yield* state.readGeneratedPackageFacts({ packages: ["@svvyx/extensions"] });
    const extensionPackage = facts[0] ?? null;
    const persistedProfiles = yield* state.listAgentProfiles();
    const usage = extensionUsageFromConfiguredAgentRecords(
      persistedProfiles.map(configuredAgentProfileRecord),
    );
    const records = [...usage.entries()]
      .filter(([extensionId]) => (request.extensionId ? extensionId === request.extensionId : true))
      .map(([extensionId, value]) => ({
        extensionId: extensionId as ExtensionId,
        readiness: extensionPackage?.status === "ready" ? ("ready" as const) : ("unknown" as const),
        loadedByProfileIds: [...value.loadedByProfileIds],
        availableByProfileIds: [...value.availableByProfileIds],
        generatedPackageStatus: generatedPackageStatusForReadModel(extensionPackage?.status),
      }))
      .toSorted((left, right) => left.extensionId.localeCompare(right.extensionId));
    return { records, dependencyReadiness: [] };
  });
}

function buildSnippetsReadModel(
  state: StructuredSessionState["Service"],
  request: SnippetsReadModelRequest,
): Effect.Effect<SnippetsReadModel, StateContractError> {
  return state.listSnippets({ workspaceId: request.workspaceId }).pipe(
    Effect.map((rows) => {
      const snippets = rows.map(snippetReadModelRecord);
      return {
        managed: snippets.filter((snippet) => snippet.source === "svvy"),
        discovered: snippets.filter((snippet) => snippet.source !== "svvy"),
        snippets,
      };
    }),
  );
}

function buildWorkflowsGeneratedReadModel(
  state: StructuredSessionState["Service"],
  request: WorkflowsGeneratedReadModelRequest,
): Effect.Effect<WorkflowsGeneratedReadModel, StateContractError> {
  return Effect.gen(function* () {
    const facts = (yield* state.readGeneratedPackageFacts({
      packages: ["@svvyx/workflows"],
    })).filter((fact) => (request.buildId ? fact.buildId === request.buildId : true));
    const buildId = facts[0]?.buildId;
    const exports = buildId ? yield* state.readGeneratedWorkflowsExports({ buildId }) : [];
    return {
      packageName: "@svvyx/workflows" as const,
      facts,
      exports: exports.map((record) => ({
        namespace: record.namespace,
        exportName: record.exportName,
        qualifiedName: record.qualifiedName,
        kind: record.kind,
        generatedCode: record.generatedCode,
        generatedPath: record.generatedPath,
        sourcePath: record.sourcePath,
        agentParameters: record.agentParameters,
        workflowAgentId: record.workflowAgentId,
      })),
    };
  });
}

function buildHandlerInspectorReadModel(
  state: StructuredSessionState["Service"],
  threadId: string,
): Effect.Effect<HandlerInspectorReadModel | null, StateContractError> {
  return state.listSessionStates().pipe(
    Effect.map((snapshots) => {
      for (const snapshot of snapshots) {
        const inspector = buildStructuredHandlerThreadInspector(snapshot, threadId);
        if (inspector) return inspector;
      }
      return null;
    }),
  );
}

function buildWorkflowTaskAttemptInspectorReadModel(
  state: StructuredSessionState["Service"],
  workflowTaskAttemptId: string,
): Effect.Effect<WorkflowTaskAttemptInspectorReadModel | null, StateContractError> {
  return state.listSessionStates().pipe(
    Effect.map((snapshots) => {
      for (const snapshot of snapshots) {
        const inspector = buildStructuredWorkflowTaskAttemptInspector(
          snapshot,
          workflowTaskAttemptId,
        );
        if (inspector) return inspector;
      }
      return null;
    }),
  );
}

function buildWorkspaceChromeReadModel(
  state: StructuredSessionState["Service"],
): Effect.Effect<WorkspaceChromeReadModel, StateContractError> {
  return state.readWorkspaceChrome().pipe(
    Effect.flatMap((record) =>
      decodeUnknownWorkspaceChromeReadModelEffect({
        activeWorkspaceTabId: record.activeWorkspaceTabId,
        tabs: record.tabs,
        knownWorkspaces: record.knownWorkspaces,
      }).pipe(Effect.mapError(workspaceChromeProjectionError)),
    ),
  );
}

function buildWorkspaceLayoutReadModel(
  state: StructuredSessionState["Service"],
  workspaceId: WorkspaceIdType,
): Effect.Effect<WorkspaceLayoutReadModel, StateContractError> {
  return state.readWorkspaceLayout(workspaceId).pipe(
    Effect.flatMap((record) =>
      decodeUnknownWorkspaceLayoutReadModelEffect({
        workspaceId: record.workspaceId,
        slots: record.slots,
      }).pipe(Effect.mapError(workspaceLayoutProjectionError)),
    ),
  );
}

function workspaceChromeProjectionError(cause: Schema.SchemaError): StateContractError {
  return new StateContractError({
    operation: "state.readModels.workspaceChrome",
    reason: "decode-failed",
    message: cause.message,
    cause,
  });
}

function workspaceLayoutProjectionError(cause: Schema.SchemaError): StateContractError {
  return new StateContractError({
    operation: "state.readModels.workspaceLayout",
    reason: "decode-failed",
    message: cause.message,
    cause,
  });
}

function agentBindingRecordsFromSnapshot(
  snapshot: StructuredSessionSnapshot,
): AgentBindingReadModelRecord[] {
  const records: AgentBindingReadModelRecord[] = [];
  const orchestratorProfile = parseJsonRecord(snapshot.pi.orchestratorAgentProfileJson ?? null);
  records.push({
    ownerKind: "session",
    ownerId: snapshot.session.id as WorkspaceSessionId,
    surfacePiSessionId: snapshot.session.orchestratorPiSessionId as SurfacePiSessionId,
    profileId:
      snapshot.pi.orchestratorAgentProfileId ??
      readString(orchestratorProfile, "profileId", "id") ??
      snapshot.session.id,
    actor: "orchestrator",
    name: readString(orchestratorProfile, "name") ?? snapshot.pi.title,
    providerId: (snapshot.pi.provider ??
      readString(orchestratorProfile, "providerId", "provider") ??
      "") as ProviderId | "",
    modelId: (snapshot.pi.model ?? readString(orchestratorProfile, "modelId", "model") ?? "") as
      | ModelId
      | "",
    reasoning: bindingReasoning(orchestratorProfile, snapshot.pi.reasoningEffort),
    followComposer: readBoolean(orchestratorProfile, "followComposer", "updateFromComposer"),
    loadedExtensionIds: (snapshot.pi.loadedExtensionIds ?? []) as ExtensionId[],
    availableExtensionIds: (snapshot.pi.availableExtensionIds ?? []) as ExtensionId[],
    generatedAgentContextFingerprint: snapshot.pi.generatedAgentContextFingerprint ?? null,
    source: "surface-binding",
  });

  for (const thread of snapshot.threads) {
    const profile = parseJsonRecord(thread.agentProfileJson ?? null);
    records.push({
      ownerKind: "thread",
      ownerId: thread.id as ThreadId,
      surfacePiSessionId: thread.surfacePiSessionId as SurfacePiSessionId,
      profileId: (readString(profile, "profileId", "id") ?? "thread-handler") as AgentProfileId,
      actor: "handler",
      name: readString(profile, "name") ?? "Thread handler",
      providerId: (readString(profile, "providerId", "provider") ?? snapshot.pi.provider ?? "") as
        | ProviderId
        | "",
      modelId: (readString(profile, "modelId", "model") ?? snapshot.pi.model ?? "") as ModelId | "",
      reasoning: bindingReasoning(profile),
      followComposer: false,
      loadedExtensionIds: thread.loadedExtensionIds as ExtensionId[],
      availableExtensionIds: thread.availableExtensionIds as ExtensionId[],
      generatedAgentContextFingerprint: thread.generatedAgentContextFingerprint ?? null,
      source: "handler-thread",
    });
  }

  for (const attempt of snapshot.workflowTaskAttempts) {
    records.push({
      ownerKind: "workflow-task-attempt",
      ownerId: attempt.id as WorkflowTaskAttemptId,
      surfacePiSessionId: attempt.surfacePiSessionId
        ? (attempt.surfacePiSessionId as SurfacePiSessionId)
        : null,
      profileId: (attempt.agentId ?? attempt.id) as AgentProfileId,
      actor: "workflow-task",
      name: attempt.title,
      providerId: (attempt.agentEngine ?? "") as ProviderId | "",
      modelId: (attempt.agentModel ?? "") as ModelId | "",
      reasoning: null,
      followComposer: false,
      loadedExtensionIds: [],
      availableExtensionIds: [],
      generatedAgentContextFingerprint: attempt.generatedAgentContextFingerprint ?? null,
      source: "workflow-task-attempt",
    });
  }

  return records;
}

function configuredAgentProfileRecord(
  profile: StructuredAgentProfileRecord,
): ConfiguredAgentProfileReadModelRecord {
  const builtin =
    (profile.actor === "orchestrator" && profile.profileId === "default-orchestrator") ||
    (profile.actor === "handler" && profile.profileId === "thread-handler");
  return {
    profileId: profile.profileId as AgentProfileId,
    actor: profile.actor,
    name: profile.name,
    providerId: profile.providerId as ProviderId | "",
    modelId: profile.modelId as ModelId | "",
    reasoning: profile.reasoning as JsonValueType | null,
    followComposer: profile.followComposer,
    extensionUsage: { ...profile.extensionUsage },
    extensionOrder: profile.extensionOrder as ExtensionId[],
    position: profile.position,
    updatedAt: profile.updatedAt as IsoDateTimeString,
    builtin,
    locked: builtin,
    deletable: profile.actor === "orchestrator" && !builtin,
  };
}

function snippetReadModelRecord(row: StructuredSnippetRecord): SnippetReadModelRecord {
  return {
    id: row.id as SnippetId,
    source: row.source,
    title: row.title,
    body: row.body,
    metadata: row.metadata,
    enabled: row.enabled,
    path: row.path,
    updatedAt: (row.updatedAt ?? row.createdAt) as IsoDateTimeString,
  };
}

function extensionUsageFromConfiguredAgentRecords(
  records: readonly ConfiguredAgentProfileReadModelRecord[],
) {
  const usage = new Map<
    string,
    { loadedByProfileIds: Set<string>; availableByProfileIds: Set<string> }
  >();
  const ensure = (extensionId: string) => {
    const existing = usage.get(extensionId);
    if (existing) return existing;
    const created = {
      loadedByProfileIds: new Set<string>(),
      availableByProfileIds: new Set<string>(),
    };
    usage.set(extensionId, created);
    return created;
  };
  for (const record of records) {
    for (const [extensionId, state] of Object.entries(record.extensionUsage)) {
      if (state === "loaded") {
        ensure(extensionId).loadedByProfileIds.add(record.profileId);
      } else if (state === "available") {
        ensure(extensionId).availableByProfileIds.add(record.profileId);
      }
    }
  }
  return usage;
}

function generatedPackageStatusForReadModel(
  status: StructuredGeneratedPackageFactRecord["status"] | undefined,
): ExtensionReadModelRecord["generatedPackageStatus"] {
  switch (status) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "refresh-needed":
      return "refresh-needed";
    default:
      return "unknown";
  }
}

function refetchSurfaceInvalidation(
  state: StructuredSessionState["Service"],
  surfacePiSessionIds: readonly SurfacePiSessionId[],
): Effect.Effect<readonly StateReadModelResult[], StateContractError> {
  return Effect.gen(function* () {
    const snapshots = yield* state.listSessionStates();
    const results: StateReadModelResult[] = [];
    for (const surfacePiSessionId of surfacePiSessionIds) {
      const target = targetForSurface(snapshots, surfacePiSessionId);
      if (!target) continue;
      results.push(
        {
          kind: "surfaceTranscript",
          value: yield* buildSurfaceTranscriptReadModel(state, {
            kind: "surfaceTranscript",
            target,
          }),
        },
        { kind: "surfaceSummary", value: yield* buildSurfaceSummaryReadModel(state, target) },
        { kind: "surfaceComposer", value: yield* buildSurfaceComposerReadModel(state, target) },
        {
          kind: "surfaceQueuedMessages",
          value: yield* buildSurfaceQueuedMessagesReadModel(state, target),
        },
      );
    }
    return results;
  });
}

function getSnapshotForTarget(
  state: StructuredSessionState["Service"],
  target: RuntimeSurfaceTarget,
): Effect.Effect<StructuredSessionSnapshot, StateContractError> {
  return state.getSessionState(target.workspaceSessionId);
}

function deriveSurfaceStatus(
  snapshot: StructuredSessionSnapshot,
  surfacePiSessionId: string,
): SurfaceTranscriptReadModel["surfaceStatus"] {
  const latestTurn = snapshot.turns
    .filter((turn) => turn.surfacePiSessionId === surfacePiSessionId)
    .toSorted(
      (left, right) =>
        right.startedAt.localeCompare(left.startedAt) ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id),
    )[0];
  if (latestTurn?.status === "failed") return "error";
  if (latestTurn?.status === "waiting") return "waiting";
  if (latestTurn?.status === "running") return "running";
  return "idle";
}

function activeTurnForSurface(snapshot: StructuredSessionSnapshot, surfacePiSessionId: string) {
  return (
    snapshot.turns
      .filter(
        (turn) =>
          turn.surfacePiSessionId === surfacePiSessionId &&
          (turn.status === "running" || turn.status === "waiting"),
      )
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
  );
}

function countQueuedMessages(
  snapshot: StructuredSessionSnapshot,
  surfacePiSessionId: string,
): number {
  return (
    snapshot.queuedMessages?.filter(
      (message) =>
        message.surfacePiSessionId === surfacePiSessionId &&
        (message.status === "queued" ||
          message.status === "steering" ||
          message.status === "dispatching"),
    ).length ?? 0
  );
}

function transcriptMessages(
  transcript: RuntimeSurfaceTranscriptSnapshot,
  request: SurfaceTranscriptReadModelRequest,
): SurfaceTranscriptReadModel["messages"] {
  const messages = transcript.messages;
  const afterIndex = request.afterMessageId
    ? messages.findIndex((message) => message.messageId === request.afterMessageId)
    : -1;
  const sliced = afterIndex >= 0 ? messages.slice(afterIndex + 1) : messages;
  return request.limit ? sliced.slice(-request.limit) : sliced;
}

function surfaceQueuedMessageReadModel(
  record: StructuredSurfaceQueuedMessageRecord,
): SurfaceQueuedMessagesReadModel["queuedMessages"][number] {
  const payload = parseJsonRecord(record.payloadJson);
  return {
    id: record.id as QueueItemId,
    kind: record.kind,
    text: queuedMessageText(record),
    ...(typeof payload.title === "string" ? { title: payload.title } : {}),
    ...(typeof payload.summary === "string" ? { summary: payload.summary } : {}),
    ...(record.threadId ? { threadId: record.threadId } : {}),
    ...(typeof payload.episodeId === "string" ? { episodeId: payload.episodeId } : {}),
    ...(record.sourceCommandId ? { sourceCommandId: record.sourceCommandId as CommandId } : {}),
    status: record.status as SurfaceQueuedMessagesReadModel["queuedMessages"][number]["status"],
    ...(record.failureError ? { failureError: record.failureError } : {}),
    createdAt: record.createdAt as IsoDateTimeString,
    updatedAt: record.updatedAt as IsoDateTimeString,
  };
}

function queuedMessageText(record: StructuredSurfaceQueuedMessageRecord): string {
  const payload = parseJsonRecord(record.payloadJson);
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.summary === "string") return payload.summary;
  const message = parseJsonRecord(record.messageJson);
  if (typeof message.text === "string") return message.text;
  if (message.message && typeof message.message === "object" && "text" in message.message) {
    const text = (message.message as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function requestInputReadModelItem(
  snapshot: StructuredSessionSnapshot,
  record: StructuredSessionSnapshot["requestUserInputRequests"][number],
): RequestInputReadModelRequestItem {
  const thread = record.threadId
    ? snapshot.threads.find((candidate) => candidate.id === record.threadId)
    : null;
  return {
    requestId: record.requestId as RequestInputRequestId,
    workspaceSessionId: record.sessionId as WorkspaceSessionId,
    surfacePiSessionId: record.surfacePiSessionId as SurfacePiSessionId,
    threadId: record.threadId,
    ownerTitle: thread?.title ?? snapshot.pi.title,
    variant: record.variant,
    status: record.status,
    createdAt: record.createdAt as IsoDateTimeString,
    completedAt: (record.completedAt as IsoDateTimeString | null) ?? null,
    timeout: record.timeout as RuntimeRequestInputDetailsRecord["timeout"],
    questions: record.questions.map((question) => ({
      questionId: question.questionId as RequestInputQuestionId,
      ordinal: question.ordinal,
      title: question.title,
      question: question.question,
      defaultAnswer: structuredClone(question.defaultAnswer),
      choices: question.choices.map((choice) => ({
        optionId: choice.optionId as RequestInputOptionId,
        ordinal: choice.ordinal,
        label: choice.label,
        description: choice.description,
        recommended: choice.recommended,
      })),
      status: question.status,
    })),
  };
}

function approvalReadModelItem(
  snapshot: StructuredSessionSnapshot,
  record: StructuredRuntimeApprovalRequestRecord,
): ApprovalReadModelRequestItem {
  const thread = record.threadId
    ? snapshot.threads.find((candidate) => candidate.id === record.threadId)
    : null;
  return {
    requestId: record.requestId as RuntimeApprovalId,
    workspaceSessionId: record.sessionId as WorkspaceSessionId,
    surfacePiSessionId: record.surfacePiSessionId as SurfacePiSessionId,
    threadId: record.threadId,
    ownerTitle: thread?.title ?? snapshot.pi.title,
    toolName: record.toolName,
    approvalMode: record.approvalMode,
    cwd: record.cwd,
    command: record.command,
    commandFamily: record.commandFamily,
    snippetArtifactId: record.snippetArtifactId,
    status: record.status,
    createdAt: record.createdAt as IsoDateTimeString,
    completedAt: (record.completedAt as IsoDateTimeString | null) ?? null,
    summary:
      record.toolName === "exec_command" && record.command
        ? `Run command: ${record.command}`
        : record.toolName === "apply_patch"
          ? "Apply patch"
          : "Run TypeScript",
  };
}

function commandTarget(
  snapshot: StructuredSessionSnapshot,
  command: StructuredCommandRecord,
): RuntimeSurfaceTarget {
  if (command.workflowTaskAttemptId) {
    const attempt = snapshot.workflowTaskAttempts.find(
      (candidate) => candidate.id === command.workflowTaskAttemptId,
    );
    return {
      workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
      surface: "workflow-task",
      surfacePiSessionId: command.surfacePiSessionId as SurfacePiSessionId,
      workflowTaskAttemptId: command.workflowTaskAttemptId as never,
      ...(attempt?.workflowRunId ? { workflowRunId: attempt.workflowRunId as never } : {}),
      threadId: (command.threadId ?? attempt?.threadId ?? "") as never,
    };
  }
  if (command.threadId) {
    return {
      workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
      surface: "handler",
      surfacePiSessionId: command.surfacePiSessionId as SurfacePiSessionId,
      threadId: command.threadId as never,
    };
  }
  return {
    workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId: (command.surfacePiSessionId ?? snapshot.pi.sessionId) as SurfacePiSessionId,
  };
}

function targetForSurface(
  snapshots: readonly StructuredSessionSnapshot[],
  surfacePiSessionId: SurfacePiSessionId,
): RuntimeSurfaceTarget | null {
  for (const snapshot of snapshots) {
    if (snapshot.pi.sessionId === surfacePiSessionId) {
      return {
        workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
        surface: "orchestrator",
        surfacePiSessionId,
      };
    }
    const thread = snapshot.threads.find(
      (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
    );
    if (thread) {
      return {
        workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
        surface: "handler",
        surfacePiSessionId,
        threadId: thread.id as never,
      };
    }
    const attempt = snapshot.workflowTaskAttempts.find(
      (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
    );
    if (attempt) {
      return {
        workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
        surface: "workflow-task",
        surfacePiSessionId,
        workflowTaskAttemptId: attempt.id as never,
        workflowRunId: attempt.workflowRunId as never,
        threadId: attempt.threadId as never,
      };
    }
  }
  return null;
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readString(record: Record<string, unknown>, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, ...keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return false;
}

function bindingReasoning(
  profile: Record<string, unknown>,
  liveReasoningEffort?: string,
): JsonValueType | null {
  if (liveReasoningEffort) return { effort: liveReasoningEffort };
  const reasoning = profile.reasoning;
  if (reasoning !== undefined) return reasoning as JsonValueType;
  const reasoningEffort = readString(profile, "reasoningEffort");
  return reasoningEffort ? { effort: reasoningEffort } : null;
}

function stateCommandsFromState(state: {
  appLogs: AppLogStateResolver;
  structuredSession: StructuredSessionStateResolver;
}): StateCommands["Service"] {
  const receipts = new Map<string, StateMutationResult<StateCommandResult>>();

  const runCommand = <
    Input extends { clientSubmission: RuntimeClientSubmissionInput; readAt: IsoDateTimeString },
  >(
    input: Input,
    commit: () => Effect.Effect<AppLogSummary, StateContractError>,
  ) =>
    Effect.gen(function* () {
      const clientRequestId = input.clientSubmission.clientRequestId;
      if (clientRequestId) {
        const existing = receipts.get(clientRequestId);
        if (existing) return duplicateMutationResult(existing);
      }
      const summary = yield* commit();
      const value: StateCommandResult = {
        receipt: {
          clientRequestId: clientRequestId ?? null,
          outcome: "applied",
          committedAt: input.readAt as StateCommandReceipt["committedAt"],
          stateRevision: summary.latestSeq as StateRevision,
        },
      };
      const result = mutationResult(
        value,
        appLogReadStateInvalidations((input as { workspaceId?: WorkspaceIdType }).workspaceId),
      );
      if (clientRequestId) receipts.set(clientRequestId, result);
      return result;
    });

  return StateCommands.of({
    workspaceChrome: {
      setTabs: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetWorkspaceTabsInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          const subject = decoded.activeWorkspaceTabId ?? "workspace-tabs";
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.workspaceChrome.setTabs",
            decoded,
            subject,
            () => structuredSession.setWorkspaceTabs(decoded),
            workspaceChromeStateInvalidations(),
          );
        }),
      selectTab: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSelectWorkspaceTabInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.workspaceChrome.selectTab",
            decoded,
            decoded.workspaceTabId,
            () => structuredSession.selectWorkspaceTab(decoded),
            workspaceChromeStateInvalidations(),
          );
        }),
      selectLayoutSlot: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSelectWorkspaceLayoutSlotInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.workspaceChrome.selectLayoutSlot",
            decoded,
            `${decoded.workspaceTabId}:${decoded.layoutId}`,
            () => structuredSession.selectWorkspaceLayoutSlot(decoded),
            workspaceChromeStateInvalidations(),
          );
        }),
    },
    workspaceLayout: {
      saveSlot: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSaveWorkspaceLayoutSlotInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.workspaceLayout.saveSlot",
            decoded,
            `${decoded.workspaceId}:${decoded.layoutId}`,
            () => structuredSession.saveWorkspaceLayoutSlot(decoded),
            workspaceLayoutStateInvalidations(decoded.workspaceId, decoded.layoutId),
          );
        }),
    },
    sessionNavigation: {
      setPinned: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetSessionPinnedInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          yield* structuredSession.getSessionState(decoded.workspaceSessionId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.sessionNavigation.setPinned",
            decoded,
            `${decoded.workspaceId}:${decoded.workspaceSessionId}`,
            () =>
              structuredSession.applySessionNavigationCommand({
                kind: "set-pinned",
                sessionId: decoded.workspaceSessionId,
                pinned: decoded.pinned,
              }),
            sessionNavigationStateInvalidations(decoded.workspaceId),
          );
        }),
      setArchived: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetSessionArchivedInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          yield* structuredSession.getSessionState(decoded.workspaceSessionId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.sessionNavigation.setArchived",
            decoded,
            `${decoded.workspaceId}:${decoded.workspaceSessionId}`,
            () =>
              structuredSession.applySessionNavigationCommand({
                kind: "set-archived",
                sessionId: decoded.workspaceSessionId,
                archived: decoded.archived,
              }),
            sessionNavigationStateInvalidations(decoded.workspaceId),
          );
        }),
      markRead: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeMarkSessionReadInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          yield* structuredSession.getSessionState(decoded.workspaceSessionId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.sessionNavigation.markRead",
            decoded,
            `${decoded.workspaceId}:${decoded.workspaceSessionId}`,
            () =>
              structuredSession.applySessionNavigationCommand({
                kind: "mark-read",
                sessionId: decoded.workspaceSessionId,
              }),
            sessionNavigationStateInvalidations(decoded.workspaceId),
          );
        }),
      markUnread: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeMarkSessionUnreadInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          yield* structuredSession.getSessionState(decoded.workspaceSessionId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.sessionNavigation.markUnread",
            decoded,
            `${decoded.workspaceId}:${decoded.workspaceSessionId}`,
            () =>
              structuredSession.applySessionNavigationCommand({
                kind: "mark-unread",
                sessionId: decoded.workspaceSessionId,
              }),
            sessionNavigationStateInvalidations(decoded.workspaceId),
          );
        }),
      setSectionState: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetSessionNavigationSectionStateInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.sessionNavigation.setSectionState",
            decoded,
            `${decoded.workspaceId}:${decoded.section}`,
            () =>
              structuredSession.applySessionNavigationCommand({
                kind: "set-section-state",
                section: decoded.section,
                ...(decoded.collapsed !== undefined ? { collapsed: decoded.collapsed } : {}),
                ...(decoded.sizePx !== undefined ? { sizePx: decoded.sizePx } : {}),
              }),
            sessionNavigationStateInvalidations(decoded.workspaceId),
          );
        }),
    },
    appLogs: {
      markRead: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeMarkAppLogReadInput(commandInput);
          const appLogs = yield* state.appLogs(decoded.workspaceId);
          return yield* runCommand(decoded, () => markAppLogEntriesRead(appLogs, decoded.entryIds));
        }),
      markVisibleRangeRead: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeMarkVisibleAppLogRangeReadInput(commandInput);
          const appLogs = yield* state.appLogs(decoded.workspaceId);
          return yield* runCommand(decoded, () =>
            markAppLogEntriesRead(appLogs, [
              decoded.newestVisibleEntryId,
              decoded.oldestVisibleEntryId,
            ]),
          );
        }),
      clearWorkspaceUnread: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeClearWorkspaceAppLogUnreadInput(commandInput);
          const appLogs = yield* state.appLogs(decoded.workspaceId);
          return yield* runCommand(decoded, () =>
            Effect.gen(function* () {
              const summary = yield* appLogs.summary();
              return yield* appLogs.markSeen(summary.latestSeq);
            }),
          );
        }),
    },
    appPreferences: {
      update: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeUpdateAppPreferencesInput(commandInput);
          const clientRequestId = decoded.clientSubmission?.clientRequestId;
          if (clientRequestId) {
            const existing = receipts.get(clientRequestId);
            if (existing) return duplicateMutationResult(existing);
          }
          const structuredSession = yield* state.structuredSession(undefined);
          const updatedAt = yield* structuredSession.getCurrentTimestamp();
          const updated = yield* structuredSession.updateAppPreferences({
            ...decoded.patch,
            updatedAt,
          });
          const value: StateCommandResult = {
            receipt: {
              clientRequestId: clientRequestId ?? null,
              outcome: "applied",
              committedAt: updated.updatedAt as StateCommandReceipt["committedAt"],
              stateRevision: updated.stateRevision,
            },
          };
          const result = mutationResult(value, appPreferencesStateInvalidations());
          if (clientRequestId) receipts.set(clientRequestId, result);
          return result;
        }),
    },
    providerAuth: {
      recordStatus: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeRecordProviderAuthStatusInput(commandInput);
          const clientRequestId = decoded.clientSubmission?.clientRequestId;
          if (clientRequestId) {
            const existing = receipts.get(clientRequestId);
            if (existing) return duplicateMutationResult(existing);
          }
          const structuredSession = yield* state.structuredSession(decoded.status.workspaceId);
          const record = yield* structuredSession.recordProviderAuthStatus({
            status: decoded.status,
            observedAt: decoded.observedAt,
            source: decoded.source,
          });
          const value: StateCommandResult = {
            receipt: {
              clientRequestId: clientRequestId ?? null,
              outcome: "applied",
              committedAt: decoded.observedAt as StateCommandReceipt["committedAt"],
              stateRevision: record.stateRevision,
            },
          };
          const result = mutationResult(value, providerAuthStateInvalidations(record.status));
          if (clientRequestId) receipts.set(clientRequestId, result);
          return result;
        }),
    },
    extensionEnv: {
      setOverride: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetExtensionEnvOverrideInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.extensionEnv.setOverride",
            decoded,
            `${decoded.extensionId}:${decoded.envName}`,
            () => structuredSession.setExtensionEnvOverride(decoded),
            extensionEnvStateInvalidations(decoded.extensionId),
          );
        }),
      removeOverride: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeRemoveExtensionEnvOverrideInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.extensionEnv.removeOverride",
            decoded,
            `${decoded.extensionId}:${decoded.envName}`,
            () => structuredSession.removeExtensionEnvOverride(decoded),
            extensionEnvStateInvalidations(decoded.extensionId),
          );
        }),
    },
    agentProfiles: {
      updateOrchestrator: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeUpdateOrchestratorProfileInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.updateOrchestrator",
            decoded,
            decoded.profile.profileId,
            () => structuredSession.updateOrchestratorProfile(decoded),
            agentsStateInvalidations(decoded.profile.profileId),
          );
        }),
      updateThreadHandler: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeUpdateThreadHandlerProfileInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.updateThreadHandler",
            decoded,
            decoded.profile.profileId,
            () => structuredSession.updateThreadHandlerProfile(decoded),
            agentsStateInvalidations(decoded.profile.profileId),
          );
        }),
      deleteOrchestrator: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeDeleteOrchestratorProfileInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.deleteOrchestrator",
            decoded,
            decoded.profileId,
            () => structuredSession.deleteOrchestratorProfile(decoded),
            agentsStateInvalidations(decoded.profileId),
          );
        }),
      reorderOrchestrators: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeReorderOrchestratorProfilesInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.reorderOrchestrators",
            decoded,
            decoded.profileIds.join(","),
            () => structuredSession.reorderOrchestratorProfiles(decoded),
            agentsStateInvalidations(),
          );
        }),
      setProfileExtensionUsage: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetProfileExtensionUsageInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.setProfileExtensionUsage",
            decoded,
            `${decoded.actor}:${decoded.profileId}:${decoded.extensionId}`,
            () => structuredSession.setProfileExtensionUsage(decoded),
            agentsStateInvalidations(decoded.profileId),
          );
        }),
      promoteExtensionDefault: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodePromoteProfileExtensionDefaultInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.promoteExtensionDefault",
            decoded,
            `${decoded.actor}:${decoded.profileId}:${decoded.extensionId}`,
            () => structuredSession.promoteProfileExtensionDefault(decoded),
            agentsStateInvalidations(decoded.profileId),
          );
        }),
      resetActorExtensionDefaults: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeResetActorExtensionDefaultsInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.resetActorExtensionDefaults",
            decoded,
            `${decoded.actor}:${decoded.reset}`,
            () => structuredSession.resetActorExtensionDefaults(decoded),
            agentsStateInvalidations(),
          );
        }),
      setActorExtensionDefaults: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetAgentActorExtensionDefaultsInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.setActorExtensionDefaults",
            decoded,
            decoded.actor,
            () => structuredSession.setAgentActorExtensionDefaults(decoded),
            agentsStateInvalidations(),
          );
        }),
      setExternalInstructionActorUsage: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetExternalInstructionActorUsageInput(commandInput);
          const structuredSession = yield* state.structuredSession(undefined);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.agentProfiles.setExternalInstructionActorUsage",
            decoded,
            `${decoded.actor}:${decoded.profileId}:${decoded.sourceId}`,
            () => structuredSession.setExternalInstructionActorUsage(decoded),
            agentsStateInvalidations(decoded.profileId),
          );
        }),
    },
    snippets: {
      createManaged: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeCreateManagedSnippetInput(commandInput);
          const workspaceId = decoded.workspaceId;
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          const clientRequestId = decoded.clientSubmission?.clientRequestId;
          const receiptKey = `stateCommands.snippets.createManaged:${workspaceId}:${decoded.title}:${clientRequestId ?? "single-shot"}`;
          if (clientRequestId) {
            const existing = receipts.get(receiptKey);
            if (existing)
              return duplicateMutationResult(existing) as StateMutationResult<
                StateCommandResult<{ snippetId: SnippetId }>
              >;
          }
          const created = yield* structuredSession.createManagedSnippet(decoded);
          const value: StateCommandResult<{ snippetId: SnippetId }> = {
            snippetId: created.id as SnippetId,
            receipt: {
              clientRequestId: clientRequestId ?? null,
              outcome: "applied",
              committedAt: created.updatedAt as StateCommandReceipt["committedAt"],
              stateRevision: created.stateRevision,
            },
          };
          const result = mutationResult(
            value,
            snippetStateInvalidations(workspaceId, created.id as SnippetId),
          );
          if (clientRequestId) receipts.set(receiptKey, result);
          return result;
        }),
      updateManaged: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeUpdateManagedSnippetInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.snippets.updateManaged",
            decoded,
            `${decoded.workspaceId}:${decoded.snippetId}`,
            () => structuredSession.updateManagedSnippet(decoded),
            snippetStateInvalidations(decoded.workspaceId, decoded.snippetId),
          );
        }),
      deleteManaged: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeDeleteManagedSnippetInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.snippets.deleteManaged",
            decoded,
            `${decoded.workspaceId}:${decoded.snippetId}`,
            () => structuredSession.deleteManagedSnippet(decoded),
            snippetStateInvalidations(decoded.workspaceId, decoded.snippetId),
          );
        }),
      setEnabled: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeSetSnippetEnabledInput(commandInput);
          const structuredSession = yield* state.structuredSession(decoded.workspaceId);
          return yield* commitStructuredCommand(
            receipts,
            "stateCommands.snippets.setEnabled",
            decoded,
            `${decoded.workspaceId}:${decoded.snippetId}`,
            () => structuredSession.setSnippetEnabled(decoded),
            snippetStateInvalidations(decoded.workspaceId, decoded.snippetId),
          );
        }),
    },
  });
}

function commitStructuredCommand<
  Decoded extends { clientSubmission?: RuntimeClientSubmissionInput },
>(
  receipts: Map<string, StateMutationResult<StateCommandResult>>,
  operation: string,
  decoded: Decoded,
  subject: string,
  commit: () => Effect.Effect<
    {
      updatedAt: string;
      stateRevision: StateRevision;
      outcome?: "committed" | "no-op";
    },
    StateContractError
  >,
  afterCommit: readonly StateInvalidationDescriptor[],
): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError> {
  return Effect.gen(function* () {
    const clientRequestId = decoded.clientSubmission?.clientRequestId;
    const receiptKey = `${operation}:${subject}:${clientRequestId ?? "single-shot"}`;
    if (clientRequestId) {
      const existing = receipts.get(receiptKey);
      if (existing) return duplicateMutationResult(existing);
    }
    const committed = yield* commit();
    const value: StateCommandResult = {
      receipt: {
        clientRequestId: clientRequestId ?? null,
        outcome: "applied",
        committedAt: committed.updatedAt as StateCommandReceipt["committedAt"],
        stateRevision: committed.stateRevision,
      },
    };
    const result = mutationResult(value, committed.outcome === "no-op" ? [] : afterCommit);
    if (clientRequestId) receipts.set(receiptKey, result);
    return result;
  });
}

function markAppLogEntriesRead(
  appLogs: AppLogState["Service"],
  entryIds: readonly AppLogEntryId[],
): Effect.Effect<AppLogSummary, StateContractError> {
  if (entryIds.length === 0) return appLogs.summary();
  const maxSeq = entryIds.reduce((max, entryId) => Math.max(max, appLogEntrySeq(entryId)), 0);
  return appLogs.markSeen(maxSeq);
}

function appLogEntrySeq(entryId: AppLogEntryId): number {
  const match = /^app-log-(\d+)$/.exec(entryId);
  return match ? Number(match[1]) : 0;
}

function duplicateMutationResult<T extends StateCommandResult>(
  result: StateMutationResult<T>,
): StateMutationResult<T> {
  return mutationResult(
    {
      ...result.value,
      receipt: {
        ...result.value.receipt,
        outcome: "duplicate",
      },
    } as T,
    [],
  );
}

function appLogReadStateInvalidations(
  workspaceId: WorkspaceIdType | undefined,
): readonly StateInvalidationDescriptor[] {
  return workspaceId
    ? [{ scope: "workspace", workspaceId, invalidation: { model: "appLogs" } }]
    : [{ scope: "app", invalidation: { model: "appLogs" } }];
}

function appPreferencesStateInvalidations(): readonly StateInvalidationDescriptor[] {
  return [
    { scope: "app", invalidation: { model: "appPreferences" } },
    { scope: "app", invalidation: { model: "settings" } },
  ];
}

function providerAuthStateInvalidations(
  status: ProviderAuthStatus,
): readonly StateInvalidationDescriptor[] {
  return [{ scope: "app", invalidation: { model: "providerAuth", ids: [status.providerId] } }];
}

function workspaceChromeStateInvalidations(): readonly StateInvalidationDescriptor[] {
  return [{ scope: "app", invalidation: { model: "workspaceChrome" } }];
}

function workspaceLayoutStateInvalidations(
  workspaceId: WorkspaceIdType,
  layoutId: WorkspaceLayoutSlotId,
): readonly StateInvalidationDescriptor[] {
  return [
    {
      scope: "workspace",
      workspaceId,
      invalidation: { model: "workspaceLayout", ids: [layoutId] },
    },
  ];
}

function sessionNavigationStateInvalidations(
  workspaceId: WorkspaceIdType,
): readonly StateInvalidationDescriptor[] {
  return [
    {
      scope: "workspace",
      workspaceId,
      invalidation: { model: "sessionNavigation" },
    },
  ];
}

function extensionEnvStateInvalidations(
  extensionId: ExtensionId,
): readonly StateInvalidationDescriptor[] {
  return [{ scope: "app", invalidation: { model: "extensions", ids: [extensionId] } }];
}

function agentsStateInvalidations(
  profileId?: AgentProfileId | string,
): readonly StateInvalidationDescriptor[] {
  return [
    profileId
      ? { scope: "app", invalidation: { model: "agents", ids: [profileId as AgentProfileId] } }
      : { scope: "app", invalidation: { model: "agents" } },
  ];
}

function snippetStateInvalidations(
  workspaceId: WorkspaceIdType,
  snippetId: SnippetId,
): readonly StateInvalidationDescriptor[] {
  return [
    { scope: "workspace", workspaceId, invalidation: { model: "snippets", ids: [snippetId] } },
  ];
}

function appPreferencesReadModel(record: StructuredAppPreferencesRecord): AppPreferencesReadModel {
  return {
    appearance: record.appearance,
    externalEditor: record.externalEditor,
    artifactDirectory: record.artifactDirectory,
    approvalMode: record.approvalMode,
    networkAccess: record.networkAccess,
    externalInstructions: record.externalInstructions,
    ambientResources: record.ambientResources,
    updatedAt: record.updatedAt as IsoDateTimeString,
    revision: record.stateRevision,
  };
}

function providerAuthReadModel(providers: readonly ProviderAuthStatus[]): ProviderAuthReadModel {
  return {
    providers,
    usableModelProviders: providers
      .filter((provider) => provider.health === "usable")
      .map((provider) => provider.providerId),
  };
}

function runStateFacadeEffect<A, E, R>(input: {
  managedRuntime: ManagedRuntime.ManagedRuntime<R, unknown>;
  operation: string;
  effect: Effect.Effect<A, E, R>;
  options: StateFacadeCallOptions | undefined;
  closed: boolean;
}): Promise<A> {
  if (input.closed) {
    return Promise.reject(
      new StateFacadeError({ type: "state-facade-error", reason: "disposed" }, input.operation),
    );
  }
  if (input.options?.signal?.aborted) {
    return Promise.reject(
      new StateFacadeError({ type: "state-facade-error", reason: "aborted" }, input.operation),
    );
  }

  return input.managedRuntime
    .runPromiseExit(input.effect, { signal: input.options?.signal })
    .then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw stateFacadeErrorFromCause(input.operation, exit.cause);
    });
}

function stateFacadeErrorFromCause(
  operation: string,
  cause: Cause.Cause<unknown>,
): StateFacadeError {
  const failure = cause.reasons.find(Cause.isFailReason);
  if (failure) {
    const value = failure.error;
    if (value instanceof StateFacadeError) return value;
    if (value instanceof StateContractError) {
      return new StateFacadeError(
        { type: "state-facade-error", reason: "typed-failure", error: value },
        operation,
      );
    }
    if (isPostCommitNotificationFailure(value)) {
      return new StateFacadeError(value.contract, operation);
    }
  }

  const defect = cause.reasons.find(Cause.isDieReason);
  if (defect) {
    const defectValue = defect.defect;
    return new StateFacadeError(
      {
        type: "state-facade-error",
        reason: "defect",
        message: defectMessage(defectValue),
        ...(defectValue instanceof Error ? { defectClass: defectValue.constructor.name } : {}),
      },
      operation,
    );
  }

  if (Cause.hasInterruptsOnly(cause) || cause.reasons.some(Cause.isInterruptReason)) {
    return new StateFacadeError({ type: "state-facade-error", reason: "interrupted" }, operation);
  }
  return new StateFacadeError(
    {
      type: "state-facade-error",
      reason: "defect",
      message: defectMessage(Cause.squash(cause)),
    },
    operation,
  );
}

function defectMessage(defect: unknown): string {
  if (defect instanceof Error && defect.message.trim().length > 0) return defect.message;
  if (typeof defect === "string" && defect.trim().length > 0) return defect;
  if (
    defect &&
    typeof defect === "object" &&
    "message" in defect &&
    typeof defect.message === "string" &&
    defect.message.trim().length > 0
  ) {
    return defect.message;
  }
  return "State facade defect.";
}

export class StateFacadeError extends Error {
  readonly name = "StateFacadeError";
  readonly type: StateFacadeErrorContract["type"];
  readonly reason: StateFacadeErrorContract["reason"];

  constructor(
    readonly contract: StateFacadeErrorContract,
    readonly operation: string,
  ) {
    super(stateFacadeErrorMessage(contract));
    this.type = contract.type;
    this.reason = contract.reason;
  }
}

function stateFacadeErrorMessage(contract: StateFacadeErrorContract): string {
  switch (contract.reason) {
    case "typed-failure":
      return contract.error.message;
    case "post-commit-notification-failed":
      return contract.message;
    case "defect":
      return contract.message;
    case "interrupted":
      return contract.interruptReason ?? "State facade operation was interrupted.";
    case "aborted":
      return "State facade operation was aborted.";
    case "disposed":
      return "State facade is closed.";
  }
}

class PostCommitNotificationFailure {
  constructor(readonly contract: StateFacadeErrorContract) {}
}

function isPostCommitNotificationFailure(value: unknown): value is PostCommitNotificationFailure {
  return value instanceof PostCommitNotificationFailure;
}

function postCommitNotificationError(
  operation: string,
  receipt: StateCommandReceipt,
  descriptors: readonly StateInvalidationDescriptor[],
  cause: Cause.Cause<unknown>,
): PostCommitNotificationFailure {
  const notificationError = stateCommandPostCommitNotificationError(
    operation,
    receipt,
    descriptors,
    Cause.squash(cause),
  );
  return new PostCommitNotificationFailure({
    type: "state-facade-error",
    reason: "post-commit-notification-failed",
    receipt,
    notificationError,
    message: `${operation} committed but state invalidation publication failed: ${notificationError.message}`,
  });
}

function stateCommandPostCommitNotificationError(
  operation: string,
  receipt: StateCommandReceipt,
  descriptors: readonly StateInvalidationDescriptor[],
  cause: unknown,
): StateCommandPostCommitNotificationError {
  if (
    cause &&
    typeof cause === "object" &&
    "type" in cause &&
    cause.type === "state-command-post-commit-notification-error" &&
    "reason" in cause &&
    (cause.reason === "publication-failed" ||
      cause.reason === "runtime-shutdown" ||
      cause.reason === "runtime-disposed") &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause as StateCommandPostCommitNotificationError;
  }
  return {
    type: "state-command-post-commit-notification-error",
    operation,
    reason: "publication-failed",
    receipt,
    message: defectMessage(cause),
    affectedReadModels: descriptors,
  };
}

const decodeMarkAppLogReadInput = (input: unknown) =>
  decodeUnknownMarkAppLogReadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.markRead")),
  );

const decodeMarkVisibleAppLogRangeReadInput = (input: unknown) =>
  decodeUnknownMarkVisibleAppLogRangeReadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.markVisibleRangeRead")),
  );

const decodeClearWorkspaceAppLogUnreadInput = (input: unknown) =>
  decodeUnknownClearWorkspaceAppLogUnreadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.clearWorkspaceUnread")),
  );

const decodeSetSessionPinnedInput = (input: unknown) =>
  decodeUnknownSetSessionPinnedCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.sessionNavigation.setPinned")),
  );

const decodeSetSessionArchivedInput = (input: unknown) =>
  decodeUnknownSetSessionArchivedCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.sessionNavigation.setArchived")),
  );

const decodeMarkSessionReadInput = (input: unknown) =>
  decodeUnknownMarkSessionReadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.sessionNavigation.markRead")),
  );

const decodeMarkSessionUnreadInput = (input: unknown) =>
  decodeUnknownMarkSessionUnreadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.sessionNavigation.markUnread")),
  );

const decodeSetSessionNavigationSectionStateInput = (input: unknown) =>
  decodeUnknownSetSessionNavigationSectionStateCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.sessionNavigation.setSectionState")),
  );

const decodeUpdateAppPreferencesInput = (input: unknown) =>
  decodeUnknownUpdateAppPreferencesCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appPreferences.update")),
  );

const decodeRecordProviderAuthStatusInput = (input: unknown) =>
  decodeUnknownRecordProviderAuthStatusCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.providerAuth.recordStatus")),
  );

const decodeSetWorkspaceTabsInput = (input: unknown) =>
  decodeUnknownSetWorkspaceTabsCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.workspaceChrome.setTabs")),
  );

const decodeSelectWorkspaceTabInput = (input: unknown) =>
  decodeUnknownSelectWorkspaceTabCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.workspaceChrome.selectTab")),
  );

const decodeSelectWorkspaceLayoutSlotInput = (input: unknown) =>
  decodeUnknownSelectWorkspaceLayoutSlotCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.workspaceChrome.selectLayoutSlot")),
  );

const decodeSaveWorkspaceLayoutSlotInput = (input: unknown) =>
  decodeUnknownSaveWorkspaceLayoutSlotCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.workspaceLayout.saveSlot")),
  );

const decodeSetExtensionEnvOverrideInput = (input: unknown) =>
  decodeUnknownSetExtensionEnvOverrideCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.extensionEnv.setOverride")),
  );

const decodeRemoveExtensionEnvOverrideInput = (input: unknown) =>
  decodeUnknownRemoveExtensionEnvOverrideCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.extensionEnv.removeOverride")),
  );

const decodeUpdateOrchestratorProfileInput = (input: unknown) =>
  decodeUnknownUpdateOrchestratorProfileCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.agentProfiles.updateOrchestrator")),
  );

const decodeUpdateThreadHandlerProfileInput = (input: unknown) =>
  decodeUnknownUpdateThreadHandlerProfileCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.agentProfiles.updateThreadHandler")),
  );

const decodeDeleteOrchestratorProfileInput = (input: unknown) =>
  decodeUnknownDeleteOrchestratorProfileCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.agentProfiles.deleteOrchestrator")),
  );

const decodeReorderOrchestratorProfilesInput = (input: unknown) =>
  decodeUnknownReorderOrchestratorProfilesCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.agentProfiles.reorderOrchestrators")),
  );

const decodeSetProfileExtensionUsageInput = (input: unknown) =>
  decodeUnknownSetProfileExtensionUsageCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.agentProfiles.setProfileExtensionUsage")),
  );

const decodePromoteProfileExtensionDefaultInput = (input: unknown) =>
  decodeUnknownPromoteProfileExtensionDefaultCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.agentProfiles.promoteExtensionDefault")),
  );

const decodeResetActorExtensionDefaultsInput = (input: unknown) =>
  decodeUnknownResetActorExtensionDefaultsCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.agentProfiles.resetActorExtensionDefaults")),
  );

const decodeSetAgentActorExtensionDefaultsInput = (input: unknown) =>
  decodeUnknownSetAgentActorExtensionDefaultsCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.agentProfiles.setActorExtensionDefaults")),
  );

const decodeSetExternalInstructionActorUsageInput = (input: unknown) =>
  decodeUnknownSetExternalInstructionActorUsageCommandInputEffect(input).pipe(
    Effect.mapError(
      commandDecodeError("stateCommands.agentProfiles.setExternalInstructionActorUsage"),
    ),
  );

const decodeCreateManagedSnippetInput = (input: unknown) =>
  decodeUnknownCreateManagedSnippetCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.snippets.createManaged")),
  );

const decodeUpdateManagedSnippetInput = (input: unknown) =>
  decodeUnknownUpdateManagedSnippetCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.snippets.updateManaged")),
  );

const decodeDeleteManagedSnippetInput = (input: unknown) =>
  decodeUnknownDeleteManagedSnippetCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.snippets.deleteManaged")),
  );

const decodeSetSnippetEnabledInput = (input: unknown) =>
  decodeUnknownSetSnippetEnabledCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.snippets.setEnabled")),
  );

function commandDecodeError(operation: string) {
  return (cause: Schema.SchemaError) =>
    new StateContractError({
      operation,
      reason: "invalid-input",
      message: cause.message,
      cause,
    });
}
