import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export type ReasoningEffort = ThinkingLevel;
export type SessionMode = "orchestrator" | "quick";
export type SessionAgentKey = "defaultSession" | "quickSession" | "namer";
export type WorkflowAgentKey = "explorer" | "implementer" | "reviewer";

export interface AgentDefaults {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface SessionAgentSettings extends AgentDefaults {
  systemPrompt: string;
}

export interface SessionAgentDefaults {
  defaultSession: SessionAgentSettings;
  quickSession: SessionAgentSettings;
  namer: SessionAgentSettings;
}

export interface WorkflowAgentSettings extends SessionAgentSettings {
  id: WorkflowAgentKey;
  label: string;
  toolSurface: readonly ["execute_typescript"];
}

export interface AgentSettingsState {
  version: 1;
  sessionAgents: SessionAgentDefaults;
  workflowAgents: Record<WorkflowAgentKey, WorkflowAgentSettings>;
}

export const DEFAULT_AGENT_SETTINGS = {
  provider: "zai",
  model: "glm-5-turbo",
  reasoningEffort: "medium",
} satisfies AgentDefaults;

export const DEFAULT_ORCHESTRATOR_SESSION_PROMPT =
  "You are svvy, the main orchestrator. Own strategy, route bounded delegated work through handler threads, and make final user-facing decisions.";

export const DEFAULT_QUICK_SESSION_PROMPT =
  "You are svvy quick session. Answer or act directly for short, focused work without starting handler threads unless delegation is explicitly necessary.";

export const DEFAULT_NAMER_SESSION_PROMPT =
  [
    "you will generate a short title based on the first message a user begins a conversation with",
    "- ensure it is not more than 50 characters long",
    "- the title should be a summary of the user's message",
    "- it should be one line long",
    "- do not use quotes or colons",
    "- the entire text you return will be used as the title",
    "- never return anything that is more than one sentence (one line) long",
  ].join("\n");

export const DEFAULT_SESSION_AGENT_SETTINGS = {
  defaultSession: {
    ...DEFAULT_AGENT_SETTINGS,
    systemPrompt: DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
  },
  quickSession: {
    ...DEFAULT_AGENT_SETTINGS,
    systemPrompt: DEFAULT_QUICK_SESSION_PROMPT,
  },
  namer: {
    ...DEFAULT_AGENT_SETTINGS,
    provider: "openai-codex",
    model: "gpt-5.4-mini",
    reasoningEffort: "low",
    systemPrompt: DEFAULT_NAMER_SESSION_PROMPT,
  },
} satisfies SessionAgentDefaults;

export const DEFAULT_WORKFLOW_AGENT_SETTINGS = {
  explorer: {
    id: "explorer",
    label: "Explorer",
    ...DEFAULT_AGENT_SETTINGS,
    systemPrompt:
      "Inspect the repository and return concise findings, evidence, and unresolved questions. Do not edit files.",
    toolSurface: ["execute_typescript"],
  },
  implementer: {
    id: "implementer",
    label: "Implementer",
    ...DEFAULT_AGENT_SETTINGS,
    systemPrompt:
      "Implement the assigned scoped change, keep edits focused, and return changed files plus verification.",
    toolSurface: ["execute_typescript"],
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    ...DEFAULT_AGENT_SETTINGS,
    systemPrompt:
      "Review the assigned result for correctness, regressions, edge cases, and missing tests. Lead with findings.",
    toolSurface: ["execute_typescript"],
  },
} satisfies Record<WorkflowAgentKey, WorkflowAgentSettings>;

export const DEFAULT_AGENT_SETTINGS_STATE = {
  version: 1,
  sessionAgents: DEFAULT_SESSION_AGENT_SETTINGS,
  workflowAgents: DEFAULT_WORKFLOW_AGENT_SETTINGS,
} satisfies AgentSettingsState;
