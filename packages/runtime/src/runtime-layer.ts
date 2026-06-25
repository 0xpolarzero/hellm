import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeEventStreamError,
  StateContractError,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeWorkspaceStatePort,
  runtimeClientSubmissionLogDetails,
  type AcquireDefaultWorkspaceInput,
  type AcquireWorkspaceInput,
  type AcquireWorkspaceResult,
  type AbortPromptInput,
  type AnswerRuntimeApprovalInput,
  type AnswerRuntimeApprovalResult,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type CancelCommandInput,
  type CancelCommandResult,
  type CloseSurfaceInput,
  type CloseSurfaceResult,
  type CreateOrchestratorSurfaceInput,
  type CreateSurfaceResult,
  type GeneratedPackagesRefreshResult,
  type OpenSurfaceInput,
  type OpenSurfaceResult,
  type PromptTarget,
  type ReasoningEffort,
  type RefreshGeneratedContextRequest,
  type RefreshGeneratedPackagesRequest,
  type ReleaseWorkspaceInput,
  type ReleaseWorkspaceResult,
  type RuntimeCommandStatePortService,
  type RuntimeEvent,
  type RuntimeEventError,
  type RuntimeEventSequence,
  type RuntimeEventsInput,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeWorkspaceStatePortService,
  type OpenExtensionSourceEditInput,
  type SaveExtensionSourceEditInput,
  type SourceEditSaveResult,
  type SourceEditSession,
  type SetRequestInputTimerPausedInput,
  type SetRequestInputTimerPausedResult,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type SourceReconcileResult,
  type StateInvalidationDescriptor,
  type SteerQueuedMessageInput,
  type SubmitMessageInput,
  type SubmitMessageResult,
  type WriteCommandStdinInput,
  type WriteCommandStdinResult,
  type RunExtensionDependencyActionInput,
} from "@svvy/core";
import {
  answerRuntimeApproval,
  RuntimeApprovalAnswerPostCommitHost,
} from "./runtime-approval-answer";
import {
  answerRuntimeRequestInput,
  RuntimeRequestInputPostCommitLane,
  setRuntimeRequestInputTimerPaused,
} from "./request-input-lifecycle";
import {
  RuntimeMessageSubmissionPostCommitLane,
  submitRuntimeMessage,
  summarizeRuntimeSubmittedMessageForTelemetry,
  type RuntimeSubmittedMessagePostCommitInput,
} from "./runtime-message-submission";
import {
  abortRuntimeQueuedMessage,
  RuntimeQueuedMessageAbortPostCommitHost,
  type RuntimeQueuedMessageAbortedInput,
} from "./runtime-message-abort";
import {
  RuntimeQueueSteeringPostCommitLane,
  steerRuntimeQueuedMessage,
  type RuntimeQueuedMessageSteeredInput,
} from "./runtime-queue-steering";
import { RuntimeEventBus, type RuntimeEventSubscriptionEffect } from "./runtime-event-bus";

export interface RuntimePromptDefaults {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
}

export interface RuntimeLayerPromptHostPort {
  resolvePromptDefaultsForTarget(target: PromptTarget): RuntimePromptDefaults;
  afterRuntimeSurfaceMessageQueued(input: {
    readonly target: PromptTarget;
    readonly provider: string;
    readonly model: string;
    readonly thinkingLevel: ReasoningEffort;
    readonly messages: readonly [];
    readonly queueOnly: boolean;
    readonly queuedMessageId: string;
    readonly clientSubmission: SubmitMessageInput["clientSubmission"];
    readonly promptTelemetry: ReturnType<typeof summarizeRuntimeSubmittedMessageForTelemetry>;
    readonly onEvent: (event: RuntimePromptLifecycleEvent) => void;
  }): Promise<{
    readonly dispatched: boolean;
    readonly queued?: boolean;
    readonly queuedMessageId?: string;
    readonly target: PromptTarget;
  }>;
  afterRuntimeQueuedMessageAborted(input: {
    readonly target: PromptTarget;
    readonly queuedMessageId: string;
  }): Promise<unknown>;
  afterRuntimeSurfaceMessageSteered(input: {
    readonly target: PromptTarget;
    readonly queuedMessageId: string;
  }): Promise<unknown>;
  cancelActivePrompt(input: {
    readonly target: PromptTarget;
    readonly turnId: string | undefined;
  }): Promise<void>;
  cancelPrompt(target: PromptTarget): Promise<void>;
}

export const RuntimeLayerPromptHostPort = Context.Service<
  RuntimeLayerPromptHostPort,
  RuntimeLayerPromptHostPort
>("@svvy/runtime/RuntimeLayerPromptHostPort");

export interface RuntimeLayerRequestInputPostCommitPort {
  afterRequestInputAnswered(input: {
    readonly surfacePiSessionId: string;
    readonly requestId: string;
    readonly queuedItemId: string | null;
  }): Promise<unknown>;
  afterRequestInputTimerPaused(input: { readonly requestId: string }): Promise<unknown>;
}

export const RuntimeLayerRequestInputPostCommitPort = Context.Service<
  RuntimeLayerRequestInputPostCommitPort,
  RuntimeLayerRequestInputPostCommitPort
>("@svvy/runtime/RuntimeLayerRequestInputPostCommitPort");

export interface RuntimeLayerApprovalPostCommitPort {
  resolveRuntimeApprovalAnswer(input: {
    readonly requestId: string;
    readonly approved: boolean;
    readonly reason: string | null;
  }): Promise<unknown>;
}

export const RuntimeLayerApprovalPostCommitPort = Context.Service<
  RuntimeLayerApprovalPostCommitPort,
  RuntimeLayerApprovalPostCommitPort
>("@svvy/runtime/RuntimeLayerApprovalPostCommitPort");

export interface RuntimeLayerProviderAuthPort {
  ensureUsableProviderAuth(provider: string): Promise<string | undefined>;
  getProviderAuthUnavailableMessage(provider: string): string;
}

export const RuntimeLayerProviderAuthPort = Context.Service<
  RuntimeLayerProviderAuthPort,
  RuntimeLayerProviderAuthPort
>("@svvy/runtime/RuntimeLayerProviderAuthPort");

export interface RuntimeLayerModelResolverPort {
  resolveModelId(input: {
    readonly provider: string;
    readonly model: string;
  }): Effect.Effect<string, RuntimeContractError>;
}

export const RuntimeLayerModelResolverPort = Context.Service<
  RuntimeLayerModelResolverPort,
  RuntimeLayerModelResolverPort
>("@svvy/runtime/RuntimeLayerModelResolverPort");

export interface RuntimeLayerDevTelemetryPort {
  recordDevBrowserToolsEvent(name: string, details?: Record<string, unknown>): void;
}

export const RuntimeLayerDevTelemetryPort = Context.Service<
  RuntimeLayerDevTelemetryPort,
  RuntimeLayerDevTelemetryPort
>("@svvy/runtime/RuntimeLayerDevTelemetryPort");

export interface RuntimeLayerAppLogPort {
  info(source: string, message: string, details?: Record<string, unknown>): void;
  warning(source: string, message: string, details?: Record<string, unknown>): void;
  error(source: string, message: string, details?: Record<string, unknown>): void;
}

export const RuntimeLayerAppLogPort = Context.Service<
  RuntimeLayerAppLogPort,
  RuntimeLayerAppLogPort
>("@svvy/runtime/RuntimeLayerAppLogPort");

export interface RuntimeLayerSourceEditsPort {
  open(input: OpenExtensionSourceEditInput): Promise<SourceEditSession>;
  save(input: SaveExtensionSourceEditInput): Promise<SourceEditSaveResult>;
}

export const RuntimeLayerSourceEditsPort = Context.Service<
  RuntimeLayerSourceEditsPort,
  RuntimeLayerSourceEditsPort
>("@svvy/runtime/RuntimeLayerSourceEditsPort");

export interface RuntimeLayerSourceInvalidationPort {
  hint(input: SourceInvalidationHint): Promise<void>;
  reconcile(input: SourceReconcileRequest): Promise<SourceReconcileResult>;
  refreshGeneratedContext(input: RefreshGeneratedContextRequest): Promise<void>;
  refreshGeneratedPackages(
    input: RefreshGeneratedPackagesRequest,
  ): Promise<GeneratedPackagesRefreshResult>;
}

export const RuntimeLayerSourceInvalidationPort = Context.Service<
  RuntimeLayerSourceInvalidationPort,
  RuntimeLayerSourceInvalidationPort
>("@svvy/runtime/RuntimeLayerSourceInvalidationPort");

export interface RuntimeLayerEventsPort {
  events(
    input?: RuntimeEventsInput,
  ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
  publishStateInvalidations(input: {
    readonly afterCommit: readonly StateInvalidationDescriptor[];
  }): Effect.Effect<readonly RuntimeEvent[], RuntimeEventStreamError>;
}

export const RuntimeLayerEventsPort = Context.Service<
  RuntimeLayerEventsPort,
  RuntimeLayerEventsPort
>("@svvy/runtime/RuntimeLayerEventsPort");

export interface RuntimeLayerCommandStdinPort {
  writeStdin(
    input: WriteCommandStdinInput,
  ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError>;
}

export const RuntimeLayerCommandStdinPort = Context.Service<
  RuntimeLayerCommandStdinPort,
  RuntimeLayerCommandStdinPort
>("@svvy/runtime/RuntimeLayerCommandStdinPort");

export interface RuntimeLayerCommandControlPort {
  cancel(input: CancelCommandInput): Effect.Effect<CancelCommandResult, RuntimeContractError>;
}

export const RuntimeLayerCommandControlPort = Context.Service<
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandControlPort
>("@svvy/runtime/RuntimeLayerCommandControlPort");

export type RuntimeLayerRequirements =
  | RuntimeLayerPromptHostPort
  | RuntimeLayerRequestInputPostCommitPort
  | RuntimeLayerApprovalPostCommitPort
  | RuntimeLayerProviderAuthPort
  | RuntimeLayerModelResolverPort
  | RuntimeLayerDevTelemetryPort
  | RuntimeLayerAppLogPort
  | RuntimeLayerSourceEditsPort
  | RuntimeLayerSourceInvalidationPort
  | RuntimeLayerEventsPort
  | RuntimeLayerCommandStdinPort
  | RuntimeLayerCommandControlPort
  | RuntimeWorkspaceStatePort
  | RuntimeSurfaceLifecycleStatePort
  | RuntimeSourceStatePort
  | RuntimeQueueStatePort
  | RuntimeRequestStatePort
  | RuntimeApprovalStatePort
  | RuntimeCommandStatePort
  | RuntimeSessionWaitStatePort;

type RuntimePromptLifecycleEvent =
  | {
      readonly type: "start";
    }
  | {
      readonly type: "done";
      readonly reason?: string;
    }
  | {
      readonly type: "error";
      readonly reason?: string;
      readonly error: {
        readonly content: readonly { readonly type: "text"; readonly text: string }[];
      };
    };

export function makeRuntimeService() {
  return Effect.gen(function* () {
    const promptHost = yield* RuntimeLayerPromptHostPort;
    const requestInputPostCommit = yield* RuntimeLayerRequestInputPostCommitPort;
    const approvalPostCommit = yield* RuntimeLayerApprovalPostCommitPort;
    const providerAuth = yield* RuntimeLayerProviderAuthPort;
    const modelResolver = yield* RuntimeLayerModelResolverPort;
    const devTelemetry = yield* RuntimeLayerDevTelemetryPort;
    const appLog = yield* RuntimeLayerAppLogPort;
    const sourceEdits = yield* RuntimeLayerSourceEditsPort;
    const sourceInvalidation = yield* RuntimeLayerSourceInvalidationPort;
    const eventsPort = yield* RuntimeLayerEventsPort;
    const commandStdin = yield* RuntimeLayerCommandStdinPort;
    const commandControl = yield* RuntimeLayerCommandControlPort;
    const workspaceState = yield* RuntimeWorkspaceStatePort;
    const surfaceLifecycleState = yield* RuntimeSurfaceLifecycleStatePort;
    yield* RuntimeSourceStatePort;
    const queueState = yield* RuntimeQueueStatePort;
    const requestState = yield* RuntimeRequestStatePort;
    const approvalState = yield* RuntimeApprovalStatePort;
    const commandState = yield* RuntimeCommandStatePort;
    const sessionWaitState = yield* RuntimeSessionWaitStatePort;

    return {
      workspaces: {
        acquire: (input: AcquireWorkspaceInput) =>
          acquireWorkspace({
            input,
            workspaceState,
            eventsPort,
          }),
        acquireDefault: (input: AcquireDefaultWorkspaceInput) =>
          acquireDefaultWorkspace({
            input,
            workspaceState,
            eventsPort,
          }),
        release: (input: ReleaseWorkspaceInput) =>
          releaseWorkspace({
            input,
            workspaceState,
            eventsPort,
          }),
      },
      surfaces: {
        createOrchestrator: (input: CreateOrchestratorSurfaceInput) =>
          createOrchestratorSurface({
            input,
            surfaceLifecycleState,
            eventsPort,
          }),
        open: (input: OpenSurfaceInput) =>
          openSurface({
            input,
            surfaceLifecycleState,
            eventsPort,
          }),
        close: (input: CloseSurfaceInput) =>
          closeSurface({
            input,
            surfaceLifecycleState,
            eventsPort,
          }),
      },
      messages: {
        submit: (input: SubmitMessageInput) =>
          submitMessage({
            input,
            promptHost,
            queueState,
            providerAuth,
            modelResolver,
            devTelemetry,
            appLog,
            eventsPort,
          }),
        abort: (input: AbortPromptInput) =>
          abortPrompt({
            input,
            promptHost,
            queueState,
            devTelemetry,
            appLog,
            eventsPort,
          }),
      },
      queues: {
        steer: (input: SteerQueuedMessageInput) =>
          steerRuntimeQueuedMessage({ input }).pipe(
            Effect.provideService(RuntimeQueueStatePort, queueState),
            Effect.provideService(RuntimeEventBus, runtimeEventBusFromPort(eventsPort)),
            Effect.provideService(
              RuntimeQueueSteeringPostCommitLane,
              runtimeQueueSteeringPostCommitLaneFromPort({ promptHost, appLog }),
            ),
            Effect.mapError((cause: unknown) => runtimeAdapterError("runtime.queues.steer", cause)),
          ),
      },
      requestInput: {
        answer: (
          input: AnswerRequestInputInput,
        ): Effect.Effect<AnswerRequestInputResult, RuntimeContractError> =>
          answerRuntimeRequestInput(input).pipe(
            Effect.provideService(RuntimeRequestStatePort, requestState),
            Effect.provideService(RuntimeEventBus, runtimeEventBusFromPort(eventsPort)),
            Effect.provideService(
              RuntimeRequestInputPostCommitLane,
              runtimeRequestInputPostCommitLaneFromPort(requestInputPostCommit),
            ),
          ),
        setTimerPaused: (
          input: SetRequestInputTimerPausedInput,
        ): Effect.Effect<SetRequestInputTimerPausedResult, RuntimeContractError> =>
          setRuntimeRequestInputTimerPaused(input).pipe(
            Effect.provideService(RuntimeRequestStatePort, requestState),
            Effect.provideService(RuntimeEventBus, runtimeEventBusFromPort(eventsPort)),
            Effect.provideService(
              RuntimeRequestInputPostCommitLane,
              runtimeRequestInputPostCommitLaneFromPort(requestInputPostCommit),
            ),
          ),
      },
      commands: {
        runExtensionDependencyAction: (input: RunExtensionDependencyActionInput) =>
          Effect.fail(
            unsupportedCommandAction(input, "runtime.commands.runExtensionDependencyAction"),
          ),
        writeStdin: (
          input: WriteCommandStdinInput,
        ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError> =>
          writeCommandStdin({
            input,
            commandState,
            commandStdin,
            eventsPort,
          }),
        cancel: (
          input: CancelCommandInput,
        ): Effect.Effect<CancelCommandResult, RuntimeContractError> =>
          cancelCommand({
            input,
            commandState,
            commandControl,
            eventsPort,
          }),
      },
      approvals: {
        answer: (
          input: AnswerRuntimeApprovalInput,
        ): Effect.Effect<AnswerRuntimeApprovalResult, RuntimeContractError> =>
          answerRuntimeApproval(input).pipe(
            Effect.provideService(RuntimeApprovalStatePort, approvalState),
            Effect.provideService(RuntimeCommandStatePort, commandState),
            Effect.provideService(RuntimeSessionWaitStatePort, sessionWaitState),
            Effect.provideService(RuntimeEventBus, runtimeEventBusFromPort(eventsPort)),
            Effect.provideService(
              RuntimeApprovalAnswerPostCommitHost,
              runtimeApprovalAnswerPostCommitHostFromPort(approvalPostCommit),
            ),
          ),
      },
      sourceEdits: {
        open: (input: OpenExtensionSourceEditInput) =>
          Effect.tryPromise({
            try: () => sourceEdits.open(input),
            catch: (cause: unknown) => runtimeAdapterError("runtime.sourceEdits.open", cause),
          }),
        save: (input: SaveExtensionSourceEditInput) =>
          Effect.tryPromise({
            try: () => sourceEdits.save(input),
            catch: (cause: unknown) => runtimeAdapterError("runtime.sourceEdits.save", cause),
          }),
      },
      sourceInvalidation: {
        hint: (input: SourceInvalidationHint) =>
          delegateSourceInvalidationMethod(
            "runtime.sourceInvalidation.hint",
            sourceInvalidation.hint,
            input,
          ),
        reconcile: (input: SourceReconcileRequest) =>
          delegateSourceInvalidationMethod(
            "runtime.sourceInvalidation.reconcile",
            sourceInvalidation.reconcile,
            input,
          ),
        refreshGeneratedContext: (input: RefreshGeneratedContextRequest) =>
          delegateSourceInvalidationMethod(
            "runtime.sourceInvalidation.refreshGeneratedContext",
            sourceInvalidation.refreshGeneratedContext,
            input,
          ),
        refreshGeneratedPackages: (input: RefreshGeneratedPackagesRequest) =>
          delegateSourceInvalidationMethod(
            "runtime.sourceInvalidation.refreshGeneratedPackages",
            sourceInvalidation.refreshGeneratedPackages,
            input,
          ),
      },
      events: (input?: RuntimeEventsInput) => eventsPort.events(input),
    };
  });
}

function acquireWorkspace(input: {
  readonly input: AcquireWorkspaceInput;
  readonly workspaceState: RuntimeWorkspaceStatePortService;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<AcquireWorkspaceResult, RuntimeContractError> {
  const operation = "runtime.workspaces.acquire";
  return commitStateMutation({
    operation,
    effect: input.workspaceState.acquireWorkspace(input.input),
    eventsPort: input.eventsPort,
  });
}

function acquireDefaultWorkspace(input: {
  readonly input: AcquireDefaultWorkspaceInput;
  readonly workspaceState: RuntimeWorkspaceStatePortService;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<AcquireWorkspaceResult, RuntimeContractError> {
  const operation = "runtime.workspaces.acquireDefault";
  return commitStateMutation({
    operation,
    effect: input.workspaceState.acquireDefaultWorkspace(input.input),
    eventsPort: input.eventsPort,
  });
}

function releaseWorkspace(input: {
  readonly input: ReleaseWorkspaceInput;
  readonly workspaceState: RuntimeWorkspaceStatePortService;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<ReleaseWorkspaceResult, RuntimeContractError> {
  const operation = "runtime.workspaces.release";
  return commitStateMutation({
    operation,
    effect: input.workspaceState.releaseWorkspace(input.input),
    eventsPort: input.eventsPort,
  });
}

function createOrchestratorSurface(input: {
  readonly input: CreateOrchestratorSurfaceInput;
  readonly surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<CreateSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.createOrchestrator";
  return commitStateMutation({
    operation,
    effect: input.surfaceLifecycleState.createOrchestratorSurface(input.input),
    eventsPort: input.eventsPort,
  });
}

function openSurface(input: {
  readonly input: OpenSurfaceInput;
  readonly surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<OpenSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.open";
  return commitStateMutation({
    operation,
    effect: input.surfaceLifecycleState.openSurface(input.input),
    eventsPort: input.eventsPort,
  });
}

function closeSurface(input: {
  readonly input: CloseSurfaceInput;
  readonly surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<CloseSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.close";
  return commitStateMutation({
    operation,
    effect: input.surfaceLifecycleState.closeSurface(input.input),
    eventsPort: input.eventsPort,
  });
}

function commitStateMutation<Value>(input: {
  readonly operation: string;
  readonly effect: Effect.Effect<
    { readonly value: Value; readonly afterCommit: readonly StateInvalidationDescriptor[] },
    StateContractError
  >;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<Value, RuntimeContractError> {
  return Effect.gen(function* () {
    const result = yield* input.effect.pipe(
      Effect.mapError((cause) => runtimeStateError(input.operation, cause)),
    );
    yield* input.eventsPort
      .publishStateInvalidations({ afterCommit: result.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(input.operation, cause)));
    return result.value;
  });
}

function submitMessage(input: {
  readonly input: SubmitMessageInput;
  readonly promptHost: RuntimeLayerPromptHostPort;
  readonly queueState: RuntimeQueueStatePortService;
  readonly providerAuth: RuntimeLayerProviderAuthPort;
  readonly modelResolver: RuntimeLayerModelResolverPort;
  readonly devTelemetry: RuntimeLayerDevTelemetryPort;
  readonly appLog: RuntimeLayerAppLogPort;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<SubmitMessageResult, RuntimeContractError> {
  return Effect.gen(function* () {
    const target = input.input.target;
    const threadId = promptTargetThreadId(target);
    const resolved = input.promptHost.resolvePromptDefaultsForTarget(target);
    const clientSubmission = input.input.clientSubmission;
    const delivery = input.input.delivery ?? "enqueue-and-run";
    const promptTelemetry = summarizeRuntimeSubmittedMessageForTelemetry(input.input.message);
    const promptCorrelationDetails = runtimeClientSubmissionLogDetails(clientSubmission);

    const apiKey = yield* Effect.tryPromise({
      try: () => input.providerAuth.ensureUsableProviderAuth(resolved.provider),
      catch: (cause: unknown) => runtimeAdapterError("runtime.messages.submit.providerAuth", cause),
    });
    if (!apiKey) {
      const message = input.providerAuth.getProviderAuthUnavailableMessage(resolved.provider);
      input.appLog.warning("auth.provider", "Configured provider is not connected for prompt.", {
        provider: resolved.provider,
        ...promptCorrelationDetails,
        workspaceSessionId: target.workspaceSessionId,
        surfacePiSessionId: target.surfacePiSessionId,
        threadId,
      });
      return yield* Effect.fail(
        new RuntimeContractError({
          operation: "runtime.messages.submit",
          reason: "target-not-ready",
          message,
        }),
      );
    }

    const modelId = yield* input.modelResolver.resolveModelId({
      provider: resolved.provider,
      model: resolved.model,
    });
    input.devTelemetry.recordDevBrowserToolsEvent("prompt.requested", {
      ...promptTelemetry,
      ...promptCorrelationDetails,
      model: modelId,
      provider: resolved.provider,
      delivery,
      requestedSurfacePiSessionId: target.surfacePiSessionId,
      requestedWorkspaceSessionId: target.workspaceSessionId,
      requestedThreadId: threadId ?? null,
    });
    input.appLog.info("prompt", "Prompt requested.", {
      ...promptTelemetry,
      ...promptCorrelationDetails,
      model: modelId,
      provider: resolved.provider,
      delivery,
      workspaceSessionId: target.workspaceSessionId,
      surfacePiSessionId: target.surfacePiSessionId,
      threadId,
    });

    const submitResult = yield* submitRuntimeMessage({ input: input.input }).pipe(
      Effect.provideService(RuntimeQueueStatePort, input.queueState),
      Effect.provideService(RuntimeEventBus, runtimeEventBusFromPort(input.eventsPort)),
      Effect.provideService(
        RuntimeMessageSubmissionPostCommitLane,
        runtimeMessageSubmissionPostCommitLaneFromPort({
          promptHost: input.promptHost,
          appLog: input.appLog,
          devTelemetry: input.devTelemetry,
          resolvedProvider: resolved.provider,
          resolvedModel: modelId,
          resolvedReasoningEffort: resolved.reasoningEffort,
          promptCorrelationDetails,
          recordPromptLifecycleEvent: (event, postCommitInput) =>
            recordPromptLifecycleEvent({
              event,
              promptHost: input.promptHost,
              appLog: input.appLog,
              devTelemetry: input.devTelemetry,
              promptTelemetry: postCommitInput.promptTelemetry,
              promptCorrelationDetails,
              modelId,
              provider: resolved.provider,
              queuedMessageId: postCommitInput.queuedMessageId,
              surfacePiSessionId: target.surfacePiSessionId,
              target,
            }),
        }),
      ),
    );

    return {
      queuedMessageId: submitResult.queuedMessageId,
      target: submitResult.target,
      status: "queued" as const,
      receipt: submitResult.receipt,
    };
  }).pipe(Effect.mapError((cause) => runtimeAdapterError("runtime.messages.submit", cause)));
}

function writeCommandStdin(input: {
  readonly input: WriteCommandStdinInput;
  readonly commandState: RuntimeCommandStatePortService;
  readonly commandStdin: RuntimeLayerCommandStdinPort;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<WriteCommandStdinResult, RuntimeContractError> {
  const operation = "runtime.commands.writeStdin";
  return Effect.gen(function* () {
    const command = yield* input.commandState
      .findCommandById({
        commandId: input.input.commandId,
      })
      .pipe(Effect.mapError((cause) => runtimeCommandStateError(operation, cause)));
    if (!command) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "target-not-found",
          message: `Command not found: ${input.input.commandId}`,
        }),
      );
    }
    if (isTerminalCommandStatus(command.status)) {
      return { commandId: input.input.commandId, status: "already_terminal" };
    }

    const admission = yield* input.commandStdin.writeStdin(input.input);
    if (admission.status !== "accepted") {
      return admission;
    }

    const recorded = yield* input.commandState
      .recordStdinWrite({
        sessionId: command.sessionId,
        commandId: command.id,
        text: input.input.text,
        acceptedBytes: admission.acceptedBytes,
      })
      .pipe(Effect.mapError((cause) => runtimeCommandStateError(operation, cause)));
    yield* input.eventsPort
      .publishStateInvalidations({
        afterCommit: recorded.afterCommit,
      })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(operation, cause)));
    return admission;
  });
}

function cancelCommand(input: {
  readonly input: CancelCommandInput;
  readonly commandState: RuntimeCommandStatePortService;
  readonly commandControl: RuntimeLayerCommandControlPort;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<CancelCommandResult, RuntimeContractError> {
  const operation = "runtime.commands.cancel";
  return Effect.gen(function* () {
    const command = yield* input.commandState
      .findCommandById({
        commandId: input.input.commandId,
      })
      .pipe(Effect.mapError((cause) => runtimeCommandStateError(operation, cause)));
    if (!command) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "target-not-found",
          message: `Command not found: ${input.input.commandId}`,
        }),
      );
    }
    if (isTerminalCommandStatus(command.status)) {
      return { commandId: input.input.commandId, status: "already_terminal" };
    }

    const admission = yield* input.commandControl.cancel(input.input);
    if (admission.status === "already_terminal") {
      return admission;
    }
    if (admission.status === "cancelling" || admission.status === "cancelled") {
      const recorded = yield* input.commandState
        .finishCommand({
          commandId: command.id,
          status: "cancelled",
          summary: input.input.reason
            ? `Command cancelled: ${input.input.reason}`
            : "Command cancelled.",
          facts: {
            cancelReason: input.input.reason ?? null,
            requestedBy: input.input.clientSubmission ?? null,
          },
          error: input.input.reason ?? "Command cancelled.",
        })
        .pipe(Effect.mapError((cause) => runtimeCommandStateError(operation, cause)));
      yield* input.eventsPort
        .publishStateInvalidations({
          afterCommit: recorded.afterCommit,
        })
        .pipe(Effect.mapError((cause) => runtimeAdapterError(operation, cause)));
    }
    return admission;
  });
}

function abortPrompt(input: {
  readonly input: AbortPromptInput;
  readonly promptHost: RuntimeLayerPromptHostPort;
  readonly queueState: RuntimeQueueStatePortService;
  readonly devTelemetry: RuntimeLayerDevTelemetryPort;
  readonly appLog: RuntimeLayerAppLogPort;
  readonly eventsPort: RuntimeLayerEventsPort;
}): Effect.Effect<void, RuntimeContractError> {
  const target = input.input.target;
  const threadId = promptTargetThreadId(target);
  const recordCancellation = Effect.sync(() => {
    input.devTelemetry.recordDevBrowserToolsEvent("prompt.cancel.requested", {
      surfacePiSessionId: target.surfacePiSessionId,
      threadId: threadId ?? null,
      workspaceSessionId: target.workspaceSessionId,
    });
    input.appLog.info("prompt", "Prompt cancellation requested.", {
      workspaceSessionId: target.workspaceSessionId,
      surfacePiSessionId: target.surfacePiSessionId,
      threadId,
      mode: input.input.mode,
      queuedMessageId: input.input.mode === "queued" ? input.input.queuedMessageId : undefined,
      turnId: input.input.mode === "active-turn" ? input.input.turnId : undefined,
      reason: input.input.reason,
    });
  });

  if (input.input.mode === "queued") {
    return abortRuntimeQueuedMessage({ input: input.input }).pipe(
      Effect.provideService(RuntimeQueueStatePort, input.queueState),
      Effect.provideService(RuntimeEventBus, runtimeEventBusFromPort(input.eventsPort)),
      Effect.provideService(
        RuntimeQueuedMessageAbortPostCommitHost,
        runtimeQueuedMessageAbortPostCommitHostFromPort(input.promptHost),
      ),
      Effect.andThen(recordCancellation),
      Effect.mapError((cause: unknown) => runtimeAdapterError("runtime.messages.abort", cause)),
    );
  }

  return Effect.tryPromise({
    try: async () => {
      if (input.input.mode === "active-turn") {
        await input.promptHost.cancelActivePrompt({
          target,
          turnId: input.input.turnId,
        });
      } else {
        await input.promptHost.cancelPrompt(target);
      }
    },
    catch: (cause: unknown) => runtimeAdapterError("runtime.messages.abort", cause),
  }).pipe(Effect.andThen(recordCancellation));
}

function runtimeMessageSubmissionPostCommitLaneFromPort(input: {
  readonly promptHost: RuntimeLayerPromptHostPort;
  readonly appLog: RuntimeLayerAppLogPort;
  readonly devTelemetry: RuntimeLayerDevTelemetryPort;
  readonly resolvedProvider: string;
  readonly resolvedModel: string;
  readonly resolvedReasoningEffort: ReasoningEffort;
  readonly promptCorrelationDetails: Record<string, unknown>;
  readonly recordPromptLifecycleEvent: (
    event: RuntimePromptLifecycleEvent,
    postCommitInput: RuntimeSubmittedMessagePostCommitInput,
  ) => void;
}): RuntimeMessageSubmissionPostCommitLane["Service"] {
  return RuntimeMessageSubmissionPostCommitLane.of({
    afterSubmitCommitted: (postCommitInput) =>
      Effect.tryPromise({
        try: async () => {
          const session = await input.promptHost.afterRuntimeSurfaceMessageQueued({
            target: postCommitInput.target,
            provider: input.resolvedProvider,
            model: input.resolvedModel,
            thinkingLevel: input.resolvedReasoningEffort,
            messages: [],
            queueOnly: postCommitInput.delivery === "queue-only",
            queuedMessageId: postCommitInput.queuedMessageId,
            clientSubmission: postCommitInput.clientSubmission,
            promptTelemetry: postCommitInput.promptTelemetry,
            onEvent: (event) => input.recordPromptLifecycleEvent(event, postCommitInput),
          });

          input.appLog.info(
            "prompt",
            session.dispatched
              ? "Prompt dispatched to pi runtime."
              : "Prompt queued for active surface.",
            {
              model: input.resolvedModel,
              provider: input.resolvedProvider,
              queued: session.queued ?? false,
              queuedMessageId: session.queuedMessageId,
              ...postCommitInput.promptTelemetry,
              ...input.promptCorrelationDetails,
              surfacePiSessionId: session.target.surfacePiSessionId,
              workspaceSessionId: session.target.workspaceSessionId,
              threadId: promptTargetThreadId(session.target),
            },
          );

          if (!session.queuedMessageId) {
            throw new RuntimeContractError({
              operation: "runtime.messages.submit",
              reason: "stale-state",
              message: "Catalog did not return a queued message id for the submitted prompt.",
            });
          }
        },
        catch: (cause) =>
          cause instanceof RuntimeContractError
            ? cause
            : runtimeAdapterError("runtime.messages.submit", cause),
      }),
  });
}

function runtimeRequestInputPostCommitLaneFromPort(
  postCommit: RuntimeLayerRequestInputPostCommitPort,
): RuntimeRequestInputPostCommitLane["Service"] {
  return RuntimeRequestInputPostCommitLane.of({
    afterAnswerCommitted: (input) =>
      Effect.tryPromise({
        try: async () => {
          await postCommit.afterRequestInputAnswered({
            surfacePiSessionId: input.surfacePiSessionId,
            requestId: input.requestId,
            queuedItemId: input.queuedItemId,
          });
        },
        catch: (cause: unknown) => runtimeAdapterError("runtime.requestInput.answer", cause),
      }),
    afterTimerPausedCommitted: (input) =>
      Effect.tryPromise({
        try: async () => {
          await postCommit.afterRequestInputTimerPaused({ requestId: input.requestId });
        },
        catch: (cause: unknown) =>
          runtimeAdapterError("runtime.requestInput.setTimerPaused", cause),
      }),
  });
}

function runtimeQueuedMessageAbortPostCommitHostFromPort(
  promptHost: RuntimeLayerPromptHostPort,
): RuntimeQueuedMessageAbortPostCommitHost["Service"] {
  return RuntimeQueuedMessageAbortPostCommitHost.of({
    afterQueuedMessageAborted: (abortedInput: RuntimeQueuedMessageAbortedInput) =>
      Effect.tryPromise({
        try: async () => {
          await promptHost.afterRuntimeQueuedMessageAborted({
            target: abortedInput.input.target,
            queuedMessageId: abortedInput.input.queuedMessageId,
          });
        },
        catch: (cause: unknown) => runtimeAdapterError("runtime.messages.abort.postCommit", cause),
      }),
  });
}

function runtimeQueueSteeringPostCommitLaneFromPort(input: {
  readonly promptHost: RuntimeLayerPromptHostPort;
  readonly appLog: RuntimeLayerAppLogPort;
}): RuntimeQueueSteeringPostCommitLane["Service"] {
  return RuntimeQueueSteeringPostCommitLane.of({
    afterQueueSteerCommitted: (steeredInput: RuntimeQueuedMessageSteeredInput) =>
      Effect.tryPromise({
        try: async () => {
          const target = steeredInput.input.target;
          await input.promptHost.afterRuntimeSurfaceMessageSteered({
            target,
            queuedMessageId: steeredInput.input.queuedMessageId,
          });
          input.appLog.info("prompt", "Queued surface message steered.", {
            workspaceSessionId: target.workspaceSessionId,
            surfacePiSessionId: target.surfacePiSessionId,
            threadId: promptTargetThreadId(target),
            queuedMessageId: steeredInput.input.queuedMessageId,
          });
        },
        catch: (cause: unknown) => runtimeAdapterError("runtime.queues.steer.postCommit", cause),
      }),
  });
}

function runtimeApprovalAnswerPostCommitHostFromPort(
  postCommit: RuntimeLayerApprovalPostCommitPort,
): RuntimeApprovalAnswerPostCommitHost["Service"] {
  return RuntimeApprovalAnswerPostCommitHost.of({
    afterApprovalAnswered: (input) =>
      Effect.tryPromise({
        try: async () =>
          postCommit.resolveRuntimeApprovalAnswer({
            requestId: input.request.requestId,
            approved: input.input.decision === "approved",
            reason: input.input.reason ?? null,
          }),
        catch: (cause: unknown) =>
          runtimeAdapterError("runtime.approvals.answer.afterCommit", cause),
      }).pipe(Effect.asVoid),
  });
}

function runtimeEventBusFromPort(port: RuntimeLayerEventsPort): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: (input) =>
      Effect.fail(
        new RuntimeEventStreamError({
          operation: "runtime.events.publish",
          reason: "stream-failed",
          message: `Runtime live event publication is not available for event ${input.event.type}.`,
          latestSequence: 0 as RuntimeEventSequence,
        }),
      ),
    publishStateInvalidations: (input) => port.publishStateInvalidations(input),
    subscribe: (input) => port.events(input),
  });
}

function promptTargetThreadId(target: PromptTarget): string | undefined {
  return target.surface === "handler" ? target.threadId : undefined;
}

function recordPromptLifecycleEvent(input: {
  readonly event: RuntimePromptLifecycleEvent;
  readonly promptHost: RuntimeLayerPromptHostPort;
  readonly appLog: RuntimeLayerAppLogPort;
  readonly devTelemetry: RuntimeLayerDevTelemetryPort;
  readonly promptTelemetry: ReturnType<typeof summarizeRuntimeSubmittedMessageForTelemetry>;
  readonly promptCorrelationDetails: Record<string, unknown>;
  readonly modelId: string;
  readonly provider: string;
  readonly queuedMessageId: string | undefined;
  readonly surfacePiSessionId: string;
  readonly target: PromptTarget;
}): void {
  if (input.event.type === "start") {
    input.devTelemetry.recordDevBrowserToolsEvent("prompt.started", {
      ...input.promptTelemetry,
      ...input.promptCorrelationDetails,
      queuedMessageId: input.queuedMessageId,
      model: input.modelId,
      provider: input.provider,
      surfacePiSessionId: input.surfacePiSessionId,
      workspaceSessionId: input.target.workspaceSessionId,
      threadId: promptTargetThreadId(input.target) ?? null,
    });
    input.appLog.info("prompt", "Prompt started.", {
      ...input.promptTelemetry,
      ...input.promptCorrelationDetails,
      queuedMessageId: input.queuedMessageId,
      model: input.modelId,
      provider: input.provider,
      workspaceSessionId: input.target.workspaceSessionId,
      surfacePiSessionId: input.target.surfacePiSessionId,
      threadId: promptTargetThreadId(input.target),
    });
  } else if (input.event.type === "done") {
    input.devTelemetry.recordDevBrowserToolsEvent("prompt.finished", {
      ...input.promptTelemetry,
      ...input.promptCorrelationDetails,
      queuedMessageId: input.queuedMessageId,
      model: input.modelId,
      provider: input.provider,
      reason: input.event.reason,
      surfacePiSessionId: input.surfacePiSessionId,
      workspaceSessionId: input.target.workspaceSessionId,
      threadId: promptTargetThreadId(input.target) ?? null,
    });
    input.appLog.info("prompt", "Prompt finished.", {
      ...input.promptTelemetry,
      ...input.promptCorrelationDetails,
      queuedMessageId: input.queuedMessageId,
      model: input.modelId,
      provider: input.provider,
      reason: input.event.reason,
      workspaceSessionId: input.target.workspaceSessionId,
      surfacePiSessionId: input.target.surfacePiSessionId,
      threadId: promptTargetThreadId(input.target),
    });
  } else if (input.event.type === "error") {
    const message =
      input.event.error.content.find((block) => block.type === "text")?.text || "Prompt failed.";
    input.devTelemetry.recordDevBrowserToolsEvent("prompt.failed", {
      ...input.promptTelemetry,
      ...input.promptCorrelationDetails,
      queuedMessageId: input.queuedMessageId,
      model: input.modelId,
      provider: input.provider,
      reason: input.event.reason,
      surfacePiSessionId: input.surfacePiSessionId,
      workspaceSessionId: input.target.workspaceSessionId,
      threadId: promptTargetThreadId(input.target) ?? null,
    });
    input.appLog.error("prompt", message, {
      ...input.promptTelemetry,
      ...input.promptCorrelationDetails,
      queuedMessageId: input.queuedMessageId,
      model: input.modelId,
      provider: input.provider,
      reason: input.event.reason,
      surfacePiSessionId: input.target.surfacePiSessionId,
      workspaceSessionId: input.target.workspaceSessionId,
      threadId: promptTargetThreadId(input.target) ?? null,
    });
  }
}

function unsupportedCommandAction(
  input: RunExtensionDependencyActionInput,
  operation: string,
): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: "unsupported-operation",
    message: `Extension dependency action ${input.action} for ${input.extensionId}/${input.requirementId} is not wired to the catalog-backed runtime service yet.`,
  });
}

function delegateSourceInvalidationMethod<Input, Output>(
  operation: string,
  method: (input: Input) => Promise<Output>,
  input: Input,
): Effect.Effect<Output, RuntimeContractError> {
  return Effect.tryPromise({
    try: () => method(input),
    catch: (cause: unknown) => runtimeAdapterError(operation, cause),
  });
}

function isTerminalCommandStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function runtimeCommandStateError(
  operation: string,
  cause: StateContractError,
): RuntimeContractError {
  return runtimeStateError(operation, cause);
}

function runtimeStateError(operation: string, cause: StateContractError): RuntimeContractError {
  const reason =
    cause.reason === "not-found"
      ? "target-not-found"
      : cause.reason === "stale-state"
        ? "stale-state"
        : cause.reason === "invalid-input"
          ? "invalid-input"
          : "state-conflict";
  return new RuntimeContractError({
    operation,
    reason,
    message: cause.message,
    cause,
  });
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

export type RuntimeLayer = Layer.Layer<unknown, never, RuntimeLayerRequirements>;
