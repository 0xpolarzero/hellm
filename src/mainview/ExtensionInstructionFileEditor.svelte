<script lang="ts">
  import AlertCircleIcon from "@lucide/svelte/icons/alert-circle";
  import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
  import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import type { Snippet } from "svelte";
  import type { OpenExtensionSourceEditInput, SourceEditSession } from "@svvy/core";
  import type { ChatRuntime } from "./chat-runtime";
  import { formatTokenCount } from "./chat-format";
  import FileBackedConflictActions from "./ui/FileBackedConflictActions.svelte";
  import SourceMetadataTextArea from "./ui/SourceMetadataTextArea.svelte";
  import Tooltip from "./ui/Tooltip.svelte";

  type AutosaveStatus = "conflict" | "error" | "saved" | "saving" | "unsaved";

  type Props = {
    disabled?: boolean;
    editor?: string;
    bypassed: boolean;
    editable: boolean;
    footerControls?: Snippet;
    name: string;
    openable: boolean;
    source: OpenExtensionSourceEditInput;
    showTokenCount?: boolean;
    runtime: ChatRuntime;
    onSaved: () => void;
  };

  const AUTOSAVE_DELAY_MS = 700;

  let {
    disabled = false,
    editor = "system",
    bypassed,
    editable,
    footerControls,
    name,
    openable,
    source,
    showTokenCount = true,
    runtime,
    onSaved,
  }: Props =
    $props();

  let draft = $state("");
  let savedContent = $state("");
  let baseSourceVersion = $state<string | undefined>(undefined);
  let session = $state<SourceEditSession | null>(null);
  let conflictSession = $state<SourceEditSession | null>(null);
  let errorMessage = $state("");
  let loading = $state(false);
  let loadGeneration = 0;
  let saving = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const dirty = $derived(draft !== savedContent);
  const status = $derived<AutosaveStatus>(
    conflictSession
      ? "conflict"
      : errorMessage
        ? "error"
        : saving || loading
          ? "saving"
          : dirty
            ? "unsaved"
            : "saved",
  );
  const tokenCount = $derived(Math.ceil(draft.length / 4));

  $effect(() => {
    const sourceKind = source.sourceKind;
    const sourceId = source.sourceId;
    const generation = ++loadGeneration;
    loading = true;
    errorMessage = "";
    void runtime
      .openSourceEdit({ sourceKind, sourceId })
      .then((nextSession) => {
        if (generation !== loadGeneration) return;
        session = nextSession;
        draft = nextSession.text;
        savedContent = nextSession.text;
        baseSourceVersion = nextSession.sourceVersion;
        conflictSession = null;
      })
      .catch((error) => {
        if (generation !== loadGeneration) return;
        errorMessage = error instanceof Error ? error.message : "Unable to load extension source.";
      })
      .finally(() => {
        if (generation === loadGeneration) loading = false;
      });
  });

  $effect(() => {
    if (!dirty || conflictSession || saving || loading || disabled || !editable) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save("compare-and-swap"), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
    };
  });

  async function save(mode: "compare-and-swap" | "overwrite") {
    if (!editable || disabled) return;
    saving = true;
    errorMessage = "";
    try {
      if (!baseSourceVersion) {
        throw new Error(`Editable extension source version is unavailable: ${name}`);
      }
      const result = await runtime.saveSourceEdit({
        ...source,
        expectedSourceVersion: baseSourceVersion,
        text: draft,
        saveMode: mode,
      });
      if (result.status === "stale") {
        conflictSession = result.current;
        baseSourceVersion = result.current.sourceVersion;
        return;
      }
      savedContent = draft;
      baseSourceVersion = result.sourceVersion;
      session = session ? { ...session, text: draft, sourceVersion: result.sourceVersion } : session;
      conflictSession = null;
      onSaved();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to save instruction file.";
    } finally {
      saving = false;
    }
  }

  function discardLocalChanges() {
    const current = conflictSession ?? session;
    if (!current) return;
    draft = current.text;
    savedContent = current.text;
    baseSourceVersion = current.sourceVersion;
    session = current;
    conflictSession = null;
    errorMessage = "";
  }

  async function openExternal() {
    if (!openable) return;
    await runtime.openSourceInEditor(source);
  }

  function autosaveStatusLabel(input: AutosaveStatus): string {
    if (input === "conflict") return "File changed outside svvy";
    if (input === "error") return "Autosave failed";
    if (input === "saving") return "Saving changes";
    if (input === "unsaved") return "Unsaved changes";
    return "Saved";
  }
</script>

<div class={`extension-instruction-editor ${bypassed ? "is-bypassed" : ""}`.trim()}>
  <SourceMetadataTextArea
    value={draft}
    status={status}
    aria-label={`${name} instruction content`}
    disabled={disabled || !editable || loading}
    showTokenCount={showTokenCount}
    tokenCountLabel={showTokenCount ? `~${formatTokenCount(tokenCount)} tokens` : null}
    sourceLabel={name}
    sourceDisabled={disabled || loading || !session || !openable}
    sourceEditor={editor as never}
    oninput={(event) => (draft = event.currentTarget.value)}
    onOpenSource={openExternal}
  >
    {#snippet statusOverlay()}
      {#if status === "conflict"}
        <FileBackedConflictActions
          disabled={saving}
          onDiscard={discardLocalChanges}
          onOverwrite={() => void save("overwrite")}
        />
      {:else}
        <Tooltip label={autosaveStatusLabel(status)}>
        <span
          class="extension-autosave-status"
          role="status"
          aria-live="polite"
          aria-label={autosaveStatusLabel(status)}
        >
          <span class={`extension-autosave-icon icon-error ${status === "error" || status === "conflict" ? "active" : ""}`.trim()}>
            <AlertCircleIcon size={13} strokeWidth={2} aria-hidden="true" />
          </span>
          <span class={`extension-autosave-icon extension-autosave-spinner icon-saving ${status === "saving" ? "active" : ""}`.trim()}>
            <LoaderCircleIcon size={13} strokeWidth={2} aria-hidden="true" />
          </span>
          <span class={`extension-autosave-icon icon-unsaved ${status === "unsaved" ? "active" : ""}`.trim()}>
            <CircleDashedIcon size={13} strokeWidth={2} aria-hidden="true" />
          </span>
          <span class={`extension-autosave-icon icon-saved ${status === "saved" ? "active" : ""}`.trim()}>
            <CheckCircle2Icon size={13} strokeWidth={2} aria-hidden="true" />
          </span>
        </span>
        </Tooltip>
      {/if}
    {/snippet}
    {#snippet footerLeading()}
      {#if footerControls}
        {@render footerControls()}
      {/if}
      {#if bypassed}
        <span class="extension-bypassed-chip">Bypassed</span>
      {/if}
    {/snippet}
  </SourceMetadataTextArea>
  {#if errorMessage}
    <p class="extension-instruction-error" role="alert">{errorMessage}</p>
  {/if}
  {#if (conflictSession ?? session)?.diagnostics.length}
    <div class="extension-source-diagnostics" aria-label={`${name} diagnostics`}>
      {#each (conflictSession ?? session)?.diagnostics ?? [] as diagnostic, index (`${diagnostic.code ?? "diagnostic"}:${index}`)}
        <p class={`extension-instruction-error ${diagnostic.severity}`.trim()}>
          {diagnostic.message}
        </p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .extension-instruction-editor {
    display: grid;
    gap: 0.26rem;
    min-width: 0;
  }

  .extension-instruction-editor.is-bypassed {
    opacity: 0.82;
  }

  .extension-instruction-editor.is-bypassed :global(.source-metadata-textarea) {
    border-color: color-mix(in oklab, var(--ui-warning) 46%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-warning) 8%, var(--ui-bg-elevated));
  }

  .extension-bypassed-chip,
  .extension-instruction-status {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .extension-bypassed-chip {
    padding: 0.05rem 0.3rem;
    border: 1px solid color-mix(in oklab, var(--ui-warning) 40%, var(--ui-border-soft));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-warning) 12%, transparent);
    color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
    line-height: 1.05;
  }

  .extension-instruction-status.error,
  .extension-instruction-error {
    color: var(--ui-danger);
  }

  .extension-instruction-error {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .extension-autosave-status {
    position: relative;
    display: block;
    width: 1.28rem;
    height: 1.28rem;
    color: var(--ui-text-tertiary);
    opacity: 0.72;
    contain: layout paint style;
  }

  .extension-autosave-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    place-items: center;
    opacity: 0;
    transform: translate(-50%, -50%);
    transition:
      opacity 120ms ease,
      color 120ms ease;
  }

  .extension-autosave-icon :global(svg) {
    display: block;
  }

  .extension-autosave-icon.active.icon-saved {
    opacity: 1;
    color: color-mix(in oklab, var(--ui-success) 54%, var(--ui-text-tertiary));
  }

  .extension-autosave-icon.active.icon-saving {
    opacity: 1;
    color: color-mix(in oklab, var(--ui-accent) 68%, var(--ui-text-secondary));
  }

  .extension-autosave-icon.active.icon-unsaved {
    opacity: 1;
    color: var(--ui-text-tertiary);
  }

  .extension-autosave-icon.active.icon-error {
    opacity: 1;
    color: color-mix(in oklab, var(--ui-danger) 76%, var(--ui-text-secondary));
  }

  .extension-autosave-spinner {
    animation: extension-autosave-spin 0.85s linear infinite;
  }

  @keyframes extension-autosave-spin {
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }
</style>
