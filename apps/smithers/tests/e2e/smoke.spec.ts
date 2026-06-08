import { expect, test } from "@playwright/test";

/**
 * The app boots against the real stack (gateway fixture + worker host + vite)
 * and renders its shell with no uncaught errors. This is the floor every other
 * spec stands on.
 */
test.describe("app shell", () => {
  test("boots and renders the composer with no uncaught errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto("/");

    await expect(page.getByRole("textbox", { name: "Message Smithers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How can I help you?" })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
