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
  type ExtensionStatePortService,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type IsoDateTimeString,
  type PromptTarget,
  type RuntimeEvent,
  type RefreshGeneratedContextRequest,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeSourceStatePortService,
  type RuntimeOwnerId,
  type WorkspaceId,
} from "@svvy/core";
import type { ExtensionSourceRoots, GeneratedPackageRoots } from "@svvy/extensions";
import type {
  AppLogUpdateMessage,
  SurfaceStreamPatch,
  SurfaceSyncMessage,
  WorkspaceInfoResponse,
  WorkspaceKind,
  WorkspaceSyncMessage,
} from "../shared/workspace-contract";
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
import type { AppWorkspaceTabsStore } from "./app-workspace-tabs-store";

type WorkspaceGeneratedPackageBoundaryHost = RuntimeGeneratedPackageRefreshBoundaryHost & {
  readonly sourceRoots: ExtensionSourceRoots;
  readonly generatedPackageRoots: GeneratedPackageRoots;
  readonly extensionStatePort: ExtensionStatePortService;
  generatedPackageLinkPath(input: GeneratedPackageWorkspaceLinkRepairInput): Promise<AbsolutePath>;
};

type RuntimeFacade = AppRuntimeBootstrap["facade"];
type RuntimeEventSubscription = Awaited<ReturnType<RuntimeFacade["events"]>>;
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
  readonly ambientResources: unknown;
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
  appWorkspaceTabsStore?: AppWorkspaceTabsStore;
  runtimeDependencies?: Partial<RuntimeProviderAuthDependencies>;
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
  commandStdin: ReturnType<typeof createLiveCommandStdinRegistry>;
  sourceInvalidationCoordinator: RuntimeSourceInvalidationCoordinatorHandle;
  unsubscribeAppLog: () => void;
  unsubscribeRuntimeEvents: () => void;
};

type AppGlobalHostRecord = {
  workspaceId: string;
  cwd: string;
  catalog: WorkspaceSessionCatalog;
  agentSettingsStore: AgentSettingsStore;
  commandStdin: ReturnType<typeof createLiveCommandStdinRegistry>;
  appLogs: StateAppLogsFacade;
  sourceStatePort: Pick<RuntimeSourceStatePortService, "recordSourceScan">;
  dispose(): Promise<void>;
};

const RUNTIME_STREAM_ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function isPromptTarget(
  target: Extract<RuntimeEvent, { readonly target: unknown }>["target"],
): target is PromptTarget {
  return target.surface === "orchestrator" || target.surface === "handler";
}

function rendererStreamPatchesFromRuntimeEvent(input: {
  readonly event: Extract<RuntimeEvent, { readonly type: "surface.stream" }>;
  readonly startedBlocks: Set<string>;
}): SurfaceStreamPatch[] {
  const patch = input.event.patch;
  const sequence = Number(input.event.streamSequence) * 2;
  const blockKey = (kind: "text" | "thinking", contentIndex: number) =>
    `${input.event.target.surfacePiSessionId}:${input.event.streamGenerationId}:${kind}:${contentIndex}`;
  switch (patch.type) {
    case "assistant_message_started":
      for (const key of Array.from(input.startedBlocks)) {
        if (key.startsWith(`${input.event.target.surfacePiSessionId}:`)) {
          input.startedBlocks.delete(key);
        }
      }
      return [
        {
          type: "start",
          sequence,
          message: {
            role: "assistant",
            content: [],
            api: "runtime",
            provider: "runtime",
            model: "runtime",
            usage: RUNTIME_STREAM_ZERO_USAGE,
            stopReason: "stop",
            timestamp: Date.parse(patch.createdAt) || Date.now(),
          },
        } as SurfaceStreamPatch,
      ];
    case "assistant_text_delta": {
      const key = blockKey("text", patch.contentIndex);
      const patches: SurfaceStreamPatch[] = [];
      if (!input.startedBlocks.has(key)) {
        input.startedBlocks.add(key);
        patches.push({
          type: "text_start",
          sequence: sequence - 1,
          contentIndex: patch.contentIndex,
        });
      }
      patches.push({
        type: "text_delta",
        sequence,
        contentIndex: patch.contentIndex,
        delta: patch.delta,
      });
      return patches;
    }
    case "assistant_thinking_delta": {
      const key = blockKey("thinking", patch.contentIndex);
      const patches: SurfaceStreamPatch[] = [];
      if (!input.startedBlocks.has(key)) {
        input.startedBlocks.add(key);
        patches.push({
          type: "thinking_start",
          sequence: sequence - 1,
          contentIndex: patch.contentIndex,
        });
      }
      patches.push({
        type: "thinking_delta",
        sequence,
        contentIndex: patch.contentIndex,
        delta: patch.delta,
      });
      return patches;
    }
    case "assistant_message_finished":
      return [
        {
          type: "clear",
          sequence,
          reason: patch.status === "completed" ? "done" : "error",
        },
      ];
    case "stream_reset":
      return [
        {
          type: "clear",
          sequence,
          reason: "error",
        },
      ];
    case "active_command":
    case "prompt_status":
    case "tool_arguments_snapshot":
    case "user_message_committed":
      return [];
  }
}

export class WorkspaceRuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly pendingRuntimes = new Map<string, Promise<RuntimeRecord>>();
  private appGlobalHost: Promise<AppGlobalHostRecord> | null = null;
  private appRuntimeBootstrap: Promise<AppRuntimeBootstrap> | null = null;
  private resolvedAppRuntimeBootstrap: AppRuntimeBootstrap | null = null;
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
              Effect.promise(() => this.getAppGlobalHostRecord()),
              (host) => host.sourceStatePort.recordSourceScan(input),
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

  private async startRuntimeEventForwarder(input: {
    readonly workspaceId: string;
    readonly runtime: AppRuntimeBootstrap;
  }): Promise<() => void> {
    let stopped = false;
    const startedBlocks = new Set<string>();
    const subscription = await input.runtime.facade.events({
      workspaceId: input.workspaceId as WorkspaceId,
      includeAppEvents: true,
    });
    const stop = () => {
      stopped = true;
      void subscription.close().catch((error) => {
        this.options.forwardBridgeLog?.(
          "warn",
          "Runtime event subscription did not close cleanly.",
          "runtime.events",
          { workspaceId: input.workspaceId },
          error,
        );
      });
    };
    void this.forwardRuntimeEvents({
      workspaceId: input.workspaceId,
      subscription,
      startedBlocks,
      isStopped: () => stopped,
    });
    return stop;
  }

  private async forwardRuntimeEvents(input: {
    readonly workspaceId: string;
    readonly subscription: RuntimeEventSubscription;
    readonly startedBlocks: Set<string>;
    readonly isStopped: () => boolean;
  }): Promise<void> {
    try {
      for await (const event of input.subscription) {
        if (input.isStopped()) {
          break;
        }
        this.forwardRuntimeEventToRenderer({
          workspaceId: input.workspaceId,
          event,
          startedBlocks: input.startedBlocks,
        });
      }
    } catch (error) {
      if (!input.isStopped()) {
        this.options.forwardBridgeLog?.(
          "warn",
          "Runtime event subscription stopped unexpectedly.",
          "runtime.events",
          { workspaceId: input.workspaceId },
          error,
        );
      }
    }
  }

  private forwardRuntimeEventToRenderer(input: {
    readonly workspaceId: string;
    readonly event: RuntimeEvent;
    readonly startedBlocks: Set<string>;
  }): void {
    if (input.event.type !== "surface.stream") {
      return;
    }
    if (!isPromptTarget(input.event.target)) {
      return;
    }
    const patches = rendererStreamPatchesFromRuntimeEvent({
      event: input.event,
      startedBlocks: input.startedBlocks,
    });
    for (const patch of patches) {
      this.options.onSurfaceSync?.(input.workspaceId, {
        workspaceId: input.workspaceId,
        reason: "stream.patch",
        target: input.event.target,
        streamPatch: patch,
      });
    }
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
      runtime.refCount += 1;
      this.activeWorkspaceId = runtime.workspaceId;
      return runtime;
    }

    const pendingRuntime = this.createRuntime(workspaceId, workspaceCwd, options.kind ?? "user");
    this.pendingRuntimes.set(pendingKey, pendingRuntime);
    let runtime: RuntimeRecord;
    try {
      runtime = await pendingRuntime;
    } finally {
      this.pendingRuntimes.delete(pendingKey);
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

  getRuntimeOperations(workspaceId: string): WorkspaceRuntimeOperations {
    this.getRuntime(workspaceId);
    return this.getAppRuntimeFacadeOperations();
  }

  getRuntimeEventSubscription(
    workspaceId: string,
    input?: Parameters<RuntimeFacade["events"]>[0],
  ): ReturnType<RuntimeFacade["events"]> {
    this.getRuntime(workspaceId);
    return this.getAppRuntimeBootstrap().then((runtime) =>
      runtime.facade.events({
        ...input,
        workspaceId: workspaceId as WorkspaceId,
        includeAppEvents: input?.includeAppEvents ?? true,
      }),
    ) as ReturnType<RuntimeFacade["events"]>;
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
    if (this.appRuntimeBootstrapState === "closed") return;
    if (this.appRuntimeShutdownPromise) return await this.appRuntimeShutdownPromise;
    this.appRuntimeShutdownPromise = (async () => {
      const appRuntimeBootstrap = this.appRuntimeBootstrap;
      const appGlobalHost = this.appGlobalHost;
      this.appRuntimeBootstrapState = "shutting-down";
      await Promise.all([
        this.appGlobalSourceInvalidationCoordinator.close(),
        ...Array.from(this.runtimes.values()).map((runtime) =>
          runtime.sourceInvalidationCoordinator.close(),
        ),
      ]);
      try {
        await appRuntimeBootstrap?.then((runtime) => runtime.dispose());
        await appGlobalHost?.then((host) => host.dispose());
      } finally {
        this.appRuntimeBootstrapState = "closed";
        this.resolvedAppRuntimeBootstrap = null;
        this.appGlobalHost = null;
      }
    })();
    return await this.appRuntimeShutdownPromise;
  }

  private async createRuntime(
    requestedWorkspaceId: string,
    cwd: string,
    kind: WorkspaceKind,
  ): Promise<RuntimeRecord> {
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
        workflowsExtensionsGeneratedPackagePath:
          this.options.workflowsExtensionsGeneratedPackagePath,
        workflowsGeneratedPackagePath: this.options.workflowsGeneratedPackagePath,
        workflowsSourceRoot: this.options.workflowsSourceRoot,
        refreshGeneratedPackages: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.sourceInvalidation.refreshGeneratedPackages(request);
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
        runAcceptedRequestUserInput: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.acceptedNativeTools.runRequestUserInput(request);
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
    const workspaceStateRegistration = catalog.workspaceStateRouterRegistration();
    const workspaceId = workspaceStateRegistration.store.workspaceId;
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
    const appRuntime = await this.getAppRuntimeBootstrap();
    appRuntime.internal.workspaceStates.register(
      kind === "default"
        ? { ...workspaceStateRegistration, isDefaultWorkspace: true }
        : workspaceStateRegistration,
    );
    let workspaceAcquired = false;
    try {
      this.openingWorkspaceCwds.set(workspaceId, cwd);
      if (requestedWorkspaceId !== workspaceId) {
        this.openingWorkspaceCwds.set(requestedWorkspaceId, cwd);
      }
      if (kind === "default") {
        await appRuntime.facade.workspaces.acquireDefault({
          owner: workspaceOwnerRef(workspaceId),
          openReason: "startup",
        });
      } else {
        await appRuntime.facade.workspaces.acquire({
          cwd: cwd as AbsolutePath,
          owner: workspaceOwnerRef(workspaceId),
          openReason: "user-open",
        });
      }
      workspaceAcquired = true;
      await appRuntime.internal.sourceInvalidation.refreshGeneratedPackages({
        scope: "workspace-link-repair",
        workspaceId: workspaceId as WorkspaceId,
        packages: ["@svvyx/extensions", "@svvyx/workflows"],
        reason: "startup-recovery",
      });
      appLog.info("workflow.library", "Workflows build/link recovery refreshed package links.", {
        reason: "startup-recovery",
      });
    } catch (error) {
      appRuntime.internal.workspaceStates.unregister(workspaceId as WorkspaceId);
      await sourceInvalidationCoordinator.close();
      throw error;
    } finally {
      this.openingWorkspaceCwds.delete(workspaceId);
      if (requestedWorkspaceId !== workspaceId) {
        this.openingWorkspaceCwds.delete(requestedWorkspaceId);
      }
    }
    const unsubscribeRuntimeEvents = await this.startRuntimeEventForwarder({
      workspaceId,
      runtime: appRuntime,
    });
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
      appLog,
      sourceInvalidationCoordinator,
      unsubscribeAppLog,
      unsubscribeRuntimeEvents,
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
        unsubscribeRuntimeEvents();
        catalog.setWorkspaceSyncListener(null);
        catalog.setSurfaceSyncListener(null);
        catalog.setTitleGenerationLogListener(null);
        catalog.setWorkflowsGeneratedPackageLogListener(null);
        catalog.setAppLogListener(null);
        await sourceInvalidationCoordinator.close();
        const shutdownRuntime = await this.getAppRuntimeBootstrap();
        if (workspaceAcquired) {
          await shutdownRuntime.facade.workspaces.release({
            workspaceId: workspaceId as WorkspaceId,
            owner: workspaceOwnerRef(workspaceId),
            releaseReason: "tab-closed",
          });
        }
        shutdownRuntime.internal.workspaceStates.unregister(workspaceId as WorkspaceId);
        await catalog.dispose();
        this.releaseAppLogFacade(cwd);
      },
    };
    return runtime;
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

  async getAppRuntimeOperations(workspaceId: string): Promise<WorkspaceRuntimeOperations> {
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
    appGlobal.agentSettingsStore.hydrateStateOwnedAppPreferences(preferences);
    for (const runtime of this.runtimes.values()) {
      runtime.agentSettingsStore.hydrateStateOwnedAppPreferences(preferences);
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
    return runtime;
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
        workflowsExtensionsGeneratedPackagePath:
          this.options.workflowsExtensionsGeneratedPackagePath,
        workflowsGeneratedPackagePath: this.options.workflowsGeneratedPackagePath,
        workflowsSourceRoot: this.options.workflowsSourceRoot,
        refreshGeneratedPackages: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.sourceInvalidation.refreshGeneratedPackages(request);
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
        runAcceptedRequestUserInput: async (request) => {
          const runtime = await this.getAppRuntimeBootstrap();
          return runtime.internal.acceptedNativeTools.runRequestUserInput(request);
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
      cwd,
      agentDir: this.agentDir,
      workflowsSourceRoot: this.options.workflowsSourceRoot,
    });
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

    return {
      workspaceId,
      cwd,
      catalog,
      agentSettingsStore,
      commandStdin,
      appLogs,
      sourceStatePort: catalog.getRuntimeSourceStatePort(),
      dispose: async () => {
        catalog.setTitleGenerationLogListener(null);
        catalog.setWorkflowsGeneratedPackageLogListener(null);
        catalog.setAppLogListener(null);
        await catalog.dispose();
        this.releaseAppLogFacade(cwd);
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
    return await createAppRuntimeBootstrap({
      appGlobalState: appGlobal.catalog.workspaceStateRouterRegistration(),
      workspaceStates: Array.from(this.runtimes.values()).map((runtime) =>
        runtime.kind === "default"
          ? { ...runtime.catalog.workspaceStateRouterRegistration(), isDefaultWorkspace: true }
          : runtime.catalog.workspaceStateRouterRegistration(),
      ),
      sourceRoots: generatedPackageBoundaryHost.sourceRoots,
      generatedPackageRoots: generatedPackageBoundaryHost.generatedPackageRoots,
      extensionStatePort: generatedPackageBoundaryHost.extensionStatePort,
      generatedPackageLinkPath: generatedPackageBoundaryHost.generatedPackageLinkPath,
      sandboxPolicySource: this.createSandboxPolicySource(),
      appLogs: appGlobal.appLogs,
      resolveWorkspaceAppLogs: async (workspaceId) => {
        const runtime =
          this.runtimes.get(workspaceId) ??
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
      appLogWritePort: appGlobal.appLogs.writePort,
      sandboxHostSupport: this.options.sandboxHostSupport,
      runtimeLayerConfig: this.options.runtimeLayerConfig,
      commandRegistry: this.createAppCommandRegistry(appGlobal.commandStdin),
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
      generatedPackageStatePort: this.createGeneratedPackageStatePort(),
      sourceInvalidation: {
        appGlobalCoordinator: this.appGlobalSourceInvalidationCoordinator,
        listAcquiredWorkspaceIds: () =>
          Array.from(this.runtimes.values()).map((runtime) => runtime.workspaceId as WorkspaceId),
        resolveWorkspaceCoordinator: async (workspaceId) => {
          const runtime = this.runtimes.get(workspaceId);
          if (!runtime) {
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
            ...Array.from(this.runtimes.values(), (runtime) => runtime.catalog),
          ];
          return catalogs.some((catalog) => catalog.verifyRunTaskAgentBridgeBearerLineage(request));
        },
      },
      appPreferencesSeed: {
        hasStateRows: () =>
          appGlobal.catalog.workspaceStateRouterRegistration().store.hasAppPreferencesRow(),
        read: () => appGlobal.agentSettingsStore.getState().appPreferences,
      },
      workspaceChromeSeed: {
        hasStateRows: () =>
          appGlobal.catalog.workspaceStateRouterRegistration().store.hasWorkspaceChromeLayoutRows(),
        read: () => this.options.appWorkspaceTabsStore?.getState?.() ?? null,
      },
      agentSettingsSeed: {
        hasAgentProfileRows: () =>
          appGlobal.catalog.workspaceStateRouterRegistration().store.hasAgentProfileRows(),
        hasExtensionEnvRows: () =>
          appGlobal.catalog.workspaceStateRouterRegistration().store.hasExtensionEnvOverrideRows(),
        read: () => appGlobal.agentSettingsStore.getState(),
      },
      snippetsSeed: {
        hasStateRows: () =>
          appGlobal.catalog
            .workspaceStateRouterRegistration()
            .store.hasSnippetRows(appGlobal.workspaceId),
        readManaged: () => appGlobal.catalog.getSnippets().managed,
        workspaceId: appGlobal.workspaceId as WorkspaceId,
      },
    });
  }

  private async resolvePiRuntimePaths(workspaceId: WorkspaceId) {
    const appGlobal = await this.getAppGlobalHostRecord();
    const runtime =
      this.runtimes.get(workspaceId) ?? (appGlobal.workspaceId === workspaceId ? appGlobal : null);
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
  ): RuntimeLayerCommandStdinPortService & RuntimeLayerCommandControlPortService {
    const registries = () => [
      ...Array.from(this.runtimes.values()).map((runtime) => runtime.commandStdin),
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

  private findRuntimeByCwd(cwd: string): RuntimeRecord | null {
    const canonical = canonicalizeWorkspaceCwd(cwd);
    return Array.from(this.runtimes.values()).find((runtime) => runtime.cwd === canonical) ?? null;
  }

  private async handleSourceInvalidationEvent(
    input: RuntimeSourceInvalidationReactionInput,
  ): Promise<void> {
    const { event } = input;
    try {
      if (input.scope.kind === "workspace") {
        this.getRuntime(input.scope.workspaceId);
      }
      const { facade } = await this.getAppRuntimeBootstrap();
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
            : (this.runtimes.get(workspaceId)?.cwd ?? this.openingWorkspaceCwds.get(workspaceId));
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

  private createGeneratedPackageStatePort(): Pick<
    RuntimeGeneratedPackageStatePortService,
    "markWorkspaceLinksRepairNeeded" | "recordWorkspaceLinkStatus"
  > {
    return {
      recordWorkspaceLinkStatus: (input) => {
        const recoverableWorkspace = this.findRecoverableWorkspace(input.status.workspaceId);
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
      markWorkspaceLinksRepairNeeded: (input) => {
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
