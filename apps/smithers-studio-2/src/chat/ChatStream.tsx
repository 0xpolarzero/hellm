import { useEffect, useRef } from "react";
import type { ChatItem } from "./feed/ChatItem";
import type { Tag } from "./tags/Tag";
import { ChatItemView } from "./ChatItemView";

/**
 * The single scrolling conversation. Auto-scrolls to the newest item when the
 * user is already near the bottom (so reading scrollback isn't interrupted).
 */
export function ChatStream({ items, onTagClick }: { items: ChatItem[]; onTagClick?: (tag: Tag) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div className="chat-stream" data-testid="chat-stream" ref={scrollRef}>
      <div className="chat-stream-inner">
        {items.length === 0 ? (
          <p className="chat-stream-empty">No messages in this project yet. Say hello to your agent.</p>
        ) : (
          items.map((item) => <ChatItemView item={item} key={item.id} onTagClick={onTagClick} />)
        )}
      </div>
    </div>
  );
}
