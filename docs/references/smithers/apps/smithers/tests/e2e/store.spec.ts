import { expect, test, type Page } from "@playwright/test";

// Pin the OS preference so the shell boots deterministically regardless of the
// runner's color-scheme.
test.use({ colorScheme: "light" });

/** Open the store from the composer, the way a user types it. */
async function openStore(page: Page) {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Smithers" });
  await input.fill("store");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Workflow Store" }),
  ).toBeVisible();
  return input;
}

/**
 * The openable card for a catalog workflow, picked by its exact display name.
 * Several catalog names share a prefix ("Implement" vs "Research Plan
 * Implement"), so match the name span exactly instead of by substring.
 */
function storeCard(page: Page, name: string) {
  return page
    .locator(".store-card")
    .filter({ has: page.getByText(name, { exact: true }) });
}

/**
 * The workflow store is a browse view of the install pack. Typing "store" opens
 * it; each card opens its workflow — either jumping to that view (e.g. Ask Me)
 * or dropping into chat with a starter prompt prefilled and an "opened" toast.
 * Behavior-level only: card names come from the catalog (workflows.ts), the
 * shell from main.app-shell[data-mode], and the rest from visible text + roles.
 */
test.describe("workflow store", () => {
  test("opens via the composer and lists installed workflows", async ({ page }) => {
    await openStore(page);

    // Opening the store docks the composer, so the shell leaves the home flow.
    await expect(page.locator("main.app-shell")).toHaveAttribute(
      "data-mode",
      "chat",
    );

    // The default pack (workflows.ts) renders as cards. Implement and Grill Me
    // are the two load-bearing openable demos the other tests drive.
    await expect(storeCard(page, "Implement")).toBeVisible();
    await expect(storeCard(page, "Grill Me")).toBeVisible();
    // The pack surfaces many more workflows than those two; assert the catalog
    // is populated without pinning a name shared across several cards.
    expect(await page.locator(".store-card").count()).toBeGreaterThan(5);
  });

  test("opening a starter workflow prefills the composer and toasts", async ({
    page,
  }) => {
    const input = await openStore(page);

    // "Implement" carries a starter prompt, so opening it drops into chat with
    // the prompt prefilled rather than navigating to another view.
    await storeCard(page, "Implement").click();

    await expect(input).toHaveValue(/Implement this change/);

    // The open is announced as a corner toast titled after the workflow. Scope
    // to the toast stack so the always-on dev preview toasts don't interfere.
    const toasts = page.locator(".toast-stack");
    await expect(toasts.getByText("Implement", { exact: true })).toBeVisible();
    await expect(toasts.getByText("Workflow opened")).toBeVisible();
  });

  test("opening a view workflow navigates to that view", async ({ page }) => {
    await openStore(page);

    // "Grill Me" has no starter — it routes to the Ask Me view instead, which
    // shows its empty-state grilling hint.
    await storeCard(page, "Grill Me").click();

    await expect(page.getByText("Tell me what to grill you on")).toBeVisible();
  });

  test("mobile header is not covered by the auth chip", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openStore(page);

    const chip = await page.getByTestId("auth-status").boundingBox();
    const title = await page.getByRole("heading", { name: "Workflow Store" }).boundingBox();
    expect(chip).not.toBeNull();
    expect(title).not.toBeNull();
    expect(title!.y).toBeGreaterThan(chip!.y + chip!.height + 4);
  });
});
