<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
  import type { Snippet } from "svelte";

  type Props = {
    actions?: Snippet;
    description: string;
    draggable?: boolean;
    dragging?: boolean;
    dragLabel: string;
    expanded: boolean;
    expandedContent?: Snippet;
    expandedInset?: boolean;
    id: string;
    leading?: Snippet;
    marked?: boolean;
    markerLabel?: string;
    markerVisible?: boolean;
    meta?: Snippet;
    controlAction?: Snippet;
    controlActionVisible?: boolean;
    stateControls?: Snippet;
    showDragHandle?: boolean;
    subdued?: boolean;
    target?: boolean;
    title: string;
    tokenLabel?: string | null;
    onDragPointerDown?: (event: PointerEvent) => void;
    onToggle: () => void;
  };

  let {
    actions,
    description,
    draggable = true,
    dragging = false,
    dragLabel,
    expanded,
    expandedContent,
    expandedInset = true,
    id,
    leading,
    marked = false,
    markerLabel = "override",
    markerVisible = false,
    meta,
    controlAction,
    controlActionVisible = false,
    stateControls,
    showDragHandle = true,
    subdued = false,
    target = false,
    title,
    tokenLabel = null,
    onDragPointerDown,
    onToggle,
  }: Props = $props();
</script>

<article
  class={`shared-extension-row ${expanded ? "expanded" : ""} ${marked || markerVisible ? "is-marked" : ""} ${controlAction && controlActionVisible ? "has-control-action" : ""} ${showDragHandle ? "" : "no-drag-handle"} ${leading ? "" : "no-leading"} ${subdued ? "is-subdued" : ""} ${dragging ? "dragging" : ""} ${target ? "target" : ""}`.trim()}
  data-extension-id={id}
>
  <div class="shared-extension-main">
    {#if showDragHandle}
      <button
        type="button"
        class="shared-extension-drag"
        aria-label={dragLabel}
        disabled={!draggable}
        onpointerdown={onDragPointerDown}
      >
        <GripVerticalIcon size={13} aria-hidden="true" />
      </button>
    {/if}
    {#if leading}
      <div class="shared-extension-leading">
        {@render leading()}
      </div>
    {/if}
    <div class="shared-extension-copy">
      <div class="shared-extension-title-line">
        <button
          type="button"
          class="shared-extension-title-button"
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          onclick={onToggle}
        >
          <span class="shared-extension-title">{title}</span>
        </button>
        {#if markerVisible}
          <span class="shared-extension-marker">{markerLabel}</span>
        {/if}
      </div>
      <p>{description}</p>
    </div>
    {#if tokenLabel}
      <span class="shared-extension-token-count">{tokenLabel}</span>
    {/if}
    {#if meta}
      <div class="shared-extension-meta">
        {@render meta()}
      </div>
    {/if}
    {#if controlAction && controlActionVisible}
      <div class="shared-extension-control-action">
        {@render controlAction()}
      </div>
    {/if}
    {#if stateControls}
      <div class="shared-extension-controls">
        {@render stateControls()}
      </div>
    {/if}
    {#if actions}
      <div class="shared-extension-actions">
        {@render actions()}
      </div>
    {/if}
    <button
      type="button"
      class="shared-extension-disclosure"
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
      onclick={onToggle}
    >
      {#if expanded}
        <ChevronDownIcon size={14} strokeWidth={1.9} aria-hidden="true" />
      {:else}
        <ChevronRightIcon size={14} strokeWidth={1.9} aria-hidden="true" />
      {/if}
    </button>
  </div>
  {#if expanded && expandedContent}
    <div class={`shared-extension-expanded ${expandedInset ? "" : "no-inset"}`.trim()}>
      {@render expandedContent()}
    </div>
  {/if}
</article>

<style>
  .shared-extension-row {
    display: grid;
    gap: 0.28rem;
    min-width: 0;
    overflow-x: clip;
    overflow-y: visible;
    padding: 0.3rem 0.36rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface) 82%, transparent);
    transition:
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1),
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .shared-extension-row.expanded {
    border-color: color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 78%, transparent);
  }

  .shared-extension-row.target {
    border-color: color-mix(in oklab, var(--ui-accent) 50%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-accent-soft) 20%, var(--ui-surface-subtle));
  }

  .shared-extension-row.is-subdued {
    opacity: 0.72;
  }

  .shared-extension-row.dragging {
    opacity: 0.62;
  }

  .shared-extension-main {
    --agent-row-line-height: 1.45rem;

    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto auto auto auto auto;
    align-items: center;
    column-gap: 0.36rem;
    min-width: 0;
  }

  .shared-extension-drag,
  .shared-extension-disclosure {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 1.24rem;
    height: var(--agent-row-line-height);
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
  }

  .shared-extension-drag {
    grid-column: 1;
    cursor: grab;
    touch-action: none;
  }

  .shared-extension-drag:disabled {
    cursor: default;
    opacity: 0.48;
  }

  .shared-extension-disclosure {
    grid-column: 8;
    cursor: pointer;
  }

  .shared-extension-row.has-control-action .shared-extension-main {
    grid-template-columns: auto auto minmax(0, 1fr) auto auto 1rem auto auto auto;
  }

  .shared-extension-row.has-control-action .shared-extension-disclosure {
    grid-column: 9;
  }

  .shared-extension-row.no-drag-handle.no-leading .shared-extension-main {
    grid-template-columns: minmax(0, 1fr) auto auto auto auto auto;
  }

  .shared-extension-row.no-drag-handle.no-leading.has-control-action .shared-extension-main {
    grid-template-columns: minmax(0, 1fr) auto auto 1rem auto auto auto;
  }

  .shared-extension-row.no-drag-handle.no-leading .shared-extension-copy {
    grid-column: 1;
  }

  .shared-extension-row.no-drag-handle.no-leading .shared-extension-token-count {
    grid-column: 2;
  }

  .shared-extension-row.no-drag-handle.no-leading .shared-extension-meta {
    grid-column: 3;
  }

  .shared-extension-row.no-drag-handle.no-leading .shared-extension-control-action,
  .shared-extension-row.no-drag-handle.no-leading .shared-extension-controls {
    grid-column: 4;
  }

  .shared-extension-row.no-drag-handle.no-leading .shared-extension-actions {
    grid-column: 5;
  }

  .shared-extension-row.no-drag-handle.no-leading .shared-extension-disclosure {
    grid-column: 6;
  }

  .shared-extension-row.no-drag-handle.no-leading.has-control-action
    .shared-extension-controls {
    grid-column: 5;
  }

  .shared-extension-row.no-drag-handle.no-leading.has-control-action
    .shared-extension-actions {
    grid-column: 6;
  }

  .shared-extension-row.no-drag-handle.no-leading.has-control-action
    .shared-extension-disclosure {
    grid-column: 7;
  }

  .shared-extension-drag:not(:disabled):hover,
  .shared-extension-drag:not(:disabled):focus-visible,
  .shared-extension-disclosure:hover,
  .shared-extension-disclosure:focus-visible {
    outline: none;
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .shared-extension-drag:focus-visible,
  .shared-extension-disclosure:focus-visible,
  .shared-extension-title-button:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .shared-extension-leading {
    grid-column: 2;
    display: grid;
    align-self: center;
    place-items: center;
    min-width: 0;
  }

  .shared-extension-copy {
    grid-column: 3;
    display: grid;
    gap: 0.12rem;
    align-self: center;
    min-width: 0;
  }

  .shared-extension-title-line {
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    justify-self: start;
    max-width: 100%;
    min-width: 0;
  }

  .shared-extension-title-button {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  .shared-extension-title {
    display: inline-block;
    min-width: 0;
    overflow: hidden;
    background-image: none;
    background-repeat: no-repeat;
    background-position: 0 calc(100% - 1px);
    background-size: 100% 2px;
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.28;
    text-overflow: ellipsis;
    vertical-align: bottom;
    white-space: nowrap;
  }

  .shared-extension-title-button:hover .shared-extension-title,
  .shared-extension-title-button:focus-visible .shared-extension-title {
    color: var(--ui-text-primary);
  }

  .shared-extension-row.is-marked .shared-extension-title {
    background-image: linear-gradient(var(--ui-accent), var(--ui-accent));
  }

  .shared-extension-marker {
    flex: 0 0 auto;
    color: var(--ui-accent);
    font-size: var(--text-xs);
    font-weight: 650;
  }

  .shared-extension-copy p {
    min-width: 0;
    overflow: hidden;
    margin: 0;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shared-extension-token-count {
    grid-column: 4;
    align-self: center;
    width: 11rem;
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.3;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shared-extension-meta,
  .shared-extension-actions {
    display: inline-flex;
    align-items: center;
    align-self: center;
    gap: 0.16rem;
    min-height: var(--agent-row-line-height);
    min-width: 0;
  }

  .shared-extension-meta {
    grid-column: 5;
  }

  .shared-extension-control-action {
    grid-column: 6;
    display: grid;
    place-items: center;
    align-self: center;
    width: 1rem;
    min-width: 0;
    height: var(--agent-row-line-height);
    line-height: 1;
  }

  .shared-extension-controls {
    grid-column: 6;
    display: grid;
    align-self: center;
    min-width: 0;
  }

  .shared-extension-actions {
    grid-column: 7;
  }

  .shared-extension-row.has-control-action .shared-extension-controls {
    grid-column: 7;
  }

  .shared-extension-row.has-control-action .shared-extension-actions {
    grid-column: 8;
  }

  .shared-extension-expanded {
    display: grid;
    gap: 0.58rem;
    min-width: 0;
    padding: 0.22rem 0 0.18rem 3.08rem;
  }

  .shared-extension-expanded.no-inset {
    padding-left: 0;
  }
</style>
