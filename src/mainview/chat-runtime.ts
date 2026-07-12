import type {
  RendererTranscriptAssistantEntry,
  RendererTranscriptImageContent,
  RendererTranscriptEntry,
  RendererTranscriptTextContent,
} from "../shared/renderer-transcript";
import type {
  AbsolutePath,
  AppLogEntryId,
  AttachmentDisplayName,
  Base64String,
  CommandId,
  CreateWorkflowAgentSourceInput,
  DeleteWorkflowAgentSourceInput,
  DuplicateWorkflowAgentSourceInput,
  ExtensionUsageState,
  IsoDateTimeStringSchema,
  JsonValue,
  MimeType,
  ModelInfo,
  OpenExtensionSourceEditInput,
  RuntimeClientRequestId,
  RuntimeClientSubmissionSource,
  RuntimeAttachmentId,
  RuntimeSubmittedAttachment,
  RuntimeSurfaceTarget,
  RuntimeTranscriptAssistantMessage,
  RuntimeTranscriptMessage,
  SaveExtensionSourceEditInput,
  SetRequestInputBlockingTimeoutInput,
  SetRequestInputVariantInput,
  SnippetId,
  SourceEditSaveResult,
  SourceEditSession,
  ThreadId,
  WorkflowTaskAttemptId,
  WorkflowAgentSourceDeleteResult,
  WorkflowAgentSourceLifecycleResult,
  SurfaceStreamPatchInput,
  WorkspaceId,
  WorkspacePaneId,
  WorkspaceSessionId,
  WorkspaceRelativePath,
} from "@svvy/core";
import {
  composerAttachmentPromptText,
  serializeComposerAttachmentTextSignature,
  type AppLogEntry,
  type AppLogLevel,
  type AppLogQuery,
  type AppLogReadModel,
  type AppLogSource,
  type AppLogSummary,
  type AppLogUpdateMessage,
  type ConversationTurnTiming,
  type ComposerAttachment,
  type ComposerDraft,
  type CreateSessionRequest,
  type EditCommittedUserMessageRequest,
  type PromptTarget,
  type PromptHistoryReadModel,
  type PromptClientSubmissionMetadata,
  type QueuedSurfaceMessage,
  type RendererTelemetryRequest,
  type SurfaceComposerReadModel,
  type SurfaceQueuedMessagesReadModel,
  type SurfaceSummaryReadModel,
  type SurfaceTranscriptReadModel,
  type WorkspaceBranchInfo,
  type CommandInspectorReadModel,
  type WorkspacePathIndexEntry,
  type SvvyUserMessage,
  type WorkspaceHandlerThreadSummary,
  type WorkspaceHandlerThreadInspector,
  type WorkspaceArtifactPreview,
  type AnswerRuntimeApprovalRequest,
  type RequestUserInputAnswerRequest,
  type SetRequestUserInputTimerPausedRequest,
  type WorkspaceSessionNavigationReadModel,
  type WorkspaceScoped,
  type WorkspaceRequestUserInputRequest,
  type WorkspaceRuntimeApprovalRequest,
  type WorkspaceSessionSummary,
  type WorkspaceWorkflowTaskAttemptInspector,
  type WorkflowsGeneratedReadModel,
  type WorkspacePaneSurfaceTarget,
  type WorkspaceInfoResponse,
  type WorkspaceChromeReadModel,
  type WorkspaceLayoutReadModel,
  type WorkspaceLayoutSlotReadModel,
  type WorkspacePaneRecord,
  type AgentContextPreviewRequest,
  type AgentContextPreviewResponse,
  type AgentsReadModel,
  type AppPreferencesReadModel,
  type SettingsReadModel,
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
  type SetExtensionDefaultUsageRequest,
  type SetExtensionEnvOverrideRequest,
  type SetExtensionEnvSecretRequest,
  type SetExtensionTypescriptApiRequest,
  type StateReadModelBaseline,
  type StateReadModelResult,
  type StateSnippetsReadModel,
  type UpdateExtensionInstructionFileRequest,
  type WriteCommandStdinRequest,
  type WriteCommandStdinResponse,
} from "../shared/workspace-contract";
import type {
  DeleteOrchestratorProfileCommandInput,
  OrchestratorAgentProfileInput,
  PromoteProfileExtensionDefaultCommandInput,
  ReorderOrchestratorProfilesCommandInput,
  ResetActorExtensionDefaultsCommandInput,
  SaveWorkspaceLayoutSlotCommandInput,
  SetExternalInstructionActorUsageCommandInput,
  SetProfileExtensionUsageCommandInput,
  ThreadHandlerProfileInput,
  UpdateAppPreferencesCommandInput,
} from "@svvy/state";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";
import type {
  ComposerSnippetMention,
  CreateManagedSnippetRequest,
  SentSnippetProvenance,
  SetSnippetEnabledRequest,
  SnippetRecord,
  SnippetsReadModel,
  UpdateManagedSnippetRequest,
} from "../shared/snippets";
import {
  type AppPreferences,
  DEFAULT_AGENT_SETTINGS_STATE,
  type ReasoningEffort,
  type AgentProfileId,
} from "../shared/agent-settings";
import {
  addDockviewPanel,
  bindPane,
  closePane,
  createEmptyPaneLayout,
  createPanelChrome,
  createPanelFallbackChrome,
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
  workspaceChrome: WorkspaceChromeReadModel | null;
  appPreferences: AppPreferences | null;
  settings: SettingsReadModel | null;
  agents: AgentsReadModel | null;
  workflowsGenerated: WorkflowsGeneratedReadModel | null;
  modelMetadata: readonly ModelInfo[] | null;
  providerAuths: ProviderAuthInfo[] | null;
};

type WorkspaceReadModelCache = {
  appLogs: AppLogReadModel | null;
  extensionsInventory: ExtensionsInventoryReadModel | null;
  externalInstructionSources: GeneratedAgentContextExternalSource[] | null;
  promptHistory: PromptHistoryReadModel | null;
  snippets: SnippetsReadModel | null;
};

const appReadModelCache: AppReadModelCache = {
  appLogs: null,
  workspaceChrome: null,
  appPreferences: null,
  settings: null,
  agents: null,
  workflowsGenerated: null,
  modelMetadata: null,
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
    promptHistory: null,
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

function surfaceReadModelBundle(
  results: readonly StateReadModelResult[],
  surfacePiSessionId: string,
): SurfaceReadModelBundle | null {
  const transcript = results.find(
    (result): result is Extract<StateReadModelResult, { kind: "surfaceTranscript" }> =>
      result.kind === "surfaceTranscript" &&
      result.value.target.surfacePiSessionId === surfacePiSessionId,
  )?.value;
  const summary = results.find(
    (result): result is Extract<StateReadModelResult, { kind: "surfaceSummary" }> =>
      result.kind === "surfaceSummary" &&
      result.value.target.surfacePiSessionId === surfacePiSessionId,
  )?.value;
  const composer = results.find(
    (result): result is Extract<StateReadModelResult, { kind: "surfaceComposer" }> =>
      result.kind === "surfaceComposer" &&
      result.value.target.surfacePiSessionId === surfacePiSessionId,
  )?.value;
  const queuedMessages = results.find(
    (result): result is Extract<StateReadModelResult, { kind: "surfaceQueuedMessages" }> =>
      result.kind === "surfaceQueuedMessages" &&
      result.value.target.surfacePiSessionId === surfacePiSessionId,
  )?.value;
  return transcript && summary && composer && queuedMessages
    ? { transcript, summary, composer, queuedMessages }
    : null;
}

function snippetsFromStateReadModel(readModel: StateSnippetsReadModel): SnippetsReadModel {
  return {
    snippets: readModel.snippets.map((record): SnippetRecord => {
      const common = {
        id: record.id,
        title: record.title,
        body: record.body,
        metadata: structuredClone(record.metadata),
        enabled: record.enabled,
      };
      if (record.source === "svvy") {
        if (record.path !== null) {
          throw new Error(`Managed snippet ${record.id} unexpectedly has an external source path.`);
        }
        return { ...common, source: "svvy" };
      }
      if (record.path === null) {
        throw new Error(`Discovered snippet ${record.id} is missing its external source path.`);
      }
      return { ...common, source: record.source, path: record.path };
    }),
  };
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

function buildUserMessage(input: ComposerPromptSubmission): SvvyUserMessage {
  const text = input.text.trim();
  const content: Array<RendererTranscriptTextContent | RendererTranscriptImageContent> = [];
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
type PromptStatus = "idle" | "streaming";

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
  view: RendererSurfaceViewState;
  target: PromptTarget;
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
  setModel: (model: RendererSurfaceModel) => void;
  setThinkingLevel: (level: ReasoningEffort) => void;
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
  applyReadModels: (readModels: SurfaceReadModelBundle) => void;
  applyStreamPatch: (patch: SurfaceStreamPatchInput) => void;
  discardStreamOverlay: () => void;
  setSurfaceSubscription: (unsubscribe: () => void) => void;
  dispose: () => void;
}

export interface RendererSurfaceModel {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  input: readonly ("text" | "image")[];
}

export interface RendererSurfaceViewState {
  sessionId: string;
  messages: RendererTranscriptEntry[];
  model: RendererSurfaceModel;
  thinkingLevel: ReasoningEffort;
  isStreaming: boolean;
  streamMessage: RendererTranscriptAssistantEntry | null;
  pendingToolCalls: Set<string>;
  error?: string;
}

interface SurfaceReadModelBundle {
  transcript: SurfaceTranscriptReadModel;
  summary: SurfaceSummaryReadModel;
  composer: SurfaceComposerReadModel;
  queuedMessages: SurfaceQueuedMessagesReadModel;
}

export interface ChatRuntimeRpcClient {
  request: {
    rendererReady: typeof rpc.request.rendererReady;
    getAgentContextPreview: typeof rpc.request.getAgentContextPreview;
    listModelMetadata: typeof rpc.request.listModelMetadata;
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
    stateExtensionEnvSetOverride: typeof rpc.request.stateExtensionEnvSetOverride;
    stateExtensionEnvRemoveOverride: typeof rpc.request.stateExtensionEnvRemoveOverride;
    getGeneratedAgentContextExternalSources: typeof rpc.request.getGeneratedAgentContextExternalSources;
    stateSnippetsCreateManaged: typeof rpc.request.stateSnippetsCreateManaged;
    stateSnippetsUpdateManaged: typeof rpc.request.stateSnippetsUpdateManaged;
    stateSnippetsDeleteManaged: typeof rpc.request.stateSnippetsDeleteManaged;
    stateSnippetsSetEnabled: typeof rpc.request.stateSnippetsSetEnabled;
    openSnippetSourceInEditor: typeof rpc.request.openSnippetSourceInEditor;
    openSourceEdit: typeof rpc.request.openSourceEdit;
    saveSourceEdit: typeof rpc.request.saveSourceEdit;
    createWorkflowAgentSource: typeof rpc.request.createWorkflowAgentSource;
    duplicateWorkflowAgentSource: typeof rpc.request.duplicateWorkflowAgentSource;
    deleteWorkflowAgentSource: typeof rpc.request.deleteWorkflowAgentSource;
    openSourceInEditor: typeof rpc.request.openSourceInEditor;
    stateAgentProfilesUpdateOrchestrator: typeof rpc.request.stateAgentProfilesUpdateOrchestrator;
    stateAgentProfilesUpdateThreadHandler: typeof rpc.request.stateAgentProfilesUpdateThreadHandler;
    stateAgentProfilesDeleteOrchestrator: typeof rpc.request.stateAgentProfilesDeleteOrchestrator;
    stateAgentProfilesReorderOrchestrators: typeof rpc.request.stateAgentProfilesReorderOrchestrators;
    stateAgentProfilesSetExtensionUsage: typeof rpc.request.stateAgentProfilesSetExtensionUsage;
    stateAgentProfilesPromoteExtensionDefault: typeof rpc.request.stateAgentProfilesPromoteExtensionDefault;
    stateAgentProfilesResetExtensionDefaults: typeof rpc.request.stateAgentProfilesResetExtensionDefaults;
    stateAgentProfilesSetExternalInstructionUsage: typeof rpc.request.stateAgentProfilesSetExternalInstructionUsage;
    stateAppPreferencesUpdate: typeof rpc.request.stateAppPreferencesUpdate;
    setRequestInputVariant: typeof rpc.request.setRequestInputVariant;
    setRequestInputBlockingTimeout: typeof rpc.request.setRequestInputBlockingTimeout;
    stateWorkspaceLayoutSaveSlot: typeof rpc.request.stateWorkspaceLayoutSaveSlot;
    listWorkspaceBranches: typeof rpc.request.listWorkspaceBranches;
    switchWorkspaceBranch: typeof rpc.request.switchWorkspaceBranch;
    writeClipboardText: typeof rpc.request.writeClipboardText;
    listWorkspacePaths: typeof rpc.request.listWorkspacePaths;
    pickWorkspaceAttachments: typeof rpc.request.pickWorkspaceAttachments;
    importComposerAttachments: typeof rpc.request.importComposerAttachments;
    openWorkspacePath: typeof rpc.request.openWorkspacePath;
    openWorkflowsGeneratedExportInEditor: typeof rpc.request.openWorkflowsGeneratedExportInEditor;
    openGeneratedAgentContextExternalSourceInEditor: typeof rpc.request.openGeneratedAgentContextExternalSourceInEditor;
    writeCommandStdin: typeof rpc.request.writeCommandStdin;
    getArtifactPreview: typeof rpc.request.getArtifactPreview;
    createOrchestratorSurface: typeof rpc.request.createOrchestratorSurface;
    openSurface: typeof rpc.request.openSurface;
    closeSurface: typeof rpc.request.closeSurface;
    renameSession: typeof rpc.request.renameSession;
    forkSession: typeof rpc.request.forkSession;
    deleteSession: typeof rpc.request.deleteSession;
    stateSessionNavigationSetPinned: typeof rpc.request.stateSessionNavigationSetPinned;
    stateSessionNavigationSetArchived: typeof rpc.request.stateSessionNavigationSetArchived;
    stateSessionNavigationMarkRead: typeof rpc.request.stateSessionNavigationMarkRead;
    stateSessionNavigationMarkUnread: typeof rpc.request.stateSessionNavigationMarkUnread;
    stateSessionNavigationSetSectionState: typeof rpc.request.stateSessionNavigationSetSectionState;
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
  workspaceInfo: WorkspaceInfoResponse;
  workspaceTabId?: string;
  initialLayoutId?: WorkspaceLayoutSlotId;
  selectWorkspaceLayoutSlot?: (layoutId: WorkspaceLayoutSlotId) => Promise<void>;
  awaitWorkspaceChromeMutations?: () => Promise<void>;
}

export interface ChatRuntime {
  workspaceId: string;
  workspaceTabId?: string;
  workspaceLabel: string;
  cwd: string;
  branch?: string;
  kind: WorkspaceInfoResponse["kind"];
  appLogSummary: AppLogSummary;
  appGlobalLogsSnapshot: AppLogReadModel | null;
  workspaceChromeSnapshot: WorkspaceChromeReadModel | null;
  appPreferencesSnapshot: AppPreferences | null;
  settingsSnapshot: SettingsReadModel | null;
  agentsSnapshot: AgentsReadModel | null;
  modelMetadataSnapshot: readonly ModelInfo[] | null;
  providerAuthsSnapshot: ProviderAuthInfo[] | null;
  extensionsInventorySnapshot: ExtensionsInventoryReadModel | null;
  externalInstructionSourcesSnapshot: GeneratedAgentContextExternalSource[] | null;
  workflowsGeneratedSnapshot: WorkflowsGeneratedReadModel | null;
  promptHistorySnapshot: PromptHistoryReadModel["entries"];
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
  switchWorkspaceLayout: (layoutId: WorkspaceLayoutSlotId) => Promise<void>;
  getCommandInspector: (
    commandId: string,
    sessionId?: string,
  ) => Promise<CommandInspectorReadModel>;
  writeCommandStdin: (request: WriteCommandStdinRequest) => Promise<WriteCommandStdinResponse>;
  listHandlerThreads: (sessionId?: string) => Promise<WorkspaceHandlerThreadSummary[]>;
  getHandlerThreadsSnapshot: (sessionId: string) => WorkspaceHandlerThreadSummary[] | undefined;
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
    request?: Omit<CreateSessionRequest, "parentSessionId">,
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
  listWorkspaceBranches: () => Promise<WorkspaceBranchInfo[]>;
  switchWorkspaceBranch: (branch: string) => Promise<void>;
  listWorkspacePaths: (options?: { refresh?: boolean }) => Promise<WorkspacePathIndexEntry[]>;
  pickWorkspaceAttachments: () => Promise<ComposerAttachment[]>;
  importComposerAttachments: (files: File[]) => Promise<ComposerAttachment[]>;
  openWorkspacePath: (workspaceRelativePath: string) => Promise<boolean>;
  getWorkflowsGenerated: () => Promise<WorkflowsGeneratedReadModel>;
  openWorkflowsGeneratedExportInEditor: (input: {
    qualifiedName: string;
    target: "source" | "generated";
  }) => Promise<boolean>;
  openGeneratedAgentContextExternalSourceInEditor: (path: string) => Promise<boolean>;
  openSourceEdit: (input: OpenExtensionSourceEditInput) => Promise<SourceEditSession>;
  saveSourceEdit: (input: SaveExtensionSourceEditInput) => Promise<SourceEditSaveResult>;
  createWorkflowAgentSource: (
    input: CreateWorkflowAgentSourceInput,
  ) => Promise<WorkflowAgentSourceLifecycleResult>;
  duplicateWorkflowAgentSource: (
    input: DuplicateWorkflowAgentSourceInput,
  ) => Promise<WorkflowAgentSourceLifecycleResult>;
  deleteWorkflowAgentSource: (
    input: DeleteWorkflowAgentSourceInput,
  ) => Promise<WorkflowAgentSourceDeleteResult>;
  openSourceInEditor: (input: OpenExtensionSourceEditInput) => Promise<boolean>;
  getGeneratedAgentContextExternalSources: () => Promise<GeneratedAgentContextExternalSource[]>;
  getAgents: () => Promise<AgentsReadModel>;
  updateOrchestratorProfile: (profile: OrchestratorAgentProfileInput) => Promise<AgentsReadModel>;
  updateThreadHandlerProfile: (profile: ThreadHandlerProfileInput) => Promise<AgentsReadModel>;
  deleteOrchestratorProfile: (
    input: Omit<DeleteOrchestratorProfileCommandInput, "clientSubmission">,
  ) => Promise<AgentsReadModel>;
  reorderOrchestratorProfiles: (
    input: Omit<ReorderOrchestratorProfilesCommandInput, "clientSubmission">,
  ) => Promise<AgentsReadModel>;
  setConfiguredProfileExtensionUsage: (
    input: Omit<SetProfileExtensionUsageCommandInput, "clientSubmission">,
  ) => Promise<AgentsReadModel>;
  promoteConfiguredProfileExtensionDefault: (
    input: Omit<PromoteProfileExtensionDefaultCommandInput, "clientSubmission">,
  ) => Promise<AgentsReadModel>;
  resetConfiguredActorExtensionDefaults: (
    input: Omit<ResetActorExtensionDefaultsCommandInput, "clientSubmission">,
  ) => Promise<AgentsReadModel>;
  setConfiguredExternalInstructionUsage: (
    input: Omit<SetExternalInstructionActorUsageCommandInput, "clientSubmission">,
  ) => Promise<AgentsReadModel>;
  getAgentContextPreview: (
    request?: AgentContextPreviewRequest,
  ) => Promise<AgentContextPreviewResponse>;
  listModelMetadata: () => Promise<readonly ModelInfo[]>;
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
  getSettings: () => Promise<SettingsReadModel>;
  setRequestInputVariant: (input: SetRequestInputVariantInput) => Promise<SettingsReadModel>;
  setRequestInputBlockingTimeout: (
    input: SetRequestInputBlockingTimeoutInput,
  ) => Promise<SettingsReadModel>;
  getSnippets: () => Promise<SnippetsReadModel>;
  createManagedSnippet: (input: CreateManagedSnippetRequest) => Promise<SnippetId>;
  updateManagedSnippet: (input: UpdateManagedSnippetRequest) => Promise<void>;
  deleteManagedSnippet: (snippetId: string) => Promise<void>;
  setSnippetEnabled: (input: SetSnippetEnabledRequest) => Promise<void>;
  openSnippetSourceInEditor: (snippetId: string) => Promise<boolean>;
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

function paneTargetFromState(target: WorkspacePaneRecord["target"]): WorkspacePaneSurfaceTarget {
  return structuredClone(target) as WorkspacePaneSurfaceTarget;
}

function rendererLayoutFromStateSlot(
  slot: WorkspaceLayoutSlotReadModel,
): WorkspaceDockviewLayoutState {
  return normalizePaneLayout(
    {
      dockview: structuredClone(slot.dockviewJson) as WorkspaceDockviewLayoutState["dockview"],
      panels: slot.panes.map((pane) => {
        const binding = paneTargetFromState(pane.target);
        const readyChrome = createPanelChrome(binding);
        const unavailableFallbackChrome =
          pane.restore.kind === "unavailable" ? pane.fallbackChrome : null;
        if (pane.restore.kind === "unavailable" && !unavailableFallbackChrome) {
          throw new Error(`Unavailable workspace pane ${pane.paneId} has no fallback chrome.`);
        }
        return {
          panelId: pane.paneId,
          binding,
          localState: structuredClone(pane.localState),
          chrome:
            pane.restore.kind === "ready"
              ? readyChrome
              : {
                  title: "Surface unavailable",
                  subtitle: unavailableFallbackChrome!.title,
                  icon: null,
                  kind: "unavailable" as const,
                  closable: true,
                  floatable: true,
                  popoutable: false,
                },
          fallbackChrome:
            pane.restore.kind === "ready" ? null : structuredClone(unavailableFallbackChrome),
          placement: structuredClone(pane.placement) as DockviewPanelPlacementState | null,
          restore:
            pane.restore.kind === "ready"
              ? { unavailableReason: null, lastKnownLocationLabel: null }
              : {
                  unavailableReason: pane.restore.reason,
                  lastKnownLocationLabel: pane.restore.lastKnownLocationLabel,
                },
        };
      }),
      compactSurfaces: slot.compactSurfaces.map((surface) => ({
        kind: surface.kind,
        workspaceSessionId: surface.workspaceSessionId,
        threadId: surface.threadId,
        panelId: surface.panelId,
        density: surface.density,
      })),
      focusedPanelId: slot.focusedPaneId,
      updatedAt: slot.updatedAt,
    },
    slot.updatedAt,
  );
}

function rendererLayoutsFromState(
  readModel: WorkspaceLayoutReadModel,
): Record<WorkspaceLayoutSlotId, WorkspaceDockviewLayoutState> {
  return Object.fromEntries(
    WORKSPACE_LAYOUT_SLOT_IDS.map((layoutId) => {
      const slot = readModel.slots.find((candidate) => candidate.layoutId === layoutId);
      if (!slot) {
        throw new Error(`Workspace layout is missing required slot ${layoutId}.`);
      }
      return [layoutId, rendererLayoutFromStateSlot(slot)];
    }),
  ) as Record<WorkspaceLayoutSlotId, WorkspaceDockviewLayoutState>;
}

function stateLayoutSlotInput(
  workspaceId: WorkspaceId,
  layoutId: WorkspaceLayoutSlotId,
  layout: WorkspaceDockviewLayoutState,
): SaveWorkspaceLayoutSlotCommandInput {
  const panes = layout.panels.map((panel): WorkspacePaneRecord => {
    if (!panel.binding) {
      throw new Error(`Workspace pane ${panel.panelId} has no durable target.`);
    }
    const target = structuredClone(panel.binding) as WorkspacePaneRecord["target"];
    const restoreReason = panel.restore?.unavailableReason?.trim() ?? "";
    if (!restoreReason) {
      return {
        paneId: panel.panelId as WorkspacePaneId,
        target,
        localState: structuredClone(panel.localState),
        fallbackChrome: null,
        placement: structuredClone(panel.placement ?? null) as WorkspacePaneRecord["placement"],
        restore: { kind: "ready" },
      };
    }
    const fallbackChrome = panel.fallbackChrome ?? createPanelFallbackChrome(panel.binding);
    return {
      paneId: panel.panelId as WorkspacePaneId,
      target,
      localState: structuredClone(panel.localState),
      fallbackChrome: structuredClone(fallbackChrome),
      placement: structuredClone(panel.placement ?? null) as WorkspacePaneRecord["placement"],
      restore: {
        kind: "unavailable",
        reason: restoreReason,
        lastKnownLocationLabel: panel.restore?.lastKnownLocationLabel?.trim() || null,
      },
    };
  });

  return {
    workspaceId,
    layoutId,
    dockviewJson: structuredClone(layout.dockview) as JsonValue | null,
    panes,
    compactSurfaces: layout.compactSurfaces.map((surface) => ({
      kind: surface.kind,
      workspaceSessionId: surface.workspaceSessionId as WorkspaceSessionId,
      threadId: surface.threadId as ThreadId,
      panelId: surface.panelId as WorkspacePaneId | null,
      density: surface.density,
    })),
    focusedPaneId: layout.focusedPanelId as WorkspacePaneId | null,
    clientSubmission: {
      clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
      source: "desktop" as RuntimeClientSubmissionSource,
    },
  };
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
    target.surface === "snippets" ||
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

function runtimeAttachmentToComposerAttachment(
  attachment: RuntimeSubmittedAttachment,
  fallbackId: string,
): ComposerAttachment {
  const name = attachment.name ?? attachment.workspaceRelativePath ?? attachment.path ?? fallbackId;
  return {
    id: attachment.id ?? fallbackId,
    kind: attachment.kind,
    name,
    path: attachment.path ?? attachment.workspaceRelativePath ?? name,
    ...(attachment.workspaceRelativePath
      ? { workspaceRelativePath: attachment.workspaceRelativePath }
      : {}),
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.sizeBytes !== undefined ? { sizeBytes: attachment.sizeBytes } : {}),
    ...(attachment.kind === "image" && attachment.dataBase64
      ? { dataBase64: attachment.dataBase64 }
      : {}),
  };
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: argumentsJson };
  }
}

function transcriptAssistantToDisplayMessage(
  message: RuntimeTranscriptAssistantMessage,
): RendererTranscriptAssistantEntry {
  return {
    role: "assistant",
    content: message.content.map((block) => {
      if (block.kind === "text") return { type: "text" as const, text: block.text };
      if (block.kind === "thinking") {
        return {
          type: "thinking" as const,
          thinking: block.thinking,
          ...(block.redacted !== undefined ? { redacted: block.redacted } : {}),
          ...(block.thinkingSignature ? { thinkingSignature: block.thinkingSignature } : {}),
        };
      }
      return {
        type: "tool-call" as const,
        id: block.toolCallId,
        name: block.toolName,
        arguments: parseToolArguments(block.argumentsJson),
        ...(block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
        ...(block.commandId ? { commandId: block.commandId } : {}),
      };
    }),
    api: message.api ?? `${message.providerId}-responses`,
    provider: message.providerId,
    model: message.modelId,
    timestamp: Date.parse(message.messageTimestamp ?? message.startedAt),
    usage: message.usage ?? ZERO_USAGE,
    stopReason: message.stopReason ?? (message.status === "failed" ? "error" : "stop"),
    ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
    messageId: message.messageId,
    turnId: message.turnId,
  } as RendererTranscriptAssistantEntry;
}

function transcriptMessageToDisplayMessage(
  message: RuntimeTranscriptMessage,
): RendererTranscriptEntry {
  if (message.role === "assistant") return transcriptAssistantToDisplayMessage(message);
  const attachments = (message.message.attachments ?? []).map((attachment, index) =>
    runtimeAttachmentToComposerAttachment(attachment, `${message.messageId}-${index}`),
  );
  return {
    ...buildUserMessage({
      text: message.message.text,
      attachments,
      snippetProvenance: message.message.snippetProvenance
        ? message.message.snippetProvenance.map(serializableSnippetProvenance)
        : [],
    }),
    timestamp: Date.parse(message.committedAt),
    messageId: message.messageId,
    turnId: message.turnId,
  } as unknown as RendererTranscriptEntry;
}

function displayUserMessageText(message: RendererTranscriptEntry): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((block) => block.type === "text" && !block.textSignature)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n\n")
    .trim();
}

function pendingToolCallsFromTranscript(
  message: RuntimeTranscriptAssistantMessage | null,
): Set<string> {
  return new Set(
    message?.content.flatMap((block) =>
      block.kind === "tool-call" && block.argumentsStatus === "streaming" ? [block.toolCallId] : [],
    ) ?? [],
  );
}

function reasoningEffortFromReadModel(value: string): ReasoningEffort {
  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : "off";
}

function rendererSurfaceModel(
  summary: SurfaceSummaryReadModel,
  metadata: readonly ModelInfo[] | null,
): RendererSurfaceModel {
  const model = metadata?.find(
    (candidate) => candidate.providerId === summary.provider && candidate.modelId === summary.model,
  );
  return {
    provider: summary.provider,
    id: summary.model,
    name: model?.displayName ?? summary.model,
    ...(model?.contextWindow ? { contextWindow: model.contextWindow } : {}),
    input: model?.inputModalities ?? ["text"],
  };
}

function streamMessageWithContent(
  message: RendererTranscriptAssistantEntry,
  contentIndex: number,
  block: RendererTranscriptAssistantEntry["content"][number],
): RendererTranscriptAssistantEntry {
  const content = [...message.content];
  while (content.length <= contentIndex) content.push({ type: "text", text: "" });
  content[contentIndex] = block;
  return { ...message, content };
}

class SurfaceControllerImpl implements ChatSurfaceControllerInternal {
  view: RendererSurfaceViewState;
  target: PromptTarget;
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
  private unsubscribeSurface: (() => void) | null = null;
  private draftSyncChain: Promise<void> = Promise.resolve();
  private draftPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private draftPersistenceGeneration = 0;
  private rendererOwnsDraft = false;
  private optimisticUserMessage: RendererTranscriptEntry | null = null;

  constructor(
    readModels: SurfaceReadModelBundle,
    private readonly rpcClient: ChatRuntimeRpcClient,
    private readonly workspaceId: string,
    private readonly resolveModel: (summary: SurfaceSummaryReadModel) => RendererSurfaceModel,
    private readonly awaitPromptRoutingReady: (
      panelId: string,
      surfacePiSessionId: string,
    ) => Promise<void>,
  ) {
    this.target = normalizePromptTarget(readModels.transcript.target as PromptTarget);
    this.view = {
      sessionId: this.target.surfacePiSessionId,
      messages: [],
      model: this.resolveModel(readModels.summary),
      thinkingLevel: "off",
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set(),
    };
    this.agentProfileId = readModels.summary.agentProfileId as AgentProfileId;
    this.promptStatus = "idle";
    this.activeTurnId = null;
    this.activeTurnStartedAt = null;
    this.applyReadModels(readModels);
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

  setSurfaceSubscription(unsubscribe: () => void): void {
    this.unsubscribeSurface?.();
    this.unsubscribeSurface = unsubscribe;
  }

  applyReadModels(readModels: SurfaceReadModelBundle): void {
    if (this.disposed) return;
    const transcript = readModels.transcript;
    const summary = readModels.summary;
    this.target = normalizePromptTarget(transcript.target as PromptTarget);
    this.loadedExtensionIds = [...summary.loadedExtensionIds];
    this.availableExtensionIds = [...summary.availableExtensionIds];
    this.agentProfileId = summary.agentProfileId as AgentProfileId;
    const readModelStreaming = summary.status === "running" || summary.status === "waiting";
    this.promptStatus = readModelStreaming || this.promptDispatchInFlight ? "streaming" : "idle";
    this.activeTurnId = this.promptDispatchInFlight ? this.activeTurnId : summary.activeTurnId;
    this.activeTurnStartedAt = this.promptDispatchInFlight
      ? this.activeTurnStartedAt
      : summary.activeTurnStartedAt;
    this.turnTimings = transcript.messages.flatMap((message) =>
      message.role === "assistant" && message.finishedAt
        ? [
            {
              turnId: message.turnId,
              assistantMessageTimestamp: message.messageTimestamp ?? message.startedAt,
              startedAt: message.startedAt,
              finishedAt: message.finishedAt,
            },
          ]
        : [],
    );
    this.queuedPrompts = structuredClone([...readModels.queuedMessages.queuedMessages]);
    if (!this.rendererOwnsDraft) {
      this.composerDraft = structuredClone(readModels.composer.draft) as ComposerDraft;
    }
    const latestFailure = transcript.messages
      .toReversed()
      .find((message) => message.role === "assistant" && message.errorMessage);
    const messages = transcript.messages.map(transcriptMessageToDisplayMessage);
    if (this.optimisticUserMessage) {
      const optimisticText = displayUserMessageText(this.optimisticUserMessage);
      if (messages.some((message) => displayUserMessageText(message) === optimisticText)) {
        this.optimisticUserMessage = null;
      } else {
        messages.push(this.optimisticUserMessage);
      }
    }
    this.view = {
      sessionId: this.target.surfacePiSessionId,
      messages,
      model: this.resolveModel(summary),
      thinkingLevel: reasoningEffortFromReadModel(summary.reasoningEffort),
      isStreaming: this.promptStatus === "streaming",
      streamMessage: transcript.activeAssistantMessage
        ? transcriptAssistantToDisplayMessage(transcript.activeAssistantMessage)
        : null,
      pendingToolCalls: pendingToolCallsFromTranscript(transcript.activeAssistantMessage),
      ...(latestFailure?.role === "assistant" && latestFailure.errorMessage
        ? { error: latestFailure.errorMessage }
        : {}),
    };
    this.emit();
  }

  applyStreamPatch(patch: SurfaceStreamPatchInput): void {
    if (this.disposed) return;
    if (patch.type === "assistant_message_started") {
      this.promptStatus = "streaming";
      this.activeTurnId = patch.turnId;
      this.activeTurnStartedAt = patch.createdAt;
      this.view.isStreaming = true;
      this.view.error = undefined;
      this.view.streamMessage = {
        role: "assistant",
        content: [],
        api: `${this.view.model.provider}-responses`,
        provider: this.view.model.provider,
        model: this.view.model.id,
        timestamp: Date.parse(patch.createdAt),
        usage: ZERO_USAGE,
        stopReason: "stop",
        messageId: patch.messageId,
        turnId: patch.turnId,
      } as RendererTranscriptAssistantEntry;
    } else if (patch.type === "assistant_text_delta" || patch.type === "assistant_thinking_delta") {
      const current = this.view.streamMessage;
      if (!current) return;
      const existing = current.content[patch.contentIndex];
      this.view.streamMessage = streamMessageWithContent(
        current,
        patch.contentIndex,
        patch.type === "assistant_text_delta"
          ? {
              type: "text",
              text: (existing?.type === "text" ? existing.text : "") + patch.delta,
            }
          : {
              type: "thinking",
              thinking: (existing?.type === "thinking" ? existing.thinking : "") + patch.delta,
            },
      );
    } else if (patch.type === "tool_arguments_snapshot") {
      const current = this.view.streamMessage;
      if (!current) return;
      const existing = current.content[patch.contentIndex];
      this.view.streamMessage = streamMessageWithContent(current, patch.contentIndex, {
        type: "tool-call",
        id: patch.toolCallId,
        name: existing?.type === "tool-call" ? existing.name : "tool",
        arguments: { snapshotRef: patch.snapshotRef },
        ...(patch.commandId ? { commandId: patch.commandId } : {}),
      } as RendererTranscriptAssistantEntry["content"][number]);
      this.view.pendingToolCalls.add(patch.toolCallId);
    } else if (patch.type === "active_command") {
      if (patch.status === "finished") this.view.pendingToolCalls.delete(patch.toolCallId);
      else this.view.pendingToolCalls.add(patch.toolCallId);
      const current = this.view.streamMessage;
      const existing = current?.content[patch.contentIndex];
      if (current && existing?.type === "tool-call") {
        this.view.streamMessage = streamMessageWithContent(current, patch.contentIndex, {
          ...existing,
          commandId: patch.commandId,
        } as RendererTranscriptAssistantEntry["content"][number]);
      }
    } else if (patch.type === "assistant_message_finished") {
      this.view.isStreaming = false;
      this.promptStatus = "idle";
      this.activeTurnId = null;
      this.activeTurnStartedAt = null;
      if (patch.status === "failed") {
        this.view.error = this.view.streamMessage?.errorMessage ?? "Assistant response failed.";
      }
      this.view.streamMessage = null;
      this.view.pendingToolCalls = new Set();
    } else if (patch.type === "prompt_status") {
      const running = patch.status === "running" || patch.status === "waiting";
      this.promptStatus = running ? "streaming" : "idle";
      this.view.isStreaming = running;
      this.activeTurnId = running ? patch.turnId : null;
      if (!running) this.activeTurnStartedAt = null;
      if (patch.status === "failed") {
        this.view.error = this.view.streamMessage?.errorMessage ?? "Assistant response failed.";
      }
    }
    this.emit();
  }

  discardStreamOverlay(): void {
    this.view.streamMessage = null;
    this.view.pendingToolCalls = new Set();
    this.view.isStreaming = false;
    this.promptStatus = "idle";
    this.activeTurnId = null;
    this.activeTurnStartedAt = null;
    this.emit();
  }

  setModel(model: RendererSurfaceModel): void {
    this.view.model = model;
    this.emit();
    void this.syncSurfaceModel(model.provider, model.id);
  }

  setThinkingLevel(level: ReasoningEffort): void {
    this.view.thinkingLevel = level;
    this.emit();
    void this.syncSurfaceThoughtLevel(level);
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
      this.view.isStreaming = false;
      this.view.streamMessage = null;
      this.view.pendingToolCalls = new Set();
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
      this.promptDispatchInFlight = true;
      this.promptStatus = "streaming";
      this.view.isStreaming = true;
      this.view.error = undefined;
      this.optimisticUserMessage = buildUserMessage(submission) as RendererTranscriptEntry;
      this.view.messages = [...this.view.messages, this.optimisticUserMessage];
      this.emit();
      await this.awaitPromptRoutingReady(requestPanelId, this.target.surfacePiSessionId);
      if (!this.panelIds.has(requestPanelId)) {
        throw new Error("Expected the prompt surface to remain attached before sending a prompt.");
      }
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
      this.view.sessionId = response.target.surfacePiSessionId;
      this.invalidatePendingDraftPersistence();
      this.rendererOwnsDraft = false;
      this.composerDraft = {
        text: "",
        attachments: [],
        snippetMentions: [],
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.promptStatus = "idle";
      this.view.isStreaming = false;
      this.view.streamMessage = null;
      this.view.error = error instanceof Error ? error.message : "Prompt submission failed.";
      if (this.optimisticUserMessage) {
        this.view.messages = this.view.messages.filter(
          (message) => message !== this.optimisticUserMessage,
        );
        this.optimisticUserMessage = null;
      }
      throw error;
    } finally {
      this.promptDispatchInFlight = false;
      this.emit();
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
        this.view.sessionId = response.target.surfacePiSessionId;
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
    this.view.isStreaming = true;
    this.view.streamMessage = null;
    this.view.error = undefined;
    this.emit();

    try {
      const response = await this.rpcClient.request.editCommittedUserMessage({
        ...request,
        workspaceId: this.workspaceId,
      });
      this.target = normalizePromptTarget(response.target);
      this.view.sessionId = response.target.surfacePiSessionId;
    } catch (error) {
      this.promptStatus = "idle";
      this.activeTurnId = null;
      this.activeTurnStartedAt = null;
      this.view.isStreaming = false;
      this.view.streamMessage = null;
      this.view.error = error instanceof Error ? error.message : "Message edit failed.";
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
    return response.text ?? null;
  }

  async deleteQueuedPrompt(promptId: string): Promise<boolean> {
    const response = await this.rpcClient.request.deleteQueuedSurfaceMessage({
      workspaceId: this.workspaceId,
      target: this.target,
      queuedMessageId: promptId,
    });
    return response.ok;
  }

  async reorderQueuedPrompt(promptId: string, beforePromptId: string | null): Promise<boolean> {
    const response = await this.rpcClient.request.reorderQueuedSurfaceMessage({
      workspaceId: this.workspaceId,
      target: this.target,
      queuedMessageId: promptId,
      beforeQueuedMessageId: beforePromptId,
    });
    return response.ok;
  }

  async steerQueuedPrompt(promptId: string): Promise<boolean> {
    const response = await this.rpcClient.request.steerQueuedSurfaceMessage({
      workspaceId: this.workspaceId,
      target: this.target,
      queuedMessageId: promptId,
    });
    return response.ok;
  }

  async setExtensionContextAutoUpdate(enabled: boolean): Promise<boolean> {
    const response = await this.rpcClient.request.setExtensionContextAutoUpdate({
      workspaceId: this.workspaceId,
      target: this.target,
      enabled,
    });
    return response.ok;
  }

  dispose(): void {
    if (this.draftPersistTimer) {
      clearTimeout(this.draftPersistTimer);
      this.draftPersistTimer = null;
      const generation = this.draftPersistenceGeneration;
      this.persistComposerDraft(this.composerDraft, generation);
    }
    this.unsubscribeSurface?.();
    this.unsubscribeSurface = null;
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
        this.view.sessionId = response.target.surfacePiSessionId;
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
        this.view.sessionId = response.target.surfacePiSessionId;
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
        this.view.sessionId = response.target.surfacePiSessionId;
        this.emit();
      }
    } catch (error) {
      console.error("Failed to sync session extension usage:", error);
    }
  }
}

type InspectorCacheKind = "command" | "handler" | "workflow-task-attempt";

function inspectorTargetKey(kind: InspectorCacheKind, id: string): string {
  return `${kind}:${id}`;
}

export async function createChatRuntime(
  options: ChatRuntimeOptions,
  rpcClient: ChatRuntimeRpcClient = DEFAULT_RPC_CLIENT,
): Promise<ChatRuntime> {
  const workspaceInfo = options.workspaceInfo;
  const listeners = new Set<ChatRuntimeListener>();
  const appLogUpdateListeners = new Set<(payload: AppLogUpdateMessage) => void>();
  const rendererCommandListeners = new Set<(command: DesktopRendererCommand) => void>();
  const surfaceControllers = new Map<string, ChatSurfaceControllerInternal>();
  let sessions: WorkspaceSessionSummary[] = [];
  let sessionNavigation: WorkspaceSessionNavigationReadModel = buildWorkspaceSessionNavigation([]);
  let sessionNavigationRefreshSequence = 0;
  let requestUserInputRequests: WorkspaceRequestUserInputRequest[] = [];
  let runtimeApprovalRequests: WorkspaceRuntimeApprovalRequest[] = [];
  const commandInspectorCache = new Map<string, CommandInspectorReadModel>();
  const commandInspectorAliases = new Map<string, string>();
  const commandInspectorKnownMissing = new Set<string>();
  const commandInspectorInFlight = new Map<string, Promise<CommandInspectorReadModel | null>>();
  const processedArtifactOpenCommandIds = new Set<string>();
  const pendingArtifactOpenInspectors = new Map<string, CommandInspectorReadModel>();
  let handleArtifactOpenInspector = (inspector: CommandInspectorReadModel): void => {
    pendingArtifactOpenInspectors.set(inspector.commandId, structuredClone(inspector));
  };
  const handlerInspectorCache = new Map<string, WorkspaceHandlerThreadInspector>();
  const handlerInspectorKnownMissing = new Set<string>();
  const handlerInspectorInFlight = new Map<
    string,
    Promise<WorkspaceHandlerThreadInspector | null>
  >();
  const workflowTaskAttemptInspectorCache = new Map<
    string,
    WorkspaceWorkflowTaskAttemptInspector
  >();
  const workflowTaskAttemptInspectorKnownMissing = new Set<string>();
  const workflowTaskAttemptInspectorInFlight = new Map<
    string,
    Promise<WorkspaceWorkflowTaskAttemptInspector | null>
  >();
  const inspectorAppliedEpochs = new Map<string, number>();
  let inspectorEpoch = 0;
  let inspectorGeneration = 0;
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
  let layoutSlotInitialized: Record<WorkspaceLayoutSlotId, boolean> = {
    A: false,
    B: false,
    C: false,
  };
  let layoutHydrationSequence = 0;
  let layoutLocalGenerations: Record<WorkspaceLayoutSlotId, number> = { A: 0, B: 0, C: 0 };
  let layoutAcknowledgedGenerations: Record<WorkspaceLayoutSlotId, number> = {
    A: 0,
    B: 0,
    C: 0,
  };
  const pendingLayoutSaves = new Map<
    WorkspaceLayoutSlotId,
    { generation: number; input: SaveWorkspaceLayoutSlotCommandInput; attempt: number }
  >();
  const inFlightLayoutSaves = new Map<WorkspaceLayoutSlotId, number>();
  const layoutSaveWaiters = new Map<
    WorkspaceLayoutSlotId,
    Array<{ generation: number; resolve: () => void; reject: (error: unknown) => void }>
  >();
  const promptPaneBindingBarriers = new Map<string, Promise<void>>();
  let layoutApplicationTail: Promise<void> = Promise.resolve();
  let layoutTransitionTail: Promise<void> = Promise.resolve();
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

  const applySessionNavigation = (next: WorkspaceSessionNavigationReadModel): void => {
    sessionNavigation = structuredClone(next);
    sessions = structuredClone([
      ...next.pinnedSessions,
      ...next.activeSessions,
      ...next.archived.sessions,
    ]);
  };
  const runtimeCacheEmitter = { workspaceId: workspaceInfo.workspaceId, emit };
  activeRuntimeEmitters.add(runtimeCacheEmitter);

  const scoped = <T extends object>(request?: T): T & { workspaceId: string } => ({
    ...(request ?? ({} as T)),
    workspaceId: workspaceInfo.workspaceId,
  });

  const fetchSurfaceReadModels = async (target: PromptTarget): Promise<SurfaceReadModelBundle> => {
    const runtimeTarget = target as RuntimeSurfaceTarget;
    const results = await rpcClient.request.refetchStateReadModels({
      requests: [
        { kind: "surfaceTranscript", target: runtimeTarget },
        { kind: "surfaceSummary", target: runtimeTarget },
        { kind: "surfaceComposer", target: runtimeTarget },
        { kind: "surfaceQueuedMessages", target: runtimeTarget },
      ],
    });
    const readModels = surfaceReadModelBundle(results, target.surfacePiSessionId);
    if (!readModels) {
      throw new Error(
        `Expected all surface read models for ${target.surfacePiSessionId}; received ${results
          .map((result) => result.kind)
          .join(", ")}.`,
      );
    }
    return readModels;
  };

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

  const refreshAppPreferences = async (): Promise<AppPreferences> =>
    setAppCache(
      "appPreferences",
      appPreferencesFromStateReadModel(
        requireStateReadModel(
          await rpcClient.request.fetchStateReadModel({ kind: "appPreferences" }),
          "appPreferences",
        ).value,
        appReadModelCache.appPreferences ?? DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
      ),
    )!;

  const refreshSettings = async (): Promise<SettingsReadModel> => {
    const result = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({ kind: "settings" }),
      "settings",
    );
    setAppCache(
      "appPreferences",
      appPreferencesFromStateReadModel(
        result.value.preferences,
        appReadModelCache.appPreferences ?? DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
      ),
    );
    return setAppCache("settings", result.value)!;
  };

  const refreshAgents = async (): Promise<AgentsReadModel> => {
    const result = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({ kind: "agents" }),
      "agents",
    );
    return setAppCache("agents", result.value)!;
  };

  const refreshModelMetadata = async (): Promise<readonly ModelInfo[]> =>
    setAppCache(
      "modelMetadata",
      await rpcClient.request.listModelMetadata({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
      }),
    )!;

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

  const refreshWorkflowsGenerated = async (): Promise<WorkflowsGeneratedReadModel> => {
    const result = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({ kind: "workflowsGenerated" }),
      "workflowsGenerated",
    );
    return setAppCache("workflowsGenerated", result.value)!;
  };

  const refreshSnippets = async (): Promise<SnippetsReadModel> => {
    const result = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({
        kind: "snippets",
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
      }),
      "snippets",
    );
    return setWorkspaceCache("snippets", snippetsFromStateReadModel(result.value))!;
  };

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
    void refreshAppPreferences().catch(() => undefined);
    void refreshSettings().catch(() => undefined);
    void refreshAgents().catch(() => undefined);
    void refreshModelMetadata().catch(() => undefined);
    void refreshProviderAuths().catch(() => undefined);
    void refreshExtensionsInventory().catch(() => undefined);
    void refreshExternalInstructionSources().catch(() => undefined);
    void refreshWorkflowsGenerated().catch(() => undefined);
    void refreshSnippets().catch(() => undefined);
    void refreshAppLogs({ limit: 600 }).catch(() => undefined);
  };

  const markInspectorTargetsApplied = (kind: InspectorCacheKind, ids: readonly string[]): void => {
    inspectorEpoch += 1;
    for (const id of ids) {
      inspectorAppliedEpochs.set(inspectorTargetKey(kind, id), inspectorEpoch);
    }
  };

  const inspectorTargetChangedAfter = (
    kind: InspectorCacheKind,
    ids: readonly string[],
    epoch: number,
  ): boolean =>
    ids.some((id) => (inspectorAppliedEpochs.get(inspectorTargetKey(kind, id)) ?? 0) > epoch);

  const getCachedCommandInspector = (commandId: string): CommandInspectorReadModel | null => {
    const canonicalId = commandInspectorAliases.get(commandId) ?? commandId;
    const inspector = commandInspectorCache.get(canonicalId) ?? null;
    return inspector ? structuredClone(inspector) : null;
  };

  const applyCommandInspectorCache = (
    inspector: CommandInspectorReadModel | null,
    requestedIds: readonly string[],
    markApplied: boolean,
  ): CommandInspectorReadModel | null => {
    const projected = inspector ? structuredClone(inspector) : null;
    const canonicalId = projected?.commandId ?? null;
    const appliedIds = [...requestedIds, ...(canonicalId ? [canonicalId] : [])];
    if (markApplied && appliedIds.length > 0) {
      markInspectorTargetsApplied("command", appliedIds);
    }
    if (!projected || !canonicalId) {
      for (const requestedId of requestedIds) {
        const missingCanonicalId = commandInspectorAliases.get(requestedId) ?? requestedId;
        commandInspectorKnownMissing.add(requestedId);
        commandInspectorKnownMissing.add(missingCanonicalId);
        commandInspectorCache.delete(missingCanonicalId);
        for (const [alias, target] of commandInspectorAliases) {
          if (alias === requestedId || target === missingCanonicalId) {
            commandInspectorAliases.delete(alias);
          }
        }
      }
      return null;
    }
    commandInspectorKnownMissing.delete(canonicalId);
    commandInspectorCache.set(canonicalId, structuredClone(projected));
    commandInspectorAliases.set(canonicalId, canonicalId);
    for (const requestedId of requestedIds) {
      commandInspectorKnownMissing.delete(requestedId);
      commandInspectorAliases.set(requestedId, canonicalId);
    }
    return structuredClone(projected);
  };

  const applyHandlerInspectorCache = (
    inspector: WorkspaceHandlerThreadInspector | null,
    requestedId: string,
    markApplied: boolean,
  ): WorkspaceHandlerThreadInspector | null => {
    const canonicalId = inspector?.threadId ?? requestedId;
    if (markApplied) {
      markInspectorTargetsApplied("handler", [requestedId, canonicalId]);
    }
    if (!inspector) {
      handlerInspectorKnownMissing.add(requestedId);
      handlerInspectorCache.delete(requestedId);
      return null;
    }
    handlerInspectorKnownMissing.delete(requestedId);
    handlerInspectorKnownMissing.delete(canonicalId);
    handlerInspectorCache.set(canonicalId, structuredClone(inspector));
    return structuredClone(inspector);
  };

  const applyWorkflowTaskAttemptInspectorCache = (
    inspector: WorkspaceWorkflowTaskAttemptInspector | null,
    requestedId: string,
    markApplied: boolean,
  ): WorkspaceWorkflowTaskAttemptInspector | null => {
    const canonicalId = inspector?.workflowTaskAttemptId ?? requestedId;
    if (markApplied) {
      markInspectorTargetsApplied("workflow-task-attempt", [requestedId, canonicalId]);
    }
    if (!inspector) {
      workflowTaskAttemptInspectorKnownMissing.add(requestedId);
      workflowTaskAttemptInspectorCache.delete(requestedId);
      return null;
    }
    workflowTaskAttemptInspectorKnownMissing.delete(requestedId);
    workflowTaskAttemptInspectorKnownMissing.delete(canonicalId);
    workflowTaskAttemptInspectorCache.set(canonicalId, structuredClone(inspector));
    return structuredClone(inspector);
  };

  const loadCommandInspector = (
    commandId: string,
    force = false,
  ): Promise<CommandInspectorReadModel | null> => {
    const canonicalRequestId = commandInspectorAliases.get(commandId) ?? commandId;
    if (!force) {
      const cached = getCachedCommandInspector(canonicalRequestId);
      if (cached || commandInspectorKnownMissing.has(canonicalRequestId)) {
        return Promise.resolve(cached);
      }
    }
    const existing = commandInspectorInFlight.get(canonicalRequestId);
    if (existing) return existing.then((value) => (value ? structuredClone(value) : null));
    const requestedGeneration = inspectorGeneration;
    const requestedEpoch = inspectorEpoch;
    let request!: Promise<CommandInspectorReadModel | null>;
    request = (async () => {
      const result = requireStateReadModel(
        await rpcClient.request.fetchStateReadModel({
          kind: "commandInspector",
          workspaceId: workspaceInfo.workspaceId as WorkspaceId,
          commandId: canonicalRequestId as CommandId,
        }),
        "commandInspector",
      );
      const returnedId = result.value?.commandId ?? canonicalRequestId;
      if (
        requestedGeneration !== inspectorGeneration ||
        inspectorTargetChangedAfter(
          "command",
          [commandId, canonicalRequestId, returnedId],
          requestedEpoch,
        )
      ) {
        return getCachedCommandInspector(returnedId) ?? getCachedCommandInspector(commandId);
      }
      const inspector = applyCommandInspectorCache(result.value, [commandId], false);
      emit();
      return inspector;
    })().finally(() => {
      if (commandInspectorInFlight.get(canonicalRequestId) === request) {
        commandInspectorInFlight.delete(canonicalRequestId);
      }
    });
    commandInspectorInFlight.set(canonicalRequestId, request);
    return request;
  };

  const loadHandlerInspector = (
    threadId: string,
    force = false,
  ): Promise<WorkspaceHandlerThreadInspector | null> => {
    if (!force) {
      const cached = handlerInspectorCache.get(threadId);
      if (cached || handlerInspectorKnownMissing.has(threadId)) {
        return Promise.resolve(cached ? structuredClone(cached) : null);
      }
    }
    const existing = handlerInspectorInFlight.get(threadId);
    if (existing) return existing.then((value) => (value ? structuredClone(value) : null));
    const requestedGeneration = inspectorGeneration;
    const requestedEpoch = inspectorEpoch;
    let request!: Promise<WorkspaceHandlerThreadInspector | null>;
    request = (async () => {
      const result = requireStateReadModel(
        await rpcClient.request.fetchStateReadModel({
          kind: "handlerInspector",
          workspaceId: workspaceInfo.workspaceId as WorkspaceId,
          threadId: threadId as ThreadId,
        }),
        "handlerInspector",
      );
      const returnedId = result.value?.threadId ?? threadId;
      if (
        requestedGeneration !== inspectorGeneration ||
        inspectorTargetChangedAfter("handler", [threadId, returnedId], requestedEpoch)
      ) {
        const cached = handlerInspectorCache.get(returnedId) ?? handlerInspectorCache.get(threadId);
        return cached ? structuredClone(cached) : null;
      }
      const inspector = applyHandlerInspectorCache(result.value, threadId, false);
      emit();
      return inspector;
    })().finally(() => {
      if (handlerInspectorInFlight.get(threadId) === request) {
        handlerInspectorInFlight.delete(threadId);
      }
    });
    handlerInspectorInFlight.set(threadId, request);
    return request;
  };

  const loadWorkflowTaskAttemptInspector = (
    workflowTaskAttemptId: string,
    force = false,
  ): Promise<WorkspaceWorkflowTaskAttemptInspector | null> => {
    if (!force) {
      const cached = workflowTaskAttemptInspectorCache.get(workflowTaskAttemptId);
      if (cached || workflowTaskAttemptInspectorKnownMissing.has(workflowTaskAttemptId)) {
        return Promise.resolve(cached ? structuredClone(cached) : null);
      }
    }
    const existing = workflowTaskAttemptInspectorInFlight.get(workflowTaskAttemptId);
    if (existing) return existing.then((value) => (value ? structuredClone(value) : null));
    const requestedGeneration = inspectorGeneration;
    const requestedEpoch = inspectorEpoch;
    let request!: Promise<WorkspaceWorkflowTaskAttemptInspector | null>;
    request = (async () => {
      const result = requireStateReadModel(
        await rpcClient.request.fetchStateReadModel({
          kind: "workflowTaskAttemptInspector",
          workspaceId: workspaceInfo.workspaceId as WorkspaceId,
          workflowTaskAttemptId: workflowTaskAttemptId as WorkflowTaskAttemptId,
        }),
        "workflowTaskAttemptInspector",
      );
      const returnedId = result.value?.workflowTaskAttemptId ?? workflowTaskAttemptId;
      if (
        requestedGeneration !== inspectorGeneration ||
        inspectorTargetChangedAfter(
          "workflow-task-attempt",
          [workflowTaskAttemptId, returnedId],
          requestedEpoch,
        )
      ) {
        const cached =
          workflowTaskAttemptInspectorCache.get(returnedId) ??
          workflowTaskAttemptInspectorCache.get(workflowTaskAttemptId);
        return cached ? structuredClone(cached) : null;
      }
      const inspector = applyWorkflowTaskAttemptInspectorCache(
        result.value,
        workflowTaskAttemptId,
        false,
      );
      emit();
      return inspector;
    })().finally(() => {
      if (workflowTaskAttemptInspectorInFlight.get(workflowTaskAttemptId) === request) {
        workflowTaskAttemptInspectorInFlight.delete(workflowTaskAttemptId);
      }
    });
    workflowTaskAttemptInspectorInFlight.set(workflowTaskAttemptId, request);
    return request;
  };

  const getSessionThreadIds = (sessionId: string): string[] => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    return [...(session?.threadIds ?? [])];
  };

  const getHandlerThreadsSnapshot = (
    sessionId: string,
  ): WorkspaceHandlerThreadSummary[] | undefined => {
    const threadIds = getSessionThreadIds(sessionId);
    if (
      threadIds.some(
        (threadId) =>
          !handlerInspectorCache.has(threadId) && !handlerInspectorKnownMissing.has(threadId),
      )
    ) {
      return undefined;
    }
    return threadIds
      .flatMap((threadId) => {
        const inspector = handlerInspectorCache.get(threadId);
        return inspector ? [structuredClone(inspector)] : [];
      })
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  };

  const resetInspectorCaches = (): void => {
    inspectorGeneration += 1;
    commandInspectorCache.clear();
    commandInspectorAliases.clear();
    commandInspectorKnownMissing.clear();
    commandInspectorInFlight.clear();
    handlerInspectorCache.clear();
    handlerInspectorKnownMissing.clear();
    handlerInspectorInFlight.clear();
    workflowTaskAttemptInspectorCache.clear();
    workflowTaskAttemptInspectorKnownMissing.clear();
    workflowTaskAttemptInspectorInFlight.clear();
    inspectorAppliedEpochs.clear();
  };

  const applyAppLogSideEffects = (entries: readonly AppLogEntry[]): void => {
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
        void refreshAgents().catch(() => undefined);
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
    }
  };

  const applyNotificationReadModelPatch = (
    patch: readonly StateReadModelResult[],
    context?: ApplyReadModelPatchContext,
    baselineScope?: RendererReadModelBaselineScope,
  ): void => {
    const appScopedLogs = context?.descriptor.scope === "app" || baselineScope?.kind === "app";
    const invalidation = context?.descriptor.invalidation;
    const commandInspectorIds =
      invalidation?.model === "commandInspector" ? [...invalidation.ids] : [];
    const handlerInspectorIds =
      invalidation?.model === "handlerThreadInspector" ? [...invalidation.ids] : [];
    const workflowTaskAttemptInspectorIds =
      invalidation?.model === "workflowTaskAttemptInspector" ? [...invalidation.ids] : [];
    let commandInspectorIndex = 0;
    let handlerInspectorIndex = 0;
    let workflowTaskAttemptInspectorIndex = 0;
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
              appReadModelCache.appPreferences ?? DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
            ),
          );
          break;
        case "settings":
          setAppCache("settings", result.value);
          setAppCache(
            "appPreferences",
            appPreferencesFromStateReadModel(
              result.value.preferences,
              appReadModelCache.appPreferences ?? DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
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
        case "agents":
          setAppCache("agents", result.value);
          break;
        case "workspaceChrome": {
          setAppCache("workspaceChrome", result.value);
          const workspaceTab = options.workspaceTabId
            ? result.value.tabs.find((tab) => tab.workspaceTabId === options.workspaceTabId)
            : undefined;
          if (workspaceTab && workspaceTab.activeLayoutId !== activeLayoutId) {
            void queueWorkspaceLayoutTransition(workspaceTab.activeLayoutId, {
              persistChromeSelection: false,
              persistOutgoingLayout: false,
            }).catch((error) =>
              console.error("Failed to apply authoritative workspace layout selection:", error),
            );
          }
          break;
        }
        case "workspaceLayout": {
          const changedLayoutIds =
            context?.descriptor.scope === "workspace" &&
            context.descriptor.invalidation.model === "workspaceLayout"
              ? context.descriptor.invalidation.ids
              : WORKSPACE_LAYOUT_SLOT_IDS;
          void applyWorkspaceLayoutState(result.value, changedLayoutIds);
          break;
        }
        case "sessionNavigation":
          sessionNavigationRefreshSequence += 1;
          applySessionNavigation(result.value);
          break;
        case "promptHistory":
          setWorkspaceCache("promptHistory", result.value);
          break;
        case "commandInspector": {
          const requestedId =
            commandInspectorIds[commandInspectorIndex++] ?? result.value?.commandId;
          const inspector = applyCommandInspectorCache(
            result.value,
            requestedId ? [requestedId] : [],
            Boolean(context),
          );
          if (context && inspector) {
            handleArtifactOpenInspector(inspector);
          }
          break;
        }
        case "handlerInspector": {
          const requestedId =
            handlerInspectorIds[handlerInspectorIndex++] ?? result.value?.threadId;
          if (requestedId) {
            applyHandlerInspectorCache(result.value, requestedId, Boolean(context));
          }
          break;
        }
        case "workflowTaskAttemptInspector": {
          const requestedId =
            workflowTaskAttemptInspectorIds[workflowTaskAttemptInspectorIndex++] ??
            result.value?.workflowTaskAttemptId;
          if (requestedId) {
            applyWorkflowTaskAttemptInspectorCache(result.value, requestedId, Boolean(context));
          }
          break;
        }
        case "requestInput":
          requestUserInputRequests = structuredClone([...result.value.requests]);
          break;
        case "approvals":
          runtimeApprovalRequests = structuredClone([...result.value.requests]);
          break;
        case "snippets":
          setWorkspaceCache("snippets", snippetsFromStateReadModel(result.value));
          break;
        case "workflowsGenerated":
          setAppCache("workflowsGenerated", result.value);
          break;
        case "surfaceTranscript":
        case "surfaceSummary":
        case "surfaceComposer":
        case "surfaceQueuedMessages":
          break;
      }
    }
    const surfacePiSessionIds = new Set(
      patch.flatMap((result) =>
        result.kind === "surfaceTranscript" ||
        result.kind === "surfaceSummary" ||
        result.kind === "surfaceComposer" ||
        result.kind === "surfaceQueuedMessages"
          ? [result.value.target.surfacePiSessionId]
          : [],
      ),
    );
    for (const surfacePiSessionId of surfacePiSessionIds) {
      const readModels = surfaceReadModelBundle(patch, surfacePiSessionId);
      const controller = surfaceControllers.get(surfacePiSessionId);
      if (readModels && controller) {
        controller.applyReadModels(readModels);
        syncPaneTargetForSurface(readModels.transcript.target as PromptTarget);
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
      appReadModelCache.workspaceChrome = null;
      appReadModelCache.appPreferences = null;
      appReadModelCache.agents = null;
      appReadModelCache.providerAuths = null;
      appReadModelCache.workflowsGenerated = null;
      applyNotificationReadModelPatch(baseline.app, undefined, scope);
    } else {
      const boundCommandIds = paneLayout.panels.flatMap((pane) =>
        pane.binding?.surface === "command" ? [pane.binding.commandId] : [],
      );
      const boundWorkflowTaskAttemptIds = paneLayout.panels.flatMap((pane) =>
        pane.binding?.surface === "workflow-task-attempt"
          ? [pane.binding.workflowTaskAttemptId]
          : [],
      );
      const boundSessionIds = [
        ...new Set(
          paneLayout.panels.flatMap((pane) =>
            pane.binding && "workspaceSessionId" in pane.binding
              ? [pane.binding.workspaceSessionId]
              : [],
          ),
        ),
      ].filter((sessionId): sessionId is string => typeof sessionId === "string");
      resetInspectorCaches();
      const workspaceCache = workspaceReadModelCache(workspaceInfo.workspaceId);
      workspaceCache.appLogs = null;
      workspaceCache.promptHistory = null;
      workspaceCache.snippets = null;
      sessionNavigationRefreshSequence += 1;
      applySessionNavigation(buildWorkspaceSessionNavigation([]));
      backendAppLogSummary = emptyAppLogSummary();
      appLogSummary = summarizeRendererAppLogs(
        backendAppLogSummary,
        rendererTelemetryEntries,
        rendererAppLogSeenSeq,
      );
      applyNotificationReadModelPatch([...baseline.app, ...baseline.workspaces], undefined, scope);
      queueMicrotask(() => {
        for (const commandId of boundCommandIds) {
          void loadCommandInspector(commandId, true).catch(() => undefined);
        }
        for (const workflowTaskAttemptId of boundWorkflowTaskAttemptIds) {
          void loadWorkflowTaskAttemptInspector(workflowTaskAttemptId, true).catch(() => undefined);
        }
        for (const sessionId of boundSessionIds) {
          for (const threadId of getSessionThreadIds(sessionId)) {
            void loadHandlerInspector(threadId, true).catch(() => undefined);
          }
        }
      });
    }
  };

  const currentLayoutSlots = (): WorkspaceLayoutSlotSummary[] =>
    WORKSPACE_LAYOUT_SLOT_IDS.map((id) => {
      const layout = id === activeLayoutId ? paneLayout : savedLayouts[id];
      return {
        id,
        initialized: layoutSlotInitialized[id],
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

  const isLayoutSlotLocallyDirty = (layoutId: WorkspaceLayoutSlotId): boolean =>
    layoutAcknowledgedGenerations[layoutId] < layoutLocalGenerations[layoutId];

  const settleWorkspaceLayoutSaveWaiters = (
    layoutId: WorkspaceLayoutSlotId,
    generation: number,
    error?: unknown,
  ): void => {
    const waiters = layoutSaveWaiters.get(layoutId) ?? [];
    const remaining = waiters.filter((waiter) => waiter.generation > generation);
    if (remaining.length > 0) layoutSaveWaiters.set(layoutId, remaining);
    else layoutSaveWaiters.delete(layoutId);
    for (const waiter of waiters) {
      if (waiter.generation > generation) continue;
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  };

  const awaitPendingWorkspaceLayoutSaves = (layoutId: WorkspaceLayoutSlotId): Promise<void> => {
    const generation = layoutLocalGenerations[layoutId];
    if (layoutAcknowledgedGenerations[layoutId] >= generation) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiters = layoutSaveWaiters.get(layoutId) ?? [];
      waiters.push({ generation, resolve, reject });
      layoutSaveWaiters.set(layoutId, waiters);
    });
  };

  const drainWorkspaceLayoutSaves = async (layoutId: WorkspaceLayoutSlotId): Promise<void> => {
    if (inFlightLayoutSaves.has(layoutId)) return;
    while (true) {
      const pending = pendingLayoutSaves.get(layoutId);
      if (!pending) break;
      pendingLayoutSaves.delete(layoutId);
      inFlightLayoutSaves.set(layoutId, pending.generation);
      try {
        await rpcClient.request.stateWorkspaceLayoutSaveSlot(pending.input);
        layoutAcknowledgedGenerations = {
          ...layoutAcknowledgedGenerations,
          [layoutId]: Math.max(layoutAcknowledgedGenerations[layoutId], pending.generation),
        };
      } catch (error) {
        console.error("Failed to persist workspace layout state:", error);
        if (!pendingLayoutSaves.has(layoutId) && pending.attempt === 0) {
          pendingLayoutSaves.set(layoutId, { ...pending, attempt: 1 });
        } else if (!pendingLayoutSaves.has(layoutId)) {
          layoutAcknowledgedGenerations = {
            ...layoutAcknowledgedGenerations,
            [layoutId]: Math.max(layoutAcknowledgedGenerations[layoutId], pending.generation),
          };
          settleWorkspaceLayoutSaveWaiters(layoutId, pending.generation, error);
        }
      } finally {
        inFlightLayoutSaves.delete(layoutId);
      }
    }
    const committedGeneration = layoutAcknowledgedGenerations[layoutId];
    if (disposed || isLayoutSlotLocallyDirty(layoutId)) {
      settleWorkspaceLayoutSaveWaiters(layoutId, committedGeneration);
      return;
    }
    const reconciliationGeneration = layoutLocalGenerations[layoutId];
    try {
      const result = requireStateReadModel(
        await rpcClient.request.fetchStateReadModel({
          kind: "workspaceLayout",
          workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        }),
        "workspaceLayout",
      );
      if (
        disposed ||
        reconciliationGeneration !== layoutLocalGenerations[layoutId] ||
        isLayoutSlotLocallyDirty(layoutId)
      ) {
        return;
      }
      await applyWorkspaceLayoutState(result.value, [layoutId]);
    } catch (error) {
      console.error("Failed to reconcile persisted workspace layout state:", error);
    } finally {
      settleWorkspaceLayoutSaveWaiters(layoutId, committedGeneration);
    }
  };

  const persistWorkspaceLayout = (): Promise<void> => {
    if (disposed) {
      return Promise.resolve();
    }

    captureActiveLayout();
    const layoutId = activeLayoutId;
    layoutSlotInitialized = {
      ...layoutSlotInitialized,
      [layoutId]: layoutSlotInitialized[layoutId] || isInitializedPaneLayout(paneLayout),
    };
    let input: SaveWorkspaceLayoutSlotCommandInput;
    try {
      input = stateLayoutSlotInput(workspaceInfo.workspaceId as WorkspaceId, layoutId, paneLayout);
    } catch (error) {
      console.error("Failed to encode workspace layout state:", error);
      return Promise.reject(error);
    }
    const generation = layoutLocalGenerations[layoutId] + 1;
    layoutLocalGenerations = { ...layoutLocalGenerations, [layoutId]: generation };
    pendingLayoutSaves.set(layoutId, { generation, input, attempt: 0 });
    const committed = new Promise<void>((resolve, reject) => {
      const waiters = layoutSaveWaiters.get(layoutId) ?? [];
      waiters.push({ generation, resolve, reject });
      layoutSaveWaiters.set(layoutId, waiters);
    });
    void drainWorkspaceLayoutSaves(layoutId);
    return committed;
  };

  const persistWorkspaceLayoutInBackground = (): void => {
    void persistWorkspaceLayout().catch(() => undefined);
  };

  const persistSelectedLayoutId = (layoutId: WorkspaceLayoutSlotId): Promise<void> => {
    return options.selectWorkspaceLayoutSlot?.(layoutId) ?? Promise.resolve();
  };

  const trackPromptPaneBindingPersistence = (
    panelId: string,
    persistence: Promise<void>,
  ): Promise<void> => {
    let tracked!: Promise<void>;
    tracked = persistence.then(
      () => {
        if (promptPaneBindingBarriers.get(panelId) === tracked) {
          promptPaneBindingBarriers.delete(panelId);
        }
      },
      (error) => {
        if (promptPaneBindingBarriers.get(panelId) === tracked) {
          promptPaneBindingBarriers.delete(panelId);
        }
        throw error;
      },
    );
    promptPaneBindingBarriers.set(panelId, tracked);
    return tracked;
  };

  const awaitPromptRoutingReady = async (
    panelId: string,
    surfacePiSessionId: string,
  ): Promise<void> => {
    const initialBindingBarrier = promptPaneBindingBarriers.get(panelId);
    await options.awaitWorkspaceChromeMutations?.();
    if (initialBindingBarrier) {
      await initialBindingBarrier;
    }
    while (true) {
      const transition = layoutTransitionTail;
      const application = layoutApplicationTail;
      const bindingBarrier = promptPaneBindingBarriers.get(panelId);
      await transition;
      await application;
      if (bindingBarrier) {
        await bindingBarrier;
      }
      if (
        transition === layoutTransitionTail &&
        application === layoutApplicationTail &&
        promptPaneBindingBarriers.get(panelId) === undefined
      ) {
        break;
      }
    }
    if (disposed) {
      throw new Error("Expected an active workspace runtime before sending a prompt.");
    }
    const target = paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
    if (!isPromptTarget(target) || target.surfacePiSessionId !== surfacePiSessionId) {
      throw new Error("Expected the prompt surface to remain attached before sending a prompt.");
    }
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

  const surfaceRebaselineGenerations = new Map<string, number>();
  const rebaselineSurfaceController = async (
    controller: ChatSurfaceControllerInternal,
  ): Promise<void> => {
    const surfacePiSessionId = controller.target.surfacePiSessionId;
    const generation = (surfaceRebaselineGenerations.get(surfacePiSessionId) ?? 0) + 1;
    surfaceRebaselineGenerations.set(surfacePiSessionId, generation);
    try {
      const readModels = await fetchSurfaceReadModels(controller.target);
      if (
        disposed ||
        surfaceRebaselineGenerations.get(surfacePiSessionId) !== generation ||
        surfaceControllers.get(surfacePiSessionId) !== controller
      ) {
        return;
      }
      controller.applyReadModels(readModels);
      rendererNotificationStore.resumeSurfaceAfterRebaseline(
        readModels.transcript.target,
        readModels.transcript.streamCursor,
      );
    } catch (error) {
      console.error("Failed to rebaseline surface read models:", error);
    }
  };

  const rendererNotificationStore = createRendererNotificationStore({
    rpcClient,
    workspaceId: workspaceInfo.workspaceId as WorkspaceId,
    applyReadModelPatch: applyNotificationReadModelPatch,
    applyReadModelBaseline: applyNotificationReadModelBaseline,
    onRendererCommand: (command) => {
      for (const listener of rendererCommandListeners) listener(command);
    },
    onError: (error, context) => console.error(`${context}:`, error),
  });

  const upsertSurfaceController = (
    readModels: SurfaceReadModelBundle,
  ): ChatSurfaceControllerInternal => {
    const surfacePiSessionId = readModels.transcript.target.surfacePiSessionId;
    const existing = surfaceControllers.get(surfacePiSessionId);
    if (existing) {
      existing.applyReadModels(readModels);
      syncPaneTargetForSurface(readModels.transcript.target as PromptTarget);
      return existing;
    }

    const controller = new SurfaceControllerImpl(
      readModels,
      rpcClient,
      workspaceInfo.workspaceId,
      (summary) => rendererSurfaceModel(summary, appReadModelCache.modelMetadata),
      awaitPromptRoutingReady,
    );
    surfaceControllers.set(surfacePiSessionId, controller);
    controller.setSurfaceSubscription(
      rendererNotificationStore.subscribeSurface(readModels.transcript.target, {
        onPatch: (notification) => controller.applyStreamPatch(notification.patch),
        onReset: () => {
          controller.discardStreamOverlay();
          void rebaselineSurfaceController(controller);
        },
      }),
    );
    return controller;
  };

  const removePaneForSurface = async (panelId: string): Promise<void> => {
    const target = paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
    if (!target) {
      return;
    }

    paneLayout = closePane(paneLayout, panelId);
    if (isPromptTarget(target)) {
      surfaceControllers.get(target.surfacePiSessionId)?.detachPane(panelId);
    }
    await persistWorkspaceLayout();
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
      if (
        controller &&
        controller.ownerPaneIds.length === 0 &&
        controller.promptStatus !== "streaming" &&
        surfaceControllers.get(target.surfacePiSessionId) === controller
      ) {
        surfaceControllers.delete(target.surfacePiSessionId);
        controller.dispose();
      }
    } catch (error) {
      console.error("Failed to close surface:", error);
    }
  };

  const bindPaneToSurfaceReadModels = async (
    panelId: string,
    readModels: SurfaceReadModelBundle,
    bindOptions: { focus?: boolean; persist?: boolean } = {},
  ): Promise<void> => {
    const focus = bindOptions.focus ?? true;
    const persist = bindOptions.persist ?? true;
    const previousFocusedPaneId = paneLayout.focusedPanelId;
    const previousTarget =
      paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
    const nextTarget = normalizePromptTarget(readModels.transcript.target as PromptTarget);
    if (
      isPromptTarget(previousTarget) &&
      previousTarget.surfacePiSessionId === nextTarget.surfacePiSessionId
    ) {
      paneLayout = bindPane(paneLayout, panelId, nextTarget);
      if (!focus) {
        paneLayout = { ...paneLayout, focusedPanelId: previousFocusedPaneId };
      }
      const persistence = persist
        ? trackPromptPaneBindingPersistence(panelId, persistWorkspaceLayout())
        : Promise.resolve();
      upsertSurfaceController(readModels).attachPane(panelId);
      emit();
      recordFocusedSession();
      await persistence;
      return;
    }

    const controller = upsertSurfaceController(readModels);
    paneLayout = bindPane(paneLayout, panelId, nextTarget);
    if (!focus) {
      paneLayout = { ...paneLayout, focusedPanelId: previousFocusedPaneId };
    }
    const persistence = persist
      ? trackPromptPaneBindingPersistence(panelId, persistWorkspaceLayout())
      : Promise.resolve();
    controller.attachPane(panelId);
    emit();
    recordFocusedSession();

    if (isPromptTarget(previousTarget)) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(panelId);
    }
    await persistence;
  };

  const bindPaneToExistingController = async (
    panelId: string,
    controller: ChatSurfaceControllerInternal,
    bindOptions: { focus?: boolean; persist?: boolean } = {},
  ): Promise<void> => {
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
    const persistence = persist
      ? trackPromptPaneBindingPersistence(panelId, persistWorkspaceLayout())
      : Promise.resolve();
    controller.attachPane(panelId);
    emit();
    recordFocusedSession();

    if (
      isPromptTarget(previousTarget) &&
      previousTarget.surfacePiSessionId !== nextTarget.surfacePiSessionId
    ) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(panelId);
    }
    await persistence;
  };

  const refreshSessions = async (): Promise<WorkspaceSessionSummary[]> => {
    const refreshSequence = ++sessionNavigationRefreshSequence;
    const result = requireStateReadModel(
      await rpcClient.request.fetchStateReadModel({
        kind: "sessionNavigation",
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
      }),
      "sessionNavigation",
    );
    if (refreshSequence === sessionNavigationRefreshSequence) {
      applySessionNavigation(result.value);
      emit();
    }
    return structuredClone(sessions);
  };

  let lastRecordedFocusedSessionId: string | null | undefined = undefined;
  const recordFocusedSession = (): void => {
    const focusedTarget =
      paneLayout.panels.find((pane) => pane.panelId === paneLayout.focusedPanelId)?.binding ?? null;
    const focusedSessionId = isPromptTarget(focusedTarget)
      ? focusedTarget.workspaceSessionId
      : null;
    if (focusedSessionId === lastRecordedFocusedSessionId) {
      return;
    }

    lastRecordedFocusedSessionId = focusedSessionId;
    if (!focusedSessionId) {
      return;
    }
    void rpcClient.request
      .stateSessionNavigationMarkRead({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        workspaceSessionId: focusedSessionId as WorkspaceSessionId,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      })
      .then(() => refreshSessions())
      .catch((error) => {
        lastRecordedFocusedSessionId = undefined;
        console.error("Failed to mark focused session read:", error);
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
    _sessionId?: string,
  ): Promise<CommandInspectorReadModel> => {
    const inspector = await loadCommandInspector(commandId);
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

    const threadIds = getSessionThreadIds(sessionId);
    const inspectors = await Promise.all(
      threadIds.map((threadId) => loadHandlerInspector(threadId)),
    );
    return inspectors
      .filter((inspector): inspector is WorkspaceHandlerThreadInspector => inspector !== null)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  };

  const getWorkflowTaskAttemptInspector = async (
    workflowTaskAttemptId: string,
    _sessionId?: string,
  ): Promise<WorkspaceWorkflowTaskAttemptInspector> => {
    const inspector = await loadWorkflowTaskAttemptInspector(workflowTaskAttemptId);
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
    initialWorkspaceChromeResult,
    initialWorkspaceLayoutResult,
    initialSessionNavigationResult,
    initialAppLogSummaryResult,
    initialRequestInputResult,
    initialApprovalsResult,
  ] = await Promise.all([
    rpcClient.request.fetchStateReadModel({ kind: "workspaceChrome" }),
    rpcClient.request.fetchStateReadModel({
      kind: "workspaceLayout",
      workspaceId: workspaceInfo.workspaceId as WorkspaceId,
    }),
    rpcClient.request.fetchStateReadModel({
      kind: "sessionNavigation",
      workspaceId: workspaceInfo.workspaceId as WorkspaceId,
    }),
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
  const initialWorkspaceChrome = requireStateReadModel(
    initialWorkspaceChromeResult,
    "workspaceChrome",
  ).value;
  const initialWorkspaceLayout = requireStateReadModel(
    initialWorkspaceLayoutResult,
    "workspaceLayout",
  ).value;
  const persistedWorkspaceTab = options.workspaceTabId
    ? initialWorkspaceChrome.tabs.find((tab) => tab.workspaceTabId === options.workspaceTabId)
    : undefined;
  if (persistedWorkspaceTab) {
    activeLayoutId = persistedWorkspaceTab.activeLayoutId;
  }
  const initialRequestInput = requireStateReadModel(
    initialRequestInputResult,
    "requestInput",
  ).value;
  const initialApprovals = requireStateReadModel(initialApprovalsResult, "approvals").value;
  applySessionNavigation(
    requireStateReadModel(initialSessionNavigationResult, "sessionNavigation").value,
  );
  setAppCache("workspaceChrome", initialWorkspaceChrome);
  savedLayouts = rendererLayoutsFromState(initialWorkspaceLayout);
  layoutSlotInitialized = Object.fromEntries(
    initialWorkspaceLayout.slots.map((slot) => [slot.layoutId, slot.initialized]),
  ) as Record<WorkspaceLayoutSlotId, boolean>;
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

  const canUseOpenWorkspaceSurface = workspaceInfo.kind === "default";

  const reconcileActivePromptPaneOwners = (): void => {
    const activeSurfaceByPanelId = new Map(
      paneLayout.panels.flatMap(
        (pane): Array<[string, string]> =>
          isPromptTarget(pane.binding) ? [[pane.panelId, pane.binding.surfacePiSessionId]] : [],
      ),
    );
    for (const [surfacePiSessionId, controller] of surfaceControllers) {
      for (const panelId of controller.ownerPaneIds) {
        if (activeSurfaceByPanelId.get(panelId) !== surfacePiSessionId) {
          controller.detachPane(panelId);
        }
      }
    }
  };

  const hydrateActiveLayout = async (
    layout: WorkspaceDockviewLayoutState | null,
    isCurrent: () => boolean = () => true,
  ): Promise<void> => {
    if (!isCurrent()) return;
    restoredPaneIds = [];
    if (!layout?.panels.length) {
      if (isCurrent()) {
        paneLayout = layout ? structuredClone(layout) : createEmptyPaneLayout();
        reconcileActivePromptPaneOwners();
      }
      return;
    }

    const sessionIds = new Set(sessions.map((session) => session.id));
    if (!isCurrent()) return;
    paneLayout = layout;

    for (const paneState of paneLayout.panels) {
      if (!isCurrent()) return;
      if (!paneState.binding) {
        continue;
      }
      const isRestorableStatic = isRestorableStaticTarget(paneState.binding, {
        allowOpenWorkspace: canUseOpenWorkspaceSurface,
      });
      const workspaceSessionId = getPaneTargetWorkspaceSessionId(paneState.binding);
      if (!isRestorableStatic && (!workspaceSessionId || !sessionIds.has(workspaceSessionId))) {
        paneLayout = markDockviewPanelUnavailable(
          paneLayout,
          paneState.panelId,
          workspaceSessionId
            ? "The restored session is no longer available."
            : "The restored surface is not available in this workspace.",
        );
        restoredPaneIds.push(paneState.panelId);
        continue;
      }

      if (!isPromptTarget(paneState.binding)) {
        restoredPaneIds.push(paneState.panelId);
        continue;
      }

      const target = normalizePromptTarget(paneState.binding);
      const existingController = surfaceControllers.get(target.surfacePiSessionId);
      if (existingController) {
        if (!isCurrent()) return;
        await bindPaneToExistingController(paneState.panelId, existingController, {
          focus: false,
          persist: false,
        });
        restoredPaneIds.push(paneState.panelId);
        continue;
      }

      try {
        const opened = await rpcClient.request.openSurface(scoped({ target }));
        const readModels = await fetchSurfaceReadModels(normalizePromptTarget(opened.target));
        if (!isCurrent()) return;
        await bindPaneToSurfaceReadModels(paneState.panelId, readModels, {
          focus: false,
          persist: false,
        });
        restoredPaneIds.push(paneState.panelId);
      } catch (error) {
        if (!isCurrent()) return;
        console.error("Failed to restore workspace pane:", error);
        paneLayout = markDockviewPanelUnavailable(
          paneLayout,
          paneState.panelId,
          formatUnavailableSurfaceReason(error),
        );
        restoredPaneIds.push(paneState.panelId);
      }
    }
    if (isCurrent()) {
      reconcileActivePromptPaneOwners();
    }
  };

  const hydrateSelectedLayout = async (
    layoutId: WorkspaceLayoutSlotId,
    layout: WorkspaceDockviewLayoutState | null,
    isCurrent: () => boolean = () => activeLayoutId === layoutId,
  ): Promise<boolean> => {
    await hydrateActiveLayout(layout, isCurrent);
    if (!isCurrent() || workspaceInfo.kind !== "default" || paneLayout.panels.length > 0) {
      return false;
    }
    paneLayout = addDockviewPanel(
      createEmptyPaneLayout(),
      { surface: "open-workspace" },
      PRIMARY_CHAT_PANE_ID,
    );
    return true;
  };

  const queueSelectedLayoutHydration = (
    layoutId: WorkspaceLayoutSlotId,
    layout: WorkspaceDockviewLayoutState | null,
  ): Promise<boolean> => {
    const hydrationSequence = ++layoutHydrationSequence;
    const isCurrent = () =>
      !disposed && activeLayoutId === layoutId && hydrationSequence === layoutHydrationSequence;
    const hydrate = () => hydrateSelectedLayout(layoutId, layout, isCurrent);
    const result = layoutApplicationTail.then(hydrate, hydrate);
    layoutApplicationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const applyWorkspaceLayoutState = (
    readModel: WorkspaceLayoutReadModel,
    changedLayoutIds: readonly WorkspaceLayoutSlotId[],
  ): Promise<void> => {
    const apply = async (): Promise<void> => {
      if (disposed) return;
      const incomingLayouts = rendererLayoutsFromState(readModel);
      const incomingInitialized = Object.fromEntries(
        readModel.slots.map((slot) => [slot.layoutId, slot.initialized]),
      ) as Record<WorkspaceLayoutSlotId, boolean>;
      let shouldHydrateActive = false;
      for (const layoutId of changedLayoutIds) {
        if (isLayoutSlotLocallyDirty(layoutId)) continue;
        savedLayouts = { ...savedLayouts, [layoutId]: incomingLayouts[layoutId] };
        layoutSlotInitialized = {
          ...layoutSlotInitialized,
          [layoutId]: incomingInitialized[layoutId],
        };
        if (layoutId === activeLayoutId) shouldHydrateActive = true;
      }
      let seededDefaultLayout = false;
      if (shouldHydrateActive && !isLayoutSlotLocallyDirty(activeLayoutId)) {
        const hydrationSequence = ++layoutHydrationSequence;
        const layoutId = activeLayoutId;
        const isCurrent = () =>
          !disposed && activeLayoutId === layoutId && hydrationSequence === layoutHydrationSequence;
        seededDefaultLayout = await hydrateSelectedLayout(
          layoutId,
          savedLayouts[layoutId],
          isCurrent,
        );
        if (disposed || hydrationSequence !== layoutHydrationSequence) return;
        recordFocusedSession();
      }
      emit();
      if (seededDefaultLayout) {
        queueMicrotask(persistWorkspaceLayoutInBackground);
      }
    };
    const result = layoutApplicationTail.then(apply, apply);
    layoutApplicationTail = result.catch(() => undefined);
    return result;
  };

  const refreshWorkspaceLayoutSlot = async (layoutId: WorkspaceLayoutSlotId): Promise<void> => {
    await awaitPendingWorkspaceLayoutSaves(layoutId);
    let retryAfterPendingSave = false;
    const refresh = async (): Promise<void> => {
      const result = requireStateReadModel(
        await rpcClient.request.fetchStateReadModel({
          kind: "workspaceLayout",
          workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        }),
        "workspaceLayout",
      );
      if (disposed) return;
      if (isLayoutSlotLocallyDirty(layoutId)) {
        retryAfterPendingSave = true;
        return;
      }
      const layouts = rendererLayoutsFromState(result.value);
      const slot = result.value.slots.find((candidate) => candidate.layoutId === layoutId);
      savedLayouts = { ...savedLayouts, [layoutId]: layouts[layoutId] };
      layoutSlotInitialized = {
        ...layoutSlotInitialized,
        [layoutId]: slot?.initialized ?? false,
      };
    };
    const result = layoutApplicationTail.then(refresh, refresh);
    layoutApplicationTail = result.catch(() => undefined);
    await result;
    if (retryAfterPendingSave) {
      await refreshWorkspaceLayoutSlot(layoutId);
    }
  };

  const activateWorkspaceLayout = async (
    layoutId: WorkspaceLayoutSlotId,
    activateOptions: { forceHydration?: boolean } = {},
  ): Promise<boolean> => {
    await layoutApplicationTail;
    if (disposed) return false;
    const changedLayout = activeLayoutId !== layoutId;
    if (!changedLayout && !activateOptions.forceHydration) return false;
    if (changedLayout) captureActiveLayout();
    activeLayoutId = layoutId;
    emit();
    const seededDefaultLayout = await queueSelectedLayoutHydration(
      layoutId,
      savedLayouts[layoutId],
    );
    if (disposed || activeLayoutId !== layoutId) return false;
    savedLayouts = {
      ...savedLayouts,
      [layoutId]: structuredClone(paneLayout),
    };
    return seededDefaultLayout;
  };

  const rollbackRejectedWorkspaceLayoutSelection = async (
    previousLayoutId: WorkspaceLayoutSlotId,
  ): Promise<void> => {
    let authoritativeLayoutId = previousLayoutId;
    try {
      const result = requireStateReadModel(
        await rpcClient.request.fetchStateReadModel({ kind: "workspaceChrome" }),
        "workspaceChrome",
      );
      setAppCache("workspaceChrome", result.value);
      const workspaceTab = options.workspaceTabId
        ? result.value.tabs.find((tab) => tab.workspaceTabId === options.workspaceTabId)
        : undefined;
      authoritativeLayoutId = workspaceTab?.activeLayoutId ?? previousLayoutId;
    } catch (error) {
      console.error("Failed to refetch authoritative workspace layout selection:", error);
    }
    await refreshWorkspaceLayoutSlot(authoritativeLayoutId);
    await activateWorkspaceLayout(authoritativeLayoutId, { forceHydration: true });
    emit();
    recordFocusedSession();
  };

  const queueWorkspaceLayoutTransition = (
    layoutId: WorkspaceLayoutSlotId,
    transitionOptions: {
      persistChromeSelection: boolean;
      persistOutgoingLayout: boolean;
    },
  ): Promise<void> => {
    const transition = async (): Promise<void> => {
      if (disposed || layoutId === activeLayoutId) return;
      const previousLayoutId = activeLayoutId;
      if (transitionOptions.persistOutgoingLayout) {
        await persistWorkspaceLayout();
      }
      await refreshWorkspaceLayoutSlot(layoutId);
      const seededDefaultLayout = await activateWorkspaceLayout(layoutId);
      if (disposed || activeLayoutId !== layoutId) return;
      if (transitionOptions.persistChromeSelection) {
        try {
          await persistSelectedLayoutId(layoutId);
        } catch (error) {
          await rollbackRejectedWorkspaceLayoutSelection(previousLayoutId);
          throw error;
        }
      }
      if (disposed || activeLayoutId !== layoutId) return;
      if (seededDefaultLayout) {
        await persistWorkspaceLayout();
      }
      emit();
      recordFocusedSession();
    };
    const result = layoutTransitionTail.then(transition, transition);
    layoutTransitionTail = result.catch(() => undefined);
    return result;
  };

  const activeRestoreLayout = savedLayouts[activeLayoutId];
  let restoredPaneIds: string[] = [];
  const seededInitialDefaultLayout = await hydrateSelectedLayout(
    activeLayoutId,
    activeRestoreLayout,
    () => true,
  );
  if (seededInitialDefaultLayout) {
    await persistWorkspaceLayout();
  }

  if (restoredPaneIds.length > 0) {
    paneLayout = {
      ...paneLayout,
      focusedPanelId:
        activeRestoreLayout?.focusedPanelId &&
        restoredPaneIds.includes(activeRestoreLayout.focusedPanelId)
          ? activeRestoreLayout.focusedPanelId
          : restoredPaneIds[0]!,
    };
    emit();
  } else {
    emit();
  }

  const openStaticWorkspacePane = async (
    target: WorkspacePaneSurfaceTarget,
    openTarget?: PaneOpenTarget | string,
  ): Promise<void> => {
    const nextPaneId = resolveOpenTarget({ ...target }, openTarget);
    const previousTarget =
      paneLayout.panels.find((pane) => pane.panelId === nextPaneId)?.binding ?? null;
    if (isPromptTarget(previousTarget)) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(nextPaneId);
    }
    paneLayout = bindPane(paneLayout, nextPaneId, { ...target });
    await persistWorkspaceLayout();
    emit();
    recordFocusedSession();
  };

  handleArtifactOpenInspector = (inspector): void => {
    if (
      processedArtifactOpenCommandIds.has(inspector.commandId) ||
      inspector.status !== "succeeded" ||
      inspector.facts?.commandFamily !== "artifacts" ||
      inspector.facts.artifactCommandId !== "open" ||
      inspector.facts?.intent !== "open_artifact_inspector" ||
      inspector.facts.accepted !== true ||
      typeof inspector.facts.missingFile !== "boolean"
    ) {
      return;
    }
    const workspaceSessionId = inspector.facts.workspaceSessionId;
    const artifactId = inspector.facts.artifactId;
    if (
      typeof workspaceSessionId !== "string" ||
      typeof artifactId !== "string" ||
      artifactId.length === 0 ||
      inspector.target.workspaceSessionId !== workspaceSessionId
    ) {
      return;
    }
    processedArtifactOpenCommandIds.add(inspector.commandId);
    void openStaticWorkspacePane({
      workspaceSessionId,
      surface: "artifact",
      artifactId,
    }).catch((error) => {
      processedArtifactOpenCommandIds.delete(inspector.commandId);
      console.error("Failed to persist opened artifact pane:", error);
    });
  };
  for (const inspector of pendingArtifactOpenInspectors.values()) {
    handleArtifactOpenInspector(inspector);
  }
  pendingArtifactOpenInspectors.clear();
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
    get workspaceChromeSnapshot() {
      return cloneOrNull(appReadModelCache.workspaceChrome);
    },
    get appPreferencesSnapshot() {
      return cloneOrNull(appReadModelCache.appPreferences);
    },
    get settingsSnapshot() {
      return cloneOrNull(appReadModelCache.settings);
    },
    get agentsSnapshot() {
      return cloneOrNull(appReadModelCache.agents);
    },
    get modelMetadataSnapshot() {
      return cloneOrNull(appReadModelCache.modelMetadata);
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
    get promptHistorySnapshot() {
      return structuredClone(
        workspaceReadModelCache(workspaceInfo.workspaceId).promptHistory?.entries ?? [],
      );
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
      resetInspectorCaches();
      activeRuntimeEmitters.delete(runtimeCacheEmitter);
      rendererNotificationStore.dispose();
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
      persistWorkspaceLayoutInBackground();
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
      await persistWorkspaceLayout();
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
      await persistWorkspaceLayout();
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
      persistWorkspaceLayoutInBackground();
      emit();
      recordFocusedSession();
    },
    switchWorkspaceLayout: async (layoutId) => {
      await queueWorkspaceLayoutTransition(layoutId, {
        persistChromeSelection: true,
        persistOutgoingLayout: true,
      });
    },
    getCommandInspector,
    writeCommandStdin,
    listHandlerThreads,
    getHandlerThreadsSnapshot,
    getWorkflowTaskAttemptInspector,
    getArtifactPreview,
    getRequestUserInputRequests: () => structuredClone(requestUserInputRequests),
    getRuntimeApprovalRequests: () => structuredClone(runtimeApprovalRequests),
    answerRequestUserInput: async (request) => {
      const clientSubmission = serializableClientSubmission(
        request.clientSubmission ?? {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      );
      const response = await rpcClient.request.answerRequestUserInput(
        scoped({
          ...request,
          clientSubmission,
        }),
      );
      await refreshRequestInput();
      return response;
    },
    setRequestUserInputTimerPaused: async (request) => {
      const clientSubmission = serializableClientSubmission(
        request.clientSubmission ?? {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      );
      await rpcClient.request.setRequestUserInputTimerPaused(
        scoped({
          ...request,
          clientSubmission,
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
      const opened = await rpcClient.request.createOrchestratorSurface(scoped(request));
      const target = normalizePromptTarget(opened.target as PromptTarget);
      const nextPaneId = resolveOpenTarget(target, openTarget);
      await bindPaneToSurfaceReadModels(nextPaneId, await fetchSurfaceReadModels(target));
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
        await persistWorkspaceLayout();
        emit();
        recordFocusedSession();
        return;
      }

      if (existingController) {
        if (existingController.ownerPaneIds.length === 0) {
          const opened = await rpcClient.request.openSurface(
            scoped({
              target: {
                workspaceSessionId: sessionId,
                surface: "orchestrator",
                surfacePiSessionId: sessionId,
              },
            }),
          );
          const openedTarget = normalizePromptTarget(opened.target);
          await bindPaneToSurfaceReadModels(nextPaneId, await fetchSurfaceReadModels(openedTarget));
          return;
        }
        await bindPaneToExistingController(nextPaneId, existingController);
        return;
      }

      const opened = await rpcClient.request.openSurface(
        scoped({
          target: {
            workspaceSessionId: sessionId,
            surface: "orchestrator",
            surfacePiSessionId: sessionId,
          },
        }),
      );
      const openedTarget = normalizePromptTarget(opened.target);
      await bindPaneToSurfaceReadModels(nextPaneId, await fetchSurfaceReadModels(openedTarget));
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
        await openStaticWorkspacePane(target, openTarget);
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
        await persistWorkspaceLayout();
        emit();
        recordFocusedSession();
        return;
      }

      if (existingController) {
        if (existingController.ownerPaneIds.length === 0) {
          const opened = await rpcClient.request.openSurface(scoped({ target: normalizedTarget }));
          const openedTarget = normalizePromptTarget(opened.target);
          await bindPaneToSurfaceReadModels(nextPaneId, await fetchSurfaceReadModels(openedTarget));
          return;
        }
        await bindPaneToExistingController(nextPaneId, existingController);
        return;
      }

      const opened = await rpcClient.request.openSurface(scoped({ target: normalizedTarget }));
      const openedTarget = normalizePromptTarget(opened.target);
      await bindPaneToSurfaceReadModels(nextPaneId, await fetchSurfaceReadModels(openedTarget));
    },
    closePaneSurface: async (panelId) => {
      const target = paneLayout.panels.find((pane) => pane.panelId === panelId)?.binding ?? null;
      if (!target) {
        return;
      }

      await removePaneForSurface(panelId);
      emit();
      recordFocusedSession();
      await releasePaneSurface(panelId, target);
    },
    renameSession: async (sessionId, title) => {
      await rpcClient.request.renameSession(scoped({ sessionId, title }));
      await refreshSessions();
    },
    forkSession: async (sessionId, title, openTarget, forkOptions) => {
      const opened = await rpcClient.request.forkSession(
        scoped({
          sessionId,
          title,
          messageTimestamp: forkOptions?.messageTimestamp,
        }),
      );
      const target = normalizePromptTarget(opened.target);
      const nextPaneId = resolveOpenTarget(target, openTarget);
      await bindPaneToSurfaceReadModels(nextPaneId, await fetchSurfaceReadModels(target));
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
        await removePaneForSurface(candidatePaneId);
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
      await rpcClient.request.stateSessionNavigationSetPinned({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        workspaceSessionId: sessionId as WorkspaceSessionId,
        pinned: true,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSessions();
    },
    unpinSession: async (sessionId) => {
      await rpcClient.request.stateSessionNavigationSetPinned({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        workspaceSessionId: sessionId as WorkspaceSessionId,
        pinned: false,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSessions();
    },
    archiveSession: async (sessionId) => {
      await rpcClient.request.stateSessionNavigationSetArchived({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        workspaceSessionId: sessionId as WorkspaceSessionId,
        archived: true,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSessions();
    },
    unarchiveSession: async (sessionId) => {
      await rpcClient.request.stateSessionNavigationSetArchived({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        workspaceSessionId: sessionId as WorkspaceSessionId,
        archived: false,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSessions();
    },
    markSessionUnread: async (sessionId) => {
      await rpcClient.request.stateSessionNavigationMarkUnread({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        workspaceSessionId: sessionId as WorkspaceSessionId,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      lastRecordedFocusedSessionId = undefined;
      await refreshSessions();
    },
    markSessionRead: async (sessionId) => {
      await rpcClient.request.stateSessionNavigationMarkRead({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        workspaceSessionId: sessionId as WorkspaceSessionId,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      lastRecordedFocusedSessionId = undefined;
      await refreshSessions();
    },
    setSessionNavigationSectionState: async (section, state) => {
      await rpcClient.request.stateSessionNavigationSetSectionState({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        section,
        ...state,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSessions();
    },
    setPaneScroll: (panelId, scroll) => {
      paneLayout = setLayoutPaneScroll(paneLayout, panelId, scroll);
      persistWorkspaceLayoutInBackground();
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
    openWorkflowsGeneratedExportInEditor: async (input) => {
      const result = await rpcClient.request.openWorkflowsGeneratedExportInEditor({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        ...input,
      });
      return result.opened;
    },
    openGeneratedAgentContextExternalSourceInEditor: async (path) => {
      const result = await rpcClient.request.openGeneratedAgentContextExternalSourceInEditor(
        scoped({ path }),
      );
      return result.opened;
    },
    openSourceEdit: (input) => rpcClient.request.openSourceEdit(input),
    saveSourceEdit: async (input) => {
      const result = await rpcClient.request.saveSourceEdit({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        source: input,
      });
      if (input.sourceKind === "workflow-agent") {
        await refreshAgents();
      }
      return result;
    },
    createWorkflowAgentSource: async (input) => {
      const result = await rpcClient.request.createWorkflowAgentSource({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        source: input,
      });
      await refreshAgents();
      return result;
    },
    duplicateWorkflowAgentSource: async (input) => {
      const result = await rpcClient.request.duplicateWorkflowAgentSource({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        source: input,
      });
      await refreshAgents();
      return result;
    },
    deleteWorkflowAgentSource: async (input) => {
      const result = await rpcClient.request.deleteWorkflowAgentSource({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        source: input,
      });
      await refreshAgents();
      return result;
    },
    openSourceInEditor: async (input) => {
      const result = await rpcClient.request.openSourceInEditor({
        workspaceId: workspaceInfo.workspaceId,
        ...input,
      });
      return result.opened;
    },
    getAgents: refreshAgents,
    updateOrchestratorProfile: async (profile) => {
      await rpcClient.request.stateAgentProfilesUpdateOrchestrator({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        profile,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      return refreshAgents();
    },
    updateThreadHandlerProfile: async (profile) => {
      await rpcClient.request.stateAgentProfilesUpdateThreadHandler({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        profile,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      return refreshAgents();
    },
    deleteOrchestratorProfile: async (input) => {
      await rpcClient.request.stateAgentProfilesDeleteOrchestrator({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        ...input,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      return refreshAgents();
    },
    reorderOrchestratorProfiles: async (input) => {
      await rpcClient.request.stateAgentProfilesReorderOrchestrators({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        ...input,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      return refreshAgents();
    },
    setConfiguredProfileExtensionUsage: async (input) => {
      await rpcClient.request.stateAgentProfilesSetExtensionUsage({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        ...input,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      return refreshAgents();
    },
    promoteConfiguredProfileExtensionDefault: async (input) => {
      await rpcClient.request.stateAgentProfilesPromoteExtensionDefault({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        ...input,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      return refreshAgents();
    },
    resetConfiguredActorExtensionDefaults: async (input) => {
      await rpcClient.request.stateAgentProfilesResetExtensionDefaults({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        ...input,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      return refreshAgents();
    },
    setConfiguredExternalInstructionUsage: async (input) => {
      await rpcClient.request.stateAgentProfilesSetExternalInstructionUsage({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        ...input,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      return refreshAgents();
    },
    getAgentContextPreview: (request = {}) =>
      rpcClient.request.getAgentContextPreview(scoped(request)),
    listModelMetadata: refreshModelMetadata,
    listProviderAuths: refreshProviderAuths,
    setProviderApiKey: async (request) => {
      const result = await rpcClient.request.setProviderApiKey(request);
      await refreshProviderAuths();
      void refreshModelMetadata().catch(() => undefined);
      return result;
    },
    startOAuth: async (request) => {
      const result = await rpcClient.request.startOAuth(request);
      if (result.ok) {
        await refreshProviderAuths();
        void refreshModelMetadata().catch(() => undefined);
      }
      return result;
    },
    removeProviderAuth: async (request) => {
      const result = await rpcClient.request.removeProviderAuth(request);
      await refreshProviderAuths();
      void refreshModelMetadata().catch(() => undefined);
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
      void refreshModelMetadata().catch(() => undefined);
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
    setExtensionEnvOverride: async (input) => {
      await rpcClient.request.stateExtensionEnvSetOverride(scoped(input));
      return refreshExtensionsInventory();
    },
    removeExtensionEnvOverride: async (input) => {
      await rpcClient.request.stateExtensionEnvRemoveOverride(scoped(input));
      return refreshExtensionsInventory();
    },
    getSettings: refreshSettings,
    setRequestInputVariant: async (input) => {
      await rpcClient.request.setRequestInputVariant(input);
      return refreshSettings();
    },
    setRequestInputBlockingTimeout: async (input) => {
      await rpcClient.request.setRequestInputBlockingTimeout(input);
      return refreshSettings();
    },
    getGeneratedAgentContextExternalSources: refreshExternalInstructionSources,
    getSnippets: refreshSnippets,
    createManagedSnippet: async (input) => {
      const result = await rpcClient.request.stateSnippetsCreateManaged({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        title: input.title,
        body: input.body,
        metadata: {
          description: input.description?.trim() || null,
          argumentHint: input.argumentHint?.trim() || null,
        },
        enabled: true,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSnippets();
      return result.snippetId;
    },
    updateManagedSnippet: async (input) => {
      await rpcClient.request.stateSnippetsUpdateManaged({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        snippetId: input.snippetId as SnippetId,
        patch: {
          title: input.title,
          body: input.body,
          metadata: {
            description: input.description?.trim() || null,
            argumentHint: input.argumentHint?.trim() || null,
          },
        },
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSnippets();
    },
    deleteManagedSnippet: async (snippetId) => {
      await rpcClient.request.stateSnippetsDeleteManaged({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        snippetId: snippetId as SnippetId,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSnippets();
    },
    setSnippetEnabled: async (input) => {
      await rpcClient.request.stateSnippetsSetEnabled({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        snippetId: input.snippetId as SnippetId,
        enabled: input.enabled,
        clientSubmission: {
          clientRequestId: createDesktopClientRequestId() as RuntimeClientRequestId,
          source: "desktop" as RuntimeClientSubmissionSource,
        },
      });
      await refreshSnippets();
    },
    openSnippetSourceInEditor: async (snippetId) => {
      const result = await rpcClient.request.openSnippetSourceInEditor({
        workspaceId: workspaceInfo.workspaceId as WorkspaceId,
        snippetId: snippetId as SnippetId,
      });
      return result.opened;
    },
  };

  return runtime;
}
