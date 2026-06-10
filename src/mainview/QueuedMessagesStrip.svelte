<script lang="ts">
  import CornerUpRightIcon from "@lucide/svelte/icons/corner-up-right";
  import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
  import LockIcon from "@lucide/svelte/icons/lock";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { onDestroy } from "svelte";
  import { flip } from "svelte/animate";
  import type { QueuedPrompt } from "./chat-runtime";
  import { queuedMessageOrderChanged, reorderQueuedMessageItems } from "./queued-message-order";
  import Tooltip from "./ui/Tooltip.svelte";

  type Props = {
    queuedMessages: QueuedPrompt[];
    onEdit: (promptId: string) => void;
    onDelete: (promptId: string) => void;
    onSteer: (promptId: string) => void;
    onReorder: (promptId: string, beforePromptId: string | null) => void;
  };

  let { queuedMessages, onEdit, onDelete, onSteer, onReorder }: Props = $props();

  let stripElement = $state<HTMLElement | null>(null);
  let promptDrag = $state<{
    promptId: string;
    pointerId: number;
    startY: number;
    didMove: boolean;
  } | null>(null);
  let suppressClickPromptId: string | null = null;
  let draggedPromptId = $state<string | null>(null);
  let dropBeforePromptId = $state<string | null>(null);
  let pendingDragClientY: number | null = null;
  let dragAnimationFrame: number | null = null;

  const queuedCountLabel = $derived(
    queuedMessages.length === 1 ? "1 queued message" : `${queuedMessages.length} queued messages`,
  );
  const displayedQueuedMessages = $derived.by(() =>
    reorderQueuedMessageItems(queuedMessages, draggedPromptId, dropBeforePromptId),
  );

  function isLocked(prompt: QueuedPrompt): boolean {
    return prompt.status !== "queued";
  }

  function getStatusLabel(prompt: QueuedPrompt): string {
    if (prompt.status === "failed") return "Failed";
    if (prompt.status === "steering") return "Steering";
    if (prompt.status === "dispatching") {
      return prompt.kind === "agent_context_refresh" ? "Updating" : "Sending";
    }
    if (prompt.agentContextUpdate?.state === "out_of_date") return "Out of date";
    if (prompt.kind === "thread_report_notification") return "Report";
    if (prompt.kind === "agent_context_refresh") return "Context";
    if (prompt.kind === "report_request") return "Report request";
    return "Queued";
  }

  function getItemTitle(prompt: QueuedPrompt): string {
    if (prompt.status === "failed" && prompt.failureError) return prompt.failureError;
    return getItemText(prompt);
  }

  function getItemText(prompt: QueuedPrompt): string {
    if (prompt.kind === "thread_report_notification" && prompt.summary) return prompt.summary;
    if (prompt.kind === "agent_context_refresh") return prompt.summary ?? "Update agent context";
    return prompt.text;
  }

  function getContextChangeCount(prompt: QueuedPrompt): number {
    const update = prompt.agentContextUpdate;
    if (!update) return 0;
    return [
      update.systemPromptChanged ? 1 : 0,
      update.loadedExtensionIds.added.length,
      update.loadedExtensionIds.removed.length,
      update.availableExtensionIds.added.length,
      update.availableExtensionIds.removed.length,
      update.externalSourceHashes.added.length,
      update.externalSourceHashes.removed.length,
    ].reduce((sum, count) => sum + count, 0);
  }

  function getContextRevisionLabel(prompt: QueuedPrompt): string | null {
    const update = prompt.agentContextUpdate;
    if (!update) return null;
    return `r${update.requestedRevision}->r${update.currentRevision}`;
  }

  function getDropTarget(clientY: number): string | null {
    if (!stripElement) return null;

    const promptElements = Array.from(stripElement.querySelectorAll<HTMLElement>("[data-reorderable='true']"));
    for (const promptElement of promptElements) {
      if (promptElement.dataset.promptId === draggedPromptId) {
        continue;
      }

      const bounds = promptElement.getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) {
        return promptElement.dataset.promptId ?? null;
      }
    }

    return null;
  }

  function clearDragFrame() {
    if (dragAnimationFrame === null) return;
    window.cancelAnimationFrame(dragAnimationFrame);
    dragAnimationFrame = null;
    pendingDragClientY = null;
  }

  onDestroy(() => clearDragFrame());

  function handlePointerDown(event: PointerEvent, prompt: QueuedPrompt) {
    if (event.button !== 0 || !event.isPrimary) return;
    if (isLocked(prompt)) return;
    clearDragFrame();
    promptDrag = {
      promptId: prompt.id,
      pointerId: event.pointerId,
      startY: event.clientY,
      didMove: false,
    };
    draggedPromptId = null;
    dropBeforePromptId = null;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function applyDragMove(clientY: number) {
    if (!promptDrag) return;

    const didMove = promptDrag.didMove || Math.abs(clientY - promptDrag.startY) > 5;
    if (!didMove) return;

    if (!promptDrag.didMove) {
      draggedPromptId = promptDrag.promptId;
    }
    promptDrag = { ...promptDrag, didMove: true };
    const beforePromptId = getDropTarget(clientY);
    if (beforePromptId !== dropBeforePromptId) {
      dropBeforePromptId = beforePromptId;
    }
  }

  function scheduleDragMove(clientY: number) {
    pendingDragClientY = clientY;
    if (dragAnimationFrame !== null) return;

    dragAnimationFrame = window.requestAnimationFrame(() => {
      dragAnimationFrame = null;
      const nextClientY = pendingDragClientY;
      pendingDragClientY = null;
      if (nextClientY !== null) {
        applyDragMove(nextClientY);
      }
    });
  }

  function handlePointerMove(event: PointerEvent) {
    if (!promptDrag || event.pointerId !== promptDrag.pointerId) return;
    scheduleDragMove(event.clientY);
    if (promptDrag.didMove || Math.abs(event.clientY - promptDrag.startY) > 5) {
      event.preventDefault();
    }
  }

  function finishPointerDrag(event: PointerEvent, suppressClick: boolean) {
    if (!promptDrag || event.pointerId !== promptDrag.pointerId) return;

    applyDragMove(event.clientY);
    clearDragFrame();

    const completedDrag = promptDrag.didMove;
    const promptId = promptDrag.promptId;
    const beforePromptId = dropBeforePromptId;
    const shouldCommitReorder =
      completedDrag && queuedMessageOrderChanged(queuedMessages, promptId, beforePromptId);
    promptDrag = null;
    draggedPromptId = null;
    dropBeforePromptId = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    if (suppressClick && completedDrag) {
      suppressClickPromptId = promptId;
      window.setTimeout(() => {
        if (suppressClickPromptId === promptId) {
          suppressClickPromptId = null;
        }
      });
      event.preventDefault();
    }
    if (shouldCommitReorder) {
      onReorder(promptId, beforePromptId);
    }
  }

  function steer(promptId: string) {
    if (suppressClickPromptId === promptId) {
      suppressClickPromptId = null;
      return;
    }
    onSteer(promptId);
  }
</script>

{#if queuedMessages.length > 0}
  <section class="queued-strip" aria-label="Queued messages">
    <div class="queued-strip-header">
      <span>{queuedCountLabel}</span>
      <small>runs after the current turn</small>
    </div>
    <div class="queued-strip-scroll" role="list" bind:this={stripElement}>
      {#each displayedQueuedMessages as prompt, index (prompt.id)}
        <article
          class={`queued-message ${prompt.id === draggedPromptId ? "dragging" : ""} ${isLocked(prompt) ? "locked" : ""} ${prompt.kind === "thread_report_notification" ? "thread-report" : ""} ${prompt.kind === "agent_context_refresh" ? "prompt-refresh" : ""}`.trim()}
          data-prompt-id={prompt.id}
          data-reorderable={isLocked(prompt) ? "false" : "true"}
          role="listitem"
          animate:flip={{ duration: 170 }}
        >
          <button
            class="queued-drag-handle"
            type="button"
            aria-label={`Reorder queued message ${index + 1}`}
            disabled={isLocked(prompt)}
            onpointerdown={(event) => handlePointerDown(event, prompt)}
            onpointermove={handlePointerMove}
            onpointerup={(event) => finishPointerDrag(event, true)}
            onpointercancel={(event) => finishPointerDrag(event, false)}
          >
            {#if isLocked(prompt)}
              <LockIcon size={12} aria-hidden="true" />
            {:else}
              <GripVerticalIcon size={13} aria-hidden="true" />
            {/if}
          </button>
          <span class="queued-copy" title={getItemTitle(prompt)}>
            {#if prompt.kind === "thread_report_notification"}
              <span class="queued-kind">Report</span>
            {:else if prompt.kind === "report_request"}
              <span class="queued-kind">Request</span>
            {:else if prompt.kind === "agent_context_refresh"}
              <span class="queued-kind">Context</span>
            {/if}
            {getItemText(prompt)}
            {#if prompt.kind === "agent_context_refresh" && prompt.agentContextUpdate}
              <span class={`context-update-state ${prompt.agentContextUpdate.state}`}>
                {getStatusLabel(prompt)}
              </span>
              {#if getContextChangeCount(prompt) > 0}
                <span class="context-update-detail">{getContextChangeCount(prompt)} changes</span>
              {/if}
              {#if getContextRevisionLabel(prompt)}
                <span class="context-update-detail">{getContextRevisionLabel(prompt)}</span>
              {/if}
            {/if}
          </span>
          {#if isLocked(prompt)}
            <div class="queued-locked-controls">
              <div class="queued-status" aria-label={`${getStatusLabel(prompt)} queued message`}>
                <LockIcon size={11} aria-hidden="true" />
                <span>{getStatusLabel(prompt)}</span>
              </div>
              {#if prompt.status === "failed"}
                <div class="queued-actions failed-actions">
                  {#if prompt.kind === "user_message"}
                    <Tooltip label="Restore to composer">
                      <button class="queued-icon-button" type="button" aria-label="Restore failed queued message" onclick={() => onEdit(prompt.id)}>
                        <PencilIcon size={12} aria-hidden="true" />
                      </button>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <button class="queued-icon-button danger" type="button" aria-label="Delete failed queued message" onclick={() => onDelete(prompt.id)}>
                        <Trash2Icon size={12} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  {:else}
                    <Tooltip label="Dismiss failed queue item">
                      <button class="queued-reject-button" type="button" aria-label="Dismiss failed queue item" onclick={() => onDelete(prompt.id)}>
                        Dismiss
                      </button>
                    </Tooltip>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="queued-actions">
              {#if prompt.kind !== "agent_context_refresh"}
                <Tooltip label="Steer at next safe boundary">
                  <button class="queued-steer-button" type="button" aria-label="Steer queued message" onclick={() => steer(prompt.id)}>
                    <CornerUpRightIcon size={12} aria-hidden="true" />
                    <span>Steer</span>
                  </button>
                </Tooltip>
              {/if}
              {#if prompt.kind === "user_message"}
                <Tooltip label="Edit">
                  <button class="queued-icon-button" type="button" aria-label="Edit queued message" onclick={() => onEdit(prompt.id)}>
                    <PencilIcon size={12} aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip label="Delete">
                  <button class="queued-icon-button danger" type="button" aria-label="Delete queued message" onclick={() => onDelete(prompt.id)}>
                    <Trash2Icon size={12} aria-hidden="true" />
                  </button>
                </Tooltip>
              {:else if prompt.kind === "thread_report_notification"}
                <Tooltip label="Dismiss report">
                  <button class="queued-reject-button" type="button" aria-label="Dismiss report" onclick={() => onDelete(prompt.id)}>
                    Dismiss
                  </button>
                </Tooltip>
              {:else if prompt.kind === "request_user_input_answer"}
                <Tooltip label="Cancel answer">
                  <button class="queued-reject-button" type="button" aria-label="Cancel queued answer" onclick={() => onDelete(prompt.id)}>
                    Cancel
                  </button>
                </Tooltip>
              {:else}
                <Tooltip label="Cancel context update">
                  <button class="queued-reject-button" type="button" aria-label="Cancel context update" onclick={() => onDelete(prompt.id)}>
                    Cancel
                  </button>
                </Tooltip>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .queued-strip {
    display: grid;
    gap: 0.28rem;
    padding: 0.34rem 0.42rem 0.32rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 70%, transparent);
  }

  .queued-strip-header {
    display: flex;
    align-items: baseline;
    gap: 0.42rem;
    min-width: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    line-height: 1;
  }

  .queued-strip-header span {
    color: var(--ui-text-primary);
    font-weight: 700;
  }

  .queued-strip-header small {
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queued-strip-scroll {
    display: grid;
    gap: 0.24rem;
    min-width: 0;
    max-height: 7.25rem;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .queued-strip-scroll::-webkit-scrollbar {
    display: none;
  }

  .queued-message {
    display: grid;
    grid-template-columns: 1.18rem minmax(0, 1fr) auto;
    align-items: center;
    min-width: 0;
    min-height: 1.92rem;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 80%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 58%, transparent);
    color: var(--ui-text-secondary);
    transition:
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 170ms cubic-bezier(0.19, 1, 0.22, 1),
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .queued-message:hover,
  .queued-message:focus-within {
    border-color: color-mix(in oklab, var(--ui-border-strong) 68%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-surface) 82%, var(--ui-surface-subtle));
  }

  .queued-message.dragging {
    opacity: 0.58;
  }

  .queued-message.locked {
    border-color: color-mix(in oklab, var(--ui-border-soft) 62%, transparent);
    background: color-mix(in oklab, var(--ui-panel) 64%, transparent);
    color: var(--ui-text-tertiary);
  }

  .queued-message.thread-report {
    border-color: color-mix(in oklab, var(--ui-accent) 30%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-accent) 8%, var(--ui-surface-subtle));
  }

  .queued-message.prompt-refresh {
    border-color: color-mix(in oklab, var(--ui-warning-border, var(--ui-border-soft)) 42%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-warning-surface, var(--ui-surface-subtle)) 20%, var(--ui-surface-subtle));
  }

  .queued-drag-handle,
  .queued-icon-button,
  .queued-steer-button,
  .queued-reject-button {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .queued-drag-handle {
    display: grid;
    place-items: center;
    align-self: stretch;
    min-width: 0;
    color: var(--ui-text-tertiary);
    cursor: grab;
    touch-action: none;
  }

  .queued-drag-handle:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .queued-message.dragging .queued-drag-handle {
    cursor: grabbing;
  }

  .queued-copy {
    display: block;
    min-width: 0;
    padding: 0.24rem 0.34rem 0.24rem 0;
    overflow: hidden;
    color: var(--ui-text-primary);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queued-kind {
    margin-right: 0.34rem;
    color: color-mix(in oklab, var(--ui-accent) 68%, var(--ui-text-secondary));
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .context-update-state,
  .context-update-detail {
    display: inline-grid;
    place-items: center;
    margin-left: 0.34rem;
    padding: 0.08rem 0.28rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
    border-radius: var(--ui-radius-xs);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    line-height: 1;
    text-transform: uppercase;
    vertical-align: 0.08rem;
  }

  .context-update-state.queued,
  .context-update-state.updating {
    border-color: color-mix(in oklab, var(--ui-warning-border, var(--ui-border-soft)) 50%, transparent);
    color: color-mix(in oklab, var(--ui-warning-text, var(--ui-text-secondary)) 74%, var(--ui-text-primary));
  }

  .context-update-state.out_of_date {
    border-color: color-mix(in oklab, var(--ui-danger) 48%, transparent);
    color: var(--ui-danger);
  }

  .queued-message.locked .queued-copy {
    color: var(--ui-text-secondary);
  }

  .queued-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.08rem;
    padding: 0.16rem 0.18rem 0.16rem 0;
  }

  .queued-status {
    display: inline-grid;
    grid-auto-flow: column;
    align-items: center;
    justify-content: center;
    gap: 0.22rem;
    min-width: 4.2rem;
    padding: 0 0.44rem 0 0.2rem;
    color: color-mix(in oklab, var(--ui-accent) 54%, var(--ui-text-tertiary));
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 600;
    line-height: 1;
    text-transform: uppercase;
  }

  .queued-locked-controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;
  }

  .failed-actions {
    padding-left: 0;
  }

  .queued-icon-button,
  .queued-steer-button,
  .queued-reject-button {
    display: grid;
    place-items: center;
    height: 1.3rem;
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-tertiary);
    cursor: pointer;
  }

  .queued-icon-button {
    width: 1.3rem;
  }

  .queued-steer-button {
    grid-auto-flow: column;
    gap: 0.24rem;
    padding: 0 0.4rem;
    color: color-mix(in oklab, var(--ui-accent) 74%, var(--ui-text-primary));
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .queued-reject-button {
    padding: 0 0.42rem;
    color: var(--ui-danger);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .queued-icon-button:hover,
  .queued-icon-button:focus-visible,
  .queued-steer-button:hover,
  .queued-steer-button:focus-visible,
  .queued-reject-button:hover,
  .queued-reject-button:focus-visible,
  .queued-drag-handle:hover,
  .queued-drag-handle:focus-visible {
    outline: none;
    color: var(--ui-text-primary);
  }

  .queued-icon-button:hover,
  .queued-icon-button:focus-visible,
  .queued-steer-button:hover,
  .queued-steer-button:focus-visible,
  .queued-reject-button:hover,
  .queued-reject-button:focus-visible {
    background: var(--ui-hover-bg);
  }

  .queued-icon-button.danger:hover,
  .queued-icon-button.danger:focus-visible {
    background: var(--ui-danger-soft);
    color: var(--ui-danger);
  }

  .queued-icon-button:focus-visible,
  .queued-drag-handle:focus-visible,
  .queued-steer-button:focus-visible,
  .queued-reject-button:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }
</style>
