import { expect, test, type Page } from "@playwright/test";

/**
 * Launching a run from the composer. Two entrypoints land on the same place: the
 * natural-language "ship <thing>" phrase and the "/run <thing>" feature slash
 * (both handled in src/app/ComposerBar.tsx → launchRun, src/app/runSlash.ts).
 * Each posts a live RunCard (src/runs/RunCard.tsx) into the chat transcript.
 *
 * The card is driven by the local run engine (src/runs/runsStore.ts): a launch
 * opens at frame 2 ("running") and a 2.2s heartbeat advances it toward the deploy
 * gate at frame 4 ("waiting"). Both frames are live states that keep the card's
 * ticking elapsed clock mounted, so assertions match /running|waiting/ rather
 * than pinning a frame the heartbeat may have already advanced past. The elapsed
 * seconds tick, so they are never asserted.
 *
 * No mocking: this is the app's own in-process engine, not a network path. Card
 * queries are scoped to the transcript (role="log") so the companion launch toast
 * in the corner stack never collides.
 */

/** The conversation transcript — role="log" is the chat live region. */
const transcript = (page: Page) => page.getByRole("log");

/** The launched run card inside the transcript. */
const runCard = (page: Page) =>
  transcript(page).locator(".run-card[data-testid='run-card']");

async function launchFrom(page: Page, line: string) {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Smithers" });
  await input.fill(line);
  await input.press("Enter");
}

test.describe("launching a run", () => {
  test('natural-language "ship …" posts a live run card', async ({ page }) => {
    await launchFrom(page, "ship the auth refactor");

    const card = runCard(page);
    await expect(card).toBeVisible();

    // "ship the auth refactor" → title "Implement · the auth refactor".
    await expect(card.locator(".card-title")).toHaveText(
      "Implement · the auth refactor",
    );

    // A live status pill: launches open running and advance to the waiting gate;
    // both are live states. The ticking elapsed clock is mounted only while live.
    await expect(card.locator(".status-pill")).toHaveText(/running|waiting/);
    await expect(card.locator(".card-elapsed")).toBeVisible();
  });

  test('"/run …" feature slash posts the same live run card', async ({ page }) => {
    await launchFrom(page, "/run the auth refactor");

    const card = runCard(page);
    await expect(card).toBeVisible();

    // "/run the auth refactor" passes "the auth refactor" as the title arg, so it
    // reads the same as the natural-language path.
    await expect(card.locator(".card-title")).toHaveText(
      "Implement · the auth refactor",
    );

    await expect(card.locator(".status-pill")).toHaveText(/running|waiting/);
    await expect(card.locator(".card-elapsed")).toBeVisible();
  });
});
