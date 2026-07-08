import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { normalizePiAgentEventToRuntimeEvents } from "./events";
import type { PiSessionRef, SurfacePiSessionId, ToolCallId, TurnId } from "@svvy/core";

const base = {
  session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId } satisfies PiSessionRef,
  turnId: "turn_01" as TurnId,
  surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
};

describe("pi event adapter", () => {
  it.effect("maps completed user messages after pi commits them", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* normalizePiAgentEventToRuntimeEvents({
          ...base,
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
            piMessageRef: "pi_surface_01:turn_01:assistant:2",
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
