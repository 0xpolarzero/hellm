import type {
  RendererConversationEntry,
  RendererTranscriptAssistantEntry,
  RendererTranscriptToolCallContent,
  RendererCommandResultEntry,
  RendererTranscriptUsage,
} from "../shared/renderer-transcript";
import { getLatestAssistantUsage } from "./context-budget";

export interface ProjectedToolCall {
  id: string;
  name: string;
  argumentsValue: RendererTranscriptToolCallContent["arguments"];
  attempt: number;
  totalAttempts: number;
}

export interface ConversationProjection {
  visibleMessages: RendererConversationEntry[];
  toolCallsById: Map<string, ProjectedToolCall>;
  toolResultsById: Map<string, RendererCommandResultEntry>;
  usage: RendererTranscriptUsage;
  latestContextUsage: Pick<
    RendererTranscriptUsage,
    "input" | "output" | "cacheRead" | "cacheWrite"
  > | null;
  messageCount: number;
  toolCallCount: number;
  lastActivity: number | null;
}

export interface ConversationSummary {
  usage: RendererTranscriptUsage;
  latestContextUsage: Pick<
    RendererTranscriptUsage,
    "input" | "output" | "cacheRead" | "cacheWrite"
  > | null;
  messageCount: number;
  toolCallCount: number;
  lastActivity: number | null;
}

function createUsage(): RendererTranscriptUsage {
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

function addUsage(total: RendererTranscriptUsage, usage: RendererTranscriptUsage): void {
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

function countToolCalls(message: RendererTranscriptAssistantEntry | null | undefined): number {
  if (!message) return 0;
  return message.content.filter((block) => block.type === "tool-call").length;
}

function retryKey(chainId: number, toolName: string): string {
  return `${chainId}:${toolName}`;
}

export function projectConversation(messages: RendererConversationEntry[]): ConversationProjection {
  const visibleMessages: RendererConversationEntry[] = [];
  const toolCallsById = new Map<string, ProjectedToolCall>();
  const toolResultsById = new Map<string, RendererCommandResultEntry>();
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
        (block): block is RendererTranscriptToolCallContent => block.type === "tool-call",
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
        toolCallsById.set(block.id, {
          id: block.id,
          name: block.name,
          argumentsValue: block.arguments,
          attempt,
          totalAttempts: 1,
        });
      }

      if (message.stopReason !== "toolUse") {
        resetRetryChain();
      }

      continue;
    }

    if (message.role === "command-result") {
      if (!toolCallsById.has(message.toolCallId)) {
        visibleMessages.push(message);
      }
      lastActivity = message.timestamp;
      toolResultsById.set(message.toolCallId, message);
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
  streamMessage?: RendererTranscriptAssistantEntry | null,
): ConversationSummary {
  return {
    usage: committed.usage,
    latestContextUsage: committed.latestContextUsage,
    messageCount: committed.messageCount + (streamMessage ? 1 : 0),
    toolCallCount: committed.toolCallCount + countToolCalls(streamMessage),
    lastActivity: committed.lastActivity,
  };
}
