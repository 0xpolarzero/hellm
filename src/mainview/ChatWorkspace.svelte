<script lang="ts">
  import { onMount, tick } from "svelte";
  import { createHotkeys } from "@tanstack/svelte-hotkeys";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import PanelLeftDashedIcon from "@lucide/svelte/icons/panel-left-dashed";
  import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
  import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
  import type { AgentSettingsState, AppAppearance } from "../shared/agent-settings";
  import CommandPalette from "./CommandPalette.svelte";
  import DockviewWorkspace from "./DockviewWorkspace.svelte";
  import { formatTimestamp } from "./chat-format";
  import { getVisibleCommandRollups } from "./command-inspector";
  import {
    buildSurfaceContextBudget,
    type ContextBudget,
  } from "./context-budget";
  import {
    projectConversation,
    projectConversationSummary,
  } from "./conversation-projection";
  import {
    buildTranscriptSemanticBlocks,
    type TranscriptSemanticBlock,
  } from "./transcript-projection";
  import { buildSessionTranscriptExport } from "./session-transcript";
  import { getSurfaceDisplayTitle } from "./surface-title";
  import type {
    AppLogSummary,
    AgentModelChoice,
    WorkspaceHandlerThreadSummary,
    WorkspaceWorkflowTaskAttemptSummary,
    PromptTarget,
    WorkspacePaneSurfaceTarget,
    WorkspaceRequestUserInputRequest,
    WorkspaceRuntimeApprovalRequest,
    WorkspaceSessionNavigationReadModel,
    WorkspaceSessionSummary,
    WorkspaceSidebarHandlerThreadRow,
    WorkspaceSidebarWorkflowRow,
  } from "../shared/workspace-contract";
  import type { PromptHistoryEntry } from "./prompt-history";
  import {
    clampSidebarWidth,
    getMaxSidebarWidth,
    MIN_SIDEBAR_WIDTH,
  } from "./sidebar-layout";
  import {
    getViewportClass,
    isSidebarEffectivelyHidden,
    shouldUseNarrowShell,
    toggleSidebarVisibility as getNextSidebarVisibility,
  } from "./responsive-layout";
  import SessionSidebar from "./SessionSidebar.svelte";
  import {
    PRIMARY_CHAT_PANE_ID,
    type ChatRuntime,
    type ChatPaneLayoutState,
    type ChatPaneState,
    type ChatSurfaceController,
    type ComposerPromptSubmission,
  } from "./chat-runtime";
  import {
    createEmptyPaneLayout,
    getDockviewTabGroupPlacementTargets,
    getOpenPaneLocations,
    getSidebarPaneOpenTarget,
    getSidebarSessionOpenTarget,
    type PaneOpenTarget,
    type WorkspaceLayoutSlotId,
    type WorkspaceLayoutSlotSummary,
  } from "./pane-layout";
  import {
    buildCommandRegistry,
    executeCommandAction,
    executePaletteFallbackPrompt,
    filterCommandActions,
    getCommandExecutionPaneId,
    getCommandPaletteInitialInput,
    getCommandPalettePlacement,
    type CommandAction,
    type CommandPaletteMode,
  } from "./command-palette";
  import {
    getShortcutHotkey,
    getShortcutReadable,
    shouldShortcutIgnoreInputs,
    type AppMenuAction,
    type ShortcutActionId,
  } from "../shared/shortcut-registry";
  import ModelPickerDialog from "./ModelPickerDialog.svelte";
  import RequestUserInputPanel from "./RequestUserInputPanel.svelte";
  import RuntimeApprovalPanel from "./RuntimeApprovalPanel.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import { rpc } from "./rpc";
  import Input from "./ui/Input.svelte";
  import Tooltip from "./ui/Tooltip.svelte";
  import WorkspaceTabStrip, { type WorkspaceTabStripItem } from "./WorkspaceTabStrip.svelte";

  const DEFAULT_SIDEBAR_WIDTH = 240;

  type Props = {
    runtime: ChatRuntime;
    shortcutsEnabled?: boolean;
    onProviderAuthChanged?: (providerId: string) => void | Promise<void>;
    onAppAppearanceChanged?: (appearance: AppAppearance) => void;
    workspaceTabs?: WorkspaceTabStripItem[];
    activeWorkspaceTabId?: string | null;
    openingWorkspace?: boolean;
    openWorkspaceError?: string | null;
    knownWorkspaces?: WorkspaceTabStripItem["workspace"][];
    onSelectWorkspace?: (workspaceTabId: string) => void;
    onCloseWorkspace?: (workspaceTabId: string) => void;
    onOpenWorkspace?: () => void;
    onNewWorkspaceTab?: () => void;
    onOpenWorkspaceInNewTab?: () => void;
    onReorderWorkspace?: (workspaceTabId: string, beforeWorkspaceTabId: string | null) => void;
  };

  let {
    runtime,
    shortcutsEnabled = true,
    onProviderAuthChanged,
    onAppAppearanceChanged,
    workspaceTabs = [],
    activeWorkspaceTabId = null,
    openingWorkspace = false,
    openWorkspaceError = null,
    knownWorkspaces = [],
    onSelectWorkspace,
    onCloseWorkspace,
    onOpenWorkspace,
    onNewWorkspaceTab,
    onOpenWorkspaceInNewTab,
    onReorderWorkspace,
  }: Props = $props();
  const sidebarToggleShortcut = getShortcutReadable("sidebar.toggle");

  let messages = $state<ChatSurfaceController["agent"]["state"]["messages"]>([]);
  let streamMessage = $state<AssistantMessage | null>(null);
  let pendingToolCalls = $state(new Set<string>());
  let isStreaming = $state(false);
  let errorMessage = $state<string | undefined>(undefined);
  let currentModel = $state<Model<any> | null>(null);
  let currentThinkingLevel = $state<ThinkingLevel>("off");
  let showModelPicker = $state(false);
  let modelChoices = $state<AgentModelChoice[]>([]);
  let promptHistory = $state<PromptHistoryEntry[]>([]);
  let windowWidth = $state(typeof window === "undefined" ? 1024 : window.innerWidth);
  let isMacWindowChrome = $state(false);
  let sessions = $state<WorkspaceSessionSummary[]>([]);
  let workspaceBranch = $state<string | undefined>(undefined);
  let sessionNavigation = $state<WorkspaceSessionNavigationReadModel>({
    pinnedSessions: [],
    activeSessions: [],
    sections: {
      pinned: { collapsed: false, sizePx: 150 },
      active: { collapsed: false, sizePx: 260 },
      archived: { collapsed: true, sizePx: 190 },
    },
    archived: {
      collapsed: true,
      sessions: [],
    },
  });
  let appLogSummary = $state<AppLogSummary>({
    latestSeq: 0,
    seenSeq: 0,
    unread: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
    totals: { total: 0, debug: 0, info: 0, warn: 0, error: 0 },
  });
  let activeSessionId = $state<string | undefined>(undefined);
  let paneLayout = $state<ChatPaneLayoutState>({
    ...createEmptyPaneLayout(),
    focusedPanelId: PRIMARY_CHAT_PANE_ID,
  });
  let activeLayoutId = $state<WorkspaceLayoutSlotId>("A");
  let layoutSlots = $state<WorkspaceLayoutSlotSummary[]>([]);
  let layoutSlotsEnabled = $state(true);
  let currentPane = $state<ChatPaneState | null>(null);
  let focusedPanelId = $state(PRIMARY_CHAT_PANE_ID);
  let focusedSurfaceTarget = $state<PromptTarget | null>(null);
  let currentSurfaceController = $state<ChatSurfaceController | null>(null);
  let sidebarError = $state<string | undefined>(undefined);
  let sidebarHidden = $state(false);
  let narrowSidebarOpen = $state(false);
  let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
  let sidebarResizing = $state(false);
  let mutatingSession = $state(false);
  let sendingPrompt = $state(false);
  let renameTarget = $state<WorkspaceSessionSummary | null>(null);
  let renameValue = $state("");
  let sidebarResizeHandle = $state<HTMLDivElement | null>(null);
  let copyTranscriptState = $state<{
    panelId: string | null;
    status: "idle" | "copying" | "copied" | "error";
  }>({
    panelId: null,
    status: "idle",
  });
  let handlerThreads = $state<WorkspaceHandlerThreadSummary[]>([]);
  let handlerThreadsLoading = $state(false);
  let handlerThreadsError = $state<string | undefined>(undefined);
  let paletteOpen = $state(false);
  let paletteInitialInput = $state(getCommandPaletteInitialInput("commands"));
  let paletteError = $state<string | undefined>(undefined);
  let paletteBusy = $state(false);
  let workspaceMentionPaths = $state<ReadonlySet<string>>(new Set());
  let agentSettings = $state<AgentSettingsState | null>(null);
  let requestUserInputRequests = $state<WorkspaceRequestUserInputRequest[]>([]);
  let runtimeApprovalRequests = $state<WorkspaceRuntimeApprovalRequest[]>([]);

  let sidebarResizePointerId: number | null = null;
  let sidebarResizeOriginX = 0;
  let sidebarResizeOriginWidth = DEFAULT_SIDEBAR_WIDTH;
  let copyTranscriptResetTimer: ReturnType<typeof setTimeout> | null = null;
  let handlerThreadLoadToken = 0;
  let unsubscribeSurfaceController: (() => void) | null = null;

  const conversation = $derived(projectConversation(messages));
  const conversationSummary = $derived(projectConversationSummary(conversation, streamMessage));
  const viewportClass = $derived(getViewportClass(windowWidth));
  const narrowShell = $derived(shouldUseNarrowShell(windowWidth));
  const effectiveSidebarHidden = $derived(
    isSidebarEffectivelyHidden({ sidebarHidden, narrowShell, narrowSidebarOpen }),
  );
  const effectiveSidebarWidth = $derived(clampSidebarWidth(sidebarWidth, windowWidth));
  const currentSession = $derived(sessions.find((session) => session.id === activeSessionId) ?? null);
  const currentCommandRollups = $derived(getVisibleCommandRollups(currentSession));
  const currentSurface = $derived(focusedSurfaceTarget);
  type SidebarPaneTone = "neutral" | "waiting" | "error";
  type SidebarPaneLocation = {
    paneId: string;
    panelId: string;
    label: string;
    focused: boolean;
    tone: SidebarPaneTone;
    contextBudget: ContextBudget | null;
  };

  function getSidebarPaneTone(
    binding: WorkspacePaneSurfaceTarget | null | undefined,
    paneController: ChatSurfaceController | null,
  ): SidebarPaneTone {
    if (paneController?.agent.state.error) {
      return "error";
    }
    if (!binding?.workspaceSessionId) {
      return "neutral";
    }
    const session = sessions.find((candidate) => candidate.id === binding.workspaceSessionId);
    if (!session) {
      return "neutral";
    }
    if (binding.surface === "orchestrator") {
      if (session.status === "error") return "error";
      if (session.status === "waiting") return "waiting";
      return "neutral";
    }
    if (binding.surface === "thread") {
      const threadId = binding.threadId;
      if (threadId && session.threadIdsByStatus?.waiting.includes(threadId)) {
        return "waiting";
      }
    }
    return "neutral";
  }

  function buildSidebarPaneLocations(
    predicate: (binding: WorkspacePaneSurfaceTarget) => boolean,
  ): SidebarPaneLocation[] {
    return getOpenPaneLocations(paneLayout, predicate).flatMap((location) => {
      const panel = paneLayout.panels.find((candidate) => candidate.panelId === location.panelId);
      if (!panel?.binding) return [];
      const paneController = runtime.getPaneController(location.panelId);
      return {
        ...location,
        tone: getSidebarPaneTone(panel.binding, paneController),
        contextBudget: getPaneContextBudget(paneController),
      };
    });
  }

  const paneLocationsBySessionId = $derived(
    Object.fromEntries(
      sessions.map((session) => [
        session.id,
        buildSidebarPaneLocations(
          (binding) => binding.workspaceSessionId === session.id && binding.surface === "orchestrator",
        ),
      ]),
    ),
  );
  const paneLocationsByThreadId = $derived(
    Object.fromEntries(
      sessions.flatMap((session) =>
        (session.sidebarThreads ?? []).map((thread) => [
          thread.threadId,
          buildSidebarPaneLocations(
            (binding) =>
              binding.workspaceSessionId === session.id &&
              binding.surface === "thread" &&
              binding.threadId === thread.threadId,
          ),
        ]),
      ),
    ),
  );
  const paneLocationsByWorkflowRunId = $derived<Record<string, SidebarPaneLocation[]>>({});
  const currentSurfaceLabel = $derived.by(() => {
    if (currentSurface?.surface === "thread") {
      return `Messaging handler thread ${currentSurface.threadId ?? currentSurface.surfacePiSessionId}`;
    }

    return "Messaging orchestrator";
  });
  function formatPaneSurfaceLabel(
    paneController: ChatSurfaceController | null,
    binding?: WorkspacePaneSurfaceTarget | null,
  ): string {
    if (binding?.surface === "workflows") {
      return "Workflows";
    }
    if (binding?.surface === "agents") {
      return "Agents";
    }
    if (binding?.surface === "extensions") {
      return "Extensions";
    }
    if (binding?.surface === "snippets") {
      return "Snippets";
    }
    if (binding?.surface === "app-logs") {
      return "Logs";
    }
    if (binding?.surface === "command") {
      return "Command Inspector";
    }
    if (binding?.surface === "workflow-task-attempt") {
      return "Workflow Task-Agent";
    }
    if (binding?.surface === "artifact") {
      return "Artifact";
    }
    if (paneController?.target.surface === "thread") {
      return "Handler Thread";
    }
    return "Orchestrator";
  }
  function formatPaneAgentSummary(
    paneController: ChatSurfaceController | null,
    binding?: WorkspacePaneSurfaceTarget | null,
  ): string {
    if (binding?.surface === "workflows") {
      return "@svvy/workflows";
    }
    if (binding?.surface === "agents") {
      return "profiles";
    }
    if (binding?.surface === "extensions") {
      return "inventory";
    }
    if (binding?.surface === "snippets") {
      return "prompt macros";
    }
    if (binding?.surface === "app-logs") {
      return "workspace";
    }
    if (binding && binding.surface !== "orchestrator" && binding.surface !== "thread") {
      return binding.workspaceSessionId;
    }
    const model = paneController?.agent.state.model;
    const thinking = paneController?.agent.state.thinkingLevel;
    if (!model) return "No agent";
    return `${model.provider}/${model.id} · ${thinking}`;
  }
  function formatPaneLocationMetadata(
    binding?: WorkspacePaneSurfaceTarget | null,
  ): { label: string; value: string } {
    if (binding?.surface === "workflows") return { label: "surface", value: "workflows" };
    if (binding?.surface === "agents") return { label: "surface", value: "agents" };
    if (binding?.surface === "extensions") return { label: "surface", value: "extensions" };
    if (binding?.surface === "snippets") return { label: "surface", value: "snippets" };
    if (binding?.surface === "app-logs") return { label: "surface", value: "logs" };
    if (binding?.surface === "command") return { label: "surface", value: "command" };
    if (binding?.surface === "workflow-task-attempt") return { label: "surface", value: "task" };
    if (binding?.surface === "artifact") return { label: "surface", value: "artifact" };
    if (workspaceBranch) return { label: "worktree", value: workspaceBranch };
    return { label: "workspace", value: runtime.workspaceLabel };
  }
  function getPaneSurfaceStatus(
    paneController: ChatSurfaceController | null,
    binding?: WorkspacePaneSurfaceTarget | null,
  ): string {
    if (paneController?.agent.state.isStreaming || paneController?.promptStatus === "streaming") {
      return "running";
    }
    if (paneController?.agent.state.error) {
      return "failed";
    }
    if (binding?.surface && binding.surface !== "orchestrator" && binding.surface !== "thread") {
      return "active";
    }
    return "idle";
  }
  function getPaneContextBudget(paneController: ChatSurfaceController | null): ContextBudget | null {
    if (!paneController) return null;
    return buildSurfaceContextBudget(
      paneController.agent.state.messages,
      paneController.agent.state.model,
    );
  }
  const summaryMessageCount = $derived(conversationSummary.messageCount);
  const composerErrorMessage = $derived.by(() => {
    const message =
      errorMessage ?? (currentSession?.status === "error" ? currentSession.preview : undefined);
    if (!message) {
      return undefined;
    }

    return message;
  });
  const promptBusy = $derived(isStreaming || sendingPrompt);
  function getCopyTranscriptLabel(panelId: string): string {
    if (copyTranscriptState.panelId !== panelId) {
      return "Copy pane transcript";
    }
    switch (copyTranscriptState.status) {
      case "copying":
        return "Copying...";
      case "copied":
        return "Copied";
      case "error":
        return "Copy failed";
      default:
        return "Copy pane transcript";
    }
  }
  const showHandlerThreadPanel = $derived(
    currentSurface?.surface === "orchestrator" &&
      (handlerThreadsLoading || !!handlerThreadsError || handlerThreads.length > 0),
  );
  const transcriptSemanticBlocks = $derived(
    buildTranscriptSemanticBlocks({
      session: currentSession,
      errorMessage,
      commandRollups: currentCommandRollups,
      handlerThreads,
    }),
  );
  const showNewSessionEmptyState = $derived(
    currentSurface?.surface === "orchestrator" &&
      summaryMessageCount === 0 &&
      !streamMessage &&
      !isStreaming &&
      !errorMessage &&
      !showHandlerThreadPanel,
  );
  const recentSessionSuggestions = $derived(
    sessions.filter((session) => session.id !== activeSessionId).slice(0, 3),
  );
  const commandRegistry = $derived(
    buildCommandRegistry({
      sessions,
      workspaceKind: runtime.kind,
      focusedSessionId: activeSessionId,
      focusedPaneExists: !!runtime.paneLayout.focusedPanelId,
      focusedSurfaceTarget,
      paneTabGroups: getDockviewTabGroupPlacementTargets(runtime.paneLayout),
      orchestratorProfiles: agentSettings?.agents.orchestrators ?? [],
      handlerThreads,
    }),
  );
  const visibleCommandActions = $derived(filterCommandActions(commandRegistry, ""));
  const workspaceHotkeysEnabled = $derived(
    shortcutsEnabled &&
      !paletteOpen &&
      !renameTarget &&
      !showModelPicker,
  );

  createHotkeys(
    () => [
      {
        hotkey: getShortcutHotkey("workspace.open"),
        callback: () => onOpenWorkspace?.(),
        options: () => workspaceShortcutOptions("workspace.open"),
      },
      {
        hotkey: getShortcutHotkey("workspace.newTab"),
        callback: () => onNewWorkspaceTab?.(),
        options: () => workspaceShortcutOptions("workspace.newTab"),
      },
      {
        hotkey: getShortcutHotkey("workspace.openInNewTab"),
        callback: () => onOpenWorkspaceInNewTab?.(),
        options: () => workspaceShortcutOptions("workspace.openInNewTab"),
      },
      {
        hotkey: getShortcutHotkey("commandPalette.open"),
        callback: () => openPalette("commands"),
        options: () => workspaceShortcutOptions("commandPalette.open"),
      },
      {
        hotkey: getShortcutHotkey("quickOpen.open"),
        callback: () => openPalette("search"),
        options: () => workspaceShortcutOptions("quickOpen.open"),
      },
      {
        hotkey: getShortcutHotkey("session.new"),
        callback: () => void handleCreateSession(),
        options: () => workspaceShortcutOptions("session.new"),
      },
      {
        hotkey: getShortcutHotkey("session.newPane"),
        callback: () => void handleCreateSessionInNewPane(),
        options: () => workspaceShortcutOptions("session.newPane"),
      },
      {
        hotkey: getShortcutHotkey("sidebar.toggle"),
        callback: () => toggleSidebarVisibility(),
        options: () => workspaceShortcutOptions("sidebar.toggle"),
      },
      {
        hotkey: getShortcutHotkey("surface.logs.open"),
        callback: () => openAppLogs(),
        options: () => workspaceShortcutOptions("surface.logs.open"),
      },
      {
        hotkey: getShortcutHotkey("surface.workflows.open"),
        callback: () => openWorkflowsPane(),
        options: () => workspaceShortcutOptions("surface.workflows.open"),
      },
      {
        hotkey: getShortcutHotkey("surface.agents.open"),
        callback: () => openAgentsPane(),
        options: () => workspaceShortcutOptions("surface.agents.open"),
      },
      {
        hotkey: getShortcutHotkey("surface.extensions.open"),
        callback: () => openExtensionsPane(),
        options: () => workspaceShortcutOptions("surface.extensions.open"),
      },
    ],
    () => ({
      enabled: workspaceHotkeysEnabled,
      preventDefault: true,
      conflictBehavior: "replace",
    }),
  );

  function workspaceShortcutOptions(id: ShortcutActionId) {
    return {
      ignoreInputs: shouldShortcutIgnoreInputs(id),
    };
  }

  function clearCopyTranscriptResetTimer() {
    if (!copyTranscriptResetTimer) return;
    clearTimeout(copyTranscriptResetTimer);
    copyTranscriptResetTimer = null;
  }

  function scheduleCopyTranscriptReset() {
    clearCopyTranscriptResetTimer();
    copyTranscriptResetTimer = window.setTimeout(() => {
      copyTranscriptState = { panelId: null, status: "idle" };
      copyTranscriptResetTimer = null;
    }, 2400);
  }

  async function copyTextToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "true");
    fallback.style.position = "fixed";
    fallback.style.top = "0";
    fallback.style.left = "0";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();

    try {
      const copied = document.execCommand("copy");
      if (!copied) {
        throw new Error("Document copy command was rejected.");
      }
    } finally {
      document.body.removeChild(fallback);
    }
  }

  async function openModelSelector() {
    if (!currentModel) return;
    setTimeout(() => {
      showModelPicker = true;
    }, 0);
    modelChoices = runtime.agentModelChoicesSnapshot?.items ?? [];
    try {
      modelChoices = (await runtime.getAgentModelChoices()).items;
    } catch {
      modelChoices = [];
    }
  }

  function clampThinkingLevelForModel(choice: AgentModelChoice): ThinkingLevel {
    if (choice.supportedReasoning.includes(currentThinkingLevel)) {
      return currentThinkingLevel;
    }
    return choice.supportedReasoning.includes("medium")
      ? "medium"
      : (choice.supportedReasoning[0] ?? "off");
  }

  function getLatestAssistantFailureMessage(
    messagesSnapshot: ChatSurfaceController["agent"]["state"]["messages"],
  ): string | undefined {
    const lastMessage = messagesSnapshot[messagesSnapshot.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") return undefined;
    if (lastMessage.stopReason !== "error" && lastMessage.stopReason !== "aborted") return undefined;

    const message =
      lastMessage.errorMessage ??
      lastMessage.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

    return message || undefined;
  }

  function toggleSidebarVisibility() {
    const next = getNextSidebarVisibility({ sidebarHidden, narrowShell, narrowSidebarOpen });
    sidebarHidden = next.sidebarHidden;
    narrowSidebarOpen = next.narrowSidebarOpen;
  }

  function setSidebarResizing(nextValue: boolean) {
    sidebarResizing = nextValue;
    document.body.classList.toggle("sidebar-resizing", nextValue);
  }

  function startSidebarResize(event: PointerEvent) {
    if (effectiveSidebarHidden || narrowShell || !sidebarResizeHandle) return;
    event.preventDefault();

    sidebarResizePointerId = event.pointerId;
    sidebarResizeOriginX = event.clientX;
    sidebarResizeOriginWidth = effectiveSidebarWidth;
    sidebarResizeHandle.setPointerCapture(event.pointerId);
    setSidebarResizing(true);
  }

  function handleSidebarResizeMove(event: PointerEvent) {
    if (!sidebarResizing || sidebarResizePointerId !== event.pointerId) return;
    const delta = event.clientX - sidebarResizeOriginX;
    sidebarWidth = clampSidebarWidth(sidebarResizeOriginWidth + delta, windowWidth);
  }

  function stopSidebarResize(event?: PointerEvent) {
    if (event && sidebarResizePointerId !== event.pointerId) return;

    if (sidebarResizeHandle && sidebarResizePointerId !== null && sidebarResizeHandle.hasPointerCapture(sidebarResizePointerId)) {
      sidebarResizeHandle.releasePointerCapture(sidebarResizePointerId);
    }

    sidebarResizePointerId = null;
    setSidebarResizing(false);
  }

  async function runSessionMutation(
    action: () => Promise<void>,
    options: { rethrow?: boolean } = {},
  ) {
    if (mutatingSession) return;
    mutatingSession = true;
    sidebarError = undefined;

    try {
      await action();
      syncRuntimeState();
      resubscribeSurfaceController();
      syncSurfaceState();
    } catch (error) {
      sidebarError = error instanceof Error ? error.message : "Session update failed.";
      if (options.rethrow) {
        throw error;
      }
    } finally {
      mutatingSession = false;
    }
  }

  async function handleSwitchWorkspaceBranch(branch: string) {
    await runSessionMutation(() => runtime.switchWorkspaceBranch(branch), { rethrow: true });
  }

  async function refreshAgentSettings() {
    const snapshot = runtime.agentSettingsSnapshot;
    if (snapshot) {
      agentSettings = snapshot;
    }
    try {
      agentSettings = await runtime.getAgentSettings();
    } catch (error) {
      console.error("Failed to load agent settings:", error);
      agentSettings = null;
    }
  }

  async function handleSwitchLayout(layoutId: WorkspaceLayoutSlotId) {
    if (!layoutSlotsEnabled) return;
    await runSessionMutation(() => runtime.switchWorkspaceLayout(layoutId));
  }

  function openPalette(mode: CommandPaletteMode) {
    paletteInitialInput = getCommandPaletteInitialInput(mode);
    paletteError = undefined;
    paletteOpen = true;
  }

  function closePalette() {
    paletteOpen = false;
    paletteError = undefined;
    paletteBusy = false;
  }

  function handleAppMenuAction(action: AppMenuAction) {
    if (!shortcutsEnabled) return;
    switch (action) {
      case "commandPalette.open":
        openPalette("commands");
        return;
      case "quickOpen.open":
        openPalette("search");
        return;
      case "workspace.open":
        onOpenWorkspace?.();
        return;
      case "workspace.newTab":
        onNewWorkspaceTab?.();
        return;
      case "workspace.openInNewTab":
        onOpenWorkspaceInNewTab?.();
        return;
      case "session.new":
        void handleCreateSession();
        return;
      case "session.newPane":
        void handleCreateSessionInNewPane();
        return;
      case "sidebar.toggle":
        toggleSidebarVisibility();
        return;
      case "surface.logs.open":
        openAppLogs();
        return;
      case "surface.workflows.open":
        openWorkflowsPane();
        return;
      case "surface.agents.open":
        openAgentsPane();
        return;
      case "surface.extensions.open":
        openExtensionsPane();
        return;
    }
  }

  async function runPaletteMutation(action: () => Promise<void>) {
    if (paletteBusy) return;
    paletteBusy = true;
    paletteError = undefined;
    sidebarError = undefined;
    try {
      await action();
      syncRuntimeState();
      resubscribeSurfaceController();
      syncSurfaceState();
      closePalette();
    } catch (error) {
      paletteError = error instanceof Error ? error.message : "Command failed.";
    } finally {
      paletteBusy = false;
    }
  }

  async function handlePaletteExecute(action: CommandAction, event: KeyboardEvent | MouseEvent) {
    const placement = getCommandPalettePlacement(event);
    window.setTimeout(
      () =>
        void runPaletteMutation(() => {
          const panelId =
            action.category === "pane"
              ? (runtime.paneLayout.focusedPanelId ?? focusedPanelId)
              : getCommandExecutionPaneId({
                  placement,
                  focusedPanelId: runtime.paneLayout.focusedPanelId ?? focusedPanelId,
                });
          return executeCommandAction({
            runtime,
            action,
            panelId,
            onWorkspaceAction: (workspaceAction) => {
              if (workspaceAction === "open") onOpenWorkspace?.();
              if (workspaceAction === "new-tab") onNewWorkspaceTab?.();
              if (workspaceAction === "open-in-new-tab") onOpenWorkspaceInNewTab?.();
            },
            onOpenWorkflowTaskAttempt: ({ workspaceSessionId, workflowTaskAttemptId }) =>
              handleInspectWorkflowTaskAttempt({ workflowTaskAttemptId }, workspaceSessionId),
          });
        }),
      0,
    );
  }

  async function handlePaletteFallbackPrompt(prompt: string, event: KeyboardEvent) {
    const panelId = getCommandExecutionPaneId({
      placement: getCommandPalettePlacement(event),
      focusedPanelId,
    });
    window.setTimeout(
      () =>
        void runPaletteMutation(async () => {
          await executePaletteFallbackPrompt({
            runtime,
            prompt,
            panelId,
            onCreatedTarget: async (target) => {
              await runtime.storage.promptHistory.append({
                text: prompt.trim(),
                sentAt: Date.now(),
                workspaceId: runtime.workspaceId,
                sessionId: target.workspaceSessionId,
              });
            },
          });
          promptHistory = await runtime.storage.promptHistory.list(runtime.workspaceId);
        }),
      0,
    );
  }

  function getNewSessionOpenTarget(event?: Pick<MouseEvent, "metaKey">): PaneOpenTarget {
    return event?.metaKey ? { kind: "new-panel", direction: "right" } : { kind: "focused-panel" };
  }

  async function handleCreateSession(event?: MouseEvent, agentProfileId?: string) {
    await runSessionMutation(() =>
      runtime.createSession(
        agentProfileId ? { agentProfileId } : {},
        getNewSessionOpenTarget(event),
      ),
    );
    await focusComposerForPanel(runtime.paneLayout.focusedPanelId);
  }

  async function handleCreateSessionInNewPane() {
    await runSessionMutation(() => runtime.createSession({}, { kind: "new-panel", direction: "right" }));
    await focusComposerForPanel(runtime.paneLayout.focusedPanelId);
  }

  async function focusComposerForPanel(panelId: string | null | undefined) {
    if (!panelId) return;
    await tick();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const pane = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="workspace-pane"]')).find(
      (candidate) => candidate.dataset.panelId === panelId,
    );
    pane?.querySelector<HTMLTextAreaElement>(".composer-shell textarea")?.focus({ preventScroll: true });
  }

  async function handleOpenSession(sessionId: string, event?: MouseEvent) {
    if (
      !event?.metaKey &&
      sessionId === activeSessionId &&
      currentSurface?.surface === "orchestrator" &&
      currentSurface.workspaceSessionId === sessionId
    ) {
      return;
    }
    await runSessionMutation(() => runtime.openSession(sessionId, getSidebarSessionOpenTarget(event)));
  }

  function handleRenameSession(session: WorkspaceSessionSummary) {
    if (session.titleGeneration?.renameLocked) {
      sidebarError = "Session title is being generated. Rename is temporarily locked.";
      return;
    }
    renameTarget = session;
    renameValue = session.title;
  }

  async function handleDeleteSession(session: WorkspaceSessionSummary) {
    await runSessionMutation(() => runtime.deleteSession(session.id));
  }

  async function confirmRename() {
    if (!renameTarget) return;
    const target = renameTarget;
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      sidebarError = "Session title cannot be empty.";
      return;
    }

    await runSessionMutation(async () => {
      await runtime.renameSession(target.id, nextTitle);
      renameTarget = null;
      renameValue = "";
    });
  }

  async function handleResetSurfaceTarget() {
    const session = currentSession;
    if (!session) {
      return;
    }
    await runSessionMutation(() => runtime.openSession(session.id, { kind: "focused-panel" }));
  }

  async function handleFocusPane(panelId: string) {
    runtime.focusPane(panelId);
    syncRuntimeState();
    resubscribeSurfaceController();
    syncSurfaceState();
  }

  async function handleOpenPaneModelPicker(panelId: string) {
    await handleFocusPane(panelId);
    await openModelSelector();
  }

  function handleTranscriptScrollState(panelId: string, scroll: { transcriptAnchorId: string | null; offsetPx: number }) {
    runtime.setPaneScroll(panelId, scroll);
  }

  async function handlePinSession(session: WorkspaceSessionSummary) {
    await runSessionMutation(() => runtime.pinSession(session.id));
  }

  async function handleUnpinSession(session: WorkspaceSessionSummary) {
    await runSessionMutation(() => runtime.unpinSession(session.id));
  }

  async function handleArchiveSession(session: WorkspaceSessionSummary) {
    await runSessionMutation(() => runtime.archiveSession(session.id));
  }

  async function handleUnarchiveSession(session: WorkspaceSessionSummary) {
    await runSessionMutation(() => runtime.unarchiveSession(session.id));
  }

  async function handleMarkSessionUnread(session: WorkspaceSessionSummary) {
    await runSessionMutation(() => runtime.markSessionUnread(session.id));
  }

  async function handleMarkSessionRead(session: WorkspaceSessionSummary) {
    await runSessionMutation(() => runtime.markSessionRead(session.id));
  }

  async function handleToggleArchivedGroup(collapsed: boolean) {
    await runSessionMutation(() => runtime.setArchivedGroupCollapsed(collapsed));
  }

  async function handleUpdateSessionNavigationSectionState(
    section: "pinned" | "active" | "archived",
    state: { collapsed?: boolean; sizePx?: number },
  ) {
    if (typeof state.sizePx === "number" && typeof state.collapsed !== "boolean") {
      sidebarError = undefined;
      try {
        await runtime.setSessionNavigationSectionState(section, state);
        syncRuntimeState();
      } catch (error) {
        sidebarError = error instanceof Error ? error.message : "Session update failed.";
        throw error;
      }
      return;
    }

    await runSessionMutation(() => runtime.setSessionNavigationSectionState(section, state));
  }

  async function handleSend(input: ComposerPromptSubmission): Promise<boolean> {
    return handleSendToPane(focusedPanelId, input);
  }

  async function handleSendToPane(panelId: string, input: ComposerPromptSubmission): Promise<boolean> {
    const surface = runtime.getPaneController(panelId);
    if ((!input.text.trim() && input.attachments.length === 0) || !surface || surface.promptStatus === "streaming" || sendingPrompt) return false;

    sendingPrompt = true;
    try {
      if (panelId !== focusedPanelId) {
        await runtime.focusPane(panelId);
        syncRuntimeState();
        resubscribeSurfaceController();
        syncSurfaceState();
      }

      const hasProviderAccess = await runtime.requireProviderAccess(surface.agent.state.model.provider);
      if (!hasProviderAccess) {
        const text = input.text.trim();
        if (text) {
          try {
            const entry = await runtime.storage.promptHistory.append({
              text,
              sentAt: Date.now(),
              workspaceId: runtime.workspaceId,
              sessionId: surface.target.workspaceSessionId,
            });
            promptHistory = [...promptHistory, entry];
          } catch (error) {
            console.error("Failed to persist prompt history:", error);
          }
        }
        return false;
      }

      await surface.sendPrompt(input);
      promptHistory = await runtime.storage.promptHistory.list(runtime.workspaceId);
      return true;
    } finally {
      sendingPrompt = false;
    }
  }

  async function handleOpenWorkspacePath(path: string) {
    try {
      const opened = await runtime.openWorkspacePath(path);
      if (!opened) {
        await copyTextToClipboard(path);
      }
    } catch (error) {
      console.error("Failed to open workspace path:", error);
      await copyTextToClipboard(path);
    }
  }

  async function handleCopyPaneTranscript(panelId: string) {
    if (copyTranscriptState.status === "copying") return;

    const paneController = runtime.getPaneController(panelId);
    const agent = paneController?.agent;
    const activeModel = agent?.state.model;
    if (!paneController || !agent || !activeModel) {
      return;
    }
    const session =
      sessions.find((candidate) => candidate.id === paneController.target.workspaceSessionId) ??
      currentSession;
    const exportText = buildSessionTranscriptExport({
      session: {
        id: session?.id ?? agent.sessionId ?? "unknown-session",
        title: getSurfaceDisplayTitle(
          paneController.target,
          sessions,
          session?.title ?? "New orchestrator",
        ),
        status: session?.status ?? "idle",
        createdAt: session?.createdAt ?? new Date(0).toISOString(),
        updatedAt: session?.updatedAt ?? new Date().toISOString(),
      },
      target:
        paneController.target ?? {
          workspaceSessionId: session?.id ?? "unknown-session",
          surface: "orchestrator",
          surfacePiSessionId: agent.sessionId ?? "unknown-surface",
        },
      provider: activeModel.provider,
      model: activeModel.id,
      reasoningEffort: agent.state.thinkingLevel,
      systemPrompt: paneController.resolvedSystemPrompt,
      messages: agent.state.messages,
      streamMessage: agent.state.streamMessage?.role === "assistant" ? agent.state.streamMessage : null,
    });

    copyTranscriptState = { panelId, status: "copying" };

    try {
      await copyTextToClipboard(exportText);
      copyTranscriptState = { panelId, status: "copied" };
      scheduleCopyTranscriptReset();
    } catch (error) {
      console.error("Failed to copy transcript:", error);
      copyTranscriptState = { panelId, status: "error" };
      scheduleCopyTranscriptReset();
    }
  }

  function openWorkflowsPane(event?: MouseEvent): void {
    void runtime.openSurface(
      {
        surface: "workflows",
      },
      getSidebarPaneOpenTarget(event),
    );
  }

  function openAgentsPane(event?: MouseEvent): void {
    void runtime.openSurface(
      {
        surface: "agents",
      },
      getSidebarPaneOpenTarget(event),
    );
  }

  function openAgentProfile(agentProfileId: string): void {
    void runtime.openSurface(
      {
        surface: "agents",
        targetAgentProfileId: agentProfileId,
      },
      { kind: "focused-panel" },
    );
  }

  function openExtensionsPane(event?: MouseEvent): void {
    void runtime.openSurface(
      {
        surface: "extensions",
      },
      getSidebarPaneOpenTarget(event),
    );
  }

  function openSnippetsPane(event?: MouseEvent): void {
    void runtime.openSurface(
      {
        surface: "snippets",
      },
      getSidebarPaneOpenTarget(event),
    );
  }

  function openSettingsPane(event?: MouseEvent): void {
    void runtime.openSurface(
      {
        surface: "settings",
      },
      getSidebarPaneOpenTarget(event),
    );
  }

  function openAppLogs(event?: MouseEvent): void {
    void runtime.openSurface(
      {
        surface: "app-logs",
      },
      getSidebarPaneOpenTarget(event),
    );
    void runtime.markAppLogsSeen(runtime.appLogSummary.latestSeq);
  }

  function handleOpenHandlerThread(
    thread: Pick<WorkspaceHandlerThreadSummary, "threadId" | "surfacePiSessionId">,
  ) {
    const session = currentSession;
    if (!session) {
      return;
    }

    void runSessionMutation(() =>
      runtime.openSurface(
        {
          workspaceSessionId: session.id,
          surface: "thread",
          surfacePiSessionId: thread.surfacePiSessionId,
          threadId: thread.threadId,
        },
        { kind: "new-panel", direction: "right" },
      ),
    );
  }

  function handleOpenSidebarHandlerThread(
    sessionId: string,
    thread: Pick<WorkspaceSidebarHandlerThreadRow, "threadId" | "surfacePiSessionId">,
    event?: MouseEvent,
  ) {
    void runSessionMutation(() =>
      runtime.openSurface(
        {
          workspaceSessionId: sessionId,
          surface: "thread",
          surfacePiSessionId: thread.surfacePiSessionId,
          threadId: thread.threadId,
        },
        getSidebarPaneOpenTarget(event),
      ),
    );
  }

  function handleOpenSidebarWorkflowRun(
    sessionId: string,
    workflow: Pick<WorkspaceSidebarWorkflowRow, "workflowRunId">,
    event?: MouseEvent,
  ) {
    void sessionId;
    void workflow;
    openWorkflowsPane(event);
  }

  async function sendPromptToHandlerThread(
    thread: Pick<WorkspaceHandlerThreadSummary, "threadId" | "surfacePiSessionId">,
    prompt: string,
  ) {
    const session = currentSession;
    if (!session) {
      return;
    }

    const target = {
      workspaceSessionId: session.id,
      surface: "thread" as const,
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.threadId,
    };

    await runSessionMutation(async () => {
      await runtime.openSurface(target, focusedPanelId);
      await runtime.sendPromptToTarget(target, prompt);
    });
  }

  async function handleReplyToWait(
    block: TranscriptSemanticBlock & { kind: "wait" },
    text: string,
  ) {
    const targetThread = block.threadId
      ? handlerThreads.find((thread) => thread.threadId === block.threadId)
      : null;

    if (targetThread) {
      await sendPromptToHandlerThread(targetThread, text);
      return;
    }

    const target = currentSurfaceController?.target;
    if (!target) {
      return;
    }

    await runSessionMutation(() => runtime.sendPromptToTarget(target, text));
  }

  async function handleAnswerRequestUserInput(
    request: Parameters<ChatRuntime["answerRequestUserInput"]>[0],
  ) {
    await runSessionMutation(() => runtime.answerRequestUserInput(request), { rethrow: true });
  }

  async function handleSetRequestUserInputTimerPaused(
    request: Parameters<ChatRuntime["setRequestUserInputTimerPaused"]>[0],
  ) {
    await runSessionMutation(() => runtime.setRequestUserInputTimerPaused(request), {
      rethrow: true,
    });
  }

  async function handleOpenRequestUserInputOwner(request: WorkspaceRequestUserInputRequest) {
    await runSessionMutation(() => {
      if (request.threadId) {
        return runtime.openSurface(
          {
            workspaceSessionId: request.workspaceSessionId,
            surface: "thread",
            surfacePiSessionId: request.surfacePiSessionId,
            threadId: request.threadId,
          },
          { kind: "focused-panel" },
        );
      }
      return runtime.openSession(request.workspaceSessionId, { kind: "focused-panel" });
    });
  }

  async function handleAnswerRuntimeApproval(
    request: Parameters<ChatRuntime["answerRuntimeApprovalRequest"]>[0],
  ) {
    await runSessionMutation(() => runtime.answerRuntimeApprovalRequest(request), {
      rethrow: true,
    });
  }

  async function handleOpenRuntimeApprovalOwner(request: WorkspaceRuntimeApprovalRequest) {
    await runSessionMutation(() => {
      if (request.threadId) {
        return runtime.openSurface(
          {
            workspaceSessionId: request.workspaceSessionId,
            surface: "thread",
            surfacePiSessionId: request.surfacePiSessionId,
            threadId: request.threadId,
          },
          { kind: "focused-panel" },
        );
      }
      return runtime.openSession(request.workspaceSessionId, { kind: "focused-panel" });
    });
  }

  async function handleRetryFailure(block: TranscriptSemanticBlock & { kind: "failure" }) {
    const target = currentSurfaceController?.target;
    if (!target) {
      return;
    }

    await runSessionMutation(() =>
      runtime.sendPromptToTarget(
        target,
        `Retry the failed turn and address this failure:\n\n${block.summary}`,
      ),
    );
  }

  function handleInspectWorkflowTaskAttempt(
    workflowTaskAttempt: Pick<WorkspaceWorkflowTaskAttemptSummary, "workflowTaskAttemptId">,
    sessionId = currentSession?.id,
  ): void {
    if (!sessionId) return;
    void runtime.openSurface(
      {
        workspaceSessionId: sessionId,
        surface: "workflow-task-attempt",
        workflowTaskAttemptId: workflowTaskAttempt.workflowTaskAttemptId,
      },
      { kind: "split", panelId: focusedPanelId, direction: "right" },
    );
  }

  $effect(() => {
    const session = currentSession;
    const surface = currentSurface?.surface;
    if (!session || surface !== "orchestrator") {
      handlerThreads = [];
      handlerThreadsError = undefined;
      handlerThreadsLoading = false;
      return;
    }

    const loadToken = ++handlerThreadLoadToken;
    handlerThreadsLoading = true;
    handlerThreadsError = undefined;
    void runtime
      .listHandlerThreads(session.id)
      .then((nextThreads) => {
        if (loadToken !== handlerThreadLoadToken) {
          return;
        }

        handlerThreads = nextThreads;
      })
      .catch((error) => {
        if (loadToken !== handlerThreadLoadToken) {
          return;
        }

        handlerThreadsError =
          error instanceof Error ? error.message : "Unable to load delegated handler threads.";
        handlerThreads = [];
      })
      .finally(() => {
        if (loadToken === handlerThreadLoadToken) {
          handlerThreadsLoading = false;
        }
      });
  });

  function syncSurfaceState() {
    const surface = currentSurfaceController;
    if (!surface) {
      messages = [];
      streamMessage = null;
      pendingToolCalls = new Set();
      isStreaming = false;
      errorMessage = undefined;
      currentModel = null;
      currentThinkingLevel = "off";
      return;
    }

    const nextMessages = [...surface.agent.state.messages];
    messages = nextMessages;
    streamMessage =
      surface.agent.state.streamMessage?.role === "assistant"
        ? surface.agent.state.streamMessage
        : null;
    pendingToolCalls = new Set(surface.agent.state.pendingToolCalls);
    isStreaming = surface.agent.state.isStreaming || surface.promptStatus === "streaming";
    errorMessage = surface.agent.state.error ?? getLatestAssistantFailureMessage(nextMessages);
    currentModel = surface.agent.state.model;
    currentThinkingLevel = surface.agent.state.thinkingLevel as ThinkingLevel;
  }

  function syncRuntimeState() {
    sessions = [...runtime.sessions];
    workspaceBranch = runtime.branch;
    sessionNavigation = runtime.sessionNavigation;
    appLogSummary = runtime.appLogSummary;
    agentSettings = runtime.agentSettingsSnapshot ?? agentSettings;
    paneLayout = runtime.paneLayout;
    activeLayoutId = runtime.activeLayoutId;
    layoutSlots = runtime.layoutSlots;
    layoutSlotsEnabled = runtime.layoutSlotsEnabled;
    requestUserInputRequests = runtime.getRequestUserInputRequests();
    runtimeApprovalRequests = runtime.getRuntimeApprovalRequests();
    focusedPanelId = paneLayout.focusedPanelId ?? PRIMARY_CHAT_PANE_ID;
    currentPane = runtime.getPane(focusedPanelId) ?? null;
    focusedSurfaceTarget = currentPane?.target ?? null;
    activeSessionId = currentPane?.target?.workspaceSessionId;
    currentSurfaceController = runtime.getPaneController(focusedPanelId);
  }

  function resubscribeSurfaceController() {
    unsubscribeSurfaceController?.();
    unsubscribeSurfaceController = null;
    if (!currentSurfaceController) {
      syncSurfaceState();
      return;
    }

    unsubscribeSurfaceController = currentSurfaceController.subscribe(() => {
      focusedSurfaceTarget = currentSurfaceController?.target ?? null;
      activeSessionId = currentSurfaceController?.target.workspaceSessionId;
      syncSurfaceState();
    });
  }

  syncRuntimeState();
  syncSurfaceState();

  onMount(() => {
    windowWidth = window.innerWidth;
    isMacWindowChrome = navigator.platform.toLowerCase().includes("mac");
    const handleResize = () => {
      windowWidth = window.innerWidth;
    };
    const handleAppMenuMessage = ({ action }: { action: AppMenuAction }) => {
      handleAppMenuAction(action);
    };
    window.addEventListener("resize", handleResize);
    const unsubscribeAppMenuAction = runtime.subscribeAppMenuAction(handleAppMenuMessage);

    void runtime.storage.promptHistory
      .list(runtime.workspaceId)
      .then((entries) => {
        promptHistory = entries;
      })
      .catch((error) => {
        console.error("Failed to load prompt history:", error);
      });
    void runtime
      .listWorkspacePaths()
      .then((paths) => {
        workspaceMentionPaths = new Set(paths.map((path) => path.workspaceRelativePath));
      })
      .catch((error) => {
        console.error("Failed to load workspace mention paths:", error);
      });
    void refreshAgentSettings();

    const unsubscribeRuntime = runtime.subscribe(() => {
      syncRuntimeState();
      resubscribeSurfaceController();
      syncSurfaceState();
    });
    resubscribeSurfaceController();

    return () => {
      unsubscribeRuntime();
      unsubscribeSurfaceController?.();
      setSidebarResizing(false);
      clearCopyTranscriptResetTimer();
      window.removeEventListener("resize", handleResize);
      unsubscribeAppMenuAction();
    };
  });
</script>

<div class={`workspace-shell ${isMacWindowChrome ? "mac-window-chrome" : ""}`.trim()} style={`--sidebar-width: ${effectiveSidebarWidth}px;`}>
  <header
    class={`workspace-titlebar electrobun-webkit-app-region-drag viewport-${viewportClass} ${effectiveSidebarHidden ? "sidebar-titlebar-hidden" : ""}`.trim()}
  >
    <div class="workspace-titlebar-start">
      <Tooltip
        class="electrobun-webkit-app-region-no-drag"
        label={effectiveSidebarHidden ? "Show sidebar" : "Hide sidebar"}
        shortcut={sidebarToggleShortcut}
        side="bottom"
      >
        <button
          class="titlebar-icon electrobun-webkit-app-region-no-drag"
          type="button"
          aria-pressed={!effectiveSidebarHidden}
          aria-label={effectiveSidebarHidden ? "Show sidebar" : "Hide sidebar"}
          onclick={toggleSidebarVisibility}
        >
          <span class="titlebar-icon-glyph">
            {#if effectiveSidebarHidden}
              <PanelLeftDashedIcon aria-hidden="true" size={14} strokeWidth={1.85} />
            {:else}
              <PanelLeftIcon aria-hidden="true" size={14} strokeWidth={1.85} />
            {/if}
          </span>
        </button>
      </Tooltip>
      <p class="workspace-titlebar-title">svvy</p>
    </div>
    <div class="workspace-titlebar-tabs">
      <WorkspaceTabStrip
        tabs={workspaceTabs}
        {activeWorkspaceTabId}
        {openingWorkspace}
        onSelectWorkspace={(workspaceTabId) => onSelectWorkspace?.(workspaceTabId)}
        onCloseWorkspace={(workspaceTabId) => onCloseWorkspace?.(workspaceTabId)}
        onNewWorkspaceTab={() => onNewWorkspaceTab?.()}
        onReorderWorkspace={(workspaceTabId, beforeWorkspaceTabId) =>
          onReorderWorkspace?.(workspaceTabId, beforeWorkspaceTabId)}
      />
    </div>
    <div class="workspace-titlebar-actions electrobun-webkit-app-region-no-drag">
      <div class="workspace-main-meta" role="toolbar" aria-label="Workspace actions"></div>
      <div class="workspace-layout-switcher" role="tablist" aria-label="Workspace layouts">
        {#each layoutSlots as slot (slot.id)}
          <Tooltip
            label={
              layoutSlotsEnabled
                ? `Layout ${slot.id}: ${slot.initialized ? "switch to this saved pane arrangement" : "start a new pane arrangement"}`
                : "Layout slots are unavailable in the default workspace"
            }
            side="bottom"
          >
            <button
              type="button"
              role="tab"
              aria-label={
                layoutSlotsEnabled
                  ? `Layout ${slot.id}: ${slot.initialized ? "switch to this saved pane arrangement" : "start a new pane arrangement"}`
                  : `Layout ${slot.id}: unavailable in the default workspace`
              }
              aria-selected={slot.id === activeLayoutId}
              disabled={!layoutSlotsEnabled}
              class={`workspace-layout-tab ${slot.id === activeLayoutId ? "active" : ""} ${slot.initialized ? "initialized" : "empty"} ${layoutSlotsEnabled ? "" : "disabled"}`.trim()}
              onclick={() => void handleSwitchLayout(slot.id)}
            >
              {slot.id}
            </button>
          </Tooltip>
        {/each}
      </div>
    </div>
  </header>

  <div
    class={`chat-workspace ${effectiveSidebarHidden ? "sidebar-hidden" : ""} ${requestUserInputRequests.length > 0 ? "has-request-input" : ""} viewport-${viewportClass}`.trim()}
    style={`--sidebar-width: ${effectiveSidebarWidth}px;`}
  >
    <aside class="workspace-sidebar" aria-hidden={effectiveSidebarHidden} inert={effectiveSidebarHidden}>
      <div class="sidebar-surface">
        <SessionSidebar
          workspaceLabel={runtime.workspaceLabel}
          {workspaceBranch}
          navigation={sessionNavigation}
          {activeSessionId}
          activeOrchestratorSessionId={currentSurface?.surface === "orchestrator" ? activeSessionId : undefined}
          activeThreadId={currentSurface?.threadId}
          {paneLocationsBySessionId}
          {paneLocationsByThreadId}
          {paneLocationsByWorkflowRunId}
          {appLogSummary}
          busy={mutatingSession}
          errorMessage={sidebarError}
          orchestratorProfiles={agentSettings?.agents.orchestrators ?? []}
          onCreateSession={handleCreateSession}
          onOpenSession={handleOpenSession}
          onOpenHandlerThread={handleOpenSidebarHandlerThread}
          onOpenWorkflowRun={handleOpenSidebarWorkflowRun}
          onRenameSession={handleRenameSession}
          onPinSession={handlePinSession}
          onUnpinSession={handleUnpinSession}
          onArchiveSession={handleArchiveSession}
          onUnarchiveSession={handleUnarchiveSession}
          onDeleteSession={handleDeleteSession}
          onMarkSessionUnread={handleMarkSessionUnread}
          onMarkSessionRead={handleMarkSessionRead}
          onToggleArchivedGroup={handleToggleArchivedGroup}
          onUpdateSessionNavigationSectionState={handleUpdateSessionNavigationSectionState}
          onOpenSearch={() => openPalette("search")}
          onOpenCommandPalette={() => openPalette("commands")}
          onOpenAppLogs={openAppLogs}
          onOpenWorkflowLibrary={openWorkflowsPane}
          onOpenAgents={openAgentsPane}
          onOpenExtensions={openExtensionsPane}
          onOpenSnippets={openSnippetsPane}
          onOpenSettings={openSettingsPane}
          onListWorkspaceBranches={runtime.listWorkspaceBranches}
          onSwitchWorkspaceBranch={handleSwitchWorkspaceBranch}
        />
      </div>
    </aside>

    {#if !effectiveSidebarHidden && !narrowShell}
      <div
        bind:this={sidebarResizeHandle}
        class={`sidebar-resize-handle ${sidebarResizing ? "dragging" : ""}`.trim()}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session sidebar"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={getMaxSidebarWidth(windowWidth)}
        aria-valuenow={effectiveSidebarWidth}
        onpointerdown={startSidebarResize}
        onpointermove={handleSidebarResizeMove}
        onpointerup={stopSidebarResize}
        onpointercancel={stopSidebarResize}
        onlostpointercapture={() => stopSidebarResize()}
      ></div>
    {/if}

    <section class="workspace-main">
      <header class="workspace-main-header" aria-hidden="true"></header>
      <DockviewWorkspace
        {runtime}
        panels={paneLayout.panels}
        dockviewLayout={paneLayout.dockview}
        focusedPanelId={focusedPanelId}
        {openingWorkspace}
        openWorkspaceError={openWorkspaceError}
        recentWorkspaces={knownWorkspaces}
        {agentSettings}
        onFocusPanel={(panelId) => void handleFocusPane(panelId)}
        onOpenModelPicker={(panelId) => void handleOpenPaneModelPicker(panelId)}
        onAgentSettingsChanged={(settings) => (agentSettings = settings)}
        {onProviderAuthChanged}
        {onAppAppearanceChanged}
        onOpenWorkspace={() => onOpenWorkspace?.()}
        onOpenWorkspaceInNewTab={() => onOpenWorkspaceInNewTab?.()}
        onOpenAgentProfile={openAgentProfile}
        onPersistDockview={(dockview, panelId) => runtime.setDockviewLayout(dockview, panelId)}
      />
    </section>

    {#if requestUserInputRequests.length > 0}
      <RequestUserInputPanel
        requests={requestUserInputRequests}
        onAnswer={handleAnswerRequestUserInput}
        onSetTimerPaused={handleSetRequestUserInputTimerPaused}
        onOpenOwner={(request) => void handleOpenRequestUserInputOwner(request)}
      />
    {/if}

    {#if runtimeApprovalRequests.length > 0}
      <RuntimeApprovalPanel
        requests={runtimeApprovalRequests}
        onAnswer={handleAnswerRuntimeApproval}
        onOpenOwner={(request) => void handleOpenRuntimeApprovalOwner(request)}
      />
    {/if}

  </div>

</div>

<CommandPalette
  open={paletteOpen}
  initialInput={paletteInitialInput}
  actions={visibleCommandActions}
  busy={paletteBusy}
  errorMessage={paletteError}
  onClose={closePalette}
  onExecute={(action, event) => void handlePaletteExecute(action, event)}
  onFallbackPrompt={(prompt, event) => void handlePaletteFallbackPrompt(prompt, event)}
/>

{#if showModelPicker}
  <ModelPickerDialog
    currentModel={currentModel}
    {modelChoices}
    onClose={() => (showModelPicker = false)}
    onSelect={(model, choice) => {
      const nextThinkingLevel = clampThinkingLevelForModel(choice);
      currentModel = model;
      currentSurfaceController?.agent.setModel(model);
      if (nextThinkingLevel !== currentThinkingLevel) {
        currentThinkingLevel = nextThinkingLevel;
        currentSurfaceController?.agent.setThinkingLevel(nextThinkingLevel);
      }
      showModelPicker = false;
    }}
  />
{/if}

{#if renameTarget}
  <Dialog
    eyebrow="Session"
    title="Rename Session"
    description="Update the durable session name used throughout the workspace navigator."
    width="md"
    onClose={() => {
      renameTarget = null;
      renameValue = "";
    }}
  >
    <div class="session-dialog">
      <Input bind:value={renameValue} placeholder="Session title" />
      <div class="session-dialog-actions">
        <Button variant="ghost" size="sm" onclick={() => {
          renameTarget = null;
          renameValue = "";
        }}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onclick={() => void confirmRename()} disabled={mutatingSession}>
          Save
        </Button>
      </div>
    </div>
  </Dialog>
{/if}

<style>
  .workspace-shell {
    --mac-traffic-light-top: 13px;
    --mac-traffic-light-size: 16px;
    --workspace-chrome-height: calc((var(--mac-traffic-light-top) * 2) + var(--mac-traffic-light-size));
    --workspace-chrome-control-size: 28px;
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    margin-inline: 0;
    background: var(--ui-chrome);
  }

  .workspace-titlebar {
    --titlebar-inline-padding: 0.72rem;
    --mac-titlebar-control-offset: 5.25rem;
    --workspace-titlebar-start-width: var(--sidebar-width, 240px);
    position: absolute;
    top: 0;
    left: 0;
    z-index: 12;
    display: grid;
    grid-template-columns: var(--workspace-titlebar-start-width) minmax(0, 1fr) max-content;
    align-items: center;
    column-gap: 0;
    width: 100%;
    height: var(--workspace-chrome-height);
    padding: 0 var(--titlebar-inline-padding) 0 0;
    border: 0;
    background: transparent;
    pointer-events: auto;
    transition: width 230ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .workspace-titlebar.sidebar-titlebar-hidden {
    width: 100%;
    --workspace-titlebar-start-width: 7.25rem;
  }

  .workspace-shell.mac-window-chrome .workspace-titlebar {
    padding-left: 0;
  }

  .workspace-titlebar-start {
    display: flex;
    align-items: center;
    gap: 0.48rem;
    width: var(--workspace-titlebar-start-width);
    min-width: 7.25rem;
    transition: width 230ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .workspace-shell.mac-window-chrome .workspace-titlebar-start {
    padding-left: var(--mac-titlebar-control-offset);
  }

  .workspace-titlebar-title {
    display: none;
  }

  .workspace-titlebar-tabs {
    display: flex;
    align-items: center;
    min-width: 0;
    justify-self: stretch;
    overflow: hidden;
  }

  .workspace-titlebar-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.58rem;
    justify-self: end;
    min-width: max-content;
  }

  .workspace-layout-tab {
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-panel) 82%, transparent);
    color: var(--ui-text-secondary);
    font: inherit;
    cursor: pointer;
    transition:
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .titlebar-icon {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: var(--ui-radius-md);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
    transition:
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .titlebar-icon {
    width: 1.45rem;
    height: 1.45rem;
  }

  .chat-workspace {
    --sidebar-width: 240px;
    position: relative;
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    padding: 0;
  }

  .chat-workspace.has-request-input {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) minmax(18rem, 22rem);
  }

  .chat-workspace.sidebar-hidden {
    grid-template-columns: 0rem minmax(0, 1fr);
  }

  .chat-workspace.sidebar-hidden.has-request-input {
    grid-template-columns: 0rem minmax(0, 1fr) minmax(18rem, 22rem);
  }

  .workspace-sidebar,
  .workspace-main,
  :global(.request-user-input-panel) {
    min-height: 0;
    min-width: 0;
  }

  .workspace-sidebar {
    position: relative;
    z-index: 2;
    overflow: visible;
    opacity: 1;
    transform: translateX(0);
    transform-origin: 0 50%;
    pointer-events: auto;
    transition:
      opacity 155ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 230ms cubic-bezier(0.19, 1, 0.22, 1);
    will-change: opacity, transform;
  }

  .workspace-sidebar:has(:global(.context-menu)) {
    z-index: var(--ui-z-overlay);
  }

  .chat-workspace.sidebar-hidden .workspace-sidebar {
    opacity: 0;
    transform: translateX(-0.42rem);
    pointer-events: none;
  }

  .sidebar-surface {
    height: 100%;
    min-height: 0;
    padding: 0;
    background: var(--ui-chrome);
  }

  .sidebar-resize-handle {
    position: absolute;
    top: var(--workspace-chrome-height);
    bottom: 0;
    left: calc(var(--sidebar-width) - 0.2rem);
    z-index: 9;
    width: 0.4rem;
    cursor: col-resize;
    touch-action: none;
  }

  .sidebar-resize-handle::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-shell-edge) 52%, transparent);
    transition: background-color 160ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .sidebar-resize-handle:hover::before,
  .sidebar-resize-handle.dragging::before {
    background: color-mix(in oklab, var(--ui-accent) 32%, var(--ui-border-strong));
  }

  .workspace-main {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0;
    min-height: 0;
    padding: 0;
    background: var(--ui-bg);
  }
  .workspace-main-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: var(--workspace-chrome-height);
    height: var(--workspace-chrome-height);
    padding: 0 0.78rem;
    border-bottom: 0;
    background: var(--ui-chrome);
    box-shadow: none;
    pointer-events: none;
  }

  .chat-workspace.sidebar-hidden .workspace-main-header {
    padding-left: 7.3rem;
  }

  .workspace-main-meta {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 0.5rem;
    min-height: var(--workspace-chrome-control-size);
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--ui-text-tertiary);
  }

  .workspace-layout-switcher {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    min-width: max-content;
  }

  .workspace-layout-tab {
    display: inline-grid;
    place-items: center;
    width: 1.65rem;
    height: 1.45rem;
    padding: 0;
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .workspace-layout-tab.empty {
    opacity: 0.48;
  }

  .workspace-layout-tab.disabled {
    cursor: default;
    opacity: 0.34;
  }

  .workspace-layout-tab.empty:hover,
  .workspace-layout-tab.empty:focus-visible,
  .workspace-layout-tab.active {
    opacity: 1;
  }

  .workspace-layout-tab.disabled:hover,
  .workspace-layout-tab.disabled:focus-visible {
    opacity: 0.34;
  }

  .workspace-layout-tab.active {
    border-color: color-mix(in oklab, var(--ui-accent) 52%, var(--ui-border-strong));
    background: color-mix(in oklab, var(--ui-accent) 16%, var(--ui-panel));
    color: var(--ui-text-primary);
  }

  .workspace-layout-tab.disabled.active {
    opacity: 0.5;
  }

  .workspace-main-meta :global(.ui-metadata-chip) {
    max-width: 13rem;
  }

  .workspace-main-chips {
    display: contents;
  }

  .workspace-main-meta :global(.context-budget-compact) {
    position: static;
    width: 5.25rem;
    flex: 0 0 5.25rem;
  }

  .workspace-main-stat {
    display: inline-flex;
    align-items: center;
    min-height: 1.35rem;
    max-width: 10.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
  }

  .header-icon-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.45rem;
    height: 1.45rem;
    padding: 0;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
    transition:
      border-color 140ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 140ms cubic-bezier(0.19, 1, 0.22, 1),
      color 140ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .header-icon-button:hover,
  .header-icon-button:focus-visible {
    border-color: var(--ui-border-strong);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .titlebar-icon:active:not(:disabled),
  .header-icon-button:active:not(:disabled) {
    transform: translateY(1px) scale(0.94);
  }

  .inline-titlebar-action {
    color: var(--ui-text-tertiary);
  }

  .inline-titlebar-action:hover,
  .inline-titlebar-action:focus-visible {
    outline: none;
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .chat-pane {
    min-height: 0;
  }

  .chat-pane-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    background: var(--ui-bg);
  }

  .handler-thread-list {
    display: grid;
    gap: 0.55rem;
    max-height: 18rem;
    overflow: auto;
    padding-right: 0.1rem;
  }

  .handler-thread-reference-entry {
    display: grid;
    gap: 0.5rem;
  }

  .handler-thread-reference-entry :global(.reference-thread-card) {
    box-shadow: none;
  }

  .reference-pills {
    justify-content: flex-start;
    padding-inline: 0.1rem;
  }

  .structured-command-list {
    display: grid;
    gap: 0.5rem;
    max-height: 6.5rem;
    overflow: auto;
    padding-right: 0.1rem;
  }

  .structured-command-card {
    display: grid;
    gap: 0.55rem;
    width: 100%;
    padding: 0.78rem 0.85rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-raised) 92%, transparent);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
      box-shadow 160ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .structured-command-card:hover {
    border-color: color-mix(in oklab, var(--ui-border-accent) 70%, transparent);
    background:
      linear-gradient(180deg, color-mix(in oklab, var(--ui-accent-soft) 30%, transparent), transparent),
      color-mix(in oklab, var(--ui-surface-raised) 94%, transparent);
  }

  .structured-command-card:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .structured-command-card-top,
  .structured-command-card-footer {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.85rem;
  }

  .structured-command-card-copy {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    min-width: 0;
  }

  .handler-thread-preview,
  .structured-command-card-copy span,
  .structured-command-summary {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--ui-text-secondary);
  }

  .handler-thread-pills,
  .handler-thread-actions,
  .structured-command-card-meta {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    justify-content: flex-end;
    font-size: var(--text-xs);
    color: var(--ui-text-tertiary);
  }

  .structured-command-status {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .structured-command-status.tone-success {
    color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
  }

  .structured-command-status.tone-info {
    color: color-mix(in oklab, var(--ui-status-waiting) 78%, var(--ui-text-primary));
  }

  .structured-command-status.tone-warning {
    color: color-mix(in oklab, var(--ui-warning) 84%, var(--ui-text-primary));
  }

  .structured-command-status.tone-danger {
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
  }

  .structured-command-status.tone-neutral {
    color: var(--ui-text-tertiary);
  }

  .structured-command-summary {
    color: var(--ui-text-primary);
  }

  .handler-thread-preview {
    color: var(--ui-text-primary);
  }

  .handler-thread-pills span {
    display: inline-flex;
    align-items: center;
    min-height: 1rem;
    padding: 0.14rem 0.42rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
  }

  .handler-thread-actions {
    justify-content: flex-end;
  }

  .structured-command-highlights {
    display: grid;
    gap: 0.45rem;
  }

  .structured-command-highlight {
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface) 94%, transparent);
  }

  .structured-command-highlight {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.56rem;
    font-size: var(--text-sm);
    color: var(--ui-text-secondary);
  }

  .structured-command-highlight-tool {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ui-text-tertiary);
  }

  .structured-command-card-footer {
    font-size: var(--text-xs);
    color: var(--ui-text-tertiary);
  }

  .handler-thread-empty {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.55;
    color: var(--ui-text-secondary);
  }

  .handler-thread-empty {
    padding: 0.9rem;
    border-radius: var(--ui-radius-md);
    border: 1px dashed color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
  }

  .handler-thread-empty.error {
    border-color: color-mix(in oklab, var(--ui-danger) 32%, transparent);
    background: color-mix(in oklab, var(--ui-danger-soft) 72%, transparent);
  }

  .session-dialog {
    display: grid;
    gap: 0.9rem;
  }

  .session-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .titlebar-icon:hover {
    background: color-mix(in oklab, var(--ui-surface-subtle) 74%, transparent);
    color: var(--ui-text-primary);
  }

  .titlebar-icon-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
  }

  .titlebar-icon:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  :global(body.sidebar-resizing) {
    cursor: col-resize;
    user-select: none;
  }

  :global(body.sidebar-resizing) .chat-workspace {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .chat-workspace,
    .workspace-titlebar,
    .workspace-sidebar,
    .sidebar-surface,
    .titlebar-icon,
    .header-icon-button,
    .pane-chrome-actions button {
      transition:
        grid-template-columns 0.01ms linear,
        width 0.01ms linear,
        transform 0.01ms linear,
        border-color 0.01ms linear,
        background-color 0.01ms linear,
        color 0.01ms linear,
        opacity 0.01ms linear;
    }

    .titlebar-icon:active:not(:disabled),
    .header-icon-button:active:not(:disabled),
    .pane-chrome-actions button:active:not(:disabled) {
      transform: none;
    }
  }

  @media (max-width: 980px) {
    .structured-command-header,
    .structured-command-card-top,
    .structured-command-card-footer {
      flex-direction: column;
      align-items: stretch;
    }

    .structured-command-copy {
      max-width: none;
    }

    .structured-command-card-meta {
      justify-content: flex-start;
    }
  }

  @media (max-width: 760px) {
    .workspace-shell {
      margin-inline: 0;
    }

    .chat-workspace.has-request-input,
    .chat-workspace.sidebar-hidden.has-request-input {
      grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    }

    .chat-workspace.has-request-input :global(.request-user-input-panel) {
      position: absolute;
      top: var(--workspace-chrome-height);
      right: 0;
      bottom: 0;
      z-index: 8;
      width: min(22rem, 100%);
      box-shadow: var(--ui-shadow-strong);
    }

    .workspace-main-subtitle {
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .structured-command-card-top,
    .structured-command-card-footer {
      flex-direction: column;
      align-items: stretch;
    }

    .handler-thread-actions,
    .handler-thread-pills,
    .structured-command-card-meta {
      justify-content: flex-start;
    }

  }
</style>
