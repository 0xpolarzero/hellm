/**
 * Exhaustive feature inventory for the product delta over stock `pi`.
 *
 * This file is meant to drive test planning. It includes:
 * - product features built on top of `pi`
 * - Smithers-backed delegated workflow features
 * - deferred-but-positive features explicitly called out in the PRD
 *
 * It intentionally excludes:
 * - pure baseline `pi` capabilities we are keeping unchanged
 * - explicit non-goals and rejected directions from the PRD
 */
export enum HellmFeature {
  // Orchestrator and context loading
  MainOrchestrator = "orchestrator.main",
  StructuredStateFirstDecisioning = "orchestrator.structuredStateFirstDecisioning",
  AdaptiveTaskDecomposition = "orchestrator.adaptiveTaskDecomposition",
  RequestClassification = "orchestrator.requestClassification",
  PathRouting = "orchestrator.pathRouting",
  BoundedWorkerDispatch = "orchestrator.boundedWorkerDispatch",
  ReconciliationLoop = "orchestrator.reconciliationLoop",
  ReenterAfterEveryEpisode = "orchestrator.reenterAfterEveryEpisode",
  CompletionDecisioning = "orchestrator.completionDecisioning",
  EpisodeReuseAsInputs = "orchestrator.episodeReuseAsInputs",
  BlockedWaitingStateTracking = "orchestrator.blockedWaitingStateTracking",
  VisibleOrchestratorState = "orchestrator.visibleState",
  ContextLoadingSessionHistory = "context.sessionHistory",
  ContextLoadingRepoAndWorktree = "context.repoAndWorktree",
  ContextLoadingAgentsInstructions = "context.agentsInstructions",
  ContextLoadingRelevantSkills = "context.relevantSkills",
  ContextLoadingPriorEpisodesAndArtifacts = "context.priorEpisodesAndArtifacts",

  // Product state and persistence
  PiSessionBackedTopLevelState = "state.piSessionBackedTopLevelState",
  ThreadModel = "state.threadModel",
  ThreadStatusLifecycle = "state.threadStatusLifecycle",
  ThreadWorktreeBinding = "state.threadWorktreeBinding",
  EpisodeModel = "state.episodeModel",
  EpisodeArtifactReferences = "state.episodeArtifactReferences",
  EpisodeVerificationRecords = "state.episodeVerificationRecords",
  EpisodeUnresolvedIssues = "state.episodeUnresolvedIssues",
  EpisodeFollowUpSuggestions = "state.episodeFollowUpSuggestions",
  EpisodeProvenance = "state.episodeProvenance",
  ArtifactModel = "state.artifactModel",
  FileAddressableArtifacts = "state.fileAddressableArtifacts",
  StructuredSessionEntries = "state.structuredSessionEntries",
  SessionBackedStateReconstruction = "state.sessionBackedStateReconstruction",
  GlobalVerificationState = "state.globalVerificationState",
  SessionWorktreeAlignment = "state.sessionWorktreeAlignment",
  WorktreeAwareRuntimeTransitions = "state.worktreeAwareRuntimeTransitions",
  WorkflowRunReferences = "state.workflowRunReferences",
  SmithersStateIsolation = "state.smithersStateIsolation",

  // Execution paths
  DirectExecutionPath = "path.direct",
  SmithersWorkflowExecutionPath = "path.smithersWorkflow",
  SmithersDefaultDelegatedPath = "path.smithersWorkflow.defaultDelegatedPath",
  SingleSubagentWorkflowPath = "path.smithersWorkflow.singleSubagentPath",
  VerificationExecutionPath = "path.verification",
  ApprovalClarificationExecutionPath = "path.approvalClarification",
  DirectPathEpisodeNormalization = "path.direct.episodeNormalization",
  SmithersWorkflowEpisodeNormalization = "path.smithersWorkflow.episodeNormalization",
  VerificationEpisodeNormalization = "path.verification.episodeNormalization",
  RawPiExecutionPrimitive = "path.internal.rawPiExecutionPrimitive",
  CodeModeExecutionPrimitive = "path.internal.codeModeExecutionPrimitive",
  CodeModeTanStackStyleContract = "path.internal.codeModeExecutionPrimitive.tanstackStyleContract",
  CodeModeQuickJsRuntime = "path.internal.codeModeExecutionPrimitive.quickjsRuntime",
  CodeModeFlatExternalCapabilities = "path.internal.codeModeExecutionPrimitive.flatExternalCapabilities",
  CodeModeGeneratedTypeStubs = "path.internal.codeModeExecutionPrimitive.generatedTypeStubs",
  CodeModeExecutionEvents = "path.internal.codeModeExecutionPrimitive.executionEvents",
  DirectPathCodeModeUse = "path.direct.codeMode",
  SmithersWorkflowCodeModeUse = "path.smithersWorkflow.codeMode",

  // Smithers-backed delegated workflow features
  ProgrammaticSmithersRunAdapter = "smithers.programmaticRunAdapter",
  DynamicWorkflowAuthoring = "smithers.dynamicWorkflowAuthoring",
  SubagentToWorkflowMapping = "smithers.subagentToWorkflowMapping",
  DurableWorkflowResume = "smithers.durableWorkflowResume",
  WorkflowApprovalGates = "smithers.workflowApprovalGates",
  WorkflowWaitingStateIntegration = "smithers.workflowWaitingStateIntegration",
  WorkflowLoopRetryExecution = "smithers.workflowLoopRetryExecution",
  WorktreeIsolatedWorkflowExecution = "smithers.worktreeIsolatedWorkflowExecution",
  TypedWorkflowOutputs = "smithers.typedWorkflowOutputs",
  PiAgentTasksInsideSmithers = "smithers.piAgentTasksInsideSmithers",
  PiAgentTaskScopedContext = "smithers.piAgentTaskScopedContext",
  PiAgentTaskToolScoping = "smithers.piAgentTaskToolScoping",
  PiAgentTaskCompletionConditions = "smithers.piAgentTaskCompletionConditions",
  SmithersToEpisodeTranslation = "smithers.toEpisodeTranslation",

  // Verification subsystem
  BuildVerification = "verification.build",
  TestVerification = "verification.test",
  LintVerification = "verification.lint",
  ManualVerification = "verification.manual",
  IntegrationVerification = "verification.integration",
  VerificationArtifacts = "verification.artifacts",
  VerificationAwareReconciliation = "verification.awareReconciliation",

  // Orchestration-aware TUI
  OrchestrationAwareTui = "ui.orchestrationAwareTui",
  OrchestratorStateProjection = "ui.orchestratorStateProjection",
  ThreadsPane = "ui.threadsPane",
  EpisodeInspector = "ui.episodeInspector",
  VerificationPanel = "ui.verificationPanel",
  SessionWorktreeIndicator = "ui.sessionWorktreeIndicator",
  WorkflowActivityView = "ui.workflowActivityView",
  WorkstreamStatusVisibility = "ui.workstreamStatusVisibility",
  LatestEpisodesView = "ui.latestEpisodesView",
  BlockedWaitingVisibility = "ui.blockedWaitingVisibility",
  WorkflowProgressVisualization = "ui.workflowProgressVisualization",

  // Headless and automation surfaces
  HeadlessOneShotExecution = "headless.oneShotExecution",
  StructuredWorkflowSeedInput = "headless.structuredWorkflowSeedInput",
  WorkflowSeedInputSemantics = "headless.workflowSeedInputSemantics",
  StructuredHeadlessOutput = "headless.structuredHeadlessOutput",
  JsonlEventOutput = "headless.jsonlEventOutput",
  AutomationFriendlyExecution = "headless.automationFriendlyExecution",
  SharedOrchestratorAcrossEntrySurfaces = "headless.sharedOrchestratorAcrossEntrySurfaces",
  WholeProductServerMode = "headless.wholeProductServerMode",

  // Advanced and deferred features
  SafeParallelIndependentWork = "advanced.safeParallelIndependentWork",
  StaleResultHandling = "advanced.staleResultHandling",
  ExplicitWriteScopeRules = "advanced.explicitWriteScopeRules",
  RicherWorktreeUx = "advanced.richerWorktreeUx",
  AdvancedWorktreeSwitchingUx = "advanced.advancedWorktreeSwitchingUx",
  BroadMultiSlotModelRouting = "advanced.broadMultiSlotModelRouting",
  RichSlashCommandSurface = "advanced.richSlashCommandSurface",
  SecondaryStorageBackends = "advanced.secondaryStorageBackends",
  RicherRemoteAttachmentPatterns = "advanced.richerRemoteAttachmentPatterns",
}

export const ALL_HELLM_FEATURES = Object.values(HellmFeature);
