<script lang="ts">
  type Props = {
    model: string;
    size?: "xs" | "sm";
    class?: string;
  };

  let { model, size = "sm", class: className = "" }: Props = $props();

  const modelShorthands: Record<string, string> = {
    "claude-opus-4.5": "opus",
    "claude-sonnet-4.5": "sonnet",
    "claude-haiku-3.5": "haiku",
    "gpt-5.4": "gpt-5.4",
    "gpt-5.4-mini": "5.4-mini",
    "gpt-5": "gpt-5",
    "gpt-5-mini": "5-mini",
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "4o-mini",
    opus: "opus",
    sonnet: "sonnet",
    haiku: "haiku",
  };

  const label = $derived(modelShorthands[model] ?? model);
</script>

<span
  class={`reference-model-badge size-${size} ${className}`.trim()}
  title={model}
  data-testid={`model-badge-${model}`}
>
  {label}
</span>

<style>
  .reference-model-badge {
    display: inline-flex;
    align-items: center;
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    user-select: none;
  }

  .size-xs {
    padding: 0.04rem 0.28rem;
    font-size: 0.54rem;
  }

  .size-sm {
    padding: 0.08rem 0.36rem;
    font-size: 0.6rem;
  }
</style>
