<script lang="ts">
  import { onMount, tick } from "svelte";
  import type {
    AgentSettingsState,
    AppPreferences,
    ExternalInstructionActor,
    ExternalInstructionControl,
    RequestUserInputSettings,
  } from "../shared/agent-settings";
  import { DEFAULT_EXTERNAL_INSTRUCTION_ACTORS } from "../shared/agent-settings";
  import type {
    AgentContextPreviewResponse,
    ExtensionChangeCardReadModel,
    ExtensionCliRequirementReadiness,
    ExtensionEnvRequirementReadiness,
    ExtensionInventoryItemReadModel,
    ExtensionsInventoryReadModel,
  } from "../shared/workspace-contract";
  import { BUILTIN_EXTENSIONS, resolveActorExtensionState } from "../shared/extensions";
  import type { ChatRuntime } from "./chat-runtime";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import Checkbox from "./ui/Checkbox.svelte";
  import OpenExternalButton from "./ui/OpenExternalButton.svelte";
  import ExtensionEnvValueForm from "./ExtensionEnvValueForm.svelte";

  type Props = {
    runtime: ChatRuntime;
    targetExtensionId?: string | null;
    targetView?: "inventory" | "generated-context-preview";
  };

  let { runtime, targetExtensionId = null, targetView = "inventory" }: Props = $props();
  let agentSettings = $state<AgentSettingsState | null>(runtime.agentSettingsSnapshot);
  let appPreferences = $state<AppPreferences | null>(runtime.appPreferencesSnapshot);
  let contextPreview = $state<AgentContextPreviewResponse | null>(null);
  let extensionsInventory = $state<ExtensionsInventoryReadModel | null>(
    runtime.extensionsInventorySnapshot,
  );
  let settingsError = $state<string | null>(null);
  let inventoryError = $state<string | null>(null);
  let pendingSettings = $state(false);
  let revertingChangeId = $state<string | null>(null);
  let loadingPreview = $state(false);
  let loadingInventory = $state(!extensionsInventory);
  let pendingExternalInstructionPath = $state<string | null>(null);
  const extensionRowElements = new Map<string, HTMLElement>();

  const ACTORS = [
    { id: "orchestrator", label: "Orchestrator" },
    { id: "handler", label: "Handler" },
    { id: "workflow-task", label: "Workflow Task" },
  ] as const;

  const actorStates = ACTORS.map((actor) => ({
    ...actor,
    state: resolveActorExtensionState({ actor: actor.id }),
  }));

  function inventoryRows(): ExtensionInventoryItemReadModel[] {
    if (extensionsInventory) return extensionsInventory.extensions;
    return BUILTIN_EXTENSIONS.map((extension) => ({
      id: extension.id,
      category: extension.category,
      interface: extension.interface,
      title: extension.title,
      description: extension.description,
      typescriptApiEnabled: extension.typescriptApiEnabled,
      usage: [],
      requirements: {
        cliRequirements: [],
        env: [],
      },
      state: {
        ready: true,
        issues: [],
      },
    }));
  }

  function registerExtensionRow(node: HTMLElement, extensionId: string) {
    extensionRowElements.set(extensionId, node);
    return {
      destroy() {
        if (extensionRowElements.get(extensionId) === node) {
          extensionRowElements.delete(extensionId);
        }
      },
    };
  }

  async function focusTargetExtension(extensionId: string): Promise<void> {
    await tick();
    const row = extensionRowElements.get(extensionId);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.focus({ preventScroll: true });
  }

  function reversibleChangeCards(): ExtensionChangeCardReadModel[] {
    return extensionsInventory?.reversibleChanges ?? [];
  }

  function usageFor(
    extension: ExtensionInventoryItemReadModel,
    actor: (typeof ACTORS)[number]["id"],
  ): string {
    const inventoryUsage = extension.usage.find((usage) => usage.actorKind === actor);
    if (inventoryUsage) return usageLabel(inventoryUsage.state);
    const state = actorStates.find((candidate) => candidate.id === actor)?.state;
    if (state?.loadedExtensionIds.includes(extension.id)) return "Loaded";
    if (state?.availableExtensionIds.includes(extension.id)) return "Available";
    return "Unavailable";
  }

  function usageLabel(state: string): string {
    if (state === "default_loaded") return "Loaded";
    if (state === "available") return "Available";
    return "Unavailable";
  }

  function usageTone(usage: string): "neutral" | "info" | "success" | "warning" | "danger" {
    if (usage === "Loaded") return "success";
    if (usage === "Available") return "info";
    return "neutral";
  }

  function interfaceLabel(kind: string): string {
    if (kind === "native_tool") return "Native";
    if (kind === "svvyx") return "svvyx";
    return "Prompt";
  }

  function categoryLabel(category: string): string {
    if (category === "external_instruction") return "External Instructions";
    if (category === "user") return "User";
    return "Builtin";
  }

  function sourceGroupLabel(group: string): string {
    if (group === "builtin_global_root") return "Builtin global root";
    if (group === "custom_global_root") return "Custom global root";
    return "Workspace chain";
  }

  function shortHash(hash: string): string {
    return hash ? hash.slice(0, 12) : "unreadable";
  }

  function inventoryCliRequirements(extensionId: string): ExtensionCliRequirementReadiness[] {
    return (
      extensionsInventory?.extensions.find((extension) => extension.id === extensionId)?.requirements
        .cliRequirements ?? []
    );
  }

  function inventoryEnvRequirements(extensionId: string): ExtensionEnvRequirementReadiness[] {
    return (
      extensionsInventory?.extensions.find((extension) => extension.id === extensionId)?.requirements
        .env ?? []
    );
  }

  function cliRequirementTone(
    requirement: ExtensionCliRequirementReadiness,
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    if (requirement.status === "missing") return "danger";
    if (requirement.status === "unknown") return "warning";
    if (requirement.updateAvailable) return "info";
    return "success";
  }

  function cliRequirementLabel(requirement: ExtensionCliRequirementReadiness): string {
    if (requirement.status === "missing") return `${requirement.binary}: missing`;
    if (requirement.status === "unknown") return `${requirement.binary}: unknown`;
    if (requirement.updateAvailable) return `${requirement.binary}: update`;
    return `${requirement.binary}: available`;
  }

  function cliRequirementVersions(requirement: ExtensionCliRequirementReadiness): string {
    const parts: string[] = [];
    if (requirement.currentVersion) parts.push(`current ${requirement.currentVersion}`);
    if (!requirement.currentVersion && requirement.detectedVersion) {
      parts.push(`detected ${requirement.detectedVersion}`);
    }
    if (requirement.defaultVersion) parts.push(`default ${requirement.defaultVersion}`);
    if (requirement.latestVersion) parts.push(`latest ${requirement.latestVersion}`);
    return parts.join(" · ") || "version unavailable";
  }

  function cliRequirementCommand(requirement: ExtensionCliRequirementReadiness): string | null {
    if (requirement.status === "missing") return requirement.installCommand;
    if (requirement.updateAvailable) return requirement.updateCommand;
    return null;
  }

  function declaredCliRequirementBinaries(extensionId: string): string[] {
    return (
      BUILTIN_EXTENSIONS.find((extension) => extension.id === extensionId)?.cliRequirements?.map(
        (requirement) => requirement.binary,
      ) ?? []
    );
  }

  function envRequirementTone(
    requirement: ExtensionEnvRequirementReadiness,
  ): "neutral" | "info" | "success" | "warning" | "danger" {
    if (requirement.status === "configured" || requirement.status === "defaulted") {
      return "success";
    }
    if (requirement.status === "missing" && requirement.required) return "danger";
    return "neutral";
  }

  function envRequirementLabel(requirement: ExtensionEnvRequirementReadiness): string {
    if (requirement.status === "configured") return `${requirement.name}: configured`;
    if (requirement.status === "defaulted") return `${requirement.name}: default`;
    if (requirement.status === "missing") return `${requirement.name}: missing`;
    return `${requirement.name}: optional`;
  }

  async function saveExtensionEnvValue(
    extensionId: string,
    requirement: ExtensionEnvRequirementReadiness,
    value: string,
  ): Promise<void> {
    if (requirement.secret) {
      extensionsInventory = await runtime.setExtensionEnvSecret({
        extensionId,
        name: requirement.name,
        value,
      });
      return;
    }
    extensionsInventory = await runtime.setExtensionEnvOverride({
      extensionId,
      name: requirement.name,
      value,
    });
  }

  async function removeExtensionEnvValue(
    extensionId: string,
    requirement: ExtensionEnvRequirementReadiness,
  ): Promise<void> {
    if (requirement.secret) {
      extensionsInventory = await runtime.removeExtensionEnvSecret({
        extensionId,
        name: requirement.name,
      });
      return;
    }
    extensionsInventory = await runtime.removeExtensionEnvOverride({
      extensionId,
      name: requirement.name,
    });
  }

  async function loadSettings(): Promise<void> {
    try {
      settingsError = null;
      agentSettings = await runtime.getAgentSettings();
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "Settings are unavailable.";
    }
  }

  async function loadAppPreferences(): Promise<void> {
    try {
      settingsError = null;
      appPreferences = await runtime.getAppPreferences();
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "App preferences are unavailable.";
    }
  }

  async function loadExtensionsInventory(): Promise<void> {
    loadingInventory = !extensionsInventory;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.getExtensionsInventory();
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Extension CLI readiness is unavailable.";
    } finally {
      loadingInventory = false;
    }
  }

  function syncRuntimeSnapshots(): void {
    const nextSettings = runtime.agentSettingsSnapshot;
    const nextPreferences = runtime.appPreferencesSnapshot;
    const nextInventory = runtime.extensionsInventorySnapshot;
    if (nextSettings) {
      agentSettings = nextSettings;
    }
    if (nextPreferences) {
      appPreferences = nextPreferences;
    }
    if (nextInventory) {
      extensionsInventory = nextInventory;
      loadingInventory = false;
    }
  }

  async function loadContextPreview(): Promise<void> {
    loadingPreview = true;
    settingsError = null;
    try {
      contextPreview = await runtime.getAgentContextPreview({ actor: "orchestrator" });
    } catch (error) {
      settingsError =
        error instanceof Error ? error.message : "Generated context preview is unavailable.";
    } finally {
      loadingPreview = false;
    }
  }

  async function updateRequestUserInputSettings(
    patch: Partial<RequestUserInputSettings> & {
      blockingTimeout?: Partial<RequestUserInputSettings["blockingTimeout"]>;
    },
  ): Promise<void> {
    if (!agentSettings || pendingSettings) return;
    const current = agentSettings.requestUserInput;
    const next: RequestUserInputSettings = {
      mode: patch.mode ?? current.mode,
      blockingTimeout: {
        enabled: patch.blockingTimeout?.enabled ?? current.blockingTimeout.enabled,
        durationMs: patch.blockingTimeout?.durationMs ?? current.blockingTimeout.durationMs,
      },
    };
    pendingSettings = true;
    settingsError = null;
    try {
      agentSettings = await runtime.updateRequestUserInputSettings(next);
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "Unable to save settings.";
    } finally {
      pendingSettings = false;
    }
  }

  function updateBlockingTimeoutSeconds(value: string): void {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return;
    void updateRequestUserInputSettings({
      blockingTimeout: { durationMs: Math.max(1, Math.floor(seconds)) * 1000 },
    });
  }

  function formatChangeTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  async function revertExtensionChange(changeId: string): Promise<void> {
    if (revertingChangeId) return;
    revertingChangeId = changeId;
    inventoryError = null;
    try {
      extensionsInventory = await runtime.revertExtensionChange(changeId);
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to revert extension change.";
    } finally {
      revertingChangeId = null;
    }
  }

  async function openExternalInstruction(path: string): Promise<void> {
    inventoryError = null;
    try {
      await runtime.openGeneratedAgentContextExternalSourceInEditor(path);
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to open external instruction source.";
    }
  }

  function copyAppPreferences(input: AppPreferences): AppPreferences {
    return {
      appAppearance: input.appAppearance,
      preferredExternalEditor: input.preferredExternalEditor,
      customExternalEditorCommand: input.customExternalEditorCommand,
      artifactDirectory: input.artifactDirectory,
      approvalMode: input.approvalMode,
      networkAccess: input.networkAccess,
      externalInstructions: {
        globalRoots: input.externalInstructions.globalRoots.map((root) => ({ ...root })),
        globalControls: copyExternalInstructionControls(
          input.externalInstructions.globalControls,
        ),
        workspaceControls: Object.fromEntries(
          Object.entries(input.externalInstructions.workspaceControls).map(([key, controls]) => [
            key,
            copyExternalInstructionControls(controls),
          ]),
        ),
      },
      ambientAgentResources: {
        categories: Object.fromEntries(
          Object.entries(input.ambientAgentResources.categories).map(([category, setting]) => [
            category,
            { enabled: setting.enabled },
          ]),
        ) as AppPreferences["ambientAgentResources"]["categories"],
        enablements: input.ambientAgentResources.enablements.map((record) => ({
          ...record,
          source: { ...record.source },
          scope: { ...record.scope },
          targets: record.targets.map((target) => ({ ...target })),
        })),
      },
    };
  }

  function copyExternalInstructionControls(
    controls: Record<string, ExternalInstructionControl>,
  ): Record<string, ExternalInstructionControl> {
    return Object.fromEntries(
      Object.entries(controls).map(([path, control]) => [
        path,
        {
          enabled: control.enabled,
          actors: [...control.actors],
        },
      ]),
    );
  }

  function actorLabel(actor: ExternalInstructionActor): string {
    return ACTORS.find((candidate) => candidate.id === actor)?.label ?? actor;
  }

  function externalInstructionControl(
    extension: ExtensionInventoryItemReadModel,
  ): ExternalInstructionControl {
    return {
      enabled: extension.externalInstruction?.enabled === true,
      actors: [...(extension.externalInstruction?.actors ?? [])],
    };
  }

  async function saveExternalInstructionControl(
    extension: ExtensionInventoryItemReadModel,
    control: ExternalInstructionControl,
  ): Promise<void> {
    if (!extension.externalInstruction || !appPreferences || pendingExternalInstructionPath) return;
    const source = extension.externalInstruction;
    const nextPreferences = copyAppPreferences(appPreferences);
    const nextControl: ExternalInstructionControl = {
      enabled: control.enabled,
      actors: control.actors.filter((actor) =>
        DEFAULT_EXTERNAL_INSTRUCTION_ACTORS.includes(actor),
      ),
    };
    pendingExternalInstructionPath = source.path;
    inventoryError = null;
    try {
      if (source.sourceGroup === "workspace_chain") {
        nextPreferences.externalInstructions.workspaceControls = {
          ...nextPreferences.externalInstructions.workspaceControls,
          [runtime.workspaceId]: {
            ...nextPreferences.externalInstructions.workspaceControls[runtime.workspaceId],
            [source.path]: nextControl,
          },
        };
      } else {
        nextPreferences.externalInstructions.globalControls = {
          ...nextPreferences.externalInstructions.globalControls,
          [source.path]: nextControl,
        };
      }
      appPreferences = await runtime.updateAppPreferences(nextPreferences);
      extensionsInventory = await runtime.getExtensionsInventory();
    } catch (error) {
      inventoryError =
        error instanceof Error ? error.message : "Unable to save external instruction controls.";
    } finally {
      pendingExternalInstructionPath = null;
    }
  }

  function setExternalInstructionEnabled(
    extension: ExtensionInventoryItemReadModel,
    enabled: boolean,
  ): void {
    void saveExternalInstructionControl(extension, {
      ...externalInstructionControl(extension),
      enabled,
    });
  }

  function setExternalInstructionActor(
    extension: ExtensionInventoryItemReadModel,
    actor: ExternalInstructionActor,
    enabled: boolean,
  ): void {
    const control = externalInstructionControl(extension);
    const actors = new Set(control.actors);
    if (enabled) {
      actors.add(actor);
    } else {
      actors.delete(actor);
    }
    void saveExternalInstructionControl(extension, {
      ...control,
      actors: [...actors],
    });
  }

  onMount(() => {
    syncRuntimeSnapshots();
    const unsubscribeRuntime = runtime.subscribe(syncRuntimeSnapshots);
    void loadSettings();
    void loadAppPreferences();
    void loadExtensionsInventory();
    return unsubscribeRuntime;
  });

  $effect(() => {
    if (targetView === "generated-context-preview" && !contextPreview && !loadingPreview) {
      void loadContextPreview();
    }
  });

  $effect(() => {
    if (targetView !== "inventory" || !targetExtensionId || loadingInventory) return;
    const rowCount = inventoryRows().length;
    if (rowCount === 0) return;
    void focusTargetExtension(targetExtensionId);
  });
</script>

<section class="extensions-pane" aria-label="Extensions">
  <header class="extensions-header">
    <div>
      <p>Extensions</p>
      <h2>Inventory</h2>
    </div>
    <strong>{inventoryRows().length}</strong>
  </header>

  {#if targetView === "generated-context-preview"}
    <section class="generated-context-preview" aria-label="Generated context preview">
      {#if settingsError}
        <p class="extension-settings-error" role="alert">{settingsError}</p>
      {/if}
      {#if loadingPreview && !contextPreview}
        <p class="extension-settings-loading">Loading generated context preview</p>
      {:else if contextPreview}
        <div class="generated-context-preview-meta">
          <div>
            <p>Generated Context Preview</p>
            <h3>{contextPreview.profileName}</h3>
          </div>
          <span>{contextPreview.provider}/{contextPreview.model} · {contextPreview.reasoningEffort}</span>
        </div>
        <div class="generated-context-preview-tags">
          <span>Loaded: {contextPreview.loadedExtensionIds.join(", ") || "none"}</span>
          <span>Available: {contextPreview.availableExtensionIds.join(", ") || "none"}</span>
        </div>
        <pre>{contextPreview.systemPrompt}</pre>
      {/if}
    </section>
  {:else}
  <div class="extensions-inventory">
  {#if reversibleChangeCards().length}
    <section class="extension-change-history" aria-label="Reversible extension changes">
      <div class="extension-change-history-header">
        <div>
          <p>Change History</p>
          <h3>Reversible Changes</h3>
        </div>
        <span>{reversibleChangeCards().length}</span>
      </div>
      <div class="extension-change-cards">
        {#each reversibleChangeCards() as change (change.id)}
          <article class="extension-change-card">
            <div class="extension-change-card-main">
              <div>
                <strong>{change.title}</strong>
                <span>{change.description}</span>
              </div>
              <code>{change.revertCommand}</code>
            </div>
            <div class="extension-change-card-meta">
              <Badge tone={change.kind === "extension_delete" ? "warning" : "info"}>
                {change.extensionId}
              </Badge>
              <span>{formatChangeTime(change.createdAt)}</span>
              <Button
                size="xs"
                variant="secondary"
                disabled={revertingChangeId !== null}
                onclick={() => revertExtensionChange(change.id)}
              >
                {revertingChangeId === change.id ? "Reverting" : "Revert"}
              </Button>
            </div>
          </article>
        {/each}
      </div>
    </section>
  {/if}

  <div class="extensions-table" role="table" aria-label="Extension inventory">
    <div class="extensions-row header" role="row">
      <span role="columnheader">Extension</span>
      <span role="columnheader">Interface</span>
      {#each ACTORS as actor (actor.id)}
        <span role="columnheader">{actor.label}</span>
      {/each}
      <span role="columnheader">Settings</span>
    </div>

    {#each inventoryRows() as extension (extension.id)}
      {@const cliRequirements = inventoryCliRequirements(extension.id)}
      {@const envRequirements = inventoryEnvRequirements(extension.id)}
      {@const declaredCliBinaries = declaredCliRequirementBinaries(extension.id)}
      <div
        use:registerExtensionRow={extension.id}
        class={`extensions-row ${extension.id === targetExtensionId ? "target-extension-row" : ""}`.trim()}
        role="row"
        tabindex={extension.id === targetExtensionId ? -1 : undefined}
        data-extension-id={extension.id}
      >
        <div class="extension-name" role="cell">
          <strong>{extension.title}</strong>
          <span>{extension.description}</span>
          <Badge tone={extension.category === "external_instruction" ? "info" : "neutral"}>
            {categoryLabel(extension.category)}
          </Badge>
          {#if extension.externalInstruction}
            <div class="external-instruction-readonly" aria-label={`${extension.title} external instruction source`}>
              <div class="external-instruction-meta">
                <Badge tone={extension.externalInstruction.readStatus.status === "readable" ? "success" : "danger"}>
                  {extension.externalInstruction.readStatus.status}
                </Badge>
                <span>{sourceGroupLabel(extension.externalInstruction.sourceGroup)}</span>
                <span>order {extension.externalInstruction.order}</span>
                <span>sha {shortHash(extension.externalInstruction.contentHash)}</span>
              </div>
              <code>{extension.externalInstruction.path}</code>
              {#if extension.externalInstruction.readStatus.status === "unreadable"}
                <span class="extension-cli-error">{extension.externalInstruction.readStatus.error ?? "Unable to read file."}</span>
              {:else}
                <pre>{extension.externalInstruction.content}</pre>
              {/if}
            </div>
          {/if}
          {#if cliRequirements.length}
            <div class="extension-cli-requirements" aria-label={`${extension.title} CLI readiness`}>
              {#each cliRequirements as requirement (requirement.id)}
                {@const command = cliRequirementCommand(requirement)}
                <div class="extension-cli-requirement">
                  <Badge tone={cliRequirementTone(requirement)}>
                    {cliRequirementLabel(requirement)}
                  </Badge>
                  <span>{cliRequirementVersions(requirement)}</span>
                  {#if command}
                    <code>{command}</code>
                  {/if}
                </div>
              {/each}
            </div>
          {:else if declaredCliBinaries.length && loadingInventory}
            <span class="extension-cli-loading">
              Checking {declaredCliBinaries.join(", ")}
            </span>
          {:else if declaredCliBinaries.length && inventoryError}
            <span class="extension-cli-error">{inventoryError}</span>
          {/if}
          {#if envRequirements.length}
            <div class="extension-env-requirements" aria-label={`${extension.title} env readiness`}>
              {#each envRequirements as requirement (requirement.name)}
                <div class="extension-env-requirement">
                  <div class="extension-env-requirement-meta">
                    <Badge tone={envRequirementTone(requirement)}>
                      {envRequirementLabel(requirement)}
                    </Badge>
                    <span>{requirement.secret ? "Secret" : "Value"} · {requirement.description}</span>
                  </div>
                  <ExtensionEnvValueForm
                    secret={requirement.secret}
                    configured={requirement.status === "configured"}
                    onSave={(value) => saveExtensionEnvValue(extension.id, requirement, value)}
                    onRemove={
                      requirement.status === "configured"
                        ? () => removeExtensionEnvValue(extension.id, requirement)
                        : undefined
                    }
                  />
                </div>
              {/each}
            </div>
          {/if}
        </div>
        <div role="cell">
          <Badge tone={extension.interface === "svvyx" ? "info" : "neutral"}>
            {interfaceLabel(extension.interface)}
          </Badge>
        </div>
        {#each ACTORS as actor (actor.id)}
          {@const usage = usageFor(extension, actor.id)}
          <div role="cell">
            <Badge tone={usageTone(usage)}>{usage}</Badge>
          </div>
        {/each}
        <div class={`extension-settings ${extension.id === "request-user-input" || extension.externalInstruction ? "" : "empty"}`} role="cell">
          {#if extension.externalInstruction}
            {@const control = externalInstructionControl(extension)}
            {@const isSavingExternalInstruction = pendingExternalInstructionPath === extension.externalInstruction.path}
            <div class="external-instruction-controls" aria-label={`${extension.title} usage controls`}>
              <label class="external-instruction-enable">
                <Checkbox
                  size="sm"
                  checked={control.enabled}
                  disabled={!appPreferences || isSavingExternalInstruction}
                  onchange={(event) =>
                    setExternalInstructionEnabled(
                      extension,
                      (event.currentTarget as HTMLInputElement).checked,
                    )}
                />
                <span>Enabled</span>
              </label>
              <div class="external-instruction-actors" aria-label={`${extension.title} actors`}>
                {#each ACTORS as actor (actor.id)}
                  <label class="external-instruction-actor">
                    <Checkbox
                      size="sm"
                      checked={control.actors.includes(actor.id)}
                      disabled={!appPreferences || isSavingExternalInstruction}
                      onchange={(event) =>
                        setExternalInstructionActor(
                          extension,
                          actor.id,
                          (event.currentTarget as HTMLInputElement).checked,
                        )}
                    />
                    <span>{actorLabel(actor.id)}</span>
                  </label>
                {/each}
              </div>
              <OpenExternalButton
                disabled={isSavingExternalInstruction}
                editor={appPreferences?.preferredExternalEditor}
                targetLabel={extension.externalInstruction.path}
                onclick={() => openExternalInstruction(extension.externalInstruction!.path)}
              />
            </div>
          {:else if extension.id === "request-user-input"}
            {#if settingsError}
              <p class="extension-settings-error" role="alert">{settingsError}</p>
            {/if}
            {#if agentSettings}
              <div class="request-input-mode" aria-label="Request User Input mode">
                <Button
                  size="xs"
                  variant={agentSettings.requestUserInput.mode === "nonblocking" ? "primary" : "ghost"}
                  disabled={pendingSettings}
                  onclick={() => updateRequestUserInputSettings({ mode: "nonblocking" })}
                >
                  Nonblocking
                </Button>
                <Button
                  size="xs"
                  variant={agentSettings.requestUserInput.mode === "blocking" ? "primary" : "ghost"}
                  disabled={pendingSettings}
                  onclick={() => updateRequestUserInputSettings({ mode: "blocking" })}
                >
                  Blocking
                </Button>
              </div>
              {#if agentSettings.requestUserInput.mode === "blocking"}
                <label class="request-input-timeout-toggle">
                  <Checkbox
                    size="sm"
                    checked={agentSettings.requestUserInput.blockingTimeout.enabled}
                    disabled={pendingSettings}
                    onchange={(event) =>
                      updateRequestUserInputSettings({
                        blockingTimeout: {
                          enabled: (event.currentTarget as HTMLInputElement).checked,
                        },
                      })}
                  />
                  <span>Timeout</span>
                </label>
                <label class="request-input-timeout-field">
                  <span>Seconds</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    disabled={pendingSettings || !agentSettings.requestUserInput.blockingTimeout.enabled}
                    value={Math.round(agentSettings.requestUserInput.blockingTimeout.durationMs / 1000)}
                    onchange={(event) =>
                      updateBlockingTimeoutSeconds((event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
              {/if}
            {:else}
              <span class="extension-settings-loading">Loading</span>
            {/if}
          {:else}
            <span class="extension-settings-empty" aria-hidden="true">-</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
  </div>
  {/if}
</section>

<style>
  .extensions-pane {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    color: var(--ui-text-primary);
    background: var(--ui-surface);
  }

  .extensions-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.1rem 0.85rem;
    border-bottom: 1px solid var(--ui-border-subtle);
  }

  .extensions-header p {
    margin: 0 0 0.2rem;
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .extensions-header h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
  }

  .extensions-header strong {
    color: var(--ui-text-secondary);
    font-size: 0.8rem;
  }

  .extensions-table {
    min-height: 0;
    overflow: auto;
  }

  .extensions-inventory {
    min-height: 0;
    overflow: auto;
  }

  .extension-change-history {
    display: grid;
    gap: 0.7rem;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--ui-border-subtle);
    background: var(--ui-surface-subtle);
  }

  .extension-change-history-header,
  .extension-change-card,
  .extension-change-card-main,
  .extension-change-card-meta {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }

  .extension-change-history-header,
  .extension-change-card {
    justify-content: space-between;
  }

  .extension-change-history-header p,
  .extension-change-history-header h3 {
    margin: 0;
  }

  .extension-change-history-header p,
  .extension-change-history-header span,
  .extension-change-card span,
  .extension-change-card code {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .extension-change-history-header h3 {
    font-size: 0.9rem;
  }

  .extension-change-cards {
    display: grid;
    gap: 0.5rem;
  }

  .extension-change-card {
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface);
  }

  .extension-change-card-main {
    flex: 1 1 auto;
    justify-content: flex-start;
  }

  .extension-change-card-main > div {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }

  .extension-change-card-main strong,
  .extension-change-card-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-change-card code {
    overflow-wrap: anywhere;
  }

  .extension-change-card-meta {
    flex: 0 0 auto;
  }

  .extensions-row {
    display: grid;
    grid-template-columns: minmax(17rem, 1.5fr) minmax(7rem, 0.55fr) repeat(3, minmax(7rem, 0.6fr)) minmax(16rem, 1fr);
    gap: 0.85rem;
    align-items: center;
    padding: 0.72rem 1.1rem;
    border-bottom: 1px solid var(--ui-border-subtle);
  }

  .extensions-row.target-extension-row {
    outline: 1px solid color-mix(in oklab, var(--ui-accent) 46%, var(--ui-border-soft));
    outline-offset: -1px;
    background: color-mix(in oklab, var(--ui-accent-soft) 26%, var(--ui-surface));
  }

  .extensions-row.target-extension-row:focus {
    outline: 1px solid color-mix(in oklab, var(--ui-accent) 60%, var(--ui-border-soft));
  }

  .extension-settings {
    display: grid;
    gap: 0.45rem;
    align-items: center;
  }

  .extension-settings.empty {
    justify-items: start;
  }

  .extension-settings-empty,
  .extension-settings-loading {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .request-input-mode,
  .request-input-timeout-toggle,
  .request-input-timeout-field {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .request-input-timeout-toggle,
  .request-input-timeout-field,
  .extension-settings-error {
    color: var(--ui-text-secondary);
    font-size: var(--text-xs);
  }

  .request-input-timeout-field input {
    width: 5.2rem;
    padding: 0.28rem 0.38rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface);
    color: var(--ui-text-primary);
  }

  .extension-settings-error {
    margin: 0;
    color: var(--ui-danger);
  }

  .extensions-row.header {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--ui-surface);
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .extension-name {
    display: grid;
    gap: 0.22rem;
    min-width: 0;
  }

  .extension-name > strong,
  .extension-name > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extension-name > span {
    color: var(--ui-text-secondary);
    font-size: 0.78rem;
  }

  .extension-cli-requirements,
  .extension-env-requirements {
    display: grid;
    gap: 0.32rem;
    margin-top: 0.2rem;
  }

  .external-instruction-readonly {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.45rem;
    min-width: 0;
  }

  .external-instruction-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
  }

  .external-instruction-readonly code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
  }

  .external-instruction-readonly pre {
    max-height: 8rem;
    overflow: auto;
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .external-instruction-controls {
    display: grid;
    gap: 0.42rem;
    min-width: 9.5rem;
  }

  .external-instruction-enable,
  .external-instruction-actor {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    min-width: 0;
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
    line-height: 1.2;
  }

  .external-instruction-enable {
    color: var(--ui-text-primary);
    font-weight: 600;
  }

  .external-instruction-actors {
    display: grid;
    gap: 0.24rem;
  }

  .extension-cli-requirement,
  .extension-env-requirement {
    min-width: 0;
  }

  .extension-cli-requirement,
  .extension-env-requirement-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.32rem 0.45rem;
    min-width: 0;
  }

  .extension-cli-requirement span,
  .extension-env-requirement span,
  .extension-cli-loading,
  .extension-cli-error {
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
  }

  .extension-cli-requirement code {
    max-width: 100%;
    overflow-wrap: anywhere;
    color: var(--ui-text-secondary);
    font-size: 0.72rem;
  }

  .extension-cli-error {
    color: var(--ui-danger);
  }

  .generated-context-preview {
    min-height: 0;
    overflow: auto;
    padding: 1rem 1.1rem;
  }

  .generated-context-preview-meta {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .generated-context-preview-meta p {
    margin: 0 0 0.2rem;
    color: var(--ui-text-tertiary);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .generated-context-preview-meta h3 {
    margin: 0;
    font-size: 1rem;
  }

  .generated-context-preview-meta span,
  .generated-context-preview-tags {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .generated-context-preview-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.72rem;
    margin-top: 0.7rem;
  }

  .generated-context-preview pre {
    min-width: 0;
    margin: 0.7rem 0 0;
    overflow: auto;
    padding: 0.72rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
  }
</style>
