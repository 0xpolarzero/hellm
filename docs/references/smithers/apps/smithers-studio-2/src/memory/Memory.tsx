import { useCallback, useEffect, useRef, useState } from "react";
import "./memory.css";
import { listWorkspaceMemoryFacts, type WorkspaceMemoryFact } from "../workspaceApi";

const SEARCH_DEBOUNCE_MS = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTimestamp(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatValue(valueJson: string): string {
  try {
    const parsed = JSON.parse(valueJson) as unknown;
    if (typeof parsed === "string") return parsed;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return valueJson;
  }
}

type LoadStatus = "loading" | "ready" | "error";

/**
 * Memory — cross-run memory facts, read-mostly. A calm searchable list wired to
 * the real `/memory` endpoint via workspaceApi. Selecting a fact reveals its full
 * value in a side detail pane. Search debounces and re-queries the server so the
 * namespace/key/value FTS happens where the data lives.
 */
export function Memory() {
  const [facts, setFacts] = useState<WorkspaceMemoryFact[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState("Loading memory facts…");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const load = useCallback(async (search: string) => {
    const generation = ++requestGeneration.current;
    setStatus("loading");
    setMessage("Loading memory facts…");
    try {
      const payload = await listWorkspaceMemoryFacts({ query: search.trim() || undefined });
      if (generation !== requestGeneration.current) return;
      setFacts(payload.facts);
      setDbPath(payload.dbPath);
      setStatus("ready");
      setMessage(
        payload.facts.length === 0
          ? search.trim()
            ? `No facts match “${search.trim()}”.`
            : "No memory facts recorded yet."
          : `${payload.facts.length} fact${payload.facts.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setFacts([]);
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, load]);

  const factKey = (fact: WorkspaceMemoryFact) => `${fact.namespace}::${fact.key}`;
  const selected = facts.find((fact) => factKey(fact) === selectedKey) ?? null;

  return (
    <section className="memory-surface" data-testid="view.memory">
      <header className="memory-header">
        <h2 className="memory-title">Memory</h2>
        <input
          className="memory-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search namespace, key, or value…"
          data-testid="memory.search"
          aria-label="Search memory facts"
        />
        <button
          type="button"
          className="memory-refresh"
          data-testid="memory.refresh"
          onClick={() => void load(query)}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="memory-statusbar" data-testid="memory.status">
        <span className={`memory-statustext memory-statustext-${status}`}>{message}</span>
        {dbPath ? <span className="memory-dbpath" title={dbPath}>{dbPath}</span> : null}
      </div>

      <div className="memory-body">
        {facts.length === 0 ? (
          <div className="memory-empty">{message}</div>
        ) : (
          <ul className="memory-list" data-testid="memory.list">
            {facts.map((fact) => {
              const key = factKey(fact);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`memory-row ${key === selectedKey ? "memory-row-selected" : ""}`}
                    onClick={() => setSelectedKey(key)}
                    data-testid="memory.row"
                  >
                    <span className="memory-row-namespace">{fact.namespace}</span>
                    <span className="memory-row-key">{fact.key}</span>
                    <span className="memory-row-updated">{formatTimestamp(fact.updatedAtMs)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected ? (
          <aside className="memory-detail" data-testid="memory.detail">
            <div className="memory-detail-head">
              <span className="memory-detail-namespace">{selected.namespace}</span>
              <span className="memory-detail-key">{selected.key}</span>
            </div>
            <dl className="memory-detail-meta">
              <div>
                <dt>Created</dt>
                <dd>{formatTimestamp(selected.createdAtMs)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatTimestamp(selected.updatedAtMs)}</dd>
              </div>
              {selected.ttlMs != null ? (
                <div>
                  <dt>TTL</dt>
                  <dd>{selected.ttlMs}ms</dd>
                </div>
              ) : null}
              {selected.schemaSig ? (
                <div>
                  <dt>Schema</dt>
                  <dd>{selected.schemaSig}</dd>
                </div>
              ) : null}
            </dl>
            <pre className="memory-detail-value">{formatValue(selected.valueJson)}</pre>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
