import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  connectionStateValue,
  gatewayRpcDurationMs,
  gatewayRpcErrorsTotal,
  gatewayRpcTotal,
  gatewayStreamBackoffMs,
  gatewayStreamReconnectStormsTotal,
  gatewayStreamReconnectsTotal,
  proxyOutcomeFor,
  proxyRouteKindFor,
  recordRpc,
  recordStreamReconnect,
  resetReconnectHistory,
} from "./uiMetrics";

beforeEach(() => {
  gatewayRpcTotal.reset();
  gatewayRpcErrorsTotal.reset();
  gatewayRpcDurationMs.reset();
  gatewayStreamReconnectsTotal.reset();
  gatewayStreamReconnectStormsTotal.reset();
  gatewayStreamBackoffMs.reset();
  resetReconnectHistory();
});

afterEach(() => {
  resetReconnectHistory();
});

describe("proxyRouteKindFor", () => {
  test("maps known routes to the documented kinds", () => {
    expect(proxyRouteKindFor("/api/auth/auth0/authorize")).toBe("auth");
    expect(proxyRouteKindFor("/api/user")).toBe("auth");
    expect(proxyRouteKindFor("/api/user/keys")).toBe("auth");
    expect(proxyRouteKindFor("/api/user/repos")).toBe("platform");
    expect(proxyRouteKindFor("/api/user/repos/acme/widgets")).toBe("platform");
    expect(proxyRouteKindFor("/api/user/workspaces")).toBe("platform");
    expect(proxyRouteKindFor("/api/repos/x/y")).toBe("platform");
    expect(proxyRouteKindFor("/api/orgs")).toBe("platform");
    expect(proxyRouteKindFor("/api/notifications")).toBe("platform");
    expect(proxyRouteKindFor("/api/integrations/x")).toBe("platform");
    expect(proxyRouteKindFor("/api/oauth2/x")).toBe("platform");
    expect(proxyRouteKindFor("/resolve/foo")).toBe("platform");
    expect(proxyRouteKindFor("/v1/rpc/listRuns")).toBe("gateway_rpc");
    expect(proxyRouteKindFor("/health")).toBe("gateway_http");
    expect(proxyRouteKindFor("/workflows/foo")).toBe("gateway_http");
    expect(proxyRouteKindFor("/api/chat")).toBe("chat");
    expect(proxyRouteKindFor("/metrics")).toBe("metrics");
    expect(proxyRouteKindFor("/")).toBe("static");
    expect(proxyRouteKindFor("/whatever-else")).toBe("unknown");
  });
});

describe("proxyOutcomeFor", () => {
  test("buckets status codes into Prometheus-friendly families", () => {
    expect(proxyOutcomeFor(200)).toBe("ok");
    expect(proxyOutcomeFor(302)).toBe("ok");
    expect(proxyOutcomeFor(400)).toBe("client_error");
    expect(proxyOutcomeFor(401)).toBe("auth_failure");
    expect(proxyOutcomeFor(403)).toBe("auth_failure");
    expect(proxyOutcomeFor(429)).toBe("rate_limited");
    expect(proxyOutcomeFor(502)).toBe("server_error");
    expect(proxyOutcomeFor(0)).toBe("upstream_unreachable");
  });
});

describe("recordRpc", () => {
  test("records latency and ok outcome on success", async () => {
    let ticks = 0;
    const clock = () => (ticks += 5);
    const result = await recordRpc(
      "listRuns",
      async () => 42,
      clock,
    );
    expect(result).toBe(42);
    expect(gatewayRpcTotal.get({ method: "listRuns", outcome: "ok" })).toBe(1);
    expect(
      gatewayRpcDurationMs.snapshots().find((s) => s.labels.method === "listRuns")
        ?.count,
    ).toBe(1);
  });

  test("records the error code label on failure and rethrows", async () => {
    await expect(
      recordRpc("listRuns", async () => {
        throw new Error("UNAUTHORIZED: nope");
      }),
    ).rejects.toThrow(/UNAUTHORIZED/);
    expect(
      gatewayRpcTotal.get({ method: "listRuns", outcome: "error" }),
    ).toBe(1);
    expect(
      gatewayRpcErrorsTotal.get({ method: "listRuns", code: "UNAUTHORIZED" }),
    ).toBe(1);
  });

  test("buckets 'Gateway HTTP 5xx' transport errors under HTTP_5XX", async () => {
    await expect(
      recordRpc("listRuns", async () => {
        throw new Error("Gateway HTTP 502");
      }),
    ).rejects.toThrow();
    expect(
      gatewayRpcErrorsTotal.get({ method: "listRuns", code: "HTTP_5XX" }),
    ).toBe(1);
  });

  test(
    "extractErrorCode does not leak state between back-to-back HTTP families",
    async () => {
      // Catches a class of RegExp.$1 / global-state bugs: two failures in
      // quick succession must each map to its own status family, not the prior one.
      await expect(
        recordRpc("a", async () => {
          throw new Error("Gateway HTTP 404");
        }),
      ).rejects.toThrow();
      await expect(
        recordRpc("b", async () => {
          throw new Error("Gateway HTTP 504");
        }),
      ).rejects.toThrow();
      expect(gatewayRpcErrorsTotal.get({ method: "a", code: "HTTP_4XX" })).toBe(1);
      expect(gatewayRpcErrorsTotal.get({ method: "b", code: "HTTP_5XX" })).toBe(1);
    },
  );

  test("normalizes adversarial uppercase prefixes to UNKNOWN", async () => {
    await expect(
      recordRpc("listRuns", async () => {
        throw new Error("FOO_BAR_BAZ: explode");
      }),
    ).rejects.toThrow();
    expect(
      gatewayRpcErrorsTotal.get({ method: "listRuns", code: "UNKNOWN" }),
    ).toBe(1);
  });
});

describe("recordStreamReconnect", () => {
  test("records single reconnect and backoff observation", () => {
    let t = 1000;
    recordStreamReconnect("runs", "transport_error", 250, () => t);
    expect(
      gatewayStreamReconnectsTotal.get({
        stream: "runs",
        reason: "transport_error",
      }),
    ).toBe(1);
    const sample = gatewayStreamBackoffMs.snapshots()[0];
    expect(sample.count).toBe(1);
    expect(sample.sum).toBe(250);
  });

  test("storm threshold ticks on the Nth reconnect inside the window", () => {
    let t = 0;
    const clock = () => (t += 1000);
    for (let i = 0; i < 5; i++) {
      recordStreamReconnect("snapshot", "transport_error", 100, clock);
    }
    expect(
      gatewayStreamReconnectStormsTotal.get({ stream: "snapshot" }),
    ).toBe(1);
  });

  test("sliding window keeps emitting storms while reconnects keep firing", () => {
    // Sustained outage: 10 reconnects, 1s apart. Window holds 5 of them at any
    // time after the 5th, so each subsequent reconnect raises a storm. The
    // PagerDuty signal is a continuous rate, not a single tick.
    let t = 0;
    const clock = () => (t += 1000);
    for (let i = 0; i < 10; i++) {
      recordStreamReconnect("snapshot", "transport_error", 100, clock);
    }
    // Storms raised on reconnects 5..10 inclusive = 6 ticks.
    expect(
      gatewayStreamReconnectStormsTotal.get({ stream: "snapshot" }),
    ).toBe(6);
  });

  test("does not raise a storm for sparse reconnects across the window", () => {
    let t = 0;
    const clock = () => {
      t += 60_001;
      return t;
    };
    for (let i = 0; i < 5; i++) {
      recordStreamReconnect("runs", "idle_refresh", 100, clock);
    }
    expect(gatewayStreamReconnectStormsTotal.get({ stream: "runs" })).toBe(0);
  });
});

describe("connectionStateValue", () => {
  test("encodes the documented mapping", () => {
    expect(connectionStateValue("offline")).toBe(0);
    expect(connectionStateValue("connecting")).toBe(1);
    expect(connectionStateValue("online")).toBe(2);
    expect(connectionStateValue("unauthorized")).toBe(3);
    expect(connectionStateValue("idle")).toBe(-1);
  });
});
