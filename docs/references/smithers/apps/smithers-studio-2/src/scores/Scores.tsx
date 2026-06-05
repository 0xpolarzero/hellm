import { useCallback, useEffect, useState } from "react";
import "./scores.css";
import {
  listWorkspaceScores,
  type WorkspaceAggregateScore,
  type WorkspaceScoreRow,
  type WorkspaceScoreRun,
} from "../workspaceApi";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(2) : "—";
}

function formatTimestamp(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

/** A score's signal class: green high, amber mid, red low — the only color here. */
function scoreTone(score: number): string {
  if (!Number.isFinite(score)) return "scores-tone-neutral";
  if (score >= 0.8) return "scores-tone-success";
  if (score >= 0.5) return "scores-tone-warning";
  return "scores-tone-danger";
}

type LoadStatus = "loading" | "ready" | "error";

/**
 * Scores — scorer results, read-only analytics. Wired to the real `/scores`
 * endpoint via workspaceApi. Shows per-scorer aggregates as a calm summary strip
 * over a row table, with a run filter so you can scope to one run. Low density:
 * no charts, no editing — this later folds into a tab inside a selected Run.
 */
export function Scores() {
  const [rows, setRows] = useState<WorkspaceScoreRow[]>([]);
  const [aggregates, setAggregates] = useState<WorkspaceAggregateScore[]>([]);
  const [runs, setRuns] = useState<WorkspaceScoreRun[]>([]);
  const [runFilter, setRunFilter] = useState<string>("");
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState("Loading scores…");

  const load = useCallback(async (runId: string) => {
    setStatus("loading");
    setMessage("Loading scores…");
    try {
      const payload = await listWorkspaceScores({ runId: runId || undefined });
      setRows(payload.scores);
      setAggregates(payload.aggregates);
      setRuns(payload.runs);
      setStatus("ready");
      setMessage(
        payload.scores.length === 0
          ? "No scorer results recorded yet."
          : `${payload.scores.length} score${payload.scores.length === 1 ? "" : "s"} across ${payload.aggregates.length} scorer${payload.aggregates.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setRows([]);
      setAggregates([]);
      setRuns([]);
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load(runFilter);
  }, [runFilter, load]);

  return (
    <section className="scores-surface" data-testid="view.scores">
      <header className="scores-header">
        <h2 className="scores-title">Scores</h2>
        <select
          className="scores-runfilter"
          value={runFilter}
          onChange={(event) => setRunFilter(event.target.value)}
          data-testid="scores.runfilter"
          aria-label="Filter scores by run"
        >
          <option value="">All runs</option>
          {runs.map((run) => (
            <option key={run.runId} value={run.runId}>
              {shortId(run.runId)} ({run.count})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="scores-refresh"
          data-testid="scores.refresh"
          onClick={() => void load(runFilter)}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="scores-statusbar">
        <span className={`scores-statustext scores-statustext-${status}`} data-testid="scores.status">
          {message}
        </span>
      </div>

      {aggregates.length > 0 ? (
        <div className="scores-aggregates" data-testid="scores.aggregates">
          {aggregates.map((aggregate) => (
            <div key={aggregate.scorerId} className="scores-aggregate-card">
              <span className="scores-aggregate-name">{aggregate.scorerName}</span>
              <span className={`scores-aggregate-mean ${scoreTone(aggregate.mean)}`}>
                {formatScore(aggregate.mean)}
              </span>
              <span className="scores-aggregate-meta">
                n={aggregate.count} · {formatScore(aggregate.min)}–{formatScore(aggregate.max)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="scores-body">
        {rows.length === 0 ? (
          <div className="scores-empty">{message}</div>
        ) : (
          <table className="scores-table" data-testid="scores.table">
            <thead>
              <tr>
                <th>Scorer</th>
                <th>Score</th>
                <th>Run</th>
                <th>Node</th>
                <th>Source</th>
                <th>Reason</th>
                <th>Scored</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="scores-row" data-testid="scores.row">
                  <td className="scores-cell-scorer">{row.scorerName}</td>
                  <td>
                    <span className={`scores-pill ${scoreTone(row.score)}`}>{formatScore(row.score)}</span>
                  </td>
                  <td className="scores-cell-mono" title={row.runId}>{shortId(row.runId)}</td>
                  <td className="scores-cell-mono" title={row.nodeId}>{shortId(row.nodeId)}</td>
                  <td className="scores-cell-source">{row.source}</td>
                  <td className="scores-cell-reason" title={row.reason ?? ""}>{row.reason ?? "—"}</td>
                  <td className="scores-cell-time">{formatTimestamp(row.scoredAtMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
