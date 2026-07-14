import { ApplicationMenu, BrowserWindow, Utils, defineElectrobunRPC } from "electrobun/bun";
import Electrobun from "electrobun/bun";
import { spawn } from "node:child_process";
import type {
  DesktopBridgeAdapter,
  DesktopBridgeRegistration,
  DesktopBrowserToolsUiAdapter,
  DesktopHostAdapter,
  DesktopMainWindowInput,
  DesktopMenuRegistration,
  DesktopRendererNotification,
  DesktopWindowHandle,
  DesktopWindowId,
} from "@svvy/desktop";
import type { ChatRPCSchema } from "../shared/workspace-contract";
import { buildAppMenuConfiguration, routeAppMenuAction } from "./app-menu";
import { positionNativeTrafficLights } from "./native-window-controls";

type RendererApiInput = Parameters<DesktopBridgeAdapter["exposeRendererApi"]>[0];
type BunRpcFactory = typeof defineElectrobunRPC<ChatRPCSchema, "bun">;
type BunRpcConfig = Parameters<BunRpcFactory>[1];
type BunRpc = ReturnType<BunRpcFactory>;
type ApplicationMenuClickEvent = { data?: { action?: unknown } };
type BufferedRendererDelivery = {
  readonly kind: "notification";
  readonly notification: DesktopRendererNotification;
};

const MAX_RENDERER_HANDOFF_QUEUE_SIZE = 64;

function isCommandInvalidation(delivery: BufferedRendererDelivery): boolean {
  return (
    delivery.notification.kind === "read-model-changed" &&
    delivery.notification.invalidation.invalidation.model === "commandInspector"
  );
}

let activeApplicationMenuDispatch: ((event: ApplicationMenuClickEvent) => void) | null = null;
let applicationMenuDispatcherInstalled = false;

function ensureApplicationMenuDispatcher(): void {
  if (applicationMenuDispatcherInstalled) {
    return;
  }
  ApplicationMenu.on("application-menu-clicked", (event) => {
    activeApplicationMenuDispatch?.(event as ApplicationMenuClickEvent);
  });
  applicationMenuDispatcherInstalled = true;
}

export interface CreateElectrobunDesktopHostOptions {
  readonly buildRpcHandlers: (
    input: RendererApiInput,
    lifecycle: { readonly rendererReady: () => void },
  ) => BunRpcConfig["handlers"];
  readonly maxRequestTime?: number;
  readonly rendererReadyTimeoutMs?: number;
  readonly resolveMainWindowUrl: (input: DesktopMainWindowInput) => string | Promise<string>;
  readonly prepareMainWindow?: (window: BrowserWindow<BunRpc>) => void | Promise<void>;
  readonly includeSettingsMenuItem?: boolean;
  readonly browserTools?: DesktopBrowserToolsUiAdapter;
  readonly platform?: NodeJS.Platform;
  readonly positionTrafficLights?: (window: BrowserWindow<BunRpc>) => void;
  readonly onBeforeQuit?: () => void | Promise<void>;
  readonly onError?: (error: unknown, context: string) => void;
  readonly launchDetached?: (input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
  }) => void;
}

export interface ElectrobunDesktopHostAdapter extends DesktopHostAdapter {
  readonly lifecycle: {
    start(): void;
    finishQuit(): void;
  };
  getMainWindow(): BrowserWindow | null;
  rejectRendererCalls(error: unknown): void;
}

type MainWindowRecord = {
  readonly window: BrowserWindow<BunRpc>;
  readonly windowId: DesktopWindowId;
  markClosed(): void;
  close(): void;
};

export function createElectrobunDesktopHostAdapter(
  options: CreateElectrobunDesktopHostOptions,
): ElectrobunDesktopHostAdapter {
  let rendererRpc: BunRpc | null = null;
  let bridgeGeneration = 0;
  let mainWindow: MainWindowRecord | null = null;
  let mainWindowCreation: Promise<DesktopWindowHandle> | null = null;
  let shutdownStarted = false;
  let finalQuitStarted = false;
  let beforeQuitListenerInstalled = false;
  let rendererCallsRejectedWith: unknown;
  let rendererTransportReady = false;
  let rendererDelivery = Promise.resolve();
  let bufferedRendererDeliveries: BufferedRendererDelivery[] = [];

  const reportError = (error: unknown, context: string): void => {
    try {
      options.onError?.(error, context);
    } catch {
      // Host cleanup and typed bridge closure remain authoritative over diagnostics.
    }
  };

  const launchDetached =
    options.launchDetached ??
    ((input: {
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string;
    }) => {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    });

  const beforeQuitListener = (event: { response?: { allow: boolean } }): void => {
    if (!options.onBeforeQuit) {
      return;
    }
    event.response = { allow: false };
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    let shutdown: Promise<void>;
    try {
      shutdown = Promise.resolve(options.onBeforeQuit());
    } catch (error) {
      shutdown = Promise.reject(error);
    }
    void shutdown
      .catch((error) => {
        reportError(error, "electrobun-desktop-host.before-quit");
      })
      .finally(() => {
        finishQuit();
      });
  };

  const removeBeforeQuitListener = (): void => {
    if (!beforeQuitListenerInstalled) {
      return;
    }
    beforeQuitListenerInstalled = false;
    Electrobun.events.off("before-quit", beforeQuitListener);
  };

  const startQuitGuard = (): void => {
    if (!options.onBeforeQuit || beforeQuitListenerInstalled || finalQuitStarted) {
      return;
    }
    Electrobun.events.on("before-quit", beforeQuitListener);
    beforeQuitListenerInstalled = true;
  };

  const finishQuit = (): void => {
    if (finalQuitStarted) {
      return;
    }
    finalQuitStarted = true;
    try {
      removeBeforeQuitListener();
    } catch (error) {
      reportError(error, "electrobun-desktop-host.before-quit-listener");
    }
    try {
      Utils.quit();
    } catch (error) {
      reportError(error, "electrobun-desktop-host.quit");
    }
  };

  const enqueueRendererNotification = (
    notification: DesktopRendererNotification,
  ): Promise<void> => {
    const rpc = rendererRpc;
    if (!rpc) {
      return Promise.reject(new Error("The Electrobun renderer API is not available."));
    }
    const delivery = rendererDelivery.then(() => {
      if (rendererRpc !== rpc) {
        throw new Error("The Electrobun renderer API changed before notification delivery.");
      }
      rpc.send.sendDesktopNotification(notification);
    });
    rendererDelivery = delivery.catch(() => undefined);
    return delivery;
  };

  const bufferRendererDelivery = (delivery: BufferedRendererDelivery): void => {
    if (
      bufferedRendererDeliveries.some(
        (candidate) => candidate.notification.kind === "read-model-rebaseline-required",
      )
    ) {
      if (isCommandInvalidation(delivery)) {
        bufferedRendererDeliveries.push(structuredClone(delivery));
      }
      return;
    }
    if (bufferedRendererDeliveries.length < MAX_RENDERER_HANDOFF_QUEUE_SIZE) {
      bufferedRendererDeliveries.push(structuredClone(delivery));
      return;
    }
    const rebaseline = {
      kind: "notification",
      notification: {
        kind: "read-model-rebaseline-required",
        reason: "slow-consumer",
        rebaselineRequired: true,
      },
    } satisfies BufferedRendererDelivery;
    const recoverableCommandInvalidations = [...bufferedRendererDeliveries, delivery].filter(
      isCommandInvalidation,
    );
    bufferedRendererDeliveries = [rebaseline, ...recoverableCommandInvalidations];
  };

  const bridge: DesktopBridgeAdapter = {
    async exposeRendererApi(input): Promise<DesktopBridgeRegistration> {
      if (rendererCallsRejectedWith !== undefined) {
        throw rendererCallsRejectedWith;
      }
      if (rendererRpc) {
        throw new Error("The Electrobun renderer API is already exposed.");
      }
      bridgeGeneration += 1;
      const generation = bridgeGeneration;
      rendererTransportReady = false;
      rendererDelivery = Promise.resolve();
      bufferedRendererDeliveries = [];
      let rendererReadySettled = false;
      let rendererReadySettlement: Promise<void> | null = null;
      let rendererReadySchedule: ReturnType<typeof setTimeout> | null = null;
      let resolveRendererReady!: () => void;
      let rejectRendererReady!: (error: unknown) => void;
      const rendererReady = new Promise<void>((resolve, reject) => {
        resolveRendererReady = resolve;
        rejectRendererReady = reject;
      });
      void rendererReady.catch(() => undefined);
      const settleRendererReady = (): Promise<void> => {
        if (rendererReadySettled || bridgeGeneration !== generation) {
          return Promise.resolve();
        }
        if (rendererReadySettlement) {
          return rendererReadySettlement;
        }
        clearTimeout(rendererReadyTimeout);
        rendererReadySettlement = (async () => {
          try {
            rendererTransportReady = true;
            const deliveries = bufferedRendererDeliveries;
            bufferedRendererDeliveries = [];
            const pendingDeliveries: Promise<void>[] = [];
            for (const delivery of deliveries) {
              pendingDeliveries.push(enqueueRendererNotification(delivery.notification));
            }
            await Promise.all(pendingDeliveries);
            rendererReadySettled = true;
            resolveRendererReady();
          } catch (error) {
            rendererTransportReady = false;
            rendererReadySettled = true;
            rejectRendererReady(error);
            throw error;
          }
        })();
        void rendererReadySettlement.catch(() => undefined);
        return rendererReadySettlement;
      };
      const scheduleRendererReady = (): void => {
        if (
          rendererReadySettled ||
          rendererReadySettlement ||
          rendererReadySchedule ||
          bridgeGeneration !== generation
        ) {
          return;
        }
        rendererReadySchedule = setTimeout(() => {
          rendererReadySchedule = null;
          void settleRendererReady();
        }, 0);
      };
      const rendererReadyTimeout = setTimeout(
        () => {
          if (rendererReadySettled || bridgeGeneration !== generation) {
            return;
          }
          rendererReadySettled = true;
          rejectRendererReady(
            new Error("The renderer did not report readiness before the deadline."),
          );
        },
        options.rendererReadyTimeoutMs ?? options.maxRequestTime ?? 120_000,
      );
      rendererReadyTimeout.unref?.();
      let rpc: BunRpc;
      try {
        rpc = defineElectrobunRPC<ChatRPCSchema, "bun">("bun", {
          maxRequestTime: options.maxRequestTime,
          handlers: options.buildRpcHandlers(input, { rendererReady: scheduleRendererReady }),
        });
      } catch (error) {
        rendererReadySettled = true;
        clearTimeout(rendererReadyTimeout);
        resolveRendererReady();
        throw error;
      }
      rendererRpc = rpc;
      let disposed = false;
      return {
        rendererReady,
        async dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          if (rendererReadySchedule) {
            clearTimeout(rendererReadySchedule);
            rendererReadySchedule = null;
          }
          if (!rendererReadySettled) {
            rendererReadySettled = true;
            clearTimeout(rendererReadyTimeout);
            resolveRendererReady();
          }
          if (bridgeGeneration === generation) {
            const currentRpc = rendererRpc;
            rendererRpc = null;
            rendererTransportReady = false;
            bufferedRendererDeliveries = [];
            currentRpc?.setTransport({});
          }
        },
      };
    },
    async sendToRenderer(notification: DesktopRendererNotification): Promise<void> {
      if (rendererCallsRejectedWith !== undefined) {
        throw rendererCallsRejectedWith;
      }
      const rpc = rendererRpc;
      if (!rpc) {
        throw new Error("The Electrobun renderer API is not available.");
      }
      if (!rendererTransportReady) {
        bufferRendererDelivery({ kind: "notification", notification });
        return;
      }
      try {
        await enqueueRendererNotification(notification);
      } catch (error) {
        reportError(error, "electrobun-desktop-host.send-to-renderer");
        throw error;
      }
    },
  };

  const windows: DesktopHostAdapter["windows"] = {
    async createMainWindow(input): Promise<DesktopWindowHandle> {
      if (mainWindow || mainWindowCreation) {
        throw new Error("The Electrobun main window already exists.");
      }
      const rpc = rendererRpc;
      if (!rpc) {
        throw new Error("Expose the Electrobun renderer API before creating the main window.");
      }

      mainWindowCreation = (async () => {
        const url = await options.resolveMainWindowUrl(input);
        const window = new BrowserWindow<BunRpc>({
          title: input.title,
          frame: { x: 0, y: 0, width: 1180, height: 820 },
          titleBarStyle:
            (options.platform ?? process.platform) === "darwin" ? "hiddenInset" : "default",
          hidden: (options.platform ?? process.platform) === "darwin",
          rpc,
        });
        const windowId = String(window.id) as DesktopWindowId;
        const closeEventName = `close-${window.id}`;
        let closed = false;
        let closeListenerInstalled = false;
        const nativeCloseListener = (): void => {
          record.markClosed();
        };
        const removeCloseListener = (): void => {
          if (!closeListenerInstalled) {
            return;
          }
          closeListenerInstalled = false;
          Electrobun.events.off(closeEventName, nativeCloseListener);
        };
        const record: MainWindowRecord = {
          window,
          windowId,
          markClosed() {
            if (closed) {
              return;
            }
            closed = true;
            removeCloseListener();
            if (mainWindow === record) {
              mainWindow = null;
            }
          },
          close() {
            if (closed) {
              return;
            }
            record.markClosed();
            window.close();
          },
        };
        mainWindow = record;
        try {
          Electrobun.events.on(closeEventName, nativeCloseListener);
          closeListenerInstalled = true;
          await options.prepareMainWindow?.(window);
          window.webview.loadURL(url);
          (options.positionTrafficLights ?? defaultPositionTrafficLights)(window);
          window.show();
        } catch (error) {
          shutdownStarted = true;
          record.close();
          throw error;
        }
        return {
          windowId,
          async dispose() {
            record.close();
          },
        };
      })();

      try {
        return await mainWindowCreation;
      } finally {
        mainWindowCreation = null;
      }
    },
    async focusWindow(input): Promise<void> {
      const record = requireMainWindow(input.windowId);
      record.window.focus();
    },
    async closeWindow(input): Promise<void> {
      requireMainWindow(input.windowId).close();
    },
  };

  const menus: DesktopHostAdapter["menus"] = {
    async installAppMenu(input): Promise<DesktopMenuRegistration> {
      let disposed = false;
      ensureApplicationMenuDispatcher();
      const dispatch = (event: ApplicationMenuClickEvent): void => {
        if (disposed) {
          return;
        }
        const route = routeAppMenuAction(event.data?.action);
        if (!route) {
          return;
        }
        let dispatched: void | Promise<void>;
        try {
          dispatched = input.sendRendererCommand(route.command);
        } catch (error) {
          reportError(error, "electrobun-desktop-host.menu-action");
          return;
        }
        void Promise.resolve(dispatched).catch((error) => {
          reportError(error, "electrobun-desktop-host.menu-action");
        });
      };
      ApplicationMenu.setApplicationMenu(
        buildAppMenuConfiguration({ includeSettings: options.includeSettingsMenuItem }),
      );
      activeApplicationMenuDispatch = dispatch;

      return {
        async dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          if (activeApplicationMenuDispatch === dispatch) {
            activeApplicationMenuDispatch = null;
            ApplicationMenu.setApplicationMenu([]);
          }
        },
      };
    },
  };

  const actions: DesktopHostAdapter["actions"] = {
    clipboard: {
      async writeText({ text }) {
        Utils.clipboardWriteText(text);
        return { ok: true };
      },
    },
    dialogs: {
      async pickFolder({ startingFolder }) {
        const selectedPaths = await Utils.openFileDialog({
          startingFolder,
          allowedFileTypes: "*",
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return { selectedPaths };
      },
      async pickFiles({ startingFolder }) {
        const selectedPaths = await Utils.openFileDialog({
          startingFolder,
          allowedFileTypes: "*",
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: true,
        });
        return { selectedPaths };
      },
    },
    paths: {
      async open({ path }) {
        return { opened: Utils.openPath(path) };
      },
      async reveal({ path }) {
        Utils.showItemInFolder(path);
        return { ok: true };
      },
    },
    editor: {
      async open({ path, cwd, editor, customCommand }) {
        if (editor === "system") {
          return { opened: Utils.openPath(path), editor };
        }

        const appNameByEditor = {
          code: "Visual Studio Code",
          cursor: "Cursor",
          zed: "Zed",
          sublime: "Sublime Text",
        } satisfies Record<Exclude<typeof editor, "system" | "custom">, string>;
        if (editor !== "custom") {
          try {
            launchDetached({
              command: "/usr/bin/open",
              args: ["-a", appNameByEditor[editor], path],
              cwd,
            });
            return { opened: true, editor };
          } catch (error) {
            return {
              opened: false,
              editor,
              failure: {
                kind: "app-launch",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        }

        const [command, ...baseArgs] = customCommand.split(/\s+/).filter(Boolean);
        if (!command) {
          return { opened: false, editor, failure: { kind: "custom-command-empty" } };
        }
        try {
          launchDetached({ command, args: [...baseArgs, path], cwd });
          return { opened: true, editor };
        } catch (error) {
          return {
            opened: false,
            editor,
            failure: {
              kind: "custom-command-launch",
              command,
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      },
    },
  };

  function requireMainWindow(windowId: DesktopWindowId): MainWindowRecord {
    if (!mainWindow || mainWindow.windowId !== windowId) {
      throw new Error(`Electrobun main window ${windowId} is not available.`);
    }
    return mainWindow;
  }

  return {
    bridge,
    windows,
    menus,
    actions,
    ...(options.browserTools ? { browserTools: options.browserTools } : {}),
    getMainWindow: () => mainWindow?.window ?? null,
    lifecycle: {
      start: startQuitGuard,
      finishQuit,
    },
    rejectRendererCalls(error) {
      shutdownStarted = true;
      rendererCallsRejectedWith = error;
      rendererTransportReady = false;
      bufferedRendererDeliveries = [];
      const rpc = rendererRpc;
      rendererRpc = null;
      try {
        rpc?.setTransport({});
      } catch (detachError) {
        reportError(detachError, "electrobun-desktop-host.reject-renderer-calls");
      }
    },
  };
}

function defaultPositionTrafficLights(window: BrowserWindow): void {
  positionNativeTrafficLights(window.ptr, { leading: 18, top: 13 });
}

export type ElectrobunRendererApiInput = RendererApiInput;
export type ElectrobunRpcHandlers = BunRpcConfig["handlers"];
