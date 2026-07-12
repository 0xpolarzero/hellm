import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { ExtensionRegistryObservationResultSchema } from "./extension-inventory-contracts";
import {
  AbsolutePath,
  ExtensionId,
  IsoDateTimeStringSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  RuntimeClientRequestId,
} from "./ids";
import { ExtensionInterfaceKindSchema } from "./runtime-contracts";

const Sha256FingerprintSchema = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));

export const ExtensionSourceFingerprintSchema = Sha256FingerprintSchema.pipe(
  Schema.brand("ExtensionSourceFingerprint"),
);
export const ExtensionBuildOutputFingerprintSchema = Sha256FingerprintSchema.pipe(
  Schema.brand("ExtensionBuildOutputFingerprint"),
);
export const ExtensionContextFingerprintSchema = Sha256FingerprintSchema.pipe(
  Schema.brand("ExtensionContextFingerprint"),
);
export const ExtensionBuildIdSchema = Schema.String.check(
  Schema.isPattern(/^extension-build:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?:[0-9a-f]{64}$/),
).pipe(Schema.brand("ExtensionBuildId"));
export const ExtensionBuildAttemptIdSchema = Schema.String.check(
  Schema.isPattern(/^extension-build-attempt:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?:[0-9a-f]{64}$/),
).pipe(Schema.brand("ExtensionBuildAttemptId"));

export const ExtensionBuildFileEvidenceSchema = Schema.Struct({
  role: Schema.Literals([
    "minimal-instruction",
    "full-instruction",
    "command-manifest",
    "typescript-declaration",
    "runtime-module",
  ]),
  relativePath: Schema.String.check(Schema.isNonEmpty()),
  contentHash: Sha256FingerprintSchema,
  byteSize: NonNegativeSafeIntegerSchema,
});

export const ExtensionCurrentBuildManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  buildId: ExtensionBuildIdSchema,
  extensionId: ExtensionId,
  interfaceKind: ExtensionInterfaceKindSchema,
  sourceFingerprint: ExtensionSourceFingerprintSchema,
  contextFingerprint: ExtensionContextFingerprintSchema,
  outputFingerprint: ExtensionBuildOutputFingerprintSchema,
  contextReady: Schema.Literal(true),
  generatedFiles: Schema.Array(ExtensionBuildFileEvidenceSchema),
  builtAt: IsoDateTimeStringSchema,
});

export const ExtensionSourceBuildObservationSchema = Schema.Struct({
  extensionId: ExtensionId,
  category: Schema.Literals(["builtin", "user"]),
  buildRequirement: Schema.Literals(["required", "not-required"]),
  sourceStatus: Schema.Literals(["materialized", "unmaterialized", "invalid"]),
  sourceFingerprint: Schema.NullOr(ExtensionSourceFingerprintSchema),
  currentBuildStatus: Schema.Literals(["current", "missing", "stale", "invalid", "not-required"]),
  currentBuild: Schema.NullOr(ExtensionCurrentBuildManifestSchema),
  buildRequired: Schema.Boolean,
  diagnostics: Schema.Array(Schema.String),
});

export const ObserveExtensionSourceBuildsInputSchema = Schema.Struct({
  registryObservation: ExtensionRegistryObservationResultSchema,
});

export const ObserveExtensionSourceBuildsResultSchema = Schema.Struct({
  registryAggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  observations: Schema.Array(ExtensionSourceBuildObservationSchema),
});

export const ExtensionBuildExpectedOutputSchema = Schema.Struct({
  role: ExtensionBuildFileEvidenceSchema.fields.role,
  relativePath: Schema.String.check(Schema.isNonEmpty()),
});

const SvvyxJsonSchemaSchema = Schema.Record(Schema.String, Schema.Unknown);
export const SvvyxCommandManifestEntrySchema = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty()),
  aliases: Schema.optionalKey(Schema.Array(Schema.String)),
  description: Schema.optionalKey(Schema.String),
  examples: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        command: Schema.String,
        description: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  schema: Schema.optionalKey(
    Schema.Struct({
      args: Schema.optionalKey(SvvyxJsonSchemaSchema),
      env: Schema.optionalKey(SvvyxJsonSchemaSchema),
      options: Schema.optionalKey(SvvyxJsonSchemaSchema),
      output: Schema.optionalKey(SvvyxJsonSchemaSchema),
    }),
  ),
  streaming: Schema.optionalKey(Schema.Boolean),
});
export const SvvyxCommandManifestSchema = Schema.Struct({
  version: Schema.Literal("incur.v1"),
  commands: Schema.Array(SvvyxCommandManifestEntrySchema),
}).check(
  Schema.makeFilter(
    (manifest: { readonly commands: readonly { readonly name: string }[] }) =>
      new Set(manifest.commands.map(({ name }) => name)).size === manifest.commands.length || {
        path: ["commands"],
        issue: "svvyx command names must be unique",
      },
    { identifier: "SvvyxCommandManifestUniqueNames" },
  ),
);
export const decodeUnknownSvvyxCommandManifestExit = Schema.decodeUnknownExit(
  SvvyxCommandManifestSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSvvyxCommandManifestEffect = Schema.decodeUnknownEffect(
  SvvyxCommandManifestSchema,
  strictBoundaryParseOptions,
);
export const encodeSvvyxCommandManifestExit = Schema.encodeExit(
  SvvyxCommandManifestSchema,
  strictBoundaryParseOptions,
);
export const encodeSvvyxCommandManifestEffect = Schema.encodeEffect(
  SvvyxCommandManifestSchema,
  strictBoundaryParseOptions,
);

export const ExtensionBuildGeneratorInvocationSchema = Schema.Struct({
  scriptPath: AbsolutePath,
  outputPath: AbsolutePath,
  argv: Schema.Array(Schema.String),
});

export const ExtensionBuildProcessPlanSchema = Schema.Struct({
  extensionId: ExtensionId,
  sourceRoot: AbsolutePath,
  stagingRoot: AbsolutePath,
  generators: Schema.Array(ExtensionBuildGeneratorInvocationSchema),
  expectedProcessOutputs: Schema.Array(ExtensionBuildExpectedOutputSchema),
  svvyxRuntime: Schema.NullOr(
    Schema.Struct({
      sourcePath: AbsolutePath,
      runtimeOutputPath: AbsolutePath,
    }),
  ),
  timeoutMs: PositiveSafeIntegerSchema,
  maxStdoutBytes: PositiveSafeIntegerSchema,
  maxStderrBytes: PositiveSafeIntegerSchema,
});

export const ExtensionBuildProcessEvidenceSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("timed-out") }),
  Schema.Struct({ status: Schema.Literal("failed") }),
  Schema.Struct({
    status: Schema.Literal("completed"),
    exitCode: Schema.Int,
    stdout: Schema.String,
    stderr: Schema.String,
    stdoutTruncated: Schema.Boolean,
    stderrTruncated: Schema.Boolean,
    stagedFiles: Schema.Array(ExtensionBuildFileEvidenceSchema),
    commandManifest: Schema.NullOr(SvvyxCommandManifestSchema),
  }),
]);

export const BuildExtensionInputSchema = Schema.Struct({
  extensionId: ExtensionId,
  registryObservation: ExtensionRegistryObservationResultSchema,
  sourceObservation: ExtensionSourceBuildObservationSchema,
  builtAt: IsoDateTimeStringSchema,
});

export const BuildExtensionResultSchema = Schema.Struct({
  registryAggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  manifest: ExtensionCurrentBuildManifestSchema,
});

export const BuildRuntimeExtensionInputSchema = Schema.Struct({
  extensionId: ExtensionId,
  clientRequestId: RuntimeClientRequestId,
});

export const BuildRuntimeExtensionResultSchema = Schema.Struct({
  attemptId: ExtensionBuildAttemptIdSchema,
  registryAggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  manifest: ExtensionCurrentBuildManifestSchema,
});

export type ExtensionSourceFingerprint = typeof ExtensionSourceFingerprintSchema.Type;
export type ExtensionBuildOutputFingerprint = typeof ExtensionBuildOutputFingerprintSchema.Type;
export type ExtensionContextFingerprint = typeof ExtensionContextFingerprintSchema.Type;
export type ExtensionBuildId = typeof ExtensionBuildIdSchema.Type;
export type ExtensionBuildAttemptId = typeof ExtensionBuildAttemptIdSchema.Type;
export type ExtensionBuildFileEvidence = typeof ExtensionBuildFileEvidenceSchema.Type;
export type ExtensionCurrentBuildManifest = typeof ExtensionCurrentBuildManifestSchema.Type;
export type ExtensionSourceBuildObservation = typeof ExtensionSourceBuildObservationSchema.Type;
export type ObserveExtensionSourceBuildsInput = typeof ObserveExtensionSourceBuildsInputSchema.Type;
export type ObserveExtensionSourceBuildsResult =
  typeof ObserveExtensionSourceBuildsResultSchema.Type;
export type ExtensionBuildExpectedOutput = typeof ExtensionBuildExpectedOutputSchema.Type;
export type SvvyxCommandManifestEntry = typeof SvvyxCommandManifestEntrySchema.Type;
export type SvvyxCommandManifest = typeof SvvyxCommandManifestSchema.Type;
export type ExtensionBuildGeneratorInvocation = typeof ExtensionBuildGeneratorInvocationSchema.Type;
export type ExtensionBuildProcessPlan = typeof ExtensionBuildProcessPlanSchema.Type;
export type ExtensionBuildProcessEvidence = typeof ExtensionBuildProcessEvidenceSchema.Type;
export type BuildExtensionInput = typeof BuildExtensionInputSchema.Type;
export type BuildExtensionResult = typeof BuildExtensionResultSchema.Type;
export type BuildRuntimeExtensionInput = typeof BuildRuntimeExtensionInputSchema.Type;
export type BuildRuntimeExtensionResult = typeof BuildRuntimeExtensionResultSchema.Type;

export const decodeUnknownExtensionCurrentBuildManifestEffect = Schema.decodeUnknownEffect(
  ExtensionCurrentBuildManifestSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionCurrentBuildManifestExit = Schema.decodeUnknownExit(
  ExtensionCurrentBuildManifestSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionCurrentBuildManifestEffect = Schema.encodeEffect(
  ExtensionCurrentBuildManifestSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionCurrentBuildManifestExit = Schema.encodeExit(
  ExtensionCurrentBuildManifestSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionSourceBuildObservationEffect = Schema.decodeUnknownEffect(
  ExtensionSourceBuildObservationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionSourceBuildObservationExit = Schema.decodeUnknownExit(
  ExtensionSourceBuildObservationSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionSourceBuildObservationEffect = Schema.encodeEffect(
  ExtensionSourceBuildObservationSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionSourceBuildObservationExit = Schema.encodeExit(
  ExtensionSourceBuildObservationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownObserveExtensionSourceBuildsInputEffect = Schema.decodeUnknownEffect(
  ObserveExtensionSourceBuildsInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownObserveExtensionSourceBuildsInputExit = Schema.decodeUnknownExit(
  ObserveExtensionSourceBuildsInputSchema,
  strictBoundaryParseOptions,
);
export const encodeObserveExtensionSourceBuildsInputEffect = Schema.encodeEffect(
  ObserveExtensionSourceBuildsInputSchema,
  strictBoundaryParseOptions,
);
export const encodeObserveExtensionSourceBuildsInputExit = Schema.encodeExit(
  ObserveExtensionSourceBuildsInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownObserveExtensionSourceBuildsResultEffect = Schema.decodeUnknownEffect(
  ObserveExtensionSourceBuildsResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownObserveExtensionSourceBuildsResultExit = Schema.decodeUnknownExit(
  ObserveExtensionSourceBuildsResultSchema,
  strictBoundaryParseOptions,
);
export const encodeObserveExtensionSourceBuildsResultEffect = Schema.encodeEffect(
  ObserveExtensionSourceBuildsResultSchema,
  strictBoundaryParseOptions,
);
export const encodeObserveExtensionSourceBuildsResultExit = Schema.encodeExit(
  ObserveExtensionSourceBuildsResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionBuildProcessPlanExit = Schema.decodeUnknownExit(
  ExtensionBuildProcessPlanSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionBuildProcessPlanEffect = Schema.decodeUnknownEffect(
  ExtensionBuildProcessPlanSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionBuildProcessPlanExit = Schema.encodeExit(
  ExtensionBuildProcessPlanSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionBuildProcessPlanEffect = Schema.encodeEffect(
  ExtensionBuildProcessPlanSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionBuildProcessEvidenceExit = Schema.decodeUnknownExit(
  ExtensionBuildProcessEvidenceSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionBuildProcessEvidenceEffect = Schema.decodeUnknownEffect(
  ExtensionBuildProcessEvidenceSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionBuildProcessEvidenceExit = Schema.encodeExit(
  ExtensionBuildProcessEvidenceSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionBuildProcessEvidenceEffect = Schema.encodeEffect(
  ExtensionBuildProcessEvidenceSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildExtensionInputExit = Schema.decodeUnknownExit(
  BuildExtensionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildExtensionInputEffect = Schema.decodeUnknownEffect(
  BuildExtensionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildExtensionResultExit = Schema.decodeUnknownExit(
  BuildExtensionResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildExtensionResultEffect = Schema.decodeUnknownEffect(
  BuildExtensionResultSchema,
  strictBoundaryParseOptions,
);
export const encodeBuildExtensionInputExit = Schema.encodeExit(
  BuildExtensionInputSchema,
  strictBoundaryParseOptions,
);
export const encodeBuildExtensionInputEffect = Schema.encodeEffect(
  BuildExtensionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildRuntimeExtensionInputEffect = Schema.decodeUnknownEffect(
  BuildRuntimeExtensionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildRuntimeExtensionInputExit = Schema.decodeUnknownExit(
  BuildRuntimeExtensionInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildRuntimeExtensionResultEffect = Schema.decodeUnknownEffect(
  BuildRuntimeExtensionResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownBuildRuntimeExtensionResultExit = Schema.decodeUnknownExit(
  BuildRuntimeExtensionResultSchema,
  strictBoundaryParseOptions,
);
export const encodeBuildRuntimeExtensionResultEffect = Schema.encodeEffect(
  BuildRuntimeExtensionResultSchema,
  strictBoundaryParseOptions,
);
export const encodeBuildRuntimeExtensionResultExit = Schema.encodeExit(
  BuildRuntimeExtensionResultSchema,
  strictBoundaryParseOptions,
);
export const encodeBuildExtensionResultExit = Schema.encodeExit(
  BuildExtensionResultSchema,
  strictBoundaryParseOptions,
);
export const encodeBuildExtensionResultEffect = Schema.encodeEffect(
  BuildExtensionResultSchema,
  strictBoundaryParseOptions,
);
