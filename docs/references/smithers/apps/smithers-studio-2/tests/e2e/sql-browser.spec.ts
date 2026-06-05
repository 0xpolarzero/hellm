import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import { SEEDED_RUNS, SEEDED_SQL_DB_PATH } from "../fixtures/seededData";

/**
 * REAL-BACKEND SQL Browser e2e. No `page.route`, no `mockGateway`, no faked
 * result shapes. The workspace-API fixture (`tests/fixtures/workspaceApiServer.ts`)
 * backs `/sql/*` with a GENUINE `bun:sqlite` in-memory database built from
 * `SEEDED_SQL_TABLES`, so:
 *
 *   - `/sql/query` executes the spec's literal SQL through the engine and
 *     returns the real result rows — a WHERE/LIMIT genuinely filters, it is not
 *     a regex table-dump;
 *   - a malformed/invalid query yields the engine's real error message, which
 *     the surface surfaces verbatim in `sql.error`;
 *   - the empty-query path is guarded client-side (`useSqlBrowser`) with the
 *     real guidance message.
 *
 * Every assertion is on the deterministic seeded values in
 * `tests/fixtures/seededData.ts` (the `runs` table mirrors `SEEDED_RUNS`).
 *
 * READ-ONLY CONTRACT: the SQL Browser is presented as read-only and the data
 * layer (`useSqlBrowser`) surfaces a backend read-only rejection verbatim. The
 * fixture now backs each test with its OWN isolated in-memory DB AND rejects any
 * write/DDL before execution (and locks the connection with PRAGMA query_only as
 * defense in depth). A destructive `DELETE FROM runs` is therefore both safe
 * (per-session isolation) and genuinely rejected — the spec below submits one,
 * asserts the real read-only error, and confirms the rows are intact afterward.
 */

const RUNS_TABLE_ROW_COUNT = SEEDED_RUNS.length;
const FINISHED_RUN = SEEDED_RUNS.find((run) => run.status === "finished")!;
const RUNNING_RUN = SEEDED_RUNS.find((run) => run.status === "running")!;

async function openSqlBrowser(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("studio.developerMode", "true");
  });
  await page.goto("/");
  await page.getByTestId("nav.SQL Browser").click();
  await expect(page.getByTestId("view.sql")).toBeVisible();
  // The table list comes from the real /sql/tables endpoint (reads sqlite_master).
  await expect(page.getByTestId("sql.dbpath")).toContainText(SEEDED_SQL_DB_PATH);
  await expect(page.getByTestId("sql.table.runs")).toBeVisible();
}

test("a WHERE/LIMIT query is genuinely filtered by the real SQLite engine", async ({ page }) => {
  await openSqlBrowser(page);

  const editor = page.getByTestId("sql.query-input");
  const results = page.getByTestId("sql.results");

  // Baseline: an unfiltered SELECT returns every seeded run row. The runs table
  // mirrors SEEDED_RUNS, so all four run ids are present.
  await editor.fill("SELECT id, status FROM runs;");
  await page.getByTestId("sql.run").click();
  for (const run of SEEDED_RUNS) {
    await expect(results).toContainText(run.runId);
  }
  const totalRows = await results.locator("tbody tr").count();
  expect(totalRows).toBe(RUNS_TABLE_ROW_COUNT);

  // Now a real WHERE narrows the result set: only the finished run comes back.
  // This proves genuine execution — a regex table-dump could not exclude the
  // non-matching rows.
  await editor.fill("SELECT id, status FROM runs WHERE status = 'finished';");
  await page.getByTestId("sql.run").click();
  await expect(results).toContainText(FINISHED_RUN.runId);
  await expect(results).not.toContainText(RUNNING_RUN.runId);
  const filteredRows = await results.locator("tbody tr").count();
  expect(filteredRows).toBe(1);
  expect(filteredRows).toBeLessThan(totalRows);

  // A LIMIT 1 against the full (unfiltered) table returns exactly one row —
  // again, only real execution honours LIMIT.
  await editor.fill("SELECT id FROM runs LIMIT 1;");
  await page.getByTestId("sql.run").click();
  await expect(results.locator("tbody tr")).toHaveCount(1);
});

test("the empty-query path shows the guidance message and no results", async ({ page }) => {
  await openSqlBrowser(page);

  // Clear the editor and run: the data layer guards the empty/whitespace query
  // with a guidance message and renders no result table.
  await page.getByTestId("sql.query-input").fill("   ");
  await page.getByTestId("sql.run").click();

  await expect(page.getByTestId("sql.error")).toHaveText("Enter a query to run.");
  await expect(page.getByTestId("sql.results")).toContainText("Run a query to see results.");
});

test("a backend SQL error is surfaced verbatim from the real engine", async ({ page }) => {
  await openSqlBrowser(page);

  // Query a table that does not exist. The fixture runs this through bun:sqlite
  // and the engine raises its real "no such table" error, which /sql/query
  // returns and the surface shows verbatim in sql.error.
  await page.getByTestId("sql.query-input").fill("SELECT * FROM definitely_missing_table;");
  await page.getByTestId("sql.run").click();

  const error = page.getByTestId("sql.error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("no such table");
  await expect(error).toContainText("definitely_missing_table");
  // No result table renders when the query fails.
  await expect(page.getByTestId("sql.results")).toContainText("Run a query to see results.");

  // A column that does not exist raises the engine's real "no such column"
  // error — proving the message is the engine's, not a generic stub.
  await page.getByTestId("sql.query-input").fill("SELECT no_such_column FROM runs;");
  await page.getByTestId("sql.run").click();
  await expect(error).toContainText("no such column");
});

test("a write/DDL is rejected by the read-only backend and the rows stay intact", async ({ page }) => {
  await openSqlBrowser(page);

  const editor = page.getByTestId("sql.query-input");
  const results = page.getByTestId("sql.results");
  const error = page.getByTestId("sql.error");

  // Baseline: the seeded runs are present.
  await editor.fill("SELECT id FROM runs;");
  await page.getByTestId("sql.run").click();
  await expect(results.locator("tbody tr")).toHaveCount(RUNS_TABLE_ROW_COUNT);

  // Submit a destructive write. The SQL Browser is read-only, so the backend
  // REJECTS it before execution and the surface shows the real read-only error
  // verbatim — no result table renders. (The per-session DB also isolates this
  // run, so even a rejected attempt could not corrupt another parallel test.)
  await editor.fill("DELETE FROM runs;");
  await page.getByTestId("sql.run").click();
  await expect(error).toBeVisible();
  await expect(error).toContainText(/read-only/i);
  await expect(results).toContainText("Run a query to see results.");

  // A DDL (DROP TABLE) is rejected the same way.
  await editor.fill("DROP TABLE runs;");
  await page.getByTestId("sql.run").click();
  await expect(error).toContainText(/read-only/i);

  // The follow-up SELECT proves the rows were never touched: every seeded run is
  // still present, so the DELETE genuinely did not execute.
  await editor.fill("SELECT id, status FROM runs;");
  await page.getByTestId("sql.run").click();
  await expect(results.locator("tbody tr")).toHaveCount(RUNS_TABLE_ROW_COUNT);
  for (const run of SEEDED_RUNS) {
    await expect(results).toContainText(run.runId);
  }
});
