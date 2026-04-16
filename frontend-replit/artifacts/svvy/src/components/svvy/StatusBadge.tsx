import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/data/mock";

interface StatusBadgeProps {
  status: SessionStatus | "active" | "verified" | "blocked";
  size?: "xs" | "sm" | "md";
  className?: string;
  showDot?: boolean;
}

const statusConfig = {
  running: {
    label: "Running",
    dot: "bg-orange-500",
    text: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
  },
  active: {
    label: "Active",
    dot: "bg-orange-500",
    text: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
  },
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  verified: {
    label: "Verified",
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  waiting: {
    label: "Waiting",
    dot: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  blocked: {
    label: "Blocked",
    dot: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-500",
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
  idle: {
    label: "Idle",
    dot: "bg-slate-400",
    text: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
  },
};

export function StatusBadge({ status, size = "sm", className, showDot = true }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.idle;

  const sizeClasses = {
    xs: "text-[10px] px-1 py-0 gap-1",
    sm: "text-[11px] px-1.5 py-0.5 gap-1",
    md: "text-xs px-2 py-0.5 gap-1.5",
  };

  const dotSizes = {
    xs: "w-1 h-1",
    sm: "w-1.5 h-1.5",
    md: "w-2 h-2",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-mono rounded border select-none",
        config.text,
        config.bg,
        config.border,
        sizeClasses[size],
        className,
      )}
      data-testid={`status-badge-${status}`}
    >
      {showDot && (
        <span
          className={cn(
            "rounded-full flex-shrink-0",
            config.dot,
            dotSizes[size],
            (status === "running" || status === "active") && "pulse-dot",
          )}
        />
      )}
      {config.label}
    </span>
  );
}

export function StatusDot({
  status,
  className,
}: {
  status: SessionStatus | "active" | "verified" | "blocked";
  className?: string;
}) {
  const config = statusConfig[status] || statusConfig.idle;
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full flex-shrink-0",
        config.dot,
        (status === "running" || status === "active") && "pulse-dot",
        className,
      )}
      data-testid={`status-dot-${status}`}
    />
  );
}
