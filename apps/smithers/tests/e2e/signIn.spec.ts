import { expect, test } from "@playwright/test";

/**
 * The "Sign in" chip opens an overlay instead of navigating to the /login page,
 * so the user keeps their place. The e2e auth fixture boots signed in; sign out
 * first, then assert overlay behavior. Actual OAuth/token exchange lives behind
 * external auth.
 */
test.describe("sign-in modal", () => {
  test("opens as an overlay without leaving the page, and closes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("auth-status").locator(".auth-name")).toHaveText(
      "Fixture User",
    );
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.getByRole("button", { name: "Sign in" }).click();

    const dialog = page.getByRole("dialog", { name: "Sign in to Smithers" });
    await expect(dialog).toBeVisible();
    // The modal pops over the current page; it must NOT navigate to /login.
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);

    await dialog.getByRole("button", { name: "Close sign in" }).click();
    await expect(dialog).toBeHidden();

    // Backdrop click also dismisses it.
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(dialog).toBeVisible();
    await page.locator(".signin-backdrop").click({ position: { x: 8, y: 8 } });
    await expect(dialog).toBeHidden();
  });
});
