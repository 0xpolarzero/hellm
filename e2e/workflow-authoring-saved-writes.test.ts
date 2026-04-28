import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startWorkflowAuthoringSavedWritesChatStub,
  type WorkflowSupervisionChatStub,
} from "./chat-completions-stub";
import { PROJECT_ROOT_DIR, createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { writeAgentModelsConfig } from "./support";

setDefaultTimeout(180_000);

const OPEN_THREAD_PROMPT = "Open a handler thread dedicated to the workflow-authoring save proof.";
const AUTHOR_ARTIFACT_PROMPT = [
  "Check direct work first.",
  "Check saved runnable entries and reusable assets.",
  "If they do not fit cleanly, author a short-lived artifact workflow.",
].join(" ");
const RUN_ARTIFACT_PROMPT =
  "Run the artifact workflow you just authored, use smithers.get_run as needed until it finishes, and then hand the result back.";
const SAVE_SHORTCUT_PROMPT = [
  "Inspect the workflow work owned by this thread.",
  "If there are reusable saved workflow files worth keeping, write them directly into `.svvy/workflows/...` using the normal repo write APIs.",
  "Rely on the automatic workflow validation feedback returned in the surrounding `execute_typescript` logs, and keep editing until the final saved workflow state validates cleanly.",
  "If nothing here is worth saving, say so briefly inside the thread.",
].join(" ");
const ARTIFACT_WORKFLOW_DIR = "workflow-authoring-proof-draft";
const ARTIFACT_ROOT_RELATIVE = `.svvy/artifacts/workflows/${ARTIFACT_WORKFLOW_DIR}`;
const ARTIFACT_WORKFLOW_ID = "workflow_authoring_proof_draft";
const SAVED_ROOT_RELATIVE = ".svvy/workflows";

type StubRequest = {
  messages: Array<Record<string, unknown>>;
  tools?: Array<{
    function?: {
      name?: string;
    };
  }>;
};

type StubAssistantToolCall = {
  id: string;
  name: string;
  argumentsText: string;
  parsedArguments: Record<string, unknown> | null;
};

type StubToolResult = {
  toolCallId: string;
  toolName: string | null;
  text: string;
  parsed: Record<string, unknown> | null;
};

beforeAll(async () => {
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

  throw new Error("Timed out waiting for workflow authoring UI.");
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

  throw new Error("Timed out waiting for workflow authoring action to become enabled.");
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
    isDisabled?: () => Promise<boolean>;
    getAttribute?: (name: string) => Promise<string | null>;
  },
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await waitForEnabled(locator, Math.min(1_000, timeoutMs));
    try {
      await locator.click({ force: true });
      return;
    } catch (error) {
      if (!isRetryableClickError(error)) {
        throw error;
      }
    }
    await Bun.sleep(100);
  }

  throw new Error("Timed out clicking a workflow authoring action after it became enabled.");
}

async function sendPrompt(page: SvvyApp["page"], text: string): Promise<void> {
  const composer = page.locator(
    'textarea[placeholder="Ask svvy to inspect the repo, make a change, or run Project CI."]',
  );
  await composer.fill(text);
  await clickWhenEnabled(page.getByRole("button", { name: "Send" }));
}

async function returnToOrchestrator(page: SvvyApp["page"]): Promise<void> {
  const returnButton = page.getByRole("button", { name: "Return to orchestrator" });
  if (await returnButton.isVisible()) {
    await clickWhenEnabled(returnButton);
  }
}

async function closeDialogIfVisible(page: SvvyApp["page"]): Promise<void> {
  const closeButton = page.locator(".ui-dialog-close").first();
  if (await closeButton.isVisible()) {
    await closeButton.click({ force: true });
  }
}

async function waitForTextContent(
  locator: {
    textContent(): Promise<string | null>;
  },
  text: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const content = (await locator.textContent()) ?? "";
    if (content.includes(text)) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for text "${text}".`);
}

async function waitForPath(path: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for path ${path}.`);
}

async function waitForCondition(
  label: string,
  predicate: () => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function createWorkspaceDir(prefix = "svvy-workflow-authoring-e2e-"): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function prepareWorkflowAuthoringWorkspace(workspaceDir: string): Promise<void> {
  for (const entry of ["node_modules", "package.json", "tsconfig.json", "tsconfig.base.json"]) {
    await symlink(join(PROJECT_ROOT_DIR, entry), join(workspaceDir, entry));
  }
}

async function withIsolatedLaunchState<T>(
  fn: (input: { homeDir: string; workspaceDir: string }) => Promise<T>,
): Promise<T> {
  const homeDir = await createHomeDir("svvy-workflow-authoring-home-");
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

test("proves artifact-only workflow authoring by default and explicit saved writes through the handler prompt shortcut", async () => {
  const stub = startWorkflowAuthoringSavedWritesChatStub();

  try {
    await withIsolatedLaunchState(async (launchState) => {
      await prepareWorkflowAuthoringWorkspace(launchState.workspaceDir);

      const artifactRoot = join(
        launchState.workspaceDir,
        ".svvy",
        "artifacts",
        "workflows",
        ARTIFACT_WORKFLOW_DIR,
      );
      const artifactDefinitionPath = join(
        artifactRoot,
        "definitions",
        "workflow-authoring-proof.ts",
      );
      const artifactPromptPath = join(artifactRoot, "prompts", "workflow-authoring-proof.mdx");
      const artifactComponentPath = join(
        artifactRoot,
        "components",
        "workflow-authoring-proof-reviewer.ts",
      );
      const artifactEntryPath = join(artifactRoot, "entries", "workflow-authoring-proof.ts");
      const artifactMetadataPath = join(artifactRoot, "metadata.json");

      const savedRoot = join(launchState.workspaceDir, ".svvy", "workflows");
      const savedDefinitionPath = join(savedRoot, "definitions", "workflow-authoring-proof.ts");
      const savedPromptPath = join(savedRoot, "prompts", "workflow-authoring-proof.mdx");
      const savedComponentPath = join(
        savedRoot,
        "components",
        "workflow-authoring-proof-reviewer.ts",
      );
      const savedEntryPath = join(savedRoot, "entries", "workflow-authoring-proof.ts");

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

          await sendPrompt(page, OPEN_THREAD_PROMPT);

          await waitForVisible(
            page.getByText(
              "Opened the Workflow Authoring Proof Thread for the workflow-authoring save proof.",
            ),
          );
          await waitForVisible(page.getByText("Delegated Threads"));
          await waitForVisible(page.getByText("Workflow Authoring Proof Thread", { exact: true }));

          const threadCard = page.locator(".handler-thread-card").first();
          await waitForVisible(threadCard);
          expect((await threadCard.textContent()) ?? "").toContain("Workflow Authoring Proof Thread");
          expect((await threadCard.textContent()) ?? "").toContain(
            "author and run an artifact workflow",
          );

          await clickWhenEnabled(
            page.locator(".handler-thread-actions button").nth(1),
          );
          await waitForVisible(page.getByRole("button", { name: "Return to orchestrator" }));

          await sendPrompt(page, AUTHOR_ARTIFACT_PROMPT);

          await waitForPath(artifactEntryPath, 60_000);
          await waitForCondition(
            "artifact authoring execute_typescript result",
            () => {
              const authoringRequests = requestsMatching(stub.requests, AUTHOR_ARTIFACT_PROMPT);
              const authoringToolCalls = collectAssistantToolCalls(authoringRequests);
              return (
                findLatestToolResult(
                  authoringRequests,
                  authoringToolCalls,
                  "execute_typescript",
                ) !== null
              );
            },
            60_000,
          );
          {
            const authoringRequests = requestsMatching(stub.requests, AUTHOR_ARTIFACT_PROMPT);
            const authoringToolCalls = collectAssistantToolCalls(authoringRequests);
            const artifactAuthoringResult = findLatestToolResult(
              authoringRequests,
              authoringToolCalls,
              "execute_typescript",
            );
            expect(artifactAuthoringResult?.parsed?.success).toBe(true);
          }
          expect(
            collectAvailableToolNames(requestsMatching(stub.requests, AUTHOR_ARTIFACT_PROMPT)),
          ).toContain("smithers.run_workflow");
          {
            const authoringRequests = requestsMatching(stub.requests, AUTHOR_ARTIFACT_PROMPT);
            const authoringToolCalls = collectAssistantToolCalls(authoringRequests);
            expect(
              findLatestRunWorkflowResult(
                authoringRequests,
                authoringToolCalls,
                ARTIFACT_WORKFLOW_ID,
              ),
            ).toBeNull();
          }
          expect(existsSync(savedDefinitionPath)).toBe(false);
          expect(existsSync(savedPromptPath)).toBe(false);
          expect(existsSync(savedComponentPath)).toBe(false);
          expect(existsSync(savedEntryPath)).toBe(false);

          await returnToOrchestrator(page);
          await clickWhenEnabled(
            page.locator(".handler-thread-actions button").nth(1),
          );
          await waitForVisible(page.getByRole("button", { name: "Return to orchestrator" }));
          await sendPrompt(page, RUN_ARTIFACT_PROMPT);
          await waitForCondition(
            "artifact workflow run prompt request",
            () => requestsMatching(stub.requests, RUN_ARTIFACT_PROMPT).length > 0,
            20_000,
          );
          expect(
            collectAvailableToolNames(requestsMatching(stub.requests, RUN_ARTIFACT_PROMPT)),
          ).toContain("smithers.run_workflow");
          await waitForCondition(
            "artifact workflow run tool call",
            () =>
              (findRunWorkflowToolCalls(
                collectAssistantToolCalls(stub.requests),
                ARTIFACT_WORKFLOW_ID,
              )[0] ?? null) !== null,
            60_000,
          );
          await waitForCondition(
            "artifact workflow get_run loop",
            () =>
              collectAssistantToolCalls(stub.requests)
                .map((toolCall) => toolCall.name)
                .includes("smithers.get_run"),
            60_000,
          );
          await waitForCondition(
            "artifact workflow handoff",
            () =>
              collectAssistantToolCalls(stub.requests)
                .map((toolCall) => toolCall.name)
                .includes("thread.handoff"),
            60_000,
          );
          await Bun.sleep(500);
          await returnToOrchestrator(page);
          await waitForVisible(page.getByText("1 workflow"), 60_000);
          await waitForVisible(page.getByText("1 handoff"), 60_000);
          await waitForTextContent(threadCard, "Completed", 60_000);

          await clickWhenEnabled(
            page.locator(".handler-thread-actions button").first(),
          );

          const inspector = page.getByRole("dialog", { name: "Workflow Authoring Proof Thread" });
          await waitForVisible(inspector);
          const inspectorText = (await inspector.textContent()) ?? "";
          expect(inspectorText).toContain("Workflow Runs");
          expect(inspectorText).toContain("smithers.run_workflow");
          expect(inspectorText).toContain(ARTIFACT_WORKFLOW_ID);
          expect(inspectorText).toContain("1 workflow");

          const saveButton = inspector.getByRole("button", { name: "Ask to save workflow" });
          await waitForVisible(saveButton);
          await clickWhenEnabled(saveButton);

          await waitForPath(savedEntryPath, 60_000);
          await waitForCondition(
            "saved workflow handoff",
            () =>
              collectAssistantToolCalls(requestsMatching(stub.requests, SAVE_SHORTCUT_PROMPT))
                .map((toolCall) => toolCall.name)
                .includes("thread.handoff"),
            60_000,
          );
          await closeDialogIfVisible(page);
          await returnToOrchestrator(page);

          await clickWhenEnabled(
            page.locator(".handler-thread-actions button").first(),
          );
          const savedInspector = page.getByRole("dialog", {
            name: "Workflow Authoring Proof Thread",
          });
          await waitForVisible(savedInspector);
          await waitForTextContent(savedInspector, "2 handoffs", 60_000);
          await closeDialogIfVisible(page);
        },
      );

      expect(existsSync(artifactMetadataPath)).toBe(true);
      expect(existsSync(artifactDefinitionPath)).toBe(true);
      expect(existsSync(artifactPromptPath)).toBe(true);
      expect(existsSync(artifactComponentPath)).toBe(true);
      expect(existsSync(artifactEntryPath)).toBe(true);
      expect(existsSync(savedDefinitionPath)).toBe(true);
      expect(existsSync(savedPromptPath)).toBe(true);
      expect(existsSync(savedComponentPath)).toBe(true);
      expect(existsSync(savedEntryPath)).toBe(true);

      const artifactMetadataText = await readFile(artifactMetadataPath, "utf8");
      expect(artifactMetadataText).toContain(
        '"artifactWorkflowId": "workflow-authoring-proof-draft"',
      );

      const artifactEntryText = await readFile(artifactEntryPath, "utf8");
      expect(artifactEntryText).toContain(ARTIFACT_ROOT_RELATIVE);
      expect(artifactEntryText).toContain('workflowSource: "artifact" as const');

      const savedEntryText = await readFile(savedEntryPath, "utf8");
      expect(savedEntryText).toContain(
        `${SAVED_ROOT_RELATIVE}/definitions/workflow-authoring-proof.ts`,
      );
      expect(savedEntryText).toContain(
        `${SAVED_ROOT_RELATIVE}/prompts/workflow-authoring-proof.mdx`,
      );
      expect(savedEntryText).toContain(
        `${SAVED_ROOT_RELATIVE}/components/workflow-authoring-proof-reviewer.ts`,
      );
      expect(savedEntryText).toContain('workflowSource: "saved" as const');
      expect(savedEntryText).not.toContain(".svvy/artifacts/workflows/");
    });
  } finally {
    stub.stop();
  }

  const orchestratorRequests = requestsMatching(stub.requests, OPEN_THREAD_PROMPT);
  expect(orchestratorRequests.length).toBeGreaterThan(0);
  const orchestratorToolSurface = collectAvailableToolNames(orchestratorRequests);
  expect(orchestratorToolSurface).toContain("thread.start");
  expect(orchestratorToolSurface.some((name) => name.startsWith("smithers."))).toBe(false);
  expect(
    collectAssistantToolCalls(orchestratorRequests).some(
      (toolCall) => toolCall.name === "thread.start",
    ),
  ).toBe(true);
  expect(
    collectAssistantToolCalls(orchestratorRequests).some((toolCall) =>
      toolCall.name.startsWith("smithers."),
    ),
  ).toBe(false);

  const authoringRequests = requestsMatching(stub.requests, AUTHOR_ARTIFACT_PROMPT);
  expect(authoringRequests.length).toBeGreaterThan(0);
  const authoringToolSurface = collectAvailableToolNames(authoringRequests);
  expect(authoringToolSurface).toContain("execute_typescript");
  expect(authoringToolSurface).toContain("smithers.list_workflows");
  expect(authoringToolSurface).toContain("smithers.run_workflow");
  expect(authoringToolSurface.some((name) => name.startsWith("smithers.run_workflow."))).toBe(
    false,
  );
  expect(authoringToolSurface).not.toContain("thread.start");

  const authoringToolCalls = collectAssistantToolCalls(authoringRequests);
  expect(authoringToolCalls.map((toolCall) => toolCall.name)).toEqual(
    expect.arrayContaining(["smithers.list_workflows", "execute_typescript"]),
  );

  const artifactExecuteToolCall = findFirstToolCall(authoringToolCalls, "execute_typescript");
  const artifactTypescriptCode =
    readStringProperty(artifactExecuteToolCall?.parsedArguments, "typescriptCode") ?? "";
  expect(artifactTypescriptCode).toContain("api.workflow.listAssets");
  expect(artifactTypescriptCode).toContain("api.workflow.listModels()");
  expect(artifactTypescriptCode).toContain(ARTIFACT_ROOT_RELATIVE);
  expect(artifactTypescriptCode).toContain("api.repo.writeJson");
  expect(artifactTypescriptCode).not.toContain(
    ".svvy/workflows/entries/workflow-authoring-proof.ts",
  );
  expect(artifactTypescriptCode).not.toContain("api.workflow.saveAssets");

  const authoringExecuteResult = findLatestToolResult(
    authoringRequests,
    authoringToolCalls,
    "execute_typescript",
  );
  expect(
    readStringProperty(
      readObjectProperty(authoringExecuteResult?.parsed, "result"),
      "artifactWorkflowId",
    ),
  ).toBe(ARTIFACT_WORKFLOW_DIR);
  const discoveredWorkflows = readWorkflowIdsFromListWorkflows(
    findLatestToolResult(authoringRequests, authoringToolCalls, "smithers.list_workflows"),
  );
  expect(discoveredWorkflows.length).toBeGreaterThan(0);

  const runRequests = requestsMatching(stub.requests, RUN_ARTIFACT_PROMPT);
  expect(runRequests.length).toBeGreaterThan(0);
  expect(collectAvailableToolNames(runRequests)).toContain("smithers.run_workflow");
  const globalToolCalls = collectAssistantToolCalls(stub.requests);
  const artifactRunWorkflowCall =
    findRunWorkflowToolCalls(globalToolCalls, ARTIFACT_WORKFLOW_ID)[0] ?? null;
  expect(artifactRunWorkflowCall?.parsedArguments).toMatchObject({
    workflowId: ARTIFACT_WORKFLOW_ID,
    input: {
      objective: "Prove artifact authoring before any explicit save request.",
    },
  });

  const saveRequests = requestsMatching(stub.requests, SAVE_SHORTCUT_PROMPT);
  expect(saveRequests.length).toBeGreaterThan(0);
  const saveToolSurface = collectAvailableToolNames(saveRequests);
  expect(saveToolSurface).toContain("execute_typescript");
  expect(saveToolSurface).not.toContain("thread.start");
  expect(saveToolSurface.some((name) => name.includes("saveAssets"))).toBe(false);

  const saveToolCalls = collectAssistantToolCalls(saveRequests);
  expect(saveToolCalls.map((toolCall) => toolCall.name)).toEqual(
    expect.arrayContaining(["execute_typescript", "thread.handoff"]),
  );
  expect(saveToolCalls.some((toolCall) => toolCall.name.includes("saveAssets"))).toBe(false);

  const saveExecuteToolCall =
    findExecuteTypescriptToolCallsContaining(
      saveToolCalls,
      `${SAVED_ROOT_RELATIVE}/entries/workflow-authoring-proof.ts`,
    )[0] ?? null;
  const saveTypescriptCode =
    readStringProperty(saveExecuteToolCall?.parsedArguments, "typescriptCode") ?? "";
  expect(saveTypescriptCode).toContain("api.repo.readFile");
  expect(saveTypescriptCode).toContain("api.repo.writeFile");
  expect(saveTypescriptCode).toContain(SAVED_ROOT_RELATIVE);
  expect(saveTypescriptCode).not.toContain("api.workflow.saveAssets");

  const saveExecuteResult = findLatestToolResultForCallIds(
    saveRequests,
    saveToolCalls,
    new Set(saveExecuteToolCall ? [saveExecuteToolCall.id] : []),
  );
  expect(saveExecuteResult?.parsed?.success).toBe(true);
  expect(readStringArrayProperty(saveExecuteResult?.parsed, "logs")).toEqual(
    expect.arrayContaining([
      "[error] Workflow validation reported 1 error after writing .svvy/workflows/components/workflow-authoring-proof-reviewer.ts.",
      "Workflow validation passed after writing .svvy/workflows/entries/workflow-authoring-proof.ts.",
    ]),
  );

  expect(collectAvailableToolNames(stub.requests).some((name) => name.includes("saveAssets"))).toBe(
    false,
  );
});

function requestsMatching(
  requests: WorkflowSupervisionChatStub["requests"],
  text: string,
): StubRequest[] {
  return requests.filter((request) => latestUserText(request).includes(text));
}

function latestUserText(request: StubRequest | undefined): string {
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

function collectAvailableToolNames(
  requests: StubRequest[] | WorkflowSupervisionChatStub["requests"],
): string[] {
  return Array.from(
    new Set(
      requests
        .flatMap((request) => request.tools ?? [])
        .map((tool) => tool.function?.name)
        .filter((name): name is string => typeof name === "string"),
    ),
  ).toSorted();
}

function collectAssistantToolCalls(requests: StubRequest[]): StubAssistantToolCall[] {
  const toolCalls: StubAssistantToolCall[] = [];
  const seen = new Set<string>();

  for (const request of requests) {
    for (const message of request.messages) {
      if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) {
        continue;
      }

      for (const toolCall of message.tool_calls) {
        const id = readStringProperty(toolCall as Record<string, unknown>, "id");
        const name = readStringProperty(
          (toolCall as { function?: Record<string, unknown> }).function ?? null,
          "name",
        );
        const argumentsText = readStringProperty(
          (toolCall as { function?: Record<string, unknown> }).function ?? null,
          "arguments",
        );
        if (!id || !name || !argumentsText || seen.has(id)) {
          continue;
        }

        seen.add(id);
        toolCalls.push({
          id,
          name,
          argumentsText,
          parsedArguments: parseJsonObject(argumentsText),
        });
      }
    }
  }

  return toolCalls;
}

function collectToolResults(
  requests: StubRequest[],
  toolCalls: StubAssistantToolCall[],
): StubToolResult[] {
  const toolNameById = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall.name]));
  const toolResults: StubToolResult[] = [];
  const seen = new Set<string>();

  for (const request of requests) {
    for (const message of request.messages) {
      if (message?.role !== "tool") {
        continue;
      }

      const toolCallId = readStringProperty(message, "tool_call_id");
      if (!toolCallId || seen.has(toolCallId)) {
        continue;
      }

      const text = flattenMessageContent(message.content).trim();
      seen.add(toolCallId);
      toolResults.push({
        toolCallId,
        toolName: toolNameById.get(toolCallId) ?? null,
        text,
        parsed: parseJsonObject(text),
      });
    }
  }

  return toolResults;
}

function findFirstToolCall(
  toolCalls: StubAssistantToolCall[],
  toolName: string,
): StubAssistantToolCall | null {
  return toolCalls.find((toolCall) => toolCall.name === toolName) ?? null;
}

function findRunWorkflowToolCalls(
  toolCalls: StubAssistantToolCall[],
  workflowId: string,
): StubAssistantToolCall[] {
  return toolCalls.filter(
    (toolCall) =>
      toolCall.name === "smithers.run_workflow" &&
      readStringProperty(toolCall.parsedArguments, "workflowId") === workflowId,
  );
}

function findExecuteTypescriptToolCallsContaining(
  toolCalls: StubAssistantToolCall[],
  snippet: string,
): StubAssistantToolCall[] {
  return toolCalls.filter(
    (toolCall) =>
      toolCall.name === "execute_typescript" &&
      readStringProperty(toolCall.parsedArguments, "typescriptCode").includes(snippet),
  );
}

function findLatestToolResult(
  requests: StubRequest[],
  toolCalls: StubAssistantToolCall[],
  toolName: string,
): StubToolResult | null {
  const toolResults = collectToolResults(requests, toolCalls);
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = toolResults[index];
    if (toolResult?.toolName === toolName) {
      return toolResult;
    }
  }
  return null;
}

function findLatestToolResultForCallIds(
  requests: StubRequest[],
  toolCalls: StubAssistantToolCall[],
  toolCallIds: Set<string>,
): StubToolResult | null {
  const toolResults = collectToolResults(requests, toolCalls);
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = toolResults[index];
    if (toolResult && toolCallIds.has(toolResult.toolCallId)) {
      return toolResult;
    }
  }
  return null;
}

function findLatestRunWorkflowResult(
  requests: StubRequest[],
  toolCalls: StubAssistantToolCall[],
  workflowId: string,
): StubToolResult | null {
  const runWorkflowCallIds = new Set(
    findRunWorkflowToolCalls(toolCalls, workflowId).map((toolCall) => toolCall.id),
  );
  const toolResults = collectToolResults(requests, toolCalls);
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = toolResults[index];
    if (toolResult && runWorkflowCallIds.has(toolResult.toolCallId)) {
      return toolResult;
    }
  }
  return null;
}

function readWorkflowIdsFromListWorkflows(result: StubToolResult | null): string[] {
  const workflows = result?.parsed?.workflows;
  if (!Array.isArray(workflows)) {
    return [];
  }

  return workflows
    .map((workflow) =>
      workflow && typeof workflow === "object"
        ? readStringProperty(workflow as Record<string, unknown>, "workflowId")
        : null,
    )
    .filter((workflowId): workflowId is string => typeof workflowId === "string");
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }

      if ("text" in block && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readStringProperty(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  return typeof value?.[key] === "string" ? (value[key] as string) : null;
}

function readObjectProperty(
  value: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const property = value?.[key];
  return property && typeof property === "object" && !Array.isArray(property)
    ? (property as Record<string, unknown>)
    : null;
}

function readStringArrayProperty(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  const property = value?.[key];
  return Array.isArray(property)
    ? property.filter((entry): entry is string => typeof entry === "string")
    : [];
}
