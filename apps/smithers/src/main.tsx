import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { bindRouteStore } from "./app/bindRouteStore";
import { router } from "./app/router";
import { useAuthStore } from "./auth/authStore";
import { bindDock } from "./apps/bindDock";
import { bindGateway } from "./gateway/bindGateway";
import { startApprovalWatcher } from "./runs/watchApprovals";
import { registerServiceWorker } from "./registerServiceWorker";
import { SyncProvider } from "@smithers-orchestrator/gateway-react";
import { appSyncClient } from "./sync/appSyncClient";
import { platformFetch } from "./jjhub/platformFetch";
import { platformJson, PlatformError } from "./jjhub/platformJson";
import "./styles.css";

// Wire the router into the route store and bridge run gates to the chat before
// the first paint, so every store is live when the shell mounts. bindGateway
// runs after bindRouteStore so the first resolved route already drives the
// gateway link (lazy connect, run selection).
bindRouteStore(router);
bindDock();
bindGateway();
startApprovalWatcher();
// Kick the auth check once at boot (not from an AuthStatus mount effect).
void useAuthStore.getState().bootstrap();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SyncProvider client={appSyncClient}>
      <RouterProvider router={router} />
    </SyncProvider>
  </StrictMode>,
);

registerServiceWorker();

// Expose the jjhub seam (`platformJson`/`platformFetch`/`PlatformError`) to
// Playwright when `VITE_SMITHERS_E2E_TEST_HOOKS=1`. Specs drive *real* app
// transport — auth header attach, base-URL resolution, error mapping — so
// "the UI sees fake-plue data" can be asserted from the browser side without
// shipping a debug surface in production. Gate is build-time: the import.meta
// branch goes dead in any other build (preview, deploy, dev without the env).
if (import.meta.env.VITE_SMITHERS_E2E_TEST_HOOKS === "1") {
  (window as unknown as { __smithers_test?: unknown }).__smithers_test = {
    platformFetch,
    platformJson,
    PlatformError,
  };
}
