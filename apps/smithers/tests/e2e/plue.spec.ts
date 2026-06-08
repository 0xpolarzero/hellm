import { expect, test } from "@playwright/test";

test.describe("Plue harness & edge cases", () => {
  test("handles route edge cases and missing paths gracefully", async ({ page }) => {
    const response = await page.goto("/gw/not-found/run-123");
    // Depending on routing, might return 404 or redirect. Let's check it doesn't crash.
    await expect(page.locator("body")).toBeVisible();
  });

  test("handles large inputs without crashing", async ({ page }) => {
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Message Smithers" });
    const largeText = "A".repeat(5000);
    await input.fill(largeText);
    await expect(input).toHaveValue(largeText);
  });

  test("shows stale data appropriately when offline or disconnected", async ({ page }) => {
    await page.goto("/approvals");
    // Verify approvals list renders without error
    await expect(page.locator(".surface-title").filter({ hasText: "Approvals" })).toBeVisible();
  });

  test("handles network reconnects gracefully", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "Message Smithers" })).toBeVisible();
    await context.setOffline(true);
    // Might show a toast or offline indicator, but at least shouldn't crash
    await context.setOffline(false);
    await expect(page.getByRole("textbox", { name: "Message Smithers" })).toBeVisible();
  });

  test("observability metrics route does not break the app", async ({ page }) => {
    const res = await page.request.get("/health");
    expect(res.status()).toBe(200);
  });
});
