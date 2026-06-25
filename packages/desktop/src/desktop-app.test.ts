import { describe, expect, it } from "bun:test";
import { createDesktopApp, type CreateDesktopAppInput, type DesktopWindowId } from "./index";

function createInput(events: string[] = []): CreateDesktopAppInput {
  const runtime = {
    workspaces: {},
    surfaces: {},
    messages: {},
    queues: {},
    requestInput: {},
    commands: {},
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
    close: () => {},
  };
  const commands = {
    runtime: runtime.commands,
    state: {},
  };

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
      "menu:install",
      "renderer:renderer-command",
      "renderer-command:command-palette.open",
      "renderer:renderer-command",
      "renderer-command:quick-open.open",
      "renderer:renderer-command",
      "renderer-command:settings.open",
      "window:create:workspace:svvy",
      "notifications:start",
      "notifications:stop",
      "window:dispose",
      "menu:dispose",
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
      "menu:install",
      "renderer:renderer-command",
      "renderer-command:command-palette.open",
      "renderer:renderer-command",
      "renderer-command:quick-open.open",
      "renderer:renderer-command",
      "renderer-command:settings.open",
      "window:create-failed",
      "menu:dispose",
      "bridge:dispose",
    ]);
  });
});
