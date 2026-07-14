import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
import { ensureBuilt, withSvvyApp, type SvvyApp } from "./harness";
import {
  assistantTextMessage,
  seedSessions,
  toolCall,
  toolResultMessage,
  userMessage,
  type SeedSessionInput,
} from "./support";

setDefaultTimeout(90_000);

const BASE_TIMESTAMP = Date.parse("2026-04-10T13:00:00.000Z");
const SESSION_TITLE = "Transcript edge cases";
const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

beforeAll(async () => {
  await ensureBuilt();
});

function edgeCaseSession(): SeedSessionInput {
  const failingToolCall = toolCall("artifacts", {
    command: "create",
    filename: "broken.txt",
    content: "broken artifact",
  });
  const redactedThinkingAssistant: AssistantMessage = {
    role: "assistant",
    timestamp: BASE_TIMESTAMP + 1,
    api: "openai-responses",
    provider: "zai",
    model: "glm-5-turbo",
    usage: ZERO_USAGE,
    stopReason: "toolUse",
    content: [
      { type: "thinking", thinking: "", redacted: true },
      { type: "text", text: "This assistant row should show a redacted reasoning block." },
      failingToolCall,
    ],
  };

  return {
    title: SESSION_TITLE,
    messages: [
      userMessage("Exercise transcript edge cases.", BASE_TIMESTAMP),
      redactedThinkingAssistant,
      toolResultMessage(failingToolCall.id, "artifacts", "Unable to create broken.txt", {
        timestamp: BASE_TIMESTAMP + 2,
        isError: true,
      }),
      assistantTextMessage("Visible reasoning still renders.", {
        timestamp: BASE_TIMESTAMP + 3,
        thinking: "Visible reasoning for contrast.",
      }),
    ],
  };
}

async function launchEdgeCaseApp<T>(fn: (app: SvvyApp) => Promise<T>): Promise<T> {
  return await withSvvyApp(
    {
      env: {
        ZAI_API_KEY: "stub-key",
      },
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        await seedSessions(homeDir, [edgeCaseSession()], workspaceDir);
      },
    },
    fn,
  );
}

async function openSession(page: SvvyApp["page"], title: string): Promise<void> {
  const sessionButton = page.locator(`button.session-main[aria-label="${title}"]`);
  await sessionButton.waitFor({ state: "visible" });
  await sessionButton.click();
}

test("renders seeded transcript timestamps, tool error states, and reasoning fallbacks", async () => {
  await launchEdgeCaseApp(async ({ page }) => {
    await openSession(page, SESSION_TITLE);
    const activeSurfaceTitle = page.getByTestId("active-surface-title").filter({
      hasText: SESSION_TITLE,
    });
    await activeSurfaceTitle.waitFor({ state: "visible" });
    expect((await activeSurfaceTitle.textContent())?.trim()).toBe(SESSION_TITLE);
    await page
      .getByText(/^This assistant row should show a redacted reasoning block\.$/)
      .waitFor({ state: "visible" });

    const times = page.locator("time");
    expect(await times.count()).toBe(3);
    expect((await times.nth(0).textContent())?.trim()).not.toBe("");
    expect((await times.nth(1).textContent())?.trim()).not.toBe("");
    expect((await times.nth(2).textContent())?.trim()).not.toBe("");

    const firstAssistant = page.locator(".assistant-row").nth(0);
    expect(await firstAssistant.locator(".thinking-markdown").textContent()).toBe("[redacted]");
    const failedToolCard = firstAssistant.locator('[data-testid^="tool-card-"]').first();
    expect(await failedToolCard.count()).toBe(1);
    expect(await failedToolCard.locator('[data-testid="status-badge-failed"]').textContent()).toBe(
      "Failed",
    );

    expect(await page.locator(".tool-row").count()).toBe(0);
    const detailsToggle = failedToolCard.getByRole("button", {
      name: /^Hide tool details for /,
    });
    expect((await detailsToggle.resolve()).first?.disabled).toBe(false);
    const detailsRegion = failedToolCard.getByRole("region", {
      name: /^Tool details for /,
    });
    await detailsRegion.waitFor({ state: "visible" });
    await detailsRegion.getByText(/^Unable to create broken\.txt$/).waitFor({ state: "visible" });
    expect((await detailsRegion.textContent()) ?? "").toContain("Unable to create broken.txt");

    const reasoningBlocks = page.locator(".assistant-row .thinking-block");
    expect(await reasoningBlocks.count()).toBe(2);
    expect(await reasoningBlocks.nth(0).locator(".thinking-markdown").textContent()).toBe(
      "[redacted]",
    );
    expect(await reasoningBlocks.nth(1).locator(".thinking-markdown").textContent()).toBe(
      "Visible reasoning for contrast.",
    );
  });
});
