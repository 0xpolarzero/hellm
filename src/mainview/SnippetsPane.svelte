<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SaveIcon from "@lucide/svelte/icons/save";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { onMount } from "svelte";
  import type { AppPreferences } from "../shared/agent-settings";
  import {
    inferSnippetArgumentCount,
    type SnippetRecord,
    type SnippetsReadModel,
  } from "../shared/snippets";
  import type { ChatRuntime } from "./chat-runtime";
  import ExtensionListRow from "./ExtensionListRow.svelte";
  import Button from "./ui/Button.svelte";
  import Checkbox from "./ui/Checkbox.svelte";
  import Input from "./ui/Input.svelte";
  import MetadataChip from "./ui/MetadataChip.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";
  import PaneFilterTabs, { type PaneFilterTabOption } from "./ui/PaneFilterTabs.svelte";
  import SourceMetadataTextArea from "./ui/SourceMetadataTextArea.svelte";
  import StatusCard from "./ui/StatusCard.svelte";
  import TextArea from "./ui/TextArea.svelte";
  import { dismissConfirmation } from "./ui/dismiss-confirmation";

  type Props = {
    runtime: ChatRuntime;
  };

  let { runtime }: Props = $props();

  let snippets = $state<SnippetRecord[]>([]);
  let appPreferences = $state<AppPreferences | null>(null);
  let selectedId = $state<string | null>(null);
  let hasReadModel = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let actionMessage = $state<string | null>(null);
  let query = $state("");
  let sourceFilter = $state<SnippetRecord["source"] | "all">("all");
  let confirmingDeleteSnippetId = $state<string | null>(null);
  let detachedDraftSnippet = $state<SnippetRecord | null>(null);
  let pendingSnippetEnablementIds = $state<Set<string>>(new Set());
  let draft = $state({
    title: "",
    description: "",
    argumentHint: "",
    body: "",
  });

  const SOURCE_FILTERS: Array<{
    value: SnippetRecord["source"] | "all";
    label: string;
    tone?: PaneFilterTabOption["tone"];
  }> = [
    { value: "all", label: "All" },
    { value: "svvy", label: "Managed", tone: "success" },
    { value: "claude", label: "Claude", tone: "info" },
    { value: "pi", label: "pi", tone: "warning" },
  ];

  const visibleSnippets = $derived(
    snippets.filter(
      (snippet) =>
        (sourceFilter === "all" || snippet.source === sourceFilter) &&
        snippetMatchesQuery(snippet, query),
    ),
  );
  const selectedSnippet = $derived(
    snippets.find((snippet) => snippet.id === selectedId) ??
      (detachedDraftSnippet?.id === selectedId ? detachedDraftSnippet : null) ??
      null,
  );
  const managedSelected = $derived(
    selectedSnippet?.source === "svvy" ? selectedSnippet : null,
  );

  function sourceFilterCount(source: SnippetRecord["source"] | "all"): number {
    return source === "all"
      ? snippets.length
      : snippets.filter((snippet) => snippet.source === source).length;
  }

  const sourceFilterOptions = $derived(
    SOURCE_FILTERS.map((filter) => ({
      ...filter,
      count: sourceFilterCount(filter.value),
    })),
  );
  const draftDirty = $derived(
    managedSelected
      ? draft.title !== managedSelected.title ||
          draft.description !== (managedSelected.metadata.description ?? "") ||
          draft.argumentHint !== (managedSelected.metadata.argumentHint ?? "") ||
          draft.body !== managedSelected.body
      : false,
  );

  function snippetMatchesQuery(snippet: SnippetRecord, value: string): boolean {
    const needle = value.trim().toLowerCase();
    if (!needle) return true;
    return [
      snippet.title,
      snippet.body,
      snippet.metadata.description,
      snippet.metadata.argumentHint,
      snippet.source,
      "path" in snippet ? snippet.path : "",
    ]
      .filter(Boolean)
      .some((part) => String(part).toLowerCase().includes(needle));
  }

  function sourceTone(
    source: SnippetRecord["source"],
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    if (source === "svvy") return "success";
    if (source === "claude") return "info";
    return "warning";
  }

  function sourceLabel(source: SnippetRecord["source"]): string {
    if (source === "svvy") return "svvy";
    if (source === "claude") return "Claude";
    return "pi";
  }

  function snippetArgumentInsight(snippet: SnippetRecord): string | null {
    const hint = snippet.metadata.argumentHint?.trim() ?? "";
    if (!hint) return null;
    const count = inferSnippetArgumentCount(snippet);
    const usesRestArgs = /\$@|\$ARGUMENTS\b|\$\{@:\d+\}/.test(snippet.body);
    const countLabel = usesRestArgs
      ? "args"
      : count > 0
        ? `${count} arg${count === 1 ? "" : "s"}`
        : "args";
    return `${countLabel}: ${hint}`;
  }

  function syncDraftFromSnippet(snippet: SnippetRecord): void {
    if (snippet.source !== "svvy") return;
    draft = {
      title: snippet.title,
      description: snippet.metadata.description ?? "",
      argumentHint: snippet.metadata.argumentHint ?? "",
      body: snippet.body,
    };
  }

  function selectSnippet(snippet: SnippetRecord, options: { force?: boolean } = {}): void {
    if (!options.force && draftDirty && managedSelected && snippet.id !== managedSelected.id) {
      actionMessage = "Save or discard your current changes before switching snippets.";
      return;
    }
    selectedId = snippet.id;
    detachedDraftSnippet = null;
    confirmingDeleteSnippetId = null;
    if (snippet.source === "svvy") {
      syncDraftFromSnippet(snippet);
    }
    actionMessage = null;
  }

  function toggleSnippet(snippet: SnippetRecord): void {
    if (selectedId === snippet.id) {
      if (draftDirty && managedSelected?.id === snippet.id) {
        actionMessage = "Save or discard your current changes before collapsing this snippet.";
        return;
      }
      selectedId = null;
      detachedDraftSnippet = null;
      confirmingDeleteSnippetId = null;
      actionMessage = null;
      return;
    }
    selectSnippet(snippet);
  }

  function discardDraftChanges(): void {
    if (!managedSelected) return;
    syncDraftFromSnippet(managedSelected);
    confirmingDeleteSnippetId = null;
    actionMessage = null;
  }

  function applyReadModel(readModel: SnippetsReadModel): void {
    const previousManagedSelected = managedSelected;
    const previousManagedSelectedId = managedSelected?.id ?? null;
    const hadDirtyDraft = draftDirty;
    snippets = readModel.snippets;
    hasReadModel = true;
    loading = false;
    const nextSelected = selectedId ? snippets.find((snippet) => snippet.id === selectedId) ?? null : null;
    const preservesDirtyDraft =
      Boolean(hadDirtyDraft && previousManagedSelectedId && nextSelected?.id === previousManagedSelectedId);
    if (hadDirtyDraft && previousManagedSelected && !nextSelected) {
      detachedDraftSnippet = previousManagedSelected;
      selectedId = previousManagedSelected.id;
      confirmingDeleteSnippetId = null;
      actionMessage = "This snippet is no longer in the latest source list. Save or discard your current changes.";
      return;
    }
    detachedDraftSnippet = null;
    selectedId = nextSelected?.id ?? null;
    confirmingDeleteSnippetId = null;
    if (nextSelected?.source === "svvy" && !preservesDirtyDraft) {
      syncDraftFromSnippet(nextSelected);
    }
  }

  function syncSelectionToVisibleSnippets(): void {
    if (visibleSnippets.some((snippet) => snippet.id === selectedId)) return;
    if (draftDirty && managedSelected) {
      if (!actionMessage) {
        actionMessage = "Current edited snippet is outside the active filters. Save or discard it before switching.";
      }
      return;
    }
    selectedId = null;
    confirmingDeleteSnippetId = null;
    actionMessage = null;
  }

  $effect(() => {
    syncSelectionToVisibleSnippets();
  });

  async function loadSnippets(): Promise<void> {
    loading = !hasReadModel;
    error = null;
    actionMessage = null;
    try {
      const readModel = await runtime.getSnippets();
      applyReadModel(readModel);
    } catch (err) {
      error = err instanceof Error ? err.message : "Snippets are unavailable.";
    } finally {
      loading = false;
    }
  }

  async function createSnippet(): Promise<void> {
    if (draftDirty) {
      actionMessage = "Save or discard your current changes before creating another snippet.";
      return;
    }
    saving = true;
    error = null;
    actionMessage = null;
    try {
      const createdSnippetId = await runtime.createManagedSnippet({
        title: "Untitled snippet",
        body: "",
      });
      await loadSnippets();
      const snippet = snippets.find((candidate) => candidate.id === createdSnippetId);
      if (snippet) selectSnippet(snippet, { force: true });
      actionMessage = "Snippet created.";
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to create snippet.";
    } finally {
      saving = false;
    }
  }

  async function saveSnippet(): Promise<void> {
    if (!managedSelected || saving) return;
    saving = true;
    error = null;
    actionMessage = null;
    try {
      await runtime.updateManagedSnippet({
        snippetId: managedSelected.id,
        title: draft.title,
        body: draft.body,
        description: draft.description,
        argumentHint: draft.argumentHint,
      });
      await loadSnippets();
      const snippet = snippets.find((candidate) => candidate.id === managedSelected.id);
      if (snippet) selectSnippet(snippet);
      actionMessage = "Snippet saved.";
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to save snippet.";
    } finally {
      saving = false;
    }
  }

  async function deleteSnippet(): Promise<void> {
    if (!managedSelected || saving) return;
    saving = true;
    error = null;
    actionMessage = null;
    try {
      await runtime.deleteManagedSnippet(managedSelected.id);
      confirmingDeleteSnippetId = null;
      selectedId = null;
      await loadSnippets();
      actionMessage = "Snippet deleted.";
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to delete snippet.";
    } finally {
      saving = false;
    }
  }

  function requestDeleteSnippet(): void {
    if (!managedSelected) return;
    confirmingDeleteSnippetId = managedSelected.id;
  }

  function cancelDeleteSnippet(): void {
    confirmingDeleteSnippetId = null;
  }

  async function setSnippetEnabled(snippet: SnippetRecord, enabled: boolean): Promise<void> {
    if (pendingSnippetEnablementIds.has(snippet.id)) return;
    pendingSnippetEnablementIds = new Set([...pendingSnippetEnablementIds, snippet.id]);
    actionMessage = null;
    const previousSnippets = snippets;
    snippets = snippets.map((candidate) =>
      candidate.id === snippet.id ? { ...candidate, enabled } : candidate,
    );
    try {
      await runtime.setSnippetEnabled({ snippetId: snippet.id, enabled });
      actionMessage = enabled
        ? "Snippet enabled for composer mentions."
        : "Snippet hidden from composer mentions.";
    } catch (err) {
      snippets = previousSnippets;
      actionMessage = err instanceof Error ? err.message : "Unable to update snippet.";
    } finally {
      const nextPendingIds = new Set(pendingSnippetEnablementIds);
      nextPendingIds.delete(snippet.id);
      pendingSnippetEnablementIds = nextPendingIds;
    }
  }

  async function openDiscoveredSnippet(snippet: SnippetRecord): Promise<void> {
    if (snippet.source === "svvy") return;
    actionMessage = null;
    try {
      const opened = await runtime.openSnippetSourceInEditor(snippet.id);
      actionMessage = opened
        ? `Opened ${snippet.path}`
        : "Could not open snippet source. Check the configured external editor.";
    } catch (err) {
      actionMessage = err instanceof Error ? err.message : "Unable to open snippet source.";
    }
  }

  function syncRuntimeSnapshots() {
    const snapshot = runtime.snippetsSnapshot;
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
    void loadSnippets();
    return unsubscribeRuntime;
  });
</script>

<section class="snippets-pane" aria-label="Snippets">
  <div class="snippets-header">
    <div class="snippets-filter-row">
      <PaneFilterTabs
        class="snippets-source-tabs"
        value={sourceFilter}
        options={sourceFilterOptions}
        aria-label="Snippet source filters"
        onSelect={(value) => (sourceFilter = value as typeof sourceFilter)}
      />
      <Button class="category-action" size="xs" variant="ghost" onclick={createSnippet} disabled={loading || saving}>
        <PlusIcon aria-hidden="true" size={13} strokeWidth={2} />
        <span>New</span>
      </Button>
    </div>
    <div class="snippets-search-row">
      <Input bind:value={query} placeholder="Search snippets, paths, or body text" aria-label="Search snippets" />
    </div>
  </div>

  {#if error}
    <div class="snippets-status">
      <StatusCard eyebrow="Snippets" title="Unable to load snippets" message={error} tone="error" />
    </div>
  {:else if loading}
    <p class="snippets-message">Loading snippets...</p>
  {:else}
    <div class="snippets-body">
      <section class="snippets-list" aria-label="Snippet list">
        {#if snippets.length === 0}
          <p class="empty-list">Create a managed snippet or add a supported Claude or pi snippet file.</p>
        {:else if visibleSnippets.length === 0}
          <p class="empty-list">No snippets match these filters.</p>
        {/if}
        {#each visibleSnippets as snippet (snippet.id)}
          {@const expanded = selectedSnippet?.id === snippet.id}
          <ExtensionListRow
            id={snippet.id}
            expanded={expanded}
            expandedInset={false}
            showDragHandle={false}
            showLeading={false}
            subdued={!snippet.enabled}
            title={snippet.title}
            description={snippet.metadata.description ?? ""}
            onToggle={() => toggleSnippet(snippet)}
          >
            {#snippet meta()}
              <MetadataChip class="snippet-source-chip" value={sourceLabel(snippet.source)} tone={sourceTone(snippet.source)} mono={false} />
            {/snippet}
            {#snippet actions()}
              <Checkbox
                size="sm"
                checked={snippet.enabled}
                disabled={pendingSnippetEnablementIds.has(snippet.id)}
                aria-label={snippet.enabled ? `Disable ${snippet.title} in composer` : `Enable ${snippet.title} in composer`}
                onchange={(event) =>
                  void setSnippetEnabled(snippet, (event.currentTarget as HTMLInputElement).checked)}
              />
              {#if snippet.source === "svvy" && expanded && managedSelected?.id === snippet.id}
                {#if draftDirty}
                  <Button size="sm" variant="secondary" onclick={discardDraftChanges} disabled={saving}>
                    Discard
                  </Button>
                {/if}
                <Button size="sm" variant="primary" onclick={saveSnippet} disabled={saving || !draftDirty}>
                  <SaveIcon aria-hidden="true" size={14} strokeWidth={1.9} />
                  Save
                </Button>
                <span
                  class="delete-confirmation"
                  use:dismissConfirmation={{
                    active: confirmingDeleteSnippetId === managedSelected.id,
                    onDismiss: cancelDeleteSnippet,
                  }}
                >
                  <Button
                    size="sm"
                    variant={confirmingDeleteSnippetId === managedSelected.id ? "danger" : "ghost"}
                    onclick={confirmingDeleteSnippetId === managedSelected.id ? deleteSnippet : requestDeleteSnippet}
                    disabled={saving}
                  >
                    {#if confirmingDeleteSnippetId === managedSelected.id}
                      <span>Confirm</span>
                    {:else}
                      <Trash2Icon aria-hidden="true" size={14} strokeWidth={1.9} />
                      Delete
                    {/if}
                  </Button>
                </span>
              {/if}
            {/snippet}
            {#snippet expandedContent()}
              {#if actionMessage && selectedSnippet?.id === snippet.id}
                <p class="snippets-message inline">{actionMessage}</p>
              {/if}
              {#if snippet.source === "svvy" && managedSelected?.id === snippet.id}
                <div class="snippet-form">
                  <label>
                    <span>Title</span>
                    <Input bind:value={draft.title} placeholder="Snippet title" />
                  </label>
                  <label>
                    <span>Description</span>
                    <Input bind:value={draft.description} placeholder="Short picker description" />
                  </label>
                  <label>
                    <span>Argument hint</span>
                    <Input bind:value={draft.argumentHint} placeholder="Expected arguments" />
                  </label>
                  <label class="body-field">
                    <span>Body</span>
                    <TextArea bind:value={draft.body} class="snippet-body-input" placeholder="Prompt text" />
                  </label>
                </div>
              {:else if snippet.source !== "svvy"}
                {@const argumentInsight = snippetArgumentInsight(snippet)}
                <SourceMetadataTextArea
                  value={snippet.body}
                  readonly
                  showTokenCount={false}
                  sourceLabel={snippet.path}
                  sourceEditor={appPreferences?.preferredExternalEditor}
                  aria-label={`${snippet.title} snippet source`}
                  onOpenSource={() => void openDiscoveredSnippet(snippet)}
                >
                  {#snippet footerLeading()}
                    {#if argumentInsight}
                      <span class="snippet-source-meta">{argumentInsight}</span>
                    {/if}
                  {/snippet}
                </SourceMetadataTextArea>
              {/if}
            {/snippet}
          </ExtensionListRow>
        {/each}
      </section>
    </div>
  {/if}
</section>

<style>
  .snippets-pane {
    container-type: inline-size;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    height: 100%;
    color: var(--ui-text-primary);
    background: var(--ui-panel);
  }

  .snippets-header {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
    padding: 0.58rem 0.72rem 0.62rem;
    border-bottom: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-panel) 82%, var(--ui-surface));
  }

  .snippets-filter-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    min-width: 0;
  }

  .snippets-search-row {
    min-width: 0;
  }

  :global(.snippets-source-tabs) {
    flex: 0 1 auto;
  }

  :global(.category-action) {
    flex: 0 0 auto;
    height: 1.42rem;
    min-height: 1.42rem;
    padding-block: 0;
    text-transform: none;
    line-height: 1;
  }

  :global(.category-action .ui-button-content) {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    height: 100%;
    align-items: center;
    line-height: 1;
  }

  :global(.category-action .ui-button-content > svg) {
    display: block;
  }

  :global(.category-action .ui-button-content > span) {
    display: block;
    line-height: 1;
  }

  .snippets-message {
    margin: 0.7rem;
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
  }

  .snippets-message.inline {
    margin: 0;
    padding: 0.48rem 0.58rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
  }

  .snippets-status {
    padding: 0.7rem;
  }

  .snippets-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }

  .snippets-list {
    display: grid;
    align-content: start;
    gap: 0.34rem;
    min-height: 0;
    overflow: auto;
    padding: 0.45rem;
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
  }

  .empty-list {
    margin: 0.32rem 0.42rem 0.5rem;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .snippets-list :global(.ui-metadata-chip) {
    font-family: var(--font-sans);
  }

  .snippets-list :global(.shared-extension-meta) {
    display: inline-flex;
    align-items: center;
  }

  .delete-confirmation {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    min-width: 0;
  }

  .snippet-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .snippet-form label,
  .body-field {
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
    min-width: 0;
  }

  .snippet-form label span {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 650;
  }

  .body-field {
    grid-column: 1 / -1;
  }

  :global(.snippet-body-input) {
    min-height: 20rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .snippets-list :global(.source-metadata-textarea-input) {
    min-height: 20rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .snippet-source-meta {
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-tertiary);
    line-height: 1.28;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @container (max-width: 48rem) {
    .snippets-body,
    .snippet-form {
      grid-template-columns: 1fr;
    }

    .snippets-list {
      border-right: 0;
      border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
      max-height: 16rem;
    }
  }
</style>
