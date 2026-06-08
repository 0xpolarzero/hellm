import { openSurface } from "../app/navigation";
import { STATUS_GLYPH, summarize } from "./vcs";
import { useVcsStore } from "./vcsStore";

function BranchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 3v12M6 21a2 2 0 1 0 0-.01M6 3a2 2 0 1 0 0 .01M18 9a2 2 0 1 0 0-.01M18 9c0 4-6 2-6 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The inline VCS card: branch + working-tree counts and a jump to the canvas. */
export function VcsCard() {
  const tree = useVcsStore((state) => state.tree);
  const runAction = useVcsStore((state) => state.runAction);
  const summary = summarize(tree);
  const shown = tree.changes.slice(0, 4);

  return (
    <article className="list-card vcs-card" data-testid="vcs-card">
      <header className="card-head">
        <span className="card-icon">
          <BranchIcon />
        </span>
        <div className="card-headings">
          <div className="card-title">Changes</div>
          <div className="card-sub">
            <code className="cron-pattern">{tree.branch}</code> · {summary.total} file
            {summary.total === 1 ? "" : "s"} · <span className="delta-add">+{summary.add}</span>{" "}
            <span className="delta-del">−{summary.del}</span>
          </div>
        </div>
        <button
          className="card-link"
          type="button"
          onClick={() => openSurface({ kind: "vcs" })}
        >
          Open changes ›
        </button>
      </header>

      <div className="card-body card-body-flush">
        {shown.map((change) => (
          <div className="list-row" key={change.path}>
            <span className={`vcs-glyph is-${change.status}`}>{STATUS_GLYPH[change.status]}</span>
            <div className="list-text">
              <div className="list-name vcs-path">{change.path}</div>
            </div>
            <div className="list-tags">
              {change.add > 0 ? <span className="delta-add">+{change.add}</span> : null}
              {change.del > 0 ? <span className="delta-del">−{change.del}</span> : null}
              <span className={change.staged ? "ready-dot is-on" : "ready-dot"} />
            </div>
          </div>
        ))}
        {summary.total > shown.length ? (
          <div className="vcs-more">+{summary.total - shown.length} more</div>
        ) : null}
      </div>

      <footer className="card-foot">
        <button className="btn" type="button" onClick={() => runAction("status")}>
          Status
        </button>
        <button className="btn btn-brand" type="button" onClick={() => runAction("commit")}>
          Commit ({summary.staged})
        </button>
      </footer>
    </article>
  );
}
