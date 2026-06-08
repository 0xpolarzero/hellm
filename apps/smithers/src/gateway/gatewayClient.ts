import {
  GatewayRpcError,
  SmithersGatewayClient,
  type GatewayStreamReconnectEvent,
} from "@smithers-orchestrator/gateway-client";
import {
  getGatewayBaseUrl,
  getStoredAuthorization,
  handleAuthRequired,
  withAuthHeaders,
} from "../auth/authClient";
import {
  gatewayStreamSubscriptionsTotal,
  recordRpc,
  recordStreamReconnect,
} from "../observability/uiMetrics";

/**
 * The app's wrapper around `@smithers-orchestrator/gateway-client`.
 *
 * The SDK already speaks the gateway wire protocol (RPC + WebSocket); we layer
 * three app concerns over it without forking the transport:
 *
 *   - **same-origin Worker/Vite proxy:** when no gateway base URL is set we
 *     leave `baseUrl` at the page origin so `/v1/rpc/*` requests flow through
 *     the proxy (Vite in dev, the Cloudflare Worker in prod). The WebSocket
 *     subclass below rewrites the upgrade pathname to `/v1/rpc` because that
 *     is the path Vite's proxy has `ws: true` on; the gateway accepts WS on
 *     any path so this is a no-op against a direct gateway too.
 *   - **per-request auth:** a custom `fetch` impl re-runs `withAuthHeaders`
 *     for every call so a freshly rotated CSRF cookie or a token swapped at
 *     runtime is honored, and uses `credentials: "include"` so the gateway
 *     can see the session cookie on same-origin deployments.
 *   - **401 handling:** non-RPC HTTP 401s (e.g. the proxy rejecting before the
 *     gateway answers) dispatch the app's auth-required event so the
 *     `authStore` redirects to `/login` exactly like the legacy fetch path
 *     did. RPC-level `Unauthorized` frames still surface as `GatewayRpcError`
 *     and the store maps those onto its `unauthorized` status.
 *   - **browser-local observability:** RPC latency/outcomes and stream
 *     subscription/reconnect metrics are recorded here, at the SDK seam, so
 *     store code, sync clients, extensions, and custom workflow UIs inherit
 *     the same metrics without per-call wrappers.
 */

/**
 * Rewrite a WebSocket URL onto the `/v1/rpc` upgrade path. This matches the
 * Vite proxy entry that opts into `ws: true`, and the same-origin Worker proxy
 * forwards `/v1/rpc` upgrades the same way. The gateway itself accepts a WS
 * upgrade on any path, so this transparently works in production against a
 * direct gateway too.
 */
const RPC_WS_PATH = "/v1/rpc";

class RpcPathWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    const next = new URL(url);
    next.pathname = RPC_WS_PATH;
    next.search = "";
    super(next.toString(), protocols);
  }
}

function originOrConfiguredBase(): string {
  const configured = getGatewayBaseUrl();
  if (configured) return configured;
  if (typeof location !== "undefined") return location.origin;
  return "http://127.0.0.1:7331";
}

/**
 * Build a `fetch` that injects per-call auth headers (Authorization + CSRF for
 * mutations), preserves the SDK's `content-type` + body, forwards the abort
 * signal, and converts any 401 response that escapes the RPC frame layer into
 * the app's `auth-required` dispatch. We honor whatever headers the SDK passed
 * (it sets `content-type`, and may set its own `authorization` if the wrapper
 * was created with a token); we only fill gaps the wrapper itself owns.
 */
function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = withAuthHeaders(init?.headers, method);
  return fetch(input, {
    credentials: "include",
    ...init,
    headers,
  }).then((response) => {
    if (response.status === 401) {
      handleAuthRequired();
    }
    return response;
  });
}

let cached: SmithersGatewayClient | undefined;
let cachedBase: string | undefined;
let cachedToken: string | undefined;

function buildClient(baseUrl: string, token: string | undefined): SmithersGatewayClient {
  const options: ConstructorParameters<typeof SmithersGatewayClient>[0] = {
    baseUrl,
    fetch: authFetch as typeof fetch,
    WebSocket: RpcPathWebSocket,
  };
  if (token) options.token = token;
  return instrumentGatewayClient(new SmithersGatewayClient(options));
}

type GatewayStreamName = "run_events" | "devtools" | "extension";

async function* instrumentGatewayStream<T>(
  stream: GatewayStreamName,
  open: () => AsyncGenerator<T, void, void>,
): AsyncGenerator<T, void, void> {
  gatewayStreamSubscriptionsTotal.inc({ stream });
  try {
    yield* open();
  } catch (error) {
    recordStreamReconnect(
      stream,
      isAuthError(error) ? "auth_failure" : "transport_error",
    );
    throw error;
  }
}

function recordGatewayReconnect(
  stream: GatewayStreamName,
  event: GatewayStreamReconnectEvent,
): void {
  recordStreamReconnect(
    stream,
    isAuthError(event.error) ? "auth_failure" : event.reason,
    event.backoffMs,
  );
}

function instrumentGatewayClient(client: SmithersGatewayClient): SmithersGatewayClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "rpcRaw") {
        const rpcRaw: SmithersGatewayClient["rpcRaw"] = (method, params, options) =>
          recordRpc(method, () => target.rpcRaw(method, params, options));
        return rpcRaw;
      }

      if (prop === "streamRunEvents") {
        const streamRunEvents: SmithersGatewayClient["streamRunEvents"] = (params, options) =>
          instrumentGatewayStream("run_events", () =>
            target.streamRunEvents(params, options),
          );
        return streamRunEvents;
      }

      if (prop === "streamRunEventsResilient") {
        const streamRunEventsResilient: SmithersGatewayClient["streamRunEventsResilient"] = (
          params,
          options = {},
        ) =>
          instrumentGatewayStream("run_events", () =>
            target.streamRunEventsResilient(params, {
              ...options,
              onReconnect: (event) => {
                recordGatewayReconnect("run_events", event);
                options.onReconnect?.(event);
              },
            }),
          );
        return streamRunEventsResilient;
      }

      if (prop === "streamDevTools") {
        const streamDevTools: SmithersGatewayClient["streamDevTools"] = (params, options) =>
          instrumentGatewayStream("devtools", () =>
            target.streamDevTools(params, options),
          );
        return streamDevTools;
      }

      if (prop === "streamExtension") {
        const streamExtension: SmithersGatewayClient["streamExtension"] = <T = unknown>(
          namespace: string,
          key: string,
          params: Record<string, unknown> = {},
          options: { signal?: AbortSignal } = {},
        ) =>
          instrumentGatewayStream<T>("extension", () =>
            target.streamExtension<T>(namespace, key, params, options),
          );
        return streamExtension;
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * The shared gateway client for the app. Rebuilds when the configured base URL
 * or the stored bearer token changes — the SDK keeps those immutable on a
 * client instance, so we re-create rather than mutate to avoid stale auth.
 * The wrapper still re-runs `withAuthHeaders` on every fetch, so CSRF rotation
 * within a session does not require a rebuild.
 */
export function getGatewayClient(): SmithersGatewayClient {
  // Test override short-circuit: tests inject a fake via setGatewayClientForTests.
  if (cached && cachedBase === "test:override") return cached;
  const baseUrl = originOrConfiguredBase();
  const stored = getStoredAuthorization() ?? undefined;
  const token = stored?.startsWith("Bearer ") ? stored.slice(7) : stored;
  if (!cached || cachedBase !== baseUrl || cachedToken !== token) {
    cached = buildClient(baseUrl, token);
    cachedBase = baseUrl;
    cachedToken = token;
  }
  return cached;
}

/** Force a rebuild on the next `getGatewayClient()`. Used by tests and on logout. */
export function resetGatewayClient(): void {
  cached = undefined;
  cachedBase = undefined;
  cachedToken = undefined;
}

/**
 * Replace the shared client (and freeze cache invalidation). Used by tests
 * that need to drive the store against an in-memory SDK fake. Pass `undefined`
 * to revert to lazy resolution.
 */
export function setGatewayClientForTests(client: SmithersGatewayClient | undefined): void {
  cached = client;
  cachedBase = client ? "test:override" : undefined;
  cachedToken = client ? "test:override" : undefined;
}

/**
 * The set of error shapes the store treats as "needs auth". An RPC-frame
 * `Unauthorized` arrives as a `GatewayRpcError` with code starting `Unauthor…`
 * or HTTP status 401/403; transport-level `HTTP_ERROR` with status 401/403
 * also counts (e.g. the gateway returned a bare HTML 401 page).
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof GatewayRpcError) {
    if (error.status === 401 || error.status === 403) return true;
    return /^(Unauthorized|Forbidden|UNAUTHORIZED|FORBIDDEN)\b/.test(error.code);
  }
  if (error instanceof Error) {
    return /\bGateway HTTP (401|403)\b/.test(error.message) ||
      /^(UNAUTHORIZED|Unauthorized|FORBIDDEN|Forbidden)\b/.test(error.message);
  }
  return false;
}

export { RPC_WS_PATH };
