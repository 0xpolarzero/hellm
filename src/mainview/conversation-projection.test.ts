import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import { projectConversation, projectConversationSummary } from "./conversation-projection";

function zeroUsage() {
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

function userMessage(timestamp: number, text: string): AgentMessage {
  return {
    role: "user",
    timestamp,
    content: [{ type: "text", text }],
  };
}

function toolCall(id: string, name: string, argumentsValue: Record<string, unknown>): ToolCall {
  return {
    type: "toolCall",
    id,
    name,
    arguments: argumentsValue,
  };
}

function assistantMessage(
  timestamp: number,
  text: string,
  options: {
    stopReason?: "stop" | "toolUse";
    toolCalls?: ToolCall[];
    usage?: ReturnType<typeof zeroUsage>;
  } = {},
): AssistantMessage {
  return {
    role: "assistant",
    timestamp,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o",
    usage: options.usage ?? {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        total: 10,
      },
    },
    stopReason: options.stopReason ?? "stop",
    content: [{ type: "text", text }, ...(options.toolCalls ?? [])],
  };
}

function toolResultMessage(timestamp: number, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "tool-call-1",
    toolName: "artifacts",
    timestamp,
    isError: false,
    content: [{ type: "text", text }],
  };
}

describe("conversation projection", () => {
  it("projects committed rows, indexes, and summary stats in one pass", () => {
    const messages: AgentMessage[] = [
      userMessage(1, "Hello"),
      assistantMessage(2, "First reply", {
        toolCalls: [
          toolCall("tool-call-1", "artifacts", { command: "create", filename: "summary.html" }),
        ],
      }),
      toolResultMessage(3, "Created file summary.html"),
      assistantMessage(4, "Second reply", {
        toolCalls: [toolCall("tool-call-2", "search", { query: "svvy" })],
      }),
    ];

    const projection = projectConversation(messages);

    expect(projection.visibleMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(projection.messageCount).toBe(3);
    expect(projection.toolCallCount).toBe(2);
    expect(projection.lastActivity).toBe(4);
    expect(projection.usage).toEqual({
      input: 2,
      output: 4,
      cacheRead: 6,
      cacheWrite: 8,
      totalTokens: 20,
      cost: {
        input: 2,
        output: 4,
        cacheRead: 6,
        cacheWrite: 8,
        total: 20,
      },
    });
    expect(projection.toolCallsById.get("tool-call-1")).toEqual({
      id: "tool-call-1",
      name: "artifacts",
      argumentsValue: { command: "create", filename: "summary.html" },
      artifactParams: {
        command: "create",
        filename: "summary.html",
      },
      attempt: 1,
      totalAttempts: 1,
    });
    expect(projection.toolCallsById.get("tool-call-2")).toEqual({
      id: "tool-call-2",
      name: "search",
      argumentsValue: { query: "svvy" },
      artifactParams: undefined,
      attempt: 1,
      totalAttempts: 1,
    });
    expect(projection.toolResultsById.get("tool-call-1")?.toolName).toBe("artifacts");
    expect(projection.artifactResultTextById.get("tool-call-1")).toBe("Created file summary.html");
  });

  it("tracks repeated tool-use loops as numbered attempts within one retry chain", () => {
    const projection = projectConversation([
      userMessage(1, "Read the directory."),
      assistantMessage(2, "First try", {
        stopReason: "toolUse",
        toolCalls: [toolCall("tool-call-1", "execute_typescript", { typescriptCode: "first" })],
      }),
      {
        role: "toolResult",
        toolCallId: "tool-call-1",
        toolName: "execute_typescript",
        timestamp: 3,
        isError: false,
        content: [{ type: "text", text: '{"success":false}' }],
      } satisfies ToolResultMessage,
      assistantMessage(4, "Second try", {
        stopReason: "toolUse",
        toolCalls: [toolCall("tool-call-2", "execute_typescript", { typescriptCode: "second" })],
      }),
      {
        role: "toolResult",
        toolCallId: "tool-call-2",
        toolName: "execute_typescript",
        timestamp: 5,
        isError: false,
        content: [{ type: "text", text: '{"success":true}' }],
      } satisfies ToolResultMessage,
      assistantMessage(6, "Final answer"),
    ]);

    expect(projection.toolCallsById.get("tool-call-1")).toMatchObject({
      attempt: 1,
      totalAttempts: 2,
    });
    expect(projection.toolCallsById.get("tool-call-2")).toMatchObject({
      attempt: 2,
      totalAttempts: 2,
    });
  });

  it("keeps committed indexes stable when streaming only changes", () => {
    const committed = projectConversation([
      userMessage(1, "Hello"),
      assistantMessage(2, "First reply"),
      toolResultMessage(3, "Created file summary.html"),
    ]);
    const streamMessage = assistantMessage(4, "Streaming reply", {
      toolCalls: [
        toolCall("tool-call-3", "artifacts", { command: "update", filename: "summary.html" }),
      ],
    });

    const summary = projectConversationSummary(committed, streamMessage);

    expect(committed.messageCount).toBe(2);
    expect(committed.toolCallCount).toBe(0);
    expect(summary.usage).toBe(committed.usage);
    expect(summary.messageCount).toBe(3);
    expect(summary.toolCallCount).toBe(1);
    expect(summary.lastActivity).toBe(3);
    expect(committed.visibleMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    expect(committed.toolResultsById.has("tool-call-1")).toBe(true);
  });
});
