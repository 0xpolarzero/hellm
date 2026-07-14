import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import type { AppLogEntry, AppLogReadModel } from "@svvy/core";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import {
  chatCompletionChunk,
  startLiveProviderStub,
  type CapturedLiveProviderRequest,
  type LiveChatCompletionRequest,
} from "./live-provider-stub";
import { writeAgentModelsConfig } from "./support";

setDefaultTimeout(120_000);

const API_KEY = "svvy-live-artifact-logs-key";
const MODEL = "glm-5-turbo";
const SESSION_TITLE = "Live artifact logs";
const USER_PROMPT = "Create and inspect the durable live artifact, then verify one failure.";
const TOOL_CALL_ID = "call_live_artifact_logs_001";
const ARTIFACT_NAME = "live-artifact.md";
const MISSING_ARTIFACT_ID = "artifact-live-missing";
const FINAL_TEXT = "Artifact lifecycle and correlated failure complete.";
const COMPOSER_PLACEHOLDER = "Ask svvy to inspect the repo, make a change, or delegate work.";
const UI_TIMEOUT = 15_000;

const TYPESCRIPT_CODE = [
  `const created = await extensions.artifacts.run("create", { options: { name: "${ARTIFACT_NAME}" } });`,
  'const inspected = await extensions.artifacts.run("inspect", { options: { id: created.data.id } });',
  'const opened = await extensions.artifacts.run("open", { options: { id: created.data.id } });',
  'let missingError = "";',
  "try {",
  `  await extensions.artifacts.run("inspect", { options: { id: "${MISSING_ARTIFACT_ID}" } });`,
  "} catch (error) {",
  "  missingError = error instanceof Error ? error.message : String(error);",
  "}",
  "return {",
  "  createdId: created.data.id,",
  "  inspectedName: inspected.data.name,",
  "  openedIntent: opened.data.intent,",
  "  openAccepted: opened.data.accepted,",
  "  missingError,",
  "};",
].join("\n");

type BridgeCommandRollup = {
  commandId: string;
  toolName: string;
  status: string;
  facts: Record<string, unknown> | null;
  childCount: number;
  summaryChildCount: number;
  traceChildCount: number;
  summaryChildren: Array<{
    commandId: string;
    toolName: string;
    status: string;
    summary: string;
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
  };
  transcript: {
    messages: BridgeTranscriptMessage[];
    activeAssistantMessage: unknown | null;
  };
};

type PersistedLifecycle = {
  artifactId: string;
  artifactCommandId: string;
  failureCommandId: string;
  parentCommandId: string;
  sessionId: string;
};

beforeAll(async () => {
  await ensureBuilt();
});

test("persists a live artifact lifecycle and its correlated app logs across relaunch", async () => {
  const provider = startLiveProviderStub({
    apiKey: API_KEY,
    steps: [
      {
        label: "run the generated Artifacts facade",
        matchesRequest: (request) => !hasToolResult(request, TOOL_CALL_ID),
        assertRequest: assertInitialProviderRequest,
        events: [
          chatCompletionChunk({
            id: "chatcmpl-live-artifact-tool",
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
                        name: "execute_typescript",
                        arguments: JSON.stringify({ typescriptCode: TYPESCRIPT_CODE }),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: "chatcmpl-live-artifact-tool",
            model: MODEL,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          }),
        ],
      },
      {
        label: "receive the artifact result and finish",
        matchesRequest: (request) => hasToolResult(request, TOOL_CALL_ID),
        assertRequest: assertFollowupProviderRequest,
        events: [
          chatCompletionChunk({
            id: "chatcmpl-live-artifact-final",
            model: MODEL,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: FINAL_TEXT },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: "chatcmpl-live-artifact-final",
            model: MODEL,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
        ],
      },
    ],
  });
  const homeDir = await createHomeDir("svvy-live-artifact-logs-");
  let configured = false;
  let persisted: PersistedLifecycle | null = null;

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
        await enableFullAccessForIsolatedLinuxLane(page);
        await createAndRenameSession(page);
        const appLogsSince = new Date(Date.now() - 1_000).toISOString();
        const composer = page.getByRole("group", { name: "Message composer" }).first();
        await composer.waitFor({ state: "visible" });
        await composer.locator(`textarea[placeholder="${COMPOSER_PLACEHOLDER}"]`).fill(USER_PROMPT);
        await composer.getByRole("button", { name: "Send" }).click();

        await provider.waitForRequestCount(2);
        provider.assertHealthy();
        await openPersistedSession(page);
        await page.getByText(/^Artifact lifecycle and correlated failure complete\.$/).waitFor({
          state: "visible",
          timeout: UI_TIMEOUT,
        });

        persisted = await assertSettledLifecycle(driver);
        await assertAppLogsInvalidation(driver, appLogsSince);
        await page
          .getByRole("button", { name: "Open app logs: 1 warnings unread" })
          .waitFor({ state: "visible", timeout: UI_TIMEOUT });
        await page.getByRole("button", { name: "Open app logs: 1 warnings unread" }).click();

        const logsPane = page.locator(".app-logs-pane");
        await logsPane.waitFor({ state: "visible", timeout: UI_TIMEOUT });
        await assertAppLogsUi(logsPane, persisted);
        await openArtifactFromCreateLog(logsPane, persisted);
        await assertArtifactInspector(page, persisted.artifactId);
      },
    );

    assertCondition(persisted !== null, "The first launch did not capture the artifact lifecycle.");
    const expectedPersisted = persisted;
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
        const restored = await assertSettledLifecycle(driver);
        expect(restored).toEqual(expectedPersisted);
        expect(provider.requests).toHaveLength(2);

        const logsPane = page.locator(".app-logs-pane");
        await logsPane.waitFor({ state: "visible", timeout: UI_TIMEOUT });
        await assertAppLogsUi(logsPane, restored);
        await assertArtifactInspector(page, restored.artifactId);
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
    "The first provider request did not contain the artifact prompt.",
  );

  const tool = findToolDeclaration(request.body, "execute_typescript");
  const functionDefinition = recordValue(tool.function, "execute_typescript function");
  const parameters = recordValue(functionDefinition.parameters, "execute_typescript parameters");
  const properties = recordValue(parameters.properties, "execute_typescript properties");
  expect(recordValue(properties.typescriptCode, "typescriptCode schema")).toMatchObject({
    type: "string",
    minLength: 1,
  });
}

function assertFollowupProviderRequest(request: CapturedLiveProviderRequest): void {
  assertBaseProviderRequest(request);
  const assistantMessages = request.body.messages.filter((message) => message.role === "assistant");
  const toolMessages = request.body.messages.filter((message) => message.role === "tool");
  expect(assistantMessages).toHaveLength(1);
  expect(toolMessages).toHaveLength(1);
  expect(assistantMessages[0]?.tool_calls).toEqual([
    {
      id: TOOL_CALL_ID,
      type: "function",
      function: {
        name: "execute_typescript",
        arguments: JSON.stringify({ typescriptCode: TYPESCRIPT_CODE }),
      },
    },
  ]);

  const toolMessage = toolMessages[0]!;
  expect(toolMessage.tool_call_id).toBe(TOOL_CALL_ID);
  assertCondition(typeof toolMessage.content === "string", "Expected a text tool result.");
  const toolResult = recordValue(JSON.parse(toolMessage.content), "execute_typescript result");
  expect(toolResult.success).toBe(true);
  const result = recordValue(toolResult.result, "execute_typescript return value");
  expect(result).toMatchObject({
    inspectedName: ARTIFACT_NAME,
    openedIntent: "open_artifact_inspector",
    openAccepted: true,
  });
  assertCondition(
    typeof result.createdId === "string" && result.createdId.length > 0,
    "The Artifacts facade did not return a durable artifact id.",
  );
  assertCondition(
    typeof result.missingError === "string" && result.missingError.includes(MISSING_ARTIFACT_ID),
    "The missing-artifact operation did not fail through the public client boundary.",
  );
}

function assertBaseProviderRequest(request: CapturedLiveProviderRequest): void {
  expect(request.method).toBe("POST");
  expect(request.path).toBe("/api/coding/paas/v4/chat/completions");
  expect(request.body.model).toBe(MODEL);
  expect(request.body.stream).toBe(true);
  expect(request.body.stream_options).toEqual({ include_usage: true });
  expect(request.body.tool_stream).toBe(true);
  const systemMessage = request.body.messages.find((message) => message.role === "system");
  assertCondition(
    typeof systemMessage?.content === "string" && systemMessage.content.includes("svvyx artifacts"),
    "The live actor prompt did not include the generated Artifacts command contract.",
  );
  findToolDeclaration(request.body, "execute_typescript");
}

async function enableFullAccessForIsolatedLinuxLane(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).first().click();
  const settings = page.getByTestId("settings-pane");
  await settings.waitFor({ state: "visible" });
  await settings.getByText(/^Approval Mode$/).waitFor({ state: "visible" });

  const rows = settings.locator(".general-row");
  const rowCount = await rows.count();
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    if ((await row.locator(".provider-name").textContent())?.trim() !== "Approval Mode") continue;
    // The production sandbox helper is macOS-only. Full access uses the real launch-policy path
    // while the complete desktop journey remains isolated inside the OrbStack Linux machine.
    const approvalMode = row.locator("select");
    await approvalMode.selectOption("full-access");
    expect((await approvalMode.resolve()).first?.value).toBe("full-access");
    await row.getByText(/^full-access$/).waitFor({ state: "visible" });
    const saveChanges = settings.getByRole("button", { name: "Save Changes" });
    await saveChanges.focus();
    await saveChanges.click();
    await settings.getByText(/^Saved$/).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close pane" }).click();
    await settings.waitFor({ state: "detached" });
    return;
  }

  throw new Error("Could not find the Approval Mode settings row.");
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

async function assertSettledLifecycle(driver: SvvyApp["driver"]): Promise<PersistedLifecycle> {
  const sessions = bridgeStateValue<{ summaries: BridgeSessionSummary[] }>(
    await driver.stateGet("sessions"),
  );
  const session = sessions.summaries.find((candidate) => candidate.title === SESSION_TITLE);
  assertCondition(Boolean(session), `Missing bridge session ${SESSION_TITLE}.`);
  expect(session!.status).toBe("idle");

  const parentCommands = (session!.commandRollups ?? []).filter(
    (command) => command.toolName === "execute_typescript",
  );
  expect(parentCommands).toHaveLength(1);
  const parent = parentCommands[0]!;
  expect(parent).toMatchObject({
    status: "succeeded",
    childCount: 4,
    summaryChildCount: 2,
    traceChildCount: 2,
    facts: {
      childCommandCount: 4,
      failedChildCommandCount: 1,
    },
  });
  expect(parent.summaryChildren.map((child) => child.status)).toEqual(["succeeded", "succeeded"]);

  const surfaces = bridgeStateValue<{ items: BridgeSurface[] }>(await driver.stateGet("surfaces"));
  const surface = surfaces.items.find((candidate) => candidate.summary.title === SESSION_TITLE);
  assertCondition(Boolean(surface), `Missing bridge surface ${SESSION_TITLE}.`);
  expect(surface!.summary).toMatchObject({ status: "idle", activeTurnId: null });
  expect(surface!.transcript.activeAssistantMessage).toBeNull();
  expect(surface!.transcript.messages).toHaveLength(3);
  expect(surface!.transcript.messages[0]).toMatchObject({
    role: "user",
    message: { text: USER_PROMPT },
  });
  expect(surface!.transcript.messages[1]).toMatchObject({
    role: "assistant",
    status: "completed",
    stopReason: "toolUse",
  });
  expect(surface!.transcript.messages[2]).toMatchObject({
    role: "assistant",
    status: "completed",
    stopReason: "stop",
  });
  expect(
    surface!.transcript.messages[2]?.content
      ?.filter((block) => block.kind === "text")
      .map((block) => String(block.text ?? ""))
      .join(""),
  ).toBe(FINAL_TEXT);

  const logs = readyNamespaceValue<{ app: AppLogReadModel; workspace: AppLogReadModel | null }>(
    await driver.stateGet("appLogs"),
    "appLogs",
  );
  assertCondition(
    logs.workspace !== null,
    "The active workspace app-log read model is unavailable.",
  );
  const created = findArtifactLog(logs.workspace.entries, "Artifact Create succeeded.", "create");
  const inspected = findArtifactLog(
    logs.workspace.entries,
    "Artifact Inspect succeeded.",
    "inspect",
  );
  const opened = findArtifactLog(logs.workspace.entries, "Artifact Open succeeded.", "open");
  const failed = findArtifactLog(logs.workspace.entries, "Artifact Inspect failed.", "inspect");

  assertCondition(created.artifactId !== undefined, "The create log is missing its artifact id.");
  assertCondition(created.commandId !== undefined, "The create log is missing its command id.");
  assertCondition(failed.commandId !== undefined, "The failure log is missing its command id.");
  expect(created.details).toMatchObject({ artifactName: ARTIFACT_NAME });
  expect(inspected.artifactId).toBe(created.artifactId);
  expect(opened.artifactId).toBe(created.artifactId);
  expect(failed).toMatchObject({
    level: "warn",
    workspaceSessionId: session!.id,
    surfacePiSessionId: session!.id,
    artifactId: MISSING_ARTIFACT_ID,
    details: {
      artifactCommandId: "inspect",
      errorCode: "ARTIFACT_NOT_FOUND",
    },
  });
  for (const entry of [created, inspected, opened]) {
    expect(entry).toMatchObject({
      level: "info",
      workspaceSessionId: session!.id,
      surfacePiSessionId: session!.id,
      artifactId: created.artifactId,
    });
  }

  return {
    artifactId: created.artifactId,
    artifactCommandId: created.commandId,
    failureCommandId: failed.commandId,
    parentCommandId: parent.commandId,
    sessionId: session!.id,
  };
}

async function assertAppLogsInvalidation(driver: SvvyApp["driver"], since: string): Promise<void> {
  let sawAppLogsInvalidation = false;
  for await (const event of driver.eventsTail({
    follow: false,
    since,
    types: "workspace_read_model.changed",
  })) {
    const invalidation = event.payload?.invalidation;
    if (
      invalidation &&
      typeof invalidation === "object" &&
      "model" in invalidation &&
      invalidation.model === "appLogs"
    ) {
      sawAppLogsInvalidation = true;
    }
  }
  expect(sawAppLogsInvalidation).toBe(true);
}

async function assertAppLogsUi(
  logsPane: ReturnType<SvvyApp["page"]["locator"]>,
  persisted: PersistedLifecycle,
): Promise<void> {
  const search = logsPane.locator('input[aria-label="Search app logs"]');
  await search.fill(persisted.failureCommandId);
  const failureRow = logsPane.locator(".log-row-shell").filter({
    has: logsPane.getByText(/^Artifact Inspect failed\.$/),
  });
  await failureRow.waitFor({ state: "visible", timeout: UI_TIMEOUT });
  await failureRow
    .locator('button.shared-extension-disclosure[aria-label="Expand Artifact Inspect failed."]')
    .click();
  const failureText = (await failureRow.textContent()) ?? "";
  expect(failureText).toContain(persisted.failureCommandId);
  expect(failureText).toContain(MISSING_ARTIFACT_ID);
  expect(failureText).toContain("ARTIFACT_NOT_FOUND");
  expect(failureText).toContain(persisted.sessionId);

  await search.fill(persisted.artifactId);
  const createRow = logsPane.locator(".log-row-shell").filter({
    has: logsPane.getByText(/^Artifact Create succeeded\.$/),
  });
  await createRow.waitFor({ state: "visible", timeout: UI_TIMEOUT });
  await createRow
    .locator('button.shared-extension-disclosure[aria-label="Expand Artifact Create succeeded."]')
    .click();
  const createText = (await createRow.textContent()) ?? "";
  expect(createText).toContain(persisted.artifactCommandId);
  expect(createText).toContain(persisted.artifactId);
  expect(createText).toContain(ARTIFACT_NAME);
}

async function openArtifactFromCreateLog(
  logsPane: ReturnType<SvvyApp["page"]["locator"]>,
  persisted: PersistedLifecycle,
): Promise<void> {
  const createRow = logsPane.locator(".log-row-shell").filter({
    has: logsPane.getByText(/^Artifact Create succeeded\.$/),
  });
  const artifactLink = createRow.locator("button.related-link-button").filter({
    hasText: persisted.artifactId,
  });
  await artifactLink.waitFor({ state: "visible" });
  await artifactLink.click();
}

async function assertArtifactInspector(page: SvvyApp["page"], artifactId: string): Promise<void> {
  const inspector = page.locator('section.related-inspector-pane[aria-label="Artifact"]').first();
  await inspector.waitFor({ state: "visible", timeout: UI_TIMEOUT });
  await inspector.getByText(new RegExp(`^${artifactId}$`)).waitFor({
    state: "visible",
    timeout: UI_TIMEOUT,
  });
  const summaryText = (await inspector.locator(".inspector-summary").textContent()) ?? "";
  expect(summaryText).toContain(ARTIFACT_NAME);
  expect(summaryText).toContain("text");
  expect(await inspector.locator(".callout.warning").count()).toBe(0);
}

function findArtifactLog(
  entries: AppLogEntry[],
  message: string,
  artifactCommandId: string,
): AppLogEntry {
  const matches = entries.filter(
    (entry) =>
      entry.source === "artifact" &&
      entry.message === message &&
      entry.details?.artifactCommandId === artifactCommandId,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

function readyNamespaceValue<T>(state: { value: unknown }, label: string): T {
  const namespace = recordValue(state.value, `${label} namespace`);
  expect(namespace.status).toBe("ready");
  return namespace.value as T;
}

function bridgeStateValue<T>(state: { value: unknown }): T {
  return state.value as T;
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

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
