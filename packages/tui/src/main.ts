import {
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  type ThreadSnapshot,
} from "@hellm/session-model";
import { projectThreadSnapshot, renderProjection } from "./index.ts";

const timestamp = new Date().toISOString();

const snapshot: ThreadSnapshot = {
  thread: createThread({
    id: "demo",
    kind: "direct",
    objective: "Render an orchestration-aware TUI projection.",
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
  episodes: [],
  artifacts: [],
  verification: createGlobalVerificationState(),
  alignment: createSessionWorktreeAlignment({ sessionCwd: process.cwd() }),
  workflowRuns: [],
};

for (const line of renderProjection(projectThreadSnapshot(snapshot))) {
  console.log(`[hellm/tui] ${line}`);
}
