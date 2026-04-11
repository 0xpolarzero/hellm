import { describe, expect, it, mock } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent } from "@mariozechner/pi-ai";
import type { ChatStorage, CustomProvider } from "./chat-storage";
import type {
  ActiveSessionState,
  SessionMutationResponse,
  WorkspaceSessionSummary,
} from "./chat-rpc";
import type { PromptHistoryEntry } from "./prompt-history";
import type { ChatRuntimeRpcClient } from "./chat-runtime";

mock.module("electrobun/view", () => {
  const MockElectroview = Object.assign(
    function MockElectroview() {
      return undefined;
    },
    {
      defineRPC() {
        return {
          request: {},
          addMessageListener() {},
          removeMessageListener() {},
        };
      },
    },
  );

  return {
    Electroview: MockElectroview,
  };
});

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text }],
  };
}

function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    timestamp: Date.now(),
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    content: [{ type: "text", text }],
  };
}

function createSummary(
  id: string,
  title: string,
  preview: string,
  reasoning: ActiveSessionState["reasoningEffort"] = "medium",
): WorkspaceSessionSummary {
  return {
    id,
    title,
    preview,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    messageCount: 2,
    status: "idle",
    provider: "openai",
    modelId: "gpt-4o",
    thinkingLevel: reasoning,
  };
}

function createActiveSession(
  id: string,
  title: string,
  messages: AgentMessage[],
  reasoning: ActiveSessionState["reasoningEffort"] = "medium",
): ActiveSessionState {
  const lastMessage = messages.at(-1);
  const preview =
    lastMessage && lastMessage.role === "assistant"
      ? lastMessage.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join(" ")
      : "";

  return {
    session: createSummary(id, title, preview, reasoning),
    messages,
    provider: "openai",
    model: "gpt-4o",
    reasoningEffort: reasoning,
    systemPrompt: "You are hellm.",
  };
}

function cloneActiveSession(session: ActiveSessionState): ActiveSessionState {
  return structuredClone(session);
}

function createFakeRpc(initialSessions: ActiveSessionState[]): {
  client: ChatRuntimeRpcClient;
  sentPromptSessions: string[];
} {
  const listeners = new Set<
    (payload: { streamId: string; event: AssistantMessageEvent }) => void
  >();
  const sessionsById = new Map(
    initialSessions.map((session) => [session.session.id, cloneActiveSession(session)]),
  );
  let activeSessionId = initialSessions[0]?.session.id;
  const sentPromptSessions: string[] = [];

  const listSessions = () => ({
    activeSessionId,
    sessions: Array.from(sessionsById.values()).map((session) => structuredClone(session.session)),
  });

  const getActiveSession = () => {
    return activeSessionId ? cloneActiveSession(sessionsById.get(activeSessionId)!) : null;
  };

  const mutation = (activeSession?: ActiveSessionState | null): SessionMutationResponse => ({
    ok: true,
    activeSessionId,
    activeSession: activeSession ? cloneActiveSession(activeSession) : (activeSession ?? undefined),
  });

  const client: ChatRuntimeRpcClient = {
    request: {
      getDefaults: async () => ({ provider: "openai", model: "gpt-4o", reasoningEffort: "medium" }),
      getProviderAuthState: async () => ({ connected: true, accountId: "openai-oauth" }),
      getWorkspaceInfo: async () => ({
        workspaceId: "/tmp/hellm",
        workspaceLabel: "hellm",
        branch: "main",
      }),
      listSessions: async () => listSessions(),
      getActiveSession: async () => getActiveSession(),
      createSession: async ({ title }: { title?: string }) => {
        const id = `session-${sessionsById.size + 1}`;
        const created = createActiveSession(id, title ?? "New Session", [], "medium");
        sessionsById.set(id, cloneActiveSession(created));
        activeSessionId = id;
        return cloneActiveSession(created);
      },
      openSession: async ({ sessionId }: { sessionId: string }) => {
        activeSessionId = sessionId;
        return cloneActiveSession(sessionsById.get(sessionId)!);
      },
      renameSession: async ({ sessionId, title }: { sessionId: string; title: string }) => {
        const session = sessionsById.get(sessionId)!;
        session.session.title = title;
        return mutation();
      },
      forkSession: async ({ sessionId, title }: { sessionId: string; title?: string }) => {
        const source = sessionsById.get(sessionId)!;
        const id = `session-${sessionsById.size + 1}`;
        const forked = cloneActiveSession(source);
        forked.session.id = id;
        forked.session.title = title ?? `${source.session.title} fork`;
        forked.session.parentSessionId = sessionId;
        sessionsById.set(id, forked);
        activeSessionId = id;
        return cloneActiveSession(forked);
      },
      deleteSession: async ({ sessionId }: { sessionId: string }) => {
        sessionsById.delete(sessionId);
        if (activeSessionId === sessionId) {
          activeSessionId = Array.from(sessionsById.keys())[0];
          return mutation(activeSessionId ? sessionsById.get(activeSessionId)! : null);
        }
        return mutation();
      },
      sendPrompt: async (request: {
        sessionId?: string;
        streamId: string;
        messages: AgentMessage[];
      }) => {
        sentPromptSessions.push(request.sessionId ?? "");
        const assistant = assistantMessage("Session-specific reply");
        const session = sessionsById.get(request.sessionId!)!;
        session.messages = [...request.messages, assistant];
        session.session.preview = "Session-specific reply";
        session.session.messageCount = session.messages.length;
        queueMicrotask(() => {
          const partial = assistantMessage("");
          for (const listener of listeners) {
            listener({ streamId: request.streamId, event: { type: "start", partial } });
            listener({
              streamId: request.streamId,
              event: { type: "text_start", contentIndex: 0, partial },
            });
            listener({
              streamId: request.streamId,
              event: {
                type: "text_delta",
                contentIndex: 0,
                delta: "Session-specific reply",
                partial,
              },
            });
            listener({
              streamId: request.streamId,
              event: {
                type: "text_end",
                contentIndex: 0,
                content: "Session-specific reply",
                partial,
              },
            });
            listener({
              streamId: request.streamId,
              event: { type: "done", reason: "stop", message: assistant },
            });
          }
        });
        return { sessionId: request.sessionId! };
      },
      setSessionModel: async ({ sessionId }: { sessionId: string; model: string }) => ({
        ok: true,
        sessionId,
      }),
      setSessionThoughtLevel: async ({ sessionId }: { sessionId: string; level: string }) => ({
        ok: true,
        sessionId,
      }),
      cancelPrompt: async () => ({ ok: true }),
      listProviderAuths: async () => [
        { provider: "openai", hasKey: true, keyType: "oauth", supportsOAuth: true },
      ],
      setProviderApiKey: async () => ({ ok: true }),
      startOAuth: async () => ({ ok: true }),
      removeProviderAuth: async () => ({ ok: true }),
    },
    addMessageListener: (_messageName: string, listener: unknown) => {
      listeners.add(
        listener as (payload: { streamId: string; event: AssistantMessageEvent }) => void,
      );
    },
    removeMessageListener: (_messageName: string, listener: unknown) => {
      listeners.delete(
        listener as (payload: { streamId: string; event: AssistantMessageEvent }) => void,
      );
    },
  };

  return { client, sentPromptSessions };
}

function createMemoryStorage(): ChatStorage {
  const providerKeys = new Map<string, string>();
  const customProviders = new Map<string, CustomProvider>();
  const promptHistory = new Map<string, PromptHistoryEntry[]>();

  return {
    providerKeys: {
      get: async (provider: string) => providerKeys.get(provider) ?? null,
      set: async (provider: string, key: string) => {
        providerKeys.set(provider, key);
      },
      delete: async (provider: string) => {
        providerKeys.delete(provider);
      },
      list: async () => Array.from(providerKeys.keys()),
      has: async (provider: string) => providerKeys.has(provider),
    },
    customProviders: {
      get: async (id: string) => customProviders.get(id) ?? null,
      set: async (provider: CustomProvider) => {
        customProviders.set(provider.id, provider);
      },
      delete: async (id: string) => {
        customProviders.delete(id);
      },
      getAll: async () => Array.from(customProviders.values()),
      has: async (id: string) => customProviders.has(id),
    },
    promptHistory: {
      list: async (workspaceId: string) => promptHistory.get(workspaceId) ?? [],
      append: async (entry: PromptHistoryEntry) => {
        const existing = promptHistory.get(entry.workspaceId) ?? [];
        const next = [...existing, entry];
        promptHistory.set(entry.workspaceId, next);
        return entry;
      },
    },
  } as unknown as ChatStorage;
}

describe("createChatRuntime", () => {
  it("hydrates sessions, switches the active transcript, and keeps prompts scoped to the selected session", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const { client, sentPromptSessions } = createFakeRpc([
      createActiveSession(
        "session-1",
        "First",
        [userMessage("first"), assistantMessage("first reply")],
        "medium",
      ),
      createActiveSession(
        "session-2",
        "Second",
        [userMessage("second"), assistantMessage("second reply")],
        "high",
      ),
    ]);

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());

    expect(runtime.activeSessionId).toBe("session-1");
    expect(runtime.sessions).toHaveLength(2);

    await runtime.openSession("session-2");
    expect(runtime.activeSessionId).toBe("session-2");
    expect(runtime.agent.state.thinkingLevel).toBe("high");
    expect(
      runtime.agent.state.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "second reply",
      ),
    ).toBe(true);

    await runtime.agent.prompt("continue");
    await runtime.agent.waitForIdle();
    expect(sentPromptSessions.at(-1)).toBe("session-2");

    await runtime.renameSession("session-2", "Renamed");
    expect(runtime.sessions.find((session) => session.id === "session-2")?.title).toBe("Renamed");

    await runtime.deleteSession("session-2");
    expect(runtime.activeSessionId).toBe("session-1");
    expect(
      runtime.agent.state.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "first reply",
      ),
    ).toBe(true);

    runtime.dispose();
  });
});
