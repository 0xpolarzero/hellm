import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, UserMessage } from "@mariozechner/pi-ai";
import type {
  AgentDefaults,
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
import type { ExtensionCategory, ExtensionInterfaceKind, ExtensionUsageState } from "./extensions";
import type { ComposerSnippetMention, SentSnippetProvenance } from "./snippets";
import type {
  GeneratedAgentContextActor,
  CreateGeneratedAgentContextSnapshotRequest,
  GeneratedAgentContextExternalSource,
  GeneratedAgentContextEntry,
  GeneratedAgentContextSnapshotSummary,
  GeneratedAgentContextState,
  RenameGeneratedAgentContextSnapshotRequest,
  RestoreGeneratedAgentContextSnapshotRequest,
  UpdateGeneratedAgentContextRequest,
} from "./generated-agent-context";
import type {
  CreateManagedSnippetRequest,
  DeleteManagedSnippetRequest,
  ManagedSnippet,
  SnippetsReadModel,
  UpdateManagedSnippetRequest,
} from "./snippets";
import type { AppMenuAction } from "./shortcut-registry";

export type AuthKeyType = "apikey" | "oauth" | "env" | "none";
export type PromptSurfaceKind = "orchestrator" | "thread";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

export type AppLogSource =
  | "app.lifecycle"
  | "app.bridge"
  | "app.rpc"
  | "auth.provider"
  | "settings"
  | "workspace"
  | "session"
  | "session.title"
  | "source.graph"
  | "surface"
  | "prompt"
  | "thread"
  | "smithers"
  | "workflow.library"
  | "workflow.run"
  | "workflow.task"
  | "direct-tool"
  | "execute_typescript"
  | "artifact"
  | "external-editor"
  | "renderer";

export interface AppLogEntry {
  id: string;
  seq: number;
  createdAt: string;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
  details?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
  workspaceSessionId?: string;
  surfacePiSessionId?: string;
  threadId?: string;
  workflowRunId?: string;
  workflowTaskAttemptId?: string;
  commandId?: string;
  artifactId?: string;
}

export interface AppLogSummary {
  latestSeq: number;
  seenSeq: number;
  unread: {
    total: number;
    debug: number;
    info: number;
    warn: number;
    error: number;
  };
  totals: {
    total: number;
    debug: number;
    info: number;
    warn: number;
    error: number;
  };
}

export interface AppLogQuery {
  levels?: AppLogLevel[];
  sources?: AppLogSource[];
  query?: string;
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
}

export interface AppLogReadModel {
  entries: AppLogEntry[];
  summary: AppLogSummary;
}

export interface AppLogUpdateMessage {
  workspaceId: string;
  entries: AppLogEntry[];
  summary: AppLogSummary;
}

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

export interface RevertExtensionChangeRequest extends WorkspaceScopedRequest {
  changeId: string;
  owningSurface?: {
    workspaceSessionId: string;
    surface: PromptSurfaceKind;
    surfacePiSessionId: string;
    threadId?: string;
  };
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

export type ExtensionCliRequirementAction = "install" | "update";

export interface RunExtensionCliRequirementActionRequest extends WorkspaceScopedRequest {
  runId: string;
  extensionId: string;
  requirementId: string;
  action: ExtensionCliRequirementAction;
}

export interface RunExtensionCliRequirementActionResponse {
  runId: string;
  inventory: ExtensionsInventoryReadModel;
  command: string;
  status: "success" | "failed";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export type ExtensionCliRequirementActionUpdateStatus = "started" | "output" | "success" | "failed";

export interface ExtensionCliRequirementActionUpdateMessage {
  workspaceId: string;
  runId: string;
  extensionId: string;
  requirementId: string;
  action: ExtensionCliRequirementAction;
  command: string;
  status: ExtensionCliRequirementActionUpdateStatus;
  at: string;
  outputEvent?: WorkspaceCommandOutputEvent;
  exitCode?: number | null;
  signal?: string | null;
  error?: string | null;
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

export interface ReorderExtensionInstructionFilesRequest extends WorkspaceScopedRequest {
  extensionId: string;
  names: string[];
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
  name: string;
  value: string;
}

export interface RemoveExtensionEnvSecretRequest extends WorkspaceScopedRequest {
  extensionId: string;
  name: string;
}

export interface SetExtensionEnvOverrideRequest extends WorkspaceScopedRequest {
  extensionId: string;
  name: string;
  value: string;
}

export interface RemoveExtensionEnvOverrideRequest extends WorkspaceScopedRequest {
  extensionId: string;
  name: string;
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

export interface SendPromptRequest {
  messages: Message[];
  provider?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  target: PromptTarget;
  systemPrompt?: string;
  queueOnly?: boolean;
}

export interface SendPromptResponse {
  target: PromptTarget;
  queued?: boolean;
  snapshot?: ConversationSurfaceSnapshot;
}

export type QueuedSurfaceMessageStatus = "queued" | "steering" | "dispatching" | "failed";
export type QueuedSurfaceMessageKind =
  | "user_message"
  | "agent_context_refresh"
  | "initial_handler_start"
  | "thread_followup"
  | "report_request"
  | "thread_report_notification"
  | "request_user_input_answer";

export interface QueuedSurfaceMessage {
  id: string;
  kind: QueuedSurfaceMessageKind;
  text: string;
  title?: string;
  summary?: string;
  agentContextUpdate?: QueuedAgentContextUpdateProjection;
  threadId?: string;
  episodeId?: string;
  sourceCommandId?: string;
  status: QueuedSurfaceMessageStatus;
  failureError?: string;
  createdAt: string;
  updatedAt: string;
}

export type QueuedAgentContextUpdateState = "queued" | "updating" | "out_of_date" | "failed";
export type AgentContextUpdateTerminalState = "applied" | "cancelled";

export interface QueuedAgentContextUpdateDiff {
  added: string[];
  removed: string[];
}

export interface QueuedAgentContextUpdateProjection {
  state: QueuedAgentContextUpdateState;
  requestedRevision: number;
  currentRevision: number;
  requestedAt: string;
  reason?: string;
  requestedFingerprint?: string;
  currentFingerprint: string;
  previousFingerprint: string | null;
  systemPromptChanged: boolean;
  loadedExtensionIds: QueuedAgentContextUpdateDiff;
  availableExtensionIds: QueuedAgentContextUpdateDiff;
  externalSourceHashes: QueuedAgentContextUpdateDiff;
}

export interface AgentContextUpdateTerminalProjection extends Omit<
  QueuedAgentContextUpdateProjection,
  "state"
> {
  state: AgentContextUpdateTerminalState;
  completedAt: string;
  queueMessageId?: string;
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

export interface QueuePromptRefreshRequest {
  target: PromptTarget;
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

export interface ProviderAuthStateRequest {
  providerId?: string;
}

export interface AuthStateResponse {
  connected: boolean;
  accountId?: string;
  message?: string;
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

export type ComposerAttachmentKind = "file" | "folder" | "image";

export interface ComposerAttachment {
  id: string;
  kind: ComposerAttachmentKind;
  name: string;
  path: string;
  workspaceRelativePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  dataBase64?: string;
}

export const COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX = "svvy:composer-attachments:v1:";

export function composerAttachmentPromptText(attachments: readonly ComposerAttachment[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map((attachment) => {
    const path = attachment.workspaceRelativePath ?? attachment.path;
    return `- ${attachment.kind} path: ${path} (name: ${attachment.name})`;
  });
  return `Attached files are available at these workspace-relative paths:\n${lines.join("\n")}`;
}

export function serializeComposerAttachmentTextSignature(
  attachments: readonly ComposerAttachment[],
): string {
  return `${COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX}${JSON.stringify(
    attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      path: attachment.path,
      workspaceRelativePath: attachment.workspaceRelativePath,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
  )}`;
}

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
  progressEvents?: WorkspaceCommandProgressEvent[];
  patchSnapshots?: WorkspaceCommandPatchSnapshot[];
  diagnostics?: WorkspaceCommandDiagnosticSnapshot[];
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: WorkspaceCommandRollupChild[];
  updatedAt: string;
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
  progressEvents?: WorkspaceCommandProgressEvent[];
  patchSnapshots: WorkspaceCommandPatchSnapshot[];
  diagnostics: WorkspaceCommandDiagnosticSnapshot[];
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: WorkspaceCommandInspectorChild[];
  traceChildren: WorkspaceCommandInspectorChild[];
}

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
  kind: "analysis" | "change" | "workflow" | "clarification";
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

export type WorkspaceSessionNavigationSectionId = "pinned" | "active" | "archived";

export interface WorkspaceSessionNavigationSectionState {
  collapsed: boolean;
  sizePx: number;
}

export interface WorkspaceSessionNavigationReadModel {
  pinnedSessions: WorkspaceSessionSummary[];
  activeSessions: WorkspaceSessionSummary[];
  sections: Record<WorkspaceSessionNavigationSectionId, WorkspaceSessionNavigationSectionState>;
  archived: {
    collapsed: boolean;
    sessions: WorkspaceSessionSummary[];
  };
}

export type WorkspaceRequestUserInputDelivery = "steer" | "after_turn";

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
}

export interface SetRequestUserInputTimerPausedRequest {
  surfacePiSessionId: string;
  requestId: string;
  paused: boolean;
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
  agentContextUpdate?: AgentContextUpdateTerminalProjection;
  promptBinding?: {
    currentRevision: number;
    boundSystemPrompt: string;
    currentSystemPrompt: string;
    boundFingerprint: string | null;
    currentFingerprint: string;
    boundExternalSourceHashes: string[];
    currentExternalSourceHashes: string[];
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
      getDefaults: {
        params: undefined;
        response: AgentDefaults;
      };
      getAgentSettings: {
        params: WorkspaceScopedRequest;
        response: AgentSettingsState;
      };
      getAppPreferences: {
        params: undefined;
        response: AppPreferences;
      };
      getGeneratedAgentContext: {
        params: WorkspaceScopedRequest;
        response: GeneratedAgentContextState;
      };
      getGeneratedAgentContextDefaults: {
        params: WorkspaceScopedRequest;
        response: GeneratedAgentContextState;
      };
      updateGeneratedAgentContext: {
        params: WorkspaceScoped<UpdateGeneratedAgentContextRequest>;
        response: GeneratedAgentContextState;
      };
      resetGeneratedAgentContext: {
        params: WorkspaceScopedRequest;
        response: GeneratedAgentContextState;
      };
      listGeneratedAgentContextSnapshots: {
        params: WorkspaceScopedRequest;
        response: GeneratedAgentContextSnapshotSummary[];
      };
      createGeneratedAgentContextSnapshot: {
        params: WorkspaceScoped<CreateGeneratedAgentContextSnapshotRequest>;
        response: GeneratedAgentContextSnapshotSummary;
      };
      renameGeneratedAgentContextSnapshot: {
        params: WorkspaceScoped<RenameGeneratedAgentContextSnapshotRequest>;
        response: GeneratedAgentContextSnapshotSummary;
      };
      restoreGeneratedAgentContextSnapshot: {
        params: WorkspaceScoped<RestoreGeneratedAgentContextSnapshotRequest>;
        response: GeneratedAgentContextState;
      };
      getGeneratedAgentContextEntries: {
        params: WorkspaceScopedRequest;
        response: Record<GeneratedAgentContextActor, GeneratedAgentContextEntry[]>;
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
      revertExtensionChange: {
        params: RevertExtensionChangeRequest;
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
      runExtensionCliRequirementAction: {
        params: RunExtensionCliRequirementActionRequest;
        response: RunExtensionCliRequirementActionResponse;
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
      reorderExtensionInstructionFiles: {
        params: ReorderExtensionInstructionFilesRequest;
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
      updateAppPreferences: {
        params: AppPreferences;
        response: AgentSettingsState;
      };
      updateRequestUserInputSettings: {
        params: WorkspaceScoped<RequestUserInputSettings>;
        response: AgentSettingsState;
      };
      getProviderAuthState: {
        params: ProviderAuthStateRequest;
        response: AuthStateResponse;
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
      getAppLogs: {
        params: WorkspaceScoped<AppLogQuery>;
        response: AppLogReadModel;
      };
      getAppLogSummary: {
        params: WorkspaceScopedRequest;
        response: AppLogSummary;
      };
      markAppLogsSeen: {
        params: WorkspaceScoped<{ throughSeq: number }>;
        response: AppLogSummary;
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
      listHandlerThreads: {
        params: WorkspaceScoped<{ sessionId: string }>;
        response: WorkspaceHandlerThreadSummary[];
      };
      getHandlerThreadInspector: {
        params: WorkspaceScoped<{ sessionId: string; threadId: string }>;
        response: WorkspaceHandlerThreadInspector | null;
      };
      getWorkflowTaskAttemptInspector: {
        params: WorkspaceScoped<{ sessionId: string; workflowTaskAttemptId: string }>;
        response: WorkspaceWorkflowTaskAttemptInspector | null;
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
      recordSessionOpened: {
        params: WorkspaceScoped<OpenSessionRequest>;
        response: WorkspaceMutationResponse;
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
      setArchivedGroupCollapsed: {
        params: WorkspaceScoped<{ collapsed: boolean }>;
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
      updateComposerDraft: {
        params: WorkspaceScoped<UpdateComposerDraftRequest>;
        response: SurfaceMutationResponse;
      };
      editCommittedUserMessage: {
        params: WorkspaceScoped<EditCommittedUserMessageRequest>;
        response: SendPromptResponse;
      };
      steerPrompt: {
        params: WorkspaceScoped<SendPromptRequest>;
        response: SendPromptResponse;
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
        response: SurfaceMutationResponse;
      };
      answerRuntimeApprovalRequest: {
        params: WorkspaceScoped<AnswerRuntimeApprovalRequest>;
        response: SurfaceMutationResponse;
      };
      setRequestUserInputTimerPaused: {
        params: WorkspaceScoped<SetRequestUserInputTimerPausedRequest>;
        response: WorkspaceMutationResponse;
      };
      queuePromptRefresh: {
        params: WorkspaceScoped<QueuePromptRefreshRequest>;
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
      sendAppLogUpdate: AppLogUpdateMessage;
      sendExtensionCliRequirementActionUpdate: ExtensionCliRequirementActionUpdateMessage;
      sendAppMenuAction: { action: AppMenuAction };
    };
  };
}
