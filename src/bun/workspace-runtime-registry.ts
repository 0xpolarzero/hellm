import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve as resolvePath } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
import {
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
  type RuntimeLayerConfig,
  type RuntimeSourceInvalidationEvent,
  type RuntimeSourceInvalidationHost,
  type RuntimeSourceInvalidationScanPortService,
} from "@svvy/runtime/bootstrap";
import {
  createRuntimeSourceInvalidationCoordinatorHandle,
  type RuntimeSourceInvalidationCoordinatorHandle,
} from "@svvy/runtime/source-invalidation-coordinator-adapter";
import {
  RuntimeContractError,
  StateContractError,
  type AbsolutePath,
  type ExtensionStatePortService,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type IsoDateTimeString,
  type RefreshGeneratedContextRequest,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeSourceStatePortService,
  type WorkspaceId,
} from "@svvy/core";
import type { ExtensionSourceRoots, GeneratedPackageRoots } from "@svvy/extensions";
import type {
  AppLogUpdateMessage,
  SurfaceSyncMessage,
  WorkspaceInfoResponse,
  WorkspaceKind,
  WorkspaceSyncMessage,
} from "../shared/workspace-contract";
import { appendAppLoggerEvent, createAppLogger, type BridgeLogLevel } from "./app-logger";
import { createStateAppLogsFacade, type StateAppLogsFacade } from "@svvy/state";
import { markPersistedWorkspaceGeneratedPackageLinksRepairNeeded } from "@svvy/state/generated-package-maintenance";
import { createAgentSettingsStore } from "./agent-settings-store";
import {
  getSvvySessionDir,
  getSvvyAgentDir,
  getSvvyDataDir,
  STRUCTURED_SESSION_DB_FILENAME,
  type WorkspaceSessionCatalog,
  type TitleGenerationLogEvent,
  type WorkflowsGeneratedPackageLogEvent,
} from "./session-catalog";
import { extensionsRootForAgentDir } from "./generated-agent-context-aggregate-cache";
import {
  getWorkflowsGeneratedPackagePath,
  getWorkflowsSourceRoot,
} from "./smithers-runtime/workflow-library";
import { effectiveExtensionsGeneratedPackagePath } from "./generated-extensions-package";
import {
  getCoreTypeContractPackagePath,
  materializeGeneratedCoreTypeContractPackage,
} from "./generated-core-type-contract-package";
import { canonicalizeWorkspaceCwd, getDefaultWorkspaceCwd } from "./workspace-context";
import { WorkspacePathIndex } from "./workspace-path-index";
import {
  createCatalogBackedRuntime,
  createNodeSourceInvalidationHost,
  createRuntimeBackedWorkspaceSessionCatalog,
  type CatalogBackedRuntime,
  type CatalogBackedRuntimeDependencies,
  type PackagedSandboxHostSupportServices,
  type RuntimeGeneratedPackageRefreshBoundaryHost,
} from "./runtime-service-adapter";
import {
  buildAppGlobalSourceWatchInputs,
  buildWorkspaceSourceWatchInputs,
} from "./source-watch-inputs";
import { createLiveCommandStdinRegistry } from "./live-command-stdin-registry";

type WorkspaceGeneratedPackageBoundaryHost = RuntimeGeneratedPackageRefreshBoundaryHost & {
  readonly sourceRoots: ExtensionSourceRoots;
  readonly generatedPackageRoots: GeneratedPackageRoots;
  readonly extensionStatePort: ExtensionStatePortService;
  generatedPackageLinkPath(input: GeneratedPackageWorkspaceLinkRepairInput): Promise<AbsolutePath>;
};

type RuntimeFacade = CatalogBackedRuntime["facade"];
type RuntimeSourceInvalidationReactionInput =
  | {
      readonly scope: { readonly kind: "app-global" };
      readonly event: RuntimeSourceInvalidationEvent;
    }
  | {
      readonly scope: { readonly kind: "workspace"; readonly workspaceId: WorkspaceId };
      readonly event: RuntimeSourceInvalidationEvent;
    };
export type WorkspaceRuntimeOperations = Pick<
  RuntimeFacade,
  | "approvals"
  | "commands"
  | "messages"
  | "queues"
  | "requestInput"
  | "sourceEdits"
  | "sourceInvalidation"
>;

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
  onAppLogUpdate?: (workspaceId: string, payload: AppLogUpdateMessage) => void;
  onSurfaceSync?: (workspaceId: string, payload: SurfaceSyncMessage) => void;
  onWorkspaceSync?: (workspaceId: string, payload: WorkspaceSyncMessage) => void;
  listRecoverableWorkspaces?: () => readonly WorkspaceInfoResponse[];
  runtimeDependencies?: Partial<CatalogBackedRuntimeDependencies>;
  runtimeLayerConfig: RuntimeLayerConfig;
  sandboxHostSupport: PackagedSandboxHostSupportServices;
  sourceInvalidationHost?: RuntimeSourceInvalidationHost;
  sourceWatchEnabled?: boolean;
  workflowsGeneratedPackagePath?: string;
  workflowsExtensionsGeneratedPackagePath?: string;
  coreTypeContractPackagePath?: string;
  workflowsSourceRoot?: string;
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

type RuntimeRecord = WorkspaceRuntime & {
  refCount: number;
  sourceInvalidationCoordinator: RuntimeSourceInvalidationCoordinatorHandle;
  unsubscribeAppLog: () => void;
};

type AppGlobalRuntimeRecord = {
  facade: RuntimeFacade;
  sourceStatePort: Pick<RuntimeSourceStatePortService, "recordSourceScan">;
  dispose(): Promise<void>;
};

export class WorkspaceRuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly runtimeFacades = new Map<string, RuntimeFacade>();
  private readonly pendingRuntimes = new Map<string, Promise<RuntimeRecord>>();
  private appGlobalRuntime: Promise<AppGlobalRuntimeRecord> | null = null;
  private readonly startupReady: Promise<void>;
  private readonly sharedAppLogFacades = new Map<
    string,
    {
      appLogs: StateAppLogsFacade;
      refCount: number;
    }
  >();
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
          workflowsSourceRoot: this.options.workflowsSourceRoot ?? getWorkflowsSourceRoot(),
        }),
      onDomainsChanged: (event) =>
        Effect.promise(async () => {
          await this.handleSourceInvalidationEvent({
            scope: { kind: "app-global" },
            event,
          });
          for (const runtime of this.runtimes.values()) {
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
              Effect.promise(() => this.getAppGlobalRuntimeRecord()),
              (runtime) => runtime.sourceStatePort.recordSourceScan(input),
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
      const runtime = await this.acquireWorkspace(options.initialCwd);
      this.activeWorkspaceId = runtime.workspaceId;
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
    const workspaceCwd = canonicalizeWorkspaceCwd(cwd);
    const workspaceId = normalizeWorkspaceRuntimeId(workspaceCwd);
    const existing = this.runtimes.get(workspaceId);
    if (existing) {
      existing.refCount += 1;
      this.activeWorkspaceId = workspaceId;
      return existing;
    }

    const pending = this.pendingRuntimes.get(workspaceId);
    if (pending) {
      const runtime = await pending;
      runtime.refCount += 1;
      this.activeWorkspaceId = workspaceId;
      return runtime;
    }

    const pendingRuntime = this.createRuntime(workspaceId, workspaceCwd, options.kind ?? "user");
    this.pendingRuntimes.set(workspaceId, pendingRuntime);
    let runtime: RuntimeRecord;
    try {
      runtime = await pendingRuntime;
    } finally {
      this.pendingRuntimes.delete(workspaceId);
    }
    this.runtimes.set(workspaceId, runtime);
    this.activeWorkspaceId = workspaceId;
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

  getRuntimeOperations(workspaceId: string): WorkspaceRuntimeOperations {
    return this.requireRuntimeFacade(workspaceId);
  }

  getRuntimeEventSubscription(
    workspaceId: string,
    input?: Parameters<RuntimeFacade["events"]>[0],
  ): ReturnType<RuntimeFacade["events"]> {
    const workspaceEvents = this.requireRuntimeFacade(workspaceId).events(input);
    if (!input?.includeAppEvents) {
      return workspaceEvents;
    }
    return Promise.all([
      workspaceEvents,
      this.getAppGlobalRuntimeFacade().then((facade) => facade.events(input)),
    ]).then((subscriptions) => mergeRuntimeEventSubscriptions(subscriptions)) as ReturnType<
      RuntimeFacade["events"]
    >;
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

  setActiveWorkspace(workspaceId: string): WorkspaceRuntime {
    const runtime = this.getRuntime(workspaceId);
    this.activeWorkspaceId = runtime.workspaceId;
    return runtime;
  }

  listOpenWorkspaces(): WorkspaceInfoResponse[] {
    return Array.from(this.runtimes.values()).map((runtime) => runtime.getInfo());
  }

  async closeWorkspace(workspaceId: string): Promise<boolean> {
    return this.releaseWorkspace(workspaceId);
  }

  async releaseWorkspace(workspaceId: string): Promise<boolean> {
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime) {
      return false;
    }

    runtime.refCount -= 1;
    if (runtime.refCount > 0) {
      if (this.activeWorkspaceId === workspaceId) {
        this.activeWorkspaceId = workspaceId;
      }
      return true;
    }

    this.runtimes.delete(workspaceId);
    await runtime.dispose();
    if (this.activeWorkspaceId === workspaceId) {
      const next = this.runtimes.keys().next().value as string | undefined;
      this.activeWorkspaceId = next ?? null;
    }
    return true;
  }

  private requireRuntimeFacade(workspaceId: string): RuntimeFacade {
    const facade = this.runtimeFacades.get(workspaceId);
    if (!facade) {
      throw new Error(`Workspace scope is not open: ${workspaceId}`);
    }
    return facade;
  }

  requestSourceInvalidationScan(reason: string): void {
    void this.appGlobalSourceInvalidationCoordinator.requestScan(reason);
    for (const runtime of this.runtimes.values()) {
      void runtime.sourceInvalidationCoordinator.requestScan(reason);
    }
  }

  async closeSourceInvalidationCoordinator(): Promise<void> {
    const appGlobalRuntime = this.appGlobalRuntime;
    this.appGlobalRuntime = null;
    await Promise.all([
      this.appGlobalSourceInvalidationCoordinator.close(),
      ...Array.from(this.runtimes.values()).map((runtime) =>
        runtime.sourceInvalidationCoordinator.close(),
      ),
      appGlobalRuntime?.then((runtime) => runtime.dispose()),
    ]);
  }

  private async createRuntime(
    workspaceId: string,
    cwd: string,
    kind: WorkspaceKind,
  ): Promise<RuntimeRecord> {
    const label = kind === "default" ? "Default Workspace" : basename(cwd) || "workspace";
    const sessionDir = getSvvySessionDir(cwd, this.agentDir);
    const commandStdin = createLiveCommandStdinRegistry();
    let catalog!: WorkspaceSessionCatalog;
    let resolveRuntimeForRecovery!: (runtime: CatalogBackedRuntime) => void;
    const runtimeForRecovery = new Promise<CatalogBackedRuntime>((resolve) => {
      resolveRuntimeForRecovery = resolve;
    });
    catalog = createRuntimeBackedWorkspaceSessionCatalog(
      cwd,
      this.agentDir,
      sessionDir,
      join(sessionDir, "namer"),
      workspaceId,
      {
        workflowsExtensionsGeneratedPackagePath:
          this.options.workflowsExtensionsGeneratedPackagePath,
        workflowsGeneratedPackagePath: this.options.workflowsGeneratedPackagePath,
        workflowsSourceRoot: this.options.workflowsSourceRoot,
        refreshGeneratedPackages: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.sourceInvalidation.refreshGeneratedPackages(request);
        },
        acquireExecuteTypescriptLaunch: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.launchFacts.acquireExecuteTypescript(request);
        },
        acquireDirectToolLaunch: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.launchFacts.acquireDirectToolLaunch(request);
        },
        runAcceptedLoadExtension: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.acceptedNativeTools.runLoadExtension(request);
        },
        runAcceptedRequestUserInput: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.acceptedNativeTools.runRequestUserInput(request);
        },
        requestDirectToolApproval: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.acceptedNativeTools.requestDirectToolApproval(request);
        },
      },
      undefined,
      undefined,
      commandStdin,
      this.options.runtimeLayerConfig,
    );
    const pathIndex = new WorkspacePathIndex(cwd);
    const agentSettingsStore = createAgentSettingsStore({
      cwd,
      agentDir: this.agentDir,
      workflowsSourceRoot: this.options.workflowsSourceRoot,
    });
    const appLogs = this.acquireAppLogFacade(cwd);
    const appLog = createAppLogger({
      appLogs,
      forwardBridgeLog: (level, message, source, details, error) => {
        this.options.forwardBridgeLog?.(level, message, source, { ...details, workspaceId }, error);
      },
    });
    const unsubscribeAppLog = appLog.subscribe((entries, summary) => {
      this.options.onAppLogUpdate?.(workspaceId, {
        workspaceId,
        entries,
        summary,
      });
    });
    appLog.info("app.lifecycle", "Workspace scope opened.", {
      workspaceId,
      kind,
      cwd,
    });

    catalog.setWorkspaceSyncListener((payload) => {
      this.options.onWorkspaceSync?.(workspaceId, {
        ...payload,
        workspaceId,
      });
    });
    catalog.setSurfaceSyncListener((payload) => {
      this.options.onSurfaceSync?.(workspaceId, {
        ...payload,
        workspaceId,
      });
    });
    catalog.setTitleGenerationLogListener((event) => {
      recordTitleGenerationLog(appLog, event);
    });
    catalog.setWorkflowsGeneratedPackageLogListener((event) => {
      for (const runtime of this.runtimes.values()) {
        recordWorkflowsGeneratedPackageLog(runtime.appLog, event);
      }
    });
    catalog.setAppLogListener((event) => {
      appendAppLoggerEvent(appLog, event);
    });
    const generatedPackageBoundaryHost = this.createGeneratedPackageRefreshBoundaryHost(catalog, {
      workspaceId,
      cwd,
    });
    const runtimeAdapter = await createCatalogBackedRuntime(
      {
        sourceRoots: generatedPackageBoundaryHost.sourceRoots,
        generatedPackageRoots: generatedPackageBoundaryHost.generatedPackageRoots,
        extensionStatePort: generatedPackageBoundaryHost.extensionStatePort,
        generatedPackageLinkPath: generatedPackageBoundaryHost.generatedPackageLinkPath,
        catalog,
        commandStdin,
        commandControl: commandStdin,
        generatedContextRefreshHost: {
          refresh: (input) => this.refreshGeneratedContext(input),
        },
        generatedPackageRefreshHost: {
          listAcquiredWorkspaceIds: generatedPackageBoundaryHost.listAcquiredWorkspaceIds,
          listRecoverableWorkspaceIds: generatedPackageBoundaryHost.listRecoverableWorkspaceIds,
          now: generatedPackageBoundaryHost.now,
          workspaceLinkFileHost: generatedPackageBoundaryHost.workspaceLinkFileHost,
          materializeCoreTypeContractPackage:
            generatedPackageBoundaryHost.materializeCoreTypeContractPackage,
        },
        generatedPackageStatePort: this.createGeneratedPackageStatePort(catalog, {
          workspaceId,
          cwd,
        }),
        sourceInvalidationScan: this.createSourceInvalidationScanPort(),
        appLogWritePort: appLogs.writePort,
        sandboxHostSupport: this.options.sandboxHostSupport,
      },
      this.runtimeDependencies(),
      this.options.runtimeLayerConfig,
    );
    resolveRuntimeForRecovery(runtimeAdapter);
    this.runtimeFacades.set(workspaceId, runtimeAdapter.facade);
    const sourceInvalidationCoordinator = createRuntimeSourceInvalidationCoordinatorHandle({
      debounceMs: this.options.runtimeLayerConfig.sourceDebounceMs,
      host: this.sourceInvalidationHost,
      maxCoalescingLatencyMs: this.options.runtimeLayerConfig.sourceMaxCoalescingLatencyMs,
      readInputs: () =>
        buildWorkspaceSourceWatchInputs({
          cwd,
          externalInstructions: agentSettingsStore.getState().appPreferences.externalInstructions,
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
          appLog.info("source.graph", "Source inputs changed.", {
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
      reconciliationIntervalMs: this.options.runtimeLayerConfig.workspaceSourceReconcileIntervalMs,
      retryInitialDelayMs: this.options.runtimeLayerConfig.sourceRetryInitialDelayMs,
      retryMaxAttempts: this.options.runtimeLayerConfig.sourceRetryMaxAttempts,
      retryMaxDelayMs: this.options.runtimeLayerConfig.sourceRetryMaxDelayMs,
      watchEnabled: this.options.sourceWatchEnabled,
    });
    await sourceInvalidationCoordinator.ready();
    const runtime: RuntimeRecord = {
      workspaceId,
      cwd,
      label,
      kind,
      openedAt: new Date().toISOString(),
      refCount: 1,
      catalog,
      pathIndex,
      agentSettingsStore,
      appLogs,
      appLog,
      sourceInvalidationCoordinator,
      unsubscribeAppLog,
      getInfo: () => ({
        workspaceId,
        cwd,
        workspaceLabel: label,
        kind,
      }),
      dispose: async () => {
        appLog.info("app.lifecycle", "Workspace scope closed.", {
          workspaceId,
          kind,
          cwd,
        });
        unsubscribeAppLog();
        catalog.setWorkspaceSyncListener(null);
        catalog.setSurfaceSyncListener(null);
        catalog.setTitleGenerationLogListener(null);
        catalog.setWorkflowsGeneratedPackageLogListener(null);
        catalog.setAppLogListener(null);
        this.runtimeFacades.delete(workspaceId);
        await sourceInvalidationCoordinator.close();
        await runtimeAdapter.dispose();
        await catalog.dispose();
        this.releaseAppLogFacade(cwd);
      },
    };
    return runtime;
  }

  private async getAppGlobalRuntimeFacade(): Promise<RuntimeFacade> {
    return (await this.getAppGlobalRuntimeRecord()).facade;
  }

  private async getAppGlobalRuntimeRecord(): Promise<AppGlobalRuntimeRecord> {
    if (!this.appGlobalRuntime) {
      this.appGlobalRuntime = this.createAppGlobalRuntime();
    }
    return await this.appGlobalRuntime;
  }

  private async createAppGlobalRuntime(): Promise<AppGlobalRuntimeRecord> {
    const cwd = canonicalizeWorkspaceCwd(getDefaultWorkspaceCwd(this.appDataDir));
    const workspaceId = normalizeWorkspaceRuntimeId(cwd);
    const sessionDir = getSvvySessionDir(cwd, this.agentDir);
    const commandStdin = createLiveCommandStdinRegistry();
    let resolveRuntimeForRecovery!: (runtime: CatalogBackedRuntime) => void;
    const runtimeForRecovery = new Promise<CatalogBackedRuntime>((resolve) => {
      resolveRuntimeForRecovery = resolve;
    });
    const catalog = createRuntimeBackedWorkspaceSessionCatalog(
      cwd,
      this.agentDir,
      sessionDir,
      join(sessionDir, "namer"),
      workspaceId,
      {
        workflowsExtensionsGeneratedPackagePath:
          this.options.workflowsExtensionsGeneratedPackagePath,
        workflowsGeneratedPackagePath: this.options.workflowsGeneratedPackagePath,
        workflowsSourceRoot: this.options.workflowsSourceRoot,
        refreshGeneratedPackages: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.sourceInvalidation.refreshGeneratedPackages(request);
        },
        acquireExecuteTypescriptLaunch: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.launchFacts.acquireExecuteTypescript(request);
        },
        acquireDirectToolLaunch: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.launchFacts.acquireDirectToolLaunch(request);
        },
        runAcceptedLoadExtension: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.acceptedNativeTools.runLoadExtension(request);
        },
        runAcceptedRequestUserInput: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.acceptedNativeTools.runRequestUserInput(request);
        },
        requestDirectToolApproval: async (request) => {
          const runtime = await runtimeForRecovery;
          return runtime.internal.acceptedNativeTools.requestDirectToolApproval(request);
        },
      },
      undefined,
      undefined,
      commandStdin,
      this.options.runtimeLayerConfig,
    );
    const appLogs = this.acquireAppLogFacade(cwd);
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
      for (const runtime of this.runtimes.values()) {
        recordWorkflowsGeneratedPackageLog(runtime.appLog, event);
      }
    });
    catalog.setAppLogListener((event) => {
      appendAppLoggerEvent(appLog, event);
    });

    const generatedPackageBoundaryHost = this.createGeneratedPackageRefreshBoundaryHost(catalog, {
      workspaceId,
      cwd,
    });
    const runtimeAdapter = await createCatalogBackedRuntime(
      {
        sourceRoots: generatedPackageBoundaryHost.sourceRoots,
        generatedPackageRoots: generatedPackageBoundaryHost.generatedPackageRoots,
        extensionStatePort: generatedPackageBoundaryHost.extensionStatePort,
        generatedPackageLinkPath: generatedPackageBoundaryHost.generatedPackageLinkPath,
        catalog,
        commandStdin,
        commandControl: commandStdin,
        generatedContextRefreshHost: {
          refresh: (input) => this.refreshGeneratedContext(input),
        },
        generatedPackageRefreshHost: {
          listAcquiredWorkspaceIds: generatedPackageBoundaryHost.listAcquiredWorkspaceIds,
          listRecoverableWorkspaceIds: generatedPackageBoundaryHost.listRecoverableWorkspaceIds,
          now: generatedPackageBoundaryHost.now,
          workspaceLinkFileHost: generatedPackageBoundaryHost.workspaceLinkFileHost,
          materializeCoreTypeContractPackage:
            generatedPackageBoundaryHost.materializeCoreTypeContractPackage,
        },
        generatedPackageStatePort: this.createGeneratedPackageStatePort(catalog, {
          workspaceId,
          cwd,
        }),
        sourceInvalidationScan: this.createSourceInvalidationScanPort(),
        appLogWritePort: appLogs.writePort,
        sandboxHostSupport: this.options.sandboxHostSupport,
      },
      this.runtimeDependencies(),
      this.options.runtimeLayerConfig,
    );
    resolveRuntimeForRecovery(runtimeAdapter);

    return {
      facade: runtimeAdapter.facade,
      sourceStatePort: catalog.getRuntimeSourceStatePort(),
      dispose: async () => {
        catalog.setTitleGenerationLogListener(null);
        catalog.setWorkflowsGeneratedPackageLogListener(null);
        catalog.setAppLogListener(null);
        await runtimeAdapter.dispose();
        await catalog.dispose();
        this.releaseAppLogFacade(cwd);
      },
    };
  }

  private createSourceInvalidationScanPort(): RuntimeSourceInvalidationScanPortService {
    return {
      classifyHint: (input) =>
        Effect.tryPromise({
          try: async () => {
            if (input.scope.kind === "app-global") {
              return await this.appGlobalSourceInvalidationCoordinator.classifyHint(input);
            }
            const runtime = this.runtimes.get(input.scope.workspaceId);
            if (!runtime) {
              throw new RuntimeContractError({
                operation: "runtime.sourceInvalidation.hint",
                reason: "target-not-found",
                message: `Workspace source invalidation requires an acquired workspace scope for ${input.scope.workspaceId}.`,
              });
            }
            return await runtime.sourceInvalidationCoordinator.classifyHint(input);
          },
          catch: (cause: unknown) =>
            runtimeRegistrySourceInvalidationError("runtime.sourceInvalidation.hint", cause),
        }),
      listAcquiredWorkspaceIds: () =>
        Effect.succeed(
          Array.from(this.runtimes.values()).map((runtime) => runtime.workspaceId as WorkspaceId),
        ),
      reconcile: (input) =>
        Effect.tryPromise({
          try: async () => {
            if (input.scope.kind === "app-global") {
              return await this.appGlobalSourceInvalidationCoordinator.reconcile({
                domains: input.domains,
                reason: `runtime_source_reconcile:${input.reason}`,
              });
            }
            const runtime = this.runtimes.get(input.scope.workspaceId);
            if (!runtime) {
              throw new RuntimeContractError({
                operation: "runtime.sourceInvalidation.reconcile",
                reason: "target-not-found",
                message: `Workspace source invalidation requires an acquired workspace scope for ${input.scope.workspaceId}.`,
              });
            }
            return await runtime.sourceInvalidationCoordinator.reconcile({
              domains: input.domains,
              reason: `runtime_source_reconcile:${input.reason}`,
            });
          },
          catch: (cause: unknown) =>
            runtimeRegistrySourceInvalidationError("runtime.sourceInvalidation.reconcile", cause),
        }),
      requestScan: (input) =>
        Effect.tryPromise({
          try: async () => {
            const request = {
              domains: input.domains,
              reason: `runtime_source_hint:${input.reason}`,
            };
            if (input.scope.kind === "app-global") {
              await this.appGlobalSourceInvalidationCoordinator.requestScan(request);
              return;
            }
            const runtime = this.runtimes.get(input.scope.workspaceId);
            if (!runtime) {
              throw new RuntimeContractError({
                operation: "runtime.sourceInvalidation.hint",
                reason: "target-not-found",
                message: `Workspace source invalidation requires an acquired workspace scope for ${input.scope.workspaceId}.`,
              });
            }
            await runtime.sourceInvalidationCoordinator.requestScan(request);
          },
          catch: (cause: unknown) =>
            runtimeRegistrySourceInvalidationError("runtime.sourceInvalidation.hint", cause),
        }),
    };
  }

  private async handleSourceInvalidationEvent(
    input: RuntimeSourceInvalidationReactionInput,
  ): Promise<void> {
    const { event } = input;
    try {
      const facade =
        input.scope.kind === "app-global"
          ? await this.getAppGlobalRuntimeFacade()
          : this.requireRuntimeFacade(input.scope.workspaceId);
      const result = await facade.sourceInvalidation.applyCommittedScanEvent(input);

      for (const refresh of result.generatedPackageRefreshes) {
        for (const status of refresh.packages) {
          for (const runtime of this.runtimes.values()) {
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
    }
  }

  private async refreshGeneratedContext(input: RefreshGeneratedContextRequest): Promise<void> {
    if (input.scope === "workspace") {
      const runtime = this.getRuntime(input.workspaceId);
      await runtime.catalog.notifySourceInputsChanged(`runtime_refresh:${input.reason}`);
      return;
    }

    await Promise.all(
      Array.from(this.runtimes.values()).map((runtime) =>
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
          getWorkflowsSourceRoot()) as AbsolutePath,
      },
      generatedPackageRoots: {
        extensionsPackageRoot: effectiveExtensionsGeneratedPackagePath({
          extensionsGeneratedPackagePath: this.options.workflowsExtensionsGeneratedPackagePath,
          generatedPackagePath: this.options.workflowsGeneratedPackagePath,
        }) as AbsolutePath,
        workflowsPackageRoot: (this.options.workflowsGeneratedPackagePath ??
          getWorkflowsGeneratedPackagePath()) as AbsolutePath,
        coreTypeContractPackageRoot: (this.options.coreTypeContractPackagePath ??
          getCoreTypeContractPackagePath()) as AbsolutePath,
      },
      extensionStatePort: catalog.getExtensionStatePort(),
      listAcquiredWorkspaceIds: () =>
        Effect.succeed(
          Array.from(this.runtimes.values()).map((runtime) => runtime.workspaceId as WorkspaceId),
        ),
      listRecoverableWorkspaceIds: () =>
        Effect.succeed(
          this.options
            .listRecoverableWorkspaces?.()
            .filter((workspace) => workspace.kind === "user")
            .map((workspace) => workspace.workspaceId as WorkspaceId) ?? [],
        ),
      now: () => Effect.succeed(new Date().toISOString() as IsoDateTimeString),
      generatedPackageLinkPath: async ({ packageName, workspaceId }) => {
        const runtimeCwd =
          workspaceId === startupWorkspace.workspaceId
            ? startupWorkspace.cwd
            : this.getRuntime(workspaceId).cwd;
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
    currentWorkspace: { workspaceId: string; cwd: string },
  ): RuntimeGeneratedPackageStatePortService {
    const base = catalog.getRuntimeGeneratedPackageStatePort();
    return {
      ...base,
      markWorkspaceLinksRepairNeeded: (input) => {
        if (input.workspaceId === currentWorkspace.workspaceId) {
          return base.markWorkspaceLinksRepairNeeded(input);
        }

        const acquiredRuntime = this.runtimes.get(input.workspaceId);
        if (acquiredRuntime) {
          return acquiredRuntime.catalog
            .getRuntimeGeneratedPackageStatePort()
            .markWorkspaceLinksRepairNeeded(input);
        }

        const recoverableWorkspace = this.findRecoverableWorkspace(input.workspaceId);
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
    };
  }

  private findRecoverableWorkspace(workspaceId: WorkspaceId): WorkspaceInfoResponse | null {
    return (
      this.options
        .listRecoverableWorkspaces?.()
        .find((workspace) => workspace.workspaceId === workspaceId && workspace.kind === "user") ??
      null
    );
  }

  private runtimeDependencies(): CatalogBackedRuntimeDependencies {
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
    const agentSettingsStore = createAgentSettingsStore({
      cwd: workspaceCwd,
      agentDir: this.agentDir,
      workflowsSourceRoot: this.options.workflowsSourceRoot,
    });
    return {
      digest: {
        sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
      },
      idFactory: (prefix: string) => `${prefix}-${randomUUID()}`,
      now: () => new Date().toISOString(),
      workspace: {
        id: workspace.workspaceId,
        label: workspace.workspaceLabel,
        cwd: workspaceCwd,
        artifactDir: resolveConfiguredArtifactDirectory(
          agentSettingsStore.getState().appPreferences.artifactDirectory,
          workspaceCwd,
        ),
      },
      databasePath: join(sessionDir, STRUCTURED_SESSION_DB_FILENAME),
    };
  }

  private acquireAppLogFacade(cwd: string): StateAppLogsFacade {
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
      now: () => new Date().toISOString(),
    });
    this.sharedAppLogFacades.set(cwd, {
      appLogs,
      refCount: 1,
    });
    return appLogs;
  }

  private releaseAppLogFacade(cwd: string): void {
    const existing = this.sharedAppLogFacades.get(cwd);
    if (!existing) return;
    existing.refCount -= 1;
    if (existing.refCount > 0) return;
    this.sharedAppLogFacades.delete(cwd);
    existing.appLogs.close();
  }
}

function sanitizeWorkspaceRuntimeStorageKey(value: string): string {
  return value.replace(/^[/\\]/, "").replace(/[/\\:#]/g, "-");
}

function mergeRuntimeEventSubscriptions(
  subscriptions: Array<Awaited<ReturnType<RuntimeFacade["events"]>>>,
): Awaited<ReturnType<RuntimeFacade["events"]>> {
  let closed = false;
  return {
    closed: Promise.all(subscriptions.map((subscription) => subscription.closed)).then(
      ([receipt]) => receipt!,
    ),
    async close() {
      closed = true;
      await Promise.all(subscriptions.map((subscription) => subscription.close()));
    },
    async *[Symbol.asyncIterator]() {
      const slots = subscriptions.map((subscription) => {
        const iterator = subscription[Symbol.asyncIterator]();
        return {
          iterator,
          next: iterator.next(),
        };
      });
      try {
        while (slots.length > 0) {
          if (closed) break;
          const { slotIndex, nextResult } = await Promise.race(
            slots.map((slot, candidateIndex) =>
              slot.next.then((candidateResult) => ({
                slotIndex: candidateIndex,
                nextResult: candidateResult,
              })),
            ),
          );
          if (closed) break;
          if (nextResult.done) {
            slots.splice(slotIndex, 1);
            continue;
          }
          slots[slotIndex]!.next = slots[slotIndex]!.iterator.next();
          yield nextResult.value;
        }
      } finally {
        await Promise.all(
          slots.map((slot) =>
            typeof slot.iterator.return === "function"
              ? slot.iterator.return().then(() => undefined)
              : Promise.resolve(),
          ),
        );
      }
    },
  };
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
