import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../app/rootRoute";
import { IssuesCanvas } from "./IssuesCanvas";

/** The Issues surface (`/issues`). A top-level surface, not run-scoped. */
function IssuesPage() {
  return <IssuesCanvas />;
}

export const runIssuesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/issues",
  component: IssuesPage,
});
