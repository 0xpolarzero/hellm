import { cn } from "@/lib/utils";
import { RefreshCw, ExternalLink, AlertOctagon } from "lucide-react";

interface FailedCardProps {
  title?: string;
  testsPassed: number;
  testsTotal: number;
  errorSnippet?: string;
  className?: string;
  onRetry?: () => void;
  onViewReport?: () => void;
}

export function FailedCard({
  title = "Verification failed",
  testsPassed,
  testsTotal,
  errorSnippet,
  className,
  onRetry,
  onViewReport,
}: FailedCardProps) {
  const testsFailed = testsTotal - testsPassed;

  return (
    <div
      className={cn("border border-border rounded bg-card border-l-2 border-l-red-500", className)}
      data-testid="failed-card"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <AlertOctagon className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
        <span className="text-[12px] font-medium text-red-400">{title}</span>
        <span className="font-mono text-[10px] text-red-400 border border-red-500/20 bg-red-500/10 rounded px-1.5 py-0.5 ml-auto">
          {testsFailed} failed · {testsPassed} passed
        </span>
      </div>

      <div className="px-3 py-2.5">
        {errorSnippet && (
          <div className="bg-muted/40 rounded border border-border mb-3 overflow-hidden">
            <pre className="text-[10px] font-mono text-red-300 leading-relaxed overflow-x-auto p-2.5 max-h-28">
              {errorSnippet}
            </pre>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onViewReport}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            data-testid="btn-view-report"
          >
            <ExternalLink className="w-3 h-3" />
            View full report
          </button>
          <button
            onClick={onRetry}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-border text-foreground/80 hover:bg-secondary transition-colors"
            data-testid="btn-retry"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
          <button
            className="text-[11px] px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-secondary transition-colors"
            data-testid="btn-override"
          >
            Override
          </button>
        </div>
      </div>
    </div>
  );
}
