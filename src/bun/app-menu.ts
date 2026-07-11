import {
  getShortcut,
  getShortcutAccelerator,
  isAppMenuAction,
  type AppMenuAction,
} from "../shared/shortcut-registry";

export type AppMenuRendererCommand = "command-palette.open" | "quick-open.open" | "settings.open";

export type AppMenuNativeAction = AppMenuAction | "settings.open";

export type AppMenuActionRoute =
  | { readonly kind: "renderer-command"; readonly command: AppMenuRendererCommand }
  | { readonly kind: "legacy-app-menu-action"; readonly action: LegacyAppMenuAction };

export type LegacyAppMenuAction = Exclude<AppMenuAction, "commandPalette.open" | "quickOpen.open">;

export type AppMenuRole =
  | "about"
  | "hide"
  | "hideOthers"
  | "showAll"
  | "quit"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "pasteAndMatchStyle"
  | "delete"
  | "selectAll"
  | "close"
  | "minimize"
  | "zoom"
  | "bringAllToFront";

export type AppMenuItem =
  | { readonly type: "separator" }
  | { readonly role: AppMenuRole; readonly accelerator?: string }
  | {
      readonly label: string;
      readonly action: AppMenuNativeAction;
      readonly accelerator: string;
    };

export interface AppMenuSection {
  readonly label: string;
  readonly submenu: AppMenuItem[];
}

export type AppMenuConfiguration = AppMenuSection[];

export interface BuildAppMenuConfigurationOptions {
  readonly includeSettings?: boolean;
}

const LEGACY_APP_MENU_ACTIONS = [
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
] as const satisfies readonly LegacyAppMenuAction[];

const LEGACY_APP_MENU_ACTION_SET = new Set<AppMenuAction>(LEGACY_APP_MENU_ACTIONS);

export function buildAppMenuConfiguration(
  options: BuildAppMenuConfigurationOptions = {},
): AppMenuConfiguration {
  const applicationItems: AppMenuItem[] = [{ role: "about" }, { type: "separator" }];
  if (options.includeSettings) {
    applicationItems.push({ label: "Settings...", action: "settings.open", accelerator: "" });
    applicationItems.push({ type: "separator" });
  }
  applicationItems.push(
    { role: "hide", accelerator: "CommandOrControl+H" },
    { role: "hideOthers", accelerator: "CommandOrControl+Option+H" },
    { role: "showAll" },
    { type: "separator" },
    { role: "quit", accelerator: "CommandOrControl+Q" },
  );

  return [
    { label: "svvy", submenu: applicationItems },
    {
      label: "File",
      submenu: [
        shortcutMenuItem("workspace.open"),
        shortcutMenuItem("workspace.newTab"),
        shortcutMenuItem("workspace.openInNewTab"),
        { type: "separator" },
        shortcutMenuItem("session.new"),
        shortcutMenuItem("session.newPane"),
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
        shortcutMenuItem("commandPalette.open"),
        shortcutMenuItem("quickOpen.open"),
        { type: "separator" },
        shortcutMenuItem("sidebar.toggle"),
        { type: "separator" },
        shortcutMenuItem("surface.logs.open"),
        shortcutMenuItem("surface.agents.open"),
        shortcutMenuItem("surface.extensions.open"),
        shortcutMenuItem("surface.workflows.open"),
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
  ];
}

export function routeAppMenuAction(action: unknown): AppMenuActionRoute | null {
  if (action === "settings.open") {
    return { kind: "renderer-command", command: "settings.open" };
  }
  if (!isAppMenuAction(action)) {
    return null;
  }
  if (action === "commandPalette.open") {
    return { kind: "renderer-command", command: "command-palette.open" };
  }
  if (action === "quickOpen.open") {
    return { kind: "renderer-command", command: "quick-open.open" };
  }
  if (LEGACY_APP_MENU_ACTION_SET.has(action)) {
    return { kind: "legacy-app-menu-action", action: action as LegacyAppMenuAction };
  }
  return null;
}

function shortcutMenuItem(action: AppMenuAction): AppMenuItem {
  return {
    label: getShortcut(action).label,
    action,
    accelerator: getShortcutAccelerator(action) ?? "",
  };
}
