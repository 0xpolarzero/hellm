import { Suspense } from "react";
import { GhosttyTerminalPane } from "../../workspace/GhosttyTerminalPane";
import { useStudioStore } from "../../useStudioStore";

/**
 * Live terminal overlay. Reuses the real Ghostty PTY pane and the shared
 * terminal tab from the studio store, so `/terminal` shows the same real
 * terminal the classic Workspace surface does.
 */
export function TerminalOverlay() {
  const tabs = useStudioStore((s) => s.tabs);
  const activeTabId = useStudioStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div className="overlay-terminal" data-testid="overlay-terminal">
      <Suspense fallback={<div className="overlay-terminal-loading">Loading terminal…</div>}>
        <GhosttyTerminalPane active tab={tab} />
      </Suspense>
    </div>
  );
}
