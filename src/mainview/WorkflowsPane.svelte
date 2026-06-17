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
  import MetadataChip from "./ui/MetadataChip.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";
  import PaneFilterTabs, { type PaneFilterTabOption } from "./ui/PaneFilterTabs.svelte";
  import PaneHeader from "./ui/PaneHeader.svelte";
  import PaneListRow from "./ui/PaneListRow.svelte";
  import StatusCard from "./ui/StatusCard.svelte";

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

  let readModel = $state<WorkspaceWorkflowsGeneratedReadModel | null>(null);
  let appPreferences = $state<AppPreferences | null>(null);
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

  function filterTone(kind: (typeof FILTERS)[number]["kind"]): PaneFilterTabOption["tone"] {
    if (kind === "agent") return "info";
    if (kind === "workflow") return "success";
    if (kind === "prompt") return "warning";
    return "neutral";
  }

  const filterOptions = $derived(
    FILTERS.map((filter) => ({
      value: filter.kind,
      label: filter.label,
      count: filterCount(filter.kind),
      tone: filterTone(filter.kind),
    })),
  );

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

  function syncRuntimeSnapshots() {
    const snapshot = runtime.workflowsGeneratedSnapshot;
    const nextPreferences = runtime.appPreferencesSnapshot;
    if (snapshot) {
      applyReadModel(snapshot);
    }
    if (nextPreferences) {
      appPreferences = nextPreferences;
    }
  }

  syncRuntimeSnapshots();

  onMount(() => {
    const unsubscribeRuntime = runtime.subscribe(syncRuntimeSnapshots);
    void loadWorkflows();
    return unsubscribeRuntime;
  });
</script>

<section class="workflows-pane" aria-label="Workflows">
  <PaneHeader
    eyebrow="Workflows"
    title="@svvy/workflows"
    subtitle={readModel ? `${readModel.items.length} generated exports · updated ${formatDate(readModel.updatedAt)}` : "Generated package visibility"}
  >
    {#snippet actions()}
      <Button size="sm" variant="ghost" iconOnly aria-label="Refresh generated workflows" onclick={loadWorkflows}>
        <RefreshCwIcon aria-hidden="true" size={14} strokeWidth={1.9} />
      </Button>
    {/snippet}
  </PaneHeader>

  {#if error}
    <div class="workflows-status">
      <StatusCard eyebrow="Workflows" title="Unable to load generated workflows" message={error} tone="error" />
    </div>
  {:else if loading}
    <p class="workflows-message">Loading generated workflows...</p>
  {:else if readModel}
    <div class="workflows-tabs" aria-label="Workflow export filters">
      <PaneFilterTabs
        value={activeFilter}
        options={filterOptions}
        onSelect={(value) => (activeFilter = value as typeof activeFilter)}
      />
    </div>

    <div class="workflows-body">
      <div class="workflows-list" role="list" aria-label="Generated workflow exports">
        {#if visibleItems.length === 0}
          <p class="workflows-empty">No generated exports in this group.</p>
        {/if}
        {#each visibleGroups as group (group.kind)}
          <section class="workflows-group">
            {#if activeFilter === "all"}
              <header class="workflows-group-header">
                <span>{group.label}</span>
                <strong>{group.items.length}</strong>
              </header>
            {/if}
            {#each group.items as item (item.id)}
              <PaneListRow
                title={item.qualifiedName}
                active={selectedItem?.id === item.id}
                onclick={() => (selectedId = item.id)}
              >
                {#snippet meta()}
                  <Badge tone={kindTone(item.kind)}>{item.kind}</Badge>
                {/snippet}
                {#snippet subtitle()}
                  <code>{item.namespace}.{item.exportName}</code>
                {/snippet}
              </PaneListRow>
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
              <div class="detail-chip-row">
                <MetadataChip label="qualified" value={selectedItem.qualifiedName} />
                <MetadataChip label="kind" value={selectedItem.kind} tone={kindTone(selectedItem.kind)} />
                {#if selectedItem.agentProfileId}
                  <MetadataChip label="agent" value={selectedItem.agentProfileId} tone="info" />
                {/if}
              </div>
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
                targetLabel="source file"
                onclick={() => openInEditor(selectedItem.sourcePath, "source")}
              />
              <OpenExternalButton
                size="sm"
                iconSize={14}
                editor={appPreferences?.preferredExternalEditor}
                targetLabel="read-only generated code"
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
            <span>Package</span>
            <code>{readModel.generatedPackagePath}</code>
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
            <h4>Generated Code (read-only)</h4>
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

  .detail-header,
  .detail-chip-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }

  .detail-header p,
  .detail-section h4 {
    margin: 0;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .detail-header h3 {
    margin: 0.12rem 0 0;
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1.2;
  }

  .workflows-tabs {
    overflow-x: auto;
    padding: 0.42rem 0.78rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
    background: color-mix(in oklab, var(--ui-surface) 92%, transparent);
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

  .detail-grid strong,
  .detail-grid code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }

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

  .detail-header {
    justify-content: space-between;
    align-items: flex-start;
  }

  .detail-chip-row {
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.42rem;
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

  .workflows-status {
    padding: 0.7rem;
  }

  .workflows-message.inline {
    margin: 0;
    padding: 0.48rem 0.58rem;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 80%, transparent);
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
