import * as Effect from "effect/Effect";
import {
  PiAdapterError,
  type JsonValue,
  type PiRuntimeEvent,
  type PiSessionRef,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
} from "@svvy/core";

type PiRuntimeToolResult = Extract<PiRuntimeEvent, { type: "pi.tool_execution.updated" }>["result"];

export type NormalizePiAgentEventInput = {
  readonly session: PiSessionRef;
  readonly turnId: TurnId;
  readonly surfacePiSessionId: SurfacePiSessionId;
  readonly event: unknown;
};

export function normalizePiAgentEventToRuntimeEvents(
  input: NormalizePiAgentEventInput,
): Effect.Effect<readonly PiRuntimeEvent[], PiAdapterError> {
  return Effect.try({
    try: () => {
      const event = readObject(input.event);
      if (!event) {
        throw eventDecodeError("unknown", "Pi agent event is not an object.");
      }

      const type = readString(event.type);
      switch (type) {
        case "agent_start":
        case "turn_start":
        case "message_start":
          return [];

        case "message_end":
          return normalizeMessageEnd(input, event);

        case "message_update":
          return adaptAssistantMessageEvent(input, event.assistantMessageEvent);

        case "tool_execution_start":
          return [
            {
              ...eventBase(input),
              type: "pi.tool_execution.started",
              toolCallId: readRequiredString(event.toolCallId, type) as ToolCallId,
              toolName: readRequiredString(event.toolName, type),
            },
          ];

        case "tool_execution_update": {
          const result = readNativeToolResult(event.partialResult, type);
          return [
            {
              ...eventBase(input),
              type: "pi.tool_execution.updated",
              toolCallId: readRequiredString(event.toolCallId, type) as ToolCallId,
              toolName: readRequiredString(event.toolName, type),
              result,
            },
          ];
        }

        case "tool_execution_end": {
          const status = readToolExecutionStatus(event, type);
          const result =
            event.result === undefined || (status === "failed" && !isNativeToolResult(event.result))
              ? undefined
              : readNativeToolResult(event.result, type);
          const error =
            event.error === undefined ? undefined : readRequiredString(event.error, type);
          return [
            {
              ...eventBase(input),
              type: "pi.tool_execution.finished",
              toolCallId: readRequiredString(event.toolCallId, type) as ToolCallId,
              toolName: readRequiredString(event.toolName, type),
              status,
              ...(result ? { result } : {}),
              ...(error ? { error } : {}),
            },
          ];
        }

        case "agent_end":
        case "turn_end": {
          const stopReason = readTurnStopReason(event);
          return [
            {
              ...eventBase(input),
              type: "pi.turn.finished",
              status: readTurnStatus(event, type),
              ...(stopReason ? { stopReason } : {}),
            },
          ];
        }

        default:
          throw eventDecodeError(type ?? "unknown", "Unknown pi agent event type.");
      }
    },
    catch: (error) =>
      error instanceof PiAdapterError
        ? error
        : eventDecodeError("unknown", error instanceof Error ? error.message : String(error)),
  });
}

function adaptAssistantMessageEvent(
  input: NormalizePiAgentEventInput,
  assistantEvent: unknown,
): readonly PiRuntimeEvent[] {
  const event = readObject(assistantEvent);
  if (!event) {
    throw eventDecodeError("message_update", "Assistant message event is not an object.");
  }
  const type = readString(event.type);
  switch (type) {
    case "start":
    case "text_start":
    case "text_end":
    case "thinking_start":
    case "thinking_end":
    case "done":
      return [];

    case "text_delta":
      return [
        {
          ...eventBase(input),
          type: "pi.assistant.text.delta",
          piMessageRef: readPiMessageRef(input, event),
          contentIndex: readContentIndex(event, type),
          delta: readRequiredStringField(event.delta, type),
        },
      ];

    case "thinking_delta":
      return [
        {
          ...eventBase(input),
          type: "pi.assistant.thinking.delta",
          piMessageRef: readPiMessageRef(input, event),
          contentIndex: readContentIndex(event, type),
          delta: readRequiredStringField(event.delta, type),
        },
      ];

    case "toolcall_start": {
      const toolCall = readToolCallFromAssistantEvent(event, type);
      return [
        {
          ...eventBase(input),
          type: "pi.tool_call.started",
          piMessageRef: readPiMessageRef(input, event),
          toolCallId: toolCall.id as ToolCallId,
          toolName: toolCall.name,
          contentIndex: readContentIndex(event, type),
        },
      ];
    }

    case "toolcall_delta": {
      const toolCall = readToolCallFromAssistantEvent(event, type);
      return [
        {
          ...eventBase(input),
          type: "pi.tool_call.arguments.delta",
          piMessageRef: readPiMessageRef(input, event),
          toolCallId: toolCall.id as ToolCallId,
          toolName: toolCall.name,
          delta: readRequiredStringField(event.delta, type),
          contentIndex: readContentIndex(event, type),
        },
      ];
    }

    case "toolcall_end": {
      const toolCall = readToolCallFromAssistantEvent(event, type);
      return [
        {
          ...eventBase(input),
          type: "pi.tool_call.accepted",
          piMessageRef: readPiMessageRef(input, event),
          toolCallId: toolCall.id as ToolCallId,
          toolName: toolCall.name,
          argumentsJson: JSON.stringify(toolCall.arguments ?? {}),
          contentIndex: readContentIndex(event, type),
        },
      ];
    }

    case "error":
      return [
        {
          ...eventBase(input),
          type: "pi.turn.finished",
          status: "failed",
          ...(typeof event.reason === "string" ? { stopReason: event.reason } : {}),
        },
      ];

    default:
      throw eventDecodeError(type ?? "unknown", "Unknown assistant message event type.");
  }
}

function normalizeMessageEnd(
  input: NormalizePiAgentEventInput,
  event: Record<string, unknown>,
): readonly PiRuntimeEvent[] {
  const message = readObject(event.message);
  if (!message || message.role !== "user") {
    return [];
  }
  return [
    {
      ...eventBase(input),
      type: "pi.user_message.committed",
      piMessageRef: readUserMessageRef(input, message),
    },
  ];
}

function eventBase(input: NormalizePiAgentEventInput) {
  return {
    session: input.session,
    turnId: input.turnId,
    surfacePiSessionId: input.surfacePiSessionId,
  } as const;
}

function readToolCallFromAssistantEvent(
  event: Record<string, unknown>,
  type: string,
): { id: string; name: string; arguments?: unknown } {
  const direct = readObject(event.toolCall);
  if (direct) {
    return readToolCall(direct, type);
  }
  const partial = readObject(event.partial);
  const content = Array.isArray(partial?.content) ? partial.content : null;
  const candidate = content?.[readContentIndex(event, type)];
  const object = readObject(candidate);
  if (!object) {
    throw eventDecodeError(type, "Assistant event does not include a tool call.");
  }
  return readToolCall(object, type);
}

function readToolCall(
  value: Record<string, unknown>,
  type: string,
): { id: string; name: string; arguments?: unknown } {
  if (value.type !== "toolCall") {
    throw eventDecodeError(type, "Assistant event content is not a tool call.");
  }
  return {
    id: readRequiredString(value.id, type),
    name: readRequiredString(value.name, type),
    arguments: value.arguments,
  };
}

function readNativeToolResult(value: unknown, eventType: string): PiRuntimeToolResult {
  const object = readObject(value);
  if (!isNativeToolResult(object)) {
    throw eventDecodeError(eventType, "Tool execution result is not a native tool result.");
  }
  return {
    content: object.content as PiRuntimeToolResult["content"],
    details: toJsonValue(object.details),
  };
}

function isNativeToolResult(value: unknown): value is Record<string, unknown> & {
  content: PiRuntimeToolResult["content"];
} {
  const object = readObject(value);
  return !!object && Array.isArray(object.content);
}

function readToolExecutionStatus(
  event: Record<string, unknown>,
  eventType: string,
): "completed" | "failed" | "cancelled" {
  if (event.status === "completed" || event.status === "failed" || event.status === "cancelled") {
    return event.status;
  }
  if (event.isError === true) {
    return "failed";
  }
  if (event.isCancelled === true) {
    return "cancelled";
  }
  if ("result" in event) {
    return "completed";
  }
  throw eventDecodeError(eventType, "Tool execution end event has no terminal status.");
}

function readTurnStatus(
  event: Record<string, unknown>,
  eventType: string,
): "completed" | "failed" | "cancelled" {
  if (event.status === "completed" || event.status === "failed" || event.status === "cancelled") {
    return event.status;
  }
  if (event.stopReason === "error") {
    return "failed";
  }
  if (event.stopReason === "aborted" || event.stopReason === "cancelled") {
    return "cancelled";
  }
  const message = readObject(event.message);
  if (message?.stopReason === "error") {
    return "failed";
  }
  if (message?.stopReason === "aborted" || message?.stopReason === "cancelled") {
    return "cancelled";
  }
  if (eventType === "agent_end" || eventType === "turn_end") {
    return "completed";
  }
  throw eventDecodeError(eventType, "Turn end event has no terminal status.");
}

function readTurnStopReason(event: Record<string, unknown>): string | null {
  if (typeof event.stopReason === "string") {
    return event.stopReason;
  }
  const message = readObject(event.message);
  return typeof message?.stopReason === "string" ? message.stopReason : null;
}

function readPiMessageRef(
  input: NormalizePiAgentEventInput,
  event: Record<string, unknown>,
): string {
  const direct = readString(event.piMessageRef);
  if (direct) return direct;
  const partial = readObject(event.partial);
  const partialId = readString(partial?.id);
  if (partialId) return partialId;
  const contentIndex = typeof event.contentIndex === "number" ? `:${event.contentIndex}` : "";
  return `${input.surfacePiSessionId}:${input.turnId}:assistant${contentIndex}`;
}

function readUserMessageRef(
  input: NormalizePiAgentEventInput,
  message: Record<string, unknown>,
): string {
  const direct = readString(message.id) ?? readString(message.piMessageRef);
  if (direct) return direct;
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : "unknown";
  return `${input.surfacePiSessionId}:${input.turnId}:user:${timestamp}`;
}

function readContentIndex(event: Record<string, unknown>, eventType: string): number {
  const index = event.contentIndex;
  if (typeof index === "number" && Number.isInteger(index) && index >= 0) {
    return index;
  }
  throw eventDecodeError(eventType, "Assistant event is missing contentIndex.");
}

function readRequiredString(value: unknown, eventType: string): string {
  const text = readString(value);
  if (text) return text;
  throw eventDecodeError(eventType, "Expected a non-empty string field.");
}

function readRequiredStringField(value: unknown, eventType: string): string {
  if (typeof value === "string") return value;
  throw eventDecodeError(eventType, "Expected a string field.");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return null;
  }
}

function eventDecodeError(eventType: string, message: string): PiAdapterError {
  return new PiAdapterError({
    operation: "pi-adapter.events.normalize",
    reason: "event-decode-failed",
    message: `${eventType}: ${message}`,
  });
}
