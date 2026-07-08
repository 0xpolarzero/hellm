import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort,
  type GeneratedPackageBuildStatus,
  type GeneratedPackageRefreshStatus,
  type GeneratedPackageBuildInput,
  type GeneratedPackageBuildPlanResult,
  type GeneratedPackageName,
  type GeneratedPackageWorkspaceLinkRepairPlan,
  type GeneratedPackagesRefreshResult,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type InternalRefreshGeneratedPackagesRequest,
  type RefreshGeneratedContextRequest,
  type SourceDomain,
  type StateInvalidationDescriptor,
  type StateContractError,
  type WorkspaceId,
  type RecoveryWorkId,
  type IsoDateTimeString,
} from "@svvy/core";

export type RuntimeGeneratedPackageRefreshStatus =
  GeneratedPackagesRefreshResult["packages"][number];

export type RuntimeGeneratedPackageWorkspaceLinkStatus =
  GeneratedPackagesRefreshResult["workspaceLinks"][number];

export interface RuntimeGeneratedPackageRefreshHost {
  buildGeneratedPackages(
    input: GeneratedPackageBuildInput,
  ): Effect.Effect<GeneratedPackageBuildPlanResult, RuntimeContractError>;
  listAcquiredWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  listRecoverableWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  materializeCoreTypeContractPackage(): Effect.Effect<void, RuntimeContractError>;
  now(): Effect.Effect<IsoDateTimeString, RuntimeContractError>;
  planWorkspaceLinkRepair(
    input: GeneratedPackageWorkspaceLinkRepairInput,
  ): Effect.Effect<GeneratedPackageWorkspaceLinkRepairPlan, RuntimeContractError>;
  publishStateInvalidations(
    afterCommit: readonly StateInvalidationDescriptor[],
  ): Effect.Effect<void, RuntimeContractError>;
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
): InternalRefreshGeneratedPackagesRequest["packages"] {
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
): InternalRefreshGeneratedPackagesRequest["packages"] {
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
): GeneratedPackageBuildStatus {
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

function generatedPackageEventError(operation: string, cause: unknown): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: "state-conflict",
    message:
      cause instanceof Error
        ? cause.message
        : "Runtime generated-package event publication failed.",
    cause,
  });
}

function publishGeneratedPackageInvalidations(
  operation: string,
  afterCommit: readonly StateInvalidationDescriptor[],
  host: RuntimeGeneratedPackageRefreshHost,
): Effect.Effect<void, RuntimeContractError> {
  return host
    .publishStateInvalidations(afterCommit)
    .pipe(Effect.mapError((error) => generatedPackageEventError(operation, error)));
}

function recordPackageStatus(
  status: RuntimeGeneratedPackageRefreshStatus,
  input: InternalRefreshGeneratedPackagesRequest,
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
    const refreshStatus = {
      ...status,
      refreshScope: "app-global-build" as const,
    };
    const result =
      status.action === "failed"
        ? yield* state
            .recordGeneratedPackageFailure({
              status: refreshStatus as GeneratedPackageRefreshStatus & { action: "failed" },
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
              status: refreshStatus as GeneratedPackageRefreshStatus & {
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
  input: InternalRefreshGeneratedPackagesRequest,
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

function repairableGeneratedPackages(
  statuses: Iterable<RuntimeGeneratedPackageRefreshStatus>,
): readonly GeneratedPackageName[] {
  return Array.from(statuses)
    .filter((status) => status.action === "written" || status.action === "unchanged")
    .map((status) => status.packageName);
}

function fanOutWorkspaceLinkRepairForAcquiredWorkspaces(input: {
  packages: readonly GeneratedPackageName[];
  request: InternalRefreshGeneratedPackagesRequest & { scope: "app-global" };
  host: RuntimeGeneratedPackageRefreshHost;
}): Effect.Effect<
  readonly RecoveryWorkId[],
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort
> {
  if (input.packages.length === 0) {
    return Effect.succeed([]);
  }

  return Effect.gen(function* () {
    const workspaceIds = yield* input.host.listAcquiredWorkspaceIds();
    const acquiredWorkspaceIds = new Set(workspaceIds);
    for (const workspaceId of workspaceIds) {
      for (const packageName of input.packages) {
        const status = yield* linkStatusForPackage(
          { packageName, workspaceId },
          input.host.planWorkspaceLinkRepair({
            packageName,
            workspaceId,
          }),
          input.host,
        );
        const afterCommit = yield* recordWorkspaceLinkStatus(status, input.request);
        yield* publishGeneratedPackageInvalidations(
          "runtime.sourceInvalidation.refreshGeneratedPackages.publishWorkspaceLinkFanout",
          afterCommit,
          input.host,
        );
      }
    }
    const recoverableWorkspaceIds = yield* input.host.listRecoverableWorkspaceIds();
    const unopenedWorkspaceIds = recoverableWorkspaceIds.filter(
      (workspaceId) => !acquiredWorkspaceIds.has(workspaceId),
    );
    if (unopenedWorkspaceIds.length === 0) {
      return [];
    }

    const state = yield* RuntimeGeneratedPackageStatePort;
    const requestedAt = yield* input.host.now();
    const sourceCommandId =
      "sourceCommandId" in input.request ? input.request.sourceCommandId : undefined;
    const recoveryWorkIds: RecoveryWorkId[] = [];
    for (const workspaceId of unopenedWorkspaceIds) {
      const result = yield* state
        .markWorkspaceLinksRepairNeeded({
          workspaceId,
          packages: input.packages,
          reason: "app-global-generated-package-refreshed",
          requestedAt,
          maxAttempts: 5,
          ...(sourceCommandId ? { sourceCommandId } : {}),
        })
        .pipe(
          Effect.mapError((error) =>
            generatedPackageStateError(
              "runtime.sourceInvalidation.refreshGeneratedPackages.markWorkspaceLinksRepairNeeded",
              error,
            ),
          ),
        );
      recoveryWorkIds.push(...result.value.recoveryWorkIds);
      yield* publishGeneratedPackageInvalidations(
        "runtime.sourceInvalidation.refreshGeneratedPackages.publishWorkspaceLinkRepairNeeded",
        result.afterCommit,
        input.host,
      );
    }
    return recoveryWorkIds;
  });
}

export const refreshRuntimeGeneratedPackages = Effect.fn(
  "@svvy/runtime/sourceInvalidation.refreshGeneratedPackages",
)(function* (
  input: InternalRefreshGeneratedPackagesRequest,
  host: RuntimeGeneratedPackageRefreshHost,
) {
  const statuses = new Map<GeneratedPackageName, RuntimeGeneratedPackageRefreshStatus>();
  const workspaceLinks: RuntimeGeneratedPackageWorkspaceLinkStatus[] = [];
  const recoveryWorkIds: RecoveryWorkId[] = [];

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
      const afterCommit = yield* recordWorkspaceLinkStatus(status, input);
      yield* publishGeneratedPackageInvalidations(
        "runtime.sourceInvalidation.refreshGeneratedPackages.publishWorkspaceLink",
        afterCommit,
        host,
      );
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
    setStatus(status);
    const afterCommit = yield* recordPackageStatus(status, input);
    yield* publishGeneratedPackageInvalidations(
      "runtime.sourceInvalidation.refreshGeneratedPackages.publishPackage",
      afterCommit,
      host,
    );
  }
  recoveryWorkIds.push(
    ...(yield* fanOutWorkspaceLinkRepairForAcquiredWorkspaces({
      packages: repairableGeneratedPackages(statuses.values()),
      request: input,
      host,
    })),
  );

  return {
    scope: "app-global",
    packages: [...statuses.values()],
    workspaceLinks: [],
    recoveryWorkIds,
  } satisfies GeneratedPackagesRefreshResult;
});
