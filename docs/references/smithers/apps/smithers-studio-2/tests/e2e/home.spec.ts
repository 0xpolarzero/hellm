import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import { SEEDED_JJHUB_STATE } from "../fixtures/seededData";

/**
 * REAL-BACKEND Home / Welcome surface e2e. No `page.route`, no `mockGateway`, no
 * fake data. The recents column reads the live workspace-API server over the
 * real `/__smithers_studio/api/local-workspaces` seam (vite proxies it to the
 * seeded `workspaceApiServer` fixture), and the Operations strip derives its
 * counts from the same Gateway RPCs the Runs surface uses (`listRuns` +
 * `listApprovals`) over the real `/v1/rpc/*` path.
 *
 * The Home surface had NO spec before this file. Round 1 replaced the strip's
 * hardcoded zeros with counts derived from the live backend; these tests pin
 * that behavior (the strip shows the REAL seeded running / pending-approval
 * counts, never 0).
 *
 * GATEWAY COUNTS ARE SHARED + ORDER-DEPENDENT: the gateway fixture is one
 * instance for the whole run and other specs mutate runs (approve / deny /
 * cancel), so absolute strip counts are not deterministic. We therefore assert
 * each live tile carries a POSITIVE integer (the seed always has at least one
 * running run + one pending approval gate) rather than an exact number, per the
 * suite's gateway-count convention.
 */

const SEEDED_RECENTS = SEEDED_JJHUB_STATE.recents;
const POSITIVE_INT = /^[1-9]\d*$/;

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("view.welcome")).toBeVisible();
}

test.describe("Home / Welcome surface (real backend)", () => {
  test("renders the welcome screen with the seeded recent workspaces", async ({ page }) => {
    await openHome(page);

    // The recents column is populated from the real /local-workspaces endpoint.
    // The boot/connect panel must NOT show — the backend is reachable and answers.
    await expect(page.getByTestId("home.boot")).toHaveCount(0);

    const rows = page.getByTestId("welcome.recent.row");
    await expect(rows).toHaveCount(SEEDED_RECENTS.length);
    for (const recent of SEEDED_RECENTS) {
      await expect(
        rows.filter({ hasText: recent.displayName }),
      ).toHaveCount(1);
    }
  });

  test("the Operations strip shows real positive running + pending-approval counts (not 0)", async ({ page }) => {
    await openHome(page);

    const strip = page.getByTestId("home.operations");
    await expect(strip).toBeVisible();

    // Each tile's count is derived from the live listRuns / listApprovals payload.
    // The seed always carries a running run (run-deploy-running) and a pending
    // approval gate (run-approve-waiting), so the running + pending tiles read a
    // positive integer — proving the round-1 fix that replaced hardcoded zeros.
    const runningCount = strip.locator(".home-op--running .home-op-count");
    const approvalCount = strip.locator(".home-op--approval .home-op-count");

    await expect(runningCount).toHaveText(POSITIVE_INT);
    await expect(approvalCount).toHaveText(POSITIVE_INT);
  });

  test("a Operations tile deep-links into the Runs surface", async ({ page }) => {
    await openHome(page);

    await page.getByTestId("home.operations").locator(".home-op--running").click();
    await expect(page.getByTestId("view.runs")).toBeVisible();
  });

  test("a real recents fault surfaces the boot panel and Retry recovers it", async ({ page, context }) => {
    await openHome(page);
    // Sanity: with the backend reachable, recents render and the boot panel is hidden.
    await expect(page.getByTestId("welcome.recent.row").first()).toBeVisible();
    await expect(page.getByTestId("home.boot")).toHaveCount(0);

    // Drive a REAL fault: take the browser context offline so the next
    // /local-workspaces fetch genuinely fails at the network layer (a real
    // network error — NOT a route mock, NOT fabricated data). This is exactly
    // the "workspace gateway unreachable" condition Home's boot panel handles.
    await context.setOffline(true);

    // Trigger a fresh recents load by remounting Home (navigate away to Runs and
    // back). The real failed fetch flips the hook to disconnected and the boot
    // panel + Retry button render in place of the recents list.
    await page.getByTestId("nav.Runs").click();
    await expect(page.getByTestId("view.runs")).toBeVisible();
    await page.getByTestId("nav.Home").click();

    const boot = page.getByTestId("home.boot");
    await expect(boot).toBeVisible();
    await expect(boot).toContainText("No workspace gateway connected");
    const retry = boot.getByRole("button", { name: "Retry connection" });
    await expect(retry).toBeVisible();

    // Restore connectivity and Retry: the button re-queries the REAL backend,
    // which now answers, so the boot panel clears and the seeded recents return.
    await context.setOffline(false);
    await retry.click();

    await expect(page.getByTestId("home.boot")).toHaveCount(0);
    await expect(page.getByTestId("welcome.recent.row")).toHaveCount(SEEDED_RECENTS.length);
  });
});
