import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort,
  type GeneratedPackageRefreshStatus,
  type GeneratedPackageBuildInput,
  type GeneratedPackageBuildPlanResult,
  type GeneratedPackageName,
  type GeneratedPackageWorkspaceLinkRepairPlan,
  type GeneratedPackagesRefreshResult,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type RefreshGeneratedPackagesRequest,
  type RefreshGeneratedContextRequest,
  type SourceDomain,
  type StateInvalidationDescriptor,
  type StateContractError,
  type WorkspaceId,
} from "@svvy/core";

export type RuntimeGeneratedPackageRefreshStatus =
  GeneratedPackagesRefreshResult["packages"][number];

export type RuntimeGeneratedPackageWorkspaceLinkStatus =
  GeneratedPackagesRefreshResult["workspaceLinks"][number];

export interface RuntimeGeneratedPackageRefreshHost {
  buildGeneratedPackages(
    input: GeneratedPackageBuildInput,
  ): Effect.Effect<GeneratedPackageBuildPlanResult, RuntimeContractError>;
  planWorkspaceLinkRepair(
    input: GeneratedPackageWorkspaceLinkRepairInput,
  ): Effect.Effect<GeneratedPackageWorkspaceLinkRepairPlan, RuntimeContractError>;
  readonly workspaceLinkFileHost: RuntimeGeneratedPackageWorkspaceLinkFileHost;
}

export interface RuntimeGeneratedPackageWorkspaceLinkFileHost {
  pathExists(path: string): boolean;
  isDirectory(path: string): boolean;
  isSymbolicLink(path: string): boolean;
  readSymbolicLink(path: string): string | null;
  makeDirectory(path: string): void;
  remove(path: string): void;
  symlinkDirectory(input: { targetPath: string; linkPath: string }): void;
}

export function applyGeneratedPackageWorkspaceLinkRepairPlan(
  plan: GeneratedPackageWorkspaceLinkRepairPlan,
  host: RuntimeGeneratedPackageWorkspaceLinkFileHost,
): RuntimeGeneratedPackageWorkspaceLinkStatus {
  try {
    const smithersRoot = smithersRootFromGeneratedPackageLinkPlan(plan);
    if (smithersRoot && !host.isDirectory(smithersRoot)) {
      return {
        workspaceId: plan.workspaceId,
        packageName: plan.packageName,
        status: "missing-smithers-root",
        linkPath: plan.linkPath,
        targetPath: plan.targetPath,
      };
    }

    if (!host.isDirectory(plan.targetPath)) {
      return {
        workspaceId: plan.workspaceId,
        packageName: plan.packageName,
        status: "failed",
        linkPath: plan.linkPath,
        targetPath: plan.targetPath,
        diagnostics: [`Generated package target is not a directory: ${plan.targetPath}`],
      };
    }

    if (host.pathExists(plan.linkPath)) {
      if (!host.isSymbolicLink(plan.linkPath)) {
        return {
          workspaceId: plan.workspaceId,
          packageName: plan.packageName,
          status: "blocked-non-symlink",
          linkPath: plan.linkPath,
          targetPath: plan.targetPath,
          diagnostics: [`Generated package link path is not a symlink: ${plan.linkPath}`],
        };
      }

      if (host.readSymbolicLink(plan.linkPath) === plan.targetPath) {
        return {
          workspaceId: plan.workspaceId,
          packageName: plan.packageName,
          status: "unchanged",
          linkPath: plan.linkPath,
          targetPath: plan.targetPath,
        };
      }

      host.remove(plan.linkPath);
    }

    host.makeDirectory(plan.requiredParentPath);
    host.symlinkDirectory({ targetPath: plan.targetPath, linkPath: plan.linkPath });

    return {
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "linked",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
    };
  } catch (cause) {
    return {
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "failed",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
      diagnostics: [cause instanceof Error ? cause.message : String(cause)],
    };
  }
}

function smithersRootFromGeneratedPackageLinkPlan(
  plan: GeneratedPackageWorkspaceLinkRepairPlan,
): string | null {
  return smithersRootFromPath(plan.requiredParentPath) ?? smithersRootFromPath(plan.linkPath);
}

function smithersRootFromPath(path: string): string | null {
  const marker = "/.smithers";
  const index = path.indexOf(marker);
  if (index < 0) return null;
  const end = index + marker.length;
  const next = path[end];
  if (next !== undefined && next !== "/") return null;
  return path.slice(0, end);
}

export function generatedPackagesForRuntimeSourceInvalidation(
  domains: readonly SourceDomain[],
): RefreshGeneratedPackagesRequest["packages"] {
  const packages = new Set<GeneratedPackageName>();
  if (domains.includes("workflows")) {
    packages.add("@svvyx/workflows");
  }
  if (domains.includes("extensions")) {
    packages.add("@svvyx/extensions");
    packages.add("@svvyx/workflows");
  }
  return [...packages];
}

function orderedGeneratedPackages(
  packages: readonly GeneratedPackageName[],
): RefreshGeneratedPackagesRequest["packages"] {
  const requested = new Set(packages);
  return (["@svvyx/extensions", "@svvyx/workflows"] as const).filter((packageName) =>
    requested.has(packageName),
  );
}

export function generatedContextReasonForRuntimeSourceInvalidation(
  domains: readonly SourceDomain[],
): Extract<RefreshGeneratedContextRequest, { scope: "workspace" }>["reason"] | null {
  if (domains.includes("extensions")) return "extension-source-changed";
  if (domains.includes("external_instructions")) return "external-instruction-changed";
  return null;
}

function packageFailureStatus(
  packageName: GeneratedPackageName,
  error: RuntimeContractError,
): RuntimeGeneratedPackageRefreshStatus {
  return {
    packageName,
    action: "failed",
    diagnostics: [error.message],
  };
}

function workspaceLinkFailureStatus(
  input: {
    packageName: GeneratedPackageName;
    workspaceId: WorkspaceId;
  },
  error: RuntimeContractError,
): RuntimeGeneratedPackageWorkspaceLinkStatus {
  return {
    workspaceId: input.workspaceId,
    packageName: input.packageName,
    status: "failed",
    diagnostics: [error.message],
  };
}

function generatedPackageStateError(
  operation: string,
  cause: StateContractError,
): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: "state-conflict",
    message: cause.message,
    cause,
  });
}

function recordPackageStatus(
  status: RuntimeGeneratedPackageRefreshStatus,
  input: RefreshGeneratedPackagesRequest,
): Effect.Effect<
  readonly StateInvalidationDescriptor[],
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort
> {
  return Effect.gen(function* () {
    const state = yield* RuntimeGeneratedPackageStatePort;
    const sourceCommandId = "sourceCommandId" in input ? input.sourceCommandId : undefined;
    const recoveryWorkId = "recoveryWorkId" in input ? input.recoveryWorkId : undefined;
    const lineage = {
      ...(sourceCommandId ? { sourceCommandId } : {}),
      ...(recoveryWorkId ? { recoveryWorkId } : {}),
    };
    const result =
      status.action === "failed"
        ? yield* state
            .recordGeneratedPackageFailure({
              status: status as GeneratedPackageRefreshStatus & { action: "failed" },
              ...lineage,
            })
            .pipe(
              Effect.mapError((error) =>
                generatedPackageStateError(
                  "runtime.sourceInvalidation.refreshGeneratedPackages.recordFailure",
                  error,
                ),
              ),
            )
        : yield* state
            .recordGeneratedPackageBuild({
              status: status as GeneratedPackageRefreshStatus & {
                action: "written" | "unchanged";
              },
              ...lineage,
            })
            .pipe(
              Effect.mapError((error) =>
                generatedPackageStateError(
                  "runtime.sourceInvalidation.refreshGeneratedPackages.recordBuild",
                  error,
                ),
              ),
            );
    return result.afterCommit;
  });
}

function recordWorkspaceLinkStatus(
  status: RuntimeGeneratedPackageWorkspaceLinkStatus,
  input: RefreshGeneratedPackagesRequest,
): Effect.Effect<
  readonly StateInvalidationDescriptor[],
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort
> {
  return Effect.gen(function* () {
    const state = yield* RuntimeGeneratedPackageStatePort;
    const sourceCommandId = "sourceCommandId" in input ? input.sourceCommandId : undefined;
    const recoveryWorkId = "recoveryWorkId" in input ? input.recoveryWorkId : undefined;
    const lineage = {
      ...(sourceCommandId ? { sourceCommandId } : {}),
      ...(recoveryWorkId ? { recoveryWorkId } : {}),
    };
    const result = yield* state
      .recordWorkspaceLinkStatus({
        status,
        ...lineage,
      })
      .pipe(
        Effect.mapError((error) =>
          generatedPackageStateError(
            "runtime.sourceInvalidation.refreshGeneratedPackages.recordWorkspaceLink",
            error,
          ),
        ),
      );
    return result.afterCommit;
  });
}

function statusesForBuildPlan(
  input: GeneratedPackageBuildInput,
  effect: Effect.Effect<GeneratedPackageBuildPlanResult, RuntimeContractError>,
): Effect.Effect<readonly RuntimeGeneratedPackageRefreshStatus[]> {
  return Effect.matchEffect(effect, {
    onFailure: (error) =>
      Effect.succeed(input.packages.map((packageName) => packageFailureStatus(packageName, error))),
    onSuccess: (result) => Effect.succeed(result.packages),
  });
}

function linkStatusForPackage(
  input: {
    packageName: GeneratedPackageName;
    workspaceId: WorkspaceId;
  },
  effect: Effect.Effect<GeneratedPackageWorkspaceLinkRepairPlan, RuntimeContractError>,
  host: RuntimeGeneratedPackageRefreshHost,
): Effect.Effect<RuntimeGeneratedPackageWorkspaceLinkStatus> {
  const applyPlan = Effect.gen(function* () {
    const plan = yield* effect;
    const status = applyGeneratedPackageWorkspaceLinkRepairPlan(plan, host.workspaceLinkFileHost);
    return {
      ...status,
      packageName: input.packageName,
      workspaceId: input.workspaceId,
    };
  });
  return Effect.matchEffect(applyPlan, {
    onFailure: (error) => Effect.succeed(workspaceLinkFailureStatus(input, error)),
    onSuccess: Effect.succeed,
  });
}

export const refreshRuntimeGeneratedPackages = Effect.fn(
  "@svvy/runtime/sourceInvalidation.refreshGeneratedPackages",
)(function* (input: RefreshGeneratedPackagesRequest, host: RuntimeGeneratedPackageRefreshHost) {
  const requested = new Set(input.packages);
  const statuses = new Map<GeneratedPackageName, RuntimeGeneratedPackageRefreshStatus>();
  const workspaceLinks: RuntimeGeneratedPackageWorkspaceLinkStatus[] = [];

  const setStatus = (status: RuntimeGeneratedPackageRefreshStatus): void => {
    statuses.set(status.packageName, status);
  };

  if (input.scope === "workspace-link-repair") {
    for (const packageName of input.packages) {
      const status = yield* linkStatusForPackage(
        { packageName, workspaceId: input.workspaceId },
        host.planWorkspaceLinkRepair({
          packageName,
          workspaceId: input.workspaceId,
        }),
        host,
      );
      workspaceLinks.push(status);
      yield* recordWorkspaceLinkStatus(status, input);
    }

    return {
      scope: "workspace-link-repair",
      packages: [],
      workspaceLinks,
      recoveryWorkIds: [],
    } satisfies GeneratedPackagesRefreshResult;
  }

  const buildPackages = orderedGeneratedPackages(input.packages);
  for (const status of yield* statusesForBuildPlan(
    { packages: buildPackages },
    host.buildGeneratedPackages({ packages: buildPackages }),
  )) {
    if (!requested.has(status.packageName)) {
      continue;
    }
    setStatus(status);
    yield* recordPackageStatus(status, input);
  }

  return {
    scope: "app-global",
    packages: [...statuses.values()],
    workspaceLinks: [],
    recoveryWorkIds: [],
  } satisfies GeneratedPackagesRefreshResult;
});
