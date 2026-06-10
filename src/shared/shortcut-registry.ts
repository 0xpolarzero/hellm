export type ShortcutScope = "global" | "workspace-shell" | "focused-pane" | "dialog" | "input";

export type ShortcutInputPolicy = "suppress-while-typing" | "allow-while-typing";

export type ShortcutActionId =
  | "commandPalette.open"
  | "quickOpen.open"
  | "workspace.open"
  | "workspace.newTab"
  | "workspace.openInNewTab"
  | "session.new"
  | "session.newPane"
  | "sidebar.toggle"
  | "surface.logs.open"
  | "surface.agents.open"
  | "surface.extensions.open"
  | "surface.workflows.open"
  | "dialog.close"
  | "commandPalette.submit"
  | "commandPalette.submitFocusedPane"
  | "composer.submit";

export type AppMenuAction = Extract<
  ShortcutActionId,
  | "commandPalette.open"
  | "quickOpen.open"
  | "workspace.open"
  | "workspace.newTab"
  | "workspace.openInNewTab"
  | "session.new"
  | "session.newPane"
  | "sidebar.toggle"
  | "surface.logs.open"
  | "surface.agents.open"
  | "surface.extensions.open"
  | "surface.workflows.open"
>;

export type ShortcutDefinition = {
  id: ShortcutActionId;
  label: string;
  hotkey: string;
  readableShortcut: string;
  compactShortcut: string;
  accelerator: string | null;
  scope: ShortcutScope;
  inputPolicy: ShortcutInputPolicy;
  commandActionId?: string;
};

export const SHORTCUTS = {
  "commandPalette.open": {
    id: "commandPalette.open",
    label: "Open Command Palette",
    hotkey: "Mod+Shift+P",
    readableShortcut: "Cmd+Shift+P",
    compactShortcut: "⌘⇧P",
    accelerator: "CommandOrControl+Shift+P",
    scope: "global",
    inputPolicy: "allow-while-typing",
    commandActionId: "commandPalette.open",
  },
  "quickOpen.open": {
    id: "quickOpen.open",
    label: "Open Quick Open",
    hotkey: "Mod+P",
    readableShortcut: "Cmd+P",
    compactShortcut: "⌘P",
    accelerator: "CommandOrControl+P",
    scope: "global",
    inputPolicy: "allow-while-typing",
    commandActionId: "quickOpen.open",
  },
  "workspace.open": {
    id: "workspace.open",
    label: "Open Workspace...",
    hotkey: "Mod+O",
    readableShortcut: "Cmd+O",
    compactShortcut: "⌘O",
    accelerator: "CommandOrControl+O",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
    commandActionId: "workspace.open",
  },
  "workspace.newTab": {
    id: "workspace.newTab",
    label: "New Tab",
    hotkey: "Mod+T",
    readableShortcut: "Cmd+T",
    compactShortcut: "⌘T",
    accelerator: "CommandOrControl+T",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
    commandActionId: "workspace.newTab",
  },
  "workspace.openInNewTab": {
    id: "workspace.openInNewTab",
    label: "Open Workspace in New Tab...",
    hotkey: "Mod+Shift+O",
    readableShortcut: "Cmd+Shift+O",
    compactShortcut: "⌘⇧O",
    accelerator: "CommandOrControl+Shift+O",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
    commandActionId: "workspace.openInNewTab",
  },
  "session.new": {
    id: "session.new",
    label: "New orchestrator",
    hotkey: "Mod+N",
    readableShortcut: "Cmd+N",
    compactShortcut: "⌘N",
    accelerator: "CommandOrControl+N",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
    commandActionId: "session.new",
  },
  "session.newPane": {
    id: "session.newPane",
    label: "New orchestrator in new pane",
    hotkey: "Mod+Shift+N",
    readableShortcut: "Cmd+Shift+N",
    compactShortcut: "⌘⇧N",
    accelerator: "CommandOrControl+Shift+N",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
  },
  "sidebar.toggle": {
    id: "sidebar.toggle",
    label: "Toggle Sidebar",
    hotkey: "Mod+B",
    readableShortcut: "Cmd+B",
    compactShortcut: "⌘B",
    accelerator: "CommandOrControl+B",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
    commandActionId: "sidebar.toggle",
  },
  "surface.logs.open": {
    id: "surface.logs.open",
    label: "Open Logs",
    hotkey: "Mod+Shift+1",
    readableShortcut: "Cmd+Shift+1",
    compactShortcut: "⌘⇧1",
    accelerator: "CommandOrControl+Shift+1",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
  },
  "surface.workflows.open": {
    id: "surface.workflows.open",
    label: "Open Workflows",
    hotkey: "Mod+Shift+4",
    readableShortcut: "Cmd+Shift+4",
    compactShortcut: "⌘⇧4",
    accelerator: "CommandOrControl+Shift+4",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
  },
  "surface.agents.open": {
    id: "surface.agents.open",
    label: "Open Agents",
    hotkey: "Mod+Shift+2",
    readableShortcut: "Cmd+Shift+2",
    compactShortcut: "⌘⇧2",
    accelerator: "CommandOrControl+Shift+2",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
  },
  "surface.extensions.open": {
    id: "surface.extensions.open",
    label: "Open Extensions",
    hotkey: "Mod+Shift+3",
    readableShortcut: "Cmd+Shift+3",
    compactShortcut: "⌘⇧3",
    accelerator: "CommandOrControl+Shift+3",
    scope: "workspace-shell",
    inputPolicy: "allow-while-typing",
  },
  "dialog.close": {
    id: "dialog.close",
    label: "Close Dialog",
    hotkey: "Escape",
    readableShortcut: "Escape",
    compactShortcut: "Esc",
    accelerator: null,
    scope: "dialog",
    inputPolicy: "allow-while-typing",
  },
  "commandPalette.submit": {
    id: "commandPalette.submit",
    label: "Run Selected Command",
    hotkey: "Enter",
    readableShortcut: "Enter",
    compactShortcut: "↵",
    accelerator: null,
    scope: "dialog",
    inputPolicy: "allow-while-typing",
  },
  "commandPalette.submitFocusedPane": {
    id: "commandPalette.submitFocusedPane",
    label: "Run In Focused Pane",
    hotkey: "Mod+Enter",
    readableShortcut: "Cmd+Enter",
    compactShortcut: "⌘↵",
    accelerator: null,
    scope: "dialog",
    inputPolicy: "allow-while-typing",
  },
  "composer.submit": {
    id: "composer.submit",
    label: "Send Prompt",
    hotkey: "Enter",
    readableShortcut: "Enter",
    compactShortcut: "↵",
    accelerator: null,
    scope: "input",
    inputPolicy: "allow-while-typing",
  },
} satisfies Record<ShortcutActionId, ShortcutDefinition>;

export function getShortcut(id: ShortcutActionId): ShortcutDefinition {
  return SHORTCUTS[id];
}

export function getShortcutHotkey(id: ShortcutActionId): string {
  return getShortcut(id).hotkey;
}

export function getShortcutReadable(id: ShortcutActionId): string {
  return getShortcut(id).readableShortcut;
}

export function getShortcutCompact(id: ShortcutActionId): string {
  return getShortcut(id).compactShortcut;
}

export function getShortcutAccelerator(id: ShortcutActionId): string | null {
  return getShortcut(id).accelerator;
}

export function shouldShortcutIgnoreInputs(id: ShortcutActionId): boolean {
  return getShortcut(id).inputPolicy === "suppress-while-typing";
}

const APP_MENU_ACTION_IDS = new Set<string>([
  "commandPalette.open",
  "quickOpen.open",
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
]);

export function isAppMenuAction(value: unknown): value is AppMenuAction {
  return typeof value === "string" && APP_MENU_ACTION_IDS.has(value);
}
