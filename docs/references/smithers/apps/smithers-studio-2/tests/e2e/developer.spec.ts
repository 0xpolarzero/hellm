import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import {
  SEEDED_LOG_ENTRIES,
  SEEDED_RUN_IDS,
  SEEDED_SQL_DB_PATH,
  SEEDED_SQL_TABLES,
} from "../fixtures/seededData";

/**
 * REAL-BACKEND developer surfaces (DevTools / SQL Browser / Logs). No
 * `page.route`, no `mockGateway`. The surfaces are registered only when
 * `studio.developerMode` is on, so each test flips that flag in localStorage and
 * then drives the live stack booted by `playwright.config.ts`:
 *
 *   - DevTools reads runs + snapshots over the real gateway RPC (`listRuns`,
 *     `getDevToolsSnapshot`) that vite proxies to the seeded Gateway fixture.
 *   - SQL Browser + Logs read the real workspace-API server (`/sql/*`, `/logs`)
 *     that serves the deterministic seeded SQL tables + log entries.
 *
 * Assertions are on the exact seeded values from `tests/fixtures/seededData.ts`.
 *
 * DevTools tree note: the seeded runs have no execution frames, so the live
 * `getDevToolsSnapshot` returns the real empty root (`id 0`, name `(empty)`,
 * no children) — verified against the running Gateway. A populated child tree
 * would require executing a real workflow through the Gateway, which is out of
 * scope for the seeded fixture; these tests assert on what the real backend
 * genuinely produces (the run picker from real `listRuns` + the real snapshot
 * root) rather than re-introducing a mock to fake a child tree.
 */

async function enableDeveloperMode(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("studio.developerMode", "true");
  });
}

test("DevTools lists the seeded runs and renders the real snapshot root", async ({ page }) => {
  await enableDeveloperMode(page);
  await page.goto("/");

  await page.getByTestId("nav.DevTools").click();
  await expect(page.getByTestId("view.devtools")).toBeVisible();

  // The run picker is populated from the real listRuns RPC — every seeded run
  // appears as an option.
  const select = page.getByTestId("devtools.run-select");
  await expect(select).toBeVisible();
  for (const runId of SEEDED_RUN_IDS) {
    await expect(select.locator("option", { hasText: runId })).toHaveCount(1);
  }

  // Select a DB-seeded run (no execution frames) and assert the real empty root
  // the Gateway returns for frame-less runs (id 0, "(empty)"). The fixture's
  // live approval run has a real populated tree, so this targets a seeded run.
  await select.selectOption("run-build-succeeded");
  await expect(page.getByTestId("devtools.row.0")).toContainText("(empty)");

  // The root auto-selects, so the inspector reflects the real root node: a
  // workflow node with no props.
  await expect(page.getByTestId("devtools.inspector")).toContainText("(empty)");
  await expect(page.getByTestId("devtools.inspector")).toContainText("props (0)");
});

test("DevTools switches the snapshot when a different seeded run is picked", async ({ page }) => {
  await enableDeveloperMode(page);
  await page.goto("/");

  await page.getByTestId("nav.DevTools").click();
  await expect(page.getByTestId("view.devtools")).toBeVisible();

  // Pick a DB-seeded run (no frames → real empty root), then switch to another
  // DB-seeded run and confirm the snapshot re-renders. (The auto-selected run is
  // the fixture's LIVE executed run with a real populated tree, so this test
  // drives the picker explicitly between two frame-less seeded runs.)
  await page.getByTestId("devtools.run-select").selectOption("run-test-failed");
  await expect(page.getByTestId("devtools.row.0")).toContainText("(empty)");

  await page.getByTestId("devtools.run-select").selectOption("run-build-succeeded");
  await expect(page.getByTestId("devtools.row.0")).toContainText("(empty)");
});

test("SQL Browser lists seeded tables, loads schema, and runs a read-only query", async ({ page }) => {
  await enableDeveloperMode(page);
  await page.goto("/");

  await page.getByTestId("nav.SQL Browser").click();
  await expect(page.getByTestId("view.sql")).toBeVisible();

  // Tables + db path come from the real /sql/tables endpoint.
  await expect(page.getByTestId("sql.dbpath")).toContainText(SEEDED_SQL_DB_PATH);
  for (const table of SEEDED_SQL_TABLES) {
    await expect(page.getByTestId(`sql.table.${table.name}`)).toBeVisible();
  }

  // Selecting the runs table loads its real schema (/sql/schema).
  await page.getByTestId("sql.table.runs").click();
  await expect(page.getByTestId("sql.schema")).toContainText("status");
  await expect(page.getByTestId("sql.schema")).toContainText("workflow_key");

  // Running the default query hits the real /sql/query endpoint and returns the
  // seeded run rows — the same runs the Gateway serves to the Runs surface.
  await page.getByTestId("sql.run").click();
  const results = page.getByTestId("sql.results");
  for (const runId of SEEDED_RUN_IDS) {
    await expect(results).toContainText(runId);
  }
});

test("Logs renders the seeded firehose with real stats", async ({ page }) => {
  await enableDeveloperMode(page);
  await page.goto("/");

  await page.getByTestId("nav.Logs").click();
  await expect(page.getByTestId("view.logs")).toBeVisible();

  // Stats are computed by the real /logs endpoint over the seeded entries.
  const errorCount = SEEDED_LOG_ENTRIES.filter((entry) => entry.level === "error").length;
  const warnCount = SEEDED_LOG_ENTRIES.filter((entry) => entry.level === "warn").length;
  const stats = page.getByTestId("logs.stats");
  await expect(stats).toContainText(`${SEEDED_LOG_ENTRIES.length} entries`);
  await expect(stats).toContainText(`${errorCount} errors`);
  await expect(stats).toContainText(`${warnCount} warnings`);

  // Every seeded entry's message renders in the stream.
  const stream = page.getByTestId("logs.stream");
  for (const entry of SEEDED_LOG_ENTRIES) {
    await expect(stream).toContainText(entry.message);
  }
});

test("Logs free-text filter narrows the firehose via the real backend", async ({ page }) => {
  await enableDeveloperMode(page);
  await page.goto("/");

  await page.getByTestId("nav.Logs").click();
  await expect(page.getByTestId("view.logs")).toBeVisible();

  const errorEntry = SEEDED_LOG_ENTRIES.find((entry) => entry.level === "error")!;
  const otherEntry = SEEDED_LOG_ENTRIES.find((entry) => entry.level !== "error")!;

  // Typing a query re-fetches /logs with ?query=, so only matching entries come
  // back from the real backend.
  await page.getByTestId("logs.search").fill("connection refused");
  const stream = page.getByTestId("logs.stream");
  await expect(stream).toContainText(errorEntry.message);
  await expect(stream).not.toContainText(otherEntry.message);
});

test("developer surfaces are unreachable when developer mode is off", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav.DevTools")).toHaveCount(0);
  await expect(page.getByTestId("nav.SQL Browser")).toHaveCount(0);
  await expect(page.getByTestId("nav.Logs")).toHaveCount(0);
});
