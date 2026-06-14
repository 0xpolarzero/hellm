<script lang="ts">
  import XIcon from "@lucide/svelte/icons/x";
  import type { WorkspaceCommandOutputEvent } from "../shared/workspace-contract";

  type StatusTone = "running" | "success" | "danger" | "neutral";

  type Props = {
    title: string;
    command?: string | null;
    events: WorkspaceCommandOutputEvent[];
    status?: string | null;
    tone?: StatusTone;
    closeLabel?: string;
    onClose?: () => void;
  };

  let {
    title,
    command = null,
    events,
    status = null,
    tone = "neutral",
    closeLabel = "Close command output",
    onClose,
  }: Props = $props();
</script>

<section class={`command-output-panel ${tone}`} aria-label={title}>
  <header>
    <div>
      <strong>{title}</strong>
      {#if status}
        <span>{status}</span>
      {/if}
    </div>
    {#if onClose}
      <button type="button" class="command-output-close" aria-label={closeLabel} onclick={onClose}>
        <XIcon size={13} aria-hidden="true" />
      </button>
    {/if}
  </header>
  {#if command}
    <code class="command-output-command">{command}</code>
  {/if}
  <div class="command-output-events" aria-live="polite">
    {#if events.length === 0}
      <pre class="command-output-empty">Waiting for output...</pre>
    {:else}
      {#each events as event (event.eventId)}
        <article class={`command-output-event ${event.stream}`}>
          <div>
            <span>{event.stream}</span>
            <time datetime={event.at}>{event.at}</time>
          </div>
          <pre>{event.text}</pre>
        </article>
      {/each}
    {/if}
  </div>
</section>

<style>
  .command-output-panel {
    display: grid;
    gap: 0;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-code) 94%, transparent);
  }

  .command-output-panel.running {
    border-color: color-mix(in oklab, var(--ui-accent) 30%, var(--ui-border-soft));
  }

  .command-output-panel.success {
    border-color: color-mix(in oklab, var(--ui-success) 30%, var(--ui-border-soft));
  }

  .command-output-panel.danger {
    border-color: color-mix(in oklab, var(--ui-danger) 35%, var(--ui-border-soft));
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.44rem;
    min-width: 0;
    padding: 0.42rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
  }

  header > div {
    display: flex;
    align-items: center;
    gap: 0.44rem;
    min-width: 0;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-primary);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header span {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .command-output-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    flex: 0 0 auto;
    border: 0;
    border-radius: var(--ui-radius-xs);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: default;
  }

  .command-output-close:hover {
    background: color-mix(in oklab, var(--ui-surface) 82%, transparent);
    color: var(--ui-text-primary);
  }

  .command-output-command {
    display: block;
    min-width: 0;
    overflow: hidden;
    padding: 0.42rem 0.55rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 68%, transparent);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-output-events {
    display: grid;
    gap: 0;
    max-height: 14rem;
    overflow: auto;
  }

  .command-output-event {
    display: grid;
    gap: 0;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 48%, transparent);
  }

  .command-output-event:last-child {
    border-bottom: 0;
  }

  .command-output-event.stderr {
    background: color-mix(in oklab, var(--ui-warning) 5%, transparent);
  }

  .command-output-event > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.44rem;
    min-width: 0;
    padding: 0.25rem 0.55rem 0;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .command-output-event > div span,
  .command-output-event > div time {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  pre {
    margin: 0;
    overflow: auto;
    padding: 0.35rem 0.55rem 0.5rem;
    border: 0;
    background: transparent;
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .command-output-empty {
    color: var(--ui-text-tertiary);
  }
</style>
