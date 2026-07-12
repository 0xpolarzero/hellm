import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  AbsolutePath,
  ExtensionId,
  GeneratedContextFingerprint,
  SurfacePiSessionId,
  ThreadId,
  WorkflowTaskAttemptId,
  WorkspaceSessionId,
  WorkspaceId,
} from "./ids";
import { NativeToolDeclarationSchema } from "./native-tool-contracts";
import { SourceDiagnosticSchema } from "./runtime-source-edit-contracts";
import { ActorKindSchema } from "./runtime-contracts";

export const ActorBindingSchema = Schema.Struct({
  actorKind: ActorKindSchema,
  loadedExtensionIds: Schema.Array(ExtensionId),
  availableExtensionIds: Schema.Array(ExtensionId),
  unavailableExtensionIds: Schema.Array(ExtensionId),
  instructionOrder: Schema.Array(ExtensionId),
  source: Schema.Literals(["profile-default", "surface-binding", "workflow-agent-source"]),
});
export type ActorBinding = typeof ActorBindingSchema.Type;

export const ExtensionInvocationTargetSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("orchestrator"),
    workspaceSessionId: WorkspaceSessionId,
    surfacePiSessionId: SurfacePiSessionId,
  }),
  Schema.Struct({
    kind: Schema.Literal("handler"),
    workspaceSessionId: WorkspaceSessionId,
    threadId: ThreadId,
    surfacePiSessionId: SurfacePiSessionId,
  }),
  Schema.Struct({
    kind: Schema.Literal("workflow-task"),
    workspaceSessionId: WorkspaceSessionId,
    workflowTaskAttemptId: WorkflowTaskAttemptId,
    surfacePiSessionId: SurfacePiSessionId,
  }),
]);
export type ExtensionInvocationTarget = typeof ExtensionInvocationTargetSchema.Type;

export const NativeToolHandlerLookupInputSchema = Schema.Struct({
  toolName: Schema.String,
  actorKind: ActorKindSchema,
  actorBinding: ActorBindingSchema,
  target: ExtensionInvocationTargetSchema,
  extensionUsageSource: Schema.Literals([
    "profile-default",
    "surface-binding",
    "workflow-agent-source",
  ]),
});
export type NativeToolHandlerLookupInput = typeof NativeToolHandlerLookupInputSchema.Type;

export const BuildGeneratedContextReasonSchema = Schema.Literals([
  "surface-dispatch",
  "surface-refresh",
  "source-reconcile",
  "generated-package-refresh",
  "diagnostics",
]);
export type BuildGeneratedContextReason = typeof BuildGeneratedContextReasonSchema.Type;

export const SourceFingerprintSchema = Schema.String.pipe(Schema.brand("SourceFingerprint"));
export type SourceFingerprint = typeof SourceFingerprintSchema.Type;

export const BuildGeneratedContextTargetSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("profile-preview"),
    workspaceId: WorkspaceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("orchestrator"),
    workspaceSessionId: WorkspaceSessionId,
  }),
  Schema.Struct({
    kind: Schema.Literal("handler"),
    workspaceSessionId: WorkspaceSessionId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    kind: Schema.Literal("workflow-task"),
    workspaceSessionId: WorkspaceSessionId,
    workflowTaskAttemptId: WorkflowTaskAttemptId,
  }),
]);
export type BuildGeneratedContextTarget = typeof BuildGeneratedContextTargetSchema.Type;

export const BuildGeneratedContextInputSchema = Schema.Struct({
  actorKind: ActorKindSchema,
  target: BuildGeneratedContextTargetSchema,
  actorBinding: ActorBindingSchema,
  workflowTaskInlineInstructions: Schema.optionalKey(
    Schema.Struct({
      sourceRecordId: Schema.String.check(Schema.isNonEmpty()),
      sourceVersion: SourceFingerprintSchema,
      text: Schema.String,
    }),
  ),
  reason: BuildGeneratedContextReasonSchema,
});
export type BuildGeneratedContextInput = typeof BuildGeneratedContextInputSchema.Type;

export const BuildExecuteTypescriptFacadeDeclarationsInputSchema = Schema.Struct({
  actorKind: ActorKindSchema,
  actorBinding: ActorBindingSchema,
});
export type BuildExecuteTypescriptFacadeDeclarationsInput =
  typeof BuildExecuteTypescriptFacadeDeclarationsInputSchema.Type;

export const GeneratedContextPromptBlockSchema = Schema.Struct({
  extensionId: ExtensionId,
  contributorId: Schema.String.check(Schema.isNonEmpty()),
  sourceRecordId: Schema.String.check(Schema.isNonEmpty()),
  sourceVersion: SourceFingerprintSchema,
  sourcePath: AbsolutePath,
  sourceFingerprint: SourceFingerprintSchema,
  text: Schema.String,
  tokenEstimate: Schema.Number.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
});
export type GeneratedContextPromptBlock = typeof GeneratedContextPromptBlockSchema.Type;

export const GeneratedContextExternalInstructionBlockSchema = Schema.Struct({
  sourceRecordId: Schema.String.check(Schema.isNonEmpty()),
  sourceVersion: SourceFingerprintSchema,
  sourcePath: AbsolutePath,
  sourceFingerprint: SourceFingerprintSchema,
  text: Schema.String,
  tokenEstimate: Schema.Number.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
});
export type GeneratedContextExternalInstructionBlock =
  typeof GeneratedContextExternalInstructionBlockSchema.Type;

export const GeneratedContextExecuteTypescriptFacadeDeclarationsSchema = Schema.Struct({
  text: Schema.String,
  emittedExtensionIds: Schema.Array(ExtensionId),
});
export type GeneratedContextExecuteTypescriptFacadeDeclarations =
  typeof GeneratedContextExecuteTypescriptFacadeDeclarationsSchema.Type;

export const ExecuteTypescriptFacadeDeclarationsSchema =
  GeneratedContextExecuteTypescriptFacadeDeclarationsSchema;
export type ExecuteTypescriptFacadeDeclarations =
  typeof ExecuteTypescriptFacadeDeclarationsSchema.Type;

export const GeneratedContextSchema = Schema.Struct({
  fingerprint: GeneratedContextFingerprint,
  promptBlocks: Schema.Array(GeneratedContextPromptBlockSchema),
  externalInstructionBlocks: Schema.Array(GeneratedContextExternalInstructionBlockSchema),
  nativeToolDeclarations: Schema.Array(NativeToolDeclarationSchema),
  svvyxGuidanceBlocks: Schema.Array(GeneratedContextPromptBlockSchema),
  executeTypescriptFacadeDeclarations: GeneratedContextExecuteTypescriptFacadeDeclarationsSchema,
  tokenEstimate: Schema.Number.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
  sourceFingerprints: Schema.Record(
    Schema.String.check(Schema.isNonEmpty()),
    SourceFingerprintSchema,
  ),
  diagnostics: Schema.Array(SourceDiagnosticSchema),
});
export type GeneratedContext = typeof GeneratedContextSchema.Type;

export const decodeUnknownBuildGeneratedContextInputEffect = Schema.decodeUnknownEffect(
  BuildGeneratedContextInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildGeneratedContextInputExit = Schema.decodeUnknownExit(
  BuildGeneratedContextInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGeneratedContextEffect = Schema.decodeUnknownEffect(
  GeneratedContextSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGeneratedContextExit = Schema.decodeUnknownExit(
  GeneratedContextSchema,
  strictBoundaryParseOptions,
);
export const encodeGeneratedContextEffect = Schema.encodeEffect(
  GeneratedContextSchema,
  strictBoundaryParseOptions,
);
export const encodeGeneratedContextExit = Schema.encodeExit(
  GeneratedContextSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownBuildExecuteTypescriptFacadeDeclarationsInputEffect =
  Schema.decodeUnknownEffect(
    BuildExecuteTypescriptFacadeDeclarationsInputSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownBuildExecuteTypescriptFacadeDeclarationsInputExit =
  Schema.decodeUnknownExit(
    BuildExecuteTypescriptFacadeDeclarationsInputSchema,
    strictBoundaryParseOptions,
  );
export const encodeBuildExecuteTypescriptFacadeDeclarationsInputEffect = Schema.encodeEffect(
  BuildExecuteTypescriptFacadeDeclarationsInputSchema,
  strictBoundaryParseOptions,
);
export const encodeBuildExecuteTypescriptFacadeDeclarationsInputExit = Schema.encodeExit(
  BuildExecuteTypescriptFacadeDeclarationsInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExecuteTypescriptFacadeDeclarationsEffect = Schema.decodeUnknownEffect(
  ExecuteTypescriptFacadeDeclarationsSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExecuteTypescriptFacadeDeclarationsExit = Schema.decodeUnknownExit(
  ExecuteTypescriptFacadeDeclarationsSchema,
  strictBoundaryParseOptions,
);
export const encodeExecuteTypescriptFacadeDeclarationsEffect = Schema.encodeEffect(
  ExecuteTypescriptFacadeDeclarationsSchema,
  strictBoundaryParseOptions,
);
export const encodeExecuteTypescriptFacadeDeclarationsExit = Schema.encodeExit(
  ExecuteTypescriptFacadeDeclarationsSchema,
  strictBoundaryParseOptions,
);

export {
  ChildProcessCommandExecutionPlanSchema,
  ExecutionPlanOperationSchema,
  ExtensionExecutionCommandDescriptionSchema,
  ExtensionExecutionEnvPlanSchema,
  ExtensionExecutionPlanSchema,
  ExtensionCategorySchema,
  ExtensionHandlerResultSchema,
  ExtensionInterfaceKindSchema,
  ExtensionRuntimeOperationSchema,
  ExtensionUsageStateSchema,
  FileEffectApplyPatchExecutionPlanSchema,
  RuntimeEffectOperationSchema,
  ThreadHistoryModeSchema,
  unsafeDecodeExtensionExecutionPlanSyncForTestsAndBootstrap,
  decodeUnknownExtensionExecutionPlanEffect,
  decodeUnknownExtensionExecutionPlanExit,
  encodeExtensionExecutionPlanEffect,
  encodeExtensionExecutionPlanExit,
  unsafeDecodeExtensionRuntimeOperationSyncForTestsAndBootstrap,
  decodeUnknownExtensionRuntimeOperationEffect,
  decodeUnknownExtensionRuntimeOperationExit,
  encodeExtensionRuntimeOperationEffect,
  encodeExtensionRuntimeOperationExit,
  unsafeDecodeExtensionHandlerResultSyncForTestsAndBootstrap,
  decodeUnknownExtensionHandlerResultEffect,
  decodeUnknownExtensionHandlerResultExit,
  encodeExtensionHandlerResultEffect,
  encodeExtensionHandlerResultExit,
} from "./runtime-contracts";

export type {
  ChildProcessCommandExecutionPlan,
  ExecutionPlanOperation,
  ExtensionExecutionCommandDescription,
  ExtensionExecutionEnvPlan,
  ExtensionExecutionPlan,
  ExtensionCategory,
  ExtensionHandlerResult,
  ExtensionInterfaceKind,
  ExtensionRuntimeOperation,
  ExtensionUsageState,
  FileEffectApplyPatchExecutionPlan,
  RuntimeEffectOperation,
  ThreadHistoryMode,
} from "./runtime-contracts";
