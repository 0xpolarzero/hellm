import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { buildAppMenuConfiguration, routeAppMenuAction, type AppMenuActionRoute } from "./app-menu";

const remainingAppMenuActions = [
  "workspace.open",
  "workspace.newTab",
  "workspace.openInNewTab",
  "session.new",
  "session.newPane",
  "sidebar.toggle",
  "surface.logs.open",
  "surface.agents.open",
  "surface.extensions.open",
  "surface.workflows.open",
] as const;

describe("native app menu configuration", () => {
  it("expresses the current native menu structure with shortcut-owned action metadata", () => {
    expect(buildAppMenuConfiguration()).toEqual([
      {
        label: "svvy",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide", accelerator: "CommandOrControl+H" },
          { role: "hideOthers", accelerator: "CommandOrControl+Option+H" },
          { role: "showAll" },
          { type: "separator" },
          { role: "quit", accelerator: "CommandOrControl+Q" },
        ],
      },
      {
        label: "File",
        submenu: [
          {
            label: "Open Workspace...",
            action: "workspace.open",
            accelerator: "CommandOrControl+O",
          },
          {
            label: "New Tab",
            action: "workspace.newTab",
            accelerator: "CommandOrControl+T",
          },
          {
            label: "Open Workspace in New Tab...",
            action: "workspace.openInNewTab",
            accelerator: "CommandOrControl+Shift+O",
          },
          { type: "separator" },
          {
            label: "New orchestrator",
            action: "session.new",
            accelerator: "CommandOrControl+N",
          },
          {
            label: "New orchestrator in new pane",
            action: "session.newPane",
            accelerator: "CommandOrControl+Shift+N",
          },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo", accelerator: "CommandOrControl+Z" },
          { role: "redo", accelerator: "CommandOrControl+Shift+Z" },
          { type: "separator" },
          { role: "cut", accelerator: "CommandOrControl+X" },
          { role: "copy", accelerator: "CommandOrControl+C" },
          { role: "paste", accelerator: "CommandOrControl+V" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { type: "separator" },
          { role: "selectAll", accelerator: "CommandOrControl+A" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Open Command Palette",
            action: "commandPalette.open",
            accelerator: "CommandOrControl+Shift+P",
          },
          {
            label: "Open Quick Open",
            action: "quickOpen.open",
            accelerator: "CommandOrControl+P",
          },
          { type: "separator" },
          {
            label: "Toggle Sidebar",
            action: "sidebar.toggle",
            accelerator: "CommandOrControl+B",
          },
          { type: "separator" },
          {
            label: "Open Logs",
            action: "surface.logs.open",
            accelerator: "CommandOrControl+Shift+1",
          },
          {
            label: "Open Agents",
            action: "surface.agents.open",
            accelerator: "CommandOrControl+Shift+2",
          },
          {
            label: "Open Extensions",
            action: "surface.extensions.open",
            accelerator: "CommandOrControl+Shift+3",
          },
          {
            label: "Open Workflows",
            action: "surface.workflows.open",
            accelerator: "CommandOrControl+Shift+4",
          },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "close" },
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "bringAllToFront" },
        ],
      },
    ]);
  });

  it("optionally exposes Settings as a renderer command without changing the default menu", () => {
    const applicationMenu = buildAppMenuConfiguration({ includeSettings: true })[0];
    expect(applicationMenu?.submenu).toContainEqual({
      label: "Settings...",
      action: "settings.open",
      accelerator: "",
    });
    expect(routeAppMenuAction("settings.open")).toEqual({
      kind: "renderer-command",
      command: "settings.open",
    });
  });
});

describe("native app menu action routing", () => {
  it("routes adopted menu actions to renderer commands", () => {
    const routes: AppMenuActionRoute[] = [
      routeAppMenuAction("commandPalette.open")!,
      routeAppMenuAction("quickOpen.open")!,
      routeAppMenuAction("settings.open")!,
    ];
    expect(routes).toEqual([
      { kind: "renderer-command", command: "command-palette.open" },
      { kind: "renderer-command", command: "quick-open.open" },
      { kind: "renderer-command", command: "settings.open" },
    ]);
  });

  it("routes every remaining menu action to its typed renderer command", () => {
    expect(remainingAppMenuActions.map((action) => routeAppMenuAction(action))).toEqual(
      remainingAppMenuActions.map((command) => ({ kind: "renderer-command", command })),
    );
    expect(routeAppMenuAction("not-an-app-menu-action")).toBeNull();
    expect(routeAppMenuAction(undefined)).toBeNull();
  });

  it("has no Electrobun, runtime, or state dependency", async () => {
    const source = await readFile(new URL("./app-menu.ts", import.meta.url), "utf8");
    expect(source).not.toContain("electrobun");
    expect(source).not.toContain("@svvy/runtime");
    expect(source).not.toContain("@svvy/state");
  });
});
