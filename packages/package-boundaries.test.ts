import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "bun:test";
import * as ts from "typescript";
import { PRODUCT_FEATURES } from "../docs/features";
import {
  adoptedEffectInstanceMemberPolicies,
  adoptedEffectRuntimeModuleExports,
  adoptedEffectTypeOnlyModules,
  auditedEffectInstalledExports,
  auditedEffectInstalledExportMemberPolicies,
  auditedEffectInstalledExportPolicies,
} from "./effect-adoption-manifest";
import type { AbsolutePath, GeneratedPackageBuildId, IsoDateTimeString } from "./core/src/ids";
import {
  renderGeneratedExtensionsPackageFiles,
  renderGeneratedWorkflowsPackageFiles,
} from "@svvy/extensions";

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
const mainviewSourceRoot = join(projectRoot, "src", "mainview");
const sharedSourceRoot = join(projectRoot, "src", "shared");
const productSpecRoot = join(projectRoot, "docs", "specs");
const packageArchitectureSpecRoot = join(projectRoot, "docs", "specs", "package-architecture");
const packageOwnedNativeToolModules = [
  join(projectRoot, "src", "bun", "execute-typescript-tool.ts"),
  join(projectRoot, "src", "bun", "extension-tools.ts"),
  join(projectRoot, "src", "bun", "runtime-state-tools.ts"),
  join(projectRoot, "src", "bun", "svvy-direct-tools.ts"),
  join(projectRoot, "src", "bun", "thread-report-tool.ts"),
  join(projectRoot, "src", "bun", "thread-orchestration-tools.ts"),
  join(projectRoot, "src", "bun", "thread-start-tool.ts"),
];
const runtimeServiceAdapterModule = join(projectRoot, "src", "bun", "runtime-service-adapter.ts");
const appRuntimeBootstrapModule = join(projectRoot, "src", "bun", "app-runtime-bootstrap.ts");
const sessionCatalogModule = join(projectRoot, "src", "bun", "session-catalog.ts");
const expectedSandboxAppImports = [
  "src/bun/app-runtime-bootstrap.ts -> @svvy/sandbox",
  "src/bun/runtime-service-adapter.ts -> @svvy/sandbox",
  // Pure path-access check over runtime-acquired launch facts; not launch-policy construction.
  "src/bun/svvy-direct-tools.ts -> @svvy/sandbox",
  "src/bun/svvy-direct-tools.ts -> @svvy/sandbox/diagnostics",
];

const effectSchemaCompilerNames = [
  "is",
  "decodeEffect",
  "decodeUnknownEffect",
  "decodeExit",
  "decodeUnknownExit",
  "decodeOption",
  "decodeUnknownOption",
  "decodePromise",
  "decodeUnknownPromise",
  "decodeSync",
  "decodeUnknownSync",
  "encodeEffect",
  "encodeUnknownEffect",
  "encodeExit",
  "encodeUnknownExit",
  "encodeOption",
  "encodeUnknownOption",
  "encodePromise",
  "encodeUnknownPromise",
  "encodeSync",
  "encodeUnknownSync",
  "decodeUnknownResult",
  "decodeResult",
  "encodeUnknownResult",
  "encodeResult",
] as const;

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
  ["@svvy/desktop", ["@svvy/core", "@svvy/runtime", "@svvy/state"]],
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
  "core-public-symbol-index.generated.md",
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
  "docs/specs/package-architecture/core-public-symbol-index.generated.md",
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
    "@svvy/sandbox",
    {
      ".": "./src/index.ts",
      "./diagnostics": "./src/sandbox-denial.ts",
    },
  ],
  [
    "@svvy/extensions",
    {
      ".": "./src/index.ts",
    },
  ],
  [
    "@svvy/pi-adapter",
    {
      ".": "./src/index.ts",
      "./messages": "./src/messages.ts",
      "./session": "./src/session.ts",
    },
  ],
  [
    "@svvy/state",
    {
      ".": "./src/index.ts",
      "./generated-package-maintenance": "./src/generated-package-maintenance.ts",
      "./session-navigation": "./src/session-navigation.ts",
      "./structured-session-adapters": "./src/structured-session-adapters.ts",
      "./structured-session-projections": "./src/structured-session-projections.ts",
      "./structured-session-state": "./src/structured-session-state.ts",
    },
  ],
  [
    "@svvy/runtime",
    {
      ".": "./src/index.ts",
      "./accepted-native-tool-execution": "./src/accepted-native-tool-execution.ts",
      "./app-log-commit-notification-adapter": "./src/app-log-commit-notification-adapter.ts",
      "./bootstrap": "./src/bootstrap.ts",
      "./committed-state-invalidation-adapter": "./src/committed-state-invalidation-adapter.ts",
      "./prompt-execution-context": "./src/prompt-execution-context.ts",
      "./source-invalidation-coordinator-adapter":
        "./src/source-invalidation-coordinator-adapter.ts",
    },
  ],
]);
const expectedPublicSymbols = new Map<string, string[]>([
  ["@svvy/core", readCorePublicSymbolIndexNames()],
  [
    "@svvy/state",
    [
      "AgentActorExtensionDefaultsReadModelRecord",
      "AgentBindingReadModelRecord",
      "AgentProfileStateCommands",
      "AgentsReadModel",
      "AgentsReadModelRequest",
      "AppLogReadModelRequest",
      "AppLogReadStateCommands",
      "AppPreferenceAppearance",
      "AppPreferenceAppearanceSchema",
      "AppPreferenceApprovalMode",
      "AppPreferenceApprovalModeSchema",
      "AppPreferencesReadModel",
      "AppPreferencesReadModelRequest",
      "AppPreferencesStateCommands",
      "ApprovalReadModelRequestItem",
      "ApprovalsReadModel",
      "ApprovalsReadModelRequest",
      "ArtifactInspectorReadModel",
      "ArtifactInspectorReadModelRequest",
      "ClearWorkspaceAppLogUnreadCommandInput",
      "ClearWorkspaceAppLogUnreadCommandInputSchema",
      "CompactWorkspaceSurface",
      "CommandInspectorReadModel",
      "ConfiguredAgentProfileReadModelRecord",
      "CommandInspectorReadModelRequest",
      "CreateManagedSnippetCommandInput",
      "CreateManagedSnippetCommandInputSchema",
      "CreateStateAppLogsFacadeOptions",
      "DeleteManagedSnippetCommandInput",
      "DeleteManagedSnippetCommandInputSchema",
      "DeleteOrchestratorProfileCommandInput",
      "DeleteOrchestratorProfileCommandInputSchema",
      "ExtensionEnvStateCommands",
      "ExtensionReadModelRecord",
      "ExtensionCliReadinessReadModel",
      "ExtensionsReadModel",
      "ExtensionsReadModelRequest",
      "ExternalInstructionsReadModelRequest",
      "GeneratedContextPreviewReadModelRecord",
      "HandlerInspectorReadModel",
      "HandlerInspectorReadModelRequest",
      "MarkAppLogReadCommandInput",
      "MarkAppLogReadCommandInputSchema",
      "MarkSessionReadCommandInput",
      "MarkSessionReadCommandInputSchema",
      "MarkSessionUnreadCommandInput",
      "MarkSessionUnreadCommandInputSchema",
      "MarkVisibleAppLogRangeReadCommandInput",
      "MarkVisibleAppLogRangeReadCommandInputSchema",
      "OrchestratorAgentProfileInput",
      "PromoteProfileExtensionDefaultCommandInput",
      "PromoteProfileExtensionDefaultCommandInputSchema",
      "ProviderAuthReadModel",
      "ProviderAuthReadModelRequest",
      "ProviderAuthStateCommands",
      "PromptHistoryReadModel",
      "PromptHistoryReadModelEntry",
      "PromptHistoryReadModelRequest",
      "RecordProviderAuthStatusCommandInput",
      "RecordProviderAuthStatusCommandInputSchema",
      "RemoveExtensionEnvOverrideCommandInput",
      "RemoveExtensionEnvOverrideCommandInputSchema",
      "RemoveExtensionEnvSecretCommandInput",
      "RemoveExtensionEnvSecretCommandInputSchema",
      "ReorderOrchestratorProfilesCommandInput",
      "ReorderOrchestratorProfilesCommandInputSchema",
      "RequestInputReadModel",
      "RequestInputReadModelRequest",
      "RequestInputReadModelRequestItem",
      "ResetActorExtensionDefaultsCommandInput",
      "ResetActorExtensionDefaultsCommandInputSchema",
      "SandboxPolicySourceConfig",
      "SaveWorkspaceLayoutSlotCommandInput",
      "SaveWorkspaceLayoutSlotCommandInputSchema",
      "SelectWorkspaceLayoutSlotCommandInput",
      "SelectWorkspaceLayoutSlotCommandInputSchema",
      "SelectWorkspaceTabCommandInput",
      "SelectWorkspaceTabCommandInputSchema",
      "SettingsReadModel",
      "SessionNavigationReadModel",
      "SessionNavigationReadModelRequest",
      "SessionNavigationStateCommands",
      "SessionNavigationSummary",
      "SetAgentActorExtensionDefaultsCommandInput",
      "SetAgentActorExtensionDefaultsCommandInputSchema",
      "SetExtensionEnvOverrideCommandInput",
      "SetExtensionEnvOverrideCommandInputSchema",
      "SetExtensionEnvSecretCommandInput",
      "SetExtensionEnvSecretCommandInputSchema",
      "SetExternalInstructionActorUsageCommandInput",
      "SetExternalInstructionActorUsageCommandInputSchema",
      "SetProfileExtensionUsageCommandInput",
      "SetProfileExtensionUsageCommandInputSchema",
      "SetSessionArchivedCommandInput",
      "SetSessionArchivedCommandInputSchema",
      "SetSessionNavigationSectionStateCommandInput",
      "SetSessionNavigationSectionStateCommandInputSchema",
      "SetSessionPinnedCommandInput",
      "SetSessionPinnedCommandInputSchema",
      "SetSnippetEnabledCommandInput",
      "SetSnippetEnabledCommandInputSchema",
      "SetWorkspaceTabsCommandInput",
      "SetWorkspaceTabsCommandInputSchema",
      "SnippetMetadata",
      "SnippetMetadataSchema",
      "SnippetReadModelRecord",
      "SnippetStateCommands",
      "SnippetsReadModel",
      "SnippetsReadModelRequest",
      "StateAppLogAppendInput",
      "StateAppLogsFacade",
      "StateCommandResult",
      "StateCommands",
      "StateCommandsFacade",
      "StateCommandsService",
      "StateFacade",
      "StateFacadeCallOptions",
      "StateFacadeError",
      "StateLayerConfig",
      "StateLayerConfigSchema",
      "StateReadModelBaseline",
      "StateReadModelInvalidationRefetchRequest",
      "StateReadModelRebaselineRequest",
      "StateReadModelRequest",
      "StateReadModelRequestSchema",
      "StateReadModelResult",
      "StateReadModelResultSchema",
      "StateReadModels",
      "StateReadModelsService",
      "SurfaceComposerReadModel",
      "SurfaceComposerReadModelRequest",
      "SurfaceQueuedMessagesReadModel",
      "SurfaceQueuedMessagesReadModelRequest",
      "SurfaceSummaryReadModel",
      "SurfaceSummaryReadModelRequest",
      "SurfaceTranscriptReadModel",
      "SurfaceTranscriptReadModelRequest",
      "ThreadHandlerProfileInput",
      "ThreadHandlerProfileInputSchema",
      "UpdateAppPreferencesCommandInput",
      "UpdateAppPreferencesCommandInputSchema",
      "UpdateAppPreferencesPatch",
      "UpdateAppPreferencesPatchSchema",
      "UpdateManagedSnippetCommandInput",
      "UpdateManagedSnippetCommandInputSchema",
      "UpdateManagedSnippetPatch",
      "UpdateManagedSnippetPatchSchema",
      "UpdateOrchestratorProfileCommandInput",
      "UpdateOrchestratorProfileCommandInputSchema",
      "UpdateThreadHandlerProfileCommandInput",
      "UpdateThreadHandlerProfileCommandInputSchema",
      "WorkflowAgentSourceReadModelRecord",
      "WorkflowTaskAttemptInspectorReadModel",
      "WorkflowTaskAttemptInspectorReadModelRequest",
      "WorkflowsGeneratedExportReadModelRecord",
      "WorkflowsGeneratedReadModel",
      "WorkflowsGeneratedReadModelRequest",
      "WorkspaceChromeReadModel",
      "WorkspaceChromeReadModelRequest",
      "WorkspaceLayoutReadModel",
      "WorkspaceLayoutReadModelRequest",
      "WorkspaceLayoutSlotReadModel",
      "WorkspaceLayoutSlotId",
      "WorkspaceLayoutSlotIdSchema",
      "WorkspacePaneFallbackChrome",
      "WorkspacePaneLocalState",
      "WorkspacePanePlacement",
      "WorkspacePaneRecord",
      "WorkspacePaneTarget",
      "WorkspaceRequestInputDelivery",
      "WorkspaceTabRecord",
      "WorkspaceTabRecordInput",
      "WorkspaceTabRecordInputSchema",
      "createStateAppLogsFacade",
      "createStateCommandsFacade",
      "createStateFacade",
      "decodeUnknownClearWorkspaceAppLogUnreadCommandInputEffect",
      "decodeUnknownClearWorkspaceAppLogUnreadCommandInputExit",
      "decodeUnknownCreateManagedSnippetCommandInputEffect",
      "decodeUnknownCreateManagedSnippetCommandInputExit",
      "decodeUnknownDeleteManagedSnippetCommandInputEffect",
      "decodeUnknownDeleteManagedSnippetCommandInputExit",
      "decodeUnknownDeleteOrchestratorProfileCommandInputEffect",
      "decodeUnknownDeleteOrchestratorProfileCommandInputExit",
      "decodeUnknownMarkAppLogReadCommandInputEffect",
      "decodeUnknownMarkAppLogReadCommandInputExit",
      "decodeUnknownMarkSessionReadCommandInputEffect",
      "decodeUnknownMarkSessionReadCommandInputExit",
      "decodeUnknownMarkSessionUnreadCommandInputEffect",
      "decodeUnknownMarkSessionUnreadCommandInputExit",
      "decodeUnknownMarkVisibleAppLogRangeReadCommandInputEffect",
      "decodeUnknownMarkVisibleAppLogRangeReadCommandInputExit",
      "decodeUnknownPromoteProfileExtensionDefaultCommandInputEffect",
      "decodeUnknownPromoteProfileExtensionDefaultCommandInputExit",
      "decodeUnknownRecordProviderAuthStatusCommandInputEffect",
      "decodeUnknownRecordProviderAuthStatusCommandInputExit",
      "decodeUnknownRemoveExtensionEnvOverrideCommandInputEffect",
      "decodeUnknownRemoveExtensionEnvOverrideCommandInputExit",
      "decodeUnknownRemoveExtensionEnvSecretCommandInputEffect",
      "decodeUnknownRemoveExtensionEnvSecretCommandInputExit",
      "decodeUnknownReorderOrchestratorProfilesCommandInputEffect",
      "decodeUnknownReorderOrchestratorProfilesCommandInputExit",
      "decodeUnknownResetActorExtensionDefaultsCommandInputEffect",
      "decodeUnknownResetActorExtensionDefaultsCommandInputExit",
      "decodeUnknownSaveWorkspaceLayoutSlotCommandInputEffect",
      "decodeUnknownSaveWorkspaceLayoutSlotCommandInputExit",
      "decodeUnknownSetAgentActorExtensionDefaultsCommandInputEffect",
      "decodeUnknownSetAgentActorExtensionDefaultsCommandInputExit",
      "decodeUnknownSelectWorkspaceLayoutSlotCommandInputEffect",
      "decodeUnknownSelectWorkspaceLayoutSlotCommandInputExit",
      "decodeUnknownSelectWorkspaceTabCommandInputEffect",
      "decodeUnknownSelectWorkspaceTabCommandInputExit",
      "decodeUnknownSetExtensionEnvOverrideCommandInputEffect",
      "decodeUnknownSetExtensionEnvOverrideCommandInputExit",
      "decodeUnknownSetExtensionEnvSecretCommandInputEffect",
      "decodeUnknownSetExtensionEnvSecretCommandInputExit",
      "decodeUnknownSetExternalInstructionActorUsageCommandInputEffect",
      "decodeUnknownSetExternalInstructionActorUsageCommandInputExit",
      "decodeUnknownSetProfileExtensionUsageCommandInputEffect",
      "decodeUnknownSetProfileExtensionUsageCommandInputExit",
      "decodeUnknownSetSessionArchivedCommandInputEffect",
      "decodeUnknownSetSessionArchivedCommandInputExit",
      "decodeUnknownSetSessionNavigationSectionStateCommandInputEffect",
      "decodeUnknownSetSessionNavigationSectionStateCommandInputExit",
      "decodeUnknownSetSessionPinnedCommandInputEffect",
      "decodeUnknownSetSessionPinnedCommandInputExit",
      "decodeUnknownSetSnippetEnabledCommandInputEffect",
      "decodeUnknownSetSnippetEnabledCommandInputExit",
      "decodeUnknownSetWorkspaceTabsCommandInputEffect",
      "decodeUnknownSetWorkspaceTabsCommandInputExit",
      "decodeUnknownUpdateAppPreferencesCommandInputEffect",
      "decodeUnknownUpdateAppPreferencesCommandInputExit",
      "decodeUnknownUpdateManagedSnippetCommandInputEffect",
      "decodeUnknownUpdateManagedSnippetCommandInputExit",
      "decodeUnknownUpdateOrchestratorProfileCommandInputEffect",
      "decodeUnknownUpdateOrchestratorProfileCommandInputExit",
      "decodeUnknownUpdateThreadHandlerProfileCommandInputEffect",
      "decodeUnknownUpdateThreadHandlerProfileCommandInputExit",
      "encodeClearWorkspaceAppLogUnreadCommandInputEffect",
      "encodeClearWorkspaceAppLogUnreadCommandInputExit",
      "encodeCreateManagedSnippetCommandInputEffect",
      "encodeCreateManagedSnippetCommandInputExit",
      "encodeDeleteManagedSnippetCommandInputEffect",
      "encodeDeleteManagedSnippetCommandInputExit",
      "encodeDeleteOrchestratorProfileCommandInputEffect",
      "encodeDeleteOrchestratorProfileCommandInputExit",
      "encodeMarkAppLogReadCommandInputEffect",
      "encodeMarkAppLogReadCommandInputExit",
      "encodeMarkSessionReadCommandInputEffect",
      "encodeMarkSessionReadCommandInputExit",
      "encodeMarkSessionUnreadCommandInputEffect",
      "encodeMarkSessionUnreadCommandInputExit",
      "encodeMarkVisibleAppLogRangeReadCommandInputEffect",
      "encodeMarkVisibleAppLogRangeReadCommandInputExit",
      "encodePromoteProfileExtensionDefaultCommandInputEffect",
      "encodePromoteProfileExtensionDefaultCommandInputExit",
      "encodeRecordProviderAuthStatusCommandInputEffect",
      "encodeRecordProviderAuthStatusCommandInputExit",
      "encodeRemoveExtensionEnvOverrideCommandInputEffect",
      "encodeRemoveExtensionEnvOverrideCommandInputExit",
      "encodeReorderOrchestratorProfilesCommandInputEffect",
      "encodeReorderOrchestratorProfilesCommandInputExit",
      "encodeResetActorExtensionDefaultsCommandInputEffect",
      "encodeResetActorExtensionDefaultsCommandInputExit",
      "encodeSaveWorkspaceLayoutSlotCommandInputEffect",
      "encodeSaveWorkspaceLayoutSlotCommandInputExit",
      "encodeSetAgentActorExtensionDefaultsCommandInputEffect",
      "encodeSetAgentActorExtensionDefaultsCommandInputExit",
      "encodeSelectWorkspaceLayoutSlotCommandInputEffect",
      "encodeSelectWorkspaceLayoutSlotCommandInputExit",
      "encodeSelectWorkspaceTabCommandInputEffect",
      "encodeSelectWorkspaceTabCommandInputExit",
      "encodeSetExtensionEnvOverrideCommandInputEffect",
      "encodeSetExtensionEnvOverrideCommandInputExit",
      "encodeSetExternalInstructionActorUsageCommandInputEffect",
      "encodeSetExternalInstructionActorUsageCommandInputExit",
      "encodeSetProfileExtensionUsageCommandInputEffect",
      "encodeSetProfileExtensionUsageCommandInputExit",
      "encodeSetSessionArchivedCommandInputEffect",
      "encodeSetSessionArchivedCommandInputExit",
      "encodeSetSessionNavigationSectionStateCommandInputEffect",
      "encodeSetSessionNavigationSectionStateCommandInputExit",
      "encodeSetSessionPinnedCommandInputEffect",
      "encodeSetSessionPinnedCommandInputExit",
      "encodeSetSnippetEnabledCommandInputEffect",
      "encodeSetSnippetEnabledCommandInputExit",
      "encodeSetWorkspaceTabsCommandInputEffect",
      "encodeSetWorkspaceTabsCommandInputExit",
      "encodeUpdateAppPreferencesCommandInputEffect",
      "encodeUpdateAppPreferencesCommandInputExit",
      "encodeUpdateManagedSnippetCommandInputEffect",
      "encodeUpdateManagedSnippetCommandInputExit",
      "encodeUpdateOrchestratorProfileCommandInputEffect",
      "encodeUpdateOrchestratorProfileCommandInputExit",
      "encodeUpdateThreadHandlerProfileCommandInputEffect",
      "encodeUpdateThreadHandlerProfileCommandInputExit",
      "layer",
      "layerAppLogWritePort",
      "layerExtensionStatePort",
      "layerExtensionSnapshotStatePort",
      "layerExtensionSnapshotSettingsStatePort",
      "layerExtensionUsageStatePort",
      "layerGeneratedContextPreviewSubjectStatePort",
      "layerPiSessionReferencePort",
      "layerProviderAuthStatusStatePort",
      "layerRuntimeActorExtensionBindingStatePort",
      "layerRuntimeApprovalStatePort",
      "layerRuntimeArtifactStatePort",
      "layerRuntimeComposerDraftStatePort",
      "layerRuntimeCommandStatePort",
      "layerRuntimeComposerProfileStatePort",
      "layerRuntimeEpisodeStatePort",
      "layerRuntimeExtensionContextImpactStatePort",
      "layerRuntimeExtensionStatePort",
      "layerRuntimeExternalInstructionStatePort",
      "layerRuntimeGeneratedPackageStatePort",
      "layerRuntimePromptDefaultsStatePort",
      "layerRuntimeQueueStatePort",
      "layerRuntimeReadModelStatePort",
      "layerRuntimeRecoveryStatePort",
      "layerRuntimeRequestStatePort",
      "layerRuntimeSessionWaitStatePort",
      "layerRuntimeSourceStatePort",
      "layerRuntimeSurfaceLifecycleStatePort",
      "layerRuntimeThreadStatePort",
      "layerRuntimeTranscriptStatePort",
      "layerRuntimeTurnStatePort",
      "layerRuntimeWorkflowTaskStatePort",
      "layerRuntimeWorkspaceStatePort",
      "layerSandboxPolicySource",
      "layerSandboxPolicySourceWithConfig",
    ],
  ],
  [
    "@svvy/sandbox",
    [
      "CheckPathAccessInput",
      "HostProcessReferencePort",
      "HostProcessReferencePortService",
      "HostProcessReferenceSnapshot",
      "PathAccessDecision",
      "Sandbox",
      "SandboxDenial",
      "SandboxDenialInput",
      "SandboxHelperCandidatesPort",
      "SandboxHelperCandidatesPortService",
      "SandboxHelperCandidatesSnapshot",
      "checkSandboxPathAccess",
      "layer",
    ],
  ],
  [
    "@svvy/extensions",
    [
      "BUILTIN_EXTENSIONS",
      "BUILTIN_EXTENSION_IDS",
      "BuildGeneratedContextSources",
      "BuiltinExtensionId",
      "ExtensionCliRequirement",
      "ExtensionCliRequirementProbePort",
      "ExtensionCliRequirementProbePortService",
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
      "ExtensionRegistryObservationServices",
      "ExtensionBuildObservationServices",
      "ExtensionBuildProcessPort",
      "ExtensionBuildProcessPortService",
      "ExtensionOwnedSourceAddress",
      "Extensions",
      "ExtensionsLayerRequirements",
      "ExtensionsService",
      "ExternalInstructionServices",
      "ActorExtensionBinding",
      "BuildVisibleExtensionRecordsInput",
      "CommandInvocationContext",
      "AcceptedNativeToolArguments",
      "ARTIFACTS_FACADE_DECLARATION",
      "ExtensionHandler",
      "ExtensionHandlerDeps",
      "ExtensionInvocation",
      "GeneratedPackageRootPort",
      "GeneratedPackageRootPortService",
      "GeneratedPackageRoots",
      "GeneratedContextBuildArtifacts",
      "GeneratedContextSourceContributor",
      "GeneratedExtensionExportDiscoveryHost",
      "PackagedExtensionTemplateRoots",
      "PackagedExtensionTemplatesPort",
      "PackagedExtensionTemplatesPortService",
      "WorkspaceSourceLinkPort",
      "WorkspaceSourceLinkPortService",
      "layerExtensionCliRequirementProbePort",
      "layerExtensionBuildProcessPort",
      "ListExtensionsDetails",
      "ListExtensionsHandlerInvocation",
      "ListExtensionsInput",
      "LoadExtensionHandlerInvocation",
      "LoadExtensionInput",
      "NativeToolActorAvailability",
      "NativeToolActorAvailabilityMap",
      "NativeToolActorKind",
      "NativeToolCommandMetadata",
      "NativeToolCommandVisibility",
      "NativeToolDefinition",
      "NativeToolExecutionCommandPolicy",
      "NativeToolStreamingArgumentPolicy",
      "NativeToolTurnDecision",
      "ToolDeclarationInput",
      "ToolMetadataInput",
      "ResolvedExtensionInvocationEnv",
      "RequestUserInputHandlerInvocation",
      "RequestUserInputInput",
      "RequestUserInputInputSchema",
      "RequestUserInputResult",
      "RequestUserInputResultSchema",
      "ParsedWorkflowAgentSource",
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
      "WORKFLOWS_FACADE_DECLARATION",
      "ResolveActorExtensionBindingInput",
      "addExtensionInstruction",
      "buildGeneratedContext",
      "buildGeneratedContextArtifacts",
      "buildExecuteTypescriptFacadeDeclarations",
      "buildNativeToolSchemaJsonForExtension",
      "buildNativeToolSchemasJson",
      "builtinDefaultExtensionOrder",
      "builtinDefaultExtensionUsageState",
      "builtinExtensionRegistryUsagePolicy",
      "workflowTaskReferenceableBuiltinExtensionIds",
      "createListExtensionsHandler",
      "createLoadExtensionHandler",
      "createRequestUserInputHandler",
      "createThreadStartHandler",
      "createExtensionSource",
      "configureExtensionInstruction",
      "configureExtensionTypescriptApi",
      "decodeRequestUserInputInputEffect",
      "decodeRequestUserInputInputExit",
      "decodeRequestUserInputResultEffect",
      "decodeRequestUserInputResultExit",
      "decodeThreadStartInputEffect",
      "decodeThreadStartInputExit",
      "externalInstructionExtensionId",
      "extensionOwnedSourceId",
      "deleteExtensionSource",
      "duplicateExtensionSource",
      "finalizeExtensionSourceMutation",
      "GENERATED_EXTENSIONS_PACKAGE_NAME",
      "generatedExtensionExportIds",
      "generatedExtensionExportIdsFromHost",
      "generatedExtensionReferenceExpression",
      "generatedExtensionsPackageContents",
      "generatedExtensionsPackageContentsFromHost",
      "getExtensionRecord",
      "getNativeToolCommandMetadata",
      "getRequestUserInputVariantInstructions",
      "layerExtensionSourceRootsPort",
      "layerGeneratedPackageRootPort",
      "layer",
      "layerPackagedExtensionTemplatesPort",
      "layerWorkspaceSourceLinkPort",
      "listExtensionsForActor",
      "listExtensionsHandler",
      "loadExtensionHandler",
      "makeExtensions",
      "nativeToolDeclarationsForExtensions",
      "nativeToolCommandMetadata",
      "requestUserInputHandler",
      "renderGeneratedExtensionsPackageFiles",
      "renderGeneratedWorkflowsPackageFiles",
      "observeExtensionRegistry",
      "observeCurrentExtensionBuilds",
      "recoverExtensionSourceMutations",
      "removeExtensionInstruction",
      "renameExtensionInstruction",
      "reorderExtensionInstructions",
      "resetExtensionInstructions",
      "resolveExternalInstructionSource",
      "resolveActorExtensionState",
      "revertExtensionSourceMutation",
      "saveExternalInstructionSource",
      "scanExternalInstructions",
      "summarizeListExtensions",
      "threadStartHandler",
      "visibleExtensionRecords",
      "userExtensionRegistryUsagePolicy",
    ],
  ],
  ["@svvy/pi-adapter", ["PiAdapter", "layer"]],
  ["@svvy/runtime", ["Runtime", "createRuntimeFacade", "layer"]],
  [
    "@svvy/desktop",
    [
      "CreateDesktopAppInput",
      "DesktopAppActionsFacade",
      "DesktopArtifactPreview",
      "DesktopApp",
      "DesktopBridgeAdapter",
      "DesktopBridgeRegistration",
      "DesktopBrowserToolsUiAdapter",
      "DesktopExternalInstructionEditorResult",
      "DesktopExternalInstructionEditorTarget",
      "DesktopHostActionsAdapter",
      "DesktopHostAdapter",
      "DesktopMainWindowInput",
      "DesktopImportComposerAttachmentInput",
      "DesktopMenuAdapter",
      "DesktopMenuRegistration",
      "DesktopNotificationBridge",
      "DesktopRendererCommand",
      "DesktopRendererNotification",
      "DesktopRendererTelemetryInput",
      "DesktopRuntimeActionsFacade",
      "DesktopSwitchWorkspaceBranchResult",
      "DesktopWindowAdapter",
      "DesktopWindowHandle",
      "DesktopWindowId",
      "DesktopWorkspaceInfo",
      "DesktopWorkspaceAttachmentResult",
      "DesktopWorkspaceBranchInfo",
      "DesktopWorkspaceBranchList",
      "DesktopWorkspacePathIndexEntry",
      "DesktopWorkspacePathTarget",
      "RendererStateCommandsFacade",
      "RendererModelMetadataFacade",
      "RendererStateFacade",
      "createDesktopApp",
    ],
  ],
]);
const expectedPublicSubpathSymbols = new Map<string, string[]>([
  [
    "@svvy/sandbox/diagnostics",
    [
      "SandboxDenialFacts",
      "SandboxDenialDiagnosticsInput",
      "isSandboxDenialOutput",
      "isSandboxHelperBootstrapFailure",
      "sandboxDenialFacts",
    ],
  ],
  [
    "@svvy/pi-adapter/session",
    ["CreatePiManagedAgentSessionResult", "createPiManagedAgentSession"],
  ],
  [
    "@svvy/runtime/accepted-native-tool-execution",
    [
      "AcceptedDirectToolApprovalDecision",
      "AcceptedDirectToolApprovalInput",
      "AcceptedDirectToolLaunchInput",
      "AcceptedDirectToolLaunchHandle",
      "acquireAcceptedDirectToolLaunch",
      "requestAcceptedDirectToolApproval",
      "runAcceptedLoadExtension",
    ],
  ],
  [
    "@svvy/runtime/app-log-commit-notification-adapter",
    ["AppLogCommitNotificationInput", "notifyCommittedAppLogAppend"],
  ],
  [
    "@svvy/runtime/committed-state-invalidation-adapter",
    [
      "CommittedStateInvalidationPublicationError",
      "CommittedStateInvalidationPublicationReceipt",
      "publishCommittedStateInvalidations",
    ],
  ],
  [
    "@svvy/runtime/bootstrap",
    [
      "awaitRuntimeStartupReadiness",
      "createRuntimeLayerConfigLayer",
      "defaultRuntimeLayerConfig",
      "layerRuntimeShutdownPreparation",
      "layerRuntimeStartupReadiness",
      "prepareRuntimeShutdown",
      "RuntimeLayerConfigFromEnv",
      "RuntimeLayerConfigInputSchema",
      "RuntimeLayerConfigSchema",
      "RuntimeLayerConfigService",
      "RuntimeLayerError",
      "RuntimeLayerErrorSchema",
      "RuntimeShutdownPreparation",
      "RuntimeStartupError",
      "RuntimeStartupErrorSchema",
      "RuntimeStartupPhase",
      "RuntimeStartupReadiness",
      "decodeUnknownRuntimeLayerErrorEffect",
      "decodeUnknownRuntimeLayerErrorExit",
      "encodeRuntimeLayerErrorEffect",
      "encodeRuntimeLayerErrorExit",
      "layerRuntimeBunPlatform",
      "RuntimeBunPlatformServices",
      "RuntimeLayerConfig",
      "RuntimePrepareShutdownReason",
      "RuntimePrepareShutdownRequest",
      "RuntimePrepareShutdownResult",
      "RuntimeStartupDegradedPhase",
      "RuntimeStartupReadinessReceipt",
      "RuntimeLayerCommandControlPort",
      "RuntimeLayerCommandStdinPort",
      "RuntimeGeneratedContextRefreshHostPort",
      "RuntimeGeneratedPackageRefreshHostPort",
      "RuntimeLayerModelResolverPort",
      "RuntimeLayerProviderAuthPort",
      "RuntimeExternalInstructionScanInputPort",
      "RuntimeSourceInvalidationScanPort",
      "RuntimeSurfaceQueueWakeReason",
      "RuntimeWorkflowTaskAgentBridgeBearerVerifier",
      "RuntimeWorkflowTaskAgentBridgeBearerVerifierService",
      "RuntimeLayerCommandControlPortService",
      "RuntimeLayerCommandStdinPortService",
      "RuntimeGeneratedContextRefreshHostPortService",
      "RuntimeGeneratedPackageRefreshHostPortService",
      "RuntimeLayerModelResolverPortService",
      "RuntimeLayerProviderAuthPortService",
      "RuntimeExternalInstructionScanInputPortService",
      "RuntimeSourceInvalidationScanPortService",
      "RuntimeGeneratedPackageWorkspaceLinkFileHost",
      "RuntimeSourceInvalidationDirectoryEntry",
      "RuntimeSourceInvalidationDomain",
      "RuntimeSourceInvalidationEvent",
      "RuntimeSourceInvalidationHost",
      "RuntimeSourceWatchInput",
    ],
  ],
  [
    "@svvy/runtime/prompt-execution-context",
    ["PromptExecutionRuntimeHandle", "createPromptExecutionContext"],
  ],
  [
    "@svvy/runtime/source-invalidation-coordinator-adapter",
    [
      "RuntimeSourceInvalidationCoordinatorHandle",
      "RuntimeSourceInvalidationCoordinatorHandleOptions",
      "createRuntimeSourceInvalidationCoordinatorHandle",
    ],
  ],
  [
    "@svvy/pi-adapter/messages",
    ["buildPiUserMessageFromRuntimeSubmittedMessage", "runtimeSubmittedMessagePromptText"],
  ],
  [
    "@svvy/state/generated-package-maintenance",
    [
      "MarkPersistedWorkspaceGeneratedPackageLinksRepairNeededInput",
      "RecordPersistedWorkspaceGeneratedPackageLinkStatusInput",
      "markPersistedWorkspaceGeneratedPackageLinksRepairNeeded",
      "recordPersistedWorkspaceGeneratedPackageLinkStatus",
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
    "@svvy/state/structured-session-adapters",
    [
      "WorkspaceStateRegistration",
      "WorkspaceStateRouter",
      "WorkspaceStateRouterInput",
      "createWorkspaceStateRouter",
      "extensionSnapshotSettingsStatePortFromStore",
      "extensionSnapshotSettingsStatePortFromStructuredSessionState",
      "extensionSnapshotStatePortFromStore",
      "extensionSnapshotStatePortFromStructuredSessionState",
      "extensionStatePortFromStore",
      "extensionStatePortFromStructuredSessionState",
      "extensionUsageStatePortFromStore",
      "extensionUsageStatePortFromStructuredSessionState",
      "generatedContextPreviewSubjectStatePortFromStore",
      "generatedContextPreviewSubjectStatePortFromStructuredSessionState",
      "layerWorkspaceStateRouter",
      "piSessionReferencePortFromStore",
      "piSessionReferencePortFromStructuredSessionState",
      "providerAuthStatusStatePortFromStore",
      "providerAuthStatusStatePortFromStructuredSessionState",
      "runtimeActorExtensionBindingStatePortFromStore",
      "runtimeActorExtensionBindingStatePortFromStructuredSessionState",
      "runtimeApprovalStatePortFromStore",
      "runtimeApprovalStatePortFromStructuredSessionState",
      "runtimeArtifactStatePortFromStore",
      "runtimeArtifactStatePortFromStructuredSessionState",
      "runtimeCommandStatePortFromStore",
      "runtimeCommandStatePortFromStructuredSessionState",
      "runtimeComposerDraftStatePortFromStore",
      "runtimeComposerDraftStatePortFromStructuredSessionState",
      "runtimeEpisodeStatePortFromStore",
      "runtimeEpisodeStatePortFromStructuredSessionState",
      "runtimeExtensionContextImpactStateFacadeFromStore",
      "runtimeExtensionContextImpactStatePortFromStore",
      "runtimeExtensionContextImpactStatePortFromStructuredSessionState",
      "runtimeExtensionStatePortFromStore",
      "runtimeExtensionStatePortFromStructuredSessionState",
      "runtimeExternalInstructionStatePortFromStore",
      "runtimeExternalInstructionStatePortFromStructuredSessionState",
      "runtimeGeneratedPackageStatePortFromStore",
      "runtimeGeneratedPackageStatePortFromStructuredSessionState",
      "runtimePromptDefaultsStatePortFromStore",
      "runtimePromptDefaultsStatePortFromStructuredSessionState",
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
      "runtimeTranscriptStatePortFromStore",
      "runtimeTranscriptStatePortFromStructuredSessionState",
      "runtimeTurnStatePortFromStore",
      "runtimeTurnStatePortFromStructuredSessionState",
      "runtimeWorkflowTaskStatePortFromStore",
      "runtimeWorkflowTaskStatePortFromStructuredSessionState",
      "runtimeWorkspaceStatePortFromStore",
      "runtimeWorkspaceStatePortFromStructuredSessionState",
      "stateCommandsFromRouter",
      "stateReadModelsFromRouter",
      "structuredSessionCatalogMutationsFromStore",
    ],
  ],
  [
    "@svvy/state/structured-session-projections",
    [
      "buildStructuredArtifactLink",
      "buildStructuredCommandInspector",
      "buildStructuredHandlerThreadInspector",
      "buildStructuredHandlerThreadSummaries",
      "buildStructuredSessionSummaryProjection",
      "buildStructuredSessionView",
      "buildStructuredWorkflowTaskAttemptInspector",
      "hasStructuredSessionFacts",
      "StructuredCommandInspector",
      "StructuredHandlerThreadInspector",
      "StructuredHandlerThreadSummary",
      "StructuredSessionSummaryProjection",
      "StructuredSessionView",
      "StructuredWorkflowTaskAttemptInspector",
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
      "StructuredAppPreferenceAppearance",
      "StructuredAppPreferenceApprovalMode",
      "StructuredAppPreferencesRecord",
      "StructuredAppPreferencesPatch",
      "StructuredMutationCommitRecord",
      "StructuredWorkspaceTabRecord",
      "StructuredWorkspaceChromeRecord",
      "StructuredWorkspaceChromeMutationRecord",
      "StructuredWorkspaceLayoutRecord",
      "StructuredWorkspaceLayoutSlotRecord",
      "StructuredAgentActorExtensionDefaultsInput",
      "StructuredAgentActorExtensionDefaultsRecord",
      "StructuredAgentProfileRecord",
      "StructuredExtensionEnvOverrideRecord",
      "StructuredExtensionEnvDeclarationRecord",
      "StructuredExtensionEnvSecretRecord",
      "StructuredExtensionEnvSecretReceiptRecord",
      "StructuredExtensionEnvSecretCleanupRecord",
      "StructuredExtensionRegistryReconcileResult",
      "StructuredExtensionSourceBuildEvidenceBatchRecord",
      "StructuredExtensionSourceBuildEvidenceReconcileResult",
      "StructuredExtensionBuildAttemptMutationResult",
      "StructuredSnippetRecord",
      "StructuredWorkspaceRecord",
      "StructuredWorkspaceInput",
      "StructuredPiSessionRecord",
      "StructuredComposerDraftRecord",
      "StructuredPromptHistoryRecord",
      "StructuredWaitState",
      "StructuredSessionWaitOwner",
      "StructuredSessionWaitState",
      "StructuredTurnRecord",
      "StructuredPromptTurnSettlementResult",
      "StructuredThreadRecord",
      "StructuredGeneratedAgentContextBindingRecord",
      "StructuredCommandRecord",
      "StructuredStreamingCommandInput",
      "StructuredFinishCommandInput",
      "StructuredCommandMutationResult",
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
      "StructuredRequestUserInputMutationResult",
      "StructuredRuntimeApprovalRequestRecord",
      "StructuredRuntimeApprovalResolutionResult",
      "StructuredArtifactRecord",
      "StructuredEventSubjectKind",
      "StructuredLifecycleEventRecord",
      "StructuredSurfaceQueuedMessageStatus",
      "StructuredSurfaceQueueItemKind",
      "StructuredSurfaceQueuePriority",
      "StructuredRecoveryWorkKind",
      "StructuredRecoveryWorkStatus",
      "StructuredRecoveryWorkOwnerScope",
      "StructuredRecoveryWorkScope",
      "StructuredRecoveryWorkRecord",
      "StructuredGeneratedPackageFactRecord",
      "StructuredGeneratedWorkflowsExportRecord",
      "ReadGeneratedWorkflowsExportsInput",
      "StructuredGeneratedPackageWorkspaceLinkRecord",
      "StructuredWorkflowAgentSourceIndexRecord",
      "StructuredExtensionDependencyApprovalRecord",
      "StructuredExtensionDependencyReadinessRecord",
      "StructuredExtensionDependencyReadinessBatchRecord",
      "StructuredExtensionDependencyReadinessReconcileResult",
      "StructuredSurfaceQueuedMessageRecord",
      "StructuredRuntimeHandlerThreadGeneratedContextBindingInput",
      "StructuredRuntimeHandlerThreadInitialQueueInput",
      "StructuredStartRuntimeHandlerThreadInput",
      "StructuredStartRuntimeHandlerThreadsInput",
      "StructuredStartedRuntimeHandlerThread",
      "StructuredStartRuntimeHandlerThreadsResult",
      "StructuredInterruptedTurnRecoveryResult",
      "StructuredSessionSnapshot",
      "StructuredWorkspaceSidebarState",
      "StructuredSessionNavigationCommandInput",
      "StructuredThreadDetail",
      "CreateStructuredSessionStateStoreOptions",
      "StateDigestHelper",
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
const runtimeBootstrapSpecApprovedSymbols = [
  "awaitRuntimeStartupReadiness",
  "createRuntimeLayerConfigLayer",
  "defaultRuntimeLayerConfig",
  "layerRuntimeShutdownPreparation",
  "layerRuntimeStartupReadiness",
  "prepareRuntimeShutdown",
  "RuntimeLayerConfigFromEnv",
  "RuntimeLayerConfigInputSchema",
  "RuntimeLayerConfigSchema",
  "RuntimeLayerConfigService",
  "RuntimeLayerError",
  "RuntimeLayerErrorSchema",
  "RuntimeShutdownPreparation",
  "RuntimeStartupError",
  "RuntimeStartupErrorSchema",
  "RuntimeStartupPhase",
  "RuntimeStartupReadiness",
  "decodeUnknownRuntimeLayerErrorEffect",
  "decodeUnknownRuntimeLayerErrorExit",
  "encodeRuntimeLayerErrorEffect",
  "encodeRuntimeLayerErrorExit",
  "layerRuntimeBunPlatform",
  "RuntimeBunPlatformServices",
  "RuntimeLayerConfig",
  "RuntimePrepareShutdownReason",
  "RuntimePrepareShutdownRequest",
  "RuntimePrepareShutdownResult",
  "RuntimeStartupDegradedPhase",
  "RuntimeStartupReadinessReceipt",
  "RuntimeLayerCommandControlPort",
  "RuntimeLayerCommandStdinPort",
  "RuntimeGeneratedContextRefreshHostPort",
  "RuntimeGeneratedPackageRefreshHostPort",
  "RuntimeLayerModelResolverPort",
  "RuntimeLayerProviderAuthPort",
  "RuntimeExternalInstructionScanInputPort",
  "RuntimeSourceInvalidationScanPort",
  "RuntimeSurfaceQueueWakeReason",
  "RuntimeWorkflowTaskAgentBridgeBearerVerifier",
  "RuntimeWorkflowTaskAgentBridgeBearerVerifierService",
  "RuntimeLayerCommandControlPortService",
  "RuntimeLayerCommandStdinPortService",
  "RuntimeGeneratedContextRefreshHostPortService",
  "RuntimeGeneratedPackageRefreshHostPortService",
  "RuntimeLayerModelResolverPortService",
  "RuntimeLayerProviderAuthPortService",
  "RuntimeExternalInstructionScanInputPortService",
  "RuntimeSourceInvalidationScanPortService",
  "RuntimeGeneratedPackageWorkspaceLinkFileHost",
  "RuntimeSourceInvalidationDirectoryEntry",
  "RuntimeSourceInvalidationDomain",
  "RuntimeSourceInvalidationEvent",
  "RuntimeSourceInvalidationHost",
  "RuntimeSourceWatchInput",
] as const;
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

function listPackageRootTypeScriptTestFiles(): string[] {
  const packageRootTests = readdirSync(packageRoot)
    .map((entry) => join(packageRoot, entry))
    .filter((path) => statSync(path).isFile())
    .filter(isTestFile);
  const packageDirectoryTests = readdirSync(packageRoot).flatMap((entry) => {
    const packageDirectory = join(packageRoot, entry);
    if (!statSync(packageDirectory).isDirectory()) return [];
    return readdirSync(packageDirectory)
      .map((file) => join(packageDirectory, file))
      .filter((file) => statSync(file).isFile())
      .filter(isTestFile);
  });
  return [...packageRootTests, ...packageDirectoryTests].toSorted();
}

function listPackageRootTypeScriptFiles(): string[] {
  return readdirSync(packageRoot)
    .map((entry) => join(packageRoot, entry))
    .filter((path) => statSync(path).isFile())
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .toSorted();
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

type ModuleSpecifierReadKind = "static" | "runtime";

function readModuleSpecifierSourceFiles(path: string, source: string): ts.SourceFile[] {
  if (!path.endsWith(".svelte")) {
    return [ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)];
  }

  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match, index) =>
    ts.createSourceFile(`${path}#script-${index}.ts`, match[1] ?? "", ts.ScriptTarget.Latest, true),
  );
}

function readModuleSpecifiersFromSource(
  path: string,
  source: string,
  kinds: ReadonlySet<ModuleSpecifierReadKind>,
): string[] {
  const specifiers: string[] = [];

  for (const sourceFile of readModuleSpecifierSourceFiles(path, source)) {
    const visit = (node: ts.Node): void => {
      if (kinds.has("static")) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          specifiers.push(node.moduleSpecifier.text);
        }
        if (
          ts.isExportDeclaration(node) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          specifiers.push(node.moduleSpecifier.text);
        }
      }

      if (kinds.has("runtime") && ts.isCallExpression(node)) {
        const [firstArg] = node.arguments;
        if (firstArg && ts.isStringLiteral(firstArg)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            specifiers.push(firstArg.text);
          }
          if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
            specifiers.push(firstArg.text);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return specifiers;
}

function readModuleSpecifiers(path: string, kinds: ReadonlySet<ModuleSpecifierReadKind>): string[] {
  return readModuleSpecifiersFromSource(path, readFileSync(path, "utf8"), kinds);
}

function readImports(path: string): string[] {
  return readModuleSpecifiers(path, new Set(["static", "runtime"]));
}

type ValueImportBinding =
  | { kind: "namespace"; localName: string }
  | { kind: "named"; importedName: string; localName: string };

function moduleExportNameText(name: ts.ModuleExportName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();
}

function readValueImportBindingsFromSourceFile(
  sourceFile: ts.SourceFile,
  moduleSpecifier: string,
): ValueImportBinding[] {
  const bindings: ValueImportBinding[] = [];
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    if (node.moduleSpecifier.text !== moduleSpecifier) return;
    if (!node.importClause || node.importClause.isTypeOnly) return;
    const namedBindings = node.importClause.namedBindings;
    if (!namedBindings) return;
    if (ts.isNamespaceImport(namedBindings)) {
      bindings.push({ kind: "namespace", localName: namedBindings.name.text });
      return;
    }
    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) continue;
      bindings.push({
        kind: "named",
        importedName: moduleExportNameText(element.propertyName ?? element.name),
        localName: element.name.text,
      });
    }
  });
  return bindings;
}

function readValueImportBindings(path: string, moduleSpecifier: string): ValueImportBinding[] {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return readValueImportBindingsFromSourceFile(sourceFile, moduleSpecifier);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readManualEffectRuntimeReads(file: string): string[] {
  const source = readSource(file);
  return readManualEffectRuntimeReadsFromSource(file, source);
}

function readManualEffectRuntimeReadsFromSource(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const effectRunnerMembers = new Set([
    "runPromise",
    "runPromiseWith",
    "runPromiseExit",
    "runPromiseExitWith",
    "runSync",
    "runSyncWith",
    "runSyncExit",
    "runSyncExitWith",
    "runFork",
    "runForkWith",
    "runCallback",
    "runCallbackWith",
  ]);
  const reads: string[] = [];
  const effectNamespaces = new Set(["Effect"]);
  const managedRuntimeNamespaces = new Set(["ManagedRuntime"]);
  const layerNamespaces = new Set(["Layer"]);
  const effectRunnerCallables = new Map<string, string>();
  const managedRuntimeMakeCallables = new Set<string>();
  const layerLaunchCallables = new Set<string>();
  const runMainCallables = new Set(["runMain"]);

  for (const binding of readValueImportBindingsFromSourceFile(sourceFile, "effect/Effect")) {
    if (binding.kind === "namespace") {
      effectNamespaces.add(binding.localName);
    } else if (effectRunnerMembers.has(binding.importedName)) {
      effectRunnerCallables.set(binding.localName, `Effect.${binding.importedName}`);
    }
  }
  for (const binding of readValueImportBindingsFromSourceFile(sourceFile, "effect")) {
    if (binding.kind === "named" && binding.importedName === "Effect") {
      effectNamespaces.add(binding.localName);
    }
  }
  for (const binding of readValueImportBindingsFromSourceFile(
    sourceFile,
    "effect/ManagedRuntime",
  )) {
    if (binding.kind === "namespace") {
      managedRuntimeNamespaces.add(binding.localName);
    } else if (binding.importedName === "make") {
      managedRuntimeMakeCallables.add(binding.localName);
    }
  }
  for (const binding of readValueImportBindingsFromSourceFile(sourceFile, "effect/Layer")) {
    if (binding.kind === "namespace") {
      layerNamespaces.add(binding.localName);
    } else if (binding.importedName === "launch") {
      layerLaunchCallables.add(binding.localName);
    }
  }

  const memberName = (node: ts.Expression): string | null => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      return node.argumentExpression.text;
    }
    return null;
  };

  const receiverName = (node: ts.Expression): string | null => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return ts.isIdentifier(node.expression) ? node.expression.text : null;
    }
    return null;
  };

  const registerObjectBinding = (
    name: ts.BindingName,
    memberReaders: ReadonlySet<string>,
    displayName: (member: string) => string,
  ): void => {
    if (!ts.isObjectBindingPattern(name)) return;
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const importedName = element.propertyName
        ? ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName)
          ? element.propertyName.text
          : null
        : element.name.text;
      if (!importedName || !memberReaders.has(importedName)) continue;
      reads.push(displayName(importedName));
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && ts.isIdentifier(node.initializer)) {
        if (effectNamespaces.has(node.initializer.text)) effectNamespaces.add(node.name.text);
        if (managedRuntimeNamespaces.has(node.initializer.text)) {
          managedRuntimeNamespaces.add(node.name.text);
        }
        if (layerNamespaces.has(node.initializer.text)) layerNamespaces.add(node.name.text);
      }
      if (ts.isIdentifier(node.initializer)) {
        if (effectNamespaces.has(node.initializer.text)) {
          registerObjectBinding(node.name, effectRunnerMembers, (member) => `Effect.${member}`);
        }
        if (managedRuntimeNamespaces.has(node.initializer.text)) {
          registerObjectBinding(node.name, new Set(["make"]), () => "ManagedRuntime.make");
        }
        if (layerNamespaces.has(node.initializer.text)) {
          registerObjectBinding(node.name, new Set(["launch"]), () => "Layer.launch");
        }
      }
      if (
        ts.isIdentifier(node.name) &&
        ts.isAwaitExpression(node.initializer) &&
        ts.isCallExpression(node.initializer.expression) &&
        node.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.initializer.expression.arguments.length === 1
      ) {
        const [specifier] = node.initializer.expression.arguments;
        if (specifier && ts.isStringLiteralLike(specifier)) {
          if (specifier.text === "effect/Effect") effectNamespaces.add(node.name.text);
          if (specifier.text === "effect/ManagedRuntime") {
            managedRuntimeNamespaces.add(node.name.text);
          }
          if (specifier.text === "effect/Layer") layerNamespaces.add(node.name.text);
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callable = effectRunnerCallables.get(node.expression.text);
      if (callable) reads.push(callable);
      if (managedRuntimeMakeCallables.has(node.expression.text)) reads.push("ManagedRuntime.make");
      if (layerLaunchCallables.has(node.expression.text)) reads.push("Layer.launch");
      if (runMainCallables.has(node.expression.text)) reads.push("runMain");
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const receiver = receiverName(node);
      const member = memberName(node);
      if (receiver && member && effectNamespaces.has(receiver) && effectRunnerMembers.has(member)) {
        reads.push(`Effect.${member}`);
      }
      if (receiver && member === "make" && managedRuntimeNamespaces.has(receiver)) {
        reads.push("ManagedRuntime.make");
      }
      if (receiver && member === "launch" && layerNamespaces.has(receiver)) {
        reads.push("Layer.launch");
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return reads;
}

function readConfigProviderFromEnvReads(file: string): Array<{
  readonly displayName: "ConfigProvider.fromEnv";
  readonly zeroArgument: boolean;
}> {
  const source = readSource(file);
  const namespaceNames = new Set<string>();
  const callableNames = new Set<string>();

  if (/\bConfigProvider\s*\.\s*fromEnv\s*\(/.test(source)) {
    namespaceNames.add("ConfigProvider");
  }

  for (const binding of readValueImportBindings(file, "effect/ConfigProvider")) {
    if (binding.kind === "namespace") {
      namespaceNames.add(binding.localName);
    } else if (binding.importedName === "fromEnv") {
      callableNames.add(binding.localName);
    }
  }

  for (const binding of readValueImportBindings(file, "effect")) {
    if (binding.kind === "named" && binding.importedName === "ConfigProvider") {
      namespaceNames.add(binding.localName);
    }
  }

  const discoveredNamespaceNames = Array.from(namespaceNames);
  for (const namespaceName of discoveredNamespaceNames) {
    const escaped = escapeRegExp(namespaceName);
    for (const match of source.matchAll(
      new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escaped}\\b`, "g"),
    )) {
      namespaceNames.add(match[1]!);
    }
    for (const match of source.matchAll(
      new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${escaped}\\b`, "g"),
    )) {
      for (const part of match[1]!.split(",")) {
        const trimmed = part.trim();
        const alias = trimmed.match(/^fromEnv\s*:\s*([A-Za-z_$][\w$]*)$/);
        if (alias) {
          callableNames.add(alias[1]!);
        } else if (/^fromEnv\b/.test(trimmed)) {
          callableNames.add("fromEnv");
        }
      }
    }
  }

  const calls = [
    ...[...namespaceNames].map((name) => `${escapeRegExp(name)}\\s*\\.\\s*fromEnv`),
    ...[...callableNames].map((name) => escapeRegExp(name)),
  ];

  return calls.flatMap((call) =>
    Array.from(source.matchAll(new RegExp(`\\b${call}\\s*\\(`, "g")), (match) => {
      const afterOpenParen = source.slice((match.index ?? 0) + match[0].length);
      return {
        displayName: "ConfigProvider.fromEnv" as const,
        zeroArgument: /^\s*\)/.test(afterOpenParen),
      };
    }),
  );
}

function readManagedRuntimeInstanceMemberReads(file: string): Array<{
  readonly receiver: string;
  readonly member: string;
}> {
  const source = readSource(file);
  return readManagedRuntimeInstanceMemberReadsFromSource(file, source);
}

function readManagedRuntimeInstanceMemberReadsFromSource(
  file: string,
  source: string,
): Array<{
  readonly receiver: string;
  readonly member: string;
}> {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const managedRuntimeNamespaces = new Set(["ManagedRuntime"]);
  const makeCallables = new Set<string>();
  const receivers = new Set(["managedRuntime"]);
  const members = new Set(["context", "dispose", "runPromise", "runPromiseExit"]);
  const reads: Array<{ receiver: string; member: string }> = [];

  for (const binding of readValueImportBindingsFromSourceFile(
    sourceFile,
    "effect/ManagedRuntime",
  )) {
    if (binding.kind === "namespace") {
      managedRuntimeNamespaces.add(binding.localName);
    } else if (binding.importedName === "make") {
      makeCallables.add(binding.localName);
    }
  }

  const expressionMemberName = (node: ts.Expression): string | null => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      return node.argumentExpression.text;
    }
    return null;
  };

  const isManagedRuntimeMakeCall = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) return makeCallables.has(node.text);
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
    const member = expressionMemberName(node);
    return (
      member === "make" &&
      ts.isIdentifier(node.expression) &&
      managedRuntimeNamespaces.has(node.expression.text)
    );
  };

  const receiverPath = (node: ts.Expression): string | null => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) {
      const prefix = receiverPath(node.expression);
      return prefix ? `${prefix}.${node.name.text}` : null;
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      const prefix = receiverPath(node.expression);
      return prefix ? `${prefix}.${node.argumentExpression.text}` : null;
    }
    return null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (
        ts.isCallExpression(node.initializer) &&
        isManagedRuntimeMakeCall(node.initializer.expression)
      ) {
        receivers.add(node.name.text);
      } else if (ts.isIdentifier(node.initializer) && receivers.has(node.initializer.text)) {
        receivers.add(node.name.text);
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const member = expressionMemberName(node);
      const path = receiverPath(node.expression);
      const receiver = path?.split(".").at(-1);
      if (member && receiver && members.has(member) && receivers.has(receiver)) {
        reads.push({ receiver, member });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return reads;
}

const injectedEffectServiceReceivers = [
  {
    module: "effect/FileSystem",
    namespace: "FileSystem",
    service: "FileSystem",
    receiver: "FileSystem.FileSystem",
  },
  {
    module: "effect/Path",
    namespace: "Path",
    service: "Path",
    receiver: "Path.Path",
  },
  {
    module: "effect/Crypto",
    namespace: "Crypto",
    service: "Crypto",
    receiver: "Crypto.Crypto",
  },
  {
    module: "effect/Semaphore",
    namespace: "Semaphore",
    service: "Semaphore",
    receiver: "Semaphore.Semaphore",
  },
] as const;

function readInjectedEffectServiceInstanceMemberReads(file: string): Array<{
  readonly module: string;
  readonly receiver: string;
  readonly member: string;
}> {
  return readInjectedEffectServiceInstanceMemberReadsFromSource(file, readSource(file));
}

function readInjectedEffectServiceInstanceMemberReadsFromSource(
  file: string,
  source: string,
): Array<{
  readonly module: string;
  readonly receiver: string;
  readonly member: string;
}> {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const serviceSelectors = new Map<
    string,
    { readonly module: string; readonly service: string; readonly receiver: string }
  >();
  const semaphoreMakeSelectors = new Set<string>();
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const service = injectedEffectServiceReceivers.find(
      (candidate) => candidate.module === node.moduleSpecifier.text,
    );
    if (!service) return;
    const namedBindings = node.importClause?.namedBindings;
    if (!namedBindings) return;
    if (ts.isNamespaceImport(namedBindings)) {
      serviceSelectors.set(namedBindings.name.text, service);
      return;
    }
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === service.service) {
        serviceSelectors.set(element.name.text, service);
      }
      if (service.receiver === "Semaphore.Semaphore" && importedName === "make") {
        semaphoreMakeSelectors.add(element.name.text);
      }
    }
  });
  if (serviceSelectors.size === 0 && semaphoreMakeSelectors.size === 0) return [];

  type Receiver = { readonly module: string; readonly receiver: string };
  const reads: Array<{ module: string; receiver: string; member: string }> = [];

  const serviceReceiverForSelector = (node: ts.Expression): Receiver | null => {
    if (ts.isIdentifier(node)) {
      const imported = serviceSelectors.get(node.text);
      return imported ? { module: imported.module, receiver: imported.receiver } : null;
    }
    if (!ts.isPropertyAccessExpression(node)) return null;
    if (!ts.isIdentifier(node.expression)) return null;
    const imported = serviceSelectors.get(node.expression.text);
    if (!imported || node.name.text !== imported.service) return null;
    return { module: imported.module, receiver: imported.receiver };
  };

  const serviceReceiverForType = (node: ts.TypeNode | undefined): Receiver | null => {
    if (!node || !ts.isTypeReferenceNode(node)) return null;
    const typeName = node.typeName;
    if (ts.isIdentifier(typeName)) {
      const imported = serviceSelectors.get(typeName.text);
      return imported ? { module: imported.module, receiver: imported.receiver } : null;
    }
    if (!ts.isQualifiedName(typeName) || !ts.isIdentifier(typeName.left)) return null;
    const imported = serviceSelectors.get(typeName.left.text);
    if (!imported || typeName.right.text !== imported.service) return null;
    return { module: imported.module, receiver: imported.receiver };
  };

  const serviceReceiversForParameter = (
    node: ts.ParameterDeclaration,
  ): ReadonlyArray<{ readonly path: string; readonly receiver: Receiver }> => {
    if (!ts.isIdentifier(node.name)) return [];
    const parameterName = node.name.text;
    const directReceiver = serviceReceiverForType(node.type);
    if (directReceiver) return [{ path: parameterName, receiver: directReceiver }];
    if (!node.type || !ts.isTypeLiteralNode(node.type)) return [];
    return node.type.members.flatMap((member) => {
      if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name)) {
        return [];
      }
      const receiver = serviceReceiverForType(member.type);
      return receiver ? [{ path: `${parameterName}.${member.name.text}`, receiver }] : [];
    });
  };

  const serviceReceiverFromYield = (node: ts.Expression | undefined): Receiver | null => {
    if (!node || !ts.isYieldExpression(node) || !node.asteriskToken) return null;
    const selectorReceiver = serviceReceiverForSelector(node.expression);
    if (selectorReceiver) return selectorReceiver;
    if (!ts.isCallExpression(node.expression)) return null;
    const expression = node.expression.expression;
    if (ts.isIdentifier(expression) && semaphoreMakeSelectors.has(expression.text)) {
      const semaphore = injectedEffectServiceReceivers.find(
        (candidate) => candidate.receiver === "Semaphore.Semaphore",
      );
      return semaphore ? { module: semaphore.module, receiver: semaphore.receiver } : null;
    }
    if (!ts.isPropertyAccessExpression(expression)) return null;
    if (!ts.isIdentifier(expression.expression) || expression.name.text !== "make") return null;
    const imported = serviceSelectors.get(expression.expression.text);
    if (!imported || imported.receiver !== "Semaphore.Semaphore") return null;
    return { module: imported.module, receiver: imported.receiver };
  };

  const receiverPath = (node: ts.Expression): string | null => {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) {
      const prefix = receiverPath(node.expression);
      return prefix ? `${prefix}.${node.name.text}` : null;
    }
    return null;
  };

  const bindingNames = (name: ts.BindingName): string[] => {
    if (ts.isIdentifier(name)) return [name.text];
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element) ? bindingNames(element.name) : [],
    );
  };

  const visit = (node: ts.Node, receivers: Map<string, Receiver>): void => {
    if (
      ts.isSourceFile(node) ||
      ts.isBlock(node) ||
      ts.isModuleBlock(node) ||
      ts.isCaseBlock(node)
    ) {
      node.forEachChild((child) => visit(child, receivers));
      return;
    }

    if (ts.isFunctionLike(node)) {
      const scopedReceivers = new Map(receivers);
      for (const parameter of node.parameters) {
        for (const name of bindingNames(parameter.name)) {
          scopedReceivers.delete(name);
        }
        for (const serviceParameter of serviceReceiversForParameter(parameter)) {
          scopedReceivers.set(serviceParameter.path, serviceParameter.receiver);
        }
      }
      if (node.body) visit(node.body, scopedReceivers);
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) visit(node.initializer, receivers);
      for (const name of bindingNames(node.name)) {
        receivers.delete(name);
      }
      const serviceReceiver = serviceReceiverFromYield(node.initializer);
      if (serviceReceiver && ts.isIdentifier(node.name)) {
        receivers.set(node.name.text, serviceReceiver);
      }
      return;
    }

    if (ts.isPropertyAccessExpression(node)) {
      const path = receiverPath(node.expression);
      if (path) {
        const receiver = receivers.get(path);
        if (receiver) {
          reads.push({ ...receiver, member: node.name.text });
        }
      }
      if (
        ts.isParenthesizedExpression(node.expression) &&
        ts.isYieldExpression(node.expression.expression)
      ) {
        const receiver = serviceReceiverFromYield(node.expression.expression);
        if (receiver) {
          reads.push({ ...receiver, member: node.name.text });
        }
      }
    }

    node.forEachChild((child) => visit(child, receivers));
  };

  visit(sourceFile, new Map());
  return reads;
}

function readRuntimeFacadeCallIndexes(file: string): number[] {
  const source = readSource(file);
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const namedImports: string[] = [];
  const namespaceImports: string[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    if (node.moduleSpecifier.text !== "@svvy/runtime") return;
    const namedBindings = node.importClause?.namedBindings;
    if (!namedBindings) return;
    if (ts.isNamespaceImport(namedBindings)) {
      namespaceImports.push(namedBindings.name.text);
      return;
    }
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === "createRuntimeFacade") {
        namedImports.push(element.name.text);
      }
    }
  });

  return [
    ...namedImports.flatMap((localName) =>
      Array.from(
        source.matchAll(new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(`, "g")),
        (match) => match.index ?? 0,
      ),
    ),
    ...namespaceImports.flatMap((localName) =>
      Array.from(
        source.matchAll(
          new RegExp(`\\b${escapeRegExp(localName)}\\s*\\.\\s*createRuntimeFacade\\s*\\(`, "g"),
        ),
        (match) => match.index ?? 0,
      ),
    ),
  ].toSorted((left, right) => left - right);
}

function readEffectSchemaCompilerConstructionReads(file: string): Array<{
  readonly index: number;
  readonly label: string;
}> {
  const source = readSource(file);
  return readEffectSchemaCompilerConstructionReadsFromSource(file, source);
}

function readEffectSchemaCompilerConstructionReadsFromSource(
  file: string,
  source: string,
): Array<{
  readonly index: number;
  readonly label: string;
}> {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const compilerNames = new Set(effectSchemaCompilerNames);
  const namespaceNames = new Set(["Schema"]);
  const compilerCallables = new Map<string, string>();
  const reads: Array<{ index: number; label: string }> = [];

  for (const binding of readValueImportBindingsFromSourceFile(sourceFile, "effect/Schema")) {
    if (binding.kind === "namespace") {
      namespaceNames.add(binding.localName);
    } else if (compilerNames.has(binding.importedName)) {
      compilerCallables.set(
        binding.localName,
        `effect/Schema ${binding.importedName} named import`,
      );
    }
  }

  const propertyName = (name: ts.PropertyName | ts.BindingName): string | null => {
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    return null;
  };

  const expressionMember = (node: ts.Expression): string | null => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      return node.argumentExpression.text;
    }
    return null;
  };

  const schemaCompilerLabel = (node: ts.Expression): string | null => {
    if (ts.isIdentifier(node)) return compilerCallables.get(node.text) ?? null;
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;
    if (!ts.isIdentifier(node.expression)) return null;
    if (!namespaceNames.has(node.expression.text)) return null;
    const member = expressionMember(node);
    if (!member || !compilerNames.has(member)) return null;
    return node.expression.text === "Schema"
      ? `Schema.${member}`
      : `effect/Schema ${member} namespace alias`;
  };

  const registerCompilerBindingAlias = (name: ts.BindingName, initializer: ts.Expression): void => {
    const label = schemaCompilerLabel(initializer);
    if (label && ts.isIdentifier(name)) {
      compilerCallables.set(
        name.text,
        label.startsWith("Schema.") ? `${label} local alias` : label,
      );
      return;
    }
    if (!ts.isObjectBindingPattern(name) || !ts.isIdentifier(initializer)) return;
    if (!namespaceNames.has(initializer.text)) return;
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const member = propertyName(element.propertyName ?? element.name);
      if (!member || !compilerNames.has(member)) continue;
      compilerCallables.set(
        element.name.text,
        initializer.text === "Schema"
          ? `Schema.${member} local alias`
          : `effect/Schema ${member} namespace alias`,
      );
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && ts.isIdentifier(node.initializer)) {
        if (namespaceNames.has(node.initializer.text)) namespaceNames.add(node.name.text);
      }
      registerCompilerBindingAlias(node.name, node.initializer);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      schemaCompilerLabel(node.expression.expression)
    ) {
      reads.push({
        index: node.expression.expression.getStart(sourceFile),
        label: schemaCompilerLabel(node.expression.expression)!,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return reads;
}

function readEffectSchemaAssertReads(file: string): string[] {
  const source = readSource(file);
  return readEffectSchemaAssertReadsFromSource(file, source);
}

function readEffectSchemaAssertReadsFromSource(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const namespaceNames = new Set(["Schema"]);
  const assertCallables = new Set<string>();
  const reads: string[] = [];

  for (const binding of readValueImportBindingsFromSourceFile(sourceFile, "effect/Schema")) {
    if (binding.kind === "namespace") {
      namespaceNames.add(binding.localName);
    } else if (binding.importedName === "asserts") {
      assertCallables.add(binding.localName);
    }
  }

  const expressionMember = (node: ts.Expression): string | null => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      return node.argumentExpression.text;
    }
    return null;
  };

  const assertLabel = (node: ts.Expression): string | null => {
    if (ts.isIdentifier(node))
      return assertCallables.has(node.text) ? "effect/Schema asserts" : null;
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;
    if (!ts.isIdentifier(node.expression) || !namespaceNames.has(node.expression.text)) return null;
    return expressionMember(node) === "asserts"
      ? node.expression.text === "Schema"
        ? "Schema.asserts"
        : "effect/Schema asserts namespace alias"
      : null;
  };

  const registerAssertAlias = (name: ts.BindingName, initializer: ts.Expression): void => {
    if (assertLabel(initializer) && ts.isIdentifier(name)) {
      assertCallables.add(name.text);
      return;
    }
    if (!ts.isObjectBindingPattern(name) || !ts.isIdentifier(initializer)) return;
    if (!namespaceNames.has(initializer.text)) return;
    for (const element of name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const member = element.propertyName
        ? ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName)
          ? element.propertyName.text
          : null
        : element.name.text;
      if (member === "asserts") assertCallables.add(element.name.text);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && ts.isIdentifier(node.initializer)) {
        if (namespaceNames.has(node.initializer.text)) namespaceNames.add(node.name.text);
      }
      registerAssertAlias(node.name, node.initializer);
    }
    if (ts.isCallExpression(node)) {
      const label = assertLabel(node.expression);
      if (label) reads.push(label);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return reads;
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
    if (!importClause.isTypeOnly && importClause.name) {
      addEffectMemberRead(moduleMembers, moduleSpecifier, "default");
    }
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
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!isEffectPackageSpecifier(moduleSpecifier)) {
      continue;
    }
    const exportClause = statement.exportClause;
    if (!exportClause) {
      addEffectMemberRead(moduleMembers, moduleSpecifier, "*");
      continue;
    }
    if (ts.isNamespaceExport(exportClause)) {
      addEffectMemberRead(moduleMembers, moduleSpecifier, "*");
      continue;
    }
    for (const exportSpecifier of exportClause.elements) {
      if (exportSpecifier.isTypeOnly) {
        continue;
      }
      const exportedName = (exportSpecifier.propertyName ?? exportSpecifier.name).text;
      addEffectMemberRead(moduleMembers, moduleSpecifier, exportedName);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const moduleSpecifier = namespaceImports.get(node.expression.text);
      if (moduleSpecifier) {
        addEffectMemberRead(moduleMembers, moduleSpecifier, node.name.text);
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      const moduleSpecifier = namespaceImports.get(node.expression.text);
      if (moduleSpecifier) {
        addEffectMemberRead(moduleMembers, moduleSpecifier, node.argumentExpression.text);
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      ts.isIdentifier(node.name)
    ) {
      const moduleSpecifier = namespaceImports.get(node.initializer.text);
      if (moduleSpecifier) {
        namespaceImports.set(node.name.text, moduleSpecifier);
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      const moduleSpecifier = namespaceImports.get(node.initializer.text);
      if (moduleSpecifier) {
        for (const element of node.name.elements) {
          if (element.dotDotDotToken) {
            addEffectMemberRead(moduleMembers, moduleSpecifier, "*");
            continue;
          }
          const propertyName = element.propertyName ?? element.name;
          if (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)) {
            addEffectMemberRead(moduleMembers, moduleSpecifier, propertyName.text);
          }
        }
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
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    if (node.moduleSpecifier.text !== moduleSpecifier) return;
    const namedBindings = node.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) return;
    for (const element of namedBindings.elements) {
      names.push(element.propertyName?.text ?? element.name.text);
    }
  });

  return names;
}

function readStaticSourceImports(path: string): string[] {
  return readModuleSpecifiers(path, new Set(["static"]));
}

function readStaticTypeOnlyImportViolations(
  path: string,
  packageSpecifiers: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  const source = readSource(path);

  for (const sourceFile of readModuleSpecifierSourceFiles(path, source)) {
    sourceFile.forEachChild((node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (!packageSpecifiers.has(specifier)) return;
        const importClause = node.importClause;
        if (!importClause) return;
        if (importClause.isTypeOnly) return;
        if (importClause.name) {
          violations.push(`${display(path)} -> ${specifier}: default value import`);
          return;
        }
        const namedBindings = importClause.namedBindings;
        if (!namedBindings) return;
        if (ts.isNamespaceImport(namedBindings)) {
          violations.push(`${display(path)} -> ${specifier}: namespace value import`);
          return;
        }
        const valueNames = namedBindings.elements
          .filter((element) => !element.isTypeOnly)
          .map((element) => moduleExportNameText(element.propertyName ?? element.name));
        if (valueNames.length > 0) {
          violations.push(
            `${display(path)} -> ${specifier}: value imports ${valueNames.join(", ")}`,
          );
        }
      }

      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        if (!packageSpecifiers.has(specifier)) return;
        if (node.isTypeOnly) return;
        violations.push(`${display(path)} -> ${specifier}: value re-export`);
      }
    });
  }

  return violations;
}

function resolveStateSourceImport(fromFile: string, specifier: string): string | null {
  const stateSourceRoot = join(packageRoot, "state", "src");
  const candidates = (() => {
    if (specifier.startsWith(".")) {
      const basePath = resolve(dirname(fromFile), specifier);
      return [basePath, `${basePath}.ts`, join(basePath, "index.ts")];
    }

    if (specifier === "@svvy/state") {
      return [join(stateSourceRoot, "index.ts")];
    }

    if (specifier.startsWith("@svvy/state/")) {
      const exports = expectedPublicExports.get("@svvy/state") ?? {};
      const exportTarget = exports[`.${specifier.slice("@svvy/state".length)}`];
      return exportTarget ? [join(packageRoot, "state", exportTarget)] : [];
    }

    return [];
  })();

  for (const candidate of candidates) {
    const normalized = resolve(candidate);
    const relativeToState = relative(stateSourceRoot, normalized);
    if (
      relativeToState &&
      !relativeToState.startsWith("..") &&
      !relativeToState.startsWith(sep) &&
      existsSync(normalized)
    ) {
      return normalized;
    }
  }

  return null;
}

function readRuntimeModuleLoads(path: string): string[] {
  return readModuleSpecifiers(path, new Set(["runtime"]));
}

function readPackageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("node:") || specifier.startsWith("bun:")) {
    return null;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

function readCorePublicSymbolIndexNames(): string[] {
  const source = readSource(
    join(packageArchitectureSpecRoot, "core-public-symbol-index.generated.md"),
  );
  return source
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.match(/^\| `([^`]+)`\s+\|/)?.[1])
    .filter((name): name is string => Boolean(name))
    .toSorted();
}

function readCorePublicSymbolIndexRows(): Array<{
  readonly symbol: string;
  readonly sourceModule: string;
  readonly contractKind: string;
  readonly schemaSymbol: string;
  readonly encodedType: string;
}> {
  const source = readSource(
    join(packageArchitectureSpecRoot, "core-public-symbol-index.generated.md"),
  );
  return source
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .map((cells) => ({
      symbol: cells[0]?.match(/^`([^`]+)`$/)?.[1] ?? "",
      sourceModule: cells[1]?.match(/^`([^`]+)`$/)?.[1] ?? "",
      contractKind: cells[4] ?? "",
      schemaSymbol: cells[5] ?? "",
      encodedType: cells[6] ?? "",
    }))
    .filter((row) => row.symbol.length > 0);
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

function hasPublicDefaultExport(path: string): boolean {
  const source = readSource(path);
  return /^\s*export\s+default\b/m.test(source);
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

function readAmbientHostEnvReads(path: string): string[] {
  const sourceFile = ts.createSourceFile(path, readSource(path), ts.ScriptTarget.Latest, true);
  const reads = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node)) {
      const name = expressionPathWithImportMeta(node);
      if (name && isAmbientHostEnvRead(name)) reads.add(name);
    } else if (ts.isElementAccessExpression(node)) {
      const baseName = expressionPathWithImportMeta(node.expression);
      if (baseName && isAmbientHostEnvRead(baseName)) {
        const key = ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : "<dynamic>";
        reads.add(`${baseName}[${key}]`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Array.from(reads).toSorted();
}

function isAmbientHostEnvRead(name: string): boolean {
  return name === "process.env" || name === "Bun.env" || name === "import.meta.env";
}

function expressionPathWithImportMeta(expression: ts.Expression): string | null {
  if (ts.isMetaProperty(expression)) {
    return expression.keywordToken === ts.SyntaxKind.ImportKeyword
      ? `import.${expression.name.text}`
      : expression.name.text;
  }
  return expressionPath(expression);
}

function expressionPath(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = expressionPathWithImportMeta(expression.expression);
    return parent ? `${parent}.${expression.name.text}` : expression.name.text;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    const parent = expressionPathWithImportMeta(expression.expression);
    return parent
      ? `${parent}.${expression.argumentExpression.text}`
      : expression.argumentExpression.text;
  }
  return null;
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
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.endsWith(".spec.ts") ||
    path.endsWith(".spec.tsx") ||
    path.endsWith("_test.ts") ||
    path.endsWith("_test.tsx") ||
    path.endsWith("_spec.ts") ||
    path.endsWith("_spec.tsx") ||
    path.endsWith(".test-support.ts")
  );
}

function isEffectTestLaneFile(path: string): boolean {
  const relativePath = display(path);
  return relativePath.startsWith("packages/") && relativePath.endsWith(".effect.test.ts");
}

function display(path: string): string {
  return relative(projectRoot, path).split(sep).join("/");
}

function matchesRepositoryGlob(path: string, glob: string): boolean {
  const doubleStar = "__SVVY_DOUBLE_STAR__";
  const singleStar = "__SVVY_SINGLE_STAR__";
  const escaped = glob
    .replaceAll("**", doubleStar)
    .replaceAll("*", singleStar)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replaceAll(doubleStar, "[\\s\\S]*").replaceAll(singleStar, "[^/]*");
  return new RegExp(`^${pattern}$`).test(path);
}

function isVendoredSourcePath(path: string): boolean {
  return display(path).split("/").includes("node_modules");
}

function countEntries(entries: readonly string[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry] = (counts[entry] ?? 0) + 1;
    return counts;
  }, {});
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countAuditPoliciesByState(
  policies: readonly { readonly adoptionState: string }[],
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(
      policies.reduce<Record<string, number>>((counts, policy) => {
        counts[policy.adoptionState] = (counts[policy.adoptionState] ?? 0) + 1;
        return counts;
      }, {}),
    ).toSorted(([left], [right]) => left.localeCompare(right)),
  );
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

  it("multi-write state port adapters delegate to structured-session transaction methods", () => {
    const runtimeThreadStatePort = readSource(
      join(packageRoot, "state", "src", "runtime-thread-state-port.ts"),
    );
    const runtimeExtensionContextImpactStatePort = readSource(
      join(packageRoot, "state", "src", "runtime-extension-context-impact-state-port.ts"),
    );
    const runtimeEpisodeStatePort = readSource(
      join(packageRoot, "state", "src", "runtime-episode-state-port.ts"),
    );
    const runtimeRequestStatePort = readSource(
      join(packageRoot, "state", "src", "runtime-request-state-port.ts"),
    );
    const structuredSessionState = readSource(
      join(packageRoot, "state", "src", "structured-session-state.ts"),
    );

    expect(runtimeThreadStatePort).toMatch(/state\s*\.\s*ensureHandlerThreadRunnable\(input\)/);
    expect(runtimeThreadStatePort).not.toContain("state.getSessionState(input.workspaceSessionId)");
    expect(runtimeThreadStatePort).not.toContain("state.updateThread({");

    expect(runtimeExtensionContextImpactStatePort).toMatch(
      /state\s*\.\s*applySnapshotContextImpact\(input\)/,
    );
    expect(runtimeExtensionContextImpactStatePort).not.toContain(
      "applySnapshotContextImpactToState",
    );
    expect(runtimeExtensionContextImpactStatePort).not.toContain(
      "applySnapshotContextImpactToStore",
    );

    expect(runtimeEpisodeStatePort).toMatch(/state\s*\.\s*recordHandlerThreadEpisode\(input\)/);
    expect(runtimeEpisodeStatePort).not.toContain(
      "state.getSessionState(input.workspaceSessionId)",
    );
    expect(runtimeEpisodeStatePort).not.toContain("state.createEpisode({");
    expect(runtimeEpisodeStatePort).not.toContain("state.updateThread({");

    expect(runtimeRequestStatePort).toContain("state.answerRequestUserInput({");
    expect(runtimeRequestStatePort).toContain("state.setRequestUserInputTimerPaused({");
    expect(runtimeRequestStatePort).not.toContain(
      "const request = yield* state.getRequestUserInputRequest(input.requestId);",
    );

    expect(structuredSessionState).toContain("ensureHandlerThreadRunnable(input: {");
    expect(structuredSessionState).toContain("applySnapshotContextImpact(");
    expect(structuredSessionState).toContain("recordHandlerThreadEpisode(input: {");
    expect(structuredSessionState).toContain("const ensureRunnable = this.db.transaction");
    expect(structuredSessionState).toContain("const applyImpact = this.db.transaction");
    expect(structuredSessionState).toContain("const recordEpisode = this.db.transaction");
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

  it("source-of-truth docs avoid transitional Effect package architecture wording", () => {
    const productDocFiles = [
      join(projectRoot, "docs", "prd.md"),
      join(projectRoot, "docs", "features.ts"),
      join(projectRoot, "docs", "progress.md"),
      join(projectRoot, "docs", "redesign-implementation-checklist.md"),
      ...listMarkdownFiles(productSpecRoot),
    ];
    const stalePhrases = [
      "currently consumed by app/bootstrap host-edge code",
      "explicit unchecked boundary items below",
      "App-edge tool wrappers and extension handlers import the runtime-owned constructor/live handle",
      "signed closed transport intents",
      "broader extension state-change replay",
      "Extension platform track: implement",
      "Approval/sandbox/execution-policy track: implement",
      "Workflows/Smithers source-library and generated-package track: implement",
      "Snippets track: implement",
      "Agents/profile/editor forms track: complete",
      "Live projection/structured recovery track: complete",
      "Dockview/navigation polish track: complete",
      "Markdown/context-budget/UI verification track: finish",
      "explicit recovery ledger",
      "retirement ledger",
      "refactor ledger",
      "while the package facade lands",
      "while runtime launch moves to Sandbox",
      "current WorkspaceRuntime still",
      "current workspace RPC routing",
      "tracked package-internal inventory",
      "target product PRD",
      "target reusable package architecture",
      "target public packages",
      "not target ownership",
      "target design",
      "target package architecture",
      "target public contracts",
      "promoted implementation",
      "exact target names",
      "target package names",
      "target architecture",
      "target-architecture",
      "Target-Ready Boundary Gates",
      "target-ready",
      "target package-root",
      "target state architecture",
      "future process-adoption patch",
      "not current production architecture",
    ];
    const violations = productDocFiles.flatMap((file) => {
      const source = readSource(file);
      return stalePhrases
        .filter((phrase) => source.includes(phrase))
        .map((phrase) => `${display(file)} -> ${phrase}`);
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
    const allowedNodeImports = new Set(["node:fs", "node:os", "node:path"]);
    const allowedTestNodeImports = new Set(["node:crypto"]);
    const allowedPrefixes = ["effect/", "bun:sqlite", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "state", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (allowedNodeImports.has(specifier)) return false;
          if (isTestFile(file) && allowedTestNodeImports.has(specifier)) return false;
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
    const allowedNodeImports = new Set(["node:fs", "node:path"]);
    const allowedTestNodeImports = new Set(["node:child_process", "node:crypto", "node:os"]);
    const allowedPrefixes = ["effect/", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "sandbox", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (allowedNodeImports.has(specifier)) return false;
          if (isTestFile(file) && allowedTestNodeImports.has(specifier)) return false;
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
    const allowedNodeImports = new Set(["node:path"]);
    const allowedTestNodeImports = new Set(["node:fs", "node:os"]);
    const allowedPrefixes = ["effect/", "@mariozechner/pi-coding-agent/", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "pi-adapter", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (allowedNodeImports.has(specifier)) return false;
          if (isTestFile(file) && allowedTestNodeImports.has(specifier)) return false;
          if (isTestFile(file) && specifier === "bun:test") return false;
          if (isEffectTestLaneFile(file) && specifier === "@effect/vitest") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("extracted package production Node imports stay on the exact platform inventory", () => {
    const checkedRoots = [
      join(packageRoot, "state", "src"),
      join(packageRoot, "sandbox", "src"),
      join(packageRoot, "pi-adapter", "src"),
      join(packageRoot, "runtime", "src"),
      join(packageRoot, "extensions", "src"),
      join(packageRoot, "desktop", "src"),
      join(packageRoot, "core", "src"),
    ];
    const actual = checkedRoots
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readImports(file)
              .filter((specifier) => specifier.startsWith("node:"))
              .map((specifier) => `${display(file)} -> ${specifier}`),
          ),
      )
      .toSorted();

    expect(actual).toEqual(
      [
        "packages/pi-adapter/src/pi-adapter.ts -> node:path",
        "packages/pi-adapter/src/session.ts -> node:path",
        "packages/sandbox/src/filesystem-sandbox-policy.ts -> node:path",
        "packages/sandbox/src/sandbox-helper.ts -> node:fs",
        "packages/sandbox/src/sandbox-helper.ts -> node:path",
        "packages/state/src/app-log-store.ts -> node:fs",
        "packages/state/src/app-log-store.ts -> node:path",
        "packages/state/src/sandbox-policy-source.ts -> node:path",
        "packages/state/src/structured-session-state.ts -> node:fs",
        "packages/state/src/structured-session-state.ts -> node:os",
        "packages/state/src/structured-session-state.ts -> node:path",
      ].toSorted(),
    );
  });

  it("@svvy/runtime depends only on target runtime dependencies, Effect, local modules, and approved platform modules", () => {
    const allowedPackageImports = new Set([
      "@effect/platform-bun",
      "@svvy/core",
      "@svvy/extensions",
      "@svvy/pi-adapter",
      "@svvy/sandbox",
    ]);
    const allowedNodeImports = new Set<string>();
    const allowedTestNodeImports = new Set(["node:crypto", "node:fs", "node:os", "node:path"]);
    const allowedPrefixes = ["@effect/platform-bun/", "effect/", "./"];
    const violations = listTypeScriptFiles(join(packageRoot, "runtime", "src")).flatMap((file) =>
      readImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (allowedNodeImports.has(specifier)) return false;
          if (isTestFile(file) && allowedTestNodeImports.has(specifier)) return false;
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
          if (isEffectTestLaneFile(file) && specifier === "@effect/vitest") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/desktop depends only on type-only core/state/runtime contracts, local modules, and UI/app edge modules", () => {
    const allowedPackageImports = new Set(["@svvy/core", "@svvy/state", "@svvy/runtime"]);
    const allowedPrefixes = [
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
      readStaticSourceImports(file)
        .filter((specifier) => {
          if (allowedPackageImports.has(specifier)) return false;
          if (isTestFile(file) && specifier === "bun:test") return false;
          if (allowedPrefixes.some((prefix) => specifier.startsWith(prefix))) return false;
          return true;
        })
        .map((specifier) => `${display(file)} -> ${specifier}`),
    );

    expect(violations).toEqual([]);

    const desktopContractSpecifiers = new Set(["@svvy/core", "@svvy/state", "@svvy/runtime"]);
    const contractImportViolations = listTypeScriptFiles(join(packageRoot, "desktop", "src"))
      .flatMap((file) => [
        ...readStaticTypeOnlyImportViolations(file, desktopContractSpecifiers),
        ...readStaticSourceImports(file)
          .filter(
            (specifier) =>
              specifier === "@svvy/runtime/bootstrap" ||
              specifier.startsWith("@svvy/runtime/") ||
              specifier.startsWith("@svvy/state/") ||
              specifier.startsWith("@svvy/core/"),
          )
          .map((specifier) => `${display(file)} -> ${specifier}: forbidden desktop subpath`),
      ])
      .toSorted();

    expect(contractImportViolations).toEqual([]);
  });

  it("@svvy/desktop exposes renderer-safe state facades without lifecycle or catch-all command authority", () => {
    const source = readSource(join(packageRoot, "desktop", "src", "index.ts"));

    expect(source).toContain("type BootstrapStateFacade = ReturnType<typeof createStateFacade>;");
    expect(source).toContain("export interface RendererStateFacade");
    expect(source).toContain('BootstrapStateFacade["readModels"]');
    expect(source).toContain('"fetch" | "refetchInvalidation" | "rebaseline"');
    expect(source).toContain("export interface RendererStateCommandsFacade");
    expect(source).toContain('BootstrapStateCommandsFacade["appLogs"]');
    expect(source).toContain('BootstrapStateCommandsFacade["appPreferences"]');
    expect(source).toContain('BootstrapStateCommandsFacade["providerAuth"]');
    expect(source).toContain(
      'export type DesktopRuntimeActionsFacade = Omit<RuntimeFacade, "events" | "close" | "commands">;',
    );
    expect(source).not.toContain("export type DesktopRuntimeActionsFacade = Pick<");
    expect(source).not.toContain(
      "export type RendererStateFacade = ReturnType<typeof createStateFacade>;",
    );
    expect(source).not.toContain('BootstrapStateFacade["commands"]');
    expect(source).not.toContain('BootstrapStateFacade["close"]');
    expect(source).not.toContain("readonly state: StateCommandsFacade;");
    expect(source).toContain('readonly kind: "read-model-changed";');
    expect(source).toContain('readonly kind: "surface-stream-patch";');
    expect(source).toContain("readonly sequence: RuntimeEventSequence;");
    expect(source).not.toContain("readonly target: RuntimeSurfaceTarget;");
    expect(source).toContain("StateInvalidationDescriptor");
    expect(source).toContain("SurfaceStreamPatchInput");
    expect(source).not.toContain('readonly kind: "runtime-event"');
    expect(source).not.toContain("RuntimeEvent,");
    expect(source).not.toContain("event: RuntimeEvent");
    expect(source).not.toContain("close(): void;");
    expect(source).not.toContain("readonly [group: string]: unknown;");
    expect(source).not.toContain("options?: unknown");
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
    const expected = [
      "packages/pi-adapter/src/pi-adapter.ts -> @mariozechner/pi-ai",
      "packages/pi-adapter/src/pi-adapter.ts -> @mariozechner/pi-coding-agent",
    ];

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

  it("@svvy/pi-adapter public service declaration does not expose pi-native managed session internals", () => {
    const adapterModule = join(packageRoot, "pi-adapter", "src", "pi-adapter.ts");
    const source = readSource(adapterModule);
    const serviceDeclaration = source.match(
      /export interface PiAdapterService \{[\s\S]*?\n\}/,
    )?.[0];

    expect(serviceDeclaration).toBeDefined();
    expect(serviceDeclaration).not.toMatch(
      /\bcreateManagedAgentSession\b|\bCreatePiManagedAgentSession(?:Input|Result)\b/,
    );
  });

  it("@svvy/pi-adapter turn stream queue stays bounded and backpressured", () => {
    const adapterModule = join(packageRoot, "pi-adapter", "src", "pi-adapter.ts");
    const source = readSource(adapterModule);
    const forbiddenConstructors = ["Queue.unbounded", "Queue.dropping", "Queue.sliding"].filter(
      (constructorName) => source.includes(constructorName),
    );

    expect(source).toContain("Queue.bounded<PiRuntimeEvent, PiAdapterError>(256)");
    expect(forbiddenConstructors).toEqual([]);
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

  it("@svvy/core data-only ports use function-syntax Context.Service", () => {
    const coreDataOnlyPorts = [
      { file: "extension-state-ports.ts", names: ["ExtensionStatePort"] },
      {
        file: "extension-snapshot-contracts.ts",
        names: [
          "ExtensionSnapshotStatePort",
          "ExtensionSnapshotSettingsStatePort",
          "ExtensionSnapshotPayloadStorePort",
          "ExtensionSnapshotSecretStorePort",
        ],
      },
      { file: "app-log-contracts.ts", names: ["AppLogWritePort"] },
      { file: "sandbox-policy-contracts.ts", names: ["SandboxPolicySource"] },
      {
        file: "provider-auth-ports.ts",
        names: ["ProviderAuthPort", "ProviderAuthStatusStatePort"],
      },
      { file: "secret-store-ports.ts", names: ["SecretStorePort"] },
      { file: "pi-adapter-ports.ts", names: ["PiSessionReferencePort", "PiRuntimePathsPort"] },
      {
        file: "external-instruction-state-ports.ts",
        names: ["RuntimeExternalInstructionStatePort"],
      },
      {
        file: "runtime-state-ports.ts",
        names: [
          "RuntimeActorExtensionBindingStatePort",
          "RuntimeApprovalStatePort",
          "RuntimeArtifactStatePort",
          "RuntimeComposerDraftStatePort",
          "RuntimeComposerProfileStatePort",
          "RuntimeCommandStatePort",
          "RuntimeEpisodeStatePort",
          "RuntimeExtensionContextImpactStatePort",
          "RuntimeExtensionStatePort",
          "RuntimeGeneratedPackageStatePort",
          "RuntimePromptDefaultsStatePort",
          "RuntimeQueueStatePort",
          "RuntimeReadModelStatePort",
          "RuntimeRecoveryStatePort",
          "RuntimeRequestStatePort",
          "RuntimeSessionWaitStatePort",
          "RuntimeSourceStatePort",
          "RuntimeSurfaceLifecycleStatePort",
          "RuntimeThreadStatePort",
          "RuntimeTranscriptStatePort",
          "RuntimeTurnStatePort",
          "RuntimeWorkflowTaskStatePort",
          "RuntimeWorkspaceStatePort",
        ],
      },
    ];

    for (const { file, names } of coreDataOnlyPorts) {
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
    const expectedRuntimeStatePorts = coreDataOnlyPorts
      .find(({ file }) => file === "runtime-state-ports.ts")!
      .names.toSorted();

    expect(actualRuntimeStatePorts).toEqual(expectedRuntimeStatePorts);
  });

  it("package-local host/config ports use function-syntax Context.Service", () => {
    const packageLocalPorts = [
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
      {
        packageName: "runtime",
        file: "runtime-command-host-ports.ts",
        names: ["RuntimeLayerCommandControlPort", "RuntimeLayerCommandStdinPort"],
      },
      {
        packageName: "runtime",
        file: "runtime-layer-provider-ports.ts",
        names: ["RuntimeLayerModelResolverPort", "RuntimeLayerProviderAuthPort"],
      },
      {
        packageName: "runtime",
        file: "runtime-generated-context-refresh-service.ts",
        names: ["RuntimeGeneratedContextRefreshHostPort"],
      },
      {
        packageName: "runtime",
        file: "runtime-generated-package-refresh-service.ts",
        names: ["RuntimeGeneratedPackageRefreshHostPort"],
      },
      {
        packageName: "runtime",
        file: "runtime-source-invalidation-service.ts",
        names: ["RuntimeSourceInvalidationScanPort"],
      },
    ];

    for (const { packageName, file, names } of packageLocalPorts) {
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
    expect(actual).toEqual(["@svvy/pi-adapter/session"]);
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

  it("production code does not import unadopted Effect SQL or Node platform adapters", () => {
    const scannedRoots = [
      ...sourceRoots,
      appSourceRoot,
      sharedSourceRoot,
      join(projectRoot, "generated"),
    ].filter((root) => existsSync(root));
    const violations = scannedRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readImports(file)
            .filter(
              (specifier) =>
                specifier === "effect/unstable/sql" ||
                specifier.startsWith("effect/unstable/sql/") ||
                specifier === "@effect/platform-node" ||
                specifier.startsWith("@effect/platform-node/") ||
                specifier.startsWith("@effect/sql-sqlite-"),
            )
            .map((specifier) => `${display(file)} -> ${specifier}`),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("extracted packages import only adopted Effect modules", () => {
    const allowedEffectImports = new Set([
      ...adoptedEffectRuntimeModuleExports.map((entry) => entry.module),
      ...adoptedEffectTypeOnlyModules,
    ]);
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isEffectTestLaneFile(file))
        .flatMap((file) =>
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

  it("conditional Effect installed-export canaries are not production import permissions", () => {
    const conditionalEffectModules = new Set(
      auditedEffectInstalledExportPolicies
        .filter((entry) => entry.adoptionState === "conditional")
        .map((entry) => entry.module),
    );
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readImports(file)
            .filter((specifier) => conditionalEffectModules.has(specifier))
            .map((specifier) => `${display(file)} -> ${specifier}`),
        ),
    );

    expect([...conditionalEffectModules].toSorted()).toEqual([
      "effect/Cache",
      "effect/FiberHandle",
      "effect/FiberMap",
      "effect/FiberSet",
      "effect/JsonPatch",
      "effect/Latch",
      "effect/LayerMap",
      "effect/Logger",
      "effect/Metric",
      "effect/Pool",
      "effect/RcMap",
      "effect/RcRef",
      "effect/Request",
      "effect/RequestResolver",
      "effect/Resource",
      "effect/ScopedCache",
      "effect/ScopedRef",
      "effect/SubscriptionRef",
      "effect/SynchronizedRef",
      "effect/Tracer",
      "effect/unstable/process",
    ]);
    expect(violations).toEqual([]);
  });

  it("Bun app production code imports only adopted Effect edge modules", () => {
    const allowedEffectEdgeImports = new Set([
      "effect/Cause",
      "effect/ConfigProvider",
      "effect/Effect",
      "effect/Exit",
      "effect/Redacted",
      "effect/Schema",
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
          .filter((specifier) => {
            if (
              display(file) === "src/bun/extension-lifecycle-authority.ts" &&
              [
                "@effect/platform-bun/BunCrypto",
                "@effect/platform-bun/BunFileSystem",
                "@effect/platform-bun/BunPath",
                "effect/Layer",
              ].includes(specifier)
            ) {
              return false;
            }
            if (
              specifier === "effect/ManagedRuntime" ||
              specifier === "effect/Layer" ||
              specifier === "effect/Scope"
            ) {
              return !["src/bun/app-runtime-bootstrap.ts"].includes(display(file));
            }
            return !allowedEffectEdgeImports.has(specifier);
          })
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
        pattern: /\bContext\.Reference\s*<[\s\S]*?>\s*\(\s*["']([^"']+)["']\s*,/g,
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

  it("Context.Reference declarations use the direct Context namespace form", () => {
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return readValueImportBindings(file, "effect/Context").flatMap((binding) => {
            if (binding.kind === "namespace") {
              const localName = binding.localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              return [
                ...(binding.localName === "Context"
                  ? []
                  : Array.from(
                      source.matchAll(new RegExp(`\\b${localName}\\.Reference\\s*<`, "g")),
                      () => `${display(file)} -> effect/Context Reference namespace alias`,
                    )),
                ...Array.from(
                  source.matchAll(
                    new RegExp(
                      `\\b(?:const|let|var)\\s*\\{[^}]*\\bReference\\b[^}]*\\}\\s*=\\s*${localName}\\b`,
                      "g",
                    ),
                  ),
                  () => `${display(file)} -> effect/Context destructured Reference`,
                ),
                ...Array.from(
                  source.matchAll(
                    new RegExp(`\\b${localName}\\s*\\[\\s*["']Reference["']\\s*\\]`, "g"),
                  ),
                  () => `${display(file)} -> effect/Context bracket Reference`,
                ),
              ];
            }
            return binding.importedName === "Reference" &&
              new RegExp(`\\b${binding.localName}\\s*\\(`).test(source)
              ? [`${display(file)} -> effect/Context Reference named import`]
              : [];
          });
        }),
    );

    expect(violations).toEqual([]);
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
          "packages/state/src/extension-snapshot-state-port.ts -> layerExtensionSnapshotStatePort",
          "packages/state/src/extension-snapshot-settings-state-port.ts -> layerExtensionSnapshotSettingsStatePort",
          "packages/core/src/extension-usage-contracts.ts -> ExtensionUsageStatePort",
          "packages/state/src/extension-usage-state-port.ts -> layerExtensionUsageStatePort",
          "packages/core/src/generated-context-preview-contracts.ts -> GeneratedContextPreviewSubjectStatePort",
          "packages/state/src/generated-context-preview-subject-state-port.ts -> layerGeneratedContextPreviewSubjectStatePort",
          "packages/state/src/pi-session-reference-port.ts -> layerPiSessionReferencePort",
          "packages/state/src/provider-auth-status-state-port.ts -> layerProviderAuthStatusStatePort",
          "packages/state/src/runtime-actor-extension-binding-state-port.ts -> layerRuntimeActorExtensionBindingStatePort",
          "packages/state/src/runtime-approval-state-port.ts -> layerRuntimeApprovalStatePort",
          "packages/state/src/runtime-artifact-state-port.ts -> layerRuntimeArtifactStatePort",
          "packages/state/src/runtime-command-state-port.ts -> layerRuntimeCommandStatePort",
          "packages/state/src/runtime-composer-draft-state-port.ts -> layerRuntimeComposerDraftStatePort",
          "packages/state/src/runtime-composer-profile-state-port.ts -> layerRuntimeComposerProfileStatePort",
          "packages/state/src/runtime-episode-state-port.ts -> layerRuntimeEpisodeStatePort",
          "packages/state/src/runtime-extension-context-impact-state-port.ts -> layerRuntimeExtensionContextImpactStatePort",
          "packages/state/src/runtime-extension-state-port.ts -> layerRuntimeExtensionStatePort",
          "packages/state/src/runtime-external-instruction-state-port.ts -> layerRuntimeExternalInstructionStatePort",
          "packages/state/src/runtime-generated-package-state-port.ts -> layerRuntimeGeneratedPackageStatePort",
          "packages/state/src/runtime-prompt-defaults-state-port.ts -> layerRuntimePromptDefaultsStatePort",
          "packages/state/src/runtime-queue-state-port.ts -> layerRuntimeQueueStatePort",
          "packages/state/src/runtime-read-model-state-port.ts -> layerRuntimeReadModelStatePort",
          "packages/state/src/runtime-recovery-state-port.ts -> layerRuntimeRecoveryStatePort",
          "packages/state/src/runtime-request-state-port.ts -> layerRuntimeRequestStatePort",
          "packages/state/src/runtime-session-wait-state-port.ts -> layerRuntimeSessionWaitStatePort",
          "packages/state/src/runtime-source-state-port.ts -> layerRuntimeSourceStatePort",
          "packages/state/src/runtime-surface-lifecycle-state-port.ts -> layerRuntimeSurfaceLifecycleStatePort",
          "packages/state/src/runtime-thread-state-port.ts -> layerRuntimeThreadStatePort",
          "packages/state/src/runtime-transcript-state-port.ts -> layerRuntimeTranscriptStatePort",
          "packages/state/src/runtime-turn-state-port.ts -> layerRuntimeTurnStatePort",
          "packages/state/src/runtime-workflow-task-state-port.ts -> layerRuntimeWorkflowTaskStatePort",
          "packages/state/src/runtime-workspace-state-port.ts -> layerRuntimeWorkspaceStatePort",
          "packages/state/src/sandbox-policy-source.ts -> layerSandboxPolicySource",
          "packages/state/src/state-facade.ts -> StateCommands",
          "packages/state/src/state-facade.ts -> StateReadModels",
          "packages/state/src/state-facade.ts -> layer",
          "packages/state/src/structured-session-state.ts -> StructuredSessionState",
          "packages/state/src/structured-session-state.ts -> layerStructuredSessionState",
          "packages/state/src/workspace-state-router.ts -> layerWorkspaceStateRouter",
        ],
        resources: [
          "SQLite database handle",
          "Migration and pragma setup",
          "Host secret-store implementation",
          "Artifact durable metadata",
          "State read-model projection rows",
          "State port projection graph",
          "Pi session reference state port",
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
          "Temporary sandbox profile artifact, when file-backed",
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
          "packages/extensions/src/extensions-service.ts -> layer",
          "packages/extensions/src/extension-cli-requirement-probe-port.ts -> ExtensionCliRequirementProbePort",
          "packages/extensions/src/extension-cli-requirement-probe-port.ts -> layerExtensionCliRequirementProbePort",
          "packages/extensions/src/extension-build-process-port.ts -> ExtensionBuildProcessPort",
          "packages/extensions/src/extension-build-process-port.ts -> layerExtensionBuildProcessPort",
          "packages/core/src/extension-snapshot-contracts.ts -> ExtensionSnapshotSecretValuesPort",
        ],
        resources: [
          "Extension source file read/edit session",
          "Scripted instruction generator process/effect",
          "Generated package temporary directory",
          "Generated package root and manifest",
          "CLI requirement probe subprocess",
          "ExtensionCliRequirementProbePort",
          "ExtensionBuildProcessPort",
          "Extension snapshot secret-values host port",
          "Dependency install/update subprocess",
          "Extension reference eligibility cache",
          "Source edit file write/staging",
          "Dependency probe/generator child process",
        ],
      },
      {
        specFile: "runtime.spec.md",
        exports: [
          "packages/runtime/src/index.ts -> Runtime",
          "packages/runtime/src/index.ts -> layer",
          "packages/runtime/src/runtime-approval-wait-service.ts -> RuntimeApprovalWaitService",
          "packages/runtime/src/runtime-approval-wait-service.ts -> layerRuntimeApprovalWaitService",
          "packages/runtime/src/runtime-app-log-commit-notification.ts -> RuntimeAppLogCommitNotification",
          "packages/runtime/src/runtime-app-log-commit-notification.ts -> layerRuntimeAppLogCommitNotification",
          "packages/runtime/src/runtime-committed-state-invalidation-publication.ts -> RuntimeCommittedStateInvalidationPublication",
          "packages/runtime/src/runtime-committed-state-invalidation-publication.ts -> layerRuntimeCommittedStateInvalidationPublication",
          "packages/runtime/src/runtime-effect-requests.ts -> RuntimeExecutionPlanExecutor",
          "packages/runtime/src/runtime-effect-requests.ts -> layerRuntimeExecutionPlanExecutor",
          "packages/runtime/src/runtime-request-input-wait-service.ts -> RuntimeRequestInputWaitService",
          "packages/runtime/src/runtime-request-input-wait-service.ts -> layerRuntimeRequestInputWaitService",
          "packages/runtime/src/runtime-shutdown-admission.ts -> RuntimeShutdownAdmission",
          "packages/runtime/src/runtime-shutdown-admission.ts -> layerRuntimeShutdownAdmission",
          "packages/runtime/src/runtime-prompt-execution-service.ts -> RuntimePromptExecutionService",
          "packages/runtime/src/runtime-prompt-execution-service.ts -> layerRuntimePromptExecutionService",
          "packages/runtime/src/runtime-surface-queue-dispatcher-service.ts -> RuntimeSurfaceQueueDispatcherService",
          "packages/runtime/src/runtime-surface-queue-dispatcher-service.ts -> layerRuntimeSurfaceQueueDispatcherService",
          "packages/runtime/src/runtime-surface-event-publisher.ts -> RuntimeSurfaceEventPublisher",
          "packages/runtime/src/runtime-surface-event-publisher.ts -> layerRuntimeSurfaceEventPublisher",
          "packages/runtime/src/workflow-task-agent-bridge-service.ts -> RuntimeWorkflowTaskAgentBridgeService",
          "packages/runtime/src/workflow-task-agent-bridge-service.ts -> RuntimeWorkflowTaskAgentBridgeBearerVerifier",
          "packages/runtime/src/workflow-task-agent-bridge-service.ts -> layerRuntimeWorkflowTaskAgentBridgeService",
          "packages/runtime/src/runtime-source-invalidation-service.ts -> RuntimeSourceInvalidationScanPort",
          "packages/runtime/src/runtime-source-invalidation-service.ts -> RuntimeExternalInstructionScanInputPort",
          "packages/runtime/src/runtime-extension-build-service.ts -> RuntimeExtensionBuildService",
          "packages/runtime/src/runtime-extension-build-service.ts -> layerRuntimeExtensionBuildService",
          "packages/runtime/src/runtime-extension-lifecycle-service.ts -> RuntimeExtensionLifecycleService",
          "packages/runtime/src/runtime-extension-lifecycle-service.ts -> layerRuntimeExtensionLifecycleService",
          "packages/runtime/src/runtime-extension-snapshot-service.ts -> RuntimeExtensionSnapshotService",
          "packages/runtime/src/runtime-extension-snapshot-service.ts -> layerRuntimeExtensionSnapshotService",
          "packages/runtime/src/runtime-generated-context-binding-service.ts -> RuntimeGeneratedContextBindingService",
          "packages/runtime/src/runtime-generated-context-binding-service.ts -> layerRuntimeGeneratedContextBindingService",
          "packages/runtime/src/runtime-generated-context-preview-service.ts -> RuntimeGeneratedContextPreviewService",
          "packages/runtime/src/runtime-generated-context-preview-service.ts -> layerRuntimeGeneratedContextPreviewService",
          "packages/runtime/src/runtime-source-reconcile-recovery-worker.ts -> RuntimeSourceReconcileRecoveryWorker",
          "packages/runtime/src/runtime-source-reconcile-recovery-worker.ts -> layerRuntimeSourceReconcileRecoveryWorker",
          "packages/runtime/src/runtime-workflow-agent-source-index.ts -> RuntimeWorkflowAgentSourceIndex",
          "packages/runtime/src/runtime-workflow-agent-source-index.ts -> layerRuntimeWorkflowAgentSourceIndex",
          "packages/runtime/src/surface-runtime-scope-service.ts -> RuntimeSurfaceRuntimeService",
          "packages/runtime/src/surface-runtime-scope-service.ts -> RuntimeSurfaceScopeService",
          "packages/runtime/src/surface-runtime-scope-service.ts -> layerRuntimeSurfaceScopeService",
          "packages/runtime/src/workspace-runtime-scope-service.ts -> RuntimeWorkspaceScopeService",
          "packages/runtime/src/workspace-runtime-scope-service.ts -> layerRuntimeWorkspaceScopeService",
          "packages/runtime/src/runtime-layer-config.ts -> layerRuntimeShutdownPreparation",
          "packages/runtime/src/runtime-layer-config.ts -> layerRuntimeStartupReadiness",
          "packages/runtime/src/source-invalidation-coordinator.ts -> RuntimeSourceInvalidationCoordinator",
          "packages/runtime/src/source-invalidation-coordinator.ts -> layerRuntimeSourceInvalidationCoordinator",
        ],
        resources: [
          "Runtime event bus",
          "Extension build service",
          "Extension lifecycle service",
          "Extension snapshot service",
          "Generated-context binding service",
          "Generated-context preview service",
          "Surface stream cursor lane",
          "Workspace runtime scope service",
          "Surface runtime scope service",
          "Workflow task-attempt runtime",
          "Prompt lock",
          "Active turn fiber",
          "Queue dispatcher and wakeup queue",
          "Recovery coordinator",
          "Source reconcile recovery worker",
          "Title worker",
          "Approval wait registry",
          "Request-input wait registry",
          "App-log commit notification service",
          "RuntimeSourceInvalidationScanPort",
          "RuntimeExternalInstructionScanInputPort",
          "Runtime startup readiness barrier",
          "Runtime shutdown admission service",
          "Runtime shutdown preparation service",
          "RuntimeExecutionPlanExecutor",
          "Artifact file materialization lane",
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
      "packages/core/src/extension-snapshot-contracts.ts -> ExtensionSnapshotStatePort",
      "packages/core/src/extension-snapshot-contracts.ts -> ExtensionSnapshotSettingsStatePort",
      "packages/core/src/extension-snapshot-contracts.ts -> ExtensionSnapshotPayloadStorePort",
      "packages/core/src/extension-snapshot-contracts.ts -> ExtensionSnapshotSecretStorePort",
      "packages/core/src/pi-adapter-ports.ts -> PiRuntimePathsPort",
      "packages/core/src/pi-adapter-ports.ts -> PiSessionReferencePort",
      "packages/core/src/provider-auth-ports.ts -> ProviderAuthPort",
      "packages/core/src/provider-auth-ports.ts -> ProviderAuthStatusStatePort",
      "packages/core/src/runtime-state-ports.ts -> StateCommandPostCommitNotificationPort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeActorExtensionBindingStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeApprovalStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeArtifactStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeCommandStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeComposerDraftStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeComposerProfileStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeEpisodeStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeExtensionContextImpactStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeExtensionStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeGeneratedPackageStatePort",
      "packages/core/src/external-instruction-state-ports.ts -> RuntimeExternalInstructionStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimePromptDefaultsStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeQueueStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeReadModelStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeRecoveryStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeRequestStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeSessionWaitStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeSourceStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeSurfaceLifecycleStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeThreadStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeTranscriptStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeTurnStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeWorkflowTaskStatePort",
      "packages/core/src/runtime-state-ports.ts -> RuntimeWorkspaceStatePort",
      "packages/core/src/sandbox-policy-contracts.ts -> SandboxPolicySource",
      "packages/state/src/sandbox-policy-source.ts -> SandboxPolicySourceConfigPort",
      "packages/state/src/sandbox-policy-source.ts -> layerSandboxPolicySourceWithConfig",
      "packages/core/src/secret-store-ports.ts -> SecretStorePort",
      "packages/core/src/secret-store-ports.ts -> SecretStoreMutationPort",
      "packages/runtime/src/bun-platform.ts -> layerRuntimeBunPlatform",
      "packages/runtime/src/runtime-effect-requests.ts -> RuntimeHandlerThreadStartPreparationHost",
      "packages/runtime/src/runtime-effect-requests.ts -> RuntimeQueueInsertPostCommitLane",
      "packages/runtime/src/runtime-layer-config.ts -> RuntimeLayerConfigService",
      "packages/runtime/src/runtime-layer-config.ts -> RuntimeShutdownPreparation",
      "packages/runtime/src/runtime-layer-config.ts -> RuntimeStartupReadiness",
      "packages/runtime/src/runtime-event-bus.ts -> RuntimeEventBus",
      "packages/runtime/src/runtime-event-bus.ts -> layerRuntimeEventBus",
      "packages/runtime/src/runtime-command-host-ports.ts -> RuntimeLayerCommandControlPort",
      "packages/runtime/src/runtime-command-host-ports.ts -> RuntimeLayerCommandStdinPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeGeneratedContextRefreshHostPort",
      "packages/runtime/src/runtime-layer.ts -> RuntimeGeneratedPackageRefreshHostPort",
      "packages/runtime/src/runtime-layer-provider-ports.ts -> RuntimeLayerModelResolverPort",
      "packages/runtime/src/runtime-layer-provider-ports.ts -> RuntimeLayerProviderAuthPort",
      "packages/runtime/src/runtime-queue-wake-port.ts -> RuntimeQueueWakeService",
      "packages/runtime/src/runtime-queue-wake-service.ts -> layerRuntimeQueueWakeService",
      "packages/runtime/src/runtime-prompt-defaults-service.ts -> RuntimePromptDefaultsService",
      "packages/runtime/src/runtime-prompt-defaults-service.ts -> layerRuntimePromptDefaultsService",
      "packages/runtime/src/runtime-launch-policy-service.ts -> RuntimeLaunchPolicyService",
      "packages/runtime/src/runtime-launch-policy-service.ts -> layerRuntimeLaunchPolicyService",
      "packages/runtime/src/runtime-generated-context-refresh-service.ts -> RuntimeGeneratedContextRefreshHostPort",
      "packages/runtime/src/runtime-generated-context-refresh-service.ts -> RuntimeGeneratedContextRefreshService",
      "packages/runtime/src/runtime-generated-context-refresh-service.ts -> layerRuntimeGeneratedContextRefreshService",
      "packages/runtime/src/runtime-generated-package-refresh-service.ts -> RuntimeGeneratedPackageRefreshHostPort",
      "packages/runtime/src/runtime-generated-package-refresh-service.ts -> RuntimeGeneratedPackageRefreshService",
      "packages/runtime/src/runtime-generated-package-refresh-service.ts -> layerRuntimeGeneratedPackageRefreshService",
      "packages/runtime/src/runtime-source-invalidation-service.ts -> RuntimeSourceInvalidationService",
      "packages/runtime/src/runtime-source-invalidation-service.ts -> layerRuntimeSourceInvalidationService",
      "packages/runtime/src/accepted-native-tool-execution-service.ts -> RuntimeAcceptedNativeToolExecution",
      "packages/runtime/src/accepted-native-tool-execution-service.ts -> layerRuntimeAcceptedNativeToolExecution",
      "packages/runtime/src/runtime-message-submission.ts -> RuntimeMessageSubmissionPostCommitLane",
      "packages/runtime/src/runtime-queue-steering.ts -> RuntimeQueueSteeringPostCommitLane",
      "packages/runtime/src/state-command-post-commit-notification.ts -> layerStateCommandPostCommitNotificationPort",
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
        name: "DesktopBridgeErrorContract",
        file: "packages/core/src/desktop-bridge-error-contract.ts",
        schema: "DesktopBridgeErrorContractSchema",
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
      checkCoreIndex: scripts["check:core-index"],
      testUnit: scripts["test:unit"],
      testEffect: scripts["test:effect"],
      effectVitest: devDependencies["@effect/vitest"],
      vitest: devDependencies.vitest,
      packageDevDependencyViolations,
    }).toEqual({
      check:
        "bun run check:core-index && bun run typecheck && bun run test:unit && bun run test:effect && bun run lint:check && bun run format:check && bun run build:check",
      checkCoreIndex: "bun scripts/generate-core-public-symbol-index.ts --check",
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
      ...listPackageRootTypeScriptFiles(),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
      ...listTypeScriptFiles(mainviewSourceRoot),
      ...listTypeScriptFiles(sharedSourceRoot),
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
    const expectedProductionEffectImportModules = new Set<string>([
      ...adoptedEffectRuntimeModuleExports.map((entry) => entry.module),
      ...adoptedEffectTypeOnlyModules,
    ]);
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
    const productionEffectImportModuleViolations = productionEffectFiles
      .flatMap((file) =>
        readImports(file)
          .filter(isEffectPackageSpecifier)
          .filter((moduleSpecifier) => !expectedProductionEffectImportModules.has(moduleSpecifier))
          .map(
            (moduleSpecifier) =>
              `${display(file)} -> ${moduleSpecifier} is imported but unmanifested`,
          ),
      )
      .toSorted();
    const auditedExportModules = auditedEffectInstalledExports
      .map((entry) => entry.module)
      .toSorted();
    const auditedPolicyModules = auditedEffectInstalledExportPolicies
      .map((entry) => entry.module)
      .toSorted();
    const auditedPolicyDuplicateModules = auditedPolicyModules.filter(
      (module, index) => auditedPolicyModules.indexOf(module) !== index,
    );
    const auditedExportMembersByModule = new Map(
      auditedEffectInstalledExports.map((entry) => [entry.module, new Set(entry.members)]),
    );
    const adoptedMembersByModule = new Map(
      adoptedEffectRuntimeModuleExports.map((entry) => [entry.module, new Set(entry.members)]),
    );
    const auditedMemberPolicyKeys = auditedEffectInstalledExportMemberPolicies.map(
      (entry) => `${entry.module}.${entry.member}`,
    );
    const auditedMemberPolicyDuplicateKeys = auditedMemberPolicyKeys.filter(
      (key, index) => auditedMemberPolicyKeys.indexOf(key) !== index,
    );
    const auditedMemberPolicyViolations = auditedEffectInstalledExportMemberPolicies
      .flatMap((entry) => {
        const auditedMembers = auditedExportMembersByModule.get(entry.module);
        const adoptedMembers = adoptedMembersByModule.get(entry.module);
        return [
          ...(auditedMembers?.has(entry.member)
            ? []
            : entry.adoptionState === "adopted-source-gated" && adoptedMembers?.has(entry.member)
              ? []
              : [`${entry.module}.${entry.member} has a member policy but no audited export row`]),
          ...(entry.adoptionState === "adopted-source-gated" && !adoptedMembers?.has(entry.member)
            ? [`${entry.module}.${entry.member} source-gated policy is not production-adopted`]
            : []),
          ...(entry.adoptionState !== "adopted-source-gated" && adoptedMembers?.has(entry.member)
            ? [
                `${entry.module}.${entry.member} is both production-adopted and member-policy ${entry.adoptionState}`,
              ]
            : []),
          ...((entry.adoptionState !== "test-only" &&
            entry.adoptionState !== "adopted-source-gated") ||
          entry.allowedSourceGlobs.length > 0
            ? []
            : [`${entry.module}.${entry.member} member policy has no allowed source globs`]),
        ];
      })
      .toSorted();
    const auditedConditionalMemberPolicies = auditedEffectInstalledExportMemberPolicies.filter(
      (entry) => entry.adoptionState === "conditional",
    );
    const auditedTestOnlyMemberPolicies = auditedEffectInstalledExportMemberPolicies.filter(
      (entry) => entry.adoptionState === "test-only",
    );
    const auditedProductionSourceGatedMemberPolicies =
      auditedEffectInstalledExportMemberPolicies.filter(
        (entry) => entry.adoptionState === "adopted-source-gated",
      );
    const scannedTestFiles = [
      ...sourceRoots.flatMap((root) => listTypeScriptFiles(root)),
      ...listPackageRootTypeScriptTestFiles(),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
      ...listTypeScriptFiles(mainviewSourceRoot),
      ...listTypeScriptFiles(sharedSourceRoot),
    ].filter(isTestFile);
    const conditionalMemberPolicyViolations = scannedTestFiles
      .flatMap((file) =>
        Array.from(readEffectRuntimeMemberReads(file)).flatMap(([moduleSpecifier, members]) =>
          auditedConditionalMemberPolicies
            .filter((entry) => entry.module === moduleSpecifier && members.has(entry.member))
            .map(
              (entry) =>
                `${display(file)} -> ${entry.module}.${entry.member} is conditional audit-only`,
            ),
        ),
      )
      .toSorted();
    const testOnlyMemberPolicyViolations = scannedTestFiles
      .flatMap((file) =>
        Array.from(readEffectRuntimeMemberReads(file)).flatMap(([moduleSpecifier, members]) =>
          auditedTestOnlyMemberPolicies
            .filter((entry) => entry.module === moduleSpecifier && members.has(entry.member))
            .filter(
              (entry) =>
                !entry.allowedSourceGlobs.some((sourceGlob) =>
                  matchesRepositoryGlob(display(file), sourceGlob),
                ),
            )
            .map((entry) => `${display(file)} -> ${entry.module}.${entry.member}`),
        ),
      )
      .toSorted();
    const productionSourceGatedMemberPolicyViolations = productionEffectFiles
      .flatMap((file) =>
        Array.from(readEffectRuntimeMemberReads(file)).flatMap(([moduleSpecifier, members]) =>
          auditedProductionSourceGatedMemberPolicies
            .filter((entry) => entry.module === moduleSpecifier && members.has(entry.member))
            .filter(
              (entry) =>
                !entry.allowedSourceGlobs.some((sourceGlob) =>
                  matchesRepositoryGlob(display(file), sourceGlob),
                ),
            )
            .map((entry) => `${display(file)} -> ${entry.module}.${entry.member}`),
        ),
      )
      .toSorted();

    expect({
      auditExists: existsSync(auditFile),
      manifestImport: readSource(auditFile).includes("./effect-adoption-manifest"),
      auditedExportRows: auditedEffectInstalledExports.length,
      auditedPolicyModulesMatchExports:
        JSON.stringify(auditedPolicyModules) === JSON.stringify(auditedExportModules),
      auditedPolicyDuplicateModules,
      auditPolicyCounts: countAuditPoliciesByState(auditedEffectInstalledExportPolicies),
      auditedMemberPolicyEntries: auditedEffectInstalledExportMemberPolicies.map((entry) => [
        entry.module,
        entry.member,
        entry.adoptionState,
        entry.allowedSourceGlobs,
      ]),
      adoptedInstanceMemberPolicies: adoptedEffectInstanceMemberPolicies.map((entry) => [
        entry.module,
        entry.receiver,
        entry.members,
        entry.allowedSourceGlobs,
      ]),
      auditedMemberPolicyDuplicateKeys,
      auditedMemberPolicyViolations,
      conditionalMemberPolicyViolations,
      testOnlyMemberPolicyViolations,
      productionSourceGatedMemberPolicyViolations,
      inlineAuditArrays: [
        "const adoptedFunctions",
        "const adoptedLayers",
        "const adoptedValues",
      ].filter((pattern) => readSource(auditFile).includes(pattern)),
      productionEffectImportModuleViolations,
      runtimeMemberViolations,
      typeModuleViolations,
    }).toEqual({
      auditExists: true,
      manifestImport: true,
      auditedExportRows: 72,
      auditedPolicyModulesMatchExports: true,
      auditedPolicyDuplicateModules: [],
      auditPolicyCounts: {
        "adoptable-member-gated": 40,
        conditional: 21,
        "scoped-adoptable-member-gated": 8,
        "test-only": 3,
      },
      auditedMemberPolicyEntries: [
        [
          "effect/Effect",
          "scoped",
          "test-only",
          [
            "packages/effect-installed-exports.effect.test.ts",
            "packages/**/*.effect.test.ts",
            "packages/state/src/effect.test-support.ts",
            "packages/state/src/*.test.ts",
          ],
        ],
        [
          "effect/Effect",
          "forkScoped",
          "test-only",
          ["packages/effect-installed-exports.effect.test.ts", "packages/**/*.effect.test.ts"],
        ],
        [
          "effect/Layer",
          "provideMerge",
          "adopted-source-gated",
          [
            "packages/effect-installed-exports.effect.test.ts",
            "packages/**/*.effect.test.ts",
            "packages/state/src/*.test.ts",
            "packages/runtime/src/index.ts",
          ],
        ],
        ["effect/Layer", "withSpan", "conditional", []],
        [
          "effect/Effect",
          "serviceOption",
          "adopted-source-gated",
          [
            "packages/runtime/src/accepted-native-tool-execution-service.ts",
            "packages/runtime/src/runtime-effect-requests.ts",
          ],
        ],
        ["effect/Queue", "fail", "adopted-source-gated", ["packages/pi-adapter/src/pi-adapter.ts"]],
        [
          "effect/Effect",
          "runPromise",
          "adopted-source-gated",
          [
            "packages/runtime/src/source-invalidation-coordinator-adapter.ts",
            "src/bun/extension-lifecycle-authority.ts",
            "src/bun/runtime-service-adapter.ts",
          ],
        ],
        [
          "effect/Effect",
          "runPromiseWith",
          "adopted-source-gated",
          ["packages/pi-adapter/src/pi-adapter.ts"],
        ],
        [
          "effect/Effect",
          "runPromiseExitWith",
          "adopted-source-gated",
          ["packages/pi-adapter/src/pi-adapter.ts"],
        ],
        [
          "effect/Effect",
          "uninterruptible",
          "adopted-source-gated",
          [
            "packages/extensions/src/extension-build-execution.ts",
            "packages/extensions/src/generated-package-writer.ts",
          ],
        ],
        [
          "effect/Effect",
          "onInterrupt",
          "adopted-source-gated",
          ["packages/extensions/src/extension-snapshots.ts"],
        ],
        [
          "effect/Effect",
          "exit",
          "adopted-source-gated",
          ["packages/runtime/src/runtime-shutdown-admission.ts"],
        ],
        [
          "effect/Effect",
          "uninterruptibleMask",
          "adopted-source-gated",
          [
            "packages/runtime/src/runtime-shutdown-admission.ts",
            "packages/runtime/src/runtime-surface-queue-dispatcher-service.ts",
          ],
        ],
        [
          "effect/Redacted",
          "make",
          "adopted-source-gated",
          [
            "src/bun/app-runtime-bootstrap.ts",
            "src/bun/extension-env-secret-store.ts",
            "src/bun/extension-snapshot-storage.ts",
            "src/bun/index.ts",
            "src/bun/session-catalog.ts",
          ],
        ],
        [
          "effect/Redacted",
          "value",
          "adopted-source-gated",
          [
            "packages/pi-adapter/src/pi-adapter.ts",
            "src/bun/app-runtime-bootstrap.ts",
            "src/bun/extension-env-secret-store.ts",
            "src/bun/extension-snapshot-storage.ts",
          ],
        ],
        [
          "effect/SchemaIssue",
          "makeFormatterStandardSchemaV1",
          "adopted-source-gated",
          ["packages/core/src/errors.ts"],
        ],
        [
          "effect/Fiber",
          "interrupt",
          "adopted-source-gated",
          [
            "packages/**/*.effect.test.ts",
            "packages/runtime/src/runtime-surface-queue-dispatcher-service.ts",
            "packages/runtime/src/surface-runtime-scope-service.ts",
          ],
        ],
        [
          "effect/Fiber",
          "join",
          "adopted-source-gated",
          [
            "packages/**/*.effect.test.ts",
            "packages/runtime/src/runtime-surface-queue-dispatcher-service.ts",
            "packages/runtime/src/surface-runtime-scope-service.ts",
          ],
        ],
        [
          "effect/Schema",
          "encodeSync",
          "test-only",
          [
            "packages/core/src/core-module-boundaries.test.ts",
            "packages/core/src/provider-auth-ports.effect.test.ts",
          ],
        ],
        [
          "effect/Schema",
          "toCodecJson",
          "test-only",
          [
            "packages/core/src/core-module-boundaries.test.ts",
            "packages/core/src/provider-auth-ports.effect.test.ts",
          ],
        ],
        [
          "effect/Stream",
          "empty",
          "test-only",
          ["packages/**/*.effect.test.ts", "packages/runtime/src/runtime-facade.test.ts"],
        ],
        [
          "effect/Stream",
          "make",
          "test-only",
          ["packages/**/*.effect.test.ts", "packages/runtime/src/runtime-facade.test.ts"],
        ],
        [
          "effect/Stream",
          "never",
          "test-only",
          ["packages/**/*.effect.test.ts", "packages/runtime/src/runtime-facade.test.ts"],
        ],
        [
          "effect/Stream",
          "runCollect",
          "test-only",
          ["packages/**/*.effect.test.ts", "packages/runtime/src/runtime-facade.test.ts"],
        ],
        [
          "effect/Stream",
          "take",
          "test-only",
          ["packages/**/*.effect.test.ts", "packages/runtime/src/runtime-facade.test.ts"],
        ],
      ],
      adoptedInstanceMemberPolicies: [
        [
          "effect/ManagedRuntime",
          "ManagedRuntime.ManagedRuntime",
          ["context", "dispose", "runPromise"],
          ["src/bun/app-runtime-bootstrap.ts"],
        ],
        [
          "effect/ManagedRuntime",
          "ManagedRuntime.ManagedRuntime",
          ["runPromise", "runPromiseExit"],
          ["packages/runtime/src/runtime-layer-config.ts"],
        ],
        [
          "effect/ManagedRuntime",
          "ManagedRuntime.ManagedRuntime",
          ["runPromiseExit"],
          ["packages/runtime/src/index.ts"],
        ],
        [
          "effect/ManagedRuntime",
          "ManagedRuntime.ManagedRuntime",
          ["runPromise"],
          ["packages/runtime/src/accepted-native-tool-execution.ts"],
        ],
        [
          "effect/ManagedRuntime",
          "ManagedRuntime.ManagedRuntime",
          ["runPromise"],
          ["packages/runtime/src/app-log-commit-notification-adapter.ts"],
        ],
        [
          "effect/ManagedRuntime",
          "ManagedRuntime.ManagedRuntime",
          ["runPromise"],
          ["packages/runtime/src/committed-state-invalidation-adapter.ts"],
        ],
        [
          "effect/ManagedRuntime",
          "ManagedRuntime.ManagedRuntime",
          ["runPromiseExit"],
          ["packages/state/src/state-facade.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["access", "exists", "readFile", "realPath", "stat"],
          ["packages/sandbox/src/sandbox.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["exists", "readFileString", "realPath", "stat"],
          ["packages/extensions/src/external-instructions.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          [
            "exists",
            "makeDirectory",
            "readDirectory",
            "readFile",
            "readFileString",
            "readLink",
            "remove",
            "rename",
            "stat",
            "writeFile",
            "writeFileString",
          ],
          ["packages/extensions/src/extension-source-management.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["exists", "readDirectory", "readFileString", "stat"],
          ["packages/extensions/src/extension-registry-observation.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["exists", "readFile", "readFileString", "stat"],
          ["packages/extensions/src/extension-build-observation.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          [
            "exists",
            "makeDirectory",
            "readFile",
            "remove",
            "rename",
            "writeFile",
            "writeFileString",
          ],
          ["packages/extensions/src/extension-build-execution.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["exists", "readDirectory", "readFile", "stat"],
          ["packages/extensions/src/extension-source-fingerprint.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          [
            "exists",
            "makeDirectory",
            "readDirectory",
            "readFile",
            "readLink",
            "realPath",
            "remove",
            "rename",
            "stat",
          ],
          ["packages/extensions/src/extension-snapshots.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          [
            "exists",
            "makeDirectory",
            "readDirectory",
            "readFileString",
            "readLink",
            "remove",
            "rename",
            "stat",
            "writeFileString",
          ],
          ["packages/extensions/src/extension-source-lifecycle.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["remove"],
          ["packages/pi-adapter/src/pi-adapter.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          [
            "exists",
            "link",
            "makeDirectory",
            "readFileString",
            "remove",
            "rename",
            "stat",
            "writeFileString",
          ],
          ["packages/extensions/src/source-edit-sessions.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["exists", "makeDirectory", "readDirectory", "readFileString", "stat", "writeFileString"],
          ["packages/extensions/src/workflow-agent-source-records.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["exists", "makeDirectory", "makeTempDirectory", "remove", "rename", "writeFileString"],
          ["packages/extensions/src/generated-package-writer.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["readDirectory", "readFileString", "stat"],
          ["packages/extensions/src/generated-extensions-package.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["readDirectory", "readFileString", "stat"],
          ["packages/extensions/src/generated-workflows-package.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["makeDirectory"],
          ["packages/state/src/state-facade.ts"],
        ],
        [
          "effect/FileSystem",
          "FileSystem.FileSystem",
          ["makeDirectory"],
          ["packages/state/src/app-log-store.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname", "isAbsolute", "join", "normalize", "relative", "resolve"],
          ["packages/sandbox/src/sandbox.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname", "isAbsolute", "parse", "relative", "resolve", "sep"],
          ["packages/extensions/src/external-instructions.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname", "join", "resolve"],
          ["packages/extensions/src/extension-source-management.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname", "resolve", "sep"],
          ["packages/extensions/src/extension-registry-observation.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["resolve", "sep"],
          ["packages/extensions/src/extension-build-observation.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname", "resolve", "sep"],
          ["packages/extensions/src/extension-build-execution.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname", "resolve", "sep"],
          ["packages/extensions/src/extension-source-fingerprint.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname", "isAbsolute", "join", "relative", "resolve"],
          ["packages/extensions/src/extension-snapshots.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname", "join", "resolve"],
          ["packages/extensions/src/extension-source-lifecycle.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["basename", "dirname", "join", "resolve"],
          ["packages/extensions/src/source-edit-sessions.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["join", "resolve"],
          ["packages/extensions/src/workflow-agent-source-records.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["basename", "dirname", "join"],
          ["packages/extensions/src/generated-package-writer.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["join"],
          ["packages/extensions/src/generated-extensions-package.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["join", "relative"],
          ["packages/extensions/src/generated-workflows-package.ts"],
        ],
        [
          "effect/Path",
          "Path.Path",
          ["dirname"],
          ["packages/extensions/src/extensions-service.ts"],
        ],
        ["effect/Path", "Path.Path", ["dirname"], ["packages/state/src/state-facade.ts"]],
        ["effect/Path", "Path.Path", ["dirname"], ["packages/state/src/app-log-store.ts"]],
        ["effect/Crypto", "Crypto.Crypto", ["digest"], ["packages/sandbox/src/sandbox.ts"]],
        [
          "effect/Crypto",
          "Crypto.Crypto",
          ["digest"],
          [
            "packages/extensions/src/extension-build-observation.ts",
            "packages/extensions/src/extension-build-execution.ts",
            "packages/extensions/src/extension-registry-observation.ts",
            "packages/extensions/src/extension-snapshots.ts",
            "packages/extensions/src/extension-source-fingerprint.ts",
            "packages/extensions/src/extension-source-lifecycle.ts",
            "packages/extensions/src/external-instructions.ts",
            "packages/extensions/src/generated-context.ts",
            "packages/runtime/src/runtime-extension-snapshot-service.ts",
          ],
        ],
        [
          "effect/Crypto",
          "Crypto.Crypto",
          ["randomBytes"],
          [
            "packages/extensions/src/extension-build-execution.ts",
            "packages/extensions/src/extension-source-lifecycle.ts",
            "packages/runtime/src/runtime-extension-build-service.ts",
          ],
        ],
        [
          "effect/Crypto",
          "Crypto.Crypto",
          ["randomUUIDv4"],
          [
            "packages/extensions/src/extension-source-lifecycle.ts",
            "packages/extensions/src/extension-source-management.ts",
          ],
        ],
        [
          "effect/Crypto",
          "Crypto.Crypto",
          ["digest", "randomUUIDv4"],
          ["packages/extensions/src/source-edit-sessions.ts"],
        ],
        [
          "effect/Crypto",
          "Crypto.Crypto",
          ["randomUUIDv4"],
          ["packages/runtime/src/runtime-source-reconcile-recovery-worker.ts"],
        ],
        [
          "effect/Crypto",
          "Crypto.Crypto",
          ["digest"],
          ["packages/extensions/src/workflow-agent-source-records.ts"],
        ],
        [
          "effect/Crypto",
          "Crypto.Crypto",
          ["digest"],
          ["packages/runtime/src/runtime-workflow-agent-source-index.ts"],
        ],
        [
          "effect/Semaphore",
          "Semaphore.Semaphore",
          ["withPermit"],
          [
            "packages/runtime/src/runtime-event-bus.ts",
            "packages/runtime/src/runtime-extension-build-service.ts",
            "packages/runtime/src/runtime-extension-lifecycle-service.ts",
            "packages/runtime/src/runtime-extension-snapshot-service.ts",
            "packages/runtime/src/runtime-shutdown-admission.ts",
            "packages/runtime/src/runtime-surface-event-publisher.ts",
            "packages/runtime/src/surface-runtime-scope-service.ts",
          ],
        ],
      ],
      auditedMemberPolicyDuplicateKeys: [],
      auditedMemberPolicyViolations: [],
      conditionalMemberPolicyViolations: [],
      testOnlyMemberPolicyViolations: [],
      productionSourceGatedMemberPolicyViolations: [],
      inlineAuditArrays: [],
      productionEffectImportModuleViolations: [],
      runtimeMemberViolations: [],
      typeModuleViolations: [],
    });
  });

  it("production code does not bypass Effect installed-export auditing with namespace destructuring or bracket reads", () => {
    const productionEffectFiles = [
      ...sourceRoots.flatMap((root) => listTypeScriptFiles(root)),
      ...listPackageRootTypeScriptFiles(),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
      ...listTypeScriptFiles(mainviewSourceRoot),
      ...listTypeScriptFiles(sharedSourceRoot),
    ].filter((file) => !isTestFile(file) && basename(file) !== "effect.test-support.ts");
    const violations = productionEffectFiles.flatMap((file) => {
      const source = readSource(file);
      return readImports(file)
        .filter(isEffectPackageSpecifier)
        .flatMap((specifier) =>
          readValueImportBindings(file, specifier)
            .filter((binding) => binding.kind === "namespace")
            .flatMap((binding) => {
              const localName = binding.localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const namespaceDestructurePattern = new RegExp(
                `\\b(?:const|let|var)\\s*\\{[\\s\\S]*?\\}\\s*=\\s*${localName}\\b`,
                "g",
              );
              const bracketReadPattern = new RegExp(`\\b${localName}\\s*\\[`, "g");
              return [
                ...Array.from(
                  source.matchAll(namespaceDestructurePattern),
                  () => `${display(file)} -> ${specifier}: namespace destructuring`,
                ),
                ...Array.from(
                  source.matchAll(bracketReadPattern),
                  () => `${display(file)} -> ${specifier}: bracket member read`,
                ),
              ];
            }),
        );
    });

    expect(violations).toEqual([]);
  });

  it("source-gated Effect members stay on their exact production seams", () => {
    const productionEffectFiles = [
      ...sourceRoots.flatMap((root) => listTypeScriptFiles(root)),
      ...listPackageRootTypeScriptFiles(),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
      ...listTypeScriptFiles(mainviewSourceRoot),
      ...listTypeScriptFiles(sharedSourceRoot),
    ].filter((file) => !isTestFile(file) && basename(file) !== "effect.test-support.ts");

    const serviceOptionCalls = productionEffectFiles
      .flatMap((file) =>
        Array.from(
          readSource(file).matchAll(/\bEffect\.serviceOption\s*\(\s*([A-Za-z_$][\w$]*)/g),
          (match) => `${display(file)} -> ${match[1]}`,
        ),
      )
      .toSorted();
    const queueFailCalls = productionEffectFiles
      .flatMap((file) =>
        Array.from(readSource(file).matchAll(/\bQueue\.fail\s*\(/g), () => display(file)),
      )
      .toSorted();
    const queueFailCauseCalls = productionEffectFiles
      .flatMap((file) =>
        Array.from(readSource(file).matchAll(/\bQueue\.failCause\s*\(/g), () => display(file)),
      )
      .toSorted();
    const redactedMakeCalls = productionEffectFiles
      .flatMap((file) =>
        Array.from(readSource(file).matchAll(/\bRedacted\.make\s*\(/g), () => display(file)),
      )
      .toSorted();
    const redactedValueCalls = productionEffectFiles
      .flatMap((file) =>
        Array.from(readSource(file).matchAll(/\bRedacted\.value\s*\(/g), () => display(file)),
      )
      .toSorted();
    const schemaIssueFormatterCalls = productionEffectFiles
      .flatMap((file) =>
        Array.from(
          readSource(file).matchAll(/\bSchemaIssue\.makeFormatterStandardSchemaV1\s*\(/g),
          () => display(file),
        ),
      )
      .toSorted();

    expect({
      serviceOptionCalls,
      queueFailCalls,
      queueFailCauseCalls,
      redactedMakeCalls,
      redactedValueCalls,
      schemaIssueFormatterCalls,
    }).toEqual({
      serviceOptionCalls: [
        "packages/runtime/src/accepted-native-tool-execution-service.ts -> RuntimeHandlerThreadStartPreparationHost",
        "packages/runtime/src/accepted-native-tool-execution-service.ts -> RuntimeQueueWakeService",
        "packages/runtime/src/runtime-effect-requests.ts -> RuntimeHandlerThreadStartPreparationHost",
      ],
      queueFailCalls: [
        "packages/pi-adapter/src/pi-adapter.ts",
        "packages/pi-adapter/src/pi-adapter.ts",
      ],
      queueFailCauseCalls: [],
      redactedMakeCalls: [
        "src/bun/app-runtime-bootstrap.ts",
        "src/bun/app-runtime-bootstrap.ts",
        "src/bun/app-runtime-bootstrap.ts",
        "src/bun/app-runtime-bootstrap.ts",
        "src/bun/extension-env-secret-store.ts",
        "src/bun/extension-snapshot-storage.ts",
        "src/bun/index.ts",
        "src/bun/session-catalog.ts",
      ],
      redactedValueCalls: [
        "packages/pi-adapter/src/pi-adapter.ts",
        "packages/pi-adapter/src/pi-adapter.ts",
        "src/bun/app-runtime-bootstrap.ts",
        "src/bun/app-runtime-bootstrap.ts",
        "src/bun/extension-env-secret-store.ts",
        "src/bun/extension-snapshot-storage.ts",
      ],
      schemaIssueFormatterCalls: ["packages/core/src/errors.ts"],
    });
  });

  it("production metric construction stays in package metric catalog modules", () => {
    const metricConstructionPattern = /\bMetric\.(?:counter|timer|histogram|withAttributes)\s*\(/;
    const allowedMetricFiles = (file: string) => {
      const fileName = basename(file);
      const normalized = display(file);
      return (
        fileName === "metrics.ts" ||
        normalized.includes("/diagnostics/") ||
        normalized.includes("/exporters/")
      );
    };
    const productionFiles = [
      ...sourceRoots.flatMap((root) => listTypeScriptFiles(root)),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
    ].filter((file) => !isTestFile(file));
    const violations = productionFiles
      .filter((file) => !allowedMetricFiles(file))
      .filter((file) => metricConstructionPattern.test(readSource(file)))
      .map(display)
      .toSorted();

    expect(violations).toEqual([]);
  });

  it("extracted package production code reads host process facts only through explicit host zones", () => {
    const allowedHostReadFiles = new Set(
      listTypeScriptFiles(join(packageRoot, "extensions", "src", "builtin"))
        .filter((file) => display(file).includes("/scripts/"))
        .map(display),
    );
    const hostReadPattern =
      /\bprocess\s*\.\s*(?:platform|arch|env|argv|cwd|chdir|exit|execPath)\b|\bBun\s*\.\s*argv\b|\bimport\s*\.\s*meta\s*\.\s*main\b|\b(?:hostname|os\.hostname)\s*\(/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => !allowedHostReadFiles.has(display(file)))
        .filter((file) => hostReadPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("extracted package production code does not use console fallbacks", () => {
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => /\bconsole\.(?:debug|log|info|warn|error)\s*\(/.test(readSource(file)))
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

  it("production source watching does not adopt Effect WatchBackend or Stream callback APIs", () => {
    const checkedFiles = [
      ...sourceRoots.flatMap((root) => listTypeScriptFiles(root)),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
    ].filter((file) => !isTestFile(file));
    const forbiddenPatterns = [
      { pattern: /\bFileSystem\.WatchBackend\b/, name: "FileSystem.WatchBackend" },
      { pattern: /\bFileSystem\.watch\s*\(/, name: "FileSystem.watch" },
      { pattern: /\bStream\.callback\s*\(/, name: "Stream.callback" },
    ];
    const violations = checkedFiles.flatMap((file) => {
      const source = readSource(file);
      return forbiddenPatterns
        .filter(({ pattern }) => pattern.test(source))
        .map(({ name }) => `${display(file)} -> ${name}`);
    });

    expect(violations).toEqual([]);
  });

  it("extracted package production code does not create or run Effect runtimes outside facade and bootstrap boundaries", () => {
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
      { pattern: /\bScope\.provide\b/, name: "Scope.provide" },
      { pattern: /\bScope\.use\b/, name: "Scope.use" },
      { pattern: /\bEffect\.forkDaemon\b/, name: "Effect.forkDaemon" },
      { pattern: /\bEffect\.forkAll\b/, name: "Effect.forkAll" },
      { pattern: /\bEffect\.forkWithErrorHandler\b/, name: "Effect.forkWithErrorHandler" },
      { pattern: /\bLayer\.fromBuild\b/, name: "Layer.fromBuild" },
      { pattern: /\bLayer\.fromBuildMemo\b/, name: "Layer.fromBuildMemo" },
      { pattern: /\bLayer\.buildWithMemoMap\b/, name: "Layer.buildWithMemoMap" },
      { pattern: /\bLayer\.forkMemoMapUnsafe\b/, name: "Layer.forkMemoMapUnsafe" },
      { pattern: /\bLayer\.effectDiscard\b/, name: "Layer.effectDiscard" },
      { pattern: /\bLayer\.effectContext\b/, name: "Layer.effectContext" },
      { pattern: /\bLayer\.buildWithScope\b/, name: "Layer.buildWithScope" },
      { pattern: /\bLayer\.unwrap\b/, name: "Layer.unwrap" },
      { pattern: /\bLayer\.suspend\b/, name: "Layer.suspend" },
      { pattern: /\bLayer\.fresh\b/, name: "Layer.fresh" },
      { pattern: /\bLayer\.makeMemoMapUnsafe\b/, name: "Layer.makeMemoMapUnsafe" },
      {
        pattern: /\bEffect\.provide\s*\([\s\S]*?\{\s*local\s*:\s*true\s*\}/,
        name: "Effect.provide local true",
      },
      {
        pattern: /\b(?!Scope\b)[A-Z][A-Za-z0-9_]*\.use(?:Sync)?\s*\(/,
        name: "Service.use/useSync",
      },
    ];
    const violations = sourceRoots
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) => {
            const source = readSource(file);
            return bannedSourcePatterns
              .filter(({ pattern }) => pattern.test(source))
              .map(({ name }) => `${display(file)} -> ${name}`);
          }),
      )
      .filter(
        (violation) =>
          ![
            "packages/pi-adapter/src/pi-adapter.ts -> Effect.runPromiseWith",
            "packages/pi-adapter/src/pi-adapter.ts -> Effect.runPromiseExitWith",
            "packages/runtime/src/source-invalidation-coordinator-adapter.ts -> Effect.runPromise",
          ].includes(violation),
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
    expect(runtimeFacadeSource).toContain("const activeFacadeCalls = new Set");
    expect(runtimeFacadeSource).toContain('signal.addEventListener("abort", onAbort');
    expect(runtimeFacadeSource).toContain("signal.removeEventListener");
    expect(runtimeFacadeSource).not.toContain(
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
              return [
                ...(new RegExp(`\\b${binding.localName}\\.make\\b`).test(source)
                  ? [`${display(file)} -> effect/ManagedRuntime make`]
                  : []),
                ...(new RegExp(
                  `\\b(?:const|let|var)\\s*\\{[^}]*\\bmake\\b[^}]*\\}\\s*=\\s*${binding.localName}\\b`,
                ).test(source)
                  ? [`${display(file)} -> effect/ManagedRuntime destructured make`]
                  : []),
                ...(new RegExp(`\\b${binding.localName}\\s*\\[\\s*["']make["']\\s*\\]`).test(source)
                  ? [`${display(file)} -> effect/ManagedRuntime bracket make`]
                  : []),
              ];
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
          return [
            ...effectViolations,
            ...managedRuntimeViolations,
            ...destructuringViolations,
          ].filter(
            (violation) =>
              ![
                "packages/pi-adapter/src/pi-adapter.ts -> effect/Effect runPromiseWith",
                "packages/pi-adapter/src/pi-adapter.ts -> effect/Effect runPromiseExitWith",
                "packages/runtime/src/source-invalidation-coordinator-adapter.ts -> effect/Effect runPromise",
              ].includes(violation),
          );
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

  it("extracted package tests do not create manual Effect runtimes except explicit facade and bootstrap cases", () => {
    const allowedManualRuntimeReads = new Map<string, string[]>([
      [
        "packages/runtime/src/runtime-layer-config.bootstrap.integration.test.ts",
        ["ManagedRuntime.make", "ManagedRuntime.make", "ManagedRuntime.make"],
      ],
      [
        "packages/runtime/src/committed-state-invalidation-adapter.effect.test.ts",
        ["ManagedRuntime.make", "ManagedRuntime.make"],
      ],
      ["packages/runtime/src/runtime-facade.test.ts", ["ManagedRuntime.make"]],
      [
        "packages/state/src/state-facade.test.ts",
        [
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
          "ManagedRuntime.make",
        ],
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
              return [
                ...(binding.localName === "ManagedRuntime"
                  ? []
                  : Array.from(
                      source.matchAll(new RegExp(`\\b${binding.localName}\\.make\\b`, "g")),
                      () => `${display(file)} -> ManagedRuntime.make`,
                    )),
                ...Array.from(
                  source.matchAll(
                    new RegExp(
                      `\\b(?:const|let|var)\\s*\\{[^}]*\\bmake\\b[^}]*\\}\\s*=\\s*${binding.localName}\\b`,
                      "g",
                    ),
                  ),
                  () => `${display(file)} -> ManagedRuntime.make`,
                ),
                ...Array.from(
                  source.matchAll(
                    new RegExp(`\\b${binding.localName}\\s*\\[\\s*["']make["']\\s*\\]`, "g"),
                  ),
                  () => `${display(file)} -> ManagedRuntime.make`,
                ),
              ];
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
    const actualCounts = countEntries(actual);
    const allowedCounts = countEntries(allowed);
    const violations = Object.entries(actualCounts)
      .filter(([entry, count]) => count > (allowedCounts[entry] ?? 0))
      .map(([entry, count]) => `${entry} x${count}`);
    const missingAllowed = Object.entries(allowedCounts)
      .filter(([entry, count]) => (actualCounts[entry] ?? 0) < count)
      .map(([entry, count]) => `${entry} x${count}`);

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

  it("Effect test lane files use the Effect test runtime", () => {
    const violations = [packageRoot, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter(isEffectTestLaneFile)
        .flatMap((file) => {
          const imports = readImports(file);
          return [
            ...(!imports.includes("@effect/vitest")
              ? [`${display(file)} does not import @effect/vitest`]
              : []),
            ...(imports.includes("bun:test") ? [`${display(file)} imports bun:test`] : []),
          ];
        }),
    );

    expect(violations).toEqual([]);
  });

  it("non-state Bun-lane package tests do not exercise Effect service or layer APIs", () => {
    const stateSourceRoot = join(packageRoot, "state", "src");
    const stateProductionFiles = listTypeScriptFiles(stateSourceRoot).filter(
      (file) => !isTestFile(file),
    );
    const stateRootBarrel = join(stateSourceRoot, "index.ts");
    const sqliteBackedStateRoots = new Set([
      join(stateSourceRoot, "app-log-store.ts"),
      join(stateSourceRoot, "structured-session-state.ts"),
    ]);
    const sqliteBackedFileCache = new Map<string, boolean>();
    const importsBunSqlite = (file: string, visiting = new Set<string>()): boolean => {
      if (sqliteBackedStateRoots.has(file)) return true;
      const cached = sqliteBackedFileCache.get(file);
      if (cached !== undefined) return cached;
      if (visiting.has(file)) return false;
      visiting.add(file);

      const imports = readStaticSourceImports(file);
      const importsSqlite =
        imports.includes("bun:sqlite") ||
        imports.some((specifier) => {
          const resolved = resolveStateSourceImport(file, specifier);
          return (
            resolved !== null &&
            resolved !== stateRootBarrel &&
            stateProductionFiles.includes(resolved) &&
            importsBunSqlite(resolved, visiting)
          );
        });

      visiting.delete(file);
      sqliteBackedFileCache.set(file, importsSqlite);
      return importsSqlite;
    };
    const importsSqliteBackedState = (file: string): boolean => {
      const imports = readStaticSourceImports(file);
      return (
        imports.includes("bun:sqlite") ||
        imports.some((specifier) => {
          const resolved = resolveStateSourceImport(file, specifier);
          return (
            resolved !== null &&
            resolved !== stateRootBarrel &&
            stateProductionFiles.includes(resolved) &&
            importsBunSqlite(resolved)
          );
        })
      );
    };
    const allowedStateBunLaneEffectFiles = new Set(
      listTypeScriptFiles(stateSourceRoot)
        .filter(isTestFile)
        .filter((file) => !isEffectTestLaneFile(file))
        .filter(importsSqliteBackedState),
    );
    const allowedFacadeAndBootstrapHarnessFiles = new Set([
      join(packageRoot, "runtime", "src", "runtime-facade.test.ts"),
      join(packageRoot, "runtime", "src", "runtime-layer-config.bootstrap.integration.test.ts"),
      join(packageRoot, "state", "src", "state-facade.test.ts"),
    ]);
    const serviceLayerPatterns = [
      { pattern: /\bEffect\.provide\s*\(/, name: "Effect.provide" },
      {
        pattern: /\bLayer\.(?:succeed|effect|merge|mergeAll|provide|provideMerge)\b/,
        name: "Layer service fixture",
      },
      { pattern: /\bit\.effect\b/, name: "it.effect" },
    ];
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter(isTestFile)
        .filter((file) => !isEffectTestLaneFile(file))
        .filter((file) => !allowedStateBunLaneEffectFiles.has(file))
        .filter((file) => !allowedFacadeAndBootstrapHarnessFiles.has(file))
        .flatMap((file) => {
          const source = readSource(file);
          const imports = readImports(file);
          return [
            ...(imports.includes("effect/Layer") ? [`${display(file)} -> effect/Layer`] : []),
            ...(imports.includes("effect/testing") ? [`${display(file)} -> effect/testing`] : []),
            ...serviceLayerPatterns
              .filter(({ pattern }) => pattern.test(source))
              .map(({ name }) => `${display(file)} -> ${name}`),
          ];
        }),
    );

    expect(violations).toEqual([]);
  });

  it("Effect test lane imports only the approved @effect/vitest helpers", () => {
    const allowedVitestHelpers = new Set(["assert", "describe", "it", "layer"]);
    const violations = [packageRoot, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter(isEffectTestLaneFile)
        .flatMap((file) => {
          const source = readFileSync(file, "utf8");
          const sourceFile = ts.createSourceFile(
            file,
            source,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
          );
          return sourceFile.statements.flatMap((statement) => {
            if (
              !ts.isImportDeclaration(statement) ||
              !ts.isStringLiteral(statement.moduleSpecifier) ||
              statement.moduleSpecifier.text !== "@effect/vitest"
            ) {
              return [];
            }
            const importClause = statement.importClause;
            if (!importClause) {
              return [`${display(file)} -> side-effect import`];
            }
            if (importClause.name) {
              return [`${display(file)} -> default import`];
            }
            const namedBindings = importClause.namedBindings;
            if (!namedBindings) {
              return [`${display(file)} -> missing named imports`];
            }
            if (ts.isNamespaceImport(namedBindings)) {
              return [`${display(file)} -> namespace import`];
            }
            return namedBindings.elements
              .map((element) => element.propertyName?.text ?? element.name.text)
              .filter((name) => !allowedVitestHelpers.has(name))
              .map((name) => `${display(file)} -> ${name}`);
          });
        }),
    );

    expect(violations).toEqual([]);
  });

  it("Effect testing services stay confined to the Effect test lane", () => {
    const violations = [...sourceRoots, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) =>
          readImports(file).some(
            (specifier) =>
              specifier === "effect/testing" || specifier.startsWith("effect/testing/"),
          ),
        )
        .filter((file) => !isEffectTestLaneFile(file))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("Effect test lane files do not import Bun-only SQLite modules", () => {
    const stateSourceRoot = join(packageRoot, "state", "src");
    const stateProductionFiles = listTypeScriptFiles(stateSourceRoot).filter(
      (file) => !isTestFile(file),
    );
    const stateRootBarrel = join(stateSourceRoot, "index.ts");
    const sqliteBackedStateRoots = new Set([
      join(stateSourceRoot, "app-log-store.ts"),
      join(stateSourceRoot, "structured-session-state.ts"),
    ]);
    const sqliteBackedFileCache = new Map<string, boolean>();

    const importsBunSqlite = (file: string, visiting = new Set<string>()): boolean => {
      if (sqliteBackedStateRoots.has(file)) return true;
      const cached = sqliteBackedFileCache.get(file);
      if (cached !== undefined) return cached;
      if (visiting.has(file)) return false;
      visiting.add(file);

      const imports = readStaticSourceImports(file);
      const importsSqlite =
        imports.includes("bun:sqlite") ||
        imports.some((specifier) => {
          const resolved = resolveStateSourceImport(file, specifier);
          return (
            resolved !== null &&
            resolved !== stateRootBarrel &&
            stateProductionFiles.includes(resolved) &&
            importsBunSqlite(resolved, visiting)
          );
        });

      visiting.delete(file);
      sqliteBackedFileCache.set(file, importsSqlite);
      return importsSqlite;
    };

    const sqliteBackedFiles = new Set(
      stateProductionFiles.filter((file) => importsBunSqlite(file)),
    );
    const violations = [packageRoot, appSourceRoot].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter(isEffectTestLaneFile)
        .flatMap((file) => {
          return readStaticSourceImports(file)
            .flatMap((specifier) => {
              if (specifier === "bun:sqlite") return [{ specifier, resolved: "bun:sqlite" }];
              const resolved = resolveStateSourceImport(file, specifier);
              return resolved !== null && sqliteBackedFiles.has(resolved)
                ? [{ specifier, resolved: display(resolved) }]
                : [];
            })
            .map(({ specifier, resolved }) => `${display(file)} -> ${specifier} -> ${resolved}`);
        }),
    );

    expect(violations).toEqual([]);
  });

  it("@svvy/pi-adapter keeps Effect runner tests in the Effect test lane", () => {
    const violations = listTypeScriptFiles(join(packageRoot, "pi-adapter", "src"))
      .filter(isTestFile)
      .flatMap((file) => {
        const imports = readImports(file);
        const source = readSource(file);
        const isEffectLane = isEffectTestLaneFile(file);

        return [
          ...(isEffectLane && imports.includes("bun:test") ? [`${display(file)} -> bun:test`] : []),
          ...(imports.includes("./effect.test-support")
            ? [`${display(file)} -> ./effect.test-support`]
            : []),
          ...Array.from(
            source.matchAll(/\b(?:runTestEffect|runScopedTestEffect)\b/g),
            (match) => `${display(file)} -> ${match[0]}`,
          ),
        ];
      });

    expect(violations).toEqual([]);
  });

  it("@svvy/sandbox keeps Effect runner tests in the Effect test lane", () => {
    const violations = listTypeScriptFiles(join(packageRoot, "sandbox", "src"))
      .filter(isTestFile)
      .flatMap((file) => {
        const imports = readImports(file);
        const source = readSource(file);
        const isEffectLane = isEffectTestLaneFile(file);

        return [
          ...(isEffectLane && imports.includes("bun:test") ? [`${display(file)} -> bun:test`] : []),
          ...(imports.includes("./effect.test-support")
            ? [`${display(file)} -> ./effect.test-support`]
            : []),
          ...Array.from(
            source.matchAll(/\b(?:runTestEffect|runScopedTestEffect)\b/g),
            (match) => `${display(file)} -> ${match[0]}`,
          ),
        ];
      });

    expect(violations).toEqual([]);
  });

  it("@svvy/core keeps Effect runner tests in the Effect test lane", () => {
    const coreTestSupportFile = join(packageRoot, "core", "src", "effect.test-support.ts");
    const violations = [
      ...(existsSync(coreTestSupportFile) ? [`${display(coreTestSupportFile)} exists`] : []),
      ...listTypeScriptFiles(join(packageRoot, "core", "src"))
        .filter(isTestFile)
        .flatMap((file) => {
          const imports = readImports(file);
          const source = readSource(file);
          const isEffectLane = isEffectTestLaneFile(file);

          return [
            ...(isEffectLane && imports.includes("bun:test")
              ? [`${display(file)} -> bun:test`]
              : []),
            ...(imports.includes("./effect.test-support")
              ? [`${display(file)} -> ./effect.test-support`]
              : []),
            ...Array.from(
              source.matchAll(/\b(?:runTestEffect|runScopedTestEffect|runTestEffectSync)\b/g),
              (match) => `${display(file)} -> ${match[0]}`,
            ),
          ];
        }),
    ];

    expect(violations).toEqual([]);
  });

  it("@svvy/extensions keeps Effect runner tests in the Effect test lane", () => {
    const extensionsTestSupportFile = join(
      packageRoot,
      "extensions",
      "src",
      "effect.test-support.ts",
    );
    const violations = [
      ...(existsSync(extensionsTestSupportFile)
        ? [`${display(extensionsTestSupportFile)} exists`]
        : []),
      ...listTypeScriptFiles(join(packageRoot, "extensions", "src"))
        .filter(isTestFile)
        .flatMap((file) => {
          const imports = readImports(file);
          const source = readSource(file);
          const isEffectLane = isEffectTestLaneFile(file);

          return [
            ...(isEffectLane && imports.includes("bun:test")
              ? [`${display(file)} -> bun:test`]
              : []),
            ...(imports.includes("./effect.test-support")
              ? [`${display(file)} -> ./effect.test-support`]
              : []),
            ...Array.from(
              source.matchAll(/\b(?:runTestEffect|runScopedTestEffect|runTestEffectSync)\b/g),
              (match) => `${display(file)} -> ${match[0]}`,
            ),
          ];
        }),
    ];

    expect(violations).toEqual([]);
  });

  it("@svvy/runtime keeps Effect runner tests in the Effect test lane", () => {
    const runtimeTestSupportFile = join(packageRoot, "runtime", "src", "effect.test-support.ts");
    const violations = [
      ...(existsSync(runtimeTestSupportFile) ? [`${display(runtimeTestSupportFile)} exists`] : []),
      ...listTypeScriptFiles(join(packageRoot, "runtime", "src"))
        .filter(isTestFile)
        .flatMap((file) => {
          const imports = readImports(file);
          const source = readSource(file);
          const isEffectLane = isEffectTestLaneFile(file);

          return [
            ...(isEffectLane && imports.includes("bun:test")
              ? [`${display(file)} -> bun:test`]
              : []),
            ...(imports.includes("./effect.test-support")
              ? [`${display(file)} -> ./effect.test-support`]
              : []),
            ...Array.from(
              source.matchAll(/\b(?:runTestEffect|runScopedTestEffect|runTestEffectSync)\b/g),
              (match) => `${display(file)} -> ${match[0]}`,
            ),
          ];
        }),
    ];

    expect(violations).toEqual([]);
  });

  it("@svvy/state keeps SQLite-backed Effect-returning tests in the Bun unit lane", () => {
    const stateSourceRoot = join(packageRoot, "state", "src");
    const stateProductionFiles = listTypeScriptFiles(stateSourceRoot).filter(
      (file) => !isTestFile(file),
    );
    const stateRootBarrel = join(stateSourceRoot, "index.ts");
    const sqliteBackedStateRoots = new Set([
      join(stateSourceRoot, "app-log-store.ts"),
      join(stateSourceRoot, "structured-session-state.ts"),
    ]);
    const sqliteBackedFileCache = new Map<string, boolean>();

    const importsBunSqlite = (file: string, visiting = new Set<string>()): boolean => {
      if (sqliteBackedStateRoots.has(file)) return true;
      const cached = sqliteBackedFileCache.get(file);
      if (cached !== undefined) return cached;
      if (visiting.has(file)) return false;
      visiting.add(file);

      const imports = readStaticSourceImports(file);
      const importsSqlite =
        imports.includes("bun:sqlite") ||
        imports.some((specifier) => {
          const resolved = resolveStateSourceImport(file, specifier);
          return (
            resolved !== null &&
            resolved !== stateRootBarrel &&
            stateProductionFiles.includes(resolved) &&
            importsBunSqlite(resolved, visiting)
          );
        });

      visiting.delete(file);
      sqliteBackedFileCache.set(file, importsSqlite);
      return importsSqlite;
    };

    const importsSqliteBackedState = (file: string): boolean => {
      const imports = readStaticSourceImports(file);
      return (
        imports.includes("bun:sqlite") ||
        imports.some((specifier) => {
          const resolved = resolveStateSourceImport(file, specifier);
          return (
            resolved !== null &&
            resolved !== stateRootBarrel &&
            stateProductionFiles.includes(resolved) &&
            importsBunSqlite(resolved)
          );
        })
      );
    };

    const violations = listTypeScriptFiles(stateSourceRoot)
      .filter(isTestFile)
      .flatMap((file) => {
        const imports = readImports(file);
        const isEffectLane = isEffectTestLaneFile(file);
        const importsManualRunner = imports.includes("./effect.test-support");
        const allowedFacadeAndBootstrapHarnessFiles = new Set([
          join(packageRoot, "state", "src", "state-facade.test.ts"),
        ]);
        const source = readSource(file);
        const usesServiceLayerTestApi =
          imports.includes("effect/Layer") ||
          imports.includes("effect/testing") ||
          /\bEffect\.provide\s*\(/.test(source) ||
          /\bLayer\.(?:succeed|effect|merge|mergeAll|provide|provideMerge)\b/.test(source);

        return [
          ...(isEffectLane && imports.includes("bun:test") ? [`${display(file)} -> bun:test`] : []),
          ...(isEffectLane && imports.includes("./effect.test-support")
            ? [`${display(file)} -> ./effect.test-support`]
            : []),
          ...(importsManualRunner && !importsSqliteBackedState(file)
            ? [`${display(file)} -> ./effect.test-support without SQLite-backed state import`]
            : []),
          ...(!isEffectLane &&
          usesServiceLayerTestApi &&
          !importsSqliteBackedState(file) &&
          !allowedFacadeAndBootstrapHarnessFiles.has(file)
            ? [`${display(file)} -> Bun-lane Effect service/layer test without SQLite backing`]
            : []),
        ];
      });

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

  it("Effect test lane-looking files use the exact .effect.test.ts suffix", () => {
    const invalidEffectTestNames = [packageRoot, appSourceRoot]
      .flatMap((root) => listTypeScriptFiles(root))
      .filter((file) => isTestFile(file))
      .map(display)
      .filter((file) => /(?:\.effect\.|_effect\.)/.test(file))
      .filter((file) => !file.endsWith(".effect.test.ts"))
      .toSorted();

    expect(invalidEffectTestNames).toEqual([]);
  });

  it("Effect Schema compiler calls are hoisted in package production source", () => {
    const schemaGateRoots = [...sourceRoots, appSourceRoot];
    const violations = schemaGateRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => readEffectSchemaCompilerConstructionReads(file).length > 0)
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("Effect Schema compiler calls do not bypass hoisting through import aliases", () => {
    const schemaGateRoots = [...sourceRoots, appSourceRoot];
    const violations = schemaGateRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          return readEffectSchemaCompilerConstructionReads(file)
            .filter((read) => !read.label.startsWith("Schema."))
            .map((read) => `${display(file)} -> ${read.label}`);
        }),
    );

    expect(violations).toEqual([]);
  });

  it("Effect Schema.asserts direct assertions stay out of package production source", () => {
    const schemaGateRoots = [...sourceRoots, appSourceRoot];
    const violations = schemaGateRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readEffectSchemaAssertReads(file).map((read) => `${display(file)} -> ${read}`),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("Effect Schema compiler construction stays outside package production function bodies", () => {
    const nearbyFunctionStartPattern =
      /\b(?:function\s+[A-Za-z_$][\w$]*\s*\(|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|(?:async\s+)?\([^)]*\)\s*=>)/;
    const schemaGateRoots = [...sourceRoots, appSourceRoot];
    const violations = schemaGateRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          return readEffectSchemaCompilerConstructionReads(file)
            .map((read) => {
              const nearbyPrefix = source.slice(Math.max(0, read.index - 500), read.index);
              if (!nearbyFunctionStartPattern.test(nearbyPrefix)) return null;
              const line = source.slice(0, read.index).split("\n").length;
              return `${display(file)}:${line} -> ${read.label}`;
            })
            .filter((entry): entry is string => entry !== null);
        }),
    );

    expect(violations).toEqual([]);
  });

  it("Effect execution-plan APIs stay unadopted in product packages", () => {
    const memberUsePattern = /\b(?:Effect|Stream)\.withExecutionPlan\s*\(/;
    const forbiddenNamedImports = new Set(["ExecutionPlan", "withExecutionPlan"]);
    const scannedRoots = [...sourceRoots, appSourceRoot, sharedSourceRoot];
    const violations = scannedRoots.flatMap((root) =>
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
    const eagerHelperPattern =
      /\b(?:mapEager|mapErrorEager|mapBothEager|flatMapEager|catchEager|fnUntracedEager|matchEager|matchEffectEager)\b/;
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => eagerHelperPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("extracted package production code does not own Effect env provider reads", () => {
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readConfigProviderFromEnvReads(file).map(
            (read) => `${display(file)} -> ${read.displayName}`,
          ),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("Effect config env provider reads stay in exact app host owners", () => {
    const actual = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readConfigProviderFromEnvReads(file).map(
          (read) => `${display(file)} -> ${read.displayName}`,
        ),
      )
      .toSorted();

    expect(actual).toEqual(["src/bun/index.ts -> ConfigProvider.fromEnv"]);
  });

  it("Effect config env providers use explicit host env snapshots", () => {
    const roots = [...sourceRoots, join(projectRoot, "src", "bun")];
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readConfigProviderFromEnvReads(file)
            .filter((read) => read.zeroArgument)
            .map((read) => `${display(file)} -> ${read.displayName}()`),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("packages, desktop, renderer, and shared contracts do not read ambient host env directly", () => {
    const roots = [...sourceRoots, mainviewSourceRoot, sharedSourceRoot];
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readAmbientHostEnvReads(file).map((read) => `${display(file)} -> ${read}`),
        ),
    );

    expect(violations).toEqual([]);
  });

  it("extracted package production code reads host time and random ids only through explicit host zones", () => {
    const forbiddenCallNames = new Set([
      "Date.now",
      "DateTime.nowUnsafe",
      "clock.currentTimeMillisUnsafe",
      "clock.currentTimeNanosUnsafe",
      "setTimeout",
      "setInterval",
      "Math.random",
      "crypto.randomUUID",
      "crypto.getRandomValues",
      "crypto.subtle.digest",
      "globalThis.crypto.randomUUID",
      "globalThis.crypto.getRandomValues",
      "globalThis.crypto.subtle.digest",
      "Bun.CryptoHasher",
      "Bun.hash",
      "Bun.hash.adler32",
      "Bun.hash.cityHash32",
      "Bun.hash.cityHash64",
      "Bun.hash.crc32",
      "Bun.hash.murmur32v2",
      "Bun.hash.murmur32v3",
      "Bun.hash.rapidhash",
      "Bun.hash.wyhash",
      "Bun.hash.xxHash32",
      "Bun.hash.xxHash64",
      "fetch",
      "globalThis.fetch",
    ]);
    const forbiddenConstructorNames = new Set(["Promise", "Bun.CryptoHasher"]);
    const forbiddenHostCryptoImports = new Set(["crypto", "node:crypto"]);
    const forbiddenHostCryptoAliasReads = new Set([
      "crypto",
      "crypto.getRandomValues",
      "crypto.randomUUID",
      "crypto.subtle",
      "crypto.subtle.digest",
      "globalThis.crypto",
      "globalThis.crypto.getRandomValues",
      "globalThis.crypto.randomUUID",
      "globalThis.crypto.subtle",
      "globalThis.crypto.subtle.digest",
      "Bun",
      "Bun.CryptoHasher",
      "Bun.hash",
    ]);
    const forbiddenHostCryptoDestructureReads = new Map<string, Set<string>>([
      ["crypto", new Set(["getRandomValues", "randomUUID", "subtle"])],
      ["crypto.subtle", new Set(["digest"])],
      ["globalThis.crypto", new Set(["getRandomValues", "randomUUID", "subtle"])],
      ["globalThis.crypto.subtle", new Set(["digest"])],
      ["Bun", new Set(["CryptoHasher", "hash"])],
    ]);
    const allowedViolations = new Map<string, string[]>([
      ["packages/desktop/src/index.ts", ["new Promise"]],
      ["packages/runtime/src/index.ts", ["new Promise"]],
    ]);
    const violations = sourceRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isVendoredSourcePath(file))
        .filter((file) => !isTestFile(file))
        .flatMap((file) => {
          const source = readSource(file);
          const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
          const fileViolations: string[] = readImports(file)
            .filter(
              (specifier) =>
                forbiddenHostCryptoImports.has(specifier) || specifier.startsWith("node:crypto/"),
            )
            .map((specifier) => `${display(file)} -> ${specifier} import`);
          const visit = (node: ts.Node): void => {
            if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
              const name = expressionPath(node.initializer);
              if (
                name &&
                (forbiddenCallNames.has(name) || forbiddenHostCryptoAliasReads.has(name))
              ) {
                fileViolations.push(`${display(file)} -> ${name} alias`);
              }
            }
            if (
              ts.isVariableDeclaration(node) &&
              node.initializer &&
              ts.isObjectBindingPattern(node.name)
            ) {
              const name = expressionPath(node.initializer);
              const forbiddenMembers = name
                ? forbiddenHostCryptoDestructureReads.get(name)
                : undefined;
              if (forbiddenMembers) {
                for (const element of node.name.elements) {
                  if (element.dotDotDotToken) {
                    fileViolations.push(`${display(file)} -> ${name} destructuring`);
                    continue;
                  }
                  const property = element.propertyName ?? element.name;
                  if (ts.isIdentifier(property) && forbiddenMembers.has(property.text)) {
                    fileViolations.push(
                      `${display(file)} -> ${name}.${property.text} destructuring`,
                    );
                  }
                }
              }
            }
            if (ts.isCallExpression(node)) {
              const name = expressionPath(node.expression);
              if (name && forbiddenCallNames.has(name)) {
                fileViolations.push(`${display(file)} -> ${name}`);
              }
            }
            if (ts.isNewExpression(node)) {
              const name = expressionPath(node.expression);
              if (name && forbiddenConstructorNames.has(name)) {
                fileViolations.push(`${display(file)} -> new ${name}`);
              }
              if (name === "Date" && node.arguments?.length === 0) {
                fileViolations.push(`${display(file)} -> new Date()`);
              }
            }
            ts.forEachChild(node, visit);
          };
          visit(sourceFile);
          const allowed = allowedViolations.get(display(file)) ?? [];
          return fileViolations.filter((violation) => {
            const name = violation.slice(violation.indexOf(" -> ") + 4);
            const index = allowed.indexOf(name);
            if (index === -1) return true;
            allowed.splice(index, 1);
            return false;
          });
        }),
    );

    expect({ unusedAllowedViolations: Array.from(allowedViolations), violations }).toEqual({
      unusedAllowedViolations: [
        ["packages/desktop/src/index.ts", []],
        ["packages/runtime/src/index.ts", []],
      ],
      violations: [],
    });
  });

  it("unsafe sync boundary decoders stay limited to core definitions, reexports, trusted bootstrap, and tests", () => {
    const allowedProductionFiles = new Set([
      "packages/core/src/extension-contracts.ts",
      "packages/core/src/generated-package-contracts.ts",
      "packages/core/src/native-tool-contracts.ts",
      "packages/core/src/pi-adapter-contracts.ts",
      "packages/core/src/prompt-execution-context.ts",
      "packages/core/src/runtime-contracts.ts",
      "packages/core/src/runtime-effect-requests.ts",
      "packages/core/src/runtime-invalidation-contracts.ts",
      "packages/core/src/runtime-source-edit-contracts.ts",
      "packages/core/src/runtime-source-invalidation.ts",
      "packages/core/src/runtime-submit.ts",
      "packages/core/src/workflow-task-agent-bridge-contracts.ts",
      "src/bun/session-catalog.ts",
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

  it("exported core sync boundary decoders use unsafe test-and-bootstrap naming", () => {
    const syncDecoderDeclarationPattern =
      /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decodeUnknownSync\s*\(/g;
    const violations = listTypeScriptFiles(join(packageRoot, "core", "src"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        Array.from(readSource(file).matchAll(syncDecoderDeclarationPattern), (match) => {
          const name = match[1]!;
          return /^unsafeDecode[A-Za-z0-9_]+SyncForTestsAndBootstrap$/.test(name)
            ? []
            : [`${display(file)} exports ${name}`];
        }).flat(),
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
    const checkedFiles = [
      ...listMarkdownFiles(packageArchitectureSpecRoot),
      join(projectRoot, "docs", "prd.md"),
      join(projectRoot, "docs", "progress.md"),
      join(projectRoot, "docs", "features.ts"),
    ];
    const violations = checkedFiles.flatMap((file) => {
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
        reason:
          "Command result envelopes use details.status; root-level ok booleans are not part of the public contract",
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
        pattern:
          /\bRunExtensionDependencyAction(?:Input|Result)?Schema\b|\bRunExtensionDependencyAction(?:Input|Result)\b|\bwaiting_for_approval\b/,
        reason:
          "Dependency install/update has no public runtime facade without a specified runtime-owned lifecycle",
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
        reason: "Extensions exposes no non-Effect facade without specs and boundary tests",
      },
      {
        pattern: /\bcreateSandboxDiagnosticsFacade\b/,
        reason: "Sandbox exposes no non-Effect diagnostics facade without specs and boundary tests",
      },
      {
        pattern: /\bartifact\.operation\b/,
        reason: "Signed svvyx transports support runtime_effect.request only",
      },
      {
        pattern:
          /state-owned artifact-store file materialization|State owns artifact file-store implementation|file-store persistence behind that port|artifact state mutations and file writes|artifact file and metadata mutations|Runtime\/state ports own source\/log\/diagnostic artifact persistence|retained large stdout\/stderr streams are product-state artifacts|refreshes `bytes` and `sha256` from disk|stats and hashes the artifact file|Artifact temporary staging directories|Artifact durable root metadata/,
        reason:
          "Artifact byte materialization/deletion/recovery is runtime-owned; @svvy/state owns durable artifact metadata and lifecycle facts only",
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
      {
        pattern:
          /\bRawHostHttpClientLayer\b|\bAppHttpClientLayer\b|\bcreateNetworkPolicyHttpClientLayer\b/,
        reason:
          "The product architecture excludes an Effect HTTP client layer unless a spec adds a named adoption record",
      },
      {
        pattern: /\bmodel(Id)?: "gpt-5\.4"\b/,
        reason:
          "Task-agent examples must use pi-normalized provider/model metadata placeholders instead of hard-coded model ids",
      },
      {
        pattern: /from\s+["@']@effect\/vitest["@'][^;]*(?:\beffect\b)/,
        reason:
          "@effect/vitest tests access it.effect through the installed it helper, not a named effect import",
      },
      {
        pattern: /until the installed implementation|fixed or reverified/,
        reason:
          "Effect package specs must describe the current adopted contract, not version-workaround staging language",
      },
      {
        pattern:
          /docs\/references\/effect-smol\/migration\/(?:v3-to-v4|services|runtime|forking|generators|layer-memoization|scope|error-handling|cause|fiberref|schema)\.md/,
        reason:
          "Effect migration reference files are orientation material, not product-spec implementation references",
      },
      {
        pattern: /RunTaskAgentInput\["promptSource"\]/,
        reason:
          "Task-agent bridge source examples must use generated source DTO inputs, not decoded core runtime payload types",
      },
      {
        pattern:
          /\brunTaskAgent\b[^.\n]*(?:is|as|becomes|remains|exports?|exposes?)[^.\n]*(?:public bootstrap export|facade group|general public facade)|(?:public bootstrap export|facade group|general public facade)[^.\n]*(?:for|named|called)\s+`?runTaskAgent`?/,
        reason:
          "runTaskAgent is a narrow runtime-owned Smithers task-agent bridge path, not a public bootstrap export or facade group",
      },
      {
        pattern:
          /desktop subscribes to runtime streams|renderer subscribes directly to runtime events|\b(?:exposes?|consumes?|subscribes? to)\s+bare runtime streams\b/,
        reason:
          "Desktop consumes app/bootstrap-prepared renderer-safe notifications and read-model refetches, not raw runtime streams",
      },
      {
        pattern:
          /\b(?:treats?|uses?|exposes?|models?)\s+generated packages as runtime facades\b|\b(?:exposes?|provides?|injects?)\s+(?:execute_typescript runtime facades|global svvy client|broad injected api helpers)\b/,
        reason:
          "Generated packages are read-only authoring outputs; execute_typescript exposes only actor-local builtin extension facades",
      },
      {
        pattern:
          /\b(?:creates?|owns?|constructs?|maintains|uses)\s+(?:a\s+)?(?:workspace|separate)\s+ManagedRuntime\b|\b(?:creates?|owns?|constructs?|maintains|uses)\s+per-request layer graphs?\b/,
        reason: "svvy uses one app-owned ManagedRuntime with keyed runtime-owned workspace scopes",
      },
      {
        pattern:
          /state-owned implementations\/layers for[^.\n]*(?:ProviderAuthPort|SecretStorePort)|layerProviderAuthPort|layerSecretStorePort|\|\s*`secretStore`\s*\|\s*`SecretStorePort`\s*\|\s*`state\.spec\.md`/,
        reason:
          "ProviderAuthPort and SecretStorePort are host/live core ports; @svvy/state owns durable provider status, secret readiness, and UI-intent commands",
      },
      {
        pattern:
          /Adopted stream constructors[^.]*NodeStream\.fromReadable|Adopted stream constructors[^.]*BunStream\.fromReadableStream/,
        reason: "Node/Bun stream adapters are outside the adopted stream constructor manifest",
      },
      {
        pattern:
          /\b(?:TODO|until|for now|temporary|temporarily)[^.\n]*(?:inline that schema or reject|either inline that schema or reject)/,
        reason:
          "JSON Schema $defs handling rejects unsupported bridges until a named tested inliner is adopted",
      },
      {
        pattern:
          /via `SchemaGetter\.transform|via `SchemaGetter\.transformOptional|SchemaGetter.*rather than the v3|SchemaTransformation` patterns from/,
        reason:
          "SchemaGetter and SchemaTransformation require an Effect manifest row and focused tests before production use",
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

  it("Effect spec treats t3code package-level runtimes as app-edge examples only", () => {
    const source = readSource(join(packageArchitectureSpecRoot, "effect-v4.spec.md"));

    expect(source).toContain(
      "t3code modules that create package-level `ManagedRuntime` values are app-edge examples only",
    );
    expect(source).toMatch(
      /svvy\s+does not copy that topology into public `@svvy\/\*` package roots, reusable package modules, renderer\s+bridges, generated packages, or tests/,
    );
  });

  it("package specs keep pi session reference ownership state-backed and adapter-validated", () => {
    const coreSource = readSource(join(packageArchitectureSpecRoot, "core.spec.md"));
    const piAdapterSource = readSource(join(packageArchitectureSpecRoot, "pi-adapter.spec.md"));
    const runtimeSource = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));
    const stateSource = readSource(join(packageArchitectureSpecRoot, "state.spec.md"));

    expect(coreSource).toContain("`PiSessionReferencePort`, and the other core-owned state ports");
    expect(coreSource).toContain(
      "app/bootstrap provides host/live\nports such as `SecretStorePort`, `ProviderAuthPort`, and `PiRuntimePathsPort`",
    );
    expect(piAdapterSource).toContain(
      "Runtime\nsurface lifecycle methods call `PiAdapter.sessions.open(...)` and map `PiAdapterError`; they do not\n" +
        "duplicate persisted-reference validation",
    );
    expect(runtimeSource).toContain(
      "pi session reference lookup and validation happen inside `@svvy/pi-adapter`",
    );
    expect(stateSource).toContain("`pi_session_reference`, keyed by `surface_pi_session_id`");
    expect(stateSource).toContain("reference fingerprint");
  });

  it("package specs assign artifact bytes to runtime and artifact metadata to state", () => {
    const packageSource = readSource(
      join(packageArchitectureSpecRoot, "package-architecture.spec.md"),
    );
    const runtimeSource = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));
    const stateSource = readSource(join(packageArchitectureSpecRoot, "state.spec.md"));
    const extensionSource = readSource(join(packageArchitectureSpecRoot, "extensions.spec.md"));

    expect(packageSource).toContain(
      "`@svvy/runtime` materializes, deletes, and recovers artifact bytes",
    );
    expect(runtimeSource).toContain("| Artifact file materialization lane");
    expect(runtimeSource).toContain(
      "RuntimeArtifactStatePort` records committed artifact metadata only",
    );
    expect(stateSource).toContain("Artifact durable metadata");
    expect(stateSource).toMatch(/file-store\s+helpers do not/);
    expect(extensionSource).toContain(
      "extensions must not receive a raw file-store port, artifact state port",
    );
  });

  it("state spec defines two-store secret write ordering and recovery", () => {
    const source = readSource(join(packageArchitectureSpecRoot, "state.spec.md"));

    expect(source).toContain("Provider credentials and extension secrets use a two-store protocol");
    expect(source).toContain(
      "Commit the SQLite reference/status row in one state transaction after the secure-store write\n" +
        "   succeeds",
    );
    expect(source).toContain("record or schedule secret\n   orphan cleanup");
    expect(source).toContain(
      "write the new secret first, commit the new SQLite reference/revision second",
    );
    expect(source).toContain("Secret writes are idempotent by command id / client submission key");
  });

  it("Effect package architecture progress opening does not mark local placeholders as complete", () => {
    const source = readSource(join(projectRoot, "docs", "progress.md"));
    const sectionStart = source.indexOf("## 0A. Effect Package Architecture");
    const statePackageStart = source.indexOf("  - [ ] `@svvy/state` exposes", sectionStart);

    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(statePackageStart).toBeGreaterThan(sectionStart);

    const opening = source.slice(sectionStart, statePackageStart);
    expect(opening).not.toMatch(/\[x\][\s\S]*?Commit\(s\):\s*pending/);
    expect(opening).not.toContain("pending local changes");
  });

  it("Effect package architecture package-boundary progress does not mark local placeholders as complete", () => {
    const source = readSource(join(projectRoot, "docs", "progress.md"));
    const sectionStart = source.indexOf("  - [ ] `@svvy/state` exposes");
    const sectionEnd = source.indexOf(
      "- [ ] Define core-owned runtime submission contracts",
      sectionStart,
    );

    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(sectionEnd).toBeGreaterThan(sectionStart);

    const packageBoundaryProgress = source.slice(sectionStart, sectionEnd);
    expect(packageBoundaryProgress).not.toMatch(/\[x\][\s\S]*?Commit\(s\):\s*pending/);
    expect(packageBoundaryProgress).not.toContain("pending local changes");
  });

  it("Effect package architecture progress does not contain checked pending placeholders", () => {
    const source = readSource(join(projectRoot, "docs", "progress.md"));
    const sectionStart = source.indexOf("## 0A. Effect Package Architecture");
    const sectionEnd = source.indexOf("## 0. Source Invalidation", sectionStart);

    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(sectionEnd).toBeGreaterThan(sectionStart);

    const effectPackageArchitectureProgress = source.slice(sectionStart, sectionEnd);
    expect(effectPackageArchitectureProgress).not.toMatch(/\[x\][\s\S]*?Commit\(s\):\s*pending/);
    expect(effectPackageArchitectureProgress).not.toContain("pending local changes");
  });

  it("progress tracker does not mark pending local placeholders as complete", () => {
    const source = readSource(join(projectRoot, "docs", "progress.md"));
    const bodyStart = source.indexOf("## Current Baseline");

    expect(bodyStart).toBeGreaterThanOrEqual(0);

    const body = source.slice(bodyStart);
    expect(body).not.toMatch(/\[x\][\s\S]*?Commit\(s\):[^\n]*pending/);
    expect(body).not.toContain("pending local changes");
    expect(body).not.toContain("Commit(s): pending");
  });

  it("completed progress tracker items name landing commit hashes", () => {
    const source = readSource(join(projectRoot, "docs", "progress.md"));
    const itemBlocks = source
      .split(/\n(?=- \[[ x]\] )/g)
      .filter((block) => block.startsWith("- [x]"));
    const commitHashPattern = /\b[0-9a-f]{7,40}\b/i;
    const placeholderPattern = /Commit\(s\):[^\n]*(?:pending|todo|tbd|hash|commit)\b/i;
    const violations = itemBlocks
      .filter(
        (block) =>
          !block.includes("Commit(s):") ||
          !commitHashPattern.test(block) ||
          placeholderPattern.test(block),
      )
      .map((block) => block.split("\n")[0]);

    expect(violations).toEqual([]);
  });

  it("runtime spec names concrete runtime-owned source invalidation services", () => {
    const source = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));
    const requiredServiceNames = [
      "RuntimeQueueWakeService",
      "RuntimeRequestInputWaitService",
      "RuntimeApprovalWaitService",
      "RuntimeSurfaceQueueDispatcherService",
      "RuntimePromptDefaultsService",
      "RuntimePromptExecutionService",
      "RuntimeSurfaceRuntimeService",
      "RuntimeSourceInvalidationService",
      "RuntimeSourceInvalidationScanPort",
      "RuntimeGeneratedPackageRefreshService",
    ];

    for (const serviceName of requiredServiceNames) {
      expect(source).toContain(serviceName);
    }

    expect(source).toMatch(/Any in-memory Effect\s+`Queue` is only a process-local wake hint/);
    expect(source).toContain("Approval state is DB/product-state-backed");
    expect(source).toContain(
      "reads file-backed prompt/instruction assets only through `@svvy/extensions`",
    );
    expect(source).toContain("type RuntimeSurfaceRuntimeService = {");
    expect(source).toContain("runPiTurn(input: RunPiTurnInput)");
    expect(source).toContain("type RuntimePromptExecutionInput = {");
    expect(source).toContain("claimedMessage: RuntimeSurfaceMessageRecord;");
    expect(source).toContain("piTurnInput: RunPiTurnInput;");
    expect(source).toContain("type RuntimePromptExecutionResult = {");
    expect(source).toContain("The result is a receipt only.");
    expect(source).toContain("The dependency order is strict.");
    expect(source).toContain("App/bootstrap provides");
    expect(source).toContain(
      "primitive filesystem/path/crypto, packaged-root, and watcher-handle capabilities only",
    );
    expect(source).toContain("semantic source invalidation service");
    expect(source).toContain("generated-package refresh service");
    expect(source).toContain("workspace-link repair host-port primitives");
    expect(source).toContain(
      "RuntimeGeneratedPackageRefreshService` owns app-global generated-package refresh execution",
    );
    expect(source).toContain("Generated-package workspace-link repair is a package-private lane");
    expect(source).toContain("RuntimeExecutionPlanExecutor");
    expect(source).toContain("Accepted-tool code must use the real runtime event bus");
    expect(source).toContain("it must not install a\nno-op event bus");
    expect(source).toContain("The only successful model-facing\noperation output is `toolResult`.");
  });

  it("workflow library specs keep generated-package build output separate from workspace-link repair", () => {
    const specSources = [
      join(productSpecRoot, "workflow-library.spec.md"),
      join(packageArchitectureSpecRoot, "generated-packages.spec.md"),
      join(packageArchitectureSpecRoot, "runtime.spec.md"),
    ].map((file) => [display(file), readSource(file)] as const);

    const forbiddenPhrases = [
      "immutable workspace-link plans, and generated manifest evidence",
      "GeneratedPackageBuildPlanResult contains workspace-link repair plans",
      "linkGeneratedWorkflowsPackageIntoWorkspaces",
      "ensureWorkflowsPackageLinks",
      "workflowLinkedWorkspaceCount",
      "linkedWorkspaces",
    ];

    const violations = specSources.flatMap(([file, source]) =>
      forbiddenPhrases
        .filter((phrase) => source.includes(phrase))
        .map((phrase) => `${file} -> ${phrase}`),
    );

    expect(violations).toEqual([]);

    const workflowLibrarySpec = readSource(join(productSpecRoot, "workflow-library.spec.md"));
    expect(workflowLibrarySpec).toContain("this build result contains no workspace-link plans");
    expect(workflowLibrarySpec).toContain(
      "planWorkspaceLink(...)` results and applying those plans through runtime-owned link repair",
    );
  });

  it("runtime and core specs define runtime-owned prompt dispatch and prompt-context seams", () => {
    const runtimeSource = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));
    const coreSource = readSource(join(packageArchitectureSpecRoot, "core.spec.md"));
    const effectSource = readSource(join(packageArchitectureSpecRoot, "effect-v4.spec.md"));
    const packageArchitectureSource = readSource(
      join(packageArchitectureSpecRoot, "package-architecture.spec.md"),
    );

    expect(runtimeSource).toContain("RuntimeSurfaceQueueDispatcherService");
    expect(runtimeSource).toContain("acceptWakeHint(...)");
    expect(runtimeSource).toContain("RuntimeSurfaceScopeService");
    expect(runtimeSource).not.toContain("RuntimeLayerPromptControlHostPort");
    expect(runtimeSource).not.toContain("RuntimeLayerSurfaceQueueWakePort");
    expect(runtimeSource).toContain(
      "`message-submitted` is emitted only after a committed prompt-bearing surface queue row",
    );
    expect(runtimeSource).toContain("type RuntimeSurfaceQueueWakeReason =");
    expect(runtimeSource).toContain('| "message-submitted"');
    expect(runtimeSource).toContain('| "request-input-answer-queued"');
    expect(runtimeSource).toContain('| "queue-steered"');
    expect(runtimeSource).toContain('| "runtime-queue-inserted"');
    expect(runtimeSource).toContain('| "startup-recovery"');
    expect(runtimeSource).toContain(
      "It exposes package-private `acceptWakeHint(...)` and\n  `drain(...)` effects.",
    );
    expect(runtimeSource).toContain(
      "through `acceptWakeHint(...)` and `drain(...)`; wake scheduling remains owned by",
    );
    expect(runtimeSource).not.toContain(
      "`drainSurfaceQueue(...)` and `drainNextQueuedSurfaceMessage(...)`",
    );
    expect(runtimeSource).toContain(
      "The only public\npackage surface for the runtime-owned constructor and live handle type is the narrow\n`@svvy/runtime/prompt-execution-context` subpath.",
    );
    expect(runtimeSource).toContain("type PromptExecutionContext = {\n  workspaceSessionId:");
    expect(runtimeSource).not.toContain(
      "type PromptExecutionContext = {\n  workspaceId: WorkspaceId;",
    );
    expect(runtimeSource).not.toContain(
      "The only allowed surface queue wake host shape is a primitive command",
    );

    expect(coreSource).toContain(
      "The only allowed public runtime surface for the narrow\nconstructor/live-handle API is `@svvy/runtime/prompt-execution-context`",
    );
    expect(coreSource).not.toContain("or any public runtime subpath");

    expect(effectSource).toContain(
      "The runtime tags in this list are allowed on the public `@svvy/runtime/bootstrap` subpath only as",
    );
    expect(effectSource).not.toContain("RuntimeLayerPromptControlHostPort");
    expect(effectSource).not.toContain("RuntimeLayerSurfaceQueueWakePort");

    expect(packageArchitectureSource).not.toContain("createRuntimePromptControlHostLayer");
    expect(packageArchitectureSource).not.toContain("RuntimeLayerPromptControlHostPort");
    expect(packageArchitectureSource).not.toContain("RuntimeLayerSurfaceQueueWakePort");
    expect(packageArchitectureSource).toContain(
      "resolves any renderer-local placement such as `panelId` through authoritative state-backed",
    );
    expect(packageArchitectureSource).toContain(
      "Desktop does not expose or own runtime\n  event subscription calls.",
    );
  });

  it("runtime bootstrap public subpath exports stay explicitly capped", () => {
    const bootstrapSymbols = expectedPublicSubpathSymbols.get("@svvy/runtime/bootstrap") ?? [];
    const actualBootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "bootstrap.ts"))),
    ];
    const specApproved = [...runtimeBootstrapSpecApprovedSymbols].toSorted();
    const runtimeSpecSource = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));

    expect(bootstrapSymbols.toSorted()).toEqual(specApproved);
    expect(actualBootstrapSymbols.toSorted()).toEqual(specApproved);
    expect(specApproved).not.toContain("RuntimeLayerPromptControlHostPort");
    expect(specApproved).not.toContain("RuntimeLayerSurfaceQueueWakePort");
    expect(specApproved).toContain("RuntimeGeneratedPackageWorkspaceLinkFileHost");
    expect(specApproved).toContain("RuntimeSourceInvalidationHost");
    expect(specApproved).toContain("RuntimeSourceWatchInput");
    expect(bootstrapSymbols).not.toContain("runAcceptedLoadExtensionToolCallAtRuntimeBoundary");
    expect(bootstrapSymbols).not.toContain("runAcceptedRequestUserInputToolCallAtRuntimeBoundary");
    expect(bootstrapSymbols).not.toContain("createSurfaceQueueDispatcher");
    expect(bootstrapSymbols).not.toContain("createRuntimeSurfaceQueueDispatcher");
    expect(bootstrapSymbols).not.toContain("SurfaceQueueDispatcher");
    expect(bootstrapSymbols).not.toContain("RuntimeSurfaceQueueDispatcherService");
    expect(bootstrapSymbols).not.toContain("wakeRuntimeSurfaceQueue");
    expect(bootstrapSymbols).not.toContain("createSourceInvalidationCoordinator");
    expect(bootstrapSymbols).not.toContain("reactToRuntimeSourceInvalidationEvent");
    expect(bootstrapSymbols).not.toContain("runTaskAgent");
    expect(bootstrapSymbols).not.toContain("WorkflowTaskAgentBridge");
    expect(actualBootstrapSymbols).not.toContain("RuntimeGeneratedContextRefreshService");
    expect(actualBootstrapSymbols).not.toContain("RuntimeGeneratedPackageRefreshService");
    expect(actualBootstrapSymbols).not.toContain("RuntimeSourceInvalidationService");
    expect(actualBootstrapSymbols).not.toContain("createSurfaceQueueDispatcher");
    expect(actualBootstrapSymbols).not.toContain("createRuntimeSurfaceQueueDispatcher");
    expect(actualBootstrapSymbols).not.toContain("SurfaceQueueDispatcher");
    expect(actualBootstrapSymbols).not.toContain("RuntimeSurfaceQueueDispatcherService");
    expect(actualBootstrapSymbols).not.toContain("wakeRuntimeSurfaceQueue");
    expect(runtimeSpecSource).toContain("RuntimeSurfaceQueueDispatcherService");
    expect(runtimeSpecSource).not.toContain("RuntimeLayerSurfaceQueueWakePort");
    expect(runtimeSpecSource.replace(/\s+/g, " ")).toContain(
      "accepted-tool operation helpers, source coordinators, queue dispatchers, generated-package repair executors, event-bus internals, wait registries, runtime scope services, `RuntimeWorkspaceScopeService`, or `layerRuntimeWorkspaceScopeService`",
    );
  });

  it("workflow task-agent bridge server stays app-bootstrap local and command-scoped", () => {
    const actualImports = listTypeScriptFiles(appSourceRoot)
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier.includes("task-agent-bridge-server"))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actualImports).toEqual([
      "src/bun/session-catalog.ts -> ./smithers-runtime/task-agent-bridge-server",
    ]);

    const serverSource = readSource(
      join(projectRoot, "src", "bun", "smithers-runtime", "task-agent-bridge-server.ts"),
    );
    expect(serverSource).toContain('url.pathname !== "/runTaskAgent"');
    expect(serverSource).toContain("authorization");
    expect(serverSource).not.toMatch(/export\s+(?:class|const|function)\s+WorkflowTaskAgentBridge/);
  });

  it("workflow task-agent bridge env vars stay on generated client and command injection edges", () => {
    const allowedProduction = [
      "packages/extensions/src/generated-workflows-package.ts",
      "src/bun/smithers-runtime/task-agent-bridge-server.ts",
      "src/bun/svvy-direct-tools.ts",
    ].toSorted();

    const actual = [appSourceRoot, ...sourceRoots, join(projectRoot, "generated")]
      .flatMap((root) => listTypeScriptFiles(root))
      .filter((file) => !isTestFile(file))
      .filter((file) => /\bSVVY_WORKFLOW_AGENT_[A-Z0-9_]+\b/.test(readSource(file)))
      .map(display)
      .toSorted();

    expect(actual).toEqual(allowedProduction);
  });

  it("runtime accepted native-tool execution service stays package-private", () => {
    const forbidden = new Set([
      "RuntimeAcceptedNativeToolExecution",
      "RuntimeAcceptedNativeToolExecutionService",
      "layerRuntimeAcceptedNativeToolExecution",
    ]);
    const runtimeRootSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "index.ts"))),
    ];
    const runtimeBootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "bootstrap.ts"))),
    ];
    const consumerRoots = [
      join(projectRoot, "src", "bun"),
      join(packageRoot, "desktop", "src"),
      join(packageRoot, "state", "src"),
      join(packageRoot, "extensions", "src"),
      join(packageRoot, "pi-adapter", "src"),
      join(packageRoot, "sandbox", "src"),
    ];
    const consumerViolations = consumerRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          [
            ...readNamedImportNames(file, "@svvy/runtime"),
            ...readNamedImportNames(file, "@svvy/runtime/bootstrap"),
          ]
            .filter((name) => forbidden.has(name))
            .map((name) => `${display(file)} imports ${name}`),
        ),
    );

    expect(runtimeRootSymbols.filter((symbol) => forbidden.has(symbol))).toEqual([]);
    expect(runtimeBootstrapSymbols.filter((symbol) => forbidden.has(symbol))).toEqual([]);
    expect(consumerViolations).toEqual([]);
    const acceptedToolAdapterSymbols = [
      ...new Set(
        readPublicExportedNames(
          join(packageRoot, "runtime", "src", "accepted-native-tool-execution.ts"),
        ),
      ),
    ];
    expect(acceptedToolAdapterSymbols.filter((symbol) => forbidden.has(symbol))).toEqual([]);

    const runtimeRootSource = readSource(join(packageRoot, "runtime", "src", "index.ts"));
    const serviceSource = readSource(
      join(packageRoot, "runtime", "src", "accepted-native-tool-execution-service.ts"),
    );
    expect(runtimeRootSource).not.toMatch(
      /export\s+const\s+layer:\s+Layer\.Layer<[\s\S]*RuntimeAcceptedNativeToolExecution[\s\S]*RuntimeLayerRequirements/,
    );
    expect(serviceSource).toContain("acquireDirectToolLaunch(");
    expect(serviceSource).toContain(
      '"@svvy/runtime/acceptedNativeToolExecution.acquireDirectToolLaunch"',
    );
    expect(serviceSource).toContain("buildRuntimeDirectToolLaunchFacts(input)");
    expect(serviceSource).toContain(
      "Effect.provideService(RuntimeLaunchPolicyService, launchPolicy)",
    );
    expect(serviceSource).toContain('from "./runtime-direct-tool-launch-policy"');

    const directServiceImportConsumers = [
      appSourceRoot,
      ...sourceRoots.filter((root) => root !== join(packageRoot, "runtime", "src")),
    ]
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readStaticSourceImports(file)
              .filter((specifier) => specifier.includes("accepted-native-tool-execution-service"))
              .map((specifier) => `${display(file)} -> ${specifier}`),
          ),
      )
      .toSorted();
    expect(directServiceImportConsumers).toEqual([]);
  });

  it("accepted native-tool bootstrap helper symbols stay out of the runtime bootstrap surface", () => {
    const acceptedHelperSymbols = [
      "runAcceptedLoadExtensionToolCallAtRuntimeBoundary",
      "runAcceptedThreadStartToolCallAtRuntimeBoundary",
    ];
    const bootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "bootstrap.ts"))),
    ];

    expect(
      acceptedHelperSymbols.filter((symbol) => bootstrapSymbols.includes(symbol)).toSorted(),
    ).toEqual([]);
  });

  it("pi callback runner usage stays isolated to pi-adapter turn, native-tools, and session bridges", () => {
    const matches = implementationPackageRoots
      .flatMap((root) => listTypeScriptFiles(root))
      .filter((file) => !file.endsWith("package-boundaries.test.ts"))
      .flatMap((file) =>
        [...readSource(file).matchAll(/\b(?:runToolEffect|RunPiToolEffect)\b/g)].map(() =>
          display(file),
        ),
      );

    expect([...new Set(matches)].toSorted()).toEqual([
      "packages/pi-adapter/src/native-tools.ts",
      "packages/pi-adapter/src/pi-adapter.effect.test.ts",
      "packages/pi-adapter/src/pi-adapter.ts",
      "packages/pi-adapter/src/session.ts",
    ]);
  });

  it("runtime generic adapter failures do not masquerade as unsupported operations", () => {
    const files = [
      join(packageRoot, "runtime", "src", "runtime-layer.ts"),
      join(packageRoot, "runtime", "src", "runtime-generated-context-refresh-service.ts"),
      join(projectRoot, "src", "bun", "runtime-service-adapter.ts"),
    ];
    const violations = files.flatMap((file) => {
      const source = readSource(file);
      const helperBodies = Array.from(
        source.matchAll(
          /function\s+(?:runtimeAdapterError|runtimeGeneratedContextRefreshHostError)\b[\s\S]*?return new RuntimeContractError\(\{([\s\S]*?)\}\);/g,
        ),
        (match) => match[1] ?? "",
      );
      return helperBodies
        .filter((body) => body.includes('reason: "unsupported-operation"'))
        .map(() => display(file));
    });

    expect(violations).toEqual([]);
  });

  it("Effect runtime spec exposes state command notifications through runtime, not app callbacks", () => {
    const runtimeSource = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));
    const appSource = readSource(join(packageArchitectureSpecRoot, "package-architecture.spec.md"));

    expect(runtimeSource).toContain("| Runtime");
    expect(runtimeSource).toContain("| RuntimeStartupReadiness");
    expect(runtimeSource).toContain("| RuntimeShutdownPreparation");
    expect(runtimeSource).toContain("| StateCommandPostCommitNotificationPort");
    expect(runtimeSource).toContain(
      "It is not a `@svvy/runtime` package-root value export, not a facade group, and not an\n" +
        "app/bootstrap callback surface.",
    );
    expect(runtimeSource).toContain(
      "App/bootstrap only wires\n" +
        "the layers and facades; it does not collect, transform, publish, or retry descriptors.",
    );
    expect(runtimeSource).not.toContain("collected by app-owned command/runtime boundary adapters");
    expect(appSource).toContain("layerAppLogWritePort");
    expect(appSource).toContain("AppLogWriteLayer");
    expect(appSource).not.toContain("createHostChildProcessSpawnerLayer");
    expect(appSource).toContain("createRuntimeSourceInvalidationHost");
    expect(appSource).toContain("SourceInvalidationHost.watch");
    expect(appSource).toContain("const HostPlatformBaseLayer = layerRuntimeBunPlatform;");
    expect(appSource).not.toContain("FileWatchBackendLayer");
    expect(appSource).toContain("type SvvyProgrammaticApp = {");
  });

  it("Effect source worker timing and keys are fully specified", () => {
    const runtimeSource = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));
    const sourceInvalidation = readSource(join(productSpecRoot, "source-invalidation.spec.md"));
    const sourceCoordinator = readSource(
      join(packageRoot, "runtime", "src", "source-invalidation-coordinator.ts"),
    );
    const workspaceRuntimeRegistry = readSource(
      join(projectRoot, "src", "bun", "workspace-runtime-registry.ts"),
    );

    expect(runtimeSource).toContain(
      "sourceMaxCoalescingLatencyMs: PositiveDurationMs; // default 2000",
    );
    expect(runtimeSource).toContain(
      "force one scan by `sourceMaxCoalescingLatencyMs` under continuous hints",
    );
    expect(runtimeSource).toContain("app-source:{domain}");
    expect(runtimeSource).toContain("workspace-source:{workspaceId}:{domain}");
    expect(runtimeSource).toContain("generated-package:{packageName}");
    expect(runtimeSource).toContain("workspace-link:{workspaceId}:{packageName}");
    expect(runtimeSource).toContain("command-output:{commandId}");
    expect(runtimeSource).toContain(
      "App-global generated-package graph builds are serialized per canonical package graph",
    );
    expect(runtimeSource).not.toContain("generatedPackageGlobalLinkRepairConcurrency");
    expect(sourceInvalidation).toContain("RuntimeLayerConfig.sourceMaxCoalescingLatencyMs");
    expect(sourceInvalidation).toContain("sourceRetryInitialDelayMs");
    expect(sourceInvalidation).toContain("sourceRetryMaxAttempts");
    expect(sourceCoordinator).toContain("retryInitialDelayMs?: number");
    expect(sourceCoordinator).toContain("retryMaxDelayMs?: number");
    expect(sourceCoordinator).toContain("retryMaxAttempts?: number");
    expect(sourceCoordinator).toContain("Effect.retry({");
    expect(sourceCoordinator).toContain("Schedule.exponential(retryInitialDelayMs)");
    expect(sourceCoordinator).toContain("Duration.min(delay, Duration.millis(retryMaxDelayMs))");
    expect(
      workspaceRuntimeRegistry.match(
        /retryInitialDelayMs: this\.options\.runtimeLayerConfig\.sourceRetryInitialDelayMs/g,
      ),
    ).toHaveLength(2);
    expect(
      workspaceRuntimeRegistry.match(
        /retryMaxDelayMs: this\.options\.runtimeLayerConfig\.sourceRetryMaxDelayMs/g,
      ),
    ).toHaveLength(2);
    expect(
      workspaceRuntimeRegistry.match(
        /retryMaxAttempts: this\.options\.runtimeLayerConfig\.sourceRetryMaxAttempts/g,
      ),
    ).toHaveLength(2);
  });

  it("native tool concurrency and secret ownership contracts stay explicit", () => {
    const coreSource = readSource(join(packageArchitectureSpecRoot, "core.spec.md"));
    const extensionsSource = readSource(join(packageArchitectureSpecRoot, "extensions.spec.md"));
    const runtimeSource = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));

    expect(coreSource).toContain("type NativeToolConcurrencyContract =");
    expect(coreSource).toContain('Omitted concurrency means\n`{ mode: "serial" }`.');
    expect(coreSource).toContain('"provider-auth-failed"');
    expect(coreSource).toContain("export class ProviderAuthPortError");
    expect(coreSource).toContain("export class SecretStorePortError");
    expect(extensionsSource).toContain(
      "`@svvy/extensions` never resolves raw extension secret\nvalues.",
    );
    expect(extensionsSource).toContain(
      "`surface` is not a valid field\non extension invocation targets.",
    );
    expect(extensionsSource).toContain("It is not returned by\n`@svvy/extensions`");
    expect(runtimeSource).toContain("Runtime does not directly require `SecretStorePort`");
    expect(runtimeSource).toContain('StateContractError.reason === "not-found"');
    expect(runtimeSource).toContain("`CommandOutputEventPayload`");
    expect(runtimeSource).toContain("It does not carry raw bytes");
  });

  it("secret mutation authority stays private to app bootstrap and state commands", () => {
    const forbiddenRoots = ["runtime", "extensions", "pi-adapter", "sandbox", "desktop"];
    const violations = forbiddenRoots.flatMap((packageName) =>
      listTypeScriptFiles(join(projectRoot, "packages", packageName, "src"))
        .filter((file) => !isTestFile(file))
        .filter((file) => /\bSecretStoreMutationPort(?:Service)?\b/.test(readSource(file)))
        .map(display),
    );
    const bootstrapSource = readSource(join(projectRoot, "src", "bun", "app-runtime-bootstrap.ts"));
    const rendererFacadeSource = readSource(
      join(projectRoot, "src", "bun", "renderer-state-facade.ts"),
    );

    expect(violations).toEqual([]);
    expect(bootstrapSource).toContain("secretStoreMutation: input.secretStoreMutation");
    expect(bootstrapSource).not.toContain("Layer.succeed(SecretStoreMutationPort");
    expect(rendererFacadeSource).not.toMatch(/\bSecretStore(?:Mutation)?Port(?:Service)?\b/);
  });

  it("source invalidation spec keeps Workflows source refresh separate from actor staleness", () => {
    const source = readSource(join(productSpecRoot, "source-invalidation.spec.md"));

    expect(source).toContain(
      "Ordinary Workflows prompt/component/workflow source changes\n" +
        "update Workflows library, generated-package, diagnostics, and workspace-link read models only",
    );
    expect(source).toContain(
      "existing workflow task-agent attempt surfaces only when their bound workflow-agent metadata fingerprint changes",
    );
    expect(source).toContain(
      "none, unless a separate state-backed actor generated-context binding fact changes",
    );
  });

  it("desktop spec injects runtime commands and renderer-safe state through the bridge", () => {
    const source = readSource(join(packageArchitectureSpecRoot, "desktop.spec.md"));

    expect(source).toContain('type RuntimeCommandsFacade = RuntimeFacade["commands"];');
    expect(source).toContain(
      "commands: {\n    runtime: RuntimeCommandsFacade;\n    state: RendererStateCommandsFacade;\n  };",
    );
    expect(source).toContain("type RendererStateCommandsFacade = {");
    expect(source).toContain(
      'exposeRendererApi(input: {\n    runtime: DesktopRuntimeActionsFacade;\n    modelMetadata: RendererModelMetadataFacade;\n    state: RendererStateFacade;\n    commands: CreateDesktopAppInput["commands"];\n  })',
    );
    expect(source).toContain("list(input: ListModelsInput): Promise<readonly ModelInfo[]>;");
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

  it("runtime source-edit specs expose only implemented source edit facade methods", () => {
    const source = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));
    const sourceEditApiStart = source.indexOf("type RuntimeSourceEditsService = {");
    const sourceEditApiEnd = source.indexOf("};", sourceEditApiStart);
    const sourceEditPromiseStart = source.indexOf("type RuntimeSourceEditsFacade = {");
    const sourceEditPromiseEnd = source.indexOf("};", sourceEditPromiseStart);

    expect(sourceEditApiStart).toBeGreaterThanOrEqual(0);
    expect(sourceEditApiEnd).toBeGreaterThan(sourceEditApiStart);
    expect(sourceEditPromiseStart).toBeGreaterThanOrEqual(0);
    expect(sourceEditPromiseEnd).toBeGreaterThan(sourceEditPromiseStart);

    const sourceEditContracts = [
      source.slice(sourceEditApiStart, sourceEditApiEnd),
      source.slice(sourceEditPromiseStart, sourceEditPromiseEnd),
    ].join("\n");
    const rejectedCurrentMethods = [
      "createWorkflowPrompt(",
      "deleteWorkflowPrompt(",
      "createWorkflowComponent(",
      "deleteWorkflowComponent(",
      "createWorkflow(",
      "deleteWorkflow(",
      "CreateWorkflowPromptSourceInput",
      "DeleteWorkflowPromptSourceInput",
      "CreateWorkflowComponentSourceInput",
      "DeleteWorkflowComponentSourceInput",
      "CreateWorkflowSourceInput",
      "DeleteWorkflowSourceInput",
      "WorkflowPromptSourceLifecycleResult",
      "WorkflowComponentSourceLifecycleResult",
      "WorkflowWorkflowSourceLifecycleResult",
    ];
    const violations = rejectedCurrentMethods.filter((method) =>
      sourceEditContracts.includes(method),
    );

    expect(violations).toEqual([]);
    expect(sourceEditContracts).toContain("OpenExtensionSourceEditInput");
    expect(sourceEditContracts).toContain("RuntimeSaveExtensionSourceEditInput");
    expect(sourceEditContracts).toContain("createWorkflowAgent(");
    expect(sourceEditContracts).toContain("RuntimeCreateWorkflowAgentSourceInput");
    expect(sourceEditContracts).toContain("duplicateWorkflowAgent(");
    expect(sourceEditContracts).toContain("RuntimeDuplicateWorkflowAgentSourceInput");
    expect(sourceEditContracts).toContain("deleteWorkflowAgent(");
    expect(sourceEditContracts).toContain("RuntimeDeleteWorkflowAgentSourceInput");
    expect(sourceEditContracts).toContain("WorkflowAgentSourceLifecycleResult");
    expect(sourceEditContracts).toContain("WorkflowAgentSourceDeleteResult");
    expect(source).toContain("are not public runtime");
    expect(source).toContain("No public runtime `sourceEdits.rename*` or");
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
    const trackedProductionPrivateCompositionImports = new Set([
      "src/bun/session-catalog.ts -> ../../packages/runtime/src/surface-queue-dispatcher",
    ]);
    const packageBoundaryImportViolations = (file: string) =>
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
              !allowedPublicSubpathImports.has(specifier)) ||
            (specifier.startsWith("@svvy/runtime/") &&
              !allowedPublicSubpathImports.has(specifier)) ||
            (specifier.startsWith("@svvy/sandbox/") &&
              !allowedPublicSubpathImports.has(specifier)) ||
            (specifier.startsWith("@svvy/state/") && !allowedPublicSubpathImports.has(specifier)),
        )
        .map((specifier) => `${display(file)} -> ${specifier}`);
    const violations = listTypeScriptFiles(appSourceRoot)
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        packageBoundaryImportViolations(file).filter(
          (violation) => !trackedProductionPrivateCompositionImports.has(violation),
        ),
      );

    expect(violations).toEqual([]);
  });

  it("production public package subpath imports stay in the approved consumer matrix", () => {
    const approvedProductionPublicSubpathImports = [
      "src/bun/app-runtime-bootstrap.ts -> @svvy/runtime/accepted-native-tool-execution",
      "src/bun/app-runtime-bootstrap.ts -> @svvy/runtime/app-log-commit-notification-adapter",
      "src/bun/app-runtime-bootstrap.ts -> @svvy/runtime/bootstrap",
      "src/bun/app-runtime-bootstrap.ts -> @svvy/runtime/committed-state-invalidation-adapter",
      "src/bun/app-runtime-bootstrap.ts -> @svvy/state/structured-session-adapters",
      "src/bun/execute-typescript-tool.ts -> @svvy/runtime/prompt-execution-context",
      "src/bun/extension-tools.ts -> @svvy/runtime/prompt-execution-context",
      "src/bun/index.ts -> @svvy/runtime/bootstrap",
      "src/bun/live-command-stdin-registry.ts -> @svvy/runtime/bootstrap",
      "src/bun/runtime-service-adapter.ts -> @svvy/runtime/bootstrap",
      "src/bun/runtime-state-tools.ts -> @svvy/runtime/prompt-execution-context",
      "src/bun/session-catalog.ts -> @svvy/pi-adapter/session",
      "src/bun/session-catalog.ts -> @svvy/runtime/bootstrap",
      "src/bun/session-catalog.ts -> @svvy/runtime/prompt-execution-context",
      "src/bun/session-catalog.ts -> @svvy/state/structured-session-adapters",
      "src/bun/session-catalog.ts -> @svvy/state/structured-session-state",
      "src/bun/source-watch-inputs.ts -> @svvy/runtime/bootstrap",
      "src/bun/svvy-direct-tools.ts -> @svvy/runtime/prompt-execution-context",
      "src/bun/svvy-direct-tools.ts -> @svvy/sandbox/diagnostics",
      "src/bun/thread-orchestration-tools.ts -> @svvy/runtime/prompt-execution-context",
      "src/bun/thread-report-tool.ts -> @svvy/runtime/prompt-execution-context",
      "src/bun/thread-start-tool.ts -> @svvy/runtime/prompt-execution-context",
      "src/bun/workspace-runtime-registry.ts -> @svvy/runtime/bootstrap",
      "src/bun/workspace-runtime-registry.ts -> @svvy/runtime/source-invalidation-coordinator-adapter",
      "src/bun/workspace-runtime-registry.ts -> @svvy/state/generated-package-maintenance",
      "src/shared/session-navigation.ts -> @svvy/state/session-navigation",
    ];
    const svvyPublicSubpathPattern =
      /^@svvy\/(?:core|desktop|extensions|pi-adapter|runtime|sandbox|state)\//;
    const productionRoots = [appSourceRoot, ...sourceRoots, join(projectRoot, "generated")];
    const actual = productionRoots
      .flatMap((root) => listTypeScriptFiles(root))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readImports(file)
          .filter((specifier) => svvyPublicSubpathPattern.test(specifier))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actual).toEqual(approvedProductionPublicSubpathImports);
  });

  it("Bun production code has only the named session-catalog direct @svvy/state store exception", () => {
    const expectedDirectStateStoreImports = [
      "src/bun/session-catalog.ts -> @svvy/state/structured-session-state",
    ];
    const actualDirectStateStoreImports = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier === "@svvy/state/structured-session-state")
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actualDirectStateStoreImports).toEqual(expectedDirectStateStoreImports);
  });

  it("Bun production code imports structured-session adapters only at named bootstrap edges", () => {
    const actualStructuredSessionAdapterImports = listTypeScriptFiles(
      join(projectRoot, "src", "bun"),
    )
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier === "@svvy/state/structured-session-adapters")
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actualStructuredSessionAdapterImports).toEqual([
      "src/bun/app-runtime-bootstrap.ts -> @svvy/state/structured-session-adapters",
      "src/bun/session-catalog.ts -> @svvy/state/structured-session-adapters",
    ]);
  });

  it("session-catalog structured-session adapter bootstrap imports stay explicitly capped", () => {
    const expectedStoreAdapterFactories = [
      "extensionStatePortFromStore",
      "runtimeActorExtensionBindingStatePortFromStore",
      "runtimeApprovalStatePortFromStore",
      "runtimeArtifactStatePortFromStore",
      "runtimeCommandStatePortFromStore",
      "runtimeEpisodeStatePortFromStore",
      "runtimeExtensionContextImpactStateFacadeFromStore",
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
      "structuredSessionCatalogMutationsFromStore",
      "structuredSessionStateFromStore",
    ];
    const source = readSource(sessionCatalogModule);
    const actualStoreAdapterFactories = [
      ...source.matchAll(/\b([a-zA-Z][A-Za-z0-9]+FromStore)\s*\(/g),
    ]
      .map((match) => match[1])
      .toSorted();

    expect(actualStoreAdapterFactories).toEqual(expectedStoreAdapterFactories);
  });

  it("Bun production code imports generated-package maintenance only at the runtime registry edge", () => {
    const actualGeneratedPackageMaintenanceImports = listTypeScriptFiles(
      join(projectRoot, "src", "bun"),
    )
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier === "@svvy/state/generated-package-maintenance")
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actualGeneratedPackageMaintenanceImports).toEqual([
      "src/bun/workspace-runtime-registry.ts -> @svvy/state/generated-package-maintenance",
    ]);
  });

  it("Bun production code does not import pi-adapter internal subpaths", () => {
    const expectedInternalPiAdapterImports: string[] = [];
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

  it("Bun code exposes structured-session store access only as the router registration seam", () => {
    const oldStructuredStoreGetterUses = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .filter((file) => /\bgetStructuredSessionStore\b/.test(readSource(file)))
      .map(display)
      .toSorted();

    expect(oldStructuredStoreGetterUses).toEqual([]);

    const routerRegistrationSeamOwners = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .filter((file) => /\bworkspaceStateRouterRegistration\s*\(/.test(readSource(file)))
      .map(display)
      .toSorted();

    expect(routerRegistrationSeamOwners).toEqual([
      "src/bun/app-runtime-bootstrap.ts",
      "src/bun/session-catalog.ts",
      "src/bun/workspace-runtime-registry.ts",
    ]);

    const routerRegistrationCallSites = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => /\.\s*workspaceStateRouterRegistration\s*\(/.test(readSource(file)))
      .map(display)
      .toSorted();

    expect(routerRegistrationCallSites).toEqual([
      "src/bun/app-runtime-bootstrap.ts",
      "src/bun/session-catalog.test.ts",
      "src/bun/workspace-runtime-registry.test.ts",
      "src/bun/workspace-runtime-registry.ts",
    ]);
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

  it("package-owned native tool modules stay pi-free", () => {
    const violations = packageOwnedNativeToolModules.flatMap((file) =>
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
        .filter((specifier) => specifier !== "@svvy/runtime/prompt-execution-context")
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
    expect(loadToolSource).toContain("options.runAcceptedLoadExtension(");
    expect(loadToolSource).not.toContain("runAcceptedLoadExtensionToolCallAtRuntimeBoundary(");
    expect(loadToolSource).not.toContain("commandStatePort:");
    expect(loadToolSource).not.toContain("actorExtensionBindingStatePort:");
    expect(loadToolSource).not.toContain("loadExtensionHandler.invoke");
    expect(loadToolSource).not.toContain("applyRuntimeEffectRequests(");
    expect(loadToolSource).not.toContain("buildSystemPrompt(");
    expect(loadToolSource).not.toContain("buildExecuteTypescriptApiDeclaration(");
    expect(loadToolSource).not.toContain("onContextRefreshed");
  });

  it("request_user_input has no Bun wrapper and enters runtime accepted-tool execution", () => {
    expect(existsSync(join(projectRoot, "src", "bun", "request-user-input-tool.ts"))).toBe(false);
    const catalogSource = readSource(join(projectRoot, "src", "bun", "session-catalog.ts"));
    expect(catalogSource).not.toContain("createRequestUserInputTool");
    expect(catalogSource).not.toContain("RequestUserInputRuntime");
    expect(catalogSource).not.toContain("runAcceptedRequestUserInput");

    const promptExecutionSource = readSource(
      join(packageRoot, "runtime", "src", "runtime-prompt-execution-service.ts"),
    );
    expect(promptExecutionSource).toContain('toolInput.toolName === "request_user_input"');
    expect(promptExecutionSource).toContain("input.acceptedNativeTools");
    expect(promptExecutionSource).toContain(".runRequestUserInput({");
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

  it("app-local runtime effect request algebras stay limited to the named svvyx transport exception set", () => {
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
      /\bStateCommands\b/,
      /\bSecretStorePort\b/,
      /\bRedacted\b/,
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

  it("generated @svvyx/workflows output stays an authoring package with only narrow bridge imports", () => {
    const files = renderGeneratedWorkflowsPackageFiles(
      [
        {
          exportName: "reviewerAgent",
          kind: "agent",
          sourcePath: "/workflows/agents/reviewer.agent.json" as AbsolutePath,
          relativeGeneratedPath: "agents/reviewer.ts",
          sourceText: JSON.stringify({
            id: "reviewer",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5",
            reasoning: { effort: "medium" },
            instructions: "Review the current change.",
            overrides: { artifacts: "loaded" },
          }),
        },
        {
          exportName: "reviewPrompt",
          kind: "prompt",
          sourcePath: "/workflows/prompts/review.mdx" as AbsolutePath,
          relativeGeneratedPath: "prompts/reviewPrompt.ts",
          sourceText: "Review the patch and return findings.",
        },
        {
          exportName: "reviewWorkflow",
          kind: "workflow",
          sourcePath: "/workflows/workflows/review.tsx" as AbsolutePath,
          relativeGeneratedPath: "workflows/reviewWorkflow.tsx",
          sourceText:
            'import { Task } from "smithers-orchestrator";\n' +
            'import { Extensions } from "@svvyx/extensions";\n' +
            "export const reviewWorkflow = Task;\n",
        },
      ],
      {
        createdAt: "2026-06-28T00:00:00.000Z" as IsoDateTimeString,
        coreTypeContractPackageDependencySpecifier: "file:../core-type-contract",
        extensionsBuildId: "@svvyx/extensions:test" as GeneratedPackageBuildId,
      },
    );
    const forbiddenPatterns = [
      /from ["']@svvy\/runtime(?:\/|["'])/,
      /from ["']@svvy\/state(?:\/|["'])/,
      /from ["']@svvy\/sandbox(?:\/|["'])/,
      /from ["']@svvy\/pi-adapter(?:\/|["'])/,
      /from ["']@svvy\/desktop(?:\/|["'])/,
      /from ["']@svvy\/extensions(?:\/|["'])/,
      /from ["']@svvyx\/workflows(?:\/|["'])/,
      /from ["']effect(?:\/|["'])/,
      /from ["']@effect\//,
      /\bContext\.Service\b/,
      /\bManagedRuntime\b/,
      /\bLayer\b/,
      /\bStateCommands\b/,
      /\bSecretStorePort\b/,
      /\bRedacted\b/,
      /\beffect\/Metric\b/,
      /\beffect\/Logger\b/,
      /\beffect\/Tracer\b/,
      /\beffect\/unstable\/observability\b/,
      /@effect\/opentelemetry/,
      /\bStateStore\b/,
      /\bStateCommands\b/,
      /\bSecretStorePort\b/,
      /\bRedacted\b/,
      /\bRuntimeEffectRequest\b/,
      /\bExtensionExecutionPlan\b/,
      /\bWorkflowTaskAgentBridge\b/,
      /\bAuthenticatedRunTaskAgentInput\b/,
      /\bRunTaskAgentInput\b/,
    ];
    const violations = files.flatMap((file) =>
      forbiddenPatterns
        .filter((pattern) => pattern.test(file.contents))
        .map((pattern) => `${file.relativePath} -> ${pattern}`),
    );
    const valueCoreImports = files.flatMap((file) =>
      Array.from(
        file.contents.matchAll(/^\s*import\s+(?!type\b)[\s\S]*?\s+from\s+["']@svvy\/core["']/gm),
        () => file.relativePath,
      ),
    );
    const allowedCoreTypeImports = new Set([
      "RunTaskAgentError",
      "RunTaskAgentPromptSource",
      "RunTaskAgentResult",
      "RunTaskAgentSourceInput",
    ]);
    const coreTypeImportViolations = files.flatMap((file) =>
      Array.from(
        file.contents.matchAll(/^\s*import\s+type\s+\{([^}]+)\}\s+from\s+["']@svvy\/core["']/gm),
        (match) =>
          match[1]
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
            .filter((name) => !allowedCoreTypeImports.has(name))
            .map((name) => `${file.relativePath} -> ${name}`),
      ).flat(),
    );
    const allowedGeneratedWorkflowEnvVars = new Set([
      "SVVY_WORKFLOW_AGENT_BRIDGE_URL",
      "SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN",
      "SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID",
      "SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID",
      "SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS",
      "SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES",
    ]);
    const generatedEnvVarViolations = files.flatMap((file) =>
      Array.from(file.contents.matchAll(/\bSVVY_[A-Z0-9_]+\b/g), ([name]) => name)
        .filter((name) => !allowedGeneratedWorkflowEnvVars.has(name))
        .map((name) => `${file.relativePath} -> ${name}`),
    );
    const agentsIndex =
      files.find((file) => file.relativePath === "agents/index.ts")?.contents ?? "";
    const generatedWorkflowEnvVars = new Set(
      Array.from(agentsIndex.matchAll(/\bSVVY_[A-Z0-9_]+\b/g), ([name]) => name),
    );
    const packageJson = JSON.parse(
      files.find((file) => file.relativePath === "package.json")?.contents ?? "{}",
    ) as { devDependencies?: Record<string, string> };
    const manifest = JSON.parse(
      files.find((file) => file.relativePath === ".svvy-generated-package.json")?.contents ?? "{}",
    ) as {
      dependencies?: Array<{
        specifier?: string;
        importKind?: string;
        dependencyClass?: string;
        resolutionAuthority?: string;
        manifestDependency?: string;
      }>;
    };
    const coreDependencyEvidence =
      manifest.dependencies?.filter((dependency) => dependency.specifier === "@svvy/core") ?? [];

    expect({
      violations,
      valueCoreImports,
      coreTypeImportViolations,
      generatedEnvVarViolations,
      coreDevDependencies: packageJson.devDependencies,
      coreDependencyEvidence,
      runtimeCoreDependencyEvidence: coreDependencyEvidence.filter(
        (dependency) => dependency.importKind === "runtime",
      ),
      hasDefineTaskAgent: /\bexport function defineTaskAgent\b/.test(agentsIndex),
      hasBridgeCaller: /\basync function callTaskAgentBridge\b/.test(agentsIndex),
      hasRunTaskAgentOperation: /\boperation:\s*["']runTaskAgent["']/.test(agentsIndex),
      hasBearerBridgeAuth: /authorization["']?:\s*`Bearer \$\{bridgeToken\}`/.test(agentsIndex),
      generatedWorkflowEnvVars: [...generatedWorkflowEnvVars].toSorted(),
    }).toEqual({
      violations: [],
      valueCoreImports: [],
      coreTypeImportViolations: [],
      generatedEnvVarViolations: [],
      coreDevDependencies: { "@svvy/core": "file:../core-type-contract" },
      coreDependencyEvidence: [
        {
          specifier: "@svvy/core",
          importKind: "type-only",
          dependencyClass: "app-owned-type-contract",
          resolutionAuthority: "app-owned-type-contract",
          manifestDependency: "dev-type-dependency",
        },
      ],
      runtimeCoreDependencyEvidence: [],
      hasDefineTaskAgent: true,
      hasBridgeCaller: true,
      hasRunTaskAgentOperation: true,
      hasBearerBridgeAuth: true,
      generatedWorkflowEnvVars: [...allowedGeneratedWorkflowEnvVars].toSorted(),
    });
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
      /\bStateCommands\b/,
      /\bSecretStorePort\b/,
      /\bRedacted\b/,
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
      /\bStateCommands\b/,
      /\bSecretStorePort\b/,
      /\bRedacted\b/,
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

  it("only approved secret intake schemas expose secretValue", () => {
    const approvedSecretValueOccurrences = [
      "packages/state/src/state-command-schemas.ts -> SetExtensionEnvSecretCommandInputSchema",
      "packages/state/src/state-facade.ts -> <non-schema>",
    ];
    const secretValueOccurrences = sourceRoots
      .flatMap((root) => listTypeScriptFiles(root))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        const schemaBlocks = Array.from(
          source.matchAll(
            /export\s+const\s+([A-Za-z_$][\w$]*Schema)\s*=\s*Schema\.Struct\s*\(\s*\{[\s\S]*?\n\}\s*\);/g,
          ),
        );
        return Array.from(source.matchAll(/\bsecretValue\b/g), (match) => {
          const schemaName =
            schemaBlocks.find(
              (schemaMatch) =>
                schemaMatch.index !== undefined &&
                match.index !== undefined &&
                schemaMatch.index <= match.index &&
                match.index < schemaMatch.index + schemaMatch[0].length,
            )?.[1] ?? "<non-schema>";
          return `${display(file)} -> ${schemaName}`;
        });
      })
      .toSorted();

    expect(secretValueOccurrences).toEqual(approvedSecretValueOccurrences);
  });

  it("runtime facade keeps generated package refresh behind sourceInvalidation", () => {
    const runtimeSource = readSource(join(packageRoot, "runtime", "src", "index.ts"));
    expect(runtimeSource).toContain("refreshGeneratedPackages(");
    expect(runtimeSource).toContain("RuntimeSourceInvalidationService");
    expect(runtimeSource).toContain("RuntimeSourceInvalidationFacade");
    expect(runtimeSource).toContain("decodeUnknownRefreshGeneratedPackagesRequestEffect");
    expect(runtimeSource).toContain("decodeUnknownGeneratedPackagesRefreshResultEffect");
    expect(runtimeSource).not.toContain('decodedInput.scope === "workspace-link-repair"');
    expect(runtimeSource).not.toContain("runtime-internal recovery work");
    expect(runtimeSource).not.toContain("productStateChanged");
    expect(runtimeSource).not.toContain("decodeUnknownStateInvalidationDescriptorEffect");
    const generatedPackageContractsSource = readSource(
      join(packageRoot, "core", "src", "generated-package-contracts.ts"),
    );
    expect(generatedPackageContractsSource).toContain(
      "RefreshGeneratedPackagesRequestSchema = AppGlobalRefreshGeneratedPackagesRequestSchema",
    );
    expect(generatedPackageContractsSource).toContain(
      "InternalRefreshGeneratedPackagesRequestSchema",
    );

    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    const runtimeSourceInvalidationServiceSource = readSource(
      join(packageRoot, "runtime", "src", "runtime-source-invalidation-service.ts"),
    );
    const runtimeGeneratedPackageRefreshServiceSource = readSource(
      join(packageRoot, "runtime", "src", "runtime-generated-package-refresh-service.ts"),
    );
    const adapterSource = readSource(runtimeServiceAdapterModule);
    expect(runtimeLayerSource).toContain("sourceInvalidation.refreshGeneratedPackages");
    expect(runtimeLayerSource).toContain("RuntimeGeneratedPackageRefreshHostPort");
    expect(runtimeLayerSource).toContain("RuntimeSourceInvalidationService");
    expect(runtimeGeneratedPackageRefreshServiceSource).toContain(
      "refreshRuntimeGeneratedPackages(input",
    );
    expect(runtimeGeneratedPackageRefreshServiceSource).toContain(
      "RuntimeGeneratedPackageRefreshHostPort",
    );
    expect(runtimeGeneratedPackageRefreshServiceSource).toContain("Extensions");
    expect(runtimeGeneratedPackageRefreshServiceSource).toContain("extensions.generatedPackages");
    expect(runtimeGeneratedPackageRefreshServiceSource).toContain(".refresh(buildInput)");
    expect(runtimeGeneratedPackageRefreshServiceSource).toContain(".planWorkspaceLink(linkInput)");
    expect(runtimeSourceInvalidationServiceSource).toContain(
      "RuntimeGeneratedPackageRefreshService",
    );
    const appRuntimeBootstrapSource = readSource(appRuntimeBootstrapModule);
    expect(appRuntimeBootstrapSource).toContain(
      "Layer.succeed(RuntimeGeneratedPackageRefreshHostPort, input.generatedPackageRefresh)",
    );
    expect(appRuntimeBootstrapSource).not.toContain("RuntimeGeneratedPackageRefreshHostPort.of");
    expect(appRuntimeBootstrapSource).toContain("internal: {");
    expect(appRuntimeBootstrapSource).toContain(
      "runtime.sourceInvalidation.refreshGeneratedPackages(request)",
    );
    expect(appRuntimeBootstrapSource).not.toContain(
      "facade.sourceInvalidation.refreshGeneratedPackages(input)",
    );
    expect(adapterSource).not.toContain("port.sourceInvalidation.refreshGeneratedPackages");
    expect(adapterSource).not.toContain("productStateChanged");
    expect(adapterSource).not.toContain("buildWorkflowsGeneratedPackage(");
    expect(adapterSource).not.toContain("refreshGeneratedExtensionsPackage(");
  });

  it("runtime source edit facade is backed by Extensions.sources and RuntimeSourceStatePort", () => {
    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    const extensionsServiceSource = readSource(
      join(packageRoot, "extensions", "src", "extensions-service.ts"),
    );
    const adapterSource = readSource(runtimeServiceAdapterModule);
    const registrySource = readSource(
      join(projectRoot, "src", "bun", "workspace-runtime-registry.ts"),
    );

    expect(runtimeLayerSource).toContain("input.extensions.sources.openEditSession");
    expect(runtimeLayerSource).toContain("input.extensions.sources.saveEditSession");
    expect(runtimeLayerSource).toContain("RuntimeSourceStatePort");
    expect(runtimeLayerSource).toContain(".readSourceVersion({");
    expect(runtimeLayerSource).toContain(".recordSourceSave(record)");
    expect(runtimeLayerSource).toContain(".recordWorkflowAgentSourceSave({");
    expect(runtimeLayerSource).toContain(".recordWorkflowAgentSourceDelete({ source: record })");
    expect(runtimeLayerSource).toContain("admitRuntimeWorkflowAgentModel");
    expect(runtimeLayerSource).toContain("RuntimeRecoveryStatePort");
    expect(runtimeLayerSource).toContain('kind: "source_reconcile"');
    expect(runtimeLayerSource).not.toContain("RuntimeLayerSourceEditsPort");
    expect(extensionsServiceSource).toContain("sources: {");
    expect(extensionsServiceSource).toContain("openEditSession");
    expect(extensionsServiceSource).toContain("saveEditSession");
    expect(extensionsServiceSource).toContain("createWorkflowAgent");
    expect(extensionsServiceSource).toContain("duplicateWorkflowAgent");
    expect(extensionsServiceSource).toContain("deleteWorkflowAgent");
    expect(runtimeLayerSource).not.toContain("open?(input: OpenExtensionSourceEditInput)");
    expect(runtimeLayerSource).not.toContain("save?(input: SaveExtensionSourceEditInput)");
    expect(runtimeLayerSource).not.toContain(
      'unsupportedRuntimeMethod("runtime.sourceEdits.open")',
    );
    expect(runtimeLayerSource).not.toContain(
      'unsupportedRuntimeMethod("runtime.sourceEdits.save")',
    );
    expect(adapterSource).not.toContain("RuntimeLayerSourceEditsPort");
    expect(adapterSource).not.toContain("port.sourceEdits");
    expect(registrySource).not.toContain("sourceEdits: {");
    expect(registrySource).not.toContain("openExtensionSourceEdit");
    expect(registrySource).not.toContain("saveExtensionSourceEdit");
  });

  it("generated package refresh status exposes structured dependency evidence", () => {
    const source = readSource(join(packageRoot, "core", "src", "generated-package-contracts.ts"));

    expect(source).toContain("GeneratedPackageDependencyEvidenceSchema");
    expect(source).toContain('specifier: Schema.Literal("@svvy/core")');
    expect(source).toContain('importKind: Schema.Literal("type-only")');
    expect(source).toContain('dependencyClass: Schema.Literal("app-owned-type-contract")');
    expect(source).toContain('resolutionAuthority: Schema.Literal("app-owned-type-contract")');
    expect(source).toContain('manifestDependency: Schema.Literal("dev-type-dependency")');
    expect(source).toContain('resolutionAuthority: Schema.Literal("generated-package-link")');
    expect(source).toContain('manifestDependency: Schema.Literal("none-generated-package-link")');
    expect(source).not.toMatch(
      /dependencies:\s*Schema\.optional\(\s*Schema\.Array\(\s*Schema\.Struct\(\{\s*name:\s*Schema\.String,\s*version:\s*Schema\.String/s,
    );
  });

  it("does not preserve a Bun-owned generated-package writer", () => {
    expect(existsSync(join(projectRoot, "src", "bun", "generated-extensions-package.ts"))).toBe(
      false,
    );
  });

  it("production generated-package writer renderers stay package-private", () => {
    const writerNames = new Set([
      "renderGeneratedExtensionsPackageFiles",
      "renderGeneratedWorkflowsPackageFiles",
    ]);
    const actual = [appSourceRoot, ...sourceRoots]
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readNamedImportNames(file, "@svvy/extensions")
              .filter((name) => writerNames.has(name))
              .map((name) => `${display(file)} -> ${name}`),
          ),
      )
      .toSorted();

    expect(actual).toEqual([]);
  });

  it("workspace generated package link repair is applied by runtime against an app file host", () => {
    const runtimeSource = readSource(
      join(packageRoot, "runtime", "src", "generated-package-refresh.ts"),
    );
    const registrySource = readSource(
      join(projectRoot, "src", "bun", "workspace-runtime-registry.ts"),
    );
    const appRuntimeBootstrapSource = readSource(appRuntimeBootstrapModule);
    const adapterSource = readSource(runtimeServiceAdapterModule);

    expect(runtimeSource).toContain("applyGeneratedPackageWorkspaceLinkRepairPlan(");
    expect(runtimeSource).toContain("host.workspaceLinkFileHost");
    expect(registrySource).toContain("workspaceLinkFileHost:");
    expect(appRuntimeBootstrapSource).toContain("RuntimeGeneratedPackageRefreshHostPortService");
    expect(appRuntimeBootstrapSource).not.toContain(
      "createRuntimeGeneratedPackageRefreshHostAtRuntimeBoundary",
    );
    expect(registrySource).not.toContain(
      "createRuntimeGeneratedPackageRefreshHostAtRuntimeBoundary",
    );
    const runtimeGeneratedPackageRefreshServiceSource = readSource(
      join(packageRoot, "runtime", "src", "runtime-generated-package-refresh-service.ts"),
    );
    expect(runtimeGeneratedPackageRefreshServiceSource).toContain("extensions.generatedPackages");
    expect(runtimeGeneratedPackageRefreshServiceSource).toContain(".planWorkspaceLink(linkInput)");
    expect(registrySource).not.toContain("applyGeneratedPackageWorkspaceLinkRepairPlan(");
    expect(registrySource).not.toContain("applyWorkspaceLinkRepairPlan");
    expect(adapterSource).not.toContain("applyWorkspaceLinkRepairPlan");
    expect(registrySource).not.toContain("ensureWorkflowsPackageLink(");
    expect(registrySource).not.toContain("ensureExtensionsPackageLink(");
    expect(registrySource).not.toContain("ensureWorkflowsPackageLinks(");
  });

  it("production app code does not use direct generated package link helpers", () => {
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        const usesLegacyLinkHelper =
          /\bensure(?:WorkflowsPackageLinks|WorkflowsPackageLink|ExtensionsPackageLink)\s*\(/.test(
            source,
          ) ||
          /import\s*\{[^}]*\bensure(?:WorkflowsPackageLinks|WorkflowsPackageLink|ExtensionsPackageLink)\b[^}]*\}\s*from\s*["']\.\/smithers-runtime\/workflow-library["']/.test(
            source,
          );
        if (!usesLegacyLinkHelper) return [];
        return [display(file)];
      });

    expect(violations).toEqual([]);
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
      /\b(?:runtime\.)?catalog\.(?:resolvePromptDefaultsForTarget|sendPrompt|cancelPrompt|deleteQueuedSurfaceMessage|steerQueuedSurfaceMessage)\b/;
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => file !== runtimeServiceAdapterModule)
      .filter((file) => display(file) !== "src/bun/workspace-runtime-registry.ts")
      .filter((file) => !isTestFile(file))
      .filter((file) => catalogRuntimeOperationPattern.test(readSource(file)))
      .map(display);

    expect(violations).toEqual([]);
  });

  it("session catalog cannot own the deleted prompt dispatch loop or stream producer seams", () => {
    const catalogSource = readSource(join(projectRoot, "src", "bun", "session-catalog.ts"));
    const deletedCatalogSeams = [
      "emitSurfaceStreamPatch",
      "runAgentPrompt",
      "runSurfaceQueue",
      "sendPrompt(",
      "cancelPrompt(",
      "cancelActivePrompt(",
      "createRuntimeSurfaceQueueDispatcher",
      "session.prompt(",
    ];
    for (const seam of deletedCatalogSeams) {
      expect(catalogSource).not.toContain(seam);
    }

    const streamPatchProducers = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .filter((file) => !file.endsWith("desktop-notification-bridge.ts"))
      .filter((file) => readSource(file).includes('type: "surface.stream"'))
      .map(display);

    expect(streamPatchProducers).toEqual([]);
  });

  it("runtime prompt post-commit lanes use runtime queue wake service over primitive surface queue wake ports", () => {
    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    const runtimeQueueWakeSource = readSource(
      join(packageRoot, "runtime", "src", "runtime-queue-wake-service.ts"),
    );
    expect(runtimeLayerSource).toContain("RuntimeQueueWakeService");
    expect(runtimeLayerSource).toContain("wakeSurface({");
    expect(runtimeLayerSource).toContain('reason: "message-submitted"');
    expect(runtimeLayerSource).toContain('reason: "queue-steered"');
    expect(runtimeLayerSource).not.toContain("wakeSurfaceQueue({");
    expect(runtimeQueueWakeSource).toContain("RuntimeSurfaceQueueDispatcherService");
    expect(runtimeQueueWakeSource).toContain("acceptWakeHint({");
    expect(runtimeLayerSource).not.toContain("RuntimeLayerCatalogPort");
    expect(runtimeLayerSource).not.toContain("afterRuntimeSurfaceMessageQueued");
    expect(runtimeLayerSource).not.toContain("afterRuntimeSurfaceMessageSteered");

    const requestInputWaitServiceSource = readSource(
      join(packageRoot, "runtime", "src", "runtime-request-input-wait-service.ts"),
    );
    expect(requestInputWaitServiceSource).toContain("wakeSurface:");
    expect(requestInputWaitServiceSource).toContain('reason: "request-input-answer-queued"');
    expect(runtimeLayerSource).toContain("answerRuntimeRequestInput(input, queueWake.wakeSurface)");

    const appRuntimeBootstrapSource = readSource(appRuntimeBootstrapModule);
    const runtimeLayerProviderPortsSource = readSource(
      join(packageRoot, "runtime", "src", "runtime-layer-provider-ports.ts"),
    );
    const runtimeStructuralPortTags = [
      "RuntimePromptDefaultsStatePort",
      "RuntimeLayerProviderAuthPort",
      "RuntimeLayerModelResolverPort",
      "AppLogWritePort",
      "RuntimeLayerCommandStdinPort",
      "RuntimeLayerCommandControlPort",
      "RuntimeGeneratedContextRefreshHostPort",
      "RuntimeGeneratedPackageRefreshHostPort",
      "RuntimeSourceInvalidationScanPort",
    ];
    for (const tag of runtimeStructuralPortTags) {
      expect(appRuntimeBootstrapSource).toMatch(new RegExp(`Layer\\.succeed\\(\\s*${tag},`));
      expect(appRuntimeBootstrapSource).not.toContain(`${tag}.of`);
    }
    expect(appRuntimeBootstrapSource).not.toContain("RuntimeLayerPromptControlHostPort");
    expect(appRuntimeBootstrapSource).not.toContain("RuntimeLayerSurfaceQueueWakePort");
    expect(runtimeLayerProviderPortsSource).toMatch(
      /ensureUsableProviderAuth\(\s*provider:\s*string,\s*\):\s*Effect\.Effect<string \| undefined, RuntimeContractError>/,
    );
    expect(runtimeLayerSource).toContain(
      "const apiKey = yield* input.providerAuth.ensureUsableProviderAuth(resolved.provider);",
    );
    expect(runtimeLayerSource).not.toContain(
      "try: () => input.providerAuth.ensureUsableProviderAuth(resolved.provider)",
    );
    expect(appRuntimeBootstrapSource).not.toContain("wakeRuntimeSurfaceQueue");
    expect(appRuntimeBootstrapSource).not.toContain("afterRuntimeSurfaceMessageQueued");
    expect(appRuntimeBootstrapSource).not.toContain("afterRuntimeSurfaceMessageSteered");
  });

  it("runtime request-input queued answer wake targets come from committed answer context without rereading request input", () => {
    const source = readSource(
      join(packageRoot, "runtime", "src", "runtime-request-input-wait-service.ts"),
    );

    const afterAnswerStart = source.indexOf("afterAnswerCommitted:");
    const afterTimerStart = source.indexOf("afterTimerPausedCommitted:", afterAnswerStart);
    expect(afterAnswerStart).toBeGreaterThanOrEqual(0);
    expect(afterTimerStart).toBeGreaterThan(afterAnswerStart);

    const afterAnswerSource = source.slice(afterAnswerStart, afterTimerStart);
    expect(afterAnswerSource).toContain('reason: "request-input-answer-queued"');
    expect(afterAnswerSource).toContain("wakeSurface({");
    expect(afterAnswerSource).not.toContain(".getRequestInput(");
    expect(afterAnswerSource).not.toContain("requestInputTarget(");
  });

  it("app request-input and runtime approval answers bridge through the runtime facade", () => {
    const source = readSource(join(projectRoot, "src", "bun", "index.ts"));

    const answerStart = source.indexOf("answerRequestUserInput: async");
    const approvalStart = source.indexOf("answerRuntimeApprovalRequest: async");
    expect(answerStart).toBeGreaterThanOrEqual(0);
    expect(approvalStart).toBeGreaterThan(answerStart);
    const answerSource = source.slice(answerStart, approvalStart);
    expect(answerSource).toContain("facades.runtime.requestInput.answer(");
    expect(answerSource).not.toContain("runtime.catalog.answerRequestUserInput(");
    expect(answerSource).not.toContain("runtime.catalog.afterRequestInputAnswered(");

    const pauseStart = source.indexOf("setRequestUserInputTimerPaused: async");
    expect(pauseStart).toBeGreaterThan(approvalStart);
    const approvalSource = source.slice(approvalStart, pauseStart);
    expect(approvalSource).toContain("facades.runtime.approvals.answer(");
    expect(approvalSource).not.toContain("runtime.catalog.answerRuntimeApprovalRequest(");

    const nextBridgeMethodStart = source.indexOf("cancelPrompt: async", pauseStart);
    expect(pauseStart).toBeGreaterThanOrEqual(0);
    expect(nextBridgeMethodStart).toBeGreaterThan(pauseStart);
    const pauseSource = source.slice(pauseStart, nextBridgeMethodStart);
    expect(pauseSource).toContain("facades.runtime.requestInput.setTimerPaused(");
    expect(pauseSource).not.toContain("runtime.catalog.setRequestUserInputTimerPaused(");
    expect(pauseSource).not.toContain("runtime.catalog.afterRequestInputTimerPaused(");

    expect(source).toContain(
      "setRequestInputVariant: (input) => facades.runtime.requestInput.setVariant(input)",
    );
    expect(source).toContain("facades.runtime.requestInput.setBlockingTimeout(input)");

    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    expect(runtimeLayerSource).toContain("answerRuntimeRequestInput(input, queueWake.wakeSurface)");
    expect(runtimeLayerSource).toContain("setRuntimeRequestInputVariant(input)");
    expect(runtimeLayerSource).toContain("setRuntimeRequestInputBlockingTimeout(input)");
    expect(runtimeLayerSource).toContain("setRuntimeRequestInputTimerPaused(input)");
    expect(runtimeLayerSource).not.toContain("RuntimeLayerCatalogPort");
    const appRuntimeBootstrapSource = readSource(appRuntimeBootstrapModule);
    expect(appRuntimeBootstrapSource).not.toContain("RuntimeLayerRequestInputPostCommitPort.of");
    expect(appRuntimeBootstrapSource).not.toContain("RuntimeLayerApprovalPostCommitPort.of");
    expect(appRuntimeBootstrapSource).not.toContain("Layer.succeed(RuntimeApprovalWaitService");
    expect(appRuntimeBootstrapSource).not.toContain("getRuntimeApprovalWaitService");
    expect(appRuntimeBootstrapSource).toContain("workspaceStateLayer");
    expect(appRuntimeBootstrapSource).not.toContain(
      "Layer.succeed(RuntimeLayerSurfaceQueueWakePort",
    );
    expect(appRuntimeBootstrapSource).not.toContain("RuntimeLayerEventsPort");
    expect(appRuntimeBootstrapSource).not.toContain("RuntimeEventBusHandle");
    expect(appRuntimeBootstrapSource).not.toContain("createRuntimeEventBusHandle");
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

  it("app bootstrap creates Effect runtime facades only at the app runtime bootstrap owner", () => {
    const appRuntimeBootstrapPattern =
      /\b(?:createRuntimeFacade|ManagedRuntime\.make)\b|["']effect\/ManagedRuntime["']/;
    const runtimeBootstrapOwners = new Set([appRuntimeBootstrapModule]);
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !runtimeBootstrapOwners.has(file))
      .filter((file) => !isTestFile(file))
      .filter((file) => appRuntimeBootstrapPattern.test(readSource(file)))
      .map(display);

    expect(violations).toEqual([]);
  });

  it("production code creates the app-owned ManagedRuntime only at the app runtime bootstrap owner", () => {
    const runtimeBootstrapOwners = new Set([appRuntimeBootstrapModule]);
    const productionRoots = [
      ...implementationPackageRoots,
      ...edgePackageRoots,
      join(projectRoot, "src", "bun"),
      mainviewSourceRoot,
      sharedSourceRoot,
    ];
    const productionFiles = productionRoots
      .flatMap((root) => listTypeScriptFiles(root))
      .filter((file) => !isTestFile(file));
    const managedRuntimeMakeViolations = productionFiles
      .filter((file) => !runtimeBootstrapOwners.has(file))
      .filter((file) => /\bManagedRuntime\.make\b/.test(readSource(file)))
      .map(display)
      .toSorted();
    const managedRuntimeValueImportViolations = productionFiles
      .filter((file) => !runtimeBootstrapOwners.has(file))
      .filter((file) =>
        /\bimport\s+(?!type\b)[^;]*["']effect\/ManagedRuntime["']/.test(readSource(file)),
      )
      .map(display)
      .toSorted();
    const runtimeRootSource = readSource(join(packageRoot, "runtime", "src", "index.ts"));

    expect(managedRuntimeMakeViolations).toEqual([]);
    expect(managedRuntimeValueImportViolations).toEqual([]);
    expect(runtimeRootSource).toMatch(
      /\bimport\s+type\s+\*\s+as\s+ManagedRuntime\s+from\s+["']effect\/ManagedRuntime["'];/,
    );
    expect(runtimeRootSource).not.toMatch(
      /\bimport\s+(?!type\b)[^;]*["']effect\/ManagedRuntime["']/,
    );
  });

  it("app runtime bootstrap construction is the single production ManagedRuntime owner", () => {
    const actual = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readManualEffectRuntimeReads(file)
          .filter((name) => name === "ManagedRuntime.make")
          .map((name) => `${display(file)} -> ${name}`),
      )
      .toSorted();

    expect(actual).toEqual(["src/bun/app-runtime-bootstrap.ts -> ManagedRuntime.make"]);
  });

  it("workspace runtime registry does not construct or run Effect runtimes directly", () => {
    const source = readSource(join(projectRoot, "src", "bun", "workspace-runtime-registry.ts"));

    expect(source).not.toMatch(/\bManagedRuntime\.make\b/);
    expect(source).not.toMatch(/\bcreateRuntimeFacade\b/);
    expect(source).not.toMatch(/\bRuntime\.layer\b/);
    expect(source).not.toMatch(/\bLayer\.provide\b/);
    expect(source).not.toMatch(/\bEffect\.runPromise\b/);
    expect(source).not.toMatch(
      /\bexport\s+(?:interface|type)\s+\w+[^=;{]*(?:ManagedRuntime|RuntimeFacade|Context)\b/,
    );
  });

  it("Electrobun shell construction is isolated to the desktop host and createDesktopApp has one product call site", () => {
    const bunFiles = listTypeScriptFiles(join(projectRoot, "src", "bun")).filter(
      (file) => !isTestFile(file),
    );
    const nativeShellOwners = bunFiles
      .filter((file) =>
        /\b(?:new BrowserWindow|ApplicationMenu\.|defineElectrobunRPC(?:<|\())/.test(
          readSource(file),
        ),
      )
      .map(display)
      .toSorted();
    const desktopAppCallSites = bunFiles
      .filter((file) => /\bcreateDesktopApp\s*\(/.test(readSource(file)))
      .map((file) => `${display(file)} -> createDesktopApp`)
      .toSorted();
    const appBootstrapSource = readSource(join(projectRoot, "src", "bun", "index.ts"));

    expect(nativeShellOwners).toEqual(["src/bun/electrobun-desktop-host.ts"]);
    expect(desktopAppCallSites).toEqual(["src/bun/index.ts -> createDesktopApp"]);
    expect(appBootstrapSource).not.toMatch(/\bnew BrowserWindow\b/);
    expect(appBootstrapSource).not.toMatch(/\bApplicationMenu\./);
    expect(appBootstrapSource).not.toMatch(/\bdefineElectrobunRPC\b/);
    expect(appBootstrapSource).not.toMatch(/\bdesktopNotificationBridge\.start\s*\(/);
    const shutdownStart = appBootstrapSource.indexOf("function shutdownDesktopApp(");
    const bootstrapStart = appBootstrapSource.indexOf("await runDesktopBootstrap(", shutdownStart);
    expect(shutdownStart).toBeGreaterThanOrEqual(0);
    expect(bootstrapStart).toBeGreaterThan(shutdownStart);
    const shutdownSource = appBootstrapSource.slice(shutdownStart, bootstrapStart);
    expect(shutdownSource).toContain('operation: "desktop.shutdown"');
    expect(shutdownSource.indexOf("rejectRendererCalls(")).toBeLessThan(
      shutdownSource.indexOf("devBrowserToolsRecorder.close()"),
    );
    expect(shutdownSource.indexOf("devBrowserToolsRecorder.close()")).toBeLessThan(
      shutdownSource.indexOf("desktopApp?.dispose()"),
    );
    expect(shutdownSource.indexOf("desktopApp?.dispose()")).toBeLessThan(
      shutdownSource.indexOf("workspaceRuntimeRegistry.shutdownApp(reason)"),
    );
  });

  it("workspace runtime registry applies committed source-domain events through @svvy/runtime", () => {
    const source = readSource(join(projectRoot, "src", "bun", "workspace-runtime-registry.ts"));
    const adapterSource = readSource(runtimeServiceAdapterModule);
    const runtimeServiceSource = readSource(
      join(packageRoot, "runtime", "src", "runtime-source-invalidation-service.ts"),
    );
    const runtimeReactionSource = readSource(
      join(packageRoot, "runtime", "src", "source-invalidation-reactions.ts"),
    );

    expect(source).toContain("facade.sourceInvalidation.applyCommittedScanEvent(input)");
    expect(adapterSource).not.toContain("source-invalidation-reactions");
    expect(adapterSource).not.toContain("reactToRuntimeSourceInvalidationEvent");
    expect(runtimeServiceSource).toContain("applyCommittedScanEvent");
    expect(runtimeServiceSource).toContain("reactToRuntimeSourceInvalidationEvent");
    expect(runtimeReactionSource).toContain("generatedPackagesForRuntimeSourceInvalidation");
    expect(runtimeReactionSource).toContain("generatedContextReasonForRuntimeSourceInvalidation");
    expect(source).not.toContain("this.runtimes.values().next().value");
    expect(source).not.toContain(
      "App-global generated-package refresh requires an acquired workspace scope",
    );
    expect(source).not.toContain("generatedPackagesForRuntimeSourceInvalidation");
    expect(source).not.toContain("generatedContextReasonForRuntimeSourceInvalidation");
  });

  it("workspace runtime operation routing does not expose runtime facades on workspace records", () => {
    const registrySource = readSource(
      join(projectRoot, "src", "bun", "workspace-runtime-registry.ts"),
    );
    const routingSource = readSource(join(projectRoot, "src", "bun", "workspace-rpc-routing.ts"));
    const expectedLedger = [
      "WorkspaceRuntimeRegistry exposes named runtime operation lookup",
      "workspace RPC routing asks registry for runtime operations",
    ];
    const actualLedger = [
      /\bgetRuntimeOperations\(workspaceId:\s*string\):\s*WorkspaceRuntimeOperations\b/.test(
        registrySource,
      )
        ? "WorkspaceRuntimeRegistry exposes named runtime operation lookup"
        : null,
      /\bgetWorkspaceRuntimeOperationsForRequest\b/.test(routingSource) &&
      /\bregistry\.getRuntimeOperations\(input\.workspaceId\)/.test(routingSource)
        ? "workspace RPC routing asks registry for runtime operations"
        : null,
    ].filter((entry): entry is string => entry !== null);
    const unexpectedRuntimeFacadeUsers = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        const path = display(file);
        const usesRuntimeFacade = /\bruntimeFacade\b/.test(source);
        if (!usesRuntimeFacade) return [];
        return path === "src/bun/workspace-runtime-registry.ts" ? [] : [path];
      })
      .toSorted();

    expect(actualLedger).toEqual(expectedLedger);
    expect(registrySource).not.toMatch(
      /export\s+type\s+WorkspaceRuntime\s*=\s*\{[^}]*runtimeFacade/s,
    );
    expect(routingSource).not.toContain(".runtimeFacade");
    expect(unexpectedRuntimeFacadeUsers).toEqual([]);
  });

  it("runtime service adapter does not construct or expose runtime facades after the cutover", () => {
    const source = readSource(runtimeServiceAdapterModule);
    expect(source).not.toContain("createCatalogBackedRuntime");
    expect(source).not.toContain("createRuntimeServiceAdapter");
    expect(source).not.toContain("ManagedRuntime.make");
    expect(source).not.toContain("createRuntimeFacade");
    expect(source).not.toContain("Runtime.layer");
    expect(readRuntimeFacadeCallIndexes(runtimeServiceAdapterModule)).toEqual([]);
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

  it("@svvy/core does not export runtime Promise facade group aliases", () => {
    const exportedCoreSymbols = new Set(
      readPublicExportedNames(join(packageRoot, "core", "src", "index.ts")),
    );
    const forbiddenSymbols = [
      "RuntimeCommandsApiPromise",
      "RuntimeSurfacesApiPromise",
      "RuntimeWorkspacesApiPromise",
    ];

    expect(forbiddenSymbols.filter((symbol) => exportedCoreSymbols.has(symbol))).toEqual([]);
    const runtimeContracts = readSource(join(packageRoot, "core", "src", "runtime-contracts.ts"));
    expect(runtimeContracts).not.toMatch(/\binterface\s+Runtime\w+ApiPromise\b/);
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

  it("Bun app edge prompt and queue ownership stays frozen to the current bridge exceptions", () => {
    const appFiles = listTypeScriptFiles(join(projectRoot, "src", "bun")).filter(
      (file) => !isTestFile(file),
    );
    const ownershipPatterns = [
      {
        pattern: /\bfacades\.runtime\.messages\.submit\s*\(/g,
        name: "facades.runtime.messages.submit",
      },
      {
        pattern: /\bfacades\.runtime\.messages\.abort\s*\(/g,
        name: "facades.runtime.messages.abort",
      },
      {
        pattern: /\bfacades\.runtime\.queues\.steer\s*\(/g,
        name: "facades.runtime.queues.steer",
      },
      {
        pattern: /\bfacades\.runtime\.messages\.editCommitted\s*\(/g,
        name: "facades.runtime.messages.editCommitted",
      },
      {
        pattern: /\bruntime\.catalog\.editQueuedSurfaceMessage\s*\(/g,
        name: "runtime.catalog.editQueuedSurfaceMessage",
      },
      {
        pattern: /\bruntime\.catalog\.reorderQueuedSurfaceMessage\s*\(/g,
        name: "runtime.catalog.reorderQueuedSurfaceMessage",
      },
    ];

    const actual = appFiles
      .flatMap((file) => {
        const source = readSource(file);
        return ownershipPatterns.flatMap(({ pattern, name }) =>
          [...source.matchAll(pattern)].map(() => `${display(file)} -> ${name}`),
        );
      })
      .toSorted();

    expect(actual).toEqual([
      "src/bun/index.ts -> facades.runtime.messages.abort",
      "src/bun/index.ts -> facades.runtime.messages.abort",
      "src/bun/index.ts -> facades.runtime.messages.editCommitted",
      "src/bun/index.ts -> facades.runtime.queues.steer",
    ]);
  });

  it("app code imports runtime-owned prompt execution construction from the runtime prompt subpath", () => {
    const runtimeOwnedPromptContextSymbols = new Set([
      "PromptExecutionRuntimeHandle",
      "createPromptExecutionContext",
    ]);
    const appFiles = listTypeScriptFiles(join(projectRoot, "src", "bun"));
    const coreViolations = appFiles
      .flatMap((file) =>
        readNamedImportNames(file, "@svvy/core")
          .filter((name) => runtimeOwnedPromptContextSymbols.has(name))
          .map((name) => `${display(file)} imports runtime-owned ${name} from @svvy/core`),
      )
      .toSorted();
    const bootstrapViolations = appFiles
      .flatMap((file) =>
        readNamedImportNames(file, "@svvy/runtime/bootstrap")
          .filter((name) => runtimeOwnedPromptContextSymbols.has(name))
          .map((name) => `${display(file)} imports runtime-owned ${name} from bootstrap`),
      )
      .toSorted();
    const promptExecutionImports = appFiles
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readImports(file)
          .filter((specifier) => specifier === "@svvy/runtime/prompt-execution-context")
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(coreViolations).toEqual([]);
    expect(bootstrapViolations).toEqual([]);
    expect(promptExecutionImports).not.toEqual([]);
  });

  it("runtime bootstrap does not re-export prompt execution context construction or live handles", () => {
    const runtimeBootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "bootstrap.ts"))),
    ];
    const forbiddenBootstrapSymbols = runtimeBootstrapSymbols.filter(
      (symbol) =>
        symbol === "PromptExecutionRuntimeHandle" || symbol === "createPromptExecutionContext",
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
    expect(source).toContain("const runtimeInternalServicesLayer = Layer.mergeAll(");
    expect(source).toContain(
      "const runtimeLaunchPolicyLayer = layerRuntimeLaunchPolicyService.pipe(Layer.provide(sandboxLayer));",
    );
    expect(source).toContain("runtimeSurfaceEventPublisherLayer");
    expect(source).toContain("layerRuntimePromptDefaultsService");
    expect(source).not.toContain("RuntimePostCommitNotificationLayer");
    expect(source).toContain("export const layer: Layer.Layer<");
    expect(source).toContain("| RuntimeStartupReadiness");
    expect(source).toContain("| RuntimeShutdownPreparation");
    expect(source).toContain("| StateCommandPostCommitNotificationPort");
    expect(source).not.toContain("RuntimeLayerRequirements");
    expect(source).toContain("| RuntimeLayerConfigService");
    expect(source).not.toContain("| RuntimeLayerPromptControlHostPort");
    expect(source).not.toContain("| RuntimeLayerSurfaceQueueWakePort");
    expect(source).toContain("| RuntimeWorkspaceStatePort");
    expect(source).toContain("| SandboxPolicySource");
    expect(source).toContain("| SandboxHelperCandidatesPort");
    expect(source).toContain("| HostProcessReferencePort");
    expect(source).toContain("Layer.effect(Runtime, makeRuntimeService())");
    expect(source).toContain(").pipe(Layer.provide(runtimeInternalServicesLayer));");
    expect(source).not.toContain("Layer.provide(layerRuntimeEventBus)");
    expect(source).not.toContain("Layer.provide(runtimeLaunchPolicyLayer)");
    expect(source).toContain("export const layer = Runtime.layer;");
    expect(source).not.toMatch(/\bexport\s+const\s+layerRuntime\b/);
    expect(source).not.toMatch(/\bexport\s+const\s+layer\s*=\s*\(\s*service\b/);
    expect(source).not.toMatch(/\bLayer\.succeed\(\s*Runtime\s*,\s*service\s*\)/);
    expect(source).not.toMatch(/\bRuntime\.layer\s*\(/);

    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    expect(runtimeLayerSource).toContain("export type RuntimeLayerRequirements =");
    const runtimeLayerRequirements = runtimeLayerSource.match(
      /export type RuntimeLayerRequirements =[\s\S]*?;\n/,
    )?.[0];
    expect(runtimeLayerRequirements).toBeDefined();
    expect(runtimeLayerRequirements).not.toContain("RuntimeRequestInputWaitService");
    expect(runtimeLayerSource).toContain("| RuntimeLayerConfigService");
    expect(runtimeLayerSource).toContain("| SandboxPolicySource");
    expect(runtimeLayerSource).toContain("| SandboxHelperCandidatesPort");
    expect(runtimeLayerSource).toContain("| HostProcessReferencePort");
    expect(runtimeLayerSource).not.toMatch(
      /Effect\.provide\(\s*layerRuntime(?:SourceInvalidation|GeneratedContextRefresh|GeneratedPackageRefresh|QueueWake|PromptDefaults|SurfaceEventPublisher)/,
    );
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
              specifier === "effect/Effect" ||
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
      "effect",
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

  it("renderer and desktop edge modules do not import extensions package code or runtime operation contracts", () => {
    const roots = [
      join(projectRoot, "src", "mainview"),
      sharedSourceRoot,
      join(packageRoot, "desktop", "src"),
    ];
    const forbiddenContractNamePattern =
      /\b(?:RuntimeEffectRequest|ExtensionRuntimeOperation|ExtensionExecutionPlan)\b/g;
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) => {
        const source = readSource(file);
        const importViolations = readImports(file)
          .filter(
            (specifier) =>
              specifier === "@svvy/extensions" || specifier.startsWith("@svvy/extensions/"),
          )
          .map((specifier) => `${display(file)} -> ${specifier}`);
        const contractNameViolations = [...source.matchAll(forbiddenContractNamePattern)].map(
          (match) => `${display(file)} -> ${match[0]}`,
        );
        return [...importViolations, ...contractNameViolations];
      }),
    );

    expect(violations).toEqual([]);
  });

  it("renderer and shared roots use product-native transcript types without pi message aliases", () => {
    const roots = [mainviewSourceRoot, sharedSourceRoot];
    const forbiddenMessageIdentifiers =
      /\b(?:AgentMessage|AssistantMessage|UserMessage|ToolResultMessage|RendererMessage|RendererAssistantMessage|RendererUserMessage|RendererToolResultMessage)\b/g;
    const forbiddenPiRoleLiterals =
      /\brole\s*:\s*["'](?:toolResult|bashExecution|custom|branchSummary|compactionSummary)["']/g;
    const forbiddenPiContentLiterals = /\btype\s*:\s*["']toolCall["']/g;
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) => {
        const source = readSource(file);
        const importViolations = readImports(file)
          .filter(
            (specifier) =>
              specifier.startsWith("@mariozechner/") ||
              specifier === "@svvy/pi-adapter" ||
              specifier.startsWith("@svvy/pi-adapter/"),
          )
          .map((specifier) => `${display(file)} -> ${specifier}`);
        const identifierViolations = [...source.matchAll(forbiddenMessageIdentifiers)].map(
          (match) => `${display(file)} -> retired message identifier ${match[0]}`,
        );
        const roleViolations = [...source.matchAll(forbiddenPiRoleLiterals)].map(
          (match) => `${display(file)} -> retired pi role ${match[0]}`,
        );
        const contentViolations = [...source.matchAll(forbiddenPiContentLiterals)].map(
          (match) => `${display(file)} -> retired pi content discriminant ${match[0]}`,
        );
        return [
          ...importViolations,
          ...identifierViolations,
          ...roleViolations,
          ...contentViolations,
        ];
      }),
    );

    expect(violations).toEqual([]);
    expect(existsSync(join(sharedSourceRoot, "renderer-message.ts"))).toBe(false);
    const rendererTranscriptSource = readSource(join(sharedSourceRoot, "renderer-transcript.ts"));
    expect(rendererTranscriptSource).toContain("RuntimeTranscriptAssistantMessage");
    expect(rendererTranscriptSource).toContain("RuntimeTranscriptMessage");
  });

  it("renderer and shared browser contracts do not import state implementation subpaths", () => {
    const roots = [join(projectRoot, "src", "mainview"), sharedSourceRoot].filter((root) =>
      existsSync(root),
    );
    const allowedRendererStateSubpaths = new Set(["@svvy/state/session-navigation"]);
    const violations = roots.flatMap((root) =>
      listTypeScriptFiles(root).flatMap((file) =>
        readImports(file)
          .filter((specifier) => specifier.startsWith("@svvy/state/"))
          .filter((specifier) => !allowedRendererStateSubpaths.has(specifier))
          .map((specifier) => `${display(file)} -> ${specifier}`),
      ),
    );

    expect(violations).toEqual([]);
  });

  it("extracted packages call caller-owned ManagedRuntime runners only from facade factories", () => {
    const runnerPattern =
      /\b([A-Za-z_$][\w$]*)\s*\.\s*(run(?:Promise|PromiseExit|Sync|SyncExit|Fork|Callback)(?:With)?)\b/g;
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
      "packages/pi-adapter/src/pi-adapter.ts -> Effect.runPromiseExitWith",
      "packages/pi-adapter/src/pi-adapter.ts -> Effect.runPromiseExitWith",
      "packages/pi-adapter/src/pi-adapter.ts -> Effect.runPromiseWith",
      "packages/pi-adapter/src/pi-adapter.ts -> Effect.runPromiseWith",
      "packages/pi-adapter/src/pi-adapter.ts -> Effect.runPromiseWith",
      "packages/pi-adapter/src/pi-adapter.ts -> Effect.runPromiseWith",
      "packages/runtime/src/accepted-native-tool-execution.ts -> managedRuntime.runPromise",
      "packages/runtime/src/app-log-commit-notification-adapter.ts -> managedRuntime.runPromise",
      "packages/runtime/src/committed-state-invalidation-adapter.ts -> managedRuntime.runPromise",
      "packages/runtime/src/index.ts -> managedRuntime.runPromiseExit",
      "packages/runtime/src/runtime-layer-config.ts -> managedRuntime.runPromise",
      "packages/runtime/src/runtime-layer-config.ts -> managedRuntime.runPromiseExit",
      "packages/runtime/src/source-invalidation-coordinator-adapter.ts -> Effect.runPromise",
      "packages/state/src/state-facade.ts -> managedRuntime.runPromiseExit",
    ]);
  });

  it("production ManagedRuntime instance member reads match the adopted instance policy", () => {
    const actual = [
      ...sourceRoots.flatMap((root) => listTypeScriptFiles(root)),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
    ]
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readManagedRuntimeInstanceMemberReads(file).map(
          ({ receiver, member }) => `${display(file)} -> ${receiver}.${member}`,
        ),
      )
      .toSorted();

    const policyEntries = adoptedEffectInstanceMemberPolicies
      .filter(
        (entry) =>
          entry.module === "effect/ManagedRuntime" &&
          entry.receiver === "ManagedRuntime.ManagedRuntime",
      )
      .flatMap((entry) =>
        entry.allowedSourceGlobs.flatMap((sourceGlob) =>
          entry.members.map((member) => `${sourceGlob} -> managedRuntime.${member}`),
        ),
      )
      .toSorted();

    expect(actual).toEqual([
      "packages/runtime/src/accepted-native-tool-execution.ts -> managedRuntime.runPromise",
      "packages/runtime/src/app-log-commit-notification-adapter.ts -> managedRuntime.runPromise",
      "packages/runtime/src/committed-state-invalidation-adapter.ts -> managedRuntime.runPromise",
      "packages/runtime/src/index.ts -> managedRuntime.runPromiseExit",
      "packages/runtime/src/runtime-layer-config.ts -> managedRuntime.runPromise",
      "packages/runtime/src/runtime-layer-config.ts -> managedRuntime.runPromiseExit",
      "packages/state/src/state-facade.ts -> managedRuntime.runPromiseExit",
      "src/bun/app-runtime-bootstrap.ts -> managedRuntime.context",
      "src/bun/app-runtime-bootstrap.ts -> managedRuntime.dispose",
      "src/bun/app-runtime-bootstrap.ts -> managedRuntime.runPromise",
    ]);
    expect(policyEntries).toEqual(actual);
  });

  it("injected Effect service instance member scanner covers named imports and aliases", () => {
    const actual = readInjectedEffectServiceInstanceMemberReadsFromSource(
      "scanner-fixture.ts",
      `
        import { FileSystem as FS } from "effect/FileSystem";
        import type { Path as PathService } from "effect/Path";
        import { make as makeSemaphore } from "effect/Semaphore";

        export const program = Effect.gen(function* () {
          const fs = yield* FS;
          yield* fs.writeFileString("/tmp/out.txt", "ok");
          const semaphore = yield* makeSemaphore(1);
          yield* semaphore.withPermit(Effect.void);
        });

        export function readPath(pathService: PathService) {
          return pathService.basename("/tmp/out.txt");
        }
      `,
    ).map(({ module, receiver, member }) => `${module} ${receiver}.${member}`);

    expect(actual).toEqual([
      "effect/FileSystem FileSystem.FileSystem.writeFileString",
      "effect/Semaphore Semaphore.Semaphore.withPermit",
      "effect/Path Path.Path.basename",
    ]);
  });

  it("manual Effect runtime scanner covers aliases without regex blind spots", () => {
    const fixture = join(projectRoot, "scanner-fixture.ts");
    const source = `
      import { Effect as RootEffect } from "effect";
      import * as FX from "effect/Effect";
      import { runSync as runEffectSync } from "effect/Effect";
      import * as MR from "effect/ManagedRuntime";
      import { make as makeManagedRuntime } from "effect/ManagedRuntime";
      import * as EffectLayer from "effect/Layer";
      import { launch as launchLayer } from "effect/Layer";

      const EffectAlias = RootEffect;
      const DynamicEffect = await import("effect/Effect");
      const DynamicManagedRuntime = await import("effect/ManagedRuntime");
      const DynamicLayer = await import("effect/Layer");
      const { runPromise: promiseRunner } = FX;
      const runtimeFromNamespace = MR["make"](layer);
      const runtimeFromNamed = makeManagedRuntime(layer);
      const { make: makeRuntimeAlias } = MR;
      const runtimeFromAlias = makeRuntimeAlias(layer);
      const { launch: launchLayerAlias } = EffectLayer;

      EffectAlias["runSync"](program);
      promiseRunner(program);
      runEffectSync(program);
      DynamicEffect.runPromise(program);
      DynamicManagedRuntime.make(layer);
      DynamicLayer.launch(layer);
      launchLayer(layer);
      launchLayerAlias(layer);
      runMain(program);
    `;
    const sourceFile = ts.createSourceFile(fixture, source, ts.ScriptTarget.Latest, true);
    const bindings = readValueImportBindingsFromSourceFile(sourceFile, "effect/Effect").map(
      (binding) =>
        binding.kind === "namespace"
          ? `${binding.kind}:${binding.localName}`
          : `${binding.kind}:${binding.importedName}:${binding.localName}`,
    );

    const actual = readManualEffectRuntimeReadsFromSource(fixture, source);

    expect(bindings).toEqual(["namespace:FX", "named:runSync:runEffectSync"]);
    expect(actual).toEqual([
      "Effect.runPromise",
      "ManagedRuntime.make",
      "ManagedRuntime.make",
      "ManagedRuntime.make",
      "Layer.launch",
      "Effect.runSync",
      "Effect.runSync",
      "Effect.runPromise",
      "ManagedRuntime.make",
      "Layer.launch",
      "Layer.launch",
      "runMain",
    ]);
  });

  it("module specifier scanner covers static, runtime, export, and Svelte script imports", () => {
    const source = `
      import defaultExport from "static-default";
      import type { TypeOnly } from "static-type";
      export { value } from "static-export";
      const dynamicModule = import("runtime-import");
      const requiredModule = require("runtime-require");
      // import "commented-out";
      const text = "require('string-only')";
    `;
    const svelteSource = `
      <h1>require("markup-only")</h1>
      <script lang="ts">
        import Component from "svelte-static";
        const lazy = import("svelte-runtime");
      </script>
    `;

    expect(
      readModuleSpecifiersFromSource("scanner-fixture.ts", source, new Set(["static"])),
    ).toEqual(["static-default", "static-type", "static-export"]);
    expect(
      readModuleSpecifiersFromSource("scanner-fixture.ts", source, new Set(["runtime"])),
    ).toEqual(["runtime-import", "runtime-require"]);
    expect(
      readModuleSpecifiersFromSource(
        "scanner-fixture.svelte",
        svelteSource,
        new Set(["static", "runtime"]),
      ),
    ).toEqual(["svelte-static", "svelte-runtime"]);
  });

  it("Effect Schema scanner covers compiler and asserts aliases without regex blind spots", () => {
    const source = `
      import * as S from "effect/Schema";
      import { decodeUnknownEffect as decodeNamed, asserts as assertNamed } from "effect/Schema";

      const SchemaAlias = S;
      const decodeAlias = SchemaAlias["decodeUnknownSync"];
      const { decodeEffect: decodeFromBinding, asserts: assertFromBinding } = S;

      // Schema.decodeUnknownEffect(MySchema)(value);
      const compiled = S.decodeUnknownEffect(MySchema);
      decodeAlias(MySchema)(value);
      decodeFromBinding(MySchema)(value);
      decodeNamed(MySchema)(value);
      SchemaAlias["asserts"](MySchema)(value);
      assertFromBinding(MySchema)(value);
      assertNamed(MySchema)(value);
    `;

    expect(
      readEffectSchemaCompilerConstructionReadsFromSource("scanner-fixture.ts", source),
    ).toEqual([
      {
        index: source.indexOf("decodeAlias(MySchema)"),
        label: "effect/Schema decodeUnknownSync namespace alias",
      },
      {
        index: source.indexOf("decodeFromBinding(MySchema)"),
        label: "effect/Schema decodeEffect namespace alias",
      },
      {
        index: source.indexOf("decodeNamed(MySchema)"),
        label: "effect/Schema decodeUnknownEffect named import",
      },
    ]);
    expect(readEffectSchemaAssertReadsFromSource("scanner-fixture.ts", source)).toEqual([
      "effect/Schema asserts namespace alias",
      "effect/Schema asserts",
      "effect/Schema asserts",
    ]);
  });

  it("ManagedRuntime instance member scanner covers aliases and string-literal reads", () => {
    const actual = readManagedRuntimeInstanceMemberReadsFromSource(
      "scanner-fixture.ts",
      `
        import * as MR from "effect/ManagedRuntime";
        import { make as makeManagedRuntime } from "effect/ManagedRuntime";

        const runtimeA = MR.make(layer);
        const runtimeB = makeManagedRuntime(layer);
        const runtimeC = runtimeA;
        runtimeA.context();
        runtimeB["runPromise"](program);
        runtimeC.dispose();
        managedRuntime["runPromiseExit"](program);
      `,
    ).map(({ receiver, member }) => `${receiver}.${member}`);

    expect(actual).toEqual([
      "runtimeA.context",
      "runtimeB.runPromise",
      "runtimeC.dispose",
      "managedRuntime.runPromiseExit",
    ]);
  });

  it("production injected Effect service instance member reads match the adopted instance policy", () => {
    const actual = [
      ...sourceRoots.flatMap((root) => listTypeScriptFiles(root)),
      ...listTypeScriptFiles(join(projectRoot, "src", "bun")),
    ]
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readInjectedEffectServiceInstanceMemberReads(file).map(
          ({ module, receiver, member }) => `${display(file)} -> ${module} ${receiver}.${member}`,
        ),
      );

    const uniqueActual = [...new Set(actual)].toSorted();
    const policyEntries = adoptedEffectInstanceMemberPolicies
      .filter(
        (entry) =>
          !(
            entry.module === "effect/ManagedRuntime" &&
            entry.receiver === "ManagedRuntime.ManagedRuntime"
          ),
      )
      .flatMap((entry) =>
        entry.allowedSourceGlobs.flatMap((sourceGlob) =>
          entry.members.map(
            (member) => `${sourceGlob} -> ${entry.module} ${entry.receiver}.${member}`,
          ),
        ),
      )
      .toSorted();

    expect(uniqueActual).toEqual(policyEntries);
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

  it("@svvy/state root does not re-export structured session selector APIs", () => {
    const selectorSymbols = readPublicExportedNames(
      join(packageRoot, "state", "src", "structured-session-selectors.ts"),
    );
    const actual = readPublicExportedNames(join(packageRoot, "state", "src", "index.ts"))
      .filter((symbol) => selectorSymbols.includes(symbol))
      .toSorted();

    expect(actual).toEqual([]);
  });

  it("@svvy/state root does not expose structured-session adapters", () => {
    const leakPatterns = [
      /(?:^|[A-Z])Store(?:$|[A-Z])/,
      /FromStore$/,
      /FromStructuredSessionState$/,
      /StateService$/,
      /^layer.*State$/,
      /^create.*Store$/,
      /^StructuredSessionState$/,
      /^StructuredSessionStatePorts$/,
      /^structuredSessionStateFromStore$/,
      /^structuredSessionStatePortsLayer$/,
      /^layerStructuredSessionStatePorts$/,
      /^make.*StatePort$/,
      /^makeSandboxPolicySource$/,
      /^sandboxPolicySourceFromSettings$/,
    ];
    const actual = readPublicExportedNames(join(packageRoot, "state", "src", "index.ts"))
      .filter((symbol) => leakPatterns.some((pattern) => pattern.test(symbol)))
      .toSorted();

    expect(actual).toEqual([]);
  });

  it("@svvy/state structured-session adapters do not expose aggregate state-port bundles", () => {
    const exported = readPublicExportedNames(
      join(packageRoot, "state", "src", "structured-session-adapters.ts"),
    );
    const actual = exported
      .filter((symbol) =>
        [
          /^StructuredSessionStatePorts$/,
          /^structuredSessionStatePortsLayer$/,
          /^layerStructuredSessionStatePorts$/,
        ].some((pattern) => pattern.test(symbol)),
      )
      .toSorted();

    expect(actual).toEqual([]);

    const sanctionedAggregateLayers = exported
      .filter((symbol) => symbol === "layerWorkspaceStateRouter")
      .toSorted();

    expect(sanctionedAggregateLayers).toEqual(["layerWorkspaceStateRouter"]);
  });

  it("@svvy/state sandbox policy layer is a zero-argument structured-session projection", () => {
    const source = readSource(join(packageRoot, "state", "src", "sandbox-policy-source.ts"));

    expect(source).toContain("yield* StructuredSessionState");
    expect(source).toContain(
      "Layer.effect(\n  SandboxPolicySource,\n  makeSandboxPolicySource(),\n)",
    );
    expect(source).not.toMatch(/export\s+type\s+SandboxPolicySourceSettings/);
    expect(source).not.toMatch(/export\s+function\s+sandboxPolicySourceFromSettings/);
    expect(source).not.toMatch(/export\s+const\s+makeSandboxPolicySource/);
    expect(source).not.toMatch(/layerSandboxPolicySource\s*=\s*\([^)]/);
  });

  it("@svvy/state root uses explicit named re-exports only", () => {
    const source = readSource(join(packageRoot, "state", "src", "index.ts"));
    expect(source.match(/^export\s+\*\s+from\s+["']/gm) ?? []).toEqual([]);
  });

  it("@svvy/sandbox root exposes only the explicit public export ledger", () => {
    const source = readSource(join(packageRoot, "sandbox", "src", "index.ts"));
    const actual = readPublicExportedNames(join(packageRoot, "sandbox", "src", "index.ts"));
    const expected = expectedPublicSymbols.get("@svvy/sandbox") ?? [];

    expect(source.match(/^export\s+\*\s+from\s+["']/gm) ?? []).toEqual([]);
    expect(actual.toSorted()).toEqual(expected.toSorted());
  });

  it("Bun production code has only approved sandbox diagnostics and path-access imports", () => {
    const actual = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter(
            (specifier) => specifier === "@svvy/sandbox" || specifier.startsWith("@svvy/sandbox/"),
          )
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actual).toEqual(expectedSandboxAppImports);
  });

  it("@svvy/sandbox has no caller-owned launch-policy compatibility module", () => {
    const sandboxSourceFiles = listTypeScriptFiles(join(packageRoot, "sandbox", "src"));
    const actual = sandboxSourceFiles
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter(
            (specifier) =>
              specifier === "./launch-policy" || specifier === "@svvy/sandbox/launch-policy",
          )
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(existsSync(join(packageRoot, "sandbox", "src", "launch-policy.ts"))).toBe(false);
    expect(actual).toEqual([]);
  });

  it("Bun production code imports runtime bootstrap only at named app-bootstrap edges", () => {
    const actual = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier === "@svvy/runtime/bootstrap")
          .map((specifier) => `${display(file)} -> ${specifier}`),
      )
      .toSorted();

    expect(actual).toEqual([
      "src/bun/app-runtime-bootstrap.ts -> @svvy/runtime/bootstrap",
      "src/bun/index.ts -> @svvy/runtime/bootstrap",
      "src/bun/live-command-stdin-registry.ts -> @svvy/runtime/bootstrap",
      "src/bun/runtime-service-adapter.ts -> @svvy/runtime/bootstrap",
      "src/bun/session-catalog.ts -> @svvy/runtime/bootstrap",
      "src/bun/source-watch-inputs.ts -> @svvy/runtime/bootstrap",
      "src/bun/workspace-runtime-registry.ts -> @svvy/runtime/bootstrap",
    ]);
  });

  it("desktop and renderer code do not import runtime bootstrap directly", () => {
    const roots = [join(packageRoot, "desktop", "src"), mainviewSourceRoot, sharedSourceRoot];
    const actual = roots
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readStaticSourceImports(file)
              .filter((specifier) => specifier === "@svvy/runtime/bootstrap")
              .map((specifier) => `${display(file)} -> ${specifier}`),
          ),
      )
      .toSorted();

    expect(actual).toEqual([]);
  });

  it("sandbox launch internals are not imported by app or package production code", () => {
    const roots = [
      appSourceRoot,
      ...sourceRoots.filter((root) => root !== join(packageRoot, "sandbox", "src")),
    ];
    const actual = roots
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readStaticSourceImports(file)
              .filter((specifier) => specifier === "@svvy/sandbox/launch-internals")
              .map((specifier) => `${display(file)} -> ${specifier}`),
          ),
      )
      .toSorted();

    expect(actual).toEqual([]);
  });

  it("sandbox app-edge launch policy is not a production import surface", () => {
    const roots = [
      appSourceRoot,
      ...sourceRoots.filter((root) => root !== join(packageRoot, "sandbox", "src")),
    ];
    const actual = roots
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readStaticSourceImports(file)
              .filter((specifier) => specifier === "@svvy/sandbox/app-edge-launch-policy")
              .map((specifier) => `${display(file)} -> ${specifier}`),
          ),
      )
      .toSorted();

    expect(actual).toEqual([]);
  });

  it("sandbox launch-policy acquisition is centralized in the package-private runtime adapter", () => {
    const runtimeSourceRoot = join(packageRoot, "runtime", "src");
    const forbidden = new Set([
      "RuntimeLaunchPolicyService",
      "RuntimeLaunchPolicyServiceService",
      "layerRuntimeLaunchPolicyService",
    ]);
    const actual = [appSourceRoot, ...sourceRoots]
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) => {
            const source = readFileSync(file, "utf8");
            return source.includes(".buildLaunchPolicy(") ? [display(file)] : [];
          }),
      )
      .toSorted();

    expect(actual).toEqual(["packages/runtime/src/runtime-launch-policy-service.ts"]);

    const adapterSource = readFileSync(
      join(runtimeSourceRoot, "runtime-launch-policy-service.ts"),
      "utf8",
    );
    expect(adapterSource).toContain("sandbox.buildLaunchPolicy(input)");
    expect(adapterSource).toContain("new RuntimeContractError");
    expect(adapterSource).toContain(
      'cause.reason === "helper-unavailable" ? "target-not-ready" : "state-conflict"',
    );
    expect(adapterSource).not.toContain("throw cause");
    expect(adapterSource).toMatch(
      /build:\s*Effect\.fn\(\s*["']@svvy\/runtime\/launchPolicy\.build["']\s*\)\s*\(\s*function\*\s*\(\s*input\s*\)/,
    );

    const runtimeRootSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "index.ts"))),
    ];
    const runtimeBootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "bootstrap.ts"))),
    ];
    const consumerRoots = [
      join(projectRoot, "src", "bun"),
      join(packageRoot, "desktop", "src"),
      join(packageRoot, "state", "src"),
      join(packageRoot, "extensions", "src"),
      join(packageRoot, "pi-adapter", "src"),
      join(packageRoot, "sandbox", "src"),
    ];
    const consumerViolations = consumerRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          [
            ...readNamedImportNames(file, "@svvy/runtime"),
            ...readNamedImportNames(file, "@svvy/runtime/bootstrap"),
          ]
            .filter((name) => forbidden.has(name))
            .map((name) => `${display(file)} imports ${name}`),
        ),
    );

    expect(runtimeRootSymbols.filter((symbol) => forbidden.has(symbol))).toEqual([]);
    expect(runtimeBootstrapSymbols.filter((symbol) => forbidden.has(symbol))).toEqual([]);
    expect(consumerViolations).toEqual([]);

    const privateLaunchModuleImportViolations = [
      appSourceRoot,
      ...sourceRoots.filter((root) => root !== runtimeSourceRoot),
    ].flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .flatMap((file) =>
          readStaticSourceImports(file)
            .filter(
              (specifier) =>
                specifier.includes("runtime-launch-policy-service") ||
                specifier.includes("runtime-direct-tool-launch-policy"),
            )
            .map((specifier) => `${display(file)} -> ${specifier}`),
        ),
    );
    expect(privateLaunchModuleImportViolations).toEqual([]);
  });

  it("runtime direct-tool launch mapper stays package-private and pins launch-kind mapping", () => {
    const runtimeSourceRoot = join(packageRoot, "runtime", "src");
    const mapperPath = join(runtimeSourceRoot, "runtime-direct-tool-launch-policy.ts");
    const mapperSource = readSource(mapperPath);
    const forbiddenPublicSymbols = new Set([
      "RuntimeDirectToolLaunchToolName",
      "RuntimeDirectToolLaunchPolicyInput",
      "buildRuntimeDirectToolLaunchFacts",
    ]);
    const runtimeRootSymbols = [
      ...new Set(readPublicExportedNames(join(runtimeSourceRoot, "index.ts"))),
    ];
    const runtimeBootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(runtimeSourceRoot, "bootstrap.ts"))),
    ];
    const mapperImportConsumers = listTypeScriptFiles(runtimeSourceRoot)
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readStaticSourceImports(file)
          .filter((specifier) => specifier === "./runtime-direct-tool-launch-policy")
          .map(() => display(file)),
      )
      .toSorted();

    expect(mapperSource).toMatch(
      /Effect\.fn\(\s*["']@svvy\/runtime\/directToolLaunchPolicy\.build["']\s*,?\s*\)/,
    );
    expect(mapperSource).toContain('Omit<BuildLaunchPolicyInput, "launchKind">');
    expect(mapperSource).toContain("readonly toolName: RuntimeDirectToolLaunchToolName");
    expect(mapperSource).toContain("RuntimeLaunchPolicyService");
    expect(mapperSource).not.toContain("@svvy/sandbox");
    expect(mapperSource).toContain("launchKind: launchKindByToolName[toolName]");
    expect(mapperSource).toContain('exec_command: "direct_shell"');
    expect(mapperSource).toContain('apply_patch: "direct_apply_patch"');
    expect(mapperSource).toContain('execute_typescript: "execute_typescript_runtime"');
    expect(mapperSource).toContain(
      "satisfies Record<RuntimeDirectToolLaunchToolName, SandboxLaunchKind>",
    );
    expect(runtimeRootSymbols.filter((symbol) => forbiddenPublicSymbols.has(symbol))).toEqual([]);
    expect(runtimeBootstrapSymbols.filter((symbol) => forbiddenPublicSymbols.has(symbol))).toEqual(
      [],
    );
    expect(mapperImportConsumers).toEqual([
      "packages/runtime/src/accepted-native-tool-execution-service.ts",
    ]);
  });

  it("restricted state structured-session subpaths are consumed only by named production bootstrap edges", () => {
    const restrictedSubpaths = new Set([
      "@svvy/state/structured-session-state",
      "@svvy/state/structured-session-adapters",
      "@svvy/state/structured-session-projections",
    ]);
    const roots = [
      appSourceRoot,
      ...sourceRoots.filter((root) => root !== join(packageRoot, "state", "src")),
    ];
    const actual = roots
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readStaticSourceImports(file)
              .filter((specifier) => restrictedSubpaths.has(specifier))
              .map((specifier) => `${display(file)} -> ${specifier}`),
          ),
      )
      .toSorted();

    expect(actual).toEqual([
      "src/bun/app-runtime-bootstrap.ts -> @svvy/state/structured-session-adapters",
      "src/bun/session-catalog.ts -> @svvy/state/structured-session-adapters",
      "src/bun/session-catalog.ts -> @svvy/state/structured-session-state",
    ]);
  });

  it("pi managed session bridge is consumed only by session-catalog production bootstrap", () => {
    const actual = [appSourceRoot, ...sourceRoots]
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readStaticSourceImports(file)
              .filter((specifier) => specifier === "@svvy/pi-adapter/session")
              .map((specifier) => `${display(file)} -> ${specifier}`),
          ),
      )
      .toSorted();

    expect(actual).toEqual(["src/bun/session-catalog.ts -> @svvy/pi-adapter/session"]);
  });

  it("pi message conversion bridge is absent from production consumers", () => {
    const actual = [appSourceRoot, ...sourceRoots]
      .filter((root) => existsSync(root))
      .flatMap((root) =>
        listTypeScriptFiles(root)
          .filter((file) => !isTestFile(file))
          .flatMap((file) =>
            readStaticSourceImports(file)
              .filter((specifier) => specifier === "@svvy/pi-adapter/messages")
              .map((specifier) => `${display(file)} -> ${specifier}`),
          ),
      )
      .toSorted();

    expect(actual).toEqual([]);
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

  it("@svvy/state root does not export standalone app-log facade or logger APIs", () => {
    const forbiddenNames = new Set([
      "AppLogAppendInput",
      "AppLogAppender",
      "AppLogDetails",
      "AppLogFacade",
      "AppLogger",
      "AppLoggerEvent",
      "CreateAppLogFacadeOptions",
      "CreateAppLoggerOptions",
      "appendAppLoggerEvent",
      "createAppLogFacade",
      "createAppLogger",
      "redactAppLogValue",
    ]);
    const actual = readPublicExportedNames(join(packageRoot, "state", "src", "index.ts"))
      .filter((symbol) => forbiddenNames.has(symbol))
      .toSorted();

    expect(actual).toEqual([]);
  });

  it("Bun production code does not import app-log logger or redaction helpers from @svvy/state root", () => {
    const forbiddenNames = new Set([
      "AppLogAppendInput",
      "AppLogAppender",
      "AppLogDetails",
      "AppLogFacade",
      "AppLogger",
      "AppLoggerEvent",
      "CreateAppLogFacadeOptions",
      "CreateAppLoggerOptions",
      "appendAppLoggerEvent",
      "createAppLogFacade",
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

  it("Bun app bootstrap keeps Effect layer and ManagedRuntime construction in the app runtime bootstrap owner", () => {
    const forbiddenPatterns = [
      { pattern: /\bLayer\./g, name: "Layer.*" },
      { pattern: /\bManagedRuntime\.make\b/g, name: "ManagedRuntime.make" },
    ];
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => file !== appRuntimeBootstrapModule)
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        const directViolations = forbiddenPatterns.flatMap(({ pattern, name }) =>
          [...source.matchAll(pattern)]
            .filter(
              () =>
                !(
                  display(file) === "src/bun/extension-lifecycle-authority.ts" && name === "Layer.*"
                ),
            )
            .map(() => `${display(file)} -> ${name}`),
        );
        const importViolations = readImports(file)
          .filter(
            (specifier) => specifier === "effect/Layer" || specifier === "effect/ManagedRuntime",
          )
          .filter(
            (specifier) =>
              !(
                display(file) === "src/bun/extension-lifecycle-authority.ts" &&
                specifier === "effect/Layer"
              ),
          )
          .map((specifier) => `${display(file)} -> ${specifier}`);
        return [...directViolations, ...importViolations];
      });

    expect(violations).toEqual([]);
  });

  it("Bun production code does not export generic Effect runners", () => {
    const runRuntimeEffectDeclarationPattern =
      /\b(?:export\s+)?(?:async\s+)?function\s+runRuntimeEffect\b|\b(?:export\s+)?const\s+runRuntimeEffect\b/g;
    const violations = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        Array.from(readSource(file).matchAll(runRuntimeEffectDeclarationPattern), (match) =>
          match[0].startsWith("export") ? display(file) : null,
        ).filter((entry): entry is string => entry !== null),
      )
      .toSorted();

    expect(violations).toEqual([]);
  });

  it("app-side manual Effect runtime execution stays limited to the named bootstrap exception set", () => {
    const steadyStateBootstrapRuntimeReads = new Map<string, string[]>([
      ["src/bun/app-runtime-bootstrap.ts", ["ManagedRuntime.make"]],
      ["src/bun/index.ts", ["Effect.runSync"]],
    ]);
    const sessionCatalogRunnerExceptionReads = new Map<string, string[]>([
      ["src/bun/extension-lifecycle-authority.ts", ["Effect.runPromise"]],
      ["src/bun/runtime-service-adapter.ts", ["Effect.runPromise"]],
      ["src/bun/session-catalog.ts", ["Effect.runSync"]],
    ]);
    const allowedManualRuntimeReads = new Map<string, string[]>([
      ...steadyStateBootstrapRuntimeReads,
      ...sessionCatalogRunnerExceptionReads,
    ]);
    const actualManualRuntimeReads = new Map<string, string[]>();

    for (const file of listTypeScriptFiles(join(projectRoot, "src", "bun")).filter(
      (candidate) => !isTestFile(candidate),
    )) {
      const found = readManualEffectRuntimeReads(file);
      if (found.length > 0) {
        actualManualRuntimeReads.set(display(file), found.toSorted());
      }
    }

    const sessionCatalogManualRunners = actualManualRuntimeReads.get("src/bun/session-catalog.ts");

    expect({
      actualManualRuntimeReads: [...actualManualRuntimeReads.entries()].toSorted(),
      sessionCatalogManualRunners,
      sessionCatalogRunPromiseReads: sessionCatalogManualRunners?.filter((name) =>
        name.startsWith("Effect.runPromise"),
      ),
      sessionCatalogRunnerExceptionReads: [
        ...sessionCatalogRunnerExceptionReads.entries(),
      ].toSorted(),
    }).toEqual({
      actualManualRuntimeReads: [...allowedManualRuntimeReads.entries()].toSorted(),
      sessionCatalogManualRunners: ["Effect.runSync"],
      sessionCatalogRunPromiseReads: [],
      sessionCatalogRunnerExceptionReads: [
        ["src/bun/extension-lifecycle-authority.ts", ["Effect.runPromise"]],
        ["src/bun/runtime-service-adapter.ts", ["Effect.runPromise"]],
        ["src/bun/session-catalog.ts", ["Effect.runSync"]],
      ],
    });
  });

  it("app-side ManagedRuntime construction stays in the named bootstrap owner", () => {
    const actual = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readManualEffectRuntimeReads(file)
          .filter((name) => name === "ManagedRuntime.make")
          .map((name) => `${display(file)} -> ${name}`),
      )
      .toSorted();

    expect(actual).toEqual(["src/bun/app-runtime-bootstrap.ts -> ManagedRuntime.make"]);
  });

  it("app-side Bun tests that manually run Effect stay in the named harness ledger", () => {
    const actual = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => file.endsWith(".test.ts"))
      .flatMap((file) =>
        readManualEffectRuntimeReads(file).map((name) => `${display(file)} -> ${name}`),
      )
      .toSorted();

    expect(actual).toEqual([
      "src/bun/app-runtime-bootstrap.test.ts -> Effect.runPromise",
      "src/bun/app-runtime-bootstrap.test.ts -> Effect.runPromise",
      "src/bun/app-runtime-bootstrap.test.ts -> Effect.runPromise",
      "src/bun/execute-typescript-tool.test.ts -> Effect.runSync",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      "src/bun/extension-env-secret-store.test.ts -> Effect.runPromise",
      ...Array(20).fill("src/bun/extension-snapshot-storage.test.ts -> Effect.runPromise"),
      "src/bun/extension-tools.test.ts -> Effect.runSync",
      "src/bun/native-sandbox-helper-package.test.ts -> Effect.runPromise",
      "src/bun/native-sandbox-helper-package.test.ts -> Effect.runPromise",
      "src/bun/native-sandbox-helper-package.test.ts -> Effect.runPromise",
      "src/bun/native-sandbox-helper-package.test.ts -> Effect.runPromise",
      "src/bun/ordered-runtime-state-write-lane.test.ts -> Effect.runSync",
      "src/bun/ordered-runtime-state-write-lane.test.ts -> Effect.runSync",
      "src/bun/ordered-runtime-state-write-lane.test.ts -> Effect.runSync",
      "src/bun/runtime-service-adapter.test.ts -> Effect.runSync",
      "src/bun/runtime-service-adapter.test.ts -> Effect.runSync",
      "src/bun/runtime-state-tools.test.ts -> Effect.runSync",
      "src/bun/session-catalog.test.ts -> Effect.runPromise",
      "src/bun/streaming-command-tracker.test.ts -> Effect.runSync",
      "src/bun/streaming-command-tracker.test.ts -> Effect.runSync",
      "src/bun/streaming-command-tracker.test.ts -> Effect.runSync",
      "src/bun/svvy-direct-tools.test.ts -> Effect.runPromise",
      "src/bun/svvy-direct-tools.test.ts -> Effect.runSync",
      "src/bun/svvy-direct-tools.test.ts -> Effect.runSync",
      "src/bun/svvy-direct-tools.test.ts -> Effect.runSync",
      "src/bun/svvyx-extensions-command.test.ts -> Effect.runPromise",
      "src/bun/thread-orchestration-tools.test.ts -> Effect.runSync",
      "src/bun/thread-report-tool.test.ts -> Effect.runSync",
      "src/bun/thread-start-tool.test.ts -> Effect.runSync",
      "src/bun/tool-execution-command-tracker.test.ts -> Effect.runSync",
      "src/bun/tool-execution-command-tracker.test.ts -> Effect.runSync",
      "src/bun/workspace-recovery-coordinator.test.ts -> Effect.runSync",
      "src/bun/workspace-runtime-registry.test.ts -> Effect.runPromise",
    ]);
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
    const allowedSharedPackageSubpaths = new Set(["@svvy/state", "@svvy/state/session-navigation"]);
    const violations = listTypeScriptFiles(sharedSourceRoot).flatMap((file) =>
      isTestFile(file)
        ? []
        : readImports(file)
            .filter((specifier) => !allowedSharedPackageSubpaths.has(specifier))
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

    const sharedStateRootConsumers = listTypeScriptFiles(sharedSourceRoot)
      .filter((file) => !isTestFile(file) && readImports(file).includes("@svvy/state"))
      .map(display);
    expect(sharedStateRootConsumers).toEqual(["src/shared/workspace-contract.ts"]);
    expect(
      readStaticTypeOnlyImportViolations(
        join(sharedSourceRoot, "workspace-contract.ts"),
        new Set(["@svvy/state"]),
      ),
    ).toEqual([]);
    expect(
      readNamedImportNames(
        join(sharedSourceRoot, "workspace-contract.ts"),
        "@svvy/state",
      ).toSorted(),
    ).toEqual(
      [
        "AgentActorExtensionDefaultsReadModelRecord",
        "AgentBindingReadModelRecord",
        "AgentsReadModel",
        "CommandInspectorReadModel",
        "ConfiguredAgentProfileReadModelRecord",
        "CreateManagedSnippetCommandInput",
        "DeleteManagedSnippetCommandInput",
        "DeleteOrchestratorProfileCommandInput",
        "GeneratedContextPreviewReadModelRecord",
        "MarkAppLogReadCommandInput",
        "MarkSessionReadCommandInput",
        "MarkSessionUnreadCommandInput",
        "PromoteProfileExtensionDefaultCommandInput",
        "PromptHistoryReadModel",
        "PromptHistoryReadModelEntry",
        "PromptHistoryReadModelRequest",
        "ReorderOrchestratorProfilesCommandInput",
        "ResetActorExtensionDefaultsCommandInput",
        "SaveWorkspaceLayoutSlotCommandInput",
        "SelectWorkspaceLayoutSlotCommandInput",
        "SelectWorkspaceTabCommandInput",
        "SetExternalInstructionActorUsageCommandInput",
        "SetProfileExtensionUsageCommandInput",
        "SetSessionArchivedCommandInput",
        "SetSessionNavigationSectionStateCommandInput",
        "SetSessionPinnedCommandInput",
        "SetSnippetEnabledCommandInput",
        "SetWorkspaceTabsCommandInput",
        "StateCommandResult",
        "UpdateAppPreferencesCommandInput",
        "UpdateManagedSnippetCommandInput",
        "UpdateOrchestratorProfileCommandInput",
        "UpdateThreadHandlerProfileCommandInput",
      ].toSorted(),
    );
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
    const packageViolations = Array.from(expectedPackageDependencies.entries()).flatMap(
      ([packageName, dependencies]) => {
        if (!dependencies.includes("effect")) {
          return [];
        }
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

  it("@svvy/runtime production source does not use direct host transport APIs", () => {
    const forbiddenImportSpecifiers =
      /^(?:node:(?:http|https|http2|net|tls|dgram)|(?:http|https|http2|net|tls|dgram)|bun|undici|axios|got|ky|ofetch|@effect\/platform\/(?:HttpClient|HttpClientRequest|HttpClientResponse|HttpServer)|@effect\/platform-bun\/BunHttp(?:Client|Server)|@effect\/platform-node\/NodeHttp(?:Client|Server))$/;
    const forbiddenSourceReads = [
      { pattern: /\bfetch\s*\(/, name: "global fetch" },
      { pattern: /\bnew\s+WebSocket\s*\(/, name: "WebSocket" },
      { pattern: /\bnew\s+EventSource\s*\(/, name: "EventSource" },
      { pattern: /\bnew\s+XMLHttpRequest\s*\(/, name: "XMLHttpRequest" },
      { pattern: /\bBun\s*\.\s*(?:serve|connect|udpSocket)\s*\(/, name: "Bun transport" },
    ];

    const violations = listTypeScriptFiles(join(packageRoot, "runtime", "src"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) => {
        const source = readSource(file);
        return [
          ...readImports(file)
            .filter((specifier) => forbiddenImportSpecifiers.test(specifier))
            .map((specifier) => `${display(file)} -> ${specifier}`),
          ...forbiddenSourceReads
            .filter(({ pattern }) => pattern.test(source))
            .map(({ name }) => `${display(file)} -> ${name}`),
        ];
      });

    expect(violations).toEqual([]);
  });

  it("extension handlers do not perform runtime, state, subprocess, or file side effects directly", () => {
    const handlerFiles = listTypeScriptFiles(join(packageRoot, "extensions", "src"))
      .filter((file) => basename(file).includes("handler"))
      .filter((file) => !isTestFile(file));
    const forbiddenImports = [
      "@svvy/state",
      "@svvy/runtime",
      "@svvy/sandbox",
      "@svvy/pi-adapter",
      "node:fs",
      "node:fs/promises",
      "node:child_process",
      "bun:sqlite",
    ];
    const forbiddenSourcePatterns = [
      /\bBun\.(?:spawn|spawnSync|write|file)\b/,
      /\bprocess\.(?:env|cwd|chdir|exit)\b/,
      /\b(?:writeFile|readFile|mkdir|rm|unlink|rename)\s*\(/,
      /\b(?:spawn|exec|execFile|fork)\s*\(/,
      /\b(?:publish|notify|emitRuntime|commit|transaction)\w*\s*\(/,
      /\bapplyRuntimeEffectRequests?\s*\(/,
    ];

    const violations = handlerFiles.flatMap((file) => {
      const source = readSource(file);
      const importViolations = readImports(file)
        .filter((specifier) =>
          forbiddenImports.some(
            (forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`),
          ),
        )
        .map((specifier) => `${display(file)} imports ${specifier}`);
      const callViolations = forbiddenSourcePatterns.flatMap((pattern) =>
        source.match(pattern) ? [`${display(file)} uses ${pattern}`] : [],
      );
      return [...importViolations, ...callViolations];
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

  it("production code does not dynamically import Effect modules", () => {
    const effectDynamicImportPattern =
      /\b(?:import|require)\s*\(\s*["'](?:effect|effect\/[^"']+|@effect\/[^"']+)["']\s*\)/;
    const checkedRoots = [
      ...sourceRoots,
      join(projectRoot, "src", "bun"),
      mainviewSourceRoot,
      sharedSourceRoot,
    ];
    const violations = checkedRoots.flatMap((root) =>
      listTypeScriptFiles(root)
        .filter((file) => !isTestFile(file))
        .filter((file) => effectDynamicImportPattern.test(readSource(file)))
        .map(display),
    );

    expect(violations).toEqual([]);
  });

  it("public package root exported symbols stay explicit", () => {
    const forbiddenTaskAgentBridgeSymbols = new Set([
      "runTaskAgent",
      "WorkflowTaskAgentBridge",
      "RunTaskAgentBridgeServer",
      "createRunTaskAgentBridgeServer",
      "handleRunTaskAgentRequest",
      "RUN_TASK_AGENT_BRIDGE_ENV",
      "runTaskAgentBridgeEnvProvider",
    ]);
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

    const taskAgentBridgeViolations = ["@svvy/runtime", "@svvy/desktop", "@svvy/extensions"]
      .flatMap((packageName) => {
        const packageDirectory = packageName.replace("@svvy/", "");
        return [
          ...new Set(
            readPublicExportedNames(join(packageRoot, packageDirectory, "src", "index.ts")),
          ),
        ]
          .filter((symbol) => forbiddenTaskAgentBridgeSymbols.has(symbol))
          .map((symbol) => `${packageName} -> ${symbol}`);
      })
      .toSorted();

    expect(taskAgentBridgeViolations).toEqual([]);
  });

  it("public package roots and subpaths do not expose default exports", () => {
    const rootViolations = Array.from(expectedPublicSymbols.keys()).flatMap((packageName) => {
      const packageDirectory = packageName.replace("@svvy/", "");
      const rootPath = join(packageRoot, packageDirectory, "src", "index.ts");
      return hasPublicDefaultExport(rootPath) ? [`${packageName} -> default`] : [];
    });

    const subpathViolations = Array.from(expectedPublicSubpathSymbols.keys()).flatMap(
      (specifier) => {
        const packageName = [...expectedPublicExports.keys()].find((candidate) =>
          specifier.startsWith(`${candidate}/`),
        );
        if (!packageName) return [];
        const exportName = `.${specifier.slice(packageName.length)}`;
        const target = expectedPublicExports.get(packageName)?.[exportName];
        if (!target) return [];
        const packageDirectory = packageName.replace("@svvy/", "");
        const targetPath = join(packageRoot, packageDirectory, target.slice(2));
        return hasPublicDefaultExport(targetPath) ? [`${specifier} -> default`] : [];
      },
    );

    expect([...rootViolations, ...subpathViolations].toSorted()).toEqual([]);
  });

  it("@svvy/core public symbol index is the root export authority", () => {
    const source = readSource(
      join(packageArchitectureSpecRoot, "core-public-symbol-index.generated.md"),
    );
    const rootManifest = readRootPackageManifest();
    const requiredHeaderColumns = [
      "Symbol",
      "Source module",
      "Owner domain",
      "Public status",
      "Contract kind",
      "Schema symbol",
      "Encoded type",
      "Decoded type",
      "Boundary helpers",
      "Parse options",
      "Required tests",
    ];
    const indexedSymbols = readCorePublicSymbolIndexNames();
    const duplicateSymbols = indexedSymbols.filter(
      (symbol, index) => indexedSymbols.indexOf(symbol) !== index,
    );
    const indexRows = readCorePublicSymbolIndexRows();
    const nonPublicRows = source
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .filter((line) => !line.includes("| public root export |"));
    const actualCoreSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "core", "src", "index.ts"))),
    ].toSorted();
    const actualCoreSymbolSet = new Set(actualCoreSymbols);
    const sourceModuleByIndexedSymbol = new Map(
      indexRows.map((row) => [row.symbol, row.sourceModule] as const),
    );
    const contractKindByIndexedSymbol = new Map(
      indexRows.map((row) => [row.symbol, row.contractKind] as const),
    );
    const missingSchemaSymbols = indexRows
      .flatMap((row) => {
        const schemaReferences = [
          row.schemaSymbol === "n/a" ? null : row.schemaSymbol,
          row.encodedType.match(/^typeof\s+([A-Za-z_$][\w$]*)\.Encoded\b/)?.[1] ?? null,
        ].filter((schema): schema is string => schema !== null);
        return [...new Set(schemaReferences)].map((schema) =>
          actualCoreSymbolSet.has(schema) ? null : `${row.symbol} -> ${schema}`,
        );
      })
      .filter((entry): entry is string => entry !== null);

    expect(rootManifest.scripts?.["generate:core-index"]).toBe(
      "bun scripts/generate-core-public-symbol-index.ts",
    );
    expect(existsSync(join(projectRoot, "scripts", "generate-core-public-symbol-index.ts"))).toBe(
      true,
    );
    expect(
      source
        .split("\n")[6]
        ?.split("|")
        .map((column) => column.trim()),
    ).toEqual(["", ...requiredHeaderColumns, ""]);
    expect(indexedSymbols.length).toBeGreaterThan(0);
    expect(duplicateSymbols).toEqual([]);
    expect(nonPublicRows).toEqual([]);
    expect(indexedSymbols).toEqual(actualCoreSymbols);
    expect(missingSchemaSymbols).toEqual([]);
    expect(sourceModuleByIndexedSymbol.get("RuntimeEffectRequest")).toBe("runtime-effect-requests");
    expect(sourceModuleByIndexedSymbol.get("ExtensionExecutionPlan")).toBe("extension-contracts");
    expect(sourceModuleByIndexedSymbol.get("ExtensionRuntimeOperation")).toBe(
      "extension-contracts",
    );
    expect(contractKindByIndexedSymbol.get("SandboxPolicySource")).toBe("service-port-contract");
    expect(contractKindByIndexedSymbol.get("SandboxPolicySourceService")).toBe(
      "service-port-contract",
    );
    expect(sourceModuleByIndexedSymbol.get("ExtensionRuntimeOperationSchema")).toBe(
      "extension-contracts",
    );
    expect(sourceModuleByIndexedSymbol.get("ExtensionHandlerResult")).toBe("extension-contracts");
    expect(sourceModuleByIndexedSymbol.get("decodeUnknownExtensionRuntimeOperationEffect")).toBe(
      "extension-contracts",
    );
    expect(sourceModuleByIndexedSymbol.get("decodeUnknownExtensionRuntimeOperationExit")).toBe(
      "extension-contracts",
    );
    expect(sourceModuleByIndexedSymbol.get("encodeExtensionRuntimeOperationEffect")).toBe(
      "extension-contracts",
    );
    expect(sourceModuleByIndexedSymbol.get("encodeExtensionRuntimeOperationExit")).toBe(
      "extension-contracts",
    );
    expect(
      sourceModuleByIndexedSymbol.get(
        "unsafeDecodeExtensionRuntimeOperationSyncForTestsAndBootstrap",
      ),
    ).toBe("extension-contracts");
    expect(sourceModuleByIndexedSymbol.get("encodeExtensionHandlerResultEffect")).toBe(
      "extension-contracts",
    );
    expect(sourceModuleByIndexedSymbol.get("encodeExtensionHandlerResultExit")).toBe(
      "extension-contracts",
    );
    expect(sourceModuleByIndexedSymbol.get("SourceInvalidationHint")).toBe(
      "runtime-source-invalidation",
    );
    expect(sourceModuleByIndexedSymbol.get("RunTaskAgentInput")).toBe(
      "workflow-task-agent-bridge-contracts",
    );
    expect(sourceModuleByIndexedSymbol.get("RuntimeContractError")).toBe("runtime-submit");
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
    expect(
      expectedSubpathSpecifiers.filter((specifier) =>
        /(?:bridge|task-agent|workflow-task-agent|runTaskAgent)/i.test(specifier),
      ),
    ).toEqual([]);

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
    expect(runtimePublicSymbols.toSorted()).toEqual(["Runtime", "createRuntimeFacade", "layer"]);

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

  it("runtime event bus internals stay off public APIs and Bun bootstrap code", () => {
    const runtimeManifest = readPackageManifest("@svvy/runtime");
    const runtimeExports = Object.keys(
      runtimeManifest.exports as Record<string, string>,
    ).toSorted();
    const runtimePublicSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "index.ts"))),
    ];
    const runtimeBootstrapSymbols = [
      ...new Set(readPublicExportedNames(join(packageRoot, "runtime", "src", "bootstrap.ts"))),
    ];
    const forbiddenRuntimeEventBusSymbols = new Set([
      "RuntimeEventBus",
      "RuntimeEventBusOptions",
      "RuntimeEventBusService",
      "RuntimeEventDraft",
      "RuntimeEventSubscriptionEffect",
      "RuntimeLayerEventsPort",
      "RuntimeLayerEventsPortService",
      "layerRuntimeEventBus",
      "makeRuntimeEventBus",
    ]);
    const forbiddenRootSymbols = runtimePublicSymbols.filter(
      (symbol) =>
        forbiddenRuntimeEventBusSymbols.has(symbol) ||
        symbol === "PromptExecutionRuntimeHandle" ||
        symbol === "createPromptExecutionContext",
    );
    const forbiddenBootstrapSymbols = runtimeBootstrapSymbols.filter((symbol) =>
      forbiddenRuntimeEventBusSymbols.has(symbol),
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
    const appRuntimeBootstrapEventImports = listTypeScriptFiles(join(projectRoot, "src", "bun"))
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        readNamedImportNames(file, "@svvy/runtime/bootstrap")
          .filter((name) => forbiddenRuntimeEventBusSymbols.has(name))
          .map((name) => `${display(file)} -> ${name}`),
      )
      .toSorted();
    const runtimeLayerSource = readSource(join(packageRoot, "runtime", "src", "runtime-layer.ts"));
    const runtimeSpecSource = readSource(join(packageArchitectureSpecRoot, "runtime.spec.md"));

    expect(runtimeExports).toEqual([
      ".",
      "./accepted-native-tool-execution",
      "./app-log-commit-notification-adapter",
      "./bootstrap",
      "./committed-state-invalidation-adapter",
      "./prompt-execution-context",
      "./source-invalidation-coordinator-adapter",
    ]);
    expect(forbiddenRootSymbols).toEqual([]);
    expect(forbiddenBootstrapSymbols).toEqual([]);
    expect(appImports).toEqual([]);
    expect(appRuntimeBootstrapEventImports).toEqual([]);
    expect(runtimeLayerSource).not.toContain("RuntimeLayerEventsPort");
    expect(runtimeLayerSource).not.toContain("runtimeEventBusFromPort");
    expect(runtimeSpecSource).not.toContain("App runtime event bus");
  });

  it("package source roots are covered by boundary tests", () => {
    expect(sourceRoots.every((root) => listTypeScriptFiles(root).length > 0)).toBe(true);
  });
});
