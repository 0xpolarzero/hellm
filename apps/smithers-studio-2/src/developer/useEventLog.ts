import { useCallback, useEffect, useRef, useState } from "react";
import { listWorkspaceLogs, type WorkspaceLogEntry, type WorkspaceLogStats } from "../workspaceApi";

export type EventLogFilters = {
  level: string | null;
  category: string | null;
  query: string;
};

export type EventLogState = {
  entries: WorkspaceLogEntry[];
  stats: WorkspaceLogStats | null;
  loading: boolean;
  error: string | null;
  filters: EventLogFilters;
  setLevel: (level: string | null) => void;
  setCategory: (category: string | null) => void;
  setQuery: (query: string) => void;
  refresh: () => void;
};

const LOG_LIMIT = 1_000;
const QUERY_DEBOUNCE_MS = 250;
const INITIAL_FILTERS: EventLogFilters = { level: null, category: null, query: "" };

/**
 * Global event-log firehose data layer. Pulls the unfiltered (or filtered) log
 * stream from the workspace `/logs` HTTP API along with aggregate stats. Per-run
 * logs live in the Runs inspector; this is the cross-workspace firehose.
 *
 * The free-text `query` is debounced (250ms) before it reaches the fetch effect
 * so typing does not refetch the full 1000-entry stream on every keystroke;
 * level/category changes fetch immediately. `appliedFilters` is what actually
 * drives the request, and the in-flight fetch keeps its cancelled guard.
 */
export function useEventLog(): EventLogState {
  const [entries, setEntries] = useState<WorkspaceLogEntry[]>([]);
  const [stats, setStats] = useState<WorkspaceLogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventLogFilters>(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<EventLogFilters>(INITIAL_FILTERS);
  const [generation, setGeneration] = useState(0);

  // Debounce only the free-text query into appliedFilters; level/category are
  // applied synchronously below so dropdown changes feel instant.
  const lastQueryRef = useRef(filters.query);
  useEffect(() => {
    if (filters.query === lastQueryRef.current) return;
    lastQueryRef.current = filters.query;
    const handle = window.setTimeout(() => {
      setAppliedFilters((current) => ({ ...current, query: filters.query }));
    }, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [filters.query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listWorkspaceLogs({
      level: appliedFilters.level,
      category: appliedFilters.category,
      query: appliedFilters.query,
      limit: LOG_LIMIT,
    })
      .then((payload) => {
        if (cancelled) return;
        setEntries(payload.entries);
        setStats(payload.stats);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Failed to load logs.");
        setEntries([]);
        setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedFilters, generation]);

  const setLevel = useCallback((level: string | null) => {
    setFilters((current) => ({ ...current, level }));
    setAppliedFilters((current) => ({ ...current, level }));
  }, []);

  const setCategory = useCallback((category: string | null) => {
    setFilters((current) => ({ ...current, category }));
    setAppliedFilters((current) => ({ ...current, category }));
  }, []);

  const setQuery = useCallback((query: string) => {
    setFilters((current) => ({ ...current, query }));
  }, []);

  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  return { entries, stats, loading, error, filters, setLevel, setCategory, setQuery, refresh };
}
