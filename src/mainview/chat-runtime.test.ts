import { describe, expect, it, mock } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  getModel,
  type AssistantMessage,
  type ImageContent,
  type Message,
  type TextContent,
} from "@mariozechner/pi-ai";
import type { ChatStorage, CustomProvider } from "./chat-storage";
import type { RuntimeSubmittedMessage } from "@svvy/core";
import {
  composerAttachmentPromptText,
  parseComposerAttachmentTextSignature,
  serializeComposerAttachmentTextSignature,
  type ArtifactOpenMessage,
  type ComposerAttachment,
  type CommandInspectorReadModel,
  type AppLogEntry,
  type AppLogQuery,
  type AppLogReadModel,
  type AppLogSummary,
  type AppLogUpdateMessage,
  type ConversationSurfaceSnapshot,
  type ConfiguredAgentProfileReadModelRecord,
  type DesktopRendererNotification,
  type PromptTarget,
  type RendererTelemetryRequest,
  type RequestUserInputAnswerRequest,
  type SendPromptRequest,
  type SetRequestUserInputTimerPausedRequest,
  type StateReadModelBaseline,
  type StateSnippetsReadModel,
  type SurfaceSyncMessage,
  type WriteCommandStdinRequest,
  type WriteCommandStdinResponse,
  type WorkspaceHandlerThreadInspector,
  type WorkspaceRuntimeApprovalRequest,
  type WorkspaceRequestUserInputRequest,
  type WorkspaceSessionSummary,
  type WorkspaceLayoutReadModel,
  type WorkspaceLayoutSlotReadModel,
  type WorkspacePaneRecord,
  type WorkspaceScoped,
  type WorkspaceWorkflowTaskAttemptInspector,
  type WorkflowsGeneratedReadModel,
  type WorkspaceTabInfo,
} from "../shared/workspace-contract";
import type { ComposerSnippetMention, SentSnippetProvenance } from "../shared/snippets";
import type { PromptHistoryEntry } from "./prompt-history";
import type { ChatRuntimeOptions, ChatRuntimeRpcClient } from "./chat-runtime";
import type { WorkspaceDockviewLayoutState, WorkspaceLayoutSlotId } from "./pane-layout";
import {
  DEFAULT_AGENT_SETTINGS_STATE,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  type AppPreferences,
} from "../shared/agent-settings";
import type {
  AbsolutePath,
  CommandId,
  ExtensionId,
  ExtensionUsageState,
  IsoDateTimeStringSchema,
  JsonValue,
  ModelId,
  ProviderId,
  QueueItemId,
  RequestInputQuestionId,
  RequestInputRequestId,
  RuntimeApprovalId,
  RuntimeClientRequestId,
  SnippetId,
  StateRevision,
  ThreadId,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspaceSessionId,
} from "@svvy/core";
import { buildWorkspaceSessionNavigation } from "../shared/session-navigation";
import { executePaletteFallbackPrompt } from "./command-palette";

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
const TEST_WORKSPACE_INFO: WorkspaceTabInfo = {
  workspaceTabId: "workspace-tab-1",
  workspaceId: "/tmp/svvy#runtime-1",
  cwd: "/tmp/svvy",
  workspaceLabel: "svvy",
  kind: "user",
  branch: "main",
  openedAt: "2026-04-10T10:00:00.000Z",
  activeLayoutId: "A",
};

type PromptHandlerResult = {
  assistantText: string;
  extraMessages?: AgentMessage[];
  reason?: Extract<SurfaceSyncMessage["reason"], "prompt.settled" | "surface.updated">;
  emitSurfaceSyncBeforeStreamDone?: boolean;
};

type PromptHandler = (
  request: NormalizedPromptRequest,
  harness: FakeRpcHarness,
) => Promise<PromptHandlerResult> | PromptHandlerResult;

type NormalizedPromptRequest = SendPromptRequest & {
  message: RuntimeSubmittedMessage;
};

type SurfaceRecord = {
  snapshot: ConversationSurfaceSnapshot;
  retainCount: number;
};

type RendererLayoutFixtureState = {
  layouts: Record<WorkspaceLayoutSlotId, WorkspaceDockviewLayoutState | null>;
};

type MutableSessionSummary = {
  -readonly [Key in keyof WorkspaceSessionSummary]: WorkspaceSessionSummary[Key];
};

type FakeRpcHarness = {
  client: ChatRuntimeRpcClient;
  openedTargets: PromptTarget[];
  closeRequests: PromptTarget[];
  promptRequests: NormalizedPromptRequest[];
  rendererTelemetryRequests: Array<WorkspaceScoped<RendererTelemetryRequest>>;
  modelUpdates: Array<{ target: PromptTarget; model: string }>;
  thoughtLevelUpdates: Array<{ target: PromptTarget; level: ReasoningEffort }>;
  cancelRequests: PromptTarget[];
  requestCounts: {
    sessionNavigation: number;
    listProviderAuths: number;
    fetchProviderAuth: number;
    rebaselineStateReadModels: number;
    rendererReady: number;
  };
  appLogSeenRequests: number[];
  branchListRequests: string[];
  branchSwitchRequests: Array<{ workspaceId: string; branch: string }>;
  emitAppLogUpdate: (payload: AppLogUpdateMessage) => void;
  emitDesktopNotification: (payload: DesktopRendererNotification) => void;
  setRebaselineResult: (baseline: StateReadModelBaseline) => void;
  setAppGlobalLogs: (readModel: AppLogReadModel) => void;
  setRequestInputReadModelRequests: (requests: readonly WorkspaceRequestUserInputRequest[]) => void;
  setApprovalsReadModelRequests: (requests: readonly WorkspaceRuntimeApprovalRequest[]) => void;
  commandInspectorRequests: Array<{ workspaceId: string; commandId: string }>;
  commandStdinRequests: Array<WorkspaceScoped<WriteCommandStdinRequest>>;
  handlerInspectorRequests: Array<{ workspaceId: string; threadId: string }>;
  workflowTaskAttemptInspectorRequests: Array<{
    workspaceId: string;
    workflowTaskAttemptId: string;
  }>;
  requestUserInputAnswerRequests: Array<WorkspaceScoped<RequestUserInputAnswerRequest>>;
  runtimeApprovalAnswerRequests: Array<WorkspaceScoped<{ requestId: string; approved: boolean }>>;
  requestUserInputTimerRequests: Array<WorkspaceScoped<SetRequestUserInputTimerPausedRequest>>;
  snippetCreateRequests: Array<
    Parameters<ChatRuntimeRpcClient["request"]["stateSnippetsCreateManaged"]>[0]
  >;
  snippetUpdateRequests: Array<
    Parameters<ChatRuntimeRpcClient["request"]["stateSnippetsUpdateManaged"]>[0]
  >;
  snippetDeleteRequests: Array<
    Parameters<ChatRuntimeRpcClient["request"]["stateSnippetsDeleteManaged"]>[0]
  >;
  snippetEnableRequests: Array<
    Parameters<ChatRuntimeRpcClient["request"]["stateSnippetsSetEnabled"]>[0]
  >;
  openSnippetSourceRequests: Array<
    Parameters<ChatRuntimeRpcClient["request"]["openSnippetSourceInEditor"]>[0]
  >;
  sourceEditOpenRequests: Array<Parameters<ChatRuntimeRpcClient["request"]["openSourceEdit"]>[0]>;
  sourceEditSaveRequests: Array<Parameters<ChatRuntimeRpcClient["request"]["saveSourceEdit"]>[0]>;
  openWorkflowsGeneratedExportRequests: Array<
    Parameters<ChatRuntimeRpcClient["request"]["openWorkflowsGeneratedExportInEditor"]>[0]
  >;
  workspaceLayoutSaveRequests: Array<
    Parameters<ChatRuntimeRpcClient["request"]["stateWorkspaceLayoutSaveSlot"]>[0]
  >;
  setWorkspaceLayoutSaveHandler: (
    handler:
      | ((
          request: Parameters<ChatRuntimeRpcClient["request"]["stateWorkspaceLayoutSaveSlot"]>[0],
        ) => Promise<void>)
      | null,
  ) => void;
  setWorkspaceLayoutReadHandler: (
    handler: ((readModel: WorkspaceLayoutReadModel) => Promise<void>) | null,
  ) => void;
  setWorkspaceActiveLayoutId: (layoutId: WorkspaceLayoutSlotId) => void;
  setCommandInspector: (inspector: CommandInspectorReadModel | null) => void;
  setHandlerInspectors: (inspectors: readonly WorkspaceHandlerThreadInspector[]) => void;
  setWorkflowTaskAttemptInspector: (
    inspector: WorkspaceWorkflowTaskAttemptInspector | null,
  ) => void;
  setCommandInspectorReadHandler: (
    handler: ((commandId: string, value: CommandInspectorReadModel | null) => Promise<void>) | null,
  ) => void;
  setOpenSessionHandler: (sessionId: string, handler: (() => Promise<void>) | null) => void;
  setSnippetRows: (rows: StateSnippetsReadModel["snippets"]) => void;
  setWorkflowsGeneratedReadModel: (readModel: WorkflowsGeneratedReadModel) => void;
  setPromptHandler: (surfacePiSessionId: string, handler: PromptHandler) => void;
  updateSummary: (sessionId: string, updater: (summary: MutableSessionSummary) => void) => void;
  emitSessionNavigationInvalidation: (workspaceId?: string) => void;
  emitArtifactOpen: (payload: ArtifactOpenMessage) => void;
  emitSurfaceSync: (
    payload: Omit<SurfaceSyncMessage, "workspaceId"> & { workspaceId?: string },
  ) => void;
  getRetainCount: (surfacePiSessionId: string) => number;
  getSurfaceSnapshot: (surfacePiSessionId: string) => ConversationSurfaceSnapshot;
  getRendererLayoutFixture: (workspaceId: string) => RendererLayoutFixtureState | null;
  setRendererLayoutFixture: (workspaceId: string, state: RendererLayoutFixtureState) => void;
};

function cloneTarget(target: PromptTarget): PromptTarget {
  return structuredClone(target);
}

function proxyArray<T>(items: T[]): T[] {
  return new Proxy(items, {}) as T[];
}

function proxyObject<T extends object>(item: T): T {
  return new Proxy(item, {}) as T;
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

function submittedUserMessage(message: RuntimeSubmittedMessage): Message {
  const content: Array<TextContent | ImageContent> = [];
  const text = message.text.trim();
  if (text) {
    content.push({ type: "text", text });
  }
  const attachments = (message.attachments ?? []).flatMap(
    (attachment, index): ComposerAttachment[] => {
      if (!attachment.path) {
        return [];
      }
      return [
        {
          id: attachment.id ?? `submitted-${index}`,
          kind: attachment.kind,
          name: attachment.name ?? attachment.path,
          path: attachment.path,
          ...(attachment.workspaceRelativePath !== undefined
            ? { workspaceRelativePath: attachment.workspaceRelativePath }
            : {}),
          ...(attachment.mimeType !== undefined ? { mimeType: attachment.mimeType } : {}),
          ...(attachment.sizeBytes !== undefined ? { sizeBytes: attachment.sizeBytes } : {}),
        },
      ];
    },
  );
  const attachmentText = composerAttachmentPromptText(attachments);
  if (attachmentText) {
    content.push({
      type: "text",
      text: attachmentText,
      textSignature: serializeComposerAttachmentTextSignature(attachments),
    });
  }
  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === "image" && attachment.dataBase64 && attachment.mimeType) {
      content.push({ type: "image", data: attachment.dataBase64, mimeType: attachment.mimeType });
    }
  }
  return {
    role: "user",
    timestamp: Date.now(),
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
  };
}

function submittedMessageFromAgentMessage(message: Message): { text: string } {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("")
            .trim()
        : "";
  return { text };
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
    surface: "handler",
    surfacePiSessionId,
    threadId,
  };
}

function hasUserText(messages: AgentMessage[], text: string): boolean {
  return messages.some((message) => {
    if (message.role !== "user" || !Array.isArray(message.content)) {
      return false;
    }
    return message.content.some((content) => content.type === "text" && content.text === text);
  });
}

function createSummary(
  id: string,
  title: string,
  preview: string,
  reasoningEffort: ReasoningEffort = "medium",
): WorkspaceSessionSummary {
  return {
    id,
    title,
    preview,
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    messageCount: 2,
    status: "idle",
    isPinned: false,
    pinnedAt: null,
    isArchived: false,
    archivedAt: null,
    isUnread: false,
    unreadAt: null,
    unreadReason: null,
    lastReadAt: null,
    provider: "openai",
    modelId: "gpt-4o",
    thinkingLevel: reasoningEffort,
    wait: null,
    counts: {
      turns: 0,
      threads: 0,
      commands: 0,
      episodes: 0,
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
  pendingUserMessage?: AgentMessage | null;
  streamMessage?: AssistantMessage | null;
  streamSequence?: number;
  queuedMessages?: ConversationSurfaceSnapshot["queuedMessages"];
  composerDraft?: ConversationSurfaceSnapshot["composerDraft"];
  provider?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  agentProfileId?: ConversationSurfaceSnapshot["agentProfileId"];
  loadedExtensionIds?: ConversationSurfaceSnapshot["loadedExtensionIds"];
  availableExtensionIds?: ConversationSurfaceSnapshot["availableExtensionIds"];
  systemPrompt?: string;
  resolvedSystemPrompt?: string;
  externalContextSources?: ConversationSurfaceSnapshot["externalContextSources"];
  promptBinding?: ConversationSurfaceSnapshot["promptBinding"];
  promptStatus?: ConversationSurfaceSnapshot["promptStatus"];
  activeTurnId?: string | null;
  activeTurnStartedAt?: string | null;
  turnTimings?: ConversationSurfaceSnapshot["turnTimings"];
}): ConversationSurfaceSnapshot {
  const systemPrompt = input.systemPrompt ?? "You are svvy.";
  return {
    target: structuredClone(input.target),
    messages: structuredClone(input.messages),
    pendingUserMessage: input.pendingUserMessage ? structuredClone(input.pendingUserMessage) : null,
    queuedMessages: structuredClone(input.queuedMessages ?? []),
    composerDraft: structuredClone(
      input.composerDraft ?? { text: "", attachments: [], updatedAt: null },
    ),
    streamMessage: input.streamMessage ? structuredClone(input.streamMessage) : null,
    streamSequence: input.streamSequence ?? 0,
    provider: input.provider ?? "openai",
    model: input.model ?? "gpt-4o",
    reasoningEffort: input.reasoningEffort ?? "medium",
    agentProfileId: input.agentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID,
    loadedExtensionIds: structuredClone(input.loadedExtensionIds ?? []),
    availableExtensionIds: structuredClone(input.availableExtensionIds ?? []),
    systemPrompt,
    resolvedSystemPrompt: input.resolvedSystemPrompt ?? systemPrompt,
    externalContextSources: structuredClone(input.externalContextSources ?? []),
    promptBinding: input.promptBinding ? structuredClone(input.promptBinding) : undefined,
    promptStatus: input.promptStatus ?? "idle",
    activeTurnId: input.activeTurnId ?? null,
    activeTurnStartedAt: input.activeTurnStartedAt ?? null,
    turnTimings: structuredClone(input.turnTimings ?? []),
  };
}

function createCommandInspector(
  commandId = "command-1",
  toolName = "execute_typescript",
): CommandInspectorReadModel {
  return {
    commandId,
    target: createOrchestratorTarget("session-1") as never,
    acceptedArguments: {},
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
    outputEvents: [],
    stdin: {
      mode: "none",
      canAttemptWrite: false,
      acceptedWrites: [],
    },
    argumentSnapshots: [],
    patchSnapshots: [],
    diagnostics: [],
    childCount: 1,
    summaryChildCount: 1,
    traceChildCount: 0,
    summaryChildren: [
      {
        commandId: "command-summary-1",
        toolName: "exec_command",
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
        outputEvents: [],
        stdin: {
          mode: "continuable",
          canAttemptWrite: false,
          acceptedWrites: [],
        },
        argumentSnapshots: [],
        patchSnapshots: [],
        diagnostics: [],
      },
    ],
    traceChildren: [],
  };
}

function createHandlerThreadSummary(threadId = "thread-1"): WorkspaceHandlerThreadInspector {
  return {
    threadId,
    surfacePiSessionId: `thread-session-${threadId}`,
    title: "Parser fix thread",
    objective: "Patch the parser bug and add regression coverage.",
    objectiveState: "concluded",
    historyMode: "isolated",
    status: "completed",
    wait: null,
    startedAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    finishedAt: "2026-04-10T10:05:00.000Z",
    commandCount: 1,
    workflowRunCount: 1,
    episodeCount: 1,
    artifactCount: 1,
    latestCommandRollup: null,
    latestWorkflowRun: {
      workflowRunId: "workflow-1",
      workflowName: "parser_regression",
      status: "completed",
      summary: "Parser workflow completed.",
      updatedAt: "2026-04-10T10:04:30.000Z",
      artifacts: [],
    },
    latestEpisode: {
      episodeId: "episode-1",
      kind: "change",
      title: "Latest report",
      summary: "Patched the parser transitions and added regression coverage.",
      createdAt: "2026-04-10T10:04:00.000Z",
    },
    commandRollups: [],
    workflowRuns: [],
    workflowTaskAttempts: [],
    episodes: [],
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
    contextBudget: null,
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
    generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
    generatedAgentContextBinding: null,
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

function createRequestUserInputRequest(
  overrides: Partial<WorkspaceRequestUserInputRequest> = {},
): WorkspaceRequestUserInputRequest {
  return {
    requestId: "rui-request-1",
    workspaceSessionId: "session-1",
    surfacePiSessionId: "session-1",
    threadId: null,
    ownerTitle: "Orchestrator",
    variant: "nonblocking",
    status: "open",
    createdAt: "2026-04-10T10:12:00.000Z",
    completedAt: null,
    timeout: null,
    questions: [
      {
        questionId: "rui-question-1",
        ordinal: 0,
        title: "Pick scope",
        question: "Which implementation scope should proceed?",
        defaultAnswer: {
          kind: "option",
          label: "Small",
          text: "Make the smallest useful change.",
        },
        choices: [
          {
            optionId: "rui-option-1",
            ordinal: 0,
            label: "Small",
            description: "Make the smallest useful change.",
            recommended: true,
          },
          {
            optionId: "rui-option-2",
            ordinal: 1,
            label: "Broad",
            description: "Take the broader slice.",
            recommended: false,
          },
        ],
        status: "open",
      },
    ],
    ...structuredClone(overrides),
  };
}

function createRuntimeApprovalRequest(
  overrides: Partial<WorkspaceRuntimeApprovalRequest> = {},
): WorkspaceRuntimeApprovalRequest {
  return {
    requestId: "apr-request-1",
    workspaceSessionId: "session-1",
    surfacePiSessionId: "session-1",
    threadId: null,
    ownerTitle: "Orchestrator",
    toolName: "exec_command",
    approvalMode: "user",
    cwd: "/tmp/workspace",
    command: "printf approved",
    commandFamily: null,
    snippetArtifactId: null,
    status: "pending",
    createdAt: "2026-04-10T10:12:00.000Z",
    completedAt: null,
    summary: "Run command: printf approved",
    ...structuredClone(overrides),
  };
}

function createMemoryStorage(): ChatStorage {
  const customProviders = new Map<string, CustomProvider>();
  const promptHistory = new Map<string, PromptHistoryEntry[]>();

  return {
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

function createRendererLayoutFixtureState(
  layout: RendererLayoutFixtureState["layouts"]["A"],
  activeLayoutId: "A" | "B" | "C" = "A",
): RendererLayoutFixtureState {
  return {
    layouts: {
      A: activeLayoutId === "A" ? layout : null,
      B: activeLayoutId === "B" ? layout : null,
      C: activeLayoutId === "C" ? layout : null,
    },
  };
}

function fixtureFallbackChrome(
  target: WorkspacePaneRecord["target"],
): Exclude<WorkspacePaneRecord["fallbackChrome"], null> {
  const kind = target.surface === "handler" ? "handler-thread" : target.surface;
  return {
    title: target.surface === "orchestrator" ? "Orchestrator" : "Restored surface",
    subtitle: null,
    kind,
  };
}

function workspaceLayoutFromFixture(
  workspaceId: string,
  fixture: RendererLayoutFixtureState | null,
): WorkspaceLayoutReadModel {
  const slots = (["A", "B", "C"] as const).map((layoutId): WorkspaceLayoutSlotReadModel => {
    const layout = fixture?.layouts[layoutId] ?? null;
    const panes = (layout?.panels ?? []).flatMap((panel): WorkspacePaneRecord[] => {
      if (!panel.binding) return [];
      const unavailableReason = panel.restore?.unavailableReason?.trim() ?? "";
      const target = structuredClone(panel.binding) as WorkspacePaneRecord["target"];
      return [
        unavailableReason
          ? {
              paneId: panel.panelId as never,
              target,
              localState: structuredClone(panel.localState),
              fallbackChrome: panel.fallbackChrome ?? fixtureFallbackChrome(target),
              placement: structuredClone(panel.placement ?? null) as never,
              restore: {
                kind: "unavailable",
                reason: unavailableReason,
                lastKnownLocationLabel: panel.restore?.lastKnownLocationLabel ?? null,
              },
            }
          : {
              paneId: panel.panelId as never,
              target,
              localState: structuredClone(panel.localState),
              fallbackChrome: null,
              placement: structuredClone(panel.placement ?? null) as never,
              restore: { kind: "ready" },
            },
      ];
    });
    const paneIds = new Set(panes.map((pane) => pane.paneId));
    return {
      workspaceId: workspaceId as WorkspaceId,
      layoutId,
      initialized: panes.length > 0,
      dockviewJson: structuredClone(layout?.dockview ?? null) as JsonValue | null,
      panes,
      compactSurfaces: (layout?.compactSurfaces ?? [])
        .filter((surface) => surface.panelId === null || paneIds.has(surface.panelId as never))
        .map((surface) => ({
          kind: surface.kind,
          workspaceSessionId: surface.workspaceSessionId as never,
          threadId: surface.threadId as never,
          panelId: surface.panelId as never,
          density: surface.density,
        })),
      focusedPaneId:
        layout?.focusedPanelId && paneIds.has(layout.focusedPanelId as never)
          ? (layout.focusedPanelId as never)
          : (panes[0]?.paneId ?? null),
      updatedAt: (layout?.updatedAt ?? "1970-01-01T00:00:00.000Z") as never,
    };
  });
  return { workspaceId: workspaceId as WorkspaceId, slots };
}

function saveLayoutFixtureSlot(
  fixtures: Map<string, RendererLayoutFixtureState>,
  request: Parameters<ChatRuntimeRpcClient["request"]["stateWorkspaceLayoutSaveSlot"]>[0],
): void {
  const fixture = fixtures.get(request.workspaceId) ?? createRendererLayoutFixtureState(null);
  fixture.layouts[request.layoutId] = {
    dockview: structuredClone(request.dockviewJson) as WorkspaceDockviewLayoutState["dockview"],
    panels: request.panes.map((pane) => ({
      panelId: pane.paneId,
      binding: structuredClone(pane.target) as never,
      localState: structuredClone(pane.localState),
      fallbackChrome: structuredClone(pane.fallbackChrome),
      placement: structuredClone(pane.placement) as never,
      restore:
        pane.restore.kind === "ready"
          ? { unavailableReason: null, lastKnownLocationLabel: null }
          : {
              unavailableReason: pane.restore.reason,
              lastKnownLocationLabel: pane.restore.lastKnownLocationLabel,
            },
    })),
    compactSurfaces: request.compactSurfaces.map((surface) => ({
      kind: surface.kind,
      workspaceSessionId: surface.workspaceSessionId,
      threadId: surface.threadId,
      panelId: surface.panelId,
      density: surface.density,
    })),
    focusedPanelId: request.focusedPaneId,
    updatedAt: new Date().toISOString(),
  };
  fixtures.set(request.workspaceId, structuredClone(fixture));
}

function emptyAppLogReadModel(): AppLogReadModel {
  return {
    entries: [],
    summary: {
      latestSeq: 0,
      seenSeq: 0,
      unread: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
      totals: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
    },
  };
}

function createFakeRpc(input: {
  sessions: WorkspaceSessionSummary[];
  surfaces: ConversationSurfaceSnapshot[];
  commandInspector?: CommandInspectorReadModel;
  commandStdinResponse?: WriteCommandStdinResponse;
  handlerThreads?: WorkspaceHandlerThreadInspector[];
  workflowTaskAttemptInspector?: WorkspaceWorkflowTaskAttemptInspector;
  requestUserInputRequests?: WorkspaceRequestUserInputRequest[];
  runtimeApprovalRequests?: WorkspaceRuntimeApprovalRequest[];
}): FakeRpcHarness {
  const artifactOpenListeners = new Set<(payload: ArtifactOpenMessage) => void>();
  const surfaceSyncListeners = new Set<(payload: SurfaceSyncMessage) => void>();
  const desktopNotificationListeners = new Set<(payload: DesktopRendererNotification) => void>();
  const summaries = new Map<string, MutableSessionSummary>(
    input.sessions.map((summary) => [
      summary.id,
      structuredClone(summary) as MutableSessionSummary,
    ]),
  );
  const surfaces = new Map<string, SurfaceRecord>(
    input.surfaces.map((snapshot) => [
      snapshot.target.surfacePiSessionId,
      { snapshot: structuredClone(snapshot), retainCount: 0 },
    ]),
  );
  const promptHandlers = new Map<string, PromptHandler>();
  const pendingPromptSurfaces = new Set<string>();
  const cancelledPromptSurfaces = new Set<string>();
  let archivedGroupCollapsed = true;
  const openedTargets: PromptTarget[] = [];
  const closeRequests: PromptTarget[] = [];
  const promptRequests: NormalizedPromptRequest[] = [];
  const rendererTelemetryRequests: Array<WorkspaceScoped<RendererTelemetryRequest>> = [];
  const modelUpdates: Array<{ target: PromptTarget; model: string }> = [];
  const thoughtLevelUpdates: Array<{ target: PromptTarget; level: ReasoningEffort }> = [];
  const cancelRequests: PromptTarget[] = [];
  const commandInspectorRequests: Array<{ workspaceId: string; commandId: string }> = [];
  const commandStdinRequests: Array<WorkspaceScoped<WriteCommandStdinRequest>> = [];
  const handlerInspectorRequests: Array<{ workspaceId: string; threadId: string }> = [];
  const workflowTaskAttemptInspectorRequests: Array<{
    workspaceId: string;
    workflowTaskAttemptId: string;
  }> = [];
  let requestInputReadModelRequests = structuredClone(input.requestUserInputRequests ?? []);
  let approvalsReadModelRequests = structuredClone(input.runtimeApprovalRequests ?? []);
  const requestUserInputAnswerRequests: Array<WorkspaceScoped<RequestUserInputAnswerRequest>> = [];
  const runtimeApprovalAnswerRequests: Array<
    WorkspaceScoped<{ requestId: string; approved: boolean }>
  > = [];
  const requestUserInputTimerRequests: Array<
    WorkspaceScoped<SetRequestUserInputTimerPausedRequest>
  > = [];
  const snippetCreateRequests: FakeRpcHarness["snippetCreateRequests"] = [];
  const snippetUpdateRequests: FakeRpcHarness["snippetUpdateRequests"] = [];
  const snippetDeleteRequests: FakeRpcHarness["snippetDeleteRequests"] = [];
  const snippetEnableRequests: FakeRpcHarness["snippetEnableRequests"] = [];
  const openSnippetSourceRequests: FakeRpcHarness["openSnippetSourceRequests"] = [];
  const sourceEditOpenRequests: FakeRpcHarness["sourceEditOpenRequests"] = [];
  const sourceEditSaveRequests: FakeRpcHarness["sourceEditSaveRequests"] = [];
  const openWorkflowsGeneratedExportRequests: FakeRpcHarness["openWorkflowsGeneratedExportRequests"] =
    [];
  const workspaceLayoutSaveRequests: FakeRpcHarness["workspaceLayoutSaveRequests"] = [];
  let workspaceLayoutSaveHandler:
    | ((request: FakeRpcHarness["workspaceLayoutSaveRequests"][number]) => Promise<void>)
    | null = null;
  let workspaceLayoutReadHandler: ((readModel: WorkspaceLayoutReadModel) => Promise<void>) | null =
    null;
  let commandInspectorReadModel = structuredClone(input.commandInspector ?? null);
  let commandInspectorReadHandler:
    | ((commandId: string, value: CommandInspectorReadModel | null) => Promise<void>)
    | null = null;
  let handlerInspectorReadModels = new Map(
    (input.handlerThreads ?? []).map((inspector) => [
      inspector.threadId,
      structuredClone(inspector),
    ]),
  );
  let workflowTaskAttemptInspectorReadModel = structuredClone(
    input.workflowTaskAttemptInspector ?? null,
  );
  const openSessionHandlers = new Map<string, () => Promise<void>>();
  const appLogSeenRequests: number[] = [];
  const branchListRequests: string[] = [];
  const branchSwitchRequests: Array<{ workspaceId: string; branch: string }> = [];
  const rendererLayoutFixtures = new Map<string, RendererLayoutFixtureState>();
  let workspaceInfo = structuredClone(TEST_WORKSPACE_INFO);
  let appLogEntries: AppLogEntry[] = [];
  let appLogSeenSeq = 0;
  let appGlobalLogs = emptyAppLogReadModel();
  let persistedAppPreferences: AppPreferences = structuredClone(
    DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
  );
  let configuredAgentProfiles: ConfiguredAgentProfileReadModelRecord[] = [
    {
      profileId: "default-orchestrator" as ConfiguredAgentProfileReadModelRecord["profileId"],
      actor: "orchestrator",
      name: "Default orchestrator",
      providerId: "openai" as ProviderId,
      modelId: "gpt-4o" as ModelId,
      reasoning: { effort: "medium" },
      followComposer: false,
      extensionUsage: {},
      extensionOrder: [],
      position: 0,
      updatedAt: "2026-04-10T10:00:00.000Z",
      builtin: true,
      locked: true,
      deletable: false,
    },
    {
      profileId: "thread-handler" as ConfiguredAgentProfileReadModelRecord["profileId"],
      actor: "handler",
      name: "Thread handler",
      providerId: "openai" as ProviderId,
      modelId: "gpt-4o" as ModelId,
      reasoning: { effort: "medium" },
      followComposer: false,
      extensionUsage: {},
      extensionOrder: [],
      position: 0,
      updatedAt: "2026-04-10T10:00:00.000Z",
      builtin: true,
      locked: true,
      deletable: false,
    },
  ];
  let agentActorExtensionDefaults = [
    {
      actor: "orchestrator" as const,
      extensionUsage: {} as Record<string, ExtensionUsageState>,
      extensionOrder: [] as ExtensionId[],
      updatedAt: null as string | null,
    },
    {
      actor: "workflow-task" as const,
      extensionUsage: {} as Record<string, ExtensionUsageState>,
      extensionOrder: [] as ExtensionId[],
      updatedAt: null as string | null,
    },
  ];
  let snippetRows: StateSnippetsReadModel["snippets"] = [];
  let workflowsGeneratedReadModel: WorkflowsGeneratedReadModel = {
    packageName: "@svvyx/workflows",
    facts: [],
    exports: [],
  };
  let desktopNotificationSequence = 0;
  let rebaselineResult: StateReadModelBaseline = {
    app: [],
    workspaces: [],
    revision: 0 as StateRevision,
  };
  const requestCounts = {
    sessionNavigation: 0,
    listProviderAuths: 0,
    fetchProviderAuth: 0,
    rebaselineStateReadModels: 0,
    rendererReady: 0,
  };
  let queuedMessageSequence = 0;

  const stateCommandResult = (clientRequestId?: RuntimeClientRequestId) => ({
    receipt: {
      clientRequestId: clientRequestId ?? null,
      outcome: "applied" as const,
      committedAt: "2026-04-10T10:10:00.000Z" as typeof IsoDateTimeStringSchema.Type,
      stateRevision: 1 as StateRevision,
    },
  });

  const listSessions = (): WorkspaceSessionSummary[] =>
    Array.from(summaries.values()).map((summary) => structuredClone(summary));

  const listNavigation = () =>
    buildWorkspaceSessionNavigation(listSessions(), archivedGroupCollapsed);

  const getSurfaceRecord = (surfacePiSessionId: string): SurfaceRecord => {
    const record = surfaces.get(surfacePiSessionId) ?? null;
    if (!record) {
      throw new Error(`Missing fake surface ${surfacePiSessionId}`);
    }
    return record;
  };

  const updateSummary = (
    sessionId: string,
    updater: (summary: MutableSessionSummary) => void,
  ): void => {
    const summary = summaries.get(sessionId) ?? null;
    if (!summary) {
      throw new Error(`Missing fake workspace session ${sessionId}`);
    }
    updater(summary);
  };

  const emitSessionNavigationInvalidation = (
    workspaceId = TEST_WORKSPACE_INFO.workspaceId,
  ): void => {
    desktopNotificationSequence += 1;
    for (const listener of desktopNotificationListeners) {
      listener({
        kind: "read-model-changed",
        eventGenerationId: "fake-runtime-event-generation" as never,
        sequence: desktopNotificationSequence as never,
        scope: {
          kind: "workspace",
          workspaceId: workspaceId as WorkspaceId,
        },
        invalidation: {
          scope: "workspace",
          workspaceId: workspaceId as WorkspaceId,
          invalidation: { model: "sessionNavigation" },
        },
      });
    }
  };

  const emitWorkspaceLayoutInvalidation = (
    workspaceId: string,
    layoutId: WorkspaceLayoutSlotId,
  ): void => {
    desktopNotificationSequence += 1;
    for (const listener of desktopNotificationListeners) {
      listener({
        kind: "read-model-changed",
        eventGenerationId: "fake-runtime-event-generation" as never,
        sequence: desktopNotificationSequence as never,
        scope: { kind: "workspace", workspaceId: workspaceId as WorkspaceId },
        invalidation: {
          scope: "workspace",
          workspaceId: workspaceId as WorkspaceId,
          invalidation: { model: "workspaceLayout", ids: [layoutId] },
        },
      });
    }
  };

  const emitArtifactOpen = (payload: ArtifactOpenMessage): void => {
    for (const listener of artifactOpenListeners) {
      listener(structuredClone(payload));
    }
  };

  const emitSurfaceSync = (
    payload: Omit<SurfaceSyncMessage, "workspaceId"> & { workspaceId?: string },
  ): void => {
    const scopedPayload: SurfaceSyncMessage = {
      ...payload,
      workspaceId: payload.workspaceId ?? TEST_WORKSPACE_INFO.workspaceId,
    };
    if (scopedPayload.reason === "surface.closed") {
      surfaces.delete(scopedPayload.target.surfacePiSessionId);
    } else if (scopedPayload.snapshot) {
      const existing = surfaces.get(scopedPayload.target.surfacePiSessionId);
      if (existing) {
        existing.snapshot = structuredClone(scopedPayload.snapshot);
      } else {
        surfaces.set(scopedPayload.target.surfacePiSessionId, {
          snapshot: structuredClone(scopedPayload.snapshot),
          retainCount: 0,
        });
      }
    }

    for (const listener of surfaceSyncListeners) {
      listener(structuredClone(scopedPayload));
    }
  };

  const summarizeAppLogs = (): AppLogSummary => {
    const latestSeq = appLogEntries.at(-1)?.seq ?? 0;
    const totals = {
      total: appLogEntries.length,
      debug: appLogEntries.filter((entry) => entry.level === "debug").length,
      info: appLogEntries.filter((entry) => entry.level === "info").length,
      warn: appLogEntries.filter((entry) => entry.level === "warn").length,
      error: appLogEntries.filter((entry) => entry.level === "error").length,
    };
    const unreadEntries = appLogEntries.filter((entry) => entry.seq > appLogSeenSeq);
    return {
      latestSeq,
      seenSeq: appLogSeenSeq,
      unread: {
        total: unreadEntries.length,
        debug: unreadEntries.filter((entry) => entry.level === "debug").length,
        info: unreadEntries.filter((entry) => entry.level === "info").length,
        warn: unreadEntries.filter((entry) => entry.level === "warn").length,
        error: unreadEntries.filter((entry) => entry.level === "error").length,
      },
      totals,
    };
  };

  const queryAppLogs = (query?: AppLogQuery): AppLogReadModel => {
    const entries = appLogEntries.filter((entry) => {
      if (query?.afterSeq !== undefined && entry.seq <= query.afterSeq) return false;
      if (query?.levels?.length && !query.levels.includes(entry.level)) return false;
      if (query?.sources?.length && !query.sources.includes(entry.source)) return false;
      return true;
    });
    return { entries: structuredClone(entries), summary: summarizeAppLogs() };
  };

  const emitAppLogUpdate = (payload: AppLogUpdateMessage): void => {
    const known = new Set(appLogEntries.map((entry) => entry.id));
    appLogEntries = [
      ...appLogEntries,
      ...payload.entries.filter((entry) => !known.has(entry.id)),
    ].toSorted((left, right) => left.seq - right.seq);
    desktopNotificationSequence += 1;
    for (const listener of desktopNotificationListeners) {
      listener(
        structuredClone({
          kind: "read-model-changed",
          eventGenerationId: "fake-runtime-event-generation" as never,
          sequence: desktopNotificationSequence as never,
          scope: {
            kind: "workspace",
            workspaceId: payload.workspaceId as never,
          },
          invalidation: {
            scope: "workspace",
            workspaceId: payload.workspaceId as never,
            invalidation: { model: "appLogs" },
          },
        } satisfies DesktopRendererNotification),
      );
    }
  };

  const emitAssistantStream = (
    target: PromptTarget,
    text: string,
    provider: string,
    model: string,
  ): void => {
    const partial = assistantMessage("", { provider, model });
    partial.content = [{ type: "text", text }];
    const record = getSurfaceRecord(target.surfacePiSessionId);
    record.snapshot = {
      ...record.snapshot,
      target: cloneTarget(target),
      streamMessage: partial,
      promptStatus: "streaming",
    };
    emitSurfaceSync({
      reason: "surface.updated",
      target: cloneTarget(target),
      snapshot: structuredClone(record.snapshot),
    });
  };

  const harness: FakeRpcHarness = {
    client: {
      request: {
        rendererReady: async () => {
          requestCounts.rendererReady += 1;
          return { ok: true as const };
        },
        getAgentSettings: async () => ({
          ...structuredClone(DEFAULT_AGENT_SETTINGS_STATE),
          agents: {
            ...structuredClone(DEFAULT_AGENT_SETTINGS_STATE.agents),
            orchestrators: [
              {
                ...structuredClone(DEFAULT_AGENT_SETTINGS_STATE.agents.orchestrators[0]!),
                provider: "openai",
                model: "gpt-4o",
                reasoningEffort: "medium",
                systemPrompt: "Default",
              },
            ],
            titleNamer: {
              provider: "openai-codex",
              model: "gpt-5.4-mini",
              reasoningEffort: "low",
              systemPrompt: "Name the session",
            },
          },
          workflowAgents: {
            explorer: {
              id: "explorer",
              label: "Explorer",
              provider: "openai",
              model: "gpt-4o",
              reasoningEffort: "medium",
              instructions: "Explore",
              extensions: [],
              extensionUsage: {},
            },
            implementer: {
              id: "implementer",
              label: "Implementer",
              provider: "openai",
              model: "gpt-4o",
              reasoningEffort: "medium",
              instructions: "Implement",
              extensions: [],
              extensionUsage: {},
            },
            reviewer: {
              id: "reviewer",
              label: "Reviewer",
              provider: "openai",
              model: "gpt-4o",
              reasoningEffort: "medium",
              instructions: "Review",
              extensions: [],
              extensionUsage: {},
            },
          },
          appPreferences: structuredClone(persistedAppPreferences),
        }),
        getAgentContextPreview: async () => ({
          actor: "orchestrator",
          profileId: "default-orchestrator",
          profileName: "Default orchestrator",
          provider: "openai",
          model: "gpt-4o",
          reasoningEffort: "medium",
          loadedExtensionIds: [],
          availableExtensionIds: [],
          systemPrompt: "Generated context preview",
          tokenCount: { tokens: 3, accuracy: "estimated" },
          extensions: [],
        }),
        listModelMetadata: async ({ workspaceId }) => [
          {
            providerId: "openai" as ProviderId,
            modelId: "gpt-4o" as ModelId,
            displayName: "GPT-4o",
            supportsReasoning: true,
            supportedReasoning: ["low", "medium", "high"],
            inputModalities: ["text", "image"],
            authStatus: {
              providerId: "openai" as ProviderId,
              workspaceId,
              health: "usable",
            },
          },
        ],
        getExtensionsInventory: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        fetchStateReadModel: async (request) => {
          switch (request.kind) {
            case "workspaceChrome": {
              const tab = {
                workspaceTabId: workspaceInfo.workspaceTabId as never,
                workspaceId: workspaceInfo.workspaceId as never,
                cwd: workspaceInfo.cwd as never,
                workspaceLabel: workspaceInfo.workspaceLabel,
                kind: workspaceInfo.kind,
                openedAt: workspaceInfo.openedAt as never,
                activeLayoutId: workspaceInfo.activeLayoutId,
              };
              return {
                kind: "workspaceChrome",
                value: {
                  activeWorkspaceTabId: tab.workspaceTabId,
                  tabs: [tab],
                  knownWorkspaces: [tab],
                },
              };
            }
            case "workspaceLayout": {
              const readModel = workspaceLayoutFromFixture(
                request.workspaceId,
                rendererLayoutFixtures.get(request.workspaceId) ?? null,
              );
              await workspaceLayoutReadHandler?.(readModel);
              return {
                kind: "workspaceLayout",
                value: readModel,
              };
            }
            case "appPreferences": {
              const preferences = (
                await harness.client.request.getAgentSettings({
                  workspaceId: TEST_WORKSPACE_INFO.workspaceId,
                })
              ).appPreferences;
              return {
                kind: "appPreferences",
                value: {
                  appearance: preferences.appAppearance,
                  externalEditor:
                    preferences.preferredExternalEditor === "system"
                      ? null
                      : preferences.preferredExternalEditor,
                  artifactDirectory: preferences.artifactDirectory,
                  approvalMode: preferences.approvalMode,
                  networkAccess: preferences.networkAccess,
                  externalInstructions: preferences.externalInstructions,
                  ambientResources: preferences.ambientAgentResources as unknown as JsonValue,
                  updatedAt: new Date(0).toISOString(),
                  revision: 0 as StateRevision,
                },
              };
            }
            case "settings": {
              const appPreferences = await harness.client.request.fetchStateReadModel({
                kind: "appPreferences",
              });
              if (appPreferences.kind !== "appPreferences") {
                throw new Error("Expected appPreferences.");
              }
              return {
                kind: "settings",
                value: { preferences: appPreferences.value },
              };
            }
            case "appLogs":
              return {
                kind: "appLogs",
                value: request.workspaceId
                  ? queryAppLogs(request.query)
                  : structuredClone(appGlobalLogs),
              };
            case "appLogSummary":
              return {
                kind: "appLogSummary",
                value: request.workspaceId
                  ? summarizeAppLogs()
                  : structuredClone(appGlobalLogs.summary),
              };
            case "providerAuth":
              requestCounts.fetchProviderAuth += 1;
              return {
                kind: "providerAuth",
                value: {
                  providers: [
                    {
                      providerId: "openai" as ProviderId,
                      health: "usable",
                    },
                  ],
                  usableModelProviders: ["openai" as ProviderId],
                },
              };
            case "agents":
              return {
                kind: "agents",
                value: {
                  configuredProfiles: structuredClone(configuredAgentProfiles),
                  actorExtensionDefaults: structuredClone(agentActorExtensionDefaults),
                  bindings: [],
                  generatedContextPreviews: [],
                },
              };
            case "sessionNavigation":
              requestCounts.sessionNavigation += 1;
              return {
                kind: "sessionNavigation",
                value: listNavigation(),
              };
            case "commandInspector": {
              commandInspectorRequests.push({
                workspaceId: request.workspaceId,
                commandId: request.commandId,
              });
              const value = structuredClone(commandInspectorReadModel);
              await commandInspectorReadHandler?.(request.commandId, value);
              return { kind: "commandInspector", value };
            }
            case "handlerInspector": {
              handlerInspectorRequests.push({
                workspaceId: request.workspaceId,
                threadId: request.threadId,
              });
              return {
                kind: "handlerInspector",
                value: structuredClone(handlerInspectorReadModels.get(request.threadId) ?? null),
              };
            }
            case "requestInput":
              return {
                kind: "requestInput",
                value: { requests: structuredClone(requestInputReadModelRequests) },
              };
            case "approvals":
              return {
                kind: "approvals",
                value: {
                  requests: structuredClone(
                    approvalsReadModelRequests.filter(
                      (approvalRequest) => approvalRequest.status === "pending",
                    ),
                  ),
                },
              };
            case "snippets": {
              const rows = request.snippetId
                ? snippetRows.filter((snippet) => snippet.id === request.snippetId)
                : snippetRows;
              return {
                kind: "snippets",
                value: {
                  managed: structuredClone(rows.filter((snippet) => snippet.source === "svvy")),
                  discovered: structuredClone(rows.filter((snippet) => snippet.source !== "svvy")),
                  snippets: structuredClone(rows),
                },
              };
            }
            case "workflowsGenerated":
              return {
                kind: "workflowsGenerated",
                value: structuredClone(workflowsGeneratedReadModel),
              };
            case "workflowTaskAttemptInspector":
              workflowTaskAttemptInspectorRequests.push({
                workspaceId: request.workspaceId,
                workflowTaskAttemptId: request.workflowTaskAttemptId,
              });
              return {
                kind: "workflowTaskAttemptInspector",
                value: structuredClone(workflowTaskAttemptInspectorReadModel),
              };
            default:
              throw new Error(`Unsupported state read model in harness: ${request.kind}`);
          }
        },
        refetchStateReadModels: async () => [],
        refetchStateReadModelInvalidation: async ({ descriptor }) => {
          const descriptorWorkspaceId =
            descriptor.scope === "workspace"
              ? descriptor.workspaceId
              : (TEST_WORKSPACE_INFO.workspaceId as WorkspaceId);
          switch (descriptor.invalidation.model) {
            case "appLogs":
              return [
                await harness.client.request.fetchStateReadModel({
                  kind: "appLogs",
                  workspaceId:
                    descriptor.scope === "workspace" ? descriptor.workspaceId : undefined,
                }),
                await harness.client.request.fetchStateReadModel({
                  kind: "appLogSummary",
                  workspaceId:
                    descriptor.scope === "workspace" ? descriptor.workspaceId : undefined,
                }),
              ];
            case "appPreferences":
              return [await harness.client.request.fetchStateReadModel({ kind: "appPreferences" })];
            case "settings":
              return [await harness.client.request.fetchStateReadModel({ kind: "settings" })];
            case "providerAuth":
              return [await harness.client.request.fetchStateReadModel({ kind: "providerAuth" })];
            case "agents":
              return [await harness.client.request.fetchStateReadModel({ kind: "agents" })];
            case "workspaceChrome":
              return [
                await harness.client.request.fetchStateReadModel({ kind: "workspaceChrome" }),
              ];
            case "workspaceLayout":
              return [
                await harness.client.request.fetchStateReadModel({
                  kind: "workspaceLayout",
                  workspaceId:
                    descriptor.scope === "workspace"
                      ? descriptor.workspaceId
                      : (TEST_WORKSPACE_INFO.workspaceId as WorkspaceId),
                }),
              ];
            case "sessionNavigation":
              return [
                await harness.client.request.fetchStateReadModel({
                  kind: "sessionNavigation",
                  workspaceId:
                    descriptor.scope === "workspace"
                      ? descriptor.workspaceId
                      : (TEST_WORKSPACE_INFO.workspaceId as WorkspaceId),
                }),
              ];
            case "commandInspector":
              return await Promise.all(
                descriptor.invalidation.ids.map((commandId) =>
                  harness.client.request.fetchStateReadModel({
                    kind: "commandInspector",
                    workspaceId: descriptorWorkspaceId,
                    commandId,
                  }),
                ),
              );
            case "handlerThreadInspector":
              return await Promise.all(
                descriptor.invalidation.ids.map((threadId) =>
                  harness.client.request.fetchStateReadModel({
                    kind: "handlerInspector",
                    workspaceId: descriptorWorkspaceId,
                    threadId,
                  }),
                ),
              );
            case "workflowTaskAttemptInspector":
              return await Promise.all(
                descriptor.invalidation.ids.map((workflowTaskAttemptId) =>
                  harness.client.request.fetchStateReadModel({
                    kind: "workflowTaskAttemptInspector",
                    workspaceId: descriptorWorkspaceId,
                    workflowTaskAttemptId,
                  }),
                ),
              );
            case "requestInput":
              return [
                await harness.client.request.fetchStateReadModel({
                  kind: "requestInput",
                  workspaceId:
                    descriptor.scope === "workspace" ? descriptor.workspaceId : undefined,
                }),
              ];
            case "runtimeApprovals":
              return [
                await harness.client.request.fetchStateReadModel({
                  kind: "approvals",
                  workspaceId:
                    descriptor.scope === "workspace" ? descriptor.workspaceId : undefined,
                }),
              ];
            case "snippets":
              return [
                await harness.client.request.fetchStateReadModel({
                  kind: "snippets",
                  workspaceId:
                    descriptor.scope === "workspace"
                      ? descriptor.workspaceId
                      : (TEST_WORKSPACE_INFO.workspaceId as WorkspaceId),
                  snippetId: descriptor.invalidation.ids?.[0] as SnippetId | undefined,
                }),
              ];
            case "workflowsGenerated":
              return [
                await harness.client.request.fetchStateReadModel({
                  kind: "workflowsGenerated",
                }),
              ];
            default:
              return [];
          }
        },
        rebaselineStateReadModels: async () => {
          requestCounts.rebaselineStateReadModels += 1;
          return structuredClone(rebaselineResult);
        },
        saveExtensionSnapshot: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        renameExtensionSnapshot: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        deleteExtensionSnapshot: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        loadExtensionSnapshot: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        createExtension: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        duplicateExtension: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        deleteExtension: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        resetExtension: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        buildExtension: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        setExtensionTypescriptApi: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        setExtensionDefaultUsage: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        reorderExtensionDefaults: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        addExtensionInstructionFile: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        removeExtensionInstructionFile: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        configureExtensionInstructionFile: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        updateExtensionInstructionFile: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        openExtensionInstructionFileInEditor: async () => ({
          opened: true,
          editor: "system",
          path: "/tmp/instruction.md",
        }),
        setExtensionEnvSecret: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        removeExtensionEnvSecret: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        setExtensionEnvOverride: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        removeExtensionEnvOverride: async () => ({
          extensions: [],
          reversibleChanges: [],
          snapshots: [],
        }),
        getOpenWorkspaces: async () => [structuredClone(TEST_WORKSPACE_INFO)],
        updateWorkflowAgent: async ({ key, settings, workspaceId }) => {
          const state = {
            ...(await harness.client.request.getAgentSettings({ workspaceId })),
            workflowAgents: {
              ...(await harness.client.request.getAgentSettings({ workspaceId })).workflowAgents,
              [key]: settings,
            },
          };
          return { ok: true, state, agent: settings };
        },
        deleteWorkflowAgent: async ({ key, workspaceId }) => {
          const next = await harness.client.request.getAgentSettings({ workspaceId });
          const workflowAgents = { ...next.workflowAgents };
          delete workflowAgents[key];
          return {
            ...next,
            workflowAgents,
          };
        },
        openWorkflowAgentSourceInEditor: async ({ key }) => ({
          opened: true,
          path: `/tmp/${key}.agent.json`,
          editor: "system",
        }),
        setAgentProfileExtensionUsage: async ({
          agentProfile,
          extensionId,
          state,
          workspaceId,
        }) => {
          const next = await harness.client.request.getAgentSettings({ workspaceId });
          const updateExtensionUsage = (extensionUsage: Record<string, ExtensionUsageState>) => {
            if (extensionUsage[extensionId] === state) {
              const nextUsage = { ...extensionUsage };
              delete nextUsage[extensionId];
              return nextUsage;
            }
            return { ...extensionUsage, [extensionId]: state };
          };
          next.agents.orchestrators = next.agents.orchestrators.map((profile) =>
            profile.id === agentProfile
              ? {
                  ...profile,
                  extensionUsage: updateExtensionUsage(profile.extensionUsage),
                }
              : profile,
          );
          if (next.agents.special.threadHandler.id === agentProfile) {
            next.agents.special.threadHandler = {
              ...next.agents.special.threadHandler,
              extensionUsage: updateExtensionUsage(
                next.agents.special.threadHandler.extensionUsage,
              ),
            };
          }
          if (next.workflowAgents[agentProfile]) {
            const overrides = updateExtensionUsage(
              next.workflowAgents[agentProfile].overrides ?? {},
            );
            next.workflowAgents[agentProfile] = {
              ...next.workflowAgents[agentProfile],
              overrides,
            };
          }
          return next;
        },
        stateAppPreferencesUpdate: async (request) => {
          const externalEditor = request.patch.externalEditor;
          persistedAppPreferences = {
            ...persistedAppPreferences,
            ...(request.patch.appearance !== undefined
              ? { appAppearance: request.patch.appearance }
              : {}),
            ...(externalEditor !== undefined
              ? externalEditor === null
                ? { preferredExternalEditor: "system" as const }
                : ["code", "cursor", "zed", "sublime"].includes(externalEditor)
                  ? {
                      preferredExternalEditor:
                        externalEditor as typeof persistedAppPreferences.preferredExternalEditor,
                    }
                  : {
                      preferredExternalEditor: "custom" as const,
                      customExternalEditorCommand: externalEditor,
                    }
              : {}),
            ...(request.patch.artifactDirectory !== undefined
              ? { artifactDirectory: request.patch.artifactDirectory }
              : {}),
            ...(request.patch.approvalMode !== undefined
              ? { approvalMode: request.patch.approvalMode }
              : {}),
            ...(request.patch.networkAccess !== undefined
              ? { networkAccess: request.patch.networkAccess }
              : {}),
            ...(request.patch.externalInstructions !== undefined
              ? { externalInstructions: structuredClone(request.patch.externalInstructions) }
              : {}),
            ...(request.patch.ambientResources !== undefined
              ? {
                  ambientAgentResources: structuredClone(
                    request.patch.ambientResources,
                  ) as unknown as typeof persistedAppPreferences.ambientAgentResources,
                }
              : {}),
          };
          return {
            receipt: {
              clientRequestId: request.clientSubmission?.clientRequestId ?? null,
              outcome: "applied",
              committedAt: new Date(0).toISOString() as typeof IsoDateTimeStringSchema.Type,
              stateRevision: 1 as StateRevision,
            },
          };
        },
        updateRequestUserInputSettings: async ({ workspaceId, ...settings }) => {
          return {
            ...(await harness.client.request.getAgentSettings({ workspaceId })),
            requestUserInput: settings,
          };
        },
        getWorkspaceInfo: async () => structuredClone(workspaceInfo),
        stateWorkspaceLayoutSaveSlot: async (request) => {
          workspaceLayoutSaveRequests.push(structuredClone(request));
          await workspaceLayoutSaveHandler?.(request);
          saveLayoutFixtureSlot(rendererLayoutFixtures, request);
          queueMicrotask(() =>
            emitWorkspaceLayoutInvalidation(request.workspaceId, request.layoutId),
          );
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        listWorkspaceBranches: async ({ workspaceId }) => {
          branchListRequests.push(workspaceId);
          return {
            currentBranch: workspaceInfo.branch,
            branches: ["main", "feature/sidebar"].map((branch) => ({
              name: branch,
              current: branch === workspaceInfo.branch,
            })),
          };
        },
        switchWorkspaceBranch: async ({ workspaceId, branch }) => {
          branchSwitchRequests.push({ workspaceId, branch });
          if (branch === "missing") {
            return {
              ok: false,
              workspace: structuredClone(workspaceInfo),
              error: "Branch is not available in this workspace.",
            };
          }
          workspaceInfo = { ...workspaceInfo, branch };
          return { ok: true, workspace: structuredClone(workspaceInfo) };
        },
        stateAppLogsMarkRead: async (request) => {
          const throughSeq = request.entryIds.reduce((highest, entryId) => {
            const match = /^app-log-(\d+)$/.exec(entryId);
            return Math.max(highest, match ? Number(match[1]) : 0);
          }, 0);
          appLogSeenRequests.push(throughSeq);
          appLogSeenSeq = Math.max(appLogSeenSeq, throughSeq);
          return {
            receipt: {
              clientRequestId: request.clientSubmission.clientRequestId ?? null,
              outcome: "applied",
              committedAt: request.readAt,
              stateRevision: 1 as StateRevision,
            },
          };
        },
        writeClipboardText: async () => ({ ok: true }),
        listWorkspacePaths: async () => [
          { kind: "file", workspaceRelativePath: "docs/progress.md" },
          { kind: "folder", workspaceRelativePath: "src/mainview/" },
        ],
        pickWorkspaceAttachments: async () => ({
          attachments: [
            {
              id: "file:docs/progress.md",
              kind: "file",
              name: "progress.md",
              path: "docs/progress.md",
              workspaceRelativePath: "docs/progress.md",
            },
          ],
          skippedPaths: [],
        }),
        importComposerAttachments: async () => ({ attachments: [], skippedPaths: [] }),
        openWorkspacePath: async ({ workspaceRelativePath }) => ({
          opened: workspaceRelativePath === "docs/progress.md",
          kind: workspaceRelativePath === "docs/progress.md" ? "file" : "missing",
        }),
        openWorkflowsGeneratedExportInEditor: async (request) => {
          openWorkflowsGeneratedExportRequests.push(structuredClone(request));
          const generatedExport = workflowsGeneratedReadModel.exports.find(
            (candidate) => candidate.qualifiedName === request.qualifiedName,
          );
          return {
            opened: true,
            editor: "system",
            path:
              (request.target === "source"
                ? generatedExport?.sourcePath
                : generatedExport?.generatedPath) ?? "",
          };
        },
        openGeneratedAgentContextExternalSourceInEditor: async ({ path }) => ({
          opened: true,
          editor: "system",
          path,
        }),
        getGeneratedAgentContextExternalSources: async () => [],
        stateSnippetsCreateManaged: async (request) => {
          snippetCreateRequests.push(structuredClone(request));
          const snippetId = "snippet-1" as SnippetId;
          snippetRows = [
            ...snippetRows,
            {
              id: snippetId,
              source: "svvy",
              title: request.title,
              body: request.body,
              metadata: structuredClone(request.metadata),
              enabled: request.enabled,
              path: null,
              updatedAt: new Date(0).toISOString(),
            },
          ];
          return {
            snippetId,
            receipt: {
              clientRequestId: request.clientSubmission?.clientRequestId ?? null,
              outcome: "applied",
              committedAt: new Date(0).toISOString() as typeof IsoDateTimeStringSchema.Type,
              stateRevision: 1 as StateRevision,
            },
          };
        },
        stateSnippetsUpdateManaged: async (request) => {
          snippetUpdateRequests.push(structuredClone(request));
          snippetRows = snippetRows.map((snippet) =>
            snippet.id === request.snippetId ? { ...snippet, ...request.patch } : snippet,
          );
          return {
            receipt: {
              clientRequestId: request.clientSubmission?.clientRequestId ?? null,
              outcome: "applied",
              committedAt: new Date(0).toISOString() as typeof IsoDateTimeStringSchema.Type,
              stateRevision: 1 as StateRevision,
            },
          };
        },
        stateSnippetsDeleteManaged: async (request) => {
          snippetDeleteRequests.push(structuredClone(request));
          snippetRows = snippetRows.filter((snippet) => snippet.id !== request.snippetId);
          return {
            receipt: {
              clientRequestId: request.clientSubmission?.clientRequestId ?? null,
              outcome: "applied",
              committedAt: new Date(0).toISOString() as typeof IsoDateTimeStringSchema.Type,
              stateRevision: 1 as StateRevision,
            },
          };
        },
        stateSnippetsSetEnabled: async (request) => {
          snippetEnableRequests.push(structuredClone(request));
          snippetRows = snippetRows.map((snippet) =>
            snippet.id === request.snippetId ? { ...snippet, enabled: request.enabled } : snippet,
          );
          return {
            receipt: {
              clientRequestId: request.clientSubmission?.clientRequestId ?? null,
              outcome: "applied",
              committedAt: new Date(0).toISOString() as typeof IsoDateTimeStringSchema.Type,
              stateRevision: 1 as StateRevision,
            },
          };
        },
        openSnippetSourceInEditor: async (request) => {
          openSnippetSourceRequests.push(structuredClone(request));
          return {
            opened: true,
            editor: "system",
            path: snippetRows.find((snippet) => snippet.id === request.snippetId)?.path ?? "",
          };
        },
        openSourceEdit: async (request) => {
          sourceEditOpenRequests.push(structuredClone(request));
          return {
            sourceKind: request.sourceKind,
            sourceId: request.sourceId,
            path: `/tmp/${request.sourceId}.agent.json` as AbsolutePath,
            sourceVersion: "sha256:source-version",
            fingerprint: "sha256:source-version",
            text: "{}\n",
            diagnostics: [],
          };
        },
        saveSourceEdit: async (request) => {
          sourceEditSaveRequests.push(structuredClone(request));
          return {
            status: "saved",
            sourceVersion: "sha256:saved-version",
            fingerprint: "sha256:saved-version",
            diagnostics: [],
            reconcileRequired: true,
          };
        },
        stateAgentProfilesUpdateOrchestrator: async (request) => {
          const current = configuredAgentProfiles.find(
            (profile) =>
              profile.actor === "orchestrator" && profile.profileId === request.profile.profileId,
          );
          const builtin = request.profile.profileId === "default-orchestrator";
          configuredAgentProfiles = [
            ...configuredAgentProfiles.filter(
              (profile) =>
                profile.actor !== "orchestrator" || profile.profileId !== request.profile.profileId,
            ),
            {
              profileId: request.profile.profileId,
              actor: "orchestrator",
              name: request.profile.name,
              providerId: request.profile.providerId,
              modelId: request.profile.modelId,
              reasoning: request.profile.reasoning ?? null,
              followComposer: request.profile.followComposer,
              extensionUsage: { ...request.profile.extensionUsage },
              extensionOrder: [...(request.profile.extensionOrder ?? [])],
              position:
                current?.position ??
                configuredAgentProfiles.filter((profile) => profile.actor === "orchestrator")
                  .length,
              updatedAt: "2026-04-10T10:10:00.000Z",
              builtin,
              locked: builtin,
              deletable: !builtin,
            },
          ];
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateAgentProfilesUpdateThreadHandler: async (request) => {
          configuredAgentProfiles = [
            ...configuredAgentProfiles.filter((profile) => profile.actor !== "handler"),
            {
              profileId: request.profile.profileId,
              actor: "handler",
              name: request.profile.name,
              providerId: request.profile.providerId,
              modelId: request.profile.modelId,
              reasoning: request.profile.reasoning ?? null,
              followComposer: false,
              extensionUsage: { ...request.profile.extensionUsage },
              extensionOrder: [...(request.profile.extensionOrder ?? [])],
              position: 0,
              updatedAt: "2026-04-10T10:10:00.000Z",
              builtin: true,
              locked: true,
              deletable: false,
            },
          ];
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateAgentProfilesDeleteOrchestrator: async (request) => {
          configuredAgentProfiles = configuredAgentProfiles.filter(
            (profile) =>
              profile.actor !== "orchestrator" ||
              profile.profileId !== request.profileId ||
              profile.locked,
          );
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateAgentProfilesReorderOrchestrators: async (request) => {
          const byId = new Map(
            configuredAgentProfiles
              .filter((profile) => profile.actor === "orchestrator")
              .map((profile) => [profile.profileId, profile]),
          );
          const orchestrators = request.profileIds.flatMap((profileId, position) => {
            const profile = byId.get(profileId);
            return profile ? [{ ...profile, position }] : [];
          });
          configuredAgentProfiles = [
            ...orchestrators,
            ...configuredAgentProfiles.filter((profile) => profile.actor === "handler"),
          ];
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateAgentProfilesSetExtensionUsage: async (request) => {
          configuredAgentProfiles = configuredAgentProfiles.map((profile) =>
            profile.actor === request.actor && profile.profileId === request.profileId
              ? {
                  ...profile,
                  extensionUsage: {
                    ...profile.extensionUsage,
                    [request.extensionId]: request.usage,
                  },
                }
              : profile,
          );
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateAgentProfilesPromoteExtensionDefault: async (request) => {
          agentActorExtensionDefaults = agentActorExtensionDefaults.map((defaults) =>
            defaults.actor === request.actor
              ? {
                  ...defaults,
                  extensionUsage: {
                    ...defaults.extensionUsage,
                    [request.extensionId]: request.usage,
                  },
                  updatedAt: "2026-04-10T10:10:00.000Z",
                }
              : defaults,
          );
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateAgentProfilesResetExtensionDefaults: async (request) => {
          agentActorExtensionDefaults = agentActorExtensionDefaults.map((defaults) =>
            defaults.actor === request.actor
              ? {
                  ...defaults,
                  extensionUsage:
                    request.reset === "usage" || request.reset === "usage-and-order"
                      ? {}
                      : defaults.extensionUsage,
                  extensionOrder:
                    request.reset === "order" || request.reset === "usage-and-order"
                      ? []
                      : defaults.extensionOrder,
                  updatedAt: "2026-04-10T10:10:00.000Z",
                }
              : defaults,
          );
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateAgentProfilesSetExternalInstructionUsage: async (request) => {
          configuredAgentProfiles = configuredAgentProfiles.map((profile) =>
            profile.actor === request.actor && profile.profileId === request.profileId
              ? {
                  ...profile,
                  extensionUsage: {
                    ...profile.extensionUsage,
                    [request.sourceId]:
                      request.usage === "disabled" ? "unavailable" : request.usage,
                  },
                }
              : profile,
          );
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        writeCommandStdin: async (request) => {
          commandStdinRequests.push(structuredClone(request));
          return structuredClone(
            input.commandStdinResponse ?? {
              commandId: request.commandId,
              status: "accepted",
              acceptedBytes: new TextEncoder().encode(request.text).byteLength,
            },
          );
        },
        getArtifactPreview: async ({ sessionId, artifactId }) => ({
          artifactId,
          sessionId,
          kind: "text",
          name: `${artifactId}.txt`,
          createdAt: "2026-04-10T10:04:30.000Z",
          missingFile: false,
          content: `artifact ${artifactId}`,
        }),
        createSession: async ({ title }) => {
          const sessionId = `session-${summaries.size + 1}`;
          const summary = createSummary(sessionId, title ?? "New orchestrator", "");
          const snapshot = createSurfaceSnapshot({
            target: createOrchestratorTarget(sessionId),
            messages: [],
          });
          summaries.set(sessionId, summary);
          surfaces.set(sessionId, { snapshot, retainCount: 1 });
          return structuredClone(snapshot);
        },
        openSession: async ({ sessionId }) => {
          await openSessionHandlers.get(sessionId)?.();
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
          if (record.retainCount === 0 && record.snapshot.promptStatus !== "streaming") {
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
        stateSessionNavigationSetPinned: async (request) => {
          updateSummary(request.workspaceSessionId, (summary) => {
            summary.isPinned = request.pinned;
            summary.pinnedAt = request.pinned ? "2026-04-10T10:10:00.000Z" : null;
            if (request.pinned) {
              summary.isArchived = false;
              summary.archivedAt = null;
            }
          });
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateSessionNavigationSetArchived: async (request) => {
          updateSummary(request.workspaceSessionId, (summary) => {
            summary.isArchived = request.archived;
            summary.archivedAt = request.archived ? "2026-04-10T10:10:00.000Z" : null;
            if (request.archived) {
              summary.isPinned = false;
              summary.pinnedAt = null;
            }
          });
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateSessionNavigationMarkUnread: async (request) => {
          updateSummary(request.workspaceSessionId, (summary) => {
            summary.isUnread = true;
            summary.unreadAt = "2026-04-10T10:10:00.000Z";
            summary.unreadReason = "manual";
          });
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateSessionNavigationMarkRead: async (request) => {
          updateSummary(request.workspaceSessionId, (summary) => {
            summary.isUnread = false;
            summary.unreadAt = null;
            summary.unreadReason = null;
            summary.lastReadAt = "2026-04-10T10:11:00.000Z";
          });
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        stateSessionNavigationSetSectionState: async (request) => {
          const { section, collapsed } = request;
          if (section === "archived" && typeof collapsed === "boolean") {
            archivedGroupCollapsed = collapsed;
          }
          return stateCommandResult(request.clientSubmission?.clientRequestId);
        },
        sendPrompt: async (request) => {
          const record = getSurfaceRecord(request.target.surfacePiSessionId);
          const runtimeMessage: RuntimeSubmittedMessage = {
            text: request.text,
            ...(request.attachments ? { attachments: request.attachments } : {}),
          };
          const normalizedRequest: NormalizedPromptRequest = {
            ...structuredClone(request),
            message: structuredClone(runtimeMessage),
          };
          const pendingUserMessage = submittedUserMessage(runtimeMessage);
          if (record.snapshot.promptStatus === "streaming") {
            record.snapshot = {
              ...record.snapshot,
              composerDraft: {
                text: "",
                attachments: [],
                snippetMentions: [],
                updatedAt: "2026-04-10T10:12:00.000Z",
              },
              queuedMessages: [
                ...record.snapshot.queuedMessages,
                {
                  id: `queued-${++queuedMessageSequence}`,
                  kind: "user_message",
                  text:
                    pendingUserMessage && typeof pendingUserMessage.content !== "string"
                      ? pendingUserMessage.content
                          .map((block) => (block.type === "text" ? block.text : ""))
                          .join("")
                      : String(pendingUserMessage?.content ?? ""),
                  status: "queued",
                  createdAt: "2026-04-10T10:12:00.000Z",
                  updatedAt: "2026-04-10T10:12:00.000Z",
                },
              ],
            };
            queueMicrotask(() => {
              emitSurfaceSync({
                reason: "surface.updated",
                target: cloneTarget(request.target),
                snapshot: structuredClone(record.snapshot),
              });
            });
            return {
              target: cloneTarget(request.target),
              queuedMessageId: record.snapshot.queuedMessages.at(-1)?.id ?? "queued-test",
              status: "queued",
              receipt: {
                clientRequestId: request.clientRequestId,
                outcome: "accepted",
                acceptedAt: "2026-04-10T10:12:00.000Z",
                stateRevision: 1,
              },
            };
          }

          promptRequests.push(normalizedRequest);
          pendingPromptSurfaces.add(request.target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            target: cloneTarget(request.target),
            pendingUserMessage: pendingUserMessage ? structuredClone(pendingUserMessage) : null,
            composerDraft: {
              text: "",
              attachments: [],
              snippetMentions: [],
              updatedAt: "2026-04-10T10:12:00.000Z",
            },
            streamMessage: null,
            streamSequence: 0,
            promptStatus: "streaming",
            activeTurnId: `turn-${promptRequests.length}`,
            activeTurnStartedAt: "2026-04-10T10:12:00.000Z",
          };
          updateSummary(request.target.workspaceSessionId, (summary) => {
            summary.status = "running";
          });
          emitSessionNavigationInvalidation();
          queueMicrotask(() => {
            emitSurfaceSync({
              reason: "background.started",
              target: cloneTarget(request.target),
              snapshot: structuredClone(record.snapshot),
            });
          });
          void (async () => {
            await Bun.sleep(0);
            const promptHandler =
              promptHandlers.get(request.target.surfacePiSessionId) ?? defaultPromptHandler;
            const result = await promptHandler(structuredClone(normalizedRequest), harness);
            const cancelled = cancelledPromptSurfaces.has(request.target.surfacePiSessionId);
            pendingPromptSurfaces.delete(request.target.surfacePiSessionId);
            if (cancelled) {
              cancelledPromptSurfaces.delete(request.target.surfacePiSessionId);
              return;
            }

            const provider = record.snapshot.provider;
            const model = record.snapshot.model;
            const nextMessages = [
              ...(record.snapshot.messages as AgentMessage[]),
              pendingUserMessage,
              ...(result.extraMessages ? structuredClone(result.extraMessages) : []),
              assistantMessage(result.assistantText, { provider, model }),
            ];

            record.snapshot = {
              ...record.snapshot,
              target: cloneTarget(request.target),
              messages: nextMessages,
              provider,
              model,
              reasoningEffort: record.snapshot.reasoningEffort,
              systemPrompt: record.snapshot.systemPrompt,
              pendingUserMessage: null,
              streamMessage: null,
              promptStatus: "idle",
              activeTurnId: null,
              activeTurnStartedAt: null,
            };

            updateSummary(request.target.workspaceSessionId, (summary) => {
              summary.preview = result.assistantText;
              summary.messageCount = nextMessages.length;
              summary.status = "idle";
              summary.isUnread = true;
              summary.unreadAt = "2026-04-10T10:12:00.000Z";
              summary.unreadReason = "assistant-turn-finished";
            });

            const surfaceSyncPayload: SurfaceSyncMessage = {
              workspaceId: TEST_WORKSPACE_INFO.workspaceId,
              reason: result.reason ?? "prompt.settled",
              target: cloneTarget(request.target),
              snapshot: structuredClone(record.snapshot),
            };
            if (result.emitSurfaceSyncBeforeStreamDone) {
              emitSurfaceSync(surfaceSyncPayload);
            } else {
              emitAssistantStream(request.target, result.assistantText, provider, model);
              emitSurfaceSync(surfaceSyncPayload);
            }
            emitSessionNavigationInvalidation();
            const [nextQueued, ...remainingQueued] = record.snapshot.queuedMessages;
            if (nextQueued) {
              record.snapshot = { ...record.snapshot, queuedMessages: remainingQueued };
              void harness.client.request.sendPrompt({
                ...request,
                text: nextQueued.text,
                clientRequestId: `${request.clientRequestId}:queued:${nextQueued.id}`,
              });
            }
          })().catch((error) => {
            pendingPromptSurfaces.delete(request.target.surfacePiSessionId);
            throw error;
          });

          return {
            target: cloneTarget(request.target),
            queuedMessageId: `queued-active-${promptRequests.length}`,
            status: "queued",
            receipt: {
              clientRequestId: request.clientRequestId,
              outcome: "accepted",
              acceptedAt: "2026-04-10T10:12:00.000Z",
              stateRevision: 1,
            },
          };
        },
        recordRendererTelemetry: async (request) => {
          rendererTelemetryRequests.push(structuredClone(request));
          return { ok: true };
        },
        editCommittedUserMessage: async ({ target, messageTimestamp, message, workspaceId }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          const messages = record.snapshot.messages as AgentMessage[];
          const editIndex = messages.findIndex(
            (candidate) =>
              candidate.role === "user" && String(candidate.timestamp) === String(messageTimestamp),
          );
          if (editIndex < 0) {
            throw new Error(
              "Unable to edit: user message was not found in the active conversation.",
            );
          }
          record.snapshot = {
            ...record.snapshot,
            messages: structuredClone(messages.slice(0, editIndex)),
          };
          return await harness.client.request.sendPrompt({
            workspaceId,
            panelId: "primary",
            target,
            ...submittedMessageFromAgentMessage(message),
            clientRequestId: "edit-committed-message",
          });
        },
        updateComposerDraft: async ({ target, draft }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            composerDraft: {
              text: draft.text,
              attachments: structuredClone(draft.attachments),
              snippetMentions: structuredClone(draft.snippetMentions ?? []),
              updatedAt:
                draft.text.trim() ||
                draft.attachments.length > 0 ||
                (draft.snippetMentions?.length ?? 0) > 0
                  ? "2026-04-10T10:12:00.000Z"
                  : null,
            },
          };
          return {
            ok: true,
            target: cloneTarget(target),
          };
        },
        deleteQueuedSurfaceMessage: async ({ target, queuedMessageId }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            queuedMessages: record.snapshot.queuedMessages.filter(
              (message) => message.id !== queuedMessageId,
            ),
          };
          queueMicrotask(() =>
            emitSurfaceSync({
              reason: "surface.updated",
              target: cloneTarget(target),
              snapshot: structuredClone(record.snapshot),
            }),
          );
          return {
            ok: true,
            target: cloneTarget(target),
            snapshot: structuredClone(record.snapshot),
          };
        },
        editQueuedSurfaceMessage: async ({ target, queuedMessageId }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          const queued = record.snapshot.queuedMessages.find(
            (message) => message.id === queuedMessageId,
          );
          record.snapshot = {
            ...record.snapshot,
            queuedMessages: record.snapshot.queuedMessages.filter(
              (message) => message.id !== queuedMessageId,
            ),
          };
          return {
            ok: true,
            text: queued?.text,
            snapshot: structuredClone(record.snapshot),
          };
        },
        reorderQueuedSurfaceMessage: async ({ target, queuedMessageId, beforeQueuedMessageId }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          const moving = record.snapshot.queuedMessages.find(
            (message) => message.id === queuedMessageId,
          );
          if (moving) {
            const remaining = record.snapshot.queuedMessages.filter(
              (message) => message.id !== queuedMessageId,
            );
            const beforeIndex = beforeQueuedMessageId
              ? remaining.findIndex((message) => message.id === beforeQueuedMessageId)
              : remaining.length;
            record.snapshot = {
              ...record.snapshot,
              queuedMessages: [
                ...remaining.slice(0, beforeIndex < 0 ? remaining.length : beforeIndex),
                moving,
                ...remaining.slice(beforeIndex < 0 ? remaining.length : beforeIndex),
              ],
            };
          }
          queueMicrotask(() =>
            emitSurfaceSync({
              reason: "surface.updated",
              target: cloneTarget(target),
              snapshot: structuredClone(record.snapshot),
            }),
          );
          return {
            ok: true,
            target: cloneTarget(target),
            snapshot: structuredClone(record.snapshot),
          };
        },
        steerQueuedSurfaceMessage: async ({ target, queuedMessageId }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            queuedMessages: record.snapshot.queuedMessages.map((message) =>
              message.id === queuedMessageId
                ? { ...message, status: "steering", updatedAt: "2026-04-10T10:13:00.000Z" }
                : message,
            ),
          };
          queueMicrotask(() =>
            emitSurfaceSync({
              reason: "surface.updated",
              target: cloneTarget(target),
              snapshot: structuredClone(record.snapshot),
            }),
          );
          return {
            ok: true,
            target: cloneTarget(target),
            snapshot: structuredClone(record.snapshot),
          };
        },
        answerRequestUserInput: async (request) => {
          requestUserInputAnswerRequests.push(structuredClone(request));
          for (const inputRequest of requestInputReadModelRequests) {
            if (inputRequest.requestId !== request.requestId) {
              continue;
            }
            inputRequest.questions = inputRequest.questions.map((question) =>
              question.questionId === request.questionId
                ? { ...question, status: "answered" }
                : question,
            );
            inputRequest.status = inputRequest.questions.every(
              (question) => question.status !== "open",
            )
              ? "completed"
              : inputRequest.status;
            inputRequest.completedAt =
              inputRequest.status === "completed"
                ? "2026-04-10T10:13:00.000Z"
                : inputRequest.completedAt;
          }
          const surfaceRecord = getSurfaceRecord(request.surfacePiSessionId);
          const target = surfaceRecord.snapshot.target;
          surfaceRecord.snapshot = {
            ...surfaceRecord.snapshot,
            queuedMessages: [
              {
                id: `queued-${++queuedMessageSequence}`,
                kind: "request_user_input_answer",
                title: "Request user input answered",
                text: JSON.stringify({
                  type: "request_user_input.answer",
                  requestId: request.requestId,
                  questionId: request.questionId,
                  delivery: request.delivery,
                }),
                status: "queued",
                createdAt: "2026-04-10T10:13:00.000Z",
                updatedAt: "2026-04-10T10:13:00.000Z",
              },
              ...surfaceRecord.snapshot.queuedMessages,
            ],
          };
          queueMicrotask(() => {
            emitSurfaceSync({
              reason: "surface.updated",
              target: cloneTarget(target),
              snapshot: structuredClone(surfaceRecord.snapshot),
            });
            emitSessionNavigationInvalidation();
          });
          return {
            requestId: request.requestId as RequestInputRequestId,
            questionId: request.questionId as RequestInputQuestionId,
            status: "recorded",
            delivery: {
              kind: "nonblocking-queued",
              queuedItemId: surfaceRecord.snapshot.queuedMessages[0]!.id as QueueItemId,
            },
          };
        },
        answerRuntimeApprovalRequest: async (request) => {
          runtimeApprovalAnswerRequests.push({
            workspaceId: request.workspaceId,
            requestId: request.requestId,
            approved: request.approved,
          });
          for (const approvalRequest of approvalsReadModelRequests) {
            if (approvalRequest.requestId !== request.requestId) {
              continue;
            }
            approvalRequest.status = request.approved ? "approved" : "denied";
            approvalRequest.completedAt = "2026-04-10T10:13:00.000Z";
          }
          emitSessionNavigationInvalidation();
          return {
            approvalId: request.requestId as RuntimeApprovalId,
            commandId: "command-approved" as CommandId,
            status: request.approved ? ("approved" as const) : ("denied" as const),
          };
        },
        setRequestUserInputTimerPaused: async (request) => {
          requestUserInputTimerRequests.push(structuredClone(request));
          for (const inputRequest of requestInputReadModelRequests) {
            if (inputRequest.requestId !== request.requestId || !inputRequest.timeout) {
              continue;
            }
            inputRequest.timeout = request.paused
              ? {
                  ...inputRequest.timeout,
                  pausedAt: "2026-04-10T10:12:30.000Z",
                  remainingMsWhenPaused: 120_000,
                  expiresAt: null,
                }
              : {
                  ...inputRequest.timeout,
                  pausedAt: null,
                  remainingMsWhenPaused: null,
                  expiresAt: "2026-04-10T10:14:30.000Z",
                };
          }
          return { requestId: request.requestId as RequestInputRequestId };
        },
        setExtensionContextAutoUpdate: async ({ target, enabled }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            promptBinding: record.snapshot.promptBinding
              ? {
                  ...record.snapshot.promptBinding,
                  updateExtensionContextBeforeNextTurn: enabled,
                }
              : undefined,
          };
          queueMicrotask(() =>
            emitSurfaceSync({
              reason: "surface.updated",
              target: cloneTarget(target),
              snapshot: structuredClone(record.snapshot),
            }),
          );
          return {
            ok: true,
            target: cloneTarget(target),
            snapshot: structuredClone(record.snapshot),
          };
        },
        setSurfaceModel: async ({ target, provider, model }) => {
          modelUpdates.push({ target: cloneTarget(target), model });
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            provider,
            model,
          };
          if (target.surface === "orchestrator") {
            updateSummary(target.workspaceSessionId, (summary) => {
              summary.provider = provider;
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
        setSurfaceExtensionUsage: async ({ target, extensionId, state }) => {
          const record = getSurfaceRecord(target.surfacePiSessionId);
          const loaded = new Set(record.snapshot.loadedExtensionIds);
          const available = new Set(record.snapshot.availableExtensionIds);
          loaded.delete(extensionId);
          available.delete(extensionId);
          if (state === "loaded") {
            loaded.add(extensionId);
          } else if (state === "available") {
            available.add(extensionId);
          }
          record.snapshot = {
            ...record.snapshot,
            loadedExtensionIds: [...loaded],
            availableExtensionIds: [...available],
          };
          queueMicrotask(() => {
            emitSurfaceSync({
              reason: "surface.updated",
              target: cloneTarget(target),
              snapshot: structuredClone(record.snapshot),
            });
          });
          return {
            ok: true,
            target: cloneTarget(target),
            snapshot: structuredClone(record.snapshot),
          };
        },
        cancelPrompt: async ({ target }) => {
          cancelRequests.push(cloneTarget(target));
          if (pendingPromptSurfaces.has(target.surfacePiSessionId)) {
            cancelledPromptSurfaces.add(target.surfacePiSessionId);
          }
          const record = getSurfaceRecord(target.surfacePiSessionId);
          record.snapshot = {
            ...record.snapshot,
            pendingUserMessage: null,
            streamMessage: null,
            promptStatus: "idle",
            activeTurnId: null,
            activeTurnStartedAt: null,
          };
          queueMicrotask(() => {
            emitSurfaceSync({
              reason: "prompt.settled",
              target: cloneTarget(target),
              snapshot: structuredClone(record.snapshot),
            });
          });
          return { ok: true };
        },
        listProviderAuths: async () => {
          requestCounts.listProviderAuths += 1;
          return [
            {
              provider: "openai",
              hasKey: true,
              keyType: "oauth",
              supportsOAuth: true,
              authHealth: "available",
              expiresAt: null,
            },
          ];
        },
        setProviderApiKey: async () => ({ ok: true }),
        startOAuth: async () => ({ ok: true }),
        removeProviderAuth: async () => ({ ok: true }),
      },
      addMessageListener: (messageName: string, listener: unknown) => {
        if (messageName === "sendArtifactOpen") {
          artifactOpenListeners.add(listener as (payload: ArtifactOpenMessage) => void);
          return;
        }
        if (messageName === "sendSurfaceSync") {
          surfaceSyncListeners.add(listener as (payload: SurfaceSyncMessage) => void);
          return;
        }
        if (messageName === "sendDesktopNotification") {
          desktopNotificationListeners.add(
            listener as (payload: DesktopRendererNotification) => void,
          );
          return;
        }
      },
      removeMessageListener: (messageName: string, listener: unknown) => {
        if (messageName === "sendArtifactOpen") {
          artifactOpenListeners.delete(listener as (payload: ArtifactOpenMessage) => void);
          return;
        }
        if (messageName === "sendSurfaceSync") {
          surfaceSyncListeners.delete(listener as (payload: SurfaceSyncMessage) => void);
          return;
        }
        if (messageName === "sendDesktopNotification") {
          desktopNotificationListeners.delete(
            listener as (payload: DesktopRendererNotification) => void,
          );
          return;
        }
      },
    },
    openedTargets,
    closeRequests,
    promptRequests,
    rendererTelemetryRequests,
    modelUpdates,
    thoughtLevelUpdates,
    cancelRequests,
    requestCounts,
    commandInspectorRequests,
    commandStdinRequests,
    handlerInspectorRequests,
    workflowTaskAttemptInspectorRequests,
    requestUserInputAnswerRequests,
    runtimeApprovalAnswerRequests,
    requestUserInputTimerRequests,
    snippetCreateRequests,
    snippetUpdateRequests,
    snippetDeleteRequests,
    snippetEnableRequests,
    openSnippetSourceRequests,
    sourceEditOpenRequests,
    sourceEditSaveRequests,
    openWorkflowsGeneratedExportRequests,
    workspaceLayoutSaveRequests,
    appLogSeenRequests,
    branchListRequests,
    branchSwitchRequests,
    setPromptHandler: (surfacePiSessionId, handler) => {
      promptHandlers.set(surfacePiSessionId, handler);
    },
    updateSummary,
    emitSessionNavigationInvalidation,
    emitArtifactOpen,
    emitSurfaceSync,
    emitAppLogUpdate,
    emitDesktopNotification: (payload) => {
      for (const listener of desktopNotificationListeners) {
        listener(structuredClone(payload));
      }
    },
    setRebaselineResult: (baseline) => {
      rebaselineResult = structuredClone(baseline);
    },
    setAppGlobalLogs: (readModel) => {
      appGlobalLogs = structuredClone(readModel);
    },
    setRequestInputReadModelRequests: (requests) => {
      requestInputReadModelRequests = structuredClone([...requests]);
    },
    setApprovalsReadModelRequests: (requests) => {
      approvalsReadModelRequests = structuredClone([...requests]);
    },
    setSnippetRows: (rows) => {
      snippetRows = structuredClone(rows);
    },
    setWorkflowsGeneratedReadModel: (readModel) => {
      workflowsGeneratedReadModel = structuredClone(readModel);
    },
    setWorkspaceLayoutSaveHandler: (handler) => {
      workspaceLayoutSaveHandler = handler;
    },
    setWorkspaceLayoutReadHandler: (handler) => {
      workspaceLayoutReadHandler = handler;
    },
    setWorkspaceActiveLayoutId: (layoutId) => {
      workspaceInfo = { ...workspaceInfo, activeLayoutId: layoutId };
    },
    setCommandInspector: (inspector) => {
      commandInspectorReadModel = structuredClone(inspector);
    },
    setHandlerInspectors: (inspectors) => {
      handlerInspectorReadModels = new Map(
        inspectors.map((inspector) => [inspector.threadId, structuredClone(inspector)]),
      );
    },
    setWorkflowTaskAttemptInspector: (inspector) => {
      workflowTaskAttemptInspectorReadModel = structuredClone(inspector);
    },
    setCommandInspectorReadHandler: (handler) => {
      commandInspectorReadHandler = handler;
    },
    setOpenSessionHandler: (sessionId, handler) => {
      if (handler) openSessionHandlers.set(sessionId, handler);
      else openSessionHandlers.delete(sessionId);
    },
    getRetainCount: (surfacePiSessionId) => surfaces.get(surfacePiSessionId)?.retainCount ?? 0,
    getSurfaceSnapshot: (surfacePiSessionId) =>
      structuredClone(getSurfaceRecord(surfacePiSessionId).snapshot),
    getRendererLayoutFixture: (workspaceId) =>
      structuredClone(rendererLayoutFixtures.get(workspaceId) ?? null),
    setRendererLayoutFixture: (workspaceId, state) => {
      rendererLayoutFixtures.set(workspaceId, structuredClone(state));
    },
  };

  return harness;
}

async function createRuntime(
  harness: FakeRpcHarness,
  storage = createMemoryStorage(),
  workspaceInfo = TEST_WORKSPACE_INFO,
  options: {
    seedInitialLayout?: boolean;
    runtimeOptions?: Omit<ChatRuntimeOptions, "workspaceInfo">;
  } = {},
) {
  if (
    options.seedInitialLayout !== false &&
    workspaceInfo.kind === "user" &&
    !harness.getRendererLayoutFixture(workspaceInfo.workspaceId)
  ) {
    const navigation = await harness.client.request.fetchStateReadModel({
      kind: "sessionNavigation",
      workspaceId: workspaceInfo.workspaceId as WorkspaceId,
    });
    const initialSession =
      navigation.kind === "sessionNavigation"
        ? [
            ...navigation.value.pinnedSessions,
            ...navigation.value.activeSessions,
            ...navigation.value.archived.sessions,
          ][0]
        : undefined;
    if (initialSession) {
      try {
        harness.getSurfaceSnapshot(initialSession.id);
        harness.setRendererLayoutFixture(
          workspaceInfo.workspaceId,
          createRendererLayoutFixtureState({
            dockview: null,
            compactSurfaces: [],
            panels: [
              {
                panelId: "primary",
                binding: createOrchestratorTarget(initialSession.id),
                localState: {
                  scroll: null,
                  timelineDensity: "comfortable",
                },
              },
            ],
            focusedPanelId: "primary",
            updatedAt: "2026-04-27T00:00:00.000Z",
          }),
        );
      } catch {
        // Tests without a surface snapshot exercise empty-layout startup.
      }
    }
  }
  const { createChatRuntime } = await import("./chat-runtime");
  return await createChatRuntime(
    { workspaceInfo, ...options.runtimeOptions },
    harness.client as never,
    storage,
  );
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
          externalContextSources: [
            {
              id: "0:/tmp/svvy/AGENTS.md",
              kind: "AGENTS.md",
              title: "AGENTS.md",
              path: "/tmp/svvy/AGENTS.md",
              content: "# Standards",
              contentHash: "abc123",
              order: 0,
              enabled: true,
              actors: ["orchestrator", "handler", "workflow-task"],
              sourceGroup: "workspace_chain",
              readStatus: { status: "readable" },
            },
          ],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController(runtime.primaryPaneId);

    expect(runtime.sessions).toHaveLength(1);
    expect(runtime.paneLayout.focusedPanelId).toBe(runtime.primaryPaneId);
    expect(runtime.getPane(runtime.primaryPaneId)?.target).toEqual(
      createOrchestratorTarget("session-1"),
    );
    expect(controller).toBeTruthy();
    expect(controller?.agent.state.systemPrompt).toBe(rawPrompt);
    expect(controller?.resolvedSystemPrompt).toContain("# Project Context");
    expect(controller?.externalContextSources).toEqual([
      expect.objectContaining({ path: "/tmp/svvy/AGENTS.md", contentHash: "abc123" }),
    ]);
    expect(controller?.agent.state.messages.at(-1)).toMatchObject({
      role: "assistant",
    });

    runtime.dispose();
  });

  it("hydrates request-user-input requests and answers them through the workspace RPC", async () => {
    const requestUserInputRequest = createRequestUserInputRequest({
      variant: "blocking",
      timeout: {
        enabled: true,
        durationMs: 300_000,
        startedAt: "2026-04-10T10:12:00.000Z",
        pausedAt: null,
        remainingMsWhenPaused: null,
        expiresAt: "2026-04-10T10:17:00.000Z",
      },
    });
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "Waiting")],
      requestUserInputRequests: [requestUserInputRequest],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("clarify"), assistantMessage("Waiting")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);

    expect(runtime.getRequestUserInputRequests()).toEqual([requestUserInputRequest]);

    await runtime.setRequestUserInputTimerPaused({
      surfacePiSessionId: "session-1",
      requestId: "rui-request-1",
      paused: true,
      clientSubmission: proxyObject({
        correlationId: "request-input-timer-proxy",
        source: "request-input-panel",
      }),
    });

    expect(harness.requestUserInputTimerRequests).toEqual([
      {
        workspaceId: TEST_WORKSPACE_INFO.workspaceId,
        surfacePiSessionId: "session-1",
        requestId: "rui-request-1",
        paused: true,
        clientSubmission: {
          correlationId: "request-input-timer-proxy",
          source: "request-input-panel",
        },
      },
    ]);
    expect(runtime.getRequestUserInputRequests()[0]?.timeout).toMatchObject({
      pausedAt: "2026-04-10T10:12:30.000Z",
      remainingMsWhenPaused: 120_000,
      expiresAt: null,
    });

    await runtime.answerRequestUserInput({
      surfacePiSessionId: "session-1",
      requestId: "rui-request-1",
      questionId: "rui-question-1",
      answer: { kind: "option", optionId: "rui-option-2" },
      delivery: "enqueue-and-run",
      clientSubmission: proxyObject({
        correlationId: "request-input-answer-proxy",
        source: "request-input-panel",
      }),
    });

    expect(harness.requestUserInputAnswerRequests).toEqual([
      {
        surfacePiSessionId: "session-1",
        requestId: "rui-request-1",
        questionId: "rui-question-1",
        answer: { kind: "option", optionId: "rui-option-2" },
        delivery: "enqueue-and-run",
        clientSubmission: {
          correlationId: "request-input-answer-proxy",
          source: "request-input-panel",
        },
        workspaceId: TEST_WORKSPACE_INFO.workspaceId,
      },
    ]);
    expect(runtime.getRequestUserInputRequests()).toEqual([
      expect.objectContaining({
        requestId: "rui-request-1",
        status: "completed",
        questions: [expect.objectContaining({ questionId: "rui-question-1", status: "answered" })],
      }),
    ]);
    expect(runtime.getPaneController(runtime.primaryPaneId)?.queuedPrompts[0]).toMatchObject({
      kind: "request_user_input_answer",
      status: "queued",
    });

    runtime.dispose();
  });

  it("hydrates runtime approval requests and answers them through the workspace RPC", async () => {
    const runtimeApprovalRequest = createRuntimeApprovalRequest();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "Waiting")],
      runtimeApprovalRequests: [runtimeApprovalRequest],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("run"), assistantMessage("Waiting")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);

    expect(runtime.getRuntimeApprovalRequests()).toEqual([runtimeApprovalRequest]);

    await runtime.answerRuntimeApprovalRequest({
      requestId: "apr-request-1",
      approved: true,
    });

    expect(harness.runtimeApprovalAnswerRequests).toEqual([
      {
        workspaceId: TEST_WORKSPACE_INFO.workspaceId,
        requestId: "apr-request-1",
        approved: true,
      },
    ]);
    expect(runtime.getRuntimeApprovalRequests()).toEqual([]);

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

    expect(runtime.paneLayout.focusedPanelId).toBe("secondary");
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
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(1);

    await runtime.closePaneSurface("secondary");

    expect(runtime.getPane("secondary")).toBeUndefined();
    expect(runtime.getPaneController("tertiary")).toBe(tertiaryController);
    expect(runtime.getSurfaceController(threadTarget.surfacePiSessionId)).toBe(tertiaryController);
    expect(harness.closeRequests).toHaveLength(0);
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(1);

    await runtime.closePaneSurface("tertiary");
    await waitFor(() => runtime.getSurfaceController(threadTarget.surfacePiSessionId) === null);

    expect(runtime.getPane("tertiary")).toBeUndefined();
    expect(harness.closeRequests).toHaveLength(1);
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(0);

    runtime.dispose();
  });

  it("shares composer draft live state across duplicate panes for one surface", async () => {
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
    if (!secondaryController || !tertiaryController) return;

    await secondaryController.updateComposerDraft({ text: "shared from left", attachments: [] });
    expect(tertiaryController.composerDraft.text).toBe("shared from left");

    await tertiaryController.updateComposerDraft({ text: "shared from right", attachments: [] });
    expect(secondaryController.composerDraft.text).toBe("shared from right");

    runtime.dispose();
  });

  it("keeps renderer draft state authoritative when stale surface snapshots arrive", async () => {
    const target = createOrchestratorTarget("session-1");
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Draft Race", "Initial")],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [userMessage("Initial"), assistantMessage("Ready")],
          composerDraft: {
            text: "old durable draft",
            attachments: [],
            updatedAt: "2026-04-10T10:00:00.000Z",
          },
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    await controller.updateComposerDraft({ text: "live renderer draft", attachments: [] });

    harness.emitSurfaceSync({
      reason: "surface.updated",
      target,
      snapshot: createSurfaceSnapshot({
        target,
        messages: [userMessage("Initial"), assistantMessage("Ready")],
        composerDraft: {
          text: "old durable draft",
          attachments: [],
          updatedAt: "2026-04-10T10:00:00.000Z",
        },
      }),
    });

    expect(controller.composerDraft.text).toBe("live renderer draft");

    runtime.dispose();
  });

  it("clears shared draft everywhere and shows the submitted user message immediately", async () => {
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
    expect(tertiaryController).toBeTruthy();
    if (!secondaryController || !tertiaryController) return;

    const activeTurn = createDeferred<PromptHandlerResult>();
    harness.setPromptHandler(threadTarget.surfacePiSessionId, () => activeTurn.promise);

    await secondaryController.updateComposerDraft({ text: "ready to send", attachments: [] });
    const sendPromise = secondaryController.sendPrompt({ text: "ready to send", attachments: [] });
    await waitFor(() => secondaryController.promptStatus === "streaming");
    await sendPromise;

    expect(secondaryController.composerDraft.text).toBe("");
    expect(tertiaryController.composerDraft.text).toBe("");
    expect(hasUserText(secondaryController.agent.state.messages, "ready to send")).toBe(true);
    expect(hasUserText(tertiaryController.agent.state.messages, "ready to send")).toBe(true);
    await Bun.sleep(160);
    expect(harness.getSurfaceSnapshot(threadTarget.surfacePiSessionId).composerDraft.text).toBe("");

    activeTurn.resolve({ assistantText: "Done" });
    await sendPromise;
    runtime.dispose();
  });

  it("releases a closed pane without disposing a streaming surface and reopens from a fresh snapshot", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const freshStreamMessage = assistantMessage("fresh worker state");
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("main"), assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [userMessage("worker")],
          streamMessage: assistantMessage("still working"),
          promptStatus: "streaming",
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");

    await runtime.closePaneSurface("secondary");

    expect(runtime.getPane("secondary")).toBeUndefined();
    expect(harness.closeRequests).toHaveLength(1);
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(0);
    expect(runtime.getSurfaceController(threadTarget.surfacePiSessionId)?.promptStatus).toBe(
      "streaming",
    );

    harness.emitSurfaceSync({
      reason: "surface.updated",
      target: threadTarget,
      snapshot: createSurfaceSnapshot({
        target: threadTarget,
        messages: [userMessage("worker")],
        streamMessage: freshStreamMessage,
        promptStatus: "streaming",
      }),
    });
    await runtime.openSurface(threadTarget, "secondary");
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(1);
    const reopenedStream = runtime.getPaneController("secondary")?.agent.state.streamMessage;
    expect(reopenedStream?.role === "assistant" ? reopenedStream.content[0] : null).toMatchObject({
      type: "text",
      text: "fresh worker state",
    });

    runtime.dispose();
  });

  it("removes the final pane instead of leaving an empty pane behind", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("main"), assistantMessage("main reply")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);

    await runtime.closePane(runtime.primaryPaneId);
    await waitFor(() => runtime.getSurfaceController("session-1") === null);

    expect(runtime.paneLayout.panels).toHaveLength(0);
    expect(runtime.paneLayout.focusedPanelId).toBeNull();
    expect(runtime.paneLayout.dockview).toBeNull();
    expect(harness.closeRequests).toHaveLength(1);

    await runtime.createSession({}, { kind: "new-panel", direction: "right" });

    expect(runtime.paneLayout.panels).toHaveLength(1);
    expect(runtime.paneLayout.panels[0]?.binding).toEqual(createOrchestratorTarget("session-2"));
    expect(runtime.paneLayout.panels.some((panel) => panel.binding === null)).toBe(false);

    runtime.dispose();
  });

  it("ignores stale pane close events for panels already removed from runtime state", async () => {
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "Orchestrator", "main reply"),
        createSummary("session-2", "Second", "second reply"),
      ],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("main"), assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-2"),
          messages: [userMessage("second"), assistantMessage("second reply")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSession("session-2", "secondary");

    expect(runtime.paneLayout.panels.map((panel) => panel.panelId)).toEqual([
      "primary",
      "secondary",
    ]);

    await runtime.closePane("primary");
    await runtime.closePane("primary");

    expect(runtime.getPane("primary")).toBeUndefined();
    expect(runtime.getPane("secondary")?.target).toEqual(createOrchestratorTarget("session-2"));
    expect(runtime.paneLayout.panels.map((panel) => panel.panelId)).toEqual(["secondary"]);
    expect(runtime.paneLayout.panels.some((panel) => panel.binding === null)).toBe(false);

    runtime.dispose();
  });

  it("deletes the final session without creating a replacement session", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Only Session", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("main"), assistantMessage("main reply")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);

    await runtime.deleteSession("session-1", runtime.primaryPaneId);

    expect(runtime.sessions).toEqual([]);
    expect(runtime.paneLayout.panels).toHaveLength(0);
    expect(runtime.paneLayout.focusedPanelId).toBeNull();
    expect(harness.client.request.fetchStateReadModel).toBeDefined();

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

    const orchestratorPrompt = orchestratorController.sendPrompt({
      text: "Continue orchestrating",
      attachments: [],
    });
    const handlerPrompt = handlerController.sendPrompt({
      text: "Continue handling",
      attachments: [],
    });

    await waitFor(
      () =>
        orchestratorController.promptStatus === "streaming" &&
        handlerController.promptStatus === "streaming",
    );

    handlerGate.resolve();
    await handlerPrompt;
    await waitFor(() => handlerController.promptStatus === "idle");

    expect(handlerController.promptStatus).toBe("idle");
    expect(orchestratorController.promptStatus).toBe("streaming");

    orchestratorGate.resolve();
    await orchestratorPrompt;
    await waitFor(() => orchestratorController.promptStatus === "idle");

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

  it("queues prompts sent to a streaming surface and dispatches them after the active turn settles", async () => {
    const session = createSummary("session-1", "Parser", "Initial");
    const target = createOrchestratorTarget(session.id);
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [userMessage("Initial"), assistantMessage("Ready")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    const activeTurn = createDeferred<PromptHandlerResult>();
    harness.setPromptHandler(target.surfacePiSessionId, () => activeTurn.promise);

    const firstPrompt = controller.sendPrompt({ text: "Run the first turn", attachments: [] });
    await waitFor(() => controller.promptStatus === "streaming");

    await controller.sendPrompt({ text: "Follow up while streaming", attachments: [] });

    expect(harness.promptRequests).toHaveLength(1);
    expect(controller.queuedPrompts.map((prompt) => prompt.text)).toEqual([
      "Follow up while streaming",
    ]);

    activeTurn.resolve({ assistantText: "First turn done" });
    await firstPrompt;
    await waitFor(() => harness.promptRequests.length >= 2);

    const queuedRequest = harness.promptRequests[1];
    expect(queuedRequest).toBeDefined();
    if (!queuedRequest) return;
    const queuedUserMessage = submittedUserMessage(queuedRequest.message);
    expect(queuedUserMessage?.content).toEqual([
      { type: "text", text: "Follow up while streaming" },
    ]);
    expect(controller.queuedPrompts).toEqual([]);

    runtime.dispose();
  });

  it("writes prompt history once when user messages enter the surface queue", async () => {
    const session = createSummary("session-1", "Parser", "Initial");
    const target = createOrchestratorTarget(session.id);
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [userMessage("Initial"), assistantMessage("Ready")],
        }),
      ],
    });
    const runtime = await createRuntime(harness, storage);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    const activeTurn = createDeferred<PromptHandlerResult>();
    harness.setPromptHandler(target.surfacePiSessionId, () => activeTurn.promise);

    const activePrompt = controller.sendPrompt({ text: "Active turn", attachments: [] });
    await waitFor(() => controller.promptStatus === "streaming");
    await controller.sendPrompt({ text: "Queued follow-up", attachments: [] });

    expect(
      (await storage.promptHistory.list(runtime.workspaceId)).map((entry) => entry.text),
    ).toEqual(["Active turn", "Queued follow-up"]);

    activeTurn.resolve({ assistantText: "First turn done" });
    await activePrompt;
    await waitFor(() => harness.promptRequests.length >= 2);

    expect(
      (await storage.promptHistory.list(runtime.workspaceId)).map((entry) => entry.text),
    ).toEqual(["Active turn", "Queued follow-up"]);

    runtime.dispose();
  });

  it("sends composer image attachments as tagged attachment metadata plus image content", async () => {
    const session = createSummary("session-1", "Vision", "Initial");
    const target = createOrchestratorTarget(session.id);
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [userMessage("Initial"), assistantMessage("Ready")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    await controller.sendPrompt({
      text: "What changed?",
      attachments: [
        {
          id: "file:docs/progress.md",
          kind: "file",
          name: "progress.md",
          path: "docs/progress.md",
          workspaceRelativePath: "docs/progress.md",
          mimeType: "text/markdown",
          sizeBytes: 1200,
        },
        {
          id: "attachment:.svvy/attachments/user-input/proof.png",
          kind: "image",
          name: "proof.png",
          path: ".svvy/attachments/user-input/proof.png",
          workspaceRelativePath: ".svvy/attachments/user-input/proof.png",
          mimeType: "image/png",
          dataBase64: "aW1hZ2U=",
        },
      ],
    });

    const request = harness.promptRequests[0];
    const user = request ? submittedUserMessage(request.message) : undefined;
    const attachmentMetadata =
      Array.isArray(user?.content) && user.content[1]?.type === "text"
        ? parseComposerAttachmentTextSignature(user.content[1].textSignature)
        : [];
    expect(user?.content).toEqual([
      { type: "text", text: "What changed?" },
      {
        type: "text",
        text: "Attached files are available at these workspace-relative paths:\n- file path: docs/progress.md (name: progress.md)\n- image path: .svvy/attachments/user-input/proof.png (name: proof.png)",
        textSignature: expect.any(String),
      },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ]);
    expect(attachmentMetadata).toEqual([
      {
        id: "file:docs/progress.md",
        kind: "file",
        name: "progress.md",
        path: "docs/progress.md",
        workspaceRelativePath: "docs/progress.md",
        mimeType: "text/markdown",
        sizeBytes: 1200,
      },
      {
        id: "attachment:.svvy/attachments/user-input/proof.png",
        kind: "image",
        name: "proof.png",
        path: ".svvy/attachments/user-input/proof.png",
        workspaceRelativePath: ".svvy/attachments/user-input/proof.png",
        mimeType: "image/png",
        sizeBytes: undefined,
      },
    ]);

    runtime.dispose();
  });

  it("sends expanded snippet text while retaining product snippet provenance metadata", async () => {
    const session = createSummary("session-1", "Snippet", "Initial");
    const target = createOrchestratorTarget(session.id);
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [userMessage("Initial"), assistantMessage("Ready")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    await controller.sendPrompt({
      text: "Please Review docs/prd.md.",
      attachments: [],
      snippetMentions: [
        {
          id: "mention-1",
          snippetId: "snippet-review",
          source: "svvy",
          title: "Review Plan",
          token: "@Review Plan",
          body: "Review $1.",
          contentHash: "fnv1a32:example",
          arguments: ["docs/prd.md"],
          metadata: { description: "Review target", argumentHint: "target" },
        },
      ],
      snippetProvenance: [
        {
          mentionId: "mention-1",
          snippetId: "snippet-review",
          source: "svvy",
          title: "Review Plan",
          contentHash: "fnv1a32:example",
          arguments: ["docs/prd.md"],
          resolvedText: "Review docs/prd.md.",
        },
      ],
    });

    const request = harness.promptRequests[0];
    const user = request ? submittedUserMessage(request.message) : undefined;
    const firstBlock = Array.isArray(user?.content) ? user.content[0] : null;

    expect(firstBlock).toEqual({
      type: "text",
      text: "Please Review docs/prd.md.",
    });
    expect(firstBlock).not.toHaveProperty("textSignature");
    expect(user).not.toHaveProperty("svvyMetadata");

    runtime.dispose();
  });

  it("serializes composer proxy state into plain backend prompt payloads", async () => {
    const session = createSummary("session-1", "Proxy", "Initial");
    const target = createOrchestratorTarget(session.id);
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [userMessage("Initial"), assistantMessage("Ready")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    const attachments = proxyArray<ComposerAttachment>([
      proxyObject({
        id: "file:docs/prd.md",
        kind: "file",
        name: "prd.md",
        path: "docs/prd.md",
        workspaceRelativePath: "docs/prd.md",
        mimeType: "text/markdown",
        sizeBytes: 42,
      }),
    ]);
    const snippetMentions = proxyArray<ComposerSnippetMention>([
      proxyObject({
        id: "mention-1",
        snippetId: "snippet-review",
        source: "svvy",
        title: "Review",
        token: "@Review",
        body: "Review $1.",
        contentHash: "fnv1a32:example",
        arguments: proxyArray(["docs/prd.md"]),
        metadata: proxyObject({ description: "Review target", argumentHint: "target" }),
      }),
    ]);
    const snippetProvenance = proxyArray<SentSnippetProvenance>([
      proxyObject({
        mentionId: "mention-1",
        snippetId: "snippet-review",
        source: "svvy",
        title: "Review",
        contentHash: "fnv1a32:example",
        arguments: proxyArray(["docs/prd.md"]),
        resolvedText: "Review docs/prd.md.",
      }),
    ]);

    await controller.sendPrompt({
      text: "Please Review docs/prd.md.",
      attachments,
      snippetMentions,
      snippetProvenance,
      clientSubmission: proxyObject({
        correlationId: "composer-submit-proxy",
        source: "composer",
      }),
    });

    const request = harness.promptRequests[0];
    const user = request ? submittedUserMessage(request.message) : undefined;
    expect(request?.panelId).toBe("primary");
    expect(request?.text).toBe("Please Review docs/prd.md.");
    expect(request?.clientRequestId).toMatch(/^desktop-submit:/);
    expect(user).not.toHaveProperty("svvyMetadata");

    runtime.dispose();
  });

  it("keeps an optimistic sent message visible when an older idle snapshot arrives", async () => {
    const session = createSummary("session-1", "Draft Race", "Initial");
    const target = createOrchestratorTarget(session.id);
    const initialMessages = [userMessage("Initial"), assistantMessage("Ready")];
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: initialMessages,
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    const activeTurn = createDeferred<PromptHandlerResult>();
    harness.setPromptHandler(target.surfacePiSessionId, () => activeTurn.promise);

    const sendPromise = controller.sendPrompt({ text: "Keep this visible", attachments: [] });
    await waitFor(() => controller.promptStatus === "streaming");
    expect(hasUserText(controller.agent.state.messages, "Keep this visible")).toBe(true);

    harness.emitSurfaceSync({
      reason: "surface.updated",
      target,
      snapshot: createSurfaceSnapshot({
        target,
        messages: initialMessages,
        promptStatus: "idle",
      }),
    });

    expect(controller.promptStatus).toBe("streaming");
    expect(hasUserText(controller.agent.state.messages, "Keep this visible")).toBe(true);

    activeTurn.resolve({ assistantText: "Done" });
    await sendPromise;
    runtime.dispose();
  });

  it("edits, deletes, promotes, and reorders queued prompts without touching the active prompt", async () => {
    const session = createSummary("session-1", "Parser", "Initial");
    const target = createOrchestratorTarget(session.id);
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [userMessage("Initial"), assistantMessage("Ready")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    const activeTurn = createDeferred<PromptHandlerResult>();
    harness.setPromptHandler(target.surfacePiSessionId, () => activeTurn.promise);

    const activePrompt = controller.sendPrompt({ text: "Active turn", attachments: [] });
    await waitFor(() => controller.promptStatus === "streaming");
    await controller.sendPrompt({ text: "First queued", attachments: [] });
    await controller.sendPrompt({ text: "Second queued", attachments: [] });
    await controller.sendPrompt({ text: "Third queued", attachments: [] });

    const [first, second, third] = controller.queuedPrompts;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    if (!first || !second || !third) return;
    const editedText = await controller.editQueuedPrompt(second.id);
    expect(editedText).toBe("Second queued");
    await controller.sendPrompt({ text: "Second queued, revised", attachments: [] });
    expect(await controller.reorderQueuedPrompt(third.id, first.id)).toBe(true);
    expect(await controller.deleteQueuedPrompt(first.id)).toBe(true);
    expect(await controller.steerQueuedPrompt(third.id)).toBe(true);

    expect(harness.promptRequests).toHaveLength(1);
    expect(controller.queuedPrompts.map((prompt) => [prompt.text, prompt.status])).toEqual([
      ["Third queued", "steering"],
      ["Second queued, revised", "queued"],
    ]);

    activeTurn.resolve({ assistantText: "Active turn done" });
    await activePrompt;

    runtime.dispose();
  });

  it("edits a committed user message by continuing from that message point", async () => {
    const session = createSummary("session-1", "Parser", "Initial");
    const target = createOrchestratorTarget(session.id);
    const firstUser = userMessage("Original request");
    firstUser.timestamp = 101;
    const firstAssistant = assistantMessage("Original reply");
    firstAssistant.timestamp = 102;
    const secondUser = userMessage("Follow-up");
    secondUser.timestamp = 103;
    const secondAssistant = assistantMessage("Follow-up reply");
    secondAssistant.timestamp = 104;
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [firstUser, firstAssistant, secondUser, secondAssistant],
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    await controller.editCommittedUserMessage(101, {
      text: "Revised request",
      attachments: [],
      snippetProvenance: [
        {
          mentionId: "mention-edit",
          snippetId: "snippet-edit",
          source: "svvy",
          title: "Edit Snippet",
          contentHash: "fnv1a32:edit",
          arguments: ["target"],
          resolvedText: "Revised request",
        },
      ],
    });

    await waitFor(() => controller.agent.state.messages.length === 2);
    const committedUserMessages = controller.agent.state.messages.filter(
      (message) => message.role === "user",
    );
    expect(
      committedUserMessages.map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
      ),
    ).toEqual(["Revised request"]);

    const [promptRequest] = harness.promptRequests;
    expect(promptRequest?.message.text).toBe("Revised request");
    expect(submittedUserMessage(promptRequest!.message)).not.toHaveProperty("svvyMetadata");

    runtime.dispose();
  });

  it("updates extension context auto-update through the surface controller", async () => {
    const session = createSummary("session-1", "Parser", "Initial");
    const target = createOrchestratorTarget(session.id);
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target,
          messages: [userMessage("Initial"), assistantMessage("Ready")],
          promptBinding: {
            currentRevision: 1,
            boundSystemPrompt: "old",
            currentSystemPrompt: "new",
            boundFingerprint: "old-fingerprint",
            currentFingerprint: "new-fingerprint",
            boundExternalSourceHashes: [],
            currentExternalSourceHashes: [],
            updateExtensionContextBeforeNextTurn: true,
            stale: true,
          },
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController("primary");
    expect(controller).not.toBeNull();
    if (!controller) return;

    expect(controller.promptBinding?.updateExtensionContextBeforeNextTurn).toBe(true);
    expect(await controller.setExtensionContextAutoUpdate(false)).toBe(true);
    expect(controller.promptBinding?.updateExtensionContextBeforeNextTurn).toBe(false);

    runtime.dispose();
  });

  it("does not duplicate the assistant reply when a settled surface snapshot arrives before stream completion", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "ready")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [],
        }),
      ],
    });
    harness.setPromptHandler("session-1", async () => ({
      assistantText: "Single settled reply.",
      emitSurfaceSyncBeforeStreamDone: true,
    }));

    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController(runtime.primaryPaneId);
    if (!controller) {
      throw new Error("Expected an orchestrator controller.");
    }

    await controller.sendPrompt({ text: "Greet me", attachments: [] });
    await waitFor(() =>
      controller.agent.state.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "Single settled reply.",
      ),
    );

    const replies = controller.agent.state.messages.filter(
      (message) =>
        message.role === "assistant" &&
        message.content[0]?.type === "text" &&
        message.content[0].text === "Single settled reply.",
    );
    expect(replies).toHaveLength(1);

    runtime.dispose();
  });

  it("keeps sidebar state live for a background prompt after its pane closes", async () => {
    const promptGate = createDeferred<void>();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Background", "ready")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [],
        }),
      ],
    });
    harness.setPromptHandler("session-1", async () => {
      await promptGate.promise;
      return { assistantText: "Finished in the background." };
    });

    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController(runtime.primaryPaneId);
    if (!controller) {
      throw new Error("Expected an orchestrator controller.");
    }

    const prompt = controller.sendPrompt({ text: "Run in the background", attachments: [] });
    await waitFor(
      () => runtime.sessions.find((session) => session.id === "session-1")?.status === "running",
    );

    await runtime.closePaneSurface(runtime.primaryPaneId);
    expect(runtime.sessions.find((session) => session.id === "session-1")?.status).toBe("running");

    promptGate.resolve();
    await prompt;
    await waitFor(
      () => runtime.sessions.find((session) => session.id === "session-1")?.isUnread === true,
    );
    expect(runtime.sessions.find((session) => session.id === "session-1")?.preview).toBe(
      "Finished in the background.",
    );

    runtime.dispose();
  });

  it("marks an open but unfocused pane unread when its assistant turn finishes", async () => {
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "Focused", "ready"),
        createSummary("session-2", "Unfocused", "ready"),
      ],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [],
        }),
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-2"),
          messages: [],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSession("session-2", {
      kind: "split",
      panelId: runtime.primaryPaneId,
      direction: "right",
    });
    const session2PaneId = runtime.paneLayout.focusedPanelId;
    if (!session2PaneId) {
      throw new Error("Expected session 2 pane to be focused after opening.");
    }
    runtime.focusPane(runtime.primaryPaneId);

    const controller = runtime.getSurfaceController("session-2");
    if (!controller) {
      throw new Error("Expected session 2 controller.");
    }

    await controller.sendPrompt({ text: "Finish while unfocused", attachments: [] });
    await waitFor(
      () => runtime.sessions.find((session) => session.id === "session-2")?.isUnread === true,
    );
    expect(runtime.sessions.find((session) => session.id === "session-2")?.unreadReason).toBe(
      "assistant-turn-finished",
    );

    runtime.dispose();
  });

  it("renders pending user and surface-owned stream state from snapshots", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const pendingUser = userMessage("Inspect the repo");
    const liveAssistant = assistantMessage("Scanning files now...");
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Streaming Handler", "worker running")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [],
          pendingUserMessage: pendingUser,
          streamMessage: liveAssistant,
          promptStatus: "streaming",
          activeTurnId: "turn-live-1",
          activeTurnStartedAt: "2026-04-10T10:12:00.000Z",
          turnTimings: [],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");
    const controller = runtime.getPaneController("secondary");
    if (!controller) {
      throw new Error("Expected a restored controller.");
    }

    expect(controller.promptStatus).toBe("streaming");
    expect(controller.activeTurnId).toBe("turn-live-1");
    expect(controller.activeTurnStartedAt).toBe("2026-04-10T10:12:00.000Z");
    expect(controller.turnTimings).toEqual([]);
    expect(
      controller.agent.state.messages.some(
        (message) =>
          message.role === "user" &&
          "content" in message &&
          Array.isArray(message.content) &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "Inspect the repo",
      ),
    ).toBe(true);
    const streamMessage = controller.agent.state.streamMessage;
    expect(streamMessage?.role).toBe("assistant");
    expect(streamMessage?.role === "assistant" ? streamMessage.content[0] : null).toMatchObject({
      type: "text",
      text: "Scanning files now...",
    });

    harness.emitSurfaceSync({
      reason: "prompt.settled",
      target: threadTarget,
      snapshot: createSurfaceSnapshot({
        target: threadTarget,
        messages: [pendingUser, liveAssistant],
        promptStatus: "idle",
        turnTimings: [
          {
            turnId: "turn-live-1",
            assistantMessageTimestamp: liveAssistant.timestamp,
            startedAt: "2026-04-10T10:12:00.000Z",
            finishedAt: "2026-04-10T10:12:42.000Z",
          },
        ],
      }),
    });

    expect(controller.agent.state.streamMessage).toBeNull();
    expect(controller.activeTurnId).toBeNull();
    expect(controller.activeTurnStartedAt).toBeNull();
    expect(controller.turnTimings).toEqual([
      {
        turnId: "turn-live-1",
        assistantMessageTimestamp: liveAssistant.timestamp,
        startedAt: "2026-04-10T10:12:00.000Z",
        finishedAt: "2026-04-10T10:12:42.000Z",
      },
    ]);
    expect(
      controller.agent.state.messages.filter(
        (message) =>
          message.role === "assistant" &&
          message.content[0]?.type === "text" &&
          message.content[0].text === "Scanning files now...",
      ),
    ).toHaveLength(1);

    runtime.dispose();
  });

  it("applies ordered stream patches without replacing the surface snapshot", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Streaming Handler", "worker running")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("Main session")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [userMessage("Inspect the repo")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");
    const controller = runtime.getPaneController("secondary");
    if (!controller) {
      throw new Error("Expected a restored controller.");
    }

    const streamMessage = assistantMessage("");
    streamMessage.content = [];
    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: { type: "start", sequence: 1, message: streamMessage },
    });
    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: { type: "text_start", sequence: 2, contentIndex: 0 },
    });
    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: {
        type: "text_delta",
        sequence: 3,
        contentIndex: 0,
        delta: "Scanning",
      },
    });
    const firstDeltaStreamMessage = controller.agent.state.streamMessage;
    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: {
        type: "text_delta",
        sequence: 4,
        contentIndex: 0,
        delta: " files",
      },
    });

    expect(controller.agent.state.messages).toHaveLength(1);
    const patchedStreamMessage = controller.agent.state.streamMessage;
    expect(patchedStreamMessage).not.toBe(firstDeltaStreamMessage);
    expect(
      patchedStreamMessage?.role === "assistant" ? patchedStreamMessage.content[0] : null,
    ).toMatchObject({
      type: "text",
      text: "Scanning files",
    });
    expect(controller.promptStatus).toBe("streaming");

    const midStreamSnapshot = createSurfaceSnapshot({
      target: threadTarget,
      messages: [userMessage("Inspect the repo")],
      streamMessage: controller.agent.state.streamMessage as AssistantMessage,
      streamSequence: 4,
      promptStatus: "streaming",
    });
    harness.emitSurfaceSync({
      reason: "surface.updated",
      target: threadTarget,
      snapshot: midStreamSnapshot,
    });
    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: {
        type: "text_delta",
        sequence: 5,
        contentIndex: 0,
        delta: " now",
      },
    });

    const continuedStreamMessage = controller.agent.state.streamMessage;
    expect(continuedStreamMessage).not.toBe(patchedStreamMessage);
    expect(
      continuedStreamMessage?.role === "assistant" ? continuedStreamMessage.content[0] : null,
    ).toMatchObject({
      type: "text",
      text: "Scanning files now",
    });

    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: { type: "clear", sequence: 6, reason: "done" },
    });

    expect(controller.agent.state.streamMessage).toBeNull();
    expect(controller.promptStatus).toBe("idle");

    runtime.dispose();
  });

  it("accepts a fresh stream sequence when dispatching after a previous stream snapshot", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const finishPrompt = createDeferred<void>();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Streaming Handler", "worker ready")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("Main ready")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("Previous turn")],
          streamSequence: 9,
        }),
      ],
    });

    harness.setPromptHandler(threadTarget.surfacePiSessionId, async () => {
      const streamMessage = assistantMessage("");
      streamMessage.content = [];
      harness.emitSurfaceSync({
        reason: "stream.patch",
        target: threadTarget,
        streamPatch: { type: "start", sequence: 1, message: streamMessage },
      });
      harness.emitSurfaceSync({
        reason: "stream.patch",
        target: threadTarget,
        streamPatch: { type: "text_start", sequence: 2, contentIndex: 0 },
      });
      harness.emitSurfaceSync({
        reason: "stream.patch",
        target: threadTarget,
        streamPatch: {
          type: "text_delta",
          sequence: 3,
          contentIndex: 0,
          delta: "Visible fresh stream",
        },
      });
      await finishPrompt.promise;
      return { assistantText: "Final fresh stream" };
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");
    const controller = runtime.getPaneController("secondary");
    if (!controller) {
      throw new Error("Expected a restored controller.");
    }

    const prompt = controller.sendPrompt({ text: "Run a fresh turn", attachments: [] });
    try {
      await waitFor(() => {
        const streamMessage = controller.agent.state.streamMessage;
        const firstBlock = streamMessage?.role === "assistant" ? streamMessage.content[0] : null;
        return firstBlock?.type === "text" && firstBlock.text === "Visible fresh stream";
      });
    } finally {
      finishPrompt.resolve();
    }
    await prompt;

    runtime.dispose();
  });

  it("accepts the stream start after a streaming snapshot without a stream message", async () => {
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Streaming Handler", "worker ready")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("Main ready")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("Previous turn")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await runtime.openSurface(threadTarget, "secondary");
    const controller = runtime.getPaneController("secondary");
    if (!controller) {
      throw new Error("Expected a restored controller.");
    }

    harness.emitSurfaceSync({
      reason: "background.started",
      target: threadTarget,
      snapshot: createSurfaceSnapshot({
        target: threadTarget,
        messages: [assistantMessage("Previous turn"), userMessage("Run another turn")],
        promptStatus: "streaming",
        streamMessage: null,
        streamSequence: 1,
      }),
    });

    const streamMessage = assistantMessage("");
    streamMessage.content = [];
    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: { type: "start", sequence: 1, message: streamMessage },
    });
    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: { type: "text_start", sequence: 2, contentIndex: 0 },
    });
    harness.emitSurfaceSync({
      reason: "stream.patch",
      target: threadTarget,
      streamPatch: {
        type: "text_delta",
        sequence: 3,
        contentIndex: 0,
        delta: "Visible stream after snapshot",
      },
    });

    const visibleStream = controller.agent.state.streamMessage;
    expect(visibleStream?.role === "assistant" ? visibleStream.content[0] : null).toMatchObject({
      type: "text",
      text: "Visible stream after snapshot",
    });

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

    const handlerPrompt = handlerController.sendPrompt({
      text: "Continue handling",
      attachments: [],
    });
    await waitFor(() => handlerController.promptStatus === "streaming");
    await handlerController.abort();
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
    const navigationFetchesBeforeInvalidation = harness.requestCounts.sessionNavigation;
    harness.emitSessionNavigationInvalidation();

    await waitFor(
      () =>
        runtime.sessions.find((session) => session.id === "session-2")?.preview ===
        "Background workflow updated.",
    );

    expect(runtime.getPane("secondary")?.target).toEqual(threadTarget);
    expect(runtime.paneLayout.focusedPanelId).toBe("secondary");
    expect(harness.requestCounts.sessionNavigation).toBe(navigationFetchesBeforeInvalidation + 1);

    runtime.dispose();
  });

  it("opens artifact inspector panes from identity-only artifact events", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    harness.emitArtifactOpen({
      workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      workspaceSessionId: "session-1" as WorkspaceSessionId,
      artifactId: "artifact-1" as never,
    });

    const focusedPaneId = runtime.paneLayout.focusedPanelId ?? runtime.primaryPaneId;
    expect(runtime.getPane(focusedPaneId)?.target).toEqual({
      workspaceSessionId: "session-1",
      surface: "artifact",
      artifactId: "artifact-1",
    });

    runtime.dispose();
  });

  it("ignores navigation invalidations and surface sync messages for other workspace ids", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    const controller = runtime.getPaneController(runtime.primaryPaneId);
    if (!controller) {
      throw new Error("Expected an orchestrator controller.");
    }

    harness.updateSummary("session-1", (summary) => {
      summary.preview = "foreign workspace update";
    });
    harness.emitSessionNavigationInvalidation("/tmp/other");
    harness.emitSurfaceSync({
      workspaceId: "/tmp/other",
      reason: "surface.updated",
      target: createOrchestratorTarget("session-1"),
      snapshot: createSurfaceSnapshot({
        target: createOrchestratorTarget("session-1"),
        messages: [assistantMessage("foreign surface update")],
      }),
    });

    expect(runtime.sessions.find((session) => session.id === "session-1")?.preview).toBe(
      "main reply",
    );
    const lastMessage = controller.agent.state.messages.at(-1);
    expect(
      lastMessage?.role === "assistant" && "content" in lastMessage ? lastMessage.content[0] : null,
    ).toMatchObject({ text: "main reply" });

    harness.emitSessionNavigationInvalidation();
    await waitFor(
      () =>
        runtime.sessions.find((session) => session.id === "session-1")?.preview ===
        "foreign workspace update",
    );

    runtime.dispose();
  });

  it("uses the focused pane session by default for inspectors", async () => {
    const commandInspector = createCommandInspector("command-77");
    const handlerThreads = [createHandlerThreadSummary("thread-77")];
    const workflowTaskAttemptInspector = createWorkflowTaskAttemptInspector(
      "workflow-task-attempt-77",
    );
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first reply"),
        {
          ...createSummary("session-2", "Second", "second reply"),
          threadIds: ["thread-77" as ThreadId],
        },
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
      workflowTaskAttemptInspector,
    });

    const runtime = await createRuntime(harness);
    await runtime.openSession("session-2", "secondary");

    const detail = await runtime.getCommandInspector("command-77");
    const threads = await runtime.listHandlerThreads();
    const workflowTaskAttemptDetail = await runtime.getWorkflowTaskAttemptInspector(
      "workflow-task-attempt-77",
    );

    expect(detail).toEqual(commandInspector);
    expect(threads).toEqual(handlerThreads);
    expect(workflowTaskAttemptDetail).toEqual(workflowTaskAttemptInspector);
    expect(harness.commandInspectorRequests).toEqual([
      { workspaceId: TEST_WORKSPACE_INFO.workspaceId, commandId: "command-77" },
    ]);
    expect(harness.handlerInspectorRequests).toEqual([
      { workspaceId: TEST_WORKSPACE_INFO.workspaceId, threadId: "thread-77" },
    ]);
    expect(harness.workflowTaskAttemptInspectorRequests).toEqual([
      {
        workspaceId: TEST_WORKSPACE_INFO.workspaceId,
        workflowTaskAttemptId: "workflow-task-attempt-77",
      },
    ]);

    runtime.dispose();
  });

  it("deduplicates state inspector reads and canonicalizes child commands to their parent", async () => {
    const commandInspector = createCommandInspector("command-parent");
    const olderThread = {
      ...createHandlerThreadSummary("thread-older"),
      updatedAt: "2026-04-10T10:01:00.000Z",
    };
    const newerThread = {
      ...createHandlerThreadSummary("thread-newer"),
      updatedAt: "2026-04-10T10:09:00.000Z",
    };
    const session = {
      ...createSummary("session-1", "First", "first reply"),
      threadIds: [
        "thread-older" as ThreadId,
        "thread-missing" as ThreadId,
        "thread-newer" as ThreadId,
      ],
    };
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [],
        }),
      ],
      commandInspector,
      handlerThreads: [olderThread, newerThread],
      workflowTaskAttemptInspector: createWorkflowTaskAttemptInspector("attempt-1"),
    });
    const runtime = await createRuntime(harness);

    const [firstCommand, secondCommand] = await Promise.all([
      runtime.getCommandInspector("command-child"),
      runtime.getCommandInspector("command-child"),
    ]);
    expect(firstCommand.commandId).toBe("command-parent");
    expect(secondCommand.commandId).toBe("command-parent");
    expect((await runtime.getCommandInspector("command-parent")).commandId).toBe("command-parent");
    expect(harness.commandInspectorRequests).toEqual([
      { workspaceId: TEST_WORKSPACE_INFO.workspaceId, commandId: "command-child" },
    ]);

    const [firstThreads, secondThreads] = await Promise.all([
      runtime.listHandlerThreads("session-1"),
      runtime.listHandlerThreads("session-1"),
    ]);
    expect(firstThreads.map((thread) => thread.threadId)).toEqual(["thread-newer", "thread-older"]);
    expect(secondThreads).toEqual(firstThreads);
    expect(runtime.getHandlerThreadsSnapshot("session-1")).toEqual(firstThreads);
    expect(harness.handlerInspectorRequests).toHaveLength(3);

    const [firstAttempt, secondAttempt] = await Promise.all([
      runtime.getWorkflowTaskAttemptInspector("attempt-1"),
      runtime.getWorkflowTaskAttemptInspector("attempt-1"),
    ]);
    expect(secondAttempt).toEqual(firstAttempt);
    expect(harness.workflowTaskAttemptInspectorRequests).toHaveLength(1);

    runtime.dispose();
  });

  it("uses session navigation membership as handler thread list authority", async () => {
    const removedThread = createHandlerThreadSummary("thread-removed");
    const addedThread = {
      ...createHandlerThreadSummary("thread-added"),
      updatedAt: "2026-04-10T10:12:00.000Z",
    };
    const harness = createFakeRpc({
      sessions: [
        {
          ...createSummary("session-1", "First", "first reply"),
          threadIds: ["thread-removed" as ThreadId],
        },
      ],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [],
        }),
      ],
      handlerThreads: [removedThread],
    });
    const runtime = await createRuntime(harness);

    expect(
      (await runtime.listHandlerThreads("session-1")).map((thread) => thread.threadId),
    ).toEqual(["thread-removed"]);
    expect(
      runtime.getHandlerThreadsSnapshot("session-1")?.map((thread) => thread.threadId),
    ).toEqual(["thread-removed"]);

    harness.setHandlerInspectors([removedThread, addedThread]);
    harness.updateSummary("session-1", (summary) => {
      summary.threadIds = ["thread-added" as ThreadId];
    });
    harness.emitSessionNavigationInvalidation();
    await waitFor(
      () =>
        runtime.sessions.find((session) => session.id === "session-1")?.threadIds?.[0] ===
        "thread-added",
    );

    expect(runtime.getHandlerThreadsSnapshot("session-1")).toBeUndefined();
    expect(
      (await runtime.listHandlerThreads("session-1")).map((thread) => thread.threadId),
    ).toEqual(["thread-added"]);
    expect(
      runtime.getHandlerThreadsSnapshot("session-1")?.map((thread) => thread.threadId),
    ).toEqual(["thread-added"]);
    expect(harness.handlerInspectorRequests.map((request) => request.threadId)).toEqual([
      "thread-removed",
      "thread-added",
    ]);

    runtime.dispose();
  });

  it("keeps a newer command notification over a stale initial fetch and wires stdin updates live", async () => {
    const staleInspector = {
      ...createCommandInspector("command-live", "exec_command"),
      summary: "stale command state",
      updatedAt: "2026-04-10T10:01:00.000Z",
    };
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "First", "first reply")],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
      ],
      commandInspector: staleInspector,
    });
    const runtime = await createRuntime(harness);
    const staleReadStarted = createDeferred();
    const releaseStaleRead = createDeferred();
    let blockFirstRead = true;
    harness.setCommandInspectorReadHandler(async () => {
      if (!blockFirstRead) return;
      blockFirstRead = false;
      staleReadStarted.resolve();
      await releaseStaleRead.promise;
    });

    const initialRead = runtime.getCommandInspector("command-live");
    await staleReadStarted.promise;
    let runtimeEmissions = 0;
    const unsubscribeRuntime = runtime.subscribe(() => {
      runtimeEmissions += 1;
    });
    const emissionsBeforeNotification = runtimeEmissions;
    const notifiedInspector = {
      ...staleInspector,
      summary: "newer notification state",
      updatedAt: "2026-04-10T10:02:00.000Z",
    };
    harness.setCommandInspector(notifiedInspector);
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        invalidation: { model: "commandInspector", ids: ["command-live" as CommandId] },
      },
    });
    await waitFor(
      () =>
        harness.commandInspectorRequests.length === 2 &&
        runtimeEmissions > emissionsBeforeNotification,
    );
    releaseStaleRead.resolve();

    expect((await initialRead).summary).toBe("newer notification state");
    expect((await runtime.getCommandInspector("command-live")).summary).toBe(
      "newer notification state",
    );

    await runtime.writeCommandStdin({ commandId: "command-live", text: "yes\n" });
    harness.setCommandInspector({
      ...notifiedInspector,
      updatedAt: "2026-04-10T10:03:00.000Z",
      stdin: {
        mode: "continuable",
        canAttemptWrite: true,
        acceptedWrites: [
          {
            eventId: "stdin-event-1",
            text: "yes\n",
            acceptedBytes: 4 as never,
            at: "2026-04-10T10:03:00.000Z",
          },
        ],
      },
    });
    const emissionsBeforeStdinInvalidation = runtimeEmissions;
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 2 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        invalidation: { model: "commandInspector", ids: ["command-live" as CommandId] },
      },
    });
    await waitFor(
      () =>
        harness.commandInspectorRequests.length === 3 &&
        runtimeEmissions > emissionsBeforeStdinInvalidation,
    );
    expect((await runtime.getCommandInspector("command-live")).stdin.acceptedWrites).toEqual([
      {
        eventId: "stdin-event-1",
        text: "yes\n",
        acceptedBytes: 4,
        at: "2026-04-10T10:03:00.000Z",
      },
    ]);

    unsubscribeRuntime();
    runtime.dispose();
  });

  it("applies live handler and workflow-attempt inspector invalidations", async () => {
    const session = {
      ...createSummary("session-1", "First", "first reply"),
      threadIds: ["thread-live" as ThreadId],
    };
    const initialThread = createHandlerThreadSummary("thread-live");
    const initialAttempt = createWorkflowTaskAttemptInspector("attempt-live");
    const harness = createFakeRpc({
      sessions: [session],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
      ],
      handlerThreads: [initialThread],
      workflowTaskAttemptInspector: initialAttempt,
    });
    const runtime = await createRuntime(harness);
    await runtime.listHandlerThreads("session-1");
    await runtime.getWorkflowTaskAttemptInspector("attempt-live");
    let runtimeEmissions = 0;
    const unsubscribeRuntime = runtime.subscribe(() => {
      runtimeEmissions += 1;
    });
    const emissionsBeforeInvalidations = runtimeEmissions;

    harness.setHandlerInspectors([
      {
        ...initialThread,
        objective: "Updated handler objective",
        updatedAt: "2026-04-10T10:10:00.000Z",
      },
    ]);
    harness.setWorkflowTaskAttemptInspector({
      ...initialAttempt,
      summary: "Updated task-attempt summary",
      updatedAt: "2026-04-10T10:10:00.000Z",
    });
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        invalidation: { model: "handlerThreadInspector", ids: ["thread-live" as ThreadId] },
      },
    });
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 2 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        invalidation: {
          model: "workflowTaskAttemptInspector",
          ids: ["attempt-live" as WorkflowTaskAttemptId],
        },
      },
    });
    await waitFor(
      () =>
        harness.handlerInspectorRequests.length === 2 &&
        harness.workflowTaskAttemptInspectorRequests.length === 2 &&
        runtimeEmissions >= emissionsBeforeInvalidations + 2 &&
        runtime.getHandlerThreadsSnapshot("session-1")?.[0]?.objective ===
          "Updated handler objective",
    );

    expect(runtime.getHandlerThreadsSnapshot("session-1")?.[0]?.objective).toBe(
      "Updated handler objective",
    );
    expect((await runtime.getWorkflowTaskAttemptInspector("attempt-live")).summary).toBe(
      "Updated task-attempt summary",
    );

    unsubscribeRuntime();
    runtime.dispose();
  });

  it("writes command stdin through the workspace runtime bridge", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "First", "first reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [userMessage("first"), assistantMessage("first reply")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);

    const result = await runtime.writeCommandStdin({
      commandId: "command-77",
      text: "yes\n",
      clientSubmission: {
        source: "command_inspector",
        clientRequestId: "stdin-submit-1",
      },
    });

    expect(result).toEqual({
      commandId: "command-77",
      status: "accepted",
      acceptedBytes: 4,
    });
    expect(harness.commandStdinRequests).toEqual([
      {
        workspaceId: TEST_WORKSPACE_INFO.workspaceId,
        commandId: "command-77",
        text: "yes\n",
        clientSubmission: {
          source: "command_inspector",
          clientRequestId: "stdin-submit-1",
        },
      },
    ]);

    runtime.dispose();
  });

  it("opens workspace paths through the runtime without adding agent context metadata", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "First", "first reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("first reply")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);

    await expect(runtime.openWorkspacePath("docs/progress.md")).resolves.toBe(true);
    await expect(runtime.openWorkspacePath("missing/file.ts")).resolves.toBe(false);

    runtime.dispose();
  });

  it("lists and switches workspace branches through workspace-scoped runtime RPC", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "First", "first reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("first reply")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);

    await expect(runtime.listWorkspaceBranches()).resolves.toEqual([
      { name: "main", current: true },
      { name: "feature/sidebar", current: false },
    ]);
    await runtime.switchWorkspaceBranch("feature/sidebar");

    expect(runtime.branch).toBe("feature/sidebar");
    expect(harness.branchListRequests).toEqual([TEST_WORKSPACE_INFO.workspaceId]);
    expect(harness.branchSwitchRequests).toEqual([
      { workspaceId: TEST_WORKSPACE_INFO.workspaceId, branch: "feature/sidebar" },
    ]);
    await expect(runtime.switchWorkspaceBranch("missing")).rejects.toThrow(
      "Branch is not available in this workspace.",
    );

    runtime.dispose();
  });

  it("applies pinned, archived, and archived-group navigation mutations from the backend read model", async () => {
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first reply"),
        createSummary("session-2", "Second", "second reply"),
      ],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("first reply")],
        }),
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-2"),
          messages: [assistantMessage("second reply")],
        }),
      ],
    });

    const runtime = await createRuntime(harness);
    await waitFor(() => harness.requestCounts.sessionNavigation >= 3);
    const runAcceptedMutation = async (mutation: () => Promise<void>): Promise<void> => {
      const before = harness.requestCounts.sessionNavigation;
      await mutation();
      expect(harness.requestCounts.sessionNavigation).toBe(before + 1);
    };
    await runAcceptedMutation(() => runtime.pinSession("session-2"));
    await runAcceptedMutation(() => runtime.pinSession("session-2"));

    expect(runtime.sessionNavigation.pinnedSessions.map((session) => session.id)).toEqual([
      "session-2",
    ]);
    expect(runtime.sessionNavigation.activeSessions.map((session) => session.id)).toEqual([
      "session-1",
    ]);

    await runAcceptedMutation(() => runtime.unpinSession("session-2"));
    expect(runtime.sessionNavigation.activeSessions.map((session) => session.id)).toContain(
      "session-2",
    );
    await runAcceptedMutation(() => runtime.pinSession("session-2"));
    await runAcceptedMutation(() => runtime.archiveSession("session-2"));
    await runAcceptedMutation(() => runtime.archiveSession("session-2"));
    await runAcceptedMutation(() =>
      runtime.setSessionNavigationSectionState("archived", { collapsed: false }),
    );

    expect(runtime.sessionNavigation.pinnedSessions).toEqual([]);
    expect(runtime.sessionNavigation.archived.collapsed).toBe(false);
    expect(runtime.sessionNavigation.archived.sessions.map((session) => session.id)).toEqual([
      "session-2",
    ]);

    await runAcceptedMutation(() => runtime.unarchiveSession("session-2"));
    expect(runtime.sessionNavigation.activeSessions.map((session) => session.id)).toContain(
      "session-2",
    );
    expect(runtime.sessions.find((session) => session.id === "session-2")?.isPinned).toBe(false);

    await runAcceptedMutation(() => runtime.markSessionUnread("session-2"));
    expect(runtime.sessions.find((session) => session.id === "session-2")?.isUnread).toBe(true);
    expect(runtime.sessions.find((session) => session.id === "session-2")?.unreadReason).toBe(
      "manual",
    );

    await runAcceptedMutation(() => runtime.markSessionRead("session-2"));
    expect(runtime.sessions.find((session) => session.id === "session-2")?.isUnread).toBe(false);
    expect(runtime.sessions.find((session) => session.id === "session-2")?.unreadReason).toBeNull();

    runtime.dispose();
  });

  it("restores pane bindings and focused pane after restart", async () => {
    const storage = createMemoryStorage();
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const firstHarness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("worker ready")],
        }),
      ],
    });
    const firstRuntime = await createRuntime(firstHarness, storage);
    await firstRuntime.openSurface(threadTarget, "secondary");
    await Bun.sleep(0);
    firstRuntime.dispose();

    const restoreState = firstHarness.getRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId);
    expect(restoreState?.layouts.A?.focusedPanelId).toBe("secondary");
    expect(restoreState?.layouts.A?.panels).toContainEqual(
      expect.objectContaining({
        panelId: "secondary",
        binding: threadTarget,
      }),
    );

    const secondHarness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("worker ready")],
        }),
      ],
    });
    secondHarness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, restoreState!);
    const secondRuntime = await createRuntime(secondHarness, storage);

    expect(secondRuntime.paneLayout.focusedPanelId).toBe("secondary");
    expect(secondRuntime.getPane("secondary")?.target).toEqual(threadTarget);

    secondRuntime.dispose();
  });

  it("restores multiple pane-bound surfaces with one controller per interactive surface", async () => {
    const storage = createMemoryStorage();
    const orchestratorTarget = createOrchestratorTarget("session-1");
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const workflowsTarget = {
      surface: "workflows" as const,
    };
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: orchestratorTarget,
          messages: [assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("worker ready")],
        }),
      ],
    });
    harness.setRendererLayoutFixture(
      TEST_WORKSPACE_INFO.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: orchestratorTarget,
            localState: {
              scroll: { transcriptAnchorId: "assistant-1", offsetPx: 12 },
              timelineDensity: "comfortable",
            },
          },
          {
            panelId: "thread-left",
            binding: threadTarget,
            localState: {
              scroll: null,
              timelineDensity: "compact",
            },
          },
          {
            panelId: "thread-right",
            binding: threadTarget,
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
          {
            panelId: "inspector",
            binding: workflowsTarget,
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
        ],
        focusedPanelId: "thread-right",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage);

    expect(runtime.paneLayout.focusedPanelId).toBe("thread-right");
    expect(runtime.getPane("primary")?.target).toEqual(orchestratorTarget);
    expect(runtime.getPane("thread-left")?.target).toEqual(threadTarget);
    expect(runtime.getPane("thread-right")?.target).toEqual(threadTarget);
    expect(runtime.getPane("inspector")?.target).toEqual(workflowsTarget);

    const threadController = runtime.getSurfaceController(threadTarget.surfacePiSessionId);
    expect(threadController?.ownerPaneIds.toSorted()).toEqual(["thread-left", "thread-right"]);
    expect(runtime.getPaneController("thread-left")).toBe(threadController);
    expect(runtime.getPaneController("thread-right")).toBe(threadController);
    expect(runtime.getPaneController("inspector")).toBeNull();
    expect(harness.getRetainCount(threadTarget.surfacePiSessionId)).toBe(1);
    expect(
      harness.openedTargets.filter(
        (target) => target.surfacePiSessionId === threadTarget.surfacePiSessionId,
      ),
    ).toHaveLength(1);

    runtime.dispose();
  });

  it("restores mixed Dockview JSON, focus, panel-local state, static panes, and floating interactive panes", async () => {
    const storage = createMemoryStorage();
    const orchestratorTarget = createOrchestratorTarget("session-1");
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const dockview = {
      grid: {
        root: {
          type: "branch",
          data: [
            { type: "leaf", data: { views: ["primary"] } },
            { type: "leaf", data: { views: ["settings"] } },
          ],
        },
      },
      panels: {
        primary: {},
        settings: {},
        "thread-float": {},
        "logs-edge": {},
        "artifact-popout": {},
      },
      activeGroup: "main-group",
      floatingGroups: [{ data: { id: "floating-group", views: ["thread-float"] } }],
      popoutGroups: [
        {
          data: { id: "popout-group", views: ["artifact-popout"] },
          position: { left: 40, top: 60, width: 720, height: 520 },
        },
      ],
      edgeGroups: {
        left: {
          size: 280,
          group: { id: "edge-group", views: ["logs-edge"] },
        },
      },
    } as unknown as WorkspaceDockviewLayoutState["dockview"];
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: orchestratorTarget,
          messages: [assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("worker ready")],
        }),
      ],
    });
    harness.setRendererLayoutFixture(
      TEST_WORKSPACE_INFO.workspaceId,
      createRendererLayoutFixtureState({
        dockview,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: orchestratorTarget,
            localState: {
              scroll: { transcriptAnchorId: "assistant-main", offsetPx: 33 },
              timelineDensity: "compact",
            },
          },
          {
            panelId: "settings",
            binding: { surface: "settings" },
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
          {
            panelId: "thread-float",
            binding: threadTarget,
            localState: {
              scroll: { transcriptAnchorId: "assistant-thread", offsetPx: 12 },
              timelineDensity: "comfortable",
            },
            placement: {
              kind: "floating",
              box: { x: 20, y: 30, width: 640, height: 480 },
            },
          },
          {
            panelId: "logs-edge",
            binding: { surface: "app-logs" },
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
            placement: { kind: "edge", direction: "left", size: 280 },
          },
          {
            panelId: "artifact-popout",
            binding: {
              workspaceSessionId: "session-1",
              surface: "artifact",
              artifactId: "artifact-1",
            },
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
            placement: {
              kind: "popout",
              box: { left: 40, top: 60, width: 720, height: 520 },
            },
          },
        ],
        focusedPanelId: "thread-float",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage);

    expect(runtime.paneLayout.dockview).toEqual(dockview);
    expect(runtime.paneLayout.focusedPanelId).toBe("thread-float");
    expect(runtime.getPane("primary")).toMatchObject({
      target: orchestratorTarget,
      scroll: { transcriptAnchorId: "assistant-main", offsetPx: 33 },
      timelineDensity: "compact",
    });
    expect(runtime.getPane("settings")?.target).toEqual({ surface: "settings" });
    expect(runtime.getPane("thread-float")).toMatchObject({
      target: threadTarget,
      scroll: { transcriptAnchorId: "assistant-thread", offsetPx: 12 },
    });
    expect(runtime.getPaneController("thread-float")).toBe(
      runtime.getSurfaceController(threadTarget.surfacePiSessionId),
    );
    expect(runtime.paneLayout.panels.map((panel) => [panel.panelId, panel.placement])).toEqual([
      ["primary", null],
      ["settings", null],
      ["thread-float", { kind: "floating", box: { x: 20, y: 30, width: 640, height: 480 } }],
      ["logs-edge", { kind: "edge", direction: "left", size: 280 }],
      ["artifact-popout", { kind: "popout", box: { left: 40, top: 60, width: 720, height: 520 } }],
    ]);

    runtime.dispose();
  });

  it("restores prompt lock state from opened surface snapshots", async () => {
    const storage = createMemoryStorage();
    const threadTarget = createThreadTarget("session-1", "thread-session-1", "thread-123");
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Waiting Session", "worker waiting")],
      surfaces: [
        createSurfaceSnapshot({
          target: threadTarget,
          messages: [assistantMessage("still running")],
          promptStatus: "streaming",
        }),
      ],
    });
    harness.setRendererLayoutFixture(
      TEST_WORKSPACE_INFO.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: threadTarget,
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
        ],
        focusedPanelId: "primary",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage);

    expect(runtime.getPaneController("primary")?.promptStatus).toBe("streaming");
    expect(runtime.getSurfaceController(threadTarget.surfacePiSessionId)?.promptStatus).toBe(
      "streaming",
    );

    runtime.dispose();
  });

  it("drops restored empty panes and focuses a restorable bound pane", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    harness.setRendererLayoutFixture(
      TEST_WORKSPACE_INFO.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: null,
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
          {
            panelId: "secondary",
            binding: createOrchestratorTarget("session-1"),
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
        ],
        focusedPanelId: "primary",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage);

    expect(runtime.paneLayout.panels).toHaveLength(1);
    expect(runtime.paneLayout.focusedPanelId).toBe("secondary");
    expect(runtime.getPane("primary")).toBeUndefined();
    expect(runtime.getPane("secondary")?.target).toEqual(createOrchestratorTarget("session-1"));

    runtime.dispose();
  });

  it("switches between fixed A/B/C layout slots and keeps empty slots selectable", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });

    const runtime = await createRuntime(harness, storage);

    expect(runtime.activeLayoutId).toBe("A");
    expect(runtime.layoutSlots).toEqual([
      expect.objectContaining({ id: "A", active: true, initialized: true }),
      expect.objectContaining({ id: "B", active: false, initialized: false }),
      expect.objectContaining({ id: "C", active: false, initialized: false }),
    ]);

    await runtime.switchWorkspaceLayout("B");
    expect(runtime.activeLayoutId).toBe("B");
    expect(runtime.paneLayout.panels).toHaveLength(0);
    expect(runtime.getPane("primary")).toBeUndefined();
    expect(runtime.layoutSlots).toEqual([
      expect.objectContaining({ id: "A", active: false, initialized: true }),
      expect.objectContaining({ id: "B", active: true, initialized: false }),
      expect.objectContaining({ id: "C", active: false, initialized: false }),
    ]);

    await runtime.openSession("session-1", runtime.primaryPaneId);
    expect(runtime.getPane("primary")?.target).toEqual(createOrchestratorTarget("session-1"));
    expect(runtime.layoutSlots.find((slot) => slot.id === "B")?.initialized).toBe(true);

    await runtime.switchWorkspaceLayout("A");
    expect(runtime.activeLayoutId).toBe("A");
    expect(runtime.getPane("primary")?.target).toEqual(createOrchestratorTarget("session-1"));

    const restoreState = harness.getRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId);
    expect(restoreState?.layouts.A?.panels[0]?.binding).toEqual(
      createOrchestratorTarget("session-1"),
    );
    expect(restoreState?.layouts.B?.panels[0]?.binding).toEqual(
      createOrchestratorTarget("session-1"),
    );
    expect(restoreState?.layouts.C).toBeNull();

    runtime.dispose();
  });

  it("serializes and coalesces rapid saves without allowing an older acknowledgement to win", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
      ],
    });
    const runtime = await createRuntime(harness);
    const firstSave = createDeferred();
    harness.setWorkspaceLayoutSaveHandler(async () => {
      if (harness.workspaceLayoutSaveRequests.length === 1) await firstSave.promise;
    });

    runtime.setPaneScroll("primary", { transcriptAnchorId: "first", offsetPx: 1 });
    await waitFor(() => harness.workspaceLayoutSaveRequests.length === 1);
    runtime.setPaneScroll("primary", { transcriptAnchorId: "second", offsetPx: 2 });
    runtime.setPaneScroll("primary", { transcriptAnchorId: "latest", offsetPx: 3 });
    expect(harness.workspaceLayoutSaveRequests).toHaveLength(1);

    firstSave.resolve();
    await waitFor(() => harness.workspaceLayoutSaveRequests.length === 2);
    expect(harness.workspaceLayoutSaveRequests[1]?.panes[0]?.localState.scroll).toEqual({
      transcriptAnchorId: "latest",
      offsetPx: 3,
    });
    await waitFor(
      () =>
        harness.getRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId)?.layouts.A?.panels[0]
          ?.localState.scroll?.transcriptAnchorId === "latest",
    );
    expect(runtime.getPane("primary")?.scroll?.transcriptAnchorId).toBe("latest");

    runtime.dispose();
  });

  it("drains the latest captured save after renderer disposal", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
      ],
    });
    const runtime = await createRuntime(harness);
    const firstSave = createDeferred();
    harness.setWorkspaceLayoutSaveHandler(async () => {
      if (harness.workspaceLayoutSaveRequests.length === 1) await firstSave.promise;
    });

    runtime.setPaneScroll("primary", { transcriptAnchorId: "first", offsetPx: 1 });
    await waitFor(() => harness.workspaceLayoutSaveRequests.length === 1);
    runtime.setPaneScroll("primary", { transcriptAnchorId: "final", offsetPx: 4 });
    runtime.dispose();
    firstSave.resolve();

    await waitFor(() => harness.workspaceLayoutSaveRequests.length === 2);
    await waitFor(
      () =>
        harness.getRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId)?.layouts.A?.panels[0]
          ?.localState.scroll?.transcriptAnchorId === "final",
    );
  });

  it("rolls a failed final save back to authoritative state after one idempotent retry", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
      ],
    });
    const runtime = await createRuntime(harness);
    harness.setWorkspaceLayoutSaveHandler(async () => {
      throw new Error("save failed");
    });

    runtime.setPaneScroll("primary", { transcriptAnchorId: "unsaved", offsetPx: 9 });
    await waitFor(() => harness.workspaceLayoutSaveRequests.length === 2);
    await waitFor(() => runtime.getPane("primary")?.scroll === null);
    expect(harness.workspaceLayoutSaveRequests[0]?.clientSubmission?.clientRequestId).toBe(
      harness.workspaceLayoutSaveRequests[1]?.clientSubmission?.clientRequestId,
    );

    runtime.dispose();
  });

  it("does not resolve a pane retarget before its layout generation is committed", async () => {
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
      ],
    });
    const runtime = await createRuntime(harness);
    const saveCommitted = createDeferred();
    harness.setWorkspaceLayoutSaveHandler(async () => {
      await saveCommitted.promise;
    });

    const retargetAndPrompt = runtime
      .openSession("session-2", "primary")
      .then(() => runtime.sendPromptToTarget(createOrchestratorTarget("session-2"), "after bind"));
    await waitFor(() => harness.workspaceLayoutSaveRequests.length === 1);

    expect(harness.workspaceLayoutSaveRequests[0]?.panes[0]?.target).toEqual(
      createOrchestratorTarget("session-2") as never,
    );
    expect(harness.promptRequests).toHaveLength(0);

    saveCommitted.resolve();
    await retargetAndPrompt;
    expect(harness.promptRequests).toHaveLength(1);
    expect(harness.promptRequests[0]?.target).toEqual(createOrchestratorTarget("session-2"));

    runtime.dispose();
  });

  it("blocks an immediately visible prompt controller on its pane-binding save", async () => {
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
      ],
    });
    const runtime = await createRuntime(harness);
    const saveCommitted = createDeferred();
    harness.setWorkspaceLayoutSaveHandler(async () => {
      await saveCommitted.promise;
    });

    const openPromise = runtime.openSession("session-2", "primary");
    await waitFor(
      () =>
        runtime.getPaneController("primary")?.target.surfacePiSessionId === "session-2" &&
        harness.workspaceLayoutSaveRequests.length === 1,
    );
    const controller = runtime.getPaneController("primary");
    expect(controller).toBeTruthy();
    const sendPromise = controller!.sendPrompt(
      { text: "send only after binding", attachments: [] },
      "primary",
    );

    await Bun.sleep(0);
    expect(harness.promptRequests).toHaveLength(0);

    saveCommitted.resolve();
    await Promise.all([openPromise, sendPromise]);
    expect(harness.promptRequests).toHaveLength(1);
    expect(harness.promptRequests[0]?.target).toEqual(createOrchestratorTarget("session-2"));

    runtime.dispose();
  });

  it("propagates a failed pane-binding save to an already waiting prompt", async () => {
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
      ],
    });
    const runtime = await createRuntime(harness);
    const firstSaveAttempt = createDeferred();
    harness.setWorkspaceLayoutSaveHandler(async () => {
      if (harness.workspaceLayoutSaveRequests.length === 1) {
        await firstSaveAttempt.promise;
      }
      throw new Error("binding persistence failed");
    });

    const openPromise = runtime.openSession("session-2", "primary");
    await waitFor(
      () =>
        runtime.getPaneController("primary")?.target.surfacePiSessionId === "session-2" &&
        harness.workspaceLayoutSaveRequests.length === 1,
    );
    const sendPromise = runtime
      .getPaneController("primary")!
      .sendPrompt({ text: "must not escape failed binding", attachments: [] }, "primary");
    firstSaveAttempt.resolve();

    const [openResult, sendResult] = await Promise.allSettled([openPromise, sendPromise]);
    expect(openResult.status).toBe("rejected");
    expect(sendResult.status).toBe("rejected");
    if (sendResult.status === "rejected") {
      expect(String(sendResult.reason)).toContain("binding persistence failed");
    }
    expect(harness.promptRequests).toHaveLength(0);

    runtime.dispose();
  });

  it("waits for app chrome mutations and rechecks the prompt pane before dispatch", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "First", "first")],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
      ],
    });
    const chromeCommitted = createDeferred();
    const runtime = await createRuntime(harness, createMemoryStorage(), TEST_WORKSPACE_INFO, {
      runtimeOptions: {
        awaitWorkspaceChromeMutations: () => chromeCommitted.promise,
      },
    });
    const controller = runtime.getPaneController("primary");
    expect(controller).toBeTruthy();

    const sendPromise = controller!.sendPrompt(
      { text: "do not retarget this", attachments: [] },
      "primary",
    );
    await Bun.sleep(0);
    expect(harness.promptRequests).toHaveLength(0);

    await runtime.openSurface({ surface: "app-logs" }, "primary");
    chromeCommitted.resolve();
    await expect(sendPromise).rejects.toThrow("remain attached");
    expect(harness.promptRequests).toHaveLength(0);

    runtime.dispose();
  });

  it("saves detached compact-surface pane references as null when closing their pane", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "First", "first")],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: {
          dockview: null,
          panels: [
            {
              panelId: "primary",
              binding: createOrchestratorTarget("session-1"),
              localState: { scroll: null, timelineDensity: "comfortable" },
            },
          ],
          compactSurfaces: [
            {
              kind: "compact-thread",
              workspaceSessionId: "session-1",
              threadId: "thread-1",
              panelId: "primary",
              density: "compact",
            },
          ],
          focusedPanelId: "primary",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        B: null,
        C: null,
      },
    });
    const runtime = await createRuntime(harness);

    expect(runtime.paneLayout.compactSurfaces[0]?.panelId).toBe("primary");

    await runtime.closePane("primary");

    expect(harness.workspaceLayoutSaveRequests[0]?.compactSurfaces[0]?.panelId).toBeNull();
    expect(runtime.paneLayout.compactSurfaces[0]?.panelId).toBeNull();

    expect(harness.workspaceLayoutSaveRequests.at(-1)?.compactSurfaces).toEqual([
      {
        kind: "compact-thread",
        workspaceSessionId: "session-1",
        threadId: "thread-1",
        panelId: null,
        density: "compact",
      },
    ] as never);

    runtime.dispose();
  });

  it("refetches and rolls back a rejected layout selection", async () => {
    const layout = (sessionId: string, panelId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      panels: [
        {
          panelId,
          binding: createOrchestratorTarget(sessionId),
          localState: { scroll: null, timelineDensity: "comfortable" },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: panelId,
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a"),
        B: layout("session-2", "slot-b"),
        C: null,
      },
    });
    const runtime = await createRuntime(harness, createMemoryStorage(), TEST_WORKSPACE_INFO, {
      runtimeOptions: {
        workspaceTabId: TEST_WORKSPACE_INFO.workspaceTabId,
        initialLayoutId: "A",
        selectWorkspaceLayoutSlot: async () => {
          throw new Error("selection rejected");
        },
      },
    });

    await expect(runtime.switchWorkspaceLayout("B")).rejects.toThrow("selection rejected");

    expect(runtime.activeLayoutId).toBe("A");
    expect(runtime.getPane("slot-a")?.target).toEqual(createOrchestratorTarget("session-1"));
    expect(runtime.getPane("slot-b")).toBeUndefined();

    runtime.dispose();
  });

  it("refreshes an incoming slot before hydration without saving its stale cached copy", async () => {
    const layout = (sessionId: string, panelId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      panels: [
        {
          panelId,
          binding: createOrchestratorTarget(sessionId),
          localState: { scroll: null, timelineDensity: "comfortable" },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: panelId,
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Cached", "cached"),
        createSummary("session-3", "Authoritative", "authoritative"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-3"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a"),
        B: layout("session-2", "slot-b-cached"),
        C: null,
      },
    });
    const runtime = await createRuntime(harness);
    harness.workspaceLayoutSaveRequests.length = 0;
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a"),
        B: layout("session-3", "slot-b-authoritative"),
        C: null,
      },
    });

    await runtime.switchWorkspaceLayout("B");

    expect(runtime.getPane("slot-b-authoritative")?.target).toEqual(
      createOrchestratorTarget("session-3"),
    );
    expect(runtime.getPane("slot-b-cached")).toBeUndefined();
    expect(harness.workspaceLayoutSaveRequests.map((request) => request.layoutId)).toEqual(["A"]);

    runtime.dispose();
  });

  it("lets a newer layout notification win over an older in-flight slot refresh", async () => {
    const layout = (sessionId: string, panelId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      panels: [
        {
          panelId,
          binding: createOrchestratorTarget(sessionId),
          localState: { scroll: null, timelineDensity: "comfortable" },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: panelId,
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Stale", "stale"),
        createSummary("session-3", "Newer", "newer"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-3"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a"),
        B: layout("session-2", "slot-b-stale"),
        C: null,
      },
    });
    const runtime = await createRuntime(harness, createMemoryStorage(), TEST_WORKSPACE_INFO, {
      runtimeOptions: {
        workspaceTabId: TEST_WORKSPACE_INFO.workspaceTabId,
      },
    });
    const staleReadStarted = createDeferred();
    const releaseStaleRead = createDeferred();
    let blockNextLayoutRead = true;
    harness.setWorkspaceLayoutReadHandler(async () => {
      if (!blockNextLayoutRead) return;
      blockNextLayoutRead = false;
      staleReadStarted.resolve();
      await releaseStaleRead.promise;
    });
    harness.setWorkspaceActiveLayoutId("B");

    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: { kind: "app" },
      invalidation: { scope: "app", invalidation: { model: "workspaceChrome" } },
    });
    await staleReadStarted.promise;

    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a"),
        B: layout("session-3", "slot-b-newer"),
        C: null,
      },
    });
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 2 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        invalidation: { model: "workspaceLayout", ids: ["B"] },
      },
    });
    releaseStaleRead.resolve();

    await waitFor(
      () =>
        runtime.activeLayoutId === "B" &&
        runtime.getPane("slot-b-newer")?.target?.surface === "orchestrator",
    );
    expect(runtime.getPane("slot-b-newer")?.target).toEqual(createOrchestratorTarget("session-3"));
    expect(runtime.getPane("slot-b-stale")).toBeUndefined();

    runtime.dispose();
  });

  it("waits for an active layout transition before dispatching from its hydrated pane", async () => {
    const layout = (sessionId: string, panelId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      panels: [
        {
          panelId,
          binding: createOrchestratorTarget(sessionId),
          localState: { scroll: null, timelineDensity: "comfortable" },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: panelId,
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a"),
        B: layout("session-2", "slot-b"),
        C: null,
      },
    });
    const selectionCommitted = createDeferred();
    const runtime = await createRuntime(harness, createMemoryStorage(), TEST_WORKSPACE_INFO, {
      runtimeOptions: {
        selectWorkspaceLayoutSlot: () => selectionCommitted.promise,
      },
    });

    const switchPromise = runtime.switchWorkspaceLayout("B");
    await waitFor(() => runtime.getPaneController("slot-b") !== null);
    const sendPromise = runtime
      .getPaneController("slot-b")!
      .sendPrompt({ text: "after layout selection", attachments: [] }, "slot-b");
    await Bun.sleep(0);
    expect(harness.promptRequests).toHaveLength(0);

    selectionCommitted.resolve();
    await Promise.all([switchPromise, sendPromise]);
    expect(harness.promptRequests).toHaveLength(1);
    expect(harness.promptRequests[0]?.target).toEqual(createOrchestratorTarget("session-2"));

    runtime.dispose();
  });

  it("hydrates the authoritative selected slot when a layout selection rolls back", async () => {
    const layout = (sessionId: string, panelId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      panels: [
        {
          panelId,
          binding: createOrchestratorTarget(sessionId),
          localState: { scroll: null, timelineDensity: "comfortable" },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: panelId,
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "Cached", "cached"),
        createSummary("session-2", "Second", "second"),
        createSummary("session-3", "Authoritative", "authoritative"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-3"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a-cached"),
        B: layout("session-2", "slot-b"),
        C: null,
      },
    });
    const runtime = await createRuntime(harness, createMemoryStorage(), TEST_WORKSPACE_INFO, {
      runtimeOptions: {
        workspaceTabId: TEST_WORKSPACE_INFO.workspaceTabId,
        initialLayoutId: "A",
        selectWorkspaceLayoutSlot: async () => {
          harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
            layouts: {
              A: layout("session-3", "slot-a-authoritative"),
              B: layout("session-2", "slot-b"),
              C: null,
            },
          });
          throw new Error("selection rejected");
        },
      },
    });

    await expect(runtime.switchWorkspaceLayout("B")).rejects.toThrow("selection rejected");

    expect(runtime.activeLayoutId).toBe("A");
    expect(runtime.getPane("slot-a-authoritative")?.target).toEqual(
      createOrchestratorTarget("session-3"),
    );
    expect(runtime.getPane("slot-a-cached")).toBeUndefined();

    runtime.dispose();
  });

  it("does not capture the current slot into an immediately selected intermediate slot", async () => {
    const layout = (sessionId: string, panelId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      panels: [
        {
          panelId,
          binding: createOrchestratorTarget(sessionId),
          localState: { scroll: null, timelineDensity: "comfortable" },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: panelId,
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
        createSummary("session-3", "Third", "third"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-3"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a"),
        B: layout("session-2", "slot-b"),
        C: layout("session-3", "slot-c"),
      },
    });
    const runtime = await createRuntime(harness);

    const selectB = runtime.switchWorkspaceLayout("B");
    const selectC = runtime.switchWorkspaceLayout("C");
    await Promise.all([selectB, selectC]);

    expect(runtime.activeLayoutId).toBe("C");
    expect(runtime.getPane("slot-c")?.target).toEqual(createOrchestratorTarget("session-3"));
    await runtime.switchWorkspaceLayout("B");
    expect(runtime.getPane("slot-b")?.target).toEqual(createOrchestratorTarget("session-2"));
    expect(runtime.getPane("slot-a")).toBeUndefined();

    runtime.dispose();
  });

  it("serializes a newer slot selection behind an older delayed hydration", async () => {
    const layout = (sessionId: string, panelId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      panels: [
        {
          panelId,
          binding: createOrchestratorTarget(sessionId),
          localState: { scroll: null, timelineDensity: "comfortable" },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: panelId,
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
        createSummary("session-3", "Third", "third"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-3"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1", "slot-a"),
        B: layout("session-2", "slot-b"),
        C: layout("session-3", "slot-c"),
      },
    });
    const runtime = await createRuntime(harness);
    const enteredSecondOpen = createDeferred();
    const releaseSecondOpen = createDeferred();
    harness.setOpenSessionHandler("session-2", async () => {
      enteredSecondOpen.resolve();
      await releaseSecondOpen.promise;
    });

    const selectB = runtime.switchWorkspaceLayout("B");
    await enteredSecondOpen.promise;
    const selectC = runtime.switchWorkspaceLayout("C");
    releaseSecondOpen.resolve();
    await Promise.all([selectB, selectC]);

    expect(runtime.activeLayoutId).toBe("C");
    expect(runtime.getPane("slot-c")?.target).toEqual(createOrchestratorTarget("session-3"));
    expect(runtime.getPane("slot-b")).toBeUndefined();
    await runtime.switchWorkspaceLayout("B");
    expect(runtime.getPane("slot-b")?.target).toEqual(createOrchestratorTarget("session-2"));

    runtime.dispose();
  });

  it("uses the tab-selected active layout against durable workspace layout slots", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    harness.setRendererLayoutFixture(
      TEST_WORKSPACE_INFO.workspaceId,
      createRendererLayoutFixtureState(
        {
          dockview: null,
          compactSurfaces: [],
          panels: [
            {
              panelId: "secondary",
              binding: createOrchestratorTarget("session-1"),
              localState: {
                scroll: null,
                timelineDensity: "comfortable",
              },
            },
          ],
          focusedPanelId: "secondary",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
        "B",
      ),
    );

    const runtime = await createRuntime(harness, storage, {
      ...TEST_WORKSPACE_INFO,
      activeLayoutId: "B",
    });

    expect(runtime.activeLayoutId).toBe("B");
    expect(runtime.getPane("secondary")?.target).toEqual(createOrchestratorTarget("session-1"));

    runtime.dispose();
  });

  it("hydrates prompt pane controllers when switching to a saved inactive layout slot", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "Orchestrator", "main reply"),
        createSummary("session-2", "Second", "second reply"),
      ],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-2"),
          messages: [assistantMessage("second reply")],
        }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: {
          dockview: null,
          compactSurfaces: [],
          panels: [
            {
              panelId: "slot-a",
              binding: createOrchestratorTarget("session-1"),
              localState: {
                scroll: null,
                timelineDensity: "comfortable",
              },
            },
          ],
          focusedPanelId: "slot-a",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
        B: {
          dockview: null,
          compactSurfaces: [],
          panels: [
            {
              panelId: "slot-b",
              binding: createOrchestratorTarget("session-2"),
              localState: {
                scroll: null,
                timelineDensity: "comfortable",
              },
            },
          ],
          focusedPanelId: "slot-b",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
        C: null,
      },
    });

    const runtime = await createRuntime(harness, storage);

    expect(runtime.activeLayoutId).toBe("A");
    expect(runtime.getPaneController("slot-a")).toBeTruthy();
    expect(runtime.getPaneController("slot-b")).toBeNull();

    await runtime.switchWorkspaceLayout("B");

    expect(runtime.activeLayoutId).toBe("B");
    expect(runtime.getPane("slot-b")?.target).toEqual(createOrchestratorTarget("session-2"));
    expect(runtime.getPaneController("slot-b")).toBeTruthy();
    expect(harness.openedTargets).toContainEqual(createOrchestratorTarget("session-2"));

    runtime.dispose();
  });

  it("retargets active pane ownership across slots without closing inactive controllers", async () => {
    const layout = (sessionId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      compactSurfaces: [],
      panels: [
        {
          panelId: "shared-pane",
          binding: createOrchestratorTarget(sessionId),
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      focusedPanelId: "shared-pane",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: layout("session-1"),
        B: layout("session-2"),
        C: null,
      },
    });
    const runtime = await createRuntime(harness);
    const firstController = runtime.getSurfaceController("session-1");
    expect(firstController?.ownerPaneIds).toEqual(["shared-pane"]);

    await runtime.switchWorkspaceLayout("B");
    const secondController = runtime.getSurfaceController("session-2");
    expect(firstController?.ownerPaneIds).toEqual([]);
    expect(secondController?.ownerPaneIds).toEqual(["shared-pane"]);
    expect(harness.closeRequests).toEqual([]);

    await runtime.switchWorkspaceLayout("A");
    expect(firstController?.ownerPaneIds).toEqual(["shared-pane"]);
    expect(secondController?.ownerPaneIds).toEqual([]);
    expect(
      harness.openedTargets.filter((target) => target.surfacePiSessionId === "session-1"),
    ).toHaveLength(1);

    await runtime.closePane("shared-pane");
    expect(harness.closeRequests).toEqual([createOrchestratorTarget("session-1")]);
    expect(secondController?.ownerPaneIds).toEqual([]);

    await runtime.switchWorkspaceLayout("B");
    expect(secondController?.ownerPaneIds).toEqual(["shared-pane"]);
    expect(
      harness.openedTargets.filter((target) => target.surfacePiSessionId === "session-2"),
    ).toHaveLength(1);
    expect(harness.closeRequests).toEqual([createOrchestratorTarget("session-1")]);

    runtime.dispose();
  });

  it("holds prompt admission until an authoritative active-pane retarget finishes", async () => {
    const layout = (sessionId: string): WorkspaceDockviewLayoutState => ({
      dockview: null,
      compactSurfaces: [],
      panels: [
        {
          panelId: "shared-pane",
          binding: createOrchestratorTarget(sessionId),
          localState: { scroll: null, timelineDensity: "comfortable" },
        },
      ],
      focusedPanelId: "shared-pane",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const harness = createFakeRpc({
      sessions: [
        createSummary("session-1", "First", "first"),
        createSummary("session-2", "Second", "second"),
      ],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-2"), messages: [] }),
      ],
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: { A: layout("session-1"), B: null, C: null },
    });
    const runtime = await createRuntime(harness);
    const previousController = runtime.getSurfaceController("session-1");
    expect(previousController?.ownerPaneIds).toEqual(["shared-pane"]);
    const retargetStarted = createDeferred();
    const finishRetarget = createDeferred();
    harness.setOpenSessionHandler("session-2", async () => {
      retargetStarted.resolve();
      await finishRetarget.promise;
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: { A: layout("session-2"), B: null, C: null },
    });

    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        invalidation: { model: "workspaceLayout", ids: ["A"] },
      },
    });
    await retargetStarted.promise;

    const sendPromise = previousController!.sendPrompt(
      { text: "must not use the stale active binding", attachments: [] },
      "shared-pane",
    );
    let sendSettled = false;
    void sendPromise.then(
      () => {
        sendSettled = true;
      },
      () => {
        sendSettled = true;
      },
    );
    await Bun.sleep(0);
    expect(sendSettled).toBe(false);
    expect(harness.promptRequests).toEqual([]);

    finishRetarget.resolve();
    await expect(sendPromise).rejects.toThrow("remain attached");
    expect(previousController?.ownerPaneIds).toEqual([]);
    expect(runtime.getSurfaceController("session-2")?.ownerPaneIds).toEqual(["shared-pane"]);
    expect(harness.promptRequests).toEqual([]);

    runtime.dispose();
  });

  it("syncs shared workspace layout slot changes into another open tab on the same slot", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    const { createChatRuntime } = await import("./chat-runtime");
    const firstRuntime = await createChatRuntime(
      { workspaceInfo: TEST_WORKSPACE_INFO },
      harness.client as never,
      storage,
    );
    const secondRuntime = await createChatRuntime(
      { workspaceInfo: TEST_WORKSPACE_INFO },
      harness.client as never,
      storage,
    );

    await firstRuntime.openSurface({ surface: "app-logs" }, "primary");
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(secondRuntime.getPane("primary")?.target).toEqual({ surface: "app-logs" });

    firstRuntime.dispose();
    secondRuntime.dispose();
  });

  it("preserves a saved empty layout without reopening the last session", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    harness.setRendererLayoutFixture(
      TEST_WORKSPACE_INFO.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [],
        focusedPanelId: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage);

    expect(runtime.sessions).toHaveLength(1);
    expect(runtime.paneLayout.panels).toHaveLength(0);
    expect(runtime.paneLayout.focusedPanelId).toBeNull();

    runtime.dispose();
  });

  it("keeps an uninitialized user workspace slot blank when sessions already exist", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });

    const runtime = await createRuntime(harness, storage, TEST_WORKSPACE_INFO, {
      seedInitialLayout: false,
    });

    expect(runtime.sessions).toHaveLength(1);
    expect(runtime.paneLayout.panels).toEqual([]);
    expect(runtime.paneLayout.focusedPanelId).toBeNull();
    expect(runtime.getSurfaceController("session-1")).toBeNull();
    expect(harness.openedTargets).toEqual([]);

    runtime.dispose();
  });

  it("keeps an uninitialized empty user workspace slot blank without creating a session", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [],
      surfaces: [],
    });

    const runtime = await createRuntime(harness, storage, TEST_WORKSPACE_INFO, {
      seedInitialLayout: false,
    });

    expect(runtime.sessions).toHaveLength(0);
    expect(runtime.paneLayout.panels).toEqual([]);
    expect(runtime.paneLayout.focusedPanelId).toBeNull();
    expect(harness.openedTargets).toEqual([]);

    runtime.dispose();
  });

  it("restores default workspace panes and keeps durable layout slots enabled", async () => {
    const storage = createMemoryStorage();
    const defaultWorkspaceInfo: WorkspaceTabInfo = {
      ...TEST_WORKSPACE_INFO,
      workspaceTabId: "default-tab-1",
      workspaceId: "workspace:default",
      cwd: "/tmp/svvy/default-workspace",
      workspaceLabel: "Default Workspace",
      kind: "default",
      branch: undefined,
    };
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    harness.setRendererLayoutFixture(
      defaultWorkspaceInfo.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: { surface: "app-logs" },
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
        ],
        focusedPanelId: "primary",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage, defaultWorkspaceInfo);

    expect(runtime.sessions).toHaveLength(0);
    expect(runtime.getPane("primary")?.target).toEqual({ surface: "app-logs" });
    await runtime.switchWorkspaceLayout("B");
    expect(runtime.activeLayoutId).toBe("B");
    expect(runtime.getPane("primary")?.target).toEqual({ surface: "open-workspace" });

    runtime.dispose();
  });

  it("seeds an empty persisted default workspace layout with Open Workspace", async () => {
    const storage = createMemoryStorage();
    const defaultWorkspaceInfo: WorkspaceTabInfo = {
      ...TEST_WORKSPACE_INFO,
      workspaceTabId: "default-tab-1",
      workspaceId: "workspace:default",
      cwd: "/tmp/svvy/default-workspace",
      workspaceLabel: "Default Workspace",
      kind: "default",
      branch: undefined,
    };
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    harness.setRendererLayoutFixture(
      defaultWorkspaceInfo.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [],
        focusedPanelId: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage, defaultWorkspaceInfo);

    expect(runtime.getPane("primary")?.target).toEqual({ surface: "open-workspace" });
    expect(runtime.paneLayout.focusedPanelId).toBe("primary");

    runtime.dispose();
  });

  it("keeps default workspace runtime-backed surfaces available beyond Open Workspace", async () => {
    const storage = createMemoryStorage();
    const defaultWorkspaceInfo: WorkspaceTabInfo = {
      ...TEST_WORKSPACE_INFO,
      workspaceTabId: "default-tab-1",
      workspaceId: "workspace:default",
      cwd: "/tmp/svvy/default-workspace",
      workspaceLabel: "Default Workspace",
      kind: "default",
      branch: undefined,
    };
    const harness = createFakeRpc({ sessions: [], surfaces: [] });

    const runtime = await createRuntime(harness, storage, defaultWorkspaceInfo);

    await runtime.createSession();
    expect(runtime.sessions).toHaveLength(1);
    expect(runtime.getPane("primary")?.target).toEqual(createOrchestratorTarget("session-1"));

    await runtime.openSurface({ surface: "app-logs" }, { kind: "focused-panel" });
    expect(runtime.getPane("primary")?.target).toEqual({ surface: "app-logs" });
    expect(await runtime.getAppLogs()).toMatchObject({ entries: [] });

    await runtime.openSurface({ surface: "agents" }, { kind: "focused-panel" });
    expect(runtime.getPane("primary")?.target).toEqual({ surface: "agents" });

    await runtime.openSurface({ surface: "extensions" }, { kind: "focused-panel" });
    expect(runtime.getPane("primary")?.target).toEqual({ surface: "extensions" });

    await runtime.openSurface({ surface: "settings" }, { kind: "focused-panel" });
    expect(runtime.getPane("primary")?.target).toEqual({ surface: "settings" });

    await runtime.openSurface({ surface: "workflows" }, { kind: "focused-panel" });
    expect(runtime.getPane("primary")?.target).toEqual({ surface: "workflows" });
    expect(await runtime.getWorkflowsGenerated()).toEqual({
      packageName: "@svvyx/workflows",
      facts: [],
      exports: [],
    });

    await runtime.openSurface(
      { workspaceSessionId: "session-1", surface: "artifact", artifactId: "artifact-1" },
      { kind: "focused-panel" },
    );
    expect(runtime.getPane("primary")?.target).toEqual({
      workspaceSessionId: "session-1",
      surface: "artifact",
      artifactId: "artifact-1",
    });
    expect(await runtime.getArtifactPreview("artifact-1", "session-1")).toMatchObject({
      artifactId: "artifact-1",
      sessionId: "session-1",
      content: "artifact artifact-1",
    });

    await runtime.storage.promptHistory.append({
      workspaceId: runtime.workspaceId,
      sessionId: "session-1",
      text: "default workspace prompt",
      sentAt: 1,
    });
    expect(await runtime.storage.promptHistory.list("workspace:default")).toEqual([
      {
        workspaceId: "workspace:default",
        sessionId: "session-1",
        text: "default workspace prompt",
        sentAt: 1,
      },
    ]);

    runtime.dispose();
  });

  it("preserves Dockview placement command targets when opening static panes", async () => {
    const runtime = await createRuntime(
      createFakeRpc({
        sessions: [createSummary("session-1", "Existing", "ready")],
        surfaces: [
          createSurfaceSnapshot({
            target: createOrchestratorTarget("session-1"),
            messages: [],
          }),
        ],
      }),
    );

    await runtime.openSurface(
      { surface: "app-logs" },
      { kind: "edge", direction: "left", size: 280 },
    );
    await runtime.openSurface(
      { surface: "agents" },
      { kind: "floating", box: { x: 20, y: 30, width: 640, height: 480 } },
    );
    await runtime.openSurface(
      { surface: "extensions" },
      { kind: "popout", box: { left: 40, top: 50, width: 800, height: 600 } },
    );
    await runtime.openSurface(
      { surface: "settings" },
      { kind: "split", panelId: "primary", direction: "below", size: 340 },
    );
    await runtime.openSurface(
      { surface: "workflows" },
      { kind: "tab", groupId: "group-1", index: 1 },
    );

    expect(runtime.paneLayout.panels.map((panel) => panel.placement)).toEqual([
      null,
      { kind: "edge", direction: "left", size: 280 },
      { kind: "floating", box: { x: 20, y: 30, width: 640, height: 480 } },
      { kind: "popout", box: { left: 40, top: 50, width: 800, height: 600 } },
      { kind: "split", referencePanelId: "primary", direction: "below", size: 340 },
      { kind: "tab", groupId: "group-1", index: 1 },
    ]);

    runtime.dispose();
  });

  it("preserves Dockview placement command targets when opening interactive surfaces", async () => {
    const target = createOrchestratorTarget("session-1");
    const runtime = await createRuntime(
      createFakeRpc({
        sessions: [createSummary("session-1", "Existing", "ready")],
        surfaces: [
          createSurfaceSnapshot({
            target,
            messages: [],
          }),
        ],
      }),
    );

    await runtime.openSurface(target, {
      kind: "split",
      panelId: "primary",
      direction: "left",
      size: 320,
    });
    await runtime.openSurface(target, {
      kind: "edge",
      direction: "right",
      size: 280,
    });
    await runtime.openSurface(target, {
      kind: "floating",
      box: { x: 20, y: 30, width: 640, height: 480 },
    });
    await runtime.openSurface(target, {
      kind: "popout",
      box: { left: 40, top: 50, width: 800, height: 600 },
    });

    expect(runtime.paneLayout.panels.map((panel) => panel.placement)).toEqual([
      null,
      { kind: "split", referencePanelId: "primary", direction: "left", size: 320 },
      { kind: "edge", direction: "right", size: 280 },
      { kind: "floating", box: { x: 20, y: 30, width: 640, height: 480 } },
      { kind: "popout", box: { left: 40, top: 50, width: 800, height: 600 } },
    ]);
    expect(
      runtime.getSurfaceController(target.surfacePiSessionId)?.ownerPaneIds.toSorted(),
    ).toEqual(runtime.paneLayout.panels.map((panel) => panel.panelId).toSorted());

    runtime.dispose();
  });

  it("restores Dockview placement metadata for static panes after restart", async () => {
    const storage = createMemoryStorage();
    const firstHarness = createFakeRpc({
      sessions: [createSummary("session-1", "Existing", "ready")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [],
        }),
      ],
    });
    const firstRuntime = await createRuntime(firstHarness, storage);

    await firstRuntime.openSurface(
      { surface: "app-logs" },
      { kind: "edge", direction: "left", size: 280 },
    );
    await firstRuntime.openSurface(
      { surface: "agents" },
      { kind: "floating", box: { x: 20, y: 30, width: 640, height: 480 } },
    );
    await firstRuntime.openSurface(
      { surface: "extensions" },
      { kind: "popout", box: { left: 40, top: 50, width: 800, height: 600 } },
    );
    await firstRuntime.openSurface(
      { surface: "settings" },
      { kind: "split", panelId: "primary", direction: "below", size: 340 },
    );
    await firstRuntime.openSurface(
      { surface: "workflows" },
      { kind: "tab", groupId: "group-1", index: 1 },
    );
    firstRuntime.dispose();

    await waitFor(
      () =>
        firstHarness.getRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId)?.layouts.A?.panels
          .length === 6,
    );

    const restoreState = firstHarness.getRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId);
    expect(restoreState?.layouts.A?.panels.map((panel) => panel.placement)).toEqual([
      null,
      { kind: "edge", direction: "left", size: 280 },
      { kind: "floating", box: { x: 20, y: 30, width: 640, height: 480 } },
      { kind: "popout", box: { left: 40, top: 50, width: 800, height: 600 } },
      { kind: "split", referencePanelId: "primary", direction: "below", size: 340 },
      { kind: "tab", groupId: "group-1", index: 1 },
    ]);

    const secondHarness = createFakeRpc({
      sessions: [createSummary("session-1", "Existing", "ready")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [],
        }),
      ],
    });
    secondHarness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, restoreState!);
    const secondRuntime = await createRuntime(secondHarness, storage);

    expect(secondRuntime.paneLayout.panels.map((panel) => panel.placement)).toEqual([
      null,
      { kind: "edge", direction: "left", size: 280 },
      { kind: "floating", box: { x: 20, y: 30, width: 640, height: 480 } },
      { kind: "popout", box: { left: 40, top: 50, width: 800, height: 600 } },
      { kind: "split", referencePanelId: "primary", direction: "below", size: 340 },
      { kind: "tab", groupId: "group-1", index: 1 },
    ]);

    secondRuntime.dispose();
  });

  it("creates a default workspace session and records history from command palette fallback text", async () => {
    const storage = createMemoryStorage();
    const defaultWorkspaceInfo: WorkspaceTabInfo = {
      ...TEST_WORKSPACE_INFO,
      workspaceTabId: "default-tab-1",
      workspaceId: "workspace:default",
      cwd: "/tmp/svvy/default-workspace",
      workspaceLabel: "Default Workspace",
      kind: "default",
      branch: undefined,
    };
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    harness.setRendererLayoutFixture(
      defaultWorkspaceInfo.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: { surface: "open-workspace" },
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
        ],
        focusedPanelId: "primary",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );
    const createdTargets: PromptTarget[] = [];

    const runtime = await createRuntime(harness, storage, defaultWorkspaceInfo);
    const didRun = await executePaletteFallbackPrompt({
      runtime,
      prompt: "  Implement default workspace fallback prompt  ",
      paneId: "primary",
      onCreatedTarget: (target) => {
        createdTargets.push(target);
      },
    });

    expect(didRun).toBe(true);
    expect(runtime.sessions).toHaveLength(1);
    expect(runtime.getPane("primary")?.target).toEqual(createOrchestratorTarget("session-1"));
    expect(createdTargets).toEqual([createOrchestratorTarget("session-1")]);
    expect(harness.promptRequests).toHaveLength(1);
    expect(harness.promptRequests[0]?.target).toEqual(createOrchestratorTarget("session-1"));
    expect(
      (await storage.promptHistory.list("workspace:default")).map((entry) => ({
        sessionId: entry.sessionId,
        text: entry.text,
      })),
    ).toEqual([
      {
        sessionId: "session-1",
        text: "Implement default workspace fallback prompt",
      },
    ]);

    runtime.dispose();
  });

  it("replaces the default Open Workspace pane when creating a session", async () => {
    const storage = createMemoryStorage();
    const defaultWorkspaceInfo: WorkspaceTabInfo = {
      ...TEST_WORKSPACE_INFO,
      workspaceTabId: "default-tab-1",
      workspaceId: "workspace:default",
      cwd: "/tmp/svvy/default-workspace",
      workspaceLabel: "Default Workspace",
      kind: "default",
      branch: undefined,
    };
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    harness.setRendererLayoutFixture(
      defaultWorkspaceInfo.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: { surface: "open-workspace" },
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
        ],
        focusedPanelId: "primary",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage, defaultWorkspaceInfo);

    await runtime.createSession();

    expect(runtime.sessions).toHaveLength(1);
    expect(runtime.getPane("primary")?.target).toEqual(createOrchestratorTarget("session-1"));

    runtime.dispose();
  });

  it("replaces the default Open Workspace pane when sidebar session creation requests a new panel", async () => {
    const storage = createMemoryStorage();
    const defaultWorkspaceInfo: WorkspaceTabInfo = {
      ...TEST_WORKSPACE_INFO,
      workspaceTabId: "default-tab-1",
      workspaceId: "workspace:default",
      cwd: "/tmp/svvy/default-workspace",
      workspaceLabel: "Default Workspace",
      kind: "default",
      branch: undefined,
    };
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    harness.setRendererLayoutFixture(
      defaultWorkspaceInfo.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: { surface: "open-workspace" },
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
        ],
        focusedPanelId: "primary",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage, defaultWorkspaceInfo);

    await runtime.createSession({}, { kind: "new-panel", direction: "right" });

    expect(runtime.paneLayout.panels).toHaveLength(1);
    expect(runtime.getPane("primary")?.target).toEqual(createOrchestratorTarget("session-1"));

    runtime.dispose();
  });

  it("preserves restored prompt panes that fail to reopen as unavailable surfaces", async () => {
    const storage = createMemoryStorage();
    const harness = createFakeRpc({
      sessions: [createSummary("missing-session", "Missing", "")],
      surfaces: [],
    });
    harness.setRendererLayoutFixture(
      TEST_WORKSPACE_INFO.workspaceId,
      createRendererLayoutFixtureState({
        dockview: null,
        compactSurfaces: [],
        panels: [
          {
            panelId: "primary",
            binding: createOrchestratorTarget("missing-session"),
            localState: {
              scroll: null,
              timelineDensity: "comfortable",
            },
          },
        ],
        focusedPanelId: "primary",
        updatedAt: "2026-04-27T00:00:00.000Z",
      }),
    );

    const runtime = await createRuntime(harness, storage);

    expect(runtime.sessions).toHaveLength(1);
    expect(runtime.paneLayout.panels).toHaveLength(1);
    expect(runtime.paneLayout.panels[0]).toMatchObject({
      panelId: "primary",
      binding: createOrchestratorTarget("missing-session"),
      chrome: {
        title: "Surface unavailable",
        subtitle: "Orchestrator",
        kind: "unavailable",
      },
      restore: {
        unavailableReason: "Missing fake surface missing-session",
      },
    });
    expect(runtime.getPane("primary")?.target).toEqual(createOrchestratorTarget("missing-session"));
    expect(runtime.getPane("primary")?.chrome?.kind).toBe("unavailable");
    expect(runtime.getPane("primary")?.restore?.unavailableReason).toBe(
      "Missing fake surface missing-session",
    );

    runtime.dispose();
  });

  it("forwards typed renderer commands from desktop notifications", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const runtime = await createRuntime(harness);
    const commands: string[] = [];
    const unsubscribe = runtime.subscribeRendererCommand((command) => commands.push(command));

    for (const command of ["command-palette.open", "quick-open.open", "settings.open"] as const) {
      harness.emitDesktopNotification({ kind: "renderer-command", command });
    }

    expect(commands).toEqual(["command-palette.open", "quick-open.open", "settings.open"]);

    unsubscribe();
    harness.emitDesktopNotification({ kind: "renderer-command", command: "settings.open" });
    expect(commands).toHaveLength(3);
    runtime.dispose();
  });

  it("applies one renderer-startup baseline before acknowledging renderer readiness", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const runtime = await createRuntime(harness);
    harness.setRebaselineResult({
      app: [
        {
          kind: "appPreferences",
          value: {
            appearance: "dark",
            externalEditor: "zed",
            artifactDirectory: "/tmp/renderer-ready" as never,
            approvalMode: "user",
            networkAccess: false,
            externalInstructions: DEFAULT_AGENT_SETTINGS_STATE.appPreferences.externalInstructions,
            ambientResources: {},
            updatedAt: "2026-07-11T00:00:00.000Z" as never,
            revision: 1 as StateRevision,
          },
        },
      ],
      workspaces: [],
      revision: 1 as StateRevision,
    });

    await Promise.all([runtime.markRendererReady(), runtime.markRendererReady()]);

    expect(harness.requestCounts.rebaselineStateReadModels).toBe(1);
    expect(harness.requestCounts.rendererReady).toBe(1);
    expect(runtime.appPreferencesSnapshot?.appAppearance).toBe("dark");
    runtime.dispose();
  });

  it("clears and reloads inspector targets that remain bound across a workspace rebaseline", async () => {
    const initialInspector = {
      ...createCommandInspector("command-bound"),
      summary: "before rebaseline",
    };
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "First", "first")],
      surfaces: [
        createSurfaceSnapshot({ target: createOrchestratorTarget("session-1"), messages: [] }),
      ],
      commandInspector: initialInspector,
    });
    harness.setRendererLayoutFixture(TEST_WORKSPACE_INFO.workspaceId, {
      layouts: {
        A: {
          dockview: null,
          compactSurfaces: [],
          panels: [
            {
              panelId: "command-pane",
              binding: {
                workspaceSessionId: "session-1",
                surface: "command",
                commandId: "command-bound",
              },
              localState: { scroll: null, timelineDensity: "comfortable" },
            },
          ],
          focusedPanelId: "command-pane",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
        B: null,
        C: null,
      },
    });
    const runtime = await createRuntime(harness);
    expect((await runtime.getCommandInspector("command-bound")).summary).toBe("before rebaseline");
    harness.setCommandInspector({
      ...initialInspector,
      summary: "after rebaseline",
      updatedAt: "2026-04-10T10:20:00.000Z",
    });
    harness.setRebaselineResult({ app: [], workspaces: [], revision: 2 as StateRevision });

    await runtime.markRendererReady();
    await waitFor(() => harness.commandInspectorRequests.length === 2);

    expect((await runtime.getCommandInspector("command-bound")).summary).toBe("after rebaseline");

    runtime.dispose();
  });

  it("replaces notification-managed caches from an authoritative workspace rebaseline", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    await waitFor(() => runtime.appPreferencesSnapshot !== null);

    harness.setRebaselineResult({
      app: [
        {
          kind: "appPreferences",
          value: {
            appearance: "dark",
            externalEditor: "zed",
            artifactDirectory: "/tmp/rebaseline-artifacts" as never,
            approvalMode: "user",
            networkAccess: false,
            externalInstructions: {
              globalRoots: [
                {
                  id: "team-instructions",
                  kind: "custom",
                  label: "Team instructions",
                  path: "/tmp/team-instructions",
                  enabled: true,
                },
              ],
              globalControls: {
                "/tmp/team-instructions/AGENTS.md": {
                  enabled: true,
                  actors: ["orchestrator", "workflow-task"],
                },
              },
              workspaceControls: {},
            },
            ambientResources: {},
            updatedAt: "2026-07-10T00:00:00.000Z" as never,
            revision: 2 as StateRevision,
          },
        },
      ],
      workspaces: [
        {
          kind: "sessionNavigation",
          value: buildWorkspaceSessionNavigation([
            createSummary("session-2", "Rebaselined", "authoritative state"),
          ]),
        },
      ],
      revision: 2 as StateRevision,
    });
    harness.emitDesktopNotification({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
      rebaselineRequired: true,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as never,
      },
    });

    await waitFor(
      () =>
        runtime.appPreferencesSnapshot?.appAppearance === "dark" &&
        runtime.sessions[0]?.id === "session-2",
    );
    expect(runtime.appPreferencesSnapshot).toMatchObject({
      appAppearance: "dark",
      preferredExternalEditor: "zed",
      artifactDirectory: "/tmp/rebaseline-artifacts",
      approvalMode: "user",
      networkAccess: false,
      externalInstructions: {
        globalRoots: [
          expect.objectContaining({
            id: "team-instructions",
            path: "/tmp/team-instructions",
            enabled: true,
          }),
        ],
        globalControls: {
          "/tmp/team-instructions/AGENTS.md": {
            enabled: true,
            actors: ["orchestrator", "workflow-task"],
          },
        },
      },
    });
    expect(runtime.sessions.map((session) => session.id)).toEqual(["session-2"]);
    expect(runtime.sessionNavigation.activeSessions[0]?.title).toBe("Rebaselined");

    runtime.dispose();
  });

  it("routes snippet mutations through exact state commands and opens discovered sources by identity", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const discoveredSnippetId = "claude:user:/tmp/review.md" as SnippetId;
    harness.setSnippetRows([
      {
        id: discoveredSnippetId,
        source: "claude",
        title: "Review",
        body: "Review $1",
        metadata: { description: "Review a target", argumentHint: "target" },
        enabled: true,
        path: "/tmp/review.md",
        updatedAt: "2026-07-11T00:00:00.000Z" as never,
      },
    ]);
    const runtime = await createRuntime(harness);

    expect(await runtime.getSnippets()).toEqual({
      snippets: [
        expect.objectContaining({
          id: discoveredSnippetId,
          source: "claude",
          path: "/tmp/review.md",
        }),
      ],
    });

    const createdSnippetId = await runtime.createManagedSnippet({
      title: "  Plan  ",
      body: "Plan $ARGUMENTS",
      description: "  Make a plan  ",
      argumentHint: "   ",
    });
    expect(harness.snippetCreateRequests).toEqual([
      expect.objectContaining({
        workspaceId: TEST_WORKSPACE_INFO.workspaceId,
        title: "  Plan  ",
        body: "Plan $ARGUMENTS",
        metadata: { description: "Make a plan", argumentHint: null },
        enabled: true,
        clientSubmission: expect.objectContaining({ source: "desktop" }),
      }),
    ]);
    expect(
      runtime.snippetsSnapshot?.snippets.some((snippet) => snippet.id === createdSnippetId),
    ).toBe(true);

    await runtime.updateManagedSnippet({
      snippetId: createdSnippetId,
      title: "Plan next",
      body: "Plan $1",
      description: "Next step",
      argumentHint: "target",
    });
    expect(harness.snippetUpdateRequests[0]).toMatchObject({
      workspaceId: TEST_WORKSPACE_INFO.workspaceId,
      snippetId: createdSnippetId,
      patch: {
        title: "Plan next",
        body: "Plan $1",
        metadata: { description: "Next step", argumentHint: "target" },
      },
    });
    expect(
      runtime.snippetsSnapshot?.snippets.find((snippet) => snippet.id === createdSnippetId)?.title,
    ).toBe("Plan next");

    await runtime.setSnippetEnabled({ snippetId: discoveredSnippetId, enabled: false });
    expect(harness.snippetEnableRequests[0]).toMatchObject({
      workspaceId: TEST_WORKSPACE_INFO.workspaceId,
      snippetId: discoveredSnippetId,
      enabled: false,
    });
    expect(
      runtime.snippetsSnapshot?.snippets.find((snippet) => snippet.id === discoveredSnippetId)
        ?.enabled,
    ).toBe(false);

    expect(await runtime.openSnippetSourceInEditor(discoveredSnippetId)).toBe(true);
    expect(harness.openSnippetSourceRequests).toEqual([
      {
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        snippetId: discoveredSnippetId,
      },
    ]);

    await runtime.deleteManagedSnippet(createdSnippetId);
    expect(harness.snippetDeleteRequests[0]).toMatchObject({
      workspaceId: TEST_WORKSPACE_INFO.workspaceId,
      snippetId: createdSnippetId,
    });
    expect(
      runtime.snippetsSnapshot?.snippets.some((snippet) => snippet.id === createdSnippetId),
    ).toBe(false);
    runtime.dispose();
  });

  it("applies snippet invalidations and workspace rebaselines to the renderer cache", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const runtime = await createRuntime(harness);
    await runtime.getSnippets();
    const firstSnippetId = "pi:user:/tmp/first.md" as SnippetId;
    harness.setSnippetRows([
      {
        id: firstSnippetId,
        source: "pi",
        title: "First",
        body: "First body",
        metadata: { description: null, argumentHint: null },
        enabled: true,
        path: "/tmp/first.md",
        updatedAt: "2026-07-11T00:00:00.000Z" as never,
      },
    ]);
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        invalidation: { model: "snippets", ids: [firstSnippetId] },
      },
    });

    await waitFor(() => runtime.snippetsSnapshot?.snippets[0]?.id === firstSnippetId);
    const secondSnippetId = "claude:workspace:/tmp/second.md" as SnippetId;
    harness.setRebaselineResult({
      app: [],
      workspaces: [
        {
          kind: "snippets",
          value: {
            managed: [],
            discovered: [
              {
                id: secondSnippetId,
                source: "claude",
                title: "Second",
                body: "Second body",
                metadata: { description: null, argumentHint: null },
                enabled: true,
                path: "/tmp/second.md",
                updatedAt: "2026-07-11T00:01:00.000Z" as never,
              },
            ],
            snippets: [
              {
                id: secondSnippetId,
                source: "claude",
                title: "Second",
                body: "Second body",
                metadata: { description: null, argumentHint: null },
                enabled: true,
                path: "/tmp/second.md",
                updatedAt: "2026-07-11T00:01:00.000Z" as never,
              },
            ],
          },
        },
      ],
      revision: 2 as StateRevision,
    });
    harness.emitDesktopNotification({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
      rebaselineRequired: true,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
      },
    });

    await waitFor(() => runtime.snippetsSnapshot?.snippets[0]?.id === secondSnippetId);
    expect(runtime.snippetsSnapshot?.snippets).toEqual([
      expect.objectContaining({ id: secondSnippetId, source: "claude", path: "/tmp/second.md" }),
    ]);
    runtime.dispose();
  });

  it("rejects malformed state snippet rows instead of inferring renderer ownership", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    harness.setSnippetRows([
      {
        id: "managed-with-path" as SnippetId,
        source: "svvy",
        title: "Managed",
        body: "body",
        metadata: { description: null, argumentHint: null },
        enabled: true,
        path: "/tmp/not-managed.md",
        updatedAt: "2026-07-11T00:00:00.000Z" as never,
      },
    ]);
    const runtime = await createRuntime(harness);

    await expect(runtime.getSnippets()).rejects.toThrow(
      "Managed snippet managed-with-path unexpectedly has an external source path.",
    );
    runtime.dispose();
  });

  it("reads generated Workflows metadata from state and opens export files by identity", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    harness.setWorkflowsGeneratedReadModel({
      packageName: "@svvyx/workflows",
      facts: [
        {
          packageName: "@svvyx/workflows",
          status: "ready",
          buildId: "workflow-build-1",
          manifestPath: "/tmp/generated/.svvy-generated-package.json",
          diagnostics: [],
          refreshNeededReason: null,
          updatedAt: "2026-07-11T08:00:00.000Z",
        },
      ],
      exports: [
        {
          namespace: "Agents",
          exportName: "reviewAgent",
          qualifiedName: "Agents.reviewAgent",
          kind: "agent",
          generatedCode: "export const reviewAgent = {}",
          generatedPath: "/tmp/generated/agents.ts",
          sourcePath: "/tmp/sources/review.agent.json",
          agentParameters: { id: "review-agent" },
          workflowAgentId: "review-agent",
        },
      ],
    });
    const runtime = await createRuntime(harness);

    expect(await runtime.getWorkflowsGenerated()).toMatchObject({
      packageName: "@svvyx/workflows",
      facts: [expect.objectContaining({ status: "ready", buildId: "workflow-build-1" })],
      exports: [
        expect.objectContaining({
          qualifiedName: "Agents.reviewAgent",
          workflowAgentId: "review-agent",
        }),
      ],
    });
    expect(
      await runtime.openWorkflowsGeneratedExportInEditor({
        qualifiedName: "Agents.reviewAgent",
        target: "source",
      }),
    ).toBe(true);
    expect(
      await runtime.openWorkflowsGeneratedExportInEditor({
        qualifiedName: "Agents.reviewAgent",
        target: "generated",
      }),
    ).toBe(true);
    expect(harness.openWorkflowsGeneratedExportRequests).toEqual([
      {
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        qualifiedName: "Agents.reviewAgent",
        target: "source",
      },
      {
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as WorkspaceId,
        qualifiedName: "Agents.reviewAgent",
        target: "generated",
      },
    ]);
    runtime.dispose();
  });

  it("routes file-backed source edits through the runtime facade without renderer file access", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const runtime = await createRuntime(harness);

    const opened = await runtime.openSourceEdit({
      sourceKind: "workflow-agent",
      sourceId: "reviewer",
    });
    expect(opened).toMatchObject({
      sourceKind: "workflow-agent",
      sourceId: "reviewer",
      sourceVersion: "sha256:source-version",
    });

    const saved = await runtime.saveSourceEdit({
      sourceKind: "workflow-agent",
      sourceId: "reviewer",
      expectedSourceVersion: opened.sourceVersion,
      text: '{"id":"reviewer"}\n',
      saveMode: "compare-and-swap",
    });
    expect(saved).toMatchObject({
      status: "saved",
      sourceVersion: "sha256:saved-version",
    });
    expect(harness.sourceEditOpenRequests).toEqual([
      { sourceKind: "workflow-agent", sourceId: "reviewer" },
    ]);
    expect(harness.sourceEditSaveRequests).toEqual([
      {
        sourceKind: "workflow-agent",
        sourceId: "reviewer",
        expectedSourceVersion: "sha256:source-version",
        text: '{"id":"reviewer"}\n',
        saveMode: "compare-and-swap",
      },
    ]);

    runtime.dispose();
  });

  it("routes configured profile commands through state and refetches the agents cache", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const runtime = await createRuntime(harness);
    const reviewProfileId =
      "review-orchestrator" as ConfiguredAgentProfileReadModelRecord["profileId"];

    const created = await runtime.updateOrchestratorProfile({
      profileId: reviewProfileId,
      name: "Review orchestrator",
      providerId: "openai" as ProviderId,
      modelId: "gpt-4o" as ModelId,
      reasoning: { effort: "high" },
      followComposer: true,
      extensionUsage: {},
      extensionOrder: [],
    });
    expect(created.configuredProfiles).toContainEqual(
      expect.objectContaining({
        profileId: reviewProfileId,
        actor: "orchestrator",
        followComposer: true,
        reasoning: { effort: "high" },
      }),
    );
    expect(runtime.agentsSnapshot).toEqual(created);

    const withUsage = await runtime.setConfiguredProfileExtensionUsage({
      actor: "orchestrator",
      profileId: reviewProfileId,
      extensionId: "github" as ExtensionId,
      usage: "loaded",
    });
    expect(
      withUsage.configuredProfiles.find((profile) => profile.profileId === reviewProfileId)
        ?.extensionUsage,
    ).toEqual({ github: "loaded" });

    const withDefault = await runtime.promoteConfiguredProfileExtensionDefault({
      actor: "orchestrator",
      profileId: reviewProfileId,
      extensionId: "github" as ExtensionId,
      usage: "loaded",
    });
    expect(
      withDefault.actorExtensionDefaults.find((defaults) => defaults.actor === "orchestrator")
        ?.extensionUsage,
    ).toEqual({ github: "loaded" });

    const reordered = await runtime.reorderOrchestratorProfiles({
      profileIds: [
        "default-orchestrator" as ConfiguredAgentProfileReadModelRecord["profileId"],
        reviewProfileId,
      ],
    });
    expect(
      reordered.configuredProfiles
        .filter((profile) => profile.actor === "orchestrator")
        .toSorted((left, right) => left.position - right.position)
        .map((profile) => profile.profileId),
    ).toEqual([
      "default-orchestrator" as ConfiguredAgentProfileReadModelRecord["profileId"],
      reviewProfileId,
    ]);

    const deleted = await runtime.deleteOrchestratorProfile({ profileId: reviewProfileId });
    expect(
      deleted.configuredProfiles.some((profile) => profile.profileId === reviewProfileId),
    ).toBe(false);
    expect(runtime.agentsSnapshot).toEqual(deleted);
    runtime.dispose();
  });

  it("applies app-global Workflows invalidations and rebaselines to the renderer cache", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const runtime = await createRuntime(harness);
    await runtime.getWorkflowsGenerated();
    harness.setWorkflowsGeneratedReadModel({
      packageName: "@svvyx/workflows",
      facts: [
        {
          packageName: "@svvyx/workflows",
          status: "ready",
          buildId: "workflow-build-2",
          manifestPath: "/tmp/generated/.svvy-generated-package.json",
          diagnostics: [],
          refreshNeededReason: null,
          updatedAt: "2026-07-11T09:00:00.000Z",
        },
      ],
      exports: [
        {
          namespace: "Prompts",
          exportName: "reviewPrompt",
          qualifiedName: "Prompts.reviewPrompt",
          kind: "prompt",
          generatedCode: "export const reviewPrompt = 'review'",
          generatedPath: "/tmp/generated/prompts.ts",
          sourcePath: "/tmp/sources/review.prompt.ts",
          agentParameters: null,
          workflowAgentId: null,
        },
      ],
    });
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: { kind: "app" },
      invalidation: { scope: "app", invalidation: { model: "workflowsGenerated" } },
    });

    await waitFor(
      () =>
        runtime.workflowsGeneratedSnapshot?.exports[0]?.qualifiedName === "Prompts.reviewPrompt",
    );
    harness.setRebaselineResult({
      app: [
        {
          kind: "workflowsGenerated",
          value: {
            packageName: "@svvyx/workflows",
            facts: [
              {
                packageName: "@svvyx/workflows",
                status: "failed",
                buildId: "workflow-build-2",
                manifestPath: "/tmp/generated/.svvy-generated-package.json",
                diagnostics: ["Build failed"],
                refreshNeededReason: null,
                updatedAt: "2026-07-11T10:00:00.000Z",
              },
            ],
            exports: [],
          },
        },
      ],
      workspaces: [],
      revision: 3 as StateRevision,
    });
    harness.emitDesktopNotification({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
      rebaselineRequired: true,
      scope: { kind: "app" },
    });

    await waitFor(() => runtime.workflowsGeneratedSnapshot?.facts[0]?.status === "failed");
    expect(runtime.workflowsGeneratedSnapshot).toMatchObject({
      facts: [expect.objectContaining({ status: "failed", diagnostics: ["Build failed"] })],
      exports: [],
    });
    runtime.dispose();
  });

  it("applies provider-auth invalidations without triggering another status-sync read", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const runtime = await createRuntime(harness);
    await waitFor(() => harness.requestCounts.listProviderAuths >= 2);
    const listingsBeforeInvalidation = harness.requestCounts.listProviderAuths;

    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: { kind: "app" },
      invalidation: { scope: "app", invalidation: { model: "providerAuth" } },
    });

    await waitFor(() => harness.requestCounts.fetchProviderAuth === 1);
    expect(harness.requestCounts.listProviderAuths).toBe(listingsBeforeInvalidation);
    expect(runtime.providerAuthsSnapshot).toEqual([
      expect.objectContaining({
        provider: "openai",
        hasKey: true,
        supportsOAuth: true,
        authHealth: "available",
      }),
    ]);
    runtime.dispose();
  });

  it("applies request-input and approval invalidations without refreshing the legacy session catalog", async () => {
    const harness = createFakeRpc({ sessions: [], surfaces: [] });
    const runtime = await createRuntime(harness);
    const requestInput = createRequestUserInputRequest();
    const approval = createRuntimeApprovalRequest();
    const navigationFetchesBeforeInvalidations = harness.requestCounts.sessionNavigation;

    harness.setRequestInputReadModelRequests([requestInput]);
    harness.setApprovalsReadModelRequests([approval]);
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as never,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as never,
        invalidation: { model: "requestInput", ids: [requestInput.requestId as never] },
      },
    });
    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 1 as never,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as never,
      },
      invalidation: {
        scope: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as never,
        invalidation: { model: "runtimeApprovals", ids: [approval.requestId as never] },
      },
    });

    await waitFor(
      () =>
        runtime.getRequestUserInputRequests().length === 1 &&
        runtime.getRuntimeApprovalRequests().length === 1,
    );

    expect(runtime.getRequestUserInputRequests()).toEqual([requestInput]);
    expect(runtime.getRuntimeApprovalRequests()).toEqual([approval]);
    expect(harness.requestCounts.sessionNavigation).toBe(navigationFetchesBeforeInvalidations);
    runtime.dispose();
  });

  it("replaces request-input and approval caches from a workspace rebaseline without refreshing the legacy session catalog", async () => {
    const staleRequestInput = createRequestUserInputRequest({ requestId: "rui-stale" });
    const staleApproval = createRuntimeApprovalRequest({ requestId: "apr-stale" });
    const harness = createFakeRpc({
      sessions: [],
      surfaces: [],
      requestUserInputRequests: [staleRequestInput],
      runtimeApprovalRequests: [staleApproval],
    });
    const runtime = await createRuntime(harness);
    const requestInput = createRequestUserInputRequest({ requestId: "rui-current" });
    const approval = createRuntimeApprovalRequest({ requestId: "apr-current" });
    const navigationFetchesBeforeRebaseline = harness.requestCounts.sessionNavigation;
    harness.setRebaselineResult({
      app: [],
      workspaces: [
        { kind: "requestInput", value: { requests: [requestInput] } },
        { kind: "approvals", value: { requests: [approval] } },
      ],
      revision: 3 as StateRevision,
    });

    harness.emitDesktopNotification({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
      rebaselineRequired: true,
      scope: {
        kind: "workspace",
        workspaceId: TEST_WORKSPACE_INFO.workspaceId as never,
      },
    });

    await waitFor(
      () =>
        runtime.getRequestUserInputRequests()[0]?.requestId === requestInput.requestId &&
        runtime.getRuntimeApprovalRequests()[0]?.requestId === approval.requestId,
    );

    expect(runtime.getRequestUserInputRequests()).toEqual([requestInput]);
    expect(runtime.getRuntimeApprovalRequests()).toEqual([approval]);
    expect(harness.requestCounts.sessionNavigation).toBe(navigationFetchesBeforeRebaseline);
    runtime.dispose();
  });

  it("does not let an app rebaseline clear or replace workspace request caches", async () => {
    const requestInput = createRequestUserInputRequest({ requestId: "rui-workspace" });
    const approval = createRuntimeApprovalRequest({ requestId: "apr-workspace" });
    const harness = createFakeRpc({
      sessions: [],
      surfaces: [],
      requestUserInputRequests: [requestInput],
      runtimeApprovalRequests: [approval],
    });
    const runtime = await createRuntime(harness);
    const rebaselinesBefore = harness.requestCounts.rebaselineStateReadModels;
    harness.setRebaselineResult({
      app: [],
      workspaces: [
        { kind: "requestInput", value: { requests: [] } },
        { kind: "approvals", value: { requests: [] } },
      ],
      revision: 4 as StateRevision,
    });

    harness.emitDesktopNotification({
      kind: "read-model-rebaseline-required",
      reason: "event-sequence-gap",
      rebaselineRequired: true,
      scope: { kind: "app" },
    });

    await waitFor(() => harness.requestCounts.rebaselineStateReadModels === rebaselinesBefore + 1);
    expect(runtime.getRequestUserInputRequests()).toEqual([requestInput]);
    expect(runtime.getRuntimeApprovalRequests()).toEqual([approval]);
    runtime.dispose();
  });

  it("tracks app log summaries, live updates, static logs panes, and mark-seen requests", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);

    const entry: AppLogEntry = {
      id: "app-log-1",
      seq: 1,
      createdAt: "2026-05-13T10:00:00.000Z",
      level: "error",
      source: "prompt",
      message: "Prompt failed",
      workspaceSessionId: "session-1",
      surfacePiSessionId: "session-1",
    };
    harness.emitAppLogUpdate({
      workspaceId: TEST_WORKSPACE_INFO.workspaceId,
      entries: [entry],
      summary: {
        latestSeq: 1,
        seenSeq: 0,
        unread: { total: 1, debug: 0, info: 0, warn: 0, error: 1 },
        totals: { total: 1, debug: 0, info: 0, warn: 0, error: 1 },
      },
    });

    await waitFor(() => runtime.appLogSummary.unread.error === 1);
    expect(runtime.appLogSummary.unread.error).toBe(1);
    await runtime.openSurface({ surface: "app-logs" }, "primary");
    expect(runtime.getPane("primary")?.target).toEqual({ surface: "app-logs" });
    expect(await runtime.getAppLogs()).toMatchObject({ entries: [entry] });

    await runtime.markAppLogsSeen(1);
    expect(harness.appLogSeenRequests).toEqual([1]);
    expect(runtime.appLogSummary.unread.total).toBe(0);

    runtime.dispose();
  });

  it("caches app-scoped app logs without replacing workspace logs or unread state", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);
    const entry: AppLogEntry = {
      id: "app-log-workspace-error",
      seq: 1,
      createdAt: "2026-07-10T10:00:00.000Z",
      level: "error",
      source: "workspace",
      message: "Workspace failure",
    };
    const appGlobalEntry: AppLogEntry = {
      id: "app-log-global-warning",
      seq: 7,
      createdAt: "2026-07-10T10:01:00.000Z",
      level: "warn",
      source: "app.lifecycle",
      message: "Global lifecycle warning",
    };
    harness.setAppGlobalLogs({
      entries: [appGlobalEntry],
      summary: {
        latestSeq: 7,
        seenSeq: 0,
        unread: { total: 1, debug: 0, info: 0, warn: 1, error: 0 },
        totals: { total: 1, debug: 0, info: 0, warn: 1, error: 0 },
      },
    });

    harness.emitAppLogUpdate({
      workspaceId: TEST_WORKSPACE_INFO.workspaceId,
      entries: [entry],
      summary: {
        latestSeq: 1,
        seenSeq: 0,
        unread: { total: 1, debug: 0, info: 0, warn: 0, error: 1 },
        totals: { total: 1, debug: 0, info: 0, warn: 0, error: 1 },
      },
    });
    await waitFor(() => runtime.appLogSummary.unread.error === 1);

    harness.emitDesktopNotification({
      kind: "read-model-changed",
      eventGenerationId: "fake-runtime-event-generation" as never,
      sequence: 2 as never,
      scope: { kind: "app" },
      invalidation: { scope: "app", invalidation: { model: "appLogs" } },
    });
    await waitFor(() => runtime.appGlobalLogsSnapshot?.entries.length === 1);

    expect(runtime.appLogSummary.unread.error).toBe(1);
    expect(await runtime.getAppLogs()).toMatchObject({ entries: [entry] });
    expect(runtime.appGlobalLogsSnapshot).toMatchObject({ entries: [appGlobalEntry] });
    runtime.dispose();
  });

  it("records renderer send telemetry as local structured app logs", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);

    runtime.recordRendererTelemetry({
      eventName: "surface_composer.send.failed",
      correlationId: "composer-submit-test-1",
      level: "error",
      message: "Surface composer send failed before backend handoff completed.",
      workspaceId: TEST_WORKSPACE_INFO.workspaceId,
      workspaceSessionId: "session-1",
      surfacePiSessionId: "session-1",
      details: {
        panelId: "primary",
        textLength: 42,
        trimmedTextLength: 40,
        attachmentCount: 1,
        snippetMentionCount: 2,
      },
      error: {
        name: "Error",
        message: "focus failed",
      },
    });

    expect(runtime.appLogSummary.unread.error).toBe(1);
    const logs = await runtime.getAppLogs({ sources: ["renderer"] });
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]).toMatchObject({
      level: "error",
      source: "renderer",
      message: "Surface composer send failed before backend handoff completed.",
      workspaceSessionId: "session-1",
      surfacePiSessionId: "session-1",
      details: {
        eventName: "surface_composer.send.failed",
        correlationId: "composer-submit-test-1",
        panelId: "primary",
        textLength: 42,
        trimmedTextLength: 40,
        attachmentCount: 1,
        snippetMentionCount: 2,
      },
      error: {
        name: "Error",
        message: "focus failed",
      },
    });
    await Promise.resolve();
    expect(harness.rendererTelemetryRequests).toHaveLength(1);
    expect(harness.rendererTelemetryRequests[0]).toMatchObject({
      workspaceId: TEST_WORKSPACE_INFO.workspaceId,
      eventName: "surface_composer.send.failed",
      level: "error",
      message: "Surface composer send failed before backend handoff completed.",
      correlationId: "composer-submit-test-1",
      target: {
        workspaceSessionId: "session-1",
        surface: "orchestrator",
        surfacePiSessionId: "session-1",
      },
      details: {
        panelId: "primary",
        textLength: 42,
      },
      error: {
        name: "Error",
        message: "focus failed",
      },
    });

    await runtime.markAppLogsSeen(runtime.appLogSummary.latestSeq);
    expect(harness.appLogSeenRequests).toEqual([]);
    expect(runtime.appLogSummary.unread.error).toBe(0);

    runtime.dispose();
  });

  it("ignores app log updates for other workspace runtimes", async () => {
    const harness = createFakeRpc({
      sessions: [createSummary("session-1", "Orchestrator", "main reply")],
      surfaces: [
        createSurfaceSnapshot({
          target: createOrchestratorTarget("session-1"),
          messages: [assistantMessage("main reply")],
        }),
      ],
    });
    const runtime = await createRuntime(harness);

    harness.emitAppLogUpdate({
      workspaceId: "workspace:other",
      entries: [
        {
          id: "other-log-1",
          seq: 1,
          createdAt: "2026-05-13T10:00:00.000Z",
          level: "error",
          source: "prompt",
          message: "Other workspace failed",
        },
      ],
      summary: {
        latestSeq: 1,
        seenSeq: 0,
        unread: { total: 1, debug: 0, info: 0, warn: 0, error: 1 },
        totals: { total: 1, debug: 0, info: 0, warn: 0, error: 1 },
      },
    });

    expect(runtime.appLogSummary.unread.total).toBe(0);

    runtime.dispose();
  });
});
