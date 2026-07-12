import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import type { StateContractError } from "./errors";
import {
  ActorBindingSchema,
  GeneratedContextSchema,
  SourceFingerprintSchema,
} from "./extension-contracts";
import { AgentProfileId, ExtensionId, ModelId, ProviderId, WorkspaceId } from "./ids";
import { ExtensionUsageStateSchema, ReasoningEffortSchema } from "./runtime-contracts";

const TokenEstimateSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
);

export const GeneratedContextPreviewSubjectSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("configured-profile"),
    actorKind: Schema.Literals(["orchestrator", "handler"]),
    profileId: AgentProfileId,
  }),
  Schema.Struct({
    kind: Schema.Literal("workflow-agent"),
    actorKind: Schema.Literal("workflow-task"),
    sourceId: Schema.String.check(Schema.isNonEmpty()),
  }),
]);
export type GeneratedContextPreviewSubject = typeof GeneratedContextPreviewSubjectSchema.Type;

export const PreviewGeneratedContextInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  subject: GeneratedContextPreviewSubjectSchema,
});
export type PreviewGeneratedContextInput = typeof PreviewGeneratedContextInputSchema.Type;

export const GeneratedContextPreviewSubjectRecordSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  subject: GeneratedContextPreviewSubjectSchema,
  profileId: Schema.String.check(Schema.isNonEmpty()),
  profileName: Schema.String.check(Schema.isNonEmpty()),
  providerId: ProviderId,
  modelId: ModelId,
  reasoningEffort: ReasoningEffortSchema,
  actorBinding: ActorBindingSchema,
  workflowTaskInlineInstructions: Schema.optionalKey(
    Schema.Struct({
      sourceRecordId: Schema.String.check(Schema.isNonEmpty()),
      sourceVersion: SourceFingerprintSchema,
      text: Schema.String,
    }),
  ),
});
export type GeneratedContextPreviewSubjectRecord =
  typeof GeneratedContextPreviewSubjectRecordSchema.Type;

export const GeneratedContextPreviewExtensionSchema = Schema.Struct({
  extensionId: ExtensionId,
  title: Schema.String.check(Schema.isNonEmpty()),
  description: Schema.String,
  state: ExtensionUsageStateSchema,
  instruction: Schema.String,
  tokenEstimate: Schema.NullOr(TokenEstimateSchema),
  loadedInstruction: Schema.NullOr(Schema.String),
  loadedTokenEstimate: Schema.NullOr(TokenEstimateSchema),
  sourcePath: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
});
export type GeneratedContextPreviewExtension = typeof GeneratedContextPreviewExtensionSchema.Type;

export const GeneratedContextPreviewResultSchema = Schema.Struct({
  subject: GeneratedContextPreviewSubjectSchema,
  profileId: Schema.String.check(Schema.isNonEmpty()),
  profileName: Schema.String.check(Schema.isNonEmpty()),
  providerId: ProviderId,
  modelId: ModelId,
  reasoningEffort: ReasoningEffortSchema,
  actorBinding: ActorBindingSchema,
  systemPrompt: Schema.String,
  tokenEstimate: TokenEstimateSchema,
  extensions: Schema.Array(GeneratedContextPreviewExtensionSchema),
  generatedContext: GeneratedContextSchema,
});
export type GeneratedContextPreviewResult = typeof GeneratedContextPreviewResultSchema.Type;

export interface GeneratedContextPreviewSubjectStatePortService {
  readSubject(
    input: PreviewGeneratedContextInput,
  ): Effect.Effect<GeneratedContextPreviewSubjectRecord, StateContractError>;
}

export interface GeneratedContextPreviewSubjectStatePort {
  readonly _tag: "GeneratedContextPreviewSubjectStatePort";
}

export const GeneratedContextPreviewSubjectStatePort = Context.Service<
  GeneratedContextPreviewSubjectStatePort,
  GeneratedContextPreviewSubjectStatePortService
>("@svvy/core/GeneratedContextPreviewSubjectStatePort");

export const decodeUnknownPreviewGeneratedContextInputEffect = Schema.decodeUnknownEffect(
  PreviewGeneratedContextInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownPreviewGeneratedContextInputExit = Schema.decodeUnknownExit(
  PreviewGeneratedContextInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGeneratedContextPreviewResultEffect = Schema.decodeUnknownEffect(
  GeneratedContextPreviewResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGeneratedContextPreviewResultExit = Schema.decodeUnknownExit(
  GeneratedContextPreviewResultSchema,
  strictBoundaryParseOptions,
);
export const encodeGeneratedContextPreviewResultEffect = Schema.encodeEffect(
  GeneratedContextPreviewResultSchema,
  strictBoundaryParseOptions,
);
export const encodeGeneratedContextPreviewResultExit = Schema.encodeExit(
  GeneratedContextPreviewResultSchema,
  strictBoundaryParseOptions,
);
