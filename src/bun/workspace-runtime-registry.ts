import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import type {
  AppLogUpdateMessage,
  SurfaceSyncMessage,
  WorkspaceInfoResponse,
  WorkspaceKind,
  WorkspaceSyncMessage,
} from "../shared/workspace-contract";
import { appendAppLoggerEvent, createAppLogger, type BridgeLogLevel } from "./app-logger";
import { createAppLogStore, type AppLogStore } from "./app-log-store";
import { createAgentSettingsStore } from "./agent-settings-store";
import {
  getSvvySessionDir,
  getSvvyAgentDir,
  getSvvyDataDir,
  WorkspaceSessionCatalog,
  type TitleGenerationLogEvent,
  type WorkflowsGeneratedPackageLogEvent,
} from "./session-catalog";
import { canonicalizeWorkspaceCwd, getDefaultWorkspaceCwd } from "./workspace-context";
import { WorkspacePathIndex } from "./workspace-path-index";

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
  workflowsGeneratedPackagePath?: string;
  workflowsExtensionsGeneratedPackagePath?: string;
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
  appLogStore: AppLogStore;
  appLog: ReturnType<typeof createAppLogger>;
  getInfo: () => WorkspaceInfoResponse;
  dispose: () => Promise<void>;
};

type RuntimeRecord = WorkspaceRuntime & {
  refCount: number;
  unsubscribeAppLog: () => void;
};

export class WorkspaceRuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly sharedAppLogStores = new Map<
    string,
    {
      store: AppLogStore;
      refCount: number;
    }
  >();
  private readonly agentDir: string;
  private readonly appDataDir: string;
  private activeWorkspaceId: string | null = null;

  constructor(private readonly options: WorkspaceRuntimeRegistryOptions) {
    this.agentDir = options.agentDir ?? getSvvyAgentDir();
    this.appDataDir = options.appDataDir ?? getSvvyDataDir();
    if (options.openInitialWorkspace) {
      this.activeWorkspaceId = this.acquireWorkspace(options.initialCwd).workspaceId;
    }
  }

  openWorkspace(cwd: string, options: OpenWorkspaceOptions = {}): WorkspaceRuntime {
    return this.acquireWorkspace(cwd, options);
  }

  acquireWorkspace(cwd: string, options: OpenWorkspaceOptions = {}): WorkspaceRuntime {
    const workspaceCwd = canonicalizeWorkspaceCwd(cwd);
    const workspaceId = normalizeWorkspaceRuntimeId(workspaceCwd);
    const existing = this.runtimes.get(workspaceId);
    if (existing) {
      existing.refCount += 1;
      this.activeWorkspaceId = workspaceId;
      return existing;
    }
    const runtime = this.createRuntime(workspaceId, workspaceCwd, options.kind ?? "user");
    this.runtimes.set(workspaceId, runtime);
    this.activeWorkspaceId = workspaceId;
    return runtime;
  }

  getDefaultWorkspace(): WorkspaceRuntime {
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

  private createRuntime(workspaceId: string, cwd: string, kind: WorkspaceKind): RuntimeRecord {
    const label = kind === "default" ? "Default Workspace" : basename(cwd) || "workspace";
    const sessionDir = getSvvySessionDir(cwd, this.agentDir);
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
    );
    const pathIndex = new WorkspacePathIndex(cwd);
    const agentSettingsStore = createAgentSettingsStore({
      cwd,
      agentDir: this.agentDir,
      workflowsSourceRoot: this.options.workflowsSourceRoot,
    });
    const appLogStore = this.acquireAppLogStore(cwd);
    const appLog = createAppLogger({
      store: appLogStore,
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
      appLogStore,
      appLog,
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
        await catalog.dispose();
        this.releaseAppLogStore(cwd);
      },
    };
    return runtime;
  }

  private acquireAppLogStore(cwd: string): AppLogStore {
    const existing = this.sharedAppLogStores.get(cwd);
    if (existing) {
      existing.refCount += 1;
      return existing.store;
    }

    const runtimeDir = join(
      this.agentDir,
      "workspace-runtimes",
      sanitizeWorkspaceRuntimeStorageKey(cwd),
    );
    const store = createAppLogStore({
      databasePath: join(runtimeDir, "app-logs-v1.sqlite"),
    });
    this.sharedAppLogStores.set(cwd, {
      store,
      refCount: 1,
    });
    return store;
  }

  private releaseAppLogStore(cwd: string): void {
    const existing = this.sharedAppLogStores.get(cwd);
    if (!existing) return;
    existing.refCount -= 1;
    if (existing.refCount > 0) return;
    this.sharedAppLogStores.delete(cwd);
    existing.store.close();
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
