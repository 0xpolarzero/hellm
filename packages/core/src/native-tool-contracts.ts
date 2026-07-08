import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { PositiveSafeIntegerSchema } from "./ids";

export const NativeToolSchemaExtensionSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  category: Schema.String,
  interface: Schema.String,
});
export type NativeToolSchemaExtension = typeof NativeToolSchemaExtensionSchema.Type;

export const RuntimeStateDomainSchema = Schema.Literals([
  "surface",
  "queue",
  "command",
  "request-input",
  "approval",
  "artifact",
  "extension-state",
  "generated-context",
  "generated-package",
  "source",
  "recovery",
]);
export type RuntimeStateDomain = typeof RuntimeStateDomainSchema.Type;

export const NativeToolConcurrencyContractSchema = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("serial"),
  }),
  Schema.Struct({
    mode: Schema.Literal("parallel-safe"),
    stateDomains: Schema.Array(RuntimeStateDomainSchema),
    orderingKey: Schema.Literals(["surface", "command", "workspace", "none"]),
    maxConcurrency: PositiveSafeIntegerSchema,
  }),
]);
export type NativeToolConcurrencyContract = typeof NativeToolConcurrencyContractSchema.Type;

export const NativeToolDeclarationSchema = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  description: Schema.String,
  parameters: Schema.Json,
  concurrency: Schema.optionalKey(NativeToolConcurrencyContractSchema),
});
export type NativeToolDeclaration = typeof NativeToolDeclarationSchema.Type;

export const unsafeDecodeNativeToolDeclarationSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  NativeToolDeclarationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownNativeToolDeclarationExit = Schema.decodeUnknownExit(
  NativeToolDeclarationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownNativeToolDeclarationEffect = Schema.decodeUnknownEffect(
  NativeToolDeclarationSchema,
  strictBoundaryParseOptions,
);
export const encodeNativeToolDeclarationExit = Schema.encodeExit(
  NativeToolDeclarationSchema,
  strictBoundaryParseOptions,
);
export const encodeNativeToolDeclarationEffect = Schema.encodeEffect(
  NativeToolDeclarationSchema,
  strictBoundaryParseOptions,
);

export const NativeToolSchemaSchema = NativeToolDeclarationSchema;
export type NativeToolSchema = typeof NativeToolSchemaSchema.Type;

export const NativeToolExtensionSchemaSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  category: Schema.String,
  tools: Schema.Array(NativeToolSchemaSchema),
});
export type NativeToolExtensionSchema = typeof NativeToolExtensionSchemaSchema.Type;

export const NativeToolSchemasDocumentSchema = Schema.Struct({
  nativeTools: Schema.Array(NativeToolExtensionSchemaSchema),
});
export type NativeToolSchemasDocument = typeof NativeToolSchemasDocumentSchema.Type;

export const unsafeDecodeNativeToolSchemasDocumentSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(NativeToolSchemasDocumentSchema, strictBoundaryParseOptions);
export const decodeUnknownNativeToolSchemasDocumentExit = Schema.decodeUnknownExit(
  NativeToolSchemasDocumentSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownNativeToolSchemasDocumentEffect = Schema.decodeUnknownEffect(
  NativeToolSchemasDocumentSchema,
  strictBoundaryParseOptions,
);
export const encodeNativeToolSchemasDocumentExit = Schema.encodeExit(
  NativeToolSchemasDocumentSchema,
  strictBoundaryParseOptions,
);
export const encodeNativeToolSchemasDocumentEffect = Schema.encodeEffect(
  NativeToolSchemasDocumentSchema,
  strictBoundaryParseOptions,
);

export const NativeToolTextContentSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  textSignature: Schema.optionalKey(Schema.String),
});
export type NativeToolTextContent = typeof NativeToolTextContentSchema.Type;

export const NativeToolImageContentSchema = Schema.Struct({
  type: Schema.Literal("image"),
  data: Schema.String,
  mimeType: Schema.String,
});
export type NativeToolImageContent = typeof NativeToolImageContentSchema.Type;

export type NativeToolContent = NativeToolTextContent | NativeToolImageContent;

export const NativeToolContentSchema = Schema.Union([
  NativeToolTextContentSchema,
  NativeToolImageContentSchema,
]);

export const CommandFactsPayloadSchema = Schema.Record(Schema.String, Schema.Json);
export type CommandFactsPayload = typeof CommandFactsPayloadSchema.Type;

export const CommandResultEnvelopeSchema = Schema.Struct({
  status: Schema.optionalKey(Schema.Literals(["succeeded", "failed", "cancelled"])),
  summary: Schema.optionalKey(Schema.String),
  commandFacts: Schema.optionalKey(CommandFactsPayloadSchema),
});
export type CommandResultEnvelope = typeof CommandResultEnvelopeSchema.Type;

export const unsafeDecodeCommandResultEnvelopeSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  CommandResultEnvelopeSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownCommandResultEnvelopeExit = Schema.decodeUnknownExit(
  CommandResultEnvelopeSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownCommandResultEnvelopeEffect = Schema.decodeUnknownEffect(
  CommandResultEnvelopeSchema,
  strictBoundaryParseOptions,
);
export const encodeCommandResultEnvelopeExit = Schema.encodeExit(
  CommandResultEnvelopeSchema,
  strictBoundaryParseOptions,
);
export const encodeCommandResultEnvelopeEffect = Schema.encodeEffect(
  CommandResultEnvelopeSchema,
  strictBoundaryParseOptions,
);

export const NativeToolResultSchema = Schema.Struct({
  content: Schema.optionalKey(Schema.Array(NativeToolContentSchema)),
  details: Schema.optionalKey(CommandResultEnvelopeSchema),
});

export type NativeToolResult = typeof NativeToolResultSchema.Type;

export const unsafeDecodeNativeToolResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownNativeToolResultExit = Schema.decodeUnknownExit(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownNativeToolResultEffect = Schema.decodeUnknownEffect(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);
export const encodeNativeToolResultExit = Schema.encodeExit(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);
export const encodeNativeToolResultEffect = Schema.encodeEffect(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);

export type NativeToolUpdateHandler = (update: NativeToolResult) => void | Promise<void>;

export type NativeToolExecutionInput<TParams = unknown> = {
  name: string;
  toolCallId: string;
  params: TParams;
  signal?: AbortSignal;
  onUpdate?: NativeToolUpdateHandler;
};

export type NativeToolExecutor = {
  invoke(input: NativeToolExecutionInput): Promise<NativeToolResult>;
};
