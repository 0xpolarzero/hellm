import { cn } from "@/lib/utils";
import { StatusDot } from "./StatusBadge";
import { ModelBadge } from "./ModelBadge";
import type { Session } from "@/data/mock";

interface SessionRowProps {
  session: Session;
  isActive?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}

export function SessionRow({ session, isActive, onClick, collapsed }: SessionRowProps) {
  if (collapsed) {
    return (
      <button
        onClick={onClick}
        className={cn(
          "w-full flex items-center justify-center py-2 px-0 rounded transition-colors relative",
          isActive
            ? "bg-sidebar-accent"
            : "hover:bg-sidebar-accent/60"
        )}
        title={session.title}
        data-testid={`session-row-${session.id}`}
      >
        {isActive && (
          <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-orange-500 rounded-full" />
        )}
        <StatusDot status={session.status} />
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-1.5 rounded transition-colors relative group select-none",
        isActive
          ? "bg-sidebar-accent"
          : "hover:bg-sidebar-accent/60"
      )}
      data-testid={`session-row-${session.id}`}
    >
      {isActive && (
        <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-orange-500 rounded-full" />
      )}
      <div className="flex items-start gap-2">
        <StatusDot status={session.status} className="mt-[3px]" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 justify-between">
            <span className={cn(
              "text-[12px] truncate font-medium leading-tight",
              isActive ? "text-foreground" : "text-foreground/90"
            )}>
              {session.title}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {session.status === "waiting" && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 pulse-dot" />
              )}
              {session.pane && (
                <span className="font-mono text-[9px] text-muted-foreground border border-border rounded px-0.5">
                  {session.pane}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-[11px] text-muted-foreground truncate pr-2 leading-tight">
              {session.preview}
            </span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground font-mono">{session.time}</span>
              <ModelBadge model={session.model} size="xs" />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
