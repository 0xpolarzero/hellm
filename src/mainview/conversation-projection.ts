import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage, Usage } from "@mariozechner/pi-ai";
import { parseArtifactsParams, type ArtifactsParams } from "./artifacts";
import { getLatestAssistantUsage } from "./context-budget";

export interface ProjectedToolCall {
  id: string;
  name: string;
  argumentsValue: ToolCall["arguments"];
  artifactParams?: ArtifactsParams;
  attempt: number;
  totalAttempts: number;
}

export interface ConversationProjection {
  visibleMessages: AgentMessage[];
  toolCallsById: Map<string, ProjectedToolCall>;
  artifactResultTextById: Map<string, string>;
  toolResultsById: Map<string, ToolResultMessage>;
  usage: Usage;
  latestContextUsage: Pick<Usage, "input" | "cacheRead" | "cacheWrite"> | null;
  messageCount: number;
  toolCallCount: number;
  lastActivity: number | null;
}

export interface ConversationSummary {
  usage: Usage;
  latestContextUsage: Pick<Usage, "input" | "cacheRead" | "cacheWrite"> | null;
  messageCount: number;
  toolCallCount: number;
  lastActivity: number | null;
}

function createUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function addUsage(total: Usage, usage: Usage): void {
  total.input += usage.input;
  total.output += usage.output;
  total.cacheRead += usage.cacheRead;
  total.cacheWrite += usage.cacheWrite;
  total.totalTokens += usage.totalTokens;
  total.cost.input += usage.cost.input;
  total.cost.output += usage.cost.output;
  total.cost.cacheRead += usage.cost.cacheRead;
  total.cost.cacheWrite += usage.cost.cacheWrite;
  total.cost.total += usage.cost.total;
}

function toolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function countToolCalls(message: AssistantMessage | null | undefined): number {
  if (!message) return 0;
  return message.content.filter((block) => block.type === "toolCall").length;
}

function retryKey(chainId: number, toolName: string): string {
  return `${chainId}:${toolName}`;
}

export function projectConversation(messages: AgentMessage[]): ConversationProjection {
  const visibleMessages: AgentMessage[] = [];
  const toolCallsById = new Map<string, ProjectedToolCall>();
  const artifactResultTextById = new Map<string, string>();
  const toolResultsById = new Map<string, ToolResultMessage>();
  const usage = createUsage();
  const retryAttemptByKey = new Map<string, number>();
  const retryKeyByToolCallId = new Map<string, string>();
  const retryTotalByKey = new Map<string, number>();
  let messageCount = 0;
  let toolCallCount = 0;
  let lastActivity: number | null = null;
  let retryChainId = 0;

  const resetRetryChain = () => {
    retryAttemptByKey.clear();
    retryChainId += 1;
  };

  resetRetryChain();

  for (const message of messages) {
    if (message.role === "user") {
      visibleMessages.push(message);
      messageCount += 1;
      lastActivity = message.timestamp;
      resetRetryChain();
      continue;
    }

    if (message.role === "assistant") {
      visibleMessages.push(message);
      messageCount += 1;
      lastActivity = message.timestamp;
      addUsage(usage, message.usage);

      const toolCalls = message.content.filter(
        (block): block is ToolCall => block.type === "toolCall",
      );
      const toolNamesSeenInMessage = new Set<string>();

      for (const block of toolCalls) {
        toolCallCount += 1;
        const key = retryKey(retryChainId, block.name);
        const attempt = toolNamesSeenInMessage.has(block.name)
          ? (retryAttemptByKey.get(key) ?? 1)
          : (retryAttemptByKey.get(key) ?? 0) + 1;
        retryAttemptByKey.set(key, attempt);
        retryKeyByToolCallId.set(block.id, key);
        retryTotalByKey.set(key, attempt);
        toolNamesSeenInMessage.add(block.name);
        const artifactParams =
          block.name === "artifacts" ? parseArtifactsParams(block.arguments) : undefined;

        toolCallsById.set(block.id, {
          id: block.id,
          name: block.name,
          argumentsValue: block.arguments,
          artifactParams: artifactParams ?? undefined,
          attempt,
          totalAttempts: 1,
        });
      }

      if (message.stopReason !== "toolUse") {
        resetRetryChain();
      }

      continue;
    }

    if (message.role === "toolResult") {
      visibleMessages.push(message);
      lastActivity = message.timestamp;
      toolResultsById.set(message.toolCallId, message);

      if (message.toolName === "artifacts") {
        artifactResultTextById.set(message.toolCallId, toolResultText(message));
      }
    }
  }

  for (const toolCall of toolCallsById.values()) {
    const totalAttempts =
      retryTotalByKey.get(retryKeyByToolCallId.get(toolCall.id) ?? "") ?? toolCall.totalAttempts;
    toolCall.totalAttempts = totalAttempts;
  }

  return {
    visibleMessages,
    toolCallsById,
    artifactResultTextById,
    toolResultsById,
    usage,
    latestContextUsage: getLatestAssistantUsage(messages),
    messageCount,
    toolCallCount,
    lastActivity,
  };
}

export function projectConversationSummary(
  committed: ConversationProjection,
  streamMessage?: AssistantMessage | null,
): ConversationSummary {
  return {
    usage: committed.usage,
    latestContextUsage: committed.latestContextUsage,
    messageCount: committed.messageCount + (streamMessage ? 1 : 0),
    toolCallCount: committed.toolCallCount + countToolCalls(streamMessage),
    lastActivity: committed.lastActivity,
  };
}
