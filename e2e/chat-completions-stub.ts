type ChatCompletionRequest = {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
};

type ToolCallRecord = {
  id: string;
  name: string;
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
            "Open a handler thread dedicated to running the bundled hello_world workflow.",
          )
        ) {
          if (!hasToolCall(toolCalls, "thread.start")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.start",
              args: {
                title: "Hello World Workflow Thread",
                objective:
                  "Run the bundled hello_world workflow, monitor it to completion, and hand the result back to the orchestrator.",
              },
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Opened the Hello World Workflow Thread for the bundled hello_world workflow.",
          });
        }

        if (
          latestUserText.includes(
            "Run the bundled hello_world workflow, wait for it to finish, and hand the result back.",
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

          if (!hasToolCall(toolCalls, "smithers.run_workflow.hello_world")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "smithers.run_workflow.hello_world",
              args: {
                message: "hello from the real app workflow supervision e2e",
              },
            });
          }

          const launchedRun = findLatestToolResult(
            toolResults,
            "smithers.run_workflow.hello_world",
          );
          const runId = readStringProperty(launchedRun?.parsed, "runId");
          if (!runId) {
            throw new Error(
              "Expected smithers.run_workflow.hello_world tool result to include runId.",
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
              args: {
                kind: "workflow",
                title: "hello_world completed",
                summary:
                  "Ran the bundled hello_world workflow and verified that it finished successfully.",
                body: [
                  "Launched the bundled hello_world workflow through smithers.run_workflow.",
                  "Observed the Smithers run until it reported finished through smithers.get_run.",
                  "The workflow completed successfully and is ready for orchestrator follow-up.",
                ].join("\n\n"),
              },
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
          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Workflow attention received; the handler thread will inspect durable state before acting.",
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
      const name = readStringProperty(
        (toolCall as { function?: Record<string, unknown> }).function ?? null,
        "name",
      );
      if (!id || !name) {
        continue;
      }
      toolCalls.push({ id, name });
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
