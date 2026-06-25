import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import type { ProviderAuthPortError, StateContractError } from "./errors";
import { IsoDateTimeStringSchema, ProviderId, WorkspaceId } from "./ids";
import type { StateMutationResult } from "./runtime-state-ports";

export const ProviderAuthHealthSchema = Schema.Literals([
  "usable",
  "missing",
  "expired",
  "refresh_failed",
]);
export type ProviderAuthHealth = typeof ProviderAuthHealthSchema.Type;

export const ProviderCredentialSecretSchema = Schema.Redacted(Schema.String, {
  label: "provider-credential",
  disallowJsonEncode: true,
});
export type ProviderCredentialSecret = typeof ProviderCredentialSecretSchema.Type;

export const ProviderUsableCredentialSnapshotSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
  health: Schema.Literal("usable"),
  accessToken: ProviderCredentialSecretSchema,
  refreshToken: Schema.optionalKey(ProviderCredentialSecretSchema),
  redactedAccountLabel: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(IsoDateTimeStringSchema),
  credentialFingerprint: Schema.String.check(Schema.isNonEmpty()),
});
export type ProviderUsableCredentialSnapshot = typeof ProviderUsableCredentialSnapshotSchema.Type;

export const ProviderUnusableCredentialSnapshotSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
  health: Schema.Literals(["missing", "expired", "refresh_failed"]),
  redactedAccountLabel: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(IsoDateTimeStringSchema),
  issue: Schema.optionalKey(Schema.String),
});
export type ProviderUnusableCredentialSnapshot =
  typeof ProviderUnusableCredentialSnapshotSchema.Type;

export const ProviderCredentialSnapshotSchema = Schema.Union([
  ProviderUsableCredentialSnapshotSchema,
  ProviderUnusableCredentialSnapshotSchema,
]);
export type ProviderCredentialSnapshot = typeof ProviderCredentialSnapshotSchema.Type;

export const ProviderAuthStatusSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
  health: ProviderAuthHealthSchema,
  redactedAccountLabel: Schema.optionalKey(Schema.String),
  refreshedAt: Schema.optionalKey(IsoDateTimeStringSchema),
  expiresAt: Schema.optionalKey(IsoDateTimeStringSchema),
  issue: Schema.optionalKey(Schema.String),
});
export type ProviderAuthStatus = typeof ProviderAuthStatusSchema.Type;

export const ProviderRefreshReasonSchema = Schema.Literals([
  "expired",
  "missing",
  "user_requested",
  "runtime_retry",
]);
export type ProviderRefreshReason = typeof ProviderRefreshReasonSchema.Type;

export const GetProviderAuthSnapshotInputSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
});
export type GetProviderAuthSnapshotInput = typeof GetProviderAuthSnapshotInputSchema.Type;

export const RequestProviderRefreshInputSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
  reason: ProviderRefreshReasonSchema,
});
export type RequestProviderRefreshInput = typeof RequestProviderRefreshInputSchema.Type;

export const ListProviderStatusesInputSchema = Schema.Struct({
  workspaceId: Schema.optionalKey(WorkspaceId),
});
export type ListProviderStatusesInput = typeof ListProviderStatusesInputSchema.Type;

export const RecordProviderAuthStatusInputSchema = Schema.Struct({
  status: ProviderAuthStatusSchema,
  observedAt: IsoDateTimeStringSchema,
  source: Schema.Literals(["provider_refresh", "startup_scan", "user_action", "runtime_retry"]),
});
export type RecordProviderAuthStatusInput = typeof RecordProviderAuthStatusInputSchema.Type;

export const decodeUnknownGetProviderAuthSnapshotInputExit = Schema.decodeUnknownExit(
  GetProviderAuthSnapshotInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGetProviderAuthSnapshotInputEffect = Schema.decodeUnknownEffect(
  GetProviderAuthSnapshotInputSchema,
  strictBoundaryParseOptions,
);
export const encodeGetProviderAuthSnapshotInputExit = Schema.encodeExit(
  GetProviderAuthSnapshotInputSchema,
  strictBoundaryParseOptions,
);
export const encodeGetProviderAuthSnapshotInputEffect = Schema.encodeEffect(
  GetProviderAuthSnapshotInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownRequestProviderRefreshInputExit = Schema.decodeUnknownExit(
  RequestProviderRefreshInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRequestProviderRefreshInputEffect = Schema.decodeUnknownEffect(
  RequestProviderRefreshInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRequestProviderRefreshInputExit = Schema.encodeExit(
  RequestProviderRefreshInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRequestProviderRefreshInputEffect = Schema.encodeEffect(
  RequestProviderRefreshInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownListProviderStatusesInputExit = Schema.decodeUnknownExit(
  ListProviderStatusesInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownListProviderStatusesInputEffect = Schema.decodeUnknownEffect(
  ListProviderStatusesInputSchema,
  strictBoundaryParseOptions,
);
export const encodeListProviderStatusesInputExit = Schema.encodeExit(
  ListProviderStatusesInputSchema,
  strictBoundaryParseOptions,
);
export const encodeListProviderStatusesInputEffect = Schema.encodeEffect(
  ListProviderStatusesInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownRecordProviderAuthStatusInputExit = Schema.decodeUnknownExit(
  RecordProviderAuthStatusInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRecordProviderAuthStatusInputEffect = Schema.decodeUnknownEffect(
  RecordProviderAuthStatusInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRecordProviderAuthStatusInputExit = Schema.encodeExit(
  RecordProviderAuthStatusInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRecordProviderAuthStatusInputEffect = Schema.encodeEffect(
  RecordProviderAuthStatusInputSchema,
  strictBoundaryParseOptions,
);

export interface ProviderAuthPortService {
  getProviderAuthSnapshot(
    input: GetProviderAuthSnapshotInput,
  ): Effect.Effect<ProviderCredentialSnapshot, ProviderAuthPortError>;
  refreshProviderCredentialSnapshot(
    input: RequestProviderRefreshInput,
  ): Effect.Effect<ProviderCredentialSnapshot, ProviderAuthPortError>;
}

export interface ProviderAuthStatusStatePortService {
  listProviderStatuses(
    input: ListProviderStatusesInput,
  ): Effect.Effect<readonly ProviderAuthStatus[], StateContractError>;
  recordProviderStatus(
    input: RecordProviderAuthStatusInput,
  ): Effect.Effect<StateMutationResult<ProviderAuthStatus>, StateContractError>;
}

export interface ProviderAuthPort {
  readonly _tag: "ProviderAuthPort";
}

export const ProviderAuthPort = Context.Service<ProviderAuthPort, ProviderAuthPortService>(
  "@svvy/core/ProviderAuthPort",
);

export interface ProviderAuthStatusStatePort {
  readonly _tag: "ProviderAuthStatusStatePort";
}

export const ProviderAuthStatusStatePort = Context.Service<
  ProviderAuthStatusStatePort,
  ProviderAuthStatusStatePortService
>("@svvy/core/ProviderAuthStatusStatePort");
