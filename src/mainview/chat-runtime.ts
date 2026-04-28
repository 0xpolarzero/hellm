import { Agent, type AgentMessage, type StreamFn } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  getModel,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message,
} from "@mariozechner/pi-ai";
import type {
  ConversationSurfaceSnapshot,
  CreateSessionRequest,
  PromptTarget,
  SendPromptRequest,
  SurfaceSyncMessage,
  WorkspaceCommandInspector,
  WorkspacePathIndexEntry,
  WorkspaceHandlerThreadInspector,
  WorkspaceHandlerThreadSummary,
  WorkspaceArtifactPreview,
  WorkspaceProjectCiStatusPanel,
  WorkspaceSessionNavigationReadModel,
  WorkspaceSessionSummary,
  WorkspaceSyncMessage,
  WorkspaceWorkflowTaskAttemptInspector,
} from "../shared/workspace-contract";
import {
  createChatStorage,
  type ChatStorage,
  type WorkspaceInspectorSelection,
  type WorkspaceUiRestoreState,
} from "./chat-storage";
import { DEFAULT_AGENT_SETTINGS, type ReasoningEffort } from "../shared/agent-settings";
import type { SessionAgentKey, SessionMode } from "../shared/agent-settings";
import {
  bindPane,
  closePane,
  createEmptyPaneLayout,
  focusPane,
  movePaneToSpanningRow,
  normalizePaneLayout,
  placePane,
  PRIMARY_CHAT_PANE_ID,
  resizeTrack,
  setPaneInspectorSelection as setLayoutPaneInspectorSelection,
  setPaneScroll as setLayoutPaneScroll,
  splitPane,
  type PaneOpenTarget,
  type PanePlacementZone,
  type PaneResizeAxis,
  type PaneSpanPlacement,
  type PaneSplitDirection,
  type WorkspacePaneLayoutState,
} from "./pane-layout";
import { rpc } from "./rpc";
import { buildWorkspaceSessionNavigation } from "./session-state";

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

type ChatRuntimeListener = () => void;
type PromptStatus = ConversationSurfaceSnapshot["promptStatus"];

export interface ChatPaneState {
  id: string;
  target: PromptTarget | null;
  inspectorSelection: WorkspaceInspectorSelection | null;
  scroll: ChatPaneLayoutState["panes"][number]["localState"]["scroll"];
  columnStart: number;
  columnEnd: number;
  rowStart: number;
  rowEnd: number;
  timelineDensity: "compact" | "comfortable";
}

export type ChatPaneLayoutState = WorkspacePaneLayoutState;

export interface ChatSurfaceController {
  agent: Agent;
  target: PromptTarget;
  resolvedSystemPrompt: string;
  sessionMode: SessionMode;
  sessionAgentKey: SessionAgentKey;
  promptStatus: PromptStatus;
  ownerPaneIds: string[];
  abort: () => Promise<void>;
  subscribe: (listener: ChatRuntimeListener) => () => void;
}

interface ChatSurfaceControllerInternal extends ChatSurfaceController {
  attachPane: (paneId: string) => void;
  detachPane: (paneId: string) => void;
  applySnapshot: (snapshot: ConversationSurfaceSnapshot) => void;
  dispose: () => void;
}

export interface ChatRuntimeRpcClient {
  request: {
    getDefaults: typeof rpc.request.getDefaults;
    getAgentSettings: typeof rpc.request.getAgentSettings;
    updateSessionAgentDefault: typeof rpc.request.updateSessionAgentDefault;
    updateWorkflowAgent: typeof rpc.request.updateWorkflowAgent;
    ensureWorkflowAgentsComponent: typeof rpc.request.ensureWorkflowAgentsComponent;
    getProviderAuthState: typeof rpc.request.getProviderAuthState;
    getWorkspaceInfo: typeof rpc.request.getWorkspaceInfo;
    listWorkspacePaths: typeof rpc.request.listWorkspacePaths;
    openWorkspacePath: typeof rpc.request.openWorkspacePath;
    listSessions: typeof rpc.request.listSessions;
    getCommandInspector: typeof rpc.request.getCommandInspector;
    listHandlerThreads: typeof rpc.request.listHandlerThreads;
    getHandlerThreadInspector: typeof rpc.request.getHandlerThreadInspector;
    getWorkflowTaskAttemptInspector: typeof rpc.request.getWorkflowTaskAttemptInspector;
    getProjectCiStatus: typeof rpc.request.getProjectCiStatus;
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
    setArchivedGroupCollapsed: typeof rpc.request.setArchivedGroupCollapsed;
    sendPrompt: typeof rpc.request.sendPrompt;
    setSurfaceModel: typeof rpc.request.setSurfaceModel;
    setSurfaceThoughtLevel: typeof rpc.request.setSurfaceThoughtLevel;
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
  onMissingProviderAccess?: (provider: string) => void;
}

export interface ChatRuntime {
  storage: ChatStorage;
  workspaceId: string;
  workspaceLabel: string;
  branch?: string;
  sessions: WorkspaceSessionSummary[];
  sessionNavigation: WorkspaceSessionNavigationReadModel;
  paneLayout: ChatPaneLayoutState;
  primaryPaneId: string;
  dispose: () => void;
  subscribe: (listener: ChatRuntimeListener) => () => void;
  listSessions: () => Promise<WorkspaceSessionSummary[]>;
  getPane: (paneId: string) => ChatPaneState | undefined;
  getPaneController: (paneId: string) => ChatSurfaceController | null;
  getSurfaceController: (surfacePiSessionId: string) => ChatSurfaceController | null;
  focusPane: (paneId: string) => void;
  splitPane: (
    paneId: string,
    direction: PaneSplitDirection,
    options?: { duplicateBinding?: boolean; size?: number },
  ) => Promise<string | null>;
  movePaneToSpanningRow: (paneId: string, placement: PaneSpanPlacement) => void;
  placePane: (
    sourcePaneId: string,
    targetPaneId: string,
    zone: PanePlacementZone,
    options?: { duplicateBinding?: boolean; size?: number },
  ) => void;
  resizePaneTrack: (axis: PaneResizeAxis, trackIndex: number, deltaPercent: number) => void;
  closePane: (paneId: string) => Promise<void>;
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
  getProjectCiStatus: (sessionId?: string) => Promise<WorkspaceProjectCiStatusPanel>;
  getArtifactPreview: (artifactId: string, sessionId?: string) => Promise<WorkspaceArtifactPreview>;
  createSession: (
    request?: CreateSessionRequest,
    openTarget?: PaneOpenTarget | string,
  ) => Promise<void>;
  openSession: (sessionId: string, openTarget?: PaneOpenTarget | string) => Promise<void>;
  openSurface: (target: PromptTarget, openTarget?: PaneOpenTarget | string) => Promise<void>;
  closePaneSurface: (paneId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  forkSession: (
    sessionId: string,
    title?: string,
    openTarget?: PaneOpenTarget | string,
  ) => Promise<void>;
  deleteSession: (sessionId: string, paneId?: string) => Promise<void>;
  pinSession: (sessionId: string) => Promise<void>;
  unpinSession: (sessionId: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  unarchiveSession: (sessionId: string) => Promise<void>;
  setArchivedGroupCollapsed: (collapsed: boolean) => Promise<void>;
  setPaneInspectorSelection: (
    paneId: string,
    selection: WorkspaceInspectorSelection | null,
  ) => void;
  setPaneScroll: (
    paneId: string,
    scroll: ChatPaneLayoutState["panes"][number]["localState"]["scroll"],
  ) => void;
  sendPromptToTarget: (target: PromptTarget, input: string) => Promise<void>;
  syncProviderAuth: (providerId: string) => Promise<boolean>;
  requireProviderAccess: (providerId: string) => Promise<boolean>;
  listConfiguredProviders: () => Promise<string[]>;
  listWorkspacePaths: (options?: { refresh?: boolean }) => Promise<WorkspacePathIndexEntry[]>;
  openWorkspacePath: (workspaceRelativePath: string) => Promise<boolean>;
}

function createRpcStreamId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter((message): message is Message => {
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
  });
}

function applySurfaceSnapshotToAgent(agent: Agent, payload: ConversationSurfaceSnapshot): void {
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
  agent.replaceMessages(payload.messages);
  agent.setTools(currentTools);
}

function createInitialAgent(snapshot: ConversationSurfaceSnapshot, streamFn: StreamFn): Agent {
  const agent = new Agent({
    initialState: {
      systemPrompt: snapshot.systemPrompt,
      model: getModel(
        snapshot.provider as Parameters<typeof getModel>[0],
        snapshot.model as Parameters<typeof getModel>[1],
      ),
      thinkingLevel: snapshot.reasoningEffort,
      messages: structuredClone(snapshot.messages),
      tools: [],
    },
    convertToLlm,
    streamFn,
  });
  agent.sessionId = snapshot.target.surfacePiSessionId;
  return agent;
}

class SurfaceControllerImpl implements ChatSurfaceControllerInternal {
  agent: Agent;
  target: PromptTarget;
  resolvedSystemPrompt: string;
  sessionMode: SessionMode;
  sessionAgentKey: SessionAgentKey;
  promptStatus: PromptStatus;

  private listeners = new Set<ChatRuntimeListener>();
  private paneIds = new Set<string>();
  private disposed = false;
  private promptDispatchInFlight = false;
  private applyingSnapshot = false;
  private suppressSurfaceMutationSync = false;
  private pendingSnapshot: ConversationSurfaceSnapshot | null = null;

  constructor(
    snapshot: ConversationSurfaceSnapshot,
    private readonly rpcClient: ChatRuntimeRpcClient,
  ) {
    this.target = normalizePromptTarget(snapshot.target);
    this.resolvedSystemPrompt = snapshot.resolvedSystemPrompt;
    this.sessionMode = snapshot.sessionMode;
    this.sessionAgentKey = snapshot.sessionAgentKey;
    this.promptStatus = snapshot.promptStatus;
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

      if (!this.promptDispatchInFlight) {
        this.promptStatus = this.agent.state.isStreaming ? "streaming" : "idle";
      }

      if (!this.agent.state.isStreaming && this.pendingSnapshot) {
        const pendingSnapshot = this.pendingSnapshot;
        this.pendingSnapshot = null;
        this.applySnapshot(pendingSnapshot);
        return;
      }

      this.emit();
    });
  }

  get ownerPaneIds(): string[] {
    return Array.from(this.paneIds);
  }

  subscribe(listener: ChatRuntimeListener): () => void {
    this.listeners.add(listener);
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  }

  attachPane(paneId: string): void {
    this.paneIds.add(paneId);
    this.emit();
  }

  detachPane(paneId: string): void {
    this.paneIds.delete(paneId);
    this.emit();
  }

  applySnapshot(snapshot: ConversationSurfaceSnapshot): void {
    if (this.disposed) {
      return;
    }

    if (this.promptDispatchInFlight) {
      this.pendingSnapshot = structuredClone(snapshot);
      this.resolvedSystemPrompt = snapshot.resolvedSystemPrompt;
      this.target = normalizePromptTarget(snapshot.target);
      this.sessionMode = snapshot.sessionMode;
      this.sessionAgentKey = snapshot.sessionAgentKey;
      this.emit();
      return;
    }

    this.pendingSnapshot = null;
    this.target = normalizePromptTarget(snapshot.target);
    this.resolvedSystemPrompt = snapshot.resolvedSystemPrompt;
    this.sessionMode = snapshot.sessionMode;
    this.sessionAgentKey = snapshot.sessionAgentKey;
    this.promptStatus = snapshot.promptStatus;

    this.suppressSurfaceMutationSync = true;
    this.applyingSnapshot = true;
    try {
      applySurfaceSnapshotToAgent(this.agent, snapshot);
    } finally {
      this.applyingSnapshot = false;
      this.suppressSurfaceMutationSync = false;
    }
    this.emit();
  }

  async abort(): Promise<void> {
    try {
      await this.rpcClient.request.cancelPrompt({ target: this.target });
    } catch (error) {
      console.error("Failed to cancel prompt:", error);
    } finally {
      this.agent.abort();
    }
  }

  dispose(): void {
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
    return async (model, context, streamOptions) => {
      const stream = createAssistantMessageEventStream();
      const reasoningEffort =
        (streamOptions?.reasoning as ReasoningEffort | undefined) ??
        DEFAULT_AGENT_SETTINGS.reasoningEffort;
      const request: SendPromptRequest = {
        streamId: createRpcStreamId(),
        messages: context.messages as Message[],
        provider: model.provider,
        model: model.id,
        reasoningEffort,
        target: this.target,
        systemPrompt: context.systemPrompt,
      };
      const provider = request.provider ?? DEFAULT_AGENT_SETTINGS.provider;
      const modelId = request.model ?? DEFAULT_AGENT_SETTINGS.model;
      if (this.promptDispatchInFlight) {
        queueMicrotask(() => {
          const failure = createFailureMessage(
            new Error("Prompt dispatch already in flight."),
            provider,
            modelId,
            "error",
          );
          this.agent.state.error = failure.errorMessage;
          stream.push({
            type: "error",
            reason: "error",
            error: failure,
          });
        });
        return stream;
      }

      const activeStreamId = request.streamId;
      let completed = false;

      const cleanup = () => {
        this.rpcClient.removeMessageListener("sendStreamEvent", streamListener);
        if (streamOptions?.signal) {
          streamOptions.signal.removeEventListener("abort", abort);
        }
      };

      const finish = (): void => {
        this.promptDispatchInFlight = false;
        this.promptStatus = this.agent.state.isStreaming ? "streaming" : "idle";
        if (!this.agent.state.isStreaming && this.pendingSnapshot) {
          const pendingSnapshot = this.pendingSnapshot;
          this.pendingSnapshot = null;
          this.applySnapshot(pendingSnapshot);
          return;
        }
        this.emit();
      };

      const finishWithError = (stopReason: "aborted" | "error", error: unknown): void => {
        if (completed) {
          return;
        }
        completed = true;
        cleanup();
        const failure = createFailureMessage(error, provider, modelId, stopReason);
        this.agent.state.error = failure.errorMessage;
        this.promptDispatchInFlight = false;
        this.promptStatus = "idle";
        stream.push({
          type: "error",
          reason: stopReason,
          error: failure,
        });
        this.emit();
      };

      const handleStreamPayload = (payload: { streamId: string; event: AssistantMessageEvent }) => {
        if (completed || payload.streamId !== activeStreamId) {
          return;
        }

        stream.push(payload.event);
        if (payload.event.type === "done" || payload.event.type === "error") {
          completed = true;
          cleanup();
          finish();
        }
      };

      const streamListener = (payload: { streamId: string; event: AssistantMessageEvent }) => {
        handleStreamPayload(payload);
      };

      const abort = (): void => {
        if (completed) {
          return;
        }
        void this.rpcClient.request.cancelPrompt({ target: this.target });
        finishWithError("aborted", new Error("Request aborted by user"));
      };

      this.promptDispatchInFlight = true;
      this.promptStatus = "streaming";
      this.emit();

      this.rpcClient.addMessageListener("sendStreamEvent", streamListener);
      if (streamOptions?.signal) {
        streamOptions.signal.addEventListener("abort", abort, { once: true });
        if (streamOptions.signal.aborted) {
          abort();
        }
      }

      void (async () => {
        try {
          const response = await this.rpcClient.request.sendPrompt(request);
          this.target = normalizePromptTarget(response.target);
          this.agent.sessionId = response.target.surfacePiSessionId;
          this.emit();

          if (streamOptions?.signal?.aborted) {
            abort();
          }
        } catch (error) {
          finishWithError("error", error);
        }
      })();

      return stream;
    };
  }

  private async syncSurfaceModel(providerId: string, modelId: string): Promise<void> {
    try {
      const response = await this.rpcClient.request.setSurfaceModel({
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
}

export async function createChatRuntime(
  options: ChatRuntimeOptions = {},
  rpcClient: ChatRuntimeRpcClient = DEFAULT_RPC_CLIENT,
  storageOverride?: ChatStorage,
): Promise<ChatRuntime> {
  const storage = storageOverride ?? initializeStorage();
  const listeners = new Set<ChatRuntimeListener>();
  const surfaceControllers = new Map<string, ChatSurfaceControllerInternal>();
  let sessions: WorkspaceSessionSummary[] = [];
  let sessionNavigation: WorkspaceSessionNavigationReadModel = buildWorkspaceSessionNavigation([]);
  let paneLayout = createEmptyPaneLayout();
  let disposed = false;

  const emit = () => {
    if (disposed) {
      return;
    }

    for (const listener of listeners) {
      listener();
    }
  };

  const persistWorkspaceUiRestore = (): void => {
    if (disposed) {
      return;
    }

    const state: WorkspaceUiRestoreState = {
      version: 2,
      columns: paneLayout.columns,
      rows: paneLayout.rows,
      panes: paneLayout.panes,
      compactSurfaces: paneLayout.compactSurfaces,
      focusedPaneId: paneLayout.focusedPaneId,
      updatedAt: new Date().toISOString(),
    };

    void storage.workspaceUiRestore
      .set(workspaceInfo.workspaceId, state)
      .catch((error) => console.error("Failed to persist workspace UI restore state:", error));
  };

  const syncPaneTargetForSurface = (target: PromptTarget): void => {
    const normalizedTarget = normalizePromptTarget(target);
    paneLayout = {
      ...paneLayout,
      panes: paneLayout.panes.map((pane) =>
        pane.binding?.surfacePiSessionId === normalizedTarget.surfacePiSessionId
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

    const controller = new SurfaceControllerImpl(snapshot, rpcClient);
    surfaceControllers.set(surfacePiSessionId, controller);
    return controller;
  };

  const clearPaneBinding = (paneId: string): void => {
    const target = paneLayout.panes.find((pane) => pane.paneId === paneId)?.binding ?? null;
    if (!target) {
      return;
    }

    paneLayout = bindPane(paneLayout, paneId, null);
    surfaceControllers.get(target.surfacePiSessionId)?.detachPane(paneId);
    persistWorkspaceUiRestore();
  };

  const releasePaneSurface = async (paneId: string, target: PromptTarget | null): Promise<void> => {
    if (!target) {
      return;
    }

    const controller = surfaceControllers.get(target.surfacePiSessionId);
    controller?.detachPane(paneId);
    if (controller && controller.ownerPaneIds.length > 0) {
      return;
    }

    try {
      await rpcClient.request.closeSurface({ target });
    } catch (error) {
      console.error("Failed to close surface:", error);
    }
  };

  const reconcileControllerPaneOwners = (
    previousLayout: ChatPaneLayoutState,
    nextLayout: ChatPaneLayoutState,
  ): void => {
    for (const pane of previousLayout.panes) {
      if (pane.binding) {
        surfaceControllers.get(pane.binding.surfacePiSessionId)?.detachPane(pane.paneId);
      }
    }
    for (const pane of nextLayout.panes) {
      if (pane.binding) {
        surfaceControllers.get(pane.binding.surfacePiSessionId)?.attachPane(pane.paneId);
      }
    }
  };

  const bindPaneToSnapshot = async (
    paneId: string,
    snapshot: ConversationSurfaceSnapshot,
    bindOptions: { focus?: boolean; persist?: boolean } = {},
  ): Promise<void> => {
    const focus = bindOptions.focus ?? true;
    const persist = bindOptions.persist ?? true;
    const previousFocusedPaneId = paneLayout.focusedPaneId;
    const previousTarget = paneLayout.panes.find((pane) => pane.paneId === paneId)?.binding ?? null;
    const nextTarget = normalizePromptTarget(snapshot.target);
    if (previousTarget?.surfacePiSessionId === nextTarget.surfacePiSessionId) {
      paneLayout = bindPane(paneLayout, paneId, nextTarget);
      if (!focus) {
        paneLayout = { ...paneLayout, focusedPaneId: previousFocusedPaneId };
      }
      upsertSurfaceController({ ...snapshot, target: nextTarget });
      emit();
      if (persist) {
        persistWorkspaceUiRestore();
      }
      return;
    }

    const controller = upsertSurfaceController({ ...snapshot, target: nextTarget });
    paneLayout = bindPane(paneLayout, paneId, nextTarget);
    if (!focus) {
      paneLayout = { ...paneLayout, focusedPaneId: previousFocusedPaneId };
    }
    controller.attachPane(paneId);
    emit();

    if (previousTarget) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(paneId);
    }
    if (persist) {
      persistWorkspaceUiRestore();
    }
  };

  const bindPaneToExistingController = (
    paneId: string,
    controller: ChatSurfaceControllerInternal,
  ): void => {
    const previousTarget = paneLayout.panes.find((pane) => pane.paneId === paneId)?.binding ?? null;
    const nextTarget = normalizePromptTarget(controller.target);
    paneLayout = bindPane(paneLayout, paneId, nextTarget);
    controller.attachPane(paneId);
    emit();

    if (previousTarget && previousTarget.surfacePiSessionId !== nextTarget.surfacePiSessionId) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(paneId);
    }
    persistWorkspaceUiRestore();
  };

  const refreshSessions = async (): Promise<WorkspaceSessionSummary[]> => {
    const response = await rpcClient.request.listSessions();
    sessions = response.sessions;
    sessionNavigation = response.navigation;
    emit();
    return sessions;
  };

  const getSelectedSessionId = (sessionId?: string): string | undefined => {
    if (sessionId) {
      return sessionId;
    }

    const focusedTarget =
      paneLayout.panes.find((pane) => pane.paneId === paneLayout.focusedPaneId)?.binding ?? null;
    return focusedTarget?.workspaceSessionId;
  };

  const syncProviderAuth = async (providerId: string): Promise<boolean> => {
    const auth = await rpcClient.request.getProviderAuthState({ providerId });
    if (auth.connected) {
      await storage.providerKeys.set(providerId, auth.accountId || "oauth");
      return true;
    }

    await storage.providerKeys.delete(providerId);
    return false;
  };

  const requireProviderAccess = async (providerId: string): Promise<boolean> => {
    const hasAccess = await syncProviderAuth(providerId);
    if (!hasAccess) {
      options.onMissingProviderAccess?.(providerId);
    }
    return hasAccess;
  };

  const listConfiguredProviders = async (): Promise<string[]> => {
    const auths = await rpcClient.request.listProviderAuths();
    return auths.filter((authInfo) => authInfo.hasKey).map((authInfo) => authInfo.provider);
  };

  const getCommandInspector = async (
    commandId: string,
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceCommandInspector> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before inspecting a command.");
    }

    const inspector = await rpcClient.request.getCommandInspector({
      sessionId,
      commandId,
    });
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

    return await rpcClient.request.listHandlerThreads({ sessionId });
  };

  const getHandlerThreadInspector = async (
    threadId: string,
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceHandlerThreadInspector> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before inspecting a handler thread.");
    }

    const inspector = await rpcClient.request.getHandlerThreadInspector({
      sessionId,
      threadId,
    });
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

    const inspector = await rpcClient.request.getWorkflowTaskAttemptInspector({
      sessionId,
      workflowTaskAttemptId,
    });
    if (!inspector) {
      throw new Error(`Workflow task attempt not found: ${workflowTaskAttemptId}`);
    }

    return inspector;
  };

  const getProjectCiStatus = async (
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceProjectCiStatusPanel> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before loading Project CI status.");
    }

    return await rpcClient.request.getProjectCiStatus({ sessionId });
  };

  const getArtifactPreview = async (
    artifactId: string,
    sessionId = getSelectedSessionId(),
  ): Promise<WorkspaceArtifactPreview> => {
    if (!sessionId) {
      throw new Error("Expected a workspace session before opening an artifact.");
    }

    return await rpcClient.request.getArtifactPreview({ sessionId, artifactId });
  };

  const resolveOpenTarget = (openTarget?: PaneOpenTarget | string): string => {
    const getDefaultNewPaneDirection = (
      requestedDirection: "right" | "below",
    ): "right" | "below" => {
      if (requestedDirection === "below") {
        return "below";
      }
      if (paneLayout.columns.length >= 2) {
        return "below";
      }
      return "right";
    };

    if (typeof openTarget === "string") {
      if (!paneLayout.panes.some((pane) => pane.paneId === openTarget)) {
        const basePaneId =
          paneLayout.focusedPaneId ?? paneLayout.panes[0]?.paneId ?? PRIMARY_CHAT_PANE_ID;
        const direction = getDefaultNewPaneDirection("right");
        paneLayout = splitPane(paneLayout, basePaneId, direction, { nextPaneId: openTarget });
        persistWorkspaceUiRestore();
        emit();
      }
      return openTarget;
    }
    if (!openTarget || openTarget.kind === "focused-pane") {
      return paneLayout.focusedPaneId ?? paneLayout.panes[0]?.paneId ?? PRIMARY_CHAT_PANE_ID;
    }
    if (openTarget.kind === "pane") {
      return openTarget.paneId;
    }
    if (openTarget.kind === "split") {
      const before = new Set(paneLayout.panes.map((pane) => pane.paneId));
      paneLayout = splitPane(paneLayout, openTarget.paneId, openTarget.direction, {
        size: openTarget.size,
      });
      persistWorkspaceUiRestore();
      emit();
      return paneLayout.panes.find((pane) => !before.has(pane.paneId))?.paneId ?? openTarget.paneId;
    }
    const basePaneId =
      paneLayout.focusedPaneId ?? paneLayout.panes[0]?.paneId ?? PRIMARY_CHAT_PANE_ID;
    const before = new Set(paneLayout.panes.map((pane) => pane.paneId));
    const direction = getDefaultNewPaneDirection(openTarget.direction);
    paneLayout = splitPane(paneLayout, basePaneId, direction, { size: openTarget.size });
    persistWorkspaceUiRestore();
    emit();
    return paneLayout.panes.find((pane) => !before.has(pane.paneId))?.paneId ?? basePaneId;
  };

  const [defaults, workspaceInfo, initialCatalog] = await Promise.all([
    rpcClient.request.getDefaults(),
    rpcClient.request.getWorkspaceInfo(),
    rpcClient.request.listSessions(),
  ]);
  sessions = initialCatalog.sessions;
  sessionNavigation = initialCatalog.navigation;

  const syncProviderAuthPromise = syncProviderAuth(defaults.provider);
  await syncProviderAuthPromise;

  const restoreState = await storage.workspaceUiRestore
    .get(workspaceInfo.workspaceId)
    .catch((error) => {
      console.error("Failed to load workspace UI restore state:", error);
      return null;
    });
  let restoredPaneIds: string[] = [];
  if (restoreState?.panes.length) {
    const sessionIds = new Set(initialCatalog.sessions.map((session) => session.id));
    paneLayout = normalizePaneLayout(restoreState);
    const hasOnlyRestorablePanes = paneLayout.panes.every(
      (paneState) => !paneState.binding || sessionIds.has(paneState.binding.workspaceSessionId),
    );
    if (!hasOnlyRestorablePanes) {
      paneLayout = createEmptyPaneLayout();
    }
    for (const paneState of paneLayout.panes) {
      if (!paneState.binding || !sessionIds.has(paneState.binding.workspaceSessionId)) {
        continue;
      }

      const target = normalizePromptTarget(paneState.binding);

      try {
        const snapshot =
          target.surface === "orchestrator"
            ? await rpcClient.request.openSession({ sessionId: target.workspaceSessionId })
            : await rpcClient.request.openSurface({ target });
        await bindPaneToSnapshot(paneState.paneId, snapshot, { focus: false, persist: false });
        restoredPaneIds.push(paneState.paneId);
      } catch (error) {
        console.error("Failed to restore workspace pane:", error);
        restoredPaneIds.push(paneState.paneId);
      }
    }
    if (restoredPaneIds.length === 0 && paneLayout.panes.every((paneState) => paneState.binding)) {
      paneLayout = createEmptyPaneLayout();
    }
  }

  if (restoreState?.panes.length && paneLayout.panes.some((paneState) => !paneState.binding)) {
    const focusedPaneId =
      restoreState.focusedPaneId &&
      paneLayout.panes.some((pane) => pane.paneId === restoreState.focusedPaneId)
        ? restoreState.focusedPaneId
        : (paneLayout.panes[0]?.paneId ?? PRIMARY_CHAT_PANE_ID);
    paneLayout = { ...paneLayout, focusedPaneId };
    if (restoredPaneIds.length === 0 && initialCatalog.sessions.length > 0) {
      const [initialSession] = initialCatalog.sessions;
      const snapshot = await rpcClient.request.openSession({ sessionId: initialSession!.id });
      await bindPaneToSnapshot(focusedPaneId, snapshot, { focus: true, persist: false });
    } else if (restoredPaneIds.length === 0) {
      const snapshot = await rpcClient.request.createSession({});
      await bindPaneToSnapshot(focusedPaneId, snapshot, { focus: true, persist: false });
      await refreshSessions();
    }
    persistWorkspaceUiRestore();
    emit();
  } else if (restoredPaneIds.length > 0) {
    paneLayout = {
      ...paneLayout,
      focusedPaneId:
        restoreState?.focusedPaneId && restoredPaneIds.includes(restoreState.focusedPaneId)
          ? restoreState.focusedPaneId
          : restoredPaneIds[0]!,
    };
    persistWorkspaceUiRestore();
    emit();
  } else if (initialCatalog.sessions.length > 0) {
    const [initialSession] = initialCatalog.sessions;
    if (!initialSession) {
      throw new Error("Expected an initial session to open.");
    }
    const snapshot = await rpcClient.request.openSession({ sessionId: initialSession.id });
    await bindPaneToSnapshot(PRIMARY_CHAT_PANE_ID, snapshot);
  } else {
    const snapshot = await rpcClient.request.createSession({});
    await bindPaneToSnapshot(PRIMARY_CHAT_PANE_ID, snapshot);
    await refreshSessions();
  }

  const workspaceSyncListener = (payload: WorkspaceSyncMessage) => {
    sessions = payload.sessions;
    sessionNavigation = payload.navigation;
    emit();
  };

  const surfaceSyncListener = (payload: SurfaceSyncMessage) => {
    syncPaneTargetForSurface(payload.target);
    persistWorkspaceUiRestore();
    if (payload.reason === "surface.closed") {
      for (const pane of paneLayout.panes) {
        if (pane.binding?.surfacePiSessionId === payload.target.surfacePiSessionId) {
          clearPaneBinding(pane.paneId);
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

    if (!payload.snapshot) {
      return;
    }

    upsertSurfaceController(payload.snapshot);
    emit();
  };

  rpcClient.addMessageListener("sendWorkspaceSync", workspaceSyncListener);
  rpcClient.addMessageListener("sendSurfaceSync", surfaceSyncListener);

  const runtime: ChatRuntime = {
    storage,
    workspaceId: workspaceInfo.workspaceId,
    workspaceLabel: workspaceInfo.workspaceLabel,
    branch: workspaceInfo.branch,
    primaryPaneId: PRIMARY_CHAT_PANE_ID,
    get sessions() {
      return sessions;
    },
    get sessionNavigation() {
      return sessionNavigation;
    },
    get paneLayout() {
      return structuredClone(paneLayout);
    },
    dispose: () => {
      disposed = true;
      rpcClient.removeMessageListener("sendWorkspaceSync", workspaceSyncListener);
      rpcClient.removeMessageListener("sendSurfaceSync", surfaceSyncListener);
      for (const controller of surfaceControllers.values()) {
        controller.dispose();
      }
      listeners.clear();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
    listSessions: refreshSessions,
    getPane: (paneId) => {
      const pane = paneLayout.panes.find((candidate) => candidate.paneId === paneId);
      if (!pane) {
        return undefined;
      }
      return {
        id: pane.paneId,
        target: pane.binding ? normalizePromptTarget(pane.binding) : null,
        inspectorSelection: pane.localState.inspectorSelection,
        scroll: pane.localState.scroll,
        columnStart: pane.columnStart,
        columnEnd: pane.columnEnd,
        rowStart: pane.rowStart,
        rowEnd: pane.rowEnd,
        timelineDensity: pane.localState.timelineDensity,
      };
    },
    getPaneController: (paneId) => {
      const target = paneLayout.panes.find((pane) => pane.paneId === paneId)?.binding ?? null;
      if (!target) {
        return null;
      }
      return surfaceControllers.get(target.surfacePiSessionId) ?? null;
    },
    getSurfaceController: (surfacePiSessionId) => {
      return surfaceControllers.get(surfacePiSessionId) ?? null;
    },
    focusPane: (paneId) => {
      paneLayout = focusPane(paneLayout, paneId);
      persistWorkspaceUiRestore();
      emit();
    },
    splitPane: async (paneId, direction, splitOptions = {}) => {
      const before = new Set(paneLayout.panes.map((pane) => pane.paneId));
      const sourceBinding =
        paneLayout.panes.find((pane) => pane.paneId === paneId)?.binding ?? null;
      paneLayout = splitPane(paneLayout, paneId, direction, splitOptions);
      const newPane = paneLayout.panes.find((pane) => !before.has(pane.paneId)) ?? null;
      if (!newPane) {
        return null;
      }
      if (splitOptions.duplicateBinding && sourceBinding) {
        surfaceControllers.get(sourceBinding.surfacePiSessionId)?.attachPane(newPane.paneId);
      }
      persistWorkspaceUiRestore();
      emit();
      return newPane.paneId;
    },
    resizePaneTrack: (axis, trackIndex, deltaPercent) => {
      paneLayout = resizeTrack(paneLayout, axis, trackIndex, deltaPercent);
      persistWorkspaceUiRestore();
      emit();
    },
    placePane: (sourcePaneId, targetPaneId, zone, placementOptions = {}) => {
      const previousLayout = paneLayout;
      paneLayout = placePane(paneLayout, sourcePaneId, targetPaneId, zone, placementOptions);
      reconcileControllerPaneOwners(previousLayout, paneLayout);
      persistWorkspaceUiRestore();
      emit();
    },
    movePaneToSpanningRow: (paneId, placement) => {
      const previousLayout = paneLayout;
      paneLayout = movePaneToSpanningRow(paneLayout, paneId, placement);
      reconcileControllerPaneOwners(previousLayout, paneLayout);
      persistWorkspaceUiRestore();
      emit();
    },
    closePane: async (paneId) => {
      const target = paneLayout.panes.find((pane) => pane.paneId === paneId)?.binding ?? null;
      paneLayout = closePane(paneLayout, paneId);
      persistWorkspaceUiRestore();
      emit();
      await releasePaneSurface(paneId, target);
    },
    getCommandInspector,
    listHandlerThreads,
    getHandlerThreadInspector,
    getWorkflowTaskAttemptInspector,
    getProjectCiStatus,
    getArtifactPreview,
    createSession: async (request = {}, openTarget) => {
      const nextPaneId = resolveOpenTarget(openTarget);
      const snapshot = await rpcClient.request.createSession(request);
      await bindPaneToSnapshot(nextPaneId, snapshot);
      await refreshSessions();
    },
    openSession: async (sessionId, openTarget) => {
      const nextPaneId = resolveOpenTarget(openTarget);
      const currentTarget =
        paneLayout.panes.find((pane) => pane.paneId === nextPaneId)?.binding ?? null;
      if (
        currentTarget?.workspaceSessionId === sessionId &&
        currentTarget.surface === "orchestrator" &&
        currentTarget.surfacePiSessionId === sessionId
      ) {
        paneLayout = focusPane(paneLayout, nextPaneId);
        persistWorkspaceUiRestore();
        emit();
        return;
      }

      const existingController = surfaceControllers.get(sessionId);
      if (existingController) {
        bindPaneToExistingController(nextPaneId, existingController);
        void rpcClient.request.recordSessionOpened({ sessionId });
        return;
      }

      const snapshot = await rpcClient.request.openSession({ sessionId });
      await bindPaneToSnapshot(nextPaneId, snapshot);
    },
    openSurface: async (target, openTarget) => {
      const nextPaneId = resolveOpenTarget(openTarget);
      const normalizedTarget = normalizePromptTarget(target);
      const currentTarget =
        paneLayout.panes.find((pane) => pane.paneId === nextPaneId)?.binding ?? null;
      if (currentTarget?.surfacePiSessionId === normalizedTarget.surfacePiSessionId) {
        paneLayout = bindPane(paneLayout, nextPaneId, normalizedTarget);
        surfaceControllers.get(normalizedTarget.surfacePiSessionId)?.attachPane(nextPaneId);
        persistWorkspaceUiRestore();
        emit();
        return;
      }

      const existingController = surfaceControllers.get(normalizedTarget.surfacePiSessionId);
      if (existingController) {
        bindPaneToExistingController(nextPaneId, existingController);
        return;
      }

      const snapshot = await rpcClient.request.openSurface({ target: normalizedTarget });
      await bindPaneToSnapshot(nextPaneId, snapshot);
    },
    closePaneSurface: async (paneId) => {
      const target = paneLayout.panes.find((pane) => pane.paneId === paneId)?.binding ?? null;
      if (!target) {
        return;
      }

      clearPaneBinding(paneId);
      emit();
      await releasePaneSurface(paneId, target);
    },
    renameSession: async (sessionId, title) => {
      await rpcClient.request.renameSession({ sessionId, title });
      await refreshSessions();
    },
    forkSession: async (sessionId, title, openTarget) => {
      const nextPaneId = resolveOpenTarget(openTarget);
      const snapshot = await rpcClient.request.forkSession({ sessionId, title });
      await bindPaneToSnapshot(nextPaneId, snapshot);
      await refreshSessions();
    },
    deleteSession: async (sessionId, paneId) => {
      const fallbackPaneId =
        paneId ?? paneLayout.focusedPaneId ?? paneLayout.panes[0]?.paneId ?? PRIMARY_CHAT_PANE_ID;
      const affectedPaneIds = new Set<string>();
      for (const pane of paneLayout.panes) {
        if (pane.binding?.workspaceSessionId === sessionId) {
          affectedPaneIds.add(pane.paneId);
        }
      }

      await rpcClient.request.deleteSession({ sessionId });

      for (const candidatePaneId of affectedPaneIds) {
        clearPaneBinding(candidatePaneId);
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

        await runtime.createSession({}, fallbackPaneId);
        return;
      }

      emit();
    },
    pinSession: async (sessionId) => {
      await rpcClient.request.pinSession({ sessionId });
      await refreshSessions();
    },
    unpinSession: async (sessionId) => {
      await rpcClient.request.unpinSession({ sessionId });
      await refreshSessions();
    },
    archiveSession: async (sessionId) => {
      await rpcClient.request.archiveSession({ sessionId });
      await refreshSessions();
    },
    unarchiveSession: async (sessionId) => {
      await rpcClient.request.unarchiveSession({ sessionId });
      await refreshSessions();
    },
    setArchivedGroupCollapsed: async (collapsed) => {
      await rpcClient.request.setArchivedGroupCollapsed({ collapsed });
      await refreshSessions();
    },
    setPaneInspectorSelection: (paneId, selection) => {
      paneLayout = setLayoutPaneInspectorSelection(paneLayout, paneId, selection);
      persistWorkspaceUiRestore();
      emit();
    },
    setPaneScroll: (paneId, scroll) => {
      paneLayout = setLayoutPaneScroll(paneLayout, paneId, scroll);
      persistWorkspaceUiRestore();
    },
    sendPromptToTarget: async (target, input) => {
      const text = input.trim();
      if (!text) {
        return;
      }
      await rpcClient.request.sendPrompt({
        streamId: createRpcStreamId(),
        messages: [{ role: "user", content: text } as Message],
        target: normalizePromptTarget(target),
      });
    },
    syncProviderAuth,
    requireProviderAccess,
    listConfiguredProviders,
    listWorkspacePaths: (options) => rpcClient.request.listWorkspacePaths(options),
    openWorkspacePath: async (workspaceRelativePath) => {
      const result = await rpcClient.request.openWorkspacePath({ workspaceRelativePath });
      return result.opened;
    },
  };

  return runtime;
}
