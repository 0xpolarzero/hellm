/**
 * Hosts the REAL Cloudflare Worker (src/worker.ts) over HTTP so the e2e stack
 * can reach POST /api/chat as a live service (no mocking — see CLAUDE.md). The
 * Worker's upstream is pointed at the local OpenAI-compatible fixture via
 * CEREBRAS_BASE_URL, so the gateway runs without a real key.
 *
 * Run from the Playwright webServer:
 *   SMITHERS_WORKER_PORT=5276 CEREBRAS_BASE_URL=http://127.0.0.1:5277/v1 \
 *     bun tests/fixtures/workerHost.ts
 *
 * Vite proxies the browser's /api/chat here, rewriting Origin to this host so
 * the Worker's same-origin guard passes exactly as it does behind Cloudflare.
 */
import worker from "../../src/worker";
import type { CloudflareEnv } from "../../src/env";

const env: CloudflareEnv = {
  CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY ?? "fixture-key",
  CEREBRAS_BASE_URL: process.env.CEREBRAS_BASE_URL,
  CEREBRAS_MODEL: process.env.CEREBRAS_MODEL,
  AUTH_API_BASE_URL: process.env.AUTH_API_BASE_URL,
  PLUE_API_BASE_URL: process.env.PLUE_API_BASE_URL,
  GO_API_BASE_URL: process.env.GO_API_BASE_URL,
};

const port = Number(process.env.SMITHERS_WORKER_PORT ?? 5276);

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok");
    }
    return worker.fetch(request, env);
  },
});

console.log(
  `[worker-host] listening on http://127.0.0.1:${server.port} → upstream ${env.CEREBRAS_BASE_URL ?? "(default Cerebras)"}`,
);
