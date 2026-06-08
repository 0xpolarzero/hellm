import { expect, test } from "@playwright/test";

/**
 * The shell can switch between the centered/home flow and the Arc-style sidebar
 * rail. The active shell is reflected on `main.app-shell[data-mode]` and is
 * remembered across reloads.
 */
test.describe("sidebar layout toggle", () => {
  test("switches to the sidebar rail and persists across reload", async ({ page }) => {
    await page.goto("/");
    const shell = page.locator("main.app-shell");
    await expect(shell).toHaveAttribute("data-mode", "home");

    await page.getByRole("button", { name: "Switch to sidebar layout" }).click();
    await expect(shell).toHaveAttribute("data-mode", "sidebar");

    await page.reload();
    await expect(shell).toHaveAttribute("data-mode", "sidebar");
  });
});
