import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, UserMessage } from "@mariozechner/pi-ai";
import type {
  AgentProfileId,
  AgentProfileSettings,
  AgentSettingsState,
  AppPreferences,
  RequestUserInputSettings,
  ReasoningEffort,
  WorkflowAgentKey,
  WorkflowAgentSettings,
} from "./agent-settings";
import type { FileBackedSaveMode } from "./file-backed-edit";
import type {
  ExtensionCategory,
  ExtensionInterfaceKind,
  ExtensionUsageState,
  WorkspaceSessionNavigationReadModel as CoreWorkspaceSessionNavigationReadModel,
  WorkspaceSessionNavigationSectionId,
  WorkspaceSessionNavigationSectionState,
} from "@svvy/core";
import type { ComposerSnippetMention, SentSnippetProvenance } from "./snippets";
import type { GeneratedAgentContextExternalSource } from "./generated-agent-context";
import type {
  CreateManagedSnippetRequest,
  DeleteManagedSnippetRequest,
  ManagedSnippet,
  SetSnippetEnabledRequest,
  SnippetsReadModel,
  UpdateManagedSnippetRequest,
} from "./snippets";
import type { AppMenuAction } from "./shortcut-registry";
import type {
  AnswerRequestInputResult,
  ArtifactId,
  AppLogLevel,
  AppLogQuery,
  AppLogReadModel,
  AppLogSummary,
  ByteCount,
  CommandFactsPayload,
  CommandId,
  JsonValue,
  MessageId,
  NonNegativeSafeInteger,
  PositiveSafeInteger,
  ProviderAuthStatus,
  ProviderId,
  QueueItemId,
  RequestInputRequestId,
  RuntimeApprovalId,
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  RuntimeMessageDelivery,
  RuntimeSurfaceTarget,
  RuntimeSubmittedAttachment,
  RuntimeClientSubmissionMetadata,
  StateInvalidationDescriptor,
  StateStoredError,
  StateRevision,
  SnippetId,
  SurfacePiSessionId,
  SurfaceStreamGenerationId,
  SurfaceStreamSequence,
  SurfaceStreamPatchInput as CoreSurfaceStreamPatchInput,
  ThreadId,
  TurnId,
  ComposerAttachment,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspacePaneId,
  WorkspaceTabId,
} from "@svvy/core";
import { COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX } from "@svvy/core";
import type {
  MarkAppLogReadCommandInput,
  StateCommandResult,
  UpdateAppPreferencesCommandInput,
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
  workspaceId?: WorkspaceId;
  threadId: ThreadId;
}

export interface WorkflowTaskAttemptInspectorReadModelRequest {
  kind: "workflowTaskAttemptInspector";
  workspaceId?: WorkspaceId;
  workflowTaskAttemptId: WorkflowTaskAttemptId;
}

export interface WorkspaceChromeLayoutReadModelRequest {
  kind: "workspaceChromeLayout";
  workspaceId?: WorkspaceId;
  layoutId?: "A" | "B" | "C";
}

export type SessionNavigationReadModel =
  CoreWorkspaceSessionNavigationReadModel<WorkspaceSessionSummary>;

export interface SurfaceTranscriptReadModel {
  target: RuntimeSurfaceTarget;
  surfaceStatus: "idle" | "running" | "waiting" | "error";
  promptLock: { activeTurnId: TurnId | null; queuedCount: number };
  composerDraft: { text: string; attachmentIds: readonly string[] };
  messages: readonly {
    messageId: MessageId;
    role: "user" | "assistant";
    turnId?: TurnId;
    text?: string;
    commandIds?: readonly CommandId[];
    createdAt: string;
  }[];
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

export interface CommandInspectorReadModel {
  commandId: CommandId;
  status: "pending" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  toolName: string;
  target?: RuntimeSurfaceTarget;
  acceptedArguments?: JsonValue;
  summary?: string;
  error?: StateStoredError;
  finishedAt?: string;
  output: readonly {
    stream: "stdout" | "stderr";
    text: string;
    sequence: NonNegativeSafeInteger;
  }[];
  stdin: {
    mode: "none" | "continuable";
    canAttemptWrite: boolean;
    acceptedWrites: readonly {
      text: string;
      acceptedBytes: ByteCount;
      at: string;
    }[];
  };
  facts?: CommandFactsPayload;
  childCommandIds: readonly CommandId[];
  artifactIds: readonly ArtifactId[];
}

export interface RequestInputReadModel {
  requests: readonly WorkspaceRequestUserInputRequest[];
}

export interface ApprovalsReadModel {
  requests: readonly WorkspaceRuntimeApprovalRequest[];
}

export interface AgentsReadModel {
  profiles: readonly AgentProfileReadModelRecord[];
  generatedContextPreviews: readonly GeneratedContextPreviewReadModelRecord[];
}

export interface AgentProfileReadModelRecord {
  profileId: string;
  actor: "orchestrator" | "handler" | "workflow-task";
  name: string;
  providerId: string;
  modelId: string;
  reasoning: JsonValue | null;
  followComposer: boolean;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
  generatedAgentContextFingerprint: string | null;
  source: "surface-binding" | "handler-thread" | "workflow-task-attempt";
}

export interface GeneratedContextPreviewReadModelRecord {
  ownerKind: "session" | "thread" | "workflow-task-attempt";
  ownerId: string;
  surfacePiSessionId: SurfacePiSessionId;
  actorKind: "orchestrator" | "handler" | "workflow-task";
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
  externalSourceHashes: readonly string[];
}

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
  source: "svvy" | "claude" | "pi" | "host";
  title: string;
  body: string;
  metadata: JsonValue;
  enabled: boolean;
  path: string | null;
  updatedAt: string | null;
}

export interface WorkflowsGeneratedReadModel {
  packageName: "@svvyx/workflows";
  facts: readonly unknown[];
  exports: readonly WorkflowsGeneratedExportReadModelRecord[];
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
}

export interface WorkspaceChromeLayoutReadModel {
  activeWorkspaceTabId: WorkspaceTabId | null;
  tabs: readonly WorkspaceTabReadModelRecord[];
  knownWorkspaces: readonly WorkspaceTabReadModelRecord[];
  layouts: readonly WorkspaceLayoutReadModelRecord[];
}

export interface WorkspaceTabReadModelRecord {
  workspaceTabId: WorkspaceTabId;
  workspaceId: WorkspaceId;
  cwd: string;
  openedAt: string;
  activeLayoutId: WorkspaceLayoutSlotId;
}

export interface WorkspaceLayoutReadModelRecord {
  workspaceId: WorkspaceId;
  layoutId: WorkspaceLayoutSlotId;
  initialized: boolean;
  snapshotJson: JsonValue | null;
  focusedPaneId: WorkspacePaneId | null;
  panelMetadata: readonly WorkspacePaneReadModelRecord[];
}

export interface WorkspacePaneReadModelRecord {
  paneId: WorkspacePaneId;
  kind: "surface" | "inspector" | "static";
  target: JsonValue;
  localStateJson: JsonValue | null;
}

export type DesktopRendererNotificationScope =
  | { kind: "app" }
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "surface"; workspaceId: WorkspaceId; surfacePiSessionId: SurfacePiSessionId };

export type DesktopRendererCommand = "command-palette.open" | "quick-open.open" | "settings.open";

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
  | WorkspaceChromeLayoutReadModelRequest;

export type StateReadModelResult =
  | { kind: "appLogs"; value: AppLogReadModel }
  | { kind: "appLogSummary"; value: AppLogSummary }
  | { kind: "appPreferences"; value: AppPreferencesReadModel }
  | { kind: "settings"; value: SettingsReadModel }
  | { kind: "providerAuth"; value: ProviderAuthReadModel }
  | { kind: "sessionNavigation"; value: SessionNavigationReadModel }
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
  | { kind: "workspaceChromeLayout"; value: WorkspaceChromeLayoutReadModel };

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

export interface SetExtensionDefaultUsageRequest extends WorkspaceScopedRequest {
  actorKind: "orchestrator" | "workflow-task";
  extensionId: string;
  state: ExtensionUsageState;
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
  snapshot?: ConversationSurfaceSnapshot;
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

export type SvvyUserMessage = UserMessage & {
  svvyMetadata?: SvvyUserMessageMetadata;
};

export interface QueuedSurfaceMessageRequest {
  target: PromptTarget;
  queuedMessageId: string;
}

export interface SetExtensionContextAutoUpdateRequest {
  target: PromptTarget;
  enabled: boolean;
}

export interface ReorderQueuedSurfaceMessageRequest extends QueuedSurfaceMessageRequest {
  beforeQueuedMessageId?: string | null;
}

export interface EditCommittedUserMessageRequest {
  target: PromptTarget;
  messageTimestamp: string | number;
  message: Message;
}

export interface EditQueuedSurfaceMessageResponse {
  ok: boolean;
  text?: string;
  snapshot?: ConversationSurfaceSnapshot;
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

export interface WorkspaceSyncMessage {
  workspaceId: string;
  reason: "workspace.updated" | "structured.updated" | "artifact.open";
  sessions: WorkspaceSessionSummary[];
  navigation: WorkspaceSessionNavigationReadModel;
  requestUserInputRequests: WorkspaceRequestUserInputRequest[];
  runtimeApprovalRequests: WorkspaceRuntimeApprovalRequest[];
  artifactOpenRequest?: {
    workspaceSessionId: string;
    artifactId: string;
  };
}

export interface CancelPromptRequest {
  target: PromptTarget;
}

export type WorkspaceKind = "default" | "user";

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
  activeLayoutId?: WorkspaceLayoutSlotId;
}

export interface AppWorkspaceTabsState {
  version: 4;
  activeWorkspaceTabId: string | null;
  tabs: WorkspaceTabInfo[];
  knownWorkspaces: WorkspaceTabInfo[];
}

export type WorkspaceLayoutSlotId = "A" | "B" | "C";

export interface AppWorkspaceUiRestoreState {
  version: 5;
  layouts: Record<WorkspaceLayoutSlotId, unknown | null>;
}

export interface SetWorkspaceUiRestoreRequest extends WorkspaceScopedRequest {
  state: AppWorkspaceUiRestoreState;
}

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

export type SessionStatus = "idle" | "running" | "waiting" | "error";
export type SessionTitleGenerationStatus =
  | "not-started"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

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

export interface WorkspaceCommandInspectorChild extends WorkspaceCommandRollupChild {
  visibility: "trace" | "summary" | "surface";
  facts: Record<string, unknown> | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  artifacts: WorkspaceCommandArtifactLink[];
  outputEvents: WorkspaceCommandOutputEvent[];
  stdin: WorkspaceCommandStdinState;
  argumentSnapshots: WorkspaceCommandArgumentSnapshot[];
  progressEvents?: WorkspaceCommandProgressEvent[];
  patchSnapshots: WorkspaceCommandPatchSnapshot[];
  diagnostics: WorkspaceCommandDiagnosticSnapshot[];
}

export interface WorkspaceCommandInspector {
  commandId: string;
  threadId: string | null;
  workflowRunId?: string | null;
  workflowTaskAttemptId?: string | null;
  toolName: string;
  visibility: "trace" | "summary" | "surface";
  status: "streaming" | "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  title: string;
  summary: string;
  facts: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  artifacts: WorkspaceCommandArtifactLink[];
  outputEvents: WorkspaceCommandOutputEvent[];
  stdin: WorkspaceCommandStdinState;
  argumentSnapshots: WorkspaceCommandArgumentSnapshot[];
  progressEvents?: WorkspaceCommandProgressEvent[];
  patchSnapshots: WorkspaceCommandPatchSnapshot[];
  diagnostics: WorkspaceCommandDiagnosticSnapshot[];
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: WorkspaceCommandInspectorChild[];
  traceChildren: WorkspaceCommandInspectorChild[];
}

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
  agentProfileId: string | null;
}

export interface WorkspaceWorkflowsGeneratedReadModel {
  generatedPackagePath: string;
  items: WorkspaceWorkflowsGeneratedExport[];
  counts: Record<WorkspaceWorkflowsGeneratedKind, number>;
  updatedAt: string;
}

export interface OpenWorkspaceSourceInEditorRequest {
  path: string;
}

export interface OpenGeneratedAgentContextExternalSourceInEditorRequest {
  path: string;
}

export interface OpenSnippetExternalSourceInEditorRequest {
  path: string;
}

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

export interface WorkspaceSidebarRowSubtitle {
  badge: "waiting" | "error" | "workflow" | "text";
  text: string;
  tone: "muted" | "waiting" | "error";
}

export interface WorkspaceSidebarWorkflowRow {
  workflowRunId: string;
  workflowName: string;
  status: WorkspaceHandlerThreadWorkflowSummary["status"];
  subtitle: WorkspaceSidebarRowSubtitle | null;
  updatedAt: string;
}

export interface WorkspaceSidebarHandlerThreadRow {
  threadId: string;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  status: WorkspaceHandlerThreadSummary["status"];
  subtitle: WorkspaceSidebarRowSubtitle | null;
  latestCommandRollup: WorkspaceCommandRollup | null;
  updatedAt: string;
  workflows: WorkspaceSidebarWorkflowRow[];
}

export interface WorkspaceSessionSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  status: SessionStatus;
  isPinned: boolean;
  pinnedAt: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  isUnread: boolean;
  unreadAt: string | null;
  unreadReason: "assistant-turn-finished" | "manual" | null;
  lastReadAt: string | null;
  sessionFile?: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  modelId?: string;
  provider?: string;
  thinkingLevel?: string;
  wait?: {
    threadId?: string;
    kind: "user" | "external" | "approval" | "signal" | "timer";
    reason: string;
    resumeWhen: string;
    since: string;
  } | null;
  counts?: {
    turns: number;
    threads: number;
    commands: number;
    episodes: number;
    workflows: number;
    artifacts: number;
    events: number;
  };
  threadIdsByStatus?: {
    runningHandler: string[];
    runningWorkflow: string[];
    waiting: string[];
    troubleshooting: string[];
  };
  threadIds?: string[];
  sidebarThreads?: WorkspaceSidebarHandlerThreadRow[];
  commandRollups?: WorkspaceCommandRollup[];
  productEvents?: WorkspaceProductEvent[];
  titleGeneration?: {
    status: SessionTitleGenerationStatus;
    renameLocked: boolean;
    autoFrozen: boolean;
    manualOverride: boolean;
    triggeredAt: string | null;
    finishedAt: string | null;
    error: string | null;
  };
}

export type { WorkspaceSessionNavigationSectionId, WorkspaceSessionNavigationSectionState };

export type WorkspaceSessionNavigationReadModel =
  CoreWorkspaceSessionNavigationReadModel<WorkspaceSessionSummary>;

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

export interface RequestUserInputAnswerResponse extends SurfaceMutationResponse {
  requestId: AnswerRequestInputResult["requestId"];
  questionId: AnswerRequestInputResult["questionId"];
  status: AnswerRequestInputResult["status"];
  delivery: AnswerRequestInputResult["delivery"];
}

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

export interface ConversationSurfaceSnapshot {
  target: PromptTarget;
  messages: AgentMessage[];
  pendingUserMessage?: AgentMessage | null;
  queuedMessages: QueuedSurfaceMessage[];
  composerDraft: ComposerDraft;
  streamMessage?: AssistantMessage | null;
  streamSequence: number;
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  agentProfileId: AgentProfileId;
  loadedExtensionIds: string[];
  availableExtensionIds: string[];
  systemPrompt: string;
  resolvedSystemPrompt: string;
  externalContextSources: GeneratedAgentContextExternalSource[];
  promptBinding?: {
    currentRevision: number;
    boundSystemPrompt: string;
    currentSystemPrompt: string;
    boundFingerprint: string | null;
    currentFingerprint: string;
    boundExternalSourceHashes: string[];
    currentExternalSourceHashes: string[];
    updateExtensionContextBeforeNextTurn: boolean;
    stale: boolean;
  };
  promptStatus: "idle" | "streaming";
  activeTurnId: string | null;
  activeTurnStartedAt: string | null;
  turnTimings: ConversationTurnTiming[];
}

export interface ConversationTurnTiming {
  turnId: string;
  assistantMessageTimestamp: string | number;
  startedAt: string;
  finishedAt: string;
}

export type SurfaceStreamPatchInput =
  | {
      type: "start";
      message: AssistantMessage;
    }
  | {
      type: "text_start" | "thinking_start";
      contentIndex: number;
    }
  | {
      type: "text_delta" | "thinking_delta";
      contentIndex: number;
      delta: string;
    }
  | {
      type: "text_end" | "thinking_end";
      contentIndex: number;
      content: string;
    }
  | {
      type: "toolcall_start" | "toolcall_delta" | "toolcall_end";
      contentIndex: number;
      toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>;
    }
  | {
      type: "clear";
      reason: "done" | "error";
    };

export type SurfaceStreamPatch = SurfaceStreamPatchInput & {
  sequence: number;
};

export interface SurfaceSyncMessage {
  workspaceId: string;
  reason:
    | "surface.updated"
    | "prompt.settled"
    | "background.started"
    | "surface.closed"
    | "stream.patch";
  target: PromptTarget;
  snapshot?: ConversationSurfaceSnapshot;
  streamPatch?: SurfaceStreamPatch;
}

export interface ListSessionsResponse {
  sessions: WorkspaceSessionSummary[];
  navigation: WorkspaceSessionNavigationReadModel;
  requestUserInputRequests: WorkspaceRequestUserInputRequest[];
  runtimeApprovalRequests: WorkspaceRuntimeApprovalRequest[];
}

export interface CreateSessionRequest {
  title?: string;
  parentSessionId?: string;
  agentProfileId?: AgentProfileId;
}

export interface UpdateAgentProfileRequest {
  profile: AgentProfileSettings;
}

export interface DeleteAgentProfileRequest {
  id: AgentProfileId;
}

export interface ReorderOrchestratorAgentsRequest {
  ids: AgentProfileId[];
}

export interface UpdateWorkflowAgentRequest {
  key: WorkflowAgentKey;
  settings: WorkflowAgentSettings;
  baseSourceVersion?: string;
  mode?: FileBackedSaveMode;
}

export type UpdateWorkflowAgentResponse =
  | {
      ok: true;
      state: AgentSettingsState;
      agent: WorkflowAgentSettings;
    }
  | {
      ok: false;
      code: "file_backed_edit_conflict";
      state: AgentSettingsState;
      current: WorkflowAgentSettings;
      currentVersion: string;
      baseVersion: string;
    };

export interface DeleteWorkflowAgentRequest {
  key: WorkflowAgentKey;
}

export interface OpenWorkflowAgentSourceInEditorRequest {
  key: WorkflowAgentKey;
}

export interface SetAgentProfileExtensionUsageRequest {
  agentProfile: AgentProfileId | WorkflowAgentKey | "threadHandler";
  extensionId: string;
  state: ExtensionUsageState;
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

export interface AgentModelChoice {
  providerId: string;
  modelId: string;
  providerAuthenticated: boolean;
  authSource: Exclude<AuthKeyType, "none"> | "missing";
  supportedReasoning: ReasoningEffort[];
  capabilities: {
    reasoning: boolean;
    vision: boolean;
    toolCalling: boolean;
  };
}

export interface AgentModelChoicesResponse {
  items: AgentModelChoice[];
}

export interface OpenSessionRequest {
  sessionId: string;
}

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
  snapshot?: ConversationSurfaceSnapshot;
}

export interface ChatRPCSchema {
  bun: {
    requests: {
      rendererReady: {
        params: undefined;
        response: { ok: true };
      };
      getAgentSettings: {
        params: WorkspaceScopedRequest;
        response: AgentSettingsState;
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
      getGeneratedAgentContextExternalSources: {
        params: WorkspaceScopedRequest;
        response: GeneratedAgentContextExternalSource[];
      };
      getSnippets: {
        params: WorkspaceScopedRequest;
        response: SnippetsReadModel;
      };
      createManagedSnippet: {
        params: WorkspaceScoped<CreateManagedSnippetRequest>;
        response: ManagedSnippet;
      };
      updateManagedSnippet: {
        params: WorkspaceScoped<UpdateManagedSnippetRequest>;
        response: ManagedSnippet;
      };
      deleteManagedSnippet: {
        params: WorkspaceScoped<DeleteManagedSnippetRequest>;
        response: { ok: true };
      };
      setSnippetEnabled: {
        params: WorkspaceScoped<SetSnippetEnabledRequest>;
        response: { ok: true };
      };
      openSnippetExternalSourceInEditor: {
        params: WorkspaceScoped<OpenSnippetExternalSourceInEditorRequest>;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      updateAgentProfile: {
        params: WorkspaceScoped<UpdateAgentProfileRequest>;
        response: AgentSettingsState;
      };
      deleteAgentProfile: {
        params: WorkspaceScoped<DeleteAgentProfileRequest>;
        response: AgentSettingsState;
      };
      reorderOrchestratorAgents: {
        params: WorkspaceScoped<ReorderOrchestratorAgentsRequest>;
        response: AgentSettingsState;
      };
      updateWorkflowAgent: {
        params: WorkspaceScoped<UpdateWorkflowAgentRequest>;
        response: UpdateWorkflowAgentResponse;
      };
      deleteWorkflowAgent: {
        params: WorkspaceScoped<DeleteWorkflowAgentRequest>;
        response: AgentSettingsState;
      };
      openWorkflowAgentSourceInEditor: {
        params: WorkspaceScoped<OpenWorkflowAgentSourceInEditorRequest>;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      setAgentProfileExtensionUsage: {
        params: WorkspaceScoped<SetAgentProfileExtensionUsageRequest>;
        response: AgentSettingsState;
      };
      getAgentContextPreview: {
        params: WorkspaceScoped<AgentContextPreviewRequest>;
        response: AgentContextPreviewResponse;
      };
      getAgentModelChoices: {
        params: WorkspaceScopedRequest;
        response: AgentModelChoicesResponse;
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
      setExtensionDefaultUsage: {
        params: SetExtensionDefaultUsageRequest;
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
      setExtensionEnvOverride: {
        params: SetExtensionEnvOverrideRequest;
        response: ExtensionsInventoryReadModel;
      };
      removeExtensionEnvOverride: {
        params: RemoveExtensionEnvOverrideRequest;
        response: ExtensionsInventoryReadModel;
      };
      updateRequestUserInputSettings: {
        params: WorkspaceScoped<RequestUserInputSettings>;
        response: AgentSettingsState;
      };
      openWorkspace: {
        params: OpenWorkspaceRequest;
        response: OpenWorkspaceResponse;
      };
      getOpenWorkspaces: {
        params: undefined;
        response: WorkspaceInfoResponse[];
      };
      getDefaultWorkspace: {
        params: undefined;
        response: WorkspaceInfoResponse;
      };
      getAppWorkspaceTabs: {
        params: undefined;
        response: AppWorkspaceTabsState | null;
      };
      setAppWorkspaceTabs: {
        params: AppWorkspaceTabsState;
        response: WorkspaceMutationResponse;
      };
      getWorkspaceUiRestore: {
        params: WorkspaceScopedRequest;
        response: AppWorkspaceUiRestoreState | null;
      };
      setWorkspaceUiRestore: {
        params: SetWorkspaceUiRestoreRequest;
        response: WorkspaceMutationResponse;
      };
      setActiveWorkspace: {
        params: WorkspaceScopedRequest;
        response: WorkspaceMutationResponse;
      };
      closeWorkspace: {
        params: WorkspaceScopedRequest;
        response: WorkspaceMutationResponse;
      };
      getWorkspaceInfo: {
        params: WorkspaceScopedRequest;
        response: WorkspaceInfoResponse;
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
      getWorkflowsGenerated: {
        params: WorkspaceScopedRequest;
        response: WorkspaceWorkflowsGeneratedReadModel;
      };
      openWorkspaceSourceInEditor: {
        params: WorkspaceScoped<OpenWorkspaceSourceInEditorRequest>;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      openGeneratedAgentContextExternalSourceInEditor: {
        params: WorkspaceScoped<OpenGeneratedAgentContextExternalSourceInEditorRequest>;
        response: OpenWorkspaceSourceInEditorResponse;
      };
      listSessions: {
        params: WorkspaceScopedRequest;
        response: ListSessionsResponse;
      };
      getCommandInspector: {
        params: WorkspaceScoped<{ sessionId: string; commandId: string }>;
        response: WorkspaceCommandInspector | null;
      };
      writeCommandStdin: {
        params: WorkspaceScoped<WriteCommandStdinRequest>;
        response: WriteCommandStdinResponse;
      };
      listHandlerThreads: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceHandlerThreadSummary[];
      };
      getArtifactPreview: {
        params: WorkspaceScoped<{ sessionId: string; artifactId: string }>;
        response: WorkspaceArtifactPreview;
      };
      createSession: {
        params: WorkspaceScoped<CreateSessionRequest>;
        response: ConversationSurfaceSnapshot;
      };
      openSession: {
        params: WorkspaceScoped<OpenSessionRequest>;
        response: ConversationSurfaceSnapshot;
      };
      openSurface: {
        params: WorkspaceScoped<OpenSurfaceRequest>;
        response: ConversationSurfaceSnapshot;
      };
      closeSurface: {
        params: WorkspaceScoped<CloseSurfaceRequest>;
        response: WorkspaceMutationResponse;
      };
      renameSession: {
        params: WorkspaceScoped<RenameSessionRequest>;
        response: WorkspaceMutationResponse;
      };
      forkSession: {
        params: WorkspaceScoped<ForkSessionRequest>;
        response: ConversationSurfaceSnapshot;
      };
      deleteSession: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceMutationResponse;
      };
      pinSession: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceMutationResponse;
      };
      unpinSession: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceMutationResponse;
      };
      archiveSession: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceMutationResponse;
      };
      unarchiveSession: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceMutationResponse;
      };
      markSessionUnread: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceMutationResponse;
      };
      markSessionRead: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceMutationResponse;
      };
      recordFocusedSession: {
        params: WorkspaceScoped<{ sessionId: string | null; surfacePiSessionId?: string | null }>;
        response: WorkspaceMutationResponse;
      };
      setSessionNavigationSectionState: {
        params: WorkspaceScoped<{
          section: WorkspaceSessionNavigationSectionId;
          collapsed?: boolean;
          sizePx?: number;
        }>;
        response: WorkspaceMutationResponse;
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
        response: SurfaceMutationResponse;
      };
      setRequestUserInputTimerPaused: {
        params: WorkspaceScoped<SetRequestUserInputTimerPausedRequest>;
        response: WorkspaceMutationResponse;
      };
      setExtensionContextAutoUpdate: {
        params: WorkspaceScoped<SetExtensionContextAutoUpdateRequest>;
        response: SurfaceMutationResponse;
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
      sendWorkspaceSync: WorkspaceSyncMessage;
      sendSurfaceSync: SurfaceSyncMessage;
      sendDesktopNotification: DesktopRendererNotification;
      sendAppMenuAction: { action: AppMenuAction };
    };
  };
}
