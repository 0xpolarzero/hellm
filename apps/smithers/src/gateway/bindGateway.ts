import { useRouteStore } from "../app/routeStore";
import { useGatewayStore } from "./gatewayStore";

/**
 * Bridge the route store to the gateway store, the way bindRouteStore bridges
 * the router. This is the gateway's data trigger: it replaces the mount effect a
 * component would otherwise use to fetch on open. When a gateway-run surface
 * becomes active it connects (if needed) and selects the run — which starts its
 * snapshot poll; leaving the surface stops the poll. Visiting the Store connects
 * lazily so its live-workflows list can populate. Called once from main, after
 * bindRouteStore, so the first resolved route is already handled.
 */
export function bindGateway(): void {
  let lastRunId: string | undefined;

  const apply = (): void => {
    const { view, surface } = useRouteStore.getState();
    const gateway = useGatewayStore.getState();

    if (view === "store") {
      gateway.ensureConnected();
    }

    if (surface?.kind === "gatewayRun") {
      gateway.ensureConnected();
      if (surface.runId !== lastRunId) {
        lastRunId = surface.runId;
        gateway.openRun(surface.workflowKey, surface.runId);
      }
      return;
    }

    if (lastRunId !== undefined) {
      lastRunId = undefined;
      gateway.closeRun();
    }
  };

  apply();
  useRouteStore.subscribe(apply);
}
