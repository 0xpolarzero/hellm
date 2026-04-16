import { cn } from "@/lib/utils";

interface ContextBudgetBarProps {
  percent: number;
  showLabel?: boolean;
  width?: string;
  className?: string;
}

export function ContextBudgetBar({
  percent,
  showLabel = false,
  width = "w-28",
  className,
}: ContextBudgetBarProps) {
  const color = percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-orange-500" : "bg-emerald-500";

  const labelColor =
    percent >= 90 ? "text-red-400" : percent >= 70 ? "text-orange-400" : "text-muted-foreground";

  return (
    <div className={cn("flex items-center gap-2", className)} data-testid="context-budget-bar">
      <div className={cn("relative h-1 rounded-full bg-muted overflow-hidden", width)}>
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
            color,
          )}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn("font-mono text-[10px] tabular-nums", labelColor)}>{percent}%</span>
      )}
    </div>
  );
}
