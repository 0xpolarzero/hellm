import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import {
  AppLogWritePort,
  boundarySchemaErrorDetails,
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeComposerDraftStatePort,
  RuntimeComposerProfileStatePort,
  RuntimeContractError,
  RuntimeEventStreamError,
  ExtensionError,
  StateContractError,
  RuntimeEpisodeStatePort,
  RuntimeExternalInstructionStatePort,
  ExtensionUsageStatePort,
  RuntimeExtensionContextImpactStatePort,
  GeneratedContextPreviewSubjectStatePort,
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
  RuntimeToolExecutionPolicyStatePort,
  RuntimePromptDefaultsStatePort,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  type PiSessionReferencePortService,
  type PiRuntimePathsPortService,
  ProviderAuthPort,
  ProviderAuthStatusStatePort,
  encodeSourceReconcileRecoveryPayloadEffect,
  decodeUnknownTaskAgentParametersSourceEffect,
  runtimeClientSubmissionLogDetails,
  normalizeRuntimeClientSubmissionMetadata,
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
  type BuildRuntimeExtensionInput,
  type BuildRuntimeExtensionResult,
  type AddExtensionInstructionInput,
  type AddExtensionInstructionResult,
  type ConfigureExtensionInstructionInput,
  type ConfigureExtensionInstructionResult,
  type CreateExtensionSourceInput,
  type CreateExtensionSourceResult,
  type DeleteExtensionSourceInput,
  type DeleteExtensionSourceResult,
  type DuplicateExtensionSourceInput,
  type DuplicateExtensionSourceResult,
  type CloseSurfaceInput,
  type CloseSurfaceResult,
  type CreateOrchestratorSurfaceInput,
  type CreateRuntimeOrchestratorSurfaceStateInput,
  type CreateSurfaceResult,
  type DeleteOrchestratorSurfaceInput,
  type DeleteOrchestratorSurfaceResult,
  type EditCommittedUserMessageInput,
  type EditCommittedUserMessageResult,
  type ForkOrchestratorSurfaceInput,
  type OpenSurfaceInput,
  type OpenSurfaceResult,
  type PromptTarget,
  type PreviewGeneratedContextInput,
  type ExtensionId,
  type JsonObject,
  type RecordRuntimeSourceSaveInput,
  type RecordRuntimeSourceDeleteInput,
  type RefreshGeneratedContextRequest,
  type RemoveExtensionInstructionInput,
  type RemoveExtensionInstructionResult,
  type ResetExtensionInstructionsInput,
  type RuntimeResetExtensionInstructionsResult,
  type RuntimeDeleteExtensionSnapshotInput,
  type RuntimeListExtensionSnapshotsInput,
  type RuntimeLoadExtensionSnapshotInput,
  type RuntimeRenameExtensionSnapshotInput,
  type RuntimeSaveExtensionSnapshotInput,
  type SetExtensionUsageInput,
  type RevertExtensionUsageInput,
  type RuntimeExtensionUsageMutationResult,
  type RenameExtensionInstructionInput,
  type RenameExtensionInstructionResult,
  type ReorderExtensionInstructionsInput,
  type ReorderExtensionInstructionsResult,
  type RevertExtensionSourceMutationInput,
  type RuntimeRevertExtensionSourceMutationResult,
  type InternalRefreshGeneratedPackagesRequest,
  type ReleaseWorkspaceInput,
  type ReleaseWorkspaceResult,
  type RenameOrchestratorSurfaceInput,
  type RenameOrchestratorSurfaceResult,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeComposerProfileStatePortService,
  type RuntimeEventsInput,
  type RuntimeQueueStatePortService,
  type RuntimeCreateWorkflowAgentSourceInput,
  type RuntimeDeleteWorkflowAgentSourceInput,
  type RuntimeDuplicateWorkflowAgentSourceInput,
  type ConfigureExtensionTypescriptApiInput,
  type RuntimeSaveExtensionSourceEditInput,
  type RuntimeRecoveryStatePortService,
  type RuntimePromptBindingRecord,
  type RuntimeSourceFactRecord,
  type RuntimeSourceStatePortService,
  type RuntimeSurfaceTarget,
  type SurfaceStreamGenerationId,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeActorExtensionBindingStatePortService,
  type GeneratedContextPreviewSubjectStatePortService,
  type AgentProfileId,
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
  type UpdateSurfaceExtensionUsageInput,
  type UpdateSurfaceModelInput,
  type UpdateSurfaceReasoningInput,
  type UpdateSurfaceSettingsResult,
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
  type RuntimeExternalInstructionScanInputPort,
  type RuntimeSourceInvalidationScanPort,
  RuntimeSourceInvalidationService,
} from "./runtime-source-invalidation-service";
import { RuntimeExtensionBuildService } from "./runtime-extension-build-service";
import { RuntimeExtensionLifecycleService } from "./runtime-extension-lifecycle-service";
import { RuntimeExtensionSnapshotService } from "./runtime-extension-snapshot-service";
import { RuntimeExtensionSourceCoordinator } from "./runtime-extension-source-coordinator";
import { RuntimeGeneratedContextPreviewService } from "./runtime-generated-context-preview-service";
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

const DEFAULT_ORCHESTRATOR_PROFILE_ID = "default-orchestrator" as AgentProfileId;

export { RuntimeGeneratedContextRefreshHostPort } from "./runtime-generated-context-refresh-service";
export type { RuntimeGeneratedContextRefreshHostPortService } from "./runtime-generated-context-refresh-service";
export { RuntimeGeneratedPackageRefreshHostPort } from "./runtime-generated-package-refresh-service";
export type { RuntimeGeneratedPackageRefreshHostPortService } from "./runtime-generated-package-refresh-service";
export {
  RuntimeExternalInstructionScanInputPort,
  RuntimeSourceInvalidationScanPort,
} from "./runtime-source-invalidation-service";
export type {
  RuntimeExternalInstructionScanInputPortService,
  RuntimeSourceInvalidationScanPortService,
} from "./runtime-source-invalidation-service";
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
  | RuntimeComposerProfileStatePort
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
  | RuntimeExternalInstructionScanInputPort
  | RuntimeSourceInvalidationScanPort
  | RuntimeLayerCommandStdinPort
  | RuntimeLayerCommandControlPort
  | SandboxPolicySource
  | SandboxHelperCandidatesPort
  | HostProcessReferencePort
  | RuntimeWorkspaceStatePort
  | RuntimeToolExecutionPolicyStatePort
  | RuntimeSurfaceLifecycleStatePort
  | RuntimeSourceStatePort
  | RuntimeExternalInstructionStatePort
  | GeneratedContextPreviewSubjectStatePort
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
    const extensionBuild = yield* RuntimeExtensionBuildService;
    const extensionLifecycle = yield* RuntimeExtensionLifecycleService;
    const extensionSnapshots = yield* RuntimeExtensionSnapshotService;
    const extensionSourceCoordinator = yield* RuntimeExtensionSourceCoordinator;
    const extensionUsageState = yield* ExtensionUsageStatePort;
    const extensionContextImpact = yield* RuntimeExtensionContextImpactStatePort;
    const generatedContextPreview = yield* RuntimeGeneratedContextPreviewService;
    const eventBus = yield* RuntimeEventBus;
    const surfaceEvents = yield* RuntimeSurfaceEventPublisher;
    const commandStdin = yield* RuntimeLayerCommandStdinPort;
    const commandControl = yield* RuntimeLayerCommandControlPort;
    const workspaceState = yield* RuntimeWorkspaceStatePort;
    const workspaceScopes = yield* RuntimeWorkspaceScopeService;
    const surfaceScopes = yield* RuntimeSurfaceScopeService;
    const surfaceLifecycleState = yield* RuntimeSurfaceLifecycleStatePort;
    const generatedContextPreviewSubjects = yield* GeneratedContextPreviewSubjectStatePort;
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
    const composerProfileState = yield* RuntimeComposerProfileStatePort;
    const requestState = yield* RuntimeRequestStatePort;
    const approvalState = yield* RuntimeApprovalStatePort;
    const commandState = yield* RuntimeCommandStatePort;
    const sessionWaitState = yield* RuntimeSessionWaitStatePort;
    const workflowTaskAgentBridge = yield* RuntimeWorkflowTaskAgentBridgeService;
    const shutdownAdmission = yield* RuntimeShutdownAdmission;
    const piAdapter = yield* PiAdapter;
    const piRuntimePaths = yield* PiRuntimePathsPort;
    const piSessionReferences = yield* PiSessionReferencePort;

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
              generatedContextPreviewSubjects,
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
        renameOrchestrator: (input: RenameOrchestratorSurfaceInput) =>
          admit(
            "runtime.surfaces.renameOrchestrator",
            renameOrchestratorSurface({
              input,
              piAdapter,
              piSessionReferences,
              surfaceLifecycleState,
              eventBus,
              surfaceEvents,
            }),
          ),
        forkOrchestrator: (input: ForkOrchestratorSurfaceInput) =>
          admit(
            "runtime.surfaces.forkOrchestrator",
            forkOrchestratorSurface({
              input,
              piAdapter,
              piRuntimePaths,
              piSessionReferences,
              surfaceLifecycleState,
              surfaceScopes,
              eventBus,
              surfaceEvents,
            }),
          ),
        deleteOrchestrator: (input: DeleteOrchestratorSurfaceInput) =>
          admit(
            "runtime.surfaces.deleteOrchestrator",
            deleteOrchestratorSurface({
              input,
              piAdapter,
              fileSystem,
              piSessionReferences,
              surfaceLifecycleState,
              surfaceScopes,
              eventBus,
              surfaceEvents,
              requestInputWaitService,
              approvalState,
              approvalWaitService,
            }),
          ),
        updateModel: (input: UpdateSurfaceModelInput) =>
          admit(
            "runtime.surfaces.updateModel",
            updateSurfaceModel({
              input,
              promptDefaults,
              composerProfileState,
              modelResolver,
              eventBus,
              surfaceEvents,
            }),
          ),
        updateReasoning: (input: UpdateSurfaceReasoningInput) =>
          admit(
            "runtime.surfaces.updateReasoning",
            updateSurfaceReasoning({
              input,
              promptDefaults,
              composerProfileState,
              modelResolver,
              eventBus,
              surfaceEvents,
            }),
          ),
        updateExtensionUsage: (input: UpdateSurfaceExtensionUsageInput) =>
          admit(
            "runtime.surfaces.updateExtensionUsage",
            updateSurfaceExtensionUsage({
              input,
              actorBindingState,
              composerProfileState,
              sourceInvalidation,
              eventBus,
              surfaceEvents,
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
        editCommitted: (input: EditCommittedUserMessageInput) =>
          admit(
            "runtime.messages.editCommitted",
            editCommittedUserMessage({
              input,
              surfaceScopes,
              transcriptState,
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
      generatedContext: {
        preview: (input: PreviewGeneratedContextInput) =>
          admit("runtime.generatedContext.preview", generatedContextPreview.preview(input)),
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
      extensions: {
        setUsage: (
          input: Omit<SetExtensionUsageInput, "target"> & { readonly agentProfile: string },
        ): Effect.Effect<RuntimeExtensionUsageMutationResult, RuntimeContractError> =>
          admit(
            "runtime.extensions.setUsage",
            Effect.gen(function* () {
              const registry = yield* extensions.registry.observe().pipe(
                Effect.mapError(
                  () =>
                    new RuntimeContractError({
                      operation: "runtime.extensions.setUsage",
                      reason: "target-not-ready",
                      message: "Extension registry observation is unavailable.",
                    }),
                ),
              );
              const extension = registry.observations.find(
                (candidate) => candidate.extensionId === input.extensionId,
              );
              if (!extension) {
                return yield* new RuntimeContractError({
                  operation: "runtime.extensions.setUsage",
                  reason: "target-not-found",
                  message: "Extension was not found.",
                });
              }
              if (!extension.usagePolicy.configurable) {
                return yield* new RuntimeContractError({
                  operation: "runtime.extensions.setUsage",
                  reason: "invalid-input",
                  message: extension.usagePolicy.fixedReason ?? "Extension usage is fixed.",
                });
              }
              const networkAccess = yield* extensionUsageState.readNetworkAccess().pipe(
                Effect.mapError(
                  () =>
                    new RuntimeContractError({
                      operation: "runtime.extensions.setUsage",
                      reason: "state-conflict",
                      message: "Network-access preference could not be read.",
                    }),
                ),
              );
              if (
                extension.usagePolicy.networkAccess === "required" &&
                !networkAccess &&
                input.usage !== "unavailable"
              ) {
                return yield* new RuntimeContractError({
                  operation: "runtime.extensions.setUsage",
                  reason: "invalid-input",
                  message:
                    "This extension requires network access before it can be loaded or available.",
                });
              }
              const target = yield* extensionUsageState.resolveTarget(input.agentProfile).pipe(
                Effect.mapError(
                  () =>
                    new RuntimeContractError({
                      operation: "runtime.extensions.setUsage",
                      reason: "target-not-found",
                      message: "Agent profile could not be resolved.",
                    }),
                ),
              );
              const committed = yield* commitStateMutation({
                operation: "runtime.extensions.setUsage",
                effect: extensionUsageState.set({
                  clientRequestId: input.clientRequestId,
                  extensionId: input.extensionId,
                  target,
                  usage: input.usage,
                  ...(input.expectedStateRevision === undefined
                    ? {}
                    : { expectedStateRevision: input.expectedStateRevision }),
                }),
                eventBus,
              });
              const affected = yield* extensionContextImpact
                .listUsageContextAffectedSurfaces({
                  agentProfile: input.agentProfile,
                  profileId: target.profileId as never,
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new RuntimeContractError({
                        operation: "runtime.extensions.setUsage",
                        reason: "state-conflict",
                        message: "Affected surfaces could not be resolved.",
                      }),
                  ),
                );
              return { change: committed, affectedSurfaces: affected };
            }),
          ),
        revertUsage: (
          input: RevertExtensionUsageInput,
        ): Effect.Effect<RuntimeExtensionUsageMutationResult, RuntimeContractError> =>
          admit(
            "runtime.extensions.revertUsage",
            Effect.gen(function* () {
              const original = yield* extensionUsageState.read(input.changeId).pipe(
                Effect.mapError(
                  () =>
                    new RuntimeContractError({
                      operation: "runtime.extensions.revertUsage",
                      reason: "state-conflict",
                      message: "Usage change could not be read.",
                    }),
                ),
              );
              if (!original) {
                return yield* new RuntimeContractError({
                  operation: "runtime.extensions.revertUsage",
                  reason: "target-not-found",
                  message: "Usage change was not found.",
                });
              }
              const registry = yield* extensions.registry.observe().pipe(
                Effect.mapError(
                  () =>
                    new RuntimeContractError({
                      operation: "runtime.extensions.revertUsage",
                      reason: "target-not-ready",
                      message: "Extension registry observation is unavailable.",
                    }),
                ),
              );
              const extension = registry.observations.find(
                (candidate) => candidate.extensionId === original.extensionId,
              );
              if (!extension) {
                return yield* new RuntimeContractError({
                  operation: "runtime.extensions.revertUsage",
                  reason: "target-not-found",
                  message: "Extension was not found.",
                });
              }
              const networkAccess = yield* extensionUsageState.readNetworkAccess().pipe(
                Effect.mapError(
                  () =>
                    new RuntimeContractError({
                      operation: "runtime.extensions.revertUsage",
                      reason: "state-conflict",
                      message: "Network-access preference could not be read.",
                    }),
                ),
              );
              if (
                extension.usagePolicy.networkAccess === "required" &&
                !networkAccess &&
                original.before !== null &&
                original.before !== "unavailable"
              ) {
                return yield* new RuntimeContractError({
                  operation: "runtime.extensions.revertUsage",
                  reason: "invalid-input",
                  message:
                    "This revert would restore network-required extension usage while network access is disabled.",
                });
              }
              const committed = yield* commitStateMutation({
                operation: "runtime.extensions.revertUsage",
                effect: extensionUsageState.revert(input),
                eventBus,
              });
              const affected = yield* extensionContextImpact
                .listUsageContextAffectedSurfaces({
                  agentProfile: committed.target.agentProfile,
                  profileId: committed.target.profileId as never,
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new RuntimeContractError({
                        operation: "runtime.extensions.revertUsage",
                        reason: "state-conflict",
                        message: "Affected surfaces could not be resolved.",
                      }),
                  ),
                );
              return { change: committed, affectedSurfaces: affected };
            }),
          ),
        create: (
          input: CreateExtensionSourceInput,
        ): Effect.Effect<CreateExtensionSourceResult, RuntimeContractError> =>
          admit("runtime.extensions.create", extensionLifecycle.create(input)),
        duplicate: (
          input: DuplicateExtensionSourceInput,
        ): Effect.Effect<DuplicateExtensionSourceResult, RuntimeContractError> =>
          admit("runtime.extensions.duplicate", extensionLifecycle.duplicate(input)),
        delete: (
          input: DeleteExtensionSourceInput,
        ): Effect.Effect<DeleteExtensionSourceResult, RuntimeContractError> =>
          admit("runtime.extensions.delete", extensionLifecycle.delete(input)),
        reset: (
          input: ResetExtensionInstructionsInput,
        ): Effect.Effect<RuntimeResetExtensionInstructionsResult, RuntimeContractError> =>
          admit("runtime.extensions.reset", extensionLifecycle.reset(input)),
        addInstruction: (
          input: AddExtensionInstructionInput,
        ): Effect.Effect<AddExtensionInstructionResult, RuntimeContractError> =>
          admit("runtime.extensions.addInstruction", extensionLifecycle.addInstruction(input)),
        removeInstruction: (
          input: RemoveExtensionInstructionInput,
        ): Effect.Effect<RemoveExtensionInstructionResult, RuntimeContractError> =>
          admit(
            "runtime.extensions.removeInstruction",
            extensionLifecycle.removeInstruction(input),
          ),
        configureInstruction: (
          input: ConfigureExtensionInstructionInput,
        ): Effect.Effect<ConfigureExtensionInstructionResult, RuntimeContractError> =>
          admit(
            "runtime.extensions.configureInstruction",
            extensionLifecycle.configureInstruction(input),
          ),
        renameInstruction: (
          input: RenameExtensionInstructionInput,
        ): Effect.Effect<RenameExtensionInstructionResult, RuntimeContractError> =>
          admit(
            "runtime.extensions.renameInstruction",
            extensionLifecycle.renameInstruction(input),
          ),
        reorderInstructions: (
          input: ReorderExtensionInstructionsInput,
        ): Effect.Effect<ReorderExtensionInstructionsResult, RuntimeContractError> =>
          admit(
            "runtime.extensions.reorderInstructions",
            extensionLifecycle.reorderInstructions(input),
          ),
        revertMutation: (
          input: RevertExtensionSourceMutationInput,
        ): Effect.Effect<RuntimeRevertExtensionSourceMutationResult, RuntimeContractError> =>
          admit("runtime.extensions.revertMutation", extensionLifecycle.revertMutation(input)),
        build: (
          input: BuildRuntimeExtensionInput,
        ): Effect.Effect<BuildRuntimeExtensionResult, RuntimeContractError> =>
          admit(
            "runtime.extensions.build",
            extensionSourceCoordinator.serialized(extensionBuild.build(input)),
          ),
        snapshots: {
          list: (input: RuntimeListExtensionSnapshotsInput) =>
            admit("runtime.extensions.snapshots.list", extensionSnapshots.list(input)),
          save: (input: RuntimeSaveExtensionSnapshotInput) =>
            admit("runtime.extensions.snapshots.save", extensionSnapshots.save(input)),
          rename: (input: RuntimeRenameExtensionSnapshotInput) =>
            admit("runtime.extensions.snapshots.rename", extensionSnapshots.rename(input)),
          delete: (input: RuntimeDeleteExtensionSnapshotInput) =>
            admit("runtime.extensions.snapshots.delete", extensionSnapshots.delete(input)),
          load: (input: RuntimeLoadExtensionSnapshotInput) =>
            admit("runtime.extensions.snapshots.load", extensionSnapshots.load(input)),
          ensureInitial: () =>
            admit("runtime.extensions.snapshots.ensureInitial", extensionSnapshots.ensureInitial()),
          recover: () =>
            admit("runtime.extensions.snapshots.recover", extensionSnapshots.recover()),
        },
      },
      sourceEdits: {
        configureTypescriptApi: (input: ConfigureExtensionTypescriptApiInput) =>
          admit(
            "runtime.sourceEdits.configureTypescriptApi",
            extensionLifecycle.configureTypescriptApi(input),
          ),
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
        save: (input: RuntimeSaveExtensionSourceEditInput) => {
          const effect = saveRuntimeSourceEdit({
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
          });
          return admit(
            "runtime.sourceEdits.save",
            input.source.sourceKind === "builtin-extension" ||
              input.source.sourceKind === "user-extension"
              ? extensionSourceCoordinator.serialized(effect)
              : effect,
          );
        },
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
        reconcile: (input: SourceReconcileRequest) => {
          const effect = sourceInvalidation.reconcile(input);
          return input.scope.kind === "app-global" &&
            (!input.domains || input.domains.includes("extensions"))
            ? extensionSourceCoordinator.serialized(effect)
            : effect;
        },
        applyCommittedScanEvent: (input: ApplyCommittedSourceInvalidationEventInput) =>
          input.scope.kind === "app-global" && input.event.domains.includes("extensions")
            ? extensionSourceCoordinator.serialized(
                sourceInvalidation.applyCommittedScanEvent(input),
              )
            : sourceInvalidation.applyCommittedScanEvent(input),
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
  readonly generatedContextPreviewSubjects: GeneratedContextPreviewSubjectStatePortService;
  readonly actorBindingState: RuntimeActorExtensionBindingStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<CreateSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.createOrchestrator";
  return Effect.gen(function* () {
    const profileId = input.input.profileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID;
    const subject = yield* input.generatedContextPreviewSubjects
      .readSubject({
        workspaceId: input.input.workspaceId,
        subject: {
          kind: "configured-profile",
          actorKind: "orchestrator",
          profileId,
        },
      })
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    const result = yield* commitStateMutation({
      operation,
      effect: input.surfaceLifecycleState.createOrchestratorSurface({
        workspaceId: input.input.workspaceId,
        ...(input.input.title === undefined ? {} : { title: input.input.title }),
        profileId,
        provider: subject.providerId,
        model: subject.modelId,
        reasoningEffort: subject.reasoningEffort,
        loadedExtensionIds: subject.actorBinding.loadedExtensionIds,
        availableExtensionIds: subject.actorBinding.availableExtensionIds,
      } satisfies CreateRuntimeOrchestratorSurfaceStateInput),
      eventBus: input.eventBus,
    });
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
                loadedExtensionIds: subject.actorBinding.loadedExtensionIds,
                availableExtensionIds: subject.actorBinding.availableExtensionIds,
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
        providerId: subject.providerId,
        modelId: subject.modelId,
      },
      reasoning: {
        effort: subject.reasoningEffort,
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

function renameOrchestratorSurface(input: {
  input: RenameOrchestratorSurfaceInput;
  piAdapter: PiAdapter["Service"];
  piSessionReferences: PiSessionReferencePortService;
  surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  eventBus: RuntimeEventBus["Service"];
  surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<RenameOrchestratorSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.renameOrchestrator";
  return Effect.gen(function* () {
    const title = input.input.title.trim();
    if (!title)
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "invalid-input",
          message: "Session title cannot be empty.",
        }),
      );
    const lifecycle = yield* input.surfaceLifecycleState
      .readOrchestratorLifecycle(input.input)
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    if (
      lifecycle.titleGenerationStatus === "pending" ||
      lifecycle.titleGenerationStatus === "running"
    ) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "state-conflict",
          message: "Session title is being generated. Rename is temporarily locked.",
        }),
      );
    }
    const target = lifecycle.targets.find((candidate) => candidate.surface === "orchestrator");
    if (!target)
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "target-not-found",
          message: `Orchestrator session ${input.input.workspaceSessionId} was not found.`,
        }),
      );
    yield* input.piAdapter.sessions
      .rename({
        workspaceId: input.input.workspaceId,
        workspaceSessionId: input.input.workspaceSessionId,
        surfacePiSessionId: target.surfacePiSessionId,
        actorKind: "orchestrator",
        title,
      })
      .pipe(
        Effect.provideService(PiSessionReferencePort, input.piSessionReferences),
        Effect.mapError((cause) => runtimeAdapterError(operation, cause)),
      );
    const result = yield* commitStateMutation({
      operation,
      effect: input.surfaceLifecycleState.renameOrchestrator({ ...input.input, title }),
      eventBus: input.eventBus,
    });
    yield* publishSurfaceChanged({
      operation,
      workspaceId: input.input.workspaceId,
      target,
      reason: "surface.updated",
      surfaceEvents: input.surfaceEvents,
    });
    return result;
  });
}

function forkOrchestratorSurface(input: {
  input: ForkOrchestratorSurfaceInput;
  piAdapter: PiAdapter["Service"];
  piRuntimePaths: PiRuntimePathsPortService;
  piSessionReferences: PiSessionReferencePortService;
  surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  surfaceScopes: RuntimeSurfaceScopeServiceService;
  eventBus: RuntimeEventBus["Service"];
  surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<CreateSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.forkOrchestrator";
  return Effect.gen(function* () {
    const lifecycle = yield* input.surfaceLifecycleState
      .readOrchestratorLifecycle(input.input)
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    const source = lifecycle.targets.find((candidate) => candidate.surface === "orchestrator");
    if (!source)
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "target-not-found",
          message: `Orchestrator session ${input.input.workspaceSessionId} was not found.`,
        }),
      );
    const forked = yield* input.piAdapter.sessions
      .fork({
        workspaceId: input.input.workspaceId,
        workspaceSessionId: input.input.workspaceSessionId,
        surfacePiSessionId: source.surfacePiSessionId,
        actorKind: "orchestrator",
        ...(input.input.title !== undefined ? { title: input.input.title } : {}),
        ...(input.input.messageTimestamp !== undefined
          ? { messageTimestamp: input.input.messageTimestamp }
          : {}),
      })
      .pipe(
        Effect.provideService(PiRuntimePathsPort, input.piRuntimePaths),
        Effect.provideService(PiSessionReferencePort, input.piSessionReferences),
        Effect.mapError((cause) => runtimeAdapterError(operation, cause)),
      );
    const result = yield* commitStateMutation({
      operation,
      effect: input.surfaceLifecycleState.forkOrchestrator({
        workspaceId: input.input.workspaceId,
        sourceWorkspaceSessionId: input.input.workspaceSessionId,
        targetSurfacePiSessionId: forked.surfacePiSessionId,
        ...(input.input.title !== undefined ? { title: input.input.title } : {}),
      }),
      eventBus: input.eventBus,
    });
    const savedReference = yield* input.piSessionReferences
      .savePiSessionReference({
        surfacePiSessionId: forked.surfacePiSessionId,
        reference: forked.reference,
      })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(`${operation}.saveReference`, cause)));
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: savedReference.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(`${operation}.saveReference`, cause)));
    yield* input.surfaceScopes.open({
      workspaceId: input.input.workspaceId,
      surfacePiSessionId: forked.surfacePiSessionId,
      expectedReference: forked.reference,
      actorKind: "orchestrator",
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

function deleteOrchestratorSurface(input: {
  input: DeleteOrchestratorSurfaceInput;
  piAdapter: PiAdapter["Service"];
  fileSystem: FileSystem.FileSystem;
  piSessionReferences: PiSessionReferencePortService;
  surfaceLifecycleState: RuntimeSurfaceLifecycleStatePortService;
  surfaceScopes: RuntimeSurfaceScopeServiceService;
  eventBus: RuntimeEventBus["Service"];
  surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  requestInputWaitService: RuntimeRequestInputWaitService["Service"];
  approvalState: RuntimeApprovalStatePortService;
  approvalWaitService: RuntimeApprovalWaitService["Service"];
}): Effect.Effect<DeleteOrchestratorSurfaceResult, RuntimeContractError> {
  const operation = "runtime.surfaces.deleteOrchestrator";
  return Effect.gen(function* () {
    const lifecycle = yield* input.surfaceLifecycleState
      .readOrchestratorLifecycle(input.input)
      .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
    for (const target of lifecycle.targets) {
      yield* input.requestInputWaitService.cancelBlockingRequestsForSurface({
        surfacePiSessionId: target.surfacePiSessionId,
        reason: "Session deleted.",
      });
      yield* cancelApprovalRequestsForSurface({
        surfacePiSessionId: target.surfacePiSessionId,
        reason: "Session deleted.",
        approvalState: input.approvalState,
        eventBus: input.eventBus,
        approvalWaitService: input.approvalWaitService,
      });
      yield* input.surfaceScopes.interrupt({
        surfacePiSessionId: target.surfacePiSessionId,
        reason: "surface-close",
      });
      yield* input.surfaceScopes.release({ surfacePiSessionId: target.surfacePiSessionId });
      yield* input.piAdapter.sessions
        .delete({
          workspaceId: input.input.workspaceId,
          surfacePiSessionId: target.surfacePiSessionId,
          actorKind: target.surface,
        })
        .pipe(
          Effect.provideService(FileSystem.FileSystem, input.fileSystem),
          Effect.provideService(PiSessionReferencePort, input.piSessionReferences),
          Effect.catch((cause) =>
            cause.reason === "session-not-found"
              ? Effect.void
              : Effect.fail(runtimeAdapterError(operation, cause)),
          ),
        );
    }
    const result = yield* commitStateMutation({
      operation,
      effect: input.surfaceLifecycleState.deleteOrchestrator(input.input),
      eventBus: input.eventBus,
    });
    yield* Effect.forEach(
      lifecycle.targets,
      (target) =>
        publishSurfaceChanged({
          operation,
          workspaceId: input.input.workspaceId,
          target,
          reason: "surface.closed",
          surfaceEvents: input.surfaceEvents,
        }),
      { discard: true },
    );
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

function updateSurfaceModel(input: {
  readonly input: UpdateSurfaceModelInput;
  readonly promptDefaults: RuntimePromptDefaultsServiceService;
  readonly composerProfileState: RuntimeComposerProfileStatePortService;
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<UpdateSurfaceSettingsResult, RuntimeContractError> {
  const operation = "runtime.surfaces.updateModel";
  return Effect.gen(function* () {
    const resolved = yield* input.modelResolver.resolveModel({
      provider: input.input.provider,
      model: input.input.model,
    });
    const current = yield* input.promptDefaults.resolve({ target: input.input.target });
    const reasoningEffort = resolved.supportedReasoning.includes(current.reasoningEffort)
      ? current.reasoningEffort
      : resolved.supportedReasoning.includes("medium")
        ? "medium"
        : (resolved.supportedReasoning[0] ?? "off");
    const committed = yield* input.promptDefaults.update({
      target: input.input.target,
      provider: resolved.provider,
      model: resolved.model,
      reasoningEffort,
    });
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: committed.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(operation, cause)));
    yield* syncComposerProfile({
      operation,
      target: input.input.target,
      update: { provider: resolved.provider, model: resolved.model, reasoningEffort },
      composerProfileState: input.composerProfileState,
      eventBus: input.eventBus,
    });
    yield* publishSurfaceChanged({
      operation,
      workspaceId: input.input.workspaceId,
      target: input.input.target,
      reason: "surface.updated",
      surfaceEvents: input.surfaceEvents,
    });
    return { target: input.input.target };
  });
}

function updateSurfaceReasoning(input: {
  readonly input: UpdateSurfaceReasoningInput;
  readonly promptDefaults: RuntimePromptDefaultsServiceService;
  readonly composerProfileState: RuntimeComposerProfileStatePortService;
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<UpdateSurfaceSettingsResult, RuntimeContractError> {
  const operation = "runtime.surfaces.updateReasoning";
  return Effect.gen(function* () {
    const current = yield* input.promptDefaults.resolve({ target: input.input.target });
    const resolved = yield* input.modelResolver.resolveModel({
      provider: current.provider,
      model: current.model,
    });
    if (!resolved.supportedReasoning.includes(input.input.reasoningEffort)) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "invalid-input",
          message: `Model ${current.provider}/${current.model} does not support reasoning effort ${input.input.reasoningEffort}.`,
        }),
      );
    }
    const committed = yield* input.promptDefaults.update({
      target: input.input.target,
      provider: current.provider,
      model: current.model,
      reasoningEffort: input.input.reasoningEffort,
    });
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: committed.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(operation, cause)));
    yield* syncComposerProfile({
      operation,
      target: input.input.target,
      update: { reasoningEffort: input.input.reasoningEffort },
      composerProfileState: input.composerProfileState,
      eventBus: input.eventBus,
    });
    yield* publishSurfaceChanged({
      operation,
      workspaceId: input.input.workspaceId,
      target: input.input.target,
      reason: "surface.updated",
      surfaceEvents: input.surfaceEvents,
    });
    return { target: input.input.target };
  });
}

function updateSurfaceExtensionUsage(input: {
  readonly input: UpdateSurfaceExtensionUsageInput;
  readonly actorBindingState: RuntimeActorExtensionBindingStatePortService;
  readonly composerProfileState: RuntimeComposerProfileStatePortService;
  readonly sourceInvalidation: RuntimeSourceInvalidationService["Service"];
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<UpdateSurfaceSettingsResult, RuntimeContractError> {
  const operation = "runtime.surfaces.updateExtensionUsage";
  return Effect.gen(function* () {
    yield* commitStateMutation({
      operation,
      effect: input.actorBindingState.updateActorExtensionBinding({
        target: input.input.target,
        extensionId: input.input.extensionId,
        usage: input.input.usage,
        reason: "composer-control",
      }),
      eventBus: input.eventBus,
    });
    yield* syncComposerProfile({
      operation,
      target: input.input.target,
      update: { extensionUsage: { [input.input.extensionId]: input.input.usage } },
      composerProfileState: input.composerProfileState,
      eventBus: input.eventBus,
    });
    yield* input.sourceInvalidation.refreshGeneratedContext({
      scope: "target",
      target: input.input.target,
      reason: "profile-settings-changed",
      refreshBoundSurfaceBeforeNextTurn: true,
    });
    yield* publishSurfaceChanged({
      operation,
      workspaceId: input.input.workspaceId,
      target: input.input.target,
      reason: "surface.updated",
      surfaceEvents: input.surfaceEvents,
    });
    return { target: input.input.target };
  });
}

function syncComposerProfile(input: {
  readonly operation: string;
  readonly target: PromptTarget;
  readonly update: Omit<
    Parameters<RuntimeComposerProfileStatePortService["updateFromComposer"]>[0],
    "profileId"
  >;
  readonly composerProfileState: RuntimeComposerProfileStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<void, RuntimeContractError> {
  return Effect.gen(function* () {
    const profileId = yield* input.composerProfileState
      .readSurfaceProfileId({ target: input.target })
      .pipe(Effect.mapError((cause) => runtimeStateError(input.operation, cause)));
    if (!profileId) return;
    const result = yield* input.composerProfileState
      .updateFromComposer({ profileId, ...input.update })
      .pipe(Effect.mapError((cause) => runtimeStateError(input.operation, cause)));
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: result.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(input.operation, cause)));
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

function editCommittedUserMessage(input: {
  readonly input: EditCommittedUserMessageInput;
  readonly surfaceScopes: RuntimeSurfaceScopeServiceService;
  readonly transcriptState: RuntimeTranscriptStatePortService;
  readonly promptDefaults: RuntimePromptDefaultsServiceService;
  readonly queueWake: RuntimeQueueWakeServiceService;
  readonly queueState: RuntimeQueueStatePortService;
  readonly providerAuth: RuntimeLayerProviderAuthPortService;
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly appLog: AppLogWritePortService;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<EditCommittedUserMessageResult, RuntimeContractError> {
  const operation = "runtime.messages.editCommitted";
  return Effect.gen(function* () {
    const expectedTimestampMs =
      typeof input.input.messageTimestamp === "number"
        ? input.input.messageTimestamp
        : Date.parse(input.input.messageTimestamp);
    if (!Number.isFinite(expectedTimestampMs)) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "invalid-input",
          message:
            "The selected committed user message is stale or does not belong to the target surface.",
        }),
      );
    }
    const defaults = yield* input.promptDefaults.resolve({ target: input.input.target });
    const apiKey = yield* input.providerAuth.ensureUsableProviderAuth(defaults.provider);
    if (!apiKey) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "target-not-ready",
          message: input.providerAuth.getProviderAuthUnavailableMessage(defaults.provider),
        }),
      );
    }
    yield* input.modelResolver.resolveModel({
      provider: defaults.provider,
      model: defaults.model,
    });
    const surface = yield* input.surfaceScopes.retainOpen({
      workspaceId: input.input.workspaceId,
      target: input.input.target,
    });
    const clientSubmission = normalizeRuntimeClientSubmissionMetadata(input.input.clientSubmission);
    const expectedDateTime = DateTime.make(expectedTimestampMs);
    if (Option.isNone(expectedDateTime)) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "invalid-input",
          message: "The selected committed user message timestamp is invalid.",
        }),
      );
    }
    const expectedCommittedAt = DateTime.formatIso(expectedDateTime.value);
    const idempotencyKey = `committed-edit:${input.input.target.surfacePiSessionId}:${input.input.messageId}:${expectedCommittedAt}`;
    const accepted = yield* surface
      .withPromptLock(
        Effect.gen(function* () {
          const transcript = yield* input.transcriptState
            .readSurfaceTranscript({ surfacePiSessionId: input.input.target.surfacePiSessionId })
            .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
          const original = transcript.messages.find(
            (message) => message.messageId === input.input.messageId,
          );
          const sourcePiHistoryEntry =
            original?.role === "user" && original.piHistoryEntry
              ? original.piHistoryEntry
              : {
                  session: { surfacePiSessionId: input.input.target.surfacePiSessionId },
                  entryId: "idempotent-replay",
                  messageId: input.input.messageId,
                };
          return yield* input.queueState
            .acceptEditedCommittedSurfaceMessage({
              workspaceId: input.input.workspaceId,
              target: input.input.target,
              sourceMessageId: input.input.messageId,
              expectedCommittedAt: expectedCommittedAt as never,
              sourcePiHistoryEntry,
              idempotencyKey,
              promptHistoryText: input.input.message.text.trim() ? input.input.message.text : null,
              messageJson: JSON.stringify(input.input.message),
              payloadJson: JSON.stringify({
                source: "committed-user-message-edit",
                sourceMessageId: input.input.messageId,
                expectedCommittedAt,
                sourcePiHistoryEntry,
                ...(clientSubmission ? { clientSubmission } : {}),
              }),
            })
            .pipe(Effect.mapError((cause) => runtimeStateError(operation, cause)));
        }),
      )
      .pipe(
        Effect.ensuring(
          input.surfaceScopes.release({
            surfacePiSessionId: input.input.target.surfacePiSessionId,
          }),
        ),
      );
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: accepted.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(operation, cause)));
    yield* input.queueWake.wakeSurface({ target: input.input.target, reason: "message-edited" });
    const queued = accepted.value.queuedMessage;
    return {
      queuedMessageId: queued.id as EditCommittedUserMessageResult["queuedMessageId"],
      target: input.input.target,
      status: "queued" as const,
      receipt: {
        clientRequestId:
          clientSubmission?.clientRequestId ?? clientSubmission?.submissionId ?? null,
        outcome: accepted.value.accepted === "existing" ? "duplicate" : "accepted",
        acceptedAt: queued.createdAt as EditCommittedUserMessageResult["receipt"]["acceptedAt"],
        stateRevision:
          queued.sequence as EditCommittedUserMessageResult["receipt"]["stateRevision"],
      },
    };
  });
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
      path: saveResult.path,
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
      path: saveResult.path,
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
