import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Redacted from "effect/Redacted";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import type {
  ExtensionSnapshotPayloadStoreError,
  SecretStorePortError,
  StateContractError,
} from "./errors";
import {
  ExtensionId,
  IsoDateTimeStringSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  RuntimeClientRequestId,
} from "./ids";
import {
  ExtensionUsageStateSchema,
  StateCommandReceiptSchema,
  StateRevisionSchema,
} from "./runtime-contracts";
import {
  RuntimeExtensionContextChangedSurfaceSchema,
  type StateMutationResult,
} from "./runtime-state-ports";

const NonBlankStringSchema = Schema.String.check(Schema.isPattern(/\S/));
const Sha256DigestSchema = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const SnapshotRelativePathSchema = Schema.String.check(
  Schema.isPattern(
    /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^/:]+(?:\/[^/:]+)*$/,
  ),
);

export const ExtensionSnapshotIdSchema = Schema.String.check(
  Schema.isPattern(/^extension-snapshot:[a-z0-9][a-z0-9-]*$/),
).pipe(Schema.brand("ExtensionSnapshotId"));
export type ExtensionSnapshotId = typeof ExtensionSnapshotIdSchema.Type;

export const ExtensionSnapshotRestoreAttemptIdSchema = Schema.String.check(
  Schema.isPattern(/^extension-snapshot-restore:[a-z0-9][a-z0-9-]*$/),
).pipe(Schema.brand("ExtensionSnapshotRestoreAttemptId"));
export type ExtensionSnapshotRestoreAttemptId = typeof ExtensionSnapshotRestoreAttemptIdSchema.Type;

export const ExtensionSnapshotCleanupIdSchema = Schema.String.check(
  Schema.isPattern(/^extension-snapshot-cleanup:[a-z0-9][a-z0-9-]*$/),
).pipe(Schema.brand("ExtensionSnapshotCleanupId"));
export type ExtensionSnapshotCleanupId = typeof ExtensionSnapshotCleanupIdSchema.Type;

/** Opaque app-private keychain reference. It is intentionally absent from public read DTOs. */
export const ExtensionSnapshotSecretPayloadRefSchema = Schema.String.check(
  Schema.isPattern(/^extension-snapshot-secret:v1:[a-z0-9][a-z0-9-]*$/),
).pipe(Schema.brand("ExtensionSnapshotSecretPayloadRef"));
export type ExtensionSnapshotSecretPayloadRef = typeof ExtensionSnapshotSecretPayloadRefSchema.Type;

export const ExtensionSnapshotPayloadRefSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  algorithm: Schema.Literal("sha256"),
  digest: Sha256DigestSchema,
  byteSize: NonNegativeSafeIntegerSchema,
  codec: Schema.Literal("svvy-extension-snapshot-json-v1"),
});
export type ExtensionSnapshotPayloadRef = typeof ExtensionSnapshotPayloadRefSchema.Type;

export const ExtensionSnapshotSourceFileSchema = Schema.Struct({
  relativePath: SnapshotRelativePathSchema,
  contentBase64: Schema.String.check(
    Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  ),
  contentHash: Sha256DigestSchema,
  byteSize: NonNegativeSafeIntegerSchema,
});

export const ExtensionSnapshotSourceSchema = Schema.Struct({
  extensionId: ExtensionId,
  category: Schema.Literals(["builtin", "user"]),
  files: Schema.Array(ExtensionSnapshotSourceFileSchema),
});
export type ExtensionSnapshotSource = typeof ExtensionSnapshotSourceSchema.Type;
export type ExtensionSnapshotSourceFile = typeof ExtensionSnapshotSourceFileSchema.Type;

export const ExtensionSnapshotUsageEntrySchema = Schema.Struct({
  extensionId: ExtensionId,
  usage: ExtensionUsageStateSchema,
});

export const ExtensionSnapshotActorSettingsSchema = Schema.Struct({
  actor: Schema.Literals(["orchestrator", "workflow-task"]),
  extensionOrder: Schema.Array(ExtensionId),
  extensionUsage: Schema.Array(ExtensionSnapshotUsageEntrySchema),
});

export const ExtensionSnapshotProfileSettingsSchema = Schema.Struct({
  actor: Schema.Literals(["orchestrator", "handler"]),
  profileId: NonBlankStringSchema,
  extensionOrder: Schema.Array(ExtensionId),
  extensionUsage: Schema.Array(ExtensionSnapshotUsageEntrySchema),
});

/** Secret declarations record presence only; secret values never enter snapshot payload bytes. */
export const ExtensionSnapshotSecretTargetSchema = Schema.Struct({
  extensionId: ExtensionId,
  envName: Schema.String.check(Schema.isPattern(/^[A-Z_][A-Z0-9_]*$/)),
  present: Schema.Boolean,
});

export const ExtensionSnapshotNonSecretEnvOverrideSchema = Schema.Struct({
  extensionId: ExtensionId,
  envName: Schema.String.check(Schema.isPattern(/^[A-Z_][A-Z0-9_]*$/)),
  value: Schema.String,
});

export const ExtensionSnapshotPayloadSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  capturedAt: IsoDateTimeStringSchema,
  sources: Schema.Array(ExtensionSnapshotSourceSchema),
  packageFiles: Schema.Array(ExtensionSnapshotSourceFileSchema),
  actorSettings: Schema.Array(ExtensionSnapshotActorSettingsSchema),
  profileSettings: Schema.Array(ExtensionSnapshotProfileSettingsSchema),
  nonSecretEnvOverrideScopes: Schema.Array(ExtensionId),
  nonSecretEnvOverrides: Schema.Array(ExtensionSnapshotNonSecretEnvOverrideSchema),
  secretTargets: Schema.Array(ExtensionSnapshotSecretTargetSchema),
});
export type ExtensionSnapshotPayload = typeof ExtensionSnapshotPayloadSchema.Type;

export const ExtensionSnapshotSecretStateSchema = Schema.Literals(["not-present", "captured"]);
export const ExtensionSnapshotStatusSchema = Schema.Literal("available");

/** Authoritative private metadata. Do not transport this record to a renderer. */
const ExtensionSnapshotStateRecordFields = Schema.Struct({
  snapshotId: ExtensionSnapshotIdSchema,
  name: NonBlankStringSchema,
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  revision: PositiveSafeIntegerSchema,
  payloadRef: ExtensionSnapshotPayloadRefSchema,
  secretPayloadRef: Schema.NullOr(ExtensionSnapshotSecretPayloadRefSchema),
  extensionCount: NonNegativeSafeIntegerSchema,
  secretState: ExtensionSnapshotSecretStateSchema,
  status: ExtensionSnapshotStatusSchema,
});
export const ExtensionSnapshotStateRecordSchema = ExtensionSnapshotStateRecordFields.pipe(
  Schema.check(
    Schema.makeFilter((record: typeof ExtensionSnapshotStateRecordFields.Type) =>
      (record.secretPayloadRef === null) === (record.secretState === "not-present")
        ? true
        : {
            path: ["secretState"],
            issue: "secret state must agree with the private secret payload reference",
          },
    ),
  ),
);
export type ExtensionSnapshotStateRecord = typeof ExtensionSnapshotStateRecordSchema.Type;

export const ExtensionSnapshotSummarySchema = Schema.Struct({
  snapshotId: ExtensionSnapshotIdSchema,
  name: NonBlankStringSchema,
  createdAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  revision: PositiveSafeIntegerSchema,
  extensionCount: NonNegativeSafeIntegerSchema,
  secretState: ExtensionSnapshotSecretStateSchema,
  status: ExtensionSnapshotStatusSchema,
});
export type ExtensionSnapshotSummary = typeof ExtensionSnapshotSummarySchema.Type;

export const ExtensionSnapshotsReadModelSchema = Schema.Struct({
  revision: StateRevisionSchema,
  snapshots: Schema.Array(ExtensionSnapshotSummarySchema),
});
export type ExtensionSnapshotsReadModel = typeof ExtensionSnapshotsReadModelSchema.Type;

const ClientRequestSchema = Schema.Struct({ clientRequestId: RuntimeClientRequestId });

export const SaveExtensionSnapshotCommandSchema = Schema.Struct({
  ...ClientRequestSchema.fields,
  snapshotId: ExtensionSnapshotIdSchema,
  name: NonBlankStringSchema,
  capturedAt: IsoDateTimeStringSchema,
  payloadRef: ExtensionSnapshotPayloadRefSchema,
  secretPayloadRef: Schema.NullOr(ExtensionSnapshotSecretPayloadRefSchema),
  extensionCount: NonNegativeSafeIntegerSchema,
});
export type SaveExtensionSnapshotCommand = typeof SaveExtensionSnapshotCommandSchema.Type;

export const RenameExtensionSnapshotCommandSchema = Schema.Struct({
  ...ClientRequestSchema.fields,
  snapshotId: ExtensionSnapshotIdSchema,
  name: NonBlankStringSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  renamedAt: IsoDateTimeStringSchema,
});
export type RenameExtensionSnapshotCommand = typeof RenameExtensionSnapshotCommandSchema.Type;

export const DeleteExtensionSnapshotCommandSchema = Schema.Struct({
  ...ClientRequestSchema.fields,
  snapshotId: ExtensionSnapshotIdSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  deletedAt: IsoDateTimeStringSchema,
  cleanupId: ExtensionSnapshotCleanupIdSchema,
});
export type DeleteExtensionSnapshotCommand = typeof DeleteExtensionSnapshotCommandSchema.Type;

export const LoadExtensionSnapshotCommandSchema = Schema.Struct({
  ...ClientRequestSchema.fields,
  snapshotId: ExtensionSnapshotIdSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  attemptId: ExtensionSnapshotRestoreAttemptIdSchema,
  startedAt: IsoDateTimeStringSchema,
});
export type LoadExtensionSnapshotCommand = typeof LoadExtensionSnapshotCommandSchema.Type;

export const ExtensionSnapshotCleanupRecordSchema = Schema.Struct({
  cleanupId: ExtensionSnapshotCleanupIdSchema,
  snapshotId: ExtensionSnapshotIdSchema,
  payloadRef: ExtensionSnapshotPayloadRefSchema,
  secretPayloadRef: Schema.NullOr(ExtensionSnapshotSecretPayloadRefSchema),
  requestedAt: IsoDateTimeStringSchema,
});
export type ExtensionSnapshotCleanupRecord = typeof ExtensionSnapshotCleanupRecordSchema.Type;

export const ExtensionSnapshotRestoreStatusSchema = Schema.Literals([
  "prepared",
  "payload-applied",
  "state-committed",
  "building",
  "completed",
  "failed",
]);
export type ExtensionSnapshotRestoreStatus = typeof ExtensionSnapshotRestoreStatusSchema.Type;
export const ExtensionSnapshotRestoreFailureReasonSchema = Schema.Literals([
  "payload-missing",
  "payload-corrupt",
  "secret-unavailable",
  "source-invalid",
  "apply-failed",
  "state-conflict",
  "build-failed",
  "cancelled",
  "unknown",
]);
export type ExtensionSnapshotRestoreFailureReason =
  typeof ExtensionSnapshotRestoreFailureReasonSchema.Type;

const ExtensionSnapshotRestoreAttemptFields = Schema.Struct({
  attemptId: ExtensionSnapshotRestoreAttemptIdSchema,
  snapshotId: ExtensionSnapshotIdSchema,
  clientRequestId: RuntimeClientRequestId,
  snapshotRevision: PositiveSafeIntegerSchema,
  payloadRef: ExtensionSnapshotPayloadRefSchema,
  secretPayloadRef: Schema.NullOr(ExtensionSnapshotSecretPayloadRefSchema),
  status: ExtensionSnapshotRestoreStatusSchema,
  startedAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  finishedAt: Schema.NullOr(IsoDateTimeStringSchema),
  failureReason: Schema.NullOr(ExtensionSnapshotRestoreFailureReasonSchema),
  affectedSurfaces: Schema.Array(RuntimeExtensionContextChangedSurfaceSchema),
});
export const ExtensionSnapshotRestoreAttemptSchema = ExtensionSnapshotRestoreAttemptFields.pipe(
  Schema.check(
    Schema.makeFilter((attempt: typeof ExtensionSnapshotRestoreAttemptFields.Type) => {
      const terminal = attempt.status === "completed" || attempt.status === "failed";
      if (terminal !== (attempt.finishedAt !== null)) {
        return { path: ["finishedAt"], issue: "only terminal restore attempts have a finish time" };
      }
      return (attempt.status === "failed") === (attempt.failureReason !== null)
        ? true
        : {
            path: ["failureReason"],
            issue: "only failed restore attempts carry a failure reason",
          };
    }),
  ),
);
export type ExtensionSnapshotRestoreAttempt = typeof ExtensionSnapshotRestoreAttemptSchema.Type;

export const AdvanceExtensionSnapshotRestoreAttemptCommandSchema = Schema.Struct({
  ...ClientRequestSchema.fields,
  attemptId: ExtensionSnapshotRestoreAttemptIdSchema,
  expectedStatus: ExtensionSnapshotRestoreStatusSchema,
  status: ExtensionSnapshotRestoreStatusSchema,
  updatedAt: IsoDateTimeStringSchema,
  failureReason: Schema.NullOr(ExtensionSnapshotRestoreFailureReasonSchema),
  affectedSurfaces: Schema.Array(RuntimeExtensionContextChangedSurfaceSchema),
});
export type AdvanceExtensionSnapshotRestoreAttemptCommand =
  typeof AdvanceExtensionSnapshotRestoreAttemptCommandSchema.Type;

export const CompleteExtensionSnapshotCleanupCommandSchema = Schema.Struct({
  ...ClientRequestSchema.fields,
  cleanupId: ExtensionSnapshotCleanupIdSchema,
  completedAt: IsoDateTimeStringSchema,
});
export type CompleteExtensionSnapshotCleanupCommand =
  typeof CompleteExtensionSnapshotCleanupCommandSchema.Type;

export const SaveExtensionSnapshotReceiptSchema = Schema.Struct({
  receipt: StateCommandReceiptSchema,
  snapshot: ExtensionSnapshotSummarySchema,
});
export const RenameExtensionSnapshotReceiptSchema = SaveExtensionSnapshotReceiptSchema;
export const DeleteExtensionSnapshotReceiptSchema = Schema.Struct({
  receipt: StateCommandReceiptSchema,
  snapshotId: ExtensionSnapshotIdSchema,
  cleanup: ExtensionSnapshotCleanupRecordSchema,
});
export const LoadExtensionSnapshotReceiptSchema = Schema.Struct({
  receipt: StateCommandReceiptSchema,
  attempt: ExtensionSnapshotRestoreAttemptSchema,
});
export const AdvanceExtensionSnapshotRestoreAttemptReceiptSchema =
  LoadExtensionSnapshotReceiptSchema;
export const CompleteExtensionSnapshotCleanupReceiptSchema = Schema.Struct({
  receipt: StateCommandReceiptSchema,
  cleanupId: ExtensionSnapshotCleanupIdSchema,
});

export const ExtensionSnapshotSourceRestorePlanIdSchema = Schema.String.check(
  Schema.isPattern(/^extension-snapshot-source-restore:[a-z0-9][a-z0-9-]*$/),
).pipe(Schema.brand("ExtensionSnapshotSourceRestorePlanId"));
export type ExtensionSnapshotSourceRestorePlanId =
  typeof ExtensionSnapshotSourceRestorePlanIdSchema.Type;

export const CaptureExtensionSnapshotSourcePayloadInputSchema = Schema.Struct({
  capturedAt: IsoDateTimeStringSchema,
  actorSettings: ExtensionSnapshotPayloadSchema.fields.actorSettings,
  profileSettings: ExtensionSnapshotPayloadSchema.fields.profileSettings,
  nonSecretEnvOverrideScopes: ExtensionSnapshotPayloadSchema.fields.nonSecretEnvOverrideScopes,
  nonSecretEnvOverrides: ExtensionSnapshotPayloadSchema.fields.nonSecretEnvOverrides,
  secretTargets: ExtensionSnapshotPayloadSchema.fields.secretTargets,
});
export type CaptureExtensionSnapshotSourcePayloadInput =
  typeof CaptureExtensionSnapshotSourcePayloadInputSchema.Type;

export const PrepareExtensionSnapshotSourceRestoreInputSchema = Schema.Struct({
  planId: ExtensionSnapshotSourceRestorePlanIdSchema,
  snapshotId: ExtensionSnapshotIdSchema,
  payload: ExtensionSnapshotPayloadSchema,
});
export type PrepareExtensionSnapshotSourceRestoreInput =
  typeof PrepareExtensionSnapshotSourceRestoreInputSchema.Type;

export const ExtensionSnapshotSourceRestorePlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  planId: ExtensionSnapshotSourceRestorePlanIdSchema,
  snapshotId: ExtensionSnapshotIdSchema,
  payloadDigest: Sha256DigestSchema,
  sourceCount: NonNegativeSafeIntegerSchema,
  fileCount: NonNegativeSafeIntegerSchema,
});
export type ExtensionSnapshotSourceRestorePlan =
  typeof ExtensionSnapshotSourceRestorePlanSchema.Type;

export const ApplyExtensionSnapshotSourceRestoreInputSchema = Schema.Struct({
  plan: ExtensionSnapshotSourceRestorePlanSchema,
});
export type ApplyExtensionSnapshotSourceRestoreInput =
  typeof ApplyExtensionSnapshotSourceRestoreInputSchema.Type;

export const ExtensionSnapshotSourceRestoreReceiptSchema = Schema.Struct({
  planId: ExtensionSnapshotSourceRestorePlanIdSchema,
  outcome: Schema.Literals(["applied", "recovered"]),
  sourceCount: NonNegativeSafeIntegerSchema,
  fileCount: NonNegativeSafeIntegerSchema,
  removedUserExtensionIds: Schema.Array(ExtensionId),
});
export type ExtensionSnapshotSourceRestoreReceipt =
  typeof ExtensionSnapshotSourceRestoreReceiptSchema.Type;

export const FinalizeExtensionSnapshotSourceRestoreInputSchema = Schema.Struct({
  planId: ExtensionSnapshotSourceRestorePlanIdSchema,
});
export type FinalizeExtensionSnapshotSourceRestoreInput =
  typeof FinalizeExtensionSnapshotSourceRestoreInputSchema.Type;

export const FinalizeExtensionSnapshotSourceRestoreResultSchema = Schema.Struct({
  planId: ExtensionSnapshotSourceRestorePlanIdSchema,
  outcome: Schema.Literals(["removed", "missing"]),
});
export type FinalizeExtensionSnapshotSourceRestoreResult =
  typeof FinalizeExtensionSnapshotSourceRestoreResultSchema.Type;

export type SaveExtensionSnapshotReceipt = typeof SaveExtensionSnapshotReceiptSchema.Type;
export type RenameExtensionSnapshotReceipt = typeof RenameExtensionSnapshotReceiptSchema.Type;
export type DeleteExtensionSnapshotReceipt = typeof DeleteExtensionSnapshotReceiptSchema.Type;
export type LoadExtensionSnapshotReceipt = typeof LoadExtensionSnapshotReceiptSchema.Type;
export type AdvanceExtensionSnapshotRestoreAttemptReceipt =
  typeof AdvanceExtensionSnapshotRestoreAttemptReceiptSchema.Type;
export type CompleteExtensionSnapshotCleanupReceipt =
  typeof CompleteExtensionSnapshotCleanupReceiptSchema.Type;

export const RuntimeListExtensionSnapshotsInputSchema = Schema.Struct({});
export type RuntimeListExtensionSnapshotsInput =
  typeof RuntimeListExtensionSnapshotsInputSchema.Type;

export const RuntimeSaveExtensionSnapshotInputSchema = Schema.Struct({
  clientRequestId: SaveExtensionSnapshotCommandSchema.fields.clientRequestId,
  snapshotId: SaveExtensionSnapshotCommandSchema.fields.snapshotId,
  name: SaveExtensionSnapshotCommandSchema.fields.name,
  capturedAt: SaveExtensionSnapshotCommandSchema.fields.capturedAt,
});
export type RuntimeSaveExtensionSnapshotInput = typeof RuntimeSaveExtensionSnapshotInputSchema.Type;

export const RuntimeRenameExtensionSnapshotInputSchema = Schema.Struct({
  clientRequestId: RenameExtensionSnapshotCommandSchema.fields.clientRequestId,
  snapshotId: RenameExtensionSnapshotCommandSchema.fields.snapshotId,
  name: RenameExtensionSnapshotCommandSchema.fields.name,
  expectedRevision: RenameExtensionSnapshotCommandSchema.fields.expectedRevision,
  renamedAt: RenameExtensionSnapshotCommandSchema.fields.renamedAt,
});
export type RuntimeRenameExtensionSnapshotInput =
  typeof RuntimeRenameExtensionSnapshotInputSchema.Type;

export const RuntimeDeleteExtensionSnapshotInputSchema = DeleteExtensionSnapshotCommandSchema;
export type RuntimeDeleteExtensionSnapshotInput =
  typeof RuntimeDeleteExtensionSnapshotInputSchema.Type;
export const RuntimeDeleteExtensionSnapshotResultSchema = Schema.Struct({
  snapshotId: ExtensionSnapshotIdSchema,
  deleted: Schema.Literal(true),
});
export type RuntimeDeleteExtensionSnapshotResult =
  typeof RuntimeDeleteExtensionSnapshotResultSchema.Type;

export const RuntimeLoadExtensionSnapshotInputSchema = LoadExtensionSnapshotCommandSchema;
export type RuntimeLoadExtensionSnapshotInput = typeof RuntimeLoadExtensionSnapshotInputSchema.Type;

export const RuntimeExtensionSnapshotBuildResultSchema = Schema.Struct({
  extensionId: ExtensionId,
  status: Schema.Literals(["succeeded", "failed", "blocked"]),
});
export type RuntimeExtensionSnapshotBuildResult =
  typeof RuntimeExtensionSnapshotBuildResultSchema.Type;

export const RuntimeLoadExtensionSnapshotResultSchema = Schema.Struct({
  snapshotId: ExtensionSnapshotIdSchema,
  attemptId: ExtensionSnapshotRestoreAttemptIdSchema,
  status: Schema.Literals(["completed", "failed", "blocked"]),
  builds: Schema.Array(RuntimeExtensionSnapshotBuildResultSchema),
  affectedSurfaces: Schema.Array(RuntimeExtensionContextChangedSurfaceSchema),
});
export type RuntimeLoadExtensionSnapshotResult =
  typeof RuntimeLoadExtensionSnapshotResultSchema.Type;

export const RuntimeEnsureInitialExtensionSnapshotResultSchema = Schema.Struct({
  outcome: Schema.Literals(["created", "existing", "skipped-nonempty"]),
  snapshot: Schema.NullOr(ExtensionSnapshotSummarySchema),
});
export type RuntimeEnsureInitialExtensionSnapshotResult =
  typeof RuntimeEnsureInitialExtensionSnapshotResultSchema.Type;

export const RuntimeListExtensionSnapshotsInputCodecs = codecs(
  RuntimeListExtensionSnapshotsInputSchema,
);
export const RuntimeSaveExtensionSnapshotInputCodecs = codecs(
  RuntimeSaveExtensionSnapshotInputSchema,
);
export const RuntimeRenameExtensionSnapshotInputCodecs = codecs(
  RuntimeRenameExtensionSnapshotInputSchema,
);
export const RuntimeDeleteExtensionSnapshotInputCodecs = codecs(
  RuntimeDeleteExtensionSnapshotInputSchema,
);
export const RuntimeDeleteExtensionSnapshotResultCodecs = codecs(
  RuntimeDeleteExtensionSnapshotResultSchema,
);
export const RuntimeLoadExtensionSnapshotInputCodecs = codecs(
  RuntimeLoadExtensionSnapshotInputSchema,
);
export const RuntimeLoadExtensionSnapshotResultCodecs = codecs(
  RuntimeLoadExtensionSnapshotResultSchema,
);
export const RuntimeEnsureInitialExtensionSnapshotResultCodecs = codecs(
  RuntimeEnsureInitialExtensionSnapshotResultSchema,
);

export interface ExtensionSnapshotSecretValuesCaptureResult {
  readonly bytes: Redacted.Redacted<Uint8Array> | null;
}

/**
 * App-host authority for copying extension secret values into and out of the opaque snapshot
 * secret store. Implementations must never persist values or material references in product state.
 */
export interface ExtensionSnapshotSecretValuesPortService {
  capture(
    targets: ExtensionSnapshotPayload["secretTargets"],
  ): Effect.Effect<ExtensionSnapshotSecretValuesCaptureResult, SecretStorePortError>;
  restore(input: {
    readonly targets: ExtensionSnapshotPayload["secretTargets"];
    readonly bytes: Redacted.Redacted<Uint8Array> | null;
    readonly clientRequestId: RuntimeClientRequestId;
  }): Effect.Effect<{ readonly restoredTargetCount: number }, SecretStorePortError>;
}
export interface ExtensionSnapshotSecretValuesPort {
  readonly _tag: "ExtensionSnapshotSecretValuesPort";
}
export const ExtensionSnapshotSecretValuesPort = Context.Service<
  ExtensionSnapshotSecretValuesPort,
  ExtensionSnapshotSecretValuesPortService
>("@svvy/core/ExtensionSnapshotSecretValuesPort");

function codecs<A, I>(schema: Schema.Codec<A, I, never, never>) {
  return {
    decodeEffect: Schema.decodeUnknownEffect(schema, strictBoundaryParseOptions),
    decodeExit: Schema.decodeUnknownExit(schema, strictBoundaryParseOptions),
    encodeEffect: Schema.encodeEffect(schema, strictBoundaryParseOptions),
    encodeExit: Schema.encodeExit(schema, strictBoundaryParseOptions),
  } as const;
}

export const ExtensionSnapshotPayloadCodecs = codecs(ExtensionSnapshotPayloadSchema);
export const ExtensionSnapshotPayloadRefCodecs = codecs(ExtensionSnapshotPayloadRefSchema);
export const ExtensionSnapshotStateRecordCodecs = codecs(ExtensionSnapshotStateRecordSchema);
export const ExtensionSnapshotSummaryCodecs = codecs(ExtensionSnapshotSummarySchema);
export const ExtensionSnapshotsReadModelCodecs = codecs(ExtensionSnapshotsReadModelSchema);
export const SaveExtensionSnapshotCommandCodecs = codecs(SaveExtensionSnapshotCommandSchema);
export const RenameExtensionSnapshotCommandCodecs = codecs(RenameExtensionSnapshotCommandSchema);
export const DeleteExtensionSnapshotCommandCodecs = codecs(DeleteExtensionSnapshotCommandSchema);
export const LoadExtensionSnapshotCommandCodecs = codecs(LoadExtensionSnapshotCommandSchema);
export const AdvanceExtensionSnapshotRestoreAttemptCommandCodecs = codecs(
  AdvanceExtensionSnapshotRestoreAttemptCommandSchema,
);
export const CompleteExtensionSnapshotCleanupCommandCodecs = codecs(
  CompleteExtensionSnapshotCleanupCommandSchema,
);
export const ExtensionSnapshotCleanupRecordCodecs = codecs(ExtensionSnapshotCleanupRecordSchema);
export const ExtensionSnapshotRestoreAttemptCodecs = codecs(ExtensionSnapshotRestoreAttemptSchema);
export const SaveExtensionSnapshotReceiptCodecs = codecs(SaveExtensionSnapshotReceiptSchema);
export const RenameExtensionSnapshotReceiptCodecs = codecs(RenameExtensionSnapshotReceiptSchema);
export const DeleteExtensionSnapshotReceiptCodecs = codecs(DeleteExtensionSnapshotReceiptSchema);
export const LoadExtensionSnapshotReceiptCodecs = codecs(LoadExtensionSnapshotReceiptSchema);
export const AdvanceExtensionSnapshotRestoreAttemptReceiptCodecs = codecs(
  AdvanceExtensionSnapshotRestoreAttemptReceiptSchema,
);
export const CompleteExtensionSnapshotCleanupReceiptCodecs = codecs(
  CompleteExtensionSnapshotCleanupReceiptSchema,
);
export const CaptureExtensionSnapshotSourcePayloadInputCodecs = codecs(
  CaptureExtensionSnapshotSourcePayloadInputSchema,
);
export const PrepareExtensionSnapshotSourceRestoreInputCodecs = codecs(
  PrepareExtensionSnapshotSourceRestoreInputSchema,
);
export const ExtensionSnapshotSourceRestorePlanCodecs = codecs(
  ExtensionSnapshotSourceRestorePlanSchema,
);
export const ApplyExtensionSnapshotSourceRestoreInputCodecs = codecs(
  ApplyExtensionSnapshotSourceRestoreInputSchema,
);
export const ExtensionSnapshotSourceRestoreReceiptCodecs = codecs(
  ExtensionSnapshotSourceRestoreReceiptSchema,
);
export const FinalizeExtensionSnapshotSourceRestoreInputCodecs = codecs(
  FinalizeExtensionSnapshotSourceRestoreInputSchema,
);
export const FinalizeExtensionSnapshotSourceRestoreResultCodecs = codecs(
  FinalizeExtensionSnapshotSourceRestoreResultSchema,
);

export const ExtensionSnapshotSettingsCaptureFactsSchema = Schema.Struct({
  actorSettings: ExtensionSnapshotPayloadSchema.fields.actorSettings,
  profileSettings: ExtensionSnapshotPayloadSchema.fields.profileSettings,
  nonSecretEnvOverrideScopes: ExtensionSnapshotPayloadSchema.fields.nonSecretEnvOverrideScopes,
  nonSecretEnvOverrides: ExtensionSnapshotPayloadSchema.fields.nonSecretEnvOverrides,
  secretTargets: ExtensionSnapshotPayloadSchema.fields.secretTargets,
});
export type ExtensionSnapshotSettingsCaptureFacts =
  typeof ExtensionSnapshotSettingsCaptureFactsSchema.Type;

export const ApplyExtensionSnapshotSettingsCommandSchema = Schema.Struct({
  clientRequestId: RuntimeClientRequestId,
  payload: ExtensionSnapshotPayloadSchema,
  appliedAt: IsoDateTimeStringSchema,
});
export type ApplyExtensionSnapshotSettingsCommand =
  typeof ApplyExtensionSnapshotSettingsCommandSchema.Type;

export const ApplyExtensionSnapshotSettingsReceiptSchema = Schema.Struct({
  receipt: StateCommandReceiptSchema,
  appliedActorCount: NonNegativeSafeIntegerSchema,
  appliedProfileCount: NonNegativeSafeIntegerSchema,
  skippedProfileIds: Schema.Array(NonBlankStringSchema),
  appliedOverrideCount: NonNegativeSafeIntegerSchema,
  deferredSecretTargetCount: NonNegativeSafeIntegerSchema,
});
export type ApplyExtensionSnapshotSettingsReceipt =
  typeof ApplyExtensionSnapshotSettingsReceiptSchema.Type;

export const ExtensionSnapshotSettingsCaptureFactsCodecs = codecs(
  ExtensionSnapshotSettingsCaptureFactsSchema,
);
export const ApplyExtensionSnapshotSettingsCommandCodecs = codecs(
  ApplyExtensionSnapshotSettingsCommandSchema,
);
export const ApplyExtensionSnapshotSettingsReceiptCodecs = codecs(
  ApplyExtensionSnapshotSettingsReceiptSchema,
);

export interface ExtensionSnapshotStatePortService {
  list(): Effect.Effect<ExtensionSnapshotsReadModel, StateContractError>;
  read(
    snapshotId: ExtensionSnapshotId,
  ): Effect.Effect<ExtensionSnapshotStateRecord | null, StateContractError>;
  save(
    input: SaveExtensionSnapshotCommand,
  ): Effect.Effect<StateMutationResult<SaveExtensionSnapshotReceipt>, StateContractError>;
  rename(
    input: RenameExtensionSnapshotCommand,
  ): Effect.Effect<StateMutationResult<RenameExtensionSnapshotReceipt>, StateContractError>;
  delete(
    input: DeleteExtensionSnapshotCommand,
  ): Effect.Effect<StateMutationResult<DeleteExtensionSnapshotReceipt>, StateContractError>;
  load(
    input: LoadExtensionSnapshotCommand,
  ): Effect.Effect<StateMutationResult<LoadExtensionSnapshotReceipt>, StateContractError>;
  readRestoreAttempt(
    attemptId: ExtensionSnapshotRestoreAttemptId,
  ): Effect.Effect<ExtensionSnapshotRestoreAttempt | null, StateContractError>;
  listPendingRestoreAttempts(): Effect.Effect<
    readonly ExtensionSnapshotRestoreAttempt[],
    StateContractError
  >;
  advanceRestoreAttempt(
    input: AdvanceExtensionSnapshotRestoreAttemptCommand,
  ): Effect.Effect<
    StateMutationResult<AdvanceExtensionSnapshotRestoreAttemptReceipt>,
    StateContractError
  >;
  listPendingCleanup(): Effect.Effect<
    readonly ExtensionSnapshotCleanupRecord[],
    StateContractError
  >;
  completeCleanup(
    input: CompleteExtensionSnapshotCleanupCommand,
  ): Effect.Effect<
    StateMutationResult<CompleteExtensionSnapshotCleanupReceipt>,
    StateContractError
  >;
}

export interface ExtensionSnapshotStatePort {
  readonly _tag: "ExtensionSnapshotStatePort";
}
export const ExtensionSnapshotStatePort = Context.Service<
  ExtensionSnapshotStatePort,
  ExtensionSnapshotStatePortService
>("@svvy/core/ExtensionSnapshotStatePort");

export interface ExtensionSnapshotSettingsStatePortService {
  readCaptureFacts(): Effect.Effect<ExtensionSnapshotSettingsCaptureFacts, StateContractError>;
  applyCapturedSettings(
    input: ApplyExtensionSnapshotSettingsCommand,
  ): Effect.Effect<StateMutationResult<ApplyExtensionSnapshotSettingsReceipt>, StateContractError>;
}
export interface ExtensionSnapshotSettingsStatePort {
  readonly _tag: "ExtensionSnapshotSettingsStatePort";
}
export const ExtensionSnapshotSettingsStatePort = Context.Service<
  ExtensionSnapshotSettingsStatePort,
  ExtensionSnapshotSettingsStatePortService
>("@svvy/core/ExtensionSnapshotSettingsStatePort");

export interface PutExtensionSnapshotPayloadInput {
  readonly ref: ExtensionSnapshotPayloadRef;
  readonly bytes: Uint8Array;
}
export interface PutExtensionSnapshotPayloadResult {
  readonly ref: ExtensionSnapshotPayloadRef;
  readonly outcome: "stored" | "existing";
}
export interface ReadExtensionSnapshotPayloadInput {
  readonly ref: ExtensionSnapshotPayloadRef;
}
export interface ReadExtensionSnapshotPayloadResult {
  readonly ref: ExtensionSnapshotPayloadRef;
  readonly bytes: Uint8Array;
}
export interface CleanupExtensionSnapshotPayloadInput {
  readonly ref: ExtensionSnapshotPayloadRef;
}
export interface CleanupExtensionSnapshotPayloadResult {
  readonly ref: ExtensionSnapshotPayloadRef;
  readonly outcome: "retained" | "removed" | "missing";
}

export interface ExtensionSnapshotPayloadStorePortService {
  put(
    input: PutExtensionSnapshotPayloadInput,
  ): Effect.Effect<PutExtensionSnapshotPayloadResult, ExtensionSnapshotPayloadStoreError>;
  read(
    input: ReadExtensionSnapshotPayloadInput,
  ): Effect.Effect<ReadExtensionSnapshotPayloadResult, ExtensionSnapshotPayloadStoreError>;
  cleanup(
    input: CleanupExtensionSnapshotPayloadInput,
  ): Effect.Effect<CleanupExtensionSnapshotPayloadResult, ExtensionSnapshotPayloadStoreError>;
}
export interface ExtensionSnapshotPayloadStorePort {
  readonly _tag: "ExtensionSnapshotPayloadStorePort";
}
export const ExtensionSnapshotPayloadStorePort = Context.Service<
  ExtensionSnapshotPayloadStorePort,
  ExtensionSnapshotPayloadStorePortService
>("@svvy/core/ExtensionSnapshotPayloadStorePort");

export interface PutExtensionSnapshotSecretPayloadInput {
  readonly snapshotId: ExtensionSnapshotId;
  readonly bytes: Redacted.Redacted<Uint8Array>;
}
export interface PutExtensionSnapshotSecretPayloadResult {
  readonly ref: ExtensionSnapshotSecretPayloadRef;
  readonly outcome: "stored";
}
export interface ReadExtensionSnapshotSecretPayloadInput {
  readonly ref: ExtensionSnapshotSecretPayloadRef;
}
export interface ReadExtensionSnapshotSecretPayloadResult {
  readonly ref: ExtensionSnapshotSecretPayloadRef;
  readonly bytes: Redacted.Redacted<Uint8Array>;
}
export interface CleanupExtensionSnapshotSecretPayloadInput {
  readonly ref: ExtensionSnapshotSecretPayloadRef;
}
export interface CleanupExtensionSnapshotSecretPayloadResult {
  readonly ref: ExtensionSnapshotSecretPayloadRef;
  readonly outcome: "retained" | "removed" | "missing";
}

export interface ExtensionSnapshotSecretStorePortService {
  put(
    input: PutExtensionSnapshotSecretPayloadInput,
  ): Effect.Effect<PutExtensionSnapshotSecretPayloadResult, SecretStorePortError>;
  read(
    input: ReadExtensionSnapshotSecretPayloadInput,
  ): Effect.Effect<ReadExtensionSnapshotSecretPayloadResult, SecretStorePortError>;
  cleanup(
    input: CleanupExtensionSnapshotSecretPayloadInput,
  ): Effect.Effect<CleanupExtensionSnapshotSecretPayloadResult, SecretStorePortError>;
}
export interface ExtensionSnapshotSecretStorePort {
  readonly _tag: "ExtensionSnapshotSecretStorePort";
}
export const ExtensionSnapshotSecretStorePort = Context.Service<
  ExtensionSnapshotSecretStorePort,
  ExtensionSnapshotSecretStorePortService
>("@svvy/core/ExtensionSnapshotSecretStorePort");
