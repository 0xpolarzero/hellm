import { expect, test } from "@playwright/test";
import { SEEDED_CHAT_REPLY_PHRASE } from "../fixtures/seededChat";

/**
 * REAL-BACKEND "Ask Me" grill interview. Switching the command pill to "Ask Me"
 * docks the composer beside the grill-me workflow graph and shows the topic
 * hint. Sending a topic runs the same gateway path as plain chat (worker →
 * fixture upstream), but with the grill system prompt attached; the upstream
 * still streams SEEDED_CHAT_REPLY for any prompt, so we assert that lands in the
 * conversation log. No route mocking — this exercises the live stack.
 */
test.describe("Ask Me grill interview", () => {
  test("renders the grill hint + workflow graph, then streams a reply", async ({ page }) => {
    await page.goto("/");

    // Switch the active view from Chat to Ask Me via the command menu. The pill
    // shows the current label ("Chat"); opening it exposes the radio options.
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.getByRole("menuitemradio", { name: /Ask Me/ }).click();

    // Ask Me docks the composer immediately, so the shell is in its chat layout.
    const shell = page.locator("main.app-shell");
    await expect(shell).toHaveAttribute("data-mode", "chat");

    // Before any topic is sent, the empty-state hint invites a topic and the
    // grill-me graph renders its nodes (e.g. the looping "Grill Task").
    await expect(page.locator(".askme-hint")).toContainText("type a topic and hit Enter");
    await expect(page.locator(".askme-graph .node-title", { hasText: "Grill Task" })).toBeVisible();

    // Send a topic. The grill interview reuses the real chat textbox.
    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("rewriting our auth flow");
    await input.press("Enter");

    const log = page.getByRole("log");
    // The user's topic is echoed immediately.
    await expect(log).toContainText("rewriting our auth flow");
    // The assistant turn streams in from the real gateway (fixture upstream).
    await expect(log).toContainText(SEEDED_CHAT_REPLY_PHRASE);

    // The composer clears after sending, and the empty-state hint is gone now
    // that the conversation has started.
    await expect(input).toHaveValue("");
    await expect(page.locator(".askme-hint")).toHaveCount(0);
  });
});
