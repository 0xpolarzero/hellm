import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { ExtensionBuildAttemptIdSchema } from "./extension-build-contracts";
import { ExtensionId } from "./ids";
import { ExtensionBuildFailureReasonSchema } from "./runtime-state-ports";

const ExtensionLifecycleIdSchema = ExtensionId.check(
  Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
);
const CreatableExtensionIdSchema = ExtensionLifecycleIdSchema.check(
  Schema.makeFilter(
    (id: string) => id !== "extensions" || "extensions is a reserved extension id",
    {
      identifier: "CreatableExtensionId",
    },
  ),
);
const TrimmedNonEmptyStringSchema = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter(
    (value: string) =>
      value.trim() === value || "value must not have leading or trailing whitespace",
    { identifier: "TrimmedNonEmptyString" },
  ),
);

export const ExtensionSourceMutationIdSchema = Schema.String.check(
  Schema.isPattern(/^extension-source-mutation:[a-z][a-z0-9]*(?:-[a-z0-9]+)*:[0-9a-f]{64}$/),
).pipe(Schema.brand("ExtensionSourceMutationId"));

export const ExtensionInstructionBasenameSchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9](?!.*\.\.)[A-Za-z0-9._-]*\.mdx$/),
).pipe(Schema.brand("ExtensionInstructionBasename"));

export const CreateExtensionSourceInputSchema = Schema.Union([
  Schema.Struct({
    id: CreatableExtensionIdSchema,
    title: TrimmedNonEmptyStringSchema,
    description: TrimmedNonEmptyStringSchema,
    interfaceKind: Schema.Literal("instructions"),
    typescriptApiEnabled: Schema.Literal(false),
  }),
  Schema.Struct({
    id: CreatableExtensionIdSchema,
    title: TrimmedNonEmptyStringSchema,
    description: TrimmedNonEmptyStringSchema,
    interfaceKind: Schema.Literal("svvyx"),
    typescriptApiEnabled: Schema.Boolean,
  }),
]);

export const CreateExtensionSourceResultSchema = Schema.Struct({
  action: Schema.Literal("created"),
  mutationId: ExtensionSourceMutationIdSchema,
  extensionId: ExtensionLifecycleIdSchema,
  changed: Schema.Literal(true),
});

export const DuplicateExtensionSourceInputSchema = Schema.Struct({
  sourceExtensionId: ExtensionLifecycleIdSchema,
  targetExtensionId: CreatableExtensionIdSchema,
  title: TrimmedNonEmptyStringSchema,
});

export const DuplicateExtensionSourceResultSchema = Schema.Struct({
  action: Schema.Literal("duplicated"),
  mutationId: ExtensionSourceMutationIdSchema,
  sourceExtensionId: ExtensionLifecycleIdSchema,
  extensionId: ExtensionLifecycleIdSchema,
  changed: Schema.Literal(true),
});

export const DeleteExtensionSourceInputSchema = Schema.Struct({
  extensionId: ExtensionLifecycleIdSchema,
});

export const DeleteExtensionSourceResultSchema = Schema.Struct({
  action: Schema.Literal("deleted"),
  mutationId: ExtensionSourceMutationIdSchema,
  extensionId: ExtensionLifecycleIdSchema,
  changed: Schema.Literal(true),
});

export const ResetExtensionInstructionsInputSchema = Schema.Struct({
  extensionId: ExtensionLifecycleIdSchema,
  scope: Schema.Literal("instructions"),
});

export const ResetExtensionInstructionsResultSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("reset"),
    mutationId: ExtensionSourceMutationIdSchema,
    extensionId: ExtensionLifecycleIdSchema,
    scope: Schema.Literal("instructions"),
    changed: Schema.Literal(true),
  }),
  Schema.Struct({
    action: Schema.Literal("reset"),
    mutationId: Schema.Null,
    extensionId: ExtensionLifecycleIdSchema,
    scope: Schema.Literal("instructions"),
    changed: Schema.Literal(false),
  }),
]);

export const RuntimeResetExtensionAutomaticBuildOutcomeSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("scheduled"),
  }),
  Schema.Struct({
    status: Schema.Literal("skipped"),
    reason: Schema.Literal("source-unchanged"),
  }),
  Schema.Struct({
    status: Schema.Literal("succeeded"),
    attemptId: ExtensionBuildAttemptIdSchema,
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    attemptId: ExtensionBuildAttemptIdSchema,
    failureReason: ExtensionBuildFailureReasonSchema,
  }),
  Schema.Struct({
    status: Schema.Literal("not-started"),
    failureReason: ExtensionBuildFailureReasonSchema,
  }),
]);

export const RuntimeResetExtensionInstructionsResultSchema = Schema.Struct({
  source: ResetExtensionInstructionsResultSchema,
  automaticBuild: RuntimeResetExtensionAutomaticBuildOutcomeSchema,
}).check(
  Schema.makeFilter(
    (result: {
      readonly source: { readonly changed: boolean };
      readonly automaticBuild: {
        readonly status: "skipped" | "scheduled" | "succeeded" | "failed" | "not-started";
      };
    }) =>
      (result.source.changed && result.automaticBuild.status !== "skipped") ||
      (!result.source.changed && result.automaticBuild.status === "skipped") || {
        path: ["automaticBuild"],
        issue: "automatic build must run exactly when reset changes extension source",
      },
    { identifier: "RuntimeResetExtensionAutomaticBuildOutcome" },
  ),
);

export const AddExtensionInstructionInputSchema = Schema.Struct({
  extensionId: ExtensionLifecycleIdSchema,
  name: ExtensionInstructionBasenameSchema,
});

export const AddExtensionInstructionResultSchema = Schema.Struct({
  action: Schema.Literal("instruction-added"),
  mutationId: ExtensionSourceMutationIdSchema,
  extensionId: ExtensionLifecycleIdSchema,
  name: ExtensionInstructionBasenameSchema,
  changed: Schema.Literal(true),
});

export const RemoveExtensionInstructionInputSchema = Schema.Struct({
  extensionId: ExtensionLifecycleIdSchema,
  name: ExtensionInstructionBasenameSchema,
});

export const RemoveExtensionInstructionResultSchema = Schema.Struct({
  action: Schema.Literal("instruction-removed"),
  mutationId: ExtensionSourceMutationIdSchema,
  extensionId: ExtensionLifecycleIdSchema,
  name: ExtensionInstructionBasenameSchema,
  changed: Schema.Literal(true),
});

export const ConfigureExtensionInstructionInputSchema = Schema.Struct({
  extensionId: ExtensionLifecycleIdSchema,
  name: ExtensionInstructionBasenameSchema,
  bypassed: Schema.Boolean,
});

export const ConfigureExtensionInstructionResultSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("instruction-configured"),
    mutationId: ExtensionSourceMutationIdSchema,
    extensionId: ExtensionLifecycleIdSchema,
    name: ExtensionInstructionBasenameSchema,
    bypassed: Schema.Boolean,
    changed: Schema.Literal(true),
  }),
  Schema.Struct({
    action: Schema.Literal("instruction-configured"),
    mutationId: Schema.Null,
    extensionId: ExtensionLifecycleIdSchema,
    name: ExtensionInstructionBasenameSchema,
    bypassed: Schema.Boolean,
    changed: Schema.Literal(false),
  }),
]);

export const RenameExtensionInstructionInputSchema = Schema.Struct({
  extensionId: ExtensionLifecycleIdSchema,
  from: ExtensionInstructionBasenameSchema,
  to: ExtensionInstructionBasenameSchema,
});
export const RenameExtensionInstructionResultSchema = Schema.Struct({
  action: Schema.Literal("instruction-renamed"),
  mutationId: ExtensionSourceMutationIdSchema,
  extensionId: ExtensionLifecycleIdSchema,
  from: ExtensionInstructionBasenameSchema,
  to: ExtensionInstructionBasenameSchema,
  changed: Schema.Literal(true),
});

export const ReorderExtensionInstructionsInputSchema = Schema.Struct({
  extensionId: ExtensionLifecycleIdSchema,
  order: Schema.Array(ExtensionInstructionBasenameSchema),
});
export const ReorderExtensionInstructionsResultSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("instructions-reordered"),
    mutationId: ExtensionSourceMutationIdSchema,
    extensionId: ExtensionLifecycleIdSchema,
    order: Schema.Array(ExtensionInstructionBasenameSchema),
    changed: Schema.Literal(true),
  }),
  Schema.Struct({
    action: Schema.Literal("instructions-reordered"),
    mutationId: Schema.Null,
    extensionId: ExtensionLifecycleIdSchema,
    order: Schema.Array(ExtensionInstructionBasenameSchema),
    changed: Schema.Literal(false),
  }),
]);

export const RevertExtensionSourceMutationInputSchema = Schema.Struct({
  mutationId: ExtensionSourceMutationIdSchema,
});
export const RevertExtensionSourceMutationResultSchema = Schema.Struct({
  action: Schema.Literal("mutation-reverted"),
  mutationId: ExtensionSourceMutationIdSchema,
  revertedMutationId: ExtensionSourceMutationIdSchema,
  extensionId: ExtensionLifecycleIdSchema,
  changed: Schema.Literal(true),
});
export const RuntimeRevertExtensionSourceMutationResultSchema = Schema.Struct({
  source: RevertExtensionSourceMutationResultSchema,
  automaticBuild: RuntimeResetExtensionAutomaticBuildOutcomeSchema,
});

export type ExtensionSourceMutationId = typeof ExtensionSourceMutationIdSchema.Type;
export type ExtensionInstructionBasename = typeof ExtensionInstructionBasenameSchema.Type;
export type CreateExtensionSourceInput = typeof CreateExtensionSourceInputSchema.Type;
export type CreateExtensionSourceResult = typeof CreateExtensionSourceResultSchema.Type;
export type DuplicateExtensionSourceInput = typeof DuplicateExtensionSourceInputSchema.Type;
export type DuplicateExtensionSourceResult = typeof DuplicateExtensionSourceResultSchema.Type;
export type DeleteExtensionSourceInput = typeof DeleteExtensionSourceInputSchema.Type;
export type DeleteExtensionSourceResult = typeof DeleteExtensionSourceResultSchema.Type;
export type ResetExtensionInstructionsInput = typeof ResetExtensionInstructionsInputSchema.Type;
export type ResetExtensionInstructionsResult = typeof ResetExtensionInstructionsResultSchema.Type;
export type RuntimeResetExtensionAutomaticBuildOutcome =
  typeof RuntimeResetExtensionAutomaticBuildOutcomeSchema.Type;
export type RuntimeResetExtensionInstructionsResult =
  typeof RuntimeResetExtensionInstructionsResultSchema.Type;
export type AddExtensionInstructionInput = typeof AddExtensionInstructionInputSchema.Type;
export type AddExtensionInstructionResult = typeof AddExtensionInstructionResultSchema.Type;
export type RemoveExtensionInstructionInput = typeof RemoveExtensionInstructionInputSchema.Type;
export type RemoveExtensionInstructionResult = typeof RemoveExtensionInstructionResultSchema.Type;
export type ConfigureExtensionInstructionInput =
  typeof ConfigureExtensionInstructionInputSchema.Type;
export type ConfigureExtensionInstructionResult =
  typeof ConfigureExtensionInstructionResultSchema.Type;
export type RenameExtensionInstructionInput = typeof RenameExtensionInstructionInputSchema.Type;
export type RenameExtensionInstructionResult = typeof RenameExtensionInstructionResultSchema.Type;
export type ReorderExtensionInstructionsInput = typeof ReorderExtensionInstructionsInputSchema.Type;
export type ReorderExtensionInstructionsResult =
  typeof ReorderExtensionInstructionsResultSchema.Type;
export type RevertExtensionSourceMutationInput =
  typeof RevertExtensionSourceMutationInputSchema.Type;
export type RevertExtensionSourceMutationResult =
  typeof RevertExtensionSourceMutationResultSchema.Type;
export type RuntimeRevertExtensionSourceMutationResult =
  typeof RuntimeRevertExtensionSourceMutationResultSchema.Type;

const boundaryCodecs = <
  Type,
  Encoded,
  SchemaType extends Schema.Codec<Type, Encoded, never, never>,
>(
  schema: SchemaType,
) => ({
  decodeEffect: Schema.decodeUnknownEffect(schema, strictBoundaryParseOptions),
  decodeExit: Schema.decodeUnknownExit(schema, strictBoundaryParseOptions),
  encodeEffect: Schema.encodeEffect(schema, strictBoundaryParseOptions),
  encodeExit: Schema.encodeExit(schema, strictBoundaryParseOptions),
});

const createInputCodecs = boundaryCodecs(CreateExtensionSourceInputSchema);
export const decodeUnknownCreateExtensionSourceInputEffect = createInputCodecs.decodeEffect;
export const decodeUnknownCreateExtensionSourceInputExit = createInputCodecs.decodeExit;
export const encodeCreateExtensionSourceInputEffect = createInputCodecs.encodeEffect;
export const encodeCreateExtensionSourceInputExit = createInputCodecs.encodeExit;
const createResultCodecs = boundaryCodecs(CreateExtensionSourceResultSchema);
export const decodeUnknownCreateExtensionSourceResultEffect = createResultCodecs.decodeEffect;
export const decodeUnknownCreateExtensionSourceResultExit = createResultCodecs.decodeExit;
export const encodeCreateExtensionSourceResultEffect = createResultCodecs.encodeEffect;
export const encodeCreateExtensionSourceResultExit = createResultCodecs.encodeExit;

const duplicateInputCodecs = boundaryCodecs(DuplicateExtensionSourceInputSchema);
export const decodeUnknownDuplicateExtensionSourceInputEffect = duplicateInputCodecs.decodeEffect;
export const decodeUnknownDuplicateExtensionSourceInputExit = duplicateInputCodecs.decodeExit;
export const encodeDuplicateExtensionSourceInputEffect = duplicateInputCodecs.encodeEffect;
export const encodeDuplicateExtensionSourceInputExit = duplicateInputCodecs.encodeExit;
const duplicateResultCodecs = boundaryCodecs(DuplicateExtensionSourceResultSchema);
export const decodeUnknownDuplicateExtensionSourceResultEffect = duplicateResultCodecs.decodeEffect;
export const decodeUnknownDuplicateExtensionSourceResultExit = duplicateResultCodecs.decodeExit;
export const encodeDuplicateExtensionSourceResultEffect = duplicateResultCodecs.encodeEffect;
export const encodeDuplicateExtensionSourceResultExit = duplicateResultCodecs.encodeExit;

const deleteInputCodecs = boundaryCodecs(DeleteExtensionSourceInputSchema);
export const decodeUnknownDeleteExtensionSourceInputEffect = deleteInputCodecs.decodeEffect;
export const decodeUnknownDeleteExtensionSourceInputExit = deleteInputCodecs.decodeExit;
export const encodeDeleteExtensionSourceInputEffect = deleteInputCodecs.encodeEffect;
export const encodeDeleteExtensionSourceInputExit = deleteInputCodecs.encodeExit;
const deleteResultCodecs = boundaryCodecs(DeleteExtensionSourceResultSchema);
export const decodeUnknownDeleteExtensionSourceResultEffect = deleteResultCodecs.decodeEffect;
export const decodeUnknownDeleteExtensionSourceResultExit = deleteResultCodecs.decodeExit;
export const encodeDeleteExtensionSourceResultEffect = deleteResultCodecs.encodeEffect;
export const encodeDeleteExtensionSourceResultExit = deleteResultCodecs.encodeExit;

const resetInputCodecs = boundaryCodecs(ResetExtensionInstructionsInputSchema);
export const decodeUnknownResetExtensionInstructionsInputEffect = resetInputCodecs.decodeEffect;
export const decodeUnknownResetExtensionInstructionsInputExit = resetInputCodecs.decodeExit;
export const encodeResetExtensionInstructionsInputEffect = resetInputCodecs.encodeEffect;
export const encodeResetExtensionInstructionsInputExit = resetInputCodecs.encodeExit;
const resetResultCodecs = boundaryCodecs(ResetExtensionInstructionsResultSchema);
export const decodeUnknownResetExtensionInstructionsResultEffect = resetResultCodecs.decodeEffect;
export const decodeUnknownResetExtensionInstructionsResultExit = resetResultCodecs.decodeExit;
export const encodeResetExtensionInstructionsResultEffect = resetResultCodecs.encodeEffect;
export const encodeResetExtensionInstructionsResultExit = resetResultCodecs.encodeExit;
const runtimeResetResultCodecs = boundaryCodecs(RuntimeResetExtensionInstructionsResultSchema);
export const decodeUnknownRuntimeResetExtensionInstructionsResultEffect =
  runtimeResetResultCodecs.decodeEffect;
export const decodeUnknownRuntimeResetExtensionInstructionsResultExit =
  runtimeResetResultCodecs.decodeExit;
export const encodeRuntimeResetExtensionInstructionsResultEffect =
  runtimeResetResultCodecs.encodeEffect;
export const encodeRuntimeResetExtensionInstructionsResultExit =
  runtimeResetResultCodecs.encodeExit;

const addInputCodecs = boundaryCodecs(AddExtensionInstructionInputSchema);
export const decodeUnknownAddExtensionInstructionInputEffect = addInputCodecs.decodeEffect;
export const decodeUnknownAddExtensionInstructionInputExit = addInputCodecs.decodeExit;
export const encodeAddExtensionInstructionInputEffect = addInputCodecs.encodeEffect;
export const encodeAddExtensionInstructionInputExit = addInputCodecs.encodeExit;
const addResultCodecs = boundaryCodecs(AddExtensionInstructionResultSchema);
export const decodeUnknownAddExtensionInstructionResultEffect = addResultCodecs.decodeEffect;
export const decodeUnknownAddExtensionInstructionResultExit = addResultCodecs.decodeExit;
export const encodeAddExtensionInstructionResultEffect = addResultCodecs.encodeEffect;
export const encodeAddExtensionInstructionResultExit = addResultCodecs.encodeExit;

const removeInputCodecs = boundaryCodecs(RemoveExtensionInstructionInputSchema);
export const decodeUnknownRemoveExtensionInstructionInputEffect = removeInputCodecs.decodeEffect;
export const decodeUnknownRemoveExtensionInstructionInputExit = removeInputCodecs.decodeExit;
export const encodeRemoveExtensionInstructionInputEffect = removeInputCodecs.encodeEffect;
export const encodeRemoveExtensionInstructionInputExit = removeInputCodecs.encodeExit;
const removeResultCodecs = boundaryCodecs(RemoveExtensionInstructionResultSchema);
export const decodeUnknownRemoveExtensionInstructionResultEffect = removeResultCodecs.decodeEffect;
export const decodeUnknownRemoveExtensionInstructionResultExit = removeResultCodecs.decodeExit;
export const encodeRemoveExtensionInstructionResultEffect = removeResultCodecs.encodeEffect;
export const encodeRemoveExtensionInstructionResultExit = removeResultCodecs.encodeExit;

const configureInputCodecs = boundaryCodecs(ConfigureExtensionInstructionInputSchema);
export const decodeUnknownConfigureExtensionInstructionInputEffect =
  configureInputCodecs.decodeEffect;
export const decodeUnknownConfigureExtensionInstructionInputExit = configureInputCodecs.decodeExit;
export const encodeConfigureExtensionInstructionInputEffect = configureInputCodecs.encodeEffect;
export const encodeConfigureExtensionInstructionInputExit = configureInputCodecs.encodeExit;
const configureResultCodecs = boundaryCodecs(ConfigureExtensionInstructionResultSchema);
export const decodeUnknownConfigureExtensionInstructionResultEffect =
  configureResultCodecs.decodeEffect;
export const decodeUnknownConfigureExtensionInstructionResultExit =
  configureResultCodecs.decodeExit;
export const encodeConfigureExtensionInstructionResultEffect = configureResultCodecs.encodeEffect;
export const encodeConfigureExtensionInstructionResultExit = configureResultCodecs.encodeExit;

const renameInstructionInputCodecs = boundaryCodecs(RenameExtensionInstructionInputSchema);
export const decodeUnknownRenameExtensionInstructionInputEffect =
  renameInstructionInputCodecs.decodeEffect;
export const decodeUnknownRenameExtensionInstructionInputExit =
  renameInstructionInputCodecs.decodeExit;
export const encodeRenameExtensionInstructionInputEffect =
  renameInstructionInputCodecs.encodeEffect;
export const encodeRenameExtensionInstructionInputExit = renameInstructionInputCodecs.encodeExit;
const renameInstructionResultCodecs = boundaryCodecs(RenameExtensionInstructionResultSchema);
export const decodeUnknownRenameExtensionInstructionResultEffect =
  renameInstructionResultCodecs.decodeEffect;
export const decodeUnknownRenameExtensionInstructionResultExit =
  renameInstructionResultCodecs.decodeExit;
export const encodeRenameExtensionInstructionResultEffect =
  renameInstructionResultCodecs.encodeEffect;
export const encodeRenameExtensionInstructionResultExit = renameInstructionResultCodecs.encodeExit;

const reorderInstructionsInputCodecs = boundaryCodecs(ReorderExtensionInstructionsInputSchema);
export const decodeUnknownReorderExtensionInstructionsInputEffect =
  reorderInstructionsInputCodecs.decodeEffect;
export const decodeUnknownReorderExtensionInstructionsInputExit =
  reorderInstructionsInputCodecs.decodeExit;
export const encodeReorderExtensionInstructionsInputEffect =
  reorderInstructionsInputCodecs.encodeEffect;
export const encodeReorderExtensionInstructionsInputExit =
  reorderInstructionsInputCodecs.encodeExit;
const reorderInstructionsResultCodecs = boundaryCodecs(ReorderExtensionInstructionsResultSchema);
export const decodeUnknownReorderExtensionInstructionsResultEffect =
  reorderInstructionsResultCodecs.decodeEffect;
export const decodeUnknownReorderExtensionInstructionsResultExit =
  reorderInstructionsResultCodecs.decodeExit;
export const encodeReorderExtensionInstructionsResultEffect =
  reorderInstructionsResultCodecs.encodeEffect;
export const encodeReorderExtensionInstructionsResultExit =
  reorderInstructionsResultCodecs.encodeExit;

const revertMutationInputCodecs = boundaryCodecs(RevertExtensionSourceMutationInputSchema);
export const decodeUnknownRevertExtensionSourceMutationInputEffect =
  revertMutationInputCodecs.decodeEffect;
export const decodeUnknownRevertExtensionSourceMutationInputExit =
  revertMutationInputCodecs.decodeExit;
export const encodeRevertExtensionSourceMutationInputEffect =
  revertMutationInputCodecs.encodeEffect;
export const encodeRevertExtensionSourceMutationInputExit = revertMutationInputCodecs.encodeExit;
const revertMutationResultCodecs = boundaryCodecs(RevertExtensionSourceMutationResultSchema);
export const decodeUnknownRevertExtensionSourceMutationResultEffect =
  revertMutationResultCodecs.decodeEffect;
export const decodeUnknownRevertExtensionSourceMutationResultExit =
  revertMutationResultCodecs.decodeExit;
export const encodeRevertExtensionSourceMutationResultEffect =
  revertMutationResultCodecs.encodeEffect;
export const encodeRevertExtensionSourceMutationResultExit = revertMutationResultCodecs.encodeExit;
const runtimeRevertMutationResultCodecs = boundaryCodecs(
  RuntimeRevertExtensionSourceMutationResultSchema,
);
export const decodeUnknownRuntimeRevertExtensionSourceMutationResultEffect =
  runtimeRevertMutationResultCodecs.decodeEffect;
export const decodeUnknownRuntimeRevertExtensionSourceMutationResultExit =
  runtimeRevertMutationResultCodecs.decodeExit;
export const encodeRuntimeRevertExtensionSourceMutationResultEffect =
  runtimeRevertMutationResultCodecs.encodeEffect;
export const encodeRuntimeRevertExtensionSourceMutationResultExit =
  runtimeRevertMutationResultCodecs.encodeExit;
