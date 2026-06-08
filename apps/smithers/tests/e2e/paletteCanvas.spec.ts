import { expect, test } from "@playwright/test";

/**
 * The `/palette` command palette surface. Keyboard-driven: an input drives a
 * scored result list with sigil-based mode switching (@ files, > commands,
 * / slash, ? ask). ArrowDown/Up move the selection; Enter executes; Escape
 * closes; Tab tab-completes. The empty state offers an "Ask AI: …" affordance
 * when no result matches.
 */
test.describe("palette canvas", () => {
  test("deep-link to /palette renders the input with All mode + a result count", async ({
    page,
  }) => {
    await page.goto("/palette");
    await expect(page.getByTestId("palette-canvas")).toBeVisible();

    const tabs = page.getByTestId("palette-tabs");
    await expect(tabs.locator(".palette-tab.is-on")).toHaveText("All");
    // Empty query still surfaces the default item set; the count line reflects it.
    const count = page.getByTestId("palette-count");
    await expect(count).toBeVisible();
  });

  test("typing the @ sigil switches the active mode to Files", async ({
    page,
  }) => {
    await page.goto("/palette");
    const input = page.getByTestId("palette-input");
    await input.fill("@");
    await expect(page.locator(".palette-sigil")).toHaveText("@");
    await expect(page.locator(".palette-mode-label")).toContainText(/file/i);
    await expect(
      page.getByTestId("palette-tabs").locator(".palette-tab.is-on"),
    ).toHaveText(/Files/);
  });

  test("ArrowDown moves the selected row down", async ({ page }) => {
    await page.goto("/palette");
    const input = page.getByTestId("palette-input");
    await input.focus();

    // Wait for at least one result row before asserting selection movement.
    const rows = page.getByTestId("palette-row");
    expect(await rows.count()).toBeGreaterThan(0);
    const initiallySelected = await page
      .locator(".palette-row.is-selected")
      .innerText();

    await page.keyboard.press("ArrowDown");
    const afterMove = await page
      .locator(".palette-row.is-selected")
      .innerText();
    expect(afterMove).not.toEqual(initiallySelected);
  });

  test("a query with no match shows the empty state and Ask AI affordance", async ({
    page,
  }) => {
    await page.goto("/palette");
    await page.getByTestId("palette-input").fill("zzz-no-match-zzz");
    await expect(page.getByTestId("palette-empty")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Ask AI: zzz-no-match-zzz/ }),
    ).toBeVisible();
  });
});
