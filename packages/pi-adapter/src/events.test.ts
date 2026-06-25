import { describe, expect, it } from "bun:test";
import { runTestEffect } from "./effect.test-support";
import { normalizePiAgentEventToRuntimeEvents } from "./events";
import type { PiSessionRef, SurfacePiSessionId, ToolCallId, TurnId } from "@svvy/core";

const base = {
  session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId } satisfies PiSessionRef,
  turnId: "turn_01" as TurnId,
  surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
};

describe("pi event adapter", () => {
  it("maps completed user messages after pi commits them", async () => {
    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.user_message.committed",
        piMessageRef: "pi_surface_01:turn_01:user:1710000000000",
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([]);
  });

  it("maps assistant text and thinking deltas to pi-free runtime events", async () => {
    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.assistant.text.delta",
        piMessageRef: "msg_1",
        contentIndex: 0,
        delta: "hello",
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.assistant.thinking.delta",
        piMessageRef: "msg_2",
        contentIndex: 1,
        delta: "reasoning",
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.assistant.text.delta",
        piMessageRef: "pi_surface_01:turn_01:assistant:2",
        contentIndex: 2,
        delta: "fallback",
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.assistant.text.delta",
        piMessageRef: "msg_empty",
        contentIndex: 0,
        delta: "",
      },
    ]);
  });

  it("maps tool call streaming events from assistant message updates", async () => {
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

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([
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
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([
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
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
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
      ),
    ).resolves.toEqual([
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
    ]);
  });

  it("maps tool execution and terminal turn events", async () => {
    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_start",
            toolCallId: "tool_2",
            toolName: "exec_command",
            args: { cmd: "bun test" },
          },
        }),
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.tool_execution.started",
        toolCallId: "tool_2" as ToolCallId,
        toolName: "exec_command",
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_update",
            toolCallId: "tool_2",
            toolName: "exec_command",
            partialResult: { content: [{ type: "text", text: "still running" }] },
          },
        }),
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.tool_execution.updated",
        toolCallId: "tool_2" as ToolCallId,
        toolName: "exec_command",
        result: { content: [{ type: "text", text: "still running" }], details: null },
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_end",
            toolCallId: "tool_2",
            toolName: "exec_command",
            result: { message: "permission denied" },
            isError: true,
          },
        }),
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.tool_execution.finished",
        toolCallId: "tool_2" as ToolCallId,
        toolName: "exec_command",
        status: "failed",
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_end",
            toolCallId: "tool_2",
            toolName: "exec_command",
            result: { content: [{ type: "text", text: "ok" }], details: { ok: true } },
          },
        }),
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.tool_execution.finished",
        toolCallId: "tool_2" as ToolCallId,
        toolName: "exec_command",
        status: "completed",
        result: { content: [{ type: "text", text: "ok" }], details: { ok: true } },
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: { type: "turn_end", stopReason: "aborted" },
        }),
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.turn.finished",
        status: "cancelled",
        stopReason: "aborted",
      },
    ]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: { type: "turn_end", message: { role: "assistant", stopReason: "error" } },
        }),
      ),
    ).resolves.toEqual([
      {
        session: base.session,
        turnId: base.turnId,
        surfacePiSessionId: base.surfacePiSessionId,
        type: "pi.turn.finished",
        status: "failed",
        stopReason: "error",
      },
    ]);
  });

  it("ignores explicitly non-durable pi lifecycle events", async () => {
    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({ ...base, event: { type: "agent_start" } }),
      ),
    ).resolves.toEqual([]);

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "start",
              partial: { id: "assistant_1" },
            },
          },
        }),
      ),
    ).resolves.toEqual([]);
  });

  it("fails closed on unknown and malformed events", async () => {
    await expect(
      runTestEffect(normalizePiAgentEventToRuntimeEvents({ ...base, event: { type: "surprise" } })),
    ).rejects.toThrow("Unknown pi agent event type");

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: { type: "surprise" },
          },
        }),
      ),
    ).rejects.toThrow("Unknown assistant message event type");

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "message_update",
            assistantMessageEvent: {
              type: "toolcall_start",
              partial: { id: "msg_tool", content: [] },
            },
          },
        }),
      ),
    ).rejects.toThrow("Assistant event is missing contentIndex");

    await expect(
      runTestEffect(
        normalizePiAgentEventToRuntimeEvents({
          ...base,
          event: {
            type: "tool_execution_update",
            toolCallId: "tool_2",
            toolName: "exec_command",
            result: { content: [{ type: "text", text: "wrong field" }] },
          },
        }),
      ),
    ).rejects.toThrow("Tool execution result is not a native tool result");
  });
});
