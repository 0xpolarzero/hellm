import { describe, expect, test } from "bun:test";
import worker from "./worker";
import type { CloudflareEnv } from "./env";

/**
 * The REAL Cerebras check. Opt-in only: it hits the actual upstream (no fixture,
 * no base-URL override — env defaults to api.cerebras.ai), which is a billed,
 * network-dependent call. It is gated behind an explicit CEREBRAS_LIVE flag and a
 * dedicated key var so a plain `bun test` never touches the live upstream merely
 * because the CEREBRAS_API_KEY deploy secret is exported in the environment.
 *
 * Enable it by opting in and supplying a real key before the run:
 *   CEREBRAS_LIVE=1 CEREBRAS_LIVE_API_KEY=sk-... bun test src/worker.realkey.test.ts
 */
const REAL_KEY = process.env.CEREBRAS_LIVE === "1" ? process.env.CEREBRAS_LIVE_API_KEY : undefined;
const ORIGIN = "http://127.0.0.1:9100";

function reassembleReply(sse: string): string {
  let reply = "";
  for (const line of sse.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data) as { type?: string; delta?: unknown };
      if (chunk.type === "TEXT_MESSAGE_CONTENT" && typeof chunk.delta === "string") {
        reply += chunk.delta;
      }
    } catch {
      // skip keepalives
    }
  }
  return reply;
}

describe.skipIf(!REAL_KEY)("worker → real Cerebras", () => {
  test("streams a non-empty reply from the live upstream", async () => {
    const env: CloudflareEnv = { CEREBRAS_API_KEY: REAL_KEY as string };
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Reply with the single word: pong." }],
        }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const sse = await res.text();
    expect(sse).not.toContain("RUN_ERROR");
    expect(reassembleReply(sse).trim().length).toBeGreaterThan(0);
  }, 30_000);
});
