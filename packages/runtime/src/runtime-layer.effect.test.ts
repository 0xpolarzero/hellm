import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import {
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  AppLogWritePort,
  ExtensionStatePort,
  ExtensionSnapshotPayloadStorePort,
  ExtensionSnapshotSecretStorePort,
  ExtensionSnapshotSecretValuesPort,
  ExtensionSnapshotSettingsStatePort,
  ExtensionSnapshotStatePort,
  ExtensionUsageStatePort,
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeComposerDraftStatePort,
  RuntimeComposerProfileStatePort,
  RuntimeContractError,
  RuntimeEpisodeStatePort,
  RuntimeExtensionStatePort,
  RuntimeExtensionContextImpactStatePort,
  RuntimeExternalInstructionStatePort,
  GeneratedContextPreviewSubjectStatePort,
  RuntimeEventStreamError,
  RuntimeGeneratedPackageStatePort,
  RuntimeQueueStatePort,
  RuntimeRecoveryStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTranscriptStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkflowTaskStatePort,
  RuntimeWorkspaceStatePort,
  RuntimePromptDefaultsStatePort,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  ProviderAuthPort,
  ProviderAuthStatusStatePort,
  SandboxPolicySource,
  StateCommandPostCommitNotificationPort,
  StateContractError,
  type AbsolutePath,
  type AcquireWorkspaceInput,
  type AcquireWorkspaceResult,
  type AppLogEntryId,
  type BuildRuntimeExtensionInput,
  type BuildRuntimeExtensionResult,
  type CloseSurfaceInput,
  type CloseSurfaceResult,
  type CommandId,
  type ConfigureExtensionTypescriptApiInput,
  type ConfigureExtensionTypescriptApiResult,
  type CreateOrchestratorSurfaceInput,
  type CreateSurfaceResult,
  type FinishRuntimeCommandInput,
  type GeneratedPackageBuildInput,
  type GeneratedPackageBuildPlanResult,
  type GeneratedPackageName,
  type GeneratedPackagesRefreshResult,
  type EnsureRuntimeRecoveryWorkInput,
  type IsoDateTimeString,
  type ReasoningEffort,
  type RecordRuntimeSourceDeleteInput,
  type RecordRuntimeSourceSaveInput,
  type RecordRuntimeWorkflowAgentSourceSaveInput,
  type RefreshGeneratedContextRequest,
  type RefreshGeneratedPackagesRequest,
  type RuntimeEvent,
  type RuntimeEventGenerationId,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeEventSequence,
  type ExtensionUsageStatePortService,
  type RuntimeExtensionContextImpactStatePortService,
  type StateRevision,
  type RuntimeGeneratedPackageFactRecord,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeRecoveryStatePortService,
  type RuntimeRecoveryWorkRecord,
  type RuntimeSourceFactRecord,
  type RuntimeSourceScanFactRecord,
  type RuntimeSourceStatePortService,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimePromptBindingRecord,
  type RuntimeThreadStatePortService,
  type RuntimeTranscriptStatePortService,
  type RuntimeTranscriptStreamCursor,
  type RuntimeOwnerId,
  type SandboxPolicySourceService,
  type SourceInvalidationHint,
  type SourceEditSession,
  type SourceReconcileRequest,
  type StateCommandReceipt,
  type StateInvalidationDescriptor,
  type ProviderAuthStatusStatePortService,
  type SurfacePiSessionId,
  type WorkspaceId,
  type WorkspaceSessionId,
  type WorkflowAgentSourceDeleteResult,
  type WorkflowAgentSourceExportName,
  type WorkflowAgentSourceLifecycleResult,
} from "@svvy/core";
import { PiAdapter, layer as PiAdapterLayer } from "@svvy/pi-adapter";
import {
  ExtensionBuildProcessPort,
  ExtensionCliRequirementProbePort,
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
  RuntimeExternalInstructionScanInputPort,
  RuntimeSourceInvalidationScanPort,
  makeRuntimeService,
  type RuntimeLayerCommandControlPortService,
  type RuntimeLayerModelResolverPortService,
  type RuntimeLayerProviderAuthPortService,
} from "./runtime-layer";
import { RuntimeEventBus } from "./runtime-event-bus";
import { createRuntimeLayerConfigLayer, defaultRuntimeLayerConfig } from "./runtime-layer-config";
import { RuntimeShutdownPreparation, RuntimeStartupReadiness } from "./runtime-layer-config";
import { layerRuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import { RuntimePromptDefaultsService } from "./runtime-prompt-defaults-service";
import { RuntimeQueueWakeService } from "./runtime-queue-wake-service";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import {
  RuntimeExtensionBuildService,
  type RuntimeExtensionBuildServiceService,
} from "./runtime-extension-build-service";
import {
  RuntimeExtensionLifecycleService,
  type RuntimeExtensionLifecycleServiceService,
} from "./runtime-extension-lifecycle-service";
import { RuntimeExtensionSnapshotService } from "./runtime-extension-snapshot-service";
import {
  layerRuntimeExtensionSourceCoordinator,
  RuntimeExtensionSourceCoordinator,
  type RuntimeExtensionSourceCoordinatorService,
} from "./runtime-extension-source-coordinator";
import { RuntimeGeneratedContextPreviewService } from "./runtime-generated-context-preview-service";
import { RuntimeSourceReconcileRecoveryWorker } from "./runtime-source-reconcile-recovery-worker";
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
import {
  RuntimeShutdownAdmission,
  layerRuntimeShutdownAdmission,
} from "./runtime-shutdown-admission";

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
    Layer.succeed(ExtensionBuildProcessPort, {
      run: () => Effect.die("Unexpected extension build process execution."),
    }),
    Layer.succeed(ExtensionCliRequirementProbePort, {
      probe: () => Effect.succeed({ status: "missing" as const }),
    }),
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
        acquirePromptLock: () => Effect.succeed(Effect.void),
        restorePiHistory: () => Effect.void,
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
        acquirePromptLock: () => Effect.succeed(Effect.void),
        restorePiHistory: () => Effect.void,
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
        acquirePromptLock: () => Effect.succeed(Effect.void),
        restorePiHistory: () => Effect.void,
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
    readGeneratedContextBuildSubject: () => Effect.die("Unexpected context subject read."),
    bindGeneratedContext: () => Effect.die("Unexpected context binding write."),
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

  it.effect("routes startup queue replay through the runtime-owned queue wake service", () => {
    const published: StateInvalidationDescriptor[][] = [];
    const queueWakes: Array<Parameters<RuntimeQueueWakeService["Service"]["wakeSurface"]>[0]> = [];

    return Effect.gen(function* () {
      const runtime = yield* Runtime;

      yield* runtime.workspaceRecovery.wakeSurfaceQueue({ target });

      assert.deepStrictEqual(queueWakes, [{ target, reason: "startup-recovery" }]);
    }).pipe(Effect.provide(testRuntimeLayer({ published, queueWakes })));
  });

  it.effect("rejects public Runtime calls after the shared shutdown marker", () => {
    const published: StateInvalidationDescriptor[][] = [];
    let workspaceAcquisitions = 0;
    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      const shutdown = yield* RuntimeShutdownAdmission;
      yield* shutdown.runShutdown(
        Effect.succeed({
          status: "drained",
          interruptedTurns: 0,
          interruptedCommands: 0,
          releasedQueueClaims: 0,
          recoveryRowsScheduled: 0,
        }),
      );

      const error = yield* runtime.workspaces
        .acquire({ cwd: workspaceCwd, owner, openReason: "test" })
        .pipe(Effect.flip);

      assert.strictEqual(error.reason, "runtime-shutdown");
      assert.strictEqual(workspaceAcquisitions, 0);
      assert.deepStrictEqual(published, []);
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published,
          onAcquireWorkspace: () => {
            workspaceAcquisitions += 1;
            return workspaceResult("existing");
          },
        }),
      ),
    );
  });

  it.effect(
    "routes workspace and surface lifecycle through state ports and publishes after-commit invalidations",
    () => {
      const published: StateInvalidationDescriptor[][] = [];
      const livePublished: RuntimeEvent[] = [];
      const surfaceEventActions: string[] = [];
      const acquired: AcquireWorkspaceInput[] = [];
      const requestInputRestoreCalls: string[] = [];
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
        assert.deepStrictEqual(requestInputRestoreCalls, ["restore"]);
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
            onRestoreOpenBlockingRequests: () => requestInputRestoreCalls.push("restore"),
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

  it.effect("routes TypeScript API configuration through the lifecycle authority", () => {
    const calls: ConfigureExtensionTypescriptApiInput[] = [];
    const input = {
      workspaceId,
      extensionId: "notes" as never,
      enabled: true,
    } satisfies ConfigureExtensionTypescriptApiInput;
    const expected = {
      extensionId: input.extensionId,
      enabled: true,
      changed: true,
      reconcileRequired: true,
    } satisfies ConfigureExtensionTypescriptApiResult;
    const extensions = Extensions.of({
      sources: {
        configureTypescriptApi: () =>
          Effect.die("runtime source edits must delegate TypeScript API configuration"),
      },
    } as unknown as ExtensionsService);

    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      const result = yield* runtime.sourceEdits.configureTypescriptApi(input);

      assert.deepStrictEqual(result, expected);
      assert.deepStrictEqual(calls, [input]);
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published: [],
          extensions,
          configureTypescriptApi: (configureInput) =>
            Effect.sync(() => {
              calls.push(configureInput);
              return expected;
            }),
        }),
      ),
    );
  });

  it.effect("serializes explicit extension builds with source transactions", () => {
    const serialization: string[] = [];
    const builds: BuildRuntimeExtensionInput[] = [];
    const input = {
      extensionId: "notes" as BuildRuntimeExtensionInput["extensionId"],
      clientRequestId:
        "runtime-client:build-notes" as BuildRuntimeExtensionInput["clientRequestId"],
    };
    const expected = {
      attemptId:
        `extension-build-attempt:notes:${"a".repeat(64)}` as BuildRuntimeExtensionResult["attemptId"],
      registryAggregateFingerprint: "registry-fingerprint",
      manifest: {
        schemaVersion: 1,
        buildId:
          `extension-build:notes:${"b".repeat(64)}` as BuildRuntimeExtensionResult["manifest"]["buildId"],
        extensionId: input.extensionId,
        interfaceKind: "svvyx",
        sourceFingerprint:
          `sha256:${"c".repeat(64)}` as BuildRuntimeExtensionResult["manifest"]["sourceFingerprint"],
        contextFingerprint:
          `sha256:${"d".repeat(64)}` as BuildRuntimeExtensionResult["manifest"]["contextFingerprint"],
        outputFingerprint:
          `sha256:${"e".repeat(64)}` as BuildRuntimeExtensionResult["manifest"]["outputFingerprint"],
        contextReady: true,
        generatedFiles: [],
        builtAt: "2026-07-12T10:00:00.000Z" as BuildRuntimeExtensionResult["manifest"]["builtAt"],
      },
    } satisfies BuildRuntimeExtensionResult;

    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      const result = yield* runtime.extensions.build(input);

      assert.deepStrictEqual(result, expected);
      assert.deepStrictEqual(builds, [input]);
      assert.deepStrictEqual(serialization, ["entered", "build", "released"]);
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published: [],
          extensionBuild: {
            build: (buildInput) =>
              Effect.sync(() => {
                serialization.push("build");
                builds.push(buildInput);
                return expected;
              }),
            buildOutcome: () => Effect.die("unused extension build outcome"),
          },
          extensionSourceCoordinator: {
            serialized: (effect) =>
              Effect.sync(() => serialization.push("entered")).pipe(
                Effect.andThen(effect),
                Effect.ensuring(Effect.sync(() => serialization.push("released"))),
              ),
          },
        }),
      ),
    );
  });

  it.effect(
    "orchestrates workflow-agent create, duplicate, and delete through model admission, durable source facts, and invalidation hints",
    () => {
      const published: StateInvalidationDescriptor[][] = [];
      const saved: RecordRuntimeSourceSaveInput[] = [];
      const workflowSaves: RecordRuntimeWorkflowAgentSourceSaveInput[] = [];
      const deleted: RecordRuntimeSourceDeleteInput[] = [];
      const hints: SourceInvalidationHint[] = [];
      const resolvedModels: Array<{ readonly provider: string; readonly model: string }> = [];
      const sourceFacts = new Map<string, RuntimeSourceFactRecord>();
      const original = workflowAgentSession("reviewerAgent", "Reviewer", "version_original");
      sourceFacts.set(original.sourceId, runtimeSourceFact(original));

      const extensions = Extensions.of({
        sources: {
          openEditSession: (
            input: Parameters<ExtensionsService["sources"]["openEditSession"]>[0],
          ) =>
            Effect.sync(() => {
              const session =
                input.sourceId === original.sourceId
                  ? original
                  : workflowAgentSession(input.sourceId, "Reviewer copy", "version_copy");
              return session;
            }),
          saveEditSession: () =>
            Effect.succeed({
              status: "saved",
              path: original.path,
              sourceVersion: "version_saved",
              fingerprint: "version_saved",
              diagnostics: [],
              reconcileRequired: true,
            }),
          createWorkflowAgent: (
            input: Parameters<ExtensionsService["sources"]["createWorkflowAgent"]>[0],
          ) =>
            Effect.succeed(
              workflowAgentLifecycleResult(
                "created",
                workflowAgentSession(
                  input.draft.exportName,
                  input.draft.displayName,
                  "version_created",
                ),
              ),
            ),
          duplicateWorkflowAgent: (
            input: Parameters<ExtensionsService["sources"]["duplicateWorkflowAgent"]>[0],
          ) =>
            Effect.succeed(
              workflowAgentLifecycleResult(
                "duplicated",
                workflowAgentSession(
                  input.draftPatch.exportName,
                  input.draftPatch.displayName ?? "Reviewer copy",
                  "version_copy",
                ),
              ),
            ),
          deleteWorkflowAgent: (
            input: Parameters<ExtensionsService["sources"]["deleteWorkflowAgent"]>[0],
          ) =>
            Effect.succeed({
              status: "deleted",
              sourceKind: "workflow-agent",
              sourceId: input.sourceId,
              deletedPath:
                `/tmp/svvy-runtime-layer-effect/workflows/agents/${input.sourceId}.agent.json` as AbsolutePath,
              previousSourceVersion: input.expectedSourceVersion,
              fileWriteReceipt: {
                path: `/tmp/svvy-runtime-layer-effect/workflows/agents/${input.sourceId}.agent.json` as AbsolutePath,
                deleted: true,
              },
              reconcileRequired: true,
            } satisfies WorkflowAgentSourceDeleteResult),
        },
      } as unknown as ExtensionsService);
      const sourceState = sourceStatePort({
        read: (sourceId) => sourceFacts.get(sourceId) ?? null,
        workflowSave: (input) => {
          workflowSaves.push(input);
          saved.push(input.source);
          const fact = runtimeSourceFactFromSave(input.source);
          sourceFacts.set(input.source.sourceId, fact);
          return fact;
        },
        delete: (record) => {
          deleted.push(record);
          const current = sourceFacts.get(record.sourceId);
          if (!current) throw new Error(`Missing source fact ${record.sourceId}`);
          const fact = { ...current, deletedAt: record.deletedAt, updatedAt: record.deletedAt };
          sourceFacts.set(record.sourceId, fact);
          return fact;
        },
      });
      const modelResolver: RuntimeLayerModelResolverPortService = {
        resolveModel: (input) =>
          Effect.sync(() => {
            resolvedModels.push(input);
            return {
              ...input,
              supportedReasoning: ["off", "low", "medium", "high"] as const,
            };
          }),
      };

      return Effect.gen(function* () {
        const runtime = yield* Runtime;
        const savedResult = yield* runtime.sourceEdits.save({
          workspaceId,
          source: {
            sourceKind: "workflow-agent",
            sourceId: original.sourceId,
            expectedSourceVersion: original.sourceVersion,
            text: workflowAgentText({
              id: original.sourceId,
              label: "Revised reviewer",
            }),
            saveMode: "compare-and-swap",
          },
        });
        const created = yield* runtime.sourceEdits.createWorkflowAgent({
          workspaceId,
          source: {
            draft: {
              exportName: "strictReviewer" as WorkflowAgentSourceExportName,
              displayName: "Strict reviewer",
              provider: "openai",
              model: "gpt-5.4",
              reasoning: { effort: "high" },
              instructionText: "Review strictly.",
            },
            sourceOwner: "agents-pane",
          },
        });
        const duplicated = yield* runtime.sourceEdits.duplicateWorkflowAgent({
          workspaceId,
          source: {
            sourceId: "reviewerAgent" as WorkflowAgentSourceExportName,
            draftPatch: {
              exportName: "reviewerCopy" as WorkflowAgentSourceExportName,
              displayName: "Reviewer copy",
            },
            sourceOwner: "headless",
          },
        });
        const removed = yield* runtime.sourceEdits.deleteWorkflowAgent({
          workspaceId,
          source: {
            sourceId: "reviewerCopy" as WorkflowAgentSourceExportName,
            expectedSourceVersion: duplicated.session.sourceVersion,
            sourceOwner: "agents-pane",
          },
        });

        assert.strictEqual(savedResult.status, "saved");
        assert.strictEqual(created.status, "created");
        assert.strictEqual(duplicated.status, "duplicated");
        assert.strictEqual(removed.status, "deleted");
        assert.deepStrictEqual(resolvedModels, [
          { provider: "openai", model: "gpt-5.4" },
          { provider: "openai", model: "gpt-5.4" },
          { provider: "openai", model: "gpt-5.4" },
        ]);
        assert.deepStrictEqual(
          saved.map((record) => record.sourceId),
          ["reviewerAgent", "strictReviewer", "reviewerCopy"],
        );
        assert.deepStrictEqual(
          deleted.map((record) => record.sourceId),
          ["reviewerCopy"],
        );
        assert.strictEqual(deleted[0]?.previousFingerprint, "version_copy");
        assert.deepStrictEqual(
          workflowSaves.map(({ source, observation }) => ({
            sourceId: observation.sourceId,
            status: observation.validationStatus,
            sameVersion: observation.sourceVersion === source.sourceVersion,
            sameFingerprint: observation.fingerprint === source.fingerprint,
            sameTimestamp: observation.observedAt === source.savedAt,
          })),
          [
            {
              sourceId: "reviewerAgent",
              status: "valid",
              sameVersion: true,
              sameFingerprint: true,
              sameTimestamp: true,
            },
            {
              sourceId: "strictReviewer",
              status: "valid",
              sameVersion: true,
              sameFingerprint: true,
              sameTimestamp: true,
            },
            {
              sourceId: "reviewerCopy",
              status: "valid",
              sameVersion: true,
              sameFingerprint: true,
              sameTimestamp: true,
            },
          ],
        );
        assert.deepStrictEqual(
          hints.map((hint) => ({ domain: hint.domain, path: hint.path })),
          [
            { domain: "workflows", path: original.path },
            { domain: "workflows", path: created.session.path },
            { domain: "workflows", path: duplicated.session.path },
            { domain: "workflows", path: removed.deletedPath },
          ],
        );
        assert.strictEqual(published.length, 4);
      }).pipe(
        Effect.provide(
          testRuntimeLayer({
            published,
            extensions,
            sourceState,
            modelResolver,
            sourceInvalidation: sourceInvalidationService((hint) => hints.push(hint)),
          }),
        ),
      );
    },
  );

  it.effect(
    "rejects unavailable workflow-agent providers, models, reasoning, and auth before generic save writes",
    () => {
      let saveCalls = 0;
      const current = workflowAgentSession("reviewAgent", "Review agent", "version_current");
      const extensions = Extensions.of({
        sources: {
          openEditSession: () => Effect.succeed(current),
          saveEditSession: () =>
            Effect.sync(() => {
              saveCalls += 1;
              return {
                status: "saved" as const,
                path: current.path,
                sourceVersion: "version_saved",
                fingerprint: "version_saved",
                diagnostics: [],
                reconcileRequired: true,
              };
            }),
          createWorkflowAgent: () => Effect.die("unused"),
          duplicateWorkflowAgent: () => Effect.die("unused"),
          deleteWorkflowAgent: () => Effect.die("unused"),
        },
      } as unknown as ExtensionsService);
      const cases = [
        { provider: "missing-provider", model: "claude", reasoning: "high" as const },
        { provider: "openai", model: "unknown", reasoning: "high" as const },
        { provider: "openai", model: "gpt-5.4", reasoning: "xhigh" as const },
        { provider: "anthropic", model: "claude", reasoning: "high" as const },
      ];
      const modelResolver: RuntimeLayerModelResolverPortService = {
        resolveModel: (input) =>
          (input.provider === "openai" && input.model === "gpt-5.4") ||
          (input.provider === "anthropic" && input.model === "claude")
            ? Effect.succeed({
                ...input,
                supportedReasoning: ["off", "low", "medium", "high"],
              })
            : Effect.fail(
                new RuntimeContractError({
                  operation: "test.model.resolve",
                  reason: "invalid-input",
                  message: "Model unavailable.",
                }),
              ),
      };
      const providerAuth: RuntimeLayerProviderAuthPortService = {
        ensureUsableProviderAuth: (provider) =>
          Effect.succeed(provider === "anthropic" ? undefined : "test-api-key"),
        getProviderAuthUnavailableMessage: (provider) => `${provider} auth unavailable.`,
      };

      return Effect.gen(function* () {
        const runtime = yield* Runtime;
        const failures = yield* Effect.forEach(cases, (entry) =>
          runtime.sourceEdits
            .save({
              workspaceId,
              source: {
                sourceKind: "workflow-agent",
                sourceId: "reviewAgent",
                expectedSourceVersion: current.sourceVersion,
                text: workflowAgentText({
                  id: "reviewAgent",
                  label: "Review agent",
                  provider: entry.provider,
                  model: entry.model,
                  reasoning: entry.reasoning,
                }),
                saveMode: "overwrite",
              },
            })
            .pipe(Effect.flip),
        );

        assert.deepStrictEqual(
          failures.map((failure) => failure.reason),
          ["invalid-input", "invalid-input", "invalid-input", "dependency-not-ready"],
        );
        assert.strictEqual(saveCalls, 0);
      }).pipe(
        Effect.provide(
          testRuntimeLayer({
            published: [],
            extensions,
            modelResolver,
            providerAuth,
            sourceState: sourceStatePort(),
          }),
        ),
      );
    },
  );

  it.effect("enqueues an exact source-reconcile retry when source fact recording fails", () => {
    const ensured: EnsureRuntimeRecoveryWorkInput[] = [];
    const published: StateInvalidationDescriptor[][] = [];
    const livePublished: RuntimeEvent[] = [];
    const recoveryWakes: string[] = [];
    const extensionSourceSerialization: string[] = [];
    const session = workflowAgentSession("recoveryAgent", "Recovery agent", "version_recovery");
    const extensions = Extensions.of({
      sources: {
        openEditSession: () =>
          Effect.succeed({
            sourceKind: "user-extension",
            sourceId: "custom-tools",
            path: "/tmp/svvy-runtime-layer-effect/extensions/custom-tools/index.ts" as AbsolutePath,
            sourceVersion: "version_extension_current",
            fingerprint: "version_extension_current",
            text: "export default {};\n",
            diagnostics: [],
          }),
        saveEditSession: () =>
          Effect.succeed({
            status: "saved",
            path: "/tmp/svvy-runtime-layer-effect/extensions/custom-tools/index.ts" as AbsolutePath,
            sourceVersion: "version_extension_saved",
            fingerprint: "version_extension_saved",
            diagnostics: [],
            reconcileRequired: true,
          }),
        createWorkflowAgent: () => Effect.succeed(workflowAgentLifecycleResult("created", session)),
        duplicateWorkflowAgent: () => Effect.die("unused"),
        deleteWorkflowAgent: () => Effect.die("unused"),
      },
    } as unknown as ExtensionsService);
    const sourceState = sourceStatePort({
      saveFailure: new StateContractError({
        operation: "test.record-source-save",
        reason: "transaction-failed",
        message: "Source fact database is unavailable.",
      }),
    });
    const recoveryState = recoveryStatePort((input) => {
      ensured.push(input);
      return runtimeRecoveryWork(input);
    });

    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      const failure = yield* runtime.sourceEdits
        .createWorkflowAgent({
          workspaceId,
          source: {
            draft: {
              exportName: "recoveryAgent" as WorkflowAgentSourceExportName,
              displayName: "Recovery agent",
              provider: "openai",
              model: "gpt-5.4",
              reasoning: { effort: "high" },
            },
            sourceOwner: "headless",
          },
        })
        .pipe(Effect.flip);
      const extensionFailure = yield* runtime.sourceEdits
        .save({
          workspaceId,
          source: {
            sourceKind: "user-extension",
            sourceId: "custom-tools",
            expectedSourceVersion: "version_extension_current",
            text: "export default { ready: true };\n",
            saveMode: "compare-and-swap",
          },
        })
        .pipe(Effect.flip);

      assert.deepInclude(failure, {
        operation: "runtime.sourceEdits.createWorkflowAgent",
        reason: "state-conflict",
      });
      assert.deepInclude(extensionFailure, {
        operation: "runtime.sourceEdits.save",
        reason: "state-conflict",
      });
      assert.strictEqual(ensured.length, 2);
      assert.deepStrictEqual(
        ensured.map((work) => work.maxAttempts),
        [7, 7],
      );
      assert.deepInclude(ensured[0], {
        scope: { kind: "app" },
        kind: "source_reconcile",
        ownerScope: {
          kind: "source",
          sourceKind: "workflow-agent",
          sourceId: "recoveryAgent",
        },
        orderingKey: "source:workflow-agent:recoveryAgent",
        maxAttempts: 7,
        payloadJson: {
          request: {
            scope: { kind: "app-global" },
            domains: ["workflows"],
            reason: "recovery",
          },
          retry: {
            operation: "record-save",
            record: {
              scope: { kind: "app-global" },
              sourceKind: "workflow-agent",
              sourceId: "recoveryAgent",
              path: session.path,
              previousSourceVersion: null,
              sourceVersion: session.sourceVersion,
              fingerprint: session.fingerprint,
              diagnostics: [],
              sourceCommandId: null,
              savedAt: "1970-01-01T00:00:00.000Z",
            },
          },
        },
      });
      assert.deepInclude(ensured[1], {
        kind: "source_reconcile",
        ownerScope: {
          kind: "source",
          sourceKind: "user-extension",
          sourceId: "custom-tools",
        },
      });
      assert.deepStrictEqual(
        (
          ensured[1]!.payloadJson as {
            readonly request: SourceReconcileRequest;
          }
        ).request,
        {
          scope: { kind: "app-global" },
          domains: ["extensions"],
          reason: "recovery",
        },
      );
      assert.deepStrictEqual(published, [[], []]);
      assert.deepStrictEqual(
        livePublished.map((event) =>
          event.type === "runtime.recovery"
            ? { type: event.type, scope: event.scope, status: event.status }
            : event,
        ),
        [
          { type: "runtime.recovery", scope: "app", status: "pending" },
          { type: "runtime.recovery", scope: "app", status: "pending" },
        ],
      );
      assert.deepStrictEqual(recoveryWakes, ["wake", "wake"]);
      assert.deepStrictEqual(extensionSourceSerialization, ["entered", "released"]);
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published,
          livePublished,
          recoveryWakes,
          config: { recoveryRetryMaxAttempts: 7 as never },
          extensions,
          sourceState,
          recoveryState,
          extensionSourceCoordinator: {
            serialized: (effect) =>
              Effect.sync(() => extensionSourceSerialization.push("entered")).pipe(
                Effect.andThen(effect),
                Effect.ensuring(Effect.sync(() => extensionSourceSerialization.push("released"))),
              ),
          },
        }),
      ),
    );
  });

  it.effect(
    "wakes source recovery after its durable row commits even when status publication fails",
    () => {
      const recoveryWakes: string[] = [];
      const ensured: EnsureRuntimeRecoveryWorkInput[] = [];
      const session = workflowAgentSession(
        "publicationRecoveryAgent",
        "Publication recovery agent",
        "version_publication_recovery",
      );
      const extensions = Extensions.of({
        sources: {
          openEditSession: () => Effect.die("unused"),
          saveEditSession: () => Effect.die("unused"),
          createWorkflowAgent: () =>
            Effect.succeed(workflowAgentLifecycleResult("created", session)),
          duplicateWorkflowAgent: () => Effect.die("unused"),
          deleteWorkflowAgent: () => Effect.die("unused"),
        },
      } as unknown as ExtensionsService);

      return Effect.gen(function* () {
        const runtime = yield* Runtime;
        yield* runtime.sourceEdits
          .createWorkflowAgent({
            workspaceId,
            source: {
              draft: {
                exportName: "publicationRecoveryAgent" as WorkflowAgentSourceExportName,
                displayName: "Publication recovery agent",
                provider: "openai",
                model: "gpt-5.4",
                reasoning: { effort: "high" },
              },
              sourceOwner: "headless",
            },
          })
          .pipe(Effect.flip);

        assert.strictEqual(ensured.length, 1);
        assert.deepStrictEqual(recoveryWakes, ["wake"]);
      }).pipe(
        Effect.provide(
          testRuntimeLayer({
            published: [],
            recoveryWakes,
            failRecoveryStatusPublication: true,
            extensions,
            sourceState: sourceStatePort({
              saveFailure: new StateContractError({
                operation: "test.record-source-save",
                reason: "transaction-failed",
                message: "Source fact database is unavailable.",
              }),
            }),
            recoveryState: recoveryStatePort((input) => {
              ensured.push(input);
              return runtimeRecoveryWork(input);
            }),
          }),
        ),
      );
    },
  );

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
        "app-source-reconcile",
        "recovery-startup-scan",
        "event-bus",
      ]);
      assert.deepStrictEqual(receipt.degradedPhases, []);
      assert.match(receipt.readyAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }).pipe(Effect.provide(testRuntimeRootLayer())),
  );

  it.effect("provides runtime-owned shutdown preparation through the root layer", () =>
    Effect.gen(function* () {
      const runtime = yield* Runtime;
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
      const rejected = yield* runtime.workspaces
        .acquire({ cwd: workspaceCwd, owner, openReason: "test" })
        .pipe(Effect.flip);
      assert.strictEqual(rejected.reason, "runtime-shutdown");
      const sourceRejected = yield* runtime.sourceInvalidation
        .hint({
          scope: { kind: "app-global" },
          domain: "extensions",
          path: "/tmp/svvy-runtime-layer-effect/extensions/web/index.ts" as AbsolutePath,
        })
        .pipe(Effect.flip);
      assert.strictEqual(sourceRejected.reason, "runtime-shutdown");
      const bridgeRejected = yield* runtime.workflowTaskAgentBridge
        .runTaskAgent({
          auth: { kind: "bearer", transport: "loopback-http", token: "" },
          request: {} as never,
        })
        .pipe(Effect.flip);
      assert.strictEqual(bridgeRejected.reason, "runtime-shutdown");
    }).pipe(Effect.provide(testRuntimeRootLayer())),
  );

  it.effect("routes set and revert usage context impact with canonical profile identities", () => {
    const affected: Array<{ agentProfile: string; profileId: string }> = [];
    const changes = new Map<string, any>();
    let registryObservations: any[] = [
      {
        extensionId: "smithers",
        usagePolicy: { configurable: true, fixedReason: null, networkAccess: "not-required" },
      },
    ];
    let networkAccess = true;
    const targets = {
      "default-orchestrator": {
        actor: "orchestrator",
        agentProfile: "default-orchestrator",
        profileId: "default-orchestrator",
      },
      threadHandler: {
        actor: "handler",
        agentProfile: "threadHandler",
        profileId: "thread-handler",
      },
      reviewer: { actor: "workflow-task", agentProfile: "reviewer", profileId: "reviewer" },
    } as const;
    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      for (const agentProfile of Object.keys(targets) as Array<keyof typeof targets>) {
        const set = yield* runtime.extensions.setUsage({
          clientRequestId: `runtime-client:set:${agentProfile}` as never,
          extensionId: "smithers" as never,
          agentProfile,
          usage: "loaded",
        });
        assert.deepStrictEqual(
          set.affectedSurfaces.map((surface) => String(surface.surfacePiSessionId)),
          [`surface:${targets[agentProfile].profileId}`],
        );
        const reverted = yield* runtime.extensions.revertUsage({
          clientRequestId: `runtime-client:revert:${agentProfile}` as never,
          changeId: set.change.changeId,
        });
        assert.deepStrictEqual(
          reverted.affectedSurfaces.map((surface) => String(surface.surfacePiSessionId)),
          [`surface:${targets[agentProfile].profileId}`],
        );
      }
      registryObservations = [];
      const unknown = yield* runtime.extensions
        .setUsage({
          clientRequestId: "runtime-client:set:unknown" as never,
          extensionId: "unknown" as never,
          agentProfile: "default-orchestrator",
          usage: "loaded",
        })
        .pipe(Effect.flip);
      assert.strictEqual(unknown.reason, "target-not-found");
      registryObservations = [
        {
          extensionId: "extension-loading",
          usagePolicy: { configurable: false, fixedReason: "fixed by policy" },
        },
      ];
      const fixed = yield* runtime.extensions
        .setUsage({
          clientRequestId: "runtime-client:set:fixed" as never,
          extensionId: "extension-loading" as never,
          agentProfile: "default-orchestrator",
          usage: "unavailable",
        })
        .pipe(Effect.flip);
      assert.strictEqual(fixed.reason, "invalid-input");
      assert.strictEqual(changes.size, 6);
      registryObservations = [
        {
          extensionId: "web",
          usagePolicy: { configurable: true, fixedReason: null, networkAccess: "required" },
        },
      ];
      networkAccess = false;
      const networkDisabled = yield* runtime.extensions
        .setUsage({
          clientRequestId: "runtime-client:set:web" as never,
          extensionId: "web" as never,
          agentProfile: "default-orchestrator",
          usage: "available",
        })
        .pipe(Effect.flip);
      assert.strictEqual(networkDisabled.reason, "invalid-input");
      const webChange = {
        changeId: "extension-usage-change:web-before" as never,
        clientRequestId: "runtime-client:web-before" as never,
        extensionId: "web" as never,
        target: targets["default-orchestrator"],
        before: "loaded" as const,
        after: "unavailable" as const,
        revertedChangeId: null,
        createdAt: "2026-07-12T00:00:00.000Z",
        stateRevision: 3 as never,
      };
      changes.set(webChange.changeId, webChange);
      const networkDisabledRevert = yield* runtime.extensions
        .revertUsage({
          clientRequestId: "runtime-client:revert:web" as never,
          changeId: webChange.changeId,
        })
        .pipe(Effect.flip);
      assert.strictEqual(networkDisabledRevert.reason, "invalid-input");
      assert.deepStrictEqual(
        affected,
        [
          targets["default-orchestrator"],
          targets["default-orchestrator"],
          targets.threadHandler,
          targets.threadHandler,
          targets.reviewer,
          targets.reviewer,
        ].map(({ agentProfile, profileId }) => ({ agentProfile, profileId })),
      );
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published: [],
          extensions: {
            registry: {
              list: () => Effect.die("unused"),
              inspect: () => Effect.die("unused"),
              observe: () => Effect.succeed({ observations: registryObservations } as never),
            },
          } as unknown as ExtensionsService,
          extensionUsageState: {
            readNetworkAccess: () => Effect.succeed(networkAccess),
            resolveTarget: (name) => Effect.succeed(targets[name as keyof typeof targets]),
            set: (input) =>
              Effect.sync(() => {
                const change = {
                  changeId: `extension-usage-change:${input.clientRequestId}` as never,
                  clientRequestId: input.clientRequestId,
                  extensionId: input.extensionId,
                  target: input.target,
                  before: null,
                  after: input.usage,
                  revertedChangeId: null,
                  createdAt: "2026-07-12T00:00:00.000Z",
                  stateRevision: 1 as never,
                };
                changes.set(change.changeId, change);
                return { value: change, afterCommit: [] };
              }),
            revert: (input) =>
              Effect.sync(() => {
                const original = changes.get(input.changeId)!;
                const change = {
                  ...original,
                  changeId: `extension-usage-change:${input.clientRequestId}` as never,
                  clientRequestId: input.clientRequestId,
                  before: original.after,
                  after: original.before,
                  revertedChangeId: original.changeId,
                  stateRevision: 2 as never,
                };
                changes.set(change.changeId, change);
                return { value: change, afterCommit: [] };
              }),
            read: (changeId) => Effect.succeed(changes.get(changeId) ?? null),
          },
          extensionContextImpact: {
            listUsageContextAffectedSurfaces: (input) =>
              Effect.sync(() => {
                affected.push({ agentProfile: input.agentProfile, profileId: input.profileId });
                return [
                  {
                    surfacePiSessionId: `surface:${input.profileId}` as never,
                    kind: "extension_context_changed" as const,
                    label: "Extensions changed" as const,
                    reason: "extension_usage_changed" as const,
                  },
                ];
              }),
            applySnapshotContextImpact: () => Effect.die("unused"),
          },
        }),
      ),
    );
  });
});

const sourceFactInvalidation = {
  scope: "app",
  invalidation: { model: "workflowsGenerated" },
} satisfies StateInvalidationDescriptor;

function workflowAgentText(input: {
  readonly id: string;
  readonly label: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoning?: ReasoningEffort;
}): string {
  return `${JSON.stringify({
    id: input.id,
    label: input.label,
    provider: input.provider ?? "openai",
    model: input.model ?? "gpt-5.4",
    reasoning: { effort: input.reasoning ?? "high" },
    instructions: "Review the implementation.",
  })}\n`;
}

function workflowAgentSession(
  sourceId: string,
  label: string,
  sourceVersion: string,
): WorkflowAgentSourceLifecycleResult["session"] {
  return {
    sourceKind: "workflow-agent",
    sourceId: sourceId as WorkflowAgentSourceExportName,
    path: `/tmp/svvy-runtime-layer-effect/workflows/agents/${sourceId}.agent.json` as AbsolutePath,
    sourceVersion,
    fingerprint: sourceVersion,
    text: workflowAgentText({ id: sourceId, label }),
    diagnostics: [],
  };
}

function workflowAgentLifecycleResult(
  status: WorkflowAgentSourceLifecycleResult["status"],
  session: WorkflowAgentSourceLifecycleResult["session"],
): WorkflowAgentSourceLifecycleResult {
  return {
    status,
    session,
    fileWriteReceipt: {
      path: session.path,
      previousExists: false,
      bytes: new TextEncoder().encode(session.text).byteLength,
    },
    reconcileRequired: true,
  };
}

function runtimeSourceFact(
  session: SourceEditSession,
  deletedAt: RuntimeSourceFactRecord["deletedAt"] = null,
): RuntimeSourceFactRecord {
  const timestamp = "2026-04-18T09:00:00.000Z" as RuntimeSourceFactRecord["createdAt"];
  return {
    scope: { kind: "app-global" },
    scopeKey: "app-global",
    sourceKind: session.sourceKind,
    sourceId: session.sourceId,
    path: session.path,
    sourceVersion: session.sourceVersion,
    fingerprint: session.fingerprint,
    diagnostics: session.diagnostics,
    sourceCommandId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt,
  };
}

function runtimeSourceFactFromSave(input: RecordRuntimeSourceSaveInput): RuntimeSourceFactRecord {
  return {
    scope: input.scope,
    scopeKey: "app-global",
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    path: input.path,
    sourceVersion: input.sourceVersion,
    fingerprint: input.fingerprint,
    diagnostics: input.diagnostics,
    sourceCommandId: input.sourceCommandId ?? null,
    createdAt: input.savedAt,
    updatedAt: input.savedAt,
    deletedAt: null,
  };
}

function sourceStatePort(
  overrides: {
    readonly read?: (sourceId: string) => RuntimeSourceFactRecord | null;
    readonly save?: (input: RecordRuntimeSourceSaveInput) => RuntimeSourceFactRecord;
    readonly workflowSave?: (
      input: RecordRuntimeWorkflowAgentSourceSaveInput,
    ) => RuntimeSourceFactRecord;
    readonly delete?: (input: RecordRuntimeSourceDeleteInput) => RuntimeSourceFactRecord;
    readonly saveFailure?: StateContractError;
  } = {},
): RuntimeSourceStatePortService {
  return {
    readSourceVersion: (input) => Effect.sync(() => overrides.read?.(input.sourceId) ?? null),
    recordSourceSave: (input) =>
      overrides.saveFailure
        ? Effect.fail(overrides.saveFailure)
        : Effect.sync(() => ({
            value: overrides.save?.(input) ?? runtimeSourceFactFromSave(input),
            afterCommit: [sourceFactInvalidation],
          })),
    recordSourceDelete: (input) =>
      Effect.sync(() => ({
        value:
          overrides.delete?.(input) ??
          runtimeSourceFact(
            {
              sourceKind: input.sourceKind,
              sourceId: input.sourceId,
              path: input.path,
              sourceVersion: input.previousSourceVersion,
              fingerprint: input.previousFingerprint,
              text: "",
              diagnostics: [],
            },
            input.deletedAt,
          ),
        afterCommit: [sourceFactInvalidation],
      })),
    recordWorkflowAgentSourceSave: (input) =>
      overrides.saveFailure
        ? Effect.fail(overrides.saveFailure)
        : Effect.sync(() => ({
            value:
              overrides.workflowSave?.(input) ??
              overrides.save?.(input.source) ??
              runtimeSourceFactFromSave(input.source),
            afterCommit: [sourceFactInvalidation],
          })),
    recordWorkflowAgentSourceDelete: (input) =>
      Effect.sync(() => ({
        value:
          overrides.delete?.(input.source) ??
          runtimeSourceFact(
            {
              sourceKind: input.source.sourceKind,
              sourceId: input.source.sourceId,
              path: input.source.path,
              sourceVersion: input.source.previousSourceVersion,
              fingerprint: input.source.previousFingerprint,
              text: "",
              diagnostics: [],
            },
            input.source.deletedAt,
          ),
        afterCommit: [sourceFactInvalidation],
      })),
    reconcileWorkflowAgentSources: () => Effect.die("unused"),
    recordSourceScan: () => Effect.die("unused"),
    reconcileDiscoveredHostSnippets: () => Effect.die("unused"),
    recordObservedSourceDeletion: () => Effect.die("unused"),
    recordSourceDiagnostic: () => Effect.die("unused"),
  };
}

function startupRuntimeSourceStatePort(): RuntimeSourceStatePortService {
  const unused = sourceStatePort();
  return {
    ...unused,
    reconcileWorkflowAgentSources: (input) =>
      Effect.succeed({
        value: {
          scope: { kind: "app-global" },
          scopeKey: "app-global",
          domain: "workflows",
          sourceFingerprint: input.sourceFingerprint,
          diagnostics: input.diagnostics,
          lastObservedPath: null,
          lastObservationKind: "scan",
          observedAt: input.scannedAt,
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        } satisfies RuntimeSourceScanFactRecord,
        afterCommit: [sourceFactInvalidation],
      }),
  };
}

function sourceInvalidationService(
  onHint: (input: SourceInvalidationHint) => void,
): RuntimeSourceInvalidationService["Service"] {
  return {
    hint: (input) => Effect.sync(() => onHint(input)),
    reconcile: () => Effect.die("unused"),
    applyCommittedScanEvent: () => Effect.die("unused"),
    refreshGeneratedContext: () => Effect.die("unused"),
    refreshGeneratedPackages: () => Effect.die("unused"),
  };
}

function runtimeRecoveryWork(input: EnsureRuntimeRecoveryWorkInput): RuntimeRecoveryWorkRecord {
  return {
    id: "recovery_source_reconcile_test" as RuntimeRecoveryWorkRecord["id"],
    scope: input.scope,
    kind: input.kind,
    status: "pending",
    ownerScope: input.ownerScope,
    idempotencyKey: input.idempotencyKey,
    orderingKey: input.orderingKey,
    orderingSeq: input.orderingSeq,
    priority: input.priority,
    availableAt: input.availableAt,
    attempts: 0,
    maxAttempts: input.maxAttempts,
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
    leaseVersion: 0,
    payloadJson: input.payloadJson ?? null,
    lastError: null,
    createdAt: input.availableAt,
    updatedAt: input.availableAt,
    completedAt: null,
  };
}

function recoveryStatePort(
  ensure: (input: EnsureRuntimeRecoveryWorkInput) => RuntimeRecoveryWorkRecord,
): RuntimeRecoveryStatePortService {
  return {
    normalizeWorkspaceRecoveryState: () => Effect.die("unused"),
    listWorkspaceRecoveryStartupSnapshots: () => Effect.die("unused"),
    ensureRecoveryWork: (input) => Effect.sync(() => ({ value: ensure(input), afterCommit: [] })),
    claimNextRecoveryWork: () => Effect.die("unused"),
    completeRecoveryWork: () => Effect.die("unused"),
    failOrRetryRecoveryWork: () => Effect.die("unused"),
  };
}

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
  readonly extensions?: ExtensionsService;
  readonly piAdapter?: PiAdapter["Service"];
  readonly providerAuthStatusState?: ProviderAuthStatusStatePortService;
  readonly modelResolver?: RuntimeLayerModelResolverPortService;
  readonly providerAuth?: RuntimeLayerProviderAuthPortService;
  readonly sourceState?: RuntimeSourceStatePortService;
  readonly recoveryState?: RuntimeRecoveryStatePortService;
  readonly recoveryWakes?: string[];
  readonly queueWakes?: Array<Parameters<RuntimeQueueWakeService["Service"]["wakeSurface"]>[0]>;
  readonly config?: Partial<typeof defaultRuntimeLayerConfig>;
  readonly failRecoveryStatusPublication?: boolean;
  readonly sourceInvalidation?: RuntimeSourceInvalidationService["Service"];
  readonly configureTypescriptApi?: RuntimeExtensionLifecycleServiceService["configureTypescriptApi"];
  readonly extensionBuild?: RuntimeExtensionBuildServiceService;
  readonly extensionSourceCoordinator?: RuntimeExtensionSourceCoordinatorService;
  readonly onRestoreOpenBlockingRequests?: () => void;
  readonly extensionUsageState?: ExtensionUsageStatePortService;
  readonly extensionContextImpact?: RuntimeExtensionContextImpactStatePortService;
}

function testRuntimeLayer(overrides: TestLayerOverrides) {
  const eventBus = RuntimeEventBus.of({
    publishLive: (input) => {
      if (input.event.type === "runtime.recovery" && overrides.failRecoveryStatusPublication) {
        return Effect.fail(
          new RuntimeEventStreamError({
            operation: "test.runtime.recovery.publish",
            reason: "stream-failed",
            message: "Recovery status publication failed.",
            latestSequence: (overrides.livePublished?.length ?? 0) as RuntimeEventSequence,
          }),
        );
      }
      return Effect.sync(() => {
        const event = {
          ...input.event,
          eventGenerationId: "runtime_layer_live_event_generation" as RuntimeEventGenerationId,
          sequence: ((overrides.livePublished?.length ?? 0) + 1) as RuntimeEventSequence,
        } satisfies RuntimeEvent;
        overrides.livePublished?.push(event);
        return event;
      });
    },
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
    Layer.provideMerge(layerRuntimeShutdownAdmission),
    Layer.provide(Layer.succeed(RuntimeEventBus, eventBus)),
    Layer.provide(
      Layer.mergeAll(
        createRuntimeLayerConfigLayer({
          ...defaultRuntimeLayerConfig,
          ...overrides.config,
        }),
        Layer.succeed(
          RuntimeExtensionBuildService,
          overrides.extensionBuild ?? {
            build: () => Effect.die("unused extension build"),
            buildOutcome: () => Effect.die("unused extension build outcome"),
          },
        ),
        Layer.succeed(RuntimeExtensionLifecycleService, {
          create: () => Effect.die("unused extension create"),
          duplicate: () => Effect.die("unused extension duplicate"),
          delete: () => Effect.die("unused extension delete"),
          reset: () => Effect.die("unused extension reset"),
          addInstruction: () => Effect.die("unused instruction add"),
          removeInstruction: () => Effect.die("unused instruction remove"),
          configureInstruction: () => Effect.die("unused instruction configure"),
          configureTypescriptApi:
            overrides.configureTypescriptApi ??
            (() => Effect.die("unused TypeScript API configure")),
          renameInstruction: () => Effect.die("unused instruction rename"),
          reorderInstructions: () => Effect.die("unused instruction reorder"),
          revertMutation: () => Effect.die("unused lifecycle revert"),
        }),
        Layer.succeed(RuntimeExtensionSnapshotService, {
          list: () => Effect.die("unused snapshot list"),
          save: () => Effect.die("unused snapshot save"),
          rename: () => Effect.die("unused snapshot rename"),
          delete: () => Effect.die("unused snapshot delete"),
          load: () => Effect.die("unused snapshot load"),
          ensureInitial: () => Effect.die("unused snapshot initial"),
          recover: () => Effect.die("unused snapshot recovery"),
          processCleanup: () => Effect.die("unused snapshot cleanup"),
        }),
        overrides.extensionSourceCoordinator
          ? Layer.succeed(RuntimeExtensionSourceCoordinator, overrides.extensionSourceCoordinator)
          : layerRuntimeExtensionSourceCoordinator,
        Layer.succeed(RuntimeGeneratedContextPreviewService, {
          preview: () => Effect.die("unused generated-context preview"),
        }),
        Layer.succeed(RuntimeSourceReconcileRecoveryWorker, {
          wake: () =>
            Effect.sync(() => {
              overrides.recoveryWakes?.push("wake");
            }),
        }),
        Layer.succeed(RuntimePromptDefaultsStatePort, {
          resolvePromptDefaults: () =>
            Effect.succeed({
              provider: "openai",
              model: "gpt-4o",
              reasoningEffort: "medium" as const,
            }),
          updatePromptDefaults: () => Effect.die("unused"),
        }),
        Layer.succeed(RuntimeComposerProfileStatePort, {
          readSurfaceProfileId: () => Effect.succeed(null),
          updateFromComposer: () => Effect.succeed({ value: false, afterCommit: [] }),
        }),
        Layer.succeed(
          RuntimeLayerProviderAuthPort,
          overrides.providerAuth ?? {
            ensureUsableProviderAuth: () => Effect.succeed("test-api-key"),
            getProviderAuthUnavailableMessage: () => "Provider auth unavailable.",
          },
        ),
        Layer.succeed(
          RuntimeLayerModelResolverPort,
          overrides.modelResolver ?? {
            resolveModel: ({ provider, model }) =>
              Effect.succeed({
                provider,
                model,
                supportedReasoning: ["off", "low", "medium", "high"],
              }),
          },
        ),
        Layer.succeed(AppLogWritePort, {
          append: () =>
            Effect.succeed({
              value: { appLogEntryId: "app_log_runtime_layer_effect" as AppLogEntryId },
              afterCommit: [],
            }),
        }),
        overrides.extensions
          ? Layer.succeed(Extensions, overrides.extensions)
          : layer.pipe(Layer.provide(testExtensionsPackageDataLayer())),
        testExtensionsPackageDataLayer(),
        Layer.succeed(RuntimePromptDefaultsService, {
          resolve: () =>
            Effect.succeed({
              provider: "openai",
              model: "gpt-4o",
              reasoningEffort: "medium" as const,
            }),
          update: () => Effect.die("unused"),
        }),
        Layer.succeed(RuntimeQueueWakeService, {
          wakeSurface: (input) =>
            Effect.sync(() => {
              overrides.queueWakes?.push(input);
            }),
        }),
        Layer.succeed(RuntimeWorkflowTaskAgentBridgeService, {
          runTaskAgent: () => Effect.die("unused"),
        }),
        Layer.succeed(RuntimeWorkflowTaskAgentBridgeBearerVerifier, {
          verify: () => Effect.succeed(true),
        }),
        Layer.succeed(ExtensionSnapshotStatePort, unusedPort("ExtensionSnapshotStatePort")),
        Layer.succeed(
          ExtensionUsageStatePort,
          overrides.extensionUsageState ?? unusedPort("ExtensionUsageStatePort"),
        ),
        Layer.succeed(
          ExtensionSnapshotSettingsStatePort,
          unusedPort("ExtensionSnapshotSettingsStatePort"),
        ),
        Layer.succeed(
          ExtensionSnapshotPayloadStorePort,
          unusedPort("ExtensionSnapshotPayloadStorePort"),
        ),
        Layer.succeed(
          ExtensionSnapshotSecretStorePort,
          unusedPort("ExtensionSnapshotSecretStorePort"),
        ),
        Layer.succeed(
          ExtensionSnapshotSecretValuesPort,
          unusedPort("ExtensionSnapshotSecretValuesPort"),
        ),
        Layer.succeed(
          RuntimeExtensionContextImpactStatePort,
          overrides.extensionContextImpact ?? unusedPort("RuntimeExtensionContextImpactStatePort"),
        ),
        Layer.succeed(RuntimeSurfaceScopeService, fakeRuntimeSurfaceScopeService()),
        Layer.succeed(
          RuntimeActorExtensionBindingStatePort,
          fakeRuntimeActorExtensionBindingStatePort(),
        ),
        Layer.succeed(
          RuntimeSourceInvalidationService,
          overrides.sourceInvalidation ?? {
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
          },
        ),
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
        Layer.succeed(
          RuntimeRequestInputWaitService,
          noRequestInputWaitService(overrides.onRestoreOpenBlockingRequests),
        ),
        layerRuntimeBunPlatform,
        overrides.piAdapter
          ? Layer.merge(testPiAdapterHostLayer(), Layer.succeed(PiAdapter, overrides.piAdapter))
          : testPiAdapterHostLayer(),
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
        Layer.succeed(RuntimeExternalInstructionScanInputPort, {
          resolve: (requestedWorkspaceId) =>
            Effect.succeed({
              workspaceId: requestedWorkspaceId,
              workspaceRoot: "/tmp/svvy-runtime-layer-effect" as AbsolutePath,
              cwd: "/tmp/svvy-runtime-layer-effect" as AbsolutePath,
              homeDirectory: "/tmp" as AbsolutePath,
              settings: DEFAULT_EXTERNAL_INSTRUCTIONS,
            }),
        }),
        Layer.succeed(RuntimeExternalInstructionStatePort, {
          reconcileExternalInstructions: ({ workspaceId: requestedWorkspaceId }) =>
            Effect.succeed({
              value: {
                changed: false,
                projection: {
                  workspaceId: requestedWorkspaceId,
                  sources: [],
                  diagnostics: [],
                  observedAt: null,
                  revision: 0 as StateRevision,
                },
              },
              afterCommit: [],
            }),
          readExternalInstructions: () =>
            Effect.die("external instruction projection read was not expected"),
        }),
        Layer.succeed(GeneratedContextPreviewSubjectStatePort, {
          readSubject: () => Effect.die("generated context preview subject read was not expected"),
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
          resolvePromptTargetWorkspaceId: () => Effect.succeed(workspaceId),
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
          readOrchestratorLifecycle: () => Effect.die("unused"),
          renameOrchestrator: () => Effect.die("unused"),
          forkOrchestrator: () => Effect.die("unused"),
          deleteOrchestrator: () => Effect.die("unused"),
        }),
        Layer.succeed(
          RuntimeSourceStatePort,
          overrides.sourceState ?? {
            readSourceVersion: () => Effect.succeed(null),
            recordSourceSave: () => Effect.die("unused"),
            recordSourceDelete: () => Effect.die("unused"),
            recordWorkflowAgentSourceSave: () => Effect.die("unused"),
            recordWorkflowAgentSourceDelete: () => Effect.die("unused"),
            reconcileWorkflowAgentSources: () => Effect.die("unused"),
            recordSourceScan: () => Effect.die("unused"),
            reconcileDiscoveredHostSnippets: () => Effect.die("unused"),
            recordObservedSourceDeletion: () => Effect.die("unused"),
            recordSourceDiagnostic: () => Effect.die("unused"),
          },
        ),
        Layer.succeed(
          RuntimeRecoveryStatePort,
          overrides.recoveryState ?? unusedPort("RuntimeRecoveryStatePort"),
        ),
        Layer.succeed(
          ProviderAuthStatusStatePort,
          overrides.providerAuthStatusState ?? {
            listProviderStatuses: () => Effect.succeed([]),
            recordProviderStatus: () => Effect.die("unused"),
          },
        ),
        Layer.succeed(RuntimeQueueStatePort, unusedPort("RuntimeQueueStatePort")),
        Layer.succeed(RuntimeRequestStatePort, unusedPort("RuntimeRequestStatePort")),
        Layer.succeed(RuntimeApprovalStatePort, emptyApprovalStatePort()),
        Layer.succeed(RuntimeCommandStatePort, testRuntimeCommandStatePort(overrides)),
        Layer.succeed(RuntimeComposerDraftStatePort, unusedPort("RuntimeComposerDraftStatePort")),
        Layer.succeed(
          RuntimeGeneratedPackageStatePort,
          unusedPort("RuntimeGeneratedPackageStatePort"),
        ),
        Layer.succeed(RuntimeSessionWaitStatePort, unusedPort("RuntimeSessionWaitStatePort")),
        Layer.succeed(RuntimeTranscriptStatePort, testRuntimeTranscriptStatePort()),
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
          updatePromptDefaults: () => Effect.die("unused"),
        }),
        Layer.succeed(RuntimeComposerProfileStatePort, {
          readSurfaceProfileId: () => Effect.succeed(null),
          updateFromComposer: () => Effect.succeed({ value: false, afterCommit: [] }),
        }),
        Layer.succeed(RuntimeLayerProviderAuthPort, {
          ensureUsableProviderAuth: () => Effect.succeed("test-api-key"),
          getProviderAuthUnavailableMessage: () => "Provider auth unavailable.",
        }),
        Layer.succeed(RuntimeLayerModelResolverPort, {
          resolveModel: ({ provider, model }) =>
            Effect.succeed({
              provider,
              model,
              supportedReasoning: ["off", "low", "medium", "high"],
            }),
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
        Layer.succeed(ExtensionSnapshotStatePort, unusedPort("ExtensionSnapshotStatePort")),
        Layer.succeed(ExtensionUsageStatePort, unusedPort("ExtensionUsageStatePort")),
        Layer.succeed(
          ExtensionSnapshotSettingsStatePort,
          unusedPort("ExtensionSnapshotSettingsStatePort"),
        ),
        Layer.succeed(
          ExtensionSnapshotPayloadStorePort,
          unusedPort("ExtensionSnapshotPayloadStorePort"),
        ),
        Layer.succeed(
          ExtensionSnapshotSecretStorePort,
          unusedPort("ExtensionSnapshotSecretStorePort"),
        ),
        Layer.succeed(
          ExtensionSnapshotSecretValuesPort,
          unusedPort("ExtensionSnapshotSecretValuesPort"),
        ),
        Layer.succeed(
          RuntimeExtensionContextImpactStatePort,
          unusedPort("RuntimeExtensionContextImpactStatePort"),
        ),
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
            registry: {
              observe: () =>
                Effect.succeed({
                  aggregateFingerprint: "runtime_layer_registry_fingerprint",
                  observations: [],
                  diagnostics: [],
                }),
            },
            builds: {
              observeCurrent: ({
                registryObservation,
              }: Parameters<Extensions["Service"]["builds"]["observeCurrent"]>[0]) =>
                Effect.succeed({
                  registryAggregateFingerprint: registryObservation.aggregateFingerprint,
                  observations: [],
                }),
            },
            dependencies: {
              refreshReadiness: ({
                registryObservation,
              }: Parameters<Extensions["Service"]["dependencies"]["refreshReadiness"]>[0]) =>
                Effect.succeed({
                  registryAggregateFingerprint: registryObservation.aggregateFingerprint,
                  readiness: [],
                }),
            },
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
            externalInstructions: {
              scan: () => Effect.succeed({ sources: [], contents: [], diagnostics: [] }),
              resolveSource: () => Effect.die("unused"),
              saveSource: () => Effect.die("unused"),
            },
            sources: {
              openEditSession: () => Effect.die("unused"),
              saveEditSession: () => Effect.die("unused"),
              createWorkflowAgent: () => Effect.die("unused"),
              duplicateWorkflowAgent: () => Effect.die("unused"),
              deleteWorkflowAgent: () => Effect.die("unused"),
              scanWorkflowAgents: () => Effect.succeed([]),
              scaffoldMissingWorkflowAgents: () => Effect.succeed({ created: [], preserved: [] }),
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
        Layer.succeed(RuntimeExternalInstructionScanInputPort, {
          resolve: (requestedWorkspaceId) =>
            Effect.succeed({
              workspaceId: requestedWorkspaceId,
              workspaceRoot: "/tmp/svvy-runtime-layer-effect" as AbsolutePath,
              cwd: "/tmp/svvy-runtime-layer-effect" as AbsolutePath,
              homeDirectory: "/tmp" as AbsolutePath,
              settings: DEFAULT_EXTERNAL_INSTRUCTIONS,
            }),
        }),
        Layer.succeed(RuntimeExternalInstructionStatePort, {
          reconcileExternalInstructions: ({ workspaceId: requestedWorkspaceId }) =>
            Effect.succeed({
              value: {
                changed: false,
                projection: {
                  workspaceId: requestedWorkspaceId,
                  sources: [],
                  diagnostics: [],
                  observedAt: null,
                  revision: 0 as StateRevision,
                },
              },
              afterCommit: [],
            }),
          readExternalInstructions: () =>
            Effect.die("external instruction projection read was not expected"),
        }),
        Layer.succeed(GeneratedContextPreviewSubjectStatePort, {
          readSubject: () => Effect.die("unused generated context preview subject"),
        }),
        Layer.succeed(RuntimeExtensionStatePort, {
          readBuildAttemptByClientRequestId: () => Effect.succeed(null),
          reconcileRegistryObservation: ({ observation, observedAt }) =>
            Effect.succeed({
              value: { observation, observedAt },
              afterCommit: [{ scope: "app", invalidation: { model: "extensions" } }],
            }),
          reconcileBuildEvidence: () => Effect.die("unused extension build evidence"),
          startBuildAttempt: () => Effect.die("unused extension build attempt start"),
          recordBuildSuccess: () => Effect.die("unused extension build success"),
          recordBuildFailure: () => Effect.die("unused extension build failure"),
          reconcileDependencyReadiness: ({ readiness }) =>
            Effect.succeed({
              value: { changed: false, readiness },
              afterCommit: [],
            }),
          recordDependencyApproval: () => Effect.die("unused dependency approval"),
          recordDependencyReadiness: () => Effect.die("unused dependency readiness"),
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
        Layer.succeed(RuntimeSourceStatePort, startupRuntimeSourceStatePort()),
        Layer.succeed(RuntimeRecoveryStatePort, {
          normalizeWorkspaceRecoveryState: () =>
            Effect.succeed({ value: undefined, afterCommit: [] }),
          listWorkspaceRecoveryStartupSnapshots: () => Effect.succeed([]),
          ensureRecoveryWork: () => Effect.die("unused"),
          claimNextRecoveryWork: () =>
            Effect.succeed({
              value: null,
              afterCommit: [],
            }),
          completeRecoveryWork: () => Effect.die("unused"),
          failOrRetryRecoveryWork: () => Effect.die("unused"),
        }),
        Layer.succeed(ProviderAuthStatusStatePort, {
          listProviderStatuses: () => Effect.succeed([]),
          recordProviderStatus: () => Effect.die("unused"),
        }),
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
        Layer.succeed(RuntimeComposerDraftStatePort, unusedPort("RuntimeComposerDraftStatePort")),
        Layer.succeed(RuntimeGeneratedPackageStatePort, testRuntimeGeneratedPackageStatePort()),
        Layer.succeed(RuntimeSessionWaitStatePort, unusedPort("RuntimeSessionWaitStatePort")),
        Layer.succeed(RuntimeTranscriptStatePort, testRuntimeTranscriptStatePort()),
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

function testRuntimeTranscriptStatePort(): RuntimeTranscriptStatePortService {
  let cursor: RuntimeTranscriptStreamCursor | null = null;
  return {
    readSurfaceTranscript: (input) =>
      Effect.succeed({
        surfacePiSessionId: input.surfacePiSessionId,
        messages: [],
        activeAssistantMessage: null,
        streamCursor: cursor,
      }),
    advanceStreamCursor: (input) =>
      Effect.sync(() => {
        cursor = {
          surfacePiSessionId: input.surfacePiSessionId,
          streamGenerationId: input.streamGenerationId,
          streamSequence: (cursor?.streamGenerationId === input.streamGenerationId
            ? cursor.streamSequence + 1
            : 1) as never,
        };
        return { value: cursor, afterCommit: [] };
      }),
    commitUserMessage: () => Effect.die("Unexpected transcript user commit."),
    beginAssistantMessage: () => Effect.die("Unexpected transcript assistant begin."),
    appendAssistantContentDelta: () => Effect.die("Unexpected transcript delta."),
    upsertAssistantToolCall: () => Effect.die("Unexpected transcript tool call."),
    linkAssistantToolCallCommand: () => Effect.die("Unexpected transcript tool link."),
    commitAssistantMessage: () => Effect.die("Unexpected transcript assistant commit."),
    failAssistantMessage: () => Effect.die("Unexpected transcript assistant failure."),
    bindPiHistoryEntry: () => Effect.die("Unexpected transcript history binding."),
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

function noRequestInputWaitService(
  onRestoreOpenBlockingRequests?: () => void,
): RuntimeRequestInputWaitService["Service"] {
  return RuntimeRequestInputWaitService.of({
    waitForBlockingRequest: () => Effect.die("Unexpected request-input blocking wait."),
    afterAnswerCommitted: () => Effect.die("Unexpected request-input answer post-commit."),
    afterTimerPausedCommitted: () => Effect.die("Unexpected request-input timer post-commit."),
    restoreOpenBlockingRequests: () => Effect.sync(() => onRestoreOpenBlockingRequests?.()),
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
