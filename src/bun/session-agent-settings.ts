import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_AGENT_SETTINGS_STATE,
  type AgentSettingsState,
  type SessionAgentDefaults,
  type SessionAgentKey,
  type SessionAgentSettings,
  type WorkflowAgentKey,
  type WorkflowAgentSettings,
} from "../shared/agent-settings";

export type SessionAgentSettingsStore = {
  getState(): AgentSettingsState;
  setSessionAgentDefault(key: SessionAgentKey, settings: SessionAgentSettings): AgentSettingsState;
  setWorkflowAgent(key: WorkflowAgentKey, settings: WorkflowAgentSettings): AgentSettingsState;
  ensureWorkflowAgentsComponent(): string;
};

export function createSessionAgentSettingsStore(input: {
  cwd: string;
  agentDir: string;
}): SessionAgentSettingsStore {
  const settingsPath = join(input.agentDir, "session-agent-settings.json");
  const workflowAgentsPath = join(input.cwd, ".svvy", "workflows", "components", "agents.ts");

  const readState = (): AgentSettingsState => {
    if (!existsSync(settingsPath)) {
      return structuredClone(DEFAULT_AGENT_SETTINGS_STATE);
    }
    const raw = JSON.parse(readFileSync(settingsPath, "utf8")) as Partial<AgentSettingsState>;
    return normalizeAgentSettingsState(raw);
  };

  const writeState = (state: AgentSettingsState): AgentSettingsState => {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  };

  const writeWorkflowAgents = (state: AgentSettingsState): string => {
    mkdirSync(dirname(workflowAgentsPath), { recursive: true });
    writeFileSync(workflowAgentsPath, renderWorkflowAgentsComponent(state.workflowAgents));
    return workflowAgentsPath;
  };

  return {
    getState: readState,
    setSessionAgentDefault: (key, settings) => {
      const state = readState();
      state.sessionAgents[key] = normalizeSessionAgentSettings(settings);
      return writeState(state);
    },
    setWorkflowAgent: (key, settings) => {
      const state = readState();
      state.workflowAgents[key] = normalizeWorkflowAgentSettings(key, settings);
      writeState(state);
      writeWorkflowAgents(state);
      return state;
    },
    ensureWorkflowAgentsComponent: () => writeWorkflowAgents(readState()),
  };
}

export function normalizeAgentSettingsState(
  input: Partial<AgentSettingsState>,
): AgentSettingsState {
  const defaults = structuredClone(DEFAULT_AGENT_SETTINGS_STATE);
  const sessionAgents = (input.sessionAgents ?? {}) as Partial<AgentSettingsState["sessionAgents"]>;
  const workflowAgents = (input.workflowAgents ?? {}) as Partial<
    AgentSettingsState["workflowAgents"]
  >;
  return {
    version: 1,
    sessionAgents: {
      defaultSession: normalizeSessionAgentSettings({
        ...defaults.sessionAgents.defaultSession,
        ...sessionAgents.defaultSession,
      }),
      quickSession: normalizeSessionAgentSettings({
        ...defaults.sessionAgents.quickSession,
        ...sessionAgents.quickSession,
      }),
    } satisfies SessionAgentDefaults,
    workflowAgents: {
      explorer: normalizeWorkflowAgentSettings("explorer", {
        ...defaults.workflowAgents.explorer,
        ...workflowAgents.explorer,
      }),
      implementer: normalizeWorkflowAgentSettings("implementer", {
        ...defaults.workflowAgents.implementer,
        ...workflowAgents.implementer,
      }),
      reviewer: normalizeWorkflowAgentSettings("reviewer", {
        ...defaults.workflowAgents.reviewer,
        ...workflowAgents.reviewer,
      }),
    },
  };
}

export function renderWorkflowAgentsComponent(
  agents: Record<WorkflowAgentKey, WorkflowAgentSettings>,
): string {
  const lines = [
    "/**",
    " * @svvyAssetKind component",
    " * @svvyId workflow_agents",
    " * @svvyTitle Workflow Agents",
    " * @svvySummary Conventional explorer, implementer, and reviewer agents for Smithers workflows.",
    " */",
    "",
    "export type WorkflowAgentComponent = {",
    "  id: string;",
    "  label: string;",
    "  provider: string;",
    "  model: string;",
    "  reasoningEffort: string;",
    "  systemPrompt: string;",
    "  toolSurface: readonly ['execute_typescript'];",
    "};",
    "",
  ];
  for (const key of ["explorer", "implementer", "reviewer"] as const) {
    const agent = agents[key];
    lines.push(
      `export const ${key}: WorkflowAgentComponent = ${JSON.stringify(agent, null, 2)};`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function normalizeSessionAgentSettings(input: SessionAgentSettings): SessionAgentSettings {
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
  return {
    id: key,
    label: requireNonEmpty(input.label, "label"),
    ...normalizeSessionAgentSettings(input),
    toolSurface: ["execute_typescript"],
  };
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Expected non-empty ${label}.`);
  }
  return trimmed;
}
