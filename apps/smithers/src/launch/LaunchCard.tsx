import { useCardUiStore } from "../cards/cardUiStore";
import { useChatStore } from "../chat/chatStore";
import { useRunsStore } from "../runs/runsStore";
import { findLaunchable } from "./launchables";

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A small launch form: just the inputs the workflow needs, then a run card. */
export function LaunchCard({ workflowId }: { workflowId: string }) {
  const launch = useRunsStore((state) => state.launch);
  const postCard = useChatStore((state) => state.postCard);
  const workflow = findLaunchable(workflowId);
  const depth = useCardUiStore((state) => state.depthByWorkflow[workflowId] ?? "Standard");
  const setDepth = useCardUiStore((state) => state.setDepth);

  if (!workflow) {
    return null;
  }

  return (
    <article className="launch-card" data-testid="launch-card">
      <header className="card-head">
        <span className="card-icon">
          <SearchIcon />
        </span>
        <div className="card-headings">
          <div className="card-title">Launch · {workflow.name}</div>
          <div className="card-sub">workflow · {workflow.blurb}</div>
        </div>
      </header>

      <div className="card-body">
        {workflow.fields.map((field) => (
          <div className="field" key={field.key}>
            <label>{field.label}</label>
            {field.type === "select" ? (
              <div className="opt-row">
                {field.options?.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === depth ? "opt is-pick" : "opt"}
                    onClick={() => setDepth(workflowId, option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <div className={field.type === "area" ? "field-input is-area" : "field-input"}>
                {field.placeholder}
              </div>
            )}
          </div>
        ))}
      </div>

      <footer className="card-foot">
        <button
          className="btn btn-brand"
          type="button"
          onClick={() => {
            const id = launch(`${workflow.name} · run`);
            postCard({ kind: "run", runId: id }, `Launched ${workflow.name}.`);
          }}
        >
          Launch ▸
        </button>
        <span className="card-foot-note">becomes a run card</span>
      </footer>
    </article>
  );
}
