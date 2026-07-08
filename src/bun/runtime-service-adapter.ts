import { createHash } from "node:crypto";
import {
  existsSync,
  realpathSync,
  readdirSync,
  readFileSync,
  statSync,
  watch as nodeWatch,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import {
  ExtensionStatePort,
  ExtensionError as CoreExtensionError,
  AppLogWritePort,
  RuntimeActorExtensionBindingStatePort,
  RuntimeContractError,
  RuntimeEpisodeStatePort,
  StateContractError,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeGeneratedPackageStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkspaceStatePort,
  RuntimePromptDefaultsStatePort,
  SandboxPolicySource,
  SandboxPolicyError,
  type BuildLaunchPolicyInput,
  type AbsolutePath,
  type GeneratedPackagesRefreshResult,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type ExtensionStatePortService,
  type AppLogWritePortService,
  type InternalRefreshGeneratedPackagesRequest,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeEpisodeStatePortService,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimePromptDefaultsStatePortService,
  type RuntimeQueueStatePortService,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type RuntimeSourceStatePortService,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeThreadStatePortService,
  type RuntimeTurnStatePortService,
  type RuntimeWorkspaceStatePortService,
  type SandboxPolicySourceService,
  type SandboxLaunchFacts,
  type IsoDateTimeString,
  type WorkspaceId,
} from "@svvy/core";
import type { ExtensionSourceRoots, GeneratedPackageRoots } from "@svvy/extensions";
import {
  layer as extensionsLayer,
  layerExtensionSourceRootsPort,
  layerGeneratedPackageRootPort,
  layerPackagedExtensionTemplatesPort,
  layerWorkspaceSourceLinkPort,
} from "@svvy/extensions";
import {
  HostProcessReferencePort,
  SandboxHelperCandidatesPort,
  type HostProcessReferencePortService,
  type HostProcessReferenceSnapshot,
  type SandboxHelperCandidatesPortService,
  type SandboxHelperCandidatesSnapshot,
} from "@svvy/sandbox";
import { createRuntimeFacade, Runtime } from "@svvy/runtime";
import {
  acquireAcceptedDirectToolLaunch,
  requestAcceptedDirectToolApproval,
  runAcceptedLoadExtension,
  runAcceptedRequestUserInput,
} from "@svvy/runtime/accepted-native-tool-execution";
import {
  awaitRuntimeStartupReadiness,
  createRuntimeLayerConfigLayer,
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  RuntimeGeneratedContextRefreshHostPort,
  RuntimeGeneratedPackageRefreshHostPort,
  RuntimeLayerModelResolverPort,
  RuntimeLayerPromptControlHostPort,
  RuntimeLayerProviderAuthPort,
  RuntimeLayerSurfaceQueueWakePort,
  RuntimeSourceInvalidationScanPort,
  prepareRuntimeShutdown,
  layerRuntimeBunPlatform,
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
  type RuntimeGeneratedContextRefreshHostPortService,
  type RuntimeGeneratedPackageRefreshHostPortService,
  type RuntimeLayerCommandControlPortService,
  type RuntimeLayerCommandStdinPortService,
  type RuntimeLayerConfig,
  type RuntimeLayerPromptControlHostPortService,
  type RuntimeLayerSurfaceQueueWakePortService,
  type RuntimeSourceInvalidationDirectoryEntry,
  type RuntimeSourceInvalidationHost,
  type RuntimeSourceInvalidationScanPortService,
} from "@svvy/runtime/bootstrap";
import { type PromptTarget } from "../shared/workspace-contract";
import { WorkspaceSessionCatalog } from "./session-catalog";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import type { LiveCommandStdinRegistry } from "./live-command-stdin-registry";
import type { RunAcceptedLoadExtension } from "./extension-tools";
import type { RunAcceptedRequestUserInput } from "./request-user-input-tool";

type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;

export type RuntimeRoutingPortHost = {
  promptControlHost: RuntimeLayerPromptControlHostPortService;
  promptDefaultsStatePort: RuntimePromptDefaultsStatePortService;
  surfaceQueueWakePort: RuntimeLayerSurfaceQueueWakePortService;
};

export type RuntimeServiceAdapterPort = RuntimeRoutingPortHost & {
  sourceRoots: ExtensionSourceRoots;
  generatedPackageRoots: GeneratedPackageRoots;
  extensionStatePort: ExtensionStatePortService;
  generatedPackageLinkPath(input: GeneratedPackageWorkspaceLinkRepairInput): Promise<AbsolutePath>;
  sandboxPolicySource: SandboxPolicySourceService;
  queueStatePort: RuntimeQueueStatePortService;
  actorExtensionBindingStatePort: RuntimeActorExtensionBindingStatePortService;
  requestStatePort: RuntimeRequestStatePortService;
  approvalStatePort: RuntimeApprovalStatePortService;
  commandStatePort: RuntimeCommandStatePortService;
  generatedPackageStatePort: RuntimeGeneratedPackageStatePortService;
  sessionWaitStatePort: RuntimeSessionWaitStatePortService;
  threadStatePort: RuntimeThreadStatePortService;
  turnStatePort: RuntimeTurnStatePortService;
  episodeStatePort: RuntimeEpisodeStatePortService;
  sourceStatePort: RuntimeSourceStatePortService;
  surfaceLifecycleStatePort: RuntimeSurfaceLifecycleStatePortService;
  workspaceStatePort: RuntimeWorkspaceStatePortService;
  generatedContextRefreshHost: RuntimeGeneratedContextRefreshHostPortService;
  generatedPackageRefreshHost: RuntimeGeneratedPackageRefreshHostPortService;
  sourceInvalidationScan: RuntimeSourceInvalidationScanPortService;
  commandStdin: RuntimeLayerCommandStdinPortService;
  commandControl: RuntimeLayerCommandControlPortService;
  appLogWritePort: AppLogWritePortService;
  sandboxHostSupport: PackagedSandboxHostSupportServices;
};

type CatalogBackedRuntimePort = {
  sourceRoots: ExtensionSourceRoots;
  generatedPackageRoots: GeneratedPackageRoots;
  extensionStatePort: ExtensionStatePortService;
  generatedPackageLinkPath(input: GeneratedPackageWorkspaceLinkRepairInput): Promise<AbsolutePath>;
  catalog: Pick<
    WorkspaceSessionCatalog,
    | "cancelActivePrompt"
    | "cancelPrompt"
    | "getRuntimeActorExtensionBindingStatePort"
    | "getRuntimeGeneratedPackageStatePort"
    | "getRuntimeApprovalStatePort"
    | "getRuntimeCommandStatePort"
    | "getRuntimeRequestStatePort"
    | "getRuntimeSessionWaitStatePort"
    | "getRuntimeEpisodeStatePort"
    | "getRuntimeSourceStatePort"
    | "getRuntimeSurfaceLifecycleStatePort"
    | "getRuntimeThreadStatePort"
    | "getRuntimeTurnStatePort"
    | "getRuntimeWorkspaceStatePort"
    | "getSandboxPolicySource"
    | "wakeRuntimeSurfaceQueue"
    | "resolvePromptDefaultsForTarget"
    | "getRuntimeQueueStatePort"
  >;
  generatedContextRefreshHost: RuntimeGeneratedContextRefreshHostPortService;
  generatedPackageRefreshHost: RuntimeGeneratedPackageRefreshHostPortService;
  generatedPackageStatePort?: RuntimeGeneratedPackageStatePortService;
  sourceInvalidationScan: RuntimeSourceInvalidationScanPortService;
  commandStdin: RuntimeLayerCommandStdinPortService;
  commandControl: RuntimeLayerCommandControlPortService;
  appLogWritePort: AppLogWritePortService;
  sandboxHostSupport: PackagedSandboxHostSupportServices;
};

export type CatalogBackedRuntimeDependencies = {
  ensureUsableProviderAuth(provider: string): Promise<string | undefined>;
  getProviderAuthUnavailableMessage(provider: string): string;
};

export type CatalogBackedRuntime = {
  facade: RuntimeFacade;
  internal: {
    launchFacts: {
      acquireDirectToolLaunch(
        input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
          toolName: "exec_command" | "apply_patch" | "execute_typescript";
        },
      ): Promise<{
        facts: SandboxLaunchFacts;
        close(): Promise<void>;
      }>;
      acquireExecuteTypescript(input: Omit<BuildLaunchPolicyInput, "launchKind">): Promise<{
        facts: SandboxLaunchFacts;
        close(): Promise<void>;
      }>;
    };
    sourceInvalidation: {
      refreshGeneratedPackages(
        input: InternalRefreshGeneratedPackagesRequest,
      ): Promise<GeneratedPackagesRefreshResult>;
    };
    acceptedNativeTools: {
      requestDirectToolApproval: RuntimeApprovalBoundary;
      runLoadExtension: RunAcceptedLoadExtension;
      runRequestUserInput: RunAcceptedRequestUserInput;
    };
  };
  dispose(): Promise<void>;
};

export type NativeSandboxHelperMetadata = {
  schemaVersion: 1;
  artifact: "svvy-sandbox-helper";
  platform: "darwin";
  arch: "arm64" | "x64";
  digest: {
    algorithm: "sha256";
    hex: string;
  };
};

export type PackagedSandboxHostSupportServices = {
  helperCandidates: SandboxHelperCandidatesPortService;
  hostProcess: HostProcessReferencePortService;
};

export type PackagedSandboxHostSupportInput = {
  executablePath?: string;
  appSupportRoot?: string;
  tempRoot?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  readFileString?: (path: string) => string;
};

export function createRuntimeBackedWorkspaceSessionCatalog(
  cwd: string,
  agentDir?: string,
  sessionDir?: string,
  _namerSessionDir?: string,
  workspaceId?: string,
  recoveryOptions?: {
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
    workflowsSourceRoot?: string;
    acquireExecuteTypescriptLaunch?: (
      input: Omit<BuildLaunchPolicyInput, "launchKind">,
    ) => Promise<{
      facts: SandboxLaunchFacts;
      close(): Promise<void>;
    }>;
    acquireDirectToolLaunch?: (
      input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
        toolName: "exec_command" | "apply_patch" | "execute_typescript";
      },
    ) => Promise<{
      facts: SandboxLaunchFacts;
      close(): Promise<void>;
    }>;
    refreshGeneratedPackages?: (
      input: InternalRefreshGeneratedPackagesRequest,
    ) => Promise<GeneratedPackagesRefreshResult>;
    runAcceptedLoadExtension?: RunAcceptedLoadExtension;
    runAcceptedRequestUserInput?: RunAcceptedRequestUserInput;
    requestDirectToolApproval?: RuntimeApprovalBoundary;
  },
  approvalBoundary?: RuntimeApprovalBoundary,
  managedSandbox?: boolean | (() => boolean),
  runtimeCommandStdin?: LiveCommandStdinRegistry,
  runtimeLayerConfig?: RuntimeLayerConfig,
): WorkspaceSessionCatalog {
  return new WorkspaceSessionCatalog(
    cwd,
    agentDir,
    sessionDir,
    workspaceId,
    recoveryOptions,
    approvalBoundary,
    managedSandbox,
    runtimeCommandStdin,
    runRuntimeEffect,
    runtimeLayerConfig,
  );
}

export function createPackagedSandboxHostSupportServices(
  input: PackagedSandboxHostSupportInput = {},
): PackagedSandboxHostSupportServices {
  const executablePath = input.executablePath ?? process.execPath;
  const executableDir = dirname(executablePath);
  const appBundleRoot = resolve(executableDir, "..", "..") as AbsolutePath;
  const appSupportRoot = (input.appSupportRoot ??
    join(homedir(), ".config", "svvy")) as AbsolutePath;
  const tempRoot = (input.tempRoot ?? tmpdir()) as AbsolutePath;
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const readFileString = input.readFileString ?? ((path: string) => readFileSync(path, "utf8"));
  const helperSnapshot = buildPackagedHelperCandidatesSnapshot({
    platform,
    executableDir,
    readFileString,
  });

  const hostProcess: HostProcessReferencePortService = {
    getSnapshot: () =>
      Effect.try({
        try: (): HostProcessReferenceSnapshot => ({
          platform: parseSandboxHostPlatform(platform),
          arch: parseSandboxHostArch(arch),
          appBundleRoot,
          appSupportRoot,
          tempRoot,
        }),
        catch: (cause) => sandboxHostSupportError("HostProcessReferencePort.getSnapshot", cause),
      }),
  };

  const helperCandidates: SandboxHelperCandidatesPortService = {
    getSnapshot: () => Effect.succeed(helperSnapshot),
  };

  return { helperCandidates, hostProcess };
}

function buildPackagedHelperCandidatesSnapshot(input: {
  platform: NodeJS.Platform;
  executableDir: string;
  readFileString: (path: string) => string;
}): SandboxHelperCandidatesSnapshot {
  if (input.platform !== "darwin") {
    return { candidates: [], allowedRoots: [] };
  }
  const metadataPath = join(input.executableDir, "svvy-sandbox-helper.metadata.json");
  const metadata = (() => {
    try {
      return parseNativeSandboxHelperMetadata(input.readFileString(metadataPath));
    } catch (cause) {
      throw sandboxHostSupportError("createPackagedSandboxHostSupportServices", cause);
    }
  })();
  return {
    candidates: [
      {
        path: join(input.executableDir, metadata.artifact) as AbsolutePath,
        platform: metadata.platform,
        arch: metadata.arch,
        expectedDigest: metadata.digest.hex,
      },
    ],
    allowedRoots: [input.executableDir as AbsolutePath],
  };
}

function parseNativeSandboxHelperMetadata(source: string): NativeSandboxHelperMetadata {
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Native sandbox helper metadata must be an object.");
  }
  const metadata = parsed as Partial<NativeSandboxHelperMetadata>;
  if (metadata.schemaVersion !== 1) {
    throw new Error("Native sandbox helper metadata schemaVersion must be 1.");
  }
  if (metadata.artifact !== "svvy-sandbox-helper") {
    throw new Error("Native sandbox helper metadata artifact must be svvy-sandbox-helper.");
  }
  if (metadata.platform !== "darwin") {
    throw new Error("Native sandbox helper metadata platform must be darwin.");
  }
  if (metadata.arch !== "arm64" && metadata.arch !== "x64") {
    throw new Error("Native sandbox helper metadata arch must be arm64 or x64.");
  }
  if (!metadata.digest || metadata.digest.algorithm !== "sha256") {
    throw new Error("Native sandbox helper metadata digest algorithm must be sha256.");
  }
  if (!/^[a-f0-9]{64}$/.test(metadata.digest.hex)) {
    throw new Error("Native sandbox helper metadata digest hex must be a SHA-256 hex string.");
  }
  return metadata as NativeSandboxHelperMetadata;
}

function parseSandboxHostPlatform(
  platform: NodeJS.Platform,
): HostProcessReferenceSnapshot["platform"] {
  if (platform === "darwin") {
    return platform;
  }
  throw new Error(`Native sandbox helper is unsupported on platform ${platform}.`);
}

function parseSandboxHostArch(arch: NodeJS.Architecture): HostProcessReferenceSnapshot["arch"] {
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Native sandbox helper is unsupported on architecture ${arch}.`);
}

function sandboxHostSupportError(operation: string, cause: unknown): SandboxPolicyError {
  if (cause instanceof SandboxPolicyError) {
    return cause;
  }
  return new SandboxPolicyError({
    operation,
    reason: "helper-unavailable",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export interface RuntimeGeneratedPackageRefreshBoundaryHost {
  listAcquiredWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  listRecoverableWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  materializeCoreTypeContractPackage(): Effect.Effect<void, RuntimeContractError>;
  now(): Effect.Effect<IsoDateTimeString, RuntimeContractError>;
  readonly workspaceLinkFileHost: RuntimeGeneratedPackageWorkspaceLinkFileHost;
}

export function createNodeSourceInvalidationHost(): RuntimeSourceInvalidationHost {
  return {
    homeDir: homedir(),
    path: {
      dirname,
      join,
      resolve,
    },
    fileSystem: {
      exists: existsSync,
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
      isFile: (path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      },
      readDirectory: (path) =>
        readdirSync(path, { withFileTypes: true }).map(
          (entry): RuntimeSourceInvalidationDirectoryEntry => ({
            name: entry.name,
            kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
          }),
        ),
      readFileString: (path) => readFileSync(path, "utf8"),
      realPath: (path) => {
        try {
          return realpathSync.native(path);
        } catch {
          return null;
        }
      },
    },
    hashStrings: (parts) => {
      const hash = createHash("sha256");
      for (const part of parts) {
        hash.update(part);
        hash.update("\0");
      }
      return hash.digest("hex");
    },
    watch: (path, listener) => {
      const watcher = nodeWatch(path, (eventType, filename) => {
        void runRuntimeEffect(listener(eventType, filename));
      });
      watcher.on("error", () => {});
      return { close: () => watcher.close() };
    },
  };
}

function runRuntimeEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

export async function createCatalogBackedRuntime(
  port: CatalogBackedRuntimePort,
  dependencies: CatalogBackedRuntimeDependencies,
  config: RuntimeLayerConfig,
): Promise<CatalogBackedRuntime> {
  return createRuntimeServiceAdapter(catalogBackedRuntimePort(port), dependencies, config);
}

export async function createRuntimeServiceAdapter(
  port: RuntimeServiceAdapterPort,
  dependencies: CatalogBackedRuntimeDependencies,
  config: RuntimeLayerConfig,
): Promise<CatalogBackedRuntime> {
  const sandboxHostSupport = port.sandboxHostSupport;
  const extensionPackageLayer = Layer.mergeAll(
    layerRuntimeBunPlatform,
    Layer.succeed(ExtensionStatePort, port.extensionStatePort),
    layerExtensionSourceRootsPort(port.sourceRoots),
    layerGeneratedPackageRootPort(port.generatedPackageRoots),
    layerPackagedExtensionTemplatesPort({
      builtinExtensionsRoot: port.sourceRoots.extensionsRoot,
    }),
    layerWorkspaceSourceLinkPort({
      generatedPackageLinkPath: (linkInput) =>
        Effect.tryPromise({
          try: () => port.generatedPackageLinkPath(linkInput),
          catch: (cause) =>
            new CoreExtensionError({
              operation: "runtime.generated-packages.workspace-link-path",
              reason: "execution-failed",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Generated package workspace link path resolution failed.",
              cause,
            }),
        }),
    }),
  );
  const runtimeHostLayer = Layer.mergeAll(
    extensionsLayer.pipe(Layer.provide(extensionPackageLayer)),
    layerRuntimeBunPlatform,
    Layer.succeed(SandboxPolicySource, port.sandboxPolicySource),
    Layer.succeed(SandboxHelperCandidatesPort, sandboxHostSupport.helperCandidates),
    Layer.succeed(HostProcessReferencePort, sandboxHostSupport.hostProcess),
    layerExtensionSourceRootsPort(port.sourceRoots),
    Layer.succeed(RuntimeLayerPromptControlHostPort, port.promptControlHost),
    Layer.succeed(RuntimePromptDefaultsStatePort, port.promptDefaultsStatePort),
    Layer.succeed(RuntimeLayerSurfaceQueueWakePort, port.surfaceQueueWakePort),
    Layer.succeed(RuntimeQueueStatePort, port.queueStatePort),
    Layer.succeed(RuntimeActorExtensionBindingStatePort, port.actorExtensionBindingStatePort),
    Layer.succeed(RuntimeRequestStatePort, port.requestStatePort),
    Layer.succeed(RuntimeApprovalStatePort, port.approvalStatePort),
    Layer.succeed(RuntimeCommandStatePort, port.commandStatePort),
    Layer.succeed(RuntimeGeneratedPackageStatePort, port.generatedPackageStatePort),
    Layer.succeed(RuntimeSessionWaitStatePort, port.sessionWaitStatePort),
    Layer.succeed(RuntimeThreadStatePort, port.threadStatePort),
    Layer.succeed(RuntimeTurnStatePort, port.turnStatePort),
    Layer.succeed(RuntimeEpisodeStatePort, port.episodeStatePort),
    Layer.succeed(RuntimeSourceStatePort, port.sourceStatePort),
    Layer.succeed(RuntimeSurfaceLifecycleStatePort, port.surfaceLifecycleStatePort),
    Layer.succeed(RuntimeWorkspaceStatePort, port.workspaceStatePort),
    Layer.succeed(RuntimeLayerProviderAuthPort, {
      ensureUsableProviderAuth: (provider) =>
        Effect.tryPromise({
          try: () => dependencies.ensureUsableProviderAuth(provider),
          catch: (cause: unknown) =>
            runtimeAdapterError("runtime.messages.submit.providerAuth", cause),
        }),
      getProviderAuthUnavailableMessage: dependencies.getProviderAuthUnavailableMessage,
    }),
    Layer.succeed(RuntimeLayerModelResolverPort, {
      resolveModelId: ({ provider, model }) =>
        Effect.try({
          try: () =>
            getModel(
              provider as Parameters<typeof getModel>[0],
              model as Parameters<typeof getModel>[1],
            ).id,
          catch: (cause: unknown) => runtimeAdapterError("runtime.model.resolve", cause),
        }),
    }),
    Layer.succeed(AppLogWritePort, port.appLogWritePort),
    Layer.succeed(RuntimeGeneratedContextRefreshHostPort, port.generatedContextRefreshHost),
    Layer.succeed(RuntimeGeneratedPackageRefreshHostPort, port.generatedPackageRefreshHost),
    Layer.succeed(RuntimeSourceInvalidationScanPort, port.sourceInvalidationScan),
    Layer.succeed(RuntimeLayerCommandStdinPort, port.commandStdin),
    Layer.succeed(RuntimeLayerCommandControlPort, port.commandControl),
  );
  const runtimeLayerConfig = createRuntimeLayerConfigLayer(config);
  const managedRuntime = ManagedRuntime.make(
    Layer.mergeAll(Runtime.layer.pipe(Layer.provide(runtimeLayerConfig)), runtimeLayerConfig).pipe(
      Layer.provide(runtimeHostLayer),
    ),
  );
  const runManagedRuntimeEffect = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
    managedRuntime.runPromise(effect as Effect.Effect<A, E, never>);
  await managedRuntime.context();
  await awaitRuntimeStartupReadiness(managedRuntime);
  const facade = createRuntimeFacade(managedRuntime);
  const acquireDirectToolLaunch = (
    input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
      toolName: "exec_command" | "apply_patch" | "execute_typescript";
    },
  ) => acquireAcceptedDirectToolLaunch(managedRuntime, input);
  return {
    facade,
    internal: {
      launchFacts: {
        acquireDirectToolLaunch,
        acquireExecuteTypescript: (input) =>
          acquireDirectToolLaunch({ ...input, toolName: "execute_typescript" }),
      },
      sourceInvalidation: {
        refreshGeneratedPackages: (input) =>
          runManagedRuntimeEffect(
            Effect.gen(function* () {
              const runtime = yield* Runtime;
              return yield* runtime.sourceInvalidation.refreshGeneratedPackages(input);
            }),
          ),
      },
      acceptedNativeTools: {
        requestDirectToolApproval: (input) =>
          requestAcceptedDirectToolApproval(managedRuntime, input),
        runLoadExtension: (input) => runAcceptedLoadExtension(managedRuntime, input),
        runRequestUserInput: (input) => runAcceptedRequestUserInput(managedRuntime, input),
      },
    },
    dispose: async () => {
      try {
        await prepareRuntimeShutdown(managedRuntime, { reason: "app-shutdown" });
        await facade.close();
      } finally {
        await managedRuntime.dispose();
      }
    },
  };
}

function catalogBackedRuntimePort(port: CatalogBackedRuntimePort): RuntimeServiceAdapterPort {
  return {
    sourceRoots: port.sourceRoots,
    generatedPackageRoots: port.generatedPackageRoots,
    extensionStatePort: port.extensionStatePort,
    generatedPackageLinkPath: port.generatedPackageLinkPath,
    promptControlHost: {
      cancelActivePrompt: (input) =>
        Effect.tryPromise({
          try: () =>
            port.catalog.cancelActivePrompt({
              ...input,
              target: input.target as PromptTarget,
            }),
          catch: (cause) => runtimeAdapterError("runtime.messages.abort.active", cause),
        }),
      cancelPrompt: (target) =>
        Effect.tryPromise({
          try: () => port.catalog.cancelPrompt(target as PromptTarget),
          catch: (cause) => runtimeAdapterError("runtime.messages.abort", cause),
        }),
    },
    promptDefaultsStatePort: {
      resolvePromptDefaults: (input) =>
        Effect.try({
          try: () => port.catalog.resolvePromptDefaultsForTarget(input.target as PromptTarget),
          catch: (cause: unknown) =>
            new StateContractError({
              operation: "runtime.promptDefaults.resolve",
              reason: "not-found",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Runtime prompt defaults could not be resolved.",
              cause,
            }),
        }),
    },
    surfaceQueueWakePort: {
      wakeSurfaceQueue: (input) =>
        Effect.tryPromise({
          try: () =>
            port.catalog.wakeRuntimeSurfaceQueue({
              target: input.target as PromptTarget,
              reason: input.reason,
            }),
          catch: (cause) => runtimeAdapterError("runtime.queueWake.wakeSurface", cause),
        }),
    },
    sandboxPolicySource: port.catalog.getSandboxPolicySource(),
    queueStatePort: port.catalog.getRuntimeQueueStatePort(),
    actorExtensionBindingStatePort: port.catalog.getRuntimeActorExtensionBindingStatePort(),
    requestStatePort: port.catalog.getRuntimeRequestStatePort(),
    approvalStatePort: port.catalog.getRuntimeApprovalStatePort(),
    commandStatePort: port.catalog.getRuntimeCommandStatePort(),
    generatedPackageStatePort:
      port.generatedPackageStatePort ?? port.catalog.getRuntimeGeneratedPackageStatePort(),
    sessionWaitStatePort: port.catalog.getRuntimeSessionWaitStatePort(),
    threadStatePort: port.catalog.getRuntimeThreadStatePort(),
    turnStatePort: port.catalog.getRuntimeTurnStatePort(),
    episodeStatePort: port.catalog.getRuntimeEpisodeStatePort(),
    sourceStatePort: port.catalog.getRuntimeSourceStatePort(),
    surfaceLifecycleStatePort: port.catalog.getRuntimeSurfaceLifecycleStatePort(),
    workspaceStatePort: port.catalog.getRuntimeWorkspaceStatePort(),
    generatedContextRefreshHost: port.generatedContextRefreshHost,
    generatedPackageRefreshHost: port.generatedPackageRefreshHost,
    sourceInvalidationScan: port.sourceInvalidationScan,
    commandStdin: port.commandStdin,
    commandControl: port.commandControl,
    appLogWritePort: port.appLogWritePort,
    sandboxHostSupport: port.sandboxHostSupport,
  };
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
