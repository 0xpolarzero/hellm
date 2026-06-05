import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import { SEEDED_JJHUB_STATE } from "../fixtures/seededData";

/**
 * jjhub-restyle (REAL backend): verifies the dark-theme / decluttered restyle of
 * the three secondary "More" surfaces (Issues / Landings / Workspaces) WITHOUT
 * regressing behavior. NO `page.route`, NO `mockGateway`. Every assertion is
 * driven against the live workspace-API server (vite proxies `/__smithers_studio`
 * to it) over the real component + workspaceApi fetch path, and pins both the
 * restyle (page-bg token applied to the secondary surface header, transparent
 * status label background) and the load-bearing accessible names + testids that
 * must survive the restyle. The asserted values come from the deterministic
 * seed in `../fixtures/seededData` (no magic constants).
 *
 * Complementary to jjhub-parity.spec.ts: parity proves the data/CRUD flows,
 * this pins the visual restyle without re-stubbing fetch.
 */

const PAGE_BG = "rgb(12, 14, 22)"; // --bg #0C0E16
const TRANSPARENT = "rgba(0, 0, 0, 0)";

const OPEN_ISSUE = SEEDED_JJHUB_STATE.issues.find((issue) => issue.state === "open")!;
const CLOSED_ISSUE = SEEDED_JJHUB_STATE.issues.find((issue) => issue.state === "closed")!;
const OPEN_LANDING = SEEDED_JJHUB_STATE.landings.find((landing) => landing.state === "open")!;
const ACTIVE_WORKSPACE = SEEDED_JJHUB_STATE.workspaces.find((ws) => ws.status === "active")!;
const SUSPENDED_WORKSPACE = SEEDED_JJHUB_STATE.workspaces.find((ws) => ws.status === "suspended")!;

async function openMore(page: Page, name: "Issues" | "Landings" | "Workspaces") {
  await page.goto("/");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name }).click();
}

test("Issues restyle: dark secondary surface, calmer rows, behavior preserved", async ({ page }) => {
  await openMore(page, "Issues");

  // Accessible name + restyle hook both survive.
  await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
  await expect(page.locator(".issues-surface")).toBeVisible();

  // Dark theme: header sits on the page bg token, not a hardcoded light color.
  await expect(page.locator(".issues-surface .view-header")).toHaveCSS("background-color", PAGE_BG);

  // Real seeded data flow still renders the open issue (default filter is "open").
  await expect(page.getByText(OPEN_ISSUE.title)).toBeVisible();
  // The seeded closed issue stays hidden under the default open filter.
  await expect(page.getByText(CLOSED_ISSUE.title)).toHaveCount(0);

  // Selecting drives the detail pane against real /api/issues/:number (behavior preserved).
  await page.locator(".issue-row", { hasText: OPEN_ISSUE.title }).click();
  await expect(page.getByRole("heading", { name: new RegExp(OPEN_ISSUE.title) })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Issue" })).toBeVisible();
});

test("Landings restyle: dark secondary surface, quiet review block, tabs + actions intact", async ({ page }) => {
  await openMore(page, "Landings");

  await expect(page.getByRole("heading", { name: "Landings" })).toBeVisible();
  await expect(page.locator(".landings-surface")).toBeVisible();
  await expect(page.locator(".landings-surface .view-header")).toHaveCSS("background-color", PAGE_BG);

  await page.locator(".landing-row", { hasText: OPEN_LANDING.title }).click();

  // Detail tabs preserved and reachable; diff comes from the real /api/landings/:number/diff.
  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.locator(".diff-content")).toContainText("diff --git");
  await page.getByRole("button", { name: "Info" }).click();

  // Review block is decluttered but its actions remain reachable + functional.
  await expect(page.locator(".landing-review-section")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Review submitted: approve.")).toBeVisible();
});

test("Workspaces restyle: dark secondary surface, calm status labels, row actions reachable", async ({ page }) => {
  await openMore(page, "Workspaces");

  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  await expect(page.locator(".workspaces-surface")).toBeVisible();
  await expect(page.locator(".workspaces-surface .view-header")).toHaveCSS("background-color", PAGE_BG);

  // Both seeded cloud workspaces render from real /api/workspaces.
  await expect(page.getByText(ACTIVE_WORKSPACE.name)).toBeVisible();
  await expect(page.getByText(SUSPENDED_WORKSPACE.name)).toBeVisible();

  // Status renders as a plain colored label (chip background removed in restyle).
  await expect(page.locator(".workspaces-surface .workspace-status").first())
    .toHaveCSS("background-color", TRANSPARENT);
  // The suspended workspace uses the muted warning color token, not a filled chip.
  await expect(page.locator(".workspace-status-suspended").first()).toBeVisible();

  // Per-row actions stayed reachable despite the quieter styling: the suspended
  // workspace exposes Resume and it drives the real /api/workspaces/:id/resume.
  const suspended = page.locator(".workspace-item", { hasText: SUSPENDED_WORKSPACE.name });
  await suspended.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText(`Resumed workspace ${SUSPENDED_WORKSPACE.name}.`)).toBeVisible();
});
