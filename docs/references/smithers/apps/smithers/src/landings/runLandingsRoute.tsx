import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../app/rootRoute";
import { LandingsCanvas } from "./LandingsCanvas";

/** The landings surface (`/landings`). A top-level surface, not run-scoped. */
function LandingsPage() {
  return <LandingsCanvas />;
}

export const runLandingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/landings",
  component: LandingsPage,
});
