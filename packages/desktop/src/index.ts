import type { RuntimeEvent, RuntimeSurfaceTarget } from "@svvy/core";
import type { createRuntimeFacade } from "@svvy/runtime";

type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;
type RuntimeCommandsFacade = RuntimeFacade["commands"];

export type DesktopRuntimeActionsFacade = Omit<RuntimeFacade, "events" | "close">;

export interface RendererStateFacade {
  readonly readModels: {
    fetch(input: unknown, options?: unknown): Promise<unknown>;
    refetchInvalidation(input: unknown, options?: unknown): Promise<readonly unknown[]>;
    rebaseline(input: unknown, options?: unknown): Promise<unknown>;
  };
  close(): void;
}

export interface StateCommandsFacade {
  readonly [group: string]: unknown;
}

export interface DesktopNotificationBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateDesktopAppInput {
  readonly runtime: DesktopRuntimeActionsFacade;
  readonly state: RendererStateFacade;
  readonly commands: {
    readonly runtime: RuntimeCommandsFacade;
    readonly state: StateCommandsFacade;
  };
  readonly notifications: DesktopNotificationBridge;
  readonly host: DesktopHostAdapter;
}

export interface DesktopHostAdapter {
  readonly bridge: DesktopBridgeAdapter;
  readonly windows: DesktopWindowAdapter;
  readonly menus: DesktopMenuAdapter;
  readonly browserTools?: DesktopBrowserToolsUiAdapter;
}

export interface DesktopBridgeAdapter {
  exposeRendererApi(input: {
    runtime: DesktopRuntimeActionsFacade;
    state: RendererStateFacade;
    commands: CreateDesktopAppInput["commands"];
  }): Promise<DesktopBridgeRegistration>;
  sendToRenderer(input: DesktopRendererNotification): Promise<void>;
}

export interface DesktopBridgeRegistration {
  dispose(): Promise<void>;
}

export type DesktopRendererCommand = "command-palette.open" | "quick-open.open" | "settings.open";

export type DesktopRendererNotification =
  | { readonly kind: "runtime-event"; readonly event: RuntimeEvent }
  | { readonly kind: "read-model-rebaseline-required"; readonly reason: string }
  | { readonly kind: "renderer-command"; readonly command: DesktopRendererCommand }
  | { readonly kind: "app-shutdown"; readonly reason: string };

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
    commandPalette(): Promise<void>;
    quickOpen(): Promise<void>;
    openSettings(): Promise<void>;
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
  let bridgeRegistration: DesktopBridgeRegistration | undefined;
  let menuRegistration: DesktopMenuRegistration | undefined;
  let mainWindow: DesktopWindowHandle | undefined;
  let notificationsStarted = false;
  let started = false;
  let disposed = false;

  const sendRendererCommand = (command: DesktopRendererCommand) =>
    input.host.bridge.sendToRenderer({ kind: "renderer-command", command });

  const disposeStartedResources = async () => {
    const errors: unknown[] = [];
    if (notificationsStarted) {
      try {
        await input.notifications.stop();
      } catch (error) {
        errors.push(error);
      } finally {
        notificationsStarted = false;
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
    if (menuRegistration) {
      const menu = menuRegistration;
      menuRegistration = undefined;
      try {
        await menu.dispose();
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
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose desktop app resources.");
    }
  };

  return {
    async start() {
      if (disposed) {
        throw new Error("Cannot start a disposed desktop app.");
      }
      if (started) {
        throw new Error("Desktop app has already started.");
      }

      try {
        bridgeRegistration = await input.host.bridge.exposeRendererApi({
          runtime: input.runtime,
          state: input.state,
          commands: input.commands,
        });
        menuRegistration = await input.host.menus.installAppMenu({
          commandPalette: () => sendRendererCommand("command-palette.open"),
          quickOpen: () => sendRendererCommand("quick-open.open"),
          openSettings: () => sendRendererCommand("settings.open"),
        });
        mainWindow = await input.host.windows.createMainWindow({
          initialRoute: "workspace",
          title: "svvy",
        });
        await input.notifications.start();
        notificationsStarted = true;
        started = true;
      } catch (error) {
        await disposeStartedResources();
        throw error;
      }
    },
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      started = false;
      await disposeStartedResources();
    },
  };
}
