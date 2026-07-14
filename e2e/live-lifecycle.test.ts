import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import {
  chatCompletionChunk,
  startLiveProviderStub,
  type CapturedLiveProviderRequest,
  type LiveChatCompletionRequest,
} from "./live-provider-stub";
import { writeAgentModelsConfig } from "./support";

setDefaultTimeout(120_000);

const API_KEY = "svvy-live-lifecycle-key";
const MODEL = "glm-5-turbo";
const SESSION_TITLE = "Live request input";
const USER_PROMPT = "Run the live request-input lifecycle.";
const TOOL_CALL_ID = "call_live_request_input_001";
const FINAL_TEXT = "Lifecycle complete: Safe";
const COMPOSER_PLACEHOLDER = "Ask svvy to inspect the repo, make a change, or delegate work.";
const NONBLOCKING_VARIANT_GUIDANCE = [
  "Use `request_user_input` only for user decisions that could materially steer the work and where you can choose a conservative default now.",
  "Continue with the returned answer. If a later `request_user_input.answer` message arrives, treat it as a normal queued answer follow-up and reassess only if it materially changes the work.",
] as const;
const BLOCKING_VARIANT_GUIDANCE =
  "Use `request_user_input` only when the answer is required before proceeding safely.";

const REQUEST_INPUT_ARGUMENTS = {
  questions: [
    {
      title: "Lifecycle check",
      question: "Choose verification mode.",
      options: [
        {
          label: "Safe",
          description: "Use the deterministic default.",
          recommended: true,
        },
        {
          label: "Manual",
          description: "Use explicit user input.",
        },
      ],
    },
  ],
} as const;

const REQUEST_INPUT_RESULT = {
  answers: [
    {
      title: "Lifecycle check",
      question: "Choose verification mode.",
      answer: {
        kind: "option",
        label: "Safe",
        text: "Safe",
      },
      answeredBy: "default",
    },
  ],
} as const;

type BridgeCommandRollup = {
  commandId: string;
  toolName: string;
  status: string;
  title: string;
  summary: string;
  arguments: unknown;
  facts: Record<string, unknown> | null;
  argumentSnapshots: Array<{
    source: string;
    arguments: unknown;
  }>;
  progressEvents?: Array<{
    source: string;
    phase?: string;
    message?: string;
    facts?: Record<string, unknown>;
  }>;
};

type BridgeSessionSummary = {
  id: string;
  title: string;
  status: string;
  commandRollups?: BridgeCommandRollup[];
};

type BridgeTranscriptMessage = {
  role: "user" | "assistant";
  status?: string;
  stopReason?: string | null;
  message?: { text?: string };
  content?: Array<Record<string, unknown>>;
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

beforeAll(async () => {
  await ensureBuilt();
});

test("drives and restores a real nonblocking request_user_input lifecycle", async () => {
  const serializedArguments = JSON.stringify(REQUEST_INPUT_ARGUMENTS);
  const argumentSplit = Math.floor(serializedArguments.length / 2);
  const firstArgumentsChunk = serializedArguments.slice(0, argumentSplit);
  const secondArgumentsChunk = serializedArguments.slice(argumentSplit);

  const provider = startLiveProviderStub({
    apiKey: API_KEY,
    steps: [
      {
        label: "stream split request_user_input call",
        matchesRequest: (request) => !hasToolResult(request, TOOL_CALL_ID),
        assertRequest: assertInitialProviderRequest,
        events: [
          chatCompletionChunk({
            id: "chatcmpl-live-request-input-tool",
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: TOOL_CALL_ID,
                      type: "function",
                      function: {
                        name: "request_user_input",
                        arguments: firstArgumentsChunk,
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: "chatcmpl-live-request-input-tool",
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        arguments: secondArgumentsChunk,
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: "chatcmpl-live-request-input-tool",
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "tool_calls",
              },
            ],
          }),
        ],
      },
      {
        label: "receive exact tool result and stream final answer",
        matchesRequest: (request) => hasToolResult(request, TOOL_CALL_ID),
        assertRequest: assertFollowupProviderRequest,
        events: [
          chatCompletionChunk({
            id: "chatcmpl-live-request-input-final",
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: "Lifecycle complete: ",
                },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: "chatcmpl-live-request-input-final",
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: {
                  content: "Safe",
                },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: "chatcmpl-live-request-input-final",
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
          }),
        ],
      },
    ],
  });
  const homeDir = await createHomeDir("svvy-live-request-input-");
  let configured = false;
  let persistedCommandId = "";

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
        },
      },
      async ({ driver, page }) => {
        await createAndRenameSession(page);
        const composer = page.getByRole("group", { name: "Message composer" }).first();
        await composer.waitFor({ state: "visible" });
        const textarea = composer.locator(`textarea[placeholder="${COMPOSER_PLACEHOLDER}"]`);
        await textarea.fill(USER_PROMPT);
        await composer.getByRole("button", { name: "Send" }).click();

        await provider.waitForRequestCount(2);
        provider.assertHealthy();
        await assertLiveRequestInputDom(page);
        persistedCommandId = await assertSettledBridgeState(driver);
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
        await assertLiveRequestInputDom(page);
        expect(await assertSettledBridgeState(driver)).toBe(persistedCommandId);
        expect(provider.requests).toHaveLength(2);
      },
    );

    provider.assertHealthy();
  } finally {
    provider.stop();
    await rm(homeDir, { force: true, recursive: true });
  }
});

function assertInitialProviderRequest(request: CapturedLiveProviderRequest): void {
  assertBaseProviderRequest(request);
  assertCondition(
    latestUserText(request.body.messages) === USER_PROMPT,
    "The first provider request did not contain the composer prompt.",
  );

  const tool = findToolDeclaration(request.body, "request_user_input");
  const functionDefinition = recordValue(tool.function, "request_user_input function");
  const parameters = recordValue(functionDefinition.parameters, "request_user_input parameters");
  const properties = recordValue(parameters.properties, "request_user_input properties");
  const questions = recordValue(properties.questions, "request_user_input questions schema");
  assertCondition(
    questions.minItems === 1,
    "request_user_input must require at least one question.",
  );
  assertCondition(
    questions.maxItems === 3,
    "request_user_input must allow at most three questions.",
  );
}

function assertFollowupProviderRequest(request: CapturedLiveProviderRequest): void {
  assertBaseProviderRequest(request);
  const assistantMessages = request.body.messages.filter((message) => message.role === "assistant");
  const toolMessages = request.body.messages.filter((message) => message.role === "tool");
  assertCondition(
    assistantMessages.length === 1,
    `Expected one assistant tool-call message, received ${assistantMessages.length}.`,
  );
  assertCondition(
    toolMessages.length === 1,
    `Expected one tool-result message, received ${toolMessages.length}.`,
  );

  assertJsonEqual(assistantMessages[0]?.tool_calls, [
    {
      id: TOOL_CALL_ID,
      type: "function",
      function: {
        name: "request_user_input",
        arguments: JSON.stringify(REQUEST_INPUT_ARGUMENTS),
      },
    },
  ]);
  assertJsonEqual(toolMessages[0], {
    role: "tool",
    content: JSON.stringify(REQUEST_INPUT_RESULT),
    tool_call_id: TOOL_CALL_ID,
  });
}

function assertBaseProviderRequest(request: CapturedLiveProviderRequest): void {
  assertCondition(request.method === "POST", "Provider request must use POST.");
  assertCondition(
    request.path === "/api/coding/paas/v4/chat/completions",
    `Unexpected provider path ${request.path}.`,
  );
  assertCondition(request.body.model === MODEL, `Unexpected model ${request.body.model}.`);
  assertCondition(request.body.stream === true, "Provider request must enable streaming.");
  assertJsonEqual(request.body.stream_options, { include_usage: true });
  assertCondition(request.body.tool_stream === true, "ZAI tool streaming must be enabled.");
  const systemMessage = request.body.messages.find((message) => message.role === "system");
  assertCondition(
    typeof systemMessage?.content === "string" && systemMessage.content.length > 0,
    "Provider request must carry the real generated system prompt.",
  );
  for (const instruction of NONBLOCKING_VARIANT_GUIDANCE) {
    assertCondition(
      systemMessage.content.includes(instruction),
      `Generated system prompt is missing nonblocking request-input guidance: ${instruction}`,
    );
  }
  assertCondition(
    !systemMessage.content.includes(BLOCKING_VARIANT_GUIDANCE),
    "Generated system prompt mixed blocking request-input guidance into the nonblocking variant.",
  );
  findToolDeclaration(request.body, "request_user_input");
}

function findToolDeclaration(
  request: LiveChatCompletionRequest,
  toolName: string,
): Record<string, unknown> {
  const declaration = request.tools?.find((candidate) => {
    const functionDefinition = candidate.function;
    return (
      candidate.type === "function" &&
      Boolean(functionDefinition) &&
      typeof functionDefinition === "object" &&
      !Array.isArray(functionDefinition) &&
      (functionDefinition as Record<string, unknown>).name === toolName
    );
  });
  return recordValue(declaration, `${toolName} declaration`);
}

function hasToolResult(request: CapturedLiveProviderRequest, toolCallId: string): boolean {
  return request.body.messages.some(
    (message) => message.role === "tool" && message.tool_call_id === toolCallId,
  );
}

async function createAndRenameSession(page: SvvyApp["page"]): Promise<void> {
  const create = page
    .getByRole("button", { name: "Create a new orchestrator" })
    .filter({ visible: true });
  await create.waitFor({ state: "visible" });
  await create.click();

  const session = page.locator('button.session-main[aria-label="New orchestrator"]');
  await session.waitFor({ state: "visible" });
  await session.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Session actions for New orchestrator" });
  await menu.waitFor({ state: "visible" });
  await menu.getByRole("menuitem", { name: "Rename" }).click();

  const dialog = page.getByRole("dialog", { name: "Rename Session" });
  await dialog.waitFor({ state: "visible" });
  await dialog.locator('input[placeholder="Session title"]').fill(SESSION_TITLE);
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.waitFor({ state: "detached" });
  await page
    .locator(`button.session-main[aria-label="${SESSION_TITLE}"]`)
    .waitFor({ state: "visible" });
}

async function openPersistedSession(page: SvvyApp["page"]): Promise<void> {
  const session = page.locator(`button.session-main[aria-label="${SESSION_TITLE}"]`);
  await session.waitFor({ state: "visible" });
  await session.click();
}

async function assertLiveRequestInputDom(page: SvvyApp["page"]): Promise<void> {
  await page.getByText(/^Lifecycle complete: Safe$/).waitFor({ state: "visible" });
  await page
    .getByRole("group", { name: "Message composer" })
    .first()
    .getByRole("button", { name: "Send" })
    .waitFor({ state: "visible" });

  const toolCard = page.locator('[data-testid^="tool-card-"]').filter({
    has: page.getByText(/^Request User Input$/),
  });
  await toolCard.waitFor({ state: "visible" });
  await toolCard.locator('[data-testid="status-badge-done"]').waitFor({ state: "visible" });

  const panel = page.locator('aside[aria-label="Clarification requests"]');
  await panel.waitFor({ state: "visible" });
  const requestCard = panel.locator(".request-user-input-card").filter({
    has: page.getByText(/^Lifecycle check$/),
  });
  await requestCard.waitFor({ state: "visible" });
  await requestCard.getByText(/^Choose verification mode\.$/).waitFor({
    state: "visible",
  });
  const safeOption = requestCard.locator(".request-user-input-option").filter({
    has: page.getByText(/^Safe$/),
  });
  await safeOption.waitFor({ state: "visible" });
  expect((await safeOption.textContent())?.replace(/\s+/g, " ").trim()).toContain(
    "Safe Default Use the deterministic default.",
  );
  await requestCard.getByText(/^Manual$/).waitFor({ state: "visible" });
  await requestCard.getByText(/^Use explicit user input\.$/).waitFor({
    state: "visible",
  });
}

async function assertSettledBridgeState(driver: SvvyApp["driver"]): Promise<string> {
  const sessions = bridgeStateValue<{ summaries: BridgeSessionSummary[] }>(
    await driver.stateGet("sessions"),
  );
  const session = sessions.summaries.find((candidate) => candidate.title === SESSION_TITLE);
  assertCondition(Boolean(session), `Missing bridge session ${SESSION_TITLE}.`);
  expect(session!.status).toBe("idle");

  const commands = (session!.commandRollups ?? []).filter(
    (command) => command.toolName === "request_user_input",
  );
  expect(commands).toHaveLength(1);
  const command = commands[0]!;
  expect(command).toMatchObject({
    toolName: "request_user_input",
    status: "succeeded",
    title: "request_user_input",
    summary: "Defaulted answer for Lifecycle check.",
    arguments: REQUEST_INPUT_ARGUMENTS,
    facts: {
      questionCount: 1,
      answeredBy: "default",
      result: REQUEST_INPUT_RESULT,
    },
  });

  expect(command.argumentSnapshots).toHaveLength(2);
  const streamedArguments = recordValue(
    command.argumentSnapshots[0]?.arguments,
    "partial command argument snapshot",
  );
  const serializedArguments = JSON.stringify(REQUEST_INPUT_ARGUMENTS);
  expect(command.argumentSnapshots[0]?.source).toBe("pi-tool-call");
  expect(streamedArguments.toolCallId).toBe(TOOL_CALL_ID);
  expect(streamedArguments.contentIndex).toBe(0);
  expect(streamedArguments.argumentsJson).toBe(
    serializedArguments.slice(0, Math.floor(serializedArguments.length / 2)),
  );
  const acceptedArguments = recordValue(
    command.argumentSnapshots.at(-1)?.arguments,
    "final command argument snapshot",
  );
  expect(command.argumentSnapshots.at(-1)?.source).toBe("pi-tool-call");
  expect(acceptedArguments.toolCallId).toBe(TOOL_CALL_ID);
  expect(acceptedArguments.contentIndex).toBe(0);
  expect(JSON.parse(String(acceptedArguments.argumentsJson))).toEqual(REQUEST_INPUT_ARGUMENTS);

  const requestProgress = (command.progressEvents ?? []).filter(
    (event) => event.source === "request_user_input",
  );
  expect(requestProgress).toHaveLength(1);
  expect(requestProgress[0]).toMatchObject({
    source: "request_user_input",
    phase: "created",
    message: "Created 1 user-input question.",
    facts: {
      variant: "nonblocking",
      questionCount: 1,
    },
  });
  expect(typeof requestProgress[0]?.facts?.requestId).toBe("string");

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
  expect(messages).toHaveLength(3);
  expect(messages[0]).toMatchObject({
    role: "user",
    message: { text: USER_PROMPT },
  });
  expect(messages[1]).toMatchObject({
    role: "assistant",
    status: "completed",
    stopReason: "toolUse",
  });
  const toolCall = messages[1]?.content?.find((block) => block.kind === "tool-call");
  expect(toolCall).toMatchObject({
    kind: "tool-call",
    contentIndex: 0,
    toolCallId: TOOL_CALL_ID,
    toolName: "request_user_input",
    argumentsJson: JSON.stringify(REQUEST_INPUT_ARGUMENTS),
    argumentsStatus: "accepted",
    commandId: command.commandId,
  });
  expect(messages[2]).toMatchObject({
    role: "assistant",
    status: "completed",
    stopReason: "stop",
  });
  expect(
    messages[2]?.content
      ?.filter((block) => block.kind === "text")
      .map((block) => String(block.text ?? ""))
      .join(""),
  ).toBe(FINAL_TEXT);

  return command.commandId;
}

function bridgeStateValue<T>(state: { value: unknown }): T {
  return state.value as T;
}

function latestUserText(messages: Array<Record<string, unknown>>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
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
  return "";
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  assertCondition(
    Boolean(value) && typeof value === "object" && !Array.isArray(value),
    `Expected ${label} to be an object.`,
  );
  return value as Record<string, unknown>;
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
