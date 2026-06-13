import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const WORKFLOW_TASK_AGENT_BRIDGE_ENV = {
  URL: "SVVY_WORKFLOW_AGENT_BRIDGE_URL",
  TOKEN: "SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN",
  WORKSPACE_SESSION_ID: "SVVY_WORKSPACE_SESSION_ID",
  SOURCE_COMMAND_ID: "SVVY_SOURCE_COMMAND_ID",
} as const;

export interface WorkflowTaskAgentBridgeRequest {
  workspaceSessionId: string;
  sourceCommandId: string;
  taskContext: {
    runId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
  };
  agent: {
    id: string;
    label?: string;
    provider: string;
    model: string;
    reasoningEffort: string;
    instructions?: string;
    overrides?: Record<string, "loaded" | "available" | "unavailable">;
  };
  prompt?: string;
  messages?: { role: "user" | "assistant" | "system"; text: string }[];
  rootDir?: string;
}

export interface WorkflowTaskAgentBridgeResult {
  text: string;
  usage?: unknown;
  output?: unknown;
}

export interface WorkflowTaskAgentBridgeServer {
  readonly token: string;
  getUrl(): string;
  close(): void;
}

export function createWorkflowTaskAgentBridgeServer(input: {
  authorize?: (request: WorkflowTaskAgentBridgeRequest, bearerToken: string) => boolean;
  runTaskAgent: (request: WorkflowTaskAgentBridgeRequest) => Promise<WorkflowTaskAgentBridgeResult>;
}): WorkflowTaskAgentBridgeServer {
  const token = randomBytes(32).toString("base64url");
  let server: ReturnType<typeof Bun.serve> | null = null;
  let url: string | null = null;
  return {
    token,
    getUrl() {
      if (!server) {
        server = startBridgeServer(input, token);
        url = server.url.toString().replace(/\/$/, "");
      }
      return url!;
    },
    close() {
      if (!server) {
        return;
      }
      server.stop(true);
      server = null;
      url = null;
    },
  };
}

function startBridgeServer(
  input: {
    authorize?: (request: WorkflowTaskAgentBridgeRequest, bearerToken: string) => boolean;
    runTaskAgent: (
      request: WorkflowTaskAgentBridgeRequest,
    ) => Promise<WorkflowTaskAgentBridgeResult>;
  },
  token: string,
): ReturnType<typeof Bun.serve> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = randomInt(30_000, 60_000);
    try {
      return Bun.serve({
        hostname: "127.0.0.1",
        port,
        async fetch(request) {
          return await handleWorkflowTaskAgentBridgeRequest({
            request,
            authorize: input.authorize,
            token,
            runTaskAgent: input.runTaskAgent,
          });
        },
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "EADDRINUSE") {
        throw error;
      }
    }
  }
  throw new Error("Unable to allocate workflow task-agent bridge port.");
}

export async function handleWorkflowTaskAgentBridgeRequest(input: {
  request: Request;
  authorize?: (request: WorkflowTaskAgentBridgeRequest, bearerToken: string) => boolean;
  token: string;
  runTaskAgent: (request: WorkflowTaskAgentBridgeRequest) => Promise<WorkflowTaskAgentBridgeResult>;
}): Promise<Response> {
  try {
    const url = new URL(input.request.url);
    if (input.request.method !== "POST" || url.pathname !== "/runTaskAgent") {
      return jsonResponse(404, { error: "not_found" });
    }
    const bearerToken = readBearerToken(input.request.headers.get("authorization") ?? "");
    const body = await readJsonBody(input.request);
    const request = parseWorkflowTaskAgentBridgeRequest(body);
    const authorized = input.authorize
      ? input.authorize(request, bearerToken)
      : isMatchingSecret(bearerToken, input.token);
    if (!authorized) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    const result = await input.runTaskAgent(request);
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function parseWorkflowTaskAgentBridgeRequest(value: unknown): WorkflowTaskAgentBridgeRequest {
  if (!isRecord(value)) {
    throw new Error("runTaskAgent request must be an object.");
  }
  if (value.operation !== "runTaskAgent") {
    throw new Error("Workflow task-agent bridge supports only runTaskAgent.");
  }
  const taskContext = isRecord(value.taskContext) ? value.taskContext : {};
  const agent = value.agent ?? value.taskAgent;
  if (!isRecord(agent)) {
    throw new Error("runTaskAgent requires taskAgent.");
  }
  const request: WorkflowTaskAgentBridgeRequest = {
    workspaceSessionId: readRequiredString(value, "workspaceSessionId"),
    sourceCommandId: readRequiredString(value, "sourceCommandId"),
    taskContext: {
      runId: readSmithersRunId(value, taskContext),
      nodeId: readSmithersNodeId(value, taskContext),
      iteration: readSmithersIndex(value, taskContext, "iteration"),
      attempt: readSmithersIndex(value, taskContext, "attempt"),
    },
    agent: {
      id: readRequiredString(agent, "id"),
      label: readOptionalString(agent, "label"),
      provider: readRequiredString(agent, "provider"),
      model: readRequiredString(agent, "model"),
      reasoningEffort: readRequiredString(agent, "reasoningEffort"),
      instructions: readOptionalString(agent, "instructions"),
      overrides: readOverrides(agent.overrides),
    },
    prompt: readOptionalString(value, "prompt"),
    messages: readMessages(value.messages),
    rootDir: readOptionalString(value, "rootDir"),
  };
  return request;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  return JSON.parse(text || "{}");
}

function readBearerToken(authorization: string): string {
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return "";
  }
  return authorization.slice(prefix.length);
}

function isMatchingSecret(actualSecret: string, expectedSecret: string): boolean {
  const actual = Buffer.from(actualSecret);
  const expected = Buffer.from(expectedSecret);
  if (actual.length === 0) {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`runTaskAgent requires ${key}.`);
  }
  return value;
}

function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readSmithersRunId(
  value: Record<string, unknown>,
  taskContext: Record<string, unknown>,
): string {
  const run = isRecord(value.run) ? value.run : {};
  const contextRun = isRecord(taskContext.run) ? taskContext.run : {};
  const runId =
    readOptionalString(value, "smithersRunId") ??
    readOptionalString(value, "runId") ??
    readOptionalString(taskContext, "smithersRunId") ??
    readOptionalString(taskContext, "runId") ??
    readOptionalString(run, "id") ??
    readOptionalString(run, "runId") ??
    readOptionalString(contextRun, "id") ??
    readOptionalString(contextRun, "runId");
  if (!runId) {
    throw new Error("runTaskAgent requires Smithers run identity.");
  }
  return runId;
}

function readSmithersNodeId(
  value: Record<string, unknown>,
  taskContext: Record<string, unknown>,
): string {
  const node = isRecord(value.node) ? value.node : {};
  const contextNode = isRecord(taskContext.node) ? taskContext.node : {};
  const nodeId =
    readOptionalString(value, "nodeId") ??
    readOptionalString(taskContext, "nodeId") ??
    readOptionalString(node, "id") ??
    readOptionalString(node, "nodeId") ??
    readOptionalString(contextNode, "id") ??
    readOptionalString(contextNode, "nodeId") ??
    readOptionalString(taskContext, "taskId");
  if (!nodeId) {
    throw new Error("runTaskAgent requires Smithers node identity.");
  }
  return nodeId;
}

function readSmithersIndex(
  value: Record<string, unknown>,
  taskContext: Record<string, unknown>,
  key: "attempt" | "iteration",
): number {
  const direct = readIndexValue(value[key]);
  if (direct !== null) {
    return direct;
  }
  const context = readIndexValue(taskContext[key]);
  if (context !== null) {
    return context;
  }
  throw new Error(`runTaskAgent requires non-negative integer ${key}.`);
}

function readIndexValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (isRecord(value)) {
    const index = value.index;
    if (typeof index === "number" && Number.isInteger(index) && index >= 0) {
      return index;
    }
  }
  return null;
}

function readOverrides(value: unknown): Record<string, "loaded" | "available" | "unavailable"> {
  if (!isRecord(value)) {
    return {};
  }
  const overrides: Record<string, "loaded" | "available" | "unavailable"> = {};
  for (const [key, state] of Object.entries(value)) {
    if (state === "loaded" || state === "available" || state === "unavailable") {
      overrides[key] = state;
    }
  }
  return overrides;
}

function readMessages(value: unknown): WorkflowTaskAgentBridgeRequest["messages"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((message) => {
    if (!isRecord(message)) {
      return [];
    }
    const role = message.role;
    const text = typeof message.text === "string" ? message.text : message.content;
    if (
      (role !== "user" && role !== "assistant" && role !== "system") ||
      typeof text !== "string"
    ) {
      return [];
    }
    return [{ role, text }];
  });
}
