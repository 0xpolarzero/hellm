import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  AbsolutePath,
  CommandId,
  ExtensionId,
  IsoDateTimeStringSchema,
  type IsoDateTimeString,
} from "./ids";
import type { StateContractError } from "./errors";
import {
  ExtensionDependencyReadinessSchema,
  type ExtensionDependencyReadiness,
} from "./runtime-state-ports";

export interface ExtensionDependencyApprovalIdentity {
  readonly kind: "dependency" | "trusted_dependency";
  readonly packageManager: "bun";
  readonly source: "npm";
  readonly name: string;
  readonly version: string;
  readonly integrity: string | null;
  readonly resolution: string | null;
}

export const ExtensionDependencyApprovalIdentitySchema = Schema.Struct({
  kind: Schema.Literals(["dependency", "trusted_dependency"]),
  packageManager: Schema.Literal("bun"),
  source: Schema.Literal("npm"),
  name: Schema.String.check(Schema.isNonEmpty()),
  version: Schema.String.check(Schema.isNonEmpty()),
  integrity: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
  resolution: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
});
export const decodeUnknownExtensionDependencyApprovalIdentityExit = Schema.decodeUnknownExit(
  ExtensionDependencyApprovalIdentitySchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionDependencyApprovalIdentityEffect = Schema.decodeUnknownEffect(
  ExtensionDependencyApprovalIdentitySchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionDependencyApprovalIdentityExit = Schema.encodeExit(
  ExtensionDependencyApprovalIdentitySchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionDependencyApprovalIdentityEffect = Schema.encodeEffect(
  ExtensionDependencyApprovalIdentitySchema,
  strictBoundaryParseOptions,
);

export interface ExtensionDependencyApprovalRecord {
  readonly dependency: ExtensionDependencyApprovalIdentity;
  readonly approvedAt: IsoDateTimeString;
  readonly approvedBy: "user";
  readonly sourceCommandId: CommandId | null;
}

export const ExtensionDependencyApprovalRecordSchema = Schema.Struct({
  dependency: ExtensionDependencyApprovalIdentitySchema,
  approvedAt: IsoDateTimeStringSchema,
  approvedBy: Schema.Literal("user"),
  sourceCommandId: Schema.NullOr(CommandId),
});
export const decodeUnknownExtensionDependencyApprovalRecordExit = Schema.decodeUnknownExit(
  ExtensionDependencyApprovalRecordSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionDependencyApprovalRecordEffect = Schema.decodeUnknownEffect(
  ExtensionDependencyApprovalRecordSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionDependencyApprovalRecordExit = Schema.encodeExit(
  ExtensionDependencyApprovalRecordSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionDependencyApprovalRecordEffect = Schema.encodeEffect(
  ExtensionDependencyApprovalRecordSchema,
  strictBoundaryParseOptions,
);

export interface ReadExtensionSourceFingerprintInput {
  readonly sourceRoot: AbsolutePath;
}

export const ReadExtensionSourceFingerprintInputSchema = Schema.Struct({
  sourceRoot: AbsolutePath,
});
export const decodeUnknownReadExtensionSourceFingerprintInputExit = Schema.decodeUnknownExit(
  ReadExtensionSourceFingerprintInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownReadExtensionSourceFingerprintInputEffect = Schema.decodeUnknownEffect(
  ReadExtensionSourceFingerprintInputSchema,
  strictBoundaryParseOptions,
);
export const encodeReadExtensionSourceFingerprintInputExit = Schema.encodeExit(
  ReadExtensionSourceFingerprintInputSchema,
  strictBoundaryParseOptions,
);
export const encodeReadExtensionSourceFingerprintInputEffect = Schema.encodeEffect(
  ReadExtensionSourceFingerprintInputSchema,
  strictBoundaryParseOptions,
);

export interface ReadExtensionDependencyApprovalInput {
  readonly dependency: ExtensionDependencyApprovalIdentity;
}

export const ReadExtensionDependencyApprovalInputSchema = Schema.Struct({
  dependency: ExtensionDependencyApprovalIdentitySchema,
});
export const decodeUnknownReadExtensionDependencyApprovalInputExit = Schema.decodeUnknownExit(
  ReadExtensionDependencyApprovalInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownReadExtensionDependencyApprovalInputEffect = Schema.decodeUnknownEffect(
  ReadExtensionDependencyApprovalInputSchema,
  strictBoundaryParseOptions,
);
export const encodeReadExtensionDependencyApprovalInputExit = Schema.encodeExit(
  ReadExtensionDependencyApprovalInputSchema,
  strictBoundaryParseOptions,
);
export const encodeReadExtensionDependencyApprovalInputEffect = Schema.encodeEffect(
  ReadExtensionDependencyApprovalInputSchema,
  strictBoundaryParseOptions,
);

export interface RecordExtensionDependencyApprovalInput {
  readonly dependency: ExtensionDependencyApprovalIdentity;
  readonly approvedAt: IsoDateTimeString;
  readonly approvedBy: "user";
  readonly sourceCommandId?: CommandId | null;
}

export const RecordExtensionDependencyApprovalInputSchema = Schema.Struct({
  dependency: ExtensionDependencyApprovalIdentitySchema,
  approvedAt: IsoDateTimeStringSchema,
  approvedBy: Schema.Literal("user"),
  sourceCommandId: Schema.optionalKey(Schema.NullOr(CommandId)),
});
export const decodeUnknownRecordExtensionDependencyApprovalInputExit = Schema.decodeUnknownExit(
  RecordExtensionDependencyApprovalInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRecordExtensionDependencyApprovalInputEffect = Schema.decodeUnknownEffect(
  RecordExtensionDependencyApprovalInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRecordExtensionDependencyApprovalInputExit = Schema.encodeExit(
  RecordExtensionDependencyApprovalInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRecordExtensionDependencyApprovalInputEffect = Schema.encodeEffect(
  RecordExtensionDependencyApprovalInputSchema,
  strictBoundaryParseOptions,
);

export interface ReadExtensionDependencyReadinessInput {
  readonly extensionId: ExtensionDependencyReadiness["extensionId"];
  readonly requirementId: ExtensionDependencyReadiness["requirementId"];
}

export const ReadExtensionDependencyReadinessInputSchema = Schema.Struct({
  extensionId: ExtensionId,
  requirementId: ExtensionDependencyReadinessSchema.fields.requirementId,
});
export const decodeUnknownReadExtensionDependencyReadinessInputExit = Schema.decodeUnknownExit(
  ReadExtensionDependencyReadinessInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownReadExtensionDependencyReadinessInputEffect = Schema.decodeUnknownEffect(
  ReadExtensionDependencyReadinessInputSchema,
  strictBoundaryParseOptions,
);
export const encodeReadExtensionDependencyReadinessInputExit = Schema.encodeExit(
  ReadExtensionDependencyReadinessInputSchema,
  strictBoundaryParseOptions,
);
export const encodeReadExtensionDependencyReadinessInputEffect = Schema.encodeEffect(
  ReadExtensionDependencyReadinessInputSchema,
  strictBoundaryParseOptions,
);

export interface ExtensionStatePortService {
  readonly records: {
    readSourceFingerprint(
      input: ReadExtensionSourceFingerprintInput,
    ): Effect.Effect<string | null, StateContractError>;
  };
  readonly dependencies: {
    isApproved(
      input: ReadExtensionDependencyApprovalInput,
    ): Effect.Effect<boolean, StateContractError>;
    readReadiness(
      input: ReadExtensionDependencyReadinessInput,
    ): Effect.Effect<ExtensionDependencyReadiness | null, StateContractError>;
  };
}

export interface ExtensionStatePort {
  readonly _tag: "ExtensionStatePort";
}

export const ExtensionStatePort = Context.Service<ExtensionStatePort, ExtensionStatePortService>(
  "@svvy/core/ExtensionStatePort",
);
