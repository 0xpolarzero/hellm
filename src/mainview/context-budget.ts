import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Model, Usage } from "@mariozechner/pi-ai";
import { createContextBudget, type ContextBudget } from "../shared/context-budget";

export {
  createContextBudget,
  getContextBudgetTone,
  type ContextBudget,
} from "../shared/context-budget";

export function buildContextBudgetFromUsage(
  usage: Pick<Usage, "input" | "cacheRead" | "cacheWrite"> | null | undefined,
  maxTokens: number | null | undefined,
): ContextBudget | null {
  if (!usage) return null;
  return createContextBudget({
    usedTokens: usage.input,
    maxTokens,
  });
}

export function getLatestAssistantUsage(
  messages: AgentMessage[],
): Pick<Usage, "input" | "cacheRead" | "cacheWrite"> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    const usage = message.usage;
    return {
      input: usage.input,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
    };
  }
  return null;
}

export function buildSurfaceContextBudget(
  messages: AgentMessage[],
  model: Pick<Model<any>, "contextWindow"> | null | undefined,
): ContextBudget | null {
  return buildContextBudgetFromUsage(getLatestAssistantUsage(messages), model?.contextWindow);
}
