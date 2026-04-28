import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessageEvent, Message } from "@mariozechner/pi-ai";
import type {
  AgentDefaults,
  AgentSettingsState,
  ReasoningEffort,
  SessionAgentKey,
  SessionAgentSettings,
  SessionMode,
  WorkflowAgentKey,
  WorkflowAgentSettings,
} from "./agent-settings";

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

export interface CloseSurfaceRequest {
  target: PromptTarget;
}

export interface SetSurfaceModelRequest {
  target: PromptTarget;
  model: string;
  provider: string;
}

export interface SetSurfaceThoughtLevelRequest {
  target: PromptTarget;
  level: ReasoningEffort;
}

export interface StreamEventMessage {
  streamId: string;
  event: AssistantMessageEvent;
}

export interface WorkspaceSyncMessage {
  reason: "workspace.updated" | "structured.updated";
  sessions: WorkspaceSessionSummary[];
  navigation: WorkspaceSessionNavigationReadModel;
}

export interface CancelPromptRequest {
  target: PromptTarget;
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
  workflowTaskAttemptId?: string | null;
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
  sourceCommandId?: string;
  workflowRunId?: string;
  workflowName?: string;
  producerLabel?: string;
  missingFile?: boolean;
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
  workflowTaskAttemptId?: string | null;
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
  artifacts: WorkspaceCommandArtifactLink[];
}

export interface WorkspaceHandlerThreadEpisodeSummary {
  episodeId: string;
  kind: "analysis" | "change" | "workflow" | "clarification";
  title: string;
  summary: string;
  createdAt: string;
}

export interface WorkspaceProjectCiRunSummary {
  ciRunId: string;
  workflowRunId: string;
  workflowId: string;
  status: "passed" | "failed" | "blocked" | "cancelled";
  summary: string;
  updatedAt: string;
}

export type WorkspaceProjectCiPanelStatus =
  | "not-configured"
  | "configured"
  | "running"
  | WorkspaceProjectCiRunSummary["status"];

export type WorkspaceProjectCiCheckStatus = WorkspaceProjectCiRunSummary["status"] | "skipped";

export interface WorkspaceProjectCiEntrySummary {
  workflowId: string;
  label: string;
  summary: string;
  sourceScope: "saved" | "artifact";
  entryPath: string;
}

export interface WorkspaceProjectCiActiveWorkflowSummary {
  workflowRunId: string;
  workflowId: string;
  entryPath: string | null;
  threadId: string;
  threadTitle: string;
  status: "running" | "waiting";
  summary: string;
  updatedAt: string;
}

export interface WorkspaceProjectCiCheckSummary {
  checkResultId: string;
  checkId: string;
  label: string;
  kind: string;
  status: WorkspaceProjectCiCheckStatus;
  required: boolean;
  command: string[] | null;
  exitCode: number | null;
  summary: string;
  artifactIds: string[];
  artifacts: WorkspaceCommandArtifactLink[];
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface WorkspaceProjectCiRunDetail extends WorkspaceProjectCiRunSummary {
  threadId: string;
  threadTitle: string;
  smithersRunId: string;
  entryPath: string;
  startedAt: string;
  finishedAt: string;
}

export interface WorkspaceProjectCiStatusPanel {
  status: WorkspaceProjectCiPanelStatus;
  summary: string;
  entries: WorkspaceProjectCiEntrySummary[];
  activeWorkflowRun: WorkspaceProjectCiActiveWorkflowSummary | null;
  latestRun: WorkspaceProjectCiRunDetail | null;
  checks: WorkspaceProjectCiCheckSummary[];
  checkCounts: Record<WorkspaceProjectCiCheckStatus, number> & {
    total: number;
  };
  updatedAt: string | null;
}

export interface WorkspaceWorkflowTaskAttemptTranscriptMessage {
  messageId: string;
  role: "user" | "assistant" | "stderr";
  source: "prompt" | "event" | "responseText";
  text: string;
  createdAt: string;
}

export interface WorkspaceWorkflowTaskAttemptSummary {
  workflowTaskAttemptId: string;
  workflowRunId: string;
  smithersRunId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  title: string;
  kind: "agent" | "compute" | "static" | "unknown";
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  summary: string;
  updatedAt: string;
  commandCount: number;
  artifactCount: number;
  transcriptMessageCount: number;
}

export interface WorkspaceWorkflowTaskAttemptInspector extends WorkspaceWorkflowTaskAttemptSummary {
  surfacePiSessionId: string | null;
  smithersState: string;
  prompt: string | null;
  responseText: string | null;
  error: string | null;
  cached: boolean;
  jjPointer: string | null;
  jjCwd: string | null;
  heartbeatAt: string | null;
  agentId: string | null;
  agentModel: string | null;
  agentEngine: string | null;
  agentResume: string | null;
  meta: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
  transcript: WorkspaceWorkflowTaskAttemptTranscriptMessage[];
  commandRollups: WorkspaceCommandRollup[];
  artifacts: WorkspaceCommandArtifactLink[];
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
  workflowTaskAttemptCount?: number;
  episodeCount: number;
  artifactCount: number;
  ciRunCount: number;
  loadedContextKeys: string[];
  latestWorkflowRun: WorkspaceHandlerThreadWorkflowSummary | null;
  latestCiRun: WorkspaceProjectCiRunSummary | null;
  latestEpisode: WorkspaceHandlerThreadEpisodeSummary | null;
  workflowTaskAttempts?: WorkspaceWorkflowTaskAttemptSummary[];
}

export interface WorkspaceHandlerThreadInspector extends WorkspaceHandlerThreadSummary {
  commandRollups: WorkspaceCommandRollup[];
  workflowRuns: WorkspaceHandlerThreadWorkflowSummary[];
  workflowTaskAttempts?: WorkspaceWorkflowTaskAttemptSummary[];
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
  isPinned: boolean;
  pinnedAt: string | null;
  isArchived: boolean;
  archivedAt: string | null;
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
    ciRuns: number;
    ciChecks: number;
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

export interface WorkspaceSessionNavigationReadModel {
  pinnedSessions: WorkspaceSessionSummary[];
  activeSessions: WorkspaceSessionSummary[];
  archived: {
    collapsed: boolean;
    sessions: WorkspaceSessionSummary[];
  };
}

export interface WorkspaceArtifactPreview {
  artifactId: string;
  sessionId: string;
  kind: WorkspaceCommandArtifactLink["kind"];
  name: string;
  path?: string;
  createdAt: string;
  sourceCommandId?: string;
  workflowRunId?: string;
  workflowName?: string;
  producerLabel?: string;
  missingFile: boolean;
  content: string;
}

export interface ConversationSurfaceSnapshot {
  target: PromptTarget;
  messages: AgentMessage[];
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sessionMode: SessionMode;
  sessionAgentKey: SessionAgentKey;
  systemPrompt: string;
  resolvedSystemPrompt: string;
  promptStatus: "idle" | "streaming";
}

export interface SurfaceSyncMessage {
  reason: "surface.updated" | "prompt.settled" | "background.started" | "surface.closed";
  target: PromptTarget;
  snapshot?: ConversationSurfaceSnapshot;
}

export interface ListSessionsResponse {
  sessions: WorkspaceSessionSummary[];
  navigation: WorkspaceSessionNavigationReadModel;
}

export interface CreateSessionRequest {
  title?: string;
  parentSessionId?: string;
  mode?: SessionMode;
}

export interface UpdateSessionAgentDefaultRequest {
  key: SessionAgentKey;
  settings: SessionAgentSettings;
}

export interface UpdateWorkflowAgentRequest {
  key: WorkflowAgentKey;
  settings: WorkflowAgentSettings;
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

export interface WorkspaceMutationResponse {
  ok: boolean;
}

export interface SurfaceMutationResponse {
  ok: boolean;
  target: PromptTarget;
}

export interface ChatRPCSchema {
  bun: {
    requests: {
      getDefaults: {
        params: undefined;
        response: AgentDefaults;
      };
      getAgentSettings: {
        params: undefined;
        response: AgentSettingsState;
      };
      updateSessionAgentDefault: {
        params: UpdateSessionAgentDefaultRequest;
        response: AgentSettingsState;
      };
      updateWorkflowAgent: {
        params: UpdateWorkflowAgentRequest;
        response: AgentSettingsState;
      };
      ensureWorkflowAgentsComponent: {
        params: undefined;
        response: { path: string };
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
      getWorkflowTaskAttemptInspector: {
        params: { sessionId: string; workflowTaskAttemptId: string };
        response: WorkspaceWorkflowTaskAttemptInspector | null;
      };
      getProjectCiStatus: {
        params: { sessionId: string };
        response: WorkspaceProjectCiStatusPanel;
      };
      getArtifactPreview: {
        params: { sessionId: string; artifactId: string };
        response: WorkspaceArtifactPreview;
      };
      createSession: {
        params: CreateSessionRequest;
        response: ConversationSurfaceSnapshot;
      };
      openSession: {
        params: OpenSessionRequest;
        response: ConversationSurfaceSnapshot;
      };
      recordSessionOpened: {
        params: OpenSessionRequest;
        response: WorkspaceMutationResponse;
      };
      openSurface: {
        params: OpenSurfaceRequest;
        response: ConversationSurfaceSnapshot;
      };
      closeSurface: {
        params: CloseSurfaceRequest;
        response: WorkspaceMutationResponse;
      };
      renameSession: {
        params: RenameSessionRequest;
        response: WorkspaceMutationResponse;
      };
      forkSession: {
        params: ForkSessionRequest;
        response: ConversationSurfaceSnapshot;
      };
      deleteSession: {
        params: { sessionId: string };
        response: WorkspaceMutationResponse;
      };
      pinSession: {
        params: { sessionId: string };
        response: WorkspaceMutationResponse;
      };
      unpinSession: {
        params: { sessionId: string };
        response: WorkspaceMutationResponse;
      };
      archiveSession: {
        params: { sessionId: string };
        response: WorkspaceMutationResponse;
      };
      unarchiveSession: {
        params: { sessionId: string };
        response: WorkspaceMutationResponse;
      };
      setArchivedGroupCollapsed: {
        params: { collapsed: boolean };
        response: WorkspaceMutationResponse;
      };
      sendPrompt: {
        params: SendPromptRequest;
        response: SendPromptResponse;
      };
      setSurfaceModel: {
        params: SetSurfaceModelRequest;
        response: SurfaceMutationResponse;
      };
      setSurfaceThoughtLevel: {
        params: SetSurfaceThoughtLevelRequest;
        response: SurfaceMutationResponse;
      };
      cancelPrompt: {
        params: CancelPromptRequest;
        response: WorkspaceMutationResponse;
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
      sendWorkspaceSync: WorkspaceSyncMessage;
      sendSurfaceSync: SurfaceSyncMessage;
    };
  };
}
