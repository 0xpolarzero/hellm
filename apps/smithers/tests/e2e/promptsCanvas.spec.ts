import { expect, test } from "@playwright/test";
import { SEEDED_PROMPTS } from "../../src/prompts/promptsSource";

/**
 * The `/prompts` editor canvas. Left rail with a row per prompt; right detail
 * with four tabs (Source / Imports / Inputs / Preview) and a Save affordance
 * that only appears when the draft diverges from the seed. Behavior-level
 * only — counts come from the seed module the canvas reads.
 */
test.describe("prompts canvas", () => {
  test("deep-link to /prompts lists every seeded prompt and opens the first by default", async ({
    page,
  }) => {
    await page.goto("/prompts");
    await expect(page.getByTestId("prompts-canvas")).toBeVisible();
    await expect(page.getByTestId("prompts-row")).toHaveCount(SEEDED_PROMPTS.length);

    // The source tab is the default; the editor is bound to the active prompt.
    await expect(page.getByTestId("prompts-editor")).toBeVisible();
  });

  test("typing in the editor shows the unsaved Save and saving clears it", async ({
    page,
  }) => {
    await page.goto("/prompts");
    const editor = page.getByTestId("prompts-editor");
    await expect(editor).toBeVisible();

    // No edits yet → Save is hidden.
    await expect(page.getByTestId("prompts-save")).toHaveCount(0);

    // A small edit dirties the draft; Save materialises and persists it.
    await editor.fill("hello smithers");
    const save = page.getByTestId("prompts-save");
    await expect(save).toBeVisible();
    await save.click();
    await expect(page.getByTestId("prompts-save")).toHaveCount(0);
  });

  test("switching tabs swaps the detail pane body", async ({ page }) => {
    await page.goto("/prompts");

    await page.getByTestId("prompts-tab-imports").click();
    // Imports tab renders either the list or its empty state — both are valid.
    const tabs = page.getByTestId("prompts-tabs");
    await expect(tabs.locator(".is-on")).toHaveText("Imports");

    await page.getByTestId("prompts-tab-inputs").click();
    await expect(tabs.locator(".is-on")).toHaveText("Inputs");

    await page.getByTestId("prompts-tab-preview").click();
    await expect(tabs.locator(".is-on")).toHaveText("Preview");

    await page.getByTestId("prompts-tab-source").click();
    await expect(page.getByTestId("prompts-editor")).toBeVisible();
  });

  test("switching prompts while dirty raises the discard guard", async ({
    page,
  }) => {
    await page.goto("/prompts");
    await page.getByTestId("prompts-editor").fill("dirty buffer");

    // Pick a different prompt from the rail; the guard intercepts the switch.
    const otherRow = page
      .getByTestId("prompts-row")
      .filter({ hasText: SEEDED_PROMPTS[1].id })
      .first();
    await otherRow.click();

    const guard = page.getByTestId("prompts-discard");
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("prompts-discard")).toHaveCount(0);
  });
});
