import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  decodeUnknownRunTaskAgentInputExit,
  decodeUnknownRunTaskAgentErrorExit,
  decodeUnknownRunTaskAgentResultExit,
  decodeUnknownRunTaskAgentSourceInputExit,
  schemaErrorMessage,
  type RunTaskAgentInput,
  type RunTaskAgentErrorCode,
  type RunTaskAgentResult,
} from "@svvy/core";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

export const RUN_TASK_AGENT_BRIDGE_ENV = {
  URL: "SVVY_WORKFLOW_AGENT_BRIDGE_URL",
  TOKEN: "SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN",
  WORKSPACE_SESSION_ID: "SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID",
  SOURCE_COMMAND_ID: "SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID",
  TIMEOUT_MS: "SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS",
} as const;

export interface RunTaskAgentBridgeServer {
  readonly token: string;
  getUrl(): string;
  close(): void;
}

export function createRunTaskAgentBridgeServer(input: {
  authorize?: (request: RunTaskAgentInput, bearerToken: string) => boolean;
  runTaskAgent: (request: RunTaskAgentInput) => Promise<RunTaskAgentResult>;
}): RunTaskAgentBridgeServer {
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
    authorize?: (request: RunTaskAgentInput, bearerToken: string) => boolean;
    runTaskAgent: (request: RunTaskAgentInput) => Promise<RunTaskAgentResult>;
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
          return await handleRunTaskAgentRequest({
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

export async function handleRunTaskAgentRequest(input: {
  request: Request;
  authorize?: (request: RunTaskAgentInput, bearerToken: string) => boolean;
  token: string;
  runTaskAgent: (request: RunTaskAgentInput) => Promise<RunTaskAgentResult>;
}): Promise<Response> {
  let bridgeRequest: RunTaskAgentInput | null = null;
  try {
    const url = new URL(input.request.url);
    if (input.request.method !== "POST" || url.pathname !== "/runTaskAgent") {
      return bridgeErrorResponse(
        404,
        "invalid_request",
        "Workflow task-agent bridge supports only POST /runTaskAgent.",
      );
    }
    const bearerToken = readBearerToken(input.request.headers.get("authorization") ?? "");
    const body = await readJsonBody(input.request);
    const sourceRequest = requireDecoded(decodeUnknownRunTaskAgentSourceInputExit(body));
    bridgeRequest = requireDecoded(decodeUnknownRunTaskAgentInputExit(sourceRequest));
    const authorized = input.authorize
      ? input.authorize(bridgeRequest, bearerToken)
      : isMatchingSecret(bearerToken, input.token);
    if (!authorized) {
      return bridgeErrorResponse(
        401,
        "unauthorized",
        "Unauthorized workflow task-agent bridge request.",
        {
          workspaceSessionId: bridgeRequest.workspaceSessionId,
          sourceCommandId: bridgeRequest.sourceCommandId,
        },
      );
    }
  } catch (error) {
    return bridgeErrorResponse(400, "invalid_request", errorMessage(error));
  }

  try {
    const result = requireDecoded(
      decodeUnknownRunTaskAgentResultExit(await input.runTaskAgent(bridgeRequest)),
    );
    return jsonResponse(200, result);
  } catch (error) {
    return bridgeErrorResponse(500, "task_attempt_failed", errorMessage(error), {
      retryable: true,
      workspaceSessionId: bridgeRequest.workspaceSessionId,
      sourceCommandId: bridgeRequest.sourceCommandId,
    });
  }
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function bridgeErrorResponse(
  status: number,
  error: RunTaskAgentErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    requestId?: string;
    workspaceSessionId?: string;
    sourceCommandId?: string;
    taskAttemptId?: string;
  } = {},
): Response {
  const payload = requireDecoded(
    decodeUnknownRunTaskAgentErrorExit({
      error,
      message,
      retryable: options.retryable ?? false,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.workspaceSessionId ? { workspaceSessionId: options.workspaceSessionId } : {}),
      ...(options.sourceCommandId ? { sourceCommandId: options.sourceCommandId } : {}),
      ...(options.taskAttemptId ? { taskAttemptId: options.taskAttemptId } : {}),
    }),
  );
  return jsonResponse(status, payload);
}

function requireDecoded<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw new Error(Cause.pretty(exit.cause));
}

function errorMessage(error: unknown): string {
  if (error instanceof Schema.SchemaError) {
    return schemaErrorMessage(error);
  }
  return error instanceof Error ? error.message : String(error);
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
