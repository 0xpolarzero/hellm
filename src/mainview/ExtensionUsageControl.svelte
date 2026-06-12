<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import { onDestroy, tick } from "svelte";
  import type { ExtensionCategory, ExtensionUsageState } from "../shared/extensions";
  import {
    canSelectExtensionUsageState,
    type ExtensionUsageControlItem,
  } from "./agents-pane-extension-usage";
  import ExtensionStateButtons from "./ExtensionStateButtons.svelte";
  import Tooltip from "./ui/Tooltip.svelte";

  const MENU_OPEN_EVENT = "svvy:extension-usage-menu-open";

  type Props = {
    ariaLabel: string;
    disabled?: boolean;
    items: ExtensionUsageControlItem[];
    onOpenExtension: (extensionId: string) => void;
    onStateChange: (extensionId: string, state: ExtensionUsageState) => void | Promise<void>;
  };

  const STATES: Array<{ state: ExtensionUsageState; label: string }> = [
    { state: "default_loaded", label: "Default loaded" },
    { state: "available", label: "Available" },
    { state: "unavailable", label: "Off" },
  ];

  let { ariaLabel, disabled = false, items, onOpenExtension, onStateChange }: Props = $props();

  let root = $state<HTMLDivElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let menuElement = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  let pendingKey = $state<string | null>(null);
  let menuStyle = $state("");

  const overrideCount = $derived(items.filter((item) => item.explicit).length);
  const triggerLabel = "Extensions";

  onDestroy(() => {
    removeWindowListeners();
    menuElement?.remove();
  });

  $effect(() => {
    if (!open) return;
    positionMenu();
  });

  function portalMenu(node: HTMLElement) {
    document.body.append(node);
    menuElement = node;

    return {
      destroy() {
        node.remove();
        if (menuElement === node) {
          menuElement = null;
        }
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
    const targetWidth = Math.min(460, Math.max(360, window.innerWidth - viewportPadding * 2));
    const measuredRect = menuElement?.getBoundingClientRect();
    const menuWidth = Math.min(measuredRect?.width ?? targetWidth, window.innerWidth - viewportPadding * 2);
    const menuHeight = Math.min(measuredRect?.height ?? 280, window.innerHeight - viewportPadding * 2);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const spaceAbove = rect.top - viewportPadding - gap;
    const top =
      spaceBelow >= menuHeight || spaceBelow >= spaceAbove
        ? clampPosition(rect.bottom + gap, viewportPadding, window.innerHeight - menuHeight - viewportPadding)
        : clampPosition(rect.top - menuHeight - gap, viewportPadding, window.innerHeight - menuHeight - viewportPadding);
    const left = clampPosition(rect.left, viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    menuStyle = `left: ${left}px; top: ${top}px; width: ${targetWidth}px; max-height: ${menuHeight}px;`;
  }

  function addWindowListeners() {
    window.addEventListener("pointerdown", handleWindowPointerDown);
    window.addEventListener("keydown", handleWindowKeydown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener(MENU_OPEN_EVENT, handlePeerMenuOpen);
  }

  function removeWindowListeners() {
    window.removeEventListener("pointerdown", handleWindowPointerDown);
    window.removeEventListener("keydown", handleWindowKeydown);
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("scroll", handleViewportChange, true);
    window.removeEventListener(MENU_OPEN_EVENT, handlePeerMenuOpen);
  }

  function handleWindowPointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (root?.contains(target) || menuElement?.contains(target)) return;
    closeMenu();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeMenu();
    }
  }

  function handleViewportChange() {
    if (open) {
      positionMenu();
    }
  }

  function handlePeerMenuOpen(event: Event) {
    const peerRoot = (event as CustomEvent<{ root: HTMLDivElement | null }>).detail?.root;
    if (peerRoot !== root) {
      closeMenu();
    }
  }

  async function openMenu() {
    if (disabled || open) return;
    window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, { detail: { root } }));
    open = true;
    addWindowListeners();
    await tick();
    positionMenu();
  }

  function closeMenu() {
    open = false;
    removeWindowListeners();
  }

  async function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }
    await openMenu();
  }

  function stateLabel(state: ExtensionUsageState): string {
    return STATES.find((entry) => entry.state === state)?.label ?? "Off";
  }

  function categoryLabel(category: ExtensionCategory): string {
    if (category === "external_instruction") return "External";
    if (category === "user") return "User";
    return "Builtin";
  }

  function stateTooltipDetail(item: ExtensionUsageControlItem, state: ExtensionUsageState): string {
    if (!item.configurable) {
      if (item.fixedReason === "app_native_control") {
        return "Extension Loading is an app-native control and stays loaded so agents can load available extensions at runtime.";
      }
      return "This extension is managed outside profile extension overrides.";
    }
    if (!item.allowedStates[state]) {
      return `${item.title} cannot be set to ${stateLabel(state)} for this agent kind.`;
    }
    if (state === "default_loaded") {
      return "Load full instructions, tools, and generated declarations into new sessions using this profile.";
    }
    if (state === "available") {
      return "Keep minimal loading guidance visible so the agent can opt in with Extension Loading later.";
    }
    return "Keep this extension out of loaded and available generated context for this profile.";
  }

  async function selectState(item: ExtensionUsageControlItem, state: ExtensionUsageState) {
    if (pendingKey !== null) return;
    if (
      !canSelectExtensionUsageState({
        disabled,
        pending: false,
        item,
        state,
      })
    ) {
      return;
    }
    pendingKey = `${item.id}:${state}`;
    try {
      await onStateChange(item.id, state);
    } catch {
      // The parent save path owns the visible error state.
    } finally {
      pendingKey = null;
    }
  }

  function openExtension(item: ExtensionUsageControlItem) {
    onOpenExtension(item.id);
    closeMenu();
  }
</script>

<div class="extension-usage-control" bind:this={root}>
  <button
    bind:this={triggerElement}
    class="extension-usage-trigger model-pill extensions-field"
    type="button"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={ariaLabel}
    {disabled}
    onclick={toggleMenu}
  >
    <span class="extension-usage-trigger-label">{triggerLabel}</span>
    <span class={`extension-usage-caret ${open ? "open" : ""}`.trim()} aria-hidden="true">
      <ChevronDownIcon size={13} strokeWidth={1.9} />
    </span>
  </button>
  {#if open}
    <div
      use:portalMenu
      class="extension-usage-menu"
      style={menuStyle}
      role="dialog"
      aria-label={ariaLabel}
    >
      <div class="extension-usage-menu-header">
        <span>Extension usage</span>
        <span>{overrideCount} overrides</span>
      </div>
      <div class="extension-usage-list">
        {#each items as item (item.id)}
          <div
            class={`extension-usage-row ${item.configurable ? "" : "is-fixed-usage"} ${item.explicit ? "is-override-usage" : "is-default-usage"}`.trim()}
          >
            <strong class="extension-usage-title">
              <span class="extension-usage-title-text">{item.title}</span>
            </strong>
            <span class="extension-usage-category">{categoryLabel(item.category)}</span>
            <Tooltip
              label="Open extension"
              details={[{ label: "Show this extension in the Extensions pane." }]}
              side="bottom"
            >
              <button
                type="button"
                class="extension-open-button"
                aria-label={`Open ${item.title} in Extensions`}
                onclick={() => openExtension(item)}
              >
                <ExternalLinkIcon aria-hidden="true" size={12} strokeWidth={1.9} />
              </button>
            </Tooltip>
            <ExtensionStateButtons
              ariaLabel={`${item.title} usage state`}
              selected={item.state}
              disabled={disabled || !item.configurable}
              isAllowed={(state) => item.allowedStates[state]}
              labelFor={stateLabel}
              detailFor={(state) => stateTooltipDetail(item, state)}
              onSelect={(state) => selectState(item, state)}
            />
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .extension-usage-control {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }

  .extension-usage-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    min-width: 0;
    min-height: 1.45rem;
    padding: 0.08rem 0.18rem 0.08rem 0.44rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    line-height: 1;
  }

  .extension-usage-trigger:hover,
  .extension-usage-trigger:focus-visible {
    outline: none;
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .extension-usage-trigger:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .extension-usage-trigger:disabled {
    cursor: default;
    opacity: 0.72;
  }

  .extension-usage-trigger-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-usage-caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.72rem;
    height: 0.72rem;
    flex: 0 0 auto;
    transition: transform 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .extension-usage-caret.open {
    transform: rotate(180deg);
  }

  .extension-usage-menu {
    position: fixed;
    z-index: calc(var(--ui-z-dialog) - 1);
    isolation: isolate;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    padding: 0.34rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-elevated);
    box-shadow:
      0 18px 48px color-mix(in oklab, var(--ui-shadow) 28%, transparent),
      0 0 0 1px color-mix(in oklab, var(--ui-surface) 60%, transparent);
  }

  .extension-usage-menu-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.72rem;
    padding: 0.08rem 0.18rem 0.34rem;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 650;
    text-transform: uppercase;
  }

  .extension-usage-menu-header span:last-child {
    font-family: var(--font-mono);
    font-weight: 500;
    text-transform: none;
  }

  .extension-usage-list {
    display: grid;
    gap: 0.08rem;
    min-height: 0;
    overflow: auto;
    background: var(--ui-bg-elevated);
  }

  .extension-usage-row {
    display: grid;
    grid-template-columns: minmax(7rem, 1fr) 4.4rem 1.42rem auto;
    align-items: center;
    column-gap: 0.48rem;
    min-height: 1.94rem;
    overflow: hidden;
    padding: 0.26rem 0.34rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: var(--ui-bg-elevated);
    color: var(--ui-text-secondary);
  }

  .extension-usage-row:hover {
    background: color-mix(in oklab, var(--ui-surface-subtle) 70%, var(--ui-bg-elevated));
  }

  .extension-usage-row.is-override-usage {
    background: var(--ui-bg-elevated);
  }

  .extension-usage-row.is-override-usage:hover {
    background: color-mix(in oklab, var(--ui-surface-subtle) 70%, var(--ui-bg-elevated));
  }

  .extension-usage-row.is-fixed-usage {
    color: var(--ui-text-tertiary);
  }

  .extension-usage-title {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-usage-title-text {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    padding-bottom: 2px;
    background-image: none;
    background-repeat: no-repeat;
    background-position: 0 calc(100% - 1px);
    background-size: 100% 2px;
    text-overflow: ellipsis;
    vertical-align: bottom;
  }

  .extension-usage-row.is-override-usage .extension-usage-title-text {
    background-image: linear-gradient(var(--ui-accent), var(--ui-accent));
  }

  .extension-usage-category {
    justify-self: start;
    max-width: 100%;
    overflow: hidden;
    padding: 0.04rem 0.2rem;
    border-radius: var(--ui-radius-xs);
    background: color-mix(in oklab, var(--ui-surface-muted) 76%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-open-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.42rem;
    height: 1.42rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
    line-height: 1;
  }

  .extension-open-button:hover,
  .extension-open-button:focus-visible {
    outline: none;
    border-color: var(--ui-border-soft);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .extension-open-button:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  @media (max-width: 560px) {
    .extension-usage-row {
      grid-template-columns: minmax(0, 1fr) 1.42rem auto;
      align-items: center;
    }

    .extension-usage-category {
      display: none;
    }

  }

  @media (prefers-reduced-motion: reduce) {
    .extension-usage-caret {
      transition: none;
    }
  }
</style>
