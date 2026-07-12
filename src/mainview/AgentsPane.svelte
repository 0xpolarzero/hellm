<script lang="ts">
  import AlertTriangleIcon from "@lucide/svelte/icons/alert-triangle";
  import CheckIcon from "@lucide/svelte/icons/check";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { onDestroy, onMount } from "svelte";
  import { flip } from "svelte/animate";
  import {
    type AgentProfileId,
    type PreferredExternalEditor,
    type WorkflowAgentKey,
    type WorkflowAgentSettings,
  } from "../shared/agent-settings";
  import type {
    AgentContextPreviewRequest,
    AgentContextPreviewResponse,
    AgentModelChoice,
    AgentsReadModel,
    ConfiguredAgentProfileReadModelRecord,
    ExtensionInventoryItemReadModel,
  } from "../shared/workspace-contract";
  import type {
    AgentProfileId as StateAgentProfileId,
    ExtensionId,
    ExtensionUsageState,
    SourceEditSession,
    WorkflowAgentSourceExportName,
  } from "@svvy/core";
  import {
    FILE_BACKED_EDIT_CONFLICT_CODE,
    FileBackedEditConflictError,
    type FileBackedSaveMode,
  } from "../shared/file-backed-edit";
  import { countPromptTokens } from "../shared/token-count";
  import type { ChatRuntime } from "./chat-runtime";
  import { formatTokenCount } from "./chat-format";
  import Button from "./ui/Button.svelte";
  import AgentProfileRowForm from "./AgentProfileRowForm.svelte";
  import {
    type AgentContextActor,
    extensionUsageItems as buildExtensionUsageItems,
    mergeActorExtensionDefaults,
  } from "./agents-pane-extension-usage";
  import type { ExtensionUsageControlItem } from "./agents-pane-extension-usage";
  import ProfileExtensionEditor from "./ProfileExtensionEditor.svelte";
  import WorkflowAgentRowForm from "./WorkflowAgentRowForm.svelte";
  import { createWorkflowAgentId as createWorkflowAgentExportId } from "./agent-profile-ids";
  import { configuredAgentProfileReasoningEffort } from "./configured-agent-profile";
  import Tooltip from "./ui/Tooltip.svelte";
  import { dismissConfirmation } from "./ui/dismiss-confirmation";

  type WorkflowAgentSourceRecord = AgentsReadModel["workflowAgents"][number];

  type Props = {
    runtime: ChatRuntime;
    panelId: string;
    targetAgentProfileId?: string | null;
    targetView?: "profiles" | "generated-context-preview";
  };

  let {
    runtime,
    panelId,
    targetAgentProfileId = null,
    targetView = "profiles",
  }: Props = $props();

  let agents = $state<AgentsReadModel | null>(null);
  let loading = $state(true);
  let errorMessage = $state<string | null>(null);
  let savingProfileId = $state<string | null>(null);
  let savingWorkflowAgentKey = $state<WorkflowAgentKey | null>(null);
  let deletingWorkflowAgentKey = $state<WorkflowAgentKey | null>(null);
  let confirmingDeleteWorkflowAgentKey = $state<WorkflowAgentKey | null>(null);
  let deletingProfileId = $state<string | null>(null);
  let confirmingDeleteProfileId = $state<string | null>(null);
  let expandedProfileIds = $state<Set<string>>(new Set());
  let modelChoices = $state<AgentModelChoice[]>([]);
  let extensionInventoryItems = $state<ExtensionInventoryItemReadModel[]>([]);
  let contextPreviewByProfileId = $state<Record<string, AgentContextPreviewResponse>>({});
  let contextPreviewErrorsByProfileId = $state<Record<string, string>>({});
  let workflowAgentInstructionDrafts = $state<Record<string, string>>({});
  let loadingContextPreviewKey = $state<string | null>(null);
  let contextPreviewRequestSequence = 0;
  const activeContextPreviewRequests = new Map<string, number>();
  let orchestratorRowsElement = $state<HTMLElement | null>(null);
  let profileDrag = $state<{
    profileId: string;
    pointerId: number;
    startY: number;
    lastY: number;
    didMove: boolean;
  } | null>(null);
  let dragCaptureElement: HTMLElement | null = null;
  let draggedProfileId = $state<string | null>(null);
  let dropBeforeProfileId = $state<string | null>(null);
  let pendingDragClientY: number | null = null;
  let dragAnimationFrame: number | null = null;
  let settingsLoadRequest = 0;
  let unsubscribeRuntimeSnapshots: (() => void) | null = null;

  const orchestrators = $derived(
    (agents?.configuredProfiles ?? [])
      .filter((profile) => profile.actor === "orchestrator")
      .toSorted(
        (left, right) => left.position - right.position || left.profileId.localeCompare(right.profileId),
      ),
  );
  const displayedOrchestrators = $derived(
    reorderConfiguredProfiles(orchestrators, draggedProfileId, dropBeforeProfileId),
  );
  const threadHandler = $derived(
    agents?.configuredProfiles.find((profile) => profile.actor === "handler") ?? null,
  );
  const workflowAgentRows = $derived(
    (agents?.workflowAgents ?? [])
      .map((record) => ({ record, agent: workflowAgentSettings(record) }))
      .toSorted((left, right) =>
        (left.agent?.label ?? left.record.sourceId).localeCompare(
          right.agent?.label ?? right.record.sourceId,
        ) || left.record.sourceId.localeCompare(right.record.sourceId),
      ),
  );

  function reorderConfiguredProfiles(
    profiles: readonly ConfiguredAgentProfileReadModelRecord[],
    movingProfileId: string | null,
    beforeProfileId: string | null,
  ): ConfiguredAgentProfileReadModelRecord[] {
    if (!movingProfileId) return [...profiles];
    const moving = profiles.find((profile) => profile.profileId === movingProfileId);
    if (!moving || movingProfileId === beforeProfileId) return [...profiles];
    const remaining = profiles.filter((profile) => profile.profileId !== movingProfileId);
    const beforeIndex = beforeProfileId
      ? remaining.findIndex((profile) => profile.profileId === beforeProfileId)
      : remaining.length;
    if (beforeIndex < 0) return [...profiles];
    return [...remaining.slice(0, beforeIndex), moving, ...remaining.slice(beforeIndex)];
  }

  function configuredProfileOrderChanged(
    profiles: readonly ConfiguredAgentProfileReadModelRecord[],
    movingProfileId: string | null,
    beforeProfileId: string | null,
  ): boolean {
    const reordered = reorderConfiguredProfiles(profiles, movingProfileId, beforeProfileId);
    return reordered.some(
      (profile, index) => profile.profileId !== profiles[index]?.profileId,
    );
  }
  async function loadSettings() {
    const requestId = ++settingsLoadRequest;
    loading = !agents;
    errorMessage = null;
    try {
      const nextAgents = await runtime.getAgents();
      if (requestId !== settingsLoadRequest) return;
      agents = nextAgents;
      loading = false;
      void loadAgentModelChoices(requestId);
      void loadExtensionsInventory(requestId);
    } catch (error) {
      if (requestId !== settingsLoadRequest) return;
      errorMessage = error instanceof Error ? error.message : "Unable to load agent profiles.";
    } finally {
      if (requestId === settingsLoadRequest) {
        loading = false;
      }
    }
  }

  async function loadAgentModelChoices(requestId: number) {
    const snapshot = runtime.modelMetadataSnapshot;
    if (snapshot && requestId === settingsLoadRequest) {
      modelChoices = [...snapshot];
    }
    try {
      const nextModelChoices = await runtime.listModelMetadata();
      if (requestId === settingsLoadRequest) {
        modelChoices = [...nextModelChoices];
      }
    } catch {
      if (requestId === settingsLoadRequest) {
        modelChoices = [];
      }
    }
  }

  async function loadExtensionsInventory(requestId: number) {
    const snapshot = runtime.extensionsInventorySnapshot;
    if (snapshot && requestId === settingsLoadRequest) {
      extensionInventoryItems = snapshot.extensions;
    }
    try {
      const nextExtensionsInventory = await runtime.getExtensionsInventory();
      if (requestId === settingsLoadRequest) {
        extensionInventoryItems = nextExtensionsInventory.extensions;
      }
    } catch {
      if (requestId === settingsLoadRequest) {
        extensionInventoryItems = [];
      }
    }
  }

  function contextPreviewKey(actor: AgentContextActor, profileId: string): string {
    return `${actor}:${profileId}`;
  }

  function actorForProfileId(profileId: string): AgentContextActor {
    if (
      agents?.configuredProfiles.some(
        (profile) => profile.profileId === profileId && profile.actor === "handler",
      )
    ) {
      return "handler";
    }
    if (agents?.workflowAgents.some((record) => record.sourceId === profileId)) {
      return "workflow-task";
    }
    return "orchestrator";
  }

  function workflowAgentSettings(
    record: WorkflowAgentSourceRecord,
  ): WorkflowAgentSettings | null {
    if (record.validationStatus !== "valid" || !record.parameters) return null;
    return {
      id: record.sourceId,
      label: record.parameters.label,
      provider: record.parameters.provider,
      model: record.parameters.model,
      reasoningEffort: record.parameters.reasoning.effort,
      instructions: record.parameters.instructions,
      overrides: { ...record.parameters.overrides },
      extensionOrder: [...record.extensionOrder],
      sourceVersion: record.sourceVersion,
    };
  }

  function workflowAgentSourceText(agent: WorkflowAgentSettings): string {
    const overrides = Object.fromEntries(
      Object.entries(agent.overrides ?? {}).toSorted(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
    return `${JSON.stringify(
      {
        id: agent.id,
        label: agent.label,
        provider: agent.provider,
        model: agent.model,
        reasoning: { effort: agent.reasoningEffort },
        instructions: agent.instructions,
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        ...((agent.extensionOrder?.length ?? 0) > 0
          ? { extensionOrder: agent.extensionOrder }
          : {}),
      },
      null,
      2,
    )}\n`;
  }

  function preferredExternalEditor(value: string | null | undefined): PreferredExternalEditor {
    if (
      value === "code" ||
      value === "cursor" ||
      value === "zed" ||
      value === "sublime"
    ) {
      return value;
    }
    return value ? "custom" : "system";
  }

  function workflowAgentFromSourceEditSession(
    session: SourceEditSession,
    fallback: WorkflowAgentSettings,
  ): WorkflowAgentSettings {
    try {
      const raw = JSON.parse(session.text) as Record<string, unknown>;
      const reasoning = raw.reasoning as { effort?: unknown } | undefined;
      if (
        raw.id !== session.sourceId ||
        typeof raw.label !== "string" ||
        typeof raw.provider !== "string" ||
        typeof raw.model !== "string" ||
        typeof raw.instructions !== "string" ||
        typeof reasoning?.effort !== "string"
      ) {
        return { ...fallback, sourceVersion: session.sourceVersion };
      }
      const rawOverrides = raw.overrides;
      const overrides =
        rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)
          ? (rawOverrides as Record<string, ExtensionUsageState>)
          : {};
      const extensionOrder = Array.isArray(raw.extensionOrder)
        ? raw.extensionOrder.filter((value): value is string => typeof value === "string")
        : [];
      return {
        id: session.sourceId,
        label: raw.label,
        provider: raw.provider,
        model: raw.model,
        reasoningEffort: reasoning.effort as WorkflowAgentSettings["reasoningEffort"],
        instructions: raw.instructions,
        overrides: { ...overrides },
        extensionOrder,
        sourceVersion: session.sourceVersion,
      };
    } catch {
      return { ...fallback, sourceVersion: session.sourceVersion };
    }
  }

  function workflowAgentInstructionText(agent: WorkflowAgentSettings): string {
    return workflowAgentInstructionDrafts[agent.id] ?? agent.instructions;
  }

  function setWorkflowAgentInstructionDraft(agentId: WorkflowAgentKey, instructions: string): void {
    if (workflowAgentInstructionDrafts[agentId] === instructions) return;
    workflowAgentInstructionDrafts = {
      ...workflowAgentInstructionDrafts,
      [agentId]: instructions,
    };
  }

  function workflowAgentInstructionPromptText(instructions: string): string {
    const trimmed = instructions.trim();
    return trimmed ? `## Custom Instructions\n${trimmed}` : "";
  }

  function workflowAgentInstructionTokenCount(agent: WorkflowAgentSettings): number {
    return countPromptTokens({
      provider: agent.provider,
      model: agent.model,
      text: workflowAgentInstructionText(agent),
    }).tokens;
  }

  function formatPromptTokenCount(tokens: number): string {
    return `~${formatTokenCount(tokens)} tokens`;
  }

  function workflowAgentContextPreview(agent: WorkflowAgentSettings): AgentContextPreviewResponse | null {
    const preview = contextPreviewByProfileId[contextPreviewKey("workflow-task", agent.id)] ?? null;
    if (!preview) return null;

    const currentInstructions = workflowAgentInstructionText(agent);
    if (currentInstructions === agent.instructions) return preview;

    const savedInstructionTokens = countPromptTokens({
      provider: preview.provider,
      model: preview.model,
      text: workflowAgentInstructionPromptText(agent.instructions),
    }).tokens;
    const currentInstructionTokens = countPromptTokens({
      provider: preview.provider,
      model: preview.model,
      text: workflowAgentInstructionPromptText(currentInstructions),
    }).tokens;
    const tokens = Math.max(
      0,
      preview.tokenCount.tokens - savedInstructionTokens + currentInstructionTokens,
    );
    return {
      ...preview,
      tokenCount: {
        ...preview.tokenCount,
        tokens,
      },
    };
  }

  async function loadAgentContextPreview(
    profileId: AgentProfileId | WorkflowAgentKey,
    actor: AgentContextActor,
    options: { force?: boolean } = {},
  ) {
    const key = contextPreviewKey(actor, profileId);
    if (!options.force && contextPreviewByProfileId[key]) return;
    const requestId = ++contextPreviewRequestSequence;
    activeContextPreviewRequests.set(key, requestId);
    loadingContextPreviewKey = key;
    const { [key]: _clearedPreviewError, ...remainingPreviewErrors } =
      contextPreviewErrorsByProfileId;
    contextPreviewErrorsByProfileId = remainingPreviewErrors;
    try {
      const preview = await runtime.getAgentContextPreview({ profileId, actor });
      if (activeContextPreviewRequests.get(key) !== requestId) return;
      contextPreviewByProfileId = {
        ...contextPreviewByProfileId,
        [key]: preview,
      };
    } catch (error) {
      if (activeContextPreviewRequests.get(key) !== requestId || !expandedProfileIds.has(profileId)) {
        return;
      }
      contextPreviewErrorsByProfileId = {
        ...contextPreviewErrorsByProfileId,
        [key]: error instanceof Error ? error.message : "Unable to load generated context preview.",
      };
    } finally {
      if (activeContextPreviewRequests.get(key) === requestId) {
        activeContextPreviewRequests.delete(key);
        loadingContextPreviewKey =
          loadingContextPreviewKey === key ? null : loadingContextPreviewKey;
      }
    }
  }

  function cloneConfiguredProfile(
    profile: ConfiguredAgentProfileReadModelRecord,
  ): ConfiguredAgentProfileReadModelRecord {
    return {
      ...profile,
      extensionUsage: { ...profile.extensionUsage },
      extensionOrder: [...profile.extensionOrder],
    };
  }

  function configuredProfileById(
    profileId: string,
    fallback: ConfiguredAgentProfileReadModelRecord,
  ): ConfiguredAgentProfileReadModelRecord {
    return (
      agents?.configuredProfiles.find((candidate) => candidate.profileId === profileId) ??
      cloneConfiguredProfile(fallback)
    );
  }

  async function saveProfile(
    profile: ConfiguredAgentProfileReadModelRecord,
  ): Promise<ConfiguredAgentProfileReadModelRecord> {
    savingProfileId = profile.profileId;
    errorMessage = null;
    try {
      const profileInput = {
        profileId: profile.profileId,
        name: profile.name,
        providerId: profile.providerId,
        modelId: profile.modelId,
        reasoning: { effort: configuredAgentProfileReasoningEffort(profile) },
        extensionUsage: { ...profile.extensionUsage },
        extensionOrder: [...profile.extensionOrder],
      };
      agents =
        profile.actor === "orchestrator"
          ? await runtime.updateOrchestratorProfile({
              ...profileInput,
              followComposer: profile.followComposer,
            })
          : await runtime.updateThreadHandlerProfile(profileInput);
      return configuredProfileById(profile.profileId, profile);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to save agent profile.";
      throw error;
    } finally {
      savingProfileId = null;
    }
  }

  async function saveWorkflowAgent(
    record: WorkflowAgentSourceRecord,
    agent: WorkflowAgentSettings,
    options?: { baseSourceVersion?: string; mode?: FileBackedSaveMode },
  ): Promise<WorkflowAgentSettings> {
    savingWorkflowAgentKey = record.sourceId;
    errorMessage = null;
    try {
      const baseSourceVersion = options?.baseSourceVersion ?? record.sourceVersion;
      const result = await runtime.saveSourceEdit({
        sourceKind: "workflow-agent",
        sourceId: record.sourceId,
        expectedSourceVersion: baseSourceVersion,
        text: workflowAgentSourceText(agent),
        saveMode: options?.mode ?? "compare-and-swap",
      });
      agents = await runtime.getAgents();
      if (result.status === "stale") {
        throw new FileBackedEditConflictError<WorkflowAgentSettings>({
          code: FILE_BACKED_EDIT_CONFLICT_CODE,
          current: workflowAgentFromSourceEditSession(result.current, agent),
          currentVersion: result.current.sourceVersion,
          baseVersion: baseSourceVersion,
        });
      }
      if (workflowAgentInstructionDrafts[agent.id] !== undefined) {
        const { [agent.id]: _discarded, ...rest } = workflowAgentInstructionDrafts;
        workflowAgentInstructionDrafts = rest;
      }
      const current = agents?.workflowAgents.find(
        (candidate) => candidate.sourceId === record.sourceId,
      );
      return (current && workflowAgentSettings(current)) ?? {
        ...agent,
        sourceVersion: result.sourceVersion,
      };
    } catch (error) {
      if (!(error instanceof FileBackedEditConflictError)) {
        errorMessage = error instanceof Error ? error.message : "Unable to save workflow agent.";
      }
      throw error;
    } finally {
      savingWorkflowAgentKey = null;
    }
  }

  async function setProfileExtensionUsage(
    profile: ConfiguredAgentProfileReadModelRecord,
    extensionId: string,
    state: ExtensionUsageState,
  ): Promise<ConfiguredAgentProfileReadModelRecord> {
    errorMessage = null;
    try {
      agents = await runtime.setConfiguredProfileExtensionUsage({
        actor: profile.actor,
        profileId: profile.profileId,
        extensionId: extensionId as ExtensionId,
        usage: state,
      });
      refreshAgentContextPreview(profile.profileId, profile.actor);
      return configuredProfileById(profile.profileId, profile);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to save extension usage.";
      throw error;
    }
  }

  async function setWorkflowAgentExtensionUsage(
    record: WorkflowAgentSourceRecord,
    agent: WorkflowAgentSettings,
    extensionId: string,
    state: ExtensionUsageState,
  ): Promise<WorkflowAgentSettings> {
    errorMessage = null;
    try {
      const item = extensionUsageItems({
        actor: "workflow-task",
        profileId: agent.id,
        usage: agent.overrides ?? {},
      });
      const overrides = { ...agent.overrides };
      if (item.find((candidate) => candidate.id === extensionId)?.defaultState === state) {
        delete overrides[extensionId];
      } else {
        overrides[extensionId] = state;
      }
      const saved = await saveWorkflowAgent(record, {
        ...agent,
        overrides,
        extensionOrder: [...(agent.extensionOrder ?? [])],
      });
      refreshAgentContextPreview(agent.id, "workflow-task");
      return saved;
    } catch (error) {
      if (!(error instanceof FileBackedEditConflictError)) {
        errorMessage =
          error instanceof Error ? error.message : "Unable to save workflow agent extension usage.";
      }
      throw error;
    }
  }

  async function setActorExtensionDefault(
    actor: Extract<AgentContextActor, "orchestrator" | "workflow-task">,
    profileId: AgentProfileId | WorkflowAgentKey,
    extensionId: string,
    state: ExtensionUsageState,
  ): Promise<void> {
    errorMessage = null;
    try {
      agents = await runtime.promoteConfiguredProfileExtensionDefault({
        actor,
        profileId: profileId as StateAgentProfileId,
        extensionId: extensionId as ExtensionId,
        usage: state,
      });
      refreshAgentContextPreview(profileId, actor);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to save extension default.";
      throw error;
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

  async function openWorkflowAgentSource(record: WorkflowAgentSourceRecord): Promise<void> {
    errorMessage = null;
    try {
      await runtime.openSourceInEditor({
        sourceKind: "workflow-agent",
        sourceId: record.sourceId,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to open workflow agent source.";
    }
  }

  async function updateProfileExtensionEditor(
    profile: ConfiguredAgentProfileReadModelRecord,
    actor: AgentContextActor,
    updates: Pick<ConfiguredAgentProfileReadModelRecord, "extensionUsage" | "extensionOrder">,
  ): Promise<ConfiguredAgentProfileReadModelRecord> {
    errorMessage = null;
    try {
      const saved = await saveProfile({
        ...cloneConfiguredProfile(profile),
        ...updates,
      });
      refreshAgentContextPreview(profile.profileId, actor);
      return saved;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to save extension settings.";
      throw error;
    }
  }

  function resetProfileExtensionSelection(
    profile: ConfiguredAgentProfileReadModelRecord,
    actor: AgentContextActor,
  ) {
    return updateProfileExtensionEditor(profile, actor, {
      extensionUsage: {},
      extensionOrder: [...profile.extensionOrder],
    });
  }

  function resetProfileExtensionOrder(
    profile: ConfiguredAgentProfileReadModelRecord,
    actor: AgentContextActor,
  ) {
    return updateProfileExtensionEditor(profile, actor, {
      extensionUsage: { ...profile.extensionUsage },
      extensionOrder: [],
    });
  }

  function setProfileExtensionOrder(
    profile: ConfiguredAgentProfileReadModelRecord,
    actor: AgentContextActor,
    extensionOrder: string[],
  ) {
    return updateProfileExtensionEditor(profile, actor, {
      extensionUsage: { ...profile.extensionUsage },
      extensionOrder,
    });
  }

  async function updateWorkflowAgentExtensionEditor(
    record: WorkflowAgentSourceRecord,
    agent: WorkflowAgentSettings,
    updates: Pick<WorkflowAgentSettings, "overrides" | "extensionOrder">,
  ): Promise<WorkflowAgentSettings> {
    errorMessage = null;
    try {
      const nextAgent = {
        ...agent,
        overrides: { ...updates.overrides },
        extensionOrder: [...(updates.extensionOrder ?? [])],
      };
      const saved = await saveWorkflowAgent(record, nextAgent);
      refreshAgentContextPreview(agent.id, "workflow-task");
      return saved;
    } catch (error) {
      if (!(error instanceof FileBackedEditConflictError)) {
        errorMessage =
          error instanceof Error ? error.message : "Unable to save workflow agent extensions.";
      }
      throw error;
    }
  }

  function resetWorkflowAgentExtensionSelection(
    record: WorkflowAgentSourceRecord,
    agent: WorkflowAgentSettings,
  ) {
    return updateWorkflowAgentExtensionEditor(record, agent, {
      overrides: {},
      extensionOrder: [...(agent.extensionOrder ?? [])],
    });
  }

  function resetWorkflowAgentExtensionOrder(
    record: WorkflowAgentSourceRecord,
    agent: WorkflowAgentSettings,
  ) {
    return updateWorkflowAgentExtensionEditor(record, agent, {
      overrides: { ...agent.overrides },
      extensionOrder: [],
    });
  }

  function setWorkflowAgentExtensionOrder(
    record: WorkflowAgentSourceRecord,
    agent: WorkflowAgentSettings,
    extensionOrder: string[],
  ) {
    return updateWorkflowAgentExtensionEditor(record, agent, {
      overrides: { ...agent.overrides },
      extensionOrder,
    });
  }

  function createProfileId(baseName: string): string {
    const slug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36);
    const prefix = slug || "orchestrator";
    const existingIds = new Set(orchestrators.map((profile) => profile.profileId));
    let index = orchestrators.length + 1;
    let id = `${prefix}-${index}`;
    while (existingIds.has(id)) {
      index += 1;
      id = `${prefix}-${index}`;
    }
    return id;
  }

  function createWorkflowAgentId(baseName: string): WorkflowAgentKey {
    return createWorkflowAgentExportId(
      baseName,
      workflowAgentRows.map(({ record }) => record.sourceId),
    );
  }

  async function createOrchestratorProfile(source?: ConfiguredAgentProfileReadModelRecord) {
    const baseProfile = source ?? orchestrators[0];
    if (!baseProfile) return;
    const name = source ? `${source.name} copy` : `Orchestrator ${orchestrators.length + 1}`;
    const profile: ConfiguredAgentProfileReadModelRecord = {
      ...cloneConfiguredProfile(baseProfile),
      profileId: createProfileId(name) as StateAgentProfileId,
      actor: "orchestrator",
      name,
      builtin: false,
      locked: false,
      deletable: true,
      position: orchestrators.length,
    };
    await saveProfile(profile);
    expandedProfileIds.add(profile.profileId);
    expandedProfileIds = new Set(expandedProfileIds);
  }

  async function createWorkflowAgent() {
    const baseAgent = workflowAgentRows.find(({ agent }) => agent !== null)?.agent ?? null;
    if (!baseAgent) {
      errorMessage = "A valid workflow-agent source is required before creating another agent.";
      return;
    }
    const label = `Workflow agent ${workflowAgentRows.length + 1}`;
    const id = createWorkflowAgentId(label);
    errorMessage = null;
    try {
      await runtime.createWorkflowAgentSource({
        draft: {
          exportName: id as WorkflowAgentSourceExportName,
          displayName: label,
          provider: baseAgent.provider,
          model: baseAgent.model,
          reasoning: { effort: baseAgent.reasoningEffort },
          instructionText: baseAgent.instructions,
          extensionUsageOverrides: Object.entries(baseAgent.overrides ?? {})
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([extensionId, usage]) => ({
              extensionId: extensionId as ExtensionId,
              usage,
            })),
          extensionOrder: (baseAgent.extensionOrder ?? []).map(
            (extensionId) => extensionId as ExtensionId,
          ),
        },
        sourceOwner: "agents-pane",
      });
      agents = await runtime.getAgents();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to create workflow agent.";
      return;
    }
    expandedProfileIds.add(id);
    expandedProfileIds = new Set(expandedProfileIds);
  }

  async function duplicateWorkflowAgent(
    record: WorkflowAgentSourceRecord,
    agent: WorkflowAgentSettings,
  ) {
    const label = `${agent.label} copy`;
    const id = createWorkflowAgentId(label);
    errorMessage = null;
    try {
      await runtime.duplicateWorkflowAgentSource({
        sourceId: record.sourceId as WorkflowAgentSourceExportName,
        draftPatch: {
          exportName: id as WorkflowAgentSourceExportName,
          displayName: label,
        },
        sourceOwner: "agents-pane",
      });
      agents = await runtime.getAgents();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to duplicate workflow agent.";
      return;
    }
    expandedProfileIds.add(id);
    expandedProfileIds = new Set(expandedProfileIds);
  }

  function requestDeleteWorkflowAgent(record: WorkflowAgentSourceRecord) {
    if (!record.deletable || deletingWorkflowAgentKey) return;
    confirmingDeleteWorkflowAgentKey = record.sourceId;
  }

  async function deleteWorkflowAgent(record: WorkflowAgentSourceRecord) {
    if (
      !record.deletable ||
      deletingWorkflowAgentKey ||
      confirmingDeleteWorkflowAgentKey !== record.sourceId
    ) {
      return;
    }
    deletingWorkflowAgentKey = record.sourceId;
    errorMessage = null;
    try {
      await runtime.deleteWorkflowAgentSource({
        sourceId: record.sourceId as WorkflowAgentSourceExportName,
        expectedSourceVersion: record.sourceVersion,
        sourceOwner: "agents-pane",
      });
      agents = await runtime.getAgents();
      confirmingDeleteWorkflowAgentKey = null;
      expandedProfileIds.delete(record.sourceId);
      expandedProfileIds = new Set(expandedProfileIds);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to delete workflow agent.";
    } finally {
      deletingWorkflowAgentKey = null;
    }
  }

  function cancelDeleteWorkflowAgentConfirmation() {
    confirmingDeleteWorkflowAgentKey = null;
  }

  function requestDeleteProfile(profile: ConfiguredAgentProfileReadModelRecord) {
    if (!profile.deletable || deletingProfileId) return;
    confirmingDeleteProfileId = profile.profileId;
  }

  async function deleteProfile(profile: ConfiguredAgentProfileReadModelRecord) {
    if (
      !profile.deletable ||
      deletingProfileId ||
      confirmingDeleteProfileId !== profile.profileId
    ) {
      return;
    }
    deletingProfileId = profile.profileId;
    errorMessage = null;
    try {
      agents = await runtime.deleteOrchestratorProfile({ profileId: profile.profileId });
      confirmingDeleteProfileId = null;
      expandedProfileIds.delete(profile.profileId);
      expandedProfileIds = new Set(expandedProfileIds);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to delete agent profile.";
    } finally {
      deletingProfileId = null;
    }
  }

  function cancelDeleteProfileConfirmation() {
    confirmingDeleteProfileId = null;
  }

  function getDropTarget(clientY: number): string | null {
    if (!orchestratorRowsElement) return null;

    const rowElements = Array.from(
      orchestratorRowsElement.querySelectorAll<HTMLElement>("[data-reorderable='true']"),
    );
    for (const rowElement of rowElements) {
      if (rowElement.dataset.profileId === draggedProfileId) continue;
      const bounds = rowElement.getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) {
        return rowElement.dataset.profileId ?? null;
      }
    }

    return null;
  }

  function clearDragFrame() {
    if (dragAnimationFrame === null) return;
    window.cancelAnimationFrame(dragAnimationFrame);
    dragAnimationFrame = null;
    pendingDragClientY = null;
  }

  onDestroy(() => {
    clearDragFrame();
    removeDragListeners();
  });

  function addDragListeners() {
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    window.addEventListener("blur", cancelPointerDrag);
  }

  function removeDragListeners() {
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerCancel);
    window.removeEventListener("blur", cancelPointerDrag);
  }

  function handlePointerDown(
    event: PointerEvent,
    profile: ConfiguredAgentProfileReadModelRecord,
  ) {
    if (event.button !== 0 || !event.isPrimary) return;
    if (profile.locked) return;
    clearDragFrame();
    removeDragListeners();
    profileDrag = {
      profileId: profile.profileId,
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      didMove: false,
    };
    draggedProfileId = null;
    dropBeforeProfileId = null;
    dragCaptureElement = event.currentTarget as HTMLElement;
    dragCaptureElement.setPointerCapture(event.pointerId);
    addDragListeners();
  }

  function applyDragMove(clientY: number) {
    if (!profileDrag) return;

    const didMove = profileDrag.didMove || Math.abs(clientY - profileDrag.startY) > 5;
    if (!didMove) return;

    if (!profileDrag.didMove) {
      draggedProfileId = profileDrag.profileId;
    }
    profileDrag = { ...profileDrag, didMove: true, lastY: clientY };
    const beforeProfileId = getDropTarget(clientY);
    if (beforeProfileId !== dropBeforeProfileId) {
      dropBeforeProfileId = beforeProfileId;
    }
  }

  function scheduleDragMove(clientY: number) {
    if (profileDrag) {
      profileDrag = { ...profileDrag, lastY: clientY };
    }
    pendingDragClientY = clientY;
    if (dragAnimationFrame !== null) return;

    dragAnimationFrame = window.requestAnimationFrame(() => {
      dragAnimationFrame = null;
      const nextClientY = pendingDragClientY;
      pendingDragClientY = null;
      if (nextClientY !== null) {
        applyDragMove(nextClientY);
      }
    });
  }

  function handleWindowPointerMove(event: PointerEvent) {
    if (!profileDrag || event.pointerId !== profileDrag.pointerId) return;
    scheduleDragMove(event.clientY);
    if (profileDrag.didMove || Math.abs(event.clientY - profileDrag.startY) > 5) {
      event.preventDefault();
    }
  }

  function handleWindowPointerUp(event: PointerEvent) {
    if (!profileDrag || event.pointerId !== profileDrag.pointerId) return;
    void finishPointerDrag(event.clientY);
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    if (!profileDrag || event.pointerId !== profileDrag.pointerId) return;
    cancelPointerDrag();
  }

  function cancelPointerDrag() {
    if (!profileDrag) return;
    releasePointerCapture(profileDrag.pointerId);
    clearDragFrame();
    removeDragListeners();
    profileDrag = null;
    draggedProfileId = null;
    dropBeforeProfileId = null;
  }

  function releasePointerCapture(pointerId: number) {
    if (dragCaptureElement?.hasPointerCapture(pointerId)) {
      dragCaptureElement.releasePointerCapture(pointerId);
    }
    dragCaptureElement = null;
  }

  async function finishPointerDrag(clientY: number) {
    if (!profileDrag) return;

    applyDragMove(clientY);
    clearDragFrame();

    const completedDrag = profileDrag.didMove;
    const profileId = profileDrag.profileId;
    const pointerId = profileDrag.pointerId;
    const beforeProfileId = dropBeforeProfileId;
    const shouldCommitReorder =
      completedDrag && configuredProfileOrderChanged(orchestrators, profileId, beforeProfileId);
    profileDrag = null;
    draggedProfileId = null;
    dropBeforeProfileId = null;
    releasePointerCapture(pointerId);
    removeDragListeners();
    if (!shouldCommitReorder) return;

    savingProfileId = profileId;
    errorMessage = null;
    try {
      const nextIds = reorderConfiguredProfiles(orchestrators, profileId, beforeProfileId).map(
        (candidate) => candidate.profileId,
      );
      agents = await runtime.reorderOrchestratorProfiles({ profileIds: nextIds });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to reorder profiles.";
    } finally {
      savingProfileId = null;
    }
  }

  function toggleExpanded(profileId: string, actor: AgentContextActor) {
    if (expandedProfileIds.has(profileId)) {
      expandedProfileIds.delete(profileId);
      activeContextPreviewRequests.delete(contextPreviewKey(actor, profileId));
    } else {
      expandedProfileIds.add(profileId);
      void loadAgentContextPreview(profileId, actor);
    }
    expandedProfileIds = new Set(expandedProfileIds);
  }

  function extensionUsageItems(input: {
    actor: AgentContextActor;
    profileId: string;
    usage: Readonly<Record<string, ExtensionUsageState>>;
  }): ExtensionUsageControlItem[] {
    const stateActorDefaults =
      input.actor === "orchestrator" || input.actor === "workflow-task"
        ? agents?.actorExtensionDefaults.find((record) => record.actor === input.actor)
        : null;
    const inventoryDefaults =
      input.actor === "orchestrator" || input.actor === "workflow-task"
        ? mergeActorExtensionDefaults({
            actor: input.actor,
            inventoryDefaults: runtime.extensionsInventorySnapshot?.defaults,
            stateDefaults: stateActorDefaults,
          })
        : (runtime.extensionsInventorySnapshot?.defaults ?? null);
    return buildExtensionUsageItems({
      ...input,
      extensionInventoryItems,
      inventoryDefaults,
      networkAccess:
        runtime.appPreferencesSnapshot?.networkAccess ?? true,
    });
  }

  function refreshAgentContextPreview(profileId: string, actor: AgentContextActor) {
    const key = contextPreviewKey(actor, profileId);
    if (!expandedProfileIds.has(profileId) && contextPreviewByProfileId[key]) {
      const { [key]: _discarded, ...rest } = contextPreviewByProfileId;
      contextPreviewByProfileId = rest;
    }
    if (expandedProfileIds.has(profileId)) {
      void loadAgentContextPreview(profileId, actor, { force: true });
    }
  }

  function syncRuntimeSnapshots() {
    const nextAgents = runtime.agentsSnapshot;
    const nextModelChoices = runtime.modelMetadataSnapshot;
    const nextExtensionsInventory = runtime.extensionsInventorySnapshot;
    if (nextAgents) {
      agents = nextAgents;
      loading = false;
    }
    if (nextModelChoices) {
      modelChoices = [...nextModelChoices];
    }
    if (nextExtensionsInventory) {
      extensionInventoryItems = nextExtensionsInventory.extensions;
    }
  }

  function focusTargetAgentProfile() {
    if (!targetAgentProfileId || loading) return;
    const escapedTarget = CSS.escape(targetAgentProfileId);
    const targetElement = document.querySelector<HTMLElement>(
      `[data-workflow-agent-id="${escapedTarget}"], [data-profile-id="${escapedTarget}"]`,
    );
    targetElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  syncRuntimeSnapshots();

  onMount(() => {
    unsubscribeRuntimeSnapshots = runtime.subscribe(syncRuntimeSnapshots);
    return () => {
      unsubscribeRuntimeSnapshots?.();
      unsubscribeRuntimeSnapshots = null;
    };
  });

  $effect(() => {
    void panelId;
    void loadSettings();
  });

  $effect(() => {
    void agents;
    void targetAgentProfileId;
    void targetView;
    if (agents && targetView === "generated-context-preview") {
      const targetProfileId = targetAgentProfileId ?? orchestrators[0]?.profileId ?? null;
      if (targetProfileId) {
        expandedProfileIds.add(targetProfileId);
        expandedProfileIds = new Set(expandedProfileIds);
        const targetWorkflowAgent = agents.workflowAgents.find(
          (record) => record.sourceId === targetProfileId,
        );
        if (!targetWorkflowAgent || targetWorkflowAgent.validationStatus === "valid") {
          void loadAgentContextPreview(targetProfileId, actorForProfileId(targetProfileId));
        }
      }
    }
    queueMicrotask(focusTargetAgentProfile);
  });
</script>

<section class="agents-pane" data-testid="agents-pane" data-panel-id={panelId}>
  {#if loading}
    <p class="agents-status">Loading...</p>
  {:else if errorMessage}
    <p class="agents-error">{errorMessage}</p>
  {:else if agents}
    <div class="agent-category">
      <div class="agent-category-heading">
        <div class="agent-category-title">
          <span>Orchestrators</span>
          <small>{orchestrators.length}</small>
        </div>
        <div class="agent-category-actions">
          <Button
            variant="ghost"
            size="xs"
            class="category-action"
            onclick={() => void createOrchestratorProfile()}
          >
            <PlusIcon size={13} aria-hidden="true" />
            <span>New</span>
          </Button>
        </div>
      </div>
      <div class="agent-rows" bind:this={orchestratorRowsElement}>
        {#each displayedOrchestrators as profile (profile.profileId)}
          {@const expanded = expandedProfileIds.has(profile.profileId)}
          <article
            class={`agent-profile-row ${expanded ? "expanded" : ""} ${profile.profileId === draggedProfileId ? "dragging" : ""}`.trim()}
            data-profile-id={profile.profileId}
            data-reorderable={profile.locked ? "false" : "true"}
            data-targeted={targetAgentProfileId === profile.profileId ? "true" : undefined}
            animate:flip={{ duration: draggedProfileId ? 170 : 0 }}
          >
            {@render profileRowContent(profile, "orchestrator", expanded)}
          </article>
        {/each}
      </div>
    </div>

    <div class="agent-category">
      <div class="agent-category-heading">
        <div class="agent-category-title">
          <span>Special Profiles</span>
          <small>builtin</small>
        </div>
      </div>
      <div class="agent-rows">
        {#if threadHandler}
          {@const expanded = expandedProfileIds.has(threadHandler.profileId)}
          <article
            class={`agent-profile-row ${expanded ? "expanded" : ""}`.trim()}
            data-profile-id={threadHandler.profileId}
            data-reorderable="false"
            data-targeted={targetAgentProfileId === threadHandler.profileId ? "true" : undefined}
          >
            {@render profileRowContent(threadHandler, "special", expanded)}
          </article>
        {/if}
      </div>
    </div>

    <div class="agent-category">
      <div class="agent-category-heading">
        <div class="agent-category-title">
          <span>Workflow Agents</span>
          <small>{workflowAgentRows.length}</small>
        </div>
        <div class="agent-category-actions">
          <Button
            variant="ghost"
            size="xs"
            class="category-action"
            onclick={() => void createWorkflowAgent()}
          >
            <PlusIcon size={13} aria-hidden="true" />
            <span>New</span>
          </Button>
        </div>
      </div>
      <div class="agent-rows">
        {#each workflowAgentRows as row (row.record.sourceId)}
          {@const expanded = expandedProfileIds.has(row.record.sourceId)}
          <article
            class={`agent-profile-row workflow-agent-row ${expanded ? "expanded" : ""}`.trim()}
            data-workflow-agent-id={row.record.sourceId}
            data-targeted={targetAgentProfileId === row.record.sourceId ? "true" : undefined}
          >
            {#if row.agent}
              {@render workflowAgentRowContent(row.record, row.agent, expanded)}
            {:else}
              {@render invalidWorkflowAgentRowContent(row.record)}
            {/if}
          </article>
        {/each}
      </div>
    </div>
  {:else}
    <p class="agents-error">Agent settings are unavailable.</p>
  {/if}
</section>

{#snippet workflowAgentRowContent(
  record: WorkflowAgentSourceRecord,
  agent: WorkflowAgentSettings,
  expanded: boolean,
)}
  <WorkflowAgentRowForm
    {agent}
    {expanded}
    {modelChoices}
    builtin={record.builtin}
    confirmingDelete={confirmingDeleteWorkflowAgentKey === record.sourceId}
    deletable={record.deletable}
    deleting={deletingWorkflowAgentKey === record.sourceId}
    saving={savingWorkflowAgentKey === record.sourceId}
    preferredExternalEditor={preferredExternalEditor(
      runtime.appPreferencesSnapshot?.externalEditor,
    )}
    sourceTokenCountLabel={expanded
      ? formatPromptTokenCount(workflowAgentInstructionTokenCount(agent))
      : null}
    extensionUsageItems={extensionUsageItems({
      actor: "workflow-task",
      profileId: agent.id,
      usage: agent.overrides ?? {},
    })}
    onCancelDelete={cancelDeleteWorkflowAgentConfirmation}
    onConfirmDelete={() => void deleteWorkflowAgent(record)}
    onDuplicate={() => void duplicateWorkflowAgent(record, agent)}
    onSave={(next, options) => saveWorkflowAgent(record, next, options)}
    onOpenExtension={openExtension}
    onOpenSource={() => void openWorkflowAgentSource(record)}
    onInstructionsChange={(instructions) => setWorkflowAgentInstructionDraft(agent.id, instructions)}
    onRequestDelete={() => requestDeleteWorkflowAgent(record)}
    onSetExtensionDefault={(extensionId, state) =>
      setActorExtensionDefault("workflow-task", agent.id, extensionId, state)}
    onSetExtensionUsage={(extensionId, state) =>
      setWorkflowAgentExtensionUsage(record, agent, extensionId, state)}
    onToggleExpanded={() => toggleExpanded(agent.id, "workflow-task")}
  />
  {#if expanded}
    {@const previewKey = contextPreviewKey("workflow-task", agent.id)}
    {@const preview = workflowAgentContextPreview(agent)}
    <div class="agent-profile-expanded">
      <ProfileExtensionEditor
        actor="workflow-task"
        disabled={deletingWorkflowAgentKey === agent.id}
        extensionOrder={agent.extensionOrder ?? []}
        items={extensionUsageItems({
          actor: "workflow-task",
          profileId: agent.id,
          usage: agent.overrides ?? {},
        })}
        loading={loadingContextPreviewKey === previewKey}
        previewError={contextPreviewErrorsByProfileId[previewKey] ?? null}
        {preview}
        onOpenExtension={openExtension}
        onOrderChange={(extensionOrder) =>
          setWorkflowAgentExtensionOrder(record, agent, extensionOrder)}
        onResetOrder={() => resetWorkflowAgentExtensionOrder(record, agent)}
        onResetSelection={() => resetWorkflowAgentExtensionSelection(record, agent)}
        onSetExtensionDefault={(extensionId, state) =>
          setActorExtensionDefault("workflow-task", agent.id, extensionId, state)}
        onStateChange={(extensionId, state) =>
          setWorkflowAgentExtensionUsage(record, agent, extensionId, state)}
      />
    </div>
  {/if}
{/snippet}

{#snippet invalidWorkflowAgentRowContent(record: WorkflowAgentSourceRecord)}
  <div class="invalid-workflow-agent-main">
    <AlertTriangleIcon size={14} aria-hidden="true" />
    <div class="invalid-workflow-agent-identity">
      <strong>{record.sourceId}</strong>
      <span>Invalid workflow-agent source</span>
    </div>
    <div
      class="invalid-workflow-agent-actions"
      use:dismissConfirmation={{
        active: confirmingDeleteWorkflowAgentKey === record.sourceId,
        onDismiss: cancelDeleteWorkflowAgentConfirmation,
      }}
    >
      <Tooltip label="Open workflow-agent source">
        <button
          type="button"
          class="invalid-workflow-agent-action"
          aria-label={`Open ${record.sourceId} source`}
          disabled={deletingWorkflowAgentKey === record.sourceId}
          onclick={() => void openWorkflowAgentSource(record)}
        >
          <ExternalLinkIcon size={13} aria-hidden="true" />
        </button>
      </Tooltip>
      {#if confirmingDeleteWorkflowAgentKey === record.sourceId}
        <Tooltip label="Confirm delete">
          <button
            type="button"
            class="invalid-workflow-agent-action danger"
            aria-label={`Confirm deleting ${record.sourceId}`}
            disabled={deletingWorkflowAgentKey === record.sourceId}
            onclick={() => void deleteWorkflowAgent(record)}
          >
            <CheckIcon size={13} aria-hidden="true" />
          </button>
        </Tooltip>
      {:else}
        <Tooltip
          label={record.deletable
            ? "Delete workflow agent"
            : "This invalid source filename cannot be deleted here"}
        >
          <button
            type="button"
            class="invalid-workflow-agent-action danger"
            aria-label={`Delete ${record.sourceId}`}
            disabled={!record.deletable || deletingWorkflowAgentKey === record.sourceId}
            onclick={() => requestDeleteWorkflowAgent(record)}
          >
            <Trash2Icon size={13} aria-hidden="true" />
          </button>
        </Tooltip>
      {/if}
    </div>
  </div>
  <div class="invalid-workflow-agent-diagnostics" role="status">
    {#each record.diagnostics as diagnostic}
      <p>
        <span>{diagnostic.severity}</span>
        {diagnostic.message}
      </p>
    {:else}
      <p>Source validation failed without a diagnostic.</p>
    {/each}
  </div>
{/snippet}

{#snippet profileRowContent(
  profile: ConfiguredAgentProfileReadModelRecord,
  category: "orchestrator" | "special",
  expanded: boolean,
)}
  <AgentProfileRowForm
    {category}
    {expanded}
    {modelChoices}
    {profile}
    confirmingDelete={confirmingDeleteProfileId === profile.profileId}
    deleting={deletingProfileId === profile.profileId}
    saving={savingProfileId === profile.profileId}
    extensionUsageItems={extensionUsageItems({
      actor: category === "special" ? "handler" : "orchestrator",
      profileId: profile.profileId,
      usage: profile.extensionUsage,
    })}
    onCancelDelete={cancelDeleteProfileConfirmation}
    onConfirmDelete={() => void deleteProfile(profile)}
    onDuplicate={category === "orchestrator" ? () => void createOrchestratorProfile(profile) : undefined}
    onPointerDown={category === "orchestrator" ? (event) => handlePointerDown(event, profile) : undefined}
    onRequestDelete={() => requestDeleteProfile(profile)}
    onSave={saveProfile}
    onOpenExtension={openExtension}
    onSetExtensionDefault={category === "orchestrator"
      ? (extensionId, state) => setActorExtensionDefault("orchestrator", profile.profileId, extensionId, state)
      : undefined}
    onSetExtensionUsage={(extensionId, state) => setProfileExtensionUsage(profile, extensionId, state)}
    onToggleExpanded={() => toggleExpanded(profile.profileId, category === "special" ? "handler" : "orchestrator")}
  />
  {#if expanded}
    {@const actor = category === "special" ? "handler" : "orchestrator"}
    {@const previewKey = contextPreviewKey(actor, profile.profileId)}
    <div class="agent-profile-expanded">
      <ProfileExtensionEditor
        {actor}
        disabled={deletingProfileId === profile.profileId}
        extensionOrder={profile.extensionOrder ?? []}
        items={extensionUsageItems({
          actor,
          profileId: profile.profileId,
          usage: profile.extensionUsage,
        })}
        loading={loadingContextPreviewKey === previewKey}
        preview={contextPreviewByProfileId[previewKey] ?? null}
        previewError={contextPreviewErrorsByProfileId[previewKey] ?? null}
        onOpenExtension={openExtension}
        onOrderChange={(extensionOrder) => setProfileExtensionOrder(profile, actor, extensionOrder)}
        onResetOrder={() => resetProfileExtensionOrder(profile, actor)}
        onResetSelection={() => resetProfileExtensionSelection(profile, actor)}
        onSetExtensionDefault={(extensionId, state) =>
          actor === "handler"
            ? undefined
            : setActorExtensionDefault(actor, profile.profileId, extensionId, state)}
        onStateChange={(extensionId, state) => setProfileExtensionUsage(profile, extensionId, state)}
      />
    </div>
  {/if}
{/snippet}

{#snippet generatedContextPreview(profileId: AgentProfileId | WorkflowAgentKey, actor: AgentContextActor)}
  {@const key = contextPreviewKey(actor, profileId)}
  {@const preview = contextPreviewByProfileId[key]}
  <div class="agent-profile-expanded">
    {#if loadingContextPreviewKey === key && !preview}
      <p>Loading generated context preview...</p>
    {:else if preview}
      <div class="context-preview-header">
        <div>
          <span class="context-preview-eyebrow">Generated context preview</span>
          <strong>{preview.profileName}</strong>
        </div>
        <span class="context-preview-model">{preview.provider}/{preview.model} · {preview.reasoningEffort}</span>
      </div>
      <div class="context-preview-meta">
        <span>Actor: {preview.actor}</span>
        <span>Loaded: {preview.loadedExtensionIds.join(", ") || "none"}</span>
        <span>Available: {preview.availableExtensionIds.join(", ") || "none"}</span>
      </div>
      <pre class="context-preview-body">{preview.systemPrompt}</pre>
    {:else}
      <Button
        variant="secondary"
        size="xs"
        onclick={() => void loadAgentContextPreview(profileId, actor)}
      >
        Load generated context preview
      </Button>
    {/if}
  </div>
{/snippet}

<style>
  .agents-pane {
    display: flex;
    flex-direction: column;
    gap: 0.72rem;
    height: 100%;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: scroll;
    padding: 0.72rem;
    scrollbar-gutter: stable;
    background: var(--ui-panel);
    color: var(--ui-text-primary);
  }

  .agents-status {
    margin: 0.18rem 0 0;
    color: var(--ui-text-tertiary);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .agents-error {
    margin: 0;
    padding: 0.62rem 0.7rem;
    border: 1px solid color-mix(in oklab, var(--ui-danger) 30%, var(--ui-border-soft));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-danger-soft) 64%, transparent);
    color: var(--ui-danger);
    font-size: var(--text-sm);
  }

  .agent-category {
    display: grid;
    gap: 0.36rem;
    min-width: 0;
  }

  .agent-category-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 0.5rem;
    min-width: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
    font-weight: 650;
    text-transform: uppercase;
  }

  .agent-category-title {
    display: inline-flex;
    align-items: baseline;
    gap: 0.36rem;
    min-width: 0;
  }

  .agent-category-title > span {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-category-heading small {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: none;
  }

  .agent-category-actions {
    display: inline-flex;
    align-items: center;
    justify-self: end;
    min-width: 0;
  }

  :global(.category-action) {
    box-sizing: border-box;
    height: 1.42rem;
    min-height: 1.42rem;
    width: 3.48rem;
    min-width: 3.48rem;
    overflow: hidden;
    padding-block: 0;
    padding-inline: 0.36rem;
    text-transform: none;
    line-height: 1;
  }

  :global(.category-action .ui-button-content) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.22rem;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
  }

  :global(.category-action .ui-button-content > svg) {
    flex: 0 0 auto;
  }

  :global(.category-action .ui-button-content > span) {
    min-width: 0;
    overflow: hidden;
    line-height: 1;
    text-overflow: clip;
  }

  .agent-rows {
    display: grid;
    gap: 0.22rem;
    min-width: 0;
  }

  .agent-profile-row {
    display: grid;
    gap: 0.28rem;
    min-width: 0;
    overflow-x: clip;
    overflow-y: visible;
    padding: 0.3rem 0.36rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface) 82%, transparent);
    transition:
      opacity 150ms cubic-bezier(0.19, 1, 0.22, 1),
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .agent-profile-row.expanded {
    border-color: color-mix(in oklab, var(--ui-accent) 22%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-surface-raised) 78%, transparent);
  }

  .agent-profile-row[data-targeted="true"] {
    border-color: color-mix(in oklab, var(--ui-accent) 45%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-accent-soft) 28%, var(--ui-surface));
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ui-accent) 18%, transparent);
  }

  .agent-profile-row.dragging {
    opacity: 0.58;
  }

  .invalid-workflow-agent-main {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.42rem;
    min-width: 0;
    color: var(--ui-danger);
  }

  .invalid-workflow-agent-identity {
    display: grid;
    gap: 0.04rem;
    min-width: 0;
  }

  .invalid-workflow-agent-identity strong,
  .invalid-workflow-agent-identity span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .invalid-workflow-agent-identity strong {
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
  }

  .invalid-workflow-agent-identity span,
  .invalid-workflow-agent-diagnostics {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .invalid-workflow-agent-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.08rem;
  }

  .invalid-workflow-agent-action {
    display: grid;
    place-items: center;
    width: 1.32rem;
    height: 1.45rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
  }

  .invalid-workflow-agent-action:hover:not(:disabled),
  .invalid-workflow-agent-action:focus-visible:not(:disabled) {
    outline: none;
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
    box-shadow: var(--ui-focus-ring);
  }

  .invalid-workflow-agent-action.danger:hover:not(:disabled),
  .invalid-workflow-agent-action.danger:focus-visible:not(:disabled) {
    background: var(--ui-danger-soft);
    color: var(--ui-danger);
  }

  .invalid-workflow-agent-action:disabled {
    cursor: default;
    opacity: 0.36;
  }

  .invalid-workflow-agent-diagnostics {
    display: grid;
    gap: 0.14rem;
    padding-left: 1.82rem;
  }

  .invalid-workflow-agent-diagnostics p {
    margin: 0;
    line-height: 1.4;
  }

  .invalid-workflow-agent-diagnostics span {
    margin-right: 0.3rem;
    color: var(--ui-danger);
    font-family: var(--font-mono);
    text-transform: uppercase;
  }

  .agent-profile-main {
    --agent-row-line-height: 1.45rem;

    display: flex;
    align-items: flex-start;
    gap: 0.36rem;
    min-width: 0;
  }

  .agent-drag-handle,
  .agent-drag-placeholder,
  .agent-expand-button {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 1.24rem;
    height: var(--agent-row-line-height);
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
  }

  .agent-drag-handle {
    cursor: grab;
    touch-action: none;
  }

  .agent-drag-handle:disabled,
  .agent-drag-placeholder {
    cursor: default;
    opacity: 0.72;
  }

  .agent-expand-button {
    cursor: pointer;
  }

  .agent-drag-handle:not(:disabled):hover,
  .agent-drag-handle:not(:disabled):focus-visible,
  .agent-expand-button:hover,
  .agent-expand-button:focus-visible {
    outline: none;
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .agent-drag-handle:not(:disabled):focus-visible,
  .agent-expand-button:focus-visible,
  .agent-icon-button:focus-visible:not(:disabled) {
    box-shadow: var(--ui-focus-ring);
  }

  .agent-locked-name {
    display: flex;
    align-items: center;
    flex: 1 1 4.5rem;
    box-sizing: border-box;
    min-width: 0;
    height: var(--agent-row-line-height);
    min-height: 0;
    overflow: hidden;
    padding: 0 0.34rem;
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.agent-name-input.ui-input) {
    box-sizing: border-box;
    flex: 1 1 4.5rem;
    min-width: 4.5rem;
    height: var(--agent-row-line-height);
    min-height: 0;
    padding: 0 0.34rem;
    border-color: transparent;
    background: transparent;
    font-weight: 600;
  }

  :global(.agent-name-input.ui-input:hover),
  :global(.agent-name-input.ui-input:focus-visible) {
    border-color: var(--ui-border-soft);
    background: var(--ui-bg-elevated);
  }

  .agent-middle-controls {
    display: flex;
    align-items: center;
    align-content: flex-start;
    justify-content: flex-end;
    gap: 0.36rem;
    flex: 0 1 auto;
    flex-wrap: wrap;
    min-width: 0;
    min-height: var(--agent-row-line-height);
    row-gap: 0.18rem;
  }

  .agent-controls {
    display: inline-flex;
    align-items: center;
    align-content: flex-start;
    gap: 0.36rem;
    flex: 0 1 auto;
    flex-wrap: wrap;
    min-width: 0;
    row-gap: 0.18rem;
  }

  .agent-controls :global(.compact-combobox),
  .agent-controls :global(.compact-select) {
    flex: 0 1 auto;
    min-width: 0;
  }

  :global(.compact-combobox-trigger.agent-model-field) {
    width: fit-content;
    max-width: clamp(6.6rem, 13vw, 8.8rem);
  }

  :global(.compact-select-trigger.agent-reasoning-field) {
    width: fit-content;
    max-width: clamp(4.9rem, 9vw, 5.8rem);
  }

  .composer-sync-field {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    flex: 0 0 auto;
    min-height: var(--agent-row-line-height);
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    line-height: 1;
    white-space: nowrap;
  }

  .agent-row-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.08rem;
    flex: 0 0 auto;
    min-height: var(--agent-row-line-height);
  }

  .agent-icon-button {
    display: grid;
    place-items: center;
    width: 1.32rem;
    height: var(--agent-row-line-height);
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
  }

  .agent-icon-button:hover:not(:disabled),
  .agent-icon-button:focus-visible:not(:disabled) {
    outline: none;
    background: var(--ui-hover-bg);
    color: var(--ui-text-primary);
  }

  .agent-icon-button.danger:hover:not(:disabled),
  .agent-icon-button.danger:focus-visible:not(:disabled) {
    background: var(--ui-danger-soft);
    color: var(--ui-danger);
  }

  .agent-icon-button:disabled {
    cursor: default;
    opacity: 0.36;
  }

  .agent-action-spacer {
    width: 1.32rem;
    height: 1.32rem;
  }

  .workflow-agent-row {
    gap: 0.36rem;
  }

  .workflow-instructions-field {
    box-sizing: border-box;
    width: 100%;
    min-height: 4rem;
    resize: vertical;
    padding: 0.42rem 0.5rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-bg-elevated) 84%, transparent);
    color: var(--ui-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .workflow-instructions-field:hover,
  .workflow-instructions-field:focus-visible {
    outline: none;
    border-color: color-mix(in oklab, var(--ui-accent) 36%, var(--ui-border-soft));
    box-shadow: var(--ui-focus-ring);
  }

  .agent-profile-expanded {
    padding: 0.22rem 0 0.18rem;
    color: var(--ui-text-tertiary);
    font-size: var(--text-sm);
  }

  .agent-profile-expanded p {
    margin: 0;
  }

  .context-preview-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.72rem;
    min-width: 0;
    color: var(--ui-text-primary);
  }

  .context-preview-header > div {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .context-preview-eyebrow,
  .context-preview-model,
  .context-preview-meta {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .context-preview-eyebrow {
    text-transform: uppercase;
  }

  .context-preview-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.72rem;
    margin-top: 0.46rem;
  }

  .context-preview-body {
    max-height: 22rem;
    min-width: 0;
    margin: 0.55rem 0 0;
    overflow: auto;
    padding: 0.58rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
  }
</style>
