import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../app/rootRoute";
import { VcsCanvas } from "./VcsCanvas";

/** The VCS / Changes surface (`/vcs`). A top-level surface, not run-scoped. */
function VcsPage() {
  return <VcsCanvas />;
}

export const runVcsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vcs",
  component: VcsPage,
});
