import * as Schema from "effect/Schema";
import {
  CommandId,
  IsoDateTimeStringSchema,
  MessageId,
  ModelId,
  NonNegativeSafeIntegerSchema,
  ProviderId,
  QueueItemId,
  SurfacePiSessionId,
  SurfaceStreamGenerationId,
  SurfaceStreamSequence,
  ToolCallId,
  TurnId,
  WorkspaceSessionId,
} from "./ids";
import { PiHistoryEntryRefSchema } from "./pi-history-contracts";
import { RuntimeSubmittedMessageSchema } from "./runtime-contracts";

const NonNegativeFiniteNumberSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);

export const RuntimeTranscriptCostSchema = Schema.Struct({
  input: NonNegativeFiniteNumberSchema,
  output: NonNegativeFiniteNumberSchema,
  cacheRead: NonNegativeFiniteNumberSchema,
  cacheWrite: NonNegativeFiniteNumberSchema,
  total: NonNegativeFiniteNumberSchema,
});
export type RuntimeTranscriptCost = typeof RuntimeTranscriptCostSchema.Type;

export const RuntimeTranscriptUsageSchema = Schema.Struct({
  input: NonNegativeSafeIntegerSchema,
  output: NonNegativeSafeIntegerSchema,
  cacheRead: NonNegativeSafeIntegerSchema,
  cacheWrite: NonNegativeSafeIntegerSchema,
  totalTokens: NonNegativeSafeIntegerSchema,
  cost: RuntimeTranscriptCostSchema,
});
export type RuntimeTranscriptUsage = typeof RuntimeTranscriptUsageSchema.Type;

export const RuntimeTranscriptTextBlockSchema = Schema.Struct({
  kind: Schema.Literal("text"),
  contentIndex: NonNegativeSafeIntegerSchema,
  text: Schema.String,
});
export type RuntimeTranscriptTextBlock = typeof RuntimeTranscriptTextBlockSchema.Type;

export const RuntimeTranscriptThinkingBlockSchema = Schema.Struct({
  kind: Schema.Literal("thinking"),
  contentIndex: NonNegativeSafeIntegerSchema,
  thinking: Schema.String,
  redacted: Schema.optionalKey(Schema.Boolean),
  thinkingSignature: Schema.optionalKey(Schema.String),
});
export type RuntimeTranscriptThinkingBlock = typeof RuntimeTranscriptThinkingBlockSchema.Type;

export const RuntimeTranscriptToolCallBlockSchema = Schema.Struct({
  kind: Schema.Literal("tool-call"),
  contentIndex: NonNegativeSafeIntegerSchema,
  toolCallId: ToolCallId,
  toolName: Schema.String,
  argumentsJson: Schema.String,
  argumentsStatus: Schema.Literals(["streaming", "accepted"]),
  commandId: Schema.NullOr(CommandId),
  thoughtSignature: Schema.optionalKey(Schema.String),
});
export type RuntimeTranscriptToolCallBlock = typeof RuntimeTranscriptToolCallBlockSchema.Type;

export const RuntimeTranscriptAssistantContentBlockSchema = Schema.Union([
  RuntimeTranscriptTextBlockSchema,
  RuntimeTranscriptThinkingBlockSchema,
  RuntimeTranscriptToolCallBlockSchema,
]);
export type RuntimeTranscriptAssistantContentBlock =
  typeof RuntimeTranscriptAssistantContentBlockSchema.Type;

const OrderedRuntimeTranscriptAssistantContentInvariant = Schema.makeFilter(
  (content: ReadonlyArray<{ readonly contentIndex: number }>) =>
    content.every(
      (block, index) => index === 0 || content[index - 1]!.contentIndex < block.contentIndex,
    ),
  { expected: "strictly ordered unique assistant transcript content indexes" },
);

export const RuntimeTranscriptAssistantContentSchema = Schema.Array(
  RuntimeTranscriptAssistantContentBlockSchema,
).check(OrderedRuntimeTranscriptAssistantContentInvariant);
export type RuntimeTranscriptAssistantContent = typeof RuntimeTranscriptAssistantContentSchema.Type;

export const RuntimeTranscriptAssistantStatusSchema = Schema.Literals([
  "streaming",
  "completed",
  "failed",
  "cancelled",
]);
export type RuntimeTranscriptAssistantStatus = typeof RuntimeTranscriptAssistantStatusSchema.Type;

export const RuntimeTranscriptAssistantStopReasonSchema = Schema.Literals([
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
]);
export type RuntimeTranscriptAssistantStopReason =
  typeof RuntimeTranscriptAssistantStopReasonSchema.Type;

const RuntimeTranscriptMessageBaseSchema = {
  messageId: MessageId,
  workspaceSessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  turnId: TurnId,
  ordinal: NonNegativeSafeIntegerSchema,
  piHistoryEntry: Schema.NullOr(PiHistoryEntryRefSchema),
} as const;

export const RuntimeTranscriptUserMessageSchema = Schema.Struct({
  ...RuntimeTranscriptMessageBaseSchema,
  role: Schema.Literal("user"),
  queueItemId: QueueItemId,
  message: RuntimeSubmittedMessageSchema,
  submittedAt: IsoDateTimeStringSchema,
  committedAt: IsoDateTimeStringSchema,
});
export type RuntimeTranscriptUserMessage = typeof RuntimeTranscriptUserMessageSchema.Type;

export const RuntimeTranscriptAssistantMessageSchema = Schema.Struct({
  ...RuntimeTranscriptMessageBaseSchema,
  role: Schema.Literal("assistant"),
  status: RuntimeTranscriptAssistantStatusSchema,
  content: RuntimeTranscriptAssistantContentSchema,
  api: Schema.NullOr(Schema.String),
  providerId: ProviderId,
  modelId: ModelId,
  responseId: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(RuntimeTranscriptUsageSchema),
  stopReason: Schema.NullOr(RuntimeTranscriptAssistantStopReasonSchema),
  errorMessage: Schema.NullOr(Schema.String),
  startedAt: IsoDateTimeStringSchema,
  messageTimestamp: Schema.NullOr(IsoDateTimeStringSchema),
  updatedAt: IsoDateTimeStringSchema,
  finishedAt: Schema.NullOr(IsoDateTimeStringSchema),
});
export type RuntimeTranscriptAssistantMessage = typeof RuntimeTranscriptAssistantMessageSchema.Type;

export const RuntimeTranscriptMessageSchema = Schema.Union([
  RuntimeTranscriptUserMessageSchema,
  RuntimeTranscriptAssistantMessageSchema,
]);
export type RuntimeTranscriptMessage = typeof RuntimeTranscriptMessageSchema.Type;

export const RuntimeTranscriptStreamCursorSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  streamGenerationId: SurfaceStreamGenerationId,
  streamSequence: SurfaceStreamSequence,
});
export type RuntimeTranscriptStreamCursor = typeof RuntimeTranscriptStreamCursorSchema.Type;

export const RuntimeSurfaceTranscriptSnapshotSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  messages: Schema.Array(RuntimeTranscriptMessageSchema),
  activeAssistantMessage: Schema.NullOr(RuntimeTranscriptAssistantMessageSchema),
  streamCursor: Schema.NullOr(RuntimeTranscriptStreamCursorSchema),
});
export type RuntimeSurfaceTranscriptSnapshot = typeof RuntimeSurfaceTranscriptSnapshotSchema.Type;
