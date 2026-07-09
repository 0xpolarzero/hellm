import { getModel } from "@mariozechner/pi-ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import {
  AppLogWritePort,
  ExtensionError as CoreExtensionError,
  ExtensionStatePort,
  RuntimeContractError,
  RuntimePromptDefaultsStatePort,
  SandboxPolicySource,
  type AbsolutePath,
  type AppLogWritePortService,
  type BuildLaunchPolicyInput,
  type ExtensionStatePortService,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type GeneratedPackagesRefreshResult,
  type InternalRefreshGeneratedPackagesRequest,
  type PromptTarget,
  type RefreshGeneratedContextRequest,
  type SandboxLaunchFacts,
  type SandboxPolicySourceService,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type TurnId,
  type WorkspaceId,
} from "@svvy/core";
import type { ExtensionSourceRoots, GeneratedPackageRoots } from "@svvy/extensions";
import {
  layer as extensionsLayer,
  layerExtensionSourceRootsPort,
  layerGeneratedPackageRootPort,
  layerPackagedExtensionTemplatesPort,
  layerWorkspaceSourceLinkPort,
} from "@svvy/extensions";
import { HostProcessReferencePort, SandboxHelperCandidatesPort } from "@svvy/sandbox";
import { createRuntimeFacade, Runtime } from "@svvy/runtime";
import {
  acquireAcceptedDirectToolLaunch,
  requestAcceptedDirectToolApproval,
  runAcceptedLoadExtension,
  runAcceptedRequestUserInput,
} from "@svvy/runtime/accepted-native-tool-execution";
import {
  awaitRuntimeStartupReadiness,
  createRuntimeLayerConfigLayer,
  layerRuntimeBunPlatform,
  prepareRuntimeShutdown,
  RuntimeGeneratedContextRefreshHostPort,
  RuntimeGeneratedPackageRefreshHostPort,
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  RuntimeLayerModelResolverPort,
  RuntimeLayerPromptControlHostPort,
  RuntimeLayerProviderAuthPort,
  RuntimeLayerSurfaceQueueWakePort,
  RuntimeSourceInvalidationScanPort,
  type RuntimeGeneratedPackageRefreshHostPortService,
  type RuntimeLayerCommandControlPortService,
  type RuntimeLayerCommandStdinPortService,
  type RuntimeLayerConfig,
  type RuntimePrepareShutdownReason,
  type RuntimeSourceInvalidationEvent,
  type RuntimeSourceInvalidationScanPortService,
  type RuntimeStartupReadinessReceipt,
} from "@svvy/runtime/bootstrap";
import {
  createWorkspaceStateRouter,
  layerWorkspaceStateRouter,
  type WorkspaceStateRegistration,
} from "@svvy/state/structured-session-adapters";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import type { RunAcceptedLoadExtension } from "./extension-tools";
import type { RunAcceptedRequestUserInput } from "./request-user-input-tool";
import type { PackagedSandboxHostSupportServices } from "./runtime-service-adapter";

type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;

export type AppRuntimeBootstrapWorkspaceStateInput =
  | WorkspaceStateRegistration
  | { workspaceStateRouterRegistration(): WorkspaceStateRegistration };

export interface AppRuntimeBootstrapWorkspaceExecutor {
  cancelActivePrompt(input: {
    readonly target: PromptTarget;
    readonly turnId: TurnId;
  }): Promise<void>;
  cancelPrompt(target: PromptTarget): Promise<void>;
  wakeRuntimeSurfaceQueue(input: {
    readonly target: PromptTarget;
    readonly reason: Parameters<
      import("@svvy/runtime/bootstrap").RuntimeLayerSurfaceQueueWakePortService["wakeSurfaceQueue"]
    >[0]["reason"];
  }): Promise<void>;
}

export interface AppRuntimeBootstrapSourceInvalidationCoordinator {
  classifyHint(input: SourceInvalidationHint): Promise<"scan" | "scan-parent-domain" | "ignore">;
  reconcile(input: {
    readonly domains?: SourceReconcileRequest["domains"];
    readonly reason: string;
  }): Promise<RuntimeSourceInvalidationEvent | null>;
  requestScan(input: {
    readonly domains?: SourceReconcileRequest["domains"];
    readonly reason: string;
  }): Promise<void>;
}

export interface AppRuntimeBootstrapInput {
  readonly appGlobalState: AppRuntimeBootstrapWorkspaceStateInput;
  readonly workspaceStates: readonly AppRuntimeBootstrapWorkspaceStateInput[];
  readonly sourceRoots: ExtensionSourceRoots;
  readonly generatedPackageRoots: GeneratedPackageRoots;
  readonly extensionStatePort: ExtensionStatePortService;
  readonly generatedPackageLinkPath: (
    input: GeneratedPackageWorkspaceLinkRepairInput,
  ) => Promise<AbsolutePath>;
  readonly sandboxPolicySource: SandboxPolicySourceService;
  readonly appLogWritePort: AppLogWritePortService;
  readonly sandboxHostSupport: PackagedSandboxHostSupportServices;
  readonly runtimeLayerConfig: RuntimeLayerConfig;
  readonly commandRegistry: RuntimeLayerCommandStdinPortService &
    RuntimeLayerCommandControlPortService;
  readonly providerAuth: {
    ensureUsableProviderAuth(provider: string): Promise<string | undefined>;
    getProviderAuthUnavailableMessage(provider: string): string;
  };
  readonly workspaceExecutors: {
    resolvePromptTarget(target: PromptTarget): Promise<AppRuntimeBootstrapWorkspaceExecutor>;
  };
  readonly generatedContextRefresh: {
    refresh(input: RefreshGeneratedContextRequest): Promise<void>;
  };
  readonly generatedPackageRefresh: RuntimeGeneratedPackageRefreshHostPortService;
  readonly sourceInvalidation: {
    readonly appGlobalCoordinator: AppRuntimeBootstrapSourceInvalidationCoordinator;
    listAcquiredWorkspaceIds(): Promise<readonly WorkspaceId[]> | readonly WorkspaceId[];
    resolveWorkspaceCoordinator(
      workspaceId: WorkspaceId,
    ): Promise<AppRuntimeBootstrapSourceInvalidationCoordinator>;
  };
}

export interface AppRuntimeBootstrap {
  readonly facade: RuntimeFacade;
  readonly readiness: RuntimeStartupReadinessReceipt;
  readonly internal: {
    readonly launchFacts: {
      acquireDirectToolLaunch(
        input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
          readonly toolName: "exec_command" | "apply_patch" | "execute_typescript";
        },
      ): Promise<{
        readonly facts: SandboxLaunchFacts;
        close(): Promise<void>;
      }>;
      acquireExecuteTypescript(input: Omit<BuildLaunchPolicyInput, "launchKind">): Promise<{
        readonly facts: SandboxLaunchFacts;
        close(): Promise<void>;
      }>;
    };
    readonly sourceInvalidation: {
      refreshGeneratedPackages(
        input: InternalRefreshGeneratedPackagesRequest,
      ): Promise<GeneratedPackagesRefreshResult>;
    };
    readonly acceptedNativeTools: {
      readonly requestDirectToolApproval: RuntimeApprovalBoundary;
      readonly runLoadExtension: RunAcceptedLoadExtension;
      readonly runRequestUserInput: RunAcceptedRequestUserInput;
    };
  };
  dispose(): Promise<void>;
}

export async function createAppRuntimeBootstrap(
  input: AppRuntimeBootstrapInput,
): Promise<AppRuntimeBootstrap> {
  const workspaceRouter = createWorkspaceStateRouter({
    appGlobalStore: workspaceStateRegistration(input.appGlobalState).store,
    workspaceStores: input.workspaceStates.map(workspaceStateRegistration),
  });
  const workspaceStateLayer = layerWorkspaceStateRouter(workspaceRouter);
  const sandboxHostSupport = input.sandboxHostSupport;
  const extensionPackageLayer = Layer.mergeAll(
    layerRuntimeBunPlatform,
    Layer.succeed(ExtensionStatePort, input.extensionStatePort),
    layerExtensionSourceRootsPort(input.sourceRoots),
    layerGeneratedPackageRootPort(input.generatedPackageRoots),
    layerPackagedExtensionTemplatesPort({
      builtinExtensionsRoot: input.sourceRoots.extensionsRoot,
    }),
    layerWorkspaceSourceLinkPort({
      generatedPackageLinkPath: (linkInput) =>
        Effect.tryPromise({
          try: () => input.generatedPackageLinkPath(linkInput),
          catch: (cause) =>
            new CoreExtensionError({
              operation: "runtime.generated-packages.workspace-link-path",
              reason: "execution-failed",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Generated package workspace link path resolution failed.",
              cause,
            }),
        }),
    }),
  );
  const runtimeHostLayer = Layer.mergeAll(
    extensionsLayer.pipe(Layer.provide(extensionPackageLayer)),
    layerRuntimeBunPlatform,
    Layer.succeed(SandboxPolicySource, input.sandboxPolicySource),
    Layer.succeed(SandboxHelperCandidatesPort, sandboxHostSupport.helperCandidates),
    Layer.succeed(HostProcessReferencePort, sandboxHostSupport.hostProcess),
    layerExtensionSourceRootsPort(input.sourceRoots),
    Layer.succeed(RuntimeLayerPromptControlHostPort, {
      cancelActivePrompt: (request) =>
        Effect.tryPromise({
          try: async () => {
            const executor = await input.workspaceExecutors.resolvePromptTarget(request.target);
            await executor.cancelActivePrompt(request);
          },
          catch: (cause) => runtimeBootstrapError("runtime.messages.abort.active", cause),
        }),
      cancelPrompt: (target) =>
        Effect.tryPromise({
          try: async () => {
            const executor = await input.workspaceExecutors.resolvePromptTarget(target);
            await executor.cancelPrompt(target);
          },
          catch: (cause) => runtimeBootstrapError("runtime.messages.abort", cause),
        }),
    }),
    Layer.succeed(RuntimePromptDefaultsStatePort, workspaceRouter.promptDefaults),
    Layer.succeed(RuntimeLayerSurfaceQueueWakePort, {
      wakeSurfaceQueue: (request) =>
        Effect.tryPromise({
          try: async () => {
            const executor = await input.workspaceExecutors.resolvePromptTarget(request.target);
            await executor.wakeRuntimeSurfaceQueue(request);
          },
          catch: (cause) => runtimeBootstrapError("runtime.queueWake.wakeSurface", cause),
        }),
    }),
    workspaceStateLayer,
    Layer.succeed(RuntimeLayerProviderAuthPort, {
      ensureUsableProviderAuth: (provider) =>
        Effect.tryPromise({
          try: () => input.providerAuth.ensureUsableProviderAuth(provider),
          catch: (cause) => runtimeBootstrapError("runtime.messages.submit.providerAuth", cause),
        }),
      getProviderAuthUnavailableMessage: input.providerAuth.getProviderAuthUnavailableMessage,
    }),
    Layer.succeed(RuntimeLayerModelResolverPort, {
      resolveModelId: ({ provider, model }) =>
        Effect.try({
          try: () =>
            getModel(
              provider as Parameters<typeof getModel>[0],
              model as Parameters<typeof getModel>[1],
            ).id,
          catch: (cause) => runtimeBootstrapError("runtime.model.resolve", cause),
        }),
    }),
    Layer.succeed(AppLogWritePort, input.appLogWritePort),
    Layer.succeed(RuntimeGeneratedContextRefreshHostPort, input.generatedContextRefresh),
    Layer.succeed(RuntimeGeneratedPackageRefreshHostPort, input.generatedPackageRefresh),
    Layer.succeed(RuntimeSourceInvalidationScanPort, createSourceInvalidationScanPort(input)),
    Layer.succeed(RuntimeLayerCommandStdinPort, input.commandRegistry),
    Layer.succeed(RuntimeLayerCommandControlPort, input.commandRegistry),
  );
  const runtimeLayerConfig = createRuntimeLayerConfigLayer(input.runtimeLayerConfig);
  const managedRuntime = ManagedRuntime.make(
    Layer.mergeAll(Runtime.layer.pipe(Layer.provide(runtimeLayerConfig)), runtimeLayerConfig).pipe(
      Layer.provide(runtimeHostLayer),
    ),
  );
  let runtimeServiceAcquired = false;
  try {
    await managedRuntime.context();
    runtimeServiceAcquired = true;
    const readiness = await awaitRuntimeStartupReadiness(managedRuntime);
    const facade = createRuntimeFacade(managedRuntime);
    const acquireDirectToolLaunch = (
      request: Omit<BuildLaunchPolicyInput, "launchKind"> & {
        readonly toolName: "exec_command" | "apply_patch" | "execute_typescript";
      },
    ) => acquireAcceptedDirectToolLaunch(managedRuntime, request);
    return {
      facade,
      readiness,
      internal: {
        launchFacts: {
          acquireDirectToolLaunch,
          acquireExecuteTypescript: (request) =>
            acquireDirectToolLaunch({ ...request, toolName: "execute_typescript" }),
        },
        sourceInvalidation: {
          refreshGeneratedPackages: (request) =>
            managedRuntime.runPromise(
              Effect.gen(function* () {
                const runtime = yield* Runtime;
                return yield* runtime.sourceInvalidation.refreshGeneratedPackages(request);
              }) as Effect.Effect<GeneratedPackagesRefreshResult, unknown, never>,
            ),
        },
        acceptedNativeTools: {
          requestDirectToolApproval: (request) =>
            requestAcceptedDirectToolApproval(managedRuntime, request),
          runLoadExtension: (request) => runAcceptedLoadExtension(managedRuntime, request),
          runRequestUserInput: (request) => runAcceptedRequestUserInput(managedRuntime, request),
        },
      },
      dispose: async () => {
        try {
          await prepareShutdown(managedRuntime, "app-shutdown");
          await facade.close();
        } finally {
          await disposeManagedRuntime(managedRuntime);
        }
      },
    };
  } catch (cause) {
    try {
      if (runtimeServiceAcquired) {
        await prepareShutdown(managedRuntime, "startup-failure");
      }
    } finally {
      await disposeManagedRuntime(managedRuntime);
    }
    throw cause;
  }
}

function workspaceStateRegistration(
  input: AppRuntimeBootstrapWorkspaceStateInput,
): WorkspaceStateRegistration {
  if ("workspaceStateRouterRegistration" in input) {
    return input.workspaceStateRouterRegistration();
  }
  return input;
}

function createSourceInvalidationScanPort(
  input: AppRuntimeBootstrapInput,
): RuntimeSourceInvalidationScanPortService {
  const resolveCoordinator = async (scope: SourceReconcileRequest["scope"]) => {
    if (scope.kind === "app-global") return input.sourceInvalidation.appGlobalCoordinator;
    return await input.sourceInvalidation.resolveWorkspaceCoordinator(scope.workspaceId);
  };
  return {
    classifyHint: (request) =>
      Effect.tryPromise({
        try: async () => {
          const coordinator = await resolveCoordinator(request.scope);
          return await coordinator.classifyHint(request);
        },
        catch: (cause) => runtimeBootstrapError("runtime.sourceInvalidation.hint", cause),
      }),
    listAcquiredWorkspaceIds: () =>
      Effect.tryPromise({
        try: () => Promise.resolve(input.sourceInvalidation.listAcquiredWorkspaceIds()),
        catch: (cause) =>
          runtimeBootstrapError("runtime.sourceInvalidation.listAcquiredWorkspaceIds", cause),
      }),
    requestScan: (request) =>
      Effect.tryPromise({
        try: async () => {
          const coordinator = await resolveCoordinator(request.scope);
          await coordinator.requestScan({
            domains: request.domains,
            reason: `runtime_source_hint:${request.reason}`,
          });
        },
        catch: (cause) => runtimeBootstrapError("runtime.sourceInvalidation.hint", cause),
      }),
    reconcile: (request) =>
      Effect.tryPromise({
        try: async () => {
          const coordinator = await resolveCoordinator(request.scope);
          return await coordinator.reconcile({
            domains: request.domains,
            reason: `runtime_source_reconcile:${request.reason}`,
          });
        },
        catch: (cause) => runtimeBootstrapError("runtime.sourceInvalidation.reconcile", cause),
      }),
  };
}

async function prepareShutdown(
  managedRuntime: Parameters<typeof prepareRuntimeShutdown>[0],
  reason: RuntimePrepareShutdownReason,
): Promise<void> {
  await prepareRuntimeShutdown(managedRuntime, { reason });
}

async function disposeManagedRuntime<R, E>(
  managedRuntime: ManagedRuntime.ManagedRuntime<R, E>,
): Promise<void> {
  await managedRuntime.dispose();
}

function runtimeBootstrapError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  return new RuntimeContractError({
    operation,
    reason: "state-conflict",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}
