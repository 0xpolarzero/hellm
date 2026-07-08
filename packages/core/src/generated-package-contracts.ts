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

export const AppGlobalRefreshGeneratedPackagesRequestSchema = Schema.Struct({
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
});
export type AppGlobalRefreshGeneratedPackagesRequest =
  typeof AppGlobalRefreshGeneratedPackagesRequestSchema.Type;

export const RefreshGeneratedPackagesRequestSchema = AppGlobalRefreshGeneratedPackagesRequestSchema;
export type RefreshGeneratedPackagesRequest = typeof RefreshGeneratedPackagesRequestSchema.Type;

export const InternalRefreshGeneratedPackagesRequestSchema = Schema.Union([
  AppGlobalRefreshGeneratedPackagesRequestSchema,
  Schema.Struct({
    scope: Schema.Literal("workspace-link-repair"),
    workspaceId: WorkspaceId,
    packages: Schema.Array(GeneratedPackageNameSchema),
    reason: Schema.Literals(["link-repair", "explicit-build", "startup-recovery"]),
    sourceCommandId: Schema.optionalKey(CommandId),
    recoveryWorkId: Schema.optionalKey(RecoveryWorkId),
  }),
]);
export type InternalRefreshGeneratedPackagesRequest =
  typeof InternalRefreshGeneratedPackagesRequestSchema.Type;

export const GeneratedPackageFileEvidenceSchema = Schema.Struct({
  relativePath: Schema.String,
  path: AbsolutePath,
});
export type GeneratedPackageFileEvidence = typeof GeneratedPackageFileEvidenceSchema.Type;

export const GeneratedPackageDependencyEvidenceSchema = Schema.Union([
  Schema.Struct({
    specifier: GeneratedPackageNameSchema,
    importKind: Schema.Literals(["type-only", "runtime"]),
    dependencyClass: Schema.Literal("generated-package"),
    resolutionAuthority: Schema.Literal("generated-package-link"),
    manifestDependency: Schema.Literal("none-generated-package-link"),
    buildId: GeneratedPackageBuildId,
  }),
  Schema.Struct({
    specifier: Schema.String,
    importKind: Schema.Literals(["type-only", "runtime"]),
    dependencyClass: Schema.Literal("workspace-authoring-external"),
    resolutionAuthority: Schema.Literals([
      "workspace-smithers-package",
      "external-ambient-declaration",
    ]),
    manifestDependency: Schema.Literals([
      "dependency",
      "dev-type-dependency",
      "peer-workspace-expectation",
      "ambient-declaration",
    ]),
    version: Schema.String,
  }),
  Schema.Struct({
    specifier: Schema.Literal("@svvy/core"),
    importKind: Schema.Literal("type-only"),
    dependencyClass: Schema.Literal("app-owned-type-contract"),
    resolutionAuthority: Schema.Literal("app-owned-type-contract"),
    manifestDependency: Schema.Literal("dev-type-dependency"),
  }),
  Schema.Struct({
    specifier: Schema.String,
    importKind: Schema.Literals(["type-only", "runtime"]),
    dependencyClass: Schema.Literal("forbidden"),
    resolutionAuthority: Schema.Literal("forbidden"),
    manifestDependency: Schema.Literal("none-forbidden"),
  }),
]);
export type GeneratedPackageDependencyEvidence =
  typeof GeneratedPackageDependencyEvidenceSchema.Type;

export const GeneratedPackageBuildStatusSchema = Schema.Struct({
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
export type GeneratedPackageBuildStatus = typeof GeneratedPackageBuildStatusSchema.Type;

export const GeneratedPackageRefreshStatusSchema = Schema.Struct({
  ...GeneratedPackageBuildStatusSchema.fields,
  refreshScope: Schema.Literal("app-global-build"),
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
    "repair-needed",
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
  packages: Schema.Array(GeneratedPackageBuildStatusSchema),
});
export type GeneratedPackageBuildPlanResult = typeof GeneratedPackageBuildPlanResultSchema.Type;

export const unsafeDecodeRefreshGeneratedPackagesRequestSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(RefreshGeneratedPackagesRequestSchema, strictBoundaryParseOptions);
export const decodeUnknownRefreshGeneratedPackagesRequestExit = Schema.decodeUnknownExit(
  RefreshGeneratedPackagesRequestSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRefreshGeneratedPackagesRequestEffect = Schema.decodeUnknownEffect(
  RefreshGeneratedPackagesRequestSchema,
  strictBoundaryParseOptions,
);

export const unsafeDecodeInternalRefreshGeneratedPackagesRequestSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(
    InternalRefreshGeneratedPackagesRequestSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownInternalRefreshGeneratedPackagesRequestExit = Schema.decodeUnknownExit(
  InternalRefreshGeneratedPackagesRequestSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownInternalRefreshGeneratedPackagesRequestEffect =
  Schema.decodeUnknownEffect(
    InternalRefreshGeneratedPackagesRequestSchema,
    strictBoundaryParseOptions,
  );

export const unsafeDecodeAppGlobalRefreshGeneratedPackagesRequestSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(
    AppGlobalRefreshGeneratedPackagesRequestSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownAppGlobalRefreshGeneratedPackagesRequestExit = Schema.decodeUnknownExit(
  AppGlobalRefreshGeneratedPackagesRequestSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownAppGlobalRefreshGeneratedPackagesRequestEffect =
  Schema.decodeUnknownEffect(
    AppGlobalRefreshGeneratedPackagesRequestSchema,
    strictBoundaryParseOptions,
  );

export const unsafeDecodeGeneratedPackageBuildInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(GeneratedPackageBuildInputSchema, strictBoundaryParseOptions);
export const decodeUnknownGeneratedPackageBuildInputExit = Schema.decodeUnknownExit(
  GeneratedPackageBuildInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGeneratedPackageBuildInputEffect = Schema.decodeUnknownEffect(
  GeneratedPackageBuildInputSchema,
  strictBoundaryParseOptions,
);

export const unsafeDecodeGeneratedPackageWorkspaceLinkRepairInputSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(
    GeneratedPackageWorkspaceLinkRepairInputSchema,
    strictBoundaryParseOptions,
  );
export const decodeUnknownGeneratedPackageWorkspaceLinkRepairInputExit = Schema.decodeUnknownExit(
  GeneratedPackageWorkspaceLinkRepairInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGeneratedPackageWorkspaceLinkRepairInputEffect =
  Schema.decodeUnknownEffect(
    GeneratedPackageWorkspaceLinkRepairInputSchema,
    strictBoundaryParseOptions,
  );

export const unsafeDecodeGeneratedPackageBuildPlanResultSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(GeneratedPackageBuildPlanResultSchema, strictBoundaryParseOptions);
export const decodeUnknownGeneratedPackageBuildPlanResultExit = Schema.decodeUnknownExit(
  GeneratedPackageBuildPlanResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownGeneratedPackageBuildPlanResultEffect = Schema.decodeUnknownEffect(
  GeneratedPackageBuildPlanResultSchema,
  strictBoundaryParseOptions,
);
