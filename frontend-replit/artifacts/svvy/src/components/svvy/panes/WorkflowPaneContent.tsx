import { WorkflowGraph } from "../WorkflowGraph";
import { StatusBadge } from "../StatusBadge";
import { Clock, GitBranch } from "lucide-react";
import { mockWorkflowNodes, mockWorkflowEdges, mockWorkflowRun } from "@/data/mock";
import type { WorkflowRun } from "@/data/mock";

interface WorkflowPaneContentProps {
  workflow?: WorkflowRun;
}

export function WorkflowPaneContent({ workflow = mockWorkflowRun }: WorkflowPaneContentProps) {
  const pct = Math.round((workflow.stepsDone / workflow.stepsTotal) * 100);

  return (
    <div className="flex flex-col h-full" data-testid="workflow-pane-content">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0 bg-muted/20">
        <span className="font-mono text-[11px] text-foreground/90">{workflow.name}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{workflow.runId}</span>
        <StatusBadge status={workflow.status} size="xs" />
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[9px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-2 h-2" />
            {workflow.elapsed}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground">
            {workflow.stepsDone}/{workflow.stepsTotal}
          </span>
          <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <WorkflowGraph nodes={mockWorkflowNodes} edges={mockWorkflowEdges} />
      </div>
    </div>
  );
}
