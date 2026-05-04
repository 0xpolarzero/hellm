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

test("transcript rendering projects assistant metadata, tool cards, tool results, reasoning, and artifact affordances", async () => {
  const reportCall = toolCall("artifacts", {
    command: "create",
    filename: "report.html",
    content: "<html><body><main>Artifact transcript</main></body></html>",
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
      expect(await page.locator(".tool-row").count()).toBe(1);

      const assistantRows = page.locator(".assistant-row");
      const firstAssistant = assistantRows.first();
      expect((await firstAssistant.locator("small").textContent())?.trim()).toBe(
        "zai · glm-5-turbo",
      );
      expect((await firstAssistant.locator(".message-usage").textContent())?.trim()).toContain(
        "↑12",
      );
      expect((await firstAssistant.locator(".message-usage").textContent())?.trim()).toContain(
        "↓34",
      );
      expect((await firstAssistant.locator(".message-usage").textContent())?.trim()).toContain(
        "$0.1234",
      );
      expect((await firstAssistant.locator(".thinking-block pre").textContent()) ?? "").toContain(
        "durable artifact",
      );
      expect((await firstAssistant.locator(".tool-card .tool-status").textContent())?.trim()).toBe(
        "done",
      );
      expect((await page.locator(".tool-result .tool-status").textContent())?.trim()).toBe(
        "Complete",
      );
      expect(await page.getByText("report.html").isVisible()).toBe(true);
      expect(await page.getByText("Created file report.html").isVisible()).toBe(true);

      await page.getByRole("button", { name: "Open" }).first().click({ force: true });
      await page.locator(".artifacts-panel").waitFor({ state: "visible" });
      expect(await page.locator(".artifact-name").textContent()).toBe("report.html");
    },
  );
});

test("transcript rendering shows execute_typescript bodies on tool cards", async () => {
  const executeTypescriptCall = toolCall("execute_typescript", {
    typescriptCode: [
      'const result = await api.bash({ command: "ls -la" });',
      "console.log(result.content);",
    ].join("\n"),
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

      const toolCard = page.locator(".tool-card").first();
      await toolCard.waitFor({ state: "visible" });
      expect((await toolCard.locator(".tool-body-label").textContent())?.trim()).toBe(
        "TypeScript body",
      );
      const toolBody = (await toolCard.locator(".tool-body-preview pre").textContent()) ?? "";
      expect(toolBody).toContain('const result = await api.bash({ command: "ls -la" });');
      expect(toolBody).toContain("console.log(result.content);");
    },
  );
});
