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
import type {
  AbsolutePath,
  AppLogEntryId,
  AttachmentDisplayName,
  Base64String,
  IsoDateTimeStringSchema,
  JsonValue,
  MimeType,
  RuntimeClientRequestId,
  RuntimeClientSubmissionSource,
  RuntimeAttachmentId,
  RuntimeSubmittedAttachment,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspaceRelativePath,
} from "@svvy/core";
import {
  composerAttachmentPromptText,
  serializeComposerAttachmentTextSignature,
  type AppWorkspaceUiRestoreState,
  type AppLogEntry,
  type AppLogLevel,
  type AppLogQuery,
  type AppLogReadModel,
  type AppLogSource,
  type AppLogSummary,
  type AppLogUpdateMessage,
  type ConversationSurfaceSnapshot,
  type ConversationTurnTiming,
  type ComposerAttachment,
  type ComposerDraft,
  type CreateSessionRequest,
  type EditCommittedUserMessageRequest,
  type PromptTarget,
  type PromptClientSubmissionMetadata,
  type QueuedSurfaceMessage,
  type RendererTelemetryRequest,
  type SurfaceStreamPatch,
  type SurfaceSyncMessage,
  type WorkspaceBranchInfo,
  type WorkspaceCommandInspector,
  type WorkspacePathIndexEntry,
  type SvvyUserMessage,
  type WorkspaceHandlerThreadSummary,
  type WorkspaceArtifactPreview,
  type AnswerRuntimeApprovalRequest,
  type RequestUserInputAnswerRequest,
  type SetRequestUserInputTimerPausedRequest,
  type WorkspaceSessionNavigationReadModel,
  type WorkspaceScoped,
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
  type AppPreferencesReadModel,
  type RequestUserInputAnswerResponse,
  type AddExtensionInstructionFileRequest,
  type BuildExtensionRequest,
  type ConfigureExtensionInstructionFileRequest,
  type CreateExtensionRequest,
  type DeleteExtensionRequest,
  type DesktopRendererCommand,
  type DuplicateExtensionRequest,
  type ExtensionsInventoryReadModel,
  type OpenExtensionInstructionFileInEditorRequest,
  type ProviderAuthReadModel,
  type ProviderAuthInfo,
  type RemoveExtensionInstructionFileRequest,
  type RemoveExtensionEnvOverrideRequest,
  type RemoveExtensionEnvSecretRequest,
  type ReorderExtensionDefaultsRequest,
  type ResetExtensionRequest,
  type SetAgentProfileExtensionUsageRequest,
  type SetExtensionDefaultUsageRequest,
  type SetExtensionEnvOverrideRequest,
  type SetExtensionEnvSecretRequest,
  type SetExtensionTypescriptApiRequest,
  type StateReadModelBaseline,
  type StateReadModelResult,
  type UpdateExtensionInstructionFileRequest,
  type UpdateWorkflowAgentResponse,
  type WriteCommandStdinRequest,
  type WriteCommandStdinResponse,
} from "../shared/workspace-contract";
import type { UpdateAppPreferencesCommandInput } from "@svvy/state";
import { FileBackedEditConflictError, type FileBackedSaveMode } from "../shared/file-backed-edit";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";
import type {
  ComposerSnippetMention,
  CreateManagedSnippetRequest,
  ManagedSnippet,
  SentSnippetProvenance,
  SetSnippetEnabledRequest,
  SnippetsReadModel,
  UpdateManagedSnippetRequest,
} from "../shared/snippets";
import { createChatStorage, type ChatStorage } from "./chat-storage";
import {
  type AgentSettingsState,
  type AppPreferences,
  DEFAULT_AGENT_SETTINGS_STATE,
  type ReasoningEffort,
  type AgentProfileSettings,
  type AgentProfileId,
  type RequestUserInputSettings,
  type WorkflowAgentKey,
  type WorkflowAgentSettings,
} from "../shared/agent-settings";
import type { AppMenuAction } from "../shared/shortcut-registry";
import type { ExtensionUsageState } from "@svvy/core";
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
import {
  createRendererNotificationStore,
  type RendererReadModelBaselineScope,
} from "./renderer-notifications";
import type { ApplyReadModelPatchContext } from "./sequence-aware-refetcher";
import { rpc } from "./rpc";
import { buildWorkspaceSessionNavigation } from "../shared/session-navigation";

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
  appLogs: AppLogReadModel | null;
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
  appLogs: null,
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

function requireStateReadModel<Kind extends StateReadModelResult["kind"]>(
  result: StateReadModelResult,
  kind: Kind,
): Extract<StateReadModelResult, { kind: Kind }> {
  if (result.kind !== kind) {
    throw new Error(`Expected state read model ${kind}; received ${result.kind}.`);
  }
  return result as Extract<StateReadModelResult, { kind: Kind }>;
}

function appPreferencesFromStateReadModel(
  readModel: AppPreferencesReadModel,
  fallback: AppPreferences,
): AppPreferences {
  const externalEditor = readModel.externalEditor;
  const knownEditors = new Set(["system", "code", "cursor", "zed", "sublime"]);
  return {
    ...fallback,
    appAppearance: readModel.appearance,
    preferredExternalEditor:
      externalEditor && knownEditors.has(externalEditor)
        ? (externalEditor as AppPreferences["preferredExternalEditor"])
        : externalEditor
          ? "custom"
          : "system",
    customExternalEditorCommand:
      externalEditor && !knownEditors.has(externalEditor)
        ? externalEditor
        : fallback.customExternalEditorCommand,
    artifactDirectory: readModel.artifactDirectory,
    approvalMode: readModel.approvalMode,
    networkAccess: readModel.networkAccess,
    externalInstructions: readModel.externalInstructions,
    ambientAgentResources:
      typeof readModel.ambientResources === "object" &&
      readModel.ambientResources !== null &&
      !Array.isArray(readModel.ambientResources)
        ? (readModel.ambientResources as unknown as AppPreferences["ambientAgentResources"])
        : fallback.ambientAgentResources,
  };
}

function appPreferencesStateCommandPatch(
  preferences: AppPreferences,
): UpdateAppPreferencesCommandInput["patch"] {
  return {
    appearance: preferences.appAppearance,
    externalEditor:
      preferences.preferredExternalEditor === "system"
        ? null
        : preferences.preferredExternalEditor === "custom"
          ? preferences.customExternalEditorCommand || "custom"
          : preferences.preferredExternalEditor,
    artifactDirectory: preferences.artifactDirectory as AbsolutePath,
    approvalMode: preferences.approvalMode,
    networkAccess: preferences.networkAccess,
    externalInstructions: preferences.externalInstructions,
    ambientResources: preferences.ambientAgentResources as unknown as JsonValue,
  };
}

function providerAuthInfosFromStateReadModel(
  readModel: ProviderAuthReadModel,
  current: readonly ProviderAuthInfo[],
): ProviderAuthInfo[] {
  const currentByProvider = new Map(current.map((info) => [info.provider, info]));
  return readModel.providers.map((status) => {
    const fallback = currentByProvider.get(status.providerId);
    return {
      provider: status.providerId,
      hasKey: status.health !== "missing",
      keyType: fallback?.keyType ?? (status.health === "missing" ? "none" : "apikey"),
      supportsOAuth: fallback?.supportsOAuth ?? false,
      authHealth:
        status.health === "usable"
          ? "available"
          : status.health === "expired"
            ? "oauth-expired"
            : status.health === "refresh_failed"
              ? "oauth-refresh-failed"
              : "missing",
      expiresAt: status.expiresAt ?? fallback?.expiresAt ?? null,
      ...(status.issue
        ? { authError: status.issue }
        : fallback?.authError
          ? { authError: fallback.authError }
          : {}),
      ...(fallback?.authFailedAt ? { authFailedAt: fallback.authFailedAt } : {}),
    };
  });
}

function notifyReadModelCachesChanged(workspaceId?: string): void {
  for (const entry of activeRuntimeEmitters) {
    if (!workspaceId || entry.workspaceId === workspaceId) {
      entry.emit();
    }
  }
}

function emptyAppLogSummary(): AppLogSummary {
  return {
    latestSeq: 0,
    seenSeq: 0,
    unread: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
    totals: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
  };
}

function appLogEntryMatchesQuery(entry: AppLogEntry, query?: AppLogQuery): boolean {
  if (!query) return true;
  if (query.afterSeq !== undefined && entry.seq <= query.afterSeq) return false;
  if (query.beforeSeq !== undefined && entry.seq >= query.beforeSeq) return false;
  if (query.levels?.length && !query.levels.includes(entry.level)) return false;
  if (query.sources?.length && !query.sources.includes(entry.source)) return false;
  const search = query.query?.trim().toLowerCase();
  if (!search) return true;
  return [
    entry.message,
    entry.source,
    entry.level,
    entry.workspaceSessionId,
    entry.surfacePiSessionId,
    entry.threadId,
    entry.workflowRunId,
    entry.workflowTaskAttemptId,
    entry.commandId,
    entry.artifactId,
    entry.details ? JSON.stringify(entry.details) : "",
    entry.error?.message ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(search);
}

function summarizeRendererAppLogs(
  backendSummary: AppLogSummary,
  rendererEntries: readonly AppLogEntry[],
  rendererSeenSeq: number,
): AppLogSummary {
  const summary = structuredClone(backendSummary);
  for (const entry of rendererEntries) {
    summary.latestSeq = Math.max(summary.latestSeq, entry.seq);
    summary.totals.total += 1;
    summary.totals[entry.level] += 1;
    if (entry.seq > rendererSeenSeq) {
      summary.unread.total += 1;
      summary.unread[entry.level] += 1;
    }
  }
  summary.seenSeq = Math.max(summary.seenSeq, rendererSeenSeq);
  return summary;
}

function mergeRendererAppLogs(
  backendReadModel: AppLogReadModel,
  rendererEntries: readonly AppLogEntry[],
  rendererSeenSeq: number,
  query?: AppLogQuery,
): AppLogReadModel {
  const matchingRendererEntries = rendererEntries.filter((entry) =>
    appLogEntryMatchesQuery(entry, query),
  );
  const limit = query?.limit ?? 600;
  return {
    entries: mergeAppLogEntries(backendReadModel.entries, matchingRendererEntries).slice(-limit),
    summary: summarizeRendererAppLogs(backendReadModel.summary, rendererEntries, rendererSeenSeq),
  };
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

function buildRuntimeSubmittedAttachments(
  input: readonly ComposerAttachment[],
): RuntimeSubmittedAttachment[] {
  return input.map((attachment) => {
    const common = {
      ...(attachment.id !== undefined ? { id: attachment.id as RuntimeAttachmentId } : {}),
      ...(attachment.name !== undefined ? { name: attachment.name as AttachmentDisplayName } : {}),
      path: attachment.path as AbsolutePath,
      ...(attachment.workspaceRelativePath !== undefined
        ? { workspaceRelativePath: attachment.workspaceRelativePath as WorkspaceRelativePath }
        : {}),
      ...(attachment.mimeType !== undefined ? { mimeType: attachment.mimeType as MimeType } : {}),
      ...(attachment.sizeBytes !== undefined ? { sizeBytes: attachment.sizeBytes } : {}),
    };
    if (attachment.kind === "image") {
      return {
        ...common,
        kind: "image",
        dataBase64: attachment.dataBase64 as Base64String,
        mimeType: (attachment.mimeType ?? "application/octet-stream") as MimeType,
      };
    }
    if (attachment.kind === "folder") {
      return { ...common, kind: "folder" };
    }
    return { ...common, kind: "file" };
  });
}

function serializableComposerAttachment(input: ComposerAttachment): ComposerAttachment {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    path: input.path,
    ...(input.workspaceRelativePath !== undefined
      ? { workspaceRelativePath: input.workspaceRelativePath }
      : {}),
    ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
    ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
    ...(input.dataBase64 !== undefined ? { dataBase64: input.dataBase64 } : {}),
  };
}

function serializableSnippetMention(input: ComposerSnippetMention): ComposerSnippetMention {
  return {
    id: input.id,
    snippetId: input.snippetId,
    source: input.source,
    title: input.title,
    token: input.token,
    body: input.body,
    ...(input.path !== undefined ? { path: input.path } : {}),
    contentHash: input.contentHash,
    arguments: [...input.arguments],
    metadata: {
      description: input.metadata.description,
      argumentHint: input.metadata.argumentHint,
    },
  };
}

function serializableSnippetProvenance(input: SentSnippetProvenance): SentSnippetProvenance {
  return {
    mentionId: input.mentionId,
    snippetId: input.snippetId,
    source: input.source,
    title: input.title,
    ...(input.path !== undefined ? { path: input.path } : {}),
    contentHash: input.contentHash,
    arguments: [...input.arguments],
    resolvedText: input.resolvedText,
  };
}

function serializableClientSubmission(
  input: PromptClientSubmissionMetadata | undefined,
): PromptClientSubmissionMetadata | undefined {
  if (!input) return undefined;
  return {
    ...(input.submissionId !== undefined ? { submissionId: input.submissionId } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.clientRequestId !== undefined ? { clientRequestId: input.clientRequestId } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.submittedAt !== undefined ? { submittedAt: input.submittedAt } : {}),
    ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
  };
}

function serializableComposerSubmission(input: ComposerPromptSubmission): ComposerPromptSubmission {
  return {
    text: input.text.trim(),
    attachments: input.attachments.map(serializableComposerAttachment),
    snippetMentions: (input.snippetMentions ?? []).map(serializableSnippetMention),
    snippetProvenance: (input.snippetProvenance ?? []).map(serializableSnippetProvenance),
    ...(input.telemetryCorrelationId !== undefined
      ? { telemetryCorrelationId: input.telemetryCorrelationId }
      : {}),
    ...(input.clientSubmission
      ? { clientSubmission: serializableClientSubmission(input.clientSubmission) }
      : {}),
  };
}

function createDesktopClientRequestId(): string {
  return `desktop-submit:${
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }`;
}

function serializableComposerDraft(
  draft: Pick<ComposerDraft, "text" | "attachments" | "snippetMentions">,
  updatedAt: string | null,
): ComposerDraft {
  return {
    text: draft.text,
    attachments: draft.attachments.map(serializableComposerAttachment),
    snippetMentions: (draft.snippetMentions ?? []).map(serializableSnippetMention),
    updatedAt,
  };
}

function messagesArePrefixOfCurrent(
  candidate: readonly unknown[],
  current: readonly unknown[],
): boolean {
  if (candidate.length >= current.length) {
    return false;
  }
  return candidate.every((message, index) => {
    return JSON.stringify(message) === JSON.stringify(current[index]);
  });
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
  telemetryCorrelationId?: string;
  clientSubmission?: PromptClientSubmissionMetadata;
};

export type RendererTelemetryEvent = {
  eventName: string;
  correlationId: string;
  level: AppLogLevel;
  source?: AppLogSource;
  message: string;
  workspaceId?: string;
  workspaceSessionId?: string;
  surfacePiSessionId?: string;
  threadId?: string;
  details?: Record<string, unknown>;
  error?: AppLogEntry["error"];
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
  sendPrompt: (input: ComposerPromptSubmission, panelId?: string) => Promise<void>;
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
    rendererReady: typeof rpc.request.rendererReady;
    getAgentSettings: typeof rpc.request.getAgentSettings;
    getAgentContextPreview: typeof rpc.request.getAgentContextPreview;
    getAgentModelChoices: typeof rpc.request.getAgentModelChoices;
    getExtensionsInventory: typeof rpc.request.getExtensionsInventory;
    fetchStateReadModel: typeof rpc.request.fetchStateReadModel;
    refetchStateReadModels: typeof rpc.request.refetchStateReadModels;
    refetchStateReadModelInvalidation: typeof rpc.request.refetchStateReadModelInvalidation;
    rebaselineStateReadModels: typeof rpc.request.rebaselineStateReadModels;
    stateAppLogsMarkRead: typeof rpc.request.stateAppLogsMarkRead;
    saveExtensionSnapshot: typeof rpc.request.saveExtensionSnapshot;
    renameExtensionSnapshot: typeof rpc.request.renameExtensionSnapshot;
    deleteExtensionSnapshot: typeof rpc.request.deleteExtensionSnapshot;
    loadExtensionSnapshot: typeof rpc.request.loadExtensionSnapshot;
    createExtension: typeof rpc.request.createExtension;
    duplicateExtension: typeof rpc.request.duplicateExtension;
    deleteExtension: typeof rpc.request.deleteExtension;
    resetExtension: typeof rpc.request.resetExtension;
    buildExtension: typeof rpc.request.buildExtension;
    setExtensionTypescriptApi: typeof rpc.request.setExtensionTypescriptApi;
    setExtensionDefaultUsage: typeof rpc.request.setExtensionDefaultUsage;
    reorderExtensionDefaults: typeof rpc.request.reorderExtensionDefaults;
    addExtensionInstructionFile: typeof rpc.request.addExtensionInstructionFile;
    removeExtensionInstructionFile: typeof rpc.request.removeExtensionInstructionFile;
    configureExtensionInstructionFile: typeof rpc.request.configureExtensionInstructionFile;
    updateExtensionInstructionFile: typeof rpc.request.updateExtensionInstructionFile;
    openExtensionInstructionFileInEditor: typeof rpc.request.openExtensionInstructionFileInEditor;
    setExtensionEnvSecret: typeof rpc.request.setExtensionEnvSecret;
    removeExtensionEnvSecret: typeof rpc.request.removeExtensionEnvSecret;
    setExtensionEnvOverride: typeof rpc.request.setExtensionEnvOverride;
    removeExtensionEnvOverride: typeof rpc.request.removeExtensionEnvOverride;
    getGeneratedAgentContextExternalSources: typeof rpc.request.getGeneratedAgentContextExternalSources;
    getSnippets: typeof rpc.request.getSnippets;
    createManagedSnippet: typeof rpc.request.createManagedSnippet;
    updateManagedSnippet: typeof rpc.request.updateManagedSnippet;
    deleteManagedSnippet: typeof rpc.request.deleteManagedSnippet;
    setSnippetEnabled: typeof rpc.request.setSnippetEnabled;
    openSnippetExternalSourceInEditor: typeof rpc.request.openSnippetExternalSourceInEditor;
    updateAgentProfile: typeof rpc.request.updateAgentProfile;
    deleteAgentProfile: typeof rpc.request.deleteAgentProfile;
    reorderOrchestratorAgents: typeof rpc.request.reorderOrchestratorAgents;
    updateWorkflowAgent: typeof rpc.request.updateWorkflowAgent;
    deleteWorkflowAgent: typeof rpc.request.deleteWorkflowAgent;
    openWorkflowAgentSourceInEditor: typeof rpc.request.openWorkflowAgentSourceInEditor;
    setAgentProfileExtensionUsage: typeof rpc.request.setAgentProfileExtensionUsage;
    stateAppPreferencesUpdate: typeof rpc.request.stateAppPreferencesUpdate;
    updateRequestUserInputSettings: typeof rpc.request.updateRequestUserInputSettings;
    getOpenWorkspaces: typeof rpc.request.getOpenWorkspaces;
    getWorkspaceInfo: typeof rpc.request.getWorkspaceInfo;
    getWorkspaceUiRestore: typeof rpc.request.getWorkspaceUiRestore;
    setWorkspaceUiRestore: typeof rpc.request.setWorkspaceUiRestore;
    listWorkspaceBranches: typeof rpc.request.listWorkspaceBranches;
    switchWorkspaceBranch: typeof rpc.request.switchWorkspaceBranch;
    writeClipboardText: typeof rpc.request.writeClipboardText;
    listWorkspacePaths: typeof rpc.request.listWorkspacePaths;
    pickWorkspaceAttachments: typeof rpc.request.pickWorkspaceAttachments;
    importComposerAttachments: typeof rpc.request.importComposerAttachments;
    openWorkspacePath: typeof rpc.request.openWorkspacePath;
    getWorkflowsGenerated: typeof rpc.request.getWorkflowsGenerated;
    openWorkspaceSourceInEditor: typeof rpc.request.openWorkspaceSourceInEditor;
    openGeneratedAgentContextExternalSourceInEditor: typeof rpc.request.openGeneratedAgentContextExternalSourceInEditor;
    listSessions: typeof rpc.request.listSessions;
    getCommandInspector: typeof rpc.request.getCommandInspector;
    writeCommandStdin: typeof rpc.request.writeCommandStdin;
    listHandlerThreads: typeof rpc.request.listHandlerThreads;
    getArtifactPreview: typeof rpc.request.getArtifactPreview;
    createSession: typeof rpc.request.createSession;
    openSession: typeof rpc.request.openSession;
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
    setSessionNavigationSectionState: typeof rpc.request.setSessionNavigationSectionState;
    sendPrompt: typeof rpc.request.sendPrompt;
    recordRendererTelemetry: typeof rpc.request.recordRendererTelemetry;
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
  appGlobalLogsSnapshot: AppLogReadModel | null;
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
  primaryPaneId: string;
  dispose: () => void;
  markRendererReady: () => Promise<void>;
  subscribe: (listener: ChatRuntimeListener) => () => void;
  subscribeAppLogUpdate: (listener: (payload: AppLogUpdateMessage) => void) => () => void;
  subscribeRendererCommand: (listener: (command: DesktopRendererCommand) => void) => () => void;
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
  writeCommandStdin: (request: WriteCommandStdinRequest) => Promise<WriteCommandStdinResponse>;
  listHandlerThreads: (sessionId?: string) => Promise<WorkspaceHandlerThreadSummary[]>;
  getWorkflowTaskAttemptInspector: (
    workflowTaskAttemptId: string,
    sessionId?: string,
  ) => Promise<WorkspaceWorkflowTaskAttemptInspector>;
  getArtifactPreview: (artifactId: string, sessionId?: string) => Promise<WorkspaceArtifactPreview>;
  getRequestUserInputRequests: () => WorkspaceRequestUserInputRequest[];
  answerRequestUserInput: (
    request: RequestUserInputAnswerRequest,
  ) => Promise<RequestUserInputAnswerResponse>;
  setRequestUserInputTimerPaused: (request: SetRequestUserInputTimerPausedRequest) => Promise<void>;
  getRuntimeApprovalRequests: () => WorkspaceRuntimeApprovalRequest[];
  answerRuntimeApprovalRequest: (request: AnswerRuntimeApprovalRequest) => Promise<void>;
  getAppLogs: (query?: AppLogQuery) => Promise<AppLogReadModel>;
  getAppLogSummary: () => Promise<AppLogSummary>;
  markAppLogsSeen: (throughSeq: number) => Promise<AppLogSummary>;
  recordRendererTelemetry: (event: RendererTelemetryEvent) => void;
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
  setSessionNavigationSectionState: (
    section: "pinned" | "active" | "archived",
    state: { collapsed?: boolean; sizePx?: number },
  ) => Promise<void>;
  setPaneScroll: (
    panelId: string,
    scroll: ChatPaneLayoutState["panels"][number]["localState"]["scroll"],
  ) => void;
  sendPromptToTarget: (target: PromptTarget, input: string) => Promise<void>;
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
  getSnippets: () => Promise<SnippetsReadModel>;
  createManagedSnippet: (input: CreateManagedSnippetRequest) => Promise<ManagedSnippet>;
  updateManagedSnippet: (input: UpdateManagedSnippetRequest) => Promise<ManagedSnippet>;
  deleteManagedSnippet: (snippetId: string) => Promise<void>;
  setSnippetEnabled: (input: SetSnippetEnabledRequest) => Promise<void>;
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
  if (target?.surface !== "orchestrator" && target?.surface !== "handler") {
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
  if (target.surface === "handler") {
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
  private draftPersistenceGeneration = 0;
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
      this.promptStatus === "streaming" &&
      this.agent.state.isStreaming &&
      snapshot.promptStatus === "idle" &&
      !snapshot.pendingUserMessage &&
      messagesArePrefixOfCurrent(snapshot.messages, this.agent.state.messages)
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

  async sendPrompt(input: ComposerPromptSubmission, panelId?: string): Promise<void> {
    const submission = serializableComposerSubmission(input);
    if (!submission.text && submission.attachments.length === 0) {
      return;
    }
    const requestPanelId = panelId ?? this.panelIds.values().next().value;
    if (typeof requestPanelId !== "string" || !requestPanelId) {
      throw new Error("Expected an attached panel before sending a prompt.");
    }

    try {
      const response = await this.rpcClient.request.sendPrompt({
        panelId: requestPanelId,
        target: this.target,
        text: submission.text,
        attachments: buildRuntimeSubmittedAttachments(submission.attachments),
        clientRequestId:
          submission.clientSubmission?.clientRequestId ?? createDesktopClientRequestId(),
        workspaceId: this.workspaceId,
      });
      this.target = normalizePromptTarget(response.target);
      this.agent.sessionId = response.target.surfacePiSessionId;
      await this.persistPromptHistoryEntry(submission.text);
      this.invalidatePendingDraftPersistence();
      this.rendererOwnsDraft = false;
      this.composerDraft = {
        text: "",
        attachments: [],
        snippetMentions: [],
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      setSurfaceAgentStreamState(this.agent, {
        isStreaming: false,
        streamMessage: null,
        error: error instanceof Error ? error.message : "Prompt submission failed.",
      });
      throw error;
    } finally {
      this.emit();
    }
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
    const nextDraft = serializableComposerDraft(draft, new Date().toISOString());
    this.composerDraft = nextDraft;
    this.rendererOwnsDraft = true;
    this.emit();

    this.scheduleDraftPersistence(nextDraft);
  }

  private scheduleDraftPersistence(draft: ComposerDraft): void {
    if (this.draftPersistTimer) {
      clearTimeout(this.draftPersistTimer);
    }
    const draftToPersist = serializableComposerDraft(draft, draft.updatedAt);
    const generation = ++this.draftPersistenceGeneration;
    this.draftPersistTimer = setTimeout(() => {
      this.draftPersistTimer = null;
      this.persistComposerDraft(draftToPersist, generation);
    }, 120);
  }

  private invalidatePendingDraftPersistence(): void {
    this.draftPersistenceGeneration += 1;
    if (this.draftPersistTimer) {
      clearTimeout(this.draftPersistTimer);
      this.draftPersistTimer = null;
    }
  }

  private persistComposerDraft(draft: ComposerDraft, generation: number): void {
    this.draftSyncChain = this.draftSyncChain
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.draftPersistenceGeneration || !this.rendererOwnsDraft) {
          return;
        }
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

  dispose(): void {
    if (this.draftPersistTimer) {
      clearTimeout(this.draftPersistTimer);
      this.draftPersistTimer = null;
      const generation = this.draftPersistenceGeneration;
      this.persistComposerDraft(this.composerDraft, generation);
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
  const rendererCommandListeners = new Set<(command: DesktopRendererCommand) => void>();
  const surfaceControllers = new Map<string, ChatSurfaceControllerInternal>();
  let sessions: WorkspaceSessionSummary[] = [];
  let sessionNavigation: WorkspaceSessionNavigationReadModel = buildWorkspaceSessionNavigation([]);
  let requestUserInputRequests: WorkspaceRequestUserInputRequest[] = [];
  let runtimeApprovalRequests: WorkspaceRuntimeApprovalRequest[] = [];
  let backendAppLogSummary: AppLogSummary = emptyAppLogSummary();
  let appLogSummary: AppLogSummary = emptyAppLogSummary();
  let rendererTelemetryEntries: AppLogEntry[] = [];
  let rendererTelemetryOrdinal = 0;
  let rendererAppLogSeenSeq = 0;
  let paneLayout = createEmptyPaneLayout();
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
  let rendererReadyPromise: Promise<void> | null = null;

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
    setAppCache(
      "appPreferences",
      appPreferencesFromStateReadModel(
        requireStateReadModel(
          await rpcClient.request.fetchStateReadModel({ kind: "appPreferences" }),
          "appPreferences",
        ).value,
        appReadModelCache.agentSettings?.appPreferences ??
          appReadModelCache.appPreferences ??
          DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
      ),
    )!;

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

  const refreshRequestInput = async (): Promise<WorkspaceRequestUserInputRequest[]> => {
    const result = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({
        kind: "requestInput",
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
      }),
      "requestInput",
    );
    requestUserInputRequests = structuredClone([...result.value.requests]);
    emit();
    return structuredClone(requestUserInputRequests);
  };

  const refreshApprovals = async (): Promise<WorkspaceRuntimeApprovalRequest[]> => {
    const result = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({
        kind: "approvals",
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
      }),
      "approvals",
    );
    runtimeApprovalRequests = structuredClone([...result.value.requests]);
    emit();
    return structuredClone(runtimeApprovalRequests);
  };

  const refreshAppLogs = async (query?: AppLogQuery): Promise<AppLogReadModel> => {
    const backendReadModel = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({
        kind: "appLogs",
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        query,
      }),
      "appLogs",
    ).value;
    backendAppLogSummary = backendReadModel.summary;
    appLogSummary = summarizeRendererAppLogs(
      backendAppLogSummary,
      rendererTelemetryEntries,
      rendererAppLogSeenSeq,
    );
    const next = mergeRendererAppLogs(
      backendReadModel,
      rendererTelemetryEntries,
      rendererAppLogSeenSeq,
      query,
    );
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

  const applyAppLogSideEffects = (entries: readonly AppLogEntry[]): void => {
    if (
      entries.some(
        (entry) =>
          entry.source === "workflow.library" &&
          entry.message === "Generated Workflows package rebuilt.",
      )
    ) {
      void refreshWorkflowsGenerated().catch(() => undefined);
    }
    for (const entry of entries) {
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
        domains.some((domain) => domain === "extensions" || domain === "external_instructions")
      ) {
        void refreshExtensionsInventory().catch(() => undefined);
      }
      if (refreshAll || domains.includes("external_instructions")) {
        void refreshExternalInstructionSources().catch(() => undefined);
      }
      if (
        refreshAll ||
        domains.some((domain) => domain === "extensions" || domain === "workflows")
      ) {
        void refreshWorkflowsGenerated().catch(() => undefined);
      }
      if (refreshAll || domains.includes("host_snippets")) {
        void refreshSnippets().catch(() => undefined);
      }
    }
  };

  const applyNotificationReadModelPatch = (
    patch: readonly StateReadModelResult[],
    context?: ApplyReadModelPatchContext,
    baselineScope?: RendererReadModelBaselineScope,
  ): void => {
    const appScopedLogs = context?.descriptor.scope === "app" || baselineScope?.kind === "app";
    for (const result of patch) {
      switch (result.kind) {
        case "appLogs": {
          if (appScopedLogs) {
            setAppCache("appLogs", result.value);
            break;
          }
          backendAppLogSummary = result.value.summary;
          appLogSummary = summarizeRendererAppLogs(
            backendAppLogSummary,
            rendererTelemetryEntries,
            rendererAppLogSeenSeq,
          );
          const next = mergeRendererAppLogs(
            result.value,
            rendererTelemetryEntries,
            rendererAppLogSeenSeq,
            { limit: 600 },
          );
          setWorkspaceCache("appLogs", next);
          applyAppLogSideEffects(result.value.entries);
          for (const listener of appLogUpdateListeners) {
            listener({
              workspaceId: workspaceInfo.workspaceId,
              entries: result.value.entries,
              summary: result.value.summary,
            });
          }
          break;
        }
        case "appLogSummary":
          if (appScopedLogs) {
            setAppCache("appLogs", {
              entries: appReadModelCache.appLogs?.entries ?? [],
              summary: result.value,
            });
            break;
          }
          backendAppLogSummary = result.value;
          appLogSummary = summarizeRendererAppLogs(
            backendAppLogSummary,
            rendererTelemetryEntries,
            rendererAppLogSeenSeq,
          );
          break;
        case "appPreferences":
          setAppCache(
            "appPreferences",
            appPreferencesFromStateReadModel(
              result.value,
              appReadModelCache.agentSettings?.appPreferences ??
                appReadModelCache.appPreferences ??
                DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
            ),
          );
          break;
        case "settings":
          setAppCache(
            "appPreferences",
            appPreferencesFromStateReadModel(
              result.value.preferences,
              appReadModelCache.agentSettings?.appPreferences ??
                appReadModelCache.appPreferences ??
                DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
            ),
          );
          break;
        case "providerAuth":
          setAppCache(
            "providerAuths",
            providerAuthInfosFromStateReadModel(
              result.value,
              appReadModelCache.providerAuths ?? [],
            ),
          );
          break;
        case "requestInput":
          requestUserInputRequests = structuredClone([...result.value.requests]);
          break;
        case "approvals":
          runtimeApprovalRequests = structuredClone([...result.value.requests]);
          break;
      }
    }
    emit();
  };

  const applyNotificationReadModelBaseline = (
    baseline: StateReadModelBaseline,
    scope: RendererReadModelBaselineScope,
  ): void => {
    if (scope.kind === "app") {
      appReadModelCache.appLogs = null;
      appReadModelCache.appPreferences = null;
      appReadModelCache.providerAuths = null;
    } else {
      const workspaceCache = workspaceReadModelCache(workspaceInfo.workspaceId);
      workspaceCache.appLogs = null;
      backendAppLogSummary = emptyAppLogSummary();
      appLogSummary = summarizeRendererAppLogs(
        backendAppLogSummary,
        rendererTelemetryEntries,
        rendererAppLogSeenSeq,
      );
    }
    applyNotificationReadModelPatch([...baseline.app, ...baseline.workspaces], undefined, scope);
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
    if (disposed) {
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

  const writeCommandStdin = async (
    request: WriteCommandStdinRequest,
  ): Promise<WriteCommandStdinResponse> => {
    return await rpcClient.request.writeCommandStdin(
      scoped({
        ...request,
        ...(request.clientSubmission
          ? { clientSubmission: serializableClientSubmission(request.clientSubmission) }
          : {}),
      }),
    );
  };

  const listHandlerThreads = async (
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceHandlerThreadSummary[]> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before listing handler threads.");
    }

    return await rpcClient.request.listHandlerThreads(scoped({ sessionId }));
  };

  const getWorkflowTaskAttemptInspector = async (
    workflowTaskAttemptId: string,
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceWorkflowTaskAttemptInspector> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before inspecting a workflow task attempt.");
    }

    const inspector = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({
        kind: "workflowTaskAttemptInspector",
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        workflowTaskAttemptId: workflowTaskAttemptId as WorkflowTaskAttemptId,
      }),
      "workflowTaskAttemptInspector",
    ).value;
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

  const [
    initialCatalog,
    initialAppLogSummaryResult,
    initialRequestInputResult,
    initialApprovalsResult,
  ] = await Promise.all([
    rpcClient.request.listSessions({ workspaceId: workspaceInfo.workspaceId }),
    rpcClient.request.fetchStateReadModel({
      kind: "appLogSummary",
      workspaceId: workspaceInfo.workspaceId as WorkspaceId,
    }),
    rpcClient.request.fetchStateReadModel({
      kind: "requestInput",
      workspaceId: workspaceInfo.workspaceId as WorkspaceId,
    }),
    rpcClient.request.fetchStateReadModel({
      kind: "approvals",
      workspaceId: workspaceInfo.workspaceId as WorkspaceId,
    }),
  ]);
  const initialAppLogSummary = requireStateReadModel(
    initialAppLogSummaryResult,
    "appLogSummary",
  ).value;
  const initialRequestInput = requireStateReadModel(
    initialRequestInputResult,
    "requestInput",
  ).value;
  const initialApprovals = requireStateReadModel(initialApprovalsResult, "approvals").value;
  sessions = initialCatalog.sessions;
  sessionNavigation = initialCatalog.navigation;
  requestUserInputRequests = structuredClone([...initialRequestInput.requests]);
  runtimeApprovalRequests = structuredClone([...initialApprovals.requests]);
  backendAppLogSummary = initialAppLogSummary;
  appLogSummary = summarizeRendererAppLogs(
    backendAppLogSummary,
    rendererTelemetryEntries,
    rendererAppLogSeenSeq,
  );

  await refreshProviderAuths();
  refreshWarmReadModels();

  const restoreState = (await rpcClient.request
    .getWorkspaceUiRestore(scoped())
    .catch((error: unknown) => {
      console.error("Failed to load workspace UI restore state:", error);
      return null;
    })) as WorkspaceUiRestoreState | null;
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
  const activeRestoreSlotSaved = !!restoreState && restoreState.layouts[activeLayoutId] !== null;
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
    if (workspaceInfo.kind === "default" && !activeRestoreLayout?.panels.length) {
      paneLayout = addDockviewPanel(
        createEmptyPaneLayout(),
        { surface: "open-workspace" },
        PRIMARY_CHAT_PANE_ID,
      );
      persistWorkspaceUiRestore();
    } else if (!activeRestoreLayout?.panels.length) {
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

  const rendererNotificationStore = createRendererNotificationStore({
    rpcClient,
    workspaceId: workspaceInfo.workspaceId as WorkspaceId,
    applyReadModelPatch: applyNotificationReadModelPatch,
    applyReadModelBaseline: applyNotificationReadModelBaseline,
    onRendererCommand: (command) => {
      for (const listener of rendererCommandListeners) {
        listener(command);
      }
    },
    onError: (error, context) => console.error(`${context}:`, error),
  });

  rpcClient.addMessageListener("sendWorkspaceSync", workspaceSyncListener);
  rpcClient.addMessageListener("sendSurfaceSync", surfaceSyncListener);
  recordFocusedSession();

  const recordRendererTelemetry = (event: RendererTelemetryEvent): void => {
    if (event.workspaceId && event.workspaceId !== workspaceInfo.workspaceId) {
      return;
    }
    rendererTelemetryOrdinal += 1;
    const lastRendererSeq = rendererTelemetryEntries.at(-1)?.seq ?? 0;
    const seq = Math.max(backendAppLogSummary.latestSeq, lastRendererSeq) + 0.000001;
    const entry: AppLogEntry = {
      id: `renderer-${workspaceInfo.workspaceId}-${Date.now().toString(36)}-${rendererTelemetryOrdinal}`,
      seq,
      createdAt: new Date().toISOString(),
      level: event.level,
      source: event.source ?? "renderer",
      message: event.message,
      details: {
        eventName: event.eventName,
        correlationId: event.correlationId,
        ...event.details,
      },
      ...(event.error ? { error: event.error } : {}),
      ...(event.workspaceSessionId ? { workspaceSessionId: event.workspaceSessionId } : {}),
      ...(event.surfacePiSessionId ? { surfacePiSessionId: event.surfacePiSessionId } : {}),
      ...(event.threadId ? { threadId: event.threadId } : {}),
    };
    rendererTelemetryEntries = [...rendererTelemetryEntries, entry].slice(-600);
    appLogSummary = summarizeRendererAppLogs(
      backendAppLogSummary,
      rendererTelemetryEntries,
      rendererAppLogSeenSeq,
    );
    const cache = workspaceReadModelCache(workspaceInfo.workspaceId);
    const currentReadModel = cache.appLogs ?? {
      entries: [],
      summary: backendAppLogSummary,
    };
    cache.appLogs = mergeRendererAppLogs(
      {
        entries: mergeAppLogEntries(currentReadModel.entries, [entry]).slice(-600),
        summary: backendAppLogSummary,
      },
      rendererTelemetryEntries,
      rendererAppLogSeenSeq,
      { limit: 600 },
    );
    const update: AppLogUpdateMessage = {
      workspaceId: workspaceInfo.workspaceId,
      entries: [entry],
      summary: appLogSummary,
    };
    for (const listener of appLogUpdateListeners) {
      listener(structuredClone(update));
    }
    const backendRequest: WorkspaceScoped<RendererTelemetryRequest> = {
      workspaceId: workspaceInfo.workspaceId,
      eventName: event.eventName,
      level: event.level,
      message: event.message,
      correlationId: event.correlationId,
      details: {
        localProjectionId: entry.id,
        ...event.details,
      },
      error: event.error,
      target:
        event.workspaceSessionId && event.surfacePiSessionId
          ? {
              workspaceSessionId: event.workspaceSessionId,
              surface: event.threadId ? "handler" : "orchestrator",
              surfacePiSessionId: event.surfacePiSessionId,
              threadId: event.threadId,
            }
          : undefined,
    };
    void rpcClient.request.recordRendererTelemetry(backendRequest).catch((error) => {
      console.error("Failed to record renderer telemetry:", error);
    });
    emit();
  };

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
    get appGlobalLogsSnapshot() {
      return cloneOrNull(appReadModelCache.appLogs);
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
    dispose: () => {
      disposed = true;
      activeRuntimeEmitters.delete(runtimeCacheEmitter);
      rendererNotificationStore.dispose();
      rpcClient.removeMessageListener("sendWorkspaceSync", workspaceSyncListener);
      rpcClient.removeMessageListener("sendSurfaceSync", surfaceSyncListener);
      for (const controller of surfaceControllers.values()) {
        controller.dispose();
      }
      appLogUpdateListeners.clear();
      rendererCommandListeners.clear();
      listeners.clear();
    },
    markRendererReady: () => {
      if (rendererReadyPromise) {
        return rendererReadyPromise;
      }
      rendererReadyPromise = (async () => {
        const baseline = await rpcClient.request.rebaselineStateReadModels({
          workspaceId: workspaceInfo.workspaceId as WorkspaceId,
          reason: "renderer-startup",
        });
        if (disposed) {
          throw new Error("Cannot report renderer readiness after runtime disposal.");
        }
        applyNotificationReadModelBaseline(baseline, {
          kind: "workspace",
          workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        });
        await rpcClient.request.rendererReady();
      })();
      return rendererReadyPromise;
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
    subscribeRendererCommand: (listener) => {
      rendererCommandListeners.add(listener);
      return () => {
        rendererCommandListeners.delete(listener);
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
      if (disposed) {
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
      } else if (workspaceInfo.kind === "default" && !paneLayout.panels.length) {
        paneLayout = addDockviewPanel(
          createEmptyPaneLayout(),
          { surface: "open-workspace" },
          PRIMARY_CHAT_PANE_ID,
        );
      }
      emit();
      recordFocusedSession();
    },
    switchWorkspaceLayout: async (layoutId) => {
      if (layoutId === activeLayoutId) {
        return;
      }
      captureActiveLayout();
      activeLayoutId = layoutId;
      await hydrateActiveLayout(
        savedLayouts[layoutId] ? normalizePaneLayout(savedLayouts[layoutId]!) : null,
      );
      if (workspaceInfo.kind === "default" && !paneLayout.panels.length) {
        paneLayout = addDockviewPanel(
          createEmptyPaneLayout(),
          { surface: "open-workspace" },
          PRIMARY_CHAT_PANE_ID,
        );
      }
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
    writeCommandStdin,
    listHandlerThreads,
    getWorkflowTaskAttemptInspector,
    getArtifactPreview,
    getRequestUserInputRequests: () => structuredClone(requestUserInputRequests),
    getRuntimeApprovalRequests: () => structuredClone(runtimeApprovalRequests),
    answerRequestUserInput: async (request) => {
      const response = await rpcClient.request.answerRequestUserInput(
        scoped({
          ...request,
          ...(request.clientSubmission
            ? { clientSubmission: serializableClientSubmission(request.clientSubmission) }
            : {}),
        }),
      );
      await refreshRequestInput();
      return response;
    },
    setRequestUserInputTimerPaused: async (request) => {
      await rpcClient.request.setRequestUserInputTimerPaused(
        scoped({
          ...request,
          ...(request.clientSubmission
            ? { clientSubmission: serializableClientSubmission(request.clientSubmission) }
            : {}),
        }),
      );
      await refreshRequestInput();
    },
    answerRuntimeApprovalRequest: async (request) => {
      await rpcClient.request.answerRuntimeApprovalRequest(scoped(request));
      await refreshApprovals();
    },
    getAppLogs: refreshAppLogs,
    getAppLogSummary: async () => {
      backendAppLogSummary = requireStateReadModel(
        await rpcClient.request.fetchStateReadModel({
          kind: "appLogSummary",
          workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        }),
        "appLogSummary",
      ).value;
      appLogSummary = summarizeRendererAppLogs(
        backendAppLogSummary,
        rendererTelemetryEntries,
        rendererAppLogSeenSeq,
      );
      emit();
      return structuredClone(appLogSummary);
    },
    markAppLogsSeen: async (throughSeq) => {
      if (throughSeq <= appLogSummary.seenSeq) {
        return structuredClone(appLogSummary);
      }
      rendererAppLogSeenSeq = Math.max(rendererAppLogSeenSeq, throughSeq);
      if (throughSeq > backendAppLogSummary.seenSeq) {
        const backendThroughSeq = Math.min(throughSeq, backendAppLogSummary.latestSeq);
        if (backendThroughSeq > backendAppLogSummary.seenSeq) {
          await rpcClient.request.stateAppLogsMarkRead({
            workspaceId: workspaceInfo.workspaceId as WorkspaceId,
            entryIds: [`app-log-${backendThroughSeq}` as AppLogEntryId],
            readAt: new Date().toISOString() as typeof IsoDateTimeStringSchema.Type,
            clientSubmission: {
              clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
              source: "desktop" as RuntimeClientSubmissionSource,
            },
          });
          backendAppLogSummary = requireStateReadModel(
            await rpcClient.request.fetchStateReadModel({
              kind: "appLogSummary",
              workspaceId: workspaceInfo.workspaceId as WorkspaceId,
            }),
            "appLogSummary",
          ).value;
        }
      }
      appLogSummary = summarizeRendererAppLogs(
        backendAppLogSummary,
        rendererTelemetryEntries,
        rendererAppLogSeenSeq,
      );
      const cache = workspaceReadModelCache(workspaceInfo.workspaceId);
      if (cache.appLogs) {
        cache.appLogs = {
          ...cache.appLogs,
          summary: appLogSummary,
        };
      }
      emit();
      return structuredClone(appLogSummary);
    },
    recordRendererTelemetry,
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
      await rpcClient.request.stateAppPreferencesUpdate({
        patch: appPreferencesStateCommandPatch(preferences),
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      const nextPreferences = await refreshAppPreferences();
      void refreshAgentModelChoices().catch(() => undefined);
      void refreshExtensionsInventory().catch(() => undefined);
      void refreshExternalInstructionSources().catch(() => undefined);
      return nextPreferences;
    },
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
    getGeneratedAgentContextExternalSources: refreshExternalInstructionSources,
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
    setSnippetEnabled: async (input) => {
      await rpcClient.request.setSnippetEnabled(scoped(input));
      void refreshSnippets().catch(() => undefined);
    },
    openSnippetExternalSourceInEditor: async (path) => {
      const result = await rpcClient.request.openSnippetExternalSourceInEditor(scoped({ path }));
      return result.opened;
    },
  };

  return runtime;
}
