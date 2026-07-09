import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Crypto from "effect/Crypto";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Path from "effect/Path";
import type * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { boundarySchemaErrorDetails, RuntimeContractError } from "@svvy/core";
import type {
  AbortPromptInput,
  AcquireDefaultWorkspaceInput,
  AcquireWorkspaceInput,
  AcquireWorkspaceResult,
  ApplyCommittedSourceInvalidationEventInput,
  AnswerRuntimeApprovalInput,
  AnswerRuntimeApprovalResult,
  AnswerRequestInputInput,
  AnswerRequestInputResult,
  AppLogEntryId,
  CancelCommandInput,
  CancelCommandResult,
  CloseSurfaceInput,
  CloseSurfaceResult,
  CreateOrchestratorSurfaceInput,
  CreateSurfaceResult,
  GeneratedPackagesRefreshResult,
  OpenSurfaceInput,
  OpenSurfaceResult,
  RefreshGeneratedContextRequest,
  RefreshGeneratedPackagesRequest,
  ReleaseWorkspaceInput,
  ReleaseWorkspaceResult,
  RuntimeApprovalsApiEffect,
  RuntimeActorExtensionBindingStatePort,
  RuntimeCommandsApiEffect,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeEventError,
  RuntimeEvent,
  RuntimeEventSubscriptionClose,
  RuntimeEventsInput,
  RuntimeFacadeErrorContract,
  RuntimeEpisodeStatePort,
  RuntimeGeneratedPackageStatePort,
  RuntimeMessagesApiEffect,
  RuntimePromptDefaultsStatePort,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  ProviderAuthPort,
  RuntimeQueuesApiEffect,
  RuntimeQueueStatePort,
  RuntimeRequestInputApiEffect,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceInvalidationApiEffect,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkflowTaskStatePort,
  RuntimeWorkspaceStatePort,
  RuntimeSurfacesApiEffect,
  RuntimeWorkspacesApiEffect,
  SandboxPolicySource,
  OpenExtensionSourceEditInput,
  SaveExtensionSourceEditInput,
  SourceEditSaveResult,
  SourceEditSession,
  SourceInvalidationHint,
  SourceReconcileRequest,
  SourceReconcileResult,
  SetRequestInputTimerPausedInput,
  SetRequestInputTimerPausedResult,
  SteerQueuedMessageInput,
  SubmitMessageInput,
  SubmitMessageResult,
  WriteCommandStdinInput,
  WriteCommandStdinResult,
  AuthenticatedRunTaskAgentInput,
  RunTaskAgentResult,
} from "@svvy/core";
import type { PiAdapter } from "@svvy/pi-adapter";
import type { AppLogWritePort, StateCommandPostCommitNotificationPort } from "@svvy/core";
import type { ExtensionSourceRootsPort, Extensions } from "@svvy/extensions";
import {
  layer as sandboxLayer,
  type HostProcessReferencePort,
  type SandboxHelperCandidatesPort,
} from "@svvy/sandbox";
import {
  decodeUnknownAcquireDefaultWorkspaceInputEffect,
  decodeUnknownAcquireWorkspaceInputEffect,
  decodeUnknownAcquireWorkspaceResultEffect,
  decodeUnknownApplyCommittedSourceInvalidationEventInputEffect,
  decodeUnknownAnswerRequestInputInputEffect,
  decodeUnknownAnswerRequestInputResultEffect,
  decodeUnknownAnswerRuntimeApprovalInputEffect,
  decodeUnknownAnswerRuntimeApprovalResultEffect,
  decodeUnknownAbortPromptInputEffect,
  decodeUnknownCancelCommandInputEffect,
  decodeUnknownCancelCommandResultEffect,
  decodeUnknownCloseSurfaceInputEffect,
  decodeUnknownCloseSurfaceResultEffect,
  decodeUnknownCreateOrchestratorSurfaceInputEffect,
  decodeUnknownCreateSurfaceResultEffect,
  decodeUnknownGeneratedPackagesRefreshResultEffect,
  decodeUnknownOpenExtensionSourceEditInputEffect,
  decodeUnknownOpenSurfaceInputEffect,
  decodeUnknownOpenSurfaceResultEffect,
  decodeUnknownRefreshGeneratedContextRequestEffect,
  decodeUnknownRefreshGeneratedPackagesRequestEffect,
  decodeUnknownReleaseWorkspaceInputEffect,
  decodeUnknownReleaseWorkspaceResultEffect,
  decodeUnknownRuntimeEventEffect,
  decodeUnknownRuntimeEventSubscriptionCloseEffect,
  decodeUnknownRuntimeEventsInputEffect,
  decodeUnknownSaveExtensionSourceEditInputEffect,
  decodeUnknownSetRequestInputTimerPausedInputEffect,
  decodeUnknownSetRequestInputTimerPausedResultEffect,
  decodeUnknownSourceEditSaveResultEffect,
  decodeUnknownSourceEditSessionEffect,
  decodeUnknownSourceInvalidationHintEffect,
  decodeUnknownSourceReconcileRequestEffect,
  decodeUnknownSourceReconcileResultEffect,
  decodeUnknownSteerQueuedMessageInputEffect,
  decodeUnknownSubmitMessageInputEffect,
  decodeUnknownSubmitMessageResultEffect,
  decodeUnknownWriteCommandStdinInputEffect,
  decodeUnknownWriteCommandStdinResultEffect,
} from "@svvy/core";
import { layerRuntimeEventBus } from "./runtime-event-bus";
import { layerRuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { makeRuntimeService } from "./runtime-layer";
import type {
  RuntimeGeneratedContextRefreshHostPort,
  RuntimeGeneratedPackageRefreshHostPort,
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  RuntimeLayerModelResolverPort,
  RuntimeLayerProviderAuthPort,
  RuntimeSourceInvalidationScanPort,
} from "./bootstrap";
import {
  layerRuntimeShutdownPreparation,
  layerRuntimeStartupReadiness,
  type RuntimeLayerConfigService,
  type RuntimeLayerError,
  type RuntimeShutdownPreparation,
  type RuntimeStartupReadiness,
} from "./runtime-layer-config";
import { layerRuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import { layerRuntimeQueueWakeService } from "./runtime-queue-wake-service";
import { layerRuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
import { layerRuntimeGeneratedPackageRefreshService } from "./runtime-generated-package-refresh-service";
import { layerRuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import { layerRuntimeAcceptedNativeToolExecution } from "./accepted-native-tool-execution-service";
import { layerRuntimeLaunchPolicyService } from "./runtime-launch-policy-service";
import { layerStateCommandPostCommitNotificationPort } from "./state-command-post-commit-notification";
import { layerRuntimeExecutionPlanExecutor } from "./runtime-effect-requests";
import { layerRuntimeWorkspaceScopeService } from "./workspace-runtime-scope-service";
import { layerRuntimePromptDefaultsService } from "./runtime-prompt-defaults-service";
import { layerRuntimeSurfaceEventPublisher } from "./runtime-surface-event-publisher";
import { layerRuntimeSurfaceScopeService } from "./surface-runtime-scope-service";
import { layerRuntimePromptExecutionService } from "./runtime-prompt-execution-service";
import { layerRuntimeSurfaceQueueDispatcherService } from "./runtime-surface-queue-dispatcher-service";
import {
  layerRuntimeWorkflowTaskAgentBridgeService,
  RuntimeWorkflowTaskAgentBridgeBearerVerifier,
} from "./workflow-task-agent-bridge-service";

interface RuntimeMessagesService extends RuntimeMessagesApiEffect {}

interface RuntimeQueuesService extends RuntimeQueuesApiEffect {}

interface RuntimeRequestInputService extends RuntimeRequestInputApiEffect {}

interface RuntimeCommandsService extends RuntimeCommandsApiEffect {}

interface RuntimeSourceEditsService {
  open(input: OpenExtensionSourceEditInput): Effect.Effect<SourceEditSession, RuntimeContractError>;
  save(
    input: SaveExtensionSourceEditInput,
  ): Effect.Effect<SourceEditSaveResult, RuntimeContractError>;
}

interface RuntimeSourceInvalidationService extends RuntimeSourceInvalidationApiEffect {}

interface RuntimeEventSubscriptionEffect {
  readonly stream: Stream.Stream<RuntimeEvent, never>;
  close(): Effect.Effect<void, RuntimeEventError>;
  readonly closed: Effect.Effect<RuntimeEventSubscriptionClose, RuntimeEventError>;
}

interface RuntimeService {
  readonly workspaces: RuntimeWorkspacesApiEffect;
  readonly surfaces: RuntimeSurfacesApiEffect;
  readonly messages: RuntimeMessagesService;
  readonly queues: RuntimeQueuesService;
  readonly requestInput: RuntimeRequestInputService;
  readonly commands: RuntimeCommandsService;
  readonly approvals: RuntimeApprovalsApiEffect;
  readonly sourceEdits: RuntimeSourceEditsService;
  readonly sourceInvalidation: RuntimeSourceInvalidationService;
  readonly workflowTaskAgentBridge: {
    runTaskAgent(
      input: AuthenticatedRunTaskAgentInput,
    ): Effect.Effect<RunTaskAgentResult, RuntimeContractError>;
  };
  events(
    input?: RuntimeEventsInput,
  ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
}

export class Runtime extends Context.Service<Runtime, RuntimeService>()("@svvy/runtime/Runtime") {}

const runtimeGeneratedPackageRefreshLayer = layerRuntimeGeneratedPackageRefreshService.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeSourceInvalidationLayer = layerRuntimeSourceInvalidationService.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
  Layer.provideMerge(layerRuntimeGeneratedContextRefreshService),
  Layer.provideMerge(runtimeGeneratedPackageRefreshLayer),
);
const runtimeApprovalWaitLayer = layerRuntimeApprovalWaitService;
const runtimeLaunchPolicyLayer = layerRuntimeLaunchPolicyService.pipe(Layer.provide(sandboxLayer));
const runtimeSurfaceEventPublisherLayer = layerRuntimeSurfaceEventPublisher.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimePromptExecutionLayer = layerRuntimePromptExecutionService.pipe(
  Layer.provideMerge(runtimeSurfaceEventPublisherLayer),
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeSurfaceScopeLayer = layerRuntimeSurfaceScopeService;
const runtimeSurfaceQueueDispatcherLayer = layerRuntimeSurfaceQueueDispatcherService.pipe(
  Layer.provideMerge(runtimeSurfaceScopeLayer),
  Layer.provideMerge(runtimePromptExecutionLayer),
  Layer.provideMerge(runtimeSourceInvalidationLayer),
  Layer.provideMerge(layerRuntimeGeneratedContextRefreshService),
  Layer.provideMerge(layerRuntimePromptDefaultsService),
);
const runtimeWorkflowTaskAgentBridgeLayer = layerRuntimeWorkflowTaskAgentBridgeService.pipe(
  Layer.provideMerge(runtimeSurfaceQueueDispatcherLayer),
  Layer.provideMerge(layerRuntimeGeneratedContextRefreshService),
  Layer.provideMerge(runtimeSurfaceScopeLayer),
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeQueueWakeLayer = layerRuntimeQueueWakeService.pipe(
  Layer.provideMerge(runtimeSurfaceQueueDispatcherLayer),
);
const runtimeRequestInputWaitLayer = layerRuntimeRequestInputWaitService.pipe(
  Layer.provideMerge(runtimeQueueWakeLayer),
);
const runtimeInternalServicesLayer = Layer.mergeAll(
  runtimeSourceInvalidationLayer,
  runtimeRequestInputWaitLayer,
  runtimeApprovalWaitLayer,
  runtimeLaunchPolicyLayer,
  runtimeSurfaceEventPublisherLayer,
  runtimeSurfaceScopeLayer,
  runtimePromptExecutionLayer,
  runtimeSurfaceQueueDispatcherLayer,
  runtimeWorkflowTaskAgentBridgeLayer,
  runtimeQueueWakeLayer,
  layerRuntimeWorkspaceScopeService,
  layerRuntimePromptDefaultsService,
);

export namespace Runtime {
  const runtimeServiceLayer = Layer.effect(Runtime, makeRuntimeService());
  const runtimeAcceptedNativeToolExecutionLayer = layerRuntimeAcceptedNativeToolExecution;
  const runtimeExecutionPlanExecutorLayer = layerRuntimeExecutionPlanExecutor;
  const runtimeStartupReadinessLayer = layerRuntimeStartupReadiness;
  const runtimeShutdownPreparationLayer = layerRuntimeShutdownPreparation;

  export const layer: Layer.Layer<
    | Runtime
    | RuntimeStartupReadiness
    | RuntimeShutdownPreparation
    | StateCommandPostCommitNotificationPort,
    RuntimeLayerError,
    | RuntimeLayerConfigService
    | RuntimePromptDefaultsStatePort
    | PiAdapter
    | ProviderAuthPort
    | PiRuntimePathsPort
    | PiSessionReferencePort
    | RuntimeLayerProviderAuthPort
    | RuntimeLayerModelResolverPort
    | AppLogWritePort
    | RuntimeGeneratedContextRefreshHostPort
    | RuntimeGeneratedPackageRefreshHostPort
    | RuntimeSourceInvalidationScanPort
    | RuntimeLayerCommandStdinPort
    | RuntimeLayerCommandControlPort
    | SandboxPolicySource
    | SandboxHelperCandidatesPort
    | HostProcessReferencePort
    | RuntimeWorkspaceStatePort
    | RuntimeSurfaceLifecycleStatePort
    | RuntimeSourceStatePort
    | RuntimeGeneratedPackageStatePort
    | Extensions
    | FileSystem.FileSystem
    | Path.Path
    | Crypto.Crypto
    | ExtensionSourceRootsPort
    | RuntimeActorExtensionBindingStatePort
    | RuntimeQueueStatePort
    | RuntimeRequestStatePort
    | RuntimeApprovalStatePort
    | RuntimeCommandStatePort
    | RuntimeSessionWaitStatePort
    | RuntimeThreadStatePort
    | RuntimeTurnStatePort
    | RuntimeWorkflowTaskStatePort
    | RuntimeEpisodeStatePort
    | RuntimeWorkflowTaskAgentBridgeBearerVerifier
  > = Layer.mergeAll(
    runtimeServiceLayer,
    runtimeAcceptedNativeToolExecutionLayer,
    runtimeExecutionPlanExecutorLayer,
    runtimeStartupReadinessLayer,
    runtimeShutdownPreparationLayer,
    layerStateCommandPostCommitNotificationPort,
  ).pipe(Layer.provide(runtimeInternalServicesLayer));
}

export const layer = Runtime.layer;

interface RuntimeWorkspacesFacade {
  acquire(
    input: AcquireWorkspaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AcquireWorkspaceResult>;
  acquireDefault(
    input: AcquireDefaultWorkspaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AcquireWorkspaceResult>;
  release(
    input: ReleaseWorkspaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<ReleaseWorkspaceResult>;
}

interface RuntimeSurfacesFacade {
  createOrchestrator(
    input: CreateOrchestratorSurfaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<CreateSurfaceResult>;
  open(input: OpenSurfaceInput, options?: RuntimeFacadeCallOptions): Promise<OpenSurfaceResult>;
  close(input: CloseSurfaceInput, options?: RuntimeFacadeCallOptions): Promise<CloseSurfaceResult>;
}

interface RuntimeMessagesFacade {
  submit(
    input: SubmitMessageInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SubmitMessageResult>;
  abort(input: AbortPromptInput, options?: RuntimeFacadeCallOptions): Promise<void>;
}

interface RuntimeQueuesFacade {
  steer(input: SteerQueuedMessageInput, options?: RuntimeFacadeCallOptions): Promise<void>;
}

interface RuntimeRequestInputFacade {
  answer(
    input: AnswerRequestInputInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AnswerRequestInputResult>;
  setTimerPaused(
    input: SetRequestInputTimerPausedInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SetRequestInputTimerPausedResult>;
}

interface RuntimeCommandsFacade {
  writeStdin(
    input: WriteCommandStdinInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<WriteCommandStdinResult>;
  cancel(
    input: CancelCommandInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<CancelCommandResult>;
}

interface RuntimeApprovalsFacade {
  answer(
    input: AnswerRuntimeApprovalInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AnswerRuntimeApprovalResult>;
}

interface RuntimeSourceEditsFacade {
  open(
    input: OpenExtensionSourceEditInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceEditSession>;
  save(
    input: SaveExtensionSourceEditInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceEditSaveResult>;
}

interface RuntimeSourceInvalidationFacade {
  hint(input: SourceInvalidationHint, options?: RuntimeFacadeCallOptions): Promise<void>;
  reconcile(
    input: SourceReconcileRequest,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceReconcileResult>;
  applyCommittedScanEvent(
    input: ApplyCommittedSourceInvalidationEventInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceReconcileResult>;
  refreshGeneratedContext(
    input: RefreshGeneratedContextRequest,
    options?: RuntimeFacadeCallOptions,
  ): Promise<void>;
  refreshGeneratedPackages(
    input: RefreshGeneratedPackagesRequest,
    options?: RuntimeFacadeCallOptions,
  ): Promise<GeneratedPackagesRefreshResult>;
}

interface RuntimeFacadeCallOptions {
  signal?: AbortSignal;
  abortPolicy?: "cancel-wait-only" | "request-runtime-cancel";
}

interface RuntimeEventSubscription extends AsyncIterable<RuntimeEvent> {
  close(): Promise<void>;
  readonly closed: Promise<RuntimeEventSubscriptionClose>;
}

type RuntimeFacadeErrorReason = RuntimeFacadeErrorContract["reason"];

class RuntimeFacadeError extends Error {
  readonly type = "runtime-facade-error" as const;
  readonly reason: RuntimeFacadeErrorReason;
  readonly error: unknown;
  readonly defectClass: string | undefined;
  readonly diagnosticAppLogEntryId: AppLogEntryId | undefined;
  readonly interruptReason: string | undefined;

  constructor(input: RuntimeFacadeErrorContract, operation?: string) {
    const operationContext = operation ? ` ${operation}` : "";
    super(
      input.reason === "defect"
        ? input.message
        : `Runtime facade${operationContext} failed: ${input.reason}.`,
    );
    this.name = "RuntimeFacadeError";
    this.reason = input.reason;
    this.error = input.reason === "typed-failure" ? input.error : undefined;
    this.defectClass = input.reason === "defect" ? input.defectClass : undefined;
    this.diagnosticAppLogEntryId =
      input.reason === "defect" ? input.diagnosticAppLogEntryId : undefined;
    this.interruptReason = input.reason === "interrupted" ? input.interruptReason : undefined;
  }
}

interface RuntimeFacade {
  readonly workspaces: RuntimeWorkspacesFacade;
  readonly surfaces: RuntimeSurfacesFacade;
  readonly messages: RuntimeMessagesFacade;
  readonly queues: RuntimeQueuesFacade;
  readonly requestInput: RuntimeRequestInputFacade;
  readonly commands: RuntimeCommandsFacade;
  readonly approvals: RuntimeApprovalsFacade;
  readonly sourceEdits: RuntimeSourceEditsFacade;
  readonly sourceInvalidation: RuntimeSourceInvalidationFacade;
  events(
    input?: RuntimeEventsInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RuntimeEventSubscription>;
  close(): Promise<void>;
}

async function asyncIterableFromRuntimeEventSubscription(input: {
  subscription: Omit<RuntimeEventSubscriptionEffect, "stream"> & {
    readonly stream: Stream.Stream<RuntimeEvent, RuntimeEventError | RuntimeContractError>;
  };
  run: <B>(
    operation: string,
    effect: Effect.Effect<B, RuntimeEventError | RuntimeContractError>,
    options?: RuntimeFacadeCallOptions,
    config?: {
      readonly allowAfterClosed?: boolean;
      readonly registerActiveCall?: boolean;
    },
  ) => Promise<B>;
  options: RuntimeFacadeCallOptions | undefined;
  activeSubscriptions: Set<{ close(): Promise<void> }>;
  isClosed: () => boolean;
}): Promise<RuntimeEventSubscription> {
  const iterable = await input.run(
    "runtime.events.open",
    Stream.toAsyncIterableEffect(input.subscription.stream),
    input.options,
  );
  const iterator = iterable[Symbol.asyncIterator]();
  let closeStarted = false;
  const closeSubscription = async () => {
    if (!closeStarted) {
      closeStarted = true;
      input.activeSubscriptions.delete(activeSubscription);
      await iterator.return?.();
      await input.run("runtime.events.close", input.subscription.close(), undefined, {
        allowAfterClosed: true,
      });
    }
  };
  const activeSubscription = { close: closeSubscription };
  input.activeSubscriptions.add(activeSubscription);
  const closed = input.run(
    "runtime.events.closed",
    input.subscription.closed.pipe(
      Effect.flatMap((receipt) =>
        decodeUnknownRuntimeEventSubscriptionCloseEffect(receipt).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.events.closed",
                reason: "schema-error",
                ...boundarySchemaErrorDetails(cause),
                cause,
              }),
          ),
        ),
      ),
    ),
    undefined,
    { registerActiveCall: false },
  );
  if (input.isClosed()) {
    await closeSubscription();
  }
  return {
    close: closeSubscription,
    closed,
    [Symbol.asyncIterator]() {
      return {
        async next() {
          try {
            const result = await iterator.next();
            if (result.done) {
              await closeSubscription();
            }
            return result;
          } catch (error) {
            await closeSubscription();
            throw runtimeFacadeErrorFromUnknown("runtime.events.next", error);
          }
        },
        async return(value?: unknown) {
          await closeSubscription();
          return { done: true, value } as IteratorReturnResult<unknown>;
        },
        async throw(error?: unknown) {
          try {
            if (iterator.throw) {
              return await iterator.throw(error);
            }
            throw error;
          } finally {
            await closeSubscription();
          }
        },
      };
    },
  };
}

function runtimeFacadeErrorFromUnknown(operation: string, error: unknown): RuntimeFacadeError {
  if (error instanceof RuntimeFacadeError) {
    return error;
  }
  return new RuntimeFacadeError(
    {
      type: "runtime-facade-error",
      reason: "typed-failure",
      error: error as RuntimeContractError | RuntimeEventError,
    },
    operation,
  );
}

function runtimeFacadeErrorFromCause<E>(
  operation: string,
  cause: Cause.Cause<E>,
): RuntimeFacadeError {
  const failure = cause.reasons.find(Cause.isFailReason);
  if (failure) {
    return new RuntimeFacadeError(
      {
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: failure.error as RuntimeContractError | RuntimeEventError,
      },
      operation,
    );
  }

  const defect = cause.reasons.find(Cause.isDieReason);
  if (defect) {
    const defectValue = defect.defect;
    const className = defectClass(defectValue);
    return new RuntimeFacadeError(
      {
        type: "runtime-facade-error",
        reason: "defect",
        message: defectMessage(defectValue),
        ...(className ? { defectClass: className } : {}),
      },
      operation,
    );
  }

  if (Cause.hasInterruptsOnly(cause) || cause.reasons.some(Cause.isInterruptReason)) {
    return new RuntimeFacadeError(
      {
        type: "runtime-facade-error",
        reason: "interrupted",
      },
      operation,
    );
  }

  return new RuntimeFacadeError(
    {
      type: "runtime-facade-error",
      reason: "defect",
      message: defectMessage(Cause.squash(cause)),
    },
    operation,
  );
}

function defectMessage(defect: unknown): string {
  if (defect instanceof Error && defect.message.trim().length > 0) {
    return defect.message;
  }
  if (typeof defect === "string" && defect.trim().length > 0) {
    return defect;
  }
  return "Runtime facade defect.";
}

function defectClass(defect: unknown): string | undefined {
  return defect instanceof Error ? defect.constructor.name : undefined;
}

function abortedFacadeError(operation: string): RuntimeFacadeError {
  return new RuntimeFacadeError(
    {
      type: "runtime-facade-error",
      reason: "aborted",
    },
    operation,
  );
}

function disposedFacadeError(operation: string): RuntimeFacadeError {
  return new RuntimeFacadeError(
    {
      type: "runtime-facade-error",
      reason: "disposed",
    },
    operation,
  );
}

function unsupportedAbortPolicyError(operation: string): RuntimeFacadeError {
  return new RuntimeFacadeError(
    {
      type: "runtime-facade-error",
      reason: "typed-failure",
      error: new RuntimeContractError({
        operation,
        reason: "unsupported-operation",
        message: 'abortPolicy "request-runtime-cancel" is only supported by cancellation APIs.',
      }),
    },
    operation,
  );
}

export function createRuntimeFacade(
  managedRuntime: ManagedRuntime.ManagedRuntime<Runtime, unknown>,
): RuntimeFacade {
  let closed = false;
  const activeEventSubscriptions = new Set<{ close(): Promise<void> }>();
  const activeFacadeCalls = new Set<{ readonly dispose: () => void }>();

  const decodeBoundary = <A>(
    operation: string,
    decoder: (input: unknown) => Effect.Effect<A, Schema.SchemaError>,
    input: unknown,
  ): Effect.Effect<A, RuntimeContractError> =>
    decoder(input).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation,
            reason: "schema-error",
            ...boundarySchemaErrorDetails(cause),
            cause,
          }),
      ),
    );

  const run = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E, Runtime>,
    options?: RuntimeFacadeCallOptions,
    config?: {
      readonly allowAfterClosed?: boolean;
      readonly allowRuntimeCancel?: boolean;
      readonly registerActiveCall?: boolean;
    },
  ): Promise<A> => {
    if (closed && config?.allowAfterClosed !== true) {
      return Promise.reject(disposedFacadeError(operation));
    }

    const abortPolicy = options?.abortPolicy ?? "cancel-wait-only";
    if (abortPolicy === "request-runtime-cancel" && config?.allowRuntimeCancel !== true) {
      return Promise.reject(unsupportedAbortPolicyError(operation));
    }
    const signal = options?.signal;
    if (abortPolicy === "cancel-wait-only" && signal?.aborted) {
      return Promise.reject(abortedFacadeError(operation));
    }

    const runEffect = managedRuntime
      .runPromiseExit(
        effect,
        abortPolicy === "request-runtime-cancel" ? { signal: options?.signal } : undefined,
      )
      .then((exit) => {
        if (Exit.isSuccess(exit)) {
          return exit.value;
        }
        throw runtimeFacadeErrorFromCause(operation, exit.cause);
      });

    let activeCall!: { readonly dispose: () => void };
    let removeAbortListener: (() => void) | undefined;
    let settled = false;

    return new Promise<A>((resolve, reject) => {
      const settle = (complete: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        removeAbortListener?.();
        activeFacadeCalls.delete(activeCall);
        complete();
      };

      activeCall = {
        dispose: () => {
          settle(() => reject(disposedFacadeError(operation)));
        },
      };
      if (config?.registerActiveCall !== false) {
        activeFacadeCalls.add(activeCall);
      }

      if (abortPolicy === "cancel-wait-only" && signal) {
        const onAbort = () => {
          settle(() => reject(abortedFacadeError(operation)));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => {
          signal.removeEventListener("abort", onAbort);
        };
      }

      runEffect.then(
        (value) => {
          settle(() => resolve(value));
        },
        (error: unknown) => {
          settle(() => reject(error));
        },
      );
    });
  };

  return {
    workspaces: {
      acquire: (input, options) =>
        run(
          "runtime.workspaces.acquire",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.workspaces.acquire",
              decodeUnknownAcquireWorkspaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.workspaces.acquire(decodedInput);
            return yield* decodeBoundary(
              "runtime.workspaces.acquire",
              decodeUnknownAcquireWorkspaceResultEffect,
              result,
            );
          }),
          options,
        ),
      acquireDefault: (input, options) =>
        run(
          "runtime.workspaces.acquireDefault",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.workspaces.acquireDefault",
              decodeUnknownAcquireDefaultWorkspaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.workspaces.acquireDefault(decodedInput);
            return yield* decodeBoundary(
              "runtime.workspaces.acquireDefault",
              decodeUnknownAcquireWorkspaceResultEffect,
              result,
            );
          }),
          options,
        ),
      release: (input, options) =>
        run(
          "runtime.workspaces.release",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.workspaces.release",
              decodeUnknownReleaseWorkspaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.workspaces.release(decodedInput);
            return yield* decodeBoundary(
              "runtime.workspaces.release",
              decodeUnknownReleaseWorkspaceResultEffect,
              result,
            );
          }),
          options,
        ),
    },
    surfaces: {
      createOrchestrator: (input, options) =>
        run(
          "runtime.surfaces.createOrchestrator",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.surfaces.createOrchestrator",
              decodeUnknownCreateOrchestratorSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.createOrchestrator(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.createOrchestrator",
              decodeUnknownCreateSurfaceResultEffect,
              result,
            );
          }),
          options,
        ),
      open: (input, options) =>
        run(
          "runtime.surfaces.open",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.surfaces.open",
              decodeUnknownOpenSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.open(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.open",
              decodeUnknownOpenSurfaceResultEffect,
              result,
            );
          }),
          options,
        ),
      close: (input, options) =>
        run(
          "runtime.surfaces.close",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.surfaces.close",
              decodeUnknownCloseSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.close(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.close",
              decodeUnknownCloseSurfaceResultEffect,
              result,
            );
          }),
          options,
        ),
    },
    messages: {
      submit: (input, options) =>
        run(
          "runtime.messages.submit",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.messages.submit",
              decodeUnknownSubmitMessageInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.messages.submit(decodedInput);
            return yield* decodeBoundary(
              "runtime.messages.submit",
              decodeUnknownSubmitMessageResultEffect,
              result,
            );
          }),
          options,
        ),
      abort: (input, options) =>
        run(
          "runtime.messages.abort",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.messages.abort",
              decodeUnknownAbortPromptInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.messages.abort(decodedInput);
          }),
          options,
          { allowRuntimeCancel: true },
        ),
    },
    queues: {
      steer: (input, options) =>
        run(
          "runtime.queues.steer",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.queues.steer",
              decodeUnknownSteerQueuedMessageInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.queues.steer(decodedInput);
          }),
          options,
        ),
    },
    requestInput: {
      answer: (input, options) =>
        run(
          "runtime.requestInput.answer",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.requestInput.answer",
              decodeUnknownAnswerRequestInputInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.requestInput.answer(decodedInput);
            return yield* decodeBoundary(
              "runtime.requestInput.answer",
              decodeUnknownAnswerRequestInputResultEffect,
              result,
            );
          }),
          options,
        ),
      setTimerPaused: (input, options) =>
        run(
          "runtime.requestInput.setTimerPaused",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.requestInput.setTimerPaused",
              decodeUnknownSetRequestInputTimerPausedInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.requestInput.setTimerPaused(decodedInput);
            return yield* decodeBoundary(
              "runtime.requestInput.setTimerPaused",
              decodeUnknownSetRequestInputTimerPausedResultEffect,
              result,
            );
          }),
          options,
        ),
    },
    commands: {
      writeStdin: (input, options) =>
        run(
          "runtime.commands.writeStdin",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.commands.writeStdin",
              decodeUnknownWriteCommandStdinInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.commands.writeStdin(decodedInput);
            return yield* decodeBoundary(
              "runtime.commands.writeStdin",
              decodeUnknownWriteCommandStdinResultEffect,
              result,
            );
          }),
          options,
        ),
      cancel: (input, options) =>
        run(
          "runtime.commands.cancel",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.commands.cancel",
              decodeUnknownCancelCommandInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.commands.cancel(decodedInput);
            return yield* decodeBoundary(
              "runtime.commands.cancel",
              decodeUnknownCancelCommandResultEffect,
              result,
            );
          }),
          options,
          { allowRuntimeCancel: true },
        ),
    },
    approvals: {
      answer: (input, options) =>
        run(
          "runtime.approvals.answer",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.approvals.answer",
              decodeUnknownAnswerRuntimeApprovalInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.approvals.answer(decodedInput);
            return yield* decodeBoundary(
              "runtime.approvals.answer",
              decodeUnknownAnswerRuntimeApprovalResultEffect,
              result,
            );
          }),
          options,
        ),
    },
    sourceEdits: {
      open: (input, options) =>
        run(
          "runtime.sourceEdits.open",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceEdits.open",
              decodeUnknownOpenExtensionSourceEditInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceEdits.open(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceEdits.open",
              decodeUnknownSourceEditSessionEffect,
              result,
            );
          }),
          options,
        ),
      save: (input, options) =>
        run(
          "runtime.sourceEdits.save",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceEdits.save",
              decodeUnknownSaveExtensionSourceEditInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceEdits.save(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceEdits.save",
              decodeUnknownSourceEditSaveResultEffect,
              result,
            );
          }),
          options,
        ),
    },
    sourceInvalidation: {
      hint: (input, options) =>
        run(
          "runtime.sourceInvalidation.hint",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceInvalidation.hint",
              decodeUnknownSourceInvalidationHintEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.sourceInvalidation.hint(decodedInput);
          }),
          options,
        ),
      reconcile: (input, options) =>
        run(
          "runtime.sourceInvalidation.reconcile",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceInvalidation.reconcile",
              decodeUnknownSourceReconcileRequestEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceInvalidation.reconcile(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceInvalidation.reconcile",
              decodeUnknownSourceReconcileResultEffect,
              result,
            );
          }),
          options,
        ),
      applyCommittedScanEvent: (input, options) =>
        run(
          "runtime.sourceInvalidation.applyCommittedScanEvent",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceInvalidation.applyCommittedScanEvent",
              decodeUnknownApplyCommittedSourceInvalidationEventInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceInvalidation.applyCommittedScanEvent(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceInvalidation.applyCommittedScanEvent",
              decodeUnknownSourceReconcileResultEffect,
              result,
            );
          }),
          options,
        ),
      refreshGeneratedContext: (input, options) =>
        run(
          "runtime.sourceInvalidation.refreshGeneratedContext",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceInvalidation.refreshGeneratedContext",
              decodeUnknownRefreshGeneratedContextRequestEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.sourceInvalidation.refreshGeneratedContext(decodedInput);
          }),
          options,
        ),
      refreshGeneratedPackages: (input, options) =>
        run(
          "runtime.sourceInvalidation.refreshGeneratedPackages",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceInvalidation.refreshGeneratedPackages",
              decodeUnknownRefreshGeneratedPackagesRequestEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceInvalidation.refreshGeneratedPackages(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceInvalidation.refreshGeneratedPackages",
              decodeUnknownGeneratedPackagesRefreshResultEffect,
              result,
            );
          }),
          options,
        ),
    },
    async events(input, options) {
      const runtimeEvents = await run(
        "runtime.events",
        Effect.gen(function* () {
          const decodedInput =
            input === undefined
              ? undefined
              : yield* decodeBoundary(
                  "runtime.events",
                  decodeUnknownRuntimeEventsInputEffect,
                  input,
                );
          const runtime = yield* Runtime;
          const subscription = yield* runtime.events(decodedInput);
          return {
            ...subscription,
            stream: subscription.stream.pipe(
              Stream.mapEffect((event) =>
                decodeBoundary("runtime.events", decodeUnknownRuntimeEventEffect, event),
              ),
            ),
          };
        }),
        options,
      );
      return await asyncIterableFromRuntimeEventSubscription({
        activeSubscriptions: activeEventSubscriptions,
        isClosed: () => closed,
        options,
        run,
        subscription: runtimeEvents,
      });
    },
    async close() {
      closed = true;
      const subscriptions = [...activeEventSubscriptions];
      activeEventSubscriptions.clear();
      await Promise.allSettled(subscriptions.map((subscription) => subscription.close()));
      const activeCalls = [...activeFacadeCalls];
      activeFacadeCalls.clear();
      for (const activeCall of activeCalls) {
        activeCall.dispose();
      }
    },
  };
}
