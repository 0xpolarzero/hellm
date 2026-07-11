import * as Effect from "effect/Effect";
import { assert, describe, it } from "@effect/vitest";
import {
  type AbsolutePath,
  type CommandId,
  type GeneratedPackageBuildId,
  type GeneratedPackageDependencyEvidence,
  type GeneratedPackageName,
  type GeneratedPackageWorkspaceLinkRepairPlan,
  type IsoDateTimeString,
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
        workflowsExports: [],
      }),
    listAcquiredWorkspaceIds: () => Effect.succeed([]),
    listRecoverableWorkspaceIds: () => Effect.succeed([]),
    materializeCoreTypeContractPackage: () => Effect.void,
    now: () => Effect.succeed("2026-04-18T09:00:00.000Z" as IsoDateTimeString),
    planWorkspaceLinkRepair: ({ packageName, workspaceId }) =>
      Effect.succeed(workspaceLinkPlan({ packageName, workspaceId })),
    publishStateInvalidations: () => Effect.void,
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
    markWorkspaceLinksRepairNeeded: (input) =>
      Effect.sync(() => {
        calls.push(
          ...input.packages.map(
            (packageName) => `repair-needed:${input.workspaceId}:${packageName}`,
          ),
        );
        return {
          value: {
            links: input.packages.map((packageName) => ({
              workspaceId: input.workspaceId,
              packageName,
              status: "repair-needed" as const,
              linkPath: null,
              targetPath: null,
              diagnostics: [],
              sourceCommandId: input.sourceCommandId ?? null,
              lastRecoveryWorkId: input.recoveryWorkId ?? null,
              createdAt: input.requestedAt,
              updatedAt: input.requestedAt,
            })),
            recoveryWorkIds: [`recovery_link_repair:${input.workspaceId}` as RecoveryWorkId],
          },
          afterCommit: input.packages.flatMap(generatedPackageInvalidations),
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
): Effect.Effect<A, E> {
  return effect.pipe(Effect.provideService(RuntimeGeneratedPackageStatePort, state));
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

    assert.deepStrictEqual(status, {
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "linked",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
    });
    assert.deepStrictEqual(calls, [
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

    assert.deepStrictEqual(status, {
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "missing-smithers-root",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
    });
    assert.deepStrictEqual(calls, []);
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

    assert.deepStrictEqual(status, {
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "blocked-non-symlink",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
      diagnostics: [
        "Generated package link path is not a symlink: /workspace/.smithers/node_modules/@svvyx/extensions",
      ],
    });
    assert.deepStrictEqual(entries.get(plan.linkPath), { kind: "directory" });
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

    assert.strictEqual(status.status, "unchanged");
    assert.deepStrictEqual(calls, []);
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

    assert.strictEqual(status.status, "linked");
    assert.deepStrictEqual(calls, [
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

    assert.deepStrictEqual(status, {
      workspaceId: plan.workspaceId,
      packageName: plan.packageName,
      status: "failed",
      linkPath: plan.linkPath,
      targetPath: plan.targetPath,
      diagnostics: ["Generated package target is not a directory: /generated/extensions"],
    });
  });

  it("maps source domains to the generated packages and context refresh reasons runtime owns", () => {
    assert.deepStrictEqual(generatedPackagesForRuntimeSourceInvalidation(["workflows"]), [
      "@svvyx/workflows",
    ]);
    assert.deepStrictEqual(generatedPackagesForRuntimeSourceInvalidation(["extensions"]), [
      "@svvyx/extensions",
      "@svvyx/workflows",
    ]);
    assert.deepStrictEqual(generatedPackagesForRuntimeSourceInvalidation(["host_snippets"]), []);
    assert.strictEqual(
      generatedContextReasonForRuntimeSourceInvalidation(["extensions"]),
      "extension-source-changed",
    );
    assert.strictEqual(
      generatedContextReasonForRuntimeSourceInvalidation(["external_instructions"]),
      "external-instruction-changed",
    );
    assert.strictEqual(generatedContextReasonForRuntimeSourceInvalidation(["workflows"]), null);
  });

  it.effect(
    "publishes Workflows invalidation after the state port records the committed package fact",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];

        const result = yield* runRefresh(
          refreshRuntimeGeneratedPackages(
            {
              scope: "app-global",
              packages: ["@svvyx/workflows"],
              reason: "explicit-build",
            },
            host({
              publishStateInvalidations: (afterCommit) =>
                Effect.sync(() => {
                  calls.push(
                    ...afterCommit.map((descriptor) =>
                      descriptor.scope === "app"
                        ? `publish:app:${descriptor.invalidation.model}`
                        : `publish:workspace:${descriptor.workspaceId}:${descriptor.invalidation.model}`,
                    ),
                  );
                }),
            }),
          ),
          generatedPackageState(calls),
        );
        assert.deepStrictEqual(result, {
          scope: "app-global",
          packages: [{ packageName: "@svvyx/workflows", action: "written" }],
          workspaceLinks: [],
          recoveryWorkIds: [],
        });

        assert.deepStrictEqual(calls, ["build:@svvyx/workflows", "publish:app:workflowsGenerated"]);
      }),
  );

  it.effect(
    "fans out acquired workspace link repair only after app-global package facts commit",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const workspaceId = "workspace_runtime_generated_fanout_01" as WorkspaceId;

        const result = yield* runRefresh(
          refreshRuntimeGeneratedPackages(
            {
              scope: "app-global",
              packages: ["@svvyx/workflows"],
              reason: "explicit-build",
            },
            host({
              listAcquiredWorkspaceIds: () =>
                Effect.sync(() => {
                  calls.push("list-workspaces");
                  return [workspaceId];
                }),
              planWorkspaceLinkRepair: ({ packageName, workspaceId: linkWorkspaceId }) =>
                Effect.sync(() => {
                  calls.push(`plan:${linkWorkspaceId}:${packageName}`);
                  return workspaceLinkPlan({ packageName, workspaceId: linkWorkspaceId });
                }),
              publishStateInvalidations: (afterCommit) =>
                Effect.sync(() => {
                  calls.push(
                    ...afterCommit.map((descriptor) =>
                      descriptor.scope === "app"
                        ? `publish:app:${descriptor.invalidation.model}`
                        : `publish:workspace:${descriptor.workspaceId}:${descriptor.invalidation.model}`,
                    ),
                  );
                }),
            }),
          ),
          generatedPackageState(calls),
        );
        assert.deepStrictEqual(result, {
          scope: "app-global",
          packages: [{ packageName: "@svvyx/workflows", action: "written" }],
          workspaceLinks: [],
          recoveryWorkIds: [],
        });

        assert.deepStrictEqual(calls, [
          "build:@svvyx/workflows",
          "publish:app:workflowsGenerated",
          "list-workspaces",
          `plan:${workspaceId}:@svvyx/workflows`,
          `link:${workspaceId}:@svvyx/workflows`,
          "publish:app:workflowsGenerated",
        ]);
      }),
  );

  it.effect(
    "marks recoverable unopened workspaces repair-needed after app-global package facts commit",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const acquiredWorkspaceId = "workspace_runtime_generated_fanout_03" as WorkspaceId;
        const unopenedWorkspaceId = "workspace_runtime_generated_unopened_01" as WorkspaceId;

        const result = yield* runRefresh(
          refreshRuntimeGeneratedPackages(
            {
              scope: "app-global",
              packages: ["@svvyx/workflows"],
              reason: "source-changed",
              sourceCommandId: "cmd_generated_unopened_repair_01" as CommandId,
            },
            host({
              listAcquiredWorkspaceIds: () =>
                Effect.sync(() => {
                  calls.push("list-acquired");
                  return [acquiredWorkspaceId];
                }),
              listRecoverableWorkspaceIds: () =>
                Effect.sync(() => {
                  calls.push("list-recoverable");
                  return [acquiredWorkspaceId, unopenedWorkspaceId];
                }),
              planWorkspaceLinkRepair: ({ packageName, workspaceId: linkWorkspaceId }) =>
                Effect.sync(() => {
                  calls.push(`plan:${linkWorkspaceId}:${packageName}`);
                  return workspaceLinkPlan({ packageName, workspaceId: linkWorkspaceId });
                }),
              publishStateInvalidations: (afterCommit) =>
                Effect.sync(() => {
                  calls.push(
                    ...afterCommit.map((descriptor) =>
                      descriptor.scope === "app"
                        ? `publish:app:${descriptor.invalidation.model}`
                        : `publish:workspace:${descriptor.workspaceId}:${descriptor.invalidation.model}`,
                    ),
                  );
                }),
            }),
          ),
          generatedPackageState(calls),
        );
        assert.deepStrictEqual(result, {
          scope: "app-global",
          packages: [{ packageName: "@svvyx/workflows", action: "written" }],
          workspaceLinks: [],
          recoveryWorkIds: [`recovery_link_repair:${unopenedWorkspaceId}` as RecoveryWorkId],
        });

        assert.deepStrictEqual(calls, [
          "build:@svvyx/workflows",
          "publish:app:workflowsGenerated",
          "list-acquired",
          `plan:${acquiredWorkspaceId}:@svvyx/workflows`,
          `link:${acquiredWorkspaceId}:@svvyx/workflows`,
          "publish:app:workflowsGenerated",
          "list-recoverable",
          `repair-needed:${unopenedWorkspaceId}:@svvyx/workflows`,
          "publish:app:workflowsGenerated",
        ]);
      }),
  );

  it.effect("does not fan out workspace link repair for failed app-global packages", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const result = yield* runRefresh(
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
            listAcquiredWorkspaceIds: () =>
              Effect.sync(() => {
                calls.push("unexpected-list-workspaces");
                return ["workspace_unexpected_fanout" as WorkspaceId];
              }),
            planWorkspaceLinkRepair: () =>
              Effect.sync(() => {
                calls.push("unexpected-plan");
                return workspaceLinkPlan({
                  workspaceId: "workspace_unexpected_fanout" as WorkspaceId,
                  packageName: "@svvyx/workflows",
                });
              }),
          }),
        ),
        generatedPackageState(calls),
      );

      assert.deepStrictEqual(result, {
        scope: "app-global",
        packages: [
          { packageName: "@svvyx/workflows", action: "failed", diagnostics: ["build failed"] },
        ],
        workspaceLinks: [],
        recoveryWorkIds: [],
      });
      assert.deepStrictEqual(calls, ["failure:@svvyx/workflows"]);
    }),
  );

  it.effect(
    "fans out link repair for successful packages while skipping failed packages in one app-global batch",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const workspaceId = "workspace_runtime_generated_fanout_02" as WorkspaceId;

        const result = yield* runRefresh(
          refreshRuntimeGeneratedPackages(
            {
              scope: "app-global",
              packages: ["@svvyx/extensions", "@svvyx/workflows"],
              reason: "source-changed",
            },
            host({
              buildGeneratedPackages: () =>
                Effect.succeed({
                  packages: [
                    { packageName: "@svvyx/extensions", action: "written" },
                    {
                      packageName: "@svvyx/workflows",
                      action: "failed",
                      diagnostics: ["workflow source invalid"],
                    },
                  ],
                  workflowsExports: [],
                }),
              listAcquiredWorkspaceIds: () =>
                Effect.sync(() => {
                  calls.push("list-workspaces");
                  return [workspaceId];
                }),
              planWorkspaceLinkRepair: ({ packageName, workspaceId: linkWorkspaceId }) =>
                Effect.sync(() => {
                  calls.push(`plan:${linkWorkspaceId}:${packageName}`);
                  return workspaceLinkPlan({ packageName, workspaceId: linkWorkspaceId });
                }),
            }),
          ),
          generatedPackageState(calls),
        );

        assert.deepStrictEqual(result, {
          scope: "app-global",
          packages: [
            { packageName: "@svvyx/extensions", action: "written" },
            {
              packageName: "@svvyx/workflows",
              action: "failed",
              diagnostics: ["workflow source invalid"],
            },
          ],
          workspaceLinks: [],
          recoveryWorkIds: [],
        });
        assert.deepStrictEqual(calls, [
          "build:@svvyx/extensions",
          "failure:@svvyx/workflows",
          "list-workspaces",
          `plan:${workspaceId}:@svvyx/extensions`,
          `link:${workspaceId}:@svvyx/extensions`,
        ]);
      }),
  );

  it.effect("records actual generated package build statuses", () =>
    Effect.gen(function* () {
      const buildInputs: unknown[] = [];
      const stateStatuses: unknown[] = [];
      const dependencies = [
        {
          specifier: "@svvy/core",
          importKind: "type-only",
          dependencyClass: "app-owned-type-contract",
          resolutionAuthority: "app-owned-type-contract",
          manifestDependency: "dev-type-dependency",
        },
        {
          specifier: "@svvyx/extensions",
          importKind: "runtime",
          dependencyClass: "generated-package",
          resolutionAuthority: "generated-package-link",
          manifestDependency: "none-generated-package-link",
          buildId: "gen_build_extensions_01" as GeneratedPackageBuildId,
        },
      ] satisfies readonly GeneratedPackageDependencyEvidence[];

      const result = yield* runRefresh(
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
                  workflowsExports: [],
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

      assert.deepStrictEqual(result, {
        scope: "app-global",
        packages: [
          { packageName: "@svvyx/extensions", action: "written" },
          { packageName: "@svvyx/workflows", action: "written", dependencies },
        ],
        workspaceLinks: [],
        recoveryWorkIds: [],
      });
      assert.deepStrictEqual(buildInputs, [
        { packages: ["@svvyx/extensions", "@svvyx/workflows"] },
      ]);
      assert.deepStrictEqual(stateStatuses, [
        {
          packageName: "@svvyx/extensions",
          action: "written",
          refreshScope: "app-global-build",
        },
        {
          packageName: "@svvyx/workflows",
          action: "written",
          dependencies,
          refreshScope: "app-global-build",
        },
      ]);
    }),
  );

  it.effect(
    "records @svvyx/extensions facts when workflows refresh rewrites the dependency package",
    () =>
      Effect.gen(function* () {
        const buildInputs: unknown[] = [];
        const stateStatuses: unknown[] = [];
        const publishedInvalidations: string[] = [];

        const result = yield* runRefresh(
          refreshRuntimeGeneratedPackages(
            {
              scope: "app-global",
              packages: ["@svvyx/workflows"],
              reason: "source-changed",
            },
            host({
              buildGeneratedPackages: (input) =>
                Effect.sync(() => {
                  buildInputs.push(input);
                  return {
                    packages: [
                      { packageName: "@svvyx/extensions", action: "written" },
                      { packageName: "@svvyx/workflows", action: "written" },
                    ],
                    workflowsExports: [],
                  };
                }),
              publishStateInvalidations: (afterCommit) =>
                Effect.sync(() => {
                  publishedInvalidations.push(
                    ...afterCommit.map((descriptor) =>
                      descriptor.scope === "app" ? descriptor.invalidation.model : "workspace",
                    ),
                  );
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

        assert.deepStrictEqual(result, {
          scope: "app-global",
          packages: [
            { packageName: "@svvyx/extensions", action: "written" },
            { packageName: "@svvyx/workflows", action: "written" },
          ],
          workspaceLinks: [],
          recoveryWorkIds: [],
        });
        assert.deepStrictEqual(buildInputs, [{ packages: ["@svvyx/workflows"] }]);
        assert.deepStrictEqual(stateStatuses, [
          {
            packageName: "@svvyx/extensions",
            action: "written",
            refreshScope: "app-global-build",
          },
          {
            packageName: "@svvyx/workflows",
            action: "written",
            refreshScope: "app-global-build",
          },
        ]);
        assert.deepStrictEqual(publishedInvalidations, ["extensions", "workflowsGenerated"]);
      }),
  );

  it.effect("refreshes @svvyx/extensions directly when Workflows is not requested", () =>
    Effect.gen(function* () {
      const result = yield* runRefresh(
        refreshRuntimeGeneratedPackages(
          {
            scope: "app-global",
            packages: ["@svvyx/extensions"],
            reason: "explicit-build",
          },
          host(),
        ),
      );

      assert.deepStrictEqual(
        result.packages.map(({ packageName, action }) => ({ packageName, action })),
        [{ packageName: "@svvyx/extensions", action: "written" }],
      );
    }),
  );

  it.effect("records failed package statuses", () =>
    Effect.gen(function* () {
      const stateCalls: string[] = [];

      const result = yield* runRefresh(
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

      assert.deepStrictEqual(result, {
        scope: "app-global",
        packages: [
          { packageName: "@svvyx/workflows", action: "failed", diagnostics: ["build failed"] },
        ],
        workspaceLinks: [],
        recoveryWorkIds: [],
      });
      assert.deepStrictEqual(stateCalls, ["failure:@svvyx/workflows"]);
    }),
  );

  it.effect("does not expose runtime scheduling lineage to the generated package build host", () =>
    Effect.gen(function* () {
      const buildInputs: unknown[] = [];

      yield* runRefresh(
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
                  workflowsExports: [],
                };
              }),
          }),
        ),
      );

      assert.deepStrictEqual(buildInputs, [{ packages: ["@svvyx/extensions"] }]);
    }),
  );

  it.effect(
    "repairs workspace links for each requested package without returning invalidations",
    () =>
      Effect.gen(function* () {
        const workspaceId = "workspace_runtime_generated_packages_01" as WorkspaceId;
        const plans: string[] = [];
        const linkCalls: string[] = [];
        const stateCalls: string[] = [];
        const linkEntries = new Map<string, FakeLinkEntry>([
          ["/workspace/.smithers", { kind: "directory" }],
          ["/generated/workflows", { kind: "directory" }],
          ["/generated/extensions", { kind: "directory" }],
        ]);

        const result = yield* runRefresh(
          refreshRuntimeGeneratedPackages(
            {
              scope: "workspace-link-repair",
              workspaceId,
              packages: ["@svvyx/workflows", "@svvyx/extensions"],
              reason: "link-repair",
            },
            host({
              buildGeneratedPackages: () =>
                Effect.sync(() => {
                  throw new Error("workspace-link-repair must not rebuild generated packages");
                }),
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

        assert.deepStrictEqual(result, {
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
        assert.deepStrictEqual(plans, ["@svvyx/workflows", "@svvyx/extensions"]);
        assert.deepStrictEqual(linkCalls, [
          "mkdir:/workspace/.smithers/node_modules/@svvyx",
          "symlink:/workspace/.smithers/node_modules/@svvyx/workflows->/generated/workflows",
          "mkdir:/workspace/.smithers/node_modules/@svvyx",
          "symlink:/workspace/.smithers/node_modules/@svvyx/extensions->/generated/extensions",
        ]);
        assert.deepStrictEqual(stateCalls, [
          `link:${workspaceId}:@svvyx/workflows`,
          `link:${workspaceId}:@svvyx/extensions`,
        ]);
      }),
  );
});
