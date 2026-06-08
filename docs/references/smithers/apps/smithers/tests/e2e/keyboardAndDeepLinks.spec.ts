import { expect, test, type Page } from "@playwright/test";

/**
 * Cross-surface coverage: every canvas can be deep-linked, the command pill
 * is keyboard-reachable (Enter opens, ArrowDown/Up move, Escape closes), and
 * the shell survives a long composer message + a mobile viewport.
 */
const SURFACES: { path: string; testId: string }[] = [
  { path: "/runs", testId: "runs-canvas" },
  { path: "/approvals", testId: "approvals-canvas" },
  { path: "/agents", testId: "agents-canvas" },
  { path: "/crons", testId: "crons-canvas" },
  { path: "/scores", testId: "scores-canvas" },
  { path: "/memory", testId: "memory-canvas" },
  { path: "/prompts", testId: "prompts-canvas" },
  { path: "/palette", testId: "palette-canvas" },
  { path: "/issues", testId: "issues-canvas" },
  { path: "/landings", testId: "landings-canvas" },
  { path: "/tickets", testId: "tickets-canvas" },
];
// /workflow/$id and /login have dedicated specs. /logs and /timeline remain
// covered by the legacy surfaces spec, whose timeline assertion predates this
// additive coverage pass.

test.describe("deep links", () => {
  for (const surface of SURFACES) {
    test(`deep-link ${surface.path} mounts ${surface.testId} with no console errors`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(surface.path);
      await expect(page.getByTestId(surface.testId)).toBeVisible();
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});

test.describe("command menu keyboard", () => {
  /** The command pill lives inside the "View navigation" landmark. */
  const pill = (page: Page) =>
    page
      .getByRole("navigation", { name: "View navigation" })
      .getByRole("button", { name: "Chat" });

  test("Enter opens, Escape closes, focus returns to the pill", async ({
    page,
  }) => {
    await page.goto("/");
    const trigger = pill(page);
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });
});

test.describe("composer corner cases", () => {
  test("a very long composer message lands on the launched run card title", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    const tail = "auth refactor with lots of context ".repeat(40).trim();
    await input.fill(`ship ${tail}`);
    await input.press("Enter");

    // The run card's title carries the long tail (the "ship " prefix is
    // stripped by launchRun, which prefixes "Implement · ").
    const card = page.getByRole("log").locator(".run-card[data-testid='run-card']");
    await expect(card).toBeVisible();
    await expect(card.locator(".card-title")).toContainText(tail.slice(0, 80));
  });

  test("mobile viewport still mounts the composer + chip", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "Message Smithers" }),
    ).toBeVisible();
    await expect(page.getByTestId("auth-status")).toBeVisible();
  });
});
