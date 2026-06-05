import type { ChatBlock, ChatRole } from "./chatApi";
import { MarkdownContent } from "./MarkdownContent";

/**
 * One chat transcript block, styled per role. Ported from the gui POC
 * ChatBlockRenderer.swift: assistant gets an accent-bordered bubble, user a
 * quiet success-tinted bubble, tool/tool_result/stderr a compact mono treatment.
 */
export function ChatBlockView({ block }: { block: ChatBlock }) {
  const role = normalizeRole(block.role);
  const meta = ROLE_META[role];
  const empty = block.content.trim().length === 0;

  return (
    <div
      className={`ws-chat-block ws-chat-block--${meta.variant}`}
      data-pending={block.pending ? "true" : undefined}
      data-role={role}
      data-testid="chat-block"
    >
      <div className="ws-chat-block-header">
        <span className="ws-chat-block-label" style={{ color: meta.color }}>
          {meta.label}
        </span>
        {block.timestampMs != null && (
          <time className="ws-chat-block-time">{formatTime(block.timestampMs)}</time>
        )}
      </div>
      <div className="ws-chat-block-body">
        {empty && block.pending ? (
          <span
            aria-label="Agent is responding"
            className="ws-chat-typing"
            data-testid="chat-typing"
            role="status"
          >
            <i />
            <i />
            <i />
          </span>
        ) : empty ? (
          <span className="ws-chat-empty">[empty]</span>
        ) : meta.mono ? (
          <pre className="ws-chat-mono">{block.content}</pre>
        ) : (
          <MarkdownContent text={block.content} />
        )}
      </div>
    </div>
  );
}

type RoleVariant = "assistant" | "user" | "tool" | "tool_result" | "stderr" | "system";

function normalizeRole(role: ChatRole): RoleVariant {
  const value = role.trim().toLowerCase();
  if (value === "assistant" || value === "agent") return "assistant";
  if (value === "user" || value === "prompt") return "user";
  if (value === "tool" || value === "tool_call") return "tool";
  if (value === "tool_result") return "tool_result";
  if (value === "stderr") return "stderr";
  return "system";
}

const ROLE_META: Record<
  RoleVariant,
  { label: string; color: string; variant: RoleVariant; mono: boolean }
> = {
  assistant: { label: "ASSISTANT", color: "var(--accent)", variant: "assistant", mono: false },
  user: { label: "YOU", color: "var(--success)", variant: "user", mono: false },
  tool: { label: "TOOL", color: "var(--warning)", variant: "tool", mono: true },
  tool_result: { label: "TOOL RESULT", color: "var(--info)", variant: "tool_result", mono: true },
  stderr: { label: "STDERR", color: "var(--danger)", variant: "stderr", mono: true },
  system: { label: "SYSTEM", color: "var(--text-tertiary)", variant: "system", mono: false },
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
