import { NavRail } from "@/components/svvy/NavRail";
import { BottomComposer } from "@/components/svvy/BottomComposer";
import { StatusBadge } from "@/components/svvy/StatusBadge";
import { ContextBudgetBar } from "@/components/svvy/ContextBudgetBar";
import { ThreadCard } from "@/components/svvy/ThreadCard";
import { WorkflowCard } from "@/components/svvy/WorkflowCard";
import { GitBranch, PanelRight } from "lucide-react";
import { mockThreads, mockSubagents, mockWorkflowRun } from "@/data/mock";

export default function NarrowShell() {
  return (
    <div className="flex h-full bg-background overflow-hidden" data-testid="narrow-shell">
      {/* Collapsed nav rail */}
      <NavRail collapsed={true} activeSessionId="s1" />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-9 border-b border-border flex-shrink-0 bg-card/50">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-foreground truncate max-w-48">OAuth Provider Integration</span>
            <StatusBadge status="running" size="xs" />
          </div>
          <div className="flex items-center gap-2">
            <ContextBudgetBar percent={71} showLabel width="w-16" />
            <button className="text-muted-foreground hover:text-foreground transition-colors">
              <PanelRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="px-4 py-4 space-y-4">
            <div className="text-[11px] text-muted-foreground leading-relaxed italic">
              Sidebar collapsed — showing icon-only navigation. Hover icons for labels. Click ← to expand.
            </div>

            <ThreadCard
              thread={mockThreads[0]}
              subagents={[mockSubagents[0]]}
            />
            <WorkflowCard workflow={mockWorkflowRun} />
          </div>
        </div>

        <BottomComposer budgetPercent={71} />
      </div>
    </div>
  );
}
