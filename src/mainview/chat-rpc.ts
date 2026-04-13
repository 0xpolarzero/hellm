import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessageEvent, Message } from "@mariozechner/pi-ai";
import type { PromptHistoryEntry } from "./prompt-history";
import type { CustomProvider } from "./chat-storage";
import type { ChatDefaults, ReasoningEffort } from "./chat-settings";

export type AuthKeyType = "apikey" | "oauth" | "env" | "none";

export interface SendPromptRequest {
  streamId: string;
  messages: Message[];
  provider?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sessionId?: string;
  systemPrompt?: string;
}

export interface SendPromptResponse {
  sessionId: string;
}

export interface SetSessionModelRequest {
  sessionId: string;
  model: string;
}

export interface SetSessionThoughtLevelRequest {
  sessionId: string;
  level: ReasoningEffort;
}

export interface StreamEventMessage {
  streamId: string;
  event: AssistantMessageEvent;
}

export interface CancelPromptRequest {
  sessionId: string;
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
}

export interface ActiveSessionState {
  session: WorkspaceSessionSummary;
  messages: AgentMessage[];
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  systemPrompt: string;
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
      createSession: {
        params: CreateSessionRequest;
        response: ActiveSessionState;
      };
      openSession: {
        params: OpenSessionRequest;
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
      getE2eRendererSeed: {
        params: undefined;
        response: {
          customProviders: CustomProvider[];
          promptHistory: PromptHistoryEntry[];
        } | null;
      };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      sendStreamEvent: StreamEventMessage;
    };
  };
}
