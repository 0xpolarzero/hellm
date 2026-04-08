import {
  authorWorkflow,
  createSmithersWorkflowBridge,
} from "@hellm/smithers-bridge";

const bridge = createSmithersWorkflowBridge();
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
const capture = async (op: () => Promise<unknown>): Promise<void> => {
  try {
    await op();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
};

await capture(() =>
  bridge.runWorkflow({
    path: "smithers-workflow",
    thread,
    objective: thread.objective,
    cwd: process.cwd(),
    workflow,
  }),
);
await capture(() =>
  bridge.resumeWorkflow({
    runId: "process-smoke-run",
    thread,
    objective: thread.objective,
  }),
);
await capture(() =>
  bridge.approveRun("process-smoke-run", {
    approved: true,
  }),
);
await capture(() =>
  bridge.denyRun("process-smoke-run", {
    approved: false,
  }),
);

console.log(
  JSON.stringify({
    enabled: bridge.enabled,
    engine: bridge.engine,
    errors,
  }),
);
