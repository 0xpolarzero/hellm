<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  type CheckboxSize = "sm" | "md";

  type Props = Omit<HTMLInputAttributes, "type" | "checked" | "size"> & {
    checked?: boolean;
    size?: CheckboxSize;
  };

  let {
    checked = $bindable(false),
    size = "md",
    class: className = "",
    disabled = false,
    ...rest
  }: Props = $props();
</script>

<span class={`ui-checkbox size-${size} ${disabled ? "disabled" : ""} ${className}`.trim()}>
  <input {...rest} type="checkbox" bind:checked {disabled} />
  <span class="ui-checkbox-box" aria-hidden="true">
    <svg class="ui-checkbox-check" viewBox="0 0 12 12" fill="none" focusable="false">
      <path d="M3 6.1 5.1 8.2 9.2 3.8" />
    </svg>
  </span>
</span>

<style>
  .ui-checkbox {
    --ui-checkbox-size: 1rem;
    --ui-checkbox-check-size: 0.72rem;

    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
    width: var(--ui-checkbox-size);
    height: var(--ui-checkbox-size);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .size-sm {
    --ui-checkbox-size: 0.92rem;
    --ui-checkbox-check-size: 0.66rem;
  }

  .ui-checkbox input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: inherit;
    opacity: 0;
  }

  .ui-checkbox-box {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--ui-checkbox-size);
    height: var(--ui-checkbox-size);
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-muted) 38%, transparent);
    color: transparent;
    transition:
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      box-shadow 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .ui-checkbox-check {
    width: var(--ui-checkbox-check-size);
    height: var(--ui-checkbox-check-size);
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0;
    transform: scale(0.82);
    transition:
      opacity 120ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 120ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .ui-checkbox:hover:not(.disabled) .ui-checkbox-box {
    border-color: color-mix(in oklab, var(--ui-border-strong) 54%, transparent);
    background: color-mix(in oklab, var(--ui-surface-muted) 54%, transparent);
  }

  .ui-checkbox input:checked + .ui-checkbox-box {
    border-color: color-mix(in oklab, var(--ui-text-tertiary) 24%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-text-tertiary) 4%, var(--ui-surface-muted));
    color: color-mix(in oklab, var(--ui-text-secondary) 48%, var(--ui-text-tertiary));
  }

  .ui-checkbox input:checked + .ui-checkbox-box .ui-checkbox-check {
    opacity: 1;
    transform: scale(1);
  }

  .ui-checkbox:hover:not(.disabled) input:checked + .ui-checkbox-box {
    border-color: color-mix(in oklab, var(--ui-text-tertiary) 32%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-text-tertiary) 7%, var(--ui-surface-muted));
  }

  .ui-checkbox input:focus-visible + .ui-checkbox-box {
    box-shadow: var(--ui-focus-ring);
  }

  .ui-checkbox.disabled {
    cursor: default;
    opacity: 0.55;
  }

  @media (prefers-reduced-motion: reduce) {
    .ui-checkbox-box,
    .ui-checkbox-check {
      transition-duration: 0.01ms;
    }
  }
</style>
