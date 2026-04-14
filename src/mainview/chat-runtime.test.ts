import { describe, expect, it, mock } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import type { ChatStorage, CustomProvider } from "./chat-storage";
import type {
  ActiveSessionState,
  ActiveSessionSummaryState,
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

function toolCall(name: string, argumentsValue: Record<string, unknown>): ToolCall {
  return {
    type: "toolCall",
    id: "tool-call-1",
    name,
    arguments: argumentsValue,
  };
}

function toolResultMessage(text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "tool-call-1",
    toolName: "artifacts",
    timestamp: Date.now(),
    isError: false,
    content: [{ type: "text", text }],
  };
}

function createSummary(
  id: string,
  title: string,
  preview: string,
  reasoning: ActiveSessionState["reasoningEffort"] = "medium",
  options: { includeModelMetadata?: boolean } = {},
): WorkspaceSessionSummary {
  const includeModelMetadata = options.includeModelMetadata ?? true;
  return {
    id,
    title,
    preview,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    messageCount: 2,
    status: "idle",
    ...(includeModelMetadata
      ? {
          provider: "openai",
          modelId: "gpt-4o",
          thinkingLevel: reasoning,
        }
      : {}),
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
    systemPrompt: "You are svvy.",
  };
}

function cloneActiveSession(session: ActiveSessionState): ActiveSessionState {
  return structuredClone(session);
}

function cloneActiveSessionSummary(session: ActiveSessionState): ActiveSessionSummaryState {
  const { messages: _messages, ...summary } = cloneActiveSession(session);
  return summary;
}

function stripSummaryMetadata(summary: WorkspaceSessionSummary): WorkspaceSessionSummary {
  const { provider: _provider, modelId: _modelId, thinkingLevel: _thinkingLevel, ...rest } =
    summary;
  return { ...rest };
}

function createFakeRpc(
  initialSessions: ActiveSessionState[],
  options: { metadataOnlyListSessions?: boolean } = {},
): {
  client: ChatRuntimeRpcClient;
  sentPromptSessions: string[];
  requestCounts: {
    listSessions: number;
    getActiveSession: number;
    getActiveSessionSummary: number;
  };
} {
  const listeners = new Set<
    (payload: { streamId: string; event: AssistantMessageEvent }) => void
  >();
  const sessionsById = new Map(
    initialSessions.map((session) => [session.session.id, cloneActiveSession(session)]),
  );
  let activeSessionId = initialSessions[0]?.session.id;
  const sentPromptSessions: string[] = [];
  const requestCounts = {
    listSessions: 0,
    getActiveSession: 0,
    getActiveSessionSummary: 0,
  };

  const listSessions = () => ({
    activeSessionId,
    sessions: Array.from(sessionsById.values()).map((session) =>
      options.metadataOnlyListSessions
        ? stripSummaryMetadata(session.session)
        : structuredClone(session.session),
    ),
  });

  const getActiveSession = () => {
    requestCounts.getActiveSession += 1;
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
        workspaceId: "/tmp/svvy",
        workspaceLabel: "svvy",
        branch: "main",
      }),
      listSessions: async () => {
        requestCounts.listSessions += 1;
        return listSessions();
      },
      getActiveSession: async () => getActiveSession(),
      getActiveSessionSummary: async () => {
        requestCounts.getActiveSessionSummary += 1;
        return activeSessionId ? cloneActiveSessionSummary(sessionsById.get(activeSessionId)!) : null;
      },
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
      getE2eRendererSeed: async () => null,
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

  return { client, sentPromptSessions, requestCounts };
}

function createFakeRpcWithToolUse(
  initialSession: ActiveSessionState,
  options: { summaryMode?: "summary" | "null" | "mismatch" } = {},
): {
  client: ChatRuntimeRpcClient;
  requestCounts: {
    listSessions: number;
    getActiveSession: number;
    getActiveSessionSummary: number;
  };
} {
  const listeners = new Set<
    (payload: { streamId: string; event: AssistantMessageEvent }) => void
  >();
  const toolUse = toolCall("artifacts", {
    command: "create",
    filename: "tool-use.txt",
    content: "tool use artifact",
  });
  const finalAssistant = assistantMessage("Tool use finished.");
  const session = cloneActiveSession(initialSession);
  const requestCounts = {
    listSessions: 0,
    getActiveSession: 0,
    getActiveSessionSummary: 0,
  };

  const client: ChatRuntimeRpcClient = {
    request: {
      getDefaults: async () => ({ provider: "openai", model: "gpt-4o", reasoningEffort: "medium" }),
      getProviderAuthState: async () => ({ connected: true, accountId: "openai-oauth" }),
      getWorkspaceInfo: async () => ({
        workspaceId: "/tmp/svvy",
        workspaceLabel: "svvy",
        branch: "main",
      }),
      listSessions: async () => {
        requestCounts.listSessions += 1;
        return {
          activeSessionId: session.session.id,
          sessions: [structuredClone(session.session)],
        };
      },
      getActiveSession: async () => {
        requestCounts.getActiveSession += 1;
        return cloneActiveSession(session);
      },
      getActiveSessionSummary: async () => {
        requestCounts.getActiveSessionSummary += 1;
        if (options.summaryMode === "null") {
          return null;
        }
        if (options.summaryMode === "mismatch") {
          return {
            ...cloneActiveSessionSummary(session),
            session: {
              ...cloneActiveSessionSummary(session).session,
              id: `${session.session.id}-stale`,
            },
          };
        }
        return cloneActiveSessionSummary(session);
      },
      createSession: async () => cloneActiveSession(session),
      openSession: async () => cloneActiveSession(session),
      renameSession: async () => ({
        ok: true,
        activeSessionId: session.session.id,
      }),
      forkSession: async () => cloneActiveSession(session),
      deleteSession: async () => ({
        ok: true,
        activeSessionId: session.session.id,
      }),
      sendPrompt: async (request: {
        sessionId?: string;
        streamId: string;
        messages: AgentMessage[];
      }) => {
        const toolAssistant: AssistantMessage = {
          ...assistantMessage("Using the artifacts tool."),
          stopReason: "toolUse",
          content: [
            { type: "text", text: "Using the artifacts tool." },
            toolUse,
          ],
        };
        session.messages = [
          ...request.messages,
          toolAssistant,
          toolResultMessage("Created file tool-use.txt"),
          finalAssistant,
        ];
        session.session.preview = "Tool use finished.";
        session.session.messageCount = session.messages.length;

        queueMicrotask(() => {
          const partial = assistantMessage("");
          for (const listener of listeners) {
            listener({ streamId: request.streamId, event: { type: "start", partial } });
            listener({
              streamId: request.streamId,
              event: { type: "done", reason: "stop", message: finalAssistant },
            });
          }
        });

        return { sessionId: request.sessionId ?? session.session.id };
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
      getE2eRendererSeed: async () => null,
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

  return { client, requestCounts };
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
    const { client, sentPromptSessions, requestCounts } = createFakeRpc([
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
    expect(requestCounts.listSessions).toBe(1);

    await runtime.openSession("session-2");
    expect(runtime.activeSessionId).toBe("session-2");
    expect(runtime.agent.state.thinkingLevel).toBe("high");
    expect(requestCounts.listSessions).toBe(1);
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
    expect(requestCounts.listSessions).toBe(1);
    expect(requestCounts.getActiveSession).toBe(2);
    expect(requestCounts.getActiveSessionSummary).toBe(1);
    expect(
      runtime.sessions.find((session) => session.id === "session-2")?.preview,
    ).toBe("Session-specific reply");

    await runtime.renameSession("session-2", "Renamed");
    expect(runtime.sessions.find((session) => session.id === "session-2")?.title).toBe("Renamed");
    expect(requestCounts.listSessions).toBe(1);

    await runtime.deleteSession("session-2");
    expect(runtime.activeSessionId).toBe("session-1");
    expect(runtime.sessions.some((session) => session.id === "session-2")).toBe(false);
    expect(requestCounts.listSessions).toBe(1);
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

  it("hydrates when sidebar summaries are metadata-only", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const { client, requestCounts } = createFakeRpc(
      [
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
      ],
      { metadataOnlyListSessions: true },
    );

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());

    expect(requestCounts.listSessions).toBe(1);
    expect(
      runtime.sessions.find((session) => session.id === "session-2") &&
        runtime.sessions.find((session) => session.id === "session-2")?.provider === undefined &&
        runtime.sessions.find((session) => session.id === "session-2")?.modelId === undefined &&
        runtime.sessions.find((session) => session.id === "session-2")?.thinkingLevel === undefined,
    ).toBe(true);

    await runtime.openSession("session-2");
    expect(runtime.activeSessionId).toBe("session-2");
    expect(runtime.agent.state.thinkingLevel).toBe("high");
    expect(requestCounts.listSessions).toBe(1);
    expect(
      runtime.agent.state.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "second reply",
      ),
    ).toBe(true);

    runtime.dispose();
  });

  it("keeps the active session in sync after a prompt settles without relisting the sidebar", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const { client, requestCounts } = createFakeRpcWithToolUse(
      createActiveSession("session-1", "First", [userMessage("first")], "medium"),
    );

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());
    expect(requestCounts.listSessions).toBe(1);
    expect(requestCounts.getActiveSessionSummary).toBe(0);
    await runtime.agent.prompt("use a tool");
    await runtime.agent.waitForIdle();
    expect(requestCounts.listSessions).toBe(1);
    expect(requestCounts.getActiveSessionSummary).toBe(1);
    expect(runtime.sessions.find((session) => session.id === "session-1")?.preview).toBe(
      "Tool use finished.",
    );
    expect(requestCounts.getActiveSession).toBe(2);

    expect(
      runtime.agent.state.messages.some(
        (message) =>
          message.role === "user" &&
          typeof message.content !== "string" &&
          message.content.some((block) => block.type === "text" && block.text === "use a tool"),
      ),
    ).toBe(true);
    expect(
      runtime.agent.state.messages.some(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "artifacts" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "Created file tool-use.txt",
      ),
    ).toBe(true);
    expect(
      runtime.agent.state.messages.some(
        (message) =>
          message.role === "assistant" &&
          typeof message.content !== "string" &&
          message.content.some(
            (block) => block.type === "text" && block.text === "Tool use finished.",
          ),
      ),
    ).toBe(true);

    runtime.dispose();
  });

  it("falls back to relisting the sidebar when the summary sync is missing or stale", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const { client, requestCounts } = createFakeRpcWithToolUse(
      createActiveSession("session-1", "First", [userMessage("first")], "medium"),
      { summaryMode: "null" },
    );

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());
    expect(requestCounts.listSessions).toBe(1);
    expect(requestCounts.getActiveSession).toBe(1);
    expect(requestCounts.getActiveSessionSummary).toBe(0);

    await runtime.agent.prompt("use a tool");
    await runtime.agent.waitForIdle();

    expect(requestCounts.getActiveSessionSummary).toBe(1);
    expect(requestCounts.getActiveSession).toBe(1);
    expect(requestCounts.listSessions).toBe(2);
    expect(runtime.sessions.find((session) => session.id === "session-1")?.preview).toBe(
      "Tool use finished.",
    );

    runtime.dispose();
  });
});
