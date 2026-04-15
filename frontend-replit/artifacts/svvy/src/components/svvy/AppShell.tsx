import { useState } from "react";
import { NavRail } from "./NavRail";
import { BottomComposer } from "./BottomComposer";
import { RightInspector } from "./RightInspector";
import {
  GitBranch, Grid2x2, PanelRight, ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ContextBudgetBar } from "./ContextBudgetBar";
import { StatusBadge } from "./StatusBadge";
import type { SessionStatus } from "@/data/mock";

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  sessionStatus?: SessionStatus;
  worktree?: string;
  budgetPercent?: number;
  isStreaming?: boolean;
  activeSessionId?: string;
  showInspector?: boolean;
  collapsed?: boolean;
  className?: string;
}

export function AppShell({
  children,
  title = "OAuth Provider Integration",
  sessionStatus = "running",
  worktree = "feat/oauth-provider",
  budgetPercent = 71,
  isStreaming = false,
  activeSessionId = "s1",
  showInspector: defaultShowInspector = false,
  collapsed: defaultCollapsed = false,
  className,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showInspector, setShowInspector] = useState(defaultShowInspector);

  return (
    <div className={cn("flex h-full bg-background overflow-hidden", className)}>
      <NavRail
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        activeSessionId={activeSessionId}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Session header */}
        <div className="flex items-center justify-between px-4 h-9 border-b border-border flex-shrink-0 bg-card/50">
          <div className="flex items-center gap-2 min-w-0">
            <button
              className="text-[12px] font-medium text-foreground hover:text-foreground/80 transition-colors truncate max-w-64"
              data-testid="session-title"
            >
              {title}
            </button>
            <StatusBadge status={sessionStatus} size="xs" />
            <span className="text-border mx-0.5 text-xs">/</span>
            <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
              <GitBranch className="w-2.5 h-2.5" />
              {worktree}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <ContextBudgetBar percent={budgetPercent} showLabel width="w-20" />

            <button
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
              data-testid="btn-pane-layout"
            >
              <Grid2x2 className="w-3 h-3" />
              <span className="font-mono text-[10px]">1×1</span>
              <ChevronDown className="w-2.5 h-2.5" />
            </button>

            <span className="font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
              opus + 3
            </span>

            <button
              onClick={() => setShowInspector(v => !v)}
              className={cn(
                "text-muted-foreground hover:text-foreground transition-colors rounded p-1",
                showInspector && "bg-secondary text-foreground"
              )}
              title="Toggle inspector"
              data-testid="btn-toggle-inspector"
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main area + inspector */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {children}
            </div>
            <BottomComposer
              budgetPercent={budgetPercent}
              isStreaming={isStreaming}
              worktree={worktree}
            />
          </div>
          <RightInspector open={showInspector} onClose={() => setShowInspector(false)} />
        </div>
      </div>
    </div>
  );
}
