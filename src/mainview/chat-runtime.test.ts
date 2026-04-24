import { describe, expect, it, mock } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel, type AssistantMessage, type AssistantMessageEvent } from "@mariozechner/pi-ai";
import type { ChatStorage, CustomProvider } from "./chat-storage";
import type {
  ConversationSurfaceSnapshot,
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

type ReasoningEffort = ConversationSurfaceSnapshot["reasoningEffort"];

type PromptHandlerResult = {
  assistantText: string;
  extraMessages?: AgentMessage[];
  reason?: Extract<SurfaceSyncMessage["reason"], "prompt.settled" | "surface.updated">;
};

type PromptHandler = (
  request: SendPromptRequest,
  harness: FakeRpcHarness,
) => Promise<PromptHandlerResult> | PromptHandlerResult;

type SurfaceRecord = {
  snapshot: ConversationSurfaceSnapshot;
  retainCount: number;
};

type FakeRpcHarness = {
  client: ChatRuntimeRpcClient;
  openedTargets: PromptTarget[];
  closeRequests: PromptTarget[];
  promptRequests: SendPromptRequest[];
  modelUpdates: Array<{ target: PromptTarget; model: string }>;
  thoughtLevelUpdates: Array<{ target: PromptTarget; level: ReasoningEffort }>;
  cancelRequests: PromptTarget[];
  requestCounts: {
    listSessions: number;
  };
  commandInspectorRequests: Array<{ sessionId: string; commandId: string }>;
  handlerThreadListRequests: string[];
  handlerThreadInspectorRequests: Array<{ sessionId: string; threadId: string }>;
  workflowTaskAttemptInspectorRequests: Array<{
    sessionId: string;
    workflowTaskAttemptId: string;
  }>;
  setPromptHandler: (surfacePiSessionId: string, handler: PromptHandler) => void;
  updateSummary: (sessionId: string, updater: (summary: WorkspaceSessionSummary) => void) => void;
  emitWorkspaceSync: (reason?: WorkspaceSyncMessage["reason"]) => void;
  emitSurfaceSync: (payload: SurfaceSyncMessage) => void;
  getRetainCount: (surfacePiSessionId: string) => number;
  getSurfaceSnapshot: (surfacePiSessionId: string) => ConversationSurfaceSnapshot;
};

function cloneTarget(target: PromptTarget): PromptTarget {
  return structuredClone(target);
}

const defaultPromptHandler: PromptHandler = async (request) => ({
  assistantText: `Reply for ${request.target.surfacePiSessionId}`,
});

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text }],
  };
}

function assistantMessage(
  text: string,
  options: {
    provider?: string;
    model?: string;
  } = {},
): AssistantMessage {
  return {
    role: "assistant",
    timestamp: Date.now(),
    api: `${options.provider ?? "openai"}-responses`,
    provider: options.provider ?? "openai",
    model: options.model ?? "gpt-4o",
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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await Bun.sleep(10);
  }

  throw new Error("Timed out waiting for chat runtime state.");
}

function createOrchestratorTarget(workspaceSessionId: string): PromptTarget {
  return {
    workspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId: workspaceSessionId,
  };
}

function createThreadTarget(
  workspaceSessionId: string,
  surfacePiSessionId: string,
  threadId: string,
): PromptTarget {
  return {
    workspaceSessionId,
    surface: "thread",
    surfacePiSessionId,
    threadId,
  };
}

function createSummary(
  id: string,
  title: string,
  preview: string,
  reasoningEffort: ReasoningEffort = "medium",
  options: { parentSessionId?: string } = {},
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
    thinkingLevel: reasoningEffort,
    ...(options.parentSessionId ? { parentSessionId: options.parentSessionId } : {}),
    wait: null,
    counts: {
      turns: 0,
      threads: 0,
      commands: 0,
      episodes: 0,
      ciRuns: 0,
      ciChecks: 0,
      workflows: 0,
      artifacts: 0,
      events: 0,
    },
    threadIdsByStatus: {
      runningHandler: [],
      runningWorkflow: [],
      waiting: [],
      troubleshooting: [],
    },
  };
}

function createSurfaceSnapshot(input: {
  target: PromptTarget;
  messages: AgentMessage[];
  provider?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
  resolvedSystemPrompt?: string;
}): ConversationSurfaceSnapshot {
  const systemPrompt = input.systemPrompt ?? "You are svvy.";
  return {
    target: structuredClone(input.target),
    messages: structuredClone(input.messages),
    provider: input.provider ?? "openai",
    model: input.model ?? "gpt-4o",
    reasoningEffort: input.reasoningEffort ?? "medium",
    systemPrompt,
    resolvedSystemPrompt: input.resolvedSystemPrompt ?? systemPrompt,
    promptStatus: "idle",
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
    childCount: 1,
    summaryChildCount: 1,
    traceChildCount: 0,
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
    traceChildren: [],
  };
}

function createHandlerThreadSummary(threadId = "thread-1"): WorkspaceHandlerThreadSummary {
  return {
    threadId,
    surfacePiSessionId: `thread-session-${threadId}`,
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
    ciRunCount: 1,
    loadedContextKeys: ["ci"],
    latestWorkflowRun: {
      workflowRunId: "workflow-1",
      workflowName: "project_ci",
      status: "completed",
      summary: "Project CI workflow completed.",
      updatedAt: "2026-04-10T10:04:30.000Z",
    },
    latestCiRun: {
      ciRunId: "ci-run-1",
      workflowRunId: "workflow-1",
      workflowId: "project_ci",
      status: "passed",
      summary: "Project CI passed.",
      updatedAt: "2026-04-10T10:04:30.000Z",
    },
    latestEpisode: {
      episodeId: "episode-1",
      kind: "change",
      title: "Latest handoff",
      summary: "Patched the parser transitions and added regression coverage.",
      createdAt: "2026-04-10T10:04:00.000Z",
    },
  };
}

function createHandlerThreadInspector(threadId = "thread-1"): WorkspaceHandlerThreadInspector {
  return {
    ...createHandlerThreadSummary(threadId),
    commandRollups: [],
    workflowRuns: [
      {
        workflowRunId: "workflow-1",
        workflowName: "project_ci",
        status: "completed",
        summary: "Project CI workflow completed.",
        updatedAt: "2026-04-10T10:04:30.000Z",
      },
    ],
    workflowTaskAttempts: [
      {
        workflowTaskAttemptId: "workflow-task-attempt-1",
        workflowRunId: "workflow-1",
        smithersRunId: "smithers-run-1",
        nodeId: "assistant",
        iteration: 0,
        attempt: 1,
        title: "assistant",
        kind: "agent",
        status: "completed",
        summary: "Transcript probe completed.",
        updatedAt: "2026-04-10T10:03:30.000Z",
        commandCount: 1,
        artifactCount: 0,
        transcriptMessageCount: 2,
      },
    ],
    episodes: [
      {
        episodeId: "episode-1",
        kind: "change",
        title: "Latest handoff",
        summary: "Patched the parser transitions and added regression coverage.",
        createdAt: "2026-04-10T10:04:00.000Z",
      },
    ],
    artifacts: [],
  };
}

function createWorkflowTaskAttemptInspector(
  workflowTaskAttemptId = "workflow-task-attempt-1",
): WorkspaceWorkflowTaskAttemptInspector {
  return {
    workflowTaskAttemptId,
    workflowRunId: "workflow-1",
    smithersRunId: "smithers-run-1",
    nodeId: "assistant",
    iteration: 0,
    attempt: 1,
    title: "assistant",
    kind: "agent",
    status: "completed",
    summary: "Transcript probe completed.",
    updatedAt: "2026-04-10T10:03:30.000Z",
    commandCount: 1,
    artifactCount: 0,
    transcriptMessageCount: 2,
    surfacePiSessionId: "pi-task-agent-1",
    smithersState: "finished",
    prompt: "Summarize the transcript probe.",
    responseText: '{"reply":"Handled: Summarize the transcript probe."}',
    error: null,
    cached: false,
    jjPointer: null,
    jjCwd: null,
    heartbeatAt: null,
    agentId: "svvy-deterministic-transcript-agent",
    agentModel: "gpt-4o",
    agentEngine: "pi",
    agentResume: "/tmp/task-agent-session.json",
    meta: null,
    startedAt: "2026-04-10T10:03:00.000Z",
    finishedAt: "2026-04-10T10:03:30.000Z",
    transcript: [
      {
        messageId: "workflow-task-message-1",
        role: "user",
        source: "prompt",
        text: "Summarize the transcript probe.",
        createdAt: "2026-04-10T10:03:00.000Z",
      },
      {
        messageId: "workflow-task-message-2",
        role: "assistant",
        source: "responseText",
        text: '{"reply":"Handled: Summarize the transcript probe."}',
        createdAt: "2026-04-10T10:03:30.000Z",
      },
    ],
    commandRollups: [],
    artifacts: [],
  };
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
  } as ChatStorage;
}

function createFakeRpc(input: {
  sessions: WorkspaceSessionSummary[];
  surfaces: ConversationSurfaceSnapshot[];
  commandInspector?: WorkspaceCommandInspector;
  handlerThreads?: WorkspaceHandlerThreadSummary[];
  handlerThreadInspector?: WorkspaceHandlerThreadInspector;
  workflowTaskAttemptInspector?: WorkspaceWorkflowTaskAttemptInspector;
}): FakeRpcHarness {
  const streamListeners = new Set<
    (payload: { streamId: string; event: AssistantMessageEvent }) => void
  >();
  const workspaceSyncListeners = new Set<(payload: WorkspaceSyncMessage) => void>();
  const surfaceSyncListeners = new Set<(payload: SurfaceSyncMessage) => void>();
  const summaries = new Map(
    input.sessions.map((summary) => [summary.id, structuredClone(summary)]),
  );
  const surfaces = new Map<string, SurfaceRecord>(
    input.surfaces.map((snapshot) => [
      snapshot.target.surfacePiSessionId,
      { snapshot: structuredClone(snapshot), retainCount: 0 },
    ]),
  );
  const promptHandlers = new Map<string, PromptHandler>();
  const pendingPromptIdsBySurface = new Map<string, string>();
  const cancelledPromptIds = new Set<string>();
  const openedTargets: PromptTarget[] = [];
  const closeRequests: PromptTarget[] = [];
  const promptRequests: SendPromptRequest[] = [];
  const modelUpdates: Array<{ target: PromptTarget; model: string }> = [];
  const thoughtLevelUpdates: Array<{ target: PromptTarget; level: ReasoningEffort }> = [];
  const cancelRequests: PromptTarget[] = [];
  const commandInspectorRequests: Array<{ sessionId: string; commandId: string }> = [];
  const handlerThreadListRequests: string[] = [];
  const handlerThreadInspectorRequests: Array<{ sessionId: string; threadId: string }> = [];
  const workflowTaskAttemptInspectorRequests: Array<{
    sessionId: string;
    workflowTaskAttemptId: string;
  }> = [];
  const requestCounts = {
    listSessions: 0,
  };

  const listSessions = (): WorkspaceSessionSummary[] =>
    Array.from(summaries.values()).map((summary) => structuredClone(summary));

  const getSurfaceRecord = (surfacePiSessionId: string): SurfaceRecord => {
    const record = surfaces.get(surfacePiSessionId) ?? null;
    if (!record) {
      throw new Error(`Missing fake surface ${surfacePiSessionId}`);
    }
    return record;
  };

  const updateSummary = (
    sessionId: string,
    updater: (summary: WorkspaceSessionSummary) => void,
  ): void => {
    const summary = summaries.get(sessionId) ?? null;
    if (!summary) {
      throw new Error(`Missing fake workspace session ${sessionId}`);
    }
    updater(summary);
  };

  const emitWorkspaceSync = (
    reason: WorkspaceSyncMessage["reason"] = "workspace.updated",
  ): void => {
    const payload: WorkspaceSyncMessage = {
      reason,
      sessions: listSessions(),
    };
    for (const listener of workspaceSyncListeners) {
      listener(structuredClone(payload));
    }
  };

  const emitSurfaceSync = (payload: SurfaceSyncMessage): void => {
    if (payload.reason === "surface.closed") {
      surfaces.delete(payload.target.surfacePiSessionId);
    } else if (payload.snapshot) {
      const existing = surfaces.get(payload.target.surfacePiSessionId);
      if (existing) {
        existing.snapshot = structuredClone(payload.snapshot);
      } else {
        surfaces.set(payload.target.surfacePiSessionId, {
          snapshot: structuredClone(payload.snapshot),
          retainCount: 0,
        });
      }
    }

    for (const listener of surfaceSyncListeners) {
      listener(structuredClone(payload));
    }
  };

  const emitAssistantStream = (
    streamId: string,
    text: string,
    provider: string,
    model: string,
  ): void => {
    const partial = assistantMessage("", { provider, model });
    const complete = assistantMessage(text, { provider, model });
    for (const listener of streamListeners) {
      listener({ streamId, event: { type: "start", partial } });
      listener({
        streamId,
        event: { type: "text_start", contentIndex: 0, partial },
      });
      listener({
        streamId,
        event: {
          type: "text_delta",
          contentIndex: 0,
          delta: text,
          partial,
        },
      });
      listener({
        streamId,
        event: {
          type: "text_end",
          contentIndex: 0,
          content: text,
          partial,
        },
      });
      listener({
        streamId,
        event: { type: "done", reason: "stop", message: complete },
      });
    }
  };

  const harness: FakeRpcHarness = {
    client: {
      request: {
        getDefaults: async () => ({
          provider: "openai",
          model: "gpt-4o",
          reasoningEffort: "medium",
        }),
        getProviderAuthState: async () => ({ connected: true, accountId: "openai-oauth" }),
        getWorkspaceInfo: async () => ({
          workspaceId: "/tmp/svvy",
          workspaceLabel: "svvy",
          branch: "main",
        }),
        listSessions: async () => {
          requestCounts.listSessions += 1;
          return { sessions: listSessions() };
        },
        getCommandInspector: async ({ sessionId, commandId }) => {
          commandInspectorRequests.push({ sessionId, commandId });
          return structuredClone(input.commandInspector ?? createCommandInspector(commandId));
        },
        listHandlerThreads: async ({ sessionId }) => {
          handlerThreadListRequests.push(sessionId);
          return structuredClone(
            input.handlerThreads ?? [createHandlerThreadSummary(`thread-for-${sessionId}`)],
          );
        },
        getHandlerThreadInspector: async ({ sessionId, threadId }) => {
          handlerThreadInspectorRequests.push({ sessionId, threadId });
          return structuredClone(
            input.handlerThreadInspector ?? createHandlerThreadInspector(threadId),
          );
        },
        getWorkflowTaskAttemptInspector: async ({ sessionId, workflowTaskAttemptId }) => {
          workflowTaskAttemptInspectorRequests.push({
            sessionId,
            workflowTaskAttemptId,
          });
          return structuredClone(
            input.workflowTaskAttemptInspector ??
              createWorkflowTaskAttemptInspector(workflowTaskAttemptId),
          );
        },
        createSession: async ({ title } = {}) => {
          const sessionId = `session-${summaries.size + 1}`;
          const summary = createSummary(sessionId, title ?? "New Session", "");
          const snapshot = createSurfaceSnapshot({
            target: createOrchestratorTarget(sessionId),
            messages: [],
          });
          summaries.set(sessionId, summary);
          surfaces.set(sessionId, { snapshot, retainCount: 1 });
          return structuredClone(snapshot);
        },
        openSession: async ({ sessionId }) => {
          const record = getSurfaceRecord(sessionId);
          record.retainCount += 1;
          openedTargets.push(cloneTarget(record.snapshot.target));
          return structuredClone(record.snapshot);
        },
        openSurface: async ({ target }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.retainCount += 1;
          record.snapshot = {
            ...record.snapshot,
            target: cloneTarget(target),
          };
          openedTargets.push(cloneTarget(target));
          return structuredClone(record.snapshot);
        },
        closeSurface: async ({ target }) => {
          closeRequests.push(cloneTarget(target));
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.retainCount = Math.max(0, record.retainCount - 1);
          if (record.retainCount === 0) {
            queueMicrotask(() => {
              emitSurfaceSync({
                reason: "surface.closed",
                target: cloneTarget(target),
              });
            });
          }
          return { ok: true };
        },
        renameSession: async ({ sessionId, title }) => {
          updateSummary(sessionId, (summary) => {
            summary.title = title;
          });
          return { ok: true };
        },
        forkSession: async ({ sessionId, title }) => {
          const sourceSummary = summaries.get(sessionId) ?? null;
          const sourceSurface = getSurfaceRecord(sessionId).snapshot;
          if (!sourceSummary) {
            throw new Error(`Missing source session ${sessionId}`);
          }
          const nextSessionId = `session-${summaries.size + 1}`;
          const summary = createSummary(
            nextSessionId,
            title ?? `${sourceSummary.title} fork`,
            sourceSummary.preview,
            sourceSurface.reasoningEffort,
            { parentSessionId: sessionId },
          );
          const snapshot = createSurfaceSnapshot({
            target: createOrchestratorTarget(nextSessionId),
            messages: sourceSurface.messages,
            provider: sourceSurface.provider,
            model: sourceSurface.model,
            reasoningEffort: sourceSurface.reasoningEffort,
            systemPrompt: sourceSurface.systemPrompt,
            resolvedSystemPrompt: sourceSurface.resolvedSystemPrompt,
          });
          summaries.set(nextSessionId, summary);
          surfaces.set(nextSessionId, { snapshot, retainCount: 1 });
          return structuredClone(snapshot);
        },
        deleteSession: async ({ sessionId }) => {
          summaries.delete(sessionId);
          for (const [surfacePiSessionId, record] of surfaces.entries()) {
            if (record.snapshot.target.workspaceSessionId === sessionId) {
              surfaces.delete(surfacePiSessionId);
            }
          }
          return { ok: true };
        },
        sendPrompt: async (request) => {
          promptRequests.push(structuredClone(request));
          pendingPromptIdsBySurface.set(request.target.surfacePiSessionId, request.streamId);
          const promptHandler =
            promptHandlers.get(request.target.surfacePiSessionId) ?? defaultPromptHandler;
          const result = await promptHandler(structuredClone(request), harness);
          const cancelled = cancelledPromptIds.has(request.streamId);
          pendingPromptIdsBySurface.delete(request.target.surfacePiSessionId);
          if (cancelled) {
            cancelledPromptIds.delete(request.streamId);
            return { target: cloneTarget(request.target) };
          }

          const record = getSurfaceRecord(request.target.surfacePiSessionId);
          const provider = request.provider ?? record.snapshot.provider;
          const model = request.model ?? record.snapshot.model;
          const nextMessages = [
            ...(request.messages as AgentMessage[]),
            ...(result.extraMessages ? structuredClone(result.extraMessages) : []),
            assistantMessage(result.assistantText, { provider, model }),
          ];

          record.snapshot = {
            ...record.snapshot,
            target: cloneTarget(request.target),
            messages: nextMessages,
            provider,
            model,
            reasoningEffort: request.reasoningEffort ?? record.snapshot.reasoningEffort,
            systemPrompt: request.systemPrompt ?? record.snapshot.systemPrompt,
            promptStatus: "idle",
          };

          updateSummary(request.target.workspaceSessionId, (summary) => {
            summary.preview = result.assistantText;
            summary.messageCount = nextMessages.length;
            summary.status = "idle";
          });

          queueMicrotask(() => {
            emitAssistantStream(request.streamId, result.assistantText, provider, model);
            emitSurfaceSync({
              reason: result.reason ?? "prompt.settled",
              target: cloneTarget(request.target),
              snapshot: structuredClone(record.snapshot),
            });
            emitWorkspaceSync("workspace.updated");
          });

          return { target: cloneTarget(request.target) };
        },
        setSurfaceModel: async ({ target, model }) => {
          modelUpdates.push({ target: cloneTarget(target), model });
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            model,
          };
          if (target.surface === "orchestrator") {
            updateSummary(target.workspaceSessionId, (summary) => {
              summary.modelId = model;
            });
          }
          queueMicrotask(() => {
            emitSurfaceSync({
              reason: "surface.updated",
              target: cloneTarget(target),
              snapshot: structuredClone(record.snapshot),
            });
          });
          return { ok: true, target: cloneTarget(target) };
        },
        setSurfaceThoughtLevel: async ({ target, level }) => {
          thoughtLevelUpdates.push({ target: cloneTarget(target), level });
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            reasoningEffort: level,
          };
          if (target.surface === "orchestrator") {
            updateSummary(target.workspaceSessionId, (summary) => {
              summary.thinkingLevel = level;
            });
          }
          queueMicrotask(() => {
            emitSurfaceSync({
              reason: "surface.updated",
              target: cloneTarget(target),
              snapshot: structuredClone(record.snapshot),
            });
          });
          return { ok: true, target: cloneTarget(target) };
        },
        cancelPrompt: async ({ target }) => {
          cancelRequests.push(cloneTarget(target));
          const pendingStreamId = pendingPromptIdsBySurface.get(target.surfacePiSessionId);
          if (pendingStreamId) {
            cancelledPromptIds.add(pendingStreamId);
          }
          return { ok: true };
        },
        listProviderAuths: async () => [
          { provider: "openai", hasKey: true, keyType: "oauth", supportsOAuth: true },
        ],
        setProviderApiKey: async () => ({ ok: true }),
        startOAuth: async () => ({ ok: true }),
        removeProviderAuth: async () => ({ ok: true }),
      },
      addMessageListener: (messageName: string, listener: unknown) => {
        if (messageName === "sendStreamEvent") {
          streamListeners.add(
            listener as (payload: { streamId: string; event: AssistantMessageEvent }) => void,
          );
          return;
        }
        if (messageName === "sendWorkspaceSync") {
          workspaceSyncListeners.add(listener as (payload: WorkspaceSyncMessage) => void);
          return;
        }
        if (messageName === "sendSurfaceSync") {
          surfaceSyncListeners.add(listener as (payload: SurfaceSyncMessage) => void);
        }
      },
      removeMessageListener: (messageName: string, listener: unknown) => {
        if (messageName === "sendStreamEvent") {
          streamListeners.delete(
            listener as (payload: { streamId: string; event: AssistantMessageEvent }) => void,
          );
          return;
        }
        if (messageName === "sendWorkspaceSync") {
          workspaceSyncListeners.delete(listener as (payload: WorkspaceSyncMessage) => void);
          return;
        }
        if (messageName === "sendSurfaceSync") {
          surfaceSyncListeners.delete(listener as (payload: SurfaceSyncMessage) => void);
        }
      },
    },
    openedTargets,
    closeRequests,
    promptRequests,
    modelUpdates,
    thoughtLevelUpdates,
    cancelRequests,
    requestCounts,
    commandInspectorRequests,
    handlerThreadListRequests,
    handlerThreadInspectorRequests,
    workflowTaskAttemptInspectorRequests,
    setPromptHandler: (surfacePiSessionId, handler) => {
      promptHandlers.set(surfacePiSessionId, handler);
    },
    updateSummary,
    emitWorkspaceSync,
    emitSurfaceSync,
    getRetainCount: (surfacePiSessionId) => surfaces.get(surfacePiSessionId)?.retainCount ?? 0,
    getSurfaceSnapshot: (surfacePiSessionId) =>
      structuredClone(getSurfaceRecord(surfacePiSessionId).snapshot),
  };

  return harness;
}

async function createRuntime(harness: FakeRpcHarness) {
  const { createChatRuntime } = await import("./chat-runtime");
  return await createChatRuntime({}, harness.client as never, createMemoryStorage());
}

describe("createChatRuntime", () => {
  it("hydrates the primary pane from an orchestrator surface and keeps the resolved prompt separate", async () => {
    const rawPrompt = "You are svvy.";
    const resolvedPrompt =
      "You are svvy.\n\n# Project Context\n\nCurrent date: 2026-04-21\nCurrent working directory: /tmp/svvy";
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Prompt Channel", "done")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("inspect"), assistantMessage("done")],
          systemPrompt: rawPrompt,
          resolvedSystemPrompt: resolvedPrompt,
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController(runtime.primaryPaneId);

    expect(runtime.sessions).toHaveLength(1);
    expect(runtime.paneLayout.focusedPaneId).toBe(runtime.primaryPaneId);
    expect(runtime.getPane(runtime.primaryPaneId)?.target).toEqual(
      createOrchestratorTarget("session-1"),
    );
    expect(controller).toBeTruthy();
    expect(controller?.agent.state.systemPrompt).toBe(rawPrompt);
    expect(controller?.resolvedSystemPrompt).toContain("# Project Context");
    expect(controller?.agent.state.messages.at(-1)).toMatchObject({
      role: "assistant",
    });

    runtime.dispose();
  });

  it("keeps workspace pane state and live surface state separate when multiple surfaces are open", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "Orchestrator", "main reply"),
        createSummary("session-2", "Second", "second reply", "high"),
      ],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("main"), assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [userMessage("worker context"), assistantMessage("worker ready")],
        }),
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-2"),
          messages: [userMessage("second"), assistantMessage("second reply")],
          reasoningEffort: "high",
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");

    const primaryController = runtime.getPaneController(runtime.primaryPaneId);
    const secondaryController = runtime.getPaneController("secondary");

    expect(runtime.paneLayout.focusedPaneId).toBe("secondary");
    expect(runtime.getPane(runtime.primaryPaneId)?.target).toEqual(
      createOrchestratorTarget("session-1"),
    );
    expect(runtime.getPane("secondary")?.target).toEqual(threadTarget);
    expect(primaryController?.target).toEqual(createOrchestratorTarget("session-1"));
    expect(secondaryController?.target).toEqual(threadTarget);
    expect(primaryController).not.toBe(secondaryController);
    expect(harness.openedTargets.at(-1)).toEqual(threadTarget);

    runtime.dispose();
  });

  it("shares one live surface controller across panes and only releases it after the last pane closes", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("main"), assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [userMessage("worker"), assistantMessage("worker ready")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");
    await runtime.openSurface(threadTarget, "tertiary");

    const secondaryController = runtime.getPaneController("secondary");
    const tertiaryController = runtime.getPaneController("tertiary");

    expect(secondaryController).toBeTruthy();
    expect(secondaryController).toBe(tertiaryController);
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(2);

    await runtime.closePaneSurface("secondary");

    expect(runtime.getPane("secondary")?.target).toBeNull();
    expect(runtime.getPaneController("tertiary")).toBe(tertiaryController);
    expect(runtime.getSurfaceController(threadTarget.surfacePiSessionId)).toBe(tertiaryController);
    expect(harness.closeRequests).toHaveLength(1);
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(1);

    await runtime.closePaneSurface("tertiary");
    await waitFor(() => runtime.getSurfaceController(threadTarget.surfacePiSessionId) === null);

    expect(runtime.getPane("tertiary")?.target).toBeNull();
    expect(harness.closeRequests).toHaveLength(2);
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(0);

    runtime.dispose();
  });

  it("keeps prompt dispatch independent across concurrent surfaces", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const orchestratorGate = createDeferred<void>();
    const handlerGate = createDeferred<void>();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "ready")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("ready")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("worker ready")],
        }),
      ],
    });

    harness.setPromptHandler("session-1", async () => {
      await orchestratorGate.promise;
      return { assistantText: "Orchestrator settled." };
    });
    harness.setPromptHandler(threadTarget.surfacePiSessionId, async () => {
      await handlerGate.promise;
      return { assistantText: "Handler settled." };
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");
    const orchestratorController = runtime.getPaneController(runtime.primaryPaneId);
    const handlerController = runtime.getPaneController("secondary");
    if (!orchestratorController || !handlerController) {
      throw new Error("Expected both surface controllers.");
    }

    const orchestratorPrompt = orchestratorController.agent.prompt("Continue orchestrating");
    const handlerPrompt = handlerController.agent.prompt("Continue handling");

    await waitFor(
      () =>
        orchestratorController.promptStatus === "streaming" &&
        handlerController.promptStatus === "streaming",
    );

    handlerGate.resolve();
    await handlerPrompt;
    await handlerController.agent.waitForIdle();

    expect(handlerController.promptStatus).toBe("idle");
    expect(orchestratorController.promptStatus).toBe("streaming");

    orchestratorGate.resolve();
    await orchestratorPrompt;
    await orchestratorController.agent.waitForIdle();

    expect(harness.promptRequests.map((request) => request.target.surfacePiSessionId)).toEqual([
      "session-1",
      threadTarget.surfacePiSessionId,
    ]);
    expect(
      handlerController.agent.state.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "Handler settled.",
      ),
    ).toBe(true);
    expect(
      orchestratorController.agent.state.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "Orchestrator settled.",
      ),
    ).toBe(true);

    runtime.dispose();
  });

  it("keeps model, reasoning, and cancel mutations scoped to the targeted surface", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const handlerGate = createDeferred<void>();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "ready")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("ready")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("worker ready")],
        }),
      ],
    });

    harness.setPromptHandler(threadTarget.surfacePiSessionId, async () => {
      await handlerGate.promise;
      return { assistantText: "This should stay cancelled." };
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");

    const orchestratorController = runtime.getPaneController(runtime.primaryPaneId);
    const handlerController = runtime.getPaneController("secondary");
    if (!orchestratorController || !handlerController) {
      throw new Error("Expected both surface controllers.");
    }

    handlerController.agent.setModel(getModel("openai", "gpt-4.1"));
    handlerController.agent.setThinkingLevel("high");

    await waitFor(
      () => harness.modelUpdates.length === 1 && harness.thoughtLevelUpdates.length === 1,
    );

    expect(harness.modelUpdates[0]).toEqual({
      target: threadTarget,
      model: "gpt-4.1",
    });
    expect(harness.thoughtLevelUpdates[0]).toEqual({
      target: threadTarget,
      level: "high",
    });
    expect(orchestratorController.agent.state.model.id).toBe("gpt-4o");
    expect(orchestratorController.agent.state.thinkingLevel).toBe("medium");

    const handlerPrompt = handlerController.agent.prompt("Continue handling");
    await waitFor(() => handlerController.promptStatus === "streaming");
    handlerController.agent.abort();
    await waitFor(() => harness.cancelRequests.length === 1);
    handlerGate.resolve();
    await handlerPrompt;
    await waitFor(() => handlerController.promptStatus === "idle");

    expect(harness.cancelRequests[0]).toEqual(threadTarget);
    expect(orchestratorController.promptStatus).toBe("idle");

    runtime.dispose();
  });

  it("applies workspace summary updates without depending on a global active surface", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "Orchestrator", "main reply"),
        createSummary("session-2", "Background", "stale summary"),
      ],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("main"), assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [userMessage("worker"), assistantMessage("worker ready")],
        }),
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-2"),
          messages: [userMessage("background"), assistantMessage("done")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");

    harness.updateSummary("session-2", (summary) => {
      summary.preview = "Background workflow updated.";
      summary.status = "running";
    });
    harness.emitWorkspaceSync("workspace.updated");

    await waitFor(
      () =>
        runtime.sessions.find((session) => session.id === "session-2")?.preview ===
        "Background workflow updated.",
    );

    expect(runtime.getPane("secondary")?.target).toEqual(threadTarget);
    expect(runtime.paneLayout.focusedPaneId).toBe("secondary");
    expect(harness.requestCounts.listSessions).toBe(1);

    runtime.dispose();
  });

  it("uses the focused pane session by default for inspectors", async () => {
    const commandInspector = createCommandInspector("command-77");
    const handlerThreads = [createHandlerThreadSummary("thread-77")];
    const handlerThreadInspector = createHandlerThreadInspector("thread-77");
    const workflowTaskAttemptInspector = createWorkflowTaskAttemptInspector(
      "workflow-task-attempt-77",
    );
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first reply"),
        createSummary("session-2", "Second", "second reply"),
      ],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("first"), assistantMessage("first reply")],
        }),
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-2"),
          messages: [userMessage("second"), assistantMessage("second reply")],
        }),
      ],
      commandInspector,
      handlerThreads,
      handlerThreadInspector,
      workflowTaskAttemptInspector,
    });

    const runtime = await createRuntime(harness);
    await runtime.openSession("session-2", "secondary");

    const detail = await runtime.getCommandInspector("command-77");
    const threads = await runtime.listHandlerThreads();
    const threadDetail = await runtime.getHandlerThreadInspector("thread-77");
    const workflowTaskAttemptDetail = await runtime.getWorkflowTaskAttemptInspector(
      "workflow-task-attempt-77",
    );

    expect(detail).toEqual(commandInspector);
    expect(threads).toEqual(handlerThreads);
    expect(threadDetail).toEqual(handlerThreadInspector);
    expect(workflowTaskAttemptDetail).toEqual(workflowTaskAttemptInspector);
    expect(harness.commandInspectorRequests).toEqual([
      { sessionId: "session-2", commandId: "command-77" },
    ]);
    expect(harness.handlerThreadListRequests).toEqual(["session-2"]);
    expect(harness.handlerThreadInspectorRequests).toEqual([
      { sessionId: "session-2", threadId: "thread-77" },
    ]);
    expect(harness.workflowTaskAttemptInspectorRequests).toEqual([
      { sessionId: "session-2", workflowTaskAttemptId: "workflow-task-attempt-77" },
    ]);

    runtime.dispose();
  });
});
