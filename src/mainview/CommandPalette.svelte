<script lang="ts">
  import { Command } from "cmdk-sv";
  import SearchIcon from "@lucide/svelte/icons/search";
  import {
    filterCommandActions,
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

  function getBadgeClass(action: CommandAction): string {
    return action.badge ? action.badge.toLowerCase().replace(/\s+/g, "-") : "default";
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
                          {#if action.badge}
                            <div class="command-palette-badges">
                              <span class={`command-palette-kind-badge badge-${getBadgeClass(action)}`}>
                                {action.badge}
                              </span>
                            </div>
                          {/if}
                        </div>
                        <span class:disabled-copy={action.availability.kind === "disabled"}>
                          {getAvailabilityLabel(action)}
                        </span>
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
          <span><kbd>Enter</kbd> opens a result in a new pane</span>
          <span><kbd>Cmd+Enter</kbd> uses the focused pane</span>
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
    background: color-mix(in oklab, var(--ui-bg) 22%, hsl(220 18% 6% / 0.66));
  }

  :global(.command-palette-content) {
    position: fixed;
    top: 8vh;
    left: 50%;
    z-index: 90;
    width: min(680px, calc(100vw - 28px));
    transform: translateX(-50%);
    outline: none;
  }

  .command-palette-shell {
    overflow: hidden;
    border: 1px solid var(--ui-border-strong);
    border-radius: var(--ui-radius-lg);
    background: var(--ui-surface);
    color: var(--ui-text-primary);
    box-shadow: var(--ui-shadow-strong);
  }

  .command-palette-input-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
    min-height: 2.45rem;
    padding: 0.45rem 0.68rem;
    border-bottom: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-panel) 88%, transparent);
    color: var(--ui-text-secondary);
  }

  :global([data-cmdk-input]) {
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    outline: none;
  }

  :global([data-cmdk-input]::placeholder) {
    color: var(--ui-text-tertiary);
  }

  :global([data-cmdk-list]) {
    max-height: min(392px, 54vh);
    overflow: auto;
    padding: 0.2rem;
    background: var(--ui-surface);
  }

  :global([data-cmdk-group-heading]) {
    padding: 0.38rem 0.44rem 0.16rem;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.61rem;
    font-weight: 650;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  :global([data-cmdk-item]) {
    position: relative;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    transition:
      background-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
      border-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
      color 160ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  :global([data-cmdk-item][data-selected]) {
    border-color: var(--ui-border-accent);
    background: color-mix(in oklab, var(--ui-accent-soft) 82%, var(--ui-surface));
  }

  :global([data-cmdk-item][data-disabled]) {
    cursor: not-allowed;
    opacity: 0.54;
  }

  :global([data-cmdk-item][data-selected])::before {
    position: absolute;
    top: 0.36rem;
    bottom: 0.36rem;
    left: 0.1rem;
    width: 2px;
    border-radius: var(--ui-radius-xs);
    background: var(--ui-accent);
    content: "";
  }

  .command-palette-item {
    display: block;
    align-items: center;
    min-height: 1.88rem;
    padding: 0.3rem 0.5rem 0.3rem 0.62rem;
  }

  .command-palette-item-copy {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .command-palette-item-title {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
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
    font-size: 0.76rem;
    font-weight: 650;
  }

  .command-palette-badges {
    display: inline-flex;
    flex: 0 1 auto;
    min-width: 0;
    align-items: center;
    gap: 0.3rem;
  }

  .command-palette-kind-badge {
    flex: 0 0 auto;
    max-width: 9.5rem;
    overflow: hidden;
    min-height: 1.06rem;
    padding: 0.07rem 0.32rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 650;
    letter-spacing: 0;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge-orchestrator {
    border-color: color-mix(in oklab, var(--ui-info) 32%, var(--ui-border-soft));
    background: var(--ui-info-soft);
    color: color-mix(in oklab, var(--ui-info) 76%, var(--ui-text-primary));
  }

  .badge-thread {
    border-color: color-mix(in oklab, var(--ui-accent) 34%, var(--ui-border-soft));
    background: var(--ui-accent-soft);
    color: color-mix(in oklab, var(--ui-accent) 82%, var(--ui-text-primary));
  }

  .badge-task-agent,
  .badge-workflow-task-agent {
    border-color: color-mix(in oklab, var(--ui-success) 28%, var(--ui-border-soft));
    background: var(--ui-success-soft);
    color: color-mix(in oklab, var(--ui-success) 76%, var(--ui-text-primary));
  }

  .command-palette-item-copy span {
    color: var(--ui-text-tertiary);
    font-size: 0.68rem;
  }

  .disabled-copy {
    color: var(--ui-warning);
  }

  kbd {
    min-width: 1.28rem;
    padding: 0.06rem 0.22rem;
    border: 1px solid var(--ui-border-strong);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-code);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: 0.58rem;
    text-align: center;
  }

  .command-palette-empty {
    display: grid;
    gap: 0.24rem;
    padding: 1.05rem 0.9rem;
    color: var(--ui-text-secondary);
    text-align: center;
    font-size: 0.76rem;
  }

  .command-palette-empty strong {
    color: var(--ui-text-primary);
  }

  .command-palette-error {
    margin: 0;
    padding: 0.5rem 0.72rem;
    border-top: 1px solid color-mix(in oklab, var(--ui-danger) 28%, transparent);
    background: var(--ui-danger-soft);
    color: var(--ui-danger);
    font-size: 0.76rem;
  }

  .command-palette-footer {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2rem;
    padding: 0.36rem 0.68rem;
    border-top: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-panel) 88%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.61rem;
  }

  @media (max-width: 640px) {
    :global(.command-palette-content) {
      top: 8vh;
      width: calc(100vw - 20px);
    }

    .command-palette-item {
      min-height: 0;
    }

    .command-palette-item-title {
      align-items: flex-start;
      flex-direction: column;
      gap: 0.18rem;
    }

    .command-palette-footer {
      display: grid;
    }
  }
</style>
