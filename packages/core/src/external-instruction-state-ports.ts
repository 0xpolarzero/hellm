import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { StateContractError } from "./errors";
import {
  ExternalInstructionActorSchema,
  ExternalInstructionDiagnosticSchema,
  ExternalInstructionFileNameSchema,
  ExternalInstructionReadStatusSchema,
  ExternalInstructionScanResultSchema,
  ExternalInstructionSourceAddressSchema,
  ExternalInstructionSourceGroupSchema,
} from "./external-instruction-contracts";
import {
  AbsolutePath,
  AgentProfileId,
  ExternalInstructionSourceId,
  IsoDateTimeStringSchema,
  NonNegativeSafeIntegerSchema,
  WorkspaceId,
} from "./ids";
import { ExtensionUsageStateSchema, StateRevisionSchema } from "./runtime-contracts";
import type { StateMutationResult } from "./runtime-state-ports";

// Discovery defaults are filesystem observations only. Effective actor/profile usage is
// state-owned and projected separately; path-keyed app preferences are never represented here.
export const ExternalInstructionDiscoveryDefaultControlSchema = Schema.Struct({
  enabled: Schema.Boolean,
  eligibleActors: Schema.Array(ExternalInstructionActorSchema),
});
export type ExternalInstructionDiscoveryDefaultControl =
  typeof ExternalInstructionDiscoveryDefaultControlSchema.Type;

export const ExternalInstructionProjectedSourceSchema = Schema.Struct({
  id: ExternalInstructionSourceId,
  source: ExternalInstructionSourceAddressSchema,
  fileName: ExternalInstructionFileNameSchema,
  title: Schema.String,
  canonicalPath: AbsolutePath,
  sourceGroup: ExternalInstructionSourceGroupSchema,
  rootId: Schema.optionalKey(Schema.String),
  rootLabel: Schema.optionalKey(Schema.String),
  order: NonNegativeSafeIntegerSchema,
  defaultControl: ExternalInstructionDiscoveryDefaultControlSchema,
  readOnly: Schema.Literal(true),
  contentHash: Schema.String,
  fingerprint: Schema.String,
  readStatus: ExternalInstructionReadStatusSchema,
  content: Schema.NullOr(Schema.String),
});
export type ExternalInstructionProjectedSource =
  typeof ExternalInstructionProjectedSourceSchema.Type;

export const ExternalInstructionActorUsageSchema = Schema.Struct({
  actor: ExternalInstructionActorSchema,
  profileId: Schema.NullOr(AgentProfileId),
  sourceId: ExternalInstructionSourceId,
  usage: ExtensionUsageStateSchema,
});
export type ExternalInstructionActorUsage = typeof ExternalInstructionActorUsageSchema.Type;

export const ExternalInstructionObservationProjectionSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  sources: Schema.Array(ExternalInstructionProjectedSourceSchema),
  diagnostics: Schema.Array(ExternalInstructionDiagnosticSchema),
  observedAt: Schema.NullOr(IsoDateTimeStringSchema),
  revision: StateRevisionSchema,
});
export type ExternalInstructionObservationProjection =
  typeof ExternalInstructionObservationProjectionSchema.Type;

export const ExternalInstructionsProjectionSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  sources: Schema.Array(ExternalInstructionProjectedSourceSchema),
  diagnostics: Schema.Array(ExternalInstructionDiagnosticSchema),
  actorUsage: Schema.Array(ExternalInstructionActorUsageSchema),
  observedAt: Schema.NullOr(IsoDateTimeStringSchema),
  revision: StateRevisionSchema,
});
export type ExternalInstructionsProjection = typeof ExternalInstructionsProjectionSchema.Type;

export const ReconcileExternalInstructionsInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  scan: ExternalInstructionScanResultSchema,
});
export type ReconcileExternalInstructionsInput =
  typeof ReconcileExternalInstructionsInputSchema.Type;

export const ReconcileExternalInstructionsResultSchema = Schema.Struct({
  changed: Schema.Boolean,
  projection: ExternalInstructionObservationProjectionSchema,
});
export type ReconcileExternalInstructionsResult =
  typeof ReconcileExternalInstructionsResultSchema.Type;

export interface RuntimeExternalInstructionStatePortService {
  reconcileExternalInstructions(
    input: ReconcileExternalInstructionsInput,
  ): Effect.Effect<StateMutationResult<ReconcileExternalInstructionsResult>, StateContractError>;
  readExternalInstructions(input: {
    workspaceId: typeof WorkspaceId.Type;
  }): Effect.Effect<ExternalInstructionsProjection, StateContractError>;
}

export interface RuntimeExternalInstructionStatePort {
  readonly _tag: "RuntimeExternalInstructionStatePort";
}

export const RuntimeExternalInstructionStatePort = Context.Service<
  RuntimeExternalInstructionStatePort,
  RuntimeExternalInstructionStatePortService
>("@svvy/core/RuntimeExternalInstructionStatePort");
