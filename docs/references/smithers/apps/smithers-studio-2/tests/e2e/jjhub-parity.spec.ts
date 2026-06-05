import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import { SEEDED_JJHUB_STATE } from "../fixtures/seededData";

/**
 * REAL-BACKEND e2e for the JJHub parity surfaces (Issues / Landings /
 * Workspaces). No `page.route`, no `mockGateway`. The browser makes real
 * same-origin fetches to `/__smithers_studio/api/*`; vite proxies those to the
 * workspaceApiServer fixture, which serves the deterministic JJHub state from
 * `seededData` and mutates it in-process so create/close/review/land/suspend
 * flows behave like a live backend within a run. Every asserted value comes
 * from SEEDED_JJHUB_STATE — no magic constants.
 */

const [OPEN_ISSUE, CLOSED_ISSUE] = SEEDED_JJHUB_STATE.issues;
const [OPEN_LANDING] = SEEDED_JJHUB_STATE.landings;
const [ACTIVE_WORKSPACE, SUSPENDED_WORKSPACE] = SEEDED_JJHUB_STATE.workspaces;
const [BASE_SNAPSHOT] = SEEDED_JJHUB_STATE.snapshots;
const CONFLICT_FILE = OPEN_LANDING.conflicts.conflicts[0].filePath;

/** The workspaceApiServer's next-id counters: issue #103, landing #203. */
const CREATED_ISSUE_NUMBER = 103;
const CREATED_LANDING_NUMBER = 203;

async function openMoreSurface(page: Page, label: "Issues" | "Landings" | "Workspaces"): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByTestId(`nav.${label}`).click();
}

test("issues surface lists seeded JJHub issues and round-trips create / close / reopen against the real backend", async ({ page }) => {
  await openMoreSurface(page, "Issues");

  // Default filter is "open": only the open seeded issue is visible.
  await expect(page.getByText(OPEN_ISSUE.title)).toBeVisible();
  await expect(page.getByText(`Loaded 1 issue`)).toBeVisible();
  await expect(page.getByText(CLOSED_ISSUE.title)).toHaveCount(0);

  // Switching the filter to "all" surfaces the closed seeded issue too.
  await page.locator(".issues-surface select").selectOption("all");
  await expect(page.getByText(OPEN_ISSUE.title)).toBeVisible();
  await expect(page.getByText(CLOSED_ISSUE.title)).toBeVisible();

  // Create a real issue through POST /api/issues.
  await page.getByRole("button", { name: "New Issue" }).click();
  await page.getByPlaceholder("Issue title").fill("Studio created issue");
  await page.getByPlaceholder("Issue description (optional)").fill("Created end to end");
  await page.getByRole("button", { name: "Create Issue" }).click();
  await expect(page.getByText(`Created issue #${CREATED_ISSUE_NUMBER}.`)).toBeVisible();
  await expect(page.locator(".issue-row", { hasText: "Studio created issue" })).toBeVisible();

  // Close it: confirm modal + real POST /api/issues/:n/close.
  await page.locator(".issue-row", { hasText: "Studio created issue" }).click();
  await page.getByRole("button", { name: "Close Issue" }).first().click();
  await page.locator(".modal-content").getByRole("button", { name: "Close Issue" }).click();
  await expect(page.getByText(`Closed issue #${CREATED_ISSUE_NUMBER}.`)).toBeVisible();

  // Reopen it: real POST /api/issues/:n/reopen.
  await page.getByRole("button", { name: "Reopen Issue" }).click();
  await expect(page.getByText(`Reopened issue #${CREATED_ISSUE_NUMBER}.`)).toBeVisible();
});

test("issue detail loads seeded body, labels, and comment count via real GET /api/issues/:n", async ({ page }) => {
  await openMoreSurface(page, "Issues");

  const openIssueRow = page.locator(".issue-row", { hasText: OPEN_ISSUE.title });
  // Labels render on the seeded issue row from the real list response.
  for (const label of OPEN_ISSUE.labels) {
    await expect(openIssueRow.locator(".issue-label", { hasText: label })).toBeVisible();
  }

  await openIssueRow.click();
  await expect(page.locator(".issue-detail-header")).toContainText(`#${OPEN_ISSUE.number}`);
  await expect(page.locator(".issue-body")).toContainText(OPEN_ISSUE.body);
  await expect(page.locator(".issue-comments")).toContainText(`${OPEN_ISSUE.commentCount} comment`);
});

test("landings expose filters, detail tabs, seeded diffs / checks / conflicts, and real review + land mutations", async ({ page }) => {
  await openMoreSurface(page, "Landings");

  // "open" filter shows the open seeded landing and hides the merged one.
  await page.locator(".landings-surface select").selectOption("open");
  await expect(page.locator(".landing-row", { hasText: OPEN_LANDING.title })).toBeVisible();
  await expect(page.locator(".landing-row", { hasText: SEEDED_JJHUB_STATE.landings[1].title })).toHaveCount(0);

  await page.locator(".landing-row", { hasText: OPEN_LANDING.title }).click();

  // Diff tab — real GET /api/landings/:n/diff returns the seeded unified diff.
  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.locator(".diff-content")).toContainText("diff --git");
  await expect(page.locator(".diff-content")).toContainText("landing change");

  // Checks tab — seeded check output.
  await page.getByRole("button", { name: "Checks" }).click();
  await expect(page.getByText("build: passing")).toBeVisible();
  await expect(page.getByText("test: passing")).toBeVisible();

  // Conflicts tab — seeded conflict on the seeded file path.
  await page.getByRole("button", { name: "Conflicts" }).click();
  await expect(page.getByText(CONFLICT_FILE)).toBeVisible();
  await expect(page.locator(".conflict-status")).toContainText("Has conflicts");

  // Review (approve) — real POST /api/landings/:n/review sets reviewStatus.
  await page.getByRole("button", { name: "Info" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Review submitted: approve.")).toBeVisible();
  await expect(page.locator(".landing-metadata")).toContainText("approved");

  // Land — real POST /api/landings/:n/land flips state to merged.
  await page.locator(".landing-actions").getByRole("button", { name: "Land" }).click();
  await expect(page.locator(".modal-content")).toContainText(`Land #${OPEN_LANDING.number}`);
  await page.locator(".modal-content").getByRole("button", { name: "Land" }).click();
  await expect(page.getByText(`Landed #${OPEN_LANDING.number}.`)).toBeVisible();
});

test("landings create a real landing through POST /api/landings", async ({ page }) => {
  await openMoreSurface(page, "Landings");

  await page.getByRole("button", { name: "New Landing" }).click();
  await page.getByPlaceholder("Landing title").fill("Studio created landing");
  await page.getByPlaceholder("Landing description (optional)").fill("Created end to end");
  await page.getByRole("button", { name: "Create Landing" }).click();
  await expect(page.getByText(`Created landing #${CREATED_LANDING_NUMBER}.`)).toBeVisible();
  await expect(page.locator(".landing-row", { hasText: "Studio created landing" })).toBeVisible();
});

test("workspaces list seeded cloud workspaces and round-trip resume / suspend / fork / delete and snapshots against the real backend", async ({ page }) => {
  await openMoreSurface(page, "Workspaces");

  await expect(page.getByText(ACTIVE_WORKSPACE.name)).toBeVisible();
  await expect(page.getByText(SUSPENDED_WORKSPACE.name)).toBeVisible();
  await expect(page.getByText(`Loaded ${SEEDED_JJHUB_STATE.workspaces.length} cloud workspace`)).toBeVisible();

  // Create a real workspace through POST /api/workspaces.
  await page.getByRole("button", { name: "New Workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill("studio-created-ws");
  await page.getByRole("button", { name: "Create Workspace" }).click();
  await expect(page.getByText("Created workspace studio-created-ws.")).toBeVisible();

  // The seeded suspended workspace exposes Resume — real POST .../resume.
  const suspendedItem = page.locator(".workspace-item", { hasText: SUSPENDED_WORKSPACE.name });
  await suspendedItem.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText(`Resumed workspace ${SUSPENDED_WORKSPACE.name}.`)).toBeVisible();

  // Once running, the same workspace exposes Suspend — real POST .../suspend.
  await suspendedItem.getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByText(`Suspended workspace ${SUSPENDED_WORKSPACE.name}.`)).toBeVisible();

  // Fork the active seeded workspace — real POST .../fork.
  const activeItem = page.locator(".workspace-item", { hasText: ACTIVE_WORKSPACE.name }).first();
  await activeItem.getByRole("button", { name: "Fork" }).click();
  await page.getByPlaceholder("Fork name").fill("studio-fork");
  await page.locator(".modal-content").getByRole("button", { name: "Fork" }).click();
  await expect(page.getByText("Forked workspace to studio-fork.")).toBeVisible();

  // Delete the workspace we just created — real DELETE /api/workspaces/:id.
  const createdItem = page.locator(".workspace-item", { hasText: "studio-created-ws" });
  await createdItem.getByRole("button", { name: "Delete" }).click();
  await page.locator(".modal-content").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted workspace studio-created-ws.")).toBeVisible();
});

test("workspace snapshots list the seeded snapshot and create a real snapshot through POST /api/workspaces/snapshots", async ({ page }) => {
  await openMoreSurface(page, "Workspaces");

  await page.locator(".workspaces-surface select").first().selectOption("snapshots");
  await expect(page.getByText(BASE_SNAPSHOT.name)).toBeVisible();

  await page.getByRole("button", { name: "New Snapshot" }).click();
  await page.getByPlaceholder("Snapshot name").fill("studio-snapshot-from-ui");
  await page.getByRole("button", { name: "Create Snapshot" }).click();
  await expect(page.getByText("Created snapshot studio-snapshot-from-ui.")).toBeVisible();
  await expect(page.locator(".snapshot-name", { hasText: "studio-snapshot-from-ui" })).toBeVisible();
});

test("workspaces restore-from-snapshot names a new workspace and selects a seeded snapshot, creating it through the real backend", async ({ page }) => {
  await openMoreSurface(page, "Workspaces");

  await page.getByRole("button", { name: "Restore from Snapshot" }).click();
  await page.getByPlaceholder("Restored workspace name").fill("studio-restored");
  await page.locator(".modal-content select").selectOption(BASE_SNAPSHOT.id);
  await page.locator(".modal-content").getByRole("button", { name: "Restore" }).click();
  // Restore hands off to the create-workspace modal pre-filled with the name.
  await page.getByRole("button", { name: "Create Workspace" }).click();
  await expect(page.getByText("Created workspace studio-restored.")).toBeVisible();
});
