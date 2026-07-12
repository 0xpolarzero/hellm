import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ExtensionUsageStateSchema } from "./extension-contracts";
import { ExtensionId, RuntimeClientRequestId } from "./ids";
import { StateRevisionSchema } from "./runtime-contracts";
import type { StateContractError } from "./errors";
import type { StateMutationResult } from "./runtime-state-ports";
import { strictBoundaryParseOptions } from "./boundary-parse-options";

export const ExtensionUsageChangeIdSchema = Schema.TemplateLiteral([
  "extension-usage-change:",
  Schema.String.check(Schema.isNonEmpty()),
]).pipe(Schema.brand("ExtensionUsageChangeId"));
export type ExtensionUsageChangeId = typeof ExtensionUsageChangeIdSchema.Type;

export const ExtensionUsageProfileTargetSchema = Schema.Struct({
  actor: Schema.Literals(["orchestrator", "handler", "workflow-task"]),
  agentProfile: Schema.String.check(Schema.isNonEmpty()),
  profileId: Schema.String.check(Schema.isNonEmpty()),
});
export type ExtensionUsageProfileTarget = typeof ExtensionUsageProfileTargetSchema.Type;

export const SetExtensionUsageInputSchema = Schema.Struct({
  clientRequestId: RuntimeClientRequestId,
  extensionId: ExtensionId,
  target: ExtensionUsageProfileTargetSchema,
  usage: ExtensionUsageStateSchema,
  expectedStateRevision: Schema.optionalKey(StateRevisionSchema),
});
export type SetExtensionUsageInput = typeof SetExtensionUsageInputSchema.Type;

export const RevertExtensionUsageInputSchema = Schema.Struct({
  clientRequestId: RuntimeClientRequestId,
  changeId: ExtensionUsageChangeIdSchema,
  expectedStateRevision: Schema.optionalKey(StateRevisionSchema),
});
export type RevertExtensionUsageInput = typeof RevertExtensionUsageInputSchema.Type;

export const ExtensionUsageChangeRecordSchema = Schema.Struct({
  changeId: ExtensionUsageChangeIdSchema,
  clientRequestId: RuntimeClientRequestId,
  extensionId: ExtensionId,
  target: ExtensionUsageProfileTargetSchema,
  before: Schema.NullOr(ExtensionUsageStateSchema),
  after: Schema.NullOr(ExtensionUsageStateSchema),
  revertedChangeId: Schema.NullOr(ExtensionUsageChangeIdSchema),
  createdAt: Schema.String.check(Schema.isNonEmpty()),
  stateRevision: StateRevisionSchema,
});
export type ExtensionUsageChangeRecord = typeof ExtensionUsageChangeRecordSchema.Type;

export const RuntimeExtensionUsageMutationResultSchema = Schema.Struct({
  change: ExtensionUsageChangeRecordSchema,
  affectedSurfaceCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type RuntimeExtensionUsageMutationResult =
  typeof RuntimeExtensionUsageMutationResultSchema.Type;

export const SetExtensionUsageInputCodecs = {
  decodeEffect: Schema.decodeUnknownEffect(
    SetExtensionUsageInputSchema,
    strictBoundaryParseOptions,
  ),
  encodeEffect: Schema.encodeEffect(SetExtensionUsageInputSchema, strictBoundaryParseOptions),
};
export const RevertExtensionUsageInputCodecs = {
  decodeEffect: Schema.decodeUnknownEffect(
    RevertExtensionUsageInputSchema,
    strictBoundaryParseOptions,
  ),
  encodeEffect: Schema.encodeEffect(RevertExtensionUsageInputSchema, strictBoundaryParseOptions),
};
export const RuntimeExtensionUsageMutationResultCodecs = {
  decodeEffect: Schema.decodeUnknownEffect(
    RuntimeExtensionUsageMutationResultSchema,
    strictBoundaryParseOptions,
  ),
  encodeEffect: Schema.encodeEffect(
    RuntimeExtensionUsageMutationResultSchema,
    strictBoundaryParseOptions,
  ),
};

export interface ExtensionUsageStatePortService {
  readNetworkAccess(): Effect.Effect<boolean, StateContractError>;
  resolveTarget(
    agentProfile: string,
  ): Effect.Effect<ExtensionUsageProfileTarget, StateContractError>;
  set(
    input: SetExtensionUsageInput,
  ): Effect.Effect<StateMutationResult<ExtensionUsageChangeRecord>, StateContractError>;
  revert(
    input: RevertExtensionUsageInput,
  ): Effect.Effect<StateMutationResult<ExtensionUsageChangeRecord>, StateContractError>;
  read(
    changeId: ExtensionUsageChangeId,
  ): Effect.Effect<ExtensionUsageChangeRecord | null, StateContractError>;
}

export interface ExtensionUsageStatePort {
  readonly _tag: "ExtensionUsageStatePort";
}
export const ExtensionUsageStatePort = Context.Service<
  ExtensionUsageStatePort,
  ExtensionUsageStatePortService
>("@svvy/core/ExtensionUsageStatePort");
