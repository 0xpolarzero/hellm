import type { AssistantMessageEvent, Message } from "@mariozechner/pi-ai";
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
}

export interface ProviderAuthInfo {
  provider: string;
  hasKey: boolean;
  keyType: AuthKeyType;
  supportsOAuth: boolean;
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
    };
  };
}
