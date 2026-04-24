<script lang="ts">
  import { onMount } from "svelte";
  import PanelLeftCloseIcon from "@lucide/svelte/icons/panel-left-close";
  import PanelLeftOpenIcon from "@lucide/svelte/icons/panel-left-open";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
  import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
  import ArtifactsPanel from "./ArtifactsPanel.svelte";
  import { ArtifactsController, type ArtifactsSnapshot } from "./artifacts";
  import ChatComposer from "./ChatComposer.svelte";
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
    WorkspaceWorkflowTaskAttemptInspector,
    WorkspaceWorkflowTaskAttemptSummary,
    PromptTarget,
    WorkspaceSessionSummary,
  } from "./chat-rpc";
  import type { PromptHistoryEntry } from "./prompt-history";
  import {
    clampSidebarWidth,
    getMaxSidebarWidth,
    isSidebarToggleShortcut,
    MIN_SIDEBAR_WIDTH,
  } from "./sidebar-layout";
  import { sortVisibleSessionsByRecency } from "./session-state";
  import SessionSidebar from "./SessionSidebar.svelte";
  import ChatTranscript from "./ChatTranscript.svelte";
  import {
    PRIMARY_CHAT_PANE_ID,
    type ChatRuntime,
    type ChatPaneLayoutState,
    type ChatPaneState,
    type ChatSurfaceController,
  } from "./chat-runtime";
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
  let activeSessionId = $state<string | undefined>(undefined);
  let paneLayout = $state<ChatPaneLayoutState>({
    panes: [{ id: PRIMARY_CHAT_PANE_ID, target: null }],
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

  let sidebarResizePointerId: number | null = null;
  let sidebarResizeOriginX = 0;
  let sidebarResizeOriginWidth = DEFAULT_SIDEBAR_WIDTH;
  let copyTranscriptResetTimer: ReturnType<typeof setTimeout> | null = null;
  let commandInspectorSessionId: string | null = null;
  let handlerThreadLoadToken = 0;
  let threadInspectorSessionId: string | null = null;
  let workflowTaskAttemptInspectorSessionId: string | null = null;
  let unsubscribeSurfaceController: (() => void) | null = null;

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
  const visibleSessions = $derived(sortVisibleSessionsByRecency(sessions));
  const currentSession = $derived(sessions.find((session) => session.id === activeSessionId) ?? null);
  const currentCommandRollups = $derived(getVisibleCommandRollups(currentSession));
  const currentSurface = $derived(focusedSurfaceTarget);
  const currentSurfaceLabel = $derived.by(() => {
    if (currentSurface?.surface === "thread") {
      return `Messaging handler thread ${currentSurface.threadId ?? currentSurface.surfacePiSessionId}`;
    }

    return "Messaging orchestrator";
  });
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

  async function handleCreateSession() {
    await runSessionMutation(() => runtime.createSession({}, runtime.primaryPaneId));
  }

  async function handleOpenSession(sessionId: string) {
    if (
      sessionId === activeSessionId &&
      currentSurface?.surface === "orchestrator" &&
      currentSurface.workspaceSessionId === sessionId
    ) {
      return;
    }
    await runSessionMutation(() => runtime.openSession(sessionId, runtime.primaryPaneId));
  }

  function handleRenameSession(session: WorkspaceSessionSummary) {
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
    await runSessionMutation(() => runtime.forkSession(session.id, undefined, runtime.primaryPaneId));
  }

  async function handleResetSurfaceTarget() {
    const session = currentSession;
    if (!session) {
      return;
    }
    await runSessionMutation(() => runtime.openSession(session.id, runtime.primaryPaneId));
  }

  function handleDeleteSession(session: WorkspaceSessionSummary) {
    deleteTarget = session;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await runSessionMutation(async () => {
      await runtime.deleteSession(target.id, runtime.primaryPaneId);
      deleteTarget = null;
    });
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
    return artifactsSnapshot.artifacts.some((record) => record.filename === artifact.name);
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

  async function handleOpenHandlerThread(
    thread: Pick<WorkspaceHandlerThreadSummary, "threadId" | "surfacePiSessionId">,
  ) {
    const session = currentSession;
    if (!session) {
      return;
    }

    closeThreadInspector();
    await runSessionMutation(() =>
      runtime.openSurface(
        {
          workspaceSessionId: session.id,
          surface: "thread",
          surfacePiSessionId: thread.surfacePiSessionId,
          threadId: thread.threadId,
        },
        runtime.primaryPaneId,
      ),
    );
  }

  async function handleInspectHandlerThread(thread: WorkspaceHandlerThreadSummary) {
    const session = currentSession;
    if (!session) {
      return;
    }

    showThreadInspector = true;
    threadInspector = null;
    threadInspectorError = undefined;
    threadInspectorLoading = true;
    threadInspectorThreadId = thread.threadId;
    threadInspectorSessionId = session.id;

    try {
      const inspector = await runtime.getHandlerThreadInspector(thread.threadId, session.id);
      if (threadInspectorThreadId !== thread.threadId || threadInspectorSessionId !== session.id) {
        return;
      }

      threadInspector = inspector;
    } catch (error) {
      if (threadInspectorThreadId !== thread.threadId || threadInspectorSessionId !== session.id) {
        return;
      }

      threadInspectorError =
        error instanceof Error ? error.message : "Unable to inspect this handler thread.";
    } finally {
      if (threadInspectorThreadId === thread.threadId && threadInspectorSessionId === session.id) {
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
      await runtime.openSurface(target, runtime.primaryPaneId);
      await runtime.sendPromptToTarget(target, prompt);
    });
  }

  async function handleInspectWorkflowTaskAttempt(
    workflowTaskAttempt: Pick<WorkspaceWorkflowTaskAttemptSummary, "workflowTaskAttemptId">,
  ) {
    const session = currentSession;
    if (!session) {
      return;
    }

    showWorkflowTaskAttemptInspector = true;
    workflowTaskAttemptInspector = null;
    workflowTaskAttemptInspectorError = undefined;
    workflowTaskAttemptInspectorLoading = true;
    workflowTaskAttemptInspectorId = workflowTaskAttempt.workflowTaskAttemptId;
    workflowTaskAttemptInspectorSessionId = session.id;

    try {
      const inspector = await runtime.getWorkflowTaskAttemptInspector(
        workflowTaskAttempt.workflowTaskAttemptId,
        session.id,
      );
      if (
        workflowTaskAttemptInspectorId !== workflowTaskAttempt.workflowTaskAttemptId ||
        workflowTaskAttemptInspectorSessionId !== session.id
      ) {
        return;
      }

      workflowTaskAttemptInspector = inspector;
    } catch (error) {
      if (
        workflowTaskAttemptInspectorId !== workflowTaskAttempt.workflowTaskAttemptId ||
        workflowTaskAttemptInspectorSessionId !== session.id
      ) {
        return;
      }

      workflowTaskAttemptInspectorError =
        error instanceof Error ? error.message : "Unable to inspect this workflow task attempt.";
    } finally {
      if (
        workflowTaskAttemptInspectorId === workflowTaskAttempt.workflowTaskAttemptId &&
        workflowTaskAttemptInspectorSessionId === session.id
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
    paneLayout = runtime.paneLayout;
    focusedPaneId = paneLayout.focusedPaneId;
    currentPane = runtime.getPane(runtime.primaryPaneId) ?? null;
    focusedSurfaceTarget = currentPane?.target ?? null;
    activeSessionId = currentPane?.target?.workspaceSessionId;
    currentSurfaceController = runtime.getPaneController(runtime.primaryPaneId);
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
            sessions={visibleSessions}
            {activeSessionId}
            activeSurface={currentSurface?.surface}
            busy={mutatingSession}
            errorMessage={sidebarError}
            onCreateSession={handleCreateSession}
            onOpenSession={handleOpenSession}
            onRenameSession={handleRenameSession}
            onForkSession={handleForkSession}
            onDeleteSession={handleDeleteSession}
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
        </div>
      </header>

      <section class="chat-pane" id="conversation">
        <div class="chat-pane-shell">
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
                          disabled={promptBusy || mutatingSession}
                          onclick={() => void handleInspectHandlerThread(thread)}
                        >
                          Inspect
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
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
            onOpenArtifact={handleOpenArtifact}
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
          />
        </div>
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
                    {#if artifact.path}
                      <code>{artifact.path}</code>
                    {/if}
                  </div>
                  {#if canOpenArtifactLink(artifact)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => handleOpenArtifact(artifact.name)}
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
                      {#if artifact.path}
                        <code>{artifact.path}</code>
                      {/if}
                    </div>
                    {#if canOpenArtifactLink(artifact)}
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => handleOpenArtifact(artifact.name)}
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
                              </div>
                              {#if canOpenArtifactLink(artifact)}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onclick={() => handleOpenArtifact(artifact.name)}
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
                    {#if artifact.path}
                      <code>{artifact.path}</code>
                    {/if}
                  </div>
                  {#if canOpenArtifactLink(artifact)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => handleOpenArtifact(artifact.name)}
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

  .chat-pane {
    min-height: 0;
  }

  .chat-pane-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 1px solid color-mix(in oklab, var(--ui-shell-edge) 72%, transparent);
    border-radius: calc(var(--ui-radius-xl) + 0.12rem);
    background:
      linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 80%, transparent), transparent),
      color-mix(in oklab, var(--ui-shell) 88%, transparent);
    box-shadow: var(--ui-shadow-soft);
  }

  .handler-thread-panel,
  .structured-command-panel {
    display: grid;
    gap: 0.72rem;
    padding: 0.92rem 1rem 0.82rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-shell-edge) 66%, transparent);
    background:
      linear-gradient(
        180deg,
        color-mix(in oklab, var(--ui-surface-raised) 78%, transparent),
        transparent
      ),
      color-mix(in oklab, var(--ui-surface-subtle) 54%, transparent);
  }

  .handler-thread-header,
  .structured-command-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .handler-thread-header h3,
  .handler-thread-eyebrow,
  .handler-thread-copy,
  .structured-command-header h3,
  .structured-command-eyebrow,
  .structured-command-copy {
    margin: 0;
  }

  .handler-thread-eyebrow,
  .structured-command-eyebrow {
    font-size: 0.64rem;
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ui-text-tertiary);
  }

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
    max-width: 28rem;
    font-size: 0.72rem;
    line-height: 1.5;
    color: var(--ui-text-secondary);
  }

  .handler-thread-list {
    display: grid;
    gap: 0.55rem;
    max-height: 18rem;
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

  .structured-command-list {
    display: grid;
    gap: 0.5rem;
    max-height: 13rem;
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
  .thread-inspector-empty,
  .command-inspector-empty {
    padding: 0.9rem;
    border-radius: var(--ui-radius-md);
    border: 1px dashed color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
  }

  .handler-thread-empty.error,
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
