import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  AbsolutePath,
  CommandId,
  GeneratedPackageBuildId,
  RecoveryWorkId,
  WorkspaceId,
} from "./ids";

export const GeneratedPackageNameSchema = Schema.Literals([
  "@svvyx/workflows",
  "@svvyx/extensions",
]);
export type GeneratedPackageName = typeof GeneratedPackageNameSchema.Type;

export const GeneratedPackageBuildInputSchema = Schema.Struct({
  packages: Schema.Array(GeneratedPackageNameSchema),
});
export type GeneratedPackageBuildInput = typeof GeneratedPackageBuildInputSchema.Type;

export const RefreshGeneratedPackagesRequestSchema = Schema.Union([
  Schema.Struct({
    scope: Schema.Literal("app-global"),
    packages: Schema.Array(GeneratedPackageNameSchema),
    reason: Schema.Literals([
      "source-changed",
      "explicit-build",
      "snapshot-restore",
      "startup-recovery",
    ]),
    sourceCommandId: Schema.optionalKey(CommandId),
    recoveryWorkId: Schema.optionalKey(RecoveryWorkId),
  }),
  Schema.Struct({
    scope: Schema.Literal("workspace-link-repair"),
    workspaceId: WorkspaceId,
    packages: Schema.Array(GeneratedPackageNameSchema),
    reason: Schema.Literals(["link-repair", "explicit-build", "startup-recovery"]),
    sourceCommandId: Schema.optionalKey(CommandId),
    recoveryWorkId: Schema.optionalKey(RecoveryWorkId),
  }),
]);
export type RefreshGeneratedPackagesRequest = typeof RefreshGeneratedPackagesRequestSchema.Type;

export const GeneratedPackageFileEvidenceSchema = Schema.Struct({
  relativePath: Schema.String,
  path: AbsolutePath,
});
export type GeneratedPackageFileEvidence = typeof GeneratedPackageFileEvidenceSchema.Type;

export const GeneratedPackageDependencyEvidenceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("package"),
    name: Schema.String,
    version: Schema.String,
    resolution: Schema.Literals(["app-owned-package", "package-manager"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("generated-package"),
    name: GeneratedPackageNameSchema,
    buildId: GeneratedPackageBuildId,
    resolution: Schema.Literal("generated-package-link"),
  }),
]);
export type GeneratedPackageDependencyEvidence =
  typeof GeneratedPackageDependencyEvidenceSchema.Type;

export const GeneratedPackageRefreshStatusSchema = Schema.Struct({
  packageName: GeneratedPackageNameSchema,
  action: Schema.Literals(["written", "unchanged", "failed"]),
  buildId: Schema.optionalKey(GeneratedPackageBuildId),
  manifestPath: Schema.optionalKey(AbsolutePath),
  sourceFingerprint: Schema.optionalKey(Schema.String),
  outputFingerprint: Schema.optionalKey(Schema.String),
  generatedFiles: Schema.optionalKey(Schema.Array(GeneratedPackageFileEvidenceSchema)),
  dependencies: Schema.optionalKey(Schema.Array(GeneratedPackageDependencyEvidenceSchema)),
  diagnostics: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type GeneratedPackageRefreshStatus = typeof GeneratedPackageRefreshStatusSchema.Type;

export const GeneratedPackageWorkspaceLinkStatusSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  packageName: GeneratedPackageNameSchema,
  status: Schema.Literals([
    "linked",
    "unchanged",
    "blocked-non-symlink",
    "missing-smithers-root",
    "failed",
  ]),
  linkPath: Schema.optionalKey(AbsolutePath),
  targetPath: Schema.optionalKey(AbsolutePath),
  diagnostics: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type GeneratedPackageWorkspaceLinkStatus =
  typeof GeneratedPackageWorkspaceLinkStatusSchema.Type;

export const GeneratedPackageWorkspaceLinkRepairInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  packageName: GeneratedPackageNameSchema,
});
export type GeneratedPackageWorkspaceLinkRepairInput =
  typeof GeneratedPackageWorkspaceLinkRepairInputSchema.Type;

export const GeneratedPackageWorkspaceLinkRepairPlanSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  packageName: GeneratedPackageNameSchema,
  linkPath: AbsolutePath,
  targetPath: AbsolutePath,
  requiredParentPath: AbsolutePath,
  overwritePolicy: Schema.Literal("symlink-only"),
});
export type GeneratedPackageWorkspaceLinkRepairPlan =
  typeof GeneratedPackageWorkspaceLinkRepairPlanSchema.Type;

export const GeneratedPackageBuildPlanResultSchema = Schema.Struct({
  packages: Schema.Array(GeneratedPackageRefreshStatusSchema),
});
export type GeneratedPackageBuildPlanResult = typeof GeneratedPackageBuildPlanResultSchema.Type;

export const decodeRefreshGeneratedPackagesRequest = Schema.decodeUnknownSync(
  RefreshGeneratedPackagesRequestSchema,
  strictBoundaryParseOptions,
);
export const decodeRefreshGeneratedPackagesRequestExit = Schema.decodeUnknownExit(
  RefreshGeneratedPackagesRequestSchema,
  strictBoundaryParseOptions,
);
export const decodeRefreshGeneratedPackagesRequestEffect = Schema.decodeUnknownEffect(
  RefreshGeneratedPackagesRequestSchema,
  strictBoundaryParseOptions,
);

export const decodeGeneratedPackageBuildInput = Schema.decodeUnknownSync(
  GeneratedPackageBuildInputSchema,
  strictBoundaryParseOptions,
);
export const decodeGeneratedPackageBuildInputExit = Schema.decodeUnknownExit(
  GeneratedPackageBuildInputSchema,
  strictBoundaryParseOptions,
);
export const decodeGeneratedPackageBuildInputEffect = Schema.decodeUnknownEffect(
  GeneratedPackageBuildInputSchema,
  strictBoundaryParseOptions,
);

export const decodeGeneratedPackageWorkspaceLinkRepairInput = Schema.decodeUnknownSync(
  GeneratedPackageWorkspaceLinkRepairInputSchema,
  strictBoundaryParseOptions,
);
export const decodeGeneratedPackageWorkspaceLinkRepairInputExit = Schema.decodeUnknownExit(
  GeneratedPackageWorkspaceLinkRepairInputSchema,
  strictBoundaryParseOptions,
);
export const decodeGeneratedPackageWorkspaceLinkRepairInputEffect = Schema.decodeUnknownEffect(
  GeneratedPackageWorkspaceLinkRepairInputSchema,
  strictBoundaryParseOptions,
);

export const decodeGeneratedPackageBuildPlanResult = Schema.decodeUnknownSync(
  GeneratedPackageBuildPlanResultSchema,
  strictBoundaryParseOptions,
);
export const decodeGeneratedPackageBuildPlanResultExit = Schema.decodeUnknownExit(
  GeneratedPackageBuildPlanResultSchema,
  strictBoundaryParseOptions,
);
export const decodeGeneratedPackageBuildPlanResultEffect = Schema.decodeUnknownEffect(
  GeneratedPackageBuildPlanResultSchema,
  strictBoundaryParseOptions,
);
