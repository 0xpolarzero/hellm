import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import {
  AppLogWritePort,
  ExtensionStatePort,
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeEpisodeStatePort,
  RuntimeEventStreamError,
  RuntimeGeneratedPackageStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkflowTaskStatePort,
  RuntimeWorkspaceStatePort,
  RuntimePromptDefaultsStatePort,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  ProviderAuthPort,
  SandboxPolicySource,
  StateCommandPostCommitNotificationPort,
  StateContractError,
  type AbsolutePath,
  type AcquireWorkspaceInput,
  type AcquireWorkspaceResult,
  type AppLogEntryId,
  type CloseSurfaceInput,
  type CloseSurfaceResult,
  type CommandId,
  type CreateOrchestratorSurfaceInput,
  type CreateSurfaceResult,
  type FinishRuntimeCommandInput,
  type GeneratedPackageBuildInput,
  type GeneratedPackageBuildPlanResult,
  type GeneratedPackageName,
  type GeneratedPackagesRefreshResult,
  type IsoDateTimeString,
  type RefreshGeneratedContextRequest,
  type RefreshGeneratedPackagesRequest,
  type RuntimeEvent,
  type RuntimeEventGenerationId,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeEventSequence,
  type RuntimeGeneratedPackageFactRecord,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimePromptBindingRecord,
  type RuntimeThreadStatePortService,
  type RuntimeOwnerId,
  type SandboxPolicySourceService,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type StateCommandReceipt,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layer as PiAdapterLayer } from "@svvy/pi-adapter";
import {
  Extensions,
  layer,
  layerExtensionSourceRootsPort,
  layerGeneratedPackageRootPort,
  layerPackagedExtensionTemplatesPort,
  layerWorkspaceSourceLinkPort,
  type ExtensionsService,
} from "@svvy/extensions";
import { HostProcessReferencePort, SandboxHelperCandidatesPort } from "@svvy/sandbox";
import { Runtime } from "./index";
import { layerRuntimeBunPlatform } from "./bun-platform";
import {
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  RuntimeGeneratedContextRefreshHostPort,
  RuntimeGeneratedPackageRefreshHostPort,
  RuntimeLayerModelResolverPort,
  RuntimeLayerProviderAuthPort,
  RuntimeSourceInvalidationScanPort,
  makeRuntimeService,
  type RuntimeLayerCommandControlPortService,
} from "./runtime-layer";
import { RuntimeEventBus } from "./runtime-event-bus";
import { createRuntimeLayerConfigLayer, defaultRuntimeLayerConfig } from "./runtime-layer-config";
import { RuntimeShutdownPreparation, RuntimeStartupReadiness } from "./runtime-layer-config";
import { layerRuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import { RuntimePromptDefaultsService } from "./runtime-prompt-defaults-service";
import { RuntimeQueueWakeService } from "./runtime-queue-wake-service";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import { RuntimeSurfaceEventPublisher } from "./runtime-surface-event-publisher";
import {
  RuntimeWorkflowTaskAgentBridgeBearerVerifier,
  RuntimeWorkflowTaskAgentBridgeService,
} from "./workflow-task-agent-bridge-service";
import {
  makeRuntimeWorkspaceScopeService,
  RuntimeWorkspaceScopeService,
  runtimeWorkspaceScopeOwnerKey,
} from "./workspace-runtime-scope-service";
import { RuntimeSurfaceScopeService } from "./surface-runtime-scope-service";

const workspaceId = "workspace_runtime_layer_effect" as WorkspaceId;
const workspaceCwd = "/tmp/svvy-runtime-layer-effect" as AbsolutePath;
const workspaceSessionId = "wsess_runtime_layer_effect" as WorkspaceSessionId;
const surfacePiSessionId = "pi_orch_runtime_layer_effect" as SurfacePiSessionId;
const stateRevision = 1 as AcquireWorkspaceResult["stateRevision"];
const owner = {
  ownerId: "runtime_layer_effect_owner" as RuntimeOwnerId,
  kind: "test",
} as const;

const target = {
  workspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId,
} as const;

const workspaceInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "sessionNavigation" },
} satisfies StateInvalidationDescriptor;

const surfaceInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "surface", ids: [surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

const commandInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "commandInspector", ids: ["cmd_runtime_layer_effect" as CommandId] },
} satisfies StateInvalidationDescriptor;

function testExtensionsPackageDataLayer() {
  return Layer.mergeAll(
    testEffectPlatformLayer(),
    Layer.succeed(ExtensionStatePort, {
      records: {
        readSourceFingerprint: () => Effect.succeed(null),
      },
      dependencies: {
        isApproved: () => Effect.succeed(false),
        readReadiness: () => Effect.succeed(null),
      },
    }),
    layerExtensionSourceRootsPort({
      extensionsRoot: "/tmp/svvy-runtime-layer-effect/extensions" as AbsolutePath,
      workflowsSourceRoot: "/tmp/svvy-runtime-layer-effect/workflows" as AbsolutePath,
    }),
    layerPackagedExtensionTemplatesPort({
      builtinExtensionsRoot: "/tmp/svvy-runtime-layer-effect/packaged-extensions" as AbsolutePath,
    }),
    layerGeneratedPackageRootPort({
      extensionsPackageRoot: "/tmp/svvy-runtime-layer-effect/generated/extensions" as AbsolutePath,
      workflowsPackageRoot: "/tmp/svvy-runtime-layer-effect/generated/workflows" as AbsolutePath,
      coreTypeContractPackageRoot:
        "/tmp/svvy-runtime-layer-effect/generated/core-type-contract" as AbsolutePath,
    }),
    layerWorkspaceSourceLinkPort({
      generatedPackageLinkPath: ({ workspaceId: targetWorkspaceId, packageName }) =>
        Effect.succeed(
          `/tmp/svvy-runtime-layer-effect/workspaces/${targetWorkspaceId}/node_modules/${packageName}` as AbsolutePath,
        ),
    }),
  );
}

function testEffectPlatformLayer() {
  return Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, {} as unknown as FileSystem.FileSystem),
    Layer.succeed(Path.Path, {
      basename: (path: string) => path.split("/").at(-1) ?? path,
      dirname: (path: string) => {
        const parts = path.split("/");
        parts.pop();
        return parts.join("/") || "/";
      },
      join: (...segments: readonly string[]) => segments.join("/").replaceAll(/\/+/g, "/"),
    } as unknown as Path.Path),
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        digest: (_algorithm, data) => Effect.succeed(data),
        randomBytes: (size) => new Uint8Array(size).fill(1),
      }),
    ),
  );
}

function fakeRuntimeSurfaceScopeService() {
  return RuntimeSurfaceScopeService.of({
    create: () =>
      Effect.succeed({
        surfacePiSessionId,
        session: { surfacePiSessionId },
        withPromptLock: (effect) => effect,
        runPiTurn: () => Effect.die("unused"),
        interruptActivePrompt: () => Effect.void,
        isPromptActive: () => false,
        activePromptDone: () => null,
        installActivePrompt: () => Effect.void,
        clearActivePrompt: () => Effect.void,
      }),
    open: () =>
      Effect.succeed({
        surfacePiSessionId,
        session: { surfacePiSessionId },
        withPromptLock: (effect) => effect,
        runPiTurn: () => Effect.die("unused"),
        interruptActivePrompt: () => Effect.void,
        isPromptActive: () => false,
        activePromptDone: () => null,
        installActivePrompt: () => Effect.void,
        clearActivePrompt: () => Effect.void,
      }),
    retainOpen: () =>
      Effect.succeed({
        surfacePiSessionId,
        session: { surfacePiSessionId },
        withPromptLock: (effect) => effect,
        runPiTurn: () => Effect.die("unused"),
        interruptActivePrompt: () => Effect.void,
        isPromptActive: () => false,
        activePromptDone: () => null,
        installActivePrompt: () => Effect.void,
        clearActivePrompt: () => Effect.void,
      }),
    release: () => Effect.void,
    interrupt: () => Effect.void,
    snapshot: () => Effect.succeed([]),
  });
}

function fakeRuntimeActorExtensionBindingStatePort(): RuntimeActorExtensionBindingStatePortService {
  let binding: RuntimePromptBindingRecord | null = null;
  const makeBinding = (
    bindingTarget: RuntimePromptBindingRecord["target"],
  ): RuntimePromptBindingRecord => ({
    target: bindingTarget,
    generatedAgentContextBindingId: "binding_runtime_layer_effect",
    generatedAgentContextFingerprint:
      "ctx_runtime_layer_effect" as RuntimePromptBindingRecord["generatedAgentContextFingerprint"],
    generatedAgentContextRevision: 1,
    systemPrompt: "Runtime layer test prompt.",
    loadedExtensionIds: [],
    availableExtensionIds: [],
    externalSourceHashes: [],
    updateExtensionContextBeforeNextTurn: false,
  });
  return {
    readRuntimePromptBinding: (input) => Effect.succeed(binding ?? makeBinding(input.target)),
    updateActorExtensionBinding: (input) =>
      Effect.succeed({
        value: {
          bindingId: "binding_runtime_layer_effect",
          target: input.target,
          loadedExtensionIds: [],
          availableExtensionIds: [],
          generatedAgentContextFingerprint:
            "ctx_runtime_layer_effect" as RuntimePromptBindingRecord["generatedAgentContextFingerprint"],
          generatedAgentContextRevision: 1,
          externalSourceHashes: [],
          updateExtensionContextBeforeNextTurn: false,
          updatedAt: "2026-04-18T09:00:00.000Z" as IsoDateTimeString,
        } as never,
        afterCommit: [],
      }),
    setActorExtensionBinding: (input) =>
      Effect.sync(() => {
        binding = makeBinding(input.target);
        return {
          value: {
            bindingId: "binding_runtime_layer_effect",
            target: input.target,
            loadedExtensionIds: input.loadedExtensionIds,
            availableExtensionIds: input.availableExtensionIds,
            generatedAgentContextFingerprint: binding.generatedAgentContextFingerprint,
            generatedAgentContextRevision: binding.generatedAgentContextRevision,
            externalSourceHashes: [],
            updateExtensionContextBeforeNextTurn: false,
            updatedAt: "2026-04-18T09:00:00.000Z" as IsoDateTimeString,
          } as never,
          afterCommit: [],
        };
      }),
  };
}

function testPiAdapterHostLayer() {
  return Layer.mergeAll(
    PiAdapterLayer,
    Layer.succeed(ProviderAuthPort, {
      getProviderAuthSnapshot: () =>
        Effect.succeed({
          providerId: "openai" as never,
          health: "missing" as const,
        }),
      refreshProviderCredentialSnapshot: () =>
        Effect.succeed({
          providerId: "openai" as never,
          health: "missing" as const,
        }),
    }),
    Layer.succeed(PiRuntimePathsPort, {
      resolve: () =>
        Effect.succeed({
          workspaceId,
          cwd: workspaceCwd,
          agentDir: "/tmp/svvy-runtime-layer-effect/agent" as AbsolutePath,
          sessionDir: "/tmp/svvy-runtime-layer-effect/sessions" as AbsolutePath,
          modelRegistryPath: "/tmp/svvy-runtime-layer-effect/model-registry.json" as AbsolutePath,
          source: "test-fixture" as const,
        }),
    }),
    Layer.succeed(PiSessionReferencePort, {
      getPiSessionReference: () => Effect.succeed(undefined),
      savePiSessionReference: (input) =>
        Effect.succeed({ value: input.reference, afterCommit: [] }),
      deletePiSessionReference: (input) =>
        Effect.succeed({
          value: { surfacePiSessionId: input.surfacePiSessionId },
          afterCommit: [],
        }),
      validatePiSessionReference: (input) =>
        Effect.succeed({
          valid: true as const,
          reference:
            input.reference ??
            ({
              surfacePiSessionId: input.surfacePiSessionId,
              referenceFingerprint: "test",
              adapterKind: "test",
              adapterVersion: "test",
              storageLocator: "/tmp/test.jsonl",
            } as never),
          referenceFingerprint: "test",
        }),
    }),
  );
}

describe("@svvy/runtime Runtime.layer", () => {
  it.effect("tracks live workspace scope owners without duplicating durable state facts", () =>
    Effect.gen(function* () {
      const workspaceScopes = yield* makeRuntimeWorkspaceScopeService();
      const secondOwner = {
        ownerId: "runtime_layer_effect_owner_2" as RuntimeOwnerId,
        kind: "test" as const,
      };

      yield* workspaceScopes.acquire({ workspaceId, owner });
      yield* workspaceScopes.acquire({ workspaceId, owner });
      yield* workspaceScopes.acquire({ workspaceId, owner: secondOwner });

      assert.deepStrictEqual(yield* workspaceScopes.snapshot(), [
        {
          workspaceId,
          owners: [
            runtimeWorkspaceScopeOwnerKey(owner),
            runtimeWorkspaceScopeOwnerKey(secondOwner),
          ].toSorted(),
        },
      ]);

      yield* workspaceScopes.release({
        workspaceId,
        owner,
        remainingOwners: 1,
        lifecycle: "active",
      });

      assert.deepStrictEqual(yield* workspaceScopes.snapshot(), [
        {
          workspaceId,
          owners: [runtimeWorkspaceScopeOwnerKey(secondOwner)],
        },
      ]);

      yield* workspaceScopes.release({
        workspaceId,
        owner: secondOwner,
        remainingOwners: 0,
        lifecycle: "idle",
      });

      assert.deepStrictEqual(yield* workspaceScopes.snapshot(), []);
    }),
  );

  it.effect(
    "updates runtime-owned workspace scopes after committed workspace state mutations",
    () => {
      const published: StateInvalidationDescriptor[][] = [];
      const scopeActions: string[] = [];
      const secondOwner = {
        ownerId: "runtime_layer_effect_owner_2" as RuntimeOwnerId,
        kind: "test" as const,
      };

      return Effect.gen(function* () {
        const runtime = yield* Runtime;

        yield* runtime.workspaces.acquire({
          cwd: workspaceCwd,
          owner,
          openReason: "test",
        });
        yield* runtime.workspaces.acquire({
          cwd: workspaceCwd,
          owner: secondOwner,
          openReason: "test",
        });
        yield* runtime.workspaces.release({
          workspaceId,
          owner,
          releaseReason: "test",
        });
        yield* runtime.workspaces.release({
          workspaceId,
          owner: secondOwner,
          releaseReason: "test",
        });

        assert.deepStrictEqual(scopeActions, [
          `acquire:${workspaceId}:${runtimeWorkspaceScopeOwnerKey(owner)}`,
          `acquire:${workspaceId}:${runtimeWorkspaceScopeOwnerKey(secondOwner)}`,
          `release:${workspaceId}:${runtimeWorkspaceScopeOwnerKey(owner)}:1:active`,
          `release:${workspaceId}:${runtimeWorkspaceScopeOwnerKey(secondOwner)}:0:idle`,
        ]);
        assert.deepStrictEqual(published, [
          [workspaceInvalidation],
          [workspaceInvalidation],
          [workspaceInvalidation],
          [workspaceInvalidation],
        ]);
      }).pipe(
        Effect.provide(
          testRuntimeLayer({
            published,
            releaseResults: [
              {
                remainingOwners: 1,
                lifecycle: "active",
              },
              {
                remainingOwners: 0,
                lifecycle: "idle",
              },
            ],
            workspaceScopeActions: scopeActions,
          }),
        ),
      );
    },
  );

  it.effect(
    "routes workspace and surface lifecycle through state ports and publishes after-commit invalidations",
    () => {
      const published: StateInvalidationDescriptor[][] = [];
      const livePublished: RuntimeEvent[] = [];
      const surfaceEventActions: string[] = [];
      const acquired: AcquireWorkspaceInput[] = [];
      const createdSurfaces: CreateOrchestratorSurfaceInput[] = [];
      const closedSurfaces: CloseSurfaceInput[] = [];

      return Effect.gen(function* () {
        const runtime = yield* Runtime;

        const workspaceInput = {
          cwd: workspaceCwd,
          owner,
          openReason: "test",
        } satisfies AcquireWorkspaceInput;
        const createSurfaceInput = {
          workspaceId,
          title: "Runtime layer Effect test",
        } satisfies CreateOrchestratorSurfaceInput;

        const acquiredWorkspace = yield* runtime.workspaces.acquire(workspaceInput);
        const createdSurface = yield* runtime.surfaces.createOrchestrator(createSurfaceInput);
        const openedSurface = yield* runtime.surfaces.open({
          workspaceId,
          target: surfaceResult.target,
        });
        const closeSurfaceInput = {
          workspaceId,
          target: surfaceResult.target,
          closeReason: "test",
        } satisfies CloseSurfaceInput;
        const closedSurface = yield* runtime.surfaces.close(closeSurfaceInput);

        assert.deepStrictEqual(acquired, [workspaceInput]);
        assert.deepStrictEqual(createdSurfaces, [createSurfaceInput]);
        assert.deepStrictEqual(closedSurfaces, [closeSurfaceInput]);
        assert.deepStrictEqual(acquiredWorkspace, workspaceResult("created"));
        assert.deepStrictEqual(createdSurface, surfaceResult);
        assert.deepStrictEqual(openedSurface, {
          workspaceSessionId,
          surfacePiSessionId,
          target: surfaceResult.target,
          stateRevision,
        });
        assert.deepStrictEqual(closedSurface, {
          target: surfaceResult.target,
          lifecycle: "idle",
        });
        assert.deepStrictEqual(published, [
          [workspaceInvalidation],
          [surfaceInvalidation],
          [surfaceInvalidation],
          [surfaceInvalidation],
        ]);
        assert.deepStrictEqual(surfaceEventActions, [
          "changed:surface.updated",
          "reset:surface_reopened",
          "changed:surface.updated",
          "changed:surface.closed",
        ]);
        assert.deepStrictEqual(livePublished, [
          {
            type: "surface.changed",
            eventGenerationId: "runtime_layer_live_event_generation" as RuntimeEventGenerationId,
            sequence: 1 as RuntimeEventSequence,
            workspaceId,
            target: surfaceResult.target,
            reason: "surface.updated",
          },
          {
            type: "surface.changed",
            eventGenerationId: "runtime_layer_live_event_generation" as RuntimeEventGenerationId,
            sequence: 2 as RuntimeEventSequence,
            workspaceId,
            target: surfaceResult.target,
            reason: "surface.updated",
          },
          {
            type: "surface.changed",
            eventGenerationId: "runtime_layer_live_event_generation" as RuntimeEventGenerationId,
            sequence: 3 as RuntimeEventSequence,
            workspaceId,
            target: surfaceResult.target,
            reason: "surface.closed",
          },
        ]);
      }).pipe(
        Effect.provide(
          testRuntimeLayer({
            published,
            livePublished,
            surfaceEventActions,
            onAcquireWorkspace: (input) => {
              acquired.push(input);
              return workspaceResult("created");
            },
            onCreateSurface: (input) => {
              createdSurfaces.push(input);
              return surfaceResult;
            },
            onCloseSurface: (input) => {
              closedSurfaces.push(input);
              return {
                target: input.target,
                lifecycle: "idle",
              };
            },
          }),
        ),
      );
    },
  );

  it.effect(
    "maps state-port failures to public RuntimeContractError without publishing invalidations",
    () =>
      Effect.gen(function* () {
        const runtime = yield* Runtime;
        const failure = yield* runtime.workspaces
          .acquire({
            cwd: workspaceCwd,
            owner,
            openReason: "test",
          })
          .pipe(Effect.flip);

        assert.instanceOf(failure, RuntimeContractError);
        assert.deepInclude(failure, {
          operation: "runtime.workspaces.acquire",
          reason: "stale-state",
        });
      }).pipe(
        Effect.provide(
          testRuntimeLayer({
            published: [],
            failAcquireWorkspace: new StateContractError({
              operation: "runtime-layer-effect.acquire",
              reason: "stale-state",
              message: "Workspace owner is stale.",
            }),
          }),
        ),
      ),
  );

  it.effect("cancels running commands through live control before terminalizing state", () => {
    const published: StateInvalidationDescriptor[][] = [];
    const cancelledCommands: CommandId[] = [];
    const finishedCommands: FinishRuntimeCommandInput[] = [];

    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      const result = yield* runtime.commands.cancel({
        commandId: "cmd_runtime_layer_effect" as CommandId,
        reason: "test cancellation",
      });

      assert.deepStrictEqual(result, {
        commandId: "cmd_runtime_layer_effect",
        status: "cancelled",
      });
      assert.deepStrictEqual(cancelledCommands, ["cmd_runtime_layer_effect"]);
      assert.deepStrictEqual(finishedCommands, [
        {
          commandId: "cmd_runtime_layer_effect",
          status: "cancelled",
          summary: "Command cancelled: test cancellation",
          facts: { cancelReason: "test cancellation", requestedBy: null },
          error: "test cancellation",
        },
      ]);
      assert.deepStrictEqual(published, [[commandInvalidation]]);
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published,
          commandRecord: runtimeCommandRecord("running"),
          onCancelCommand: (input) => {
            cancelledCommands.push(input.commandId);
            return { commandId: input.commandId, status: "cancelled" as const };
          },
          onFinishCommand: (input) => {
            finishedCommands.push(input);
            return runtimeCommandRecord(input.status);
          },
        }),
      ),
    );
  });

  it.effect("does not call live control or publish invalidations for terminal commands", () => {
    const published: StateInvalidationDescriptor[][] = [];
    const cancelledCommands: CommandId[] = [];

    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      const result = yield* runtime.commands.cancel({
        commandId: "cmd_runtime_layer_effect" as CommandId,
      });

      assert.deepStrictEqual(result, {
        commandId: "cmd_runtime_layer_effect",
        status: "already_terminal",
      });
      assert.deepStrictEqual(cancelledCommands, []);
      assert.deepStrictEqual(published, []);
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published,
          commandRecord: runtimeCommandRecord("succeeded"),
          onCancelCommand: (input) => {
            cancelledCommands.push(input.commandId);
            return { commandId: input.commandId, status: "cancelled" as const };
          },
        }),
      ),
    );
  });

  it.effect("provides source invalidation hint and reconcile APIs through the root layer", () => {
    const hints: SourceInvalidationHint[] = [];
    const reconciliations: SourceReconcileRequest[] = [];
    const hint = {
      scope: { kind: "app-global" },
      domain: "extensions",
      path: "/tmp/svvy-runtime-layer-effect/extensions/web/index.ts" as AbsolutePath,
      observedAt: "2026-04-18T09:04:00.000Z" as NonNullable<SourceInvalidationHint["observedAt"]>,
    } satisfies SourceInvalidationHint;
    const reconcile = {
      scope: { kind: "workspace", workspaceId },
      domains: ["external_instructions", "host_snippets"],
      reason: "manual",
    } satisfies SourceReconcileRequest;

    return Effect.gen(function* () {
      const runtime = yield* Runtime;

      yield* runtime.sourceInvalidation.hint(hint);
      const result = yield* runtime.sourceInvalidation.reconcile(reconcile);

      assert.deepStrictEqual(hints, [hint]);
      assert.deepStrictEqual(reconciliations, [hintToReconcileRequest(hint), reconcile]);
      assert.deepStrictEqual(result, {
        changedReadModelCount: 0,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      });
    }).pipe(
      Effect.provide(
        testRuntimeRootLayer({
          onClassifySourceInvalidationHint: (input) => {
            hints.push(input);
            return "scan";
          },
          onReconcileSourceInvalidation: (input) => {
            reconciliations.push(input);
            return null;
          },
        }),
      ),
    );
  });

  it.effect("provides explicit source refresh APIs through the root layer", () => {
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const builtPackages: GeneratedPackageBuildPlanResult[] = [];
    const contextRefresh = {
      scope: "workspace",
      workspaceId,
      reason: "extension-source-changed",
    } satisfies RefreshGeneratedContextRequest;
    const packageRefresh = {
      scope: "app-global",
      packages: ["@svvyx/extensions"],
      reason: "source-changed",
    } satisfies RefreshGeneratedPackagesRequest;

    return Effect.gen(function* () {
      const runtime = yield* Runtime;

      yield* runtime.sourceInvalidation.refreshGeneratedContext(contextRefresh);
      const result = yield* runtime.sourceInvalidation.refreshGeneratedPackages(packageRefresh);

      assert.deepStrictEqual(contextRefreshes, [contextRefresh]);
      assert.deepStrictEqual(builtPackages, [
        {
          packages: [
            {
              packageName: "@svvyx/extensions",
              action: "written",
            },
          ],
          workflowsExports: [],
        },
      ]);
      assert.deepStrictEqual(result, {
        scope: "app-global",
        packages: [
          {
            packageName: "@svvyx/extensions",
            action: "written",
          },
        ],
        workspaceLinks: [],
        recoveryWorkIds: [],
      } satisfies GeneratedPackagesRefreshResult);
    }).pipe(
      Effect.provide(
        testRuntimeRootLayer({
          onRefreshGeneratedContext: (input) => {
            contextRefreshes.push(input);
          },
          onBuildGeneratedPackages: (input) => {
            const result = {
              packages: input.packages.map((packageName) => ({
                packageName,
                action: "written" as const,
              })),
              workflowsExports: [],
            };
            builtPackages.push(result);
            return result;
          },
          acquiredWorkspaceIds: [],
          recoverableWorkspaceIds: [],
        }),
      ),
    );
  });

  it.effect("provides the state command post-commit notification port through the root layer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* Runtime;
        const notifications = yield* StateCommandPostCommitNotificationPort;
        const subscription = yield* runtime.events({});
        const published = subscription.stream.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.map((chunk) => Array.from(chunk)),
          Effect.forkScoped,
        );

        const result = yield* notifications.notifyCommittedStateCommand({
          operation: "stateCommands.appLogs.markRead",
          receipt: {
            clientRequestId: "runtime-layer-state-command-post-commit",
            outcome: "applied",
            committedAt: "2026-04-18T09:02:00.000Z" as StateCommandReceipt["committedAt"],
            stateRevision,
          },
          descriptors: [workspaceInvalidation],
        });
        const events = yield* Fiber.join(yield* published);

        assert.deepStrictEqual(result, {
          receipt: {
            clientRequestId: "runtime-layer-state-command-post-commit",
            outcome: "applied",
            committedAt: "2026-04-18T09:02:00.000Z" as StateCommandReceipt["committedAt"],
            stateRevision,
          },
          acceptedDescriptorCount: 1,
          rebaselineRequired: false,
        });
        assert.deepStrictEqual(
          events.map((event) => event.type),
          ["workspace_read_model.changed"],
        );
      }).pipe(Effect.provide(testRuntimeRootLayer())),
    ),
  );

  it.effect("provides runtime-owned startup readiness through the root layer", () =>
    Effect.gen(function* () {
      const readiness = yield* RuntimeStartupReadiness;
      const receipt = yield* readiness.awaitReady;

      assert.strictEqual(receipt.status, "ready");
      assert.deepStrictEqual(receipt.completedPhases, [
        "layer-acquisition",
        "recovery-startup-scan",
        "event-bus",
      ]);
      assert.deepStrictEqual(receipt.degradedPhases, []);
      assert.match(receipt.readyAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }).pipe(Effect.provide(testRuntimeRootLayer())),
  );

  it.effect("provides runtime-owned shutdown preparation through the root layer", () =>
    Effect.gen(function* () {
      const shutdown = yield* RuntimeShutdownPreparation;
      const result = yield* shutdown.prepareShutdown({
        reason: "app-shutdown",
        requestedAt: "2026-04-18T09:03:00.000Z",
        drainTimeoutMs: defaultRuntimeLayerConfig.runtimeShutdownDrainTimeoutMs,
      });

      assert.deepStrictEqual(result, {
        status: "drained",
        interruptedTurns: 0,
        interruptedCommands: 0,
        releasedQueueClaims: 0,
        recoveryRowsScheduled: 0,
      });
    }).pipe(Effect.provide(testRuntimeRootLayer())),
  );
});

interface TestLayerOverrides {
  readonly published: StateInvalidationDescriptor[][];
  readonly livePublished?: RuntimeEvent[];
  readonly surfaceEventActions?: string[];
  readonly onAcquireWorkspace?: (input: AcquireWorkspaceInput) => AcquireWorkspaceResult;
  readonly onCreateSurface?: (input: CreateOrchestratorSurfaceInput) => CreateSurfaceResult;
  readonly onCloseSurface?: (input: CloseSurfaceInput) => CloseSurfaceResult;
  readonly failAcquireWorkspace?: StateContractError;
  readonly commandRecord?: RuntimeCommandRecord | null;
  readonly onCancelCommand?: (
    input: Parameters<RuntimeLayerCommandControlPortService["cancel"]>[0],
  ) => {
    readonly commandId: CommandId;
    readonly status: "cancelling" | "cancelled" | "already_terminal";
  };
  readonly onFinishCommand?: (input: FinishRuntimeCommandInput) => RuntimeCommandRecord;
  readonly releaseResults?: Array<{
    readonly remainingOwners: number;
    readonly lifecycle: "active" | "idle" | "disposed";
  }>;
  readonly workspaceScopeActions?: string[];
}

function testRuntimeLayer(overrides: TestLayerOverrides) {
  const eventBus = RuntimeEventBus.of({
    publishLive: (input) =>
      Effect.sync(() => {
        const event = {
          ...input.event,
          eventGenerationId: "runtime_layer_live_event_generation" as RuntimeEventGenerationId,
          sequence: ((overrides.livePublished?.length ?? 0) + 1) as RuntimeEventSequence,
        } satisfies RuntimeEvent;
        overrides.livePublished?.push(event);
        return event;
      }),
    publishStateInvalidations: (input) =>
      Effect.sync(() => {
        overrides.published.push([...input.afterCommit]);
        return [];
      }),
    subscribe: () =>
      Effect.fail(
        new RuntimeEventStreamError({
          operation: "runtime.events",
          reason: "stream-failed",
          message: "unused",
          latestSequence: 0 as RuntimeEventSequence,
        }),
      ),
  });
  const releaseResults = [...(overrides.releaseResults ?? [])];
  return Layer.effect(Runtime, makeRuntimeService()).pipe(
    Layer.provide(Layer.succeed(RuntimeEventBus, eventBus)),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RuntimePromptDefaultsStatePort, {
          resolvePromptDefaults: () =>
            Effect.succeed({
              provider: "openai",
              model: "gpt-4o",
              reasoningEffort: "medium" as const,
            }),
        }),
        Layer.succeed(RuntimeLayerProviderAuthPort, {
          ensureUsableProviderAuth: () => Effect.succeed("test-api-key"),
          getProviderAuthUnavailableMessage: () => "Provider auth unavailable.",
        }),
        Layer.succeed(RuntimeLayerModelResolverPort, {
          resolveModelId: () => Effect.succeed("gpt-4o"),
        }),
        Layer.succeed(AppLogWritePort, {
          append: () =>
            Effect.succeed({
              value: { appLogEntryId: "app_log_runtime_layer_effect" as AppLogEntryId },
              afterCommit: [],
            }),
        }),
        layer.pipe(Layer.provide(testExtensionsPackageDataLayer())),
        testExtensionsPackageDataLayer(),
        Layer.succeed(RuntimePromptDefaultsService, {
          resolve: () =>
            Effect.succeed({
              provider: "openai",
              model: "gpt-4o",
              reasoningEffort: "medium" as const,
            }),
        }),
        Layer.succeed(RuntimeQueueWakeService, {
          wakeSurface: () => Effect.void,
        }),
        Layer.succeed(RuntimeWorkflowTaskAgentBridgeService, {
          runTaskAgent: () => Effect.die("unused"),
        }),
        Layer.succeed(RuntimeWorkflowTaskAgentBridgeBearerVerifier, {
          verify: () => Effect.succeed(true),
        }),
        Layer.succeed(RuntimeSurfaceScopeService, fakeRuntimeSurfaceScopeService()),
        Layer.succeed(
          RuntimeActorExtensionBindingStatePort,
          fakeRuntimeActorExtensionBindingStatePort(),
        ),
        Layer.succeed(RuntimeSourceInvalidationService, {
          hint: () => Effect.void,
          reconcile: () =>
            Effect.succeed({
              changedReadModelCount: 0,
              generatedPackageRefreshes: [],
              recoveryWorkIds: [],
            }),
          applyCommittedScanEvent: () =>
            Effect.succeed({
              changedReadModelCount: 0,
              generatedPackageRefreshes: [],
              recoveryWorkIds: [],
            }),
          refreshGeneratedContext: () => Effect.void,
          refreshGeneratedPackages: () =>
            Effect.succeed({
              scope: "app-global" as const,
              packages: [],
              workspaceLinks: [],
              recoveryWorkIds: [],
            }),
        }),
        Layer.succeed(RuntimeSurfaceEventPublisher, {
          publishSurfaceChanged: (input) =>
            Effect.sync(() => {
              overrides.surfaceEventActions?.push(`changed:${input.reason}`);
            }).pipe(
              Effect.andThen(
                eventBus.publishLive({
                  event: {
                    type: "surface.changed" as const,
                    workspaceId: input.workspaceId,
                    target: input.target,
                    reason: input.reason,
                  },
                }),
              ),
            ),
          publishStreamPatch: () =>
            Effect.die("RuntimeSurfaceEventPublisher.publishStreamPatch was not expected"),
          resetSurfaceStream: (input) =>
            Effect.sync(() => {
              overrides.surfaceEventActions?.push(`reset:${input.reason}`);
              return {
                type: "surface.stream",
                workspaceId: input.workspaceId,
                target: input.target,
                streamGenerationId: input.streamGenerationId,
                streamSequence: 1 as RuntimeEventSequence,
                patch: {
                  type: "stream_reset",
                  reason: input.reason,
                  latestStreamSequence: null,
                },
              } as unknown as RuntimeEvent;
            }),
        }),
        layerRuntimeApprovalWaitService,
        Layer.succeed(RuntimeRequestInputWaitService, noRequestInputWaitService()),
        layerRuntimeBunPlatform,
        testPiAdapterHostLayer(),
        Layer.succeed(RuntimeGeneratedContextRefreshHostPort, {
          refresh: () => Promise.resolve(),
        }),
        Layer.succeed(RuntimeGeneratedPackageRefreshHostPort, {
          listAcquiredWorkspaceIds: () => Effect.succeed([workspaceId]),
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
        Layer.succeed(RuntimeSourceInvalidationScanPort, {
          classifyHint: () => Effect.succeed("scan" as const),
          listAcquiredWorkspaceIds: () => Effect.succeed([workspaceId]),
          requestScan: () => Effect.void,
          reconcile: () => Effect.succeed(null),
        }),
        Layer.succeed(RuntimeLayerCommandStdinPort, {
          writeStdin: () =>
            Effect.succeed({
              commandId: "cmd_unused" as CommandId,
              status: "already_terminal" as const,
            }),
        }),
        Layer.succeed(RuntimeLayerCommandControlPort, {
          cancel: (input) =>
            Effect.sync(
              () =>
                overrides.onCancelCommand?.(input) ?? {
                  commandId: input.commandId,
                  status: "already_terminal" as const,
                },
            ),
        }),
        Layer.succeed(RuntimeWorkspaceScopeService, {
          acquire: (input) =>
            Effect.sync(() => {
              overrides.workspaceScopeActions?.push(
                `acquire:${input.workspaceId}:${runtimeWorkspaceScopeOwnerKey(input.owner)}`,
              );
            }),
          release: (input) =>
            Effect.sync(() => {
              overrides.workspaceScopeActions?.push(
                `release:${input.workspaceId}:${runtimeWorkspaceScopeOwnerKey(input.owner)}:${input.remainingOwners}:${input.lifecycle}`,
              );
            }),
          snapshot: () => Effect.succeed([]),
        }),
        Layer.succeed(RuntimeWorkspaceStatePort, {
          acquireWorkspace: (input) => {
            if (overrides.failAcquireWorkspace) {
              return Effect.fail(overrides.failAcquireWorkspace);
            }
            return Effect.sync(() => ({
              value: overrides.onAcquireWorkspace?.(input) ?? workspaceResult("existing"),
              afterCommit: [workspaceInvalidation],
            }));
          },
          acquireDefaultWorkspace: () =>
            Effect.succeed({
              value: { ...workspaceResult("existing"), kind: "default" as const },
              afterCommit: [workspaceInvalidation],
            }),
          releaseWorkspace: (input) =>
            Effect.sync(() => {
              const releaseResult = releaseResults.shift() ?? {
                remainingOwners: 0,
                lifecycle: "idle" as const,
              };
              return {
                value: {
                  workspaceId: input.workspaceId,
                  released: true as const,
                  remainingOwners: releaseResult.remainingOwners,
                  lifecycle: releaseResult.lifecycle,
                },
                afterCommit: [workspaceInvalidation],
              };
            }),
        }),
        Layer.succeed(RuntimeSurfaceLifecycleStatePort, {
          createOrchestratorSurface: (input) =>
            Effect.sync(() => ({
              value: overrides.onCreateSurface?.(input) ?? surfaceResult,
              afterCommit: [surfaceInvalidation],
            })),
          openSurface: (input) =>
            Effect.succeed({
              value: {
                workspaceSessionId: input.target.workspaceSessionId,
                surfacePiSessionId: input.target.surfacePiSessionId,
                target: input.target,
                stateRevision,
              },
              afterCommit: [surfaceInvalidation],
            }),
          closeSurface: (input) =>
            Effect.sync(() => ({
              value: overrides.onCloseSurface?.(input) ?? {
                target: input.target,
                lifecycle: "idle" as const,
              },
              afterCommit: [surfaceInvalidation],
            })),
        }),
        Layer.succeed(RuntimeSourceStatePort, {
          readSourceVersion: () => Effect.succeed(null),
          recordSourceSave: () => Effect.die("unused"),
          recordSourceDelete: () => Effect.die("unused"),
          recordSourceScan: () => Effect.die("unused"),
          reconcileDiscoveredHostSnippets: () => Effect.die("unused"),
          recordObservedSourceDeletion: () => Effect.die("unused"),
          recordSourceDiagnostic: () => Effect.die("unused"),
        }),
        Layer.succeed(RuntimeQueueStatePort, unusedPort("RuntimeQueueStatePort")),
        Layer.succeed(RuntimeRequestStatePort, unusedPort("RuntimeRequestStatePort")),
        Layer.succeed(RuntimeApprovalStatePort, emptyApprovalStatePort()),
        Layer.succeed(RuntimeCommandStatePort, testRuntimeCommandStatePort(overrides)),
        Layer.succeed(
          RuntimeGeneratedPackageStatePort,
          unusedPort("RuntimeGeneratedPackageStatePort"),
        ),
        Layer.succeed(RuntimeSessionWaitStatePort, unusedPort("RuntimeSessionWaitStatePort")),
        Layer.succeed(RuntimeTurnStatePort, unusedPort("RuntimeTurnStatePort")),
        Layer.succeed(RuntimeEpisodeStatePort, unusedPort("RuntimeEpisodeStatePort")),
      ),
    ),
  );
}

interface TestRootLayerOverrides {
  readonly acquiredWorkspaceIds?: readonly WorkspaceId[];
  readonly recoverableWorkspaceIds?: readonly WorkspaceId[];
  readonly onBuildGeneratedPackages?: (input: {
    readonly packages: readonly GeneratedPackageName[];
  }) => GeneratedPackageBuildPlanResult;
  readonly onClassifySourceInvalidationHint?: (
    input: SourceInvalidationHint,
  ) => "ignore" | "scan" | "scan-parent-domain";
  readonly onReconcileSourceInvalidation?: (input: SourceReconcileRequest) => null;
  readonly onRefreshGeneratedContext?: (input: RefreshGeneratedContextRequest) => void;
}

function testRuntimeRootLayer(overrides: TestRootLayerOverrides = {}) {
  return Runtime.layer.pipe(
    Layer.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig)),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RuntimePromptDefaultsStatePort, {
          resolvePromptDefaults: () =>
            Effect.succeed({
              provider: "openai",
              model: "gpt-4o",
              reasoningEffort: "medium" as const,
            }),
        }),
        Layer.succeed(RuntimeLayerProviderAuthPort, {
          ensureUsableProviderAuth: () => Effect.succeed("test-api-key"),
          getProviderAuthUnavailableMessage: () => "Provider auth unavailable.",
        }),
        Layer.succeed(RuntimeLayerModelResolverPort, {
          resolveModelId: () => Effect.succeed("gpt-4o"),
        }),
        Layer.succeed(AppLogWritePort, {
          append: () =>
            Effect.succeed({
              value: { appLogEntryId: "app_log_runtime_layer_effect" as AppLogEntryId },
              afterCommit: [],
            }),
        }),
        Layer.succeed(RuntimeWorkflowTaskAgentBridgeBearerVerifier, {
          verify: () => Effect.succeed(true),
        }),
        Layer.succeed(SandboxPolicySource, unusedSandboxPolicySource()),
        Layer.succeed(SandboxHelperCandidatesPort, {
          getSnapshot: () => Effect.succeed({ candidates: [], allowedRoots: [] }),
        }),
        Layer.succeed(HostProcessReferencePort, {
          getSnapshot: () =>
            Effect.succeed({
              platform: "darwin",
              arch: "arm64",
              appBundleRoot: "/Applications/Svvy.app" as AbsolutePath,
              appSupportRoot: "/tmp/svvy-runtime-layer-effect/app-support" as AbsolutePath,
              tempRoot: "/tmp" as AbsolutePath,
            }),
        }),
        Layer.succeed(
          Extensions,
          Extensions.of({
            generatedPackages: {
              refresh: (input: GeneratedPackageBuildInput) =>
                Effect.sync(
                  () =>
                    overrides.onBuildGeneratedPackages?.(input) ?? {
                      packages: input.packages.map((packageName) => ({
                        packageName,
                        action: "unchanged" as const,
                      })),
                    },
                ),
              planWorkspaceLink: () => Effect.die("unused"),
            },
          } as unknown as ExtensionsService),
        ),
        testExtensionsPackageDataLayer(),
        layerRuntimeBunPlatform,
        Layer.succeed(RuntimeGeneratedContextRefreshHostPort, {
          refresh: (input) => {
            overrides.onRefreshGeneratedContext?.(input);
            return Promise.resolve();
          },
        }),
        Layer.succeed(RuntimeGeneratedPackageRefreshHostPort, {
          listAcquiredWorkspaceIds: () =>
            Effect.succeed(overrides.acquiredWorkspaceIds ?? [workspaceId]),
          listRecoverableWorkspaceIds: () =>
            Effect.succeed(overrides.recoverableWorkspaceIds ?? []),
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
        Layer.succeed(RuntimeSourceInvalidationScanPort, {
          classifyHint: (input) =>
            Effect.sync(() => overrides.onClassifySourceInvalidationHint?.(input) ?? "scan"),
          listAcquiredWorkspaceIds: () => Effect.succeed([workspaceId]),
          requestScan: (input) =>
            Effect.sync(() => {
              overrides.onReconcileSourceInvalidation?.(input);
            }).pipe(Effect.asVoid),
          reconcile: (input) =>
            Effect.sync(() => overrides.onReconcileSourceInvalidation?.(input) ?? null),
        }),
        Layer.succeed(RuntimeLayerCommandStdinPort, {
          writeStdin: () =>
            Effect.succeed({
              commandId: "cmd_unused" as CommandId,
              status: "already_terminal" as const,
            }),
        }),
        Layer.succeed(RuntimeLayerCommandControlPort, {
          cancel: (input) =>
            Effect.succeed({
              commandId: input.commandId,
              status: "already_terminal" as const,
            }),
        }),
        testPiAdapterHostLayer(),
        Layer.succeed(RuntimeWorkspaceStatePort, unusedPort("RuntimeWorkspaceStatePort")),
        Layer.succeed(
          RuntimeSurfaceLifecycleStatePort,
          unusedPort("RuntimeSurfaceLifecycleStatePort"),
        ),
        Layer.succeed(RuntimeSourceStatePort, unusedPort("RuntimeSourceStatePort")),
        Layer.succeed(
          RuntimeActorExtensionBindingStatePort,
          unusedPort(
            "RuntimeActorExtensionBindingStatePort",
          ) as RuntimeActorExtensionBindingStatePortService,
        ),
        Layer.succeed(RuntimeQueueStatePort, unusedPort("RuntimeQueueStatePort")),
        Layer.succeed(RuntimeRequestStatePort, startupRestoreRequestStatePort()),
        Layer.succeed(RuntimeApprovalStatePort, emptyApprovalStatePort()),
        Layer.succeed(RuntimeCommandStatePort, testRuntimeCommandStatePort({ published: [] })),
        Layer.succeed(RuntimeGeneratedPackageStatePort, testRuntimeGeneratedPackageStatePort()),
        Layer.succeed(RuntimeSessionWaitStatePort, unusedPort("RuntimeSessionWaitStatePort")),
        Layer.succeed(RuntimeTurnStatePort, unusedPort("RuntimeTurnStatePort")),
        Layer.succeed(RuntimeEpisodeStatePort, unusedPort("RuntimeEpisodeStatePort")),
        Layer.succeed(RuntimeWorkflowTaskStatePort, unusedPort("RuntimeWorkflowTaskStatePort")),
        Layer.succeed(
          RuntimeThreadStatePort,
          unusedPort("RuntimeThreadStatePort") as RuntimeThreadStatePortService,
        ),
      ),
    ),
  );
}

function unusedSandboxPolicySource(): SandboxPolicySourceService {
  return {
    snapshot: () => Effect.die("Unexpected sandbox policy snapshot read."),
  };
}

function workspaceResult(acquired: AcquireWorkspaceResult["acquired"]): AcquireWorkspaceResult {
  return {
    workspaceId,
    cwd: workspaceCwd,
    kind: "user",
    acquired,
    readiness: "ready",
    readinessDetail: { mode: "full" },
    stateRevision,
  };
}

const surfaceResult = {
  workspaceSessionId,
  surfacePiSessionId,
  target,
  created: "new",
  stateRevision,
} satisfies CreateSurfaceResult;

function runtimeCommandRecord(status: RuntimeCommandRecord["status"]): RuntimeCommandRecord {
  return {
    id: "cmd_runtime_layer_effect",
    sessionId: "session_runtime_layer_effect",
    turnId: "turn_runtime_layer_effect",
    workflowTaskAttemptId: null,
    surfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName: "exec_command",
    executor: "orchestrator",
    visibility: "summary",
    status,
    attempts: 1,
    title: "Runtime layer command",
    summary: "Runtime layer command.",
    arguments: null,
    facts: null,
    error: null,
    startedAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    finishedAt:
      status === "succeeded" || status === "failed" || status === "cancelled"
        ? "2026-04-18T09:01:00.000Z"
        : null,
  };
}

function testRuntimeCommandStatePort(
  overrides: TestLayerOverrides,
): RuntimeCommandStatePortService {
  return {
    createCommand: () => Effect.die("Unexpected createCommand call."),
    createOrReuseStreamingCommand: () =>
      Effect.die("Unexpected createOrReuseStreamingCommand call."),
    findCommandByToolCallId: () => Effect.die("Unexpected findCommandByToolCallId call."),
    findCommandById: () => Effect.succeed(overrides.commandRecord ?? null),
    updateCommandArguments: () => Effect.die("Unexpected updateCommandArguments call."),
    startCommand: () => Effect.die("Unexpected startCommand call."),
    finishCommand: (input) =>
      Effect.succeed({
        value: overrides.onFinishCommand?.(input) ?? runtimeCommandRecord(input.status),
        afterCommit: [commandInvalidation],
      }),
    recordCommandEvent: () => Effect.die("Unexpected recordCommandEvent call."),
    recordStdinWrite: () => Effect.die("Unexpected recordStdinWrite call."),
    hasCommandOutputEvent: () => Effect.die("Unexpected hasCommandOutputEvent call."),
  };
}

function testRuntimeGeneratedPackageStatePort(): RuntimeGeneratedPackageStatePortService {
  return {
    recordGeneratedPackageBuild: (input) =>
      Effect.succeed({
        value: runtimeGeneratedPackageFactRecord(input.status.packageName, "ready"),
        afterCommit: [
          {
            scope: "app",
            invalidation: { model: "workflowsGenerated" },
          },
        ],
      }),
    recordGeneratedPackageFailure: (input) =>
      Effect.succeed({
        value: runtimeGeneratedPackageFactRecord(input.status.packageName, "failed"),
        afterCommit: [
          {
            scope: "app",
            invalidation: { model: "workflowsGenerated" },
          },
        ],
      }),
    recordWorkspaceLinkStatus: () => Effect.die("Unexpected recordWorkspaceLinkStatus call."),
    markWorkspaceLinksRepairNeeded: () =>
      Effect.die("Unexpected markWorkspaceLinksRepairNeeded call."),
    readLinksNeedingRepair: () => Effect.die("Unexpected readLinksNeedingRepair call."),
    readGeneratedPackageFacts: () => Effect.die("Unexpected readGeneratedPackageFacts call."),
    reconcileGeneratedPackageManifest: () =>
      Effect.die("Unexpected reconcileGeneratedPackageManifest call."),
    markGeneratedPackageRefreshNeeded: () =>
      Effect.die("Unexpected markGeneratedPackageRefreshNeeded call."),
  };
}

function runtimeGeneratedPackageFactRecord(
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
    createdAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
  };
}

function hintToReconcileRequest(input: SourceInvalidationHint): SourceReconcileRequest {
  return {
    scope: input.scope,
    domains: [input.domain],
    reason: "watcher-debounce",
  };
}

function noRequestInputWaitService(): RuntimeRequestInputWaitService["Service"] {
  return RuntimeRequestInputWaitService.of({
    waitForBlockingRequest: () => Effect.die("Unexpected request-input blocking wait."),
    afterAnswerCommitted: () => Effect.die("Unexpected request-input answer post-commit."),
    afterTimerPausedCommitted: () => Effect.die("Unexpected request-input timer post-commit."),
    restoreOpenBlockingRequests: () => Effect.void,
    cancelBlockingRequestsForSurface: () => Effect.void,
  });
}

function startupRestoreRequestStatePort() {
  return {
    listOpenBlockingRequestInputs: () => Effect.succeed([]),
  } as never;
}

function emptyApprovalStatePort() {
  return {
    listOpenApprovalRequests: () => Effect.succeed([]),
  } as never;
}

function unusedPort(label: string): never {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`${label} is unused by this test.`);
      },
    },
  ) as never;
}
