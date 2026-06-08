import { expect, test, type Page } from "@playwright/test";
import { AGENTS } from "../../src/agents/agents";
import { SEEDED_CRONS, sortCrons, summarizeCrons } from "../../src/crons/crons";
import { recall } from "../../src/memory/memoryFacts";
import { PROMPT_TEMPLATES } from "../../src/prompts/promptTemplates";
import { SCORE_REPORTS } from "../../src/scores/scoreReport";

/**
 * Feature slash commands. Typing "/agents", "/crons", "/memory …", etc. in the
 * composer routes through runSlash, which posts a card into the chat transcript
 * (the role="log" .conversation region) via chat.postCard. This asserts each
 * card renders with content drawn from its own data module, so the checks track
 * the real catalog instead of pinning hand-copied strings that would drift.
 *
 * No backend: these cards are posted synchronously by runSlash; nothing streams
 * from the worker, so there's no fixture-upstream dependency here.
 */

/** Send a slash command the way a user types it: fill the composer, hit Enter. */
async function runCommand(page: Page, command: string): Promise<void> {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Smithers" });
  await input.fill(command);
  await input.press("Enter");
  // The composer clears once the command is dispatched.
  await expect(input).toHaveValue("");
}

/** The posted card, scoped to the transcript log by its stable data-testid. */
function cardIn(page: Page, testId: string) {
  return page.getByRole("log").getByTestId(testId);
}

test.describe("feature cards in the transcript", () => {
  test("/agents posts the providers card listing every agent", async ({ page }) => {
    await runCommand(page, "/agents");

    const card = cardIn(page, "agents-card");
    await expect(card.locator(".card-title")).toHaveText("Agents & providers");
    // The sub line is computed from AGENTS' availability, so derive it the same way.
    const ready = AGENTS.filter((agent) => agent.available).length;
    await expect(card.locator(".card-sub")).toHaveText(
      `${ready} ready · ${AGENTS.length - ready} not detected`,
    );
    // Every provider in the catalog renders a row by name.
    for (const agent of AGENTS) {
      await expect(card.getByText(agent.name, { exact: true })).toBeVisible();
    }
  });

  test("/crons posts the triggers card with each trigger", async ({ page }) => {
    await runCommand(page, "/crons");

    const card = cardIn(page, "crons-card");
    await expect(card.locator(".card-title")).toHaveText("Triggers");
    const enabled = summarizeCrons(SEEDED_CRONS).enabled;
    await expect(card.locator(".card-sub")).toHaveText(
      `${enabled} enabled trigger${enabled === 1 ? "" : "s"}`,
    );
    // The card previews the first few triggers, sorted enabled-first; assert each shown row.
    for (const cron of sortCrons(SEEDED_CRONS).slice(0, 4)) {
      await expect(card.getByText(cron.name, { exact: true })).toBeVisible();
      await expect(
        card.locator("code.cron-pattern", { hasText: cron.pattern }),
      ).toBeVisible();
    }
  });

  test("/memory rust posts the recall card with the query and ranked facts", async ({
    page,
  }) => {
    await runCommand(page, "/memory rust");

    const card = cardIn(page, "memory-card");
    await expect(card.locator(".card-title")).toHaveText("Memory · recall");
    // The query the user typed is echoed back into the recall chip.
    await expect(card.locator(".recall-query")).toContainText("rust");
    // recall("rust") is deterministic; the card previews the top 3 hits.
    const results = recall("rust", undefined, null, 3);
    await expect(card.locator(".card-sub")).toHaveText(
      `top ${results.length} matches`,
    );
    for (const fact of results) {
      await expect(card.getByText(fact.content, { exact: true })).toBeVisible();
    }
  });

  test("/prompts posts the prompt picker with every template", async ({ page }) => {
    await runCommand(page, "/prompts");

    const card = cardIn(page, "prompts-card");
    await expect(card.locator(".card-title")).toHaveText("Prompts");
    // One file-tab per template; the catalog drives the tab list.
    for (const template of PROMPT_TEMPLATES) {
      await expect(
        card.locator(".file-tab", { hasText: template.name }),
      ).toBeVisible();
    }
    // The first template is active by default and previews its body.
    await expect(card.locator(".prompt-preview")).toContainText("Refactor");
  });

  test("/scores posts the eval scorecard with metric tiles", async ({ page }) => {
    await runCommand(page, "/scores");

    const card = cardIn(page, "scores-card");
    // runSlash pins the report to "review-suite"; title and delta come from it.
    const report = SCORE_REPORTS["review-suite"];
    await expect(card.locator(".card-title")).toHaveText(`Scores · ${report.suite}`);
    await expect(card.locator(".status-pill")).toContainText(report.delta);
    // Each metric tile shows its name and value.
    for (const tile of report.tiles) {
      const cell = card.locator(".score-tile", { hasText: tile.name });
      await expect(cell.locator(".tile-value")).toHaveText(tile.value);
    }
  });

  test("/human posts the human-task gate with its answer options", async ({ page }) => {
    await runCommand(page, "/human");

    const card = cardIn(page, "human-card");
    await expect(card.locator(".card-title")).toHaveText("The run needs your input");
    await expect(card.locator(".gate-summary")).toHaveText(
      "Which environment should I deploy to?",
    );
    // The three answer chips are the actionable surface of the gate.
    for (const option of ["staging", "production", "cancel"]) {
      await expect(card.getByRole("button", { name: option })).toBeVisible();
    }
  });

  test("/signal pr-merged posts the waiting-for-event card, blocked", async ({
    page,
  }) => {
    await runCommand(page, "/signal pr-merged");

    const card = cardIn(page, "signal-card");
    await expect(card.locator(".card-title")).toHaveText("Waiting for event");
    // The event name from the command echoes into the sub line as a code chip.
    await expect(
      card.locator("code.cron-pattern", { hasText: "pr-merged" }),
    ).toBeVisible();
    // It starts blocked, with a Deliver-signal affordance.
    await expect(card.locator(".status-pill")).toContainText("blocked");
    await expect(
      card.getByRole("button", { name: "Deliver signal" }),
    ).toBeVisible();
  });
});
