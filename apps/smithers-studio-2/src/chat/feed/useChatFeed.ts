import { useCallback, useMemo, useState } from "react";
import type { ChatItem } from "./ChatItem";
import { mockChatFeed } from "./mockChatFeed";

export type ChatFeedView = {
  items: ChatItem[];
  /** Send a plain prompt: optimistic user echo + a (seam) assistant reply. */
  send: (text: string) => void;
  /** Append a pre-built item (used when a slash command records what it did). */
  append: (item: ChatItem) => void;
};

/**
 * Drives the single chat feed for a project. SEAM: state is seeded from
 * `mockChatFeed` and `send` appends a canned assistant reply; the real
 * implementation wraps `workspace/useAgentChat` (real chat API) and merges
 * server-written tags. Items are kept for all projects and filtered per call so
 * switching projects preserves each conversation.
 */
export function useChatFeed(projectId: string): ChatFeedView {
  const [all, setAll] = useState<ChatItem[]>(mockChatFeed);

  const append = useCallback((item: ChatItem) => {
    setAll((prev) => [...prev, item]);
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = Date.now();
      const userItem: ChatItem = {
        id: crypto.randomUUID(),
        role: "user",
        projectId,
        timestampMs: now,
        tags: [],
        body: { kind: "markdown", text: trimmed },
      };
      const replyItem: ChatItem = {
        id: crypto.randomUUID(),
        role: "assistant",
        projectId,
        timestampMs: now + 1,
        tags: [{ id: "agent", label: "agent", kind: "topic" }],
        body: {
          kind: "markdown",
          text: "Got it — working on that. (This reply is the seam stand-in until the real chat backend is wired.)",
        },
      };
      setAll((prev) => [...prev, userItem, replyItem]);
    },
    [projectId],
  );

  const items = useMemo(() => all.filter((item) => item.projectId === projectId), [all, projectId]);

  return { items, send, append };
}
