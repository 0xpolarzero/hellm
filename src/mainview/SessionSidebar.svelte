<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import type { WorkspaceSessionSummary } from "./chat-rpc";
  import SessionListItem from "./SessionListItem.svelte";
  import Button from "./ui/Button.svelte";

  type Props = {
    workspaceLabel: string;
    branch?: string;
    sessions: WorkspaceSessionSummary[];
    activeSessionId?: string;
    busy?: boolean;
    errorMessage?: string;
    onCreateSession: () => void;
    onOpenSession: (sessionId: string) => void;
    onRenameSession: (session: WorkspaceSessionSummary) => void;
    onForkSession: (session: WorkspaceSessionSummary) => void;
    onDeleteSession: (session: WorkspaceSessionSummary) => void;
  };

  let {
    workspaceLabel,
    branch,
    sessions,
    activeSessionId,
    busy = false,
    errorMessage,
    onCreateSession,
    onOpenSession,
    onRenameSession,
    onForkSession,
    onDeleteSession,
  }: Props = $props();
</script>

<div class="session-sidebar">
  <header class="sidebar-header">
    <div class="sidebar-header-copy">
      <p class="sidebar-eyebrow">Sessions</p>
      <h2>{workspaceLabel}</h2>
      <p class="sidebar-context">
        {#if branch}
          <span>{branch}</span>
          <span aria-hidden="true">•</span>
        {/if}
        <span>{sessions.length} sessions</span>
      </p>
    </div>
    <Button
      variant="ghost"
      size="sm"
      class="new-session"
      onclick={onCreateSession}
      disabled={busy}
      aria-label="Create a new session"
      title="New Session"
    >
      <PlusIcon aria-hidden="true" size={15} strokeWidth={1.85} />
      New
    </Button>
  </header>

  {#if errorMessage}
    <p class="sidebar-error">{errorMessage}</p>
  {/if}

  <div class="sidebar-sections">
    <div class="sidebar-list">
      {#each sessions as session (session.id)}
        <SessionListItem
          active={session.id === activeSessionId}
          disabled={busy && session.id !== activeSessionId}
          {session}
          onOpen={() => onOpenSession(session.id)}
          onRename={() => onRenameSession(session)}
          onFork={() => onForkSession(session)}
          onDelete={() => onDeleteSession(session)}
        />
      {/each}
    </div>
  </div>
</div>

<style>
  .session-sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    height: 100%;
    min-height: 0;
  }

  .sidebar-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 48%, transparent);
  }

  .sidebar-header-copy h2,
  .sidebar-eyebrow,
  .sidebar-context,
  .sidebar-error {
    margin: 0;
  }

  .sidebar-eyebrow {
    font-size: 0.64rem;
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ui-text-tertiary);
  }

  h2 {
    margin: 0.28rem 0 0;
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .sidebar-context {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-top: 0.42rem;
    font-size: 0.67rem;
    color: var(--ui-text-tertiary);
  }

  :global(button.new-session) {
    flex-shrink: 0;
    min-width: auto;
    padding-inline: 0.5rem;
    color: var(--ui-text-secondary);
  }

  .sidebar-error {
    padding: 0.68rem 0.76rem;
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-danger-soft) 86%, transparent);
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
    font-size: 0.74rem;
    line-height: 1.5;
  }

  .sidebar-sections {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 0.15rem;
  }

  .sidebar-list {
    display: grid;
    gap: 0.12rem;
  }
</style>
