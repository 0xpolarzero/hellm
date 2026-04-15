import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, MinusCircle, ExternalLink } from "lucide-react";
import type { VerificationResult } from "@/data/mock";

interface VerificationCardProps {
  result: VerificationResult;
  className?: string;
}

function CheckRow({ label, status }: { label: string; status: "pass" | "fail" | "skip" }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {status === "pass" && <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />}
      {status === "fail" && <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />}
      {status === "skip" && <MinusCircle className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
      <span className="text-[11px] text-foreground/80">{label}</span>
      <span className={cn(
        "font-mono text-[10px] ml-auto",
        status === "pass" && "text-emerald-400",
        status === "fail" && "text-red-400",
        status === "skip" && "text-muted-foreground",
      )}>{status}</span>
    </div>
  );
}

export function VerificationCard({ result, className }: VerificationCardProps) {
  return (
    <div
      className={cn(
        "border rounded bg-card border-l-2",
        result.passed ? "border-border border-l-emerald-500/60" : "border-border border-l-red-500",
        className
      )}
      data-testid={`verification-card-${result.id}`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        {result.passed ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
        )}
        <span className="text-[12px] font-medium text-foreground">Verification</span>
        <span className={cn(
          "font-mono text-[10px] px-1.5 py-0.5 rounded border",
          result.passed
            ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10"
            : "text-red-400 border-red-500/20 bg-red-500/10"
        )}>
          {result.passed ? "passed" : "failed"}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground ml-auto">
          {result.testsPassed}/{result.testsTotal} tests
        </span>
      </div>

      <div className="px-3 py-2 space-y-0.5">
        <CheckRow label="Build" status={result.build} />
        <CheckRow label="Tests" status={result.tests} />
        <CheckRow label="Lint" status={result.lint} />
      </div>

      <div className="px-3 pb-2">
        <p className="text-[11px] text-muted-foreground leading-relaxed">{result.summary}</p>
        <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-1.5">
          <ExternalLink className="w-2.5 h-2.5" />
          View report
        </button>
      </div>
    </div>
  );
}
