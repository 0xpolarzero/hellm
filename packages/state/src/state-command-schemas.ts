import * as Schema from "effect/Schema";
import {
  AbsolutePath,
  AppLogEntryId,
  AppLogQuerySchema,
  ExtensionEnvName,
  ExtensionId,
  IsoDateTimeStringSchema,
  JsonValue,
  ProviderId,
  RecordProviderAuthStatusInputSchema,
  RuntimeClientSubmissionInputSchema,
  strictBoundaryParseOptions,
  WorkspaceId,
} from "@svvy/core";

const BaseAppLogReadCommandInputSchema = Schema.Struct({
  workspaceId: Schema.optionalKey(WorkspaceId),
  readAt: IsoDateTimeStringSchema,
  clientSubmission: RuntimeClientSubmissionInputSchema,
});

export const MarkAppLogReadCommandInputSchema = Schema.Struct({
  ...BaseAppLogReadCommandInputSchema.fields,
  entryIds: Schema.Array(AppLogEntryId),
});
export type MarkAppLogReadCommandInput = typeof MarkAppLogReadCommandInputSchema.Type;

export const MarkVisibleAppLogRangeReadCommandInputSchema = Schema.Struct({
  ...BaseAppLogReadCommandInputSchema.fields,
  newestVisibleEntryId: AppLogEntryId,
  oldestVisibleEntryId: AppLogEntryId,
  filter: Schema.optionalKey(AppLogQuerySchema),
});
export type MarkVisibleAppLogRangeReadCommandInput =
  typeof MarkVisibleAppLogRangeReadCommandInputSchema.Type;

export const ClearWorkspaceAppLogUnreadCommandInputSchema = BaseAppLogReadCommandInputSchema;
export type ClearWorkspaceAppLogUnreadCommandInput =
  typeof ClearWorkspaceAppLogUnreadCommandInputSchema.Type;

export const AppPreferenceAppearanceSchema = Schema.Literals(["system", "light", "dark"]);
export type AppPreferenceAppearance = typeof AppPreferenceAppearanceSchema.Type;

export const AppPreferenceApprovalModeSchema = Schema.Literals([
  "auto-review",
  "user",
  "full-access",
]);
export type AppPreferenceApprovalMode = typeof AppPreferenceApprovalModeSchema.Type;

export const UpdateAppPreferencesPatchSchema = Schema.Struct({
  appearance: Schema.optionalKey(AppPreferenceAppearanceSchema),
  externalEditor: Schema.optionalKey(Schema.NullOr(Schema.String)),
  artifactDirectory: Schema.optionalKey(AbsolutePath),
  approvalMode: Schema.optionalKey(AppPreferenceApprovalModeSchema),
  networkAccess: Schema.optionalKey(Schema.Boolean),
  ambientResources: Schema.optionalKey(JsonValue),
});
export type UpdateAppPreferencesPatch = typeof UpdateAppPreferencesPatchSchema.Type;

export const UpdateAppPreferencesCommandInputSchema = Schema.Struct({
  patch: UpdateAppPreferencesPatchSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type UpdateAppPreferencesCommandInput = typeof UpdateAppPreferencesCommandInputSchema.Type;

export const UpsertProviderCredentialCommandInputSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
  credentialKind: Schema.Literals(["api-key", "oauth-token"]),
  secretValue: Schema.String.check(Schema.isNonEmpty()),
  redactedAccountLabel: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(IsoDateTimeStringSchema),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type UpsertProviderCredentialCommandInput =
  typeof UpsertProviderCredentialCommandInputSchema.Type;

export const RemoveProviderCredentialCommandInputSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type RemoveProviderCredentialCommandInput =
  typeof RemoveProviderCredentialCommandInputSchema.Type;

export const RecordProviderAuthStatusCommandInputSchema = Schema.Struct({
  ...RecordProviderAuthStatusInputSchema.fields,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type RecordProviderAuthStatusCommandInput =
  typeof RecordProviderAuthStatusCommandInputSchema.Type;

export const SetExtensionSecretValueCommandInputSchema = Schema.Struct({
  extensionId: ExtensionId,
  envName: ExtensionEnvName,
  secretValue: Schema.String.check(Schema.isNonEmpty()),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type SetExtensionSecretValueCommandInput =
  typeof SetExtensionSecretValueCommandInputSchema.Type;

export const RemoveExtensionSecretValueCommandInputSchema = Schema.Struct({
  extensionId: ExtensionId,
  envName: ExtensionEnvName,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type RemoveExtensionSecretValueCommandInput =
  typeof RemoveExtensionSecretValueCommandInputSchema.Type;

export const decodeUnknownMarkAppLogReadCommandInputExit = Schema.decodeUnknownExit(
  MarkAppLogReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownMarkAppLogReadCommandInputEffect = Schema.decodeUnknownEffect(
  MarkAppLogReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeMarkAppLogReadCommandInputExit = Schema.encodeExit(
  MarkAppLogReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeMarkAppLogReadCommandInputEffect = Schema.encodeEffect(
  MarkAppLogReadCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownMarkVisibleAppLogRangeReadCommandInputExit = Schema.decodeUnknownExit(
  MarkVisibleAppLogRangeReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownMarkVisibleAppLogRangeReadCommandInputEffect = Schema.decodeUnknownEffect(
  MarkVisibleAppLogRangeReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeMarkVisibleAppLogRangeReadCommandInputExit = Schema.encodeExit(
  MarkVisibleAppLogRangeReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeMarkVisibleAppLogRangeReadCommandInputEffect = Schema.encodeEffect(
  MarkVisibleAppLogRangeReadCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownClearWorkspaceAppLogUnreadCommandInputExit = Schema.decodeUnknownExit(
  ClearWorkspaceAppLogUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownClearWorkspaceAppLogUnreadCommandInputEffect = Schema.decodeUnknownEffect(
  ClearWorkspaceAppLogUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeClearWorkspaceAppLogUnreadCommandInputExit = Schema.encodeExit(
  ClearWorkspaceAppLogUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeClearWorkspaceAppLogUnreadCommandInputEffect = Schema.encodeEffect(
  ClearWorkspaceAppLogUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownUpdateAppPreferencesCommandInputExit = Schema.decodeUnknownExit(
  UpdateAppPreferencesCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownUpdateAppPreferencesCommandInputEffect = Schema.decodeUnknownEffect(
  UpdateAppPreferencesCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpdateAppPreferencesCommandInputExit = Schema.encodeExit(
  UpdateAppPreferencesCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpdateAppPreferencesCommandInputEffect = Schema.encodeEffect(
  UpdateAppPreferencesCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownUpsertProviderCredentialCommandInputExit = Schema.decodeUnknownExit(
  UpsertProviderCredentialCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownUpsertProviderCredentialCommandInputEffect = Schema.decodeUnknownEffect(
  UpsertProviderCredentialCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpsertProviderCredentialCommandInputExit = Schema.encodeExit(
  UpsertProviderCredentialCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpsertProviderCredentialCommandInputEffect = Schema.encodeEffect(
  UpsertProviderCredentialCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownRemoveProviderCredentialCommandInputExit = Schema.decodeUnknownExit(
  RemoveProviderCredentialCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRemoveProviderCredentialCommandInputEffect = Schema.decodeUnknownEffect(
  RemoveProviderCredentialCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRemoveProviderCredentialCommandInputExit = Schema.encodeExit(
  RemoveProviderCredentialCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRemoveProviderCredentialCommandInputEffect = Schema.encodeEffect(
  RemoveProviderCredentialCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownRecordProviderAuthStatusCommandInputExit = Schema.decodeUnknownExit(
  RecordProviderAuthStatusCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRecordProviderAuthStatusCommandInputEffect = Schema.decodeUnknownEffect(
  RecordProviderAuthStatusCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRecordProviderAuthStatusCommandInputExit = Schema.encodeExit(
  RecordProviderAuthStatusCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRecordProviderAuthStatusCommandInputEffect = Schema.encodeEffect(
  RecordProviderAuthStatusCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetExtensionSecretValueCommandInputExit = Schema.decodeUnknownExit(
  SetExtensionSecretValueCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetExtensionSecretValueCommandInputEffect = Schema.decodeUnknownEffect(
  SetExtensionSecretValueCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetExtensionSecretValueCommandInputExit = Schema.encodeExit(
  SetExtensionSecretValueCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetExtensionSecretValueCommandInputEffect = Schema.encodeEffect(
  SetExtensionSecretValueCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownRemoveExtensionSecretValueCommandInputExit = Schema.decodeUnknownExit(
  RemoveExtensionSecretValueCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRemoveExtensionSecretValueCommandInputEffect = Schema.decodeUnknownEffect(
  RemoveExtensionSecretValueCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRemoveExtensionSecretValueCommandInputExit = Schema.encodeExit(
  RemoveExtensionSecretValueCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRemoveExtensionSecretValueCommandInputEffect = Schema.encodeEffect(
  RemoveExtensionSecretValueCommandInputSchema,
  strictBoundaryParseOptions,
);
