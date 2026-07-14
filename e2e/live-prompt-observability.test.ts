import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Locator } from "electrobun-browser-tools";
import { TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX } from "../src/mainview/transcript-scroll";
import { DEFAULT_AGENT_SETTINGS_STATE } from "../src/shared/agent-settings";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import {
  chatCompletionChunk,
  createLiveProviderEventGate,
  startLiveProviderStub,
  type CapturedLiveProviderRequest,
} from "./live-provider-stub";
import { getTestAgentDir, writeAgentModelsConfig } from "./support";

setDefaultTimeout(120_000);

const API_KEY = "svvy-live-prompt-observability-key";
const MODEL = "glm-5-turbo";
const SESSION_TITLE = "Live prompt observability";
const USER_PROMPT = "Report how the live prompt reached the runtime and render the result richly.";
const COMPOSER_PLACEHOLDER = "Ask svvy to inspect the repo, make a change, or delegate work.";
const RESPONSE_ID = "chatcmpl-live-prompt-observability";
const PROVIDER_USAGE = {
  prompt_tokens: 82_000,
  completion_tokens: 400,
  total_tokens: 82_400,
  prompt_tokens_details: {
    cached_tokens: 2_000,
    cache_write_tokens: 1_000,
  },
} as const;
const NORMALIZED_USAGE = {
  input: 80_000,
  output: 400,
  cacheRead: 1_000,
  cacheWrite: 1_000,
  totalTokens: 82_400,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
} as const;
const FINAL_MARKDOWN = [
  "## Live observability report",
  "",
  "- The prompt reached the provider.",
  "- Usage settled in product state.",
  "",
  "```ts",
  'const observed = "runtime";',
  "console.log(observed);",
  "```",
  "",
  "Inline math: $E = mc^2$.",
  "",
  "$$",
  "\\sum_{i=1}^{3} i = 6",
  "$$",
  "",
  "```mermaid",
  "flowchart LR",
  "  Prompt --> Runtime",
  "  Runtime --> UI",
  "```",
].join("\n");

type BridgeTranscriptMessage = {
  role: "user" | "assistant";
  status?: string;
  stopReason?: string | null;
  message?: { text?: string };
  content?: Array<Record<string, unknown>>;
  usage?: typeof NORMALIZED_USAGE | null;
};

type BridgeSurface = {
  summary: {
    title: string;
    status: string;
    activeTurnId: string | null;
    queuedCount: number;
  };
  transcript: {
    surfaceStatus: string;
    promptLock: {
      activeTurnId: string | null;
      queuedCount: number;
    };
    messages: BridgeTranscriptMessage[];
    activeAssistantMessage: unknown | null;
  };
  queuedMessages: {
    queuedMessages: unknown[];
  };
};

type PromptHistoryNamespace = {
  status: "ready" | "unavailable" | "error";
  value: {
    entries: Array<{ text: string }>;
  } | null;
};

type BridgeSessions = {
  summaries: Array<{
    title: string;
    titleGeneration: {
      status: string;
      renameLocked: boolean;
      finishedAt: string | null;
      error: string | null;
    };
  }>;
};

beforeAll(async () => {
  await ensureBuilt();
});

test("projects a real streamed response, generates its title concurrently, and recalls the prompt durably", async () => {
  const responseSplit = FINAL_MARKDOWN.indexOf("Inline math:");
  const richContentGate = createLiveProviderEventGate();
  const finishGate = createLiveProviderEventGate();
  const provider = startLiveProviderStub({
    apiKey: API_KEY,
    steps: [
      {
        label: "stream rich Markdown with explicit usage",
        matchesRequest: (request) => (request.body.tools?.length ?? 0) > 0,
        assertRequest: assertProviderRequest,
        events: [
          chatCompletionChunk({
            id: RESPONSE_ID,
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: FINAL_MARKDOWN.slice(0, responseSplit),
                },
                finish_reason: null,
              },
            ],
          }),
          {
            event: chatCompletionChunk({
              id: RESPONSE_ID,
              model: MODEL,
              choices: [
                {
                  index: 0,
                  delta: {
                    content: FINAL_MARKDOWN.slice(responseSplit),
                  },
                  finish_reason: null,
                },
              ],
            }),
            waitFor: richContentGate.wait,
          },
          {
            event: chatCompletionChunk({
              id: RESPONSE_ID,
              model: MODEL,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            }),
            waitFor: finishGate.wait,
          },
          {
            ...chatCompletionChunk({ id: RESPONSE_ID, model: MODEL, choices: [] }),
            usage: PROVIDER_USAGE,
          },
        ],
      },
      {
        label: "generate the durable first-turn session title",
        matchesRequest: (request) => (request.body.tools?.length ?? 0) === 0,
        assertRequest: assertTitleProviderRequest,
        events: [
          chatCompletionChunk({
            id: "chatcmpl-live-title-generation",
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: SESSION_TITLE },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: "chatcmpl-live-title-generation",
            model: MODEL,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
          {
            ...chatCompletionChunk({
              id: "chatcmpl-live-title-generation",
              model: MODEL,
              choices: [],
            }),
            usage: {
              prompt_tokens: 32,
              completion_tokens: 4,
              total_tokens: 36,
            },
          },
        ],
      },
    ],
  });
  const homeDir = await createHomeDir("svvy-live-prompt-observability-");
  let configured = false;

  try {
    await withSvvyApp(
      {
        homeDir,
        env: {
          ANTHROPIC_API_KEY: "",
          OPENAI_API_KEY: "",
          ZAI_API_KEY: API_KEY,
        },
        beforeLaunch: async ({ homeDir: launchHomeDir }) => {
          if (configured) return;
          configured = true;
          await writeAgentModelsConfig(launchHomeDir, {
            providers: {
              zai: {
                baseUrl: provider.baseUrl,
              },
            },
          });
          await Bun.write(
            join(getTestAgentDir(launchHomeDir), "agent-settings.json"),
            `${JSON.stringify(
              {
                ...DEFAULT_AGENT_SETTINGS_STATE,
                agents: {
                  ...DEFAULT_AGENT_SETTINGS_STATE.agents,
                  titleNamer: {
                    ...DEFAULT_AGENT_SETTINGS_STATE.agents.titleNamer,
                    provider: "zai",
                    model: MODEL,
                  },
                },
              },
              null,
              2,
            )}\n`,
          );
        },
      },
      async ({ driver, page }) => {
        try {
          await createSession(page);
          const composer = page.getByRole("group", { name: "Message composer" }).first();
          await composer.waitFor({ state: "visible" });
          const textarea = composer.locator(`textarea[placeholder="${COMPOSER_PLACEHOLDER}"]`);
          await textarea.fill(USER_PROMPT);
          await composer.getByRole("button", { name: "Send" }).click();

          await provider.waitForRequestCount(2);
          await assertVariableHeightStreamingAnchor(page, richContentGate.release);
          finishGate.release();
          provider.assertHealthy();
          await page
            .locator(`button.session-main[aria-label="${SESSION_TITLE}"]`)
            .waitFor({ state: "visible" });
          await assertSettledDom(page);
          await assertSettledBridgeState(driver);
          await assertGeneratedSessionTitle(driver);
          await assertPromptHistoryState(driver);
        } finally {
          richContentGate.release();
          finishGate.release();
        }
      },
    );

    expect(provider.requests).toHaveLength(2);

    await withSvvyApp(
      {
        homeDir,
        env: {
          ANTHROPIC_API_KEY: "",
          OPENAI_API_KEY: "",
          ZAI_API_KEY: API_KEY,
        },
        beforeLaunch: async () => {},
      },
      async ({ driver, page }) => {
        await openPersistedSession(page);
        await assertSettledDom(page);
        await assertSettledBridgeState(driver);
        await assertGeneratedSessionTitle(driver);
        await assertPromptHistoryState(driver);

        const composer = page.getByRole("group", { name: "Message composer" }).first();
        await composer.waitFor({ state: "visible" });
        const textarea = composer.locator(`textarea[placeholder="${COMPOSER_PLACEHOLDER}"]`);
        const initialComposer = await textarea.resolve();
        expect(initialComposer.first?.value).toBe("");
        expect(initialComposer.first?.selectionStart).toBe(0);
        expect(initialComposer.first?.selectionEnd).toBe(0);

        await textarea.focus();
        await textarea.press("ArrowUp");

        const recalledComposer = await textarea.resolve();
        expect(recalledComposer.first?.value).toBe(USER_PROMPT);
        expect(recalledComposer.first?.selectionStart).toBe(USER_PROMPT.length);
        expect(recalledComposer.first?.selectionEnd).toBe(USER_PROMPT.length);
        expect(provider.requests).toHaveLength(2);
      },
    );

    provider.assertHealthy();
  } finally {
    richContentGate.release();
    finishGate.release();
    provider.stop();
    await rm(homeDir, { force: true, recursive: true });
  }
});

async function assertVariableHeightStreamingAnchor(
  page: SvvyApp["page"],
  releaseRichContent: () => void,
): Promise<void> {
  const scroller = page.locator(".chat-transcript").first();
  const streamingRow = page.locator(".assistant-row.streaming-row").first();
  await streamingRow.locator("h2").waitFor({ state: "visible" });
  const initialBottomOffset = await visibleBottomOffset(scroller, streamingRow);

  releaseRichContent();
  await streamingRow.locator(".mermaid-rendered svg").waitFor({ state: "visible" });
  expect(await page.locator(".assistant-row.streaming-row").count()).toBe(1);
  const expandedBottomOffset = await waitForVisibleBottomOffsetWithin(
    scroller,
    streamingRow,
    TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX,
  );

  expect(initialBottomOffset).toBeGreaterThan(TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX);
  expect(Math.abs(expandedBottomOffset)).toBeLessThanOrEqual(
    TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX,
  );
}

async function waitForVisibleBottomOffsetWithin(
  scroller: Locator,
  row: Locator,
  maximumOffset: number,
): Promise<number> {
  const deadline = Date.now() + 2_000;
  let offset = await visibleBottomOffset(scroller, row);
  while (Math.abs(offset) > maximumOffset && Date.now() < deadline) {
    await Bun.sleep(16);
    offset = await visibleBottomOffset(scroller, row);
  }
  return offset;
}

async function visibleBottomOffset(scroller: Locator, row: Locator): Promise<number> {
  const [scrollerBox, rowBox] = await Promise.all([scroller.boundingBox(), row.boundingBox()]);
  if (!scrollerBox || !rowBox) {
    throw new Error("The active transcript row was not measurable inside its scroll viewport.");
  }
  return scrollerBox.y + scrollerBox.height - (rowBox.y + rowBox.height);
}

function assertProviderRequest(request: CapturedLiveProviderRequest): void {
  expect(request.method).toBe("POST");
  expect(request.path).toBe("/api/coding/paas/v4/chat/completions");
  expect(request.body.model).toBe(MODEL);
  expect(request.body.stream).toBe(true);
  assertJsonEqual(request.body.stream_options, { include_usage: true });
  expect(latestUserText(request.body.messages)).toBe(USER_PROMPT);

  const systemMessage = request.body.messages.find((message) => message.role === "system");
  assertCondition(Boolean(systemMessage), "The provider request did not contain a system message.");
  assertCondition(
    messageText(systemMessage!).trim().length > 0,
    "The provider request contained an empty system message.",
  );
}

function assertTitleProviderRequest(request: CapturedLiveProviderRequest): void {
  expect(request.method).toBe("POST");
  expect(request.path).toBe("/api/coding/paas/v4/chat/completions");
  expect(request.body.model).toBe(MODEL);
  expect(request.body.stream).toBe(true);
  expect(request.body.tools?.length ?? 0).toBe(0);
  expect(
    latestUserText(request.body.messages).endsWith(`First user message:\n\n${USER_PROMPT}`),
  ).toBe(true);
}

async function createSession(page: SvvyApp["page"]): Promise<void> {
  const create = page
    .getByRole("button", { name: "Create a new orchestrator" })
    .filter({ visible: true });
  await create.waitFor({ state: "visible" });
  await create.click();

  const session = page.locator('button.session-main[aria-label="New orchestrator"]');
  await session.waitFor({ state: "visible" });
}

async function openPersistedSession(page: SvvyApp["page"]): Promise<void> {
  const session = page.locator(`button.session-main[aria-label="${SESSION_TITLE}"]`);
  await session.waitFor({ state: "visible" });
  await session.click();
}

async function assertSettledDom(page: SvvyApp["page"]): Promise<void> {
  await page.getByText(/^Usage settled in product state\.$/).waitFor({
    state: "visible",
  });
  const composer = page.getByRole("group", { name: "Message composer" }).first();
  await composer.getByRole("button", { name: "Send" }).waitFor({ state: "visible" });

  const assistantRow = page.locator(".assistant-row").first();
  await assistantRow.waitFor({ state: "visible" });
  const heading = assistantRow.locator("h2");
  await heading.waitFor({ state: "visible" });
  expect((await heading.textContent())?.trim()).toBe("Live observability report");
  expect(await assistantRow.locator("ul li").count()).toBe(2);
  expect((await assistantRow.locator("ul").textContent())?.replace(/\s+/g, " ").trim()).toBe(
    "The prompt reached the provider. Usage settled in product state.",
  );

  const codeBlock = assistantRow.locator('.code-block-frame[data-language="typescript"]');
  await codeBlock.waitFor({ state: "visible" });
  expect((await codeBlock.textContent()) ?? "").toContain('const observed = "runtime";');
  await codeBlock.getByRole("button", { name: "Copy code" }).waitFor({ state: "visible" });

  expect(await assistantRow.locator(".katex").count()).toBeGreaterThanOrEqual(2);
  await assistantRow.locator(".katex-display").waitFor({ state: "visible" });
  await assistantRow.locator(".mermaid-rendered svg").waitFor({ state: "visible" });
  expect(await page.locator(".assistant-row.streaming-row").count()).toBe(0);
  expect((await assistantRow.locator("small").textContent())?.trim()).toBe("zai · glm-5-turbo");

  const messageBudget = assistantRow.locator(
    '[data-testid="context-budget-inline"][aria-valuenow="41"].tone-orange',
  );
  await messageBudget.waitFor({ state: "visible" });
  expect(await messageBudget.locator(".context-budget-compact-label").textContent()).toBe("41%");

  const composerBudget = composer.locator(
    '[data-testid="context-budget-full"][aria-valuenow="41"].tone-orange',
  );
  await composerBudget.waitFor({ state: "visible" });
}

async function assertSettledBridgeState(driver: SvvyApp["driver"]): Promise<void> {
  const surfaces = bridgeStateValue<{ items: BridgeSurface[] }>(await driver.stateGet("surfaces"));
  const surface = surfaces.items.find((candidate) => candidate.summary.title === SESSION_TITLE);
  assertCondition(Boolean(surface), `Missing bridge surface ${SESSION_TITLE}.`);
  expect(surface!.summary).toMatchObject({
    status: "idle",
    activeTurnId: null,
    queuedCount: 0,
  });
  expect(surface!.transcript).toMatchObject({
    surfaceStatus: "idle",
    promptLock: {
      activeTurnId: null,
      queuedCount: 0,
    },
    activeAssistantMessage: null,
  });
  expect(surface!.queuedMessages.queuedMessages).toEqual([]);

  const messages = surface!.transcript.messages;
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({
    role: "user",
    message: { text: USER_PROMPT },
  });
  expect(messages[1]).toMatchObject({
    role: "assistant",
    status: "completed",
    stopReason: "stop",
    usage: NORMALIZED_USAGE,
  });
  expect(
    messages[1]?.content
      ?.filter((block) => block.kind === "text")
      .map((block) => String(block.text ?? ""))
      .join(""),
  ).toBe(FINAL_MARKDOWN);
}

async function assertPromptHistoryState(driver: SvvyApp["driver"]): Promise<void> {
  const history = bridgeStateValue<PromptHistoryNamespace>(await driver.stateGet("promptHistory"));
  expect(history.status).toBe("ready");
  assertCondition(history.value !== null, "Prompt history was not available for the workspace.");
  expect(history.value.entries.map((entry) => entry.text)).toEqual([USER_PROMPT]);
}

async function assertGeneratedSessionTitle(driver: SvvyApp["driver"]): Promise<void> {
  const sessions = bridgeStateValue<BridgeSessions>(await driver.stateGet("sessions"));
  const session = sessions.summaries.find((candidate) => candidate.title === SESSION_TITLE);
  assertCondition(Boolean(session), `Missing generated session title ${SESSION_TITLE}.`);
  expect(session!.titleGeneration).toMatchObject({
    status: "completed",
    renameLocked: false,
    error: null,
  });
  expect(typeof session!.titleGeneration.finishedAt).toBe("string");
}

function bridgeStateValue<T>(state: { value: unknown }): T {
  return state.value as T;
}

function latestUserText(messages: Array<Record<string, unknown>>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return messageText(message);
  }
  return "";
}

function messageText(message: Record<string, unknown>): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object" || Array.isArray(part)) return "";
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function assertJsonEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assertCondition(
    actualJson === expectedJson,
    `JSON mismatch.\nExpected: ${expectedJson}\nReceived: ${actualJson}`,
  );
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
