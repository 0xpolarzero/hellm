import { getModel } from "@mariozechner/pi-ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import {
  AppLogWritePort,
  ExtensionError as CoreExtensionError,
  ExtensionStatePort,
  PiAdapterError,
  PiRuntimePathsPort,
  ProviderAuthPort,
  ProviderAuthPortError,
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort,
  RuntimePromptDefaultsStatePort,
  StateContractError,
  SandboxPolicySource,
  type AbsolutePath,
  type AuthenticatedRunTaskAgentInput,
  type AppLogWritePortService,
  type BuildLaunchPolicyInput,
  type ExtensionStatePortService,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type GeneratedPackagesRefreshResult,
  type InternalRefreshGeneratedPackagesRequest,
  type JsonValue,
  type ProviderId,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeClientRequestId,
  type RuntimeClientSubmissionSource,
  type RefreshGeneratedContextRequest,
  type RunTaskAgentResult,
  type SandboxLaunchFacts,
  type SandboxPolicySourceService,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type WorkspaceId,
  type PiRuntimePathsSnapshot,
} from "@svvy/core";
import { layer as PiAdapterLayer } from "@svvy/pi-adapter";
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
  RuntimeLayerProviderAuthPort,
  RuntimeSourceInvalidationScanPort,
  RuntimeWorkflowTaskAgentBridgeBearerVerifier,
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
  stateCommandsFromRouter,
  stateReadModelsFromRouter,
  type WorkspaceStateRegistration,
} from "@svvy/state/structured-session-adapters";
import {
  createStateCommandsFacade,
  createStateFacade,
  StateCommands,
  StateReadModels,
  type StateAppLogsFacade,
} from "@svvy/state";
import type { AppPreferences } from "../shared/agent-settings";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import type { RunAcceptedLoadExtension } from "./extension-tools";
import type { RunAcceptedRequestUserInput } from "./request-user-input-tool";
import { AppLifecycleCoordinator } from "./app-lifecycle-coordinator";
import type { PackagedSandboxHostSupportServices } from "./runtime-service-adapter";
import {
  narrowRendererStateCommandsFacade,
  narrowRendererStateFacade,
  type RendererStateCommandsFacade,
  type RendererStateFacade,
} from "./renderer-state-facade";

type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;
type StateFacade = ReturnType<typeof createStateFacade>;
type StateCommandsFacade = ReturnType<typeof createStateCommandsFacade>;

function usableProviderAuthSnapshot(input: {
  readonly providerId: ProviderId;
  readonly workspaceId?: WorkspaceId;
  readonly accessToken: string;
}) {
  return {
    providerId: input.providerId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    health: "usable" as const,
    accessToken: Redacted.make(input.accessToken),
    credentialFingerprint: `runtime:${input.providerId}`,
  };
}

export type AppRuntimeBootstrapWorkspaceStateInput =
  | WorkspaceStateRegistration
  | { workspaceStateRouterRegistration(): WorkspaceStateRegistration };

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
  readonly appLogs: Pick<
    StateAppLogsFacade,
    "append" | "query" | "summary" | "markSeen" | "subscribe"
  >;
  readonly resolveWorkspaceAppLogs?: (
    workspaceId: WorkspaceId,
  ) => Promise<Pick<StateAppLogsFacade, "append" | "query" | "summary" | "markSeen" | "subscribe">>;
  readonly appLogWritePort: AppLogWritePortService;
  readonly sandboxHostSupport: PackagedSandboxHostSupportServices;
  readonly runtimeLayerConfig: RuntimeLayerConfig;
  readonly commandRegistry: RuntimeLayerCommandStdinPortService &
    RuntimeLayerCommandControlPortService;
  readonly providerAuth: {
    ensureUsableProviderAuth(provider: string): Promise<string | undefined>;
    getProviderAuthUnavailableMessage(provider: string): string;
  };
  readonly piRuntimePaths: {
    resolve(workspaceId: WorkspaceId): Promise<PiRuntimePathsSnapshot>;
  };
  readonly generatedContextRefresh: {
    refresh(input: RefreshGeneratedContextRequest): Promise<void>;
  };
  readonly generatedPackageRefresh: RuntimeGeneratedPackageRefreshHostPortService;
  readonly generatedPackageStatePort?: Pick<
    RuntimeGeneratedPackageStatePortService,
    "markWorkspaceLinksRepairNeeded" | "recordWorkspaceLinkStatus"
  >;
  readonly sourceInvalidation: {
    readonly appGlobalCoordinator: AppRuntimeBootstrapSourceInvalidationCoordinator;
    listAcquiredWorkspaceIds(): Promise<readonly WorkspaceId[]> | readonly WorkspaceId[];
    resolveWorkspaceCoordinator(
      workspaceId: WorkspaceId,
    ): Promise<AppRuntimeBootstrapSourceInvalidationCoordinator>;
  };
  readonly workflowTaskAgentBridge?: {
    verifyBearerLineage(input: {
      readonly bearerToken: string;
      readonly workspaceSessionId: string;
      readonly sourceCommandId: string;
    }): Promise<boolean> | boolean;
  };
  readonly appPreferencesSeed?: {
    hasStateRows(): boolean;
    read(): AppPreferences;
  };
}

export interface AppRuntimeBootstrap {
  readonly facade: RuntimeFacade;
  readonly state: StateFacade;
  readonly stateCommands: StateCommandsFacade;
  readonly rendererState: RendererStateFacade;
  readonly rendererStateCommands: RendererStateCommandsFacade;
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
    readonly workflowTaskAgentBridge: {
      runTaskAgent(input: AuthenticatedRunTaskAgentInput): Promise<RunTaskAgentResult>;
    };
    readonly workspaceStates: {
      register(input: AppRuntimeBootstrapWorkspaceStateInput): void;
      unregister(workspaceId: WorkspaceId): boolean;
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
  const lifecycle = new AppLifecycleCoordinator();
  const workspaceStateLayer = layerWorkspaceStateRouter(workspaceRouter);
  const appLogState = appLogStateServiceFromFacade(input.appLogs);
  const resolveAppLogState = (
    workspaceId: WorkspaceId | undefined,
  ): Effect.Effect<typeof appLogState, StateContractError> => {
    if (!workspaceId || !input.resolveWorkspaceAppLogs) {
      return Effect.succeed(appLogState);
    }
    return Effect.tryPromise({
      try: async () =>
        appLogStateServiceFromFacade(await input.resolveWorkspaceAppLogs!(workspaceId)),
      catch: (cause) =>
        new StateContractError({
          operation: "app-runtime-bootstrap.resolveWorkspaceAppLogs",
          reason: "not-found",
          message: `App runtime bootstrap could not resolve app logs for workspace ${workspaceId}.`,
          cause,
        }),
    });
  };
  const stateFacadeServicesLayer = Layer.mergeAll(
    Layer.succeed(
      StateReadModels,
      stateReadModelsFromRouter({
        router: workspaceRouter,
        appLogs: appLogState,
        resolveAppLogs: resolveAppLogState,
      }),
    ),
    Layer.succeed(
      StateCommands,
      stateCommandsFromRouter({
        router: workspaceRouter,
        appLogs: appLogState,
        resolveAppLogs: resolveAppLogState,
      }),
    ),
  );
  const generatedPackageStatePort = createGeneratedPackageStatePort({
    routerPort: workspaceRouter.generatedPackage,
    unopenedWorkspaceFallback: input.generatedPackageStatePort,
  });
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
    PiAdapterLayer,
    layerRuntimeBunPlatform,
    Layer.succeed(SandboxPolicySource, input.sandboxPolicySource),
    Layer.succeed(SandboxHelperCandidatesPort, sandboxHostSupport.helperCandidates),
    Layer.succeed(HostProcessReferencePort, sandboxHostSupport.hostProcess),
    layerExtensionSourceRootsPort(input.sourceRoots),
    Layer.succeed(RuntimePromptDefaultsStatePort, workspaceRouter.promptDefaults),
    workspaceStateLayer,
    Layer.succeed(RuntimeLayerProviderAuthPort, {
      ensureUsableProviderAuth: (provider) =>
        Effect.tryPromise({
          try: () => input.providerAuth.ensureUsableProviderAuth(provider),
          catch: (cause) => runtimeBootstrapError("runtime.messages.submit.providerAuth", cause),
        }),
      getProviderAuthUnavailableMessage: input.providerAuth.getProviderAuthUnavailableMessage,
    }),
    Layer.succeed(ProviderAuthPort, {
      getProviderAuthSnapshot: ({ providerId, workspaceId }) =>
        Effect.tryPromise({
          try: async () => {
            const accessToken = await input.providerAuth.ensureUsableProviderAuth(providerId);
            if (!accessToken) {
              return {
                providerId,
                ...(workspaceId ? { workspaceId } : {}),
                health: "missing" as const,
                issue: input.providerAuth.getProviderAuthUnavailableMessage(providerId),
              };
            }
            return usableProviderAuthSnapshot({ providerId, workspaceId, accessToken });
          },
          catch: (cause) =>
            new ProviderAuthPortError({
              operation: "runtime.pi.providerAuth.getProviderAuthSnapshot",
              reason: "state-conflict",
              message:
                cause instanceof Error ? cause.message : "Provider auth snapshot lookup failed.",
              cause,
            }),
        }),
      refreshProviderCredentialSnapshot: ({ providerId, workspaceId }) =>
        Effect.tryPromise({
          try: async () => {
            const accessToken = await input.providerAuth.ensureUsableProviderAuth(providerId);
            if (!accessToken) {
              return {
                providerId,
                ...(workspaceId ? { workspaceId } : {}),
                health: "missing" as const,
                issue: input.providerAuth.getProviderAuthUnavailableMessage(providerId),
              };
            }
            return usableProviderAuthSnapshot({ providerId, workspaceId, accessToken });
          },
          catch: (cause) =>
            new ProviderAuthPortError({
              operation: "runtime.pi.providerAuth.refreshProviderCredentialSnapshot",
              reason: "state-conflict",
              message:
                cause instanceof Error ? cause.message : "Provider auth snapshot refresh failed.",
              cause,
            }),
        }),
    }),
    Layer.succeed(PiRuntimePathsPort, {
      resolve: ({ workspaceId }) =>
        Effect.tryPromise({
          try: () => input.piRuntimePaths.resolve(workspaceId),
          catch: (cause) =>
            new PiAdapterError({
              operation: "runtime.pi.paths.resolve",
              reason: "runtime-paths-failed",
              message:
                cause instanceof Error ? cause.message : "Pi runtime paths could not be resolved.",
              cause,
            }),
        }),
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
    Layer.succeed(RuntimeGeneratedPackageStatePort, generatedPackageStatePort),
    Layer.succeed(RuntimeSourceInvalidationScanPort, createSourceInvalidationScanPort(input)),
    Layer.succeed(RuntimeLayerCommandStdinPort, input.commandRegistry),
    Layer.succeed(RuntimeLayerCommandControlPort, input.commandRegistry),
    Layer.succeed(RuntimeWorkflowTaskAgentBridgeBearerVerifier, {
      verify: (request) =>
        Effect.tryPromise({
          try: async () =>
            Boolean(await input.workflowTaskAgentBridge?.verifyBearerLineage(request)),
          catch: (cause) => runtimeBootstrapError("runtime.workflowTaskAgentBridge.verify", cause),
        }).pipe(Effect.catch(() => Effect.succeed(false))),
    }),
  );
  const runtimeLayerConfig = createRuntimeLayerConfigLayer(input.runtimeLayerConfig);
  const managedRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      Runtime.layer.pipe(Layer.provide(runtimeLayerConfig)),
      runtimeLayerConfig,
      stateFacadeServicesLayer,
    ).pipe(Layer.provide(runtimeHostLayer)),
  );
  let runtimeServiceAcquired = false;
  try {
    await managedRuntime.context();
    runtimeServiceAcquired = true;
    const readiness = await awaitRuntimeStartupReadiness(managedRuntime);
    const facade = createRuntimeFacade(managedRuntime);
    const state = createStateFacade(managedRuntime);
    const stateCommands = createStateCommandsFacade(managedRuntime);
    const rendererState = narrowRendererStateFacade(state);
    const rendererStateCommands = narrowRendererStateCommandsFacade(stateCommands);
    await seedAppPreferencesStateRows({
      seed: input.appPreferencesSeed,
      stateCommands,
    });
    lifecycle.markReady();
    const runRuntimePromise = <A>(effect: Effect.Effect<A, unknown, never>) =>
      managedRuntime.runPromise(effect);
    const acquireDirectToolLaunch = (
      request: Omit<BuildLaunchPolicyInput, "launchKind"> & {
        readonly toolName: "exec_command" | "apply_patch" | "execute_typescript";
      },
    ) => acquireAcceptedDirectToolLaunch(managedRuntime, request);
    return {
      facade,
      state,
      stateCommands,
      rendererState,
      rendererStateCommands,
      readiness,
      internal: {
        launchFacts: {
          acquireDirectToolLaunch,
          acquireExecuteTypescript: (request) =>
            acquireDirectToolLaunch({ ...request, toolName: "execute_typescript" }),
        },
        sourceInvalidation: {
          refreshGeneratedPackages: (request) =>
            runRuntimePromise(
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
        workflowTaskAgentBridge: {
          runTaskAgent: (request) =>
            runRuntimePromise(
              Effect.gen(function* () {
                const runtime = yield* Runtime;
                return yield* runtime.workflowTaskAgentBridge.runTaskAgent(request);
              }) as Effect.Effect<RunTaskAgentResult, unknown, never>,
            ),
        },
        workspaceStates: {
          register: (request) => {
            lifecycle.assertAccepting("app-runtime-bootstrap.workspaceStates.register");
            workspaceRouter.registerWorkspaceState(workspaceStateRegistration(request));
          },
          unregister: (workspaceId) => {
            lifecycle.assertAccepting("app-runtime-bootstrap.workspaceStates.unregister");
            return workspaceRouter.unregisterWorkspaceState(workspaceId);
          },
        },
      },
      dispose: () =>
        lifecycle
          .shutdown(
            "app-shutdown",
            async () => {
              stateCommands.close();
              state.close();
              facade.close();
            },
            () => prepareShutdown(managedRuntime, "app-shutdown"),
            () => disposeManagedRuntime(managedRuntime),
          )
          .then(() => undefined),
    };
  } catch (cause) {
    lifecycle.markStartupFailed(cause);
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

function appLogStateServiceFromFacade(
  appLogs: AppRuntimeBootstrapInput["appLogs"],
): Parameters<typeof stateReadModelsFromRouter>[0]["appLogs"] {
  return {
    append: (entry) =>
      Effect.try({
        try: () => appLogs.append(entry),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.append",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log append failed.",
            cause,
          }),
      }),
    query: (query) =>
      Effect.try({
        try: () => appLogs.query(query),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.query",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log query failed.",
            cause,
          }),
      }),
    summary: () =>
      Effect.try({
        try: () => appLogs.summary(),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.summary",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log summary failed.",
            cause,
          }),
      }),
    markSeen: (throughSeq) =>
      Effect.try({
        try: () => appLogs.markSeen(throughSeq),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.markSeen",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log mark seen failed.",
            cause,
          }),
      }),
    subscribe: (listener) =>
      Effect.try({
        try: () => appLogs.subscribe(listener),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.subscribe",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log subscribe failed.",
            cause,
          }),
      }),
  };
}

async function seedAppPreferencesStateRows(input: {
  readonly seed: AppRuntimeBootstrapInput["appPreferencesSeed"];
  readonly stateCommands: StateCommandsFacade;
}): Promise<void> {
  if (!input.seed || input.seed.hasStateRows()) {
    return;
  }
  const preferences = input.seed.read();
  await input.stateCommands.appPreferences.update({
    patch: {
      appearance: preferences.appAppearance,
      externalEditor: stateExternalEditorFromAppPreferences(preferences),
      artifactDirectory: preferences.artifactDirectory as AbsolutePath,
      approvalMode: preferences.approvalMode,
      networkAccess: preferences.networkAccess,
      ambientResources: preferences.ambientAgentResources as unknown as JsonValue,
    },
    clientSubmission: {
      clientRequestId: "bootstrap-app-preferences-seed" as RuntimeClientRequestId,
      source: "app-bootstrap" as RuntimeClientSubmissionSource,
    },
  });
}

function stateExternalEditorFromAppPreferences(preferences: AppPreferences): string | null {
  if (preferences.preferredExternalEditor === "system") {
    return null;
  }
  if (preferences.preferredExternalEditor === "custom") {
    return preferences.customExternalEditorCommand || "custom";
  }
  return preferences.preferredExternalEditor;
}

function createGeneratedPackageStatePort(input: {
  readonly routerPort: RuntimeGeneratedPackageStatePortService;
  readonly unopenedWorkspaceFallback?:
    | Pick<
        RuntimeGeneratedPackageStatePortService,
        "markWorkspaceLinksRepairNeeded" | "recordWorkspaceLinkStatus"
      >
    | undefined;
}): RuntimeGeneratedPackageStatePortService {
  if (!input.unopenedWorkspaceFallback) {
    return input.routerPort;
  }
  return {
    ...input.routerPort,
    recordWorkspaceLinkStatus: (request) =>
      input.routerPort.recordWorkspaceLinkStatus(request).pipe(
        Effect.matchEffect({
          onFailure: (error: StateContractError) =>
            error.reason === "not-found"
              ? input.unopenedWorkspaceFallback!.recordWorkspaceLinkStatus(request)
              : Effect.fail(error),
          onSuccess: (result) => Effect.succeed(result),
        }),
      ),
    markWorkspaceLinksRepairNeeded: (request) =>
      input.routerPort.markWorkspaceLinksRepairNeeded(request).pipe(
        Effect.matchEffect({
          onFailure: (error: StateContractError) =>
            error.reason === "not-found"
              ? input.unopenedWorkspaceFallback!.markWorkspaceLinksRepairNeeded(request)
              : Effect.fail(error),
          onSuccess: (result) => Effect.succeed(result),
        }),
      ),
  };
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
