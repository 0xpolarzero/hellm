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
import {
  boundarySchemaErrorDetails,
  RuntimeContractError,
  decodeUnknownAddExtensionInstructionInputEffect,
  decodeUnknownAddExtensionInstructionResultEffect,
  decodeUnknownConfigureExtensionInstructionInputEffect,
  decodeUnknownConfigureExtensionInstructionResultEffect,
  decodeUnknownCreateExtensionSourceInputEffect,
  decodeUnknownCreateExtensionSourceResultEffect,
  decodeUnknownDeleteExtensionSourceInputEffect,
  decodeUnknownDeleteExtensionSourceResultEffect,
  decodeUnknownDuplicateExtensionSourceInputEffect,
  decodeUnknownDuplicateExtensionSourceResultEffect,
  decodeUnknownRemoveExtensionInstructionInputEffect,
  decodeUnknownRemoveExtensionInstructionResultEffect,
  decodeUnknownResetExtensionInstructionsInputEffect,
  decodeUnknownRuntimeResetExtensionInstructionsResultEffect,
  decodeUnknownRenameExtensionInstructionInputEffect,
  decodeUnknownRenameExtensionInstructionResultEffect,
  decodeUnknownReorderExtensionInstructionsInputEffect,
  decodeUnknownReorderExtensionInstructionsResultEffect,
  decodeUnknownRevertExtensionSourceMutationInputEffect,
  decodeUnknownRuntimeRevertExtensionSourceMutationResultEffect,
  ExtensionSnapshotSummaryCodecs,
  ExtensionSnapshotsReadModelCodecs,
  RuntimeDeleteExtensionSnapshotInputCodecs,
  RuntimeDeleteExtensionSnapshotResultCodecs,
  RuntimeListExtensionSnapshotsInputCodecs,
  RuntimeLoadExtensionSnapshotInputCodecs,
  RuntimeLoadExtensionSnapshotResultCodecs,
  RuntimeRenameExtensionSnapshotInputCodecs,
  RuntimeSaveExtensionSnapshotInputCodecs,
  decodeUnknownGeneratedContextPreviewResultEffect,
  decodeUnknownPreviewGeneratedContextInputEffect,
} from "@svvy/core";
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
  BuildRuntimeExtensionInput,
  BuildRuntimeExtensionResult,
  SetExtensionUsageInput,
  RevertExtensionUsageInput,
  RuntimeExtensionUsageMutationResult,
  AddExtensionInstructionInput,
  AddExtensionInstructionResult,
  ConfigureExtensionInstructionInput,
  ConfigureExtensionInstructionResult,
  CreateExtensionSourceInput,
  CreateExtensionSourceResult,
  DeleteExtensionSourceInput,
  DeleteExtensionSourceResult,
  DuplicateExtensionSourceInput,
  DuplicateExtensionSourceResult,
  CloseSurfaceInput,
  CloseSurfaceResult,
  CreateOrchestratorSurfaceInput,
  CreateSurfaceResult,
  DeleteOrchestratorSurfaceInput,
  DeleteOrchestratorSurfaceResult,
  ForkOrchestratorSurfaceInput,
  GeneratedPackagesRefreshResult,
  GeneratedContextPreviewResult,
  OpenSurfaceInput,
  OpenSurfaceResult,
  PromptTarget,
  PreviewGeneratedContextInput,
  RenameOrchestratorSurfaceInput,
  RenameOrchestratorSurfaceResult,
  RefreshGeneratedContextRequest,
  RefreshGeneratedPackagesRequest,
  RemoveExtensionInstructionInput,
  RemoveExtensionInstructionResult,
  ResetExtensionInstructionsInput,
  RuntimeResetExtensionInstructionsResult,
  RenameExtensionInstructionInput,
  RenameExtensionInstructionResult,
  ReorderExtensionInstructionsInput,
  ReorderExtensionInstructionsResult,
  RevertExtensionSourceMutationInput,
  RuntimeRevertExtensionSourceMutationResult,
  RuntimeDeleteExtensionSnapshotInput,
  RuntimeDeleteExtensionSnapshotResult,
  RuntimeEnsureInitialExtensionSnapshotResult,
  RuntimeListExtensionSnapshotsInput,
  RuntimeLoadExtensionSnapshotInput,
  RuntimeLoadExtensionSnapshotResult,
  RuntimeRenameExtensionSnapshotInput,
  RuntimeSaveExtensionSnapshotInput,
  ExtensionSnapshotSummary,
  ExtensionSnapshotsReadModel,
  ExtensionSnapshotPayloadStorePort,
  ExtensionSnapshotSecretStorePort,
  ExtensionSnapshotSecretValuesPort,
  ExtensionSnapshotSettingsStatePort,
  ExtensionSnapshotStatePort,
  ExtensionUsageStatePort,
  RuntimeExtensionContextImpactStatePort,
  GeneratedContextPreviewSubjectStatePort,
  ReleaseWorkspaceInput,
  ReleaseWorkspaceResult,
  RuntimeApprovalsApiEffect,
  RuntimeActorExtensionBindingStatePort,
  RuntimeCommandsApiEffect,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeComposerDraftStatePort,
  RuntimeComposerProfileStatePort,
  RuntimeEventError,
  RuntimeEvent,
  RuntimeEventSubscriptionClose,
  RuntimeEventsInput,
  RuntimeFacadeErrorContract,
  RuntimeEpisodeStatePort,
  RuntimeExtensionStatePort,
  RuntimeExternalInstructionStatePort,
  RuntimeGeneratedPackageStatePort,
  RuntimeMessagesApiEffect,
  RuntimePromptDefaultsStatePort,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  ProviderAuthPort,
  ProviderAuthStatusStatePort,
  RuntimeQueuesApiEffect,
  RuntimeQueueStatePort,
  RuntimeRequestInputApiEffect,
  RuntimeRequestStatePort,
  RuntimeCreateWorkflowAgentSourceInput,
  RuntimeDeleteWorkflowAgentSourceInput,
  RuntimeDuplicateWorkflowAgentSourceInput,
  RuntimeSaveExtensionSourceEditInput,
  ConfigureExtensionTypescriptApiInput,
  ConfigureExtensionTypescriptApiResult,
  RuntimeRecoveryStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceInvalidationApiEffect,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTranscriptStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkflowTaskStatePort,
  RuntimeWorkspaceStatePort,
  RuntimeToolExecutionPolicyStatePort,
  RuntimeSurfacesApiEffect,
  RuntimeWorkspacesApiEffect,
  SandboxPolicySource,
  OpenExtensionSourceEditInput,
  SourceEditSaveResult,
  SourceEditSession,
  SourceInvalidationHint,
  SourceReconcileRequest,
  SourceReconcileResult,
  SetRequestInputBlockingTimeoutInput,
  SetRequestInputBlockingTimeoutResult,
  SetRequestInputTimerPausedInput,
  SetRequestInputTimerPausedResult,
  SetRequestInputVariantInput,
  SetRequestInputVariantResult,
  SteerQueuedMessageInput,
  UpdateComposerDraftInput,
  UpdateComposerDraftResult,
  RestoreQueuedMessageToComposerInput,
  RestoreQueuedMessageToComposerResult,
  ReorderQueuedMessageInput,
  ReorderQueuedMessageResult,
  SubmitMessageInput,
  SubmitMessageResult,
  EditCommittedUserMessageInput,
  EditCommittedUserMessageResult,
  UpdateSurfaceExtensionUsageInput,
  UpdateSurfaceModelInput,
  UpdateSurfaceReasoningInput,
  UpdateSurfaceSettingsResult,
  WriteCommandStdinInput,
  WriteCommandStdinResult,
  AuthenticatedRunTaskAgentInput,
  RunTaskAgentResult,
  WorkflowAgentSourceDeleteResult,
  WorkflowAgentSourceLifecycleResult,
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
  decodeUnknownBuildRuntimeExtensionInputEffect,
  decodeUnknownBuildRuntimeExtensionResultEffect,
  decodeUnknownCloseSurfaceInputEffect,
  decodeUnknownCloseSurfaceResultEffect,
  decodeUnknownCreateOrchestratorSurfaceInputEffect,
  decodeUnknownCreateSurfaceResultEffect,
  decodeUnknownDeleteOrchestratorSurfaceInputEffect,
  decodeUnknownDeleteOrchestratorSurfaceResultEffect,
  decodeUnknownForkOrchestratorSurfaceInputEffect,
  decodeUnknownRuntimeCreateWorkflowAgentSourceInputEffect,
  decodeUnknownRuntimeDeleteWorkflowAgentSourceInputEffect,
  decodeUnknownRuntimeDuplicateWorkflowAgentSourceInputEffect,
  decodeUnknownRuntimeSaveExtensionSourceEditInputEffect,
  decodeUnknownConfigureExtensionTypescriptApiInputEffect,
  decodeUnknownConfigureExtensionTypescriptApiResultEffect,
  decodeUnknownGeneratedPackagesRefreshResultEffect,
  decodeUnknownOpenExtensionSourceEditInputEffect,
  decodeUnknownOpenSurfaceInputEffect,
  decodeUnknownOpenSurfaceResultEffect,
  decodeUnknownRenameOrchestratorSurfaceInputEffect,
  decodeUnknownRenameOrchestratorSurfaceResultEffect,
  decodeUnknownRefreshGeneratedContextRequestEffect,
  decodeUnknownRefreshGeneratedPackagesRequestEffect,
  decodeUnknownReleaseWorkspaceInputEffect,
  decodeUnknownReleaseWorkspaceResultEffect,
  decodeUnknownRuntimeEventEffect,
  decodeUnknownRuntimeEventSubscriptionCloseEffect,
  decodeUnknownRuntimeEventsInputEffect,
  decodeUnknownSetRequestInputBlockingTimeoutInputEffect,
  decodeUnknownSetRequestInputBlockingTimeoutResultEffect,
  decodeUnknownSetRequestInputTimerPausedInputEffect,
  decodeUnknownSetRequestInputTimerPausedResultEffect,
  decodeUnknownSetRequestInputVariantInputEffect,
  decodeUnknownSetRequestInputVariantResultEffect,
  decodeUnknownSourceEditSaveResultEffect,
  decodeUnknownSourceEditSessionEffect,
  decodeUnknownSourceInvalidationHintEffect,
  decodeUnknownSourceReconcileRequestEffect,
  decodeUnknownSourceReconcileResultEffect,
  decodeUnknownSteerQueuedMessageInputEffect,
  decodeUnknownUpdateComposerDraftInputEffect,
  decodeUnknownUpdateComposerDraftResultEffect,
  decodeUnknownUpdateSurfaceExtensionUsageInputEffect,
  decodeUnknownUpdateSurfaceModelInputEffect,
  decodeUnknownUpdateSurfaceReasoningInputEffect,
  decodeUnknownUpdateSurfaceSettingsResultEffect,
  decodeUnknownRestoreQueuedMessageToComposerInputEffect,
  decodeUnknownRestoreQueuedMessageToComposerResultEffect,
  decodeUnknownReorderQueuedMessageInputEffect,
  decodeUnknownReorderQueuedMessageResultEffect,
  decodeUnknownSubmitMessageInputEffect,
  decodeUnknownSubmitMessageResultEffect,
  decodeUnknownEditCommittedUserMessageInputEffect,
  decodeUnknownEditCommittedUserMessageResultEffect,
  decodeUnknownWriteCommandStdinInputEffect,
  decodeUnknownWriteCommandStdinResultEffect,
  decodeUnknownWorkflowAgentSourceDeleteResultEffect,
  decodeUnknownWorkflowAgentSourceLifecycleResultEffect,
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
  RuntimeExternalInstructionScanInputPort,
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
import { layerRuntimeExtensionStartupReconcileService } from "./runtime-extension-startup-reconcile-service";
import { layerRuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import { layerRuntimeSourceReconcileRecoveryWorker } from "./runtime-source-reconcile-recovery-worker";
import { layerRuntimeWorkflowAgentSourceIndex } from "./runtime-workflow-agent-source-index";
import { layerRuntimeAcceptedNativeToolExecution } from "./accepted-native-tool-execution-service";
import { layerRuntimeLaunchPolicyService } from "./runtime-launch-policy-service";
import { layerStateCommandPostCommitNotificationPort } from "./state-command-post-commit-notification";
import {
  layerRuntimeAppLogCommitNotification,
  RuntimeAppLogCommitNotification,
} from "./runtime-app-log-commit-notification";
import {
  layerRuntimeCommittedStateInvalidationPublication,
  RuntimeCommittedStateInvalidationPublication,
} from "./runtime-committed-state-invalidation-publication";
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
import { layerRuntimeShutdownAdmission } from "./runtime-shutdown-admission";
import { layerRuntimeExtensionBuildService } from "./runtime-extension-build-service";
import { layerRuntimeExtensionLifecycleService } from "./runtime-extension-lifecycle-service";
import { layerRuntimeExtensionSnapshotService } from "./runtime-extension-snapshot-service";
import { layerRuntimeExtensionSourceCoordinator } from "./runtime-extension-source-coordinator";
import { layerRuntimeGeneratedContextPreviewService } from "./runtime-generated-context-preview-service";
import { layerRuntimeGeneratedContextBindingService } from "./runtime-generated-context-binding-service";

interface RuntimeMessagesService extends RuntimeMessagesApiEffect {}

interface RuntimeQueuesService extends RuntimeQueuesApiEffect {}

interface RuntimeRequestInputService extends RuntimeRequestInputApiEffect {}

interface RuntimeGeneratedContextService {
  preview(
    input: PreviewGeneratedContextInput,
  ): Effect.Effect<GeneratedContextPreviewResult, RuntimeContractError>;
}

interface RuntimeCommandsService extends RuntimeCommandsApiEffect {}

interface RuntimeExtensionsService {
  setUsage(
    input: Omit<SetExtensionUsageInput, "target"> & { readonly agentProfile: string },
  ): Effect.Effect<RuntimeExtensionUsageMutationResult, RuntimeContractError>;
  revertUsage(
    input: RevertExtensionUsageInput,
  ): Effect.Effect<RuntimeExtensionUsageMutationResult, RuntimeContractError>;
  create(
    input: CreateExtensionSourceInput,
  ): Effect.Effect<CreateExtensionSourceResult, RuntimeContractError>;
  duplicate(
    input: DuplicateExtensionSourceInput,
  ): Effect.Effect<DuplicateExtensionSourceResult, RuntimeContractError>;
  delete(
    input: DeleteExtensionSourceInput,
  ): Effect.Effect<DeleteExtensionSourceResult, RuntimeContractError>;
  reset(
    input: ResetExtensionInstructionsInput,
  ): Effect.Effect<RuntimeResetExtensionInstructionsResult, RuntimeContractError>;
  addInstruction(
    input: AddExtensionInstructionInput,
  ): Effect.Effect<AddExtensionInstructionResult, RuntimeContractError>;
  removeInstruction(
    input: RemoveExtensionInstructionInput,
  ): Effect.Effect<RemoveExtensionInstructionResult, RuntimeContractError>;
  configureInstruction(
    input: ConfigureExtensionInstructionInput,
  ): Effect.Effect<ConfigureExtensionInstructionResult, RuntimeContractError>;
  renameInstruction(
    input: RenameExtensionInstructionInput,
  ): Effect.Effect<RenameExtensionInstructionResult, RuntimeContractError>;
  reorderInstructions(
    input: ReorderExtensionInstructionsInput,
  ): Effect.Effect<ReorderExtensionInstructionsResult, RuntimeContractError>;
  revertMutation(
    input: RevertExtensionSourceMutationInput,
  ): Effect.Effect<RuntimeRevertExtensionSourceMutationResult, RuntimeContractError>;
  build(
    input: BuildRuntimeExtensionInput,
  ): Effect.Effect<BuildRuntimeExtensionResult, RuntimeContractError>;
  readonly snapshots: {
    list(
      input: RuntimeListExtensionSnapshotsInput,
    ): Effect.Effect<ExtensionSnapshotsReadModel, RuntimeContractError>;
    save(
      input: RuntimeSaveExtensionSnapshotInput,
    ): Effect.Effect<ExtensionSnapshotSummary, RuntimeContractError>;
    rename(
      input: RuntimeRenameExtensionSnapshotInput,
    ): Effect.Effect<ExtensionSnapshotSummary, RuntimeContractError>;
    delete(input: RuntimeDeleteExtensionSnapshotInput): Effect.Effect<
      {
        readonly snapshotId: RuntimeDeleteExtensionSnapshotInput["snapshotId"];
        readonly deleted: true;
      },
      RuntimeContractError
    >;
    load(
      input: RuntimeLoadExtensionSnapshotInput,
    ): Effect.Effect<RuntimeLoadExtensionSnapshotResult, RuntimeContractError>;
    ensureInitial(): Effect.Effect<
      RuntimeEnsureInitialExtensionSnapshotResult,
      RuntimeContractError
    >;
    recover(): Effect.Effect<void, RuntimeContractError>;
  };
}

interface RuntimeSourceEditsService {
  configureTypescriptApi(
    input: ConfigureExtensionTypescriptApiInput,
  ): Effect.Effect<ConfigureExtensionTypescriptApiResult, RuntimeContractError>;
  open(input: OpenExtensionSourceEditInput): Effect.Effect<SourceEditSession, RuntimeContractError>;
  save(
    input: RuntimeSaveExtensionSourceEditInput,
  ): Effect.Effect<SourceEditSaveResult, RuntimeContractError>;
  createWorkflowAgent(
    input: RuntimeCreateWorkflowAgentSourceInput,
  ): Effect.Effect<WorkflowAgentSourceLifecycleResult, RuntimeContractError>;
  duplicateWorkflowAgent(
    input: RuntimeDuplicateWorkflowAgentSourceInput,
  ): Effect.Effect<WorkflowAgentSourceLifecycleResult, RuntimeContractError>;
  deleteWorkflowAgent(
    input: RuntimeDeleteWorkflowAgentSourceInput,
  ): Effect.Effect<WorkflowAgentSourceDeleteResult, RuntimeContractError>;
}

interface RuntimeSourceInvalidationService extends RuntimeSourceInvalidationApiEffect {}

interface RuntimeWorkspaceRecoveryService {
  wakeSurfaceQueue(input: {
    readonly target: PromptTarget;
  }): Effect.Effect<void, RuntimeContractError>;
}

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
  readonly generatedContext: RuntimeGeneratedContextService;
  readonly commands: RuntimeCommandsService;
  readonly approvals: RuntimeApprovalsApiEffect;
  readonly extensions: RuntimeExtensionsService;
  readonly sourceEdits: RuntimeSourceEditsService;
  readonly sourceInvalidation: RuntimeSourceInvalidationService;
  readonly workspaceRecovery: RuntimeWorkspaceRecoveryService;
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

const runtimeShutdownAdmissionLayer = layerRuntimeShutdownAdmission;
const runtimeWorkflowAgentSourceIndexLayer = layerRuntimeWorkflowAgentSourceIndex.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeGeneratedPackageRefreshLayer = layerRuntimeGeneratedPackageRefreshService.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
  Layer.provideMerge(runtimeWorkflowAgentSourceIndexLayer),
);
const runtimeSourceInvalidationLayer = layerRuntimeSourceInvalidationService.pipe(
  Layer.provideMerge(runtimeShutdownAdmissionLayer),
  Layer.provideMerge(layerRuntimeEventBus),
  Layer.provideMerge(layerRuntimeGeneratedContextRefreshService),
  Layer.provideMerge(runtimeGeneratedPackageRefreshLayer),
);
const runtimeExtensionBuildLayer = layerRuntimeExtensionBuildService.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeExtensionStartupReconcileLayer = layerRuntimeExtensionStartupReconcileService.pipe(
  Layer.provideMerge(runtimeExtensionBuildLayer),
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeExtensionSourceCoordinatorLayer = layerRuntimeExtensionSourceCoordinator;
const runtimeExtensionLifecycleLayer = layerRuntimeExtensionLifecycleService.pipe(
  Layer.provideMerge(runtimeExtensionSourceCoordinatorLayer),
  Layer.provideMerge(runtimeSourceInvalidationLayer),
  Layer.provideMerge(runtimeExtensionBuildLayer),
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeExtensionSnapshotLayer = layerRuntimeExtensionSnapshotService.pipe(
  Layer.provideMerge(runtimeExtensionSourceCoordinatorLayer),
  Layer.provideMerge(runtimeSourceInvalidationLayer),
  Layer.provideMerge(runtimeExtensionBuildLayer),
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeGeneratedContextPreviewLayer = layerRuntimeGeneratedContextPreviewService;
const runtimeGeneratedContextBindingLayer = layerRuntimeGeneratedContextBindingService;
const runtimeSourceReconcileRecoveryWorkerLayer = layerRuntimeSourceReconcileRecoveryWorker.pipe(
  Layer.provideMerge(runtimeExtensionSourceCoordinatorLayer),
  Layer.provideMerge(runtimeSourceInvalidationLayer),
  Layer.provideMerge(layerRuntimeEventBus),
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
const runtimeRequestInputWaitLayer = layerRuntimeRequestInputWaitService.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeAcceptedNativeToolExecutionLayer = layerRuntimeAcceptedNativeToolExecution.pipe(
  Layer.provideMerge(runtimeRequestInputWaitLayer),
  Layer.provideMerge(runtimeApprovalWaitLayer),
  Layer.provideMerge(runtimeLaunchPolicyLayer),
  Layer.provideMerge(runtimeSourceInvalidationLayer),
  Layer.provideMerge(layerRuntimeEventBus),
  Layer.provide(runtimeShutdownAdmissionLayer),
);
const runtimeSurfaceQueueDispatcherLayer = layerRuntimeSurfaceQueueDispatcherService.pipe(
  Layer.provideMerge(runtimeSurfaceScopeLayer),
  Layer.provideMerge(runtimePromptExecutionLayer),
  Layer.provideMerge(runtimeSourceInvalidationLayer),
  Layer.provideMerge(layerRuntimeGeneratedContextRefreshService),
  Layer.provideMerge(runtimeGeneratedContextBindingLayer),
  Layer.provideMerge(layerRuntimePromptDefaultsService),
  Layer.provideMerge(runtimeAcceptedNativeToolExecutionLayer),
  Layer.provideMerge(runtimeShutdownAdmissionLayer),
);
const runtimeWorkflowTaskAgentBridgeLayer = layerRuntimeWorkflowTaskAgentBridgeService.pipe(
  Layer.provideMerge(runtimeShutdownAdmissionLayer),
  Layer.provideMerge(runtimeSurfaceQueueDispatcherLayer),
  Layer.provideMerge(layerRuntimeGeneratedContextRefreshService),
  Layer.provideMerge(runtimeSurfaceScopeLayer),
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeQueueWakeLayer = layerRuntimeQueueWakeService.pipe(
  Layer.provideMerge(runtimeShutdownAdmissionLayer),
  Layer.provideMerge(runtimeSurfaceQueueDispatcherLayer),
);
const runtimeInternalServicesLayer = Layer.mergeAll(
  runtimeShutdownAdmissionLayer,
  runtimeSourceInvalidationLayer,
  runtimeExtensionBuildLayer,
  runtimeExtensionStartupReconcileLayer,
  runtimeExtensionSourceCoordinatorLayer,
  runtimeExtensionLifecycleLayer,
  runtimeExtensionSnapshotLayer,
  runtimeGeneratedContextPreviewLayer,
  runtimeGeneratedContextBindingLayer,
  runtimeSourceReconcileRecoveryWorkerLayer,
  runtimeWorkflowAgentSourceIndexLayer,
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
  const runtimeExecutionPlanExecutorLayer = layerRuntimeExecutionPlanExecutor;
  const runtimeAppLogCommitNotificationLayer = layerRuntimeAppLogCommitNotification;
  const runtimeCommittedStateInvalidationPublicationLayer =
    layerRuntimeCommittedStateInvalidationPublication;
  const runtimeStartupReadinessLayer = layerRuntimeStartupReadiness.pipe(
    Layer.provideMerge(runtimeWorkflowAgentSourceIndexLayer),
    Layer.provideMerge(runtimeExtensionStartupReconcileLayer),
  );
  const runtimeShutdownPreparationLayer = layerRuntimeShutdownPreparation;

  export const layer: Layer.Layer<
    | Runtime
    | RuntimeStartupReadiness
    | RuntimeShutdownPreparation
    | RuntimeAppLogCommitNotification
    | RuntimeCommittedStateInvalidationPublication
    | StateCommandPostCommitNotificationPort,
    RuntimeLayerError,
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
    | RuntimeExtensionStatePort
    | ExtensionSnapshotPayloadStorePort
    | ExtensionSnapshotSecretStorePort
    | ExtensionSnapshotSecretValuesPort
    | ExtensionSnapshotSettingsStatePort
    | ExtensionSnapshotStatePort
    | ExtensionUsageStatePort
    | RuntimeExtensionContextImpactStatePort
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
    | RuntimeEpisodeStatePort
    | RuntimeWorkflowTaskAgentBridgeBearerVerifier
  > = Layer.mergeAll(
    runtimeServiceLayer,
    runtimeAcceptedNativeToolExecutionLayer,
    runtimeExecutionPlanExecutorLayer,
    runtimeAppLogCommitNotificationLayer,
    runtimeCommittedStateInvalidationPublicationLayer,
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
  renameOrchestrator(
    input: RenameOrchestratorSurfaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RenameOrchestratorSurfaceResult>;
  forkOrchestrator(
    input: ForkOrchestratorSurfaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<CreateSurfaceResult>;
  deleteOrchestrator(
    input: DeleteOrchestratorSurfaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<DeleteOrchestratorSurfaceResult>;
  updateModel(
    input: UpdateSurfaceModelInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<UpdateSurfaceSettingsResult>;
  updateReasoning(
    input: UpdateSurfaceReasoningInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<UpdateSurfaceSettingsResult>;
  updateExtensionUsage(
    input: UpdateSurfaceExtensionUsageInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<UpdateSurfaceSettingsResult>;
}

interface RuntimeMessagesFacade {
  submit(
    input: SubmitMessageInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SubmitMessageResult>;
  editCommitted(
    input: EditCommittedUserMessageInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<EditCommittedUserMessageResult>;
  abort(input: AbortPromptInput, options?: RuntimeFacadeCallOptions): Promise<void>;
  updateDraft(
    input: UpdateComposerDraftInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<UpdateComposerDraftResult>;
}

interface RuntimeQueuesFacade {
  steer(input: SteerQueuedMessageInput, options?: RuntimeFacadeCallOptions): Promise<void>;
  restoreToComposer(
    input: RestoreQueuedMessageToComposerInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RestoreQueuedMessageToComposerResult>;
  reorder(
    input: ReorderQueuedMessageInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<ReorderQueuedMessageResult>;
}

interface RuntimeRequestInputFacade {
  setVariant(
    input: SetRequestInputVariantInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SetRequestInputVariantResult>;
  setBlockingTimeout(
    input: SetRequestInputBlockingTimeoutInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SetRequestInputBlockingTimeoutResult>;
  answer(
    input: AnswerRequestInputInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AnswerRequestInputResult>;
  setTimerPaused(
    input: SetRequestInputTimerPausedInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SetRequestInputTimerPausedResult>;
}

interface RuntimeGeneratedContextFacade {
  preview(
    input: PreviewGeneratedContextInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<GeneratedContextPreviewResult>;
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

interface RuntimeExtensionsFacade {
  setUsage(
    input: Omit<SetExtensionUsageInput, "target"> & { readonly agentProfile: string },
    options?: RuntimeFacadeCallOptions,
  ): Promise<RuntimeExtensionUsageMutationResult>;
  revertUsage(
    input: RevertExtensionUsageInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RuntimeExtensionUsageMutationResult>;
  create(
    input: CreateExtensionSourceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<CreateExtensionSourceResult>;
  duplicate(
    input: DuplicateExtensionSourceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<DuplicateExtensionSourceResult>;
  delete(
    input: DeleteExtensionSourceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<DeleteExtensionSourceResult>;
  reset(
    input: ResetExtensionInstructionsInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RuntimeResetExtensionInstructionsResult>;
  addInstruction(
    input: AddExtensionInstructionInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AddExtensionInstructionResult>;
  removeInstruction(
    input: RemoveExtensionInstructionInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RemoveExtensionInstructionResult>;
  configureInstruction(
    input: ConfigureExtensionInstructionInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<ConfigureExtensionInstructionResult>;
  renameInstruction(
    input: RenameExtensionInstructionInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RenameExtensionInstructionResult>;
  reorderInstructions(
    input: ReorderExtensionInstructionsInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<ReorderExtensionInstructionsResult>;
  revertMutation(
    input: RevertExtensionSourceMutationInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RuntimeRevertExtensionSourceMutationResult>;
  build(
    input: BuildRuntimeExtensionInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<BuildRuntimeExtensionResult>;
  readonly snapshots: {
    list(
      input: RuntimeListExtensionSnapshotsInput,
      options?: RuntimeFacadeCallOptions,
    ): Promise<ExtensionSnapshotsReadModel>;
    save(
      input: RuntimeSaveExtensionSnapshotInput,
      options?: RuntimeFacadeCallOptions,
    ): Promise<ExtensionSnapshotSummary>;
    rename(
      input: RuntimeRenameExtensionSnapshotInput,
      options?: RuntimeFacadeCallOptions,
    ): Promise<ExtensionSnapshotSummary>;
    delete(
      input: RuntimeDeleteExtensionSnapshotInput,
      options?: RuntimeFacadeCallOptions,
    ): Promise<RuntimeDeleteExtensionSnapshotResult>;
    load(
      input: RuntimeLoadExtensionSnapshotInput,
      options?: RuntimeFacadeCallOptions,
    ): Promise<RuntimeLoadExtensionSnapshotResult>;
  };
}

interface RuntimeSourceEditsFacade {
  configureTypescriptApi(
    input: ConfigureExtensionTypescriptApiInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<ConfigureExtensionTypescriptApiResult>;
  open(
    input: OpenExtensionSourceEditInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceEditSession>;
  save(
    input: RuntimeSaveExtensionSourceEditInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceEditSaveResult>;
  createWorkflowAgent(
    input: RuntimeCreateWorkflowAgentSourceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<WorkflowAgentSourceLifecycleResult>;
  duplicateWorkflowAgent(
    input: RuntimeDuplicateWorkflowAgentSourceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<WorkflowAgentSourceLifecycleResult>;
  deleteWorkflowAgent(
    input: RuntimeDeleteWorkflowAgentSourceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<WorkflowAgentSourceDeleteResult>;
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
  readonly generatedContext: RuntimeGeneratedContextFacade;
  readonly commands: RuntimeCommandsFacade;
  readonly approvals: RuntimeApprovalsFacade;
  readonly extensions: RuntimeExtensionsFacade;
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
      renameOrchestrator: (input, options) =>
        run(
          "runtime.surfaces.renameOrchestrator",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.surfaces.renameOrchestrator",
              decodeUnknownRenameOrchestratorSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.renameOrchestrator(decoded);
            return yield* decodeBoundary(
              "runtime.surfaces.renameOrchestrator",
              decodeUnknownRenameOrchestratorSurfaceResultEffect,
              result,
            );
          }),
          options,
        ),
      forkOrchestrator: (input, options) =>
        run(
          "runtime.surfaces.forkOrchestrator",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.surfaces.forkOrchestrator",
              decodeUnknownForkOrchestratorSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.forkOrchestrator(decoded);
            return yield* decodeBoundary(
              "runtime.surfaces.forkOrchestrator",
              decodeUnknownCreateSurfaceResultEffect,
              result,
            );
          }),
          options,
        ),
      deleteOrchestrator: (input, options) =>
        run(
          "runtime.surfaces.deleteOrchestrator",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.surfaces.deleteOrchestrator",
              decodeUnknownDeleteOrchestratorSurfaceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.deleteOrchestrator(decoded);
            return yield* decodeBoundary(
              "runtime.surfaces.deleteOrchestrator",
              decodeUnknownDeleteOrchestratorSurfaceResultEffect,
              result,
            );
          }),
          options,
        ),
      updateModel: (input, options) =>
        run(
          "runtime.surfaces.updateModel",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.surfaces.updateModel",
              decodeUnknownUpdateSurfaceModelInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.updateModel(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.updateModel",
              decodeUnknownUpdateSurfaceSettingsResultEffect,
              result,
            );
          }),
          options,
        ),
      updateReasoning: (input, options) =>
        run(
          "runtime.surfaces.updateReasoning",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.surfaces.updateReasoning",
              decodeUnknownUpdateSurfaceReasoningInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.updateReasoning(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.updateReasoning",
              decodeUnknownUpdateSurfaceSettingsResultEffect,
              result,
            );
          }),
          options,
        ),
      updateExtensionUsage: (input, options) =>
        run(
          "runtime.surfaces.updateExtensionUsage",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.surfaces.updateExtensionUsage",
              decodeUnknownUpdateSurfaceExtensionUsageInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.surfaces.updateExtensionUsage(decodedInput);
            return yield* decodeBoundary(
              "runtime.surfaces.updateExtensionUsage",
              decodeUnknownUpdateSurfaceSettingsResultEffect,
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
      editCommitted: (input, options) =>
        run(
          "runtime.messages.editCommitted",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.messages.editCommitted",
              decodeUnknownEditCommittedUserMessageInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.messages.editCommitted(decodedInput);
            return yield* decodeBoundary(
              "runtime.messages.editCommitted",
              decodeUnknownEditCommittedUserMessageResultEffect,
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
      updateDraft: (input, options) =>
        run(
          "runtime.messages.updateDraft",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.messages.updateDraft",
              decodeUnknownUpdateComposerDraftInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.messages.updateDraft(decodedInput);
            return yield* decodeBoundary(
              "runtime.messages.updateDraft",
              decodeUnknownUpdateComposerDraftResultEffect,
              result,
            );
          }),
          options,
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
      restoreToComposer: (input, options) =>
        run(
          "runtime.queues.restoreToComposer",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.queues.restoreToComposer",
              decodeUnknownRestoreQueuedMessageToComposerInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.queues.restoreToComposer(decodedInput);
            return yield* decodeBoundary(
              "runtime.queues.restoreToComposer",
              decodeUnknownRestoreQueuedMessageToComposerResultEffect,
              result,
            );
          }),
          options,
        ),
      reorder: (input, options) =>
        run(
          "runtime.queues.reorder",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.queues.reorder",
              decodeUnknownReorderQueuedMessageInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.queues.reorder(decodedInput);
            return yield* decodeBoundary(
              "runtime.queues.reorder",
              decodeUnknownReorderQueuedMessageResultEffect,
              result,
            );
          }),
          options,
        ),
    },
    requestInput: {
      setVariant: (input, options) =>
        run(
          "runtime.requestInput.setVariant",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.requestInput.setVariant",
              decodeUnknownSetRequestInputVariantInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.requestInput.setVariant(decodedInput);
            return yield* decodeBoundary(
              "runtime.requestInput.setVariant",
              decodeUnknownSetRequestInputVariantResultEffect,
              result,
            );
          }),
          options,
        ),
      setBlockingTimeout: (input, options) =>
        run(
          "runtime.requestInput.setBlockingTimeout",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.requestInput.setBlockingTimeout",
              decodeUnknownSetRequestInputBlockingTimeoutInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.requestInput.setBlockingTimeout(decodedInput);
            return yield* decodeBoundary(
              "runtime.requestInput.setBlockingTimeout",
              decodeUnknownSetRequestInputBlockingTimeoutResultEffect,
              result,
            );
          }),
          options,
        ),
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
    generatedContext: {
      preview: (input, options) =>
        run(
          "runtime.generatedContext.preview",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.generatedContext.preview",
              decodeUnknownPreviewGeneratedContextInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.generatedContext.preview(decodedInput);
            return yield* decodeBoundary(
              "runtime.generatedContext.preview",
              decodeUnknownGeneratedContextPreviewResultEffect,
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
    extensions: {
      setUsage: (input, options) =>
        run(
          "runtime.extensions.setUsage",
          Effect.gen(function* () {
            const runtime = yield* Runtime;
            return yield* runtime.extensions.setUsage(input);
          }),
          options,
        ),
      revertUsage: (input, options) =>
        run(
          "runtime.extensions.revertUsage",
          Effect.gen(function* () {
            const runtime = yield* Runtime;
            return yield* runtime.extensions.revertUsage(input);
          }),
          options,
        ),
      create: (input, options) =>
        run(
          "runtime.extensions.create",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.create",
              decodeUnknownCreateExtensionSourceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .create(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.create",
                    decodeUnknownCreateExtensionSourceResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      duplicate: (input, options) =>
        run(
          "runtime.extensions.duplicate",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.duplicate",
              decodeUnknownDuplicateExtensionSourceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .duplicate(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.duplicate",
                    decodeUnknownDuplicateExtensionSourceResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      delete: (input, options) =>
        run(
          "runtime.extensions.delete",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.delete",
              decodeUnknownDeleteExtensionSourceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .delete(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.delete",
                    decodeUnknownDeleteExtensionSourceResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      reset: (input, options) =>
        run(
          "runtime.extensions.reset",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.reset",
              decodeUnknownResetExtensionInstructionsInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .reset(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.reset",
                    decodeUnknownRuntimeResetExtensionInstructionsResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      addInstruction: (input, options) =>
        run(
          "runtime.extensions.addInstruction",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.addInstruction",
              decodeUnknownAddExtensionInstructionInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .addInstruction(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.addInstruction",
                    decodeUnknownAddExtensionInstructionResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      removeInstruction: (input, options) =>
        run(
          "runtime.extensions.removeInstruction",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.removeInstruction",
              decodeUnknownRemoveExtensionInstructionInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .removeInstruction(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.removeInstruction",
                    decodeUnknownRemoveExtensionInstructionResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      configureInstruction: (input, options) =>
        run(
          "runtime.extensions.configureInstruction",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.configureInstruction",
              decodeUnknownConfigureExtensionInstructionInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .configureInstruction(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.configureInstruction",
                    decodeUnknownConfigureExtensionInstructionResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      renameInstruction: (input, options) =>
        run(
          "runtime.extensions.renameInstruction",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.renameInstruction",
              decodeUnknownRenameExtensionInstructionInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .renameInstruction(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.renameInstruction",
                    decodeUnknownRenameExtensionInstructionResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      reorderInstructions: (input, options) =>
        run(
          "runtime.extensions.reorderInstructions",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.reorderInstructions",
              decodeUnknownReorderExtensionInstructionsInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .reorderInstructions(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.reorderInstructions",
                    decodeUnknownReorderExtensionInstructionsResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      revertMutation: (input, options) =>
        run(
          "runtime.extensions.revertMutation",
          Effect.gen(function* () {
            const decoded = yield* decodeBoundary(
              "runtime.extensions.revertMutation",
              decodeUnknownRevertExtensionSourceMutationInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            return yield* runtime.extensions
              .revertMutation(decoded)
              .pipe(
                Effect.flatMap((result) =>
                  decodeBoundary(
                    "runtime.extensions.revertMutation",
                    decodeUnknownRuntimeRevertExtensionSourceMutationResultEffect,
                    result,
                  ),
                ),
              );
          }),
          options,
        ),
      build: (input, options) =>
        run(
          "runtime.extensions.build",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.extensions.build",
              decodeUnknownBuildRuntimeExtensionInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.extensions.build(decodedInput);
            return yield* decodeBoundary(
              "runtime.extensions.build",
              decodeUnknownBuildRuntimeExtensionResultEffect,
              result,
            );
          }),
          options,
          { allowRuntimeCancel: true },
        ),
      snapshots: {
        list: (input, options) =>
          run(
            "runtime.extensions.snapshots.list",
            Effect.gen(function* () {
              const decoded = yield* decodeBoundary(
                "runtime.extensions.snapshots.list",
                RuntimeListExtensionSnapshotsInputCodecs.decodeEffect,
                input,
              );
              const runtime = yield* Runtime;
              return yield* runtime.extensions.snapshots
                .list(decoded)
                .pipe(
                  Effect.flatMap((result) =>
                    decodeBoundary(
                      "runtime.extensions.snapshots.list",
                      ExtensionSnapshotsReadModelCodecs.decodeEffect,
                      result,
                    ),
                  ),
                );
            }),
            options,
          ),
        save: (input, options) =>
          run(
            "runtime.extensions.snapshots.save",
            Effect.gen(function* () {
              const decoded = yield* decodeBoundary(
                "runtime.extensions.snapshots.save",
                RuntimeSaveExtensionSnapshotInputCodecs.decodeEffect,
                input,
              );
              const runtime = yield* Runtime;
              return yield* runtime.extensions.snapshots
                .save(decoded)
                .pipe(
                  Effect.flatMap((result) =>
                    decodeBoundary(
                      "runtime.extensions.snapshots.save",
                      ExtensionSnapshotSummaryCodecs.decodeEffect,
                      result,
                    ),
                  ),
                );
            }),
            options,
          ),
        rename: (input, options) =>
          run(
            "runtime.extensions.snapshots.rename",
            Effect.gen(function* () {
              const decoded = yield* decodeBoundary(
                "runtime.extensions.snapshots.rename",
                RuntimeRenameExtensionSnapshotInputCodecs.decodeEffect,
                input,
              );
              const runtime = yield* Runtime;
              return yield* runtime.extensions.snapshots
                .rename(decoded)
                .pipe(
                  Effect.flatMap((result) =>
                    decodeBoundary(
                      "runtime.extensions.snapshots.rename",
                      ExtensionSnapshotSummaryCodecs.decodeEffect,
                      result,
                    ),
                  ),
                );
            }),
            options,
          ),
        delete: (input, options) =>
          run(
            "runtime.extensions.snapshots.delete",
            Effect.gen(function* () {
              const decoded = yield* decodeBoundary(
                "runtime.extensions.snapshots.delete",
                RuntimeDeleteExtensionSnapshotInputCodecs.decodeEffect,
                input,
              );
              const runtime = yield* Runtime;
              return yield* runtime.extensions.snapshots
                .delete(decoded)
                .pipe(
                  Effect.flatMap((result) =>
                    decodeBoundary(
                      "runtime.extensions.snapshots.delete",
                      RuntimeDeleteExtensionSnapshotResultCodecs.decodeEffect,
                      result,
                    ),
                  ),
                );
            }),
            options,
          ),
        load: (input, options) =>
          run(
            "runtime.extensions.snapshots.load",
            Effect.gen(function* () {
              const decoded = yield* decodeBoundary(
                "runtime.extensions.snapshots.load",
                RuntimeLoadExtensionSnapshotInputCodecs.decodeEffect,
                input,
              );
              const runtime = yield* Runtime;
              return yield* runtime.extensions.snapshots
                .load(decoded)
                .pipe(
                  Effect.flatMap((result) =>
                    decodeBoundary(
                      "runtime.extensions.snapshots.load",
                      RuntimeLoadExtensionSnapshotResultCodecs.decodeEffect,
                      result,
                    ),
                  ),
                );
            }),
            options,
          ),
      },
    },
    sourceEdits: {
      configureTypescriptApi: (input, options) =>
        run(
          "runtime.sourceEdits.configureTypescriptApi",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceEdits.configureTypescriptApi",
              decodeUnknownConfigureExtensionTypescriptApiInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceEdits.configureTypescriptApi(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceEdits.configureTypescriptApi",
              decodeUnknownConfigureExtensionTypescriptApiResultEffect,
              result,
            );
          }),
          options,
        ),
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
              decodeUnknownRuntimeSaveExtensionSourceEditInputEffect,
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
      createWorkflowAgent: (input, options) =>
        run(
          "runtime.sourceEdits.createWorkflowAgent",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceEdits.createWorkflowAgent",
              decodeUnknownRuntimeCreateWorkflowAgentSourceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceEdits.createWorkflowAgent(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceEdits.createWorkflowAgent",
              decodeUnknownWorkflowAgentSourceLifecycleResultEffect,
              result,
            );
          }),
          options,
        ),
      duplicateWorkflowAgent: (input, options) =>
        run(
          "runtime.sourceEdits.duplicateWorkflowAgent",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceEdits.duplicateWorkflowAgent",
              decodeUnknownRuntimeDuplicateWorkflowAgentSourceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceEdits.duplicateWorkflowAgent(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceEdits.duplicateWorkflowAgent",
              decodeUnknownWorkflowAgentSourceLifecycleResultEffect,
              result,
            );
          }),
          options,
        ),
      deleteWorkflowAgent: (input, options) =>
        run(
          "runtime.sourceEdits.deleteWorkflowAgent",
          Effect.gen(function* () {
            const decodedInput = yield* decodeBoundary(
              "runtime.sourceEdits.deleteWorkflowAgent",
              decodeUnknownRuntimeDeleteWorkflowAgentSourceInputEffect,
              input,
            );
            const runtime = yield* Runtime;
            const result = yield* runtime.sourceEdits.deleteWorkflowAgent(decodedInput);
            return yield* decodeBoundary(
              "runtime.sourceEdits.deleteWorkflowAgent",
              decodeUnknownWorkflowAgentSourceDeleteResultEffect,
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
