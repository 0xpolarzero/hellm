import { DEFAULT_CHAT_SETTINGS } from "../../mainview/chat-settings";
import { WORKFLOW_TASK_SYSTEM_PROMPT } from "../default-system-prompt";
import type { WorkflowTaskAgentProfile } from "./workflow-authoring-contract";
export type { WorkflowTaskAgentProfile } from "./workflow-authoring-contract";

export function createDefaultWorkflowTaskAgentProfile(
  input: Partial<Pick<WorkflowTaskAgentProfile, "provider" | "model" | "thinkingLevel">> = {},
): WorkflowTaskAgentProfile {
  return {
    provider: input.provider ?? DEFAULT_CHAT_SETTINGS.provider,
    model: input.model ?? DEFAULT_CHAT_SETTINGS.model,
    thinkingLevel: input.thinkingLevel ?? DEFAULT_CHAT_SETTINGS.reasoningEffort,
    systemPrompt: WORKFLOW_TASK_SYSTEM_PROMPT,
    toolSurface: ["execute_typescript"],
  };
}
