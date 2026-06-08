import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatBlockView } from "./ChatBlockView";
import { useAgentChat } from "./useAgentChat";

// Treat the viewer as "at the bottom" within this many pixels, so sub-pixel
// rounding and a final streamed line never break the auto-pin.
const AUTOSCROLL_THRESHOLD_PX = 40;

/**
 * The agent-chat half of the Workspace surface. A message list with
 * markdown/code rendering, a model/mode indicator, streaming responses, and a
 * composer. Wired to the real agent runtime through the chatApi HTTP seam (see
 * chatApi.ts) — no static transcripts.
 */
export function AgentChat({ active }: { active: boolean }) {
  const { status, error, blocks, model, mode, send } = useAgentChat(active);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // True while the viewer is parked at the bottom of the transcript. Starts true
  // so the first populated render lands at the newest block.
  const pinnedRef = useRef(true);

  // Pin to the newest block as the transcript grows or streams — but only when
  // the viewer is already at the bottom. If they've scrolled up to read earlier
  // turns mid-stream, don't yank them back down (a calm console, per .smithers/specs/UX.md).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [blocks]);

  function handleListScroll() {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    pinnedRef.current = distanceFromBottom <= AUTOSCROLL_THRESHOLD_PX;
  }

  useEffect(() => {
    if (active) textareaRef.current?.focus();
  }, [active]);

  const streaming = status === "streaming";

  function submit() {
    const value = draft.trim();
    if (!value || streaming) return;
    send(value);
    setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div aria-label="Agent chat" className="ws-chat" data-testid="agent-chat" role="group">
      <div className="ws-chat-bar">
        <span className="ws-chat-indicator" data-testid="chat-model">
          <span className="ws-chat-dot" data-streaming={streaming ? "true" : undefined} />
          {model ?? "Agent"}
        </span>
        {mode && (
          <span className="ws-chat-mode" data-testid="chat-mode">
            {mode}
          </span>
        )}
      </div>

      <div className="ws-chat-list" data-testid="chat-list" onScroll={handleListScroll} ref={listRef}>
        {status === "loading" && (
          <p className="ws-chat-state" data-testid="chat-loading" role="status">
            Connecting to the agent runtime…
          </p>
        )}
        {status === "error" && (
          <p className="ws-chat-state ws-chat-state--error" data-testid="chat-error" role="alert">
            {error ?? "The agent runtime is unavailable."}
          </p>
        )}
        {status !== "loading" && blocks.length === 0 && (
          <p className="ws-chat-state" data-testid="chat-empty">
            No messages yet. Ask the agent to get started.
          </p>
        )}
        {blocks.map((block) => (
          <ChatBlockView block={block} key={block.id} />
        ))}
      </div>

      <form
        className="ws-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Message the agent"
          className="ws-chat-input"
          data-testid="chat-input"
          disabled={status === "loading" || status === "error"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message the agent…  (Enter to send, Shift+Enter for newline)"
          ref={textareaRef}
          rows={2}
          value={draft}
        />
        <button
          className="ws-chat-send"
          data-testid="chat-send"
          disabled={streaming || draft.trim().length === 0 || status === "loading" || status === "error"}
          type="submit"
        >
          {streaming ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
