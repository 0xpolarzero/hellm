<script lang="ts">
  import BanIcon from "@lucide/svelte/icons/ban";
  import CheckCircleIcon from "@lucide/svelte/icons/check-circle";
  import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
  import type { ExtensionUsageState } from "../shared/extensions";
  import Tooltip from "./ui/Tooltip.svelte";

  type Props = {
    ariaLabel: string;
    disabled?: boolean;
    detailFor?: (state: ExtensionUsageState) => string | null | undefined;
    isAllowed?: (state: ExtensionUsageState) => boolean;
    labelFor?: (state: ExtensionUsageState) => string;
    selected: ExtensionUsageState;
    onSelect: (state: ExtensionUsageState) => void | Promise<void>;
  };

  const STATES: Array<{ state: ExtensionUsageState; label: string }> = [
    { state: "default_loaded", label: "Loaded" },
    { state: "available", label: "Available" },
    { state: "unavailable", label: "Off" },
  ];

  let {
    ariaLabel,
    disabled = false,
    detailFor = () => null,
    isAllowed = () => true,
    labelFor = (state) => STATES.find((entry) => entry.state === state)?.label ?? "Off",
    selected,
    onSelect,
  }: Props = $props();
</script>

<div class="extension-state-buttons" aria-label={ariaLabel}>
  {#each STATES as option (option.state)}
    {@const active = selected === option.state}
    {@const label = labelFor(option.state)}
    {@const detail = detailFor(option.state)}
    {@const unavailable = disabled || !isAllowed(option.state)}
    <Tooltip label={label} details={detail ? [{ label: detail }] : []}>
      <span class="extension-state-button-wrap">
        <button
          type="button"
          class={`extension-state-button ${active ? "active" : ""}`.trim()}
          aria-pressed={active}
          aria-label={active ? `${ariaLabel}: ${label}` : `${ariaLabel}: set ${label}`}
          disabled={unavailable}
          onclick={() => onSelect(option.state)}
        >
          {#if option.state === "default_loaded"}
            <CheckCircleIcon aria-hidden="true" size={13} strokeWidth={1.9} />
          {:else if option.state === "available"}
            <CircleDashedIcon aria-hidden="true" size={13} strokeWidth={1.9} />
          {:else}
            <BanIcon aria-hidden="true" size={13} strokeWidth={1.9} />
          {/if}
        </button>
      </span>
    </Tooltip>
  {/each}
</div>

<style>
  .extension-state-buttons {
    display: grid;
    grid-template-columns: repeat(3, 1.54rem);
    gap: 0.18rem;
  }

  .extension-state-button-wrap {
    display: inline-grid;
  }

  .extension-state-button {
    display: grid;
    place-items: center;
    width: 1.38rem;
    height: 1.28rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
  }

  .extension-state-button:hover:not(:disabled),
  .extension-state-button:focus-visible:not(:disabled) {
    outline: none;
    border-color: var(--ui-border-strong);
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .extension-state-button:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .extension-state-button.active {
    border-color: color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border-strong));
    background: color-mix(in oklab, var(--ui-surface-subtle) 92%, var(--ui-surface-muted));
    color: var(--ui-text-primary);
  }

  .extension-state-button:disabled {
    cursor: default;
    opacity: 0.48;
  }

  .extension-state-button.active:disabled {
    opacity: 1;
  }
</style>
