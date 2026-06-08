import { expect, test, type Page } from "@playwright/test";
import { SEEDED_ISSUES, summarizeIssues } from "../../src/issues/issues";
import { SEEDED_LANDINGS, summarizeLandings } from "../../src/landings/landings";
import { SEEDED_TICKETS } from "../../src/tickets/tickets";

/**
 * The review surfaces: Issues, Tickets, and Landings, ported from the Swift gui.
 * Each is a feature slash command that posts a card into the chat transcript
 * (the role="log" region) and a card-link that opens the matching canvas under
 * its own route (/issues, /tickets, /landings). The canvases are list + detail
 * panes whose mutations (close/save/review) run through the feature's zustand
 * store and replay as a chat line, the same shape vcs uses.
 *
 * No route mocking: the slash is typed into the real composer and dispatched
 * through the live router; the cards and canvases read their seeded data
 * modules, so assertions derive from those seeds instead of pinned strings.
 */

/** Type a slash command the way a user does: fill the composer, hit Enter. */
async function runCommand(page: Page, command: string): Promise<void> {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Smithers" });
  await input.fill(command);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

/** The posted card, scoped to the transcript log by its stable data-testid. */
function cardIn(page: Page, testId: string) {
  return page.getByRole("log").getByTestId(testId);
}

test.describe("issues surface", () => {
  test("/issues posts the issues card and the link opens the canvas", async ({ page }) => {
    await runCommand(page, "/issues");

    const card = cardIn(page, "issues-card");
    await expect(card.locator(".card-title")).toHaveText("Issues");
    const summary = summarizeIssues(SEEDED_ISSUES);
    await expect(card.locator(".card-sub")).toHaveText(
      `${summary.open} open · ${summary.closed} closed`,
    );

    // The card lists the first four, open issues first.
    const ordered = [
      ...SEEDED_ISSUES.filter((issue) => issue.state === "open"),
      ...SEEDED_ISSUES.filter((issue) => issue.state === "closed"),
    ].slice(0, 4);
    for (const issue of ordered) {
      await expect(card.getByText(issue.title, { exact: true })).toBeVisible();
    }

    await card.getByRole("button", { name: /Open issues/ }).click();
    await expect(page).toHaveURL(/\/issues$/);
    await expect(page.getByTestId("issues-canvas")).toBeVisible();
  });

  test("closing an issue from the canvas mutates state and posts a chat line", async ({
    page,
  }) => {
    await page.goto("/issues");
    const canvas = page.getByTestId("issues-canvas");
    await expect(canvas).toBeVisible();

    const target = SEEDED_ISSUES.find((issue) => issue.state === "open")!;
    await canvas
      .getByTestId("issues-row")
      .filter({ hasText: target.title })
      .first()
      .click();

    // Detail opens on the picked issue, shown OPEN.
    await expect(canvas.locator(".rev-detail-title")).toHaveText(target.title);
    await expect(canvas.locator(".state-badge")).toHaveText("OPEN");

    await canvas.getByRole("button", { name: "Close issue" }).click();

    // The badge flips to CLOSED, a Reopen affordance appears, and the store
    // posts the close as a chat line in the rail transcript.
    await expect(canvas.locator(".state-badge")).toHaveText("CLOSED");
    await expect(canvas.getByRole("button", { name: "Reopen issue" })).toBeVisible();
    await expect(page.getByRole("log")).toContainText(
      `Closed issue #${target.number}: ${target.title}`,
    );
  });
});

test.describe("tickets surface", () => {
  test("/tickets posts the tickets card and the link opens the canvas", async ({ page }) => {
    await runCommand(page, "/tickets");

    const card = cardIn(page, "tickets-card");
    await expect(card.locator(".card-title")).toHaveText("Tickets");
    await expect(card.locator(".card-sub")).toHaveText(
      `${SEEDED_TICKETS.length} ticket${SEEDED_TICKETS.length === 1 ? "" : "s"}`,
    );
    for (const ticket of SEEDED_TICKETS.slice(0, 4)) {
      await expect(card.getByText(ticket.id, { exact: true })).toBeVisible();
    }

    await card.getByRole("button", { name: /Open tickets/ }).click();
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByTestId("tickets-canvas")).toBeVisible();
  });

  test("editing a ticket enables Save and posts a chat line", async ({ page }) => {
    await page.goto("/tickets");
    const canvas = page.getByTestId("tickets-canvas");

    // The first ticket is selected by default, so the editor is populated and
    // Save is disabled until the buffer diverges from the saved content.
    const editor = canvas.locator(".rev-editor");
    await expect(editor).toBeVisible();
    const save = canvas.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();

    await editor.fill("# Edited\n\n## Summary\nA fresh body for this ticket.");
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.getByRole("log")).toContainText("Saved ticket");
    // Once saved, the buffer matches again and Save disables.
    await expect(save).toBeDisabled();
  });
});

test.describe("landings surface", () => {
  test("/landings posts the landings card and the link opens the canvas", async ({ page }) => {
    await runCommand(page, "/landings");

    const card = cardIn(page, "landings-card");
    await expect(card.locator(".card-title")).toHaveText("Landings");
    const summary = summarizeLandings(SEEDED_LANDINGS);
    await expect(card.locator(".card-sub")).toHaveText(
      `${summary.open} open · ${summary.merged} merged`,
    );
    for (const landing of SEEDED_LANDINGS.slice(0, 4)) {
      await expect(card.getByText(landing.title, { exact: true })).toBeVisible();
    }

    await card.getByRole("button", { name: /Open landings/ }).click();
    await expect(page).toHaveURL(/\/landings$/);
    await expect(page.getByTestId("landings-canvas")).toBeVisible();
  });

  test("approving a landing updates review status, and the tabs show diff + checks", async ({
    page,
  }) => {
    await page.goto("/landings");
    const canvas = page.getByTestId("landings-canvas");

    const target = SEEDED_LANDINGS.find((landing) => landing.state === "open")!;
    await canvas
      .getByTestId("landings-row")
      .filter({ hasText: target.title })
      .first()
      .click();

    // Scope to the action bar: a row's review-status text ("approved") would
    // otherwise substring-match the "Approve" button name.
    const actions = canvas.locator(".rev-detail-actions");
    await actions.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("log")).toContainText(`Approved #${target.number}`);
    // The Info tab's Review row reflects the approval.
    await expect(canvas.locator(".kv", { hasText: "Review" })).toContainText("approved");

    // The Diff tab renders the seeded unified diff as signed lines.
    const tabs = canvas.locator(".file-tabs");
    await tabs.getByRole("button", { name: "Diff" }).click();
    await expect(canvas.locator(".diff-line").first()).toBeVisible();
    await expect(canvas.locator(".diff-line.add").first()).toBeVisible();

    // The Checks tab renders the seeded check output.
    await tabs.getByRole("button", { name: "Checks" }).click();
    await expect(canvas.locator(".node-stream")).toContainText("typecheck");
  });
});
