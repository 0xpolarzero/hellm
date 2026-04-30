<script lang="ts">
  import { onMount } from "svelte";
  import PanelLeftCloseIcon from "@lucide/svelte/icons/panel-left-close";
  import PanelLeftOpenIcon from "@lucide/svelte/icons/panel-left-open";
  import FileSearchIcon from "@lucide/svelte/icons/file-search";
  import SearchIcon from "@lucide/svelte/icons/search";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import Grid2x2Icon from "@lucide/svelte/icons/grid-2x2";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";
  import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import CopyPlusIcon from "@lucide/svelte/icons/copy-plus";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import XIcon from "@lucide/svelte/icons/x";
  import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
  import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
  import type { SessionMode } from "../shared/agent-settings";
  import ArtifactsPanel from "./ArtifactsPanel.svelte";
  import { ArtifactsController, type ArtifactsSnapshot } from "./artifacts";
  import ChatComposer from "./ChatComposer.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import ContextBudgetBar from "./ContextBudgetBar.svelte";
  import RelatedInspectorPane from "./RelatedInspectorPane.svelte";
  import SavedWorkflowLibraryPane from "./SavedWorkflowLibraryPane.svelte";
  import WorkflowInspectorPane from "./WorkflowInspectorPane.svelte";
  import { formatTimestamp, formatUsage } from "./chat-format";
  import {
    getCommandInspectorSections,
    getVisibleCommandRollups,
    getWorkspaceCommandStatusPresentation,
  } from "./command-inspector";
  import {
    buildContextBudgetFromUsage,
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
    WorkspacePaneSurfaceTarget,
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
  import { getViewportClass, shouldUseDesktopInspectorSplit, shouldUseNarrowShell } from "./responsive-layout";
  import SessionSidebar from "./SessionSidebar.svelte";
  import ChatTranscript from "./ChatTranscript.svelte";
  import {
    PRIMARY_CHAT_PANE_ID,
    type ChatRuntime,
    type ChatPaneLayoutState,
    type ChatPaneState,
    type ChatSurfaceController,
  } from "./chat-runtime";
  import {
    createEmptyPaneLayout,
    getPaneGridSplitControls,
    getOpenPaneLocations,
    type PaneGridSplitControl,
    type PanePlacementZone,
    type PaneResizeAxis,
    type PaneSpanPlacement,
    type PaneSplitDirection,
  } from "./pane-layout";
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
  import EpisodeCard, { type ReferenceEpisode } from "./reference-cards/EpisodeCard.svelte";
  import VerificationCard, { type ReferenceVerification } from "./reference-cards/VerificationCard.svelte";
  import type { ReferenceStatus } from "./reference-cards/StatusBadge.svelte";
  import type { ReferenceSubagent } from "./reference-cards/SubagentCard.svelte";
  import ThreadCard, { type ReferenceThread } from "./reference-cards/ThreadCard.svelte";
  import WaitingCard from "./reference-cards/WaitingCard.svelte";
  import WorkflowCard, { type ReferenceWorkflow } from "./reference-cards/WorkflowCard.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Input from "./ui/Input.svelte";
  import MetadataChip from "./ui/MetadataChip.svelte";

  const DEFAULT_SIDEBAR_WIDTH = 240;

  type Props = {
    runtime: ChatRuntime;
    onOpenSettings?: () => void;
  };

  type ActivePaneResize = {
    axis: PaneResizeAxis;
    gridSizePx: number;
    lastClientPosition: number;
    pointerId: number;
    trackIndex: number;
  };

  type ActivePaneDrag = {
    hasMoved: boolean;
    lastX: number;
    lastY: number;
    pointerId: number;
    sourcePaneId: string;
    startX: number;
    startY: number;
  };

  type PaneSplitAction = {
    direction: PaneSplitDirection;
    paneId: string;
  };

  type PaneDropPreview = {
    targetPaneId: string;
    zone: PanePlacementZone;
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
  let currentSessionMode = $state<SessionMode>("orchestrator");
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
  let activePaneResize = $state<ActivePaneResize | null>(null);
  let activePaneDrag = $state<ActivePaneDrag | null>(null);
  let paneDropPreview = $state<PaneDropPreview | null>(null);
  let paneSpanDropPreview = $state<PaneSpanPlacement | null>(null);
  let mutatingSession = $state(false);
  let sendingPrompt = $state(false);
  let renameTarget = $state<WorkspaceSessionSummary | null>(null);
  let renameValue = $state("");
  let deleteTarget = $state<WorkspaceSessionSummary | null>(null);
  let sidebarResizeHandle = $state<HTMLDivElement | null>(null);
  let paneGridElement = $state<HTMLElement | null>(null);
  let artifactSyncSessionId: string | undefined = undefined;
  let artifactSyncMessageCount = 0;
  let copyTranscriptState = $state<{
    paneId: string | null;
    status: "idle" | "copying" | "copied" | "error";
  }>({
    paneId: null,
    status: "idle",
  });
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
    shouldUseDesktopInspectorSplit(windowWidth) && showArtifactsPanel && hasArtifacts,
  );
  const showOverlayArtifacts = $derived(
    !shouldUseDesktopInspectorSplit(windowWidth) && showArtifactsPanel && hasArtifacts,
  );
  const viewportClass = $derived(getViewportClass(windowWidth));
  const narrowShell = $derived(shouldUseNarrowShell(windowWidth));
  const effectiveSidebarWidth = $derived(clampSidebarWidth(sidebarWidth, windowWidth));
  const currentSession = $derived(sessions.find((session) => session.id === activeSessionId) ?? null);
  const currentCommandRollups = $derived(getVisibleCommandRollups(currentSession));
  const currentSurface = $derived(focusedSurfaceTarget);
  const paneSplitControls = $derived.by(() => getPaneGridSplitControls(paneLayout));
  const paneLocationsBySessionId = $derived(
    Object.fromEntries(
      sessions.map((session) => [
        session.id,
        getOpenPaneLocations(
          paneLayout,
          (binding) => binding.workspaceSessionId === session.id,
        ),
      ]),
    ),
  );
  const currentSurfaceLabel = $derived.by(() => {
    if (currentSurface?.surface === "thread") {
      return `Messaging handler thread ${currentSurface.threadId ?? currentSurface.surfacePiSessionId}`;
    }

    if (currentSessionMode === "quick") {
      return "Messaging quick session";
    }

    return "Messaging orchestrator";
  });
  const currentWorktreeSummary = $derived(runtime.branch ? runtime.branch : "workspace");
  function formatPaneSurfaceLabel(
    paneController: ChatSurfaceController | null,
    binding?: WorkspacePaneSurfaceTarget | null,
  ): string {
    if (binding?.surface === "workflow-inspector") {
      return "Workflow Inspector";
    }
    if (binding?.surface === "saved-workflow-library") {
      return "Saved Workflow Library";
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
    if (binding?.surface === "project-ci-check") {
      return "Project CI Check";
    }
    if (paneController?.target.surface === "thread") {
      return "Handler Thread";
    }
    return paneController?.sessionMode === "quick" ? "Quick Session" : "Orchestrator";
  }
  function formatPaneAgentSummary(
    paneController: ChatSurfaceController | null,
    binding?: WorkspacePaneSurfaceTarget | null,
  ): string {
    if (binding?.surface === "workflow-inspector") {
      return binding.workflowRunId;
    }
    if (binding?.surface === "saved-workflow-library") {
      return ".svvy/workflows";
    }
    if (binding && binding.surface !== "orchestrator" && binding.surface !== "thread") {
      return binding.workspaceSessionId;
    }
    const model = paneController?.agent.state.model;
    const thinking = paneController?.agent.state.thinkingLevel;
    if (!model) return "No agent";
    return `${model.provider}/${model.id} · ${thinking}`;
  }
  function formatPaneDropActionLabel(zone: PanePlacementZone): string {
    switch (zone) {
      case "left":
        return "Place left";
      case "right":
        return "Place right";
      case "above":
        return "Place above";
      case "below":
        return "Place below";
      case "replace":
      default:
        return "Replace pane";
    }
  }
  function formatPaneDragSourceLabel(paneId: string | null): string {
    if (!paneId) return "Pane";
    const pane = paneLayout.panes.find((candidate) => candidate.paneId === paneId);
    return formatPaneSurfaceLabel(runtime.getPaneController(paneId), pane?.binding ?? null);
  }
  function formatPaneLocationMetadata(
    binding?: WorkspacePaneSurfaceTarget | null,
  ): { label: string; value: string } {
    if (binding?.surface === "workflow-inspector") return { label: "surface", value: "workflow" };
    if (binding?.surface === "saved-workflow-library") return { label: "surface", value: "library" };
    if (binding?.surface === "command") return { label: "surface", value: "command" };
    if (binding?.surface === "workflow-task-attempt") return { label: "surface", value: "task" };
    if (binding?.surface === "artifact") return { label: "surface", value: "artifact" };
    if (binding?.surface === "project-ci-check") return { label: "surface", value: "project-ci" };
    if (runtime.branch) return { label: "worktree", value: runtime.branch };
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
  const usageText = $derived(formatUsage(conversation.usage));
  const contextBudget = $derived(
    buildContextBudgetFromUsage(conversationSummary.latestContextUsage, currentModel?.contextWindow),
  );
  const summaryMessageCount = $derived(conversationSummary.messageCount);
  const paneLayoutSummary = $derived(`${paneLayout.columns.length}×${paneLayout.rows.length}`);
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
  function getCopyTranscriptLabel(paneId: string): string {
    if (copyTranscriptState.paneId !== paneId) {
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
  const commandInspectorSections = $derived(getCommandInspectorSections(commandInspector));
  const showHandlerThreadPanel = $derived(
    currentSurface?.surface === "orchestrator" &&
      (handlerThreadsLoading || !!handlerThreadsError || handlerThreads.length > 0),
  );
  const hasActionableProjectCiStatus = $derived(
    !!projectCiError ||
      !!projectCiStatus?.activeWorkflowRun ||
      !!projectCiStatus?.latestRun ||
      (projectCiStatus?.entries.length ?? 0) > 0 ||
      (projectCiStatus?.checks.length ?? 0) > 0,
  );
  const showDetailedProjectCiPanel = $derived(
    currentSurface?.surface === "orchestrator" && currentSession && hasActionableProjectCiStatus,
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
      !showHandlerThreadPanel &&
      !showDetailedProjectCiPanel,
  );
  const recentSessionSuggestions = $derived(
    sessions.filter((session) => session.id !== activeSessionId).slice(0, 3),
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
      copyTranscriptState = { paneId: null, status: "idle" };
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
    if (sidebarHidden || narrowShell || !sidebarResizeHandle) return;
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
    setTimeout(() => {
      paletteMode = mode;
      paletteError = undefined;
      paletteOpen = true;
    }, 0);
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
    window.setTimeout(
      () =>
        void runPaletteMutation(() =>
          executeCommandAction({
            runtime,
            action,
            paneId,
            onOpenSettings: () => onOpenSettings?.(),
            onOpenWorkflowTaskAttempt: ({ workspaceSessionId, workflowTaskAttemptId }) =>
              handleInspectWorkflowTaskAttempt({ workflowTaskAttemptId }, workspaceSessionId),
          }),
        ),
      0,
    );
  }

  async function handlePaletteFallbackPrompt(prompt: string, event: KeyboardEvent) {
    const paneId = getCommandExecutionPaneId({
      placement: getCommandPalettePlacement(event),
      focusedPaneId,
    });
    window.setTimeout(
      () =>
        void runPaletteMutation(async () => {
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
        }),
      0,
    );
  }

  async function handleCreateSession() {
    await runSessionMutation(() => runtime.createSession({}, { kind: "new-pane", direction: "right" }));
  }

  async function handleCreateQuickSession() {
    await runSessionMutation(() =>
      runtime.createSession({ mode: "quick" }, { kind: "new-pane", direction: "right" }),
    );
  }

  async function handleSelectCurrentSessionMode(mode: SessionMode) {
    if (currentSessionMode === mode) {
      return;
    }
    await runSessionMutation(() => runtime.setSessionMode(focusedPaneId, mode));
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

  async function handleDuplicatePane(paneId: string) {
    await runSessionMutation(async () => {
      const nextPaneId = await runtime.splitPane(paneId, "right", { duplicateBinding: true });
      if (nextPaneId) {
        runtime.focusPane(nextPaneId);
      }
    });
  }

  async function handleClosePane(paneId: string) {
    await runSessionMutation(() => runtime.closePane(paneId));
  }

  function handleResizeTrack(axis: "column" | "row", index: number, deltaPercent: number) {
    runtime.resizePaneTrack(axis, index, deltaPercent);
    syncRuntimeState();
  }

  function getPaneSplitControlTestId(control: PaneGridSplitControl): string {
    if (control.axis === "column") {
      if (control.placement === "edge-start") return "pane-edge-add-left";
      if (control.placement === "edge-end") return "pane-edge-add-right";
      return "pane-divider-add-vertical";
    }
    if (control.placement === "edge-start") return "pane-edge-add-top";
    if (control.placement === "edge-end") return "pane-edge-add-bottom";
    return "pane-divider-add-horizontal";
  }

  function getPaneSplitControlLabel(control: PaneGridSplitControl): string {
    if (control.axis === "column") {
      if (control.placement === "edge-start") return "Add pane at left edge";
      if (control.placement === "edge-end") return "Add pane at right edge";
      return "Add pane at vertical divider";
    }
    if (control.placement === "edge-start") return "Add pane at top edge";
    if (control.placement === "edge-end") return "Add pane at bottom edge";
    return "Add pane at horizontal divider";
  }

  function formatPaneSplitControlStyle(control: PaneGridSplitControl): string {
    const crossSize = Math.max(0, control.endPercent - control.startPercent);
    if (control.axis === "column") {
      return `left: ${control.positionPercent}%; top: ${control.startPercent}%; bottom: auto; height: ${crossSize}%;`;
    }
    return `top: ${control.positionPercent}%; left: ${control.startPercent}%; right: auto; width: ${crossSize}%;`;
  }

  function getPaneSplitActionForControl(control: PaneGridSplitControl): PaneSplitAction | null {
    const focusedPane = paneLayout.panes.find((pane) => pane.paneId === focusedPaneId);
    const touchingPanes = paneLayout.panes.filter((pane) => {
      if (control.axis === "column") {
        return (
          (pane.columnEnd === control.index || pane.columnStart === control.index) &&
          pane.rowStart < control.rangeEnd &&
          pane.rowEnd > control.rangeStart
        );
      }
      return (
        (pane.rowEnd === control.index || pane.rowStart === control.index) &&
        pane.columnStart < control.rangeEnd &&
        pane.columnEnd > control.rangeStart
      );
    });
    const candidate =
      (focusedPane && touchingPanes.find((pane) => pane.paneId === focusedPane.paneId)) ??
      touchingPanes.find((pane) =>
        control.axis === "column"
          ? pane.columnEnd === control.index
          : pane.rowEnd === control.index,
      ) ??
      touchingPanes[0] ??
      null;
    if (!candidate) {
      return null;
    }

    if (control.axis === "column") {
      return {
        paneId: candidate.paneId,
        direction: candidate.columnEnd === control.index ? "right" : "left",
      };
    }
    return {
      paneId: candidate.paneId,
      direction: candidate.rowEnd === control.index ? "below" : "above",
    };
  }

  async function handleSplitAtControl(control: PaneGridSplitControl) {
    const action = getPaneSplitActionForControl(control);
    if (!action) {
      return;
    }
    await runSessionMutation(async () => {
      const paneId = await runtime.splitPane(action.paneId, action.direction);
      if (paneId) {
        runtime.focusPane(paneId);
      }
    });
  }

  function startPaneDividerResize(
    event: PointerEvent,
    axis: PaneResizeAxis,
    dividerIndex: number,
  ) {
    if (event.button !== 0) {
      return;
    }
    const gridRect = paneGridElement?.getBoundingClientRect();
    if (!gridRect) {
      return;
    }
    const gridSizePx = axis === "column" ? gridRect.width : gridRect.height;
    if (gridSizePx <= 0) {
      return;
    }

    event.preventDefault();
    activePaneResize = {
      axis,
      gridSizePx,
      lastClientPosition: axis === "column" ? event.clientX : event.clientY,
      pointerId: event.pointerId,
      trackIndex: dividerIndex - 1,
    };
    window.addEventListener("pointermove", handlePaneDividerResizeMove);
    window.addEventListener("pointerup", stopPaneDividerResize);
    window.addEventListener("pointercancel", stopPaneDividerResize);
  }

  function handlePaneDividerResizeMove(event: PointerEvent) {
    const resize = activePaneResize;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextPosition = resize.axis === "column" ? event.clientX : event.clientY;
    const deltaPx = nextPosition - resize.lastClientPosition;
    const deltaPercent = (deltaPx / resize.gridSizePx) * 100;
    if (Math.abs(deltaPercent) < 0.05) {
      return;
    }

    runtime.resizePaneTrack(resize.axis, resize.trackIndex, deltaPercent);
    activePaneResize = {
      ...resize,
      lastClientPosition: nextPosition,
    };
    syncRuntimeState();
  }

  function stopPaneDividerResize(event?: PointerEvent) {
    if (event && activePaneResize && activePaneResize.pointerId !== event.pointerId) {
      return;
    }
    activePaneResize = null;
    window.removeEventListener("pointermove", handlePaneDividerResizeMove);
    window.removeEventListener("pointerup", stopPaneDividerResize);
    window.removeEventListener("pointercancel", stopPaneDividerResize);
  }

  function handlePaneDividerKeydown(
    event: KeyboardEvent,
    axis: PaneResizeAxis,
    dividerIndex: number,
  ) {
    const forwardKey = axis === "column" ? "ArrowRight" : "ArrowDown";
    const backwardKey = axis === "column" ? "ArrowLeft" : "ArrowUp";
    if (event.key !== forwardKey && event.key !== backwardKey) {
      return;
    }
    event.preventDefault();
    handleResizeTrack(axis, dividerIndex - 1, event.key === forwardKey ? 3 : -3);
  }

  function getPanePlacementZoneForPoint(paneElement: HTMLElement, clientX: number, clientY: number): PanePlacementZone {
    const rect = paneElement.getBoundingClientRect();
    const edgeThreshold = Math.min(96, Math.max(44, Math.min(rect.width, rect.height) * 0.28));
    const distances = [
      { zone: "left" as const, value: clientX - rect.left },
      { zone: "right" as const, value: rect.right - clientX },
      { zone: "above" as const, value: clientY - rect.top },
      { zone: "below" as const, value: rect.bottom - clientY },
    ].sort((left, right) => left.value - right.value);

    return distances[0]?.value <= edgeThreshold ? distances[0].zone : "replace";
  }

  function clearPaneDragListeners() {
    window.removeEventListener("pointermove", handlePaneDragPointerMove);
    window.removeEventListener("pointerup", stopPaneDrag);
    window.removeEventListener("pointercancel", stopPaneDrag);
  }

  function clearPaneDragState() {
    activePaneDrag = null;
    draggingPaneId = null;
    paneDropPreview = null;
    paneSpanDropPreview = null;
  }

  function startPaneDrag(event: PointerEvent, paneId: string) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void handleFocusPane(paneId);
    activePaneDrag = {
      hasMoved: false,
      lastX: event.clientX,
      lastY: event.clientY,
      pointerId: event.pointerId,
      sourcePaneId: paneId,
      startX: event.clientX,
      startY: event.clientY,
    };
    draggingPaneId = paneId;
    paneDropPreview = null;
    paneSpanDropPreview = null;
    window.addEventListener("pointermove", handlePaneDragPointerMove);
    window.addEventListener("pointerup", stopPaneDrag);
    window.addEventListener("pointercancel", stopPaneDrag);
  }

  function handlePaneDragPointerMove(event: PointerEvent) {
    const drag = activePaneDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const distanceX = Math.abs(event.clientX - drag.startX);
    const distanceY = Math.abs(event.clientY - drag.startY);
    const hasMoved = drag.hasMoved || distanceX > 4 || distanceY > 4;
    if (!hasMoved) {
      return;
    }
    activePaneDrag = { ...drag, hasMoved, lastX: event.clientX, lastY: event.clientY };

    const targetElement = document.elementFromPoint(event.clientX, event.clientY);
    const spanDropElement = targetElement?.closest("[data-pane-span-drop]") as HTMLElement | null;
    const spanDropPlacement = spanDropElement?.dataset.paneSpanDrop;
    if (
      spanDropPlacement === "top" ||
      spanDropPlacement === "bottom" ||
      spanDropPlacement === "left" ||
      spanDropPlacement === "right"
    ) {
      paneSpanDropPreview = spanDropPlacement;
      paneDropPreview = null;
      return;
    }

    const paneElement = targetElement?.closest("[data-pane-id]") as HTMLElement | null;
    const targetPaneId = paneElement?.dataset.paneId;
    paneSpanDropPreview = null;
    if (!paneElement || !targetPaneId || targetPaneId === drag.sourcePaneId) {
      paneDropPreview = null;
      return;
    }

    paneDropPreview = {
      targetPaneId,
      zone: getPanePlacementZoneForPoint(paneElement, event.clientX, event.clientY),
    };
  }

  function stopPaneDrag(event?: PointerEvent) {
    const drag = activePaneDrag;
    if (event && drag && drag.pointerId !== event.pointerId) {
      return;
    }

    const preview = paneDropPreview;
    const spanPreview = paneSpanDropPreview;
    if (drag?.hasMoved) {
      if (spanPreview) {
        runtime.movePaneToSpanningRow(drag.sourcePaneId, spanPreview);
        syncRuntimeState();
        resubscribeSurfaceController();
        syncSurfaceState();
      } else if (preview) {
        runtime.placePane(drag.sourcePaneId, preview.targetPaneId, preview.zone);
        syncRuntimeState();
        resubscribeSurfaceController();
        syncSurfaceState();
      }
    }

    clearPaneDragState();
    clearPaneDragListeners();
  }

  function cancelPaneDrag() {
    clearPaneDragState();
    clearPaneDragListeners();
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

  async function persistPromptHistoryEntry(input: string, target: PromptTarget | null = currentSurface) {
    try {
      const entry = await runtime.storage.promptHistory.append({
        text: input,
        sentAt: Date.now(),
        workspaceId: runtime.workspaceId,
        sessionId: target?.workspaceSessionId ?? currentSession?.id ?? "unknown-session",
      });
      promptHistory = [...promptHistory, entry];
    } catch (error) {
      console.error("Failed to persist prompt history:", error);
    }
  }

  async function handleSend(input: string): Promise<boolean> {
    return handleSendToPane(focusedPaneId, input);
  }

  async function handleSendToPane(paneId: string, input: string): Promise<boolean> {
    const surface = runtime.getPaneController(paneId);
    if (!input.trim() || !surface || surface.agent.state.isStreaming || sendingPrompt) return false;

    sendingPrompt = true;
    try {
      if (paneId !== focusedPaneId) {
        await runtime.focusPane(paneId);
        syncRuntimeState();
        resubscribeSurfaceController();
        syncSurfaceState();
      }

      await persistPromptHistoryEntry(input, surface.target);

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

  async function handleCopyPaneTranscript(paneId: string) {
    if (copyTranscriptState.status === "copying") return;

    const paneController = runtime.getPaneController(paneId);
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
        title: session?.title ?? "New Session",
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

    copyTranscriptState = { paneId, status: "copying" };

    try {
      await copyTextToClipboard(exportText);
      copyTranscriptState = { paneId, status: "copied" };
      scheduleCopyTranscriptReset();
    } catch (error) {
      console.error("Failed to copy transcript:", error);
      copyTranscriptState = { paneId, status: "error" };
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

  function getReferenceThreadStatus(status: WorkspaceHandlerThreadSummary["status"]): ReferenceStatus {
    switch (status) {
      case "running-handler":
      case "running-workflow":
        return "running";
      case "waiting":
        return "waiting";
      case "completed":
        return "done";
      case "troubleshooting":
        return "failed";
      default:
        return "idle";
    }
  }

  function getReferenceThread(thread: WorkspaceHandlerThreadSummary): ReferenceThread {
    return {
      id: thread.threadId,
      title: thread.title,
      objective: getHandlerThreadPreview(thread),
      status: getReferenceThreadStatus(thread.status),
      elapsed: formatTimestamp(thread.updatedAt),
      model: "handler-thread",
    };
  }

  function getReferenceWorkflowStatus(status: WorkspaceHandlerThreadWorkflowSummary["status"]): ReferenceStatus {
    switch (status) {
      case "running":
      case "continued":
        return "running";
      case "waiting":
        return "waiting";
      case "completed":
        return "done";
      case "failed":
      case "cancelled":
        return "failed";
      default:
        return "idle";
    }
  }

  function getReferenceWorkflowTaskAttemptStatus(
    status: WorkspaceWorkflowTaskAttemptSummary["status"],
  ): ReferenceStatus {
    switch (status) {
      case "running":
        return "running";
      case "waiting":
        return "waiting";
      case "completed":
        return "done";
      case "failed":
      case "cancelled":
        return "failed";
      default:
        return "idle";
    }
  }

  function getReferenceWorkflowTaskAgents(
    thread: WorkspaceHandlerThreadSummary,
  ): ReferenceSubagent[] {
    return (thread.workflowTaskAttempts ?? []).map((attempt) => ({
      id: attempt.workflowTaskAttemptId,
      type: "workflow-task-agent",
      headline: attempt.title,
      status: getReferenceWorkflowTaskAttemptStatus(attempt.status),
      model: "workflow-task-agent",
      tokens: attempt.contextBudget?.usedTokens,
    }));
  }

  function getReferenceWorkflow(run: WorkspaceHandlerThreadWorkflowSummary): ReferenceWorkflow {
    const status = getReferenceWorkflowStatus(run.status);
    return {
      id: run.workflowRunId,
      name: run.workflowName,
      status,
      elapsed: formatTimestamp(run.updatedAt),
      stepsDone: status === "done" ? 1 : 0,
      stepsTotal: 1,
      currentStep: run.summary,
      runId: run.workflowRunId,
    };
  }

  function getReferenceEpisode(
    episode: NonNullable<WorkspaceHandlerThreadSummary["latestEpisode"]>,
    thread: WorkspaceHandlerThreadSummary,
  ): ReferenceEpisode {
    return {
      id: episode.episodeId,
      title: episode.title,
      summary: episode.summary,
      thread: thread.title,
      verified: thread.status === "completed",
    };
  }

  function getThreadStateDetail(
    thread: WorkspaceHandlerThreadSummary | WorkspaceHandlerThreadInspector,
  ): string {
    switch (thread.status) {
      case "running-handler":
        return "Handler is actively reasoning or using thread-local tools.";
      case "running-workflow":
        return "Smithers workflow work is active under this handler.";
      case "waiting":
        return thread.wait
          ? `Waiting on ${thread.wait.owner} ${thread.wait.kind}: ${thread.wait.resumeWhen}`
          : "Waiting for an external prerequisite before continuing.";
      case "troubleshooting":
        return "Thread needs repair or follow-up before it can hand work back.";
      case "completed":
        return "Thread has handed durable output back to the orchestrator.";
      default:
        return thread.objective;
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

  function getProjectCiVerification(status: WorkspaceProjectCiStatusPanel): ReferenceVerification {
    const testsPassed = status.checkCounts.passed;
    const testsTotal = status.checkCounts.total;
    return {
      id: status.latestRun?.ciRunId ?? status.updatedAt ?? "project-ci",
      passed: status.status === "passed",
      testsPassed,
      testsTotal,
      summary: status.summary,
      checks: status.checks.map((check) => ({
        label: check.label,
        status:
          check.status === "passed"
            ? "pass"
            : check.status === "skipped"
              ? "skip"
              : check.status === "blocked"
                ? "blocked"
                : check.status === "cancelled"
                  ? "cancelled"
              : "fail",
      })),
    };
  }

  function handleInspectLatestProjectCiRun() {
    if (!projectCiStatus?.latestRun) {
      return;
    }
    void openWorkflowInspector(projectCiStatus.latestRun.workflowRunId);
  }

  function openWorkflowInspector(workflowRunId: string, sessionId = activeSessionId): void {
    if (!sessionId) return;
    void runtime.openSurface(
      {
        workspaceSessionId: sessionId,
        surface: "workflow-inspector",
        workflowRunId,
      },
      { kind: "split", paneId: focusedPaneId, direction: "right" },
    );
  }

  function openSavedWorkflowLibrary(sessionId = activeSessionId): void {
    if (!sessionId) return;
    void runtime.openSurface(
      {
        workspaceSessionId: sessionId,
        surface: "saved-workflow-library",
      },
      { kind: "split", paneId: focusedPaneId, direction: "right" },
    );
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

  function getHandlerThreadArtifactLabel(
    thread: WorkspaceHandlerThreadSummary | WorkspaceHandlerThreadInspector,
  ): string | null {
    if (thread.artifactCount <= 0) {
      return null;
    }
    return `${thread.artifactCount} ${thread.artifactCount === 1 ? "artifact" : "artifacts"}`;
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
      await runtime.openSurface(target, focusedPaneId);
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

    const prompt = [
      "Inspect the workflow work owned by this thread.",
      "If there are reusable saved workflow files worth keeping, write them directly into `.svvy/workflows/...` using the normal repo write APIs.",
      "Rely on the automatic workflow validation feedback returned in the surrounding `execute_typescript` logs, and keep editing until the final saved workflow state validates cleanly.",
      "If nothing here is worth saving, say so briefly inside the thread.",
    ].join(" ");

    await sendPromptToHandlerThread(thread, prompt);
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
      currentSessionMode = "orchestrator";
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
    currentSessionMode = surface.sessionMode;
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
      if (activePaneDrag && event.key === "Escape") {
        event.preventDefault();
        cancelPaneDrag();
        return;
      }

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
      stopPaneDividerResize();
      stopPaneDrag();
      clearCopyTranscriptResetTimer();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleWindowKeydown);
      controller = null;
    };
  });
</script>

<div class="workspace-shell" style={`--sidebar-width: ${effectiveSidebarWidth}px;`}>
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
        aria-label="Titlebar command palette"
        title="Command Palette (Cmd+Shift+P)"
        onclick={() => openPalette("actions")}
      >
        <SearchIcon aria-hidden="true" size={15} strokeWidth={1.85} />
      </button>
      <button
        class="titlebar-icon"
        type="button"
        aria-label="Titlebar quick open"
        title="Quick Open (Cmd+P)"
        onclick={() => openPalette("quick-open")}
      >
        <FileSearchIcon aria-hidden="true" size={15} strokeWidth={1.85} />
      </button>
      {#if onOpenSettings}
        <button
          class="titlebar-icon"
          type="button"
          aria-label="Titlebar settings"
          title="Settings"
          onclick={onOpenSettings}
        >
          <SettingsIcon aria-hidden="true" size={15} strokeWidth={1.85} />
        </button>
      {/if}
    </div>
  </header>

  <div
    class={`chat-workspace ${showDesktopSplit ? "split" : ""} ${sidebarHidden ? "sidebar-hidden" : ""} viewport-${viewportClass}`.trim()}
    style={`--sidebar-width: ${effectiveSidebarWidth}px;`}
  >
    {#if !sidebarHidden && !narrowShell}
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
            onCreateQuickSession={handleCreateQuickSession}
            onOpenSession={handleOpenSession}
            onFocusPane={handleFocusPane}
            onRenameSession={handleRenameSession}
            onForkSession={handleForkSession}
            onDeleteSession={handleDeleteSession}
            onPinSession={handlePinSession}
            onUnpinSession={handleUnpinSession}
            onArchiveSession={handleArchiveSession}
            onUnarchiveSession={handleUnarchiveSession}
            onToggleArchivedGroup={handleToggleArchivedGroup}
            onOpenWorkflowLibrary={() => openSavedWorkflowLibrary()}
            onOpenSettings={onOpenSettings}
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
          <button class="workspace-main-title-button" type="button" onclick={() => openPalette("actions")}>
            <span class="workspace-main-title">{currentSession?.title ?? "New Session"}</span>
          </button>
          <Badge tone={workspaceStatusTone}>{workspaceStatusText}</Badge>
          <span class="workspace-main-separator">/</span>
          <span class="workspace-main-branch">
            <GitBranchIcon aria-hidden="true" size={10} strokeWidth={1.8} />
            {currentWorktreeSummary}
          </span>
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
          <ContextBudgetBar budget={contextBudget} variant="compact" label="Focused context" />
          <button
            class="layout-chip-button"
            type="button"
            aria-label={`Pane layout ${paneLayoutSummary}`}
            title={`Pane layout ${paneLayoutSummary}`}
            onclick={() => openPalette("actions")}
          >
            <Grid2x2Icon aria-hidden="true" size={13} strokeWidth={1.85} />
            <span>{paneLayoutSummary}</span>
          </button>
          <span class="runtime-summary">{currentModel?.name ?? "No surface"} + {paneLayout.panes.length}</span>
          <button
            class="header-icon-button"
            type="button"
            aria-label="Open command palette"
            title="Command Palette (Cmd+Shift+P)"
            onclick={() => openPalette("actions")}
          >
            <SearchIcon aria-hidden="true" size={14} strokeWidth={1.85} />
          </button>
          <button
            class="header-icon-button"
            type="button"
            aria-label="Open quick open"
            title="Quick Open (Cmd+P)"
            onclick={() => openPalette("quick-open")}
          >
            <FileSearchIcon aria-hidden="true" size={14} strokeWidth={1.85} />
          </button>
          {#if onOpenSettings}
            <button
              class="header-icon-button"
              type="button"
              aria-label={sidebarHidden ? "Open settings" : "Settings"}
              title="Settings"
              onclick={onOpenSettings}
            >
              <SettingsIcon aria-hidden="true" size={14} strokeWidth={1.85} />
            </button>
          {/if}
          <button
            class="header-icon-button"
            type="button"
            aria-label="Toggle artifacts inspector"
            title="Toggle artifacts inspector"
            disabled={!hasArtifacts}
            onclick={() => (showArtifactsPanel = !showArtifactsPanel)}
          >
            <PanelRightIcon aria-hidden="true" size={14} strokeWidth={1.85} />
          </button>
          {#if projectCiStatus && hasActionableProjectCiStatus}
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
        bind:this={paneGridElement}
        class={`pane-grid ${draggingPaneId ? "dragging-pane" : ""} ${activePaneResize ? "resizing-pane" : ""}`.trim()}
        data-testid="pane-grid"
        style={`grid-template-columns: ${paneLayout.columns.map((column) => `${column.percent}fr`).join(" ")}; grid-template-rows: ${paneLayout.rows.map((row) => `${row.percent}fr`).join(" ")}; --pane-drag-x: ${activePaneDrag?.lastX ?? 0}px; --pane-drag-y: ${activePaneDrag?.lastY ?? 0}px;`}
      >
        <button
          class={`pane-span-drop-zone top ${paneSpanDropPreview === "top" ? "active" : ""}`.trim()}
          type="button"
          data-testid="pane-span-drop-top"
          data-pane-span-drop="top"
          aria-label="Move dragged pane to full-width top row"
          title="Move pane to top"
        ></button>
        <button
          class={`pane-span-drop-zone right ${paneSpanDropPreview === "right" ? "active" : ""}`.trim()}
          type="button"
          data-testid="pane-span-drop-right"
          data-pane-span-drop="right"
          aria-label="Move dragged pane to full-height right column"
          title="Move pane to right"
        ></button>
        <button
          class={`pane-span-drop-zone bottom ${paneSpanDropPreview === "bottom" ? "active" : ""}`.trim()}
          type="button"
          data-testid="pane-span-drop-bottom"
          data-pane-span-drop="bottom"
          aria-label="Move dragged pane to full-width bottom row"
          title="Move pane to bottom"
        ></button>
        <button
          class={`pane-span-drop-zone left ${paneSpanDropPreview === "left" ? "active" : ""}`.trim()}
          type="button"
          data-testid="pane-span-drop-left"
          data-pane-span-drop="left"
          aria-label="Move dragged pane to full-height left column"
          title="Move pane to left"
        ></button>
        {#each paneLayout.panes as pane (pane.paneId)}
          {@const paneController = runtime.getPaneController(pane.paneId)}
          {@const paneContextBudget = getPaneContextBudget(paneController)}
          {@const paneLocationMetadata = formatPaneLocationMetadata(pane.binding)}
          <article
            class={`workspace-pane ${pane.paneId === focusedPaneId ? "focused" : ""} ${draggingPaneId === pane.paneId ? "dragging-source" : ""} ${paneDropPreview?.targetPaneId === pane.paneId ? `drop-preview drop-${paneDropPreview.zone}` : ""}`.trim()}
            data-testid="workspace-pane"
            data-pane-id={pane.paneId}
            aria-current={pane.paneId === focusedPaneId ? "true" : "false"}
            style={`grid-column: ${pane.columnStart + 1} / ${pane.columnEnd + 1}; grid-row: ${pane.rowStart + 1} / ${pane.rowEnd + 1};`}
          >
            {#if activePaneDrag?.hasMoved && paneDropPreview?.targetPaneId === pane.paneId}
              <div class={`pane-drop-callout ${paneDropPreview.zone}`.trim()}>
                <span>{formatPaneDropActionLabel(paneDropPreview.zone)}</span>
              </div>
            {/if}
            <header class="pane-chrome">
              <button
                class="pane-drag-handle"
                type="button"
                aria-label={`Move pane ${pane.paneId}`}
                title="Drag to move pane"
                onpointerdown={(event) => startPaneDrag(event, pane.paneId)}
              >
                <GripVerticalIcon aria-hidden="true" size={13} strokeWidth={1.9} />
              </button>
              <button
                class="pane-focus-button"
                type="button"
                aria-label={`Focus pane ${pane.paneId}`}
                onclick={() => void handleFocusPane(pane.paneId)}
              >
                <span class="pane-title-line">
                  <span
                    class="status-dot"
                    class:pulse-dot={getPaneSurfaceStatus(paneController, pane.binding) === "running"}
                    data-status={getPaneSurfaceStatus(paneController, pane.binding)}
                    aria-hidden="true"
                  ></span>
                  <strong>{formatPaneSurfaceLabel(paneController, pane.binding)}</strong>
                </span>
                <span>{formatPaneAgentSummary(paneController, pane.binding)}</span>
              </button>
              <div class="pane-chrome-meta" aria-label="Pane metadata">
                <MetadataChip label="target" value={pane.binding?.surface ?? "empty"} />
                <MetadataChip label={paneLocationMetadata.label} value={paneLocationMetadata.value} tone="info" />
                {#if paneContextBudget}
                  <MetadataChip label="context" value={paneContextBudget.label} tone={paneContextBudget.tone === "red" ? "danger" : paneContextBudget.tone === "orange" ? "warning" : "neutral"} />
                {/if}
              </div>
              <div class="pane-chrome-actions">
                {#if paneController}
                  <button
                    type="button"
                    data-testid="pane-copy-transcript-button"
                    aria-label={`Copy transcript for pane ${pane.paneId}`}
                    title={getCopyTranscriptLabel(pane.paneId)}
                    disabled={copyTranscriptState.status === "copying"}
                    onclick={(event) => {
                      event.stopPropagation();
                      void handleCopyPaneTranscript(pane.paneId);
                    }}
                  >
                    <CopyIcon aria-hidden="true" size={13} strokeWidth={1.9} />
                  </button>
                {/if}
                <button
                  type="button"
                  data-testid="pane-duplicate-button"
                  aria-label={`Duplicate pane ${pane.paneId}`}
                  title="Duplicate pane"
                  disabled={mutatingSession || !pane.binding}
                  onclick={(event) => {
                    event.stopPropagation();
                    window.setTimeout(() => void handleDuplicatePane(pane.paneId), 0);
                  }}
                >
                  <CopyPlusIcon aria-hidden="true" size={13} strokeWidth={1.9} />
                </button>
                {#if paneLayout.panes.length > 1}
                  <button
                    type="button"
                    data-testid="pane-close-button"
                    aria-label={`Close pane ${pane.paneId}`}
                    title="Close pane"
                    onclick={(event) => {
                      event.stopPropagation();
                      window.setTimeout(() => void handleClosePane(pane.paneId), 0);
                    }}
                  >
                    <XIcon aria-hidden="true" size={13} strokeWidth={1.9} />
                  </button>
                {/if}
              </div>
            </header>
            {#if pane.paneId !== focusedPaneId && paneContextBudget}
              <ContextBudgetBar budget={paneContextBudget} variant="compact" label="Context" />
            {/if}
            {#if pane.binding?.surface === "workflow-inspector"}
              <WorkflowInspectorPane
                {runtime}
                sessionId={pane.binding.workspaceSessionId}
                workflowRunId={pane.binding.workflowRunId}
                paneId={pane.paneId}
              />
            {:else if pane.binding?.surface === "saved-workflow-library"}
              <SavedWorkflowLibraryPane {runtime} />
            {:else if pane.binding?.surface === "command" || pane.binding?.surface === "workflow-task-attempt" || pane.binding?.surface === "artifact" || pane.binding?.surface === "project-ci-check"}
              <RelatedInspectorPane {runtime} target={pane.binding} />
            {:else if pane.paneId === focusedPaneId}
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

                  {#if projectCiStatus.checks.length > 0}
                    <VerificationCard result={getProjectCiVerification(projectCiStatus)} onreportopen={handleInspectLatestProjectCiRun} />
                  {/if}

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

          {#if showNewSessionEmptyState}
            <section class="new-session-empty" aria-label="Start orchestrating">
              <p class="new-session-watermark">svvy</p>
              <div class="new-session-heading">
                <h2>Start orchestrating</h2>
                <p>Choose a session type or resume a recent session.</p>
              </div>

              <div class="new-session-options" aria-label="Session type">
                <button
                  type="button"
                  class={`new-session-option ${currentSessionMode === "orchestrator" ? "active" : ""}`.trim()}
                  aria-pressed={currentSessionMode === "orchestrator"}
                  disabled={mutatingSession}
                  onclick={() => void handleSelectCurrentSessionMode("orchestrator")}
                >
                  <span class="new-session-option-icon">o</span>
                  <strong>Orchestrator session</strong>
                  <small>Use this session for handler threads and workflow task-agents</small>
                </button>
                <button
                  type="button"
                  class={`new-session-option ${currentSessionMode === "quick" ? "active" : ""}`.trim()}
                  aria-pressed={currentSessionMode === "quick"}
                  disabled={mutatingSession}
                  onclick={() => void handleSelectCurrentSessionMode("quick")}
                >
                  <span class="new-session-option-icon quick">q</span>
                  <strong>Quick session</strong>
                  <small>Keep this session direct, lightweight, and focused</small>
                </button>
                <button
                  type="button"
                  class="new-session-option"
                  disabled={recentSessionSuggestions.length === 0}
                  onclick={() => {
                    const nextSession = recentSessionSuggestions[0];
                    if (nextSession) void handleOpenSession(nextSession.id);
                  }}
                >
                  <span class="new-session-option-icon resume">r</span>
                  <strong>Resume session</strong>
                  <small>Pick up where you left off</small>
                </button>
              </div>

              <div class="new-session-mode-preview">
                <div class="new-session-mode-header">
                  <span>Session mode preview</span>
                  <code>orchestrator vs quick</code>
                </div>
                <div class="new-session-mode-grid">
                  <div class:active={currentSessionMode === "orchestrator"}>
                    <strong>Orchestrator</strong>
                    <p>Direct, delegated, verification, and pause paths with per-agent runtime profiles.</p>
                  </div>
                  <div class:active={currentSessionMode === "quick"}>
                    <strong>Quick</strong>
                    <p>Single surface, smaller context budget, faster answer path with fewer delegated actions.</p>
                  </div>
                </div>
              </div>

              {#if recentSessionSuggestions.length > 0}
                <div class="new-session-recent" aria-label="Recent sessions">
                  <p>Recent</p>
                  {#each recentSessionSuggestions as session (session.id)}
                    <button type="button" onclick={() => void handleOpenSession(session.id)}>
                      <span class="status-dot" data-status={session.status} aria-hidden="true"></span>
                      <span>{session.title}</span>
                      <small>{formatTimestamp(session.updatedAt)}</small>
                    </button>
                  {/each}
                </div>
              {/if}
            </section>
          {:else}
            <ChatTranscript
              {conversation}
              sessionId={currentSurfaceController?.agent.sessionId ?? "no-surface"}
              systemPrompt={currentSurfaceController?.resolvedSystemPrompt ?? ""}
              streamMessage={streamMessage ?? undefined}
              {pendingToolCalls}
              {isStreaming}
              {workspaceMentionPaths}
              semanticBlocks={transcriptSemanticBlocks}
              onOpenArtifact={handleOpenArtifact}
              onOpenWorkspacePath={(path) => void handleOpenWorkspacePath(path)}
              onInspectCommand={(commandId) => void handleInspectCommand(commandId)}
              onOpenHandlerThread={(id) => {
                const thread = handlerThreads.find((t) => t.threadId === id);
                if (thread) void handleOpenHandlerThread(thread);
              }}
              onInspectWorkflowTaskAttempt={(id) => {
                void handleInspectWorkflowTaskAttempt({ workflowTaskAttemptId: id }, activeSessionId);
              }}
              onInspectWorkflow={(id) => openWorkflowInspector(id, activeSessionId)}
              onReplyToWait={(block, text) => void handleReplyToWait(block, text)}
              onRetryFailure={(block) => void handleRetryFailure(block)}
              onScrollStateChange={(scroll) => handleTranscriptScrollState(pane.paneId, scroll)}
            />
          {/if}
          <ChatComposer
            currentModel={currentModel}
            thinkingLevel={currentThinkingLevel}
            isStreaming={promptBusy}
            errorMessage={composerErrorMessage}
            {promptHistory}
            usageText={usageText || undefined}
            {contextBudget}
            sessionName={currentSession?.title ?? "New Session"}
            targetLabel={currentSurfaceLabel}
            worktreeLabel={currentWorktreeSummary}
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
              <section class="chat-pane" aria-label="Pane transcript preview">
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
                  <ChatComposer
                    currentModel={paneController.agent.state.model}
                    thinkingLevel={paneController.agent.state.thinkingLevel}
                    isStreaming={paneController.agent.state.isStreaming || paneController.promptStatus === "streaming"}
                    errorMessage={paneController.agent.state.error}
                    {promptHistory}
                    usageText={formatUsage(projectConversation(paneController.agent.state.messages).usage) || undefined}
                    contextBudget={paneContextBudget}
                    sessionName={formatPaneSurfaceLabel(paneController, pane.binding)}
                    targetLabel={formatPaneSurfaceLabel(paneController, pane.binding)}
                    worktreeLabel={paneLocationMetadata.value}
                    onAbort={() => void paneController.abort()}
                    onOpenModelPicker={() => {
                      void handleFocusPane(pane.paneId).then(() => openModelSelector());
                    }}
                    onSend={(input) => handleSendToPane(pane.paneId, input)}
                    onThinkingChange={(level) => {
                      paneController.agent.setThinkingLevel(level);
                    }}
                    listWorkspacePaths={() => runtime.listWorkspacePaths()}
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
        {#if activePaneDrag?.hasMoved}
          <div class="pane-drag-ghost" aria-hidden="true">
            <span>Move</span>
            <strong>{formatPaneDragSourceLabel(draggingPaneId)}</strong>
          </div>
        {/if}
        {#each paneSplitControls as control (`${control.axis}-${control.index}-${control.placement}-${control.rangeStart}-${control.rangeEnd}`)}
          <div
            class={`pane-divider-shell ${control.axis === "column" ? "vertical" : "horizontal"} ${control.placement} ${control.placement === "divider" && activePaneResize?.axis === control.axis && activePaneResize?.trackIndex === control.index - 1 ? "active" : ""}`.trim()}
            style={formatPaneSplitControlStyle(control)}
          >
            {#if control.placement === "divider"}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                class="pane-divider-line"
                data-testid={control.axis === "column" ? "pane-divider-vertical" : "pane-divider-horizontal"}
                role="separator"
                aria-orientation={control.axis === "column" ? "vertical" : "horizontal"}
                aria-label={control.axis === "column" ? "Resize panes horizontally" : "Resize panes vertically"}
                tabindex="0"
                title="Drag to resize panes"
                onpointerdown={(event) => startPaneDividerResize(event, control.axis, control.index)}
                onkeydown={(event) => handlePaneDividerKeydown(event, control.axis, control.index)}
              ></div>
            {/if}
            <button
              class="pane-divider-split"
              type="button"
              data-testid={getPaneSplitControlTestId(control)}
              aria-label={getPaneSplitControlLabel(control)}
              title="Add pane here"
              onpointerdown={(event) => event.stopPropagation()}
              onclick={(event) => {
                event.stopPropagation();
                void handleSplitAtControl(control);
              }}
            >
              <PlusIcon aria-hidden="true" size={13} strokeWidth={2.1} />
            </button>
          </div>
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
            <article class="thread-inspector-wait">
              <strong>Waiting on {threadInspector.wait.owner} {threadInspector.wait.kind}</strong>
              <span>Since {formatTimestamp(threadInspector.wait.since)}</span>
              <p>{threadInspector.wait.reason}</p>
              <p>{threadInspector.wait.resumeWhen}</p>
            </article>
          {/if}

          <div class="thread-inspector-metadata" aria-label="Thread runtime metadata">
            <div>
              <span>Surface</span>
              <strong>{threadInspector.surfacePiSessionId}</strong>
            </div>
            <div>
              <span>System prompt</span>
              <strong>Open the thread surface to inspect the active pi system prompt.</strong>
            </div>
            <div>
              <span>Workflow ownership</span>
              <strong>
                {threadInspector.workflowRunCount}
                {threadInspector.workflowRunCount === 1 ? " run" : " runs"}
                owned by this handler
              </strong>
            </div>
            <div>
              <span>Context packs</span>
              <strong>{threadInspector.loadedContextKeys.length > 0 ? threadInspector.loadedContextKeys.join(", ") : "none loaded"}</strong>
            </div>
          </div>

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
                  <div class="handler-thread-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      onclick={() => openWorkflowInspector(workflowRun.workflowRunId, threadInspectorSessionId ?? activeSessionId)}
                    >
                      Open inspector
                    </Button>
                  </div>
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
                <h3>Workflow Task-Agents</h3>
                <p>Inspect the Smithers workflow task-agent attempts under this thread without promoting them into a top-level surface.</p>
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
                  <ContextBudgetBar budget={workflowTaskAttempt.contextBudget} label="Context" />
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
    eyebrow="Workflow Task-Agent"
    title={workflowTaskAttemptInspector?.title ?? "Inspect Workflow Task-Agent"}
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

          <ContextBudgetBar budget={workflowTaskAttemptInspector.contextBudget} label="Context" />

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
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    margin-inline: 0;
    background: var(--ui-bg);
  }

  .workspace-titlebar {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 12;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.35rem;
    width: var(--sidebar-width, 240px);
    height: 2.25rem;
    padding: 0 0.35rem 0 0;
    border: 0;
    background: transparent;
    pointer-events: auto;
  }

  .workspace-titlebar-start {
    display: flex;
    align-items: center;
  }

  .workspace-titlebar-title {
    display: none;
  }

  .workspace-titlebar-actions {
    display: none;
    align-items: center;
    gap: 0.16rem;
    padding: 0.12rem;
    border: 1px solid color-mix(in oklab, var(--ui-shell-edge) 70%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-shell) 82%, transparent);
    box-shadow: var(--ui-shadow-soft);
    pointer-events: auto;
  }

  .titlebar-icon {
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
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .titlebar-icon {
    width: 1.72rem;
    height: 1.72rem;
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

  .chat-workspace.sidebar-hidden {
    grid-template-columns: minmax(0, 1fr);
  }

  .chat-workspace.split {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr) minmax(22rem, 28rem);
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
    padding: 0;
    border-right: 1px solid var(--ui-shell-edge);
    background: var(--ui-shell);
  }

  .sidebar-resize-handle {
    position: absolute;
    top: 0;
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

  .pane-grid {
    position: relative;
    display: grid;
    min-height: 0;
    gap: 0.25rem;
    overflow: hidden;
    padding: 0.5rem;
    --pane-drop-preview-color: color-mix(in oklab, var(--ui-accent) 58%, transparent);
  }

  .pane-grid.resizing-pane {
    user-select: none;
  }

  .pane-span-drop-zone {
    position: absolute;
    z-index: 8;
    border: 0;
    background: color-mix(in oklab, var(--ui-accent) 16%, transparent);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 140ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 140ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .pane-span-drop-zone.top,
  .pane-span-drop-zone.bottom {
    left: 0.8rem;
    right: 0.8rem;
    height: 1.45rem;
  }

  .pane-span-drop-zone.left,
  .pane-span-drop-zone.right {
    top: 0.8rem;
    bottom: 0.8rem;
    width: 1.45rem;
  }

  .pane-span-drop-zone.top {
    top: 0.55rem;
  }

  .pane-span-drop-zone.right {
    right: 0.55rem;
  }

  .pane-span-drop-zone.bottom {
    bottom: 0.55rem;
  }

  .pane-span-drop-zone.left {
    left: 0.55rem;
  }

  .pane-grid.dragging-pane .pane-span-drop-zone,
  .pane-grid.dragging-pane .pane-span-drop-zone:focus-visible,
  .pane-grid.dragging-pane .pane-span-drop-zone:hover,
  .pane-grid.dragging-pane .pane-span-drop-zone.active {
    opacity: 1;
    pointer-events: auto;
  }

  .pane-grid.dragging-pane .pane-span-drop-zone:hover,
  .pane-grid.dragging-pane .pane-span-drop-zone:focus-visible,
  .pane-grid.dragging-pane .pane-span-drop-zone.active {
    background: color-mix(in oklab, var(--ui-accent) 34%, transparent);
  }

  .workspace-pane {
    position: relative;
    container-type: inline-size;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg);
    animation: pane-enter 180ms cubic-bezier(0.22, 1, 0.36, 1);
    transition:
      border-color 150ms cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 150ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 150ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .workspace-pane.dragging-source {
    opacity: 0.58;
    transform: scale(0.992);
  }

  .pane-grid.dragging-pane .workspace-pane:not(.dragging-source):not(.drop-preview) {
    opacity: 0.72;
  }

  .pane-grid.dragging-pane .workspace-pane {
    user-select: none;
  }

  .workspace-pane.drop-preview {
    border-color: color-mix(in oklab, var(--ui-accent) 58%, var(--ui-border-strong));
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ui-accent) 32%, transparent);
    opacity: 1;
  }

  .workspace-pane.drop-preview::after {
    position: absolute;
    z-index: 6;
    border: 2px solid var(--pane-drop-preview-color);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-accent) 13%, transparent);
    content: "";
    pointer-events: none;
    transition:
      opacity 120ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .workspace-pane.drop-replace::after {
    inset: 2.7rem 0.7rem 0.7rem;
  }

  .workspace-pane.drop-left::after {
    inset: 2.7rem 50% 0.7rem 0.7rem;
  }

  .workspace-pane.drop-right::after {
    inset: 2.7rem 0.7rem 0.7rem 50%;
  }

  .workspace-pane.drop-above::after {
    inset: 2.7rem 0.7rem 50% 0.7rem;
  }

  .workspace-pane.drop-below::after {
    inset: 50% 0.7rem 0.7rem;
  }

  .pane-drag-ghost {
    position: fixed;
    z-index: 60;
    top: var(--pane-drag-y);
    left: var(--pane-drag-x);
    display: grid;
    gap: 0.08rem;
    min-width: 9rem;
    max-width: 14rem;
    padding: 0.45rem 0.58rem;
    border: 1px solid color-mix(in oklab, var(--ui-accent) 46%, var(--ui-shell-edge));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-shell) 91%, var(--ui-accent));
    box-shadow: 0 0.72rem 1.8rem color-mix(in oklab, var(--ui-bg) 72%, transparent);
    color: var(--ui-text-primary);
    pointer-events: none;
    transform: translate(0.7rem, 0.7rem);
  }

  .pane-drag-ghost span {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.54rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .pane-drag-ghost strong {
    overflow: hidden;
    color: var(--ui-text-primary);
    font-size: 0.72rem;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-drop-callout {
    position: absolute;
    z-index: 8;
    display: grid;
    place-items: center;
    border-radius: var(--ui-radius-sm);
    pointer-events: none;
  }

  .pane-drop-callout.replace {
    inset: 2.7rem 0.7rem 0.7rem;
  }

  .pane-drop-callout.left {
    inset: 2.7rem 50% 0.7rem 0.7rem;
  }

  .pane-drop-callout.right {
    inset: 2.7rem 0.7rem 0.7rem 50%;
  }

  .pane-drop-callout.above {
    inset: 2.7rem 0.7rem 50% 0.7rem;
  }

  .pane-drop-callout.below {
    inset: 50% 0.7rem 0.7rem;
  }

  .pane-drop-callout span {
    padding: 0.24rem 0.42rem;
    border: 1px solid color-mix(in oklab, var(--ui-accent) 58%, var(--ui-shell-edge));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-shell) 86%, var(--ui-accent));
    box-shadow: 0 0.5rem 1.4rem color-mix(in oklab, var(--ui-bg) 62%, transparent);
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .workspace-pane.focused {
    border-color: color-mix(in oklab, var(--ui-accent) 34%, var(--ui-border-strong));
    box-shadow: inset 2px 0 0 var(--ui-accent);
  }

  .workspace-pane.focused .pane-chrome {
    border-bottom-color: var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface-muted) 34%, transparent);
  }

  .workspace-pane.focused .pane-focus-button strong {
    color: var(--ui-text-primary);
  }

  .pane-chrome {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.38rem;
    min-height: 1.78rem;
    padding: 0.2rem 0.48rem;
    border-bottom: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface-muted) 26%, transparent);
  }

  .pane-drag-handle {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.35rem;
    height: 1.35rem;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: grab;
    opacity: 0.64;
    touch-action: none;
    transition:
      opacity 140ms cubic-bezier(0.22, 1, 0.36, 1),
      color 140ms cubic-bezier(0.22, 1, 0.36, 1),
      background-color 140ms cubic-bezier(0.22, 1, 0.36, 1),
      border-color 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .pane-drag-handle:hover,
  .pane-drag-handle:focus-visible {
    border-color: color-mix(in oklab, var(--ui-shell-edge) 78%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 72%, transparent);
    color: var(--ui-text-primary);
    opacity: 1;
  }

  .pane-drag-handle:active,
  .pane-grid.dragging-pane .pane-drag-handle {
    cursor: grabbing;
  }

  .pane-focus-button {
    display: grid;
    gap: 0.1rem;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pane-focus-button strong,
  .pane-focus-button > span:not(.pane-title-line),
  .pane-title-line strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pane-focus-button strong {
    font-size: 0.68rem;
    font-weight: 600;
  }

  .pane-focus-button span {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    color: var(--ui-text-tertiary);
  }

  .pane-chrome-meta {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    opacity: 0;
    transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .workspace-pane:hover .pane-chrome-meta,
  .workspace-pane:focus-within .pane-chrome-meta,
  .workspace-pane.focused .pane-chrome-meta {
    opacity: 1;
  }

  .pane-chrome-meta :global(.ui-metadata-chip) {
    max-width: 9.6rem;
  }

  .pane-chrome-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    flex-shrink: 0;
    opacity: 0.72;
    transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .workspace-pane:hover .pane-chrome-actions,
  .workspace-pane:focus-within .pane-chrome-actions {
    opacity: 1;
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

  .pane-divider-shell {
    position: absolute;
    z-index: 10;
    display: grid;
    place-items: center;
    outline: none;
  }

  .pane-divider-shell.vertical {
    top: 0;
    bottom: 0;
    width: 0.7rem;
    transform: translateX(-50%);
    cursor: col-resize;
  }

  .pane-divider-shell.vertical.edge-start {
    transform: none;
  }

  .pane-divider-shell.vertical.edge-end {
    transform: translateX(-100%);
  }

  .pane-divider-shell.horizontal {
    left: 0;
    right: 0;
    height: 0.7rem;
    transform: translateY(-50%);
    cursor: row-resize;
  }

  .pane-divider-shell.horizontal.edge-start {
    transform: none;
  }

  .pane-divider-shell.horizontal.edge-end {
    transform: translateY(-100%);
  }

  .pane-divider-shell.edge-start,
  .pane-divider-shell.edge-end {
    cursor: default;
  }

  .pane-divider-shell.vertical.edge-start .pane-divider-split {
    left: calc(50% + 0.38rem);
  }

  .pane-divider-shell.vertical.edge-end .pane-divider-split {
    left: calc(50% - 0.38rem);
  }

  .pane-divider-shell.horizontal.edge-start .pane-divider-split {
    top: calc(50% + 0.38rem);
  }

  .pane-divider-shell.horizontal.edge-end .pane-divider-split {
    top: calc(50% - 0.38rem);
  }

  .pane-divider-line {
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: inherit;
  }

  .pane-divider-line::before {
    position: absolute;
    background: currentColor;
    content: "";
    transition:
      background-color 130ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 130ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .pane-divider-shell.vertical .pane-divider-line {
    color: color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
  }

  .pane-divider-shell.horizontal .pane-divider-line {
    color: color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
  }

  .pane-divider-shell.vertical .pane-divider-line::before {
    top: 0;
    bottom: 0;
    left: calc(50% - 0.5px);
    width: 1px;
  }

  .pane-divider-shell.horizontal .pane-divider-line::before {
    top: calc(50% - 0.5px);
    right: 0;
    left: 0;
    height: 1px;
  }

  .pane-divider-shell:hover .pane-divider-line,
  .pane-divider-shell:focus-within .pane-divider-line,
  .pane-divider-shell.active .pane-divider-line {
    color: color-mix(in oklab, var(--ui-accent) 68%, var(--ui-border-strong));
  }

  .pane-divider-shell.vertical:hover .pane-divider-line::before,
  .pane-divider-shell.vertical:focus-within .pane-divider-line::before,
  .pane-divider-shell.vertical.active .pane-divider-line::before {
    transform: scaleX(3);
  }

  .pane-divider-shell.horizontal:hover .pane-divider-line::before,
  .pane-divider-shell.horizontal:focus-within .pane-divider-line::before,
  .pane-divider-shell.horizontal.active .pane-divider-line::before {
    transform: scaleY(3);
  }

  .pane-divider-split {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 2;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 1.45rem;
    height: 1.45rem;
    padding: 0;
    border: 1px solid color-mix(in oklab, var(--ui-accent) 42%, var(--ui-shell-edge));
    border-radius: 50%;
    background: color-mix(in oklab, var(--ui-shell) 88%, var(--ui-accent));
    color: var(--ui-accent);
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.86);
    transition:
      opacity 130ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 130ms cubic-bezier(0.22, 1, 0.36, 1),
      background-color 130ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .pane-divider-shell:hover .pane-divider-split,
  .pane-divider-shell:focus-within .pane-divider-split,
  .pane-divider-shell.active .pane-divider-split {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }

  .pane-divider-split:hover,
  .pane-divider-split:focus-visible {
    background: color-mix(in oklab, var(--ui-accent) 18%, var(--ui-shell));
    cursor: pointer;
  }

  .pane-focus-button:focus-visible,
  .pane-drag-handle:focus-visible,
  .pane-chrome-actions button:focus-visible,
  .pane-span-drop-zone:focus-visible,
  .pane-divider-line:focus-visible,
  .pane-divider-split:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  @keyframes pane-enter {
    from {
      opacity: 0.7;
      transform: scale(0.995);
    }

    to {
      opacity: 1;
      transform: scale(1);
    }
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
    gap: 0.75rem;
    min-height: 2.25rem;
    padding: 0 0.78rem;
    border-bottom: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface) 52%, transparent);
  }

  .workspace-main-copy {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.48rem;
    min-width: 0;
  }

  .workspace-main-title-button {
    display: inline-flex;
    min-width: 0;
    max-width: 24rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .workspace-main-title-button:hover .workspace-main-title {
    color: color-mix(in oklab, var(--ui-text-primary) 86%, var(--ui-accent));
  }

  .workspace-main-title-row,
  .pane-title-line {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.42rem;
  }

  .workspace-main-title-row .status-dot,
  .pane-title-line .status-dot {
    flex: 0 0 auto;
  }

  .workspace-main-title {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0;
  }

  .workspace-main-separator {
    color: var(--ui-border-strong);
    font-size: 0.68rem;
  }

  .workspace-main-branch {
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    min-width: 0;
    max-width: 15rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.62rem;
  }

  .workspace-main-meta {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: nowrap;
    gap: 0.5rem;
    min-width: 0;
    font-size: 0.64rem;
    color: var(--ui-text-tertiary);
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
    font-size: 0.6rem;
    line-height: 1;
  }

  .header-icon-button {
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
      color 140ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .layout-chip-button,
  .runtime-summary {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    min-height: 1.45rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    line-height: 1;
    white-space: nowrap;
  }

  .layout-chip-button {
    padding: 0 0.46rem;
    cursor: pointer;
  }

  .runtime-summary {
    max-width: 9.6rem;
    overflow: hidden;
    padding: 0 0.42rem;
    text-overflow: ellipsis;
  }

  .layout-chip-button:hover,
  .layout-chip-button:focus-visible {
    outline: none;
    border-color: var(--ui-border-strong);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .header-icon-button:hover,
  .header-icon-button:focus-visible {
    border-color: var(--ui-border-strong);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
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
    background: var(--ui-bg);
  }

  .new-session-empty {
    display: grid;
    align-content: start;
    justify-items: center;
    gap: 1.4rem;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: clamp(2.2rem, 7vh, 4rem) 1.25rem 1.5rem;
    color: var(--ui-text-secondary);
  }

  .new-session-watermark {
    margin: 0;
    color: color-mix(in oklab, var(--ui-text-tertiary) 22%, transparent);
    font-size: 1.7rem;
    font-weight: 700;
    letter-spacing: 0;
  }

  .new-session-heading {
    display: grid;
    justify-items: center;
    gap: 0.36rem;
    text-align: center;
  }

  .new-session-heading h2,
  .new-session-heading p {
    margin: 0;
  }

  .new-session-heading h2 {
    color: var(--ui-text-primary);
    font-size: 1rem;
    font-weight: 700;
  }

  .new-session-heading p {
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
  }

  .new-session-options,
  .new-session-mode-preview,
  .new-session-recent {
    width: min(36rem, 100%);
  }

  .new-session-options {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.45rem;
  }

  .new-session-option {
    display: grid;
    justify-items: start;
    gap: 0.38rem;
    min-height: 5.4rem;
    padding: 0.82rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-subtle) 66%, transparent);
    color: var(--ui-text-secondary);
    text-align: left;
    cursor: pointer;
  }

  .new-session-option:hover:not(:disabled),
  .new-session-option:focus-visible,
  .new-session-option.active {
    border-color: color-mix(in oklab, var(--ui-accent) 32%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-surface-muted) 72%, transparent);
  }

  .new-session-option:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .new-session-option-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.42rem;
    height: 1.42rem;
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-accent) 22%, transparent);
    color: var(--ui-accent);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .new-session-option-icon.quick {
    background: color-mix(in oklab, var(--ui-warning) 20%, transparent);
    color: var(--ui-warning);
  }

  .new-session-option-icon.resume {
    background: color-mix(in oklab, var(--ui-info) 18%, transparent);
    color: var(--ui-info);
  }

  .new-session-option strong {
    color: var(--ui-text-primary);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .new-session-option small {
    color: var(--ui-text-tertiary);
    font-size: 0.64rem;
    line-height: 1.35;
  }

  .new-session-mode-preview {
    display: grid;
    gap: 0.56rem;
    padding: 0.72rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-subtle) 54%, transparent);
  }

  .new-session-mode-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--ui-text-primary);
    font-size: 0.62rem;
    font-weight: 600;
  }

  .new-session-mode-header code {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-weight: 500;
  }

  .new-session-mode-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
  }

  .new-session-mode-grid > div {
    min-height: 3.5rem;
    padding: 0.66rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface) 68%, transparent);
  }

  .new-session-mode-grid > div.active {
    border-color: color-mix(in oklab, var(--ui-accent) 34%, var(--ui-border-soft));
  }

  .new-session-mode-grid strong,
  .new-session-mode-grid p,
  .new-session-recent p {
    margin: 0;
  }

  .new-session-mode-grid strong {
    color: var(--ui-text-primary);
    font-size: 0.66rem;
  }

  .new-session-mode-grid p {
    margin-top: 0.34rem;
    color: var(--ui-text-tertiary);
    font-size: 0.62rem;
    line-height: 1.45;
  }

  .new-session-recent {
    display: grid;
    gap: 0.3rem;
  }

  .new-session-recent p {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    text-transform: uppercase;
  }

  .new-session-recent button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.7rem;
    padding: 0 0.38rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-secondary);
    text-align: left;
    cursor: pointer;
  }

  .new-session-recent button:hover,
  .new-session-recent button:focus-visible {
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
  }

  .new-session-recent span:not(.status-dot) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.68rem;
  }

  .new-session-recent small {
    color: var(--ui-text-tertiary);
    font-size: 0.58rem;
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
  .thread-inspector-metadata,
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
  .thread-inspector-metadata,
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
  .thread-inspector-metadata,
  .thread-inspector-command,
  .thread-inspector-timeline-item {
    padding: 0.72rem 0.76rem;
  }

  .thread-inspector-metadata {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .thread-inspector-metadata div {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
  }

  .thread-inspector-metadata span,
  .thread-inspector-wait span {
    font-family: var(--font-mono);
    font-size: 0.64rem;
    color: var(--ui-text-tertiary);
  }

  .thread-inspector-metadata strong {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ui-text-primary);
    font-size: 0.72rem;
    font-weight: 560;
    white-space: nowrap;
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

  .thread-inspector-wait {
    display: grid;
    gap: 0.2rem;
    padding: 0.64rem 0.7rem;
    border: 1px solid color-mix(in oklab, var(--ui-warning) 38%, var(--ui-border-soft));
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-warning-soft) 58%, var(--ui-surface));
  }

  .thread-inspector-wait strong,
  .thread-inspector-wait p {
    margin: 0;
  }

  .thread-inspector-wait strong {
    color: var(--ui-text-primary);
    font-size: 0.74rem;
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

  .titlebar-icon:hover,
  .titlebar-icon[aria-pressed="true"] {
    background: color-mix(in oklab, var(--ui-surface-subtle) 74%, transparent);
    color: var(--ui-text-primary);
  }

  .titlebar-icon[aria-pressed="true"] {
    color: color-mix(in oklab, var(--ui-accent) 64%, var(--ui-text-primary));
  }

  .titlebar-icon:focus-visible {
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
      grid-template-columns: minmax(0, 1fr) !important;
      padding: 0 0 0.32rem;
      padding-bottom: 0;
    }

    .workspace-shell {
      margin-inline: 0;
    }

    .workspace-main {
      gap: 0.42rem;
      padding: 0.32rem 0.42rem 0;
    }

    .workspace-main-header {
      gap: 0.52rem;
      padding: 0;
    }

    .workspace-main-title-row {
      max-width: 100%;
    }

    .workspace-main-title {
      font-size: 0.86rem;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .workspace-main-subtitle {
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .workspace-main-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      width: 100%;
      gap: 0.35rem;
    }

    .workspace-main-meta > span,
    .workspace-main-meta :global(.ui-button),
    .project-ci-compact {
      width: 100%;
      max-width: 100%;
      justify-content: center;
    }

    .workspace-main-chips {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.35rem;
      min-width: 0;
    }

    .workspace-main-meta :global(.ui-metadata-chip),
    .workspace-main-meta :global(.context-budget-compact) {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      flex: none;
    }

    .project-ci-compact {
      grid-column: 1 / -1;
      flex-wrap: wrap;
      justify-content: flex-start;
      padding: 0.38rem;
    }

    .pane-grid {
      display: flex;
      flex-direction: column;
      gap: 0.48rem;
      overflow: auto;
      padding-bottom: 0.28rem;
    }

    .workspace-pane {
      min-height: min(34rem, calc(100dvh - 12rem));
      border-radius: var(--ui-radius-md);
    }

    .pane-chrome {
      align-items: flex-start;
      gap: 0.44rem;
      min-height: 2.75rem;
      padding: 0.5rem;
    }

    .pane-focus-button {
      min-height: 2.1rem;
      justify-content: center;
    }

    .pane-focus-button > span:not(.pane-title-line) {
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .pane-chrome-meta {
      display: none;
    }

    .pane-drag-handle,
    .pane-chrome-actions button,
    .titlebar-icon {
      width: 2.75rem;
      min-width: 2.75rem;
      height: 2.75rem;
    }

    .pane-divider-shell,
    .pane-drag-ghost,
    .pane-span-drop-zone {
      display: none;
    }

    .structured-command-card-top,
    .structured-command-card-footer,
    .thread-inspector-summary-top,
    .thread-inspector-command-top,
    .thread-inspector-timeline-top,
    .thread-inspector-section-header,
    .command-inspector-summary-top,
    .command-inspector-child-top,
    .command-inspector-artifact {
      flex-direction: column;
      align-items: stretch;
    }

    .handler-thread-actions,
    .thread-inspector-actions,
    .thread-inspector-command-footer,
    .handler-thread-pills,
    .structured-command-card-meta,
    .thread-inspector-summary-meta,
    .thread-inspector-pills,
    .thread-inspector-command-meta,
    .command-inspector-summary-meta,
    .command-inspector-child-meta,
    .command-inspector-child-footer,
    .command-inspector-pills {
      justify-content: flex-start;
    }

    .thread-inspector-metadata {
      grid-template-columns: minmax(0, 1fr);
    }

    .mobile-overlay {
      padding: 0.42rem;
    }
  }
</style>
