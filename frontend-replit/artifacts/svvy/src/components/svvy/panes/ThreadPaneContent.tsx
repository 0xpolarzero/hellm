import { CheckCircle2, AlertTriangle, Lightbulb, FileText, GitBranch, Clock } from "lucide-react";
import { StatusBadge } from "../StatusBadge";
import { ModelBadge } from "../ModelBadge";
import { SubagentCard } from "../SubagentCard";
import { DiffViewer } from "../DiffViewer";
import { usePanes } from "@/hooks/usePanes";
import { mockSubagents } from "@/data/mock";
import type { Thread } from "@/data/mock";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ThreadPaneContentProps {
  thread: Thread;
}

type ThreadTab = "summary" | "diff" | "subagents";

export function ThreadPaneContent({ thread }: ThreadPaneContentProps) {
  const [tab, setTab] = useState<ThreadTab>("summary");
  const { openPane } = usePanes();
  const threadAgents = mockSubagents.slice(0, 2);

  return (
    <div className="flex flex-col h-full" data-testid={`thread-pane-${thread.id}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <StatusBadge status={thread.status} size="xs" />
        <span className="text-[12px] font-medium text-foreground flex-1 truncate">{thread.title}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{thread.elapsed}</span>
      </div>

      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border flex-shrink-0">
        {(["summary", "diff", "subagents"] as ThreadTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded capitalize transition-colors",
              tab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "summary" && (
          <div className="h-full overflow-y-auto scrollbar-thin px-3 py-3 space-y-4">
            <div>
              <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Objective</h4>
              <p className="text-[12px] text-foreground/80 leading-relaxed">{thread.objective}</p>
            </div>

            {thread.changedFiles && thread.changedFiles.length > 0 && (
              <div>
                <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Changed Files</h4>
                <div className="space-y-0.5">
                  {thread.changedFiles.map(f => (
                    <button
                      key={f}
                      onClick={() => setTab("diff")}
                      className="flex items-center gap-1.5 w-full text-left py-0.5 hover:text-foreground transition-colors"
                    >
                      <FileText className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-mono text-[10px] text-foreground/75">{f}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {thread.conclusions && thread.conclusions.length > 0 && (
              <div>
                <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Conclusions</h4>
                <div className="space-y-1">
                  {thread.conclusions.map((c, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span className="text-[11px] text-foreground/80 leading-relaxed">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {thread.unresolvedIssues && thread.unresolvedIssues.length > 0 && (
              <div>
                <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Unresolved</h4>
                {thread.unresolvedIssues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-amber-500/8 border border-amber-500/15">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <span className="text-[11px] text-amber-300 leading-relaxed">{issue}</span>
                  </div>
                ))}
              </div>
            )}

            {thread.followUpSuggestions && thread.followUpSuggestions.length > 0 && (
              <div>
                <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Suggestions</h4>
                {thread.followUpSuggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <Lightbulb className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <span className="text-[11px] text-muted-foreground leading-relaxed">{s}</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <h4 className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Provenance</h4>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Worktree</span>
                  <span className="font-mono text-[10px] text-foreground/70 flex items-center gap-1">
                    <GitBranch className="w-2 h-2" />
                    {thread.worktree}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Elapsed</span>
                  <span className="font-mono text-[10px] text-foreground/70">{thread.elapsed}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Model</span>
                  <ModelBadge model={thread.model} size="xs" />
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "diff" && (
          <DiffViewer filename="src/middleware/auth.ts" />
        )}

        {tab === "subagents" && (
          <div className="h-full overflow-y-auto scrollbar-thin px-3 py-3 space-y-1.5">
            {threadAgents.map(a => (
              <SubagentCard
                key={a.id}
                agent={a}
                expandable={true}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
