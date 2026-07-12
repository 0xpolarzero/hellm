import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  type NativeToolResult,
  NativeToolResultSchema,
  PiAdapterError,
  type PiHistoryEntryRef,
  strictBoundaryParseOptions,
  type ModelId,
  type PiRuntimeEvent,
  type PiSessionRef,
  type ProviderId,
  type RuntimeTranscriptAssistantContent,
  type RuntimeTranscriptAssistantStopReason,
  type RuntimeTranscriptUsage,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
} from "@svvy/core";

type RuntimeEventIsoDateTime = Extract<
  PiRuntimeEvent,
  { readonly type: "pi.assistant_message.committed" }
>["finishedAt"];

const decodeNativeToolResultSync = Schema.decodeUnknownSync(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);

export type NormalizePiAgentEventInput = {
  readonly session: PiSessionRef;
  readonly turnId: TurnId;
  readonly surfacePiSessionId: SurfacePiSessionId;
  readonly event: unknown;
  readonly assistantMessageRef?: string;
  readonly piHistoryEntry?: PiHistoryEntryRef | null;
  readonly occurredAt: string;
};

export function normalizePiAgentEventToRuntimeEvents(
  input: NormalizePiAgentEventInput,
): Effect.Effect<readonly PiRuntimeEvent[], PiAdapterError> {
  return Effect.try({
    try: () => normalizePiAgentEventToRuntimeEventsSync(input),
    catch: (error) =>
      error instanceof PiAdapterError
        ? error
        : eventDecodeError("unknown", error instanceof Error ? error.message : String(error)),
  });
}

export function normalizePiAgentEventToRuntimeEventsSync(
  input: NormalizePiAgentEventInput,
): readonly PiRuntimeEvent[] {
  const event = readObject(input.event);
  if (!event) {
    throw eventDecodeError("unknown", "Pi agent event is not an object.");
  }

  const type = readString(event.type);
  switch (type) {
    case "agent_start":
    case "turn_start":
      return [];

    case "message_start":
      return normalizeMessageStart(input, event);

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
      const error = event.error === undefined ? undefined : readRequiredString(event.error, type);
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

    case "agent_end": {
      const stopReason = readTurnStopReason(event);
      return [
        {
          ...eventBase(input),
          type: "pi.agent.finished",
          status: readTurnStatus(event, type),
          ...(stopReason ? { stopReason } : {}),
        },
      ];
    }

    default:
      throw eventDecodeError(type ?? "unknown", "Unknown pi agent event type.");
  }
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
      // The assistant stream error is message-local. The owning Agent always emits
      // agent_end (or rejects the prompt), which is the only whole-prompt terminal.
      return [];

    default:
      throw eventDecodeError(type ?? "unknown", "Unknown assistant message event type.");
  }
}

function normalizeMessageEnd(
  input: NormalizePiAgentEventInput,
  event: Record<string, unknown>,
): readonly PiRuntimeEvent[] {
  const message = readObject(event.message);
  if (!message) {
    return [];
  }
  if (message.role === "user") {
    return [
      {
        ...eventBase(input),
        type: "pi.user_message.committed",
        piMessageRef: readUserMessageRef(input, message),
        piHistoryEntry: input.piHistoryEntry ?? null,
        committedAt: readOccurredAt(input),
      },
    ];
  }
  if (message.role === "assistant") {
    return [
      {
        ...eventBase(input),
        type: "pi.assistant_message.committed",
        piMessageRef: readPiMessageRef(input, message),
        content: readAssistantContent(message, "message_end"),
        api: readString(message.api),
        providerId: readRequiredString(message.provider, "message_end") as ProviderId,
        modelId: readRequiredString(message.model, "message_end") as ModelId,
        responseId: readString(message.responseId),
        usage: readAssistantUsage(message.usage, "message_end"),
        stopReason: readAssistantStopReason(message.stopReason, "message_end"),
        errorMessage: readString(message.errorMessage),
        piHistoryEntry: input.piHistoryEntry ?? null,
        messageTimestamp: readMessageTimestamp(message),
        finishedAt: readOccurredAt(input),
      },
    ];
  }
  return [];
}

function normalizeMessageStart(
  input: NormalizePiAgentEventInput,
  event: Record<string, unknown>,
): readonly PiRuntimeEvent[] {
  const message = readObject(event.message);
  if (!message || message.role !== "assistant") {
    return [];
  }
  return [
    {
      ...eventBase(input),
      type: "pi.assistant_message.started",
      piMessageRef: readPiMessageRef(input, message),
      api: readString(message.api),
      providerId: readRequiredString(message.provider, "message_start") as ProviderId,
      modelId: readRequiredString(message.model, "message_start") as ModelId,
      startedAt: readMessageTimestamp(message) ?? readOccurredAt(input),
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

function readNativeToolResult(value: unknown, eventType: string): NativeToolResult {
  if (!readObject(value)) {
    throw eventDecodeError(eventType, "Tool execution result is not a native tool result.");
  }
  try {
    return decodeNativeToolResultSync(value);
  } catch {
    throw eventDecodeError(eventType, "Tool execution result is not a native tool result.");
  }
}

function isNativeToolResult(value: unknown): boolean {
  if (!readObject(value)) {
    return false;
  }
  try {
    decodeNativeToolResultSync(value);
    return true;
  } catch {
    return false;
  }
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
  if (input.assistantMessageRef) return input.assistantMessageRef;
  const direct = readString(event.piMessageRef);
  if (direct) return direct;
  const partial = readObject(event.partial);
  const partialId = readString(partial?.id);
  if (partialId) return partialId;
  return `${input.surfacePiSessionId}:${input.turnId}:assistant`;
}

function readAssistantContent(
  message: Record<string, unknown>,
  eventType: string,
): RuntimeTranscriptAssistantContent {
  if (!Array.isArray(message.content)) {
    throw eventDecodeError(eventType, "Assistant message content is not an array.");
  }
  return message.content.map((rawBlock, contentIndex) => {
    const block = readObject(rawBlock);
    if (!block) {
      throw eventDecodeError(eventType, "Assistant message content block is not an object.");
    }
    switch (block.type) {
      case "text":
        return {
          kind: "text" as const,
          contentIndex,
          text: readRequiredStringField(block.text, eventType),
        };
      case "thinking":
        return {
          kind: "thinking" as const,
          contentIndex,
          thinking: readRequiredStringField(block.thinking, eventType),
          ...(typeof block.redacted === "boolean" ? { redacted: block.redacted } : {}),
          ...(readString(block.thinkingSignature)
            ? { thinkingSignature: readString(block.thinkingSignature)! }
            : {}),
        };
      case "toolCall":
        return {
          kind: "tool-call" as const,
          contentIndex,
          toolCallId: readRequiredString(block.id, eventType) as ToolCallId,
          toolName: readRequiredString(block.name, eventType),
          argumentsJson: JSON.stringify(block.arguments ?? {}),
          argumentsStatus: "accepted" as const,
          commandId: null,
          ...(readString(block.thoughtSignature)
            ? { thoughtSignature: readString(block.thoughtSignature)! }
            : {}),
        };
      default:
        throw eventDecodeError(eventType, "Unknown assistant message content block type.");
    }
  });
}

function readAssistantUsage(value: unknown, eventType: string): RuntimeTranscriptUsage {
  const usage = readObject(value);
  const cost = readObject(usage?.cost);
  if (!usage || !cost) {
    throw eventDecodeError(eventType, "Assistant message usage is missing.");
  }
  return {
    input: readNonNegativeSafeInteger(usage.input, eventType),
    output: readNonNegativeSafeInteger(usage.output, eventType),
    cacheRead: readNonNegativeSafeInteger(usage.cacheRead, eventType),
    cacheWrite: readNonNegativeSafeInteger(usage.cacheWrite, eventType),
    totalTokens: readNonNegativeSafeInteger(usage.totalTokens, eventType),
    cost: {
      input: readNonNegativeFiniteNumber(cost.input, eventType),
      output: readNonNegativeFiniteNumber(cost.output, eventType),
      cacheRead: readNonNegativeFiniteNumber(cost.cacheRead, eventType),
      cacheWrite: readNonNegativeFiniteNumber(cost.cacheWrite, eventType),
      total: readNonNegativeFiniteNumber(cost.total, eventType),
    },
  };
}

function readAssistantStopReason(
  value: unknown,
  eventType: string,
): RuntimeTranscriptAssistantStopReason {
  if (
    value === "stop" ||
    value === "length" ||
    value === "toolUse" ||
    value === "error" ||
    value === "aborted"
  ) {
    return value;
  }
  throw eventDecodeError(eventType, "Assistant message stop reason is invalid.");
}

function readMessageTimestamp(message: Record<string, unknown>): RuntimeEventIsoDateTime | null {
  if (typeof message.timestamp !== "number" || !Number.isFinite(message.timestamp)) {
    return null;
  }
  return DateTime.formatIso(DateTime.makeUnsafe(message.timestamp)) as RuntimeEventIsoDateTime;
}

function readOccurredAt(input: NormalizePiAgentEventInput): RuntimeEventIsoDateTime {
  return input.occurredAt as RuntimeEventIsoDateTime;
}

function readNonNegativeSafeInteger(value: unknown, eventType: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw eventDecodeError(eventType, "Expected a non-negative safe integer field.");
}

function readNonNegativeFiniteNumber(value: unknown, eventType: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw eventDecodeError(eventType, "Expected a non-negative finite number field.");
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

function eventDecodeError(eventType: string, message: string): PiAdapterError {
  return new PiAdapterError({
    operation: "pi-adapter.events.normalize",
    reason: "event-decode-failed",
    message: `${eventType}: ${message}`,
  });
}
