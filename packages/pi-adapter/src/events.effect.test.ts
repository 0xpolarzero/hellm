import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { normalizePiAgentEventToRuntimeEvents } from "./events";
import {
  IsoDateTimeStringSchema,
  type ModelId,
  type PiSessionRef,
  type ProviderId,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
} from "@svvy/core";

type IsoDateTime = typeof IsoDateTimeStringSchema.Type;

const base = {
  session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId } satisfies PiSessionRef,
  turnId: "turn_01" as TurnId,
  surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
  occurredAt: "2026-07-11T12:00:00.000Z",
};

describe("pi event adapter", () => {
  it.effect("maps completed user messages after pi commits them", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          occurredAt: "2026-07-11T12:00:00.000Z",
          event: {
            type: "message_end",
            message: {
              role: "user",
              content: "hello",
              timestamp: 1710000000000,
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.user_message.committed",
            piMessageRef: "pi_surface_01:turn_01:user:1710000000000",
            piHistoryEntry: null,
            committedAt: "2026-07-11T12:00:00.000Z" as IsoDateTime,
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_start",
            message: {
              role: "user",
              content: "hello",
              timestamp: 1710000000000,
            },
          },
        }),
        [],
      );
    }),
  );

  it.effect("maps assistant text and thinking deltas to pi-free runtime events", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              contentIndex: 0,
              partial: { id: "msg_1" },
              delta: "hello",
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.assistant.text.delta",
            piMessageRef: "msg_1",
            contentIndex: 0,
            delta: "hello",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "thinking_delta",
              contentIndex: 1,
              piMessageRef: "msg_2",
              delta: "reasoning",
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.assistant.thinking.delta",
            piMessageRef: "msg_2",
            contentIndex: 1,
            delta: "reasoning",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              contentIndex: 2,
              partial: { content: [] },
              delta: "fallback",
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.assistant.text.delta",
            piMessageRef: "pi_surface_01:turn_01:assistant",
            contentIndex: 2,
            delta: "fallback",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              contentIndex: 0,
              partial: { id: "msg_empty" },
              delta: "",
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.assistant.text.delta",
            piMessageRef: "msg_empty",
            contentIndex: 0,
            delta: "",
          },
        ],
      );
    }),
  );

  it.effect("maps assistant message lifecycle with rich terminal metadata", () =>
    Effect.gen(function* () {
      const piHistoryEntry = {
        session: base.session,
        entryId: "pi_entry_assistant_01",
      };
      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          assistantMessageRef: "assistant_01",
          occurredAt: "2026-07-11T12:00:01.000Z",
          event: {
            type: "message_start",
            message: {
              role: "assistant",
              content: [],
              api: "openai-responses",
              provider: "openai",
              model: "gpt-5",
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "stop",
              timestamp: 1710000000000,
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.assistant_message.started",
            piMessageRef: "assistant_01",
            api: "openai-responses",
            providerId: "openai" as ProviderId,
            modelId: "gpt-5" as ModelId,
            startedAt: "2024-03-09T16:00:00.000Z" as IsoDateTime,
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          assistantMessageRef: "assistant_01",
          piHistoryEntry,
          occurredAt: "2026-07-11T12:00:02.000Z",
          event: {
            type: "message_end",
            message: {
              role: "assistant",
              content: [
                {
                  type: "thinking",
                  thinking: "Inspect.",
                  thinkingSignature: "thinking_01",
                  redacted: false,
                },
                {
                  type: "toolCall",
                  id: "tool_01",
                  name: "read_file",
                  arguments: { path: "src/main.ts" },
                  thoughtSignature: "thought_01",
                },
                { type: "text", text: "Done." },
              ],
              api: "openai-responses",
              provider: "openai",
              model: "gpt-5",
              responseId: "response_01",
              usage: {
                input: 10,
                output: 5,
                cacheRead: 2,
                cacheWrite: 0,
                totalTokens: 15,
                cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0, total: 0.31 },
              },
              stopReason: "toolUse",
              timestamp: 1710000000000,
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.assistant_message.committed",
            piMessageRef: "assistant_01",
            content: [
              {
                kind: "thinking",
                contentIndex: 0,
                thinking: "Inspect.",
                redacted: false,
                thinkingSignature: "thinking_01",
              },
              {
                kind: "tool-call",
                contentIndex: 1,
                toolCallId: "tool_01" as ToolCallId,
                toolName: "read_file",
                argumentsJson: '{"path":"src/main.ts"}',
                argumentsStatus: "accepted",
                commandId: null,
                thoughtSignature: "thought_01",
              },
              { kind: "text", contentIndex: 2, text: "Done." },
            ],
            api: "openai-responses",
            providerId: "openai" as ProviderId,
            modelId: "gpt-5" as ModelId,
            responseId: "response_01",
            usage: {
              input: 10,
              output: 5,
              cacheRead: 2,
              cacheWrite: 0,
              totalTokens: 15,
              cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0, total: 0.31 },
            },
            stopReason: "toolUse",
            errorMessage: null,
            piHistoryEntry,
            messageTimestamp: "2024-03-09T16:00:00.000Z" as IsoDateTime,
            finishedAt: "2026-07-11T12:00:02.000Z" as IsoDateTime,
          },
        ],
      );
    }),
  );

  it.effect("maps tool call streaming events from assistant message updates", () =>
    Effect.gen(function* () {
      const partial = {
        id: "msg_tool",
        content: [
          {
            type: "toolCall",
            id: "tool_1",
            name: "exec_command",
            arguments: { cmd: "bun test" },
          },
        ],
      };

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "toolcall_start",
              contentIndex: 0,
              partial,
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_call.started",
            piMessageRef: "msg_tool",
            toolCallId: "tool_1" as ToolCallId,
            toolName: "exec_command",
            contentIndex: 0,
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "toolcall_delta",
              contentIndex: 0,
              partial,
              delta: '{"cmd":"bun test"',
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_call.arguments.delta",
            piMessageRef: "msg_tool",
            toolCallId: "tool_1" as ToolCallId,
            toolName: "exec_command",
            delta: '{"cmd":"bun test"',
            contentIndex: 0,
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "toolcall_end",
              contentIndex: 0,
              partial,
              toolCall: partial.content[0],
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_call.accepted",
            piMessageRef: "msg_tool",
            toolCallId: "tool_1" as ToolCallId,
            toolName: "exec_command",
            argumentsJson: '{"cmd":"bun test"}',
            contentIndex: 0,
          },
        ],
      );
    }),
  );

  it.effect("maps tool execution and terminal turn events", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_start",
            toolCallId: "tool_2",
            toolName: "exec_command",
            args: { cmd: "bun test" },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_execution.started",
            toolCallId: "tool_2" as ToolCallId,
            toolName: "exec_command",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_update",
            toolCallId: "tool_2",
            toolName: "exec_command",
            partialResult: { content: [{ type: "text", text: "still running" }] },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_execution.updated",
            toolCallId: "tool_2" as ToolCallId,
            toolName: "exec_command",
            result: { content: [{ type: "text", text: "still running" }] },
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_update",
            toolCallId: "tool_2",
            toolName: "exec_command",
            partialResult: { details: { status: "succeeded", summary: "accepted" } },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_execution.updated",
            toolCallId: "tool_2" as ToolCallId,
            toolName: "exec_command",
            result: { details: { status: "succeeded", summary: "accepted" } },
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_end",
            toolCallId: "tool_2",
            toolName: "exec_command",
            result: { message: "permission denied" },
            isError: true,
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_execution.finished",
            toolCallId: "tool_2" as ToolCallId,
            toolName: "exec_command",
            status: "failed",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_end",
            toolCallId: "tool_2",
            toolName: "exec_command",
            result: {
              content: [{ type: "text", text: "ok" }],
              details: { status: "succeeded", summary: "ok" },
            },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_execution.finished",
            toolCallId: "tool_2" as ToolCallId,
            toolName: "exec_command",
            status: "completed",
            result: {
              content: [{ type: "text", text: "ok" }],
              details: { status: "succeeded", summary: "ok" },
            },
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_end",
            toolCallId: "tool_2",
            toolName: "exec_command",
            result: { details: { status: "succeeded", summary: "details only" } },
          },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.tool_execution.finished",
            toolCallId: "tool_2" as ToolCallId,
            toolName: "exec_command",
            status: "completed",
            result: { details: { status: "succeeded", summary: "details only" } },
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: { type: "turn_end", stopReason: "aborted" },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.turn.finished",
            status: "cancelled",
            stopReason: "aborted",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: { type: "turn_end", message: { role: "assistant", stopReason: "error" } },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.turn.finished",
            status: "failed",
            stopReason: "error",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] },
        }),
        [
          {
            session: base.session,
            turnId: base.turnId,
            surfacePiSessionId: base.surfacePiSessionId,
            type: "pi.agent.finished",
            status: "completed",
          },
        ],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: { type: "error", reason: "stream failed" },
          },
        }),
        [],
      );
    }),
  );

  it.effect("ignores explicitly non-durable pi lifecycle events", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({ ...base, event: { type: "agent_start" } }),
        [],
      );

      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "start",
              partial: { id: "assistant_1" },
            },
          },
        }),
        [],
      );
    }),
  );

  it.effect("fails closed on unknown and malformed events", () =>
    Effect.gen(function* () {
      const unknownEvent = yield* normalizePiAgentEventToRuntimeEvents({
        ...base,
        event: { type: "surprise" },
      }).pipe(Effect.flip);
      assert.match(unknownEvent.message, /Unknown pi agent event type/);

      const unknownAssistantEvent = yield* normalizePiAgentEventToRuntimeEvents({
        ...base,
        event: {
          type: "message_update",
          assistantMessageEvent: { type: "surprise" },
        },
      }).pipe(Effect.flip);
      assert.match(unknownAssistantEvent.message, /Unknown assistant message event type/);

      const missingContentIndex = yield* normalizePiAgentEventToRuntimeEvents({
        ...base,
        event: {
          type: "message_update",
          assistantMessageEvent: {
            type: "toolcall_start",
            partial: { id: "msg_tool", content: [] },
          },
        },
      }).pipe(Effect.flip);
      assert.match(missingContentIndex.message, /Assistant event is missing contentIndex/);

      const invalidToolResult = yield* normalizePiAgentEventToRuntimeEvents({
        ...base,
        event: {
          type: "tool_execution_update",
          toolCallId: "tool_2",
          toolName: "exec_command",
          partialResult: { content: [{ type: "text" }] },
        },
      }).pipe(Effect.flip);
      assert.match(invalidToolResult.message, /Tool execution result is not a native tool result/);

      const invalidImageResult = yield* normalizePiAgentEventToRuntimeEvents({
        ...base,
        event: {
          type: "tool_execution_update",
          toolCallId: "tool_2",
          toolName: "exec_command",
          partialResult: { content: [{ type: "image", data: "abc" }] },
        },
      }).pipe(Effect.flip);
      assert.match(invalidImageResult.message, /Tool execution result is not a native tool result/);

      const excessToolResult = yield* normalizePiAgentEventToRuntimeEvents({
        ...base,
        event: {
          type: "tool_execution_update",
          toolCallId: "tool_2",
          toolName: "exec_command",
          partialResult: {
            content: [{ type: "text", text: "ok" }],
            preview: "not part of the contract",
          },
        },
      }).pipe(Effect.flip);
      assert.match(excessToolResult.message, /Tool execution result is not a native tool result/);

      const invalidToolDetails = yield* normalizePiAgentEventToRuntimeEvents({
        ...base,
        event: {
          type: "tool_execution_update",
          toolCallId: "tool_2",
          toolName: "exec_command",
          partialResult: { details: { ok: true } },
        },
      }).pipe(Effect.flip);
      assert.match(invalidToolDetails.message, /Tool execution result is not a native tool result/);

      const invalidCommandFacts = yield* normalizePiAgentEventToRuntimeEvents({
        ...base,
        event: {
          type: "tool_execution_update",
          toolCallId: "tool_2",
          toolName: "exec_command",
          partialResult: { details: { commandFacts: { dropped: undefined } } },
        },
      }).pipe(Effect.flip);
      assert.match(
        invalidCommandFacts.message,
        /Tool execution result is not a native tool result/,
      );
    }),
  );
});
