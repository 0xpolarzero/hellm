import "./logs.css";
import { useEventLog } from "./useEventLog";

const LEVELS = ["error", "warn", "info", "debug"];

function levelClass(level: string): string {
  const normalized = level.toLowerCase();
  if (normalized.startsWith("err")) return "logs-level-error";
  if (normalized.startsWith("warn")) return "logs-level-warn";
  if (normalized.startsWith("debug") || normalized.startsWith("trace")) return "logs-level-debug";
  return "logs-level-info";
}

/**
 * Logs — global event-log firehose over the workspace `/logs` HTTP API.
 * Developer-gated. Dense, mono, filterable by level / category / free-text.
 */
export function Logs() {
  const { entries, stats, loading, error, filters, setLevel, setCategory, setQuery } = useEventLog();

  return (
    <section className="logs-surface" data-testid="view.logs">
      <header className="logs-header">
        <h2 className="logs-title">Logs</h2>
        {stats ? (
          <div className="logs-stats" data-testid="logs.stats">
            <span>{stats.entryCount} entries</span>
            <span className="logs-stat-error">{stats.errorCount} errors</span>
            <span className="logs-stat-warn">{stats.warningCount} warnings</span>
          </div>
        ) : null}
      </header>

      <div className="logs-toolbar">
        <input
          className="logs-search"
          data-testid="logs.search"
          type="search"
          aria-label="Filter logs by text"
          placeholder="Filter logs…"
          value={filters.query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="logs-level"
          data-testid="logs.level"
          aria-label="Filter logs by level"
          value={filters.level ?? ""}
          onChange={(event) => setLevel(event.target.value || null)}
        >
          <option value="">All levels</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <select
          className="logs-category"
          data-testid="logs.category"
          aria-label="Filter logs by category"
          value={filters.category ?? ""}
          onChange={(event) => setCategory(event.target.value || null)}
        >
          <option value="">All categories</option>
          {(stats?.categories ?? []).map((entry) => (
            <option key={entry.category} value={entry.category}>
              {entry.category} ({entry.count})
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="logs-error" data-testid="logs.error">
          {error}
        </div>
      ) : null}

      <div className="logs-stream" data-testid="logs.stream">
        {loading ? (
          <div className="logs-loading" data-testid="logs.loading">
            Loading logs…
          </div>
        ) : entries.length === 0 ? (
          <div className="logs-empty" data-testid="logs.empty">
            No log entries match the current filters.
          </div>
        ) : (
          entries.map((entry) => (
            <div className="logs-row" data-testid="logs.row" key={entry.id}>
              <span className="logs-ts">{entry.timestamp ?? ""}</span>
              <span className={`logs-badge ${levelClass(entry.level)}`}>{entry.level}</span>
              <span className="logs-cat">{entry.category}</span>
              <span className="logs-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
