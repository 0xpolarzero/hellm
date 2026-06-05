/**
 * Agent-chat HTTP seam.
 *
 * The Workspace chat half talks to the REAL agent runtime over the same
 * `/__smithers_studio/api` HTTP layer that `src/workspaceApi.ts` uses for every
 * other surface. There is no dedicated chat helper exported from workspaceApi
 * (it predates this surface), so these three functions ARE the integration
 * seam — they mirror workspaceApi's fetch/error convention exactly so the dev
 * gateway can serve them and Playwright can route-mock them identically to the
 * jjhub-parity fixtures. The shapes follow the gateway `ChatBlock` model
 * (role / content / itemId / timestampMs) seen in the gui POC and
 * packages/gateway-client.
 *
 * SEAM: when the gateway grows a first-class chat endpoint, swap the three
 * `chatRequest` paths below for the workspaceApi equivalents — the component
 * code (AgentChat) does not change.
 */

export type ChatRole = "user" | "assistant" | "agent" | "system" | "tool" | "tool_result" | "stderr";

export type ChatBlock = {
  id: string;
  role: ChatRole;
  content: string;
  timestampMs: number | null;
  /** True while an assistant block is still streaming tokens in. */
  pending?: boolean;
};

export type ChatSession = {
  sessionId: string;
  /** Provider/model the agent is running, e.g. "claude-opus-4". */
  model: string | null;
  /** Agent mode, e.g. "default", "plan", "accept-edits". */
  mode: string | null;
  blocks: ChatBlock[];
};

/** One server-sent delta when streaming an assistant response. */
export type ChatStreamDelta =
  | { type: "block"; block: ChatBlock }
  | { type: "delta"; id: string; content: string }
  | { type: "done"; id: string }
  | { type: "error"; message: string };

async function chatRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/__smithers_studio/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Chat API failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

/** Load (or lazily create) the chat session bound to the current workspace. */
export async function loadChatSession(): Promise<ChatSession> {
  const payload = await chatRequest<{ session: ChatSession }>("/chat/session");
  return payload.session;
}

/**
 * Send a user message and surface the assistant reply as a sequence of
 * `ChatStreamDelta`s.
 *
 * The endpoint may answer three ways, all handled here:
 *   - `text/event-stream`: Server-Sent Events. Each event is one or more
 *     `data:` lines terminated by a blank line; the joined data payload is a
 *     `ChatStreamDelta` (the SSE-native live-streaming path). A bare `data:
 *     [DONE]` sentinel is ignored.
 *   - `application/x-ndjson`: newline-delimited `ChatStreamDelta` lines, read
 *     incrementally so tokens render as they arrive (the NDJSON streaming path).
 *   - `application/json`: a `{ deltas: ChatStreamDelta[] }` envelope for runtimes
 *     that cannot stream (e.g. a non-resumable agent) — replayed in order.
 */
export async function sendChatMessage(
  sessionId: string,
  content: string,
  onDelta: (delta: ChatStreamDelta) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/__smithers_studio/api/chat/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, content }),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as unknown;
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Chat send failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isSse = contentType.includes("event-stream");
  const isNdjson = contentType.includes("ndjson");

  if ((!isSse && !isNdjson) || !response.body) {
    const payload = (await response.json().catch(() => undefined)) as { deltas?: ChatStreamDelta[] };
    for (const delta of payload?.deltas ?? []) onDelta(delta);
    return;
  }

  if (isSse) {
    await readSse(response.body, onDelta);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) emitLine(line, onDelta);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  const tail = buffer.trim();
  if (tail) emitLine(tail, onDelta);
}

/**
 * Read a `text/event-stream` body. SSE events are separated by a blank line; an
 * event may carry multiple `data:` lines which the spec joins with "\n". We
 * accumulate the data payload for each event and parse it as a `ChatStreamDelta`
 * (ignoring comment lines starting with ":" and the `[DONE]` sentinel some
 * runtimes emit). Parsing raw `data:` text as NDJSON — the prior behavior —
 * leaked the literal `data:` framing into the chat as plain assistant text.
 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: ChatStreamDelta) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flushEvent = (raw: string) => {
    const dataLines: string[] = [];
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        // A single leading space after the colon is part of the framing.
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      // Other SSE fields (event:, id:, retry:) carry no delta payload here.
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n").trim();
    if (!data || data === "[DONE]") return;
    emitLine(data, onDelta);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are delimited by a blank line. Normalize CRLF so the split matches
    // both "\n\n" and "\r\n\r\n" framing.
    buffer = buffer.replace(/\r\n/g, "\n");
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      flushEvent(event);
      sep = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) flushEvent(buffer);
}

function emitLine(line: string, onDelta: (delta: ChatStreamDelta) => void) {
  try {
    onDelta(JSON.parse(line) as ChatStreamDelta);
  } catch {
    // A non-JSON line is treated as a plain assistant delta against the last
    // streaming block id "stream"; the runtime owns id assignment in practice.
    onDelta({ type: "delta", id: "stream", content: line });
  }
}
