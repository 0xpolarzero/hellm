import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import {
  assistantTextMessage,
  seedSessions,
  userMessage,
  writeAgentModelsConfig,
  type SeedSessionInput,
} from "./support";

setDefaultTimeout(90_000);

const TIMELINE = Date.parse("2026-04-27T10:00:00.000Z");

type ChatCompletionRequest = {
  model: string;
  messages: Array<Record<string, unknown>>;
};

type PaletteChatStub = {
  baseUrl: string;
  requests: ChatCompletionRequest[];
  stop(): void;
};

beforeAll(async () => {
  await ensureBuilt();
});

function startPaletteChatStub(): PaletteChatStub {
  const requests: ChatCompletionRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
        return new Response("Not found", { status: 404 });
      }

      const payload = (await request.json()) as ChatCompletionRequest;
      requests.push(payload);
      const latestUserText = getLatestUserText(payload.messages);

      return createTextResponse({
        responseId: `chatcmpl-command-palette-${requests.length}`,
        model: payload.model,
        text: `Palette handled: ${latestUserText}`,
      });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/api/coding/paas/v4`,
    requests,
    stop() {
      server.stop(true);
    },
  };
}

function createTextResponse(input: { responseId: string; model: string; text: string }): Response {
  const events = [
    {
      id: input.responseId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: input.model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: input.text,
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: input.responseId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: input.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
        },
      ],
    },
  ];

  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    headers: {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}

function getLatestUserText(messages: Array<Record<string, unknown>>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    const content = message.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            return String(part.text);
          }
          return "";
        })
        .join("");
    }
  }

  return "";
}

function seededSessions(): SeedSessionInput[] {
  return [
    {
      key: "alpha",
      title: "Alpha Palette",
      messages: [
        userMessage("Alpha prompt", TIMELINE + 100),
        assistantTextMessage("Alpha response", { timestamp: TIMELINE + 101 }),
      ],
    },
    {
      key: "beta",
      title: "Beta Palette",
      messages: [
        userMessage("Beta prompt", TIMELINE + 200),
        assistantTextMessage("Beta response", { timestamp: TIMELINE + 201 }),
      ],
    },
  ];
}

async function openActionsPalette(page: SvvyApp["page"]): Promise<void> {
  await page.locator(".workspace-footer .statusbar-icon").nth(0).click({ force: true });
  await page.getByTestId("command-palette").waitFor({ state: "visible" });
}

async function openQuickOpen(page: SvvyApp["page"]): Promise<void> {
  await page.locator(".workspace-footer .statusbar-icon").nth(1).click({ force: true });
  await page.getByTestId("quick-open").waitFor({ state: "visible" });
}

async function waitForSessionRows(
  page: SvvyApp["page"],
  expectedCount: number,
  timeoutMs = 15_000,
): Promise<void> {
  const rows = page.locator(".session-item");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if ((await rows.count()) === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for ${expectedCount} session rows.`);
}

async function waitForMainTitle(page: SvvyApp["page"], expected: string): Promise<void> {
  const title = page.locator(".workspace-main-title");
  const deadline = Date.now() + 15_000;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = (await title.textContent())?.trim() ?? "";
    if (lastText === expected) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for main title "${expected}". Last text was "${lastText}".`);
}

async function launchWithPaletteSessions(fn: (app: SvvyApp) => Promise<void>): Promise<void> {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        await seedSessions(homeDir, seededSessions(), workspaceDir);
      },
    },
    fn,
  );
}

test("Cmd+Shift+P opens all-actions and routes session commands through workspace navigation", async () => {
  await launchWithPaletteSessions(async ({ page }) => {
    await waitForSessionRows(page, 2);
    await waitForMainTitle(page, "Beta Palette");

    await openActionsPalette(page);
    await page.locator('[data-cmdk-input]').fill("Open Session: Alpha Palette");
    const openAlpha = page.locator("[data-cmdk-item]").filter({ hasText: "Open Session: Alpha Palette" }).first();
    await openAlpha.waitFor({ state: "visible" });
    await openAlpha.click({ force: true });

    await page.getByTestId("command-palette").waitFor({ state: "hidden" });
    await waitForMainTitle(page, "Alpha Palette");
    expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(2);
    await page.getByText("Beta response").waitFor({ state: "visible" });
    await page.getByText("Alpha response").waitFor({ state: "visible" });
    expect((await page.locator('.session-main[aria-current="true"] strong').textContent())?.trim()).toBe(
      "Alpha Palette",
    );

    await openActionsPalette(page);
    await page.locator('[data-cmdk-input]').fill("Archive Session: Alpha Palette");
    const archiveAlpha = page
      .locator("[data-cmdk-item]")
      .filter({ hasText: "Archive Session: Alpha Palette" })
      .first();
    await archiveAlpha.waitFor({ state: "visible" });
    await archiveAlpha.click({ force: true });
    await page.getByTestId("command-palette").waitFor({ state: "hidden" });
    await page.getByText("Archived").waitFor({ state: "visible" });
  });
});

test("unmatched all-actions text creates a normal prompted session", async () => {
  const stub = startPaletteChatStub();
  const homeDir = await createHomeDir();

  try {
    await withSvvyApp(
      {
        homeDir,
        env: {
          ANTHROPIC_API_KEY: "",
          OPENAI_API_KEY: "",
          ZAI_API_KEY: "stub-key",
        },
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          await writeAgentModelsConfig(launchHomeDir, {
            providers: {
              zai: {
                baseUrl: stub.baseUrl,
              },
            },
          });
          await seedSessions(launchHomeDir, seededSessions(), workspaceDir);
        },
      },
      async ({ page }) => {
        await waitForSessionRows(page, 2);
        await openActionsPalette(page);
        await page.locator('[data-cmdk-input]').fill("zzzzzzzzzz palette fallback prompt");
        await page.locator('[data-cmdk-input]').press("Enter");

        await page.getByTestId("command-palette").waitFor({ state: "hidden" });
        await waitForSessionRows(page, 3);
        await waitForMainTitle(page, "New Session");
        await page.getByText("zzzzzzzzzz palette fallback prompt").waitFor({ state: "visible" });
        expect(stub.requests.length).toBeGreaterThan(0);
        expect(getLatestUserText(stub.requests.at(-1)?.messages ?? [])).toContain(
          "zzzzzzzzzz palette fallback prompt",
        );
      },
    );
  } finally {
    stub.stop();
    await rm(homeDir, { force: true, recursive: true });
}

});

test("Cmd+P opens quick-open placeholder and Enter does not create sessions or prompts", async () => {
  await launchWithPaletteSessions(async ({ page }) => {
    await waitForSessionRows(page, 2);

    await openQuickOpen(page);
    await page.getByText("File quick-open is reserved.").waitFor({ state: "visible" });
    await page.locator('[data-cmdk-input]').press("Enter");
    await page.getByTestId("quick-open").waitFor({ state: "visible" });
    await waitForSessionRows(page, 2);

    await page.locator('[data-cmdk-input]').press("Escape");
    await page.getByTestId("quick-open").waitFor({ state: "hidden" });
    await waitForSessionRows(page, 2);
  });
});
