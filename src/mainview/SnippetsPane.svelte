<script lang="ts">
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import SaveIcon from "@lucide/svelte/icons/save";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { onMount } from "svelte";
  import type { AppPreferences } from "../shared/agent-settings";
  import type {
    DiscoveredSnippet,
    ManagedSnippet,
    SnippetRecord,
    SnippetsReadModel,
  } from "../shared/snippets";
  import type { ChatRuntime } from "./chat-runtime";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";

  type Props = {
    runtime: ChatRuntime;
  };

  let { runtime }: Props = $props();

  let snippets = $state<SnippetRecord[]>(runtime.snippetsSnapshot?.snippets ?? []);
  let appPreferences = $state<AppPreferences | null>(runtime.appPreferencesSnapshot);
  let selectedId = $state<string | null>(null);
  let hasReadModel = $state(!!runtime.snippetsSnapshot);
  let loading = $state(!hasReadModel);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let actionMessage = $state<string | null>(null);
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
  const selectedSnippet = $derived(
    snippets.find((snippet) => snippet.id === selectedId) ?? snippets[0] ?? null,
  );
  const managedSelected = $derived(
    selectedSnippet?.source === "svvy" ? selectedSnippet : null,
  );
  const discoveredSelected = $derived(
    selectedSnippet && selectedSnippet.source !== "svvy" ? selectedSnippet : null,
  );

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

  function selectSnippet(snippet: SnippetRecord): void {
    selectedId = snippet.id;
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
      selectedId = null;
      await loadSnippets();
      actionMessage = "Snippet deleted.";
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to delete snippet.";
    } finally {
      saving = false;
    }
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

  onMount(() => {
    const syncRuntimeSnapshots = () => {
      const snapshot = runtime.snippetsSnapshot;
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
    void loadSnippets();
    return unsubscribeRuntime;
  });
</script>

<section class="snippets-pane" aria-label="Snippets">
  <header class="snippets-header">
    <div>
      <p>Snippets</p>
      <h2>Prompt macros</h2>
    </div>
    <div class="header-actions">
      <Button size="sm" onclick={loadSnippets} disabled={loading || saving}>
        <RefreshCwIcon aria-hidden="true" size={14} strokeWidth={1.9} />
      </Button>
      <Button size="sm" variant="primary" onclick={createSnippet} disabled={loading || saving}>
        <PlusIcon aria-hidden="true" size={14} strokeWidth={1.9} />
        New
      </Button>
    </div>
  </header>

  {#if error}
    <p class="snippets-message error">{error}</p>
  {:else if loading}
    <p class="snippets-message">Loading snippets...</p>
  {:else}
    <div class="snippets-body">
      <nav class="snippets-list" aria-label="Snippet list">
        <section>
          <header class="group-header">
            <span>Managed</span>
            <strong>{managedSnippets.length}</strong>
          </header>
          {#if managedSnippets.length === 0}
            <p class="empty-list">No managed snippets yet.</p>
          {/if}
          {#each managedSnippets as snippet (snippet.id)}
            <button
              type="button"
              class="snippet-row"
              class:active={selectedSnippet?.id === snippet.id}
              onclick={() => selectSnippet(snippet)}
            >
              <span class="row-title">
                <FileTextIcon aria-hidden="true" size={14} strokeWidth={1.9} />
                <strong>{snippet.title}</strong>
              </span>
              <span class="row-meta">
                <Badge tone={sourceTone(snippet.source)}>{sourceLabel(snippet.source)}</Badge>
                {#if snippet.metadata.description}
                  <small>{snippet.metadata.description}</small>
                {/if}
              </span>
            </button>
          {/each}
        </section>

        <section>
          <header class="group-header">
            <span>Discovered</span>
            <strong>{discoveredSnippets.length}</strong>
          </header>
          {#if discoveredSnippets.length === 0}
            <p class="empty-list">No Claude or pi snippet files found.</p>
          {/if}
          {#each discoveredSnippets as snippet (snippet.id)}
            <button
              type="button"
              class="snippet-row"
              class:active={selectedSnippet?.id === snippet.id}
              onclick={() => selectSnippet(snippet)}
            >
              <span class="row-title">
                <FileTextIcon aria-hidden="true" size={14} strokeWidth={1.9} />
                <strong>{snippet.title}</strong>
              </span>
              <span class="row-meta">
                <Badge tone={sourceTone(snippet.source)}>{sourceLabel(snippet.source)}</Badge>
                <small>{snippet.scope}</small>
              </span>
            </button>
          {/each}
        </section>
      </nav>

      <article class="snippet-detail">
        {#if selectedSnippet}
          <header class="detail-header">
            <div>
              <p>{sourceLabel(selectedSnippet.source)}</p>
              <h3>{selectedSnippet.title}</h3>
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
                <Button size="sm" variant="primary" onclick={saveSnippet} disabled={saving}>
                  <SaveIcon aria-hidden="true" size={14} strokeWidth={1.9} />
                  Save
                </Button>
                <Button size="sm" variant="danger" onclick={deleteSnippet} disabled={saving}>
                  <Trash2Icon aria-hidden="true" size={14} strokeWidth={1.9} />
                  Delete
                </Button>
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
                <input bind:value={draft.title} placeholder="Snippet title" />
              </label>
              <label>
                <span>Description</span>
                <input bind:value={draft.description} placeholder="Short picker description" />
              </label>
              <label>
                <span>Argument hint</span>
                <input bind:value={draft.argumentHint} placeholder="Expected arguments" />
              </label>
              <label class="body-field">
                <span>Body</span>
                <textarea bind:value={draft.body} placeholder="Prompt text"></textarea>
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
          <div class="empty-detail">
            <FileTextIcon aria-hidden="true" size={22} strokeWidth={1.7} />
            <p>No snippets available.</p>
            <Button size="sm" variant="primary" onclick={createSnippet}>
              <PlusIcon aria-hidden="true" size={14} strokeWidth={1.9} />
              New Snippet
            </Button>
          </div>
        {/if}
      </article>
    </div>
  {/if}
</section>

<style>
  .snippets-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    color: var(--ui-text-primary);
    background: var(--ui-surface-base);
  }

  .snippets-header,
  .detail-header,
  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .snippets-header {
    flex: 0 0 auto;
    padding: 0.9rem 1rem;
    border-bottom: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
  }

  .snippets-header p,
  .detail-header p {
    margin: 0 0 0.18rem;
    color: var(--ui-text-muted);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .snippets-header h2,
  .detail-header h3 {
    margin: 0;
    font-size: var(--text-lg);
    line-height: 1.2;
  }

  .header-actions,
  .detail-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .snippets-message {
    margin: 0.75rem 1rem;
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
  }

  .snippets-message.error {
    color: var(--ui-danger);
  }

  .snippets-message.inline {
    margin: 0.75rem 0 0;
  }

  .snippets-body {
    display: grid;
    grid-template-columns: minmax(13rem, 0.34fr) minmax(0, 1fr);
    min-height: 0;
    flex: 1 1 auto;
  }

  .snippets-list {
    min-height: 0;
    overflow: auto;
    border-right: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface-muted) 42%, transparent);
  }

  .snippets-list section {
    padding: 0.8rem;
  }

  .group-header {
    color: var(--ui-text-muted);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
  }

  .group-header strong {
    font-family: var(--font-mono);
    color: var(--ui-text-secondary);
  }

  .snippet-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.34rem;
    margin-top: 0.45rem;
    padding: 0.55rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-md);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .snippet-row:hover,
  .snippet-row.active {
    border-color: var(--ui-border-soft);
    background: var(--ui-surface-raised);
  }

  .row-title,
  .row-meta {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.4rem;
  }

  .row-title strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }

  .row-meta small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-muted);
    font-size: var(--text-xs);
  }

  .empty-list {
    margin: 0.55rem 0 0;
    color: var(--ui-text-muted);
    font-size: var(--text-xs);
  }

  .snippet-detail {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
  }

  .detail-header {
    align-items: flex-start;
  }

  .snippet-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .snippet-form label,
  .body-field {
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
    min-width: 0;
  }

  .snippet-form label span {
    color: var(--ui-text-muted);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .snippet-form input,
  .snippet-form textarea {
    width: 100%;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: var(--ui-surface-raised);
    color: var(--ui-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    padding: 0.52rem 0.6rem;
  }

  .snippet-form input:focus,
  .snippet-form textarea:focus {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .body-field {
    grid-column: 1 / -1;
  }

  .body-field textarea {
    min-height: 20rem;
    resize: vertical;
    font-family: var(--font-mono);
    line-height: 1.45;
  }

  .readonly-meta {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.45rem 0.7rem;
    margin-top: 1rem;
    font-size: var(--text-sm);
  }

  .readonly-meta span {
    color: var(--ui-text-muted);
  }

  .readonly-meta code,
  .readonly-meta strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .preview {
    margin-top: 1rem;
  }

  .preview h4 {
    margin: 0 0 0.45rem;
    font-size: var(--text-sm);
  }

  .preview pre {
    margin: 0;
    min-height: 20rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: var(--ui-surface-raised);
    padding: 0.8rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .empty-detail {
    min-height: 18rem;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 0.65rem;
    color: var(--ui-text-muted);
  }

  .empty-detail p {
    margin: 0;
    font-size: var(--text-sm);
  }

  @media (max-width: 760px) {
    .snippets-body,
    .snippet-form {
      grid-template-columns: 1fr;
    }

    .snippets-list {
      border-right: 0;
      border-bottom: 1px solid var(--ui-border-soft);
      max-height: 16rem;
    }
  }
</style>
