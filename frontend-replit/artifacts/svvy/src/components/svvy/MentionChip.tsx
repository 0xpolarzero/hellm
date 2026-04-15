import { X, File, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

interface MentionChipProps {
  path: string;
  isFolder?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function MentionChip({ path, isFolder = false, onRemove, className }: MentionChipProps) {
  const Icon = isFolder ? Folder : File;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded",
        "bg-orange-500/12 text-orange-400 border border-orange-500/25",
        className
      )}
      data-testid={`mention-chip-${path}`}
    >
      <Icon className="w-2.5 h-2.5" />
      <span className="max-w-36 truncate">{path}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="hover:text-orange-300 transition-colors"
          data-testid={`mention-chip-remove-${path}`}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}
