import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch, Clock, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { ModelBadge } from "./ModelBadge";
import { SubagentCard } from "./SubagentCard";
import { usePanes } from "@/hooks/usePanes";
import type { Thread, SubagentItem } from "@/data/mock";

interface ThreadCardProps {
  thread: Thread;
  subagents?: SubagentItem[];
  className?: string;
}

export function ThreadCard({ thread, subagents = [], className }: ThreadCardProps) {
  const [expanded, setExpanded] = useState(true);
  const { openPane } = usePanes();

  const borderColor =
    {
      running: "border-l-orange-500",
      done: "border-l-emerald-500/50",
      waiting: "border-l-amber-500",
      failed: "border-l-red-500",
      idle: "border-l-border",
    }[thread.status] || "border-l-border";

  return (
    <div
      className={cn(
        "border border-border rounded bg-card border-l-2 transition-colors",
        borderColor,
        className,
      )}
      data-testid={`thread-card-${thread.id}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-muted-foreground flex-shrink-0"
          data-testid={`thread-card-toggle-${thread.id}`}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-[12px] font-medium text-foreground flex-1 truncate text-left"
        >
          {thread.title}
        </button>
        <StatusBadge status={thread.status} size="xs" />
        <span className="font-mono text-[10px] text-muted-foreground">{thread.elapsed}</span>
        <button
          onClick={() => openPane("thread", thread, `Thread: ${thread.title}`)}
          className="text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0"
          title="Open in pane"
          data-testid={`thread-open-pane-${thread.id}`}
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* Progress bar */}
      {thread.status === "running" && (
        <div className="px-3 pb-1">
          <div className="h-0.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-500"
              style={{ width: `${thread.progress}%` }}
            />
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-3 py-2 space-y-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {thread.objective}
              </p>

              {subagents.length > 0 && (
                <div className="space-y-1">
                  {subagents.map((a) => (
                    <SubagentCard key={a.id} agent={a} />
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                  <GitBranch className="w-2.5 h-2.5" />
                  {thread.worktree}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {thread.elapsed}
                </span>
                <ModelBadge model={thread.model} size="xs" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
