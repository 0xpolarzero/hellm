<script lang="ts" module>
  export type ReferenceStatus =
    | "running"
    | "active"
    | "done"
    | "verified"
    | "passed"
    | "waiting"
    | "blocked"
    | "failed"
    | "cancelled"
    | "idle";

  export type StatusBadgeSize = "xs" | "sm" | "md";

  const statusLabels: Record<ReferenceStatus, string> = {
    running: "Running",
    active: "Active",
    done: "Done",
    verified: "Verified",
    passed: "Passed",
    waiting: "Waiting",
    blocked: "Blocked",
    failed: "Failed",
    cancelled: "Cancelled",
    idle: "Idle",
  };
</script>

<script lang="ts">
  type Props = {
    status?: ReferenceStatus;
    size?: StatusBadgeSize;
    class?: string;
    showDot?: boolean;
    label?: string;
    dotOnly?: boolean;
  };

  let {
    status = "idle",
    size = "sm",
    class: className = "",
    showDot = true,
    label,
    dotOnly = false,
  }: Props = $props();

  const displayLabel = $derived(label ?? statusLabels[status] ?? statusLabels.idle);
</script>

{#if dotOnly}
  <span
    class={`reference-status-dot size-${size} ${className}`.trim()}
    data-status={status}
    data-testid={`status-dot-${status}`}
    title={displayLabel}
  ></span>
{:else}
  <span
    class={`reference-status-badge size-${size} ${className}`.trim()}
    data-status={status}
    data-testid={`status-badge-${status}`}
  >
    {#if showDot}
      <span class="reference-status-dot" data-status={status}></span>
    {/if}
    {displayLabel}
  </span>
{/if}

<style>
  .reference-status-badge {
    --status-color: var(--ui-status-idle);
    --status-soft: var(--ui-status-idle-soft);
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    width: fit-content;
    max-width: 100%;
    border: 1px solid color-mix(in oklab, var(--status-color) 24%, var(--ui-border-soft));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--status-soft) 88%, transparent);
    color: color-mix(in oklab, var(--status-color) 78%, var(--ui-text-primary));
    font-family: var(--font-mono);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
    user-select: none;
  }

  .size-xs {
    min-height: 1rem;
    padding: 0.08rem 0.28rem;
    font-size: 0.56rem;
  }

  .size-sm {
    min-height: 1.18rem;
    padding: 0.12rem 0.38rem;
    font-size: 0.62rem;
  }

  .size-md {
    min-height: 1.34rem;
    padding: 0.15rem 0.48rem;
    font-size: 0.68rem;
  }

  .reference-status-dot {
    --status-color: var(--ui-status-idle);
    display: inline-block;
    width: 0.38rem;
    height: 0.38rem;
    border-radius: 999px;
    background: var(--status-color);
    flex: 0 0 auto;
  }

  .reference-status-dot.size-xs {
    width: 0.32rem;
    height: 0.32rem;
    padding: 0;
  }

  .reference-status-dot.size-md {
    width: 0.48rem;
    height: 0.48rem;
    padding: 0;
  }

  [data-status="running"],
  [data-status="active"] {
    --status-color: var(--ui-status-running);
    --status-soft: var(--ui-status-running-soft);
  }

  [data-status="done"],
  [data-status="verified"],
  [data-status="passed"] {
    --status-color: var(--ui-status-success);
    --status-soft: var(--ui-status-success-soft);
  }

  [data-status="waiting"],
  [data-status="blocked"] {
    --status-color: var(--ui-status-waiting);
    --status-soft: var(--ui-status-waiting-soft);
  }

  [data-status="failed"],
  [data-status="cancelled"] {
    --status-color: var(--ui-status-danger);
    --status-soft: var(--ui-status-danger-soft);
  }

  [data-status="running"].reference-status-dot,
  [data-status="active"].reference-status-dot,
  .reference-status-badge[data-status="running"] .reference-status-dot,
  .reference-status-badge[data-status="active"] .reference-status-dot {
    animation: pulse-dot 1.4s ease-in-out infinite;
  }
</style>
