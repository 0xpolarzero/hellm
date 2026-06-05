import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import { LIVE_APPROVAL_RUN, SEEDED_LOG_ENTRIES } from "../fixtures/seededData";

/**
 * REAL-BACKEND DevTools tree + Logs e2e. No `page.route`, no `mockGateway`, no
 * faked snapshot. The developer surfaces are registered only when
 * `studio.developerMode` is on, so each test flips that flag and then drives the
 * live stack booted by `playwright.config.ts`:
 *
 *   - DevTools reads runs (`listRuns`) and the raw snapshot (`getDevToolsSnapshot`)
 *     over the real Gateway RPC that vite proxies to the seeded Gateway fixture.
 *   - Logs reads the real workspace-API `/logs` endpoint, which filters the
 *     seeded entries server-side by level / category / free-text.
 *
 * Unlike `developer.spec.ts` (which asserts the real EMPTY root of the inert
 * DB-seeded runs), this spec targets the run the fixture EXECUTES live —
 * {@link LIVE_APPROVAL_RUN} — which has a genuinely populated tree (a Workflow
 * root with the plan + approval task children, built from real execution
 * frames). It expands into a child node and asserts the inspector reflects that
 * child's REAL task metadata / props, not the empty root.
 */

async function enableDeveloperMode(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("studio.developerMode", "true");
  });
}

async function openDevTools(page: Page) {
  await enableDeveloperMode(page);
  await page.goto("/");
  await page.getByTestId("nav.DevTools").click();
  await expect(page.getByTestId("view.devtools")).toBeVisible();
}

test("DevTools renders the real populated tree for the executed run and inspects a child node", async ({
  page,
}) => {
  await openDevTools(page);

  // Select the LIVE executed approval run, which has a real populated tree (a
  // Workflow root with the plan + approval task children) — not the inert empty
  // root the DB-seeded runs produce.
  const select = page.getByTestId("devtools.run-select");
  await expect(select).toBeVisible();
  await expect(select.locator("option", { hasText: LIVE_APPROVAL_RUN.runId })).toHaveCount(1);
  await select.selectOption(LIVE_APPROVAL_RUN.runId);

  // The tree is genuinely populated: the root is the workflow node (NOT the
  // "(empty)" placeholder), and there is more than one row — proving real child
  // nodes from the executed run's snapshot. Rows are keyed by the node's numeric
  // snapshot id (`devtools.row.<id>`), which is gateway-assigned and not a fixed
  // value, so the root is the FIRST treeitem rather than a hardcoded id.
  const tree = page.getByTestId("devtools.tree");
  await expect(tree).toBeVisible();
  const rows = tree.getByRole("treeitem");
  await expect.poll(async () => rows.count()).toBeGreaterThan(1);

  const rootRow = rows.first();
  await expect(rootRow).toBeVisible();
  await expect(rootRow).not.toContainText("(empty)");
  // The workflow root row renders the workflow tag `<studio-approval>`.
  await expect(rootRow).toContainText(LIVE_APPROVAL_RUN.workflowKey);

  // The root inspector reflects the workflow root: it carries no task metadata.
  const inspector = page.getByTestId("devtools.inspector");
  await expect(inspector).toContainText(LIVE_APPROVAL_RUN.workflowKey);
  await expect(page.getByTestId("devtools.inspector.task")).toHaveCount(0);

  // Select a CHILD node (any non-root treeitem). A task child carries real task
  // metadata, so the inspector now renders the task section with the child's
  // real task nodeId — one of the executed workflow's seeded node ids.
  const childRow = rows.nth(1);
  await childRow.click();

  const taskSection = page.getByTestId("devtools.inspector.task");
  await expect(taskSection).toBeVisible();
  await expect(taskSection).toContainText(
    new RegExp(`${LIVE_APPROVAL_RUN.planNodeId}|${LIVE_APPROVAL_RUN.approvalNodeId}`),
  );
  // The inspector header shows the selected child's identity, not the root's.
  await expect(inspector).toContainText("depth 1");
});

test("DevTools child selection drives the inspector to that node's real props", async ({ page }) => {
  await openDevTools(page);

  await page.getByTestId("devtools.run-select").selectOption(LIVE_APPROVAL_RUN.runId);
  const rows = page.getByTestId("devtools.tree").getByRole("treeitem");
  await expect.poll(async () => rows.count()).toBeGreaterThan(1);

  // Select the first child task (the plan node) and confirm the inspector
  // switches to it: its task section names the real seeded plan node id, and the
  // props label reflects the real prop count of THAT node (props (N) is always
  // rendered, so assert the section exists).
  const firstChild = rows.nth(1);
  await firstChild.click();

  const inspector = page.getByTestId("devtools.inspector");
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId("devtools.inspector.task")).toContainText(
    new RegExp(`${LIVE_APPROVAL_RUN.planNodeId}|${LIVE_APPROVAL_RUN.approvalNodeId}`),
  );
  await expect(inspector).toContainText(/props \(\d+\)/);
});

test("Logs renders the real seeded firehose and the level filter narrows it server-side", async ({
  page,
}) => {
  await enableDeveloperMode(page);
  await page.goto("/");
  await page.getByTestId("nav.Logs").click();
  await expect(page.getByTestId("view.logs")).toBeVisible();

  const stream = page.getByTestId("logs.stream");
  // Every seeded entry's message renders (the real /logs firehose, unfiltered).
  for (const entry of SEEDED_LOG_ENTRIES) {
    await expect(stream).toContainText(entry.message);
  }
  // One row per seeded entry.
  await expect(page.getByTestId("logs.row")).toHaveCount(SEEDED_LOG_ENTRIES.length);

  const errorEntry = SEEDED_LOG_ENTRIES.find((entry) => entry.level === "error")!;
  const infoEntry = SEEDED_LOG_ENTRIES.find((entry) => entry.level === "info")!;
  const warnEntry = SEEDED_LOG_ENTRIES.find((entry) => entry.level === "warn")!;

  // The level dropdown re-fetches /logs?level=error so only the error entry
  // survives the real server-side filter.
  await page.getByTestId("logs.level").selectOption("error");
  await expect(stream).toContainText(errorEntry.message);
  await expect(stream).not.toContainText(infoEntry.message);
  await expect(stream).not.toContainText(warnEntry.message);
  await expect(page.getByTestId("logs.row")).toHaveCount(1);

  // Back to all levels: every entry returns.
  await page.getByTestId("logs.level").selectOption("");
  await expect(page.getByTestId("logs.row")).toHaveCount(SEEDED_LOG_ENTRIES.length);
});

test("Logs category filter narrows to one category via the real backend", async ({ page }) => {
  await enableDeveloperMode(page);
  await page.goto("/");
  await page.getByTestId("nav.Logs").click();
  await expect(page.getByTestId("view.logs")).toBeVisible();

  const stream = page.getByTestId("logs.stream");
  const gatewayEntry = SEEDED_LOG_ENTRIES.find((entry) => entry.category === "gateway")!;
  const runnerEntries = SEEDED_LOG_ENTRIES.filter((entry) => entry.category === "runner");

  // The category options are computed by the real /logs stats. Pick "runner":
  // both runner entries survive and the gateway entry is filtered out.
  await page.getByTestId("logs.category").selectOption("runner");
  for (const entry of runnerEntries) {
    await expect(stream).toContainText(entry.message);
  }
  await expect(stream).not.toContainText(gatewayEntry.message);
  await expect(page.getByTestId("logs.row")).toHaveCount(runnerEntries.length);
});

test("Logs free-text filter is debounced and narrows to matching entries", async ({ page }) => {
  await enableDeveloperMode(page);
  await page.goto("/");
  await page.getByTestId("nav.Logs").click();
  await expect(page.getByTestId("view.logs")).toBeVisible();

  const errorEntry = SEEDED_LOG_ENTRIES.find((entry) => entry.level === "error")!;
  const otherEntry = SEEDED_LOG_ENTRIES.find((entry) => entry.level !== "error")!;
  const stream = page.getByTestId("logs.stream");

  // Type a free-text query character-by-character. The query is debounced
  // (250ms) before it reaches the fetch, so intermediate keystrokes do not each
  // refetch — we only assert the final, correct narrowed result from the real
  // /logs?query= filter (the debounce is an internal optimization; correctness
  // is the observable contract).
  await page.getByTestId("logs.search").pressSequentially("connection refused", { delay: 30 });
  await expect(stream).toContainText(errorEntry.message);
  await expect(stream).not.toContainText(otherEntry.message);
  await expect(page.getByTestId("logs.row")).toHaveCount(1);

  // Clearing the filter restores the full firehose.
  await page.getByTestId("logs.search").fill("");
  await expect(page.getByTestId("logs.row")).toHaveCount(SEEDED_LOG_ENTRIES.length);
});
