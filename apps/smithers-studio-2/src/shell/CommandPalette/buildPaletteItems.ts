import type { NavItem } from "../navRegistry";
import type { PaletteItem } from "./PaletteItem";

const TIER_SECTION: Record<NavItem["tier"], string> = {
  primary: "Go to",
  more: "More",
  developer: "Developer",
};

export type PaletteActions = {
  goToView: (id: NavItem["id"]) => void;
  newTerminal: () => void;
  toggleDeveloperMode: () => void;
  developerMode: boolean;
};

/**
 * The full, flat superset of palette items: one "go to" command per registered
 * surface (so developer surfaces appear ONLY when registered) plus contextual
 * commands. This is the universal accelerator that lets the rail stay tiny.
 */
export function buildPaletteItems(registry: NavItem[], actions: PaletteActions): PaletteItem[] {
  const navItems: PaletteItem[] = registry.map((item) => ({
    id: `goto.${item.id}`,
    section: TIER_SECTION[item.tier],
    title: item.label,
    subtitle: `Go to ${item.label}`,
    icon: item.icon,
    run: () => actions.goToView(item.id),
  }));

  const commandItems: PaletteItem[] = [
    {
      id: "command.newTerminal",
      section: "Commands",
      title: "New Terminal",
      subtitle: "Open a new terminal tab in Workspace",
      icon: "⌨",
      shortcut: "⌘T",
      run: actions.newTerminal,
    },
    {
      id: "command.toggleDeveloperMode",
      section: "Commands",
      title: "Toggle Developer Mode",
      subtitle: actions.developerMode ? "Hide developer surfaces" : "Reveal developer surfaces",
      icon: "⚒",
      run: actions.toggleDeveloperMode,
    },
  ];

  return [...navItems, ...commandItems];
}
