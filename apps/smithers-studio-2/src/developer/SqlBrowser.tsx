import "./sql.css";
import { useSqlBrowser } from "./useSqlBrowser";

/**
 * SQL Browser — read-only query surface over the workspace SQLite database via
 * the workspace `/sql/*` HTTP API. Developer-gated. Lists tables, shows a
 * selected table's schema, and runs ad-hoc read-only queries.
 */
export function SqlBrowser() {
  const {
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
  } = useSqlBrowser();

  return (
    <section className="sql-surface" data-testid="view.sql">
      <header className="sql-header">
        <h2 className="sql-title">SQL Browser</h2>
        {dbPath ? (
          <span className="sql-dbpath" data-testid="sql.dbpath">
            {dbPath}
          </span>
        ) : null}
      </header>

      <div className="sql-body">
        <aside className="sql-tables" data-testid="sql.tables">
          <div className="sql-section-label">Tables</div>
          {loadingTables ? (
            <div className="sql-tables-loading">Loading…</div>
          ) : tables.length === 0 ? (
            <div className="sql-tables-empty">No tables.</div>
          ) : (
            <ul className="sql-tablelist">
              {tables.map((table) => (
                <li key={table.name}>
                  <button
                    type="button"
                    className={`sql-tablebtn${selectedTable === table.name ? " sql-tablebtn-selected" : ""}`}
                    data-testid={`sql.table.${table.name}`}
                    onClick={() => selectTable(table.name)}
                  >
                    <span className="sql-tablename">{table.name}</span>
                    <span className="sql-tablecount">{table.rowCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {schema ? (
            <div className="sql-schema" data-testid="sql.schema">
              <div className="sql-section-label">{schema.tableName} columns</div>
              <ul className="sql-collist">
                {schema.columns.map((column) => (
                  <li key={column.name} className="sql-col">
                    <span className="sql-colname">{column.name}</span>
                    <span className="sql-coltype">{column.type}</span>
                    {column.primaryKey ? <span className="sql-colpk">PK</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>

        <div className="sql-main">
          <div className="sql-editor">
            <textarea
              className="sql-input"
              data-testid="sql.query-input"
              aria-label="SQL query"
              value={query}
              spellCheck={false}
              placeholder="SELECT * FROM ... LIMIT 100;"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  runQuery();
                }
              }}
            />
            <div className="sql-editor-actions">
              <span
                className="sql-readonly-note"
                title="Writes (INSERT/UPDATE/DELETE/DDL) are rejected by the backend."
              >
                read-only
              </span>
              <button
                type="button"
                className="sql-run"
                data-testid="sql.run"
                onClick={runQuery}
                disabled={running}
              >
                {running ? "Running…" : "Run"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="sql-error" data-testid="sql.error">
              {error}
            </div>
          ) : null}

          <div className="sql-results" data-testid="sql.results">
            {result ? (
              result.rows.length === 0 ? (
                <div className="sql-results-empty">0 rows.</div>
              ) : (
                <>
                  <div className="sql-results-count" data-testid="sql.results-count">
                    {result.rows.length === 1 ? "1 row" : `${result.rows.length.toLocaleString()} rows`}
                  </div>
                  <table className="sql-table">
                  <thead>
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </>
              )
            ) : (
              <div className="sql-results-placeholder">Run a query to see results.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
