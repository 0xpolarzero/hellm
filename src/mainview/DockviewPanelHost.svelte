<script lang="ts">
	import ChatComposer from "./ChatComposer.svelte";
	import type {
		ComposerEditDraft,
		ComposerModelOption,
		ComposerSubmit,
	} from "./ChatComposer.svelte";
  import ChatTranscript from "./ChatTranscript.svelte";
  import RelatedInspectorPane from "./RelatedInspectorPane.svelte";
  import AppLogsPane from "./AppLogsPane.svelte";
  import AgentsPane from "./AgentsPane.svelte";
  import ExtensionsPane from "./ExtensionsPane.svelte";
  import OpenWorkspacePanel from "./OpenWorkspacePanel.svelte";
  import Settings from "./Settings.svelte";
  import SnippetsPane from "./SnippetsPane.svelte";
  import WorkflowsPane from "./WorkflowsPane.svelte";
  import Button from "./ui/Button.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import { projectConversation } from "./conversation-projection";
  import { getVisibleCommandRollups } from "./command-inspector";
  import { buildSurfaceContextBudget } from "./context-budget";
  import { getSurfaceDisplayTitle } from "./surface-title";
  import {
    buildTranscriptSemanticBlocks,
    type TranscriptSemanticBlock,
  } from "./transcript-projection";
  import type { PromptHistoryEntry } from "./prompt-history";
  import type { ChatRuntime } from "./chat-runtime";
  import type { ChatSurfaceController } from "./chat-runtime";
  import type { QueuedPrompt } from "./chat-runtime";
  import {
    DEFAULT_AGENT_SETTINGS_STATE,
    type AgentSettingsState,
    type AppAppearance,
  } from "../shared/agent-settings";
  import {
    extensionUsageItems as buildExtensionUsageItems,
    type AgentContextActor,
    type ExtensionUsageControlItem,
  } from "./agents-pane-extension-usage";
  import type { ExtensionUsageState } from "../shared/extensions";
  import type {
    WorkspaceHandlerThreadSummary,
    WorkspaceSessionSummary,
    WorkspaceTabInfo,
  } from "../shared/workspace-contract";
  import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
  import { getModel, type UserMessage } from "@mariozechner/pi-ai";
  import { onDestroy, onMount } from "svelte";
  import type { AgentModelChoice } from "../shared/workspace-contract";

  type Props = {
    runtime: ChatRuntime;
    panelId: string;
    agentSettings?: AgentSettingsState | null;
    onOpenModelPicker: (panelId: string) => void;
    openingWorkspace?: boolean;
    openWorkspaceError?: string | null;
    recentWorkspaces?: WorkspaceTabInfo[];
    onOpenWorkspace?: () => void;
    onOpenWorkspaceInNewTab?: () => void;
    onOpenAgentProfile?: (agentProfileId: string) => void;
    onAgentSettingsChanged?: (settings: AgentSettingsState) => void;
    onProviderAuthChanged?: (providerId: string) => void | Promise<void>;
    onAppAppearanceChanged?: (appearance: AppAppearance) => void;
  };

  let {
    runtime,
    panelId,
    agentSettings = null,
    onOpenModelPicker,
    openingWorkspace = false,
    openWorkspaceError = null,
    recentWorkspaces = [],
    onOpenWorkspace,
    onOpenWorkspaceInNewTab,
    onOpenAgentProfile,
    onAgentSettingsChanged,
    onProviderAuthChanged,
    onAppAppearanceChanged,
  }: Props = $props();
  let controller = $state<ChatSurfaceController | null>(null);
  let pane = $state<ReturnType<ChatRuntime["getPane"]> | null>(null);
  let sessions = $state<WorkspaceSessionSummary[]>([]);
  let promptHistory = $state<PromptHistoryEntry[]>([]);
  let messages = $state<ChatSurfaceController["agent"]["state"]["messages"]>([]);
  let pendingToolCalls = $state(new Set<string>());
  let queuedMessages = $state<QueuedPrompt[]>([]);
  let composerDraft = $state<ChatSurfaceController["composerDraft"]>({
    text: "",
    attachments: [],
    snippetMentions: [],
    updatedAt: null,
  });
  let composerBuffer = $state<{
    text: string;
    attachments: ChatSurfaceController["composerDraft"]["attachments"];
    snippetMentions?: ChatSurfaceController["composerDraft"]["snippetMentions"];
  }>({
    text: "",
    attachments: [],
    snippetMentions: [],
  });
  let promptBinding = $state<ChatSurfaceController["promptBinding"]>(undefined);
  let resolvedSystemPrompt = $state("");
  let isStreaming = $state(false);
  let activeTurnStartedAt = $state<string | null>(null);
  let turnTimings = $state<ChatSurfaceController["turnTimings"]>([]);
  let errorMessage = $state<string | undefined>(undefined);
  let currentModel = $state<ChatSurfaceController["agent"]["state"]["model"] | null>(null);
  let currentThinkingLevel = $state<ThinkingLevel>("off");
  let handlerThreads = $state<WorkspaceHandlerThreadSummary[]>([]);
  let handlerThreadsSessionId = $state<string | null>(null);
  let handlerThreadLoadToken = 0;
  let controllerRevision = $state(0);
  let workspaceMentionPaths = $state<ReadonlySet<string>>(new Set());
  let editDraft = $state<ComposerEditDraft | null>(null);
  let pendingEditMessage = $state<{ message: UserMessage; text: string } | null>(null);
  let unsubscribeRuntime = $state<(() => void) | null>(null);
  let unsubscribeController = $state<(() => void) | null>(null);

  const conversation = $derived(projectConversation(messages));
  const currentSession = $derived<WorkspaceSessionSummary | null>(
    controller
      ? (sessions.find(
          (session) => session.id === controller?.target.workspaceSessionId,
        ) ?? null)
      : null,
  );
  const currentCommandRollups = $derived(getVisibleCommandRollups(currentSession));
  const transcriptSemanticBlocks = $derived(
    buildTranscriptSemanticBlocks({
      session: currentSession,
      errorMessage,
      commandRollups: currentCommandRollups,
      handlerThreads,
    }),
  );
  const contextBudget = $derived(currentModel ? buildSurfaceContextBudget(messages, currentModel) : null);
  const surfaceDisplayTitle = $derived(
    getSurfaceDisplayTitle(
      controller?.target,
      sessions,
      pane?.target?.surface === "thread" ? "Handler Thread" : "Orchestrator",
    ),
  );
  const visibleStreamMessage = $derived.by(() => {
    void controllerRevision;
    const message = controller?.agent.state.streamMessage;
    return controller?.promptStatus === "streaming" && message?.role === "assistant"
      ? message
      : undefined;
  });
  const queuedPromptRefresh = $derived(
    queuedMessages.find((message) => message.kind === "agent_context_refresh") ?? null,
  );
  const queuedPromptRefreshCancellable = $derived(
    Boolean(
      queuedPromptRefresh &&
        queuedPromptRefresh.status !== "dispatching" &&
        queuedPromptRefresh.status !== "failed",
    ),
  );
  const terminalPromptRefresh = $derived(controller?.agentContextUpdate ?? null);
  const queuedPromptRefreshChangeCount = $derived.by(() => {
    const update = queuedPromptRefresh?.agentContextUpdate;
    if (!update) return 0;
    return [
      update.systemPromptChanged ? 1 : 0,
      update.loadedExtensionIds.added.length,
      update.loadedExtensionIds.removed.length,
      update.availableExtensionIds.added.length,
      update.availableExtensionIds.removed.length,
      update.externalSourceHashes.added.length,
      update.externalSourceHashes.removed.length,
    ].reduce((sum, count) => sum + count, 0);
  });
  const editingUserMessageTimestamp = $derived(editDraft?.messageTimestamp ?? null);
  const activeSystemPrompt = $derived(resolvedSystemPrompt.trim());
  const composerExtensionActor = $derived<AgentContextActor>(
    controller?.target.surface === "thread" ? "handler" : "orchestrator",
  );
  const composerExtensionUsage = $derived.by<Record<string, ExtensionUsageState>>(() => {
    void controllerRevision;
    if (!controller) return {};
    const usage: Record<string, ExtensionUsageState> = {};
    for (const extensionId of controller.loadedExtensionIds) {
      usage[extensionId] = "loaded";
    }
    for (const extensionId of controller.availableExtensionIds) {
      if (usage[extensionId] === undefined) {
        usage[extensionId] = "available";
      }
    }
    const inventoryIds = new Set(
      runtime.extensionsInventorySnapshot?.extensions.map((extension) => extension.id) ?? [],
    );
    for (const extensionId of inventoryIds) {
      if (usage[extensionId] === undefined) {
        usage[extensionId] = "unavailable";
      }
    }
    return usage;
  });
  const composerExtensionUsageItems = $derived<ExtensionUsageControlItem[]>(
    buildExtensionUsageItems({
      actor: composerExtensionActor,
      profileId: controller?.agentProfileId ?? "composer-surface",
      usage: composerExtensionUsage,
      extensionInventoryItems: runtime.extensionsInventorySnapshot?.extensions ?? [],
      extensionDefaults: agentSettings?.extensionDefaults ?? DEFAULT_AGENT_SETTINGS_STATE.extensionDefaults,
      networkAccess: agentSettings?.appPreferences.networkAccess ?? true,
    }),
  );
  const hasSurfaceMetadata = $derived(
    Boolean(promptBinding?.stale || terminalPromptRefresh || activeSystemPrompt),
  );

  function syncSurfaceState() {
    controllerRevision += 1;
    if (!controller) {
      messages = [];
      pendingToolCalls = new Set();
      queuedMessages = [];
      composerDraft = { text: "", attachments: [], snippetMentions: [], updatedAt: null };
      composerBuffer = { text: "", attachments: [], snippetMentions: [] };
      promptBinding = undefined;
      resolvedSystemPrompt = "";
      isStreaming = false;
      activeTurnStartedAt = null;
      turnTimings = [];
      errorMessage = undefined;
      currentModel = null;
      currentThinkingLevel = "off";
      handlerThreads = [];
      handlerThreadsSessionId = null;
      handlerThreadLoadToken += 1;
      return;
    }

    messages = [...controller.agent.state.messages];
    pendingToolCalls = new Set(controller.agent.state.pendingToolCalls);
    queuedMessages = [...controller.queuedPrompts];
    composerDraft = structuredClone(controller.composerDraft);
    if (!editDraft) {
      composerBuffer = {
        text: controller.composerDraft.text,
        attachments: structuredClone(controller.composerDraft.attachments),
        snippetMentions: structuredClone(controller.composerDraft.snippetMentions ?? []),
      };
    }
    promptBinding = controller.promptBinding;
    resolvedSystemPrompt = controller.resolvedSystemPrompt;
    isStreaming = controller.agent.state.isStreaming || controller.promptStatus === "streaming";
    activeTurnStartedAt = controller.activeTurnStartedAt;
    turnTimings = structuredClone(controller.turnTimings);
    errorMessage = controller.agent.state.error;
    currentModel = controller.agent.state.model;
    currentThinkingLevel = controller.agent.state.thinkingLevel as ThinkingLevel;
  }

  function syncPanel() {
    pane = runtime.getPane(panelId) ?? null;
    sessions = [...runtime.sessions];
    const nextController = runtime.getPaneController(panelId);
    if (nextController !== controller) {
      unsubscribeController?.();
      controller = nextController;
      editDraft = null;
      unsubscribeController = controller?.subscribe(syncSurfaceState) ?? null;
    }
    syncSurfaceState();
    refreshHandlerThreadBlocks();
  }

  function refreshHandlerThreadBlocks() {
    if (!controller || controller.target.surface !== "orchestrator") {
      handlerThreads = [];
      handlerThreadsSessionId = null;
      handlerThreadLoadToken += 1;
      return;
    }

    const sessionId = controller.target.workspaceSessionId;
    if (handlerThreadsSessionId !== sessionId) {
      handlerThreads = [];
    }
    handlerThreadsSessionId = sessionId;
    const loadToken = ++handlerThreadLoadToken;
    void runtime
      .listHandlerThreads(sessionId)
      .then((nextThreads) => {
        if (loadToken !== handlerThreadLoadToken) return;
        handlerThreads = nextThreads;
      })
      .catch(() => {
        if (loadToken !== handlerThreadLoadToken) return;
        handlerThreads = [];
      });
  }

  function openExtension(extensionId: string): void {
    void runtime.openSurface(
      {
        surface: "extensions",
        view: "inventory",
        targetExtensionId: extensionId,
      },
      { kind: "focused-panel" },
    );
  }

  function transcriptSplitTarget() {
    return { kind: "split" as const, panelId, direction: "right" as const };
  }

	async function send(input: ComposerSubmit): Promise<boolean> {
		if (!controller || (!input.text.trim() && input.attachments.length === 0)) return false;
		await runtime.focusPane(panelId);
		if (input.editMessageTimestamp !== undefined) {
			await controller.editCommittedUserMessage(input.editMessageTimestamp, input);
		} else {
			await controller.sendPrompt(input);
		}
		promptHistory = await runtime.storage.promptHistory.list(runtime.workspaceId);
		return true;
	}

	async function stopAgent(): Promise<void> {
		if (!controller) return;
		await controller.abort();
	}

  function startEditingUserMessage(message: UserMessage, text: string): void {
    editDraft = {
      messageTimestamp: message.timestamp,
      text,
    };
    pendingEditMessage = null;
  }

  function editUserMessageFromTranscript(message: UserMessage, text: string): void {
    if (!text.trim()) return;
    if (String(editDraft?.messageTimestamp) === String(message.timestamp)) return;
    const hasComposerDraft =
      composerBuffer.text.trim().length > 0 ||
      composerBuffer.attachments.length > 0 ||
      (composerBuffer.snippetMentions?.length ?? 0) > 0;
    if (hasComposerDraft) {
      pendingEditMessage = { message, text };
      return;
    }
    startEditingUserMessage(message, text);
  }

  function modelChoiceValue(choice: Pick<AgentModelChoice, "providerId" | "modelId">): string {
    return `${choice.providerId}:${choice.modelId}`;
  }

  function modelChoiceToComposerOption(choice: AgentModelChoice): ComposerModelOption | null {
    if (!currentModel) return null;
    const currentValue = `${currentModel.provider}:${currentModel.id}`;
    if (!choice.providerAuthenticated && modelChoiceValue(choice) !== currentValue) return null;
    try {
      const model = getModel(
        choice.providerId as Parameters<typeof getModel>[0],
        choice.modelId as Parameters<typeof getModel>[1],
      );
      return {
        value: modelChoiceValue(choice),
        label: model.name,
        triggerLabel: model.name,
        searchText: `${model.name} ${choice.modelId} ${choice.providerId}`,
        disabled: !choice.providerAuthenticated,
        model,
        supportedThinkingLevels: choice.supportedReasoning,
      };
    } catch {
      return null;
    }
  }

  async function listModelsForComposer(): Promise<ComposerModelOption[]> {
    if (!currentModel) return [];
    const catalog = runtime.agentModelChoicesSnapshot ?? (await runtime.getAgentModelChoices());
    return catalog.items
      .map(modelChoiceToComposerOption)
      .filter((option): option is ComposerModelOption => Boolean(option));
  }

  async function forkFromAssistantMessage(messageTimestamp: string | number): Promise<void> {
    if (!controller) return;
    await runtime.forkSession(
      controller.target.workspaceSessionId,
      undefined,
      { kind: "new-panel", direction: "right" },
      { messageTimestamp },
    );
  }

  async function openArtifactFromTranscript(target: string | { id: string; name: string }): Promise<void> {
    if (typeof target === "object") {
      if (!controller) return;
      await runtime.openSurface(
        {
          workspaceSessionId: controller.target.workspaceSessionId,
          surface: "artifact",
          artifactId: target.id,
        },
        transcriptSplitTarget(),
      );
      return;
    }

    await openWorkspacePathFromTranscript(target);
  }

  async function openWorkspacePathFromTranscript(path: string): Promise<void> {
    const opened = await runtime.openWorkspacePath(path).catch(() => false);
    if (!opened) {
      await runtime.writeClipboardText(path).catch(() => undefined);
    }
  }

  function inspectCommandFromTranscript(commandId: string): void {
    if (!controller) return;
    const workspaceSessionId = controller.target.workspaceSessionId;
    setTimeout(() => {
      void runtime.openSurface(
        {
          workspaceSessionId,
          surface: "command",
          commandId,
        },
        transcriptSplitTarget(),
      );
    }, 0);
  }

  function openHandlerThreadFromTranscript(threadId: string): void {
    if (!controller) return;
    const thread = handlerThreads.find((candidate) => candidate.threadId === threadId);
    if (!thread) return;
    void runtime.openSurface(
      {
        workspaceSessionId: controller.target.workspaceSessionId,
        surface: "thread",
        surfacePiSessionId: thread.surfacePiSessionId,
        threadId: thread.threadId,
      },
      transcriptSplitTarget(),
    );
  }

  function inspectWorkflowTaskAttemptFromTranscript(workflowTaskAttemptId: string): void {
    if (!controller) return;
    void runtime.openSurface(
      {
        workspaceSessionId: controller.target.workspaceSessionId,
        surface: "workflow-task-attempt",
        workflowTaskAttemptId,
      },
      transcriptSplitTarget(),
    );
  }

  async function replyToWaitFromTranscript(
    block: TranscriptSemanticBlock & { kind: "wait" },
    text: string,
  ): Promise<void> {
    if (!controller) return;
    const targetThread = block.threadId
      ? handlerThreads.find((thread) => thread.threadId === block.threadId)
      : null;
    if (targetThread) {
      await runtime.sendPromptToTarget(
        {
          workspaceSessionId: controller.target.workspaceSessionId,
          surface: "thread",
          surfacePiSessionId: targetThread.surfacePiSessionId,
          threadId: targetThread.threadId,
        },
        text,
      );
      return;
    }
    await runtime.sendPromptToTarget(controller.target, text);
  }

  async function retryFailureFromTranscript(
    block: TranscriptSemanticBlock & { kind: "failure" },
  ): Promise<void> {
    if (!controller) return;
    await runtime.sendPromptToTarget(
      controller.target,
      `Retry the failed turn and address this failure:\n\n${block.summary}`,
    );
  }

  onMount(() => {
    syncPanel();
    unsubscribeRuntime = runtime.subscribe(syncPanel);
    void runtime.storage.promptHistory
      .list(runtime.workspaceId)
      .then((entries) => {
        promptHistory = entries;
      })
      .catch(() => {
        promptHistory = [];
      });
    void runtime
      .listWorkspacePaths()
      .then((paths) => {
        workspaceMentionPaths = new Set(paths.map((path) => path.workspaceRelativePath));
      })
      .catch(() => {
        workspaceMentionPaths = new Set();
      });
  });

  onDestroy(() => {
    unsubscribeRuntime?.();
    unsubscribeRuntime = null;
    unsubscribeController?.();
    unsubscribeController = null;
  });
</script>

{#if pane?.target?.surface === "app-logs"}
  <AppLogsPane {runtime} {panelId} />
{:else if pane?.target?.surface === "agents"}
  <AgentsPane
    {runtime}
    {panelId}
    initialSettings={agentSettings}
    targetAgentProfileId={pane.target.targetAgentProfileId}
    targetView={pane.target.view}
    onSettingsChanged={onAgentSettingsChanged}
  />
{:else if pane?.target?.surface === "extensions"}
  <ExtensionsPane
    {runtime}
    targetView={pane.target.view}
    targetExtensionId={pane.target.targetExtensionId}
  />
{:else if pane?.target?.surface === "snippets"}
  <SnippetsPane {runtime} />
{:else if pane?.target?.surface === "settings"}
  <Settings
    {runtime}
    workspaceId={runtime.workspaceId}
    {onProviderAuthChanged}
    {onAppAppearanceChanged}
  />
{:else if pane?.target?.surface === "workflows"}
  <WorkflowsPane {runtime} onOpenAgentProfile={onOpenAgentProfile} />
{:else if pane?.target?.surface === "open-workspace"}
  <OpenWorkspacePanel
    {openingWorkspace}
    errorMessage={openWorkspaceError}
    {recentWorkspaces}
    onOpenWorkspace={() => onOpenWorkspace?.()}
    onOpenWorkspaceInNewTab={onOpenWorkspaceInNewTab ? () => onOpenWorkspaceInNewTab?.() : undefined}
  />
{:else if pane?.target?.surface === "command" || pane?.target?.surface === "workflow-task-attempt" || pane?.target?.surface === "artifact"}
  <RelatedInspectorPane {runtime} target={pane.target} />
{:else if pane?.chrome?.kind === "unavailable"}
  <section
    class="dockview-unavailable-panel"
    data-testid="unavailable-surface-panel"
    data-panel-id={panelId}
  >
    <div>
      <strong>{pane.chrome.title}</strong>
      {#if pane.chrome.subtitle}
        <span>{pane.chrome.subtitle}</span>
      {/if}
      <p>{pane.restore?.unavailableReason ?? "The restored surface could not be reopened."}</p>
      {#if pane.restore?.lastKnownLocationLabel}
        <small>{pane.restore.lastKnownLocationLabel}</small>
      {/if}
    </div>
  </section>
{:else if controller}
  <section
    class="dockview-chat-panel"
    class:has-surface-metadata={hasSurfaceMetadata}
    data-testid="workspace-pane"
    data-panel-id={panelId}
  >
    {#if hasSurfaceMetadata}
      <div class="surface-metadata-stack" aria-label="Surface metadata">
        {#if promptBinding?.stale}
          <div class="prompt-stale-banner" role="status">
            <span>
              {#if queuedPromptRefresh?.agentContextUpdate?.state === "failed"}
                Agent context update failed.
              {:else if queuedPromptRefresh?.agentContextUpdate?.state === "out_of_date"}
                Agent context update is out of date.
              {:else if queuedPromptRefresh}
                Agent context update queued for this surface.
              {:else}
                This surface is using older instructions than the current generated agent context.
              {/if}
              {#if queuedPromptRefresh?.agentContextUpdate}
                <small>
                  r{queuedPromptRefresh.agentContextUpdate.requestedRevision}->r{queuedPromptRefresh.agentContextUpdate.currentRevision}
                  {#if queuedPromptRefreshChangeCount > 0}
                    , {queuedPromptRefreshChangeCount} {queuedPromptRefreshChangeCount === 1 ? "change" : "changes"}
                  {/if}
                </small>
              {/if}
              {#if queuedPromptRefresh?.status === "failed" && queuedPromptRefresh.failureError}
                <small>{queuedPromptRefresh.failureError}</small>
              {/if}
            </span>
            {#if queuedPromptRefreshCancellable}
              <button type="button" onclick={() => void controller.deleteQueuedPrompt(queuedPromptRefresh.id)}>
                Cancel update
              </button>
            {:else if queuedPromptRefresh?.status === "failed"}
              <button type="button" onclick={() => void controller.queuePromptRefresh()}>
                Retry update
              </button>
            {:else}
              <button type="button" onclick={() => void controller.queuePromptRefresh()}>
                Update agent context
              </button>
            {/if}
          </div>
        {/if}
        {#if terminalPromptRefresh && !queuedPromptRefresh}
          <div class={`agent-context-terminal-banner ${terminalPromptRefresh.state}`} role="status">
            <span>
              {#if terminalPromptRefresh.state === "applied"}
                Agent context update applied.
              {:else}
                Agent context update cancelled.
              {/if}
              <small>
                r{terminalPromptRefresh.requestedRevision}->r{terminalPromptRefresh.currentRevision}
              </small>
            </span>
          </div>
        {/if}
        {#if activeSystemPrompt}
          <details class="surface-prompt-metadata">
            <summary>
              <strong>{controller.target.surface === "thread" ? "Handler system prompt" : "Surface system prompt"}</strong>
              {#if promptBinding}
                <span>revision {promptBinding.currentRevision}</span>
              {/if}
            </summary>
            <pre>{activeSystemPrompt}</pre>
          </details>
        {/if}
      </div>
    {/if}
    <ChatTranscript
      {conversation}
      target={controller.target}
      sessionId={controller.agent.sessionId ?? controller.target.surfacePiSessionId}
      streamMessage={visibleStreamMessage}
      currentModel={currentModel ?? controller.agent.state.model}
      {pendingToolCalls}
      {isStreaming}
      {turnTimings}
      semanticBlocks={transcriptSemanticBlocks}
      {workspaceMentionPaths}
      initialScroll={pane?.scroll ?? null}
      {editingUserMessageTimestamp}
      onScrollStateChange={(scroll) => runtime.setPaneScroll(panelId, scroll)}
      onOpenArtifact={(filename) => void openArtifactFromTranscript(filename)}
      onOpenWorkspacePath={(path) => void openWorkspacePathFromTranscript(path)}
      onInspectCommand={inspectCommandFromTranscript}
      onOpenHandlerThread={openHandlerThreadFromTranscript}
      onInspectWorkflowTaskAttempt={inspectWorkflowTaskAttemptFromTranscript}
      onForkAssistantMessage={(message) => void forkFromAssistantMessage(message.timestamp)}
      onEditUserMessage={editUserMessageFromTranscript}
      onReplyToWait={(block, text) => void replyToWaitFromTranscript(block, text)}
      onRetryFailure={(block) => void retryFailureFromTranscript(block)}
    />
    <ChatComposer
      currentModel={currentModel ?? controller.agent.state.model}
      thinkingLevel={currentThinkingLevel}
      {isStreaming}
      {activeTurnStartedAt}
      {errorMessage}
      {promptHistory}
      {queuedMessages}
      {composerDraft}
      draftStorageKey={controller.target.surfacePiSessionId}
      {editDraft}
      {contextBudget}
      sessionName={surfaceDisplayTitle}
      targetLabel={pane?.target?.surface === "thread" ? "Messaging handler thread" : "Messaging orchestrator"}
      worktreeLabel={runtime.branch ?? runtime.workspaceLabel}
      onOpenModelPicker={() => onOpenModelPicker(panelId)}
      onListModels={listModelsForComposer}
      onModelChange={(model) => {
        currentModel = model;
        controller?.agent.setModel(model);
      }}
      onSend={send}
      onStop={stopAgent}
      onDraftChange={(draft) => void controller.updateComposerDraft(draft)}
      onBufferChange={(draft) => {
        composerBuffer = structuredClone(draft);
      }}
      onCancelEditMessage={() => {
        editDraft = null;
      }}
      onEditQueuedMessage={(promptId) => controller.editQueuedPrompt(promptId)}
      onDeleteQueuedMessage={(promptId) => void controller.deleteQueuedPrompt(promptId)}
      onSteerQueuedMessage={(promptId) => void controller.steerQueuedPrompt(promptId)}
      onReorderQueuedMessage={(promptId, beforePromptId) =>
        void controller.reorderQueuedPrompt(promptId, beforePromptId)}
      onThinkingChange={(level) => controller?.agent.setThinkingLevel(level)}
      extensionActor={composerExtensionActor}
      extensionUsageItems={composerExtensionUsageItems}
      onExtensionUsageChange={(extensionId, state) =>
        controller?.setExtensionUsage(extensionId, state)}
      onOpenExtension={openExtension}
      listWorkspacePaths={(options) => runtime.listWorkspacePaths(options)}
      pickWorkspaceAttachments={() => runtime.pickWorkspaceAttachments()}
      importComposerAttachments={(files) => runtime.importComposerAttachments(files)}
      listSnippets={() => runtime.getSnippets()}
    />
  </section>
{:else}
  <section
    class="dockview-empty-panel"
    aria-hidden="true"
    data-testid="workspace-pane"
    data-panel-id={panelId}
  ></section>
{/if}

{#if pendingEditMessage}
  <Dialog
    title="Replace Composer Draft"
    eyebrow="Transcript"
    description="Editing this earlier message will replace the current composer draft."
    width="md"
    onClose={() => {
      pendingEditMessage = null;
    }}
  >
    <div class="edit-message-dialog">
      <p>
        The current composer draft and attachments will be cleared before this earlier message is
        loaded for editing.
      </p>
      <div class="edit-message-dialog-actions">
        <Button size="sm" variant="ghost" onclick={() => {
          pendingEditMessage = null;
        }}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          onclick={() => {
            if (!pendingEditMessage) return;
            startEditingUserMessage(pendingEditMessage.message, pendingEditMessage.text);
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  </Dialog>
{/if}

<style>
  .dockview-chat-panel {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .dockview-chat-panel.has-surface-metadata {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .surface-metadata-stack {
    display: grid;
    border-bottom: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface-subtle) 62%, transparent);
  }

  .prompt-stale-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-warning-border, var(--ui-border-soft)) 84%, transparent);
    background: color-mix(in oklab, var(--ui-warning-surface, var(--ui-surface-subtle)) 88%, transparent);
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
  }

  .agent-context-terminal-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.38rem 0.75rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    background: color-mix(in oklab, var(--ui-surface) 74%, var(--ui-surface-subtle));
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
  }

  .agent-context-terminal-banner.cancelled {
    background: color-mix(in oklab, var(--ui-warning-surface, var(--ui-surface-subtle)) 28%, var(--ui-surface));
  }

  .agent-context-terminal-banner span {
    display: flex;
    align-items: baseline;
    min-width: 0;
    gap: 0.45rem;
    font-weight: 650;
  }

  .agent-context-terminal-banner small {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
  }

  .prompt-stale-banner span {
    display: flex;
    align-items: baseline;
    gap: 0.46rem;
    min-width: 0;
  }

  .prompt-stale-banner small {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.66rem;
    white-space: nowrap;
  }

  .prompt-stale-banner button {
    flex: 0 0 auto;
    border: 1px solid color-mix(in oklab, var(--ui-warning-border, var(--ui-border-soft)) 82%, transparent);
    border-radius: 0.25rem;
    background: var(--ui-surface);
    color: var(--ui-text-primary);
    font: inherit;
    font-weight: 700;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
  }

  .prompt-stale-banner button:hover {
    border-color: var(--ui-border-strong);
    background: var(--ui-surface-hover);
  }

  .surface-prompt-metadata {
    min-width: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
  }

  .surface-prompt-metadata summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2rem;
    padding: 0 0.75rem;
    cursor: pointer;
  }

  .surface-prompt-metadata summary:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .surface-prompt-metadata strong {
    color: var(--ui-text-primary);
    font-size: var(--text-xs);
  }

  .surface-prompt-metadata span {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .surface-prompt-metadata pre {
    max-height: min(36vh, 22rem);
    overflow: auto;
    margin: 0;
    padding: 0.7rem 0.75rem;
    border-top: 1px solid var(--ui-border-soft);
    background: var(--ui-code);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .dockview-empty-panel {
    display: grid;
    place-items: center;
    height: 100%;
    min-height: 0;
    color: var(--ui-text-muted);
    background: var(--ui-panel);
  }

  .dockview-unavailable-panel {
    display: grid;
    place-items: center;
    height: 100%;
    min-height: 0;
    padding: 1rem;
    background: var(--ui-panel);
    color: var(--ui-text-secondary);
  }

  .dockview-unavailable-panel div {
    display: grid;
    gap: 0.35rem;
    max-width: 26rem;
    text-align: center;
  }

  .dockview-unavailable-panel strong {
    color: var(--ui-text-primary);
    font-size: var(--text-md);
  }

  .dockview-unavailable-panel span,
  .dockview-unavailable-panel small {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .dockview-unavailable-panel p {
    margin: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .edit-message-dialog {
    display: grid;
    gap: 0.75rem;
  }

  .edit-message-dialog p {
    margin: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .edit-message-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.42rem;
  }
</style>
