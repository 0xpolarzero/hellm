import type {
  ActiveSessionState,
  CreateSessionRequest,
  ForkSessionRequest,
  ListSessionsResponse,
  SessionMutationResponse,
} from "../mainview/chat-rpc";
import { WorkspaceSessionCatalog, type SendAgentPromptOptions, type SessionDefaults } from "./session-catalog";

const workspaceSessionCatalog = new WorkspaceSessionCatalog();

export async function initPiHost(): Promise<void> {}

export async function disposePiHost(): Promise<void> {
  await workspaceSessionCatalog.dispose();
}

export async function listWorkspaceSessions(): Promise<ListSessionsResponse> {
  return workspaceSessionCatalog.listSessions();
}

export async function getActiveWorkspaceSession(): Promise<ActiveSessionState | null> {
  return workspaceSessionCatalog.getActiveSession();
}

export async function createWorkspaceSession(
  request: CreateSessionRequest,
  defaults: SessionDefaults,
): Promise<ActiveSessionState> {
  return workspaceSessionCatalog.createSession(request, defaults);
}

export async function openWorkspaceSession(
  sessionId: string,
  systemPrompt?: string,
): Promise<ActiveSessionState> {
  return workspaceSessionCatalog.openSession(sessionId, systemPrompt);
}

export async function renameWorkspaceSession(
  sessionId: string,
  title: string,
): Promise<SessionMutationResponse> {
  return workspaceSessionCatalog.renameSession(sessionId, title);
}

export async function forkWorkspaceSession(
  request: ForkSessionRequest,
  defaults: SessionDefaults,
): Promise<ActiveSessionState> {
  return workspaceSessionCatalog.forkSession(request, defaults);
}

export async function deleteWorkspaceSession(
  sessionId: string,
  defaults: SessionDefaults,
): Promise<SessionMutationResponse> {
  return workspaceSessionCatalog.deleteSession(sessionId, defaults);
}

export async function sendAgentPrompt(options: SendAgentPromptOptions): Promise<{ sessionId: string }> {
  return workspaceSessionCatalog.sendPrompt(options);
}

export async function cancelAgentSession(sessionId: string): Promise<void> {
  return workspaceSessionCatalog.cancelPrompt(sessionId);
}

export async function setSessionModel(
  sessionId: string,
  model: string,
): Promise<{ ok: boolean; sessionId: string }> {
  return workspaceSessionCatalog.setSessionModel(sessionId, model);
}

export async function setSessionThoughtLevel(
  sessionId: string,
  level: SessionDefaults["thinkingLevel"],
): Promise<{ ok: boolean; sessionId: string }> {
  return workspaceSessionCatalog.setSessionThoughtLevel(sessionId, level);
}
