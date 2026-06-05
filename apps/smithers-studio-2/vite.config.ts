import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const ptyTarget = process.env.PTY_SERVER_URL || "http://127.0.0.1:7342";

// During e2e the real Gateway (RPC) and the workspace-API server run on their
// own ports. Vite proxies the browser's same-origin calls to them so the app's
// real `runsGatewayClient` / `workspaceApi` code paths hit a live backend with
// no route mocking. Outside e2e (env unset) only the PTY websocket is proxied.
const gatewayTarget = process.env.SMITHERS_STUDIO_GATEWAY_PROXY_TARGET;
const workspaceApiTarget = process.env.SMITHERS_STUDIO_WORKSPACE_API_PROXY_TARGET;

const proxy: Record<string, string | ProxyOptions> = {
  "/terminal/ws": {
    target: ptyTarget,
    ws: true,
  },
};

if (gatewayTarget) {
  // RPC over HTTP plus the Gateway's run-event WebSocket. The live run-event
  // stream (useRunEvents) opens an RPC-over-WS transport on this same `/v1/rpc`
  // prefix and sends the Gateway `connect` + `streamRunEvents` handshake, so the
  // proxy must upgrade WebSocket traffic here too (`ws: true`) — otherwise the
  // socket hits Vite's HMR server and the Gateway delivers no run.event frames.
  proxy["/v1/rpc"] = { target: gatewayTarget, changeOrigin: true, ws: true };
  proxy["/health"] = { target: gatewayTarget, changeOrigin: true };
  // Workflow-mounted custom UIs (and their assets) are served by the Gateway at
  // /workflows/<key>; the Runs surface embeds them same-origin via an iframe, so
  // proxy that prefix through too. The studio SPA never owns a /workflows URL
  // (its nav is in-app, not route-based), so this can't shadow an app route.
  proxy["/workflows"] = { target: gatewayTarget, changeOrigin: true };
}

if (workspaceApiTarget) {
  proxy["/__smithers_studio"] = { target: workspaceApiTarget, changeOrigin: true };
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5190,
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4190,
  },
});
