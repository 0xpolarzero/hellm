import { useMemo } from "react";
import "./shell.css";
import { useStudioStore } from "../useStudioStore";
import { useHotkey } from "../useHotkey";
import { buildNavRegistry } from "./navRegistry";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette/CommandPalette";

/**
 * Remote/cloud feature flag. Off by default — flips the registry/Home remote
 * slots on without code changes when phase-2 wires the remote-mode controller.
 */
const REMOTE_FEATURE_ENABLED = false;

/**
 * The app shell: builds the nav registry from store flags, renders the sidebar
 * + the active surface (the registry's render()) + the command palette, and
 * owns global hotkeys. Phase-2 surface agents never edit this file.
 */
export function AppShell() {
  const activeView = useStudioStore((s) => s.activeView);
  const developerMode = useStudioStore((s) => s.developerMode);
  const paletteOpen = useStudioStore((s) => s.paletteOpen);
  const { openPalette, openTerminal } = useStudioStore.getState();

  useHotkey("p", openPalette);
  useHotkey("k", openPalette);
  useHotkey("t", openTerminal);

  const registry = useMemo(
    () => buildNavRegistry({ developerMode, remote: REMOTE_FEATURE_ENABLED }),
    [developerMode],
  );

  const active = registry.find((item) => item.id === activeView) ?? registry[0];

  return (
    <main className="studio-shell">
      <Sidebar registry={registry} />
      <div className="studio-content">{active.render()}</div>
      {paletteOpen ? <CommandPalette registry={registry} /> : null}
    </main>
  );
}
