import {
  authorWorkflow,
  createSmithersWorkflowBridge,
} from "@hellm/smithers-bridge";

const bridge = createSmithersWorkflowBridge({
  smithersBinary: "nonexistent-smithers-binary-for-testing",
});
const thread = {
  id: "process-smoke-thread",
  kind: "smithers-workflow" as const,
  objective: "Process smoke objective",
  inputEpisodeIds: [] as string[],
  status: "running" as const,
  createdAt: "2026-04-08T09:00:00.000Z",
  updatedAt: "2026-04-08T09:00:00.000Z",
};
const workflow = authorWorkflow({
  thread,
  objective: thread.objective,
  inputEpisodeIds: [],
  tasks: [],
});

const errors: string[] = [];

let runStatus = "unknown";
let resumeStatus = "unknown";

try {
  const runResult = await bridge.runWorkflow({
    path: "smithers-workflow",
    thread,
    objective: thread.objective,
    cwd: process.cwd(),
    workflow,
  });
  runStatus = runResult.status;
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

try {
  const resumeResult = await bridge.resumeWorkflow({
    runId: "process-smoke-run",
    thread,
    objective: thread.objective,
  });
  resumeStatus = resumeResult.status;
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

try {
  await bridge.approveRun("process-smoke-run", { approved: true });
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

try {
  await bridge.denyRun("process-smoke-run", { approved: false });
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

console.log(
  JSON.stringify({
    enabled: bridge.enabled,
    engine: bridge.engine,
    runStatus,
    resumeStatus,
    errors,
  }),
);
