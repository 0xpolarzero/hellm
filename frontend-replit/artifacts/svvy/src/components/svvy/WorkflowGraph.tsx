import { useState } from "react";
import { cn } from "@/lib/utils";
import { Bot, Terminal, CheckCircle2, Clock, RefreshCw, Flag, Shield, Zap } from "lucide-react";
import { ModelBadge } from "./ModelBadge";
import { ArtifactChip } from "./ArtifactChip";
import type { WorkflowNode, WorkflowEdge, NodeType, NodeStatus } from "@/data/mock";

interface WorkflowGraphProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

const nodeTypeConfig: Record<
  NodeType,
  {
    icon: React.ElementType;
    border: string;
    bg: string;
    label: string;
  }
> = {
  "agent-task": { icon: Bot, border: "border-blue-500/40", bg: "bg-blue-500/8", label: "agent" },
  script: {
    icon: Terminal,
    border: "border-purple-500/40",
    bg: "bg-purple-500/8",
    label: "script",
  },
  verification: {
    icon: CheckCircle2,
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/8",
    label: "verify",
  },
  wait: { icon: Clock, border: "border-amber-500/40", bg: "bg-amber-500/8", label: "wait" },
  retry: { icon: RefreshCw, border: "border-orange-500/40", bg: "bg-orange-500/8", label: "retry" },
  terminal: { icon: Flag, border: "border-slate-500/40", bg: "bg-slate-500/8", label: "terminal" },
  preflight: { icon: Shield, border: "border-sky-500/40", bg: "bg-sky-500/8", label: "preflight" },
  validation: { icon: Zap, border: "border-teal-500/40", bg: "bg-teal-500/8", label: "validate" },
};

const nodeStatusBorder: Record<NodeStatus, string> = {
  active: "border-orange-500",
  completed: "border-emerald-500/50",
  failed: "border-red-500",
  waiting: "border-muted-foreground/20",
};

const nodeStatusGlow: Record<NodeStatus, string> = {
  active: "shadow-[0_0_8px_rgba(249,115,22,0.3)]",
  completed: "",
  failed: "shadow-[0_0_8px_rgba(239,68,68,0.25)]",
  waiting: "",
};

const NODE_W = 130;
const NODE_H = 44;

export function WorkflowGraph({ nodes, edges }: WorkflowGraphProps) {
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);

  const graphHeight = Math.max(...nodes.map((n) => n.y)) + NODE_H + 20;
  const graphWidth = Math.max(...nodes.map((n) => n.x)) + NODE_W + 20;

  return (
    <div className="flex flex-col h-full" data-testid="workflow-graph">
      {/* Graph area */}
      <div className="flex-1 overflow-auto scrollbar-thin p-4 min-h-0">
        <div className="relative" style={{ width: graphWidth, height: graphHeight }}>
          {/* SVG edges */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={graphWidth}
            height={graphHeight}
          >
            {edges.map((edge, i) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;

              const x1 = from.x + NODE_W / 2;
              const y1 = from.y + NODE_H;
              const x2 = to.x + NODE_W / 2;
              const y2 = to.y;

              const cy1 = y1 + Math.abs(y2 - y1) * 0.5;
              const cy2 = y2 - Math.abs(y2 - y1) * 0.5;

              const fromNode = from;
              const isDone = fromNode.status === "completed";
              const isActive = fromNode.status === "active";

              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={
                    isDone
                      ? "rgba(34,197,94,0.4)"
                      : isActive
                        ? "rgba(249,115,22,0.5)"
                        : "rgba(255,255,255,0.08)"
                  }
                  strokeWidth="1.5"
                  strokeDasharray={fromNode.status === "waiting" ? "4 3" : undefined}
                />
              );
            })}

            {/* Arrowheads */}
            <defs>
              <marker
                id="arrow-done"
                markerWidth="6"
                markerHeight="6"
                refX="3"
                refY="3"
                orient="auto"
              >
                <path d="M 0 0 L 6 3 L 0 6 Z" fill="rgba(34,197,94,0.5)" />
              </marker>
              <marker
                id="arrow-pending"
                markerWidth="6"
                markerHeight="6"
                refX="3"
                refY="3"
                orient="auto"
              >
                <path d="M 0 0 L 6 3 L 0 6 Z" fill="rgba(255,255,255,0.12)" />
              </marker>
            </defs>
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const config = nodeTypeConfig[node.type] || nodeTypeConfig["agent-task"];
            const Icon = config.icon;
            const isSelected = selectedNode?.id === node.id;

            return (
              <button
                key={node.id}
                onClick={() => setSelectedNode(isSelected ? null : node)}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                className={cn(
                  "absolute border rounded flex items-center gap-2 px-2.5 text-left transition-all duration-150",
                  config.border,
                  config.bg,
                  nodeStatusBorder[node.status],
                  nodeStatusGlow[node.status],
                  isSelected && "ring-1 ring-ring ring-offset-0",
                  "hover:brightness-110",
                  node.status === "waiting" && "opacity-50",
                )}
                data-testid={`workflow-node-${node.id}`}
              >
                <Icon
                  className={cn(
                    "w-3 h-3 flex-shrink-0",
                    node.status === "completed" && "text-emerald-500",
                    node.status === "active" && "text-orange-500",
                    node.status === "failed" && "text-red-500",
                    node.status === "waiting" && "text-muted-foreground",
                  )}
                />
                <div className="min-w-0">
                  <div className="text-[10px] font-mono text-foreground/90 truncate leading-tight">
                    {node.label}
                  </div>
                  <div
                    className={cn(
                      "text-[9px] font-mono uppercase tracking-wide",
                      node.status === "completed" && "text-emerald-500",
                      node.status === "active" && "text-orange-400",
                      node.status === "failed" && "text-red-400",
                      node.status === "waiting" && "text-muted-foreground/60",
                    )}
                  >
                    {node.status === "active" && (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-orange-500 pulse-dot" />
                        {node.status}
                      </span>
                    )}
                    {node.status !== "active" && node.status}
                  </div>
                </div>
                {node.elapsed && (
                  <span className="font-mono text-[8px] text-muted-foreground ml-auto flex-shrink-0">
                    {node.elapsed}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Node detail panel */}
      {selectedNode && (
        <div className="border-t border-border bg-card flex-shrink-0 px-4 py-3 space-y-2.5 max-h-56 overflow-y-auto scrollbar-thin">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-mono text-[11px] text-foreground/90">{selectedNode.label}</span>
              <span
                className={cn(
                  "ml-2 font-mono text-[9px] uppercase px-1.5 py-0.5 rounded border",
                  nodeTypeConfig[selectedNode.type]?.border,
                  nodeTypeConfig[selectedNode.type]?.bg,
                  "text-muted-foreground",
                )}
              >
                {nodeTypeConfig[selectedNode.type]?.label}
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-muted-foreground hover:text-foreground text-lg leading-none"
            >
              ×
            </button>
          </div>

          {selectedNode.objective && (
            <p className="text-[12px] text-foreground/80 leading-relaxed">
              {selectedNode.objective}
            </p>
          )}

          {selectedNode.latestOutput && (
            <div>
              <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
                Latest output
              </div>
              <div className="bg-muted/40 rounded border border-border px-2.5 py-2 text-[11px] font-mono text-foreground/80 leading-relaxed">
                {selectedNode.latestOutput}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            {selectedNode.elapsed && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Elapsed</span>
                <span className="font-mono text-[10px] text-foreground/70">
                  {selectedNode.elapsed}
                </span>
              </div>
            )}
            {selectedNode.model && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Model</span>
                <ModelBadge model={selectedNode.model} size="xs" />
              </div>
            )}
            {selectedNode.worktree && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">Worktree</span>
                <span className="font-mono text-[10px] text-foreground/70">
                  {selectedNode.worktree}
                </span>
              </div>
            )}
          </div>

          {selectedNode.artifacts && selectedNode.artifacts.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedNode.artifacts.map((a) => (
                <ArtifactChip key={a.id} name={a.name} type={a.type} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
