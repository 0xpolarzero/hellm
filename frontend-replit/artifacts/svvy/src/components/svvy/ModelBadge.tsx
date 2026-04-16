import { cn } from "@/lib/utils";

interface ModelBadgeProps {
  model: string;
  className?: string;
  size?: "xs" | "sm";
}

const modelShorthands: Record<string, string> = {
  "claude-opus-4.5": "opus",
  "claude-sonnet-4.5": "sonnet",
  "claude-haiku-3.5": "haiku",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "4o-mini",
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
};

export function ModelBadge({ model, className, size = "sm" }: ModelBadgeProps) {
  const label = modelShorthands[model] || model;

  return (
    <span
      className={cn(
        "font-mono text-muted-foreground border border-border rounded select-none",
        size === "xs" ? "text-[9px] px-1 py-0" : "text-[10px] px-1.5 py-0",
        className,
      )}
      title={model}
      data-testid={`model-badge-${model}`}
    >
      {label}
    </span>
  );
}
