import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import type { AssistantMessage, StopReason, ToolCall, Usage } from "@mariozechner/pi-ai";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import {
  seedSessions,
  toolCall,
  toolResultMessage,
  userMessage,
  type SeedSessionInput,
} from "./support";

const PROMPT_RUNTIME_TIMEOUT_MS = process.env.ELECTROBUN_E2E_LAUNCH_RETRIES ? 90_000 : 45_000;
const TIMESTAMP = Date.parse("2026-04-10T12:00:00.000Z");

setDefaultTimeout(PROMPT_RUNTIME_TIMEOUT_MS);

beforeAll(async () => {
  await ensureBuilt();
});

function makeUsage(): Usage {
  return {
    input: 12,
    output: 34,
    cacheRead: 3,
    cacheWrite: 4,
    totalTokens: 53,
    cost: {
      input: 0.01,
      output: 0.02,
      cacheRead: 0.03,
      cacheWrite: 0.04,
      total: 0.1234,
    },
  };
}

function assistantMessageWithUsage(
  text: string,
  options: {
    model: string;
    provider: string;
    stopReason?: StopReason;
    timestamp: number;
    thinking?: string;
    toolCalls?: ToolCall[];
  },
): AssistantMessage {
  return {
    role: "assistant",
    timestamp: options.timestamp,
    api: "openai-responses",
    provider: options.provider,
    model: options.model,
    usage: makeUsage(),
    stopReason: options.stopReason ?? "stop",
    content: [
      ...(options.thinking ? [{ type: "thinking" as const, thinking: options.thinking }] : []),
      { type: "text" as const, text },
      ...(options.toolCalls ?? []),
    ],
  };
}

async function launchSeededApp<T>(
  options: {
    homeDir?: string;
    workspaceDir?: string;
    sessions?: SeedSessionInput[];
    beforeLaunch?: (context: { homeDir: string; workspaceDir: string }) => Promise<void> | void;
  },
  fn: (app: SvvyApp) => Promise<T>,
): Promise<T> {
  const ownsHomeDir = !options.homeDir;
  const homeDir = options.homeDir ?? (await createHomeDir());

  try {
    return await withSvvyApp(
      {
        homeDir,
        workspaceDir: options.workspaceDir,
        env: {
          ZAI_API_KEY: "stub-key",
        },
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          if (options.sessions?.length) {
            await seedSessions(launchHomeDir, options.sessions, workspaceDir);
          }
          await options.beforeLaunch?.({
            homeDir: launchHomeDir,
            workspaceDir,
          });
        },
      },
      fn,
    );
  } finally {
    if (ownsHomeDir) {
      await rm(homeDir, { force: true, recursive: true });
    }
  }
}

test("transcript rendering projects assistant metadata, tool cards, tool results, and reasoning", async () => {
  const reportCall = toolCall("execute_typescript", {
    typescriptCode: "return { artifact: 'report.html' };",
  });

  const sessions: SeedSessionInput[] = [
    {
      title: "Transcript Runtime",
      messages: [
        userMessage("Seed the transcript runtime surface.", TIMESTAMP),
        assistantMessageWithUsage("I will create the report and explain the reasoning.", {
          provider: "zai",
          model: "glm-5-turbo",
          timestamp: TIMESTAMP + 1,
          thinking: "I need to produce a durable artifact and expose its metadata.",
          stopReason: "toolUse",
          toolCalls: [reportCall],
        }),
        toolResultMessage(reportCall.id, "artifacts", "Created file report.html", {
          timestamp: TIMESTAMP + 2,
        }),
        assistantMessageWithUsage("The artifact is ready.", {
          provider: "zai",
          model: "glm-5-turbo",
          timestamp: TIMESTAMP + 3,
        }),
      ],
    },
  ];

  await launchSeededApp(
    {
      sessions,
    },
    async ({ page }) => {
      await page.getByText("Seed the transcript runtime surface.").waitFor({ state: "visible" });
      await page.getByText("I will create the report and explain the reasoning.").waitFor({
        state: "visible",
      });
      await page.getByText("The artifact is ready.").waitFor({ state: "visible" });

      expect(await page.locator(".user-row").count()).toBe(1);
      expect(await page.locator(".assistant-row").count()).toBe(2);
      expect(await page.locator(".tool-row").count()).toBe(0);

      const assistantRows = page.locator(".assistant-row");
      const firstAssistant = assistantRows.first();
      expect((await firstAssistant.locator("small").textContent())?.trim()).toBe(
        "zai · glm-5-turbo",
      );
      const messageBudget = firstAssistant.locator("[data-testid=context-budget-inline]");
      await messageBudget.waitFor({ state: "visible" });
      expect((await firstAssistant.locator(".thinking-markdown").textContent()) ?? "").toContain(
        "durable artifact",
      );
      expect(
        (await firstAssistant.locator('[data-testid^="tool-card-"]').textContent()) ?? "",
      ).toContain("Done");
      expect(await page.locator(".artifacts-panel").count()).toBe(0);
    },
  );
});

test("transcript rendering shows execute_typescript bodies on tool cards", async () => {
  const executeTypescriptCall = toolCall("execute_typescript", {
    typescriptCode: ["const result = { files: ['docs/prd.md'] };", "return result;"].join("\n"),
  });

  const sessions: SeedSessionInput[] = [
    {
      title: "Execute Typescript Transcript",
      messages: [
        userMessage("Inspect the working directory.", TIMESTAMP),
        assistantMessageWithUsage("I will inspect the directory through execute_typescript.", {
          provider: "zai",
          model: "glm-5-turbo",
          timestamp: TIMESTAMP + 10,
          stopReason: "toolUse",
          toolCalls: [executeTypescriptCall],
        }),
        toolResultMessage(
          executeTypescriptCall.id,
          "execute_typescript",
          "Directory inspection complete.",
          {
            timestamp: TIMESTAMP + 11,
          },
        ),
      ],
    },
  ];

  await launchSeededApp(
    {
      sessions,
    },
    async ({ page }) => {
      await page.getByText("Inspect the working directory.").waitFor({ state: "visible" });
      await page.getByText("I will inspect the directory through execute_typescript.").waitFor({
        state: "visible",
      });

      const toolCard = page.locator('[data-testid^="tool-card-"]').first();
      await toolCard.waitFor({ state: "visible" });
      await toolCard.locator(".transcript-tool-toggle").click({ force: true });
      const toolBody = (await toolCard.locator(".transcript-tool-pre").textContent()) ?? "";
      expect(toolBody).toContain("const result = { files: ['docs/prd.md'] };");
      expect(toolBody).toContain("return result;");
    },
  );
});
