import { cn } from "@/lib/utils";
import { BookOpen, CheckCircle2, AlertTriangle } from "lucide-react";
import { ArtifactChip } from "./ArtifactChip";
import type { Episode } from "@/data/mock";

interface EpisodeCardProps {
  episode: Episode;
  className?: string;
}

export function EpisodeCard({ episode, className }: EpisodeCardProps) {
  return (
    <div
      className={cn("border border-border rounded bg-card px-3 py-2.5", className)}
      data-testid={`episode-card-${episode.id}`}
    >
      <div className="flex items-start gap-2 mb-2">
        <BookOpen className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-[12px] font-medium text-foreground leading-tight">
              {episode.title}
            </h4>
            <div className="flex-shrink-0">
              {episode.verified ? (
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono border border-emerald-500/20 bg-emerald-500/8 rounded px-1.5 py-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  verified
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-amber-400 font-mono border border-amber-500/20 bg-amber-500/8 rounded px-1.5 py-0.5">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  review
                </span>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">
            {episode.summary}
          </p>
        </div>
      </div>

      {episode.artifacts.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2 pl-5">
          {episode.artifacts.map((a) => (
            <ArtifactChip key={a.id} name={a.name} type={a.type} artifact={a} />
          ))}
        </div>
      )}

      <div className="pl-5 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Thread:</span>
        <button className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
          {episode.thread}
        </button>
      </div>
    </div>
  );
}
