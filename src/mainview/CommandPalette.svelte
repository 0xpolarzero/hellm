<script lang="ts">
  import { Command } from "cmdk-sv";
  import SearchIcon from "@lucide/svelte/icons/search";
  import {
    filterCommandActions,
    getCommandActionCategoryLabel,
    getCommandActionPlacementHints,
    getCommandActionShortcutHints,
    groupCommandActions,
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
  const actionGroups = $derived(groupCommandActions(renderedActions));
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

  function getActionMetaLabel(action: CommandAction): string {
    if (action.availability.kind === "disabled") {
      return "Unavailable";
    }
    return getCommandActionCategoryLabel(action.category);
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
    <div
      class="command-palette-shell"
      data-testid={mode === "actions" ? "command-palette" : "quick-open"}
    >
      <div class="command-palette-input-row">
        <SearchIcon aria-hidden="true" size={16} strokeWidth={1.8} />
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
            {#each actionGroups as group (group.category)}
              <Command.Group heading={`${group.label} ${group.actions.length}`} alwaysRender>
                {#each group.actions as action (action.id)}
                  <Command.Item
                    value={action.id}
                    disabled={action.availability.kind === "disabled" || busy}
                    onSelect={() => onExecute(action, new MouseEvent("click"))}
                  >
                    <div class="command-palette-item">
                      <div class="command-palette-item-copy">
                        <div class="command-palette-item-title">
                          <strong>{action.label}</strong>
                          <div class="command-palette-badges">
                            <span class="command-palette-category-badge">
                              {getActionMetaLabel(action)}
                            </span>
                            {#if action.badge}
                              <span class="command-palette-kind-badge">{action.badge}</span>
                            {/if}
                          </div>
                        </div>
                        <span class:disabled-copy={action.availability.kind === "disabled"}>
                          {getAvailabilityLabel(action)}
                        </span>
                      </div>
                      <div class="command-palette-item-meta">
                        {#each getCommandActionPlacementHints(action) as hint}
                          <span class="command-palette-placement">
                            <kbd>{hint.shortcut}</kbd>
                            <span>{hint.label}</span>
                          </span>
                        {/each}
                        {#if getCommandActionPlacementHints(action).length === 0}
                          {#each getCommandActionShortcutHints(action) as shortcut}
                            <kbd>{shortcut}</kbd>
                          {/each}
                        {/if}
                      </div>
                    </div>
                  </Command.Item>
                {/each}
              </Command.Group>
            {/each}
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
    background: color-mix(in oklab, var(--ui-bg) 18%, hsl(220 22% 8% / 0.56));
  }

  :global(.command-palette-content) {
    position: fixed;
    top: 10vh;
    left: 50%;
    z-index: 90;
    width: min(760px, calc(100vw - 32px));
    transform: translateX(-50%);
    outline: none;
  }

  .command-palette-shell {
    overflow: hidden;
    border: 1px solid var(--ui-border-strong);
    border-radius: var(--ui-radius-xl);
    background: var(--ui-surface-raised);
    color: var(--ui-text-primary);
    box-shadow: var(--ui-shadow-strong);
  }

  .command-palette-input-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-xs);
    padding: 0.68rem 0.82rem;
    border-bottom: 1px solid var(--ui-border-soft);
    background: var(--ui-panel);
    color: var(--ui-text-secondary);
  }

  :global([data-cmdk-input]) {
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.86rem;
    outline: none;
  }

  :global([data-cmdk-input]::placeholder) {
    color: var(--ui-text-tertiary);
  }

  :global([data-cmdk-list]) {
    max-height: min(440px, 56vh);
    overflow: auto;
    padding: 0.38rem;
    background: var(--ui-surface);
  }

  :global([data-cmdk-group-heading]) {
    padding: 0.5rem 0.5rem 0.26rem;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  :global([data-cmdk-item]) {
    position: relative;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-lg);
    cursor: pointer;
    transition:
      background-color 160ms ease,
      border-color 160ms ease,
      color 160ms ease;
  }

  :global([data-cmdk-item][data-selected]) {
    border-color: var(--ui-border-accent);
    background: var(--ui-accent-soft);
  }

  :global([data-cmdk-item][data-disabled]) {
    cursor: not-allowed;
    opacity: 0.54;
  }

  :global([data-cmdk-item][data-selected])::before {
    position: absolute;
    top: 0.44rem;
    bottom: 0.44rem;
    left: 0.14rem;
    width: 2px;
    border-radius: 999px;
    background: var(--ui-accent);
    content: "";
  }

  .command-palette-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-sm);
    align-items: center;
    min-height: 2.35rem;
    padding: 0.5rem 0.62rem 0.5rem 0.72rem;
  }

  .command-palette-item-copy {
    display: grid;
    min-width: 0;
    gap: 0.16rem;
  }

  .command-palette-item-title {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
  }

  .command-palette-item-copy strong,
  .command-palette-item-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-palette-item-copy strong {
    min-width: 0;
    color: var(--ui-text-primary);
    font-size: 0.82rem;
    font-weight: 650;
  }

  .command-palette-badges {
    display: inline-flex;
    flex: 0 1 auto;
    min-width: 0;
    align-items: center;
    gap: 0.3rem;
  }

  .command-palette-category-badge,
  .command-palette-kind-badge {
    flex: 0 0 auto;
    max-width: 9.5rem;
    overflow: hidden;
    padding: 0.08rem 0.36rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-palette-kind-badge {
    border-color: color-mix(in oklab, var(--ui-info) 32%, var(--ui-border-soft));
    background: var(--ui-info-soft);
    color: color-mix(in oklab, var(--ui-info) 76%, var(--ui-text-primary));
  }

  .command-palette-item-copy span,
  .command-palette-item-meta {
    color: var(--ui-text-tertiary);
    font-size: 0.74rem;
  }

  .command-palette-item-meta {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.46rem;
    min-width: 13rem;
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .command-palette-placement {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
  }

  .disabled-copy {
    color: var(--ui-warning);
  }

  kbd {
    min-width: 1.45rem;
    padding: 0.08rem 0.28rem;
    border: 1px solid var(--ui-border-strong);
    border-radius: var(--ui-radius-md);
    background: var(--ui-code);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: 0.64rem;
    text-align: center;
  }

  .command-palette-empty {
    display: grid;
    gap: 0.3rem;
    padding: 1.4rem 1rem;
    color: var(--ui-text-secondary);
    text-align: center;
  }

  .command-palette-empty strong {
    color: var(--ui-text-primary);
  }

  .command-palette-error {
    margin: 0;
    padding: 0.62rem 1rem;
    border-top: 1px solid color-mix(in oklab, var(--ui-danger) 28%, transparent);
    background: var(--ui-danger-soft);
    color: var(--ui-danger);
    font-size: 0.86rem;
  }

  .command-palette-footer {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.52rem 0.82rem;
    border-top: 1px solid var(--ui-border-soft);
    background: var(--ui-panel);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.68rem;
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

    .command-palette-item-title {
      align-items: flex-start;
      flex-direction: column;
    }

    .command-palette-item-meta {
      justify-content: flex-start;
      min-width: 0;
      overflow: auto;
      padding-bottom: 0.08rem;
    }

    .command-palette-footer {
      display: grid;
    }
  }
</style>
