import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../app/rootRoute";
import { ConciergeConsole } from "./ConciergeConsole";

/** The Concierge page (`/concierge`): the Context Engineering Console. */
function ConciergePage() {
  return <ConciergeConsole />;
}

export const conciergeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/concierge",
  component: ConciergePage,
});
