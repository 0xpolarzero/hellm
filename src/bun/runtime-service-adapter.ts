import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, watch as nodeWatch } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import {
  ExtensionError as CoreExtensionError,
  ExtensionStatePort,
  RuntimeContractError,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeActorExtensionBindingStatePort,
  RuntimeEventStreamError,
  RuntimeGeneratedPackageStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeWorkspaceStatePort,
  type AbsolutePath,
  type GeneratedPackagesRefreshResult,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type ExtensionStatePortService,
  type RefreshGeneratedContextRequest,
  type RefreshGeneratedPackagesRequest,
  type RuntimeEvent,
  type RuntimeEventError,
  type RuntimeEventSequence,
  type RuntimeEventsInput,
  type StateInvalidationDescriptor,
  type RuntimeCommandStatePortService,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestStatePortService,
  type StateMutationResult,
  type OpenExtensionSourceEditInput,
  type SaveExtensionSourceEditInput,
  type SourceEditSaveResult,
  type SourceEditSession,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type SourceReconcileResult,
} from "@svvy/core";
import type {
  ExtensionsService,
  RequestUserInputResult,
  ExtensionSourceRoots,
  GeneratedPackageRoots,
} from "@svvy/extensions";
import {
  Extensions,
  layerExtensions,
  layerExtensionSourceRootsPort,
  layerGeneratedPackageRootPort,
  layerWorkspaceSourceLinkPort,
} from "@svvy/extensions";
import { createRuntimeFacade, Runtime } from "@svvy/runtime";
import {
  awaitRuntimeStartupReadiness,
  createSourceInvalidationCoordinator,
  createRuntimeLayerConfigLayer,
  defaultRuntimeLayerConfig,
  RuntimeLayerApprovalPostCommitPort,
  RuntimeLayerAppLogPort,
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  RuntimeLayerDevTelemetryPort,
  RuntimeLayerEventsPort,
  RuntimeLayerModelResolverPort,
  RuntimeLayerPromptHostPort,
  RuntimeLayerProviderAuthPort,
  RuntimeLayerRequestInputPostCommitPort,
  RuntimeLayerSourceEditsPort,
  RuntimeLayerSourceInvalidationPort,
  makeRuntimeBlockingRequestInputWaitRegistry,
  makeRuntimeEventBus,
  prepareRuntimeShutdown,
  RuntimeEventBus,
  RuntimeShutdownPreparation,
  RuntimeStartupReadiness,
  layerRuntimeBunPlatform,
  refreshRuntimeGeneratedPackages,
  runAcceptedLoadExtensionToolCall,
  runAcceptedRequestUserInputToolCall,
  type RuntimeBlockingRequestInputEffectState,
  type RuntimeBlockingRequestInputWaitRegistry,
  type RuntimeEventDraft,
  type RunAcceptedLoadExtensionToolCallInput,
  type RunAcceptedLoadExtensionToolCallResult,
  type RunAcceptedRequestUserInputToolCallInput,
  type RunAcceptedRequestUserInputToolCallResult,
  type RuntimeLayerConfig,
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
  type RuntimeLayerCommandControlPortService,
  type RuntimeLayerCommandStdinPortService,
  type SourceInvalidationCoordinatorOptions,
  type SourceInvalidationCoordinator,
  type SourceInvalidationDirectoryEntry,
  type SourceInvalidationHost,
} from "@svvy/runtime/bootstrap";
import { type PromptTarget } from "../shared/workspace-contract";
import type { WorkspaceSessionCatalog } from "./session-catalog";
import type { AppLogger } from "./app-logger";

type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;
type RuntimeService = Runtime["Service"];
type RuntimeEventSubscriptionEffect = Effect.Success<ReturnType<RuntimeService["events"]>>;

type CatalogBackedRuntimePort = {
  catalog: Pick<
    WorkspaceSessionCatalog,
    | "afterRequestInputAnswered"
    | "afterRequestInputTimerPaused"
    | "afterRuntimeQueuedMessageAborted"
    | "afterRuntimeSurfaceMessageQueued"
    | "afterRuntimeSurfaceMessageSteered"
    | "cancelActivePrompt"
    | "cancelPrompt"
    | "deleteQueuedSurfaceMessage"
    | "getRuntimeGeneratedPackageStatePort"
    | "getRuntimeApprovalStatePort"
    | "getRuntimeCommandStatePort"
    | "getRuntimeRequestStatePort"
    | "getRuntimeSessionWaitStatePort"
    | "getRuntimeSourceStatePort"
    | "getRuntimeSurfaceLifecycleStatePort"
    | "getRuntimeWorkspaceStatePort"
    | "resolveRuntimeApprovalAnswer"
    | "resolvePromptDefaultsForTarget"
    | "getRuntimeQueueStatePort"
  >;
  sourceEdits: {
    open(input: OpenExtensionSourceEditInput): Promise<SourceEditSession>;
    save(input: SaveExtensionSourceEditInput): Promise<SourceEditSaveResult>;
  };
  sourceInvalidation: {
    hint(input: SourceInvalidationHint): Promise<void>;
    reconcile(input: SourceReconcileRequest): Promise<SourceReconcileResult>;
    refreshGeneratedContext(input: RefreshGeneratedContextRequest): Promise<void>;
    refreshGeneratedPackages(
      input: RefreshGeneratedPackagesRequest,
    ): Promise<GeneratedPackagesRefreshResult>;
  };
  events?: (
    input?: RuntimeEventsInput,
  ) => Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
  publishStateInvalidations?: (input: {
    afterCommit: readonly StateInvalidationDescriptor[];
  }) => Promise<readonly RuntimeEvent[]>;
  commandStdin: RuntimeLayerCommandStdinPortService;
  commandControl: RuntimeLayerCommandControlPortService;
  appLog: AppLogger;
};

export type CatalogBackedRuntimeDependencies = {
  ensureUsableProviderAuth(provider: string): Promise<string | undefined>;
  getProviderAuthUnavailableMessage(provider: string): string;
  recordDevBrowserToolsEvent(name: string, details?: Record<string, unknown>): void;
};

export type CatalogBackedRuntime = {
  facade: RuntimeFacade;
  dispose(): Promise<void>;
};

export type RuntimeEventBusHandle = {
  publish(event: RuntimeEventDraft): Promise<RuntimeEvent>;
  publishStateInvalidations(input: {
    afterCommit: readonly StateInvalidationDescriptor[];
  }): Promise<readonly RuntimeEvent[]>;
  events(
    input?: RuntimeEventsInput,
  ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
  close(): Promise<void>;
};

export type RuntimeSourceInvalidationCoordinatorHandle = Omit<
  SourceInvalidationCoordinator,
  "close" | "refreshWatchedInputs" | "requestScan" | "start"
> & {
  close(): Promise<void>;
  ready(): Promise<void>;
  refreshWatchedInputs(reason?: string): Promise<void>;
  requestScan(reason: string): Promise<void>;
};

export interface RuntimeGeneratedPackageRefreshBoundaryHost {
  readonly sourceRoots: ExtensionSourceRoots;
  readonly generatedPackageRoots: GeneratedPackageRoots;
  readonly extensionStatePort: ExtensionStatePortService;
  generatedPackageLinkPath(input: GeneratedPackageWorkspaceLinkRepairInput): Promise<AbsolutePath>;
  readonly workspaceLinkFileHost: RuntimeGeneratedPackageWorkspaceLinkFileHost;
}

export type RuntimeBlockingRequestInputWaitRegistryHandle = {
  waitForBlockingRequest(input: {
    state: RuntimeBlockingRequestInputEffectState;
    request: RuntimeRequestInputDetailsRecord;
    command: Parameters<
      RuntimeBlockingRequestInputWaitRegistry["waitForBlockingRequest"]
    >[0]["command"];
  }): Promise<RequestUserInputResult>;
  setBlockingTimerPaused(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
    paused: boolean,
  ): Promise<RuntimeRequestInputDetailsRecord>;
  rescheduleBlockingTimeout(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
  ): Promise<void>;
  resolveBlockingRequest(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
  ): Promise<RequestUserInputResult | null>;
  rejectBlockingRequest(
    state: RuntimeBlockingRequestInputEffectState,
    requestId: string,
    error: Error,
  ): Promise<void>;
  cancelBlockingRequestsForSurface(
    state: RuntimeBlockingRequestInputEffectState,
    surfacePiSessionId: string,
    reason?: string,
  ): Promise<void>;
  restoreOpenBlockingRequests(state: RuntimeBlockingRequestInputEffectState): Promise<void>;
  close(): Promise<void>;
};

export function createRuntimeEventBusHandle(
  runtimeLayerConfig: RuntimeLayerConfig = defaultRuntimeLayerConfig,
): RuntimeEventBusHandle {
  const busPromise = runRuntimeEffect(
    Effect.gen(function* () {
      const scope = yield* Scope.make("sequential");
      const bus = yield* makeRuntimeEventBus().pipe(
        Effect.provide(createRuntimeLayerConfigLayer(runtimeLayerConfig)),
        Effect.provideService(Scope.Scope, scope),
      );
      return { bus, scope };
    }),
  );

  const publish = async (event: RuntimeEventDraft): Promise<RuntimeEvent> => {
    const { bus } = await busPromise;
    return runRuntimeEffect(bus.publishLive({ event }));
  };

  const publishStateInvalidations = async (input: {
    afterCommit: readonly StateInvalidationDescriptor[];
  }): Promise<readonly RuntimeEvent[]> => {
    const { bus } = await busPromise;
    return runRuntimeEffect(bus.publishStateInvalidations(input));
  };

  const events = (
    input?: RuntimeEventsInput,
  ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError> =>
    Effect.promise(() => busPromise.then(({ bus }) => runRuntimeEffect(bus.subscribe(input))));

  return {
    publish,
    publishStateInvalidations,
    events,
    close: async () => {
      const { scope } = await busPromise;
      await runRuntimeEffect(Scope.close(scope, Exit.void));
    },
  };
}

export function createRuntimeSourceInvalidationCoordinatorHandle(
  options: SourceInvalidationCoordinatorOptions,
): RuntimeSourceInvalidationCoordinatorHandle {
  const coordinator = createSourceInvalidationCoordinator(options);
  const ready = runRuntimeEffect(coordinator.start()).catch(async (error) => {
    await runRuntimeEffect(coordinator.close());
    throw error;
  });

  return {
    close: async () => {
      try {
        await ready;
      } catch {
        // The coordinator may fail during startup; close still releases watcher resources.
      }
      await runRuntimeEffect(coordinator.close());
    },
    ready: () => ready,
    refreshWatchedInputs: async (reason) => {
      await ready;
      await runRuntimeEffect(coordinator.refreshWatchedInputs(reason));
    },
    requestScan: async (reason) => {
      await ready;
      await runRuntimeEffect(coordinator.requestScan(reason));
    },
  };
}

export function createNodeSourceInvalidationHost(): SourceInvalidationHost {
  return {
    homeDir: homedir(),
    path: {
      dirname,
      join,
      resolve,
    },
    fileSystem: {
      exists: existsSync,
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
      isFile: (path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      },
      readDirectory: (path) =>
        readdirSync(path, { withFileTypes: true }).map(
          (entry): SourceInvalidationDirectoryEntry => ({
            name: entry.name,
            kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
          }),
        ),
      readFileString: (path) => readFileSync(path, "utf8"),
    },
    hashStrings: (parts) => {
      const hash = createHash("sha256");
      for (const part of parts) {
        hash.update(part);
        hash.update("\0");
      }
      return hash.digest("hex");
    },
    watch: (path, listener) => {
      const watcher = nodeWatch(path, (eventType, filename) => {
        void runRuntimeEffect(listener(eventType, filename));
      });
      watcher.on("error", () => {});
      return { close: () => watcher.close() };
    },
  };
}

export function runRuntimeEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

export function refreshRuntimeGeneratedPackagesAtRuntimeBoundary(input: {
  request: RefreshGeneratedPackagesRequest;
  host: RuntimeGeneratedPackageRefreshBoundaryHost;
  generatedPackageStatePort: RuntimeGeneratedPackageStatePortService;
}): Promise<GeneratedPackagesRefreshResult> {
  const generatedPackageLayer = Layer.mergeAll(
    layerExtensions,
    layerRuntimeBunPlatform,
    Layer.succeed(ExtensionStatePort, input.host.extensionStatePort),
    layerExtensionSourceRootsPort(input.host.sourceRoots),
    layerGeneratedPackageRootPort(input.host.generatedPackageRoots),
    layerWorkspaceSourceLinkPort({
      generatedPackageLinkPath: (linkInput) =>
        Effect.tryPromise({
          try: () => input.host.generatedPackageLinkPath(linkInput),
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

  return runRuntimeEffect(
    refreshRuntimeGeneratedPackages(input.request, {
      buildGeneratedPackages: (buildInput) =>
        Effect.gen(function* () {
          const extensions = yield* Extensions;
          return yield* extensions.generatedPackages.refresh(buildInput);
        }).pipe(
          Effect.provide(generatedPackageLayer),
          Effect.mapError((cause) =>
            runtimeAdapterError("runtime.sourceInvalidation.refreshGeneratedPackages.build", cause),
          ),
        ),
      planWorkspaceLinkRepair: (linkInput) =>
        Effect.gen(function* () {
          const extensions = yield* Extensions;
          return yield* extensions.generatedPackages.planWorkspaceLink(linkInput);
        }).pipe(
          Effect.provide(generatedPackageLayer),
          Effect.mapError((cause) =>
            runtimeAdapterError(
              "runtime.sourceInvalidation.refreshGeneratedPackages.planWorkspaceLink",
              cause,
            ),
          ),
        ),
      workspaceLinkFileHost: input.host.workspaceLinkFileHost,
    }).pipe(
      Effect.provideService(RuntimeGeneratedPackageStatePort, input.generatedPackageStatePort),
    ),
  );
}

export function runAcceptedRequestUserInputToolCallAtRuntimeBoundary(input: {
  request: RunAcceptedRequestUserInputToolCallInput;
  commandStatePort: RuntimeCommandStatePortService;
  requestStatePort: RuntimeRequestStatePortService;
  publishStateInvalidations?: CatalogBackedRuntimePort["publishStateInvalidations"];
}): Promise<RunAcceptedRequestUserInputToolCallResult> {
  const afterCommit: StateInvalidationDescriptor[] = [];
  return runRuntimeEffect(
    runAcceptedRequestUserInputToolCall(input.request).pipe(
      Effect.provideService(
        RuntimeCommandStatePort,
        commandStatePortWithInvalidationCollector(input.commandStatePort, afterCommit),
      ),
      Effect.provideService(RuntimeRequestStatePort, input.requestStatePort),
      Effect.provideService(RuntimeEventBus, runtimeEventBusFromStateInvalidationPublisher(input)),
    ),
  ).then(async (result) => {
    await publishCollectedStateInvalidations(input.publishStateInvalidations, afterCommit);
    return result;
  });
}

export function runAcceptedLoadExtensionToolCallAtRuntimeBoundary(input: {
  request: RunAcceptedLoadExtensionToolCallInput;
  commandStatePort: RuntimeCommandStatePortService;
  actorExtensionBindingStatePort: RuntimeActorExtensionBindingStatePortService;
  extensionsService: ExtensionsService;
  publishStateInvalidations?: CatalogBackedRuntimePort["publishStateInvalidations"];
}): Promise<RunAcceptedLoadExtensionToolCallResult> {
  const afterCommit: StateInvalidationDescriptor[] = [];
  return runRuntimeEffect(
    runAcceptedLoadExtensionToolCall(input.request).pipe(
      Effect.provideService(
        RuntimeCommandStatePort,
        commandStatePortWithInvalidationCollector(input.commandStatePort, afterCommit),
      ),
      Effect.provideService(
        RuntimeActorExtensionBindingStatePort,
        input.actorExtensionBindingStatePort,
      ),
      Effect.provideService(Extensions, input.extensionsService),
      Effect.provideService(RuntimeEventBus, runtimeEventBusFromStateInvalidationPublisher(input)),
    ),
  ).then(async (result) => {
    await publishCollectedStateInvalidations(input.publishStateInvalidations, afterCommit);
    return result;
  });
}

function runtimeEventBusFromStateInvalidationPublisher(input: {
  publishStateInvalidations?: CatalogBackedRuntimePort["publishStateInvalidations"];
}): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: (eventInput) =>
      Effect.fail(
        new RuntimeEventStreamError({
          operation: "runtime.events.publish",
          reason: "stream-failed",
          message: `Runtime live event publication is not available for event ${eventInput.event.type}.`,
          latestSequence: 0 as RuntimeEventSequence,
        }),
      ),
    publishStateInvalidations: (publishInput) =>
      Effect.tryPromise({
        try: async () => {
          if (!input.publishStateInvalidations) {
            return [];
          }
          return await input.publishStateInvalidations(publishInput);
        },
        catch: (cause: unknown) =>
          new RuntimeEventStreamError({
            operation: "runtime.events.publishStateInvalidations",
            reason: "stream-failed",
            message: cause instanceof Error ? cause.message : String(cause),
            latestSequence: 0 as RuntimeEventSequence,
          }),
      }),
    subscribe: () =>
      Effect.fail(
        new RuntimeEventStreamError({
          operation: "runtime.events",
          reason: "stream-failed",
          message: "Runtime events are not available.",
          latestSequence: 0 as RuntimeEventSequence,
        }),
      ),
  });
}

export function createRuntimeBlockingRequestInputWaitRegistryHandle(
  input: {
    onRequestUpdated?: () => void | Promise<void>;
  } = {},
): RuntimeBlockingRequestInputWaitRegistryHandle {
  const options = input.onRequestUpdated
    ? {
        onRequestUpdated: () =>
          Effect.tryPromise({
            try: async () => {
              await input.onRequestUpdated?.();
            },
            catch: (cause: unknown) =>
              runtimeAdapterError("runtime.requestInput.blocking.onRequestUpdated", cause),
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                console.error("Failed to notify request_user_input timeout update:", error);
              }),
            ),
          ),
      }
    : {};
  const registryPromise = runRuntimeEffect(
    Effect.gen(function* () {
      const scope = yield* Scope.make("sequential");
      const registry = yield* makeRuntimeBlockingRequestInputWaitRegistry(options).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      return { registry, scope };
    }),
  );
  const runRegistry = async <A>(
    run: (registry: RuntimeBlockingRequestInputWaitRegistry) => Effect.Effect<A, unknown>,
  ): Promise<A> => {
    const { registry } = await registryPromise;
    return runRuntimeEffect(run(registry));
  };

  return {
    waitForBlockingRequest: (request) =>
      runRegistry((registry) => registry.waitForBlockingRequest(request)),
    setBlockingTimerPaused: (state, requestId, paused) =>
      runRegistry((registry) => registry.setBlockingTimerPaused(state, requestId, paused)),
    rescheduleBlockingTimeout: (state, requestId) =>
      runRegistry((registry) => registry.rescheduleBlockingTimeout(state, requestId)),
    resolveBlockingRequest: (state, requestId) =>
      runRegistry((registry) => registry.resolveBlockingRequest(state, requestId)),
    rejectBlockingRequest: (state, requestId, error) =>
      runRegistry((registry) => registry.rejectBlockingRequest(state, requestId, error)),
    cancelBlockingRequestsForSurface: (state, surfacePiSessionId, reason) =>
      runRegistry((registry) =>
        registry.cancelBlockingRequestsForSurface(state, surfacePiSessionId, reason),
      ),
    restoreOpenBlockingRequests: (state) =>
      runRegistry((registry) => registry.restoreOpenBlockingRequests(state)),
    close: async () => {
      const { scope } = await registryPromise;
      await runRuntimeEffect(Scope.close(scope, Exit.void));
    },
  };
}

export async function createCatalogBackedRuntime(
  port: CatalogBackedRuntimePort,
  dependencies: CatalogBackedRuntimeDependencies,
): Promise<CatalogBackedRuntime> {
  const runtimeHostLayer = Layer.mergeAll(
    Layer.succeed(
      RuntimeLayerPromptHostPort,
      RuntimeLayerPromptHostPort.of({
        resolvePromptDefaultsForTarget: (target) =>
          port.catalog.resolvePromptDefaultsForTarget(target as PromptTarget),
        afterRuntimeSurfaceMessageQueued: async (input) => {
          const result = await port.catalog.afterRuntimeSurfaceMessageQueued({
            ...input,
            target: input.target as PromptTarget,
            messages: [...input.messages],
            onEvent: input.onEvent as never,
          });
          return {
            dispatched: result.dispatched ?? false,
            queued: result.queued,
            queuedMessageId: result.queuedMessageId,
            target: input.target,
          };
        },
        afterRuntimeQueuedMessageAborted: (input) =>
          port.catalog.afterRuntimeQueuedMessageAborted({
            ...input,
            target: input.target as PromptTarget,
          }),
        afterRuntimeSurfaceMessageSteered: (input) =>
          port.catalog.afterRuntimeSurfaceMessageSteered({
            ...input,
            target: input.target as PromptTarget,
          }),
        cancelActivePrompt: (input) =>
          port.catalog.cancelActivePrompt({
            ...input,
            target: input.target as PromptTarget,
          }),
        cancelPrompt: (target) => port.catalog.cancelPrompt(target as PromptTarget),
      }),
    ),
    Layer.succeed(
      RuntimeLayerRequestInputPostCommitPort,
      RuntimeLayerRequestInputPostCommitPort.of({
        afterRequestInputAnswered: (input) => port.catalog.afterRequestInputAnswered(input),
        afterRequestInputTimerPaused: (input) => port.catalog.afterRequestInputTimerPaused(input),
      }),
    ),
    Layer.succeed(
      RuntimeLayerApprovalPostCommitPort,
      RuntimeLayerApprovalPostCommitPort.of({
        resolveRuntimeApprovalAnswer: async (input) => {
          await port.catalog.resolveRuntimeApprovalAnswer(input);
        },
      }),
    ),
    Layer.succeed(RuntimeQueueStatePort, port.catalog.getRuntimeQueueStatePort()),
    Layer.succeed(RuntimeRequestStatePort, port.catalog.getRuntimeRequestStatePort()),
    Layer.succeed(RuntimeApprovalStatePort, port.catalog.getRuntimeApprovalStatePort()),
    Layer.succeed(RuntimeCommandStatePort, port.catalog.getRuntimeCommandStatePort()),
    Layer.succeed(RuntimeSessionWaitStatePort, port.catalog.getRuntimeSessionWaitStatePort()),
    Layer.succeed(RuntimeSourceStatePort, port.catalog.getRuntimeSourceStatePort()),
    Layer.succeed(
      RuntimeSurfaceLifecycleStatePort,
      port.catalog.getRuntimeSurfaceLifecycleStatePort(),
    ),
    Layer.succeed(RuntimeWorkspaceStatePort, port.catalog.getRuntimeWorkspaceStatePort()),
    Layer.succeed(
      RuntimeLayerProviderAuthPort,
      RuntimeLayerProviderAuthPort.of({
        ensureUsableProviderAuth: dependencies.ensureUsableProviderAuth,
        getProviderAuthUnavailableMessage: dependencies.getProviderAuthUnavailableMessage,
      }),
    ),
    Layer.succeed(
      RuntimeLayerModelResolverPort,
      RuntimeLayerModelResolverPort.of({
        resolveModelId: ({ provider, model }) =>
          Effect.try({
            try: () =>
              getModel(
                provider as Parameters<typeof getModel>[0],
                model as Parameters<typeof getModel>[1],
              ).id,
            catch: (cause: unknown) => runtimeAdapterError("runtime.model.resolve", cause),
          }),
      }),
    ),
    Layer.succeed(
      RuntimeLayerDevTelemetryPort,
      RuntimeLayerDevTelemetryPort.of({
        recordDevBrowserToolsEvent: dependencies.recordDevBrowserToolsEvent,
      }),
    ),
    Layer.succeed(RuntimeLayerAppLogPort, RuntimeLayerAppLogPort.of(port.appLog)),
    Layer.succeed(RuntimeLayerSourceEditsPort, RuntimeLayerSourceEditsPort.of(port.sourceEdits)),
    Layer.succeed(
      RuntimeLayerSourceInvalidationPort,
      RuntimeLayerSourceInvalidationPort.of(port.sourceInvalidation),
    ),
    Layer.succeed(
      RuntimeLayerEventsPort,
      RuntimeLayerEventsPort.of({
        events: (input) =>
          port.events
            ? port.events(input)
            : Effect.fail(
                new RuntimeEventStreamError({
                  operation: "runtime.events",
                  reason: "stream-failed",
                  message: "Runtime events are not available.",
                  latestSequence: 0 as RuntimeEventSequence,
                }),
              ),
        publishStateInvalidations: (input) =>
          Effect.tryPromise({
            try: async () =>
              port.publishStateInvalidations
                ? await port.publishStateInvalidations(input)
                : ([] as const),
            catch: (cause: unknown) =>
              new RuntimeEventStreamError({
                operation: "runtime.events.publishStateInvalidations",
                reason: "stream-failed",
                message: cause instanceof Error ? cause.message : String(cause),
                latestSequence: 0 as RuntimeEventSequence,
              }),
          }),
      }),
    ),
    Layer.succeed(RuntimeLayerCommandStdinPort, RuntimeLayerCommandStdinPort.of(port.commandStdin)),
    Layer.succeed(
      RuntimeLayerCommandControlPort,
      RuntimeLayerCommandControlPort.of(port.commandControl),
    ),
  );
  const managedRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      Runtime.layer,
      createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig),
      Layer.succeed(
        RuntimeStartupReadiness,
        RuntimeStartupReadiness.of({
          awaitReady: Effect.void,
        }),
      ),
      Layer.succeed(
        RuntimeShutdownPreparation,
        RuntimeShutdownPreparation.of({
          prepareShutdown: () =>
            Effect.succeed({
              status: "drained" as const,
              interruptedTurns: 0,
              interruptedCommands: 0,
              releasedQueueClaims: 0,
              recoveryRowsScheduled: 0,
            }),
        }),
      ),
    ).pipe(Layer.provide(runtimeHostLayer)),
  );
  await managedRuntime.context();
  await awaitRuntimeStartupReadiness(managedRuntime);
  const facade = createRuntimeFacade(managedRuntime);
  return {
    facade,
    dispose: async () => {
      try {
        await prepareRuntimeShutdown(managedRuntime, { reason: "app-shutdown" });
        await facade.close();
      } finally {
        await managedRuntime.dispose();
      }
    },
  };
}

function commandStatePortWithInvalidationCollector(
  statePort: RuntimeCommandStatePortService,
  afterCommit: StateInvalidationDescriptor[],
): RuntimeCommandStatePortService {
  return {
    ...statePort,
    createCommand: (input) =>
      statePort.createCommand(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    createOrReuseStreamingCommand: (input) =>
      statePort
        .createOrReuseStreamingCommand(input)
        .pipe(Effect.map(collectAfterCommit(afterCommit))),
    updateCommandArguments: (input) =>
      statePort.updateCommandArguments(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    startCommand: (input) =>
      statePort.startCommand(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    finishCommand: (input) =>
      statePort.finishCommand(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    recordCommandEvent: (input) =>
      statePort.recordCommandEvent(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    recordStdinWrite: (input) =>
      statePort.recordStdinWrite(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
  };
}

function collectAfterCommit<T>(afterCommit: StateInvalidationDescriptor[]) {
  return (result: StateMutationResult<T>): StateMutationResult<T> => {
    afterCommit.push(...result.afterCommit);
    return result;
  };
}

async function publishCollectedStateInvalidations(
  publish: CatalogBackedRuntimePort["publishStateInvalidations"] | undefined,
  afterCommit: readonly StateInvalidationDescriptor[],
  port?: Pick<CatalogBackedRuntimePort, "appLog">,
): Promise<void> {
  if (!publish || afterCommit.length === 0) {
    return;
  }
  try {
    await publish({ afterCommit });
  } catch (error) {
    port?.appLog.warning("app.bridge", "Runtime state invalidation publication failed.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function runtimeAdapterError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  return new RuntimeContractError({
    operation,
    reason: "unsupported-operation",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}
