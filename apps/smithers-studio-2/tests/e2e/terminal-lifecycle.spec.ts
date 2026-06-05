import { test, expect } from "../support/test";
import type { Page } from "@playwright/test";

/**
 * REAL-PTY terminal lifecycle e2e. No WebSocket mocking, no `routeWebSocket`,
 * no fake socket: playwright.config.ts boots the real node-pty server
 * (scripts/pty-server.ts) and vite proxies `/terminal/ws` to it, so these specs
 * drive a genuine shell over a live socket — exactly like terminal.spec.ts and
 * terminal-ui.spec.ts. Markers are minted per test (a unique token + the test's
 * parallel index) so the round-trip and tab-isolation assertions can never be
 * satisfied by another test's output, keeping the file safe under
 * `fullyParallel`.
 */

/** Wait for the active terminal pane to attach to the live PTY and take focus. */
async function attachActiveTerminal(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("nav.Workspace").click();
  await page.waitForSelector(".ghostty-terminal");
  await expect(page.locator('[data-testid="terminal-status"]')).toHaveText(/attached|connected/i, {
    timeout: 10000,
  });
}

test.describe("Terminal lifecycle (real PTY)", () => {
  test("round-trips a unique marker typed into the live shell", async ({ page }, testInfo) => {
    await attachActiveTerminal(page);

    // A marker unique to this test run. `echo` of a quoted, concatenated string
    // means the COMMAND line contains the two halves with a space, but the
    // OUTPUT line prints them joined — so finding the joined token proves the
    // shell actually executed and emitted it, not just that we typed it.
    const left = `LIFECYCLE-${testInfo.parallelIndex}-${Date.now().toString(36)}`;
    const right = "ROUNDTRIP";
    const joined = `${left}${right}`;

    const terminal = page.locator(".ghostty-terminal");
    await terminal.click();
    await page.keyboard.type(`echo "${left}""${right}"`);
    await page.keyboard.press("Enter");

    // The shell's stdout contains the joined token on its own output line.
    await expect(terminal).toContainText(joined, { timeout: 5000 });
  });

  test("isolates two tabs: a marker echoed in tab A is absent from tab B", async ({ page }, testInfo) => {
    await attachActiveTerminal(page);

    // Markers are alpha-only `LEFT`+`RIGHT` halves echoed as a quoted,
    // concatenated string: the COMMAND line shows the two halves with quotes
    // between them, but the shell's OUTPUT line prints them JOINED. Asserting the
    // joined token therefore proves the live shell EXECUTED the echo (a typed
    // command line alone, with its embedded quotes, can never contain the joined
    // form), and the per-test parallel index keeps the tokens unique.
    const leftA = `TABA${testInfo.parallelIndex}aaa`;
    const leftB = `TABB${testInfo.parallelIndex}bbb`;
    const joinedA = `${leftA}MARK`;
    const joinedB = `${leftB}MARK`;

    // Open the second terminal tab FIRST, before typing any marker. Adding a tab
    // reflows the layout, which makes each live shell repaint its prompt (a real
    // SIGWINCH redraw that clears the visible grid) — so a marker echoed before
    // the tab op would not survive on screen. Typing each marker AFTER all tab
    // operations is the same robust ordering terminal.spec.ts uses, and it is
    // what proves SESSION isolation (each PTY keeps its own output) rather than
    // scrollback-repaint persistence.
    const activeTerminal = page.locator('[data-testid="terminal-tab"].active .ghostty-terminal');
    await page.keyboard.press("Meta+t");
    await expect(page.locator('[data-testid="terminal-tab"]')).toHaveCount(2);

    // The newly active pane is tab B (its own live PTY session). Echo marker B
    // into it and confirm the shell's OUTPUT line carries the joined token.
    await activeTerminal.click();
    await expect(activeTerminal).toHaveClass(/focused/);
    await page.keyboard.type(`echo "${leftB}""MARK"`);
    await page.keyboard.press("Enter");
    await expect(activeTerminal).toContainText(joinedB, { timeout: 5000 });

    // Switch to tab A via the sidebar tablist and echo marker A into ITS session.
    const sidebarTabs = page.locator('.sidebar-terminals [role="tab"]');
    await sidebarTabs.first().click();
    await expect(page.locator('[data-testid="terminal-tab"]').first()).toHaveClass(/active/);
    await activeTerminal.click();
    await expect(activeTerminal).toHaveClass(/focused/);
    await page.keyboard.type(`echo "${leftA}""MARK"`);
    await page.keyboard.press("Enter");
    await expect(activeTerminal).toContainText(joinedA, { timeout: 5000 });

    // Tab A's pane shows its OWN output and never tab B's: the two PTY sessions
    // are isolated, so tab B's joined marker can never appear in tab A's grid.
    await expect(activeTerminal).not.toContainText(joinedB);
  });

  test("exiting the shell surfaces the real process-exit status and banner", async ({ page }) => {
    await attachActiveTerminal(page);

    const terminal = page.locator(".ghostty-terminal");
    await terminal.click();

    // Exit the live shell with a distinctive non-zero code so the banner text is
    // unambiguous (the PTY server reports the real exit code back over the WS).
    await page.keyboard.type("exit 17");
    await page.keyboard.press("Enter");

    // The real exit banner reflects the actual exit code from the PTY.
    await expect(terminal).toContainText(/process exited with code 17/, { timeout: 5000 });

    // And the status line flips to the terminal/exited state (no longer attached).
    await expect(page.locator('[data-testid="terminal-status"]')).toHaveText(/exited|ended/i, {
      timeout: 5000,
    });
  });
});
