/**
 * Source of truth for reusable app-global Workflows authoring parameters.
 *
 * The build regenerates a prompt declaration from this module. Keep handler
 * guidance aligned with these exported types.
 */

export namespace Agents {
  export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  export type ReasoningSelection = {
    effort: ReasoningEffort;
  };

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
  export interface TaskAgentParametersSource {
    id: string;
    label: string;
    provider: string;
    model: string;
    reasoning: ReasoningSelection;
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
  export function defineTaskAgent<T extends TaskAgentParametersSource>(parameters: T): AgentLike {
    return {
      id: parameters.id,
      async generate() {
        throw new Error(
          "Agents.defineTaskAgent is available only from generated @svvyx/workflows.",
        );
      },
    };
  }
}
