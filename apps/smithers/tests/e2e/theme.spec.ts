import { expect, test } from "@playwright/test";

// Pin the OS preference so the initial theme is deterministic regardless of the
// runner's color-scheme.
test.use({ colorScheme: "light" });

/**
 * The theme toggle flips <html data-theme> (which all the CSS reads) and the
 * choice survives a reload via localStorage.
 */
test.describe("theme toggle", () => {
  test("flips light/dark and persists across reload", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
  });
});
