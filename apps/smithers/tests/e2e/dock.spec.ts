import { expect, test } from "@playwright/test";

/**
 * The bottom app dock. It auto-hides and slides up when the pointer reaches the
 * bottom-edge trigger. Opening an app (here by deep link) registers it as an
 * icon tile; the tile survives navigating away and a reload (persisted), focuses
 * the app on click, and leaves the dock when closed. Drives the real stack, no
 * mocks. See `.smithers/specs/apps-and-workflows-dock.md`.
 */
test.describe("app dock", () => {
  test("auto-hides, reveals on hover, persists, focuses and closes", async ({ page }) => {
    await page.goto("/issues");

    const dock = page.getByRole("toolbar", { name: "Open apps" });
    const trigger = page.locator(".app-dock-trigger");

    // Auto-hidden by default (Playwright counts opacity:0 as "visible", so we
    // assert the opacity rather than visibility).
    await expect(dock).toHaveCSS("opacity", "0");

    // Hovering the bottom-edge trigger slides the dock up.
    await trigger.hover();
    await expect(dock).toHaveCSS("opacity", "1");
    await expect(dock.getByRole("button", { name: "Issues", exact: true })).toBeVisible();

    // Navigating to another app docks it too; the first stays open.
    await page.goto("/vcs");
    await trigger.hover();
    await expect(dock.getByRole("button", { name: "Git", exact: true })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Issues", exact: true })).toBeVisible();

    // The open set is persisted, so a reload keeps both tiles.
    await page.reload();
    await trigger.hover();
    await expect(dock.getByRole("button", { name: "Git", exact: true })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Issues", exact: true })).toBeVisible();

    // Clicking a tile focuses that app.
    await dock.getByRole("button", { name: "Issues", exact: true }).click();
    await expect(page).toHaveURL(/\/issues$/);

    // Closing removes it from the dock (reveal, hover the tile, click close).
    await trigger.hover();
    const issuesItem = dock
      .locator(".app-dock-item")
      .filter({ has: page.getByRole("button", { name: "Issues", exact: true }) });
    await issuesItem.hover();
    await issuesItem.getByRole("button", { name: "Close Issues" }).click();
    await expect(dock.getByRole("button", { name: "Issues", exact: true })).toHaveCount(0);
    // Git is still docked.
    await expect(dock.getByRole("button", { name: "Git", exact: true })).toBeVisible();
  });
});
