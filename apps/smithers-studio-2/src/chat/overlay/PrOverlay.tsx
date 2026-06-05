import type { PrSummary } from "./PrSummary";

const STATE_COLOR: Record<PrSummary["state"], string> = {
  open: "var(--success)",
  merged: "var(--accent)",
  draft: "var(--text-tertiary)",
};

const CHECK_COLOR = { pass: "var(--success)", fail: "var(--danger)", pending: "var(--warning)" } as const;

/**
 * The default PR view shown when the agent or `/pr` opens a pull request. SEAM:
 * fed from `PrSummary` (seeded today, VCS integration later).
 */
export function PrOverlay({ pr }: { pr: PrSummary }) {
  return (
    <div className="overlay-pr" data-testid="overlay-pr">
      <div className="overlay-pr-head">
        <span className="overlay-pr-state" style={{ color: STATE_COLOR[pr.state] }}>
          {pr.state.toUpperCase()}
        </span>
        <h2 className="overlay-pr-title">
          {pr.title} <span className="overlay-pr-number">#{pr.number}</span>
        </h2>
        <p className="overlay-pr-meta">
          {pr.author} wants to merge <code>{pr.branch}</code>
        </p>
      </div>

      <div className="overlay-pr-stats">
        <span className="overlay-pr-add">+{pr.additions}</span>
        <span className="overlay-pr-del">−{pr.deletions}</span>
        <span className="overlay-pr-files">{pr.changedFiles} files</span>
      </div>

      {pr.checks.length > 0 && (
        <ul className="overlay-pr-checks">
          {pr.checks.map((check) => (
            <li className="overlay-pr-check" key={check.name}>
              <span style={{ color: CHECK_COLOR[check.status] }}>●</span> {check.name}
              <span className="overlay-pr-check-status">{check.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
