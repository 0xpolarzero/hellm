<script lang="ts">
  import { Command } from "cmdk-sv";
  import SearchIcon from "@lucide/svelte/icons/search";
  import {
    filterCommandActions,
    getCommandActionShortcutHints,
    type CommandAction,
    type CommandPaletteMode,
  } from "./command-palette";

  type Props = {
    open: boolean;
    mode: CommandPaletteMode;
    actions: CommandAction[];
    busy?: boolean;
    errorMessage?: string;
    onClose: () => void;
    onExecute: (action: CommandAction, event: KeyboardEvent | MouseEvent) => void;
    onFallbackPrompt: (prompt: string, event: KeyboardEvent) => void;
  };

  let {
    open,
    mode,
    actions,
    busy = false,
    errorMessage,
    onClose,
    onExecute,
    onFallbackPrompt,
  }: Props = $props();

  let search = $state("");

  const title = $derived(mode === "actions" ? "Command Palette" : "Quick Open");
  const placeholder = $derived(
    mode === "actions" ? "Type a command or prompt..." : "File quick-open is not available yet",
  );
  const renderedActions = $derived(mode === "actions" ? filterCommandActions(actions, search) : []);
  const hasActions = $derived(renderedActions.length > 0);

  $effect(() => {
    if (!open) {
      search = "";
    }
  });

  function handleRootKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Enter" || busy) {
      return;
    }

    if (mode === "quick-open") {
      event.preventDefault();
      return;
    }

    const selectedItem = document.querySelector<HTMLElement>(
      "[data-cmdk-root] [data-cmdk-item][data-selected]:not([data-disabled])",
    );
    const selectedActionId = selectedItem?.dataset.value;
    const selectedAction = renderedActions.find((action) => action.id === selectedActionId) ?? null;
    if (selectedAction) {
      event.preventDefault();
      onExecute(selectedAction, event);
      return;
    }

    const firstAction = renderedActions[0] ?? null;
    if (firstAction) {
      event.preventDefault();
      onExecute(firstAction, event);
      return;
    }

    const prompt = search.trim();
    if (!prompt) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    onFallbackPrompt(prompt, event);
  }

  function getAvailabilityLabel(action: CommandAction): string {
    if (action.availability.kind === "disabled") {
      return action.availability.reason;
    }
    return action.targetName ?? action.category;
  }
</script>

{#if open}
  <Command.Dialog
    bind:open
    label={title}
    shouldFilter={false}
    loop
    portal={null}
    contentClasses="command-palette-content"
    overlayClasses="command-palette-overlay"
    onOpenChange={(nextOpen) => {
      if (!nextOpen) onClose();
    }}
    onKeydown={handleRootKeydown}
  >
    <div class="command-palette-shell" data-testid={mode === "actions" ? "command-palette" : "quick-open"}>
      <div class="command-palette-input-row">
        <SearchIcon aria-hidden="true" size={17} strokeWidth={1.8} />
        <Command.Input
          bind:value={search}
          {placeholder}
          aria-label={title}
          disabled={busy}
        />
      </div>

      <Command.List>
        {#if mode === "quick-open"}
          <Command.Empty>
            <div class="command-palette-empty">
              <strong>File quick-open is reserved.</strong>
              <span>File, editor, and diagnostics surfaces are not available yet.</span>
            </div>
          </Command.Empty>
        {:else}
          {#if !hasActions && !search.trim()}
            <div class="command-palette-empty">
              <strong>No actions available</strong>
            </div>
          {/if}

          {#if hasActions}
            <Command.Group heading="Actions" alwaysRender>
              {#each renderedActions as action (action.id)}
                <Command.Item
                  value={action.id}
                  disabled={action.availability.kind === "disabled" || busy}
                  onSelect={() => onExecute(action, new MouseEvent("click"))}
                >
                  <div class="command-palette-item">
                    <div class="command-palette-item-copy">
                      <div class="command-palette-item-title">
                        <strong>{action.label}</strong>
                        {#if action.badge}
                          <span class="command-palette-kind-badge">{action.badge}</span>
                        {/if}
                      </div>
                      <span>{getAvailabilityLabel(action)}</span>
                    </div>
                    <div class="command-palette-item-meta">
                      {#each getCommandActionShortcutHints(action) as shortcut}
                        <kbd>{shortcut}</kbd>
                      {/each}
                      <span>{action.category}</span>
                    </div>
                  </div>
                </Command.Item>
              {/each}
            </Command.Group>
          {/if}

          {#if search.trim() && !hasActions}
            <div class="command-palette-empty">
              <strong>Start a new session</strong>
              <span>Press Enter to send this prompt to a new orchestrator session.</span>
            </div>
          {/if}
        {/if}
      </Command.List>

      {#if errorMessage}
        <p class="command-palette-error">{errorMessage}</p>
      {/if}

      <div class="command-palette-footer">
        {#if mode === "actions"}
          <span>Enter opens a result in a new pane</span>
          <span>Cmd+Enter uses the focused pane</span>
        {:else}
          <span>Cmd+P is reserved for future file quick-open</span>
        {/if}
      </div>
    </div>
  </Command.Dialog>
{/if}

<style>
  :global(.command-palette-overlay) {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(12 16 22 / 0.38);
  }

  :global(.command-palette-content) {
    position: fixed;
    top: 12vh;
    left: 50%;
    z-index: 90;
    width: min(720px, calc(100vw - 32px));
    transform: translateX(-50%);
    outline: none;
  }

  .command-palette-shell {
    overflow: hidden;
    border: 1px solid rgb(148 163 184 / 0.28);
    border-radius: 8px;
    background: #f8fafc;
    color: #111827;
    box-shadow: 0 24px 72px rgb(15 23 42 / 0.32);
  }

  .command-palette-input-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.62rem;
    padding: 0.88rem 1rem;
    border-bottom: 1px solid rgb(148 163 184 / 0.24);
    background: #ffffff;
  }

  :global([data-cmdk-input]) {
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
  }

  :global([data-cmdk-input]::placeholder) {
    color: #64748b;
  }

  :global([data-cmdk-list]) {
    max-height: min(420px, 55vh);
    overflow: auto;
    padding: 0.38rem;
  }

  :global([data-cmdk-group-heading]) {
    padding: 0.42rem 0.62rem;
    color: #64748b;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  :global([data-cmdk-item]) {
    border-radius: 6px;
    cursor: pointer;
  }

  :global([data-cmdk-item][data-selected]) {
    background: #dbeafe;
  }

  :global([data-cmdk-item][data-disabled]) {
    cursor: not-allowed;
    opacity: 0.54;
  }

  .command-palette-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    align-items: center;
    padding: 0.68rem 0.72rem;
  }

  .command-palette-item-copy {
    display: grid;
    min-width: 0;
    gap: 0.18rem;
  }

  .command-palette-item-title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
  }

  .command-palette-item-copy strong,
  .command-palette-item-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-palette-item-copy strong {
    min-width: 0;
  }

  .command-palette-kind-badge {
    flex: 0 0 auto;
    max-width: 8.5rem;
    padding: 0.12rem 0.42rem;
    border: 1px solid rgb(37 99 235 / 0.24);
    border-radius: 999px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0;
  }

  .command-palette-item-copy span,
  .command-palette-item-meta {
    color: #64748b;
    font-size: 0.78rem;
  }

  .command-palette-item-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  kbd {
    min-width: 1.6rem;
    padding: 0.12rem 0.32rem;
    border: 1px solid rgb(148 163 184 / 0.42);
    border-radius: 4px;
    background: #f1f5f9;
    color: #334155;
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 0.72rem;
    text-align: center;
  }

  .command-palette-empty {
    display: grid;
    gap: 0.3rem;
    padding: 1.4rem 1rem;
    color: #475569;
    text-align: center;
  }

  .command-palette-empty strong {
    color: #111827;
  }

  .command-palette-error {
    margin: 0;
    padding: 0.62rem 1rem;
    border-top: 1px solid rgb(239 68 68 / 0.22);
    background: #fef2f2;
    color: #991b1b;
    font-size: 0.86rem;
  }

  .command-palette-footer {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.58rem 1rem;
    border-top: 1px solid rgb(148 163 184 / 0.2);
    color: #64748b;
    font-size: 0.76rem;
  }

  @media (max-width: 640px) {
    :global(.command-palette-content) {
      top: 8vh;
      width: calc(100vw - 20px);
    }

    .command-palette-item {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.35rem;
    }

    .command-palette-footer {
      display: grid;
    }
  }
</style>
