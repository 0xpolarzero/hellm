import { expect, test, type Page } from "@playwright/test";

/**
 * The `/scores` canvas. Three tabs (Summary, Metrics, Recent) over a run
 * selector. Note: the testids `scores-tab-summary` / `-metrics` / `-recent` are
 * applied to BOTH the tab button (inside `scores-tabs`) and the panel body,
 * so every assertion scopes to one or the other to avoid strict-mode noise.
 */
const tabButton = (page: Page, id: "summary" | "metrics" | "recent") =>
  page.getByTestId("scores-tabs").getByTestId(`scores-tab-${id}`);
const tabPanel = (page: Page, id: "summary" | "metrics" | "recent") =>
  page.locator(`.scores-scroll [data-testid="scores-tab-${id}"]`);

test.describe("scores canvas", () => {
  test("deep-link to /scores renders the summary panel by default", async ({
    page,
  }) => {
    await page.goto("/scores");
    await expect(page.getByTestId("scores-canvas")).toBeVisible();
    await expect(tabButton(page, "summary")).toHaveClass(/is-on/);
    // The six summary tiles are always present, regardless of seed values.
    await expect(page.locator(".score-tile")).toHaveCount(6);
  });

  test("clicking each tab swaps the panel body", async ({ page }) => {
    await page.goto("/scores");

    await tabButton(page, "metrics").click();
    await expect(tabButton(page, "metrics")).toHaveClass(/is-on/);
    // Metrics tab stacks four labeled panels.
    await expect(page.locator(".scores-panel-title")).toHaveCount(4);

    await tabButton(page, "recent").click();
    await expect(tabButton(page, "recent")).toHaveClass(/is-on/);

    await tabButton(page, "summary").click();
    await expect(tabButton(page, "summary")).toHaveClass(/is-on/);
  });

  test("run selector + refresh are reachable", async ({ page }) => {
    await page.goto("/scores");
    const selector = page.getByTestId("scores-run-selector");
    await expect(selector).toBeVisible();
    // At least the seeded run must populate the dropdown.
    const optionCount = await selector.locator("option").count();
    expect(optionCount).toBeGreaterThan(0);

    await page.getByTestId("scores-refresh").click();
    await expect(tabButton(page, "summary")).toHaveClass(/is-on/);
  });
});
