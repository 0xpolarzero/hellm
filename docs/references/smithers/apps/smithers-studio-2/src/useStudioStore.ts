import { create } from "zustand";

type TerminalTab = { id: string; title: string; createdAt: Date };

/**
 * Every navigable surface id. Detail (run -> node -> tab, workflow segments,
 * sidebar section expansion) is colocated in each surface's own folder, NOT
 * added here — this union is only the top-level "which surface is mounted."
 */
export type ViewId =
  | "home"
  | "runs"
  | "workspace"
  | "workflows"
  | "issues"
  | "landings"
  | "workspaces"
  | "memory"
  | "scores"
  | "search"
  | "devtools"
  | "sql"
  | "logs";

/**
 * Backwards-compatible alias: the original app used view id "terminal". The
 * terminal now lives inside the Workspace surface, so "terminal" resolves to
 * "workspace". Hotkeys/tests that target "terminal" keep working.
 */
const TERMINAL_VIEW_ALIAS: ViewId = "workspace";

const DEVELOPER_MODE_STORAGE_KEY = "studio.developerMode";
const SHELL_MODE_STORAGE_KEY = "studio.shellMode";

/**
 * Which top-level shell renders. "chat" is the chat-first experience
 * (src/chat); "studio" is the original tabbed shell (src/shell/AppShell). The
 * chat shell is the default; the tabbed shell stays one toggle away (/studio or
 * the project-bar gear), so no previous view is ever removed.
 */
export type ShellMode = "chat" | "studio";

function readDeveloperMode(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY) === "true";
}

function persistDeveloperMode(value: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, value ? "true" : "false");
}

function readShellMode(): ShellMode {
  if (typeof localStorage === "undefined") return "chat";
  return localStorage.getItem(SHELL_MODE_STORAGE_KEY) === "studio" ? "studio" : "chat";
}

function persistShellMode(value: ShellMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SHELL_MODE_STORAGE_KEY, value);
}

function createTerminal(index: number): TerminalTab {
  return { id: crypto.randomUUID(), title: `Terminal ${index}`, createdAt: new Date() };
}

const firstTerminal: TerminalTab = {
  id: crypto.randomUUID(),
  title: "Terminal 1",
  createdAt: new Date(),
};

type StudioState = {
  // Terminal state (lives in the Workspace surface)
  tabs: TerminalTab[];
  activeTabId: string;

  // Nav state
  activeView: ViewId;
  developerMode: boolean;
  shellMode: ShellMode;

  // Command palette state
  paletteOpen: boolean;
  paletteQuery: string;
  selectedPaletteIndex: number;

  // Terminal actions
  openTerminal: () => void;
  closeTerminal: (tabId: string) => void;
  setActiveTabId: (id: string) => void;

  // Nav actions
  setActiveView: (view: ViewId | "terminal") => void;
  toggleDeveloperMode: () => void;
  setShellMode: (mode: ShellMode) => void;

  // Palette actions
  openPalette: () => void;
  closePalette: () => void;
  setPaletteQuery: (query: string) => void;
  setSelectedPaletteIndex: (index: number | ((prev: number) => number)) => void;
};

export const useStudioStore = create<StudioState>((set, get) => ({
  tabs: [firstTerminal],
  activeTabId: firstTerminal.id,
  activeView: "home",
  developerMode: readDeveloperMode(),
  shellMode: readShellMode(),
  paletteOpen: false,
  paletteQuery: "",
  selectedPaletteIndex: 0,

  openTerminal: () => {
    const { tabs } = get();
    const next = createTerminal(tabs.length + 1);
    set({
      tabs: [...tabs, next],
      activeTabId: next.id,
      activeView: "workspace",
      paletteOpen: false,
      paletteQuery: "",
    });
  },

  closeTerminal: (tabId: string) => {
    const { tabs, activeTabId } = get();
    if (tabs.length === 1) return;
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    const nextActiveId = tabId === activeTabId ? (nextTabs.at(-1)?.id ?? nextTabs[0].id) : activeTabId;
    set({ tabs: nextTabs, activeTabId: nextActiveId });
  },

  setActiveTabId: (id: string) => set({ activeTabId: id }),

  setActiveView: (view) =>
    set({ activeView: view === "terminal" ? TERMINAL_VIEW_ALIAS : view, paletteOpen: false }),

  toggleDeveloperMode: () =>
    set((state) => {
      const next = !state.developerMode;
      persistDeveloperMode(next);
      // If the active surface was a developer surface, fall back to Home so we
      // never strand the user on an unregistered route.
      const developerViews: ViewId[] = ["devtools", "sql", "logs"];
      const activeView = !next && developerViews.includes(state.activeView) ? "home" : state.activeView;
      return { developerMode: next, activeView };
    }),

  setShellMode: (mode) => {
    persistShellMode(mode);
    set({ shellMode: mode });
  },

  openPalette: () => set({ paletteOpen: true }),

  closePalette: () => set({ paletteOpen: false, paletteQuery: "", selectedPaletteIndex: 0 }),

  setPaletteQuery: (query: string) => set({ paletteQuery: query, selectedPaletteIndex: 0 }),

  setSelectedPaletteIndex: (index) =>
    set((state) => ({
      selectedPaletteIndex: typeof index === "function" ? index(state.selectedPaletteIndex) : index,
    })),
}));
