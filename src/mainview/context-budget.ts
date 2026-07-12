import type {
  RendererConversationEntry,
  RendererTranscriptUsage,
} from "../shared/renderer-transcript";
import { createContextBudget, type ContextBudget } from "@svvy/core";

export {
  createContextBudget,
  formatContextBudgetTooltip,
  getContextBudgetTone,
  type ContextBudget,
} from "@svvy/core";

export function buildContextBudgetFromUsage(
  usage:
    | Pick<RendererTranscriptUsage, "input" | "output" | "cacheRead" | "cacheWrite">
    | null
    | undefined,
  maxTokens: number | null | undefined,
): ContextBudget | null {
  if (!usage) return null;
  return createContextBudget({
    usedTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    maxTokens,
  });
}

export function getLatestAssistantUsage(
  messages: RendererConversationEntry[],
): Pick<RendererTranscriptUsage, "input" | "output" | "cacheRead" | "cacheWrite"> | null {
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
  messages: RendererConversationEntry[],
  model: { contextWindow?: number } | null | undefined,
): ContextBudget | null {
  const latestUsage = getLatestAssistantUsage(messages);
  return latestUsage ? buildContextBudgetFromUsage(latestUsage, model?.contextWindow) : null;
}
