import type { ChatItem, ChatRole } from "./feed/ChatItem";
import type { Tag } from "./tags/Tag";
import { TagChip } from "./tags/TagChip";
import { HtmlContent } from "./feed/HtmlContent";
import { MarkdownContent } from "../workspace/MarkdownContent";
import { useOverlayStore } from "./overlay/overlayStore";

const ROLE_META: Record<ChatRole, { label: string; color: string }> = {
  user: { label: "YOU", color: "var(--success)" },
  assistant: { label: "ASSISTANT", color: "var(--accent)" },
  tool: { label: "TOOL", color: "var(--warning)" },
  system: { label: "SYSTEM", color: "var(--text-tertiary)" },
};

/**
 * One chat item: role header + tags + body. Bodies are markdown (reusing the
 * Workspace markdown renderer), sandboxed agent HTML, or an overlay opener that
 * shows a default UI beside the chat.
 */
export function ChatItemView({ item, onTagClick }: { item: ChatItem; onTagClick?: (tag: Tag) => void }) {
  const meta = ROLE_META[item.role];
  const open = useOverlayStore((s) => s.open);
  const body = item.body;

  return (
    <article className={`chat-item chat-item--${item.role}`} data-role={item.role} data-testid="chat-item">
      <header className="chat-item-head">
        <span className="chat-item-role" style={{ color: meta.color }}>
          {meta.label}
        </span>
        {item.tags.length > 0 && (
          <span className="chat-item-tags">
            {item.tags.map((tag) => (
              <TagChip key={tag.id} onClick={onTagClick} tag={tag} />
            ))}
          </span>
        )}
        <time className="chat-item-time">{formatTime(item.timestampMs)}</time>
      </header>

      <div className="chat-item-body">
        {body.kind === "markdown" && <MarkdownContent text={body.text} />}
        {body.kind === "html" && <HtmlContent html={body.html} />}
        {body.kind === "overlay" && (
          <div className="chat-overlay-card">
            <span className="chat-overlay-summary">{body.summary}</span>
            <button
              className="chat-overlay-open"
              data-testid="chat-overlay-open"
              onClick={() => open(body.overlay, "split")}
              type="button"
            >
              Open {body.overlay.title} ▸
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
