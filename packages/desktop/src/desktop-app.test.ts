import { describe, expect, it } from "bun:test";
import {
  createDesktopApp,
  type CreateDesktopAppInput,
  type DesktopRendererNotification,
  type DesktopWindowId,
} from "./index";

function createInput(events: string[] = []): CreateDesktopAppInput {
  const runtime = {
    workspaces: {},
    surfaces: {},
    messages: {},
    queues: {},
    requestInput: {},
    approvals: {},
    sourceEdits: {},
    sourceInvalidation: {},
  } as CreateDesktopAppInput["runtime"];
  const state = {
    readModels: {
      fetch: async () => ({}),
      refetchInvalidation: async () => [],
      rebaseline: async () => ({}),
    },
  } as unknown as CreateDesktopAppInput["state"];
  const commands = {
    runtime: {},
    state: {
      appLogs: {
        markRead: async () => ({}),
        markVisibleRangeRead: async () => ({}),
        clearWorkspaceUnread: async () => ({}),
      },
    },
  } as unknown as CreateDesktopAppInput["commands"];

  return {
    runtime,
    state,
    commands,
    notifications: {
      start: async () => {
        events.push("notifications:start");
      },
      stop: async () => {
        events.push("notifications:stop");
      },
    },
    host: {
      bridge: {
        exposeRendererApi: async (api) => {
          events.push("bridge:expose");
          expect(api).toEqual({ runtime, state, commands });
          return {
            rendererReady: Promise.resolve(),
            dispose: async () => {
              events.push("bridge:dispose");
            },
          };
        },
        sendToRenderer: async (notification) => {
          events.push(`renderer:${notification.kind}`);
          if (notification.kind === "renderer-command") {
            events.push(`renderer-command:${notification.command}`);
          }
        },
      },
      windows: {
        createMainWindow: async (input) => {
          events.push(`window:create:${input.initialRoute}:${input.title}`);
          return {
            windowId: "desktop_window_01" as DesktopWindowId,
            dispose: async () => {
              events.push("window:dispose");
            },
          };
        },
        focusWindow: async () => {
          events.push("window:focus");
        },
        closeWindow: async () => {
          events.push("window:close");
        },
      },
      menus: {
        installAppMenu: async (menu) => {
          events.push("menu:install");
          await menu.commandPalette();
          await menu.quickOpen();
          await menu.openSettings();
          return {
            dispose: async () => {
              events.push("menu:dispose");
            },
          };
        },
      },
    },
  };
}

describe("@svvy/desktop createDesktopApp", () => {
  it("starts desktop host resources over injected facades only", async () => {
    const events: string[] = [];
    const app = createDesktopApp(createInput(events));

    await app.start();
    await app.dispose();

    expect(events).toEqual([
      "bridge:expose",
      "notifications:start",
      "window:create:workspace:svvy",
      "menu:install",
      "renderer:renderer-command",
      "renderer-command:command-palette.open",
      "renderer:renderer-command",
      "renderer-command:quick-open.open",
      "renderer:renderer-command",
      "renderer-command:settings.open",
      "menu:dispose",
      "notifications:stop",
      "window:dispose",
      "bridge:dispose",
    ]);
  });

  it("disposes already acquired host resources when startup fails", async () => {
    const events: string[] = [];
    const input = createInput(events);
    input.host.windows.createMainWindow = async () => {
      events.push("window:create-failed");
      throw new Error("window failed");
    };
    const app = createDesktopApp(input);

    await expect(app.start()).rejects.toThrow("window failed");

    expect(events).toEqual([
      "bridge:expose",
      "notifications:start",
      "window:create-failed",
      "notifications:stop",
      "bridge:dispose",
    ]);
  });

  it("does not acquire later resources when renderer bridge exposure fails", async () => {
    const events: string[] = [];
    const input = createInput(events);
    input.host.bridge.exposeRendererApi = async () => {
      events.push("bridge:expose-failed");
      throw new Error("bridge failed");
    };
    const app = createDesktopApp(input);

    await expect(app.start()).rejects.toThrow("bridge failed");

    expect(events).toEqual(["bridge:expose-failed"]);
  });

  it("disposes the renderer bridge when menu installation fails", async () => {
    const events: string[] = [];
    const input = createInput(events);
    input.host.menus.installAppMenu = async () => {
      events.push("menu:install-failed");
      throw new Error("menu failed");
    };
    const app = createDesktopApp(input);

    await expect(app.start()).rejects.toThrow("menu failed");

    expect(events).toEqual([
      "bridge:expose",
      "notifications:start",
      "window:create:workspace:svvy",
      "menu:install-failed",
      "notifications:stop",
      "window:dispose",
      "bridge:dispose",
    ]);
  });

  it("stops attempted notifications and disposes the renderer bridge when notification startup fails", async () => {
    const events: string[] = [];
    const input = createInput(events);
    input.notifications.start = async () => {
      events.push("notifications:start-failed");
      throw new Error("notifications failed");
    };
    const app = createDesktopApp(input);

    await expect(app.start()).rejects.toThrow("notifications failed");

    expect(events).toEqual([
      "bridge:expose",
      "notifications:start-failed",
      "notifications:stop",
      "bridge:dispose",
    ]);
  });

  it("coalesces app-bootstrap native/window shutdown disposal without releasing twice", async () => {
    const events: string[] = [];
    const app = createDesktopApp(createInput(events));
    const forwardNativeWindowShutdown = () => app.dispose();

    await Promise.all([app.start(), app.start()]);
    await Promise.all([
      forwardNativeWindowShutdown(),
      forwardNativeWindowShutdown(),
      app.dispose(),
    ]);

    expect(events.filter((event) => event === "bridge:expose")).toHaveLength(1);
    expect(events.filter((event) => event === "notifications:start")).toHaveLength(1);
    expect(events.filter((event) => event === "notifications:stop")).toHaveLength(1);
    expect(events.filter((event) => event === "window:dispose")).toHaveLength(1);
    expect(events.filter((event) => event === "menu:dispose")).toHaveLength(1);
    expect(events.filter((event) => event === "bridge:dispose")).toHaveLength(1);
    await expect(app.start()).rejects.toThrow("Cannot start a disposed desktop app.");
  });

  it("lets dispose interrupt startup at the current acquisition boundary", async () => {
    const events: string[] = [];
    const input = createInput(events);
    const exposed = createDeferred<void>();
    const bridgeRegistration = createDeferred<{
      readonly rendererReady: Promise<void>;
      dispose(): Promise<void>;
    }>();
    input.host.bridge.exposeRendererApi = async () => {
      events.push("bridge:expose-pending");
      exposed.resolve();
      return bridgeRegistration.promise;
    };
    const app = createDesktopApp(input);

    const start = app.start();
    await exposed.promise;
    const dispose = app.dispose();
    bridgeRegistration.resolve({
      rendererReady: Promise.resolve(),
      dispose: async () => {
        events.push("bridge:dispose");
      },
    });

    await expect(start).rejects.toThrow("disposed during startup");
    await dispose;
    expect(events).toEqual(["bridge:expose-pending", "bridge:dispose"]);
  });

  it("subscribes before renderer readiness but does not install the menu until the handshake", async () => {
    const events: string[] = [];
    const input = createInput(events);
    const rendererReady = createDeferred<void>();
    input.host.bridge.exposeRendererApi = async () => ({
      rendererReady: rendererReady.promise,
      dispose: async () => {
        events.push("bridge:dispose");
      },
    });
    const app = createDesktopApp(input);

    const start = app.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["notifications:start", "window:create:workspace:svvy"]);

    rendererReady.resolve();
    await start;
    expect(events).toContain("notifications:start");
    expect(events).toContain("menu:install");
    await app.dispose();
  });

  it("rejects stale menu callbacks after disposal without sending to the renderer", async () => {
    const events: string[] = [];
    const input = createInput(events);
    let commandPalette!: () => Promise<void>;
    input.host.menus.installAppMenu = async (menu) => {
      events.push("menu:install");
      commandPalette = menu.commandPalette;
      return {
        dispose: async () => {
          events.push("menu:dispose");
        },
      };
    };
    const app = createDesktopApp(input);

    await app.start();
    await app.dispose();
    const beforeStaleCallback = [...events];

    await expect(commandPalette()).rejects.toThrow("after desktop disposal");
    expect(events).toEqual(beforeStaleCallback);
  });

  it("accepts bounded surface stream patch notifications through the renderer bridge", async () => {
    const events: string[] = [];
    const input = createInput(events);
    const notification = {
      kind: "surface-stream-patch",
      eventGenerationId: "runtime_generation_01" as never,
      sequence: 1 as never,
      workspaceId: "workspace_01" as never,
      target: {
        surface: "orchestrator",
        workspaceSessionId: "workspace_session_01",
        surfacePiSessionId: "surface_pi_session_01",
      } as never,
      surfacePiSessionId: "surface_pi_session_01" as never,
      streamGenerationId: "stream_generation_01" as never,
      streamSequence: 1 as never,
      patch: {
        type: "assistant_text_delta",
        messageId: "message_01" as never,
        contentIndex: 0,
        delta: "hello",
      },
    } satisfies DesktopRendererNotification;

    await input.host.bridge.sendToRenderer(notification);

    expect(events).toEqual(["renderer:surface-stream-patch"]);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
