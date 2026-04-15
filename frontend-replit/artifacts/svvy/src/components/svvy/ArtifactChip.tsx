import { FileText, GitBranch, Image, BarChart2, FileCode, FileJson } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePanes } from "@/hooks/usePanes";
import type { ArtifactType, ArtifactItem } from "@/data/mock";

interface ArtifactChipProps {
  name: string;
  type: ArtifactType;
  artifact?: ArtifactItem;
  className?: string;
  onClick?: () => void;
}

const typeConfig: Record<ArtifactType, { icon: React.ElementType; color: string; label: string }> = {
  diff: { icon: GitBranch, color: "text-blue-400 border-blue-500/20 bg-blue-500/8", label: "diff" },
  log: { icon: FileText, color: "text-slate-400 border-slate-500/20 bg-slate-500/8", label: "log" },
  screenshot: { icon: Image, color: "text-purple-400 border-purple-500/20 bg-purple-500/8", label: "png" },
  report: { icon: BarChart2, color: "text-cyan-400 border-cyan-500/20 bg-cyan-500/8", label: "report" },
  html: { icon: FileCode, color: "text-orange-400 border-orange-500/20 bg-orange-500/8", label: "html" },
  json: { icon: FileJson, color: "text-yellow-400 border-yellow-500/20 bg-yellow-500/8", label: "json" },
};

export function ArtifactChip({ name, type, artifact, className, onClick }: ArtifactChipProps) {
  const { openPane } = usePanes();
  const config = typeConfig[type] || typeConfig.log;
  const Icon = config.icon;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      const paneType = type === "diff" ? "diff" : "artifact";
      openPane(paneType, artifact || { id: name, name, type, size: "—", age: "—", session: "—" }, name);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded border",
        "hover:opacity-80 transition-opacity cursor-pointer",
        config.color,
        className
      )}
      data-testid={`artifact-chip-${name}`}
    >
      <Icon className="w-2.5 h-2.5" />
      <span className="truncate max-w-32">{name}</span>
    </button>
  );
}
