import { useState } from "react";
import type { WorkspaceLocalRecent } from "../workspaceApi";

/**
 * Tilde-abbreviate the user's home directory the way the gui WelcomeView does
 * (`/Users/me/x` -> `~/x`). Best-effort; non-home paths are returned as-is.
 */
function abbreviatePath(path: string): string {
  const match = path.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (!match) return path;
  return `~${match[1] ?? ""}`;
}

export type RecentWorkspaceRowProps = {
  entry: WorkspaceLocalRecent;
  onOpen: () => void;
  onRemove: () => void;
};

export function RecentWorkspaceRow({ entry, onOpen, onRemove }: RecentWorkspaceRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`home-recent-row${entry.exists ? "" : " home-recent-row--missing"}`}
      data-testid="welcome.recent.row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className="home-recent-open"
        disabled={!entry.exists}
        onClick={onOpen}
        type="button"
      >
        <span aria-hidden className="home-recent-glyph">
          {entry.exists ? "\u{1F4C1}" : "\u{1F4C2}"}
        </span>
        <span className="home-recent-text">
          <span className="home-recent-name">{entry.displayName}</span>
          <span className="home-recent-path">{abbreviatePath(entry.path)}</span>
        </span>
      </button>
      {hovered ? (
        <button
          aria-label={`Remove ${entry.displayName} from recents`}
          className="home-recent-remove"
          data-testid="welcome.recent.remove"
          onClick={onRemove}
          type="button"
        >
          {"×"}
        </button>
      ) : null}
    </div>
  );
}
