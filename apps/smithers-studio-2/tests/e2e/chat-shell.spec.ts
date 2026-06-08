import { expect, test } from "../support/test";

/**
 * REAL-BACKEND chat-first shell. No route mocking: vite proxies to the real
 * gateway + workspace-API + PTY fixtures (playwright.config.ts). The chat feed,
 * projects, tags, and overlay openers are the in-app seam (mock impl) — they are
 * product behavior today — while `/runs` opens the REAL, gateway-backed Runs
 * surface inside the overlay.
 *
 * Each test forces the chat shell on (the shared fixture defaults specs to the
 * studio shell); this init script is added after it, so it wins.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("studio.shellMode", "chat");
    } catch {
      /* falls back to the chat default */
    }
  });
});

test.describe("Chat-first shell", () => {
  test("boots into the chat shell with project bar, stats, and the seeded feed", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("chat-shell")).toBeVisible();
    await expect(page.getByTestId("project-chip")).toContainText("acme-web");
    await expect(page.getByTestId("stats-strip")).toBeVisible();

    // Seeded acme-web conversation renders, including a colored tag.
    await expect(page.getByTestId("chat-item").first()).toBeVisible();
    await expect(page.getByTestId("chat-tag").first()).toBeVisible();
  });

  test("slash autocomplete opens and filters", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("chat-composer-input");

    await input.fill("/");
    await expect(page.getByTestId("slash-menu")).toBeVisible();
    await expect(page.getByTestId("slash-row").filter({ hasText: "/workflow" })).toBeVisible();

    // "/pr" is a prefix of both "/pr" and "/prompt".
    await input.fill("/pr");
    await expect(page.getByTestId("slash-row")).toHaveCount(2);

    await input.fill("/work");
    await expect(page.getByTestId("slash-row")).toHaveCount(1);
    await expect(page.getByTestId("slash-row")).toContainText("/workflow");
  });

  test("/runs opens the real Runs surface as a split overlay", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("chat-composer-input").fill("/runs");
    await page.getByTestId("chat-composer-send").click();

    await expect(page.getByTestId("overlay-host")).toBeVisible();
    // The overlay reuses the real, gateway-backed Runs surface verbatim.
    await expect(page.getByTestId("overlay-surface")).toBeVisible();
    await expect(page.getByTestId("chat-shell")).toHaveClass(/chat-shell--split/);

    // Toggle to full then close.
    await page.getByTestId("overlay-toggle-presentation").click();
    await expect(page.getByTestId("chat-shell")).toHaveClass(/chat-shell--full/);
    await page.getByTestId("overlay-close").click();
    await expect(page.getByTestId("overlay-host")).toHaveCount(0);
  });

  test("switching projects re-scopes the feed", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("project-chip").click();
    await page.getByTestId("project-menu-row").filter({ hasText: "payments-api" }).click();

    await expect(page.getByTestId("project-chip")).toContainText("payments-api");
    await expect(page.getByTestId("chat-stream")).toContainText("refund webhook");
  });

  test("/studio drops back to the classic tabbed shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("chat-shell")).toBeVisible();

    await page.getByTestId("chat-composer-input").fill("/studio");
    await page.getByTestId("chat-composer-send").click();

    // Classic shell mounts (sidebar brand is studio-only chrome).
    await expect(page.getByTestId("chat-shell")).toHaveCount(0);
    await expect(page.locator(".sidebar-brand-name")).toBeVisible();
  });
});
