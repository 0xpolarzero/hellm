import { useMemo, useState } from "react";
import type { ApprovalSummary, RunNodeState, RunSummary } from "./runState";
import { isRunningState } from "./runState";
import { stateColor, stateLabel } from "./stateColor";

type HistoryFilter = "all" | "running" | "approvals" | "failed";

const FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "approvals", label: "Approvals" },
  { id: "failed", label: "Failed" },
];

function matches(
  run: RunSummary,
  filter: HistoryFilter,
  approvalRunIds: Set<string>,
): boolean {
  switch (filter) {
    case "running":
      return isRunningState(run.status);
    case "approvals":
      return approvalRunIds.has(run.runId) || run.status === "waiting-approval";
    case "failed":
      return run.status === "failed";
    default:
      return true;
  }
}

function shortId(runId: string): string {
  return runId.length > 10 ? `${runId.slice(0, 10)}…` : runId;
}

/**
 * The run-history list. Surfaces approvals as a first-class filter (the
 * de-spaceshipping move: approvals are a state of a run, not a sibling view),
 * marks runs that have a pending gate with an amber dot, and drives selection.
 */
export function RunHistoryList(props: {
  runs: RunSummary[];
  approvals: ApprovalSummary[];
  selectedRunId: string | undefined;
  onSelectRun: (runId: string) => void;
}) {
  const { runs, approvals, selectedRunId, onSelectRun } = props;
  const [filter, setFilter] = useState<HistoryFilter>("all");

  const approvalRunIds = useMemo(
    () => new Set(approvals.map((approval) => approval.runId)),
    [approvals],
  );

  const visible = useMemo(
    () => runs.filter((run) => matches(run, filter, approvalRunIds)),
    [runs, filter, approvalRunIds],
  );

  return (
    <div className="runs-history" data-testid="runs.history">
      <div className="runs-history-filters" role="tablist" aria-label="Run filter">
        {FILTERS.map((entry) => {
          const count =
            entry.id === "approvals" ? approvalRunIds.size : undefined;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={filter === entry.id}
              className={`runs-history-filter${filter === entry.id ? " runs-history-filter--active" : ""}`}
              data-testid={`runs.filter.${entry.id}`}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
              {count ? <span className="runs-history-filter-count">{count}</span> : null}
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <div className="runs-history-empty">
          {runs.length === 0 ? "No runs yet." : "No runs match this filter."}
        </div>
      ) : (
        <ul className="runs-history-list">
          {visible.map((run) => {
            const hasGate =
              approvalRunIds.has(run.runId) || run.status === "waiting-approval";
            return (
              <li key={run.runId}>
                <button
                  type="button"
                  className={`runs-history-row${run.runId === selectedRunId ? " runs-history-row--selected" : ""}`}
                  data-testid={`runs.history.row.${run.runId}`}
                  aria-current={run.runId === selectedRunId}
                  onClick={() => onSelectRun(run.runId)}
                >
                  <span
                    className="runs-history-dot"
                    style={{ background: stateColor(run.status) }}
                    aria-hidden
                  />
                  <span className="runs-history-name">{run.workflowKey ?? "run"}</span>
                  <span className="runs-history-id">{shortId(run.runId)}</span>
                  {hasGate ? <span className="runs-history-gate">gate</span> : null}
                  <StatusPill status={run.status} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: RunNodeState }) {
  return (
    <span
      className="runs-status-pill"
      style={{ color: stateColor(status), borderColor: stateColor(status) }}
    >
      {stateLabel(status)}
    </span>
  );
}
