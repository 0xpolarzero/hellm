import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  CommandId,
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  SurfacePiSessionId,
  ToolCallId,
  TurnId,
  WorkspaceId,
} from "./ids";
import { StateInvalidationDescriptorSchema } from "./runtime-invalidation-contracts";

export const BoundaryIssueSchema = Schema.Struct({
  path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
  message: Schema.String,
});

export type BoundaryIssue = typeof BoundaryIssueSchema.Type;

export const normalizeBoundaryIssuePath = (
  path: ReadonlyArray<unknown> | undefined,
): BoundaryIssue["path"] => path?.flatMap(normalizeBoundaryIssuePathSegment) ?? [];

const normalizeBoundaryIssuePathSegment = (segment: unknown): BoundaryIssue["path"] => {
  if (segment === null || segment === undefined) {
    return [];
  }

  if (typeof segment === "string" || typeof segment === "number") {
    return [segment];
  }

  if (typeof segment === "symbol") {
    return [segment.description ?? String(segment)];
  }

  if (typeof segment === "object" && "key" in segment) {
    return normalizeBoundaryIssuePathSegment(segment.key);
  }

  return [String(segment)];
};

export const formatBoundaryIssues = (schemaError: Schema.SchemaError): BoundaryIssue[] =>
  SchemaIssue.makeFormatterStandardSchemaV1()(schemaError.issue).issues.map((issue) => ({
    path: normalizeBoundaryIssuePath(issue.path),
    message: issue.message,
  }));

export const schemaErrorMessage = (schemaError: Schema.SchemaError): string =>
  formatBoundaryIssues(schemaError)
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");

export const boundarySchemaErrorDetails = (schemaError: Schema.SchemaError) => {
  const issues = formatBoundaryIssues(schemaError);
  return {
    message: issues
      .map((issue) =>
        issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      )
      .join("; "),
    issues,
  };
};

export const StoredErrorReasonSchema = Schema.Literals([
  "invalid-input",
  "decode-failed",
  "encode-failed",
  "not-found",
  "conflict",
  "persistence-failed",
  "execution-failed",
  "cancelled",
  "interrupted",
  "timed-out",
  "denied",
  "unavailable",
  "unknown",
]);
export type StoredErrorReason = typeof StoredErrorReasonSchema.Type;

export const StateStoredErrorSchema = Schema.Struct({
  errorTag: Schema.String,
  operation: Schema.String,
  reason: StoredErrorReasonSchema,
  packageReason: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  message: Schema.String,
  interrupted: Schema.optionalKey(Schema.Boolean),
  timedOut: Schema.optionalKey(Schema.Boolean),
  exitCode: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
});

export type StateStoredError = typeof StateStoredErrorSchema.Type;
export const decodeUnknownStateStoredErrorExit = Schema.decodeUnknownExit(
  StateStoredErrorSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownStateStoredErrorEffect = Schema.decodeUnknownEffect(
  StateStoredErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeStateStoredErrorExit = Schema.encodeExit(
  StateStoredErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeStateStoredErrorEffect = Schema.encodeEffect(
  StateStoredErrorSchema,
  strictBoundaryParseOptions,
);

export class RuntimeContractError extends Schema.TaggedErrorClass<RuntimeContractError>()(
  "RuntimeContractError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "schema-error",
      "target-not-found",
      "target-not-ready",
      "surface-not-messageable",
      "stale-state",
      "state-conflict",
      "unsupported-operation",
      "startup-pending",
      "startup-failed",
      "runtime-shutdown",
      "runtime-disposed",
      "runtime-closed",
      "backpressure",
      "approval-required",
      "dependency-not-ready",
      "read-only-source",
      "event-replay-unavailable",
      "stream-failed",
      "bridge-invalid-request",
      "bridge-payload-too-large",
      "bridge-forbidden",
      "source-command-not-found",
      "source-command-not-handler-owned",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class RuntimeEventRebaselineRequired extends Schema.TaggedErrorClass<RuntimeEventRebaselineRequired>()(
  "RuntimeEventRebaselineRequired",
  {
    reason: Schema.Literals(["stale-cursor", "generation-changed", "filter-not-lossless"]),
    requestedAfterSequence: RuntimeEventSequence,
    retainedFromSequence: RuntimeEventSequence,
    currentHighWaterSequence: RuntimeEventSequence,
    eventGenerationId: RuntimeEventGenerationId,
    affectedReadModels: Schema.Array(StateInvalidationDescriptorSchema),
    workspaceId: Schema.optionalKey(WorkspaceId),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  },
) {}

export class RuntimeEventStreamError extends Schema.TaggedErrorClass<RuntimeEventStreamError>()(
  "RuntimeEventStreamError",
  {
    operation: Schema.String,
    reason: Schema.Literals(["subscriber-closed", "stream-failed"]),
    message: Schema.String,
    lastContiguousSequence: Schema.optionalKey(RuntimeEventSequence),
    latestSequence: Schema.optionalKey(RuntimeEventSequence),
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export type RuntimeEventError = RuntimeEventRebaselineRequired | RuntimeEventStreamError;

export class StateContractError extends Schema.TaggedErrorClass<StateContractError>()(
  "StateContractError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "not-found",
      "conflict",
      "stale-state",
      "claim-conflict",
      "transaction-failed",
      "decode-failed",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class SandboxPolicyError extends Schema.TaggedErrorClass<SandboxPolicyError>()(
  "SandboxPolicyError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-policy",
      "snapshot-mismatch",
      "helper-unavailable",
      "profile-generation-failed",
      "unsupported-platform",
      "denied",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class PiAdapterError extends Schema.TaggedErrorClass<PiAdapterError>()("PiAdapterError", {
  operation: Schema.String,
  reason: Schema.Literals([
    "provider-auth-failed",
    "provider-auth-missing",
    "provider-auth-expired",
    "provider-auth-refresh-failed",
    "runtime-paths-failed",
    "session-conflict",
    "session-not-found",
    "session-open-failed",
    "session-create-failed",
    "session-close-failed",
    "session-reference-failed",
    "active-turn-running",
    "turn-not-active",
    "turn-mismatch",
    "turn-already-terminal",
    "turn-failed",
    "event-decode-failed",
    "model-read-failed",
    "history-operation-failed",
    "helper-job-failed",
    "tool-execution-failed",
  ]),
  message: Schema.String,
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
}) {}

export class ProviderAuthPortError extends Schema.TaggedErrorClass<ProviderAuthPortError>()(
  "ProviderAuthPortError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "credentials-missing",
      "credentials-unusable",
      "refresh-failed",
      "state-conflict",
      "persistence-failed",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class SecretStorePortError extends Schema.TaggedErrorClass<SecretStorePortError>()(
  "SecretStorePortError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "secret-not-found",
      "secret-unavailable",
      "state-conflict",
      "persistence-failed",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class PiSessionReferencePortError extends Schema.TaggedErrorClass<PiSessionReferencePortError>()(
  "PiSessionReferencePortError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "reference-not-found",
      "stale-reference",
      "state-conflict",
      "persistence-failed",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class RuntimeToolExecutionError extends Schema.TaggedErrorClass<RuntimeToolExecutionError>()(
  "RuntimeToolExecutionError",
  {
    turnId: TurnId,
    surfacePiSessionId: SurfacePiSessionId,
    piToolCallId: ToolCallId,
    toolName: Schema.String,
    commandId: Schema.optionalKey(CommandId),
    reason: Schema.Literals([
      "tool-not-found",
      "invalid-arguments",
      "extension-failed",
      "runtime-effect-failed",
      "cancelled",
      "state-conflict",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class ExtensionError extends Schema.TaggedErrorClass<ExtensionError>()("ExtensionError", {
  extensionId: Schema.optionalKey(Schema.String),
  operation: Schema.String,
  reason: Schema.Literals([
    "invalid-input",
    "not-found",
    "not-loaded",
    "dependency-not-ready",
    "unsupported-operation",
    "read-only-source",
    "execution-failed",
    "redaction-failed",
  ]),
  message: Schema.String,
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
}) {}

const RuntimeEventBoundaryErrorSchema = Schema.Union([
  RuntimeEventRebaselineRequired,
  RuntimeEventStreamError,
]);

const taggedErrorBoundaryEncodeOptions = {
  errors: "all",
} as const;

const makeStrictBoundaryTaggedErrorEncodeExit = <
  S extends Schema.Codec<Readonly<{ _tag: string }>, unknown, never, never>,
>(
  schema: S,
) => {
  const encode = Schema.encodeExit(schema, taggedErrorBoundaryEncodeOptions);
  const validateEncoded = Schema.decodeUnknownExit(schema, strictBoundaryParseOptions);
  return (error: S["Type"]) => {
    const encoded = encode(error);
    if (Exit.isFailure(encoded)) {
      return encoded;
    }

    const validated = validateEncoded(encoded.value);
    return Exit.isFailure(validated) ? validated : Exit.succeed(encoded.value);
  };
};

const makeStrictBoundaryTaggedErrorEncodeEffect = <
  S extends Schema.Codec<Readonly<{ _tag: string }>, unknown, never, never>,
>(
  schema: S,
) => {
  const encode = Schema.encodeEffect(schema, taggedErrorBoundaryEncodeOptions);
  const validateEncoded = Schema.decodeUnknownEffect(schema, strictBoundaryParseOptions);
  return (error: S["Type"]) =>
    Effect.flatMap(encode(error), (encoded) => Effect.as(validateEncoded(encoded), encoded));
};

export const decodeUnknownRuntimeContractErrorExit = Schema.decodeUnknownExit(
  RuntimeContractError,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeContractErrorEffect = Schema.decodeUnknownEffect(
  RuntimeContractError,
  strictBoundaryParseOptions,
);
export const encodeRuntimeContractErrorExit =
  makeStrictBoundaryTaggedErrorEncodeExit(RuntimeContractError);
export const encodeRuntimeContractErrorEffect =
  makeStrictBoundaryTaggedErrorEncodeEffect(RuntimeContractError);

export const decodeUnknownRuntimeEventRebaselineRequiredExit = Schema.decodeUnknownExit(
  RuntimeEventRebaselineRequired,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeEventRebaselineRequiredEffect = Schema.decodeUnknownEffect(
  RuntimeEventRebaselineRequired,
  strictBoundaryParseOptions,
);
export const encodeRuntimeEventRebaselineRequiredExit = makeStrictBoundaryTaggedErrorEncodeExit(
  RuntimeEventRebaselineRequired,
);
export const encodeRuntimeEventRebaselineRequiredEffect = makeStrictBoundaryTaggedErrorEncodeEffect(
  RuntimeEventRebaselineRequired,
);

export const decodeUnknownRuntimeEventStreamErrorExit = Schema.decodeUnknownExit(
  RuntimeEventStreamError,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeEventStreamErrorEffect = Schema.decodeUnknownEffect(
  RuntimeEventStreamError,
  strictBoundaryParseOptions,
);
export const encodeRuntimeEventStreamErrorExit =
  makeStrictBoundaryTaggedErrorEncodeExit(RuntimeEventStreamError);
export const encodeRuntimeEventStreamErrorEffect =
  makeStrictBoundaryTaggedErrorEncodeEffect(RuntimeEventStreamError);

export const decodeUnknownRuntimeEventErrorExit = Schema.decodeUnknownExit(
  RuntimeEventBoundaryErrorSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeEventErrorEffect = Schema.decodeUnknownEffect(
  RuntimeEventBoundaryErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeRuntimeEventErrorExit = makeStrictBoundaryTaggedErrorEncodeExit(
  RuntimeEventBoundaryErrorSchema,
);
export const encodeRuntimeEventErrorEffect = makeStrictBoundaryTaggedErrorEncodeEffect(
  RuntimeEventBoundaryErrorSchema,
);

export const decodeUnknownStateContractErrorExit = Schema.decodeUnknownExit(
  StateContractError,
  strictBoundaryParseOptions,
);
export const decodeUnknownStateContractErrorEffect = Schema.decodeUnknownEffect(
  StateContractError,
  strictBoundaryParseOptions,
);
export const encodeStateContractErrorExit =
  makeStrictBoundaryTaggedErrorEncodeExit(StateContractError);
export const encodeStateContractErrorEffect =
  makeStrictBoundaryTaggedErrorEncodeEffect(StateContractError);

export const decodeUnknownSandboxPolicyErrorExit = Schema.decodeUnknownExit(
  SandboxPolicyError,
  strictBoundaryParseOptions,
);
export const decodeUnknownSandboxPolicyErrorEffect = Schema.decodeUnknownEffect(
  SandboxPolicyError,
  strictBoundaryParseOptions,
);
export const encodeSandboxPolicyErrorExit =
  makeStrictBoundaryTaggedErrorEncodeExit(SandboxPolicyError);
export const encodeSandboxPolicyErrorEffect =
  makeStrictBoundaryTaggedErrorEncodeEffect(SandboxPolicyError);

export const decodeUnknownPiAdapterErrorExit = Schema.decodeUnknownExit(
  PiAdapterError,
  strictBoundaryParseOptions,
);
export const decodeUnknownPiAdapterErrorEffect = Schema.decodeUnknownEffect(
  PiAdapterError,
  strictBoundaryParseOptions,
);
export const encodePiAdapterErrorExit = makeStrictBoundaryTaggedErrorEncodeExit(PiAdapterError);
export const encodePiAdapterErrorEffect = makeStrictBoundaryTaggedErrorEncodeEffect(PiAdapterError);

export const decodeUnknownProviderAuthPortErrorExit = Schema.decodeUnknownExit(
  ProviderAuthPortError,
  strictBoundaryParseOptions,
);
export const decodeUnknownProviderAuthPortErrorEffect = Schema.decodeUnknownEffect(
  ProviderAuthPortError,
  strictBoundaryParseOptions,
);
export const encodeProviderAuthPortErrorExit =
  makeStrictBoundaryTaggedErrorEncodeExit(ProviderAuthPortError);
export const encodeProviderAuthPortErrorEffect =
  makeStrictBoundaryTaggedErrorEncodeEffect(ProviderAuthPortError);

export const decodeUnknownSecretStorePortErrorExit = Schema.decodeUnknownExit(
  SecretStorePortError,
  strictBoundaryParseOptions,
);
export const decodeUnknownSecretStorePortErrorEffect = Schema.decodeUnknownEffect(
  SecretStorePortError,
  strictBoundaryParseOptions,
);
export const encodeSecretStorePortErrorExit =
  makeStrictBoundaryTaggedErrorEncodeExit(SecretStorePortError);
export const encodeSecretStorePortErrorEffect =
  makeStrictBoundaryTaggedErrorEncodeEffect(SecretStorePortError);

export const decodeUnknownPiSessionReferencePortErrorExit = Schema.decodeUnknownExit(
  PiSessionReferencePortError,
  strictBoundaryParseOptions,
);
export const decodeUnknownPiSessionReferencePortErrorEffect = Schema.decodeUnknownEffect(
  PiSessionReferencePortError,
  strictBoundaryParseOptions,
);
export const encodePiSessionReferencePortErrorExit = makeStrictBoundaryTaggedErrorEncodeExit(
  PiSessionReferencePortError,
);
export const encodePiSessionReferencePortErrorEffect = makeStrictBoundaryTaggedErrorEncodeEffect(
  PiSessionReferencePortError,
);

export const decodeUnknownRuntimeToolExecutionErrorExit = Schema.decodeUnknownExit(
  RuntimeToolExecutionError,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeToolExecutionErrorEffect = Schema.decodeUnknownEffect(
  RuntimeToolExecutionError,
  strictBoundaryParseOptions,
);
export const encodeRuntimeToolExecutionErrorExit =
  makeStrictBoundaryTaggedErrorEncodeExit(RuntimeToolExecutionError);
export const encodeRuntimeToolExecutionErrorEffect =
  makeStrictBoundaryTaggedErrorEncodeEffect(RuntimeToolExecutionError);

export const decodeUnknownExtensionErrorExit = Schema.decodeUnknownExit(
  ExtensionError,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionErrorEffect = Schema.decodeUnknownEffect(
  ExtensionError,
  strictBoundaryParseOptions,
);
export const encodeExtensionErrorExit = makeStrictBoundaryTaggedErrorEncodeExit(ExtensionError);
export const encodeExtensionErrorEffect = makeStrictBoundaryTaggedErrorEncodeEffect(ExtensionError);
