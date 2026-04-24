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
  WorkspaceHandlerThreadInspector,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
  WorkspaceSyncMessage,
  WorkspaceWorkflowTaskAttemptInspector,
} from "./chat-rpc";
import { createChatStorage, type ChatStorage } from "./chat-storage";
import { DEFAULT_CHAT_SETTINGS, type ReasoningEffort } from "./chat-settings";
import { rpc } from "./rpc";

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

export const PRIMARY_CHAT_PANE_ID = "primary";

export interface ChatPaneState {
  id: string;
  target: PromptTarget | null;
}

export interface ChatPaneLayoutState {
  panes: ChatPaneState[];
  focusedPaneId: string;
}

export interface ChatSurfaceController {
  agent: Agent;
  target: PromptTarget;
  resolvedSystemPrompt: string;
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
    getProviderAuthState: typeof rpc.request.getProviderAuthState;
    getWorkspaceInfo: typeof rpc.request.getWorkspaceInfo;
    listSessions: typeof rpc.request.listSessions;
    getCommandInspector: typeof rpc.request.getCommandInspector;
    listHandlerThreads: typeof rpc.request.listHandlerThreads;
    getHandlerThreadInspector: typeof rpc.request.getHandlerThreadInspector;
    getWorkflowTaskAttemptInspector: typeof rpc.request.getWorkflowTaskAttemptInspector;
    createSession: typeof rpc.request.createSession;
    openSession: typeof rpc.request.openSession;
    openSurface: typeof rpc.request.openSurface;
    closeSurface: typeof rpc.request.closeSurface;
    renameSession: typeof rpc.request.renameSession;
    forkSession: typeof rpc.request.forkSession;
    deleteSession: typeof rpc.request.deleteSession;
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
  paneLayout: ChatPaneLayoutState;
  primaryPaneId: string;
  dispose: () => void;
  subscribe: (listener: ChatRuntimeListener) => () => void;
  listSessions: () => Promise<WorkspaceSessionSummary[]>;
  getPane: (paneId: string) => ChatPaneState | undefined;
  getPaneController: (paneId: string) => ChatSurfaceController | null;
  getSurfaceController: (surfacePiSessionId: string) => ChatSurfaceController | null;
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
  createSession: (request?: CreateSessionRequest, paneId?: string) => Promise<void>;
  openSession: (sessionId: string, paneId?: string) => Promise<void>;
  openSurface: (target: PromptTarget, paneId?: string) => Promise<void>;
  closePaneSurface: (paneId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  forkSession: (sessionId: string, title?: string, paneId?: string) => Promise<void>;
  deleteSession: (sessionId: string, paneId?: string) => Promise<void>;
  sendPromptToTarget: (target: PromptTarget, input: string) => Promise<void>;
  syncProviderAuth: (providerId: string) => Promise<boolean>;
  requireProviderAccess: (providerId: string) => Promise<boolean>;
  listConfiguredProviders: () => Promise<string[]>;
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
    this.promptStatus = snapshot.promptStatus;
    this.agent = createInitialAgent(snapshot, this.createStreamFn());

    const originalSetModel = this.agent.setModel.bind(this.agent);
    this.agent.setModel = (nextModel) => {
      originalSetModel(nextModel);
      if (!this.suppressSurfaceMutationSync) {
        void this.syncSurfaceModel(nextModel.id);
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

    if (this.promptDispatchInFlight && snapshot.promptStatus === "streaming") {
      this.pendingSnapshot = structuredClone(snapshot);
      this.resolvedSystemPrompt = snapshot.resolvedSystemPrompt;
      this.target = normalizePromptTarget(snapshot.target);
      this.emit();
      return;
    }

    this.pendingSnapshot = null;
    this.target = normalizePromptTarget(snapshot.target);
    this.resolvedSystemPrompt = snapshot.resolvedSystemPrompt;
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
        DEFAULT_CHAT_SETTINGS.reasoningEffort;
      const request: SendPromptRequest = {
        streamId: createRpcStreamId(),
        messages: context.messages as Message[],
        provider: model.provider,
        model: model.id,
        reasoningEffort,
        target: this.target,
        systemPrompt: context.systemPrompt,
      };
      const provider = request.provider ?? DEFAULT_CHAT_SETTINGS.provider;
      const modelId = request.model ?? DEFAULT_CHAT_SETTINGS.model;
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

  private async syncSurfaceModel(modelId: string): Promise<void> {
    try {
      const response = await this.rpcClient.request.setSurfaceModel({
        target: this.target,
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
  const paneTargets = new Map<string, PromptTarget | null>([[PRIMARY_CHAT_PANE_ID, null]]);
  const surfaceControllers = new Map<string, ChatSurfaceControllerInternal>();
  let sessions: WorkspaceSessionSummary[] = [];
  let focusedPaneId = PRIMARY_CHAT_PANE_ID;
  let disposed = false;

  const emit = () => {
    if (disposed) {
      return;
    }

    for (const listener of listeners) {
      listener();
    }
  };

  const ensurePane = (paneId: string): void => {
    if (!paneTargets.has(paneId)) {
      paneTargets.set(paneId, null);
    }
  };

  const syncPaneTargetForSurface = (target: PromptTarget): void => {
    const normalizedTarget = normalizePromptTarget(target);
    for (const [paneId, currentTarget] of paneTargets.entries()) {
      if (currentTarget?.surfacePiSessionId === normalizedTarget.surfacePiSessionId) {
        paneTargets.set(paneId, normalizedTarget);
      }
    }
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
    const target = paneTargets.get(paneId);
    if (!target) {
      return;
    }

    paneTargets.set(paneId, null);
    surfaceControllers.get(target.surfacePiSessionId)?.detachPane(paneId);
  };

  const releasePaneSurface = async (paneId: string, target: PromptTarget | null): Promise<void> => {
    if (!target) {
      return;
    }

    surfaceControllers.get(target.surfacePiSessionId)?.detachPane(paneId);
    try {
      await rpcClient.request.closeSurface({ target });
    } catch (error) {
      console.error("Failed to close surface:", error);
    }
  };

  const bindPaneToSnapshot = async (
    paneId: string,
    snapshot: ConversationSurfaceSnapshot,
  ): Promise<void> => {
    ensurePane(paneId);
    focusedPaneId = paneId;
    const previousTarget = paneTargets.get(paneId) ?? null;
    const nextTarget = normalizePromptTarget(snapshot.target);
    if (previousTarget?.surfacePiSessionId === nextTarget.surfacePiSessionId) {
      paneTargets.set(paneId, nextTarget);
      upsertSurfaceController({ ...snapshot, target: nextTarget });
      emit();
      return;
    }

    const controller = upsertSurfaceController({ ...snapshot, target: nextTarget });
    paneTargets.set(paneId, nextTarget);
    controller.attachPane(paneId);
    emit();

    if (previousTarget) {
      surfaceControllers.get(previousTarget.surfacePiSessionId)?.detachPane(paneId);
    }
  };

  const refreshSessions = async (): Promise<WorkspaceSessionSummary[]> => {
    sessions = (await rpcClient.request.listSessions()).sessions;
    emit();
    return sessions;
  };

  const getSelectedSessionId = (sessionId?: string): string | undefined => {
    if (sessionId) {
      return sessionId;
    }

    const focusedTarget = paneTargets.get(focusedPaneId);
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

  const resolvePaneId = (paneId?: string): string => {
    const nextPaneId = paneId ?? focusedPaneId ?? PRIMARY_CHAT_PANE_ID;
    ensurePane(nextPaneId);
    return nextPaneId;
  };

  const [defaults, workspaceInfo, initialCatalog] = await Promise.all([
    rpcClient.request.getDefaults(),
    rpcClient.request.getWorkspaceInfo(),
    rpcClient.request.listSessions(),
  ]);
  sessions = initialCatalog.sessions;

  const syncProviderAuthPromise = syncProviderAuth(defaults.provider);
  await syncProviderAuthPromise;

  if (initialCatalog.sessions.length > 0) {
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
    emit();
  };

  const surfaceSyncListener = (payload: SurfaceSyncMessage) => {
    syncPaneTargetForSurface(payload.target);
    if (payload.reason === "surface.closed") {
      for (const [paneId, target] of paneTargets.entries()) {
        if (target?.surfacePiSessionId === payload.target.surfacePiSessionId) {
          clearPaneBinding(paneId);
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
    get paneLayout() {
      return {
        panes: Array.from(paneTargets.entries()).map(([id, target]) => ({
          id,
          target: target ? normalizePromptTarget(target) : null,
        })),
        focusedPaneId,
      };
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
      const target = paneTargets.get(paneId);
      if (typeof target === "undefined") {
        return undefined;
      }
      return {
        id: paneId,
        target: target ? normalizePromptTarget(target) : null,
      };
    },
    getPaneController: (paneId) => {
      const target = paneTargets.get(paneId);
      if (!target) {
        return null;
      }
      return surfaceControllers.get(target.surfacePiSessionId) ?? null;
    },
    getSurfaceController: (surfacePiSessionId) => {
      return surfaceControllers.get(surfacePiSessionId) ?? null;
    },
    getCommandInspector,
    listHandlerThreads,
    getHandlerThreadInspector,
    getWorkflowTaskAttemptInspector,
    createSession: async (request = {}, paneId) => {
      const nextPaneId = resolvePaneId(paneId);
      const snapshot = await rpcClient.request.createSession(request);
      await bindPaneToSnapshot(nextPaneId, snapshot);
      await refreshSessions();
    },
    openSession: async (sessionId, paneId) => {
      const nextPaneId = resolvePaneId(paneId);
      const currentTarget = paneTargets.get(nextPaneId);
      if (
        currentTarget?.workspaceSessionId === sessionId &&
        currentTarget.surface === "orchestrator" &&
        currentTarget.surfacePiSessionId === sessionId
      ) {
        focusedPaneId = nextPaneId;
        emit();
        return;
      }

      const snapshot = await rpcClient.request.openSession({ sessionId });
      await bindPaneToSnapshot(nextPaneId, snapshot);
    },
    openSurface: async (target, paneId) => {
      const nextPaneId = resolvePaneId(paneId);
      const normalizedTarget = normalizePromptTarget(target);
      const currentTarget = paneTargets.get(nextPaneId);
      if (currentTarget?.surfacePiSessionId === normalizedTarget.surfacePiSessionId) {
        paneTargets.set(nextPaneId, normalizedTarget);
        focusedPaneId = nextPaneId;
        surfaceControllers.get(normalizedTarget.surfacePiSessionId)?.attachPane(nextPaneId);
        emit();
        return;
      }

      const snapshot = await rpcClient.request.openSurface({ target: normalizedTarget });
      await bindPaneToSnapshot(nextPaneId, snapshot);
    },
    closePaneSurface: async (paneId) => {
      const target = paneTargets.get(paneId) ?? null;
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
    forkSession: async (sessionId, title, paneId) => {
      const nextPaneId = resolvePaneId(paneId);
      const snapshot = await rpcClient.request.forkSession({ sessionId, title });
      await bindPaneToSnapshot(nextPaneId, snapshot);
      await refreshSessions();
    },
    deleteSession: async (sessionId, paneId) => {
      const fallbackPaneId = paneId ? resolvePaneId(paneId) : PRIMARY_CHAT_PANE_ID;
      const affectedPaneIds = new Set<string>();
      for (const [candidatePaneId, target] of paneTargets.entries()) {
        if (target?.workspaceSessionId === sessionId) {
          affectedPaneIds.add(candidatePaneId);
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
        if (sessions.length > 0) {
          await runtime.openSession(sessions[0]!.id, fallbackPaneId);
          return;
        }

        await runtime.createSession({}, fallbackPaneId);
        return;
      }

      emit();
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
  };

  return runtime;
}
