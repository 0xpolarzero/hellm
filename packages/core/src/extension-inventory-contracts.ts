import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  ExtensionId,
  IsoDateTimeStringSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  type IsoDateTimeString,
} from "./ids";
import { ExtensionInterfaceKindSchema, ExtensionUsageStateSchema } from "./runtime-contracts";
import {
  OpenExtensionSourceEditInputSchema,
  SourceDiagnosticSchema,
} from "./runtime-source-edit-contracts";

export const ExtensionRegistryCapabilitySchema = Schema.Struct({
  resettable: Schema.Boolean,
  deletable: Schema.Boolean,
  typescriptApiEnabled: Schema.Boolean,
  materializationRequired: Schema.Boolean,
});

type ExtensionRegistryUsagePolicyShape = {
  readonly configurable: boolean;
  readonly fixedReason: string | null;
};

const ExtensionRegistryUsagePolicyInvariant = Schema.makeFilter(
  (policy: ExtensionRegistryUsagePolicyShape) => {
    if (policy.configurable === (policy.fixedReason !== null)) {
      return {
        path: ["fixedReason"],
        issue: "fixedReason must be non-null exactly when extension usage is not configurable",
      };
    }
    return true;
  },
  { identifier: "ExtensionRegistryUsagePolicyInvariant" },
);

export const ExtensionRegistryUsagePolicySchema = Schema.Struct({
  canonicalOrder: NonNegativeSafeIntegerSchema,
  baselineUsage: Schema.Struct({
    orchestrator: ExtensionUsageStateSchema,
    handler: ExtensionUsageStateSchema,
    "workflow-task": ExtensionUsageStateSchema,
  }),
  networkAccess: Schema.Literals(["required", "not-required"]),
  configurable: Schema.Boolean,
  fixedReason: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
}).check(ExtensionRegistryUsagePolicyInvariant);

export const ExtensionRegistryContributorObservationSchema = Schema.Struct({
  kind: Schema.Literals(["minimal", "instruction", "script", "generated-instruction"]),
  name: Schema.String.check(Schema.isNonEmpty()),
  bypassed: Schema.Boolean,
  editable: Schema.Boolean,
  openable: Schema.Boolean,
  requiresMaterialization: Schema.Boolean,
  versionCliRequirementId: Schema.optionalKey(
    Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
  ),
  source: Schema.optionalKey(OpenExtensionSourceEditInputSchema),
});

export const ExtensionRegistryToolingObservationSchema = Schema.Struct({
  kind: Schema.Literals([
    "svvyx-source",
    "command-schema",
    "typescript-api-declaration",
    "native-tool-schema",
  ]),
  name: Schema.String.check(Schema.isNonEmpty()),
  openable: Schema.Boolean,
  requiresMaterialization: Schema.Boolean,
  source: Schema.optionalKey(OpenExtensionSourceEditInputSchema),
});

export const ExtensionSvvyxImplementationSchema = Schema.NullOr(
  Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("source-runtime"),
      sourceRelativePath: Schema.Literal("source/index.ts"),
    }),
    Schema.Struct({
      kind: Schema.Literal("app-native"),
      namespace: Schema.String.check(Schema.isNonEmpty()),
      metadataFingerprint: Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/)),
    }),
  ]),
);

export const ExtensionCliRequirementFingerprintSchema = Schema.String.check(Schema.isNonEmpty());

export const ExtensionCliDeclarationSchema = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  requirementFingerprint: ExtensionCliRequirementFingerprintSchema,
  binary: Schema.String.check(Schema.isNonEmpty()),
  package: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
  required: Schema.Boolean,
  defaultVersion: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
  versionCommand: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
  installCommand: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
  nodeRequirement: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
});

export const ExtensionCliRequirementProbePlanSchema = Schema.Struct({
  extensionId: ExtensionId,
  requirementId: Schema.String.check(Schema.isNonEmpty()),
  requirementFingerprint: ExtensionCliRequirementFingerprintSchema,
  probeKind: Schema.Literals(["resolve-executable", "execute-version"]),
  executable: Schema.String.check(Schema.isNonEmpty()),
  argv: Schema.Array(Schema.String),
  env: Schema.Record(Schema.String, Schema.String),
  extendEnv: Schema.Literal(false),
  timeoutMs: PositiveSafeIntegerSchema,
  maxStdoutBytes: PositiveSafeIntegerSchema,
  maxStderrBytes: PositiveSafeIntegerSchema,
});

export const ExtensionCliRequirementProbeEvidenceSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("missing") }),
  Schema.Struct({ status: Schema.Literal("resolved") }),
  Schema.Struct({
    status: Schema.Literal("completed"),
    exitCode: Schema.Int,
    stdout: Schema.String,
    stderr: Schema.String,
    stdoutTruncated: Schema.Boolean,
    stderrTruncated: Schema.Boolean,
  }),
  Schema.Struct({ status: Schema.Literal("timed-out") }),
  Schema.Struct({ status: Schema.Literal("failed") }),
]);

export const ExtensionCliRequirementReadinessEvidenceSchema = Schema.Struct({
  extensionId: ExtensionId,
  requirementId: Schema.String.check(Schema.isNonEmpty()),
  requirementFingerprint: ExtensionCliRequirementFingerprintSchema,
  status: Schema.Literals([
    "missing",
    "unknown",
    "available",
    "ready",
    "update-available",
    "version-mismatch",
  ]),
  detectedVersion: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
  expectedVersion: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
  diagnostics: Schema.Array(Schema.String),
});

export const ExtensionEnvDeclarationObservationSchema = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[A-Z_][A-Z0-9_]*$/)),
  required: Schema.Boolean,
  secret: Schema.Boolean,
  description: Schema.String.check(Schema.isNonEmpty()),
  hasDefault: Schema.Boolean,
});

export const ExtensionDependencyDeclarationObservationSchema = Schema.Struct({
  kind: Schema.Literals(["dependency", "trusted_dependency"]),
  packageManager: Schema.Literal("bun"),
  source: Schema.Literal("npm"),
  name: Schema.String.check(Schema.isNonEmpty()),
  version: Schema.String.check(Schema.isNonEmpty()),
  integrity: Schema.Null,
  resolution: Schema.Null,
});

const ExtensionRegistrySvvyxImplementationInvariant = Schema.makeFilter(
  (observation: {
    readonly category: "builtin" | "user";
    readonly interfaceKind: "instructions" | "native_tool" | "svvyx";
    readonly svvyxImplementation: ExtensionSvvyxImplementation;
  }) => {
    if ((observation.interfaceKind === "svvyx") !== (observation.svvyxImplementation !== null))
      return {
        path: ["svvyxImplementation"],
        issue: "svvyxImplementation must be present exactly for svvyx records",
      };
    if (
      observation.svvyxImplementation?.kind === "app-native" &&
      observation.category !== "builtin"
    )
      return {
        path: ["svvyxImplementation"],
        issue: "app-native svvyx implementations must be builtin records",
      };
    return true;
  },
  { identifier: "ExtensionRegistrySvvyxImplementationInvariant" },
);

export const ExtensionRegistryObservationSchema = Schema.Struct({
  extensionId: ExtensionId,
  category: Schema.Literals(["builtin", "user"]),
  interfaceKind: ExtensionInterfaceKindSchema,
  svvyxImplementation: ExtensionSvvyxImplementationSchema,
  usagePolicy: ExtensionRegistryUsagePolicySchema,
  buildRequirement: Schema.Literals(["required", "not-required"]),
  title: Schema.String.check(Schema.isNonEmpty()),
  description: Schema.String.check(Schema.isNonEmpty()),
  customized: Schema.Boolean,
  materializationPlan: Schema.NullOr(
    Schema.Struct({
      kind: Schema.Literal("scaffold-builtin"),
      extensionId: ExtensionId,
    }),
  ),
  capabilities: ExtensionRegistryCapabilitySchema,
  contributors: Schema.Array(ExtensionRegistryContributorObservationSchema),
  tooling: Schema.Array(ExtensionRegistryToolingObservationSchema),
  cliDeclarations: Schema.Array(ExtensionCliDeclarationSchema),
  envDeclarations: Schema.Array(ExtensionEnvDeclarationObservationSchema),
  dependencyDeclarations: Schema.Array(ExtensionDependencyDeclarationObservationSchema),
  sourceFingerprint: Schema.String.check(Schema.isNonEmpty()),
  diagnostics: Schema.Array(SourceDiagnosticSchema),
}).check(ExtensionRegistrySvvyxImplementationInvariant);

export const ExtensionRegistryObservationResultSchema = Schema.Struct({
  aggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  observations: Schema.Array(ExtensionRegistryObservationSchema),
  diagnostics: Schema.Array(SourceDiagnosticSchema),
});

export const RefreshExtensionCliRequirementReadinessInputSchema = Schema.Struct({
  registryObservation: ExtensionRegistryObservationResultSchema,
});

export const RefreshExtensionCliRequirementReadinessResultSchema = Schema.Struct({
  registryAggregateFingerprint: Schema.String.check(Schema.isNonEmpty()),
  readiness: Schema.Array(ExtensionCliRequirementReadinessEvidenceSchema),
});

export const ExtensionRegistryStateRecordSchema = Schema.Struct({
  observation: ExtensionRegistryObservationResultSchema,
  observedAt: IsoDateTimeStringSchema,
});

export const ReconcileExtensionRegistryObservationInputSchema = ExtensionRegistryStateRecordSchema;

export type ExtensionRegistryCapability = typeof ExtensionRegistryCapabilitySchema.Type;
export type ExtensionRegistryUsagePolicy = typeof ExtensionRegistryUsagePolicySchema.Type;
export type ExtensionRegistryContributorObservation =
  typeof ExtensionRegistryContributorObservationSchema.Type;
export type ExtensionRegistryToolingObservation =
  typeof ExtensionRegistryToolingObservationSchema.Type;
export type ExtensionSvvyxImplementation = typeof ExtensionSvvyxImplementationSchema.Type;
export type ExtensionCliDeclaration = typeof ExtensionCliDeclarationSchema.Type;
export type ExtensionCliRequirementFingerprint =
  typeof ExtensionCliRequirementFingerprintSchema.Type;
export type ExtensionCliRequirementProbePlan = typeof ExtensionCliRequirementProbePlanSchema.Type;
export type ExtensionCliRequirementProbeEvidence =
  typeof ExtensionCliRequirementProbeEvidenceSchema.Type;
export type ExtensionCliRequirementReadinessEvidence =
  typeof ExtensionCliRequirementReadinessEvidenceSchema.Type;
export type RefreshExtensionCliRequirementReadinessInput =
  typeof RefreshExtensionCliRequirementReadinessInputSchema.Type;
export type RefreshExtensionCliRequirementReadinessResult =
  typeof RefreshExtensionCliRequirementReadinessResultSchema.Type;
export type ExtensionEnvDeclarationObservation =
  typeof ExtensionEnvDeclarationObservationSchema.Type;
export type ExtensionDependencyDeclarationObservation =
  typeof ExtensionDependencyDeclarationObservationSchema.Type;
export type ExtensionRegistryObservation = typeof ExtensionRegistryObservationSchema.Type;
export type ExtensionRegistryObservationResult =
  typeof ExtensionRegistryObservationResultSchema.Type;
export interface ExtensionRegistryStateRecord {
  observation: ExtensionRegistryObservationResult;
  observedAt: IsoDateTimeString;
}
export interface ReconcileExtensionRegistryObservationInput extends ExtensionRegistryStateRecord {}

export const decodeUnknownExtensionRegistryObservationExit = Schema.decodeUnknownExit(
  ExtensionRegistryObservationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionRegistryUsagePolicyExit = Schema.decodeUnknownExit(
  ExtensionRegistryUsagePolicySchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionRegistryUsagePolicyEffect = Schema.decodeUnknownEffect(
  ExtensionRegistryUsagePolicySchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionRegistryUsagePolicyExit = Schema.encodeExit(
  ExtensionRegistryUsagePolicySchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionRegistryUsagePolicyEffect = Schema.encodeEffect(
  ExtensionRegistryUsagePolicySchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionRegistryObservationEffect = Schema.decodeUnknownEffect(
  ExtensionRegistryObservationSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionRegistryObservationExit = Schema.encodeExit(
  ExtensionRegistryObservationSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionRegistryObservationEffect = Schema.encodeEffect(
  ExtensionRegistryObservationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionRegistryObservationResultExit = Schema.decodeUnknownExit(
  ExtensionRegistryObservationResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionRegistryObservationResultEffect = Schema.decodeUnknownEffect(
  ExtensionRegistryObservationResultSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionRegistryObservationResultExit = Schema.encodeExit(
  ExtensionRegistryObservationResultSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionRegistryObservationResultEffect = Schema.encodeEffect(
  ExtensionRegistryObservationResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionRegistryStateRecordExit = Schema.decodeUnknownExit(
  ExtensionRegistryStateRecordSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionRegistryStateRecordEffect = Schema.decodeUnknownEffect(
  ExtensionRegistryStateRecordSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionRegistryStateRecordExit = Schema.encodeExit(
  ExtensionRegistryStateRecordSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionRegistryStateRecordEffect = Schema.encodeEffect(
  ExtensionRegistryStateRecordSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownExtensionCliRequirementProbePlanExit = Schema.decodeUnknownExit(
  ExtensionCliRequirementProbePlanSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionCliRequirementProbePlanEffect = Schema.decodeUnknownEffect(
  ExtensionCliRequirementProbePlanSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionCliRequirementProbePlanExit = Schema.encodeExit(
  ExtensionCliRequirementProbePlanSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionCliRequirementProbePlanEffect = Schema.encodeEffect(
  ExtensionCliRequirementProbePlanSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionCliRequirementProbeEvidenceExit = Schema.decodeUnknownExit(
  ExtensionCliRequirementProbeEvidenceSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionCliRequirementProbeEvidenceEffect = Schema.decodeUnknownEffect(
  ExtensionCliRequirementProbeEvidenceSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionCliRequirementProbeEvidenceExit = Schema.encodeExit(
  ExtensionCliRequirementProbeEvidenceSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionCliRequirementProbeEvidenceEffect = Schema.encodeEffect(
  ExtensionCliRequirementProbeEvidenceSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionCliRequirementReadinessEvidenceExit = Schema.decodeUnknownExit(
  ExtensionCliRequirementReadinessEvidenceSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExtensionCliRequirementReadinessEvidenceEffect =
  Schema.decodeUnknownEffect(
    ExtensionCliRequirementReadinessEvidenceSchema,
    strictBoundaryParseOptions,
  );
export const encodeExtensionCliRequirementReadinessEvidenceExit = Schema.encodeExit(
  ExtensionCliRequirementReadinessEvidenceSchema,
  strictBoundaryParseOptions,
);
export const encodeExtensionCliRequirementReadinessEvidenceEffect = Schema.encodeEffect(
  ExtensionCliRequirementReadinessEvidenceSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRefreshExtensionCliRequirementReadinessInputExit =
  Schema.decodeUnknownExit(
    RefreshExtensionCliRequirementReadinessInputSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownRefreshExtensionCliRequirementReadinessInputEffect =
  Schema.decodeUnknownEffect(
    RefreshExtensionCliRequirementReadinessInputSchema,
    strictBoundaryParseOptions,
  );
export const encodeRefreshExtensionCliRequirementReadinessInputExit = Schema.encodeExit(
  RefreshExtensionCliRequirementReadinessInputSchema,
  strictBoundaryParseOptions,
);
export const encodeRefreshExtensionCliRequirementReadinessInputEffect = Schema.encodeEffect(
  RefreshExtensionCliRequirementReadinessInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRefreshExtensionCliRequirementReadinessResultExit =
  Schema.decodeUnknownExit(
    RefreshExtensionCliRequirementReadinessResultSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownRefreshExtensionCliRequirementReadinessResultEffect =
  Schema.decodeUnknownEffect(
    RefreshExtensionCliRequirementReadinessResultSchema,
    strictBoundaryParseOptions,
  );
export const encodeRefreshExtensionCliRequirementReadinessResultExit = Schema.encodeExit(
  RefreshExtensionCliRequirementReadinessResultSchema,
  strictBoundaryParseOptions,
);
export const encodeRefreshExtensionCliRequirementReadinessResultEffect = Schema.encodeEffect(
  RefreshExtensionCliRequirementReadinessResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownReconcileExtensionRegistryObservationInputExit = Schema.decodeUnknownExit(
  ReconcileExtensionRegistryObservationInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownReconcileExtensionRegistryObservationInputEffect =
  Schema.decodeUnknownEffect(
    ReconcileExtensionRegistryObservationInputSchema,
    strictBoundaryParseOptions,
  );
