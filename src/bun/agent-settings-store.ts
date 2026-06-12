import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  AMBIENT_AGENT_RESOURCE_CATEGORIES,
  DEFAULT_AGENT_SETTINGS_STATE,
  DEFAULT_ARTIFACT_DIRECTORY,
  DEFAULT_EXTERNAL_INSTRUCTION_ACTORS,
  DEFAULT_EXTERNAL_INSTRUCTION_GLOBAL_ROOTS,
  DEFAULT_WORKFLOW_AGENT_SETTINGS,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  type AgentSettingsState,
  type AgentProfileId,
  type AgentProfileSettings,
  type ApprovalMode,
  type AmbientAgentResourceEnablementRecord,
  type AmbientAgentResourceHost,
  type AmbientAgentResourceScope,
  type AmbientAgentResourceSource,
  type AmbientAgentResourceTarget,
  type AmbientAgentResourcesSettings,
  type AppAppearance,
  type AppPreferences,
  type ExtensionEnvSettings,
  type ExternalInstructionActor,
  type ExternalInstructionControl,
  type ExternalInstructionGlobalRootSetting,
  type ExternalInstructionsSettings,
  type PreferredExternalEditor,
  type RequestUserInputSettings,
  type AgentPromptSettings,
  type WorkflowAgentKey,
  type WorkflowAgentSettings,
} from "../shared/agent-settings";
import type { Agents } from "./smithers-runtime/workflow-authoring-contract";
import { getWorkflowsSourceRoot } from "./smithers-runtime/workflow-library";
import {
  assertFileBackedSaveAllowed,
  fileBackedTextVersion,
  readFileBackedVersion,
  writeTextFileAtomically,
} from "./file-backed-resource";
import type { FileBackedSaveMode } from "../shared/file-backed-edit";
import {
  BUILTIN_EXTENSIONS,
  resolveActorExtensionState,
  type ExtensionUsageState,
} from "../shared/extensions";

export type AgentSettingsStore = {
  getState(): AgentSettingsState;
  setAgentProfile(profile: AgentProfileSettings): AgentSettingsState;
  deleteAgentProfile(id: AgentProfileId): AgentSettingsState;
  reorderOrchestratorProfiles(ids: AgentProfileId[]): AgentSettingsState;
  setWorkflowAgent(
    key: WorkflowAgentKey,
    settings: WorkflowAgentSettings,
    options?: { baseSourceVersion?: string; mode?: FileBackedSaveMode },
  ): AgentSettingsState;
  deleteWorkflowAgent(
    key: WorkflowAgentKey,
    options?: { baseSourceVersion?: string; mode?: FileBackedSaveMode },
  ): AgentSettingsState;
  setExtensionEnv(settings: ExtensionEnvSettings): AgentSettingsState;
  setRequestUserInput(settings: RequestUserInputSettings): AgentSettingsState;
  setAppPreferences(preferences: AppPreferences): AgentSettingsState;
};

export function createAgentSettingsStore(input: {
  cwd: string;
  agentDir: string;
  workflowsSourceRoot?: string;
}): AgentSettingsStore {
  const settingsPath = join(input.agentDir, "agent-settings.json");
  const workflowsSourceRoot = input.workflowsSourceRoot ?? getWorkflowsSourceRoot();

  const readState = (): AgentSettingsState => {
    const normalized = existsSync(settingsPath)
      ? normalizeAgentSettingsState(
          JSON.parse(readFileSync(settingsPath, "utf8")) as Partial<AgentSettingsState>,
        )
      : structuredClone(DEFAULT_AGENT_SETTINGS_STATE);
    ensureWorkflowAgentSourceRecords(workflowsSourceRoot, DEFAULT_WORKFLOW_AGENT_SETTINGS);
    return {
      ...normalized,
      workflowAgents: readWorkflowAgentSourceRecords(
        workflowsSourceRoot,
        normalized.workflowAgents,
      ),
    };
  };

  const writeState = (state: AgentSettingsState): AgentSettingsState => {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify(stripSourceVersionsFromState(state), null, 2)}\n`,
    );
    return state;
  };

  return {
    getState: readState,
    setAgentProfile: (profile) => {
      const state = readState();
      const normalizedProfile = normalizeAgentProfile(profile);
      const existingOrchestratorIndex = state.agents.orchestrators.findIndex(
        (agent) => agent.id === normalizedProfile.id,
      );
      const orchestrators =
        normalizedProfile.kind === "orchestrator"
          ? existingOrchestratorIndex >= 0
            ? state.agents.orchestrators.map((agent, index) =>
                index === existingOrchestratorIndex
                  ? normalizeAgentProfile({
                      ...normalizedProfile,
                      builtin: agent.builtin,
                      locked: agent.locked,
                    })
                  : agent,
              )
            : [
                ...state.agents.orchestrators,
                normalizeAgentProfile({
                  ...normalizedProfile,
                  builtin: false,
                  locked: false,
                }),
              ]
          : state.agents.orchestrators;
      state.agents = normalizeAgentProfileState({
        ...state.agents,
        orchestrators,
        special:
          normalizedProfile.kind === "special"
            ? {
                ...state.agents.special,
                threadHandler:
                  normalizedProfile.id === state.agents.special.threadHandler.id
                    ? normalizeAgentProfile({
                        ...normalizedProfile,
                        kind: "special",
                        builtin: true,
                        locked: true,
                      })
                    : state.agents.special.threadHandler,
              }
            : state.agents.special,
      });
      return writeState(state);
    },
    deleteAgentProfile: (id) => {
      const state = readState();
      state.agents = normalizeAgentProfileState({
        ...state.agents,
        orchestrators: state.agents.orchestrators.filter(
          (agent) => agent.id !== id || agent.locked,
        ),
      });
      return writeState(state);
    },
    reorderOrchestratorProfiles: (ids) => {
      const state = readState();
      const byId = new Map(state.agents.orchestrators.map((agent) => [agent.id, agent]));
      const locked = state.agents.orchestrators.filter((agent) => agent.locked);
      const ordered = ids
        .map((id) => byId.get(id))
        .filter((agent): agent is AgentProfileSettings => agent !== undefined && !agent.locked);
      const missing = state.agents.orchestrators.filter(
        (agent) => !agent.locked && !ids.includes(agent.id),
      );
      state.agents = normalizeAgentProfileState({
        ...state.agents,
        orchestrators: [...locked, ...ordered, ...missing],
      });
      return writeState(state);
    },
    setWorkflowAgent: (key, settings, options) => {
      const state = readState();
      const normalizedWorkflowAgent = normalizeWorkflowAgentSettings(key, settings);
      const path = workflowAgentSourcePath(workflowsSourceRoot, normalizedWorkflowAgent.id);
      assertFileBackedSaveAllowed({
        baseVersion: options?.baseSourceVersion,
        current: state.workflowAgents[key] ?? normalizedWorkflowAgent,
        currentVersion: readFileBackedVersion(path),
        mode: options?.mode,
      });
      state.workflowAgents[key] = normalizedWorkflowAgent;
      const saved = writeWorkflowAgentSourceRecord(workflowsSourceRoot, normalizedWorkflowAgent);
      state.workflowAgents[key] = saved;
      const next = writeState(state);
      return next;
    },
    deleteWorkflowAgent: (key, options) => {
      const state = readState();
      const path = workflowAgentSourcePath(workflowsSourceRoot, key);
      assertFileBackedSaveAllowed({
        baseVersion: options?.baseSourceVersion,
        current: state.workflowAgents[key] ?? null,
        currentVersion: readFileBackedVersion(path),
        mode: options?.mode,
      });
      delete state.workflowAgents[key];
      const next = writeState(state);
      rmSync(path, { force: true });
      return next;
    },
    setExtensionEnv: (settings) => {
      const state = readState();
      state.extensionEnv = normalizeExtensionEnvSettings(settings);
      return writeState(state);
    },
    setRequestUserInput: (settings) => {
      const state = readState();
      state.requestUserInput = normalizeRequestUserInputSettings(settings);
      return writeState(state);
    },
    setAppPreferences: (preferences) => {
      const state = readState();
      state.appPreferences = normalizeAppPreferences(preferences);
      return writeState(state);
    },
  };
}

function writeWorkflowAgentSourceRecord(
  workflowsSourceRoot: string,
  settings: WorkflowAgentSettings,
): WorkflowAgentSettings {
  const path = workflowAgentSourcePath(workflowsSourceRoot, settings.id);
  const content = workflowAgentSourceContent(settings);
  writeTextFileAtomically(path, content);
  return { ...settings, sourceVersion: fileBackedTextVersion(content) };
}

function ensureWorkflowAgentSourceRecords(
  workflowsSourceRoot: string,
  settings: Record<string, WorkflowAgentSettings>,
): void {
  for (const agent of Object.values(settings)) {
    const path = join(workflowsSourceRoot, "agents", `${agent.id}.agent.json`);
    if (!existsSync(path)) {
      writeWorkflowAgentSourceRecord(workflowsSourceRoot, agent);
    }
  }
}

function readWorkflowAgentSourceRecords(
  workflowsSourceRoot: string,
  fallback: Record<string, WorkflowAgentSettings>,
): Record<string, WorkflowAgentSettings> {
  const agentsDir = join(workflowsSourceRoot, "agents");
  if (!existsSync(agentsDir)) {
    return fallback;
  }
  const records: Record<string, WorkflowAgentSettings> = {};
  for (const entry of readdirSync(agentsDir).toSorted()) {
    if (!entry.endsWith(".agent.json")) continue;
    const path = join(agentsDir, entry);
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<WorkflowAgentSettings>;
      const id = basename(entry, ".agent.json");
      const sourceVersion = readFileBackedVersion(path);
      records[id] = normalizeWorkflowAgentSettings(id, {
        id,
        label: typeof raw.label === "string" ? raw.label : id,
        provider: typeof raw.provider === "string" ? raw.provider : "",
        model: typeof raw.model === "string" ? raw.model : "",
        reasoningEffort: raw.reasoningEffort as WorkflowAgentSettings["reasoningEffort"],
        instructions: typeof raw.instructions === "string" ? raw.instructions : "",
        extensions: Array.isArray(raw.extensions) ? raw.extensions : [],
        extensionUsage: normalizeExtensionUsage(raw.extensionUsage),
        extensionOrder: normalizeExtensionOrder(raw.extensionOrder),
        sourceVersion,
      });
    } catch (error) {
      throw new Error(`Workflow agent source is not valid JSON: ${path}`, { cause: error });
    }
  }
  return Object.keys(records).length > 0 ? records : fallback;
}

function workflowAgentSourcePath(workflowsSourceRoot: string, id: string): string {
  return join(workflowsSourceRoot, "agents", `${id}.agent.json`);
}

function workflowAgentSourceContent(settings: WorkflowAgentSettings): string {
  return `${JSON.stringify(
    {
      id: settings.id,
      label: settings.label,
      provider: settings.provider,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      instructions: settings.instructions,
      extensions: settings.extensions,
      extensionUsage: settings.extensionUsage,
      extensionOrder: settings.extensionOrder ?? [],
    },
    null,
    2,
  )}\n`;
}

function stripSourceVersionsFromState(state: AgentSettingsState): AgentSettingsState {
  return {
    ...state,
    workflowAgents: Object.fromEntries(
      Object.entries(state.workflowAgents).map(([key, agent]) => [
        key,
        stripWorkflowAgentSourceVersion(agent),
      ]),
    ),
  };
}

function stripWorkflowAgentSourceVersion(agent: WorkflowAgentSettings): WorkflowAgentSettings {
  const { sourceVersion: _sourceVersion, ...rest } = agent;
  return rest;
}

export function normalizeAgentSettingsState(
  input: Partial<AgentSettingsState>,
): AgentSettingsState {
  const defaults = structuredClone(DEFAULT_AGENT_SETTINGS_STATE);
  const workflowAgents = (input.workflowAgents ?? {}) as Partial<
    AgentSettingsState["workflowAgents"]
  >;

  return {
    version: 2,
    agents: normalizeAgentProfileState(
      (input.agents ?? {}) as Partial<AgentSettingsState["agents"]>,
    ),
    workflowAgents: normalizeWorkflowAgentSettingsRecords({
      ...defaults.workflowAgents,
      ...workflowAgents,
    }),
    extensionEnv: normalizeExtensionEnvSettings({
      ...defaults.extensionEnv,
      ...input.extensionEnv,
    }),
    requestUserInput: normalizeRequestUserInputSettings({
      ...defaults.requestUserInput,
      ...input.requestUserInput,
      blockingTimeout: {
        ...defaults.requestUserInput.blockingTimeout,
        ...input.requestUserInput?.blockingTimeout,
      },
    }),
    appPreferences: normalizeAppPreferences({
      ...defaults.appPreferences,
      ...input.appPreferences,
    }),
  };
}

function normalizeExtensionEnvSettings(
  input: Partial<ExtensionEnvSettings> | undefined,
): ExtensionEnvSettings {
  const nonSecretOverrides: ExtensionEnvSettings["nonSecretOverrides"] = {};
  for (const [rawExtensionId, rawValues] of Object.entries(input?.nonSecretOverrides ?? {})) {
    const extensionId = rawExtensionId.trim();
    if (!extensionId || !rawValues || typeof rawValues !== "object") {
      continue;
    }
    const values: Record<string, string> = {};
    for (const [rawName, rawValue] of Object.entries(rawValues)) {
      const name = rawName.trim();
      if (!name || typeof rawValue !== "string") {
        continue;
      }
      values[name] = rawValue;
    }
    if (Object.keys(values).length > 0) {
      nonSecretOverrides[extensionId] = values;
    }
  }
  return { nonSecretOverrides };
}

function normalizeRequestUserInputSettings(
  input: Partial<RequestUserInputSettings>,
): RequestUserInputSettings {
  const defaults = DEFAULT_AGENT_SETTINGS_STATE.requestUserInput;
  const durationMs = Number(
    input.blockingTimeout?.durationMs ?? defaults.blockingTimeout.durationMs,
  );
  return {
    mode: input.mode === "blocking" ? "blocking" : "nonblocking",
    blockingTimeout: {
      enabled: input.blockingTimeout?.enabled ?? defaults.blockingTimeout.enabled,
      durationMs:
        Number.isFinite(durationMs) && durationMs >= 1_000
          ? Math.floor(durationMs)
          : defaults.blockingTimeout.durationMs,
    },
  };
}

function normalizeAgentProfileState(
  input: Partial<AgentSettingsState["agents"]>,
): AgentSettingsState["agents"] {
  const defaults = structuredClone(DEFAULT_AGENT_SETTINGS_STATE.agents);
  const orchestratorsInput = Array.isArray(input.orchestrators) ? input.orchestrators : [];
  const orchestrators = orchestratorsInput
    .map((profile) => normalizeAgentProfile(profile))
    .filter((profile) => profile.kind === "orchestrator")
    .map((profile) =>
      profile.id === DEFAULT_ORCHESTRATOR_PROFILE_ID
        ? { ...profile, builtin: true, locked: true }
        : profile,
    );
  if (!orchestrators.some((profile) => profile.id === DEFAULT_ORCHESTRATOR_PROFILE_ID)) {
    const defaultOrchestrator = defaults.orchestrators[0];
    if (defaultOrchestrator) {
      orchestrators.unshift(defaultOrchestrator);
    }
  }
  const byId = new Map<string, AgentProfileSettings>();
  for (const profile of orchestrators) {
    byId.set(profile.id, profile);
  }

  const threadHandler = normalizeAgentProfile({
    ...defaults.special.threadHandler,
    ...input.special?.threadHandler,
    id: defaults.special.threadHandler.id,
    kind: "special",
    locked: true,
    builtin: true,
  });
  const titleNamer = normalizeAgentPromptSettings({
    ...defaults.titleNamer,
    ...input.titleNamer,
  });
  return {
    orchestrators: [...byId.values()].toSorted((left, right) => {
      if (left.id === DEFAULT_ORCHESTRATOR_PROFILE_ID) return -1;
      if (right.id === DEFAULT_ORCHESTRATOR_PROFILE_ID) return 1;
      return 0;
    }),
    special: { threadHandler },
    titleNamer,
  };
}

function normalizeAgentProfile(input: AgentProfileSettings): AgentProfileSettings {
  return {
    id: requireNonEmpty(input.id, "id"),
    kind: input.kind === "special" ? "special" : "orchestrator",
    name: requireNonEmpty(input.name, "name"),
    provider: requireNonEmpty(input.provider, "provider"),
    model: requireNonEmpty(input.model, "model"),
    reasoningEffort: input.reasoningEffort,
    systemPrompt: "",
    extensionUsage: normalizeExtensionUsage(input.extensionUsage),
    extensionOrder: normalizeExtensionOrder(input.extensionOrder),
    updateFromComposer: Boolean(input.updateFromComposer),
    builtin: Boolean(input.builtin),
    locked: Boolean(input.locked),
  };
}

function normalizeExtensionUsage(
  input: AgentProfileSettings["extensionUsage"] | null | undefined,
): AgentProfileSettings["extensionUsage"] {
  const usage: AgentProfileSettings["extensionUsage"] = {};
  for (const [rawId, rawState] of Object.entries(input ?? {})) {
    const id = rawId.trim();
    if (!id) continue;
    if (rawState === "default_loaded" || rawState === "available" || rawState === "unavailable") {
      usage[id] = rawState;
    }
  }
  return usage;
}

function normalizeExtensionOrder(input: string[] | null | undefined): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rawId of input ?? []) {
    if (typeof rawId !== "string") continue;
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeAgentPromptSettings(input: AgentPromptSettings): AgentPromptSettings {
  return {
    provider: requireNonEmpty(input.provider, "provider"),
    model: requireNonEmpty(input.model, "model"),
    reasoningEffort: input.reasoningEffort,
    systemPrompt: requireNonEmpty(input.systemPrompt, "systemPrompt"),
  };
}

function normalizeWorkflowAgentSettings(
  key: WorkflowAgentKey,
  input: WorkflowAgentSettings,
): WorkflowAgentSettings {
  const extensionUsage = normalizeWorkflowAgentExtensionUsage(input);
  return assertWorkflowAgentSettingsAssignableToParameters({
    id: key,
    label: requireNonEmpty(input.label, "label"),
    provider: requireNonEmpty(input.provider, "provider"),
    model: requireNonEmpty(input.model, "model"),
    reasoningEffort: input.reasoningEffort,
    instructions: requireNonEmpty(input.instructions, "instructions"),
    extensions: workflowTaskLoadedExtensionIds(extensionUsage),
    extensionUsage,
    extensionOrder: normalizeExtensionOrder(input.extensionOrder),
    sourceVersion: input.sourceVersion,
  });
}

function assertWorkflowAgentSettingsAssignableToParameters<T extends Agents.TaskAgentParameters>(
  settings: T & { extensionUsage: Record<string, ExtensionUsageState> },
): T & { extensionUsage: Record<string, ExtensionUsageState> } {
  return settings;
}

function normalizeWorkflowAgentExtensionUsage(
  input: WorkflowAgentSettings,
): WorkflowAgentSettings["extensionUsage"] {
  const usage = normalizeExtensionUsage(input.extensionUsage);
  for (const rawId of input.extensions ?? []) {
    const id = rawId.trim();
    if (id && usage[id] === undefined) {
      usage[id] = "default_loaded";
    }
  }
  return usage;
}

const BUILTIN_EXTENSION_IDS: Set<string> = new Set(
  BUILTIN_EXTENSIONS.map((extension) => extension.id),
);

function workflowTaskLoadedExtensionIds(
  extensionUsage: Record<string, ExtensionUsageState>,
): string[] {
  const loaded = new Set<string>();
  for (const [rawId, state] of Object.entries(extensionUsage)) {
    const id = rawId.trim();
    if (!id || state !== "default_loaded") {
      continue;
    }
    if (!BUILTIN_EXTENSION_IDS.has(id)) {
      loaded.add(id);
      continue;
    }
    const builtinState = resolveActorExtensionState({
      actor: "workflow-task",
      profileExtensionUsage: { [id]: "default_loaded" },
    });
    if (builtinState.loadedExtensionIds.includes(id)) {
      loaded.add(id);
    }
  }
  return [...loaded].toSorted();
}

function normalizeWorkflowAgentSettingsRecords(
  input: Record<string, WorkflowAgentSettings>,
): Record<string, WorkflowAgentSettings> {
  const records: Record<string, WorkflowAgentSettings> = {};
  for (const [key, settings] of Object.entries(input)) {
    records[key] = normalizeWorkflowAgentSettings(key, settings);
  }
  return records;
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Expected non-empty ${label}.`);
  }
  return trimmed;
}

function normalizeAppPreferences(input: AppPreferences): AppPreferences {
  return {
    appAppearance: normalizeAppAppearance(input.appAppearance),
    preferredExternalEditor: normalizePreferredExternalEditor(input.preferredExternalEditor),
    customExternalEditorCommand: input.customExternalEditorCommand.trim(),
    artifactDirectory:
      typeof input.artifactDirectory === "string" && input.artifactDirectory.trim()
        ? input.artifactDirectory.trim()
        : DEFAULT_ARTIFACT_DIRECTORY,
    approvalMode: normalizeApprovalMode(input.approvalMode),
    networkAccess: input.networkAccess !== false,
    externalInstructions: normalizeExternalInstructions(input.externalInstructions),
    ambientAgentResources: normalizeAmbientAgentResources(input.ambientAgentResources),
  };
}

function normalizeExternalInstructions(
  input: ExternalInstructionsSettings | undefined,
): ExternalInstructionsSettings {
  return {
    globalRoots: normalizeExternalInstructionGlobalRoots(input?.globalRoots),
    globalControls: normalizeExternalInstructionControls(input?.globalControls),
    workspaceControls: Object.fromEntries(
      Object.entries(input?.workspaceControls ?? {})
        .map(([workspaceKey, controls]) => [
          workspaceKey.trim(),
          normalizeExternalInstructionControls(controls),
        ])
        .filter(([workspaceKey]) => Boolean(workspaceKey)),
    ),
  };
}

function normalizeExternalInstructionGlobalRoots(
  roots: readonly ExternalInstructionGlobalRootSetting[] | undefined,
): ExternalInstructionGlobalRootSetting[] {
  const byId = new Map(
    (roots ?? []).map((root) => [typeof root.id === "string" ? root.id.trim() : "", root]),
  );
  const builtins = DEFAULT_EXTERNAL_INSTRUCTION_GLOBAL_ROOTS.map((root) => {
    const input = byId.get(root.id);
    return {
      ...root,
      path: typeof input?.path === "string" && input.path.trim() ? input.path.trim() : root.path,
      enabled: typeof input?.enabled === "boolean" ? input.enabled : root.enabled,
    };
  });
  const custom = (roots ?? [])
    .filter((root) => root.kind === "custom")
    .map((root) => ({
      id: typeof root.id === "string" ? root.id.trim() : "",
      kind: "custom" as const,
      label: typeof root.label === "string" && root.label.trim() ? root.label.trim() : "Custom",
      path: typeof root.path === "string" ? root.path.trim() : "",
      enabled: root.enabled !== false,
    }))
    .filter((root) => root.id && root.path);
  return [...builtins, ...custom];
}

function normalizeExternalInstructionControls(
  input: Record<string, ExternalInstructionControl> | undefined,
): Record<string, ExternalInstructionControl> {
  const controls: Record<string, ExternalInstructionControl> = {};
  for (const [rawPath, control] of Object.entries(input ?? {})) {
    const path = rawPath.trim();
    if (!path) continue;
    const actors = normalizeExternalInstructionActors(control.actors);
    controls[path] = {
      enabled: control.enabled !== false,
      actors,
    };
  }
  return controls;
}

function normalizeExternalInstructionActors(input: readonly unknown[]): ExternalInstructionActor[] {
  const allowed = new Set<ExternalInstructionActor>(DEFAULT_EXTERNAL_INSTRUCTION_ACTORS);
  return [
    ...new Set(
      input.filter((actor): actor is ExternalInstructionActor =>
        allowed.has(actor as ExternalInstructionActor),
      ),
    ),
  ].toSorted();
}

function normalizeAmbientAgentResources(
  input: AmbientAgentResourcesSettings | undefined,
): AmbientAgentResourcesSettings {
  return {
    categories: Object.fromEntries(
      AMBIENT_AGENT_RESOURCE_CATEGORIES.map((category) => [
        category,
        { enabled: input?.categories?.[category]?.enabled === true },
      ]),
    ) as AmbientAgentResourcesSettings["categories"],
    enablements: normalizeAmbientAgentResourceEnablements(input?.enablements),
  };
}

function normalizeAmbientAgentResourceEnablements(
  input: readonly unknown[] | undefined,
): AmbientAgentResourceEnablementRecord[] {
  const records = new Map<string, AmbientAgentResourceEnablementRecord>();
  for (const raw of input ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<AmbientAgentResourceEnablementRecord>;
    const id = normalizeIdentifier(candidate.id);
    const host = normalizeAmbientAgentResourceHost(candidate.host);
    const category = AMBIENT_AGENT_RESOURCE_CATEGORIES.includes(
      candidate.category as AmbientAgentResourcesSettings["enablements"][number]["category"],
    )
      ? candidate.category
      : null;
    const source = normalizeAmbientAgentResourceSource(candidate.source);
    const scope = normalizeAmbientAgentResourceScope(candidate.scope);
    const targets = normalizeAmbientAgentResourceTargets(candidate.targets);
    if (!id || !host || !category || !source || !scope || targets.length === 0) continue;
    records.set(id, {
      id,
      enabled: candidate.enabled === true,
      host,
      category,
      source,
      scope,
      targets,
    });
  }
  return [...records.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

function normalizeAmbientAgentResourceHost(input: unknown): AmbientAgentResourceHost | null {
  return input === "pi" || input === "codex" || input === "claude" || input === "other"
    ? input
    : null;
}

function normalizeAmbientAgentResourceSource(
  input: AmbientAgentResourceSource | undefined,
): AmbientAgentResourceSource | null {
  if (!input || typeof input !== "object") return null;
  const kind = input.kind;
  if (kind !== "global" && kind !== "workspace" && kind !== "path" && kind !== "package") {
    return null;
  }
  const id = normalizeIdentifier(input.id);
  if (!id) return null;
  const path = typeof input.path === "string" ? input.path.trim() : "";
  return path ? { kind, id, path } : { kind, id };
}

function normalizeAmbientAgentResourceScope(
  input: AmbientAgentResourceScope | undefined,
): AmbientAgentResourceScope | null {
  if (!input || typeof input !== "object") return null;
  if (input.kind === "app") {
    return { kind: "app" };
  }
  if (input.kind === "workspace") {
    const workspaceKey = normalizeIdentifier(input.workspaceKey);
    return workspaceKey ? { kind: "workspace", workspaceKey } : null;
  }
  return null;
}

function normalizeAmbientAgentResourceTargets(
  input: readonly AmbientAgentResourceTarget[] | undefined,
): AmbientAgentResourceTarget[] {
  const targets = new Map<string, AmbientAgentResourceTarget>();
  for (const target of input ?? []) {
    if (!target || typeof target !== "object") continue;
    const actor = DEFAULT_EXTERNAL_INSTRUCTION_ACTORS.includes(target.actor) ? target.actor : null;
    if (!actor) continue;
    const profileId =
      typeof target.profileId === "string" && target.profileId.trim()
        ? target.profileId.trim()
        : undefined;
    targets.set(`${actor}:${profileId ?? ""}`, profileId ? { actor, profileId } : { actor });
  }
  return [...targets.values()].toSorted(
    (left, right) =>
      left.actor.localeCompare(right.actor) ||
      (left.profileId ?? "").localeCompare(right.profileId ?? ""),
  );
}

function normalizeIdentifier(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeAppAppearance(input: string | null | undefined): AppAppearance {
  return input === "light" || input === "dark" || input === "system" ? input : "system";
}

function normalizeApprovalMode(input: string | null | undefined): ApprovalMode {
  return input === "auto-review" || input === "user" || input === "full-access"
    ? input
    : "auto-review";
}

function normalizePreferredExternalEditor(input: string): PreferredExternalEditor {
  if (
    input === "system" ||
    input === "code" ||
    input === "cursor" ||
    input === "zed" ||
    input === "sublime" ||
    input === "custom"
  ) {
    return input;
  }

  return "system";
}
