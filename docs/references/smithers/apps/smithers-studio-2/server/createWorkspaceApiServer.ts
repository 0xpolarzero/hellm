import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  handleWorkspaceBackendRequest,
  loadWorkspaceStatus,
  WorkspaceHttpError,
} from "./workspaceBackend";
import { loadChatSession } from "./chat/loadChatSession";
import { streamChatMessage } from "./chat/streamChatMessage";
import { listCrons } from "./crons/listCrons";
import { launchWorkflowRun } from "./runs/launchWorkflowRun";
import type { WorkspaceBackendRequest } from "../src/workspaceProtocol";

const API_PREFIX = "/__smithers_studio/api";

/**
 * Hard cap on request body bytes, enforced while streaming so an attacker can
 * never make us buffer an unbounded payload (memory-exhaustion DoS). Set above
 * the largest legitimate body: a screenshot PNG up to
 * MAX_OPERATOR_SCREENSHOT_BYTES (20MB) is sent base64-encoded (~27MB) inside a
 * JSON envelope, so 32MB leaves headroom for that endpoint while still
 * rejecting anything pathological.
 */
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;

/** Thrown by readJsonBody when the body exceeds MAX_REQUEST_BODY_BYTES. */
class RequestBodyTooLargeError extends Error {
  readonly status = 413;
  constructor() {
    super("Request body too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      // Stop accumulating so memory stays bounded, but keep draining the
      // request stream so the response (a clean 413) can be delivered instead
      // of the socket being reset under the client.
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) {
      chunks.push(buf);
    }
  }
  if (tooLarge) {
    throw new RequestBodyTooLargeError();
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as unknown;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function errorStatus(error: unknown): number {
  if (error instanceof WorkspaceHttpError) {
    return error.status;
  }
  if (error instanceof RequestBodyTooLargeError) {
    return error.status;
  }
  return 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Respond to a readJsonBody() failure: a 413 for an oversized body (DoS guard),
 * otherwise a 400 for malformed JSON.
 */
function respondReadBodyError(res: ServerResponse, error: unknown): void {
  if (error instanceof RequestBodyTooLargeError) {
    return sendJson(res, error.status, { error: error.message });
  }
  return sendJson(res, 400, { error: `Invalid JSON body: ${errorMessage(error)}` });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://studio.local");
  const method = (req.method ?? "GET").toUpperCase();

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/__smithers_studio/workspace") {
    return sendJson(res, 200, loadWorkspaceStatus());
  }

  if (!url.pathname.startsWith(API_PREFIX)) {
    return sendJson(res, 404, { error: `Unhandled path ${method} ${url.pathname}` });
  }

  const route = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, "");

  // Chat: GET session (lazily created), POST message (streams ndjson from the
  // REAL agent runtime). Handled here because chat owns the streaming response.
  if (route === "chat/session" && method === "GET") {
    try {
      return sendJson(res, 200, { session: loadChatSession() });
    } catch (error: unknown) {
      return sendJson(res, errorStatus(error), { error: errorMessage(error) });
    }
  }
  if (route === "chat/message" && method === "POST") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error: unknown) {
      return respondReadBodyError(res, error);
    }
    // streamChatMessage owns the response (ndjson); surface pre-stream failures
    // as JSON only if headers have not been sent yet.
    try {
      await streamChatMessage(res, bodyRecord(body));
    } catch (error: unknown) {
      if (!res.headersSent) {
        sendJson(res, errorStatus(error), { error: errorMessage(error) });
      } else {
        res.end();
      }
    }
    return;
  }

  // Crons (Workflows "Schedules" segment) — real `_smithers_cron` rows.
  if (route === "crons" && method === "GET") {
    try {
      return sendJson(res, 200, { crons: listCrons() });
    } catch (error: unknown) {
      return sendJson(res, errorStatus(error), { error: errorMessage(error) });
    }
  }

  // Launch a real detached run.
  if (route === "runs" && method === "POST") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error: unknown) {
      return respondReadBodyError(res, error);
    }
    const record = bodyRecord(body);
    try {
      const result = await launchWorkflowRun(
        String(record.workflow ?? ""),
        record.input && typeof record.input === "object" && !Array.isArray(record.input)
          ? (record.input as Record<string, unknown>)
          : {},
      );
      return sendJson(res, 200, result);
    } catch (error: unknown) {
      return sendJson(res, errorStatus(error), { error: errorMessage(error) });
    }
  }

  // Everything else: the real workspace backend (jjhub issues/landings/
  // workspaces, changes, prompts, workflows, memory, scores, sql, logs, …).
  let body: unknown;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await readJsonBody(req);
    } catch (error: unknown) {
      return respondReadBodyError(res, error);
    }
  }

  const request: WorkspaceBackendRequest = {
    method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
  };

  try {
    const response = await handleWorkspaceBackendRequest(request);
    return sendJson(res, response.status, response.payload);
  } catch (error: unknown) {
    return sendJson(res, errorStatus(error), { error: errorMessage(error) });
  }
}

/**
 * Create the real Workspace API HTTP server.
 *
 * Serves `/__smithers_studio/workspace` and `/__smithers_studio/api/*` against
 * the real Smithers packages and local CLIs (jj/jjhub, the SQLite store, the
 * agent runtime) — the same surface `src/workspaceApi.ts` and the chat client
 * fetch. This is the production dev backend; the Playwright fixture
 * (`tests/fixtures/workspaceApiServer.ts`) is now opt-in only.
 */
export function createWorkspaceApiServer(): Server {
  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        sendJson(res, errorStatus(error), { error: errorMessage(error) });
      } else {
        res.end();
      }
    });
  });
}
