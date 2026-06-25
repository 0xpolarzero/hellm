import * as Effect from "effect/Effect";
import { describe, expect, it } from "bun:test";
import {
  type AbsolutePath,
  type CommandId,
  type GeneratedPackageBuildId,
  type GeneratedPackageDependencyEvidence,
  type GeneratedPackageName,
  type GeneratedPackageWorkspaceLinkRepairPlan,
  type RecoveryWorkId,
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort,
  type RuntimeGeneratedPackageStatePortService,
  type StateInvalidationDescriptor,
  type WorkspaceId,
} from "@svvy/core";
import {
  applyGeneratedPackageWorkspaceLinkRepairPlan,
  generatedContextReasonForRuntimeSourceInvalidation,
  generatedPackagesForRuntimeSourceInvalidation,
  refreshRuntimeGeneratedPackages,
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
  type RuntimeGeneratedPackageRefreshHost,
} from "./generated-package-refresh";
import { runTestEffect } from "./effect.test-support";

function host(
  overrides: Partial<RuntimeGeneratedPackageRefreshHost> = {},
): RuntimeGeneratedPackageRefreshHost {
  return {
    buildGeneratedPackages: ({ packages }) =>
      Effect.succeed({
        packages: packages.map((packageName) => ({
          packageName,
          action: "written" as const,
        })),
      }),
    planWorkspaceLinkRepair: ({ packageName, workspaceId }) =>
      Effect.succeed(workspaceLinkPlan({ packageName, workspaceId })),
    workspaceLinkFileHost: fakeLinkFileHost(
      new Map([
        ["/workspace/.smithers", { kind: "directory" }],
        ["/generated/workflows", { kind: "directory" }],
        ["/generated/extensions", { kind: "directory" }],
      ]),
    ),
    ...overrides,
  };
}

function workspaceLinkPlan(input: {
  packageName: GeneratedPackageName;
  workspaceId: WorkspaceId;
}): GeneratedPackageWorkspaceLinkRepairPlan {
  return {
    workspaceId: input.workspaceId,
    packageName: input.packageName,
    linkPath:
      `/workspace/.smithers/node_modules/@svvyx/${input.packageName === "@svvyx/workflows" ? "workflows" : "extensions"}` as AbsolutePath,
    targetPath:
      `/generated/${input.packageName === "@svvyx/workflows" ? "workflows" : "extensions"}` as AbsolutePath,
    requiredParentPath: "/workspace/.smithers/node_modules/@svvyx" as AbsolutePath,
    overwritePolicy: "symlink-only",
  };
}

type FakeLinkEntry =
  | { readonly kind: "directory" }
  | { readonly kind: "file" }
  | { readonly kind: "symlink"; targetPath: string };

function fakeLinkFileHost(
  entries: Map<string, FakeLinkEntry>,
  calls: string[] = [],
): RuntimeGeneratedPackageWorkspaceLinkFileHost {
  return {
    pathExists: (path) => entries.has(path),
    isDirectory: (path) => entries.get(path)?.kind === "directory",
    isSymbolicLink: (path) => entries.get(path)?.kind === "symlink",
    readSymbolicLink: (path) => {
      const entry = entries.get(path);
      return entry?.kind === "symlink" ? entry.targetPath : null;
    },
    makeDirectory: (path) => {
      calls.push(`mkdir:${path}`);
      entries.set(path, { kind: "directory" });
    },
    remove: (path) => {
      calls.push(`remove:${path}`);
      entries.delete(path);
    },
    symlinkDirectory: ({ targetPath, linkPath }) => {
      calls.push(`symlink:${linkPath}->${targetPath}`);
      entries.set(linkPath, { kind: "symlink", targetPath });
    },
  };
}

function generatedPackageInvalidations(
  packageName: GeneratedPackageName,
): readonly StateInvalidationDescriptor[] {
  if (packageName === "@svvyx/workflows") {
    return [{ scope: "app", invalidation: { model: "workflowsGenerated" } }];
  }
  if (packageName === "@svvyx/extensions") {
    return [{ scope: "app", invalidation: { model: "extensions" } }];
  }
  return [];
}

function generatedPackageState(
  calls: string[] = [],
  overrides: Partial<RuntimeGeneratedPackageStatePortService> = {},
): RuntimeGeneratedPackageStatePortService {
  return {
    recordGeneratedPackageBuild: (input) =>
      Effect.sync(() => {
        calls.push(`build:${input.status.packageName}`);
        return {
          value: {
            packageName: input.status.packageName,
            status: "ready" as const,
            buildId: input.status.buildId ?? null,
            manifestPath: input.status.manifestPath ?? null,
            sourceFingerprint: input.status.sourceFingerprint ?? null,
            outputFingerprint: input.status.outputFingerprint ?? null,
            generatedFileListDigest: null,
            dependencies: input.status.dependencies ?? [],
            diagnostics: input.status.diagnostics ?? [],
            sourceCommandId: input.sourceCommandId ?? null,
            refreshNeededReason: null,
            lastRecoveryWorkId: input.recoveryWorkId ?? null,
            createdAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
          },
          afterCommit: generatedPackageInvalidations(input.status.packageName),
        };
      }),
    recordGeneratedPackageFailure: (input) =>
      Effect.sync(() => {
        calls.push(`failure:${input.status.packageName}`);
        return {
          value: {
            packageName: input.status.packageName,
            status: "failed" as const,
            buildId: input.status.buildId ?? null,
            manifestPath: input.status.manifestPath ?? null,
            sourceFingerprint: input.status.sourceFingerprint ?? null,
            outputFingerprint: input.status.outputFingerprint ?? null,
            generatedFileListDigest: null,
            dependencies: input.status.dependencies ?? [],
            diagnostics: input.status.diagnostics ?? [],
            sourceCommandId: input.sourceCommandId ?? null,
            refreshNeededReason: null,
            lastRecoveryWorkId: input.recoveryWorkId ?? null,
            createdAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
          },
          afterCommit: generatedPackageInvalidations(input.status.packageName),
        };
      }),
    recordWorkspaceLinkStatus: (input) =>
      Effect.sync(() => {
        calls.push(`link:${input.status.workspaceId}:${input.status.packageName}`);
        return {
          value: {
            workspaceId: input.status.workspaceId,
            packageName: input.status.packageName,
            status: input.status.status,
            linkPath: input.status.linkPath ?? null,
            targetPath: input.status.targetPath ?? null,
            diagnostics: input.status.diagnostics ?? [],
            sourceCommandId: input.sourceCommandId ?? null,
            lastRecoveryWorkId: input.recoveryWorkId ?? null,
            createdAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
          },
          afterCommit: generatedPackageInvalidations(input.status.packageName),
        };
      }),
    readLinksNeedingRepair: () => Effect.succeed([]),
    readGeneratedPackageFacts: () => Effect.succeed([]),
    reconcileGeneratedPackageManifest: (input) =>
      Effect.succeed({
        value: {
          ...input.fact,
          status: "ready",
          diagnostics: input.diagnostics ?? [],
          sourceCommandId: input.sourceCommandId ?? null,
          refreshNeededReason: null,
          lastRecoveryWorkId: input.recoveryWorkId ?? null,
          createdAt: "2026-04-18T09:00:00.000Z",
          updatedAt: "2026-04-18T09:00:00.000Z",
        },
        afterCommit: generatedPackageInvalidations(input.fact.packageName),
      }),
    markGeneratedPackageRefreshNeeded: (input) =>
      Effect.succeed({
        value: {
          packageName: input.packageName,
          status: "refresh-needed",
          buildId: null,
          manifestPath: null,
          sourceFingerprint: null,
          outputFingerprint: null,
          generatedFileListDigest: null,
          dependencies: [],
          diagnostics: [],
          sourceCommandId: input.sourceCommandId ?? null,
          refreshNeededReason: input.reason,
          lastRecoveryWorkId: input.recoveryWorkId ?? null,
          createdAt: "2026-04-18T09:00:00.000Z",
          updatedAt: "2026-04-18T09:00:00.000Z",
        },
        afterCommit: generatedPackageInvalidations(input.packageName),
      }),
    ...overrides,
  };
}

function runRefresh<A, E>(
  effect: Effect.Effect<A, E, RuntimeGeneratedPackageStatePort>,
  state: RuntimeGeneratedPackageStatePortService = generatedPackageState(),
): Promise<A> {
  return runTestEffect(effect.pipe(Effect.provideService(RuntimeGeneratedPackageStatePort, state)));
}

describe("refreshRuntimeGeneratedPackages", () => {
  it("applies generated package workspace link plans through a host capability", () => {
    const plan = workspaceLinkPlan({
      workspaceId: "workspace_runtime_link_apply_01" as WorkspaceId,
      packageName: "@svvyx/workflows",
    });
    const entries = new Map<string, FakeLinkEntry>([
      ["/workspace/.smithers", { kind: "directory" }],
      [plan.targetPath, { kind: "directory" }],
    ]);
    const calls: string[] = [];

    const status = applyGeneratedPackageWorkspaceLinkRepairPlan(
      plan,
      fakeLinkFileHost(entries, calls),
    );

    expect(status).toEqual({
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "linked",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
    });
    expect(calls).toEqual([
      "mkdir:/workspace/.smithers/node_modules/@svvyx",
      "symlink:/workspace/.smithers/node_modules/@svvyx/workflows->/generated/workflows",
    ]);
  });

  it("does not create workspace generated package links when the Smithers root is missing", () => {
    const plan = workspaceLinkPlan({
      workspaceId: "workspace_runtime_link_apply_02" as WorkspaceId,
      packageName: "@svvyx/workflows",
    });
    const entries = new Map<string, FakeLinkEntry>([[plan.targetPath, { kind: "directory" }]]);
    const calls: string[] = [];

    const status = applyGeneratedPackageWorkspaceLinkRepairPlan(
      plan,
      fakeLinkFileHost(entries, calls),
    );

    expect(status).toEqual({
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "missing-smithers-root",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
    });
    expect(calls).toEqual([]);
  });

  it("does not overwrite non-symlink workspace generated package paths", () => {
    const plan = workspaceLinkPlan({
      workspaceId: "workspace_runtime_link_apply_03" as WorkspaceId,
      packageName: "@svvyx/extensions",
    });
    const entries = new Map<string, FakeLinkEntry>([
      ["/workspace/.smithers", { kind: "directory" }],
      [plan.targetPath, { kind: "directory" }],
      [plan.linkPath, { kind: "directory" }],
    ]);

    const status = applyGeneratedPackageWorkspaceLinkRepairPlan(plan, fakeLinkFileHost(entries));

    expect(status).toEqual({
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "blocked-non-symlink",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
      diagnostics: [
        "Generated package link path is not a symlink: /workspace/.smithers/node_modules/@svvyx/extensions",
      ],
    });
    expect(entries.get(plan.linkPath)).toEqual({ kind: "directory" });
  });

  it("leaves current generated package links unchanged", () => {
    const plan = workspaceLinkPlan({
      workspaceId: "workspace_runtime_link_apply_04" as WorkspaceId,
      packageName: "@svvyx/workflows",
    });
    const entries = new Map<string, FakeLinkEntry>([
      ["/workspace/.smithers", { kind: "directory" }],
      [plan.targetPath, { kind: "directory" }],
      [plan.linkPath, { kind: "symlink", targetPath: plan.targetPath }],
    ]);
    const calls: string[] = [];

    const status = applyGeneratedPackageWorkspaceLinkRepairPlan(
      plan,
      fakeLinkFileHost(entries, calls),
    );

    expect(status.status).toBe("unchanged");
    expect(calls).toEqual([]);
  });

  it("replaces stale symlink generated package links", () => {
    const plan = workspaceLinkPlan({
      workspaceId: "workspace_runtime_link_apply_05" as WorkspaceId,
      packageName: "@svvyx/workflows",
    });
    const entries = new Map<string, FakeLinkEntry>([
      ["/workspace/.smithers", { kind: "directory" }],
      [plan.targetPath, { kind: "directory" }],
      [plan.linkPath, { kind: "symlink", targetPath: "/generated/old-workflows" }],
    ]);
    const calls: string[] = [];

    const status = applyGeneratedPackageWorkspaceLinkRepairPlan(
      plan,
      fakeLinkFileHost(entries, calls),
    );

    expect(status.status).toBe("linked");
    expect(calls).toEqual([
      "remove:/workspace/.smithers/node_modules/@svvyx/workflows",
      "mkdir:/workspace/.smithers/node_modules/@svvyx",
      "symlink:/workspace/.smithers/node_modules/@svvyx/workflows->/generated/workflows",
    ]);
  });

  it("reports missing generated package targets as failed link repair", () => {
    const plan = workspaceLinkPlan({
      workspaceId: "workspace_runtime_link_apply_06" as WorkspaceId,
      packageName: "@svvyx/extensions",
    });
    const entries = new Map<string, FakeLinkEntry>([
      ["/workspace/.smithers", { kind: "directory" }],
    ]);

    const status = applyGeneratedPackageWorkspaceLinkRepairPlan(plan, fakeLinkFileHost(entries));

    expect(status).toEqual({
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "failed",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
      diagnostics: ["Generated package target is not a directory: /generated/extensions"],
    });
  });

  it("maps source domains to the generated packages and context refresh reasons runtime owns", () => {
    expect(generatedPackagesForRuntimeSourceInvalidation(["workflows"])).toEqual([
      "@svvyx/workflows",
    ]);
    expect(generatedPackagesForRuntimeSourceInvalidation(["extensions"])).toEqual([
      "@svvyx/extensions",
      "@svvyx/workflows",
    ]);
    expect(generatedPackagesForRuntimeSourceInvalidation(["host_snippets"])).toEqual([]);
    expect(generatedContextReasonForRuntimeSourceInvalidation(["extensions"])).toBe(
      "extension-source-changed",
    );
    expect(generatedContextReasonForRuntimeSourceInvalidation(["external_instructions"])).toBe(
      "external-instruction-changed",
    );
    expect(generatedContextReasonForRuntimeSourceInvalidation(["workflows"])).toBeNull();
  });

  it("returns Workflows invalidation after the state port records the committed package fact", async () => {
    const stateCalls: string[] = [];

    await expect(
      runRefresh(
        refreshRuntimeGeneratedPackages(
          {
            scope: "app-global",
            packages: ["@svvyx/workflows"],
            reason: "explicit-build",
          },
          host(),
        ),
        generatedPackageState(stateCalls),
      ),
    ).resolves.toEqual({
      scope: "app-global",
      packages: [{ packageName: "@svvyx/workflows", action: "written" }],
      workspaceLinks: [],
      recoveryWorkIds: [],
    });

    expect(stateCalls).toEqual(["build:@svvyx/workflows"]);
  });

  it("records actual generated package build statuses", async () => {
    const buildInputs: unknown[] = [];
    const stateStatuses: unknown[] = [];
    const dependencies = [
      {
        kind: "package" as const,
        name: "@svvy/core",
        resolution: "app-owned-package" as const,
        version: "workspace",
      },
      {
        kind: "generated-package" as const,
        name: "@svvyx/extensions" as const,
        buildId: "gen_build_extensions_01" as GeneratedPackageBuildId,
        resolution: "generated-package-link" as const,
      },
    ] satisfies readonly GeneratedPackageDependencyEvidence[];

    const result = await runRefresh(
      refreshRuntimeGeneratedPackages(
        {
          scope: "app-global",
          packages: ["@svvyx/workflows", "@svvyx/extensions"],
          reason: "source-changed",
        },
        host({
          buildGeneratedPackages: (input) =>
            Effect.sync(() => {
              buildInputs.push(input);
              return {
                packages: [
                  { packageName: "@svvyx/extensions", action: "written" },
                  { packageName: "@svvyx/workflows", action: "written", dependencies },
                ],
              };
            }),
        }),
      ),
      generatedPackageState([], {
        recordGeneratedPackageBuild: (input) =>
          Effect.sync(() => {
            stateStatuses.push(input.status);
            return {
              value: {
                packageName: input.status.packageName,
                status: "ready" as const,
                buildId: input.status.buildId ?? null,
                manifestPath: input.status.manifestPath ?? null,
                sourceFingerprint: input.status.sourceFingerprint ?? null,
                outputFingerprint: input.status.outputFingerprint ?? null,
                generatedFileListDigest: null,
                dependencies: input.status.dependencies ?? [],
                diagnostics: input.status.diagnostics ?? [],
                sourceCommandId: input.sourceCommandId ?? null,
                refreshNeededReason: null,
                lastRecoveryWorkId: input.recoveryWorkId ?? null,
                createdAt: "2026-04-18T09:00:00.000Z",
                updatedAt: "2026-04-18T09:00:00.000Z",
              },
              afterCommit: generatedPackageInvalidations(input.status.packageName),
            };
          }),
      }),
    );

    expect(result).toEqual({
      scope: "app-global",
      packages: [
        { packageName: "@svvyx/extensions", action: "written" },
        { packageName: "@svvyx/workflows", action: "written", dependencies },
      ],
      workspaceLinks: [],
      recoveryWorkIds: [],
    });
    expect(buildInputs).toEqual([{ packages: ["@svvyx/extensions", "@svvyx/workflows"] }]);
    expect(stateStatuses).toEqual([
      { packageName: "@svvyx/extensions", action: "written" },
      { packageName: "@svvyx/workflows", action: "written", dependencies },
    ]);
  });

  it("refreshes @svvyx/extensions directly when Workflows is not requested", async () => {
    const result = await runRefresh(
      refreshRuntimeGeneratedPackages(
        {
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "explicit-build",
        },
        host(),
      ),
    );

    expect(result).toMatchObject({
      packages: [{ packageName: "@svvyx/extensions", action: "written" }],
    });
  });

  it("records failed package statuses", async () => {
    const stateCalls: string[] = [];

    const result = await runRefresh(
      refreshRuntimeGeneratedPackages(
        {
          scope: "app-global",
          packages: ["@svvyx/workflows"],
          reason: "source-changed",
        },
        host({
          buildGeneratedPackages: () =>
            Effect.fail(
              new RuntimeContractError({
                operation: "test.workflows",
                reason: "unsupported-operation",
                message: "build failed",
              }),
            ),
        }),
      ),
      generatedPackageState(stateCalls),
    );

    expect(result).toEqual({
      scope: "app-global",
      packages: [
        { packageName: "@svvyx/workflows", action: "failed", diagnostics: ["build failed"] },
      ],
      workspaceLinks: [],
      recoveryWorkIds: [],
    });
    expect(stateCalls).toEqual(["failure:@svvyx/workflows"]);
  });

  it("does not expose runtime scheduling lineage to the generated package build host", async () => {
    const buildInputs: unknown[] = [];

    await runRefresh(
      refreshRuntimeGeneratedPackages(
        {
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "startup-recovery",
          sourceCommandId: "cmd_generated_refresh_01" as CommandId,
          recoveryWorkId: "recovery_generated_refresh_01" as RecoveryWorkId,
        },
        host({
          buildGeneratedPackages: (input) =>
            Effect.sync(() => {
              buildInputs.push(input);
              return {
                packages: [{ packageName: "@svvyx/extensions", action: "written" }],
              };
            }),
        }),
      ),
    );

    expect(buildInputs).toEqual([{ packages: ["@svvyx/extensions"] }]);
  });

  it("repairs workspace links for each requested package without returning invalidations", async () => {
    const workspaceId = "workspace_runtime_generated_packages_01" as WorkspaceId;
    const plans: string[] = [];
    const linkCalls: string[] = [];
    const stateCalls: string[] = [];
    const linkEntries = new Map<string, FakeLinkEntry>([
      ["/workspace/.smithers", { kind: "directory" }],
      ["/generated/workflows", { kind: "directory" }],
      ["/generated/extensions", { kind: "directory" }],
    ]);

    const result = await runRefresh(
      refreshRuntimeGeneratedPackages(
        {
          scope: "workspace-link-repair",
          workspaceId,
          packages: ["@svvyx/workflows", "@svvyx/extensions"],
          reason: "link-repair",
        },
        host({
          planWorkspaceLinkRepair: ({ packageName, workspaceId: linkWorkspaceId }) =>
            Effect.sync(() => {
              plans.push(packageName);
              return workspaceLinkPlan({ packageName, workspaceId: linkWorkspaceId });
            }),
          workspaceLinkFileHost: fakeLinkFileHost(linkEntries, linkCalls),
        }),
      ),
      generatedPackageState(stateCalls),
    );
    const workflowsPlan = workspaceLinkPlan({
      workspaceId,
      packageName: "@svvyx/workflows",
    });
    const extensionsPlan = workspaceLinkPlan({
      workspaceId,
      packageName: "@svvyx/extensions",
    });

    expect(result).toEqual({
      scope: "workspace-link-repair",
      packages: [],
      workspaceLinks: [
        {
          workspaceId,
          packageName: "@svvyx/workflows",
          status: "linked",
          linkPath: workflowsPlan.linkPath,
          targetPath: workflowsPlan.targetPath,
        },
        {
          workspaceId,
          packageName: "@svvyx/extensions",
          status: "linked",
          linkPath: extensionsPlan.linkPath,
          targetPath: extensionsPlan.targetPath,
        },
      ],
      recoveryWorkIds: [],
    });
    expect(plans).toEqual(["@svvyx/workflows", "@svvyx/extensions"]);
    expect(linkCalls).toEqual([
      "mkdir:/workspace/.smithers/node_modules/@svvyx",
      "symlink:/workspace/.smithers/node_modules/@svvyx/workflows->/generated/workflows",
      "mkdir:/workspace/.smithers/node_modules/@svvyx",
      "symlink:/workspace/.smithers/node_modules/@svvyx/extensions->/generated/extensions",
    ]);
    expect(stateCalls).toEqual([
      `link:${workspaceId}:@svvyx/workflows`,
      `link:${workspaceId}:@svvyx/extensions`,
    ]);
  });
});
