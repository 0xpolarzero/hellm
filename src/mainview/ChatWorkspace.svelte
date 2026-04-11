<script lang="ts">
  import { onMount } from "svelte";
  import type { AssistantMessage, Model, Usage } from "@mariozechner/pi-ai";
  import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
  import ArtifactsPanel from "./ArtifactsPanel.svelte";
  import { ArtifactsController, type ArtifactsSnapshot } from "./artifacts";
  import ChatComposer from "./ChatComposer.svelte";
  import { formatTimestamp, formatUsage } from "./chat-format";
  import type { WorkspaceSessionSummary } from "./chat-rpc";
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
  import type { ChatRuntime } from "./chat-runtime";
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

  const ZERO_USAGE: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };

  let controller = $state<ArtifactsController | null>(null);
  let messages = $state<ChatRuntime["agent"]["state"]["messages"]>([]);
  let streamingMessage = $state<AssistantMessage | null>(null);
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
  let sidebarError = $state<string | undefined>(undefined);
  let sidebarHidden = $state(false);
  let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
  let sidebarResizing = $state(false);
  let mutatingSession = $state(false);
  let renameTarget = $state<WorkspaceSessionSummary | null>(null);
  let renameValue = $state("");
  let deleteTarget = $state<WorkspaceSessionSummary | null>(null);
  let sidebarResizeHandle = $state<HTMLDivElement | null>(null);

  let sidebarResizePointerId: number | null = null;
  let sidebarResizeOriginX = 0;
  let sidebarResizeOriginWidth = DEFAULT_SIDEBAR_WIDTH;

  const artifactCount = $derived(artifactsSnapshot.artifacts.length);
  const hasArtifacts = $derived(artifactCount > 0);
  const showDesktopSplit = $derived(windowWidth >= DESKTOP_SPLIT_BREAKPOINT && showArtifactsPanel && hasArtifacts);
  const showOverlayArtifacts = $derived(windowWidth < DESKTOP_SPLIT_BREAKPOINT && showArtifactsPanel && hasArtifacts);
  const effectiveSidebarWidth = $derived(clampSidebarWidth(sidebarWidth, windowWidth));
  const workspaceStatusText = $derived(errorMessage ? "Attention" : isStreaming ? "Streaming" : "Ready");
  const workspaceStatusTone = $derived(errorMessage ? "danger" : isStreaming ? "warning" : "neutral");
  const visibleSessions = $derived(sortVisibleSessionsByRecency(sessions));
  const currentSession = $derived(sessions.find((session) => session.id === activeSessionId) ?? null);
  const totalUsage = $derived.by(() =>
    messages
      .filter((message): message is AssistantMessage => message.role === "assistant")
      .reduce(
        (usage, message) => ({
          input: usage.input + message.usage.input,
          output: usage.output + message.usage.output,
          cacheRead: usage.cacheRead + message.usage.cacheRead,
          cacheWrite: usage.cacheWrite + message.usage.cacheWrite,
          totalTokens: usage.totalTokens + message.usage.totalTokens,
          cost: {
            input: usage.cost.input + message.usage.cost.input,
            output: usage.cost.output + message.usage.cost.output,
            cacheRead: usage.cost.cacheRead + message.usage.cost.cacheRead,
            cacheWrite: usage.cost.cacheWrite + message.usage.cost.cacheWrite,
            total: usage.cost.total + message.usage.cost.total,
          },
        }),
        ZERO_USAGE,
      ),
  );
  const usageText = $derived(formatUsage(totalUsage));
  const messageCount = $derived(
    messages.filter((message) => message.role === "user" || message.role === "assistant").length + (streamingMessage ? 1 : 0),
  );
  const toolCallCount = $derived.by(() => {
    let count = 0;
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      count += message.content.filter((block) => block.type === "toolCall").length;
    }
    if (streamingMessage) {
      count += streamingMessage.content.filter((block) => block.type === "toolCall").length;
    }
    return count;
  });
  const lastActivity = $derived.by(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
        return message.timestamp;
      }
    }
    return null;
  });
  const lastActivityLabel = $derived(lastActivity ? `Last activity ${formatTimestamp(lastActivity)}` : "Waiting for first turn");

  async function openModelSelector() {
    showModelPicker = true;
    allowedProviders = [currentModel.provider];
    try {
      const configuredProviders = await runtime.listConfiguredProviders();
      allowedProviders = Array.from(new Set([currentModel.provider, ...configuredProviders]));
    } catch {
      allowedProviders = [currentModel.provider];
    }
  }

  function syncAgentState() {
    messages = [...runtime.agent.state.messages];
    streamingMessage = runtime.agent.state.streamingMessage?.role === "assistant" ? runtime.agent.state.streamingMessage : null;
    pendingToolCalls = new Set(runtime.agent.state.pendingToolCalls);
    isStreaming = runtime.agent.state.isStreaming;
    errorMessage = runtime.agent.state.errorMessage;
    currentModel = runtime.agent.state.model;
    currentThinkingLevel = runtime.agent.state.thinkingLevel as ThinkingLevel;
  }

  function syncRuntimeState() {
    sessions = [...runtime.sessions];
    activeSessionId = runtime.activeSessionId;
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

  async function rebuildArtifacts() {
    if (!controller) return;
    await controller.reconstructFromMessages(runtime.agent.state.messages);
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
      syncAgentState();
      await rebuildArtifacts();
    } catch (error) {
      sidebarError = error instanceof Error ? error.message : "Session update failed.";
    } finally {
      mutatingSession = false;
    }
  }

  async function handleCreateSession() {
    await runSessionMutation(() => runtime.createSession());
  }

  async function handleOpenSession(sessionId: string) {
    if (sessionId === activeSessionId) return;
    await runSessionMutation(() => runtime.openSession(sessionId));
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
    await runSessionMutation(() => runtime.forkSession(session.id));
  }

  function handleDeleteSession(session: WorkspaceSessionSummary) {
    deleteTarget = session;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await runSessionMutation(async () => {
      await runtime.deleteSession(target.id);
      deleteTarget = null;
    });
  }

  async function handleSend(input: string): Promise<boolean> {
    if (!input.trim() || runtime.agent.state.isStreaming) return false;

    const hasProviderAccess = await runtime.requireProviderAccess(runtime.agent.state.model.provider);
    if (!hasProviderAccess) return false;

    await runtime.agent.prompt(input);
    try {
      const entry = await runtime.storage.promptHistory.append({
        text: input,
        sentAt: Date.now(),
        workspaceId: runtime.workspaceId,
        sessionId: runtime.agent.sessionId ?? undefined,
      });
      promptHistory = [...promptHistory, entry];
    } catch (error) {
      console.error("Failed to persist prompt history:", error);
    }
    return true;
  }

  function handleOpenArtifact(filename: string) {
    controller?.selectArtifact(filename);
    showArtifactsPanel = true;
  }

  syncRuntimeState();
  syncAgentState();

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

    runtime.agent.state.tools = [nextController.tool];
    syncAgentState();
    void runtime.storage.promptHistory
      .list(runtime.workspaceId)
      .then((entries) => {
        promptHistory = entries;
      })
      .catch((error) => {
        console.error("Failed to load prompt history:", error);
      });

    const unsubscribeAgent = runtime.agent.subscribe(() => {
      syncAgentState();
    });
    const unsubscribeRuntime = runtime.subscribe(() => {
      syncRuntimeState();
      syncAgentState();
      void rebuildArtifacts();
    });
    const unsubscribeArtifacts = nextController.subscribe((snapshot) => {
      syncArtifacts(snapshot);
    });
    void nextController.reconstructFromMessages(runtime.agent.state.messages);

    return () => {
      unsubscribeAgent();
      unsubscribeRuntime();
      unsubscribeArtifacts();
      nextController.dispose();
      setSidebarResizing(false);
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
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M2.75 3.5H17.25V16.5H2.75Z" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path d={sidebarHidden ? "M5.5 3.5V16.5" : "M7.5 3.5V16.5"} fill="none" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
      <p class="workspace-titlebar-title">hellm</p>
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
            busy={mutatingSession || isStreaming}
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
        </div>

        <div class="workspace-main-meta">
          <Badge tone={workspaceStatusTone}>{workspaceStatusText}</Badge>
          <span>{messageCount} turns</span>
          <span>{toolCallCount} tool runs</span>
          <span>{lastActivityLabel}</span>
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
          <ChatTranscript
            {messages}
            streamingMessage={streamingMessage ?? undefined}
            {pendingToolCalls}
            {isStreaming}
            onOpenArtifact={handleOpenArtifact}
          />
          <ChatComposer
            currentModel={currentModel ?? runtime.agent.state.model}
            thinkingLevel={currentThinkingLevel}
            {isStreaming}
            {errorMessage}
            {promptHistory}
            usageText={usageText || undefined}
            onAbort={() => runtime.agent.abort()}
            onOpenModelPicker={() => void openModelSelector()}
            onSend={handleSend}
            onThinkingChange={(level) => {
              currentThinkingLevel = level;
              runtime.agent.setThinkingLevel(level);
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
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M6.52 1.39a1 1 0 0 1 1.96 0l.18 1.08c.23.08.45.17.66.28l.95-.55a1 1 0 0 1 1.34.37l.98 1.69a1 1 0 0 1-.37 1.35l-.95.55c.02.12.03.25.03.38s-.01.26-.03.38l.95.55a1 1 0 0 1 .37 1.35l-.98 1.69a1 1 0 0 1-1.34.37l-.95-.55c-.21.11-.43.2-.66.28l-.18 1.08a1 1 0 0 1-1.96 0l-.18-1.08a4.78 4.78 0 0 1-.66-.28l-.95.55a1 1 0 0 1-1.34-.37l-.98-1.69a1 1 0 0 1 .37-1.35l.95-.55A3.3 3.3 0 0 1 4.3 8c0-.13.01-.26.03-.38l-.95-.55a1 1 0 0 1-.37-1.35l.98-1.69a1 1 0 0 1 1.34-.37l.95.55c.21-.11.43-.2.66-.28l.18-1.08ZM8 10.12A2.12 2.12 0 1 0 8 5.88a2.12 2.12 0 0 0 0 4.24Z"
              fill="currentColor"
            />
          </svg>
        </button>
      {/if}
    </div>
  </footer>
</div>

{#if showModelPicker}
  <ModelPickerDialog
    currentModel={currentModel ?? runtime.agent.state.model}
    allowedProviders={allowedProviders}
    storage={runtime.storage}
    onClose={() => (showModelPicker = false)}
    onSelect={(model) => {
      currentModel = model;
      runtime.agent.setModel(model);
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
    align-items: center;
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
    grid-template-rows: minmax(0, 1fr) auto;
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

  .titlebar-icon[aria-pressed="true"] svg {
    color: color-mix(in oklab, var(--ui-accent) 64%, var(--ui-text-primary));
  }

  .titlebar-icon:focus-visible,
  .statusbar-icon:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .titlebar-icon svg {
    width: 0.8rem;
    height: 0.8rem;
  }

  .statusbar-icon svg {
    width: 0.76rem;
    height: 0.76rem;
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
