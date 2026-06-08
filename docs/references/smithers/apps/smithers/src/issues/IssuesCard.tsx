import { openSurface } from "../app/navigation";
import { summarizeIssues, toneForIssueState } from "./issues";
import { useIssuesStore } from "./issuesStore";

function CircleDotIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

/** The inline issues card: open/closed counts and the first few open issues. */
export function IssuesCard() {
  const issues = useIssuesStore((state) => state.issues);
  const openCreate = useIssuesStore((state) => state.openCreate);
  const summary = summarizeIssues(issues);
  const ordered = issues.filter((i) => i.state === "open").concat(issues.filter((i) => i.state === "closed"));
  const shown = ordered.slice(0, 4);

  return (
    <article className="list-card" data-testid="issues-card">
      <header className="card-head">
        <span className="card-icon">
          <CircleDotIcon />
        </span>
        <div className="card-headings">
          <div className="card-title">Issues</div>
          <div className="card-sub">
            {summary.open} open · {summary.closed} closed
          </div>
        </div>
        <button className="card-link" type="button" onClick={() => openSurface({ kind: "issues" })}>
          Open issues ›
        </button>
      </header>

      <div className="card-body card-body-flush">
        {shown.map((issue) => (
          <div className="list-row" key={issue.id}>
            <span className={`rev-dot ${toneForIssueState(issue.state)}`} />
            <div className="list-text">
              <div className="list-name">{issue.title}</div>
              <div className="list-meta">
                <span className="rev-num">#{issue.number}</span>
                {issue.labels.slice(0, 3).map((label) => (
                  <span className="mini-tag" key={label}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
            {issue.commentCount > 0 ? (
              <div className="list-tags">
                <span className="mini-tag">{issue.commentCount}</span>
              </div>
            ) : null}
          </div>
        ))}
        {summary.total > shown.length ? (
          <div className="rev-more">+{summary.total - shown.length} more</div>
        ) : null}
      </div>

      <footer className="card-foot">
        <button
          className="btn"
          type="button"
          onClick={() => {
            openCreate();
            openSurface({ kind: "issues" });
          }}
        >
          New issue
        </button>
      </footer>
    </article>
  );
}
