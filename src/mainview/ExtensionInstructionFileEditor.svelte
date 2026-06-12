<script lang="ts">
  import { isFileBackedEditConflictError } from "../shared/file-backed-edit";
  import type { ExtensionInstructionFileReadModel } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import { formatTokenCount } from "./chat-format";
  import FileBackedConflictActions from "./ui/FileBackedConflictActions.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";
  import TextArea from "./ui/TextArea.svelte";
  import Tooltip from "./ui/Tooltip.svelte";

  type AutosaveStatus = "conflict" | "error" | "saved" | "saving" | "unsaved";

  type Props = {
    disabled?: boolean;
    editor?: string;
    extensionId: string;
    file: ExtensionInstructionFileReadModel;
    runtime: ChatRuntime;
    onSaved: () => void;
  };

  const AUTOSAVE_DELAY_MS = 700;

  let { disabled = false, editor = "system", extensionId, file, runtime, onSaved }: Props =
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
    const fileKey = `${extensionId}:${file.name}`;
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
        name: file.name,
        content: draft,
        baseSourceVersion,
        mode,
      });
      const savedFile = inventory.extensions
        .find((extension) => extension.id === extensionId)
        ?.instructionFiles?.find((candidate) => candidate.name === file.name);
      savedContent = draft;
      baseSourceVersion = savedFile?.sourceVersion ?? baseSourceVersion;
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
    await runtime.openExtensionInstructionFileInEditor({ extensionId, name: file.name });
  }
</script>

<div class={`extension-instruction-editor ${file.skipped ? "is-skipped" : ""}`.trim()}>
  <div class="extension-instruction-editor-bar">
    <div>
      <strong>{file.name}</strong>
      <span>{file.generated ? "generated" : file.editable ? "editable" : "read-only"}</span>
      <span>{file.skipped ? "skipped" : "loaded"}</span>
      <span>~{formatTokenCount(file.tokenCount.tokens)} tokens</span>
    </div>
    <div class="extension-instruction-editor-actions">
      {#if status === "conflict"}
        <FileBackedConflictActions
          disabled={saving}
          onDiscard={discardLocalChanges}
          onOverwrite={() => void save("overwrite")}
        />
      {:else if status !== "saved"}
        <span class={`extension-instruction-status ${status}`}>{status}</span>
      {/if}
      <Tooltip label="Open instruction file in external editor">
        <OpenExternalButton
          editor={editor as never}
          targetLabel={file.path}
          disabled={disabled}
          onclick={openExternal}
        />
      </Tooltip>
    </div>
  </div>
  <TextArea
    value={draft}
    resize="vertical"
    disabled={disabled || !file.editable}
    aria-label={`${file.name} instruction content`}
    oninput={(event) => (draft = (event.currentTarget as HTMLTextAreaElement).value)}
  />
  {#if errorMessage}
    <p class="extension-instruction-error" role="alert">{errorMessage}</p>
  {/if}
</div>

<style>
  .extension-instruction-editor {
    display: grid;
    gap: 0.34rem;
    min-width: 0;
    padding: 0.42rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 62%, transparent);
  }

  .extension-instruction-editor.is-skipped {
    opacity: 0.74;
  }

  .extension-instruction-editor-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-width: 0;
  }

  .extension-instruction-editor-bar > div:first-child,
  .extension-instruction-editor-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    min-width: 0;
  }

  .extension-instruction-editor-bar strong,
  .extension-instruction-editor-bar span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-instruction-editor-bar strong {
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .extension-instruction-editor-bar span,
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
</style>
