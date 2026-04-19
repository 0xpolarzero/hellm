import { describe, expect, it, mock } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { ChatStorage, CustomProvider } from "./chat-storage";
import type {
  ActiveSessionState,
  ActiveSessionSummaryState,
  PromptTarget,
  SessionMutationResponse,
  WorkspaceCommandInspector,
  WorkspaceHandlerThreadInspector,
  WorkspaceHandlerThreadSummary,
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
  options: { includeModelMetadata?: boolean; parentSessionId?: string } = {},
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
    ...(options.parentSessionId ? { parentSessionId: options.parentSessionId } : {}),
    wait: null,
    counts: {
      turns: 0,
      threads: 0,
      commands: 0,
      episodes: 0,
      verifications: 0,
      workflows: 0,
      artifacts: 0,
      events: 0,
    },
    threadIdsByStatus: {
      running: [],
      waiting: [],
      failed: [],
    },
    ...(includeModelMetadata
      ? {
          provider: "openai",
          modelId: "gpt-4o",
          thinkingLevel: reasoning,
        }
      : {}),
  };
}

function createCommandInspector(
  commandId = "command-1",
  toolName = "execute_typescript",
): WorkspaceCommandInspector {
  return {
    commandId,
    threadId: "thread-1",
    workflowRunId: null,
    toolName,
    visibility: "summary",
    status: "succeeded",
    title: "Inspect docs",
    summary: "Read docs and created 1 artifact.",
    facts: {
      repoReads: 1,
      artifactsCreated: 1,
    },
    error: null,
    startedAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    finishedAt: "2026-04-10T10:05:00.000Z",
    artifacts: [],
    childCount: 2,
    summaryChildCount: 1,
    traceChildCount: 1,
    summaryChildren: [
      {
        commandId: "command-summary-1",
        toolName: "artifact.writeText",
        visibility: "summary",
        status: "succeeded",
        title: "Create summary.md",
        summary: "Created summary.md.",
        error: null,
        facts: {
          name: "summary.md",
        },
        startedAt: "2026-04-10T10:01:00.000Z",
        updatedAt: "2026-04-10T10:02:00.000Z",
        finishedAt: "2026-04-10T10:02:00.000Z",
        artifacts: [],
      },
    ],
    traceChildren: [
      {
        commandId: "command-trace-1",
        toolName: "repo.readFile",
        visibility: "trace",
        status: "succeeded",
        title: "Read docs/prd.md",
        summary: "Loaded docs/prd.md.",
        error: null,
        facts: {
          path: "docs/prd.md",
        },
        startedAt: "2026-04-10T10:00:30.000Z",
        updatedAt: "2026-04-10T10:00:40.000Z",
        finishedAt: "2026-04-10T10:00:40.000Z",
        artifacts: [],
      },
    ],
  };
}

function createHandlerThreadSummary(threadId = "thread-1"): WorkspaceHandlerThreadSummary {
  return {
    threadId,
    surfaceSessionId: `thread-session-${threadId}`,
    title: "Parser fix thread",
    objective: "Patch the parser bug and add regression coverage.",
    status: "completed",
    wait: null,
    startedAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    finishedAt: "2026-04-10T10:05:00.000Z",
    commandCount: 1,
    workflowRunCount: 1,
    episodeCount: 1,
    artifactCount: 1,
    verificationCount: 1,
    latestWorkflowRun: {
      workflowRunId: "workflow-1",
      workflowName: "verification_run",
      status: "completed",
      summary: "Verification passed.",
      updatedAt: "2026-04-10T10:04:30.000Z",
    },
    latestEpisode: {
      episodeId: "episode-1",
      kind: "change",
      title: "Latest handoff",
      summary: "Patched the parser transitions and added regression coverage.",
      createdAt: "2026-04-10T10:05:00.000Z",
    },
  };
}

function createHandlerThreadInspector(threadId = "thread-1"): WorkspaceHandlerThreadInspector {
  const summary = createHandlerThreadSummary(threadId);
  return {
    ...summary,
    commandRollups: [
      {
        commandId: "command-77",
        threadId,
        workflowRunId: null,
        toolName: "execute_typescript",
        visibility: "summary",
        status: "succeeded",
        title: "Patch parser transitions",
        summary: "Updated parser transitions and added regression coverage.",
        childCount: 1,
        summaryChildCount: 1,
        traceChildCount: 0,
        summaryChildren: [
          {
            commandId: "command-78",
            toolName: "artifact.writeText",
            status: "succeeded",
            title: "Write parser test",
            summary: "Created parser regression test coverage.",
            error: null,
          },
        ],
        updatedAt: "2026-04-10T10:04:00.000Z",
      },
    ],
    workflowRuns: [summary.latestWorkflowRun!],
    episodes: [summary.latestEpisode!],
    artifacts: [
      {
        artifactId: "artifact-1",
        kind: "file",
        name: "parser-regression.test.ts",
        path: "/tmp/svvy/.svvy/artifacts/parser-regression.test.ts",
        createdAt: "2026-04-10T10:03:30.000Z",
      },
    ],
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
  const {
    provider: _provider,
    modelId: _modelId,
    thinkingLevel: _thinkingLevel,
    ...rest
  } = summary;
  return { ...rest };
}

function createFakeRpc(
  initialSessions: ActiveSessionState[],
  options: {
    metadataOnlyListSessions?: boolean;
    commandInspector?: WorkspaceCommandInspector;
    handlerThreads?: WorkspaceHandlerThreadSummary[];
    handlerThreadInspector?: WorkspaceHandlerThreadInspector;
  } = {},
): {
  client: ChatRuntimeRpcClient;
  sentPromptRequests: Array<{ sessionId?: string; target?: PromptTarget }>;
  sentPromptSessions: string[];
  openedSessions: string[];
  requestCounts: {
    listSessions: number;
    getActiveSession: number;
    getActiveSessionSummary: number;
    getCommandInspector: number;
    listHandlerThreads: number;
    getHandlerThreadInspector: number;
  };
} {
  const listeners = new Set<
    (payload: { streamId: string; event: AssistantMessageEvent }) => void
  >();
  const sessionsById = new Map(
    initialSessions.map((session) => [session.session.id, cloneActiveSession(session)]),
  );
  let activeSessionId = initialSessions[0]?.session.id;
  const openedSessions: string[] = [];
  const sentPromptRequests: Array<{ sessionId?: string; target?: PromptTarget }> = [];
  const sentPromptSessions: string[] = [];
  const requestCounts = {
    listSessions: 0,
    getActiveSession: 0,
    getActiveSessionSummary: 0,
    getCommandInspector: 0,
    listHandlerThreads: 0,
    getHandlerThreadInspector: 0,
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
        return activeSessionId
          ? cloneActiveSessionSummary(sessionsById.get(activeSessionId)!)
          : null;
      },
      getCommandInspector: async ({ commandId }: { sessionId: string; commandId: string }) => {
        requestCounts.getCommandInspector += 1;
        return structuredClone(options.commandInspector ?? createCommandInspector(commandId));
      },
      listHandlerThreads: async ({ sessionId }: { sessionId: string }) => {
        requestCounts.listHandlerThreads += 1;
        return structuredClone(
          options.handlerThreads ?? [createHandlerThreadSummary(`thread-for-${sessionId}`)],
        );
      },
      getHandlerThreadInspector: async ({ threadId }: { sessionId: string; threadId: string }) => {
        requestCounts.getHandlerThreadInspector += 1;
        return structuredClone(
          options.handlerThreadInspector ?? createHandlerThreadInspector(threadId),
        );
      },
      createSession: async ({ title }: { title?: string }) => {
        const id = `session-${sessionsById.size + 1}`;
        const created = createActiveSession(id, title ?? "New Session", [], "medium");
        sessionsById.set(id, cloneActiveSession(created));
        activeSessionId = id;
        return cloneActiveSession(created);
      },
      openSession: async ({ sessionId }: { sessionId: string }) => {
        openedSessions.push(sessionId);
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
        target?: PromptTarget;
      }) => {
        sentPromptRequests.push({
          sessionId: request.sessionId,
          target: request.target,
        });
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
        return {
          sessionId: request.sessionId!,
          target: request.target,
        };
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

  return { client, sentPromptRequests, sentPromptSessions, openedSessions, requestCounts };
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
    getCommandInspector: number;
    listHandlerThreads: number;
    getHandlerThreadInspector: number;
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
    getCommandInspector: 0,
    listHandlerThreads: 0,
    getHandlerThreadInspector: 0,
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
      getCommandInspector: async ({ commandId }: { sessionId: string; commandId: string }) => {
        requestCounts.getCommandInspector += 1;
        return createCommandInspector(commandId);
      },
      listHandlerThreads: async () => {
        requestCounts.listHandlerThreads += 1;
        return [createHandlerThreadSummary()];
      },
      getHandlerThreadInspector: async ({ threadId }: { sessionId: string; threadId: string }) => {
        requestCounts.getHandlerThreadInspector += 1;
        return createHandlerThreadInspector(threadId);
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
        target?: PromptTarget;
      }) => {
        const toolAssistant: AssistantMessage = {
          ...assistantMessage("Using the artifacts tool."),
          stopReason: "toolUse",
          content: [{ type: "text", text: "Using the artifacts tool." }, toolUse],
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

        return {
          sessionId: request.sessionId ?? session.session.id,
          target: request.target,
        };
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

  return { client, requestCounts };
}

function createFakeRpcWithThreadSidebarRefresh(): {
  client: ChatRuntimeRpcClient;
  requestCounts: {
    listSessions: number;
    getActiveSession: number;
    getActiveSessionSummary: number;
    getCommandInspector: number;
    listHandlerThreads: number;
    getHandlerThreadInspector: number;
  };
} {
  const listeners = new Set<
    (payload: { streamId: string; event: AssistantMessageEvent }) => void
  >();
  const orchestrator = createActiveSession(
    "session-1",
    "Orchestrator",
    [userMessage("delegate"), assistantMessage("Opened a handler thread.")],
    "medium",
  );
  orchestrator.session.status = "running";
  orchestrator.session.preview = "Opened a handler thread.";
  orchestrator.session.threadIdsByStatus = {
    running: ["thread-123"],
    waiting: [],
    failed: [],
  };
  const thread = createActiveSession(
    "thread-session-1",
    "Handler Thread",
    [userMessage("status"), assistantMessage("Working on it.")],
    "medium",
  );
  thread.session.parentSessionId = "session-1";

  let activeSessionId = orchestrator.session.id;
  const requestCounts = {
    listSessions: 0,
    getActiveSession: 0,
    getActiveSessionSummary: 0,
    getCommandInspector: 0,
    listHandlerThreads: 0,
    getHandlerThreadInspector: 0,
  };

  const getSession = (sessionId: string): ActiveSessionState => {
    if (sessionId === thread.session.id) {
      return thread;
    }
    return orchestrator;
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
          activeSessionId: orchestrator.session.id,
          sessions: [structuredClone(orchestrator.session)],
        };
      },
      getActiveSession: async () => {
        requestCounts.getActiveSession += 1;
        return cloneActiveSession(getSession(activeSessionId));
      },
      getActiveSessionSummary: async () => {
        requestCounts.getActiveSessionSummary += 1;
        return cloneActiveSessionSummary(getSession(activeSessionId));
      },
      getCommandInspector: async ({ commandId }: { sessionId: string; commandId: string }) => {
        requestCounts.getCommandInspector += 1;
        return createCommandInspector(commandId);
      },
      listHandlerThreads: async () => {
        requestCounts.listHandlerThreads += 1;
        return [createHandlerThreadSummary("thread-123")];
      },
      getHandlerThreadInspector: async ({ threadId }: { sessionId: string; threadId: string }) => {
        requestCounts.getHandlerThreadInspector += 1;
        return createHandlerThreadInspector(threadId);
      },
      createSession: async () => cloneActiveSession(orchestrator),
      openSession: async ({ sessionId }: { sessionId: string }) => {
        activeSessionId = sessionId;
        return cloneActiveSession(getSession(sessionId));
      },
      renameSession: async () => ({
        ok: true,
        activeSessionId: orchestrator.session.id,
      }),
      forkSession: async () => cloneActiveSession(orchestrator),
      deleteSession: async () => ({
        ok: true,
        activeSessionId: orchestrator.session.id,
      }),
      sendPrompt: async (request: {
        sessionId?: string;
        streamId: string;
        messages: AgentMessage[];
        target?: PromptTarget;
      }) => {
        const finalAssistant = assistantMessage("Thread handed off.");
        thread.messages = [...request.messages, finalAssistant];
        thread.session.preview = "Thread handed off.";
        thread.session.messageCount = thread.messages.length;

        orchestrator.session.status = "idle";
        orchestrator.session.preview = "Thread handoff received.";
        orchestrator.session.threadIdsByStatus = {
          running: [],
          waiting: [],
          failed: [],
        };

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

        return {
          sessionId: request.sessionId ?? thread.session.id,
          target: request.target,
        };
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
    const { client, sentPromptRequests, sentPromptSessions, requestCounts } = createFakeRpc([
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
    expect(sentPromptRequests.at(-1)).toEqual({
      sessionId: "session-2",
      target: {
        surface: "orchestrator",
        surfaceSessionId: "session-2",
      },
    });
    expect(requestCounts.listSessions).toBe(1);
    expect(requestCounts.getActiveSession).toBe(2);
    expect(requestCounts.getActiveSessionSummary).toBe(1);
    expect(runtime.sessions.find((session) => session.id === "session-2")?.preview).toBe(
      "Session-specific reply",
    );

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

  it("can bind the single pane to a handler-thread surface and route prompts directly there", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const threadSession = createActiveSession(
      "thread-session-1",
      "Handler Thread",
      [userMessage("worker context"), assistantMessage("worker ready")],
      "medium",
    );
    threadSession.session.parentSessionId = "session-1";
    const { client, openedSessions, sentPromptRequests } = createFakeRpc([
      createActiveSession(
        "session-1",
        "Orchestrator",
        [userMessage("main"), assistantMessage("main reply")],
        "medium",
      ),
      threadSession,
    ]);

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());

    expect(runtime.activeSurface).toEqual({
      surface: "orchestrator",
      surfaceSessionId: "session-1",
    });

    await runtime.openSurface({
      surface: "thread",
      surfaceSessionId: "thread-session-1",
      threadId: "thread-123",
    });

    expect(openedSessions.at(-1)).toBe("thread-session-1");
    expect(runtime.activeSessionId).toBe("thread-session-1");
    expect(runtime.activeSurface).toEqual({
      surface: "thread",
      surfaceSessionId: "thread-session-1",
      threadId: "thread-123",
    });
    expect(
      runtime.agent.state.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "worker ready",
      ),
    ).toBe(true);

    await runtime.agent.prompt("status?");
    await runtime.agent.waitForIdle();

    expect(sentPromptRequests.at(-1)).toEqual({
      sessionId: "thread-session-1",
      target: {
        surface: "thread",
        surfaceSessionId: "thread-session-1",
        threadId: "thread-123",
      },
    });

    await runtime.resetSurfaceTarget();

    expect(openedSessions.at(-1)).toBe("session-1");
    expect(runtime.activeSessionId).toBe("session-1");
    expect(runtime.activeSurface).toEqual({
      surface: "orchestrator",
      surfaceSessionId: "session-1",
    });

    runtime.dispose();
  });

  it("re-lists sidebar sessions after a thread-surface prompt settles so parent session status refreshes immediately", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const { client, requestCounts } = createFakeRpcWithThreadSidebarRefresh();

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());
    await runtime.openSurface({
      surface: "thread",
      surfaceSessionId: "thread-session-1",
      threadId: "thread-123",
    });

    expect(requestCounts.listSessions).toBe(1);
    await runtime.agent.prompt("finish the objective");
    await runtime.agent.waitForIdle();

    expect(requestCounts.getActiveSessionSummary).toBe(1);
    expect(requestCounts.listSessions).toBe(2);
    expect(runtime.sessions.find((session) => session.id === "session-1")).toMatchObject({
      status: "idle",
      preview: "Thread handoff received.",
      threadIdsByStatus: {
        running: [],
        waiting: [],
        failed: [],
      },
    });
    expect(runtime.sessions.some((session) => session.id === "thread-session-1")).toBe(false);

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

  it("requests structured command inspector detail for the current session", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const inspector = createCommandInspector("command-77");
    const { client, requestCounts } = createFakeRpc(
      [createActiveSession("session-1", "Inspector", [userMessage("inspect")], "medium")],
      { commandInspector: inspector },
    );

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());
    const detail = await runtime.getCommandInspector("command-77");

    expect(requestCounts.getCommandInspector).toBe(1);
    expect(detail).toEqual(inspector);

    runtime.dispose();
  });

  it("lists handler-thread summaries for the current session", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const handlerThreads = [
      createHandlerThreadSummary("thread-123"),
      {
        ...createHandlerThreadSummary("thread-456"),
        status: "waiting",
        wait: {
          kind: "user",
          reason: "Need clarification before continuing.",
          resumeWhen: "Resume when the user answers.",
          since: "2026-04-10T10:06:00.000Z",
        },
      },
    ] satisfies WorkspaceHandlerThreadSummary[];
    const { client, requestCounts } = createFakeRpc(
      [createActiveSession("session-1", "Threads", [userMessage("inspect threads")], "medium")],
      { handlerThreads },
    );

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());
    const summaries = await runtime.listHandlerThreads();

    expect(requestCounts.listHandlerThreads).toBe(1);
    expect(summaries).toEqual(handlerThreads);

    runtime.dispose();
  });

  it("requests handler-thread inspector detail for the current session", async () => {
    const { createChatRuntime } = await import("./chat-runtime");
    const inspector = createHandlerThreadInspector("thread-123");
    const { client, requestCounts } = createFakeRpc(
      [
        createActiveSession(
          "session-1",
          "Thread Inspector",
          [userMessage("inspect thread")],
          "medium",
        ),
      ],
      { handlerThreadInspector: inspector },
    );

    const runtime = await createChatRuntime({}, client as never, createMemoryStorage());
    const detail = await runtime.getHandlerThreadInspector("thread-123");

    expect(requestCounts.getHandlerThreadInspector).toBe(1);
    expect(detail).toEqual(inspector);

    runtime.dispose();
  });
});
