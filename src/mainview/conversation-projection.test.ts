import { describe, expect, it } from "bun:test";
import type {
  RendererCommandResultEntry,
  RendererConversationEntry,
  RendererTranscriptAssistantEntry,
  RendererTranscriptToolCallContent,
} from "../shared/renderer-transcript";
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

function userMessage(timestamp: number, text: string): RendererConversationEntry {
  return {
    role: "user",
    timestamp,
    content: [{ type: "text", text }],
  };
}

function toolCall(
  id: string,
  name: string,
  argumentsValue: Record<string, unknown>,
): RendererTranscriptToolCallContent {
  return {
    type: "tool-call",
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
    toolCalls?: RendererTranscriptToolCallContent[];
    usage?: ReturnType<typeof zeroUsage>;
  } = {},
): RendererTranscriptAssistantEntry {
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

function toolResultMessage(timestamp: number, text: string): RendererCommandResultEntry {
  return {
    role: "command-result",
    toolCallId: "tool-call-1",
    toolName: "exec_command",
    timestamp,
    isError: false,
    content: [{ type: "text", text }],
  };
}

describe("conversation projection", () => {
  it("projects committed rows, indexes, and summary stats in one pass", () => {
    const messages: RendererConversationEntry[] = [
      userMessage(1, "Hello"),
      assistantMessage(2, "First reply", {
        toolCalls: [toolCall("tool-call-1", "exec_command", { cmd: "cat docs/prd.md" })],
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
      name: "exec_command",
      argumentsValue: { cmd: "cat docs/prd.md" },
      attempt: 1,
      totalAttempts: 1,
    });
    expect(projection.toolCallsById.get("tool-call-2")).toEqual({
      id: "tool-call-2",
      name: "search",
      argumentsValue: { query: "svvy" },
      attempt: 1,
      totalAttempts: 1,
    });
    expect(projection.toolResultsById.get("tool-call-1")?.toolName).toBe("exec_command");
  });

  it("tracks repeated tool-use loops as numbered attempts within one retry chain", () => {
    const projection = projectConversation([
      userMessage(1, "Read the directory."),
      assistantMessage(2, "First try", {
        stopReason: "toolUse",
        toolCalls: [toolCall("tool-call-1", "execute_typescript", { typescriptCode: "first" })],
      }),
      {
        role: "command-result",
        toolCallId: "tool-call-1",
        toolName: "execute_typescript",
        timestamp: 3,
        isError: false,
        content: [{ type: "text", text: '{"success":false}' }],
      } satisfies RendererCommandResultEntry,
      assistantMessage(4, "Second try", {
        stopReason: "toolUse",
        toolCalls: [toolCall("tool-call-2", "execute_typescript", { typescriptCode: "second" })],
      }),
      {
        role: "command-result",
        toolCallId: "tool-call-2",
        toolName: "execute_typescript",
        timestamp: 5,
        isError: false,
        content: [{ type: "text", text: '{"success":true}' }],
      } satisfies RendererCommandResultEntry,
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
      "command-result",
    ]);
    expect(committed.toolResultsById.has("tool-call-1")).toBe(true);
  });

  it("keeps matched tool results indexed without rendering duplicate visible rows", () => {
    const projection = projectConversation([
      userMessage(1, "Run a command."),
      assistantMessage(2, "Running", {
        toolCalls: [toolCall("tool-call-1", "exec_command", { cmd: "pwd" })],
      }),
      toolResultMessage(3, "/tmp/project"),
    ]);

    expect(projection.visibleMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(projection.toolResultsById.get("tool-call-1")?.content[0]).toMatchObject({
      type: "text",
      text: "/tmp/project",
    });
  });
});
