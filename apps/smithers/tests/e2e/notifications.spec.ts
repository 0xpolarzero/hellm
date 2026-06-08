import { expect, test } from "@playwright/test";

/**
 * The corner toast stack (Toasts.tsx). The element only mounts when at least
 * one notification exists in the store, so every assertion triggers a real
 * notification first and then checks the live region + its toast contents.
 */
test.describe("toast stack", () => {
  test("approving a launched run raises an Approval-granted toast", async ({
    page,
  }) => {
    await page.goto("/runs");

    const approval = page.getByTestId("runs-approval");
    await expect(approval).toBeVisible();
    await approval.getByRole("button", { name: "Approve" }).click();

    const stack = page.locator(".toast-stack");
    await expect(stack).toBeVisible();
    // The live region carries the polite ARIA attribute for screen readers.
    await expect(stack).toHaveAttribute("aria-live", "polite");

    const toast = stack.locator(".toast", { hasText: "Approval granted" });
    await expect(toast).toBeVisible();
  });

  test("denying a run raises an Approval-denied toast", async ({ page }) => {
    await page.goto("/runs");

    const approval = page.getByTestId("runs-approval");
    await expect(approval).toBeVisible();
    await approval.getByRole("button", { name: "Deny" }).click();

    const toast = page
      .locator(".toast-stack .toast", { hasText: "Approval denied" });
    await expect(toast).toBeVisible();
  });
});
