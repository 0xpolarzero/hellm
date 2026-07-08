<script lang="ts">
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import ArrowUpToLineIcon from "@lucide/svelte/icons/arrow-up-to-line";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import { onDestroy } from "svelte";
  import { flip } from "svelte/animate";
  import type { AgentContextPreviewResponse } from "../shared/workspace-contract";
  import type { ExtensionUsageState } from "@svvy/core";
  import {
    canSelectExtensionUsageState,
    type AgentContextActor,
    type ExtensionUsageControlItem,
  } from "./agents-pane-extension-usage";
  import { formatTokenCount } from "./chat-format";
  import ExtensionListRow from "./ExtensionListRow.svelte";
  import ExtensionStateButtons from "./ExtensionStateButtons.svelte";
  import { queuedMessageOrderChanged, reorderQueuedMessageItems } from "./queued-message-order";
  import Tooltip from "./ui/Tooltip.svelte";

  type Props = {
    disabled?: boolean;
    actor: AgentContextActor;
    extensionOrder: readonly string[];
    items: ExtensionUsageControlItem[];
    loading?: boolean;
    preview: AgentContextPreviewResponse | null;
    previewError?: string | null;
    onOpenExtension: (extensionId: string) => void;
    onOrderChange: (extensionIds: string[]) => void | Promise<void>;
    onResetOrder: () => void | Promise<void>;
    onResetSelection: () => void | Promise<void>;
    onSetExtensionDefault: (
      extensionId: string,
      state: ExtensionUsageState,
    ) => void | Promise<void>;
    onStateChange: (extensionId: string, state: ExtensionUsageState) => void | Promise<void>;
  };

  const STATES: Array<{ state: ExtensionUsageState; label: string }> = [
    { state: "loaded", label: "Loaded" },
    { state: "available", label: "Available" },
    { state: "unavailable", label: "Off" },
  ];

  let {
    disabled = false,
    actor,
    extensionOrder,
    items,
    loading = false,
    preview,
    previewError = null,
    onOpenExtension,
    onOrderChange,
    onResetOrder,
    onResetSelection,
    onSetExtensionDefault,
    onStateChange,
  }: Props = $props();

  let expandedIds = $state<Set<string>>(new Set());
  let pendingStateKey = $state<string | null>(null);
  let pendingDefaultKey = $state<string | null>(null);
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
  const previewExtensions = $derived(
    new Map((preview?.extensions ?? []).map((extension) => [extension.id, extension])),
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

  function formatPromptTokenCount(tokens: number): string {
    return `~${formatTokenCount(tokens)} tokens`;
  }

  function extensionTokenLabel(item: ExtensionUsageControlItem): string | null {
    if (item.state === "unavailable") return null;
    const previewExtension = previewExtensions.get(item.id);
    const tokenCount = previewExtension?.tokenCount;
    if (!tokenCount) return null;
    if (item.state === "available" && previewExtension.loadedTokenCount) {
      return `${formatPromptTokenCount(tokenCount.tokens)} (~${formatTokenCount(
        previewExtension.loadedTokenCount.tokens,
      )} loaded)`;
    }
    return formatPromptTokenCount(tokenCount.tokens);
  }

  function stateLabel(state: ExtensionUsageState): string {
    return STATES.find((entry) => entry.state === state)?.label ?? "Off";
  }

  function actorDefaultLabel(kind: AgentContextActor): string {
    if (kind === "orchestrator") return "orchestrator";
    if (kind === "workflow-task") return "workflow task";
    return "handler";
  }

  function canSetActorDefault(kind: AgentContextActor): kind is "orchestrator" | "workflow-task" {
    return kind === "orchestrator" || kind === "workflow-task";
  }

  async function setExtensionDefault(item: ExtensionUsageControlItem) {
    if (!canSetActorDefault(actor) || pendingDefaultKey !== null || !item.explicit) return;
    pendingDefaultKey = item.id;
    try {
      await onSetExtensionDefault(item.id, item.state);
    } finally {
      pendingDefaultKey = null;
    }
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
    <div class="profile-extension-actions">
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
    {#if preview}
      <span class="profile-extension-total">{formatPromptTokenCount(preview.tokenCount.tokens)} total</span>
    {/if}
    {#if previewError}
      <span class="profile-extension-preview-error" title={previewError}>Preview failed</span>
    {/if}
  </div>

  <div class="profile-extension-list" bind:this={listElement}>
    {#each displayItems as item (item.id)}
      {@const expanded = expandedIds.has(item.id)}
      {@const tokenLabel = extensionTokenLabel(item)}
      <div
        data-extension-id={item.id}
        data-draggable={item.state !== "unavailable" ? "true" : "false"}
        animate:flip={{ duration: draggedExtensionId ? 150 : 0 }}
      >
        <ExtensionListRow
          id={item.id}
          title={item.title}
          description={item.description}
          marked={item.explicit}
          subdued={item.state === "unavailable"}
          dragging={item.id === draggedExtensionId}
          draggable={!disabled && item.state !== "unavailable"}
          dragLabel={`Reorder ${item.title}`}
          expanded={expanded}
          expandedInset={false}
          controlActionVisible={item.explicit && canSetActorDefault(actor)}
          tokenLabel={tokenLabel}
          onDragPointerDown={(event) => startDrag(event, item)}
          onToggle={() => toggleInstruction(item.id)}
        >
          {#snippet controlAction()}
            <Tooltip
              class="profile-extension-default-tooltip"
              label="Set as actor default"
              details={[{ label: `Use ${stateLabel(item.state)} as the default for new ${actorDefaultLabel(actor)} actors that include ${item.title}. Existing profile overrides stay unchanged.` }]}
            >
              <button
                type="button"
                class="profile-extension-default"
                aria-label={`Use ${item.title} ${stateLabel(item.state)} as the default for new ${actorDefaultLabel(actor)} actors`}
                disabled={disabled || pendingDefaultKey !== null}
                onclick={() => setExtensionDefault(item)}
              >
                <ArrowUpToLineIcon size={12} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </Tooltip>
          {/snippet}
          {#snippet stateControls()}
            <ExtensionStateButtons
              ariaLabel={`${item.title} usage state`}
              selected={item.state}
              disabled={disabled || !item.configurable}
              isAllowed={(state) => item.allowedStates[state]}
              labelFor={stateLabel}
              onSelect={(state) => selectState(item, state)}
            />
          {/snippet}
          {#snippet actions()}
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
          {/snippet}
          {#snippet expandedContent()}
            <pre class="profile-extension-instruction">{stateInstruction(item)}</pre>
          {/snippet}
        </ExtensionListRow>
      </div>
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
    justify-content: space-between;
    align-items: center;
    gap: 0.34rem;
    min-width: 0;
  }

  .profile-extension-actions {
    display: flex;
    gap: 0.34rem;
    min-width: 0;
  }

  .profile-extension-total {
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-extension-preview-error {
    flex: 0 0 auto;
    overflow: hidden;
    color: var(--ui-danger);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .profile-extension-action:hover:not(:disabled),
  .profile-extension-action:focus-visible:not(:disabled) {
    outline: none;
    border-color: var(--ui-border-strong);
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .profile-extension-action:focus-visible,
  .profile-extension-open:focus-visible,
  .profile-extension-default:focus-visible {
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

  .profile-extension-open {
    cursor: pointer;
  }

  :global(.profile-extension-default-tooltip) {
    align-items: center;
    display: inline-grid;
    height: 1rem;
    line-height: 1;
  }

  .profile-extension-default {
    display: grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-accent-soft) 58%, transparent);
    color: var(--ui-accent);
    cursor: pointer;
    line-height: 1;
  }

  .profile-extension-default:hover:not(:disabled),
  .profile-extension-default:focus-visible:not(:disabled),
  .profile-extension-open:hover {
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .profile-extension-default:disabled {
    cursor: default;
    opacity: 0.58;
  }

  .profile-extension-instruction {
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
