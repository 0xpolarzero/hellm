import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { BuildRuntimeExtensionInputSchema } from "./extension-build-contracts";
import { ExtensionSnapshotIdSchema } from "./extension-snapshot-contracts";
import { ExtensionUsageStateSchema } from "./extension-contracts";
import { ExtensionUsageChangeIdSchema } from "./extension-usage-contracts";
import { ExtensionId, RuntimeClientRequestId } from "./ids";

const ClientRequestSchema = Schema.Struct({ clientRequestId: RuntimeClientRequestId });

export const SvvyxExtensionManagementRuntimeRequestSchema = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("inspect"),
    input: Schema.Struct({ extensionId: Schema.String.check(Schema.isNonEmpty()) }),
  }),
  Schema.Struct({
    operation: Schema.Literal("build"),
    input: BuildRuntimeExtensionInputSchema,
  }),
  Schema.Struct({ operation: Schema.Literal("snapshots.list"), input: Schema.Struct({}) }),
  Schema.Struct({
    operation: Schema.Literal("usage.set"),
    input: Schema.Struct({
      ...ClientRequestSchema.fields,
      extensionId: ExtensionId,
      agentProfile: Schema.String.check(Schema.isNonEmpty()),
      usage: ExtensionUsageStateSchema,
    }),
  }),
  Schema.Struct({
    operation: Schema.Literal("usage.revert"),
    input: Schema.Struct({
      ...ClientRequestSchema.fields,
      changeId: ExtensionUsageChangeIdSchema,
    }),
  }),
  Schema.Struct({
    operation: Schema.Literal("snapshots.save"),
    input: Schema.Struct({
      ...ClientRequestSchema.fields,
      name: Schema.String.check(Schema.isNonEmpty()),
    }),
  }),
  Schema.Struct({
    operation: Schema.Literal("snapshots.rename"),
    input: Schema.Struct({
      ...ClientRequestSchema.fields,
      snapshotId: ExtensionSnapshotIdSchema,
      name: Schema.String.check(Schema.isNonEmpty()),
    }),
  }),
  Schema.Struct({
    operation: Schema.Literal("snapshots.delete"),
    input: Schema.Struct({ ...ClientRequestSchema.fields, snapshotId: ExtensionSnapshotIdSchema }),
  }),
  Schema.Struct({
    operation: Schema.Literal("snapshots.load"),
    input: Schema.Struct({ ...ClientRequestSchema.fields, snapshotId: ExtensionSnapshotIdSchema }),
  }),
]);
export type SvvyxExtensionManagementRuntimeRequest =
  typeof SvvyxExtensionManagementRuntimeRequestSchema.Type;

export const SvvyxExtensionManagementRuntimeIntentSchema = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  kind: Schema.Literal("extension_management.runtime_request"),
  request: SvvyxExtensionManagementRuntimeRequestSchema,
});
export type SvvyxExtensionManagementRuntimeIntent =
  typeof SvvyxExtensionManagementRuntimeIntentSchema.Type;

export const SvvyxExtensionManagementRuntimeResponseSchema = Schema.Struct({
  output: Schema.Json,
  commandFacts: Schema.Record(Schema.String, Schema.Json),
});
export type SvvyxExtensionManagementRuntimeResponse =
  typeof SvvyxExtensionManagementRuntimeResponseSchema.Type;

export const decodeUnknownSvvyxExtensionManagementRuntimeIntentExit = Schema.decodeUnknownExit(
  SvvyxExtensionManagementRuntimeIntentSchema,
  strictBoundaryParseOptions,
);
