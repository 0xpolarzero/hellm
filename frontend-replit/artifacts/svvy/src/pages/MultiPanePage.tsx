import { useState } from "react";
import { NavRail } from "@/components/svvy/NavRail";
import { BottomComposer } from "@/components/svvy/BottomComposer";
import { PaneGrid } from "@/components/svvy/PaneGrid";
import { StatusBadge } from "@/components/svvy/StatusBadge";
import { ContextBudgetBar } from "@/components/svvy/ContextBudgetBar";
import { GitBranch, Grid2x2 } from "lucide-react";

export default function MultiPanePage() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-full bg-background overflow-hidden" data-testid="multi-pane-page">
      <NavRail
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        activeSessionId="s1"
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-9 border-b border-border flex-shrink-0 bg-card/50">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-foreground">
              OAuth Provider Integration
            </span>
            <StatusBadge status="running" size="xs" />
            <span className="text-border mx-0.5">/</span>
            <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
              <GitBranch className="w-2.5 h-2.5" />
              feat/oauth-provider
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ContextBudgetBar percent={71} showLabel width="w-20" />
            <div className="flex items-center gap-1 text-[11px] text-orange-400 border border-orange-500/20 bg-orange-500/8 rounded px-2 py-1">
              <Grid2x2 className="w-3 h-3" />
              <span className="font-mono text-[10px]">3×3</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
              opus + 3
            </span>
          </div>
        </div>

        {/* Pane grid */}
        <div className="flex-1 min-h-0">
          <PaneGrid />
        </div>

        <BottomComposer budgetPercent={71} isStreaming={true} />
      </div>
    </div>
  );
}
