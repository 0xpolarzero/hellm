import type { RendererTranscriptUserEntry } from "./renderer-transcript";
import type {
  AgentProfileId,
  AppPreferences,
  ReasoningEffort,
  WorkflowAgentKey,
} from "./agent-settings";
import type { FileBackedSaveMode } from "./file-backed-edit";
import type {
  ExtensionCategory,
  ExtensionInterfaceKind,
  ExtensionUsageState,
  SessionNavigationReadModel as CoreSessionNavigationReadModel,
  SessionNavigationSidebarHandlerThreadRow as CoreSessionNavigationSidebarHandlerThreadRow,
  SessionNavigationSidebarRowSubtitle as CoreSessionNavigationSidebarRowSubtitle,
  SessionNavigationSidebarWorkflowRow as CoreSessionNavigationSidebarWorkflowRow,
  SessionNavigationStatus as CoreSessionNavigationStatus,
  SessionNavigationSummary as CoreSessionNavigationSummary,
  SessionNavigationTitleGenerationStatus as CoreSessionNavigationTitleGenerationStatus,
  WorkspaceSessionNavigationSectionId,
  WorkspaceSessionNavigationSectionState,
  WorkspaceChromeReadModel as CoreWorkspaceChromeReadModel,
  WorkspaceLayoutReadModel as CoreWorkspaceLayoutReadModel,
  WorkspaceLayoutSlotId as CoreWorkspaceLayoutSlotId,
  WorkspaceLayoutSlotReadModel as CoreWorkspaceLayoutSlotReadModel,
  WorkspacePaneRecord as CoreWorkspacePaneRecord,
  WorkspacePaneTarget as CoreWorkspacePaneTarget,
  WorkspaceTabRecord as CoreWorkspaceTabRecord,
  WorkspaceKind as CoreWorkspaceKind,
} from "@svvy/core";
import type { ComposerSnippetMention, SentSnippetProvenance } from "./snippets";
import type { GeneratedAgentContextExternalSource } from "./generated-agent-context";
import type {
  AnswerRequestInputResult,
  AnswerRuntimeApprovalResult,
  AppLogLevel,
  AppLogQuery,
  AppLogReadModel,
  AppLogSummary,
  CommandId,
  CreateSurfaceResult,
  JsonValue,
  ListModelsInput,
  MessageId,
  ModelInfo,
  PositiveSafeInteger,
  ProviderAuthStatus,
  ProviderId,
  QueueItemId,
  RequestInputRequestId,
  RuntimeApprovalId,
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  RuntimeMessageDelivery,
  RequestInputSettings,
  SetRequestInputBlockingTimeoutInput,
  SetRequestInputBlockingTimeoutResult,
  SetRequestInputVariantInput,
  SetRequestInputVariantResult,
  OpenExtensionSourceEditInput,
  RuntimeCreateWorkflowAgentSourceInput,
  RuntimeDeleteWorkflowAgentSourceInput,
  RuntimeDuplicateWorkflowAgentSourceInput,
  RuntimeSurfaceTarget,
  RuntimeSaveExtensionSourceEditInput,
  SourceEditSaveResult,
  SourceEditSession,
  WorkflowAgentSourceDeleteResult,
  WorkflowAgentSourceLifecycleResult,
  RuntimeSubmittedAttachment,
  RuntimeTranscriptAssistantMessage,
  RuntimeTranscriptMessage,
  RuntimeTranscriptStreamCursor,
  RuntimeClientSubmissionMetadata,
  StateInvalidationDescriptor,
  SetRequestInputTimerPausedResult,
  StateRevision,
  SnippetId,
  SnippetMetadata,
  SnippetSource,
  SurfacePiSessionId,
  SurfaceStreamGenerationId,
  SurfaceStreamSequence,
  SurfaceStreamPatchInput as CoreSurfaceStreamPatchInput,
  ThreadId,
  TurnId,
  ComposerAttachment,
  WorkflowTaskAttemptId,
  WorkspaceId,
} from "@svvy/core";
import { COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX } from "@svvy/core";
import type {
  AgentActorExtensionDefaultsReadModelRecord as StateAgentActorExtensionDefaultsReadModelRecord,
  AgentBindingReadModelRecord as StateAgentBindingReadModelRecord,
  AgentsReadModel as StateAgentsReadModel,
  CommandInspectorReadModel as StateCommandInspectorReadModel,
  ConfiguredAgentProfileReadModelRecord as StateConfiguredAgentProfileReadModelRecord,
  CreateManagedSnippetCommandInput,
  DeleteOrchestratorProfileCommandInput,
  DeleteManagedSnippetCommandInput,
  GeneratedContextPreviewReadModelRecord as StateGeneratedContextPreviewReadModelRecord,
  MarkAppLogReadCommandInput,
  MarkSessionReadCommandInput,
  MarkSessionUnreadCommandInput,
  PromptHistoryReadModel as StatePromptHistoryReadModel,
  PromptHistoryReadModelEntry as StatePromptHistoryReadModelEntry,
  PromptHistoryReadModelRequest as StatePromptHistoryReadModelRequest,
  PromoteProfileExtensionDefaultCommandInput,
  ReorderOrchestratorProfilesCommandInput,
  ResetActorExtensionDefaultsCommandInput,
  SaveWorkspaceLayoutSlotCommandInput,
  SelectWorkspaceLayoutSlotCommandInput,
  SelectWorkspaceTabCommandInput,
  SetSessionArchivedCommandInput,
  SetSessionNavigationSectionStateCommandInput,
  SetSessionPinnedCommandInput,
  SetExternalInstructionActorUsageCommandInput,
  SetProfileExtensionUsageCommandInput,
  SetSnippetEnabledCommandInput,
  SetWorkspaceTabsCommandInput,
  StateCommandResult,
  UpdateAppPreferencesCommandInput,
  UpdateOrchestratorProfileCommandInput,
  UpdateThreadHandlerProfileCommandInput,
  UpdateManagedSnippetCommandInput,
} from "@svvy/state";

export type {
  AppLogEntry,
  AppLogLevel,
  AppLogQuery,
  AppLogReadModel,
  AppLogSource,
  AppLogSummary,
  AppLogUpdateMessage,
} from "@svvy/core";

export type AppLogReadModelRequest =
  | {
      kind: "appLogs";
      workspaceId?: WorkspaceId;
      query?: AppLogQuery;
    }
  | {
      kind: "appLogSummary";
      workspaceId?: WorkspaceId;
    };

export interface AppPreferencesReadModel {
  appearance: AppPreferences["appAppearance"];
  externalEditor: string | null;
  artifactDirectory: string;
  approvalMode: AppPreferences["approvalMode"];
  networkAccess: boolean;
  externalInstructions: AppPreferences["externalInstructions"];
  ambientResources: JsonValue;
  updatedAt: string;
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
  workspaceId?: WorkspaceId;
}

export interface SessionNavigationReadModelRequest {
  kind: "sessionNavigation";
  workspaceId?: WorkspaceId;
}

export type PromptHistoryReadModelRequest = StatePromptHistoryReadModelRequest;
export type PromptHistoryReadModel = StatePromptHistoryReadModel;
export type PromptHistoryReadModelEntry = StatePromptHistoryReadModelEntry;

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
  workspaceId: WorkspaceId;
  commandId: CommandId;
}

export interface RequestInputReadModelRequest {
  kind: "requestInput";
  workspaceId?: WorkspaceId;
  surfacePiSessionId?: SurfacePiSessionId;
  requestId?: RequestInputRequestId;
}

export interface ApprovalsReadModelRequest {
  kind: "approvals";
  workspaceId?: WorkspaceId;
  surfacePiSessionId?: SurfacePiSessionId;
  requestId?: RuntimeApprovalId;
}

export interface AgentsReadModelRequest {
  kind: "agents";
  profileId?: AgentProfileId;
}

export interface ExtensionsReadModelRequest {
  kind: "extensions";
  extensionId?: string;
}

export interface SnippetsStateReadModelRequest {
  kind: "snippets";
  workspaceId: WorkspaceId;
  snippetId?: string;
}

export interface WorkflowsGeneratedReadModelRequest {
  kind: "workflowsGenerated";
  buildId?: string;
}

export interface HandlerInspectorReadModelRequest {
  kind: "handlerInspector";
  workspaceId: WorkspaceId;
  threadId: ThreadId;
}

export interface WorkflowTaskAttemptInspectorReadModelRequest {
  kind: "workflowTaskAttemptInspector";
  workspaceId: WorkspaceId;
  workflowTaskAttemptId: WorkflowTaskAttemptId;
}

export interface WorkspaceChromeReadModelRequest {
  kind: "workspaceChrome";
}

export interface WorkspaceLayoutReadModelRequest {
  kind: "workspaceLayout";
  workspaceId: WorkspaceId;
}

export type SessionNavigationReadModel = CoreSessionNavigationReadModel;

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
  activeTurnStartedAt: string | null;
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
    updatedAt: string | null;
  };
}

export interface SurfaceQueuedMessagesReadModel {
  target: RuntimeSurfaceTarget;
  queuedMessages: readonly {
    id: QueueItemId;
    kind: QueuedSurfaceMessageKind;
    text: string;
    title?: string;
    summary?: string;
    threadId?: string;
    episodeId?: string;
    sourceCommandId?: CommandId;
    status: QueuedSurfaceMessageStatus;
    failureError?: string;
    createdAt: string;
    updatedAt: string;
  }[];
}

export type CommandInspectorReadModel = StateCommandInspectorReadModel;

export interface RequestInputReadModel {
  requests: readonly WorkspaceRequestUserInputRequest[];
}

export interface ApprovalsReadModel {
  requests: readonly WorkspaceRuntimeApprovalRequest[];
}

export type AgentsReadModel = StateAgentsReadModel;
export type AgentActorExtensionDefaultsReadModelRecord =
  StateAgentActorExtensionDefaultsReadModelRecord;
export type AgentBindingReadModelRecord = StateAgentBindingReadModelRecord;
export type ConfiguredAgentProfileReadModelRecord = StateConfiguredAgentProfileReadModelRecord;
export type GeneratedContextPreviewReadModelRecord = StateGeneratedContextPreviewReadModelRecord;

export interface ExtensionsReadModel {
  records: readonly ExtensionReadModelRecord[];
  dependencyReadiness: readonly unknown[];
}

export interface ExtensionReadModelRecord {
  extensionId: string;
  readiness: "ready" | "not-ready" | "unknown";
  loadedByProfileIds: readonly string[];
  availableByProfileIds: readonly string[];
  generatedPackageStatus: "ready" | "failed" | "refresh-needed" | "unknown";
}

export interface StateSnippetsReadModel {
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
  updatedAt: string | null;
}

export interface WorkflowsGeneratedReadModel {
  packageName: "@svvyx/workflows";
  facts: readonly WorkflowsGeneratedFactReadModelRecord[];
  exports: readonly WorkflowsGeneratedExportReadModelRecord[];
}

export interface WorkflowsGeneratedFactReadModelRecord {
  packageName: "@svvyx/workflows";
  status: "ready" | "failed" | "refresh-needed";
  buildId: string | null;
  manifestPath: string | null;
  diagnostics: readonly string[];
  refreshNeededReason: string | null;
  updatedAt: string;
}

export interface WorkflowsGeneratedExportReadModelRecord {
  namespace: WorkspaceWorkflowsGeneratedNamespace;
  exportName: string;
  qualifiedName: string;
  kind: WorkspaceWorkflowsGeneratedKind;
  generatedCode: string;
  generatedPath: string | null;
  sourcePath: string | null;
  agentParameters: JsonValue | null;
  workflowAgentId: string | null;
}

export type WorkspaceChromeReadModel = CoreWorkspaceChromeReadModel;
export type WorkspaceLayoutReadModel = CoreWorkspaceLayoutReadModel;
export type WorkspaceLayoutSlotReadModel = CoreWorkspaceLayoutSlotReadModel;
export type WorkspacePaneRecord = CoreWorkspacePaneRecord;
export type WorkspacePaneTarget = CoreWorkspacePaneTarget;
export type WorkspaceTabRecord = CoreWorkspaceTabRecord;

export type DesktopRendererNotificationScope =
  | { kind: "app" }
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "surface"; workspaceId: WorkspaceId; surfacePiSessionId: SurfacePiSessionId };

export type DesktopRendererCommand =
  | "command-palette.open"
  | "quick-open.open"
  | "settings.open"
  | "workspace.open"
  | "workspace.newTab"
  | "workspace.openInNewTab"
  | "session.new"
  | "session.newPane"
  | "sidebar.toggle"
  | "surface.logs.open"
  | "surface.agents.open"
  | "surface.extensions.open"
  | "surface.workflows.open";

export type DesktopRendererNotification =
  | {
      kind: "read-model-changed";
      eventGenerationId: RuntimeEventGenerationId;
      sequence: RuntimeEventSequence;
      scope: DesktopRendererNotificationScope;
      invalidation: StateInvalidationDescriptor;
    }
  | {
      kind: "surface-stream-patch";
      eventGenerationId: RuntimeEventGenerationId;
      sequence: RuntimeEventSequence;
      workspaceId: WorkspaceId;
      target: RuntimeSurfaceTarget;
      surfacePiSessionId: SurfacePiSessionId;
      streamGenerationId: SurfaceStreamGenerationId;
      streamSequence: SurfaceStreamSequence;
      patch: CoreSurfaceStreamPatchInput;
    }
  | {
      kind: "read-model-rebaseline-required";
      reason:
        | "event-sequence-gap"
        | "surface-stream-gap"
        | "surface-stream-generation-mismatch"
        | "scope-descriptor-mismatch"
        | "runtime-restart"
        | "slow-consumer"
        | "bridge-restart"
        | "bridge-disposed";
      rebaselineRequired: true;
      eventGenerationId?: RuntimeEventGenerationId;
      lastContiguousSequence?: RuntimeEventSequence;
      scope?: DesktopRendererNotificationScope;
    }
  | {
      kind: "renderer-command";
      command: DesktopRendererCommand;
    }
  | {
      kind: "app-shutdown";
      reason: "app-shutdown" | "bridge-stopped" | "runtime-shutdown" | "startup-failure";
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
  | RequestInputReadModelRequest
  | ApprovalsReadModelRequest
  | AgentsReadModelRequest
  | ExtensionsReadModelRequest
  | SnippetsStateReadModelRequest
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
  | { kind: "requestInput"; value: RequestInputReadModel }
  | { kind: "approvals"; value: ApprovalsReadModel }
  | { kind: "agents"; value: AgentsReadModel }
  | { kind: "extensions"; value: ExtensionsReadModel }
  | { kind: "snippets"; value: StateSnippetsReadModel }
  | { kind: "workflowsGenerated"; value: WorkflowsGeneratedReadModel }
  | { kind: "handlerInspector"; value: WorkspaceHandlerThreadInspector | null }
  | { kind: "workflowTaskAttemptInspector"; value: WorkspaceWorkflowTaskAttemptInspector | null }
  | { kind: "workspaceChrome"; value: WorkspaceChromeReadModel }
  | { kind: "workspaceLayout"; value: WorkspaceLayoutReadModel };

export interface StateReadModelRefetchRequest {
  requests: readonly StateReadModelRequest[];
}

export interface StateReadModelInvalidationRefetchRequest {
  descriptor: StateInvalidationDescriptor;
}

export interface StateReadModelBaseline {
  app: readonly StateReadModelResult[];
  workspaces: readonly StateReadModelResult[];
  revision: StateRevision;
}

export interface StateReadModelRebaselineRequest {
  workspaceId?: WorkspaceId;
  reason: "renderer-startup" | "event-sequence-gap" | "manual-refresh" | "runtime-restart";
}

export type AuthKeyType = "apikey" | "oauth" | "env" | "none";
export type PromptSurfaceKind = "orchestrator" | "handler";

export interface PromptTarget {
  workspaceSessionId: string;
  surface: PromptSurfaceKind;
  surfacePiSessionId: string;
  threadId?: string;
}

export interface WorkflowsPaneTarget {
  surface: "workflows";
}

export interface AppLogsPaneTarget {
  workspaceSessionId?: string;
  surface: "app-logs";
}

export interface OpenWorkspacePaneTarget {
  surface: "open-workspace";
}

export interface AgentsPaneTarget {
  surface: "agents";
  targetAgentProfileId?: string;
  view?: "profiles" | "generated-context-preview";
}

export interface ExtensionsPaneTarget {
  surface: "extensions";
  targetExtensionId?: string;
  view?: "inventory" | "generated-context-preview";
}

export interface SnippetsPaneTarget {
  surface: "snippets";
}

export interface SettingsPaneTarget {
  surface: "settings";
}

export type ExtensionCliRequirementReadinessStatus = "available" | "missing" | "unknown";

export interface ExtensionCliRequirementReadiness {
  id: string;
  binary: string;
  package: string | null;
  required: boolean;
  defaultVersion: string | null;
  currentVersion: string | null;
  latestVersion: string | null;
  status: ExtensionCliRequirementReadinessStatus;
  updateAvailable: boolean;
  detectedVersion: string | null;
  path: string | null;
  versionCommand: string | null;
  installCommand: string | null;
  updateCommand: string | null;
}

export type ExtensionEnvRequirementReadinessStatus =
  | "configured"
  | "defaulted"
  | "missing"
  | "optional_missing";

export interface ExtensionEnvRequirementReadiness {
  name: string;
  required: boolean;
  secret: boolean;
  description: string;
  status: ExtensionEnvRequirementReadinessStatus;
}

export interface ExtensionUsageReadiness {
  actorKind: "orchestrator" | "handler" | "workflow-task";
  agentProfile: string;
  state: ExtensionUsageState;
  configurable: boolean;
  fixedReason?: string;
}

export interface ExtensionInventoryIssue {
  code:
    | "BUILD_REQUIRED"
    | "CLI_MISSING"
    | "CLI_STATUS_UNKNOWN"
    | "DEPENDENCY_APPROVAL_REQUIRED"
    | "DEPENDENCY_INSTALL_MISSING"
    | "EXTENSION_ENV_MISSING"
    | "EXTERNAL_INSTRUCTION_UNREADABLE"
    | "NO_CURRENT_BUILD";
  message: string;
}

export interface ExtensionInventoryItemReadModel {
  id: string;
  category: ExtensionCategory;
  interface: ExtensionInterfaceKind;
  title: string;
  description: string;
  customized: boolean;
  minimalInstruction?: ExtensionInstructionFileReadModel;
  loadedInstructionContributors: ExtensionLoadedInstructionContributorReadModel[];
  externalInstruction?: {
    sourceGroup: GeneratedAgentContextExternalSource["sourceGroup"];
    rootId?: string;
    rootLabel?: string;
    path: string;
    content: string;
    contentHash: string;
    order: number;
    enabled: boolean;
    actors: GeneratedAgentContextExternalSource["actors"];
    readStatus: GeneratedAgentContextExternalSource["readStatus"];
  };
  typescriptApiEnabled: boolean;
  tooling: ExtensionToolingReadModel;
  usage: ExtensionUsageReadiness[];
  requirements: {
    cliRequirements: ExtensionCliRequirementReadiness[];
    env: ExtensionEnvRequirementReadiness[];
  };
  state: {
    ready: boolean;
    issues: ExtensionInventoryIssue[];
  };
}

export interface ExtensionInstructionFileReadModel {
  name: string;
  path: string;
  content: string;
  sourceVersion: string;
  bypassed: boolean;
  editable: boolean;
  tokenCount: {
    tokens: number;
    accuracy: "estimated";
  };
}

export type ExtensionLoadedInstructionContributorReadModel =
  | {
      kind: "source";
      file: ExtensionInstructionFileReadModel;
    }
  | {
      kind: "scripted";
      name: string;
      bypassed: boolean;
      script: ExtensionInstructionFileReadModel;
      output: ExtensionInstructionFileReadModel;
      regenerateCommand: string;
    };

export interface ExtensionGeneratedReadonlyBlockReadModel {
  name: string;
  path: string;
  openable?: boolean;
  content: string;
  tokenCount: {
    tokens: number;
    accuracy: "estimated";
  };
}

export interface ExtensionToolingReadModel {
  nativeToolSchema?: ExtensionGeneratedReadonlyBlockReadModel;
  svvyxCommandSource?: ExtensionInstructionFileReadModel;
  svvyxCommandSchema?: ExtensionGeneratedReadonlyBlockReadModel;
  typescriptApiDeclaration?: ExtensionGeneratedReadonlyBlockReadModel;
  typescriptApiStatus?: "disabled" | "emitted" | "not_emitted";
}

export interface ExtensionChangeCardReadModel {
  id: string;
  extensionId: string;
  kind: "extension_files" | "extension_usage" | "extension_delete";
  sourceChangeKind: string;
  createdAt: string;
  title: string;
  description: string;
  revertCommand: string;
  reversible: true;
}

export interface ExtensionSnapshotReadModel {
  id: string;
  name: string;
  extensionCount: number;
  hasSecretState: boolean;
  status: "available";
}

export interface ExtensionDefaultUsageReadModel {
  actorKind: "orchestrator" | "workflow-task";
  state: ExtensionUsageState;
  customized: boolean;
  configurable: boolean;
  fixedReason?: string;
}

export interface ExtensionsInventoryReadModel {
  extensions: ExtensionInventoryItemReadModel[];
  defaults?: {
    order: string[];
    usage: Record<string, ExtensionDefaultUsageReadModel[]>;
  };
  reversibleChanges: ExtensionChangeCardReadModel[];
  snapshots: ExtensionSnapshotReadModel[];
}

export interface SaveExtensionSnapshotRequest extends WorkspaceScopedRequest {
  name: string;
}

export interface RenameExtensionSnapshotRequest extends WorkspaceScopedRequest {
  snapshotId: string;
  name: string;
}

export interface DeleteExtensionSnapshotRequest extends WorkspaceScopedRequest {
  snapshotId: string;
}

export interface LoadExtensionSnapshotRequest extends WorkspaceScopedRequest {
  snapshotId: string;
}

export interface CreateExtensionRequest extends WorkspaceScopedRequest {
  id: string;
  title: string;
  description: string;
}

export interface DuplicateExtensionRequest extends WorkspaceScopedRequest {
  extensionId: string;
  id: string;
  title: string;
}

export interface DeleteExtensionRequest extends WorkspaceScopedRequest {
  extensionId: string;
}

export interface ResetExtensionRequest extends WorkspaceScopedRequest {
  extensionId: string;
}

export interface BuildExtensionRequest extends WorkspaceScopedRequest {
  extensionId: string;
}

export interface SetExtensionTypescriptApiRequest extends WorkspaceScopedRequest {
  extensionId: string;
  enabled: boolean;
}

export interface ReorderExtensionDefaultsRequest extends WorkspaceScopedRequest {
  extensionIds: string[];
}

export interface AddExtensionInstructionFileRequest extends WorkspaceScopedRequest {
  extensionId: string;
  name: string;
}

export interface RemoveExtensionInstructionFileRequest extends WorkspaceScopedRequest {
  extensionId: string;
  name: string;
}

export interface ConfigureExtensionInstructionFileRequest extends WorkspaceScopedRequest {
  extensionId: string;
  name: string;
  bypassed: boolean;
}

export interface UpdateExtensionInstructionFileRequest extends WorkspaceScopedRequest {
  extensionId: string;
  kind?: "full" | "minimal" | "script";
  name: string;
  content: string;
  baseSourceVersion?: string;
  mode?: FileBackedSaveMode;
}

export interface OpenExtensionInstructionFileInEditorRequest extends WorkspaceScopedRequest {
  extensionId: string;
  kind?: "full" | "minimal" | "script";
  name: string;
  path?: string;
}

export interface SetExtensionEnvSecretRequest extends WorkspaceScopedRequest {
  extensionId: string;
  envName: string;
  value: string;
}

export interface RemoveExtensionEnvSecretRequest extends WorkspaceScopedRequest {
  extensionId: string;
  envName: string;
}

export interface SetExtensionEnvOverrideRequest extends WorkspaceScopedRequest {
  extensionId: string;
  envName: string;
  value: string;
}

export interface RemoveExtensionEnvOverrideRequest extends WorkspaceScopedRequest {
  extensionId: string;
  envName: string;
}

export type StaticInspectorPaneTarget =
  | { workspaceSessionId: string; surface: "command"; commandId: string }
  | {
      workspaceSessionId: string;
      surface: "workflow-task-attempt";
      workflowTaskAttemptId: string;
    }
  | { workspaceSessionId: string; surface: "artifact"; artifactId: string };

export type WorkspacePaneSurfaceTarget =
  | PromptTarget
  | WorkflowsPaneTarget
  | AppLogsPaneTarget
  | AgentsPaneTarget
  | ExtensionsPaneTarget
  | SnippetsPaneTarget
  | SettingsPaneTarget
  | OpenWorkspacePaneTarget
  | StaticInspectorPaneTarget;

export type PromptClientSubmissionMetadata = RuntimeClientSubmissionMetadata;

export interface RendererTelemetryRequest {
  eventName: string;
  level?: AppLogLevel;
  message?: string;
  target?: PromptTarget;
  panelId?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
}

export interface RendererTelemetryResponse {
  ok: true;
}

export interface DesktopSubmitPromptRequest {
  panelId: string;
  target: PromptTarget;
  text: string;
  attachments?: RuntimeSubmittedAttachment[];
  clientRequestId: string;
}

export type SendPromptRequest = DesktopSubmitPromptRequest;
export interface SendPromptResponse {
  queuedMessageId: string;
  target: PromptTarget;
  status: "queued";
  receipt: {
    clientRequestId: string | null;
    outcome: "accepted" | "duplicate";
    acceptedAt: string;
    stateRevision: number;
  };
}

export interface EditCommittedUserMessageResponse {
  target: PromptTarget;
}

export type QueuedSurfaceMessageStatus = "queued" | "steering" | "dispatching" | "failed";
export type QueuedSurfaceMessageKind =
  | "user_message"
  | "initial_handler_start"
  | "thread_followup"
  | "report_request"
  | "thread_report_notification"
  | "request_user_input_answer"
  | "workflow_task_agent_start";

export interface QueuedSurfaceMessage {
  id: string;
  kind: QueuedSurfaceMessageKind;
  text: string;
  title?: string;
  summary?: string;
  threadId?: string;
  episodeId?: string;
  sourceCommandId?: string;
  status: QueuedSurfaceMessageStatus;
  failureError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComposerDraft {
  text: string;
  attachments: ComposerAttachment[];
  snippetMentions?: ComposerSnippetMention[];
  updatedAt: string | null;
}

export interface SvvyUserMessageMetadata {
  snippetProvenance?: SentSnippetProvenance[];
}

export type SvvyUserMessage = RendererTranscriptUserEntry & {
  svvyMetadata?: SvvyUserMessageMetadata;
};

export interface QueuedSurfaceMessageRequest {
  target: PromptTarget;
  queuedMessageId: string;
}

export interface ReorderQueuedSurfaceMessageRequest extends QueuedSurfaceMessageRequest {
  beforeQueuedMessageId?: string | null;
}

export interface EditCommittedUserMessageRequest {
  target: PromptTarget;
  messageTimestamp: string | number;
  message: RendererTranscriptUserEntry;
}

export interface EditQueuedSurfaceMessageResponse {
  ok: boolean;
  text?: string;
}

export interface CloseSurfaceRequest {
  target: PromptTarget;
}

export interface SetSurfaceModelRequest {
  target: PromptTarget;
  model: string;
  provider: string;
}

export interface SetSurfaceThoughtLevelRequest {
  target: PromptTarget;
  level: ReasoningEffort;
}

export interface SetSurfaceExtensionUsageRequest {
  target: PromptTarget;
  extensionId: string;
  state: ExtensionUsageState;
}

export interface UpdateComposerDraftRequest {
  target: PromptTarget;
  draft: {
    text: string;
    attachments: ComposerAttachment[];
    snippetMentions?: ComposerSnippetMention[];
  };
}

export interface CancelPromptRequest {
  target: PromptTarget;
}

export type WorkspaceKind = CoreWorkspaceKind;

export interface WorkspaceInfoResponse {
  workspaceId: string;
  cwd: string;
  workspaceLabel: string;
  kind: WorkspaceKind;
  branch?: string;
}

export interface WorkspaceBranchInfo {
  name: string;
  current: boolean;
}

export interface WorkspaceBranchListResponse {
  branches: WorkspaceBranchInfo[];
  currentBranch?: string;
}

export interface SwitchWorkspaceBranchRequest {
  branch: string;
}

export interface SwitchWorkspaceBranchResponse {
  ok: boolean;
  workspace: WorkspaceInfoResponse;
  error?: string;
}

export interface WorkspaceTabInfo extends WorkspaceInfoResponse {
  workspaceTabId: string;
  openedAt: string;
  activeLayoutId: WorkspaceLayoutSlotId;
}

export type WorkspaceLayoutSlotId = CoreWorkspaceLayoutSlotId;

export type OpenWorkspacePlacement = "current-tab" | "new-tab";

export interface OpenWorkspaceRequest {
  cwd?: string;
  workspaceTabId?: string;
  placement?: OpenWorkspacePlacement;
}

export interface OpenWorkspaceResponse {
  workspace: WorkspaceInfoResponse | null;
}

export interface WorkspaceScopedRequest {
  workspaceId: string;
}

export type WorkspaceScoped<T extends object = Record<string, never>> = T & WorkspaceScopedRequest;

export type ComposerMentionKind = "file" | "folder";

export interface WorkspacePathIndexEntry {
  kind: ComposerMentionKind;
  workspaceRelativePath: string;
}

export type { ComposerAttachment, ComposerAttachmentKind } from "@svvy/core";
export { COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX };
export { composerAttachmentPromptText, serializeComposerAttachmentTextSignature } from "@svvy/core";

export function parseComposerAttachmentTextSignature(
  textSignature: string | undefined,
): ComposerAttachment[] {
  if (!textSignature?.startsWith(COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX)) {
    return [];
  }
  try {
    const value = JSON.parse(textSignature.slice(COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX.length));
    if (!Array.isArray(value)) return [];
    return value.flatMap((attachment): ComposerAttachment[] => {
      if (
        !attachment ||
        typeof attachment !== "object" ||
        typeof attachment.id !== "string" ||
        typeof attachment.kind !== "string" ||
        typeof attachment.name !== "string" ||
        typeof attachment.path !== "string" ||
        !["file", "folder", "image"].includes(attachment.kind)
      ) {
        return [];
      }
      return [
        {
          id: attachment.id,
          kind: attachment.kind,
          name: attachment.name,
          path: attachment.path,
          workspaceRelativePath:
            typeof attachment.workspaceRelativePath === "string"
              ? attachment.workspaceRelativePath
              : undefined,
          mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : undefined,
          sizeBytes: typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

export interface ImportComposerAttachmentInput {
  name: string;
  mimeType?: string;
  dataBase64: string;
}

export interface ImportComposerAttachmentsRequest {
  attachments: ImportComposerAttachmentInput[];
}

export interface OpenWorkspacePathRequest {
  workspaceRelativePath: string;
}

export interface OpenWorkspacePathResponse {
  opened: boolean;
  kind: ComposerMentionKind | "missing";
}

export interface PickWorkspaceAttachmentResponse {
  attachments: ComposerAttachment[];
  skippedPaths: string[];
}

export interface ProviderAuthInfo {
  provider: string;
  hasKey: boolean;
  keyType: AuthKeyType;
  supportsOAuth: boolean;
  authHealth: "missing" | "available" | "oauth-expired" | "oauth-refresh-failed";
  expiresAt?: string | null;
  authError?: string;
  authFailedAt?: string | null;
}

export type SessionStatus = CoreSessionNavigationStatus;
export type SessionTitleGenerationStatus = CoreSessionNavigationTitleGenerationStatus;

export interface WorkspaceCommandRollupChild {
  commandId: string;
  toolName: string;
  status: "streaming" | "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  title: string;
  summary: string;
  error: string | null;
}

export interface WorkspaceCommandRollup {
  commandId: string;
  threadId: string | null;
  workflowRunId?: string | null;
  workflowTaskAttemptId?: string | null;
  toolName: string;
  visibility: "summary" | "surface";
  status: "streaming" | "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  title: string;
  summary: string;
  arguments?: unknown | null;
  facts?: Record<string, unknown> | null;
  error?: string | null;
  artifacts?: WorkspaceCommandArtifactLink[];
  outputEvents?: WorkspaceCommandOutputEvent[];
  stdin: WorkspaceCommandStdinState;
  argumentSnapshots?: WorkspaceCommandArgumentSnapshot[];
  progressEvents?: WorkspaceCommandProgressEvent[];
  patchSnapshots?: WorkspaceCommandPatchSnapshot[];
  diagnostics?: WorkspaceCommandDiagnosticSnapshot[];
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: WorkspaceCommandRollupChild[];
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface WorkspaceCommandArtifactLink {
  artifactId: string;
  kind: "text" | "log" | "json" | "file";
  name: string;
  path?: string;
  createdAt: string;
  sourceCommandId?: string;
  workflowRunId?: string;
  workflowName?: string;
  producerLabel?: string;
  missingFile?: boolean;
}

export interface WorkspaceCommandOutputEvent {
  eventId: string;
  at: string;
  stream: "stdout" | "stderr";
  source: string;
  text: string;
}

export interface WorkspaceCommandStdinEvent {
  eventId: string;
  at: string;
  text: string;
  acceptedBytes: number;
}

export interface WorkspaceCommandStdinState {
  mode: "none" | "continuable";
  canAttemptWrite: boolean;
  acceptedWrites: WorkspaceCommandStdinEvent[];
}

export interface WorkspaceCommandProgressEvent {
  eventId: string;
  at: string;
  source: string;
  phase?: string;
  family?: string;
  command?: string;
  message?: string;
  progress?: number;
  facts?: Record<string, unknown>;
}

export interface WorkspaceCommandArgumentSnapshot {
  eventId: string;
  at: string;
  source: string;
  arguments: unknown;
}

export interface WorkspaceCommandPatchSnapshot {
  eventId: string;
  at: string;
  source: string;
  files: WorkspaceCommandPatchFile[];
}

export interface WorkspaceCommandPatchFile {
  path: string;
  changeType: "created" | "deleted" | "modified";
  additions: number;
  deletions: number;
}

export interface WorkspaceCommandDiagnosticSnapshot {
  eventId: string;
  at: string;
  source: string;
  stage?: "compile" | "typecheck" | "runtime" | string;
  diagnostics: WorkspaceCommandDiagnostic[];
}

export interface WorkspaceCommandDiagnostic {
  severity?: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface WorkspaceProductEvent {
  eventId: string;
  at: string;
  title: string;
  summary: string;
  subject: {
    kind: "session" | "thread";
    id: string;
  };
  details?: Record<string, unknown>;
}

export type WorkspaceCommandInspector = CommandInspectorReadModel;
export type WorkspaceCommandInspectorChild = WorkspaceCommandInspector["summaryChildren"][number];

export interface DesktopWriteCommandStdinRequest {
  commandId: string;
  text: string;
  clientSubmission?: RuntimeClientSubmissionMetadata;
}

export type WriteCommandStdinRequest = DesktopWriteCommandStdinRequest;

export type WriteCommandStdinResponse =
  | {
      commandId: string;
      status: "accepted";
      acceptedBytes: number;
    }
  | {
      commandId: string;
      status: "stdin_closed" | "not_running" | "already_terminal";
    };

export interface WorkspaceHandlerThreadWorkflowSummary {
  workflowRunId: string;
  workflowName: string;
  status: "running" | "waiting" | "continued" | "completed" | "failed" | "cancelled";
  summary: string;
  updatedAt: string;
  artifacts: WorkspaceCommandArtifactLink[];
}

export interface WorkspaceHandlerThreadEpisodeSummary {
  episodeId: string;
  kind: "analysis" | "change" | "workflow" | "clarification" | "report" | "handoff" | "conclusion";
  title: string;
  summary: string;
  createdAt: string;
}

export type WorkspaceWorkflowsGeneratedNamespace =
  | "Agents"
  | "Components"
  | "Prompts"
  | "Workflows";

export type WorkspaceWorkflowsGeneratedKind = "agent" | "component" | "prompt" | "workflow";

export interface WorkspaceWorkflowsGeneratedExport {
  id: string;
  kind: WorkspaceWorkflowsGeneratedKind;
  namespace: WorkspaceWorkflowsGeneratedNamespace;
  exportName: string;
  qualifiedName: string;
  sourcePath: string;
  generatedPath: string;
  generatedCode: string;
  agentParameters: Record<string, unknown> | null;
  workflowAgentId: string | null;
}

export interface WorkspaceWorkflowsGeneratedReadModel {
  generatedPackagePath: string;
  items: WorkspaceWorkflowsGeneratedExport[];
  counts: Record<WorkspaceWorkflowsGeneratedKind, number>;
  updatedAt: string;
}

export interface OpenWorkflowsGeneratedExportInEditorRequest {
  workspaceId: WorkspaceId;
  qualifiedName: string;
  target: "source" | "generated";
}

export interface OpenGeneratedAgentContextExternalSourceInEditorRequest {
  path: string;
}

export interface OpenSnippetSourceInEditorRequest {
  workspaceId: WorkspaceId;
  snippetId: SnippetId;
}

export type OpenSourceInEditorRequest = WorkspaceScoped<OpenExtensionSourceEditInput>;

export interface OpenWorkspaceSourceInEditorResponse {
  opened: boolean;
  editor: string;
  path: string;
}

export interface WorkspaceWorkflowTaskAttemptTranscriptMessage {
  messageId: string;
  role: "user" | "assistant" | "stderr";
  source: "prompt" | "event" | "responseText";
  text: string;
  createdAt: string;
}

export interface WorkspaceWorkflowTaskAttemptSummary {
  workflowTaskAttemptId: string;
  workflowRunId: string;
  smithersRunId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  title: string;
  kind: "agent" | "compute" | "static" | "unknown";
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  summary: string;
  updatedAt: string;
  commandCount: number;
  artifactCount: number;
  transcriptMessageCount: number;
  contextBudget: {
    usedTokens: number;
    maxTokens: number;
    percent: number;
    tone: "neutral" | "orange" | "red";
    label: string;
    detail: string;
  } | null;
}

export interface WorkspaceWorkflowTaskAttemptInspector extends WorkspaceWorkflowTaskAttemptSummary {
  surfacePiSessionId: string | null;
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
  generatedAgentContextBinding: {
    systemPrompt: string;
    generatedAgentContextRevision: number;
    loadedExtensionIds: string[];
    availableExtensionIds: string[];
    externalSourceHashes: string[];
  } | null;
  meta: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
  transcript: WorkspaceWorkflowTaskAttemptTranscriptMessage[];
  commandRollups: WorkspaceCommandRollup[];
  artifacts: WorkspaceCommandArtifactLink[];
}

export interface WorkspaceHandlerThreadSummary {
  threadId: string;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  objectiveState: "active" | "concluded";
  historyMode: "isolated" | "forked";
  status:
    | "idle"
    | "running-handler"
    | "running-workflow"
    | "waiting"
    | "troubleshooting"
    | "completed";
  wait: {
    owner: "handler" | "workflow";
    kind: "user" | "external" | "approval" | "signal" | "timer";
    reason: string;
    resumeWhen: string;
    since: string;
  } | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  commandCount: number;
  workflowRunCount: number;
  workflowTaskAttemptCount?: number;
  episodeCount: number;
  artifactCount: number;
  latestCommandRollup: WorkspaceCommandRollup | null;
  latestWorkflowRun: WorkspaceHandlerThreadWorkflowSummary | null;
  latestEpisode: WorkspaceHandlerThreadEpisodeSummary | null;
  workflowTaskAttempts?: WorkspaceWorkflowTaskAttemptSummary[];
}

export interface WorkspaceHandlerThreadInspector extends WorkspaceHandlerThreadSummary {
  commandRollups: WorkspaceCommandRollup[];
  workflowRuns: WorkspaceHandlerThreadWorkflowSummary[];
  workflowTaskAttempts?: WorkspaceWorkflowTaskAttemptSummary[];
  episodes: WorkspaceHandlerThreadEpisodeSummary[];
  artifacts: WorkspaceCommandArtifactLink[];
}

export type WorkspaceSidebarRowSubtitle = CoreSessionNavigationSidebarRowSubtitle;
export type WorkspaceSidebarWorkflowRow = CoreSessionNavigationSidebarWorkflowRow;
export type WorkspaceSidebarHandlerThreadRow = CoreSessionNavigationSidebarHandlerThreadRow;
export type WorkspaceSessionSummary = CoreSessionNavigationSummary;

export type { WorkspaceSessionNavigationSectionId, WorkspaceSessionNavigationSectionState };

export type WorkspaceSessionNavigationReadModel = CoreSessionNavigationReadModel;

export type WorkspaceRequestUserInputDelivery = RuntimeMessageDelivery;

export type WorkspaceRequestUserInputAnswer =
  | {
      kind: "option";
      label: string;
      text: string;
    }
  | {
      kind: "custom";
      text: string;
    };

export interface WorkspaceRequestUserInputOption {
  optionId: string;
  ordinal: number;
  label: string;
  description: string;
  recommended: boolean;
}

export interface WorkspaceRequestUserInputQuestion {
  questionId: string;
  ordinal: number;
  title: string;
  question: string;
  defaultAnswer: WorkspaceRequestUserInputAnswer;
  choices: WorkspaceRequestUserInputOption[];
  status: "open" | "answered" | "defaulted" | "cancelled";
}

export interface WorkspaceRequestUserInputTimeout {
  timerVersion: number;
  enabled: boolean;
  durationMs: number;
  startedAt: string;
  pausedAt: string | null;
  remainingMsWhenPaused: number | null;
  expiresAt: string | null;
}

export interface WorkspaceRequestUserInputRequest {
  requestId: string;
  workspaceSessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  ownerTitle: string;
  variant: "nonblocking" | "blocking";
  status: "open" | "completed" | "cancelled" | "expired";
  createdAt: string;
  completedAt: string | null;
  timeout: WorkspaceRequestUserInputTimeout | null;
  questions: WorkspaceRequestUserInputQuestion[];
}

export interface WorkspaceRuntimeApprovalRequest {
  requestId: string;
  workspaceSessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  ownerTitle: string;
  toolName: "apply_patch" | "exec_command" | "execute_typescript";
  approvalMode: "auto-review" | "user";
  cwd: string;
  command: string | null;
  commandFamily: string | null;
  snippetArtifactId: string | null;
  status: "pending" | "approved" | "denied" | "cancelled";
  createdAt: string;
  completedAt: string | null;
  summary: string;
}

export interface AnswerRuntimeApprovalRequest {
  requestId: string;
  approved: boolean;
  reason?: string | null;
}

export interface RequestUserInputAnswerRequest {
  surfacePiSessionId: string;
  requestId: string;
  questionId: string;
  answer: { kind: "option"; optionId: string } | { kind: "custom"; text: string };
  delivery: WorkspaceRequestUserInputDelivery;
  clientSubmission?: PromptClientSubmissionMetadata;
}

export type RequestUserInputAnswerResponse = AnswerRequestInputResult;
export type RuntimeApprovalAnswerResponse = AnswerRuntimeApprovalResult;
export type RequestInputTimerPauseResponse = SetRequestInputTimerPausedResult;

export interface SetRequestUserInputTimerPausedRequest {
  surfacePiSessionId: string;
  requestId: string;
  paused: boolean;
  clientSubmission?: PromptClientSubmissionMetadata;
}

export interface WorkspaceArtifactPreview {
  artifactId: string;
  sessionId: string;
  kind: WorkspaceCommandArtifactLink["kind"];
  name: string;
  path?: string;
  createdAt: string;
  sourceCommandId?: string;
  workflowRunId?: string;
  workflowName?: string;
  producerLabel?: string;
  missingFile: boolean;
  content: string;
}

export interface ConversationTurnTiming {
  turnId: string;
  assistantMessageTimestamp: string | number;
  startedAt: string;
  finishedAt: string;
}

export interface CreateSessionRequest {
  title?: string;
  parentSessionId?: string;
  agentProfileId?: AgentProfileId;
}

export interface AgentContextPreviewRequest {
  profileId?: AgentProfileId;
  actor?: "orchestrator" | "handler" | "workflow-task";
}

export interface AgentContextPreviewExtension {
  id: string;
  title: string;
  description: string;
  state: ExtensionUsageState;
  instruction: string;
  tokenCount?: {
    tokens: number;
    accuracy: "estimated";
  };
  loadedTokenCount?: {
    tokens: number;
    accuracy: "estimated";
  };
  sourcePath?: string;
}

export interface AgentContextPreviewResponse {
  actor: "orchestrator" | "handler" | "workflow-task";
  profileId: AgentProfileId | WorkflowAgentKey;
  profileName: string;
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  loadedExtensionIds: string[];
  availableExtensionIds: string[];
  systemPrompt: string;
  tokenCount: {
    tokens: number;
    accuracy: "estimated";
  };
  extensions: AgentContextPreviewExtension[];
}

export type AgentModelChoice = ModelInfo;

export interface OpenSurfaceRequest {
  target: PromptTarget;
}

export interface RenameSessionRequest {
  sessionId: string;
  title: string;
}

export interface ForkSessionRequest {
  sessionId: string;
  title?: string;
  messageTimestamp?: string | number;
}

export interface WorkspaceMutationResponse {
  ok: boolean;
}

export interface WriteClipboardTextRequest {
  text: string;
}

export interface SurfaceMutationResponse {
  ok: boolean;
  target: PromptTarget;
}

export interface SurfaceOpenResponse {
  target: PromptTarget;
}

export interface SurfaceCloseResponse {
  target: PromptTarget;
  lifecycle: "open" | "idle" | "disposed";
}

export interface ChatRPCSchema {
  bun: {
    requests: {
      rendererReady: {
        params: undefined;
        response: { ok: true };
      };
      fetchStateReadModel: {
        params: StateReadModelRequest;
        response: StateReadModelResult;
      };
      refetchStateReadModels: {
        params: StateReadModelRefetchRequest;
        response: readonly StateReadModelResult[];
      };
      refetchStateReadModelInvalidation: {
        params: StateReadModelInvalidationRefetchRequest;
        response: readonly StateReadModelResult[];
      };
      rebaselineStateReadModels: {
        params: StateReadModelRebaselineRequest;
        response: StateReadModelBaseline;
      };
      stateAppLogsMarkRead: {
        params: MarkAppLogReadCommandInput;
        response: StateCommandResult;
      };
      stateAppPreferencesUpdate: {
        params: UpdateAppPreferencesCommandInput;
        response: StateCommandResult;
      };
      stateAgentProfilesUpdateOrchestrator: {
        params: WorkspaceScoped<UpdateOrchestratorProfileCommandInput>;
        response: StateCommandResult;
      };
      stateAgentProfilesUpdateThreadHandler: {
        params: WorkspaceScoped<UpdateThreadHandlerProfileCommandInput>;
        response: StateCommandResult;
      };
      stateAgentProfilesDeleteOrchestrator: {
        params: WorkspaceScoped<DeleteOrchestratorProfileCommandInput>;
        response: StateCommandResult;
      };
      stateAgentProfilesReorderOrchestrators: {
        params: WorkspaceScoped<ReorderOrchestratorProfilesCommandInput>;
        response: StateCommandResult;
      };
      stateAgentProfilesSetExtensionUsage: {
        params: WorkspaceScoped<SetProfileExtensionUsageCommandInput>;
        response: StateCommandResult;
      };
      stateAgentProfilesPromoteExtensionDefault: {
        params: WorkspaceScoped<PromoteProfileExtensionDefaultCommandInput>;
        response: StateCommandResult;
      };
      stateAgentProfilesResetExtensionDefaults: {
        params: WorkspaceScoped<ResetActorExtensionDefaultsCommandInput>;
        response: StateCommandResult;
      };
      stateAgentProfilesSetExternalInstructionUsage: {
        params: WorkspaceScoped<SetExternalInstructionActorUsageCommandInput>;
        response: StateCommandResult;
      };
      getGeneratedAgentContextExternalSources: {
        params: WorkspaceScopedRequest;
        response: GeneratedAgentContextExternalSource[];
      };
      stateSnippetsCreateManaged: {
        params: CreateManagedSnippetCommandInput;
        response: StateCommandResult<{ snippetId: SnippetId }>;
      };
      stateSnippetsUpdateManaged: {
        params: UpdateManagedSnippetCommandInput;
        response: StateCommandResult;
      };
      stateSnippetsDeleteManaged: {
        params: DeleteManagedSnippetCommandInput;
        response: StateCommandResult;
      };
      stateSnippetsSetEnabled: {
        params: SetSnippetEnabledCommandInput;
        response: StateCommandResult;
      };
      openSnippetSourceInEditor: {
        params: OpenSnippetSourceInEditorRequest;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      openSourceEdit: {
        params: OpenExtensionSourceEditInput;
        response: SourceEditSession;
      };
      saveSourceEdit: {
        params: RuntimeSaveExtensionSourceEditInput;
        response: SourceEditSaveResult;
      };
      createWorkflowAgentSource: {
        params: RuntimeCreateWorkflowAgentSourceInput;
        response: WorkflowAgentSourceLifecycleResult;
      };
      duplicateWorkflowAgentSource: {
        params: RuntimeDuplicateWorkflowAgentSourceInput;
        response: WorkflowAgentSourceLifecycleResult;
      };
      deleteWorkflowAgentSource: {
        params: RuntimeDeleteWorkflowAgentSourceInput;
        response: WorkflowAgentSourceDeleteResult;
      };
      openSourceInEditor: {
        params: OpenSourceInEditorRequest;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      getAgentContextPreview: {
        params: WorkspaceScoped<AgentContextPreviewRequest>;
        response: AgentContextPreviewResponse;
      };
      listModelMetadata: {
        params: ListModelsInput;
        response: readonly ModelInfo[];
      };
      getExtensionsInventory: {
        params: WorkspaceScopedRequest;
        response: ExtensionsInventoryReadModel;
      };
      saveExtensionSnapshot: {
        params: SaveExtensionSnapshotRequest;
        response: ExtensionsInventoryReadModel;
      };
      renameExtensionSnapshot: {
        params: RenameExtensionSnapshotRequest;
        response: ExtensionsInventoryReadModel;
      };
      deleteExtensionSnapshot: {
        params: DeleteExtensionSnapshotRequest;
        response: ExtensionsInventoryReadModel;
      };
      loadExtensionSnapshot: {
        params: LoadExtensionSnapshotRequest;
        response: ExtensionsInventoryReadModel;
      };
      createExtension: {
        params: CreateExtensionRequest;
        response: ExtensionsInventoryReadModel;
      };
      duplicateExtension: {
        params: DuplicateExtensionRequest;
        response: ExtensionsInventoryReadModel;
      };
      deleteExtension: {
        params: DeleteExtensionRequest;
        response: ExtensionsInventoryReadModel;
      };
      resetExtension: {
        params: ResetExtensionRequest;
        response: ExtensionsInventoryReadModel;
      };
      buildExtension: {
        params: BuildExtensionRequest;
        response: ExtensionsInventoryReadModel;
      };
      setExtensionTypescriptApi: {
        params: SetExtensionTypescriptApiRequest;
        response: ExtensionsInventoryReadModel;
      };
      reorderExtensionDefaults: {
        params: ReorderExtensionDefaultsRequest;
        response: ExtensionsInventoryReadModel;
      };
      addExtensionInstructionFile: {
        params: AddExtensionInstructionFileRequest;
        response: ExtensionsInventoryReadModel;
      };
      removeExtensionInstructionFile: {
        params: RemoveExtensionInstructionFileRequest;
        response: ExtensionsInventoryReadModel;
      };
      configureExtensionInstructionFile: {
        params: ConfigureExtensionInstructionFileRequest;
        response: ExtensionsInventoryReadModel;
      };
      updateExtensionInstructionFile: {
        params: UpdateExtensionInstructionFileRequest;
        response: ExtensionsInventoryReadModel;
      };
      openExtensionInstructionFileInEditor: {
        params: OpenExtensionInstructionFileInEditorRequest;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      setExtensionEnvSecret: {
        params: SetExtensionEnvSecretRequest;
        response: ExtensionsInventoryReadModel;
      };
      removeExtensionEnvSecret: {
        params: RemoveExtensionEnvSecretRequest;
        response: ExtensionsInventoryReadModel;
      };
      stateExtensionEnvSetOverride: {
        params: SetExtensionEnvOverrideRequest;
        response: StateCommandResult;
      };
      stateExtensionEnvRemoveOverride: {
        params: RemoveExtensionEnvOverrideRequest;
        response: StateCommandResult;
      };
      setRequestInputVariant: {
        params: SetRequestInputVariantInput;
        response: SetRequestInputVariantResult;
      };
      setRequestInputBlockingTimeout: {
        params: SetRequestInputBlockingTimeoutInput;
        response: SetRequestInputBlockingTimeoutResult;
      };
      openWorkspace: {
        params: OpenWorkspaceRequest;
        response: OpenWorkspaceResponse;
      };
      getDefaultWorkspace: {
        params: undefined;
        response: WorkspaceInfoResponse;
      };
      closeWorkspace: {
        params: WorkspaceScopedRequest;
        response: WorkspaceMutationResponse;
      };
      listWorkspaceBranches: {
        params: WorkspaceScopedRequest;
        response: WorkspaceBranchListResponse;
      };
      switchWorkspaceBranch: {
        params: WorkspaceScoped<SwitchWorkspaceBranchRequest>;
        response: SwitchWorkspaceBranchResponse;
      };
      writeClipboardText: {
        params: WriteClipboardTextRequest;
        response: WorkspaceMutationResponse;
      };
      listWorkspacePaths: {
        params: WorkspaceScoped<{ refresh?: boolean }>;
        response: WorkspacePathIndexEntry[];
      };
      pickWorkspaceAttachments: {
        params: WorkspaceScopedRequest;
        response: PickWorkspaceAttachmentResponse;
      };
      importComposerAttachments: {
        params: WorkspaceScoped<ImportComposerAttachmentsRequest>;
        response: PickWorkspaceAttachmentResponse;
      };
      openWorkspacePath: {
        params: WorkspaceScoped<OpenWorkspacePathRequest>;
        response: OpenWorkspacePathResponse;
      };
      openWorkflowsGeneratedExportInEditor: {
        params: OpenWorkflowsGeneratedExportInEditorRequest;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      openGeneratedAgentContextExternalSourceInEditor: {
        params: WorkspaceScoped<OpenGeneratedAgentContextExternalSourceInEditorRequest>;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      writeCommandStdin: {
        params: WorkspaceScoped<WriteCommandStdinRequest>;
        response: WriteCommandStdinResponse;
      };
      getArtifactPreview: {
        params: WorkspaceScoped<{ sessionId: string; artifactId: string }>;
        response: WorkspaceArtifactPreview;
      };
      createOrchestratorSurface: {
        params: WorkspaceScoped<Omit<CreateSessionRequest, "parentSessionId">>;
        response: CreateSurfaceResult;
      };
      openSurface: {
        params: WorkspaceScoped<OpenSurfaceRequest>;
        response: SurfaceOpenResponse;
      };
      closeSurface: {
        params: WorkspaceScoped<CloseSurfaceRequest>;
        response: SurfaceCloseResponse;
      };
      renameSession: {
        params: WorkspaceScoped<RenameSessionRequest>;
        response: WorkspaceMutationResponse;
      };
      forkSession: {
        params: WorkspaceScoped<ForkSessionRequest>;
        response: SurfaceOpenResponse;
      };
      deleteSession: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceMutationResponse;
      };
      stateSessionNavigationSetPinned: {
        params: SetSessionPinnedCommandInput;
        response: StateCommandResult;
      };
      stateSessionNavigationSetArchived: {
        params: SetSessionArchivedCommandInput;
        response: StateCommandResult;
      };
      stateSessionNavigationMarkRead: {
        params: MarkSessionReadCommandInput;
        response: StateCommandResult;
      };
      stateSessionNavigationMarkUnread: {
        params: MarkSessionUnreadCommandInput;
        response: StateCommandResult;
      };
      stateSessionNavigationSetSectionState: {
        params: SetSessionNavigationSectionStateCommandInput;
        response: StateCommandResult;
      };
      stateWorkspaceChromeSetTabs: {
        params: SetWorkspaceTabsCommandInput;
        response: StateCommandResult;
      };
      stateWorkspaceChromeSelectTab: {
        params: SelectWorkspaceTabCommandInput;
        response: StateCommandResult;
      };
      stateWorkspaceChromeSelectLayoutSlot: {
        params: SelectWorkspaceLayoutSlotCommandInput;
        response: StateCommandResult;
      };
      stateWorkspaceLayoutSaveSlot: {
        params: SaveWorkspaceLayoutSlotCommandInput;
        response: StateCommandResult;
      };
      sendPrompt: {
        params: WorkspaceScoped<SendPromptRequest>;
        response: SendPromptResponse;
      };
      recordRendererTelemetry: {
        params: WorkspaceScoped<RendererTelemetryRequest>;
        response: RendererTelemetryResponse;
      };
      updateComposerDraft: {
        params: WorkspaceScoped<UpdateComposerDraftRequest>;
        response: SurfaceMutationResponse;
      };
      editCommittedUserMessage: {
        params: WorkspaceScoped<EditCommittedUserMessageRequest>;
        response: EditCommittedUserMessageResponse;
      };
      deleteQueuedSurfaceMessage: {
        params: WorkspaceScoped<QueuedSurfaceMessageRequest>;
        response: SurfaceMutationResponse;
      };
      editQueuedSurfaceMessage: {
        params: WorkspaceScoped<QueuedSurfaceMessageRequest>;
        response: EditQueuedSurfaceMessageResponse;
      };
      reorderQueuedSurfaceMessage: {
        params: WorkspaceScoped<ReorderQueuedSurfaceMessageRequest>;
        response: SurfaceMutationResponse;
      };
      steerQueuedSurfaceMessage: {
        params: WorkspaceScoped<QueuedSurfaceMessageRequest>;
        response: SurfaceMutationResponse;
      };
      answerRequestUserInput: {
        params: WorkspaceScoped<RequestUserInputAnswerRequest>;
        response: RequestUserInputAnswerResponse;
      };
      answerRuntimeApprovalRequest: {
        params: WorkspaceScoped<AnswerRuntimeApprovalRequest>;
        response: RuntimeApprovalAnswerResponse;
      };
      setRequestUserInputTimerPaused: {
        params: WorkspaceScoped<SetRequestUserInputTimerPausedRequest>;
        response: RequestInputTimerPauseResponse;
      };
      setSurfaceModel: {
        params: WorkspaceScoped<SetSurfaceModelRequest>;
        response: SurfaceMutationResponse;
      };
      setSurfaceThoughtLevel: {
        params: WorkspaceScoped<SetSurfaceThoughtLevelRequest>;
        response: SurfaceMutationResponse;
      };
      setSurfaceExtensionUsage: {
        params: WorkspaceScoped<SetSurfaceExtensionUsageRequest>;
        response: SurfaceMutationResponse;
      };
      cancelPrompt: {
        params: WorkspaceScoped<CancelPromptRequest>;
        response: WorkspaceMutationResponse;
      };
      listProviderAuths: {
        params: undefined;
        response: ProviderAuthInfo[];
      };
      setProviderApiKey: {
        params: { providerId: string; apiKey: string };
        response: { ok: boolean };
      };
      startOAuth: {
        params: { providerId: string };
        response: { ok: boolean; error?: string };
      };
      removeProviderAuth: {
        params: { providerId: string };
        response: { ok: boolean };
      };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      sendDesktopNotification: DesktopRendererNotification;
    };
  };
}
