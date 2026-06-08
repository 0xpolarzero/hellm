/**
 * A REAL OpenAI-compatible Chat Completions SSE server (no mocking — see
 * CLAUDE.md). It stands in for api.cerebras.ai so the whole gateway path — the
 * `openai` SDK inside src/worker.ts → this upstream → TanStack's SSE bridge —
 * runs end to end without a real Cerebras key, streaming a deterministic reply
 * ({@link SEEDED_CHAT_REPLY}).
 *
 * Run standalone for e2e (Playwright webServer):
 *   SMITHERS_UPSTREAM_PORT=5277 bun tests/fixtures/cerebrasUpstream.ts
 * or start it in-process from a Bun test via {@link startCerebrasUpstream}.
 */
import { SEEDED_CHAT_MODEL, seededReplyChunks } from "./seededChat";

const encoder = new TextEncoder();

function streamCompletion(model: string): Response {
  const base = {
    id: "chatcmpl-fixture",
    object: "chat.completion.chunk",
    created: 1700000000,
    model,
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      // Opening role delta, then one content delta per chunk, then a stop.
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
      for (const piece of seededReplyChunks()) {
        send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
      }
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return new Response("ok");
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    const parsed = (await request.json().catch(() => ({}))) as { model?: string };
    return streamCompletion(parsed.model ?? SEEDED_CHAT_MODEL);
  }
  return new Response("not found", { status: 404 });
}

/** Start the upstream on `port` (0 = ephemeral). Returns the Bun server. */
export function startCerebrasUpstream(port = 0) {
  return Bun.serve({ port, hostname: "127.0.0.1", fetch: handler });
}

if (import.meta.main) {
  const port = Number(process.env.SMITHERS_UPSTREAM_PORT ?? 5277);
  const server = startCerebrasUpstream(port);
  console.log(`[cerebras-upstream] listening on http://127.0.0.1:${server.port}`);
}
