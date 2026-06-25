import { basename, join } from "node:path";
import { createHash } from "node:crypto";
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
  buildAppGlobalSourceWatchInputs,
  buildWorkspaceSourceWatchInputs,
  type SourceInvalidationEvent,
  type SourceInvalidationHost,
  generatedContextReasonForRuntimeSourceInvalidation,
  generatedPackagesForRuntimeSourceInvalidation,
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
} from "@svvy/runtime/bootstrap";
import {
  RuntimeContractError,
  type AbsolutePath,
  type GeneratedPackagesRefreshResult,
  type RefreshGeneratedContextRequest,
  type RefreshGeneratedPackagesRequest,
  type OpenExtensionSourceEditInput,
  type SaveExtensionSourceEditInput,
  type SourceEditSaveResult,
  type SourceEditSession,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type SourceReconcileResult,
  type StateInvalidationDescriptor,
  type RuntimeEvent,
  type RuntimeGeneratedPackageStatePortService,
  type WorkspaceId,
} from "@svvy/core";
import type {
  AppLogUpdateMessage,
  SurfaceSyncMessage,
  WorkspaceInfoResponse,
  WorkspaceKind,
  WorkspaceSyncMessage,
} from "../shared/workspace-contract";
import { appendAppLoggerEvent, createAppLogger, type BridgeLogLevel } from "./app-logger";
import { createAppLogFacade, type AppLogFacade } from "@svvy/state";
import { createAgentSettingsStore } from "./agent-settings-store";
import {
  getSvvySessionDir,
  getSvvyAgentDir,
  getSvvyDataDir,
  WorkspaceSessionCatalog,
  type TitleGenerationLogEvent,
  type WorkflowsGeneratedPackageLogEvent,
} from "./session-catalog";
import { extensionsRootForAgentDir } from "./generated-agent-context-aggregate-cache";
import {
  getWorkflowsGeneratedPackagePath,
  getWorkflowsSourceRoot,
} from "./smithers-runtime/workflow-library";
import {
  effectiveExtensionsGeneratedPackagePath,
  sourceBuildFingerprint,
} from "./generated-extensions-package";
import {
  readBuiltinExtensionsInventory,
  writeExtensionInstructionFile,
} from "./svvyx-extensions-command";
import { ExtensionDependencyApprovalStore } from "./extension-dependency-approval-store";
import { canonicalizeWorkspaceCwd, getDefaultWorkspaceCwd } from "./workspace-context";
import { WorkspacePathIndex } from "./workspace-path-index";
import {
  createRuntimeSourceInvalidationCoordinatorHandle,
  createCatalogBackedRuntime,
  createNodeSourceInvalidationHost,
  createRuntimeEventBusHandle,
  refreshRuntimeGeneratedPackagesAtRuntimeBoundary,
  type CatalogBackedRuntime,
  type CatalogBackedRuntimeDependencies,
  type RuntimeSourceInvalidationCoordinatorHandle,
} from "./runtime-service-adapter";
import { createLiveCommandStdinRegistry } from "./live-command-stdin-registry";

type RuntimeFacade = CatalogBackedRuntime["facade"];

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

function sourceEditContractError(
  operation: string,
  reason: RuntimeContractError["reason"],
  message: string,
): RuntimeContractError {
  return new RuntimeContractError({ operation, reason, message });
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
  onAppLogUpdate?: (workspaceId: string, payload: AppLogUpdateMessage) => void;
  onSurfaceSync?: (workspaceId: string, payload: SurfaceSyncMessage) => void;
  onWorkspaceSync?: (workspaceId: string, payload: WorkspaceSyncMessage) => void;
  runtimeDependencies?: Partial<CatalogBackedRuntimeDependencies>;
  sourceInvalidationHost?: SourceInvalidationHost;
  sourceWatchEnabled?: boolean;
  workflowsGeneratedPackagePath?: string;
  workflowsExtensionsGeneratedPackagePath?: string;
  workflowsSourceRoot?: string;
};

type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends { sequence: number }
    ? Omit<Event, "eventGenerationId" | "sequence">
    : never
  : never;

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
  appLogs: AppLogFacade;
  appLog: ReturnType<typeof createAppLogger>;
  runtimeFacade: RuntimeFacade;
  getInfo: () => WorkspaceInfoResponse;
  dispose: () => Promise<void>;
};

type RuntimeRecord = WorkspaceRuntime & {
  refCount: number;
  sourceInvalidationCoordinator: RuntimeSourceInvalidationCoordinatorHandle;
  unsubscribeAppLog: () => void;
};

export class WorkspaceRuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly pendingRuntimes = new Map<string, Promise<RuntimeRecord>>();
  private readonly startupReady: Promise<void>;
  private readonly sharedAppLogFacades = new Map<
    string,
    {
      appLogs: AppLogFacade;
      refCount: number;
    }
  >();
  private readonly agentDir: string;
  private readonly appDataDir: string;
  private readonly sourceInvalidationHost: SourceInvalidationHost;
  private readonly appGlobalSourceInvalidationCoordinator: RuntimeSourceInvalidationCoordinatorHandle;
  private readonly runtimeEventBus = createRuntimeEventBusHandle();
  private activeWorkspaceId: string | null = null;

  constructor(private readonly options: WorkspaceRuntimeRegistryOptions) {
    this.agentDir = options.agentDir ?? getSvvyAgentDir();
    this.appDataDir = options.appDataDir ?? getSvvyDataDir();
    this.sourceInvalidationHost =
      options.sourceInvalidationHost ?? createNodeSourceInvalidationHost();
    this.appGlobalSourceInvalidationCoordinator = createRuntimeSourceInvalidationCoordinatorHandle({
      host: this.sourceInvalidationHost,
      readInputs: () =>
        buildAppGlobalSourceWatchInputs({
          extensionsRoot: extensionsRootForAgentDir(this.agentDir),
          host: this.sourceInvalidationHost,
          workflowsSourceRoot: this.options.workflowsSourceRoot ?? getWorkflowsSourceRoot(),
        }),
      onDomainsChanged: (event) =>
        Effect.promise(async () => {
          await this.handleSourceInvalidationEvent(event);
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
      watchEnabled: this.options.sourceWatchEnabled,
    });
    this.startupReady = this.appGlobalSourceInvalidationCoordinator.ready().then(async () => {
      if (!options.openInitialWorkspace) {
        return;
      }
      const runtime = await this.acquireWorkspace(options.initialCwd);
      this.activeWorkspaceId = runtime.workspaceId;
    });
  }

  private async openExtensionSourceEdit(
    agentSettingsStore: ReturnType<typeof createAgentSettingsStore>,
    catalog: WorkspaceSessionCatalog,
    cwd: string,
    input: OpenExtensionSourceEditInput,
  ): Promise<SourceEditSession> {
    const inventory = await readBuiltinExtensionsInventory({
      agentSettingsStore,
      cwd,
      extensionsRoot: catalog.getExtensionsRoot(),
      externalInstructionSources: await catalog.getGeneratedAgentContextExternalSources(),
      includeUserExtensions: true,
    });
    const extension = inventory.extensions.find((candidate) => candidate.id === input.sourceId);
    if (!extension) {
      throw sourceEditContractError(
        "runtime.sourceEdits.open",
        "target-not-found",
        `Extension source does not exist: ${input.sourceId}`,
      );
    }
    const expectedCategory =
      input.sourceKind === "builtin-extension"
        ? "builtin"
        : input.sourceKind === "user-extension"
          ? "user"
          : null;
    if (!expectedCategory || extension.category !== expectedCategory) {
      throw sourceEditContractError(
        "runtime.sourceEdits.open",
        "read-only-source",
        `Source kind ${input.sourceKind} is not editable through the extension source edit facade.`,
      );
    }
    const minimal = extension.minimalInstruction;
    if (!minimal?.editable || !minimal.path) {
      throw sourceEditContractError(
        "runtime.sourceEdits.open",
        "read-only-source",
        `Extension source is not editable: ${input.sourceId}`,
      );
    }
    return {
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      path: minimal.path as AbsolutePath,
      sourceVersion: minimal.sourceVersion,
      fingerprint: minimal.sourceVersion,
      text: minimal.content,
      diagnostics: [],
    };
  }

  private async saveExtensionSourceEdit(
    agentSettingsStore: ReturnType<typeof createAgentSettingsStore>,
    catalog: WorkspaceSessionCatalog,
    cwd: string,
    input: SaveExtensionSourceEditInput,
  ): Promise<SourceEditSaveResult> {
    const current = await this.openExtensionSourceEdit(agentSettingsStore, catalog, cwd, input);
    if (
      input.saveMode === "compare-and-swap" &&
      current.sourceVersion !== input.expectedSourceVersion
    ) {
      return { status: "stale", current };
    }
    const written = writeExtensionInstructionFile({
      extensionId: input.sourceId,
      file: "minimal.md",
      kind: "minimal",
      content: input.text,
      baseSourceVersion: input.expectedSourceVersion,
      mode: input.saveMode,
      extensionsRoot: catalog.getExtensionsRoot(),
    });
    return {
      status: "saved",
      sourceVersion: written.sourceVersion,
      fingerprint: written.sourceVersion,
      diagnostics: [],
      reconcileRequired: true,
    };
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

  requestSourceInvalidationScan(reason: string): void {
    void this.appGlobalSourceInvalidationCoordinator.requestScan(reason);
    for (const runtime of this.runtimes.values()) {
      void runtime.sourceInvalidationCoordinator.requestScan(reason);
    }
  }

  async closeSourceInvalidationCoordinator(): Promise<void> {
    await Promise.all([
      this.appGlobalSourceInvalidationCoordinator.close(),
      ...Array.from(this.runtimes.values()).map((runtime) =>
        runtime.sourceInvalidationCoordinator.close(),
      ),
    ]);
  }

  async closeRuntimeEventBus(): Promise<void> {
    await this.runtimeEventBus.close();
  }

  private async createRuntime(
    workspaceId: string,
    cwd: string,
    kind: WorkspaceKind,
  ): Promise<RuntimeRecord> {
    const label = kind === "default" ? "Default Workspace" : basename(cwd) || "workspace";
    const sessionDir = getSvvySessionDir(cwd, this.agentDir);
    const commandStdin = createLiveCommandStdinRegistry();
    const catalog = new WorkspaceSessionCatalog(
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
      },
      undefined,
      undefined,
      commandStdin,
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
      void this.publishRuntimeEvent({
        type: "workspace_read_model.changed",
        workspaceId: workspaceId as WorkspaceId,
        invalidation: { model: "appLogs" },
      });
    });
    appLog.info("app.lifecycle", "Workspace runtime opened.", {
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
    catalog.setOpenWorkspaceCwdsReader(() =>
      this.listOpenWorkspaces().map((workspace) => workspace.cwd),
    );
    const runtimeAdapter = await createCatalogBackedRuntime(
      {
        catalog,
        sourceEdits: {
          open: (input) => this.openExtensionSourceEdit(agentSettingsStore, catalog, cwd, input),
          save: (input) => this.saveExtensionSourceEdit(agentSettingsStore, catalog, cwd, input),
        },
        events: (input) => this.runtimeEventBus.events(input),
        publishStateInvalidations: (input) => this.runtimeEventBus.publishStateInvalidations(input),
        commandStdin,
        commandControl: commandStdin,
        sourceInvalidation: {
          hint: (input) => this.handleSourceInvalidationHint(workspaceId, input),
          reconcile: (input) => this.reconcileSourceInvalidation(workspaceId, input),
          refreshGeneratedContext: (input) => this.refreshGeneratedContext(input),
          refreshGeneratedPackages: (input) => this.refreshGeneratedPackages(workspaceId, input),
        },
        appLog,
      },
      {
        ensureUsableProviderAuth:
          this.options.runtimeDependencies?.ensureUsableProviderAuth ??
          (async () => "test-provider-auth"),
        getProviderAuthUnavailableMessage:
          this.options.runtimeDependencies?.getProviderAuthUnavailableMessage ??
          ((provider) => `No provider auth available for ${provider}.`),
        recordDevBrowserToolsEvent:
          this.options.runtimeDependencies?.recordDevBrowserToolsEvent ?? (() => {}),
      },
    );
    const sourceInvalidationCoordinator = createRuntimeSourceInvalidationCoordinatorHandle({
      host: this.sourceInvalidationHost,
      readInputs: () =>
        buildWorkspaceSourceWatchInputs({
          cwd,
          externalInstructions: agentSettingsStore.getState().appPreferences.externalInstructions,
          host: this.sourceInvalidationHost,
        }),
      onDomainsChanged: (event) =>
        Effect.promise(async () => {
          await this.handleSourceInvalidationEvent(event);
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
      runtimeFacade: runtimeAdapter.facade,
      sourceInvalidationCoordinator,
      unsubscribeAppLog,
      getInfo: () => ({
        workspaceId,
        cwd,
        workspaceLabel: label,
        kind,
      }),
      dispose: async () => {
        appLog.info("app.lifecycle", "Workspace runtime closed.", {
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
        catalog.setOpenWorkspaceCwdsReader(null);
        await sourceInvalidationCoordinator.close();
        await runtimeAdapter.dispose();
        await catalog.dispose();
        this.releaseAppLogFacade(cwd);
      },
    };
    return runtime;
  }

  private async publishRuntimeEvent(event: RuntimeEventDraft): Promise<void> {
    try {
      await this.runtimeEventBus.publish(event);
    } catch (error) {
      this.options.forwardBridgeLog?.(
        "warn",
        "Runtime event publication failed.",
        "runtime.events",
        {},
        error,
      );
    }
  }

  private async handleSourceInvalidationHint(
    workspaceId: string,
    input: SourceInvalidationHint,
  ): Promise<void> {
    const reason = `runtime_source_hint:${input.domain}`;
    if (input.scope.kind === "app-global") {
      await this.appGlobalSourceInvalidationCoordinator.requestScan(reason);
      return;
    }
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime) {
      throw new Error(`Workspace is not open: ${workspaceId}`);
    }
    await runtime.sourceInvalidationCoordinator.requestScan(reason);
  }

  private async handleSourceInvalidationEvent(event: SourceInvalidationEvent): Promise<void> {
    const packageRefresh = generatedPackagesForRuntimeSourceInvalidation(event.domains);
    if (packageRefresh.length > 0) {
      for (const runtime of this.runtimes.values()) {
        runtime.appLog.info(
          "workflow.library",
          "Source invalidation started generated package refresh.",
          {
            domains: event.domains,
            reason: event.reason,
            packages: packageRefresh,
          },
        );
      }
      const ownerRuntime = this.runtimes.values().next().value;
      if (!ownerRuntime) {
        return;
      }
      const refresh = await this.refreshGeneratedPackages(ownerRuntime.workspaceId, {
        scope: "app-global",
        packages: packageRefresh,
        reason: "source-changed",
      });
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

    const contextRefreshReason = generatedContextReasonForRuntimeSourceInvalidation(event.domains);
    if (contextRefreshReason) {
      await Promise.all(
        Array.from(this.runtimes.values()).map((runtime) =>
          this.refreshGeneratedContext({
            scope: "workspace",
            workspaceId: runtime.workspaceId as WorkspaceId,
            reason: contextRefreshReason,
          }),
        ),
      );
    }
  }

  private async reconcileSourceInvalidation(
    workspaceId: string,
    input: SourceReconcileRequest,
  ): Promise<SourceReconcileResult> {
    const reason = `runtime_source_reconcile:${input.reason}`;
    if (input.scope.kind === "app-global") {
      await this.appGlobalSourceInvalidationCoordinator.requestScan(reason);
    } else {
      const runtime = this.runtimes.get(workspaceId);
      if (!runtime) {
        throw new Error(`Workspace is not open: ${workspaceId}`);
      }
      await runtime.sourceInvalidationCoordinator.requestScan(reason);
    }
    return {
      changedReadModelCount: 0,
      generatedPackageRefreshes: [],
      recoveryWorkIds: [],
    };
  }

  private async publishStateInvalidations(afterCommit: readonly StateInvalidationDescriptor[]) {
    if (afterCommit.length === 0) {
      return;
    }
    try {
      await this.runtimeEventBus.publishStateInvalidations({ afterCommit });
    } catch (error) {
      this.options.forwardBridgeLog?.(
        "warn",
        "Runtime state invalidation publication failed.",
        "runtime.events",
        {},
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

  private async refreshGeneratedPackages(
    ownerWorkspaceId: string,
    input: RefreshGeneratedPackagesRequest,
  ): Promise<GeneratedPackagesRefreshResult> {
    const extensionsRoot = extensionsRootForAgentDir(this.agentDir);
    const extensionDependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
    });
    const invalidations: StateInvalidationDescriptor[] = [];
    const ownerRuntime = this.getRuntime(ownerWorkspaceId);
    const generatedPackageStatePort = ownerRuntime.catalog.getRuntimeGeneratedPackageStatePort();
    const extensionStatePort = ownerRuntime.catalog.getExtensionStatePort({
      records: {
        readSourceFingerprint: ({ sourceRoot }) =>
          Effect.sync(() => sourceBuildFingerprint(sourceRoot)),
      },
      dependencies: {
        isApproved: ({ dependency }) =>
          Effect.sync(() => extensionDependencyApprovalStore.hasApproved(dependency)),
      },
    });
    const collectAfterCommit = <A extends { afterCommit: readonly StateInvalidationDescriptor[] }>(
      result: A,
    ): A => {
      invalidations.push(...result.afterCommit);
      return result;
    };
    const notifyingGeneratedPackageStatePort: RuntimeGeneratedPackageStatePortService = {
      ...generatedPackageStatePort,
      recordGeneratedPackageBuild: (recordInput) =>
        generatedPackageStatePort
          .recordGeneratedPackageBuild(recordInput)
          .pipe(Effect.map(collectAfterCommit)),
      recordGeneratedPackageFailure: (recordInput) =>
        generatedPackageStatePort
          .recordGeneratedPackageFailure(recordInput)
          .pipe(Effect.map(collectAfterCommit)),
      recordWorkspaceLinkStatus: (recordInput) =>
        generatedPackageStatePort
          .recordWorkspaceLinkStatus(recordInput)
          .pipe(Effect.map(collectAfterCommit)),
    };
    return await refreshRuntimeGeneratedPackagesAtRuntimeBoundary({
      request: input,
      generatedPackageStatePort: notifyingGeneratedPackageStatePort,
      host: {
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
        },
        extensionStatePort,
        generatedPackageLinkPath: async ({ packageName, workspaceId }) => {
          const runtime = this.getRuntime(workspaceId);
          const packageBasename = packageName === "@svvyx/workflows" ? "workflows" : "extensions";
          return join(
            runtime.cwd,
            ".smithers",
            "node_modules",
            "@svvyx",
            packageBasename,
          ) as AbsolutePath;
        },
        workspaceLinkFileHost: nodeGeneratedPackageWorkspaceLinkFileHost,
      },
    }).then(async (result) => {
      await this.publishStateInvalidations(invalidations);
      return result;
    });
  }

  private acquireAppLogFacade(cwd: string): AppLogFacade {
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
    const appLogs = createAppLogFacade({
      databasePath: join(runtimeDir, "app-logs-v1.sqlite"),
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

function normalizeWorkspaceRuntimeId(cwd: string): string {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 24);
  return `workspace:${hash}`;
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
    "workflowLinkedWorkspaceCount",
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
