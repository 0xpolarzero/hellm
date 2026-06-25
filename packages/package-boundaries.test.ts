import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "bun:test";
import * as ts from "typescript";
import { PRODUCT_FEATURES } from "../docs/features";
import {
  adoptedEffectRuntimeModuleExports,
  adoptedEffectTypeOnlyModules,
} from "./effect-adoption-manifest";
import { renderGeneratedExtensionsPackageFiles } from "./extensions/src/generated-extensions-package";

const projectRoot = join(import.meta.dir, "..");
const packageRoot = join(projectRoot, "packages");
const implementationPackageRoots = [
  join(packageRoot, "core", "src"),
  join(packageRoot, "state", "src"),
  join(packageRoot, "pi-adapter", "src"),
  join(packageRoot, "sandbox", "src"),
  join(packageRoot, "extensions", "src"),
  join(packageRoot, "runtime", "src"),
];
const edgePackageRoots = [join(packageRoot, "desktop", "src")];
const sourceRoots = [...implementationPackageRoots, ...edgePackageRoots];
const appSourceRoot = join(projectRoot, "src");
const sharedSourceRoot = join(projectRoot, "src", "shared");
const productSpecRoot = join(projectRoot, "docs", "specs");
const packageArchitectureSpecRoot = join(projectRoot, "docs", "specs", "package-architecture");
const migratedNativeToolModules = [
  join(projectRoot, "src", "bun", "execute-typescript-tool.ts"),
  join(projectRoot, "src", "bun", "extension-tools.ts"),
  join(projectRoot, "src", "bun", "request-user-input-tool.ts"),
  join(projectRoot, "src", "bun", "runtime-state-tools.ts"),
  join(projectRoot, "src", "bun", "svvy-direct-tools.ts"),
  join(projectRoot, "src", "bun", "thread-report-tool.ts"),
  join(projectRoot, "src", "bun", "thread-orchestration-tools.ts"),
  join(projectRoot, "src", "bun", "thread-start-tool.ts"),
];
const runtimeServiceAdapterModule = join(projectRoot, "src", "bun", "runtime-service-adapter.ts");
const sessionCatalogModule = join(projectRoot, "src", "bun", "session-catalog.ts");
const expectedLegacySandboxRootExportSymbols = [
  "DirectToolLaunchPolicyInput",
  "ExecuteTypescriptLaunchPolicyInput",
  "SandboxApprovalMode",
  "SandboxLaunchPolicy",
  "SandboxSettingsInput",
  "SvvyxLaunchPolicyInput",
  "buildDirectToolLaunchPolicy",
  "buildExecuteTypescriptLaunchPolicy",
  "buildSandboxHelperArgs",
  "buildSvvyxLaunchPolicy",
  "isSandboxDenialOutput",
  "isSandboxHelperBootstrapFailure",
  "resolveSandboxLaunchSettings",
  "resolveSandboxHelperPath",
  "sandboxDenialFacts",
  "sandboxLaunchFacts",
];
const expectedLegacySandboxAppImports = [
  "src/bun/execute-typescript-tool.ts -> @svvy/sandbox",
  "src/bun/svvy-direct-tools.ts -> @svvy/sandbox",
];

const IMPORT_PATTERN =
  /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|export\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const expectedPackageDependencies = new Map<string, string[]>([
  ["@svvy/core", ["effect"]],
  ["@svvy/state", ["@svvy/core", "effect"]],
  ["@svvy/sandbox", ["@svvy/core", "effect"]],
  [
    "@svvy/pi-adapter",
    ["@mariozechner/pi-ai", "@mariozechner/pi-coding-agent", "@svvy/core", "effect"],
  ],
  ["@svvy/extensions", ["@svvy/core", "effect"]],
  [
    "@svvy/runtime",
    [
      "@svvy/core",
      "@svvy/extensions",
      "@svvy/pi-adapter",
      "@svvy/sandbox",
      "@effect/platform-bun",
      "effect",
    ],
  ],
  ["@svvy/desktop", ["@svvy/core", "@svvy/runtime", "@svvy/state", "effect"]],
]);
const expectedPackageDependencySpecifiers = new Map<string, Record<string, string>>([
  ["@svvy/core", { effect: "4.0.0-beta.84" }],
  ["@svvy/state", { "@svvy/core": "workspace:*", effect: "4.0.0-beta.84" }],
  ["@svvy/sandbox", { "@svvy/core": "workspace:*", effect: "4.0.0-beta.84" }],
  [
    "@svvy/pi-adapter",
    {
      "@mariozechner/pi-ai": "0.73.1",
      "@mariozechner/pi-coding-agent": "0.73.1",
      "@svvy/core": "workspace:*",
      effect: "4.0.0-beta.84",
    },
  ],
  ["@svvy/extensions", { "@svvy/core": "workspace:*", effect: "4.0.0-beta.84" }],
  [
    "@svvy/runtime",
    {
      "@effect/platform-bun": "4.0.0-beta.84",
      "@svvy/core": "workspace:*",
      "@svvy/extensions": "workspace:*",
      "@svvy/pi-adapter": "workspace:*",
      "@svvy/sandbox": "workspace:*",
      effect: "4.0.0-beta.84",
    },
  ],
  [
    "@svvy/desktop",
    {
      "@svvy/core": "workspace:*",
      "@svvy/runtime": "workspace:*",
      "@svvy/state": "workspace:*",
      effect: "4.0.0-beta.84",
    },
  ],
]);
const forbiddenPackageManifestFields = [
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "bundleDependencies",
  "dependenciesMeta",
  "overrides",
  "resolutions",
  "trustedDependencies",
  "scripts",
  "bin",
  "main",
  "module",
  "types",
  "typesVersions",
  "imports",
  "files",
  "publishConfig",
  "workspaces",
  "packageManager",
];
const rejectedPublicPackageNames = [
  "@svvy/contracts",
  "@svvy/pi-host",
  "@svvy/tools",
  "@svvy/request-input",
  "@svvy/threading",
  "@svvy/workflows",
  "@svvy/workflow-library",
  "@svvy/artifacts",
  "@svvy/snippets",
  "@svvy/logs",
  "@svvy/observability",
  "@svvy/settings",
  "@svvy/workspaces",
  "@svvy/prompts",
  "@svvy/agent-context",
  "@svvy/extension-library",
  "@svvy/smithers",
];

const expectedPackageDirectories = [
  "core",
  "desktop",
  "extensions",
  "pi-adapter",
  "runtime",
  "sandbox",
  "state",
];
const expectedPackageArchitectureSpecFiles = [
  "core.spec.md",
  "desktop.spec.md",
  "effect-v4.spec.md",
  "extensions.spec.md",
  "generated-packages.spec.md",
  "package-architecture.spec.md",
  "pi-adapter.spec.md",
  "runtime.spec.md",
  "sandbox.spec.md",
  "state.spec.md",
];
const expectedPackageArchitectureSourceSpecs = [
  "docs/prd.md",
  "docs/specs/package-architecture/package-architecture.spec.md",
  "docs/specs/package-architecture/effect-v4.spec.md",
  "docs/specs/package-architecture/core.spec.md",
  "docs/specs/package-architecture/state.spec.md",
  "docs/specs/package-architecture/sandbox.spec.md",
  "docs/specs/package-architecture/pi-adapter.spec.md",
  "docs/specs/package-architecture/extensions.spec.md",
  "docs/specs/package-architecture/runtime.spec.md",
  "docs/specs/package-architecture/desktop.spec.md",
  "docs/specs/package-architecture/generated-packages.spec.md",
];
const expectedPublicExports = new Map<string, Record<string, string>>([
  [
    "@svvy/pi-adapter",
    {
      ".": "./src/index.ts",
      "./messages": "./src/messages.ts",
      "./internal/session": "./src/session.ts",
    },
  ],
  [
    "@svvy/state",
    {
      ".": "./src/index.ts",
      "./session-navigation": "./src/session-navigation.ts",
      "./structured-session-selectors": "./src/structured-session-selectors.ts",
      "./structured-session-state": "./src/structured-session-state.ts",
    },
  ],
  [
    "@svvy/runtime",
    {
      ".": "./src/index.ts",
      "./bootstrap": "./src/bootstrap.ts",
    },
  ],
]);
const expectedPiAdapterInternalPiRuntimeExports = new Map<string, string>([
  ["@svvy/pi-adapter/internal/session", join(packageRoot, "pi-adapter", "src", "session.ts")],
]);
const expectedPublicSymbols = new Map<string, string[]>([
  [
    "@svvy/core",
    [
      "AbortPromptInput",
      "AbortPromptInputSchema",
      "AbortActiveTurnPromptInputSchema",
      "AbortAllForSurfacePromptInputSchema",
      "AbortQueuedPromptInputSchema",
      "AbsolutePath",
      "NonNegativeSafeInteger",
      "NonNegativeSafeIntegerSchema",
      "ActorKind",
      "ActorKindSchema",
      "AgentProfileId",
      "BuildLaunchPolicyInput",
      "BuildLaunchPolicyInputSchema",
      "AnswerRequestInputInput",
      "AnswerRequestInputInputSchema",
      "AnswerRequestInputDeliveryResultSchema",
      "AnswerRequestInputResult",
      "AnswerRequestInputResultSchema",
      "AppendAppLogInput",
      "AppendAppLogInputSchema",
      "AppLogWriteResult",
      "AppLogWriteResultSchema",
      "AppLogWriteResultValue",
      "AppLogWriteResultValueSchema",
      "AppLogCounts",
      "AppLogCountsSchema",
      "AppLogEntry",
      "AppLogEntryId",
      "AppLogEntrySchema",
      "AppLogError",
      "AppLogErrorSchema",
      "decodeUnknownAppLogErrorEffect",
      "decodeUnknownAppLogErrorExit",
      "encodeAppLogErrorEffect",
      "encodeAppLogErrorExit",
      "AppLogLevel",
      "AppLogLevelSchema",
      "AppLogQuery",
      "AppLogQuerySchema",
      "AppLogReadModel",
      "AppLogReadModelSchema",
      "AppLogRelatedLink",
      "AppLogRelatedLinkSchema",
      "AppLogSource",
      "AppLogSourceSchema",
      "AppLogSummary",
      "AppLogSummarySchema",
      "AppLogUpdateMessage",
      "AppLogUpdateMessageSchema",
      "AppLogWritePort",
      "AppLogWritePortService",
      "SvvyObservationAnnotation",
      "SvvyObservationAnnotationSchema",
      "SvvyObservationOperation",
      "SvvyObservationOperationSchema",
      "SvvyObservationPackage",
      "SvvyObservationPackageSchema",
      "SvvyObservationReasonClass",
      "SvvyObservationReasonClassSchema",
      "AppReadModelInvalidation",
      "AppReadModelInvalidationSchema",
      "AcquireDefaultWorkspaceInput",
      "AcquireDefaultWorkspaceInputSchema",
      "AcquireDefaultWorkspaceOpenReason",
      "AcquireDefaultWorkspaceOpenReasonSchema",
      "AcquireWorkspaceInput",
      "AcquireWorkspaceInputSchema",
      "AcquireWorkspaceOpenReason",
      "AcquireWorkspaceOpenReasonSchema",
      "AcquireWorkspaceResult",
      "AcquireWorkspaceResultSchema",
      "WorkspaceReadinessDetail",
      "WorkspaceReadinessDetailSchema",
      "WorkspaceReadinessDisabledCapability",
      "WorkspaceReadinessDisabledCapabilitySchema",
      "AnswerRuntimeApprovalInput",
      "AnswerRuntimeApprovalInputSchema",
      "AnswerRuntimeApprovalResult",
      "AnswerRuntimeApprovalResultSchema",
      "ArtifactId",
      "ArtifactMaterializationStatus",
      "ArtifactMaterializationStatusSchema",
      "ArtifactMetadataRecord",
      "ArtifactMetadataRecordSchema",
      "CreateRuntimeArtifactInput",
      "CreateRuntimeArtifactInputSchema",
      "DeleteRuntimeArtifactInput",
      "DeleteRuntimeArtifactInputSchema",
      "InspectRuntimeArtifactInput",
      "InspectRuntimeArtifactInputSchema",
      "ListRuntimeArtifactsInput",
      "ListRuntimeArtifactsInputSchema",
      "BoundaryIssue",
      "BoundaryIssueSchema",
      "boundarySchemaErrorDetails",
      "strictBoundaryParseOptions",
      "CONTEXT_BUDGET_ORANGE_PERCENT",
      "CONTEXT_BUDGET_RED_PERCENT",
      "CancelCommandInput",
      "CancelCommandInputSchema",
      "CancelCommandResult",
      "CancelCommandResultSchema",
      "ChildProcessCommandExecutionPlan",
      "ChildProcessCommandExecutionPlanSchema",
      "CommandEventId",
      "CommandEventPayload",
      "CommandFactsPayload",
      "CommandFactsPayloadSchema",
      "CommandId",
      "CommandResultEnvelope",
      "CommandResultEnvelopeSchema",
      "COMPOSER_ATTACHMENT_TEXT_SIGNATURE_PREFIX",
      "ComposerAttachment",
      "ComposerAttachmentKind",
      "ComposerAttachmentKindSchema",
      "ComposerAttachmentSchema",
      "ComposerSnippetMention",
      "ComposerSnippetMentionSchema",
      "composerAttachmentPromptText",
      "ContextBudget",
      "ContextBudgetSchema",
      "ContextBudgetTone",
      "ContextBudgetToneSchema",
      "ClosePiSessionInput",
      "ClosePiSessionInputSchema",
      "CloseSurfaceInput",
      "CloseSurfaceInputSchema",
      "CloseSurfaceReason",
      "CloseSurfaceReasonSchema",
      "CloseSurfaceResult",
      "CloseSurfaceResultSchema",
      "CreatePiSessionInput",
      "CreatePiSessionInputSchema",
      "CreateOrchestratorSurfaceInput",
      "CreateOrchestratorSurfaceInputSchema",
      "CreateOrReuseStreamingRuntimeCommandInput",
      "CreateOrReuseStreamingRuntimeCommandInputSchema",
      "CreateRequestInputRequest",
      "CreateRequestInputRequestSchema",
      "CreateRuntimeCommandInput",
      "CreateRuntimeCommandInputSchema",
      "CreateRuntimeRequestInputInput",
      "CreateRuntimeRequestInputInputSchema",
      "CreateSurfaceResult",
      "CreateSurfaceResultSchema",
      "DeletePiSessionReferenceInput",
      "DeletePiSessionReferenceInputSchema",
      "EpisodeId",
      "ExecutionPlanOperation",
      "ExecutionPlanOperationSchema",
      "ExtensionCategory",
      "ExtensionCategorySchema",
      "ExtensionExecutionCommandDescription",
      "ExtensionExecutionCommandDescriptionSchema",
      "ExtensionExecutionEnvPlan",
      "ExtensionExecutionEnvPlanSchema",
      "ExtensionExecutionPlan",
      "ExtensionExecutionPlanId",
      "ExtensionExecutionPlanSchema",
      "ExtensionDependencyApprovalIdentity",
      "ExtensionDependencyReadiness",
      "ExtensionDependencyReadinessSchema",
      "ExtensionDependencyReadinessStatus",
      "ExtensionDependencyReadinessStatusSchema",
      "ExtensionError",
      "decodeUnknownExtensionErrorEffect",
      "decodeUnknownExtensionErrorExit",
      "encodeExtensionErrorEffect",
      "encodeExtensionErrorExit",
      "ExtensionHandlerResult",
      "ExtensionHandlerResultSchema",
      "ExtensionRuntimeOperation",
      "ExtensionRuntimeOperationSchema",
      "ExtensionId",
      "ExtensionInterfaceKind",
      "ExtensionInterfaceKindSchema",
      "ExtensionSourceKind",
      "ExtensionSourceKindSchema",
      "ExtensionStatePort",
      "ExtensionStatePortService",
      "ExtensionUsageState",
      "ExtensionUsageStateSchema",
      "ExternalInstructionSourceId",
      "EnvironmentFact",
      "EnvironmentFactSchema",
      "FileSystemSandboxPolicy",
      "FileSystemSandboxPolicyEntry",
      "FileSystemSandboxPolicyEntrySchema",
      "FileSystemSandboxPolicySchema",
      "FileEffectApplyPatchExecutionPlan",
      "FileEffectApplyPatchExecutionPlanSchema",
      "formatBoundaryIssues",
      "normalizeBoundaryIssuePath",
      "ClearRuntimeSessionWaitInput",
      "ClearRuntimeSessionWaitInputSchema",
      "CreateRuntimeApprovalRequestInput",
      "CreateRuntimeApprovalRequestInputSchema",
      "FindRuntimeCommandByIdInput",
      "FindRuntimeCommandByIdInputSchema",
      "FindRuntimeCommandByToolCallIdInput",
      "FindRuntimeCommandByToolCallIdInputSchema",
      "FinishRuntimeCommandInput",
      "FinishRuntimeCommandInputSchema",
      "ForkPiHistoryEntryInput",
      "ForkPiHistoryEntryInputSchema",
      "GenerateTitleInput",
      "GenerateTitleInputSchema",
      "GenerateTitleResult",
      "GenerateTitleResultSchema",
      "GeneratedContextFingerprint",
      "GeneratedContextRevision",
      "GeneratedPackageBuildId",
      "GeneratedPackageBuildInput",
      "GeneratedPackageBuildInputSchema",
      "GeneratedPackageBuildPlanResult",
      "GeneratedPackageBuildPlanResultSchema",
      "GeneratedPackageName",
      "GeneratedPackageNameSchema",
      "HasRuntimeCommandOutputEventInput",
      "HasRuntimeCommandOutputEventInputSchema",
      "HandlerInheritedHistoryBlock",
      "HandlerInheritedHistoryBlockSchema",
      "HandlerPromptTargetSchema",
      "HandlerThreadInitialQueueInput",
      "HandlerThreadInitialQueueInputSchema",
      "InitialHandlerStartQueuePayloadSchema",
      "InsertQueueItemRequest",
      "InsertQueueItemRequestSchema",
      "MessageId",
      "ModelId",
      "ModelInfo",
      "ModelInfoSchema",
      "ModelSelection",
      "ModelSelectionSchema",
      "NativeToolContent",
      "NativeToolContentSchema",
      "NativeToolDeclaration",
      "NativeToolExecutionInput",
      "NativeToolExecutor",
      "NativeToolExtensionSchema",
      "NativeToolImageContent",
      "NativeToolImageContentSchema",
      "NativeToolResult",
      "NativeToolResultSchema",
      "NativeToolSchema",
      "NativeToolSchemaExtension",
      "NativeToolSchemasDocument",
      "NativeToolTextContent",
      "NativeToolTextContentSchema",
      "NativeToolUpdateHandler",
      "InterruptPiTurnInput",
      "InterruptPiTurnInputSchema",
      "OpenPiSessionInput",
      "OpenPiSessionInputSchema",
      "OpenExtensionSourceEditInput",
      "OpenExtensionSourceEditInputSchema",
      "OpenSurfaceInput",
      "OpenSurfaceInputSchema",
      "OpenSurfaceResult",
      "OpenSurfaceResultSchema",
      "OrchestratorPromptTargetSchema",
      "PromptExecutionContext",
      "PromptExecutionEpisodeKind",
      "PromptExecutionExternalInstructionSource",
      "PromptExecutionRuntimeHandle",
      "PromptExecutionSurfaceKind",
      "createPromptExecutionContext",
      "PiAmbientPiResourceEnablement",
      "PiAmbientPiResourceEnablementSchema",
      "PiAmbientPiResourceKind",
      "PiAmbientPiResourceKindSchema",
      "PiAdapterError",
      "decodeUnknownPiAdapterErrorEffect",
      "decodeUnknownPiAdapterErrorExit",
      "encodePiAdapterErrorEffect",
      "encodePiAdapterErrorExit",
      "PiHistoryEntryRef",
      "PiHistoryEntryRefSchema",
      "PiRuntimeEvent",
      "PiRuntimeEventSchema",
      "PiRuntimePathsPort",
      "PiRuntimePathsPortService",
      "PiRuntimePathsSnapshot",
      "PiRuntimePathsSnapshotSchema",
      "PiSessionRef",
      "PiSessionRefSchema",
      "PiSessionReference",
      "PiSessionReferencePort",
      "PiSessionReferencePortError",
      "decodeUnknownPiSessionReferencePortErrorEffect",
      "decodeUnknownPiSessionReferencePortErrorExit",
      "encodePiSessionReferencePortErrorEffect",
      "encodePiSessionReferencePortErrorExit",
      "PiSessionReferencePortService",
      "PiSessionReferencePublic",
      "PiSessionReferencePublicSchema",
      "PiSessionReferenceSchema",
      "PiSessionReferenceValidation",
      "PiSessionReferenceValidationSchema",
      "PiSystemPromptBinding",
      "PiSystemPromptBindingSchema",
      "PiToolExecutionInput",
      "PiToolExecutionInputSchema",
      "PiToolExecutionUpdate",
      "PiToolExecutionUpdateSchema",
      "PiToolExecutor",
      "PromptTarget",
      "PromptTargetSchema",
      "ProviderAuthHealth",
      "ProviderAuthHealthSchema",
      "ProviderAuthPort",
      "ProviderAuthPortError",
      "decodeUnknownProviderAuthPortErrorEffect",
      "decodeUnknownProviderAuthPortErrorExit",
      "encodeProviderAuthPortErrorEffect",
      "encodeProviderAuthPortErrorExit",
      "ProviderAuthPortService",
      "ProviderAuthStatus",
      "ProviderAuthStatusStatePort",
      "ProviderAuthStatusStatePortService",
      "ProviderAuthStatusSchema",
      "ProviderCredentialSecret",
      "ProviderCredentialSecretSchema",
      "ProviderCredentialSnapshot",
      "ProviderCredentialSnapshotSchema",
      "ProviderUnusableCredentialSnapshot",
      "ProviderUnusableCredentialSnapshotSchema",
      "ProviderUsableCredentialSnapshot",
      "ProviderUsableCredentialSnapshotSchema",
      "ProviderId",
      "ProviderRefreshReason",
      "ProviderRefreshReasonSchema",
      "QueueItemId",
      "QueueItemPayload",
      "QueueItemPayloadSchema",
      "RUNTIME_TURN_DECISIONS",
      "ReasoningEffort",
      "ReasoningEffortSchema",
      "ReasoningSelection",
      "ReasoningSelectionSchema",
      "RecordEpisodeRequest",
      "RecordEpisodeRequestSchema",
      "RecoveryWorkId",
      "ReleaseWorkspaceInput",
      "ReleaseWorkspaceInputSchema",
      "ReleaseWorkspaceReason",
      "ReleaseWorkspaceReasonSchema",
      "ReleaseWorkspaceResult",
      "ReleaseWorkspaceResultSchema",
      "RefreshGeneratedContextRequest",
      "RefreshGeneratedContextReasonSchema",
      "RefreshGeneratedContextRequestSchema",
      "GeneratedPackageDependencyEvidence",
      "GeneratedPackageDependencyEvidenceSchema",
      "GeneratedPackageFileEvidence",
      "GeneratedPackageFileEvidenceSchema",
      "GeneratedPackageRefreshStatus",
      "GeneratedPackageRefreshStatusSchema",
      "GeneratedPackageWorkspaceLinkRepairInput",
      "GeneratedPackageWorkspaceLinkRepairInputSchema",
      "GeneratedPackageWorkspaceLinkRepairPlan",
      "GeneratedPackageWorkspaceLinkRepairPlanSchema",
      "GeneratedPackageWorkspaceLinkStatus",
      "GeneratedPackageWorkspaceLinkStatusSchema",
      "RefreshGeneratedPackagesRequest",
      "RefreshGeneratedPackagesRequestSchema",
      "GeneratedPackagesRefreshResult",
      "GeneratedPackagesRefreshResultSchema",
      "GetCurrentRuntimeThreadInput",
      "GetPiSessionReferenceInput",
      "GetPiSessionReferenceInputSchema",
      "GetProviderAuthSnapshotInput",
      "GetProviderAuthSnapshotInputSchema",
      "GetRuntimeThreadGroupInput",
      "GetSecretStatusInput",
      "ReportRequestQueuePayloadSchema",
      "InputModality",
      "InputModalitySchema",
      "IsoDateTimeString",
      "IsoDateTimeStringSchema",
      "JsonArray",
      "JsonObject",
      "JsonPrimitive",
      "JsonValue",
      "ListModelsInput",
      "ListSecretStatusInput",
      "ListModelsInputSchema",
      "ListProviderStatusesInput",
      "ListProviderStatusesInputSchema",
      "ListRuntimeThreadsInput",
      "MarkGeneratedPackageRefreshNeededInput",
      "MarkGeneratedPackageRefreshNeededInputSchema",
      "ReadGeneratedPackageFactsInput",
      "ReadGeneratedPackageFactsInputSchema",
      "ReadGeneratedPackageLinksNeedingRepairInput",
      "ReadGeneratedPackageLinksNeedingRepairInputSchema",
      "ReadRuntimeSourceVersionInput",
      "ReadRuntimeSourceVersionInputSchema",
      "ReadRuntimeThreadEpisodesInput",
      "RecordProviderAuthStatusInput",
      "RecordProviderAuthStatusInputSchema",
      "RequestInputAnswerId",
      "RequestInputChoiceOptionRequest",
      "RequestInputChoiceOptionRequestSchema",
      "RequestInputChoiceQuestionRequest",
      "RequestInputChoiceQuestionRequestSchema",
      "RequestInputFreeformQuestionRequest",
      "RequestInputFreeformQuestionRequestSchema",
      "RequestInputOptionId",
      "RequestInputQuestionId",
      "RequestInputQuestionRequest",
      "RequestInputQuestionRequestSchema",
      "RequestInputRequestId",
      "RequestProviderRefreshInput",
      "RequestProviderRefreshInputSchema",
      "RecordGeneratedPackageBuildInput",
      "RecordGeneratedPackageBuildInputSchema",
      "RecordGeneratedPackageFailureInput",
      "RecordGeneratedPackageFailureInputSchema",
      "RecordGeneratedPackageWorkspaceLinkInput",
      "RecordGeneratedPackageWorkspaceLinkInputSchema",
      "RecordRuntimeCommandEventInput",
      "RecordRuntimeCommandEventInputSchema",
      "RecordRuntimeCommandStdinWriteInput",
      "RecordRuntimeCommandStdinWriteInputSchema",
      "RecordRuntimeSourceDeleteInput",
      "RecordRuntimeSourceDeleteInputSchema",
      "RecordRuntimeSourceSaveInput",
      "RecordRuntimeSourceSaveInputSchema",
      "RequestUserInputAnswer",
      "RequestUserInputAnswerDeliveryPayload",
      "RequestUserInputAnswerDeliveryPayloadSchema",
      "RequestUserInputAnswerQueuePayload",
      "RequestUserInputAnswerQueuePayloadSchema",
      "RequestUserInputAnswerSchema",
      "RequestUserInputResolvedAnswer",
      "RequestUserInputResolvedAnswerSchema",
      "ResolvePiRuntimePathsInput",
      "ResolvePiRuntimePathsInputSchema",
      "ResolveSecretInvocationValueInput",
      "RestorePiHistoryEntryInput",
      "RestorePiHistoryEntryInputSchema",
      "RunExtensionDependencyActionInput",
      "RunExtensionDependencyActionInputSchema",
      "RunExtensionDependencyActionResult",
      "RunExtensionDependencyActionResultSchema",
      "RunPiTurnInput",
      "AuthenticatedRunTaskAgentInput",
      "AuthenticatedRunTaskAgentInputSchema",
      "RuntimeApprovalId",
      "RuntimeApprovalDecision",
      "RuntimeApprovalDecisionSchema",
      "RuntimeApprovalMode",
      "RuntimeApprovalModeSchema",
      "RuntimeApprovalRecord",
      "RuntimeApprovalRecordSchema",
      "RuntimeApprovalReviewer",
      "RuntimeApprovalReviewerSchema",
      "RuntimeApprovalResolvedStatusSchema",
      "RuntimeApprovalsApiEffect",
      "RuntimeApprovalRequest",
      "RuntimeApprovalRequestSchema",
      "RuntimeApprovalStatePort",
      "RuntimeApprovalStatePortService",
      "RuntimeApprovalStatus",
      "RuntimeApprovalStatusSchema",
      "RuntimeApprovalToolName",
      "RuntimeApprovalToolNameSchema",
      "RuntimeActorExtensionBindingRecord",
      "RuntimeActorExtensionBindingRecordSchema",
      "RuntimeActorExtensionBindingStatePort",
      "RuntimeActorExtensionBindingStatePortService",
      "RuntimeArtifactKind",
      "RuntimeArtifactKindSchema",
      "RuntimeArtifactRecord",
      "RuntimeArtifactRecordSchema",
      "RuntimeArtifactStatePort",
      "RuntimeArtifactStatePortService",
      "RuntimeComposerDraftStatePort",
      "RuntimeComposerDraftStatePortService",
      "RuntimeClientSubmission",
      "RuntimeClientSubmissionInput",
      "RuntimeClientSubmissionInputSchema",
      "RuntimeClientSubmissionMetadata",
      "RuntimeClientSubmissionMetadataSchema",
      "RuntimeClientSubmissionSchema",
      "RuntimeCommandsApiEffect",
      "RuntimeCommandsApiPromise",
      "RuntimeCommandCreateStatus",
      "RuntimeCommandCreateStatusSchema",
      "RuntimeCommandExecutor",
      "RuntimeCommandExecutorSchema",
      "RuntimeCommandEventKind",
      "RuntimeCommandEventKindSchema",
      "RuntimeCommandFinishStatus",
      "RuntimeCommandFinishStatusSchema",
      "RuntimeCommandOutputSource",
      "RuntimeCommandOutputSourceSchema",
      "RuntimeCommandOutputStreamSchema",
      "RuntimeCommandRecord",
      "RuntimeCommandRecordSchema",
      "RuntimeCommandStatePort",
      "RuntimeCommandStatePortService",
      "RuntimeCommandStatus",
      "RuntimeCommandStatusSchema",
      "RuntimeCommandVisibility",
      "RuntimeCommandVisibilitySchema",
      "ClearSubmittedComposerDraftInput",
      "ClearSubmittedComposerDraftInputSchema",
      "RuntimeExtensionContextChangedReason",
      "RuntimeExtensionContextChangedReasonSchema",
      "RuntimeExtensionContextChangedSurface",
      "RuntimeExtensionContextChangedSurfaceSchema",
      "RuntimeExtensionContextImpactStateFacade",
      "RuntimeExtensionContextImpactStatePort",
      "RuntimeExtensionContextImpactStatePortService",
      "RuntimeExtensionSnapshotContextImpactTransportInput",
      "RuntimeExtensionSnapshotContextImpactTransportInputSchema",
      "RuntimeExtensionUsageContextImpactTransportInput",
      "RuntimeExtensionUsageContextImpactTransportInputSchema",
      "RuntimeExtensionUsageProfileKey",
      "RuntimeExtensionUsageProfileKeySchema",
      "RuntimeExtensionUsageProfileKeyTransport",
      "RuntimeExtensionUsageProfileKeyTransportSchema",
      "RuntimeSessionWaitOwner",
      "RuntimeSessionWaitOwnerSchema",
      "RuntimeSessionWaitStatePort",
      "RuntimeSessionWaitStatePortService",
      "RuntimeContractError",
      "decodeUnknownRuntimeContractErrorEffect",
      "decodeUnknownRuntimeContractErrorExit",
      "encodeRuntimeContractErrorEffect",
      "encodeRuntimeContractErrorExit",
      "RuntimeFacadeErrorContract",
      "RuntimeFacadeErrorContractSchema",
      "RuntimeOwnerId",
      "RuntimeOwnerKind",
      "RuntimeOwnerKindSchema",
      "RuntimeOwnerRef",
      "RuntimeOwnerRefSchema",
      "RuntimeEventGenerationId",
      "RuntimeEventSequence",
      "RuntimeEventError",
      "decodeUnknownRuntimeEventErrorEffect",
      "decodeUnknownRuntimeEventErrorExit",
      "encodeRuntimeEventErrorEffect",
      "encodeRuntimeEventErrorExit",
      "EnsureRuntimeHandlerThreadRunnableInput",
      "SetRuntimeApprovalSessionWaitInput",
      "SetRuntimeApprovalSessionWaitInputSchema",
      "SetRuntimeActorExtensionBindingInput",
      "SetRuntimeActorExtensionBindingInputSchema",
      "SetRuntimeUserSessionWaitInput",
      "SetRuntimeUserSessionWaitInputSchema",
      "GetRuntimeApprovalRequestInput",
      "GetRuntimeApprovalRequestInputSchema",
      "ListOpenRuntimeApprovalRequestsInput",
      "ListOpenRuntimeApprovalRequestsInputSchema",
      "ResolveRuntimeApprovalRequestInput",
      "ResolveRuntimeApprovalRequestInputSchema",
      "RuntimeEventErrorSchema",
      "RuntimeEventRebaselineRequired",
      "decodeUnknownRuntimeEventRebaselineRequiredEffect",
      "decodeUnknownRuntimeEventRebaselineRequiredExit",
      "encodeRuntimeEventRebaselineRequiredEffect",
      "encodeRuntimeEventRebaselineRequiredExit",
      "RuntimeEffectRequest",
      "RuntimeEffectRequestSchema",
      "RuntimeEffectOperation",
      "RuntimeEffectOperationSchema",
      "RuntimeEvent",
      "RuntimeEventSchema",
      "RuntimeEventStreamError",
      "decodeUnknownRuntimeEventStreamErrorEffect",
      "decodeUnknownRuntimeEventStreamErrorExit",
      "encodeRuntimeEventStreamErrorEffect",
      "encodeRuntimeEventStreamErrorExit",
      "RuntimeEventSubscriptionClose",
      "RuntimeEventSubscriptionCloseSchema",
      "RuntimeEventsInput",
      "RuntimeEventsInputSchema",
      "RuntimeEpisodeKind",
      "RuntimeEpisodeRecord",
      "RuntimeEpisodeStatePort",
      "RuntimeEpisodeStatePortService",
      "RuntimeExtensionStatePort",
      "RuntimeExtensionStatePortService",
      "RuntimeMessageDelivery",
      "RuntimeMessageDeliverySchema",
      "RuntimeMessagesApiEffect",
      "RuntimePromptTelemetryContentBlock",
      "RuntimePromptTelemetryMessage",
      "RuntimePromptTelemetrySummary",
      "ReadExtensionDependencyApprovalInput",
      "ReadExtensionDependencyReadinessInput",
      "ReadExtensionSourceFingerprintInput",
      "RecordExtensionDependencyReadinessInput",
      "RecordExtensionDependencyReadinessInputSchema",
      "RuntimeGeneratedPackageFactRecord",
      "RuntimeGeneratedPackageFactRecordSchema",
      "RuntimeGeneratedPackageFactStatus",
      "RuntimeGeneratedPackageFactStatusSchema",
      "RuntimeGeneratedPackageStatePort",
      "RuntimeGeneratedPackageStatePortService",
      "RuntimeGeneratedPackageWorkspaceLinkRecord",
      "RuntimeGeneratedPackageWorkspaceLinkRecordSchema",
      "StateCommandReceipt",
      "StateCommandReceiptSchema",
      "StateFacadeErrorContract",
      "StateFacadeErrorContractSchema",
      "StateMutationResult",
      "StateMutationResultSchema",
      "RuntimeRecoveryStartupQueueStatus",
      "RuntimeRecoveryStartupQueueStatusSchema",
      "RuntimeRecoveryStartupSnapshot",
      "RuntimeRecoveryStartupSnapshotSchema",
      "RuntimeRecoveryStartupThreadStatus",
      "RuntimeRecoveryStartupThreadStatusSchema",
      "RuntimeRecoveryStartupTitleGenerationStatus",
      "RuntimeRecoveryStartupTitleGenerationStatusSchema",
      "RuntimeRecoveryStartupTurnStatus",
      "RuntimeRecoveryStartupTurnStatusSchema",
      "RuntimeRecoveryStatePort",
      "RuntimeRecoveryStatePortService",
      "RuntimeRecoveryWorkKind",
      "RuntimeRecoveryWorkKindSchema",
      "RuntimeRecoveryWorkOwnerScope",
      "RuntimeRecoveryWorkOwnerScopeSchema",
      "RuntimeRecoveryWorkRecord",
      "RuntimeRecoveryWorkRecordSchema",
      "RuntimeRecoveryWorkStatus",
      "RuntimeRecoveryWorkStatusSchema",
      "ApplyRuntimeExtensionSnapshotContextImpactInput",
      "ApplyRuntimeExtensionSnapshotContextImpactInputSchema",
      "ClaimNextRuntimeRecoveryWorkInput",
      "ClaimNextRuntimeRecoveryWorkInputSchema",
      "CompleteRuntimeRecoveryWorkInput",
      "CompleteRuntimeRecoveryWorkInputSchema",
      "EnsureRuntimeRecoveryWorkInput",
      "EnsureRuntimeRecoveryWorkInputSchema",
      "FailOrRetryRuntimeRecoveryWorkInput",
      "FailOrRetryRuntimeRecoveryWorkInputSchema",
      "ListRuntimeExtensionUsageContextAffectedSurfacesInput",
      "ListRuntimeExtensionUsageContextAffectedSurfacesInputSchema",
      "NormalizeRuntimeRecoveryStateInput",
      "NormalizeRuntimeRecoveryStateInputSchema",
      "RuntimeHandlerThreadEpisodeRequest",
      "RuntimeReadModelStatePort",
      "RuntimeReadModelStatePortService",
      "ReconcileGeneratedPackageManifestInput",
      "ReconcileGeneratedPackageManifestInputSchema",
      "RuntimeSubmittedAttachment",
      "RuntimeSubmittedAttachmentSchema",
      "RuntimeSubmittedMessage",
      "RuntimeSubmittedMessageSchema",
      "RuntimeSurfaceTarget",
      "RuntimeSurfaceTargetSchema",
      "RuntimeSurfacesApiEffect",
      "RuntimeSurfacesApiPromise",
      "RuntimeQueueStatePort",
      "RuntimeQueueStatePortService",
      "RuntimeQueuesApiEffect",
      "RuntimeSurfaceQueueItemKindSchema",
      "RuntimeSurfaceQueuePosition",
      "RuntimeSurfaceQueuePositionSchema",
      "RuntimeSurfaceQueuePrioritySchema",
      "RuntimeSurfaceQueueStatusSchema",
      "CancelRuntimeRequestInputInput",
      "CancelRuntimeRequestInputInputSchema",
      "DefaultOpenRuntimeRequestInputQuestionsInput",
      "DefaultOpenRuntimeRequestInputQuestionsInputSchema",
      "GetRuntimeRequestInputInput",
      "GetRuntimeRequestInputInputSchema",
      "ListOpenBlockingRuntimeRequestInputsInput",
      "ListOpenBlockingRuntimeRequestInputsInputSchema",
      "RuntimeRequestInputAnsweredBy",
      "RuntimeRequestInputAnsweredBySchema",
      "RuntimeRequestInputAnswerRecord",
      "RuntimeRequestInputAnswerRecordSchema",
      "RuntimeRequestInputChoiceInputSchema",
      "RuntimeRequestInputChoiceRecord",
      "RuntimeRequestInputChoiceRecordSchema",
      "RuntimeRequestInputDelivery",
      "RuntimeRequestInputDeliverySchema",
      "RuntimeRequestInputDetailsRecord",
      "RuntimeRequestInputDetailsRecordSchema",
      "RuntimeRequestInputModeSchema",
      "RuntimeRequestInputQuestionInput",
      "RuntimeRequestInputQuestionInputSchema",
      "RuntimeRequestInputQuestionRecord",
      "RuntimeRequestInputQuestionRecordSchema",
      "RuntimeRequestInputQuestionStatus",
      "RuntimeRequestInputQuestionStatusSchema",
      "RuntimeRequestInputRecord",
      "RuntimeRequestInputRecordSchema",
      "RuntimeRequestInputTimeoutRecord",
      "RuntimeRequestInputTimeoutInputSchema",
      "RuntimeRequestInputTimeoutRecordSchema",
      "RuntimeRequestInputStatusSchema",
      "RuntimeRequestInputApiEffect",
      "RuntimeRequestStatePort",
      "RuntimeRequestStatePortService",
      "RuntimeSourceFactRecord",
      "RuntimeSourceFactRecordSchema",
      "RuntimeSourceInvalidationApiEffect",
      "RuntimeSourceStatePort",
      "RuntimeSourceStatePortService",
      "RuntimeSurfaceMessageRecord",
      "RuntimeSurfaceMessageRecordSchema",
      "RuntimeSurfaceLifecycleStatePort",
      "RuntimeSurfaceLifecycleStatePortService",
      "RuntimeSurfaceQueueItemKind",
      "RuntimeSurfaceQueuePriority",
      "RuntimeSurfaceQueueStatus",
      "RuntimeHandlerThreadGeneratedContextBindingInput",
      "RuntimeHandlerThreadInitialQueueInput",
      "RuntimeThreadCompactRow",
      "RuntimeThreadCurrentReadModel",
      "RuntimeThreadEpisodesReadModel",
      "RuntimeThreadGroupReadModel",
      "RuntimeThreadListReadModel",
      "RuntimeThreadPendingReportRequest",
      "RuntimeThreadReadModelEpisodeSummary",
      "RuntimeThreadReadModelWait",
      "RuntimeThreadStatePort",
      "RuntimeThreadStatePortService",
      "RuntimeThreadStatus",
      "RuntimeTurnDecision",
      "RuntimeTurnDecisionSchema",
      "RuntimeTurnRecord",
      "RuntimeTurnRecordSchema",
      "RuntimeToolExecutionError",
      "decodeUnknownRuntimeToolExecutionErrorEffect",
      "decodeUnknownRuntimeToolExecutionErrorExit",
      "encodeRuntimeToolExecutionErrorEffect",
      "encodeRuntimeToolExecutionErrorExit",
      "RuntimeTurnStatePort",
      "RuntimeTurnStatePortService",
      "RuntimeTurnStatus",
      "RuntimeTurnStatusSchema",
      "RuntimeWorkspacesApiEffect",
      "RuntimeWorkspacesApiPromise",
      "RuntimeWorkspaceStatePort",
      "RuntimeWorkspaceStatePortService",
      "SaveExtensionSourceEditInput",
      "SaveExtensionSourceEditInputSchema",
      "SandboxLaunchFacts",
      "SandboxLaunchFactsSchema",
      "SandboxLaunchKind",
      "SandboxLaunchKindSchema",
      "SandboxLaunchScope",
      "SandboxLaunchScopeSchema",
      "SandboxPolicySnapshot",
      "SandboxPolicySnapshotInput",
      "SandboxPolicySnapshotInputSchema",
      "SandboxPolicySnapshotSchema",
      "SandboxPolicySource",
      "SandboxPolicySourceService",
      "SourceDiagnostic",
      "SourceDiagnosticSchema",
      "SourceDomain",
      "SourceDomainSchema",
      "SourceInvalidationHint",
      "SourceInvalidationHintSchema",
      "SourceInvalidationScope",
      "SourceInvalidationScopeSchema",
      "SourceReconcileReason",
      "SourceReconcileReasonSchema",
      "SourceReconcileRequest",
      "SourceReconcileRequestSchema",
      "SourceReconcileResult",
      "SourceReconcileResultSchema",
      "SourceEditSaveResult",
      "SourceEditSaveResultSchema",
      "SourceEditSession",
      "SourceEditSessionSchema",
      "SetRequestInputTimerPausedInput",
      "SetRequestInputTimerPausedInputSchema",
      "SetRequestInputTimerPausedResult",
      "SetRequestInputTimerPausedResultSchema",
      "AcceptSubmittedRuntimeSurfaceMessageInput",
      "AcceptSubmittedRuntimeSurfaceMessageInputSchema",
      "CancelRuntimeSurfaceMessageInput",
      "CancelRuntimeSurfaceMessageInputSchema",
      "ClaimNextRuntimeSurfaceMessageInput",
      "ClaimNextRuntimeSurfaceMessageInputSchema",
      "EnqueueRuntimeSurfaceMessageInput",
      "EnqueueRuntimeSurfaceMessageInputSchema",
      "FinishRuntimeTurnInput",
      "FinishRuntimeTurnInputSchema",
      "FinishRuntimeTurnStatusSchema",
      "GetRuntimeSurfaceMessageInput",
      "GetRuntimeSurfaceMessageInputSchema",
      "MarkRuntimeSurfaceMessageDeliveredInput",
      "MarkRuntimeSurfaceMessageDeliveredInputSchema",
      "MarkRuntimeSurfaceMessageFailedInput",
      "MarkRuntimeSurfaceMessageFailedInputSchema",
      "MarkRuntimeSurfaceMessageQueuedInput",
      "MarkRuntimeSurfaceMessageQueuedInputSchema",
      "MarkRuntimeSurfaceMessageSteeringInput",
      "MarkRuntimeSurfaceMessageSteeringInputSchema",
      "ReleaseExpiredRuntimeSurfaceMessageClaimsInput",
      "ReleaseExpiredRuntimeSurfaceMessageClaimsInputSchema",
      "SetRuntimeTurnDecisionInput",
      "SetRuntimeTurnDecisionInputSchema",
      "StartRuntimeTurnInput",
      "StartRuntimeTurnInputSchema",
      "SandboxPolicyError",
      "decodeUnknownSandboxPolicyErrorEffect",
      "decodeUnknownSandboxPolicyErrorExit",
      "encodeSandboxPolicyErrorEffect",
      "encodeSandboxPolicyErrorExit",
      "SavePiSessionReferenceInput",
      "SavePiSessionReferenceInputSchema",
      "SecretInvocationValue",
      "SecretStatusSnapshot",
      "SecretStatusSnapshotSchema",
      "SecretStorePort",
      "SecretStorePortError",
      "decodeUnknownSecretStorePortErrorEffect",
      "decodeUnknownSecretStorePortErrorExit",
      "encodeSecretStorePortErrorEffect",
      "encodeSecretStorePortErrorExit",
      "SecretStorePortService",
      "SentSnippetProvenance",
      "SentSnippetProvenanceSchema",
      "serializeComposerAttachmentTextSignature",
      "SnippetId",
      "SnippetMetadata",
      "SnippetMetadataSchema",
      "SnippetSource",
      "SnippetSourceSchema",
      "StateContractError",
      "decodeUnknownStateContractErrorEffect",
      "decodeUnknownStateContractErrorExit",
      "encodeStateContractErrorEffect",
      "encodeStateContractErrorExit",
      "StateInvalidationDescriptor",
      "StateInvalidationDescriptorSchema",
      "StateRevision",
      "StateRevisionSchema",
      "StateStoredError",
      "StateStoredErrorSchema",
      "decodeUnknownStateStoredErrorEffect",
      "decodeUnknownStateStoredErrorExit",
      "encodeStateStoredErrorEffect",
      "encodeStateStoredErrorExit",
      "StartedRuntimeHandlerThread",
      "StartRuntimeHandlerThreadInput",
      "StartRuntimeHandlerThreadsInput",
      "StartRuntimeHandlerThreadsResult",
      "StartRuntimeCommandInput",
      "StartRuntimeCommandInputSchema",
      "StartHandlerThreadItem",
      "StartHandlerThreadItemSchema",
      "StartHandlerThreadRequest",
      "StartHandlerThreadRequestSchema",
      "SteerQueuedMessageInput",
      "SteerQueuedMessageInputSchema",
      "StoredErrorReason",
      "StoredErrorReasonSchema",
      "SubmitMessageInput",
      "SubmitMessageInputSchema",
      "SubmitMessageResult",
      "SubmitMessageResultSchema",
      "SurfacePiSessionId",
      "SurfaceQueueItemKind",
      "SurfaceQueueItemKindSchema",
      "SurfaceStreamGenerationId",
      "SurfaceStreamPatchInput",
      "SurfaceStreamPatchInputSchema",
      "SurfaceStreamSequence",
      "SvvyxRuntimeEffectTransportIntent",
      "SvvyxRuntimeEffectTransportIntentSchema",
      "SvvyxRuntimeEffectTransportRequest",
      "SvvyxRuntimeEffectTransportRequestSchema",
      "SmithersObservedJson",
      "SmithersObservedJsonSchema",
      "SmithersTaskAttemptIdentity",
      "SmithersTaskAttemptIdentitySchema",
      "SmithersTaskContextSnapshot",
      "SmithersTaskContextSnapshotSchema",
      "SmithersTaskSourceContextSnapshot",
      "SmithersTaskSourceContextSnapshotSchema",
      "ValidatedTaskAgentParameters",
      "ValidatedTaskAgentParametersSchema",
      "ThreadFollowupQueuePayloadSchema",
      "ThreadGroupId",
      "ThreadHistoryMode",
      "ThreadHistoryModeSchema",
      "ThreadId",
      "ThreadReportNotificationQueuePayloadSchema",
      "TitleJobId",
      "ToolCallId",
      "ToolItemId",
      "TurnId",
      "UpdateRuntimeCommandArgumentsInput",
      "UpdateRuntimeCommandArgumentsInputSchema",
      "UpdateActorExtensionBindingRequest",
      "UpdateActorExtensionBindingRequestSchema",
      "UserMessageQueuePayloadSchema",
      "ValidatePiSessionReferenceInput",
      "ValidatePiSessionReferenceInputSchema",
      "WriteCommandStdinInput",
      "WriteCommandStdinInputSchema",
      "WriteCommandStdinResult",
      "WriteCommandStdinResultSchema",
      "WorkflowRunId",
      "RunTaskAgentOperation",
      "RunTaskAgentOperationSchema",
      "TaskAgentParametersSource",
      "TaskAgentParametersSourceSchema",
      "RunTaskAgentMessage",
      "RunTaskAgentMessageSchema",
      "RunTaskAgentPromptSource",
      "RunTaskAgentPromptSourceSchema",
      "RunTaskAgentInput",
      "RunTaskAgentInputSchema",
      "RunTaskAgentSourceInput",
      "RunTaskAgentSourceInputSchema",
      "RunTaskAgentError",
      "RunTaskAgentErrorCode",
      "RunTaskAgentErrorCodeSchema",
      "RunTaskAgentErrorSchema",
      "RunTaskAgentResult",
      "RunTaskAgentResultSchema",
      "WorkflowTaskAgentContext",
      "WorkflowTaskAgentContextSchema",
      "WorkflowTaskAgentStartQueuePayloadSchema",
      "WorkflowTaskAttemptId",
      "WorkflowTaskRuntimeSurfaceTarget",
      "WorkflowTaskRuntimeSurfaceTargetSchema",
      "WorkspaceId",
      "WorkspacePaneId",
      "WorkspaceReadModelInvalidation",
      "WorkspaceReadModelInvalidationSchema",
      "WorkspaceSessionId",
      "WorkspaceSessionNavigationReadModel",
      "WorkspaceSessionNavigationSectionId",
      "WorkspaceSessionNavigationSectionState",
      "WorkspaceSessionNavigationSummary",
      "WorkspaceTabId",
      "WorktreeId",
      "UtcDateTime",
      "createContextBudget",
      "decodeAbortPromptInput",
      "decodeAbortPromptInputEffect",
      "decodeAbortPromptInputExit",
      "decodeAcquireDefaultWorkspaceInput",
      "decodeAcquireDefaultWorkspaceInputEffect",
      "decodeAcquireDefaultWorkspaceInputExit",
      "decodeAcquireWorkspaceInput",
      "decodeAcquireWorkspaceInputEffect",
      "decodeAcquireWorkspaceInputExit",
      "decodeAcquireWorkspaceResult",
      "decodeAcquireWorkspaceResultEffect",
      "decodeAcquireWorkspaceResultExit",
      "decodeAnswerRuntimeApprovalInput",
      "decodeAnswerRuntimeApprovalInputEffect",
      "decodeAnswerRuntimeApprovalInputExit",
      "decodeAnswerRuntimeApprovalResult",
      "decodeAnswerRuntimeApprovalResultEffect",
      "decodeAnswerRuntimeApprovalResultExit",
      "decodeAnswerRequestInputInput",
      "decodeAnswerRequestInputInputEffect",
      "decodeAnswerRequestInputInputExit",
      "decodeAnswerRequestInputResult",
      "decodeAnswerRequestInputResultEffect",
      "decodeAnswerRequestInputResultExit",
      "decodeSetRequestInputTimerPausedInput",
      "decodeSetRequestInputTimerPausedInputEffect",
      "decodeSetRequestInputTimerPausedInputExit",
      "decodeSetRequestInputTimerPausedResult",
      "decodeSetRequestInputTimerPausedResultEffect",
      "decodeSetRequestInputTimerPausedResultExit",
      "decodeCancelCommandInput",
      "decodeCancelCommandInputEffect",
      "decodeCancelCommandInputExit",
      "decodeCancelCommandResult",
      "decodeCancelCommandResultEffect",
      "decodeCancelCommandResultExit",
      "decodeCloseSurfaceInput",
      "decodeCloseSurfaceInputEffect",
      "decodeCloseSurfaceInputExit",
      "decodeCloseSurfaceResult",
      "decodeCloseSurfaceResultEffect",
      "decodeCloseSurfaceResultExit",
      "decodeCommandResultEnvelope",
      "decodeCommandResultEnvelopeEffect",
      "decodeCommandResultEnvelopeExit",
      "decodeCreateOrchestratorSurfaceInput",
      "decodeCreateOrchestratorSurfaceInputEffect",
      "decodeCreateOrchestratorSurfaceInputExit",
      "decodeCreateRequestInputRequest",
      "decodeCreateRequestInputRequestEffect",
      "decodeCreateRequestInputRequestExit",
      "decodeCreateSurfaceResult",
      "decodeCreateSurfaceResultEffect",
      "decodeCreateSurfaceResultExit",
      "decodeExtensionExecutionPlan",
      "decodeExtensionExecutionPlanEffect",
      "decodeExtensionExecutionPlanExit",
      "decodeExtensionHandlerResult",
      "decodeExtensionHandlerResultEffect",
      "decodeExtensionHandlerResultExit",
      "decodeGeneratedPackageBuildInput",
      "decodeGeneratedPackageBuildInputEffect",
      "decodeGeneratedPackageBuildInputExit",
      "decodeGeneratedPackageBuildPlanResult",
      "decodeGeneratedPackageBuildPlanResultEffect",
      "decodeGeneratedPackageBuildPlanResultExit",
      "decodeGeneratedPackageWorkspaceLinkRepairInput",
      "decodeGeneratedPackageWorkspaceLinkRepairInputEffect",
      "decodeGeneratedPackageWorkspaceLinkRepairInputExit",
      "decodeGeneratedPackagesRefreshResult",
      "decodeGeneratedPackagesRefreshResultEffect",
      "decodeGeneratedPackagesRefreshResultExit",
      "decodeNativeToolResult",
      "decodeNativeToolResultEffect",
      "decodeNativeToolResultExit",
      "decodeUnknownClosePiSessionInputEffect",
      "decodeUnknownClosePiSessionInputExit",
      "decodeUnknownCreatePiSessionInputEffect",
      "decodeUnknownCreatePiSessionInputExit",
      "decodeUnknownDeletePiSessionReferenceInputEffect",
      "decodeUnknownDeletePiSessionReferenceInputExit",
      "decodeUnknownGenerateTitleInputEffect",
      "decodeUnknownGenerateTitleInputExit",
      "decodeUnknownGenerateTitleResultEffect",
      "decodeUnknownGenerateTitleResultExit",
      "decodeUnknownGetPiSessionReferenceInputEffect",
      "decodeUnknownGetPiSessionReferenceInputExit",
      "decodeUnknownGetProviderAuthSnapshotInputEffect",
      "decodeUnknownGetProviderAuthSnapshotInputExit",
      "decodeUnknownInterruptPiTurnInputEffect",
      "decodeUnknownInterruptPiTurnInputExit",
      "decodeUnknownListProviderStatusesInputEffect",
      "decodeUnknownListProviderStatusesInputExit",
      "decodeUnknownListModelsInputEffect",
      "decodeUnknownListModelsInputExit",
      "decodeUnknownModelInfoEffect",
      "decodeUnknownModelInfoExit",
      "unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap",
      "decodeUnknownPiRuntimeEventEffect",
      "decodeUnknownPiRuntimeEventExit",
      "decodeUnknownPiRuntimePathsSnapshotEffect",
      "decodeUnknownPiRuntimePathsSnapshotExit",
      "decodeUnknownModelSelectionEffect",
      "decodeUnknownModelSelectionExit",
      "decodeUnknownOpenPiSessionInputEffect",
      "decodeUnknownOpenPiSessionInputExit",
      "decodeUnknownReasoningSelectionEffect",
      "decodeUnknownReasoningSelectionExit",
      "decodeUnknownRecordProviderAuthStatusInputEffect",
      "decodeUnknownRecordProviderAuthStatusInputExit",
      "decodeUnknownRequestProviderRefreshInputEffect",
      "decodeUnknownRequestProviderRefreshInputExit",
      "decodeUnknownResolvePiRuntimePathsInputEffect",
      "decodeUnknownResolvePiRuntimePathsInputExit",
      "decodeUnknownSavePiSessionReferenceInputEffect",
      "decodeUnknownSavePiSessionReferenceInputExit",
      "decodeUnknownValidatePiSessionReferenceInputEffect",
      "decodeUnknownValidatePiSessionReferenceInputExit",
      "decodeRequestUserInputAnswerDeliveryPayload",
      "decodeRequestUserInputAnswerDeliveryPayloadEffect",
      "decodeRequestUserInputAnswerDeliveryPayloadExit",
      "decodeRequestUserInputAnswerQueuePayload",
      "decodeRequestUserInputAnswerQueuePayloadEffect",
      "decodeRequestUserInputAnswerQueuePayloadExit",
      "decodeRefreshGeneratedContextRequest",
      "decodeRefreshGeneratedContextRequestEffect",
      "decodeRefreshGeneratedContextRequestExit",
      "decodeRefreshGeneratedPackagesRequest",
      "decodeRefreshGeneratedPackagesRequestEffect",
      "decodeRefreshGeneratedPackagesRequestExit",
      "decodeRunExtensionDependencyActionInput",
      "decodeRunExtensionDependencyActionInputEffect",
      "decodeRunExtensionDependencyActionInputExit",
      "decodeRunExtensionDependencyActionResult",
      "decodeRunExtensionDependencyActionResultEffect",
      "decodeRunExtensionDependencyActionResultExit",
      "decodeRuntimeClientSubmissionMetadata",
      "decodeRuntimeClientSubmissionMetadataEffect",
      "decodeRuntimeClientSubmissionMetadataExit",
      "unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap",
      "decodeUnknownRuntimeEffectRequestEffect",
      "decodeUnknownRuntimeEffectRequestExit",
      "decodeUnknownSvvyxRuntimeEffectTransportIntentEffect",
      "decodeUnknownSvvyxRuntimeEffectTransportIntentExit",
      "encodeDeletePiSessionReferenceInputEffect",
      "encodeDeletePiSessionReferenceInputExit",
      "encodeClosePiSessionInputEffect",
      "encodeClosePiSessionInputExit",
      "encodeCreatePiSessionInputEffect",
      "encodeCreatePiSessionInputExit",
      "encodeGenerateTitleInputEffect",
      "encodeGenerateTitleInputExit",
      "encodeGenerateTitleResultEffect",
      "encodeGenerateTitleResultExit",
      "encodeGetPiSessionReferenceInputEffect",
      "encodeGetPiSessionReferenceInputExit",
      "encodeGetProviderAuthSnapshotInputEffect",
      "encodeGetProviderAuthSnapshotInputExit",
      "encodeInterruptPiTurnInputEffect",
      "encodeInterruptPiTurnInputExit",
      "encodeListModelsInputEffect",
      "encodeListModelsInputExit",
      "encodeListProviderStatusesInputEffect",
      "encodeListProviderStatusesInputExit",
      "encodeModelInfoEffect",
      "encodeModelInfoExit",
      "encodeModelSelectionEffect",
      "encodeModelSelectionExit",
      "encodeOpenPiSessionInputEffect",
      "encodeOpenPiSessionInputExit",
      "encodePiRuntimeEventEffect",
      "encodePiRuntimeEventExit",
      "encodePiRuntimePathsSnapshotEffect",
      "encodePiRuntimePathsSnapshotExit",
      "encodeReasoningSelectionEffect",
      "encodeReasoningSelectionExit",
      "encodeRecordProviderAuthStatusInputEffect",
      "encodeRecordProviderAuthStatusInputExit",
      "encodeRequestProviderRefreshInputEffect",
      "encodeRequestProviderRefreshInputExit",
      "encodeResolvePiRuntimePathsInputEffect",
      "encodeResolvePiRuntimePathsInputExit",
      "encodeRuntimeEffectRequestEffect",
      "encodeRuntimeEffectRequestExit",
      "encodeSavePiSessionReferenceInputEffect",
      "encodeSavePiSessionReferenceInputExit",
      "encodeSvvyxRuntimeEffectTransportIntentEffect",
      "encodeSvvyxRuntimeEffectTransportIntentExit",
      "encodeValidatePiSessionReferenceInputEffect",
      "encodeValidatePiSessionReferenceInputExit",
      "unsafeDecodeSvvyxRuntimeEffectTransportIntentSyncForTestsAndBootstrap",
      "decodeRuntimeEvent",
      "decodeRuntimeEventEffect",
      "decodeRuntimeEventError",
      "decodeRuntimeEventErrorEffect",
      "decodeRuntimeEventErrorExit",
      "decodeRuntimeEventExit",
      "decodeRuntimeEventSubscriptionClose",
      "decodeRuntimeEventSubscriptionCloseEffect",
      "decodeRuntimeEventSubscriptionCloseExit",
      "decodeRuntimeEventsInput",
      "decodeRuntimeEventsInputEffect",
      "decodeRuntimeEventsInputExit",
      "decodeOpenExtensionSourceEditInput",
      "decodeOpenExtensionSourceEditInputEffect",
      "decodeOpenExtensionSourceEditInputExit",
      "decodeSaveExtensionSourceEditInput",
      "decodeSaveExtensionSourceEditInputEffect",
      "decodeSaveExtensionSourceEditInputExit",
      "decodeSourceEditSaveResult",
      "decodeSourceEditSaveResultEffect",
      "decodeSourceEditSaveResultExit",
      "decodeSourceEditSession",
      "decodeSourceEditSessionEffect",
      "decodeSourceEditSessionExit",
      "decodeUnknownRuntimeFacadeErrorContractEffect",
      "decodeUnknownRuntimeFacadeErrorContractExit",
      "decodeUnknownStateFacadeErrorContractEffect",
      "decodeUnknownStateFacadeErrorContractExit",
      "encodeRuntimeFacadeErrorContractEffect",
      "encodeRuntimeFacadeErrorContractExit",
      "encodeStateFacadeErrorContractEffect",
      "encodeStateFacadeErrorContractExit",
      "unsafeDecodeRuntimeFacadeErrorContractSyncForTestsAndBootstrap",
      "unsafeDecodeStateFacadeErrorContractSyncForTestsAndBootstrap",
      "decodeRuntimeSubmittedMessage",
      "decodeRuntimeSubmittedMessageEffect",
      "decodeRuntimeSubmittedMessageExit",
      "decodeOpenSurfaceInput",
      "decodeOpenSurfaceInputEffect",
      "decodeOpenSurfaceInputExit",
      "decodeOpenSurfaceResult",
      "decodeOpenSurfaceResultEffect",
      "decodeOpenSurfaceResultExit",
      "decodeReleaseWorkspaceInput",
      "decodeReleaseWorkspaceInputEffect",
      "decodeReleaseWorkspaceInputExit",
      "decodeReleaseWorkspaceResult",
      "decodeReleaseWorkspaceResultEffect",
      "decodeReleaseWorkspaceResultExit",
      "decodeRuntimeOwnerRef",
      "decodeRuntimeOwnerRefEffect",
      "decodeRuntimeOwnerRefExit",
      "decodeSourceInvalidationHint",
      "decodeSourceInvalidationHintEffect",
      "decodeSourceInvalidationHintExit",
      "decodeSourceReconcileRequest",
      "decodeSourceReconcileRequestEffect",
      "decodeSourceReconcileRequestExit",
      "decodeSourceReconcileResult",
      "decodeSourceReconcileResultEffect",
      "decodeSourceReconcileResultExit",
      "decodeStateInvalidationDescriptor",
      "decodeStateInvalidationDescriptorEffect",
      "decodeStateInvalidationDescriptorExit",
      "decodeAuthenticatedRunTaskAgentInput",
      "decodeAuthenticatedRunTaskAgentInputEffect",
      "decodeAuthenticatedRunTaskAgentInputExit",
      "schemaErrorMessage",
      "decodeSteerQueuedMessageInput",
      "decodeSteerQueuedMessageInputEffect",
      "decodeSteerQueuedMessageInputExit",
      "decodeSubmitMessageInput",
      "decodeSubmitMessageInputEffect",
      "decodeSubmitMessageInputExit",
      "decodeSubmitMessageResult",
      "decodeSubmitMessageResultEffect",
      "decodeSubmitMessageResultExit",
      "decodeWriteCommandStdinInput",
      "decodeWriteCommandStdinInputEffect",
      "decodeWriteCommandStdinInputExit",
      "decodeWriteCommandStdinResult",
      "decodeWriteCommandStdinResultEffect",
      "decodeWriteCommandStdinResultExit",
      "unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap",
      "decodeUnknownRunTaskAgentInputEffect",
      "decodeUnknownRunTaskAgentInputExit",
      "unsafeDecodeRunTaskAgentSourceInputSyncForTestsAndBootstrap",
      "decodeUnknownRunTaskAgentSourceInputEffect",
      "decodeUnknownRunTaskAgentSourceInputExit",
      "unsafeDecodeRunTaskAgentResultSyncForTestsAndBootstrap",
      "decodeUnknownRunTaskAgentResultEffect",
      "decodeUnknownRunTaskAgentResultExit",
      "unsafeDecodeRunTaskAgentErrorSyncForTestsAndBootstrap",
      "decodeUnknownRunTaskAgentErrorEffect",
      "decodeUnknownRunTaskAgentErrorExit",
      "encodeRunTaskAgentErrorEffect",
      "encodeRunTaskAgentErrorExit",
      "encodeRequestUserInputAnswerDeliveryPayload",
      "encodeRequestUserInputAnswerQueuePayload",
      "formatContextBudgetTooltip",
      "getContextBudgetTone",
      "isRuntimePromptTelemetrySummary",
      "normalizeRuntimeClientSubmissionMetadata",
      "readContextBudgetFromMeta",
      "runtimeClientSubmissionLogDetails",
      "summarizeRuntimePromptMessagesForTelemetry",
    ],
  ],
  [
    "@svvy/state",
    [
      "AppLogAppendInput",
      "AppLogAppender",
      "AppLogFacade",
      "AppLogReadModelRequest",
      "AppLogReadStateCommands",
      "BuildStructuredThreadEpisodesReadModelInput",
      "BuildStructuredThreadListReadModelInput",
      "ClearWorkspaceAppLogUnreadCommandInput",
      "CreateAppLogFacadeOptions",
      "CreateStateCommandsFacadeOptions",
      "DEFAULT_SESSION_SECTION_SIZES",
      "MarkAppLogReadCommandInput",
      "MarkVisibleAppLogRangeReadCommandInput",
      "SandboxPolicySourceSettings",
      "StateCommandInvalidationSink",
      "StateCommandResult",
      "StateCommands",
      "StateCommandsFacade",
      "StateCommandsService",
      "StateFacade",
      "StateFacadeCallOptions",
      "StateFacadeError",
      "StateLayerInput",
      "StateReadModelBaseline",
      "StateReadModelInvalidationRefetchRequest",
      "StateReadModelRebaselineRequest",
      "StateReadModelRequest",
      "StateReadModelResult",
      "StateReadModels",
      "StateReadModelsService",
      "StructuredCommandArgumentSnapshot",
      "StructuredCommandArtifactLink",
      "StructuredCommandDiagnostic",
      "StructuredCommandDiagnosticSnapshot",
      "StructuredCommandInspector",
      "StructuredCommandInspectorChild",
      "StructuredCommandOutputEvent",
      "StructuredCommandPatchFile",
      "StructuredCommandPatchSnapshot",
      "StructuredCommandProgressEvent",
      "StructuredCommandRollup",
      "StructuredCommandRollupChild",
      "StructuredCommandStdinEvent",
      "StructuredCommandStdinState",
      "StructuredHandlerThreadEpisodeSummary",
      "StructuredHandlerThreadInspector",
      "StructuredHandlerThreadSummary",
      "StructuredHandlerThreadWorkflowSummary",
      "StructuredProductEvent",
      "StructuredSessionSummaryProjection",
      "StructuredSessionView",
      "StructuredSidebarHandlerThreadRow",
      "StructuredSidebarRowSubtitle",
      "StructuredSidebarWorkflowRow",
      "StructuredThreadCompactRow",
      "StructuredThreadCurrentReadModel",
      "StructuredThreadEpisodesReadModel",
      "StructuredThreadGroupReadModel",
      "StructuredThreadPendingReportRequest",
      "StructuredThreadReadModelEpisodeSummary",
      "StructuredThreadReadModelWait",
      "StructuredThreadListReadModel",
      "StructuredWorkflowTaskAttemptInspector",
      "StructuredWorkflowTaskAttemptSummary",
      "StructuredWorkflowTaskAttemptTranscriptMessage",
      "buildStructuredArtifactLink",
      "buildStructuredCommandInspector",
      "buildStructuredHandlerThreadInspector",
      "buildStructuredHandlerThreadSummaries",
      "buildStructuredSessionSummaryProjection",
      "buildStructuredSessionView",
      "buildStructuredSidebarThreadRows",
      "buildStructuredThreadCompactRow",
      "buildStructuredThreadCurrentReadModel",
      "buildStructuredThreadEpisodesReadModel",
      "buildStructuredThreadGroupReadModel",
      "buildStructuredThreadListReadModel",
      "buildStructuredWorkflowTaskAttemptInspector",
      "buildWorkspaceSessionNavigation",
      "createAppLogFacade",
      "createStateCommandsFacade",
      "createStateFacade",
      "deriveStructuredSessionStatus",
      "flattenWorkspaceSessionNavigation",
      "getDefaultSessionNavigationSectionState",
      "getLatestFailureContext",
      "getStructuredThread",
      "groupThreadIdsByStatus",
      "hasStructuredThreadGroup",
      "hasStructuredSessionFacts",
      "extensionStatePortFromStore",
      "extensionStatePortFromStructuredSessionState",
      "layer",
      "layerAppLogWritePort",
      "layerExtensionStatePort",
      "layerProviderAuthStatusStatePort",
      "layerRuntimeActorExtensionBindingStatePort",
      "layerRuntimeApprovalStatePort",
      "layerRuntimeArtifactStatePort",
      "layerRuntimeComposerDraftStatePort",
      "layerRuntimeCommandStatePort",
      "layerRuntimeEpisodeStatePort",
      "layerRuntimeExtensionContextImpactStatePort",
      "layerRuntimeExtensionStatePort",
      "layerRuntimeGeneratedPackageStatePort",
      "layerRuntimeQueueStatePort",
      "layerRuntimeReadModelStatePort",
      "layerRuntimeRecoveryStatePort",
      "layerRuntimeRequestStatePort",
      "layerRuntimeSessionWaitStatePort",
      "layerRuntimeSourceStatePort",
      "layerRuntimeSurfaceLifecycleStatePort",
      "layerRuntimeThreadStatePort",
      "layerRuntimeTurnStatePort",
      "layerRuntimeWorkspaceStatePort",
      "layerSandboxPolicySource",
      "makeRuntimeActorExtensionBindingStatePort",
      "makeRuntimeApprovalStatePort",
      "makeRuntimeArtifactStatePort",
      "makeRuntimeComposerDraftStatePort",
      "makeRuntimeCommandStatePort",
      "makeRuntimeEpisodeStatePort",
      "makeExtensionStatePort",
      "makeRuntimeExtensionContextImpactStatePort",
      "makeRuntimeExtensionStatePort",
      "makeRuntimeGeneratedPackageStatePort",
      "makeRuntimeQueueStatePort",
      "makeRuntimeReadModelStatePort",
      "makeRuntimeRecoveryStatePort",
      "makeRuntimeRequestStatePort",
      "makeRuntimeSessionWaitStatePort",
      "makeRuntimeSourceStatePort",
      "makeRuntimeSurfaceLifecycleStatePort",
      "makeRuntimeThreadStatePort",
      "makeRuntimeTurnStatePort",
      "makeRuntimeWorkspaceStatePort",
      "makeProviderAuthStatusStatePort",
      "makeSandboxPolicySource",
      "providerAuthStatusStatePortFromStore",
      "providerAuthStatusStatePortFromStructuredSessionState",
      "runtimeActorExtensionBindingStatePortFromStore",
      "runtimeActorExtensionBindingStatePortFromStructuredSessionState",
      "runtimeApprovalStatePortFromStore",
      "runtimeApprovalStatePortFromStructuredSessionState",
      "runtimeArtifactStatePortFromStore",
      "runtimeArtifactStatePortFromStructuredSessionState",
      "runtimeComposerDraftStatePortFromStore",
      "runtimeComposerDraftStatePortFromStructuredSessionState",
      "runtimeCommandStatePortFromStore",
      "runtimeCommandStatePortFromStructuredSessionState",
      "runtimeEpisodeStatePortFromStore",
      "runtimeEpisodeStatePortFromStructuredSessionState",
      "runtimeExtensionContextImpactStateFacadeFromStore",
      "runtimeExtensionContextImpactStatePortFromStore",
      "runtimeExtensionContextImpactStatePortFromStructuredSessionState",
      "runtimeExtensionStatePortFromStore",
      "runtimeExtensionStatePortFromStructuredSessionState",
      "runtimeGeneratedPackageStatePortFromStore",
      "runtimeGeneratedPackageStatePortFromStructuredSessionState",
      "runtimeQueueStatePortFromStore",
      "runtimeQueueStatePortFromStructuredSessionState",
      "runtimeReadModelStatePortFromStore",
      "runtimeReadModelStatePortFromStructuredSessionState",
      "runtimeRecoveryStatePortFromStore",
      "runtimeRecoveryStatePortFromStructuredSessionState",
      "runtimeRequestStatePortFromStore",
      "runtimeRequestStatePortFromStructuredSessionState",
      "runtimeSessionWaitStatePortFromStore",
      "runtimeSessionWaitStatePortFromStructuredSessionState",
      "runtimeSourceStatePortFromStore",
      "runtimeSourceStatePortFromStructuredSessionState",
      "runtimeSurfaceLifecycleStatePortFromStore",
      "runtimeSurfaceLifecycleStatePortFromStructuredSessionState",
      "runtimeThreadStatePortFromStore",
      "runtimeThreadStatePortFromStructuredSessionState",
      "runtimeTurnStatePortFromStore",
      "runtimeTurnStatePortFromStructuredSessionState",
      "runtimeWorkspaceStatePortFromStore",
      "runtimeWorkspaceStatePortFromStructuredSessionState",
      "sandboxPolicySourceFromSettings",
      "sortVisibleSessionsByRecency",
    ],
  ],
  [
    "@svvy/sandbox",
    [
      "CheckPathAccessInput",
      "FileSystemAccessMode",
      "FileSystemSandboxEntry",
      "FileSystemSandboxPolicy",
      "HostProcessReferencePort",
      "HostProcessReferencePortService",
      "HostProcessReferenceSnapshot",
      "MacOsSeatbeltProfile",
      "ManagedWorkspaceWritePolicyInput",
      "PathAccessDecision",
      "Sandbox",
      "SandboxDenial",
      "SandboxDenialFacts",
      "SandboxDenialInput",
      "SandboxHelperCandidatesPort",
      "SandboxHelperCandidatesPortService",
      "SandboxHelperCandidatesSnapshot",
      "DirectToolLaunchPolicyInput",
      "ExecuteTypescriptLaunchPolicyInput",
      "SandboxApprovalMode",
      "SandboxLaunchPolicy",
      "SandboxSettingsInput",
      "SvvyxLaunchPolicyInput",
      "buildDirectToolLaunchPolicy",
      "buildExecuteTypescriptLaunchPolicy",
      "buildMacOsSeatbeltProfile",
      "buildManagedWorkspaceWriteFileSystemPolicy",
      "buildSandboxHelperArgs",
      "buildSvvyxLaunchPolicy",
      "canReadFileSystemPath",
      "canWriteFileSystemPath",
      "isSandboxDenialOutput",
      "isSandboxHelperBootstrapFailure",
      "layer",
      "makeSandbox",
      "protectedMetadataNames",
      "resolveFileSystemAccess",
      "resolveSandboxLaunchSettings",
      "resolveSandboxHelperPath",
      "sandboxDenialFacts",
      "sandboxLaunchFacts",
      "unrestrictedFileSystemPolicy",
    ],
  ],
  [
    "@svvy/extensions",
    [
      "BUILTIN_EXTENSIONS",
      "BUILTIN_EXTENSION_IDS",
      "BuiltinExtensionId",
      "ExtensionCliRequirement",
      "ExtensionExternalInstructionSource",
      "ExtensionGeneratedInstruction",
      "ExtensionInstructionFile",
      "ExtensionRecord",
      "ExtensionRegistryInspectInput",
      "ExtensionSourceRoots",
      "ExtensionSourceRootsPort",
      "ExtensionSourceRootsPortService",
      "ExtensionCategory",
      "ExtensionInterfaceKind",
      "ExtensionUsageState",
      "Extensions",
      "ExtensionsService",
      "ActorExtensionBinding",
      "BuildVisibleExtensionRecordsInput",
      "CommandInvocationContext",
      "AcceptedNativeToolArguments",
      "ExtensionHandler",
      "ExtensionHandlerDeps",
      "ExtensionInvocation",
      "GeneratedPackageRootPort",
      "GeneratedPackageRootPortService",
      "GeneratedPackageRoots",
      "GeneratedExtensionExportDiscoveryHost",
      "PackagedExtensionTemplateRoots",
      "PackagedExtensionTemplatesPort",
      "PackagedExtensionTemplatesPortService",
      "WorkspaceSourceLinkPort",
      "WorkspaceSourceLinkPortService",
      "ListExtensionsDetails",
      "ListExtensionsHandlerInvocation",
      "ListExtensionsInput",
      "LoadExtensionHandlerInvocation",
      "LoadExtensionInput",
      "NativeToolActorAvailability",
      "NativeToolActorAvailabilityMap",
      "NativeToolActorKind",
      "NativeToolCommandMetadata",
      "NativeToolCommandMetadataInput",
      "NativeToolCommandVisibility",
      "NativeToolDefinition",
      "NativeToolExecutionCommandPolicy",
      "NativeToolSchemaJsonForExtensionInput",
      "NativeToolSchemasJsonInput",
      "NativeToolStreamingArgumentPolicy",
      "NativeToolTurnDecision",
      "ResolvedExtensionInvocationEnv",
      "NativeToolHandlerInput",
      "RequestUserInputHandlerInvocation",
      "RequestUserInputInput",
      "RequestUserInputInputSchema",
      "RequestUserInputResult",
      "RequestUserInputResultSchema",
      "SvvyActorKind",
      "ThreadStartHandlerInvocation",
      "ThreadStartInput",
      "ThreadStartInputSchema",
      "ThreadStartItemInput",
      "ThreadStartItemInputSchema",
      "VisibleAvailableExtensionRecord",
      "VisibleExtensionRecord",
      "VisibleLoadedExtensionRecord",
      "VisibleExtensionRecordsResult",
      "ResolveActorExtensionBindingInput",
      "buildNativeToolSchemaJsonForExtension",
      "buildNativeToolSchemasJson",
      "builtinDefaultExtensionOrder",
      "builtinDefaultExtensionUsageState",
      "workflowTaskReferenceableBuiltinExtensionIds",
      "createListExtensionsHandler",
      "createLoadExtensionHandler",
      "createRequestUserInputHandler",
      "createThreadStartHandler",
      "decodeRequestUserInputInput",
      "decodeRequestUserInputInputEffect",
      "decodeRequestUserInputInputExit",
      "decodeRequestUserInputResult",
      "decodeRequestUserInputResultEffect",
      "decodeRequestUserInputResultExit",
      "decodeThreadStartInput",
      "decodeThreadStartInputEffect",
      "decodeThreadStartInputExit",
      "externalInstructionExtensionId",
      "GENERATED_EXTENSIONS_PACKAGE_NAME",
      "generatedExtensionExportIdsFromHost",
      "generatedExtensionReferenceExpression",
      "generatedExtensionsPackageContentsFromHost",
      "getExtensionRecord",
      "getNativeToolCommandMetadata",
      "layerExtensionSourceRootsPort",
      "layerGeneratedPackageRootPort",
      "layerExtensions",
      "layerPackagedExtensionTemplatesPort",
      "layerWorkspaceSourceLinkPort",
      "listExtensionsForActor",
      "listExtensionsHandler",
      "loadExtensionHandler",
      "makeExtensions",
      "nativeToolCommandMetadata",
      "requestUserInputHandler",
      "renderGeneratedExtensionsPackageFiles",
      "resolveActorExtensionState",
      "summarizeListExtensions",
      "threadStartHandler",
      "visibleExtensionRecords",
    ],
  ],
  ["@svvy/pi-adapter", ["PiAdapter", "layer"]],
  ["@svvy/runtime", ["Runtime", "createRuntimeFacade", "layer"]],
  [
    "@svvy/desktop",
    [
      "CreateDesktopAppInput",
      "DesktopApp",
      "DesktopBridgeAdapter",
      "DesktopBridgeRegistration",
      "DesktopBrowserToolsUiAdapter",
      "DesktopHostAdapter",
      "DesktopMainWindowInput",
      "DesktopMenuAdapter",
      "DesktopMenuRegistration",
      "DesktopNotificationBridge",
      "DesktopRendererCommand",
      "DesktopRendererNotification",
      "DesktopRuntimeActionsFacade",
      "DesktopWindowAdapter",
      "DesktopWindowHandle",
      "DesktopWindowId",
      "RendererStateFacade",
      "StateCommandsFacade",
      "createDesktopApp",
    ],
  ],
]);
const expectedPublicSubpathSymbols = new Map<string, string[]>([
  [
    "@svvy/runtime/bootstrap",
    [
      "awaitRuntimeStartupReadiness",
      "createRuntimeLayerConfigLayer",
      "defaultRuntimeLayerConfig",
      "prepareRuntimeShutdown",
      "RuntimeLayerConfigFromEnv",
      "RuntimeLayerConfigInputSchema",
      "RuntimeLayerConfigSchema",
      "RuntimeLayerConfigService",
      "RuntimeLayerError",
      "RuntimeShutdownPreparation",
      "RuntimeStartupReadiness",
      "layerRuntimeBunPlatform",
      "RuntimeBunPlatformServices",
      "RuntimeLayerConfig",
      "RuntimePrepareShutdownInput",
      "RuntimePrepareShutdownReason",
      "RuntimePrepareShutdownRequest",
      "RuntimePrepareShutdownResult",
      "RuntimeLayerApprovalPostCommitPort",
      "RuntimeLayerAppLogPort",
      "RuntimeLayerCommandControlPort",
      "RuntimeLayerCommandStdinPort",
      "RuntimeLayerDevTelemetryPort",
      "RuntimeLayerEventsPort",
      "RuntimeLayerModelResolverPort",
      "RuntimeLayerPromptHostPort",
      "RuntimeLayerProviderAuthPort",
      "RuntimeLayerRequestInputPostCommitPort",
      "RuntimeLayerSourceEditsPort",
      "RuntimeLayerSourceInvalidationPort",
      "RuntimeLayerApprovalPostCommitPortService",
      "RuntimeLayerAppLogPortService",
      "RuntimeLayerCommandControlPortService",
      "RuntimeLayerCommandStdinPortService",
      "RuntimeLayerDevTelemetryPortService",
      "RuntimeLayerEventsPortService",
      "RuntimeLayerModelResolverPortService",
      "RuntimeLayerPromptHostPortService",
      "RuntimeLayerProviderAuthPortService",
      "RuntimeLayerRequestInputPostCommitPortService",
      "RuntimeLayerRequirements",
      "RuntimeLayerSourceEditsPortService",
      "RuntimeLayerSourceInvalidationPortService",
      "runAcceptedRequestUserInputToolCall",
      "RunAcceptedRequestUserInputToolCallInput",
      "RunAcceptedRequestUserInputToolCallResult",
      "runAcceptedLoadExtensionToolCall",
      "RunAcceptedLoadExtensionToolCallInput",
      "RunAcceptedLoadExtensionToolCallResult",
      "RuntimeQueueInsertPostCommitLane",
      "RuntimeQueueInsertPostCommitLaneService",
      "RuntimeQueueInsertPostCommitInput",
      "answerRuntimeApproval",
      "RuntimeApprovalAnswerPostCommitHost",
      "RuntimeApprovalAnsweredInput",
      "RuntimeApprovalAnswerPostCommitHostService",
      "answerRuntimeRequestInput",
      "RuntimeRequestInputPostCommitLane",
      "setRuntimeRequestInputTimerPaused",
      "RuntimeRequestInputAnswerCommittedInput",
      "RuntimeRequestInputPostCommitLaneService",
      "RuntimeRequestInputTimerPausedCommittedInput",
      "makeRuntimeBlockingRequestInputWaitRegistry",
      "RuntimeBlockingRequestInputEffectState",
      "RuntimeBlockingRequestInputWaitRegistry",
      "RuntimeBlockingRequestInputWaitRegistryOptions",
      "applyGeneratedPackageWorkspaceLinkRepairPlan",
      "generatedContextReasonForRuntimeSourceInvalidation",
      "generatedPackagesForRuntimeSourceInvalidation",
      "refreshRuntimeGeneratedPackages",
      "RuntimeGeneratedPackageRefreshHost",
      "RuntimeGeneratedPackageRefreshStatus",
      "RuntimeGeneratedPackageWorkspaceLinkFileHost",
      "RuntimeGeneratedPackageWorkspaceLinkStatus",
      "materializeRuntimeSubmittedMessageForQueue",
      "RuntimeMessageSubmissionPostCommitLane",
      "submitRuntimeMessage",
      "summarizeRuntimeSubmittedMessageForTelemetry",
      "RuntimeMaterializedSubmittedMessage",
      "RuntimeMessageSubmissionInput",
      "RuntimeMessageSubmissionPostCommitLaneService",
      "RuntimeSubmittedMessagePostCommitInput",
      "abortRuntimeQueuedMessage",
      "RuntimeQueuedMessageAbortPostCommitHost",
      "RuntimeQueuedMessageAbortedInput",
      "RuntimeQueuedMessageAbortInput",
      "RuntimeQueuedMessageAbortPostCommitHostService",
      "RuntimeQueueSteeringPostCommitLane",
      "steerRuntimeQueuedMessage",
      "RuntimeQueuedMessageSteeredInput",
      "RuntimeQueueSteeringPostCommitLaneService",
      "buildAppGlobalSourceWatchInputs",
      "RuntimeSourceInvalidationCoordinator",
      "buildWorkspaceSourceWatchInputs",
      "createSourceInvalidationCoordinator",
      "layerRuntimeSourceInvalidationCoordinator",
      "makeRuntimeSourceInvalidationCoordinator",
      "createSurfaceQueueDispatcher",
      "SurfaceQueueDispatcher",
      "SurfaceQueueDispatchHost",
      "SurfaceQueueMaterializedMessage",
      "SurfaceQueueStartedPrompt",
      "ExternalInstructionRootInput",
      "ExternalInstructionsWatchSettings",
      "RuntimeSourceInvalidationCoordinatorService",
      "SourceInvalidationCoordinator",
      "SourceInvalidationCoordinatorOptions",
      "SourceInvalidationDirectoryEntry",
      "SourceInvalidationDomain",
      "SourceInvalidationEvent",
      "SourceInvalidationHost",
      "SourceWatcher",
      "SourceWatchInput",
      "makeRuntimeEventBus",
      "RuntimeEventBus",
      "RuntimeEventBusOptions",
      "RuntimeEventDraft",
      "RuntimeEventSubscriptionEffect",
    ],
  ],
  [
    "@svvy/pi-adapter/messages",
    [
      "SvvyPiUserMessageMetadata",
      "SvvyPiTextContent",
      "SvvyPiImageContent",
      "SvvyPiUserMessageContent",
      "SvvyPiUserMessage",
      "RuntimeSubmittedMessagePiOptions",
      "buildPiUserMessageFromRuntimeSubmittedMessage",
      "runtimeSubmittedMessagePromptText",
    ],
  ],
  [
    "@svvy/pi-adapter/internal/session",
    [
      "CreatePiManagedAgentSessionInput",
      "CreatePiManagedAgentSessionResult",
      "createPiManagedAgentSession",
    ],
  ],
  [
    "@svvy/state/session-navigation",
    [
      "sortVisibleSessionsByRecency",
      "buildWorkspaceSessionNavigation",
      "flattenWorkspaceSessionNavigation",
      "DEFAULT_SESSION_SECTION_SIZES",
      "getDefaultSessionNavigationSectionState",
    ],
  ],
  [
    "@svvy/state/structured-session-selectors",
    [
      "StructuredCommandRollupChild",
      "StructuredCommandRollup",
      "StructuredCommandArtifactLink",
      "StructuredCommandOutputEvent",
      "StructuredCommandStdinEvent",
      "StructuredCommandStdinState",
      "StructuredCommandProgressEvent",
      "StructuredCommandArgumentSnapshot",
      "StructuredCommandPatchSnapshot",
      "StructuredCommandPatchFile",
      "StructuredCommandDiagnosticSnapshot",
      "StructuredCommandDiagnostic",
      "StructuredProductEvent",
      "StructuredCommandInspectorChild",
      "StructuredCommandInspector",
      "StructuredHandlerThreadWorkflowSummary",
      "StructuredHandlerThreadEpisodeSummary",
      "StructuredWorkflowTaskAttemptTranscriptMessage",
      "StructuredWorkflowTaskAttemptSummary",
      "StructuredWorkflowTaskAttemptInspector",
      "StructuredHandlerThreadSummary",
      "StructuredHandlerThreadInspector",
      "StructuredSidebarRowSubtitle",
      "StructuredSidebarWorkflowRow",
      "StructuredSidebarHandlerThreadRow",
      "StructuredSessionView",
      "StructuredSessionSummaryProjection",
      "buildStructuredArtifactLink",
      "buildStructuredSidebarThreadRows",
      "deriveStructuredSessionStatus",
      "buildStructuredSessionView",
      "buildStructuredSessionSummaryProjection",
      "groupThreadIdsByStatus",
      "hasStructuredSessionFacts",
      "buildStructuredCommandInspector",
      "buildStructuredWorkflowTaskAttemptInspector",
      "buildStructuredHandlerThreadSummaries",
      "buildStructuredHandlerThreadInspector",
      "StructuredThreadReadModelWait",
      "StructuredThreadReadModelEpisodeSummary",
      "StructuredThreadCompactRow",
      "StructuredThreadPendingReportRequest",
      "StructuredThreadCurrentReadModel",
      "StructuredThreadListReadModel",
      "StructuredThreadEpisodesReadModel",
      "StructuredThreadGroupReadModel",
      "BuildStructuredThreadListReadModelInput",
      "BuildStructuredThreadEpisodesReadModelInput",
      "getStructuredThread",
      "hasStructuredThreadGroup",
      "buildStructuredThreadCompactRow",
      "buildStructuredThreadCurrentReadModel",
      "buildStructuredThreadListReadModel",
      "buildStructuredThreadEpisodesReadModel",
      "buildStructuredThreadGroupReadModel",
      "getLatestFailureContext",
    ],
  ],
  [
    "@svvy/state/structured-session-state",
    [
      "StructuredSessionStatus",
      "StructuredTurnStatus",
      "STRUCTURED_TURN_DECISIONS",
      "StructuredTurnDecision",
      "StructuredThreadStatus",
      "StructuredThreadHistoryMode",
      "StructuredThreadObjectiveState",
      "StructuredWaitKind",
      "StructuredThreadWaitOwner",
      "StructuredWorkflowWaitKind",
      "StructuredCommandExecutor",
      "StructuredCommandVisibility",
      "StructuredCommandStatus",
      "StructuredRuntimeApprovalStatus",
      "StructuredRuntimeApprovalMode",
      "StructuredRuntimeApprovalToolName",
      "StructuredEpisodeKind",
      "StructuredArtifactKind",
      "StructuredWorkflowStatus",
      "StructuredWorkflowTaskAttemptKind",
      "StructuredWorkflowTaskAttemptStatus",
      "StructuredWorkflowTaskMessageRole",
      "StructuredGeneratedAgentContextActor",
      "StructuredGeneratedAgentContextBindingOwner",
      "StructuredWorkflowTaskMessageSource",
      "StructuredTitleGenerationStatus",
      "StructuredWorkspaceRecord",
      "StructuredWorkspaceInput",
      "StructuredPiSessionRecord",
      "StructuredComposerDraftRecord",
      "StructuredWaitState",
      "StructuredSessionWaitOwner",
      "StructuredSessionWaitState",
      "StructuredTurnRecord",
      "StructuredThreadRecord",
      "StructuredGeneratedAgentContextBindingRecord",
      "StructuredCommandRecord",
      "StructuredEpisodeRecord",
      "StructuredWorkflowRunRecord",
      "StructuredWorkflowTaskAttemptRecord",
      "StructuredWorkflowTaskMessageRecord",
      "StructuredRequestUserInputVariant",
      "StructuredRequestUserInputStatus",
      "StructuredRequestUserInputQuestionStatus",
      "StructuredRequestUserInputAnsweredBy",
      "StructuredRequestUserInputDelivery",
      "StructuredRequestUserInputAnswer",
      "StructuredRequestUserInputOptionRecord",
      "StructuredRequestUserInputQuestionRecord",
      "StructuredRequestUserInputAnswerRecord",
      "StructuredRequestUserInputRequestRecord",
      "StructuredRuntimeApprovalRequestRecord",
      "StructuredArtifactRecord",
      "StructuredEventSubjectKind",
      "StructuredLifecycleEventRecord",
      "StructuredSurfaceQueuedMessageStatus",
      "StructuredSurfaceQueueItemKind",
      "StructuredSurfaceQueuePriority",
      "StructuredRecoveryWorkKind",
      "StructuredRecoveryWorkStatus",
      "StructuredRecoveryWorkOwnerScope",
      "StructuredRecoveryWorkRecord",
      "StructuredGeneratedPackageFactRecord",
      "StructuredGeneratedPackageWorkspaceLinkRecord",
      "StructuredExtensionDependencyReadinessRecord",
      "StructuredSurfaceQueuedMessageRecord",
      "StructuredRuntimeHandlerThreadGeneratedContextBindingInput",
      "StructuredRuntimeHandlerThreadInitialQueueInput",
      "StructuredStartRuntimeHandlerThreadInput",
      "StructuredStartRuntimeHandlerThreadsInput",
      "StructuredStartedRuntimeHandlerThread",
      "StructuredStartRuntimeHandlerThreadsResult",
      "StructuredSessionSnapshot",
      "StructuredWorkspaceSidebarState",
      "StructuredThreadDetail",
      "CreateStructuredSessionStateStoreOptions",
      "StructuredSessionStateStore",
      "StructuredSessionStateService",
      "StructuredSessionState",
      "structuredSessionStateFromStore",
      "makeStructuredSessionState",
      "layerStructuredSessionState",
      "createStructuredSessionStateStore",
    ],
  ],
]);
const allowedPublicSubpathImports = new Set(
  Array.from(expectedPublicExports.entries()).flatMap(([packageName, exports]) =>
    Object.keys(exports)
      .filter((subpath) => subpath !== ".")
      .map((subpath) => `${packageName}/${subpath.slice(2)}`),
  ),
);

function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".svelte")) {
      files.push(path);
    }
  }
  return files;
}

function packageNameForSourceFile(file: string): string {
  const relativePath = relative(packageRoot, file);
  const [packageDirectory] = relativePath.split(sep);
  return `@svvy/${packageDirectory}`;
}

function listMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listMarkdownFiles(path));
    } else if (path.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function readImports(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return Array.from(
    source.matchAll(IMPORT_PATTERN),
    (match) => match[1] ?? match[2] ?? match[3] ?? match[4],
  ).filter((specifier): specifier is string => Boolean(specifier));
}

function readValueImportBindings(
  path: string,
  moduleSpecifier: string,
): Array<
  | { kind: "namespace"; localName: string }
  | { kind: "named"; importedName: string; localName: string }
> {
  const source = readFileSync(path, "utf8");
  const escapedModule = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(
    `\\bimport\\s+(type\\s+)?([\\s\\S]*?)\\s+from\\s+["']${escapedModule}["']`,
    "g",
  );
  return Array.from(source.matchAll(importPattern)).flatMap((match) => {
    const isTypeImport = Boolean(match[1]);
    const clause = match[2]?.trim();
    if (isTypeImport || !clause || clause.startsWith("type ")) return [];

    const namespace = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (namespace) {
      return [{ kind: "namespace" as const, localName: namespace[1]! }];
    }

    const named = clause.match(/\{([\s\S]*?)\}/);
    if (!named) return [];

    return named[1]!
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => {
        if (part.startsWith("type ")) return [];
        const alias = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!alias) return [];
        const importedName = alias[1]!;
        return [
          {
            kind: "named" as const,
            importedName,
            localName: alias[2] ?? importedName,
          },
        ];
      });
  });
}

function isEffectPackageSpecifier(specifier: string): boolean {
  return (
    specifier === "effect" || specifier.startsWith("effect/") || specifier.startsWith("@effect/")
  );
}

function readEffectRuntimeMemberReads(path: string): Map<string, Set<string>> {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const namespaceImports = new Map<string, string>();
  const moduleMembers = new Map<string, Set<string>>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!isEffectPackageSpecifier(moduleSpecifier)) {
      continue;
    }
    const importClause = statement.importClause;
    const namedBindings = importClause.namedBindings;
    if (!namedBindings) {
      continue;
    }
    if (ts.isNamespaceImport(namedBindings) && !importClause.isTypeOnly) {
      namespaceImports.set(namedBindings.name.text, moduleSpecifier);
      continue;
    }
    if (ts.isNamedImports(namedBindings)) {
      for (const importSpecifier of namedBindings.elements) {
        if (importClause.isTypeOnly || importSpecifier.isTypeOnly) {
          continue;
        }
        const importedName = (importSpecifier.propertyName ?? importSpecifier.name).text;
        addEffectMemberRead(moduleMembers, moduleSpecifier, importedName);
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const moduleSpecifier = namespaceImports.get(node.expression.text);
      if (moduleSpecifier) {
        addEffectMemberRead(moduleMembers, moduleSpecifier, node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return moduleMembers;
}

function readEffectTypeOnlyImportModules(path: string): Set<string> {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const modules = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!isEffectPackageSpecifier(moduleSpecifier)) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause.isTypeOnly) {
      modules.add(moduleSpecifier);
      continue;
    }
    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const importSpecifier of importClause.namedBindings.elements) {
        if (importSpecifier.isTypeOnly) {
          modules.add(moduleSpecifier);
        }
      }
    }
  }

  return modules;
}

function addEffectMemberRead(
  moduleMembers: Map<string, Set<string>>,
  moduleSpecifier: string,
  member: string,
): void {
  const members = moduleMembers.get(moduleSpecifier) ?? new Set<string>();
  members.add(member);
  moduleMembers.set(moduleSpecifier, members);
}

function readNamedImportNames(path: string, moduleSpecifier: string): string[] {
  const source = readFileSync(path, "utf8");
  const escapedModule = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(
    `\\bimport\\s+(?:type\\s+)?([\\s\\S]*?)\\s+from\\s+["']${escapedModule}["']`,
    "g",
  );
  return Array.from(source.matchAll(importPattern)).flatMap((match) => {
    const clause = match[1]?.trim();
    const named = clause?.match(/\{([\s\S]*?)\}/);
    if (!named) return [];
    return named[1]!
      .split(",")
      .map((part) => part.trim().replace(/^type\s+/, ""))
      .filter(Boolean)
      .map((part) => part.match(/^([A-Za-z_$][\w$]*)/)?.[1])
      .filter((name): name is string => Boolean(name));
  });
}

function readStaticSourceImports(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return Array.from(
    source.matchAll(
      /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|(?:^|\n)\s*export\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']/g,
    ),
    (match) => match[1] ?? match[2],
  ).filter((specifier): specifier is string => Boolean(specifier));
}

function readRuntimeModuleLoads(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return Array.from(
    source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    (match) => match[1] ?? match[2],
  ).filter((specifier): specifier is string => Boolean(specifier));
}

function readPackageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("node:") || specifier.startsWith("bun:")) {
    return null;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

function readPublicExportedNames(path: string, visited = new Set<string>()): string[] {
  const source = readSource(path);
  const names = [
    ...Array.from(
      source.matchAll(
        /^export\s+(?:declare\s+)?(?:async\s+)?(?:class|interface|type|const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm,
      ),
      (match) => match[1],
    ),
    ...Array.from(source.matchAll(/^export\s+(?:type\s+)?\{([^}]+)\}/gm)).flatMap((match) =>
      match[1]!
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const alias = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
          return alias?.[1] ?? part.split(/\s+/)[0]!;
        }),
    ),
  ];
  const reExportedNames = Array.from(
    source.matchAll(/^export\s+\*\s+from\s+["'](.+)["']/gm),
    (match) => match[1],
  ).flatMap((specifier) => {
    if (!specifier?.startsWith(".")) return [];
    const reExportPath = join(dirname(path), `${specifier}.ts`);
    if (visited.has(reExportPath)) return [];
    visited.add(reExportPath);
    return readPublicExportedNames(reExportPath, visited);
  });
  return [...names, ...reExportedNames];
}

function listLocalExportClosure(path: string, visited = new Set<string>()): string[] {
  if (visited.has(path)) return [];
  visited.add(path);
  const source = readSource(path);
  const localExportPaths = Array.from(
    source.matchAll(/^export\s+(?:type\s+)?(?:\*|\{[^}]+\})\s+from\s+["'](.+)["']/gm),
    (match) => match[1],
  )
    .filter((specifier): specifier is string => Boolean(specifier?.startsWith(".")))
    .map((specifier) => join(dirname(path), `${specifier}.ts`));
  return [
    path,
    ...localExportPaths.flatMap((exportPath) => listLocalExportClosure(exportPath, visited)),
  ];
}

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function readPackageManifest(packageName: string): {
  name?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  const packagePath = packageName.replace("@svvy/", "");
  return JSON.parse(readFileSync(join(packageRoot, packagePath, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

function readRootPackageManifest(): {
  workspaces?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
    workspaces?: string[];
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

function readBunLock(): {
  packages?: Record<string, [string, string, { peerDependencies?: Record<string, string> }]>;
} {
  const lockSource = readFileSync(join(projectRoot, "bun.lock"), "utf8");
  const jsonSource = lockSource.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(jsonSource) as {
    packages?: Record<string, [string, string, { peerDependencies?: Record<string, string> }]>;
  };
}

function isTestFile(path: string): boolean {
  return (
    path.endsWith(".test.ts") || path.endsWith(".spec.ts") || path.endsWith(".test-support.ts")
  );
}

function isEffectTestLaneFile(path: string): boolean {
  const relativePath = display(path);
  return relativePath.startsWith("packages/") && relativePath.endsWith(".effect.test.ts");
}

function display(path: string): string {
  return relative(projectRoot, path).split(sep).join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("package boundaries", () => {
  it("feature inventory source specs point at committed product spec files", () => {
    const missingSpecs = PRODUCT_FEATURES.flatMap((feature) =>
      feature.sourceSpecs
        .filter((sourceSpec) => !existsSync(join(projectRoot, sourceSpec)))
        .map((sourceSpec) => `${feature.id} -> ${sourceSpec}`),
    );

    expect(missingSpecs).toEqual([]);
  });

  it("feature inventory exactly pins the active package architecture specs", () => {
    const feature = PRODUCT_FEATURES.find(
      (candidate) => candidate.id === "effect-package-architecture",
    );

    expect(feature?.sourceSpecs).toEqual(expectedPackageArchitectureSourceSpecs);
  });

  it("package architecture spec inventory stays exact and includes the Effect v4 spec", () => {
    const actual = readdirSync(packageArchitectureSpecRoot)
      .filter((entry) => entry.endsWith(".md"))
      .toSorted();

    expect(actual).toEqual(expectedPackageArchitectureSpecFiles);
  });

  it("state spec inventories exact core runtime state-port method names", () => {
    const coreSource = readSource(join(packageRoot, "core", "src", "runtime-state-ports.ts"));
    const stateSpec = readSource(join(packageArchitectureSpecRoot, "state.spec.md"));
    const extractContractBlocks = (portName: string): string[] => {
      const blocks: string[] = [];
      const starts = [
        ...Array.from(stateSpec.matchAll(new RegExp(`type ${portName}\\s*=\\s*\\{`, "g"))),
        ...Array.from(stateSpec.matchAll(new RegExp(`interface ${portName}\\s*\\{`, "g"))),
      ].map((match) => match.index ?? -1);
      for (const start of starts) {
        if (start < 0) continue;
        const openBrace = stateSpec.indexOf("{", start);
        if (openBrace < 0) continue;
        let depth = 0;
        for (let index = openBrace; index < stateSpec.length; index += 1) {
          const char = stateSpec[index];
          if (char === "{") depth += 1;
          if (char === "}") depth -= 1;
          if (depth === 0) {
            blocks.push(stateSpec.slice(openBrace + 1, index));
            break;
          }
        }
      }
      return blocks;
    };
    const corePorts = Array.from(
      coreSource.matchAll(/export interface (Runtime[A-Za-z]+StatePortService) \{([\s\S]*?)\n\}/g),
      (match) => {
        const serviceName = match[1] ?? "";
        const body = match[2] ?? "";
        return {
          portName: serviceName.replace(/Service$/, ""),
          methods: Array.from(
            body.matchAll(/^\s{2}(?:readonly\s+)?([a-z][A-Za-z0-9_]*)\s*\(/gm),
            (methodMatch) => methodMatch[1] ?? "",
          ).filter(Boolean),
        };
      },
    );
    const mismatches = corePorts.flatMap(({ portName, methods }) => {
      const inventoryPattern = new RegExp(
        `${portName}:\\n\\n- Caller:[\\s\\S]*?\\n- Methods: ([\\s\\S]*?)\\.\\n- Rule:`,
      );
      const inventoryMatch = stateSpec.match(inventoryPattern);
      if (!inventoryMatch) {
        return [`${portName} missing state.spec.md method inventory`];
      }
      const inventory = (inventoryMatch[1] ?? "")
        .replace(/\s+/g, " ")
        .split(",")
        .map((method) => method.trim())
        .filter(Boolean)
        .toSorted();
      const expected = methods.toSorted();
      return JSON.stringify(inventory) === JSON.stringify(expected)
        ? []
        : [
            `${portName} inventory ${JSON.stringify(inventory)} expected ${JSON.stringify(expected)}`,
          ];
    });
    const contractMismatches = corePorts.flatMap(({ portName, methods }) => {
      const contractMethods = [
        ...new Set(
          extractContractBlocks(portName).flatMap((block) =>
            Array.from(
              block.matchAll(/^\s*(?:readonly\s+)?([a-z][A-Za-z0-9_]*)\s*\(/gm),
              (match) => match[1] ?? "",
            ).filter(Boolean),
          ),
        ),
      ].toSorted();
      const expected = methods.toSorted();
      return JSON.stringify(contractMethods) === JSON.stringify(expected)
        ? []
        : [
            `${portName} contract ${JSON.stringify(contractMethods)} expected ${JSON.stringify(expected)}`,
          ];
    });

    expect({ mismatches, contractMismatches }).toEqual({
      mismatches: [],
      contractMismatches: [],
    });
  });

  it("obsolete package architecture todo directory does not exist", () => {
    expect(existsSync(join(projectRoot, "docs", "specs", "package-architecture.todo"))).toBe(false);
  });

  it("product specs use active package architecture paths instead of todo spec names", () => {
    const productSpecFiles = [
      join(projectRoot, "docs", "prd.md"),
      join(projectRoot, "docs", "features.ts"),
      join(projectRoot, "docs", "progress.md"),
      ...listMarkdownFiles(productSpecRoot),
    ];
    const stalePatterns = [
      /package-architecture\.todo/,
      /\.spec\.todo\.md/,
      /docs\/specs\/package-architecture\.todo/,
      /package[_-]architecture\.spec\.todo/,
      /staging Bun adapter/,
      /Bun native-tool wrappers/,
      /src\/bun\/default-system-prompt\.ts/,
      /src\/bun` lifecycle code/,
    ];
    const violations = productSpecFiles.flatMap((file) => {
      const source = readSource(file);
      return stalePatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${display(file)} -> ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });

  it("@svvy/core does not import implementation packages or runtime-only modules", () => {
    const violations = listTypeScriptFiles(join(packageRoot, "core", "src")).flatMap((file) =>
      readImports(file)
        .filter(
          (specifier) =>
            specifier.startsWith("@svvy/state") ||
            specifier.startsWith("@svvy/runtime") ||
            specifier.startsWith("@svvy/pi-adapter") ||
            specifier.startsWith("@svvy/sandbox") ||
            specifier.startsWith("@svvy/extensions") ||
            specifier.startsWith("@svvy/desktop") ||
            specifier.startsWith("@mariozechner/") ||
            (specifier.startsWith("node:") && !isTestFile(file)) ||
            (specifier.startsWith("bun:") && !(isTestFile(file) && specifier === "bun:test")) ||
            specifier.startsWith("../") ||
            specifier.startsWith("../../") ||
            specifier.includes("/src/"),
        )
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("extracted packages do not import across package roots with relative paths", () => {
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) => {
        const packageDirectory = join(
          packageRoot,
          packageNameForSourceFile(file).replace("@svvy/", ""),
        );
        return readImports(file)
          .filter((specifier) => specifier.startsWith("./") || specifier.startsWith("../"))
          .map((specifier) => ({
            specifier,
            resolved: resolve(dirname(file), specifier),
          }))
          .filter(({ resolved }) => {
            const relativeToPackage = relative(packageDirectory, resolved);
            return (
              relativeToPackage === ".." ||
              relativeToPackage.startsWith(`..${sep}`) ||
              relativeToPackage.startsWith(`${sep}`)
            );
          })
          .map(({ specifier }) => `${display(file)} -> ${specifier}`);
      }),
    );

    expect(violations).toEqual([]);
  });

  it("extracted packages do not import generated @svvyx authoring packages", () => {
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter((specifier) => specifier.startsWith("@svvyx/"))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("runtime and app source do not import generated authoring packages or rejected public facades", () => {
    const forbiddenImports = new Set([
      "@svvyx/workflows",
      "@svvyx/extensions",
      ...rejectedPublicPackageNames,
    ]);
    const violations = [...sourceRoots, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        isTestFile(file)
          ? []
          : [...readStaticSourceImports(file), ...readRuntimeModuleLoads(file)]
              .filter((specifier) =>
                Array.from(forbiddenImports).some(
                  (forbiddenImport) =>
                    specifier === forbiddenImport || specifier.startsWith(`${forbiddenImport}/`),
                ),
              )
              .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("generated package specs do not authorize Effect service or runtime imports", () => {
    const generatedPackageSpec = readSource(
      join(packageArchitectureSpecRoot, "generated-packages.spec.md"),
    );
    const forbiddenGeneratedEffectImportPatterns = [
      /It may import Effect/i,
      /generated package declares that dependency/i,
      /generated `@svvyx\/\*` packages .* import .*effect/i,
      /@svvyx\/workflows` may import Effect/i,
    ];
    const violations = forbiddenGeneratedEffectImportPatterns
      .filter((pattern) => pattern.test(generatedPackageSpec))
      .map((pattern) => pattern.source);

    expect(violations).toEqual([]);
    expect(generatedPackageSpec).toContain(
      "It must not import `effect`, any `effect/*` subpath, or any `@effect/*` package.",
    );
  });

  it("@svvy/state depends only on core, Effect, local modules, and platform storage modules", () => {
    const allowedPackageImports = new Set(["@svvy/core"]);
    const allowedPrefixes = ["effect/", "node:", "bun:sqlite", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "state", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (isTestFile(file) && specifier === "bun:test") return false;
          if (isEffectTestLaneFile(file) && specifier === "@effect/vitest") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/sandbox depends only on core, Effect, local modules, and Node platform modules", () => {
    const allowedPackageImports = new Set(["@svvy/core"]);
    const allowedPrefixes = ["effect/", "node:", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "sandbox", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (isTestFile(file) && specifier === "bun:test") return false;
          if (isEffectTestLaneFile(file) && specifier === "@effect/vitest") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/pi-adapter depends only on core, Effect, pi runtime packages, local modules, and test modules", () => {
    const allowedPackageImports = new Set([
      "@svvy/core",
      "@mariozechner/pi-ai",
      "@mariozechner/pi-coding-agent",
    ]);
    const allowedPrefixes = ["node:", "effect/", "@mariozechner/pi-coding-agent/", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "pi-adapter", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (isTestFile(file) && specifier === "bun:test") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/runtime depends only on target runtime dependencies, Effect, local modules, and approved platform modules", () => {
    const allowedPackageImports = new Set([
      "@effect/platform-bun",
      "@svvy/core",
      "@svvy/extensions",
      "@svvy/pi-adapter",
      "@svvy/sandbox",
    ]);
    const allowedPrefixes = ["@effect/platform-bun/", "effect/", "node:", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "runtime", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (isTestFile(file) && specifier === "bun:test") return false;
          if (isEffectTestLaneFile(file) && specifier === "@effect/vitest") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/runtime has no direct @svvy/state package dependency or imports", () => {
    const runtimeManifest = readPackageManifest("@svvy/runtime");
    const stateDependencies = Object.keys(runtimeManifest.dependencies ?? {}).filter(
      (dependency) => dependency === "@svvy/state" || dependency.startsWith("@svvy/state/"),
    );
    const stateImports = listTypeScriptFiles(join(packageRoot, "runtime", "src"))
      .flatMap((file) =>
        readImports(file)
          .filter(
            (specifier) => specifier === "@svvy/state" || specifier.startsWith("@svvy/state/"),
          )
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(stateDependencies).toEqual([]);
    expect(stateImports).toEqual([]);
  });

  it("@svvy/extensions depends only on core, Effect, local modules, and test modules", () => {
    const allowedPackageImports = new Set(["@svvy/core"]);
    const allowedPrefixes = ["effect/", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "extensions", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (isTestFile(file) && specifier === "bun:test") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/desktop depends only on core, state, runtime, Effect, local modules, and UI/app edge modules", () => {
    const allowedPackageImports = new Set(["@svvy/core", "@svvy/state", "@svvy/runtime"]);
    const allowedPrefixes = [
      "effect/",
      "@fontsource",
      "@lucide/",
      "@tanstack/",
      "cmdk-sv",
      "dockview-core",
      "electrobun",
      "katex",
      "markdown-it",
      "mermaid",
      "svelte",
      "./",
    ];
    const violations = listTypeScriptFiles(join(packageRoot, "desktop", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (isTestFile(file) && specifier === "bun:test") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("only @svvy/pi-adapter imports pi runtime packages from extracted packages", () => {
    const piAdapterRoot = join(packageRoot, "pi-adapter", "src");
    const violations = sourceRoots
      .filter((root) => root !== piAdapterRoot)
      .flatMap((root) =>
        listTypeScriptFiles(root).flatMap((file) =>
          readImports(file)
            .filter((specifier) => specifier.startsWith("@mariozechner/"))
            .map((specifier) => `${display(file)} -> ${specifier}`),
        ),
      );

    expect(violations).toEqual([]);
  });

  it("@svvy/pi-adapter root pi-native imports stay in adapter implementation files", () => {
    const rootExportFiles = listLocalExportClosure(
      join(packageRoot, "pi-adapter", "src", "index.ts"),
    );
    const violations = rootExportFiles.flatMap((file) =>
      readImports(file)
        .filter((specifier) => specifier.startsWith("@mariozechner/"))
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );
    const expected: string[] = [];

    expect(violations).toEqual(expected);
  });

  it("@svvy/pi-adapter messages exposes structural DTOs without pi-native type aliases", () => {
    const messagesModule = join(packageRoot, "pi-adapter", "src", "messages.ts");
    const source = readSource(messagesModule);
    const imports = readImports(messagesModule)
      .filter((specifier) => specifier.startsWith("@mariozechner/"))
      .map((specifier) => `${display(messagesModule)} -> ${specifier}`);
    const leakedTypeAliases = [
      /\bimport\s+type\s+\{[^}]*\b(?:Message|TextContent|ImageContent)\b[^}]*\}\s+from\s+["']@mariozechner\/pi-ai["']/,
      /\bSvvyPiUserMessage\s*=\s*Message\b/,
      /\bArray<\s*(?:TextContent|ImageContent)\s*>/,
    ]
      .filter((pattern) => pattern.test(source))
      .map((pattern) => `${display(messagesModule)} -> ${pattern}`);

    expect([...imports, ...leakedTypeAliases]).toEqual([]);
  });

  it("@svvy/core owns pi-adapter boundary contracts without importing pi native packages", () => {
    expect(existsSync(join(packageRoot, "pi-adapter", "src", "contracts.ts"))).toBe(false);

    const contractFiles = [
      join(packageRoot, "core", "src", "pi-adapter-contracts.ts"),
      join(packageRoot, "core", "src", "pi-adapter-ports.ts"),
      join(packageRoot, "core", "src", "provider-auth-ports.ts"),
    ];
    const violations = contractFiles.flatMap((file) =>
      readImports(file)
        .filter((specifier) => specifier.startsWith("@mariozechner/"))
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/core remains a contract and port package without runtime layers", () => {
    const forbiddenPatterns = [
      { pattern: /\bLayer\./, name: "Layer.*" },
      { pattern: /\bManagedRuntime\./, name: "ManagedRuntime.*" },
      { pattern: /\bEffect\.run(?:Promise|Sync|Fork|ForkWith)\b/, name: "Effect runtime runner" },
      { pattern: /\bexport\s+const\s+layer[A-Z]/, name: "exported layer factory" },
    ];
    const violations = listTypeScriptFiles(join(packageRoot, "core", "src"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        return [
          ...readImports(file)
            .filter(
              (specifier) =>
                specifier === "effect/Layer" ||
                specifier === "effect/ManagedRuntime" ||
                specifier === "effect/Runtime",
            )
            .map((specifier) => `${display(file)} -> ${specifier}`),
          ...forbiddenPatterns
            .filter(({ pattern }) => pattern.test(source))
            .map(({ name }) => `${display(file)} -> ${name}`),
        ];
      });

    expect(violations).toEqual([]);
  });

  it("@svvy/core migrated data-only ports use function-syntax Context.Service", () => {
    const migratedCoreDataOnlyPorts = [
      { file: "extension-state-ports.ts", names: ["ExtensionStatePort"] },
      { file: "app-log-contracts.ts", names: ["AppLogWritePort"] },
      { file: "sandbox-policy-contracts.ts", names: ["SandboxPolicySource"] },
      {
        file: "provider-auth-ports.ts",
        names: ["ProviderAuthPort", "ProviderAuthStatusStatePort"],
      },
      { file: "secret-store-ports.ts", names: ["SecretStorePort"] },
      { file: "pi-adapter-ports.ts", names: ["PiSessionReferencePort", "PiRuntimePathsPort"] },
      {
        file: "runtime-state-ports.ts",
        names: [
          "RuntimeActorExtensionBindingStatePort",
          "RuntimeApprovalStatePort",
          "RuntimeArtifactStatePort",
          "RuntimeComposerDraftStatePort",
          "RuntimeCommandStatePort",
          "RuntimeEpisodeStatePort",
          "RuntimeExtensionContextImpactStatePort",
          "RuntimeExtensionStatePort",
          "RuntimeGeneratedPackageStatePort",
          "RuntimeQueueStatePort",
          "RuntimeReadModelStatePort",
          "RuntimeRecoveryStatePort",
          "RuntimeRequestStatePort",
          "RuntimeSessionWaitStatePort",
          "RuntimeSourceStatePort",
          "RuntimeSurfaceLifecycleStatePort",
          "RuntimeThreadStatePort",
          "RuntimeTurnStatePort",
          "RuntimeWorkspaceStatePort",
        ],
      },
    ];

    for (const { file, names } of migratedCoreDataOnlyPorts) {
      const source = readSource(join(packageRoot, "core", "src", file));
      const normalized = source.replace(/\s+/g, " ");

      for (const name of names) {
        expect(source).toContain(`export interface ${name}`);
        expect(source).toContain(`export interface ${name}Service`);
        expect(normalized).toContain(`export interface ${name} { readonly _tag: "${name}"; }`);
        expect(normalized).toMatch(
          new RegExp(
            `export const ${name} = Context\\.Service<\\s*${name},\\s*${name}Service\\s*>\\(\\s*"@svvy/core/${name}",?\\s*\\);`,
          ),
        );
        expect(source).not.toContain(`class ${name} extends Context.Service`);
      }
    }

    const runtimeStatePortSource = readSource(
      join(packageRoot, "core", "src", "runtime-state-ports.ts"),
    );
    const actualRuntimeStatePorts = Array.from(
      runtimeStatePortSource.matchAll(/\bexport\s+interface\s+(Runtime[A-Za-z]+StatePort)\s*\{/g),
      (match) => match[1]!,
    ).toSorted();
    const expectedRuntimeStatePorts = migratedCoreDataOnlyPorts
      .find(({ file }) => file === "runtime-state-ports.ts")!
      .names.toSorted();

    expect(actualRuntimeStatePorts).toEqual(expectedRuntimeStatePorts);
  });

  it("package-local migrated host/config ports use function-syntax Context.Service", () => {
    const migratedPackageLocalPorts = [
      {
        packageName: "extensions",
        file: "extension-source-roots-port.ts",
        names: ["ExtensionSourceRootsPort"],
      },
      {
        packageName: "extensions",
        file: "generated-package-root-port.ts",
        names: ["GeneratedPackageRootPort"],
      },
      {
        packageName: "extensions",
        file: "packaged-extension-templates-port.ts",
        names: ["PackagedExtensionTemplatesPort"],
      },
      {
        packageName: "extensions",
        file: "workspace-source-link-port.ts",
        names: ["WorkspaceSourceLinkPort"],
      },
      {
        packageName: "sandbox",
        file: "sandbox.ts",
        names: ["SandboxHelperCandidatesPort", "HostProcessReferencePort"],
      },
    ];

    for (const { packageName, file, names } of migratedPackageLocalPorts) {
      const source = readSource(join(packageRoot, packageName, "src", file));
      const normalized = source.replace(/\s+/g, " ");

      for (const name of names) {
        expect(source).toContain(`export interface ${name}`);
        expect(source).toContain(`export interface ${name}Service`);
        expect(normalized).toContain(`export interface ${name} { readonly _tag: "${name}"; }`);
        expect(normalized).toMatch(
          new RegExp(
            `export const ${name} = Context\\.Service<\\s*${name},\\s*${name}Service\\s*>\\(\\s*"@svvy/${packageName}/${name}",?\\s*\\);`,
          ),
        );
        expect(source).not.toContain(`class ${name} extends Context.Service`);
      }
    }
  });

  it("@svvy/pi-adapter pi-native exported subpaths stay explicitly ledgered", () => {
    const manifest = readPackageManifest("@svvy/pi-adapter");
    const exports = manifest.exports as Record<string, string>;
    const actual = Object.entries(exports)
      .filter(([subpath]) => subpath !== ".")
      .map(([subpath, target]) => ({
        exportName: `@svvy/pi-adapter/${subpath.slice(2)}`,
        file: join(packageRoot, "pi-adapter", target.replace(/^\.\//, "")),
      }))
      .filter(({ file }) =>
        readImports(file).some((specifier) => specifier.startsWith("@mariozechner/")),
      )
      .map(({ exportName }) => exportName)
      .toSorted();
    const expected = Array.from(expectedPiAdapterInternalPiRuntimeExports.keys()).toSorted();

    expect(actual).toEqual(expected);
    for (const [exportName, file] of expectedPiAdapterInternalPiRuntimeExports) {
      const exportTarget = exports[`./${exportName.split("/").slice(2).join("/")}`];
      expect(exportTarget).toBe(`./${relative(join(packageRoot, "pi-adapter"), file)}`);
    }
  });

  it("extracted packages use direct Effect v4 module imports and do not import effect/Runtime", () => {
    const forbiddenEffectImports = new Set([
      "effect",
      "effect/Runtime",
      "effect/Effectable",
      "effect/Inspectable",
      "effect/Tag",
    ]);
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter((specifier) => forbiddenEffectImports.has(specifier))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("extracted packages import only adopted Effect modules", () => {
    const allowedEffectImports = new Set([
      "effect/Cause",
      "effect/Clock",
      "effect/Config",
      "effect/ConfigProvider",
      "effect/Context",
      "effect/Crypto",
      "effect/DateTime",
      "effect/Deferred",
      "effect/Effect",
      "effect/Encoding",
      "effect/Exit",
      "effect/Fiber",
      "effect/FileSystem",
      "effect/JsonSchema",
      "effect/Layer",
      "effect/Logger",
      "effect/ManagedRuntime",
      "effect/Metric",
      "effect/Option",
      "effect/Path",
      "effect/PlatformError",
      "effect/PubSub",
      "effect/Queue",
      "effect/Redacted",
      "effect/Ref",
      "effect/Schedule",
      "effect/Schema",
      "effect/SchemaIssue",
      "effect/Scope",
      "effect/Semaphore",
      "effect/Stream",
      "effect/Tracer",
      "effect/unstable/process",
      "effect/unstable/process/ChildProcess",
      "effect/unstable/process/ChildProcessSpawner",
    ]);
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter((specifier) => specifier === "effect" || specifier.startsWith("effect/"))
          .filter((specifier) => {
            if (specifier === "effect/testing") {
              return !isEffectTestLaneFile(file);
            }
            return !allowedEffectImports.has(specifier);
          })
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("Bun app production code imports only adopted Effect edge modules", () => {
    const allowedEffectEdgeImports = new Set([
      "effect/Cause",
      "effect/Effect",
      "effect/Exit",
      "effect/Layer",
      "effect/ManagedRuntime",
      "effect/Schema",
      "effect/Scope",
    ]);
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readImports(file)
          .filter(
            (specifier) =>
              specifier === "effect" ||
              specifier.startsWith("effect/") ||
              specifier.startsWith("@effect/"),
          )
          .filter((specifier) => !allowedEffectEdgeImports.has(specifier))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      );

    expect(violations).toEqual([]);
  });

  it("extracted package Effect function trace labels stay package-scoped", () => {
    const violations = sourceRoots.flatMap((root) => {
      const packageName = basename(dirname(root));
      const expectedPrefix = `@svvy/${packageName}/`;
      return listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return [...source.matchAll(/\bEffect\.fn\(\s*["']([^"']+)["']/g)]
            .map((match) => match[1])
            .filter((label) => label !== undefined && !label.startsWith(expectedPrefix))
            .map((label) => `${display(file)} -> ${label}`);
        });
    });

    expect(violations).toEqual([]);
  });

  it("extracted package Effect service ids are package-scoped and unique", () => {
    const serviceIdPatterns = [
      {
        kind: "Context.Service",
        pattern: /\bContext\.Service\s*<[\s\S]*?>\s*(?:\(\)\s*)?\(\s*["']([^"']+)["']\s*(?:,|\))/g,
      },
      {
        kind: "Context.Reference",
        pattern:
          /\bContext\.Reference\s*<[\s\S]*?>\s*(?:\(\)\s*)?\(\s*["']([^"']+)["']\s*(?:,|\))/g,
      },
      {
        kind: "LayerMap.Service",
        pattern: /\bLayerMap\.Service\s*<[\s\S]*?>\s*\(\)\s*\(\s*["']([^"']+)["']\s*(?:,|\))/g,
      },
    ];
    const serviceIds = sourceRoots.flatMap((root) => {
      const packageName = basename(dirname(root));
      const expectedPrefix = `@svvy/${packageName}/`;
      return listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return serviceIdPatterns.flatMap(({ kind, pattern }) =>
            Array.from(source.matchAll(pattern), (match) => ({
              file: display(file),
              id: match[1]!,
              expectedPrefix,
              kind,
            })),
          );
        });
    });
    const wrongScope = serviceIds
      .filter(({ id, expectedPrefix }) => !id.startsWith(expectedPrefix))
      .map(
        ({ file, id, expectedPrefix, kind }) =>
          `${file} -> ${kind} ${id} expected ${expectedPrefix}*`,
      );
    const idCounts = new Map<string, string[]>();
    for (const { file, id, kind } of serviceIds) {
      idCounts.set(id, [...(idCounts.get(id) ?? []), `${file} ${kind}`]);
    }
    const duplicates = Array.from(idCounts.entries())
      .filter(([, files]) => files.length > 1)
      .map(([id, files]) => `${id} -> ${files.join(", ")}`);

    expect({ wrongScope, duplicates }).toEqual({ wrongScope: [], duplicates: [] });
  });

  it("extracted package Effect service ids end with their exported service name", () => {
    const servicePattern =
      /\bexport\s+(?:class\s+([A-Za-z_$][\w$]*)\s+extends\s+Context\.Service|const\s+([A-Za-z_$][\w$]*)\s*=\s*Context\.Service)[\s\S]*?<[\s\S]*?>\s*(?:\(\)\s*)?\(\s*["']([^"']+)["']/g;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          Array.from(readSource(file).matchAll(servicePattern), (match) => {
            const serviceName = match[1] ?? match[2]!;
            const serviceId = match[3]!;
            const terminalName = serviceId.split("/").at(-1);
            return terminalName === serviceName
              ? null
              : `${display(file)} -> ${serviceName} uses ${serviceId}`;
          }).filter((violation): violation is string => violation !== null),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("exported scoped resources and services have package-spec lifetime matrix coverage", () => {
    const matrixHeaderPattern =
      /^\|\s*Resource\s*\|\s*Owner package\/service\s*\|\s*Backing kind\s*\|\s*Lifetime kind\s*\|\s*Acquired by\s*\|\s*Released by\s*\|\s*Reused across calls\s*\|\s*Interruption behavior\s*\|\s*Required receipts\/tests\s*\|/m;
    const resourceCoverage = [
      {
        specFile: "state.spec.md",
        exports: [
          "packages/state/src/app-log-store.ts -> AppLogState",
          "packages/state/src/app-log-store.ts -> layerAppLogState",
          "packages/state/src/app-log-write-port.ts -> layerAppLogWritePort",
          "packages/state/src/extension-state-port.ts -> layerExtensionStatePort",
          "packages/state/src/provider-auth-status-state-port.ts -> layerProviderAuthStatusStatePort",
          "packages/state/src/runtime-actor-extension-binding-state-port.ts -> layerRuntimeActorExtensionBindingStatePort",
          "packages/state/src/runtime-approval-state-port.ts -> layerRuntimeApprovalStatePort",
          "packages/state/src/runtime-artifact-state-port.ts -> layerRuntimeArtifactStatePort",
          "packages/state/src/runtime-command-state-port.ts -> layerRuntimeCommandStatePort",
          "packages/state/src/runtime-composer-draft-state-port.ts -> layerRuntimeComposerDraftStatePort",
          "packages/state/src/runtime-episode-state-port.ts -> layerRuntimeEpisodeStatePort",
          "packages/state/src/runtime-extension-context-impact-state-port.ts -> layerRuntimeExtensionContextImpactStatePort",
          "packages/state/src/runtime-extension-state-port.ts -> layerRuntimeExtensionStatePort",
          "packages/state/src/runtime-generated-package-state-port.ts -> layerRuntimeGeneratedPackageStatePort",
          "packages/state/src/runtime-queue-state-port.ts -> layerRuntimeQueueStatePort",
          "packages/state/src/runtime-read-model-state-port.ts -> layerRuntimeReadModelStatePort",
          "packages/state/src/runtime-recovery-state-port.ts -> layerRuntimeRecoveryStatePort",
          "packages/state/src/runtime-request-state-port.ts -> layerRuntimeRequestStatePort",
          "packages/state/src/runtime-session-wait-state-port.ts -> layerRuntimeSessionWaitStatePort",
          "packages/state/src/runtime-source-state-port.ts -> layerRuntimeSourceStatePort",
          "packages/state/src/runtime-surface-lifecycle-state-port.ts -> layerRuntimeSurfaceLifecycleStatePort",
          "packages/state/src/runtime-thread-state-port.ts -> layerRuntimeThreadStatePort",
          "packages/state/src/runtime-turn-state-port.ts -> layerRuntimeTurnStatePort",
          "packages/state/src/runtime-workspace-state-port.ts -> layerRuntimeWorkspaceStatePort",
          "packages/state/src/sandbox-policy-source.ts -> layerSandboxPolicySource",
          "packages/state/src/state-facade.ts -> StateCommands",
          "packages/state/src/state-facade.ts -> StateReadModels",
          "packages/state/src/state-facade.ts -> layer",
          "packages/state/src/structured-session-state.ts -> StructuredSessionState",
          "packages/state/src/structured-session-state.ts -> layerStructuredSessionState",
        ],
        resources: [
          "SQLite database handle",
          "Migration and pragma setup",
          "Secret-store adapter",
          "Artifact durable root metadata",
          "Artifact temporary staging directories",
          "State read-model projection rows",
          "App log rows",
        ],
      },
      {
        specFile: "sandbox.spec.md",
        exports: [
          "packages/sandbox/src/sandbox.ts -> Sandbox",
          "packages/sandbox/src/sandbox.ts -> layer",
        ],
        resources: [
          "Sandbox policy snapshot",
          "Temporary sandbox profile file",
          "Helper artifact/path resolution",
          "Trusted launch object with raw env",
        ],
      },
      {
        specFile: "pi-adapter.spec.md",
        exports: [
          "packages/pi-adapter/src/pi-adapter.ts -> PiAdapter",
          "packages/pi-adapter/src/pi-adapter.ts -> layer",
        ],
        resources: [
          "Live pi session handle",
          "Pi turn stream subscription",
          "Runtime custom-tool callback bridge",
          "Operation-scoped helper pi session",
          "Protocol/helper child process, when used",
        ],
      },
      {
        specFile: "extensions.spec.md",
        exports: [
          "packages/extensions/src/extensions-service.ts -> Extensions",
          "packages/extensions/src/extensions-service.ts -> layerExtensions",
        ],
        resources: [
          "Extension source file read/edit session",
          "Scripted instruction generator process/effect",
          "Generated package temporary directory",
          "Generated package root and manifest",
          "CLI requirement probe subprocess",
          "Dependency install/update subprocess",
          "Extension reference eligibility cache",
          "Source edit file write/staging",
          "Dependency probe/generator child process",
          "Generated context cache file, when emitted",
        ],
      },
      {
        specFile: "runtime.spec.md",
        exports: [
          "packages/runtime/src/index.ts -> Runtime",
          "packages/runtime/src/index.ts -> layer",
          "packages/runtime/src/runtime-event-bus.ts -> RuntimeEventBus",
          "packages/runtime/src/runtime-event-bus.ts -> layerRuntimeEventBus",
          "packages/runtime/src/source-invalidation-coordinator.ts -> RuntimeSourceInvalidationCoordinator",
          "packages/runtime/src/source-invalidation-coordinator.ts -> layerRuntimeSourceInvalidationCoordinator",
        ],
        resources: [
          "App runtime event bus",
          "`WorkspaceRuntimeMap` entry",
          "`SurfaceRuntimeMap` entry",
          "Workflow task-attempt runtime",
          "Prompt lock",
          "Active turn fiber",
          "Queue dispatcher and wakeup queue",
          "Recovery coordinator",
          "Title worker",
          "Request-input wait registry",
          "App/workspace source coordinators",
          "Generated-package refresh worker",
          "Workspace link-repair worker",
          "Command sessions/subprocess handles",
          "Workflow task-agent bridge operation registry",
          "Facade event subscriptions",
          "Bridge `AsyncIterable` scopes",
        ],
      },
      {
        specFile: "desktop.spec.md",
        exports: [],
        resources: [
          "App `ManagedRuntime`",
          "Runtime event bridge subscription fiber",
          "Renderer runtime-event callback handle",
          "Renderer read-model cache subscription",
          "Electrobun window bridge callbacks",
          "Browser/headless `AsyncIterable` edge",
        ],
      },
    ];
    const nonScopedExports = new Set([
      "packages/core/src/app-log-contracts.ts -> AppLogWritePort",
      "packages/core/src/extension-state-ports.ts -> ExtensionStatePort",
      "packages/core/src/pi-adapter-ports.ts -> PiRuntimePathsPort",
      "packages/core/src/pi-adapter-ports.ts -> PiSessionReferencePort",
      "packages/core/src/provider-auth-ports.ts -> ProviderAuthPort",
      "packages/core/src/provider-auth-ports.ts -> ProviderAuthStatusStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeActorExtensionBindingStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeApprovalStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeArtifactStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeCommandStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeComposerDraftStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeEpisodeStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeExtensionContextImpactStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeExtensionStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeGeneratedPackageStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeQueueStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeReadModelStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeRecoveryStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeRequestStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeSessionWaitStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeSourceStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeSurfaceLifecycleStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeThreadStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeTurnStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeWorkspaceStatePort",
      "packages/core/src/sandbox-policy-contracts.ts -> SandboxPolicySource",
      "packages/core/src/secret-store-ports.ts -> SecretStorePort",
      "packages/runtime/src/bun-platform.ts -> layerRuntimeBunPlatform",
      "packages/runtime/src/request-input-lifecycle.ts -> RuntimeRequestInputPostCommitLane",
      "packages/runtime/src/runtime-approval-answer.ts -> RuntimeApprovalAnswerPostCommitHost",
      "packages/runtime/src/runtime-effect-requests.ts -> RuntimeHandlerThreadStartPreparationHost",
      "packages/runtime/src/runtime-effect-requests.ts -> RuntimeQueueInsertPostCommitLane",
      "packages/runtime/src/runtime-layer-config.ts -> RuntimeLayerConfigService",
      "packages/runtime/src/runtime-layer-config.ts -> RuntimeShutdownPreparation",
      "packages/runtime/src/runtime-layer-config.ts -> RuntimeStartupReadiness",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerAppLogPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerApprovalPostCommitPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerCommandControlPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerCommandStdinPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerDevTelemetryPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerEventsPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerModelResolverPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerPromptHostPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerProviderAuthPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerRequestInputPostCommitPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerSourceEditsPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeLayerSourceInvalidationPort",
      "packages/runtime/src/runtime-message-abort.ts -> RuntimeQueuedMessageAbortPostCommitHost",
      "packages/runtime/src/runtime-message-submission.ts -> RuntimeMessageSubmissionPostCommitLane",
      "packages/runtime/src/runtime-queue-steering.ts -> RuntimeQueueSteeringPostCommitLane",
      "packages/sandbox/src/sandbox.ts -> HostProcessReferencePort",
      "packages/sandbox/src/sandbox.ts -> SandboxHelperCandidatesPort",
      "packages/extensions/src/extension-source-roots-port.ts -> ExtensionSourceRootsPort",
      "packages/extensions/src/extension-source-roots-port.ts -> layerExtensionSourceRootsPort",
      "packages/extensions/src/generated-package-root-port.ts -> GeneratedPackageRootPort",
      "packages/extensions/src/generated-package-root-port.ts -> layerGeneratedPackageRootPort",
      "packages/extensions/src/packaged-extension-templates-port.ts -> PackagedExtensionTemplatesPort",
      "packages/extensions/src/packaged-extension-templates-port.ts -> layerPackagedExtensionTemplatesPort",
      "packages/extensions/src/workspace-source-link-port.ts -> WorkspaceSourceLinkPort",
      "packages/extensions/src/workspace-source-link-port.ts -> layerWorkspaceSourceLinkPort",
    ]);
    const coveredExports = new Set(resourceCoverage.flatMap(({ exports }) => exports));
    const discoveredExports = sourceRoots
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) => {
            const source = readSource(file);
            return [
              ...Array.from(
                source.matchAll(
                  /\bexport\s+class\s+([A-Za-z_$][\w$]*)\s+extends\s+(?:Context|LayerMap)\.Service/g,
                ),
                (match) => `${display(file)} -> ${match[1]!}`,
              ),
              ...Array.from(
                source.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*Context\.Service/g),
                (match) => `${display(file)} -> ${match[1]!}`,
              ),
              ...Array.from(
                source.matchAll(/\bexport\s+const\s+(layer[A-Za-z_$][\w$]*|layer)\b/g),
                (match) => `${display(file)} -> ${match[1]!}`,
              ),
              ...Array.from(
                source.matchAll(/\bexport\s+function\s+(layer[A-Za-z_$][\w$]*)\b/g),
                (match) => `${display(file)} -> ${match[1]!}`,
              ),
            ];
          }),
      )
      .filter((entry, index, entries) => entries.indexOf(entry) === index)
      .toSorted();
    const unclassifiedExports = discoveredExports.filter(
      (entry) => !coveredExports.has(entry) && !nonScopedExports.has(entry),
    );
    const missingSourceExports = Array.from(coveredExports)
      .filter((entry) => !discoveredExports.includes(entry))
      .toSorted();
    const missingMatrixCoverage = resourceCoverage.flatMap(({ specFile, resources }) => {
      const source = readSource(join(packageArchitectureSpecRoot, specFile));
      return [
        ...(matrixHeaderPattern.test(source) ? [] : [`${specFile} -> missing exact matrix header`]),
        ...resources
          .filter(
            (resource) => !new RegExp(`^\\|\\s*${escapeRegExp(resource)}\\s*\\|`, "m").test(source),
          )
          .map((resource) => `${specFile} -> ${resource}`),
      ];
    });

    expect({ missingSourceExports, unclassifiedExports, missingMatrixCoverage }).toEqual({
      missingSourceExports: [],
      unclassifiedExports: [],
      missingMatrixCoverage: [],
    });
  });

  it("public boundary error contracts expose strict decode and encode helpers", () => {
    const publicNames = new Set(
      readPublicExportedNames(join(packageRoot, "core", "src", "index.ts")),
    );
    const boundaryErrorContracts = [
      {
        name: "AppLogError",
        file: "packages/core/src/app-log-contracts.ts",
        schema: "AppLogErrorSchema",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "StateStoredError",
        file: "packages/core/src/errors.ts",
        schema: "StateStoredErrorSchema",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "RuntimeContractError",
        file: "packages/core/src/errors.ts",
        schema: "RuntimeContractError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "RuntimeEventRebaselineRequired",
        file: "packages/core/src/errors.ts",
        schema: "RuntimeEventRebaselineRequired",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "RuntimeEventStreamError",
        file: "packages/core/src/errors.ts",
        schema: "RuntimeEventStreamError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "RuntimeEventError",
        file: "packages/core/src/errors.ts",
        schema: "RuntimeEventBoundaryErrorSchema",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "StateContractError",
        file: "packages/core/src/errors.ts",
        schema: "StateContractError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "SandboxPolicyError",
        file: "packages/core/src/errors.ts",
        schema: "SandboxPolicyError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "PiAdapterError",
        file: "packages/core/src/errors.ts",
        schema: "PiAdapterError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "ProviderAuthPortError",
        file: "packages/core/src/errors.ts",
        schema: "ProviderAuthPortError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "SecretStorePortError",
        file: "packages/core/src/errors.ts",
        schema: "SecretStorePortError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "PiSessionReferencePortError",
        file: "packages/core/src/errors.ts",
        schema: "PiSessionReferencePortError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "RuntimeToolExecutionError",
        file: "packages/core/src/errors.ts",
        schema: "RuntimeToolExecutionError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "ExtensionError",
        file: "packages/core/src/errors.ts",
        schema: "ExtensionError",
        parseOptions: "strictBoundaryParseOptions",
      },
      {
        name: "RuntimeFacadeErrorContract",
        file: "packages/core/src/runtime-contracts.ts",
        schema: "RuntimeFacadeErrorContractSchema",
        parseOptions: "RuntimeBoundaryParseOptions",
      },
      {
        name: "StateFacadeErrorContract",
        file: "packages/core/src/runtime-contracts.ts",
        schema: "StateFacadeErrorContractSchema",
        parseOptions: "RuntimeBoundaryParseOptions",
      },
      {
        name: "RunTaskAgentError",
        file: "packages/core/src/runtime-contracts.ts",
        schema: "RunTaskAgentErrorSchema",
        parseOptions: "RuntimeBoundaryParseOptions",
      },
    ];
    const missingExports = boundaryErrorContracts.flatMap(({ name }) =>
      [
        `decodeUnknown${name}Effect`,
        `decodeUnknown${name}Exit`,
        `encode${name}Effect`,
        `encode${name}Exit`,
      ]
        .filter((helper) => !publicNames.has(helper))
        .map((helper) => `${name} -> ${helper}`),
    );
    const wrongCompilerOptions = boundaryErrorContracts.flatMap(
      ({ name, file, schema, parseOptions }) => {
        const source = readSource(join(projectRoot, file));
        return [
          {
            helper: `decodeUnknown${name}Exit`,
            compiler: "decodeUnknownExit",
          },
          {
            helper: `decodeUnknown${name}Effect`,
            compiler: "decodeUnknownEffect",
          },
          { helper: `encode${name}Exit`, compiler: "encodeExit" },
          { helper: `encode${name}Effect`, compiler: "encodeEffect" },
        ]
          .filter(({ helper, compiler }) => {
            const directCompilerPattern = new RegExp(
              `export\\s+const\\s+${helper}\\s*=\\s*Schema\\.${compiler}\\(\\s*${schema}\\s*,\\s*${parseOptions}\\s*,?\\s*\\)`,
              "m",
            );
            const taggedEncodeFactory =
              compiler === "encodeExit"
                ? "makeStrictBoundaryTaggedErrorEncodeExit"
                : compiler === "encodeEffect"
                  ? "makeStrictBoundaryTaggedErrorEncodeEffect"
                  : null;
            const taggedEncodePattern =
              taggedEncodeFactory === null
                ? null
                : new RegExp(
                    `export\\s+const\\s+${helper}\\s*=\\s*${taggedEncodeFactory}\\(\\s*${schema}\\s*,?\\s*\\)`,
                    "m",
                  );
            return !(
              directCompilerPattern.test(source) ||
              (taggedEncodePattern !== null &&
                taggedEncodePattern.test(source) &&
                source.includes(`Schema.${compiler}(schema, taggedErrorBoundaryEncodeOptions)`) &&
                source.includes(
                  `Schema.${compiler === "encodeExit" ? "decodeUnknownExit" : "decodeUnknownEffect"}(schema, ${parseOptions})`,
                ))
            );
          })
          .map(({ helper }) => `${file} -> ${helper}`);
      },
    );

    expect({ missingExports, wrongCompilerOptions }).toEqual({
      missingExports: [],
      wrongCompilerOptions: [],
    });
  });

  it("extracted package production layers avoid v3-style Live and Default naming", () => {
    const layerNamePattern =
      /\bexport\s+(?:const|class)\s+([A-Za-z_$][\w$]*(?:Live|Default|LayerLive))\b|\bexport\s+const\s+(layer(?:Live|Default))\b|\bexport\s+const\s+(Live|Default)\s*=\s*Layer\./g;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          Array.from(readSource(file).matchAll(layerNamePattern), (match) => {
            const name = match[1] ?? match[2] ?? match[3] ?? "<unknown>";
            return `${display(file)} -> ${name}`;
          }),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("extracted packages import @effect packages only at approved host or test boundaries", () => {
    const rootManifest = readRootPackageManifest();
    const adoptedEffectPackageNames = new Set(
      [
        ...Object.keys(rootManifest.dependencies ?? {}),
        ...Object.keys(rootManifest.devDependencies ?? {}),
      ].filter((dependency) => dependency.startsWith("@effect/")),
    );
    const targetEffectPackagePrefixesByPackage = new Map<string, string[]>([
      ["@svvy/runtime", ["@effect/platform-bun"]],
    ]);
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter((specifier) => {
            if (!specifier.startsWith("@effect/")) return false;
            if (
              isTestFile(file) &&
              specifier === "@effect/vitest" &&
              adoptedEffectPackageNames.has("@effect/vitest")
            ) {
              return false;
            }
            const packageName = packageNameForSourceFile(file);
            return !targetEffectPackagePrefixesByPackage
              .get(packageName)
              ?.some(
                (prefix) =>
                  adoptedEffectPackageNames.has(prefix) &&
                  (specifier === prefix || specifier.startsWith(`${prefix}/`)),
              );
          })
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("@effect/platform-bun imports stay limited to the runtime file/path/crypto platform layer", () => {
    const platformImports = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter(
            (specifier) =>
              specifier === "@effect/platform-bun" || specifier.startsWith("@effect/platform-bun/"),
          )
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(platformImports).toEqual([
      "packages/runtime/src/bun-platform.ts -> @effect/platform-bun/BunCrypto",
      "packages/runtime/src/bun-platform.ts -> @effect/platform-bun/BunFileSystem",
      "packages/runtime/src/bun-platform.ts -> @effect/platform-bun/BunPath",
    ]);
  });

  it("root scripts and dependencies own the Effect test lane", () => {
    const rootManifest = readRootPackageManifest();
    const scripts = rootManifest.scripts ?? {};
    const devDependencies = rootManifest.devDependencies ?? {};
    const packageManifests = Array.from(expectedPackageDependencies.keys()).map((packageName) => ({
      packageName,
      manifest: readPackageManifest(packageName),
    }));
    const packageDevDependencyViolations = packageManifests
      .filter(
        ({ manifest }) =>
          manifest.devDependencies?.["@effect/vitest"] || manifest.devDependencies?.vitest,
      )
      .map(({ packageName }) => packageName);

    expect({
      check: scripts.check,
      testUnit: scripts["test:unit"],
      testEffect: scripts["test:effect"],
      effectVitest: devDependencies["@effect/vitest"],
      vitest: devDependencies.vitest,
      packageDevDependencyViolations,
    }).toEqual({
      check:
        "bun run typecheck && bun run test:unit && bun run test:effect && bun run lint:check && bun run format:check && bun run build:check",
      testUnit:
        "bun run generate:api && bun test $(rg --files ./src ./packages -g '*.test.ts' -g '*.spec.ts' -g '*_test.ts' -g '*_spec.ts' -g '!*.effect.test.ts')",
      testEffect: "vitest run --root . $(rg --files packages -g '*.effect.test.ts')",
      effectVitest: "4.0.0-beta.84",
      vitest: "4.1.4",
      packageDevDependencyViolations: [],
    });
  });

  it("Effect installed-export manifest covers production package and Bun app Effect member reads", () => {
    const auditFile = join(packageRoot, "effect-installed-exports.effect.test.ts");
    const productionEffectFiles = [
      ...sourceRoots.flatMap((root) => listTypeScriptFiles(root)),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
    ].filter((file) => !isTestFile(file) && basename(file) !== "effect.test-support.ts");
    const actualRuntimeMembers = new Map<string, Set<string>>();
    const actualTypeOnlyModules = new Set<string>();

    for (const file of productionEffectFiles) {
      for (const [moduleSpecifier, members] of readEffectRuntimeMemberReads(file)) {
        const actualMembers = actualRuntimeMembers.get(moduleSpecifier) ?? new Set<string>();
        for (const member of members) {
          actualMembers.add(member);
        }
        actualRuntimeMembers.set(moduleSpecifier, actualMembers);
      }
      for (const moduleSpecifier of readEffectTypeOnlyImportModules(file)) {
        actualTypeOnlyModules.add(moduleSpecifier);
      }
    }

    const expectedRuntimeMembers = new Map(
      adoptedEffectRuntimeModuleExports.map((entry) => [
        entry.module,
        new Set<string>(entry.members),
      ]),
    );
    const expectedTypeOnlyModules = new Set<string>(adoptedEffectTypeOnlyModules);
    const runtimeMemberViolations = [
      ...Array.from(actualRuntimeMembers).flatMap(([moduleSpecifier, actualMembers]) => {
        const expectedMembers = expectedRuntimeMembers.get(moduleSpecifier);
        if (!expectedMembers) {
          return [`${moduleSpecifier} is read in production but absent from the manifest`];
        }
        return Array.from(actualMembers)
          .filter((member) => !expectedMembers.has(member))
          .map((member) => `${moduleSpecifier}.${member} is read in production but unmanifested`);
      }),
      ...Array.from(expectedRuntimeMembers).flatMap(([moduleSpecifier, expectedMembers]) => {
        const actualMembers = actualRuntimeMembers.get(moduleSpecifier);
        if (!actualMembers) {
          return [`${moduleSpecifier} is manifest-listed but not read in production`];
        }
        return Array.from(expectedMembers)
          .filter((member) => !actualMembers.has(member))
          .map((member) => `${moduleSpecifier}.${member} is manifest-listed but not read`);
      }),
    ].toSorted();
    const typeModuleViolations = [
      ...Array.from(actualTypeOnlyModules)
        .filter((moduleSpecifier) => !expectedTypeOnlyModules.has(moduleSpecifier))
        .map((moduleSpecifier) => `${moduleSpecifier} is type-imported but unmanifested`),
      ...Array.from(expectedTypeOnlyModules)
        .filter((moduleSpecifier) => !actualTypeOnlyModules.has(moduleSpecifier))
        .map((moduleSpecifier) => `${moduleSpecifier} is type-manifested but not type-imported`),
    ].toSorted();

    expect({
      auditExists: existsSync(auditFile),
      manifestImport: readSource(auditFile).includes("./effect-adoption-manifest"),
      runtimeMemberViolations,
      typeModuleViolations,
    }).toEqual({
      auditExists: true,
      manifestImport: true,
      runtimeMemberViolations: [],
      typeModuleViolations: [],
    });
  });

  it("extracted package production code reads host process facts only through explicit host zones", () => {
    const allowedHostReadFiles = new Set<string>();
    const hostReadPattern =
      /\bprocess\.(?:platform|arch|env|cwd|execPath)\b|\b(?:hostname|os\.hostname)\s*\(/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => !allowedHostReadFiles.has(display(file)))
        .filter((file) => hostReadPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("runtime source invalidation uses an explicit host capability instead of direct host globals", () => {
    const file = join(packageRoot, "runtime", "src", "source-invalidation-coordinator.ts");
    const source = readSource(file);
    const imports = readImports(file);

    expect(imports.filter((specifier) => specifier.startsWith("node:"))).toEqual([]);
    expect(source).toContain("SourceInvalidationHost");
    expect(source).not.toMatch(
      /\bglobalThis\.(?:setTimeout|setInterval|clearTimeout|clearInterval)\b/,
    );
    expect(source).not.toMatch(
      /\bsetTimeout\?:|\bsetInterval\?:|\bclearTimeout\?:|\bclearInterval\?:/,
    );
    expect(source).not.toMatch(/\bnodeWatch\b|\bFSWatcher\b|\bhomedir\s*\(/);
  });

  it("extracted packages do not use removed Effect v3 service/runtime patterns", () => {
    const bannedSourcePatterns = [
      { pattern: /\bContext\.Tag\b/, name: "Context.Tag" },
      { pattern: /\bContext\.GenericTag\b/, name: "Context.GenericTag" },
      { pattern: /\bEffect\.Tag\b/, name: "Effect.Tag" },
      { pattern: /\bEffect\.Service\b/, name: "Effect.Service" },
      { pattern: /\bEffect\.runCallback\b/, name: "Effect.runCallback" },
      { pattern: /\bEffect\.runCallbackWith\b/, name: "Effect.runCallbackWith" },
      { pattern: /\bEffect\.runFork\b/, name: "Effect.runFork" },
      { pattern: /\bEffect\.runForkWith\b/, name: "Effect.runForkWith" },
      { pattern: /\bEffect\.runPromise\b/, name: "Effect.runPromise" },
      { pattern: /\bEffect\.runPromiseWith\b/, name: "Effect.runPromiseWith" },
      { pattern: /\bEffect\.runPromiseExit\b/, name: "Effect.runPromiseExit" },
      { pattern: /\bEffect\.runPromiseExitWith\b/, name: "Effect.runPromiseExitWith" },
      { pattern: /\bEffect\.runSync\b/, name: "Effect.runSync" },
      { pattern: /\bEffect\.runSyncWith\b/, name: "Effect.runSyncWith" },
      { pattern: /\bEffect\.runSyncExit\b/, name: "Effect.runSyncExit" },
      { pattern: /\bEffect\.runSyncExitWith\b/, name: "Effect.runSyncExitWith" },
      { pattern: /\brunMain\b/, name: "runMain" },
      { pattern: /\bLayer\.launch\b/, name: "Layer.launch" },
      { pattern: /\bLayer\.scoped(?:Discard)?\b/, name: "Layer.scoped*" },
      { pattern: /\bManagedRuntime\.make\b/, name: "ManagedRuntime.make" },
      { pattern: /\bEffect\.gen\s*\(\s*this\b/, name: "Effect.gen(this, ...)" },
      { pattern: /\bSchema\.TaggedError\b/, name: "Schema.TaggedError" },
      { pattern: /\bSchema\.Data\b/, name: "Schema.Data" },
      { pattern: /\bSchema\.decodeUnknown\b/, name: "Schema.decodeUnknown" },
      { pattern: /\bSchema\.decodeEither\b/, name: "Schema.decodeEither" },
      { pattern: /\bSchema\.catchDecoding\b/, name: "Schema.catchDecoding" },
      {
        pattern: /\bSchema\.catchDecodingWithContext\b/,
        name: "Schema.catchDecodingWithContext",
      },
      { pattern: /\bSchema\.validate\w*\b/, name: "Schema.validate*" },
      { pattern: /\bSchema\.nonEmptyString\b/, name: "Schema.nonEmptyString" },
      { pattern: /\bSchema\.UUID\b/, name: "Schema.UUID" },
      { pattern: /\bEffect\.catchAll\b/, name: "Effect.catchAll" },
      { pattern: /\bEffect\.catchAllCause\b/, name: "Effect.catchAllCause" },
      { pattern: /\bEffect\.catchSome\b/, name: "Effect.catchSome" },
      { pattern: /\bEffect\.catchSomeCause\b/, name: "Effect.catchSomeCause" },
      { pattern: /\bScope\.extend\b/, name: "Scope.extend" },
      { pattern: /\bEffect\.forkDaemon\b/, name: "Effect.forkDaemon" },
      { pattern: /\bEffect\.forkAll\b/, name: "Effect.forkAll" },
      { pattern: /\bEffect\.forkWithErrorHandler\b/, name: "Effect.forkWithErrorHandler" },
      { pattern: /\bLayer\.fromBuild\b/, name: "Layer.fromBuild" },
      { pattern: /\bLayer\.fromBuildMemo\b/, name: "Layer.fromBuildMemo" },
      { pattern: /\bLayer\.buildWithMemoMap\b/, name: "Layer.buildWithMemoMap" },
      { pattern: /\bLayer\.forkMemoMapUnsafe\b/, name: "Layer.forkMemoMapUnsafe" },
      { pattern: /\bLayer\.effectDiscard\b/, name: "Layer.effectDiscard" },
      { pattern: /\bLayer\.buildWithScope\b/, name: "Layer.buildWithScope" },
      { pattern: /\bLayer\.unwrap\b/, name: "Layer.unwrap" },
      { pattern: /\bLayer\.suspend\b/, name: "Layer.suspend" },
      { pattern: /\bLayer\.fresh\b/, name: "Layer.fresh" },
      { pattern: /\bLayer\.makeMemoMapUnsafe\b/, name: "Layer.makeMemoMapUnsafe" },
      {
        pattern: /\bEffect\.provide\s*\([\s\S]*?\{\s*local\s*:\s*true\s*\}/,
        name: "Effect.provide local true",
      },
    ];
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return bannedSourcePatterns
            .filter(({ pattern }) => pattern.test(source))
            .map(({ name }) => `${display(file)} -> ${name}`);
        }),
    );

    expect(violations).toEqual([]);
  });

  it("extracted package production stream bridges use the scoped facade helper", () => {
    const rawAsyncIterablePattern = /\bStream\.toAsyncIterable(?:With|Effect)\b/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          const matches = source.match(rawAsyncIterablePattern) ?? [];
          if (matches.length === 0) {
            return [];
          }
          if (
            file === join(packageRoot, "runtime", "src", "index.ts") &&
            source.includes("async function asyncIterableFromRuntimeEventSubscription") &&
            matches.length === 1
          ) {
            return [];
          }
          return [`${display(file)} -> ${matches.join(", ")}`];
        }),
    );

    expect(violations).toEqual([]);
  });

  it("runtime event facade exposes a closeable subscription object, not a bare stream", () => {
    const source = readSource(join(packageRoot, "runtime", "src", "index.ts"));

    expect(source).toMatch(
      /interface RuntimeEventSubscription extends AsyncIterable<RuntimeEvent>[\s\S]*close\(\): Promise<void>;[\s\S]*readonly closed: Promise<RuntimeEventSubscriptionClose>;/,
    );
    expect(source).toContain("async function asyncIterableFromRuntimeEventSubscription");
    expect(source).toContain("input.subscription.close()");
    expect(source).toContain("input.subscription.closed");
    expect(source).not.toMatch(/events\([^)]*\):\s*AsyncIterable<RuntimeEvent>/);
  });

  it("runtime facade keeps abortPolicy as facade-only cancellation policy", () => {
    const runtimeFacadeSource = readSource(join(packageRoot, "runtime", "src", "index.ts"));

    expect(runtimeFacadeSource).toContain(
      'abortPolicy?: "cancel-wait-only" | "request-runtime-cancel"',
    );
    expect(runtimeFacadeSource).toContain("config?.allowRuntimeCancel !== true");
    expect(runtimeFacadeSource).toContain(
      'abortPolicy === "request-runtime-cancel" ? { signal: options?.signal } : undefined',
    );
    expect(runtimeFacadeSource).toContain(
      "Promise.race([runEffect, waitForAbort(operation, options.signal)])",
    );

    const nonRuntimeViolations = [
      ...sourceRoots.filter((root) => root !== join(packageRoot, "runtime", "src")),
      appSourceRoot,
    ].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => /\babortPolicy\b/.test(readSource(file)))
        .map(display),
    );

    expect(nonRuntimeViolations).toEqual([]);
  });

  it("extracted package production code cannot bypass Effect runner bans with import aliases", () => {
    const bannedEffectRunners = new Set([
      "runCallback",
      "runCallbackWith",
      "runFork",
      "runForkWith",
      "runPromise",
      "runPromiseWith",
      "runPromiseExit",
      "runPromiseExitWith",
      "runSync",
      "runSyncWith",
      "runSyncExit",
      "runSyncExitWith",
    ]);
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          const effectViolations = readValueImportBindings(file, "effect/Effect").flatMap(
            (binding) => {
              if (binding.kind === "namespace") {
                return Array.from(bannedEffectRunners)
                  .filter((runner) =>
                    new RegExp(`\\b${binding.localName}\\.${runner}\\b`).test(source),
                  )
                  .map((runner) => `${display(file)} -> effect/Effect ${runner}`);
              }
              return bannedEffectRunners.has(binding.importedName) &&
                new RegExp(`\\b${binding.localName}\\s*\\(`).test(source)
                ? [`${display(file)} -> effect/Effect ${binding.importedName}`]
                : [];
            },
          );
          const managedRuntimeViolations = readValueImportBindings(
            file,
            "effect/ManagedRuntime",
          ).flatMap((binding) => {
            if (binding.kind === "namespace") {
              return new RegExp(`\\b${binding.localName}\\.make\\b`).test(source)
                ? [`${display(file)} -> effect/ManagedRuntime make`]
                : [];
            }
            return binding.importedName === "make" &&
              new RegExp(`\\b${binding.localName}\\s*\\(`).test(source)
              ? [`${display(file)} -> effect/ManagedRuntime make`]
              : [];
          });
          const destructuringViolations = Array.from(bannedEffectRunners)
            .flatMap((runner) => [
              {
                pattern: new RegExp(
                  `\\b(?:const|let|var)\\s*\\{[^}]*\\b${runner}\\b[^}]*\\}\\s*=\\s*Effect\\b`,
                ),
                name: `Effect destructured ${runner}`,
              },
              {
                pattern: new RegExp(`\\bEffect\\s*\\[\\s*["']${runner}["']\\s*\\]`),
                name: `Effect bracket ${runner}`,
              },
            ])
            .filter(({ pattern }) => pattern.test(source))
            .map(({ name }) => `${display(file)} -> ${name}`);
          return [...effectViolations, ...managedRuntimeViolations, ...destructuringViolations];
        }),
    );

    expect(violations).toEqual([]);
  });

  it("extracted package production code does not use SubscriptionRef lanes", () => {
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return [
            ...readImports(file)
              .filter((specifier) => specifier === "effect/SubscriptionRef")
              .map((specifier) => `${display(file)} -> ${specifier}`),
            ...(source.match(/\bSubscriptionRef\b/) ? [`${display(file)} -> SubscriptionRef`] : []),
          ];
        }),
    );

    expect(violations).toEqual([]);
  });

  it("extracted package tests do not create manual Effect runtimes except facade and known debt cases", () => {
    const allowedManualRuntimeReads = new Map<string, string[]>([
      [
        "packages/runtime/src/runtime-layer-config.bootstrap.integration.test.ts",
        ["ManagedRuntime.make", "ManagedRuntime.make"],
      ],
      ["packages/runtime/src/runtime-facade.test.ts", ["ManagedRuntime.make"]],
      [
        "packages/state/src/state-facade.test.ts",
        ["ManagedRuntime.make", "ManagedRuntime.make", "ManagedRuntime.make"],
      ],
    ]);
    const manualRuntimePatterns = [
      { pattern: /\bEffect\.runPromise\b/g, name: "Effect.runPromise" },
      { pattern: /\bEffect\.runPromiseWith\b/g, name: "Effect.runPromiseWith" },
      { pattern: /\bEffect\.runPromiseExit\b/g, name: "Effect.runPromiseExit" },
      { pattern: /\bEffect\.runPromiseExitWith\b/g, name: "Effect.runPromiseExitWith" },
      { pattern: /\bEffect\.runSync\b/g, name: "Effect.runSync" },
      { pattern: /\bEffect\.runSyncWith\b/g, name: "Effect.runSyncWith" },
      { pattern: /\bEffect\.runSyncExit\b/g, name: "Effect.runSyncExit" },
      { pattern: /\bEffect\.runSyncExitWith\b/g, name: "Effect.runSyncExitWith" },
      { pattern: /\bEffect\.runFork\b/g, name: "Effect.runFork" },
      { pattern: /\bEffect\.runForkWith\b/g, name: "Effect.runForkWith" },
      { pattern: /\bEffect\.runCallback\b/g, name: "Effect.runCallback" },
      { pattern: /\bEffect\.runCallbackWith\b/g, name: "Effect.runCallbackWith" },
      { pattern: /\bLayer\.launch\b/g, name: "Layer.launch" },
      { pattern: /\brunMain\b/g, name: "runMain" },
      { pattern: /\bManagedRuntime\.make\b/g, name: "ManagedRuntime.make" },
    ];
    const actual = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter(isTestFile)
        .filter((file) => !file.endsWith(".test-support.ts"))
        .flatMap((file) => {
          const source = readSource(file);
          const directReads = manualRuntimePatterns.flatMap(({ pattern, name }) =>
            Array.from(source.matchAll(pattern), () => `${display(file)} -> ${name}`),
          );
          const effectAliasReads = readValueImportBindings(file, "effect/Effect").flatMap(
            (binding) =>
              manualRuntimePatterns.flatMap(({ name }) => {
                if (!name.startsWith("Effect.")) return [];
                const runner = name.slice("Effect.".length);
                if (binding.kind === "namespace") {
                  if (binding.localName === "Effect") return [];
                  return Array.from(
                    source.matchAll(new RegExp(`\\b${binding.localName}\\.${runner}\\b`, "g")),
                    () => `${display(file)} -> ${name}`,
                  );
                }
                return binding.importedName === runner
                  ? Array.from(
                      source.matchAll(new RegExp(`\\b${binding.localName}\\s*\\(`, "g")),
                      () => `${display(file)} -> ${name}`,
                    )
                  : [];
              }),
          );
          const managedRuntimeAliasReads = readValueImportBindings(
            file,
            "effect/ManagedRuntime",
          ).flatMap((binding) => {
            if (binding.kind === "namespace") {
              if (binding.localName === "ManagedRuntime") return [];
              return Array.from(
                source.matchAll(new RegExp(`\\b${binding.localName}\\.make\\b`, "g")),
                () => `${display(file)} -> ManagedRuntime.make`,
              );
            }
            return binding.importedName === "make"
              ? Array.from(
                  source.matchAll(new RegExp(`\\b${binding.localName}\\s*\\(`, "g")),
                  () => `${display(file)} -> ManagedRuntime.make`,
                )
              : [];
          });
          return [...directReads, ...effectAliasReads, ...managedRuntimeAliasReads];
        }),
    );
    const allowed = Array.from(allowedManualRuntimeReads.entries()).flatMap(([file, names]) =>
      names.map((name) => `${file} -> ${name}`),
    );
    const violations = actual.filter((entry) => !allowed.includes(entry));
    const missingAllowed = allowed.filter((entry) => !actual.includes(entry));

    expect({ violations, missingAllowed }).toEqual({ violations: [], missingAllowed: [] });
  });

  it("test files do not mix Bun and Effect test runtimes", () => {
    const violations = [packageRoot, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter(isTestFile)
        .filter((file) => {
          const imports = readImports(file);
          return imports.includes("bun:test") && imports.includes("@effect/vitest");
        })
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("Effect test runtime imports stay confined to the Effect test lane", () => {
    const violations = [packageRoot, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter(isTestFile)
        .filter((file) => readImports(file).includes("@effect/vitest"))
        .filter((file) => !isEffectTestLaneFile(file))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("Effect testing services stay confined to the Effect test lane", () => {
    const violations = [...sourceRoots, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter(isTestFile)
        .filter((file) => readImports(file).includes("effect/testing"))
        .filter((file) => !isEffectTestLaneFile(file))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("Effect test lane files are covered by the root test:effect script", () => {
    const rootManifest = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const testEffectScript = rootManifest.scripts?.["test:effect"] ?? "";
    const effectTests = [packageRoot, appSourceRoot]
      .flatMap((root) => listTypeScriptFiles(root))
      .filter((file) => display(file).endsWith(".effect.test.ts"));
    const outsideScriptGlob = effectTests
      .filter((file) => !isEffectTestLaneFile(file))
      .map(display);

    expect({
      script: testEffectScript,
      outsideScriptGlob,
    }).toEqual({
      script: "vitest run --root . $(rg --files packages -g '*.effect.test.ts')",
      outsideScriptGlob: [],
    });
  });

  it("Effect Schema compiler calls are hoisted in package production source", () => {
    const compilerPattern =
      /\bSchema\.(?:is|decode[A-Za-z]*|decodeUnknown[A-Za-z]*|encode[A-Za-z]*|encodeUnknown[A-Za-z]*)\s*\([^)]*\)\s*\(/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => compilerPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("Effect Schema.asserts direct assertions stay out of package production source", () => {
    const directAssertPattern = /\bSchema\.asserts\s*\(/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return [
            ...(directAssertPattern.test(source) ? [`${display(file)} -> Schema.asserts`] : []),
            ...readValueImportBindings(file, "effect/Schema")
              .filter((binding) => binding.kind === "named" && binding.importedName === "asserts")
              .map(
                (binding) => `${display(file)} -> effect/Schema asserts as ${binding.localName}`,
              ),
          ];
        }),
    );

    expect(violations).toEqual([]);
  });

  it("Effect Schema compiler construction stays outside package production function bodies", () => {
    const compilerPattern =
      /\b(?:Schema\.(?:is|decodeEffect|decodeUnknownEffect|decodeExit|decodeUnknownExit|decodeOption|decodeUnknownOption|decodePromise|decodeUnknownPromise|decodeSync|decodeUnknownSync|encodeEffect|encodeUnknownEffect|encodeExit|encodeUnknownExit|encodeOption|encodeUnknownOption|encodePromise|encodeUnknownPromise|encodeSync|encodeUnknownSync|decodeUnknownResult|decodeResult|encodeUnknownResult|encodeResult)|(?:decodeUnknownResult|decodeResult|encodeUnknownResult|encodeResult))\s*\(/g;
    const nearbyFunctionStartPattern =
      /\b(?:function\s+[A-Za-z_$][\w$]*\s*\(|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|(?:async\s+)?\([^)]*\)\s*=>)/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return Array.from(source.matchAll(compilerPattern), (match) => {
            const index = match.index ?? 0;
            const nearbyPrefix = source.slice(Math.max(0, index - 500), index);
            if (!nearbyFunctionStartPattern.test(nearbyPrefix)) return null;
            const line = source.slice(0, index).split("\n").length;
            return `${display(file)}:${line} -> ${match[0]}`;
          }).filter((entry): entry is string => entry !== null);
        }),
    );

    expect(violations).toEqual([]);
  });

  it("Effect execution-plan APIs stay unadopted in product packages", () => {
    const memberUsePattern = /\b(?:Effect|Stream)\.withExecutionPlan\s*\(/;
    const forbiddenNamedImports = new Set(["ExecutionPlan", "withExecutionPlan"]);
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          const namedEffectImports = readNamedImportNames(file, "effect/Effect")
            .filter((name) => forbiddenNamedImports.has(name))
            .map((name) => `${display(file)} -> effect/Effect ${name}`);
          const namedStreamImports = readNamedImportNames(file, "effect/Stream")
            .filter((name) => forbiddenNamedImports.has(name))
            .map((name) => `${display(file)} -> effect/Stream ${name}`);
          const moduleImports = readImports(file)
            .filter((specifier) => specifier === "effect/ExecutionPlan")
            .map((specifier) => `${display(file)} -> ${specifier}`);
          return [
            ...(memberUsePattern.test(source)
              ? [`${display(file)} -> Effect/Stream.withExecutionPlan`]
              : []),
            ...namedEffectImports,
            ...namedStreamImports,
            ...moduleImports,
          ];
        }),
    );

    expect(violations).toEqual([]);
  });

  it("public package schemas use optionalKey for optional object fields", () => {
    const optionalPattern = /\bSchema\.optional\s*\(/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readSource(file)
            .split("\n")
            .flatMap((line, index) =>
              optionalPattern.test(line) ? [`${display(file)}:${index + 1}`] : [],
            ),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("extracted package production code avoids eager Effect helper variants", () => {
    const eagerHelperPattern = /\b(?:mapEager|catchEager|fnUntracedEager)\b/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => eagerHelperPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("Effect config env providers use explicit host env snapshots in package code", () => {
    const zeroArgumentFromEnvPattern = /\bConfigProvider\.fromEnv\s*\(\s*\)/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => zeroArgumentFromEnvPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("unsafe sync boundary decoders stay limited to core definitions, reexports, and tests", () => {
    const allowedProductionFiles = new Set([
      "packages/core/src/pi-adapter-contracts.ts",
      "packages/core/src/runtime-contracts.ts",
      "packages/core/src/runtime-effect-requests.ts",
      "packages/core/src/workflow-task-agent-bridge-contracts.ts",
    ]);
    const unsafeDecoderPattern = /\bunsafeDecode[A-Za-z0-9_]*ForTestsAndBootstrap\b/;
    const roots = [...sourceRoots, appSourceRoot, join(projectRoot, "generated")].filter((root) =>
      existsSync(root),
    );
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => !allowedProductionFiles.has(display(file)))
        .filter((file) => unsafeDecoderPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("package architecture specs keep rejected package names as explicit negative guidance only", () => {
    const allowedNegativeMarkers = [
      "not public",
      "not a public",
      "not reusable",
      "not where",
      "not the location",
      "no public",
      "never",
      "do not",
      "must not",
      "should not",
      "are source folders",
      "are not public packages",
      "is not a public",
      "is not where",
      "there is no public",
      "without creating",
      "negative tests",
      "following names are not",
    ];
    const violations = listMarkdownFiles(packageArchitectureSpecRoot).flatMap((file) => {
      const lines = readSource(file).split("\n");
      let inRejectedPackageInventory = false;
      let pendingRejectedPackageInventory = false;
      let sawRejectedPackageInventoryItem = false;
      return lines.flatMap((line, index) => {
        const normalizedLine = line.toLocaleLowerCase();
        if (normalizedLine.includes("following names are not public packages")) {
          pendingRejectedPackageInventory = true;
          inRejectedPackageInventory = false;
          sawRejectedPackageInventoryItem = false;
          return [];
        }
        if (pendingRejectedPackageInventory && line.trim() === "") {
          return [];
        }
        if (
          pendingRejectedPackageInventory &&
          rejectedPublicPackageNames.some((packageName) => line.includes(packageName))
        ) {
          pendingRejectedPackageInventory = false;
          inRejectedPackageInventory = true;
          sawRejectedPackageInventoryItem = true;
          return [];
        }
        if (inRejectedPackageInventory) {
          if (
            line.trim() === "" ||
            !rejectedPublicPackageNames.some((packageName) => line.includes(packageName))
          ) {
            inRejectedPackageInventory = false;
            pendingRejectedPackageInventory = false;
            sawRejectedPackageInventoryItem = false;
          } else {
            sawRejectedPackageInventoryItem = true;
            return [];
          }
        }
        if (pendingRejectedPackageInventory && sawRejectedPackageInventoryItem) {
          return [];
        }
        const contextLine = [lines[index - 1], line, lines[index + 1]]
          .filter((part): part is string => part !== undefined)
          .join(" ")
          .toLocaleLowerCase();
        return rejectedPublicPackageNames
          .filter((packageName) => line.includes(packageName))
          .filter(() => !allowedNegativeMarkers.some((marker) => contextLine.includes(marker)))
          .map((packageName) => `${display(file)}:${index + 1} -> ${packageName}: ${line.trim()}`);
      });
    });

    expect(violations).toEqual([]);
  });

  it("package architecture specs avoid stale Effect and package examples", () => {
    const rejectedSpecPatterns = [
      {
        pattern: /schemaDirectory:\s*"svvy_state"/,
        reason: "Bun SqliteMigrator examples must not imply Bun-specific schema dump support",
      },
      {
        pattern: /^-\s+`svvyx`\s+dispatch$/m,
        reason:
          "Specs must distinguish Shell-launched svvyx CLI work from internal svvyx service dispatch",
      },
      {
        pattern: /\bok\?:\s*boolean\b|\bdetails\.ok\b/,
        reason: "Command result envelopes use details.status, not legacy ok booleans",
      },
      {
        pattern: /\breadModels\.invalidate\b/,
        reason:
          "State returns after-commit invalidation descriptors instead of exposing mutable invalidation APIs",
      },
      {
        pattern: /@svvy\/extensions\.svvyx\.run/,
        reason:
          "Internal svvyx dispatch is an Extensions service method, not a package path or generated API",
      },
      {
        pattern:
          /Example multi-effect `thread_start`|emit one `surface\.create` request per requested handler thread/,
        reason:
          "thread_start examples use one atomic handler_thread.start effect, not split effects",
      },
      {
        pattern: /\bworkflow-module\b/,
        reason: "Workflows reusable workflow sources use workflow-workflow, not workflow-module",
      },
      {
        pattern: /ExtensionStatePort\.generatedContext/,
        reason:
          "Generated context build/binding records are runtime-owned through actor-extension binding, extension context-impact, and generated-package state ports",
      },
      {
        pattern:
          /\bcreateRuntime(?:Surface|GeneratedContext|Title)StatePortLayer\b|\blayerRuntime(?:Surface|GeneratedContext|Title)StatePort\b/,
        reason:
          "Specs must use actual state port layers and must not describe nonexistent surface/generated-context/title state ports",
      },
      {
        pattern:
          /\bSetExternalInstructionActorUsageInput\b|\bExternalInstructionUsageResult\b|\bsetActorUsage\b/,
        reason:
          "Extensions validates external-instruction usage; state command facades own persisted usage mutation",
      },
      {
        pattern: /\bdependency-unavailable\b/,
        reason: "Extension readiness failures use dependency-not-ready",
      },
      {
        pattern: /const\s+session\s*=\s*await\s+pi\.sessions\.create|pi\.sessions\.create\(/,
        reason:
          "createPiAdapterFacade must not be documented as a public product session-control facade",
      },
      {
        pattern: /\byield\s+\*/,
        reason: "Effect generator examples must use valid TypeScript yield* syntax",
      },
      {
        pattern: /\bcreateExtensionsFacade\b/,
        reason:
          "Extensions currently exposes no non-Effect facade; future facades need specs and boundary tests",
      },
      {
        pattern: /\bcreateSandboxDiagnosticsFacade\b/,
        reason:
          "Sandbox currently exposes no non-Effect diagnostics facade; future facades need specs and boundary tests",
      },
      {
        pattern: /\bartifact\.operation\b/,
        reason: "Signed svvyx transports currently support runtime_effect.request only",
      },
      {
        pattern:
          /\bsourceSession\b|\bincludeUnavailable\b|\bgeneratedAt\b|\bappConfigRoot\b|\bhelperCandidates\b/,
        reason:
          "Package specs must use the current core pi-adapter contracts: session, required workspaceId model listing, no generatedAt title field, and runtime path snapshots with cwd/agentDir/sessionDir/modelRegistryPath",
      },
      {
        pattern:
          /No `@effect\/platform-\*`, `@effect\/sql-sqlite-\*`, `vitest`, or\s+`@effect\/vitest` package is adopted|Target\/conditional after `vitest`, `@effect\/vitest`, and `test:effect` are adopted|Until `test:effect` is\s+added|once that lane exists|Once the Effect test lane is adopted|After `test:effect` adoption/,
        reason:
          "The Effect test lane is adopted: specs must describe @effect/vitest as current architecture, not future staging",
      },
      {
        pattern:
          /`@effect\/vitest` first\s+adds|platform, SQL, and test package adoption follows|When a platform, SQL, or Effect test package is adopted/,
        reason:
          "@effect/vitest is already adopted; only platform/SQL packages are future adoption surfaces",
      },
      {
        pattern:
          /no inline `Schema\.decodeUnknown\*`, `Schema\.decode\*`, `Schema\.encodeUnknown\*`,\s+`Schema\.encode\*`/,
        reason:
          "Schema parser compiler rules must enumerate denied compiler APIs without banning decodeTo/encodeTo transforms",
      },
      {
        pattern:
          /\bRuntimeQueueStatePort\.(?:cancelQueuedPrompt|insertRequestInputAnswer)\b|\bRuntimeTurnStatePort\.cancelActiveTurn\b|\bRuntimeCommandStatePort\.(?:cancelTurnCommands|cancelCommand)\b|\bRuntimeRequestStatePort\.setTimerPaused\b|\bRuntimeActorExtensionBindingStatePort\.recordGeneratedContextBinding\b/,
        reason:
          "Runtime ledgers must use exact core-owned state-port method names from state.spec.md",
      },
      {
        pattern:
          /\|\s*`JsonPatch`,\s*`SubscriptionRef`,\s*`Tx\*`,\s*`unstable\/\*` product frameworks\s*\|\s*Not adopted by default\s*\|/,
        reason:
          "SubscriptionRef is adopted only for named latest-value snapshots and must not be grouped with unadopted product frameworks",
      },
    ];
    const violations = listMarkdownFiles(packageArchitectureSpecRoot).flatMap((file) => {
      const source = readSource(file);
      return rejectedSpecPatterns
        .filter(({ pattern }) => pattern.test(source))
        .map(({ pattern, reason }) => `${display(file)} -> ${pattern}: ${reason}`);
    });

    expect(violations).toEqual([]);
  });

  it("desktop spec injects runtime commands and renderer-safe state through the bridge", () => {
    const source = readSource(join(packageArchitectureSpecRoot, "desktop.spec.md"));

    expect(source).toContain('type RuntimeCommandsFacade = RuntimeFacade["commands"];');
    expect(source).toContain(
      "commands: {\n    runtime: RuntimeCommandsFacade;\n    state: StateCommandsFacade;\n  };",
    );
    expect(source).toContain(
      'exposeRendererApi(input: {\n    runtime: DesktopRuntimeActionsFacade;\n    state: RendererStateFacade;\n    commands: CreateDesktopAppInput["commands"];\n  })',
    );
  });

  it("Smithers generated-reference filters do not ban required official CLI markers", () => {
    const source = readSource(
      join(
        productSpecRoot,
        "extension",
        "smithers-reference",
        "scripts",
        "generate-smithers-fragment.reference.ts",
      ),
    );
    const forbiddenMarkersStart = source.indexOf("const forbiddenMarkers = [");
    const forbiddenMarkersEnd = source.indexOf("] as const;", forbiddenMarkersStart);
    const forbiddenMarkerSource = source.slice(forbiddenMarkersStart, forbiddenMarkersEnd);
    const forbiddenMarkers = Array.from(
      forbiddenMarkerSource.matchAll(/"([^"]+)"/g),
      (match) => match[1] ?? "",
    );
    const requiredMarkers = Array.from(
      source.matchAll(/requiredMarkers:\s*\[([\s\S]*?)\]/g),
      (match) => match[1] ?? "",
    ).flatMap((markerSource) =>
      Array.from(markerSource.matchAll(/"([^"]+)"/g), (match) => match[1] ?? ""),
    );
    const officialMarkers = requiredMarkers.filter((marker) =>
      marker.startsWith("bunx smithers-orchestrator "),
    );

    expect(officialMarkers.length).toBeGreaterThan(0);
    expect(
      officialMarkers.flatMap((marker) =>
        forbiddenMarkers
          .filter((forbiddenMarker) => marker.includes(forbiddenMarker))
          .map((forbiddenMarker) => `${marker} includes ${forbiddenMarker}`),
      ),
    ).toEqual([]);
    expect(source).toContain("bare bunx smithers command");
  });

  it("source code avoids stale package architecture helper names", () => {
    const staleHelperPatterns = [
      /\bcreateRuntime(?:Surface|GeneratedContext|Title)StatePortLayer\b/,
      /\blayerRuntime(?:Surface|GeneratedContext|Title)StatePort\b/,
      /\bcreateExtensionsFacade\b/,
      /\bcreateSandboxDiagnosticsFacade\b/,
      /\bExtensionStatePort\.generatedContext\b/,
    ];
    const violations = [...sourceRoots, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return staleHelperPatterns
            .filter((pattern) => pattern.test(source))
            .map((pattern) => `${display(file)} -> ${pattern}`);
        }),
    );

    expect(violations).toEqual([]);
  });

  it("extensions package spec gives concrete examples for every public service group", () => {
    const source = readSource(join(packageArchitectureSpecRoot, "extensions.spec.md"));
    const start = source.indexOf("## Public Service Group Examples");
    const end = source.indexOf("\n## ", start + 1);
    const examples = source.slice(start, end === -1 ? undefined : end);
    const serviceGroups = [
      "registry",
      "actorBindings",
      "generatedContext",
      "nativeTools",
      "svvyx",
      "executeTypescriptFacadeDeclarations",
      "generatedPackages",
      "env",
      "dependencies",
      "sources",
      "builtin",
      "externalInstructions",
    ];

    const missing = serviceGroups.flatMap((group) => {
      const heading = `### \`${group}\``;
      const sectionStart = examples.indexOf(heading);
      if (sectionStart === -1) {
        return [`${group} missing heading`];
      }

      const nextSectionStart = examples.indexOf("\n### ", sectionStart + heading.length);
      const section = examples.slice(
        sectionStart,
        nextSectionStart === -1 ? undefined : nextSectionStart,
      );

      return [
        section.includes("Use case:") ? null : `${group} missing use case`,
        section.includes("Backing:") ? null : `${group} missing backing`,
        section.includes("Success:") ? null : `${group} missing success example`,
        section.includes("Rejected:") ? null : `${group} missing rejected example`,
      ].filter((issue): issue is string => issue !== null);
    });

    expect(missing).toEqual([]);
  });

  it("runtime source-edit specs do not promote workflow lifecycle placeholders", () => {
    const source = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));
    const sourceEditApiStart = source.indexOf("type RuntimeSourceEditsApiEffect = {");
    const sourceEditApiEnd = source.indexOf("};", sourceEditApiStart);
    const sourceEditPromiseStart = source.indexOf("type RuntimeSourceEditsApiPromise = {");
    const sourceEditPromiseEnd = source.indexOf("};", sourceEditPromiseStart);

    expect(sourceEditApiStart).toBeGreaterThanOrEqual(0);
    expect(sourceEditApiEnd).toBeGreaterThan(sourceEditApiStart);
    expect(sourceEditPromiseStart).toBeGreaterThanOrEqual(0);
    expect(sourceEditPromiseEnd).toBeGreaterThan(sourceEditPromiseStart);

    const sourceEditContracts = [
      source.slice(sourceEditApiStart, sourceEditApiEnd),
      source.slice(sourceEditPromiseStart, sourceEditPromiseEnd),
    ].join("\n");
    const forbiddenPromotedMethods = [
      /createWorkflowAgent/,
      /duplicateWorkflowAgent/,
      /deleteWorkflowAgent/,
      /createWorkflowPrompt/,
      /deleteWorkflowPrompt/,
      /createWorkflowComponent/,
      /deleteWorkflowComponent/,
      /createWorkflow\(/,
      /deleteWorkflow\(/,
      /WorkflowAgentSourceLifecycleResult/,
      /WorkflowPromptSourceLifecycleResult/,
      /WorkflowComponentSourceLifecycleResult/,
      /WorkflowWorkflowSourceLifecycleResult/,
    ];
    const violations = forbiddenPromotedMethods
      .filter((pattern) => pattern.test(sourceEditContracts))
      .map((pattern) => pattern.source);

    expect(violations).toEqual([]);
    expect(sourceEditContracts).toContain("OpenExtensionSourceEditInput");
    expect(sourceEditContracts).toContain("SaveExtensionSourceEditInput");
    expect(source).toContain("not promoted runtime APIs in this spec revision");
    expect(source).toContain("exact `@svvy/core` schemas and result types");
  });

  it("extracted package source avoids stale Workflows source edit kind names", () => {
    const staleSourceKindPattern = /\bworkflow-module\b/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".spec.ts"))
        .filter((file) => staleSourceKindPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("product specs do not preserve deprecated svvyx command option contracts", () => {
    const rejectedSpecPatterns = [
      {
        pattern: /\bDeprecated Options\b/,
        reason: "App-owned svvyx commands remove obsolete options instead of documenting them",
      },
      {
        pattern: /deprecated:\s*true/,
        reason: "Generated svvyx schemas must not carry deprecated option metadata",
      },
      {
        pattern: /\[deprecated\]/,
        reason: "Generated svvyx help must not preserve deprecated option labels",
      },
      {
        pattern: /\bwarning-and-continue\b/,
        reason: "Obsolete svvyx options fail closed instead of warning and continuing",
      },
    ];
    const violations = listMarkdownFiles(productSpecRoot).flatMap((file) => {
      const source = readSource(file);
      return rejectedSpecPatterns
        .filter(({ pattern }) => pattern.test(source))
        .map(({ pattern, reason }) => `${display(file)} -> ${pattern}: ${reason}`);
    });

    expect(violations).toEqual([]);
  });

  it("app code imports extracted packages through public workspace package names", () => {
    const violations = listTypeScriptFiles(appSourceRoot).flatMap((file) =>
      readImports(file)
        .filter(
          (specifier) =>
            specifier.includes("packages/core") ||
            specifier.includes("packages/pi-adapter") ||
            specifier.includes("packages/runtime") ||
            specifier.includes("packages/sandbox") ||
            specifier.includes("packages/state") ||
            specifier.includes("packages/extensions") ||
            specifier.startsWith("@svvy/core/") ||
            specifier.startsWith("@svvy/extensions/") ||
            (specifier.startsWith("@svvy/pi-adapter/") &&
              specifier !== "@svvy/pi-adapter/internal/session" &&
              !allowedPublicSubpathImports.has(specifier)) ||
            (specifier.startsWith("@svvy/runtime/") &&
              !allowedPublicSubpathImports.has(specifier)) ||
            specifier.startsWith("@svvy/sandbox/") ||
            (specifier.startsWith("@svvy/state/") && !allowedPublicSubpathImports.has(specifier)),
        )
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("Bun production code keeps direct @svvy/state store access on the refactor ledger", () => {
    const expectedDirectStateStoreImports = [
      "src/bun/session-catalog.ts -> @svvy/state/structured-session-state",
    ];
    const actualDirectStateStoreImports = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier.startsWith("@svvy/state/"))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actualDirectStateStoreImports).toEqual(expectedDirectStateStoreImports);
  });

  it("Bun production code keeps pi-adapter internal imports on the refactor ledger", () => {
    const expectedInternalPiAdapterImports = [
      "src/bun/session-catalog.ts -> @svvy/pi-adapter/internal/session",
    ];
    const actualInternalPiAdapterImports = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier.startsWith("@svvy/pi-adapter/internal/"))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actualInternalPiAdapterImports).toEqual(expectedInternalPiAdapterImports);
  });

  it("Bun production code does not expose structured store escape hatches", () => {
    const structuredStoreGetterViolations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .filter((file) => /\bgetStructuredSessionStore\b/.test(readSource(file)))
      .map(display);

    expect(structuredStoreGetterViolations).toEqual([]);
  });

  it("extension context impact store adapter stays inside the catalog bootstrap edge", () => {
    const actualFacadeFactoryUses = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .filter((file) =>
        /\bruntimeExtensionContextImpactStateFacadeFromStore\b/.test(readSource(file)),
      )
      .map(display)
      .toSorted();

    expect(actualFacadeFactoryUses).toEqual(["src/bun/session-catalog.ts"]);
  });

  it("migrated native tool modules stay pi-free", () => {
    const violations = migratedNativeToolModules.flatMap((file) =>
      readImports(file)
        .filter((specifier) => specifier.startsWith("@mariozechner/"))
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("prompt execution context is package-owned and not an app-local contract", () => {
    expect(existsSync(join(projectRoot, "src", "bun", "prompt-execution-context.ts"))).toBe(false);

    const violations = listTypeScriptFiles(appSourceRoot).flatMap((file) =>
      readImports(file)
        .filter((specifier) => specifier.includes("prompt-execution-context"))
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("app source does not keep a local pi custom tool adapter", () => {
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => display(file) === "src/bun/pi-custom-tool-definitions.ts")
      .map(display);

    expect(violations).toEqual([]);
  });

  it("app source does not define sandbox denial classification", () => {
    const classifierDeclarations =
      /\bfunction\s+(?:sandboxDenialFacts|isSandboxDenialOutput|isEscalatableSandboxDenialOutput|isSandboxHelperBootstrapFailure|hasSandboxHelperOriginMarker)\b|sandboxEngine:\s*["']macos-seatbelt["']/;
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .filter((file) => classifierDeclarations.test(readSource(file)))
      .map(display);

    expect(violations).toEqual([]);
  });

  it("list_extensions app wrapper delegates actor-visible listing semantics to @svvy/extensions", () => {
    const source = readSource(join(projectRoot, "src", "bun", "extension-tools.ts"));
    const start = source.indexOf("export function createListExtensionsTool");
    const end = source.indexOf("export function createLoadExtensionTool");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const listToolSource = source.slice(start, end);
    expect(listToolSource).toContain("listExtensionsForActor(");
    expect(listToolSource).not.toContain("visibleExtensionRecords(");
  });

  it("load_extension app wrapper delegates handler invocation and effect application to @svvy/runtime", () => {
    const source = readSource(join(projectRoot, "src", "bun", "extension-tools.ts"));
    const start = source.indexOf("export function createLoadExtensionTool");
    const end = source.indexOf("function promptTargetFromRuntime");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const loadToolSource = source.slice(start, end);
    expect(loadToolSource).toContain("runAcceptedLoadExtensionToolCallAtRuntimeBoundary(");
    expect(loadToolSource).toContain("commandStatePort:");
    expect(loadToolSource).toContain("actorExtensionBindingStatePort:");
    expect(loadToolSource).not.toContain("loadExtensionHandler.invoke");
    expect(loadToolSource).not.toContain("applyRuntimeEffectRequests(");
    expect(loadToolSource).not.toContain("buildSystemPrompt(");
    expect(loadToolSource).not.toContain("buildExecuteTypescriptApiDeclaration(");
    expect(loadToolSource).not.toContain("onContextRefreshed");
  });

  it("request_user_input app wrapper delegates handler invocation and effect application to @svvy/runtime", () => {
    const source = readSource(join(projectRoot, "src", "bun", "request-user-input-tool.ts"));
    const start = source.indexOf("async function runNonblockingRequestUserInputHandler");
    const end = source.indexOf("export function createRequestUserInputTool");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const nonblockingSource = source.slice(start, end);
    expect(nonblockingSource).toContain("runAcceptedRequestUserInputToolCallAtRuntimeBoundary(");
    expect(nonblockingSource).toContain("commandStatePort:");
    expect(nonblockingSource).not.toContain("invokeRequestUserInputHandlerAtRuntimeBoundary");
    expect(nonblockingSource).not.toContain("applyRuntimeEffectRequestsAtRuntimeBoundary");
    expect(nonblockingSource).not.toContain("requestUserInputHandler.invoke");
    expect(nonblockingSource).not.toContain("applyRuntimeEffectRequests(");
    expect(nonblockingSource).not.toContain("recordRequestUserInputProgress(");
    expect(nonblockingSource).not.toContain(".finishCommand(");
  });

  it("only @svvy/runtime applies RuntimeEffectRequest values", () => {
    const effectApplicationPattern = /\bapplyRuntimeEffectRequests?\s*\(/;
    const scannedRoots = [
      ...sourceRoots.filter((root) => root !== join(packageRoot, "runtime", "src")),
      appSourceRoot,
    ];
    const violations = scannedRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => effectApplicationPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("app-local runtime effect request algebras stay on the svvyx transport retirement ledger", () => {
    const localRuntimeEffectPatterns = [
      {
        pattern: /\btype\s+SvvyxSubprocessRuntimeEffectRequest\b/g,
        name: "type SvvyxSubprocessRuntimeEffectRequest",
      },
      {
        pattern: /\bfunction\s+applySvvyxSubprocessRuntimeEffectRequest\b/g,
        name: "function applySvvyxSubprocessRuntimeEffectRequest",
      },
    ];
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        return localRuntimeEffectPatterns.flatMap(({ pattern, name }) =>
          [...source.matchAll(pattern)].map(() => `${display(file)} -> ${name}`),
        );
      })
      .toSorted();

    expect(violations).toEqual([]);
  });

  it("generated @svvyx/extensions output remains authoring references only", () => {
    const forbiddenGeneratedOutputPatterns = [
      /@svvy\/core/,
      /@svvy\/runtime/,
      /@svvy\/state/,
      /@svvy\/sandbox/,
      /@svvy\/pi-adapter/,
      /@svvy\/desktop/,
      /@svvy\/extensions/,
      /@svvyx\/workflows/,
      /createRuntimeFacade/,
      /executeTypescriptFacadeDeclarations/,
      /nativeTools/,
      /workflowTaskAgentUsage/,
      /\bslug\b/,
      /Context\.Service/,
      /ManagedRuntime/,
      /\bLayer\b/,
      /\beffect\/Metric\b/,
      /\beffect\/Logger\b/,
      /\beffect\/Tracer\b/,
      /\beffect\/unstable\/observability\b/,
      /@effect\/opentelemetry/,
      /\bMetric\./,
      /\bLogger\./,
      /\bTracer\./,
      /(?:extensions|Extensions)(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\.run\b/,
    ];
    const violations = renderGeneratedExtensionsPackageFiles(
      new Set(["artifacts", "workflows"]),
    ).flatMap((file) =>
      forbiddenGeneratedOutputPatterns
        .filter((pattern) => pattern.test(file.contents))
        .map((pattern) => `${file.relativePath} -> ${pattern}`),
    );

    expect(violations).toEqual([]);
  });

  it("execute_typescript declarations do not expose generated packages as runtime facades", () => {
    const source = readSource(
      join(projectRoot, "generated", "execute-typescript-api.generated.ts"),
    );
    const forbiddenGeneratedFacadePatterns = [
      /@svvyx\/workflows/,
      /@svvyx\/extensions/,
      /declare module ["']@svvyx\//,
      /from ["']@svvy\/runtime["']/,
      /from ["']@svvy\/state["']/,
      /from ["']@svvy\/extensions["']/,
      /from ["']@svvy\/sandbox["']/,
      /from ["']@svvy\/pi-adapter["']/,
      /\bContext\.Service\b/,
      /\bManagedRuntime\b/,
      /\beffect\/Runtime\b/,
      /\beffect\/Metric\b/,
      /\beffect\/Logger\b/,
      /\beffect\/Tracer\b/,
      /\beffect\/unstable\/observability\b/,
      /@effect\/opentelemetry/,
      /\bMetric\./,
      /\bLogger\./,
      /\bTracer\./,
      /\bStateStore\b/,
      /\bRuntimeEffectRequest\b/,
      /\bExtensionExecutionPlan\b/,
      /\bSandbox\b/,
      /\bPiAdapter\b/,
    ];
    const violations = forbiddenGeneratedFacadePatterns
      .filter((pattern) => pattern.test(source))
      .map(String);

    expect(violations).toEqual([]);
  });

  it("workflow authoring declarations expose structured reasoning selections only", () => {
    const source = readSource(
      join(projectRoot, "generated", "workflow-authoring-contract.generated.ts"),
    );

    expect(source).toContain("type ReasoningSelection =");
    expect(source).toContain("reasoning: ReasoningSelection");
    expect(source).not.toContain("reasoningEffort: ReasoningEffort");
  });

  it("generated declaration artifacts do not expose pi-native or implementation internals", () => {
    const forbiddenGeneratedDeclarationPatterns = [
      /@mariozechner\//,
      /@svvy\/pi-adapter\/internal\//,
      /from ["']@svvy\/runtime["']/,
      /from ["']@svvy\/state["']/,
      /from ["']@svvy\/extensions["']/,
      /from ["']@svvy\/sandbox["']/,
      /from ["']@svvy\/desktop["']/,
      /\beffect\/Runtime\b/,
      /\beffect\/Metric\b/,
      /\beffect\/Logger\b/,
      /\beffect\/Tracer\b/,
      /\beffect\/unstable\/observability\b/,
      /@effect\/opentelemetry/,
      /\bMetric\./,
      /\bLogger\./,
      /\bTracer\./,
    ];
    const violations = listTypeScriptFiles(join(projectRoot, "generated"))
      .filter((file) => file.endsWith(".generated.ts"))
      .flatMap((file) =>
        forbiddenGeneratedDeclarationPatterns
          .filter((pattern) => pattern.test(readSource(file)))
          .map((pattern) => `${display(file)} -> ${pattern}`),
      );

    expect(violations).toEqual([]);
  });

  it("runtime facade keeps generated package refresh behind sourceInvalidation", () => {
    const runtimeSource = readSource(join(packageRoot, "runtime", "src", "index.ts"));
    expect(runtimeSource).toContain("refreshGeneratedPackages(");
    expect(runtimeSource).toContain("RuntimeSourceInvalidationService");
    expect(runtimeSource).toContain("RuntimeSourceInvalidationFacade");
    expect(runtimeSource).toContain("decodeRefreshGeneratedPackagesRequestEffect");
    expect(runtimeSource).toContain("decodeGeneratedPackagesRefreshResultEffect");
    expect(runtimeSource).not.toContain("productStateChanged");
    expect(runtimeSource).not.toContain("decodeStateInvalidationDescriptorEffect");

    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    expect(runtimeLayerSource).toContain("sourceInvalidation.refreshGeneratedPackages");
    const adapterSource = readSource(runtimeServiceAdapterModule);
    expect(adapterSource).toContain(
      "RuntimeLayerSourceInvalidationPort.of(port.sourceInvalidation)",
    );
    expect(adapterSource).not.toContain(
      "RuntimeLayerSourceInvalidationPort.of(port.sourceInvalidation ?? {})",
    );
    expect(adapterSource).not.toContain("productStateChanged");
    expect(adapterSource).not.toContain("buildWorkflowsGeneratedPackage(");
    expect(adapterSource).not.toContain("refreshGeneratedExtensionsPackage(");
  });

  it("runtime source edit facade is backed by a required layer port", () => {
    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    const adapterSource = readSource(runtimeServiceAdapterModule);
    const registrySource = readSource(
      join(projectRoot, "src", "bun", "workspace-runtime-registry.ts"),
    );

    expect(runtimeLayerSource).toContain(
      "open(input: OpenExtensionSourceEditInput): Promise<SourceEditSession>;",
    );
    expect(runtimeLayerSource).toContain(
      "save(input: SaveExtensionSourceEditInput): Promise<SourceEditSaveResult>;",
    );
    expect(runtimeLayerSource).not.toContain("open?(input: OpenExtensionSourceEditInput)");
    expect(runtimeLayerSource).not.toContain("save?(input: SaveExtensionSourceEditInput)");
    expect(runtimeLayerSource).not.toContain(
      'unsupportedRuntimeMethod("runtime.sourceEdits.open")',
    );
    expect(runtimeLayerSource).not.toContain(
      'unsupportedRuntimeMethod("runtime.sourceEdits.save")',
    );
    expect(adapterSource).toContain("RuntimeLayerSourceEditsPort.of(port.sourceEdits)");
    expect(adapterSource).not.toContain("RuntimeLayerSourceEditsPort.of(port.sourceEdits ?? {})");
    expect(registrySource).toContain("sourceEdits: {");
    expect(registrySource).toContain("open: (input) => this.openExtensionSourceEdit(");
    expect(registrySource).toContain("save: (input) => this.saveExtensionSourceEdit(");
  });

  it("generated package refresh status exposes structured dependency evidence", () => {
    const source = readSource(join(packageRoot, "core", "src", "generated-package-contracts.ts"));

    expect(source).toContain("GeneratedPackageDependencyEvidenceSchema");
    expect(source).toContain(
      'resolution: Schema.Literals(["app-owned-package", "package-manager"])',
    );
    expect(source).toContain('resolution: Schema.Literal("generated-package-link")');
    expect(source).not.toMatch(
      /dependencies:\s*Schema\.optional\(\s*Schema\.Array\(\s*Schema\.Struct\(\{\s*name:\s*Schema\.String,\s*version:\s*Schema\.String/s,
    );
  });

  it("generated @svvyx/extensions writer owns emitted file contents", () => {
    const source = readSource(join(projectRoot, "src", "bun", "generated-extensions-package.ts"));
    expect(source).toContain("renderGeneratedExtensionsPackageFiles");
    expect(source).not.toContain("export const Extensions = {");
    expect(source).not.toContain("export type ExtensionReference");
  });

  it("workspace generated package link repair is applied by runtime against an app file host", () => {
    const runtimeSource = readSource(
      join(packageRoot, "runtime", "src", "generated-package-refresh.ts"),
    );
    const registrySource = readSource(
      join(projectRoot, "src", "bun", "workspace-runtime-registry.ts"),
    );
    const adapterSource = readSource(runtimeServiceAdapterModule);

    expect(runtimeSource).toContain("applyGeneratedPackageWorkspaceLinkRepairPlan(");
    expect(runtimeSource).toContain("host.workspaceLinkFileHost");
    expect(registrySource).toContain("workspaceLinkFileHost:");
    expect(adapterSource).toContain("workspaceLinkFileHost: input.host.workspaceLinkFileHost");
    expect(registrySource).not.toContain("applyGeneratedPackageWorkspaceLinkRepairPlan(");
    expect(registrySource).not.toContain("applyWorkspaceLinkRepairPlan");
    expect(adapterSource).not.toContain("applyWorkspaceLinkRepairPlan");
    expect(registrySource).not.toContain("ensureWorkflowsPackageLink(");
    expect(registrySource).not.toContain("ensureExtensionsPackageLink(");
    expect(registrySource).not.toContain("ensureWorkflowsPackageLinks(");
  });

  it("app command trackers do not duplicate native tool metadata", () => {
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .filter((file) => readSource(file).includes("SPECIALIZED_TOOL_NAMES"))
      .map(display);

    expect(violations).toEqual([]);
  });

  it("app prompt handlers use the runtime facade instead of catalog prompt operations directly", () => {
    const catalogRuntimeOperationPattern =
      /\b(?:runtime\.)?catalog\.(?:resolvePromptDefaultsForTarget|sendPrompt|cancelPrompt|steerQueuedSurfaceMessage)\b/;
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => file !== runtimeServiceAdapterModule)
      .filter((file) => !isTestFile(file))
      .filter((file) => catalogRuntimeOperationPattern.test(readSource(file)))
      .map(display);

    expect(violations).toEqual([]);
  });

  it("app request-input and runtime approval answers bridge through the runtime facade", () => {
    const source = readSource(join(projectRoot, "src", "bun", "index.ts"));

    const answerStart = source.indexOf("answerRequestUserInput: async");
    const approvalStart = source.indexOf("answerRuntimeApprovalRequest: async");
    expect(answerStart).toBeGreaterThanOrEqual(0);
    expect(approvalStart).toBeGreaterThan(answerStart);
    const answerSource = source.slice(answerStart, approvalStart);
    expect(answerSource).toContain("runtime.runtimeFacade.requestInput.answer(");
    expect(answerSource).not.toContain("runtime.catalog.answerRequestUserInput(");
    expect(answerSource).not.toContain("runtime.catalog.afterRequestInputAnswered(");

    const pauseStart = source.indexOf("setRequestUserInputTimerPaused: async");
    expect(pauseStart).toBeGreaterThan(approvalStart);
    const approvalSource = source.slice(approvalStart, pauseStart);
    expect(approvalSource).toContain("runtime.runtimeFacade.approvals.answer(");
    expect(approvalSource).not.toContain("runtime.catalog.answerRuntimeApprovalRequest(");

    const nextBridgeMethodStart = source.indexOf(
      "setExtensionContextAutoUpdate: async",
      pauseStart,
    );
    expect(pauseStart).toBeGreaterThanOrEqual(0);
    expect(nextBridgeMethodStart).toBeGreaterThan(pauseStart);
    const pauseSource = source.slice(pauseStart, nextBridgeMethodStart);
    expect(pauseSource).toContain("runtime.runtimeFacade.requestInput.setTimerPaused(");
    expect(pauseSource).not.toContain("runtime.catalog.setRequestUserInputTimerPaused(");
    expect(pauseSource).not.toContain("runtime.catalog.afterRequestInputTimerPaused(");

    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    expect(runtimeLayerSource).toContain("answerRuntimeRequestInput(input)");
    expect(runtimeLayerSource).toContain("setRuntimeRequestInputTimerPaused(input)");
    expect(runtimeLayerSource).not.toContain("RuntimeLayerCatalogPort");
    const adapterSource = readSource(runtimeServiceAdapterModule);
    expect(adapterSource).toContain("RuntimeLayerPromptHostPort.of");
    expect(adapterSource).toContain("RuntimeLayerRequestInputPostCommitPort.of");
    expect(adapterSource).toContain("RuntimeLayerApprovalPostCommitPort.of");
    expect(adapterSource).toContain("Layer.succeed(RuntimeQueueStatePort");
    expect(adapterSource).toContain("Layer.succeed(RuntimeRequestStatePort");
    expect(adapterSource).toContain("Layer.succeed(RuntimeApprovalStatePort");
    expect(adapterSource).toContain("Layer.succeed(RuntimeCommandStatePort");
    expect(adapterSource).toContain("Layer.succeed(RuntimeSessionWaitStatePort");
    expect(adapterSource).toContain("RuntimeEventBus");
  });

  it("app pi prompt materialization stays at explicit catalog and pi-adapter edges", () => {
    const promptAssemblyPattern =
      /\b(?:buildRuntimeSubmittedUserMessage|composerAttachmentFromRuntimeAttachment|composerAttachmentPromptText|serializeComposerAttachmentTextSignature|SvvyUserMessage|TextContent|ImageContent)\b/;
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => file !== runtimeServiceAdapterModule && file !== sessionCatalogModule)
      .filter((file) => !isTestFile(file))
      .filter((file) => promptAssemblyPattern.test(readSource(file)))
      .map(display);

    expect(violations).toEqual([]);
  });

  it("app bootstrap creates Effect runtime facades only through the runtime service adapter", () => {
    const appRuntimeBootstrapPattern =
      /\b(?:createRuntimeFacade|ManagedRuntime\.make)\b|["']effect\/ManagedRuntime["']/;
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => file !== runtimeServiceAdapterModule)
      .filter((file) => !isTestFile(file))
      .filter((file) => appRuntimeBootstrapPattern.test(readSource(file)))
      .map(display);

    expect(violations).toEqual([]);
  });

  it("runtime service adapter waits for Effect runtime readiness before exposing the facade", () => {
    const source = readSource(runtimeServiceAdapterModule);
    const adapterStart = source.indexOf("export async function createCatalogBackedRuntime(");
    const managedRuntimeStart = source.indexOf(
      "const managedRuntime = ManagedRuntime.make(",
      adapterStart,
    );
    const managedRuntimeMakeStart = source.indexOf("ManagedRuntime.make", managedRuntimeStart);
    const runtimeRootLayer = source.indexOf("Runtime.layer", managedRuntimeStart);
    const runtimeServiceLift = source.indexOf("Layer.succeed(Runtime", managedRuntimeStart);
    const contextAwait = source.indexOf("await managedRuntime.context();", managedRuntimeStart);
    const startupReadinessAwait = source.indexOf(
      "await awaitRuntimeStartupReadiness(managedRuntime);",
      contextAwait,
    );
    const facadeCreation = source.indexOf(
      "const facade = createRuntimeFacade(managedRuntime);",
      startupReadinessAwait,
    );
    const shutdownPreparation = source.indexOf(
      'await prepareRuntimeShutdown(managedRuntime, { reason: "app-shutdown" });',
      facadeCreation,
    );

    expect(adapterStart).toBeGreaterThanOrEqual(0);
    expect(managedRuntimeStart).toBeGreaterThan(adapterStart);
    expect(runtimeRootLayer).toBeGreaterThan(managedRuntimeStart);
    expect(runtimeRootLayer).toBeLessThan(contextAwait);
    expect(runtimeServiceLift).toBe(-1);
    expect(contextAwait).toBeGreaterThan(managedRuntimeStart);
    expect(startupReadinessAwait).toBeGreaterThan(contextAwait);
    expect(facadeCreation).toBeGreaterThan(startupReadinessAwait);
    expect(shutdownPreparation).toBeGreaterThan(facadeCreation);
    expect(
      Array.from(source.matchAll(/\bManagedRuntime\.make\b/g), (match) => match.index),
    ).toEqual([managedRuntimeMakeStart]);
    expect(source).not.toContain("managedRuntime.runPromise(Runtime)");
    expect(source).not.toMatch(/\bservice:\s*RuntimeService\b/);
    expect(source).not.toMatch(/\bconst\s+service\s*=/);
    expect(source).toMatch(
      /\bimport\s+\{\s*createRuntimeFacade,\s*Runtime\s*\}\s+from\s+["']@svvy\/runtime["'];/,
    );
    expect(source).not.toMatch(/\bRuntimeLayer\s*\(/);
    expect(source).not.toMatch(/\bRuntime\.layer\s*\(/);
    expect(source).not.toMatch(/\bLayer\.succeed\(\s*Runtime\s*,/);
  });

  it("@svvy/runtime root keeps ManagedRuntime as a facade type only", () => {
    const source = readSource(join(packageRoot, "runtime", "src", "index.ts"));

    expect(source).toMatch(
      /\bimport\s+type\s+\*\s+as\s+ManagedRuntime\s+from\s+["']effect\/ManagedRuntime["'];/,
    );
    expect(source).not.toMatch(
      /\bimport\s+(?!type\b)\*\s+as\s+ManagedRuntime\s+from\s+["']effect\/ManagedRuntime["']/,
    );
    expect(source).not.toMatch(
      /\bManagedRuntime\.(?:make|runPromise|runPromiseExit|runSync|runSyncExit|runFork|runCallback)\b/,
    );
  });

  it("app and desktop consumers do not import runtime root facade and service type aliases", () => {
    const forbiddenRootTypeAliases = new Set([
      "AppliedSvvyxRuntimeEffectTransportRequest",
      "ApplySvvyxRuntimeEffectTransportRequestInput",
      "RuntimeCommandsFacade",
      "RuntimeCommandsService",
      "RuntimeEventSubscription",
      "RuntimeEventSubscriptionEffect",
      "RuntimeFacade",
      "RuntimeFacadeCallOptions",
      "RuntimeFacadeError",
      "RuntimeFacadeErrorReason",
      "RuntimeMessagesFacade",
      "RuntimeMessagesService",
      "RuntimeQueuesFacade",
      "RuntimeQueuesService",
      "RuntimeRequestInputFacade",
      "RuntimeRequestInputService",
      "RuntimeService",
      "RuntimeSourceEditsFacade",
      "RuntimeSourceEditsService",
      "RuntimeSourceInvalidationFacade",
      "RuntimeSourceInvalidationService",
    ]);
    const roots = [join(projectRoot, "src", "bun"), join(packageRoot, "desktop", "src")];
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readNamedImportNames(file, "@svvy/runtime")
            .filter((name) => forbiddenRootTypeAliases.has(name))
            .map((name) => `${display(file)} -> ${name}`),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("app code imports core-owned prompt execution context contracts from @svvy/core", () => {
    const forbiddenBootstrapPromptContextTypes = new Set([
      "PromptExecutionContext",
      "PromptExecutionEpisodeKind",
      "PromptExecutionExternalInstructionSource",
      "PromptExecutionRuntimeHandle",
      "PromptExecutionSurfaceKind",
      "createPromptExecutionContext",
    ]);
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .flatMap((file) =>
        readNamedImportNames(file, "@svvy/runtime/bootstrap")
          .filter((name) => forbiddenBootstrapPromptContextTypes.has(name))
          .map((name) => `${display(file)} -> ${name}`),
      )
      .toSorted();

    expect(violations).toEqual([]);
  });

  it("runtime bootstrap does not re-export core-owned prompt execution context contracts", () => {
    const runtimeBootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "bootstrap.ts"))),
    ];
    const forbiddenBootstrapSymbols = runtimeBootstrapSymbols.filter(
      (symbol) =>
        symbol === "PromptExecutionContext" ||
        symbol === "PromptExecutionEpisodeKind" ||
        symbol === "PromptExecutionExternalInstructionSource" ||
        symbol === "PromptExecutionRuntimeHandle" ||
        symbol === "PromptExecutionSurfaceKind" ||
        symbol === "createPromptExecutionContext",
    );

    expect(forbiddenBootstrapSymbols).toEqual([]);
  });

  it("runtime-effect transport appliers stay private to command-session implementation code", () => {
    const forbiddenRuntimeEffectTransportSymbols = new Set([
      "applySvvyxRuntimeEffectTransportRequest",
      "AppliedSvvyxRuntimeEffectTransportRequest",
      "ApplySvvyxRuntimeEffectTransportRequestInput",
    ]);
    const runtimeBootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "bootstrap.ts"))),
    ];
    const forbiddenBootstrapSymbols = runtimeBootstrapSymbols.filter((symbol) =>
      forbiddenRuntimeEffectTransportSymbols.has(symbol),
    );
    const consumerViolations = [
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
      ...listTypeScriptFiles(join(packageRoot, "desktop", "src")),
    ]
      .flatMap((file) =>
        readNamedImportNames(file, "@svvy/runtime/bootstrap")
          .filter((name) => forbiddenRuntimeEffectTransportSymbols.has(name))
          .map((name) => `${display(file)} -> ${name}`),
      )
      .toSorted();

    expect(forbiddenBootstrapSymbols).toEqual([]);
    expect(consumerViolations).toEqual([]);
  });

  it("prompt execution context does not carry submitted prompt text", () => {
    const corePromptContextSource = readSource(
      join(packageRoot, "core", "src", "prompt-execution-context.ts"),
    );
    const runtimePromptContextSource = readSource(
      join(packageRoot, "runtime", "src", "prompt-execution-context.ts"),
    );

    expect(corePromptContextSource).not.toMatch(/\bpromptText\b/);
    expect(runtimePromptContextSource).not.toMatch(/\bpromptText\b/);
  });

  it("prompt execution context carries external instruction metadata but not file content", () => {
    const corePromptContextSource = readSource(
      join(packageRoot, "core", "src", "prompt-execution-context.ts"),
    );

    expect(corePromptContextSource).toContain("PromptExecutionExternalInstructionSource");
    expect(corePromptContextSource).toContain("contentHash: string");
    expect(corePromptContextSource).not.toMatch(/\bcontent:\s*string\b/);
  });

  it("runtime root exposes both Runtime.layer and the root layer alias", () => {
    const source = readSource(join(packageRoot, "runtime", "src", "index.ts"));

    expect(source).toContain("export namespace Runtime");
    expect(source).toMatch(
      /export const layer:\s*Layer\.Layer<Runtime,\s*RuntimeLayerError,\s*RuntimeLayerRequirements>\s*=\s*Layer\.effect\(Runtime,\s*makeRuntimeService\(\)\);/,
    );
    expect(source).toContain("export const layer = Runtime.layer;");
    expect(source).not.toMatch(/\bexport\s+const\s+layerRuntime\b/);
    expect(source).not.toMatch(/\bexport\s+const\s+layer\s*=\s*\(\s*service\b/);
    expect(source).not.toMatch(/\bLayer\.succeed\(\s*Runtime\s*,\s*service\s*\)/);
    expect(source).not.toMatch(/\bRuntime\.layer\s*\(/);
  });

  it("renderer, desktop edge, and headless tests do not create or run Effect runtimes", () => {
    const roots = [
      join(projectRoot, "src", "mainview"),
      join(projectRoot, "src", "shared"),
      join(packageRoot, "desktop", "src"),
      join(projectRoot, "e2e"),
    ].filter((root) => existsSync(root));
    const forbiddenPatterns = [
      { pattern: /\bManagedRuntime\.make\b/g, name: "ManagedRuntime.make" },
      { pattern: /\bEffect\.runPromise\b/g, name: "Effect.runPromise" },
      { pattern: /\bEffect\.runPromiseWith\b/g, name: "Effect.runPromiseWith" },
      { pattern: /\bEffect\.runPromiseExit\b/g, name: "Effect.runPromiseExit" },
      { pattern: /\bEffect\.runPromiseExitWith\b/g, name: "Effect.runPromiseExitWith" },
      { pattern: /\bEffect\.runSync\b/g, name: "Effect.runSync" },
      { pattern: /\bEffect\.runSyncWith\b/g, name: "Effect.runSyncWith" },
      { pattern: /\bEffect\.runSyncExit\b/g, name: "Effect.runSyncExit" },
      { pattern: /\bEffect\.runSyncExitWith\b/g, name: "Effect.runSyncExitWith" },
      { pattern: /\bEffect\.runFork\b/g, name: "Effect.runFork" },
      { pattern: /\bEffect\.runForkWith\b/g, name: "Effect.runForkWith" },
      { pattern: /\bEffect\.runCallback\b/g, name: "Effect.runCallback" },
      { pattern: /\bEffect\.runCallbackWith\b/g, name: "Effect.runCallbackWith" },
    ];
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) => {
        const source = readSource(file);
        const directViolations = forbiddenPatterns.flatMap(({ pattern, name }) =>
          [...source.matchAll(pattern)].map(() => `${display(file)} -> ${name}`),
        );
        const importViolations = readImports(file)
          .filter(
            (specifier) =>
              specifier === "effect/Runtime" ||
              specifier === "effect/ManagedRuntime" ||
              specifier === "effect/Layer",
          )
          .map((specifier) => `${display(file)} -> ${specifier}`);
        return [...directViolations, ...importViolations];
      }),
    );

    expect(violations).toEqual([]);
  });

  it("renderer and desktop edge modules do not import Effect service APIs", () => {
    const roots = [
      join(projectRoot, "src", "mainview"),
      sharedSourceRoot,
      join(packageRoot, "desktop", "src"),
    ];
    const forbidden = new Set([
      "effect/Context",
      "effect/Layer",
      "effect/ManagedRuntime",
      "effect/Runtime",
      "effect/Scope",
      "effect/Stream",
    ]);
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter((specifier) => forbidden.has(specifier))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("extracted packages call caller-owned ManagedRuntime runners only from facade factories", () => {
    const runnerPattern =
      /\b([A-Za-z_$][\w$]*)\s*\.\s*(run(?:Promise|PromiseExit|Sync|SyncExit|Fork|Callback))\b/g;
    const actual = sourceRoots
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            [...readSource(file).matchAll(runnerPattern)].map(
              (match) => `${display(file)} -> ${match[1]}.${match[2]}`,
            ),
          ),
      )
      .toSorted();

    expect(actual).toEqual([
      "packages/runtime/src/index.ts -> managedRuntime.runPromiseExit",
      "packages/runtime/src/runtime-layer-config.ts -> managedRuntime.runPromise",
      "packages/runtime/src/runtime-layer-config.ts -> managedRuntime.runPromise",
      "packages/state/src/state-facade.ts -> managedRuntime.runPromiseExit",
    ]);
  });

  it("@svvy/sandbox production source does not spawn child processes", () => {
    const forbiddenImportSpecifiers = new Set(["node:child_process", "child_process"]);
    const forbiddenSourcePattern =
      /\bBun\.spawn(?:Sync)?\b|\bspawn(?:Sync)?\s*\(|\bexec(?:File)?\s*\(/;
    const violations = listTypeScriptFiles(join(packageRoot, "sandbox", "src"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => [
        ...readImports(file)
          .filter((specifier) => forbiddenImportSpecifiers.has(specifier))
          .map((specifier) => `${display(file)} -> ${specifier}`),
        ...(forbiddenSourcePattern.test(readSource(file))
          ? [`${display(file)} -> child process spawn`]
          : []),
      ]);

    expect(violations).toEqual([]);
  });

  it("@svvy/state root does not export broad implementation services or storage internals", () => {
    const forbiddenNames = new Set([
      "StateStore",
      "StateRepository",
      "StateTransaction",
      "StateMigration",
      "SqliteDatabase",
      "SqliteTransaction",
      "MigrationRunner",
    ]);
    const actual = readPublicExportedNames(join(packageRoot, "state", "src", "index.ts"))
      .filter(
        (symbol) =>
          forbiddenNames.has(symbol) ||
          /(?:Repository|Sqlite|SQLite|Migration|Transaction|Table)$/.test(symbol),
      )
      .toSorted();

    expect(actual).toEqual([]);
  });

  it("@svvy/state root keeps legacy store leaks explicit while the package facade lands", () => {
    const expectedLegacyStoreLeakExports = [
      "extensionStatePortFromStore",
      "providerAuthStatusStatePortFromStore",
      "runtimeActorExtensionBindingStatePortFromStore",
      "runtimeArtifactStatePortFromStore",
      "runtimeApprovalStatePortFromStore",
      "runtimeCommandStatePortFromStore",
      "runtimeComposerDraftStatePortFromStore",
      "runtimeEpisodeStatePortFromStore",
      "runtimeExtensionContextImpactStateFacadeFromStore",
      "runtimeExtensionContextImpactStatePortFromStore",
      "runtimeExtensionStatePortFromStore",
      "runtimeGeneratedPackageStatePortFromStore",
      "runtimeQueueStatePortFromStore",
      "runtimeReadModelStatePortFromStore",
      "runtimeRecoveryStatePortFromStore",
      "runtimeRequestStatePortFromStore",
      "runtimeSessionWaitStatePortFromStore",
      "runtimeSourceStatePortFromStore",
      "runtimeSurfaceLifecycleStatePortFromStore",
      "runtimeThreadStatePortFromStore",
      "runtimeTurnStatePortFromStore",
      "runtimeWorkspaceStatePortFromStore",
    ];
    const leakPatterns = [
      /(?:^|[A-Z])Store(?:$|[A-Z])/,
      /FromStore$/,
      /StateService$/,
      /^layer.*State$/,
      /^create.*Store$/,
      /^StructuredSessionState$/,
      /^structuredSessionStateFromStore$/,
    ];
    const actual = readPublicExportedNames(join(packageRoot, "state", "src", "index.ts"))
      .filter((symbol) => leakPatterns.some((pattern) => pattern.test(symbol)))
      .toSorted();

    expect(actual).toEqual(expectedLegacyStoreLeakExports.toSorted());
  });

  it("@svvy/sandbox root keeps helper and launch-builder leaks explicit while runtime launch moves to Sandbox", () => {
    const actual = readPublicExportedNames(join(packageRoot, "sandbox", "src", "index.ts"))
      .filter((symbol) => expectedLegacySandboxRootExportSymbols.includes(symbol))
      .toSorted();

    expect(actual).toEqual(expectedLegacySandboxRootExportSymbols.toSorted());
  });

  it("Bun production code keeps legacy @svvy/sandbox root launch imports on the refactor ledger", () => {
    const actual = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier === "@svvy/sandbox")
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actual).toEqual(expectedLegacySandboxAppImports);
  });

  it("non-state extracted packages do not import @svvy/state implementation subpaths", () => {
    const scannedRoots = sourceRoots.filter((root) => root !== join(packageRoot, "state", "src"));
    const violations = scannedRoots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter((specifier) => specifier.startsWith("@svvy/state/"))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("Bun production code does not import app-log logger or redaction helpers from @svvy/state root", () => {
    const forbiddenNames = new Set([
      "AppLogAppendInput",
      "AppLogAppender",
      "AppLogDetails",
      "AppLogger",
      "AppLoggerEvent",
      "CreateAppLoggerOptions",
      "appendAppLoggerEvent",
      "createAppLogger",
      "redactAppLogValue",
    ]);
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readNamedImportNames(file, "@svvy/state")
          .filter((name) => forbiddenNames.has(name))
          .map((name) => `${display(file)} -> @svvy/state:${name}`),
      )
      .toSorted();

    expect(violations).toEqual([]);
  });

  it("Bun app bootstrap keeps Effect layer and ManagedRuntime construction in the runtime service adapter", () => {
    const forbiddenPatterns = [
      { pattern: /\bLayer\./g, name: "Layer.*" },
      { pattern: /\bManagedRuntime\.make\b/g, name: "ManagedRuntime.make" },
    ];
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => file !== runtimeServiceAdapterModule)
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        const directViolations = forbiddenPatterns.flatMap(({ pattern, name }) =>
          [...source.matchAll(pattern)].map(() => `${display(file)} -> ${name}`),
        );
        const importViolations = readImports(file)
          .filter(
            (specifier) => specifier === "effect/Layer" || specifier === "effect/ManagedRuntime",
          )
          .map((specifier) => `${display(file)} -> ${specifier}`);
        return [...directViolations, ...importViolations];
      });

    expect(violations).toEqual([]);
  });

  it("runtime-service-adapter remains the only Bun module allowed to expose runRuntimeEffect", () => {
    const runRuntimeEffectDeclarationPattern =
      /\b(?:export\s+)?(?:async\s+)?function\s+runRuntimeEffect\b|\b(?:export\s+)?const\s+runRuntimeEffect\b/;
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => file !== runtimeServiceAdapterModule)
      .filter((file) => !isTestFile(file))
      .filter((file) => runRuntimeEffectDeclarationPattern.test(readSource(file)))
      .map(display);

    expect(violations).toEqual([]);
  });

  it("app-side manual Effect runtime execution stays on an explicit retirement ledger", () => {
    const manualRuntimePatterns = [
      { pattern: /\bEffect\.runPromise\b/g, name: "Effect.runPromise" },
      { pattern: /\bEffect\.runPromiseWith\b/g, name: "Effect.runPromiseWith" },
      { pattern: /\bEffect\.runPromiseExit\b/g, name: "Effect.runPromiseExit" },
      { pattern: /\bEffect\.runPromiseExitWith\b/g, name: "Effect.runPromiseExitWith" },
      { pattern: /\bEffect\.runSync\b/g, name: "Effect.runSync" },
      { pattern: /\bEffect\.runSyncWith\b/g, name: "Effect.runSyncWith" },
      { pattern: /\bEffect\.runSyncExit\b/g, name: "Effect.runSyncExit" },
      { pattern: /\bEffect\.runSyncExitWith\b/g, name: "Effect.runSyncExitWith" },
      { pattern: /\bEffect\.runFork\b/g, name: "Effect.runFork" },
      { pattern: /\bEffect\.runForkWith\b/g, name: "Effect.runForkWith" },
      { pattern: /\bEffect\.runCallback\b/g, name: "Effect.runCallback" },
      { pattern: /\bEffect\.runCallbackWith\b/g, name: "Effect.runCallbackWith" },
      { pattern: /\bManagedRuntime\.make\b/g, name: "ManagedRuntime.make" },
    ];
    const allowedManualRuntimeReads = new Map<string, string[]>([
      ["src/bun/runtime-service-adapter.ts", ["Effect.runPromise", "ManagedRuntime.make"]],
      ["src/bun/session-catalog.ts", ["Effect.runSync"]],
    ]);
    const actualManualRuntimeReads = new Map<string, string[]>();

    for (const file of listTypeScriptFiles(join(projectRoot, "src", "bun")).filter(
      (candidate) => !isTestFile(candidate),
    )) {
      const source = readSource(file);
      const directReads = manualRuntimePatterns.flatMap(({ pattern, name }) =>
        [...source.matchAll(pattern)].map(() => name),
      );
      const effectAliasReads = readValueImportBindings(file, "effect/Effect").flatMap((binding) =>
        manualRuntimePatterns.flatMap(({ name }) => {
          if (!name.startsWith("Effect.")) return [];
          const runner = name.slice("Effect.".length);
          if (binding.kind === "namespace") {
            if (binding.localName === "Effect") return [];
            return Array.from(
              source.matchAll(new RegExp(`\\b${binding.localName}\\.${runner}\\b`, "g")),
              () => name,
            );
          }
          return binding.importedName === runner
            ? Array.from(
                source.matchAll(new RegExp(`\\b${binding.localName}\\s*\\(`, "g")),
                () => name,
              )
            : [];
        }),
      );
      const managedRuntimeAliasReads = readValueImportBindings(
        file,
        "effect/ManagedRuntime",
      ).flatMap((binding) => {
        if (binding.kind === "namespace") {
          if (binding.localName === "ManagedRuntime") return [];
          return Array.from(
            source.matchAll(new RegExp(`\\b${binding.localName}\\.make\\b`, "g")),
            () => "ManagedRuntime.make",
          );
        }
        return binding.importedName === "make"
          ? Array.from(
              source.matchAll(new RegExp(`\\b${binding.localName}\\s*\\(`, "g")),
              () => "ManagedRuntime.make",
            )
          : [];
      });
      const found = [...directReads, ...effectAliasReads, ...managedRuntimeAliasReads];
      if (found.length > 0) {
        actualManualRuntimeReads.set(display(file), found.toSorted());
      }
    }

    expect([...actualManualRuntimeReads.entries()].toSorted()).toEqual(
      [...allowedManualRuntimeReads.entries()].toSorted(),
    );
  });

  it("shared app contracts do not import Bun backend modules", () => {
    const violations = listTypeScriptFiles(sharedSourceRoot).flatMap((file) =>
      readImports(file)
        .filter(
          (specifier) =>
            specifier.startsWith("../bun") ||
            specifier.startsWith("./bun") ||
            specifier.includes("/src/bun/") ||
            specifier.includes("src/bun/"),
        )
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("shared app contracts do not import extracted implementation packages or host modules", () => {
    const forbiddenPackages = [
      "@svvy/extensions",
      "@svvy/state",
      "@svvy/runtime",
      "@svvy/sandbox",
      "@svvy/pi-adapter",
    ];
    const violations = listTypeScriptFiles(sharedSourceRoot).flatMap((file) =>
      isTestFile(file)
        ? []
        : readImports(file)
            .filter(
              (specifier) =>
                forbiddenPackages.some(
                  (packageName) =>
                    specifier === packageName || specifier.startsWith(`${packageName}/`),
                ) ||
                specifier.startsWith("node:") ||
                specifier.startsWith("bun:"),
            )
            .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("package manifests declare only the allowed runtime dependencies and no package-local dev dependencies", () => {
    const violations = Array.from(expectedPackageDependencies).flatMap(
      ([packageName, expectedDependencies]) => {
        const manifest = readPackageManifest(packageName);
        const actualDependencies = Object.keys(manifest.dependencies ?? {}).toSorted();
        const expected = expectedDependencies.toSorted();
        const devDependencies = Object.keys(manifest.devDependencies ?? {}).toSorted();
        const dependencyViolation =
          actualDependencies.length === expected.length &&
          actualDependencies.every((dependency, index) => dependency === expected[index])
            ? []
            : [
                `${packageName} dependencies ${JSON.stringify(actualDependencies)} expected ${JSON.stringify(expected)}`,
              ];
        const devDependencyViolation = devDependencies.length
          ? [`${packageName} devDependencies ${JSON.stringify(devDependencies)} expected []`]
          : [];
        return [...dependencyViolation, ...devDependencyViolation];
      },
    );

    expect(violations).toEqual([]);
  });

  it("package manifest dependency specifiers and public package fields stay fixed", () => {
    const violations = Array.from(expectedPackageDependencySpecifiers).flatMap(
      ([packageName, expectedDependencies]) => {
        const manifest = readPackageManifest(packageName) as Record<string, unknown>;
        return [
          ...(JSON.stringify(manifest.dependencies ?? {}) === JSON.stringify(expectedDependencies)
            ? []
            : [
                `${packageName} dependencies ${JSON.stringify(manifest.dependencies)} expected ${JSON.stringify(expectedDependencies)}`,
              ]),
          ...forbiddenPackageManifestFields
            .filter((field) => field in manifest)
            .map((field) => `${packageName} declares forbidden manifest field ${field}`),
        ];
      },
    );

    expect(violations).toEqual([]);
  });

  it("package manifests stay private ESM workspace packages", () => {
    const violations = Array.from(expectedPackageDependencies.keys()).flatMap((packageName) => {
      const manifest = readPackageManifest(packageName) as Record<string, unknown>;
      return [
        ...(manifest.private === true ? [] : [`${packageName} private must be true`]),
        ...(manifest.type === "module" ? [] : [`${packageName} type must be module`]),
        ...(manifest.version === "0.0.0" ? [] : [`${packageName} version must be 0.0.0`]),
      ];
    });

    expect(violations).toEqual([]);
  });

  it("root manifest declares exactly the extracted workspace packages", () => {
    const rootManifest = readRootPackageManifest();
    const workspaceDependencies = Object.fromEntries(
      Object.entries(rootManifest.dependencies ?? {}).filter(([name]) => name.startsWith("@svvy/")),
    );
    const expectedWorkspaceDependencies = Object.fromEntries(
      Array.from(expectedPackageDependencies.keys()).map((name) => [name, "workspace:*"]),
    );
    const forbiddenRootDependencies = [
      ...Object.keys(rootManifest.dependencies ?? {}),
      ...Object.keys(rootManifest.devDependencies ?? {}),
    ].filter(
      (name) =>
        name.startsWith("@svvyx/") ||
        name === "smithers-orchestrator" ||
        name === "@smithers/orchestrator",
    );

    expect({
      workspaces: rootManifest.workspaces,
      workspaceDependencies,
      forbiddenRootDependencies,
    }).toEqual({
      workspaces: ["packages/*"],
      workspaceDependencies: expectedWorkspaceDependencies,
      forbiddenRootDependencies: [],
    });
  });

  it("root and package manifests keep one exact Effect version and no unapproved Effect platform dependencies", () => {
    const rootManifest = readRootPackageManifest();
    const rootEffectVersion = rootManifest.dependencies?.effect;
    const unapprovedEffectPackages = [
      ...Object.keys(rootManifest.dependencies ?? {}),
      ...Object.keys(rootManifest.devDependencies ?? {}),
    ].filter(
      (dependency) =>
        dependency.startsWith("@effect/") &&
        dependency !== "@effect/vitest" &&
        dependency !== "@effect/platform-bun",
    );
    const packageViolations = Array.from(expectedPackageDependencies.keys()).flatMap(
      (packageName) => {
        const manifest = readPackageManifest(packageName);
        const packageEffectVersion = manifest.dependencies?.effect;
        return packageEffectVersion === rootEffectVersion
          ? []
          : [
              `${packageName} effect ${JSON.stringify(packageEffectVersion)} expected ${JSON.stringify(rootEffectVersion)}`,
            ];
      },
    );

    expect({
      rootEffectVersion,
      unapprovedEffectPackages,
      packageViolations,
    }).toEqual({
      rootEffectVersion: "4.0.0-beta.84",
      unapprovedEffectPackages: [],
      packageViolations: [],
    });
  });

  it("bun.lock keeps the adopted Effect stack coherent", () => {
    const rootManifest = readRootPackageManifest();
    const adoptedEffectVersion = rootManifest.dependencies?.effect;
    const adoptedEffectPackages = new Set([
      "effect",
      "@effect/platform-bun",
      "@effect/platform-node-shared",
      "@effect/vitest",
    ]);
    const lockPackages = readBunLock().packages ?? {};
    const allEffectLockPackageNames = Object.keys(lockPackages)
      .filter((name) => name === "effect" || name.startsWith("@effect/"))
      .toSorted();
    const unapprovedEffectLockRows = allEffectLockPackageNames.filter(
      (name) => !adoptedEffectPackages.has(name),
    );
    const effectLockRows = Object.entries(lockPackages)
      .filter(([name]) => name === "effect" || name.startsWith("@effect/"))
      .map(([name, row]) => {
        const resolved = row[0];
        const expectedResolvedPrefix = `${name}@${adoptedEffectVersion}`;
        const peerEffect = row[2]?.peerDependencies?.effect;
        return {
          name,
          resolved,
          expectedResolvedPrefix,
          peerEffect,
        };
      });
    const resolvedViolations = effectLockRows
      .filter(
        ({ resolved, expectedResolvedPrefix }) => !resolved.startsWith(expectedResolvedPrefix),
      )
      .map(
        ({ name, resolved, expectedResolvedPrefix }) =>
          `${name} -> ${resolved} expected ${expectedResolvedPrefix}`,
      );
    const peerViolations = effectLockRows
      .filter(
        ({ name, peerEffect }) =>
          name !== "effect" &&
          peerEffect !== undefined &&
          peerEffect !== `^${adoptedEffectVersion}`,
      )
      .map(({ name, peerEffect }) => `${name} peer effect ${peerEffect}`);

    expect({
      adoptedEffectVersion,
      unapprovedEffectLockRows,
      packageNames: effectLockRows.map(({ name }) => name).toSorted(),
      resolvedViolations,
      peerViolations,
    }).toEqual({
      adoptedEffectVersion: "4.0.0-beta.84",
      unapprovedEffectLockRows: [],
      packageNames: [
        "@effect/platform-bun",
        "@effect/platform-node-shared",
        "@effect/vitest",
        "effect",
      ],
      resolvedViolations: [],
      peerViolations: [],
    });
  });

  it("package source imports only external runtime dependencies declared by that package manifest", () => {
    const packageSourceRoots = Array.from(expectedPackageDependencies.keys()).map((packageName) => {
      const packageDirectory = packageName.replace("@svvy/", "");
      return {
        packageName,
        packageDirectory,
        root: join(packageRoot, packageDirectory, "src"),
      };
    });
    const violations = packageSourceRoots.flatMap(({ packageName, root }) => {
      const manifest = readPackageManifest(packageName);
      const declaredDependencies = new Set(Object.keys(manifest.dependencies ?? {}));
      return listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .map(readPackageNameFromSpecifier)
          .filter((importedPackage): importedPackage is string => Boolean(importedPackage))
          .filter((importedPackage) => {
            if (isTestFile(file) && importedPackage === "bun:test") return false;
            if (isEffectTestLaneFile(file) && importedPackage === "@effect/vitest") return false;
            return !declaredDependencies.has(importedPackage);
          })
          .map(
            (importedPackage) =>
              `${display(file)} -> ${importedPackage} not declared by ${packageName}`,
          ),
      );
    });

    expect(violations).toEqual([]);
  });

  it("non-desktop packages do not import renderer or app-shell UI dependencies", () => {
    const forbiddenPrefixes = [
      "svelte",
      "svelte/",
      "dockview-core",
      "electrobun",
      "electrobun/",
      "@lucide/",
      "@tanstack/",
      "cmdk-sv",
      "katex",
      "markdown-it",
      "mermaid",
    ];
    const violations = implementationPackageRoots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter((specifier) =>
            forbiddenPrefixes.some(
              (prefix) => specifier === prefix || specifier.startsWith(prefix),
            ),
          )
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/runtime production source avoids host timer and detached promise primitives", () => {
    const forbidden = [
      { pattern: /\bDate\.now\s*\(/, name: "Date.now" },
      { pattern: /\bnew Date\s*\(/, name: "new Date" },
      { pattern: /\bDateTime\.nowUnsafe\s*\(/, name: "DateTime.nowUnsafe" },
      { pattern: /\bcurrentTimeMillisUnsafe\s*\(/, name: "currentTimeMillisUnsafe" },
      { pattern: /\bcurrentTimeNanosUnsafe\s*\(/, name: "currentTimeNanosUnsafe" },
      { pattern: /\bsetTimeout\s*\(/, name: "setTimeout" },
      { pattern: /\bsetInterval\s*\(/, name: "setInterval" },
      { pattern: /\bPromise\.resolve\s*\(/, name: "Promise.resolve" },
      { pattern: /\bvoid\s+\S+\.then\s*\(/, name: "detached promise" },
    ];
    const violations = listTypeScriptFiles(join(packageRoot, "runtime", "src"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        return forbidden
          .filter(({ pattern }) => pattern.test(source))
          .map(({ name }) => `${display(file)} -> ${name}`);
      });

    expect(violations).toEqual([]);
  });

  it("@svvy/pi-adapter production source receives time from runtime instead of reading host current time", () => {
    const forbidden = [
      { pattern: /\bDate\.now\s*\(/, name: "Date.now" },
      { pattern: /\bnew Date\s*\(/, name: "new Date" },
      { pattern: /\bDateTime\.nowUnsafe\s*\(/, name: "DateTime.nowUnsafe" },
      { pattern: /\bcurrentTimeMillisUnsafe\s*\(/, name: "currentTimeMillisUnsafe" },
      { pattern: /\bcurrentTimeNanosUnsafe\s*\(/, name: "currentTimeNanosUnsafe" },
    ];
    const violations = listTypeScriptFiles(join(packageRoot, "pi-adapter", "src"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        return forbidden
          .filter(({ pattern }) => pattern.test(source))
          .map(({ name }) => `${display(file)} -> ${name}`);
      });

    expect(violations).toEqual([]);
  });

  it("public package directory set and package exports stay fixed", () => {
    const actualDirectories = readdirSync(packageRoot)
      .filter((entry) => statSync(join(packageRoot, entry)).isDirectory())
      .toSorted();
    expect(actualDirectories).toEqual(expectedPackageDirectories);

    const violations = Array.from(expectedPackageDependencies.keys()).flatMap((packageName) => {
      const manifest = readPackageManifest(packageName);
      const packageDirectory = packageName.replace("@svvy/", "");
      const packageDirectoryPath = join(packageRoot, packageDirectory);
      const expectedName = packageName;
      const expectedExports = expectedPublicExports.get(packageName) ?? { ".": "./src/index.ts" };
      const exportEntries =
        manifest.exports && typeof manifest.exports === "object"
          ? Object.entries(manifest.exports as Record<string, unknown>)
          : [];
      const exportTargetViolations = exportEntries.flatMap(([exportName, target]) => {
        if (typeof target !== "string") {
          return [`${packageDirectory} ${exportName} export is not a string`];
        }
        if (!target.startsWith("./src/")) {
          return [`${packageDirectory} ${exportName} export ${target} is not under ./src/`];
        }
        const absoluteTarget = join(packageDirectoryPath, target);
        if (!absoluteTarget.startsWith(packageDirectoryPath + sep)) {
          return [`${packageDirectory} ${exportName} export ${target} escapes package directory`];
        }
        return existsSync(absoluteTarget)
          ? []
          : [`${packageDirectory} ${exportName} export target ${target} does not exist`];
      });
      return [
        ...(manifest.name === expectedName
          ? []
          : [`${packageDirectory} name ${JSON.stringify(manifest.name)} expected ${expectedName}`]),
        ...(JSON.stringify(manifest.exports) === JSON.stringify(expectedExports)
          ? []
          : [
              `${packageDirectory} exports ${JSON.stringify(manifest.exports)} expected ${JSON.stringify(expectedExports)}`,
            ]),
        ...exportTargetViolations,
      ];
    });

    expect(violations).toEqual([]);
  });

  it("production extracted packages do not hide dynamic import or require specifiers", () => {
    const nonLiteralImportPattern = /\b(?:import|require)\s*\(\s*(?!["'])/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => nonLiteralImportPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("public package root exported symbols stay explicit", () => {
    const violations = Array.from(expectedPublicSymbols).flatMap(
      ([packageName, expectedSymbols]) => {
        const packageDirectory = packageName.replace("@svvy/", "");
        const actualSymbols = [
          ...new Set(
            readPublicExportedNames(join(packageRoot, packageDirectory, "src", "index.ts")),
          ),
        ].toSorted();
        const expected = expectedSymbols.toSorted();
        return JSON.stringify(actualSymbols) === JSON.stringify(expected)
          ? []
          : [
              `${packageName} exports ${JSON.stringify(actualSymbols)} expected ${JSON.stringify(expected)}`,
            ];
      },
    );

    expect(violations).toEqual([]);
  });

  it("public package subpath exported symbols stay explicit", () => {
    const expectedSubpathSpecifiers = Array.from(expectedPublicExports.entries())
      .flatMap(([packageName, exports]) =>
        Object.keys(exports)
          .filter((subpath) => subpath !== ".")
          .map((subpath) => `${packageName}/${subpath.slice(2)}`),
      )
      .toSorted();

    expect([...expectedPublicSubpathSymbols.keys()].toSorted()).toEqual(expectedSubpathSpecifiers);

    const violations = expectedSubpathSpecifiers.flatMap((specifier) => {
      const packageName = [...expectedPublicExports.keys()].find((candidate) =>
        specifier.startsWith(`${candidate}/`),
      );
      if (!packageName) {
        return [`${specifier} does not belong to an expected public package`];
      }
      const exportName = `.${specifier.slice(packageName.length)}`;
      const target = expectedPublicExports.get(packageName)?.[exportName];
      if (!target) {
        return [`${specifier} has no expected export target`];
      }
      const packageDirectory = packageName.replace("@svvy/", "");
      const actualSymbols = [
        ...new Set(readPublicExportedNames(join(packageRoot, packageDirectory, target.slice(2)))),
      ].toSorted();
      const expected = expectedPublicSubpathSymbols.get(specifier)!.toSorted();
      return JSON.stringify(actualSymbols) === JSON.stringify(expected)
        ? []
        : [
            `${specifier} exports ${JSON.stringify(actualSymbols)} expected ${JSON.stringify(expected)}`,
          ];
    });

    expect(violations).toEqual([]);
  });

  it("runtime root does not expose RuntimeEffectRequest appliers", () => {
    const runtimePublicSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "index.ts"))),
    ];
    const forbidden = runtimePublicSymbols.filter(
      (symbol) =>
        symbol === "applyRuntimeEffectRequest" ||
        symbol === "applyRuntimeEffectRequests" ||
        symbol === "AppliedRuntimeEffectRequest" ||
        symbol === "RuntimeEffectRequestApplicationContext" ||
        symbol === "ExtensionExecutionPlanExecutor" ||
        symbol === "executeExtensionExecutionPlan" ||
        symbol === "applyExtensionExecutionPlan" ||
        symbol === "applySvvyxRuntimeEffectTransportRequest" ||
        symbol === "AppliedSvvyxRuntimeEffectTransportRequest" ||
        symbol === "ApplySvvyxRuntimeEffectTransportRequestInput",
    );

    expect(forbidden).toEqual([]);
  });

  it("runtime event bus internals stay off the root API and confined to the Bun bootstrap adapter", () => {
    const runtimeManifest = readPackageManifest("@svvy/runtime");
    const runtimeExports = Object.keys(
      runtimeManifest.exports as Record<string, string>,
    ).toSorted();
    const runtimePublicSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "index.ts"))),
    ];
    const forbiddenRootSymbols = runtimePublicSymbols.filter(
      (symbol) =>
        symbol === "RuntimeEventBus" ||
        symbol === "RuntimeEventBusOptions" ||
        symbol === "RuntimeEventBusService" ||
        symbol === "RuntimeEventDraft" ||
        symbol === "PromptExecutionRuntimeHandle" ||
        symbol === "createPromptExecutionContext" ||
        symbol === "layerRuntimeEventBus" ||
        symbol === "makeRuntimeEventBus",
    );
    const appImports = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter(
            (specifier) =>
              specifier === "@svvy/runtime/internal/events" ||
              specifier === "@svvy/runtime/internal/prompt-execution",
          )
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(runtimeExports).toEqual([".", "./bootstrap"]);
    expect(forbiddenRootSymbols).toEqual([]);
    expect(appImports).toEqual([]);
  });

  it("package source roots are covered by boundary tests", () => {
    expect(sourceRoots.every((root) => listTypeScriptFiles(root).length > 0)).toBe(true);
  });
});
