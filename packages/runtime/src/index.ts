import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { boundarySchemaErrorDetails, RuntimeContractError } from "@svvy/core";
import type {
  AbortPromptInput,
  AcquireDefaultWorkspaceInput,
  AcquireWorkspaceInput,
  AcquireWorkspaceResult,
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
  RuntimeCommandsApiEffect,
  RuntimeEventError,
  RuntimeEvent,
  RuntimeEventSubscriptionClose,
  RuntimeEventsInput,
  RuntimeFacadeErrorContract,
  RuntimeMessagesApiEffect,
  RuntimeQueuesApiEffect,
  RuntimeRequestInputApiEffect,
  RuntimeSourceInvalidationApiEffect,
  RuntimeSurfacesApiEffect,
  RuntimeWorkspacesApiEffect,
  OpenExtensionSourceEditInput,
  SaveExtensionSourceEditInput,
  SourceEditSaveResult,
  SourceEditSession,
  SourceInvalidationHint,
  SourceReconcileRequest,
  SourceReconcileResult,
  RunExtensionDependencyActionInput,
  RunExtensionDependencyActionResult,
  SetRequestInputTimerPausedInput,
  SetRequestInputTimerPausedResult,
  SteerQueuedMessageInput,
  SubmitMessageInput,
  SubmitMessageResult,
  WriteCommandStdinInput,
  WriteCommandStdinResult,
} from "@svvy/core";
import {
  decodeAcquireDefaultWorkspaceInputEffect,
  decodeAcquireWorkspaceInputEffect,
  decodeAcquireWorkspaceResultEffect,
  decodeAnswerRequestInputInputEffect,
  decodeAnswerRequestInputResultEffect,
  decodeAnswerRuntimeApprovalInputEffect,
  decodeAnswerRuntimeApprovalResultEffect,
  decodeAbortPromptInputEffect,
  decodeCancelCommandInputEffect,
  decodeCancelCommandResultEffect,
  decodeCloseSurfaceInputEffect,
  decodeCloseSurfaceResultEffect,
  decodeCreateOrchestratorSurfaceInputEffect,
  decodeCreateSurfaceResultEffect,
  decodeGeneratedPackagesRefreshResultEffect,
  decodeOpenExtensionSourceEditInputEffect,
  decodeOpenSurfaceInputEffect,
  decodeOpenSurfaceResultEffect,
  decodeRefreshGeneratedContextRequestEffect,
  decodeRefreshGeneratedPackagesRequestEffect,
  decodeReleaseWorkspaceInputEffect,
  decodeReleaseWorkspaceResultEffect,
  decodeRunExtensionDependencyActionInputEffect,
  decodeRunExtensionDependencyActionResultEffect,
  decodeRuntimeEventEffect,
  decodeRuntimeEventSubscriptionCloseEffect,
  decodeRuntimeEventsInputEffect,
  decodeSaveExtensionSourceEditInputEffect,
  decodeSetRequestInputTimerPausedInputEffect,
  decodeSetRequestInputTimerPausedResultEffect,
  decodeSourceEditSaveResultEffect,
  decodeSourceEditSessionEffect,
  decodeSourceInvalidationHintEffect,
  decodeSourceReconcileRequestEffect,
  decodeSourceReconcileResultEffect,
  decodeSteerQueuedMessageInputEffect,
  decodeSubmitMessageInputEffect,
  decodeSubmitMessageResultEffect,
  decodeWriteCommandStdinInputEffect,
  decodeWriteCommandStdinResultEffect,
} from "@svvy/core";
import { makeRuntimeService, type RuntimeLayerRequirements } from "./runtime-layer";
import type { RuntimeLayerError } from "./runtime-layer-config";

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
  events(
    input?: RuntimeEventsInput,
  ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
}

export class Runtime extends Context.Service<Runtime, RuntimeService>()("@svvy/runtime/Runtime") {}

export namespace Runtime {
  export const layer: Layer.Layer<Runtime, RuntimeLayerError, RuntimeLayerRequirements> =
    Layer.effect(Runtime, makeRuntimeService());
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
  runExtensionDependencyAction(
    input: RunExtensionDependencyActionInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RunExtensionDependencyActionResult>;
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
      await input.run("runtime.events.close", input.subscription.close());
    }
  };
  const activeSubscription = { close: closeSubscription };
  input.activeSubscriptions.add(activeSubscription);
  const closed = input.run(
    "runtime.events.closed",
    input.subscription.closed.pipe(
      Effect.flatMap((receipt) =>
        decodeRuntimeEventSubscriptionCloseEffect(receipt).pipe(
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

function waitForAbort(operation: string, signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(abortedFacadeError(operation));
  }

  return new Promise((_, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortedFacadeError(operation));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createRuntimeFacade(
  managedRuntime: ManagedRuntime.ManagedRuntime<Runtime, unknown>,
): RuntimeFacade {
  let closed = false;
  const activeEventSubscriptions = new Set<{ close(): Promise<void> }>();

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
    config?: { readonly allowRuntimeCancel?: boolean },
  ): Promise<A> => {
    if (closed) {
      return Promise.reject(
        new RuntimeFacadeError(
          {
            type: "runtime-facade-error",
            reason: "disposed",
          },
          operation,
        ),
      );
    }

    const abortPolicy = options?.abortPolicy ?? "cancel-wait-only";
    if (abortPolicy === "request-runtime-cancel" && config?.allowRuntimeCancel !== true) {
      return Promise.reject(unsupportedAbortPolicyError(operation));
    }
    if (abortPolicy === "cancel-wait-only" && options?.signal?.aborted) {
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

    if (abortPolicy === "request-runtime-cancel" || !options?.signal) {
      return runEffect;
    }

    return Promise.race([runEffect, waitForAbort(operation, options.signal)]);
  };

  return {
    workspaces: {
      acquire: (input, options) =>
        run(
          "runtime.workspaces.acquire",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.workspaces.acquire",
              decodeAcquireWorkspaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.workspaces.acquire(decodedInput);
            return yield* decodeBoundary(
              "runtime.workspaces.acquire",
              decodeAcquireWorkspaceResultEffect,
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
              decodeAcquireDefaultWorkspaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.workspaces.acquireDefault(decodedInput);
            return yield* decodeBoundary(
              "runtime.workspaces.acquireDefault",
              decodeAcquireWorkspaceResultEffect,
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
              decodeReleaseWorkspaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.workspaces.release(decodedInput);
            return yield* decodeBoundary(
              "runtime.workspaces.release",
              decodeReleaseWorkspaceResultEffect,
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
              decodeCreateOrchestratorSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.createOrchestrator(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.createOrchestrator",
              decodeCreateSurfaceResultEffect,
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
              decodeOpenSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.open(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.open",
              decodeOpenSurfaceResultEffect,
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
              decodeCloseSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.close(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.close",
              decodeCloseSurfaceResultEffect,
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
              decodeSubmitMessageInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.messages.submit(decodedInput);
            return yield* decodeBoundary(
              "runtime.messages.submit",
              decodeSubmitMessageResultEffect,
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
              decodeAbortPromptInputEffect,
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
              decodeSteerQueuedMessageInputEffect,
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
              decodeAnswerRequestInputInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.requestInput.answer(decodedInput);
            return yield* decodeBoundary(
              "runtime.requestInput.answer",
              decodeAnswerRequestInputResultEffect,
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
              decodeSetRequestInputTimerPausedInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.requestInput.setTimerPaused(decodedInput);
            return yield* decodeBoundary(
              "runtime.requestInput.setTimerPaused",
              decodeSetRequestInputTimerPausedResultEffect,
              result,
            );
          }),
          options,
        ),
    },
    commands: {
      runExtensionDependencyAction: (input, options) =>
        run(
          "runtime.commands.runExtensionDependencyAction",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.commands.runExtensionDependencyAction",
              decodeRunExtensionDependencyActionInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.commands.runExtensionDependencyAction(decodedInput);
            return yield* decodeBoundary(
              "runtime.commands.runExtensionDependencyAction",
              decodeRunExtensionDependencyActionResultEffect,
              result,
            );
          }),
          options,
        ),
      writeStdin: (input, options) =>
        run(
          "runtime.commands.writeStdin",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.commands.writeStdin",
              decodeWriteCommandStdinInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.commands.writeStdin(decodedInput);
            return yield* decodeBoundary(
              "runtime.commands.writeStdin",
              decodeWriteCommandStdinResultEffect,
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
              decodeCancelCommandInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.commands.cancel(decodedInput);
            return yield* decodeBoundary(
              "runtime.commands.cancel",
              decodeCancelCommandResultEffect,
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
              decodeAnswerRuntimeApprovalInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.approvals.answer(decodedInput);
            return yield* decodeBoundary(
              "runtime.approvals.answer",
              decodeAnswerRuntimeApprovalResultEffect,
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
              decodeOpenExtensionSourceEditInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceEdits.open(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceEdits.open",
              decodeSourceEditSessionEffect,
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
              decodeSaveExtensionSourceEditInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceEdits.save(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceEdits.save",
              decodeSourceEditSaveResultEffect,
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
              decodeSourceInvalidationHintEffect,
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
              decodeSourceReconcileRequestEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceInvalidation.reconcile(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceInvalidation.reconcile",
              decodeSourceReconcileResultEffect,
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
              decodeRefreshGeneratedContextRequestEffect,
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
              decodeRefreshGeneratedPackagesRequestEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceInvalidation.refreshGeneratedPackages(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceInvalidation.refreshGeneratedPackages",
              decodeGeneratedPackagesRefreshResultEffect,
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
              : yield* decodeBoundary("runtime.events", decodeRuntimeEventsInputEffect, input);
          const runtime = yield* Runtime;
          const subscription = yield* runtime.events(decodedInput);
          return {
            ...subscription,
            stream: subscription.stream.pipe(
              Stream.mapEffect((event) =>
                decodeBoundary("runtime.events", decodeRuntimeEventEffect, event),
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
    },
  };
}
