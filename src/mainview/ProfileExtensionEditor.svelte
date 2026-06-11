<script lang="ts">
  import BanIcon from "@lucide/svelte/icons/ban";
  import CheckCircleIcon from "@lucide/svelte/icons/check-circle";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import { onDestroy } from "svelte";
  import { flip } from "svelte/animate";
  import type { AgentContextPreviewResponse } from "../shared/workspace-contract";
  import type { ExtensionUsageState } from "../shared/extensions";
  import {
    canSelectExtensionUsageState,
    type ExtensionUsageControlItem,
  } from "./agents-pane-extension-usage";
  import { queuedMessageOrderChanged, reorderQueuedMessageItems } from "./queued-message-order";
  import Tooltip from "./ui/Tooltip.svelte";

  type Props = {
    disabled?: boolean;
    extensionOrder: readonly string[];
    items: ExtensionUsageControlItem[];
    loading?: boolean;
    preview: AgentContextPreviewResponse | null;
    onOpenExtension: (extensionId: string) => void;
    onOrderChange: (extensionIds: string[]) => void | Promise<void>;
    onResetOrder: () => void | Promise<void>;
    onResetSelection: () => void | Promise<void>;
    onStateChange: (extensionId: string, state: ExtensionUsageState) => void | Promise<void>;
  };

  const STATES: Array<{ state: ExtensionUsageState; label: string }> = [
    { state: "default_loaded", label: "Loaded" },
    { state: "available", label: "Available" },
    { state: "unavailable", label: "Off" },
  ];

  let {
    disabled = false,
    extensionOrder,
    items,
    loading = false,
    preview,
    onOpenExtension,
    onOrderChange,
    onResetOrder,
    onResetSelection,
    onStateChange,
  }: Props = $props();

  let expandedIds = $state<Set<string>>(new Set());
  let pendingStateKey = $state<string | null>(null);
  let pendingAction = $state<"selection" | "order" | null>(null);
  let listElement = $state<HTMLElement | null>(null);
  let drag = $state<{
    extensionId: string;
    pointerId: number;
    startY: number;
    didMove: boolean;
  } | null>(null);
  let dragCaptureElement: HTMLElement | null = null;
  let draggedExtensionId = $state<string | null>(null);
  let dropBeforeExtensionId = $state<string | null>(null);

  const previewInstructions = $derived(
    new Map((preview?.extensions ?? []).map((extension) => [extension.id, extension.instruction])),
  );
  const displayItems = $derived(
    orderedItems(items, extensionOrder, draggedExtensionId, dropBeforeExtensionId),
  );
  const activeItems = $derived(displayItems.filter((item) => item.state !== "unavailable"));

  onDestroy(() => {
    removeDragListeners();
  });

  function orderedItems(
    inputItems: readonly ExtensionUsageControlItem[],
    order: readonly string[],
    movingId: string | null,
    beforeId: string | null,
  ): ExtensionUsageControlItem[] {
    const baseOrderById = new Map(inputItems.map((item, index) => [item.id, index]));
    const explicitOrderById = new Map(order.map((id, index) => [id, index]));
    const active = inputItems
      .filter((item) => item.state !== "unavailable")
      .toSorted((left, right) => {
        const leftOrder = explicitOrderById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = explicitOrderById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return (baseOrderById.get(left.id) ?? 0) - (baseOrderById.get(right.id) ?? 0);
      });
    const reorderedActive = reorderQueuedMessageItems(active, movingId, beforeId);
    return [...reorderedActive, ...inputItems.filter((item) => item.state === "unavailable")];
  }

  function activeOrderIds(inputItems = activeItems): string[] {
    return inputItems.map((item) => item.id);
  }

  function toggleInstruction(extensionId: string) {
    if (expandedIds.has(extensionId)) {
      expandedIds.delete(extensionId);
    } else {
      expandedIds.add(extensionId);
    }
    expandedIds = new Set(expandedIds);
  }

  async function selectState(item: ExtensionUsageControlItem, state: ExtensionUsageState) {
    if (pendingStateKey !== null) return;
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
    pendingStateKey = `${item.id}:${state}`;
    try {
      await onStateChange(item.id, state);
    } finally {
      pendingStateKey = null;
    }
  }

  async function resetSelection() {
    if (disabled || pendingAction) return;
    pendingAction = "selection";
    try {
      await onResetSelection();
    } finally {
      pendingAction = null;
    }
  }

  async function resetOrder() {
    if (disabled || pendingAction) return;
    pendingAction = "order";
    try {
      await onResetOrder();
    } finally {
      pendingAction = null;
    }
  }

  function stateInstruction(item: ExtensionUsageControlItem): string {
    const instruction = previewInstructions.get(item.id)?.trim();
    if (instruction) return instruction;
    if (item.state === "unavailable") {
      return "This extension is off for this profile and does not add generated instructions.";
    }
    if (loading) return "Loading instructions...";
    return "No generated instruction is available for this extension.";
  }

  function stateLabel(state: ExtensionUsageState): string {
    return STATES.find((entry) => entry.state === state)?.label ?? "Off";
  }

  function addDragListeners() {
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
  }

  function removeDragListeners() {
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerCancel);
  }

  function startDrag(event: PointerEvent, item: ExtensionUsageControlItem) {
    if (disabled || item.state === "unavailable") return;
    drag = {
      extensionId: item.id,
      pointerId: event.pointerId,
      startY: event.clientY,
      didMove: false,
    };
    draggedExtensionId = null;
    dropBeforeExtensionId = null;
    dragCaptureElement = event.currentTarget as HTMLElement;
    dragCaptureElement.setPointerCapture(event.pointerId);
    addDragListeners();
  }

  function getDropTarget(clientY: number): string | null {
    const candidates = [...(listElement?.querySelectorAll<HTMLElement>("[data-draggable='true']") ?? [])]
      .filter((element) => element.dataset.extensionId !== draggedExtensionId);
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return element.dataset.extensionId ?? null;
      }
    }
    return null;
  }

  function applyDragMove(clientY: number) {
    if (!drag) return;
    const didMove = drag.didMove || Math.abs(clientY - drag.startY) > 5;
    if (!didMove) return;
    if (!drag.didMove) {
      draggedExtensionId = drag.extensionId;
    }
    drag = { ...drag, didMove: true };
    dropBeforeExtensionId = getDropTarget(clientY);
  }

  function handleWindowPointerMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    applyDragMove(event.clientY);
    if (drag.didMove || Math.abs(event.clientY - drag.startY) > 5) {
      event.preventDefault();
    }
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelDrag();
  }

  function handleWindowPointerUp(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    void finishDrag(event.clientY);
  }

  function releasePointerCapture(pointerId: number) {
    if (dragCaptureElement?.hasPointerCapture(pointerId)) {
      dragCaptureElement.releasePointerCapture(pointerId);
    }
    dragCaptureElement = null;
  }

  function cancelDrag() {
    if (!drag) return;
    releasePointerCapture(drag.pointerId);
    removeDragListeners();
    drag = null;
    draggedExtensionId = null;
    dropBeforeExtensionId = null;
  }

  async function finishDrag(clientY: number) {
    if (!drag) return;
    applyDragMove(clientY);
    const completedDrag = drag.didMove;
    const movingId = drag.extensionId;
    const beforeId = dropBeforeExtensionId;
    const pointerId = drag.pointerId;
    drag = null;
    draggedExtensionId = null;
    dropBeforeExtensionId = null;
    releasePointerCapture(pointerId);
    removeDragListeners();
    if (!completedDrag || !queuedMessageOrderChanged(activeItems, movingId, beforeId)) return;
    await onOrderChange(activeOrderIds(reorderQueuedMessageItems(activeItems, movingId, beforeId)));
  }
</script>

<div class="profile-extension-editor">
  <div class="profile-extension-toolbar">
    <Tooltip label="Reset extension selection to builtin defaults">
      <button
        type="button"
        class="profile-extension-action"
        disabled={disabled || pendingAction !== null}
        onclick={resetSelection}
      >
        <RotateCcwIcon size={12} aria-hidden="true" />
        Selection
      </button>
    </Tooltip>
    <Tooltip label="Reset instruction order to builtin defaults">
      <button
        type="button"
        class="profile-extension-action"
        disabled={disabled || pendingAction !== null}
        onclick={resetOrder}
      >
        <RotateCcwIcon size={12} aria-hidden="true" />
        Order
      </button>
    </Tooltip>
  </div>

  <div class="profile-extension-list" bind:this={listElement}>
    {#each displayItems as item (item.id)}
      {@const expanded = expandedIds.has(item.id)}
      <article
        class={`profile-extension-row ${item.explicit ? "is-override" : ""} ${item.state === "unavailable" ? "is-off" : ""} ${item.id === draggedExtensionId ? "dragging" : ""}`.trim()}
        data-extension-id={item.id}
        data-draggable={item.state !== "unavailable" ? "true" : "false"}
        animate:flip={{ duration: 150 }}
      >
        <button
          type="button"
          class="profile-extension-drag"
          aria-label={`Reorder ${item.title}`}
          disabled={disabled || item.state === "unavailable"}
          onpointerdown={(event) => startDrag(event, item)}
        >
          <GripVerticalIcon size={13} aria-hidden="true" />
        </button>
        <div class="profile-extension-copy">
          <button
            type="button"
            class="profile-extension-title-button"
            aria-expanded={expanded}
            aria-label={expanded ? `Hide ${item.title} instructions` : `Show ${item.title} instructions`}
            onclick={() => toggleInstruction(item.id)}
          >
            <span class="profile-extension-title">{item.title}</span>
            <span class="profile-extension-override" aria-hidden={!item.explicit}>
              override
            </span>
          </button>
          <p>{item.description}</p>
        </div>
        <div class="profile-extension-controls" aria-label={`${item.title} usage state`}>
          {#each STATES as option (option.state)}
            {@const selected = item.state === option.state}
            {@const unavailable = disabled || !item.configurable || !item.allowedStates[option.state]}
            <Tooltip label={option.label}>
              <span class="profile-extension-state-wrap">
                <button
                  type="button"
                  class={`profile-extension-state ${selected ? "active" : ""}`.trim()}
                  aria-pressed={selected}
                  aria-label={selected ? `${item.title} is ${option.label}` : `Set ${item.title} to ${option.label}`}
                  disabled={unavailable}
                  onclick={() => selectState(item, option.state)}
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
        <Tooltip label="Open extension">
          <button
            type="button"
            class="profile-extension-open"
            aria-label={`Open ${item.title} in Extensions`}
            onclick={() => onOpenExtension(item.id)}
          >
            <ExternalLinkIcon size={12} aria-hidden="true" />
          </button>
        </Tooltip>
        <button
          type="button"
          class="profile-extension-disclosure"
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${item.title} instructions` : `Show ${item.title} instructions`}
          onclick={() => toggleInstruction(item.id)}
        >
          {#if expanded}
            <ChevronDownIcon size={13} aria-hidden="true" />
          {:else}
            <ChevronRightIcon size={13} aria-hidden="true" />
          {/if}
        </button>
        {#if expanded}
          <pre class="profile-extension-instruction">{stateInstruction(item)}</pre>
        {/if}
      </article>
    {/each}
  </div>
</div>

<style>
  .profile-extension-editor {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
  }

  .profile-extension-toolbar {
    display: flex;
    justify-content: flex-end;
    gap: 0.34rem;
  }

  .profile-extension-action {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    height: 1.42rem;
    padding: 0 0.42rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-secondary);
    cursor: pointer;
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .profile-extension-action:hover,
  .profile-extension-action:focus-visible {
    outline: none;
    border-color: var(--ui-border-strong);
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .profile-extension-action:focus-visible,
  .profile-extension-drag:focus-visible,
  .profile-extension-disclosure:focus-visible,
  .profile-extension-title-button:focus-visible,
  .profile-extension-state:focus-visible,
  .profile-extension-open:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .profile-extension-action:disabled {
    cursor: default;
    opacity: 0.58;
  }

  .profile-extension-list {
    display: grid;
    gap: 0.28rem;
    min-width: 0;
  }

  .profile-extension-row {
    display: grid;
    grid-template-columns: 1.1rem minmax(8rem, 1fr) auto 1.28rem 1.28rem;
    gap: 0.3rem;
    align-items: center;
    min-width: 0;
    padding: 0.42rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 58%, transparent);
  }

  .profile-extension-row.is-off {
    opacity: 0.72;
  }

  .profile-extension-row.dragging {
    opacity: 0.62;
  }

  .profile-extension-drag,
  .profile-extension-disclosure,
  .profile-extension-open {
    display: grid;
    place-items: center;
    width: 1.1rem;
    height: 1.28rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
  }

  .profile-extension-drag {
    align-self: center;
    cursor: grab;
    touch-action: none;
  }

  .profile-extension-drag:disabled {
    cursor: default;
    opacity: 0.42;
  }

  .profile-extension-disclosure,
  .profile-extension-open {
    cursor: pointer;
  }

  .profile-extension-drag:not(:disabled):hover,
  .profile-extension-disclosure:hover,
  .profile-extension-open:hover {
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .profile-extension-copy {
    display: grid;
    gap: 0.12rem;
    min-width: 0;
  }

  .profile-extension-title-button {
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    justify-self: start;
    max-width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  .profile-extension-title-button:hover .profile-extension-title,
  .profile-extension-title-button:focus-visible .profile-extension-title {
    color: var(--ui-text-primary);
    text-decoration-color: color-mix(in oklab, var(--ui-accent) 58%, transparent);
  }

  .profile-extension-title {
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.28;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.16rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-extension-row.is-override .profile-extension-title {
    text-decoration-color: var(--ui-accent);
  }

  .profile-extension-override {
    color: var(--ui-accent);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .profile-extension-override[aria-hidden="true"] {
    visibility: hidden;
  }

  .profile-extension-copy p {
    margin: 0;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    line-height: 1.35;
  }

  .profile-extension-controls {
    display: grid;
    grid-template-columns: repeat(3, 1.54rem);
    gap: 0.18rem;
  }

  .profile-extension-state-wrap {
    display: inline-grid;
  }

  .profile-extension-state {
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

  .profile-extension-state:hover:not(:disabled),
  .profile-extension-state:focus-visible {
    outline: none;
    border-color: var(--ui-border-strong);
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .profile-extension-state.active {
    border-color: color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border-strong));
    background: color-mix(in oklab, var(--ui-surface-subtle) 92%, var(--ui-surface-muted));
    color: var(--ui-text-primary);
  }

  .profile-extension-state:disabled {
    cursor: default;
    opacity: 0.48;
  }

  .profile-extension-state.active:disabled {
    opacity: 1;
  }

  .profile-extension-instruction {
    grid-column: 2 / -1;
    max-height: 18rem;
    min-width: 0;
    overflow: auto;
    margin: 0.12rem 0 0;
    padding: 0.5rem 0.56rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-code);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
  }
</style>
