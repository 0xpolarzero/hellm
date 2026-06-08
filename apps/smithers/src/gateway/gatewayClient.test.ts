import { registerHappyDomForTests } from "../test/registerHappyDom";

registerHappyDomForTests();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GatewayRpcError } from "@smithers-orchestrator/gateway-client";
import {
  RPC_WS_PATH,
  getGatewayClient,
  isAuthError,
  resetGatewayClient,
  setGatewayClientForTests,
} from "./gatewayClient";
import {
  gatewayRpcErrorsTotal,
  gatewayRpcTotal,
  gatewayStreamReconnectsTotal,
  gatewayStreamSubscriptionsTotal,
  resetReconnectHistory,
} from "../observability/uiMetrics";
import { resetAuthRedirectForTests } from "../auth/authClient";

/**
 * The app's wrapper around `@smithers-orchestrator/gateway-client`. These tests
 * pin three behaviors:
 *   - the wrapper preserves same-origin Worker/Vite proxy behavior (no base URL
 *     swap unless one is configured),
 *   - 401 from the auth-fetch path dispatches `handleAuthRequired()`,
 *   - the SDK error layer maps onto our `isAuthError` so the store can mark
 *     itself "unauthorized" without parsing message strings.
 */

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalLocation = globalThis.location;

function setLocationOrigin(origin: string): void {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin, pathname: "/", search: "", hash: "", assign: () => {} } as unknown as Location,
  });
}

function setSessionToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token === null) window.sessionStorage.removeItem("smithers_token");
  else window.sessionStorage.setItem("smithers_token", token);
}

function resetGatewayMetrics(): void {
  gatewayRpcTotal.reset();
  gatewayRpcErrorsTotal.reset();
  gatewayStreamSubscriptionsTotal.reset();
  gatewayStreamReconnectsTotal.reset();
  resetReconnectHistory();
}

beforeEach(() => {
  resetGatewayClient();
  resetAuthRedirectForTests();
  resetGatewayMetrics();
  setLocationOrigin("http://app.local");
  setSessionToken(null);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: originalLocation,
  });
  resetGatewayClient();
  setGatewayClientForTests(undefined);
  resetAuthRedirectForTests();
  resetGatewayMetrics();
});

describe("getGatewayClient", () => {
  test("defaults baseUrl to the page origin so /v1/rpc stays same-origin", () => {
    const client = getGatewayClient();
    expect(client.baseUrl).toBe("http://app.local");
  });

  test("memoizes a single client across calls", () => {
    expect(getGatewayClient()).toBe(getGatewayClient());
  });

  test("rebuilds when the stored bearer token changes", () => {
    const before = getGatewayClient();
    setSessionToken("freshly-rotated");
    const after = getGatewayClient();
    expect(after).not.toBe(before);
    expect(after.token).toBe("freshly-rotated");
  });

  test("uses a WebSocket subclass that rewrites the path to /v1/rpc", () => {
    const client = getGatewayClient();
    expect(client.WebSocketImpl).toBeDefined();
    expect(RPC_WS_PATH).toBe("/v1/rpc");
  });
});

describe("auth-fetch (the SDK fetch impl this wrapper injects)", () => {
  test("injects Authorization + credentials and forwards 200 frames", async () => {
    setSessionToken("the-token");
    const seen: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (input, init = {}) => {
      seen.push({ url: String(input), init });
      return new Response(
        JSON.stringify({ type: "res", id: "x", ok: true, payload: { runs: [] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const client = getGatewayClient();
    const payload = await client.listRuns({});
    expect(payload).toEqual({ runs: [] } as never);
    expect(seen[0]?.url).toBe("http://app.local/v1/rpc/listRuns");
    expect(seen[0]?.init.credentials).toBe("include");
    const headers = new Headers(seen[0]?.init.headers ?? {});
    expect(headers.get("Authorization")).toBe("Bearer the-token");
  });

  test("records typed SDK RPC calls at the shared gateway-client boundary", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ type: "res", id: "x", ok: true, payload: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const client = getGatewayClient();
    await client.listRuns({});

    expect(gatewayRpcTotal.get({ method: "listRuns", outcome: "ok" })).toBe(1);
  });

  test("records direct rpcRaw calls for sync/custom UI consumers", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ type: "res", id: "x", ok: true, payload: { ok: true } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const client = getGatewayClient();
    await client.rpcRaw("ext.demo.resource", { id: "1" });

    expect(
      gatewayRpcTotal.get({ method: "ext.demo.resource", outcome: "ok" }),
    ).toBe(1);
  });

  test("records stream subscriptions and transport errors at the gateway-client boundary", async () => {
    const client = getGatewayClient();
    const abort = new AbortController();
    abort.abort();

    await expect(
      client.streamDevTools({ runId: "run-1" }, { signal: abort.signal }).next(),
    ).rejects.toThrow(
      /aborted/,
    );

    expect(gatewayStreamSubscriptionsTotal.get({ stream: "devtools" })).toBe(1);
    expect(
      gatewayStreamReconnectsTotal.get({
        stream: "devtools",
        reason: "transport_error",
      }),
    ).toBe(1);
  });

  test("a 401 outside the RPC frame triggers handleAuthRequired", async () => {
    let authRequiredFired = false;
    if (typeof window !== "undefined") {
      window.addEventListener("smithers:auth-required", () => {
        authRequiredFired = true;
      }, { once: true });
    }
    globalThis.fetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;
    const client = getGatewayClient();
    await expect(client.listRuns({})).rejects.toBeInstanceOf(GatewayRpcError);
    expect(authRequiredFired).toBe(true);
    expect(
      gatewayRpcErrorsTotal.get({ method: "listRuns", code: "HTTP_ERROR" }),
    ).toBe(1);
  });
});

describe("isAuthError", () => {
  test("identifies an RPC-frame Unauthorized error", () => {
    const error = new GatewayRpcError({
      method: "listRuns",
      code: "Unauthorized",
      message: "needs auth",
      status: 401,
    });
    expect(isAuthError(error)).toBe(true);
  });

  test("identifies a bare 401 Error from the legacy path", () => {
    expect(isAuthError(new Error("UNAUTHORIZED: needs auth"))).toBe(true);
    expect(isAuthError(new Error("Gateway HTTP 401"))).toBe(true);
  });

  test("non-auth errors stay false", () => {
    expect(isAuthError(new Error("connection refused"))).toBe(false);
    expect(isAuthError("not even an error")).toBe(false);
  });
});
