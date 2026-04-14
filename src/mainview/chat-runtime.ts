import { Agent, type AgentMessage, type StreamFn } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  getModel,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message,
} from "@mariozechner/pi-ai";
import type {
  ActiveSessionState,
  ActiveSessionSummaryState,
  CreateSessionRequest,
  SendPromptRequest,
  SessionMutationResponse,
  WorkspaceSessionSummary,
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

export interface ChatRuntimeRpcClient {
  request: {
    getDefaults: typeof rpc.request.getDefaults;
    getProviderAuthState: typeof rpc.request.getProviderAuthState;
    getWorkspaceInfo: typeof rpc.request.getWorkspaceInfo;
    listSessions: typeof rpc.request.listSessions;
    getActiveSession: typeof rpc.request.getActiveSession;
    getActiveSessionSummary: typeof rpc.request.getActiveSessionSummary;
    createSession: typeof rpc.request.createSession;
    openSession: typeof rpc.request.openSession;
    renameSession: typeof rpc.request.renameSession;
    forkSession: typeof rpc.request.forkSession;
    deleteSession: typeof rpc.request.deleteSession;
    sendPrompt: typeof rpc.request.sendPrompt;
    setSessionModel: typeof rpc.request.setSessionModel;
    setSessionThoughtLevel: typeof rpc.request.setSessionThoughtLevel;
    cancelPrompt: typeof rpc.request.cancelPrompt;
    listProviderAuths: typeof rpc.request.listProviderAuths;
    setProviderApiKey: typeof rpc.request.setProviderApiKey;
    startOAuth: typeof rpc.request.startOAuth;
    removeProviderAuth: typeof rpc.request.removeProviderAuth;
    getE2eRendererSeed: typeof rpc.request.getE2eRendererSeed;
  };
  addMessageListener: typeof rpc.addMessageListener;
  removeMessageListener: typeof rpc.removeMessageListener;
}

const DEFAULT_RPC_CLIENT: ChatRuntimeRpcClient = rpc;

export interface ChatRuntimeOptions {
  onMissingProviderAccess?: (provider: string) => void;
}

export interface ChatRuntime {
  agent: Agent;
  storage: ChatStorage;
  workspaceId: string;
  workspaceLabel: string;
  branch?: string;
  activeSessionId?: string;
  sessions: WorkspaceSessionSummary[];
  dispose: () => void;
  subscribe: (listener: ChatRuntimeListener) => () => void;
  listSessions: () => Promise<WorkspaceSessionSummary[]>;
  createSession: (request?: CreateSessionRequest) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  forkSession: (sessionId: string, title?: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
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

function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter((message): message is Message => {
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
  });
}

function countVisibleMessages(messages: AgentMessage[]): number {
  return messages.filter((message) => {
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
  }).length;
}

function applyActiveSessionState(agent: Agent, payload: ActiveSessionState): void {
  const currentTools = [...agent.state.tools];
  agent.reset();
  agent.sessionId = payload.session.id;
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

function compareWorkspaceSessionSummaries(
  left: WorkspaceSessionSummary,
  right: WorkspaceSessionSummary,
): number {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function upsertWorkspaceSessionSummary(
  sessions: WorkspaceSessionSummary[],
  summary: WorkspaceSessionSummary,
): WorkspaceSessionSummary[] {
  const nextSessions = sessions.filter((session) => session.id !== summary.id);
  nextSessions.push(summary);
  return nextSessions.toSorted(compareWorkspaceSessionSummaries);
}

function renameWorkspaceSessionSummary(
  sessions: WorkspaceSessionSummary[],
  sessionId: string,
  title: string,
): WorkspaceSessionSummary[] {
  const updatedAt = new Date().toISOString();
  let updated = false;
  const nextSessions = sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }

    updated = true;
    return {
      ...session,
      title,
      updatedAt,
    };
  });

  return updated ? nextSessions.toSorted(compareWorkspaceSessionSummaries) : sessions;
}

function removeWorkspaceSessionSummary(
  sessions: WorkspaceSessionSummary[],
  sessionId: string,
): WorkspaceSessionSummary[] {
  return sessions.filter((session) => session.id !== sessionId);
}

export async function createChatRuntime(
  options: ChatRuntimeOptions = {},
  rpcClient: ChatRuntimeRpcClient = DEFAULT_RPC_CLIENT,
  storageOverride?: ChatStorage,
): Promise<ChatRuntime> {
  const storage = storageOverride ?? initializeStorage();
  const listeners = new Set<ChatRuntimeListener>();
  let sessions: WorkspaceSessionSummary[] = [];
  let activeSessionId: string | undefined;
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    for (const listener of listeners) {
      listener();
    }
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

  const cancelPrompt = async (sessionId?: string): Promise<void> => {
    if (!sessionId) return;
    try {
      await rpcClient.request.cancelPrompt({ sessionId });
    } catch (error) {
      console.error("Failed to cancel prompt:", error);
    }
  };

  const syncSessionModel = async (modelId: string): Promise<void> => {
    const sessionId = agent.sessionId;
    if (!sessionId) return;

    try {
      const response = await rpcClient.request.setSessionModel({ sessionId, model: modelId });
      if (response.ok) {
        agent.sessionId = response.sessionId;
      }
    } catch (error) {
      console.error("Failed to sync session model:", error);
    }
  };

  const syncSessionThoughtLevel = async (level: ReasoningEffort): Promise<void> => {
    const sessionId = agent.sessionId;
    if (!sessionId) return;

    try {
      const response = await rpcClient.request.setSessionThoughtLevel({ sessionId, level });
      if (response.ok) {
        agent.sessionId = response.sessionId;
      }
    } catch (error) {
      console.error("Failed to sync session thought level:", error);
    }
  };

  const applyActiveSessionSnapshot = (payload: ActiveSessionState): void => {
    applyActiveSessionState(agent, payload);
    activeSessionId = payload.session.id;
    sessions = upsertWorkspaceSessionSummary(sessions, payload.session);
  };

  const applyActiveSessionSummary = (payload: ActiveSessionSummaryState): void => {
    activeSessionId = payload.session.id;
    agent.sessionId = payload.session.id;
    agent.setSystemPrompt(payload.systemPrompt);
    agent.setModel(
      getModel(
        payload.provider as Parameters<typeof getModel>[0],
        payload.model as Parameters<typeof getModel>[1],
      ),
    );
    agent.setThinkingLevel(payload.reasoningEffort);
    sessions = upsertWorkspaceSessionSummary(sessions, payload.session);
  };

  const refreshSessions = async (): Promise<WorkspaceSessionSummary[]> => {
    const response = await rpcClient.request.listSessions();
    activeSessionId = response.activeSessionId;
    sessions = response.sessions;
    emit();
    return sessions;
  };

  const applySessionMutation = async (
    response: SessionMutationResponse,
    mutation?: { sessionId: string; title?: string; deleted?: boolean },
  ): Promise<void> => {
    if (response.activeSession) {
      applyActiveSessionSnapshot(response.activeSession);
    } else if (response.activeSessionId && response.activeSessionId !== activeSessionId) {
      const nextActive = await rpcClient.request.getActiveSession();
      if (nextActive) {
        applyActiveSessionSnapshot(nextActive);
      }
    }

    if (mutation?.title && !mutation.deleted) {
      sessions = renameWorkspaceSessionSummary(sessions, mutation.sessionId, mutation.title);
    }

    if (mutation?.deleted) {
      sessions = removeWorkspaceSessionSummary(sessions, mutation.sessionId);
    }

    emit();
  };

  const openActiveSession = async (payload: ActiveSessionState): Promise<void> => {
    applyActiveSessionSnapshot(payload);
    emit();
  };

  const syncSettledActiveSessionState = async (sessionId?: string): Promise<void> => {
    const nextActive = await rpcClient.request.getActiveSessionSummary();
    if (!nextActive) {
      await refreshSessions();
      return;
    }

    if (sessionId && nextActive.session.id !== sessionId) {
      await refreshSessions();
      return;
    }

    if (nextActive.session.messageCount > countVisibleMessages(agent.state.messages)) {
      const nextSnapshot = await rpcClient.request.getActiveSession();
      if (!nextSnapshot) {
        await refreshSessions();
        return;
      }

      if (sessionId && nextSnapshot.session.id !== sessionId) {
        await refreshSessions();
        return;
      }

      applyActiveSessionSnapshot(nextSnapshot);
      emit();
      return;
    }

    applyActiveSessionSummary(nextActive);
    emit();
  };

  const streamFromRpc: StreamFn = async (model, context, streamOptions) => {
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
      sessionId: agent.sessionId,
      systemPrompt: context.systemPrompt,
    };
    const provider = request.provider ?? DEFAULT_CHAT_SETTINGS.provider;
    const modelId = request.model ?? DEFAULT_CHAT_SETTINGS.model;
    const activeStreamId = request.streamId;
    let streamSessionId = request.sessionId ?? agent.sessionId;
    let completed = false;

    const cleanup = () => {
      rpcClient.removeMessageListener("sendStreamEvent", streamListener);
      if (streamOptions?.signal) {
        streamOptions.signal.removeEventListener("abort", abort);
      }
    };

    const finishWithError = (stopReason: "aborted" | "error", error: unknown): void => {
      if (completed) return;
      completed = true;
      cleanup();
      const failure = createFailureMessage(error, provider, modelId, stopReason);
      agent.state.error = failure.errorMessage;
      stream.push({
        type: "error",
        reason: stopReason,
        error: failure,
      });
      void refreshSessions();
    };

    const handleStreamPayload = (payload: { streamId: string; event: AssistantMessageEvent }) => {
      if (completed || payload.streamId !== activeStreamId) return;

      stream.push(payload.event);
      if (payload.event.type === "done" || payload.event.type === "error") {
        completed = true;
        cleanup();
        void syncSettledActiveSessionState(streamSessionId);
      }
    };

    const streamListener = (payload: { streamId: string; event: AssistantMessageEvent }) => {
      handleStreamPayload(payload);
    };

    const abort = (): void => {
      if (completed) return;
      void cancelPrompt(streamSessionId);
      finishWithError("aborted", new Error("Request aborted by user"));
    };

    rpcClient.addMessageListener("sendStreamEvent", streamListener);
    if (streamOptions?.signal) {
      streamOptions.signal.addEventListener("abort", abort, { once: true });
      if (streamOptions.signal.aborted) {
        abort();
      }
    }

    void (async () => {
      try {
        const response = await rpcClient.request.sendPrompt(request);
        streamSessionId = response.sessionId;
        agent.sessionId = response.sessionId;
        activeSessionId = response.sessionId;
        emit();

        if (streamOptions?.signal?.aborted) {
          abort();
        }
      } catch (error) {
        finishWithError("error", error);
      }
    })();

    return stream;
  };

  const [defaults, workspaceInfo, initialCatalog] = await Promise.all([
    rpcClient.request.getDefaults(),
    rpcClient.request.getWorkspaceInfo(),
    rpcClient.request.listSessions(),
  ]);
  const e2eRendererSeedPromise = rpcClient.request.getE2eRendererSeed();
  const syncProviderAuthPromise = syncProviderAuth(defaults.provider);
  const currentActiveSessionPromise = rpcClient.request.getActiveSession();

  const agent = new Agent({
    initialState: {
      systemPrompt: "You are svvy, a pragmatic software engineering assistant.",
      model: getModel(
        defaults.provider as Parameters<typeof getModel>[0],
        defaults.model as Parameters<typeof getModel>[1],
      ),
      thinkingLevel: defaults.reasoningEffort,
      messages: [],
      tools: [],
    },
    convertToLlm,
    streamFn: streamFromRpc,
  });

  const originalSetModel = agent.setModel.bind(agent);
  agent.setModel = (nextModel) => {
    originalSetModel(nextModel);
    void syncSessionModel(nextModel.id);
  };

  const originalSetThinkingLevel = agent.setThinkingLevel.bind(agent);
  agent.setThinkingLevel = (level) => {
    originalSetThinkingLevel(level);
    void syncSessionThoughtLevel(level);
  };

  activeSessionId = initialCatalog.activeSessionId;
  sessions = initialCatalog.sessions;

  const [e2eRendererSeed, currentActiveSession] = await Promise.all([
    e2eRendererSeedPromise,
    currentActiveSessionPromise,
  ]);
  await syncProviderAuthPromise;

  if (e2eRendererSeed) {
    if (e2eRendererSeed.customProviders.length > 0) {
      for (const provider of e2eRendererSeed.customProviders) {
        await storage.customProviders.set(provider);
      }
    }
    if (e2eRendererSeed.promptHistory.length > 0) {
      await storage.promptHistory.replace(workspaceInfo.workspaceId, e2eRendererSeed.promptHistory);
    }
  }

  if (currentActiveSession) {
    applyActiveSessionSnapshot(currentActiveSession);
  } else if (initialCatalog.sessions.length > 0) {
    const [firstSession] = initialCatalog.sessions;
    if (!firstSession) {
      throw new Error("Expected an initial session to open.");
    }
    const initialSession = await rpcClient.request.openSession({ sessionId: firstSession.id });
    applyActiveSessionSnapshot(initialSession);
  } else {
    const createdSession = await rpcClient.request.createSession({});
    applyActiveSessionSnapshot(createdSession);
  }

  const runtime: ChatRuntime = {
    agent,
    storage,
    workspaceId: workspaceInfo.workspaceId,
    workspaceLabel: workspaceInfo.workspaceLabel,
    branch: workspaceInfo.branch,
    get activeSessionId() {
      return activeSessionId;
    },
    get sessions() {
      return sessions;
    },
    dispose: () => {
      disposed = true;
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
    createSession: async (request = {}) => {
      const session = await rpcClient.request.createSession(request);
      await openActiveSession(session);
    },
    openSession: async (sessionId) => {
      if (activeSessionId === sessionId) return;
      const session = await rpcClient.request.openSession({ sessionId });
      await openActiveSession(session);
    },
    renameSession: async (sessionId, title) => {
      const response = await rpcClient.request.renameSession({ sessionId, title });
      await applySessionMutation(response, { sessionId, title });
    },
    forkSession: async (sessionId, title) => {
      const session = await rpcClient.request.forkSession({ sessionId, title });
      await openActiveSession(session);
    },
    deleteSession: async (sessionId) => {
      const response = await rpcClient.request.deleteSession({ sessionId });
      await applySessionMutation(response, { sessionId, deleted: true });
    },
    syncProviderAuth,
    requireProviderAccess,
    listConfiguredProviders,
  };

  return runtime;
}
