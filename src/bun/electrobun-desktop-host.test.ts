import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { DesktopRendererNotification } from "@svvy/desktop";

const calls: string[] = [];
const notifications: DesktopRendererNotification[] = [];
const configuredMenus: unknown[] = [];
let menuListener: ((event: unknown) => void) | undefined;
let beforeQuitListener: ((event: { response?: { allow: boolean } }) => void) | undefined;
const windowCloseListeners = new Map<string, (event: { data: { id: number } }) => void>();
let menuListenerInstallCount = 0;
let nextWindowId = 1;
let rpcDetachFailure: Error | null = null;
let beforeQuitInstallFailure: Error | null = null;
let rendererSendFailure: Error | null = null;
let lastRpcConfig: {
  handlers?: { requests?: { rendererReady?: () => Promise<{ ok: true }> } };
} | null = null;

class FakeBrowserWindow {
  readonly id = nextWindowId++;
  readonly ptr = 1;
  readonly webview = {
    loadURL: (url: string) => calls.push(`window.load:${url}`),
  };
  constructor(readonly options: Record<string, unknown>) {
    calls.push("window.construct");
  }
  close() {
    calls.push("window.close");
  }
  focus() {
    calls.push("window.focus");
  }
  show() {
    calls.push("window.show");
  }
}

mock.module("electrobun/bun", () => ({
  default: {
    events: {
      on(name: string, listener: (event: never) => void) {
        if (name === "before-quit") {
          if (beforeQuitInstallFailure) throw beforeQuitInstallFailure;
          beforeQuitListener = listener as typeof beforeQuitListener;
        } else if (name.startsWith("close-")) {
          windowCloseListeners.set(name, listener as (event: { data: { id: number } }) => void);
        }
      },
      off(name: string, listener: (event: never) => void) {
        if (name === "before-quit" && beforeQuitListener === listener) {
          beforeQuitListener = undefined;
        } else if (windowCloseListeners.get(name) === listener) {
          windowCloseListeners.delete(name);
        }
      },
    },
  },
  BrowserWindow: FakeBrowserWindow,
  defineElectrobunRPC: (_side: string, config: unknown) => {
    calls.push("rpc.define");
    lastRpcConfig = config as typeof lastRpcConfig;
    const sendProxy = {
      sendDesktopNotification(notification: DesktopRendererNotification) {
        if (rendererSendFailure) throw rendererSendFailure;
        notifications.push(structuredClone(notification));
      },
      sendAppMenuAction(payload: unknown) {
        calls.push(`legacy:${JSON.stringify(payload)}`);
      },
    };
    const send = Object.assign(
      (messageName: keyof typeof sendProxy, payload: unknown) =>
        sendProxy[messageName](payload as never),
      sendProxy,
    );
    return {
      config,
      setTransport() {
        calls.push("rpc.detach");
        if (rpcDetachFailure) throw rpcDetachFailure;
      },
      send,
      sendProxy,
    };
  },
  Utils: {
    quit() {
      calls.push("app.quit");
    },
  },
  ApplicationMenu: {
    setApplicationMenu(menu: unknown) {
      configuredMenus.push(structuredClone(menu));
    },
    on(_name: string, listener: (event: unknown) => void) {
      menuListener = listener;
      menuListenerInstallCount += 1;
    },
  },
}));

const { createElectrobunDesktopHostAdapter } = await import("./electrobun-desktop-host");

function createHost(
  overrides: Partial<Parameters<typeof createElectrobunDesktopHostAdapter>[0]> = {},
) {
  const legacyActions: string[] = [];
  const errors: string[] = [];
  const host = createElectrobunDesktopHostAdapter({
    maxRequestTime: 1_000,
    buildRpcHandlers: (_input, lifecycle) => ({
      requests: {
        rendererReady: async () => {
          lifecycle.rendererReady();
          return { ok: true as const };
        },
      } as never,
    }),
    resolveMainWindowUrl: ({ initialRoute }) => `views://main/index.html?route=${initialRoute}`,
    includeSettingsMenuItem: true,
    platform: "darwin",
    positionTrafficLights: () => calls.push("window.position-traffic-lights"),
    onLegacyAppMenuAction: (action) => {
      legacyActions.push(action);
    },
    onError: (error, context) => errors.push(`${context}:${String(error)}`),
    ...overrides,
  });
  return { host, legacyActions, errors };
}

async function reportRendererReady(): Promise<void> {
  const handler = lastRpcConfig?.handlers?.requests?.rendererReady;
  if (!handler) {
    throw new Error("The renderer-ready handler was not installed.");
  }
  await handler();
}

const rendererApiInput = {
  runtime: {} as never,
  state: {} as never,
  commands: {} as never,
};

describe("Electrobun desktop host adapter", () => {
  beforeEach(() => {
    calls.length = 0;
    notifications.length = 0;
    configuredMenus.length = 0;
    beforeQuitListener = undefined;
    windowCloseListeners.clear();
    nextWindowId = 1;
    rpcDetachFailure = null;
    beforeQuitInstallFailure = null;
    rendererSendFailure = null;
    lastRpcConfig = null;
  });

  it("exposes RPC and prepares the native window before renderer navigation", async () => {
    let capturedRendererApiInput: unknown;
    const { host } = createHost({
      buildRpcHandlers: (input) => {
        capturedRendererApiInput = input;
        return { requests: {} as never };
      },
      prepareMainWindow: async () => {
        calls.push("window.prepare");
      },
    });
    await expect(
      host.windows.createMainWindow({ initialRoute: "workspace", title: "svvy" }),
    ).rejects.toThrow("Expose the Electrobun renderer API");

    const bridge = await host.bridge.exposeRendererApi(rendererApiInput);
    const windowHandle = await host.windows.createMainWindow({
      initialRoute: "workspace",
      title: "svvy",
    });

    expect(calls).toEqual([
      "rpc.define",
      "window.construct",
      "window.prepare",
      "window.load:views://main/index.html?route=workspace",
      "window.position-traffic-lights",
      "window.show",
    ]);
    expect(capturedRendererApiInput).toBe(rendererApiInput);
    expect((host.getMainWindow() as unknown as FakeBrowserWindow).options).toMatchObject({
      title: "svvy",
      hidden: true,
      titleBarStyle: "hiddenInset",
      rpc: expect.any(Object),
    });
    expect((host.getMainWindow() as unknown as FakeBrowserWindow).options).not.toHaveProperty(
      "url",
    );

    await host.windows.focusWindow({ windowId: windowHandle.windowId });
    await windowHandle.dispose();
    await windowHandle.dispose();
    expect(calls.slice(-2)).toEqual(["window.focus", "window.close"]);
    expect(host.getMainWindow()).toBeNull();
    await bridge.dispose();
  });

  it("guards renderer notification delivery across bridge disposal", async () => {
    const { host } = createHost();
    const notification = {
      kind: "renderer-command",
      command: "settings.open",
    } satisfies DesktopRendererNotification;

    await expect(host.bridge.sendToRenderer(notification)).rejects.toThrow("not available");
    const registration = await host.bridge.exposeRendererApi(rendererApiInput);
    await host.bridge.sendToRenderer(notification);
    expect(notifications).toEqual([]);
    await reportRendererReady();
    expect(notifications).toEqual([]);
    await registration.rendererReady;
    expect(notifications).toEqual([notification]);
    await registration.dispose();
    await registration.dispose();
    expect(calls).toContain("rpc.detach");
    await expect(host.bridge.sendToRenderer(notification)).rejects.toThrow("not available");
  });

  it("keeps legacy renderer sends inside the guarded host transport", async () => {
    const { host } = createHost();
    await expect(
      host.sendLegacyMessage("sendAppMenuAction", { action: "workspace.open" }),
    ).rejects.toThrow("not available");
    const registration = await host.bridge.exposeRendererApi(rendererApiInput);
    await host.sendLegacyMessage("sendAppMenuAction", { action: "workspace.open" });
    expect(calls).not.toContain('legacy:{"action":"workspace.open"}');
    await reportRendererReady();
    await registration.rendererReady;
    expect(calls).toContain('legacy:{"action":"workspace.open"}');
    await registration.dispose();
  });

  it("acknowledges concurrent renderer-ready calls before one shared failing buffer flush", async () => {
    const { host } = createHost();
    const registration = await host.bridge.exposeRendererApi(rendererApiInput);
    await host.bridge.sendToRenderer({ kind: "renderer-command", command: "settings.open" });
    rendererSendFailure = new Error("buffered delivery failed");

    const firstReady = reportRendererReady();
    const secondReady = reportRendererReady();

    const results = await Promise.allSettled([firstReady, secondReady, registration.rendererReady]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(
      results.map((result) =>
        result.status === "rejected" && result.reason instanceof Error
          ? result.reason.message
          : null,
      ),
    ).toEqual([null, null, "buffered delivery failed"]);
    await registration.dispose();
  });

  it("collapses an overflowing startup handoff queue into one rebaseline request", async () => {
    const { host } = createHost();
    const registration = await host.bridge.exposeRendererApi(rendererApiInput);
    for (let index = 0; index < 65; index += 1) {
      await host.bridge.sendToRenderer({
        kind: "read-model-changed",
        eventGenerationId: "generation-startup" as never,
        sequence: (index + 1) as never,
        scope: { kind: "app" },
        invalidation: { scope: "app", invalidation: { model: "appPreferences" } },
      });
    }

    await reportRendererReady();
    await registration.rendererReady;

    expect(notifications).toEqual([
      {
        kind: "read-model-rebaseline-required",
        reason: "slow-consumer",
        rebaselineRequired: true,
      },
    ]);
    await registration.dispose();
  });

  it("terminally rejects renderer calls with the normalized startup error", async () => {
    const { host } = createHost({ onBeforeQuit: async () => {} });
    host.lifecycle.start();
    const registration = await host.bridge.exposeRendererApi(rendererApiInput);
    const startupError = {
      operation: "desktop.startup",
      reason: "desktop-shutdown",
      message: "The desktop runtime is unavailable.",
    } as const;

    host.rejectRendererCalls(startupError);

    expect(calls).toContain("rpc.detach");
    expect(beforeQuitListener).toBeDefined();
    await expect(
      host.bridge.sendToRenderer({ kind: "renderer-command", command: "settings.open" }),
    ).rejects.toBe(startupError);
    await expect(
      host.sendLegacyMessage("sendAppMenuAction", { action: "workspace.open" }),
    ).rejects.toBe(startupError);
    await expect(host.bridge.exposeRendererApi(rendererApiInput)).rejects.toBe(startupError);
    await registration.dispose();
    host.lifecycle.finishQuit();
    expect(beforeQuitListener).toBeUndefined();
  });

  it("keeps typed renderer rejection authoritative when transport diagnostics fail", async () => {
    const { host } = createHost({
      onBeforeQuit: async () => {},
      onError: () => {
        throw new Error("diagnostics failed");
      },
    });
    host.lifecycle.start();
    await host.bridge.exposeRendererApi(rendererApiInput);
    const startupError = new Error("typed startup failure");
    rpcDetachFailure = new Error("transport detach failed");

    expect(() => host.rejectRendererCalls(startupError)).not.toThrow();
    expect(beforeQuitListener).toBeDefined();
    await expect(
      host.bridge.sendToRenderer({ kind: "renderer-command", command: "settings.open" }),
    ).rejects.toBe(startupError);
  });

  it("retains the quit guard through programmatic window cleanup and quits only at finalization", async () => {
    let shutdownCalls = 0;
    const { host } = createHost({
      onBeforeQuit: async () => {
        shutdownCalls += 1;
      },
    });
    host.lifecycle.start();
    await host.bridge.exposeRendererApi(rendererApiInput);
    const windowHandle = await host.windows.createMainWindow({
      initialRoute: "workspace",
      title: "svvy",
    });

    host.rejectRendererCalls(new Error("programmatic shutdown"));
    await windowHandle.dispose();
    const closeInducedQuit: { response?: { allow: boolean } } = {};
    beforeQuitListener?.(closeInducedQuit);

    expect(closeInducedQuit.response).toEqual({ allow: false });
    expect(shutdownCalls).toBe(0);
    expect(calls).not.toContain("app.quit");
    expect(beforeQuitListener).toBeDefined();

    host.lifecycle.finishQuit();
    expect(beforeQuitListener).toBeUndefined();
    expect(calls.filter((call) => call === "app.quit")).toHaveLength(1);
  });

  it("defers native quit until app-owned asynchronous shutdown completes", async () => {
    let finishShutdown!: () => void;
    const shutdown = new Promise<void>((resolve) => {
      finishShutdown = resolve;
    });
    const { host } = createHost({ onBeforeQuit: () => shutdown });
    host.lifecycle.start();
    const registration = await host.bridge.exposeRendererApi(rendererApiInput);
    const event: { response?: { allow: boolean } } = {};

    beforeQuitListener?.(event);
    expect(event.response).toEqual({ allow: false });
    expect(calls).not.toContain("app.quit");
    finishShutdown();
    await shutdown;
    await Promise.resolve();
    expect(calls).toContain("app.quit");
    await registration.dispose();
  });

  it("still quits when app-owned shutdown throws synchronously", async () => {
    const shutdownFailure = new Error("synchronous shutdown failure");
    const { host, errors } = createHost({
      onBeforeQuit: () => {
        throw shutdownFailure;
      },
    });
    host.lifecycle.start();
    await host.bridge.exposeRendererApi(rendererApiInput);
    const event: { response?: { allow: boolean } } = {};

    expect(() => beforeQuitListener?.(event)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(event.response).toEqual({ allow: false });
    expect(errors).toEqual([
      "electrobun-desktop-host.before-quit:Error: synchronous shutdown failure",
    ]);
    expect(calls.filter((call) => call === "app.quit")).toHaveLength(1);
  });

  it("guards reentrant before-quit events before invoking app-owned shutdown", async () => {
    let shutdownCalls = 0;
    const reentrantEvent: { response?: { allow: boolean } } = {};
    const { host } = createHost({
      onBeforeQuit: () => {
        shutdownCalls += 1;
        beforeQuitListener?.(reentrantEvent);
      },
    });
    host.lifecycle.start();
    await host.bridge.exposeRendererApi(rendererApiInput);
    const firstEvent: { response?: { allow: boolean } } = {};

    beforeQuitListener?.(firstEvent);
    await Promise.resolve();
    await Promise.resolve();

    expect(firstEvent.response).toEqual({ allow: false });
    expect(reentrantEvent.response).toEqual({ allow: false });
    expect(shutdownCalls).toBe(1);
    expect(calls.filter((call) => call === "app.quit")).toHaveLength(1);
  });

  it("reports quit-guard registration failure before renderer exposure", async () => {
    const { host } = createHost({ onBeforeQuit: async () => {} });
    beforeQuitInstallFailure = new Error("listener registration failed");

    expect(() => host.lifecycle.start()).toThrow("listener registration failed");
    expect(calls).toEqual([]);
    beforeQuitInstallFailure = null;
    const registration = await host.bridge.exposeRendererApi(rendererApiInput);
    await registration.dispose();
  });

  it("installs renderer-command routes and preserves the explicit legacy menu route", async () => {
    const { host, legacyActions } = createHost();
    const rendererCommands: string[] = [];
    const registration = await host.menus.installAppMenu({
      commandPalette: async () => {
        rendererCommands.push("command-palette.open");
      },
      quickOpen: async () => {
        rendererCommands.push("quick-open.open");
      },
      openSettings: async () => {
        rendererCommands.push("settings.open");
      },
    });

    expect(configuredMenus).toHaveLength(1);
    expect(JSON.stringify(configuredMenus[0])).toContain('"action":"settings.open"');
    menuListener?.({ data: { action: "commandPalette.open" } });
    menuListener?.({ data: { action: "quickOpen.open" } });
    menuListener?.({ data: { action: "settings.open" } });
    menuListener?.({ data: { action: "workspace.open" } });
    await Promise.resolve();
    expect(rendererCommands).toEqual(["command-palette.open", "quick-open.open", "settings.open"]);
    expect(legacyActions).toEqual(["workspace.open"]);

    await registration.dispose();
    await registration.dispose();
    expect(configuredMenus.at(-1)).toEqual([]);
    menuListener?.({ data: { action: "workspace.newTab" } });
    expect(legacyActions).toEqual(["workspace.open"]);
  });

  it("reuses one process menu listener while replacing the active registration", async () => {
    const first = createHost();
    const firstActions: string[] = [];
    const firstRegistration = await first.host.menus.installAppMenu({
      commandPalette: async () => {
        firstActions.push("command-palette.open");
      },
      quickOpen: async () => {
        firstActions.push("quick-open.open");
      },
      openSettings: async () => {
        firstActions.push("settings.open");
      },
    });
    const listenerCountAfterFirstInstall = menuListenerInstallCount;

    const second = createHost();
    const secondActions: string[] = [];
    const secondRegistration = await second.host.menus.installAppMenu({
      commandPalette: async () => {
        secondActions.push("command-palette.open");
      },
      quickOpen: async () => {
        secondActions.push("quick-open.open");
      },
      openSettings: async () => {
        secondActions.push("settings.open");
      },
    });
    menuListener?.({ data: { action: "settings.open" } });
    await Promise.resolve();

    expect(menuListenerInstallCount).toBe(listenerCountAfterFirstInstall);
    expect(firstActions).toEqual([]);
    expect(secondActions).toEqual(["settings.open"]);

    await firstRegistration.dispose();
    menuListener?.({ data: { action: "quickOpen.open" } });
    await Promise.resolve();
    expect(secondActions).toEqual(["settings.open", "quick-open.open"]);
    await secondRegistration.dispose();
  });

  it("reports synchronous menu callback failures without escaping the native listener", async () => {
    const errors: string[] = [];
    const { host } = createHost({
      onError: (error, context) => errors.push(`${context}:${String(error)}`),
    });
    const registration = await host.menus.installAppMenu({
      commandPalette: () => {
        throw new Error("menu callback failed");
      },
      quickOpen: async () => {},
      openSettings: async () => {},
    });

    expect(() => menuListener?.({ data: { action: "commandPalette.open" } })).not.toThrow();
    expect(errors).toEqual(["electrobun-desktop-host.menu-action:Error: menu callback failed"]);
    await registration.dispose();
  });

  it("closes the main window idempotently through either host window path", async () => {
    const { host } = createHost();
    await host.bridge.exposeRendererApi(rendererApiInput);
    const windowHandle = await host.windows.createMainWindow({
      initialRoute: "settings",
      title: "svvy settings",
    });

    await host.windows.closeWindow({ windowId: windowHandle.windowId });
    await windowHandle.dispose();
    expect(calls.filter((call) => call === "window.close")).toHaveLength(1);
    await expect(host.windows.focusWindow({ windowId: windowHandle.windowId })).rejects.toThrow(
      "is not available",
    );
  });

  it("invalidates the window before native close triggers shutdown", async () => {
    let shutdownCalls = 0;
    const { host } = createHost({
      onBeforeQuit: async () => {
        shutdownCalls += 1;
      },
    });
    host.lifecycle.start();
    await host.bridge.exposeRendererApi(rendererApiInput);
    const windowHandle = await host.windows.createMainWindow({
      initialRoute: "workspace",
      title: "svvy",
    });
    const closeEventName = `close-${windowHandle.windowId}`;

    windowCloseListeners.get(closeEventName)?.({
      data: { id: Number(windowHandle.windowId) },
    });
    expect(host.getMainWindow()).toBeNull();
    expect(windowCloseListeners.has(closeEventName)).toBeFalse();

    const firstQuitEvent: { response?: { allow: boolean } } = {};
    const secondQuitEvent: { response?: { allow: boolean } } = {};
    beforeQuitListener?.(firstQuitEvent);
    beforeQuitListener?.(secondQuitEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(firstQuitEvent.response).toEqual({ allow: false });
    expect(secondQuitEvent.response).toEqual({ allow: false });
    expect(shutdownCalls).toBe(1);
    expect(calls.filter((call) => call === "app.quit")).toHaveLength(1);

    await windowHandle.dispose();
    expect(calls.filter((call) => call === "window.close")).toHaveLength(0);
  });
});
