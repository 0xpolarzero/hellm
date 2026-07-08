import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  AppLogWritePort,
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  ExtensionError,
  StateContractError,
  RuntimeEpisodeStatePort,
  RuntimeGeneratedPackageStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  SandboxPolicySource,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkspaceStatePort,
  RuntimePromptDefaultsStatePort,
  runtimeClientSubmissionLogDetails,
  type AcquireDefaultWorkspaceInput,
  type AcquireWorkspaceInput,
  type AcquireWorkspaceResult,
  type AbortPromptInput,
  type AppLogSource,
  type AppLogWritePortService,
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
  type OpenSurfaceInput,
  type OpenSurfaceResult,
  type PromptTarget,
  type JsonObject,
  type RecordRuntimeSourceSaveInput,
  type RefreshGeneratedContextRequest,
  type InternalRefreshGeneratedPackagesRequest,
  type ReleaseWorkspaceInput,
  type ReleaseWorkspaceResult,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeEventsInput,
  type RuntimeQueueStatePortService,
  type RuntimeSessionWaitStatePortService,
  type RuntimeSourceFactRecord,
  type RuntimeSourceStatePortService,
  type RuntimeSurfaceTarget,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeWorkspaceStatePortService,
  type OpenExtensionSourceEditInput,
  type SaveExtensionSourceEditInput,
  type SourceEditSaveResult,
  type SourceEditSession,
  type SetRequestInputTimerPausedInput,
  type SetRequestInputTimerPausedResult,
  type SourceInvalidationHint,
  type ApplyCommittedSourceInvalidationEventInput,
  type SourceReconcileRequest,
  type StateInvalidationDescriptor,
  type SteerQueuedMessageInput,
  type SubmitMessageInput,
  type SubmitMessageResult,
  type TurnId,
  type WriteCommandStdinInput,
  type WriteCommandStdinResult,
  type WorkspaceId,
} from "@svvy/core";
import {
  ExtensionSourceRootsPort,
  Extensions,
  type ExtensionSourceRootsPortService,
} from "@svvy/extensions";
import type { HostProcessReferencePort, SandboxHelperCandidatesPort } from "@svvy/sandbox";
import { cancelRuntimeApprovalRequestsForSurface } from "./runtime-approval-cancellation";
import { answerRuntimeApproval } from "./runtime-approval-answer";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import {
  answerRuntimeRequestInput,
  setRuntimeRequestInputTimerPaused,
} from "./request-input-lifecycle";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import {
  RuntimeQueueWakeService,
  type RuntimeQueueWakeServiceService,
} from "./runtime-queue-wake-service";
import {
  RuntimePromptDefaultsService,
  type RuntimePromptDefaultsServiceService,
} from "./runtime-prompt-defaults-service";
import { RuntimeLayerSurfaceQueueWakePort } from "./runtime-surface-queue-wake-port";

export {
  RuntimeLayerSurfaceQueueWakePort,
  type RuntimeLayerSurfaceQueueWakePortService,
} from "./runtime-surface-queue-wake-port";
import {
  RuntimeMessageSubmissionPostCommitLane,
  submitRuntimeMessage,
  summarizeRuntimeSubmittedMessageForTelemetry,
} from "./runtime-message-submission";
import { abortRuntimeQueuedMessage } from "./runtime-message-abort";
import {
  RuntimeQueueSteeringPostCommitLane,
  steerRuntimeQueuedMessage,
  type RuntimeQueuedMessageSteeredInput,
} from "./runtime-queue-steering";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  RuntimeSurfaceEventPublisher,
  type RuntimeSurfaceChangedReason,
} from "./runtime-surface-event-publisher";
import { RuntimeGeneratedContextRefreshHostPort } from "./runtime-generated-context-refresh-service";
import { RuntimeGeneratedPackageRefreshHostPort } from "./runtime-generated-package-refresh-service";
import {
  type RuntimeSourceInvalidationScanPort,
  RuntimeSourceInvalidationService,
} from "./runtime-source-invalidation-service";
import {
  RuntimeWorkspaceScopeService,
  type RuntimeWorkspaceScopeServiceService,
} from "./workspace-runtime-scope-service";
import type { RuntimeLayerConfigService } from "./runtime-layer-config";

export { RuntimeGeneratedContextRefreshHostPort } from "./runtime-generated-context-refresh-service";
export type { RuntimeGeneratedContextRefreshHostPortService } from "./runtime-generated-context-refresh-service";
export { RuntimeGeneratedPackageRefreshHostPort } from "./runtime-generated-package-refresh-service";
export type { RuntimeGeneratedPackageRefreshHostPortService } from "./runtime-generated-package-refresh-service";
export { RuntimeSourceInvalidationScanPort } from "./runtime-source-invalidation-service";
export type { RuntimeSourceInvalidationScanPortService } from "./runtime-source-invalidation-service";

export interface RuntimeLayerPromptControlHostPortService {
  cancelActivePrompt(input: {
    readonly target: PromptTarget;
    readonly turnId: TurnId;
  }): Effect.Effect<void, RuntimeContractError>;
  cancelPrompt(target: PromptTarget): Effect.Effect<void, RuntimeContractError>;
}

export interface RuntimeLayerPromptControlHostPort {
  readonly _tag: "RuntimeLayerPromptControlHostPort";
}

export const RuntimeLayerPromptControlHostPort = Context.Service<
  RuntimeLayerPromptControlHostPort,
  RuntimeLayerPromptControlHostPortService
>("@svvy/runtime/RuntimeLayerPromptControlHostPort");

export interface RuntimeLayerProviderAuthPortService {
  ensureUsableProviderAuth(
    provider: string,
  ): Effect.Effect<string | undefined, RuntimeContractError>;
  getProviderAuthUnavailableMessage(provider: string): string;
}

export interface RuntimeLayerProviderAuthPort {
  readonly _tag: "RuntimeLayerProviderAuthPort";
}

export const RuntimeLayerProviderAuthPort = Context.Service<
  RuntimeLayerProviderAuthPort,
  RuntimeLayerProviderAuthPortService
>("@svvy/runtime/RuntimeLayerProviderAuthPort");

export interface RuntimeLayerModelResolverPortService {
  resolveModelId(input: {
    readonly provider: string;
    readonly model: string;
  }): Effect.Effect<string, RuntimeContractError>;
}

export interface RuntimeLayerModelResolverPort {
  readonly _tag: "RuntimeLayerModelResolverPort";
}

export const RuntimeLayerModelResolverPort = Context.Service<
  RuntimeLayerModelResolverPort,
  RuntimeLayerModelResolverPortService
>("@svvy/runtime/RuntimeLayerModelResolverPort");

export interface RuntimeLayerCommandStdinPortService {
  writeStdin(
    input: WriteCommandStdinInput,
  ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError>;
}

export interface RuntimeLayerCommandStdinPort {
  readonly _tag: "RuntimeLayerCommandStdinPort";
}

export const RuntimeLayerCommandStdinPort = Context.Service<
  RuntimeLayerCommandStdinPort,
  RuntimeLayerCommandStdinPortService
>("@svvy/runtime/RuntimeLayerCommandStdinPort");

export interface RuntimeLayerCommandControlPortService {
  cancel(input: CancelCommandInput): Effect.Effect<CancelCommandResult, RuntimeContractError>;
}

export interface RuntimeLayerCommandControlPort {
  readonly _tag: "RuntimeLayerCommandControlPort";
}

export const RuntimeLayerCommandControlPort = Context.Service<
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandControlPortService
>("@svvy/runtime/RuntimeLayerCommandControlPort");

export type RuntimeLayerRequirements =
  | RuntimeLayerConfigService
  | RuntimeLayerPromptControlHostPort
  | RuntimePromptDefaultsStatePort
  | RuntimeLayerSurfaceQueueWakePort
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
  | RuntimeEpisodeStatePort;

export function makeRuntimeService() {
  return Effect.gen(function* () {
    const promptControlHost = yield* RuntimeLayerPromptControlHostPort;
    const promptDefaults = yield* RuntimePromptDefaultsService;
    const queueWake = yield* RuntimeQueueWakeService;
    const requestInputWaitService = yield* RuntimeRequestInputWaitService;
    const approvalWaitService = yield* RuntimeApprovalWaitService;
    const providerAuth = yield* RuntimeLayerProviderAuthPort;
    const modelResolver = yield* RuntimeLayerModelResolverPort;
    const appLog = yield* AppLogWritePort;
    const sourceInvalidation = yield* RuntimeSourceInvalidationService;
    const eventBus = yield* RuntimeEventBus;
    const surfaceEvents = yield* RuntimeSurfaceEventPublisher;
    const commandStdin = yield* RuntimeLayerCommandStdinPort;
    const commandControl = yield* RuntimeLayerCommandControlPort;
    const workspaceState = yield* RuntimeWorkspaceStatePort;
    const workspaceScopes = yield* RuntimeWorkspaceScopeService;
    const surfaceLifecycleState = yield* RuntimeSurfaceLifecycleStatePort;
    const sourceState = yield* RuntimeSourceStatePort;
    const extensions = yield* Extensions;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const extensionSourceRoots = yield* ExtensionSourceRootsPort;
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
            workspaceScopes,
            eventBus,
          }),
        acquireDefault: (input: AcquireDefaultWorkspaceInput) =>
          acquireDefaultWorkspace({
            input,
            workspaceState,
            workspaceScopes,
            eventBus,
          }),
        release: (input: ReleaseWorkspaceInput) =>
          releaseWorkspace({
            input,
            workspaceState,
            workspaceScopes,
            eventBus,
          }),
      },
      surfaces: {
        createOrchestrator: (input: CreateOrchestratorSurfaceInput) =>
          createOrchestratorSurface({
            input,
            surfaceLifecycleState,
            eventBus,
            surfaceEvents,
          }),
        open: (input: OpenSurfaceInput) =>
          openSurface({
            input,
            surfaceLifecycleState,
            eventBus,
            surfaceEvents,
          }),
        close: (input: CloseSurfaceInput) =>
          closeSurface({
            input,
            surfaceLifecycleState,
            eventBus,
            surfaceEvents,
            requestInputWaitService,
            approvalState,
            commandState,
            sessionWaitState,
            approvalWaitService,
          }),
      },
      messages: {
        submit: (input: SubmitMessageInput) =>
          submitMessage({
            input,
            promptDefaults,
            queueWake,
            queueState,
            providerAuth,
            modelResolver,
            appLog,
            eventBus,
          }),
        abort: (input: AbortPromptInput) =>
          abortPrompt({
            input,
            promptControlHost,
            queueState,
            appLog,
            eventBus,
            requestInputWaitService,
            approvalState,
            commandState,
            sessionWaitState,
            approvalWaitService,
          }),
      },
      queues: {
        steer: (input: SteerQueuedMessageInput) =>
          steerRuntimeQueuedMessage({ input }).pipe(
            Effect.provideService(RuntimeQueueStatePort, queueState),
            Effect.provideService(RuntimeEventBus, eventBus),
            Effect.provideService(
              RuntimeQueueSteeringPostCommitLane,
              runtimeQueueSteeringPostCommitLaneFromPort({ queueWake, appLog, eventBus }),
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
            Effect.provideService(RuntimeEventBus, eventBus),
            Effect.provideService(RuntimeRequestInputWaitService, requestInputWaitService),
          ),
        setTimerPaused: (
          input: SetRequestInputTimerPausedInput,
        ): Effect.Effect<SetRequestInputTimerPausedResult, RuntimeContractError> =>
          setRuntimeRequestInputTimerPaused(input).pipe(
            Effect.provideService(RuntimeRequestStatePort, requestState),
            Effect.provideService(RuntimeEventBus, eventBus),
            Effect.provideService(RuntimeRequestInputWaitService, requestInputWaitService),
          ),
      },
      commands: {
        writeStdin: (
          input: WriteCommandStdinInput,
        ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError> =>
          writeCommandStdin({
            input,
            commandState,
            commandStdin,
            eventBus,
          }),
        cancel: (
          input: CancelCommandInput,
        ): Effect.Effect<CancelCommandResult, RuntimeContractError> =>
          cancelCommand({
            input,
            commandState,
            commandControl,
            eventBus,
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
            Effect.provideService(RuntimeEventBus, eventBus),
            Effect.provideService(RuntimeApprovalWaitService, approvalWaitService),
          ),
      },
      sourceEdits: {
        open: (input: OpenExtensionSourceEditInput) =>
          openRuntimeSourceEdit({
            input,
            extensions,
            sourceState,
            fileSystem,
            path,
            crypto,
            extensionSourceRoots,
          }),
        save: (input: SaveExtensionSourceEditInput) =>
          saveRuntimeSourceEdit({
            input,
            extensions,
            sourceState,
            eventBus,
            fileSystem,
            path,
            crypto,
            extensionSourceRoots,
          }),
      },
      sourceInvalidation: {
        hint: (input: SourceInvalidationHint) => sourceInvalidation.hint(input),
        reconcile: (input: SourceReconcileRequest) => sourceInvalidation.reconcile(input),
        applyCommittedScanEvent: (input: ApplyCommittedSourceInvalidationEventInput) =>
          sourceInvalidation.applyCommittedScanEvent(input),
        refreshGeneratedContext: (input: RefreshGeneratedContextRequest) =>
          sourceInvalidation.refreshGeneratedContext(input),
        refreshGeneratedPackages: (input: InternalRefreshGeneratedPackagesRequest) =>
          sourceInvalidation.refreshGeneratedPackages(input),
      },
      events: (input?: RuntimeEventsInput) => eventBus.subscribe(input),
    };
  });
}

function acquireWorkspace(input: {
  readonly input: AcquireWorkspaceInput;
  readonly workspaceState: RuntimeWorkspaceStatePortService;
  readonly workspaceScopes: RuntimeWorkspaceScopeServiceService;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<AcquireWorkspaceResult, RuntimeContractError> {
  const operation = "runtime.workspaces.acquire";
  return Effect.gen(function* () {
    const result = yield* commitStateMutation({
      operation,
      effect: input.workspaceState.acquireWorkspace(input.input),
      eventBus: input.eventBus,
    });
    yield* input.workspaceScopes.acquire({
      workspaceId: result.workspaceId,
      owner: input.input.owner,
    });
    return result;
  });
}

function acquireDefaultWorkspace(input: {
  readonly input: AcquireDefaultWorkspaceInput;
  readonly workspaceState: RuntimeWorkspaceStatePortService;
  readonly workspaceScopes: RuntimeWorkspaceScopeServiceService;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<AcquireWorkspaceResult, RuntimeContractError> {
  const operation = "runtime.workspaces.acquireDefault";
  return Effect.gen(function* () {
    const result = yield* commitStateMutation({
      operation,
      effect: input.workspaceState.acquireDefaultWorkspace(input.input),
      eventBus: input.eventBus,
    });
    yield* input.workspaceScopes.acquire({
      workspaceId: result.workspaceId,
      owner: input.input.owner,
    });
    return result;
  });
}

function releaseWorkspace(input: {
  readonly input: ReleaseWorkspaceInput;
  readonly workspaceState: RuntimeWorkspaceStatePortService;
  readonly workspaceScopes: RuntimeWorkspaceScopeServiceService;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<ReleaseWorkspaceResult, RuntimeContractError> {
  const operation = "runtime.workspaces.release";
  return Effect.gen(function* () {
    const result = yield* commitStateMutation({
      operation,
      effect: input.workspaceState.releaseWorkspace(input.input),
      eventBus: input.eventBus,
    });
    yield* input.workspaceScopes.release({
      workspaceId: result.workspaceId,
      owner: input.input.owner,
      remainingOwners: result.remainingOwners,
      lifecycle: result.lifecycle,
    });
    return result;
  });
}

function createOrchestratorSurface(input: {
  readonly input: CreateOrchestratorSurfaceInput;
  readonly surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<CreateSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.createOrchestrator";
  return Effect.gen(function* () {
    const result = yield* commitStateMutation({
      operation,
      effect: input.surfaceLifecycleState.createOrchestratorSurface(input.input),
      eventBus: input.eventBus,
    });
    yield* publishSurfaceChanged({
      operation,
      workspaceId: input.input.workspaceId,
      target: result.target,
      reason: "surface.updated",
      surfaceEvents: input.surfaceEvents,
    });
    return result;
  });
}

function openSurface(input: {
  readonly input: OpenSurfaceInput;
  readonly surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<OpenSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.open";
  return Effect.gen(function* () {
    const result = yield* commitStateMutation({
      operation,
      effect: input.surfaceLifecycleState.openSurface(input.input),
      eventBus: input.eventBus,
    });
    yield* publishSurfaceChanged({
      operation,
      workspaceId: input.input.workspaceId,
      target: result.target,
      reason: "surface.updated",
      surfaceEvents: input.surfaceEvents,
    });
    return result;
  });
}

function closeSurface(input: {
  readonly input: CloseSurfaceInput;
  readonly surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly requestInputWaitService: RuntimeRequestInputWaitService["Service"];
  readonly approvalState: RuntimeApprovalStatePortService;
  readonly commandState: RuntimeCommandStatePortService;
  readonly sessionWaitState: RuntimeSessionWaitStatePortService;
  readonly approvalWaitService: RuntimeApprovalWaitService["Service"];
}): Effect.Effect<CloseSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.close";
  return Effect.gen(function* () {
    const result = yield* commitStateMutation({
      operation,
      effect: input.surfaceLifecycleState.closeSurface(input.input),
      eventBus: input.eventBus,
    });
    yield* input.requestInputWaitService.cancelBlockingRequestsForSurface({
      surfacePiSessionId: result.target.surfacePiSessionId,
      reason: "Surface closed.",
    });
    yield* cancelApprovalRequestsForSurface({
      surfacePiSessionId: result.target.surfacePiSessionId,
      reason: "Surface closed.",
      approvalState: input.approvalState,
      commandState: input.commandState,
      sessionWaitState: input.sessionWaitState,
      eventBus: input.eventBus,
      approvalWaitService: input.approvalWaitService,
    });
    yield* publishSurfaceChanged({
      operation,
      workspaceId: input.input.workspaceId,
      target: result.target,
      reason: "surface.closed",
      surfaceEvents: input.surfaceEvents,
    });
    return result;
  });
}

function commitStateMutation<Value>(input: {
  readonly operation: string;
  readonly effect: Effect.Effect<
    { readonly value: Value; readonly afterCommit: readonly StateInvalidationDescriptor[] },
    StateContractError
  >;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<Value, RuntimeContractError> {
  return Effect.gen(function* () {
    const result = yield* input.effect.pipe(
      Effect.mapError((cause) => runtimeStateError(input.operation, cause)),
    );
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: result.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(input.operation, cause)));
    return result.value;
  });
}

function publishSurfaceChanged(input: {
  readonly operation: string;
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly reason: RuntimeSurfaceChangedReason;
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<void, RuntimeContractError> {
  return input.surfaceEvents
    .publishSurfaceChanged({
      workspaceId: input.workspaceId,
      target: input.target,
      reason: input.reason,
    })
    .pipe(
      Effect.asVoid,
      Effect.mapError((cause) => runtimeAdapterError(input.operation, cause)),
    );
}

function submitMessage(input: {
  readonly input: SubmitMessageInput;
  readonly promptDefaults: RuntimePromptDefaultsServiceService;
  readonly queueWake: RuntimeQueueWakeServiceService;
  readonly queueState: RuntimeQueueStatePortService;
  readonly providerAuth: RuntimeLayerProviderAuthPortService;
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly appLog: AppLogWritePortService;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<SubmitMessageResult, RuntimeContractError> {
  return Effect.gen(function* () {
    const target = input.input.target;
    const resolved = yield* input.promptDefaults.resolve({ target });
    const clientSubmission = input.input.clientSubmission;
    const delivery = input.input.delivery ?? "enqueue-and-run";
    const promptTelemetry = summarizeRuntimeSubmittedMessageForTelemetry(input.input.message);
    const promptCorrelationDetails = runtimeClientSubmissionLogDetails(clientSubmission);

    const apiKey = yield* input.providerAuth.ensureUsableProviderAuth(resolved.provider);
    if (!apiKey) {
      const message = input.providerAuth.getProviderAuthUnavailableMessage(resolved.provider);
      yield* appendRuntimeAppLog({
        appLog: input.appLog,
        eventBus: input.eventBus,
        level: "warn",
        source: "auth.provider",
        message: "Configured provider is not connected for prompt.",
        target,
        details: {
          provider: resolved.provider,
          ...promptCorrelationDetails,
        },
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
    yield* appendRuntimeAppLog({
      appLog: input.appLog,
      eventBus: input.eventBus,
      level: "info",
      source: "prompt",
      message: "Prompt requested.",
      target,
      details: {
        ...promptTelemetry,
        ...promptCorrelationDetails,
        model: modelId,
        provider: resolved.provider,
        delivery,
      },
    });

    const submitResult = yield* submitRuntimeMessage({ input: input.input }).pipe(
      Effect.provideService(RuntimeQueueStatePort, input.queueState),
      Effect.provideService(RuntimeEventBus, input.eventBus),
      Effect.provideService(
        RuntimeMessageSubmissionPostCommitLane,
        runtimeMessageSubmissionPostCommitLaneFromPort({
          queueWake: input.queueWake,
          appLog: input.appLog,
          eventBus: input.eventBus,
          resolvedProvider: resolved.provider,
          resolvedModel: modelId,
          promptCorrelationDetails,
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
  readonly commandStdin: RuntimeLayerCommandStdinPortService;
  readonly eventBus: RuntimeEventBus["Service"];
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
    yield* input.eventBus
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
  readonly commandControl: RuntimeLayerCommandControlPortService;
  readonly eventBus: RuntimeEventBus["Service"];
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
      yield* input.eventBus
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
  readonly promptControlHost: RuntimeLayerPromptControlHostPortService;
  readonly queueState: RuntimeQueueStatePortService;
  readonly appLog: AppLogWritePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly requestInputWaitService: RuntimeRequestInputWaitService["Service"];
  readonly approvalState: RuntimeApprovalStatePortService;
  readonly commandState: RuntimeCommandStatePortService;
  readonly sessionWaitState: RuntimeSessionWaitStatePortService;
  readonly approvalWaitService: RuntimeApprovalWaitService["Service"];
}): Effect.Effect<void, RuntimeContractError> {
  const target = input.input.target;
  const recordCancellation = appendRuntimeAppLog({
    appLog: input.appLog,
    eventBus: input.eventBus,
    level: "info",
    source: "prompt",
    message: "Prompt cancellation requested.",
    target,
    details: {
      mode: input.input.mode,
      queuedMessageId: input.input.mode === "queued" ? input.input.queuedMessageId : undefined,
      turnId: input.input.mode === "active-turn" ? input.input.turnId : undefined,
      reason: input.input.reason,
    },
  });

  if (input.input.mode === "queued") {
    return abortRuntimeQueuedMessage({ input: input.input }).pipe(
      Effect.provideService(RuntimeQueueStatePort, input.queueState),
      Effect.provideService(RuntimeEventBus, input.eventBus),
      Effect.andThen(recordCancellation),
      Effect.mapError((cause: unknown) => runtimeAdapterError("runtime.messages.abort", cause)),
    );
  }

  if (input.input.mode === "active-turn") {
    const turnId = input.input.turnId;
    if (!turnId) {
      return Effect.fail(
        new RuntimeContractError({
          operation: "runtime.messages.abort",
          reason: "invalid-input",
          message: "Active-turn prompt abort requires turnId.",
        }),
      );
    }
    return input.requestInputWaitService
      .cancelBlockingRequestsForSurface({
        surfacePiSessionId: target.surfacePiSessionId,
        reason: input.input.reason ?? "Prompt cancelled.",
      })
      .pipe(
        Effect.andThen(
          cancelApprovalRequestsForSurface({
            surfacePiSessionId: target.surfacePiSessionId,
            reason: input.input.reason ?? "Prompt cancelled.",
            approvalState: input.approvalState,
            commandState: input.commandState,
            sessionWaitState: input.sessionWaitState,
            eventBus: input.eventBus,
            approvalWaitService: input.approvalWaitService,
          }),
        ),
        Effect.andThen(
          input.promptControlHost.cancelActivePrompt({
            target,
            turnId,
          }),
        ),
        Effect.mapError((cause: unknown) => runtimeAdapterError("runtime.messages.abort", cause)),
        Effect.andThen(recordCancellation),
      );
  }

  return input.requestInputWaitService
    .cancelBlockingRequestsForSurface({
      surfacePiSessionId: target.surfacePiSessionId,
      reason: input.input.reason ?? "Prompt cancelled.",
    })
    .pipe(
      Effect.andThen(
        cancelApprovalRequestsForSurface({
          surfacePiSessionId: target.surfacePiSessionId,
          reason: input.input.reason ?? "Prompt cancelled.",
          approvalState: input.approvalState,
          commandState: input.commandState,
          sessionWaitState: input.sessionWaitState,
          eventBus: input.eventBus,
          approvalWaitService: input.approvalWaitService,
        }),
      ),
      Effect.andThen(input.promptControlHost.cancelPrompt(target)),
      Effect.mapError((cause: unknown) => runtimeAdapterError("runtime.messages.abort", cause)),
      Effect.andThen(recordCancellation),
    );
}

function runtimeMessageSubmissionPostCommitLaneFromPort(input: {
  readonly queueWake: RuntimeQueueWakeServiceService;
  readonly appLog: AppLogWritePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly resolvedProvider: string;
  readonly resolvedModel: string;
  readonly promptCorrelationDetails: Record<string, unknown>;
}): RuntimeMessageSubmissionPostCommitLane["Service"] {
  return RuntimeMessageSubmissionPostCommitLane.of({
    afterSubmitCommitted: (postCommitInput) =>
      Effect.gen(function* () {
        yield* appendRuntimeAppLog({
          appLog: input.appLog,
          eventBus: input.eventBus,
          level: "info",
          source: "prompt",
          message:
            postCommitInput.delivery === "queue-only"
              ? "Prompt queued for surface delivery."
              : "Prompt queued and surface queue wake requested.",
          target: postCommitInput.target,
          details: {
            model: input.resolvedModel,
            provider: input.resolvedProvider,
            delivery: postCommitInput.delivery,
            queuedMessageId: postCommitInput.queuedMessageId,
            ...postCommitInput.promptTelemetry,
            ...input.promptCorrelationDetails,
          },
        });

        if (postCommitInput.delivery !== "queue-only") {
          yield* input.queueWake
            .wakeSurface({
              target: postCommitInput.target,
              reason: "message-submitted",
            })
            .pipe(
              Effect.mapError((cause) => runtimeAdapterError("runtime.messages.submit", cause)),
            );
        }
      }),
  });
}

function cancelApprovalRequestsForSurface(input: {
  readonly surfacePiSessionId: RuntimeSurfaceTarget["surfacePiSessionId"];
  readonly reason: string;
  readonly approvalState: RuntimeApprovalStatePortService;
  readonly commandState: RuntimeCommandStatePortService;
  readonly sessionWaitState: RuntimeSessionWaitStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly approvalWaitService: RuntimeApprovalWaitService["Service"];
}): Effect.Effect<void, RuntimeContractError> {
  return cancelRuntimeApprovalRequestsForSurface({
    surfacePiSessionId: input.surfacePiSessionId,
    reason: input.reason,
  }).pipe(
    Effect.provideService(RuntimeApprovalStatePort, input.approvalState),
    Effect.provideService(RuntimeCommandStatePort, input.commandState),
    Effect.provideService(RuntimeSessionWaitStatePort, input.sessionWaitState),
    Effect.provideService(RuntimeEventBus, input.eventBus),
    Effect.provideService(RuntimeApprovalWaitService, input.approvalWaitService),
  );
}

function runtimeQueueSteeringPostCommitLaneFromPort(input: {
  readonly queueWake: RuntimeQueueWakeServiceService;
  readonly appLog: AppLogWritePortService;
  readonly eventBus: RuntimeEventBus["Service"];
}): RuntimeQueueSteeringPostCommitLane["Service"] {
  return RuntimeQueueSteeringPostCommitLane.of({
    afterQueueSteerCommitted: (steeredInput: RuntimeQueuedMessageSteeredInput) =>
      Effect.gen(function* () {
        const target = steeredInput.input.target;
        yield* input.queueWake
          .wakeSurface({
            target,
            reason: "queue-steered",
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeAdapterError("runtime.queues.steer.postCommit", cause),
            ),
          );
        yield* appendRuntimeAppLog({
          appLog: input.appLog,
          eventBus: input.eventBus,
          level: "info",
          source: "prompt",
          message: "Queued surface message steered.",
          target,
          details: {
            queuedMessageId: steeredInput.input.queuedMessageId,
          },
        });
      }),
  });
}

function appendRuntimeAppLog(input: {
  readonly appLog: AppLogWritePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly level: "debug" | "info" | "warn" | "error";
  readonly source: AppLogSource;
  readonly message: string;
  readonly target?: PromptTarget;
  readonly details?: Record<string, unknown>;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    const occurredAt = DateTime.formatIso(yield* DateTime.now) as unknown as Parameters<
      AppLogWritePortService["append"]
    >[0]["occurredAt"];
    const target = input.target;
    const result = yield* input.appLog.append({
      level: input.level,
      source: input.source,
      message: input.message,
      occurredAt,
      ...(input.details ? { details: pruneUndefinedJsonObject(input.details) } : {}),
      ...(target
        ? {
            related: [
              { kind: "workspace-session" as const, id: target.workspaceSessionId },
              { kind: "surface" as const, id: target.surfacePiSessionId },
              ...(target.surface === "handler"
                ? [{ kind: "thread" as const, id: target.threadId }]
                : []),
            ],
          }
        : {}),
    });
    yield* input.eventBus.publishStateInvalidations({ afterCommit: result.afterCommit });
  }).pipe(Effect.ignore);
}

function pruneUndefinedJsonObject(details: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  ) as JsonObject;
}

function openRuntimeSourceEdit(input: {
  readonly input: OpenExtensionSourceEditInput;
  readonly extensions: Extensions["Service"];
  readonly sourceState: RuntimeSourceStatePortService;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly crypto: Crypto.Crypto;
  readonly extensionSourceRoots: ExtensionSourceRootsPortService;
}): Effect.Effect<SourceEditSession, RuntimeContractError> {
  const operation = "runtime.sourceEdits.open";
  return Effect.gen(function* () {
    const session = yield* provideExtensionSourceEditServices(
      input.extensions.sources.openEditSession(input.input),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    const sourceFact = yield* input.sourceState
      .readSourceVersion({
        scope: { kind: "app-global" },
        sourceKind: input.input.sourceKind,
        sourceId: input.input.sourceId,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    return sessionWithRuntimeSourceFact(session, sourceFact);
  });
}

function saveRuntimeSourceEdit(input: {
  readonly input: SaveExtensionSourceEditInput;
  readonly extensions: Extensions["Service"];
  readonly sourceState: RuntimeSourceStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly crypto: Crypto.Crypto;
  readonly extensionSourceRoots: ExtensionSourceRootsPortService;
}): Effect.Effect<SourceEditSaveResult, RuntimeContractError> {
  const operation = "runtime.sourceEdits.save";
  return Effect.gen(function* () {
    const current = yield* provideExtensionSourceEditServices(
      input.extensions.sources.openEditSession(input.input),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    const sourceFact = yield* input.sourceState
      .readSourceVersion({
        scope: { kind: "app-global" },
        sourceKind: input.input.sourceKind,
        sourceId: input.input.sourceId,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    if (
      input.input.saveMode === "compare-and-swap" &&
      sourceFact &&
      sourceFact.sourceVersion !== input.input.expectedSourceVersion
    ) {
      return {
        status: "stale" as const,
        current: sessionWithRuntimeSourceFact(current, sourceFact),
      };
    }
    const saveResult = yield* provideExtensionSourceEditServices(
      input.extensions.sources.saveEditSession(input.input),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    if (saveResult.status === "stale") {
      return saveResult;
    }
    const savedAt = DateTime.formatIso(
      yield* DateTime.now,
    ) as unknown as RecordRuntimeSourceSaveInput["savedAt"];
    const mutation = yield* input.sourceState
      .recordSourceSave({
        scope: { kind: "app-global" },
        sourceKind: input.input.sourceKind,
        sourceId: input.input.sourceId,
        path: current.path,
        previousSourceVersion: sourceFact?.sourceVersion ?? null,
        sourceVersion: saveResult.sourceVersion,
        fingerprint: saveResult.fingerprint,
        diagnostics: saveResult.diagnostics,
        sourceCommandId: input.input.sourceCommandId ?? null,
        savedAt,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: mutation.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(operation, cause)));
    return saveResult;
  });
}

function provideExtensionSourceEditServices<A>(
  effect: Effect.Effect<
    A,
    ExtensionError,
    FileSystem.FileSystem | Path.Path | Crypto.Crypto | ExtensionSourceRootsPort
  >,
  services: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly crypto: Crypto.Crypto;
    readonly extensionSourceRoots: ExtensionSourceRootsPortService;
  },
): Effect.Effect<A, ExtensionError> {
  return effect.pipe(
    Effect.provideService(FileSystem.FileSystem, services.fileSystem),
    Effect.provideService(Path.Path, services.path),
    Effect.provideService(Crypto.Crypto, services.crypto),
    Effect.provideService(ExtensionSourceRootsPort, services.extensionSourceRoots),
  );
}

function sessionWithRuntimeSourceFact(
  session: SourceEditSession,
  sourceFact: RuntimeSourceFactRecord | null,
): SourceEditSession {
  if (!sourceFact || sourceFact.deletedAt) {
    return session;
  }
  return {
    ...session,
    sourceVersion: sourceFact.sourceVersion,
    fingerprint: sourceFact.fingerprint,
    diagnostics: sourceFact.diagnostics,
  };
}

function runtimeExtensionSourceEditError(
  operation: string,
  cause: ExtensionError,
): RuntimeContractError {
  const reason =
    cause.reason === "invalid-input"
      ? "invalid-input"
      : cause.reason === "not-found"
        ? "target-not-found"
        : cause.reason === "read-only-source"
          ? "read-only-source"
          : cause.reason === "dependency-not-ready"
            ? "dependency-not-ready"
            : cause.reason === "not-loaded"
              ? "target-not-ready"
              : "state-conflict";
  return new RuntimeContractError({
    operation,
    reason,
    message: cause.message,
    cause,
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
    reason: "state-conflict",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export type RuntimeLayer = Layer.Layer<unknown, never, RuntimeLayerRequirements>;
