import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  AbsolutePath,
  AgentProfileId,
  CommandId,
  GeneratedContextFingerprint,
  GeneratedContextRevision,
  type IsoDateTimeString,
  IsoDateTimeStringSchema,
  ModelId,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  ProviderId,
  SurfacePiSessionId,
  ThreadId,
  ToolCallId,
  TurnId,
  WorkspaceId,
  WorkspaceSessionId,
} from "./ids";
import {
  type NativeToolDeclaration,
  type NativeToolResult,
  NativeToolResultSchema,
} from "./native-tool-contracts";
import {
  PiHistoryEntryRefSchema,
  type PiSessionRef,
  PiSessionRefSchema,
} from "./pi-history-contracts";
import {
  ActorKindSchema,
  ReasoningEffortSchema,
  ReasoningSelectionSchema,
  type ReasoningSelection,
  type RuntimeSubmittedMessage,
} from "./runtime-contracts";
import { ProviderAuthStatusSchema } from "./provider-auth-ports";
import {
  RuntimeTranscriptAssistantContentSchema,
  RuntimeTranscriptAssistantStopReasonSchema,
  RuntimeTranscriptUsageSchema,
} from "./transcript-contracts";
import type { RuntimeToolExecutionError } from "./errors";

export const ModelSelectionSchema = Schema.Struct({
  providerId: ProviderId,
  modelId: ModelId,
});
export type ModelSelection = typeof ModelSelectionSchema.Type;

export {
  PiHistoryEntryRefSchema,
  PiSessionRefSchema,
  type PiHistoryEntryRef,
  type PiSessionRef,
} from "./pi-history-contracts";

export const PiSessionReferencePublicSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  referenceFingerprint: Schema.String,
});
export type PiSessionReferencePublic = typeof PiSessionReferencePublicSchema.Type;

export const PiSessionReferenceSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  referenceFingerprint: Schema.String,
  adapterKind: Schema.String,
  adapterVersion: Schema.String,
  storageLocator: Schema.String,
  piSessionId: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
});
export type PiSessionReference = typeof PiSessionReferenceSchema.Type;

export const PiSessionReferenceValidationSchema = Schema.Union([
  Schema.Struct({
    valid: Schema.Literal(true),
    reference: PiSessionReferenceSchema,
    referenceFingerprint: Schema.String,
  }),
  Schema.Struct({
    valid: Schema.Literal(false),
    reason: Schema.Literals([
      "not-found",
      "workspace-mismatch",
      "surface-mismatch",
      "actor-mismatch",
      "adapter-version-mismatch",
    ]),
    referenceFingerprint: Schema.optionalKey(Schema.String),
  }),
]);
export type PiSessionReferenceValidation = typeof PiSessionReferenceValidationSchema.Type;

export const PiSystemPromptBindingSchema = Schema.Struct({
  fingerprint: GeneratedContextFingerprint,
  revision: GeneratedContextRevision,
  text: Schema.String,
});
export type PiSystemPromptBinding = typeof PiSystemPromptBindingSchema.Type;

export const PiAmbientPiResourceKindSchema = Schema.Literals([
  "pi_builtin_tool",
  "pi_extension",
  "pi_skill",
  "pi_prompt_template",
  "pi_theme",
  "pi_command",
  "pi_hook",
  "pi_provider_adapter",
]);
export type PiAmbientPiResourceKind = typeof PiAmbientPiResourceKindSchema.Type;

export const PiAmbientPiResourceEnablementSchema = Schema.Struct({
  kind: PiAmbientPiResourceKindSchema,
  resourceId: Schema.String,
  enabledByBindingFingerprint: GeneratedContextFingerprint,
});
export type PiAmbientPiResourceEnablement = typeof PiAmbientPiResourceEnablementSchema.Type;

export const CreatePiSessionInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  workspaceSessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  actorKind: ActorKindSchema,
  agentProfileId: Schema.optionalKey(AgentProfileId),
  generatedContextFingerprint: GeneratedContextFingerprint,
  model: ModelSelectionSchema,
  reasoning: ReasoningSelectionSchema,
});
export type CreatePiSessionInput = typeof CreatePiSessionInputSchema.Type;

export const OpenPiSessionInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  surfacePiSessionId: SurfacePiSessionId,
  expectedReference: Schema.optionalKey(PiSessionReferenceSchema),
  actorKind: ActorKindSchema,
});
export type OpenPiSessionInput = typeof OpenPiSessionInputSchema.Type;

export const ClosePiSessionInputSchema = Schema.Struct({
  session: PiSessionRefSchema,
});
export type ClosePiSessionInput = typeof ClosePiSessionInputSchema.Type;

export const PiToolExecutionInputSchema = Schema.Struct({
  turnId: TurnId,
  surfacePiSessionId: SurfacePiSessionId,
  piToolCallId: ToolCallId,
  toolName: Schema.String,
  argumentsJson: Schema.String,
  argumentsSnapshotSequence: Schema.optionalKey(NonNegativeSafeIntegerSchema),
});
export type PiToolExecutionInput = typeof PiToolExecutionInputSchema.Type;

export const PiToolExecutionUpdateSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("accepted"),
    commandId: CommandId,
    acceptedAt: IsoDateTimeStringSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("arguments_snapshot"),
    commandId: CommandId,
    sequence: NonNegativeSafeIntegerSchema,
    argumentsJson: Schema.String,
    occurredAt: IsoDateTimeStringSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("progress"),
    commandId: CommandId,
    message: Schema.String,
    occurredAt: IsoDateTimeStringSchema,
  }),
]);
export type PiToolExecutionUpdate = typeof PiToolExecutionUpdateSchema.Type;

export type PiToolExecutorInput = PiToolExecutionInput & {
  readonly emit: (update: PiToolExecutionUpdate) => Effect.Effect<void, RuntimeToolExecutionError>;
};

export type PiToolExecutor = (
  input: PiToolExecutorInput,
) => Effect.Effect<NativeToolResult, RuntimeToolExecutionError>;

export type RunPiTurnInput = {
  readonly session: PiSessionRef;
  readonly turnId: TurnId;
  readonly surfacePiSessionId: SurfacePiSessionId;
  readonly userMessage: RuntimeSubmittedMessage;
  readonly userMessageSubmittedAt: IsoDateTimeString;
  readonly systemPromptBinding: PiSystemPromptBinding;
  readonly model: ModelSelection;
  readonly reasoning: ReasoningSelection;
  readonly tools: readonly NativeToolDeclaration[];
  readonly toolExecutor: PiToolExecutor;
  readonly enabledAmbientPiResources?: readonly PiAmbientPiResourceEnablement[];
};

export const InterruptPiTurnInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  turnId: TurnId,
});
export type InterruptPiTurnInput = typeof InterruptPiTurnInputSchema.Type;

export const RestorePiHistoryEntryInputSchema = Schema.Struct({
  session: PiSessionRefSchema,
  entryId: PiHistoryEntryRefSchema,
});
export type RestorePiHistoryEntryInput = typeof RestorePiHistoryEntryInputSchema.Type;

export const ForkPiHistoryEntryInputSchema = Schema.Struct({
  session: PiSessionRefSchema,
  entryId: PiHistoryEntryRefSchema,
  targetSurfacePiSessionId: SurfacePiSessionId,
});
export type ForkPiHistoryEntryInput = typeof ForkPiHistoryEntryInputSchema.Type;

export const InputModalitySchema = Schema.Literals(["text", "image"]);
export type InputModality = typeof InputModalitySchema.Type;

export const ModelInfoSchema = Schema.Struct({
  providerId: ProviderId,
  modelId: ModelId,
  displayName: Schema.String,
  supportsReasoning: Schema.Boolean,
  supportedReasoning: Schema.Array(ReasoningEffortSchema),
  inputModalities: Schema.Array(InputModalitySchema),
  contextWindow: Schema.optionalKey(PositiveSafeIntegerSchema),
  maxOutputTokens: Schema.optionalKey(PositiveSafeIntegerSchema),
  authStatus: ProviderAuthStatusSchema,
});
export type ModelInfo = typeof ModelInfoSchema.Type;

export const ListModelsInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  providerId: Schema.optionalKey(ProviderId),
});
export type ListModelsInput = typeof ListModelsInputSchema.Type;

export const GenerateTitleInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  workspaceSessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
  threadId: Schema.optionalKey(ThreadId),
  prompt: Schema.String,
  model: ModelSelectionSchema,
  reasoning: ReasoningSelectionSchema,
});
export type GenerateTitleInput = typeof GenerateTitleInputSchema.Type;

export const GenerateTitleResultSchema = Schema.Struct({
  title: Schema.String,
  model: ModelSelectionSchema,
});
export type GenerateTitleResult = typeof GenerateTitleResultSchema.Type;

export const PiRuntimePathsSnapshotSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  cwd: AbsolutePath,
  agentDir: AbsolutePath,
  sessionDir: AbsolutePath,
  modelRegistryPath: AbsolutePath,
  source: Schema.Literals(["packaged-app", "test-fixture"]),
});
export type PiRuntimePathsSnapshot = typeof PiRuntimePathsSnapshotSchema.Type;

const PiRuntimeEventBaseSchema = {
  session: PiSessionRefSchema,
  turnId: TurnId,
  surfacePiSessionId: SurfacePiSessionId,
} as const;

export const PiRuntimeEventSchema = Schema.Union([
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.user_message.committed"),
    piMessageRef: Schema.String,
    piHistoryEntry: Schema.NullOr(PiHistoryEntryRefSchema),
    committedAt: IsoDateTimeStringSchema,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.assistant_message.started"),
    piMessageRef: Schema.String,
    api: Schema.NullOr(Schema.String),
    providerId: ProviderId,
    modelId: ModelId,
    startedAt: IsoDateTimeStringSchema,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.assistant_message.committed"),
    piMessageRef: Schema.String,
    content: RuntimeTranscriptAssistantContentSchema,
    api: Schema.NullOr(Schema.String),
    providerId: ProviderId,
    modelId: ModelId,
    responseId: Schema.NullOr(Schema.String),
    usage: Schema.NullOr(RuntimeTranscriptUsageSchema),
    stopReason: Schema.NullOr(RuntimeTranscriptAssistantStopReasonSchema),
    errorMessage: Schema.NullOr(Schema.String),
    piHistoryEntry: Schema.NullOr(PiHistoryEntryRefSchema),
    messageTimestamp: Schema.NullOr(IsoDateTimeStringSchema),
    finishedAt: IsoDateTimeStringSchema,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.assistant.text.delta"),
    piMessageRef: Schema.String,
    contentIndex: Schema.Number,
    delta: Schema.String,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.assistant.thinking.delta"),
    piMessageRef: Schema.String,
    contentIndex: Schema.Number,
    delta: Schema.String,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.tool_call.started"),
    piMessageRef: Schema.String,
    toolCallId: ToolCallId,
    toolName: Schema.String,
    contentIndex: Schema.Number,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.tool_call.arguments.delta"),
    piMessageRef: Schema.String,
    toolCallId: ToolCallId,
    toolName: Schema.String,
    delta: Schema.String,
    contentIndex: Schema.Number,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.tool_call.accepted"),
    piMessageRef: Schema.String,
    toolCallId: ToolCallId,
    toolName: Schema.String,
    argumentsJson: Schema.optionalKey(Schema.String),
    contentIndex: Schema.Number,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.tool_execution.started"),
    toolCallId: ToolCallId,
    toolName: Schema.String,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.tool_execution.updated"),
    toolCallId: ToolCallId,
    toolName: Schema.String,
    result: NativeToolResultSchema,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.tool_execution.updated"),
    toolCallId: ToolCallId,
    toolName: Schema.String,
    update: PiToolExecutionUpdateSchema,
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.tool_execution.finished"),
    toolCallId: ToolCallId,
    toolName: Schema.String,
    status: Schema.Literals(["completed", "failed", "cancelled"]),
    result: Schema.optionalKey(NativeToolResultSchema),
    error: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.turn.finished"),
    status: Schema.Literals(["completed", "failed", "cancelled"]),
    stopReason: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    ...PiRuntimeEventBaseSchema,
    type: Schema.Literal("pi.agent.finished"),
    status: Schema.Literals(["completed", "failed", "cancelled"]),
    stopReason: Schema.optionalKey(Schema.String),
  }),
]);
export type PiRuntimeEvent = typeof PiRuntimeEventSchema.Type;

export const decodeUnknownCreatePiSessionInputExit = Schema.decodeUnknownExit(
  CreatePiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownCreatePiSessionInputEffect = Schema.decodeUnknownEffect(
  CreatePiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const encodeCreatePiSessionInputExit = Schema.encodeExit(
  CreatePiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const encodeCreatePiSessionInputEffect = Schema.encodeEffect(
  CreatePiSessionInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownOpenPiSessionInputExit = Schema.decodeUnknownExit(
  OpenPiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownOpenPiSessionInputEffect = Schema.decodeUnknownEffect(
  OpenPiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const encodeOpenPiSessionInputExit = Schema.encodeExit(
  OpenPiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const encodeOpenPiSessionInputEffect = Schema.encodeEffect(
  OpenPiSessionInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownClosePiSessionInputExit = Schema.decodeUnknownExit(
  ClosePiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownClosePiSessionInputEffect = Schema.decodeUnknownEffect(
  ClosePiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const encodeClosePiSessionInputExit = Schema.encodeExit(
  ClosePiSessionInputSchema,
  strictBoundaryParseOptions,
);
export const encodeClosePiSessionInputEffect = Schema.encodeEffect(
  ClosePiSessionInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownInterruptPiTurnInputExit = Schema.decodeUnknownExit(
  InterruptPiTurnInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownInterruptPiTurnInputEffect = Schema.decodeUnknownEffect(
  InterruptPiTurnInputSchema,
  strictBoundaryParseOptions,
);
export const encodeInterruptPiTurnInputExit = Schema.encodeExit(
  InterruptPiTurnInputSchema,
  strictBoundaryParseOptions,
);
export const encodeInterruptPiTurnInputEffect = Schema.encodeEffect(
  InterruptPiTurnInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownListModelsInputExit = Schema.decodeUnknownExit(
  ListModelsInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownListModelsInputEffect = Schema.decodeUnknownEffect(
  ListModelsInputSchema,
  strictBoundaryParseOptions,
);
export const encodeListModelsInputExit = Schema.encodeExit(
  ListModelsInputSchema,
  strictBoundaryParseOptions,
);
export const encodeListModelsInputEffect = Schema.encodeEffect(
  ListModelsInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownModelInfoExit = Schema.decodeUnknownExit(
  ModelInfoSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownModelInfoEffect = Schema.decodeUnknownEffect(
  ModelInfoSchema,
  strictBoundaryParseOptions,
);
export const encodeModelInfoExit = Schema.encodeExit(ModelInfoSchema, strictBoundaryParseOptions);
export const encodeModelInfoEffect = Schema.encodeEffect(
  ModelInfoSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownGenerateTitleInputExit = Schema.decodeUnknownExit(
  GenerateTitleInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGenerateTitleInputEffect = Schema.decodeUnknownEffect(
  GenerateTitleInputSchema,
  strictBoundaryParseOptions,
);
export const encodeGenerateTitleInputExit = Schema.encodeExit(
  GenerateTitleInputSchema,
  strictBoundaryParseOptions,
);
export const encodeGenerateTitleInputEffect = Schema.encodeEffect(
  GenerateTitleInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownGenerateTitleResultExit = Schema.decodeUnknownExit(
  GenerateTitleResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGenerateTitleResultEffect = Schema.decodeUnknownEffect(
  GenerateTitleResultSchema,
  strictBoundaryParseOptions,
);
export const encodeGenerateTitleResultExit = Schema.encodeExit(
  GenerateTitleResultSchema,
  strictBoundaryParseOptions,
);
export const encodeGenerateTitleResultEffect = Schema.encodeEffect(
  GenerateTitleResultSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownPiRuntimePathsSnapshotExit = Schema.decodeUnknownExit(
  PiRuntimePathsSnapshotSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownPiRuntimePathsSnapshotEffect = Schema.decodeUnknownEffect(
  PiRuntimePathsSnapshotSchema,
  strictBoundaryParseOptions,
);
export const encodePiRuntimePathsSnapshotExit = Schema.encodeExit(
  PiRuntimePathsSnapshotSchema,
  strictBoundaryParseOptions,
);
export const encodePiRuntimePathsSnapshotEffect = Schema.encodeEffect(
  PiRuntimePathsSnapshotSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownModelSelectionExit = Schema.decodeUnknownExit(
  ModelSelectionSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownModelSelectionEffect = Schema.decodeUnknownEffect(
  ModelSelectionSchema,
  strictBoundaryParseOptions,
);
export const encodeModelSelectionExit = Schema.encodeExit(
  ModelSelectionSchema,
  strictBoundaryParseOptions,
);
export const encodeModelSelectionEffect = Schema.encodeEffect(
  ModelSelectionSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownReasoningSelectionExit = Schema.decodeUnknownExit(
  ReasoningSelectionSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownReasoningSelectionEffect = Schema.decodeUnknownEffect(
  ReasoningSelectionSchema,
  strictBoundaryParseOptions,
);
export const encodeReasoningSelectionExit = Schema.encodeExit(
  ReasoningSelectionSchema,
  strictBoundaryParseOptions,
);
export const encodeReasoningSelectionEffect = Schema.encodeEffect(
  ReasoningSelectionSchema,
  strictBoundaryParseOptions,
);

export const unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  PiRuntimeEventSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownPiRuntimeEventExit = Schema.decodeUnknownExit(
  PiRuntimeEventSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownPiRuntimeEventEffect = Schema.decodeUnknownEffect(
  PiRuntimeEventSchema,
  strictBoundaryParseOptions,
);
export const encodePiRuntimeEventExit = Schema.encodeExit(
  PiRuntimeEventSchema,
  strictBoundaryParseOptions,
);
export const encodePiRuntimeEventEffect = Schema.encodeEffect(
  PiRuntimeEventSchema,
  strictBoundaryParseOptions,
);
