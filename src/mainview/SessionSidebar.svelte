<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import BookOpenIcon from "@lucide/svelte/icons/book-open";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import FolderGit2Icon from "@lucide/svelte/icons/folder-git-2";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";
  import type { WorkspaceSessionNavigationReadModel, WorkspaceSessionSummary } from "../shared/workspace-contract";
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
    onCreateDumbSession: () => void;
    onOpenSession: (sessionId: string) => void;
    onFocusPane: (paneId: string) => void;
    onRenameSession: (session: WorkspaceSessionSummary) => void;
    onForkSession: (session: WorkspaceSessionSummary) => void;
    onDeleteSession: (session: WorkspaceSessionSummary) => void;
    onPinSession: (session: WorkspaceSessionSummary) => void;
    onUnpinSession: (session: WorkspaceSessionSummary) => void;
    onArchiveSession: (session: WorkspaceSessionSummary) => void;
    onUnarchiveSession: (session: WorkspaceSessionSummary) => void;
    onToggleArchivedGroup: (collapsed: boolean) => void;
    onOpenWorkflowLibrary?: () => void;
    onOpenSettings?: () => void;
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
    onCreateDumbSession,
    onOpenSession,
    onFocusPane,
    onRenameSession,
    onForkSession,
    onDeleteSession,
    onPinSession,
    onUnpinSession,
    onArchiveSession,
    onUnarchiveSession,
    onToggleArchivedGroup,
    onOpenWorkflowLibrary,
    onOpenSettings,
  }: Props = $props();

  let showNewSessionMenu = $state(false);

  const sessionCount = $derived(
    navigation.pinnedSessions.length +
      navigation.activeSessions.length +
      navigation.archived.sessions.length,
  );
  const allSessions = $derived([
    ...navigation.pinnedSessions,
    ...navigation.activeSessions,
    ...navigation.archived.sessions,
  ]);
  const episodeCount = $derived(
    allSessions.reduce((total, session) => total + (session.counts?.episodes ?? 0), 0),
  );
  const openSurfaceEntries = $derived.by(() =>
    Object.entries(paneLocationsBySessionId)
      .flatMap(([sessionId, locations]) => {
        const session = allSessions.find((item) => item.id === sessionId);
        return locations.map((location) => ({
          id: `${sessionId}:${location.paneId}`,
          sessionId,
          paneId: location.paneId,
          title: session?.title ?? sessionId,
          label: location.label,
          focused: location.focused,
        }));
      })
      .slice(0, 8),
  );

  function handleNewSessionMenuFocusOut(event: FocusEvent) {
    const current = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (current && next && current.contains(next)) {
      return;
    }
    showNewSessionMenu = false;
  }
</script>

<div class="session-sidebar">
  <header class="sidebar-header electrobun-webkit-app-region-drag">
    <div class="sidebar-header-copy">
      <div class="sidebar-brand-row">
        <span class="sidebar-brand">svvy</span>
        <span class="sidebar-workspace" title={workspaceLabel}>{workspaceLabel}</span>
      </div>
      <h2 class="sidebar-workspace-heading">{workspaceLabel}</h2>
      <p class="sidebar-context">
        {#if branch}
          <span class="branch-pill"><GitBranchIcon size={9} aria-hidden="true" /> {branch.split("/").at(-1) ?? branch}</span>
        {/if}
        <span>{sessionCount} sessions</span>
      </p>
    </div>
  </header>

  <div class="sidebar-actions" aria-label="Session actions">
    <div
      class="new-session-menu-shell"
      class:menu-open={showNewSessionMenu}
      role="group"
      aria-label="New session options"
      onmouseenter={() => (showNewSessionMenu = true)}
      onmouseleave={() => (showNewSessionMenu = false)}
      onfocusin={() => (showNewSessionMenu = true)}
      onfocusout={handleNewSessionMenuFocusOut}
    >
      <Button
        variant="primary"
        size="sm"
        class="new-session"
        onclick={onCreateSession}
        disabled={busy}
        aria-label="Create a new session"
        title="New Session"
        aria-haspopup="menu"
        aria-expanded={showNewSessionMenu}
      >
        <PlusIcon aria-hidden="true" size={13} strokeWidth={2} />
        <span>New session</span>
        <ChevronDownIcon aria-hidden="true" size={12} strokeWidth={1.9} />
      </Button>
      {#if showNewSessionMenu}
        <button
          type="button"
          class="new-session-menu-item"
          disabled={busy}
          onclick={() => {
            showNewSessionMenu = false;
            onCreateDumbSession();
          }}
        >
          New dumb session
        </button>
      {/if}
    </div>
  </div>

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

      {#if onOpenWorkflowLibrary}
        <section class="sidebar-section reference-nav-section" aria-label="Workflow library">
          <button class="reference-nav-row" type="button" onclick={onOpenWorkflowLibrary}>
            <WorkflowIcon size={13} aria-hidden="true" />
            <span>Saved workflows</span>
            <small>.svvy</small>
          </button>
        </section>
      {/if}

      <section class="sidebar-section reference-nav-section" aria-label="Episodes">
        <div class="reference-nav-row static">
          <BookOpenIcon size={13} aria-hidden="true" />
          <span>Episodes</span>
          <small>{episodeCount}</small>
        </div>
      </section>

      {#if openSurfaceEntries.length > 0}
        <section class="sidebar-section reference-nav-section" aria-label="Open surfaces">
          <p class="sidebar-section-label">Open surfaces</p>
          {#each openSurfaceEntries as surface (surface.id)}
            <button
              class={`open-surface-row ${surface.focused ? "focused" : ""}`.trim()}
              type="button"
              title={`${surface.title} ${surface.label}`}
              onclick={() => onFocusPane(surface.paneId)}
            >
              <span>{surface.title}</span>
              <small>{surface.label}</small>
            </button>
          {/each}
        </section>
      {/if}
    </div>
  </div>

  <footer class="sidebar-footer">
    <div class="workspace-path" title={workspaceLabel}>
      <FolderGit2Icon size={12} aria-hidden="true" />
      <span>{workspaceLabel}</span>
    </div>
    {#if onOpenSettings}
      <button
        class="sidebar-footer-button"
        type="button"
        title="Settings"
        aria-label="Open settings"
        onclick={onOpenSettings}
      >
        <SettingsIcon size={14} aria-hidden="true" />
      </button>
    {/if}
  </footer>
</div>

<style>
  .session-sidebar {
    display: flex;
    flex-direction: column;
    gap: 0;
    height: 100%;
    min-height: 0;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 2.25rem;
    padding: 0.45rem 0.72rem 0.45rem 3.6rem;
    border-bottom: 1px solid var(--ui-shell-edge);
  }

  .sidebar-header-copy,
  .sidebar-context,
  .sidebar-error {
    margin: 0;
  }

  .sidebar-header-copy {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .sidebar-brand-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .sidebar-brand {
    flex: 0 0 auto;
    color: var(--ui-accent);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0;
  }

  .sidebar-workspace {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-primary);
    font-size: 0.68rem;
    font-weight: 600;
  }

  .sidebar-workspace-heading {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  .sidebar-context {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 0.56rem;
    color: var(--ui-text-tertiary);
  }

  .branch-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.18rem;
    max-width: 8rem;
    min-height: 1rem;
    padding: 0 0.28rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-error {
    margin: 0.5rem 0.68rem 0;
    padding: 0.55rem 0.62rem;
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-danger-soft) 86%, transparent);
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
    font-size: 0.74rem;
    line-height: 1.5;
  }

  .sidebar-actions {
    display: grid;
    gap: 0.28rem;
    padding: 0.5rem 0.72rem;
    border-bottom: 1px solid var(--ui-shell-edge);
  }

  .new-session-menu-shell {
    position: relative;
    display: grid;
  }

  :global(button.new-session) {
    justify-content: flex-start;
    width: 100%;
    min-height: 1.76rem;
    padding-inline: 0.52rem;
    border-radius: var(--ui-radius-md);
    font-size: 0.68rem;
  }

  :global(button.new-session span) {
    flex: 1;
    text-align: left;
  }

  .new-session-menu-shell.menu-open :global(button.new-session) {
    border-bottom-right-radius: var(--ui-radius-xs);
    border-bottom-left-radius: var(--ui-radius-xs);
  }

  .new-session-menu-item {
    width: 100%;
    min-height: 1.54rem;
    padding: 0.28rem 0.52rem 0.28rem 1.62rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
    border-top: 0;
    border-radius: 0 0 var(--ui-radius-md) var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-panel) 72%, transparent);
    color: var(--ui-text-secondary);
    font-size: 0.64rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .new-session-menu-item:hover,
  .new-session-menu-item:focus-visible {
    outline: none;
    border-color: color-mix(in oklab, var(--ui-accent) 42%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-accent) 9%, var(--ui-panel));
    color: var(--ui-text-primary);
  }

  .new-session-menu-item:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .sidebar-sections {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.36rem 0.24rem 0.62rem;
  }

  .sidebar-list {
    display: grid;
    gap: 0.42rem;
  }

  .sidebar-section {
    display: grid;
    gap: 0.12rem;
  }

  .sidebar-section-label {
    margin: 0.38rem 0 0.12rem;
    padding-inline: 0.72rem;
    font-size: 0.56rem;
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
    min-height: 1.5rem;
    padding: 0.28rem 0.36rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    font-size: 0.6rem;
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

  .reference-nav-section {
    margin-top: 0.28rem;
    padding-top: 0.18rem;
  }

  .reference-nav-row,
  .open-surface-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.38rem;
    width: 100%;
    min-height: 1.65rem;
    padding: 0.24rem 0.72rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-secondary);
    text-align: left;
    cursor: pointer;
  }

  .reference-nav-row.static {
    cursor: default;
  }

  .reference-nav-row:hover:not(.static),
  .open-surface-row:hover,
  .open-surface-row.focused {
    border-color: color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 66%, transparent);
    color: var(--ui-text-primary);
  }

  .reference-nav-row span,
  .open-surface-row span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.62rem;
    font-weight: 500;
  }

  .reference-nav-row small,
  .open-surface-row small {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.52rem;
  }

  .open-surface-row {
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 1.5rem;
    padding-left: 0.72rem;
  }

  .open-surface-row.focused {
    box-shadow: inset 2px 0 0 var(--ui-accent);
  }

  .sidebar-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.42rem;
    min-height: 2rem;
    padding: 0.34rem 0.42rem 0.34rem 0.6rem;
    border-top: 1px solid var(--ui-shell-edge);
    color: var(--ui-text-tertiary);
  }

  .workspace-path {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 0.56rem;
  }

  .workspace-path span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-footer-button {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    width: 1.45rem;
    height: 1.45rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .sidebar-footer-button:hover,
  .sidebar-footer-button:focus-visible {
    outline: none;
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }
</style>
