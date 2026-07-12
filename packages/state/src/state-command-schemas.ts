import * as Schema from "effect/Schema";
import {
  AbsolutePath,
  AgentProfileId,
  AppLogEntryId,
  AppLogQuerySchema,
  ExternalInstructionSourceId,
  ExternalInstructionsSettingsSchema,
  ExtensionEnvName,
  ExtensionId,
  ExtensionUsageStateSchema,
  IsoDateTimeStringSchema,
  JsonValue,
  ModelId,
  ProviderId,
  ReasoningSelectionSchema,
  RecordProviderAuthStatusInputSchema,
  RuntimeClientSubmissionInputSchema,
  SnippetId,
  SnippetMetadataSchema,
  strictBoundaryParseOptions,
  WorkspacePaneId,
  WorkspaceSessionId,
  WorkspaceSessionNavigationSectionIdSchema,
  WorkspaceTabId,
  WorkspaceId,
  CompactWorkspaceSurfaceSchema,
  WorkspaceLayoutSlotIdSchema,
  WorkspaceLayoutSlotContentInvariant,
  WorkspacePaneRecordSchema,
  WorkspaceTabRecordSchema,
} from "@svvy/core";
import type { WorkspaceLayoutSlotId } from "@svvy/core";

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
  externalInstructions: Schema.optionalKey(ExternalInstructionsSettingsSchema),
  ambientResources: Schema.optionalKey(JsonValue),
});
export type UpdateAppPreferencesPatch = typeof UpdateAppPreferencesPatchSchema.Type;

export const UpdateAppPreferencesCommandInputSchema = Schema.Struct({
  patch: UpdateAppPreferencesPatchSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type UpdateAppPreferencesCommandInput = typeof UpdateAppPreferencesCommandInputSchema.Type;

export const RecordProviderAuthStatusCommandInputSchema = Schema.Struct({
  ...RecordProviderAuthStatusInputSchema.fields,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type RecordProviderAuthStatusCommandInput =
  typeof RecordProviderAuthStatusCommandInputSchema.Type;

export { WorkspaceLayoutSlotIdSchema };
export type { WorkspaceLayoutSlotId };

export const WorkspaceTabRecordInputSchema = WorkspaceTabRecordSchema;
export type WorkspaceTabRecordInput = typeof WorkspaceTabRecordInputSchema.Type;

const SetWorkspaceTabsCommandInputFieldsSchema = Schema.Struct({
  activeWorkspaceTabId: Schema.NullOr(WorkspaceTabId),
  tabs: Schema.Array(WorkspaceTabRecordInputSchema),
  knownWorkspaces: Schema.Array(WorkspaceTabRecordInputSchema),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
type SetWorkspaceTabsCommandInputFields = typeof SetWorkspaceTabsCommandInputFieldsSchema.Type;

const SetWorkspaceTabsCommandInvariant = Schema.makeFilter(
  (input: SetWorkspaceTabsCommandInputFields) => {
    const openIds = input.tabs.map((tab) => tab.workspaceTabId);
    if (new Set(openIds).size !== openIds.length) {
      return { path: ["tabs"], issue: "workspace tab ids must be unique" };
    }
    const knownIds = input.knownWorkspaces.map((tab) => tab.workspaceTabId);
    if (new Set(knownIds).size !== knownIds.length) {
      return { path: ["knownWorkspaces"], issue: "known workspace tab ids must be unique" };
    }
    if (input.activeWorkspaceTabId !== null && !openIds.includes(input.activeWorkspaceTabId)) {
      return {
        path: ["activeWorkspaceTabId"],
        issue: "active workspace tab id must identify an open tab",
      };
    }
    return true;
  },
  { expected: "coherent workspace chrome tab identity" },
);

export const SetWorkspaceTabsCommandInputSchema = SetWorkspaceTabsCommandInputFieldsSchema.pipe(
  Schema.check(SetWorkspaceTabsCommandInvariant),
);
export type SetWorkspaceTabsCommandInput = typeof SetWorkspaceTabsCommandInputSchema.Type;

export const SelectWorkspaceTabCommandInputSchema = Schema.Struct({
  workspaceTabId: WorkspaceTabId,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type SelectWorkspaceTabCommandInput = typeof SelectWorkspaceTabCommandInputSchema.Type;

export const SelectWorkspaceLayoutSlotCommandInputSchema = Schema.Struct({
  workspaceTabId: WorkspaceTabId,
  layoutId: WorkspaceLayoutSlotIdSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type SelectWorkspaceLayoutSlotCommandInput =
  typeof SelectWorkspaceLayoutSlotCommandInputSchema.Type;

const SessionNavigationTargetCommandFields = {
  workspaceId: WorkspaceId,
  workspaceSessionId: WorkspaceSessionId,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
};

export const SetSessionPinnedCommandInputSchema = Schema.Struct({
  ...SessionNavigationTargetCommandFields,
  pinned: Schema.Boolean,
});
export type SetSessionPinnedCommandInput = typeof SetSessionPinnedCommandInputSchema.Type;

export const SetSessionArchivedCommandInputSchema = Schema.Struct({
  ...SessionNavigationTargetCommandFields,
  archived: Schema.Boolean,
});
export type SetSessionArchivedCommandInput = typeof SetSessionArchivedCommandInputSchema.Type;

export const MarkSessionReadCommandInputSchema = Schema.Struct({
  ...SessionNavigationTargetCommandFields,
});
export type MarkSessionReadCommandInput = typeof MarkSessionReadCommandInputSchema.Type;

export const MarkSessionUnreadCommandInputSchema = Schema.Struct({
  ...SessionNavigationTargetCommandFields,
});
export type MarkSessionUnreadCommandInput = typeof MarkSessionUnreadCommandInputSchema.Type;

type SessionNavigationSectionStateCommandShape = {
  readonly collapsed?: boolean | undefined;
  readonly sizePx?: number | undefined;
};

const SessionNavigationSectionStateCommandInvariant = Schema.makeFilter(
  (input: SessionNavigationSectionStateCommandShape) =>
    input.collapsed !== undefined || input.sizePx !== undefined
      ? true
      : {
          path: ["collapsed"],
          issue: "session navigation section state must change collapsed or sizePx",
        },
  { expected: "a non-empty session navigation section state update" },
);

export const SetSessionNavigationSectionStateCommandInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  section: WorkspaceSessionNavigationSectionIdSchema,
  collapsed: Schema.optionalKey(Schema.Boolean),
  sizePx: Schema.optionalKey(Schema.Number.check(Schema.isFinite())),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
}).pipe(Schema.check(SessionNavigationSectionStateCommandInvariant));
export type SetSessionNavigationSectionStateCommandInput =
  typeof SetSessionNavigationSectionStateCommandInputSchema.Type;

const SaveWorkspaceLayoutSlotCommandInputFieldsSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  layoutId: WorkspaceLayoutSlotIdSchema,
  dockviewJson: Schema.NullOr(JsonValue),
  panes: Schema.Array(WorkspacePaneRecordSchema),
  compactSurfaces: Schema.Array(CompactWorkspaceSurfaceSchema),
  focusedPaneId: Schema.NullOr(WorkspacePaneId),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export const SaveWorkspaceLayoutSlotCommandInputSchema =
  SaveWorkspaceLayoutSlotCommandInputFieldsSchema.pipe(
    Schema.check(WorkspaceLayoutSlotContentInvariant),
  );
export type SaveWorkspaceLayoutSlotCommandInput =
  typeof SaveWorkspaceLayoutSlotCommandInputSchema.Type;

export const SetExtensionEnvOverrideCommandInputSchema = Schema.Struct({
  extensionId: ExtensionId,
  envName: ExtensionEnvName,
  value: Schema.String,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type SetExtensionEnvOverrideCommandInput =
  typeof SetExtensionEnvOverrideCommandInputSchema.Type;

export const RemoveExtensionEnvOverrideCommandInputSchema = Schema.Struct({
  extensionId: ExtensionId,
  envName: ExtensionEnvName,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type RemoveExtensionEnvOverrideCommandInput =
  typeof RemoveExtensionEnvOverrideCommandInputSchema.Type;

const AgentProfileBaseInputSchema = Schema.Struct({
  profileId: AgentProfileId,
  name: Schema.String,
  providerId: ProviderId,
  modelId: ModelId,
  reasoning: Schema.optionalKey(ReasoningSelectionSchema),
  extensionUsage: Schema.Record(ExtensionId, ExtensionUsageStateSchema),
  extensionOrder: Schema.optionalKey(Schema.Array(ExtensionId)),
});

export const OrchestratorAgentProfileInputSchema = Schema.Struct({
  ...AgentProfileBaseInputSchema.fields,
  followComposer: Schema.Boolean,
});
export type OrchestratorAgentProfileInput = typeof OrchestratorAgentProfileInputSchema.Type;

export const ThreadHandlerProfileInputSchema = AgentProfileBaseInputSchema;
export type ThreadHandlerProfileInput = typeof ThreadHandlerProfileInputSchema.Type;

export const UpdateOrchestratorProfileCommandInputSchema = Schema.Struct({
  profile: OrchestratorAgentProfileInputSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type UpdateOrchestratorProfileCommandInput =
  typeof UpdateOrchestratorProfileCommandInputSchema.Type;

export const UpdateThreadHandlerProfileCommandInputSchema = Schema.Struct({
  profile: ThreadHandlerProfileInputSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type UpdateThreadHandlerProfileCommandInput =
  typeof UpdateThreadHandlerProfileCommandInputSchema.Type;

export const DeleteOrchestratorProfileCommandInputSchema = Schema.Struct({
  profileId: AgentProfileId,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type DeleteOrchestratorProfileCommandInput =
  typeof DeleteOrchestratorProfileCommandInputSchema.Type;

export const ReorderOrchestratorProfilesCommandInputSchema = Schema.Struct({
  profileIds: Schema.Array(AgentProfileId),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type ReorderOrchestratorProfilesCommandInput =
  typeof ReorderOrchestratorProfilesCommandInputSchema.Type;

export const SetProfileExtensionUsageCommandInputSchema = Schema.Struct({
  actor: Schema.Literals(["orchestrator", "handler"]),
  profileId: AgentProfileId,
  extensionId: ExtensionId,
  usage: ExtensionUsageStateSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type SetProfileExtensionUsageCommandInput =
  typeof SetProfileExtensionUsageCommandInputSchema.Type;

export const PromoteProfileExtensionDefaultCommandInputSchema = Schema.Struct({
  actor: Schema.Literals(["orchestrator", "workflow-task"]),
  profileId: AgentProfileId,
  extensionId: ExtensionId,
  usage: ExtensionUsageStateSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type PromoteProfileExtensionDefaultCommandInput =
  typeof PromoteProfileExtensionDefaultCommandInputSchema.Type;

export const ResetActorExtensionDefaultsCommandInputSchema = Schema.Struct({
  actor: Schema.Literals(["orchestrator", "workflow-task"]),
  reset: Schema.Literals(["usage", "order", "usage-and-order"]),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type ResetActorExtensionDefaultsCommandInput =
  typeof ResetActorExtensionDefaultsCommandInputSchema.Type;

export const SetAgentActorExtensionDefaultsCommandInputSchema = Schema.Struct({
  actor: Schema.Literals(["orchestrator", "workflow-task"]),
  extensionUsage: Schema.Record(ExtensionId, ExtensionUsageStateSchema),
  extensionOrder: Schema.Array(ExtensionId),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type SetAgentActorExtensionDefaultsCommandInput =
  typeof SetAgentActorExtensionDefaultsCommandInputSchema.Type;

export const SetExternalInstructionActorUsageCommandInputSchema = Schema.Struct({
  actor: Schema.Literals(["orchestrator", "handler"]),
  profileId: AgentProfileId,
  sourceId: ExternalInstructionSourceId,
  usage: Schema.Literals(["disabled", "available", "loaded"]),
  order: Schema.optionalKey(Schema.Number),
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type SetExternalInstructionActorUsageCommandInput =
  typeof SetExternalInstructionActorUsageCommandInputSchema.Type;

export { SnippetMetadataSchema };
export type SnippetMetadata = typeof SnippetMetadataSchema.Type;

const ManagedSnippetTitleSchema = Schema.String.check(Schema.isPattern(/\S/));

export const CreateManagedSnippetCommandInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  title: ManagedSnippetTitleSchema,
  body: Schema.String,
  metadata: SnippetMetadataSchema,
  enabled: Schema.Boolean,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type CreateManagedSnippetCommandInput = typeof CreateManagedSnippetCommandInputSchema.Type;

export const UpdateManagedSnippetPatchSchema = Schema.Struct({
  title: Schema.optionalKey(ManagedSnippetTitleSchema),
  body: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(SnippetMetadataSchema),
  enabled: Schema.optionalKey(Schema.Boolean),
});
export type UpdateManagedSnippetPatch = typeof UpdateManagedSnippetPatchSchema.Type;

export const UpdateManagedSnippetCommandInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  snippetId: SnippetId,
  patch: UpdateManagedSnippetPatchSchema,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type UpdateManagedSnippetCommandInput = typeof UpdateManagedSnippetCommandInputSchema.Type;

export const DeleteManagedSnippetCommandInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  snippetId: SnippetId,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type DeleteManagedSnippetCommandInput = typeof DeleteManagedSnippetCommandInputSchema.Type;

export const SetSnippetEnabledCommandInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  snippetId: SnippetId,
  enabled: Schema.Boolean,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type SetSnippetEnabledCommandInput = typeof SetSnippetEnabledCommandInputSchema.Type;

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

export const decodeUnknownSetSessionPinnedCommandInputExit = Schema.decodeUnknownExit(
  SetSessionPinnedCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetSessionPinnedCommandInputEffect = Schema.decodeUnknownEffect(
  SetSessionPinnedCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetSessionPinnedCommandInputExit = Schema.encodeExit(
  SetSessionPinnedCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetSessionPinnedCommandInputEffect = Schema.encodeEffect(
  SetSessionPinnedCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetSessionArchivedCommandInputExit = Schema.decodeUnknownExit(
  SetSessionArchivedCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetSessionArchivedCommandInputEffect = Schema.decodeUnknownEffect(
  SetSessionArchivedCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetSessionArchivedCommandInputExit = Schema.encodeExit(
  SetSessionArchivedCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetSessionArchivedCommandInputEffect = Schema.encodeEffect(
  SetSessionArchivedCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownMarkSessionReadCommandInputExit = Schema.decodeUnknownExit(
  MarkSessionReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownMarkSessionReadCommandInputEffect = Schema.decodeUnknownEffect(
  MarkSessionReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeMarkSessionReadCommandInputExit = Schema.encodeExit(
  MarkSessionReadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeMarkSessionReadCommandInputEffect = Schema.encodeEffect(
  MarkSessionReadCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownMarkSessionUnreadCommandInputExit = Schema.decodeUnknownExit(
  MarkSessionUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownMarkSessionUnreadCommandInputEffect = Schema.decodeUnknownEffect(
  MarkSessionUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeMarkSessionUnreadCommandInputExit = Schema.encodeExit(
  MarkSessionUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeMarkSessionUnreadCommandInputEffect = Schema.encodeEffect(
  MarkSessionUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetSessionNavigationSectionStateCommandInputExit =
  Schema.decodeUnknownExit(
    SetSessionNavigationSectionStateCommandInputSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownSetSessionNavigationSectionStateCommandInputEffect =
  Schema.decodeUnknownEffect(
    SetSessionNavigationSectionStateCommandInputSchema,
    strictBoundaryParseOptions,
  );
export const encodeSetSessionNavigationSectionStateCommandInputExit = Schema.encodeExit(
  SetSessionNavigationSectionStateCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetSessionNavigationSectionStateCommandInputEffect = Schema.encodeEffect(
  SetSessionNavigationSectionStateCommandInputSchema,
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

export const decodeUnknownSetWorkspaceTabsCommandInputExit = Schema.decodeUnknownExit(
  SetWorkspaceTabsCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetWorkspaceTabsCommandInputEffect = Schema.decodeUnknownEffect(
  SetWorkspaceTabsCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetWorkspaceTabsCommandInputExit = Schema.encodeExit(
  SetWorkspaceTabsCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetWorkspaceTabsCommandInputEffect = Schema.encodeEffect(
  SetWorkspaceTabsCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSelectWorkspaceTabCommandInputExit = Schema.decodeUnknownExit(
  SelectWorkspaceTabCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSelectWorkspaceTabCommandInputEffect = Schema.decodeUnknownEffect(
  SelectWorkspaceTabCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSelectWorkspaceTabCommandInputExit = Schema.encodeExit(
  SelectWorkspaceTabCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSelectWorkspaceTabCommandInputEffect = Schema.encodeEffect(
  SelectWorkspaceTabCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSelectWorkspaceLayoutSlotCommandInputExit = Schema.decodeUnknownExit(
  SelectWorkspaceLayoutSlotCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSelectWorkspaceLayoutSlotCommandInputEffect = Schema.decodeUnknownEffect(
  SelectWorkspaceLayoutSlotCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSelectWorkspaceLayoutSlotCommandInputExit = Schema.encodeExit(
  SelectWorkspaceLayoutSlotCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSelectWorkspaceLayoutSlotCommandInputEffect = Schema.encodeEffect(
  SelectWorkspaceLayoutSlotCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSaveWorkspaceLayoutSlotCommandInputExit = Schema.decodeUnknownExit(
  SaveWorkspaceLayoutSlotCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSaveWorkspaceLayoutSlotCommandInputEffect = Schema.decodeUnknownEffect(
  SaveWorkspaceLayoutSlotCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSaveWorkspaceLayoutSlotCommandInputExit = Schema.encodeExit(
  SaveWorkspaceLayoutSlotCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSaveWorkspaceLayoutSlotCommandInputEffect = Schema.encodeEffect(
  SaveWorkspaceLayoutSlotCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetExtensionEnvOverrideCommandInputExit = Schema.decodeUnknownExit(
  SetExtensionEnvOverrideCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetExtensionEnvOverrideCommandInputEffect = Schema.decodeUnknownEffect(
  SetExtensionEnvOverrideCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetExtensionEnvOverrideCommandInputExit = Schema.encodeExit(
  SetExtensionEnvOverrideCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetExtensionEnvOverrideCommandInputEffect = Schema.encodeEffect(
  SetExtensionEnvOverrideCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownRemoveExtensionEnvOverrideCommandInputExit = Schema.decodeUnknownExit(
  RemoveExtensionEnvOverrideCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRemoveExtensionEnvOverrideCommandInputEffect = Schema.decodeUnknownEffect(
  RemoveExtensionEnvOverrideCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRemoveExtensionEnvOverrideCommandInputExit = Schema.encodeExit(
  RemoveExtensionEnvOverrideCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRemoveExtensionEnvOverrideCommandInputEffect = Schema.encodeEffect(
  RemoveExtensionEnvOverrideCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownUpdateOrchestratorProfileCommandInputExit = Schema.decodeUnknownExit(
  UpdateOrchestratorProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownUpdateOrchestratorProfileCommandInputEffect = Schema.decodeUnknownEffect(
  UpdateOrchestratorProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpdateOrchestratorProfileCommandInputExit = Schema.encodeExit(
  UpdateOrchestratorProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpdateOrchestratorProfileCommandInputEffect = Schema.encodeEffect(
  UpdateOrchestratorProfileCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownUpdateThreadHandlerProfileCommandInputExit = Schema.decodeUnknownExit(
  UpdateThreadHandlerProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownUpdateThreadHandlerProfileCommandInputEffect = Schema.decodeUnknownEffect(
  UpdateThreadHandlerProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpdateThreadHandlerProfileCommandInputExit = Schema.encodeExit(
  UpdateThreadHandlerProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpdateThreadHandlerProfileCommandInputEffect = Schema.encodeEffect(
  UpdateThreadHandlerProfileCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownDeleteOrchestratorProfileCommandInputExit = Schema.decodeUnknownExit(
  DeleteOrchestratorProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownDeleteOrchestratorProfileCommandInputEffect = Schema.decodeUnknownEffect(
  DeleteOrchestratorProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeDeleteOrchestratorProfileCommandInputExit = Schema.encodeExit(
  DeleteOrchestratorProfileCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeDeleteOrchestratorProfileCommandInputEffect = Schema.encodeEffect(
  DeleteOrchestratorProfileCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownReorderOrchestratorProfilesCommandInputExit = Schema.decodeUnknownExit(
  ReorderOrchestratorProfilesCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownReorderOrchestratorProfilesCommandInputEffect =
  Schema.decodeUnknownEffect(
    ReorderOrchestratorProfilesCommandInputSchema,
    strictBoundaryParseOptions,
  );
export const encodeReorderOrchestratorProfilesCommandInputExit = Schema.encodeExit(
  ReorderOrchestratorProfilesCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeReorderOrchestratorProfilesCommandInputEffect = Schema.encodeEffect(
  ReorderOrchestratorProfilesCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetProfileExtensionUsageCommandInputExit = Schema.decodeUnknownExit(
  SetProfileExtensionUsageCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetProfileExtensionUsageCommandInputEffect = Schema.decodeUnknownEffect(
  SetProfileExtensionUsageCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetProfileExtensionUsageCommandInputExit = Schema.encodeExit(
  SetProfileExtensionUsageCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetProfileExtensionUsageCommandInputEffect = Schema.encodeEffect(
  SetProfileExtensionUsageCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownPromoteProfileExtensionDefaultCommandInputExit = Schema.decodeUnknownExit(
  PromoteProfileExtensionDefaultCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownPromoteProfileExtensionDefaultCommandInputEffect =
  Schema.decodeUnknownEffect(
    PromoteProfileExtensionDefaultCommandInputSchema,
    strictBoundaryParseOptions,
  );
export const encodePromoteProfileExtensionDefaultCommandInputExit = Schema.encodeExit(
  PromoteProfileExtensionDefaultCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodePromoteProfileExtensionDefaultCommandInputEffect = Schema.encodeEffect(
  PromoteProfileExtensionDefaultCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownResetActorExtensionDefaultsCommandInputExit = Schema.decodeUnknownExit(
  ResetActorExtensionDefaultsCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownResetActorExtensionDefaultsCommandInputEffect =
  Schema.decodeUnknownEffect(
    ResetActorExtensionDefaultsCommandInputSchema,
    strictBoundaryParseOptions,
  );
export const encodeResetActorExtensionDefaultsCommandInputExit = Schema.encodeExit(
  ResetActorExtensionDefaultsCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeResetActorExtensionDefaultsCommandInputEffect = Schema.encodeEffect(
  ResetActorExtensionDefaultsCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetAgentActorExtensionDefaultsCommandInputExit = Schema.decodeUnknownExit(
  SetAgentActorExtensionDefaultsCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetAgentActorExtensionDefaultsCommandInputEffect =
  Schema.decodeUnknownEffect(
    SetAgentActorExtensionDefaultsCommandInputSchema,
    strictBoundaryParseOptions,
  );
export const encodeSetAgentActorExtensionDefaultsCommandInputExit = Schema.encodeExit(
  SetAgentActorExtensionDefaultsCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetAgentActorExtensionDefaultsCommandInputEffect = Schema.encodeEffect(
  SetAgentActorExtensionDefaultsCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetExternalInstructionActorUsageCommandInputExit =
  Schema.decodeUnknownExit(
    SetExternalInstructionActorUsageCommandInputSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownSetExternalInstructionActorUsageCommandInputEffect =
  Schema.decodeUnknownEffect(
    SetExternalInstructionActorUsageCommandInputSchema,
    strictBoundaryParseOptions,
  );
export const encodeSetExternalInstructionActorUsageCommandInputExit = Schema.encodeExit(
  SetExternalInstructionActorUsageCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetExternalInstructionActorUsageCommandInputEffect = Schema.encodeEffect(
  SetExternalInstructionActorUsageCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownCreateManagedSnippetCommandInputExit = Schema.decodeUnknownExit(
  CreateManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownCreateManagedSnippetCommandInputEffect = Schema.decodeUnknownEffect(
  CreateManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeCreateManagedSnippetCommandInputExit = Schema.encodeExit(
  CreateManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeCreateManagedSnippetCommandInputEffect = Schema.encodeEffect(
  CreateManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownUpdateManagedSnippetCommandInputExit = Schema.decodeUnknownExit(
  UpdateManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownUpdateManagedSnippetCommandInputEffect = Schema.decodeUnknownEffect(
  UpdateManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpdateManagedSnippetCommandInputExit = Schema.encodeExit(
  UpdateManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeUpdateManagedSnippetCommandInputEffect = Schema.encodeEffect(
  UpdateManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownDeleteManagedSnippetCommandInputExit = Schema.decodeUnknownExit(
  DeleteManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownDeleteManagedSnippetCommandInputEffect = Schema.decodeUnknownEffect(
  DeleteManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeDeleteManagedSnippetCommandInputExit = Schema.encodeExit(
  DeleteManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeDeleteManagedSnippetCommandInputEffect = Schema.encodeEffect(
  DeleteManagedSnippetCommandInputSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetSnippetEnabledCommandInputExit = Schema.decodeUnknownExit(
  SetSnippetEnabledCommandInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetSnippetEnabledCommandInputEffect = Schema.decodeUnknownEffect(
  SetSnippetEnabledCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetSnippetEnabledCommandInputExit = Schema.encodeExit(
  SetSnippetEnabledCommandInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetSnippetEnabledCommandInputEffect = Schema.encodeEffect(
  SetSnippetEnabledCommandInputSchema,
  strictBoundaryParseOptions,
);
