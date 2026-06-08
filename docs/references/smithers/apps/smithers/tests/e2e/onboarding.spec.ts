import { expect, test } from "@playwright/test";

/**
 * REAL first-run onboarding against the live app. These specs override the
 * suite-wide "already onboarded" storage with empty storage, so the first run
 * appears the way a brand-new visitor sees it. No mocking: the splash, the
 * scripted conversation, and the proposed workflow graph are all client-side and
 * offline by design, so the whole flow runs without the chat backend.
 *
 * Onboarding is now part of the chat: the splash mark flies to the corner logo,
 * then Smithers talks to you in the transcript and hands you inline cards (the
 * goal form, then the live build proposal) instead of a modal.
 */
test.describe("first run", () => {
  // A brand-new visitor: no persisted onboarding flag.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("flies the logo to the corner, then walks the chat to a created workflow", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto("/");

    // Phase 1: the splash with the animated mark and a Get started button. The
    // corner logo is still hidden — the big mark is the only logo for now.
    await expect(page.locator(".ob-intro .ob-mark")).toBeVisible();
    await expect(page.locator(".corner-logo")).not.toHaveClass(/is-shown/);
    await page.getByRole("button", { name: "Get started" }).click();

    // The splash hands off: the overlay clears and the persistent corner logo
    // pops into place.
    await expect(page.locator(".ob-overlay")).toHaveCount(0);
    await expect(page.locator(".corner-logo")).toHaveClass(/is-shown/);

    // Smithers greets you in the chat and posts the goal form inline.
    await expect(page.getByText("Hi, I'm Smithers")).toBeVisible();
    const goalInput = page.getByRole("textbox", {
      name: "What would you like a workflow to do?",
    });
    await expect(goalInput).toBeVisible();

    // Phase 2: state a goal that classifies to the Implement template.
    await goalInput.fill("implement a billing page");
    await page.getByRole("button", { name: /Continue/ }).click();

    // Phase 3: the proposed workflow renders as a live graph inside the build
    // card. The Implement template defaults its approval gate on.
    const graph = page.locator(".ob-graph");
    await expect(graph.locator(".node-title", { hasText: "Implement" })).toBeVisible();
    await expect(graph.locator(".node-title", { hasText: "Review" })).toBeVisible();
    await expect(graph.locator(".node-title", { hasText: "Your approval" })).toBeVisible();

    // Toggling the approval gate off mutates the graph live.
    await page.getByText("Pause for my approval before it acts").click();
    await expect(graph.locator(".node-title", { hasText: "Your approval" })).toHaveCount(0);

    // Create: the card settles into its created state and the composer is primed
    // with the user's own words, one keystroke from their first real run.
    await page.getByRole("button", { name: /Create workflow/ }).click();
    await expect(page.locator(".ob-card--done")).toContainText("Created");
    await expect(page.getByRole("textbox", { name: "Message Smithers" })).toHaveValue(
      /billing page/i,
    );
    // The corner logo stays — it's the app's logo now.
    await expect(page.locator(".corner-logo")).toHaveClass(/is-shown/);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the unsure path recommends the default research-plan-implement workflow", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Get started" }).click();

    // "I'm not sure yet" submits an empty goal, which takes the recommended
    // default — the richest shape, so research/plan/implement all appear.
    await page.getByRole("button", { name: "I'm not sure yet" }).click();

    const graph = page.locator(".ob-graph");
    await expect(graph.locator(".node-title", { hasText: "Research" })).toBeVisible();
    await expect(graph.locator(".node-title", { hasText: "Plan" })).toBeVisible();
    await expect(graph.locator(".node-title", { hasText: "Implement" })).toBeVisible();
  });
});

test.describe("replay", () => {
  test("the /onboarding slash brings the first run back", async ({ page }) => {
    // This describe inherits the suite default (already onboarded), so the app
    // opens straight to the shell with no splash.
    await page.goto("/");
    await expect(page.locator(".ob-overlay")).toHaveCount(0);

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("/onboarding");
    await input.press("Enter");

    // The splash returns.
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  });
});
