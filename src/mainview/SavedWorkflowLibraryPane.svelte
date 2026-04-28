<script lang="ts">
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import type {
    WorkspaceSavedWorkflowLibraryItem,
    WorkspaceSavedWorkflowLibraryItemKind,
    WorkspaceSavedWorkflowLibraryReadModel,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";

  type Props = {
    runtime: ChatRuntime;
  };

  let { runtime }: Props = $props();

  const FILTERS: Array<{ kind: "all" | WorkspaceSavedWorkflowLibraryItemKind; label: string }> = [
    { kind: "all", label: "All" },
    { kind: "entry", label: "Entries" },
    { kind: "definition", label: "Definitions" },
    { kind: "prompt", label: "Prompts" },
    { kind: "component", label: "Components" },
    { kind: "artifact-workflow", label: "Artifacts" },
  ];

  let readModel = $state<WorkspaceSavedWorkflowLibraryReadModel | null>(null);
  let selectedId = $state<string | null>(null);
  let activeFilter = $state<(typeof FILTERS)[number]["kind"]>("all");
  let loading = $state(true);
  let error = $state<string | null>(null);
  let actionMessage = $state<string | null>(null);

  const visibleItems = $derived.by(() => {
    const items = readModel?.items ?? [];
    return activeFilter === "all" ? items : items.filter((item) => item.kind === activeFilter);
  });

  const selectedItem = $derived.by(() => {
    const items = readModel?.items ?? [];
    return items.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null;
  });

  async function loadLibrary() {
    loading = true;
    error = null;
    try {
      const next = await runtime.getSavedWorkflowLibrary();
      readModel = next;
      if (!selectedId || !next.items.some((item) => item.id === selectedId)) {
        selectedId = next.items[0]?.id ?? null;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load saved workflow library.";
    } finally {
      loading = false;
    }
  }

  async function openInEditor(item: WorkspaceSavedWorkflowLibraryItem) {
    if (!item.sourcePath) return;
    actionMessage = null;
    try {
      await runtime.openWorkflowSourceInEditor(item.sourcePath);
      actionMessage = `Opened ${item.sourcePath}`;
    } catch (err) {
      actionMessage = err instanceof Error ? err.message : "Unable to open source.";
    }
  }

  async function deleteItem(item: WorkspaceSavedWorkflowLibraryItem) {
    if (item.scope !== "saved" || item.kind === "artifact-workflow") return;
    actionMessage = null;
    try {
      readModel = await runtime.deleteSavedWorkflowLibraryItem(item.path);
      selectedId = readModel.items[0]?.id ?? null;
      actionMessage = `Deleted ${item.path}`;
    } catch (err) {
      actionMessage = err instanceof Error ? err.message : "Unable to delete saved workflow file.";
    }
  }

  function statusTone(
    status: WorkspaceSavedWorkflowLibraryItem["validationStatus"],
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    if (status === "valid") return "success";
    if (status === "warning") return "warning";
    if (status === "error") return "danger";
    return "neutral";
  }

  function kindLabel(kind: WorkspaceSavedWorkflowLibraryItemKind): string {
    if (kind === "artifact-workflow") return "Artifact";
    return kind[0]!.toUpperCase() + kind.slice(1);
  }

  $effect(() => {
    void loadLibrary();
  });
</script>

<section class="saved-workflow-library" aria-label="Saved workflow library">
  <header class="library-header">
    <div>
      <p>Workflow Library</p>
      <h2>{readModel?.rootPath ?? ".svvy/workflows"}</h2>
    </div>
    <Button size="sm" onclick={loadLibrary}>
      <RefreshCwIcon aria-hidden="true" size={14} strokeWidth={1.9} />
    </Button>
  </header>

  {#if error}
    <p class="library-message error">{error}</p>
  {:else if loading}
    <p class="library-message">Loading workflow assets...</p>
  {:else if readModel}
    <div class="library-tabs" aria-label="Workflow asset filters">
      {#each FILTERS as filter (filter.kind)}
        <button
          type="button"
          class:active={activeFilter === filter.kind}
          onclick={() => (activeFilter = filter.kind)}
        >
          <span>{filter.label}</span>
          <strong>{filter.kind === "all" ? readModel.items.length : readModel.counts[filter.kind]}</strong>
        </button>
      {/each}
    </div>

    <div class="library-body">
      <div class="library-list" role="list" aria-label="Workflow library items">
        {#if visibleItems.length === 0}
          <p class="library-empty">No workflow files in this group.</p>
        {/if}
        {#each visibleItems as item (item.id)}
          <button
            type="button"
            class:active={selectedItem?.id === item.id}
            class="library-row"
            onclick={() => (selectedId = item.id)}
          >
            <span class="row-top">
              <strong>{item.title}</strong>
              <Badge tone={statusTone(item.validationStatus)}>{item.validationStatus}</Badge>
            </span>
            <span class="row-meta">
              <span>{kindLabel(item.kind)}</span>
              <code>{item.path}</code>
            </span>
            {#if item.summary}
              <span class="row-summary">{item.summary}</span>
            {/if}
          </button>
        {/each}
      </div>

      {#if selectedItem}
        <article class="library-detail">
          <header class="detail-header">
            <div>
              <p>{kindLabel(selectedItem.kind)}</p>
              <h3>{selectedItem.title}</h3>
              <code>{selectedItem.path}</code>
            </div>
            <div class="detail-actions">
              {#if selectedItem.sourcePath}
                <Button size="sm" onclick={() => openInEditor(selectedItem)}>
                  <ExternalLinkIcon aria-hidden="true" size={14} strokeWidth={1.9} />
                </Button>
              {/if}
              {#if selectedItem.scope === "saved" && selectedItem.kind !== "artifact-workflow"}
                <Button variant="danger" size="sm" onclick={() => deleteItem(selectedItem)}>
                  <Trash2Icon aria-hidden="true" size={14} strokeWidth={1.9} />
                </Button>
              {/if}
            </div>
          </header>

          {#if actionMessage}
            <p class="library-message inline">{actionMessage}</p>
          {/if}

          <div class="detail-grid">
            <span>Scope</span>
            <strong>{selectedItem.scope}</strong>
            <span>Status</span>
            <strong>{selectedItem.validationStatus}</strong>
            {#if selectedItem.workflowId}
              <span>Workflow</span>
              <strong>{selectedItem.workflowId}</strong>
            {/if}
            {#if selectedItem.productKind}
              <span>Product</span>
              <strong>{selectedItem.productKind}</strong>
            {/if}
          </div>

          {#if selectedItem.groupedAssetRefs}
            <section class="detail-section">
              <h4>Grouped Assets</h4>
              {#each Object.entries(selectedItem.groupedAssetRefs) as [group, paths] (group)}
                <div class="asset-group">
                  <span>{group}</span>
                  {#if paths.length === 0}
                    <em>none</em>
                  {:else}
                    {#each paths as path (path)}
                      <code>{path}</code>
                    {/each}
                  {/if}
                </div>
              {/each}
            </section>
          {/if}

          {#if selectedItem.diagnostics.length > 0}
            <section class="detail-section">
              <h4>Diagnostics</h4>
              {#each selectedItem.diagnostics as diagnostic, index (`${diagnostic.path}:${diagnostic.line}:${index}`)}
                <p class={`diagnostic ${diagnostic.severity}`.trim()}>
                  <strong>{diagnostic.severity}</strong>
                  <span>{diagnostic.message}</span>
                  {#if diagnostic.path}
                    <code>{diagnostic.path}{diagnostic.line ? `:${diagnostic.line}` : ""}</code>
                  {/if}
                </p>
              {/each}
            </section>
          {/if}

          {#if selectedItem.launchSchema}
            <section class="detail-section">
              <h4>Launch Contract</h4>
              <pre>{selectedItem.launchSchema}</pre>
            </section>
          {/if}

          {#if selectedItem.sourcePreview}
            <section class="detail-section source">
              <h4>Source Preview</h4>
              <pre>{selectedItem.sourcePreview}</pre>
            </section>
          {/if}
        </article>
      {/if}
    </div>
  {/if}
</section>

<style>
  .saved-workflow-library {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 0.75rem;
    min-height: 0;
    height: 100%;
    padding: 0.85rem;
    color: var(--ui-text-primary);
    background: var(--ui-surface);
  }

  .library-header,
  .detail-header,
  .row-top,
  .row-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    min-width: 0;
  }

  .library-header p,
  .detail-header p,
  .detail-section h4 {
    margin: 0;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  .library-header h2,
  .detail-header h3 {
    margin: 0.12rem 0 0;
    font-size: 0.95rem;
    line-height: 1.2;
  }

  .library-tabs {
    display: flex;
    gap: 0.35rem;
    overflow-x: auto;
    padding-bottom: 0.1rem;
  }

  .library-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    border-radius: var(--ui-radius-sm);
    padding: 0.42rem 0.56rem;
    background: color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent);
    color: var(--ui-text-secondary);
    font: inherit;
    font-size: 0.74rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .library-tabs button.active {
    border-color: color-mix(in oklab, var(--ui-border-accent) 76%, var(--ui-border-soft));
    color: var(--ui-text-primary);
    background: color-mix(in oklab, var(--ui-accent-soft) 58%, var(--ui-surface-raised));
  }

  .library-body {
    display: grid;
    grid-template-columns: minmax(16rem, 0.82fr) minmax(0, 1.18fr);
    gap: 0.75rem;
    min-height: 0;
  }

  .library-list,
  .library-detail {
    min-height: 0;
    overflow: auto;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
  }

  .library-list {
    display: grid;
    align-content: start;
    gap: 0.25rem;
    padding: 0.35rem;
  }

  .library-row {
    display: grid;
    gap: 0.35rem;
    width: 100%;
    padding: 0.62rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .library-row:hover,
  .library-row:focus-visible,
  .library-row.active {
    outline: none;
    border-color: color-mix(in oklab, var(--ui-border-strong) 74%, transparent);
    background: var(--ui-surface-raised);
  }

  .library-row strong,
  .detail-grid strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.78rem;
  }

  .row-meta,
  .row-summary,
  .library-message,
  .detail-grid,
  .asset-group,
  .diagnostic {
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
    line-height: 1.45;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--ui-text-tertiary);
  }

  .row-meta code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .library-detail {
    display: grid;
    align-content: start;
    gap: 0.8rem;
    padding: 0.85rem;
  }

  .detail-actions {
    display: flex;
    gap: 0.4rem;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.35rem 0.7rem;
    padding: 0.65rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
  }

  .detail-section {
    display: grid;
    gap: 0.5rem;
  }

  .asset-group {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    gap: 0.35rem 0.65rem;
  }

  .asset-group code {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .diagnostic {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0.55rem;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-danger) 8%, var(--ui-surface-raised));
  }

  .diagnostic.warning {
    background: color-mix(in oklab, var(--ui-warning) 9%, var(--ui-surface-raised));
  }

  pre {
    max-height: 18rem;
    margin: 0;
    overflow: auto;
    padding: 0.72rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface);
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .source pre {
    max-height: 30rem;
  }

  .library-message {
    margin: 0;
  }

  .library-message.inline {
    color: var(--ui-accent-strong);
  }

  .library-message.error {
    color: var(--ui-danger);
  }

  .library-empty {
    margin: 0;
    padding: 0.75rem;
    color: var(--ui-text-secondary);
    font-size: 0.78rem;
  }

  @media (max-width: 860px) {
    .library-body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
