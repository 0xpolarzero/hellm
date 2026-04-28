<script lang="ts">
  import type { ContextBudget } from "../shared/context-budget";

  type Variant = "full" | "compact";

  type Props = {
    budget: ContextBudget | null;
    variant?: Variant;
    label?: string;
  };

  let { budget, variant = "full", label = "Context" }: Props = $props();

  const detailText = $derived(budget ? `${budget.label} · ${budget.detail}` : "Context unavailable");
</script>

{#if budget}
  <div
    class={`context-budget context-budget-${variant} tone-${budget.tone}`.trim()}
    role="meter"
    aria-label={`${label} budget`}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={budget.percent}
    title={detailText}
    data-testid={`context-budget-${variant}`}
  >
    <div class="context-budget-track" aria-hidden="true">
      <span style={`width: ${budget.percent}%`}></span>
    </div>
    {#if variant === "full"}
      <div class="context-budget-copy">
        <span>{label}</span>
        <strong>{budget.label}</strong>
        <small>{budget.detail}</small>
      </div>
    {:else}
      <span class="context-budget-compact-label">{budget.percent}%</span>
    {/if}
  </div>
{/if}

<style>
  .context-budget {
    --context-budget-color: var(--ui-info);
    --context-budget-soft: var(--ui-info-soft);
    min-width: 0;
  }

  .context-budget.tone-orange {
    --context-budget-color: var(--ui-warning);
    --context-budget-soft: var(--ui-warning-soft);
  }

  .context-budget.tone-red {
    --context-budget-color: var(--ui-danger);
    --context-budget-soft: var(--ui-danger-soft);
  }

  .context-budget-full {
    display: grid;
    grid-template-columns: minmax(5rem, 1fr) auto auto;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    min-height: 1.45rem;
  }

  .context-budget-track {
    height: 0.38rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
  }

  .context-budget-track span {
    display: block;
    height: 100%;
    min-width: 0.25rem;
    border-radius: inherit;
    background: var(--context-budget-color);
  }

  .context-budget-copy {
    display: contents;
  }

  .context-budget-copy span,
  .context-budget-copy strong,
  .context-budget-copy small,
  .context-budget-compact-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 0.63rem;
    line-height: 1;
  }

  .context-budget-copy span,
  .context-budget-copy small {
    color: var(--ui-text-tertiary);
  }

  .context-budget-copy strong,
  .context-budget-compact-label {
    color: color-mix(in oklab, var(--context-budget-color) 76%, var(--ui-text-primary));
    font-weight: 700;
  }

  .context-budget-compact {
    position: absolute;
    right: 0.62rem;
    bottom: 0.38rem;
    left: 0.62rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.4rem;
    pointer-events: none;
  }

  .context-budget-compact .context-budget-track {
    height: 0.26rem;
    background: color-mix(in oklab, var(--context-budget-soft) 52%, var(--ui-border-soft));
  }

  .context-budget-compact-label {
    font-size: 0.58rem;
  }

  @container (max-width: 34rem) {
    .context-budget-full {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .context-budget-copy span {
      display: none;
    }

    .context-budget-copy small {
      display: none;
    }
  }
</style>
