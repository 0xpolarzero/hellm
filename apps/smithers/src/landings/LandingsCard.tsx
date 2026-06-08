import { openSurface } from "../app/navigation";
import { summarizeLandings, toneForLandingState } from "./landings";
import { useLandingsStore } from "./landingsStore";

function LandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v12M7 11l5 4 5-4M5 21h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The inline landings card: open/merged counts and a jump to the canvas. */
export function LandingsCard() {
  const landings = useLandingsStore((state) => state.landings);
  const summary = summarizeLandings(landings);
  const shown = landings.slice(0, 4);

  return (
    <article className="list-card" data-testid="landings-card">
      <header className="card-head">
        <span className="card-icon">
          <LandIcon />
        </span>
        <div className="card-headings">
          <div className="card-title">Landings</div>
          <div className="card-sub">
            {summary.open} open · {summary.merged} merged
          </div>
        </div>
        <button className="card-link" type="button" onClick={() => openSurface({ kind: "landings" })}>
          Open landings ›
        </button>
      </header>

      <div className="card-body card-body-flush">
        {shown.map((landing) => (
          <div className="list-row" key={landing.id}>
            <span className={`rev-dot ${toneForLandingState(landing.state)}`} />
            <div className="list-text">
              <div className="list-name">{landing.title}</div>
              <div className="list-meta">
                <span className="rev-num">#{landing.number}</span>{" "}
                <span className="mini-tag">{landing.reviewStatus}</span>
              </div>
            </div>
            <div className="list-tags">
              <span className={`state-badge ${toneForLandingState(landing.state)}`}>
                {landing.state.toUpperCase()}
              </span>
            </div>
          </div>
        ))}
        {landings.length > shown.length ? (
          <div className="rev-more">+{landings.length - shown.length} more</div>
        ) : null}
      </div>
    </article>
  );
}
