import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { Workflow, ArrowRight } from "lucide-react";
import { usePanes } from "@/hooks/usePanes";
import type { WorkflowRun } from "@/data/mock";

interface WorkflowCardProps {
  workflow: WorkflowRun;
  className?: string;
}

export function WorkflowCard({ workflow, className }: WorkflowCardProps) {
  const { openPane } = usePanes();

  const dots = Array.from({ length: workflow.stepsTotal }, (_, i) => ({
    done: i < workflow.stepsDone,
    active: i === workflow.stepsDone && workflow.status === "running",
  }));

  const handleClick = () => {
    openPane("workflow", workflow, `Workflow: ${workflow.name}`);
  };

  return (
    <div
      className={cn(
        "border border-border rounded bg-card px-3 py-2.5 hover:border-border/70 transition-colors cursor-pointer",
        className,
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      data-testid={`workflow-card-${workflow.id}`}
    >
      <div className="flex items-start gap-2">
        <Workflow className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-mono text-[11px] text-foreground truncate">{workflow.name}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <StatusBadge status={workflow.status} size="xs" />
              <span className="font-mono text-[9px] text-muted-foreground">{workflow.elapsed}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="flex items-center gap-0.5">
              {dots.map((dot, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-1.5 h-1.5 rounded-full transition-colors",
                    dot.active && "bg-orange-500 pulse-dot",
                    dot.done && "bg-emerald-500",
                    !dot.done && !dot.active && "bg-muted-foreground/25",
                  )}
                />
              ))}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {workflow.stepsDone}/{workflow.stepsTotal}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground truncate">
              {workflow.status === "running" ? workflow.currentStep : "Completed"}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground ml-auto">
              {workflow.runId}
            </span>
            <span className="font-mono text-[8px] text-muted-foreground/40 ml-1">→</span>
          </div>
        </div>
      </div>
    </div>
  );
}
