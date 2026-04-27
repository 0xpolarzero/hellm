<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import type { WorkspaceSessionNavigationReadModel, WorkspaceSessionSummary } from "./chat-rpc";
  import SessionListItem from "./SessionListItem.svelte";
  import Button from "./ui/Button.svelte";

  type Props = {
    workspaceLabel: string;
    branch?: string;
    navigation: WorkspaceSessionNavigationReadModel;
    activeSessionId?: string;
    activeSurface?: "orchestrator" | "thread";
    paneLocationsBySessionId?: Record<string, { paneId: string; label: string; focused: boolean }[]>;
    busy?: boolean;
    errorMessage?: string;
    onCreateSession: () => void;
    onOpenSession: (sessionId: string) => void;
    onRenameSession: (session: WorkspaceSessionSummary) => void;
    onForkSession: (session: WorkspaceSessionSummary) => void;
    onDeleteSession: (session: WorkspaceSessionSummary) => void;
    onPinSession: (session: WorkspaceSessionSummary) => void;
    onUnpinSession: (session: WorkspaceSessionSummary) => void;
    onArchiveSession: (session: WorkspaceSessionSummary) => void;
    onUnarchiveSession: (session: WorkspaceSessionSummary) => void;
    onToggleArchivedGroup: (collapsed: boolean) => void;
  };

  let {
    workspaceLabel,
    branch,
    navigation,
    activeSessionId,
    activeSurface,
    paneLocationsBySessionId = {},
    busy = false,
    errorMessage,
    onCreateSession,
    onOpenSession,
    onRenameSession,
    onForkSession,
    onDeleteSession,
    onPinSession,
    onUnpinSession,
    onArchiveSession,
    onUnarchiveSession,
    onToggleArchivedGroup,
  }: Props = $props();

  const sessionCount = $derived(
    navigation.pinnedSessions.length +
      navigation.activeSessions.length +
      navigation.archived.sessions.length,
  );
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
        <span>{sessionCount} sessions</span>
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
      {#if navigation.pinnedSessions.length > 0}
        <section class="sidebar-section" aria-label="Pinned sessions">
          <p class="sidebar-section-label">Pinned</p>
          {#each navigation.pinnedSessions as session (session.id)}
            <SessionListItem
              active={session.id === activeSessionId}
              activeSurface={session.id === activeSessionId ? activeSurface : undefined}
              disabled={busy && session.id !== activeSessionId}
              paneLocations={paneLocationsBySessionId[session.id] ?? []}
              {session}
              onOpen={() => onOpenSession(session.id)}
              onRename={() => onRenameSession(session)}
              onFork={() => onForkSession(session)}
              onDelete={() => onDeleteSession(session)}
              onPin={() => onPinSession(session)}
              onUnpin={() => onUnpinSession(session)}
              onArchive={() => onArchiveSession(session)}
              onUnarchive={() => onUnarchiveSession(session)}
            />
          {/each}
        </section>
      {/if}

      {#if navigation.activeSessions.length > 0}
        <section class="sidebar-section" aria-label="Active sessions">
          <p class="sidebar-section-label">Active</p>
          {#each navigation.activeSessions as session (session.id)}
            <SessionListItem
              active={session.id === activeSessionId}
              activeSurface={session.id === activeSessionId ? activeSurface : undefined}
              disabled={busy && session.id !== activeSessionId}
              paneLocations={paneLocationsBySessionId[session.id] ?? []}
              {session}
              onOpen={() => onOpenSession(session.id)}
              onRename={() => onRenameSession(session)}
              onFork={() => onForkSession(session)}
              onDelete={() => onDeleteSession(session)}
              onPin={() => onPinSession(session)}
              onUnpin={() => onUnpinSession(session)}
              onArchive={() => onArchiveSession(session)}
              onUnarchive={() => onUnarchiveSession(session)}
            />
          {/each}
        </section>
      {/if}

      {#if navigation.archived.sessions.length > 0}
        <section class="sidebar-section archived-section" aria-label="Archived sessions">
          <button
            class="archived-toggle"
            type="button"
            aria-expanded={!navigation.archived.collapsed}
            onclick={() => onToggleArchivedGroup(!navigation.archived.collapsed)}
          >
            {#if navigation.archived.collapsed}
              <ChevronRightIcon aria-hidden="true" size={14} strokeWidth={1.9} />
            {:else}
              <ChevronDownIcon aria-hidden="true" size={14} strokeWidth={1.9} />
            {/if}
            <span>Archived</span>
            <span>{navigation.archived.sessions.length}</span>
          </button>

          {#if !navigation.archived.collapsed}
            {#each navigation.archived.sessions as session (session.id)}
              <SessionListItem
                active={session.id === activeSessionId}
                activeSurface={session.id === activeSessionId ? activeSurface : undefined}
                disabled={busy && session.id !== activeSessionId}
                paneLocations={paneLocationsBySessionId[session.id] ?? []}
                {session}
                onOpen={() => onOpenSession(session.id)}
                onRename={() => onRenameSession(session)}
                onFork={() => onForkSession(session)}
                onDelete={() => onDeleteSession(session)}
                onPin={() => onPinSession(session)}
                onUnpin={() => onUnpinSession(session)}
                onArchive={() => onArchiveSession(session)}
                onUnarchive={() => onUnarchiveSession(session)}
              />
            {/each}
          {/if}
        </section>
      {/if}
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
    gap: 0.5rem;
  }

  .sidebar-section {
    display: grid;
    gap: 0.12rem;
  }

  .sidebar-section-label {
    margin: 0 0 0.08rem;
    padding-inline: 0.28rem;
    font-size: 0.6rem;
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ui-text-tertiary);
  }

  .archived-toggle {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.32rem;
    width: 100%;
    min-height: 1.72rem;
    padding: 0.28rem 0.36rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    font-size: 0.66rem;
    font-weight: 650;
    text-align: left;
    cursor: pointer;
  }

  .archived-toggle:hover {
    background: color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent);
    color: var(--ui-text-secondary);
  }

  .archived-toggle:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }
</style>
