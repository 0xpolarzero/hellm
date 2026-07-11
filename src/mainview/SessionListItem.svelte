<script lang="ts">
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import PinIcon from "@lucide/svelte/icons/pin";
  import PinOffIcon from "@lucide/svelte/icons/pin-off";
  import type { ContextBudget } from "./context-budget";
  import type { WorkspaceSessionSummary } from "../shared/workspace-contract";
  import ContextBudgetBar from "./ContextBudgetBar.svelte";
  import {
    formatCompactRelativeSessionTime,
    getSessionSidebarSubtitle,
    shouldShowSessionUpdatedAt,
  } from "./session-format";
  import Tooltip from "./ui/Tooltip.svelte";

  type SidebarPaneTone = "neutral" | "waiting" | "error";

  type SidebarPaneLocation = {
    paneId: string;
    label: string;
    focused: boolean;
    tone: SidebarPaneTone;
    contextBudget: ContextBudget | null;
  };

  type Props = {
    session: WorkspaceSessionSummary;
    active: boolean;
    paneLocations?: SidebarPaneLocation[];
    relativeTimeNow?: number;
    disabled?: boolean;
    onOpen: (event: MouseEvent) => void;
    onRename: () => void;
    onPin: () => void;
    onUnpin: () => void;
    onArchive: () => void;
    onUnarchive: () => void;
    onContextMenu?: (event: MouseEvent | KeyboardEvent) => void;
    onArrowUp?: () => void;
    onArrowDown?: () => void;
  };

  let {
    session,
    active,
    paneLocations = [],
    relativeTimeNow = Date.now(),
    disabled = false,
    onOpen,
    onRename,
    onPin,
    onUnpin,
    onArchive,
    onUnarchive,
    onContextMenu,
    onArrowUp,
    onArrowDown,
  }: Props = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      onContextMenu?.(event);
      return;
    }

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

  const renameLocked = $derived(session.titleGeneration?.renameLocked ?? false);
  const focusedPaneLocation = $derived(paneLocations.find((location) => location.focused) ?? null);
  const primaryPaneLocation = $derived(focusedPaneLocation ?? paneLocations[0] ?? null);
  const paneTone = $derived(
    paneLocations.find((location) => location.tone === "error")?.tone ??
      paneLocations.find((location) => location.tone === "waiting")?.tone ??
      "neutral",
  );
  const contextBudget = $derived(primaryPaneLocation?.contextBudget ?? null);
  const hasPane = $derived(paneLocations.length > 0);
  const isWorking = $derived(session.status === "running");
  const showUpdatedAt = $derived(shouldShowSessionUpdatedAt(session));
  const sidebarSubtitle = $derived(getSessionSidebarSubtitle(session));
  const updatedAtLabel = $derived.by(() => {
    void relativeTimeNow;
    return formatCompactRelativeSessionTime(session.updatedAt);
  });
</script>

<article
  class={`session-item ${active ? "active" : ""} ${session.isArchived ? "archived" : ""} ${session.isUnread ? "unread" : ""} ${hasPane ? "open-in-pane" : ""} ${focusedPaneLocation ? "focused-in-pane" : ""} open-tone-${paneTone} ${isWorking ? "working" : ""}`.trim()}
>
  <Tooltip
    label="Session open behavior"
    side="right"
    block
    delayMs={2000}
    details={[
      { icon: "mouse-left", label: "Replace focused pane" },
      { shortcut: "⌘", icon: "mouse-left", label: "Open in a new pane" },
    ]}
  >
    <button
      class="session-main"
      type="button"
      aria-current={active ? "true" : undefined}
      aria-label={`${session.isUnread ? "Unread session: " : ""}${session.title}`}
      disabled={disabled}
      onclick={(event) => onOpen(event)}
      ondblclick={onRename}
      oncontextmenu={(event) => {
        event.preventDefault();
        onContextMenu?.(event);
      }}
      onkeydown={handleKeydown}
    >
      <div class="session-main-top">
        <strong>{session.title}</strong>
        <div class="session-main-top-meta">
          {#if primaryPaneLocation}
            <span
              class="session-pane-location"
              data-focused={primaryPaneLocation.focused ? "true" : "false"}
              title={primaryPaneLocation.focused ? `Focused pane: ${primaryPaneLocation.label}` : `Open pane: ${primaryPaneLocation.label}`}
            >
              {primaryPaneLocation.label}
            </span>
          {/if}
          {#if session.isUnread}
            <span class="session-unread-dot" aria-hidden="true"></span>
          {:else if isWorking}
            <span class="session-unread-dot session-working-dot" aria-hidden="true"></span>
          {:else if showUpdatedAt}
            <span>{updatedAtLabel}</span>
          {/if}
        </div>
      </div>
      <div class="session-main-body">
        {#if sidebarSubtitle}
          <div
            class={`session-main-subtitle tone-${sidebarSubtitle.tone} ${sidebarSubtitle.badge ? "" : "text-only"} ${sidebarSubtitle.blinking ? "blinking" : ""}`.trim()}
          >
            {#if sidebarSubtitle.badge}
              <span>{sidebarSubtitle.badge}</span>
            {/if}
            <span>{sidebarSubtitle.text}</span>
          </div>
        {/if}
      </div>

      {#if contextBudget}
        <div class="session-context-budget" aria-hidden="true">
          <ContextBudgetBar budget={contextBudget} variant="compact" label="Context" showTooltip={false} />
        </div>
      {/if}
    </button>
  </Tooltip>

  <div class="session-inline-actions" role="toolbar" aria-label={`Actions for ${session.title}`}>
    <Tooltip label={session.isArchived ? "Unarchive session" : "Archive session"}>
      <button
        class="session-inline-action"
        type="button"
        aria-label={session.isArchived ? `Unarchive ${session.title}` : `Archive ${session.title}`}
        onclick={(event) => {
          event.stopPropagation();
          if (session.isArchived) {
            onUnarchive();
          } else {
            onArchive();
          }
        }}
      >
        {#if session.isArchived}
          <ArchiveRestoreIcon aria-hidden="true" size={13} strokeWidth={1.9} />
        {:else}
          <ArchiveIcon aria-hidden="true" size={13} strokeWidth={1.9} />
        {/if}
      </button>
    </Tooltip>

    <Tooltip label={session.isPinned ? "Unpin session" : "Pin session"}>
      <button
        class="session-inline-action"
        type="button"
        aria-label={session.isPinned ? `Unpin ${session.title}` : `Pin ${session.title}`}
        onclick={(event) => {
          event.stopPropagation();
          if (session.isPinned) {
            onUnpin();
          } else {
            onPin();
          }
        }}
      >
        {#if session.isPinned}
          <PinOffIcon aria-hidden="true" size={13} strokeWidth={1.9} />
        {:else}
          <PinIcon aria-hidden="true" size={13} strokeWidth={1.9} />
        {/if}
      </button>
    </Tooltip>
  </div>
</article>

<style>
  .session-item {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    border-radius: var(--ui-radius-md);
  }

  .session-main {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 0.42rem 0.58rem 0.44rem 0.9rem;
    overflow: hidden;
    border-radius: var(--ui-radius-md);
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
    top: 0;
    bottom: 0;
    left: 0;
    width: 0.16rem;
    border-radius: var(--ui-radius-md) 0 0 var(--ui-radius-md);
    background: transparent;
    transition: background-color 160ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .session-main:hover:not(:disabled) {
    background: var(--ui-hover-bg);
  }

  .session-main:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .session-main:disabled {
    opacity: 0.62;
    cursor: default;
  }

  .active .session-main {
    background: var(--ui-selected-bg);
  }

  .active .session-main::before {
    background: color-mix(in oklab, var(--ui-accent) 84%, transparent);
  }

  .open-in-pane:not(.active) .session-main {
    background: color-mix(in oklab, var(--ui-hover-bg) 48%, transparent);
  }

  .open-in-pane:not(.active) .session-main::before {
    background: color-mix(in oklab, var(--ui-text-tertiary) 42%, transparent);
  }

  .focused-in-pane .session-main {
    border-color: color-mix(in oklab, var(--ui-accent) 36%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ui-accent) 20%, transparent);
  }

  .focused-in-pane .session-main::before {
    background: color-mix(in oklab, var(--ui-accent) 70%, transparent);
  }

  .open-tone-waiting:not(.active) .session-main {
    background: color-mix(in oklab, var(--ui-status-waiting-soft) 28%, transparent);
  }

  .open-tone-waiting:not(.active) .session-main::before {
    background: color-mix(in oklab, var(--ui-status-waiting) 54%, transparent);
  }

  .open-tone-error:not(.active) .session-main {
    background: color-mix(in oklab, var(--ui-danger-soft) 30%, transparent);
  }

  .open-tone-error:not(.active) .session-main::before {
    background: color-mix(in oklab, var(--ui-danger) 56%, transparent);
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
    font-size: var(--text-sm);
    line-height: 1.25;
    font-weight: var(--vscode-font-weight);
    letter-spacing: 0;
  }

  .session-main-top-meta {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.28rem;
    flex-shrink: 0;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.25;
    color: var(--ui-text-tertiary);
    transition:
      opacity 120ms cubic-bezier(0.19, 1, 0.22, 1),
      visibility 120ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .session-item:hover .session-main-top-meta,
  .session-item:focus-within .session-main-top-meta {
    opacity: 0;
    visibility: hidden;
  }

  .session-main-top-meta span {
    flex-shrink: 0;
  }

  .session-pane-location {
    max-width: 5.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 0.28rem;
    padding: 0 0.28rem;
    background: color-mix(in oklab, var(--ui-text-tertiary) 10%, transparent);
    color: var(--ui-text-tertiary);
  }

  .session-pane-location[data-focused="true"] {
    background: color-mix(in oklab, var(--ui-accent) 16%, transparent);
    color: color-mix(in oklab, var(--ui-accent) 84%, var(--ui-text-primary));
  }

  .session-main-top-meta :global(svg) {
    color: var(--ui-text-tertiary);
  }

  .session-unread-dot {
    width: 0.46rem;
    height: 0.46rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-accent) 88%, var(--ui-text-primary));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--ui-accent) 16%, transparent);
  }

  .session-working-dot {
    background: color-mix(in oklab, var(--ui-text-tertiary) 86%, var(--ui-surface));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--ui-text-tertiary) 14%, transparent);
    animation: session-working-dot-blink 1.4s ease-in-out infinite;
  }

  .session-main-body {
    display: grid;
    gap: 0.16rem;
    margin-top: 0.18rem;
    min-width: 0;
  }

  .session-main-subtitle {
    min-width: 0;
    overflow: hidden;
    display: flex;
    align-items: baseline;
    gap: 0.28rem;
    font-size: var(--text-xs);
    line-height: 1.25;
    color: var(--ui-text-secondary);
  }

  .session-main-subtitle span:first-child {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .session-main-subtitle span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-main-subtitle.tone-waiting {
    color: var(--ui-status-waiting);
  }

  .session-main-subtitle.tone-error {
    color: var(--ui-danger);
  }

  .session-main-subtitle.text-only {
    color: var(--ui-text-tertiary);
  }

  .blinking {
    animation: session-working-blink 1.8s ease-in-out infinite;
  }

  .session-context-budget {
    margin-top: 0.28rem;
    padding-bottom: 0.02rem;
  }

  .session-context-budget :global(.context-budget-compact) {
    position: static;
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
  }

  .session-context-budget :global(.context-budget-compact-label) {
    display: none;
  }

  @keyframes session-working-blink {
    0%,
    100% {
      opacity: 0.38;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes session-working-dot-blink {
    0%,
    100% {
      opacity: 0.32;
      transform: scale(0.86);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .session-inline-actions {
    position: absolute;
    top: 0.4rem;
    right: 0.42rem;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 0.08rem;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-0.06rem);
    transition:
      opacity 140ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 140ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .session-item:hover .session-inline-actions,
  .session-item:focus-within .session-inline-actions {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  .session-inline-action {
    display: inline-grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border: 0;
    color: var(--ui-text-tertiary);
    background: transparent;
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    line-height: 1;
    transition:
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .session-inline-action:hover,
  .session-inline-action:focus-visible {
    outline: none;
    background: color-mix(in oklab, var(--ui-surface-subtle) 88%, transparent);
    color: var(--ui-text-primary);
  }

  .session-inline-action:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  @media (prefers-reduced-motion: reduce) {
    .blinking,
    .session-working-dot {
      animation: none;
    }
  }
</style>
