import { expect, test } from "@playwright/test";

/**
 * Canvas surfaces. A feature slash command can open a side-canvas instead of
 * posting a chat card: `/logs` opens the transcript surface and `/timeline`
 * opens the time-travel surface. Both are URL-routed under a run
 * (`/runs/$runId/logs`, `/runs/$runId/timeline`) and, when no run exists yet,
 * auto-launch one (see runSlash → openSurface). The run id is a sequential
 * counter we can't pin, so the URL is asserted by pathname shape, and the
 * surface itself by its own data-testid section plus a visible child.
 *
 * No route mocking: the slash is typed into the real composer and dispatched
 * through the live router; the canvas reads its local run fixtures.
 */
const LOGS_PATH = /^\/runs\/[^/]+\/logs$/;
const TIMELINE_PATH = /^\/runs\/[^/]+\/timeline$/;

test.describe("canvas surfaces", () => {
  test("/logs opens the logs surface and renders log lines", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("/logs");
    await input.press("Enter");

    // The slash auto-launches a run when none exists, then routes to its logs
    // surface. Assert the pathname shape rather than a pinned run id.
    await expect(page).toHaveURL((url) => LOGS_PATH.test(url.pathname));

    // The transcript canvas mounts with its toolbar and a non-empty stream.
    const canvas = page.locator('[data-testid="logs-canvas"]');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator(".log-line").first()).toBeVisible();
    expect(await canvas.locator(".log-line").count()).toBeGreaterThan(0);
  });

  test("/timeline opens the timeline surface and renders the scrubber", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("/timeline");
    await input.press("Enter");

    // Auto-launches a run, then routes to its time-travel surface.
    await expect(page).toHaveURL((url) => TIMELINE_PATH.test(url.pathname));

    // The time-travel canvas mounts with its frame scrubber: the counter,
    // track, native slider, frame label, and at least one frame dot.
    const canvas = page.locator('[data-testid="timeline-canvas"]');
    await expect(canvas).toBeVisible();
    await expect(canvas.getByTestId("tl-counter")).toBeVisible();
    await expect(canvas.getByTestId("tl-scrubber")).toBeVisible();
    await expect(canvas.locator(".tl-track")).toBeVisible();
    await expect(canvas.getByTestId("tl-frame-label")).toBeVisible();
    await expect(canvas.getByTestId("tl-slider")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: /^Frame \d+:/ }).first(),
    ).toBeVisible();
  });
});
