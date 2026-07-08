import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import type { SecretStorePortError } from "./errors";
import { ExtensionId, IsoDateTimeStringSchema } from "./ids";

export const ExtensionEnvName = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(/^[A-Z_][A-Z0-9_]*$/),
).pipe(Schema.brand("ExtensionEnvName"));
export type ExtensionEnvName = typeof ExtensionEnvName.Type;

export const ExtensionEnvSecretRefSchema = Schema.Struct({
  kind: Schema.Literal("extension-env"),
  extensionId: ExtensionId,
  envName: ExtensionEnvName,
});
export type ExtensionEnvSecretRef = typeof ExtensionEnvSecretRefSchema.Type;

export const SecretStatusSnapshotSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  configured: Schema.Boolean,
  redactedLabel: Schema.optionalKey(Schema.String),
  revisionFingerprint: Schema.optionalKey(Schema.String),
  updatedAt: Schema.optionalKey(IsoDateTimeStringSchema),
});
export type SecretStatusSnapshot = typeof SecretStatusSnapshotSchema.Type;

export const SecretInvocationValueSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  value: Schema.Redacted(Schema.String, {
    label: "extension-env-secret",
    disallowJsonEncode: true,
  }),
  revisionFingerprint: Schema.String.check(Schema.isNonEmpty()),
});
export type SecretInvocationValue = typeof SecretInvocationValueSchema.Type;

export const GetSecretStatusInputSchema = ExtensionEnvSecretRefSchema;
export type GetSecretStatusInput = typeof GetSecretStatusInputSchema.Type;

export const ListSecretStatusInputSchema = Schema.Struct({
  kind: Schema.optionalKey(Schema.Literal("extension-env")),
  extensionId: Schema.optionalKey(ExtensionId),
});
export type ListSecretStatusInput = typeof ListSecretStatusInputSchema.Type;

export const ResolveSecretInvocationValueInputSchema = ExtensionEnvSecretRefSchema;
export type ResolveSecretInvocationValueInput = typeof ResolveSecretInvocationValueInputSchema.Type;

export const WriteSecretValueInputSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  value: Schema.Redacted(Schema.String.check(Schema.isNonEmpty()), {
    label: "extension-env-secret",
    disallowJsonEncode: true,
  }),
  expectedRevisionFingerprint: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export type WriteSecretValueInput = typeof WriteSecretValueInputSchema.Type;

export const WriteSecretValueResultSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  revisionFingerprint: Schema.String.check(Schema.isNonEmpty()),
});
export type WriteSecretValueResult = typeof WriteSecretValueResultSchema.Type;

export const RemoveSecretValueInputSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  expectedRevisionFingerprint: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export type RemoveSecretValueInput = typeof RemoveSecretValueInputSchema.Type;

export const RemoveSecretValueResultSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  removed: Schema.Boolean,
  revisionFingerprint: Schema.String.check(Schema.isNonEmpty()),
});
export type RemoveSecretValueResult = typeof RemoveSecretValueResultSchema.Type;

export const decodeUnknownGetSecretStatusInputExit = Schema.decodeUnknownExit(
  GetSecretStatusInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGetSecretStatusInputEffect = Schema.decodeUnknownEffect(
  GetSecretStatusInputSchema,
  strictBoundaryParseOptions,
);
export const encodeGetSecretStatusInputExit = Schema.encodeExit(
  GetSecretStatusInputSchema,
  strictBoundaryParseOptions,
);
export const encodeGetSecretStatusInputEffect = Schema.encodeEffect(
  GetSecretStatusInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownListSecretStatusInputExit = Schema.decodeUnknownExit(
  ListSecretStatusInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownListSecretStatusInputEffect = Schema.decodeUnknownEffect(
  ListSecretStatusInputSchema,
  strictBoundaryParseOptions,
);
export const encodeListSecretStatusInputExit = Schema.encodeExit(
  ListSecretStatusInputSchema,
  strictBoundaryParseOptions,
);
export const encodeListSecretStatusInputEffect = Schema.encodeEffect(
  ListSecretStatusInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownResolveSecretInvocationValueInputExit = Schema.decodeUnknownExit(
  ResolveSecretInvocationValueInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownResolveSecretInvocationValueInputEffect = Schema.decodeUnknownEffect(
  ResolveSecretInvocationValueInputSchema,
  strictBoundaryParseOptions,
);
export const encodeResolveSecretInvocationValueInputExit = Schema.encodeExit(
  ResolveSecretInvocationValueInputSchema,
  strictBoundaryParseOptions,
);
export const encodeResolveSecretInvocationValueInputEffect = Schema.encodeEffect(
  ResolveSecretInvocationValueInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownWriteSecretValueInputExit = Schema.decodeUnknownExit(
  WriteSecretValueInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWriteSecretValueInputEffect = Schema.decodeUnknownEffect(
  WriteSecretValueInputSchema,
  strictBoundaryParseOptions,
);
export const encodeWriteSecretValueInputExit = Schema.encodeExit(
  WriteSecretValueInputSchema,
  strictBoundaryParseOptions,
);
export const encodeWriteSecretValueInputEffect = Schema.encodeEffect(
  WriteSecretValueInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownRemoveSecretValueInputExit = Schema.decodeUnknownExit(
  RemoveSecretValueInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRemoveSecretValueInputEffect = Schema.decodeUnknownEffect(
  RemoveSecretValueInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRemoveSecretValueInputExit = Schema.encodeExit(
  RemoveSecretValueInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRemoveSecretValueInputEffect = Schema.encodeEffect(
  RemoveSecretValueInputSchema,
  strictBoundaryParseOptions,
);

export interface SecretStorePortService {
  getStatus(input: GetSecretStatusInput): Effect.Effect<SecretStatusSnapshot, SecretStorePortError>;
  listStatus(
    input: ListSecretStatusInput,
  ): Effect.Effect<readonly SecretStatusSnapshot[], SecretStorePortError>;
  resolveInvocationValue(
    input: ResolveSecretInvocationValueInput,
  ): Effect.Effect<SecretInvocationValue, SecretStorePortError>;
}

export interface SecretStoreMutationPortService {
  writeSecretValue(
    input: WriteSecretValueInput,
  ): Effect.Effect<WriteSecretValueResult, SecretStorePortError>;
  removeSecretValue(
    input: RemoveSecretValueInput,
  ): Effect.Effect<RemoveSecretValueResult, SecretStorePortError>;
}

export interface SecretStorePort {
  readonly _tag: "SecretStorePort";
}

export const SecretStorePort = Context.Service<SecretStorePort, SecretStorePortService>(
  "@svvy/core/SecretStorePort",
);

export interface SecretStoreMutationPort {
  readonly _tag: "SecretStoreMutationPort";
}

export const SecretStoreMutationPort = Context.Service<
  SecretStoreMutationPort,
  SecretStoreMutationPortService
>("@svvy/core/SecretStoreMutationPort");
