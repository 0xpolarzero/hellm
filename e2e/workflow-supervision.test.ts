import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startWorkflowSupervisionChatStub } from "./chat-completions-stub";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { resolveProjectEnvValue, writeAgentModelsConfig, writeWorkspaceEnvFile } from "./support";

setDefaultTimeout(180_000);

const REAL_ZAI_API_KEY = resolveProjectEnvValue("ZAI_API_KEY");
const HELLO_WORLD_ENTRY_PATH = ".svvy/workflows/entries/hello-world.tsx";

beforeAll(async () => {
  if (!REAL_ZAI_API_KEY) {
    throw new Error(
      "ZAI_API_KEY is required for workflow supervision e2e coverage. Set it in .env.local, .env, or the process environment before running bun run test:e2e.",
    );
  }
  await ensureBuilt();
});

async function waitForVisible(
  locator: {
    isVisible(): Promise<boolean>;
  },
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await locator.isVisible()) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for workflow supervision UI.");
}

async function waitForEnabled(
  locator: {
    isDisabled?: () => Promise<boolean>;
    getAttribute?: (name: string) => Promise<string | null>;
  },
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const disabled =
      typeof locator.isDisabled === "function"
        ? await locator.isDisabled()
        : typeof locator.getAttribute === "function"
          ? (await locator.getAttribute("disabled")) !== null
          : false;
    if (!disabled) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for workflow supervision action to become enabled.");
}

function isRetryableClickError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Resolved element is disabled") ||
      error.message.includes("Bridge request timed out"))
  );
}

async function clickWhenEnabled(
  locator: {
    click: (options?: { force?: boolean }) => Promise<void>;
    focus?: () => Promise<void>;
    isVisible?: () => Promise<boolean>;
    isDisabled?: () => Promise<boolean>;
    getAttribute?: (name: string) => Promise<string | null>;
    press?: (key: string) => Promise<void>;
  },
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    await waitForEnabled(locator, Math.min(1_000, timeoutMs));
    if (typeof locator.isVisible === "function" && !(await locator.isVisible())) {
      await Bun.sleep(100);
      continue;
    }
    try {
      await locator.click({ force: true });
      return;
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        error.message.includes("Bridge request timed out") &&
        typeof locator.focus === "function" &&
        typeof locator.press === "function"
      ) {
        try {
          await locator.focus();
          await locator.press("Enter");
          return;
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      }
      if (!isRetryableClickError(error)) {
        throw error;
      }
    }
    await Bun.sleep(100);
  }

  throw new Error(
    `Timed out clicking a workflow supervision action after it became enabled.${
      lastError instanceof Error ? ` Last error: ${lastError.message}` : ""
    }`,
  );
}

async function sendPrompt(page: SvvyApp["page"], text: string): Promise<void> {
  const focusedPane = page.locator(".workspace-pane.focused");
  const composer = focusedPane.locator(
    'textarea[placeholder="Ask svvy to inspect the repo, make a change, or run Project CI."]',
  );
  await composer.fill(text);
  const sendButton = focusedPane.locator('button[aria-label="Send"]');
  await clickWhenEnabled(sendButton);
}

async function returnToOrchestrator(page: SvvyApp["page"]): Promise<void> {
  const returnButton = page.getByRole("button", { name: "Return to orchestrator" });
  if (await returnButton.isVisible()) {
    await clickWhenEnabled(returnButton, 60_000);
  }
}

async function createWorkspaceDir(prefix = "svvy-workflow-supervision-e2e-"): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function withIsolatedLaunchState<T>(
  fn: (input: { homeDir: string; workspaceDir: string }) => Promise<T>,
): Promise<T> {
  const homeDir = await createHomeDir("svvy-workflow-supervision-home-");
  const workspaceDir = await createWorkspaceDir();

  try {
    return await fn({ homeDir, workspaceDir });
  } finally {
    await Promise.all([
      rm(homeDir, { force: true, recursive: true }),
      rm(workspaceDir, { force: true, recursive: true }),
    ]);
  }
}

async function seedHelloWorldSavedWorkflowEntry(workspaceDir: string): Promise<void> {
  const absoluteEntryPath = join(workspaceDir, HELLO_WORLD_ENTRY_PATH);
  await mkdir(dirname(absoluteEntryPath), { recursive: true });
  await writeFile(
    absoluteEntryPath,
    [
      'import React from "react";',
      'import { createSmithers } from "smithers-orchestrator";',
      'import { z } from "zod";',
      "",
      'export const workflowId = "hello_world";',
      'export const label = "Hello World Fixture";',
      'export const summary = "E2E fixture workflow for Smithers supervision.";',
      'export const launchSchema = z.object({ message: z.string().min(1).default("hello world") });',
      "export const definitionPaths = [] as const;",
      "export const promptPaths = [] as const;",
      "export const componentPaths = [] as const;",
      "",
      "export function createRunnableEntry(input: { dbPath: string }) {",
      "  const greetingSchema = z.object({ message: z.string() });",
      "  const resultSchema = z.object({ summary: z.string(), message: z.string() });",
      "  const smithersApi = createSmithers(",
      "    { input: launchSchema, greeting: greetingSchema, result: resultSchema },",
      "    { dbPath: input.dbPath },",
      "  );",
      "  return {",
      "    workflowId,",
      '    workflowSource: "saved" as const,',
      "    launchSchema,",
      "    workflow: smithersApi.smithers((ctx) => {",
      "      const greeting = ctx.outputs.greeting?.[ctx.outputs.greeting.length - 1] ?? null;",
      "      return React.createElement(",
      "        smithersApi.Workflow,",
      '        { name: "svvy-hello-world" },',
      "        React.createElement(",
      "          smithersApi.Sequence,",
      "          null,",
      "          React.createElement(smithersApi.Task, {",
      '            id: "greeting",',
      "            output: smithersApi.outputs.greeting,",
      "            children: { message: ctx.input.message },",
      "          }),",
      "          React.createElement(smithersApi.Task, {",
      '            id: "result",',
      "            output: smithersApi.outputs.result,",
      "            children: {",
      '              summary: `Generated greeting "${greeting?.message ?? ctx.input.message}".`,',
      "              message: greeting?.message ?? ctx.input.message,",
      "            },",
      "          }),",
      "        ),",
      "      );",
      "    }),",
      "  };",
      "}",
    ].join("\n") + "\n",
  );
}

test("drives a real delegated workflow run through the app and routes workflow attention back to the owning handler surface", async () => {
  const stub = startWorkflowSupervisionChatStub();

  try {
    await withIsolatedLaunchState(async (launchState) => {
      await seedHelloWorldSavedWorkflowEntry(launchState.workspaceDir);
      await withSvvyApp(
        {
          env: {
            ANTHROPIC_API_KEY: "",
            OPENAI_API_KEY: "",
            ZAI_API_KEY: "stub-key",
          },
          homeDir: launchState.homeDir,
          workspaceDir: launchState.workspaceDir,
          beforeLaunch: async ({ homeDir }) => {
            await writeAgentModelsConfig(homeDir, {
              providers: {
                zai: {
                  baseUrl: stub.baseUrl,
                },
              },
            });
          },
        },
        async ({ page }) => {
          await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
          await waitForVisible(page.getByText("New Session"));

          await sendPrompt(
            page,
            "Open a handler thread dedicated to running the saved hello_world fixture workflow.",
          );

          await waitForVisible(
            page.getByText("Opened a handler thread for the saved hello_world fixture workflow."),
          );
          await waitForVisible(page.getByText("Delegated Threads"));
          await waitForVisible(page.getByText("Run the saved hello_world fixture workflow"));
          await waitForVisible(page.getByText("1 thread"));

          const threadCard = page.locator(".handler-thread-reference-entry").filter({
            has: page.getByText("Run the saved hello_world fixture workflow"),
          });
          await waitForVisible(threadCard);
          expect((await threadCard.textContent()) ?? "").toContain(
            "Run the saved hello_world fixture workflow",
          );

          await clickWhenEnabled(page.locator(".handler-thread-actions button").nth(1));
          await waitForVisible(page.getByRole("button", { name: "Return to orchestrator" }));
          await waitForVisible(
            page.locator(".pane-title-line").filter({ hasText: "Handler Thread" }),
          );

          await sendPrompt(
            page,
            "Run the saved hello_world fixture workflow, let workflow supervision wake this handler when it finishes, and then hand the result back.",
          );

          await returnToOrchestrator(page);
          await waitForVisible(page.getByText("Delegated Threads"), 90_000);
          await waitForVisible(
            page.getByText("Run the saved hello_world fixture workflow"),
            90_000,
          );
          await waitForVisible(page.getByText("1 workflow"), 90_000);

          await waitForVisible(page.getByText("Done"), 90_000);
          await waitForVisible(page.getByText("1 handoff"), 180_000);

          await clickWhenEnabled(page.locator(".handler-thread-actions button").first());

          const inspector = page.getByRole("dialog").filter({
            has: page.getByText("Run the saved hello_world fixture workflow"),
          });
          await waitForVisible(inspector);
          expect((await inspector.textContent()) ?? "").toContain("Workflow Runs");
          expect((await inspector.textContent()) ?? "").toContain("svvy-hello-world");
          expect((await inspector.textContent()) ?? "").toContain("svvy-hello-world is completed");
          expect((await inspector.textContent()) ?? "").toContain("smithers.run_workflow");

          await page.locator(".ui-dialog-close").click({ force: true });
          await inspector.waitFor({ state: "hidden" });
        },
      );

      const smithersDb = join(launchState.workspaceDir, ".svvy", "smithers-runtime", "smithers.db");
      expect(existsSync(smithersDb)).toBe(true);

      const executionRoot = join(launchState.workspaceDir, ".smithers", "executions");
      const executionDirs = await readdir(executionRoot, { withFileTypes: true });
      const runDirectories = executionDirs.filter((entry) => entry.isDirectory());
      expect(runDirectories.length).toBeGreaterThan(0);
      expect(
        existsSync(join(executionRoot, runDirectories[0]?.name ?? "", "logs", "stream.ndjson")),
      ).toBe(true);
    });
  } finally {
    stub.stop();
  }

  const orchestratorRequest = stub.requests.find((request) =>
    latestUserText(request).includes(
      "Open a handler thread dedicated to running the saved hello_world fixture workflow.",
    ),
  );
  expect(toolNames(orchestratorRequest)).toContain("thread.start");
  expect(toolNames(orchestratorRequest)).not.toContain("smithers.run_workflow");

  const handlerRequest = stub.requests.find((request) =>
    latestUserText(request).includes(
      "Run the saved hello_world fixture workflow, let workflow supervision wake this handler when it finishes, and then hand the result back.",
    ),
  );
  expect(toolNames(handlerRequest)).toContain("smithers.run_workflow");
  expect(toolNames(handlerRequest)).toContain("thread.handoff");
  expect(toolNames(handlerRequest)).not.toContain("thread.start");

  const workflowAttentionRequest = stub.requests.find((request) =>
    latestUserText(request).includes(
      "System event: A supervised Smithers workflow now requires handler attention.",
    ),
  );
  expect(workflowAttentionRequest).toBeTruthy();
  expect(toolNames(workflowAttentionRequest)).toContain("smithers.get_run");
  expect(toolNames(workflowAttentionRequest)).toContain("thread.handoff");
  expect(toolNames(workflowAttentionRequest)).not.toContain("thread.start");
});

test("drives a real delegated workflow run through the app with z.ai loaded from workspace .env", async () => {
  await withIsolatedLaunchState(async (launchState) => {
    await writeWorkspaceEnvFile(launchState.workspaceDir, {
      ZAI_API_KEY: REAL_ZAI_API_KEY,
    });
    await seedHelloWorldSavedWorkflowEntry(launchState.workspaceDir);

    await withSvvyApp(
      {
        env: {
          ANTHROPIC_API_KEY: "",
          OPENAI_API_KEY: "",
        },
        homeDir: launchState.homeDir,
        workspaceDir: launchState.workspaceDir,
      },
      async ({ page }) => {
        await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
        await waitForVisible(page.getByText("New Session"), 30_000);

        await sendPrompt(
          page,
          [
            "Open a handler thread for the objective `Run the saved hello_world fixture workflow, wait for it to finish, and hand the result back.`",
            "Do not run the workflow from the orchestrator.",
          ].join(" "),
        );

        await waitForVisible(page.getByText("Delegated Threads"), 60_000);
        await waitForVisible(page.getByText("Run the saved hello_world fixture workflow"), 60_000);

        const threadCard = page.locator(".handler-thread-reference-entry").filter({
          has: page.getByText("Run the saved hello_world fixture workflow"),
        });
        await waitForVisible(threadCard, 60_000);
        await clickWhenEnabled(page.locator(".handler-thread-actions button").nth(1), 60_000);
        await waitForVisible(page.getByRole("button", { name: "Return to orchestrator" }));
        await waitForVisible(
          page.locator(".pane-title-line").filter({ hasText: "Handler Thread" }),
        );

        await sendPrompt(
          page,
          [
            "Run the saved hello_world fixture workflow with input message `hello from the real provider workflow supervision e2e`.",
            "Use smithers.* tools only as needed.",
            "Do not call execute_typescript.",
            "Stay in the thread until smithers.get_run reports the workflow is finished.",
            "Then call thread.handoff with title `hello_world completed` and kind `workflow`.",
          ].join(" "),
        );

        await waitForVisible(page.getByRole("button", { name: "Send" }), 90_000);
        await returnToOrchestrator(page);
        await waitForVisible(page.getByText("Delegated Threads"), 90_000);

        await waitForVisible(page.getByText("Done"), 90_000);
        await waitForVisible(page.getByText("1 handoff"), 180_000);

        await clickWhenEnabled(page.locator(".handler-thread-actions button").first());

        const inspector = page.getByRole("dialog").filter({
          has: page.getByText("Run the saved hello_world fixture workflow"),
        });
        await waitForVisible(inspector, 60_000);
        expect((await inspector.textContent()) ?? "").toContain("Workflow Runs");
        expect((await inspector.textContent()) ?? "").toContain("svvy-hello-world");
        expect((await inspector.textContent()) ?? "").toContain("smithers.run_workflow");

        await page.locator(".ui-dialog-close").click({ force: true });
        await inspector.waitFor({ state: "hidden" });
      },
    );

    const smithersDb = join(launchState.workspaceDir, ".svvy", "smithers-runtime", "smithers.db");
    expect(existsSync(smithersDb)).toBe(true);

    const executionRoot = join(launchState.workspaceDir, ".smithers", "executions");
    const executionDirs = await readdir(executionRoot, { withFileTypes: true });
    const runDirectories = executionDirs.filter((entry) => entry.isDirectory());
    expect(runDirectories.length).toBeGreaterThan(0);
    expect(
      existsSync(join(executionRoot, runDirectories[0]?.name ?? "", "logs", "stream.ndjson")),
    ).toBe(true);
  });
});

function latestUserText(
  request:
    | {
        messages: Array<Record<string, unknown>>;
      }
    | undefined,
): string {
  if (!request) {
    return "";
  }

  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role !== "user") {
      continue;
    }

    const content = message.content;
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((block) =>
          block && typeof block === "object" && "text" in block && typeof block.text === "string"
            ? block.text
            : "",
        )
        .filter(Boolean)
        .join("\n");
    }
  }

  return "";
}

function toolNames(
  request:
    | {
        tools?: Array<{
          function?: {
            name?: string;
          };
        }>;
      }
    | undefined,
): string[] {
  return (request?.tools ?? [])
    .map((tool) => tool.function?.name)
    .filter((name): name is string => typeof name === "string");
}
