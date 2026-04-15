import { AppShell } from "@/components/svvy/AppShell";
import { WorkflowGraph } from "@/components/svvy/WorkflowGraph";
import { StatusBadge } from "@/components/svvy/StatusBadge";
import { mockWorkflowNodes, mockWorkflowEdges, mockWorkflowRun } from "@/data/mock";
import { Clock, GitBranch } from "lucide-react";

export default function WorkflowInspectorPage() {
  return (
    <AppShell
      title="OAuth Provider Integration"
      sessionStatus="running"
      worktree="feat/oauth-provider"
      budgetPercent={71}
      isStreaming={true}
    >
      <div className="flex flex-col h-full">
        {/* Workflow header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border flex-shrink-0 bg-card/30">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] text-foreground">{mockWorkflowRun.name}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{mockWorkflowRun.runId}</span>
          </div>
          <StatusBadge status={mockWorkflowRun.status} size="sm" />
          <div className="flex items-center gap-1 ml-auto">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="font-mono text-[10px] text-muted-foreground">{mockWorkflowRun.elapsed}</span>
            <span className="text-border mx-2">·</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {mockWorkflowRun.stepsDone}/{mockWorkflowRun.stepsTotal} steps
            </span>
            <span className="text-border mx-2">·</span>
            <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
              <GitBranch className="w-2.5 h-2.5" />
              feat/oauth-provider
            </span>
          </div>
        </div>

        {/* Graph */}
        <div className="flex-1 min-h-0">
          <WorkflowGraph nodes={mockWorkflowNodes} edges={mockWorkflowEdges} />
        </div>
      </div>
    </AppShell>
  );
}
