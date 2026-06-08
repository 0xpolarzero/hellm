import { createRoute } from "@tanstack/react-router";
import { usePreferencesStore } from "../app/preferencesStore";
import { rootRoute } from "../app/rootRoute";
import { GRILL_EDGES, GRILL_NODES } from "./grillMe";
import { WorkflowGraph } from "./WorkflowGraph";

/** The Ask Me page (`/askme`): the grill-me workflow graph. */
function AskMePage() {
  const theme = usePreferencesStore((state) => state.theme);
  const full = usePreferencesStore((state) => state.layout === "sidebar");
  return (
    <div className={full ? "askme-graph askme-graph-full" : "askme-graph"}>
      <WorkflowGraph nodes={GRILL_NODES} edges={GRILL_EDGES} theme={theme} />
    </div>
  );
}

export const askMeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/askme",
  component: AskMePage,
});
