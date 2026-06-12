<script lang="ts">
  import AlertCircleIcon from "@lucide/svelte/icons/alert-circle";
  import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
  import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import { isFileBackedEditConflictError } from "../shared/file-backed-edit";
  import type {
    ExtensionInstructionFileReadModel,
    ExtensionLoadedInstructionContributorReadModel,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import { formatTokenCount } from "./chat-format";
  import FileBackedConflictActions from "./ui/FileBackedConflictActions.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";
  import Tooltip from "./ui/Tooltip.svelte";

  type AutosaveStatus = "conflict" | "error" | "saved" | "saving" | "unsaved";

  type Props = {
    disabled?: boolean;
    editor?: string;
    extensionId: string;
    file: ExtensionInstructionFileReadModel;
    kind?: "full" | "minimal" | "script";
    label?: string;
    showTokenCount?: boolean;
    runtime: ChatRuntime;
    onSaved: () => void;
  };

  const AUTOSAVE_DELAY_MS = 700;

  let {
    disabled = false,
    editor = "system",
    extensionId,
    file,
    kind = "full",
    label = "editable",
    showTokenCount = true,
    runtime,
    onSaved,
  }: Props =
    $props();

  let draft = $state("");
  let savedContent = $state("");
  let baseSourceVersion = $state<string | undefined>(undefined);
  let conflictFile = $state<ExtensionInstructionFileReadModel | null>(null);
  let errorMessage = $state("");
  let loadedFileKey = $state("");
  let saving = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const dirty = $derived(draft !== savedContent);
  const status = $derived<AutosaveStatus>(
    conflictFile ? "conflict" : errorMessage ? "error" : saving ? "saving" : dirty ? "unsaved" : "saved",
  );

  $effect(() => {
    const fileKey = `${extensionId}:${kind}:${file.name}`;
    if (loadedFileKey !== fileKey) {
      loadedFileKey = fileKey;
      draft = file.content;
      savedContent = file.content;
      baseSourceVersion = file.sourceVersion;
      conflictFile = null;
      errorMessage = "";
      return;
    }
    if (file.sourceVersion === baseSourceVersion) return;
    if (dirty) {
      conflictFile = file;
      return;
    }
    savedContent = file.content;
    draft = file.content;
    baseSourceVersion = file.sourceVersion;
    conflictFile = null;
    errorMessage = "";
  });

  $effect(() => {
    if (!dirty || conflictFile || saving || disabled || !file.editable) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save("compare-and-swap"), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
    };
  });

  async function save(mode: "compare-and-swap" | "overwrite") {
    if (!file.editable || disabled) return;
    saving = true;
    errorMessage = "";
    try {
      const inventory = await runtime.updateExtensionInstructionFile({
        extensionId,
        kind,
        name: file.name,
        content: draft,
        baseSourceVersion,
        mode,
      });
      const savedFile = inventory.extensions
        .find((extension) => extension.id === extensionId)
        ?.[kind === "minimal" ? "minimalInstruction" : "loadedInstructionContributors"];
      const savedSourceVersion =
        kind === "minimal"
          ? (savedFile as ExtensionInstructionFileReadModel | undefined)?.sourceVersion
          : kind === "script"
            ? (savedFile as ExtensionLoadedInstructionContributorReadModel[] | undefined)?.find(
                (candidate) =>
                  candidate.kind === "scripted" && candidate.script.name === file.name,
              )?.script.sourceVersion
            : (savedFile as ExtensionLoadedInstructionContributorReadModel[] | undefined)?.find(
                (candidate) =>
                  candidate.kind === "source" && candidate.file.name === file.name,
              )?.file.sourceVersion;
      savedContent = draft;
      baseSourceVersion = savedSourceVersion ?? baseSourceVersion;
      conflictFile = null;
      onSaved();
    } catch (error) {
      if (isFileBackedEditConflictError<ExtensionInstructionFileReadModel>(error)) {
        conflictFile = error.conflict.current;
        baseSourceVersion = error.conflict.currentVersion;
      } else {
        errorMessage = error instanceof Error ? error.message : "Unable to save instruction file.";
      }
    } finally {
      saving = false;
    }
  }

  function discardLocalChanges() {
    const current = conflictFile ?? file;
    draft = current.content;
    savedContent = current.content;
    baseSourceVersion = current.sourceVersion;
    conflictFile = null;
    errorMessage = "";
  }

  async function openExternal() {
    await runtime.openExtensionInstructionFileInEditor({ extensionId, kind, name: file.name });
  }

  function autosaveStatusLabel(input: AutosaveStatus): string {
    if (input === "conflict") return "File changed outside svvy";
    if (input === "error") return "Autosave failed";
    if (input === "saving") return "Saving changes";
    if (input === "unsaved") return "Unsaved changes";
    return "Saved";
  }
</script>

<div class={`extension-instruction-editor ${file.skipped ? "is-skipped" : ""}`.trim()}>
  <div class="extension-instruction-shell" data-autosave-status={status}>
    <textarea
      class="extension-instruction-field"
      value={draft}
      disabled={disabled || !file.editable}
      aria-label={`${file.name} instruction content`}
      oninput={(event) => (draft = event.currentTarget.value)}
    ></textarea>
    <div class="extension-autosave-tooltip">
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
          <span class="extension-autosave-icon icon-error">
            <AlertCircleIcon size={13} strokeWidth={2} aria-hidden="true" />
          </span>
          <span class="extension-autosave-icon extension-autosave-spinner icon-saving">
            <LoaderCircleIcon size={13} strokeWidth={2} aria-hidden="true" />
          </span>
          <span class="extension-autosave-icon icon-unsaved">
            <CircleDashedIcon size={13} strokeWidth={2} aria-hidden="true" />
          </span>
          <span class="extension-autosave-icon icon-saved">
            <CheckCircle2Icon size={13} strokeWidth={2} aria-hidden="true" />
          </span>
        </span>
        </Tooltip>
      {/if}
    </div>
  </div>
  <div class="extension-instruction-source-note">
    <div class="extension-instruction-source-meta">
      <strong>{file.name}</strong>
      <span>{file.editable ? label : "read-only"}</span>
      <span>{file.skipped ? "skipped" : "loaded"}</span>
      {#if showTokenCount}
        <span>~{formatTokenCount(file.tokenCount.tokens)} tokens</span>
      {/if}
    </div>
    <Tooltip label="Open instruction file in external editor">
      <OpenExternalButton
        editor={editor as never}
        targetLabel={file.path}
        disabled={disabled}
        onclick={openExternal}
      />
    </Tooltip>
  </div>
  {#if errorMessage}
    <p class="extension-instruction-error" role="alert">{errorMessage}</p>
  {/if}
</div>

<style>
  .extension-instruction-editor {
    display: grid;
    gap: 0.26rem;
    min-width: 0;
  }

  .extension-instruction-editor.is-skipped {
    opacity: 0.74;
  }

  .extension-instruction-source-note {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    align-items: center;
    gap: 0.36rem;
    min-width: 0;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    line-height: 1;
  }

  .extension-instruction-source-meta {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    min-width: 0;
  }

  .extension-instruction-source-note strong,
  .extension-instruction-source-note span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-instruction-source-note strong {
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .extension-instruction-source-note span,
  .extension-instruction-status {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 600;
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

  .extension-instruction-shell {
    position: relative;
  }

  .extension-instruction-field {
    box-sizing: border-box;
    width: 100%;
    min-height: 4rem;
    resize: vertical;
    padding: 0.42rem 2rem 0.42rem 0.5rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-bg-elevated) 84%, transparent);
    color: var(--ui-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .extension-instruction-field:hover:not(:disabled),
  .extension-instruction-field:focus-visible:not(:disabled) {
    outline: none;
    border-color: color-mix(in oklab, var(--ui-accent) 36%, var(--ui-border-soft));
    box-shadow: var(--ui-focus-ring);
  }

  .extension-instruction-field:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .extension-autosave-tooltip {
    position: absolute;
    top: 0.36rem;
    right: 0.36rem;
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

  .extension-instruction-shell[data-autosave-status="saved"] .icon-saved {
    opacity: 1;
    color: color-mix(in oklab, var(--ui-success) 54%, var(--ui-text-tertiary));
  }

  .extension-instruction-shell[data-autosave-status="saving"] .icon-saving {
    opacity: 1;
    color: color-mix(in oklab, var(--ui-accent) 68%, var(--ui-text-secondary));
  }

  .extension-instruction-shell[data-autosave-status="unsaved"] .icon-unsaved {
    opacity: 1;
    color: var(--ui-text-tertiary);
  }

  .extension-instruction-shell[data-autosave-status="error"] .icon-error,
  .extension-instruction-shell[data-autosave-status="conflict"] .icon-error {
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
