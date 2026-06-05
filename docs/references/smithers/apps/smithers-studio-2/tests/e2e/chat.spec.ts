import { expect, test } from "../support/test";
import { SEEDED_CHAT_REPLY, SEEDED_CHAT_SESSION } from "../fixtures/seededData";

/**
 * REAL-BACKEND Workspace chat. No `page.route`, no `mockGateway`. The chat half
 * drives the live workspace-API server over the real `/__smithers_studio/api/chat/*`
 * HTTP seam (vite proxies `/__smithers_studio` to the workspaceApiServer fixture),
 * which serves a deterministic seeded session and replays a fixed assistant turn
 * as ndjson — the same "seed the events, serve them from the real backend"
 * contract as the rest of the suite, with no live LLM.
 *
 * The terminal half runs against the real PTY server (vite proxies /terminal/ws),
 * so the terminal testids are present for real — they are asserted, never weakened.
 */

const SEED_SYSTEM_BLOCK = SEEDED_CHAT_SESSION.blocks[0];

async function openChat(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("nav.Workspace").click();
  await page.getByTestId("ws-segment-chat").click();
}

test.describe("Workspace agent chat (real backend)", () => {
  test("swaps to chat and renders the seeded session with model/mode", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav.Workspace").click();

    // Terminal is the default segment; its testids are present (real PTY server).
    await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
    await expect(page.getByTestId("close-terminal")).toBeVisible();

    await page.getByTestId("ws-segment-chat").click();

    await expect(page.getByTestId("agent-chat")).toBeVisible();
    await expect(page.getByTestId("chat-model")).toContainText(SEEDED_CHAT_SESSION.model);
    await expect(page.getByTestId("chat-mode")).toContainText(SEEDED_CHAT_SESSION.mode);
    await expect(page.getByTestId("chat-block")).toHaveCount(1);
    await expect(page.getByTestId("chat-list")).toContainText(SEED_SYSTEM_BLOCK.content);
  });

  test("sends a message and streams the seeded assistant reply with markdown", async ({ page }) => {
    await openChat(page);
    await expect(page.getByTestId("chat-model")).toContainText(SEEDED_CHAT_SESSION.model);

    const input = page.getByTestId("chat-input");
    await input.fill("Write a plan");
    await page.getByTestId("chat-send").click();

    // User block appears immediately.
    await expect(page.getByTestId("chat-block").filter({ hasText: "Write a plan" })).toBeVisible();

    // The assistant block streamed from the real backend lands with rendered
    // markdown (code block + bold + inline code) — these are the seeded values.
    const assistant = page.locator('[data-testid="chat-block"][data-role="assistant"]');
    await expect(assistant).toContainText(SEEDED_CHAT_REPLY.intro);
    await expect(assistant.locator(".ws-md-code")).toContainText(SEEDED_CHAT_REPLY.codeLine);
    await expect(assistant.locator("strong")).toContainText(SEEDED_CHAT_REPLY.boldWord);
    await expect(assistant.locator(".ws-md-inline-code")).toContainText(SEEDED_CHAT_REPLY.inlineCodeWord);

    // Composer clears and the send button leaves its "Sending…" state once the
    // real stream completes; re-typing re-enables it.
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("chat-send")).toHaveText("Send");
    await input.fill("ping");
    await expect(page.getByTestId("chat-send")).toBeEnabled();
  });

  test("Enter sends, Shift+Enter inserts a newline", async ({ page }) => {
    await openChat(page);
    await expect(page.getByTestId("chat-model")).toContainText(SEEDED_CHAT_SESSION.model);

    const input = page.getByTestId("chat-input");
    await input.click();
    await input.pressSequentially("line one");
    await input.press("Shift+Enter");
    await input.pressSequentially("line two");
    await expect(input).toHaveValue("line one\nline two");

    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("chat-block").filter({ hasText: "line one" })).toBeVisible();
  });

  test("surfaces the error state when the real backend reports the runtime offline", async ({ page, request }) => {
    // Arm a single real session fault on the live workspace-API server (a real
    // HTTP POST to the same backend the browser uses — NOT a route mock). The
    // next session load returns a genuine 503 and the hook flips to its error
    // state.
    const armed = await request.post("/__smithers_studio/api/chat/session-fault");
    expect(armed.ok()).toBeTruthy();

    await openChat(page);

    await expect(page.getByTestId("chat-error")).toContainText("agent runtime offline");
    await expect(page.getByTestId("chat-input")).toBeDisabled();
  });

  test("switching back to terminal keeps terminal testids intact", async ({ page }) => {
    await openChat(page);
    await expect(page.getByTestId("agent-chat")).toBeVisible();

    await page.getByTestId("ws-segment-terminal").click();
    // AgentChat stays MOUNTED across segment switches (hidden + inert) so the
    // loaded session/transcript and any in-flight stream survive a round trip —
    // it is hidden here, not removed from the DOM.
    await expect(page.getByTestId("agent-chat")).toBeHidden();
    await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
    await expect(page.locator(".ghostty-terminal")).toBeVisible();
  });
});
