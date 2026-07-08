/**
 * Source of truth for reusable app-global Workflows authoring parameters.
 *
 * The build regenerates a prompt declaration for the `Agents` namespace exported
 * by generated `@svvyx/workflows`. It is available only in Smithers workflow
 * source-authoring contexts that may import `@svvyx/workflows`; it is not a
 * global runtime API and is not available inside `execute_typescript`.
 *
 * Keep handler guidance aligned with these exported types.
 */

export namespace Agents {
  export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  export type ReasoningSelection = {
    effort: ReasoningEffort;
  };

  /**
   * Extension ids whose workflow task-agent default usage may be overridden by
   * this reusable agent parameter record. In generated `@svvyx/workflows`
   * package output this corresponds to `ExtensionId` from `@svvyx/extensions`;
   * this prompt declaration remains ambient so it can be generated without
   * resolving workspace-local generated packages.
   */
  export type TaskAgentExtensionId = string;
  export type TaskAgentExtensionOverrideState = "loaded" | "available" | "unavailable";
  export type TaskAgentExtensionOverrides = {
    readonly [extensionId in TaskAgentExtensionId]?: TaskAgentExtensionOverrideState;
  };

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
    overrides?: TaskAgentExtensionOverrides;
  }

  export type AgentLike = {
    id?: string;
    tools?: Record<string, unknown>;
    supportsNativeStructuredOutput?: boolean;
    capabilities?: unknown;
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
