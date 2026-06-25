import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";

export type NativeToolSchemaExtension = {
  id: string;
  title: string;
  description: string;
  category: string;
  interface: string;
};

export type NativeToolDeclaration = {
  name: string;
  label: string;
  description: string;
  parameters: object;
};

export type NativeToolSchema = NativeToolDeclaration;

export type NativeToolExtensionSchema = {
  id: string;
  title: string;
  description: string;
  category: string;
  tools: NativeToolSchema[];
};

export type NativeToolSchemasDocument = {
  nativeTools: NativeToolExtensionSchema[];
};

export const NativeToolTextContentSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  textSignature: Schema.optionalKey(Schema.String),
});

export type NativeToolTextContent = {
  type: "text";
  text: string;
  textSignature?: string;
};

export const NativeToolImageContentSchema = Schema.Struct({
  type: Schema.Literal("image"),
  data: Schema.String,
  mimeType: Schema.String,
});

export type NativeToolImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

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

export const decodeCommandResultEnvelope = Schema.decodeUnknownSync(
  CommandResultEnvelopeSchema,
  strictBoundaryParseOptions,
);
export const decodeCommandResultEnvelopeExit = Schema.decodeUnknownExit(
  CommandResultEnvelopeSchema,
  strictBoundaryParseOptions,
);
export const decodeCommandResultEnvelopeEffect = Schema.decodeUnknownEffect(
  CommandResultEnvelopeSchema,
  strictBoundaryParseOptions,
);

export const NativeToolResultSchema = Schema.Struct({
  content: Schema.Array(NativeToolContentSchema),
  details: Schema.optionalKey(CommandResultEnvelopeSchema),
});

export const decodeNativeToolResult = Schema.decodeUnknownSync(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);
export const decodeNativeToolResultExit = Schema.decodeUnknownExit(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);
export const decodeNativeToolResultEffect = Schema.decodeUnknownEffect(
  NativeToolResultSchema,
  strictBoundaryParseOptions,
);

export type NativeToolResult<TResult = unknown> = {
  content: NativeToolContent[];
  details?: TResult;
};

export type NativeToolUpdateHandler<TResult = unknown> = (
  update: NativeToolResult<TResult>,
) => void | Promise<void>;

export type NativeToolExecutionInput<TParams = unknown, TResult = unknown> = {
  name: string;
  toolCallId: string;
  params: TParams;
  signal?: AbortSignal;
  onUpdate?: NativeToolUpdateHandler<TResult>;
};

export type NativeToolExecutor = {
  invoke(input: NativeToolExecutionInput): Promise<NativeToolResult>;
};
