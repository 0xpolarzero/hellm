import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AMBIENT_AGENT_RESOURCE_CATEGORIES,
  DEFAULT_AGENT_SETTINGS_STATE,
  DEFAULT_ARTIFACT_DIRECTORY,
  DEFAULT_EXTERNAL_INSTRUCTION_ACTORS,
  normalizeExternalInstructionsSettings,
  type AgentSettingsState,
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
  type PreferredExternalEditor,
  type AgentPromptSettings,
} from "../shared/agent-settings";

export type AgentSettingsStore = {
  getState(): AgentSettingsState;
  setExtensionEnv(settings: ExtensionEnvSettings): AgentSettingsState;
  hydrateStateOwnedAppPreferences(preferences: AppPreferences): AgentSettingsState;
};

export function createAgentSettingsStore(input: { agentDir: string }): AgentSettingsStore {
  const settingsPath = join(input.agentDir, "agent-settings.json");
  let stateOwnedAppPreferencesOverlay: AppPreferences | null = null;

  const readState = (): AgentSettingsState => {
    const normalized = existsSync(settingsPath)
      ? normalizeAgentSettingsState(
          JSON.parse(readFileSync(settingsPath, "utf8")) as Partial<AgentSettingsState>,
        )
      : structuredClone(DEFAULT_AGENT_SETTINGS_STATE);
    return {
      ...normalized,
      appPreferences: stateOwnedAppPreferencesOverlay
        ? normalizeAppPreferences({
            ...normalized.appPreferences,
            ...stateOwnedAppPreferencesOverlay,
          })
        : normalized.appPreferences,
    };
  };

  const writeState = (state: AgentSettingsState): AgentSettingsState => {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  };

  return {
    getState: readState,
    setExtensionEnv: (settings) => {
      const state = readState();
      state.extensionEnv = normalizeExtensionEnvSettings(settings);
      return writeState(state);
    },
    hydrateStateOwnedAppPreferences: (preferences) => {
      stateOwnedAppPreferencesOverlay = normalizeAppPreferences(preferences);
      return readState();
    },
  };
}

export function normalizeAgentSettingsState(
  input: Partial<AgentSettingsState>,
): AgentSettingsState {
  const defaults = structuredClone(DEFAULT_AGENT_SETTINGS_STATE);

  return {
    version: 3,
    agents: {
      titleNamer: normalizeAgentPromptSettings({
        ...defaults.agents.titleNamer,
        ...input.agents?.titleNamer,
      }),
    },
    extensionEnv: normalizeExtensionEnvSettings({
      ...defaults.extensionEnv,
      ...input.extensionEnv,
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

function normalizeAgentPromptSettings(input: AgentPromptSettings): AgentPromptSettings {
  return {
    provider: requireNonEmpty(input.provider, "provider"),
    model: requireNonEmpty(input.model, "model"),
    reasoningEffort: input.reasoningEffort,
    systemPrompt: requireNonEmpty(input.systemPrompt, "systemPrompt"),
  };
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
    externalInstructions: normalizeExternalInstructionsSettings(input.externalInstructions),
    ambientAgentResources: normalizeAmbientAgentResources(input.ambientAgentResources),
  };
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
