import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectAvailableAgents } from "@smithers-orchestrator/cli/agent-detection";
import type { ChatSession } from "./ChatSession";
import { resolveChatWorkspaceRoot } from "./resolveChatWorkspaceRoot";

const SESSION_FILE = "session.json";

/** Directory holding the persisted chat transcript for a workspace. */
export function chatDir(root: string): string {
  return join(root, ".smithers", "studio-chat");
}

/** Path to the single active chat session for a workspace. */
export function chatSessionPath(root: string): string {
  return join(chatDir(root), SESSION_FILE);
}

/**
 * The first usable agent detected on this machine — the provider chat runs
 * against. Returns null when no agent is usable, so the caller can persist a
 * model-less session that still loads (chat send then fails with a clear
 * runtime error rather than fabricating a reply).
 */
export function detectChatAgentId(root: string): string | null {
  const agents = detectAvailableAgents(process.env, { cwd: root }) as Array<{ id: string; usable: boolean }>;
  return agents.find((agent) => agent.usable)?.id ?? null;
}

function newSession(root: string): ChatSession {
  return {
    sessionId: `studio-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model: detectChatAgentId(root),
    mode: "default",
    blocks: [
      {
        id: "chat-system",
        role: "system",
        content: "Workspace agent ready.",
        timestampMs: Date.now(),
      },
    ],
  };
}

export function coerceSession(value: unknown, root: string): ChatSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || !Array.isArray(record.blocks)) {
    return null;
  }
  return {
    sessionId: record.sessionId,
    model: typeof record.model === "string" ? record.model : detectChatAgentId(root),
    mode: typeof record.mode === "string" ? record.mode : "default",
    blocks: record.blocks as ChatSession["blocks"],
  };
}

/** Persist the session transcript to disk. */
export function saveChatSession(root: string, session: ChatSession): void {
  mkdirSync(chatDir(root), { recursive: true });
  writeFileSync(chatSessionPath(root), `${JSON.stringify(session, null, 2)}\n`);
}

/**
 * Load the workspace's active chat session, lazily creating + persisting one on
 * first access. Backed by a real file in the workspace; no in-memory fakery.
 */
export function loadChatSession(): ChatSession {
  const root = resolveChatWorkspaceRoot();
  const path = chatSessionPath(root);
  if (existsSync(path)) {
    try {
      const parsed = coerceSession(JSON.parse(readFileSync(path, "utf8")) as unknown, root);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Corrupt/partial session.json on disk: fall through to a fresh session +
      // save (self-heal). Mirrors the guarded parse in streamChatMessage.ts so a
      // bad file never throws after ndjson headers have been sent (which would
      // surface as a silent empty chat).
    }
  }
  const session = newSession(root);
  saveChatSession(root, session);
  return session;
}
