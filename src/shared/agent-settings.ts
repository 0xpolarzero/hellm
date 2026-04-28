import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export type ReasoningEffort = ThinkingLevel;

export interface AgentDefaults {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

export const DEFAULT_AGENT_SETTINGS: AgentDefaults = {
  provider: "zai",
  model: "glm-5-turbo",
  reasoningEffort: "medium",
};
