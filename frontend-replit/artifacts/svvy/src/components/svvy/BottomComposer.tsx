import { useState, useRef } from "react";
import { ArrowUp, Square, AtSign, ChevronUp, ChevronDown, GitBranch, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContextBudgetBar } from "./ContextBudgetBar";
import { MentionChip } from "./MentionChip";
import { ModelBadge } from "./ModelBadge";
import { mockMentionTargets, mockWorkspace, mockRuntimeProfiles } from "@/data/mock";

interface BottomComposerProps {
  budgetPercent?: number;
  isStreaming?: boolean;
  onSend?: (text: string) => void;
  onStop?: () => void;
  sessionName?: string;
  worktree?: string;
}

export function BottomComposer({
  budgetPercent = 42,
  isStreaming = false,
  onSend,
  onStop,
  sessionName = "OAuth Provider Integration",
  worktree = "feat/oauth-provider",
}: BottomComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState(mockMentionTargets.map(({ path, isFolder }) => ({ path, isFolder })));
  const [showProfiles, setShowProfiles] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (text.trim() && onSend) {
      onSend(text);
      setText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const removeMention = (path: string) => {
    setMentions(prev => prev.filter(m => m.path !== path));
  };

  return (
    <div
      className={cn(
        "flex-shrink-0 border-t border-border bg-card transition-all duration-150",
      )}
      data-testid="bottom-composer"
    >
      {/* Expanded: mention chips + profiles */}
      {expanded && (
        <div className="border-b border-border px-3 py-2 flex flex-wrap gap-1.5">
          {mentions.map(m => (
            <MentionChip
              key={m.path}
              path={m.path}
              isFolder={m.isFolder}
              onRemove={() => removeMention(m.path)}
            />
          ))}
          <button
            className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            data-testid="btn-add-mention"
          >
            <AtSign className="w-2.5 h-2.5" />
            Add context
          </button>
        </div>
      )}

      {/* Main input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {!expanded && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            title="Add @mention"
            data-testid="btn-mention"
          >
            <AtSign className="w-3.5 h-3.5" />
          </button>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={handleKeyDown}
          placeholder={expanded ? "Describe what you want to accomplish..." : "Send a message or instruction..."}
          rows={expanded ? 3 : 1}
          className={cn(
            "flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground",
            "outline-none border-none focus:ring-0 py-0.5 leading-relaxed scrollbar-thin",
            !expanded && "max-h-6 overflow-hidden"
          )}
          data-testid="composer-input"
        />

        <div className="flex items-center gap-2 flex-shrink-0">
          {!expanded && (
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                opus
              </span>
              <ContextBudgetBar percent={budgetPercent} />
            </div>
          )}

          <button
            onClick={() => setExpanded(e => !e)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="btn-expand-composer"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>

          {isStreaming ? (
            <button
              onClick={onStop}
              className="w-7 h-7 flex items-center justify-center rounded bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 transition-colors"
              title="Stop"
              data-testid="btn-stop"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded transition-colors",
                text.trim()
                  ? "bg-orange-500 text-white hover:bg-orange-600"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
              title="Send"
              data-testid="btn-send"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded: bottom status bar */}
      {expanded && (
        <div className="border-t border-border px-3 py-1.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 truncate">
              {mockWorkspace.displayName}
            </span>
            <span className="text-border">/</span>
            <span className="font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 max-w-28 truncate">
              {sessionName}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-0.5 border border-border rounded px-1.5 py-0.5">
              <GitBranch className="w-2 h-2" />
              {worktree}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <ContextBudgetBar percent={budgetPercent} showLabel width="w-32" />

            <button
              onClick={() => setShowProfiles(p => !p)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="btn-runtime-profiles"
            >
              <Layers className="w-3 h-3" />
              <span>opus + 5</span>
              {showProfiles ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronUp className="w-2.5 h-2.5" />}
            </button>
          </div>
        </div>
      )}

      {expanded && mentions.length > 0 && (
        <div className="border-t border-border px-3 py-1.5 flex flex-wrap gap-1.5">
          {mockMentionTargets
            .filter(target => mentions.some(mention => mention.path === target.path))
            .map(target => (
              <span
                key={target.path}
                className="font-mono text-[9px] text-muted-foreground border border-border rounded px-1.5 py-0.5"
              >
                {target.path} → {target.resolvedPath}
              </span>
            ))}
        </div>
      )}

      {/* Profile accordion */}
      {expanded && showProfiles && (
        <div className="border-t border-border px-3 py-2 grid grid-cols-2 gap-1">
          {mockRuntimeProfiles.map(p => (
            <div
              key={p.role}
              className="flex items-center justify-between px-2 py-1 rounded bg-muted/40"
              data-testid={`profile-row-${p.role.toLowerCase()}`}
            >
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground block">{p.role}</span>
                <span className="font-mono text-[9px] text-muted-foreground/70">{p.provider}</span>
              </div>
              <ModelBadge model={p.model} size="xs" />
            </div>
          ))}
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="border-t border-border px-3 py-1.5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 pulse-dot" />
          <span className="text-[11px] text-muted-foreground">Orchestrator is working...</span>
          <span className="font-mono text-[10px] text-muted-foreground">68% context used</span>
        </div>
      )}
    </div>
  );
}
