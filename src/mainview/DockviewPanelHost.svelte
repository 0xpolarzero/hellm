<script lang="ts">
	import ChatComposer from "./ChatComposer.svelte";
	import type {
		ComposerEditDraft,
		ComposerModelOption,
		ComposerSubmit,
		ComposerSubmitTelemetryEvent,
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
  import type {
    ChatRuntime,
    ChatSurfaceController,
    QueuedPrompt,
    RendererSurfaceModel,
  } from "./chat-runtime";
  import type { AppAppearance } from "../shared/agent-settings";
  import {
    extensionUsageItems as buildExtensionUsageItems,
    type AgentContextActor,
    type ExtensionUsageControlItem,
  } from "./agents-pane-extension-usage";
  import type { ExtensionUsageState } from "@svvy/core";
  import type {
    WorkspaceHandlerThreadSummary,
    WorkspaceSessionSummary,
    WorkspaceTabInfo,
  } from "../shared/workspace-contract";
  import type { ReasoningEffort as ThinkingLevel } from "../shared/agent-settings";
  import type { RendererTranscriptUserEntry } from "../shared/renderer-transcript";
  import { onDestroy, onMount } from "svelte";
  import type { AgentModelChoice } from "../shared/workspace-contract";

  type Props = {
    runtime: ChatRuntime;
    panelId: string;
    onOpenModelPicker: (panelId: string) => void;
    openingWorkspace?: boolean;
    openWorkspaceError?: string | null;
    recentWorkspaces?: WorkspaceTabInfo[];
    onOpenWorkspace?: () => void;
    onOpenWorkspaceInNewTab?: () => void;
    onAppAppearanceChanged?: (appearance: AppAppearance) => void;
  };

  let {
    runtime,
    panelId,
    onOpenModelPicker,
    openingWorkspace = false,
    openWorkspaceError = null,
    recentWorkspaces = [],
    onOpenWorkspace,
    onOpenWorkspaceInNewTab,
    onAppAppearanceChanged,
  }: Props = $props();
  let controller = $state<ChatSurfaceController | null>(null);
  let pane = $state<ReturnType<ChatRuntime["getPane"]> | null>(null);
  let sessions = $state<WorkspaceSessionSummary[]>([]);
  let promptHistory = $state<PromptHistoryEntry[]>([]);
  let messages = $state<ChatSurfaceController["view"]["messages"]>([]);
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
  let isStreaming = $state(false);
  let activeTurnStartedAt = $state<string | null>(null);
  let turnTimings = $state<ChatSurfaceController["turnTimings"]>([]);
  let errorMessage = $state<string | undefined>(undefined);
  let currentModel = $state<RendererSurfaceModel | null>(null);
  let currentThinkingLevel = $state<ThinkingLevel>("off");
  let handlerThreads = $state<WorkspaceHandlerThreadSummary[]>([]);
  let controllerRevision = $state(0);
  let workspaceMentionPaths = $state<ReadonlySet<string>>(new Set());
  let editDraft = $state<ComposerEditDraft | null>(null);
  let pendingEditMessage = $state<{ message: RendererTranscriptUserEntry; text: string } | null>(null);
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
      pane?.target?.surface === "handler" ? "Handler Thread" : "Orchestrator",
    ),
  );
  const visibleStreamMessage = $derived.by(() => {
    void controllerRevision;
    const message = controller?.view.streamMessage;
    return controller?.promptStatus === "streaming" && message?.role === "assistant"
      ? message
      : undefined;
  });
  const editingUserMessageTimestamp = $derived(editDraft?.messageTimestamp ?? null);
  const composerExtensionActor = $derived<AgentContextActor>(
    controller?.target.surface === "handler" ? "handler" : "orchestrator",
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
    const catalogIds = new Set(
      runtime.agentExtensionsCatalogSnapshot?.records.map((extension) => extension.extensionId) ?? [],
    );
    for (const extensionId of catalogIds) {
      if (usage[extensionId] === undefined) {
        usage[extensionId] = "unavailable";
      }
    }
    return usage;
  });
  const composerExtensionUsageItems = $derived.by<ExtensionUsageControlItem[]>(() => {
    void controllerRevision;
    const actorDefaults =
      composerExtensionActor === "orchestrator"
        ? (runtime.agentsSnapshot?.actorExtensionDefaults.find(
            (record) => record.actor === composerExtensionActor,
          ) ?? null)
        : null;
    return buildExtensionUsageItems({
      actor: composerExtensionActor,
      profileId: controller?.agentProfileId ?? "composer-surface",
      usage: composerExtensionUsage,
      extensionCatalogItems: runtime.agentExtensionsCatalogSnapshot?.records ?? [],
      actorDefaults,
      networkAccess: runtime.appPreferencesSnapshot?.networkAccess ?? true,
    });
  });
  function syncSurfaceState() {
    controllerRevision += 1;
    if (!controller) {
      messages = [];
      pendingToolCalls = new Set();
      queuedMessages = [];
      composerDraft = { text: "", attachments: [], snippetMentions: [], updatedAt: null };
      composerBuffer = { text: "", attachments: [], snippetMentions: [] };
      isStreaming = false;
      activeTurnStartedAt = null;
      turnTimings = [];
      errorMessage = undefined;
      currentModel = null;
      currentThinkingLevel = "off";
      handlerThreads = [];
      return;
    }

    messages = [...controller.view.messages];
    pendingToolCalls = new Set(controller.view.pendingToolCalls);
    queuedMessages = [...controller.queuedPrompts];
    composerDraft = structuredClone(controller.composerDraft);
    if (!editDraft) {
      composerBuffer = {
        text: controller.composerDraft.text,
        attachments: structuredClone(controller.composerDraft.attachments),
        snippetMentions: structuredClone(controller.composerDraft.snippetMentions ?? []),
      };
    }
    isStreaming = controller.view.isStreaming || controller.promptStatus === "streaming";
    activeTurnStartedAt = controller.activeTurnStartedAt;
    turnTimings = structuredClone(controller.turnTimings);
    errorMessage = controller.view.error;
    currentModel = controller.view.model;
    currentThinkingLevel = controller.view.thinkingLevel as ThinkingLevel;
  }

  function syncPanel() {
    pane = runtime.getPane(panelId) ?? null;
    sessions = [...runtime.sessions];
    promptHistory = [...runtime.promptHistorySnapshot];
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
      return;
    }

    const sessionId = controller.target.workspaceSessionId;
    const snapshot = runtime.getHandlerThreadsSnapshot(sessionId);
    handlerThreads = snapshot ?? [];
    if (!snapshot) {
      void runtime.listHandlerThreads(sessionId).catch(() => undefined);
    }
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

  function normalizeTelemetryError(error: unknown): {
    name?: string;
    message: string;
    stack?: string;
  } {
    if (error instanceof Error) {
      return {
        name: error.name || undefined,
        message: error.message || "Unknown error",
        stack: error.stack,
      };
    }
    return { message: typeof error === "string" ? error : "Unknown error" };
  }

  function composerSubmitInputTelemetry(input: ComposerSubmit): Record<string, unknown> {
    const attachmentKindCounts = input.attachments.reduce<Record<string, number>>(
      (counts, attachment) => {
        counts[attachment.kind] = (counts[attachment.kind] ?? 0) + 1;
        return counts;
      },
      {},
    );
    return {
      textLength: input.text.length,
      trimmedTextLength: input.text.trim().length,
      attachmentCount: input.attachments.length,
      attachmentKindCounts,
      snippetMentionCount: input.snippetMentions?.length ?? 0,
      snippetProvenanceCount: input.snippetProvenance?.length ?? 0,
      isEdit: input.editMessageTimestamp !== undefined,
    };
  }

  function surfaceSendTelemetryDetails(
    input: ComposerSubmit,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      panelId,
      workspaceId: runtime.workspaceId,
      workspaceSessionId: controller?.target.workspaceSessionId ?? null,
      surfacePiSessionId: controller?.target.surfacePiSessionId ?? null,
      surface: controller?.target.surface ?? null,
      threadId: controller?.target.threadId ?? null,
      promptStatus: controller?.promptStatus ?? null,
      queuedMessageCount: controller?.queuedPrompts.length ?? null,
      ownerPaneCount: controller?.ownerPaneIds.length ?? null,
      ...composerSubmitInputTelemetry(input),
      ...extra,
    };
  }

  function recordComposerTelemetry(event: ComposerSubmitTelemetryEvent): void {
    runtime.recordRendererTelemetry({
      ...event,
      workspaceId: runtime.workspaceId,
      workspaceSessionId: controller?.target.workspaceSessionId,
      surfacePiSessionId: controller?.target.surfacePiSessionId,
      threadId: controller?.target.threadId,
    });
  }

  async function send(input: ComposerSubmit): Promise<boolean> {
    const correlationId =
      input.telemetryCorrelationId ?? `dockview-send-${Date.now().toString(36)}`;
    runtime.recordRendererTelemetry({
      eventName: "surface_composer.send.started",
      correlationId,
      level: "debug",
      source: "renderer",
      message: "Surface composer send started.",
      workspaceId: runtime.workspaceId,
      workspaceSessionId: controller?.target.workspaceSessionId,
      surfacePiSessionId: controller?.target.surfacePiSessionId,
      threadId: controller?.target.threadId,
      details: surfaceSendTelemetryDetails(input),
    });
    if (!controller || (!input.text.trim() && input.attachments.length === 0)) {
      runtime.recordRendererTelemetry({
        eventName: "surface_composer.send.rejected",
        correlationId,
        level: "warn",
        source: "renderer",
        message: "Surface composer send rejected before dispatch.",
        workspaceId: runtime.workspaceId,
        workspaceSessionId: controller?.target.workspaceSessionId,
        surfacePiSessionId: controller?.target.surfacePiSessionId,
        threadId: controller?.target.threadId,
        details: surfaceSendTelemetryDetails(input, {
          reason: !controller ? "missing-controller" : "empty-input",
        }),
      });
      return false;
    }
    const sendInput: ComposerSubmit = {
      ...input,
      clientSubmission: input.clientSubmission
        ? {
            ...input.clientSubmission,
            panelId,
          }
        : undefined,
    };
    try {
      await runtime.focusPane(panelId);
      runtime.recordRendererTelemetry({
        eventName: "surface_composer.send.focused",
        correlationId,
        level: "debug",
        source: "renderer",
        message: "Surface composer send focused the target pane.",
        workspaceId: runtime.workspaceId,
        workspaceSessionId: controller.target.workspaceSessionId,
        surfacePiSessionId: controller.target.surfacePiSessionId,
        threadId: controller.target.threadId,
        details: surfaceSendTelemetryDetails(sendInput),
      });
      if (sendInput.editMessageTimestamp !== undefined) {
        await controller.editCommittedUserMessage(sendInput.editMessageTimestamp, sendInput);
      } else {
        await controller.sendPrompt(sendInput, panelId);
      }
	      runtime.recordRendererTelemetry({
	        eventName: "surface_composer.send.dispatched",
        correlationId,
        level: "info",
        source: "renderer",
        message: "Surface composer send dispatched to the surface controller.",
        workspaceId: runtime.workspaceId,
        workspaceSessionId: controller.target.workspaceSessionId,
        surfacePiSessionId: controller.target.surfacePiSessionId,
        threadId: controller.target.threadId,
	        details: surfaceSendTelemetryDetails(sendInput),
	      });
	      return true;
	    } catch (error) {
	      runtime.recordRendererTelemetry({
	        eventName: "surface_composer.send.failed",
        correlationId,
        level: "error",
        source: "renderer",
	        message: "Surface composer send failed before backend acceptance completed.",
        workspaceId: runtime.workspaceId,
        workspaceSessionId: controller?.target.workspaceSessionId,
        surfacePiSessionId: controller?.target.surfacePiSessionId,
        threadId: controller?.target.threadId,
        details: surfaceSendTelemetryDetails(sendInput),
        error: normalizeTelemetryError(error),
      });
      throw error;
    }
  }

  async function stopAgent(): Promise<void> {
    if (!controller) return;
    await controller.abort();
  }

  function startEditingUserMessage(message: RendererTranscriptUserEntry, text: string): void {
    if (!message.messageId) return;
    editDraft = {
      messageId: message.messageId,
      messageTimestamp: message.timestamp,
      text,
    };
    pendingEditMessage = null;
  }

  function editUserMessageFromTranscript(message: RendererTranscriptUserEntry, text: string): void {
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
    if (choice.authStatus.health !== "usable" && modelChoiceValue(choice) !== currentValue) {
      return null;
    }
    const model: RendererSurfaceModel = {
      provider: choice.providerId,
      id: choice.modelId,
      name: choice.displayName,
      ...(choice.contextWindow ? { contextWindow: choice.contextWindow } : {}),
      input: choice.inputModalities,
    };
    return {
      value: modelChoiceValue(choice),
      label: model.name,
      triggerLabel: model.name,
      searchText: `${model.name} ${choice.modelId} ${choice.providerId}`,
      disabled: choice.authStatus.health !== "usable",
      model,
      supportedThinkingLevels: choice.supportedReasoning,
    };
  }

  async function listModelsForComposer(): Promise<ComposerModelOption[]> {
    if (!currentModel) return [];
    const catalog = runtime.modelMetadataSnapshot ?? (await runtime.listModelMetadata());
    return catalog
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
        surface: "handler",
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
          surface: "handler",
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

{#if pane?.chrome?.kind === "unavailable"}
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
{:else if pane?.target?.surface === "app-logs"}
  <AppLogsPane {runtime} {panelId} />
{:else if pane?.target?.surface === "agents"}
  <AgentsPane
    {runtime}
    {panelId}
    targetAgentProfileId={pane.target.targetAgentProfileId}
    targetView={pane.target.view}
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
    {onAppAppearanceChanged}
  />
{:else if pane?.target?.surface === "workflows"}
  <WorkflowsPane {runtime} />
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
{:else if controller}
  <section
    class="dockview-chat-panel"
    data-testid="workspace-pane"
    data-panel-id={panelId}
  >
    <ChatTranscript
      {conversation}
      target={controller.target}
      sessionId={controller.view.sessionId ?? controller.target.surfacePiSessionId}
      streamMessage={visibleStreamMessage}
      currentModel={currentModel ?? controller.view.model}
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
      currentModel={currentModel ?? controller.view.model}
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
      targetLabel={pane?.target?.surface === "handler" ? "Messaging handler thread" : "Messaging orchestrator"}
      worktreeLabel={runtime.branch ?? runtime.workspaceLabel}
      onOpenModelPicker={() => onOpenModelPicker(panelId)}
      onListModels={listModelsForComposer}
      onModelChange={(model) => {
        currentModel = model;
        controller?.setModel(model);
      }}
      onSend={send}
      onTelemetry={recordComposerTelemetry}
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
      onThinkingChange={(level) => controller?.setThinkingLevel(level)}
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
