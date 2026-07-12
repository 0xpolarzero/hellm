import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  AppLogWritePort,
  boundarySchemaErrorDetails,
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeComposerDraftStatePort,
  RuntimeContractError,
  RuntimeEventStreamError,
  ExtensionError,
  StateContractError,
  RuntimeEpisodeStatePort,
  RuntimeGeneratedPackageStatePort,
  RuntimeQueueStatePort,
  RuntimeRecoveryStatePort,
  RuntimeRequestStatePort,
  SandboxPolicySource,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTranscriptStatePort,
  type RuntimeTranscriptStatePortService,
  RuntimeTurnStatePort,
  RuntimeWorkflowTaskStatePort,
  RuntimeWorkspaceStatePort,
  RuntimePromptDefaultsStatePort,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  ProviderAuthPort,
  ProviderAuthStatusStatePort,
  encodeSourceReconcileRecoveryPayloadEffect,
  decodeUnknownTaskAgentParametersSourceEffect,
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
  type ExtensionId,
  type JsonObject,
  type RecordRuntimeSourceSaveInput,
  type RecordRuntimeSourceDeleteInput,
  type RefreshGeneratedContextRequest,
  type InternalRefreshGeneratedPackagesRequest,
  type ReleaseWorkspaceInput,
  type ReleaseWorkspaceResult,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeEventsInput,
  type RuntimeQueueStatePortService,
  type RuntimeCreateWorkflowAgentSourceInput,
  type RuntimeDeleteWorkflowAgentSourceInput,
  type RuntimeDuplicateWorkflowAgentSourceInput,
  type RuntimeSaveExtensionSourceEditInput,
  type RuntimeRecoveryStatePortService,
  type RuntimePromptBindingRecord,
  type RuntimeSourceFactRecord,
  type RuntimeSourceStatePortService,
  type RuntimeSurfaceTarget,
  type SurfaceStreamGenerationId,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeWorkspaceStatePortService,
  type OpenExtensionSourceEditInput,
  type SourceEditSaveResult,
  type SourceEditSession,
  type SetRequestInputBlockingTimeoutInput,
  type SetRequestInputBlockingTimeoutResult,
  type SetRequestInputTimerPausedInput,
  type SetRequestInputTimerPausedResult,
  type SetRequestInputVariantInput,
  type SetRequestInputVariantResult,
  type SourceInvalidationHint,
  type ApplyCommittedSourceInvalidationEventInput,
  type SourceReconcileRequest,
  type StateInvalidationDescriptor,
  type StateMutationResult,
  type SourceReconcileRecoveryPayload,
  type TaskAgentParametersSource,
  type SteerQueuedMessageInput,
  type UpdateComposerDraftInput,
  type RestoreQueuedMessageToComposerInput,
  type ReorderQueuedMessageInput,
  type SubmitMessageInput,
  type SubmitMessageResult,
  type WriteCommandStdinInput,
  type WriteCommandStdinResult,
  type WorkspaceId,
  type WorkflowAgentSourceDeleteResult,
  type WorkflowAgentSourceLifecycleResult,
  type WorkflowAgentSourceObservation,
} from "@svvy/core";
import { PiAdapter } from "@svvy/pi-adapter";
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
  setRuntimeRequestInputBlockingTimeout,
  setRuntimeRequestInputTimerPaused,
  setRuntimeRequestInputVariant,
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
  reorderRuntimeQueuedMessage,
  restoreRuntimeQueuedMessageToComposer,
  updateRuntimeComposerDraft,
} from "./runtime-composer-queue-mutations";
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
import {
  RuntimeSurfaceScopeService,
  type RuntimeSurfaceScopeServiceService,
} from "./surface-runtime-scope-service";
import { RuntimeWorkflowTaskAgentBridgeService } from "./workflow-task-agent-bridge-service";
import { RuntimeLayerConfigService } from "./runtime-layer-config";
import {
  RuntimeSourceReconcileRecoveryWorker,
  type RuntimeSourceReconcileRecoveryWorkerService,
} from "./runtime-source-reconcile-recovery-worker";
import {
  RuntimeLayerModelResolverPort,
  type RuntimeLayerModelResolverPortService,
  RuntimeLayerProviderAuthPort,
  type RuntimeLayerProviderAuthPortService,
} from "./runtime-layer-provider-ports";
import { admitRuntimeWorkflowAgentModel } from "./runtime-workflow-agent-source-index";
import { RuntimeShutdownAdmission } from "./runtime-shutdown-admission";

export { RuntimeGeneratedContextRefreshHostPort } from "./runtime-generated-context-refresh-service";
export type { RuntimeGeneratedContextRefreshHostPortService } from "./runtime-generated-context-refresh-service";
export { RuntimeGeneratedPackageRefreshHostPort } from "./runtime-generated-package-refresh-service";
export type { RuntimeGeneratedPackageRefreshHostPortService } from "./runtime-generated-package-refresh-service";
export { RuntimeSourceInvalidationScanPort } from "./runtime-source-invalidation-service";
export type { RuntimeSourceInvalidationScanPortService } from "./runtime-source-invalidation-service";
export {
  RuntimeLayerModelResolverPort,
  RuntimeLayerProviderAuthPort,
} from "./runtime-layer-provider-ports";
export type {
  RuntimeLayerModelResolverPortService,
  RuntimeLayerProviderAuthPortService,
} from "./runtime-layer-provider-ports";
export {
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
} from "./runtime-command-host-ports";
export type {
  RuntimeLayerCommandControlPortService,
  RuntimeLayerCommandStdinPortService,
} from "./runtime-command-host-ports";
import {
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  type RuntimeLayerCommandControlPortService,
  type RuntimeLayerCommandStdinPortService,
} from "./runtime-command-host-ports";

export type RuntimeLayerRequirements =
  | RuntimeLayerConfigService
  | RuntimePromptDefaultsStatePort
  | PiAdapter
  | ProviderAuthPort
  | ProviderAuthStatusStatePort
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
  | RuntimeRecoveryStatePort
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
  | RuntimeComposerDraftStatePort
  | RuntimeSessionWaitStatePort
  | RuntimeThreadStatePort
  | RuntimeTranscriptStatePort
  | RuntimeTurnStatePort
  | RuntimeWorkflowTaskStatePort
  | RuntimeEpisodeStatePort;

export function makeRuntimeService() {
  return Effect.gen(function* () {
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
    const surfaceScopes = yield* RuntimeSurfaceScopeService;
    const surfaceLifecycleState = yield* RuntimeSurfaceLifecycleStatePort;
    const transcriptState = yield* RuntimeTranscriptStatePort;
    const actorBindingState = yield* RuntimeActorExtensionBindingStatePort;
    const sourceState = yield* RuntimeSourceStatePort;
    const recoveryState = yield* RuntimeRecoveryStatePort;
    const sourceRecoveryWorker = yield* RuntimeSourceReconcileRecoveryWorker;
    const runtimeConfig = yield* RuntimeLayerConfigService;
    const extensions = yield* Extensions;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const extensionSourceRoots = yield* ExtensionSourceRootsPort;
    const queueState = yield* RuntimeQueueStatePort;
    const composerDraftState = yield* RuntimeComposerDraftStatePort;
    const requestState = yield* RuntimeRequestStatePort;
    const approvalState = yield* RuntimeApprovalStatePort;
    const commandState = yield* RuntimeCommandStatePort;
    const sessionWaitState = yield* RuntimeSessionWaitStatePort;
    const workflowTaskAgentBridge = yield* RuntimeWorkflowTaskAgentBridgeService;
    const shutdownAdmission = yield* RuntimeShutdownAdmission;

    const admit = <A, R>(
      operation: string,
      effect: Effect.Effect<A, RuntimeContractError, R>,
    ): Effect.Effect<A, RuntimeContractError, R> =>
      shutdownAdmission.withAdmission(operation, effect);

    return {
      workspaces: {
        acquire: (input: AcquireWorkspaceInput) =>
          admit(
            "runtime.workspaces.acquire",
            acquireWorkspace({
              input,
              workspaceState,
              workspaceScopes,
              eventBus,
              requestInputWaitService,
            }),
          ),
        acquireDefault: (input: AcquireDefaultWorkspaceInput) =>
          admit(
            "runtime.workspaces.acquireDefault",
            acquireDefaultWorkspace({
              input,
              workspaceState,
              workspaceScopes,
              eventBus,
              requestInputWaitService,
            }),
          ),
        release: (input: ReleaseWorkspaceInput) =>
          admit(
            "runtime.workspaces.release",
            releaseWorkspace({
              input,
              workspaceState,
              workspaceScopes,
              eventBus,
            }),
          ),
      },
      surfaces: {
        createOrchestrator: (input: CreateOrchestratorSurfaceInput) =>
          admit(
            "runtime.surfaces.createOrchestrator",
            createOrchestratorSurface({
              input,
              surfaceLifecycleState,
              surfaceScopes,
              promptDefaults,
              actorBindingState,
              eventBus,
              surfaceEvents,
            }),
          ),
        open: (input: OpenSurfaceInput) =>
          admit(
            "runtime.surfaces.open",
            openSurface({
              input,
              surfaceLifecycleState,
              surfaceScopes,
              transcriptState,
              eventBus,
              surfaceEvents,
            }),
          ),
        close: (input: CloseSurfaceInput) =>
          admit(
            "runtime.surfaces.close",
            closeSurface({
              input,
              surfaceLifecycleState,
              surfaceScopes,
              eventBus,
              surfaceEvents,
              requestInputWaitService,
              approvalState,
              approvalWaitService,
            }),
          ),
      },
      messages: {
        submit: (input: SubmitMessageInput) =>
          admit(
            "runtime.messages.submit",
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
          ),
        abort: (input: AbortPromptInput) =>
          admit(
            "runtime.messages.abort",
            abortPrompt({
              input,
              surfaceScopes,
              queueState,
              appLog,
              eventBus,
              requestInputWaitService,
              approvalState,
              approvalWaitService,
            }),
          ),
        updateDraft: (input: UpdateComposerDraftInput) =>
          admit(
            "runtime.messages.updateDraft",
            updateRuntimeComposerDraft(input).pipe(
              Effect.provideService(RuntimeComposerDraftStatePort, composerDraftState),
              Effect.provideService(RuntimeEventBus, eventBus),
            ),
          ),
      },
      queues: {
        steer: (input: SteerQueuedMessageInput) =>
          admit(
            "runtime.queues.steer",
            steerRuntimeQueuedMessage({ input }).pipe(
              Effect.provideService(RuntimeQueueStatePort, queueState),
              Effect.provideService(RuntimeEventBus, eventBus),
              Effect.provideService(
                RuntimeQueueSteeringPostCommitLane,
                runtimeQueueSteeringPostCommitLaneFromPort({ queueWake, appLog, eventBus }),
              ),
              Effect.mapError((cause: unknown) =>
                runtimeAdapterError("runtime.queues.steer", cause),
              ),
            ),
          ),
        restoreToComposer: (input: RestoreQueuedMessageToComposerInput) =>
          admit(
            "runtime.queues.restoreToComposer",
            restoreRuntimeQueuedMessageToComposer(input).pipe(
              Effect.provideService(RuntimeQueueStatePort, queueState),
              Effect.provideService(RuntimeEventBus, eventBus),
            ),
          ),
        reorder: (input: ReorderQueuedMessageInput) =>
          admit(
            "runtime.queues.reorder",
            reorderRuntimeQueuedMessage(input).pipe(
              Effect.provideService(RuntimeQueueStatePort, queueState),
              Effect.provideService(RuntimeEventBus, eventBus),
            ),
          ),
      },
      workspaceRecovery: {
        wakeSurfaceQueue: (input: { readonly target: PromptTarget }) =>
          admit(
            "runtime.workspaceRecovery.wakeSurfaceQueue",
            queueWake.wakeSurface({
              target: input.target,
              reason: "startup-recovery",
            }),
          ),
      },
      requestInput: {
        setVariant: (
          input: SetRequestInputVariantInput,
        ): Effect.Effect<SetRequestInputVariantResult, RuntimeContractError> =>
          admit(
            "runtime.requestInput.setVariant",
            setRuntimeRequestInputVariant(input).pipe(
              Effect.provideService(RuntimeRequestStatePort, requestState),
              Effect.provideService(RuntimeEventBus, eventBus),
              Effect.provideService(RuntimeSourceInvalidationService, sourceInvalidation),
              Effect.provideService(RuntimeWorkspaceScopeService, workspaceScopes),
            ),
          ),
        setBlockingTimeout: (
          input: SetRequestInputBlockingTimeoutInput,
        ): Effect.Effect<SetRequestInputBlockingTimeoutResult, RuntimeContractError> =>
          admit(
            "runtime.requestInput.setBlockingTimeout",
            setRuntimeRequestInputBlockingTimeout(input).pipe(
              Effect.provideService(RuntimeRequestStatePort, requestState),
              Effect.provideService(RuntimeEventBus, eventBus),
            ),
          ),
        answer: (
          input: AnswerRequestInputInput,
        ): Effect.Effect<AnswerRequestInputResult, RuntimeContractError> =>
          admit(
            "runtime.requestInput.answer",
            answerRuntimeRequestInput(input, queueWake.wakeSurface).pipe(
              Effect.provideService(RuntimeRequestStatePort, requestState),
              Effect.provideService(RuntimeEventBus, eventBus),
              Effect.provideService(RuntimeRequestInputWaitService, requestInputWaitService),
            ),
          ),
        setTimerPaused: (
          input: SetRequestInputTimerPausedInput,
        ): Effect.Effect<SetRequestInputTimerPausedResult, RuntimeContractError> =>
          admit(
            "runtime.requestInput.setTimerPaused",
            setRuntimeRequestInputTimerPaused(input).pipe(
              Effect.provideService(RuntimeRequestStatePort, requestState),
              Effect.provideService(RuntimeEventBus, eventBus),
              Effect.provideService(RuntimeRequestInputWaitService, requestInputWaitService),
            ),
          ),
      },
      commands: {
        writeStdin: (
          input: WriteCommandStdinInput,
        ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError> =>
          admit(
            "runtime.commands.writeStdin",
            writeCommandStdin({
              input,
              commandState,
              commandStdin,
              eventBus,
            }),
          ),
        cancel: (
          input: CancelCommandInput,
        ): Effect.Effect<CancelCommandResult, RuntimeContractError> =>
          admit(
            "runtime.commands.cancel",
            cancelCommand({
              input,
              commandState,
              commandControl,
              eventBus,
            }),
          ),
      },
      approvals: {
        answer: (
          input: AnswerRuntimeApprovalInput,
        ): Effect.Effect<AnswerRuntimeApprovalResult, RuntimeContractError> =>
          admit(
            "runtime.approvals.answer",
            answerRuntimeApproval(input).pipe(
              Effect.provideService(RuntimeApprovalStatePort, approvalState),
              Effect.provideService(RuntimeCommandStatePort, commandState),
              Effect.provideService(RuntimeSessionWaitStatePort, sessionWaitState),
              Effect.provideService(RuntimeEventBus, eventBus),
              Effect.provideService(RuntimeApprovalWaitService, approvalWaitService),
            ),
          ),
      },
      sourceEdits: {
        open: (input: OpenExtensionSourceEditInput) =>
          admit(
            "runtime.sourceEdits.open",
            openRuntimeSourceEdit({
              input,
              extensions,
              sourceState,
              fileSystem,
              path,
              crypto,
              extensionSourceRoots,
            }),
          ),
        save: (input: RuntimeSaveExtensionSourceEditInput) =>
          admit(
            "runtime.sourceEdits.save",
            saveRuntimeSourceEdit({
              input,
              extensions,
              sourceState,
              eventBus,
              fileSystem,
              path,
              crypto,
              extensionSourceRoots,
              recoveryState,
              sourceRecoveryWorker,
              recoveryMaxAttempts: runtimeConfig.recoveryRetryMaxAttempts,
              sourceInvalidation,
              modelResolver,
              providerAuth,
            }),
          ),
        createWorkflowAgent: (input: RuntimeCreateWorkflowAgentSourceInput) =>
          admit(
            "runtime.sourceEdits.createWorkflowAgent",
            createRuntimeWorkflowAgentSource({
              input,
              extensions,
              sourceState,
              recoveryState,
              sourceRecoveryWorker,
              recoveryMaxAttempts: runtimeConfig.recoveryRetryMaxAttempts,
              sourceInvalidation,
              eventBus,
              modelResolver,
              providerAuth,
              fileSystem,
              path,
              crypto,
              extensionSourceRoots,
            }),
          ),
        duplicateWorkflowAgent: (input: RuntimeDuplicateWorkflowAgentSourceInput) =>
          admit(
            "runtime.sourceEdits.duplicateWorkflowAgent",
            duplicateRuntimeWorkflowAgentSource({
              input,
              extensions,
              sourceState,
              recoveryState,
              sourceRecoveryWorker,
              recoveryMaxAttempts: runtimeConfig.recoveryRetryMaxAttempts,
              sourceInvalidation,
              eventBus,
              modelResolver,
              providerAuth,
              fileSystem,
              path,
              crypto,
              extensionSourceRoots,
            }),
          ),
        deleteWorkflowAgent: (input: RuntimeDeleteWorkflowAgentSourceInput) =>
          admit(
            "runtime.sourceEdits.deleteWorkflowAgent",
            deleteRuntimeWorkflowAgentSource({
              input,
              extensions,
              sourceState,
              recoveryState,
              sourceRecoveryWorker,
              recoveryMaxAttempts: runtimeConfig.recoveryRetryMaxAttempts,
              sourceInvalidation,
              eventBus,
              fileSystem,
              path,
              crypto,
              extensionSourceRoots,
            }),
          ),
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
      workflowTaskAgentBridge,
      events: (input?: RuntimeEventsInput) =>
        shutdownAdmission.assertAccepting("runtime.events").pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeEventStreamError({
                operation: "runtime.events",
                reason: "subscriber-closed",
                message: cause.message,
                cause,
              }),
          ),
          Effect.andThen(eventBus.subscribe(input)),
        ),
    };
  });
}

function acquireWorkspace(input: {
  readonly input: AcquireWorkspaceInput;
  readonly workspaceState: RuntimeWorkspaceStatePortService;
  readonly workspaceScopes: RuntimeWorkspaceScopeServiceService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly requestInputWaitService: RuntimeRequestInputWaitService["Service"];
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
    yield* input.requestInputWaitService.restoreOpenBlockingRequests();
    return result;
  });
}

function acquireDefaultWorkspace(input: {
  readonly input: AcquireDefaultWorkspaceInput;
  readonly workspaceState: RuntimeWorkspaceStatePortService;
  readonly workspaceScopes: RuntimeWorkspaceScopeServiceService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly requestInputWaitService: RuntimeRequestInputWaitService["Service"];
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
    yield* input.requestInputWaitService.restoreOpenBlockingRequests();
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
  readonly surfaceScopes: RuntimeSurfaceScopeServiceService;
  readonly promptDefaults: RuntimePromptDefaultsServiceService;
  readonly actorBindingState: RuntimeActorExtensionBindingStatePortService;
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
    const defaults = yield* input.promptDefaults
      .resolve({ target: result.target as PromptTarget })
      .pipe(
        Effect.catch((error) =>
          error.reason === "stale-state"
            ? Effect.succeed({
                provider: "openai",
                model: "gpt-4o",
                reasoningEffort: "medium" as const,
              })
            : Effect.fail(error),
        ),
      );
    yield* input.actorBindingState
      .setActorExtensionBinding({
        target: result.target as PromptTarget,
        loadedExtensionIds: [],
        availableExtensionIds: [],
        reason: "source-refresh",
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    const binding = yield* input.actorBindingState
      .readRuntimePromptBinding({ target: result.target as PromptTarget })
      .pipe(
        Effect.catch((cause) =>
          cause.reason === "not-found"
            ? Effect.succeed({
                target: result.target as PromptTarget,
                generatedAgentContextBindingId: `${result.surfacePiSessionId}:initial`,
                generatedAgentContextFingerprint:
                  `${result.surfacePiSessionId}:initial` as RuntimePromptBindingRecord["generatedAgentContextFingerprint"],
                generatedAgentContextRevision: 0,
                systemPrompt: "",
                loadedExtensionIds: [],
                availableExtensionIds: [],
                externalSourceHashes: [],
                updateExtensionContextBeforeNextTurn: true,
              } satisfies RuntimePromptBindingRecord)
            : Effect.fail(cause),
        ),
        Effect.mapError((cause) => runtimeStateError(operation, cause)),
      );
    yield* input.surfaceScopes.create({
      workspaceId: input.input.workspaceId,
      workspaceSessionId: result.workspaceSessionId,
      surfacePiSessionId: result.surfacePiSessionId,
      actorKind: "orchestrator",
      ...(input.input.profileId ? { agentProfileId: input.input.profileId } : {}),
      generatedContextFingerprint: binding.generatedAgentContextFingerprint,
      model: {
        providerId: defaults.provider as never,
        modelId: defaults.model as never,
      },
      reasoning: {
        effort: defaults.reasoningEffort,
      },
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
  readonly surfaceScopes: RuntimeSurfaceScopeServiceService;
  readonly transcriptState: RuntimeTranscriptStatePortService;
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
    yield* input.surfaceScopes.open({
      workspaceId: input.input.workspaceId,
      surfacePiSessionId: result.surfacePiSessionId,
      actorKind: result.target.surface,
    });
    const transcript = yield* input.transcriptState
      .readSurfaceTranscript({ surfacePiSessionId: result.surfacePiSessionId })
      .pipe(
        Effect.mapError((cause) =>
          runtimeStateError("runtime.surfaces.open.readSurfaceTranscript", cause),
        ),
      );
    const streamGenerationId = surfaceReopenStreamGenerationId(result.surfacePiSessionId);
    const advanced = yield* input.transcriptState
      .advanceStreamCursor({
        surfacePiSessionId: result.surfacePiSessionId,
        streamGenerationId,
        expectedCursor: transcript.streamCursor,
      })
      .pipe(
        Effect.mapError((cause) =>
          runtimeStateError("runtime.surfaces.open.advanceTranscriptCursor", cause),
        ),
      );
    yield* input.surfaceEvents
      .resetSurfaceStream({
        workspaceId: input.input.workspaceId,
        target: result.target,
        streamGenerationId,
        streamSequence: advanced.value.streamSequence,
        latestStreamSequence: 0 as never,
        reason: "surface_reopened",
      })
      .pipe(
        // The reopen cursor is already durable; surface.changed still asks consumers to refetch.
        Effect.catch(() => Effect.void),
      );
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

function surfaceReopenStreamGenerationId(surfacePiSessionId: string): SurfaceStreamGenerationId {
  return `surface-reopened:${surfacePiSessionId}` as SurfaceStreamGenerationId;
}

function closeSurface(input: {
  readonly input: CloseSurfaceInput;
  readonly surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  readonly surfaceScopes: RuntimeSurfaceScopeServiceService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly requestInputWaitService: RuntimeRequestInputWaitService["Service"];
  readonly approvalState: RuntimeApprovalStatePortService;
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
      eventBus: input.eventBus,
      approvalWaitService: input.approvalWaitService,
    });
    yield* input.surfaceScopes.interrupt({
      surfacePiSessionId: result.target.surfacePiSessionId,
      reason: "surface-close",
    });
    yield* input.surfaceScopes.release({
      surfacePiSessionId: result.target.surfacePiSessionId,
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

    const resolvedModel = yield* input.modelResolver.resolveModel({
      provider: resolved.provider,
      model: resolved.model,
    });
    const modelId = resolvedModel.model;
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
  readonly surfaceScopes: RuntimeSurfaceScopeServiceService;
  readonly queueState: RuntimeQueueStatePortService;
  readonly appLog: AppLogWritePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly requestInputWaitService: RuntimeRequestInputWaitService["Service"];
  readonly approvalState: RuntimeApprovalStatePortService;
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
            eventBus: input.eventBus,
            approvalWaitService: input.approvalWaitService,
          }),
        ),
        Effect.andThen(
          input.surfaceScopes.interrupt({
            surfacePiSessionId: target.surfacePiSessionId,
            turnId,
            reason: "user-abort",
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
          eventBus: input.eventBus,
          approvalWaitService: input.approvalWaitService,
        }),
      ),
      Effect.andThen(
        input.surfaceScopes.interrupt({
          surfacePiSessionId: target.surfacePiSessionId,
          reason: "user-abort",
        }),
      ),
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
  readonly eventBus: RuntimeEventBus["Service"];
  readonly approvalWaitService: RuntimeApprovalWaitService["Service"];
}): Effect.Effect<void, RuntimeContractError> {
  return cancelRuntimeApprovalRequestsForSurface({
    surfacePiSessionId: input.surfacePiSessionId,
    reason: input.reason,
  }).pipe(
    Effect.provideService(RuntimeApprovalStatePort, input.approvalState),
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
  readonly input: RuntimeSaveExtensionSourceEditInput;
  readonly extensions: Extensions["Service"];
  readonly sourceState: RuntimeSourceStatePortService;
  readonly recoveryState: RuntimeRecoveryStatePortService;
  readonly sourceRecoveryWorker: RuntimeSourceReconcileRecoveryWorkerService;
  readonly recoveryMaxAttempts: number;
  readonly sourceInvalidation: RuntimeSourceInvalidationService["Service"];
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly providerAuth: RuntimeLayerProviderAuthPortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly crypto: Crypto.Crypto;
  readonly extensionSourceRoots: ExtensionSourceRootsPortService;
}): Effect.Effect<SourceEditSaveResult, RuntimeContractError> {
  const operation = "runtime.sourceEdits.save";
  return Effect.gen(function* () {
    const sourceInput = input.input.source;
    const current = yield* provideExtensionSourceEditServices(
      input.extensions.sources.openEditSession(sourceInput),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    const sourceFact = yield* input.sourceState
      .readSourceVersion({
        scope: { kind: "app-global" },
        sourceKind: sourceInput.sourceKind,
        sourceId: sourceInput.sourceId,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    if (
      sourceInput.saveMode === "compare-and-swap" &&
      sourceFact &&
      sourceFact.sourceVersion !== sourceInput.expectedSourceVersion
    ) {
      return {
        status: "stale" as const,
        current: sessionWithRuntimeSourceFact(current, sourceFact),
      };
    }
    const workflowAgentSource =
      sourceInput.sourceKind === "workflow-agent"
        ? yield* decodeRuntimeWorkflowAgentSource({
            operation,
            sourceId: sourceInput.sourceId,
            sourceText: sourceInput.text,
          })
        : null;
    if (workflowAgentSource) {
      yield* admitRuntimeWorkflowAgentModel({
        operation,
        agent: workflowAgentSource.parameters,
        modelResolver: input.modelResolver,
        providerAuth: input.providerAuth,
      });
    }
    const saveResult = yield* provideExtensionSourceEditServices(
      input.extensions.sources.saveEditSession(sourceInput),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    if (saveResult.status === "stale") {
      return saveResult;
    }
    const savedAt = DateTime.formatIso(
      yield* DateTime.now,
    ) as unknown as RecordRuntimeSourceSaveInput["savedAt"];
    const record = {
      scope: { kind: "app-global" as const },
      sourceKind: sourceInput.sourceKind,
      sourceId: sourceInput.sourceId,
      path: current.path,
      previousSourceVersion: sourceFact?.sourceVersion ?? null,
      sourceVersion: saveResult.sourceVersion,
      fingerprint: saveResult.fingerprint,
      diagnostics: saveResult.diagnostics,
      sourceCommandId: sourceInput.sourceCommandId ?? null,
      savedAt,
    } satisfies RecordRuntimeSourceSaveInput;
    const recoveryPayload = sourceReconcileRecoveryPayload({
      operation: "record-save",
      record,
    });
    const workflowAgentObservation = workflowAgentSource
      ? validWorkflowAgentSourceObservation({
          sourceId: record.sourceId,
          path: record.path,
          sourceVersion: record.sourceVersion,
          fingerprint: record.fingerprint,
          diagnostics: record.diagnostics,
          source: workflowAgentSource,
          observedAt: savedAt,
        })
      : null;
    yield* commitRuntimeSourceMutation({
      operation,
      mutation: workflowAgentObservation
        ? input.sourceState.recordWorkflowAgentSourceSave({
            source: record,
            observation: workflowAgentObservation,
          })
        : input.sourceState.recordSourceSave(record),
      recoveryPayload,
      recoveryState: input.recoveryState,
      recoveryWorker: input.sourceRecoveryWorker,
      recoveryMaxAttempts: input.recoveryMaxAttempts,
      eventBus: input.eventBus,
    });
    yield* scheduleRuntimeSourceInvalidation({
      operation,
      sourceKind: sourceInput.sourceKind,
      sourceId: sourceInput.sourceId,
      path: current.path,
      observedAt: savedAt,
      recoveryPayload,
      recoveryState: input.recoveryState,
      recoveryWorker: input.sourceRecoveryWorker,
      recoveryMaxAttempts: input.recoveryMaxAttempts,
      sourceInvalidation: input.sourceInvalidation,
      eventBus: input.eventBus,
    });
    return saveResult;
  });
}

interface RuntimeWorkflowAgentLifecycleServices {
  readonly extensions: Extensions["Service"];
  readonly sourceState: RuntimeSourceStatePortService;
  readonly recoveryState: RuntimeRecoveryStatePortService;
  readonly sourceRecoveryWorker: RuntimeSourceReconcileRecoveryWorkerService;
  readonly recoveryMaxAttempts: number;
  readonly sourceInvalidation: RuntimeSourceInvalidationService["Service"];
  readonly eventBus: RuntimeEventBus["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly crypto: Crypto.Crypto;
  readonly extensionSourceRoots: ExtensionSourceRootsPortService;
}

function createRuntimeWorkflowAgentSource(
  input: RuntimeWorkflowAgentLifecycleServices & {
    readonly input: RuntimeCreateWorkflowAgentSourceInput;
    readonly modelResolver: RuntimeLayerModelResolverPortService;
    readonly providerAuth: RuntimeLayerProviderAuthPortService;
  },
): Effect.Effect<WorkflowAgentSourceLifecycleResult, RuntimeContractError> {
  const operation = "runtime.sourceEdits.createWorkflowAgent";
  return Effect.gen(function* () {
    yield* admitRuntimeWorkflowAgentModel({
      operation,
      agent: {
        provider: input.input.source.draft.provider,
        model: input.input.source.draft.model,
        reasoning: input.input.source.draft.reasoning,
      },
      modelResolver: input.modelResolver,
      providerAuth: input.providerAuth,
    });
    const targetFact = yield* input.sourceState
      .readSourceVersion({
        scope: { kind: "app-global" },
        sourceKind: "workflow-agent",
        sourceId: input.input.source.draft.exportName,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    const result = yield* provideExtensionSourceEditServices(
      input.extensions.sources.createWorkflowAgent(input.input.source),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    const savedAt = DateTime.formatIso(
      yield* DateTime.now,
    ) as unknown as RecordRuntimeSourceSaveInput["savedAt"];
    const record = {
      scope: { kind: "app-global" as const },
      sourceKind: "workflow-agent" as const,
      sourceId: result.session.sourceId,
      path: result.session.path,
      previousSourceVersion: targetFact?.sourceVersion ?? null,
      sourceVersion: result.session.sourceVersion,
      fingerprint: result.session.fingerprint,
      diagnostics: result.session.diagnostics,
      sourceCommandId: input.input.source.sourceCommandId ?? null,
      savedAt,
    } satisfies RecordRuntimeSourceSaveInput;
    const recoveryPayload = sourceReconcileRecoveryPayload({
      operation: "record-save",
      record,
    });
    const source = yield* decodeRuntimeWorkflowAgentSource({
      operation,
      sourceId: result.session.sourceId,
      sourceText: result.session.text,
    });
    const observation = validWorkflowAgentSourceObservation({
      sourceId: record.sourceId,
      path: record.path,
      sourceVersion: record.sourceVersion,
      fingerprint: record.fingerprint,
      diagnostics: record.diagnostics,
      source,
      observedAt: savedAt,
    });
    yield* commitRuntimeSourceMutation({
      operation,
      mutation: input.sourceState.recordWorkflowAgentSourceSave({ source: record, observation }),
      recoveryPayload,
      recoveryState: input.recoveryState,
      recoveryWorker: input.sourceRecoveryWorker,
      recoveryMaxAttempts: input.recoveryMaxAttempts,
      eventBus: input.eventBus,
    });
    yield* scheduleRuntimeSourceInvalidation({
      operation,
      sourceKind: record.sourceKind,
      sourceId: record.sourceId,
      path: record.path,
      observedAt: savedAt,
      recoveryPayload,
      recoveryState: input.recoveryState,
      recoveryWorker: input.sourceRecoveryWorker,
      recoveryMaxAttempts: input.recoveryMaxAttempts,
      sourceInvalidation: input.sourceInvalidation,
      eventBus: input.eventBus,
    });
    return result;
  });
}

function duplicateRuntimeWorkflowAgentSource(
  input: RuntimeWorkflowAgentLifecycleServices & {
    readonly input: RuntimeDuplicateWorkflowAgentSourceInput;
    readonly modelResolver: RuntimeLayerModelResolverPortService;
    readonly providerAuth: RuntimeLayerProviderAuthPortService;
  },
): Effect.Effect<WorkflowAgentSourceLifecycleResult, RuntimeContractError> {
  const operation = "runtime.sourceEdits.duplicateWorkflowAgent";
  return Effect.gen(function* () {
    const source = yield* provideExtensionSourceEditServices(
      input.extensions.sources.openEditSession({
        sourceKind: "workflow-agent",
        sourceId: input.input.source.sourceId,
      }),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    const sourceAgent = yield* decodeRuntimeWorkflowAgentSource({
      operation,
      sourceId: input.input.source.sourceId,
      sourceText: source.text,
    });
    yield* admitRuntimeWorkflowAgentModel({
      operation,
      agent: sourceAgent.parameters,
      modelResolver: input.modelResolver,
      providerAuth: input.providerAuth,
    });
    const targetFact = yield* input.sourceState
      .readSourceVersion({
        scope: { kind: "app-global" },
        sourceKind: "workflow-agent",
        sourceId: input.input.source.draftPatch.exportName,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    const result = yield* provideExtensionSourceEditServices(
      input.extensions.sources.duplicateWorkflowAgent(input.input.source),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    const savedAt = DateTime.formatIso(
      yield* DateTime.now,
    ) as unknown as RecordRuntimeSourceSaveInput["savedAt"];
    const record = {
      scope: { kind: "app-global" as const },
      sourceKind: "workflow-agent" as const,
      sourceId: result.session.sourceId,
      path: result.session.path,
      previousSourceVersion: targetFact?.sourceVersion ?? null,
      sourceVersion: result.session.sourceVersion,
      fingerprint: result.session.fingerprint,
      diagnostics: result.session.diagnostics,
      sourceCommandId: input.input.source.sourceCommandId ?? null,
      savedAt,
    } satisfies RecordRuntimeSourceSaveInput;
    const recoveryPayload = sourceReconcileRecoveryPayload({
      operation: "record-save",
      record,
    });
    const duplicatedSource = yield* decodeRuntimeWorkflowAgentSource({
      operation,
      sourceId: result.session.sourceId,
      sourceText: result.session.text,
    });
    const observation = validWorkflowAgentSourceObservation({
      sourceId: record.sourceId,
      path: record.path,
      sourceVersion: record.sourceVersion,
      fingerprint: record.fingerprint,
      diagnostics: record.diagnostics,
      source: duplicatedSource,
      observedAt: savedAt,
    });
    yield* commitRuntimeSourceMutation({
      operation,
      mutation: input.sourceState.recordWorkflowAgentSourceSave({ source: record, observation }),
      recoveryPayload,
      recoveryState: input.recoveryState,
      recoveryWorker: input.sourceRecoveryWorker,
      recoveryMaxAttempts: input.recoveryMaxAttempts,
      eventBus: input.eventBus,
    });
    yield* scheduleRuntimeSourceInvalidation({
      operation,
      sourceKind: record.sourceKind,
      sourceId: record.sourceId,
      path: record.path,
      observedAt: savedAt,
      recoveryPayload,
      recoveryState: input.recoveryState,
      recoveryWorker: input.sourceRecoveryWorker,
      recoveryMaxAttempts: input.recoveryMaxAttempts,
      sourceInvalidation: input.sourceInvalidation,
      eventBus: input.eventBus,
    });
    return result;
  });
}

function deleteRuntimeWorkflowAgentSource(
  input: RuntimeWorkflowAgentLifecycleServices & {
    readonly input: RuntimeDeleteWorkflowAgentSourceInput;
  },
): Effect.Effect<WorkflowAgentSourceDeleteResult, RuntimeContractError> {
  const operation = "runtime.sourceEdits.deleteWorkflowAgent";
  return Effect.gen(function* () {
    const current = yield* provideExtensionSourceEditServices(
      input.extensions.sources.openEditSession({
        sourceKind: "workflow-agent",
        sourceId: input.input.source.sourceId,
      }),
      input,
    ).pipe(Effect.mapError((cause) => runtimeExtensionSourceEditError(operation, cause)));
    const sourceFact = yield* input.sourceState
      .readSourceVersion({
        scope: { kind: "app-global" },
        sourceKind: "workflow-agent",
        sourceId: input.input.source.sourceId,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    const currentVersion = sourceFact?.deletedAt
      ? null
      : (sourceFact?.sourceVersion ?? current.sourceVersion);
    if (currentVersion !== input.input.source.expectedSourceVersion) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "stale-state",
          message: `Workflow-agent source ${input.input.source.sourceId} changed before deletion.`,
        }),
      );
    }
    const result = yield* provideExtensionSourceEditServices(
      input.extensions.sources.deleteWorkflowAgent(input.input.source),
      input,
    ).pipe(
      Effect.mapError((cause) =>
        cause.reason === "invalid-input" && cause.message.includes("changed before deletion")
          ? new RuntimeContractError({
              operation,
              reason: "stale-state",
              message: cause.message,
              cause,
            })
          : runtimeExtensionSourceEditError(operation, cause),
      ),
    );
    const deletedAt = DateTime.formatIso(
      yield* DateTime.now,
    ) as unknown as RecordRuntimeSourceDeleteInput["deletedAt"];
    const record = {
      scope: { kind: "app-global" as const },
      sourceKind: "workflow-agent" as const,
      sourceId: result.sourceId,
      path: result.deletedPath,
      previousSourceVersion: result.previousSourceVersion,
      previousFingerprint: current.fingerprint,
      sourceCommandId: input.input.source.sourceCommandId ?? null,
      deletedAt,
    } satisfies RecordRuntimeSourceDeleteInput;
    const recoveryPayload = sourceReconcileRecoveryPayload({
      operation: "record-delete",
      record,
    });
    yield* commitRuntimeSourceMutation({
      operation,
      mutation: input.sourceState.recordWorkflowAgentSourceDelete({ source: record }),
      recoveryPayload,
      recoveryState: input.recoveryState,
      recoveryWorker: input.sourceRecoveryWorker,
      recoveryMaxAttempts: input.recoveryMaxAttempts,
      eventBus: input.eventBus,
    });
    yield* scheduleRuntimeSourceInvalidation({
      operation,
      sourceKind: record.sourceKind,
      sourceId: record.sourceId,
      path: record.path,
      observedAt: deletedAt,
      recoveryPayload,
      recoveryState: input.recoveryState,
      recoveryWorker: input.sourceRecoveryWorker,
      recoveryMaxAttempts: input.recoveryMaxAttempts,
      sourceInvalidation: input.sourceInvalidation,
      eventBus: input.eventBus,
    });
    return result;
  });
}

function decodeRuntimeWorkflowAgentSource(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly sourceText: string;
}): Effect.Effect<
  {
    readonly parameters: TaskAgentParametersSource;
    readonly extensionOrder: readonly ExtensionId[];
  },
  RuntimeContractError
> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(input.sourceText) as unknown,
      catch: (cause) =>
        new RuntimeContractError({
          operation: input.operation,
          reason: "invalid-input",
          message: `Workflow-agent source ${input.sourceId} is not valid JSON.`,
          cause,
        }),
    });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation: input.operation,
          reason: "invalid-input",
          message: `Workflow-agent source ${input.sourceId} must contain a JSON object.`,
        }),
      );
    }
    const { extensionOrder: rawExtensionOrder, ...parameters } = parsed as Record<string, unknown>;
    if (
      rawExtensionOrder !== undefined &&
      (!Array.isArray(rawExtensionOrder) ||
        rawExtensionOrder.some((extensionId) => typeof extensionId !== "string") ||
        new Set(rawExtensionOrder).size !== rawExtensionOrder.length)
    ) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation: input.operation,
          reason: "invalid-input",
          message: `Workflow-agent source ${input.sourceId} has invalid extensionOrder metadata.`,
        }),
      );
    }
    const agent = yield* decodeUnknownTaskAgentParametersSourceEffect(parameters).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: input.operation,
            reason: "schema-error",
            ...boundarySchemaErrorDetails(cause),
            cause,
          }),
      ),
    );
    if (agent.id !== input.sourceId) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation: input.operation,
          reason: "invalid-input",
          message: `Workflow-agent source id must match its filename: ${input.sourceId}`,
        }),
      );
    }
    return {
      parameters: agent,
      extensionOrder: (rawExtensionOrder ?? []) as readonly ExtensionId[],
    };
  });
}

function validWorkflowAgentSourceObservation(input: {
  readonly sourceId: string;
  readonly path: WorkflowAgentSourceObservation["path"];
  readonly sourceVersion: string;
  readonly fingerprint: string;
  readonly diagnostics: WorkflowAgentSourceObservation["diagnostics"];
  readonly source: {
    readonly parameters: TaskAgentParametersSource;
    readonly extensionOrder: readonly ExtensionId[];
  };
  readonly observedAt: WorkflowAgentSourceObservation["observedAt"];
}): WorkflowAgentSourceObservation {
  return {
    sourceId: input.sourceId,
    path: input.path,
    sourceVersion: input.sourceVersion,
    fingerprint: input.fingerprint,
    validationStatus: "valid",
    diagnostics: input.diagnostics,
    parameters: input.source.parameters,
    extensionOrder: input.source.extensionOrder,
    observedAt: input.observedAt,
  };
}

function sourceReconcileRecoveryPayload(
  retry: SourceReconcileRecoveryPayload["retry"],
): SourceReconcileRecoveryPayload {
  return {
    request: {
      scope: { kind: "app-global" },
      domains: [sourceDomainForSourceKind(retry.record.sourceKind)],
      reason: "recovery",
    },
    retry,
  };
}

function commitRuntimeSourceMutation<A>(input: {
  readonly operation: string;
  readonly mutation: Effect.Effect<StateMutationResult<A>, StateContractError>;
  readonly recoveryPayload: SourceReconcileRecoveryPayload;
  readonly recoveryState: RuntimeRecoveryStatePortService;
  readonly recoveryWorker: RuntimeSourceReconcileRecoveryWorkerService;
  readonly recoveryMaxAttempts: number;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<A, RuntimeContractError> {
  return Effect.gen(function* () {
    const mutation = yield* input.mutation.pipe(
      Effect.catch((cause) =>
        enqueueRuntimeSourceRecovery({
          operation: input.operation,
          payload: input.recoveryPayload,
          recoveryState: input.recoveryState,
          recoveryWorker: input.recoveryWorker,
          recoveryMaxAttempts: input.recoveryMaxAttempts,
          eventBus: input.eventBus,
        }).pipe(Effect.andThen(Effect.fail(runtimeStateError(input.operation, cause)))),
      ),
    );
    yield* input.eventBus.publishStateInvalidations({ afterCommit: mutation.afterCommit }).pipe(
      Effect.mapError((cause) => runtimeAdapterError(input.operation, cause)),
      Effect.catch((cause) =>
        enqueueRuntimeSourceRecovery({
          operation: input.operation,
          payload: input.recoveryPayload,
          recoveryState: input.recoveryState,
          recoveryWorker: input.recoveryWorker,
          recoveryMaxAttempts: input.recoveryMaxAttempts,
          eventBus: input.eventBus,
        }).pipe(Effect.andThen(Effect.fail(cause))),
      ),
    );
    return mutation.value;
  });
}

function scheduleRuntimeSourceInvalidation(input: {
  readonly operation: string;
  readonly sourceKind: SourceEditSession["sourceKind"];
  readonly sourceId: string;
  readonly path: SourceEditSession["path"];
  readonly observedAt: NonNullable<SourceInvalidationHint["observedAt"]>;
  readonly recoveryPayload: SourceReconcileRecoveryPayload;
  readonly recoveryState: RuntimeRecoveryStatePortService;
  readonly recoveryWorker: RuntimeSourceReconcileRecoveryWorkerService;
  readonly recoveryMaxAttempts: number;
  readonly sourceInvalidation: RuntimeSourceInvalidationService["Service"];
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<void, RuntimeContractError> {
  return input.sourceInvalidation
    .hint({
      scope: { kind: "app-global" },
      domain: sourceDomainForSourceKind(input.sourceKind),
      path: input.path,
      observedAt: input.observedAt,
    })
    .pipe(
      Effect.catch((cause) =>
        enqueueRuntimeSourceRecovery({
          operation: input.operation,
          payload: input.recoveryPayload,
          recoveryState: input.recoveryState,
          recoveryWorker: input.recoveryWorker,
          recoveryMaxAttempts: input.recoveryMaxAttempts,
          eventBus: input.eventBus,
        }).pipe(Effect.andThen(Effect.fail(cause))),
      ),
    );
}

function sourceDomainForSourceKind(
  sourceKind: SourceEditSession["sourceKind"],
): "extensions" | "workflows" {
  return sourceKind.startsWith("workflow-") ? "workflows" : "extensions";
}

function enqueueRuntimeSourceRecovery(input: {
  readonly operation: string;
  readonly payload: SourceReconcileRecoveryPayload;
  readonly recoveryState: RuntimeRecoveryStatePortService;
  readonly recoveryWorker: RuntimeSourceReconcileRecoveryWorkerService;
  readonly recoveryMaxAttempts: number;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<void, RuntimeContractError> {
  return Effect.gen(function* () {
    const payloadJson = yield* encodeSourceReconcileRecoveryPayloadEffect(input.payload).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: input.operation,
            reason: "schema-error",
            ...boundarySchemaErrorDetails(cause),
            cause,
          }),
      ),
    );
    const retry = input.payload.retry;
    const timestamp =
      retry.operation === "record-save" ? retry.record.savedAt : retry.record.deletedAt;
    const targetVersion =
      retry.operation === "record-save"
        ? retry.record.sourceVersion
        : retry.record.previousSourceVersion;
    const record = retry.record;
    const mutation = yield* input.recoveryState
      .ensureRecoveryWork({
        scope: { kind: "app" },
        kind: "source_reconcile",
        ownerScope: {
          kind: "source",
          sourceKind: record.sourceKind,
          sourceId: record.sourceId,
        },
        idempotencyKey: `source_reconcile:${input.payload.retry.operation}:${record.sourceKind}:${record.sourceId}:${targetVersion}:${timestamp}`,
        orderingKey: `source:${record.sourceKind}:${record.sourceId}`,
        orderingSeq: Date.parse(timestamp),
        priority: 10,
        availableAt: timestamp,
        maxAttempts: input.recoveryMaxAttempts,
        payloadJson,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(input.operation, cause)));
    yield* input.eventBus.publishStateInvalidations({ afterCommit: mutation.afterCommit }).pipe(
      Effect.andThen(
        input.eventBus.publishLive({
          event: {
            type: "runtime.recovery",
            scope: "app",
            workId: mutation.value.id,
            status: mutation.value.status,
          },
        }),
      ),
      Effect.asVoid,
      Effect.mapError((cause) => runtimeAdapterError(input.operation, cause)),
      Effect.ensuring(input.recoveryWorker.wake()),
    );
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
