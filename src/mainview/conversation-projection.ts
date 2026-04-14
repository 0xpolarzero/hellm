import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@mariozechner/pi-ai";
import { parseArtifactsParams, type ArtifactsParams } from "./artifacts";

export interface ConversationProjection {
  visibleMessages: AgentMessage[];
  toolCallsById: Map<string, ArtifactsParams>;
  artifactResultTextById: Map<string, string>;
  toolResultsById: Map<string, ToolResultMessage>;
  usage: Usage;
  messageCount: number;
  toolCallCount: number;
  lastActivity: number | null;
}

export interface ConversationSummary {
  usage: Usage;
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

export function projectConversation(messages: AgentMessage[]): ConversationProjection {
  const visibleMessages: AgentMessage[] = [];
  const toolCallsById = new Map<string, ArtifactsParams>();
  const artifactResultTextById = new Map<string, string>();
  const toolResultsById = new Map<string, ToolResultMessage>();
  const usage = createUsage();
  let messageCount = 0;
  let toolCallCount = 0;
  let lastActivity: number | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      visibleMessages.push(message);
      messageCount += 1;
      lastActivity = message.timestamp;
      continue;
    }

    if (message.role === "assistant") {
      visibleMessages.push(message);
      messageCount += 1;
      lastActivity = message.timestamp;
      addUsage(usage, message.usage);

      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        toolCallCount += 1;
        if (block.name !== "artifacts") continue;

        const params = parseArtifactsParams(block.arguments);
        if (params) {
          toolCallsById.set(block.id, params);
        }
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

  return {
    visibleMessages,
    toolCallsById,
    artifactResultTextById,
    toolResultsById,
    usage,
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
    messageCount: committed.messageCount + (streamMessage ? 1 : 0),
    toolCallCount: committed.toolCallCount + countToolCalls(streamMessage),
    lastActivity: committed.lastActivity,
  };
}
