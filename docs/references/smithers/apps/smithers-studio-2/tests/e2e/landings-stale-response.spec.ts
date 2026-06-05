import { expect, test } from "../support/test";
import { SEEDED_JJHUB_STATE, STALE_DIFF_DELAY_MS } from "../fixtures/seededData";

/**
 * REAL-BACKEND regression test for the landings stale-response guard. No
 * `page.route`, no mocking: the browser makes real same-origin fetches that
 * vite proxies to the workspaceApiServer fixture. That server delays the "alpha"
 * landing's diff by STALE_DIFF_DELAY_MS (see seededData), so it resolves AFTER
 * the "beta" landing's diff — reproducing, against a real server, the race the
 * guard protects against.
 *
 * Bug: selecting landing A and opening Diff fires an async request. Switching to
 * landing B before A resolves used to let A's late response overwrite B's freshly
 * loaded diff. The fix guards each setter with a ref to the selected landing id.
 */
const SLOW_LANDING = SEEDED_JJHUB_STATE.landings.find((landing) => landing.number === 301)!;
const FAST_LANDING = SEEDED_JJHUB_STATE.landings.find((landing) => landing.number === 302)!;

test("late diff response for a deselected landing does not overwrite the newly selected landing", async ({ page }) => {
  await page.goto("/");
  // Landings is a secondary surface under the collapsed "More" group.
  await page.getByRole("button", { name: "More" }).click();
  await page.getByTestId("nav.Landings").click();

  // Select the slow landing and open its Diff tab. Its diff request is now in
  // flight and the real server holds it for STALE_DIFF_DELAY_MS.
  await page.locator(".landing-row", { hasText: SLOW_LANDING.title }).click();
  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.getByText("Loading diff...")).toBeVisible();

  // Switch to the fast landing before the slow diff resolves; its diff loads
  // immediately.
  await page.locator(".landing-row", { hasText: FAST_LANDING.title }).click();
  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.locator(".diff-content")).toContainText("new-beta");

  // Wait past the slow landing's server delay so its now-stale response arrives.
  // The guard must drop it; without the guard it would clobber the beta diff.
  await page.waitForTimeout(STALE_DIFF_DELAY_MS + 400);
  await expect(page.locator(".diff-content")).toContainText("new-beta");
  await expect(page.locator(".diff-content")).not.toContainText("new-alpha");
});
