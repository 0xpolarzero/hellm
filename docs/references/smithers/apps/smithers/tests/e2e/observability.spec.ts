import { expect, test } from "@playwright/test";

/**
 * Real-stack scrape of `/metrics` from the running Worker via the same-origin
 * Vite proxy. No mocks: the scrape goes through the same code path that any
 * Prometheus instance would use locally.
 *
 * We assert on the metric names and labels, not their values — keeps the
 * contract stable while letting the exact request counts vary with parallel
 * test load. The negative assertions pin the worker-vs-browser registry
 * split documented at `.smithers/specs/smithers-ui-observability.md`: browser
 * series must NOT appear in the Worker scrape.
 */
test.describe("observability /metrics endpoint", () => {
  test("worker exposes Prometheus text exposition with the documented metric names", async ({
    request,
    baseURL,
  }) => {
    // First drive any request through the Worker so a series exists. The
    // `/metrics` route itself is recorded too, so even a cold worker exposes
    // its own counters after the scrape.
    await request.get(`${baseURL}/metrics`);
    const response = await request.get(`${baseURL}/metrics`);
    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/plain");
    const body = await response.text();

    // Documented counter/histogram names. Pin these — the README, the changelog
    // and the Prometheus scrape config name them explicitly.
    expect(body).toContain("# TYPE smithers_ui_worker_proxy_requests_total counter");
    expect(body).toContain("# TYPE smithers_ui_worker_proxy_duration_ms histogram");
    expect(body).toContain("# TYPE smithers_ui_worker_proxy_payload_bytes histogram");
    expect(body).toContain(
      "# TYPE smithers_ui_worker_proxy_auth_failures_total counter",
    );
    // The route-kind label tag is what dashboards group by — pin it.
    expect(body).toMatch(
      /smithers_ui_worker_proxy_requests_total\{[^}]*route_kind="metrics"[^}]*\} \d+/,
    );

    // The proxy counter intentionally omits the `status` label (encoded in
    // `outcome`). A regression here multiplies cardinality under 4xx/5xx storms.
    expect(body).not.toMatch(
      /smithers_ui_worker_proxy_requests_total\{[^}]*status=/,
    );

    // Browser-only metrics live in `browserRegistry`; the Worker scrape must
    // not advertise them. Pinning the absence catches a future regression
    // that would create false-confidence dashboards.
    expect(body).not.toContain("smithers_ui_gateway_rpc_total");
    expect(body).not.toContain("smithers_ui_gateway_stream_subscriptions_total");
    expect(body).not.toContain("smithers_ui_surface_refresh_total");
  });
});
