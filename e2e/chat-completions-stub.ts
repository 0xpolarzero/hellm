type ChatCompletionRequest = {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
};

type ToolCallRecord = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type ToolResultRecord = {
  toolCallId: string;
  toolName: string | null;
  text: string;
  parsed: Record<string, unknown> | null;
};

export type WorkflowSupervisionChatStub = {
  baseUrl: string;
  requests: ChatCompletionRequest[];
  stop(): void;
};

const WORKFLOW_AUTHORING_OPEN_THREAD_PROMPT =
  "Open a handler thread dedicated to the workflow-authoring save proof.";
const WORKFLOW_AUTHORING_HANDLER_PROMPT = [
  "Check direct work first.",
  "Check saved runnable entries and reusable assets.",
  "If they do not fit cleanly, author a short-lived artifact workflow.",
].join(" ");
const WORKFLOW_AUTHORING_RUN_PROMPT =
  "Run the artifact workflow you just authored, use smithers.get_run as needed until it finishes, and then hand the result back.";
const WORKFLOW_AUTHORING_SAVE_SHORTCUT_PROMPT = [
  "Inspect the workflow work owned by this thread.",
  "If there are reusable saved workflow files worth keeping, write them directly into `.svvy/workflows/...` using the direct write or edit tools.",
  "Rely on the automatic workflow validation feedback returned in structured tool output, and keep editing until the final saved workflow state validates cleanly.",
  "If nothing here is worth saving, say so briefly inside the thread.",
].join(" ");
const WORKFLOW_AUTHORING_ARTIFACT_WORKFLOW_ID = "workflow_authoring_proof_draft";
const WORKFLOW_AUTHORING_ARTIFACT_DIR = "workflow-authoring-proof-draft";
const WORKFLOW_AUTHORING_ARTIFACT_ROOT = `.svvy/artifacts/workflows/${WORKFLOW_AUTHORING_ARTIFACT_DIR}`;
const WORKFLOW_AUTHORING_ARTIFACT_DEFINITION_PATH = `${WORKFLOW_AUTHORING_ARTIFACT_ROOT}/definitions/workflow-authoring-proof.ts`;
const WORKFLOW_AUTHORING_ARTIFACT_PROMPT_PATH = `${WORKFLOW_AUTHORING_ARTIFACT_ROOT}/prompts/workflow-authoring-proof.mdx`;
const WORKFLOW_AUTHORING_ARTIFACT_COMPONENT_PATH = `${WORKFLOW_AUTHORING_ARTIFACT_ROOT}/components/workflow-authoring-proof-reviewer.ts`;
const WORKFLOW_AUTHORING_ARTIFACT_ENTRY_PATH = `${WORKFLOW_AUTHORING_ARTIFACT_ROOT}/entries/workflow-authoring-proof.ts`;
const WORKFLOW_AUTHORING_ARTIFACT_METADATA_PATH = `${WORKFLOW_AUTHORING_ARTIFACT_ROOT}/metadata.json`;
const WORKFLOW_AUTHORING_SAVED_WORKFLOW_ID = "workflow_authoring_proof";
const WORKFLOW_AUTHORING_SAVED_ROOT = ".svvy/workflows";
const WORKFLOW_AUTHORING_SAVED_DEFINITION_PATH = `${WORKFLOW_AUTHORING_SAVED_ROOT}/definitions/workflow-authoring-proof.ts`;
const WORKFLOW_AUTHORING_SAVED_PROMPT_PATH = `${WORKFLOW_AUTHORING_SAVED_ROOT}/prompts/workflow-authoring-proof.mdx`;
const WORKFLOW_AUTHORING_SAVED_COMPONENT_PATH = `${WORKFLOW_AUTHORING_SAVED_ROOT}/components/workflow-authoring-proof-reviewer.ts`;
const WORKFLOW_AUTHORING_SAVED_ENTRY_PATH = `${WORKFLOW_AUTHORING_SAVED_ROOT}/entries/workflow-authoring-proof.ts`;

export function startWorkflowSupervisionChatStub(): WorkflowSupervisionChatStub {
  const requests: ChatCompletionRequest[] = [];
  let responseCounter = 0;
  let toolCallCounter = 0;

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
      const toolCalls = collectToolCalls(payload.messages);
      const toolResults = collectToolResults(payload.messages, toolCalls);
      const responseId = `chatcmpl-workflow-supervision-${++responseCounter}`;

      try {
        if (
          latestUserText.includes(
            "Open a handler thread dedicated to running the saved hello_world fixture workflow.",
          )
        ) {
          if (!hasToolCall(toolCalls, "thread.start")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.start",
              args: {
                objective:
                  "Run the saved hello_world fixture workflow, monitor it to completion, and hand the result back to the orchestrator.",
              },
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Opened a handler thread for the saved hello_world fixture workflow.",
          });
        }

        if (
          latestUserText.includes(
            "Run the saved hello_world fixture workflow, let workflow supervision wake this handler when it finishes, and then hand the result back.",
          )
        ) {
          if (!hasToolCall(toolCalls, "smithers.list_workflows")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.list_workflows",
              args: {},
            });
          }

          if (!hasRunWorkflowCall(toolCalls, "hello_world")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.run_workflow",
              args: {
                workflowId: "hello_world",
                input: {
                  message: "hello from the real app workflow supervision e2e",
                },
              },
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: [
              "Launched the saved hello_world fixture workflow.",
              "Workflow supervision will wake this handler surface when durable attention is needed.",
            ].join(" "),
          });
        }

        if (
          latestUserText.includes(
            "Run the saved hello_world fixture workflow, wait for it to finish, and hand the result back.",
          )
        ) {
          if (!hasToolCall(toolCalls, "smithers.list_workflows")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.list_workflows",
              args: {},
            });
          }

          if (!hasRunWorkflowCall(toolCalls, "hello_world")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.run_workflow",
              args: {
                workflowId: "hello_world",
                input: {
                  message: "hello from the real app workflow supervision e2e",
                },
              },
            });
          }

          const launchedRun = findLatestRunWorkflowResult(toolResults, toolCalls, "hello_world");
          const runId = readStringProperty(launchedRun?.parsed, "runId");
          if (!runId) {
            throw new Error("Expected smithers.run_workflow hello_world result to include runId.");
          }

          const latestRunStatus = readStringProperty(
            findLatestToolResult(toolResults, "smithers.get_run")?.parsed,
            "status",
          );

          if (latestRunStatus !== "finished") {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.get_run",
              args: {
                runId,
              },
            });
          }

          if (!hasToolCall(toolCalls, "thread.handoff")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.handoff",
              args: helloWorldHandoffArgs(),
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Ran hello_world and handed the result back to the orchestrator.",
          });
        }

        if (latestUserText.includes("System event: A handler thread emitted a durable handoff.")) {
          return createTextResponse({
            responseId,
            model: payload.model,
            text: "The hello_world workflow completed successfully and the handler thread already handed back the result.",
          });
        }

        if (
          latestUserText.includes(
            "System event: A supervised Smithers workflow now requires handler attention.",
          )
        ) {
          const launchedRun = findLatestRunWorkflowResult(toolResults, toolCalls, "hello_world");
          const runId = readStringProperty(launchedRun?.parsed, "runId");
          if (!runId) {
            throw new Error("Expected smithers.run_workflow hello_world result to include runId.");
          }

          const latestRunStatus = readStringProperty(
            findLatestToolResult(toolResults, "smithers.get_run")?.parsed,
            "status",
          );

          if (latestRunStatus !== "finished") {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.get_run",
              args: {
                runId,
              },
            });
          }

          if (!hasToolCall(toolCalls, "thread.handoff")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.handoff",
              args: helloWorldHandoffArgs(),
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Workflow attention received; the handler reconciled durable state and handed the result back.",
          });
        }

        throw new Error(`Unhandled stub prompt: ${latestUserText}`);
      } catch (error) {
        return new Response(String(error instanceof Error ? error.message : error), {
          status: 500,
        });
      }
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

export function startWorkflowAuthoringSavedWritesChatStub(): WorkflowSupervisionChatStub {
  const requests: ChatCompletionRequest[] = [];
  let responseCounter = 0;
  let toolCallCounter = 0;
  let savePromptSeen = false;

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
      const toolCalls = collectToolCalls(payload.messages);
      const toolResults = collectToolResults(payload.messages, toolCalls);
      const responseId = `chatcmpl-workflow-authoring-proof-${++responseCounter}`;

      try {
        if (latestUserText.includes(WORKFLOW_AUTHORING_OPEN_THREAD_PROMPT)) {
          if (!hasToolCall(toolCalls, "thread.start")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.start",
              args: {
                objective:
                  "Check direct work, inspect saved runnable entries and reusable assets, author and run an artifact workflow when needed, and only save reusable workflow files if explicitly asked.",
              },
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Opened a handler thread for the workflow-authoring save proof.",
          });
        }

        if (latestUserText.includes(WORKFLOW_AUTHORING_HANDLER_PROMPT)) {
          if (countToolCalls(toolCalls, "smithers.list_workflows") === 0) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.list_workflows",
              args: {},
            });
          }

          if (countToolCalls(toolCalls, "execute_typescript") === 0) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "execute_typescript",
              args: {
                typescriptCode: buildWorkflowAuthoringArtifactCode(),
              },
            });
          }

          const artifactAuthoringResult = findLatestToolResult(toolResults, "execute_typescript");
          const authoringPayload = readObjectProperty(artifactAuthoringResult?.parsed, "result");
          if (
            readStringProperty(authoringPayload, "artifactWorkflowId") !==
            WORKFLOW_AUTHORING_ARTIFACT_DIR
          ) {
            throw new Error(
              "Expected workflow-authoring proof execute_typescript result to return the artifact workflow id.",
            );
          }
          const nextArtifactFile = nextUnwrittenFile(toolCalls, readFilePayloads(authoringPayload));
          if (nextArtifactFile) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "write",
              args: nextArtifactFile,
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Authored the artifact workflow proof and left it ready to run from this handler thread.",
          });
        }

        if (latestUserText.includes(WORKFLOW_AUTHORING_RUN_PROMPT)) {
          if (!hasRunWorkflowCall(toolCalls, WORKFLOW_AUTHORING_ARTIFACT_WORKFLOW_ID)) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.run_workflow",
              args: {
                workflowId: WORKFLOW_AUTHORING_ARTIFACT_WORKFLOW_ID,
                input: {
                  objective: "Prove artifact authoring before any explicit save request.",
                },
              },
            });
          }

          const launchedRun = findLatestRunWorkflowResult(
            toolResults,
            toolCalls,
            WORKFLOW_AUTHORING_ARTIFACT_WORKFLOW_ID,
          );
          const runId = readStringProperty(launchedRun?.parsed, "runId");
          if (!runId) {
            throw new Error(
              "Expected smithers.run_workflow workflow_authoring_proof_draft result to include runId.",
            );
          }

          const latestRunStatus = readStringProperty(
            findLatestToolResult(toolResults, "smithers.get_run")?.parsed,
            "status",
          );

          if (latestRunStatus !== "finished") {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.get_run",
              args: {
                runId,
              },
            });
          }

          if (!hasToolCall(toolCalls, "thread.handoff")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.handoff",
              args: workflowAuthoringArtifactHandoffArgs(),
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Ran and handed back the artifact workflow proof.",
          });
        }

        if (latestUserText.includes(WORKFLOW_AUTHORING_SAVE_SHORTCUT_PROMPT)) {
          savePromptSeen = true;

          const saveExecuteTypescriptCalls = findExecuteTypescriptCallsContaining(
            toolCalls,
            WORKFLOW_AUTHORING_SAVED_ENTRY_PATH,
          );

          if (saveExecuteTypescriptCalls.length === 0) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "execute_typescript",
              args: {
                typescriptCode: buildWorkflowAuthoringSaveCode(),
              },
            });
          }

          const saveResult = findLatestToolResultForCallIds(
            toolResults,
            new Set(saveExecuteTypescriptCalls.map((toolCall) => toolCall.id)),
          );
          const parsedSaveResult = saveResult?.parsed;
          if (parsedSaveResult?.success !== true) {
            throw new Error("Expected workflow-authoring save execute_typescript to succeed.");
          }
          const savePayload = readObjectProperty(parsedSaveResult, "result");
          const invalidFile = readFilePayload(readObjectProperty(savePayload, "invalidFile"));
          if (invalidFile && !hasWriteCall(toolCalls, invalidFile.path, invalidFile.content)) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "write",
              args: invalidFile,
            });
          }
          const nextSavedFile = nextUnwrittenFile(toolCalls, readFilePayloads(savePayload));
          if (nextSavedFile) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "write",
              args: nextSavedFile,
            });
          }

          if (
            !hasThreadHandoffCallWithSummary(
              toolCalls,
              "Saved reusable workflow files through direct write tools and finished with clean workflow validation output.",
            )
          ) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.handoff",
              args: workflowAuthoringSaveHandoffArgs(),
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Saved reusable workflow files into .svvy/workflows and validated the final state before handing the result back.",
          });
        }

        if (
          latestUserText.includes(
            "System event: A supervised Smithers workflow now requires handler attention.",
          )
        ) {
          const launchedRun = findLatestRunWorkflowResult(
            toolResults,
            toolCalls,
            WORKFLOW_AUTHORING_ARTIFACT_WORKFLOW_ID,
          );
          const runId = readStringProperty(launchedRun?.parsed, "runId");
          if (!runId) {
            throw new Error(
              "Expected smithers.run_workflow workflow_authoring_proof_draft result to include runId.",
            );
          }

          const latestRunStatus = readStringProperty(
            findLatestToolResult(toolResults, "smithers.get_run")?.parsed,
            "status",
          );

          if (latestRunStatus !== "finished") {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.get_run",
              args: {
                runId,
              },
            });
          }

          if (!hasToolCall(toolCalls, "thread.handoff")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.handoff",
              args: workflowAuthoringArtifactHandoffArgs(),
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Workflow attention returned to the handler thread and the artifact-only result was handed back.",
          });
        }

        if (latestUserText.includes("System event: A handler thread emitted a durable handoff.")) {
          return createTextResponse({
            responseId,
            model: payload.model,
            text: savePromptSeen
              ? "The workflow-authoring proof thread saved reusable workflow files after clean validation."
              : "The workflow-authoring proof thread authored and ran an artifact workflow without saving reusable workflow files.",
          });
        }

        throw new Error(`Unhandled stub prompt: ${latestUserText}`);
      } catch (error) {
        return new Response(String(error instanceof Error ? error.message : error), {
          status: 500,
        });
      }
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

function helloWorldHandoffArgs(): Record<string, unknown> {
  return {
    kind: "workflow",
    title: "hello_world completed",
    summary:
      "Ran the saved hello_world fixture workflow and verified that it finished successfully.",
    body: [
      "Launched the saved hello_world fixture workflow through smithers.run_workflow.",
      "Observed the Smithers run until it reported finished through smithers.get_run.",
      "The workflow completed successfully and is ready for orchestrator follow-up.",
    ].join("\n\n"),
  };
}

function workflowAuthoringArtifactHandoffArgs(): Record<string, unknown> {
  return {
    kind: "workflow",
    title: "artifact workflow proof completed",
    summary:
      "Authored and ran a short-lived artifact workflow without creating reusable saved workflow files.",
    body: [
      "Checked runnable saved entries through smithers.list_workflows before authoring.",
      "Inspected reusable saved assets and models inside execute_typescript through api.workflow.list_assets(...) and api.workflow.list_models().",
      `Authored ${WORKFLOW_AUTHORING_ARTIFACT_WORKFLOW_ID} under ${WORKFLOW_AUTHORING_ARTIFACT_ROOT}/ and launched it through smithers.run_workflow with workflowId ${WORKFLOW_AUTHORING_ARTIFACT_WORKFLOW_ID}.`,
      "No reusable .svvy/workflows files were written before an explicit save request arrived.",
    ].join("\n\n"),
  };
}

function workflowAuthoringSaveHandoffArgs(): Record<string, unknown> {
  return {
    kind: "workflow",
    title: "saved workflow proof completed",
    summary:
      "Saved reusable workflow files through direct write tools and finished with clean workflow validation output.",
    body: [
      "The save shortcut only sent a new prompt into the owning handler thread.",
      "The handler wrote reusable saved workflow files directly into .svvy/workflows/ with the direct write-capable tool surface.",
      "An intentional invalid component write surfaced workflow validation errors in the enclosing execute_typescript result logs.",
      "The handler fixed the saved workflow files and stopped only after the final validation output was clean.",
    ].join("\n\n"),
  };
}

function createToolCallResponse(input: {
  responseId: string;
  model: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Response {
  return createSseResponse([
    createChunk({
      responseId: input.responseId,
      model: input.model,
      delta: {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: input.toolCallId,
            type: "function",
            function: {
              name: input.toolName,
              arguments: JSON.stringify(input.args),
            },
          },
        ],
      },
      finishReason: null,
    }),
    createChunk({
      responseId: input.responseId,
      model: input.model,
      delta: {},
      finishReason: "tool_calls",
    }),
  ]);
}

function createTextResponse(input: { responseId: string; model: string; text: string }): Response {
  return createSseResponse([
    createChunk({
      responseId: input.responseId,
      model: input.model,
      delta: {
        role: "assistant",
        content: input.text,
      },
      finishReason: null,
    }),
    createChunk({
      responseId: input.responseId,
      model: input.model,
      delta: {},
      finishReason: "stop",
    }),
  ]);
}

function createChunk(input: {
  responseId: string;
  model: string;
  delta: Record<string, unknown>;
  finishReason: string | null;
}) {
  return {
    id: input.responseId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [
      {
        index: 0,
        delta: input.delta,
        finish_reason: input.finishReason,
      },
    ],
  };
}

function createSseResponse(events: unknown[]): Response {
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

    const text = flattenMessageContent(message.content).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function collectToolCalls(messages: Array<Record<string, unknown>>): ToolCallRecord[] {
  const toolCalls: ToolCallRecord[] = [];

  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) {
      continue;
    }

    for (const toolCall of message.tool_calls) {
      const id = readStringProperty(toolCall as Record<string, unknown>, "id");
      const fn = (toolCall as { function?: Record<string, unknown> }).function ?? null;
      const name = readStringProperty(fn, "name");
      const args = parseJsonObject(readStringProperty(fn, "arguments") ?? "") ?? {};
      if (!id || !name) {
        continue;
      }
      toolCalls.push({ id, name, args });
    }
  }

  return toolCalls;
}

function collectToolResults(
  messages: Array<Record<string, unknown>>,
  toolCalls: ToolCallRecord[],
): ToolResultRecord[] {
  const toolNameById = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall.name]));
  const toolResults: ToolResultRecord[] = [];

  for (const message of messages) {
    if (message?.role !== "tool") {
      continue;
    }

    const toolCallId = readStringProperty(message, "tool_call_id");
    if (!toolCallId) {
      continue;
    }

    const text = flattenMessageContent(message.content).trim();
    toolResults.push({
      toolCallId,
      toolName: toolNameById.get(toolCallId) ?? null,
      text,
      parsed: parseJsonObject(text),
    });
  }

  return toolResults;
}

function hasToolCall(toolCalls: ToolCallRecord[], name: string): boolean {
  return toolCalls.some((toolCall) => toolCall.name === name);
}

function hasRunWorkflowCall(toolCalls: ToolCallRecord[], workflowId: string): boolean {
  return countRunWorkflowCalls(toolCalls, workflowId) > 0;
}

function hasThreadHandoffCallWithSummary(toolCalls: ToolCallRecord[], summary: string): boolean {
  return toolCalls.some(
    (toolCall) => toolCall.name === "thread.handoff" && toolCall.args.summary === summary,
  );
}

function countRunWorkflowCalls(toolCalls: ToolCallRecord[], workflowId: string): number {
  return toolCalls.filter(
    (toolCall) =>
      toolCall.name === "smithers.run_workflow" && toolCall.args.workflowId === workflowId,
  ).length;
}

function countToolCalls(toolCalls: ToolCallRecord[], name: string): number {
  return toolCalls.filter((toolCall) => toolCall.name === name).length;
}

function findExecuteTypescriptCallsContaining(
  toolCalls: ToolCallRecord[],
  snippet: string,
): ToolCallRecord[] {
  return toolCalls.filter(
    (toolCall) =>
      toolCall.name === "execute_typescript" &&
      typeof toolCall.args.typescriptCode === "string" &&
      toolCall.args.typescriptCode.includes(snippet),
  );
}

function findLatestRunWorkflowResult(
  toolResults: ToolResultRecord[],
  toolCalls: ToolCallRecord[],
  workflowId: string,
): ToolResultRecord | null {
  const matchingCallIds = new Set(
    toolCalls
      .filter(
        (toolCall) =>
          toolCall.name === "smithers.run_workflow" && toolCall.args.workflowId === workflowId,
      )
      .map((toolCall) => toolCall.id),
  );

  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = toolResults[index];
    if (toolResult && matchingCallIds.has(toolResult.toolCallId)) {
      return toolResult;
    }
  }

  return null;
}

function findLatestToolResult(
  toolResults: ToolResultRecord[],
  toolName: string,
): ToolResultRecord | null {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = toolResults[index];
    if (toolResult?.toolName === toolName) {
      return toolResult;
    }
  }

  return null;
}

function findLatestToolResultForCallIds(
  toolResults: ToolResultRecord[],
  toolCallIds: Set<string>,
): ToolResultRecord | null {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = toolResults[index];
    if (toolResult && toolCallIds.has(toolResult.toolCallId)) {
      return toolResult;
    }
  }

  return null;
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

type WriteFilePayload = {
  path: string;
  content: string;
};

function readFilePayload(
  value: Record<string, unknown> | null | undefined,
): WriteFilePayload | null {
  const path = readStringProperty(value, "path");
  const content = readStringProperty(value, "content");
  return path && content != null ? { path, content } : null;
}

function readFilePayloads(value: Record<string, unknown> | null | undefined): WriteFilePayload[] {
  const files = value?.files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files.flatMap((entry) => {
    const payload = readFilePayload(
      entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null,
    );
    return payload ? [payload] : [];
  });
}

function nextUnwrittenFile(
  toolCalls: StubAssistantToolCall[],
  files: WriteFilePayload[],
): WriteFilePayload | null {
  return files.find((file) => !hasWriteCall(toolCalls, file.path, file.content)) ?? null;
}

function hasWriteCall(toolCalls: StubAssistantToolCall[], path: string, content?: string): boolean {
  return toolCalls.some((toolCall) => {
    if (
      toolCall.name !== "write" ||
      readStringProperty(toolCall.parsedArguments, "path") !== path
    ) {
      return false;
    }
    return (
      content === undefined || readStringProperty(toolCall.parsedArguments, "content") === content
    );
  });
}

function buildWorkflowAuthoringDefinitionFileText(): string {
  return [
    "/**",
    " * @svvyAssetKind definition",
    " * @svvyId workflow_authoring_proof_definition",
    " * @svvyTitle Workflow Authoring Proof Definition",
    " * @svvySummary Deterministic reusable definition for the workflow authoring proof.",
    " */",
    'import React from "react";',
    'import { createSmithers } from "smithers-orchestrator";',
    'import { z } from "zod";',
    "",
    "export const workflowAuthoringProofLaunchSchema = z.object({",
    "  objective: z.string().min(1),",
    "});",
    "",
    "const bundledWorkflowRuntimeStoredInputSchema = z.object({",
    "  payload: z.record(z.string(), z.unknown()),",
    "});",
    "",
    "function readBundledWorkflowLaunchInput<Schema extends z.ZodTypeAny>(",
    "  launchSchema: Schema,",
    "  input: unknown,",
    "): z.infer<Schema> {",
    "  return launchSchema.parse(input);",
    "}",
    "",
    "export function createWorkflowAuthoringProofWorkflow(config: {",
    "  dbPath: string;",
    "  workflowId: string;",
    '  workflowSource: "saved" | "artifact";',
    "  workflowName: string;",
    "  promptBody: string;",
    "  reviewerName: string;",
    "}) {",
    "  const greetingSchema = z.object({",
    "    message: z.string(),",
    "  });",
    "  const resultSchema = z.object({",
    "    summary: z.string(),",
    "    message: z.string(),",
    "    reviewerName: z.string(),",
    "    promptBody: z.string(),",
    "  });",
    "  const smithersApi = createSmithers(",
    "    { input: bundledWorkflowRuntimeStoredInputSchema, greeting: greetingSchema, result: resultSchema },",
    "    { dbPath: config.dbPath },",
    "  );",
    "  return smithersApi.smithers((ctx) => {",
    "    const launch = readBundledWorkflowLaunchInput(workflowAuthoringProofLaunchSchema, ctx.input);",
    "    const greeting = ctx.outputs.greeting?.[ctx.outputs.greeting.length - 1] ?? null;",
    "    return React.createElement(",
    "      smithersApi.Workflow,",
    "      { name: config.workflowName },",
    "      React.createElement(",
    "        smithersApi.Sequence,",
    "        null,",
    "        React.createElement(smithersApi.Task, {",
    '          id: "greeting",',
    "          output: smithersApi.outputs.greeting,",
    "          children: {",
    "            message: launch.objective,",
    "          },",
    "        }),",
    "        React.createElement(smithersApi.Task, {",
    '          id: "result",',
    "          output: smithersApi.outputs.result,",
    "          children: {",
    "            summary: `Completed ${config.workflowId} for ${launch.objective}.`,",
    "            message: greeting?.message ?? launch.objective,",
    "            reviewerName: config.reviewerName,",
    "            promptBody: config.promptBody.trim(),",
    "          },",
    "        }),",
    "      ),",
    "    );",
    "  });",
    "}",
    "",
  ].join("\n");
}

function buildWorkflowAuthoringArtifactCode(): string {
  return [
    'const savedDefinitions = await api.workflow.list_assets({ kind: "definition", scope: "saved" });',
    'const savedPrompts = await api.workflow.list_assets({ kind: "prompt", scope: "saved" });',
    'const savedComponents = await api.workflow.list_assets({ kind: "component", scope: "saved" });',
    "const models = await api.workflow.list_models();",
    "const directWorkFits = false;",
    "const savedRunnableFits = false;",
    "const chosenModel = models.details.models.find((model) => model.authAvailable) ?? models.details.models[0] ?? {",
    '  providerId: "unknown",',
    '  modelId: "unknown",',
    "};",
    `const artifactWorkflowId = ${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_DIR)};`,
    `const artifactRoot = ${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_ROOT)};`,
    "const now = new Date().toISOString();",
    `const definitionText = ${JSON.stringify(buildWorkflowAuthoringDefinitionFileText())};`,
    "",
    "const promptText = [",
    '  "---",',
    '  "svvyAssetKind: prompt",',
    '  "svvyId: workflow_authoring_proof_prompt_draft",',
    '  "title: Workflow Authoring Proof Draft Prompt",',
    '  "summary: Artifact-local prompt for the workflow authoring proof draft.",',
    '  "---",',
    '  "",',
    '  "Confirm that artifact workflows stay artifact-only until the handler receives an explicit save request.",',
    '  "",',
    '].join("\\n");',
    "",
    "const componentText = [",
    '  "/**",',
    '  " * @svvyAssetKind component",',
    '  " * @svvyId workflow_authoring_proof_reviewer_draft",',
    '  " * @svvyTitle Workflow Authoring Proof Reviewer Draft",',
    '  " * @svvySummary Artifact-local reviewer agent for the workflow authoring proof.",',
    '  " */",',
    '  "export const workflowAuthoringReviewer = {",',
    "  '  name: \"workflow-authoring-reviewer\",',",
    '  `  provider: "${chosenModel.providerId}",`,',
    '  `  model: "${chosenModel.modelId}",`,',
    "  '  reasoning: \"medium\",',",
    "  '  toolSurface: [\"execute_typescript\"],',",
    "  '  instructions: \"Prefer artifact-local workflow files until the user explicitly asks to save reusable versions.\",',",
    '  "};",',
    '  "",',
    '].join("\\n");',
    "",
    "const entryText = [",
    "  'import { readFileSync } from \"node:fs\";',",
    "  'import { createWorkflowAuthoringProofWorkflow, workflowAuthoringProofLaunchSchema } from \"../definitions/workflow-authoring-proof.ts\";',",
    "  'import { workflowAuthoringReviewer } from \"../components/workflow-authoring-proof-reviewer.ts\";',",
    '  "",',
    '  "function readPromptBody(relativePath: string): string {",',
    "  '  const text = readFileSync(new URL(relativePath, import.meta.url), \"utf8\");',",
    "  '  if (!text.startsWith(\"---\\\\n\")) {',",
    '  "    return text.trim();",',
    '  "  }",',
    "  '  const end = text.indexOf(\"\\\\n---\\\\n\", 4);',",
    '  "  return (end === -1 ? text : text.slice(end + 5)).trim();",',
    '  "}",',
    '  "",',
    "  'const promptPath = \"../prompts/workflow-authoring-proof.mdx\";',",
    "  'export const workflowId = \"workflow_authoring_proof_draft\";',",
    "  'export const label = \"Workflow Authoring Proof Draft\";',",
    "  'export const summary = \"Deterministic artifact-local workflow used by the workflow authoring save proof.\";',",
    '  "export const launchSchema = workflowAuthoringProofLaunchSchema;",',
    `  ${JSON.stringify(
      `export const definitionPaths = [\n  "${WORKFLOW_AUTHORING_ARTIFACT_DEFINITION_PATH}",\n] as const;`,
    )},`,
    `  ${JSON.stringify(
      `export const promptPaths = [\n  "${WORKFLOW_AUTHORING_ARTIFACT_PROMPT_PATH}",\n] as const;`,
    )},`,
    `  ${JSON.stringify(
      `export const componentPaths = [\n  "${WORKFLOW_AUTHORING_ARTIFACT_COMPONENT_PATH}",\n] as const;`,
    )},`,
    '  "",',
    '  "export function createRunnableEntry(input: { dbPath: string }) {",',
    '  "  return {",',
    '  "    workflowId,",',
    "  '    workflowSource: \"artifact\" as const,',",
    '  "    launchSchema,",',
    '  "    workflow: createWorkflowAuthoringProofWorkflow({",',
    '  "      dbPath: input.dbPath,",',
    '  "      workflowId,",',
    "  '      workflowSource: \"artifact\",',",
    "  '      workflowName: \"svvy-workflow-authoring-proof-draft\",',",
    '  "      promptBody: readPromptBody(promptPath),",',
    '  "      reviewerName: workflowAuthoringReviewer.name,",',
    '  "    }),",',
    '  "  };",',
    '  "}",',
    '  "",',
    '].join("\\n");',
    "",
    "const metadata = {",
    "  artifactWorkflowId,",
    "  schemaVersion: 1,",
    '  sessionId: "svvy-e2e-session",',
    '  threadId: "workflow-authoring-proof-thread",',
    '  objectiveSummary: "Prove artifact-only authoring before an explicit save request.",',
    "  createdAt: now,",
    "  updatedAt: now,",
    `  entryPaths: [${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_ENTRY_PATH)}],`,
    "};",
    "return {",
    "  directWorkFits,",
    "  savedRunnableFits,",
    "  savedAssetCounts: {",
    "    definitions: savedDefinitions.details.assets.length,",
    "    prompts: savedPrompts.details.assets.length,",
    "    components: savedComponents.details.assets.length,",
    "  },",
    "  modelCount: models.details.models.length,",
    "  artifactWorkflowId,",
    `  entryPath: ${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_ENTRY_PATH)},`,
    "  files: [",
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_DEFINITION_PATH)}, content: definitionText },`,
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_PROMPT_PATH)}, content: promptText },`,
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_COMPONENT_PATH)}, content: componentText },`,
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_ENTRY_PATH)}, content: entryText },`,
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_ARTIFACT_METADATA_PATH)}, content: JSON.stringify(metadata, null, 2) },`,
    "  ],",
    "};",
  ].join("\n");
}

function buildWorkflowAuthoringSaveCode(): string {
  return [
    `const artifactPrompt = await api.read({ path: ${JSON.stringify(
      WORKFLOW_AUTHORING_ARTIFACT_PROMPT_PATH,
    )} });`,
    `const artifactComponent = await api.read({ path: ${JSON.stringify(
      WORKFLOW_AUTHORING_ARTIFACT_COMPONENT_PATH,
    )} });`,
    `const artifactDefinition = await api.read({ path: ${JSON.stringify(
      WORKFLOW_AUTHORING_ARTIFACT_DEFINITION_PATH,
    )} });`,
    "const artifactPromptText = artifactPrompt.content[0]?.type === 'text' ? artifactPrompt.content[0].text : '';",
    "const artifactComponentText = artifactComponent.content[0]?.type === 'text' ? artifactComponent.content[0].text : '';",
    "const artifactDefinitionText = artifactDefinition.content[0]?.type === 'text' ? artifactDefinition.content[0].text : '';",
    "",
    "function readPromptBody(text: string): string {",
    '  if (!text.startsWith("---\\n")) {',
    "    return text.trim();",
    "  }",
    '  const end = text.indexOf("\\n---\\n", 4);',
    "  return (end === -1 ? text : text.slice(end + 5)).trim();",
    "}",
    "",
    'const provider = artifactComponentText.match(/provider:\\s*"([^"]+)"/)?.[1] ?? "unknown";',
    'const model = artifactComponentText.match(/model:\\s*"([^"]+)"/)?.[1] ?? "unknown";',
    "",
    "const invalidComponentText = [",
    '  "/**",',
    '  " * @svvyAssetKind component",',
    '  " * @svvyId workflow_authoring_proof_reviewer",',
    '  " * @svvyTitle Workflow Authoring Proof Reviewer",',
    '  " * @svvySummary Broken saved reviewer used to prove workflow validation output.",',
    '  " */",',
    "  'const brokenReviewer: number = \"oops\";',",
    '  "export const workflowAuthoringReviewer = brokenReviewer;",',
    '  "",',
    '].join("\\n");',
    "",
    "const definitionText = artifactDefinitionText;",
    "",
    "const promptText = [",
    '  "---",',
    '  "svvyAssetKind: prompt",',
    '  "svvyId: workflow_authoring_proof_prompt",',
    '  "title: Workflow Authoring Proof Prompt",',
    '  "summary: Reusable prompt for the workflow authoring proof.",',
    '  "---",',
    '  "",',
    "  readPromptBody(artifactPromptText),",
    '  "",',
    '].join("\\n");',
    "",
    "const componentText = [",
    '  "/**",',
    '  " * @svvyAssetKind component",',
    '  " * @svvyId workflow_authoring_proof_reviewer",',
    '  " * @svvyTitle Workflow Authoring Proof Reviewer",',
    '  " * @svvySummary Reusable reviewer agent for the workflow authoring proof.",',
    '  " */",',
    '  "export const workflowAuthoringReviewer = {",',
    "  '  name: \"workflow-authoring-reviewer\",',",
    '  `  provider: "${provider}",`,',
    '  `  model: "${model}",`,',
    "  '  reasoning: \"medium\",',",
    "  '  toolSurface: [\"execute_typescript\"],',",
    "  '  instructions: \"Prefer clean reusable workflow files only after explicit save requests.\",',",
    '  "};",',
    '  "",',
    '].join("\\n");',
    "",
    "const entryText = [",
    "  'import { readFileSync } from \"node:fs\";',",
    "  'import { createWorkflowAuthoringProofWorkflow, workflowAuthoringProofLaunchSchema } from \"../definitions/workflow-authoring-proof.ts\";',",
    "  'import { workflowAuthoringReviewer } from \"../components/workflow-authoring-proof-reviewer.ts\";',",
    '  "",',
    '  "function readPromptBody(relativePath: string): string {",',
    "  '  const text = readFileSync(new URL(relativePath, import.meta.url), \"utf8\");',",
    "  '  if (!text.startsWith(\"---\\\\n\")) {',",
    '  "    return text.trim();",',
    '  "  }",',
    "  '  const end = text.indexOf(\"\\\\n---\\\\n\", 4);',",
    '  "  return (end === -1 ? text : text.slice(end + 5)).trim();",',
    '  "}",',
    '  "",',
    "  'const promptPath = \"../prompts/workflow-authoring-proof.mdx\";',",
    `  'export const workflowId = "${WORKFLOW_AUTHORING_SAVED_WORKFLOW_ID}";',`,
    "  'export const label = \"Workflow Authoring Proof\";',",
    "  'export const summary = \"Reusable deterministic workflow used by the workflow authoring save proof.\";',",
    '  "export const launchSchema = workflowAuthoringProofLaunchSchema;",',
    `  ${JSON.stringify(
      `export const definitionPaths = [\n  "${WORKFLOW_AUTHORING_SAVED_DEFINITION_PATH}",\n] as const;`,
    )},`,
    `  ${JSON.stringify(
      `export const promptPaths = [\n  "${WORKFLOW_AUTHORING_SAVED_PROMPT_PATH}",\n] as const;`,
    )},`,
    `  ${JSON.stringify(
      `export const componentPaths = [\n  "${WORKFLOW_AUTHORING_SAVED_COMPONENT_PATH}",\n] as const;`,
    )},`,
    '  "",',
    '  "export function createRunnableEntry(input: { dbPath: string }) {",',
    '  "  return {",',
    '  "    workflowId,",',
    "  '    workflowSource: \"saved\" as const,',",
    '  "    launchSchema,",',
    '  "    workflow: createWorkflowAuthoringProofWorkflow({",',
    '  "      dbPath: input.dbPath,",',
    '  "      workflowId,",',
    "  '      workflowSource: \"saved\",',",
    "  '      workflowName: \"svvy-workflow-authoring-proof\",',",
    '  "      promptBody: readPromptBody(promptPath),",',
    '  "      reviewerName: workflowAuthoringReviewer.name,",',
    '  "    }),",',
    '  "  };",',
    '  "}",',
    '  "",',
    '].join("\\n");',
    "",
    "return {",
    "  reusedArtifactPromptBytes: artifactPromptText.length,",
    "  reusedArtifactComponentBytes: artifactComponentText.length,",
    "  reusedArtifactDefinitionBytes: artifactDefinitionText.length,",
    "  savedPaths: [",
    `    ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_DEFINITION_PATH)},`,
    `    ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_PROMPT_PATH)},`,
    `    ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_COMPONENT_PATH)},`,
    `    ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_ENTRY_PATH)},`,
    "  ],",
    `  invalidFile: { path: ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_COMPONENT_PATH)}, content: invalidComponentText },`,
    "  files: [",
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_COMPONENT_PATH)}, content: componentText },`,
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_DEFINITION_PATH)}, content: definitionText },`,
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_PROMPT_PATH)}, content: promptText },`,
    `    { path: ${JSON.stringify(WORKFLOW_AUTHORING_SAVED_ENTRY_PATH)}, content: entryText },`,
    "  ],",
    "};",
  ].join("\n");
}
