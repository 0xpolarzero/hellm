<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import CommandIcon from "@lucide/svelte/icons/command";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import LogsIcon from "@lucide/svelte/icons/logs";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";
  import BotIcon from "@lucide/svelte/icons/bot";
  import BoxesIcon from "@lucide/svelte/icons/boxes";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import FolderGit2Icon from "@lucide/svelte/icons/folder-git-2";
  import type { ContextBudget } from "./context-budget";
  import type { AgentProfileSettings } from "../shared/agent-settings";
  import { getShortcutCompact, getShortcutReadable } from "../shared/shortcut-registry";
  import type {
    AppLogSummary,
    WorkspaceBranchInfo,
    WorkspaceCommandRollup,
    WorkspaceSessionNavigationReadModel,
    WorkspaceSessionNavigationSectionId,
    WorkspaceSessionSummary,
    WorkspaceSidebarHandlerThreadRow,
    WorkspaceSidebarRowSubtitle,
    WorkspaceSidebarWorkflowRow,
  } from "../shared/workspace-contract";
  import {
    formatAppLogCount,
    formatAppLogUnreadTitle,
    getVisibleAppLogUnreadBadges,
  } from "./app-logs";
  import SessionListItem from "./SessionListItem.svelte";
  import ContextBudgetBar from "./ContextBudgetBar.svelte";
  import Kbd from "./ui/Kbd.svelte";
  import Tooltip from "./ui/Tooltip.svelte";
  import CompactCombobox, { type CompactComboboxOption } from "./ui/CompactCombobox.svelte";
  import ContextMenu, { type ContextMenuItem } from "./ui/ContextMenu.svelte";

  const NEW_SESSION_MENU_CLOSE_DELAY_MS = 500;

  type SidebarPaneLocation = {
    paneId: string;
    panelId?: string;
    label: string;
    focused: boolean;
    tone: "neutral" | "waiting" | "error";
    contextBudget: ContextBudget | null;
  };

  type Props = {
    workspaceLabel: string;
    workspaceBranch?: string;
    navigation: WorkspaceSessionNavigationReadModel;
    activeSessionId?: string;
    activeOrchestratorSessionId?: string;
    activeThreadId?: string;
    paneLocationsBySessionId?: Record<string, SidebarPaneLocation[]>;
    paneLocationsByThreadId?: Record<string, SidebarPaneLocation[]>;
    paneLocationsByWorkflowRunId?: Record<string, SidebarPaneLocation[]>;
    orchestratorProfiles?: AgentProfileSettings[];
    appLogSummary?: AppLogSummary | null;
    busy?: boolean;
    errorMessage?: string;
    onCreateSession: (event?: MouseEvent, agentProfileId?: string) => void;
    onOpenSession: (sessionId: string, event: MouseEvent) => void;
    onOpenHandlerThread?: (
      sessionId: string,
      thread: WorkspaceSidebarHandlerThreadRow,
      event: MouseEvent,
    ) => void;
    onOpenWorkflowRun?: (
      sessionId: string,
      workflow: WorkspaceSidebarWorkflowRow,
      event: MouseEvent,
    ) => void;
    onRenameSession: (session: WorkspaceSessionSummary) => void;
    onPinSession: (session: WorkspaceSessionSummary) => void;
    onUnpinSession: (session: WorkspaceSessionSummary) => void;
    onArchiveSession: (session: WorkspaceSessionSummary) => void;
    onUnarchiveSession: (session: WorkspaceSessionSummary) => void;
    onDeleteSession: (session: WorkspaceSessionSummary) => void;
    onMarkSessionUnread: (session: WorkspaceSessionSummary) => void;
    onMarkSessionRead: (session: WorkspaceSessionSummary) => void;
    onToggleArchivedGroup: (collapsed: boolean) => void;
    onUpdateSessionNavigationSectionState: (
      section: WorkspaceSessionNavigationSectionId,
      state: { collapsed?: boolean; sizePx?: number },
    ) => void | Promise<void>;
    onOpenSearch?: () => void;
    onOpenCommandPalette?: () => void;
    onOpenWorkflowLibrary?: (event?: MouseEvent) => void;
    onOpenAgents?: (event?: MouseEvent) => void;
    onOpenExtensions?: (event?: MouseEvent) => void;
    onOpenSnippets?: (event?: MouseEvent) => void;
    onOpenAppLogs?: (event?: MouseEvent) => void;
    onOpenSettings?: () => void;
    onListWorkspaceBranches?: () => Promise<WorkspaceBranchInfo[]>;
    onSwitchWorkspaceBranch?: (branch: string) => Promise<void>;
  };

  let {
    workspaceLabel,
    workspaceBranch,
    navigation,
    activeSessionId,
    activeOrchestratorSessionId,
    activeThreadId,
    paneLocationsBySessionId = {},
    paneLocationsByThreadId = {},
    paneLocationsByWorkflowRunId = {},
    orchestratorProfiles = [],
    appLogSummary = null,
    busy = false,
    errorMessage,
    onCreateSession,
    onOpenSession,
    onOpenHandlerThread,
    onOpenWorkflowRun,
    onRenameSession,
    onPinSession,
    onUnpinSession,
    onArchiveSession,
    onUnarchiveSession,
    onDeleteSession,
    onMarkSessionUnread,
    onMarkSessionRead,
    onToggleArchivedGroup,
    onUpdateSessionNavigationSectionState,
    onOpenSearch,
    onOpenCommandPalette,
    onOpenWorkflowLibrary,
    onOpenAgents,
    onOpenExtensions,
    onOpenSnippets,
    onOpenAppLogs,
    onOpenSettings,
    onListWorkspaceBranches,
    onSwitchWorkspaceBranch,
  }: Props = $props();

  const footerWorkspaceLabel = $derived(workspaceBranch ?? workspaceLabel);
  const footerShowsBranch = $derived(Boolean(workspaceBranch));
  const branchControlEnabled = $derived(
    footerShowsBranch && Boolean(onListWorkspaceBranches && onSwitchWorkspaceBranch),
  );
  const branchSelectOptions = $derived.by<CompactComboboxOption[]>(() => {
    if (branchMenuError) return [{ value: "__error", label: branchMenuError, disabled: true }];
    if (branchOptions.length === 0) {
      return [{ value: "__empty", label: "No local branches found.", disabled: true }];
    }
    return branchOptions.map((branch) => ({ value: branch.name, label: branch.name }));
  });

  let showNewSessionMenu = $state(false);
  let shortcutAction = $state<string | null>(null);
  let relativeTimeNow = $state(Date.now());
  let branchMenuOpen = $state(false);
  let branchMenuLoading = $state(false);
  let branchMenuError = $state<string | null>(null);
  let branchOptions = $state<WorkspaceBranchInfo[]>([]);
  let primaryActionsElement = $state<HTMLElement | null>(null);
  let sessionContextMenu = $state<{
    session: WorkspaceSessionSummary;
    x: number;
    y: number;
  } | null>(null);
  let confirmingDeleteSessionId = $state<string | null>(null);
  let sessionContextMenuElement = $state<ContextMenu | null>(null);
  let relativeTimeTimeout: ReturnType<typeof window.setTimeout> | null = null;
  let relativeTimeInterval: ReturnType<typeof window.setInterval> | null = null;
  let newSessionMenuCloseTimeout: ReturnType<typeof window.setTimeout> | null = null;
  let resizingSessionSections = $state<{
    from: WorkspaceSessionNavigationSectionId;
    to: WorkspaceSessionNavigationSectionId;
    startY: number;
    fromStartSize: number;
    toStartSize: number;
    sizes: Record<WorkspaceSessionNavigationSectionId, number>;
  } | null>(null);
  let committedResizePreview = $state<Partial<Record<WorkspaceSessionNavigationSectionId, number>>>(
    {},
  );
  const newSessionDisplayShortcut = getShortcutCompact("session.new");
  const newSessionReadableShortcut = getShortcutReadable("session.new");
  const newSessionInNewPaneReadableShortcut = getShortcutReadable("session.newPane");
  const quickOpenDisplayShortcut = getShortcutCompact("quickOpen.open");
  const commandPaletteDisplayShortcut = getShortcutCompact("commandPalette.open");
  const appLogsDisplayShortcut = getShortcutCompact("surface.logs.open");
  const workflowsDisplayShortcut = getShortcutCompact("surface.workflows.open");
  const agentsDisplayShortcut = getShortcutCompact("surface.agents.open");
  const extensionsDisplayShortcut = getShortcutCompact("surface.extensions.open");
  const paneOpenTooltipDetails: { label: string; shortcut?: string; icon: "mouse-left" }[] = [
    { icon: "mouse-left", label: "Replace focused pane" },
    { shortcut: "⌘", icon: "mouse-left", label: "Open in a new pane" },
  ];

  $effect(() => {
    function updateRelativeTimeNow() {
      relativeTimeNow = Date.now();
    }

    const msUntilNextMinute = 60000 - (Date.now() % 60000);
    relativeTimeTimeout = window.setTimeout(() => {
      updateRelativeTimeNow();
      relativeTimeInterval = window.setInterval(updateRelativeTimeNow, 60000);
    }, msUntilNextMinute);

    return () => {
      if (relativeTimeTimeout) {
        window.clearTimeout(relativeTimeTimeout);
        relativeTimeTimeout = null;
      }
      if (relativeTimeInterval) {
        window.clearInterval(relativeTimeInterval);
        relativeTimeInterval = null;
      }
    };
  });

  $effect(() => {
    return () => {
      cancelNewSessionMenuClose();
    };
  });

  function cancelNewSessionMenuClose() {
    if (!newSessionMenuCloseTimeout) return;
    window.clearTimeout(newSessionMenuCloseTimeout);
    newSessionMenuCloseTimeout = null;
  }

  function openNewSessionMenu() {
    cancelNewSessionMenuClose();
    showNewSessionMenu = true;
  }

  function closeNewSessionMenu() {
    cancelNewSessionMenuClose();
    showNewSessionMenu = false;
  }

  function scheduleNewSessionMenuClose() {
    cancelNewSessionMenuClose();
    newSessionMenuCloseTimeout = window.setTimeout(() => {
      showNewSessionMenu = false;
      newSessionMenuCloseTimeout = null;
    }, NEW_SESSION_MENU_CLOSE_DELAY_MS);
  }

  function handlePrimaryActionsPointerLeave() {
    scheduleNewSessionMenuClose();
  }

  function handleNewSessionMenuPointerLeave(event: MouseEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && primaryActionsElement?.contains(next)) {
      return;
    }
    scheduleNewSessionMenuClose();
  }

  function handleNewSessionMenuFocusOut(event: FocusEvent) {
    const current = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (current && next && current.contains(next)) {
      return;
    }
    if (next && primaryActionsElement?.contains(next)) {
      return;
    }
    scheduleNewSessionMenuClose();
  }

  function handlePrimaryActionsFocusOut(event: FocusEvent) {
    const current = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (current && next && current.contains(next)) {
      return;
    }
    scheduleNewSessionMenuClose();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeNewSessionMenu();
      shortcutAction = null;
      sessionContextMenu = null;
      confirmingDeleteSessionId = null;
    }
  }

  function handleWindowPointerDown(event: PointerEvent) {
    const target = event.target as Node | null;
    if (sessionContextMenuElement?.contains(target)) {
      return;
    }
    closeSessionContextMenu();
  }

  function handleWindowPointerMove(event: PointerEvent) {
    if (!resizingSessionSections) return;
    const delta = event.clientY - resizingSessionSections.startY;
    const maxGrow = resizingSessionSections.toStartSize - MIN_SESSION_SECTION_SIZE_PX;
    const maxShrink = resizingSessionSections.fromStartSize - MIN_SESSION_SECTION_SIZE_PX;
    const clampedDelta = Math.max(-maxShrink, Math.min(delta, maxGrow));
    resizingSessionSections = {
      ...resizingSessionSections,
      sizes: {
        ...resizingSessionSections.sizes,
        [resizingSessionSections.from]: Math.round(
          resizingSessionSections.fromStartSize + clampedDelta,
        ),
        [resizingSessionSections.to]: Math.round(
          resizingSessionSections.toStartSize - clampedDelta,
        ),
      },
    };
  }

  async function handleWindowPointerUp() {
    if (!resizingSessionSections) return;
    const nextSizes = resizingSessionSections.sizes;
    const from = resizingSessionSections.from;
    const to = resizingSessionSections.to;
    resizingSessionSections = null;
    committedResizePreview = {
      ...committedResizePreview,
      [from]: nextSizes[from],
      [to]: nextSizes[to],
    };
    try {
      await onUpdateSessionNavigationSectionState(from, { sizePx: nextSizes[from] });
      await onUpdateSessionNavigationSectionState(to, { sizePx: nextSizes[to] });
    } finally {
      committedResizePreview = {};
    }
  }

  async function loadBranchOptions() {
    if (!onListWorkspaceBranches) return;
    branchMenuError = null;
    branchMenuLoading = true;
    try {
      branchOptions = await onListWorkspaceBranches();
    } catch (error) {
      branchMenuError = error instanceof Error ? error.message : "Unable to load branches.";
    } finally {
      branchMenuLoading = false;
    }
  }

  async function switchBranch(branch: string) {
    if (branch === workspaceBranch || !onSwitchWorkspaceBranch) return;
    branchMenuError = null;
    branchMenuLoading = true;
    try {
      await onSwitchWorkspaceBranch(branch);
      branchOptions = branchOptions.map((option) => ({
        ...option,
        current: option.name === branch,
      }));
    } catch (error) {
      branchMenuError = error instanceof Error ? error.message : "Unable to switch branch.";
    } finally {
      branchMenuLoading = false;
    }
  }

  function openSessionContextMenu(
    session: WorkspaceSessionSummary,
    event: MouseEvent | KeyboardEvent,
  ) {
    const currentTarget = event.currentTarget as HTMLElement | null;
    const fallbackRect = currentTarget?.getBoundingClientRect();
    const x = "clientX" in event && event.clientX > 0 ? event.clientX : (fallbackRect?.left ?? 0);
    const y =
      "clientY" in event && event.clientY > 0 ? event.clientY : (fallbackRect?.bottom ?? 0);
    sessionContextMenu = {
      session,
      x: Math.max(8, Math.min(x, window.innerWidth - 220)),
      y: Math.max(8, Math.min(y, window.innerHeight - 190)),
    };
    confirmingDeleteSessionId = null;
  }

  function closeSessionContextMenu() {
    sessionContextMenu = null;
    confirmingDeleteSessionId = null;
  }

  function runSessionContextAction(action: () => void) {
    action();
    closeSessionContextMenu();
  }

  function getSessionContextMenuItems(session: WorkspaceSessionSummary): ContextMenuItem[] {
    const renameLocked = session.titleGeneration?.renameLocked ?? false;
    return [
      {
        id: "read-state",
        label: session.isUnread ? "Mark as Read" : "Mark as Unread",
      },
      {
        id: "pin-state",
        label: session.isPinned ? "Unpin" : "Pin",
      },
      {
        id: "rename",
        label: "Rename",
        disabled: renameLocked,
      },
      {
        id: "archive-state",
        label: session.isArchived ? "Unarchive" : "Archive",
      },
      {
        id: "delete",
        label: confirmingDeleteSessionId === session.id ? "Confirm" : "Delete",
        keepOpen: confirmingDeleteSessionId !== session.id,
        tone: "danger",
      },
    ];
  }

  function selectSessionContextMenuItem(session: WorkspaceSessionSummary, item: ContextMenuItem) {
    if (item.id === "read-state") {
      runSessionContextAction(() =>
        session.isUnread ? onMarkSessionRead(session) : onMarkSessionUnread(session),
      );
      return;
    }
    if (item.id === "pin-state") {
      runSessionContextAction(() =>
        session.isPinned ? onUnpinSession(session) : onPinSession(session),
      );
      return;
    }
    if (item.id === "rename") {
      runSessionContextAction(() => onRenameSession(session));
      return;
    }
    if (item.id === "archive-state") {
      runSessionContextAction(() =>
        session.isArchived ? onUnarchiveSession(session) : onArchiveSession(session),
      );
      return;
    }
    if (item.id === "delete") {
      if (confirmingDeleteSessionId !== session.id) {
        confirmingDeleteSessionId = session.id;
        return;
      }
      runSessionContextAction(() => onDeleteSession(session));
    }
  }

  function showShortcut(action: string) {
    shortcutAction = action;
  }

  function hideShortcut(action: string) {
    if (shortcutAction === action) {
      shortcutAction = null;
    }
  }

  const appLogUnreadTitle = $derived.by(() => {
    return formatAppLogUnreadTitle(appLogSummary);
  });
  const appLogUnreadBadges = $derived(getVisibleAppLogUnreadBadges(appLogSummary));

  function isThreadWorking(thread: WorkspaceSidebarHandlerThreadRow): boolean {
    return thread.status === "running-handler" || thread.status === "running-workflow";
  }

  function isWorkflowWorking(workflow: WorkspaceSidebarWorkflowRow): boolean {
    return workflow.status === "running";
  }

  function isCommandWorking(command: WorkspaceCommandRollup): boolean {
    return command.status === "streaming" || command.status === "requested" || command.status === "running";
  }

  function getCommandTone(command: WorkspaceCommandRollup): "muted" | "waiting" | "error" {
    if (command.status === "failed") return "error";
    if (command.status === "streaming" || command.status === "requested" || command.status === "running" || command.status === "waiting") {
      return "waiting";
    }
    return "muted";
  }

  function getSubtitleClass(
    subtitle: WorkspaceSidebarRowSubtitle | null,
    working = false,
  ): string {
    const shouldBlink = working && subtitle?.tone === "muted";
    return `${subtitle ? `sidebar-child-subtitle tone-${subtitle.tone}` : "sidebar-child-subtitle"} ${
      shouldBlink ? "blinking" : ""
    }`.trim();
  }

  function getPaneTone(paneLocations: SidebarPaneLocation[]): SidebarPaneLocation["tone"] {
    return (
      paneLocations.find((location) => location.tone === "error")?.tone ??
      paneLocations.find((location) => location.tone === "waiting")?.tone ??
      "neutral"
    );
  }

  function getPrimaryPaneLocation(paneLocations: SidebarPaneLocation[]): SidebarPaneLocation | null {
    return paneLocations.find((location) => location.focused) ?? paneLocations[0] ?? null;
  }

  const MIN_SESSION_SECTION_SIZE_PX = 64;
  const DEFAULT_SESSION_SECTION_SIZES = {
    pinned: 150,
    active: 260,
    archived: 190,
  } satisfies Record<WorkspaceSessionNavigationSectionId, number>;

  const sessionSections = $derived.by(() => [
    {
      id: "pinned" as const,
      label: "Pinned",
      ariaLabel: "Pinned sessions",
      sessions: navigation.pinnedSessions,
    },
    {
      id: "active" as const,
      label: "Sessions",
      ariaLabel: "Sessions",
      sessions: navigation.activeSessions,
    },
    {
      id: "archived" as const,
      label: "Archived",
      ariaLabel: "Archived sessions",
      sessions: navigation.archived.sessions,
    },
  ]);

  function getSessionSectionState(section: WorkspaceSessionNavigationSectionId) {
    const state = navigation.sections?.[section];
    if (state) return state;
    return {
      collapsed: section === "archived" ? navigation.archived.collapsed : false,
      sizePx: DEFAULT_SESSION_SECTION_SIZES[section],
    };
  }

  function isSessionSectionCollapsed(section: WorkspaceSessionNavigationSectionId): boolean {
    return getSessionSectionState(section).collapsed;
  }

  function getSessionSectionSize(section: WorkspaceSessionNavigationSectionId): number {
    return (
      resizingSessionSections?.sizes[section] ??
      committedResizePreview[section] ??
      getSessionSectionState(section).sizePx ??
      DEFAULT_SESSION_SECTION_SIZES[section]
    );
  }

  function getNextResizableSessionSection(
    section: WorkspaceSessionNavigationSectionId,
  ): WorkspaceSessionNavigationSectionId | null {
    const currentIndex = sessionSections.findIndex((candidate) => candidate.id === section);
    return (
      sessionSections
        .slice(currentIndex + 1)
        .find((candidate) => !isSessionSectionCollapsed(candidate.id))?.id ?? null
    );
  }

  function startSessionSectionResize(section: WorkspaceSessionNavigationSectionId, event: PointerEvent) {
    const nextSection = getNextResizableSessionSection(section);
    if (!nextSection) return;
    event.preventDefault();
    resizingSessionSections = {
      from: section,
      to: nextSection,
      startY: event.clientY,
      fromStartSize: getSessionSectionSize(section),
      toStartSize: getSessionSectionSize(nextSection),
      sizes: {
        pinned: getSessionSectionSize("pinned"),
        active: getSessionSectionSize("active"),
        archived: getSessionSectionSize("archived"),
      },
    };
  }

  function toggleSessionSection(section: WorkspaceSessionNavigationSectionId) {
    const collapsed = !isSessionSectionCollapsed(section);
    if (section === "archived") {
      onToggleArchivedGroup(collapsed);
      return;
    }
    onUpdateSessionNavigationSectionState(section, { collapsed });
  }
</script>

<svelte:window
  onkeydown={handleWindowKeydown}
  onpointerdown={handleWindowPointerDown}
  onpointermove={handleWindowPointerMove}
  onpointerup={handleWindowPointerUp}
/>

<div class="session-sidebar">
  <div class="sidebar-window-row electrobun-webkit-app-region-drag" aria-hidden="true"></div>

  <div class="sidebar-actions" aria-label="Session actions">
    <div
      class="sidebar-primary-actions"
      role="group"
      aria-label="Primary sidebar actions"
      bind:this={primaryActionsElement}
      onmouseenter={cancelNewSessionMenuClose}
      onfocusin={cancelNewSessionMenuClose}
      onmouseleave={handlePrimaryActionsPointerLeave}
      onfocusout={handlePrimaryActionsFocusOut}
    >
      <div
        class="new-session-menu-shell"
        class:menu-open={showNewSessionMenu}
        role="group"
        aria-label="New session options"
        onmouseenter={openNewSessionMenu}
        onmouseleave={handleNewSessionMenuPointerLeave}
        onfocusin={openNewSessionMenu}
        onfocusout={handleNewSessionMenuFocusOut}
      >
        <div class="sidebar-action-row new-session-row">
          <Tooltip
            label=""
            side="right"
            block
            delayMs={2000}
            details={[
              {
                label: "New orchestrator in focused pane",
                hints: [{ icon: "mouse-left" }, { shortcut: newSessionReadableShortcut }],
              },
              {
                label: "New orchestrator in new pane",
                hints: [
                  { shortcut: "⌘", icon: "mouse-left" },
                  { shortcut: newSessionInNewPaneReadableShortcut },
                ],
              },
            ]}
          >
            <button
              type="button"
              class={`sidebar-action-main ${shortcutAction === "new" ? "shortcut-open" : ""}`.trim()}
              onmouseenter={() => showShortcut("new")}
              onmouseleave={() => hideShortcut("new")}
              onfocus={() => showShortcut("new")}
              onblur={() => hideShortcut("new")}
              onclick={(event) => {
                closeNewSessionMenu();
                onCreateSession(event);
              }}
              disabled={busy}
              aria-label="Create a new orchestrator"
            >
              <span class="sidebar-action-icon"><PlusIcon aria-hidden="true" size={15} strokeWidth={1.9} /></span>
              <span class="new-orchestrator-main-copy">
                <span class="sidebar-action-label">New orchestrator</span>
                {#if orchestratorProfiles[0]}
                  <span class="new-orchestrator-default">
                    <span>{orchestratorProfiles[0].model}</span>
                    <span>{orchestratorProfiles[0].reasoningEffort}</span>
                  </span>
                {/if}
              </span>
              <Kbd value={newSessionDisplayShortcut} class="sidebar-action-shortcut" />
            </button>
          </Tooltip>
        </div>
        <div class="new-session-accordion" aria-hidden={!showNewSessionMenu}>
          <div class="new-session-accordion-inner">
            {#each orchestratorProfiles.slice(1) as profile (profile.id)}
              <button
                type="button"
                class="sidebar-action-row new-session-child profile-picker-row"
                disabled={busy}
                tabindex={showNewSessionMenu ? 0 : -1}
                onclick={(event) => {
                  closeNewSessionMenu();
                  onCreateSession(event, profile.id);
                }}
              >
                <span class="sidebar-action-icon"><BotIcon aria-hidden="true" size={14} strokeWidth={1.9} /></span>
                <span class="profile-picker-content">
                  <span class="sidebar-action-label">{profile.name}</span>
                  <span class="profile-picker-badges">
                    <span>{profile.model}</span>
                    <span>{profile.reasoningEffort}</span>
                  </span>
                </span>
              </button>
            {/each}
          </div>
        </div>
      </div>
      {#if onOpenSearch}
        <button
          class={`sidebar-action-row ${shortcutAction === "search" ? "shortcut-open" : ""}`.trim()}
          type="button"
          aria-label="Open quick open"
          onmouseenter={() => showShortcut("search")}
          onmouseleave={() => hideShortcut("search")}
          onfocus={() => showShortcut("search")}
          onblur={() => hideShortcut("search")}
          onclick={onOpenSearch}
        >
          <span class="sidebar-action-icon"><SearchIcon size={15} aria-hidden="true" strokeWidth={1.9} /></span>
          <span class="sidebar-action-label">Search</span>
          <Kbd value={quickOpenDisplayShortcut} class="sidebar-action-shortcut" />
        </button>
      {/if}
      {#if onOpenCommandPalette}
        <button
          class={`sidebar-action-row ${shortcutAction === "commands" ? "shortcut-open" : ""}`.trim()}
          type="button"
          aria-label="Open command palette"
          onmouseenter={() => showShortcut("commands")}
          onmouseleave={() => hideShortcut("commands")}
          onfocus={() => showShortcut("commands")}
          onblur={() => hideShortcut("commands")}
          onclick={onOpenCommandPalette}
        >
          <span class="sidebar-action-icon"><CommandIcon size={15} aria-hidden="true" strokeWidth={1.9} /></span>
          <span class="sidebar-action-label">Command palette</span>
          <Kbd value={commandPaletteDisplayShortcut} class="sidebar-action-shortcut" />
        </button>
      {/if}
    </div>
  </div>

  {#if errorMessage}
    <p class="sidebar-error">{errorMessage}</p>
  {/if}

  {#snippet sessionChildren(session: WorkspaceSessionSummary)}
    {#if (session.sidebarThreads?.length ?? 0) > 0}
      <div class="sidebar-child-list" aria-label={`Handler threads for ${session.title}`}>
        {#each session.sidebarThreads ?? [] as thread (thread.threadId)}
          {@const threadPaneLocations = paneLocationsByThreadId[thread.threadId] ?? []}
          {@const threadPrimaryPane = getPrimaryPaneLocation(threadPaneLocations)}
          {@const threadWorking = isThreadWorking(thread)}
          <button
            type="button"
            class={`sidebar-child-row handler-row status-${thread.status} ${session.id === activeSessionId && thread.threadId === activeThreadId ? "active" : ""} ${threadPaneLocations.length > 0 ? "open-in-pane" : ""} ${threadPrimaryPane?.focused ? "focused-in-pane" : ""} open-tone-${getPaneTone(threadPaneLocations)} ${threadWorking ? "working" : ""}`.trim()}
            onclick={(event) => onOpenHandlerThread?.(session.id, thread, event)}
          >
            <span class="sidebar-child-content">
              <span class="sidebar-child-title-row">
                <span class="sidebar-child-title">{thread.title}</span>
                {#if threadPrimaryPane}
                  <span
                    class="sidebar-pane-location"
                    data-focused={threadPrimaryPane.focused ? "true" : "false"}
                    title={threadPrimaryPane.focused ? `Focused pane: ${threadPrimaryPane.label}` : `Open pane: ${threadPrimaryPane.label}`}
                  >
                    {threadPrimaryPane.label}
                  </span>
                {/if}
              </span>
              {#if thread.subtitle}
                <span class={getSubtitleClass(thread.subtitle, threadWorking)}>
                  <span>{thread.subtitle.badge}</span>
                  <span>{thread.subtitle.text}</span>
                </span>
              {:else if threadWorking && !thread.latestCommandRollup}
                <span class="sidebar-child-subtitle tone-muted blinking" aria-label="Running">
                  <span>...</span>
                </span>
              {/if}
              {#if thread.latestCommandRollup}
                {@const commandWorking = isCommandWorking(thread.latestCommandRollup)}
                <span
                  class={`sidebar-child-command tone-${getCommandTone(thread.latestCommandRollup)} ${commandWorking ? "blinking" : ""}`.trim()}
                  title={`${thread.latestCommandRollup.title}: ${thread.latestCommandRollup.summary}`}
                >
                  <CommandIcon size={12} aria-hidden="true" />
                  <span>{thread.latestCommandRollup.status}</span>
                  <span>{thread.latestCommandRollup.title}</span>
                </span>
              {/if}
              {#if threadPrimaryPane?.contextBudget}
                <span class="sidebar-child-context" aria-hidden="true">
                  <ContextBudgetBar budget={threadPrimaryPane.contextBudget} variant="compact" label="Context" />
                </span>
              {/if}
            </span>
          </button>
          {#if thread.workflows.length > 0}
            <div class="sidebar-workflow-list" aria-label={`Workflow runs for ${thread.title}`}>
              {#each thread.workflows as workflow (workflow.workflowRunId)}
                {@const workflowPaneLocations = paneLocationsByWorkflowRunId[workflow.workflowRunId] ?? []}
                {@const workflowWorking = isWorkflowWorking(workflow)}
                <button
                  type="button"
                  class={`sidebar-child-row workflow-row status-${workflow.status} ${workflowPaneLocations.length > 0 ? "open-in-pane" : ""} open-tone-${getPaneTone(workflowPaneLocations)} ${workflowWorking ? "working" : ""}`.trim()}
                  onclick={(event) => onOpenWorkflowRun?.(session.id, workflow, event)}
                >
                  <span class="sidebar-child-content">
                    <span class="sidebar-child-title">{workflow.workflowName}</span>
                    {#if workflow.subtitle}
                      <span class={getSubtitleClass(workflow.subtitle, workflowWorking)}>
                        <span>{workflow.subtitle.badge}</span>
                        <span>{workflow.subtitle.text}</span>
                      </span>
                    {/if}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/snippet}

  <div class="sidebar-sections">
    <div class={`sidebar-list ${resizingSessionSections ? "resizing" : ""}`.trim()}>
      {#each sessionSections as section (section.id)}
        {@const collapsed = isSessionSectionCollapsed(section.id)}
        {@const nextResizableSection = getNextResizableSessionSection(section.id)}
        <section
          class={`sidebar-section session-accordion-section ${collapsed ? "collapsed" : ""}`.trim()}
          aria-label={section.ariaLabel}
          style={`--session-section-size: ${getSessionSectionSize(section.id)}px;`}
        >
          <button
            class="session-section-toggle"
            type="button"
            aria-expanded={!collapsed}
            onclick={() => toggleSessionSection(section.id)}
          >
            {#if collapsed}
              <ChevronRightIcon aria-hidden="true" size={14} strokeWidth={1.9} />
            {:else}
              <ChevronDownIcon aria-hidden="true" size={14} strokeWidth={1.9} />
            {/if}
            <span>{section.label}</span>
            <span>{section.sessions.length}</span>
          </button>

          {#if !collapsed}
            <div class="session-section-body">
              {#each section.sessions as session (session.id)}
                <SessionListItem
                  active={session.id === activeOrchestratorSessionId}
                  disabled={false}
                  paneLocations={paneLocationsBySessionId[session.id] ?? []}
                {relativeTimeNow}
                {session}
                onOpen={(event) => onOpenSession(session.id, event)}
                onRename={() => onRenameSession(session)}
                onPin={() => onPinSession(session)}
                onUnpin={() => onUnpinSession(session)}
                onArchive={() => onArchiveSession(session)}
                onUnarchive={() => onUnarchiveSession(session)}
                  onContextMenu={(event) => openSessionContextMenu(session, event)}
                />
                {@render sessionChildren(session)}
              {/each}
            </div>
          {/if}
        </section>
        {#if !collapsed && nextResizableSection}
          <button
            class="session-section-resize"
            class:dragging={resizingSessionSections?.from === section.id}
            type="button"
            aria-label={`Resize ${section.label} sessions section`}
            onpointerdown={(event) => startSessionSectionResize(section.id, event)}
          ></button>
        {/if}
      {/each}
    </div>
  </div>

  {#if sessionContextMenu}
    {@const menuSession = sessionContextMenu.session}
    <ContextMenu
      bind:this={sessionContextMenuElement}
      x={sessionContextMenu.x}
      y={sessionContextMenu.y}
      label={`Session actions for ${menuSession.title}`}
      items={getSessionContextMenuItems(menuSession)}
      onSelect={(item) => selectSessionContextMenuItem(menuSession, item)}
      onClose={closeSessionContextMenu}
    />
  {/if}

  {#if onOpenWorkflowLibrary || onOpenAgents || onOpenExtensions || onOpenSnippets || onOpenAppLogs}
    <div class="sidebar-lower-nav">
      {#if onOpenAppLogs}
        <Tooltip label={appLogUnreadTitle} side="right" block details={paneOpenTooltipDetails}>
          <button
            class={`sidebar-action-row reference-nav-row logs-nav-row ${(appLogSummary?.unread.error ?? 0) > 0 ? "has-errors" : ""} ${shortcutAction === "logs" ? "shortcut-open" : ""}`.trim()}
            type="button"
            aria-label={appLogUnreadTitle}
            onmouseenter={() => showShortcut("logs")}
            onmouseleave={() => hideShortcut("logs")}
            onfocus={() => showShortcut("logs")}
            onblur={() => hideShortcut("logs")}
            onclick={(event) => onOpenAppLogs(event)}
          >
            <span class="sidebar-action-icon"><LogsIcon size={15} aria-hidden="true" strokeWidth={1.9} /></span>
            <span class="sidebar-action-label">Logs</span>
            <span class="sidebar-shortcut-slot">
              <span class="log-unread-badges" aria-hidden="true">
                {#each appLogUnreadBadges as badge (badge.level)}
                  <small class={`log-badge ${badge.level}`}>{formatAppLogCount(badge.count)}</small>
                {/each}
              </span>
              <Kbd value={appLogsDisplayShortcut} class="sidebar-action-shortcut" />
            </span>
          </button>
        </Tooltip>
      {/if}
      {#if onOpenAgents}
        <Tooltip label="Open agent profiles" side="right" block details={paneOpenTooltipDetails}>
          <button
            class={`sidebar-action-row reference-nav-row ${shortcutAction === "agents" ? "shortcut-open" : ""}`.trim()}
            type="button"
            aria-label="Open agent profiles"
            onmouseenter={() => showShortcut("agents")}
            onmouseleave={() => hideShortcut("agents")}
            onfocus={() => showShortcut("agents")}
            onblur={() => hideShortcut("agents")}
            onclick={(event) => onOpenAgents(event)}
          >
            <span class="sidebar-action-icon"><BotIcon size={15} aria-hidden="true" strokeWidth={1.9} /></span>
            <span class="sidebar-action-label">Agents</span>
            <Kbd value={agentsDisplayShortcut} class="sidebar-action-shortcut" />
          </button>
        </Tooltip>
      {/if}
      {#if onOpenExtensions}
        <Tooltip label="Open extensions" side="right" block details={paneOpenTooltipDetails}>
          <button
            class={`sidebar-action-row reference-nav-row ${shortcutAction === "extensions" ? "shortcut-open" : ""}`.trim()}
            type="button"
            aria-label="Open extensions"
            onmouseenter={() => showShortcut("extensions")}
            onmouseleave={() => hideShortcut("extensions")}
            onfocus={() => showShortcut("extensions")}
            onblur={() => hideShortcut("extensions")}
            onclick={(event) => onOpenExtensions(event)}
          >
            <span class="sidebar-action-icon"><BoxesIcon size={15} aria-hidden="true" strokeWidth={1.9} /></span>
            <span class="sidebar-action-label">Extensions</span>
            <Kbd value={extensionsDisplayShortcut} class="sidebar-action-shortcut" />
          </button>
        </Tooltip>
      {/if}
      {#if onOpenSnippets}
        <Tooltip label="Open snippets" side="right" block details={paneOpenTooltipDetails}>
          <button
            class="sidebar-action-row reference-nav-row"
            type="button"
            aria-label="Open snippets"
            onclick={(event) => onOpenSnippets(event)}
          >
            <span class="sidebar-action-icon"><FileTextIcon size={15} aria-hidden="true" strokeWidth={1.9} /></span>
            <span class="sidebar-action-label">Snippets</span>
          </button>
        </Tooltip>
      {/if}
      {#if onOpenWorkflowLibrary}
        <Tooltip label="Open workflow assets" side="right" block details={paneOpenTooltipDetails}>
          <button
            class={`sidebar-action-row reference-nav-row ${shortcutAction === "workflows" ? "shortcut-open" : ""}`.trim()}
            type="button"
            aria-label="Open workflows"
            onmouseenter={() => showShortcut("workflows")}
            onmouseleave={() => hideShortcut("workflows")}
            onfocus={() => showShortcut("workflows")}
            onblur={() => hideShortcut("workflows")}
            onclick={(event) => onOpenWorkflowLibrary(event)}
          >
            <span class="sidebar-action-icon"><WorkflowIcon size={15} aria-hidden="true" strokeWidth={1.9} /></span>
            <span class="sidebar-action-label">Workflows</span>
            <Kbd value={workflowsDisplayShortcut} class="sidebar-action-shortcut" />
          </button>
        </Tooltip>
      {/if}
    </div>
  {/if}

  <footer class="sidebar-footer">
    {#if branchControlEnabled}
      <Tooltip label="Switch branch">
        <CompactCombobox
          bind:open={branchMenuOpen}
          value={footerWorkspaceLabel}
          options={branchSelectOptions}
          ariaLabel="Switch branch"
          placeholder="Search branches"
          emptyLabel="No branches match."
          disabled={busy}
          triggerClass="workspace-path"
          menuClass="branch-menu"
          optionClass="branch-option"
          leadingIcon="branch"
          onBeforeOpen={loadBranchOptions}
          onSelect={switchBranch}
        />
      </Tooltip>
    {:else}
      <div class="workspace-path-static" aria-label="Workspace">
        <FolderGit2Icon size={12} aria-hidden="true" />
        <span>{footerWorkspaceLabel}</span>
      </div>
    {/if}
    {#if onOpenSettings}
      <Tooltip label="Open settings">
        <button
          class="sidebar-footer-button"
          type="button"
          aria-label="Open settings"
          onclick={onOpenSettings}
        >
          <SettingsIcon size={14} aria-hidden="true" />
        </button>
      </Tooltip>
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

  .sidebar-window-row {
    flex: 0 0 auto;
    min-height: var(--workspace-chrome-height, 42px);
  }

  .sidebar-error {
    margin: 0;
  }

  .sidebar-error {
    margin: 0.5rem 0.68rem 0;
    padding: 0.55rem 0.62rem;
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-danger-soft) 86%, transparent);
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .sidebar-actions {
    display: grid;
    gap: 0.08rem;
    padding: 0.08rem 0.72rem 0.7rem;
    position: relative;
    z-index: 8;
  }

  .sidebar-primary-actions {
    display: grid;
    gap: 0.08rem;
    min-width: 0;
  }

  .new-session-menu-shell {
    display: grid;
    min-width: 0;
  }

  .sidebar-action-row {
    --sidebar-row-height: 1.82rem;
    display: grid;
    grid-template-columns: 1.1rem minmax(0, 1fr) minmax(1.24rem, auto);
    align-items: center;
    gap: 0.48rem;
    width: 100%;
    min-height: var(--sidebar-row-height);
    padding: 0.26rem 0.34rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
    font-weight: 460;
    line-height: 1.25;
    text-align: left;
    cursor: pointer;
    min-width: 0;
    transition:
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .sidebar-action-row:hover,
  .sidebar-action-row:focus-visible,
  .new-session-row:focus-within,
  .new-session-menu-shell.menu-open .new-session-row {
    outline: none;
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .sidebar-action-row:focus-visible,
  .new-session-row:has(:focus-visible) {
    box-shadow: var(--ui-focus-ring);
  }

  .sidebar-action-row:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .sidebar-action-icon {
    display: grid;
    place-items: center;
    width: 1.1rem;
    color: inherit;
  }

  .sidebar-action-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.sidebar-action-shortcut) {
    justify-self: end;
    flex: 0 0 auto;
    min-width: max-content;
    max-width: 4.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.2;
    opacity: 0;
    transform: translateX(0.12rem);
    transition:
      opacity 110ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 110ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .sidebar-shortcut-slot {
    display: grid;
    align-items: center;
    justify-items: end;
    min-width: max-content;
  }

  .sidebar-shortcut-slot > * {
    grid-area: 1 / 1;
  }

  .sidebar-action-row:hover :global(.sidebar-action-shortcut),
  .sidebar-action-row:focus-visible :global(.sidebar-action-shortcut),
  .sidebar-action-row:focus-within :global(.sidebar-action-shortcut),
  .sidebar-action-main:hover :global(.sidebar-action-shortcut),
  .sidebar-action-main:focus-visible :global(.sidebar-action-shortcut),
  .shortcut-open :global(.sidebar-action-shortcut),
  .new-session-menu-shell.menu-open .new-session-row :global(.sidebar-action-shortcut) {
    opacity: 1;
    transform: translateX(0);
  }

  .sidebar-action-row:hover .log-unread-badges,
  .sidebar-action-row:focus-visible .log-unread-badges,
  .sidebar-action-row:focus-within .log-unread-badges,
  .shortcut-open .log-unread-badges {
    opacity: 0;
  }

  .new-session-row {
    grid-template-columns: minmax(0, 1fr);
    padding: 0;
  }

  .new-session-menu-shell.menu-open .new-session-row,
  .new-session-row:focus-within {
    padding-bottom: 1.28rem;
  }

  .sidebar-action-main {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 1.1rem minmax(0, 1fr) minmax(1.24rem, auto);
    align-items: center;
    gap: 0.48rem;
    width: 100%;
    min-width: 0;
    min-height: var(--sidebar-row-height);
    padding: 0.26rem 0.34rem;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .sidebar-action-main:hover,
  .sidebar-action-main:focus-visible,
  .sidebar-action-main:focus-within,
  .new-session-menu-shell.menu-open .sidebar-action-main {
    min-height: var(--sidebar-row-height);
  }

  .new-orchestrator-main-copy {
    display: grid;
    min-width: 0;
    position: relative;
  }

  .new-orchestrator-default {
    display: flex;
    flex-wrap: wrap;
    gap: 0.28rem;
    min-width: 0;
    max-height: 0;
    overflow: hidden;
    position: absolute;
    top: calc(100% + 0.13rem);
    left: 0;
    width: max-content;
    max-width: calc(100vw - 3rem);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    line-height: 1.25;
    opacity: 0;
    transform: translateY(-0.08rem);
    transition:
      max-height 150ms cubic-bezier(0.19, 1, 0.22, 1),
      opacity 120ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .sidebar-action-main:hover .new-orchestrator-default,
  .sidebar-action-main:focus-visible .new-orchestrator-default,
  .sidebar-action-main:focus-within .new-orchestrator-default,
  .new-session-menu-shell.menu-open .new-orchestrator-default {
    max-height: 1.05rem;
    opacity: 1;
    transform: translateY(0);
  }

  .new-orchestrator-default span {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    padding: 0.04rem 0.24rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 70%, transparent);
    border-radius: var(--ui-radius-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-action-main:focus-visible {
    outline: none;
  }

  .sidebar-action-main:disabled {
    cursor: default;
  }

  .new-session-accordion {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transform: translateY(-0.16rem);
    pointer-events: none;
    transition:
      grid-template-rows 170ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 140ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 170ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .new-session-menu-shell.menu-open .new-session-accordion {
    grid-template-rows: 1fr;
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .new-session-accordion-inner {
    overflow: hidden;
    min-height: 0;
    padding: 0.08rem 0 0;
  }

  .new-session-child {
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
  }

  .new-session-child .sidebar-action-icon {
    color: var(--ui-text-tertiary);
  }

  .profile-picker-row {
    grid-template-columns: 1.1rem minmax(0, 1fr);
    align-items: start;
    padding-block: 0.34rem;
  }

  .profile-picker-content {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
  }

  .profile-picker-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.16rem;
    min-width: 0;
  }

  .profile-picker-badges span {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    padding: 0.04rem 0.24rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 70%, transparent);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-sections {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    padding: 0.16rem 0.24rem 0.62rem;
  }

  .sidebar-list {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .sidebar-section {
    min-width: 0;
  }

  .session-accordion-section {
    display: flex;
    flex: 1 1 var(--session-section-size, 12rem);
    flex-direction: column;
    min-height: 2rem;
    overflow: hidden;
  }

  .session-accordion-section.collapsed {
    flex: 0 0 auto;
    min-height: 0;
  }

  .session-section-body {
    display: grid;
    align-content: start;
    gap: 0.12rem;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding-bottom: 0.2rem;
  }

  .sidebar-child-list,
  .sidebar-workflow-list {
    display: grid;
    gap: 0.08rem;
    min-width: 0;
  }

  .sidebar-child-list {
    margin: -0.02rem 0 0.18rem 0.72rem;
    padding-left: 0.44rem;
  }

  .sidebar-workflow-list {
    margin-left: 0.62rem;
    padding-left: 0.5rem;
    border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 52%, transparent);
  }

  .sidebar-child-row {
    position: relative;
    display: grid;
    align-items: start;
    width: 100%;
    min-width: 0;
    padding: 0.32rem 0.42rem 0.3rem 0.82rem;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .sidebar-child-row::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0.12rem;
    border-radius: var(--ui-radius-sm) 0 0 var(--ui-radius-sm);
    background: transparent;
    transition: background-color 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .sidebar-child-row:hover:not(:disabled),
  .sidebar-child-row:focus-visible {
    outline: none;
    background: color-mix(in oklab, var(--ui-surface-subtle) 62%, transparent);
    color: var(--ui-text-primary);
  }

  .sidebar-child-row:focus-visible {
    box-shadow: var(--ui-focus-ring);
  }

  .sidebar-child-row.active {
    border-color: transparent;
    background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
  }

  .sidebar-child-row.active::before {
    background: color-mix(in oklab, var(--ui-accent) 84%, transparent);
  }

  .sidebar-child-row.open-in-pane:not(.active) {
    border-color: transparent;
    background: color-mix(in oklab, var(--ui-surface-subtle) 34%, transparent);
  }

  .sidebar-child-row.open-in-pane:not(.active)::before {
    background: color-mix(in oklab, var(--ui-text-tertiary) 42%, transparent);
  }

  .sidebar-child-row.focused-in-pane {
    border-color: color-mix(in oklab, var(--ui-accent) 34%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ui-accent) 18%, transparent);
  }

  .sidebar-child-row.focused-in-pane::before {
    background: color-mix(in oklab, var(--ui-accent) 68%, transparent);
  }

  .sidebar-child-row.open-tone-waiting:not(.active) {
    border-color: transparent;
    background: color-mix(in oklab, var(--ui-status-waiting-soft) 28%, transparent);
  }

  .sidebar-child-row.open-tone-waiting:not(.active)::before {
    background: color-mix(in oklab, var(--ui-status-waiting) 54%, transparent);
  }

  .sidebar-child-row.open-tone-error:not(.active) {
    border-color: transparent;
    background: color-mix(in oklab, var(--ui-danger-soft) 30%, transparent);
  }

  .sidebar-child-row.open-tone-error:not(.active)::before {
    background: color-mix(in oklab, var(--ui-danger) 56%, transparent);
  }

  .sidebar-child-row:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .workflow-row {
    padding-block: 0.25rem;
    color: var(--ui-text-tertiary);
  }

  .sidebar-child-content {
    display: grid;
    gap: 0.12rem;
    min-width: 0;
  }

  .sidebar-child-title-row {
    display: flex;
    align-items: center;
    gap: 0.34rem;
    min-width: 0;
  }

  .sidebar-child-title {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    color: inherit;
    font-size: var(--text-xs);
    font-weight: 500;
    line-height: 1.22;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workflow-row .sidebar-child-title {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .sidebar-pane-location {
    flex: 0 1 auto;
    max-width: 5.2rem;
    overflow: hidden;
    border-radius: 0.28rem;
    padding: 0 0.28rem;
    background: color-mix(in oklab, var(--ui-text-tertiary) 10%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-pane-location[data-focused="true"] {
    background: color-mix(in oklab, var(--ui-accent) 16%, transparent);
    color: color-mix(in oklab, var(--ui-accent) 84%, var(--ui-text-primary));
  }

  .sidebar-child-subtitle {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    gap: 0.28rem;
    min-width: 0;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: 1.25;
    color: var(--ui-text-tertiary);
  }

  .sidebar-child-subtitle span:first-child {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: lowercase;
    white-space: nowrap;
  }

  .sidebar-child-subtitle span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-child-subtitle.tone-waiting {
    color: color-mix(in oklab, var(--ui-status-waiting) 76%, var(--ui-text-primary));
  }

  .sidebar-child-subtitle.tone-error {
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
  }

  .sidebar-child-subtitle.text-only {
    grid-template-columns: minmax(0, 1fr);
  }

  .sidebar-child-subtitle.text-only span {
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-child-command {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: center;
    gap: 0.24rem;
    min-width: 0;
    overflow: hidden;
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    line-height: 1.25;
  }

  .sidebar-child-command span:nth-child(2) {
    font-family: var(--font-mono);
    font-weight: 600;
    text-transform: lowercase;
    white-space: nowrap;
  }

  .sidebar-child-command span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-child-command.tone-waiting {
    color: color-mix(in oklab, var(--ui-status-waiting) 76%, var(--ui-text-secondary));
  }

  .sidebar-child-command.tone-error {
    color: color-mix(in oklab, var(--ui-danger) 78%, var(--ui-text-secondary));
  }

  .sidebar-child-context {
    display: block;
    margin-top: 0.1rem;
  }

  .sidebar-child-context :global(.context-budget-compact) {
    position: static;
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
  }

  .sidebar-child-context :global(.context-budget-compact-label) {
    display: none;
  }

  .blinking {
    animation: sidebar-working-blink 1.8s ease-in-out infinite;
  }

  @keyframes sidebar-working-blink {
    0%,
    100% {
      opacity: 0.38;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .blinking {
      animation: none;
    }
  }

  .session-section-toggle {
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
    font-size: var(--text-xs);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    flex: 0 0 auto;
  }

  .session-section-toggle:hover {
    background: color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent);
    color: var(--ui-text-secondary);
  }

  .session-section-toggle:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .session-section-toggle span:last-child {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .session-section-resize {
    position: relative;
    flex: 0 0 0.34rem;
    min-height: 0.34rem;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: row-resize;
  }

  .session-section-resize::before {
    content: "";
    position: absolute;
    inset: 0.15rem 0.94rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-border-soft) 56%, transparent);
    opacity: 0.62;
    transition:
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .session-section-resize:hover::before,
  .session-section-resize:focus-visible::before,
  .session-section-resize.dragging::before {
    background: color-mix(in oklab, var(--ui-accent) 62%, transparent);
    opacity: 0.96;
  }

  .session-section-resize:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .sidebar-lower-nav {
    display: grid;
    flex: 0 0 auto;
    padding: 0.25rem 0.72rem 0.42rem;
  }

  .reference-nav-row {
    height: var(--sidebar-row-height);
    min-height: var(--sidebar-row-height);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .logs-nav-row {
    position: relative;
  }

  .logs-nav-row.has-errors {
    background: color-mix(in oklab, var(--ui-danger-soft) 54%, transparent);
    color: color-mix(in oklab, var(--ui-danger) 30%, var(--ui-text-secondary));
  }

  .log-unread-badges {
    position: absolute;
    top: 50%;
    right: 0.34rem;
    display: inline-flex;
    align-items: center;
    gap: 0.16rem;
    min-width: 0;
    min-height: 1rem;
    font-variant-numeric: tabular-nums;
    transform: translateY(-50%);
  }

  .log-badge {
    display: inline-grid;
    place-items: center;
    min-width: 1rem;
    height: 1rem;
    padding: 0 0.18rem;
    border-radius: var(--ui-radius-xs);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    line-height: 1;
  }

  .log-badge.info {
    color: var(--ui-info);
    background: var(--ui-info-soft);
  }

  .log-badge.warn {
    color: var(--ui-warning);
    background: var(--ui-warning-soft);
  }

  .log-badge.error {
    color: var(--ui-danger);
    background: var(--ui-danger-soft);
  }

  .sidebar-footer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.42rem;
    min-height: 2rem;
    padding: 0.34rem 0.42rem 0.34rem 0.6rem;
    border-top: 1px solid var(--ui-shell-edge);
    color: var(--ui-text-tertiary);
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

  .workspace-path-static {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    max-width: 100%;
    min-width: 0;
    min-height: 1.45rem;
    padding: 0 0.22rem 0 0.28rem;
    overflow: hidden;
    color: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    line-height: 1;
  }

  .workspace-path-static span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-footer-button:hover,
  .sidebar-footer-button:focus-visible {
    outline: none;
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar-action-row,
    .sidebar-action-shortcut,
    .new-session-accordion,
    .session-section-resize::before {
      transition: none;
      animation: none;
    }
  }
</style>
