import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { GitBranch, Grid2x2, PanelRight, ChevronDown, X, Bot, Workflow, GitBranch as GitBranchIcon, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavRail } from "./NavRail";
import { BottomComposer } from "./BottomComposer";
import { StatusBadge } from "./StatusBadge";
import { ContextBudgetBar } from "./ContextBudgetBar";
import { RightInspector } from "./RightInspector";
import { usePanes, PanesProvider, type PaneItem, type PaneType } from "@/hooks/usePanes";
import { SubagentPaneContent } from "./panes/SubagentPaneContent";
import { WorkflowPaneContent } from "./panes/WorkflowPaneContent";
import { ArtifactPaneContent } from "./panes/ArtifactPaneContent";
import { ThreadPaneContent } from "./panes/ThreadPaneContent";
import type { SessionStatus } from "@/data/mock";

interface PaneSplitShellProps {
  children: React.ReactNode;
  title?: string;
  sessionStatus?: SessionStatus;
  worktree?: string;
  budgetPercent?: number;
  isStreaming?: boolean;
  activeSessionId?: string;
  showInspector?: boolean;
}

const paneTypeConfig: Record<PaneType, { icon: React.ElementType; color: string }> = {
  subagent: { icon: Bot, color: "text-blue-400" },
  workflow: { icon: Workflow, color: "text-purple-400" },
  artifact: { icon: FileText, color: "text-cyan-400" },
  diff: { icon: GitBranchIcon, color: "text-emerald-400" },
  thread: { icon: GitBranchIcon, color: "text-orange-400" },
};

function PaneResizeHandleBar() {
  return (
    <PanelResizeHandle className="w-1 relative group flex items-center justify-center">
      <div className="absolute inset-y-0 w-px bg-border group-hover:bg-orange-500/60 group-data-[resize-handle-active]:bg-orange-500 transition-colors" />
      <div className="relative z-10 w-1 h-8 rounded-full bg-transparent group-hover:bg-orange-500/30 transition-colors" />
    </PanelResizeHandle>
  );
}

function PaneHeader({ pane, onClose }: { pane: PaneItem; onClose: () => void }) {
  const config = paneTypeConfig[pane.type];
  const Icon = config.icon;
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-muted/30 flex-shrink-0">
      <Icon className={cn("w-3 h-3 flex-shrink-0", config.color)} />
      <span className="text-[11px] text-foreground/85 truncate flex-1">{pane.title}</span>
      <button
        onClick={onClose}
        className="text-muted-foreground/60 hover:text-foreground transition-colors flex-shrink-0"
        data-testid={`close-pane-${pane.id}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function PaneContentRouter({ pane }: { pane: PaneItem }) {
  switch (pane.type) {
    case "subagent":
      return <SubagentPaneContent agent={pane.data} />;
    case "workflow":
      return <WorkflowPaneContent workflow={pane.data} />;
    case "artifact":
    case "diff":
      return <ArtifactPaneContent artifact={pane.data} showBrowser={!pane.data} />;
    case "thread":
      return <ThreadPaneContent thread={pane.data} />;
    default:
      return null;
  }
}

function SessionPaneLabel({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-muted/30 flex-shrink-0">
      <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">Session</span>
    </div>
  );
}

function PaneSplitShellInner({
  children,
  title = "OAuth Provider Integration",
  sessionStatus = "running",
  worktree = "feat/oauth-provider",
  budgetPercent = 71,
  isStreaming = false,
  activeSessionId = "s1",
  showInspector: defaultShowInspector = false,
}: PaneSplitShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showInspector, setShowInspector] = useState(defaultShowInspector);
  const { additionalPanes, closePane } = usePanes();

  const totalPanes = 1 + additionalPanes.length;

  const sessionDefaultSize = totalPanes === 1 ? 100 : totalPanes === 2 ? 45 : 34;
  const detailDefaultSize = totalPanes === 2 ? 55 : 33;

  return (
    <div className="flex h-full bg-background overflow-hidden" data-testid="pane-split-shell">
      <NavRail
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        activeSessionId={activeSessionId}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Session header */}
        <div className="flex items-center justify-between px-4 h-9 border-b border-border flex-shrink-0 bg-card/50">
          <div className="flex items-center gap-2 min-w-0">
            <button className="text-[12px] font-medium text-foreground hover:text-foreground/80 transition-colors truncate max-w-64">
              {title}
            </button>
            <StatusBadge status={sessionStatus} size="xs" />
            <span className="text-border mx-0.5">/</span>
            <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
              <GitBranch className="w-2.5 h-2.5" />
              {worktree}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <ContextBudgetBar percent={budgetPercent} showLabel width="w-20" />

            <button
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
              data-testid="btn-pane-layout"
            >
              <Grid2x2 className="w-3 h-3" />
              <span className="font-mono text-[10px]">{totalPanes}×1</span>
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

        {/* Panes + inspector */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Panel group */}
            <PanelGroup
              key={totalPanes}
              direction="horizontal"
              className="flex-1 min-h-0"
            >
              {/* Session pane */}
              <Panel
                minSize={20}
                defaultSize={sessionDefaultSize}
                className="flex flex-col overflow-hidden"
              >
                <SessionPaneLabel count={additionalPanes.length} />
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  {children}
                </div>
              </Panel>

              {/* Detail panes */}
              {additionalPanes.map((pane, i) => (
                <>
                  <PaneResizeHandleBar key={`handle-${pane.id}`} />
                  <Panel
                    key={pane.id}
                    minSize={20}
                    defaultSize={detailDefaultSize}
                    className="flex flex-col overflow-hidden border-l border-border/0"
                  >
                    <PaneHeader pane={pane} onClose={() => closePane(pane.id)} />
                    <div className="flex-1 overflow-hidden">
                      <PaneContentRouter pane={pane} />
                    </div>
                  </Panel>
                </>
              ))}
            </PanelGroup>

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

export function PaneSplitShell(props: PaneSplitShellProps) {
  return (
    <PanesProvider>
      <PaneSplitShellInner {...props} />
    </PanesProvider>
  );
}
