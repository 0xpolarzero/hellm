import { SmithersGatewayClient } from "@smithers-orchestrator/gateway-client";

/**
 * Lazily-constructed gateway client shared by the developer surfaces. The base
 * URL defaults to `location.origin`, and every RPC the developer tools use
 * (`listRuns`, `getDevToolsSnapshot`) is served over plain HTTP at
 * `${origin}/v1/rpc/<method>` — so the surfaces work against a live gateway and
 * are fully route-mockable in Playwright without faking a WebSocket.
 */
let client: SmithersGatewayClient | null = null;

export function devGatewayClient(): SmithersGatewayClient {
  if (!client) {
    client = new SmithersGatewayClient();
  }
  return client;
}
