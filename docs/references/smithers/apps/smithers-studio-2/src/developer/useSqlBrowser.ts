import { useCallback, useEffect, useRef, useState } from "react";
import {
  getWorkspaceSqlSchema,
  listWorkspaceSqlTables,
  runWorkspaceSqlQuery,
  type WorkspaceSqlResult,
  type WorkspaceSqlSchema,
  type WorkspaceSqlTable,
} from "../workspaceApi";

export type SqlBrowserState = {
  tables: WorkspaceSqlTable[];
  dbPath: string | null;
  loadingTables: boolean;
  schema: WorkspaceSqlSchema | null;
  selectedTable: string | null;
  query: string;
  result: WorkspaceSqlResult | null;
  running: boolean;
  error: string | null;
  setQuery: (value: string) => void;
  selectTable: (tableName: string) => void;
  runQuery: () => void;
  refresh: () => void;
};

const QUERY_LIMIT = 500;

function selectFromTable(tableName: string): string {
  return `SELECT * FROM "${tableName}" LIMIT 100;`;
}

/**
 * Read-only SQLite browser data layer. Lists tables, loads a table's schema on
 * selection, and runs ad-hoc queries — all over the workspace HTTP API
 * (`/sql/*`). The backend enforces read-only; this hook surfaces its errors.
 */
export function useSqlBrowser(): SqlBrowserState {
  const [tables, setTables] = useState<WorkspaceSqlTable[]>([]);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [schema, setSchema] = useState<WorkspaceSqlSchema | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<WorkspaceSqlResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  // Monotonic id for the latest in-flight query. A slow earlier query that
  // resolves after a newer one is stale and must not overwrite the newer result.
  const queryRunRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingTables(true);
    setError(null);
    listWorkspaceSqlTables()
      .then((payload) => {
        if (cancelled) return;
        setTables(payload.tables);
        setDbPath(payload.dbPath);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Failed to list tables.");
        setTables([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);

  const selectTable = useCallback((tableName: string) => {
    setSelectedTable(tableName);
    setQuery(selectFromTable(tableName));
    setError(null);
    getWorkspaceSqlSchema(tableName)
      .then((payload) => setSchema(payload.schema))
      .catch((cause: unknown) => {
        setSchema(null);
        setError(cause instanceof Error ? cause.message : "Failed to load schema.");
      });
  }, []);

  const runQuery = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResult(null);
      setError("Enter a query to run.");
      return;
    }
    const runId = queryRunRef.current + 1;
    queryRunRef.current = runId;
    setRunning(true);
    setError(null);
    runWorkspaceSqlQuery(trimmed, QUERY_LIMIT)
      .then((payload) => {
        if (queryRunRef.current !== runId) return;
        setResult(payload.result);
      })
      .catch((cause: unknown) => {
        if (queryRunRef.current !== runId) return;
        setResult(null);
        // The backend rejects writes (INSERT/UPDATE/DELETE/DDL) and surfaces a
        // read-only error here; pass its message through verbatim so the surface
        // reflects the real enforcement rather than a generic failure.
        setError(cause instanceof Error ? cause.message : "Query failed.");
      })
      .finally(() => {
        if (queryRunRef.current !== runId) return;
        setRunning(false);
      });
  }, [query]);

  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  return {
    tables,
    dbPath,
    loadingTables,
    schema,
    selectedTable,
    query,
    result,
    running,
    error,
    setQuery,
    selectTable,
    runQuery,
    refresh,
  };
}
