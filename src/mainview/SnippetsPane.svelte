<script lang="ts">
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import SaveIcon from "@lucide/svelte/icons/save";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { onMount } from "svelte";
  import type { AppPreferences } from "../shared/agent-settings";
  import {
    inferSnippetArgumentCount,
    type DiscoveredSnippet,
    type ManagedSnippet,
    type SnippetRecord,
    type SnippetsReadModel,
  } from "../shared/snippets";
  import type { ChatRuntime } from "./chat-runtime";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Input from "./ui/Input.svelte";
  import MetadataChip from "./ui/MetadataChip.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";
  import PaneHeader from "./ui/PaneHeader.svelte";
  import PaneListRow from "./ui/PaneListRow.svelte";
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
  let confirmingDeleteSnippetId = $state<string | null>(null);
  let draft = $state({
    title: "",
    description: "",
    argumentHint: "",
    body: "",
  });

  const managedSnippets = $derived(
    snippets.filter((snippet): snippet is ManagedSnippet => snippet.source === "svvy"),
  );
  const discoveredSnippets = $derived(
    snippets.filter((snippet): snippet is DiscoveredSnippet => snippet.source !== "svvy"),
  );
  const visibleManagedSnippets = $derived(
    managedSnippets.filter((snippet) => snippetMatchesQuery(snippet, query)),
  );
  const visibleDiscoveredSnippets = $derived(
    discoveredSnippets.filter((snippet) => snippetMatchesQuery(snippet, query)),
  );
  const selectedSnippet = $derived(
    snippets.find((snippet) => snippet.id === selectedId) ?? snippets[0] ?? null,
  );
  const managedSelected = $derived(
    selectedSnippet?.source === "svvy" ? selectedSnippet : null,
  );
  const discoveredSelected = $derived(
    selectedSnippet && selectedSnippet.source !== "svvy" ? selectedSnippet : null,
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
      "scope" in snippet ? snippet.scope : "",
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

  function snippetMentionToken(snippet: SnippetRecord): string {
    return `@${snippet.title}`;
  }

  function snippetArgumentLabel(snippet: SnippetRecord): string {
    const count = inferSnippetArgumentCount(snippet);
    if (count === 0) return "no args";
    return `${count} arg${count === 1 ? "" : "s"}`;
  }

  function selectSnippet(snippet: SnippetRecord): void {
    selectedId = snippet.id;
    confirmingDeleteSnippetId = null;
    if (snippet.source === "svvy") {
      draft = {
        title: snippet.title,
        description: snippet.metadata.description ?? "",
        argumentHint: snippet.metadata.argumentHint ?? "",
        body: snippet.body,
      };
    }
    actionMessage = null;
  }

  function applyReadModel(readModel: SnippetsReadModel): void {
    snippets = readModel.snippets;
    hasReadModel = true;
    loading = false;
    const nextSelected =
      snippets.find((snippet) => snippet.id === selectedId) ?? snippets[0] ?? null;
    selectedId = nextSelected?.id ?? null;
    if (nextSelected?.source === "svvy") {
      selectSnippet(nextSelected);
    }
  }

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
    saving = true;
    error = null;
    actionMessage = null;
    try {
      const created = await runtime.createManagedSnippet({
        title: "Untitled snippet",
        body: "",
      });
      await loadSnippets();
      const snippet = snippets.find((candidate) => candidate.id === created.id);
      if (snippet) selectSnippet(snippet);
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
      const updated = await runtime.updateManagedSnippet({
        snippetId: managedSelected.id,
        title: draft.title,
        body: draft.body,
        description: draft.description,
        argumentHint: draft.argumentHint,
      });
      await loadSnippets();
      const snippet = snippets.find((candidate) => candidate.id === updated.id);
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

  async function openDiscoveredSnippet(): Promise<void> {
    if (!discoveredSelected) return;
    actionMessage = null;
    try {
      const opened = await runtime.openSnippetExternalSourceInEditor(discoveredSelected.path);
      actionMessage = opened
        ? `Opened ${discoveredSelected.path}`
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
  <PaneHeader
    eyebrow="Snippets"
    title="Prompt macros"
    subtitle={`${snippets.length} total · ${managedSnippets.length} managed · ${discoveredSnippets.length} discovered`}
  >
    {#snippet actions()}
      <Button size="sm" variant="ghost" iconOnly aria-label="Refresh snippets" onclick={loadSnippets} disabled={loading || saving}>
        <RefreshCwIcon aria-hidden="true" size={14} strokeWidth={1.9} />
      </Button>
      <Button size="sm" variant="primary" onclick={createSnippet} disabled={loading || saving}>
        <PlusIcon aria-hidden="true" size={14} strokeWidth={1.9} />
        New
      </Button>
    {/snippet}
  </PaneHeader>

  {#if error}
    <div class="snippets-status">
      <StatusCard eyebrow="Snippets" title="Unable to load snippets" message={error} tone="error" />
    </div>
  {:else if loading}
    <p class="snippets-message">Loading snippets...</p>
  {:else}
    <div class="snippets-toolbar">
      <Input bind:value={query} placeholder="Search snippets, paths, or body text" aria-label="Search snippets" />
    </div>
    <div class="snippets-body">
      <nav class="snippets-list" aria-label="Snippet list">
        <section>
          <header class="group-header">
            <span>Managed</span>
            <strong>{visibleManagedSnippets.length}/{managedSnippets.length}</strong>
          </header>
          {#if managedSnippets.length === 0}
            <p class="empty-list">No managed snippets yet.</p>
          {:else if visibleManagedSnippets.length === 0}
            <p class="empty-list">No managed snippets match.</p>
          {/if}
          {#each visibleManagedSnippets as snippet (snippet.id)}
            <PaneListRow
              title={snippet.title}
              description={snippet.metadata.description}
              active={selectedSnippet?.id === snippet.id}
              onclick={() => selectSnippet(snippet)}
            >
              {#snippet leading()}
                <FileTextIcon aria-hidden="true" size={14} strokeWidth={1.9} />
              {/snippet}
              {#snippet meta()}
                <Badge tone={sourceTone(snippet.source)}>{sourceLabel(snippet.source)}</Badge>
              {/snippet}
              {#snippet subtitle()}
                <code>{snippetMentionToken(snippet)}</code>
                <span>{snippetArgumentLabel(snippet)}</span>
              {/snippet}
            </PaneListRow>
          {/each}
        </section>

        <section>
          <header class="group-header">
            <span>Discovered</span>
            <strong>{visibleDiscoveredSnippets.length}/{discoveredSnippets.length}</strong>
          </header>
          {#if discoveredSnippets.length === 0}
            <p class="empty-list">No Claude or pi snippet files found.</p>
          {:else if visibleDiscoveredSnippets.length === 0}
            <p class="empty-list">No discovered snippets match.</p>
          {/if}
          {#each visibleDiscoveredSnippets as snippet (snippet.id)}
            <PaneListRow
              title={snippet.title}
              active={selectedSnippet?.id === snippet.id}
              onclick={() => selectSnippet(snippet)}
            >
              {#snippet leading()}
                <FileTextIcon aria-hidden="true" size={14} strokeWidth={1.9} />
              {/snippet}
              {#snippet meta()}
                <Badge tone={sourceTone(snippet.source)}>{sourceLabel(snippet.source)}</Badge>
              {/snippet}
              {#snippet subtitle()}
                <code>{snippet.scope}</code>
                <span>{snippetArgumentLabel(snippet)}</span>
              {/snippet}
            </PaneListRow>
          {/each}
        </section>
      </nav>

      <article class="snippet-detail">
        {#if selectedSnippet}
          <header class="detail-header">
            <div>
              <p>{sourceLabel(selectedSnippet.source)}</p>
              <h3>{selectedSnippet.title}</h3>
              <div class="detail-chip-row">
                <MetadataChip label="token" value={snippetMentionToken(selectedSnippet)} />
                <MetadataChip label="args" value={snippetArgumentLabel(selectedSnippet)} />
                {#if managedSelected}
                  <MetadataChip label="state" value={draftDirty ? "unsaved" : "saved"} tone={draftDirty ? "warning" : "success"} />
                {:else if discoveredSelected}
                  <MetadataChip label="scope" value={discoveredSelected.scope} />
                {/if}
              </div>
            </div>
            <div class="detail-actions">
              {#if discoveredSelected}
                <OpenExternalButton
                  size="sm"
                  iconSize={14}
                  editor={appPreferences?.preferredExternalEditor}
                  targetLabel={discoveredSelected.path}
                  onclick={openDiscoveredSnippet}
                />
              {:else if managedSelected}
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
            </div>
          </header>

          {#if actionMessage}
            <p class="snippets-message inline">{actionMessage}</p>
          {/if}

          {#if managedSelected}
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
          {:else if discoveredSelected}
            <div class="readonly-meta">
              <span>Path</span>
              <code>{discoveredSelected.path}</code>
              <span>Description</span>
              <strong>{discoveredSelected.metadata.description ?? "None"}</strong>
              <span>Argument hint</span>
              <strong>{discoveredSelected.metadata.argumentHint ?? "None"}</strong>
            </div>
            <section class="preview">
              <h4>Preview</h4>
              <pre>{discoveredSelected.body}</pre>
            </section>
          {/if}
        {:else}
          <StatusCard
            eyebrow="Snippets"
            title="No snippets available"
            message="Create a managed prompt macro or add a supported Claude or pi snippet file."
          >
            <Button size="sm" variant="primary" onclick={createSnippet}>
              <PlusIcon aria-hidden="true" size={14} strokeWidth={1.9} />
              New Snippet
            </Button>
          </StatusCard>
        {/if}
      </article>
    </div>
  {/if}
</section>

<style>
  .snippets-pane {
    container-type: inline-size;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-height: 0;
    height: 100%;
    color: var(--ui-text-primary);
    background: var(--ui-panel);
  }

  .snippets-toolbar {
    padding: 0.42rem 0.78rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
    background: color-mix(in oklab, var(--ui-surface) 92%, transparent);
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
    grid-template-columns: minmax(14rem, 0.36fr) minmax(0, 1fr);
    min-height: 0;
  }

  .snippets-list {
    display: grid;
    align-content: start;
    gap: 0.42rem;
    min-height: 0;
    overflow: auto;
    padding: 0.45rem;
    border-right: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
  }

  .snippets-list section {
    display: grid;
    gap: 0.25rem;
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.38rem 0.4rem 0.18rem;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 650;
    text-transform: uppercase;
  }

  .group-header strong {
    color: var(--ui-text-secondary);
    font-weight: 650;
  }

  .snippets-list code {
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-list {
    margin: 0.32rem 0.42rem 0.5rem;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .snippet-detail {
    display: grid;
    align-content: start;
    gap: 0.68rem;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 0.72rem;
  }

  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.7rem;
    min-width: 0;
  }

  .detail-header p {
    margin: 0;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 650;
    text-transform: uppercase;
  }

  .detail-header h3 {
    margin: 0.12rem 0 0;
    color: var(--ui-text-primary);
    font-size: var(--text-base);
    font-weight: 650;
    line-height: 1.25;
  }

  .detail-chip-row,
  .detail-actions,
  .delete-confirmation {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    min-width: 0;
  }

  .detail-chip-row {
    margin-top: 0.42rem;
  }

  .detail-actions {
    justify-content: flex-end;
    flex: 0 0 auto;
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
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 650;
    text-transform: uppercase;
  }

  .body-field {
    grid-column: 1 / -1;
  }

  :global(.snippet-body-input) {
    min-height: 20rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .readonly-meta {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.45rem 0.7rem;
    padding: 0.58rem 0.62rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 68%, transparent);
    font-size: var(--text-sm);
  }

  .readonly-meta span {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .readonly-meta code,
  .readonly-meta strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .preview {
    display: grid;
    gap: 0.5rem;
  }

  .preview h4 {
    margin: 0;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .preview pre {
    margin: 0;
    min-height: 20rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-inset) 92%, transparent);
    padding: 0.68rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
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
