import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";

/**
 * REAL-BACKEND command palette e2e. No `page.route`, no `mockGateway`, no fake
 * data. The palette is pure client UI over the real registry the booted shell
 * builds; every command it runs (navigate, open terminal, toggle developer
 * mode) drives the real store + real surfaces against the live stack
 * (`playwright.config.ts` boots gateway + workspace-API + PTY + vite).
 *
 * The headline assertion is the round-1 regression fix: filtering is now
 * SYNCHRONOUS (the 80ms debounce was removed), so a fast type-then-immediate
 * Enter runs the command the user just typed, NOT the stale first row
 * ("Go to Home"). Several specs here type then Enter without any settle wait to
 * pin exactly that.
 */

async function openPalette(page: Page) {
  await page.goto("/");
  // Cmd-K (Meta+k) opens the palette via the global hotkey; Ctrl+k on non-mac.
  await page.keyboard.press("Meta+k");
  await page.keyboard.press("Control+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  // Focus the input so type/Enter land on it (autofocus can race the keystrokes).
  await page.locator(".palette-input").click();
  return palette;
}

test.describe("Command palette (real shell)", () => {
  test("Cmd-K, type 'Runs', immediate Enter navigates to Runs (no stale first row)", async ({ page }) => {
    await openPalette(page);

    // Type the command name then Enter with NO settle wait. With the old debounce
    // this would have run the stale first row ("Go to Home"); the synchronous
    // filter guarantees Enter runs the typed "Go to Runs" command.
    await page.keyboard.type("Runs");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("view.runs")).toBeVisible();
    // The palette closed itself once the command ran.
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
  });

  test("fast type-then-Enter for 'New Terminal' creates a terminal (no debounce race)", async ({ page }) => {
    await page.goto("/");
    // Start on Workspace with its initial terminal so the new one is additive and
    // observable as a second tab.
    await page.getByTestId("nav.Workspace").click();
    await expect(page.locator('[data-testid="terminal-tab"]')).toHaveCount(1);

    await page.keyboard.press("Meta+k");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.locator(".palette-input").click();

    await page.keyboard.type("New Terminal");
    await page.keyboard.press("Enter");

    // The command opened a new terminal (activeView stays Workspace) — a second
    // real PTY-backed tab appears, proving the typed command ran, not "Go to Home".
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(page.locator('[data-testid="terminal-tab"]')).toHaveCount(2);
  });

  test("a no-match query shows the empty state with the 'Ask AI:' affordance", async ({ page }) => {
    await openPalette(page);

    await page.keyboard.type("zzz-no-such-command");

    await expect(page.locator(".palette-empty")).toBeVisible();
    await expect(page.locator(".palette-empty")).toContainText("No matching results");
    // The residual search text drives the Ask-AI affordance.
    await expect(page.locator(".palette-empty-ask")).toContainText("Ask AI: zzz-no-such-command");
    // No rows render in the empty state.
    await expect(page.locator(".palette-row")).toHaveCount(0);
  });

  test("the '>' prefix scopes results to Commands only", async ({ page }) => {
    await openPalette(page);

    // ">" enters command mode; the prefix pill shows the mode title and only the
    // contextual Commands section is candidate (nav "Go to" rows are excluded).
    await page.keyboard.type(">");
    await expect(page.locator(".palette-prefix-pill")).toContainText("Commands");

    // Every visible row is a Command — the two contextual commands match, and
    // there are no "Go to" nav rows in this scope.
    await expect(page.locator(".palette-row-title", { hasText: "New Terminal" })).toBeVisible();
    await expect(page.locator(".palette-row-title", { hasText: "Toggle Developer Mode" })).toBeVisible();
    await expect(page.locator(".palette-row-title", { hasText: "Go to Home" })).toHaveCount(0);
    await expect(page.locator(".palette-row-subtitle", { hasText: "Go to Runs" })).toHaveCount(0);
  });

  for (const prefix of ["/", "@", "?"] as const) {
    test(`the '${prefix}' prefix intentionally matches nothing (empty state)`, async ({ page }) => {
      await openPalette(page);

      await page.keyboard.type(prefix);
      // These prefixes have no backing data source in the palette item set, so
      // they scope to zero candidates and show the empty state by design.
      await expect(page.locator(".palette-empty")).toBeVisible();
      await expect(page.locator(".palette-row")).toHaveCount(0);
    });
  }

  test("toggleDeveloperMode via palette reveals then hides the Developer nav section", async ({ page }) => {
    await page.goto("/");
    // Developer mode is off by default — no Developer surfaces in the rail.
    await expect(page.getByTestId("nav.DevTools")).toHaveCount(0);

    // Toggle developer mode ON via the palette command.
    await page.keyboard.press("Meta+k");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.locator(".palette-input").click();
    await page.keyboard.type("Toggle Developer Mode");
    await page.keyboard.press("Enter");

    // The Developer section + its surfaces now appear in the registry-driven rail.
    await expect(page.getByTestId("nav.DevTools")).toBeVisible();
    await expect(page.getByTestId("nav.SQL Browser")).toBeVisible();
    await expect(page.getByTestId("nav.Logs")).toBeVisible();

    // Toggle it back OFF via the palette — the Developer surfaces disappear again.
    await page.keyboard.press("Meta+k");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.locator(".palette-input").click();
    await page.keyboard.type("Toggle Developer Mode");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("nav.DevTools")).toHaveCount(0);
    await expect(page.getByTestId("nav.SQL Browser")).toHaveCount(0);
    await expect(page.getByTestId("nav.Logs")).toHaveCount(0);
  });

  test("toggling developer mode off while on a developer surface strands gracefully back to Home", async ({ page }) => {
    await page.goto("/");

    // Turn developer mode ON, then navigate INTO a developer surface (DevTools).
    await page.keyboard.press("Meta+k");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.locator(".palette-input").click();
    await page.keyboard.type("Toggle Developer Mode");
    await page.keyboard.press("Enter");

    await page.getByTestId("nav.DevTools").click();
    await expect(page.getByTestId("view.devtools")).toBeVisible();

    // Now toggle developer mode OFF while standing on the DevTools surface. The
    // surface unregisters; rather than strand the user on a dead route, the shell
    // falls back to Home.
    await page.keyboard.press("Meta+k");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.locator(".palette-input").click();
    await page.keyboard.type("Toggle Developer Mode");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("view.devtools")).toHaveCount(0);
    await expect(page.getByTestId("view.welcome")).toBeVisible();
    await expect(page.getByTestId("nav.DevTools")).toHaveCount(0);
  });
});
