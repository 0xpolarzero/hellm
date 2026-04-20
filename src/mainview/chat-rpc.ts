import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessageEvent, Message } from "@mariozechner/pi-ai";
import type { ChatDefaults, ReasoningEffort } from "./chat-settings";

export type AuthKeyType = "apikey" | "oauth" | "env" | "none";
export type PromptSurfaceKind = "orchestrator" | "thread";

export interface PromptTarget {
  workspaceSessionId: string;
  surface: PromptSurfaceKind;
  surfacePiSessionId: string;
  threadId?: string;
}

export interface SendPromptRequest {
  streamId: string;
  messages: Message[];
  provider?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  target: PromptTarget;
  systemPrompt?: string;
}

export interface SendPromptResponse {
  target: PromptTarget;
}

export interface SetSessionModelRequest {
  surfacePiSessionId: string;
  model: string;
}

export interface SetSessionThoughtLevelRequest {
  surfacePiSessionId: string;
  level: ReasoningEffort;
}

export interface StreamEventMessage {
  streamId: string;
  event: AssistantMessageEvent;
}

export interface SessionSyncMessage {
  reason: "prompt.settled" | "background.started" | "structured.updated";
  activeSession: ActiveSessionState;
  sessions: WorkspaceSessionSummary[];
}

export interface CancelPromptRequest {
  surfacePiSessionId: string;
}

export interface ProviderAuthStateRequest {
  providerId?: string;
}

export interface AuthStateResponse {
  connected: boolean;
  accountId?: string;
  message?: string;
}

export interface WorkspaceInfoResponse {
  workspaceId: string;
  workspaceLabel: string;
  branch?: string;
}

export interface ProviderAuthInfo {
  provider: string;
  hasKey: boolean;
  keyType: AuthKeyType;
  supportsOAuth: boolean;
}

export type SessionStatus = "idle" | "running" | "waiting" | "error";

export interface WorkspaceCommandRollupChild {
  commandId: string;
  toolName: string;
  status: "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  title: string;
  summary: string;
  error: string | null;
}

export interface WorkspaceCommandRollup {
  commandId: string;
  threadId: string | null;
  workflowRunId?: string | null;
  toolName: string;
  visibility: "summary" | "surface";
  status: "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  title: string;
  summary: string;
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: WorkspaceCommandRollupChild[];
  updatedAt: string;
}

export interface WorkspaceCommandArtifactLink {
  artifactId: string;
  kind: "text" | "log" | "json" | "file";
  name: string;
  path?: string;
  createdAt: string;
}

export interface WorkspaceCommandInspectorChild extends WorkspaceCommandRollupChild {
  visibility: "trace" | "summary" | "surface";
  facts: Record<string, unknown> | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  artifacts: WorkspaceCommandArtifactLink[];
}

export interface WorkspaceCommandInspector {
  commandId: string;
  threadId: string | null;
  workflowRunId?: string | null;
  toolName: string;
  visibility: "trace" | "summary" | "surface";
  status: "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  title: string;
  summary: string;
  facts: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  artifacts: WorkspaceCommandArtifactLink[];
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: WorkspaceCommandInspectorChild[];
  traceChildren: WorkspaceCommandInspectorChild[];
}

export interface WorkspaceHandlerThreadWorkflowSummary {
  workflowRunId: string;
  workflowName: string;
  status: "running" | "waiting" | "continued" | "completed" | "failed" | "cancelled";
  summary: string;
  updatedAt: string;
}

export interface WorkspaceHandlerThreadEpisodeSummary {
  episodeId: string;
  kind: "analysis" | "change" | "verification" | "workflow" | "clarification";
  title: string;
  summary: string;
  createdAt: string;
}

export interface WorkspaceHandlerThreadSummary {
  threadId: string;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  status: "running-handler" | "running-workflow" | "waiting" | "troubleshooting" | "completed";
  wait: {
    owner: "handler" | "workflow";
    kind: "user" | "external" | "approval" | "signal" | "timer";
    reason: string;
    resumeWhen: string;
    since: string;
  } | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  commandCount: number;
  workflowRunCount: number;
  episodeCount: number;
  artifactCount: number;
  verificationCount: number;
  latestWorkflowRun: WorkspaceHandlerThreadWorkflowSummary | null;
  latestEpisode: WorkspaceHandlerThreadEpisodeSummary | null;
}

export interface WorkspaceHandlerThreadInspector extends WorkspaceHandlerThreadSummary {
  commandRollups: WorkspaceCommandRollup[];
  workflowRuns: WorkspaceHandlerThreadWorkflowSummary[];
  episodes: WorkspaceHandlerThreadEpisodeSummary[];
  artifacts: WorkspaceCommandArtifactLink[];
}

export interface WorkspaceSessionSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  status: SessionStatus;
  sessionFile?: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  modelId?: string;
  provider?: string;
  thinkingLevel?: string;
  wait?: {
    threadId?: string;
    kind: "user" | "external" | "approval" | "signal" | "timer";
    reason: string;
    resumeWhen: string;
    since: string;
  } | null;
  counts?: {
    turns: number;
    threads: number;
    commands: number;
    episodes: number;
    verifications: number;
    workflows: number;
    artifacts: number;
    events: number;
  };
  threadIdsByStatus?: {
    runningHandler: string[];
    runningWorkflow: string[];
    waiting: string[];
    troubleshooting: string[];
  };
  threadIds?: string[];
  commandRollups?: WorkspaceCommandRollup[];
}

export interface ActiveSessionState {
  session: WorkspaceSessionSummary;
  target: PromptTarget;
  messages: AgentMessage[];
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  systemPrompt: string;
  resolvedSystemPrompt: string;
}

export interface ListSessionsResponse {
  activeSessionId?: string;
  sessions: WorkspaceSessionSummary[];
}

export interface CreateSessionRequest {
  title?: string;
  parentSessionId?: string;
}

export interface OpenSessionRequest {
  sessionId: string;
}

export interface OpenSurfaceRequest {
  target: PromptTarget;
}

export interface RenameSessionRequest {
  sessionId: string;
  title: string;
}

export interface ForkSessionRequest {
  sessionId: string;
  title?: string;
}

export interface SessionMutationResponse {
  ok: boolean;
  activeSessionId?: string;
  activeSession?: ActiveSessionState | null;
}

export interface ChatRPCSchema {
  bun: {
    requests: {
      getDefaults: {
        params: undefined;
        response: ChatDefaults;
      };
      getProviderAuthState: {
        params: ProviderAuthStateRequest;
        response: AuthStateResponse;
      };
      getWorkspaceInfo: {
        params: undefined;
        response: WorkspaceInfoResponse;
      };
      listSessions: {
        params: undefined;
        response: ListSessionsResponse;
      };
      getActiveSession: {
        params: undefined;
        response: ActiveSessionState | null;
      };
      getCommandInspector: {
        params: { sessionId: string; commandId: string };
        response: WorkspaceCommandInspector | null;
      };
      listHandlerThreads: {
        params: { sessionId: string };
        response: WorkspaceHandlerThreadSummary[];
      };
      getHandlerThreadInspector: {
        params: { sessionId: string; threadId: string };
        response: WorkspaceHandlerThreadInspector | null;
      };
      createSession: {
        params: CreateSessionRequest;
        response: ActiveSessionState;
      };
      openSession: {
        params: OpenSessionRequest;
        response: ActiveSessionState;
      };
      openSurface: {
        params: OpenSurfaceRequest;
        response: ActiveSessionState;
      };
      renameSession: {
        params: RenameSessionRequest;
        response: SessionMutationResponse;
      };
      forkSession: {
        params: ForkSessionRequest;
        response: ActiveSessionState;
      };
      deleteSession: {
        params: { sessionId: string };
        response: SessionMutationResponse;
      };
      sendPrompt: {
        params: SendPromptRequest;
        response: SendPromptResponse;
      };
      setSessionModel: {
        params: SetSessionModelRequest;
        response: { ok: boolean; sessionId: string };
      };
      setSessionThoughtLevel: {
        params: SetSessionThoughtLevelRequest;
        response: { ok: boolean; sessionId: string };
      };
      cancelPrompt: {
        params: CancelPromptRequest;
        response: { ok: boolean };
      };
      listProviderAuths: {
        params: undefined;
        response: ProviderAuthInfo[];
      };
      setProviderApiKey: {
        params: { providerId: string; apiKey: string };
        response: { ok: boolean };
      };
      startOAuth: {
        params: { providerId: string };
        response: { ok: boolean; error?: string };
      };
      removeProviderAuth: {
        params: { providerId: string };
        response: { ok: boolean };
      };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      sendStreamEvent: StreamEventMessage;
      sendSessionSync: SessionSyncMessage;
    };
  };
}
