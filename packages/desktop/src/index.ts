import type {
  ComposerAttachment,
  ListModelsInput,
  ModelInfo,
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  RuntimeSurfaceTarget,
  StateInvalidationDescriptor,
  SurfacePiSessionId,
  SurfaceStreamGenerationId,
  SurfaceStreamPatchInput,
  SurfaceStreamSequence,
  WorkspaceKind,
  WorkspaceId,
} from "@svvy/core";
import type { createRuntimeFacade } from "@svvy/runtime";
import type { createStateCommandsFacade, createStateFacade } from "@svvy/state";

type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;
type RuntimeCommandsFacade = RuntimeFacade["commands"];
type BootstrapStateFacade = ReturnType<typeof createStateFacade>;
type BootstrapStateCommandsFacade = ReturnType<typeof createStateCommandsFacade>;

export type DesktopRuntimeActionsFacade = Omit<RuntimeFacade, "events" | "close" | "commands">;

export interface DesktopWorkspaceInfo {
  readonly workspaceId: string;
  readonly cwd: string;
  readonly workspaceLabel: string;
  readonly kind: WorkspaceKind;
  readonly branch?: string;
}

export interface DesktopWorkspaceBranchInfo {
  readonly name: string;
  readonly current: boolean;
}

export interface DesktopWorkspaceBranchList {
  readonly branches: readonly DesktopWorkspaceBranchInfo[];
  readonly currentBranch?: string;
}

export type DesktopSwitchWorkspaceBranchResult =
  | {
      readonly ok: true;
      readonly switched: boolean;
      readonly workspace: DesktopWorkspaceInfo;
    }
  | { readonly ok: false; readonly workspace: DesktopWorkspaceInfo; readonly error: string };

export interface DesktopArtifactPreview {
  readonly artifactId: string;
  readonly sessionId: string;
  readonly kind: "text" | "log" | "json" | "file";
  readonly name: string;
  readonly path?: string;
  readonly createdAt: string;
  readonly sourceCommandId?: string;
  readonly workflowRunId?: string;
  readonly workflowName?: string;
  readonly producerLabel?: string;
  readonly missingFile: boolean;
  readonly content: string;
}

export interface DesktopWorkspacePathIndexEntry {
  readonly kind: "file" | "folder";
  readonly workspaceRelativePath: string;
}

export interface DesktopImportComposerAttachmentInput {
  readonly name: string;
  readonly mimeType?: string;
  readonly dataBase64: string;
}

export interface DesktopWorkspaceAttachmentResult {
  readonly attachments: readonly ComposerAttachment[];
  readonly skippedPaths: readonly string[];
}

export type DesktopWorkspacePathTarget =
  | { readonly kind: "missing" }
  | { readonly kind: "file" | "folder"; readonly absolutePath: string };

export interface DesktopRendererTelemetryInput {
  readonly workspaceId: string;
  readonly eventName: string;
  readonly level?: "debug" | "info" | "warn" | "error";
  readonly message?: string;
  readonly target?: {
    readonly workspaceSessionId: string;
    readonly surfacePiSessionId: string;
    readonly surface: "orchestrator" | "handler";
    readonly threadId?: string;
  };
  readonly panelId?: string;
  readonly correlationId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly error?: {
    readonly name?: string;
    readonly message: string;
    readonly stack?: string;
  };
}

export interface DesktopExternalInstructionEditorTarget {
  readonly sourceId: string;
  readonly path: string;
  readonly cwd: string;
  readonly editor: "system" | "code" | "cursor" | "zed" | "sublime" | "custom";
  readonly customCommand: string;
}

export interface DesktopExternalInstructionEditorResult {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly path: string;
  readonly opened: boolean;
  readonly editor: DesktopExternalInstructionEditorTarget["editor"];
  readonly failure?:
    | { readonly kind: "app-launch"; readonly message: string }
    | { readonly kind: "custom-command-empty" }
    | {
        readonly kind: "custom-command-launch";
        readonly command: string;
        readonly message: string;
      };
}

export interface DesktopAppActionsFacade {
  readonly workspaces: {
    acquireByCwd(input: { readonly cwd: string }): Promise<DesktopWorkspaceInfo>;
    acquireDefault(): Promise<DesktopWorkspaceInfo>;
    releaseVisual(input: { readonly workspaceId: string }): Promise<{ readonly released: boolean }>;
  };
  readonly git: {
    listBranches(input: { readonly workspaceId: string }): Promise<DesktopWorkspaceBranchList>;
    switchBranch(input: {
      readonly workspaceId: string;
      readonly branch: string;
    }): Promise<DesktopSwitchWorkspaceBranchResult>;
  };
  readonly artifacts: {
    preview(input: {
      readonly workspaceId: string;
      readonly workspaceSessionId: string;
      readonly artifactId: string;
    }): Promise<DesktopArtifactPreview>;
  };
  readonly workspaceFiles: {
    getRoot(input: { readonly workspaceId: string }): Promise<{ readonly cwd: string }>;
    listPaths(input: {
      readonly workspaceId: string;
      readonly refresh?: boolean;
    }): Promise<readonly DesktopWorkspacePathIndexEntry[]>;
    materializeSelectedAttachments(input: {
      readonly workspaceId: string;
      readonly selectedPaths: readonly string[];
    }): Promise<DesktopWorkspaceAttachmentResult>;
    importComposerAttachments(input: {
      readonly workspaceId: string;
      readonly attachments: readonly DesktopImportComposerAttachmentInput[];
    }): Promise<DesktopWorkspaceAttachmentResult>;
    resolvePathTarget(input: {
      readonly workspaceId: string;
      readonly workspaceRelativePath: string;
    }): Promise<DesktopWorkspacePathTarget>;
  };
  readonly externalInstructions: {
    resolveEditorTarget(input: {
      readonly workspaceId: string;
      readonly sourceId: string;
    }): Promise<DesktopExternalInstructionEditorTarget>;
    recordEditorResult(
      input: DesktopExternalInstructionEditorResult,
    ): Promise<{ readonly ok: true }>;
  };
  readonly telemetry: {
    recordRenderer(input: DesktopRendererTelemetryInput): Promise<{ readonly ok: true }>;
  };
}

export interface RendererStateFacade {
  readonly readModels: Pick<
    BootstrapStateFacade["readModels"],
    "fetch" | "refetchInvalidation" | "rebaseline"
  >;
}

export interface RendererModelMetadataFacade {
  readonly list: (input: ListModelsInput) => Promise<readonly ModelInfo[]>;
}

export interface RendererStateCommandsFacade {
  readonly workspaceChrome: BootstrapStateCommandsFacade["workspaceChrome"];
  readonly workspaceLayout: BootstrapStateCommandsFacade["workspaceLayout"];
  readonly appLogs: BootstrapStateCommandsFacade["appLogs"];
  readonly appPreferences: BootstrapStateCommandsFacade["appPreferences"];
  readonly providerAuth: BootstrapStateCommandsFacade["providerAuth"];
  readonly extensionEnv: Pick<
    BootstrapStateCommandsFacade["extensionEnv"],
    "setOverride" | "removeOverride"
  >;
  readonly agentProfiles: BootstrapStateCommandsFacade["agentProfiles"];
  readonly snippets: BootstrapStateCommandsFacade["snippets"];
}

export interface DesktopNotificationBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateDesktopAppInput {
  readonly runtime: DesktopRuntimeActionsFacade;
  readonly appActions: DesktopAppActionsFacade;
  readonly modelMetadata: RendererModelMetadataFacade;
  readonly state: RendererStateFacade;
  readonly commands: {
    readonly runtime: RuntimeCommandsFacade;
    readonly state: RendererStateCommandsFacade;
  };
  readonly notifications: DesktopNotificationBridge;
  readonly host: DesktopHostAdapter;
}

export interface DesktopHostAdapter {
  readonly bridge: DesktopBridgeAdapter;
  readonly windows: DesktopWindowAdapter;
  readonly menus: DesktopMenuAdapter;
  readonly actions: DesktopHostActionsAdapter;
  readonly browserTools?: DesktopBrowserToolsUiAdapter;
}

export interface DesktopHostActionsAdapter {
  readonly clipboard: {
    writeText(input: { readonly text: string }): Promise<{ readonly ok: true }>;
  };
  readonly dialogs: {
    pickFolder(input: {
      readonly startingFolder: string;
    }): Promise<{ readonly selectedPaths: readonly string[] }>;
    pickFilesAndFolders(input: {
      readonly startingFolder: string;
    }): Promise<{ readonly selectedPaths: readonly string[] }>;
  };
  readonly paths: {
    open(input: { readonly path: string }): Promise<{ readonly opened: boolean }>;
    reveal(input: { readonly path: string }): Promise<{ readonly ok: true }>;
  };
  readonly editor: {
    open(input: {
      readonly path: string;
      readonly cwd: string;
      readonly editor: "system" | "code" | "cursor" | "zed" | "sublime" | "custom";
      readonly customCommand: string;
    }): Promise<{
      readonly opened: boolean;
      readonly editor: "system" | "code" | "cursor" | "zed" | "sublime" | "custom";
      readonly failure?:
        | { readonly kind: "app-launch"; readonly message: string }
        | { readonly kind: "custom-command-empty" }
        | {
            readonly kind: "custom-command-launch";
            readonly command: string;
            readonly message: string;
          };
    }>;
  };
}

export interface DesktopBridgeAdapter {
  exposeRendererApi(input: {
    runtime: DesktopRuntimeActionsFacade;
    appActions: DesktopAppActionsFacade;
    modelMetadata: RendererModelMetadataFacade;
    state: RendererStateFacade;
    commands: CreateDesktopAppInput["commands"];
    hostActions: DesktopHostActionsAdapter;
  }): Promise<DesktopBridgeRegistration>;
  sendToRenderer(input: DesktopRendererNotification): Promise<void>;
}

export interface DesktopBridgeRegistration {
  readonly rendererReady: Promise<void>;
  dispose(): Promise<void>;
}

export type DesktopRendererCommand =
  | "command-palette.open"
  | "quick-open.open"
  | "settings.open"
  | "workspace.open"
  | "workspace.newTab"
  | "workspace.openInNewTab"
  | "session.new"
  | "session.newPane"
  | "sidebar.toggle"
  | "surface.logs.open"
  | "surface.agents.open"
  | "surface.extensions.open"
  | "surface.workflows.open";

export type DesktopRendererNotification =
  | {
      readonly kind: "read-model-changed";
      readonly eventGenerationId: RuntimeEventGenerationId;
      readonly sequence: RuntimeEventSequence;
      readonly scope:
        | { readonly kind: "app" }
        | { readonly kind: "workspace"; readonly workspaceId: WorkspaceId }
        | {
            readonly kind: "surface";
            readonly workspaceId: WorkspaceId;
            readonly surfacePiSessionId: SurfacePiSessionId;
          };
      readonly invalidation: StateInvalidationDescriptor;
    }
  | {
      readonly kind: "surface-stream-patch";
      readonly eventGenerationId: RuntimeEventGenerationId;
      readonly sequence: RuntimeEventSequence;
      readonly workspaceId: WorkspaceId;
      readonly target: Readonly<RuntimeSurfaceTarget>;
      readonly surfacePiSessionId: SurfacePiSessionId;
      readonly streamGenerationId: SurfaceStreamGenerationId;
      readonly streamSequence: SurfaceStreamSequence;
      readonly patch: SurfaceStreamPatchInput;
    }
  | {
      readonly kind: "read-model-rebaseline-required";
      readonly reason:
        | "event-sequence-gap"
        | "surface-stream-gap"
        | "surface-stream-generation-mismatch"
        | "scope-descriptor-mismatch"
        | "runtime-restart"
        | "slow-consumer"
        | "bridge-restart"
        | "bridge-disposed";
      readonly rebaselineRequired: true;
      readonly eventGenerationId?: RuntimeEventGenerationId;
      readonly lastContiguousSequence?: RuntimeEventSequence;
      readonly scope?:
        | { readonly kind: "app" }
        | { readonly kind: "workspace"; readonly workspaceId: WorkspaceId }
        | {
            readonly kind: "surface";
            readonly workspaceId: WorkspaceId;
            readonly surfacePiSessionId: SurfacePiSessionId;
          };
    }
  | { readonly kind: "renderer-command"; readonly command: DesktopRendererCommand }
  | {
      readonly kind: "app-shutdown";
      readonly reason: "app-shutdown" | "bridge-stopped" | "runtime-shutdown" | "startup-failure";
    };

export interface DesktopWindowAdapter {
  createMainWindow(input: DesktopMainWindowInput): Promise<DesktopWindowHandle>;
  focusWindow(input: { windowId: DesktopWindowId }): Promise<void>;
  closeWindow(input: { windowId: DesktopWindowId }): Promise<void>;
}

export interface DesktopMainWindowInput {
  readonly initialRoute: "workspace" | "settings";
  readonly title: string;
}

export interface DesktopWindowHandle {
  readonly windowId: DesktopWindowId;
  dispose(): Promise<void>;
}

export interface DesktopMenuAdapter {
  installAppMenu(input: {
    sendRendererCommand(command: DesktopRendererCommand): Promise<void>;
  }): Promise<DesktopMenuRegistration>;
}

export interface DesktopMenuRegistration {
  dispose(): Promise<void>;
}

export interface DesktopBrowserToolsUiAdapter {
  status(): Promise<{
    readonly available: boolean;
    readonly label: string;
    readonly bridgeUrl?: string;
  }>;
  openInspector(input: { target?: RuntimeSurfaceTarget }): Promise<void>;
}

export type DesktopWindowId = string & { readonly __brand: "DesktopWindowId" };

export interface DesktopApp {
  start(): Promise<void>;
  dispose(): Promise<void>;
}

export function createDesktopApp(input: CreateDesktopAppInput): DesktopApp {
  type LifecycleState = "idle" | "starting" | "started" | "failed" | "disposing" | "disposed";

  let bridgeRegistration: DesktopBridgeRegistration | undefined;
  let menuRegistration: DesktopMenuRegistration | undefined;
  let mainWindow: DesktopWindowHandle | undefined;
  let notificationsStartAttempted = false;
  let lifecycleState: LifecycleState = "idle";
  let disposeRequested = false;
  let requestStartupStop!: () => void;
  const startupStopRequested = new Promise<void>((resolve) => {
    requestStartupStop = resolve;
  });
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;

  const sendRendererCommand = (command: DesktopRendererCommand): Promise<void> => {
    if (disposeRequested || (lifecycleState !== "starting" && lifecycleState !== "started")) {
      return Promise.reject(new Error("Cannot send a renderer command after desktop disposal."));
    }
    return input.host.bridge.sendToRenderer({ kind: "renderer-command", command });
  };

  const disposeStartedResources = async (): Promise<unknown[]> => {
    const errors: unknown[] = [];
    if (menuRegistration) {
      const menu = menuRegistration;
      menuRegistration = undefined;
      try {
        await menu.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (notificationsStartAttempted) {
      notificationsStartAttempted = false;
      try {
        await input.notifications.stop();
      } catch (error) {
        errors.push(error);
      }
    }
    if (mainWindow) {
      const window = mainWindow;
      mainWindow = undefined;
      try {
        await window.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (bridgeRegistration) {
      const bridge = bridgeRegistration;
      bridgeRegistration = undefined;
      try {
        await bridge.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  };

  const assertStartupMayContinue = (): void => {
    if (disposeRequested) {
      throw new Error("Desktop app was disposed during startup.");
    }
  };

  return {
    start() {
      if (disposeRequested || lifecycleState === "disposing" || lifecycleState === "disposed") {
        return Promise.reject(new Error("Cannot start a disposed desktop app."));
      }
      if (lifecycleState === "starting") {
        return startPromise!;
      }
      if (lifecycleState === "started") {
        return Promise.reject(new Error("Desktop app has already started."));
      }
      if (lifecycleState === "failed") {
        return Promise.reject(new Error("Desktop app startup has already failed."));
      }

      lifecycleState = "starting";
      startPromise = (async () => {
        try {
          bridgeRegistration = await input.host.bridge.exposeRendererApi({
            runtime: input.runtime,
            appActions: input.appActions,
            modelMetadata: input.modelMetadata,
            state: input.state,
            commands: input.commands,
            hostActions: input.host.actions,
          });
          assertStartupMayContinue();
          notificationsStartAttempted = true;
          await input.notifications.start();
          assertStartupMayContinue();
          mainWindow = await input.host.windows.createMainWindow({
            initialRoute: "workspace",
            title: "svvy",
          });
          assertStartupMayContinue();
          await Promise.race([bridgeRegistration.rendererReady, startupStopRequested]);
          assertStartupMayContinue();
          menuRegistration = await input.host.menus.installAppMenu({
            sendRendererCommand,
          });
          assertStartupMayContinue();
          lifecycleState = "started";
        } catch (error) {
          lifecycleState = disposeRequested ? "disposing" : "failed";
          const cleanupErrors = await disposeStartedResources();
          if (cleanupErrors.length > 0) {
            return Promise.reject(
              new AggregateError(
                [error, ...cleanupErrors],
                "Desktop app startup failed and acquired resources could not be fully disposed.",
                { cause: error },
              ),
            );
          }
          throw error;
        }
      })();
      return startPromise;
    },
    dispose() {
      if (disposePromise) {
        return disposePromise;
      }
      if (lifecycleState === "disposed") {
        return Promise.resolve();
      }
      disposeRequested = true;
      requestStartupStop();
      lifecycleState = "disposing";
      disposePromise = (async () => {
        await startPromise?.catch(() => undefined);
        const errors = await disposeStartedResources();
        lifecycleState = "disposed";
        if (errors.length > 0) {
          throw new AggregateError(errors, "Failed to dispose desktop app resources.");
        }
      })();
      return disposePromise;
    },
  };
}
