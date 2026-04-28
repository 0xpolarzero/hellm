<script lang="ts">
  import { onMount } from "svelte";
  import PanelLeftCloseIcon from "@lucide/svelte/icons/panel-left-close";
  import PanelLeftOpenIcon from "@lucide/svelte/icons/panel-left-open";
  import FileSearchIcon from "@lucide/svelte/icons/file-search";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import Columns2Icon from "@lucide/svelte/icons/columns-2";
  import Rows2Icon from "@lucide/svelte/icons/rows-2";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import XIcon from "@lucide/svelte/icons/x";
  import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
  import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
  import ArtifactsPanel from "./ArtifactsPanel.svelte";
  import { ArtifactsController, type ArtifactsSnapshot } from "./artifacts";
  import ChatComposer from "./ChatComposer.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import { formatTimestamp, formatUsage } from "./chat-format";
  import {
    getCommandInspectorSections,
    getVisibleCommandRollups,
    getWorkspaceCommandStatusPresentation,
  } from "./command-inspector";
  import {
    projectConversation,
    projectConversationSummary,
  } from "./conversation-projection";
  import { buildSessionTranscriptExport } from "./session-transcript";
  import type {
    WorkspaceCommandArtifactLink,
    WorkspaceCommandInspector,
    WorkspaceCommandRollup,
    WorkspaceHandlerThreadInspector,
    WorkspaceHandlerThreadSummary,
    WorkspaceHandlerThreadWorkflowSummary,
    WorkspaceProjectCiCheckSummary,
    WorkspaceProjectCiPanelStatus,
    WorkspaceProjectCiStatusPanel,
    WorkspaceWorkflowTaskAttemptInspector,
    WorkspaceWorkflowTaskAttemptSummary,
    PromptTarget,
    WorkspaceSessionNavigationReadModel,
    WorkspaceSessionSummary,
  } from "../shared/workspace-contract";
  import type { WorkspaceInspectorSelection } from "./chat-storage";
  import type { PromptHistoryEntry } from "./prompt-history";
  import {
    clampSidebarWidth,
    getMaxSidebarWidth,
    isSidebarToggleShortcut,
    MIN_SIDEBAR_WIDTH,
  } from "./sidebar-layout";
  import SessionSidebar from "./SessionSidebar.svelte";
  import ChatTranscript from "./ChatTranscript.svelte";
  import {
    PRIMARY_CHAT_PANE_ID,
    type ChatRuntime,
    type ChatPaneLayoutState,
    type ChatPaneState,
    type ChatSurfaceController,
  } from "./chat-runtime";
  import { createEmptyPaneLayout, getOpenPaneLocations, type PanePlacementZone } from "./pane-layout";
  import {
    buildCommandRegistry,
    executeCommandAction,
    executePaletteFallbackPrompt,
    filterCommandActions,
    getCommandExecutionPaneId,
    getCommandPalettePlacement,
    isCommandPaletteShortcut,
    isQuickOpenShortcut,
    type CommandAction,
    type CommandPaletteMode,
  } from "./command-palette";
  import ModelPickerDialog from "./ModelPickerDialog.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Input from "./ui/Input.svelte";

  const DESKTOP_SPLIT_BREAKPOINT = 1220;
  const DEFAULT_SIDEBAR_WIDTH = 292;

  type Props = {
    runtime: ChatRuntime;
    onOpenSettings?: () => void;
  };

  let { runtime, onOpenSettings }: Props = $props();

  let controller = $state<ArtifactsController | null>(null);
  let messages = $state<ChatSurfaceController["agent"]["state"]["messages"]>([]);
  let streamMessage = $state<AssistantMessage | null>(null);
  let pendingToolCalls = $state(new Set<string>());
  let isStreaming = $state(false);
  let errorMessage = $state<string | undefined>(undefined);
  let currentModel = $state<Model<any> | null>(null);
  let currentThinkingLevel = $state<ThinkingLevel>("off");
  let artifactsSnapshot = $state<ArtifactsSnapshot>({
    activeFilename: null,
    artifacts: [],
    logsByFilename: {},
  });
  let showArtifactsPanel = $state(false);
  let showModelPicker = $state(false);
  let allowedProviders = $state<string[]>([]);
  let promptHistory = $state<PromptHistoryEntry[]>([]);
  let windowWidth = $state(0);
  let sessions = $state<WorkspaceSessionSummary[]>([]);
  let sessionNavigation = $state<WorkspaceSessionNavigationReadModel>({
    pinnedSessions: [],
    activeSessions: [],
    archived: {
      collapsed: true,
      sessions: [],
    },
  });
  let activeSessionId = $state<string | undefined>(undefined);
  let paneLayout = $state<ChatPaneLayoutState>({
    ...createEmptyPaneLayout(),
    focusedPaneId: PRIMARY_CHAT_PANE_ID,
  });
  let currentPane = $state<ChatPaneState | null>(null);
  let focusedPaneId = $state(PRIMARY_CHAT_PANE_ID);
  let focusedSurfaceTarget = $state<PromptTarget | null>(null);
  let currentSurfaceController = $state<ChatSurfaceController | null>(null);
  let sidebarError = $state<string | undefined>(undefined);
  let sidebarHidden = $state(false);
  let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
  let sidebarResizing = $state(false);
  let draggingPaneId = $state<string | null>(null);
  let mutatingSession = $state(false);
  let sendingPrompt = $state(false);
  let renameTarget = $state<WorkspaceSessionSummary | null>(null);
  let renameValue = $state("");
  let deleteTarget = $state<WorkspaceSessionSummary | null>(null);
  let sidebarResizeHandle = $state<HTMLDivElement | null>(null);
  let artifactSyncSessionId: string | undefined = undefined;
  let artifactSyncMessageCount = 0;
  let copyTranscriptState = $state<"idle" | "copying" | "copied" | "error">("idle");
  let showCommandInspector = $state(false);
  let commandInspector = $state<WorkspaceCommandInspector | null>(null);
  let commandInspectorError = $state<string | undefined>(undefined);
  let commandInspectorLoading = $state(false);
  let commandInspectorCommandId = $state<string | null>(null);
  let handlerThreads = $state<WorkspaceHandlerThreadSummary[]>([]);
  let handlerThreadsLoading = $state(false);
  let handlerThreadsError = $state<string | undefined>(undefined);
  let projectCiStatus = $state<WorkspaceProjectCiStatusPanel | null>(null);
  let projectCiError = $state<string | undefined>(undefined);
  let showThreadInspector = $state(false);
  let threadInspector = $state<WorkspaceHandlerThreadInspector | null>(null);
  let threadInspectorError = $state<string | undefined>(undefined);
  let threadInspectorLoading = $state(false);
  let threadInspectorThreadId = $state<string | null>(null);
  let showWorkflowTaskAttemptInspector = $state(false);
  let workflowTaskAttemptInspector = $state<WorkspaceWorkflowTaskAttemptInspector | null>(null);
  let workflowTaskAttemptInspectorError = $state<string | undefined>(undefined);
  let workflowTaskAttemptInspectorLoading = $state(false);
  let workflowTaskAttemptInspectorId = $state<string | null>(null);
  let paletteOpen = $state(false);
  let paletteMode = $state<CommandPaletteMode>("actions");
  let paletteError = $state<string | undefined>(undefined);
  let paletteBusy = $state(false);
  let workspaceMentionPaths = $state<ReadonlySet<string>>(new Set());

  let sidebarResizePointerId: number | null = null;
  let sidebarResizeOriginX = 0;
  let sidebarResizeOriginWidth = DEFAULT_SIDEBAR_WIDTH;
  let copyTranscriptResetTimer: ReturnType<typeof setTimeout> | null = null;
  let commandInspectorSessionId: string | null = null;
  let handlerThreadLoadToken = 0;
  let projectCiLoadToken = 0;
  let threadInspectorSessionId: string | null = null;
  let workflowTaskAttemptInspectorSessionId: string | null = null;
  let unsubscribeSurfaceController: (() => void) | null = null;
  let restoredInspectorKey: string | null = null;

  const conversation = $derived(projectConversation(messages));
  const conversationSummary = $derived(projectConversationSummary(conversation, streamMessage));
  const artifactCount = $derived(artifactsSnapshot.artifacts.length);
  const hasArtifacts = $derived(artifactCount > 0);
  const showDesktopSplit = $derived(
    windowWidth >= DESKTOP_SPLIT_BREAKPOINT && showArtifactsPanel && hasArtifacts,
  );
  const showOverlayArtifacts = $derived(
    windowWidth < DESKTOP_SPLIT_BREAKPOINT && showArtifactsPanel && hasArtifacts,
  );
  const effectiveSidebarWidth = $derived(clampSidebarWidth(sidebarWidth, windowWidth));
  const currentSession = $derived(sessions.find((session) => session.id === activeSessionId) ?? null);
  const currentCommandRollups = $derived(getVisibleCommandRollups(currentSession));
  const currentSurface = $derived(focusedSurfaceTarget);
  const paneLocationsBySessionId = $derived(
    Object.fromEntries(
      sessions.map((session) => [
        session.id,
        getOpenPaneLocations(
          paneLayout,
          (binding) => binding.workspaceSessionId === session.id && binding.surface === "orchestrator",
        ),
      ]),
    ),
  );
  const currentSurfaceLabel = $derived.by(() => {
    if (currentSurface?.surface === "thread") {
      return `Messaging handler thread ${currentSurface.threadId ?? currentSurface.surfacePiSessionId}`;
    }

    if (currentSurfaceController?.sessionMode === "quick") {
      return "Messaging quick session";
    }

    return "Messaging orchestrator";
  });
  function formatPaneSurfaceLabel(controller: ChatSurfaceController | null): string {
    if (controller?.target.surface === "thread") {
      return "Handler Thread";
    }
    return controller?.sessionMode === "quick" ? "Quick Session" : "Orchestrator";
  }
  function formatPaneAgentSummary(controller: ChatSurfaceController | null): string {
    const model = controller?.agent.state.model;
    const thinking = controller?.agent.state.thinkingLevel;
    if (!model) return "No agent";
    return `${model.provider}/${model.id} · ${thinking}`;
  }
  const usageText = $derived(formatUsage(conversation.usage));
  const summaryMessageCount = $derived(conversationSummary.messageCount);
  const toolCallCount = $derived(conversationSummary.toolCallCount);
  const lastActivity = $derived(conversation.lastActivity);
  const lastActivityLabel = $derived(lastActivity ? `Last activity ${formatTimestamp(lastActivity)}` : "Waiting for first turn");
  const composerErrorMessage = $derived.by(() => {
    const message =
      errorMessage ?? (currentSession?.status === "error" ? currentSession.preview : undefined);
    if (!message) {
      return undefined;
    }

    return message;
  });
  const promptBusy = $derived(isStreaming || sendingPrompt);
  const workspaceStatusText = $derived(composerErrorMessage ? "Attention" : promptBusy ? "Streaming" : "Ready");
  const workspaceStatusTone = $derived(composerErrorMessage ? "danger" : promptBusy ? "warning" : "neutral");
  const copyTranscriptLabel = $derived.by(() => {
    switch (copyTranscriptState) {
      case "copying":
        return "Copying...";
      case "copied":
        return "Copied";
      case "error":
        return "Copy failed";
      default:
        return "Copy transcript";
    }
  });
  const commandInspectorSections = $derived(getCommandInspectorSections(commandInspector));
  const showHandlerThreadPanel = $derived(
    currentSurface?.surface === "orchestrator" &&
      (handlerThreadsLoading || !!handlerThreadsError || handlerThreads.length > 0),
  );
  const showDetailedProjectCiPanel = $derived(
    currentSurface?.surface === "orchestrator" && currentSession && (projectCiStatus || projectCiError),
  );
  const threadLocalProjectCiRun = $derived.by(() => {
    if (!threadInspector || !projectCiStatus?.latestRun) {
      return null;
    }
    return projectCiStatus.latestRun.threadId === threadInspector.threadId
      ? projectCiStatus.latestRun
      : null;
  });
  const commandRegistry = $derived(
    buildCommandRegistry({
      sessions,
      focusedSessionId: activeSessionId,
      focusedSurfaceTarget,
      handlerThreads,
      projectCiStatus,
    }),
  );
  const visibleCommandActions = $derived(filterCommandActions(commandRegistry, ""));

  function clearCopyTranscriptResetTimer() {
    if (!copyTranscriptResetTimer) return;
    clearTimeout(copyTranscriptResetTimer);
    copyTranscriptResetTimer = null;
  }

  function scheduleCopyTranscriptReset() {
    clearCopyTranscriptResetTimer();
    copyTranscriptResetTimer = window.setTimeout(() => {
      copyTranscriptState = "idle";
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
    showModelPicker = true;
    allowedProviders = [currentModel.provider];
    try {
      const configuredProviders = await runtime.listConfiguredProviders();
      allowedProviders = Array.from(new Set([currentModel.provider, ...configuredProviders]));
    } catch {
      allowedProviders = [currentModel.provider];
    }
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

  function syncArtifacts(snapshot: ArtifactsSnapshot) {
    const createdNewArtifact = snapshot.artifacts.length > artifactsSnapshot.artifacts.length;
    artifactsSnapshot = snapshot;
    if (snapshot.artifacts.length === 0) {
      showArtifactsPanel = false;
      return;
    }
    if (createdNewArtifact) {
      showArtifactsPanel = true;
    }
  }

  async function syncArtifactsFromRuntime(force = false) {
    if (!controller || !currentSurfaceController) return;

    const sessionId = currentSurfaceController.agent.sessionId;
    const nextMessageCount = currentSurfaceController.agent.state.messages.length;
    const sessionChanged = artifactSyncSessionId !== sessionId;
    const cursorWentBackwards = nextMessageCount < artifactSyncMessageCount;

    if (force || sessionChanged || cursorWentBackwards) {
      await controller.syncFromMessages(currentSurfaceController.agent.state.messages, { replace: true });
      artifactSyncSessionId = sessionId;
      artifactSyncMessageCount = nextMessageCount;
      return;
    }

    await controller.syncFromMessages(currentSurfaceController.agent.state.messages);
    artifactSyncMessageCount = nextMessageCount;
  }

  function toggleSidebarVisibility() {
    sidebarHidden = !sidebarHidden;
  }

  function setSidebarResizing(nextValue: boolean) {
    sidebarResizing = nextValue;
    document.body.classList.toggle("sidebar-resizing", nextValue);
  }

  function startSidebarResize(event: PointerEvent) {
    if (sidebarHidden || !sidebarResizeHandle) return;
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

  async function runSessionMutation(action: () => Promise<void>) {
    if (mutatingSession) return;
    mutatingSession = true;
    sidebarError = undefined;

    try {
      await action();
      syncRuntimeState();
      resubscribeSurfaceController();
      syncSurfaceState();
      await syncArtifactsFromRuntime();
    } catch (error) {
      sidebarError = error instanceof Error ? error.message : "Session update failed.";
    } finally {
      mutatingSession = false;
    }
  }

  function openPalette(mode: CommandPaletteMode) {
    paletteMode = mode;
    paletteError = undefined;
    paletteOpen = true;
  }

  function closePalette() {
    paletteOpen = false;
    paletteError = undefined;
    paletteBusy = false;
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
      await syncArtifactsFromRuntime();
      closePalette();
    } catch (error) {
      paletteError = error instanceof Error ? error.message : "Command failed.";
    } finally {
      paletteBusy = false;
    }
  }

  async function handlePaletteExecute(action: CommandAction, event: KeyboardEvent | MouseEvent) {
    const paneId =
      action.category === "pane"
        ? focusedPaneId
        : getCommandExecutionPaneId({
            placement: getCommandPalettePlacement(event),
            focusedPaneId,
          });
    await runPaletteMutation(() =>
      executeCommandAction({
        runtime,
        action,
        paneId,
        onOpenSettings: () => onOpenSettings?.(),
        onOpenWorkflowTaskAttempt: ({ workspaceSessionId, workflowTaskAttemptId }) =>
          handleInspectWorkflowTaskAttempt({ workflowTaskAttemptId }, workspaceSessionId),
      }),
    );
  }

  async function handlePaletteFallbackPrompt(prompt: string, event: KeyboardEvent) {
    const paneId = getCommandExecutionPaneId({
      placement: getCommandPalettePlacement(event),
      focusedPaneId,
    });
    await runPaletteMutation(async () => {
      await executePaletteFallbackPrompt({
        runtime,
        prompt,
        paneId,
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
    });
  }

  async function handleCreateSession() {
    await runSessionMutation(() => runtime.createSession({}, { kind: "new-pane", direction: "right" }));
  }

  async function handleOpenSession(sessionId: string) {
    if (
      sessionId === activeSessionId &&
      currentSurface?.surface === "orchestrator" &&
      currentSurface.workspaceSessionId === sessionId
    ) {
      return;
    }
    await runSessionMutation(() => runtime.openSession(sessionId, { kind: "focused-pane" }));
  }

  function handleRenameSession(session: WorkspaceSessionSummary) {
    if (session.titleGeneration?.renameLocked) {
      sidebarError = "Session title is being generated. Rename is temporarily locked.";
      return;
    }
    renameTarget = session;
    renameValue = session.title;
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

  async function handleForkSession(session: WorkspaceSessionSummary) {
    await runSessionMutation(() => runtime.forkSession(session.id, undefined, { kind: "new-pane", direction: "right" }));
  }

  async function handleResetSurfaceTarget() {
    const session = currentSession;
    if (!session) {
      return;
    }
    await runSessionMutation(() => runtime.openSession(session.id, { kind: "focused-pane" }));
  }

  async function handleFocusPane(paneId: string) {
    runtime.focusPane(paneId);
    syncRuntimeState();
    resubscribeSurfaceController();
    syncSurfaceState();
    await syncArtifactsFromRuntime(true);
  }

  async function handleSplitPane(direction: "right" | "below", duplicateBinding = false) {
    await runSessionMutation(async () => {
      const paneId = await runtime.splitPane(focusedPaneId, direction, { duplicateBinding });
      if (paneId) {
        runtime.focusPane(paneId);
      }
    });
  }

  async function handleCloseFocusedPane() {
    await runSessionMutation(() => runtime.closePane(focusedPaneId));
  }

  function handleResizeTrack(axis: "column" | "row", index: number, deltaPercent: number) {
    runtime.resizePaneTrack(axis, index, deltaPercent);
    syncRuntimeState();
  }

  function handlePaneDragStart(event: DragEvent, paneId: string) {
    draggingPaneId = paneId;
    event.dataTransfer?.setData("application/x-svvy-pane-id", paneId);
    event.dataTransfer?.setData("text/plain", paneId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function getDraggedPaneId(event: DragEvent): string | null {
    return event.dataTransfer?.getData("application/x-svvy-pane-id") || event.dataTransfer?.getData("text/plain") || null;
  }

  function allowPaneDrop(event: DragEvent) {
    if (!event.dataTransfer) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleSpanningPaneDrop(event: DragEvent, placement: "top" | "bottom") {
    event.preventDefault();
    const paneId = getDraggedPaneId(event);
    draggingPaneId = null;
    if (!paneId) {
      return;
    }
    runtime.movePaneToSpanningRow(paneId, placement);
    syncRuntimeState();
  }

  function handlePanePlacementDrop(event: DragEvent, targetPaneId: string, zone: PanePlacementZone) {
    event.preventDefault();
    const sourcePaneId = getDraggedPaneId(event);
    draggingPaneId = null;
    if (!sourcePaneId) {
      return;
    }
    runtime.placePane(sourcePaneId, targetPaneId, zone);
    syncRuntimeState();
    resubscribeSurfaceController();
    syncSurfaceState();
  }

  function handleTranscriptScrollState(paneId: string, scroll: { transcriptAnchorId: string | null; offsetPx: number }) {
    runtime.setPaneScroll(paneId, scroll);
  }

  function handleDeleteSession(session: WorkspaceSessionSummary) {
    deleteTarget = session;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await runSessionMutation(async () => {
      await runtime.deleteSession(target.id, focusedPaneId);
      deleteTarget = null;
    });
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

  async function handleToggleArchivedGroup(collapsed: boolean) {
    await runSessionMutation(() => runtime.setArchivedGroupCollapsed(collapsed));
  }

  async function persistPromptHistoryEntry(input: string) {
    try {
      const entry = await runtime.storage.promptHistory.append({
        text: input,
        sentAt: Date.now(),
        workspaceId: runtime.workspaceId,
        sessionId: currentSurface?.workspaceSessionId ?? currentSession?.id ?? "unknown-session",
      });
      promptHistory = [...promptHistory, entry];
    } catch (error) {
      console.error("Failed to persist prompt history:", error);
    }
  }

  async function handleSend(input: string): Promise<boolean> {
    const surface = currentSurfaceController;
    if (!input.trim() || !surface || surface.agent.state.isStreaming || sendingPrompt) return false;

    sendingPrompt = true;
    try {
      await persistPromptHistoryEntry(input);

      const hasProviderAccess = await runtime.requireProviderAccess(surface.agent.state.model.provider);
      if (!hasProviderAccess) return false;

      await surface.agent.prompt(input);
      return true;
    } finally {
      sendingPrompt = false;
    }
  }

  function handleOpenArtifact(filename: string) {
    controller?.selectArtifact(filename);
    showArtifactsPanel = true;
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

  async function handleCopyTranscript() {
    if (copyTranscriptState === "copying") return;

    const session = currentSession;
    const agent = currentSurfaceController?.agent;
    if (!agent) {
      return;
    }
    const activeModel = currentModel ?? agent.state.model;
    const exportText = buildSessionTranscriptExport({
      session: {
        id: session?.id ?? agent.sessionId ?? "unknown-session",
        title: session?.title ?? "New Session",
        status: session?.status ?? "idle",
        createdAt: session?.createdAt ?? new Date(0).toISOString(),
        updatedAt: session?.updatedAt ?? new Date().toISOString(),
      },
      target:
        currentSurfaceController?.target ?? {
          workspaceSessionId: session?.id ?? "unknown-session",
          surface: "orchestrator",
          surfacePiSessionId: agent.sessionId ?? "unknown-surface",
        },
      provider: activeModel.provider,
      model: activeModel.id,
      reasoningEffort: currentThinkingLevel,
      systemPrompt: currentSurfaceController.resolvedSystemPrompt,
      messages,
      streamMessage,
    });

    copyTranscriptState = "copying";

    try {
      await copyTextToClipboard(exportText);
      copyTranscriptState = "copied";
      scheduleCopyTranscriptReset();
    } catch (error) {
      console.error("Failed to copy transcript:", error);
      copyTranscriptState = "error";
      scheduleCopyTranscriptReset();
    }
  }

  function closeCommandInspector() {
    showCommandInspector = false;
    commandInspector = null;
    commandInspectorError = undefined;
    commandInspectorLoading = false;
    commandInspectorCommandId = null;
    commandInspectorSessionId = null;
  }

  function closeThreadInspector() {
    showThreadInspector = false;
    threadInspector = null;
    threadInspectorError = undefined;
    threadInspectorLoading = false;
    threadInspectorThreadId = null;
    threadInspectorSessionId = null;
    runtime.setPaneInspectorSelection(focusedPaneId, null);
  }

  function closeWorkflowTaskAttemptInspector() {
    showWorkflowTaskAttemptInspector = false;
    workflowTaskAttemptInspector = null;
    workflowTaskAttemptInspectorError = undefined;
    workflowTaskAttemptInspectorLoading = false;
    workflowTaskAttemptInspectorId = null;
    workflowTaskAttemptInspectorSessionId = null;
  }

  function getCommandStatusLabel(
    status: WorkspaceCommandRollup["status"] | WorkspaceCommandInspector["status"],
  ): string {
    return getWorkspaceCommandStatusPresentation(status).label;
  }

  function getCommandStatusTone(
    status: WorkspaceCommandRollup["status"] | WorkspaceCommandInspector["status"],
  ): string {
    return getWorkspaceCommandStatusPresentation(status).tone;
  }

  function getThreadStatusLabel(
    status:
      | WorkspaceHandlerThreadSummary["status"]
      | WorkspaceHandlerThreadInspector["status"]
      | WorkspaceHandlerThreadWorkflowSummary["status"],
  ): string {
    switch (status) {
      case "running-handler":
        return "Handler Running";
      case "running-workflow":
        return "Workflow Running";
      case "waiting":
        return "Waiting";
      case "troubleshooting":
        return "Troubleshooting";
      case "completed":
        return "Completed";
      case "continued":
        return "Continued";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
      default:
        return status;
    }
  }

  function getThreadStatusTone(
    status:
      | WorkspaceHandlerThreadSummary["status"]
      | WorkspaceHandlerThreadInspector["status"]
      | WorkspaceHandlerThreadWorkflowSummary["status"],
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    switch (status) {
      case "running-handler":
      case "running-workflow":
        return "info";
      case "waiting":
        return "warning";
      case "completed":
        return "success";
      case "continued":
        return "neutral";
      case "troubleshooting":
      case "failed":
        return "danger";
      default:
        return "neutral";
    }
  }

  function getProjectCiStatusLabel(status: WorkspaceProjectCiPanelStatus): string {
    switch (status) {
      case "not-configured":
        return "Not configured";
      case "configured":
        return "Configured";
      case "running":
        return "Running";
      case "passed":
        return "Passed";
      case "failed":
        return "Failed";
      case "blocked":
        return "Blocked";
      case "cancelled":
        return "Cancelled";
      default:
        return status;
    }
  }

  function getProjectCiStatusTone(
    status: WorkspaceProjectCiPanelStatus | WorkspaceProjectCiCheckSummary["status"],
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    switch (status) {
      case "running":
        return "info";
      case "passed":
        return "success";
      case "configured":
      case "not-configured":
      case "skipped":
      case "cancelled":
        return "neutral";
      case "blocked":
        return "warning";
      case "failed":
        return "danger";
      default:
        return "neutral";
    }
  }

  function formatProjectCiCommand(command: string[] | null): string | null {
    if (!command || command.length === 0) {
      return null;
    }

    return command.join(" ");
  }

  function formatProjectCiExitCode(exitCode: number | null): string | null {
    if (exitCode === null) {
      return null;
    }

    return `exit code ${exitCode}`;
  }

  function formatProjectCiCheckCounts(status: WorkspaceProjectCiStatusPanel): string {
    const counts = status.checkCounts;
    if (counts.total === 0) {
      return "No checks";
    }
    const failed = counts.failed + counts.blocked + counts.cancelled;
    if (failed > 0) {
      return `${counts.passed}/${counts.total} passed, ${failed} attention`;
    }
    return `${counts.passed}/${counts.total} passed`;
  }

  function handleInspectLatestProjectCiRun() {
    if (!projectCiStatus?.latestRun) {
      return;
    }
    runtime.setPaneInspectorSelection(focusedPaneId, {
      kind: "ci-run",
      ciRunId: projectCiStatus.latestRun.ciRunId,
    });
  }

  function getWorkflowTaskAttemptStatusLabel(
    status: WorkspaceWorkflowTaskAttemptSummary["status"] | WorkspaceWorkflowTaskAttemptInspector["status"],
  ): string {
    switch (status) {
      case "running":
        return "Running";
      case "waiting":
        return "Waiting";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
      default:
        return status;
    }
  }

  function getWorkflowTaskAttemptStatusTone(
    status: WorkspaceWorkflowTaskAttemptSummary["status"] | WorkspaceWorkflowTaskAttemptInspector["status"],
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    switch (status) {
      case "running":
        return "info";
      case "waiting":
        return "warning";
      case "completed":
        return "success";
      case "failed":
        return "danger";
      case "cancelled":
        return "neutral";
      default:
        return "neutral";
    }
  }

  function getHandlerThreadPreview(
    thread: WorkspaceHandlerThreadSummary | WorkspaceHandlerThreadInspector,
  ): string {
    if (thread.wait) {
      return thread.wait.reason;
    }

    if (thread.latestEpisode) {
      return thread.latestEpisode.summary;
    }

    if (thread.latestWorkflowRun) {
      return thread.latestWorkflowRun.summary;
    }

    return thread.objective;
  }

  function formatCommandFacts(facts: Record<string, unknown> | null | undefined): string | null {
    if (!facts || Object.keys(facts).length === 0) {
      return null;
    }

    return JSON.stringify(facts, null, 2);
  }

  function canOpenArtifactLink(artifact: WorkspaceCommandArtifactLink): boolean {
    return (
      artifactsSnapshot.artifacts.some((record) => record.filename === artifact.name) ||
      !artifact.missingFile
    );
  }

  function getInspectorSelectionKey(selection: WorkspaceInspectorSelection | null | undefined): string | null {
    if (!selection) {
      return null;
    }
    switch (selection.kind) {
      case "thread":
        return `thread:${selection.threadId}`;
      case "workflow-run":
        return `workflow-run:${selection.workflowRunId}`;
      case "artifact":
        return `artifact:${selection.artifactId}`;
      case "ci-run":
        return `ci-run:${selection.ciRunId}`;
    }
  }

  async function openStructuredArtifact(
    artifactId: string,
    sessionId: string,
    options: { persistSelection?: boolean } = {},
  ) {
    if (!controller) {
      return;
    }

    const preview = await runtime.getArtifactPreview(artifactId, sessionId);
    if (preview.missingFile && !preview.content) {
      sidebarError = `Artifact file is missing: ${preview.name}`;
      return;
    }

    controller.upsertExternalArtifact({
      filename: preview.name,
      content: preview.content,
      createdAt: Date.parse(preview.createdAt),
      updatedAt: Date.now(),
    });
    showArtifactsPanel = true;
    if (options.persistSelection ?? true) {
      runtime.setPaneInspectorSelection(focusedPaneId, { kind: "artifact", artifactId });
    }
  }

  async function handleOpenStructuredArtifact(artifact: WorkspaceCommandArtifactLink) {
    const session = currentSession;
    if (!session) {
      return;
    }

    try {
      await openStructuredArtifact(artifact.artifactId, session.id);
    } catch (error) {
      sidebarError = error instanceof Error ? error.message : "Unable to open this artifact.";
    }
  }

  async function handleInspectCommand(commandId: string) {
    const session = currentSession;
    if (!session) {
      return;
    }

    showCommandInspector = true;
    commandInspector = null;
    commandInspectorError = undefined;
    commandInspectorLoading = true;
    commandInspectorCommandId = commandId;
    commandInspectorSessionId = session.id;

    try {
      const inspector = await runtime.getCommandInspector(commandId, session.id);
      if (commandInspectorCommandId !== commandId || commandInspectorSessionId !== session.id) {
        return;
      }

      commandInspector = inspector;
    } catch (error) {
      if (commandInspectorCommandId !== commandId || commandInspectorSessionId !== session.id) {
        return;
      }

      commandInspectorError =
        error instanceof Error ? error.message : "Unable to inspect this command.";
    } finally {
      if (commandInspectorCommandId === commandId && commandInspectorSessionId === session.id) {
        commandInspectorLoading = false;
      }
    }
  }

  function handleOpenHandlerThread(
    thread: Pick<WorkspaceHandlerThreadSummary, "threadId" | "surfacePiSessionId">,
  ) {
    const session = currentSession;
    if (!session) {
      return;
    }

    closeThreadInspector();
    setTimeout(() => {
      void runSessionMutation(() =>
        runtime.openSurface(
          {
            workspaceSessionId: session.id,
            surface: "thread",
            surfacePiSessionId: thread.surfacePiSessionId,
            threadId: thread.threadId,
          },
          { kind: "new-pane", direction: "right" },
        ),
      );
    }, 0);
  }

  async function loadHandlerThreadInspector(threadId: string, sessionId: string) {
    try {
      const inspector = await runtime.getHandlerThreadInspector(threadId, sessionId);
      if (threadInspectorThreadId !== threadId || threadInspectorSessionId !== sessionId) {
        return;
      }

      threadInspector = inspector;
    } catch (error) {
      if (threadInspectorThreadId !== threadId || threadInspectorSessionId !== sessionId) {
        return;
      }

      threadInspectorError =
        error instanceof Error ? error.message : "Unable to inspect this handler thread.";
    } finally {
      if (threadInspectorThreadId === threadId && threadInspectorSessionId === sessionId) {
        threadInspectorLoading = false;
      }
    }
  }

  function handleInspectHandlerThread(thread: WorkspaceHandlerThreadSummary) {
    const session = currentSession;
    if (!session) {
      return;
    }

    runtime.setPaneInspectorSelection(focusedPaneId, { kind: "thread", threadId: thread.threadId });
    showThreadInspector = true;
    threadInspector = null;
    threadInspectorError = undefined;
    threadInspectorLoading = true;
    threadInspectorThreadId = thread.threadId;
    threadInspectorSessionId = session.id;

    setTimeout(() => {
      void loadHandlerThreadInspector(thread.threadId, session.id);
    }, 0);
  }

  async function restoreHandlerThreadInspector(threadId: string, sessionId: string) {
    showThreadInspector = true;
    threadInspector = null;
    threadInspectorError = undefined;
    threadInspectorLoading = true;
    threadInspectorThreadId = threadId;
    threadInspectorSessionId = sessionId;

    try {
      const inspector = await runtime.getHandlerThreadInspector(threadId, sessionId);
      if (threadInspectorThreadId !== threadId || threadInspectorSessionId !== sessionId) {
        return;
      }
      threadInspector = inspector;
    } catch {
      if (threadInspectorThreadId === threadId && threadInspectorSessionId === sessionId) {
        closeThreadInspector();
      }
    } finally {
      if (threadInspectorThreadId === threadId && threadInspectorSessionId === sessionId) {
        threadInspectorLoading = false;
      }
    }
  }

  async function handleInspectThreadCommand(commandId: string) {
    closeThreadInspector();
    closeWorkflowTaskAttemptInspector();
    await handleInspectCommand(commandId);
  }

  async function handleAskHandlerToSaveWorkflow(
    thread: Pick<WorkspaceHandlerThreadSummary, "threadId" | "surfacePiSessionId">,
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
    const prompt = [
      "Inspect the workflow work owned by this thread.",
      "If there are reusable saved workflow files worth keeping, write them directly into `.svvy/workflows/...` using the normal repo write APIs.",
      "Rely on the automatic workflow validation feedback returned in the surrounding `execute_typescript` logs, and keep editing until the final saved workflow state validates cleanly.",
      "If nothing here is worth saving, say so briefly inside the thread.",
    ].join(" ");

    await runSessionMutation(async () => {
      await runtime.openSurface(target, focusedPaneId);
      await runtime.sendPromptToTarget(target, prompt);
    });
  }

  async function handleInspectWorkflowTaskAttempt(
    workflowTaskAttempt: Pick<WorkspaceWorkflowTaskAttemptSummary, "workflowTaskAttemptId">,
    sessionId = currentSession?.id,
  ) {
    if (!sessionId) {
      return;
    }

    showWorkflowTaskAttemptInspector = true;
    workflowTaskAttemptInspector = null;
    workflowTaskAttemptInspectorError = undefined;
    workflowTaskAttemptInspectorLoading = true;
    workflowTaskAttemptInspectorId = workflowTaskAttempt.workflowTaskAttemptId;
    workflowTaskAttemptInspectorSessionId = sessionId;

    try {
      const inspector = await runtime.getWorkflowTaskAttemptInspector(
        workflowTaskAttempt.workflowTaskAttemptId,
        sessionId,
      );
      if (
        workflowTaskAttemptInspectorId !== workflowTaskAttempt.workflowTaskAttemptId ||
        workflowTaskAttemptInspectorSessionId !== sessionId
      ) {
        return;
      }

      workflowTaskAttemptInspector = inspector;
    } catch (error) {
      if (
        workflowTaskAttemptInspectorId !== workflowTaskAttempt.workflowTaskAttemptId ||
        workflowTaskAttemptInspectorSessionId !== sessionId
      ) {
        return;
      }

      workflowTaskAttemptInspectorError =
        error instanceof Error ? error.message : "Unable to inspect this workflow task attempt.";
    } finally {
      if (
        workflowTaskAttemptInspectorId === workflowTaskAttempt.workflowTaskAttemptId &&
        workflowTaskAttemptInspectorSessionId === sessionId
      ) {
        workflowTaskAttemptInspectorLoading = false;
      }
    }
  }

  async function handleInspectThreadWorkflowTaskAttempt(
    workflowTaskAttempt: WorkspaceWorkflowTaskAttemptSummary,
  ) {
    closeThreadInspector();
    await handleInspectWorkflowTaskAttempt(workflowTaskAttempt);
  }

  async function handleInspectCommandWorkflowTaskAttempt(workflowTaskAttemptId: string) {
    closeCommandInspector();
    closeThreadInspector();
    await handleInspectWorkflowTaskAttempt({ workflowTaskAttemptId });
  }

  $effect(() => {
    const sessionId = currentSession?.id ?? null;
    if (!commandInspectorSessionId || !sessionId || sessionId === commandInspectorSessionId) {
      return;
    }

    closeCommandInspector();
  });

  $effect(() => {
    const sessionId = currentSession?.id ?? null;
    if (!threadInspectorSessionId || !sessionId || sessionId === threadInspectorSessionId) {
      return;
    }

    closeThreadInspector();
  });

  $effect(() => {
    const sessionId = currentSession?.id ?? null;
    if (
      !workflowTaskAttemptInspectorSessionId ||
      !sessionId ||
      sessionId === workflowTaskAttemptInspectorSessionId
    ) {
      return;
    }

    closeWorkflowTaskAttemptInspector();
  });

  $effect(() => {
    const session = currentSession;
    if (!session) {
      projectCiStatus = null;
      projectCiError = undefined;
      return;
    }

    const loadToken = ++projectCiLoadToken;
    projectCiError = undefined;
    projectCiStatus = null;
    void runtime
      .getProjectCiStatus(session.id)
      .then((status) => {
        if (loadToken !== projectCiLoadToken) {
          return;
        }

        projectCiStatus = status;
      })
      .catch((error) => {
        if (loadToken !== projectCiLoadToken) {
          return;
        }

        projectCiError =
          error instanceof Error ? error.message : "Unable to load Project CI status.";
        projectCiStatus = null;
      })
  });

  $effect(() => {
    const selection = currentPane?.inspectorSelection ?? null;
    const sessionId = currentPane?.target?.workspaceSessionId ?? null;
    const key = getInspectorSelectionKey(selection);
    if (!selection) {
      restoredInspectorKey = null;
      return;
    }
    if (!sessionId || key === restoredInspectorKey) {
      return;
    }

    if (selection.kind === "ci-run") {
      if (!projectCiStatus && !projectCiError) {
        return;
      }
      restoredInspectorKey = key;
      if (projectCiStatus?.latestRun?.ciRunId !== selection.ciRunId) {
        runtime.setPaneInspectorSelection(focusedPaneId, null);
      }
      return;
    }

    restoredInspectorKey = key;
    if (selection.kind === "thread") {
      void restoreHandlerThreadInspector(selection.threadId, sessionId);
      return;
    }

    if (selection.kind === "workflow-run") {
      return;
    }

    if (selection.kind === "artifact") {
      void openStructuredArtifact(selection.artifactId, sessionId, { persistSelection: false }).catch(() => {
        runtime.setPaneInspectorSelection(focusedPaneId, null);
      });
    }
  });

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

  function syncSurfaceTools() {
    if (!controller || !currentSurfaceController) {
      return;
    }

    currentSurfaceController.agent.state.tools = [controller.tool];
  }

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
    sessionNavigation = runtime.sessionNavigation;
    paneLayout = runtime.paneLayout;
    focusedPaneId = paneLayout.focusedPaneId;
    currentPane = runtime.getPane(focusedPaneId) ?? null;
    focusedSurfaceTarget = currentPane?.target ?? null;
    activeSessionId = currentPane?.target?.workspaceSessionId;
    currentSurfaceController = runtime.getPaneController(focusedPaneId);
  }

  function resubscribeSurfaceController() {
    unsubscribeSurfaceController?.();
    unsubscribeSurfaceController = null;
    if (!currentSurfaceController) {
      syncSurfaceState();
      return;
    }

    syncSurfaceTools();
    unsubscribeSurfaceController = currentSurfaceController.subscribe(() => {
      focusedSurfaceTarget = currentSurfaceController?.target ?? null;
      activeSessionId = currentSurfaceController?.target.workspaceSessionId;
      syncSurfaceTools();
      syncSurfaceState();
      void syncArtifactsFromRuntime();
    });
  }

  syncRuntimeState();
  syncSurfaceState();

  onMount(() => {
    windowWidth = window.innerWidth;
    const nextController = new ArtifactsController();
    controller = nextController;
    const handleResize = () => {
      windowWidth = window.innerWidth;
    };
    const handleWindowKeydown = (event: KeyboardEvent) => {
      if (isCommandPaletteShortcut(event)) {
        event.preventDefault();
        openPalette("actions");
        return;
      }

      if (isQuickOpenShortcut(event)) {
        event.preventDefault();
        openPalette("quick-open");
        return;
      }

      if (!isSidebarToggleShortcut(event)) return;

      event.preventDefault();
      toggleSidebarVisibility();
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleWindowKeydown);

    syncSurfaceTools();
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

    const unsubscribeRuntime = runtime.subscribe(() => {
      syncRuntimeState();
      resubscribeSurfaceController();
      syncSurfaceState();
      void syncArtifactsFromRuntime();
    });
    const unsubscribeArtifacts = nextController.subscribe((snapshot) => {
      syncArtifacts(snapshot);
    });
    resubscribeSurfaceController();
    void syncArtifactsFromRuntime(true);

    return () => {
      unsubscribeRuntime();
      unsubscribeArtifacts();
      unsubscribeSurfaceController?.();
      nextController.dispose();
      setSidebarResizing(false);
      clearCopyTranscriptResetTimer();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleWindowKeydown);
      controller = null;
    };
  });
</script>

<div class="workspace-shell">
  <header class="workspace-titlebar electrobun-webkit-app-region-drag">
    <div class="workspace-titlebar-start">
      <button
        class="titlebar-icon electrobun-webkit-app-region-no-drag"
        type="button"
        aria-pressed={!sidebarHidden}
        aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
        title={sidebarHidden ? "Show sidebar (Cmd/Ctrl+B)" : "Hide sidebar (Cmd/Ctrl+B)"}
        onclick={toggleSidebarVisibility}
      >
        {#if sidebarHidden}
          <PanelLeftOpenIcon aria-hidden="true" size={16} strokeWidth={1.8} />
        {:else}
          <PanelLeftCloseIcon aria-hidden="true" size={16} strokeWidth={1.8} />
        {/if}
      </button>
      <p class="workspace-titlebar-title">svvy</p>
    </div>
    <div class="workspace-titlebar-actions electrobun-webkit-app-region-no-drag">
      <button
        class="titlebar-icon"
        type="button"
        aria-label="Open command palette"
        title="Command Palette (Cmd+Shift+P)"
        onclick={() => openPalette("actions")}
      >
        <SearchIcon aria-hidden="true" size={15} strokeWidth={1.85} />
      </button>
      <button
        class="titlebar-icon"
        type="button"
        aria-label="Open quick open"
        title="Quick Open (Cmd+P)"
        onclick={() => openPalette("quick-open")}
      >
        <FileSearchIcon aria-hidden="true" size={15} strokeWidth={1.85} />
      </button>
    </div>
  </header>

  <div
    class={`chat-workspace ${showDesktopSplit ? "split" : ""} ${sidebarHidden ? "sidebar-hidden" : ""}`.trim()}
    style={`--sidebar-width: ${effectiveSidebarWidth}px;`}
  >
    {#if !sidebarHidden}
      <aside class="workspace-sidebar">
        <div class="sidebar-surface">
          <SessionSidebar
            workspaceLabel={runtime.workspaceLabel}
            branch={runtime.branch}
            navigation={sessionNavigation}
            {activeSessionId}
            activeSurface={currentSurface?.surface}
            {paneLocationsBySessionId}
            busy={mutatingSession}
            errorMessage={sidebarError}
            onCreateSession={handleCreateSession}
            onOpenSession={handleOpenSession}
            onRenameSession={handleRenameSession}
            onForkSession={handleForkSession}
            onDeleteSession={handleDeleteSession}
            onPinSession={handlePinSession}
            onUnpinSession={handleUnpinSession}
            onArchiveSession={handleArchiveSession}
            onUnarchiveSession={handleUnarchiveSession}
            onToggleArchivedGroup={handleToggleArchivedGroup}
          />
        </div>
      </aside>
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
      <header class="workspace-main-header">
        <div class="workspace-main-copy">
          <h2 class="workspace-main-title">{currentSession?.title ?? "New Session"}</h2>
          <p class="workspace-main-subtitle">{currentSurfaceLabel}</p>
        </div>

        <div class="workspace-main-meta">
          {#if currentSurface?.surface === "thread"}
            <Button
              variant="ghost"
              size="sm"
              disabled={mutatingSession}
              onclick={() => void handleResetSurfaceTarget()}
            >
              Return to orchestrator
            </Button>
          {/if}
          <Badge tone={workspaceStatusTone}>{workspaceStatusText}</Badge>
          <span>{summaryMessageCount} turns</span>
          <span>{toolCallCount} tool runs</span>
          <span>{lastActivityLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            title="Copy the full session transcript, including tool calls and tool results."
            disabled={copyTranscriptState === "copying"}
            onclick={() => void handleCopyTranscript()}
          >
            {copyTranscriptLabel}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (showArtifactsPanel = !showArtifactsPanel)}
            disabled={!hasArtifacts}
          >
            Artifacts {artifactCount}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="pane-split-right"
            title="Split pane right"
            disabled={mutatingSession}
            onclick={() => void handleSplitPane("right")}
          >
            <Columns2Icon aria-hidden="true" size={14} strokeWidth={1.9} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="pane-split-below"
            title="Split pane below"
            disabled={mutatingSession}
            onclick={() => void handleSplitPane("below")}
          >
            <Rows2Icon aria-hidden="true" size={14} strokeWidth={1.9} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Duplicate focused pane"
            disabled={mutatingSession}
            onclick={() => void handleSplitPane("right", true)}
          >
            <CopyIcon aria-hidden="true" size={14} strokeWidth={1.9} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="pane-close"
            title="Close focused pane"
            disabled={mutatingSession}
            onclick={() => void handleCloseFocusedPane()}
          >
            <XIcon aria-hidden="true" size={14} strokeWidth={1.9} />
          </Button>
          {#if projectCiStatus}
            <div class="project-ci-compact" aria-label="Project CI summary">
              <Badge tone={getProjectCiStatusTone(projectCiStatus.status)}>
                CI {getProjectCiStatusLabel(projectCiStatus.status)}
              </Badge>
              <span>{projectCiStatus.summary}</span>
              <span>{formatProjectCiCheckCounts(projectCiStatus)}</span>
              {#if projectCiStatus.latestRun}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={handleInspectLatestProjectCiRun}
                >
                  Inspect
                </Button>
              {/if}
            </div>
          {/if}
        </div>
      </header>

      <section
        class={`pane-grid ${draggingPaneId ? "dragging-pane" : ""}`.trim()}
        data-testid="pane-grid"
        style={`grid-template-columns: ${paneLayout.columns.map((column) => `${column.percent}fr`).join(" ")}; grid-template-rows: ${paneLayout.rows.map((row) => `${row.percent}fr`).join(" ")};`}
      >
        <button
          class="pane-span-drop-zone top"
          type="button"
          data-testid="pane-span-drop-top"
          aria-label="Move dragged pane to full-width top row"
          ondragover={allowPaneDrop}
          ondrop={(event) => handleSpanningPaneDrop(event, "top")}
        >
          Span top
        </button>
        <button
          class="pane-span-drop-zone bottom"
          type="button"
          data-testid="pane-span-drop-bottom"
          aria-label="Move dragged pane to full-width bottom row"
          ondragover={allowPaneDrop}
          ondrop={(event) => handleSpanningPaneDrop(event, "bottom")}
        >
          Span bottom
        </button>
        {#each paneLayout.panes as pane (pane.paneId)}
          {@const paneController = runtime.getPaneController(pane.paneId)}
          <article
            class={`workspace-pane ${pane.paneId === focusedPaneId ? "focused" : ""}`.trim()}
            data-testid="workspace-pane"
            data-pane-id={pane.paneId}
            aria-current={pane.paneId === focusedPaneId ? "true" : "false"}
            draggable="true"
            ondragstart={(event) => handlePaneDragStart(event, pane.paneId)}
            ondragend={() => (draggingPaneId = null)}
            ondragover={allowPaneDrop}
            ondrop={(event) => handlePanePlacementDrop(event, pane.paneId, "replace")}
            style={`grid-column: ${pane.columnStart + 1} / ${pane.columnEnd + 1}; grid-row: ${pane.rowStart + 1} / ${pane.rowEnd + 1};`}
          >
            <div class="pane-placement-zones" aria-hidden={!draggingPaneId}>
              <button type="button" class="pane-placement-zone replace" ondragover={allowPaneDrop} ondrop={(event) => handlePanePlacementDrop(event, pane.paneId, "replace")}>Replace</button>
              <button type="button" class="pane-placement-zone left" ondragover={allowPaneDrop} ondrop={(event) => handlePanePlacementDrop(event, pane.paneId, "left")}>Left</button>
              <button type="button" class="pane-placement-zone right" ondragover={allowPaneDrop} ondrop={(event) => handlePanePlacementDrop(event, pane.paneId, "right")}>Right</button>
              <button type="button" class="pane-placement-zone above" ondragover={allowPaneDrop} ondrop={(event) => handlePanePlacementDrop(event, pane.paneId, "above")}>Above</button>
              <button type="button" class="pane-placement-zone below" ondragover={allowPaneDrop} ondrop={(event) => handlePanePlacementDrop(event, pane.paneId, "below")}>Below</button>
            </div>
            <header class="pane-chrome">
              <button
                class="pane-focus-button"
                type="button"
                aria-label={`Focus pane ${pane.paneId}`}
                onclick={() => void handleFocusPane(pane.paneId)}
              >
                <strong>{formatPaneSurfaceLabel(paneController)}</strong>
                <span>{formatPaneAgentSummary(paneController)}</span>
              </button>
              <div class="pane-chrome-actions">
                <button
                  class="pane-resize-button vertical"
                  type="button"
                  data-testid="pane-resize-vertical"
                  aria-label="Widen pane"
                  title="Widen pane"
                  onclick={(event) => {
                    event.stopPropagation();
                    handleResizeTrack("column", Math.max(0, pane.columnStart - 1), 5);
                  }}
                >
                  <Columns2Icon aria-hidden="true" size={13} strokeWidth={1.9} />
                </button>
                <button
                  class="pane-resize-button horizontal"
                  type="button"
                  data-testid="pane-resize-horizontal"
                  aria-label="Heighten pane"
                  title="Heighten pane"
                  onclick={(event) => {
                    event.stopPropagation();
                    handleResizeTrack("row", Math.max(0, pane.rowStart - 1), 5);
                  }}
                >
                  <Rows2Icon aria-hidden="true" size={13} strokeWidth={1.9} />
                </button>
              </div>
            </header>
            {#if pane.paneId === focusedPaneId}
              <section class="chat-pane" id="conversation">
                <div class="chat-pane-shell">
          {#if showDetailedProjectCiPanel}
            <section class="project-ci-panel" aria-label="Project CI">
              <header class="project-ci-header">
                <div>
                  <p class="project-ci-eyebrow">Project CI</p>
                  <h3>
                  {#if projectCiStatus}
                    {getProjectCiStatusLabel(projectCiStatus.status)}
                  {:else}
                    Unavailable
                  {/if}
                  </h3>
                </div>
                {#if projectCiStatus}
                  <Badge tone={getProjectCiStatusTone(projectCiStatus.status)}>
                    {getProjectCiStatusLabel(projectCiStatus.status)}
                  </Badge>
                {/if}
              </header>

              {#if projectCiError}
                <p class="project-ci-empty error">{projectCiError}</p>
              {:else if projectCiStatus}
                <div class="project-ci-body">
                  <p class="project-ci-summary">{projectCiStatus.summary}</p>

                  {#if projectCiStatus.status === "not-configured"}
                    <p class="project-ci-muted">Ask svvy to configure Project CI.</p>
                  {/if}

                  {#if projectCiStatus.entries.length > 0}
                    <div class="project-ci-entries" aria-label="Configured Project CI entries">
                      {#each projectCiStatus.entries as entry (entry.workflowId)}
                        <div class="project-ci-entry">
                          <strong>{entry.workflowId}</strong>
                          <span>{entry.entryPath}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}

                  {#if projectCiStatus.status === "configured"}
                    <p class="project-ci-muted">No Project CI runs yet.</p>
                  {/if}

                  {#if projectCiStatus.activeWorkflowRun}
                    <div class="project-ci-run-card">
                      <div class="project-ci-run-card-top">
                        <div>
                          <strong>{projectCiStatus.activeWorkflowRun.workflowId}</strong>
                          <span>
                            {projectCiStatus.activeWorkflowRun.status === "waiting"
                              ? "Workflow Blocked"
                              : "Workflow Running"}
                          </span>
                        </div>
                        <span>{formatTimestamp(projectCiStatus.activeWorkflowRun.updatedAt)}</span>
                      </div>
                      <p>{projectCiStatus.activeWorkflowRun.summary}</p>
                      {#if projectCiStatus.activeWorkflowRun.entryPath}
                        <code>{projectCiStatus.activeWorkflowRun.entryPath}</code>
                      {/if}
                    </div>
                  {/if}

                  {#if projectCiStatus.latestRun}
                    <div class="project-ci-run-card">
                      <div class="project-ci-run-card-top">
                        <div>
                          <strong>{projectCiStatus.latestRun.workflowId}</strong>
                          <span>{projectCiStatus.latestRun.threadTitle}</span>
                        </div>
                        <span>{formatTimestamp(projectCiStatus.latestRun.updatedAt)}</span>
                      </div>
                      <p>{projectCiStatus.latestRun.summary}</p>
                      <code>{projectCiStatus.latestRun.entryPath}</code>
                    </div>
                  {/if}

                  {#if projectCiStatus.checks.length > 0}
                    <div class="project-ci-check-list" aria-label="Project CI check results">
                      {#each projectCiStatus.checks as check (check.checkResultId)}
                        <article class="project-ci-check">
                          <div class="project-ci-check-top">
                            <div class="project-ci-check-copy">
                              <strong>{check.label}</strong>
                              <span>{check.kind} · {check.status}</span>
                            </div>
                            <Badge tone={getProjectCiStatusTone(check.status)}>
                              {check.status}
                            </Badge>
                          </div>
                          <p>{check.summary}</p>
                          <div class="project-ci-check-meta">
                            <span>{check.required ? "required" : "optional"}</span>
                            {#if formatProjectCiCommand(check.command)}
                              <code>{formatProjectCiCommand(check.command)}</code>
                            {/if}
                            {#if formatProjectCiExitCode(check.exitCode)}
                              <span>{formatProjectCiExitCode(check.exitCode)}</span>
                            {/if}
                          </div>
                          {#if check.artifacts.length > 0}
                            <div class="command-inspector-artifact-list compact">
                              {#each check.artifacts as artifact (artifact.artifactId)}
                                <div class="command-inspector-artifact">
                                  <div class="command-inspector-artifact-copy">
                                    <strong>{artifact.name}</strong>
                                    <span>{artifact.kind}</span>
                                    {#if artifact.producerLabel}
                                      <span>{artifact.producerLabel}</span>
                                    {/if}
                                    {#if artifact.missingFile}
                                      <span class="artifact-missing">Missing file</span>
                                    {/if}
                                  </div>
                                  {#if canOpenArtifactLink(artifact)}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onclick={() => void handleOpenStructuredArtifact(artifact)}
                                    >
                                      Open
                                    </Button>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </article>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </section>
          {/if}

          {#if showHandlerThreadPanel}
            <section class="handler-thread-panel" aria-label="Delegated handler threads">
              <header class="handler-thread-header">
                <div>
                  <p class="handler-thread-eyebrow">Delegated Threads</p>
                  <h3>
                    {handlerThreads.length}
                    {handlerThreads.length === 1 ? " thread" : " threads"}
                  </h3>
                </div>
                <p class="handler-thread-copy">
                  Reopen a handed-back thread for follow-up chat or inspect its durable state
                  without routing every orchestrator turn through the full thread transcript.
                </p>
              </header>

              {#if handlerThreadsLoading}
                <p class="handler-thread-empty">Loading delegated thread summaries…</p>
              {:else if handlerThreadsError}
                <p class="handler-thread-empty error">{handlerThreadsError}</p>
              {:else}
                <div class="handler-thread-list">
                  {#each handlerThreads as thread (thread.threadId)}
                    <article class="handler-thread-card">
                      <div class="handler-thread-card-top">
                        <div class="handler-thread-card-copy">
                          <strong>{thread.title}</strong>
                          <p>{thread.objective}</p>
                        </div>
                        <Badge tone={getThreadStatusTone(thread.status)}>
                          {getThreadStatusLabel(thread.status)}
                        </Badge>
                      </div>

                      <p class="handler-thread-preview">{getHandlerThreadPreview(thread)}</p>

                      {#if thread.latestWorkflowRun}
                        <article class="compact-workflow-card" aria-label="Latest workflow run">
                          <div>
                            <strong>{thread.latestWorkflowRun.workflowName}</strong>
                            <span>{thread.latestWorkflowRun.summary}</span>
                          </div>
                          <Badge tone={getThreadStatusTone(thread.latestWorkflowRun.status)}>
                            {getThreadStatusLabel(thread.latestWorkflowRun.status)}
                          </Badge>
                        </article>
                      {/if}

                      <div class="handler-thread-pills">
                        <span>
                          {thread.workflowRunCount}
                          {thread.workflowRunCount === 1 ? " workflow" : " workflows"}
                        </span>
                        <span>
                          {thread.episodeCount}
                          {thread.episodeCount === 1 ? " handoff" : " handoffs"}
                        </span>
                        <span>
                          {thread.commandCount}
                          {thread.commandCount === 1 ? " command" : " commands"}
                        </span>
                        {#if thread.ciRunCount > 0}
                          <span>
                            {thread.ciRunCount}
                            {thread.ciRunCount === 1 ? " CI run" : " CI runs"}
                          </span>
                        {/if}
                        {#if thread.loadedContextKeys.length > 0}
                          <span>Context {thread.loadedContextKeys.join(", ")}</span>
                        {/if}
                      </div>

                      <div class="handler-thread-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Inspect ${thread.title}`}
                          disabled={promptBusy ||
                            mutatingSession ||
                            thread.status === "running-handler" ||
                            thread.status === "running-workflow" ||
                            thread.latestWorkflowRun?.status === "running" ||
                            thread.latestWorkflowRun?.status === "waiting"}
                          onclick={() => void handleInspectHandlerThread(thread)}
                        >
                          Inspect
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          aria-label={`Open ${thread.title}`}
                          disabled={promptBusy || mutatingSession}
                          onclick={() => void handleOpenHandlerThread(thread)}
                        >
                          Open thread
                        </Button>
                      </div>
                    </article>
                  {/each}
                </div>
              {/if}
            </section>
          {/if}

          {#if currentCommandRollups.length > 0}
            <section class="structured-command-panel" aria-label="Structured command rollups">
              <header class="structured-command-header">
                <div>
                  <p class="structured-command-eyebrow">Command History</p>
                  <h3>
                    {currentCommandRollups.length}
                    {currentCommandRollups.length === 1 ? " parent command" : " parent commands"}
                  </h3>
                </div>
                <p class="structured-command-copy">
                  Parent rollups stay visible here. Child `api.*` commands stay nested in the
                  inspector.
                </p>
              </header>

              <div class="structured-command-list">
                {#each currentCommandRollups as rollup (rollup.commandId)}
                  <button
                    class="structured-command-card"
                    type="button"
                    onclick={() => void handleInspectCommand(rollup.commandId)}
                  >
                    <div class="structured-command-card-top">
                      <div class="structured-command-card-copy">
                        <strong>{rollup.title}</strong>
                        <span>{rollup.toolName}</span>
                      </div>
                      <div class="structured-command-card-meta">
                        <span
                          class={`structured-command-status tone-${getCommandStatusTone(rollup.status)}`.trim()}
                        >
                          {getCommandStatusLabel(rollup.status)}
                        </span>
                        <span>{formatTimestamp(rollup.updatedAt)}</span>
                      </div>
                    </div>

                    <p class="structured-command-summary">{rollup.summary}</p>

                    {#if rollup.summaryChildren.length > 0}
                      <div class="structured-command-highlights" aria-label="Summary-visible child commands">
                        {#each rollup.summaryChildren as child (child.commandId)}
                          <div class="structured-command-highlight">
                            <span class="structured-command-highlight-tool">{child.toolName}</span>
                            <span>{child.summary}</span>
                          </div>
                        {/each}
                      </div>
                    {/if}

                    <div class="structured-command-card-footer">
                      <span>
                        {rollup.summaryChildCount}
                        {rollup.summaryChildCount === 1 ? " rollup detail" : " rollup details"}
                      </span>
                      <span>
                        {rollup.traceChildCount}
                        {rollup.traceChildCount === 1 ? " trace step" : " trace steps"}
                      </span>
                      <span>Inspect</span>
                    </div>
                  </button>
                {/each}
              </div>
            </section>
          {/if}

          <ChatTranscript
            {conversation}
            sessionId={currentSurfaceController?.agent.sessionId ?? "no-surface"}
            systemPrompt={currentSurfaceController?.resolvedSystemPrompt ?? ""}
            streamMessage={streamMessage ?? undefined}
            {pendingToolCalls}
            {isStreaming}
            {workspaceMentionPaths}
            onOpenArtifact={handleOpenArtifact}
            onOpenWorkspacePath={(path) => void handleOpenWorkspacePath(path)}
            onScrollStateChange={(scroll) => handleTranscriptScrollState(pane.paneId, scroll)}
          />
          <ChatComposer
            currentModel={currentModel}
            thinkingLevel={currentThinkingLevel}
            isStreaming={promptBusy}
            errorMessage={composerErrorMessage}
            {promptHistory}
            usageText={usageText || undefined}
            onAbort={() => void currentSurfaceController?.abort()}
            onOpenModelPicker={() => void openModelSelector()}
            onSend={handleSend}
            onThinkingChange={(level) => {
              currentThinkingLevel = level;
              currentSurfaceController?.agent.setThinkingLevel(level);
            }}
            listWorkspacePaths={() => runtime.listWorkspacePaths()}
          />
                </div>
              </section>
            {:else if paneController}
              <section class="chat-pane pane-readonly" aria-label="Pane transcript preview">
                <div class="chat-pane-shell">
                  <ChatTranscript
                    conversation={projectConversation(paneController.agent.state.messages)}
                    sessionId={paneController.agent.sessionId ?? pane.binding?.surfacePiSessionId ?? "no-surface"}
                    systemPrompt={paneController.resolvedSystemPrompt}
                    streamMessage={paneController.agent.state.streamMessage?.role === "assistant" ? paneController.agent.state.streamMessage : undefined}
                    pendingToolCalls={new Set(paneController.agent.state.pendingToolCalls)}
                    isStreaming={paneController.agent.state.isStreaming || paneController.promptStatus === "streaming"}
                    {workspaceMentionPaths}
                    onOpenArtifact={handleOpenArtifact}
                    onOpenWorkspacePath={(path) => void handleOpenWorkspacePath(path)}
                    onScrollStateChange={(scroll) => handleTranscriptScrollState(pane.paneId, scroll)}
                  />
                </div>
              </section>
            {:else}
              <div class="pane-placeholder">
                <p>{pane.binding ? "Surface unavailable" : "Empty pane"}</p>
                {#if pane.binding}
                  <span>{pane.binding.surfacePiSessionId}</span>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      </section>
    </section>

    {#if controller && hasArtifacts}
      {#if showDesktopSplit}
        <aside class="artifacts-slot desktop-open">
          <ArtifactsPanel
            {controller}
            snapshot={artifactsSnapshot}
            onClose={() => (showArtifactsPanel = false)}
          />
        </aside>
      {/if}

      {#if showOverlayArtifacts}
        <aside class="artifacts-slot mobile-slot">
          <div class="mobile-overlay">
            <ArtifactsPanel
              {controller}
              snapshot={artifactsSnapshot}
              overlay
              onClose={() => (showArtifactsPanel = false)}
            />
          </div>
        </aside>
      {/if}
    {/if}
  </div>

  <footer class="workspace-footer">
    <div class="workspace-footer-spacer"></div>
    <div class="workspace-footer-right">
      <button
        class="statusbar-icon"
        type="button"
        aria-label="Open command palette"
        title="Command Palette (Cmd+Shift+P)"
        onclick={() => openPalette("actions")}
      >
        <SearchIcon aria-hidden="true" size={15} strokeWidth={1.85} />
      </button>
      <button
        class="statusbar-icon"
        type="button"
        aria-label="Open quick open"
        title="Quick Open (Cmd+P)"
        onclick={() => openPalette("quick-open")}
      >
        <FileSearchIcon aria-hidden="true" size={15} strokeWidth={1.85} />
      </button>
      {#if onOpenSettings}
        <button
          class="statusbar-icon"
          type="button"
          aria-label="Open settings"
          title="Settings"
          onclick={onOpenSettings}
        >
          <SettingsIcon aria-hidden="true" size={15} strokeWidth={1.85} />
        </button>
      {/if}
    </div>
  </footer>
</div>

<CommandPalette
  open={paletteOpen}
  mode={paletteMode}
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
    allowedProviders={allowedProviders}
    storage={runtime.storage}
    onClose={() => (showModelPicker = false)}
    onSelect={(model) => {
      currentModel = model;
      currentSurfaceController?.agent.setModel(model);
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

{#if deleteTarget}
  <Dialog
    eyebrow="Session"
    title="Delete Session"
    description={`Delete "${deleteTarget.title}" permanently? This removes the pi session file and cannot be undone.`}
    width="md"
    onClose={() => (deleteTarget = null)}
  >
    <div class="session-dialog">
      <div class="session-delete-note">
        The session will disappear from the workspace navigator and cannot be restored.
      </div>
      <div class="session-dialog-actions">
        <Button variant="ghost" size="sm" onclick={() => (deleteTarget = null)}>Cancel</Button>
        <Button variant="danger" size="sm" onclick={() => void confirmDelete()} disabled={mutatingSession}>
          Delete
        </Button>
      </div>
    </div>
  </Dialog>
{/if}

{#if showThreadInspector}
  <Dialog
    eyebrow="Handler Thread"
    title={threadInspector?.title ?? "Inspect Handler Thread"}
    description="Inspect the delegated thread state, handoff history, workflow runs, artifacts, and command rollups without making full thread inspection the default orchestrator reconciliation path."
    width="lg"
    onClose={closeThreadInspector}
  >
    <div class="thread-inspector">
      {#if threadInspectorLoading}
        <p class="thread-inspector-empty">Loading delegated thread detail…</p>
      {:else if threadInspectorError}
        <p class="thread-inspector-empty error">{threadInspectorError}</p>
      {:else if threadInspector}
        <section class="thread-inspector-summary">
          <div class="thread-inspector-summary-top">
            <div class="thread-inspector-summary-copy">
              <strong>{threadInspector.title}</strong>
              <p>{threadInspector.objective}</p>
            </div>
            <div class="thread-inspector-summary-meta">
              <Badge tone={getThreadStatusTone(threadInspector.status)}>
                {getThreadStatusLabel(threadInspector.status)}
              </Badge>
              <span>{formatTimestamp(threadInspector.updatedAt)}</span>
            </div>
          </div>

          <div class="thread-inspector-pills">
            <span>
              {threadInspector.workflowRunCount}
              {threadInspector.workflowRunCount === 1 ? " workflow" : " workflows"}
            </span>
            <span>
              {threadInspector.episodeCount}
              {threadInspector.episodeCount === 1 ? " handoff" : " handoffs"}
            </span>
            <span>
              {threadInspector.commandCount}
              {threadInspector.commandCount === 1 ? " command" : " commands"}
            </span>
            {#if (threadInspector.workflowTaskAttemptCount ?? 0) > 0}
              <span>
                {threadInspector.workflowTaskAttemptCount}
                {threadInspector.workflowTaskAttemptCount === 1 ? " task attempt" : " task attempts"}
              </span>
            {/if}
            {#if threadInspector.ciRunCount > 0}
              <span>
                {threadInspector.ciRunCount}
                {threadInspector.ciRunCount === 1 ? " CI run" : " CI runs"}
              </span>
            {/if}
            {#if threadInspector.loadedContextKeys.length > 0}
              <span>Context {threadInspector.loadedContextKeys.join(", ")}</span>
            {/if}
            <span>{threadInspector.threadId}</span>
          </div>

          {#if threadInspector.wait}
            <p class="thread-inspector-wait">
              Waiting on {threadInspector.wait.owner} {threadInspector.wait.kind}: {threadInspector.wait.reason}
            </p>
          {/if}

          {#if threadInspector.latestEpisode}
            <div class="thread-inspector-highlight">
              <span>Latest handoff</span>
              <p>{threadInspector.latestEpisode.summary}</p>
            </div>
          {/if}

          {#if threadInspector.latestWorkflowRun}
            <div class="thread-inspector-highlight">
              <span>Latest workflow</span>
              <p>{threadInspector.latestWorkflowRun.summary}</p>
            </div>
          {/if}

          {#if threadLocalProjectCiRun}
            <div class="thread-inspector-highlight">
              <span>Project CI</span>
              <p>{threadLocalProjectCiRun.summary}</p>
              {#if projectCiStatus}
                <p>{formatProjectCiCheckCounts(projectCiStatus)}</p>
              {/if}
            </div>
          {/if}

          <div class="thread-inspector-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={promptBusy || mutatingSession}
              onclick={() => void handleOpenHandlerThread(threadInspector)}
            >
              Open thread
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={promptBusy || mutatingSession}
              onclick={() => void handleAskHandlerToSaveWorkflow(threadInspector)}
            >
              Ask to save workflow
            </Button>
          </div>
        </section>

        {#if threadInspector.commandRollups.length > 0}
          <section class="thread-inspector-section">
            <header class="thread-inspector-section-header">
              <div>
                <h3>Command Rollups</h3>
                <p>Inspect thread-local parent commands without flattening child steps into the main session timeline.</p>
              </div>
              <span>{threadInspector.commandRollups.length}</span>
            </header>

            <div class="thread-inspector-command-list">
              {#each threadInspector.commandRollups as rollup (rollup.commandId)}
                <article class="thread-inspector-command">
                  <div class="thread-inspector-command-top">
                    <div class="thread-inspector-command-copy">
                      <strong>{rollup.title}</strong>
                      <span>{rollup.toolName}</span>
                    </div>
                    <div class="thread-inspector-command-meta">
                      <span class={`structured-command-status tone-${getCommandStatusTone(rollup.status)}`.trim()}>
                        {getCommandStatusLabel(rollup.status)}
                      </span>
                      <span>{formatTimestamp(rollup.updatedAt)}</span>
                    </div>
                  </div>
                  <p>{rollup.summary}</p>
                  <div class="thread-inspector-command-footer">
                    <span>
                      {rollup.summaryChildCount}
                      {rollup.summaryChildCount === 1 ? " rollup detail" : " rollup details"}
                    </span>
                    <span>
                      {rollup.traceChildCount}
                      {rollup.traceChildCount === 1 ? " trace step" : " trace steps"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => void handleInspectThreadCommand(rollup.commandId)}
                    >
                      Inspect command
                    </Button>
                  </div>
                </article>
              {/each}
            </div>
          </section>
        {/if}

        {#if threadInspector.workflowRuns.length > 0}
          <section class="thread-inspector-section">
            <header class="thread-inspector-section-header">
              <div>
                <h3>Workflow Runs</h3>
                <p>Each workflow run stays attached to the supervising handler thread lifecycle.</p>
              </div>
              <span>{threadInspector.workflowRuns.length}</span>
            </header>

            <div class="thread-inspector-timeline">
              {#each threadInspector.workflowRuns as workflowRun (workflowRun.workflowRunId)}
                <article class="thread-inspector-timeline-item">
                  <div class="thread-inspector-timeline-top">
                    <strong>{workflowRun.workflowName}</strong>
                    <Badge tone={getThreadStatusTone(workflowRun.status)}>
                      {getThreadStatusLabel(workflowRun.status)}
                    </Badge>
                  </div>
                  <p>{workflowRun.summary}</p>
                  <span>{formatTimestamp(workflowRun.updatedAt)}</span>
                  {#if workflowRun.artifacts.length > 0}
                    <div class="command-inspector-artifact-list compact">
                      {#each workflowRun.artifacts as artifact (artifact.artifactId)}
                        <div class="command-inspector-artifact">
                          <div class="command-inspector-artifact-copy">
                            <strong>{artifact.name}</strong>
                            <span>{artifact.kind}</span>
                            {#if artifact.missingFile}
                              <span class="artifact-missing">Missing file</span>
                            {/if}
                          </div>
                          {#if canOpenArtifactLink(artifact)}
                            <Button
                              variant="ghost"
                              size="sm"
                              onclick={() => void handleOpenStructuredArtifact(artifact)}
                            >
                              Open
                            </Button>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          </section>
        {/if}

        {#if (threadInspector.workflowTaskAttempts?.length ?? 0) > 0}
          <section class="thread-inspector-section">
            <header class="thread-inspector-section-header">
              <div>
                <h3>Task Attempts</h3>
                <p>Inspect the Smithers task-agent attempts under this thread without promoting them into a top-level surface.</p>
              </div>
              <span>{threadInspector.workflowTaskAttempts?.length ?? 0}</span>
            </header>

            <div class="thread-inspector-command-list">
              {#each threadInspector.workflowTaskAttempts ?? [] as workflowTaskAttempt (workflowTaskAttempt.workflowTaskAttemptId)}
                <article class="thread-inspector-command">
                  <div class="thread-inspector-command-top">
                    <div class="thread-inspector-command-copy">
                      <strong>{workflowTaskAttempt.title}</strong>
                      <span>
                        {workflowTaskAttempt.nodeId}
                        · attempt {workflowTaskAttempt.attempt}
                        {#if workflowTaskAttempt.iteration > 0}
                          · iteration {workflowTaskAttempt.iteration}
                        {/if}
                      </span>
                    </div>
                    <div class="thread-inspector-command-meta">
                      <Badge tone={getWorkflowTaskAttemptStatusTone(workflowTaskAttempt.status)}>
                        {getWorkflowTaskAttemptStatusLabel(workflowTaskAttempt.status)}
                      </Badge>
                      <span>{formatTimestamp(workflowTaskAttempt.updatedAt)}</span>
                    </div>
                  </div>
                  <p>{workflowTaskAttempt.summary}</p>
                  <div class="thread-inspector-command-footer">
                    <span>
                      {workflowTaskAttempt.transcriptMessageCount}
                      {workflowTaskAttempt.transcriptMessageCount === 1 ? " transcript message" : " transcript messages"}
                    </span>
                    <span>
                      {workflowTaskAttempt.commandCount}
                      {workflowTaskAttempt.commandCount === 1 ? " command" : " commands"}
                    </span>
                    {#if workflowTaskAttempt.artifactCount > 0}
                      <span>
                        {workflowTaskAttempt.artifactCount}
                        {workflowTaskAttempt.artifactCount === 1 ? " artifact" : " artifacts"}
                      </span>
                    {/if}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => void handleInspectThreadWorkflowTaskAttempt(workflowTaskAttempt)}
                    >
                      Inspect attempt
                    </Button>
                  </div>
                </article>
              {/each}
            </div>
          </section>
        {/if}

        {#if threadInspector.episodes.length > 0}
          <section class="thread-inspector-section">
            <header class="thread-inspector-section-header">
              <div>
                <h3>Handoff History</h3>
                <p>Earlier handoff points remain durable so follow-up work can reuse the same thread.</p>
              </div>
              <span>{threadInspector.episodes.length}</span>
            </header>

            <div class="thread-inspector-timeline">
              {#each threadInspector.episodes as episode (episode.episodeId)}
                <article class="thread-inspector-timeline-item">
                  <div class="thread-inspector-timeline-top">
                    <strong>{episode.title}</strong>
                    <span>{episode.kind}</span>
                  </div>
                  <p>{episode.summary}</p>
                  <span>{formatTimestamp(episode.createdAt)}</span>
                </article>
              {/each}
            </div>
          </section>
        {/if}

        {#if threadInspector.artifacts.length > 0}
          <section class="thread-inspector-section">
            <header class="thread-inspector-section-header">
              <div>
                <h3>Artifacts</h3>
                <p>Thread-linked artifacts remain available even after the thread hands back control.</p>
              </div>
              <span>{threadInspector.artifacts.length}</span>
            </header>

            <div class="command-inspector-artifact-list">
              {#each threadInspector.artifacts as artifact (artifact.artifactId)}
                <div class="command-inspector-artifact">
                  <div class="command-inspector-artifact-copy">
                    <strong>{artifact.name}</strong>
                    <span>{artifact.kind}</span>
                    {#if artifact.producerLabel}
                      <span>{artifact.producerLabel}</span>
                    {/if}
                    {#if artifact.missingFile}
                      <span class="artifact-missing">Missing file</span>
                    {/if}
                    {#if artifact.path}
                      <code>{artifact.path}</code>
                    {/if}
                  </div>
                  {#if canOpenArtifactLink(artifact)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => void handleOpenStructuredArtifact(artifact)}
                    >
                      Open
                    </Button>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}
      {/if}
    </div>
  </Dialog>
{/if}

{#if showCommandInspector}
  <Dialog
    eyebrow="Command"
    title={commandInspector?.title ?? "Inspect Command"}
    description="Inspect the durable parent rollup and its nested child commands without promoting child steps into the main session timeline."
    width="lg"
    onClose={closeCommandInspector}
  >
    <div class="command-inspector">
      {#if commandInspectorLoading}
        <p class="command-inspector-empty">Loading structured command detail…</p>
      {:else if commandInspectorError}
        <p class="command-inspector-empty error">{commandInspectorError}</p>
      {:else if commandInspector}
        <section class="command-inspector-summary">
          <div class="command-inspector-summary-top">
            <div class="command-inspector-summary-copy">
              <strong>{commandInspector.title}</strong>
              <p>{commandInspector.summary}</p>
            </div>
            <div class="command-inspector-summary-meta">
              <span
                class={`structured-command-status tone-${getCommandStatusTone(commandInspector.status)}`.trim()}
              >
                {getCommandStatusLabel(commandInspector.status)}
              </span>
              <span>{commandInspector.toolName}</span>
              <span>{formatTimestamp(commandInspector.updatedAt)}</span>
            </div>
          </div>

          <div class="command-inspector-pills">
            <span>
              {commandInspector.summaryChildCount}
              {commandInspector.summaryChildCount === 1 ? " rollup detail" : " rollup details"}
            </span>
            <span>
              {commandInspector.traceChildCount}
              {commandInspector.traceChildCount === 1 ? " trace step" : " trace steps"}
            </span>
            {#if commandInspector.threadId}
              <span>{commandInspector.threadId}</span>
            {/if}
            {#if commandInspector.workflowTaskAttemptId}
              <Button
                variant="ghost"
                size="sm"
                onclick={() => void handleInspectCommandWorkflowTaskAttempt(commandInspector.workflowTaskAttemptId!)}
              >
                Inspect task attempt
              </Button>
            {/if}
          </div>

          {#if commandInspector.error}
            <p class="command-inspector-error">{commandInspector.error}</p>
          {/if}

          {#if formatCommandFacts(commandInspector.facts)}
            <div class="command-inspector-facts">
              <span>Facts</span>
              <pre>{formatCommandFacts(commandInspector.facts)}</pre>
            </div>
          {/if}

          {#if commandInspector.artifacts.length > 0}
            <div class="command-inspector-artifacts">
              <span>Artifacts</span>
              <div class="command-inspector-artifact-list">
                {#each commandInspector.artifacts as artifact (artifact.artifactId)}
                  <div class="command-inspector-artifact">
                    <div class="command-inspector-artifact-copy">
                      <strong>{artifact.name}</strong>
                      <span>{artifact.kind}</span>
                      {#if artifact.producerLabel}
                        <span>{artifact.producerLabel}</span>
                      {/if}
                      {#if artifact.missingFile}
                        <span class="artifact-missing">Missing file</span>
                      {/if}
                      {#if artifact.path}
                        <code>{artifact.path}</code>
                      {/if}
                    </div>
                    {#if canOpenArtifactLink(artifact)}
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => void handleOpenStructuredArtifact(artifact)}
                      >
                        Open
                      </Button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </section>

        {#if commandInspectorSections.length > 0}
          <div class="command-inspector-sections">
            {#each commandInspectorSections as section (section.id)}
              <section class="command-inspector-section">
                <header class="command-inspector-section-header">
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.description}</p>
                  </div>
                  <span>{section.children.length}</span>
                </header>

                <div class="command-inspector-child-list">
                  {#each section.children as child (child.commandId)}
                    <article class="command-inspector-child">
                      <div class="command-inspector-child-top">
                        <div class="command-inspector-child-copy">
                          <strong>{child.title}</strong>
                          <span>{child.toolName}</span>
                        </div>
                        <div class="command-inspector-child-meta">
                          <span
                            class={`structured-command-status tone-${getCommandStatusTone(child.status)}`.trim()}
                          >
                            {getCommandStatusLabel(child.status)}
                          </span>
                          <span>{formatTimestamp(child.updatedAt)}</span>
                        </div>
                      </div>

                      <p class="command-inspector-child-summary">{child.summary}</p>

                      {#if child.error}
                        <p class="command-inspector-error">{child.error}</p>
                      {/if}

                      {#if formatCommandFacts(child.facts)}
                        <div class="command-inspector-facts child-facts">
                          <span>Facts</span>
                          <pre>{formatCommandFacts(child.facts)}</pre>
                        </div>
                      {/if}

                      <div class="command-inspector-child-footer">
                        <span>{child.visibility}</span>
                        <span>{formatTimestamp(child.startedAt)}</span>
                        {#if child.finishedAt}
                          <span>{formatTimestamp(child.finishedAt)}</span>
                        {/if}
                      </div>

                      {#if child.artifacts.length > 0}
                        <div class="command-inspector-artifact-list compact">
                          {#each child.artifacts as artifact (artifact.artifactId)}
                            <div class="command-inspector-artifact">
                              <div class="command-inspector-artifact-copy">
                                <strong>{artifact.name}</strong>
                                <span>{artifact.kind}</span>
                                {#if artifact.producerLabel}
                                  <span>{artifact.producerLabel}</span>
                                {/if}
                                {#if artifact.missingFile}
                                  <span class="artifact-missing">Missing file</span>
                                {/if}
                              </div>
                              {#if canOpenArtifactLink(artifact)}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onclick={() => void handleOpenStructuredArtifact(artifact)}
                                >
                                  Open
                                </Button>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </article>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {:else}
          <p class="command-inspector-empty">No child command detail was recorded for this command.</p>
        {/if}
      {/if}
    </div>
  </Dialog>
{/if}

{#if showWorkflowTaskAttemptInspector}
  <Dialog
    eyebrow="Task Attempt"
    title={workflowTaskAttemptInspector?.title ?? "Inspect Task Attempt"}
    description="Inspect the durable workflow task attempt transcript, nested command rollups, and artifacts without opening a separate interactive surface."
    width="lg"
    onClose={closeWorkflowTaskAttemptInspector}
  >
    <div class="command-inspector">
      {#if workflowTaskAttemptInspectorLoading}
        <p class="command-inspector-empty">Loading workflow task attempt detail…</p>
      {:else if workflowTaskAttemptInspectorError}
        <p class="command-inspector-empty error">{workflowTaskAttemptInspectorError}</p>
      {:else if workflowTaskAttemptInspector}
        <section class="command-inspector-summary">
          <div class="command-inspector-summary-top">
            <div class="command-inspector-summary-copy">
              <strong>{workflowTaskAttemptInspector.title}</strong>
              <p>{workflowTaskAttemptInspector.summary}</p>
            </div>
            <div class="command-inspector-summary-meta">
              <Badge tone={getWorkflowTaskAttemptStatusTone(workflowTaskAttemptInspector.status)}>
                {getWorkflowTaskAttemptStatusLabel(workflowTaskAttemptInspector.status)}
              </Badge>
              <span>{formatTimestamp(workflowTaskAttemptInspector.updatedAt)}</span>
            </div>
          </div>

          <div class="command-inspector-pills">
            <span>{workflowTaskAttemptInspector.nodeId}</span>
            <span>attempt {workflowTaskAttemptInspector.attempt}</span>
            {#if workflowTaskAttemptInspector.iteration > 0}
              <span>iteration {workflowTaskAttemptInspector.iteration}</span>
            {/if}
            <span>{workflowTaskAttemptInspector.smithersRunId}</span>
            <span>{workflowTaskAttemptInspector.smithersState}</span>
          </div>

          {#if workflowTaskAttemptInspector.error}
            <p class="command-inspector-error">{workflowTaskAttemptInspector.error}</p>
          {/if}

          {#if formatCommandFacts(workflowTaskAttemptInspector.meta)}
            <div class="command-inspector-facts">
              <span>Meta</span>
              <pre>{formatCommandFacts(workflowTaskAttemptInspector.meta)}</pre>
            </div>
          {/if}
        </section>

        {#if workflowTaskAttemptInspector.transcript.length > 0}
          <section class="command-inspector-section">
            <header class="command-inspector-section-header">
              <div>
                <h3>Transcript</h3>
                <p>Durable prompt and reply messages for this task attempt.</p>
              </div>
              <span>{workflowTaskAttemptInspector.transcript.length}</span>
            </header>

            <div class="command-inspector-child-list">
              {#each workflowTaskAttemptInspector.transcript as message (message.messageId)}
                <article class="command-inspector-child">
                  <div class="command-inspector-child-top">
                    <div class="command-inspector-child-copy">
                      <strong>{message.role}</strong>
                      <span>{message.source}</span>
                    </div>
                    <div class="command-inspector-child-meta">
                      <span>{formatTimestamp(message.createdAt)}</span>
                    </div>
                  </div>

                  <p class="command-inspector-child-summary transcript-body">{message.text}</p>
                </article>
              {/each}
            </div>
          </section>
        {/if}

        {#if workflowTaskAttemptInspector.commandRollups.length > 0}
          <section class="command-inspector-section">
            <header class="command-inspector-section-header">
              <div>
                <h3>Commands</h3>
                <p>Nested durable command rollups attached to this task attempt.</p>
              </div>
              <span>{workflowTaskAttemptInspector.commandRollups.length}</span>
            </header>

            <div class="thread-inspector-command-list">
              {#each workflowTaskAttemptInspector.commandRollups as rollup (rollup.commandId)}
                <article class="thread-inspector-command">
                  <div class="thread-inspector-command-top">
                    <div class="thread-inspector-command-copy">
                      <strong>{rollup.title}</strong>
                      <span>{rollup.toolName}</span>
                    </div>
                    <div class="thread-inspector-command-meta">
                      <span class={`structured-command-status tone-${getCommandStatusTone(rollup.status)}`.trim()}>
                        {getCommandStatusLabel(rollup.status)}
                      </span>
                      <span>{formatTimestamp(rollup.updatedAt)}</span>
                    </div>
                  </div>
                  <p>{rollup.summary}</p>
                  <div class="thread-inspector-command-footer">
                    <span>
                      {rollup.summaryChildCount}
                      {rollup.summaryChildCount === 1 ? " rollup detail" : " rollup details"}
                    </span>
                    <span>
                      {rollup.traceChildCount}
                      {rollup.traceChildCount === 1 ? " trace step" : " trace steps"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => void handleInspectThreadCommand(rollup.commandId)}
                    >
                      Inspect command
                    </Button>
                  </div>
                </article>
              {/each}
            </div>
          </section>
        {/if}

        {#if workflowTaskAttemptInspector.artifacts.length > 0}
          <section class="command-inspector-section">
            <header class="command-inspector-section-header">
              <div>
                <h3>Artifacts</h3>
                <p>Artifacts created directly by this workflow task attempt.</p>
              </div>
              <span>{workflowTaskAttemptInspector.artifacts.length}</span>
            </header>

            <div class="command-inspector-artifact-list">
              {#each workflowTaskAttemptInspector.artifacts as artifact (artifact.artifactId)}
                <div class="command-inspector-artifact">
                  <div class="command-inspector-artifact-copy">
                    <strong>{artifact.name}</strong>
                    <span>{artifact.kind}</span>
                    {#if artifact.producerLabel}
                      <span>{artifact.producerLabel}</span>
                    {/if}
                    {#if artifact.missingFile}
                      <span class="artifact-missing">Missing file</span>
                    {/if}
                    {#if artifact.path}
                      <code>{artifact.path}</code>
                    {/if}
                  </div>
                  {#if canOpenArtifactLink(artifact)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => void handleOpenStructuredArtifact(artifact)}
                    >
                      Open
                    </Button>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}
      {/if}
    </div>
  </Dialog>
{/if}

<style>
  .workspace-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100%;
    min-height: 0;
    margin-inline: calc(var(--workspace-inset, 0rem) * -1);
  }

  .workspace-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2rem;
    padding: 0 0.72rem 0;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 58%, transparent);
    background:
      linear-gradient(180deg, color-mix(in oklab, var(--ui-bg-elevated) 78%, transparent), transparent),
      color-mix(in oklab, var(--ui-shell) 62%, transparent);
  }

  .workspace-titlebar-start {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    padding-left: clamp(4.3rem, 8vw, 5.2rem);
  }

  .workspace-titlebar-title {
    margin: 0;
    font-size: 0.74rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--ui-text-secondary);
    white-space: nowrap;
  }

  .workspace-titlebar-actions {
    display: flex;
    align-items: center;
    gap: 0.16rem;
  }

  .titlebar-icon,
  .statusbar-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: calc(var(--ui-radius-sm) + 0.14rem);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
    transition:
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .titlebar-icon {
    width: 1.9rem;
    height: 1.35rem;
  }

  .chat-workspace {
    --sidebar-width: 292px;
    position: relative;
    display: grid;
    grid-template-columns: var(--sidebar-width) 0.72rem minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    padding: 0 0.72rem 0.52rem;
  }

  .chat-workspace.sidebar-hidden {
    grid-template-columns: minmax(0, 1fr);
  }

  .chat-workspace.split {
    grid-template-columns: var(--sidebar-width) 0.72rem minmax(0, 1fr) minmax(22rem, 28rem);
  }

  .chat-workspace.sidebar-hidden.split {
    grid-template-columns: minmax(0, 1fr) minmax(22rem, 28rem);
  }

  .workspace-sidebar,
  .workspace-main,
  .artifacts-slot {
    min-height: 0;
  }

  .workspace-sidebar {
    overflow: hidden;
  }

  .sidebar-surface {
    height: 100%;
    min-height: 0;
    padding: 0.95rem 0.75rem 0.9rem 0.2rem;
    border-right: 1px solid color-mix(in oklab, var(--ui-shell-edge) 56%, transparent);
    background:
      linear-gradient(180deg, color-mix(in oklab, var(--ui-bg-elevated) 84%, transparent), transparent 20%),
      color-mix(in oklab, var(--ui-panel) 90%, transparent);
  }

  .sidebar-resize-handle {
    position: relative;
    min-height: 0;
    cursor: col-resize;
    touch-action: none;
  }

  .sidebar-resize-handle::before {
    content: "";
    position: absolute;
    top: 0.75rem;
    bottom: 0.75rem;
    left: 50%;
    width: 0.14rem;
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
    gap: 0.8rem;
    min-height: 0;
    padding: 0.35rem 0 0;
  }

  .pane-grid {
    position: relative;
    display: grid;
    min-height: 0;
    gap: 0.65rem;
    overflow: hidden;
  }

  .pane-span-drop-zone {
    position: absolute;
    z-index: 8;
    left: 0.8rem;
    right: 0.8rem;
    height: 1.45rem;
    border: 1px dashed color-mix(in oklab, var(--ui-accent) 48%, var(--ui-shell-edge));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-accent) 13%, var(--ui-shell));
    color: color-mix(in oklab, var(--ui-text) 78%, var(--ui-muted));
    font-size: 0.68rem;
    font-weight: 650;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 140ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 140ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .pane-span-drop-zone.top {
    top: 0.55rem;
  }

  .pane-span-drop-zone.bottom {
    bottom: 0.55rem;
  }

  .pane-grid.dragging-pane .pane-span-drop-zone,
  .pane-span-drop-zone:focus-visible,
  .pane-span-drop-zone:hover {
    opacity: 1;
    pointer-events: auto;
  }

  .pane-span-drop-zone:hover,
  .pane-span-drop-zone:focus-visible {
    background: color-mix(in oklab, var(--ui-accent) 22%, var(--ui-shell));
  }

  .workspace-pane {
    position: relative;
    container-type: inline-size;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 16.25rem;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-shell-edge) 70%, transparent);
    border-radius: calc(var(--ui-radius-xl) + 0.12rem);
    background: color-mix(in oklab, var(--ui-shell) 88%, transparent);
  }

  .pane-placement-zones {
    position: absolute;
    inset: 2.4rem 0.55rem 0.55rem;
    z-index: 7;
    display: grid;
    grid-template:
      ". above ." 1fr
      "left replace right" 1fr
      ". below ." 1fr / 1fr 1fr 1fr;
    gap: 0.28rem;
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .pane-grid.dragging-pane .pane-placement-zones {
    opacity: 1;
    pointer-events: auto;
  }

  .pane-placement-zone {
    border: 1px dashed color-mix(in oklab, var(--ui-accent) 52%, var(--ui-shell-edge));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-accent) 10%, transparent);
    color: var(--ui-text-secondary);
    font-size: 0.64rem;
    font-weight: 700;
  }

  .pane-placement-zone:hover,
  .pane-placement-zone:focus-visible {
    background: color-mix(in oklab, var(--ui-accent) 20%, var(--ui-shell));
    color: var(--ui-text);
  }

  .pane-placement-zone.replace {
    grid-area: replace;
  }

  .pane-placement-zone.left {
    grid-area: left;
  }

  .pane-placement-zone.right {
    grid-area: right;
  }

  .pane-placement-zone.above {
    grid-area: above;
  }

  .pane-placement-zone.below {
    grid-area: below;
  }

  .workspace-pane.focused {
    border-color: color-mix(in oklab, var(--ui-accent) 58%, var(--ui-shell-edge));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--ui-accent) 18%, transparent);
  }

  .pane-chrome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    min-height: 2.25rem;
    padding: 0.42rem 0.58rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 58%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 62%, transparent);
  }

  .pane-focus-button {
    display: grid;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pane-focus-button strong,
  .pane-focus-button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-focus-button strong {
    font-size: 0.72rem;
  }

  .pane-focus-button span {
    font-size: 0.64rem;
    color: var(--ui-text-tertiary);
  }

  .pane-chrome-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    flex-shrink: 0;
  }

  .pane-chrome-actions button {
    display: inline-grid;
    place-items: center;
    width: 1.55rem;
    height: 1.55rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
  }

  .pane-resize-button.vertical {
    cursor: col-resize;
  }

  .pane-resize-button.horizontal {
    cursor: row-resize;
  }

  .pane-chrome-actions button:hover {
    border-color: color-mix(in oklab, var(--ui-shell-edge) 78%, transparent);
    color: var(--ui-text-primary);
    background: color-mix(in oklab, var(--ui-surface-raised) 72%, transparent);
  }

  .pane-placeholder {
    display: grid;
    place-content: center;
    gap: 0.3rem;
    min-height: 0;
    padding: 1rem;
    color: var(--ui-text-tertiary);
    text-align: center;
  }

  .pane-placeholder p {
    margin: 0;
    color: var(--ui-text-secondary);
    font-weight: 700;
  }

  .pane-placeholder span {
    font-size: 0.72rem;
  }

  .workspace-main-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.9rem;
    padding: 0.15rem 0 0 0.65rem;
  }

  .workspace-main-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }

  .workspace-main-title {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.96rem;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .workspace-main-subtitle {
    margin: 0.24rem 0 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.74rem;
    color: var(--ui-text-tertiary);
  }

  .workspace-main-meta {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.45rem 0.6rem;
    font-size: 0.7rem;
    color: var(--ui-text-tertiary);
  }

  .project-ci-compact {
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    max-width: min(38rem, 100%);
    min-height: 1.72rem;
    padding: 0.18rem 0.28rem;
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-subtle) 70%, transparent);
  }

  .project-ci-compact span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    background:
      linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 80%, transparent), transparent),
      color-mix(in oklab, var(--ui-shell) 88%, transparent);
  }

  .project-ci-panel,
  .handler-thread-panel,
  .structured-command-panel {
    display: grid;
    flex: 0 0 auto;
    gap: 0.72rem;
    padding: 0.72rem 0.9rem 0.66rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 66%, transparent);
    background:
      linear-gradient(
        180deg,
        color-mix(in oklab, var(--ui-surface-raised) 78%, transparent),
        transparent
      ),
      color-mix(in oklab, var(--ui-surface-subtle) 54%, transparent);
  }

  .project-ci-header,
  .handler-thread-header,
  .structured-command-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    min-width: 0;
  }

  .project-ci-header > div,
  .handler-thread-header > div,
  .structured-command-header > div {
    min-width: 0;
    flex: 0 0 auto;
  }

  .project-ci-header h3,
  .project-ci-eyebrow,
  .handler-thread-header h3,
  .handler-thread-eyebrow,
  .handler-thread-copy,
  .structured-command-header h3,
  .structured-command-eyebrow,
  .structured-command-copy {
    margin: 0;
  }

  .project-ci-eyebrow,
  .handler-thread-eyebrow,
  .structured-command-eyebrow {
    font-size: 0.64rem;
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ui-text-tertiary);
  }

  .project-ci-header h3,
  .handler-thread-header h3,
  .structured-command-header h3 {
    margin-top: 0.18rem;
    font-size: 0.86rem;
    font-weight: 680;
    letter-spacing: -0.02em;
    color: var(--ui-text-primary);
  }

  .handler-thread-copy,
  .structured-command-copy {
    max-width: 42rem;
    min-width: 0;
    text-align: right;
  }

  .handler-thread-copy,
  .structured-command-copy {
    max-width: 28rem;
    font-size: 0.72rem;
    line-height: 1.5;
    color: var(--ui-text-secondary);
  }

  .project-ci-body {
    display: grid;
    gap: 0.56rem;
  }

  .project-ci-summary,
  .project-ci-muted,
  .project-ci-empty,
  .project-ci-run-card p,
  .project-ci-check p {
    margin: 0;
    font-size: 0.73rem;
    line-height: 1.52;
    color: var(--ui-text-secondary);
  }

  .project-ci-summary {
    color: var(--ui-text-primary);
  }

  .project-ci-muted {
    color: var(--ui-text-tertiary);
  }

  .project-ci-entries,
  .project-ci-check-list {
    display: grid;
    gap: 0.45rem;
  }

  .project-ci-entry,
  .project-ci-run-card,
  .project-ci-check {
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface) 94%, transparent);
  }

  .project-ci-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.62rem;
  }

  .project-ci-entry strong,
  .project-ci-run-card strong,
  .project-ci-check-copy strong {
    font-size: 0.76rem;
    font-weight: 660;
    color: var(--ui-text-primary);
  }

  .project-ci-entry span,
  .project-ci-run-card span,
  .project-ci-check-copy span,
  .project-ci-check-meta {
    font-size: 0.68rem;
    color: var(--ui-text-tertiary);
  }

  .project-ci-entry span,
  .project-ci-run-card code,
  .project-ci-check-meta code {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .project-ci-run-card,
  .project-ci-check {
    display: grid;
    gap: 0.45rem;
    padding: 0.68rem 0.72rem;
  }

  .project-ci-run-card-top,
  .project-ci-check-top,
  .project-ci-check-meta {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.72rem;
  }

  .project-ci-run-card-top > div,
  .project-ci-check-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.15rem;
  }

  .project-ci-run-card code,
  .project-ci-check-meta code {
    font-family: var(--font-mono);
    font-size: 0.67rem;
    color: var(--ui-text-secondary);
  }

  .project-ci-check-meta {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .handler-thread-list {
    display: grid;
    gap: 0.55rem;
    max-height: 9rem;
    overflow: auto;
    padding-right: 0.1rem;
  }

  .handler-thread-card {
    display: grid;
    gap: 0.62rem;
    padding: 0.8rem 0.85rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-raised) 92%, transparent);
  }

  .compact-workflow-card {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.62rem;
    border: 1px solid color-mix(in oklab, var(--ui-shell-edge) 58%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
  }

  .compact-workflow-card div {
    display: grid;
    gap: 0.16rem;
    min-width: 0;
  }

  .compact-workflow-card strong,
  .compact-workflow-card span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compact-workflow-card strong {
    font-size: 0.72rem;
    color: var(--ui-text-primary);
  }

  .compact-workflow-card span {
    font-size: 0.67rem;
    color: var(--ui-text-secondary);
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

  .handler-thread-card-top,
  .structured-command-card-top,
  .structured-command-card-footer,
  .thread-inspector-summary-top,
  .thread-inspector-command-top,
  .thread-inspector-timeline-top,
  .thread-inspector-section-header,
  .command-inspector-summary-top,
  .command-inspector-child-top,
  .command-inspector-artifact {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.85rem;
  }

  .handler-thread-card-copy,
  .structured-command-card-copy,
  .thread-inspector-summary-copy,
  .thread-inspector-command-copy,
  .command-inspector-summary-copy,
  .command-inspector-child-copy,
  .command-inspector-artifact-copy {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    min-width: 0;
  }

  .handler-thread-card-copy strong,
  .structured-command-card-copy strong,
  .thread-inspector-summary-copy strong,
  .thread-inspector-command-copy strong,
  .command-inspector-summary-copy strong,
  .command-inspector-child-copy strong {
    font-size: 0.8rem;
    font-weight: 660;
    letter-spacing: -0.02em;
    color: var(--ui-text-primary);
  }

  .handler-thread-card-copy p,
  .handler-thread-preview,
  .structured-command-card-copy span,
  .thread-inspector-summary-copy p,
  .thread-inspector-highlight p,
  .thread-inspector-command p,
  .thread-inspector-timeline-item p,
  .command-inspector-summary-copy p,
  .structured-command-summary,
  .command-inspector-child-summary,
  .command-inspector-artifact-copy span {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.5;
    color: var(--ui-text-secondary);
  }

  .handler-thread-pills,
  .handler-thread-actions,
  .structured-command-card-meta,
  .thread-inspector-summary-meta,
  .thread-inspector-pills,
  .thread-inspector-actions,
  .thread-inspector-command-meta,
  .thread-inspector-command-footer,
  .command-inspector-summary-meta,
  .command-inspector-child-meta,
  .command-inspector-child-footer,
  .command-inspector-pills {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    justify-content: flex-end;
    font-size: 0.66rem;
    color: var(--ui-text-tertiary);
  }

  .structured-command-status {
    font-size: 0.66rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .structured-command-status.tone-success {
    color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
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

  .structured-command-summary,
  .command-inspector-child-summary {
    color: var(--ui-text-primary);
  }

  .handler-thread-preview,
  .thread-inspector-highlight p,
  .thread-inspector-command p,
  .thread-inspector-timeline-item p {
    color: var(--ui-text-primary);
  }

  .handler-thread-pills span,
  .thread-inspector-pills span,
  .thread-inspector-command-footer span,
  .command-inspector-pills span,
  .command-inspector-child-footer span {
    display: inline-flex;
    align-items: center;
    min-height: 1rem;
    padding: 0.14rem 0.42rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
  }

  .handler-thread-actions,
  .thread-inspector-actions,
  .thread-inspector-command-footer {
    justify-content: flex-end;
  }

  .structured-command-highlights,
  .thread-inspector-highlight,
  .thread-inspector-command-list,
  .thread-inspector-timeline,
  .command-inspector-sections,
  .command-inspector-child-list,
  .command-inspector-artifact-list {
    display: grid;
    gap: 0.45rem;
  }

  .thread-inspector-summary,
  .thread-inspector-section,
  .thread-inspector-command,
  .thread-inspector-timeline-item,
  .structured-command-highlight,
  .command-inspector-child,
  .command-inspector-summary,
  .command-inspector-section,
  .command-inspector-artifact {
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface) 94%, transparent);
  }

  .thread-inspector-highlight,
  .thread-inspector-command,
  .thread-inspector-timeline-item {
    padding: 0.72rem 0.76rem;
  }

  .thread-inspector-highlight span,
  .thread-inspector-section-header p,
  .thread-inspector-timeline-item span,
  .thread-inspector-timeline-top span {
    font-size: 0.7rem;
    color: var(--ui-text-secondary);
  }

  .thread-inspector-section-header {
    margin-bottom: 0.72rem;
  }

  .thread-inspector-section-header h3,
  .thread-inspector-section-header p {
    margin: 0;
  }

  .thread-inspector-section-header h3 {
    font-size: 0.82rem;
    font-weight: 660;
    color: var(--ui-text-primary);
  }

  .thread-inspector-section-header > span {
    font-size: 0.7rem;
    color: var(--ui-text-tertiary);
  }

  .structured-command-highlight {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.56rem;
    font-size: 0.7rem;
    color: var(--ui-text-secondary);
  }

  .structured-command-highlight-tool {
    font-family: var(--font-mono);
    font-size: 0.64rem;
    color: var(--ui-text-tertiary);
  }

  .structured-command-card-footer {
    font-size: 0.66rem;
    color: var(--ui-text-tertiary);
  }

  .thread-inspector,
  .command-inspector {
    display: grid;
    gap: 0.85rem;
  }

  .thread-inspector-summary,
  .thread-inspector-section,
  .command-inspector-summary,
  .command-inspector-section {
    padding: 0.84rem 0.9rem;
  }

  .thread-inspector-summary-copy p,
  .command-inspector-summary-copy p {
    max-width: 44rem;
  }

  .handler-thread-empty,
  .project-ci-empty,
  .thread-inspector-empty,
  .thread-inspector-wait,
  .command-inspector-error,
  .command-inspector-empty {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.55;
    color: var(--ui-text-secondary);
  }

  .command-inspector-error {
    color: color-mix(in oklab, var(--ui-danger) 80%, var(--ui-text-primary));
  }

  .handler-thread-empty,
  .project-ci-empty,
  .thread-inspector-empty,
  .command-inspector-empty {
    padding: 0.9rem;
    border-radius: var(--ui-radius-md);
    border: 1px dashed color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
  }

  .handler-thread-empty.error,
  .project-ci-empty.error,
  .thread-inspector-empty.error,
  .command-inspector-empty.error {
    border-color: color-mix(in oklab, var(--ui-danger) 32%, transparent);
    background: color-mix(in oklab, var(--ui-danger-soft) 72%, transparent);
  }

  .command-inspector-facts,
  .command-inspector-artifacts {
    display: grid;
    gap: 0.42rem;
    margin-top: 0.72rem;
  }

  .command-inspector-facts span,
  .command-inspector-artifacts span,
  .command-inspector-section-header p {
    font-size: 0.7rem;
    color: var(--ui-text-secondary);
  }

  .command-inspector-facts pre {
    margin: 0;
    overflow: auto;
    padding: 0.72rem 0.76rem;
    border-radius: var(--ui-radius-sm);
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
    background: color-mix(in oklab, var(--ui-code) 92%, transparent);
    font-size: 0.75rem;
    line-height: 1.56;
    color: var(--ui-text-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .command-inspector-section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.85rem;
    margin-bottom: 0.72rem;
  }

  .command-inspector-section-header h3,
  .command-inspector-section-header p {
    margin: 0;
  }

  .command-inspector-section-header h3 {
    font-size: 0.82rem;
    font-weight: 660;
    color: var(--ui-text-primary);
  }

  .command-inspector-section-header > span {
    font-size: 0.7rem;
    color: var(--ui-text-tertiary);
  }

  .command-inspector-child {
    padding: 0.76rem 0.8rem;
  }

  .command-inspector-artifact {
    padding: 0.55rem 0.62rem;
  }

  .command-inspector-artifact-copy strong {
    font-size: 0.74rem;
    font-weight: 640;
    color: var(--ui-text-primary);
  }

  .command-inspector-artifact-copy code {
    font-size: 0.68rem;
    color: var(--ui-text-tertiary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .artifact-missing {
    color: color-mix(in oklab, var(--ui-warning) 84%, var(--ui-text-primary));
  }

  .command-inspector-artifact-list.compact {
    margin-top: 0.72rem;
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

  .session-delete-note {
    padding: 0.8rem;
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-danger-soft) 84%, transparent);
    color: color-mix(in oklab, var(--ui-danger) 80%, var(--ui-text-primary));
    font-size: 0.76rem;
    line-height: 1.5;
  }

  .desktop-open {
    min-height: 0;
    padding-left: 0.72rem;
  }

  .mobile-slot {
    position: fixed;
    inset: 0;
    z-index: var(--ui-z-overlay);
  }

  .mobile-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: flex-end;
    padding: 0.8rem;
    background: color-mix(in oklab, black 26%, transparent);
    backdrop-filter: blur(8px);
  }

  .workspace-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 1.65rem;
    padding: 0 0.42rem;
    border-top: 1px solid color-mix(in oklab, var(--ui-shell-edge) 72%, transparent);
    background:
      linear-gradient(180deg, color-mix(in oklab, var(--ui-panel-strong) 72%, transparent), transparent 55%),
      color-mix(in oklab, var(--ui-panel) 96%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in oklab, white 8%, transparent);
  }

  .workspace-footer-spacer,
  .workspace-footer-right {
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }

  .statusbar-icon {
    width: 1.8rem;
    height: 1.2rem;
  }

  .titlebar-icon:hover,
  .titlebar-icon[aria-pressed="true"],
  .statusbar-icon:hover {
    background: color-mix(in oklab, var(--ui-surface-subtle) 74%, transparent);
    color: var(--ui-text-primary);
  }

  .titlebar-icon[aria-pressed="true"] {
    color: color-mix(in oklab, var(--ui-accent) 64%, var(--ui-text-primary));
  }

  .titlebar-icon:focus-visible,
  .statusbar-icon:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  :global(body.sidebar-resizing) {
    cursor: col-resize;
    user-select: none;
  }

  @media (max-width: 1220px) {
    .chat-workspace.split {
      grid-template-columns: var(--sidebar-width) 0.72rem minmax(0, 1fr);
    }

    .chat-workspace.sidebar-hidden.split {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 980px) {
    .workspace-main {
      padding-top: 0.2rem;
    }

    .workspace-main-header {
      flex-direction: column;
      align-items: stretch;
      padding-left: 0.4rem;
    }

    .workspace-main-meta {
      justify-content: flex-start;
    }

    .project-ci-header,
    .project-ci-entry,
    .project-ci-run-card-top,
    .project-ci-check-top,
    .project-ci-check-meta,
    .structured-command-header,
    .structured-command-card-top,
    .structured-command-card-footer,
    .command-inspector-summary-top,
    .command-inspector-child-top,
    .command-inspector-artifact,
    .command-inspector-section-header {
      flex-direction: column;
      align-items: stretch;
    }

    .structured-command-copy,
    .command-inspector-summary-copy p {
      max-width: none;
    }

    .project-ci-check-meta,
    .structured-command-card-meta,
    .command-inspector-summary-meta,
    .command-inspector-child-meta {
      justify-content: flex-start;
    }
  }

  @media (max-width: 760px) {
    .workspace-titlebar {
      padding-inline: 0.32rem;
    }

    .workspace-titlebar-start {
      padding-left: 0;
    }

    .chat-workspace {
      padding-inline: 0;
      padding-bottom: 0;
    }

    .workspace-shell {
      margin-inline: 0;
    }
  }
</style>
