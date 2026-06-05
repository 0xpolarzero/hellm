import { useCallback, useEffect, useRef, useState } from "react";
import "./search.css";
import { searchWorkspace, type WorkspaceSearchResult, type WorkspaceSearchScope } from "../workspaceApi";

const SEARCH_DEBOUNCE_MS = 200;

const SCOPES: Array<{ id: WorkspaceSearchScope; label: string }> = [
  { id: "code", label: "Code" },
  { id: "issues", label: "Issues" },
  { id: "repos", label: "Repos" },
  { id: "transcripts", label: "Transcripts" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * Search — global workspace search, the full-page fallback for the palette's
 * search mode. Wired to the real `/search` endpoint via workspaceApi. A scope
 * segmented control narrows code / issues / repos / transcripts; the query
 * debounces and uses a request-generation counter to drop stale responses.
 */
export function Search() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<WorkspaceSearchScope>("code");
  const [results, setResults] = useState<WorkspaceSearchResult[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [message, setMessage] = useState("Type to search the workspace.");
  const requestGeneration = useRef(0);

  const runSearch = useCallback(async (text: string, activeScope: WorkspaceSearchScope) => {
    const trimmed = text.trim();
    const generation = ++requestGeneration.current;
    if (!trimmed) {
      setResults([]);
      setStatus("idle");
      setMessage("Type to search the workspace.");
      return;
    }
    setStatus("loading");
    setMessage(`Searching ${activeScope}…`);
    try {
      const found = await searchWorkspace({ query: trimmed, scope: activeScope });
      if (generation !== requestGeneration.current) return;
      setResults(found);
      setStatus("ready");
      setMessage(
        found.length === 0
          ? `No ${activeScope} results for “${trimmed}”.`
          : `${found.length} result${found.length === 1 ? "" : "s"} in ${activeScope}.`,
      );
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setResults([]);
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void runSearch(query, scope), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, scope, runSearch]);

  return (
    <section className="search-surface" data-testid="view.search">
      <header className="search-header">
        <h2 className="search-title">Search</h2>
        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search code, issues, repos, transcripts…"
          data-testid="search.input"
          aria-label="Search the workspace"
          autoFocus
        />
      </header>

      <div className="search-scopes" role="tablist" aria-label="Search scope">
        {SCOPES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={scope === entry.id}
            className={`search-scope ${scope === entry.id ? "search-scope-active" : ""}`}
            onClick={() => setScope(entry.id)}
            data-testid={`search.scope.${entry.id}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="search-statusbar">
        <span className={`search-statustext search-statustext-${status}`} data-testid="search.status">
          {message}
        </span>
      </div>

      <div className="search-body">
        {results.length === 0 ? (
          <div className="search-empty">{message}</div>
        ) : (
          <ul className="search-results" data-testid="search.results">
            {results.map((result) => (
              <li key={result.id} className="search-result" data-testid="search.result">
                <div className="search-result-head">
                  <span className="search-result-title">{result.title}</span>
                  {result.kind ? <span className="search-result-kind">{result.kind}</span> : null}
                </div>
                {result.filePath ? (
                  <div className="search-result-path">
                    {result.filePath}
                    {result.lineNumber != null ? `:${result.lineNumber}` : ""}
                  </div>
                ) : null}
                {result.description ? (
                  <div className="search-result-desc">{result.description}</div>
                ) : null}
                {result.snippet ? <pre className="search-result-snippet">{result.snippet}</pre> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
