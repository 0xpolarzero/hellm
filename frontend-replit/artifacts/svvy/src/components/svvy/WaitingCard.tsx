import { useState } from "react";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";

interface WaitingCardProps {
  question: string;
  context?: string;
  className?: string;
  onReply?: (text: string) => void;
}

export function WaitingCard({ question, context, className, onReply }: WaitingCardProps) {
  const [reply, setReply] = useState("");

  return (
    <div
      className={cn(
        "border border-border rounded bg-card border-l-2 border-l-amber-500",
        className
      )}
      data-testid="waiting-card"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="w-2 h-2 rounded-full bg-amber-500 pulse-dot" />
        <Clock className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[12px] font-medium text-amber-400">Waiting for input</span>
      </div>

      <div className="px-3 py-2.5">
        {context && (
          <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">{context}</p>
        )}
        <p className="text-[13px] text-foreground leading-relaxed mb-3">{question}</p>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder="Type your response..."
            className="flex-1 text-[12px] bg-muted border border-border rounded px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground outline-none focus:border-ring transition-colors"
            data-testid="waiting-reply-input"
            onKeyDown={e => {
              if (e.key === "Enter" && reply.trim() && onReply) {
                onReply(reply);
                setReply("");
              }
            }}
          />
          <button
            onClick={() => { if (reply.trim() && onReply) { onReply(reply); setReply(""); } }}
            disabled={!reply.trim()}
            className={cn(
              "text-[11px] px-3 py-1.5 rounded font-medium transition-colors",
              reply.trim()
                ? "bg-orange-500 text-white hover:bg-orange-600"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
            data-testid="btn-reply"
          >
            Reply
          </button>
        </div>

        <button className="text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-2 block">
          Skip and continue
        </button>
      </div>
    </div>
  );
}
