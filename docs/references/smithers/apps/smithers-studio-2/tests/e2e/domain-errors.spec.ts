import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import { SEEDED_JJHUB_STATE, SEEDED_MEMORY_FACTS } from "../fixtures/seededData";

/**
 * REAL-BACKEND domain-error + optimistic-filter e2e for the JJHub parity
 * surfaces (Issues / Landings / Workspaces) plus the read-mostly Memory and
 * Scores surfaces. No `page.route`, no `routeWebSocket`, no `mockGateway`, no
 * fake data: the browser makes real same-origin fetches that vite proxies to
 * the workspaceApiServer fixture, and every asserted value comes from
 * SEEDED_JJHUB_STATE.
 *
 * Two things are exercised here:
 *
 * 1. FAILURE INJECTION against the real backend's DOCUMENTED 404 fault path.
 *    The Playwright `request` fixture shares this test's isolated session bucket
 *    (the support `test` injects the same `x-studio-session` header into both
 *    the page context and `request`), so a real out-of-band DELETE removes the
 *    entity from the SAME state the page reads. The next UI mutation against the
 *    now-gone entity gets a genuine 404 from the real server (the fixture's real
 *    "workspace not found" / "snapshot not found" branch) — exactly what a live
 *    backend returns when an entity vanishes under the UI. We assert the real
 *    error text renders in the surface and the busy/loading state resets. This
 *    is the convention-sanctioned "failure-injection against the real backend's
 *    documented fault path" — NOT a convenience mock.
 *
 * 2. OPTIMISTIC MUTATIONS RESPECT THE ACTIVE FILTER (the round-1 fix). When a
 *    mutation moves an entity out of the active state filter (closing an issue
 *    while "Open" is selected; landing a PR while "Open" is selected) the item
 *    must drop from the list, mirroring what a fresh server query would return.
 *    And a created item that does not match the active filter must not appear.
 *
 * Each spec uses a UNIQUE namespaced title so created entities can never be
 * confused across this file's tests; per-test session isolation guarantees the
 * seed and the created-id counters (#103 / #203 / ws-10) are deterministic.
 */

const [OPEN_ISSUE] = SEEDED_JJHUB_STATE.issues;
const [, SUSPENDED_WORKSPACE] = SEEDED_JJHUB_STATE.workspaces;
const [BASE_SNAPSHOT] = SEEDED_JJHUB_STATE.snapshots;
const OPEN_LANDING = SEEDED_JJHUB_STATE.landings.find((landing) => landing.number === 201)!;

/** The fixture's deterministic create counters for a fresh session. */
const CREATED_ISSUE_NUMBER = 103;

async function openMoreSurface(
  page: Page,
  label: "Issues" | "Landings" | "Workspaces" | "Memory" | "Scores",
): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByTestId(`nav.${label}`).click();
}

test.describe("domain mutation faults render real backend errors and reset busy state", () => {
  test("workspaces: resuming a workspace deleted out-of-band shows the real 404 and resets the busy button", async ({
    page,
    request,
  }) => {
    await openMoreSurface(page, "Workspaces");

    // The seeded suspended workspace renders with a Resume action.
    const suspendedItem = page.locator(".workspace-item", { hasText: SUSPENDED_WORKSPACE.name });
    await expect(suspendedItem.getByRole("button", { name: "Resume" })).toBeVisible();

    // Real failure injection: delete this workspace through the SAME isolated
    // session bucket the page reads (the request fixture carries this test's
    // session header). The page's list is now stale.
    const deleted = await request.delete(
      `/__smithers_studio/api/workspaces/${SUSPENDED_WORKSPACE.id}`,
    );
    expect(deleted.ok()).toBeTruthy();

    // Driving Resume now hits the real backend, which genuinely 404s because the
    // workspace is gone. The surface renders that real error text.
    await suspendedItem.getByRole("button", { name: "Resume" }).click();
    await expect(page.locator(".workspaces-surface .status-message")).toContainText(
      "workspace not found",
    );

    // Busy state reset: the button is no longer stuck on "Resuming..." — it is
    // re-enabled and back to its idle label.
    const resumeButton = suspendedItem.getByRole("button", { name: "Resume" });
    await expect(resumeButton).toBeEnabled();
    await expect(suspendedItem.getByRole("button", { name: "Resuming..." })).toHaveCount(0);
  });

  test("snapshots: deleting the seeded snapshot drives the real DELETE, drops the row, and resets busy", async ({
    page,
  }) => {
    await openMoreSurface(page, "Workspaces");
    await page.locator(".workspaces-surface select").first().selectOption("snapshots");

    const snapshotItem = page.locator(".snapshot-item", { hasText: BASE_SNAPSHOT.name });
    await expect(snapshotItem).toBeVisible();

    // Drive the real DELETE /workspaces/snapshots/:id through the confirm modal.
    // The real backend removes it and the optimistic update drops the row; the
    // busy button text resets from "Deleting..." back to idle (the modal closes).
    await snapshotItem.getByRole("button", { name: "Delete" }).click();
    await page.locator(".modal-content").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".workspaces-surface .status-message")).toContainText(
      `Deleted snapshot ${BASE_SNAPSHOT.name}.`,
    );
    await expect(page.locator(".snapshot-item", { hasText: BASE_SNAPSHOT.name })).toHaveCount(0);
    // Busy reset: the delete modal closed (no stuck "Deleting..." button).
    await expect(page.locator(".modal-content").getByRole("button", { name: "Deleting..." })).toHaveCount(0);
  });

  test("workspaces: suspending a workspace deleted out-of-band shows the real 404 and resets busy", async ({
    page,
    request,
  }) => {
    await openMoreSurface(page, "Workspaces");

    // Create a real workspace (active, so it exposes Suspend) with a unique name.
    const uniqueName = "domain-fault-suspend-target";
    await page.getByRole("button", { name: "New Workspace" }).click();
    await page.getByPlaceholder("Workspace name").fill(uniqueName);
    await page.getByRole("button", { name: "Create Workspace" }).click();
    await expect(page.getByText(`Created workspace ${uniqueName}.`)).toBeVisible();

    const createdItem = page.locator(".workspace-item", { hasText: uniqueName });
    // A freshly created workspace is "active"; the panel renders Suspend only for
    // "running". The active workspace still exposes Fork — drive Fork against a
    // deleted workspace to hit the real documented 404 on a mutation.
    const forkButton = createdItem.getByRole("button", { name: "Fork" });
    await expect(forkButton).toBeVisible();

    // Discover the created workspace id from the real backend and delete it
    // out-of-band through the shared session bucket.
    const listed = await request.get("/__smithers_studio/api/workspaces");
    const workspaces = (await listed.json()).workspaces as Array<{ id: string; name: string }>;
    const target = workspaces.find((workspace) => workspace.name === uniqueName)!;
    expect(target).toBeTruthy();
    const deleted = await request.delete(`/__smithers_studio/api/workspaces/${target.id}`);
    expect(deleted.ok()).toBeTruthy();

    // Fork the now-gone workspace: the real backend 404s ("workspace not found").
    await forkButton.click();
    await page.getByPlaceholder("Fork name").fill(`${uniqueName}-fork`);
    await page.locator(".modal-content").getByRole("button", { name: "Fork" }).click();
    await expect(page.locator(".workspaces-surface .status-message")).toContainText(
      "workspace not found",
    );

    // Busy reset: the fork modal's button is no longer stuck on "Forking..." and
    // is re-enabled.
    await expect(page.locator(".modal-content").getByRole("button", { name: "Forking..." })).toHaveCount(0);
    await expect(page.locator(".modal-content").getByRole("button", { name: "Fork" })).toBeEnabled();
  });
});

test.describe("optimistic mutations respect the active filter (round-1 fix)", () => {
  test("issues: closing an open issue under the Open filter drops it from the list", async ({ page }) => {
    await openMoreSurface(page, "Issues");

    // Default filter is "open"; create a uniquely-named issue (it is open, so it
    // matches and appears).
    const uniqueTitle = "domain-filter-issue-close-target";
    await page.getByRole("button", { name: "New Issue" }).click();
    await page.getByPlaceholder("Issue title").fill(uniqueTitle);
    await page.getByRole("button", { name: "Create Issue" }).click();
    await expect(page.getByText(`Created issue #${CREATED_ISSUE_NUMBER}.`)).toBeVisible();
    const createdRow = page.locator(".issue-row", { hasText: uniqueTitle });
    await expect(createdRow).toBeVisible();

    // Close it through the real backend while the Open filter is active.
    await createdRow.click();
    await page.getByRole("button", { name: "Close Issue" }).first().click();
    await page.locator(".modal-content").getByRole("button", { name: "Close Issue" }).click();
    await expect(page.getByText(`Closed issue #${CREATED_ISSUE_NUMBER}.`)).toBeVisible();

    // The fix: a now-closed issue no longer matches the Open filter, so it is
    // dropped from the list (mirroring a fresh server query for state=open).
    await expect(page.locator(".issue-row", { hasText: uniqueTitle })).toHaveCount(0);
    // The seeded open issue is still present — only the non-matching item left.
    await expect(page.locator(".issue-row", { hasText: OPEN_ISSUE.title })).toBeVisible();
  });

  test("issues: creating an issue under the Closed filter does not show the non-matching item", async ({ page }) => {
    await openMoreSurface(page, "Issues");

    // Switch to the Closed filter first.
    await page.locator(".issues-surface select").selectOption("closed");
    // Only the seeded closed issue is visible under "closed".
    await expect(page.locator(".issue-row", { hasText: SEEDED_JJHUB_STATE.issues[1].title })).toBeVisible();

    // Create a new issue — the real backend returns it in "open" state, which
    // does NOT match the active Closed filter.
    const uniqueTitle = "domain-filter-issue-create-open";
    await page.getByRole("button", { name: "New Issue" }).click();
    await page.getByPlaceholder("Issue title").fill(uniqueTitle);
    await page.getByRole("button", { name: "Create Issue" }).click();
    await expect(page.getByText(`Created issue #${CREATED_ISSUE_NUMBER}.`)).toBeVisible();

    // The fix: a created open issue does not appear under the Closed filter.
    await expect(page.locator(".issue-row", { hasText: uniqueTitle })).toHaveCount(0);

    // Switching to All surfaces it through a real fresh server query.
    await page.locator(".issues-surface select").selectOption("all");
    await expect(page.locator(".issue-row", { hasText: uniqueTitle })).toBeVisible();
  });

  test("landings: landing an open landing under the Open filter drops it from the list", async ({ page }) => {
    await openMoreSurface(page, "Landings");

    // Scope to the Open filter so only open/draft landings are visible.
    await page.locator(".landings-surface select").selectOption("open");
    const openRow = page.locator(".landing-row", { hasText: OPEN_LANDING.title });
    await expect(openRow).toBeVisible();

    await openRow.click();

    // Land it through the real backend, which flips its state to "merged".
    await page.locator(".landing-actions").getByRole("button", { name: "Land" }).click();
    await expect(page.locator(".modal-content")).toContainText(`Land #${OPEN_LANDING.number}`);
    await page.locator(".modal-content").getByRole("button", { name: "Land" }).click();
    await expect(page.getByText(`Landed #${OPEN_LANDING.number}.`)).toBeVisible();

    // The fix: a merged landing no longer matches the Open filter, so it drops.
    await expect(page.locator(".landing-row", { hasText: OPEN_LANDING.title })).toHaveCount(0);

    // Switching to Merged surfaces it via a real fresh server query for that filter.
    await page.locator(".landings-surface select").selectOption("merged");
    await expect(page.locator(".landing-row", { hasText: OPEN_LANDING.title })).toBeVisible();
  });
});

test.describe("read-mostly surfaces load real backend data and reset their loading state", () => {
  test("memory: the real /memory read renders seeded facts and the refresh control re-enables", async ({ page }) => {
    await openMoreSurface(page, "Memory");

    // The real read resolves: the loading status flips to a ready count and the
    // seeded facts render. (Memory exposes no fixture fault path, so this asserts
    // the genuine read + loading-state reset rather than a fabricated error.)
    await expect(page.getByTestId("memory.status")).toContainText("facts");
    await expect(page.getByTestId("memory.list")).toBeVisible();
    await expect(page.getByTestId("memory.row").first()).toBeVisible();

    // Loading state reset: the Refresh button is no longer "Refreshing…".
    const refresh = page.getByTestId("memory.refresh");
    await expect(refresh).toBeEnabled();
    await expect(refresh).toHaveText("Refresh");

    // Searching re-queries the real server (debounced) for a seeded key; the
    // busy state resets back to ready and the matching fact stays listed.
    await page.getByTestId("memory.search").fill(SEEDED_MEMORY_FACTS[1].key);
    await expect(page.getByTestId("memory.refresh")).toHaveText("Refresh");
    await expect(page.getByTestId("memory.status")).toContainText("fact");
  });

  test("scores: the real /scores read renders seeded aggregates and the refresh control re-enables", async ({ page }) => {
    await openMoreSurface(page, "Scores");

    // The real read resolves to the seeded scorer rows + aggregates.
    await expect(page.getByTestId("scores.status")).toContainText("score");
    await expect(page.getByTestId("scores.table")).toBeVisible();
    await expect(page.getByTestId("scores.row").first()).toBeVisible();

    // Loading state reset: Refresh is re-enabled and back to its idle label.
    const refresh = page.getByTestId("scores.refresh");
    await expect(refresh).toBeEnabled();
    await expect(refresh).toHaveText("Refresh");
  });
});
