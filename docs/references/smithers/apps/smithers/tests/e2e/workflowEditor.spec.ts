import { expect, test } from "@playwright/test";
import { WORKFLOW_DOCS } from "../../src/store/workflowDocs";

/**
 * The `/workflow/$id` editor surface. Tabs: Workflow source, Imports, Runs,
 * App (when frontend), Launch (with Doctor + DAG + typed inputs). The URL is
 * the source of truth — the editor store reconciles its selection from the
 * route param on render.
 */
test.describe("workflow editor", () => {
  test("deep-link to /workflow/implement renders the rail + source editor", async ({
    page,
  }) => {
    await page.goto("/workflow/implement");
    await expect(page.getByTestId("wfe-rail")).toBeVisible();
    await expect(page.getByTestId("wfe-source-editor")).toBeVisible();
    // Every seeded workflow surfaces as a rail row.
    await expect(page.getByTestId("wfe-rail-row")).toHaveCount(WORKFLOW_DOCS.length);
  });

  test("editing the source shows the unsaved-modifications strip", async ({
    page,
  }) => {
    await page.goto("/workflow/implement");
    const editor = page.getByTestId("wfe-source-editor");
    await editor.fill("// edited workflow source\n");
    await expect(page.getByTestId("wfe-modified-strip")).toBeVisible();
  });

  test("Launch tab renders Doctor + DAG sections; Run Doctor populates issues or clean", async ({
    page,
  }) => {
    await page.goto("/workflow/implement");
    // The active tab default is Workflow (source). Switch to Launch.
    const launchBtn = page.getByRole("button", { name: "Launch", exact: true });
    if (await launchBtn.count()) {
      await launchBtn.first().click();
    }

    await expect(page.getByTestId("wfe-doctor")).toBeVisible();
    await expect(page.getByTestId("wfe-dag")).toBeVisible();

    await page.getByTestId("wfe-run-doctor").click();
    // The summary line surfaces either "All checks passed." or "Issues found.".
    await expect(page.locator(".wfe-doctor-summary")).toBeVisible();
  });
});
