<script lang="ts">
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import { onMount } from "svelte";
  import type { AppPreferences } from "../shared/agent-settings";
  import type {
    WorkflowsGeneratedExportReadModelRecord,
    WorkflowsGeneratedReadModel,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import ExtensionListRow from "./ExtensionListRow.svelte";
  import Button from "./ui/Button.svelte";
  import Input from "./ui/Input.svelte";
  import MetadataChip from "./ui/MetadataChip.svelte";
  import PaneFilterTabs, { type PaneFilterTabOption } from "./ui/PaneFilterTabs.svelte";
  import SourceMetadataTextArea from "./ui/SourceMetadataTextArea.svelte";
  import StatusCard from "./ui/StatusCard.svelte";

  type Props = {
    runtime: ChatRuntime;
  };

  let { runtime }: Props = $props();

  const FILTERS: Array<{
    kind: "all" | WorkflowsGeneratedExportReadModelRecord["kind"];
    label: string;
  }> = [
    { kind: "all", label: "All" },
    { kind: "agent", label: "Agents" },
    { kind: "component", label: "Components" },
    { kind: "prompt", label: "Prompts" },
    { kind: "workflow", label: "Workflows" },
  ];

  let readModel = $state<WorkflowsGeneratedReadModel | null>(null);
  let appPreferences = $state<AppPreferences | null>(null);
  let expandedId = $state<string | null>(null);
  let activeFilter = $state<(typeof FILTERS)[number]["kind"]>("all");
  let query = $state("");
  let loading = $state(true);
  let error = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  const visibleItems = $derived.by(() => {
    const items = readModel?.exports ?? [];
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (activeFilter === "all" || item.kind === activeFilter) &&
        (!needle || itemMatchesQuery(item, needle)),
    );
  });
  const currentFact = $derived(
    readModel?.facts.find((fact) => fact.packageName === "@svvyx/workflows") ?? null,
  );

  function applyReadModel(next: WorkflowsGeneratedReadModel): void {
    readModel = next;
    if (expandedId && !next.exports.some((item) => item.qualifiedName === expandedId)) {
      expandedId = null;
    }
    loading = false;
  }

  async function loadWorkflows() {
    loading = !readModel;
    error = null;
    actionError = null;
    try {
      const next = await runtime.getWorkflowsGenerated();
      applyReadModel(next);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load generated workflows.";
    } finally {
      loading = false;
    }
  }

  async function openInEditor(
    item: WorkflowsGeneratedExportReadModelRecord,
    target: "source" | "generated",
    label: string,
  ) {
    actionError = null;
    try {
      const opened = await runtime.openWorkflowsGeneratedExportInEditor({
        qualifiedName: item.qualifiedName,
        target,
      });
      if (!opened) {
        actionError = `Could not open ${label}. Check the configured external editor.`;
      }
    } catch (err) {
      actionError = err instanceof Error ? err.message : `Unable to open ${label}.`;
    }
  }

  function toggleExpanded(item: WorkflowsGeneratedExportReadModelRecord): void {
    expandedId = expandedId === item.qualifiedName ? null : item.qualifiedName;
    actionError = null;
  }

  function itemMatchesQuery(
    item: WorkflowsGeneratedExportReadModelRecord,
    needle: string,
  ): boolean {
    return [
      item.kind,
      item.namespace,
      item.exportName,
      item.qualifiedName,
      item.sourcePath,
      item.generatedPath,
      item.generatedCode,
      item.workflowAgentId ?? "",
    ].some((part) => (part ?? "").toLowerCase().includes(needle));
  }

  function filterCount(kind: (typeof FILTERS)[number]["kind"]): number {
    if (!readModel) return 0;
    return kind === "all"
      ? readModel.exports.length
      : readModel.exports.filter((item) => item.kind === kind).length;
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

  function updatedLabel(value: string): string {
    return `updated ${formatDate(value)}`;
  }

  function fileName(path: string | null): string {
    return path ? (path.split(/[\\/]/).filter(Boolean).at(-1) ?? path) : "Unavailable";
  }

  function parametersPreview(item: WorkflowsGeneratedExportReadModelRecord): string | null {
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
  <div class="workflows-header">
    <div class="workflows-filter-row">
      <PaneFilterTabs
        class="workflows-kind-tabs"
        value={activeFilter}
        options={filterOptions}
        aria-label="Workflow export filters"
        onSelect={(value) => (activeFilter = value as typeof activeFilter)}
      />
      <Button
        class="category-action"
        size="xs"
        variant="ghost"
        iconOnly
        aria-label="Refresh generated workflows"
        onclick={loadWorkflows}
      >
        <RefreshCwIcon aria-hidden="true" size={13} strokeWidth={2} />
      </Button>
    </div>
    <div class="workflows-search-row">
      <Input
        bind:value={query}
        placeholder="Search generated exports, paths, or code"
        aria-label="Search generated workflow exports"
      />
    </div>
  </div>

  {#if error}
    <div class="workflows-status">
      <StatusCard eyebrow="Workflows" title="Unable to load generated workflows" message={error} tone="error">
        <Button size="sm" variant="secondary" onclick={loadWorkflows}>Retry</Button>
      </StatusCard>
    </div>
  {:else if loading}
    <p class="workflows-message">Loading generated workflows...</p>
  {:else if readModel}
    <section class="workflows-list" aria-label="Generated workflow exports">
      {#if readModel.exports.length === 0}
        <p class="workflows-empty">No generated exports yet. Save or build reusable Workflows source to populate this pane.</p>
      {:else if visibleItems.length === 0}
        <p class="workflows-empty">No generated exports match these filters.</p>
      {/if}
      {#each visibleItems as item (item.qualifiedName)}
        {@const expanded = expandedId === item.qualifiedName}
        {@const agentParameters = parametersPreview(item)}
        <ExtensionListRow
          id={item.qualifiedName}
          expanded={expanded}
          expandedInset={false}
          showDragHandle={false}
          showLeading={false}
          title={item.exportName}
          description=""
          onToggle={() => toggleExpanded(item)}
        >
          {#snippet expandedContent()}
            {#if actionError && expandedId === item.qualifiedName}
              <p class="workflows-message inline">{actionError}</p>
            {/if}
            {#if currentFact || item.workflowAgentId}
              <div class="workflow-expanded-meta">
                {#if currentFact}
                  <MetadataChip value={currentFact.status} mono={false} />
                  <MetadataChip value={updatedLabel(currentFact.updatedAt)} mono={false} />
                {/if}
                {#if item.workflowAgentId}
                  <MetadataChip value={item.workflowAgentId} />
                {/if}
              </div>
            {/if}
            {#if currentFact?.diagnostics[0]}
              <p class="workflows-message inline">{currentFact.diagnostics[0]}</p>
            {/if}
            {#if agentParameters}
              <div class="workflow-agent-parameters-preview">
                <SourceMetadataTextArea
                  value={agentParameters}
                  readonly
                  showTokenCount={false}
                  sourceLabel={fileName(item.sourcePath)}
                  sourceEditor={appPreferences?.preferredExternalEditor}
                  aria-label={`${item.exportName} agent parameters`}
                  wrap="off"
                  sourceDisabled={!item.sourcePath}
                  onOpenSource={() => void openInEditor(item, "source", "agent parameters")}
                />
              </div>
            {/if}
            <div class="workflow-generated-code-preview">
              <SourceMetadataTextArea
                value={item.generatedCode}
                readonly
                showTokenCount={false}
                sourceLabel={fileName(item.generatedPath)}
                sourceEditor={appPreferences?.preferredExternalEditor}
                aria-label={`${item.qualifiedName} generated code`}
                wrap="off"
                sourceDisabled={!item.generatedPath}
                onOpenSource={() => void openInEditor(item, "generated", "generated code")}
              />
            </div>
          {/snippet}
        </ExtensionListRow>
      {/each}
    </section>
  {/if}
</section>

<style>
  .workflows-pane {
    container-type: inline-size;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    height: 100%;
    color: var(--ui-text-primary);
    background: var(--ui-panel);
  }

  .workflows-header {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
    padding: 0.58rem 0.72rem 0.62rem;
    border-bottom: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-panel) 82%, var(--ui-surface));
  }

  .workflows-filter-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    min-width: 0;
  }

  .workflows-search-row {
    min-width: 0;
  }

  :global(.workflows-kind-tabs) {
    flex: 0 1 auto;
  }

  :global(.category-action) {
    flex: 0 0 auto;
    width: 1.42rem;
    height: 1.42rem;
    min-height: 1.42rem;
    padding: 0;
    line-height: 1;
  }

  .workflows-list {
    display: grid;
    align-content: start;
    gap: 0.34rem;
    min-height: 0;
    overflow: auto;
    scrollbar-gutter: stable;
    padding: 0.45rem;
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
  }

  .workflows-list :global(.ui-metadata-chip) {
    font-family: var(--font-sans);
  }

  .workflows-list :global(.shared-extension-meta),
  .workflows-list :global(.shared-extension-actions) {
    display: inline-flex;
    align-items: center;
  }

  .workflow-expanded-meta {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .workflows-list :global(.source-metadata-textarea-input) {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .workflows-list :global(.workflow-agent-parameters-preview .source-metadata-textarea-input) {
    min-height: 14rem;
  }

  .workflows-list :global(.workflow-generated-code-preview .source-metadata-textarea-input) {
    min-height: 8.5rem;
    max-height: 12rem;
  }

  .workflows-message,
  .workflows-empty {
    margin: 0.7rem;
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    line-height: 1.45;
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

  @container (max-width: 48rem) {
    .workflows-filter-row {
      align-items: flex-start;
    }
  }
</style>
