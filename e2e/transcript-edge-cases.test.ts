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
      { type: "thinking", thinking: "" },
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

async function waitForExactText(
  locator: {
    textContent(): Promise<string | null>;
  },
  expected: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = (await locator.textContent())?.trim() ?? "";
    if (lastText === expected) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for text "${expected}". Last text was "${lastText}".`);
}

test("renders seeded transcript timestamps, tool error states, and reasoning fallbacks", async () => {
  await launchEdgeCaseApp(async ({ page }) => {
    await waitForExactText(page.locator(".workspace-main-title"), SESSION_TITLE);

    const times = page.locator("time");
    expect(await times.count()).toBe(3);
    expect((await times.nth(0).textContent())?.trim()).not.toBe("");
    expect((await times.nth(1).textContent())?.trim()).not.toBe("");
    expect((await times.nth(2).textContent())?.trim()).not.toBe("");

    const firstAssistant = page.locator(".assistant-row").nth(0);
    expect(await firstAssistant.locator(".thinking-block pre").textContent()).toBe("[redacted]");
    expect(await firstAssistant.locator(".tool-card.error").count()).toBe(1);
    expect(await firstAssistant.locator(".tool-card.error .tool-status").textContent()).toBe(
      "error",
    );

    const toolResult = page.locator(".tool-result.error");
    expect(await toolResult.count()).toBe(1);
    expect(await toolResult.locator(".tool-status").textContent()).toBe("Error");
    expect(await toolResult.locator("summary").textContent()).toBe("Error output");
    expect(await toolResult.locator("pre").textContent()).toContain("Unable to create broken.txt");

    const reasoningBlocks = page.locator(".assistant-row .thinking-block");
    expect(await reasoningBlocks.count()).toBe(2);
    expect(await reasoningBlocks.nth(0).locator("pre").textContent()).toBe("[redacted]");
    expect(await reasoningBlocks.nth(1).locator("pre").textContent()).toBe(
      "Visible reasoning for contrast.",
    );
  });
});
