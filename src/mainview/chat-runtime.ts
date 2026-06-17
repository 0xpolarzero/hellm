import { Agent, type AgentMessage, type StreamFn } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  getModel,
  type AssistantMessage,
  type ImageContent,
  type Message,
  type Model,
  type TextContent,
} from "@mariozechner/pi-ai";
import {
  composerAttachmentPromptText,
  serializeComposerAttachmentTextSignature,
  type AppWorkspaceUiRestoreState,
  type AppLogQuery,
  type AppLogReadModel,
  type AppLogSummary,
  type AppLogUpdateMessage,
  type ConversationSurfaceSnapshot,
  type ConversationTurnTiming,
  type ComposerAttachment,
  type ComposerDraft,
  type CreateSessionRequest,
  type EditCommittedUserMessageRequest,
  type PromptTarget,
  type QueuedSurfaceMessage,
  type SendPromptRequest,
  type SurfaceStreamPatch,
  type SurfaceSyncMessage,
  type WorkspaceBranchInfo,
  type WorkspaceCommandInspector,
  type WorkspacePathIndexEntry,
  type SvvyUserMessage,
  type WorkspaceHandlerThreadInspector,
  type WorkspaceHandlerThreadSummary,
  type WorkspaceArtifactPreview,
  type AnswerRuntimeApprovalRequest,
  type RequestUserInputAnswerRequest,
  type SetRequestUserInputTimerPausedRequest,
  type WorkspaceSessionNavigationReadModel,
  type WorkspaceRequestUserInputRequest,
  type WorkspaceRuntimeApprovalRequest,
  type WorkspaceSessionSummary,
  type WorkspaceSyncMessage,
  type WorkspaceWorkflowTaskAttemptInspector,
  type WorkspaceWorkflowsGeneratedReadModel,
  type WorkspacePaneSurfaceTarget,
  type WorkspaceInfoResponse,
  type AgentContextPreviewRequest,
  type AgentContextPreviewResponse,
  type AgentModelChoicesResponse,
  type AddExtensionInstructionFileRequest,
  type BuildExtensionRequest,
  type ConfigureExtensionInstructionFileRequest,
  type CreateExtensionRequest,
  type DeleteExtensionRequest,
  type DuplicateExtensionRequest,
  type ExtensionCliRequirementActionUpdateMessage,
  type ExtensionsInventoryReadModel,
  type OpenExtensionInstructionFileInEditorRequest,
  type ProviderAuthInfo,
  type RemoveExtensionInstructionFileRequest,
  type RemoveExtensionEnvOverrideRequest,
  type RemoveExtensionEnvSecretRequest,
  type ReorderExtensionDefaultsRequest,
  type ReorderExtensionInstructionFilesRequest,
  type ResetExtensionRequest,
  type RunExtensionCliRequirementActionRequest,
  type RunExtensionCliRequirementActionResponse,
  type SetAgentProfileExtensionUsageRequest,
  type SetExtensionDefaultUsageRequest,
  type SetExtensionEnvOverrideRequest,
  type SetExtensionEnvSecretRequest,
  type SetExtensionTypescriptApiRequest,
  type UpdateExtensionInstructionFileRequest,
  type UpdateWorkflowAgentResponse,
} from "../shared/workspace-contract";
import { FileBackedEditConflictError, type FileBackedSaveMode } from "../shared/file-backed-edit";
import type {
  GeneratedAgentContextActor,
  GeneratedAgentContextExternalSource,
  GeneratedAgentContextEntry,
  GeneratedAgentContextSnapshotSummary,
  GeneratedAgentContextState,
  UpdateGeneratedAgentContextRequest,
} from "../shared/generated-agent-context";
import type {
  ComposerSnippetMention,
  CreateManagedSnippetRequest,
  ManagedSnippet,
  SentSnippetProvenance,
  SnippetsReadModel,
  UpdateManagedSnippetRequest,
} from "../shared/snippets";
import { createChatStorage, type ChatStorage } from "./chat-storage";
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentSettingsState,
  type AppPreferences,
  type ReasoningEffort,
  type AgentProfileSettings,
  type AgentProfileId,
  type RequestUserInputSettings,
  type WorkflowAgentKey,
  type WorkflowAgentSettings,
} from "../shared/agent-settings";
import type { AppMenuAction } from "../shared/shortcut-registry";
import type { ExtensionUsageState } from "../shared/extensions";
import {
  addDockviewPanel,
  bindPane,
  closePane,
  createEmptyPaneLayout,
  createPanelId,
  focusPane,
  isInitializedPaneLayout,
  markDockviewPanelUnavailable,
  normalizePaneLayout,
  PRIMARY_CHAT_PANE_ID,
  setDockviewSerializedLayout,
  setPaneScroll as setLayoutPaneScroll,
  splitPane,
  WORKSPACE_LAYOUT_SLOT_IDS,
  type PaneOpenTarget,
  type DockviewPanelPlacementState,
  type DockviewSplitDirection,
  type WorkspaceDockviewLayoutState,
  type WorkspaceLayoutSlotId,
  type WorkspaceLayoutSlotSummary,
} from "./pane-layout";
import { mergeAppLogEntries } from "./app-logs";
import { rpc } from "./rpc";
import { buildWorkspaceSessionNavigation } from "./session-state";

export { PRIMARY_CHAT_PANE_ID } from "./pane-layout";

type WorkspaceUiRestoreState = AppWorkspaceUiRestoreState & {
  layouts: Record<WorkspaceLayoutSlotId, WorkspaceDockviewLayoutState | null>;
};

type UsageStats = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

const ZERO_USAGE: UsageStats = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

type AppReadModelCache = {
  agentSettings: AgentSettingsState | null;
  appPreferences: AppPreferences | null;
  workflowsGenerated: WorkspaceWorkflowsGeneratedReadModel | null;
  agentModelChoices: AgentModelChoicesResponse | null;
  providerAuths: ProviderAuthInfo[] | null;
};

type WorkspaceReadModelCache = {
  appLogs: AppLogReadModel | null;
  extensionsInventory: ExtensionsInventoryReadModel | null;
  externalInstructionSources: GeneratedAgentContextExternalSource[] | null;
  snippets: SnippetsReadModel | null;
};

const appReadModelCache: AppReadModelCache = {
  agentSettings: null,
  appPreferences: null,
  workflowsGenerated: null,
  agentModelChoices: null,
  providerAuths: null,
};

const workspaceReadModelCaches = new Map<string, WorkspaceReadModelCache>();
const activeRuntimeEmitters = new Set<{ workspaceId: string; emit: () => void }>();

function workspaceReadModelCache(workspaceId: string): WorkspaceReadModelCache {
  const existing = workspaceReadModelCaches.get(workspaceId);
  if (existing) return existing;
  const cache: WorkspaceReadModelCache = {
    appLogs: null,
    extensionsInventory: null,
    externalInstructionSources: null,
    snippets: null,
  };
  workspaceReadModelCaches.set(workspaceId, cache);
  return cache;
}

function cloneOrNull<T>(value: T | null): T | null {
  return value ? structuredClone(value) : null;
}

function notifyReadModelCachesChanged(workspaceId?: string): void {
  for (const entry of activeRuntimeEmitters) {
    if (!workspaceId || entry.workspaceId === workspaceId) {
      entry.emit();
    }
  }
}

function buildUserMessage(input: ComposerPromptSubmission): Message {
  const text = input.text.trim();
  const content: Array<TextContent | ImageContent> = [];
  if (text) {
    content.push({ type: "text", text });
  }
  const attachmentText = composerAttachmentPromptText(input.attachments);
  if (attachmentText) {
    content.push({
      type: "text",
      text: attachmentText,
      textSignature: serializeComposerAttachmentTextSignature(input.attachments),
    });
  }
  for (const attachment of input.attachments) {
    if (attachment.kind !== "image" || !attachment.dataBase64 || !attachment.mimeType) continue;
    content.push({ type: "image", data: attachment.dataBase64, mimeType: attachment.mimeType });
  }
  const message: SvvyUserMessage = {
    role: "user",
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    timestamp: Date.now(),
  };
  if (input.snippetProvenance?.length) {
    message.svvyMetadata = {
      snippetProvenance: structuredClone(input.snippetProvenance),
    };
  }
  return message;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

type ChatRuntimeListener = () => void;
type PromptStatus = ConversationSurfaceSnapshot["promptStatus"];

export type QueuedPrompt = QueuedSurfaceMessage;

export type ComposerPromptSubmission = {
  text: string;
  attachments: ComposerAttachment[];
  snippetMentions?: ComposerSnippetMention[];
  snippetProvenance?: SentSnippetProvenance[];
};

export interface ChatPaneState {
  id: string;
  target: WorkspacePaneSurfaceTarget | null;
  scroll: ChatPaneLayoutState["panels"][number]["localState"]["scroll"];
  timelineDensity: "compact" | "comfortable";
  chrome: ChatPaneLayoutState["panels"][number]["chrome"] | null;
  restore: ChatPaneLayoutState["panels"][number]["restore"] | null;
}

export type ChatPaneLayoutState = WorkspaceDockviewLayoutState;

export interface ChatSurfaceController {
  agent: SurfaceAgent;
  target: PromptTarget;
  resolvedSystemPrompt: string;
  promptBinding?: ConversationSurfaceSnapshot["promptBinding"];
  externalContextSources: GeneratedAgentContextExternalSource[];
  loadedExtensionIds: string[];
  availableExtensionIds: string[];
  agentProfileId: AgentProfileId;
  promptStatus: PromptStatus;
  activeTurnId: string | null;
  activeTurnStartedAt: string | null;
  turnTimings: ConversationTurnTiming[];
  queuedPrompts: QueuedPrompt[];
  composerDraft: ComposerDraft;
  ownerPaneIds: string[];
  sendPrompt: (input: ComposerPromptSubmission) => Promise<void>;
  updateComposerDraft: (
    draft: Pick<ComposerDraft, "text" | "attachments" | "snippetMentions">,
  ) => Promise<void>;
  editCommittedUserMessage: (
    messageTimestamp: string | number,
    input: ComposerPromptSubmission,
  ) => Promise<void>;
  editQueuedPrompt: (promptId: string) => Promise<string | null>;
  deleteQueuedPrompt: (promptId: string) => Promise<boolean>;
  reorderQueuedPrompt: (promptId: string, beforePromptId: string | null) => Promise<boolean>;
  steerQueuedPrompt: (promptId: string) => Promise<boolean>;
  setExtensionContextAutoUpdate: (enabled: boolean) => Promise<boolean>;
  setExtensionUsage: (extensionId: string, state: ExtensionUsageState) => Promise<void>;
  abort: () => Promise<void>;
  subscribe: (listener: ChatRuntimeListener) => () => void;
}

interface ChatSurfaceControllerInternal extends ChatSurfaceController {
  attachPane: (panelId: string) => void;
  detachPane: (panelId: string) => void;
  applySnapshot: (snapshot: ConversationSurfaceSnapshot) => void;
  applyStreamPatch: (patch: SurfaceStreamPatch) => void;
  dispose: () => void;
}

type SurfaceAgentState = Agent["state"] & {
  isStreaming: boolean;
  streamMessage?: AgentMessage | null;
  streamingMessage?: AgentMessage;
  error?: string;
  errorMessage?: string;
};

export type SurfaceAgent = Agent & {
  readonly state: SurfaceAgentState;
  setSystemPrompt: (systemPrompt: string) => void;
  setModel: (model: Model<any>) => void;
  setThinkingLevel: (level: Agent["state"]["thinkingLevel"]) => void;
  replaceMessages: (messages: AgentMessage[]) => void;
  setTools: (tools: Agent["state"]["tools"]) => void;
};

export interface ChatRuntimeRpcClient {
  request: {
    getDefaults: typeof rpc.request.getDefaults;
    getAgentSettings: typeof rpc.request.getAgentSettings;
    getAgentContextPreview: typeof rpc.request.getAgentContextPreview;
    getAgentModelChoices: typeof rpc.request.getAgentModelChoices;
    getExtensionsInventory: typeof rpc.request.getExtensionsInventory;
    getAppPreferences: typeof rpc.request.getAppPreferences;
    revertExtensionChange: typeof rpc.request.revertExtensionChange;
    saveExtensionSnapshot: typeof rpc.request.saveExtensionSnapshot;
    renameExtensionSnapshot: typeof rpc.request.renameExtensionSnapshot;
    deleteExtensionSnapshot: typeof rpc.request.deleteExtensionSnapshot;
    loadExtensionSnapshot: typeof rpc.request.loadExtensionSnapshot;
    createExtension: typeof rpc.request.createExtension;
    duplicateExtension: typeof rpc.request.duplicateExtension;
    deleteExtension: typeof rpc.request.deleteExtension;
    resetExtension: typeof rpc.request.resetExtension;
    buildExtension: typeof rpc.request.buildExtension;
    runExtensionCliRequirementAction: typeof rpc.request.runExtensionCliRequirementAction;
    setExtensionTypescriptApi: typeof rpc.request.setExtensionTypescriptApi;
    setExtensionDefaultUsage: typeof rpc.request.setExtensionDefaultUsage;
    reorderExtensionDefaults: typeof rpc.request.reorderExtensionDefaults;
    addExtensionInstructionFile: typeof rpc.request.addExtensionInstructionFile;
    removeExtensionInstructionFile: typeof rpc.request.removeExtensionInstructionFile;
    configureExtensionInstructionFile: typeof rpc.request.configureExtensionInstructionFile;
    reorderExtensionInstructionFiles: typeof rpc.request.reorderExtensionInstructionFiles;
    updateExtensionInstructionFile: typeof rpc.request.updateExtensionInstructionFile;
    openExtensionInstructionFileInEditor: typeof rpc.request.openExtensionInstructionFileInEditor;
    setExtensionEnvSecret: typeof rpc.request.setExtensionEnvSecret;
    removeExtensionEnvSecret: typeof rpc.request.removeExtensionEnvSecret;
    setExtensionEnvOverride: typeof rpc.request.setExtensionEnvOverride;
    removeExtensionEnvOverride: typeof rpc.request.removeExtensionEnvOverride;
    getGeneratedAgentContext: typeof rpc.request.getGeneratedAgentContext;
    getGeneratedAgentContextDefaults: typeof rpc.request.getGeneratedAgentContextDefaults;
    updateGeneratedAgentContext: typeof rpc.request.updateGeneratedAgentContext;
    resetGeneratedAgentContext: typeof rpc.request.resetGeneratedAgentContext;
    listGeneratedAgentContextSnapshots: typeof rpc.request.listGeneratedAgentContextSnapshots;
    createGeneratedAgentContextSnapshot: typeof rpc.request.createGeneratedAgentContextSnapshot;
    renameGeneratedAgentContextSnapshot: typeof rpc.request.renameGeneratedAgentContextSnapshot;
    restoreGeneratedAgentContextSnapshot: typeof rpc.request.restoreGeneratedAgentContextSnapshot;
    getGeneratedAgentContextExternalSources: typeof rpc.request.getGeneratedAgentContextExternalSources;
    getSnippets: typeof rpc.request.getSnippets;
    createManagedSnippet: typeof rpc.request.createManagedSnippet;
    updateManagedSnippet: typeof rpc.request.updateManagedSnippet;
    deleteManagedSnippet: typeof rpc.request.deleteManagedSnippet;
    openSnippetExternalSourceInEditor: typeof rpc.request.openSnippetExternalSourceInEditor;
    updateAgentProfile: typeof rpc.request.updateAgentProfile;
    deleteAgentProfile: typeof rpc.request.deleteAgentProfile;
    reorderOrchestratorAgents: typeof rpc.request.reorderOrchestratorAgents;
    updateWorkflowAgent: typeof rpc.request.updateWorkflowAgent;
    deleteWorkflowAgent: typeof rpc.request.deleteWorkflowAgent;
    openWorkflowAgentSourceInEditor: typeof rpc.request.openWorkflowAgentSourceInEditor;
    setAgentProfileExtensionUsage: typeof rpc.request.setAgentProfileExtensionUsage;
    updateAppPreferences: typeof rpc.request.updateAppPreferences;
    updateRequestUserInputSettings: typeof rpc.request.updateRequestUserInputSettings;
    getProviderAuthState: typeof rpc.request.getProviderAuthState;
    getOpenWorkspaces: typeof rpc.request.getOpenWorkspaces;
    getWorkspaceInfo: typeof rpc.request.getWorkspaceInfo;
    getWorkspaceUiRestore: typeof rpc.request.getWorkspaceUiRestore;
    setWorkspaceUiRestore: typeof rpc.request.setWorkspaceUiRestore;
    listWorkspaceBranches: typeof rpc.request.listWorkspaceBranches;
    switchWorkspaceBranch: typeof rpc.request.switchWorkspaceBranch;
    getAppLogs: typeof rpc.request.getAppLogs;
    getAppLogSummary: typeof rpc.request.getAppLogSummary;
    markAppLogsSeen: typeof rpc.request.markAppLogsSeen;
    writeClipboardText: typeof rpc.request.writeClipboardText;
    listWorkspacePaths: typeof rpc.request.listWorkspacePaths;
    pickWorkspaceAttachments: typeof rpc.request.pickWorkspaceAttachments;
    importComposerAttachments: typeof rpc.request.importComposerAttachments;
    openWorkspacePath: typeof rpc.request.openWorkspacePath;
    getWorkflowsGenerated: typeof rpc.request.getWorkflowsGenerated;
    openWorkspaceSourceInEditor: typeof rpc.request.openWorkspaceSourceInEditor;
    openGeneratedAgentContextExternalSourceInEditor: typeof rpc.request.openGeneratedAgentContextExternalSourceInEditor;
    getGeneratedAgentContextEntries: typeof rpc.request.getGeneratedAgentContextEntries;
    listSessions: typeof rpc.request.listSessions;
    getCommandInspector: typeof rpc.request.getCommandInspector;
    listHandlerThreads: typeof rpc.request.listHandlerThreads;
    getHandlerThreadInspector: typeof rpc.request.getHandlerThreadInspector;
    getWorkflowTaskAttemptInspector: typeof rpc.request.getWorkflowTaskAttemptInspector;
    getArtifactPreview: typeof rpc.request.getArtifactPreview;
    createSession: typeof rpc.request.createSession;
    openSession: typeof rpc.request.openSession;
    recordSessionOpened: typeof rpc.request.recordSessionOpened;
    openSurface: typeof rpc.request.openSurface;
    closeSurface: typeof rpc.request.closeSurface;
    renameSession: typeof rpc.request.renameSession;
    forkSession: typeof rpc.request.forkSession;
    deleteSession: typeof rpc.request.deleteSession;
    pinSession: typeof rpc.request.pinSession;
    unpinSession: typeof rpc.request.unpinSession;
    archiveSession: typeof rpc.request.archiveSession;
    unarchiveSession: typeof rpc.request.unarchiveSession;
    markSessionUnread: typeof rpc.request.markSessionUnread;
    markSessionRead: typeof rpc.request.markSessionRead;
    recordFocusedSession: typeof rpc.request.recordFocusedSession;
    setArchivedGroupCollapsed: typeof rpc.request.setArchivedGroupCollapsed;
    setSessionNavigationSectionState: typeof rpc.request.setSessionNavigationSectionState;
    sendPrompt: typeof rpc.request.sendPrompt;
    updateComposerDraft: typeof rpc.request.updateComposerDraft;
    editCommittedUserMessage: typeof rpc.request.editCommittedUserMessage;
    deleteQueuedSurfaceMessage: typeof rpc.request.deleteQueuedSurfaceMessage;
    editQueuedSurfaceMessage: typeof rpc.request.editQueuedSurfaceMessage;
    reorderQueuedSurfaceMessage: typeof rpc.request.reorderQueuedSurfaceMessage;
    steerQueuedSurfaceMessage: typeof rpc.request.steerQueuedSurfaceMessage;
    answerRequestUserInput: typeof rpc.request.answerRequestUserInput;
    answerRuntimeApprovalRequest: typeof rpc.request.answerRuntimeApprovalRequest;
    setRequestUserInputTimerPaused: typeof rpc.request.setRequestUserInputTimerPaused;
    setExtensionContextAutoUpdate: typeof rpc.request.setExtensionContextAutoUpdate;
    setSurfaceModel: typeof rpc.request.setSurfaceModel;
    setSurfaceThoughtLevel: typeof rpc.request.setSurfaceThoughtLevel;
    setSurfaceExtensionUsage: typeof rpc.request.setSurfaceExtensionUsage;
    cancelPrompt: typeof rpc.request.cancelPrompt;
    listProviderAuths: typeof rpc.request.listProviderAuths;
    setProviderApiKey: typeof rpc.request.setProviderApiKey;
    startOAuth: typeof rpc.request.startOAuth;
    removeProviderAuth: typeof rpc.request.removeProviderAuth;
  };
  addMessageListener: typeof rpc.addMessageListener;
  removeMessageListener: typeof rpc.removeMessageListener;
}

const DEFAULT_RPC_CLIENT: ChatRuntimeRpcClient = rpc;

export interface ChatRuntimeOptions {
  workspaceInfo?: WorkspaceInfoResponse;
  workspaceId?: string;
  workspaceTabId?: string;
  initialLayoutId?: WorkspaceLayoutSlotId;
  onActiveLayoutChange?: (layoutId: WorkspaceLayoutSlotId) => void;
  onWorkspaceLayoutPersist?: (state: AppWorkspaceUiRestoreState) => void;
  onMissingProviderAccess?: (provider: string) => void;
}

export interface ChatRuntime {
  storage: ChatStorage;
  workspaceId: string;
  workspaceTabId?: string;
  workspaceLabel: string;
  cwd: string;
  branch?: string;
  kind: WorkspaceInfoResponse["kind"];
  appLogSummary: AppLogSummary;
  agentSettingsSnapshot: AgentSettingsState | null;
  appPreferencesSnapshot: AppPreferences | null;
  agentModelChoicesSnapshot: AgentModelChoicesResponse | null;
  providerAuthsSnapshot: ProviderAuthInfo[] | null;
  extensionsInventorySnapshot: ExtensionsInventoryReadModel | null;
  externalInstructionSourcesSnapshot: GeneratedAgentContextExternalSource[] | null;
  workflowsGeneratedSnapshot: WorkspaceWorkflowsGeneratedReadModel | null;
  snippetsSnapshot: SnippetsReadModel | null;
  appLogsSnapshot: AppLogReadModel | null;
  sessions: WorkspaceSessionSummary[];
  sessionNavigation: WorkspaceSessionNavigationReadModel;
  paneLayout: ChatPaneLayoutState;
  activeLayoutId: WorkspaceLayoutSlotId;
  layoutSlots: WorkspaceLayoutSlotSummary[];
  layoutSlotsEnabled: boolean;
  primaryPaneId: string;
  dispose: () => void;
  subscribe: (listener: ChatRuntimeListener) => () => void;
  subscribeAppLogUpdate: (listener: (payload: AppLogUpdateMessage) => void) => () => void;
  subscribeExtensionCliRequirementActionUpdate: (
    listener: (payload: ExtensionCliRequirementActionUpdateMessage) => void,
  ) => () => void;
  subscribeAppMenuAction: (listener: (action: AppMenuAction) => void) => () => void;
  listSessions: () => Promise<WorkspaceSessionSummary[]>;
  getPane: (panelId: string) => ChatPaneState | undefined;
  getPaneController: (panelId: string) => ChatSurfaceController | null;
  getSurfaceController: (surfacePiSessionId: string) => ChatSurfaceController | null;
  focusPane: (panelId: string) => void;
  splitPane: (
    panelId: string,
    direction: DockviewSplitDirection,
    options?: { duplicateBinding?: boolean; size?: number },
  ) => Promise<string | null>;
  closePane: (panelId: string) => Promise<void>;
  setDockviewLayout: (
    dockview: WorkspaceDockviewLayoutState["dockview"],
    focusedPanelId?: string | null,
  ) => void;
  syncWorkspaceLayoutState: (state: AppWorkspaceUiRestoreState) => Promise<void>;
  switchWorkspaceLayout: (layoutId: WorkspaceLayoutSlotId) => Promise<void>;
  getCommandInspector: (
    commandId: string,
    sessionId?: string,
  ) => Promise<WorkspaceCommandInspector>;
  listHandlerThreads: (sessionId?: string) => Promise<WorkspaceHandlerThreadSummary[]>;
  getHandlerThreadInspector: (
    threadId: string,
    sessionId?: string,
  ) => Promise<WorkspaceHandlerThreadInspector>;
  getWorkflowTaskAttemptInspector: (
    workflowTaskAttemptId: string,
    sessionId?: string,
  ) => Promise<WorkspaceWorkflowTaskAttemptInspector>;
  getArtifactPreview: (artifactId: string, sessionId?: string) => Promise<WorkspaceArtifactPreview>;
  getRequestUserInputRequests: () => WorkspaceRequestUserInputRequest[];
  answerRequestUserInput: (request: RequestUserInputAnswerRequest) => Promise<void>;
  setRequestUserInputTimerPaused: (request: SetRequestUserInputTimerPausedRequest) => Promise<void>;
  getRuntimeApprovalRequests: () => WorkspaceRuntimeApprovalRequest[];
  answerRuntimeApprovalRequest: (request: AnswerRuntimeApprovalRequest) => Promise<void>;
  getAppLogs: (query?: AppLogQuery) => Promise<AppLogReadModel>;
  getAppLogSummary: () => Promise<AppLogSummary>;
  markAppLogsSeen: (throughSeq: number) => Promise<AppLogSummary>;
  writeClipboardText: (text: string) => Promise<void>;
  createSession: (
    request?: CreateSessionRequest,
    openTarget?: PaneOpenTarget | string,
  ) => Promise<void>;
  openSession: (sessionId: string, openTarget?: PaneOpenTarget | string) => Promise<void>;
  openSurface: (
    target: WorkspacePaneSurfaceTarget,
    openTarget?: PaneOpenTarget | string,
  ) => Promise<void>;
  closePaneSurface: (panelId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  forkSession: (
    sessionId: string,
    title?: string,
    openTarget?: PaneOpenTarget | string,
    options?: { messageTimestamp?: string | number },
  ) => Promise<void>;
  deleteSession: (sessionId: string, panelId?: string) => Promise<void>;
  pinSession: (sessionId: string) => Promise<void>;
  unpinSession: (sessionId: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  unarchiveSession: (sessionId: string) => Promise<void>;
  markSessionUnread: (sessionId: string) => Promise<void>;
  markSessionRead: (sessionId: string) => Promise<void>;
  setArchivedGroupCollapsed: (collapsed: boolean) => Promise<void>;
  setSessionNavigationSectionState: (
    section: "pinned" | "active" | "archived",
    state: { collapsed?: boolean; sizePx?: number },
  ) => Promise<void>;
  setPaneScroll: (
    panelId: string,
    scroll: ChatPaneLayoutState["panels"][number]["localState"]["scroll"],
  ) => void;
  sendPromptToTarget: (target: PromptTarget, input: string) => Promise<void>;
  syncProviderAuth: (providerId: string) => Promise<boolean>;
  requireProviderAccess: (providerId: string) => Promise<boolean>;
  listOpenWorkspaces: () => Promise<WorkspaceInfoResponse[]>;
  listWorkspaceBranches: () => Promise<WorkspaceBranchInfo[]>;
  switchWorkspaceBranch: (branch: string) => Promise<void>;
  listWorkspacePaths: (options?: { refresh?: boolean }) => Promise<WorkspacePathIndexEntry[]>;
  pickWorkspaceAttachments: () => Promise<ComposerAttachment[]>;
  importComposerAttachments: (files: File[]) => Promise<ComposerAttachment[]>;
  openWorkspacePath: (workspaceRelativePath: string) => Promise<boolean>;
  getWorkflowsGenerated: () => Promise<WorkspaceWorkflowsGeneratedReadModel>;
  openWorkspaceSourceInEditor: (path: string) => Promise<boolean>;
  openGeneratedAgentContextExternalSourceInEditor: (path: string) => Promise<boolean>;
  getGeneratedAgentContext: () => Promise<GeneratedAgentContextState>;
  getGeneratedAgentContextDefaults: () => Promise<GeneratedAgentContextState>;
  getGeneratedAgentContextEntries: () => Promise<
    Record<GeneratedAgentContextActor, GeneratedAgentContextEntry[]>
  >;
  getGeneratedAgentContextExternalSources: () => Promise<GeneratedAgentContextExternalSource[]>;
  getAgentSettings: () => Promise<AgentSettingsState>;
  getAgentContextPreview: (
    request?: AgentContextPreviewRequest,
  ) => Promise<AgentContextPreviewResponse>;
  getAgentModelChoices: () => Promise<AgentModelChoicesResponse>;
  listProviderAuths: () => Promise<ProviderAuthInfo[]>;
  setProviderApiKey: (request: { providerId: string; apiKey: string }) => Promise<{ ok: boolean }>;
  startOAuth: (request: { providerId: string }) => Promise<{ ok: boolean; error?: string }>;
  removeProviderAuth: (request: { providerId: string }) => Promise<{ ok: boolean }>;
  getExtensionsInventory: () => Promise<ExtensionsInventoryReadModel>;
  getAppPreferences: () => Promise<AppPreferences>;
  updateAppPreferences: (preferences: AppPreferences) => Promise<AppPreferences>;
  revertExtensionChange: (changeId: string) => Promise<ExtensionsInventoryReadModel>;
  saveExtensionSnapshot: (name: string) => Promise<ExtensionsInventoryReadModel>;
  renameExtensionSnapshot: (
    snapshotId: string,
    name: string,
  ) => Promise<ExtensionsInventoryReadModel>;
  deleteExtensionSnapshot: (snapshotId: string) => Promise<ExtensionsInventoryReadModel>;
  loadExtensionSnapshot: (snapshotId: string) => Promise<ExtensionsInventoryReadModel>;
  createExtension: (
    input: Omit<CreateExtensionRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  duplicateExtension: (
    input: Omit<DuplicateExtensionRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  deleteExtension: (
    input: Omit<DeleteExtensionRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  resetExtension: (
    input: Omit<ResetExtensionRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  buildExtension: (
    input: Omit<BuildExtensionRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  runExtensionCliRequirementAction: (
    input: Omit<RunExtensionCliRequirementActionRequest, "workspaceId">,
  ) => Promise<RunExtensionCliRequirementActionResponse>;
  setExtensionTypescriptApi: (
    input: Omit<SetExtensionTypescriptApiRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  setExtensionDefaultUsage: (
    input: Omit<SetExtensionDefaultUsageRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  reorderExtensionDefaults: (
    input: Omit<ReorderExtensionDefaultsRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  addExtensionInstructionFile: (
    input: Omit<AddExtensionInstructionFileRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  removeExtensionInstructionFile: (
    input: Omit<RemoveExtensionInstructionFileRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  configureExtensionInstructionFile: (
    input: Omit<ConfigureExtensionInstructionFileRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  reorderExtensionInstructionFiles: (
    input: Omit<ReorderExtensionInstructionFilesRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  updateExtensionInstructionFile: (
    input: Omit<UpdateExtensionInstructionFileRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  openExtensionInstructionFileInEditor: (
    input: Omit<OpenExtensionInstructionFileInEditorRequest, "workspaceId">,
  ) => Promise<boolean>;
  setExtensionEnvSecret: (
    input: Omit<SetExtensionEnvSecretRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  removeExtensionEnvSecret: (
    input: Omit<RemoveExtensionEnvSecretRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  setExtensionEnvOverride: (
    input: Omit<SetExtensionEnvOverrideRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  removeExtensionEnvOverride: (
    input: Omit<RemoveExtensionEnvOverrideRequest, "workspaceId">,
  ) => Promise<ExtensionsInventoryReadModel>;
  updateAgentProfile: (profile: AgentProfileSettings) => Promise<AgentSettingsState>;
  deleteAgentProfile: (id: AgentProfileId) => Promise<AgentSettingsState>;
  reorderOrchestratorAgents: (ids: AgentProfileId[]) => Promise<AgentSettingsState>;
  updateWorkflowAgent: (
    key: WorkflowAgentKey,
    settings: WorkflowAgentSettings,
    options?: { baseSourceVersion?: string; mode?: FileBackedSaveMode },
  ) => Promise<AgentSettingsState>;
  deleteWorkflowAgent: (key: WorkflowAgentKey) => Promise<AgentSettingsState>;
  openWorkflowAgentSourceInEditor: (key: WorkflowAgentKey) => Promise<boolean>;
  setAgentProfileExtensionUsage: (
    input: Omit<SetAgentProfileExtensionUsageRequest, "workspaceId">,
  ) => Promise<AgentSettingsState>;
  updateRequestUserInputSettings: (
    settings: RequestUserInputSettings,
  ) => Promise<AgentSettingsState>;
  updateGeneratedAgentContext: (
    request: UpdateGeneratedAgentContextRequest,
  ) => Promise<GeneratedAgentContextState>;
  resetGeneratedAgentContext: () => Promise<GeneratedAgentContextState>;
  listGeneratedAgentContextSnapshots: () => Promise<GeneratedAgentContextSnapshotSummary[]>;
  createGeneratedAgentContextSnapshot: (
    name: string,
  ) => Promise<GeneratedAgentContextSnapshotSummary>;
  renameGeneratedAgentContextSnapshot: (
    snapshotId: string,
    name: string,
  ) => Promise<GeneratedAgentContextSnapshotSummary>;
  restoreGeneratedAgentContextSnapshot: (snapshotId: string) => Promise<GeneratedAgentContextState>;
  getSnippets: () => Promise<SnippetsReadModel>;
  createManagedSnippet: (input: CreateManagedSnippetRequest) => Promise<ManagedSnippet>;
  updateManagedSnippet: (input: UpdateManagedSnippetRequest) => Promise<ManagedSnippet>;
  deleteManagedSnippet: (snippetId: string) => Promise<void>;
  openSnippetExternalSourceInEditor: (path: string) => Promise<boolean>;
}

function createFailureMessage(
  error: unknown,
  provider: string,
  model: string,
  stopReason: "aborted" | "error" = "error",
): AssistantMessage {
  const message = error instanceof Error ? error.message : "Unable to generate a response.";
  return {
    role: "assistant",
    content: [{ type: "text", text: message }],
    api: `${provider}-responses`,
    provider,
    model,
    timestamp: Date.now(),
    usage: ZERO_USAGE,
    stopReason,
    errorMessage: message,
  };
}

function initializeStorage(): ChatStorage {
  return createChatStorage();
}

function normalizePromptTarget(target: PromptTarget): PromptTarget {
  return {
    workspaceSessionId: target.workspaceSessionId,
    surface: target.surface,
    surfacePiSessionId: target.surfacePiSessionId,
    ...(target.threadId ? { threadId: target.threadId } : {}),
  };
}

function isPromptTarget(target: WorkspacePaneSurfaceTarget | null): target is PromptTarget {
  if (target?.surface !== "orchestrator" && target?.surface !== "thread") {
    return false;
  }
  if (
    typeof target.workspaceSessionId !== "string" ||
    target.workspaceSessionId.length === 0 ||
    typeof target.surfacePiSessionId !== "string" ||
    target.surfacePiSessionId.length === 0
  ) {
    return false;
  }
  if (target.surface === "thread") {
    return typeof target.threadId === "string" && target.threadId.length > 0;
  }
  return true;
}

function isWorkspaceLayoutSlotId(value: unknown): value is WorkspaceLayoutSlotId {
  return value === "A" || value === "B" || value === "C";
}

function isRestorableStaticTarget(
  target: WorkspacePaneSurfaceTarget,
  options: { allowOpenWorkspace: boolean },
): boolean {
  return (
    (options.allowOpenWorkspace && target.surface === "open-workspace") ||
    target.surface === "app-logs" ||
    target.surface === "agents" ||
    target.surface === "extensions" ||
    target.surface === "settings" ||
    target.surface === "workflows"
  );
}

function getPaneTargetWorkspaceSessionId(target: WorkspacePaneSurfaceTarget): string | null {
  return "workspaceSessionId" in target ? (target.workspaceSessionId ?? null) : null;
}

function formatUnavailableSurfaceReason(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The restored surface could not be reopened.";
}

function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter((message): message is Message => {
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
  });
}

function installSurfaceAgentMutators(agent: Agent): SurfaceAgent {
  const surfaceAgent = agent as SurfaceAgent;
  surfaceAgent.setSystemPrompt = (systemPrompt) => {
    surfaceAgent.state.systemPrompt = systemPrompt;
  };
  surfaceAgent.setModel = (model) => {
    surfaceAgent.state.model = model;
  };
  surfaceAgent.setThinkingLevel = (level) => {
    surfaceAgent.state.thinkingLevel = level;
  };
  surfaceAgent.replaceMessages = (messages) => {
    surfaceAgent.state.messages = messages;
  };
  surfaceAgent.setTools = (tools) => {
    surfaceAgent.state.tools = tools;
  };
  return surfaceAgent;
}

function setSurfaceAgentStreamState(
  agent: SurfaceAgent,
  input: { isStreaming: boolean; streamMessage?: AgentMessage | null; error?: string },
): void {
  agent.state.isStreaming = input.isStreaming;
  agent.state.streamMessage = input.streamMessage ?? null;
  agent.state.streamingMessage = input.streamMessage ?? undefined;
  agent.state.error = input.error;
  agent.state.errorMessage = input.error;
}

function applySurfaceSnapshotToAgent(
  agent: SurfaceAgent,
  payload: ConversationSurfaceSnapshot,
): void {
  const currentTools = [...agent.state.tools];
  agent.reset();
  agent.sessionId = payload.target.surfacePiSessionId;
  agent.setSystemPrompt(payload.systemPrompt);
  agent.setModel(
    getModel(
      payload.provider as Parameters<typeof getModel>[0],
      payload.model as Parameters<typeof getModel>[1],
    ),
  );
  agent.setThinkingLevel(payload.reasoningEffort);
  agent.replaceMessages(buildDisplayMessages(payload));
  setSurfaceAgentStreamState(agent, {
    isStreaming: payload.promptStatus === "streaming",
    streamMessage: payload.streamMessage ? structuredClone(payload.streamMessage) : null,
  });
  agent.setTools(currentTools);
}

function applyStreamPatchToMessage(
  message: AssistantMessage,
  patch: Exclude<SurfaceStreamPatch, { type: "clear" | "start" }>,
): AssistantMessage {
  const content = [...message.content];
  while (content.length <= patch.contentIndex) {
    content.push({ type: "text", text: "" });
  }

  if (patch.type === "text_start") {
    content[patch.contentIndex] = { type: "text", text: "" };
  } else if (patch.type === "thinking_start") {
    content[patch.contentIndex] = { type: "thinking", thinking: "" };
  } else if (patch.type === "text_delta") {
    const block = content[patch.contentIndex];
    if (block?.type === "text") {
      content[patch.contentIndex] = { ...block, text: block.text + patch.delta };
    }
  } else if (patch.type === "thinking_delta") {
    const block = content[patch.contentIndex];
    if (block?.type === "thinking") {
      content[patch.contentIndex] = { ...block, thinking: block.thinking + patch.delta };
    }
  } else if (patch.type === "text_end") {
    content[patch.contentIndex] = { type: "text", text: patch.content };
  } else if (patch.type === "thinking_end") {
    content[patch.contentIndex] = { type: "thinking", thinking: patch.content };
  } else if (
    patch.type === "toolcall_start" ||
    patch.type === "toolcall_delta" ||
    patch.type === "toolcall_end"
  ) {
    content[patch.contentIndex] = structuredClone(patch.toolCall);
  }

  return { ...message, content };
}

function applySurfaceStreamPatchToAgent(agent: SurfaceAgent, patch: SurfaceStreamPatch): void {
  if (patch.type === "clear") {
    setSurfaceAgentStreamState(agent, { isStreaming: false, streamMessage: null });
    return;
  }

  if (patch.type === "start") {
    setSurfaceAgentStreamState(agent, {
      isStreaming: true,
      streamMessage: structuredClone(patch.message),
    });
    return;
  }

  const message = agent.state.streamMessage;
  if (!message || message.role !== "assistant") {
    return;
  }

  setSurfaceAgentStreamState(agent, {
    isStreaming: true,
    streamMessage: applyStreamPatchToMessage(message, patch),
  });
}

function createInitialAgent(
  snapshot: ConversationSurfaceSnapshot,
  streamFn: StreamFn,
): SurfaceAgent {
  const agent = installSurfaceAgentMutators(
    new Agent({
      initialState: {
        systemPrompt: snapshot.systemPrompt,
        model: getModel(
          snapshot.provider as Parameters<typeof getModel>[0],
          snapshot.model as Parameters<typeof getModel>[1],
        ),
        thinkingLevel: snapshot.reasoningEffort,
        messages: buildDisplayMessages(snapshot),
        tools: [],
      },
      convertToLlm,
      streamFn,
    }),
  );
  agent.sessionId = snapshot.target.surfacePiSessionId;
  setSurfaceAgentStreamState(agent, {
    isStreaming: snapshot.promptStatus === "streaming",
    streamMessage: snapshot.streamMessage ? structuredClone(snapshot.streamMessage) : null,
  });
  return agent;
}

function buildDisplayMessages(snapshot: ConversationSurfaceSnapshot): AgentMessage[] {
  const messages = structuredClone(snapshot.messages);
  if (!snapshot.pendingUserMessage) {
    return messages;
  }
  return [...messages, structuredClone(snapshot.pendingUserMessage)];
}

class SurfaceControllerImpl implements ChatSurfaceControllerInternal {
  agent: SurfaceAgent;
  target: PromptTarget;
  resolvedSystemPrompt: string;
  promptBinding?: ConversationSurfaceSnapshot["promptBinding"];
  externalContextSources: GeneratedAgentContextExternalSource[];
  loadedExtensionIds: string[] = [];
  availableExtensionIds: string[] = [];
  agentProfileId: AgentProfileId;
  promptStatus: PromptStatus;
  activeTurnId: string | null;
  activeTurnStartedAt: string | null;
  turnTimings: ConversationTurnTiming[] = [];
  queuedPrompts: QueuedPrompt[] = [];
  composerDraft: ComposerDraft = {
    text: "",
    attachments: [],
    snippetMentions: [],
    updatedAt: null,
  };

  private listeners = new Set<ChatRuntimeListener>();
  private panelIds = new Set<string>();
  private disposed = false;
  private promptDispatchInFlight = false;
  private applyingSnapshot = false;
  private suppressSurfaceMutationSync = false;
  private lastStreamSequence = 0;
  private draftSyncChain: Promise<void> = Promise.resolve();
  private draftPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private rendererOwnsDraft = false;

  constructor(
    snapshot: ConversationSurfaceSnapshot,
    private readonly rpcClient: ChatRuntimeRpcClient,
    private readonly workspaceId: string,
    private readonly storage: ChatStorage,
  ) {
    this.target = normalizePromptTarget(snapshot.target);
    this.resolvedSystemPrompt = snapshot.resolvedSystemPrompt;
    this.promptBinding = snapshot.promptBinding;
    this.externalContextSources = structuredClone(snapshot.externalContextSources ?? []);
    this.loadedExtensionIds = [...snapshot.loadedExtensionIds];
    this.availableExtensionIds = [...snapshot.availableExtensionIds];
    this.agentProfileId = snapshot.agentProfileId;
    this.promptStatus = snapshot.promptStatus;
    this.activeTurnId = snapshot.activeTurnId;
    this.activeTurnStartedAt = snapshot.activeTurnStartedAt;
    this.turnTimings = structuredClone(snapshot.turnTimings);
    this.queuedPrompts = structuredClone(snapshot.queuedMessages ?? []);
    this.composerDraft = structuredClone(snapshot.composerDraft);
    this.lastStreamSequence = snapshot.streamMessage ? snapshot.streamSequence : 0;
    this.agent = createInitialAgent(snapshot, this.createStreamFn());

    const originalSetModel = this.agent.setModel.bind(this.agent);
    this.agent.setModel = (nextModel) => {
      originalSetModel(nextModel);
      if (!this.suppressSurfaceMutationSync) {
        void this.syncSurfaceModel(nextModel.provider, nextModel.id);
      }
    };

    const originalSetThinkingLevel = this.agent.setThinkingLevel.bind(this.agent);
    this.agent.setThinkingLevel = (level) => {
      originalSetThinkingLevel(level);
      if (!this.suppressSurfaceMutationSync) {
        void this.syncSurfaceThoughtLevel(level);
      }
    };

    this.agent.subscribe(() => {
      if (this.disposed || this.applyingSnapshot) {
        return;
      }

      this.emit();
    });
  }

  get ownerPaneIds(): string[] {
    return Array.from(this.panelIds);
  }

  subscribe(listener: ChatRuntimeListener): () => void {
    this.listeners.add(listener);
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  }

  attachPane(panelId: string): void {
    this.panelIds.add(panelId);
    this.emit();
  }

  detachPane(panelId: string): void {
    this.panelIds.delete(panelId);
    this.emit();
  }

  applySnapshot(snapshot: ConversationSurfaceSnapshot): void {
    if (this.disposed) {
      return;
    }
    if (
      this.promptDispatchInFlight &&
      this.promptStatus === "streaming" &&
      this.agent.state.isStreaming &&
      snapshot.promptStatus === "idle" &&
      !snapshot.pendingUserMessage &&
      snapshot.messages.length < this.agent.state.messages.length
    ) {
      return;
    }

    const currentStreamMessage =
      this.agent.state.streamMessage?.role === "assistant"
        ? structuredClone(this.agent.state.streamMessage)
        : null;
    const snapshotForAgent =
      snapshot.promptStatus === "streaming" &&
      !snapshot.streamMessage &&
      currentStreamMessage &&
      this.lastStreamSequence > snapshot.streamSequence
        ? {
            ...snapshot,
            streamMessage: currentStreamMessage,
            streamSequence: this.lastStreamSequence,
          }
        : snapshot;

    this.target = normalizePromptTarget(snapshotForAgent.target);
    this.resolvedSystemPrompt = snapshotForAgent.resolvedSystemPrompt;
    this.promptBinding = snapshotForAgent.promptBinding;
    this.externalContextSources = structuredClone(snapshotForAgent.externalContextSources ?? []);
    this.loadedExtensionIds = [...snapshotForAgent.loadedExtensionIds];
    this.availableExtensionIds = [...snapshotForAgent.availableExtensionIds];
    this.agentProfileId = snapshotForAgent.agentProfileId;
    this.promptStatus = snapshotForAgent.promptStatus;
    this.activeTurnId = snapshotForAgent.activeTurnId;
    this.activeTurnStartedAt = snapshotForAgent.activeTurnStartedAt;
    this.turnTimings = structuredClone(snapshotForAgent.turnTimings);
    this.queuedPrompts = structuredClone(snapshotForAgent.queuedMessages ?? []);
    if (!this.rendererOwnsDraft) {
      this.composerDraft = structuredClone(snapshotForAgent.composerDraft);
    }
    this.lastStreamSequence = snapshotForAgent.streamMessage ? snapshotForAgent.streamSequence : 0;

    this.suppressSurfaceMutationSync = true;
    this.applyingSnapshot = true;
    try {
      applySurfaceSnapshotToAgent(this.agent, snapshotForAgent);
    } finally {
      this.applyingSnapshot = false;
      this.suppressSurfaceMutationSync = false;
    }
    this.emit();
  }

  applyStreamPatch(patch: SurfaceStreamPatch): void {
    if (this.disposed) {
      return;
    }
    if (patch.sequence <= this.lastStreamSequence) {
      return;
    }
    if (patch.sequence !== this.lastStreamSequence + 1) {
      void this.rebaselineSurfaceAfterStreamGap();
      return;
    }

    this.lastStreamSequence = patch.sequence;
    this.promptStatus = patch.type === "clear" ? "idle" : "streaming";
    if (patch.type === "clear") {
      this.activeTurnId = null;
      this.activeTurnStartedAt = null;
    } else if (!this.activeTurnStartedAt) {
      this.activeTurnStartedAt = new Date().toISOString();
    }
    this.applyingSnapshot = true;
    try {
      applySurfaceStreamPatchToAgent(this.agent, patch);
    } finally {
      this.applyingSnapshot = false;
    }
    this.emit();
  }

  private async rebaselineSurfaceAfterStreamGap(): Promise<void> {
    try {
      const snapshot = await this.rpcClient.request.openSurface({
        workspaceId: this.workspaceId,
        target: this.target,
      });
      this.applySnapshot(snapshot);
    } catch (error) {
      console.error("Failed to rebaseline surface after stream patch gap:", error);
    }
  }

  async abort(): Promise<void> {
    this.promptDispatchInFlight = false;
    try {
      await this.rpcClient.request.cancelPrompt({
        workspaceId: this.workspaceId,
        target: this.target,
      });
    } catch (error) {
      console.error("Failed to cancel prompt:", error);
    } finally {
      this.promptDispatchInFlight = false;
      this.promptStatus = "idle";
      this.activeTurnId = null;
      this.activeTurnStartedAt = null;
      this.agent.abort();
      this.emit();
    }
  }

  async sendPrompt(input: ComposerPromptSubmission): Promise<void> {
    const submission = {
      text: input.text.trim(),
      attachments: input.attachments,
      snippetMentions: structuredClone(input.snippetMentions ?? []),
      snippetProvenance: structuredClone(input.snippetProvenance ?? []),
    };
    if (!submission.text && submission.attachments.length === 0) {
      return;
    }

    await this.persistPromptHistoryEntry(submission.text);

    if (this.promptDispatchInFlight || this.promptStatus === "streaming") {
      await this.updateComposerDraft({ text: "", attachments: [], snippetMentions: [] });
      await this.enqueuePrompt(submission);
      return;
    }

    await this.updateComposerDraft({ text: "", attachments: [], snippetMentions: [] });
    await this.dispatchPrompt(submission);
  }

  private async persistPromptHistoryEntry(text: string): Promise<void> {
    if (!text) return;
    try {
      await this.storage.promptHistory.append({
        text,
        sentAt: Date.now(),
        workspaceId: this.workspaceId,
        sessionId: this.target.workspaceSessionId,
      });
    } catch (error) {
      console.error("Failed to persist prompt history:", error);
    }
  }

  async updateComposerDraft(
    draft: Pick<ComposerDraft, "text" | "attachments" | "snippetMentions">,
  ): Promise<void> {
    const nextDraft = {
      text: draft.text,
      attachments: structuredClone(draft.attachments),
      snippetMentions: structuredClone(draft.snippetMentions ?? []),
      updatedAt: new Date().toISOString(),
    };
    this.composerDraft = nextDraft;
    this.rendererOwnsDraft = true;
    this.emit();

    this.scheduleDraftPersistence(nextDraft);
  }

  private scheduleDraftPersistence(draft: ComposerDraft): void {
    if (this.draftPersistTimer) {
      clearTimeout(this.draftPersistTimer);
    }
    const draftToPersist = structuredClone(draft);
    this.draftPersistTimer = setTimeout(() => {
      this.draftPersistTimer = null;
      this.persistComposerDraft(draftToPersist);
    }, 120);
  }

  private persistComposerDraft(draft: ComposerDraft): void {
    this.draftSyncChain = this.draftSyncChain
      .catch(() => undefined)
      .then(async () => {
        const response = await this.rpcClient.request.updateComposerDraft({
          workspaceId: this.workspaceId,
          target: this.target,
          draft: {
            text: draft.text,
            attachments: draft.attachments,
            snippetMentions: draft.snippetMentions ?? [],
          },
        });
        this.target = normalizePromptTarget(response.target);
        this.agent.sessionId = response.target.surfacePiSessionId;
      });

    void this.draftSyncChain.catch((error) => {
      console.error("Failed to sync composer draft:", error);
    });
  }

  async editCommittedUserMessage(
    messageTimestamp: string | number,
    input: ComposerPromptSubmission,
  ): Promise<void> {
    const submission = {
      text: input.text.trim(),
      attachments: input.attachments,
      snippetProvenance: structuredClone(input.snippetProvenance ?? []),
    };
    if (!submission.text && submission.attachments.length === 0) {
      return;
    }
    if (this.promptDispatchInFlight || this.promptStatus === "streaming") {
      throw new Error("Wait for the current turn to finish before editing an earlier message.");
    }

    const userMessage = buildUserMessage(submission);
    const request: EditCommittedUserMessageRequest = {
      target: this.target,
      messageTimestamp,
      message: userMessage,
    };

    this.promptDispatchInFlight = true;
    this.promptStatus = "streaming";
    this.activeTurnId = null;
    this.activeTurnStartedAt = new Date().toISOString();
    this.lastStreamSequence = 0;
    setSurfaceAgentStreamState(this.agent, { isStreaming: true, streamMessage: null });
    this.emit();

    try {
      const response = await this.rpcClient.request.editCommittedUserMessage({
        ...request,
        workspaceId: this.workspaceId,
      });
      this.target = normalizePromptTarget(response.target);
      this.agent.sessionId = response.target.surfacePiSessionId;
      if (response.snapshot) {
        this.applySnapshot(response.snapshot);
      }
    } catch (error) {
      this.promptStatus = "idle";
      this.activeTurnId = null;
      this.activeTurnStartedAt = null;
      setSurfaceAgentStreamState(this.agent, {
        isStreaming: false,
        streamMessage: null,
        error: error instanceof Error ? error.message : "Message edit failed.",
      });
      throw error;
    } finally {
      this.promptDispatchInFlight = false;
      this.emit();
    }
  }

  async editQueuedPrompt(promptId: string): Promise<string | null> {
    const response = await this.rpcClient.request.editQueuedSurfaceMessage({
      workspaceId: this.workspaceId,
      target: this.target,
      queuedMessageId: promptId,
    });
    if (response.snapshot) {
      this.applySnapshot(response.snapshot);
    }
    return response.text ?? null;
  }

  async deleteQueuedPrompt(promptId: string): Promise<boolean> {
    const response = await this.rpcClient.request.deleteQueuedSurfaceMessage({
      workspaceId: this.workspaceId,
      target: this.target,
      queuedMessageId: promptId,
    });
    if (response.snapshot) {
      this.applySnapshot(response.snapshot);
    }
    return response.ok;
  }

  async reorderQueuedPrompt(promptId: string, beforePromptId: string | null): Promise<boolean> {
    const response = await this.rpcClient.request.reorderQueuedSurfaceMessage({
      workspaceId: this.workspaceId,
      target: this.target,
      queuedMessageId: promptId,
      beforeQueuedMessageId: beforePromptId,
    });
    if (response.snapshot) {
      this.applySnapshot(response.snapshot);
    }
    return response.ok;
  }

  async steerQueuedPrompt(promptId: string): Promise<boolean> {
    const response = await this.rpcClient.request.steerQueuedSurfaceMessage({
      workspaceId: this.workspaceId,
      target: this.target,
      queuedMessageId: promptId,
    });
    if (response.snapshot) {
      this.applySnapshot(response.snapshot);
    }
    return response.ok;
  }

  async setExtensionContextAutoUpdate(enabled: boolean): Promise<boolean> {
    const response = await this.rpcClient.request.setExtensionContextAutoUpdate({
      workspaceId: this.workspaceId,
      target: this.target,
      enabled,
    });
    if (response.snapshot) {
      this.applySnapshot(response.snapshot);
    }
    return response.ok;
  }

  private async enqueuePrompt(input: ComposerPromptSubmission): Promise<void> {
    const userMessage = buildUserMessage(input);
    const provider = this.agent.state.model?.provider ?? DEFAULT_AGENT_SETTINGS.provider;
    const model = this.agent.state.model?.id ?? DEFAULT_AGENT_SETTINGS.model;
    const reasoningEffort =
      (this.agent.state.thinkingLevel as ReasoningEffort | undefined) ??
      DEFAULT_AGENT_SETTINGS.reasoningEffort;
    const response = await this.rpcClient.request.sendPrompt({
      messages: [...(this.agent.state.messages as Message[]), userMessage],
      provider,
      model,
      reasoningEffort,
      target: this.target,
      systemPrompt: this.agent.state.systemPrompt,
      queueOnly: true,
      workspaceId: this.workspaceId,
    });
    this.target = normalizePromptTarget(response.target);
    this.agent.sessionId = response.target.surfacePiSessionId;
    if (response.snapshot) {
      this.applySnapshot(response.snapshot);
    }
  }

  private async dispatchPrompt(input: ComposerPromptSubmission): Promise<void> {
    const userMessage = buildUserMessage(input);
    const provider = this.agent.state.model?.provider ?? DEFAULT_AGENT_SETTINGS.provider;
    const model = this.agent.state.model?.id ?? DEFAULT_AGENT_SETTINGS.model;
    const reasoningEffort =
      (this.agent.state.thinkingLevel as ReasoningEffort | undefined) ??
      DEFAULT_AGENT_SETTINGS.reasoningEffort;
    const request: SendPromptRequest = {
      messages: [...(this.agent.state.messages as Message[]), userMessage],
      provider,
      model,
      reasoningEffort,
      target: this.target,
      systemPrompt: this.agent.state.systemPrompt,
    };

    this.promptDispatchInFlight = true;
    this.promptStatus = "streaming";
    this.activeTurnId = null;
    this.activeTurnStartedAt = new Date().toISOString();
    this.lastStreamSequence = 0;
    setSurfaceAgentStreamState(this.agent, { isStreaming: true, streamMessage: null });
    this.agent.replaceMessages(
      buildDisplayMessages({ ...this.snapshotFromState(), pendingUserMessage: userMessage }),
    );
    this.emit();

    try {
      const response = await this.rpcClient.request.sendPrompt({
        ...request,
        workspaceId: this.workspaceId,
      });
      this.target = normalizePromptTarget(response.target);
      this.agent.sessionId = response.target.surfacePiSessionId;
      if (response.snapshot) {
        this.applySnapshot(response.snapshot);
      }
    } catch (error) {
      const failure = createFailureMessage(error, provider, model, "error");
      this.promptStatus = "idle";
      this.activeTurnId = null;
      this.activeTurnStartedAt = null;
      setSurfaceAgentStreamState(this.agent, {
        isStreaming: false,
        streamMessage: null,
        error: failure.errorMessage,
      });
      throw error;
    } finally {
      this.promptDispatchInFlight = false;
      this.emit();
    }
  }

  dispose(): void {
    if (this.draftPersistTimer) {
      clearTimeout(this.draftPersistTimer);
      this.draftPersistTimer = null;
      this.persistComposerDraft(this.composerDraft);
    }
    this.disposed = true;
    this.listeners.clear();
  }

  private emit(): void {
    if (this.disposed) {
      return;
    }

    for (const listener of this.listeners) {
      listener();
    }
  }

  private createStreamFn(): StreamFn {
    return async (model) => {
      const stream = createAssistantMessageEventStream();
      Promise.resolve().then(() => {
        const failure = createFailureMessage(
          new Error("Surface prompts are dispatched through the surface controller."),
          model.provider,
          model.id,
          "error",
        );
        this.promptDispatchInFlight = false;
        this.promptStatus = "idle";
        this.activeTurnId = null;
        this.activeTurnStartedAt = null;
        stream.push({
          type: "error",
          reason: "error",
          error: failure,
        });
        this.emit();
      });
      return stream;
    };
  }

  private snapshotFromState(): ConversationSurfaceSnapshot {
    return {
      target: this.target,
      messages: structuredClone(this.agent.state.messages),
      pendingUserMessage: null,
      queuedMessages: structuredClone(this.queuedPrompts),
      composerDraft: structuredClone(this.composerDraft),
      streamMessage:
        this.agent.state.streamMessage?.role === "assistant"
          ? structuredClone(this.agent.state.streamMessage)
          : null,
      streamSequence: this.lastStreamSequence,
      provider: this.agent.state.model?.provider ?? DEFAULT_AGENT_SETTINGS.provider,
      model: this.agent.state.model?.id ?? DEFAULT_AGENT_SETTINGS.model,
      reasoningEffort:
        (this.agent.state.thinkingLevel as ReasoningEffort | undefined) ??
        DEFAULT_AGENT_SETTINGS.reasoningEffort,
      agentProfileId: this.agentProfileId,
      loadedExtensionIds: [...this.loadedExtensionIds],
      availableExtensionIds: [...this.availableExtensionIds],
      systemPrompt: this.agent.state.systemPrompt,
      resolvedSystemPrompt: this.resolvedSystemPrompt,
      externalContextSources: structuredClone(this.externalContextSources),
      promptBinding: this.promptBinding,
      promptStatus: this.promptStatus,
      activeTurnId: this.activeTurnId,
      activeTurnStartedAt: this.activeTurnStartedAt,
      turnTimings: structuredClone(this.turnTimings),
    };
  }

  private async syncSurfaceModel(providerId: string, modelId: string): Promise<void> {
    try {
      const response = await this.rpcClient.request.setSurfaceModel({
        workspaceId: this.workspaceId,
        target: this.target,
        provider: providerId,
        model: modelId,
      });
      if (response.ok) {
        this.target = normalizePromptTarget(response.target);
        this.agent.sessionId = response.target.surfacePiSessionId;
        this.emit();
      }
    } catch (error) {
      console.error("Failed to sync session model:", error);
    }
  }

  private async syncSurfaceThoughtLevel(level: ReasoningEffort): Promise<void> {
    try {
      const response = await this.rpcClient.request.setSurfaceThoughtLevel({
        workspaceId: this.workspaceId,
        target: this.target,
        level,
      });
      if (response.ok) {
        this.target = normalizePromptTarget(response.target);
        this.agent.sessionId = response.target.surfacePiSessionId;
        this.emit();
      }
    } catch (error) {
      console.error("Failed to sync session thought level:", error);
    }
  }

  async setExtensionUsage(extensionId: string, state: ExtensionUsageState): Promise<void> {
    await this.syncSurfaceExtensionUsage(extensionId, state);
  }

  private async syncSurfaceExtensionUsage(
    extensionId: string,
    state: ExtensionUsageState,
  ): Promise<void> {
    try {
      const response = await this.rpcClient.request.setSurfaceExtensionUsage({
        workspaceId: this.workspaceId,
        target: this.target,
        extensionId,
        state,
      });
      if (response.ok) {
        this.target = normalizePromptTarget(response.target);
        this.agent.sessionId = response.target.surfacePiSessionId;
        if (response.snapshot) {
          this.applySnapshot(response.snapshot);
        } else {
          this.emit();
        }
      }
    } catch (error) {
      console.error("Failed to sync session extension usage:", error);
    }
  }
}

export async function createChatRuntime(
  options: ChatRuntimeOptions = {},
  rpcClient: ChatRuntimeRpcClient = DEFAULT_RPC_CLIENT,
  storageOverride?: ChatStorage,
): Promise<ChatRuntime> {
  const workspaceInfo =
    options.workspaceInfo ??
    (options.workspaceId
      ? await rpcClient.request.getWorkspaceInfo({ workspaceId: options.workspaceId })
      : null);
  if (!workspaceInfo) {
    throw new Error("createChatRuntime requires workspaceInfo or workspaceId.");
  }
  const storage = storageOverride ?? initializeStorage();
  const listeners = new Set<ChatRuntimeListener>();
  const appLogUpdateListeners = new Set<(payload: AppLogUpdateMessage) => void>();
  const extensionCliRequirementActionUpdateListeners = new Set<
    (payload: ExtensionCliRequirementActionUpdateMessage) => void
  >();
  const surfaceControllers = new Map<string, ChatSurfaceControllerInternal>();
  let sessions: WorkspaceSessionSummary[] = [];
  let sessionNavigation: WorkspaceSessionNavigationReadModel = buildWorkspaceSessionNavigation([]);
  let requestUserInputRequests: WorkspaceRequestUserInputRequest[] = [];
  let runtimeApprovalRequests: WorkspaceRuntimeApprovalRequest[] = [];
  let appLogSummary: AppLogSummary = {
    latestSeq: 0,
    seenSeq: 0,
    unread: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
    totals: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
  };
  let paneLayout = createEmptyPaneLayout();
  const durableLayoutEnabled = workspaceInfo.kind !== "default";
  const workspaceTabLayoutId =
    "activeLayoutId" in workspaceInfo && isWorkspaceLayoutSlotId(workspaceInfo.activeLayoutId)
      ? workspaceInfo.activeLayoutId
      : undefined;
  const initialLayoutId: WorkspaceLayoutSlotId =
    options.initialLayoutId ?? workspaceTabLayoutId ?? "A";
  let activeLayoutId: WorkspaceLayoutSlotId = initialLayoutId;
  let savedLayouts: Record<WorkspaceLayoutSlotId, WorkspaceDockviewLayoutState | null> = {
    A: null,
    B: null,
    C: null,
  };
  let workspaceBranch = workspaceInfo.branch;
  let disposed = false;

  const emit = () => {
    if (disposed) {
      return;
    }

    for (const listener of listeners) {
      listener();
    }
  };
  const runtimeCacheEmitter = { workspaceId: workspaceInfo.workspaceId, emit };
  activeRuntimeEmitters.add(runtimeCacheEmitter);

  const scoped = <T extends object>(request?: T): T & { workspaceId: string } => ({
    ...(request ?? ({} as T)),
    workspaceId: workspaceInfo.workspaceId,
  });

  const setAppCache = <Key extends keyof AppReadModelCache>(
    key: Key,
    value: AppReadModelCache[Key],
  ): AppReadModelCache[Key] => {
    appReadModelCache[key] = structuredClone(value) as AppReadModelCache[Key];
    notifyReadModelCachesChanged();
    return structuredClone(value) as AppReadModelCache[Key];
  };

  const setWorkspaceCache = <Key extends keyof WorkspaceReadModelCache>(
    key: Key,
    value: WorkspaceReadModelCache[Key],
  ): WorkspaceReadModelCache[Key] => {
    const cache = workspaceReadModelCache(workspaceInfo.workspaceId);
    cache[key] = structuredClone(value) as WorkspaceReadModelCache[Key];
    notifyReadModelCachesChanged(workspaceInfo.workspaceId);
    return structuredClone(value) as WorkspaceReadModelCache[Key];
  };

  const refreshAgentSettings = async (): Promise<AgentSettingsState> =>
    setAppCache("agentSettings", await rpcClient.request.getAgentSettings(scoped()))!;

  const refreshAppPreferences = async (): Promise<AppPreferences> =>
    setAppCache("appPreferences", await rpcClient.request.getAppPreferences())!;

  const refreshAgentModelChoices = async (): Promise<AgentModelChoicesResponse> =>
    setAppCache("agentModelChoices", await rpcClient.request.getAgentModelChoices(scoped()))!;

  const refreshProviderAuths = async (): Promise<ProviderAuthInfo[]> =>
    setAppCache("providerAuths", await rpcClient.request.listProviderAuths())!;

  const refreshExtensionsInventory = async (): Promise<ExtensionsInventoryReadModel> =>
    setWorkspaceCache(
      "extensionsInventory",
      await rpcClient.request.getExtensionsInventory(scoped()),
    )!;

  const refreshExternalInstructionSources = async (): Promise<
    GeneratedAgentContextExternalSource[]
  > =>
    setWorkspaceCache(
      "externalInstructionSources",
      await rpcClient.request.getGeneratedAgentContextExternalSources(scoped()),
    )!;

  const refreshWorkflowsGenerated = async (): Promise<WorkspaceWorkflowsGeneratedReadModel> =>
    setAppCache("workflowsGenerated", await rpcClient.request.getWorkflowsGenerated(scoped()))!;

  const refreshSnippets = async (): Promise<SnippetsReadModel> =>
    setWorkspaceCache("snippets", await rpcClient.request.getSnippets(scoped()))!;

  const refreshAppLogs = async (query?: AppLogQuery): Promise<AppLogReadModel> => {
    const next = await rpcClient.request.getAppLogs(scoped(query ?? {}));
    const isDefaultQuery =
      !query?.afterSeq &&
      !query?.beforeSeq &&
      !query?.levels?.length &&
      !query?.sources?.length &&
      !query?.query;
    if (isDefaultQuery) {
      return setWorkspaceCache("appLogs", next)!;
    }
    return next;
  };

  const refreshWarmReadModels = (): void => {
    void refreshAgentSettings().catch(() => undefined);
    void refreshAppPreferences().catch(() => undefined);
    void refreshAgentModelChoices().catch(() => undefined);
    void refreshProviderAuths().catch(() => undefined);
    void refreshExtensionsInventory().catch(() => undefined);
    void refreshExternalInstructionSources().catch(() => undefined);
    void refreshWorkflowsGenerated().catch(() => undefined);
    void refreshSnippets().catch(() => undefined);
    void refreshAppLogs({ limit: 600 }).catch(() => undefined);
  };

  const currentLayoutSlots = (): WorkspaceLayoutSlotSummary[] =>
    WORKSPACE_LAYOUT_SLOT_IDS.map((id) => {
      const layout = id === activeLayoutId ? paneLayout : savedLayouts[id];
      return {
        id,
        initialized: !!layout && isInitializedPaneLayout(layout),
        active: id === activeLayoutId,
        updatedAt: layout?.updatedAt ?? null,
      };
    });

  const captureActiveLayout = (): void => {
    savedLayouts = {
      ...savedLayouts,
      [activeLayoutId]: structuredClone(paneLayout),
    };
  };

  const persistWorkspaceUiRestore = (): void => {
    if (disposed || !durableLayoutEnabled) {
      return;
    }

    captureActiveLayout();
    const state: WorkspaceUiRestoreState = {
      version: 5,
      layouts: structuredClone(savedLayouts),
    };

    void rpcClient.request
      .setWorkspaceUiRestore(scoped({ state }))
      .catch((error: unknown) =>
        console.error("Failed to persist workspace UI restore state:", error),
      );
    options.onWorkspaceLayoutPersist?.(structuredClone(state));
  };

  const syncPaneTargetForSurface = (target: PromptTarget): void => {
    const normalizedTarget = normalizePromptTarget(target);
    paneLayout = {
      ...paneLayout,
      panels: paneLayout.panels.map((pane) =>
        isPromptTarget(pane.binding) &&
        pane.binding.surfacePiSessionId === normalizedTarget.surfacePiSessionId
          ? { ...pane, binding: normalizedTarget }
          : pane,
      ),
      updatedAt: new Date().toISOString(),
    };
  };

  const upsertSurfaceController = (
    snapshot: ConversationSurfaceSnapshot,
  ): ChatSurfaceControllerInternal => {
    const surfacePiSessionId = snapshot.target.surfacePiSessionId;
    const existing = surfaceControllers.get(surfacePiSessionId);
    if (existing) {
      existing.applySnapshot(snapshot);
      syncPaneTargetForSurface(snapshot.target);
      return existing;
    }

    const controller = new SurfaceControllerImpl(
      snapshot,
      rpcClient,
      workspaceInfo.workspaceId,
      storage,
    );
    surfaceControllers.set(surfacePiSessionId, controller);
    return controller;
  };

  const removePaneForSurface = (panelId: string): void => {
    const target = paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
    if (!target) {
      return;
    }

    paneLayout = closePane(paneLayout, panelId);
    if (isPromptTarget(target)) {
      surfaceControllers.get(target.surfacePiSessionId)?.detachPane(panelId);
    }
    persistWorkspaceUiRestore();
  };

  const releasePaneSurface = async (
    panelId: string,
    target: WorkspacePaneSurfaceTarget | null,
  ): Promise<void> => {
    if (!isPromptTarget(target)) {
      return;
    }

    const controller = surfaceControllers.get(target.surfacePiSessionId);
    controller?.detachPane(panelId);
    if (controller && controller.ownerPaneIds.length > 0) {
      return;
    }
    try {
      await rpcClient.request.closeSurface(scoped({ target }));
    } catch (error) {
      console.error("Failed to close surface:", error);
    }
  };

  const bindPaneToSnapshot = async (
    panelId: string,
    snapshot: ConversationSurfaceSnapshot,
    bindOptions: { focus?: boolean; persist?: boolean } = {},
  ): Promise<void> => {
    const focus = bindOptions.focus ?? true;
    const persist = bindOptions.persist ?? true;
    const previousFocusedPaneId = paneLayout.focusedPanelId;
    const previousTarget =
      paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
    const nextTarget = normalizePromptTarget(snapshot.target);
    if (
      isPromptTarget(previousTarget) &&
      previousTarget.surfacePiSessionId === nextTarget.surfacePiSessionId
    ) {
      paneLayout = bindPane(paneLayout, panelId, nextTarget);
      if (!focus) {
        paneLayout = { ...paneLayout, focusedPanelId: previousFocusedPaneId };
      }
      upsertSurfaceController({ ...snapshot, target: nextTarget }).attachPane(panelId);
      emit();
      recordFocusedSession();
      if (persist) {
        persistWorkspaceUiRestore();
      }
      return;
    }

    const controller = upsertSurfaceController({ ...snapshot, target: nextTarget });
    paneLayout = bindPane(paneLayout, panelId, nextTarget);
    if (!focus) {
      paneLayout = { ...paneLayout, focusedPanelId: previousFocusedPaneId };
    }
    controller.attachPane(panelId);
    emit();
    recordFocusedSession();

    if (isPromptTarget(previousTarget)) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(panelId);
    }
    if (persist) {
      persistWorkspaceUiRestore();
    }
  };

  const bindPaneToExistingController = (
    panelId: string,
    controller: ChatSurfaceControllerInternal,
    bindOptions: { focus?: boolean; persist?: boolean } = {},
  ): void => {
    const focus = bindOptions.focus ?? true;
    const persist = bindOptions.persist ?? true;
    const previousFocusedPaneId = paneLayout.focusedPanelId;
    const previousTarget =
      paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
    const nextTarget = normalizePromptTarget(controller.target);
    paneLayout = bindPane(paneLayout, panelId, nextTarget);
    if (!focus) {
      paneLayout = { ...paneLayout, focusedPanelId: previousFocusedPaneId };
    }
    controller.attachPane(panelId);
    emit();
    recordFocusedSession();

    if (
      isPromptTarget(previousTarget) &&
      previousTarget.surfacePiSessionId !== nextTarget.surfacePiSessionId
    ) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(panelId);
    }
    if (persist) {
      persistWorkspaceUiRestore();
    }
  };

  const refreshSessions = async (): Promise<WorkspaceSessionSummary[]> => {
    const response = await rpcClient.request.listSessions(scoped());
    sessions = response.sessions;
    sessionNavigation = response.navigation;
    requestUserInputRequests = response.requestUserInputRequests;
    runtimeApprovalRequests = response.runtimeApprovalRequests;
    emit();
    return sessions;
  };

  let lastRecordedFocusedSessionId: string | null | undefined = undefined;
  let lastRecordedFocusedSurfacePiSessionId: string | null | undefined = undefined;
  const recordFocusedSession = (): void => {
    const focusedTarget =
      paneLayout.panels.find((pane) => pane.panelId === paneLayout.focusedPanelId)?.binding ?? null;
    const focusedSessionId = isPromptTarget(focusedTarget)
      ? focusedTarget.workspaceSessionId
      : null;
    const focusedSurfacePiSessionId = isPromptTarget(focusedTarget)
      ? focusedTarget.surfacePiSessionId
      : null;
    if (
      focusedSessionId === lastRecordedFocusedSessionId &&
      focusedSurfacePiSessionId === lastRecordedFocusedSurfacePiSessionId
    ) {
      return;
    }

    lastRecordedFocusedSessionId = focusedSessionId;
    lastRecordedFocusedSurfacePiSessionId = focusedSurfacePiSessionId;
    void rpcClient.request
      .recordFocusedSession({
        workspaceId: workspaceInfo.workspaceId,
        sessionId: focusedSessionId,
        surfacePiSessionId: focusedSurfacePiSessionId,
      })
      .catch((error) => {
        console.error("Failed to record focused session:", error);
      });
  };

  const getSelectedSessionId = (sessionId?: string): string | undefined => {
    if (sessionId) {
      return sessionId;
    }

    const focusedTarget =
      paneLayout.panels.find((pane) => pane.panelId === paneLayout.focusedPanelId)?.binding ?? null;
    return focusedTarget && "workspaceSessionId" in focusedTarget
      ? focusedTarget.workspaceSessionId
      : undefined;
  };

  const getFocusedPromptTarget = (): PromptTarget | null => {
    const focusedTarget =
      paneLayout.panels.find((pane) => pane.panelId === paneLayout.focusedPanelId)?.binding ?? null;
    return isPromptTarget(focusedTarget) ? normalizePromptTarget(focusedTarget) : null;
  };

  const syncProviderAuth = async (providerId: string): Promise<boolean> => {
    const auth = await rpcClient.request.getProviderAuthState({ providerId });
    if (auth.connected) {
      await storage.providerKeys.set(providerId, auth.accountId || "oauth");
      return true;
    }

    await storage.providerKeys.delete(providerId).catch((error) => {
      console.warn(`Failed to clear cached provider auth for ${providerId}:`, error);
    });
    return false;
  };

  const requireProviderAccess = async (providerId: string): Promise<boolean> => {
    const hasAccess = await syncProviderAuth(providerId);
    if (!hasAccess) {
      options.onMissingProviderAccess?.(providerId);
    }
    return hasAccess;
  };

  const getCommandInspector = async (
    commandId: string,
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceCommandInspector> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before inspecting a command.");
    }

    const inspector = await rpcClient.request.getCommandInspector(
      scoped({
        sessionId,
        commandId,
      }),
    );
    if (!inspector) {
      throw new Error(`Structured command not found: ${commandId}`);
    }

    return inspector;
  };

  const listHandlerThreads = async (
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceHandlerThreadSummary[]> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before listing handler threads.");
    }

    return await rpcClient.request.listHandlerThreads(scoped({ sessionId }));
  };

  const getHandlerThreadInspector = async (
    threadId: string,
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceHandlerThreadInspector> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before inspecting a handler thread.");
    }

    const inspector = await rpcClient.request.getHandlerThreadInspector(
      scoped({
        sessionId,
        threadId,
      }),
    );
    if (!inspector) {
      throw new Error(`Delegated handler thread not found: ${threadId}`);
    }

    return inspector;
  };

  const getWorkflowTaskAttemptInspector = async (
    workflowTaskAttemptId: string,
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceWorkflowTaskAttemptInspector> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before inspecting a workflow task attempt.");
    }

    const inspector = await rpcClient.request.getWorkflowTaskAttemptInspector(
      scoped({
        sessionId,
        workflowTaskAttemptId,
      }),
    );
    if (!inspector) {
      throw new Error(`Workflow task attempt not found: ${workflowTaskAttemptId}`);
    }

    return inspector;
  };

  const getArtifactPreview = async (
    artifactId: string,
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceArtifactPreview> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before opening an artifact.");
    }

    return await rpcClient.request.getArtifactPreview(scoped({ sessionId, artifactId }));
  };

  const getFallbackPanelId = (): string | null =>
    paneLayout.focusedPanelId &&
    paneLayout.panels.some((pane) => pane.panelId === paneLayout.focusedPanelId)
      ? paneLayout.focusedPanelId
      : (paneLayout.panels[0]?.panelId ?? null);

  const addBoundPanel = (
    binding: WorkspacePaneSurfaceTarget,
    panelId = paneLayout.panels.length === 0 ? PRIMARY_CHAT_PANE_ID : createPanelId(),
    placement: DockviewPanelPlacementState | null = null,
  ): string => {
    paneLayout = addDockviewPanel(paneLayout, binding, panelId, placement);
    persistWorkspaceUiRestore();
    emit();
    return panelId;
  };

  const resolveOpenTarget = (
    binding: WorkspacePaneSurfaceTarget,
    openTarget?: PaneOpenTarget | string,
  ): string => {
    if (workspaceInfo.kind === "default" && isPromptTarget(binding)) {
      const openWorkspacePaneId =
        paneLayout.panels.find(
          (pane) =>
            pane.panelId === paneLayout.focusedPanelId &&
            pane.binding?.surface === "open-workspace",
        )?.panelId ??
        (paneLayout.panels.length === 1 &&
        paneLayout.panels[0]?.binding?.surface === "open-workspace"
          ? paneLayout.panels[0].panelId
          : null);
      if (openWorkspacePaneId && typeof openTarget !== "string" && openTarget?.kind !== "panel") {
        return openWorkspacePaneId;
      }
    }
    if (typeof openTarget === "string") {
      if (!paneLayout.panels.some((pane) => pane.panelId === openTarget)) {
        return addBoundPanel(binding, openTarget);
      }
      return openTarget;
    }
    if (!openTarget || openTarget.kind === "focused-panel") {
      return getFallbackPanelId() ?? addBoundPanel(binding);
    }
    if (openTarget.kind === "panel") {
      if (!paneLayout.panels.some((pane) => pane.panelId === openTarget.panelId)) {
        return addBoundPanel(binding, openTarget.panelId);
      }
      return openTarget.panelId;
    }
    if (openTarget.kind === "split") {
      const referencePanelId = paneLayout.panels.some((pane) => pane.panelId === openTarget.panelId)
        ? openTarget.panelId
        : getFallbackPanelId();
      return referencePanelId
        ? addBoundPanel(binding, createPanelId(), {
            kind: "split",
            referencePanelId,
            direction: openTarget.direction,
            size: openTarget.size,
          })
        : addBoundPanel(binding);
    }
    if (openTarget.kind === "tab") {
      return addBoundPanel(binding, createPanelId(), {
        kind: "tab",
        groupId: openTarget.groupId,
        index: openTarget.index,
      });
    }
    const basePaneId = getFallbackPanelId();
    if (!basePaneId) {
      return addBoundPanel(binding);
    }
    const before = new Set(paneLayout.panels.map((pane) => pane.panelId));
    const placement: DockviewPanelPlacementState =
      openTarget.kind === "new-panel"
        ? {
            kind: "split",
            referencePanelId: basePaneId,
            direction: openTarget.direction,
            size: openTarget.size,
          }
        : openTarget.kind === "edge"
          ? {
              kind: "edge",
              direction: openTarget.direction,
              size: openTarget.size,
            }
          : openTarget.kind === "floating"
            ? { kind: "floating", box: openTarget.box }
            : { kind: "popout", box: openTarget.box };
    const nextPanelId = addBoundPanel(binding, createPanelId(), placement);
    return paneLayout.panels.find((pane) => !before.has(pane.panelId))?.panelId ?? nextPanelId;
  };

  const [defaults, initialCatalog, initialAppLogSummary] = await Promise.all([
    rpcClient.request.getDefaults(),
    rpcClient.request.listSessions({ workspaceId: workspaceInfo.workspaceId }),
    rpcClient.request.getAppLogSummary({ workspaceId: workspaceInfo.workspaceId }),
  ]);
  sessions = initialCatalog.sessions;
  sessionNavigation = initialCatalog.navigation;
  requestUserInputRequests = initialCatalog.requestUserInputRequests;
  runtimeApprovalRequests = initialCatalog.runtimeApprovalRequests;
  appLogSummary = initialAppLogSummary;

  const syncProviderAuthPromise = syncProviderAuth(defaults.provider);
  await syncProviderAuthPromise;
  refreshWarmReadModels();

  const restoreState = durableLayoutEnabled
    ? ((await rpcClient.request.getWorkspaceUiRestore(scoped()).catch((error: unknown) => {
        console.error("Failed to load workspace UI restore state:", error);
        return null;
      })) as WorkspaceUiRestoreState | null)
    : null;
  const canUseOpenWorkspaceSurface = workspaceInfo.kind === "default";
  const normalizeRestoredLayout = (
    layout: WorkspaceDockviewLayoutState | null,
  ): WorkspaceDockviewLayoutState | null => {
    if (!layout) {
      return null;
    }
    return normalizePaneLayout(layout);
  };

  const normalizeRestoredLayouts = (
    state: AppWorkspaceUiRestoreState | null,
  ): Record<WorkspaceLayoutSlotId, WorkspaceDockviewLayoutState | null> => {
    const layouts = state?.layouts as
      | Partial<Record<WorkspaceLayoutSlotId, WorkspaceDockviewLayoutState | null>>
      | undefined;
    return {
      A: normalizeRestoredLayout(layouts?.A ?? null),
      B: normalizeRestoredLayout(layouts?.B ?? null),
      C: normalizeRestoredLayout(layouts?.C ?? null),
    };
  };

  const hydrateActiveLayout = async (
    layout: WorkspaceDockviewLayoutState | null,
  ): Promise<void> => {
    restoredPaneIds = [];
    if (!layout?.panels.length) {
      paneLayout = createEmptyPaneLayout();
      return;
    }

    const sessionIds = new Set(sessions.map((session) => session.id));
    paneLayout = layout;
    const hasOnlyRestorablePanes = paneLayout.panels.every(
      (paneState) =>
        !paneState.binding ||
        isRestorableStaticTarget(paneState.binding, {
          allowOpenWorkspace: canUseOpenWorkspaceSurface,
        }) ||
        (() => {
          const workspaceSessionId = getPaneTargetWorkspaceSessionId(paneState.binding);
          return workspaceSessionId ? sessionIds.has(workspaceSessionId) : false;
        })(),
    );
    if (!hasOnlyRestorablePanes) {
      paneLayout = createEmptyPaneLayout();
      return;
    }

    for (const paneState of paneLayout.panels) {
      if (
        !paneState.binding ||
        (!isRestorableStaticTarget(paneState.binding, {
          allowOpenWorkspace: canUseOpenWorkspaceSurface,
        }) &&
          (() => {
            const workspaceSessionId = getPaneTargetWorkspaceSessionId(paneState.binding);
            return !workspaceSessionId || !sessionIds.has(workspaceSessionId);
          })())
      ) {
        continue;
      }

      if (!isPromptTarget(paneState.binding)) {
        restoredPaneIds.push(paneState.panelId);
        continue;
      }

      const target = normalizePromptTarget(paneState.binding);
      const existingController = surfaceControllers.get(target.surfacePiSessionId);
      if (existingController) {
        bindPaneToExistingController(paneState.panelId, existingController, {
          focus: false,
          persist: false,
        });
        restoredPaneIds.push(paneState.panelId);
        continue;
      }

      try {
        const snapshot =
          target.surface === "orchestrator"
            ? await rpcClient.request.openSession(scoped({ sessionId: target.workspaceSessionId }))
            : await rpcClient.request.openSurface(scoped({ target }));
        await bindPaneToSnapshot(paneState.panelId, snapshot, { focus: false, persist: false });
        restoredPaneIds.push(paneState.panelId);
      } catch (error) {
        console.error("Failed to restore workspace pane:", error);
        paneLayout = markDockviewPanelUnavailable(
          paneLayout,
          paneState.panelId,
          formatUnavailableSurfaceReason(error),
        );
      }
    }
    if (restoredPaneIds.length === 0 && paneLayout.panels.every((paneState) => paneState.binding)) {
      paneLayout = createEmptyPaneLayout();
    }
  };

  const initializeUserWorkspaceFallbackPane = async (): Promise<void> => {
    try {
      const initialSession = sessions[0] ?? null;
      const snapshot = initialSession
        ? await rpcClient.request.openSession(scoped({ sessionId: initialSession.id }))
        : await rpcClient.request.createSession(scoped({}));
      const target = normalizePromptTarget(snapshot.target);
      paneLayout = addDockviewPanel(createEmptyPaneLayout(), target, PRIMARY_CHAT_PANE_ID);
      await bindPaneToSnapshot(PRIMARY_CHAT_PANE_ID, { ...snapshot, target });
      if (!initialSession) {
        await refreshSessions();
      }
    } catch (error) {
      console.error("Failed to initialize workspace surface:", error);
      paneLayout = createEmptyPaneLayout();
      emit();
    }
  };

  if (restoreState) {
    savedLayouts = normalizeRestoredLayouts(restoreState);
  }
  const activeRestoreSlotSaved =
    durableLayoutEnabled && !!restoreState && restoreState.layouts[activeLayoutId] !== null;
  const activeRestoreLayout = savedLayouts[activeLayoutId];
  let restoredPaneIds: string[] = [];
  if (activeRestoreLayout?.panels.length) {
    await hydrateActiveLayout(activeRestoreLayout);
  }

  if (
    activeRestoreLayout?.panels.length &&
    paneLayout.panels.some((paneState) => !paneState.binding)
  ) {
    const focusedPanelId =
      activeRestoreLayout.focusedPanelId &&
      paneLayout.panels.some((pane) => pane.panelId === activeRestoreLayout.focusedPanelId)
        ? activeRestoreLayout.focusedPanelId
        : (paneLayout.panels[0]?.panelId ?? PRIMARY_CHAT_PANE_ID);
    paneLayout = { ...paneLayout, focusedPanelId };
    persistWorkspaceUiRestore();
    emit();
  } else if (restoredPaneIds.length > 0) {
    paneLayout = {
      ...paneLayout,
      focusedPanelId:
        activeRestoreLayout?.focusedPanelId &&
        restoredPaneIds.includes(activeRestoreLayout.focusedPanelId)
          ? activeRestoreLayout.focusedPanelId
          : restoredPaneIds[0]!,
    };
    persistWorkspaceUiRestore();
    emit();
  } else if (activeRestoreSlotSaved) {
    if (!activeRestoreLayout?.panels.length) {
      paneLayout = activeRestoreLayout ?? createEmptyPaneLayout();
    }
    emit();
  } else if (workspaceInfo.kind === "default") {
    paneLayout = addDockviewPanel(
      createEmptyPaneLayout(),
      { surface: "open-workspace" },
      PRIMARY_CHAT_PANE_ID,
    );
    persistWorkspaceUiRestore();
    emit();
  } else {
    await initializeUserWorkspaceFallbackPane();
  }

  const openStaticWorkspacePane = (
    target: WorkspacePaneSurfaceTarget,
    openTarget?: PaneOpenTarget | string,
  ): void => {
    const nextPaneId = resolveOpenTarget({ ...target }, openTarget);
    const previousTarget =
      paneLayout.panels.find((pane) => pane.panelId === nextPaneId)?.binding ?? null;
    if (isPromptTarget(previousTarget)) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(nextPaneId);
    }
    paneLayout = bindPane(paneLayout, nextPaneId, { ...target });
    persistWorkspaceUiRestore();
    emit();
    recordFocusedSession();
  };

  const workspaceSyncListener = (payload: WorkspaceSyncMessage) => {
    if (payload.workspaceId !== workspaceInfo.workspaceId) {
      return;
    }
    sessions = payload.sessions;
    sessionNavigation = payload.navigation;
    requestUserInputRequests = payload.requestUserInputRequests;
    runtimeApprovalRequests = payload.runtimeApprovalRequests;
    if (payload.reason === "artifact.open" && payload.artifactOpenRequest) {
      openStaticWorkspacePane({
        workspaceSessionId: payload.artifactOpenRequest.workspaceSessionId,
        surface: "artifact",
        artifactId: payload.artifactOpenRequest.artifactId,
      });
      return;
    }
    emit();
  };

  const surfaceSyncListener = (payload: SurfaceSyncMessage) => {
    if (payload.workspaceId !== workspaceInfo.workspaceId) {
      return;
    }
    syncPaneTargetForSurface(payload.target);
    persistWorkspaceUiRestore();
    if (payload.reason === "surface.closed") {
      for (const pane of paneLayout.panels) {
        if (
          isPromptTarget(pane.binding) &&
          pane.binding.surfacePiSessionId === payload.target.surfacePiSessionId
        ) {
          removePaneForSurface(pane.panelId);
        }
      }

      const existing = surfaceControllers.get(payload.target.surfacePiSessionId);
      if (existing) {
        surfaceControllers.delete(payload.target.surfacePiSessionId);
        existing.dispose();
      }
      emit();
      return;
    }

    if (payload.reason === "stream.patch") {
      const controller = surfaceControllers.get(payload.target.surfacePiSessionId);
      if (controller && payload.streamPatch) {
        controller.applyStreamPatch(payload.streamPatch);
      }
      return;
    }

    if (!payload.snapshot) {
      return;
    }

    upsertSurfaceController(payload.snapshot);
    emit();
  };

  const appLogUpdateListener = (payload: AppLogUpdateMessage) => {
    if (payload.workspaceId !== workspaceInfo.workspaceId) {
      return;
    }
    appLogSummary = payload.summary;
    const cache = workspaceReadModelCache(workspaceInfo.workspaceId);
    if (cache.appLogs) {
      cache.appLogs = {
        ...cache.appLogs,
        entries: mergeAppLogEntries(cache.appLogs.entries, payload.entries).slice(-600),
        summary: payload.summary,
      };
    }
    if (
      payload.entries.some(
        (entry) =>
          entry.source === "workflow.library" &&
          entry.message === "Generated Workflows package rebuilt.",
      )
    ) {
      void refreshWorkflowsGenerated().catch(() => undefined);
    }
    for (const entry of payload.entries) {
      if (entry.source !== "source.graph" || entry.message !== "Source inputs changed.") {
        continue;
      }
      const domains = Array.isArray(entry.details?.domains)
        ? entry.details.domains.filter((domain): domain is string => typeof domain === "string")
        : [];
      const refreshAll = domains.length === 0;
      if (
        refreshAll ||
        domains.some((domain) => domain === "agent-settings" || domain === "workflows")
      ) {
        void refreshAgentSettings().catch(() => undefined);
      }
      if (
        refreshAll ||
        domains.some((domain) => domain === "extensions" || domain === "external-instructions")
      ) {
        void refreshExtensionsInventory().catch(() => undefined);
      }
      if (refreshAll || domains.includes("external-instructions")) {
        void refreshExternalInstructionSources().catch(() => undefined);
      }
      if (
        refreshAll ||
        domains.some((domain) => domain === "extensions" || domain === "workflows")
      ) {
        void refreshWorkflowsGenerated().catch(() => undefined);
      }
      if (refreshAll || domains.includes("snippets")) {
        void refreshSnippets().catch(() => undefined);
      }
    }
    for (const listener of appLogUpdateListeners) {
      listener(payload);
    }
    emit();
  };

  const extensionCliRequirementActionUpdateListener = (
    payload: ExtensionCliRequirementActionUpdateMessage,
  ) => {
    if (payload.workspaceId !== workspaceInfo.workspaceId) {
      return;
    }
    for (const listener of extensionCliRequirementActionUpdateListeners) {
      listener(payload);
    }
  };

  rpcClient.addMessageListener("sendWorkspaceSync", workspaceSyncListener);
  rpcClient.addMessageListener("sendSurfaceSync", surfaceSyncListener);
  rpcClient.addMessageListener("sendAppLogUpdate", appLogUpdateListener);
  rpcClient.addMessageListener(
    "sendExtensionCliRequirementActionUpdate",
    extensionCliRequirementActionUpdateListener,
  );
  recordFocusedSession();

  const runtime: ChatRuntime = {
    storage,
    workspaceId: workspaceInfo.workspaceId,
    workspaceTabId: options.workspaceTabId,
    workspaceLabel: workspaceInfo.workspaceLabel,
    cwd: workspaceInfo.cwd,
    kind: workspaceInfo.kind,
    get branch() {
      return workspaceBranch;
    },
    primaryPaneId: PRIMARY_CHAT_PANE_ID,
    get sessions() {
      return sessions;
    },
    get sessionNavigation() {
      return sessionNavigation;
    },
    get appLogSummary() {
      return structuredClone(appLogSummary);
    },
    get agentSettingsSnapshot() {
      return cloneOrNull(appReadModelCache.agentSettings);
    },
    get appPreferencesSnapshot() {
      return cloneOrNull(appReadModelCache.appPreferences);
    },
    get agentModelChoicesSnapshot() {
      return cloneOrNull(appReadModelCache.agentModelChoices);
    },
    get providerAuthsSnapshot() {
      return cloneOrNull(appReadModelCache.providerAuths);
    },
    get extensionsInventorySnapshot() {
      return cloneOrNull(workspaceReadModelCache(workspaceInfo.workspaceId).extensionsInventory);
    },
    get externalInstructionSourcesSnapshot() {
      return cloneOrNull(
        workspaceReadModelCache(workspaceInfo.workspaceId).externalInstructionSources,
      );
    },
    get workflowsGeneratedSnapshot() {
      return cloneOrNull(appReadModelCache.workflowsGenerated);
    },
    get snippetsSnapshot() {
      return cloneOrNull(workspaceReadModelCache(workspaceInfo.workspaceId).snippets);
    },
    get appLogsSnapshot() {
      return cloneOrNull(workspaceReadModelCache(workspaceInfo.workspaceId).appLogs);
    },
    get paneLayout() {
      return structuredClone(paneLayout);
    },
    get activeLayoutId() {
      return activeLayoutId;
    },
    get layoutSlots() {
      return currentLayoutSlots();
    },
    get layoutSlotsEnabled() {
      return durableLayoutEnabled;
    },
    dispose: () => {
      disposed = true;
      activeRuntimeEmitters.delete(runtimeCacheEmitter);
      rpcClient.removeMessageListener("sendWorkspaceSync", workspaceSyncListener);
      rpcClient.removeMessageListener("sendSurfaceSync", surfaceSyncListener);
      rpcClient.removeMessageListener("sendAppLogUpdate", appLogUpdateListener);
      rpcClient.removeMessageListener(
        "sendExtensionCliRequirementActionUpdate",
        extensionCliRequirementActionUpdateListener,
      );
      for (const controller of surfaceControllers.values()) {
        controller.dispose();
      }
      appLogUpdateListeners.clear();
      extensionCliRequirementActionUpdateListeners.clear();
      listeners.clear();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeAppLogUpdate: (listener) => {
      appLogUpdateListeners.add(listener);
      return () => {
        appLogUpdateListeners.delete(listener);
      };
    },
    subscribeExtensionCliRequirementActionUpdate: (listener) => {
      extensionCliRequirementActionUpdateListeners.add(listener);
      return () => {
        extensionCliRequirementActionUpdateListeners.delete(listener);
      };
    },
    subscribeAppMenuAction: (listener) => {
      const appMenuListener = ({ action }: { action: AppMenuAction }) => {
        listener(action);
      };
      rpcClient.addMessageListener("sendAppMenuAction", appMenuListener);
      return () => {
        rpcClient.removeMessageListener("sendAppMenuAction", appMenuListener);
      };
    },
    listSessions: refreshSessions,
    getPane: (panelId) => {
      const pane = paneLayout.panels.find((candidate) => candidate.panelId === panelId);
      if (!pane) {
        return undefined;
      }
      return {
        id: pane.panelId,
        target: pane.binding ? { ...pane.binding } : null,
        scroll: pane.localState.scroll,
        timelineDensity: pane.localState.timelineDensity,
        chrome: pane.chrome ? { ...pane.chrome } : null,
        restore: pane.restore ? { ...pane.restore } : null,
      };
    },
    getPaneController: (panelId) => {
      const target = paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
      if (!isPromptTarget(target)) {
        return null;
      }
      return surfaceControllers.get(target.surfacePiSessionId) ?? null;
    },
    getSurfaceController: (surfacePiSessionId) => {
      return surfaceControllers.get(surfacePiSessionId) ?? null;
    },
    focusPane: (panelId) => {
      paneLayout = focusPane(paneLayout, panelId);
      persistWorkspaceUiRestore();
      emit();
      recordFocusedSession();
    },
    splitPane: async (panelId, direction, splitOptions = {}) => {
      const before = new Set(paneLayout.panels.map((pane) => pane.panelId));
      const sourceBinding =
        paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
      paneLayout = splitPane(paneLayout, panelId, direction, splitOptions);
      const newPane = paneLayout.panels.find((pane) => !before.has(pane.panelId)) ?? null;
      if (!newPane) {
        return null;
      }
      if (splitOptions.duplicateBinding && isPromptTarget(sourceBinding)) {
        surfaceControllers.get(sourceBinding.surfacePiSessionId)?.attachPane(newPane.panelId);
      }
      persistWorkspaceUiRestore();
      emit();
      return newPane.panelId;
    },
    closePane: async (panelId) => {
      if (!paneLayout.panels.some((pane) => pane.panelId === panelId)) {
        return;
      }
      const targetPanelId = panelId;
      const target =
        paneLayout.panels.find((pane) => pane.panelId === targetPanelId)?.binding ?? null;
      paneLayout = closePane(paneLayout, targetPanelId);
      persistWorkspaceUiRestore();
      emit();
      recordFocusedSession();
      await releasePaneSurface(targetPanelId, target);
    },
    setDockviewLayout: (dockview, focusedPanelId) => {
      paneLayout = setDockviewSerializedLayout(
        paneLayout,
        dockview,
        focusedPanelId ?? paneLayout.focusedPanelId,
      );
      persistWorkspaceUiRestore();
      emit();
      recordFocusedSession();
    },
    syncWorkspaceLayoutState: async (state) => {
      if (!durableLayoutEnabled || disposed) {
        return;
      }
      savedLayouts = normalizeRestoredLayouts(state);
      await hydrateActiveLayout(savedLayouts[activeLayoutId]);
      const activeLayout = savedLayouts[activeLayoutId];
      if (activeLayout?.panels.length && restoredPaneIds.length > 0) {
        paneLayout = {
          ...paneLayout,
          focusedPanelId:
            activeLayout.focusedPanelId && restoredPaneIds.includes(activeLayout.focusedPanelId)
              ? activeLayout.focusedPanelId
              : restoredPaneIds[0]!,
        };
      }
      emit();
      recordFocusedSession();
    },
    switchWorkspaceLayout: async (layoutId) => {
      if (!durableLayoutEnabled) {
        return;
      }
      if (layoutId === activeLayoutId) {
        return;
      }
      captureActiveLayout();
      activeLayoutId = layoutId;
      await hydrateActiveLayout(
        savedLayouts[layoutId] ? normalizePaneLayout(savedLayouts[layoutId]!) : null,
      );
      savedLayouts = {
        ...savedLayouts,
        [layoutId]: structuredClone(paneLayout),
      };
      options.onActiveLayoutChange?.(layoutId);
      persistWorkspaceUiRestore();
      emit();
      recordFocusedSession();
    },
    getCommandInspector,
    listHandlerThreads,
    getHandlerThreadInspector,
    getWorkflowTaskAttemptInspector,
    getArtifactPreview,
    getRequestUserInputRequests: () => structuredClone(requestUserInputRequests),
    getRuntimeApprovalRequests: () => structuredClone(runtimeApprovalRequests),
    answerRequestUserInput: async (request) => {
      const response = await rpcClient.request.answerRequestUserInput(scoped(request));
      if (response.snapshot) {
        upsertSurfaceController(response.snapshot);
      }
      await refreshSessions();
    },
    setRequestUserInputTimerPaused: async (request) => {
      await rpcClient.request.setRequestUserInputTimerPaused(scoped(request));
      await refreshSessions();
    },
    answerRuntimeApprovalRequest: async (request) => {
      const response = await rpcClient.request.answerRuntimeApprovalRequest(scoped(request));
      if (response.snapshot) {
        upsertSurfaceController(response.snapshot);
      }
      await refreshSessions();
    },
    getAppLogs: refreshAppLogs,
    getAppLogSummary: async () => {
      appLogSummary = await rpcClient.request.getAppLogSummary(scoped());
      emit();
      return structuredClone(appLogSummary);
    },
    markAppLogsSeen: async (throughSeq) => {
      if (throughSeq <= appLogSummary.seenSeq) {
        return structuredClone(appLogSummary);
      }
      appLogSummary = await rpcClient.request.markAppLogsSeen(scoped({ throughSeq }));
      emit();
      return structuredClone(appLogSummary);
    },
    writeClipboardText: async (text) => {
      await rpcClient.request.writeClipboardText({ text });
    },
    createSession: async (request = {}, openTarget) => {
      const snapshot = await rpcClient.request.createSession(scoped(request));
      const nextPaneId = resolveOpenTarget(normalizePromptTarget(snapshot.target), openTarget);
      await bindPaneToSnapshot(nextPaneId, snapshot);
      await refreshSessions();
    },
    openSession: async (sessionId, openTarget) => {
      const existingController = surfaceControllers.get(sessionId);
      const target = existingController?.target ?? {
        workspaceSessionId: sessionId,
        surface: "orchestrator" as const,
        surfacePiSessionId: sessionId,
      };
      const nextPaneId = resolveOpenTarget(normalizePromptTarget(target), openTarget);
      const currentTarget =
        paneLayout.panels.find((pane) => pane.panelId === nextPaneId)?.binding ?? null;
      if (
        existingController &&
        existingController.ownerPaneIds.length > 0 &&
        currentTarget &&
        "workspaceSessionId" in currentTarget &&
        currentTarget?.workspaceSessionId === sessionId &&
        currentTarget.surface === "orchestrator" &&
        currentTarget.surfacePiSessionId === sessionId
      ) {
        paneLayout = focusPane(paneLayout, nextPaneId);
        persistWorkspaceUiRestore();
        emit();
        recordFocusedSession();
        return;
      }

      if (existingController) {
        if (existingController.ownerPaneIds.length === 0) {
          const snapshot = await rpcClient.request.openSession(scoped({ sessionId }));
          await bindPaneToSnapshot(nextPaneId, snapshot);
          return;
        }
        bindPaneToExistingController(nextPaneId, existingController);
        void rpcClient.request.recordSessionOpened(scoped({ sessionId }));
        return;
      }

      const snapshot = await rpcClient.request.openSession(scoped({ sessionId }));
      await bindPaneToSnapshot(nextPaneId, snapshot);
    },
    openSurface: async (target, openTarget) => {
      if (
        target.surface === "command" ||
        target.surface === "workflow-task-attempt" ||
        target.surface === "artifact" ||
        target.surface === "workflows" ||
        target.surface === "agents" ||
        target.surface === "extensions" ||
        target.surface === "snippets" ||
        target.surface === "settings" ||
        target.surface === "app-logs" ||
        target.surface === "open-workspace"
      ) {
        openStaticWorkspacePane(target, openTarget);
        return;
      }
      const normalizedTarget = normalizePromptTarget(target);
      const nextPaneId = resolveOpenTarget(normalizedTarget, openTarget);
      const currentTarget =
        paneLayout.panels.find((pane) => pane.panelId === nextPaneId)?.binding ?? null;
      const existingController = surfaceControllers.get(normalizedTarget.surfacePiSessionId);
      if (
        existingController &&
        existingController.ownerPaneIds.length > 0 &&
        isPromptTarget(currentTarget) &&
        currentTarget.surfacePiSessionId === normalizedTarget.surfacePiSessionId
      ) {
        paneLayout = bindPane(paneLayout, nextPaneId, normalizedTarget);
        existingController.attachPane(nextPaneId);
        persistWorkspaceUiRestore();
        emit();
        recordFocusedSession();
        return;
      }

      if (existingController) {
        if (existingController.ownerPaneIds.length === 0) {
          const snapshot = await rpcClient.request.openSurface(
            scoped({ target: normalizedTarget }),
          );
          await bindPaneToSnapshot(nextPaneId, snapshot);
          return;
        }
        bindPaneToExistingController(nextPaneId, existingController);
        return;
      }

      const snapshot = await rpcClient.request.openSurface(scoped({ target: normalizedTarget }));
      await bindPaneToSnapshot(nextPaneId, snapshot);
    },
    closePaneSurface: async (panelId) => {
      const target = paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
      if (!target) {
        return;
      }

      removePaneForSurface(panelId);
      emit();
      recordFocusedSession();
      await releasePaneSurface(panelId, target);
    },
    renameSession: async (sessionId, title) => {
      await rpcClient.request.renameSession(scoped({ sessionId, title }));
      await refreshSessions();
    },
    forkSession: async (sessionId, title, openTarget, forkOptions) => {
      const snapshot = await rpcClient.request.forkSession(
        scoped({
          sessionId,
          title,
          messageTimestamp: forkOptions?.messageTimestamp,
        }),
      );
      const nextPaneId = resolveOpenTarget(normalizePromptTarget(snapshot.target), openTarget);
      await bindPaneToSnapshot(nextPaneId, snapshot);
      await refreshSessions();
    },
    deleteSession: async (sessionId, panelId) => {
      const fallbackPaneId =
        panelId ??
        paneLayout.focusedPanelId ??
        paneLayout.panels[0]?.panelId ??
        PRIMARY_CHAT_PANE_ID;
      const affectedPaneIds = new Set<string>();
      for (const pane of paneLayout.panels) {
        if (
          pane.binding &&
          "workspaceSessionId" in pane.binding &&
          pane.binding.workspaceSessionId === sessionId
        ) {
          affectedPaneIds.add(pane.panelId);
        }
      }

      await rpcClient.request.deleteSession(scoped({ sessionId }));

      for (const candidatePaneId of affectedPaneIds) {
        removePaneForSurface(candidatePaneId);
      }

      for (const [surfacePiSessionId, controller] of surfaceControllers.entries()) {
        if (controller.target.workspaceSessionId === sessionId) {
          surfaceControllers.delete(surfacePiSessionId);
          controller.dispose();
        }
      }

      await refreshSessions();

      if (affectedPaneIds.has(fallbackPaneId)) {
        const nextSession =
          sessions.find((session) => !session.isArchived) ?? sessions.find((session) => session);
        if (nextSession) {
          await runtime.openSession(nextSession.id, fallbackPaneId);
          return;
        }
      }

      recordFocusedSession();
      emit();
    },
    pinSession: async (sessionId) => {
      await rpcClient.request.pinSession(scoped({ sessionId }));
      await refreshSessions();
    },
    unpinSession: async (sessionId) => {
      await rpcClient.request.unpinSession(scoped({ sessionId }));
      await refreshSessions();
    },
    archiveSession: async (sessionId) => {
      await rpcClient.request.archiveSession(scoped({ sessionId }));
      await refreshSessions();
    },
    unarchiveSession: async (sessionId) => {
      await rpcClient.request.unarchiveSession(scoped({ sessionId }));
      await refreshSessions();
    },
    markSessionUnread: async (sessionId) => {
      await rpcClient.request.markSessionUnread(scoped({ sessionId }));
      lastRecordedFocusedSessionId = undefined;
      lastRecordedFocusedSurfacePiSessionId = undefined;
      await refreshSessions();
    },
    markSessionRead: async (sessionId) => {
      await rpcClient.request.markSessionRead(scoped({ sessionId }));
      lastRecordedFocusedSessionId = undefined;
      lastRecordedFocusedSurfacePiSessionId = undefined;
      await refreshSessions();
    },
    setArchivedGroupCollapsed: async (collapsed) => {
      await rpcClient.request.setArchivedGroupCollapsed(scoped({ collapsed }));
      await refreshSessions();
    },
    setSessionNavigationSectionState: async (section, state) => {
      await rpcClient.request.setSessionNavigationSectionState(scoped({ section, ...state }));
      await refreshSessions();
    },
    setPaneScroll: (panelId, scroll) => {
      paneLayout = setLayoutPaneScroll(paneLayout, panelId, scroll);
      persistWorkspaceUiRestore();
    },
    sendPromptToTarget: async (target, input) => {
      const text = input.trim();
      if (!text) {
        return;
      }
      const normalizedTarget = normalizePromptTarget(target);
      const controller = surfaceControllers.get(normalizedTarget.surfacePiSessionId);
      if (!controller) {
        throw new Error("Expected an active prompt surface before sending a prompt.");
      }
      await controller.sendPrompt({ text, attachments: [] });
    },
    syncProviderAuth,
    requireProviderAccess,
    listOpenWorkspaces: () => rpcClient.request.getOpenWorkspaces(),
    listWorkspaceBranches: async () => {
      const result = await rpcClient.request.listWorkspaceBranches(scoped());
      return result.branches;
    },
    switchWorkspaceBranch: async (branch) => {
      const result = await rpcClient.request.switchWorkspaceBranch(scoped({ branch }));
      if (!result.ok) {
        throw new Error(result.error ?? "Unable to switch branch.");
      }
      workspaceBranch = result.workspace.branch;
      emit();
    },
    listWorkspacePaths: (pathOptions) =>
      rpcClient.request.listWorkspacePaths(scoped(pathOptions ?? {})),
    pickWorkspaceAttachments: async () => {
      const result = await rpcClient.request.pickWorkspaceAttachments(scoped());
      return result.attachments;
    },
    importComposerAttachments: async (files) => {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          name: file.name || "pasted-file",
          mimeType: file.type || undefined,
          dataBase64: await fileToBase64(file),
        })),
      );
      const result = await rpcClient.request.importComposerAttachments(scoped({ attachments }));
      return result.attachments;
    },
    openWorkspacePath: async (workspaceRelativePath) => {
      const result = await rpcClient.request.openWorkspacePath(scoped({ workspaceRelativePath }));
      return result.opened;
    },
    getWorkflowsGenerated: refreshWorkflowsGenerated,
    openWorkspaceSourceInEditor: async (path) => {
      const result = await rpcClient.request.openWorkspaceSourceInEditor(scoped({ path }));
      return result.opened;
    },
    openGeneratedAgentContextExternalSourceInEditor: async (path) => {
      const result = await rpcClient.request.openGeneratedAgentContextExternalSourceInEditor(
        scoped({ path }),
      );
      return result.opened;
    },
    getAgentSettings: refreshAgentSettings,
    getAgentContextPreview: (request = {}) =>
      rpcClient.request.getAgentContextPreview(scoped(request)),
    getAgentModelChoices: refreshAgentModelChoices,
    listProviderAuths: refreshProviderAuths,
    setProviderApiKey: async (request) => {
      const result = await rpcClient.request.setProviderApiKey(request);
      await refreshProviderAuths();
      void refreshAgentModelChoices().catch(() => undefined);
      return result;
    },
    startOAuth: async (request) => {
      const result = await rpcClient.request.startOAuth(request);
      if (result.ok) {
        await refreshProviderAuths();
        void refreshAgentModelChoices().catch(() => undefined);
      }
      return result;
    },
    removeProviderAuth: async (request) => {
      const result = await rpcClient.request.removeProviderAuth(request);
      await refreshProviderAuths();
      void refreshAgentModelChoices().catch(() => undefined);
      return result;
    },
    getExtensionsInventory: refreshExtensionsInventory,
    getAppPreferences: refreshAppPreferences,
    updateAppPreferences: async (preferences) => {
      const state = await rpcClient.request.updateAppPreferences(preferences);
      setAppCache("agentSettings", state);
      const nextPreferences = setAppCache("appPreferences", state.appPreferences)!;
      void refreshAgentModelChoices().catch(() => undefined);
      void refreshExtensionsInventory().catch(() => undefined);
      void refreshExternalInstructionSources().catch(() => undefined);
      return nextPreferences;
    },
    revertExtensionChange: async (changeId) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.revertExtensionChange(
          scoped({
            changeId,
            ...(getFocusedPromptTarget() ? { owningSurface: getFocusedPromptTarget()! } : {}),
          }),
        ),
      )!,
    saveExtensionSnapshot: async (name) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.saveExtensionSnapshot(scoped({ name })),
      )!,
    renameExtensionSnapshot: async (snapshotId, name) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.renameExtensionSnapshot(scoped({ snapshotId, name })),
      )!,
    deleteExtensionSnapshot: async (snapshotId) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.deleteExtensionSnapshot(scoped({ snapshotId })),
      )!,
    loadExtensionSnapshot: async (snapshotId) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.loadExtensionSnapshot(scoped({ snapshotId })),
      )!,
    createExtension: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.createExtension(scoped(input)),
      )!,
    duplicateExtension: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.duplicateExtension(scoped(input)),
      )!,
    deleteExtension: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.deleteExtension(scoped(input)),
      )!,
    resetExtension: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.resetExtension(scoped(input)),
      )!,
    buildExtension: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.buildExtension(scoped(input)),
      )!,
    runExtensionCliRequirementAction: async (input) => {
      const result = await rpcClient.request.runExtensionCliRequirementAction(scoped(input));
      setWorkspaceCache("extensionsInventory", result.inventory);
      return result;
    },
    setExtensionTypescriptApi: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.setExtensionTypescriptApi(scoped(input)),
      )!,
    setExtensionDefaultUsage: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.setExtensionDefaultUsage(scoped(input)),
      )!,
    reorderExtensionDefaults: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.reorderExtensionDefaults(scoped(input)),
      )!,
    addExtensionInstructionFile: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.addExtensionInstructionFile(scoped(input)),
      )!,
    removeExtensionInstructionFile: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.removeExtensionInstructionFile(scoped(input)),
      )!,
    configureExtensionInstructionFile: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.configureExtensionInstructionFile(scoped(input)),
      )!,
    reorderExtensionInstructionFiles: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.reorderExtensionInstructionFiles(scoped(input)),
      )!,
    updateExtensionInstructionFile: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.updateExtensionInstructionFile(scoped(input)),
      )!,
    openExtensionInstructionFileInEditor: async (input) => {
      const result = await rpcClient.request.openExtensionInstructionFileInEditor(scoped(input));
      return result.opened;
    },
    setExtensionEnvSecret: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.setExtensionEnvSecret(scoped(input)),
      )!,
    removeExtensionEnvSecret: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.removeExtensionEnvSecret(scoped(input)),
      )!,
    setExtensionEnvOverride: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.setExtensionEnvOverride(scoped(input)),
      )!,
    removeExtensionEnvOverride: async (input) =>
      setWorkspaceCache(
        "extensionsInventory",
        await rpcClient.request.removeExtensionEnvOverride(scoped(input)),
      )!,
    updateAgentProfile: async (profile) =>
      setAppCache(
        "agentSettings",
        await rpcClient.request.updateAgentProfile(scoped({ profile })),
      )!,
    deleteAgentProfile: async (id) =>
      setAppCache("agentSettings", await rpcClient.request.deleteAgentProfile(scoped({ id })))!,
    reorderOrchestratorAgents: async (ids) =>
      setAppCache(
        "agentSettings",
        await rpcClient.request.reorderOrchestratorAgents(scoped({ ids })),
      )!,
    updateWorkflowAgent: async (key, settings, saveOptions) => {
      const result: UpdateWorkflowAgentResponse = await rpcClient.request.updateWorkflowAgent(
        scoped({ key, settings, ...saveOptions }),
      );
      if (!result.ok) {
        setAppCache("agentSettings", result.state);
        throw new FileBackedEditConflictError<WorkflowAgentSettings>({
          code: result.code,
          current: result.current,
          currentVersion: result.currentVersion,
          baseVersion: result.baseVersion,
        });
      }
      return setAppCache("agentSettings", result.state)!;
    },
    deleteWorkflowAgent: async (key) =>
      setAppCache("agentSettings", await rpcClient.request.deleteWorkflowAgent(scoped({ key })))!,
    openWorkflowAgentSourceInEditor: async (key) => {
      const result = await rpcClient.request.openWorkflowAgentSourceInEditor(scoped({ key }));
      return result.opened;
    },
    setAgentProfileExtensionUsage: async (input) =>
      setAppCache(
        "agentSettings",
        await rpcClient.request.setAgentProfileExtensionUsage(scoped(input)),
      )!,
    updateRequestUserInputSettings: async (settings) =>
      setAppCache(
        "agentSettings",
        await rpcClient.request.updateRequestUserInputSettings(scoped(settings)),
      )!,
    getGeneratedAgentContext: () => rpcClient.request.getGeneratedAgentContext(scoped()),
    getGeneratedAgentContextDefaults: () =>
      rpcClient.request.getGeneratedAgentContextDefaults(scoped()),
    getGeneratedAgentContextEntries: () =>
      rpcClient.request.getGeneratedAgentContextEntries(scoped()),
    getGeneratedAgentContextExternalSources: refreshExternalInstructionSources,
    updateGeneratedAgentContext: (request) =>
      rpcClient.request.updateGeneratedAgentContext(scoped(request)),
    resetGeneratedAgentContext: () => rpcClient.request.resetGeneratedAgentContext(scoped()),
    listGeneratedAgentContextSnapshots: () =>
      rpcClient.request.listGeneratedAgentContextSnapshots(scoped()),
    createGeneratedAgentContextSnapshot: (name) =>
      rpcClient.request.createGeneratedAgentContextSnapshot(scoped({ name })),
    renameGeneratedAgentContextSnapshot: (snapshotId, name) =>
      rpcClient.request.renameGeneratedAgentContextSnapshot(scoped({ snapshotId, name })),
    restoreGeneratedAgentContextSnapshot: (snapshotId) =>
      rpcClient.request.restoreGeneratedAgentContextSnapshot(scoped({ snapshotId })),
    getSnippets: refreshSnippets,
    createManagedSnippet: async (input) => {
      const created = await rpcClient.request.createManagedSnippet(scoped(input));
      void refreshSnippets().catch(() => undefined);
      return created;
    },
    updateManagedSnippet: async (input) => {
      const updated = await rpcClient.request.updateManagedSnippet(scoped(input));
      void refreshSnippets().catch(() => undefined);
      return updated;
    },
    deleteManagedSnippet: async (snippetId) => {
      await rpcClient.request.deleteManagedSnippet(scoped({ snippetId }));
      void refreshSnippets().catch(() => undefined);
    },
    openSnippetExternalSourceInEditor: async (path) => {
      const result = await rpcClient.request.openSnippetExternalSourceInEditor(scoped({ path }));
      return result.opened;
    },
  };

  return runtime;
}
