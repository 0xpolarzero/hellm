import {
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  type ThreadSnapshot,
} from "@hellm/session-model";
import { projectThreadSnapshot, renderProjection } from "@hellm/tui";

const timestamp = "2026-04-08T09:00:00.000Z";

const snapshot: ThreadSnapshot = {
  thread: createThread({
    id: "thread-process",
    kind: "smithers-workflow",
    objective: "Render workflow progress from a process boundary.",
    status: "running",
    createdAt: timestamp,
  }),
  episodes: [],
  artifacts: [],
  verification: createGlobalVerificationState(),
  alignment: createSessionWorktreeAlignment({
    sessionCwd: process.cwd(),
  }),
  workflowRuns: [
    {
      runId: "run-process-1",
      threadId: "thread-process",
      workflowId: "workflow:process-boundary/running",
      status: "running",
      updatedAt: timestamp,
    },
    {
      runId: "run-process-2",
      threadId: "thread-process",
      workflowId: "workflow:process-boundary/waiting-approval",
      status: "waiting_approval",
      updatedAt: timestamp,
    },
  ],
};

for (const line of renderProjection(projectThreadSnapshot(snapshot))) {
  console.log(`[workflow-progress] ${line}`);
}
