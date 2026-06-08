import { expect, test } from "@playwright/test";
import {
  SEEDED_CHAT_BOLD_WORD,
  SEEDED_CHAT_CODE_LINE,
  SEEDED_CHAT_INLINE_CODE,
  SEEDED_CHAT_REPLY_PHRASE,
} from "../fixtures/seededChat";

/**
 * REAL-BACKEND chat. No route mocking: the browser POSTs /api/chat, vite proxies
 * it to the live Worker host (src/worker.ts), which calls the local OpenAI-
 * compatible upstream and streams the seeded reply back as SSE. This exercises
 * the entire gateway path the production app uses, minus a real Cerebras key.
 */
test.describe("chat through the gateway", () => {
  test("streams a markdown reply from the worker → fixture upstream", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("make a plan");
    await input.press("Enter");

    const log = page.getByRole("log");
    // The user's turn is echoed immediately.
    await expect(log).toContainText("make a plan");

    // The assistant turn streams in from the real gateway and renders markdown.
    await expect(log).toContainText(SEEDED_CHAT_REPLY_PHRASE);
    await expect(page.locator("strong", { hasText: SEEDED_CHAT_BOLD_WORD })).toBeVisible();
    await expect(page.locator("code.md-inline-code", { hasText: SEEDED_CHAT_INLINE_CODE })).toBeVisible();
    await expect(page.locator("pre.md-code-block")).toContainText(SEEDED_CHAT_CODE_LINE);

    // The composer clears after sending.
    await expect(input).toHaveValue("");
  });
});
