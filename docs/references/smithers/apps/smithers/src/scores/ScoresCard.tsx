import { openSurface } from "../app/navigation";
import { findReport } from "./scoreReport";

function ChartIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3v18h18M7 14l3-4 3 3 5-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Eval scorecard: metric tiles + a small trend spark + regression delta. */
export function ScoresCard({ reportId }: { reportId: string }) {
  const report = findReport(reportId);
  if (!report) {
    return null;
  }

  return (
    <article className="list-card" data-testid="scores-card">
      <header className="card-head">
        <span className="card-icon">
          <ChartIcon />
        </span>
        <div className="card-headings">
          <div className="card-title">Scores · {report.suite}</div>
          <div className="card-sub">regression vs last run</div>
        </div>
        <div className="card-head-right">
          <span className="status-pill tone-ok">
            <span className="status-dot" />
            {report.delta}
          </span>
          <button
            className="card-link"
            type="button"
            onClick={() => openSurface({ kind: "scores" })}
          >
            Open scores ›
          </button>
        </div>
      </header>
      <div className="card-body">
        <div className="score-tiles">
          {report.tiles.map((tile) => (
            <div className="score-tile" key={tile.name}>
              <div className="tile-name">{tile.name}</div>
              <div className="tile-value">{tile.value}</div>
            </div>
          ))}
        </div>
        <div className="spark">
          {report.trend.map((height, index) => (
            <span key={index} style={{ height: `${Math.round(height * 100)}%` }} />
          ))}
        </div>
      </div>
    </article>
  );
}
