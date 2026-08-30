import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  SandboxPolicyError,
  RuntimeGeneratedPackageStatePort,
  RuntimePromptDefaultsStatePort,
  RuntimeWorkspaceStatePort,
  RuntimeContractError,
  StateCommandPostCommitNotificationPort,
  StateContractError,
  type AbsolutePath,
  type BuildLaunchPolicyInput,
  type CommandId,
  type ExtensionExecutionPlanId,
  type GeneratedPackageBuildId,
  type GeneratedPackageBuildInput,
  type GeneratedPackageName,
  type IsoDateTimeString,
  type PromptExecutionContext,
  type RefreshGeneratedContextRequest,
  type RefreshGeneratedPackagesRequest,
  type RuntimeGeneratedPackageFactRecord,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimePromptDefaultsRecord,
  type RuntimePromptDefaultsStatePortService,
  type SandboxLaunchFacts,
  type SandboxPolicySnapshot,
  type StateCommandReceipt,
  type StateCommandPostCommitNotificationInput,
  type StateInvalidationDescriptor,
  type StateRevision,
  type SurfacePiSessionId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
  type WorkflowAgentSourceObservation,
} from "@svvy/core";
import {
  Extensions,
  type CommandInvocationContext,
  type ExtensionsService,
} from "@svvy/extensions";
import { Sandbox } from "@svvy/sandbox";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  layerRuntimeExecutionPlanExecutor,
  RuntimeExecutionPlanExecutor,
} from "./runtime-effect-requests";
import {
  layerRuntimeGeneratedContextRefreshService,
  RuntimeGeneratedContextRefreshHostPort,
  RuntimeGeneratedContextRefreshService,
} from "./runtime-generated-context-refresh-service";
import {
  layerRuntimeGeneratedPackageRefreshService,
  RuntimeGeneratedPackageRefreshHostPort,
  RuntimeGeneratedPackageRefreshService,
} from "./runtime-generated-package-refresh-service";
import {
  layerRuntimePromptDefaultsService,
  RuntimePromptDefaultsService,
} from "./runtime-prompt-defaults-service";
import {
  layerRuntimeLaunchPolicyService,
  RuntimeLaunchPolicyService,
} from "./runtime-launch-policy-service";
import {
  layerRuntimeQueueWakeService,
  RuntimeQueueWakeService,
} from "./runtime-queue-wake-service";
import { layerRuntimeQueueWakeBroker, RuntimeQueueWakeBroker } from "./runtime-queue-wake-broker";
import { layerStateCommandPostCommitNotificationPort } from "./state-command-post-commit-notification";
import {
  layerRuntimeAppLogCommitNotification,
  RuntimeAppLogCommitNotification,
} from "./runtime-app-log-commit-notification";
import {
  RuntimeWorkflowAgentSourceIndex,
  type RuntimeWorkflowAgentSourceIndexReconcileResult,
  type RuntimeWorkflowAgentSourceIndexService,
} from "./runtime-workflow-agent-source-index";
import {
  RuntimeShutdownAdmission,
  layerRuntimeShutdownAdmission,
} from "./runtime-shutdown-admission";

const workspaceId = "workspace_runtime_service_layers" as WorkspaceId;
const target = {
  workspaceSessionId: "wsess_runtime_service_layers" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_runtime_service_layers" as SurfacePiSessionId,
} as const;
const appInvalidation = {
  scope: "app",
  invalidation: { model: "extensions" },
} satisfies StateInvalidationDescriptor;

describe("runtime promoted service layers", () => {
  it.effect("resolves prompt defaults through the state port", () => {
    const calls: unknown[] = [];
    const defaults = {
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
    } satisfies RuntimePromptDefaultsRecord;

    return Effect.gen(function* () {
      const service = yield* RuntimePromptDefaultsService;
      const result = yield* service.resolve({ target });

      assert.deepStrictEqual(result, defaults);
      assert.deepStrictEqual(calls, [{ target }]);
    }).pipe(
      Effect.provide(layerRuntimePromptDefaultsService),
      Effect.provideService(RuntimePromptDefaultsStatePort, {
        resolvePromptDefaults: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return defaults;
          }),
        updatePromptDefaults: () => Effect.die("unused"),
      } satisfies RuntimePromptDefaultsStatePortService),
    );
  });

  it.effect("maps prompt-default state failures to runtime contract errors", () =>
    Effect.gen(function* () {
      const service = yield* RuntimePromptDefaultsService;
      const error = yield* service.resolve({ target }).pipe(Effect.flip);

      assert.strictEqual(error.operation, "runtime.promptDefaults.resolve");
      assert.strictEqual(error.reason, "stale-state");
      assert.match(error.message, /stored defaults failed/);
    }).pipe(
      Effect.provide(layerRuntimePromptDefaultsService),
      Effect.provideService(RuntimePromptDefaultsStatePort, {
        resolvePromptDefaults: () =>
          Effect.fail(
            new StateContractError({
              operation: "runtime.promptDefaults.resolve",
              reason: "transaction-failed",
              message: "stored defaults failed",
            }),
          ),
        updatePromptDefaults: () => Effect.die("unused"),
      } satisfies RuntimePromptDefaultsStatePortService),
    ),
  );

  it.effect("builds runtime launch policy through the sandbox service", () => {
    const calls: BuildLaunchPolicyInput[] = [];
    const input = testLaunchInput();
    const facts = testLaunchFacts();

    return Effect.gen(function* () {
      const service = yield* RuntimeLaunchPolicyService;
      const result = yield* service.build(input);

      assert.strictEqual(result, facts);
      assert.deepStrictEqual(calls, [input]);
    }).pipe(
      Effect.provide(layerRuntimeLaunchPolicyService),
      Effect.provideService(
        Sandbox,
        Sandbox.of({
          checkPathAccess: () => {
            throw new Error("checkPathAccess was not expected");
          },
          resolvePathAccess: () => Effect.die("resolvePathAccess was not expected"),
          buildLaunchPolicy: (request) =>
            Effect.sync(() => {
              calls.push(request);
              return facts;
            }),
          classifyDenial: () => Effect.die("classifyDenial was not expected"),
        }),
      ),
    );
  });

  it.effect("maps sandbox launch-policy failures to runtime contract errors", () =>
    Effect.gen(function* () {
      const service = yield* RuntimeLaunchPolicyService;
      const error = yield* service.build(testLaunchInput()).pipe(Effect.flip);

      assert.strictEqual(error.operation, "runtime.launchPolicy.build");
      assert.strictEqual(error.reason, "target-not-ready");
      assert.match(error.message, /sandbox helper missing/);
    }).pipe(
      Effect.provide(layerRuntimeLaunchPolicyService),
      Effect.provideService(
        Sandbox,
        Sandbox.of({
          checkPathAccess: () => {
            throw new Error("checkPathAccess was not expected");
          },
          resolvePathAccess: () => Effect.die("resolvePathAccess was not expected"),
          buildLaunchPolicy: () =>
            Effect.fail(
              new SandboxPolicyError({
                operation: "Sandbox.buildLaunchPolicy.helper",
                reason: "helper-unavailable",
                message: "sandbox helper missing",
              }),
            ),
          classifyDenial: () => Effect.die("classifyDenial was not expected"),
        }),
      ),
    ),
  );

  it.effect("wakes surface queues through the runtime dispatcher service", () => {
    const calls: unknown[] = [];

    return Effect.gen(function* () {
      const broker = yield* RuntimeQueueWakeBroker;
      const service = yield* RuntimeQueueWakeService;
      const shutdown = yield* RuntimeShutdownAdmission;
      yield* broker.register({
        acceptWakeHint: (input) =>
          Effect.sync(() => {
            calls.push(input);
          }),
      });

      yield* service.wakeSurface({ target, reason: "message-submitted" });

      assert.deepStrictEqual(calls, [{ workspaceId, target, reason: "message-submitted" }]);
      yield* shutdown.runShutdown(
        Effect.succeed({
          status: "drained",
          interruptedTurns: 0,
          interruptedCommands: 0,
          releasedQueueClaims: 0,
          recoveryRowsScheduled: 0,
        }),
      );
      const rejected = yield* service
        .wakeSurface({ target, reason: "message-submitted" })
        .pipe(Effect.flip);
      assert.strictEqual(rejected.reason, "runtime-shutdown");
      assert.strictEqual(calls.length, 1);
    }).pipe(
      Effect.provide(
        layerRuntimeQueueWakeService.pipe(
          Layer.provideMerge(layerRuntimeShutdownAdmission),
          Layer.provideMerge(layerRuntimeQueueWakeBroker),
        ),
      ),
      Effect.provideService(RuntimeWorkspaceStatePort, {
        resolvePromptTargetWorkspaceId: () => Effect.succeed(workspaceId),
        acquireWorkspace: () => Effect.die("unused"),
        acquireDefaultWorkspace: () => Effect.die("unused"),
        releaseWorkspace: () => Effect.die("unused"),
      }),
    );
  });

  it.effect("provides a typed runtime execution-plan executor lane", () =>
    Effect.gen(function* () {
      const service = yield* RuntimeExecutionPlanExecutor;
      const error = yield* service
        .execute({
          commandId: "command_runtime_service_layers" as CommandId,
          target,
          plan: {
            type: "file_effect.apply_patch",
            planId: "plan_runtime_service_layers" as ExtensionExecutionPlanId,
            cwd: "/workspace/runtime-service-layers" as AbsolutePath,
            patch: "*** Begin Patch\n*** Add File: noop.txt\n+noop\n*** End Patch\n",
          },
          invocationContext: {
            commandId: "command_runtime_service_layers" as CommandId,
            target,
            turnId: "turn_runtime_service_layers" as TurnId,
            approvalMode: "auto-review",
            sandbox: { snapshot: {} },
            cwd: "/workspace/runtime-service-layers",
            baseEnv: {},
          } satisfies CommandInvocationContext,
          promptExecutionContext: {
            workspaceSessionId: target.workspaceSessionId,
            turnId: "turn_runtime_service_layers",
            surfacePiSessionId: target.surfacePiSessionId,
            surfaceKind: "orchestrator",
            defaultEpisodeKind: "analysis",
            rootThreadId: null,
            rootEpisodeKind: "analysis",
            sessionWaitApplied: false,
            threadWasTerminalAtStart: false,
            loadedExtensionIds: ["ext_core"],
            availableExtensionIds: ["ext_core"],
            generatedAgentContextFingerprint: "fingerprint_runtime_service_layers",
            generatedAgentContextRevision: "revision_runtime_service_layers",
          } satisfies PromptExecutionContext,
        })
        .pipe(Effect.flip);

      assert.ok(error instanceof RuntimeContractError);
      assert.strictEqual(error.operation, "runtime.executionPlan.execute");
      assert.strictEqual(error.reason, "unsupported-operation");
      assert.match(error.message, /has no composed execution lane/);
    }).pipe(Effect.provide(layerRuntimeExecutionPlanExecutor)),
  );

  it.effect("refreshes generated context through the host port", () => {
    const calls: RefreshGeneratedContextRequest[] = [];
    const request = {
      scope: "workspace",
      workspaceId,
      reason: "extension-source-changed",
    } satisfies RefreshGeneratedContextRequest;

    return Effect.gen(function* () {
      const service = yield* RuntimeGeneratedContextRefreshService;

      yield* service.refresh(request);

      assert.deepStrictEqual(calls, [request]);
    }).pipe(
      Effect.provide(layerRuntimeGeneratedContextRefreshService),
      Effect.provideService(RuntimeGeneratedContextRefreshHostPort, {
        refresh: (input) => {
          calls.push(input);
          return Promise.resolve();
        },
      }),
    );
  });

  it.effect("maps generated-context host failures to runtime contract errors", () => {
    const request = {
      scope: "workspace",
      workspaceId,
      reason: "extension-source-changed",
    } satisfies RefreshGeneratedContextRequest;

    return Effect.gen(function* () {
      const service = yield* RuntimeGeneratedContextRefreshService;

      const error = yield* service.refresh(request).pipe(Effect.flip);

      assert.strictEqual(error.operation, "runtime.sourceInvalidation.refreshGeneratedContext");
      assert.strictEqual(error.reason, "state-conflict");
      assert.match(error.message, /generated context failed/);
    }).pipe(
      Effect.provide(layerRuntimeGeneratedContextRefreshService),
      Effect.provideService(RuntimeGeneratedContextRefreshHostPort, {
        refresh: () => Promise.reject(new Error("generated context failed")),
      }),
    );
  });

  it.effect("refreshes generated packages and publishes committed invalidations", () => {
    const built: Array<readonly GeneratedPackageName[]> = [];
    const published: StateInvalidationDescriptor[][] = [];
    const request = {
      scope: "app-global",
      packages: ["@svvyx/extensions"],
      reason: "source-changed",
    } satisfies RefreshGeneratedPackagesRequest;

    return Effect.gen(function* () {
      const service = yield* RuntimeGeneratedPackageRefreshService;

      const result = yield* service.refresh(request);

      assert.deepStrictEqual(built, [["@svvyx/extensions"]]);
      assert.deepStrictEqual(result, {
        scope: "app-global",
        packages: [{ packageName: "@svvyx/extensions", action: "written" }],
        workspaceLinks: [],
        recoveryWorkIds: [],
      });
      assert.deepStrictEqual(published, [[appInvalidation]]);
    }).pipe(
      Effect.provide(layerRuntimeGeneratedPackageRefreshService),
      Effect.provideService(
        Extensions,
        Extensions.of({
          generatedPackages: {
            refresh: (input: GeneratedPackageBuildInput) =>
              Effect.sync(() => {
                built.push(input.packages);
                return {
                  packages: input.packages.map((packageName) => ({
                    packageName,
                    action: "written" as const,
                  })),
                };
              }),
            planWorkspaceLink: () => Effect.die("Unexpected workspace link repair plan."),
          },
        } as unknown as ExtensionsService),
      ),
      Effect.provideService(RuntimeGeneratedPackageRefreshHostPort, {
        listAcquiredWorkspaceIds: () => Effect.succeed([]),
        listRecoverableWorkspaceIds: () => Effect.succeed([]),
        materializeCoreTypeContractPackage: () => Effect.void,
        now: () => Effect.succeed("2026-04-18T09:00:00.000Z" as IsoDateTimeString),
        workspaceLinkFileHost: {
          pathExists: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          readSymbolicLink: () => null,
          makeDirectory: () => {},
          remove: () => {},
          symlinkDirectory: () => {},
        },
      }),
      Effect.provideService(RuntimeGeneratedPackageStatePort, generatedPackageStatePort()),
      Effect.provideService(RuntimeEventBus, eventBus({ published })),
      Effect.provideService(RuntimeWorkflowAgentSourceIndex, workflowAgentSourceIndexService()),
    );
  });

  it.effect("materializes the core type-contract package before workflow package builds", () => {
    const calls: string[] = [];
    const published: StateInvalidationDescriptor[][] = [];
    const request = {
      scope: "app-global",
      packages: ["@svvyx/workflows"],
      reason: "source-changed",
    } satisfies RefreshGeneratedPackagesRequest;

    return Effect.gen(function* () {
      const service = yield* RuntimeGeneratedPackageRefreshService;

      const result = yield* service.refresh(request);

      assert.deepStrictEqual(calls, [
        "reconcile-workflow-agent-sources",
        "materialize-core-type-contract",
        "build:@svvyx/workflows",
        "list-workspaces",
      ]);
      assert.deepStrictEqual(result, {
        scope: "app-global",
        packages: [
          {
            packageName: "@svvyx/workflows",
            action: "written",
            buildId: "generated-workflows-build-runtime-service-layers" as GeneratedPackageBuildId,
          },
        ],
        workspaceLinks: [],
        recoveryWorkIds: [],
      });
    }).pipe(
      Effect.provide(layerRuntimeGeneratedPackageRefreshService),
      Effect.provideService(
        Extensions,
        Extensions.of({
          generatedPackages: {
            refresh: (input: GeneratedPackageBuildInput) =>
              Effect.sync(() => {
                calls.push(`build:${input.packages.join(",")}`);
                return {
                  packages: input.packages.map((packageName) => ({
                    packageName,
                    action: "written" as const,
                    buildId:
                      "generated-workflows-build-runtime-service-layers" as GeneratedPackageBuildId,
                  })),
                };
              }),
            planWorkspaceLink: () => Effect.die("Unexpected workspace link repair plan."),
          },
        } as unknown as ExtensionsService),
      ),
      Effect.provideService(RuntimeGeneratedPackageRefreshHostPort, {
        listAcquiredWorkspaceIds: () =>
          Effect.sync(() => {
            calls.push("list-workspaces");
            return [];
          }),
        listRecoverableWorkspaceIds: () => Effect.succeed([]),
        materializeCoreTypeContractPackage: () =>
          Effect.sync(() => {
            calls.push("materialize-core-type-contract");
          }),
        now: () => Effect.succeed("2026-04-18T09:00:00.000Z" as IsoDateTimeString),
        workspaceLinkFileHost: {
          pathExists: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          readSymbolicLink: () => null,
          makeDirectory: () => {},
          remove: () => {},
          symlinkDirectory: () => {},
        },
      }),
      Effect.provideService(RuntimeGeneratedPackageStatePort, generatedPackageStatePort()),
      Effect.provideService(RuntimeEventBus, eventBus({ published })),
      Effect.provideService(
        RuntimeWorkflowAgentSourceIndex,
        workflowAgentSourceIndexService(calls),
      ),
    );
  });

  it.effect("blocks workflow builds after a published source index reports invalid agents", () => {
    const calls: string[] = [];
    const published: StateInvalidationDescriptor[][] = [];
    const observedAt = "2026-04-18T09:00:00.000Z" as WorkflowAgentSourceObservation["observedAt"];
    const invalidObservation = {
      sourceId: "invalidAgent",
      path: "/tmp/svvy/workflows/agents/invalidAgent.agent.json" as AbsolutePath,
      sourceVersion: "invalid-agent-version",
      fingerprint: "invalid-agent-fingerprint",
      validationStatus: "invalid",
      diagnostics: [
        {
          severity: "error",
          code: "workflow_agent_model_unavailable",
          message: "Invalid model.",
        },
      ],
      parameters: null,
      extensionOrder: [],
      observedAt,
    } satisfies WorkflowAgentSourceObservation;

    return Effect.gen(function* () {
      const service = yield* RuntimeGeneratedPackageRefreshService;
      const result = yield* service.refresh({
        scope: "app-global",
        packages: ["@svvyx/workflows"],
        reason: "source-changed",
      });

      assert.deepStrictEqual(calls, ["reconcile-workflow-agent-sources"]);
      assert.deepStrictEqual(result, {
        scope: "app-global",
        packages: [
          {
            packageName: "@svvyx/workflows",
            action: "failed",
            diagnostics: [
              "Generated Workflows package build is blocked by invalid workflow-agent sources: invalidAgent.",
            ],
          },
        ],
        workspaceLinks: [],
        recoveryWorkIds: [],
      });
      assert.deepStrictEqual(published, [[appInvalidation]]);
    }).pipe(
      Effect.provide(layerRuntimeGeneratedPackageRefreshService),
      Effect.provideService(
        Extensions,
        Extensions.of({
          generatedPackages: {
            refresh: () =>
              Effect.sync(() => {
                calls.push("build");
                return { packages: [], workflowsExports: [] };
              }),
            planWorkspaceLink: () => Effect.die("unused"),
          },
        } as unknown as ExtensionsService),
      ),
      Effect.provideService(RuntimeGeneratedPackageRefreshHostPort, {
        listAcquiredWorkspaceIds: () => Effect.die("unused"),
        listRecoverableWorkspaceIds: () => Effect.succeed([]),
        materializeCoreTypeContractPackage: () =>
          Effect.sync(() => {
            calls.push("materialize");
          }),
        now: () => Effect.succeed(observedAt),
        workspaceLinkFileHost: {
          pathExists: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          readSymbolicLink: () => null,
          makeDirectory: () => {},
          remove: () => {},
          symlinkDirectory: () => {},
        },
      }),
      Effect.provideService(RuntimeGeneratedPackageStatePort, generatedPackageStatePort()),
      Effect.provideService(RuntimeEventBus, eventBus({ published })),
      Effect.provideService(RuntimeWorkflowAgentSourceIndex, {
        reconcile: Effect.sync(() => {
          calls.push("reconcile-workflow-agent-sources");
          return {
            sourceFingerprint: "invalid-workflow-agent-source-index",
            observations: [invalidObservation],
            diagnostics: [],
            scannedAt: observedAt,
          };
        }),
        scaffoldAndReconcile: Effect.die("unused"),
      }),
    );
  });

  it.effect("exposes state command post-commit notifications through the core port", () => {
    const published: StateInvalidationDescriptor[][] = [];
    const input = {
      operation: "state.commands.appLogs.markRead",
      receipt: stateCommandReceipt(12),
      descriptors: [appInvalidation],
    } satisfies StateCommandPostCommitNotificationInput;

    return Effect.gen(function* () {
      const service = yield* StateCommandPostCommitNotificationPort;
      const result = yield* service.notifyCommittedStateCommand(input);

      assert.deepStrictEqual(result, {
        receipt: input.receipt,
        acceptedDescriptorCount: 1,
        rebaselineRequired: false,
      });
      assert.deepStrictEqual(published, [[appInvalidation]]);
    }).pipe(
      Effect.provide(layerStateCommandPostCommitNotificationPort),
      Effect.provideService(RuntimeEventBus, eventBus({ published })),
    );
  });

  it.effect("maps committed app-log append scopes to runtime-owned invalidations", () => {
    const published: StateInvalidationDescriptor[][] = [];

    return Effect.gen(function* () {
      const notifications = yield* RuntimeAppLogCommitNotification;
      yield* notifications.notifyCommittedAppend({});
      yield* notifications.notifyCommittedAppend({ workspaceId });

      assert.deepStrictEqual(published, [
        [{ scope: "app", invalidation: { model: "appLogs" } }],
        [
          {
            scope: "workspace",
            workspaceId,
            invalidation: { model: "appLogs" },
          },
        ],
      ]);
    }).pipe(
      Effect.provide(layerRuntimeAppLogCommitNotification),
      Effect.provideService(RuntimeEventBus, eventBus({ published })),
    );
  });
});

function testLaunchInput(): BuildLaunchPolicyInput {
  return {
    scope: { kind: "workspace", workspaceId },
    commandId: "command_runtime_service_layers" as CommandId,
    launchKind: "direct_shell",
    command: ["bun"],
    cwd: "/workspace/runtime-service-layers" as AbsolutePath,
    envFacts: [],
  };
}

function testLaunchFacts(): SandboxLaunchFacts {
  const cwd = "/workspace/runtime-service-layers" as AbsolutePath;
  return {
    mode: "omitted_full_access",
    spawn: {
      executable: "/usr/bin/bun" as AbsolutePath,
      args: [],
      cwd,
      envFacts: [],
    },
    policySnapshot: testSandboxPolicySnapshot(),
  };
}

function testSandboxPolicySnapshot(): SandboxPolicySnapshot {
  const cwd = "/workspace/runtime-service-layers" as AbsolutePath;
  return {
    snapshotId: "snapshot_runtime_service_layers",
    fingerprint: "sandbox_fingerprint_runtime_service_layers",
    resolvedAt: "2026-06-23T00:00:00.000Z" as SandboxPolicySnapshot["resolvedAt"],
    scope: { kind: "workspace", workspaceId },
    commandId: "command_runtime_service_layers" as CommandId,
    launchKind: "direct_shell",
    cwd,
    sandboxMode: "omitted_full_access",
    networkPolicy: "deny",
    filesystemPolicy: {
      defaultAccess: "none",
      entries: [],
    },
  };
}

function workflowAgentSourceIndexService(
  calls?: string[],
): RuntimeWorkflowAgentSourceIndex["Service"] {
  const reconcile: RuntimeWorkflowAgentSourceIndexService["reconcile"] = Effect.sync(() => {
    calls?.push("reconcile-workflow-agent-sources");
    return {
      sourceFingerprint: "workflow-agent-source-index-test",
      observations: [],
      diagnostics: [],
      scannedAt:
        "2026-04-18T09:00:00.000Z" as unknown as RuntimeWorkflowAgentSourceIndexReconcileResult["scannedAt"],
    } as RuntimeWorkflowAgentSourceIndexReconcileResult;
  });
  return { reconcile, scaffoldAndReconcile: reconcile };
}

function generatedPackageStatePort(): RuntimeGeneratedPackageStatePortService {
  return {
    recordGeneratedPackageBuild: (input) =>
      Effect.succeed({
        value: generatedPackageFactRecord(input.status.packageName, "ready"),
        afterCommit: [appInvalidation],
      }),
    recordGeneratedPackageFailure: (input) =>
      Effect.succeed({
        value: generatedPackageFactRecord(input.status.packageName, "failed"),
        afterCommit: [appInvalidation],
      }),
    recordWorkspaceLinkStatus: () => Effect.die("Unexpected workspace link status record."),
    markWorkspaceLinksRepairNeeded: () =>
      Effect.die("Unexpected workspace link repair-needed record."),
    readLinksNeedingRepair: () => Effect.die("Unexpected links needing repair read."),
    readGeneratedPackageFacts: () => Effect.die("Unexpected generated package fact read."),
    reconcileGeneratedPackageManifest: () =>
      Effect.die("Unexpected generated package manifest reconcile."),
    markGeneratedPackageRefreshNeeded: () =>
      Effect.die("Unexpected generated package refresh-needed record."),
  };
}

function generatedPackageFactRecord(
  packageName: GeneratedPackageName,
  status: RuntimeGeneratedPackageFactRecord["status"],
): RuntimeGeneratedPackageFactRecord {
  return {
    packageName,
    status,
    buildId: null,
    manifestPath: null,
    sourceFingerprint: null,
    outputFingerprint: null,
    generatedFileListDigest: null,
    dependencies: [],
    diagnostics: [],
    sourceCommandId: null,
    refreshNeededReason: null,
    lastRecoveryWorkId: null,
    createdAt: "2026-04-18T09:00:00.000Z" as IsoDateTimeString,
    updatedAt: "2026-04-18T09:00:00.000Z" as IsoDateTimeString,
  };
}

function stateCommandReceipt(revision: number): StateCommandReceipt {
  return {
    clientRequestId: null,
    outcome: "applied",
    committedAt: "2026-04-18T09:00:00.000Z" as StateCommandReceipt["committedAt"],
    stateRevision: revision as StateRevision,
  };
}

function eventBus(input: {
  readonly published: StateInvalidationDescriptor[][];
}): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected live runtime event."),
    publishStateInvalidations: ({ afterCommit }) =>
      Effect.sync(() => {
        input.published.push([...afterCommit]);
        return [];
      }),
    subscribe: () => Effect.die("Unexpected runtime event subscription."),
  });
}
