import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  type AbsolutePath,
  ExtensionError as CoreExtensionError,
  type ExtensionError,
  type ExtensionStatePort,
  type GeneratedPackageBuildInput,
  type GeneratedPackageBuildPlanResult,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type GeneratedPackageWorkspaceLinkRepairPlan,
  type GeneratedPackageRefreshStatus,
  type NativeToolSchemaExtension,
} from "@svvy/core";
import { refreshGeneratedExtensionsPackage as refreshGeneratedExtensionsPackageFiles } from "./generated-extensions-package";
import {
  GENERATED_WORKFLOWS_PACKAGE_NAME,
  refreshGeneratedWorkflowsPackage as refreshGeneratedWorkflowsPackageFiles,
} from "./generated-workflows-package";
import {
  buildNativeToolSchemaJsonForExtension,
  buildNativeToolSchemasJson,
} from "./native-tool-catalog";
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
import { GeneratedPackageRootPort } from "./generated-package-root-port";
import { WorkspaceSourceLinkPort } from "./workspace-source-link-port";
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

export interface NativeToolSchemasJsonInput {
  records: readonly NativeToolSchemaExtension[];
}

export interface NativeToolSchemaJsonForExtensionInput {
  extension: NativeToolSchemaExtension;
}

export interface NativeToolCommandMetadataInput {
  toolName: string;
}

export interface NativeToolHandlerInput {
  toolName: string;
}

export interface ExtensionsService {
  registry: {
    list(): Effect.Effect<readonly ExtensionRecord[]>;
    inspect(input: ExtensionRegistryInspectInput): Effect.Effect<ExtensionRecord, ExtensionError>;
  };
  actorBindings: {
    resolve(input: ResolveActorExtensionBindingInput): Effect.Effect<ActorExtensionBinding>;
    visibleRecords(
      input: BuildVisibleExtensionRecordsInput,
    ): Effect.Effect<VisibleExtensionRecordsResult>;
  };
  nativeTools: {
    schemasJson(input: NativeToolSchemasJsonInput): Effect.Effect<string, ExtensionError>;
    schemaJsonForExtension(
      input: NativeToolSchemaJsonForExtensionInput,
    ): Effect.Effect<string, ExtensionError>;
    listCommandMetadata(): Effect.Effect<readonly NativeToolCommandMetadata[]>;
    getCommandMetadata(
      input: NativeToolCommandMetadataInput,
    ): Effect.Effect<NativeToolCommandMetadata | null>;
    handler(input: NativeToolHandlerInput): Effect.Effect<ExtensionHandler, ExtensionError>;
  };
  generatedPackages: {
    refresh(
      input: GeneratedPackageBuildInput,
    ): Effect.Effect<
      GeneratedPackageBuildPlanResult,
      ExtensionError,
      | FileSystem.FileSystem
      | Path.Path
      | ExtensionStatePort
      | ExtensionSourceRootsPort
      | GeneratedPackageRootPort
    >;
    planWorkspaceLink(
      input: GeneratedPackageWorkspaceLinkRepairInput,
    ): Effect.Effect<
      GeneratedPackageWorkspaceLinkRepairPlan,
      ExtensionError,
      WorkspaceSourceLinkPort | GeneratedPackageRootPort | Path.Path
    >;
  };
}

export class Extensions extends Context.Service<Extensions, ExtensionsService>()(
  "@svvy/extensions/Extensions",
) {}

export const makeExtensions = Effect.fn("@svvy/extensions/makeExtensions")(() =>
  Effect.succeed(
    Extensions.of({
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
      },
      actorBindings: {
        resolve: (input) => Effect.succeed(resolveActorExtensionState(input)),
        visibleRecords: (input) => Effect.succeed(visibleExtensionRecords(input)),
      },
      nativeTools: {
        schemasJson: ({ records }) =>
          tryExtensionCatalogOperation("extensions.native-tools.schemas-json", () =>
            buildNativeToolSchemasJson(records),
          ),
        schemaJsonForExtension: ({ extension }) =>
          tryExtensionCatalogOperation(
            "extensions.native-tools.schema-json-for-extension",
            () => buildNativeToolSchemaJsonForExtension(extension),
            extension.id,
          ),
        listCommandMetadata: () => Effect.succeed(nativeToolCommandMetadata),
        getCommandMetadata: ({ toolName }) =>
          Effect.succeed(getNativeToolCommandMetadata(toolName)),
        handler: ({ toolName }) => {
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
              operation: "extensions.native-tools.handler",
              reason: "not-found",
              message: `Native tool handler does not exist: ${toolName}`,
            }),
          );
        },
      },
      generatedPackages: {
        refresh: (input) => refreshGeneratedPackages(input),
        planWorkspaceLink: (input) => planGeneratedPackageWorkspaceLink(input),
      },
    }),
  ),
);

export const layerExtensions = Layer.effect(Extensions, makeExtensions());

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
  const requestedPackages = new Set(input.packages);
  const mustRefreshExtensions =
    requestedPackages.has("@svvyx/extensions") || requestedPackages.has("@svvyx/workflows");
  const mustRefreshWorkflows = requestedPackages.has(GENERATED_WORKFLOWS_PACKAGE_NAME);
  if (!mustRefreshExtensions && !mustRefreshWorkflows) {
    return Effect.succeed({ packages: [] });
  }

  return Effect.gen(function* () {
    const sourceRoots = yield* (yield* ExtensionSourceRootsPort).roots();
    const generatedPackageRoots = yield* (yield* GeneratedPackageRootPort).roots();
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
            generatedPackagePath: generatedPackageRoots.workflowsPackageRoot,
            workflowsSourceRoot: sourceRoots.workflowsSourceRoot,
          })
        : null;
    return { extensionsRefresh, workflowsRefresh };
  }).pipe(
    Effect.map(({ extensionsRefresh, workflowsRefresh }): GeneratedPackageBuildPlanResult => {
      const packages: GeneratedPackageRefreshStatus[] = [];

      if (extensionsRefresh) {
        packages.push({
          packageName: "@svvyx/extensions",
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

      return { packages };
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
  WorkspaceSourceLinkPort | GeneratedPackageRootPort | Path.Path
> {
  const operation = "extensions.generated-packages.plan-workspace-link";
  return Effect.gen(function* () {
    const linkPath = yield* (yield* WorkspaceSourceLinkPort).generatedPackageLinkPath(input);
    const roots = yield* (yield* GeneratedPackageRootPort).roots();
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
