<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import FolderGit2Icon from "@lucide/svelte/icons/folder-git-2";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import { onMount, tick } from "svelte";

  export type CompactSelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
  };

  type Props = {
    value: string;
    options: CompactSelectOption[];
    ariaLabel: string;
    disabled?: boolean;
    triggerClass?: string;
    menuClass?: string;
    optionClass?: string;
    leadingIcon?: "branch" | "history" | "workspace";
    textTransform?: "none" | "lowercase";
    placement?: "above" | "below";
    open?: boolean;
    onBeforeOpen?: () => void | Promise<void>;
    onSelect: (value: string) => void | Promise<void>;
  };

  let {
    value,
    options,
    ariaLabel,
    disabled = false,
    triggerClass = "",
    menuClass = "",
    optionClass = "",
    leadingIcon,
    textTransform = "none",
    placement = "above",
    open = $bindable(false),
    onBeforeOpen,
    onSelect,
  }: Props = $props();

  let root = $state<HTMLDivElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let menuElement = $state<HTMLDivElement | null>(null);
  let opening = $state(false);
  let menuStyle = $state("");
  const selectedOption = $derived(options.find((option) => option.value === value));
  const triggerLabel = $derived(selectedOption?.label ?? value);

  $effect(() => {
    if (!open) return;
    void value;
    void options.length;
    positionMenu();
  });

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || root?.contains(target) || menuElement?.contains(target)) return;
      open = false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        open = false;
      }
    };

    const handleViewportChange = () => {
      if (open) {
        positionMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  });

  function portalMenu(node: HTMLElement) {
    document.body.append(node);

    return {
      destroy() {
        node.remove();
      },
    };
  }

  function clampPosition(nextValue: number, minimum: number, maximum: number) {
    if (maximum < minimum) return minimum;
    return Math.min(Math.max(nextValue, minimum), maximum);
  }

  function positionMenu() {
    if (!triggerElement) return;
    const rect = triggerElement.getBoundingClientRect();
    const gap = 5;
    const viewportPadding = 8;
    const availableWidth = Math.max(128, window.innerWidth - viewportPadding * 2);
    const targetWidth = Math.min(Math.max(rect.width, 104), availableWidth);
    const measuredRect = menuElement?.getBoundingClientRect();
    const menuWidth = Math.min(measuredRect?.width ?? targetWidth, availableWidth);
    const menuHeight = measuredRect?.height ?? 192;
    const spaceAbove = rect.top - viewportPadding - gap;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const resolvedPlacement =
      placement === "below"
        ? spaceBelow >= menuHeight || spaceBelow >= spaceAbove
          ? "below"
          : "above"
        : spaceAbove >= menuHeight || spaceAbove >= spaceBelow
          ? "above"
          : "below";
    const unclampedTop = resolvedPlacement === "below" ? rect.bottom + gap : rect.top - menuHeight - gap;
    const top = clampPosition(unclampedTop, viewportPadding, window.innerHeight - menuHeight - viewportPadding);
    const left = clampPosition(rect.left, viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    menuStyle = `left: ${left}px; top: ${top}px; width: ${targetWidth}px; max-width: ${availableWidth}px;`;
  }

  async function selectOption(option: CompactSelectOption) {
    if (option.disabled || option.value === value) {
      open = false;
      return;
    }

    await onSelect(option.value);
    open = false;
  }

  async function toggleOpen() {
    if (opening) return;

    if (open) {
      open = false;
      return;
    }

    opening = true;
    try {
      await onBeforeOpen?.();
      positionMenu();
      open = true;
      await tick();
      positionMenu();
    } finally {
      opening = false;
    }
  }
</script>

<div class="compact-select" bind:this={root}>
  <button
    bind:this={triggerElement}
    class={`compact-select-trigger ${triggerClass}`.trim()}
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    {disabled}
    onclick={toggleOpen}
  >
    {#if leadingIcon === "branch"}
      <GitBranchIcon size={12} aria-hidden="true" />
    {:else if leadingIcon === "history"}
      <HistoryIcon size={12} aria-hidden="true" />
    {:else if leadingIcon === "workspace"}
      <FolderGit2Icon size={12} aria-hidden="true" />
    {/if}
    <span class="compact-select-label">{triggerLabel}</span>
    <span class={`compact-select-caret ${open ? "open" : ""}`.trim()} aria-hidden="true">
      <ChevronDownIcon size={13} strokeWidth={1.9} />
    </span>
  </button>
  {#if open}
    <div
      bind:this={menuElement}
      use:portalMenu
      class={`compact-select-menu ${menuClass}`.trim()}
      style={menuStyle}
      role="listbox"
      aria-label={ariaLabel}
    >
      {#each options as option (option.value)}
        {@const selected = option.value === value}
        <button
          class={`compact-select-option ${optionClass} ${selected ? "active" : ""}`.trim()}
          class:text-lowercase={textTransform === "lowercase"}
          type="button"
          role="option"
          aria-selected={selected}
          disabled={option.disabled}
          onclick={() => selectOption(option)}
        >
          <span>{option.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .compact-select {
    position: relative;
    display: inline-flex;
    align-items: flex-start;
    min-width: 0;
    --compact-control-font-family: var(--font-mono);
    --compact-control-font-weight: 500;
  }

  .compact-select-trigger {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    min-width: 0;
    overflow: visible;
  }

  .compact-select-trigger.model-pill {
    max-width: 12.5rem;
    min-height: 1.45rem;
    padding: 0.08rem 0.18rem 0.08rem 0.44rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-md);
    background: transparent;
    color: var(--ui-text-tertiary);
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
    line-height: 1;
    cursor: pointer;
    transition:
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .compact-select-trigger.model-pill.thinking-field {
    max-width: 7rem;
  }

  .compact-select-trigger.model-pill:hover,
  .compact-select-trigger.model-pill:focus-visible {
    outline: none;
    border-color: var(--ui-border-soft);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .compact-select-trigger.model-pill:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .compact-select-trigger.ghost-select,
  .compact-select-trigger.history-trigger,
  .compact-select-trigger.workspace-path {
    max-width: 100%;
    min-height: 1.45rem;
    padding: 0.08rem 0.16rem 0.08rem 0.44rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .compact-select-trigger.workspace-path {
    min-height: 1.45rem;
    padding: 0 0.22rem 0 0.28rem;
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
  }

  .compact-select-trigger.history-trigger {
    color: var(--ui-text-tertiary);
    font-family: var(--compact-control-font-family);
    font-weight: var(--compact-control-font-weight);
  }

  .compact-select-trigger.ghost-select.thinking-field {
    max-width: 7rem;
    color: var(--ui-text-tertiary);
    font-family: var(--compact-control-font-family);
    font-weight: var(--compact-control-font-weight);
    line-height: 1;
  }

  .compact-select-trigger.ghost-select:hover,
  .compact-select-trigger.ghost-select:focus-visible,
  .compact-select-trigger.history-trigger:hover,
  .compact-select-trigger.history-trigger:focus-visible,
  .compact-select-trigger.workspace-path:hover,
  .compact-select-trigger.workspace-path:focus-visible {
    outline: none;
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .compact-select-trigger.ghost-select:focus-visible,
  .compact-select-trigger.history-trigger:focus-visible,
  .compact-select-trigger.workspace-path:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .compact-select-trigger.ghost-select:disabled,
  .compact-select-trigger.history-trigger:disabled,
  .compact-select-trigger.workspace-path:disabled {
    cursor: default;
    opacity: 0.78;
  }

  .compact-select-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.35;
    padding-block: 0.08rem;
    margin-block: -0.08rem;
  }

  .compact-select-caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.72rem;
    height: 0.72rem;
    flex: 0 0 auto;
    overflow: visible;
    pointer-events: none;
    transition: transform 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .compact-select-trigger :global(.compact-select-chevron) {
    width: 0.72rem;
    height: 0.72rem;
    flex: 0 0 auto;
    transition: transform 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .compact-select-caret.open,
  .compact-select-trigger :global(.compact-select-chevron.open) {
    transform: rotate(180deg);
  }

  .compact-select-menu {
    position: fixed;
    z-index: var(--ui-z-overlay);
    display: grid;
    gap: 0;
    min-width: 6.5rem;
    max-width: min(12rem, calc(100vw - 2rem));
    padding: 0.28rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-raised) 96%, transparent);
    box-shadow:
      0 18px 48px color-mix(in oklab, var(--ui-shadow) 28%, transparent),
      0 0 0 1px color-mix(in oklab, var(--ui-surface) 60%, transparent);
    backdrop-filter: blur(16px);
    transform-origin: bottom right;
  }

  .compact-select-menu.branch-menu {
    min-width: 8rem;
    width: max-content;
    max-height: 14rem;
    overflow: auto;
  }

  .compact-select-menu.history-menu {
    min-width: 18rem;
    width: max-content;
    max-width: min(28rem, calc(100vw - 2rem));
    max-height: 18rem;
    overflow: auto;
  }

  .compact-select-option.branch-option {
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
  }

  .compact-select-option.history-option {
    justify-content: flex-start;
    min-height: 1.9rem;
    max-width: 100%;
  }

  .compact-select-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    min-height: 1.8rem;
    padding: 0 0.56rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-secondary);
    font-family: var(--compact-control-font-family);
    font-size: var(--text-xs);
    font-weight: var(--compact-control-font-weight);
    line-height: 1;
    text-align: left;
    cursor: pointer;
  }

  .compact-select-option.text-lowercase {
    text-transform: lowercase;
  }

  .compact-select-option.active {
    background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
    color: var(--ui-text-primary);
  }

  .compact-select-option:hover:not(:disabled),
  .compact-select-option:focus-visible:not(:disabled) {
    outline: none;
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .compact-select-option:disabled {
    color: var(--ui-text-tertiary);
    cursor: default;
    opacity: 1;
  }

  .compact-select-option span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-bottom: 0.08rem;
    margin-bottom: -0.08rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .compact-select-caret,
    .compact-select-trigger :global(.compact-select-chevron) {
      transition: none;
    }
  }
</style>
