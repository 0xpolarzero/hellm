import { expect, test } from "@playwright/test";

/**
 * View navigation. The app is URL-routed (TanStack Router): the home/chat view
 * is "/", Ask Me is "/askme", the store is "/store". Asserting on the pathname
 * keeps these stable across the zustand/router internals.
 *
 * Two ways to switch a view: typing in the composer (plain "store", or a leading
 * "/askme" / "/chat" / "/store"), and picking a view from the CommandMenu pill.
 */
const atPath = (path: string) => (url: URL) => url.pathname === path;

test.describe("view navigation", () => {
  test("typed commands and the CommandMenu switch the active view", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    const viewNav = page.getByRole("navigation", { name: "View navigation" });

    // Default view is home/chat.
    await expect(page).toHaveURL(atPath("/"));

    // Plain-language "store" opens the workflow store.
    await input.fill("store");
    await input.press("Enter");
    await expect(page).toHaveURL(atPath("/store"));

    // A leading "/askme" switches to the Ask Me view.
    await input.fill("/askme");
    await input.press("Enter");
    await expect(page).toHaveURL(atPath("/askme"));

    // "/chat" returns to the home/chat view.
    await input.fill("/chat");
    await input.press("Enter");
    await expect(page).toHaveURL(atPath("/"));

    // Picking a view from the CommandMenu pill also routes. The pill's accessible
    // name is the current view's label ("Chat"); options are radio menuitems.
    await viewNav.getByRole("button", { name: "Chat" }).click();
    await page.getByRole("menuitemradio", { name: /Store/ }).click();
    await expect(page).toHaveURL(atPath("/store"));
  });

  test("the CommandMenu navigates to canvas surfaces and the palette", async ({ page }) => {
    await page.goto("/");
    const viewNav = page.getByRole("navigation", { name: "View navigation" });

    // The "Go to" section opens a canvas surface by its route. The pill's name is
    // the active mode's label ("Store" here, the default opened earlier persists
    // only within a test, so it reads "Chat" on a fresh load).
    await viewNav.getByRole("button", { name: "Chat" }).click();
    await page.getByRole("menuitem", { name: "Runs" }).click();
    await expect(page).toHaveURL(atPath("/runs"));

    // The Find row opens the command palette surface.
    await viewNav.getByRole("button", { name: "Chat" }).click();
    await page.getByRole("menuitem", { name: /Find/ }).click();
    await expect(page).toHaveURL(atPath("/palette"));
  });
});
