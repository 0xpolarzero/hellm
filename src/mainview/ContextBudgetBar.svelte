<script lang="ts">
  import { formatContextBudgetTooltip, type ContextBudget } from "../shared/context-budget";
  import Tooltip from "./ui/Tooltip.svelte";

  type Variant = "full" | "compact" | "inline";
  type TooltipDetail = {
    label: string;
    value?: string | null;
    shortcut?: string | null;
    icon?: "mouse-left";
  };

  type Props = {
    budget: ContextBudget | null;
    variant?: Variant;
    label?: string;
    showCopy?: boolean;
    showTooltip?: boolean;
    tooltipLabel?: string;
    tooltipDetails?: TooltipDetail[];
  };

  let {
    budget,
    variant = "full",
    label = "Context",
    showCopy = true,
    showTooltip = true,
    tooltipLabel,
    tooltipDetails = [],
  }: Props = $props();

  const detailText = $derived(
    budget ? (tooltipLabel ?? formatContextBudgetTooltip(budget)) : "Context unavailable",
  );
  const percentText = $derived(
    budget
      ? Number.isInteger(budget.percent)
        ? budget.percent.toString()
        : budget.percent.toFixed(1)
      : "",
  );
</script>

{#if budget}
  <div
    class={`context-budget context-budget-${variant} ${variant === "full" && !showCopy ? "is-bar-only" : ""} tone-${budget.tone}`.trim()}
    role="meter"
    aria-label={`${label} budget`}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={budget.percent}
    data-testid={`context-budget-${variant}`}
  >
    {#if variant === "full"}
      {#if showTooltip}
        <Tooltip label={detailText} details={tooltipDetails} delayMs={250} block>
          <div class="context-budget-track" aria-hidden="true">
            <span style={`width: ${budget.percent}%`}></span>
          </div>
        </Tooltip>
      {:else}
        <div class="context-budget-track" aria-hidden="true">
          <span style={`width: ${budget.percent}%`}></span>
        </div>
      {/if}
      {#if showCopy}
        <div class="context-budget-copy">
          <span>{label}</span>
          <strong>{budget.label}</strong>
          <small>{budget.detail}</small>
        </div>
      {/if}
    {:else if showTooltip}
      <Tooltip label={detailText} details={tooltipDetails} delayMs={250} block>
        <div class="context-budget-hover-target">
          <div class="context-budget-track" aria-hidden="true">
            <span style={`width: ${budget.percent}%`}></span>
          </div>
          <span class="context-budget-compact-label">{percentText}%</span>
        </div>
      </Tooltip>
    {:else}
      <div class="context-budget-track" aria-hidden="true">
        <span style={`width: ${budget.percent}%`}></span>
      </div>
      <span class="context-budget-compact-label">{percentText}%</span>
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

  .context-budget-full.is-bar-only {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0.95rem;
  }

  .context-budget-full.is-bar-only :global(.ui-tooltip-anchor) {
    display: grid;
    align-items: center;
    min-height: 0.95rem;
  }

  .context-budget-full.is-bar-only .context-budget-track {
    height: 0.22rem;
    width: 100%;
    background: color-mix(in oklab, var(--context-budget-soft) 44%, var(--ui-border-soft));
  }

  .context-budget-track {
    height: 0.38rem;
    overflow: hidden;
    border-radius: var(--ui-radius-sm);
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

  .context-budget-hover-target {
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
    font-size: var(--text-xs);
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
  }

  .context-budget-compact .context-budget-track {
    height: 0.26rem;
    background: color-mix(in oklab, var(--context-budget-soft) 52%, var(--ui-border-soft));
  }

  .context-budget-compact :global(.ui-tooltip-anchor),
  .context-budget-inline :global(.ui-tooltip-anchor) {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    min-height: 1rem;
    padding-block: 0.24rem;
    margin-block: -0.24rem;
  }

  .context-budget-compact-label {
    font-size: var(--text-xs);
  }

  .context-budget-inline {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.22rem;
    width: min(5.7rem, 100%);
  }

  .context-budget-inline .context-budget-track {
    height: 0.14rem;
    background: color-mix(in oklab, var(--context-budget-soft) 48%, var(--ui-border-soft));
  }

  .context-budget-inline .context-budget-compact-label {
    font-size: 9px;
    font-weight: 600;
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
