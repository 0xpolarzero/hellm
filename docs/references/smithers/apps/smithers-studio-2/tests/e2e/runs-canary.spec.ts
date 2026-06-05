import { expect, test } from "../support/test";
import { SEEDED_RUNS } from "../fixtures/seededData";

/**
 * REAL-BACKEND canary. No `page.route`, no `mockGateway`. The Runs surface here
 * drives the live Gateway over the real `POST /v1/rpc/listRuns` +
 * `listApprovals` path (vite proxies /v1/rpc to the Gateway fixture), asserting
 * on the deterministic runs seeded into the Gateway's SQLite store.
 *
 * If this passes, the harness (gateway fixture + vite proxy + seed) is proven
 * and Phase-2 agents can convert the remaining specs against the same stack.
 */

test.describe("Runs surface (real gateway)", () => {
  test("renders every seeded run in the history via real /v1/rpc", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav.Runs").click();
    await expect(page.getByTestId("view.runs")).toBeVisible();

    for (const run of SEEDED_RUNS) {
      await expect(page.getByTestId(`runs.history.row.${run.runId}`)).toBeVisible();
    }
  });

  test("failed filter narrows to the seeded failed run", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav.Runs").click();
    await expect(page.getByTestId("view.runs")).toBeVisible();

    await expect(page.getByTestId("runs.history.row.run-test-failed")).toBeVisible();
    await page.getByTestId("runs.filter.failed").click();

    await expect(page.getByTestId("runs.history.row.run-test-failed")).toBeVisible();
    await expect(page.getByTestId("runs.history.row.run-build-succeeded")).toHaveCount(0);
  });

  test("approvals filter surfaces the run with the seeded pending gate", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav.Runs").click();
    await expect(page.getByTestId("view.runs")).toBeVisible();

    await page.getByTestId("runs.filter.approvals").click();
    await expect(page.getByTestId("runs.history.row.run-approve-waiting")).toBeVisible();
    await expect(page.getByTestId("runs.history.row.run-test-failed")).toHaveCount(0);
  });
});
