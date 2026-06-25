import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { SandboxPolicyError } from "./errors";
import {
  AbsolutePath,
  CommandId,
  IsoDateTimeStringSchema,
  SurfacePiSessionId,
  WorkspaceId,
} from "./ids";
import { GeneratedPackageNameSchema } from "./generated-package-contracts";

export const SandboxLaunchKindSchema = Schema.Literals([
  "direct_shell",
  "direct_apply_patch",
  "execute_typescript_runtime",
  "extension_facade_child",
  "app_owned_generated_package_build",
  "workspace_generated_package_link_repair",
  "extension_dependency_action",
]);
export type SandboxLaunchKind = typeof SandboxLaunchKindSchema.Type;

export const SandboxLaunchScopeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("workspace"),
    workspaceId: WorkspaceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("app-global-extension-dependency"),
    originWorkspaceId: Schema.optionalKey(WorkspaceId),
  }),
  Schema.Struct({
    kind: Schema.Literal("app-global-generated-package"),
    packageName: GeneratedPackageNameSchema,
    originWorkspaceId: Schema.optionalKey(WorkspaceId),
  }),
  Schema.Struct({
    kind: Schema.Literal("workspace-generated-package-link"),
    workspaceId: WorkspaceId,
    packageName: GeneratedPackageNameSchema,
  }),
]);
export type SandboxLaunchScope = typeof SandboxLaunchScopeSchema.Type;

export const SandboxPolicySnapshotInputSchema = Schema.Struct({
  scope: SandboxLaunchScopeSchema,
  surfacePiSessionId: Schema.optionalKey(SurfacePiSessionId),
  commandId: CommandId,
  launchKind: SandboxLaunchKindSchema,
  cwd: Schema.optionalKey(AbsolutePath),
});
export type SandboxPolicySnapshotInput = typeof SandboxPolicySnapshotInputSchema.Type;

export const FileSystemSandboxPolicyEntrySchema = Schema.Struct({
  path: AbsolutePath,
  access: Schema.Literals(["read", "write", "none"]),
  recursive: Schema.Boolean,
  source: Schema.Literals([
    "workspace",
    "worktree",
    "artifact",
    "generated-output",
    "protected-metadata",
    "extension-source",
    "temporary",
    "app-runtime",
  ]),
});
export type FileSystemSandboxPolicyEntry = typeof FileSystemSandboxPolicyEntrySchema.Type;

export const FileSystemSandboxPolicySchema = Schema.Struct({
  defaultAccess: Schema.Literals(["read", "none"]),
  entries: Schema.Array(FileSystemSandboxPolicyEntrySchema),
});
export type FileSystemSandboxPolicy = typeof FileSystemSandboxPolicySchema.Type;

export const SandboxPolicySnapshotSchema = Schema.Struct({
  snapshotId: Schema.String,
  fingerprint: Schema.String,
  resolvedAt: IsoDateTimeStringSchema,
  scope: SandboxLaunchScopeSchema,
  surfacePiSessionId: Schema.optionalKey(SurfacePiSessionId),
  commandId: CommandId,
  launchKind: SandboxLaunchKindSchema,
  cwd: AbsolutePath,
  sandboxMode: Schema.Literals(["managed", "omitted_full_access"]),
  networkPolicy: Schema.Literals(["allow", "deny"]),
  filesystemPolicy: FileSystemSandboxPolicySchema,
  profileDigest: Schema.optionalKey(Schema.String),
});
export type SandboxPolicySnapshot = typeof SandboxPolicySnapshotSchema.Type;

export const EnvironmentFactSchema = Schema.Struct({
  key: Schema.String,
  valueFingerprint: Schema.optionalKey(Schema.String),
  redactionLabel: Schema.optionalKey(Schema.String),
});
export type EnvironmentFact = typeof EnvironmentFactSchema.Type;

export const BuildLaunchPolicyInputSchema = Schema.Struct({
  scope: SandboxLaunchScopeSchema,
  surfacePiSessionId: Schema.optionalKey(SurfacePiSessionId),
  commandId: CommandId,
  launchKind: SandboxLaunchKindSchema,
  command: Schema.Array(Schema.String),
  cwd: AbsolutePath,
  envFacts: Schema.Array(EnvironmentFactSchema),
  snapshot: Schema.optionalKey(SandboxPolicySnapshotSchema),
});
export type BuildLaunchPolicyInput = typeof BuildLaunchPolicyInputSchema.Type;

export const SandboxLaunchFactsSchema = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("managed"),
    command: Schema.Array(Schema.String),
    cwd: AbsolutePath,
    envFacts: Schema.Array(EnvironmentFactSchema),
    helperPath: AbsolutePath,
    helperArgs: Schema.Array(Schema.String),
    profilePath: Schema.optionalKey(AbsolutePath),
    policySnapshot: SandboxPolicySnapshotSchema,
  }),
  Schema.Struct({
    mode: Schema.Literal("omitted_full_access"),
    command: Schema.Array(Schema.String),
    cwd: AbsolutePath,
    envFacts: Schema.Array(EnvironmentFactSchema),
    policySnapshot: SandboxPolicySnapshotSchema,
  }),
]);
export type SandboxLaunchFacts = typeof SandboxLaunchFactsSchema.Type;

export interface SandboxPolicySourceService {
  snapshot(
    input: SandboxPolicySnapshotInput,
  ): Effect.Effect<SandboxPolicySnapshot, SandboxPolicyError>;
}

export interface SandboxPolicySource {
  readonly _tag: "SandboxPolicySource";
}

export const SandboxPolicySource = Context.Service<SandboxPolicySource, SandboxPolicySourceService>(
  "@svvy/core/SandboxPolicySource",
);
