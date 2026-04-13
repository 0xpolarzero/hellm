import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import type { AssistantMessage, StopReason, ToolCall, Usage } from "@mariozechner/pi-ai";
import { createHomeDir, ensureBuilt, type HellmApp, withHellmApp } from "./harness";
import {
  e2eDelayStep,
  e2ePromptScenario,
  e2eTextStep,
  e2eThinkingStep,
  e2eToolCallStep,
  seedSessions,
  toolCall,
  toolResultMessage,
  userMessage,
  writeE2eControl,
  type SeedSessionInput,
} from "./support";
import type { HellmE2eControl, E2ePromptScenario } from "../src/bun/e2e-control";

const PROMPT_RUNTIME_TIMEOUT_MS = process.env.ELECTROBUN_E2E_LAUNCH_RETRIES ? 90_000 : 45_000;

setDefaultTimeout(PROMPT_RUNTIME_TIMEOUT_MS);

const TIMESTAMP = Date.parse("2026-04-10T12:00:00.000Z");
const SUCCESS_PROMPT = "Store this prompt";
const FAILURE_PROMPT = "Fail this prompt";
const MULTILINE_PROMPT = "first line\nsecond line";

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

function successScenario(reply: string): E2ePromptScenario {
  return e2ePromptScenario({
    stream: [e2eTextStep(reply, { chunks: [reply.slice(0, Math.ceil(reply.length / 2)), reply.slice(Math.ceil(reply.length / 2))] })],
  });
}

function streamingScenario(): E2ePromptScenario {
  return e2ePromptScenario({
    stream: [
      e2eThinkingStep("Thinking through the live request.", {
        chunks: ["Thinking through ", "the live request."],
        chunkDelayMs: 300,
      }),
      e2eTextStep("Partial answer from the live stream.", {
        chunks: ["Partial answer ", "from the live stream."],
        chunkDelayMs: 300,
      }),
      e2eToolCallStep(
        "artifacts",
        {
          command: "create",
          filename: "streamed.txt",
          content: "streamed artifact",
        },
        {
          chunks: [
            '{"command":"create","filename":"streamed.txt",',
            '"content":"streamed artifact"}',
          ],
          chunkDelayMs: 500,
        },
      ),
      e2eDelayStep(750),
    ],
  });
}

function abortScenario(): E2ePromptScenario {
  return e2ePromptScenario({
    waitForAbort: true,
    abortFallbackMessage: "Prompt aborted by test.",
    stream: [e2eDelayStep(1_500)],
  });
}

function toolUseScenario(): E2ePromptScenario {
  const artifactCall = toolCall("artifacts", {
    command: "create",
    filename: "tool-use.txt",
    content: "tool use artifact",
  });

  return e2ePromptScenario({
    stream: [
      e2eToolCallStep(
        "artifacts",
        {
          command: "create",
          filename: "tool-use.txt",
          content: "tool use artifact",
        },
        {
          id: artifactCall.id,
          chunks: [
            '{"command":"create","filename":"tool-use.txt",',
            '"content":"tool use artifact"}',
          ],
          chunkDelayMs: 300,
        },
      ),
      e2eDelayStep(500),
    ],
    persistedMessages: [
      assistantMessageWithUsage("Using the artifacts tool.", {
        provider: "zai",
        model: "glm-5-turbo",
        timestamp: TIMESTAMP + 10,
        stopReason: "toolUse",
        toolCalls: [artifactCall],
      }),
      toolResultMessage(artifactCall.id, "artifacts", "Created file tool-use.txt", {
        timestamp: TIMESTAMP + 11,
      }),
      assistantMessageWithUsage("The tool use finished.", {
        provider: "zai",
        model: "glm-5-turbo",
        timestamp: TIMESTAMP + 12,
      }),
    ],
  });
}

function failureScenario(): E2ePromptScenario {
  return e2ePromptScenario({
    error: "Synthetic prompt failure.",
    errorReason: "error",
  });
}

function promptControl(byText: Record<string, E2ePromptScenario>): HellmE2eControl {
  return {
    prompts: {
      byText,
    },
  };
}

async function waitForTextContent(
  locator: {
    textContent(): Promise<string | null>;
  },
  expected: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastValue = "";

  while (Date.now() < deadline) {
    lastValue = (await locator.textContent())?.trim() ?? "";
    if (lastValue === expected) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for "${expected}". Last value was "${lastValue}".`);
}

async function waitForSubstring(
  locator: {
    textContent(): Promise<string | null>;
  },
  expected: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastValue = "";

  while (Date.now() < deadline) {
    lastValue = (await locator.textContent())?.trim() ?? "";
    if (lastValue.includes(expected)) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for text containing "${expected}". Last value was "${lastValue}".`);
}

async function waitForVisible(
  locator: {
    isVisible(): Promise<boolean>;
  },
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await locator.isVisible()) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for a locator to become visible.");
}

async function waitForActiveSessionToLeaveRunningState(
  driver: HellmApp["driver"],
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unknown";

  while (Date.now() < deadline) {
    const sessionsState = (
      await driver.stateGet("sessions")
    ).value as {
      activeSessionId?: string | null;
      summaries?: Array<{ id: string; status?: string }>;
    };
    const activeSummary = sessionsState.summaries?.find(
      (summary) => summary.id === sessionsState.activeSessionId,
    );
    lastStatus = activeSummary?.status ?? "missing";
    if (lastStatus !== "running") {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for the active session to stop running. Last status was "${lastStatus}".`);
}

async function waitForActiveSessionSummary(
  driver: HellmApp["driver"],
  expected: {
    previewIncludes: string;
    status?: string;
    minMessageCount?: number;
  },
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSummary: { messageCount?: number; preview?: string; status?: string } | null = null;

  while (Date.now() < deadline) {
    const sessionsState = (
      await driver.stateGet("sessions")
    ).value as {
      activeSessionId?: string | null;
      summaries?: Array<{
        messageCount?: number;
        preview?: string;
        status?: string;
        id: string;
      }>;
    };
    lastSummary =
      sessionsState.summaries?.find((summary) => summary.id === sessionsState.activeSessionId) ??
      null;

    if (
      lastSummary &&
      (expected.status ? lastSummary.status === expected.status : true) &&
      (expected.minMessageCount ? (lastSummary.messageCount ?? 0) >= expected.minMessageCount : true) &&
      (lastSummary.preview ?? "").includes(expected.previewIncludes)
    ) {
      return;
    }

    await Bun.sleep(100);
  }

  throw new Error(
    `Timed out waiting for active session summary. Last summary was ${JSON.stringify(lastSummary)}.`,
  );
}

async function textareaValue(page: HellmApp["page"]): Promise<string> {
  const resolved = await page.locator('textarea[placeholder^="Ask hellm"]').resolve();
  return resolved.first?.value ?? "";
}

async function expectTextareaValue(
  page: HellmApp["page"],
  expected: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastValue = "";

  while (Date.now() < deadline) {
    lastValue = await textareaValue(page);
    if (lastValue.trimEnd() === expected) {
      return;
    }
    await Bun.sleep(100);
  }

  expect(lastValue.trimEnd()).toBe(expected);
}

async function submitPrompt(page: HellmApp["page"], text: string): Promise<void> {
  const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
  await textarea.fill(text);
  await textarea.press("Enter");
}

async function launchPromptRuntimeApp<T>(
  options: {
    auth?: boolean;
    control: HellmE2eControl;
    env?: Record<string, string | undefined>;
    homeDir?: string;
    workspaceDir?: string;
    sessions?: SeedSessionInput[];
  },
  fn: (app: HellmApp) => Promise<T>,
): Promise<T> {
  const ownsHomeDir = !options.homeDir;
  const homeDir = options.homeDir ?? (await createHomeDir());

  try {
    const controlFile = await writeE2eControl(homeDir, options.control);
    return await withHellmApp(
      {
        homeDir,
        workspaceDir: options.workspaceDir,
        env: {
          ...(options.auth === false ? { ZAI_API_KEY: "" } : { ZAI_API_KEY: "stub-key" }),
          ...options.env,
          HELLM_E2E_CONTROL_PATH: controlFile,
        },
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          if (options.sessions?.length) {
            await seedSessions(launchHomeDir, options.sessions, workspaceDir);
          }
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

async function openNewSession(page: HellmApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Create a new session" }).click();
  await waitForTextContent(page.locator(".workspace-main-title"), "New Session");
}

async function launchWithSameHome<T>(
  homeDir: string,
  control: HellmE2eControl,
  fn: (app: HellmApp) => Promise<T>,
  options: {
    auth?: boolean;
    env?: Record<string, string | undefined>;
    sessions?: SeedSessionInput[];
  } = {},
): Promise<T> {
  return await launchPromptRuntimeApp(
    {
      homeDir,
      control,
      auth: options.auth,
      env: options.env,
      sessions: options.sessions,
    },
    fn,
  );
}

test("composer submit sends on Enter, accepts multiline drafts, and ignores an empty draft", async () => {
  await launchPromptRuntimeApp(
    {
      control: promptControl({
        [MULTILINE_PROMPT]: successScenario("Multiline prompt received."),
      }),
    },
    async ({ page }) => {
      const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
      const sendButton = page.getByRole("button", { name: "Send" });

      await textarea.waitFor({ state: "visible" });
      expect((await sendButton.resolve()).first?.disabled).toBe(true);

      await textarea.focus();
      await textarea.press("Enter");
      expect(await page.locator(".assistant-row").count()).toBe(0);

      await textarea.fill(MULTILINE_PROMPT);
      expect(await textareaValue(page)).toBe(MULTILINE_PROMPT);
      expect((await sendButton.resolve()).first?.disabled).toBe(false);

      await textarea.press("Enter");
      await waitForSubstring(page.locator(".workspace-main-meta"), "2 turns");
      await page.getByText("Multiline prompt received.").waitFor({ state: "visible" });
      expect(await page.locator(".user-row").count()).toBe(1);
      expect(await page.locator(".user-row .message-text").count()).toBe(1);
      expect((await page.locator(".user-row .message-text").textContent()) ?? "").toContain(
        "first line",
      );
      expect((await page.locator(".user-row .message-text").textContent()) ?? "").toContain(
        "second line",
      );

      await textarea.fill("");
      expect((await sendButton.resolve()).first?.disabled).toBe(true);
      await textarea.press("Enter");
      expect(await page.locator(".assistant-row").count()).toBe(1);
    },
  );
});

test("composer stop aborts a streaming prompt and lets the user send again immediately", async () => {
  await launchPromptRuntimeApp(
    {
      control: promptControl({
        "Abort this prompt": abortScenario(),
        "Follow up after stop": successScenario("Follow-up prompt succeeded."),
      }),
    },
    async ({ page, driver }) => {
      await submitPrompt(page, "Abort this prompt");

      const stopButton = page.getByRole("button", { name: "Stop" });
      await waitForVisible(stopButton);
      await stopButton.click();

      await waitForSubstring(page.locator(".assistant-row .message-text"), "Request aborted by user");
      await waitForActiveSessionToLeaveRunningState(driver);
      await Bun.sleep(250);
      const sendButton = page.getByRole("button", { name: "Send" });
      await waitForVisible(sendButton);
      await page.locator('textarea[placeholder^="Ask hellm"]').fill("Follow up after stop");
      await expectTextareaValue(page, "Follow up after stop");
      await Bun.sleep(250);
      await sendButton.click({ force: true });
      await waitForActiveSessionSummary(driver, {
        previewIncludes: "Follow-up prompt succeeded.",
        status: "idle",
        minMessageCount: 4,
      });
      await waitForVisible(page.getByRole("button", { name: "Send" }));
    },
  );
});

test("composer surfaces runtime stream errors", async () => {
  await launchPromptRuntimeApp(
    {
      control: promptControl({
        "Cause a stream error": failureScenario(),
      }),
    },
    async ({ page }) => {
      await submitPrompt(page, "Cause a stream error");

      await page.getByRole("button", { name: "Send" }).waitFor({ state: "visible" });
      await page.getByText("Synthetic prompt failure.").waitFor({ state: "visible" });
      await waitForSubstring(page.locator(".composer-error"), "Synthetic prompt failure.");
      expect(await page.locator(".assistant-row").count()).toBe(1);
    },
  );
});

test("prompt history stores successful sends, shares them across sessions, and survives relaunch", async () => {
  const homeDir = await createHomeDir();
  try {
    const firstPrompt = `Store this prompt ${Date.now()} a`;
    const secondPrompt = `Store this prompt ${Date.now()} b`;
    const control = promptControl({
      [firstPrompt]: successScenario("Stored prompt reply a."),
      [secondPrompt]: successScenario("Stored prompt reply b."),
    });

    await launchWithSameHome(homeDir, control, async ({ page }) => {
      await submitPrompt(page, firstPrompt);
      await page.getByText("Stored prompt reply a.").waitFor({ state: "visible" });

      await submitPrompt(page, secondPrompt);
      await page.getByText("Stored prompt reply b.").waitFor({ state: "visible" });

      await openNewSession(page);
      const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
      await textarea.focus();
      await textarea.press("ArrowUp");
      await expectTextareaValue(page, secondPrompt);
    });

    await launchWithSameHome(homeDir, control, async ({ page }) => {
      const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
      await textarea.waitFor({ state: "visible" });
      await textarea.focus();
      await textarea.press("ArrowUp");
      await expectTextareaValue(page, secondPrompt);
    });
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("prompt history also recalls failed sends as the newest entry", async () => {
  const homeDir = await createHomeDir();
  try {
    const control = promptControl({
      [SUCCESS_PROMPT]: successScenario("Anchor reply."),
      [FAILURE_PROMPT]: failureScenario(),
    });

    await launchWithSameHome(homeDir, control, async ({ page }) => {
      await submitPrompt(page, SUCCESS_PROMPT);
      await page.getByText("Anchor reply.").waitFor({ state: "visible" });

      await submitPrompt(page, FAILURE_PROMPT);
      await page.getByText("Synthetic prompt failure.").waitFor({ state: "visible" });

      const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
      await textarea.focus();
      await textarea.press("ArrowUp");
      await expectTextareaValue(page, FAILURE_PROMPT);
    });
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("prompt history also recalls blocked sends after missing-provider gating", async () => {
  const homeDir = await createHomeDir();
  const workspaceDir = await createHomeDir("hellm-e2e-workspace-");
  try {
    const control = promptControl({});
    const blockedPrompt = `Blocked by auth ${Date.now()}`;

    await launchPromptRuntimeApp(
      {
        homeDir,
        workspaceDir,
        control,
        auth: false,
      },
      async ({ page }) => {
        await submitPrompt(page, blockedPrompt);

        const settings = page.getByRole("dialog", { name: "Settings" });
        await settings.waitFor({ state: "visible" });
        expect(await page.getByText("Not configured").isVisible()).toBe(true);
        await page.locator(".ui-dialog-close").click();
        await settings.waitFor({ state: "detached" });
        const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
        await textarea.fill("");
        await textarea.focus();
        await textarea.press("ArrowUp");
        await expectTextareaValue(page, blockedPrompt);
      },
    );
  } finally {
    await rm(workspaceDir, { force: true, recursive: true });
    await rm(homeDir, { force: true, recursive: true });
  }
});

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

  await launchPromptRuntimeApp(
    {
      control: promptControl({}),
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
      expect((await firstAssistant.locator(".message-usage").textContent())?.trim()).toContain("↑12");
      expect((await firstAssistant.locator(".message-usage").textContent())?.trim()).toContain("↓34");
      expect((await firstAssistant.locator(".message-usage").textContent())?.trim()).toContain(
        "$0.1234",
      );
      expect((await firstAssistant.locator(".thinking-block pre").textContent()) ?? "").toContain(
        "durable artifact",
      );
      expect((await firstAssistant.locator(".tool-card .tool-status").textContent()) ?? "").toBe(
        "done",
      );
      expect((await page.locator(".tool-result .tool-status").textContent()) ?? "").toBe(
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

test("streaming transcript rendering updates incrementally while the prompt is live", async () => {
  await launchPromptRuntimeApp(
    {
      control: promptControl({
        "Stream this prompt": streamingScenario(),
      }),
    },
    async ({ page }) => {
      await submitPrompt(page, "Stream this prompt");

      await page.getByRole("button", { name: "Stop" }).waitFor({ state: "visible" });
      await page.getByText("Streaming").waitFor({ state: "visible" });
      await waitForSubstring(page.locator(".streaming .thinking-block pre"), "live request");
      await waitForSubstring(page.locator(".streaming .message-text"), "Partial answer");
      await page.locator(".tool-card.pending").waitFor({ state: "visible" });
      expect(await page.locator(".tool-card.pending .tool-status").textContent()).toBe("pending");
    },
  );
});

test("tool use appears in the session while a prompt is running and after it completes", async () => {
  await launchPromptRuntimeApp(
    {
      control: promptControl({
        "Use a tool in this prompt": toolUseScenario(),
      }),
    },
    async ({ page }) => {
      await submitPrompt(page, "Use a tool in this prompt");

      await page.getByRole("button", { name: "Stop" }).waitFor({ state: "visible" });
      await page.locator(".tool-card.pending").waitFor({ state: "visible" });
      expect((await page.locator(".tool-card.pending .tool-status").textContent())?.trim()).toBe(
        "pending",
      );

      await waitForVisible(page.getByRole("button", { name: "Send" }));
      await page.locator(".tool-row").waitFor({ state: "visible" });
      await page.locator(".tool-result .result-details summary").first().click({ force: true });
      await page.getByText("Created file tool-use.txt").waitFor({ state: "visible" });
      expect(await page.locator(".tool-row").count()).toBe(1);
      expect((await page.locator(".tool-card .tool-status").textContent())?.trim()).toBe("done");
    },
  );
});
