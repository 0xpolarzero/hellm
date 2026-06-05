import type { WorkflowEntry } from "./workflowsApi";

/**
 * The left pane: a browseable list of workflows for the active segment. Each row
 * shows the name, a one-line summary, and small badges (UI / schedule state).
 * Selection is single-select; the selected row paints --fill-selected.
 */
export function WorkflowList({
  entries,
  loading,
  error,
  selectedKey,
  onSelect,
}: {
  entries: WorkflowEntry[];
  loading: boolean;
  error: string | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (loading) {
    return (
      <div className="wf-list-state" data-testid="wf.list.loading">
        Loading workflows…
      </div>
    );
  }
  if (error) {
    return (
      <div className="wf-list-state wf-list-state--error" data-testid="wf.list.error">
        {error}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="wf-list-state" data-testid="wf.list.empty">
        No workflows in this segment yet.
      </div>
    );
  }
  return (
    <ul className="wf-list" data-testid="wf.list">
      {entries.map((entry) => {
        const selected = entry.key === selectedKey;
        return (
          <li key={entry.key}>
            <button
              type="button"
              className={`wf-row${selected ? " wf-row--selected" : ""}`}
              data-testid={`wf.row.${entry.key}`}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(entry.key)}
            >
              <span className="wf-row-main">
                <span className="wf-row-name">{entry.name}</span>
                {entry.description ? <span className="wf-row-desc">{entry.description}</span> : null}
              </span>
              <span className="wf-row-badges">
                {entry.hasUi ? <span className="wf-badge wf-badge--ui">UI</span> : null}
                {entry.schedulePattern ? (
                  <span
                    className={`wf-badge ${entry.scheduleEnabled ? "wf-badge--on" : "wf-badge--off"}`}
                  >
                    {entry.scheduleEnabled ? "enabled" : "paused"}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
