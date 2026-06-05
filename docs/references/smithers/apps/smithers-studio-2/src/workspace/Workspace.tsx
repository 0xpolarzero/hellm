import { Suspense, useState } from "react";
import "./workspace.css";
import { AgentChat } from "./AgentChat";
import { GhosttyTerminalPane } from "./GhosttyTerminalPane";
import { WorkspaceSegment, type WorkspaceSegmentId } from "./WorkspaceSegment";
import { useStudioStore } from "../useStudioStore";

/**
 * Workspace surface — the hands-on pane. Phase-1 ships the existing Ghostty
 * terminal with its tab model UNTOUCHED (terminal-tab / close-terminal /
 * terminal-status testids preserved). The agent-chat segment is filled by the
 * phase-2 Workspace agent (src/workspace/AgentChat.tsx + WorkspaceSegment.tsx)
 * without touching the terminal wiring below.
 */
export function Workspace() {
  const tabs = useStudioStore((s) => s.tabs);
  const activeTabId = useStudioStore((s) => s.activeTabId);
  const { closeTerminal } = useStudioStore.getState();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const [segment, setSegment] = useState<WorkspaceSegmentId>("terminal");
  const chatActive = segment === "chat";

  return (
    <section aria-label="Workspace" className="workspace">
      <header className="workspace-header">
        <div>
          <span>{chatActive ? "Agent chat" : "Active terminal"}</span>
          <h1>{chatActive ? "Chat" : activeTab?.title ?? "Terminal"}</h1>
        </div>
        <div className="workspace-header-actions">
          <WorkspaceSegment onChange={setSegment} value={segment} />
          <button
            data-testid="close-terminal"
            disabled={chatActive || tabs.length === 1}
            onClick={() => activeTab && closeTerminal(activeTab.id)}
            type="button"
          >
            Close Tab
          </button>
        </div>
      </header>
      {/*
        The terminal stack stays MOUNTED across segment changes so the PTY
        session and Ghostty scrollback survive a Terminal→Chat→Terminal round
        trip; it is hidden (not unmounted) when chat is active. The terminal
        wiring and its testids are untouched.
      */}
      <div className="terminal-stack" hidden={chatActive}>
        <Suspense fallback={<div className="terminal-loading">Loading Ghostty terminal.</div>}>
          {tabs.map((tab) => (
            <div
              className={tab.id === activeTabId ? "terminal-tab active" : "terminal-tab"}
              data-testid="terminal-tab"
              key={tab.id}
            >
              <GhosttyTerminalPane active={!chatActive && tab.id === activeTabId} tab={tab} />
            </div>
          ))}
        </Suspense>
      </div>
      {/*
        AgentChat stays MOUNTED across segment changes (hidden + inert when the
        terminal is showing) so the loaded session, transcript, and any
        in-flight stream survive a Chat→Terminal→Chat round trip. Unmounting it
        on every switch would abort the stream and discard all chat history.
        `inert` also drops the hidden composer out of the focus/tab order so it
        can't steal focus or keystrokes meant for the active terminal.
      */}
      <div className="chat-stack" hidden={!chatActive} inert={!chatActive}>
        <AgentChat active={chatActive} />
      </div>
    </section>
  );
}
