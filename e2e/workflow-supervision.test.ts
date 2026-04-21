import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWorkflowSupervisionChatStub } from "./chat-completions-stub";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { resolveProjectEnvValue, writeAgentModelsConfig, writeWorkspaceEnvFile } from "./support";

setDefaultTimeout(180_000);

const REAL_ZAI_API_KEY = resolveProjectEnvValue("ZAI_API_KEY");
const realProviderTest = REAL_ZAI_API_KEY ? test : test.skip;

beforeAll(async () => {
  await ensureBuilt();
});

async function waitForVisible(
  locator: {
    isVisible(): Promise<boolean>;
  },
  timeoutMs = 20_000,
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

async function sendPrompt(page: SvvyApp["page"], text: string): Promise<void> {
  const composer = page.locator(
    'textarea[placeholder="Ask svvy to inspect the repo, make a change, or run verification."]',
  );
  await composer.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

async function returnToOrchestrator(page: SvvyApp["page"]): Promise<void> {
  const returnButton = page.getByRole("button", { name: "Return to orchestrator" });
  if (await returnButton.isVisible()) {
    await returnButton.click({ force: true });
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

test("drives a real delegated workflow run through the app and routes workflow attention back to the owning handler surface", async () => {
  const stub = startWorkflowSupervisionChatStub();

  try {
    await withIsolatedLaunchState(async (launchState) => {
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
            "Open a handler thread dedicated to running the bundled hello_world workflow.",
          );

          await waitForVisible(
            page.getByText(
              "Opened the Hello World Workflow Thread for the bundled hello_world workflow.",
            ),
          );
          await waitForVisible(page.getByText("Delegated Threads"));
          await waitForVisible(page.getByText("Hello World Workflow Thread"));
          await waitForVisible(page.getByText("1 thread"));

          const threadCard = page.locator(".handler-thread-card").filter({
            has: page.getByText("Hello World Workflow Thread", { exact: true }),
          });
          await waitForVisible(threadCard);
          expect((await threadCard.textContent()) ?? "").toContain(
            "Run the bundled hello_world workflow",
          );

          await threadCard.getByRole("button", { name: "Open thread" }).click({ force: true });
          await waitForVisible(page.getByRole("button", { name: "Return to orchestrator" }));

          await sendPrompt(
            page,
            "Run the bundled hello_world workflow, let workflow supervision wake this handler when it finishes, and then hand the result back.",
          );

          await waitForVisible(page.getByRole("button", { name: "Send" }));
          await returnToOrchestrator(page);
          await waitForVisible(page.getByText("Delegated Threads"));
          await waitForVisible(page.getByText("Hello World Workflow Thread"));
          await waitForVisible(
            page.getByText(
              "Ran the bundled hello_world workflow and verified that it finished successfully.",
            ),
          );
          await waitForVisible(page.getByText("1 workflow"));
          await waitForVisible(page.getByText("1 handoff"));

          const completedThreadCard = page.locator(".handler-thread-card").filter({
            has: page.getByText("Hello World Workflow Thread", { exact: true }),
          });
          expect((await completedThreadCard.textContent()) ?? "").toContain("Completed");

          await completedThreadCard.getByRole("button", { name: "Inspect" }).click({ force: true });

          const inspector = page.getByRole("dialog", { name: "Hello World Workflow Thread" });
          await waitForVisible(inspector);
          expect((await inspector.textContent()) ?? "").toContain("Workflow Runs");
          expect((await inspector.textContent()) ?? "").toContain("svvy-hello-world");
          expect((await inspector.textContent()) ?? "").toContain("svvy-hello-world is completed");
          expect((await inspector.textContent()) ?? "").toContain(
            "smithers.run_workflow.hello_world",
          );
          expect((await inspector.textContent()) ?? "").toContain("hello_world completed");

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
      "Open a handler thread dedicated to running the bundled hello_world workflow.",
    ),
  );
  expect(toolNames(orchestratorRequest)).toContain("thread.start");
  expect(toolNames(orchestratorRequest)).not.toContain("smithers.run_workflow.hello_world");

  const handlerRequest = stub.requests.find((request) =>
    latestUserText(request).includes(
      "Run the bundled hello_world workflow, let workflow supervision wake this handler when it finishes, and then hand the result back.",
    ),
  );
  expect(toolNames(handlerRequest)).toContain("smithers.run_workflow.hello_world");
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

realProviderTest(
  "drives a real delegated workflow run through the app with z.ai loaded from workspace .env",
  async () => {
    await withIsolatedLaunchState(async (launchState) => {
      await writeWorkspaceEnvFile(launchState.workspaceDir, {
        ZAI_API_KEY: REAL_ZAI_API_KEY!,
      });

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
              "Open a handler thread with the exact title `Hello World Workflow Thread`.",
              "Use the exact objective `Run the bundled hello_world workflow, wait for it to finish, and hand the result back.`",
              "Do not run the workflow from the orchestrator.",
            ].join(" "),
          );

          await waitForVisible(page.getByText("Delegated Threads"), 60_000);
          await waitForVisible(
            page.getByText("Hello World Workflow Thread", { exact: true }),
            60_000,
          );

          const threadCard = page.locator(".handler-thread-card").filter({
            has: page.getByText("Hello World Workflow Thread", { exact: true }),
          });
          await waitForVisible(threadCard, 60_000);
          await threadCard.getByRole("button", { name: "Open thread" }).click({ force: true });
          await waitForVisible(page.getByRole("button", { name: "Return to orchestrator" }));

          await sendPrompt(
            page,
            [
              "Run the bundled hello_world workflow with input message `hello from the real provider workflow supervision e2e`.",
              "Use smithers.* tools only as needed.",
              "Do not call execute_typescript.",
              "Stay in the thread until smithers.get_run reports the workflow is finished.",
              "Then call thread.handoff with title `hello_world completed` and kind `workflow`.",
            ].join(" "),
          );

          await waitForVisible(page.getByRole("button", { name: "Send" }), 90_000);
          await returnToOrchestrator(page);
          await waitForVisible(page.getByText("Delegated Threads"), 90_000);

          const completedThreadCard = page.locator(".handler-thread-card").filter({
            has: page.getByText("Hello World Workflow Thread", { exact: true }),
          });
          await waitForVisible(completedThreadCard, 90_000);
          expect((await completedThreadCard.textContent()) ?? "").toContain("Completed");

          await completedThreadCard.getByRole("button", { name: "Inspect" }).click({ force: true });

          const inspector = page.getByRole("dialog", { name: "Hello World Workflow Thread" });
          await waitForVisible(inspector, 60_000);
          expect((await inspector.textContent()) ?? "").toContain("Workflow Runs");
          expect((await inspector.textContent()) ?? "").toContain("svvy-hello-world");
          expect((await inspector.textContent()) ?? "").toContain(
            "smithers.run_workflow.hello_world",
          );

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
  },
);

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
