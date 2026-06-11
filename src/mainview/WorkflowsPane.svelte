<script lang="ts">
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import UserCogIcon from "@lucide/svelte/icons/user-cog";
  import { onMount } from "svelte";
  import type { AppPreferences } from "../shared/agent-settings";
  import type {
    WorkspaceWorkflowsGeneratedExport,
    WorkspaceWorkflowsGeneratedKind,
    WorkspaceWorkflowsGeneratedReadModel,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";

  type Props = {
    runtime: ChatRuntime;
    onOpenAgentProfile?: (agentProfileId: string) => void;
  };

  let { runtime, onOpenAgentProfile }: Props = $props();

  const FILTERS: Array<{ kind: "all" | WorkspaceWorkflowsGeneratedKind; label: string }> = [
    { kind: "all", label: "All" },
    { kind: "agent", label: "Agents" },
    { kind: "component", label: "Components" },
    { kind: "prompt", label: "Prompts" },
    { kind: "workflow", label: "Workflows" },
  ];

  let readModel = $state<WorkspaceWorkflowsGeneratedReadModel | null>(
    runtime.workflowsGeneratedSnapshot,
  );
  let appPreferences = $state<AppPreferences | null>(runtime.appPreferencesSnapshot);
  let selectedId = $state<string | null>(null);
  let activeFilter = $state<(typeof FILTERS)[number]["kind"]>("all");
  let loading = $state(!readModel);
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

  const visibleGroups = $derived.by(() => {
    const groups = new Map<WorkspaceWorkflowsGeneratedKind, WorkspaceWorkflowsGeneratedExport[]>();
    for (const item of visibleItems) {
      groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
    }
    return FILTERS.filter((filter) => filter.kind !== "all")
      .map((filter) => ({
        kind: filter.kind as WorkspaceWorkflowsGeneratedKind,
        label: filter.label,
        items: groups.get(filter.kind as WorkspaceWorkflowsGeneratedKind) ?? [],
      }))
      .filter((group) => group.items.length > 0);
  });

  function applyReadModel(next: WorkspaceWorkflowsGeneratedReadModel): void {
    readModel = next;
    if (!selectedId || !next.items.some((item) => item.id === selectedId)) {
      selectedId = next.items[0]?.id ?? null;
    }
    loading = false;
  }

  async function loadWorkflows() {
    loading = !readModel;
    error = null;
    actionMessage = null;
    try {
      const next = await runtime.getWorkflowsGenerated();
      applyReadModel(next);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load generated workflows.";
    } finally {
      loading = false;
    }
  }

  async function openInEditor(path: string, label: string) {
    actionMessage = null;
    try {
      const opened = await runtime.openWorkspaceSourceInEditor(path);
      actionMessage = opened
        ? `Opened ${path}`
        : `Could not open ${label}. Check the configured external editor.`;
    } catch (err) {
      actionMessage = err instanceof Error ? err.message : `Unable to open ${label}.`;
    }
  }

  function filterCount(kind: (typeof FILTERS)[number]["kind"]): number {
    if (!readModel) return 0;
    return kind === "all" ? readModel.items.length : readModel.counts[kind];
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function kindTone(
    kind: WorkspaceWorkflowsGeneratedKind,
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    if (kind === "agent") return "info";
    if (kind === "workflow") return "success";
    if (kind === "prompt") return "warning";
    return "neutral";
  }

  function parametersPreview(item: WorkspaceWorkflowsGeneratedExport): string | null {
    return item.agentParameters ? JSON.stringify(item.agentParameters, null, 2) : null;
  }

  onMount(() => {
    const syncRuntimeSnapshots = () => {
      const snapshot = runtime.workflowsGeneratedSnapshot;
      const nextPreferences = runtime.appPreferencesSnapshot;
      if (snapshot) {
        applyReadModel(snapshot);
      }
      if (nextPreferences) {
        appPreferences = nextPreferences;
      }
    };
    syncRuntimeSnapshots();
    const unsubscribeRuntime = runtime.subscribe(syncRuntimeSnapshots);
    void loadWorkflows();
    return unsubscribeRuntime;
  });
</script>

<section class="workflows-pane" aria-label="Workflows">
  <header class="workflows-header">
    <div>
      <p>Workflows</p>
      <h2>{readModel?.generatedPackagePath ?? "@svvy/workflows"}</h2>
    </div>
    <Button size="sm" onclick={loadWorkflows}>
      <RefreshCwIcon aria-hidden="true" size={14} strokeWidth={1.9} />
    </Button>
  </header>

  {#if error}
    <p class="workflows-message error">{error}</p>
  {:else if loading}
    <p class="workflows-message">Loading generated workflows...</p>
  {:else if readModel}
    <div class="workflows-tabs" aria-label="Workflow export filters">
      {#each FILTERS as filter (filter.kind)}
        <button
          type="button"
          class:active={activeFilter === filter.kind}
          onclick={() => (activeFilter = filter.kind)}
        >
          <span>{filter.label}</span>
          <strong>{filterCount(filter.kind)}</strong>
        </button>
      {/each}
    </div>

    <div class="workflows-body">
      <div class="workflows-list" role="list" aria-label="Generated workflow exports">
        {#if visibleItems.length === 0}
          <p class="workflows-empty">No generated exports in this group.</p>
        {/if}
        {#each visibleGroups as group (group.kind)}
          <section class="workflows-group">
            <header class="workflows-group-header">
              <span>{group.label}</span>
              <strong>{group.items.length}</strong>
            </header>
            {#each group.items as item (item.id)}
              <button
                type="button"
                class:active={selectedItem?.id === item.id}
                class="workflows-row"
                onclick={() => (selectedId = item.id)}
              >
                <span class="row-top">
                  <strong>{item.qualifiedName}</strong>
                  <Badge tone={kindTone(item.kind)}>{item.kind}</Badge>
                </span>
                <span class="row-meta">
                  <code>{item.namespace}.{item.exportName}</code>
                </span>
              </button>
            {/each}
          </section>
        {/each}
      </div>

      {#if selectedItem}
        <article class="workflows-detail">
          <header class="detail-header">
            <div>
              <p>{selectedItem.namespace}</p>
              <h3>{selectedItem.exportName}</h3>
              <code>{selectedItem.qualifiedName}</code>
            </div>
            <div class="detail-actions">
              {#if selectedItem.agentProfileId}
                <Button
                  size="sm"
                  variant="primary"
                  onclick={() => onOpenAgentProfile?.(selectedItem.agentProfileId!)}
                >
                  <UserCogIcon aria-hidden="true" size={14} strokeWidth={1.9} />
                  Customize Agent
                </Button>
              {/if}
              <OpenExternalButton
                size="sm"
                iconSize={14}
                editor={appPreferences?.preferredExternalEditor}
                targetLabel="source"
                onclick={() => openInEditor(selectedItem.sourcePath, "source")}
              />
              <OpenExternalButton
                size="sm"
                iconSize={14}
                editor={appPreferences?.preferredExternalEditor}
                targetLabel="generated code"
                onclick={() => openInEditor(selectedItem.generatedPath, "generated code")}
              />
            </div>
          </header>

          {#if actionMessage}
            <p class="workflows-message inline">{actionMessage}</p>
          {/if}

          <div class="detail-grid">
            <span>Kind</span>
            <strong>{selectedItem.kind}</strong>
            <span>Namespace</span>
            <strong>{selectedItem.namespace}</strong>
            <span>Export</span>
            <strong>{selectedItem.exportName}</strong>
            <span>Qualified</span>
            <strong>{selectedItem.qualifiedName}</strong>
            <span>Source</span>
            <code>{selectedItem.sourcePath}</code>
            <span>Generated</span>
            <code>{selectedItem.generatedPath}</code>
            {#if selectedItem.agentProfileId}
              <span>Agent Profile</span>
              <strong>{selectedItem.agentProfileId}</strong>
            {/if}
            <span>Updated</span>
            <strong>{formatDate(readModel.updatedAt)}</strong>
          </div>

          {#if parametersPreview(selectedItem)}
            <section class="detail-section">
              <h4>Agent Parameters</h4>
              <pre>{parametersPreview(selectedItem)}</pre>
            </section>
          {/if}

          <section class="detail-section source">
            <h4>Generated Code</h4>
            <pre>{selectedItem.generatedCode}</pre>
          </section>
        </article>
      {/if}
    </div>
  {/if}
</section>

<style>
  .workflows-pane {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 0;
    min-height: 0;
    height: 100%;
    padding: 0;
    color: var(--ui-text-primary);
    background: var(--ui-surface);
  }

  .workflows-header,
  .detail-header,
  .row-top,
  .row-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    min-width: 0;
  }

  .workflows-header p,
  .detail-header p,
  .detail-section h4 {
    margin: 0;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .workflows-header h2,
  .detail-header h3 {
    margin: 0.12rem 0 0;
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1.2;
  }

  .workflows-header {
    padding: 0.58rem 0.78rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 88%, transparent);
  }

  .workflows-tabs {
    display: flex;
    gap: 0.22rem;
    overflow-x: auto;
    padding: 0.42rem 0.78rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
    background: color-mix(in oklab, var(--ui-surface) 92%, transparent);
  }

  .workflows-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    padding: 0.32rem 0.5rem;
    background: transparent;
    color: var(--ui-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .workflows-tabs button.active {
    border-color: color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    color: var(--ui-text-primary);
    background: color-mix(in oklab, var(--ui-surface-raised) 86%, transparent);
  }

  .workflows-body {
    display: grid;
    grid-template-columns: minmax(16rem, 0.82fr) minmax(0, 1.18fr);
    gap: 0;
    min-height: 0;
  }

  .workflows-list,
  .workflows-detail {
    min-height: 0;
    overflow: auto;
    border: 0;
    border-radius: 0;
    background: var(--ui-surface);
  }

  .workflows-list {
    display: grid;
    align-content: start;
    gap: 0;
    padding: 0.35rem;
    border-right: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
  }

  .workflows-group {
    display: grid;
    gap: 0.25rem;
  }

  .workflows-group + .workflows-group {
    margin-top: 0.45rem;
  }

  .workflows-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.38rem 0.4rem 0.2rem;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .workflows-row {
    display: grid;
    gap: 0.28rem;
    width: 100%;
    padding: 0.5rem 0.56rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .workflows-row:hover,
  .workflows-row:focus-visible,
  .workflows-row.active {
    outline: none;
    border-color: color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 88%, transparent);
  }

  .workflows-row.active {
    box-shadow: inset 2px 0 0 var(--ui-accent);
  }

  .workflows-row strong,
  .detail-grid strong,
  .detail-grid code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }

  .row-meta,
  .workflows-message,
  .detail-grid {
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ui-text-tertiary);
  }

  .row-meta code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workflows-detail {
    display: grid;
    align-content: start;
    gap: 0.68rem;
    padding: 0.72rem;
  }

  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    justify-content: flex-end;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.35rem 0.7rem;
    padding: 0.58rem 0.62rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 68%, transparent);
  }

  .detail-section {
    display: grid;
    gap: 0.5rem;
  }

  pre {
    max-height: 28rem;
    overflow: auto;
    margin: 0;
    padding: 0.68rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-primary);
    background: color-mix(in oklab, var(--ui-surface-inset) 92%, transparent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .workflows-message,
  .workflows-empty {
    margin: 0.7rem;
  }

  .workflows-message.inline {
    margin: 0;
    padding: 0.48rem 0.58rem;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 80%, transparent);
  }

  .workflows-message.error {
    color: var(--ui-danger);
  }

  @media (max-width: 840px) {
    .workflows-body {
      grid-template-columns: 1fr;
    }

    .workflows-list {
      max-height: 18rem;
      border-right: 0;
      border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    }
  }
</style>
