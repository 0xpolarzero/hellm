import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import { buildSessionTranscriptExport } from "./session-transcript";

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
  options: {
    responseId?: string;
    errorMessage?: string;
    toolCalls?: ToolCall[];
  } = {},
): AssistantMessage {
  return {
    role: "assistant",
    timestamp,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o",
    responseId: options.responseId,
    usage: zeroUsage(),
    stopReason: "toolUse",
    errorMessage: options.errorMessage,
    content: [
      { type: "text", text: "I checked the workspace." },
      { type: "thinking", thinking: "Need to inspect the transcript path." },
      ...(options.toolCalls ?? []),
    ],
  };
}

function toolResultMessage(timestamp: number): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "tool-call-1",
    toolName: "repo.read",
    timestamp,
    isError: false,
    details: {
      path: "src/mainview/ChatWorkspace.svelte",
      lineCount: 200,
    },
    content: [{ type: "text", text: "Read 200 lines." }],
  };
}

describe("session transcript export", () => {
  it("includes raw assistant blocks, tool calls, and tool results", () => {
    const output = buildSessionTranscriptExport({
      session: {
        id: "session-123",
        title: "Transcript debug",
        status: "idle",
        createdAt: "2026-04-15T08:00:00.000Z",
        updatedAt: "2026-04-15T08:10:00.000Z",
      },
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "medium",
      systemPrompt: "You are svvy.",
      messages: [
        userMessage(1, "Trace the bug."),
        assistantMessage(2, {
          responseId: "resp_123",
          toolCalls: [
            toolCall("tool-call-1", "repo.read", { path: "src/mainview/ChatWorkspace.svelte" }),
          ],
        }),
        toolResultMessage(3),
      ],
    });

    expect(output).toContain("# svvy transcript export");
    expect(output).toContain("id: session-123");
    expect(output).toContain("### [1] user @ 1970-01-01T00:00:00.001Z");
    expect(output).toContain("### [2] assistant @ 1970-01-01T00:00:00.002Z");
    expect(output).toContain("responseId: resp_123");
    expect(output).toContain("Need to inspect the transcript path.");
    expect(output).toContain("toolCall[3]: repo.read (tool-call-1)");
    expect(output).toContain('"path": "src/mainview/ChatWorkspace.svelte"');
    expect(output).toContain("### [3] tool result @ 1970-01-01T00:00:00.003Z");
    expect(output).toContain('"lineCount": 200');
  });

  it("emits a separate section for the streaming assistant snapshot", () => {
    const output = buildSessionTranscriptExport({
      session: {
        id: "session-456",
        title: "Streaming debug",
        status: "running",
        createdAt: "2026-04-15T08:00:00.000Z",
        updatedAt: "2026-04-15T08:10:00.000Z",
      },
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "high",
      systemPrompt: "",
      messages: [],
      streamMessage: assistantMessage(4, {
        errorMessage: "Still streaming",
      }),
    });

    expect(output).toContain("streamingMessage: present");
    expect(output).toContain("## committed transcript");
    expect(output).toContain("(empty)");
    expect(output).toContain("## streaming assistant snapshot");
    expect(output).toContain("### [streaming] assistant @ 1970-01-01T00:00:00.004Z");
    expect(output).toContain("errorMessage: Still streaming");
  });

  it("annotates repeated tool-use loops with attempt numbers", () => {
    const output = buildSessionTranscriptExport({
      session: {
        id: "session-789",
        title: "Retry debug",
        status: "idle",
        createdAt: "2026-04-15T08:00:00.000Z",
        updatedAt: "2026-04-15T08:10:00.000Z",
      },
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "medium",
      systemPrompt: "You are svvy.",
      messages: [
        userMessage(1, "Inspect the directory."),
        {
          ...assistantMessage(2, {
            toolCalls: [toolCall("tool-call-1", "execute_typescript", { typescriptCode: "first" })],
          }),
          stopReason: "toolUse",
        },
        {
          role: "toolResult",
          toolCallId: "tool-call-1",
          toolName: "execute_typescript",
          timestamp: 3,
          isError: false,
          content: [{ type: "text", text: '{"success":false}' }],
        } satisfies ToolResultMessage,
        {
          ...assistantMessage(4, {
            toolCalls: [
              toolCall("tool-call-2", "execute_typescript", { typescriptCode: "second" }),
            ],
          }),
          stopReason: "toolUse",
        },
      ],
    });

    expect(output).toContain("toolCall[3]: execute_typescript (tool-call-1) [attempt 1/2]");
    expect(output).toContain("toolCall[3]: execute_typescript (tool-call-2) [attempt 2/2]");
  });
});
