import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Model, Usage } from "@mariozechner/pi-ai";
import { createContextBudget, type ContextBudget } from "@svvy/core";

export {
  createContextBudget,
  formatContextBudgetTooltip,
  getContextBudgetTone,
  type ContextBudget,
} from "@svvy/core";

export function buildContextBudgetFromUsage(
  usage: Pick<Usage, "input" | "output" | "cacheRead" | "cacheWrite"> | null | undefined,
  maxTokens: number | null | undefined,
): ContextBudget | null {
  if (!usage) return null;
  return createContextBudget({
    usedTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    maxTokens,
  });
}

export function getLatestAssistantUsage(
  messages: AgentMessage[],
): Pick<Usage, "input" | "output" | "cacheRead" | "cacheWrite"> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    const usage = message.usage;
    return {
      input: usage.input,
      output: usage.output,
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
  const latestUsage = getLatestAssistantUsage(messages);
  return latestUsage ? buildContextBudgetFromUsage(latestUsage, model?.contextWindow) : null;
}
