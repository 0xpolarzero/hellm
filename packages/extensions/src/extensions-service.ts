import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  type AbsolutePath,
  type BuildExtensionInput,
  type BuildExtensionResult,
  type BuildExecuteTypescriptFacadeDeclarationsInput,
  type AddExtensionInstructionInput,
  type AddExtensionInstructionResult,
  type ConfigureExtensionInstructionInput,
  type ConfigureExtensionInstructionResult,
  type CreateExtensionSourceInput,
  type CreateExtensionSourceResult,
  type CreateWorkflowAgentSourceInput,
  type DeleteWorkflowAgentSourceInput,
  type DuplicateWorkflowAgentSourceInput,
  type DuplicateExtensionSourceInput,
  type DuplicateExtensionSourceResult,
  type DeleteExtensionSourceInput,
  type DeleteExtensionSourceResult,
  type ExecuteTypescriptFacadeDeclarations,
  ExtensionError as CoreExtensionError,
  type ExtensionError,
  type ExtensionRegistryObservationResult,
  type ExtensionSourceMutationId,
  type RefreshExtensionCliRequirementReadinessInput,
  type RefreshExtensionCliRequirementReadinessResult,
  type RemoveExtensionInstructionInput,
  type RemoveExtensionInstructionResult,
  type RenameExtensionInstructionInput,
  type RenameExtensionInstructionResult,
  type ReorderExtensionInstructionsInput,
  type ReorderExtensionInstructionsResult,
  type RevertExtensionSourceMutationInput,
  type RevertExtensionSourceMutationResult,
  type ResetExtensionInstructionsInput,
  type ResetExtensionInstructionsResult,
  type ExternalInstructionScanInput,
  type ExternalInstructionScanResult,
  type ConfigureExtensionTypescriptApiResult,
  ExtensionStatePort,
  type GeneratedPackageBuildInput,
  type GeneratedPackageBuildPlanResult,
  type GeneratedPackageBuildStatus,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type GeneratedPackageWorkspaceLinkRepairPlan,
  type NativeToolDeclaration,
  type NativeToolHandlerLookupInput,
  type OpenExtensionSourceEditInput,
  type ObserveExtensionSourceBuildsInput,
  type ObserveExtensionSourceBuildsResult,
  type RequestInputVariant,
  type ResolveExternalInstructionSourceInput,
  type ResolvedExternalInstructionSource,
  type SaveExternalInstructionSourceInput,
  type ConfigureExtensionTypescriptApiInput,
  type SaveExtensionSourceEditInput,
  type ScaffoldMissingWorkflowAgentSourcesResult,
  type SourceEditSaveResult,
  type SourceEditSession,
  type WorkflowAgentSourceDeleteResult,
  type WorkflowAgentSourceLifecycleResult,
  type WorkflowAgentSourceObservation,
  type ApplyExtensionSnapshotSourceRestoreInput,
  type CaptureExtensionSnapshotSourcePayloadInput,
  type ExtensionSnapshotPayload,
  type ExtensionSnapshotSourceRestorePlan,
  type ExtensionSnapshotSourceRestoreReceipt,
  type PrepareExtensionSnapshotSourceRestoreInput,
  type FinalizeExtensionSnapshotSourceRestoreInput,
  type FinalizeExtensionSnapshotSourceRestoreResult,
} from "@svvy/core";
import {
  addExtensionInstruction,
  configureExtensionInstruction,
  createExtensionSource,
  deleteExtensionSource,
  duplicateExtensionSource,
  finalizeExtensionSourceMutation,
  removeExtensionInstruction,
  recoverExtensionSourceMutations,
  renameExtensionInstruction,
  reorderExtensionInstructions,
  revertExtensionSourceMutation,
  resetExtensionInstructions,
} from "./extension-source-lifecycle";
import { configureExtensionTypescriptApi } from "./extension-source-management";
import { buildExtension } from "./extension-build-execution";
import { observeCurrentExtensionBuilds } from "./extension-build-observation";
import { ExtensionBuildProcessPort } from "./extension-build-process-port";
import { ExtensionCliRequirementProbePort } from "./extension-cli-requirement-probe-port";
import { refreshExtensionCliRequirementReadiness } from "./extension-cli-requirement-readiness";
import { observeExtensionRegistry } from "./extension-registry-observation";
import {
  resolveExternalInstructionSource,
  saveExternalInstructionSource,
  scanExternalInstructions,
} from "./external-instructions";
import {
  GENERATED_EXTENSIONS_PACKAGE_NAME,
  refreshGeneratedExtensionsPackage as refreshGeneratedExtensionsPackageFiles,
} from "./generated-extensions-package";
import {
  GENERATED_WORKFLOWS_PACKAGE_NAME,
  refreshGeneratedWorkflowsPackage as refreshGeneratedWorkflowsPackageFiles,
} from "./generated-workflows-package";
import { nativeToolDeclarationsForExtensions } from "./native-tool-catalog";
import {
  type NativeToolCommandMetadata,
  getNativeToolCommandMetadata,
  nativeToolCommandMetadata,
} from "./native-tool-metadata";
import type { ExtensionHandler } from "./native-tool-handler-contracts";
import { listExtensionsHandler } from "./list-extensions-handler";
import { loadExtensionHandler } from "./load-extension-handler";
import { requestUserInputHandler } from "./request-user-input-handler";
import { threadStartHandler } from "./thread-start-handler";
import { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import {
  applyExtensionSnapshotSourceRestore,
  captureExtensionSnapshotSourcePayload,
  prepareExtensionSnapshotSourceRestore,
  finalizeExtensionSnapshotSourceRestore,
} from "./extension-snapshots";
import { PackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";
import {
  createWorkflowAgentSource,
  deleteWorkflowAgentSource,
  duplicateWorkflowAgentSource,
  openExtensionSourceEditSession,
  saveExtensionSourceEditSession,
} from "./source-edit-sessions";
import { GeneratedPackageRootPort } from "./generated-package-root-port";
import { WorkspaceSourceLinkPort } from "./workspace-source-link-port";
import { repairInterruptedGeneratedPackagePromotion } from "./generated-package-writer";
import {
  BUILTIN_EXTENSIONS,
  type ExtensionExternalInstructionSource,
  type ExtensionRecord,
  type SvvyActorKind,
  type VisibleAvailableExtensionRecord,
  type VisibleLoadedExtensionRecord,
  getExtensionRecord,
  resolveActorExtensionState,
  visibleExtensionRecords,
} from "./extension-records";
import { buildExecuteTypescriptFacadeDeclarations } from "./execute-typescript-facade-declarations";
import {
  scaffoldMissingWorkflowAgentSources,
  scanWorkflowAgentSources,
} from "./workflow-agent-source-records";

export interface ExtensionRegistryInspectInput {
  id: string;
}

export type ResolveActorExtensionBindingInput = Parameters<typeof resolveActorExtensionState>[0];

export interface ActorExtensionBinding {
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
}

export interface BuildVisibleExtensionRecordsInput {
  actor?: SvvyActorKind;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
  loadedExtensionRecords?: readonly ExtensionRecord[];
  availableExtensionRecords?: readonly ExtensionRecord[];
  externalInstructionSources?: readonly ExtensionExternalInstructionSource[];
}

export interface VisibleExtensionRecordsResult {
  loaded: readonly VisibleLoadedExtensionRecord[];
  available: readonly VisibleAvailableExtensionRecord[];
}

export interface ToolDeclarationInput {
  actorKind: NativeToolHandlerLookupInput["actorKind"];
  actorBinding: NativeToolHandlerLookupInput["actorBinding"];
  requestInputVariant: RequestInputVariant;
}

export interface ToolMetadataInput {
  actorKind: NativeToolHandlerLookupInput["actorKind"];
  actorBinding: NativeToolHandlerLookupInput["actorBinding"];
  toolName?: NativeToolHandlerLookupInput["toolName"];
}

export interface ExtensionsService {
  snapshots: {
    captureSourcePayload(
      input: CaptureExtensionSnapshotSourcePayloadInput,
    ): Effect.Effect<ExtensionSnapshotPayload, ExtensionError>;
    prepareSourceRestore(
      input: PrepareExtensionSnapshotSourceRestoreInput,
    ): Effect.Effect<ExtensionSnapshotSourceRestorePlan, ExtensionError>;
    applySourceRestore(
      input: ApplyExtensionSnapshotSourceRestoreInput,
    ): Effect.Effect<ExtensionSnapshotSourceRestoreReceipt, ExtensionError>;
    finalizeSourceRestore(
      input: FinalizeExtensionSnapshotSourceRestoreInput,
    ): Effect.Effect<FinalizeExtensionSnapshotSourceRestoreResult, ExtensionError>;
  };
  registry: {
    list(): Effect.Effect<readonly ExtensionRecord[]>;
    inspect(input: ExtensionRegistryInspectInput): Effect.Effect<ExtensionRecord, ExtensionError>;
    observe(): Effect.Effect<ExtensionRegistryObservationResult, ExtensionError>;
  };
  builds: {
    build(input: BuildExtensionInput): Effect.Effect<BuildExtensionResult, ExtensionError>;
    observeCurrent(
      input: ObserveExtensionSourceBuildsInput,
    ): Effect.Effect<ObserveExtensionSourceBuildsResult, ExtensionError>;
  };
  dependencies: {
    refreshReadiness(
      input: RefreshExtensionCliRequirementReadinessInput,
    ): Effect.Effect<RefreshExtensionCliRequirementReadinessResult, ExtensionError>;
  };
  actorBindings: {
    resolve(input: ResolveActorExtensionBindingInput): Effect.Effect<ActorExtensionBinding>;
    visibleRecords(
      input: BuildVisibleExtensionRecordsInput,
    ): Effect.Effect<VisibleExtensionRecordsResult>;
  };
  nativeTools: {
    declarations(
      input: ToolDeclarationInput,
    ): Effect.Effect<readonly NativeToolDeclaration[], ExtensionError>;
    metadata(input: ToolMetadataInput): Effect.Effect<readonly NativeToolCommandMetadata[]>;
    handler(input: NativeToolHandlerLookupInput): Effect.Effect<ExtensionHandler, ExtensionError>;
  };
  executeTypescriptFacadeDeclarations: {
    build(
      input: BuildExecuteTypescriptFacadeDeclarationsInput,
    ): Effect.Effect<ExecuteTypescriptFacadeDeclarations, ExtensionError>;
  };
  generatedPackages: {
    refresh(
      input: GeneratedPackageBuildInput,
    ): Effect.Effect<GeneratedPackageBuildPlanResult, ExtensionError>;
    planWorkspaceLink(
      input: GeneratedPackageWorkspaceLinkRepairInput,
    ): Effect.Effect<GeneratedPackageWorkspaceLinkRepairPlan, ExtensionError>;
  };
  externalInstructions: {
    scan(
      input: ExternalInstructionScanInput,
    ): Effect.Effect<ExternalInstructionScanResult, ExtensionError>;
    resolveSource(
      input: ResolveExternalInstructionSourceInput,
    ): Effect.Effect<ResolvedExternalInstructionSource, ExtensionError>;
    saveSource(input: SaveExternalInstructionSourceInput): Effect.Effect<never, ExtensionError>;
  };
  sources: {
    recoverMutations(): Effect.Effect<void, ExtensionError>;
    finalizeLifecycleMutation(
      mutationId: ExtensionSourceMutationId,
    ): Effect.Effect<{ readonly finalized: boolean }, ExtensionError>;
    createExtension(
      input: CreateExtensionSourceInput,
    ): Effect.Effect<CreateExtensionSourceResult, ExtensionError>;
    duplicateExtension(
      input: DuplicateExtensionSourceInput,
    ): Effect.Effect<DuplicateExtensionSourceResult, ExtensionError>;
    deleteExtension(
      input: DeleteExtensionSourceInput,
    ): Effect.Effect<DeleteExtensionSourceResult, ExtensionError>;
    resetExtensionInstructions(
      input: ResetExtensionInstructionsInput,
    ): Effect.Effect<ResetExtensionInstructionsResult, ExtensionError>;
    addInstruction(
      input: AddExtensionInstructionInput,
    ): Effect.Effect<AddExtensionInstructionResult, ExtensionError>;
    removeInstruction(
      input: RemoveExtensionInstructionInput,
    ): Effect.Effect<RemoveExtensionInstructionResult, ExtensionError>;
    configureInstruction(
      input: ConfigureExtensionInstructionInput,
    ): Effect.Effect<ConfigureExtensionInstructionResult, ExtensionError>;
    renameInstruction(
      input: RenameExtensionInstructionInput,
    ): Effect.Effect<RenameExtensionInstructionResult, ExtensionError>;
    reorderInstructions(
      input: ReorderExtensionInstructionsInput,
    ): Effect.Effect<ReorderExtensionInstructionsResult, ExtensionError>;
    revertMutation(
      input: RevertExtensionSourceMutationInput,
    ): Effect.Effect<RevertExtensionSourceMutationResult, ExtensionError>;
    configureTypescriptApi(
      input: ConfigureExtensionTypescriptApiInput,
    ): Effect.Effect<ConfigureExtensionTypescriptApiResult, ExtensionError>;
    openEditSession(
      input: OpenExtensionSourceEditInput,
    ): Effect.Effect<SourceEditSession, ExtensionError>;
    saveEditSession(
      input: SaveExtensionSourceEditInput,
    ): Effect.Effect<SourceEditSaveResult, ExtensionError>;
    createWorkflowAgent(
      input: CreateWorkflowAgentSourceInput,
    ): Effect.Effect<WorkflowAgentSourceLifecycleResult, ExtensionError>;
    duplicateWorkflowAgent(
      input: DuplicateWorkflowAgentSourceInput,
    ): Effect.Effect<WorkflowAgentSourceLifecycleResult, ExtensionError>;
    deleteWorkflowAgent(
      input: DeleteWorkflowAgentSourceInput,
    ): Effect.Effect<WorkflowAgentSourceDeleteResult, ExtensionError>;
    scanWorkflowAgents(): Effect.Effect<readonly WorkflowAgentSourceObservation[], ExtensionError>;
    scaffoldMissingWorkflowAgents(): Effect.Effect<
      ScaffoldMissingWorkflowAgentSourcesResult,
      ExtensionError
    >;
  };
}

export class Extensions extends Context.Service<Extensions, ExtensionsService>()(
  "@svvy/extensions/Extensions",
) {}

export type ExtensionsLayerRequirements =
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionStatePort
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort
  | GeneratedPackageRootPort
  | WorkspaceSourceLinkPort
  | ExtensionBuildProcessPort
  | ExtensionCliRequirementProbePort;

export const makeExtensions = Effect.fn("@svvy/extensions/makeExtensions")(() =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const extensionState = yield* ExtensionStatePort;
    const extensionSourceRoots = yield* ExtensionSourceRootsPort;
    const packagedExtensionTemplates = yield* PackagedExtensionTemplatesPort;
    const generatedPackageRoot = yield* GeneratedPackageRootPort;
    const workspaceSourceLink = yield* WorkspaceSourceLinkPort;
    const extensionBuildProcess = yield* ExtensionBuildProcessPort;
    const cliRequirementProbe = yield* ExtensionCliRequirementProbePort;
    return yield* Effect.succeed(
      Extensions.of({
        snapshots: {
          captureSourcePayload: (input) =>
            captureExtensionSnapshotSourcePayload(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
            ),
          prepareSourceRestore: (input) =>
            prepareExtensionSnapshotSourceRestore(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
            ),
          applySourceRestore: (input) =>
            applyExtensionSnapshotSourceRestore(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
            ),
          finalizeSourceRestore: (input) =>
            finalizeExtensionSnapshotSourceRestore(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
            ),
        },
        registry: {
          list: () => Effect.succeed(BUILTIN_EXTENSIONS),
          inspect: ({ id }) => {
            const record = getExtensionRecord(id);
            if (!record) {
              return Effect.fail(
                new CoreExtensionError({
                  extensionId: id,
                  operation: "extensions.registry.inspect",
                  reason: "not-found",
                  message: `Extension record does not exist: ${id}`,
                }),
              );
            }
            return Effect.succeed(record);
          },
          observe: () =>
            observeExtensionRegistry().pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
        },
        builds: {
          build: (input) =>
            buildExtension(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
              Effect.provideService(ExtensionBuildProcessPort, extensionBuildProcess),
            ),
          observeCurrent: (input) =>
            observeCurrentExtensionBuilds(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
            ),
        },
        dependencies: {
          refreshReadiness: (input) =>
            refreshExtensionCliRequirementReadiness(input).pipe(
              Effect.provideService(ExtensionCliRequirementProbePort, cliRequirementProbe),
            ),
        },
        actorBindings: {
          resolve: (input) => Effect.succeed(resolveActorExtensionState(input)),
          visibleRecords: (input) => Effect.succeed(visibleExtensionRecords(input)),
        },
        nativeTools: {
          declarations: (input) =>
            tryExtensionCatalogOperation("extensions.nativeTools.declarations", () =>
              nativeToolDeclarationsForExtensions(
                loadedNativeToolExtensionRecords(input),
                input.requestInputVariant,
              ),
            ),
          metadata: (input) =>
            Effect.succeed(
              nativeToolCommandMetadata.filter(
                (metadata) =>
                  isNativeToolLoadedForActor(metadata, input) &&
                  (input.toolName === undefined || metadata.toolName === input.toolName),
              ),
            ),
          handler: (input) => {
            const metadata = getNativeToolCommandMetadata(input.toolName);
            const eligibilityError = validateNativeToolHandlerEligibility(input, metadata);
            if (eligibilityError) {
              return Effect.fail(eligibilityError);
            }
            const { toolName } = input;
            if (toolName === "list_extensions") {
              return Effect.succeed(listExtensionsHandler);
            }
            if (toolName === "load_extension") {
              return Effect.succeed(loadExtensionHandler);
            }
            if (toolName === "request_user_input") {
              return Effect.succeed(requestUserInputHandler);
            }
            if (toolName === "thread_start") {
              return Effect.succeed(threadStartHandler);
            }
            return Effect.fail(
              new CoreExtensionError({
                ...(metadata?.extensionIds[0] ? { extensionId: metadata.extensionIds[0] } : {}),
                operation: "extensions.nativeTools.handler",
                reason: "unsupported-operation",
                message: `Native tool handler is declared but not implemented in @svvy/extensions: ${toolName}`,
              }),
            );
          },
        },
        executeTypescriptFacadeDeclarations: {
          build: (input) =>
            tryExtensionCatalogOperation(
              "extensions.executeTypescriptFacadeDeclarations.build",
              () => buildExecuteTypescriptFacadeDeclarations(input),
            ),
        },
        generatedPackages: {
          refresh: (input) =>
            refreshGeneratedPackages(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(ExtensionStatePort, extensionState),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(GeneratedPackageRootPort, generatedPackageRoot),
            ),
          planWorkspaceLink: (input) =>
            planGeneratedPackageWorkspaceLink(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(WorkspaceSourceLinkPort, workspaceSourceLink),
              Effect.provideService(GeneratedPackageRootPort, generatedPackageRoot),
              Effect.provideService(Path.Path, path),
            ),
        },
        externalInstructions: {
          scan: (input) =>
            scanExternalInstructions(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
            ),
          resolveSource: (input) =>
            resolveExternalInstructionSource(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
            ),
          saveSource: saveExternalInstructionSource,
        },
        sources: {
          recoverMutations: () =>
            recoverExtensionSourceMutations().pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
            ),
          finalizeLifecycleMutation: (mutationId) =>
            finalizeExtensionSourceMutation(mutationId).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
            ),
          createExtension: (input) =>
            createExtensionSource(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          duplicateExtension: (input) =>
            duplicateExtensionSource(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          deleteExtension: (input) =>
            deleteExtensionSource(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          resetExtensionInstructions: (input) =>
            resetExtensionInstructions(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          addInstruction: (input) =>
            addExtensionInstruction(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          removeInstruction: (input) =>
            removeExtensionInstruction(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          configureInstruction: (input) =>
            configureExtensionInstruction(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          renameInstruction: (input) =>
            renameExtensionInstruction(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          reorderInstructions: (input) =>
            reorderExtensionInstructions(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          revertMutation: (input) =>
            revertExtensionSourceMutation(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          configureTypescriptApi: (input) =>
            configureExtensionTypescriptApi(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          openEditSession: (input) =>
            openExtensionSourceEditSession(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          saveEditSession: (input) =>
            saveExtensionSourceEditSession(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          createWorkflowAgent: (input) =>
            createWorkflowAgentSource(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          duplicateWorkflowAgent: (input) =>
            duplicateWorkflowAgentSource(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          deleteWorkflowAgent: (input) =>
            deleteWorkflowAgentSource(input).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
          scanWorkflowAgents: () =>
            scanWorkflowAgentSources().pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Crypto.Crypto, crypto),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
            ),
          scaffoldMissingWorkflowAgents: () =>
            scaffoldMissingWorkflowAgentSources().pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(ExtensionSourceRootsPort, extensionSourceRoots),
              Effect.provideService(PackagedExtensionTemplatesPort, packagedExtensionTemplates),
            ),
        },
      }),
    );
  }),
);

export const layer: Layer.Layer<Extensions, never, ExtensionsLayerRequirements> = Layer.effect(
  Extensions,
  makeExtensions(),
);

function validateNativeToolHandlerEligibility(
  input: NativeToolHandlerLookupInput,
  metadata: NativeToolCommandMetadata | null,
): ExtensionError | null {
  if (!metadata) {
    return new CoreExtensionError({
      operation: "extensions.nativeTools.handler",
      reason: "not-found",
      message: `Native tool handler does not exist: ${input.toolName}`,
    });
  }
  const actorAvailability = metadata.actorAvailability[input.actorKind];
  if (actorAvailability !== "loaded") {
    return new CoreExtensionError({
      operation: "extensions.nativeTools.handler",
      reason: "not-found",
      message: `Native tool is not loaded for actor ${input.actorKind}: ${input.toolName}`,
    });
  }
  const loadedExtensionIds = new Set<string>(input.actorBinding.loadedExtensionIds);
  const loadedOwner = metadata.extensionIds.find((extensionId) =>
    loadedExtensionIds.has(extensionId),
  );
  if (!loadedOwner) {
    const extensionId = metadata.extensionIds[0];
    return new CoreExtensionError({
      ...(extensionId ? { extensionId } : {}),
      operation: "extensions.nativeTools.handler",
      reason: "not-loaded",
      message: `Native tool extension is not loaded for this actor: ${input.toolName}`,
    });
  }
  return null;
}

function loadedNativeToolExtensionRecords(input: ToolDeclarationInput): readonly ExtensionRecord[] {
  const loadedExtensionIds = new Set<string>(input.actorBinding.loadedExtensionIds);
  const loadedToolExtensionIds = new Set(
    nativeToolCommandMetadata
      .filter((metadata) => isNativeToolLoadedForActor(metadata, input))
      .flatMap((metadata) => metadata.extensionIds),
  );
  return BUILTIN_EXTENSIONS.filter(
    (record) =>
      record.interface === "native_tool" &&
      loadedExtensionIds.has(record.id) &&
      loadedToolExtensionIds.has(record.id),
  );
}

function isNativeToolLoadedForActor(
  metadata: NativeToolCommandMetadata,
  input: {
    actorKind: NativeToolHandlerLookupInput["actorKind"];
    actorBinding: NativeToolHandlerLookupInput["actorBinding"];
  },
): boolean {
  if (metadata.actorAvailability[input.actorKind] !== "loaded") {
    return false;
  }
  const loadedExtensionIds = new Set<string>(input.actorBinding.loadedExtensionIds);
  return metadata.extensionIds.some((extensionId) => loadedExtensionIds.has(extensionId));
}

function tryExtensionCatalogOperation<A>(
  operation: string,
  run: () => A,
  extensionId?: string,
): Effect.Effect<A, ExtensionError> {
  return Effect.try({
    try: run,
    catch: (cause) =>
      new CoreExtensionError({
        ...(extensionId ? { extensionId } : {}),
        operation,
        reason: "not-found",
        message: describeExtensionCatalogCause(cause),
        cause,
      }),
  });
}

function describeExtensionCatalogCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function unknownGeneratedPackageError(operation: string, packageName: string): ExtensionError {
  return new CoreExtensionError({
    operation,
    reason: "invalid-input",
    message: `Unknown generated package: ${packageName}`,
  });
}

function findUnknownGeneratedPackage(packageNames: readonly string[]): string | null {
  return (
    packageNames.find(
      (packageName) =>
        packageName !== GENERATED_EXTENSIONS_PACKAGE_NAME &&
        packageName !== GENERATED_WORKFLOWS_PACKAGE_NAME,
    ) ?? null
  );
}

function refreshGeneratedPackages(
  input: GeneratedPackageBuildInput,
): Effect.Effect<
  GeneratedPackageBuildPlanResult,
  ExtensionError,
  | FileSystem.FileSystem
  | Path.Path
  | ExtensionStatePort
  | ExtensionSourceRootsPort
  | GeneratedPackageRootPort
> {
  const operation = "extensions.generated-packages.refresh";
  const unknownPackage = findUnknownGeneratedPackage(input.packages);
  if (unknownPackage) {
    return Effect.fail(unknownGeneratedPackageError(operation, unknownPackage));
  }
  const requestedPackages = new Set(input.packages);
  const mustRefreshExtensions =
    requestedPackages.has(GENERATED_EXTENSIONS_PACKAGE_NAME) ||
    requestedPackages.has(GENERATED_WORKFLOWS_PACKAGE_NAME);
  const mustRefreshWorkflows = requestedPackages.has(GENERATED_WORKFLOWS_PACKAGE_NAME);
  if (!mustRefreshExtensions && !mustRefreshWorkflows) {
    return Effect.succeed({ packages: [], workflowsExports: [] });
  }

  return Effect.gen(function* () {
    const sourceRoots = yield* (yield* ExtensionSourceRootsPort).roots();
    const generatedPackageRoots = yield* (yield* GeneratedPackageRootPort).roots();
    yield* repairGeneratedPackageRoots(generatedPackageRoots);
    const extensionsRefresh = mustRefreshExtensions
      ? yield* refreshGeneratedExtensionsPackageFiles({
          generatedPackagePath: generatedPackageRoots.extensionsPackageRoot,
          extensionsRoot: sourceRoots.extensionsRoot,
        })
      : null;
    const extensionsBuildId = extensionsRefresh?.evidence.buildId;
    if (mustRefreshWorkflows && !extensionsBuildId) {
      return yield* Effect.fail(
        new CoreExtensionError({
          operation,
          reason: "execution-failed",
          message: "Generated Workflows package refresh requires generated Extensions evidence.",
        }),
      );
    }
    const workflowsRefresh =
      mustRefreshWorkflows && extensionsBuildId
        ? yield* refreshGeneratedWorkflowsPackageFiles({
            extensionsBuildId,
            extensionIds: extensionsRefresh.extensionIds,
            coreTypeContractPackageRoot: generatedPackageRoots.coreTypeContractPackageRoot,
            generatedPackagePath: generatedPackageRoots.workflowsPackageRoot,
            workflowsSourceRoot: sourceRoots.workflowsSourceRoot,
          })
        : null;
    return { extensionsRefresh, workflowsRefresh };
  }).pipe(
    Effect.map(({ extensionsRefresh, workflowsRefresh }): GeneratedPackageBuildPlanResult => {
      const packages: GeneratedPackageBuildStatus[] = [];

      if (extensionsRefresh) {
        packages.push({
          packageName: GENERATED_EXTENSIONS_PACKAGE_NAME,
          action: "written",
          buildId: extensionsRefresh.evidence.buildId,
          manifestPath: extensionsRefresh.manifestPath as AbsolutePath,
          sourceFingerprint: extensionsRefresh.evidence.sourceFingerprint,
          outputFingerprint: extensionsRefresh.evidence.outputFingerprint,
          dependencies: extensionsRefresh.evidence.dependencies,
          generatedFiles: extensionsRefresh.generatedFiles.map((file) => ({
            relativePath: file.relativePath,
            path: file.path as AbsolutePath,
          })),
        });
      }

      if (workflowsRefresh) {
        packages.push({
          packageName: GENERATED_WORKFLOWS_PACKAGE_NAME,
          action: "written",
          buildId: workflowsRefresh.evidence.buildId,
          manifestPath: workflowsRefresh.manifestPath as AbsolutePath,
          sourceFingerprint: workflowsRefresh.evidence.sourceFingerprint,
          outputFingerprint: workflowsRefresh.evidence.outputFingerprint,
          dependencies: workflowsRefresh.evidence.dependencies,
          generatedFiles: workflowsRefresh.generatedFiles.map((file) => ({
            relativePath: file.relativePath,
            path: file.path as AbsolutePath,
          })),
        });
      }

      return {
        packages,
        workflowsExports: workflowsRefresh?.workflowsExports ?? [],
      };
    }),
    Effect.mapError(
      (cause) =>
        new CoreExtensionError({
          operation,
          reason: "execution-failed",
          message: describeExtensionCatalogCause(cause),
          cause,
        }),
    ),
  );
}

function planGeneratedPackageWorkspaceLink(
  input: GeneratedPackageWorkspaceLinkRepairInput,
): Effect.Effect<
  GeneratedPackageWorkspaceLinkRepairPlan,
  ExtensionError,
  WorkspaceSourceLinkPort | GeneratedPackageRootPort | FileSystem.FileSystem | Path.Path
> {
  const operation = "extensions.generated-packages.plan-workspace-link";
  const unknownPackage = findUnknownGeneratedPackage([input.packageName]);
  if (unknownPackage) {
    return Effect.fail(unknownGeneratedPackageError(operation, unknownPackage));
  }
  return Effect.gen(function* () {
    const linkPath = yield* (yield* WorkspaceSourceLinkPort).generatedPackageLinkPath(input);
    const roots = yield* (yield* GeneratedPackageRootPort).roots();
    yield* repairGeneratedPackageRoots(roots);
    const path = yield* Path.Path;
    const targetPath =
      input.packageName === GENERATED_WORKFLOWS_PACKAGE_NAME
        ? roots.workflowsPackageRoot
        : roots.extensionsPackageRoot;

    return {
      workspaceId: input.workspaceId,
      packageName: input.packageName,
      linkPath,
      targetPath,
      requiredParentPath: path.dirname(linkPath) as AbsolutePath,
      overwritePolicy: "symlink-only" as const,
    };
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CoreExtensionError({
          operation,
          reason: "execution-failed",
          message: describeExtensionCatalogCause(cause),
          cause,
        }),
    ),
  );
}

function repairGeneratedPackageRoots(roots: {
  readonly extensionsPackageRoot: AbsolutePath;
  readonly workflowsPackageRoot: AbsolutePath;
}): Effect.Effect<void, unknown, FileSystem.FileSystem> {
  return Effect.all(
    [
      repairInterruptedGeneratedPackagePromotion({
        generatedPackagePath: roots.extensionsPackageRoot,
      }),
      repairInterruptedGeneratedPackagePromotion({
        generatedPackagePath: roots.workflowsPackageRoot,
      }),
    ],
    { discard: true },
  );
}
