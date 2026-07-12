import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";
import {
  CommitRuntimeTranscriptAssistantMessageInputSchema,
  CommitRuntimeTranscriptUserMessageInputSchema,
  RuntimeSurfaceTranscriptSnapshotSchema,
  RuntimeTranscriptAssistantMessageSchema,
  RuntimeTranscriptUserMessageSchema,
  strictBoundaryParseOptions,
} from "./index";

const timestamp = "2026-07-11T12:34:56.789Z";

describe("@svvy/core transcript contracts", () => {
  it("preserves a committed user message and its submission provenance", () => {
    const decoded = Schema.decodeUnknownSync(
      RuntimeTranscriptUserMessageSchema,
      strictBoundaryParseOptions,
    )({
      role: "user",
      messageId: "message_user_01",
      workspaceSessionId: "session_01",
      surfacePiSessionId: "surface_01",
      turnId: "turn_01",
      ordinal: 0,
      queueItemId: "queue_01",
      message: {
        text: "Inspect @src/main.ts",
        attachments: [
          {
            kind: "file",
            path: "/workspace/src/main.ts",
            workspaceRelativePath: "src/main.ts",
          },
        ],
        snippetProvenance: [
          {
            mentionId: "mention_01",
            snippetId: "snippet_01",
            source: "svvy",
            title: "Inspect",
            contentHash: "sha256:01",
            arguments: ["src/main.ts"],
            resolvedText: "Inspect src/main.ts",
          },
        ],
      },
      piHistoryEntry: {
        session: { surfacePiSessionId: "surface_01" },
        entryId: "pi_entry_user_01",
        messageId: "message_user_01",
      },
      submittedAt: timestamp,
      committedAt: timestamp,
    });

    expect(decoded.message.attachments?.[0]?.kind).toBe("file");
    expect(decoded.message.snippetProvenance?.[0]?.resolvedText).toBe("Inspect src/main.ts");
    expect(decoded.piHistoryEntry?.entryId).toBe("pi_entry_user_01");
  });

  it("preserves ordered assistant text, thinking, tool-call linkage, and provider facts", () => {
    const decoded = Schema.decodeUnknownSync(
      RuntimeTranscriptAssistantMessageSchema,
      strictBoundaryParseOptions,
    )({
      role: "assistant",
      messageId: "message_assistant_01",
      workspaceSessionId: "session_01",
      surfacePiSessionId: "surface_01",
      turnId: "turn_01",
      ordinal: 1,
      status: "completed",
      content: [
        {
          kind: "thinking",
          contentIndex: 0,
          thinking: "Check the file.",
          redacted: false,
          thinkingSignature: "thinking_signature_01",
        },
        {
          kind: "tool-call",
          contentIndex: 1,
          toolCallId: "tool_call_01",
          toolName: "read_file",
          argumentsJson: '{"path":"src/main.ts"}',
          argumentsStatus: "accepted",
          commandId: "command_01",
          thoughtSignature: "tool_signature_01",
        },
        { kind: "text", contentIndex: 2, text: "The file is valid." },
      ],
      api: "openai-responses",
      providerId: "openai",
      modelId: "gpt-5",
      responseId: "response_01",
      usage: {
        input: 100,
        output: 20,
        cacheRead: 50,
        cacheWrite: 0,
        totalTokens: 120,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0, total: 0.31 },
      },
      stopReason: "stop",
      errorMessage: null,
      piHistoryEntry: {
        session: { surfacePiSessionId: "surface_01" },
        entryId: "pi_entry_assistant_01",
        messageId: "message_assistant_01",
      },
      startedAt: timestamp,
      messageTimestamp: timestamp,
      updatedAt: timestamp,
      finishedAt: timestamp,
    });

    expect(decoded.content.map((block) => block.kind)).toEqual(["thinking", "tool-call", "text"]);
    expect(decoded.usage?.totalTokens).toBe(120);
    expect(decoded.responseId).toBe("response_01");
  });

  it("rejects unordered content, negative usage, and unknown transcript fields", () => {
    const base = {
      role: "assistant",
      messageId: "message_assistant_01",
      workspaceSessionId: "session_01",
      surfacePiSessionId: "surface_01",
      turnId: "turn_01",
      ordinal: 1,
      status: "completed",
      api: null,
      providerId: "openai",
      modelId: "gpt-5",
      responseId: null,
      usage: null,
      stopReason: "stop",
      errorMessage: null,
      piHistoryEntry: null,
      startedAt: timestamp,
      messageTimestamp: timestamp,
      updatedAt: timestamp,
      finishedAt: timestamp,
    };

    expect(() =>
      Schema.decodeUnknownSync(
        RuntimeTranscriptAssistantMessageSchema,
        strictBoundaryParseOptions,
      )({
        ...base,
        content: [
          { kind: "text", contentIndex: 1, text: "later" },
          { kind: "text", contentIndex: 0, text: "earlier" },
        ],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(
        RuntimeTranscriptAssistantMessageSchema,
        strictBoundaryParseOptions,
      )({
        ...base,
        content: [],
        usage: {
          input: -1,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(
        RuntimeTranscriptAssistantMessageSchema,
        strictBoundaryParseOptions,
      )({
        ...base,
        content: [],
        piNativeMessage: {},
      }),
    ).toThrow();
  });

  it("decodes mutation inputs and a mid-stream surface snapshot with one durable cursor", () => {
    const expectedCursor = {
      surfacePiSessionId: "surface_01",
      streamGenerationId: "stream_turn_01",
      streamSequence: 3,
    };
    const userInput = Schema.decodeUnknownSync(
      CommitRuntimeTranscriptUserMessageInputSchema,
      strictBoundaryParseOptions,
    )({
      workspaceSessionId: "session_01",
      surfacePiSessionId: "surface_01",
      turnId: "turn_01",
      queueItemId: "queue_01",
      message: { text: "hello" },
      submittedAt: timestamp,
      committedAt: timestamp,
      streamGenerationId: "stream_turn_01",
      expectedCursor: null,
    });
    const terminalInput = Schema.decodeUnknownSync(
      CommitRuntimeTranscriptAssistantMessageInputSchema,
      strictBoundaryParseOptions,
    )({
      messageId: "message_assistant_01",
      surfacePiSessionId: "surface_01",
      streamGenerationId: "stream_turn_01",
      expectedCursor,
      content: [{ kind: "text", contentIndex: 0, text: "done" }],
      api: "openai-responses",
      providerId: "openai",
      modelId: "gpt-5",
      responseId: null,
      usage: null,
      stopReason: "stop",
      errorMessage: null,
      piHistoryEntry: null,
      messageTimestamp: timestamp,
      finishedAt: timestamp,
    });
    const snapshot = Schema.decodeUnknownSync(
      RuntimeSurfaceTranscriptSnapshotSchema,
      strictBoundaryParseOptions,
    )({
      surfacePiSessionId: "surface_01",
      messages: [],
      activeAssistantMessage: null,
      streamCursor: expectedCursor,
    });

    expect(userInput.message.text).toBe("hello");
    expect(terminalInput.content[0]?.kind).toBe("text");
    expect(Number(snapshot.streamCursor?.streamSequence)).toBe(3);
  });
});
