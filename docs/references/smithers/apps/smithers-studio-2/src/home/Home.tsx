import "./home.css";
import { useRecentWorkspaces } from "./useRecentWorkspaces";
import { RecentWorkspaceRow } from "./RecentWorkspaceRow";
import { OperationsStrip } from "./OperationsStrip";
import { useStudioStore } from "../useStudioStore";

const GITHUB_URL = "https://github.com/smithersai/smithers-app";
const TAGLINE = "Agent operations console for Smithers workflows and terminal sessions";

/**
 * Cloud/remote sign-in is gated, exactly like the gui WelcomeView: when the
 * flag is off we render NOTHING for the third action slot. Phase-2 wires this
 * to the real remote-mode controller.
 */
const REMOTE_FEATURE_ENABLED = false;

/**
 * Home — the WELCOME altitude. Port of gui/WelcomeView.swift: a calm centered
 * column (max-width 720, vertical spacing 32) with header, action row, recents,
 * and a live Operations strip. When the workspace backend is unreachable it
 * shows a connect/boot panel instead of empty recents so the first screen is
 * never a dead end.
 */
export function Home() {
  const setActiveView = useStudioStore((s) => s.setActiveView);
  const { recents, loading, connected, error, refresh, open, remove } = useRecentWorkspaces();

  const openFolder = async () => {
    const path = window.prompt("Open folder — absolute path:");
    if (!path) return;
    const ok = await open(path);
    if (ok) setActiveView("workspace");
  };

  const openRecent = async (path: string) => {
    const ok = await open(path);
    if (ok) setActiveView("workspace");
  };

  return (
    <section className="home" data-testid="view.welcome">
      <div className="home-column">
        <header className="home-header">
          <span aria-hidden className="home-glyph">
            {"\u{1F528}"}
          </span>
          <h1 className="home-title">Smithers Studio</h1>
          <p className="home-tagline">{TAGLINE}</p>
        </header>

        <div className="home-actions">
          <button className="home-action home-action--primary" onClick={openFolder} type="button">
            Open Folder…
          </button>
          {REMOTE_FEATURE_ENABLED ? (
            <button className="home-action home-action--secondary" type="button">
              Sign in to Smithers Cloud
            </button>
          ) : null}
          <a className="home-action home-action--secondary" href={GITHUB_URL} rel="noreferrer" target="_blank">
            Star on GitHub
          </a>
        </div>

        <div className="home-divider" />

        <div className="home-recents">
          <span className="home-recents-label">Recent Workspaces</span>

          {!connected ? (
            <div className="home-boot" data-testid="home.boot">
              <p className="home-boot-title">No workspace gateway connected</p>
              <p className="home-boot-body">
                {error ? `Connection error: ${error}` : "Start the workspace server, then retry."}
              </p>
              <button className="home-action home-action--secondary" onClick={() => void refresh()} type="button">
                Retry connection
              </button>
            </div>
          ) : loading ? (
            <p className="home-recents-empty">Loading recent workspaces…</p>
          ) : recents.length === 0 ? (
            <p className="home-recents-empty">No recent workspaces yet — open a folder to get started.</p>
          ) : (
            <div className="home-recents-list">
              {recents.map((entry) => (
                <RecentWorkspaceRow
                  entry={entry}
                  key={entry.path}
                  onOpen={() => void openRecent(entry.path)}
                  onRemove={() => void remove(entry.path)}
                />
              ))}
            </div>
          )}

          {connected ? <OperationsStrip /> : null}
        </div>
      </div>
    </section>
  );
}
