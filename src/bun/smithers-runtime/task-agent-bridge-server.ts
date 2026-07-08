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
  MAX_RESPONSE_BYTES: "SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES",
} as const;

const DEFAULT_RUN_TASK_AGENT_BRIDGE_MAX_REQUEST_BYTES = 1_048_576;

export interface RunTaskAgentBridgeServer {
  readonly token: string;
  getUrl(): string;
  close(): void;
}

export class RunTaskAgentBridgeError extends Error {
  constructor(
    readonly code: Extract<
      RunTaskAgentErrorCode,
      "source_command_not_found" | "source_command_not_handler_owned" | "source_command_terminal"
    >,
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "RunTaskAgentBridgeError";
  }
}

export function createRunTaskAgentBridgeServer(input: {
  authorize?: (request: RunTaskAgentInput, bearerToken: string) => boolean;
  maxRequestBytes?: number;
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
    maxRequestBytes?: number;
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
            maxRequestBytes: input.maxRequestBytes,
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
  maxRequestBytes?: number;
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
    if (bearerToken === null) {
      return bridgeErrorResponse(
        401,
        "unauthorized",
        "Unauthorized workflow task-agent bridge request.",
      );
    }
    const body = await readJsonBody(
      input.request,
      input.maxRequestBytes ?? DEFAULT_RUN_TASK_AGENT_BRIDGE_MAX_REQUEST_BYTES,
    );
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
    if (error instanceof PayloadTooLargeError) {
      return bridgeErrorResponse(413, "payload_too_large", error.message);
    }
    return bridgeErrorResponse(400, "invalid_request", errorMessage(error));
  }

  try {
    const result = requireDecoded(
      decodeUnknownRunTaskAgentResultExit(await input.runTaskAgent(bridgeRequest)),
    );
    return jsonResponse(200, result);
  } catch (error) {
    if (error instanceof RunTaskAgentBridgeError) {
      return bridgeErrorResponse(error.status, error.code, error.message, {
        retryable: false,
        workspaceSessionId: bridgeRequest.workspaceSessionId,
        sourceCommandId: bridgeRequest.sourceCommandId,
      });
    }
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

class PayloadTooLargeError extends Error {
  constructor() {
    super("Bridge request body exceeded the configured byte limit.");
  }
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (Number.isSafeInteger(parsed) && parsed > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }
  const text = await readBoundedRequestText(request, maxBytes);
  return JSON.parse(text || "{}");
}

async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) {
    return "";
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function readBearerToken(authorization: string): string | null {
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return null;
  }
  const token = authorization.slice(prefix.length);
  return token.length > 0 ? token : null;
}

function isMatchingSecret(actualSecret: string, expectedSecret: string): boolean {
  const actual = Buffer.from(actualSecret);
  const expected = Buffer.from(expectedSecret);
  if (actual.length === 0) {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
