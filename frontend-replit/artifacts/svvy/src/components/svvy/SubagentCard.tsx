import { cn } from "@/lib/utils";
import { StatusDot } from "./StatusBadge";
import { ModelBadge } from "./ModelBadge";
import { Zap, Search, Code2, Eye, Workflow, Bot } from "lucide-react";
import { usePanes } from "@/hooks/usePanes";
import type { SubagentItem, AgentType } from "@/data/mock";

interface SubagentCardProps {
  agent: SubagentItem;
  className?: string;
  expandable?: boolean;
}

const agentConfig: Record<AgentType, { icon: React.ElementType; label: string; color: string }> = {
  orchestrator: { icon: Bot, label: "orchestrator", color: "text-orange-400" },
  quick: { icon: Zap, label: "quick", color: "text-yellow-400" },
  explorer: { icon: Search, label: "explorer", color: "text-blue-400" },
  implementer: { icon: Code2, label: "implementer", color: "text-purple-400" },
  reviewer: { icon: Eye, label: "reviewer", color: "text-cyan-400" },
  "workflow-writer": { icon: Workflow, label: "workflow-writer", color: "text-slate-400" },
};

export function SubagentCard({ agent, className, expandable = true }: SubagentCardProps) {
  const { openPane } = usePanes();
  const config = agentConfig[agent.type] || agentConfig.orchestrator;
  const Icon = config.icon;

  const handleClick = () => {
    if (!expandable) return;
    openPane("subagent", agent, `${config.label}: ${agent.headline.slice(0, 32)}…`);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded bg-muted/40 border border-border/50",
        expandable && "hover:bg-muted/70 transition-colors cursor-pointer",
        className
      )}
      onClick={handleClick}
      role={expandable ? "button" : undefined}
      tabIndex={expandable ? 0 : undefined}
      onKeyDown={e => e.key === "Enter" && handleClick()}
      data-testid={`subagent-card-${agent.id}`}
    >
      <Icon className={cn("w-3 h-3 flex-shrink-0", config.color)} />
      <span className={cn("font-mono text-[10px] flex-shrink-0", config.color)}>{config.label}</span>
      <span className="text-[11px] text-foreground/80 flex-1 truncate">{agent.headline}</span>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <StatusDot status={agent.status} />
        {agent.tokens && (
          <span className="font-mono text-[9px] text-muted-foreground">{(agent.tokens / 1000).toFixed(1)}k</span>
        )}
        <ModelBadge model={agent.model} size="xs" />
        {expandable && (
          <span className="font-mono text-[8px] text-muted-foreground/40">→</span>
        )}
      </div>
    </div>
  );
}
