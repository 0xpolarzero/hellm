/**
 * Source of truth for reusable app-global Workflows authoring parameters.
 *
 * The build regenerates a prompt declaration from this module. Keep handler
 * guidance aligned with these exported types.
 */

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export namespace Agents {
  export type ReasoningEffort = ThinkingLevel;

  /**
   * Extension ids whose workflow task-agent default usage may be overridden by
   * this reusable agent parameter record.
   */
  export type TaskAgentExtensionId = string;
  export type TaskAgentExtensionOverrideState = "loaded" | "available" | "unavailable";

  /**
   * Reusable app-global agent parameter record. These records are data that
   * handler-authored Workflows source may import or copy when configuring
   * Smithers agents through official Smithers APIs.
   */
  export interface TaskAgentParameters {
    id: string;
    label: string;
    provider: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    instructions: string;
    overrides?: Record<TaskAgentExtensionId, TaskAgentExtensionOverrideState>;
  }

  export type AgentLike = {
    id?: string;
    generate: (args: unknown) => Promise<unknown>;
  };

  /**
   * Adapter for using reusable app-global agent parameter records as Smithers
   * task agents.
   */
  export function defineTaskAgent<T extends TaskAgentParameters>(parameters: T): AgentLike {
    return {
      id: parameters.id,
      async generate() {
        throw new Error("Agents.defineTaskAgent is available only from generated @svvy/workflows.");
      },
    };
  }
}
