/**
 * The agent-chat session model the Workspace chat surface consumes.
 *
 * Mirrors `src/workspace/chatApi.ts`'s `ChatSession` / `ChatBlock` exactly so
 * the real backend and the frontend agree on the wire shape. Sessions are
 * persisted per-workspace as JSON under `.smithers/studio-chat/` so a chat
 * survives a reload and the assistant turns are real transcript records.
 */

export type ChatRole = "user" | "assistant" | "agent" | "system" | "tool" | "tool_result" | "stderr";

export type ChatBlock = {
  id: string;
  role: ChatRole;
  content: string;
  timestampMs: number | null;
  /** True while an assistant block is still streaming tokens in. */
  pending?: boolean;
};

export type ChatSession = {
  sessionId: string;
  /** Provider/model the agent is running, e.g. "claude". */
  model: string | null;
  /** Agent mode, e.g. "default". */
  mode: string | null;
  blocks: ChatBlock[];
};
