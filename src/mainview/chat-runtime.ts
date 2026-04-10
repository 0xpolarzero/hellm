import { Agent, type AgentMessage, type StreamFn } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  getModel,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message,
} from "@mariozechner/pi-ai";
import type { SendPromptRequest } from "./chat-rpc";
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

export interface ChatRuntimeOptions {
  onMissingProviderAccess?: (provider: string) => void;
}

export interface ChatRuntime {
  agent: Agent;
  storage: ChatStorage;
  workspaceId: string;
  dispose: () => void;
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

export async function createChatRuntime(options: ChatRuntimeOptions = {}): Promise<ChatRuntime> {
  const storage = initializeStorage();
  let agent: Agent | null = null;

  const syncProviderAuth = async (providerId: string): Promise<boolean> => {
    const auth = await rpc.request.getProviderAuthState({ providerId });
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
    const auths = await rpc.request.listProviderAuths();
    return auths.filter((authInfo) => authInfo.hasKey).map((authInfo) => authInfo.provider);
  };

  const cancelPrompt = async (sessionId?: string): Promise<void> => {
    if (!sessionId) return;
    try {
      await rpc.request.cancelPrompt({ sessionId });
    } catch (error) {
      console.error("Failed to cancel prompt:", error);
    }
  };

  const syncSessionModel = async (modelId: string): Promise<void> => {
    const sessionId = agent?.sessionId;
    if (!agent || !sessionId) return;

    try {
      const response = await rpc.request.setSessionModel({ sessionId, model: modelId });
      if (response.ok) {
        agent.sessionId = response.sessionId;
      }
    } catch (error) {
      console.error("Failed to sync session model:", error);
    }
  };

  const syncSessionThoughtLevel = async (level: ReasoningEffort): Promise<void> => {
    const sessionId = agent?.sessionId;
    if (!agent || !sessionId) return;

    try {
      const response = await rpc.request.setSessionThoughtLevel({ sessionId, level });
      if (response.ok) {
        agent.sessionId = response.sessionId;
      }
    } catch (error) {
      console.error("Failed to sync session thought level:", error);
    }
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
      sessionId: agent?.sessionId,
      systemPrompt: context.systemPrompt,
    };
    const provider = request.provider ?? DEFAULT_CHAT_SETTINGS.provider;
    const modelId = request.model ?? DEFAULT_CHAT_SETTINGS.model;
    const activeStreamId = request.streamId;
    let activeSessionId = request.sessionId ?? agent?.sessionId;
    let completed = false;

    const cleanup = () => {
      rpc.removeMessageListener("sendStreamEvent", streamListener);
      if (streamOptions?.signal) {
        streamOptions.signal.removeEventListener("abort", abort);
      }
    };

    const finishWithError = (stopReason: "aborted" | "error", error: unknown): void => {
      if (completed) return;
      completed = true;
      cleanup();
      stream.push({
        type: "error",
        reason: stopReason,
        error: createFailureMessage(error, provider, modelId, stopReason),
      });
    };

    const handleStreamPayload = (payload: { streamId: string; event: AssistantMessageEvent }) => {
      if (completed || payload.streamId !== activeStreamId) return;

      stream.push(payload.event);
      if (payload.event.type === "done" || payload.event.type === "error") {
        completed = true;
        cleanup();
      }
    };

    const streamListener = (payload: { streamId: string; event: AssistantMessageEvent }) => {
      handleStreamPayload(payload);
    };

    const abort = (): void => {
      if (completed) return;
      void cancelPrompt(activeSessionId);
      finishWithError("aborted", new Error("Request aborted by user"));
    };

    rpc.addMessageListener("sendStreamEvent", streamListener);
    if (streamOptions?.signal) {
      streamOptions.signal.addEventListener("abort", abort, { once: true });
      if (streamOptions.signal.aborted) {
        abort();
      }
    }

    void (async () => {
      try {
        const response = await rpc.request.sendPrompt(request);
        activeSessionId = response.sessionId;
        if (agent) {
          agent.sessionId = response.sessionId;
        }

        if (streamOptions?.signal?.aborted) {
          abort();
        }
      } catch (error) {
        finishWithError("error", error);
      }
    })();

    return stream;
  };

  const [defaults, workspaceInfo] = await Promise.all([
    rpc.request.getDefaults(),
    rpc.request.getWorkspaceInfo(),
  ]);
  await syncProviderAuth(defaults.provider);

  agent = new Agent({
    initialState: {
      systemPrompt: "You are hellm, a pragmatic software engineering assistant.",
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

  const currentAgent = agent;
  const originalSetModel = currentAgent.setModel.bind(currentAgent);
  currentAgent.setModel = (nextModel) => {
    originalSetModel(nextModel);
    void syncSessionModel(nextModel.id);
  };

  const originalSetThinkingLevel = currentAgent.setThinkingLevel.bind(currentAgent);
  currentAgent.setThinkingLevel = (level) => {
    originalSetThinkingLevel(level);
    void syncSessionThoughtLevel(level);
  };

  return {
    agent: currentAgent,
    storage,
    workspaceId: workspaceInfo.workspaceId,
    dispose: () => {
      agent = null;
    },
    syncProviderAuth,
    requireProviderAccess,
    listConfiguredProviders,
  };
}
