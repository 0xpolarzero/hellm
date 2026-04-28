<script lang="ts">
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import type { WorkspaceSessionSummary } from "../shared/workspace-contract";
  import { formatRelativeSessionTime, formatSessionStatusLabel } from "./session-format";
  import Button from "./ui/Button.svelte";

  type Props = {
    session: WorkspaceSessionSummary;
    active: boolean;
    activeSurface?: "orchestrator" | "thread";
    paneLocations?: { paneId: string; label: string; focused: boolean }[];
    disabled?: boolean;
    onOpen: () => void;
    onRename: () => void;
    onFork: () => void;
    onDelete: () => void;
    onPin: () => void;
    onUnpin: () => void;
    onArchive: () => void;
    onUnarchive: () => void;
    onArrowUp?: () => void;
    onArrowDown?: () => void;
  };

  let {
    session,
    active,
    activeSurface,
    paneLocations = [],
    disabled = false,
    onOpen,
    onRename,
    onFork,
    onDelete,
    onPin,
    onUnpin,
    onArchive,
    onUnarchive,
    onArrowUp,
    onArrowDown,
  }: Props = $props();

  let menuOpen = $state(false);
  let menuRoot = $state<HTMLDivElement | null>(null);

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onArrowUp?.();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onArrowDown?.();
    }
  }

  function closeIfFocusLeaves(nextTarget: EventTarget | null) {
    if (!(nextTarget instanceof Node) || !menuRoot?.contains(nextTarget)) {
      menuOpen = false;
    }
  }

  function getProgressLabels(currentSession: WorkspaceSessionSummary): string[] {
    const labels: string[] = [];
    const counts = currentSession.counts;
    const threadIdsByStatus = currentSession.threadIdsByStatus;

    if (counts) {
      if (counts.workflows > 0) {
        labels.push(`Workflow ${counts.workflows}`);
      }

      if (counts.ciRuns > 0) {
        labels.push(`CI ${counts.ciRuns}`);
      }

      if (counts.threads > 0) {
        labels.push(`Threads ${counts.threads}`);
      }
    }

    if (threadIdsByStatus?.runningHandler.length) {
      labels.push(`Handlers ${threadIdsByStatus.runningHandler.length}`);
    }

    if (threadIdsByStatus?.runningWorkflow.length) {
      labels.push(`Workflows ${threadIdsByStatus.runningWorkflow.length}`);
    }

    if (threadIdsByStatus?.waiting.length) {
      labels.push(
        currentSession.status === "running"
          ? `Blocked ${threadIdsByStatus.waiting.length}`
          : `Waiting ${threadIdsByStatus.waiting.length}`,
      );
    }

    if (threadIdsByStatus?.troubleshooting.length) {
      labels.push(`Troubleshooting ${threadIdsByStatus.troubleshooting.length}`);
    }

    return labels;
  }

  const showingThreadSurface = $derived(active && activeSurface === "thread");
</script>

<article
  class={`session-item ${active ? "active" : ""} ${showingThreadSurface ? "active-thread" : ""} ${session.isArchived ? "archived" : ""} ${menuOpen ? "menu-open" : ""}`.trim()}
>
  <button
    class="session-main"
    type="button"
    aria-current={active ? "true" : undefined}
    disabled={disabled}
    onclick={onOpen}
    onkeydown={handleKeydown}
    title={session.title}
  >
    <div class="session-main-top">
      <strong>{session.title}</strong>
      <span>{formatRelativeSessionTime(session.updatedAt)}</span>
    </div>
    <div class="session-main-body">
      <div class="session-main-preview">{session.preview}</div>
      {#if getProgressLabels(session).length > 0}
        <div class="session-main-progress" aria-label="Structured workflow progress">
          {#each getProgressLabels(session) as label}
            <span class="session-progress-pill">{label}</span>
          {/each}
        </div>
      {/if}
    </div>

    {#if showingThreadSurface || session.status !== "idle" || session.parentSessionId || paneLocations.length > 0}
      <div class="session-main-meta">
        {#if showingThreadSurface}
          <span class="session-surface">Thread Open</span>
        {/if}
        {#if paneLocations.length > 0}
          <span class="session-surface" title={`Open in ${paneLocations.map((location) => location.label).join(", ")}`}>
            {paneLocations.length === 1
              ? `Open ${paneLocations[0]?.label ?? ""}`.trim()
              : `Open ${paneLocations.length} panes`}
          </span>
        {/if}
        {#if session.status !== "idle"}
          <span class={`session-status status-${session.status}`.trim()}>
            <span class="session-status-dot"></span>
            {formatSessionStatusLabel(session)}
          </span>
        {/if}
        {#if session.parentSessionId}
          <span class="session-branch">Fork</span>
        {/if}
      </div>
    {/if}

    {#if session.isPinned || session.isArchived}
      <div class="session-main-meta session-navigation-meta">
        {#if session.isPinned}
          <span class="session-branch">Pinned</span>
        {/if}
        {#if session.isArchived}
          <span class="session-branch">Archived</span>
        {/if}
      </div>
    {/if}
  </button>

  <div
    bind:this={menuRoot}
    class="session-menu-wrap"
    onfocusout={(event) => closeIfFocusLeaves(event.relatedTarget)}
  >
    <Button
      variant="ghost"
      size="sm"
      class="session-menu-trigger"
      aria-label={`Session actions for ${session.title}`}
      onclick={(event) => {
        event.stopPropagation();
        menuOpen = !menuOpen;
      }}
    >
      <EllipsisVerticalIcon aria-hidden="true" size={15} strokeWidth={1.9} />
    </Button>

    {#if menuOpen}
      <div class="session-menu">
        {#if session.isArchived}
          <button type="button" onclick={() => { menuOpen = false; onUnarchive(); }}>Unarchive</button>
        {:else}
          {#if session.isPinned}
            <button type="button" onclick={() => { menuOpen = false; onUnpin(); }}>Unpin</button>
          {:else}
            <button type="button" onclick={() => { menuOpen = false; onPin(); }}>Pin</button>
          {/if}
          <button type="button" onclick={() => { menuOpen = false; onArchive(); }}>Archive</button>
        {/if}
        <button type="button" onclick={() => { menuOpen = false; onRename(); }}>Rename</button>
        <button type="button" onclick={() => { menuOpen = false; onFork(); }}>Fork</button>
        <button class="danger" type="button" onclick={() => { menuOpen = false; onDelete(); }}>Delete</button>
      </div>
    {/if}
  </div>
</article>

<style>
  .session-item {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.25rem;
    align-items: center;
    border-radius: calc(var(--ui-radius-lg) + 0.12rem);
  }

  .session-main {
    position: relative;
    width: 100%;
    min-width: 0;
    padding: 0.64rem 0.72rem 0.7rem 0.92rem;
    border-radius: calc(var(--ui-radius-md) + 0.16rem);
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
      box-shadow 160ms cubic-bezier(0.19, 1, 0.22, 1),
      color 160ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .session-main::before {
    content: "";
    position: absolute;
    top: 0.5rem;
    bottom: 0.5rem;
    left: 0.28rem;
    width: 0.14rem;
    border-radius: 999px;
    background: transparent;
    transition: background-color 160ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .session-main:hover:not(:disabled) {
    background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
  }

  .session-main:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .session-main:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  .active .session-main {
    border-color: color-mix(in oklab, var(--ui-border-accent) 72%, transparent);
    background:
      linear-gradient(180deg, color-mix(in oklab, var(--ui-accent-soft) 52%, transparent), transparent),
      color-mix(in oklab, var(--ui-surface-subtle) 86%, transparent);
  }

  .active .session-main::before {
    background: color-mix(in oklab, var(--ui-accent) 84%, transparent);
  }

  .active-thread .session-main {
    border-style: dashed;
  }

  .archived .session-main {
    opacity: 0.74;
  }

  .session-main-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .session-main-top strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.76rem;
    font-weight: 640;
    letter-spacing: -0.02em;
  }

  .session-main-top span {
    flex-shrink: 0;
    font-size: 0.62rem;
    color: var(--ui-text-tertiary);
  }

  .session-main-body {
    display: grid;
    gap: 0.24rem;
    margin-top: 0.32rem;
    min-width: 0;
  }

  .session-main-preview {
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    font-size: 0.68rem;
    line-height: 1.35;
    color: var(--ui-text-secondary);
  }

  .session-main-progress {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.28rem;
  }

  .session-progress-pill {
    display: inline-flex;
    align-items: center;
    min-height: 1rem;
    padding: 0.14rem 0.38rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
    color: var(--ui-text-tertiary);
    font-size: 0.56rem;
    font-weight: 620;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .session-main-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.34rem;
  }

  .session-navigation-meta {
    margin-top: 0.24rem;
  }

  .session-status,
  .session-branch,
  .session-surface {
    display: inline-flex;
    align-items: center;
    gap: 0.26rem;
    min-height: 0.9rem;
    font-size: 0.61rem;
    font-weight: 620;
    letter-spacing: 0.02em;
    line-height: 1;
    white-space: nowrap;
    color: var(--ui-text-tertiary);
  }

  .session-status-dot {
    width: 0.34rem;
    height: 0.34rem;
    border-radius: 999px;
    background: currentColor;
  }

  .status-running {
    color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
  }

  .status-waiting {
    color: color-mix(in oklab, var(--ui-info) 78%, var(--ui-text-primary));
  }

  .status-error {
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
  }

  .session-branch {
    color: var(--ui-text-tertiary);
  }

  .session-surface {
    padding-inline: 0.36rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-accent-soft) 72%, transparent);
    color: color-mix(in oklab, var(--ui-accent) 80%, var(--ui-text-primary));
    text-transform: uppercase;
  }

  .session-menu-wrap {
    position: relative;
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .session-item:hover .session-menu-wrap,
  .session-item:focus-within .session-menu-wrap,
  .session-item.menu-open .session-menu-wrap {
    opacity: 1;
    pointer-events: auto;
  }

  .session-menu-trigger {
    min-width: 1.85rem;
    padding-inline: 0.38rem;
  }

  .session-menu {
    position: absolute;
    top: calc(100% + 0.25rem);
    right: 0;
    z-index: var(--ui-z-overlay);
    display: grid;
    gap: 0.2rem;
    min-width: 8rem;
    padding: 0.32rem;
    border-radius: var(--ui-radius-md);
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
    background: var(--ui-surface-raised);
    box-shadow: var(--ui-shadow-strong);
  }

  .session-menu button {
    padding: 0.42rem 0.52rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-primary);
    text-align: left;
    cursor: pointer;
  }

  .session-menu button:hover {
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
  }

  .session-menu .danger {
    color: color-mix(in oklab, var(--ui-danger) 86%, var(--ui-text-primary));
  }

  @media (max-width: 760px) {
    .session-menu-wrap {
      opacity: 1;
      pointer-events: auto;
    }
  }
</style>
