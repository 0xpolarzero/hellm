import { createRouter } from "@tanstack/react-router";
import { runDiffRoute } from "../diff/runDiffRoute";
import { askMeRoute } from "../askme/askMeRoute";
import { gatewayRunRoute } from "../gateway/gatewayRunRoute";
import { runIssuesRoute } from "../issues/runIssuesRoute";
import { runLandingsRoute } from "../landings/runLandingsRoute";
import { runInspectorRoute } from "../runs/runInspectorRoute";
import { runLogsRoute } from "../runs/runLogsRoute";
import { runsRoute } from "../runs/runsRoute";
import { approvalsRoute } from "../approvals/approvalsRoute";
import { agentsRoute } from "../agents/agentsRoute";
import { memoryRoute } from "../memory/memoryRoute";
import { promptsRoute } from "../prompts/promptsRoute";
import { scoresRoute } from "../scores/scoresRoute";
import { cronsRoute } from "../crons/cronsRoute";
import { workflowEditorRoute } from "../store/workflowEditorRoute";
import { paletteRoute } from "../palette/paletteRoute";
import { storeRoute } from "../store/storeRoute";
import { conciergeRoute } from "../concierge/conciergeRoute";
import { runTicketsRoute } from "../tickets/runTicketsRoute";
import { runTimelineRoute } from "../timeline/runTimelineRoute";
import { runVcsRoute } from "../vcs/runVcsRoute";
import { loginRoute } from "../auth/loginRoute";
import { appHistory } from "./history";
import { homeRoute } from "./homeRoute";
import { rootRoute } from "./rootRoute";

const routeTree = rootRoute.addChildren([
  homeRoute,
  askMeRoute,
  storeRoute,
  conciergeRoute,
  runInspectorRoute,
  runLogsRoute,
  runDiffRoute,
  runTimelineRoute,
  runVcsRoute,
  runIssuesRoute,
  runTicketsRoute,
  runLandingsRoute,
  runsRoute,
  approvalsRoute,
  agentsRoute,
  memoryRoute,
  promptsRoute,
  scoresRoute,
  cronsRoute,
  workflowEditorRoute,
  paletteRoute,
  gatewayRunRoute,
  loginRoute,
]);

/** The app's single router. Its history adapts to web vs Electrobun (see appHistory). */
export const router = createRouter({ routeTree, history: appHistory });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
