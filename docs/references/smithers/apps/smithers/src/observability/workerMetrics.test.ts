import { beforeEach, describe, expect, test } from "bun:test";
import worker from "../worker";
import type { CloudflareEnv } from "../env";
import { browserRegistry, workerRegistry } from "./metrics";
import {
  gatewayRpcTotal,
  gatewayStreamReconnectsTotal,
  proxyAuthFailuresTotal,
  proxyDurationMs,
  proxyPayloadBytes,
  proxyRequestsTotal,
  recordStreamReconnect,
  resetReconnectHistory,
} from "./uiMetrics";

/**
 * Real worker entrypoint, called the way Cloudflare calls it. We do not mock
 * the registry or the route table — we drive `worker.fetch` and read the
 * shared metric series back. The cases below cover routing, auth failure
 * boundaries, payload-size recording, /metrics scrape, and the explicit
 * negative assertion that browser-only metrics never appear in the Worker
 * scrape (the two realms each own a separate `defaultRegistry`).
 */

const ORIGIN = "http://127.0.0.1:9201";

const baseEnv: CloudflareEnv = {
  CEREBRAS_API_KEY: "fixture-key",
};

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

beforeEach(() => {
  workerRegistry.reset();
  browserRegistry.reset();
  resetReconnectHistory();
});

describe("worker observability", () => {
  test("/metrics returns Prometheus text after recording at least one request", async () => {
    await worker.fetch(req("/api/chat", { method: "GET" }), baseEnv);
    const response = await worker.fetch(req("/metrics"), baseEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("smithers_ui_worker_proxy_requests_total");
    expect(body).toContain('route_kind="chat"');
    expect(body).toContain("smithers_ui_worker_proxy_duration_ms_bucket");
  });

  test("/metrics rejects cross-origin browser scrapes (no allowed Origin header)", async () => {
    const response = await worker.fetch(
      req("/metrics", { headers: { origin: "http://evil.example" } }),
      baseEnv,
    );
    expect(response.status).toBe(403);
  });

  test("auth-failure path increments proxyAuthFailuresTotal", async () => {
    // POST /api/chat with no Origin → handleChat returns 403 → outcome=auth_failure.
    await worker.fetch(
      req("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      }),
      baseEnv,
    );
    expect(
      proxyAuthFailuresTotal.get({
        route_kind: "chat",
        reason: "forbidden",
      }),
    ).toBe(1);
  });

  test("payload size is recorded when content-length is present", async () => {
    const body = JSON.stringify({ messages: [] });
    await worker.fetch(
      req("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "content-length": String(body.length),
        },
        body,
      }),
      baseEnv,
    );
    const sample = proxyPayloadBytes
      .snapshots()
      .find((s) => s.labels.route_kind === "chat");
    expect(sample?.count).toBe(1);
    expect(sample?.sum).toBeGreaterThan(0);
  });

  test("404 fallbacks still record a request series", async () => {
    await worker.fetch(req("/some/unknown/path"), baseEnv);
    expect(
      proxyRequestsTotal.get({
        route_kind: "unknown",
        method: "GET",
        outcome: "client_error",
      }),
    ).toBe(1);
    const sample = proxyDurationMs
      .snapshots()
      .find(
        (s) => s.labels.route_kind === "unknown" && s.labels.method === "GET",
      );
    expect(sample?.count).toBe(1);
  });

  test("/metrics HEAD is allowed; arbitrary methods are not", async () => {
    const head = await worker.fetch(req("/metrics", { method: "HEAD" }), baseEnv);
    expect(head.status).toBe(200);
    const post = await worker.fetch(req("/metrics", { method: "POST" }), baseEnv);
    expect(post.status).toBe(405);
  });

  test("proxy counter does NOT carry a `status` label (cardinality guard)", async () => {
    await worker.fetch(req("/some/other/path"), baseEnv);
    const entry = proxyRequestsTotal.entries()[0];
    expect(Object.keys(entry.labels).sort()).toEqual([
      "method",
      "outcome",
      "route_kind",
    ]);
    expect(entry.labels.status).toBeUndefined();
  });

  test("browser-only gateway metrics are absent from the worker /metrics scrape", async () => {
    // Drive a known browser-side mutation against `browserRegistry`, then prove
    // the Worker scrape does NOT carry it. The Worker only exposes its own
    // `workerRegistry`; browser-local metrics stay browser-local.
    recordStreamReconnect("snapshot", "transport_error", 100);
    expect(
      gatewayStreamReconnectsTotal.get({
        stream: "snapshot",
        reason: "transport_error",
      }),
    ).toBe(1);
    await worker.fetch(req("/api/chat", { method: "GET" }), baseEnv);
    const body = await (await worker.fetch(req("/metrics"), baseEnv)).text();
    expect(body).not.toContain(gatewayRpcTotal.name);
    expect(body).not.toContain("smithers_ui_gateway_stream_subscriptions_total");
    expect(body).not.toContain("smithers_ui_gateway_stream_reconnects_total");
    expect(body).not.toContain("smithers_ui_surface_refresh_total");
  });
});
