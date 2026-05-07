import { DEFAULT_AGENT_SETTINGS } from "../../shared/agent-settings";
import { WORKFLOW_TASK_SYSTEM_PROMPT } from "../default-system-prompt";
import type { WorkflowTaskAgentConfig } from "./workflow-authoring-contract";
export type { WorkflowTaskAgentConfig } from "./workflow-authoring-contract";

export function createDefaultWorkflowTaskAgentConfig(
  input: Partial<Pick<WorkflowTaskAgentConfig, "provider" | "model" | "thinkingLevel">> = {},
): WorkflowTaskAgentConfig {
  return {
    provider: input.provider ?? DEFAULT_AGENT_SETTINGS.provider,
    model: input.model ?? DEFAULT_AGENT_SETTINGS.model,
    thinkingLevel: input.thinkingLevel ?? DEFAULT_AGENT_SETTINGS.reasoningEffort,
    systemPrompt: WORKFLOW_TASK_SYSTEM_PROMPT,
    toolSurface: [
      "read",
      "grep",
      "find",
      "ls",
      "edit",
      "write",
      "bash",
      "artifact.write_text",
      "artifact.write_json",
      "artifact.attach_file",
      "web.search",
      "web.fetch",
      "execute_typescript",
    ],
  };
}
