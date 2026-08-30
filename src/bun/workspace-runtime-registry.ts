import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve as resolvePath } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import * as Effect from "effect/Effect";
import type {
  CreateDesktopAppInput,
  DesktopAppActionsFacade,
  DesktopRuntimeActionsFacade,
  RendererStateCommandsFacade,
  RendererStateFacade,
} from "@svvy/desktop";
import {
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
  type RuntimeLayerCommandControlPortService,
  type RuntimeLayerCommandStdinPortService,
  type RuntimeLayerConfig,
  type RuntimeSourceInvalidationEvent,
  type RuntimeSourceInvalidationHost,
} from "@svvy/runtime/bootstrap";
import {
  createRuntimeSourceInvalidationCoordinatorHandle,
  type RuntimeSourceInvalidationCoordinatorHandle,
} from "@svvy/runtime/source-invalidation-coordinator-adapter";
import {
  RuntimeContractError,
  SandboxPolicyError,
  StateContractError,
  type AbsolutePath,
  type ExtensionSnapshotCleanupId,
  type ExtensionSnapshotId,
  type ExtensionSnapshotRestoreAttemptId,
  type CommandId,
  type ExtensionId,
  type ExternalInstructionScanInput,
  type ExtensionStatePortService,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type IsoDateTimeString,
  type PromptTarget as RuntimePromptTarget,
  type RefreshGeneratedContextRequest,
  type RuntimeGeneratedPackageStatePortService,
  type SecretStoreMutationPortService,
  type SecretStorePortService,
  type RuntimeSourceStatePortService,
  type SourceEditSession,
  type RuntimeOwnerId,
  type RuntimeOwnerRef,
  type ReleaseWorkspaceResult,
  type WorkspaceId,
  type WorkspaceSessionId,
  type SvvyxExtensionManagementRuntimeRequest,
  type SvvyxExtensionManagementRuntimeResponse,
  type SvvyxWorkflowsRuntimeRequest,
  type SvvyxWorkflowsRuntimeResponse,
  type WorkflowAgentSourceExportName,
} from "@svvy/core";
import type {
  ExtensionBuildProcessPortService,
  ExtensionCliRequirementProbePortService,
  ExtensionSourceRoots,
  GeneratedPackageRoots,
} from "@svvy/extensions";
import type { WorkspaceInfoResponse, WorkspaceKind } from "../shared/workspace-contract";
import { appendAppLoggerEvent, createAppLogger, type BridgeLogLevel } from "./app-logger";
import { createStateAppLogsFacade, type StateAppLogsFacade } from "@svvy/state";
import {
  markPersistedWorkspaceGeneratedPackageLinksRepairNeeded,
  recordPersistedWorkspaceGeneratedPackageLinkStatus,
} from "@svvy/state/generated-package-maintenance";
import { createAgentSettingsStore } from "./agent-settings-store";
import type { AgentSettingsStore } from "./agent-settings-store";
import {
  getSvvySessionDir,
  getSvvyAgentDir,
  getSvvyDataDir,
  STRUCTURED_SESSION_DB_FILENAME,
  type CatalogAgentProfileAuthority,
  type CatalogRequestInputSettingsAuthority,
  type WorkspaceSessionCatalog,
  type TitleGenerationLogEvent,
  type WorkflowsGeneratedPackageLogEvent,
} from "./session-catalog";
import { extensionsRootForAgentDir } from "./extension-paths";
import {
  extensionsGeneratedPackagePath,
  workflowsGeneratedPackagePath,
  workflowsSourceRoot,
} from "./extension-paths";
import {
  getCoreTypeContractPackagePath,
  materializeGeneratedCoreTypeContractPackage,
} from "./generated-core-type-contract-package";
import { canonicalizeWorkspaceCwd, getDefaultWorkspaceCwd } from "./workspace-context";
import { WorkspacePathIndex } from "./workspace-path-index";
import {
  createNodeSourceInvalidationHost,
  createRuntimeBackedWorkspaceSessionCatalog,
  type PackagedSandboxHostSupportServices,
  type RuntimeProviderAuthDependencies,
  type RuntimeGeneratedPackageRefreshBoundaryHost,
} from "./runtime-service-adapter";
import { createAppRuntimeBootstrap, type AppRuntimeBootstrap } from "./app-runtime-bootstrap";
import {
  buildAppGlobalSourceWatchInputs,
  buildWorkspaceSourceWatchInputs,
} from "./source-watch-inputs";
import { createLiveCommandStdinRegistry } from "./live-command-stdin-registry";
import { DEFAULT_AGENT_SETTINGS_STATE, type AppPreferences } from "../shared/agent-settings";
import { resolvePackagedExtensionTemplatesRoot } from "./packaged-extension-templates";
import { readRuntimeArtifactPreviewContent } from "./runtime-artifact-materializer";
import {
  importWorkspaceComposerAttachments,
  materializeSelectedWorkspaceAttachments,
  resolveWorkspacePathTarget,
} from "./workspace-file-actions";

type WorkspaceGeneratedPackageBoundaryHost = RuntimeGeneratedPackageRefreshBoundaryHost & {
  readonly sourceRoots: ExtensionSourceRoots;
  readonly generatedPackageRoots: GeneratedPackageRoots;
  readonly extensionStatePort: ExtensionStatePortService;
  generatedPackageLinkPath(input: GeneratedPackageWorkspaceLinkRepairInput): Promise<AbsolutePath>;
};

const stateDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

export async function applyExtensionManagementRuntimeRequest(
  runtime: AppRuntimeBootstrap,
  request: SvvyxExtensionManagementRuntimeRequest,
  workspaceId?: WorkspaceId,
): Promise<SvvyxExtensionManagementRuntimeResponse> {
  if (request.operation === "inspect") {
    if (request.input.extensionId.startsWith("external_instruction:") && workspaceId) {
      const result = await runtime.state.readModels.fetch({
        kind: "externalInstructions",
        workspaceId,
      });
      if (result.kind !== "externalInstructions") {
        throw new Error("External-instruction read-model authority returned the wrong projection.");
      }
      const source = result.value.sources.find(
        (candidate) =>
          `external_instruction:${candidate.fileName}:${candidate.canonicalPath}` ===
          request.input.extensionId,
      );
      if (!source) throw new Error(`Extension not found: ${request.input.extensionId}`);
      const readable = source.readStatus.status === "readable";
      const usage = result.value.actorUsage.filter((row) => row.sourceId === source.id);
      return {
        output: {
          ok: true,
          extension: {
            id: request.input.extensionId,
            category: "external_instruction",
            interface: "instructions",
            title: source.title,
            description: `Read-only ${source.fileName} external instruction file.`,
            resettable: false,
            deletable: false,
            typescriptApiEnabled: false,
            externalInstruction: {
              sourceId: source.id,
              sourceGroup: source.sourceGroup,
              ...(source.rootId === undefined ? {} : { rootId: source.rootId }),
              ...(source.rootLabel === undefined ? {} : { rootLabel: source.rootLabel }),
              path: source.canonicalPath,
              content: "",
              contentHash: source.contentHash,
              order: source.order,
              readStatus: source.readStatus,
            },
            usage,
            requirements: {
              cliRequirements: [],
              env: [],
              dependencies: [],
              trustedDependencies: [],
            },
            state: { readiness: readable ? "ready" : "not-ready", runtimeReady: readable },
          },
        },
        commandFacts: {
          extensionId: request.input.extensionId,
          extensionReady: readable,
          externalInstructionPath: source.canonicalPath,
          externalInstructionReadStatus: source.readStatus.status,
          cliRequirementCount: 0,
          envRequirementCount: 0,
        },
      };
    }
    const result = await runtime.state.readModels.fetch({
      kind: "extensions",
      extensionId: request.input.extensionId,
    });
    if (result.kind !== "extensions") {
      throw new Error("Extensions read-model authority returned the wrong projection.");
    }
    const extension = result.value.records[0];
    if (!extension) {
      throw new Error(`Extension not found: ${request.input.extensionId}`);
    }
    const issues = [
      ...(extension.buildRequired
        ? [{ code: "BUILD_REQUIRED", message: `${extension.title} requires a current build.` }]
        : []),
      ...extension.cliReadiness
        .filter((requirement) => requirement.blocking)
        .map((requirement) => ({
          code: requirement.status === "missing" ? "CLI_MISSING" : "CLI_STATUS_UNKNOWN",
          message: `${requirement.requirementId} is not currently usable.`,
        })),
      ...(extension.env ?? [])
        .filter((declaration) => declaration.required && declaration.status === "missing")
        .map((declaration) => ({
          code: "EXTENSION_ENV_MISSING",
          message: `${extension.title} requires ${declaration.envName}.`,
        })),
      ...extension.dependencyRequirements
        .filter((dependency) => dependency.approval !== "approved")
        .map((dependency) => ({
          code: "DEPENDENCY_APPROVAL_REQUIRED",
          message: `${extension.title} dependency ${dependency.name} requires approval.`,
        })),
      ...extension.dependencyRequirements
        .filter(
          (dependency) => dependency.approval === "approved" && dependency.install !== "installed",
        )
        .map((dependency) => ({
          code: "DEPENDENCY_INSTALL_UNKNOWN",
          message: `${extension.title} dependency ${dependency.name} has no current install evidence.`,
        })),
    ];
    const cliRequirements = extension.cliDeclarations.map((declaration) => {
      const readiness = extension.cliReadiness.find(
        (candidate) => candidate.requirementId === declaration.id,
      );
      return {
        id: declaration.id,
        binary: declaration.binary,
        package: declaration.package,
        required: declaration.required,
        defaultVersion: declaration.defaultVersion,
        status: readiness?.status ?? "unknown",
        detectedVersion: readiness?.readiness?.detectedVersion ?? null,
        expectedVersion: readiness?.readiness?.expectedVersion ?? declaration.defaultVersion,
        authorityStatus: readiness?.authorityStatus ?? "missing",
        usable: readiness?.usable ?? false,
        blocking: readiness?.blocking ?? declaration.required,
        versionCommand: declaration.versionCommand,
        installCommand: declaration.installCommand,
      };
    });
    return {
      output: {
        ok: true,
        extension: {
          id: extension.extensionId,
          category: extension.category,
          interface: extension.interfaceKind,
          title: extension.title,
          description: extension.description,
          resettable: extension.capabilities.resettable,
          deletable: extension.capabilities.deletable,
          typescriptApiEnabled: extension.capabilities.typescriptApiEnabled,
          customized: extension.customized,
          sources: {
            contributors: extension.contributors,
            tooling: extension.tooling,
          },
          usage: {
            loadedByProfileIds: extension.loadedByProfileIds,
            availableByProfileIds: extension.availableByProfileIds,
            policy: extension.usagePolicy,
          },
          requirements: {
            cliRequirements,
            env: extension.env ?? [],
            dependencies: extension.dependencyRequirements.filter(
              (dependency) => dependency.kind === "dependency",
            ),
            trustedDependencies: extension.dependencyRequirements.filter(
              (dependency) => dependency.kind === "trusted_dependency",
            ),
          },
          state: {
            buildAuthorityStatus: extension.buildAuthorityStatus,
            buildRequired: extension.buildRequired,
            contextReady: extension.contextReady,
            runtimeReady: extension.runtimeReady,
            readiness: extension.readiness,
            generatedPackageStatus: extension.generatedPackageStatus,
            issues,
          },
          observation: {
            aggregateFingerprint: result.value.aggregateFingerprint,
            observedAt: result.value.observedAt,
            sourceFingerprint: extension.sourceFingerprint,
          },
        },
      },
      commandFacts: {
        extensionId: extension.extensionId,
        extensionReady: extension.runtimeReady,
        cliRequirementCount: cliRequirements.length,
        envRequirementCount: extension.env?.length ?? 0,
        extensionIssueCodes: issues.map((issue) => issue.code),
      },
    };
  }
  if (request.operation === "build") {
    const result = await runtime.facade.extensions.build(request.input);
    return {
      output: {
        ok: true,
        extensionId: request.input.extensionId,
        attemptId: result.attemptId,
        build: { status: "success", contextReady: result.manifest.contextReady },
      },
      commandFacts: {
        extensionBuildOk: true,
        extensionId: request.input.extensionId,
        extensionBuildAttemptId: result.attemptId,
      },
    };
  }
  if (request.operation === "create") {
    const receipt = await runtime.facade.extensions.create(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        extensionCreated: true,
        extensionId: receipt.extensionId,
        extensionMutationId: receipt.mutationId,
      },
    };
  }
  if (request.operation === "duplicate") {
    const receipt = await runtime.facade.extensions.duplicate(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        extensionDuplicated: true,
        extensionId: receipt.extensionId,
        duplicatedFrom: receipt.sourceExtensionId,
        extensionMutationId: receipt.mutationId,
      },
    };
  }
  if (request.operation === "delete") {
    const receipt = await runtime.facade.extensions.delete(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        extensionDeleted: true,
        extensionId: receipt.extensionId,
        extensionMutationId: receipt.mutationId,
      },
    };
  }
  if (request.operation === "reset") {
    const result = await runtime.facade.extensions.reset(request.input);
    return {
      output: { ok: true, receipt: result.source, automaticBuild: result.automaticBuild },
      commandFacts: {
        extensionReset: result.source.changed,
        extensionId: result.source.extensionId,
        extensionMutationId: result.source.mutationId,
        automaticBuildStatus: result.automaticBuild.status,
      },
    };
  }
  if (request.operation === "instructions.add") {
    const receipt = await runtime.facade.extensions.addInstruction(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        instructionChanged: receipt.changed,
        instructionAction: receipt.action,
        instructionFile: receipt.name,
        extensionId: receipt.extensionId,
        extensionMutationId: receipt.mutationId,
      },
    };
  }
  if (request.operation === "instructions.remove") {
    const receipt = await runtime.facade.extensions.removeInstruction(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        instructionChanged: receipt.changed,
        instructionAction: receipt.action,
        instructionFile: receipt.name,
        extensionId: receipt.extensionId,
        extensionMutationId: receipt.mutationId,
      },
    };
  }
  if (request.operation === "instructions.configure") {
    const receipt = await runtime.facade.extensions.configureInstruction(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        instructionChanged: receipt.changed,
        instructionAction: receipt.action,
        instructionFile: receipt.name,
        extensionId: receipt.extensionId,
        extensionMutationId: receipt.mutationId,
      },
    };
  }
  if (request.operation === "instructions.rename") {
    const receipt = await runtime.facade.extensions.renameInstruction(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        instructionChanged: receipt.changed,
        instructionAction: receipt.action,
        instructionFile: receipt.to,
        extensionId: receipt.extensionId,
        extensionMutationId: receipt.mutationId,
      },
    };
  }
  if (request.operation === "instructions.reorder") {
    const receipt = await runtime.facade.extensions.reorderInstructions(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        instructionChanged: receipt.changed,
        instructionAction: receipt.action,
        extensionId: receipt.extensionId,
        extensionMutationId: receipt.mutationId,
      },
    };
  }
  if (request.operation === "source.revert") {
    const result = await runtime.facade.extensions.revertMutation(request.input);
    return {
      output: { ok: true, receipt: result.source, automaticBuild: result.automaticBuild },
      commandFacts: {
        extensionReverted: true,
        extensionId: result.source.extensionId,
        extensionMutationId: result.source.mutationId,
        revertedExtensionMutationId: result.source.revertedMutationId,
        automaticBuildStatus: result.automaticBuild.status,
      },
    };
  }
  if (request.operation === "typescript-api.configure") {
    if (!workspaceId || request.input.workspaceId !== workspaceId) {
      throw new Error(
        "Extension TypeScript API configuration must target its owning scoped workspace runtime.",
      );
    }
    const receipt = await runtime.facade.sourceEdits.configureTypescriptApi(request.input);
    return {
      output: { ok: true, receipt },
      commandFacts: {
        extensionConfigured: true,
        extensionId: receipt.extensionId,
        typescriptApiEnabled: receipt.enabled,
        extensionChanged: receipt.changed,
      },
    };
  }
  if (request.operation === "usage.set") {
    const result = await runtime.facade.extensions.setUsage({
      clientRequestId: request.input.clientRequestId,
      extensionId: request.input.extensionId,
      agentProfile: request.input.agentProfile,
      usage: request.input.usage,
    });
    return {
      output: {
        ok: true,
        changeId: result.change.changeId,
        extensionId: result.change.extensionId,
        agentProfile: request.input.agentProfile,
        before: { state: result.change.before },
        after: { state: result.change.after },
        agentContextImpact: {
          affectsNewTurns: true,
          activeRunsChangeAtNextSafeBoundary: true,
          affectedSurfaces: result.affectedSurfaces,
        },
      },
      commandFacts: {
        extensionUsageChanged: true,
        extensionId: result.change.extensionId,
        agentProfile: request.input.agentProfile,
        beforeUsageState: result.change.before,
        afterUsageState: result.change.after,
        affectedAgentContextSurfaces: result.affectedSurfaces.length,
      },
    };
  }
  if (request.operation === "usage.revert") {
    const result = await runtime.facade.extensions.revertUsage(request.input);
    return {
      output: {
        ok: true,
        reverted: request.input.changeId,
        changeId: result.change.changeId,
        extensionId: result.change.extensionId,
        after: { state: result.change.after },
        agentContextImpact: {
          affectsNewTurns: true,
          activeRunsChangeAtNextSafeBoundary: true,
          affectedSurfaces: result.affectedSurfaces,
        },
      },
      commandFacts: {
        extensionUsageReverted: true,
        extensionId: result.change.extensionId,
        revertedExtensionChangeId: request.input.changeId,
        extensionChangeId: result.change.changeId,
        affectedAgentContextSurfaces: result.affectedSurfaces.length,
      },
    };
  }
  if (request.operation === "snapshots.list") {
    const result = await runtime.facade.extensions.snapshots.list({});
    return {
      output: { ok: true, snapshots: result.snapshots },
      commandFacts: {
        extensionSnapshotsListed: true,
        extensionSnapshotCount: result.snapshots.length,
      },
    };
  }
  const snapshots = await runtime.facade.extensions.snapshots.list({});
  const requestedSnapshotId = "snapshotId" in request.input ? request.input.snapshotId : null;
  const current = requestedSnapshotId
    ? snapshots.snapshots.find((snapshot) => snapshot.snapshotId === requestedSnapshotId)
    : undefined;
  if (requestedSnapshotId && !current) {
    throw new Error(`Extension snapshot not found: ${requestedSnapshotId}`);
  }
  const now = new Date().toISOString() as IsoDateTimeString;
  if (request.operation === "snapshots.save") {
    const snapshot = await runtime.facade.extensions.snapshots.save({
      ...request.input,
      snapshotId: `extension-snapshot:${randomUUID()}` as ExtensionSnapshotId,
      capturedAt: now as never,
    });
    return {
      output: { ok: true, snapshot },
      commandFacts: { extensionSnapshotSaved: true, snapshotId: snapshot.snapshotId },
    };
  }
  if (request.operation === "snapshots.rename") {
    const snapshot = await runtime.facade.extensions.snapshots.rename({
      ...request.input,
      expectedRevision: current!.revision,
      renamedAt: now as never,
    });
    return {
      output: { ok: true, snapshot },
      commandFacts: { extensionSnapshotRenamed: true, snapshotId: snapshot.snapshotId },
    };
  }
  if (request.operation === "snapshots.delete") {
    const result = await runtime.facade.extensions.snapshots.delete({
      ...request.input,
      expectedRevision: current!.revision,
      deletedAt: now as never,
      cleanupId: `extension-snapshot-cleanup:${randomUUID()}` as ExtensionSnapshotCleanupId,
    });
    return {
      output: { ok: true, ...result },
      commandFacts: { extensionSnapshotDeleted: true, snapshotId: result.snapshotId },
    };
  }
  const result = await runtime.facade.extensions.snapshots.load({
    ...request.input,
    expectedRevision: current!.revision,
    attemptId: `extension-snapshot-restore:${randomUUID()}` as ExtensionSnapshotRestoreAttemptId,
    startedAt: now as never,
  });
  const { affectedSurfaces, ...snapshotResult } = result;
  return {
    output: {
      ok: result.status === "completed",
      ...snapshotResult,
      agentContextImpact: { affectedSurfaces },
    },
    commandFacts: {
      extensionSnapshotLoaded: result.status === "completed",
      snapshotId: result.snapshotId,
      extensionSnapshotLoadStatus: result.status,
      affectedAgentContextSurfaces: affectedSurfaces.length,
    },
  };
}

async function applyWorkflowsRuntimeRequest(
  runtime: AppRuntimeBootstrap,
  request: SvvyxWorkflowsRuntimeRequest,
): Promise<SvvyxWorkflowsRuntimeResponse> {
  const refresh = await runtime.internal.sourceInvalidation.refreshGeneratedPackages({
    scope: "app-global",
    packages: ["@svvyx/workflows"],
    reason: "explicit-build",
    ...(request.input.sourceCommandId ? { sourceCommandId: request.input.sourceCommandId } : {}),
  });
  const status = refresh.packages.find((candidate) => candidate.packageName === "@svvyx/workflows");
  if (!status || status.action === "failed" || !status.buildId) {
    const diagnostics = (status?.diagnostics ?? ["Workflows generated package build failed."]).map(
      (message) => ({
        code: message.includes("current successful build")
          ? "extension_build_required"
          : "generated_package_build_failed",
        message,
      }),
    );
    return {
      output: {
        ok: false,
        error: { code: "build_failed", message: "Workflows build failed.", diagnostics },
      },
      commandFacts: {
        workflowBuildOk: false,
        workflowDiagnosticCount: diagnostics.length,
      },
    };
  }
  const readModel = await runtime.state.readModels.fetch({
    kind: "workflowsGenerated",
    buildId: status.buildId,
  });
  if (readModel.kind !== "workflowsGenerated") {
    throw new Error("Workflows generated-package state projection was unavailable after build.");
  }
  const items = readModel.value.exports.map((item) => ({
    kind: item.kind,
    namespace: item.namespace,
    exportName: item.exportName,
    qualifiedName: item.qualifiedName,
    sourcePath: item.sourcePath,
    generatedPath: item.generatedPath,
  }));
  return {
    output: {
      ok: true,
      generatedPackagePath: status.manifestPath
        ? status.manifestPath.slice(0, status.manifestPath.lastIndexOf("/"))
        : null,
      diagnostics: status.diagnostics ?? [],
      items,
    },
    commandFacts: {
      workflowBuildOk: true,
      workflowExportCount: items.length,
      workflowDiagnosticCount: status.diagnostics?.length ?? 0,
      workflowGeneratedPackageBuildId: status.buildId,
    },
  };
}

type RuntimeFacade = AppRuntimeBootstrap["facade"];
type RuntimeSourceInvalidationReactionInput =
  | {
      readonly scope: { readonly kind: "app-global" };
      readonly event: RuntimeSourceInvalidationEvent;
    }
  | {
      readonly scope: { readonly kind: "workspace"; readonly workspaceId: WorkspaceId };
      readonly event: RuntimeSourceInvalidationEvent;
    };

type StateOwnedAppPreferencesRecord = {
  readonly appearance: AppPreferences["appAppearance"];
  readonly externalEditor: string | null;
  readonly artifactDirectory: string;
  readonly approvalMode: AppPreferences["approvalMode"];
  readonly networkAccess: boolean;
  readonly externalInstructions: AppPreferences["externalInstructions"];
  readonly ambientResources: unknown;
};
export type WorkspaceRuntimeOperations = Pick<
  RuntimeFacade,
  | "approvals"
  | "commands"
  | "messages"
  | "queues"
  | "requestInput"
  | "surfaces"
  | "sourceEdits"
  | "sourceInvalidation"
>;

export interface DesktopAppFacades {
  readonly appActions: DesktopAppActionsFacade;
  readonly runtimeActions: DesktopRuntimeActionsFacade;
  readonly runtimeCommands: CreateDesktopAppInput["commands"]["runtime"];
  readonly rendererState: RendererStateFacade;
  readonly rendererStateCommands: RendererStateCommandsFacade;
  readonly modelMetadata: AppRuntimeBootstrap["modelMetadata"];
  readonly runtimeEvents: RuntimeFacade["events"];
}

const nodeGeneratedPackageWorkspaceLinkFileHost: RuntimeGeneratedPackageWorkspaceLinkFileHost = {
  pathExists: (path: string): boolean => existsSync(path),
  isDirectory: (path: string): boolean => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  isSymbolicLink: (path: string): boolean => {
    try {
      return lstatSync(path).isSymbolicLink();
    } catch {
      return false;
    }
  },
  readSymbolicLink: (path: string): string | null => {
    try {
      return readlinkSync(path);
    } catch {
      return null;
    }
  },
  makeDirectory: (path: string): void => {
    mkdirSync(path, { recursive: true });
  },
  remove: (path: string): void => {
    rmSync(path, { force: true });
  },
  symlinkDirectory: (input: { targetPath: string; linkPath: string }): void => {
    symlinkSync(input.targetPath, input.linkPath, "dir");
  },
};

function getWorkspaceBranch(cwd: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;

  const branch = result.stdout.trim();
  return branch && branch !== "HEAD" ? branch : undefined;
}

function getWorkspaceBranches(cwd: string): string[] {
  const result = spawnSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return [];

  return result.stdout
    .split(/\r?\n/)
    .map((branch) => branch.trim())
    .filter(Boolean);
}

function workspaceInfoWithBranch(runtime: WorkspaceRuntime): WorkspaceInfoResponse {
  const branch = getWorkspaceBranch(runtime.cwd);
  return {
    ...runtime.getInfo(),
    ...(branch ? { branch } : {}),
  };
}

type WorkspaceRuntimeRegistryOptions = {
  initialCwd: string;
  openInitialWorkspace?: boolean;
  agentDir?: string;
  appDataDir?: string;
  forwardBridgeLog?: (
    level: BridgeLogLevel,
    message: string,
    source: string,
    details?: Record<string, unknown>,
    error?: unknown,
  ) => void;
  runtimeDependencies?: Partial<RuntimeProviderAuthDependencies>;
  runtimeLayerConfig: RuntimeLayerConfig;
  sandboxHostSupport: PackagedSandboxHostSupportServices;
  extensionCliRequirementProbe: ExtensionCliRequirementProbePortService;
  extensionBuildProcess: ExtensionBuildProcessPortService;
  secretStore: SecretStorePortService;
  secretStoreMutation: SecretStoreMutationPortService;
  sourceInvalidationHost?: RuntimeSourceInvalidationHost;
  sourceWatchEnabled?: boolean;
  workflowsGeneratedPackagePath?: string;
  workflowsExtensionsGeneratedPackagePath?: string;
  coreTypeContractPackagePath?: string;
  workflowsSourceRoot?: string;
  packagedExtensionTemplatesRoot?: string;
};

type OpenWorkspaceOptions = {
  kind?: WorkspaceKind;
};

export type WorkspaceRuntime = {
  workspaceId: string;
  cwd: string;
  label: string;
  kind: WorkspaceKind;
  openedAt: string;
  catalog: WorkspaceSessionCatalog;
  pathIndex: WorkspacePathIndex;
  agentSettingsStore: ReturnType<typeof createAgentSettingsStore>;
  appLogs: StateAppLogsFacade;
  appLog: ReturnType<typeof createAppLogger>;
  getInfo: () => WorkspaceInfoResponse;
  dispose: () => Promise<void>;
};

type RuntimeRecord = Omit<WorkspaceRuntime, "dispose"> & {
  refCount: number;
  commandStdin: ReturnType<typeof createLiveCommandStdinRegistry>;
  sourceInvalidationCoordinator: RuntimeSourceInvalidationCoordinatorHandle;
  latestOwnerReleaseResult: ReleaseWorkspaceResult | null;
  reactivate(): Promise<void>;
  dispose(): Promise<void>;
  releaseVisualOwner(): Promise<ReleaseWorkspaceResult | null>;
  shutdown(appRuntime?: AppRuntimeBootstrap | null): Promise<void>;
};

type OpeningRuntimeRecord = Pick<
  RuntimeRecord,
  | "workspaceId"
  | "cwd"
  | "kind"
  | "catalog"
  | "agentSettingsStore"
  | "commandStdin"
  | "appLogs"
  | "appLog"
> & {
  sourceInvalidationCoordinator: RuntimeSourceInvalidationCoordinatorHandle | null;
};

type AppGlobalHostRecord = {
  workspaceId: string;
  cwd: string;
  catalog: WorkspaceSessionCatalog;
  agentSettingsStore: AgentSettingsStore;
  commandStdin: ReturnType<typeof createLiveCommandStdinRegistry>;
  appLogs: StateAppLogsFacade;
  sourceStatePort: Pick<
    RuntimeSourceStatePortService,
    "recordSourceDiagnostic" | "recordSourceScan" | "reconcileDiscoveredHostSnippets"
  >;
  dispose(): Promise<void>;
};

export class WorkspaceRuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly dormantRuntimes = new Map<string, RuntimeRecord>();
  private readonly openingRuntimes = new Map<string, OpeningRuntimeRecord>();
  private readonly pendingRuntimes = new Map<string, Promise<RuntimeRecord>>();
  private readonly closingRuntimes = new Map<string, Promise<void>>();
  private readonly externalWorkspaceOwners = new Map<string, Map<string, RuntimeOwnerRef>>();
  private appGlobalHost: Promise<AppGlobalHostRecord> | null = null;
  private appRuntimeBootstrap: Promise<AppRuntimeBootstrap> | null = null;
  private resolvedAppRuntimeBootstrap: AppRuntimeBootstrap | null = null;
  private stateOwnedAppPreferences: AppPreferences | null = null;
  private catalogAgentProfileAuthority: {
    runtime: AppRuntimeBootstrap;
    authority: CatalogAgentProfileAuthority;
  } | null = null;
  private desktopAppFacades: Promise<DesktopAppFacades> | null = null;
  private appRuntimeBootstrapState: "accepting" | "shutting-down" | "closed" = "accepting";
  private appRuntimeShutdownPromise: Promise<void> | null = null;
  private readonly openingWorkspaceCwds = new Map<string, string>();
  private readonly startupReady: Promise<void>;
  private readonly sharedAppLogFacades = new Map<
    string,
    {
      appLogs: StateAppLogsFacade;
      refCount: number;
    }
  >();
  private appGlobalAppLogFacade: StateAppLogsFacade | null = null;
  private readonly agentDir: string;
  private readonly appDataDir: string;
  private readonly sourceInvalidationHost: RuntimeSourceInvalidationHost;
  private readonly appGlobalSourceInvalidationCoordinator: RuntimeSourceInvalidationCoordinatorHandle;
  private readonly appGlobalSourceReady: Promise<void>;
  private activeWorkspaceId: string | null = null;

  constructor(private readonly options: WorkspaceRuntimeRegistryOptions) {
    this.agentDir = options.agentDir ?? getSvvyAgentDir();
    this.appDataDir = options.appDataDir ?? getSvvyDataDir();
    this.sourceInvalidationHost =
      options.sourceInvalidationHost ?? createNodeSourceInvalidationHost();
    this.appGlobalSourceInvalidationCoordinator = createRuntimeSourceInvalidationCoordinatorHandle({
      debounceMs: this.options.runtimeLayerConfig.sourceDebounceMs,
      host: this.sourceInvalidationHost,
      maxCoalescingLatencyMs: this.options.runtimeLayerConfig.sourceMaxCoalescingLatencyMs,
      readInputs: () =>
        buildAppGlobalSourceWatchInputs({
          extensionsRoot: extensionsRootForAgentDir(this.agentDir),
          host: this.sourceInvalidationHost,
          workflowsSourceRoot: this.options.workflowsSourceRoot ?? workflowsSourceRoot(),
        }),
      onDomainsChanged: (event) =>
        Effect.promise(async () => {
          await this.handleSourceInvalidationEvent({
            scope: { kind: "app-global" },
            event,
          });
          for (const runtime of this.workspaceHostRecords()) {
            runtime.appLog.info("source.graph", "Source inputs changed.", {
              domains: event.domains,
              reason: event.reason,
            });
          }
        }),
      onWatchError: (error, path) => {
        this.options.forwardBridgeLog?.(
          "warn",
          "Source watcher could not watch a path.",
          "source.graph",
          { path },
          error,
        );
      },
      reconciliationIntervalMs: this.options.runtimeLayerConfig.appSourceReconcileIntervalMs,
      retryInitialDelayMs: this.options.runtimeLayerConfig.sourceRetryInitialDelayMs,
      retryMaxAttempts: this.options.runtimeLayerConfig.sourceRetryMaxAttempts,
      retryMaxDelayMs: this.options.runtimeLayerConfig.sourceRetryMaxDelayMs,
      sourceScanRecorder: {
        scope: { kind: "app-global" },
        statePort: {
          recordSourceScan: (input) =>
            Effect.flatMap(
              Effect.promise(() => this.getAppGlobalHostRecord()),
              (host) => host.sourceStatePort.recordSourceScan(input),
            ),
          reconcileDiscoveredHostSnippets: (input) =>
            Effect.flatMap(
              Effect.promise(() => this.getAppGlobalHostRecord()),
              (host) => host.sourceStatePort.reconcileDiscoveredHostSnippets(input),
            ),
          recordSourceDiagnostic: (input) =>
            Effect.flatMap(
              Effect.promise(() => this.getAppGlobalHostRecord()),
              (host) => host.sourceStatePort.recordSourceDiagnostic(input),
            ),
        },
      },
      watchEnabled: this.options.sourceWatchEnabled,
    });
    this.appGlobalSourceReady = this.appGlobalSourceInvalidationCoordinator.ready();
    this.startupReady = this.appGlobalSourceReady.then(async () => {
      if (!options.openInitialWorkspace) {
        return;
      }
      await this.getAppRuntimeBootstrap();
      const runtime = await this.acquireWorkspace(options.initialCwd);
      this.activeWorkspaceId = runtime.workspaceId;
      const state = await this.getRendererStateFacade();
      const chrome = await state.readModels.fetch({ kind: "workspaceChrome" });
      if (chrome.kind === "workspaceChrome" && chrome.value.tabs.length === 0) {
        const commands = await this.getStateCommandsFacade();
        type InitialWorkspaceTab = Parameters<
          typeof commands.workspaceChrome.setTabs
        >[0]["tabs"][number];
        const workspaceTabId =
          `workspace-tab-${randomUUID()}` as InitialWorkspaceTab["workspaceTabId"];
        const tab: InitialWorkspaceTab = {
          workspaceTabId,
          workspaceId: runtime.workspaceId as WorkspaceId,
          cwd: runtime.cwd as AbsolutePath,
          workspaceLabel: runtime.label,
          kind: runtime.kind,
          openedAt: runtime.openedAt as InitialWorkspaceTab["openedAt"],
          activeLayoutId: "A" as const,
        };
        await commands.workspaceChrome.setTabs({
          activeWorkspaceTabId: workspaceTabId,
          tabs: [tab],
          knownWorkspaces: [tab],
        });
      }
    });
  }

  ready(): Promise<void> {
    return this.startupReady;
  }

  openWorkspace(cwd: string, options: OpenWorkspaceOptions = {}): Promise<WorkspaceRuntime> {
    return this.acquireWorkspace(cwd, options);
  }

  async acquireWorkspace(
    cwd: string,
    options: OpenWorkspaceOptions = {},
  ): Promise<WorkspaceRuntime> {
    await this.appGlobalSourceReady;
    if (this.appRuntimeBootstrapState !== "accepting") {
      throw appRuntimeBootstrapUnavailableError(
        "workspace-runtime-registry.acquireWorkspace",
        this.appRuntimeBootstrapState,
      );
    }
    const workspaceCwd = canonicalizeWorkspaceCwd(cwd);
    await this.awaitWorkspaceTransitions(workspaceCwd);
    if (this.appRuntimeBootstrapState !== "accepting") {
      throw appRuntimeBootstrapUnavailableError(
        "workspace-runtime-registry.acquireWorkspace",
        this.appRuntimeBootstrapState,
      );
    }
    const workspaceId = normalizeWorkspaceRuntimeId(workspaceCwd);
    const existing = this.getRuntimeByCwd(workspaceCwd) ?? this.runtimes.get(workspaceId);
    if (existing) {
      existing.refCount += 1;
      this.activeWorkspaceId = existing.workspaceId;
      return existing;
    }

    const pendingKey = workspaceCwd;
    const pending = this.pendingRuntimes.get(pendingKey);
    if (pending) {
      const runtime = await pending;
      if (this.appRuntimeBootstrapState !== "accepting") {
        throw appRuntimeBootstrapUnavailableError(
          "workspace-runtime-registry.acquireWorkspace",
          this.appRuntimeBootstrapState,
        );
      }
      runtime.refCount += 1;
      this.activeWorkspaceId = runtime.workspaceId;
      return runtime;
    }

    let dormant =
      this.getDormantRuntimeByCwd(workspaceCwd) ?? this.dormantRuntimes.get(workspaceId);
    if (
      dormant?.latestOwnerReleaseResult &&
      dormant.latestOwnerReleaseResult.remainingOwners === 0 &&
      !this.externalWorkspaceOwners.has(dormant.workspaceId)
    ) {
      const lastRelease = dormant.latestOwnerReleaseResult;
      await this.runWorkspaceTransition(workspaceCwd, () =>
        this.closeUnownedDormantRuntime(lastRelease),
      );
      if (this.appRuntimeBootstrapState !== "accepting") {
        throw appRuntimeBootstrapUnavailableError(
          "workspace-runtime-registry.acquireWorkspace",
          this.appRuntimeBootstrapState,
        );
      }
      dormant = this.getDormantRuntimeByCwd(workspaceCwd) ?? this.dormantRuntimes.get(workspaceId);
    }
    const pendingRuntime = dormant
      ? this.runWorkspaceTransition(workspaceCwd, async () => {
          await dormant.reactivate();
          if (this.appRuntimeBootstrapState !== "accepting") {
            return dormant;
          }
          dormant.refCount = 1;
          this.dormantRuntimes.delete(dormant.workspaceId);
          this.runtimes.set(dormant.workspaceId, dormant);
          return dormant;
        })
      : this.createRuntime(workspaceId, workspaceCwd, options.kind ?? "user");
    this.pendingRuntimes.set(pendingKey, pendingRuntime);
    let runtime: RuntimeRecord;
    try {
      runtime = await pendingRuntime;
    } finally {
      this.pendingRuntimes.delete(pendingKey);
    }
    if (this.appRuntimeBootstrapState !== "accepting") {
      throw appRuntimeBootstrapUnavailableError(
        "workspace-runtime-registry.acquireWorkspace",
        this.appRuntimeBootstrapState,
      );
    }
    this.runtimes.set(runtime.workspaceId, runtime);
    this.activeWorkspaceId = runtime.workspaceId;
    return runtime;
  }

  getDefaultWorkspace(): Promise<WorkspaceRuntime> {
    return this.acquireWorkspace(getDefaultWorkspaceCwd(this.appDataDir), { kind: "default" });
  }

  getRuntime(workspaceId: string): WorkspaceRuntime {
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime) {
      throw new Error(`Workspace is not open: ${workspaceId}`);
    }
    return runtime;
  }

  getRuntimeOrNull(workspaceId: string): WorkspaceRuntime | null {
    return this.runtimes.get(workspaceId) ?? null;
  }

  getRuntimeOperations(workspaceId: string): WorkspaceRuntimeOperations {
    const operations = this.getAppRuntimeFacadeOperations();
    this.getRuntime(workspaceId);
    return operations;
  }

  getRuntimeEventSubscription(
    workspaceId: string,
    input?: Parameters<RuntimeFacade["events"]>[0],
  ): ReturnType<RuntimeFacade["events"]> {
    if (this.appRuntimeBootstrapState !== "accepting") {
      return Promise.reject(
        appRuntimeBootstrapUnavailableError(
          "workspace-runtime-registry.getAppRuntimeBootstrap",
          this.appRuntimeBootstrapState,
        ),
      ) as ReturnType<RuntimeFacade["events"]>;
    }
    this.getRuntime(workspaceId);
    return this.getAppRuntimeBootstrap().then((runtime) =>
      runtime.facade.events({
        ...input,
        workspaceId: workspaceId as WorkspaceId,
        includeAppEvents: input?.includeAppEvents ?? true,
      }),
    ) as ReturnType<RuntimeFacade["events"]>;
  }

  async getAppRuntimeEventSubscription(
    input?: Parameters<RuntimeFacade["events"]>[0],
  ): ReturnType<RuntimeFacade["events"]> {
    const runtime = await this.getAppRuntimeBootstrap();
    return runtime.facade.events(input) as ReturnType<RuntimeFacade["events"]>;
  }

  acquireDesktopAppFacades(): Promise<DesktopAppFacades> {
    if (this.appRuntimeBootstrapState !== "accepting") {
      return Promise.reject(
        appRuntimeBootstrapUnavailableError(
          "workspace-runtime-registry.acquireDesktopAppFacades",
          this.appRuntimeBootstrapState,
        ),
      );
    }
    if (!this.desktopAppFacades) {
      this.desktopAppFacades = this.getAppRuntimeBootstrap().then((runtime) => {
        const workspaces: RuntimeFacade["workspaces"] = {
          acquire: (input, options) => {
            const authoritativeOptions = options ? { ...options, signal: undefined } : undefined;
            return this.runWorkspaceTransitionWithCancelableWait({
              cwd: input.cwd,
              signal: options?.signal,
              operation: async () => {
                this.assertAcceptingWorkspaceFacadeCall("runtime.workspaces.acquire");
                const predictedWorkspaceId = normalizeWorkspaceRuntimeId(
                  canonicalizeWorkspaceCwd(input.cwd),
                ) as WorkspaceId;
                const host = this.getRetainedWorkspaceHostRecord(predictedWorkspaceId);
                if (!host || host.latestOwnerReleaseResult?.remainingOwners === 0) {
                  throw new RuntimeContractError({
                    operation: "runtime.workspaces.acquire",
                    reason: "target-not-found",
                    message: `Workspace host is not available for ${predictedWorkspaceId}.`,
                  });
                }
                this.trackExternalWorkspaceOwner(predictedWorkspaceId, input.owner);
                const result = await runtime.facade.workspaces.acquire(input, authoritativeOptions);
                if (result.workspaceId !== predictedWorkspaceId) {
                  this.untrackExternalWorkspaceOwner(predictedWorkspaceId, input.owner);
                  this.trackExternalWorkspaceOwner(result.workspaceId, input.owner);
                }
                const resultHost = this.getRetainedWorkspaceHostRecord(result.workspaceId);
                if (!resultHost) {
                  throw new RuntimeContractError({
                    operation: "runtime.workspaces.acquire",
                    reason: "state-conflict",
                    message: `Acquired workspace host disappeared for ${result.workspaceId}.`,
                  });
                }
                resultHost.latestOwnerReleaseResult = null;
                return result;
              },
              abortedFacadeCall: () => {
                const controller = new AbortController();
                controller.abort();
                return runtime.facade.workspaces.acquire(input, {
                  ...options,
                  signal: controller.signal,
                });
              },
            });
          },
          acquireDefault: (input, options) => {
            const defaultWorkspaceCwd = getDefaultWorkspaceCwd(this.appDataDir);
            const authoritativeOptions = options ? { ...options, signal: undefined } : undefined;
            return this.runWorkspaceTransitionWithCancelableWait({
              cwd: defaultWorkspaceCwd,
              signal: options?.signal,
              operation: async () => {
                this.assertAcceptingWorkspaceFacadeCall("runtime.workspaces.acquireDefault");
                const predictedWorkspaceId = normalizeWorkspaceRuntimeId(
                  canonicalizeWorkspaceCwd(defaultWorkspaceCwd),
                ) as WorkspaceId;
                const host = this.getRetainedWorkspaceHostRecord(predictedWorkspaceId);
                if (!host || host.latestOwnerReleaseResult?.remainingOwners === 0) {
                  throw new RuntimeContractError({
                    operation: "runtime.workspaces.acquireDefault",
                    reason: "target-not-found",
                    message: `Default workspace host is not available for ${predictedWorkspaceId}.`,
                  });
                }
                this.trackExternalWorkspaceOwner(predictedWorkspaceId, input.owner);
                const result = await runtime.facade.workspaces.acquireDefault(
                  input,
                  authoritativeOptions,
                );
                if (result.workspaceId !== predictedWorkspaceId) {
                  this.untrackExternalWorkspaceOwner(predictedWorkspaceId, input.owner);
                  this.trackExternalWorkspaceOwner(result.workspaceId, input.owner);
                }
                const resultHost = this.getRetainedWorkspaceHostRecord(result.workspaceId);
                if (!resultHost) {
                  throw new RuntimeContractError({
                    operation: "runtime.workspaces.acquireDefault",
                    reason: "state-conflict",
                    message: `Acquired default workspace host disappeared for ${result.workspaceId}.`,
                  });
                }
                resultHost.latestOwnerReleaseResult = null;
                return result;
              },
              abortedFacadeCall: () => {
                const controller = new AbortController();
                controller.abort();
                return runtime.facade.workspaces.acquireDefault(input, {
                  ...options,
                  signal: controller.signal,
                });
              },
            });
          },
          release: (input, options) => {
            this.assertAcceptingWorkspaceFacadeCall("runtime.workspaces.release");
            const host = this.getRetainedWorkspaceHostRecord(input.workspaceId);
            if (!host) {
              return runtime.facade.workspaces.release(input, options).then((result) => {
                this.untrackExternalWorkspaceOwner(result.workspaceId, input.owner);
                return result;
              });
            }
            const authoritativeOptions = options ? { ...options, signal: undefined } : undefined;
            return this.runWorkspaceTransitionWithCancelableWait({
              cwd: host.cwd,
              signal: options?.signal,
              operation: async () => {
                this.assertAcceptingWorkspaceFacadeCall("runtime.workspaces.release");
                const result = await runtime.facade.workspaces.release(input, authoritativeOptions);
                this.untrackExternalWorkspaceOwner(result.workspaceId, input.owner);
                await this.closeUnownedDormantRuntime(result, runtime);
                return result;
              },
              abortedFacadeCall: () => {
                const controller = new AbortController();
                controller.abort();
                return runtime.facade.workspaces.release(input, {
                  ...options,
                  signal: controller.signal,
                });
              },
            });
          },
        };
        return {
          appActions: {
            workspaces: {
              acquireByCwd: async ({ cwd }) => (await this.acquireWorkspace(cwd)).getInfo(),
              acquireDefault: async () => (await this.getDefaultWorkspace()).getInfo(),
              releaseVisual: async ({ workspaceId }) => ({
                released: await this.releaseWorkspace(workspaceId),
              }),
            },
            git: {
              listBranches: async ({ workspaceId }) => {
                const host = this.getRuntime(workspaceId);
                const currentBranch = getWorkspaceBranch(host.cwd);
                return {
                  ...(currentBranch ? { currentBranch } : {}),
                  branches: getWorkspaceBranches(host.cwd).map((branch) => ({
                    name: branch,
                    current: branch === currentBranch,
                  })),
                };
              },
              switchBranch: async ({ workspaceId, branch }) => {
                const host = this.getRuntime(workspaceId);
                const nextBranch = branch.trim();
                const branches = getWorkspaceBranches(host.cwd);
                if (!nextBranch || !branches.includes(nextBranch)) {
                  return {
                    ok: false,
                    workspace: workspaceInfoWithBranch(host),
                    error: "Branch is not available in this workspace.",
                  };
                }

                if (getWorkspaceBranch(host.cwd) === nextBranch) {
                  return { ok: true, switched: false, workspace: workspaceInfoWithBranch(host) };
                }

                const result = spawnSync("git", ["switch", nextBranch], {
                  cwd: host.cwd,
                  encoding: "utf8",
                  stdio: ["ignore", "pipe", "pipe"],
                });
                if (result.status !== 0) {
                  return {
                    ok: false,
                    workspace: workspaceInfoWithBranch(host),
                    error: (result.stderr || result.stdout).trim() || "Unable to switch branch.",
                  };
                }

                host.pathIndex.refresh();
                host.appLog.info("workspace", "Workspace branch switched.", {
                  workspaceId: host.workspaceId,
                  branch: nextBranch,
                });
                return { ok: true, switched: true, workspace: workspaceInfoWithBranch(host) };
              },
            },
            artifacts: {
              preview: async ({ workspaceId, workspaceSessionId, artifactId }) => {
                const result = await runtime.state.readModels.fetch({
                  kind: "artifactInspector",
                  workspaceId: workspaceId as WorkspaceId,
                  workspaceSessionId: workspaceSessionId as WorkspaceSessionId,
                  artifactId,
                });
                if (result.kind !== "artifactInspector") {
                  throw new Error(`Expected artifact inspector; received ${result.kind}.`);
                }
                const artifact = result.value;
                if (!artifact) {
                  throw new Error(`Structured artifact not found: ${artifactId}`);
                }
                const file = artifact.path
                  ? readRuntimeArtifactPreviewContent(artifact.path)
                  : { missingFile: true, content: "" };
                return {
                  artifactId: artifact.artifactId,
                  sessionId: artifact.workspaceSessionId,
                  kind: artifact.kind,
                  name: artifact.name,
                  ...(artifact.path ? { path: artifact.path } : {}),
                  createdAt: artifact.createdAt,
                  ...(artifact.sourceCommandId
                    ? { sourceCommandId: artifact.sourceCommandId }
                    : {}),
                  ...(artifact.workflowRunId ? { workflowRunId: artifact.workflowRunId } : {}),
                  ...(artifact.workflowName ? { workflowName: artifact.workflowName } : {}),
                  ...(artifact.producerLabel ? { producerLabel: artifact.producerLabel } : {}),
                  missingFile: file.missingFile,
                  content: file.content,
                };
              },
            },
            workspaceFiles: {
              getRoot: async ({ workspaceId }) => ({ cwd: this.getRuntime(workspaceId).cwd }),
              listPaths: async ({ workspaceId, refresh }) => {
                const host = this.getRuntime(workspaceId);
                return refresh ? host.pathIndex.refresh() : host.pathIndex.list();
              },
              materializeSelectedAttachments: async ({ workspaceId, selectedPaths }) => {
                const host = this.getRuntime(workspaceId);
                return materializeSelectedWorkspaceAttachments({ cwd: host.cwd, selectedPaths });
              },
              importComposerAttachments: async ({ workspaceId, attachments }) => {
                const host = this.getRuntime(workspaceId);
                return importWorkspaceComposerAttachments({ cwd: host.cwd, attachments });
              },
              resolvePathTarget: async ({ workspaceId, workspaceRelativePath }) => {
                const host = this.getRuntime(workspaceId);
                return resolveWorkspacePathTarget({ cwd: host.cwd, workspaceRelativePath });
              },
            },
            externalInstructions: {
              resolveEditorTarget: async ({ workspaceId, sourceId }) => {
                const host = this.getRuntime(workspaceId);
                const readModelResult = await runtime.state.readModels.fetch({
                  kind: "externalInstructions",
                  workspaceId: workspaceId as WorkspaceId,
                });
                if (readModelResult.kind !== "externalInstructions") {
                  throw new Error(
                    `Expected state read model externalInstructions; received ${readModelResult.kind}.`,
                  );
                }
                const source = readModelResult.value.sources.find(
                  (candidate) => candidate.id === sourceId,
                );
                if (
                  !source ||
                  source.readStatus.status !== "readable" ||
                  !existsSync(source.canonicalPath)
                ) {
                  host.appLog.warning(
                    "external-editor",
                    "Prompt standards source does not exist.",
                    { sourceId },
                  );
                  throw new Error(`Prompt standards source is not readable: ${sourceId}`);
                }
                const preferences = host.agentSettingsStore.getState().appPreferences;
                return {
                  sourceId: source.id,
                  path: source.canonicalPath,
                  cwd: host.cwd,
                  editor: preferences.preferredExternalEditor,
                  customCommand: preferences.customExternalEditorCommand,
                };
              },
              recordEditorResult: async (input) => {
                const host = this.getRuntime(input.workspaceId);
                if (input.failure?.kind === "app-launch") {
                  host.appLog.warning("external-editor", "External editor app launch failed.", {
                    sourceId: input.sourceId,
                    editor: input.editor,
                    path: input.path,
                    message: input.failure.message,
                  });
                } else if (input.failure?.kind === "custom-command-empty") {
                  host.appLog.warning(
                    "external-editor",
                    "Custom external editor command is empty.",
                    { sourceId: input.sourceId, path: input.path },
                  );
                } else if (input.failure?.kind === "custom-command-launch") {
                  host.appLog.warning("external-editor", "Custom external editor command failed.", {
                    sourceId: input.sourceId,
                    command: input.failure.command,
                    path: input.path,
                    message: input.failure.message,
                  });
                }
                host.appLog.info(
                  "external-editor",
                  "Prompt standards source opened in external editor.",
                  {
                    sourceId: input.sourceId,
                    path: input.path,
                    editor: input.editor,
                    opened: input.opened,
                  },
                );
                return { ok: true };
              },
            },
            telemetry: {
              recordRenderer: async (input) => {
                const host = this.getRuntime(input.workspaceId);
                const level = input.level ?? "debug";
                const details = {
                  eventName: input.eventName,
                  correlationId: input.correlationId ?? null,
                  panelId: input.panelId ?? null,
                  ...input.details,
                  workspaceSessionId: input.target?.workspaceSessionId,
                  surfacePiSessionId: input.target?.surfacePiSessionId,
                  surface: input.target?.surface,
                  threadId: input.target?.threadId,
                };
                const message = input.message ?? `Renderer telemetry: ${input.eventName}`;
                if (level === "error") {
                  host.appLog.error("renderer", message, input.error, details);
                } else if (level === "warn") {
                  host.appLog.warning("renderer", message, details);
                } else if (level === "info") {
                  host.appLog.info("renderer", message, details);
                } else {
                  host.appLog.debug("renderer", message, details);
                }
                return { ok: true };
              },
            },
          },
          runtimeActions: {
            workspaces,
            surfaces: runtime.facade.surfaces,
            messages: runtime.facade.messages,
            queues: runtime.facade.queues,
            requestInput: runtime.facade.requestInput,
            generatedContext: runtime.facade.generatedContext,
            approvals: runtime.facade.approvals,
            extensions: runtime.facade.extensions,
            sourceEdits: runtime.facade.sourceEdits,
            sourceInvalidation: runtime.facade.sourceInvalidation,
          },
          runtimeCommands: runtime.facade.commands,
          rendererState: runtime.rendererState,
          rendererStateCommands: runtime.rendererStateCommands,
          modelMetadata: runtime.modelMetadata,
          runtimeEvents: runtime.facade.events,
        };
      });
    }
    return this.desktopAppFacades!;
  }

  getActiveRuntime(): WorkspaceRuntime {
    if (!this.activeWorkspaceId) {
      throw new Error("No workspace is active.");
    }
    return this.getRuntime(this.activeWorkspaceId);
  }

  getActiveRuntimeOrNull(): WorkspaceRuntime | null {
    return this.activeWorkspaceId ? this.getRuntime(this.activeWorkspaceId) : null;
  }

  getActiveWorkspaceId(): string | null {
    return this.activeWorkspaceId;
  }

  getInitialCwd(): string {
    return this.options.initialCwd;
  }

  listOpenWorkspaces(): WorkspaceInfoResponse[] {
    return Array.from(this.runtimes.values()).map((runtime) => runtime.getInfo());
  }

  async closeWorkspace(workspaceId: string): Promise<boolean> {
    return this.releaseWorkspace(workspaceId);
  }

  async releaseWorkspace(workspaceId: string): Promise<boolean> {
    if (this.appRuntimeBootstrapState !== "accepting") {
      return false;
    }
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime) {
      const dormant = this.dormantRuntimes.get(workspaceId);
      if (!dormant) {
        return false;
      }
      await this.runWorkspaceTransition(dormant.cwd, async () => {
        if (
          dormant.latestOwnerReleaseResult &&
          dormant.latestOwnerReleaseResult.remainingOwners === 0
        ) {
          await this.closeUnownedDormantRuntime(dormant.latestOwnerReleaseResult);
          return;
        }
        const result = await dormant.releaseVisualOwner();
        if (result) {
          await this.closeUnownedDormantRuntime(result);
        }
      });
      return true;
    }

    runtime.refCount -= 1;
    if (runtime.refCount > 0) {
      if (this.activeWorkspaceId === workspaceId) {
        this.activeWorkspaceId = workspaceId;
      }
      return true;
    }

    this.runtimes.delete(workspaceId);
    this.dormantRuntimes.set(workspaceId, runtime);
    if (this.activeWorkspaceId === workspaceId) {
      const next = this.runtimes.keys().next().value as string | undefined;
      this.activeWorkspaceId = next ?? null;
    }
    await this.runWorkspaceTransition(runtime.cwd, async () => {
      const result = await runtime.releaseVisualOwner();
      if (result) {
        await this.closeUnownedDormantRuntime(result);
      }
    });
    return true;
  }

  requestSourceInvalidationScan(reason: string): void {
    void this.appGlobalSourceInvalidationCoordinator.requestScan(reason);
    for (const runtime of this.workspaceHostRecords()) {
      void runtime.sourceInvalidationCoordinator?.requestScan(reason);
    }
  }

  async refreshExternalInstructionSourceInputs(reason: string): Promise<void> {
    await Promise.all(
      this.workspaceHostRecords().map((runtime) =>
        runtime.sourceInvalidationCoordinator?.refreshWatchedInputs(reason),
      ),
    );
  }

  shutdownApp(reason: "app-shutdown" | "startup-failure" = "app-shutdown"): Promise<void> {
    if (this.appRuntimeShutdownPromise) return this.appRuntimeShutdownPromise;
    const appRuntimeBootstrap = this.appRuntimeBootstrap;
    const appGlobalHost = this.appGlobalHost;
    const workspaceRuntimes = [...this.runtimes.values(), ...this.dormantRuntimes.values()];
    const pendingWorkspaceRuntimes = Array.from(this.pendingRuntimes.values());
    const closingWorkspaceRuntimes = Array.from(this.closingRuntimes.values());
    this.appRuntimeBootstrapState = "shutting-down";
    this.runtimes.clear();
    this.dormantRuntimes.clear();
    this.activeWorkspaceId = null;
    let retryableWorkspaceCleanupFailure = false;
    const shutdownPromise = (async () => {
      const errors: unknown[] = [];
      let resolvedBootstrap: AppRuntimeBootstrap | null = null;
      if (appRuntimeBootstrap) {
        try {
          resolvedBootstrap = await appRuntimeBootstrap;
        } catch (error) {
          errors.push(error);
        }
      }
      const settledClosingRuntimes = await Promise.allSettled(closingWorkspaceRuntimes);
      for (const result of settledClosingRuntimes) {
        if (result.status === "rejected") {
          errors.push(result.reason);
        }
      }
      this.closingRuntimes.clear();
      const settledPendingRuntimes = await Promise.allSettled(pendingWorkspaceRuntimes);
      const runtimesToDispose = new Set(workspaceRuntimes);
      for (const result of settledPendingRuntimes) {
        if (result.status === "fulfilled") {
          runtimesToDispose.add(result.value);
        }
      }
      this.pendingRuntimes.clear();
      let workspaceCleanupIncomplete = false;
      for (const runtime of runtimesToDispose) {
        let externalOwnersReleased = true;
        if (resolvedBootstrap) {
          try {
            await this.releaseExternalWorkspaceOwnersForShutdown(runtime, resolvedBootstrap);
          } catch (error) {
            errors.push(error);
            externalOwnersReleased = false;
          }
        } else if (this.externalWorkspaceOwners.has(runtime.workspaceId)) {
          externalOwnersReleased = false;
        }
        if (!externalOwnersReleased) {
          this.dormantRuntimes.set(runtime.workspaceId, runtime);
          workspaceCleanupIncomplete = true;
          continue;
        }
        try {
          await runtime.shutdown(resolvedBootstrap);
        } catch (error) {
          errors.push(error);
          this.dormantRuntimes.set(runtime.workspaceId, runtime);
          workspaceCleanupIncomplete = true;
        }
      }
      if (workspaceCleanupIncomplete) {
        retryableWorkspaceCleanupFailure = true;
        throw new AggregateError(errors, "Workspace runtime resources did not shut down cleanly.");
      }
      try {
        await this.appGlobalSourceInvalidationCoordinator.close();
      } catch (error) {
        errors.push(error);
      }
      if (resolvedBootstrap) {
        try {
          await resolvedBootstrap.dispose(reason);
        } catch (error) {
          errors.push(error);
        }
      }
      if (appGlobalHost) {
        try {
          await (await appGlobalHost).dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      this.appRuntimeBootstrapState = "closed";
      this.resolvedAppRuntimeBootstrap = null;
      this.stateOwnedAppPreferences = null;
      this.catalogAgentProfileAuthority = null;
      this.desktopAppFacades = null;
      this.appGlobalHost = null;
      this.openingRuntimes.clear();
      if (errors.length > 0) {
        throw new AggregateError(errors, "The app runtime registry did not shut down cleanly.");
      }
    })();
    this.appRuntimeShutdownPromise = shutdownPromise;
    void shutdownPromise.catch(() => {
      if (retryableWorkspaceCleanupFailure && this.appRuntimeShutdownPromise === shutdownPromise) {
        this.appRuntimeShutdownPromise = null;
      }
    });
    return shutdownPromise;
  }

  private async createRuntime(
    requestedWorkspaceId: string,
    cwd: string,
    kind: WorkspaceKind,
  ): Promise<RuntimeRecord> {
    const initialAppRuntime = await this.getAppRuntimeBootstrap();
    const stateOwnedAppPreferences =
      this.stateOwnedAppPreferences ?? (await this.hydrateStateOwnedAppPreferencesFromStateRows());
    const label = kind === "default" ? "Default Workspace" : basename(cwd) || "workspace";
    const sessionDir = getSvvySessionDir(cwd, this.agentDir);
    const commandStdin = createLiveCommandStdinRegistry();
    const catalog = createRuntimeBackedWorkspaceSessionCatalog(
      cwd,
      this.agentDir,
      sessionDir,
      join(sessionDir, "namer"),
      requestedWorkspaceId,
      {
        artifactDirectory: resolveConfiguredArtifactDirectory(
          stateOwnedAppPreferences.artifactDirectory,
          cwd,
        ),
        workflowsExtensionsGeneratedPackagePath:
          this.options.workflowsExtensionsGeneratedPackagePath,
        workflowsGeneratedPackagePath: this.options.workflowsGeneratedPackagePath,
        workflowsSourceRoot: this.options.workflowsSourceRoot,
        refreshGeneratedPackages: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.sourceInvalidation.refreshGeneratedPackages(request);
        },
        wakeSurfaceQueue: async (target) => {
          const runtime = await this.getAppRuntimeBootstrap();
          await runtime.internal.workspaceRecovery.wakeSurfaceQueue(target as RuntimePromptTarget);
        },
        acquireExecuteTypescriptLaunch: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.launchFacts.acquireExecuteTypescript(request);
        },
        acquireDirectToolLaunch: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.launchFacts.acquireDirectToolLaunch(request);
        },
        runAcceptedLoadExtension: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.acceptedNativeTools.runLoadExtension(request);
        },
        applyExtensionManagementRuntimeRequest: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return applyExtensionManagementRuntimeRequest(
            runtime,
            request,
            requestedWorkspaceId as WorkspaceId,
          );
        },
        applyWorkflowsRuntimeRequest: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return applyWorkflowsRuntimeRequest(runtime, request);
        },
        requestDirectToolApproval: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.acceptedNativeTools.requestDirectToolApproval(request);
        },
        runTaskAgent: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.workflowTaskAgentBridge.runTaskAgent(request);
        },
      },
      undefined,
      undefined,
      commandStdin,
      this.options.runtimeLayerConfig,
    );
    let appLogs: StateAppLogsFacade | null = null;
    let appLog: ReturnType<typeof createAppLogger> | null = null;
    let sourceInvalidationCoordinator: RuntimeSourceInvalidationCoordinatorHandle | null = null;
    let appRuntime: AppRuntimeBootstrap | null = initialAppRuntime;
    let workspaceStateRegistered = false;
    let desktopOwnerReleaseRequired = false;
    let cleanupComplete = false;
    let catalogListenersDetached = false;
    let sourceCoordinatorClosed = false;
    let workspaceStateUnregistered = false;
    let catalogDisposed = false;
    let appLogsReleased = false;
    let resolvedWorkspaceId = requestedWorkspaceId;
    let workspaceCloseRecorded = false;

    const detachCatalogListeners = (): void => {
      void catalog.setCommittedStateInvalidationPublisher(null);
      catalog.setTitleGenerationLogListener(null);
      catalog.setWorkflowsGeneratedPackageLogListener(null);
      catalog.setAppLogListener(null);
    };

    const releaseDesktopOwner = async (
      suppliedRuntime: AppRuntimeBootstrap | null | undefined,
      releaseReason: "tab-closed" | "shutdown",
    ): Promise<ReleaseWorkspaceResult | null> => {
      if (!desktopOwnerReleaseRequired) {
        return null;
      }
      const runtime = suppliedRuntime ?? appRuntime ?? (await this.getAppRuntimeBootstrap());
      const result = await runtime.facade.workspaces.release({
        workspaceId: resolvedWorkspaceId as WorkspaceId,
        owner: workspaceOwnerRef(resolvedWorkspaceId),
        releaseReason,
      });
      desktopOwnerReleaseRequired = false;
      return result;
    };

    const cleanupWorkspaceResources = async (
      suppliedRuntime: AppRuntimeBootstrap | null | undefined,
      releaseReason: "tab-closed" | "shutdown",
    ): Promise<void> => {
      if (cleanupComplete) {
        return;
      }
      const errors: unknown[] = [];
      if (!catalogListenersDetached) {
        try {
          detachCatalogListeners();
          catalogListenersDetached = true;
        } catch (error) {
          errors.push(error);
        }
      }
      if (!sourceCoordinatorClosed) {
        try {
          await sourceInvalidationCoordinator?.close();
          sourceCoordinatorClosed = true;
        } catch (error) {
          errors.push(error);
        }
      }
      let shutdownRuntime = suppliedRuntime;
      if (
        shutdownRuntime === undefined &&
        (desktopOwnerReleaseRequired || (workspaceStateRegistered && !workspaceStateUnregistered))
      ) {
        try {
          shutdownRuntime = appRuntime ?? (await this.getAppRuntimeBootstrap());
        } catch (error) {
          errors.push(error);
          shutdownRuntime = null;
        }
      }
      if (desktopOwnerReleaseRequired && shutdownRuntime) {
        try {
          await releaseDesktopOwner(shutdownRuntime, releaseReason);
        } catch (error) {
          errors.push(error);
        }
      }
      if (
        workspaceStateRegistered &&
        !workspaceStateUnregistered &&
        shutdownRuntime &&
        catalogListenersDetached &&
        sourceCoordinatorClosed &&
        !desktopOwnerReleaseRequired
      ) {
        try {
          shutdownRuntime.internal.workspaceStates.unregister(resolvedWorkspaceId as WorkspaceId);
          workspaceStateUnregistered = true;
          workspaceStateRegistered = false;
        } catch (error) {
          errors.push(error);
        }
      }
      if (!workspaceStateRegistered) {
        workspaceStateUnregistered = true;
      }
      if (
        !catalogDisposed &&
        catalogListenersDetached &&
        sourceCoordinatorClosed &&
        workspaceStateUnregistered &&
        !desktopOwnerReleaseRequired
      ) {
        try {
          await catalog.dispose();
          catalogDisposed = true;
        } catch (error) {
          errors.push(error);
        }
      }
      if (!appLogsReleased && catalogDisposed) {
        try {
          if (appLogs) {
            this.releaseAppLogFacade(cwd);
            appLogs = null;
          }
          appLogsReleased = true;
        } catch (error) {
          errors.push(error);
        }
      }
      cleanupComplete =
        catalogListenersDetached &&
        sourceCoordinatorClosed &&
        workspaceStateUnregistered &&
        catalogDisposed &&
        appLogsReleased &&
        !desktopOwnerReleaseRequired;
      if (errors.length > 0) {
        throw new AggregateError(errors, "Workspace runtime resources did not close cleanly.");
      }
      if (!cleanupComplete) {
        throw new Error("Workspace runtime resources did not reach a closed state.");
      }
    };

    try {
      const workspaceStateRegistration = catalog.workspaceStateRouterRegistration();
      const workspaceId = workspaceStateRegistration.store.workspaceId;
      resolvedWorkspaceId = workspaceId;
      const pathIndex = new WorkspacePathIndex(cwd);
      const agentSettingsStore = createAgentSettingsStore({
        agentDir: this.agentDir,
      });
      appLogs = this.acquireAppLogFacade(workspaceId, cwd);
      appLog = createAppLogger({
        appLogs,
        forwardBridgeLog: (level, message, source, details, error) => {
          this.options.forwardBridgeLog?.(
            level,
            message,
            source,
            { ...details, workspaceId },
            error,
          );
        },
      });
      const workspaceAppLog = appLog;
      workspaceAppLog.info("app.lifecycle", "Workspace scope opened.", {
        workspaceId,
        kind,
        cwd,
      });
      const openingRuntime: OpeningRuntimeRecord = {
        workspaceId,
        cwd,
        kind,
        catalog,
        agentSettingsStore,
        commandStdin,
        appLogs,
        appLog: workspaceAppLog,
        sourceInvalidationCoordinator: null,
      };
      this.openingRuntimes.set(workspaceId, openingRuntime);
      this.openingWorkspaceCwds.set(workspaceId, cwd);
      if (requestedWorkspaceId !== workspaceId) {
        this.openingRuntimes.set(requestedWorkspaceId, openingRuntime);
        this.openingWorkspaceCwds.set(requestedWorkspaceId, cwd);
      }
      try {
        catalog.setTitleGenerationLogListener((event) => {
          recordTitleGenerationLog(workspaceAppLog, event);
        });
        catalog.setWorkflowsGeneratedPackageLogListener((event) => {
          for (const runtime of this.workspaceHostRecords()) {
            recordWorkflowsGeneratedPackageLog(runtime.appLog, event);
          }
        });
        catalog.setAppLogListener((event) => {
          appendAppLoggerEvent(workspaceAppLog, event);
        });
        appRuntime = await this.getAppRuntimeBootstrap();
        catalog.setAgentProfileAuthority(this.createCatalogAgentProfileAuthority(appRuntime));
        catalog.setRequestInputSettingsAuthority(
          this.createCatalogRequestInputSettingsAuthority(
            (await this.getAppGlobalHostRecord()).catalog,
          ),
        );
        workspaceStateRegistered = true;
        await appRuntime.internal.workspaceStates.register(
          kind === "default"
            ? { ...workspaceStateRegistration, isDefaultWorkspace: true }
            : workspaceStateRegistration,
          appLogs,
        );
        await catalog.setCommittedStateInvalidationPublisher((afterCommit) =>
          appRuntime!.internal.committedStateInvalidations.publish(afterCommit),
        );
        await catalog.prepareWorkspaceRecoveryAfterRegistration();
        if (kind === "default") {
          desktopOwnerReleaseRequired = true;
          await appRuntime.facade.workspaces.acquireDefault({
            owner: workspaceOwnerRef(workspaceId),
            openReason: "startup",
          });
        } else {
          desktopOwnerReleaseRequired = true;
          await appRuntime.facade.workspaces.acquire({
            cwd: cwd as AbsolutePath,
            owner: workspaceOwnerRef(workspaceId),
            openReason: "user-open",
          });
        }
        await appRuntime.internal.sourceInvalidation.refreshGeneratedPackages({
          scope: "workspace-link-repair",
          workspaceId: workspaceId as WorkspaceId,
          packages: ["@svvyx/extensions", "@svvyx/workflows"],
          reason: "startup-recovery",
        });
        workspaceAppLog.info(
          "workflow.library",
          "Workflows build/link recovery refreshed package links.",
          { reason: "startup-recovery" },
        );
        catalog.startWorkspaceRecovery();
        sourceInvalidationCoordinator = createRuntimeSourceInvalidationCoordinatorHandle({
          debounceMs: this.options.runtimeLayerConfig.sourceDebounceMs,
          host: this.sourceInvalidationHost,
          maxCoalescingLatencyMs: this.options.runtimeLayerConfig.sourceMaxCoalescingLatencyMs,
          readInputs: () =>
            buildWorkspaceSourceWatchInputs({
              cwd,
              externalInstructions:
                agentSettingsStore.getState().appPreferences.externalInstructions,
              host: this.sourceInvalidationHost,
            }),
          sourceScanRecorder: {
            scope: { kind: "workspace", workspaceId: workspaceId as WorkspaceId },
            statePort: catalog.getRuntimeSourceStatePort(),
          },
          onDomainsChanged: (event) =>
            Effect.promise(async () => {
              await this.handleSourceInvalidationEvent({
                scope: { kind: "workspace", workspaceId: workspaceId as WorkspaceId },
                event,
              });
              workspaceAppLog.info("source.graph", "Source inputs changed.", {
                domains: event.domains,
                reason: event.reason,
              });
            }),
          onWatchError: (error, path) => {
            this.options.forwardBridgeLog?.(
              "warn",
              "Workspace source watcher could not watch a path.",
              "source.graph",
              { path, workspaceId },
              error,
            );
          },
          reconciliationIntervalMs:
            this.options.runtimeLayerConfig.workspaceSourceReconcileIntervalMs,
          retryInitialDelayMs: this.options.runtimeLayerConfig.sourceRetryInitialDelayMs,
          retryMaxAttempts: this.options.runtimeLayerConfig.sourceRetryMaxAttempts,
          retryMaxDelayMs: this.options.runtimeLayerConfig.sourceRetryMaxDelayMs,
          watchEnabled: this.options.sourceWatchEnabled,
        });
        openingRuntime.sourceInvalidationCoordinator = sourceInvalidationCoordinator;
        await sourceInvalidationCoordinator.ready();
      } finally {
        this.openingRuntimes.delete(workspaceId);
        this.openingWorkspaceCwds.delete(workspaceId);
        if (requestedWorkspaceId !== workspaceId) {
          this.openingRuntimes.delete(requestedWorkspaceId);
          this.openingWorkspaceCwds.delete(requestedWorkspaceId);
        }
      }
      const recordWorkspaceClosed = (releaseReason: "tab-closed" | "shutdown"): void => {
        if (workspaceCloseRecorded) {
          return;
        }
        workspaceCloseRecorded = true;
        try {
          workspaceAppLog.info("app.lifecycle", "Workspace scope closed.", {
            workspaceId,
            kind,
            cwd,
            releaseReason,
          });
        } catch (error) {
          this.options.forwardBridgeLog?.(
            "warn",
            "Workspace close lifecycle log failed.",
            "runtime.lifecycle",
            { workspaceId },
            error,
          );
        }
      };
      const runtime: RuntimeRecord = {
        workspaceId,
        cwd,
        label,
        kind,
        openedAt: new Date().toISOString(),
        refCount: 1,
        commandStdin,
        catalog,
        pathIndex,
        agentSettingsStore,
        appLogs,
        appLog: workspaceAppLog,
        sourceInvalidationCoordinator,
        latestOwnerReleaseResult: null,
        getInfo: () => ({
          workspaceId,
          cwd,
          workspaceLabel: label,
          kind,
        }),
        reactivate: async () => {
          const bootstrapRuntime = appRuntime ?? (await this.getAppRuntimeBootstrap());
          if (desktopOwnerReleaseRequired) {
            await releaseDesktopOwner(bootstrapRuntime, "tab-closed");
          }
          desktopOwnerReleaseRequired = true;
          if (kind === "default") {
            await bootstrapRuntime.facade.workspaces.acquireDefault({
              owner: workspaceOwnerRef(workspaceId),
              openReason: "new-tab",
            });
          } else {
            await bootstrapRuntime.facade.workspaces.acquire({
              cwd: cwd as AbsolutePath,
              owner: workspaceOwnerRef(workspaceId),
              openReason: "user-open",
            });
          }
          runtime.latestOwnerReleaseResult = null;
          workspaceAppLog.info("app.lifecycle", "Workspace scope opened.", {
            workspaceId,
            kind,
            cwd,
          });
          workspaceCloseRecorded = false;
        },
        dispose: async () => {
          recordWorkspaceClosed("tab-closed");
          const result = await releaseDesktopOwner(undefined, "tab-closed");
          if (result) {
            runtime.latestOwnerReleaseResult = result;
          }
        },
        releaseVisualOwner: async () => {
          recordWorkspaceClosed("tab-closed");
          const result = await releaseDesktopOwner(undefined, "tab-closed");
          if (result) {
            runtime.latestOwnerReleaseResult = result;
          }
          return result;
        },
        shutdown: async (suppliedRuntime) => {
          recordWorkspaceClosed("shutdown");
          await cleanupWorkspaceResources(suppliedRuntime, "shutdown");
        },
      };
      return runtime;
    } catch (error) {
      try {
        await cleanupWorkspaceResources(appRuntime, "shutdown");
      } catch (cleanupError) {
        return Promise.reject(
          new AggregateError(
            [error, cleanupError],
            "Workspace runtime startup failed and partial resources could not be closed.",
            { cause: error },
          ),
        );
      }
      throw error;
    }
  }

  private getAppRuntimeFacadeOperations(): WorkspaceRuntimeOperations {
    if (this.appRuntimeBootstrapState !== "accepting") {
      throw appRuntimeBootstrapUnavailableError(
        "workspace-runtime-registry.getRuntimeOperations",
        this.appRuntimeBootstrapState,
      );
    }
    if (!this.resolvedAppRuntimeBootstrap) {
      throw new RuntimeContractError({
        operation: "workspace-runtime-registry.getRuntimeOperations",
        reason: "startup-pending",
        message: "The app runtime has not been bootstrapped yet.",
      });
    }
    return this.resolvedAppRuntimeBootstrap.facade;
  }

  private getRuntimeByCwd(cwd: string): RuntimeRecord | null {
    const canonicalCwd = canonicalizeWorkspaceCwd(cwd);
    return (
      Array.from(this.runtimes.values()).find((runtime) => runtime.cwd === canonicalCwd) ?? null
    );
  }

  private getDormantRuntimeByCwd(cwd: string): RuntimeRecord | null {
    const canonicalCwd = canonicalizeWorkspaceCwd(cwd);
    return (
      Array.from(this.dormantRuntimes.values()).find((runtime) => runtime.cwd === canonicalCwd) ??
      null
    );
  }

  private async awaitWorkspaceTransitions(cwd: string): Promise<void> {
    const canonicalCwd = canonicalizeWorkspaceCwd(cwd);
    while (true) {
      const transition = this.closingRuntimes.get(canonicalCwd);
      if (!transition) {
        return;
      }
      try {
        await transition;
      } catch {
        // A failed close stays represented by its dormant runtime and is retried below.
      }
    }
  }

  private runWorkspaceTransition<A>(cwd: string, operation: () => Promise<A>): Promise<A> {
    return this.beginWorkspaceTransition(cwd, operation);
  }

  private runWorkspaceTransitionWithCancelableWait<A>(input: {
    cwd: string;
    operation: () => Promise<A>;
    signal?: AbortSignal;
    abortedFacadeCall: () => Promise<A>;
  }): Promise<A> {
    if (input.signal?.aborted) {
      return input.abortedFacadeCall();
    }
    const authoritativeResult = this.beginWorkspaceTransition(input.cwd, input.operation);
    const signal = input.signal;
    if (!signal) {
      return authoritativeResult;
    }
    return new Promise<A>((resolve, reject) => {
      let settled = false;
      const settle = (complete: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        complete();
      };
      const onAbort = () => {
        settle(() => {
          try {
            void input
              .abortedFacadeCall()
              .then(
                () => reject(new Error("An aborted runtime facade call unexpectedly completed.")),
                reject,
              );
          } catch (error) {
            reject(error);
          }
        });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
      authoritativeResult.then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  }

  private beginWorkspaceTransition<A>(cwd: string, operation: () => Promise<A>): Promise<A> {
    const canonicalCwd = canonicalizeWorkspaceCwd(cwd);
    const previous = this.closingRuntimes.get(canonicalCwd);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(operation);
    const completion = result.then(() => undefined);
    this.closingRuntimes.set(canonicalCwd, completion);
    void completion.then(
      () => {
        if (this.closingRuntimes.get(canonicalCwd) === completion) {
          this.closingRuntimes.delete(canonicalCwd);
        }
      },
      () => {
        if (this.closingRuntimes.get(canonicalCwd) === completion) {
          this.closingRuntimes.delete(canonicalCwd);
        }
      },
    );
    return result;
  }

  private assertAcceptingWorkspaceFacadeCall(operation: string): void {
    if (this.appRuntimeBootstrapState !== "accepting") {
      throw appRuntimeBootstrapUnavailableError(operation, this.appRuntimeBootstrapState);
    }
  }

  private trackExternalWorkspaceOwner(workspaceId: WorkspaceId, owner: RuntimeOwnerRef): void {
    const key = workspaceRuntimeOwnerKey(owner);
    if (key === workspaceRuntimeOwnerKey(workspaceOwnerRef(workspaceId))) {
      return;
    }
    const owners = this.externalWorkspaceOwners.get(workspaceId) ?? new Map();
    owners.set(key, owner);
    this.externalWorkspaceOwners.set(workspaceId, owners);
  }

  private untrackExternalWorkspaceOwner(workspaceId: WorkspaceId, owner: RuntimeOwnerRef): void {
    const owners = this.externalWorkspaceOwners.get(workspaceId);
    if (!owners) {
      return;
    }
    owners.delete(workspaceRuntimeOwnerKey(owner));
    if (owners.size === 0) {
      this.externalWorkspaceOwners.delete(workspaceId);
    }
  }

  private async closeUnownedDormantRuntime(
    result: ReleaseWorkspaceResult,
    appRuntime?: AppRuntimeBootstrap,
  ): Promise<void> {
    if (result.remainingOwners > 0 || result.lifecycle === "active") {
      return;
    }
    const runtime = this.dormantRuntimes.get(result.workspaceId);
    if (!runtime) {
      return;
    }
    runtime.latestOwnerReleaseResult = result;
    if ((this.externalWorkspaceOwners.get(result.workspaceId)?.size ?? 0) > 0) {
      return;
    }
    await runtime.shutdown(appRuntime);
    if (this.dormantRuntimes.get(result.workspaceId) === runtime) {
      this.dormantRuntimes.delete(result.workspaceId);
    }
    this.externalWorkspaceOwners.delete(result.workspaceId);
  }

  private async releaseExternalWorkspaceOwnersForShutdown(
    runtime: RuntimeRecord,
    appRuntime: AppRuntimeBootstrap,
  ): Promise<void> {
    const owners = this.externalWorkspaceOwners.get(runtime.workspaceId);
    if (!owners || owners.size === 0) {
      return;
    }
    const errors: unknown[] = [];
    for (const owner of owners.values()) {
      try {
        await appRuntime.facade.workspaces.release({
          workspaceId: runtime.workspaceId as WorkspaceId,
          owner,
          releaseReason: "shutdown",
        });
        this.untrackExternalWorkspaceOwner(runtime.workspaceId as WorkspaceId, owner);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `External workspace owners did not release cleanly for ${runtime.workspaceId}.`,
      );
    }
  }

  private getWorkspaceHostRecord(workspaceId: string): RuntimeRecord | OpeningRuntimeRecord | null {
    return (
      this.runtimes.get(workspaceId) ??
      this.dormantRuntimes.get(workspaceId) ??
      this.openingRuntimes.get(workspaceId) ??
      null
    );
  }

  private getRetainedWorkspaceHostRecord(workspaceId: string): RuntimeRecord | null {
    return this.runtimes.get(workspaceId) ?? this.dormantRuntimes.get(workspaceId) ?? null;
  }

  private workspaceHostRecords(): Array<RuntimeRecord | OpeningRuntimeRecord> {
    return Array.from(
      new Set<RuntimeRecord | OpeningRuntimeRecord>([
        ...this.runtimes.values(),
        ...this.dormantRuntimes.values(),
        ...this.openingRuntimes.values(),
      ]),
    );
  }

  private retainedWorkspaceHostRecords(): RuntimeRecord[] {
    return Array.from(
      new Set<RuntimeRecord>([...this.runtimes.values(), ...this.dormantRuntimes.values()]),
    );
  }

  async getAppRuntimeOperations(workspaceId: string): Promise<WorkspaceRuntimeOperations> {
    if (this.appRuntimeBootstrapState !== "accepting") {
      throw appRuntimeBootstrapUnavailableError(
        "workspace-runtime-registry.getAppRuntimeBootstrap",
        this.appRuntimeBootstrapState,
      );
    }
    this.getRuntime(workspaceId);
    return (await this.getAppRuntimeBootstrap()).facade;
  }

  async getRendererStateFacade(): Promise<AppRuntimeBootstrap["rendererState"]> {
    return (await this.getAppRuntimeBootstrap()).rendererState;
  }

  async getStateCommandsFacade(): Promise<AppRuntimeBootstrap["stateCommands"]> {
    return (await this.getAppRuntimeBootstrap()).stateCommands;
  }

  async hydrateStateOwnedAppPreferencesFromStateRows(): Promise<AppPreferences> {
    const appGlobal = await this.getAppGlobalHostRecord();
    const record = appGlobal.catalog.workspaceStateRouterRegistration().store.readAppPreferences();
    const preferences = appPreferencesFromStructuredRecord(
      record,
      appGlobal.agentSettingsStore.getState().appPreferences,
    );
    this.stateOwnedAppPreferences = preferences;
    const hosts = [appGlobal, ...this.workspaceHostRecords()];
    for (const host of new Set(hosts)) {
      host.agentSettingsStore.hydrateStateOwnedAppPreferences(preferences);
      host.catalog.updateAppPreferences(preferences);
      host.catalog
        .workspaceStateRouterRegistration()
        .store.setWorkspaceArtifactDirectory(
          resolveConfiguredArtifactDirectory(preferences.artifactDirectory, host.cwd),
        );
    }
    return preferences;
  }

  private async getAppRuntimeBootstrap(): Promise<AppRuntimeBootstrap> {
    if (this.appRuntimeBootstrapState !== "accepting") {
      throw appRuntimeBootstrapUnavailableError(
        "workspace-runtime-registry.getAppRuntimeBootstrap",
        this.appRuntimeBootstrapState,
      );
    }
    if (!this.appRuntimeBootstrap) {
      this.appRuntimeBootstrap = this.createAppRuntimeBootstrap();
    }
    const runtime = await this.appRuntimeBootstrap;
    this.resolvedAppRuntimeBootstrap = runtime;
    await this.hydrateStateOwnedAppPreferencesFromStateRows();
    const appGlobal = await this.getAppGlobalHostRecord();
    const catalogs = new Set<WorkspaceSessionCatalog>([
      appGlobal.catalog,
      ...this.retainedWorkspaceHostRecords().map((host) => host.catalog),
    ]);
    const agentProfileAuthority = this.createCatalogAgentProfileAuthority(runtime);
    const requestInputSettingsAuthority = this.createCatalogRequestInputSettingsAuthority(
      appGlobal.catalog,
    );
    for (const catalog of catalogs) {
      catalog.setAgentProfileAuthority(agentProfileAuthority);
      catalog.setRequestInputSettingsAuthority(requestInputSettingsAuthority);
    }
    await Promise.all(
      [...catalogs].map((catalog) =>
        catalog.setCommittedStateInvalidationPublisher((afterCommit) =>
          runtime.internal.committedStateInvalidations.publish(afterCommit),
        ),
      ),
    );
    for (const catalog of this.retainedWorkspaceHostRecords().map((host) => host.catalog)) {
      await catalog.prepareWorkspaceRecoveryAfterRegistration();
      catalog.startWorkspaceRecovery();
    }
    return runtime;
  }

  private createCatalogAgentProfileAuthority(
    runtime: AppRuntimeBootstrap,
  ): CatalogAgentProfileAuthority {
    if (this.catalogAgentProfileAuthority?.runtime === runtime) {
      return this.catalogAgentProfileAuthority.authority;
    }
    const authority: CatalogAgentProfileAuthority = {
      read: async () => {
        const result = await runtime.state.readModels.fetch({ kind: "agents" });
        if (result.kind !== "agents") {
          throw new Error(`Expected agents read model; received ${result.kind}.`);
        }
        return {
          configuredProfiles: result.value.configuredProfiles,
          workflowAgents: result.value.workflowAgents,
          actorExtensionDefaults: result.value.actorExtensionDefaults,
        };
      },
      updateOrchestrator: async (profile) => {
        await runtime.stateCommands.agentProfiles.updateOrchestrator({ profile });
      },
      updateThreadHandler: async (profile) => {
        await runtime.stateCommands.agentProfiles.updateThreadHandler({ profile });
      },
      setProfileExtensionUsage: async (input) => {
        await runtime.stateCommands.agentProfiles.setProfileExtensionUsage(input);
      },
      setActorExtensionDefaults: async (input) => {
        await runtime.stateCommands.agentProfiles.setActorExtensionDefaults({
          actor: input.actor,
          extensionUsage: Object.fromEntries(
            Object.entries(input.extensionUsage).map(([extensionId, usage]) => [
              extensionId as ExtensionId,
              usage,
            ]),
          ),
          extensionOrder: input.extensionOrder.map((extensionId) => extensionId as ExtensionId),
        });
      },
      saveWorkflowAgentSource: async (input) => {
        const appGlobal = await this.getAppGlobalHostRecord();
        const result = await runtime.facade.sourceEdits.save({
          workspaceId: appGlobal.workspaceId as WorkspaceId,
          source: {
            sourceKind: "workflow-agent",
            sourceId: input.sourceId,
            expectedSourceVersion: input.expectedSourceVersion,
            text: input.text,
            saveMode: "compare-and-swap",
          },
        });
        if (result.status === "stale") {
          throw new RuntimeContractError({
            operation: "runtime.sourceEdits.saveWorkflowAgentExtensionUsage",
            reason: "state-conflict",
            message: `Workflow-agent source ${input.sourceId} changed before the extension usage update committed.`,
          });
        }
      },
      upsertWorkflowAgentSource: async (input) => {
        const appGlobal = await this.getAppGlobalHostRecord();
        const workspaceId = appGlobal.workspaceId as WorkspaceId;
        let current: SourceEditSession | null = null;
        try {
          current = await runtime.facade.sourceEdits.open({
            sourceKind: "workflow-agent",
            sourceId: input.sourceId,
          });
        } catch (error) {
          const runtimeError =
            error &&
            typeof error === "object" &&
            (error as Record<string, unknown>).type === "runtime-facade-error"
              ? (error as Record<string, unknown>).error
              : error;
          if (
            !(runtimeError instanceof RuntimeContractError) ||
            runtimeError.reason !== "target-not-found"
          ) {
            throw error;
          }
        }

        if (!current) {
          await runtime.facade.sourceEdits.createWorkflowAgent({
            workspaceId,
            source: {
              draft: {
                exportName: input.sourceId as WorkflowAgentSourceExportName,
                displayName: input.draft.label,
                provider: input.draft.provider,
                model: input.draft.model,
                reasoning: { effort: input.draft.reasoningEffort },
                instructionText: input.draft.instructions,
                extensionUsageOverrides: Object.entries(input.draft.overrides).map(
                  ([extensionId, usage]) => ({
                    extensionId: extensionId as ExtensionId,
                    usage,
                  }),
                ),
                extensionOrder: input.draft.extensionOrder.map(
                  (extensionId) => extensionId as ExtensionId,
                ),
              },
              sourceOwner: "svvyx-workflows-command",
              ...(input.sourceCommandId
                ? { sourceCommandId: input.sourceCommandId as CommandId }
                : {}),
            },
          });
          return;
        }

        if (!input.overwrite) {
          throw new RuntimeContractError({
            operation: "runtime.sourceEdits.upsertWorkflowAgent",
            reason: "invalid-input",
            message: `Workflow source already exists: ${input.sourceId}`,
          });
        }
        const result = await runtime.facade.sourceEdits.save({
          workspaceId,
          source: {
            sourceKind: "workflow-agent",
            sourceId: input.sourceId,
            expectedSourceVersion: current.sourceVersion,
            text: input.text,
            saveMode: "compare-and-swap",
            ...(input.sourceCommandId
              ? { sourceCommandId: input.sourceCommandId as CommandId }
              : {}),
          },
        });
        if (result.status === "stale") {
          throw new RuntimeContractError({
            operation: "runtime.sourceEdits.upsertWorkflowAgent",
            reason: "state-conflict",
            message: `Workflow-agent source ${input.sourceId} changed before the save committed.`,
          });
        }
      },
    };
    this.catalogAgentProfileAuthority = { runtime, authority };
    return authority;
  }

  private createCatalogRequestInputSettingsAuthority(
    appGlobalCatalog: WorkspaceSessionCatalog,
  ): CatalogRequestInputSettingsAuthority {
    return {
      read: () =>
        appGlobalCatalog.workspaceStateRouterRegistration().store.readRequestInputSettings(),
    };
  }

  private async getAppGlobalHostRecord(): Promise<AppGlobalHostRecord> {
    if (!this.appGlobalHost) {
      this.appGlobalHost = this.createAppGlobalHost();
    }
    return await this.appGlobalHost;
  }

  private async createAppGlobalHost(): Promise<AppGlobalHostRecord> {
    const cwd = canonicalizeWorkspaceCwd(getDefaultWorkspaceCwd(this.appDataDir));
    const workspaceId = normalizeWorkspaceRuntimeId(cwd);
    const sessionDir = getSvvySessionDir(cwd, this.agentDir);
    const commandStdin = createLiveCommandStdinRegistry();
    const catalog = createRuntimeBackedWorkspaceSessionCatalog(
      cwd,
      this.agentDir,
      sessionDir,
      join(sessionDir, "namer"),
      workspaceId,
      {
        runtimeStartupOwnsRecovery: true,
        workflowsExtensionsGeneratedPackagePath:
          this.options.workflowsExtensionsGeneratedPackagePath,
        workflowsGeneratedPackagePath: this.options.workflowsGeneratedPackagePath,
        workflowsSourceRoot: this.options.workflowsSourceRoot,
        refreshGeneratedPackages: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.sourceInvalidation.refreshGeneratedPackages(request);
        },
        wakeSurfaceQueue: async (target) => {
          const runtime = await this.getAppRuntimeBootstrap();
          await runtime.internal.workspaceRecovery.wakeSurfaceQueue(target as RuntimePromptTarget);
        },
        acquireExecuteTypescriptLaunch: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.launchFacts.acquireExecuteTypescript(request);
        },
        acquireDirectToolLaunch: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.launchFacts.acquireDirectToolLaunch(request);
        },
        runAcceptedLoadExtension: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.acceptedNativeTools.runLoadExtension(request);
        },
        applyExtensionManagementRuntimeRequest: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return applyExtensionManagementRuntimeRequest(
            runtime,
            request,
            workspaceId as WorkspaceId,
          );
        },
        applyWorkflowsRuntimeRequest: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return applyWorkflowsRuntimeRequest(runtime, request);
        },
        requestDirectToolApproval: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.acceptedNativeTools.requestDirectToolApproval(request);
        },
        runTaskAgent: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.workflowTaskAgentBridge.runTaskAgent(request);
        },
      },
      undefined,
      undefined,
      commandStdin,
      this.options.runtimeLayerConfig,
    );
    const agentSettingsStore = createAgentSettingsStore({
      agentDir: this.agentDir,
    });
    const appLogs = this.acquireAppGlobalAppLogFacade();
    const appLog = createAppLogger({
      appLogs,
      forwardBridgeLog: (level, message, source, details, error) => {
        this.options.forwardBridgeLog?.(level, message, source, details, error);
      },
    });

    catalog.setTitleGenerationLogListener((event) => {
      recordTitleGenerationLog(appLog, event);
    });
    catalog.setWorkflowsGeneratedPackageLogListener((event) => {
      for (const runtime of this.workspaceHostRecords()) {
        recordWorkflowsGeneratedPackageLog(runtime.appLog, event);
      }
    });
    catalog.setAppLogListener((event) => {
      appendAppLoggerEvent(appLog, event);
    });

    return {
      workspaceId,
      cwd,
      catalog,
      agentSettingsStore,
      commandStdin,
      appLogs,
      sourceStatePort: catalog.getRuntimeSourceStatePort(),
      dispose: async () => {
        await catalog.setCommittedStateInvalidationPublisher(null);
        catalog.setTitleGenerationLogListener(null);
        catalog.setWorkflowsGeneratedPackageLogListener(null);
        catalog.setAppLogListener(null);
        await catalog.dispose();
        this.releaseAppGlobalAppLogFacade();
      },
    };
  }

  private async createAppRuntimeBootstrap(): Promise<AppRuntimeBootstrap> {
    const appGlobal = await this.getAppGlobalHostRecord();
    const generatedPackageBoundaryHost = this.createGeneratedPackageRefreshBoundaryHost(
      appGlobal.catalog,
      {
        workspaceId: appGlobal.workspaceId,
        cwd: appGlobal.cwd,
      },
    );
    const packagedExtensionTemplatesRoot = resolvePackagedExtensionTemplatesRoot({
      explicitRoot: this.options.packagedExtensionTemplatesRoot,
    });
    const sandboxPolicySource = this.createSandboxPolicySource();
    const generatedPackageStatePort = this.createGeneratedPackageStatePort(appGlobal.catalog);
    const commandRegistry = this.createAppCommandRegistry(appGlobal.commandStdin);
    const bootstrap = await createAppRuntimeBootstrap({
      appGlobalState: appGlobal.catalog.workspaceStateRouterRegistration(),
      workspaceStates: this.retainedWorkspaceHostRecords().map((runtime) =>
        runtime.kind === "default"
          ? { ...runtime.catalog.workspaceStateRouterRegistration(), isDefaultWorkspace: true }
          : runtime.catalog.workspaceStateRouterRegistration(),
      ),
      sourceRoots: generatedPackageBoundaryHost.sourceRoots,
      packagedExtensionTemplatesRoot,
      generatedPackageRoots: generatedPackageBoundaryHost.generatedPackageRoots,
      extensionStatePort: generatedPackageBoundaryHost.extensionStatePort,
      extensionBuildProcess: this.options.extensionBuildProcess,
      extensionCliRequirementProbe: this.options.extensionCliRequirementProbe,
      secretStore: this.options.secretStore,
      secretStoreMutation: this.options.secretStoreMutation,
      snapshotStorageRoot: join(this.appDataDir, "extension-snapshots") as AbsolutePath,
      generatedPackageLinkPath: generatedPackageBoundaryHost.generatedPackageLinkPath,
      sandboxPolicySource,
      appLogs: appGlobal.appLogs,
      resolveWorkspaceAppLogs: async (workspaceId) => {
        const runtime =
          this.getWorkspaceHostRecord(workspaceId) ??
          (appGlobal.workspaceId === workspaceId ? appGlobal : undefined);
        if (!runtime) {
          throw new RuntimeContractError({
            operation: "workspace-runtime-registry.resolveWorkspaceAppLogs",
            reason: "target-not-found",
            message: `Workspace runtime registry could not resolve app logs for ${workspaceId}.`,
          });
        }
        return runtime.appLogs;
      },
      onAppLogCommitNotificationError: (error, scope) => {
        this.options.forwardBridgeLog?.(
          "error",
          "Committed app-log invalidation publication failed.",
          "runtime.events",
          scope,
          error,
        );
      },
      appLogWritePort: appGlobal.appLogs.writePort,
      sandboxHostSupport: this.options.sandboxHostSupport,
      runtimeLayerConfig: this.options.runtimeLayerConfig,
      commandRegistry,
      executeTypescriptHost: {
        runExecuteTypescript: (request) =>
          Effect.tryPromise({
            try: async (signal) => {
              const runtime =
                this.getWorkspaceHostRecord(request.workspaceId) ??
                (appGlobal.workspaceId === request.workspaceId ? appGlobal : undefined);
              if (!runtime) {
                throw new RuntimeContractError({
                  operation: "workspace-runtime-registry.executeTypescript",
                  reason: "target-not-found",
                  message: `Execute TypeScript requires an open workspace runtime for ${request.workspaceId}.`,
                });
              }
              return runtime.catalog.runAcceptedExecuteTypescript(request, signal);
            },
            catch: (cause) =>
              cause instanceof RuntimeContractError
                ? cause
                : new RuntimeContractError({
                    operation: "workspace-runtime-registry.executeTypescript",
                    reason: "state-conflict",
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Execute TypeScript host execution failed.",
                    cause,
                  }),
          }),
      },
      providerAuth: this.runtimeDependencies(),
      piRuntimePaths: {
        resolve: async (workspaceId) => this.resolvePiRuntimePaths(workspaceId),
      },
      generatedContextRefresh: {
        refresh: (input) => this.refreshGeneratedContext(input),
      },
      generatedPackageRefresh: {
        listAcquiredWorkspaceIds: generatedPackageBoundaryHost.listAcquiredWorkspaceIds,
        listRecoverableWorkspaceIds: generatedPackageBoundaryHost.listRecoverableWorkspaceIds,
        now: generatedPackageBoundaryHost.now,
        workspaceLinkFileHost: generatedPackageBoundaryHost.workspaceLinkFileHost,
        materializeCoreTypeContractPackage:
          generatedPackageBoundaryHost.materializeCoreTypeContractPackage,
      },
      externalInstructionScanInput: {
        resolve: (workspaceId) =>
          Effect.try({
            try: () => {
              const workspace = this.getWorkspaceHostRecord(workspaceId);
              if (!workspace) {
                throw new Error(`Workspace is not open: ${workspaceId}`);
              }
              const canonicalCwd = canonicalizeWorkspaceCwd(workspace.cwd) as AbsolutePath;
              const settings = appGlobal.catalog
                .workspaceStateRouterRegistration()
                .store.readAppPreferences().externalInstructions;
              return {
                workspaceId,
                workspaceRoot: canonicalCwd,
                cwd: canonicalCwd,
                homeDirectory: this.sourceInvalidationHost.homeDir as AbsolutePath,
                settings: {
                  globalRoots: settings.globalRoots.map((root) => ({ ...root })),
                  globalControls: {},
                  workspaceControls: {},
                },
              } satisfies ExternalInstructionScanInput;
            },
            catch: (cause) =>
              new RuntimeContractError({
                operation: "workspace-runtime-registry.externalInstructions.scanInput",
                reason: "target-not-found",
                message:
                  cause instanceof Error
                    ? cause.message
                    : `External instruction scan input could not resolve workspace ${workspaceId}.`,
                cause,
              }),
          }),
      },
      generatedPackageStatePort,
      sourceInvalidation: {
        appGlobalCoordinator: this.appGlobalSourceInvalidationCoordinator,
        listAcquiredWorkspaceIds: () =>
          this.workspaceHostRecords().map((runtime) => runtime.workspaceId as WorkspaceId),
        resolveWorkspaceCoordinator: async (workspaceId) => {
          const runtime = this.getWorkspaceHostRecord(workspaceId);
          if (!runtime?.sourceInvalidationCoordinator) {
            throw new RuntimeContractError({
              operation: "runtime.sourceInvalidation.resolveWorkspaceCoordinator",
              reason: "target-not-found",
              message: `Workspace source invalidation requires an open workspace host record for ${workspaceId}.`,
            });
          }
          return runtime.sourceInvalidationCoordinator;
        },
      },
      workflowTaskAgentBridge: {
        verifyBearerLineage: async (request) => {
          const appGlobalRecord = await this.getAppGlobalHostRecord();
          const catalogs = [
            appGlobalRecord.catalog,
            ...this.workspaceHostRecords().map((runtime) => runtime.catalog),
          ];
          return catalogs.some((catalog) => catalog.verifyRunTaskAgentBridgeBearerLineage(request));
        },
      },
      appPreferencesSeed: {
        hasStateRows: () =>
          appGlobal.catalog.workspaceStateRouterRegistration().store.hasAppPreferencesRow(),
        read: () => appGlobal.agentSettingsStore.getState().appPreferences,
      },
    });
    return bootstrap;
  }

  private async resolvePiRuntimePaths(workspaceId: WorkspaceId) {
    const appGlobal = await this.getAppGlobalHostRecord();
    const runtime =
      this.getWorkspaceHostRecord(workspaceId) ??
      (appGlobal.workspaceId === workspaceId ? appGlobal : null);
    if (!runtime) {
      throw new RuntimeContractError({
        operation: "runtime.pi.paths.resolve",
        reason: "target-not-found",
        message: `Pi runtime paths require an open workspace host record for ${workspaceId}.`,
      });
    }
    const sessionDir = getSvvySessionDir(runtime.cwd, this.agentDir);
    return {
      workspaceId,
      cwd: runtime.cwd as AbsolutePath,
      agentDir: this.agentDir as AbsolutePath,
      sessionDir: sessionDir as AbsolutePath,
      modelRegistryPath: join(this.agentDir, "model-registry.json") as AbsolutePath,
      source: "packaged-app" as const,
    };
  }

  private createSandboxPolicySource(): import("@svvy/core").SandboxPolicySourceService {
    return {
      snapshot: (input) =>
        Effect.suspend(() => {
          const runtime = this.findRuntimeByCwd(input.cwd);
          if (runtime) return runtime.catalog.getSandboxPolicySource().snapshot(input);
          return Effect.fail(
            new SandboxPolicyError({
              operation: "workspace-runtime-registry.sandboxPolicySource.snapshot",
              reason: "invalid-policy",
              message: `No open workspace owns sandbox policy cwd ${input.cwd}.`,
            }),
          );
        }),
    };
  }

  private createAppCommandRegistry(
    appGlobalCommandStdin: ReturnType<typeof createLiveCommandStdinRegistry>,
  ): RuntimeLayerCommandStdinPortService & Pick<RuntimeLayerCommandControlPortService, "cancel"> {
    const registries = () => [
      ...this.workspaceHostRecords().map((runtime) => runtime.commandStdin),
      appGlobalCommandStdin,
    ];
    return {
      writeStdin: (input) =>
        Effect.gen(function* () {
          for (const registry of registries()) {
            const result = yield* registry.writeStdin(input);
            if (result.status !== "not_running") return result;
          }
          return { commandId: input.commandId, status: "not_running" as const };
        }),
      cancel: (input) =>
        Effect.gen(function* () {
          let lastError: RuntimeContractError | null = null;
          for (const registry of registries()) {
            const cancelResult = yield* registry.cancel(input).pipe(
              Effect.matchEffect({
                onFailure: (error) => {
                  lastError = error;
                  return Effect.succeed(null);
                },
                onSuccess: (success) => Effect.succeed(success),
              }),
            );
            if (cancelResult) return cancelResult;
          }
          return yield* Effect.fail(
            lastError ??
              new RuntimeContractError({
                operation: "runtime.commands.cancel",
                reason: "target-not-found",
                message: `No live command session is registered for command ${input.commandId}.`,
              }),
          );
        }),
    };
  }

  private findRuntimeByCwd(cwd: string): RuntimeRecord | OpeningRuntimeRecord | null {
    const canonical = canonicalizeWorkspaceCwd(cwd);
    return this.workspaceHostRecords().find((runtime) => runtime.cwd === canonical) ?? null;
  }

  private async handleSourceInvalidationEvent(
    input: RuntimeSourceInvalidationReactionInput,
  ): Promise<void> {
    const { event } = input;
    try {
      if (input.scope.kind === "workspace") {
        if (!this.getWorkspaceHostRecord(input.scope.workspaceId)) {
          throw new Error(`Workspace is not open: ${input.scope.workspaceId}`);
        }
      }
      const { facade } = await this.getAppRuntimeBootstrap();
      const result = await facade.sourceInvalidation.applyCommittedScanEvent(input);

      for (const refresh of result.generatedPackageRefreshes) {
        for (const status of refresh.packages) {
          for (const runtime of this.workspaceHostRecords()) {
            if (status.action === "written" || status.action === "unchanged") {
              runtime.appLog.info(
                "workflow.library",
                "Source invalidation refreshed generated package.",
                {
                  domains: event.domains,
                  packageName: status.packageName,
                  reason: event.reason,
                },
              );
            } else if (status.action === "failed") {
              runtime.appLog.warning(
                "workflow.library",
                "Source invalidation left generated package stale because refresh failed.",
                {
                  diagnostics: status.diagnostics ?? [],
                  domains: event.domains,
                  packageName: status.packageName,
                  reason: event.reason,
                },
              );
            }
          }
        }
      }
    } catch (error) {
      this.options.forwardBridgeLog?.(
        "warn",
        "Runtime source invalidation reaction failed.",
        "source.graph",
        { domains: event.domains, reason: event.reason, scope: input.scope.kind },
        error,
      );
      throw error;
    }
  }

  private async refreshGeneratedContext(input: RefreshGeneratedContextRequest): Promise<void> {
    if (input.scope === "workspace") {
      const runtime = this.getWorkspaceHostRecord(input.workspaceId);
      if (!runtime) {
        throw new Error(`Workspace is not open: ${input.workspaceId}`);
      }
      await runtime.catalog.notifySourceInputsChanged(`runtime_refresh:${input.reason}`);
      return;
    }

    await Promise.all(
      this.workspaceHostRecords().map((runtime) =>
        runtime.catalog.notifySourceInputsChanged(`runtime_refresh:${input.reason}`),
      ),
    );
  }

  private createGeneratedPackageRefreshBoundaryHost(
    catalog: WorkspaceSessionCatalog,
    startupWorkspace: { workspaceId: string; cwd: string },
  ): WorkspaceGeneratedPackageBoundaryHost {
    const extensionsRoot = extensionsRootForAgentDir(this.agentDir);
    return {
      sourceRoots: {
        extensionsRoot: extensionsRoot as AbsolutePath,
        workflowsSourceRoot: (this.options.workflowsSourceRoot ??
          workflowsSourceRoot()) as AbsolutePath,
      },
      generatedPackageRoots: {
        extensionsPackageRoot: extensionsGeneratedPackagePath({
          extensionsGeneratedPackagePath: this.options.workflowsExtensionsGeneratedPackagePath,
          generatedPackagePath: this.options.workflowsGeneratedPackagePath,
        }) as AbsolutePath,
        workflowsPackageRoot: (this.options.workflowsGeneratedPackagePath ??
          workflowsGeneratedPackagePath()) as AbsolutePath,
        coreTypeContractPackageRoot: (this.options.coreTypeContractPackagePath ??
          getCoreTypeContractPackagePath()) as AbsolutePath,
      },
      extensionStatePort: catalog.getExtensionStatePort(),
      listAcquiredWorkspaceIds: () =>
        Effect.succeed(
          this.workspaceHostRecords().map((runtime) => runtime.workspaceId as WorkspaceId),
        ),
      listRecoverableWorkspaceIds: () =>
        Effect.sync(() =>
          this.listRecoverableWorkspacesFromState(catalog).map(
            (workspace) => workspace.workspaceId as WorkspaceId,
          ),
        ),
      now: () => Effect.succeed(new Date().toISOString() as IsoDateTimeString),
      generatedPackageLinkPath: async ({ packageName, workspaceId }) => {
        const runtimeCwd =
          workspaceId === startupWorkspace.workspaceId
            ? startupWorkspace.cwd
            : (this.getWorkspaceHostRecord(workspaceId)?.cwd ??
              this.openingWorkspaceCwds.get(workspaceId));
        if (!runtimeCwd) {
          throw new RuntimeContractError({
            operation: "runtime.generated-packages.workspace-link-path",
            reason: "target-not-found",
            message: `Generated package workspace link target is not open: ${workspaceId}.`,
          });
        }
        const packageBasename = packageName === "@svvyx/workflows" ? "workflows" : "extensions";
        return join(
          runtimeCwd,
          ".smithers",
          "node_modules",
          "@svvyx",
          packageBasename,
        ) as AbsolutePath;
      },
      workspaceLinkFileHost: nodeGeneratedPackageWorkspaceLinkFileHost,
      materializeCoreTypeContractPackage: () =>
        Effect.try({
          try: () =>
            materializeGeneratedCoreTypeContractPackage(
              this.options.coreTypeContractPackagePath ?? getCoreTypeContractPackagePath(),
            ),
          catch: (cause: unknown) =>
            runtimeRegistrySourceInvalidationError(
              "runtime.sourceInvalidation.materializeCoreTypeContractPackage",
              cause,
            ),
        }),
    };
  }

  private createGeneratedPackageStatePort(
    catalog: WorkspaceSessionCatalog,
  ): Pick<
    RuntimeGeneratedPackageStatePortService,
    "markWorkspaceLinksRepairNeeded" | "recordWorkspaceLinkStatus"
  > {
    return {
      recordWorkspaceLinkStatus: (input) =>
        Effect.flatMap(
          Effect.sync(() => this.findRecoverableWorkspace(catalog, input.status.workspaceId)),
          (recoverableWorkspace) => {
            if (!recoverableWorkspace) {
              return Effect.fail(
                new StateContractError({
                  operation: "runtime.generatedPackages.recordWorkspaceLinkStatus",
                  reason: "not-found",
                  message: `Workspace generated-package link status target is not recoverable: ${input.status.workspaceId}.`,
                }),
              );
            }

            return Effect.flatMap(
              Effect.try({
                try: () => this.persistedWorkspaceStateStoreOptions(recoverableWorkspace),
                catch: (cause: unknown) =>
                  new StateContractError({
                    operation: "runtime.generatedPackages.openRecoverableWorkspaceState",
                    reason: "transaction-failed",
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Unable to open recoverable workspace state.",
                    cause,
                  }),
              }),
              (store) =>
                recordPersistedWorkspaceGeneratedPackageLinkStatus({
                  store,
                  request: input,
                }),
            );
          },
        ),
      markWorkspaceLinksRepairNeeded: (input) =>
        Effect.flatMap(
          Effect.sync(() => this.findRecoverableWorkspace(catalog, input.workspaceId)),
          (recoverableWorkspace) => {
            if (!recoverableWorkspace) {
              return Effect.fail(
                new StateContractError({
                  operation: "runtime.generatedPackages.markWorkspaceLinksRepairNeeded",
                  reason: "not-found",
                  message: `Workspace generated-package link repair target is not recoverable: ${input.workspaceId}.`,
                }),
              );
            }

            return Effect.acquireUseRelease(
              Effect.try({
                try: () => this.persistedWorkspaceStateStoreOptions(recoverableWorkspace),
                catch: (cause: unknown) =>
                  new StateContractError({
                    operation: "runtime.generatedPackages.openRecoverableWorkspaceState",
                    reason: "transaction-failed",
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Unable to open recoverable workspace state.",
                    cause,
                  }),
              }),
              (store) =>
                markPersistedWorkspaceGeneratedPackageLinksRepairNeeded({
                  store,
                  request: input,
                }),
              () => Effect.void,
            );
          },
        ),
    };
  }

  private listRecoverableWorkspacesFromState(
    catalog: WorkspaceSessionCatalog,
  ): WorkspaceInfoResponse[] {
    const chrome = catalog.workspaceStateRouterRegistration().store.readWorkspaceChrome();
    const records = [...chrome.tabs, ...chrome.knownWorkspaces].filter(
      (workspace) => workspace.kind === "user",
    );
    const byWorkspaceId = new Map<string, WorkspaceInfoResponse>();
    for (const workspace of records) {
      if (!byWorkspaceId.has(workspace.workspaceId)) {
        byWorkspaceId.set(workspace.workspaceId, {
          workspaceId: workspace.workspaceId,
          cwd: workspace.cwd,
          workspaceLabel: workspace.workspaceLabel,
          kind: workspace.kind,
        });
      }
    }
    return [...byWorkspaceId.values()];
  }

  private findRecoverableWorkspace(
    catalog: WorkspaceSessionCatalog,
    workspaceId: WorkspaceId,
  ): WorkspaceInfoResponse | null {
    return (
      this.listRecoverableWorkspacesFromState(catalog).find(
        (workspace) => workspace.workspaceId === workspaceId,
      ) ?? null
    );
  }

  private runtimeDependencies(): RuntimeProviderAuthDependencies {
    return {
      ensureUsableProviderAuth:
        this.options.runtimeDependencies?.ensureUsableProviderAuth ??
        (async () => "test-provider-auth"),
      getProviderAuthUnavailableMessage:
        this.options.runtimeDependencies?.getProviderAuthUnavailableMessage ??
        ((provider) => `No provider auth available for ${provider}.`),
    };
  }

  private persistedWorkspaceStateStoreOptions(workspace: WorkspaceInfoResponse) {
    const workspaceCwd = canonicalizeWorkspaceCwd(workspace.cwd);
    const sessionDir = getSvvySessionDir(workspaceCwd, this.agentDir);
    const hasStatePreferenceAuthority = this.stateOwnedAppPreferences !== null;
    const preferences =
      this.stateOwnedAppPreferences ??
      createAgentSettingsStore({ agentDir: this.agentDir }).getState().appPreferences;
    return {
      digest: stateDigest,
      idFactory: (prefix: string) => `${prefix}-${randomUUID()}`,
      now: () => new Date().toISOString(),
      workspace: {
        id: workspace.workspaceId,
        label: workspace.workspaceLabel,
        cwd: workspaceCwd,
        artifactDir: resolveConfiguredArtifactDirectory(
          preferences.artifactDirectory,
          workspaceCwd,
        ),
      },
      workspaceArtifactDirectoryAuthority: hasStatePreferenceAuthority
        ? ("state-preference" as const)
        : ("seed" as const),
      databasePath: join(sessionDir, STRUCTURED_SESSION_DB_FILENAME),
    };
  }

  private acquireAppLogFacade(workspaceId: string, cwd: string): StateAppLogsFacade {
    const existing = this.sharedAppLogFacades.get(cwd);
    if (existing) {
      existing.refCount += 1;
      return existing.appLogs;
    }

    const runtimeDir = join(
      this.agentDir,
      "workspace-runtimes",
      sanitizeWorkspaceRuntimeStorageKey(cwd),
    );
    const appLogs = createStateAppLogsFacade({
      databasePath: join(runtimeDir, "app-logs-v1.sqlite"),
      digest: stateDigest,
      workspaceId,
      now: () => new Date().toISOString(),
    });
    this.sharedAppLogFacades.set(cwd, {
      appLogs,
      refCount: 1,
    });
    return appLogs;
  }

  private acquireAppGlobalAppLogFacade(): StateAppLogsFacade {
    if (this.appGlobalAppLogFacade) return this.appGlobalAppLogFacade;
    this.appGlobalAppLogFacade = createStateAppLogsFacade({
      databasePath: join(this.agentDir, "app-logs-v1.sqlite"),
      digest: stateDigest,
      now: () => new Date().toISOString(),
    });
    return this.appGlobalAppLogFacade;
  }

  private releaseAppLogFacade(cwd: string): void {
    const existing = this.sharedAppLogFacades.get(cwd);
    if (!existing) return;
    existing.refCount -= 1;
    if (existing.refCount > 0) return;
    this.sharedAppLogFacades.delete(cwd);
    existing.appLogs.close();
  }

  private releaseAppGlobalAppLogFacade(): void {
    this.appGlobalAppLogFacade?.close();
    this.appGlobalAppLogFacade = null;
  }
}

function appRuntimeBootstrapUnavailableError(
  operation: string,
  state: "shutting-down" | "closed",
): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: "runtime-shutdown",
    message:
      state === "shutting-down"
        ? "The app runtime is shutting down."
        : "The app runtime has been closed.",
  });
}

function sanitizeWorkspaceRuntimeStorageKey(value: string): string {
  return value.replace(/^[/\\]/, "").replace(/[/\\:#]/g, "-");
}

function resolveConfiguredArtifactDirectory(input: string, cwd: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  return isAbsolute(trimmed) ? trimmed : resolvePath(cwd, trimmed);
}

function normalizeWorkspaceRuntimeId(cwd: string): string {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 24);
  return `workspace:${hash}`;
}

function workspaceOwnerRef(workspaceId: string) {
  return {
    kind: "desktop-tab" as const,
    ownerId: `desktop:${workspaceId}` as RuntimeOwnerId,
  };
}

function workspaceRuntimeOwnerKey(owner: RuntimeOwnerRef): string {
  return `${owner.kind}:${owner.ownerId}`;
}

function runtimeRegistrySourceInvalidationError(
  operation: string,
  cause: unknown,
): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  return new RuntimeContractError({
    operation,
    reason: "state-conflict",
    message:
      cause instanceof Error ? cause.message : "Runtime source-invalidation reaction failed.",
    cause,
  });
}

function recordTitleGenerationLog(
  appLog: ReturnType<typeof createAppLogger>,
  event: TitleGenerationLogEvent,
): void {
  const message = formatTitleGenerationLogMessage(event);
  const details = {
    status: event.status,
    ...(event.status === "completed" ? { title: event.title } : {}),
    workspaceSessionId: event.sessionId,
  };
  if (event.level === "warning") {
    appLog.warning("session.title", message, {
      ...details,
      failureReason: event.error,
    });
    return;
  }
  appLog.info("session.title", message, details);
}

function recordWorkflowsGeneratedPackageLog(
  appLog: ReturnType<typeof createAppLogger>,
  event: WorkflowsGeneratedPackageLogEvent,
): void {
  appLog.info("workflow.library", "Generated Workflows package rebuilt.", {
    reason: event.reason,
    ...pickWorkflowGeneratedPackageFacts(event.commandFacts),
  });
}

function pickWorkflowGeneratedPackageFacts(
  facts: Record<string, unknown>,
): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const key of [
    "workflowDiagnosticCount",
    "workflowExportCount",
    "workflowSavedExportName",
    "workflowSavedKind",
  ]) {
    const value = facts[key];
    if (typeof value === "number" || typeof value === "string") {
      details[key] = value;
    }
  }
  return details;
}

function appPreferencesFromStructuredRecord(
  record: StateOwnedAppPreferencesRecord,
  fallback: AppPreferences = DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
): AppPreferences {
  const externalEditor = record.externalEditor;
  const knownEditors = new Set(["system", "code", "cursor", "zed", "sublime"]);
  return {
    ...fallback,
    appAppearance: record.appearance,
    preferredExternalEditor:
      externalEditor && knownEditors.has(externalEditor)
        ? (externalEditor as AppPreferences["preferredExternalEditor"])
        : externalEditor
          ? "custom"
          : "system",
    customExternalEditorCommand:
      externalEditor && !knownEditors.has(externalEditor)
        ? externalEditor
        : fallback.customExternalEditorCommand,
    artifactDirectory: record.artifactDirectory,
    approvalMode: record.approvalMode,
    networkAccess: record.networkAccess,
    externalInstructions: record.externalInstructions,
    ambientAgentResources:
      typeof record.ambientResources === "object" &&
      record.ambientResources !== null &&
      !Array.isArray(record.ambientResources)
        ? (record.ambientResources as unknown as AppPreferences["ambientAgentResources"])
        : fallback.ambientAgentResources,
  };
}

function formatTitleGenerationLogMessage(event: TitleGenerationLogEvent): string {
  switch (event.status) {
    case "queued":
      return "Session title generation queued.";
    case "started":
      return "Session title generation started.";
    case "completed":
      return "Session title generation completed.";
    case "failed":
      return "Session title generation failed.";
  }
}
