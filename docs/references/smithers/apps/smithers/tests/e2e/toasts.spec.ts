import { expect, test } from "@playwright/test";

/**
 * Corner toasts (the .toast-stack live region) surface background/workflow runs.
 * Sending a prompt in the Ask Me flow raises a workflow toast titled "Ask Me";
 * its menu can dismiss it or jump back to the Ask Me view.
 *
 * No route mocking: a leading "/askme" switches the active view and sends the
 * line, which streams the seeded reply through the real worker → fixture
 * upstream. In dev a "Demo workflow" toast is always mounted, so every toast
 * assertion is scoped to the live region and to the "Ask Me"-titled toast.
 */
test.describe("workflow toasts", () => {
  // The corner stack is an aria-live="polite" region; scope toast queries to it
  // so the dev-only demo toast and the "Ask Me" command pill never collide. The
  // single "Ask Me" workflow toast lives inside it.
  const askMeToast = (page: import("@playwright/test").Page) =>
    page.locator(".toast-stack").locator(".toast", { hasText: "Ask Me" });

  test("sending an Ask Me prompt raises a toast that can be dismissed", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("/askme rust ownership");
    await input.press("Enter");

    // The workflow toast appears with its title and a Running status.
    const toast = askMeToast(page);
    await expect(toast).toBeVisible();
    await expect(toast.locator(".toast-title")).toHaveText("Ask Me");

    // Open its actions menu (the trigger is a menu-button) and dismiss it.
    const trigger = toast.locator(".toast-main");
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await toast.getByRole("menuitem", { name: "Dismiss" }).click();

    // That specific toast is gone; the dev demo toast may still linger.
    await expect(askMeToast(page)).toHaveCount(0);
  });

  test("the toast's View workflow action navigates to the Ask Me view", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("/askme system design");
    await input.press("Enter");

    const toast = askMeToast(page);
    await expect(toast).toBeVisible();

    // Sending "/askme …" already switched the active view to Ask Me. Step away
    // to Chat via the command pill so the View action has somewhere to return
    // from. The pill lives in the View navigation nav, distinct from the toast.
    const viewNav = page.getByRole("navigation", { name: "View navigation" });
    await viewNav.getByRole("button", { name: "Ask Me" }).click();
    await page.getByRole("menuitemradio", { name: /Chat/ }).click();
    await expect(viewNav.getByRole("button", { name: "Chat" })).toBeVisible();

    // The toast's View workflow action jumps back to the Ask Me view.
    await toast.locator(".toast-main").click();
    await toast.getByRole("menuitem", { name: "View workflow" }).click();
    await expect(viewNav.getByRole("button", { name: "Ask Me" })).toBeVisible();
  });
});
