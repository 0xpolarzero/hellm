import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { AbsolutePath, CommandId, ExtensionId, IsoDateTimeStringSchema, WorkspaceId } from "./ids";
import {
  ExtensionUsageStateSchema,
  ReasoningSelectionSchema,
  TaskAgentParametersSourceSchema,
} from "./runtime-contracts";

export const ExtensionSourceKindSchema = Schema.Literals([
  "builtin-extension",
  "user-extension",
  "workflow-agent",
  "workflow-prompt",
  "workflow-component",
  "workflow-workflow",
]);

export type ExtensionSourceKind = typeof ExtensionSourceKindSchema.Type;

export const SourceDiagnosticSchema = Schema.Struct({
  severity: Schema.Literals(["error", "warning", "info"]),
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(AbsolutePath),
  line: Schema.optionalKey(Schema.Number),
  column: Schema.optionalKey(Schema.Number),
});

export type SourceDiagnostic = typeof SourceDiagnosticSchema.Type;

export const OpenExtensionSourceEditInputSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
});

export type OpenExtensionSourceEditInput = typeof OpenExtensionSourceEditInputSchema.Type;

export const SourceEditSessionSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
  path: AbsolutePath,
  sourceVersion: Schema.String,
  fingerprint: Schema.String,
  text: Schema.String,
  diagnostics: Schema.Array(SourceDiagnosticSchema),
});

export type SourceEditSession = typeof SourceEditSessionSchema.Type;

export const SaveExtensionSourceEditInputSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
  expectedSourceVersion: Schema.String,
  text: Schema.String,
  saveMode: Schema.Literals(["compare-and-swap", "overwrite"]),
  sourceCommandId: Schema.optionalKey(CommandId),
});

export type SaveExtensionSourceEditInput = typeof SaveExtensionSourceEditInputSchema.Type;

export const RuntimeSaveExtensionSourceEditInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  source: SaveExtensionSourceEditInputSchema,
});

export type RuntimeSaveExtensionSourceEditInput =
  typeof RuntimeSaveExtensionSourceEditInputSchema.Type;

export const SourceEditSaveResultSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("saved"),
    sourceVersion: Schema.String,
    fingerprint: Schema.String,
    diagnostics: Schema.Array(SourceDiagnosticSchema),
    reconcileRequired: Schema.Boolean,
  }),
  Schema.Struct({
    status: Schema.Literal("stale"),
    current: SourceEditSessionSchema,
  }),
]);

export type SourceEditSaveResult =
  | {
      readonly status: "saved";
      readonly sourceVersion: string;
      readonly fingerprint: string;
      readonly diagnostics: readonly SourceDiagnostic[];
      readonly reconcileRequired: boolean;
    }
  | {
      readonly status: "stale";
      readonly current: SourceEditSession;
    };

const WorkflowAgentSourceExportNamePattern = /^[A-Za-z_$][\w$]*$/;

export const WorkflowAgentSourceExportNameSchema = Schema.String.check(
  Schema.isPattern(WorkflowAgentSourceExportNamePattern),
).pipe(Schema.brand("WorkflowAgentSourceExportName"));

export type WorkflowAgentSourceExportName = typeof WorkflowAgentSourceExportNameSchema.Type;

export function isWorkflowAgentSourceExportName(
  sourceId: string,
): sourceId is WorkflowAgentSourceExportName {
  return WorkflowAgentSourceExportNamePattern.test(sourceId);
}

const WorkflowAgentExtensionUsageOverrideSchema = Schema.Struct({
  extensionId: ExtensionId,
  usage: ExtensionUsageStateSchema,
});

const UniqueWorkflowAgentExtensionUsageOverrides = Schema.makeFilter(
  (input: ReadonlyArray<{ readonly extensionId: string }>) => {
    const ids = input.map((entry) => entry.extensionId);
    return new Set(ids).size === ids.length;
  },
  { expected: "unique workflow-agent extension usage override ids" },
);

const UniqueWorkflowAgentExtensionOrder = Schema.makeFilter(
  (input: ReadonlyArray<string>) => new Set(input).size === input.length,
  { expected: "unique workflow-agent extension order ids" },
);

export const WorkflowAgentSourceDraftSchema = Schema.Struct({
  exportName: WorkflowAgentSourceExportNameSchema,
  displayName: Schema.String.check(Schema.isNonEmpty()),
  provider: Schema.String.check(Schema.isNonEmpty()),
  model: Schema.String.check(Schema.isNonEmpty()),
  reasoning: ReasoningSelectionSchema,
  instructionText: Schema.optionalKey(Schema.String),
  extensionUsageOverrides: Schema.optionalKey(
    Schema.Array(WorkflowAgentExtensionUsageOverrideSchema).check(
      UniqueWorkflowAgentExtensionUsageOverrides,
    ),
  ),
  extensionOrder: Schema.optionalKey(
    Schema.Array(ExtensionId).check(UniqueWorkflowAgentExtensionOrder),
  ),
});

export type WorkflowAgentSourceDraft = typeof WorkflowAgentSourceDraftSchema.Type;

export const DEFAULT_WORKFLOW_AGENT_SOURCE_IDS = [
  "defaultAgent",
  "explorerAgent",
  "implementerAgent",
  "reviewerAgent",
] as const;

export const DefaultWorkflowAgentSourceIdSchema = Schema.Literals(
  DEFAULT_WORKFLOW_AGENT_SOURCE_IDS,
);

export type DefaultWorkflowAgentSourceId = typeof DefaultWorkflowAgentSourceIdSchema.Type;

type WorkflowAgentSourceObservationShape = {
  readonly sourceId: string;
  readonly validationStatus: "valid" | "invalid";
  readonly parameters: typeof TaskAgentParametersSourceSchema.Type | null;
};

const WorkflowAgentSourceObservationInvariant = Schema.makeFilter(
  (input: WorkflowAgentSourceObservationShape) =>
    (input.validationStatus === "valid" &&
      input.parameters !== null &&
      isWorkflowAgentSourceExportName(input.sourceId) &&
      input.parameters.id === input.sourceId) ||
    (input.validationStatus === "invalid" && input.parameters === null),
  {
    expected:
      "workflow-agent source validation status and filename identity matching parsed parameters",
  },
);

export const WorkflowAgentSourceObservationSchema = Schema.Struct({
  sourceId: Schema.String,
  path: AbsolutePath,
  sourceVersion: Schema.String.check(Schema.isNonEmpty()),
  fingerprint: Schema.String.check(Schema.isNonEmpty()),
  validationStatus: Schema.Literals(["valid", "invalid"]),
  diagnostics: Schema.Array(SourceDiagnosticSchema),
  parameters: Schema.NullOr(TaskAgentParametersSourceSchema),
  extensionOrder: Schema.Array(ExtensionId),
  observedAt: IsoDateTimeStringSchema,
}).pipe(Schema.check(WorkflowAgentSourceObservationInvariant));

export type WorkflowAgentSourceObservation = typeof WorkflowAgentSourceObservationSchema.Type;

export const WorkflowAgentSourceScaffoldRecordSchema = Schema.Struct({
  sourceId: DefaultWorkflowAgentSourceIdSchema,
  path: AbsolutePath,
});

export type WorkflowAgentSourceScaffoldRecord = typeof WorkflowAgentSourceScaffoldRecordSchema.Type;

export const ScaffoldMissingWorkflowAgentSourcesResultSchema = Schema.Struct({
  created: Schema.Array(WorkflowAgentSourceScaffoldRecordSchema),
  preserved: Schema.Array(WorkflowAgentSourceScaffoldRecordSchema),
});

export type ScaffoldMissingWorkflowAgentSourcesResult =
  typeof ScaffoldMissingWorkflowAgentSourcesResultSchema.Type;

export const WorkflowSourceOwnerSchema = Schema.Literals([
  "agents-pane",
  "svvyx-workflows-command",
  "headless",
]);

export type WorkflowSourceOwner = typeof WorkflowSourceOwnerSchema.Type;

export const CreateWorkflowAgentSourceInputSchema = Schema.Struct({
  draft: WorkflowAgentSourceDraftSchema,
  sourceOwner: WorkflowSourceOwnerSchema,
  sourceCommandId: Schema.optionalKey(CommandId),
});

export type CreateWorkflowAgentSourceInput = typeof CreateWorkflowAgentSourceInputSchema.Type;

export const DuplicateWorkflowAgentSourceInputSchema = Schema.Struct({
  sourceId: WorkflowAgentSourceExportNameSchema,
  draftPatch: Schema.Struct({
    exportName: WorkflowAgentSourceExportNameSchema,
    displayName: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
    instructionText: Schema.optionalKey(Schema.String),
  }),
  sourceOwner: WorkflowSourceOwnerSchema,
  sourceCommandId: Schema.optionalKey(CommandId),
});

export type DuplicateWorkflowAgentSourceInput = typeof DuplicateWorkflowAgentSourceInputSchema.Type;

export const DeleteWorkflowAgentSourceInputSchema = Schema.Struct({
  sourceId: WorkflowAgentSourceExportNameSchema,
  expectedSourceVersion: Schema.String.check(Schema.isNonEmpty()),
  sourceOwner: WorkflowSourceOwnerSchema,
  sourceCommandId: Schema.optionalKey(CommandId),
});

export type DeleteWorkflowAgentSourceInput = typeof DeleteWorkflowAgentSourceInputSchema.Type;

export const RuntimeCreateWorkflowAgentSourceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  source: CreateWorkflowAgentSourceInputSchema,
});

export type RuntimeCreateWorkflowAgentSourceInput =
  typeof RuntimeCreateWorkflowAgentSourceInputSchema.Type;

export const RuntimeDuplicateWorkflowAgentSourceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  source: DuplicateWorkflowAgentSourceInputSchema,
});

export type RuntimeDuplicateWorkflowAgentSourceInput =
  typeof RuntimeDuplicateWorkflowAgentSourceInputSchema.Type;

export const RuntimeDeleteWorkflowAgentSourceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  source: DeleteWorkflowAgentSourceInputSchema,
});

export type RuntimeDeleteWorkflowAgentSourceInput =
  typeof RuntimeDeleteWorkflowAgentSourceInputSchema.Type;

const WorkflowAgentSourceEditSessionSchema = Schema.Struct({
  ...SourceEditSessionSchema.fields,
  sourceKind: Schema.Literal("workflow-agent"),
  sourceId: WorkflowAgentSourceExportNameSchema,
});

export const WorkflowAgentSourceLifecycleResultSchema = Schema.Struct({
  status: Schema.Literals(["created", "duplicated"]),
  session: WorkflowAgentSourceEditSessionSchema,
  fileWriteReceipt: Schema.Struct({
    path: AbsolutePath,
    previousExists: Schema.Literal(false),
    bytes: Schema.Number,
  }),
  reconcileRequired: Schema.Literal(true),
});

export type WorkflowAgentSourceLifecycleResult =
  typeof WorkflowAgentSourceLifecycleResultSchema.Type;

export const WorkflowAgentSourceDeleteResultSchema = Schema.Struct({
  status: Schema.Literal("deleted"),
  sourceKind: Schema.Literal("workflow-agent"),
  sourceId: WorkflowAgentSourceExportNameSchema,
  deletedPath: AbsolutePath,
  previousSourceVersion: Schema.String,
  fileWriteReceipt: Schema.Struct({
    path: AbsolutePath,
    deleted: Schema.Literal(true),
  }),
  reconcileRequired: Schema.Literal(true),
});

export type WorkflowAgentSourceDeleteResult = typeof WorkflowAgentSourceDeleteResultSchema.Type;

export const unsafeDecodeOpenExtensionSourceEditInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(OpenExtensionSourceEditInputSchema, strictBoundaryParseOptions);
export const decodeUnknownOpenExtensionSourceEditInputExit = Schema.decodeUnknownExit(
  OpenExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownOpenExtensionSourceEditInputEffect = Schema.decodeUnknownEffect(
  OpenExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeSourceEditSessionSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  SourceEditSessionSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSourceEditSessionExit = Schema.decodeUnknownExit(
  SourceEditSessionSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSourceEditSessionEffect = Schema.decodeUnknownEffect(
  SourceEditSessionSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeSaveExtensionSourceEditInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(SaveExtensionSourceEditInputSchema, strictBoundaryParseOptions);
export const decodeUnknownSaveExtensionSourceEditInputExit = Schema.decodeUnknownExit(
  SaveExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSaveExtensionSourceEditInputEffect = Schema.decodeUnknownEffect(
  SaveExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeRuntimeSaveExtensionSourceEditInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RuntimeSaveExtensionSourceEditInputSchema, strictBoundaryParseOptions);
export const decodeUnknownRuntimeSaveExtensionSourceEditInputExit = Schema.decodeUnknownExit(
  RuntimeSaveExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeSaveExtensionSourceEditInputEffect = Schema.decodeUnknownEffect(
  RuntimeSaveExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeSourceEditSaveResultSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  SourceEditSaveResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSourceEditSaveResultExit = Schema.decodeUnknownExit(
  SourceEditSaveResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSourceEditSaveResultEffect = Schema.decodeUnknownEffect(
  SourceEditSaveResultSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(CreateWorkflowAgentSourceInputSchema, strictBoundaryParseOptions);
export const decodeUnknownCreateWorkflowAgentSourceInputExit = Schema.decodeUnknownExit(
  CreateWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownCreateWorkflowAgentSourceInputEffect = Schema.decodeUnknownEffect(
  CreateWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeDuplicateWorkflowAgentSourceInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(DuplicateWorkflowAgentSourceInputSchema, strictBoundaryParseOptions);
export const decodeUnknownDuplicateWorkflowAgentSourceInputExit = Schema.decodeUnknownExit(
  DuplicateWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownDuplicateWorkflowAgentSourceInputEffect = Schema.decodeUnknownEffect(
  DuplicateWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeDeleteWorkflowAgentSourceInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(DeleteWorkflowAgentSourceInputSchema, strictBoundaryParseOptions);
export const decodeUnknownDeleteWorkflowAgentSourceInputExit = Schema.decodeUnknownExit(
  DeleteWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownDeleteWorkflowAgentSourceInputEffect = Schema.decodeUnknownEffect(
  DeleteWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeRuntimeCreateWorkflowAgentSourceInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RuntimeCreateWorkflowAgentSourceInputSchema, strictBoundaryParseOptions);
export const decodeUnknownRuntimeCreateWorkflowAgentSourceInputExit = Schema.decodeUnknownExit(
  RuntimeCreateWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeCreateWorkflowAgentSourceInputEffect = Schema.decodeUnknownEffect(
  RuntimeCreateWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeRuntimeDuplicateWorkflowAgentSourceInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(
    RuntimeDuplicateWorkflowAgentSourceInputSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownRuntimeDuplicateWorkflowAgentSourceInputExit = Schema.decodeUnknownExit(
  RuntimeDuplicateWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeDuplicateWorkflowAgentSourceInputEffect =
  Schema.decodeUnknownEffect(
    RuntimeDuplicateWorkflowAgentSourceInputSchema,
    strictBoundaryParseOptions,
  );
export const unsafeDecodeRuntimeDeleteWorkflowAgentSourceInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RuntimeDeleteWorkflowAgentSourceInputSchema, strictBoundaryParseOptions);
export const decodeUnknownRuntimeDeleteWorkflowAgentSourceInputExit = Schema.decodeUnknownExit(
  RuntimeDeleteWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeDeleteWorkflowAgentSourceInputEffect = Schema.decodeUnknownEffect(
  RuntimeDeleteWorkflowAgentSourceInputSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeWorkflowAgentSourceLifecycleResultSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(WorkflowAgentSourceLifecycleResultSchema, strictBoundaryParseOptions);
export const decodeUnknownWorkflowAgentSourceLifecycleResultExit = Schema.decodeUnknownExit(
  WorkflowAgentSourceLifecycleResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkflowAgentSourceLifecycleResultEffect = Schema.decodeUnknownEffect(
  WorkflowAgentSourceLifecycleResultSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkflowAgentSourceLifecycleResultExit = Schema.encodeExit(
  WorkflowAgentSourceLifecycleResultSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkflowAgentSourceLifecycleResultEffect = Schema.encodeEffect(
  WorkflowAgentSourceLifecycleResultSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeWorkflowAgentSourceDeleteResultSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(WorkflowAgentSourceDeleteResultSchema, strictBoundaryParseOptions);
export const decodeUnknownWorkflowAgentSourceDeleteResultExit = Schema.decodeUnknownExit(
  WorkflowAgentSourceDeleteResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkflowAgentSourceDeleteResultEffect = Schema.decodeUnknownEffect(
  WorkflowAgentSourceDeleteResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkflowAgentSourceObservationExit = Schema.decodeUnknownExit(
  WorkflowAgentSourceObservationSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeWorkflowAgentSourceObservationSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(WorkflowAgentSourceObservationSchema, strictBoundaryParseOptions);
export const decodeUnknownWorkflowAgentSourceObservationEffect = Schema.decodeUnknownEffect(
  WorkflowAgentSourceObservationSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkflowAgentSourceObservationExit = Schema.encodeExit(
  WorkflowAgentSourceObservationSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkflowAgentSourceObservationEffect = Schema.encodeEffect(
  WorkflowAgentSourceObservationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownScaffoldMissingWorkflowAgentSourcesResultExit = Schema.decodeUnknownExit(
  ScaffoldMissingWorkflowAgentSourcesResultSchema,
  strictBoundaryParseOptions,
);
export const unsafeDecodeScaffoldMissingWorkflowAgentSourcesResultSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(
    ScaffoldMissingWorkflowAgentSourcesResultSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownScaffoldMissingWorkflowAgentSourcesResultEffect =
  Schema.decodeUnknownEffect(
    ScaffoldMissingWorkflowAgentSourcesResultSchema,
    strictBoundaryParseOptions,
  );
export const encodeScaffoldMissingWorkflowAgentSourcesResultExit = Schema.encodeExit(
  ScaffoldMissingWorkflowAgentSourcesResultSchema,
  strictBoundaryParseOptions,
);
export const encodeScaffoldMissingWorkflowAgentSourcesResultEffect = Schema.encodeEffect(
  ScaffoldMissingWorkflowAgentSourcesResultSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkflowAgentSourceDeleteResultExit = Schema.encodeExit(
  WorkflowAgentSourceDeleteResultSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkflowAgentSourceDeleteResultEffect = Schema.encodeEffect(
  WorkflowAgentSourceDeleteResultSchema,
  strictBoundaryParseOptions,
);
