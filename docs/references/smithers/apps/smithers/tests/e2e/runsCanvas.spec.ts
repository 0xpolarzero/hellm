import { expect, test } from "@playwright/test";
import {
  distinctWorkflows,
  filterRuns,
  SEEDED_RUNS,
} from "../../src/runs/runsList";

/**
 * The `/runs` list canvas surface. Reads the seeded RunSummary roster from
 * runsList.ts and renders a header toolbar (status/workflow/time menus, search,
 * Clear) above a grouped row list. Deterministic by design —
 * elapsed labels and age buckets are baked into the seed, never computed from a
 * wall-clock — so every count and chip can be derived from the seed module the
 * canvas itself reads.
 *
 * No mocks: the route is loaded directly, the list mutates locally via
 * runsListStore.approve/deny/resume which post a chat line and a toast.
 */
test.describe("runs canvas", () => {
  test("deep-link to /runs renders every seeded run grouped by workflow", async ({
    page,
  }) => {
    await page.goto("/runs");
    await expect(page.getByTestId("runs-canvas")).toBeVisible();

    // The sub line and every row must come from the seed module, so a row
    // added or removed never silently passes.
    const total = filterRuns(SEEDED_RUNS, {
      status: "all",
      workflow: "all",
      age: "all",
      search: "",
    }).length;
    await expect(page.locator(".surface-sub").first()).toHaveText(
      `${total} run${total === 1 ? "" : "s"}`,
    );
    await expect(page.getByTestId("runs-row")).toHaveCount(total);

    // Every distinct workflow is available in the workflow menu and renders a group.
    await page.getByRole("button", { name: "Workflow: All workflows" }).click();
    for (const name of distinctWorkflows(SEEDED_RUNS)) {
      await expect(
        page.getByRole("menuitemradio", { name }),
      ).toBeVisible();
      await expect(
        page.getByTestId("runs-group").filter({ hasText: name }),
      ).toBeVisible();
    }
  });

  test("status + search filters narrow the list and Clear restores it", async ({
    page,
  }) => {
    await page.goto("/runs");

    // Picking the "Failed" status trims the list to the seeded failed rows.
    const failedExpected = filterRuns(SEEDED_RUNS, {
      status: "failed",
      workflow: "all",
      age: "all",
      search: "",
    }).length;
    expect(failedExpected).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Status: All statuses" }).click();
    await page.getByRole("menuitemradio", { name: "Failed" }).click();
    await expect(page.getByTestId("runs-row")).toHaveCount(failedExpected);

    // The Clear affordance materialises now that filters are active.
    const clear = page.getByTestId("runs-clear");
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(page.getByTestId("runs-row")).toHaveCount(SEEDED_RUNS.length);

    // A search-text that no seeded title contains drops to the empty state
    // without raising console errors.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.getByTestId("runs-search").fill("zzz-no-such-run-zzz");
    await expect(page.getByText("No runs found.")).toBeVisible();
    await expect(page.getByTestId("runs-row")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Live/Polling stream badge toggles between modes", async ({ page }) => {
    await page.goto("/runs");

    const badge = page.getByTestId("runs-stream-badge");
    await expect(badge).toHaveText("Live");
    await badge.click();
    await expect(badge).toHaveText("Polling");
    await badge.click();
    await expect(badge).toHaveText("Live");
  });

  test("waiting row exposes inline Approve/Deny and flips to ok", async ({
    page,
  }) => {
    await page.goto("/runs");

    // The deploy-gate row is seeded as the only "waiting" row, so the inline
    // approval gate must render exactly once.
    const approval = page.getByTestId("runs-approval");
    await expect(approval).toHaveCount(1);
    await approval.getByRole("button", { name: "Approve" }).click();

    // Approving flips the row through the store; the inline gate is gone and a
    // toast/chat echo confirms the side effect ran.
    await expect(page.getByTestId("runs-approval")).toHaveCount(0);
    await expect(page.locator(".toast-stack")).toContainText("Approval granted");
  });

  test("mobile viewport keeps the toolbar accessible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/runs");
    await expect(page.getByTestId("runs-canvas")).toBeVisible();
    await expect(page.getByTestId("runs-toolbar")).toBeVisible();
    // Search input remains reachable.
    await page.getByTestId("runs-search").fill("auth");
    await expect(page.getByTestId("runs-row")).toHaveCount(
      filterRuns(SEEDED_RUNS, {
        status: "all",
        workflow: "all",
        age: "all",
        search: "auth",
      }).length,
    );
  });
});
