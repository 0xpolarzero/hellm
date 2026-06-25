import {
  buildManagedWorkspaceWriteFileSystemPolicy,
  type FileSystemSandboxPolicy,
  unrestrictedFileSystemPolicy,
} from "./filesystem-sandbox-policy";

export type SandboxApprovalMode = "auto-review" | "user" | "full-access";

export interface SandboxSettingsInput {
  approvalMode?: SandboxApprovalMode;
  managedSandbox?: boolean;
  networkAccess?: boolean;
}

export interface SandboxLaunchPolicy {
  fileSystemPolicy: FileSystemSandboxPolicy;
  managedSandbox: boolean;
  networkAccess: boolean;
}

export interface DirectToolLaunchPolicyInput extends SandboxSettingsInput {
  cwd: string;
  workflowsSourceRoot?: string | null;
  extensionsSourceRoot: string;
  extensionsPackageRoot: string;
  protectedRoots?: readonly string[];
  alwaysProtectedRoots?: readonly string[];
  allowedRoots?: readonly string[];
  tmpdir?: string | null;
}

export interface SvvyxLaunchPolicyInput extends SandboxSettingsInput {
  cwd: string;
  workflowsSourceRoot?: string | null;
  workflowsGeneratedPackagePath: string;
  extensionsGeneratedPackagePath: string;
  extensionsRoot: string;
  artifactAllowedRoots?: readonly string[];
  tmpdir?: string | null;
}

export interface ExecuteTypescriptLaunchPolicyInput extends SandboxSettingsInput {
  cwd: string;
  tmpdir?: string | null;
}

export function resolveSandboxLaunchSettings(input: SandboxSettingsInput): {
  fullAccess: boolean;
  managedSandbox: boolean;
  networkAccess: boolean;
} {
  const fullAccess = input.approvalMode === "full-access";
  return {
    fullAccess,
    managedSandbox: fullAccess ? false : input.managedSandbox !== false,
    networkAccess: fullAccess ? true : input.networkAccess !== false,
  };
}

export function buildDirectToolLaunchPolicy(
  input: DirectToolLaunchPolicyInput,
): SandboxLaunchPolicy {
  const settings = resolveSandboxLaunchSettings(input);
  return {
    fileSystemPolicy: settings.fullAccess
      ? unrestrictedFileSystemPolicy()
      : buildManagedWorkspaceWriteFileSystemPolicy({
          cwd: input.cwd,
          writableRoots: [
            ...(input.workflowsSourceRoot ? [input.workflowsSourceRoot] : []),
            input.extensionsSourceRoot,
            input.extensionsPackageRoot,
            ...(input.allowedRoots ?? []),
          ],
          readOnlyRoots: [...(input.protectedRoots ?? []), ...(input.alwaysProtectedRoots ?? [])],
          includeSlashTmp: true,
          tmpdir: input.tmpdir ?? null,
        }),
    managedSandbox: settings.managedSandbox,
    networkAccess: settings.networkAccess,
  };
}

export function buildSvvyxLaunchPolicy(input: SvvyxLaunchPolicyInput): SandboxLaunchPolicy {
  const settings = resolveSandboxLaunchSettings(input);
  return {
    fileSystemPolicy: settings.fullAccess
      ? unrestrictedFileSystemPolicy()
      : buildManagedWorkspaceWriteFileSystemPolicy({
          cwd: input.cwd,
          writableRoots: [
            ...(input.workflowsSourceRoot ? [input.workflowsSourceRoot] : []),
            input.extensionsRoot,
            ...(input.artifactAllowedRoots ?? []),
          ],
          readOnlyRoots: [
            input.workflowsGeneratedPackagePath,
            input.extensionsGeneratedPackagePath,
          ],
          includeSlashTmp: true,
          tmpdir: input.tmpdir ?? null,
        }),
    managedSandbox: settings.managedSandbox,
    networkAccess: settings.networkAccess,
  };
}

export function buildExecuteTypescriptLaunchPolicy(
  input: ExecuteTypescriptLaunchPolicyInput,
): SandboxLaunchPolicy {
  const settings = resolveSandboxLaunchSettings(input);
  return {
    fileSystemPolicy: settings.fullAccess
      ? unrestrictedFileSystemPolicy()
      : buildManagedWorkspaceWriteFileSystemPolicy({
          cwd: input.cwd,
          includeSlashTmp: true,
          tmpdir: input.tmpdir ?? null,
        }),
    managedSandbox: settings.managedSandbox,
    networkAccess: settings.networkAccess,
  };
}

export function sandboxLaunchFacts(input: SandboxLaunchPolicy): Record<string, unknown> {
  return {
    managedSandbox: input.managedSandbox,
    networkAccess: input.networkAccess,
    fileSystemPolicyKind: input.fileSystemPolicy.kind,
    fileSystemPolicyEntryCount: input.fileSystemPolicy.entries.length,
  };
}
