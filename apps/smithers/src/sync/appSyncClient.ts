import {
  SyncClient,
  createSmithersGatewayTransport,
  type SyncTransport,
} from "@smithers-orchestrator/gateway-client";
import { handleAuthRequired } from "../auth/authClient";
import { getGatewayClient } from "../gateway/gatewayClient";

/**
 * The shared `SyncClient` for apps/smithers. One process-wide instance keeps
 * cache hits coherent across routes and components; embedded custom workflow
 * UIs can either reuse this (via the iframe shim) or instantiate their own.
 *
 * RPC and streaming both go through the app's shared `getGatewayClient()`
 * wrapper, so cookie auth, CSRF, same-origin proxying, and WebSocket path
 * rewriting stay in one place. Streaming uses
 * `SmithersGatewayClient.streamRunEventsResilient`, which handles reconnect +
 * lastSeq resume in the gateway-client layer; the `SyncSubscriptionHub` defers
 * to it instead of layering its own reconnect.
 *
 * `handleAuthRequired` is guarded for re-entrancy in `auth/authClient`, so HTTP
 * 401 handling in the gateway wrapper and the stream path (which surfaces
 * UNAUTHORIZED through `onAuthError`) collapse to a single redirect.
 */
function makeTransport(): SyncTransport {
  return {
    rpc(method: string, params: unknown, options) {
      return getGatewayClient().rpcRaw(method, params, { signal: options?.signal });
    },
    stream(scope, params, options) {
      return createSmithersGatewayTransport(getGatewayClient()).stream!(scope, params, options);
    },
  };
}

export const appSyncClient = new SyncClient({
  transport: makeTransport(),
  cache: {
    cacheTimeMs: 5 * 60_000,
  },
  subscription: {
    bufferMax: 1024,
    // The gateway-client's resilient generator already handles reconnect on
    // transient drops and returns on `run.completed`, so the hub treats a
    // graceful end as terminal (the default).
  },
  onAuthError: () => {
    handleAuthRequired();
  },
});
