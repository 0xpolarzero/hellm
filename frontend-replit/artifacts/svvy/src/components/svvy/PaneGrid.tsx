import { useLocation } from "wouter";
import { X, Plus, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Pane {
  id: string;
  label: string;
  position: [number, number];
  span?: [number, number];
  type: "session" | "workflow" | "subagent" | "artifact" | "empty";
}

const defaultPanes: Pane[] = [
  {
    id: "p11",
    label: "Session: OAuth Integration",
    position: [1, 1],
    span: [2, 1],
    type: "session",
  },
  { id: "p12", label: "Empty", position: [1, 2], type: "empty" },
  { id: "p13", label: "Workflow Inspector", position: [1, 3], type: "workflow" },
  { id: "p21", label: "Subagent: explorer", position: [2, 2], type: "subagent" },
  { id: "p22", label: "Artifact Browser", position: [2, 2], type: "artifact" },
  { id: "p23", label: "Empty", position: [2, 3], type: "empty" },
  { id: "p31", label: "Session: Fix rate limiting", position: [3, 1], type: "session" },
  { id: "p32", label: "Empty", position: [3, 2], type: "empty" },
  { id: "p33", label: "Empty", position: [3, 3], type: "empty" },
];

const paneColors: Record<string, string> = {
  session: "border-orange-500/30",
  workflow: "border-purple-500/30",
  subagent: "border-blue-500/30",
  artifact: "border-cyan-500/30",
  empty: "border-border border-dashed",
};

function occupiedBySpan(pane: Pane, r: number, c: number) {
  const [startRow, startCol] = pane.position;
  const [rowSpan, colSpan] = pane.span ?? [1, 1];
  return r >= startRow && r < startRow + rowSpan && c >= startCol && c < startCol + colSpan;
}

interface PaneGridProps {
  panes?: Pane[];
  className?: string;
}

export function PaneGrid({ panes = defaultPanes, className }: PaneGridProps) {
  const [, setLocation] = useLocation();
  const rows = 3;
  const cols = 3;

  const getPane = (r: number, c: number) => panes.find((p) => occupiedBySpan(p, r, c));

  return (
    <div
      className={cn("grid gap-1 p-2 h-full", className)}
      style={{
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
      }}
      data-testid="pane-grid"
    >
      {Array.from({ length: rows }, (__, rowIndex) =>
        Array.from({ length: cols }, (___, colIndex) => {
          const row = rowIndex + 1;
          const col = colIndex + 1;
          const pane = getPane(row, col);
          if (!pane) return null;
          const isOrigin = pane.position[0] === row && pane.position[1] === col;
          if (!isOrigin) return null;

          const isEmpty = pane.type === "empty";
          const [rowSpan, colSpan] = pane.span ?? [1, 1];

          return (
            <div
              key={`${rowIndex}-${colIndex}`}
              className={cn(
                "border rounded flex flex-col overflow-hidden bg-card",
                paneColors[pane.type] || "border-border",
                isEmpty && "opacity-50",
              )}
              style={{
                gridRow: `span ${rowSpan}`,
                gridColumn: `span ${colSpan}`,
              }}
              data-testid={`pane-${pane.id}`}
            >
              {/* Pane header */}
              <div className="flex items-center justify-between px-2 py-1 border-b border-border/60 flex-shrink-0 bg-muted/20">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-[9px] text-muted-foreground/60 flex-shrink-0">
                    [{pane.position.join(",")}]{pane.span ? ` ${pane.span[0]}×${pane.span[1]}` : ""}
                  </span>
                  <span className="text-[10px] text-foreground/70 truncate">{pane.label}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    title="Expand"
                    data-testid={`pane-expand-${pane.id}`}
                    onClick={() => {
                      if (pane.type === "workflow") setLocation("/workflow");
                      else if (pane.type === "session") setLocation("/session");
                      else if (pane.type === "subagent") setLocation("/session/subagent");
                      else if (pane.type === "artifact") setLocation("/artifacts");
                    }}
                  >
                    <Maximize2 className="w-2.5 h-2.5" />
                  </button>
                  <button
                    className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    title="Close"
                    data-testid={`pane-close-${pane.id}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>

              {/* Pane content */}
              <div className="flex-1 overflow-hidden p-2">
                {isEmpty ? (
                  <button
                    className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors gap-1"
                    data-testid={`pane-add-${pane.id}`}
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-[10px]">Add surface</span>
                  </button>
                ) : (
                  <PaneContent type={pane.type} label={pane.label} />
                )}
              </div>
            </div>
          );
        }),
      )}
    </div>
  );
}

function PaneContent({ type, label }: { type: string; label: string }) {
  const lines: Record<string, React.ReactNode> = {
    session: (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 pulse-dot" />
          <span className="text-[10px] text-foreground/80 truncate">{label}</span>
        </div>
        <div className="text-[9px] text-muted-foreground font-mono">3 active threads · opus</div>
        <div className="h-0.5 bg-muted rounded-full overflow-hidden mt-1.5">
          <div className="h-full bg-orange-500/60 rounded-full" style={{ width: "45%" }} />
        </div>
      </div>
    ),
    workflow: (
      <div className="space-y-1">
        <span className="text-[10px] text-foreground/80 font-mono">auth-refactor-ci</span>
        <div className="flex items-center gap-1 mt-1">
          {[1, 1, 1, 0, 0, 0, 0, 0].map((done, i) => (
            <span
              key={i}
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                i === 3
                  ? "bg-orange-500 pulse-dot"
                  : done
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/20",
              )}
            />
          ))}
        </div>
        <div className="text-[9px] text-muted-foreground font-mono">3/8 · run-tests active</div>
      </div>
    ),
    subagent: (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono text-blue-400">explorer</span>
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 pulse-dot" />
        </div>
        <div className="text-[9px] text-muted-foreground font-mono truncate">
          Exploring codebase patterns...
        </div>
      </div>
    ),
    artifact: (
      <div className="space-y-1">
        <span className="text-[10px] text-foreground/80">Artifact Browser</span>
        <div className="text-[9px] text-muted-foreground font-mono">8 files across 3 sessions</div>
      </div>
    ),
  };

  return (
    <div className="text-xs text-muted-foreground">
      {lines[type] || <span className="text-[10px]">{label}</span>}
    </div>
  );
}
